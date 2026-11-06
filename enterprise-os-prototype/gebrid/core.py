"""GEBRID Enterprise sandbox security core.

All enforcement is server-side; all tools and model outputs are simulated.
Policies are formal and deterministic. Guardian is heuristic, not an independent LLM.
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from . import db

_KEY = None


def now():
    return datetime.now(timezone.utc).isoformat()


def jdump(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def jload(value, default=None):
    return json.loads(value) if value else default


def identifier():
    return uuid.uuid4().hex[:20]


def init_key():
    global _KEY
    value = os.environ.get('GEBRID_INTEGRITY_KEY_HEX', '')
    if value:
        try:
            key = bytes.fromhex(value)
        except ValueError:
            raise RuntimeError('GEBRID_INTEGRITY_KEY_HEX must be valid hex')
        if len(key) < 32:
            raise RuntimeError('GEBRID_INTEGRITY_KEY_HEX must decode to at least 32 bytes')
        _KEY = key
        return
    path = Path(os.environ.get('GEBRID_KEY_PATH', './data/.local_integrity_key'))
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        # O_EXCL avoids multiple processes overwriting a newly created demo key.
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with os.fdopen(fd, 'wb') as f:
                f.write(secrets.token_bytes(32))
        except FileExistsError:
            pass
    _KEY = path.read_bytes()
    if len(_KEY) < 32:
        raise RuntimeError('Local integrity key is invalid')


def tag(data):
    if _KEY is None:
        raise RuntimeError('Integrity key not initialized')
    return hmac.new(_KEY, data.encode('utf-8'), hashlib.sha256).hexdigest()


def append_audit(c, event, actor, subject, data=None):
    payload = jdump(data or {})
    previous = db.one(c, 'SELECT signature FROM audit_log ORDER BY seq DESC LIMIT 1')
    prev = previous['signature'] if previous else 'GENESIS'
    at = now()
    signature = tag(jdump([prev, event, actor, subject, payload, at]))
    c.execute('''INSERT INTO audit_log(event_type,actor,subject,data_json,prev_hash,signature,created_at)
                 VALUES(?,?,?,?,?,?,?)''', (event, actor, subject, payload, prev, signature, at))
    return signature


def verify_audit(c):
    expected = 'GENESIS'
    count = 0
    for record in db.many(c, 'SELECT * FROM audit_log ORDER BY seq ASC'):
        count += 1
        sig = tag(jdump([expected, record['event_type'], record['actor'], record['subject'], record['data_json'], record['created_at']]))
        if not hmac.compare_digest(record['prev_hash'], expected) or not hmac.compare_digest(sig, record['signature']):
            return {'valid': False, 'checked': count, 'failure_seq': record['seq'],
                    'warning': 'Local chain integrity failure; not externally anchored'}
        expected = record['signature']
    return {'valid': True, 'checked': count, 'head': expected,
            'warning': 'Local HMAC chain only. An administrator with DB and key access can rewrite it.'}


def password_ok(password, password_hash):
    try:
        salt_text, expected_text = password_hash.split(':', 1)
        actual = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt_text), 350_000)
        return hmac.compare_digest(actual, bytes.fromhex(expected_text))
    except (ValueError, TypeError):
        return False


def login(c, username, password):
    user = db.one(c, 'SELECT * FROM users WHERE username=?', (username,))
    if not user or not password_ok(password, user['password_hash']):
        raise HTTPException(401, detail='Invalid credentials')
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    expiration = (datetime.now(timezone.utc) + timedelta(hours=8)).isoformat()
    c.execute('INSERT INTO sessions VALUES(?,?,?)', (token_hash, user['id'], expiration))
    append_audit(c, 'auth.login', user['id'], user['id'], {'role': user['role']})
    return {'token': token, 'expires_at': expiration, 'user': public_user(user)}


def public_user(user):
    return {key: user[key] for key in ('id', 'username', 'role')}


def from_token(c, token):
    if not token:
        raise HTTPException(401, detail='Bearer token required')
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    user = db.one(c, '''SELECT u.* FROM users u JOIN sessions s ON u.id=s.user_id
                          WHERE s.token_hash=? AND s.expires_at > ?''', (token_hash, now()))
    if not user:
        raise HTTPException(401, detail='Session expired or unauthorized')
    return public_user(user)


def require_role(user, *roles):
    if user['role'] not in roles:
        raise HTTPException(403, detail=f'Requires one of roles: {", ".join(roles)}')


def amount_value(value):
    if value is None:
        return None
    try:
        result = Decimal(str(value))
    except (InvalidOperation, TypeError):
        raise HTTPException(422, detail='Invalid amount')
    if not result.is_finite() or result < 0 or result > Decimal('1000000000000'):
        raise HTTPException(422, detail='Invalid amount range')
    return result


# Minimal high-confidence demo indicators only; no claim of comprehensive prompt injection defense.
INJECTION_PATTERNS = [
    r'ignore (all )?(previous|prior|system) instructions',
    r'disregard (your|the) (rules|system)',
    r'(exfiltrat|send|leak).{0,40}(secrets|api keys|credentials)',
    r'you are now (a |an )?(system|developer)',
    r'<\|im_start\|>system',
    r'override (security|policy|permissions)',
]


def guardian_assess(action, input_text, recipient, amount):
    flags = []
    text = input_text or ''
    for pattern in INJECTION_PATTERNS:
        if re.search(pattern, text, flags=re.IGNORECASE):
            flags.append('Possible prompt injection or data exfiltration instruction')
            break
    if action in ('contract.send', 'report.publish', 'repo.pr.create'):
        flags.append('Externally visible or privileged output; manual approval is required by policy')
    if amount is not None and amount >= Decimal('5000'):
        flags.append('High-value operation; verify approval threshold')
    if recipient and ('@' in recipient or recipient.startswith('http')):
        flags.append('Recipient may point to an external destination')
    return {'risk': 'high' if any('injection' in x for x in flags) else ('medium' if flags else 'low'),
            'flags': flags, 'mode': 'deterministic-demo-rules'}


def policy_decision(c, request):
    aid, action = request.get('agent_id'), request.get('action')
    agent = db.one(c, 'SELECT * FROM agents WHERE id=?', (aid,))
    deny = lambda reason, p=None, guardian=None: {
        'decision': 'DENY', 'reason': reason, 'policy': p,
        'guardian': guardian or guardian_assess(action, request.get('input_text', ''), request.get('recipient'), amount_value(request.get('amount')))
    }
    if not agent:
        return deny('Unknown agent')
    if db.one(c, "SELECT value FROM settings WHERE key='emergency_stop'")['value'] == '1':
        return deny('Global emergency stop is active')
    if agent['status'] != 'active':
        return deny('Agent is stopped')
    if action not in jload(agent['permissions_json'], []):
        return deny('Agent does not have this scope')
    policy = db.one(c, 'SELECT * FROM policies WHERE agent_id=? AND action=?', (aid, action))
    if not policy or not policy['enabled'] or policy['effect'] == 'deny':
        return deny('No active allowing policy (fail closed)', policy)
    tool = db.one(c, 'SELECT * FROM tools WHERE id=?', (policy['tool_id'],))
    if not tool or tool['status'] != 'active':
        return deny('MCP Shield: required tool is disabled or quarantined', policy)
    if action not in jload(tool['allowed_actions_json'], []):
        return deny('MCP Shield: action not in tool allowlist', policy)
    if request.get('tool_id') and request['tool_id'] != policy['tool_id']:
        return deny('MCP Shield: caller cannot substitute a tool', policy)
    amount = amount_value(request.get('amount'))
    recipient = request.get('recipient') or ''
    guardian = guardian_assess(action, request.get('input_text',''), recipient, amount)
    if guardian['risk'] == 'high':
        return deny('Guardian detected dangerous input. Action blocked.', policy, guardian)
    recipients = jload(policy['allowed_recipients_json'], [])
    if recipients and recipient not in recipients:
        return deny('Recipient not on trusted policy allowlist', policy, guardian)
    if amount is not None:
        if policy['max_amount'] is not None and amount > Decimal(str(policy['max_amount'])):
            return deny('Amount exceeds policy hard limit', policy, guardian)
        if amount > 0:
            available = Decimal(str(agent['budget_limit'])) - Decimal(str(agent['budget_used']))
            if amount > available:
                return deny('Insufficient remaining agent budget', policy, guardian)
    if action == 'purchase.create' and amount is None:
        return deny('Purchase amount is required to enforce hard limits and budget', policy, guardian)
    if action == 'invoice.draft':
        invoice = db.one(c, 'SELECT * FROM invoices WHERE id=?', (request.get('resource_id'),))
        if not invoice:
            return deny('Invoice not found', policy, guardian)
        supplier = db.one(c, 'SELECT * FROM suppliers WHERE id=?', (invoice['supplier_id'],))
        if not supplier or not hmac.compare_digest(invoice['submitted_bank'], supplier['trusted_bank']):
            return deny('Trusted supplier bank mismatch — cannot be overridden by approval', policy, guardian)
        if recipient != invoice['supplier_id']:
            return deny('Invoice supplier and requested recipient mismatch', policy, guardian)
        if amount != Decimal(str(invoice['amount'])):
            return deny('Requested amount must match trusted invoice record', policy, guardian)
        # One invoice may have only one active drafting request or saved sandbox draft.
        # Exclude the current request while rechecking an approval.
        pending_duplicate = db.one(c, "SELECT id FROM action_requests WHERE resource_id=? AND action='invoice.draft' AND status='PENDING_APPROVAL' AND id<>? LIMIT 1", (invoice['id'], request.get('id') or ''))
        existing_draft = db.one(c, 'SELECT id FROM drafts WHERE invoice_id=? LIMIT 1', (invoice['id'],))
        if pending_duplicate or existing_draft:
            return deny('Duplicate invoice draft or pending approval exists', policy, guardian)
        if invoice['input_text']:
            doc_guardian = guardian_assess(action, invoice['input_text'], recipient, amount)
            if doc_guardian['risk'] == 'high':
                return deny('Untrusted invoice text contains a prompt injection indicator', policy, doc_guardian)
    if action == 'invoice.read' and not db.one(c,'SELECT id FROM invoices WHERE id=?', (request.get('resource_id'),)):
        return deny('Invoice not found', policy, guardian)
    needs_approval = policy['effect'] == 'approval'
    if amount is not None and policy['approval_above'] is not None and amount > Decimal(str(policy['approval_above'])):
        needs_approval = True
    return {'decision': 'REQUIRE_APPROVAL' if needs_approval else 'ALLOW',
            'reason': 'Independent finance approval required' if needs_approval else 'All active controls passed',
            'policy': policy, 'guardian': guardian}


def execute_sandbox(c, request):
    # The only supported execution side effect is writing local synthetic records.
    action = request['action']
    # Authorization (including the mandatory purchase amount) is decided only in policy_decision.
    result = {'mode': 'SIMULATED', 'external_calls': 0, 'action': action, 'at': now()}
    if action == 'invoice.draft':
        invoice = db.one(c, 'SELECT * FROM invoices WHERE id=?', (request['resource_id'],))
        draft_id = 'DR-' + identifier()[:10].upper()
        c.execute('INSERT INTO drafts VALUES(?,?,?,?,?,?,?)',
                  (draft_id, request['id'], invoice['id'], invoice['amount'], invoice['supplier_id'], 'DRAFT_ONLY', now()))
        result.update({'draft_id': draft_id, 'invoice_id': invoice['id'], 'payment_sent': False})
    elif action == 'invoice.read':
        result['invoice_id'] = request['resource_id']
    elif action == 'purchase.create':
        result['purchase_order'] = 'PO-SIM-' + identifier()[:8].upper()
    elif action == 'repo.pr.create':
        result['pull_request'] = 'PR-SIM-' + identifier()[:8].upper()
    elif action == 'report.publish':
        result['publication'] = 'INTERNAL-ONLY-SIMULATED'
    elif action == 'contract.send':
        result['delivery'] = 'NOT_SENT_SIMULATED'
    else:
        result['output'] = 'Simulated policy-gated tool response'
    if request['amount'] and request['amount'] > 0:
        c.execute('UPDATE agents SET budget_used=budget_used+?,updated_at=? WHERE id=?',
                  (request['amount'], now(), request['agent_id']))
    return result


def submit_action(c, user, request):
    # Segregation of duties: whoever can change policies (admin) must not also be able to
    # propose actions under them, or a single person could relax a rule and then use it.
    require_role(user, 'operator')
    accepted = {key: request.get(key) for key in ['agent_id', 'action', 'tool_id', 'resource_id', 'recipient', 'amount', 'input_text']}
    accepted['input_text'] = accepted.get('input_text') or ''
    fingerprint = hashlib.sha256(jdump(accepted).encode()).hexdigest()
    key = request.get('idempotency_key') or None
    if key:
        previous = db.one(c,'SELECT * FROM action_requests WHERE proposer_id=? AND idempotency_key=?', (user['id'],key))
        if previous:
            if previous['payload_hash'] != fingerprint:
                raise HTTPException(409, detail='Idempotency key reused for different payload')
            return public_action(previous)
    outcome = policy_decision(c, accepted)
    status = {'ALLOW': 'EXECUTED', 'DENY': 'DENIED', 'REQUIRE_APPROVAL': 'PENDING_APPROVAL'}[outcome['decision']]
    policy = outcome['policy']
    action_id = 'AR-' + identifier().upper()
    timestamp = now()
    new = dict(
        id=action_id, proposer_id=user['id'], agent_id=accepted['agent_id'], action=accepted['action'],
        tool_id=policy['tool_id'] if policy else accepted['tool_id'], resource_id=accepted['resource_id'],
        recipient=accepted['recipient'], amount=float(accepted['amount']) if accepted['amount'] is not None else None,
        input_text=accepted['input_text'], status=status, reason=outcome['reason'],
        guardian_risk=outcome['guardian']['risk'], policy_id=policy['id'] if policy else None,
        policy_version=policy['version'] if policy else None,
        idempotency_key=key, payload_hash=fingerprint,
        approved_by=None, approved_at=None, execution_json=None, created_at=timestamp, updated_at=timestamp,
    )
    if status == 'EXECUTED':
        new['execution_json'] = jdump(execute_sandbox(c, new))
    c.execute('''INSERT INTO action_requests VALUES(
        :id,:proposer_id,:agent_id,:action,:tool_id,:resource_id,:recipient,:amount,:input_text,
        :status,:reason,:guardian_risk,:policy_id,:policy_version,:idempotency_key,:payload_hash,
        :approved_by,:approved_at,:execution_json,:created_at,:updated_at)''',new)
    append_audit(c, 'action.'+status.lower(), user['id'], action_id,
                 {'agent_id': new['agent_id'], 'action': new['action'], 'status': status,
                  'reason': new['reason'], 'guardian': outcome['guardian']})
    return public_action(new)


def public_action(row):
    return {**{k: row.get(k) for k in [
       'id','proposer_id','agent_id','action','tool_id','resource_id','recipient','amount','status',
       'reason','guardian_risk','policy_id','policy_version','approved_by','approved_at','created_at','updated_at']},
       'execution': jload(row.get('execution_json'))}


def approve_action(c, user, action_id, approve, reason=''):
    require_role(user, 'approver')
    row = db.one(c, 'SELECT * FROM action_requests WHERE id=?', (action_id,))
    if not row:
        raise HTTPException(404, detail='Action not found')
    if row['status'] != 'PENDING_APPROVAL':
        raise HTTPException(409, detail='Request is not pending')
    if row['proposer_id'] == user['id']:
        raise HTTPException(403, detail='Requester cannot approve own request')
    status = 'REJECTED' if not approve else 'EXECUTED'
    message = reason[:400] if reason else ('Rejected by independent approver' if not approve else 'Approved and executed in local sandbox')
    execution = None
    if approve:
        policy = db.one(c, 'SELECT * FROM policies WHERE id=?', (row['policy_id'],))
        outcome = policy_decision(c, row)
        if not policy or policy['version'] != row['policy_version']:
            status, message = 'STALE_POLICY', 'Policy changed; resubmit action for fresh approval'
        elif outcome['decision'] == 'DENY':
            status, message = 'DENIED', 'Recheck failed: '+outcome['reason']
        elif outcome['decision'] in ('ALLOW','REQUIRE_APPROVAL'):
            execution = execute_sandbox(c, row)
    timestamp = now()
    c.execute('''UPDATE action_requests SET status=?,reason=?,approved_by=?,approved_at=?,execution_json=?,updated_at=? WHERE id=?''',
              (status,message,user['id'],timestamp,jdump(execution) if execution else None,timestamp,action_id))
    append_audit(c, 'approval.'+status.lower(), user['id'], action_id,
                 {'status':status,'reason':message,'requester':row['proposer_id']})
    return public_action(db.one(c, 'SELECT * FROM action_requests WHERE id=?',(action_id,)))


# Actions that move (simulated) money. A hard cap and a recipient allowlist are mandatory for them.
MONEY_ACTIONS = {'invoice.draft', 'purchase.create'}
EFFECT_STRICTNESS = {'allow': 0, 'approval': 1, 'deny': 2}
POLICY_FIELDS = ('effect', 'max_amount', 'approval_above', 'enabled', 'allowed_recipients')


def _limit(value):
    return None if value is None else Decimal(str(value))


def policy_view(policy):
    """Policy row in API field terms (allowed_recipients as a list, enabled as bool)."""
    return {'effect': policy['effect'], 'max_amount': policy['max_amount'], 'approval_above': policy['approval_above'],
            'enabled': bool(policy['enabled']), 'allowed_recipients': jload(policy['allowed_recipients_json'], [])}


def policy_weakening(current, changes):
    """Return the reasons a change relaxes a control; empty list means the change is neutral or stricter.

    `current` and `changes` use policy_view() field names. Fields equal to the current value are ignored,
    so a UI that always sends the full form does not trigger four-eyes review on its own.
    """
    after = {**current, **changes}
    reasons = []
    if EFFECT_STRICTNESS[after['effect']] < EFFECT_STRICTNESS[current['effect']]:
        reasons.append(f"effect relaxed: {current['effect']} -> {after['effect']}")
    if after['enabled'] and not current['enabled'] and after['effect'] != 'deny':
        reasons.append('policy enabled (grants an allow/approval path)')
    for field in ('max_amount', 'approval_above'):
        old, new = _limit(current[field]), _limit(after[field])
        if old is not None and (new is None or new > old):
            reasons.append(f'{field} relaxed: {current[field]} -> {after[field]}')
    old_r, new_r = set(current['allowed_recipients']), set(after['allowed_recipients'])
    if old_r and not new_r:
        reasons.append('recipient allowlist removed')
    elif new_r - old_r:
        reasons.append('recipients added: ' + ', '.join(sorted(new_r - old_r)))
    return reasons


def validate_policy_result(policy, changes):
    after = {**policy_view(policy), **changes}
    if policy['action'] in MONEY_ACTIONS:
        if after['max_amount'] is None:
            raise HTTPException(422, detail='A hard amount cap is mandatory for money-moving actions')
        if not after['allowed_recipients']:
            raise HTTPException(422, detail='A recipient allowlist is mandatory for money-moving actions')


def _apply_policy_change(c, policy, changes, actor, audit_extra):
    updates, args = [], []
    for field in POLICY_FIELDS:
        if field not in changes:
            continue
        value = changes[field]
        if field == 'enabled':
            value = int(value)
        if field == 'allowed_recipients':
            field, value = 'allowed_recipients_json', jdump(value)
        updates.append(field + '=?')
        args.append(value)
    c.execute('UPDATE policies SET ' + ','.join(updates) + ',version=version+1 WHERE id=? AND version=?',
              (*args, policy['id'], policy['version']))
    new_version = policy['version'] + 1
    append_audit(c, 'policy.updated', actor, policy['id'],
                 {'changes': sorted(changes), 'new_version': new_version, **audit_extra})
    return new_version


def propose_policy_change(c, user, policy_id, changes):
    """Stricter or neutral changes apply at once; relaxing changes wait for an independent approver."""
    require_role(user, 'admin')
    policy = db.one(c, 'SELECT * FROM policies WHERE id=?', (policy_id,))
    if not policy:
        raise HTTPException(404, detail='Policy not found')
    current = policy_view(policy)
    same = lambda f, v: (set(v) == set(current[f]) if f == 'allowed_recipients'
                         else _limit(v) == _limit(current[f]) if f in ('max_amount', 'approval_above')
                         else v == current[f])
    # Keep only real differences, so the approver reviews the actual diff and a re-saved form is a no-op.
    changes = {f: v for f, v in changes.items() if not same(f, v)}
    if not changes:
        return {'ok': True, 'status': 'UNCHANGED', 'id': policy_id, 'new_version': policy['version']}
    validate_policy_result(policy, changes)
    weakening = policy_weakening(current, changes)
    if not weakening:
        version = _apply_policy_change(c, policy, changes, user['id'], {'review': 'not required (stricter or neutral)'})
        return {'ok': True, 'status': 'APPLIED', 'id': policy_id, 'new_version': version}
    change_id = 'PC-' + identifier().upper()
    c.execute('''INSERT INTO policy_changes(id,policy_id,proposer_id,base_version,changes_json,weakening_json,status,created_at)
                 VALUES(?,?,?,?,?,?,?,?)''',
              (change_id, policy_id, user['id'], policy['version'], jdump(changes), jdump(weakening), 'PENDING_APPROVAL', now()))
    append_audit(c, 'policy.change_proposed', user['id'], change_id,
                 {'policy_id': policy_id, 'base_version': policy['version'], 'changes': changes, 'weakening': weakening})
    return {'ok': True, 'status': 'PENDING_APPROVAL', 'id': policy_id, 'change_id': change_id,
            'current_version': policy['version'], 'weakening': weakening}


def public_policy_change(row):
    return {**{k: row[k] for k in ('id', 'policy_id', 'proposer_id', 'base_version', 'status', 'reason',
                                   'decided_by', 'decided_at', 'created_at')},
            'changes': jload(row['changes_json'], {}), 'weakening': jload(row['weakening_json'], [])}


def decide_policy_change(c, user, change_id, approve, reason=''):
    require_role(user, 'approver')
    row = db.one(c, 'SELECT * FROM policy_changes WHERE id=?', (change_id,))
    if not row:
        raise HTTPException(404, detail='Policy change not found')
    if row['status'] != 'PENDING_APPROVAL':
        raise HTTPException(409, detail='Policy change is not pending')
    if row['proposer_id'] == user['id']:
        raise HTTPException(403, detail='Proposer cannot approve own policy change')
    policy = db.one(c, 'SELECT * FROM policies WHERE id=?', (row['policy_id'],))
    changes = jload(row['changes_json'], {})
    if not approve:
        status, message = 'REJECTED', reason[:400] or 'Rejected by independent approver'
    elif not policy or policy['version'] != row['base_version']:
        # The approver reviewed a diff against a version that no longer exists.
        status, message = 'STALE_POLICY', 'Policy changed since proposal; propose again against the current version'
    else:
        validate_policy_result(policy, changes)
        _apply_policy_change(c, policy, changes, user['id'],
                             {'review': 'four-eyes', 'change_id': change_id, 'proposer': row['proposer_id']})
        status, message = 'APPLIED', reason[:400] or 'Approved by independent approver'
    timestamp = now()
    c.execute('UPDATE policy_changes SET status=?,reason=?,decided_by=?,decided_at=? WHERE id=?',
              (status, message, user['id'], timestamp, change_id))
    append_audit(c, 'policy.change_' + status.lower(), user['id'], change_id,
                 {'policy_id': row['policy_id'], 'status': status, 'proposer': row['proposer_id']})
    return public_policy_change(db.one(c, 'SELECT * FROM policy_changes WHERE id=?', (change_id,)))


def make_snapshot(c, user, agent_id, payload):
    agent = db.one(c,'SELECT * FROM agents WHERE id=?',(agent_id,))
    if not agent:
        raise HTTPException(404, detail='Agent not found')
    raw = jdump(payload)
    if len(raw.encode('utf-8')) > 8192:
        raise HTTPException(422, detail='Maximum snapshot state is 8 KiB in this demo')
    next_version = (db.one(c,'SELECT MAX(version) as v FROM snapshots WHERE agent_id=?',(agent_id,))['v'] or 0) + 1
    integrity_tag = tag(jdump([agent_id, next_version, raw]))
    sid = 'SN-' + identifier().upper()
    timestamp = now()
    c.execute('INSERT INTO snapshots VALUES(?,?,?,?,?,?,?)',(sid,agent_id,next_version,raw,integrity_tag,user['id'],timestamp))
    append_audit(c,'memory.snapshot',user['id'],sid,{'agent_id':agent_id,'version':next_version,'integrity_tag':integrity_tag})
    return {'id':sid,'agent_id':agent_id,'version':next_version,'integrity_tag':integrity_tag,
            'valid':True,'created_at':timestamp}


def check_snapshot(row):
    return hmac.compare_digest(row['integrity_tag'],tag(jdump([row['agent_id'],row['version'],row['data_json']])))


def migrate(c, user, agent_id, target_model, requested_permissions):
    agent = db.one(c,'SELECT * FROM agents WHERE id=?',(agent_id,))
    if not agent:
        raise HTTPException(404, detail='Agent not found')
    if agent['status'] != 'active':
        raise HTTPException(409, detail='Stopped agents cannot migrate')
    if db.one(c,"SELECT value FROM settings WHERE key='emergency_stop'")['value'] == '1':
        raise HTTPException(409, detail='Emergency stop blocks migrations')
    old_permissions = set(jload(agent['permissions_json'], []))
    requested = set(requested_permissions)
    if len(requested) != len(requested_permissions):
        raise HTTPException(422, detail='Duplicate scopes are not allowed')
    if not requested.issubset(old_permissions):
        raise HTTPException(422, detail='Privilege escalation blocked: new scopes must be a subset')
    if not requested:
        raise HTTPException(422, detail='Choose at least one retained scope')
    snapshot = db.one(c,'SELECT * FROM snapshots WHERE agent_id=? ORDER BY version DESC LIMIT 1',(agent_id,))
    if snapshot and not check_snapshot(snapshot):
        raise HTTPException(409, detail='Latest memory snapshot integrity verification failed')
    if not snapshot:
        make_snapshot(c, user, agent_id, {'phase':'preflight','note':'Simulated adapter switch; no real LLM state'})
        snapshot = db.one(c,'SELECT * FROM snapshots WHERE agent_id=? ORDER BY version DESC LIMIT 1',(agent_id,))
    mid = 'MG-' + identifier().upper()
    timestamp = now()
    new_permissions = sorted(requested)
    c.execute('''INSERT INTO migrations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)''',
              (mid,agent_id,agent['model'],target_model,jdump(sorted(old_permissions)),jdump(new_permissions),
               agent['budget_used'],agent['budget_used'],snapshot['integrity_tag'],agent['version']+1,user['id'],timestamp))
    c.execute('UPDATE agents SET model=?,permissions_json=?,version=version+1,updated_at=? WHERE id=?',
              (target_model,jdump(new_permissions),timestamp,agent_id))
    append_audit(c,'agent.migration_simulated',user['id'],mid,
                 {'agent_id':agent_id,'old_model':agent['model'],'new_model':target_model,
                  'permissions_before':sorted(old_permissions),'permissions_after':new_permissions,
                  'budget_used_preserved':agent['budget_used'],'snapshot_valid':True})
    return {'id':mid,'agent_id':agent_id,'old_model':agent['model'],'new_model':target_model,
            'permissions_before':sorted(old_permissions),'permissions_after':new_permissions,
            'budget_preserved':agent['budget_used'],'snapshot_integrity':snapshot['integrity_tag'],
            'mode':'SIMULATED_ADAPTER_SWITCH','created_at':timestamp}


WORKFLOWS = [
    {'id':'invoice-review','name':'Controlled invoice processing',
     'description':'Finance intake → reporting review → controlled ERP draft',
     'steps':[('finance-agent','invoice.read'),('report-agent','report.summarize'),('finance-agent','invoice.draft')]},
    {'id':'legal-review','name':'Legal document handoff',
     'description':'Contract review → manual approval → simulated delivery',
     'steps':[('legal-agent','contract.review'),('legal-agent','contract.send')]},
]


def run_workflow(c, user, workflow, resource_id):
    template = next((w for w in WORKFLOWS if w['id']==workflow), None)
    if not template:
        raise HTTPException(404, detail='Workflow not found')
    steps=[]
    for aid, action in template['steps']:
        invoice = db.one(c,'SELECT * FROM invoices WHERE id=?',(resource_id,)) if workflow == 'invoice-review' else None
        request = {'agent_id':aid, 'action':action,'resource_id':resource_id,
                   'recipient':invoice['supplier_id'] if invoice and action=='invoice.draft' else None,
                   'amount':invoice['amount'] if invoice and action=='invoice.draft' else None,
                   'input_text':''}
        result=submit_action(c,user,request)
        steps.append({'agent':aid,'action':action,'status':result['status'],'request_id':result['id'],'reason':result['reason']})
        if result['status'] != 'EXECUTED':
            break
    status = 'WAITING_APPROVAL' if steps[-1]['status']=='PENDING_APPROVAL' else ('BLOCKED' if steps[-1]['status']=='DENIED' else 'COMPLETED')
    wid = 'WF-' + identifier().upper()
    c.execute('INSERT INTO workflow_runs VALUES(?,?,?,?,?,?,?)',
              (wid,workflow,resource_id,status,jdump(steps),user['id'],now()))
    append_audit(c,'workflow.'+status.lower(),user['id'],wid,{'workflow':workflow,'status':status,'steps':steps})
    return {'id':wid,'workflow':workflow,'resource_id':resource_id,'status':status,'steps':steps}

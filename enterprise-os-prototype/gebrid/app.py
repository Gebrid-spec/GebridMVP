"""HTTP API and browser UI for the GEBRID Enterprise OS sandbox prototype."""
import hashlib
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from . import core, db


@asynccontextmanager
async def lifespan(app):
    if os.environ.get('GEBRID_DEMO_MODE','1') != '1':
        raise RuntimeError('This build is intentionally demo-only. Production mode is not available.')
    core.init_key()
    db.init()
    yield


app = FastAPI(title='GEBRID Enterprise OS | Sandbox API', version='0.1.0', lifespan=lifespan,
              description='Non-production multi-agent control plane. All external actions simulated.')
WEB = Path(__file__).resolve().parents[1] / 'frontend'
app.mount('/assets', StaticFiles(directory=WEB), name='assets')


@app.get('/', include_in_schema=False)
def home():
    return FileResponse(WEB / 'index.html')


@app.get('/health')
def health():
    return {'ok': True, 'service': 'GEBRID Enterprise OS', 'mode': 'sandbox', 'production_ready': False}


def current_user(authorization: str | None = Header(None)):
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(401, detail='Authorization: Bearer token required')
    c = db.connect()
    try:
        return core.from_token(c, authorization[7:])
    finally:
        c.close()


class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=150)
    password: str = Field(min_length=1, max_length=150)


class ActionRequest(BaseModel):
    agent_id: str = Field(min_length=2, max_length=100)
    action: str = Field(min_length=3, max_length=120)
    tool_id: str | None = Field(default=None, max_length=120)
    resource_id: str | None = Field(default=None, max_length=120)
    recipient: str | None = Field(default=None, max_length=200)
    amount: float | None = Field(default=None, ge=0, le=1e12, allow_inf_nan=False)
    input_text: str = Field(default='', max_length=8000)
    idempotency_key: str | None = Field(default=None, min_length=8, max_length=120)


class ApprovalRequest(BaseModel):
    approve: bool
    reason: str = Field(default='', max_length=400)


class StatusRequest(BaseModel):
    status: Literal['active','stopped']


class ToolRequest(BaseModel):
    status: Literal['active','disabled','quarantined']


class PolicyPatch(BaseModel):
    effect: Literal['allow','deny','approval'] | None = None
    max_amount: float | None = Field(default=None, ge=0, le=1e12, allow_inf_nan=False)
    approval_above: float | None = Field(default=None, ge=0, le=1e12, allow_inf_nan=False)
    allowed_recipients: list[str] | None = Field(default=None, max_length=40)
    enabled: bool | None = None


class StopRequest(BaseModel):
    enabled: bool


class SnapshotRequest(BaseModel):
    state: dict = Field(default_factory=dict)


class MigrationRequest(BaseModel):
    target_model: str = Field(min_length=3, max_length=120)
    retained_permissions: list[str] = Field(min_length=1, max_length=50)


class WorkflowRequest(BaseModel):
    workflow: str
    resource_id: str = Field(min_length=1, max_length=120)


class GuardianRequest(BaseModel):
    action: str = Field(min_length=3, max_length=120)
    input_text: str = Field(default='', max_length=8000)
    recipient: str | None = None
    amount: float | None = Field(default=None, ge=0, le=1e12, allow_inf_nan=False)


@app.post('/api/auth/login')
def login(body: LoginRequest):
    with db.transaction() as c:
        return core.login(c, body.username, body.password)


@app.post('/api/auth/logout')
def logout(authorization: str | None = Header(None), user=Depends(current_user)):
    with db.transaction() as c:
        c.execute('DELETE FROM sessions WHERE token_hash=?',(hashlib.sha256(authorization[7:].encode()).hexdigest(),))
        core.append_audit(c,'auth.logout',user['id'],user['id'],{})
    return {'ok':True}


@app.get('/api/me')
def me(user=Depends(current_user)):
    return user


@app.get('/api/overview')
def overview(user=Depends(current_user)):
    with db.transaction() as c:
        counters = {
          'agents': db.one(c,'SELECT COUNT(*) as n FROM agents')['n'],
          'active_agents': db.one(c,"SELECT COUNT(*) as n FROM agents WHERE status='active'")['n'],
          'policies': db.one(c,'SELECT COUNT(*) as n FROM policies WHERE enabled=1')['n'],
          'tools_active': db.one(c,"SELECT COUNT(*) as n FROM tools WHERE status='active'")['n'],
          'actions': db.one(c,'SELECT COUNT(*) as n FROM action_requests')['n'],
          'blocked': db.one(c,"SELECT COUNT(*) as n FROM action_requests WHERE status IN ('DENIED','STALE_POLICY')")['n'],
          'pending': db.one(c,"SELECT COUNT(*) as n FROM action_requests WHERE status='PENDING_APPROVAL'")['n'],
          'drafts': db.one(c,'SELECT COUNT(*) as n FROM drafts')['n'],
          'migrations': db.one(c,'SELECT COUNT(*) as n FROM migrations')['n'],
        }
        stop = db.one(c,"SELECT value FROM settings WHERE key='emergency_stop'")['value']=='1'
        events = db.many(c,'SELECT seq,event_type,actor,subject,created_at FROM audit_log ORDER BY seq DESC LIMIT 8')
        actions = [core.public_action(r) for r in db.many(c, 'SELECT * FROM action_requests ORDER BY created_at DESC LIMIT 8')]
        days = [(datetime.now(timezone.utc)-timedelta(days=n)).date().isoformat() for n in reversed(range(7))]
        counts = {r['day']:r for r in db.many(c, '''SELECT substr(created_at,1,10) day,COUNT(*) total,
                         SUM(CASE WHEN status='DENIED' THEN 1 ELSE 0 END) blocked
                         FROM action_requests GROUP BY substr(created_at,1,10)''')}
        timeline = [{'date':date,'total':counts.get(date,{}).get('total',0),
                     'blocked':counts.get(date,{}).get('blocked',0)} for date in days]
        return {'counters':counters,'emergency_stop':stop,'events':events,'recent_actions':actions,
                'timeline':timeline,'mode':'LOCAL_SANDBOX','user':user}


@app.get('/api/agents')
def agents(user=Depends(current_user)):
    with db.transaction() as c:
        items = db.many(c,'SELECT * FROM agents ORDER BY department,name')
        return [{**{k:v for k,v in a.items() if k!='permissions_json'},'permissions':core.jload(a['permissions_json'])} for a in items]


@app.patch('/api/agents/{agent_id}/status')
def set_agent_status(agent_id: str, body: StatusRequest, user=Depends(current_user)):
    core.require_role(user,'admin')
    with db.transaction() as c:
        a=db.one(c,'SELECT * FROM agents WHERE id=?',(agent_id,))
        if not a:
            raise HTTPException(404, detail='Agent not found')
        c.execute('UPDATE agents SET status=?,updated_at=? WHERE id=?',(body.status,core.now(),agent_id))
        core.append_audit(c,'agent.status',user['id'],agent_id,{'before':a['status'],'after':body.status})
    return {'id':agent_id,'status':body.status}


@app.get('/api/policies')
def policies(user=Depends(current_user)):
    with db.transaction() as c:
        items=db.many(c,'SELECT * FROM policies ORDER BY agent_id,action')
        return [{**{k:v for k,v in p.items() if k!='allowed_recipients_json'},'enabled':bool(p['enabled']), 'allowed_recipients':core.jload(p['allowed_recipients_json'])} for p in items]


@app.patch('/api/policies/{policy_id}')
def patch_policy(policy_id: str, body: PolicyPatch, user=Depends(current_user)):
    core.require_role(user,'admin')
    fields = body.model_fields_set
    if not fields:
        raise HTTPException(422, detail='Supply at least one field')
    if body.allowed_recipients is not None and any(not x.strip() or len(x)>120 for x in body.allowed_recipients):
        raise HTTPException(422, detail='Invalid recipient')
    updates=[]; args=[]
    for field in ['effect','max_amount','approval_above','enabled','allowed_recipients']:
        if field in fields:
            val = getattr(body,field)
            if field in ('effect','enabled') and val is None:
                raise HTTPException(422, detail=field+' must not be null')
            if field=='enabled': val = int(val)
            if field=='allowed_recipients':
                if val is None: raise HTTPException(422, detail='Recipients cannot be null')
                val = core.jdump(val)
                field='allowed_recipients_json'
            updates.append(field+'=?')
            args.append(val)
    with db.transaction() as c:
        current=db.one(c,'SELECT * FROM policies WHERE id=?',(policy_id,))
        if not current: raise HTTPException(404,detail='Policy not found')
        c.execute('UPDATE policies SET '+','.join(updates)+',version=version+1 WHERE id=?',(*args,policy_id))
        core.append_audit(c,'policy.updated',user['id'],policy_id,
                          {'changes':sorted(fields),'new_version':current['version']+1})
    return {'ok':True,'id':policy_id,'new_version':current['version']+1}


@app.get('/api/tools')
def tools(user=Depends(current_user)):
    with db.transaction() as c:
        items=db.many(c,'SELECT * FROM tools ORDER BY kind,name')
        return [{**{k:v for k,v in p.items() if k!='allowed_actions_json'},'allowed_actions':core.jload(p['allowed_actions_json'])} for p in items]


@app.patch('/api/tools/{tool_id}')
def set_tool(tool_id: str, body: ToolRequest, user=Depends(current_user)):
    core.require_role(user,'admin')
    with db.transaction() as c:
        t=db.one(c,'SELECT * FROM tools WHERE id=?',(tool_id,))
        if not t: raise HTTPException(404,detail='Tool not found')
        c.execute('UPDATE tools SET status=? WHERE id=?',(body.status,tool_id))
        core.append_audit(c,'tool.admission_changed',user['id'],tool_id,
                          {'from':t['status'],'to':body.status,'warning':'sandbox admission only'})
    return {'id':tool_id,'status':body.status}


@app.get('/api/invoices')
def invoices(user=Depends(current_user)):
    with db.transaction() as c:
        rows=db.many(c,'''SELECT i.*,s.name supplier_name,s.trusted_bank trusted_bank
                          FROM invoices i JOIN suppliers s ON i.supplier_id=s.id ORDER BY i.id''')
        for row in rows:
            row['bank_match']=row['submitted_bank']==row.pop('trusted_bank')
            row['submitted_bank']='••••'+row['submitted_bank'][-5:]
            row['input_warning']=bool(row.pop('input_text'))
        return rows


@app.post('/api/actions/check')
def check_action(body:ActionRequest,user=Depends(current_user)):
    core.require_role(user,'admin','operator')
    with db.transaction() as c:
        outcome=core.policy_decision(c,body.model_dump())
        outcome['policy'] = outcome['policy']['id'] if outcome['policy'] else None
        return outcome


@app.post('/api/actions')
def post_action(body:ActionRequest,user=Depends(current_user)):
    with db.transaction() as c:
        return core.submit_action(c,user,body.model_dump())


@app.post('/api/invoices/{invoice_id}/draft')
def draft_invoice(invoice_id:str,user=Depends(current_user)):
    with db.transaction() as c:
        invoice=db.one(c,'SELECT * FROM invoices WHERE id=?',(invoice_id,))
        if not invoice:raise HTTPException(404,detail='Invoice not found')
        return core.submit_action(c,user,{'agent_id':'finance-agent','action':'invoice.draft',
          'resource_id':invoice_id,'recipient':invoice['supplier_id'],'amount':invoice['amount'],'input_text':''})


@app.get('/api/actions')
def actions(status:str|None=None,limit:int=50,user=Depends(current_user)):
    limit=max(1,min(limit,200))
    with db.transaction() as c:
        if status:
            rows=db.many(c,'SELECT * FROM action_requests WHERE status=? ORDER BY created_at DESC LIMIT ?', (status,limit))
        else:
            rows=db.many(c,'SELECT * FROM action_requests ORDER BY created_at DESC LIMIT ?', (limit,))
        return [core.public_action(row) for row in rows]


@app.post('/api/actions/{action_id}/decision')
def decide(action_id:str,body:ApprovalRequest,user=Depends(current_user)):
    with db.transaction() as c:
        return core.approve_action(c,user,action_id,body.approve,body.reason)


@app.get('/api/drafts')
def drafts(user=Depends(current_user)):
    with db.transaction() as c:
        return db.many(c,'SELECT * FROM drafts ORDER BY created_at DESC LIMIT 100')


@app.post('/api/guardian/assess')
def guardian_assess(body:GuardianRequest,user=Depends(current_user)):
    core.require_role(user,'admin','operator')
    return core.guardian_assess(body.action,body.input_text,body.recipient,core.amount_value(body.amount))


@app.get('/api/memory/{agent_id}')
def snapshots(agent_id:str,user=Depends(current_user)):
    core.require_role(user,'admin','auditor')
    with db.transaction() as c:
        rows=db.many(c,'SELECT * FROM snapshots WHERE agent_id=? ORDER BY version DESC',(agent_id,))
        return [{'id':r['id'],'agent_id':agent_id,'version':r['version'],
                 'integrity_tag':r['integrity_tag'],'valid':core.check_snapshot(r),
                 'created_at':r['created_at'],'created_by':r['created_by']} for r in rows]


@app.post('/api/memory/{agent_id}/snapshot')
def create_snapshot(agent_id:str,body:SnapshotRequest,user=Depends(current_user)):
    core.require_role(user,'admin')
    with db.transaction() as c:
        return core.make_snapshot(c,user,agent_id,body.state)


@app.get('/api/migrations')
def migrations(user=Depends(current_user)):
    with db.transaction() as c:
        return [{**r,'permissions_before':core.jload(r['permissions_before']),
                 'permissions_after':core.jload(r['permissions_after'])} for r in
                db.many(c,'SELECT * FROM migrations ORDER BY created_at DESC LIMIT 100')]


@app.post('/api/agents/{agent_id}/migrate')
def migrate(agent_id:str,body:MigrationRequest,user=Depends(current_user)):
    core.require_role(user,'admin')
    with db.transaction() as c:
        return core.migrate(c,user,agent_id,body.target_model,body.retained_permissions)


@app.get('/api/workflows')
def workflows(user=Depends(current_user)):
    return core.WORKFLOWS


@app.post('/api/workflows/run')
def workflow_run(body:WorkflowRequest,user=Depends(current_user)):
    core.require_role(user,'admin','operator')
    with db.transaction() as c:
        return core.run_workflow(c,user,body.workflow,body.resource_id)


@app.get('/api/workflows/runs')
def workflow_runs(user=Depends(current_user)):
    with db.transaction() as c:
        return [{**{k:v for k,v in r.items() if k!='steps_json'},'steps':core.jload(r['steps_json'])} for r in
                db.many(c,'SELECT * FROM workflow_runs ORDER BY created_at DESC LIMIT 100')]


@app.get('/api/audit')
def audit(limit:int=100,user=Depends(current_user)):
    core.require_role(user,'admin','auditor')
    with db.transaction() as c:
        rows=db.many(c,'SELECT * FROM audit_log ORDER BY seq DESC LIMIT ?', (max(1,min(limit,500)),))
        return [{**{k:v for k,v in r.items() if k!='data_json'},'data':core.jload(r['data_json'])} for r in rows]


@app.get('/api/audit/verify')
def audit_verify(user=Depends(current_user)):
    core.require_role(user,'admin','auditor')
    with db.transaction() as c:
        audit_result=core.verify_audit(c)
        snapshot_rows=db.many(c,'SELECT * FROM snapshots')
        snapshot_valid=all(core.check_snapshot(r) for r in snapshot_rows)
        return {**audit_result,'snapshots_checked':len(snapshot_rows),'snapshots_valid':snapshot_valid,
                'valid':audit_result['valid'] and snapshot_valid}


@app.get('/api/settings')
def settings(user=Depends(current_user)):
    with db.transaction() as c:
        return {'emergency_stop':db.one(c,"SELECT value FROM settings WHERE key='emergency_stop'")['value']=='1',
                'demo_mode':os.environ.get('GEBRID_DEMO_MODE','1')=='1',
                'external_execution_enabled':False,
                'model_calls_enabled':False,
                'audit_externally_anchored':False}


@app.patch('/api/settings/emergency-stop')
def emergency_stop(body:StopRequest,user=Depends(current_user)):
    core.require_role(user,'admin')
    with db.transaction() as c:
        before=db.one(c,"SELECT value FROM settings WHERE key='emergency_stop'")['value']=='1'
        c.execute("UPDATE settings SET value=? WHERE key='emergency_stop'",('1' if body.enabled else '0',))
        core.append_audit(c,'system.emergency_stop_changed',user['id'],'global',
                          {'before':before,'after':body.enabled})
    return {'emergency_stop':body.enabled}

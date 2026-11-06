// Checks that every backend message translates, alone and inside the composite toasts the UI builds.
// Usage: node browser-demo/i18n_check.cjs
const fs = require('fs');
const path = require('path');
const i18n = require('./i18n.js');
const src = fs.readFileSync(path.join(__dirname, 'backend.js'), 'utf8');
const msgs = new Set();
for (const re of [/deny\('([^']+)'/g, /fail\(\d+, '([^']+)'/g, /flags\.push\('([^']+)'/g, /message = '([^']+)'/g]) for (const m of src.matchAll(re)) msgs.add(m[1]);
msgs.delete('Requires one of roles: ');
msgs.delete('Recheck failed: ');   // prefix, covered by the composite form below
const cyr = /[А-Яа-яЁё]/;
let bad = 0;
const expect = (input, out) => { if (!cyr.test(out) || out === input) { bad++; console.log('NOT TRANSLATED:', input, '=>', out); } };
for (const m of msgs) {
  expect(m, i18n.tr(m));
  expect(`INV-1001: DENIED · ${m}`, i18n.tr(`INV-1001: DENIED · ${m}`));
  expect(`DENIED · Recheck failed: ${m}`, i18n.tr(`DENIED · Recheck failed: ${m}`));
  expect(`${m} · AR-0123456789ABCDEF0123`, i18n.tr(`${m} · AR-0123456789ABCDEF0123`));
}
for (const s of ['Requires one of roles: admin, operator', 'Policy change STALE_POLICY · Policy changed since proposal; propose again against the current version',
  'Relaxing change sent for independent approval: approval_above relaxed: 5000 -> 20000; recipients added: SUP-NEW', 'effect relaxed: approval -> allow',
  'Workflow: COMPLETED', 'Signed in as auditor', 'Policy updated to v3; pending approvals will be rechecked', 'MCP admission changed: quarantined',
  'Agent status updated to stopped', 'Simulated migration succeeded; 1 scopes retained', 'Signed snapshot SN-ABC · v2', 'Edit policy: legal-send', 'Save policy v4'])
  expect(s, i18n.tr(s));
console.log(`${msgs.size} backend messages checked in 4 forms each; ${bad} not translated`);
process.exit(bad ? 1 : 0);

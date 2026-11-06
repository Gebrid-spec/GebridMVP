// Builds a single self-contained HTML page: unchanged frontend + in-browser backend (backend.js).
// Usage: node browser-demo/build.cjs <output.html>
const fs = require('fs');
const path = require('path');
const out = process.argv[2];
if (!out) { console.error('usage: node build.cjs <output.html>'); process.exit(2); }
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

let app = read('frontend/app.js');
let css = read('frontend/styles.css');
const backend = read('browser-demo/backend.js');

function rep(src, from, to, expected) {
  const n = src.split(from).length - 1;
  if (n !== expected) throw new Error(`expected ${expected} occurrence(s) of ${JSON.stringify(from).slice(0, 80)}, found ${n}`);
  return src.split(from).join(to);
}
// 1. API calls go to the in-browser backend instead of the network.
app = rep(app, 'res=await fetch(path,', 'res=await GEBRID_FETCH(path,', 1);
// 2. sessionStorage can be blocked inside an embedded page; use a guarded wrapper.
app = rep(app, 'sessionStorage.', 'SAFE_SESSION.', 3);
// 3. claude.ai reserves the #settings hash; the System Settings page is addressed as #system.
app = rep(app, "'#'+route", "'#'+(route==='settings'?'system':route)", 1);
app = rep(app, 'location.hash.slice(1)', 'ROUTE_FROM_HASH()', 2);
// 4. Copy for a browser-only edition, a guided path for first-time viewers, and a reset control.
app = rep(app, '<div class="page-eyebrow">LOCAL SANDBOX / v0.1</div>', '<div class="page-eyebrow">BROWSER SANDBOX / v0.1.1</div>', 1);
app = rep(app, '<div class="hint orange">Demo accounts and synthetic data only. Do not expose this server on a public network or store production secrets.</div>',
  `<div class="tour"><div class="tour-title">Five-minute walkthrough</div><ol>
  <li><b>Agent Operator</b> → Invoice Control Lab → submit all five invoices. One drafts, one waits for approval, three are blocked.</li>
  <li><b>Finance Approver</b> → Approvals → approve INV-1002. Policy, tool and budget are rechecked first.</li>
  <li><b>Security Admin</b> → Agent Firewall → raise the approval threshold. The change waits for the approver; removing the hard cap is refused.</li>
  <li><b>Security Admin</b> → System Settings → emergency stop, then Agent Registry, MCP Shield and Memory &amp; Migration.</li>
  <li><b>Read-only Auditor</b> → Audit Trail → verify the signed event chain.</li></ol></div>
  <div class="hint">Everything runs inside your browser: synthetic data, demo identities, no network calls, no payments, no AI model calls. Your sandbox is private to this browser; use Reset demo to start over.</div>`, 1);
app = rep(app, "${btn('Refresh','refresh','','outline')}", "${btn('Reset demo','reset-demo','','ghost')}${btn('Refresh','refresh','','outline')}", 1);
app = rep(app, "if(action==='refresh'){",
  "if(action==='reset-demo'){if(el.dataset.armed!=='1'){el.dataset.armed='1';el.textContent='Click again to reset';setTimeout(()=>{if(el.isConnected){el.dataset.armed='';el.textContent='Reset demo';}},4000);return;}"
  + "await run(async()=>{GEBRID_RESET();state.data={};await signout(false);notify('Demo data reset to the initial state');});return;}\n  if(action==='refresh'){", 1);
app = rep(app, "<button type=\"submit\" class=\"btn primary full mt24\">Sign in to GEBRID →</button></form>",
  "<button type=\"submit\" class=\"btn primary full mt24\">Sign in to GEBRID →</button></form><button type=\"button\" class=\"btn ghost full mt16\" data-action=\"reset-demo\">Reset demo</button>", 1);

css += `
:root{color-scheme:dark}
html,body{background:var(--bg)}
.tour{margin-top:22px;border:1px solid #345b61;background:#142b32;border-radius:10px;padding:14px 16px;color:#cfe9e5;font-size:12px}
.tour-title{font-size:10px;font-weight:850;letter-spacing:2px;text-transform:uppercase;color:var(--cyan);margin-bottom:6px}
.tour ol{margin:0;padding-left:18px;display:grid;gap:6px}.tour b{color:#e9fffb}
.login-box .hint{margin-top:14px}
:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

const glue = `
(function(){
  var mem={};
  var store={get:function(k){try{var v=window.localStorage.getItem(k);return v===null?(mem[k]||null):v;}catch(e){return mem[k]||null;}},
             set:function(k,v){mem[k]=v;try{window.localStorage.setItem(k,v);}catch(e){}}};
  var backend=window.GebridLocal.createBackend({crypto:window.crypto,storage:store,onError:function(e){console.error(e);}});
  window.GEBRID_FETCH=function(path,init){return backend.fetch(path,init);};
  window.GEBRID_RESET=function(){backend.reset();};
  var smem={};
  window.SAFE_SESSION={getItem:function(k){try{var v=window.sessionStorage.getItem(k);return v===null?(smem[k]||null):v;}catch(e){return smem[k]||null;}},
    setItem:function(k,v){smem[k]=v;try{window.sessionStorage.setItem(k,v);}catch(e){}},
    removeItem:function(k){delete smem[k];try{window.sessionStorage.removeItem(k);}catch(e){}}};
  window.ROUTE_FROM_HASH=function(){var h=(location.hash||'').slice(1);if(h==='system')return 'settings';
    var known=['overview','agents','firewall','guardian','invoices','tools','approvals','workflows','continuity','audit'];return known.indexOf(h)>=0?h:'';};
})();`;

const html = `<title>GEBRID Enterprise OS</title>
<meta name="description" content="Interactive sandbox of GEBRID Enterprise OS v0.1.1: policy-gated AI agent actions, approvals and signed audit, running in the browser.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap">
<style>
${css}
</style>
<div id="app" aria-live="polite"></div>
<div id="toast-region" role="status" aria-live="polite"></div>
<div id="dialog-root"></div>
<script>
${backend}
</script>
<script>${glue}</script>
<script>
${app}
</script>
`;
fs.writeFileSync(out, html);
console.log('wrote', out, html.length, 'bytes');

// Minimal offline JS render smoke test. This is not a browser E2E test.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const els = new Map();
function el(id){if(!els.has(id))els.set(id,{innerHTML:'',addEventListener(){},querySelectorAll(){return []}});return els.get(id);}
const context = vm.createContext({
  document:{getElementById:el,addEventListener(){}},
  sessionStorage:{getItem(){return null},setItem(){},removeItem(){}},
  history:{replaceState(){}},location:{hash:''},window:{scrollTo(){}},
  setTimeout,Intl,Date,console,fetch(){throw Error('Unexpected network')},
});
const code=fs.readFileSync(require('path').join(__dirname,'../frontend/app.js'),'utf8');
vm.runInContext(code,context,{filename:'app.js'});
assert(el('app').innerHTML.includes('Sign in to GEBRID'));
assert(el('app').innerHTML.includes('operator@gebrid.local'));
vm.runInContext(`
 state.user={id:'admin',username:'admin@gebrid.local',role:'admin'};
 state.data={overview:{emergency_stop:false,counters:{agents:2,active_agents:2,policies:2,blocked:0,pending:1},timeline:[],events:[],recent_actions:[]},
 agents:[{id:'finance-agent',name:'Invoice Guardian',department:'Finance',model:'Model A',status:'active',permissions:['invoice.read','invoice.draft'],budget_limit:60000,budget_used:0,version:1,description:'Testing'}],
 policies:[{id:'finance-draft',agent_id:'finance-agent',action:'invoice.draft',effect:'allow',max_amount:25000,approval_above:5000,allowed_recipients:['SUP-ACME'],tool_id:'erp-sandbox',enabled:true,version:1}],
 tools:[{id:'erp-sandbox',name:'ERP Draft Adapter',kind:'Sandbox',status:'active',allowed_actions:['invoice.draft'],description:'synthetic'}],
 invoices:[{id:'INV-1001',supplier_id:'SUP-ACME',supplier_name:'Acme',amount:4200,submitted_bank:'••••00',bank_match:true,input_warning:false,description:'Synthetic'}],
 actions:[],drafts:[],migrations:[],runs:[],audit:[],snapshots:[],workflows:[{id:'invoice-review',name:'Controlled review',description:'Demo',steps:[['finance-agent','invoice.read']]}],settings:{emergency_stop:false}};
 render();`,context);
assert(el('app').innerHTML.includes('Secure execution.'));
for(const route of ['overview','agents','firewall','guardian','invoices','tools','approvals','workflows','continuity','audit','settings']){
 vm.runInContext(`state.route=${JSON.stringify(route)};render();`,context);
 assert(el('app').innerHTML.length>1000, 'Empty route: '+route);
 assert(el('app').innerHTML.includes('<main'), 'Missing shell: '+route);
 console.log('rendered',route,el('app').innerHTML.length,'characters');
}
vm.runInContext(`state.user={id:'finance',username:'finance@gebrid.local',role:'approver'};
 state.data.policyChanges=[{id:'PC-1',policy_id:'finance-draft',proposer_id:'admin',base_version:1,status:'PENDING_APPROVAL',
  changes:{approval_above:20000},weakening:['approval_above relaxed: 5000 -> 20000'],created_at:'2026-11-06T10:00:00Z'}];
 state.route='approvals';render();`,context);
assert(el('app').innerHTML.includes('Policy change queue'), 'Missing policy change queue');
assert(el('app').innerHTML.includes('data-action="policy-approve"'), 'Approver cannot act on policy change');
console.log('UI render smoke: 11 / 11 routes passed + policy change queue');

import { useState, useEffect, useCallback, useRef } from "react";
import { AreaChart, Area, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid, ComposedChart } from "recharts";

// ═══════════════════════════════════════════════════════════════
// GEBRID MVP v2.1 — Investor Demo
// ═══════════════════════════════════════════════════════════════
// ARCHITECTURE (demo vs production):
//   Demo:  Single-file React artifact, Anthropic API proxied by Claude infra
//   Prod:  React SPA → CF Worker gateway → Anthropic API (key in secrets)
//          Risk policies served by risk-engine API, not hardcoded in UI
//          Components split into DashboardShell, RiskPanel, AgentTable, etc.
// ═══════════════════════════════════════════════════════════════

// ═══ MOCK DATA ═══
// PRODUCTION NOTE: All data below comes from APIs in production:
//   GET /api/portfolio → AUM, allocation, agents
//   GET /api/risk/events → live feed from risk-engine
//   GET /api/risk/policies → rules (UI is display-only, decisions in backend)
//   GET /api/gamefi/worlds → metaverse positions & P&L
const PORT_HIST = Array.from({length:30},(_,i)=>({day:i+1,value:Math.round(410000000+Math.sin(i/3)*25000000+i*1300000)}));
const DRAWDOWN = Array.from({length:30},(_,i)=>({day:i+1,dd:-(Math.abs(Math.sin(i/4)*3.8)+Math.random()*1.2).toFixed(2)}));
const MONTHLY_RET = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m,i)=>({month:m,ret:+(Math.sin(i/2)*8+Math.random()*5-2).toFixed(1)}));

const AGENTS = [
  {id:1,name:"GEBRID DCA Engine",strategy:"Institutional Dollar Cost Avg",status:"active",pnl:14.8,aum:125000000,risk:"low",chain:"Ethereum",trades:4280,uptime:"99.9%"},
  {id:2,name:"GEBRID Yield Core",strategy:"Auto-compound DeFi Yield",status:"active",pnl:22.4,aum:98000000,risk:"medium",chain:"Base",trades:2140,uptime:"99.8%"},
  {id:3,name:"GEBRID Treasury OS",strategy:"DAO & Fund Rebalancing",status:"active",pnl:8.6,aum:142000000,risk:"low",chain:"Arbitrum",trades:890,uptime:"100%"},
  {id:4,name:"GEBRID Alpha Momentum",strategy:"Multi-chain Trend Following",status:"active",pnl:31.2,aum:45000000,risk:"high",chain:"Ethereum",trades:6720,uptime:"98.4%"},
  {id:5,name:"GEBRID RWA Bridge",strategy:"Real World Asset Tokenization",status:"active",pnl:6.9,aum:28000000,risk:"low",chain:"Ethereum",trades:124,uptime:"100%"},
  {id:6,name:"GEBRID GameFi Suite",strategy:"On-chain Land & NFT Trading",status:"active",pnl:38.7,aum:12000000,risk:"high",chain:"Polygon",trades:3450,uptime:"99.5%"},
];

const STRATEGIES = [
  {id:1,name:"GEBRID Institutional DCA",desc:"Dollar-cost averaging into BTC/ETH with TWAP execution, slippage protection, and multi-exchange routing",apy:"12-18%",risk:"Low",minAum:"$1M",users:342,tags:["BTC/ETH","TWAP"],type:"accumulation"},
  {id:2,name:"GEBRID Yield Pro",desc:"Auto-compound across Aave, Compound, Lido with risk-adjusted position sizing and yield rotation",apy:"18-35%",risk:"Medium",minAum:"$5M",users:187,tags:["Yield","DeFi"],type:"yield"},
  {id:3,name:"GEBRID Treasury OS",desc:"Automated treasury rebalancing for DAOs, funds, and family offices with compliance workflows",apy:"8-14%",risk:"Low",minAum:"$10M",users:56,tags:["DAO","Fund"],type:"treasury"},
  {id:4,name:"GEBRID RWA Bridge",desc:"Tokenize and bridge real-world asset yields on-chain. T-Bills, corporate bonds, RE. Compliant pipeline",apy:"6-9%",risk:"Low",minAum:"$25M",users:28,tags:["RWA","Bonds"],type:"rwa"},
  {id:5,name:"GEBRID Land Trader",desc:"On-chain agent monitors Sandbox, Decentraland & Otherside marketplace contracts via smart contract interaction",apy:"20-60%",risk:"High",minAum:"$500K",users:891,tags:["Land","On-chain"],type:"gamefi"},
  {id:6,name:"GEBRID GameFi Harvester",desc:"Automated claiming, staking & compounding of P2E protocol rewards. DeFi-layer only, no gameplay automation",apy:"12-30%",risk:"Medium",minAum:"$250K",users:1420,tags:["Yield","P2E"],type:"gamefi"},
  {id:7,name:"GEBRID NFT Sniper",desc:"Monitors mints & secondary markets via on-chain events. Trait-rarity valuation models + instant flip logic",apy:"30-120%",risk:"High",minAum:"$1M",users:567,tags:["NFT","Alpha"],type:"gamefi"},
];

const RISK_EVENTS = [
  {time:"14:32:08",type:"blocked",agent:"GEBRID Alpha",desc:"Transaction exceeds max single-trade limit ($5M). Requires multi-sig approval.",sev:"high"},
  {time:"14:28:45",type:"warning",agent:"GEBRID Yield",desc:"Approaching concentration limit on Aave v3 (78%/80% of $98M position)",sev:"medium"},
  {time:"14:15:22",type:"approved",agent:"GEBRID DCA",desc:"Pre-sign screening passed: Buy 420 ETH @ $3,842 ($1.61M)",sev:"low"},
  {time:"14:10:55",type:"approved",agent:"GEBRID GameFi",desc:"Land purchase approved: Sandbox plot (142,-83) for 12 ETH via marketplace contract",sev:"low"},
  {time:"13:58:11",type:"approved",agent:"GEBRID Treasury",desc:"Rebalance: USDC to USDT rotation $18.4M across 3 chains",sev:"low"},
  {time:"13:42:33",type:"warning",agent:"GEBRID RWA",desc:"T-Bill yield inversion detected: UST-3M < UST-6M. Strategy paused for review.",sev:"medium"},
];

const ALLOC = [{name:"ETH",value:28,color:"#627EEA"},{name:"USDC",value:20,color:"#2775CA"},{name:"BTC",value:18,color:"#F7931A"},{name:"RWA/T-Bills",value:12,color:"#00C853"},{name:"USDT",value:8,color:"#26A17B"},{name:"DeFi LP",value:7,color:"#FF9800"},{name:"GameFi/NFT",value:4,color:"#E040FB"},{name:"Other",value:3,color:"#888"}];

const TX_PIPELINE = [
  {id:1,agent:"GEBRID DCA",action:"Buy 420 ETH (TWAP 4h)",amount:"$1.61M",status:"completed",steps:["Proposed","Screened","Approved","Executed"]},
  {id:2,agent:"GEBRID GameFi",action:"Acquire 8 Sandbox plots (sector 140-160)",amount:"96 ETH",status:"screening",steps:["Proposed","Screening...","",""]},
  {id:3,agent:"GEBRID Yield",action:"Compound Aave + Lido yield",amount:"$2.4M",status:"approved",steps:["Proposed","Screened","Approved","Executing..."]},
  {id:4,agent:"GEBRID Alpha",action:"Sell 120 BTC (momentum exit)",amount:"$11.6M",status:"blocked",steps:["Proposed","Screened","BLOCKED",""]},
  {id:5,agent:"GEBRID RWA",action:"Tokenize T-Bill position",amount:"$8.2M",status:"completed",steps:["Proposed","Screened","Approved","Executed"]},
];

const GAMEFI_WORLDS = [
  {name:"The Sandbox",icon:"\ud83c\udfdc\ufe0f",tier:"production",agents:8,lands:142,value:"1,840 ETH",status:"active",pnl:"+34.2%",activity:"Scouting sectors (140-220) via marketplace API, 12 bids active",how:"On-chain: marketplace smart contract interaction via ethers.js. Floor price monitoring, automated bidding, listing management across 142 plots."},
  {name:"Decentraland",icon:"\ud83c\udf10",tier:"production",agents:5,lands:89,value:"2,410 ETH",status:"active",pnl:"+18.9%",activity:"Listing 28 plots near Genesis Plaza, monitoring 4 districts",how:"On-chain: MANA/LAND contract calls. Price analytics engine scores parcels by proximity, traffic data, and comparable sales."},
  {name:"Otherside",icon:"\ud83e\udd8d",tier:"production",agents:3,lands:24,value:"4,200 ETH",status:"active",pnl:"+52.1%",activity:"Monitoring Koda trait rarity, 6 snipe orders queued",how:"On-chain: OpenSea/Blur API + smart contract sniper. Trait-based valuation model flags underpriced Kodas."},
  {name:"Axie Infinity",icon:"\u2694\ufe0f",tier:"beta",agents:4,lands:0,value:"$842K",status:"active",pnl:"+22.7%",activity:"Auto-claiming SLP/AXS rewards, staking $842K position",how:"DeFi-layer: on-chain reward claiming & staking via Ronin bridge. Gameplay automation in restricted R&D (TOS compliance review)."},
  {name:"Illuvium",icon:"\ud83c\udfae",tier:"beta",agents:2,lands:0,value:"$420K",status:"active",pnl:"+15.3%",activity:"ILV yield farming & staking, revenue pool optimization",how:"DeFi-layer: ILV staking contracts, sILV2 flash pool management. Auto-compound and harvest timing optimization."},
  {name:"Big Time",icon:"\u23f3",tier:"rd",agents:0,lands:0,value:"$210K",status:"paused",pnl:"+8.1%",activity:"R&D: evaluating on-chain asset extraction pipeline",how:"Research phase: mapping on-chain vs. off-chain game economy. Building compliant token extraction framework."},
];

const STAKING_TIERS = [
  {tier:"Free",min:"0",discount:"0%",color:"#888",benefits:["3 agents","1 category","Basic signals"]},
  {tier:"Bronze",min:"1K",discount:"10%",color:"#CD7F32",benefits:["5 agents","Auto-launch","Priority signals"]},
  {tier:"Silver",min:"5K",discount:"20%",color:"#C0C0C0",benefits:["7 agents","API access","Advanced analytics"]},
  {tier:"Gold",min:"25K",discount:"35%",color:"#FFD700",benefits:["10 agents","Multi-chain","DeFi products"]},
  {tier:"Platinum",min:"100K",discount:"50%",color:"#E5E4E2",benefits:["Unlimited agents","White-label","DAO voting","Profit pool"]},
];

const PROPOSALS = [
  {id:1,title:"Increase Staking APY to 18%",status:"active",votes:{f:847200,a:123400},end:"3d 14h",author:"0x7a2...f31"},
  {id:2,title:"Add Otherside to approved metaverses",status:"active",votes:{f:623100,a:89200},end:"5d 2h",author:"0xb4e...a82"},
  {id:3,title:"Reduce platform fee to 0.3%",status:"passed",votes:{f:1240000,a:320000},end:"Ended",author:"0x3c1...d47"},
];

// ═══ HELPERS ═══
const fmt = n => n>=1e9?`$${(n/1e9).toFixed(2)}B`:n>=1e6?`$${(n/1e6).toFixed(1)}M`:n>=1e3?`$${(n/1e3).toFixed(1)}K`:`$${n}`;
const StatusDot = ({s}) => <span style={{width:8,height:8,borderRadius:"50%",display:"inline-block",background:s==="active"?"#A3FF12":s==="paused"?"#FF9800":"#FF5252",marginRight:6}}/>;
const RiskBadge = ({l}) => {const c={low:{bg:"#0d2818",fg:"#A3FF12"},medium:{bg:"#2a1f00",fg:"#FF9800"},high:{bg:"#2a0a0a",fg:"#FF5252"}}[l]||{bg:"#1F2937",fg:"#888"};return <span style={{background:c.bg,color:c.fg,padding:"2px 10px",borderRadius:12,fontSize:11,fontWeight:600,textTransform:"uppercase"}}>{l}</span>};
const Card = ({children,style,onClick}) => <div onClick={onClick} style={{background:"#111827",borderRadius:12,border:"1px solid #1F2937",padding:20,transition:"border-color 0.2s",cursor:onClick?"pointer":"default",...style}} onMouseEnter={e=>{if(onClick)e.currentTarget.style.borderColor="#A3FF12"}} onMouseLeave={e=>{if(onClick)e.currentTarget.style.borderColor="#1F2937"}}>{children}</div>;
const Metric = ({label,value,sub,trend,warn}) => <Card style={{flex:"1 1 170px"}}><div style={{fontSize:11,color:"#888",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>{label}</div><div style={{fontSize:24,fontWeight:700,color:warn?"#FF5252":"#fff",lineHeight:1.2}}>{value}</div>{(sub||trend!==undefined)&&<div style={{display:"flex",alignItems:"center",gap:6,marginTop:4}}>{trend!==undefined&&<span style={{fontSize:12,fontWeight:600,color:trend>=0?"#A3FF12":"#FF5252"}}>{trend>=0?"+":""}{trend}%</span>}{sub&&<span style={{fontSize:11,color:"#666"}}>{sub}</span>}</div>}</Card>;
const SideItem = ({icon,label,active,onClick,badge}) => <div onClick={onClick} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 16px",borderRadius:8,cursor:"pointer",background:active?"#A3FF1215":"transparent",color:active?"#A3FF12":"#888",fontWeight:active?600:400,fontSize:13,transition:"all 0.15s",borderLeft:active?"3px solid #A3FF12":"3px solid transparent"}}><span style={{fontSize:16,width:20,textAlign:"center"}}>{icon}</span><span style={{flex:1}}>{label}</span>{badge&&<span style={{background:badge==="AI"?"#A3FF12":"#E040FB",color:"#000",fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:6}}>{badge}</span>}</div>;
const Btn = ({children,primary,onClick,disabled,style:s}) => <button onClick={onClick} disabled={disabled} style={{padding:"10px 20px",borderRadius:8,border:primary?"none":"1px solid #333",background:primary?(disabled?"#555":"#A3FF12"):"transparent",color:primary?"#000":"#fff",fontSize:13,fontWeight:primary?700:400,cursor:disabled?"wait":"pointer",fontFamily:"inherit",transition:"all 0.15s",...s}}>{children}</button>;

// ═══ DASHBOARD ═══
function DashboardView() {
  return <div>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:20}}>
      <Metric label="Total AUM" value="$450M" trend={12.4} sub="30d"/>
      <Metric label="Active Agents" value="6" sub="all strategies live"/>
      <Metric label="24h P&L" value="+$3.82M" trend={0.85}/>
      <Metric label="Risk Score" value="78/100" sub="institutional"/>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 260px",gap:16,marginBottom:16}}>
      <Card>
        <div style={{fontSize:14,fontWeight:600,marginBottom:12,color:"#fff"}}>Portfolio Value (30d)</div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={PORT_HIST}><defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#A3FF12" stopOpacity={0.3}/><stop offset="95%" stopColor="#A3FF12" stopOpacity={0}/></linearGradient></defs>
            <XAxis dataKey="day" stroke="#333" tick={{fontSize:10,fill:"#666"}} tickLine={false} axisLine={false}/>
            <YAxis stroke="#333" tick={{fontSize:10,fill:"#666"}} tickLine={false} axisLine={false} tickFormatter={v=>`${(v/1e6).toFixed(1)}M`}/>
            <Tooltip contentStyle={{background:"#1a1a2e",border:"1px solid #333",borderRadius:8,fontSize:12}} formatter={v=>[fmt(v),"Value"]}/>
            <Area type="monotone" dataKey="value" stroke="#A3FF12" strokeWidth={2} fill="url(#g1)"/>
          </AreaChart>
        </ResponsiveContainer>
      </Card>
      <Card>
        <div style={{fontSize:14,fontWeight:600,marginBottom:8,color:"#fff"}}>Allocation</div>
        <ResponsiveContainer width="100%" height={140}>
          <PieChart><Pie data={ALLOC} cx="50%" cy="50%" innerRadius={40} outerRadius={62} dataKey="value" stroke="none">{ALLOC.map((e,i)=><Cell key={i} fill={e.color}/>)}</Pie></PieChart>
        </ResponsiveContainer>
        <div style={{display:"flex",flexWrap:"wrap",gap:"3px 10px",justifyContent:"center"}}>
          {ALLOC.map((a,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:4,fontSize:10,color:"#999"}}><div style={{width:7,height:7,borderRadius:2,background:a.color}}/>{a.name} {a.value}%</div>)}
        </div>
      </Card>
    </div>
    <Card>
      <div style={{fontSize:14,fontWeight:600,marginBottom:12,color:"#fff"}}>Active Agents</div>
      <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead><tr style={{borderBottom:"1px solid #1F2937"}}>{["Agent","Strategy","Status","AUM","P&L","Risk","Chain"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"left",color:"#666",fontWeight:500,fontSize:11,textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
        <tbody>{AGENTS.map(a=><tr key={a.id} style={{borderBottom:"1px solid #1F2937"}}>
          <td style={{padding:"9px 10px",fontWeight:600,color:"#fff"}}>{a.name}</td>
          <td style={{padding:"9px 10px",color:"#999"}}>{a.strategy}</td>
          <td style={{padding:"9px 10px"}}><StatusDot s={a.status}/><span style={{color:a.status==="active"?"#A3FF12":"#FF9800",fontSize:12}}>{a.status}</span></td>
          <td style={{padding:"9px 10px",color:"#fff"}}>{fmt(a.aum)}</td>
          <td style={{padding:"9px 10px",color:a.pnl>=0?"#A3FF12":"#FF5252",fontWeight:600}}>{a.pnl>=0?"+":""}{a.pnl}%</td>
          <td style={{padding:"9px 10px"}}><RiskBadge l={a.risk}/></td>
          <td style={{padding:"9px 10px",color:"#999"}}>{a.chain}</td>
        </tr>)}</tbody>
      </table></div>
    </Card>
    {/* GEBRID Strategy Returns */}
    <Card style={{marginTop:16}}>
      <div style={{fontSize:14,fontWeight:600,marginBottom:12,color:"#fff"}}>GEBRID Strategy Trading Returns (YTD)</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:12}}>
        {AGENTS.map(a=><div key={a.id} style={{padding:"14px 16px",borderRadius:8,background:"#0d1520",border:"1px solid #1a2a3a"}}>
          <div style={{fontSize:12,fontWeight:700,color:"#fff",marginBottom:4}}>{a.name}</div>
          <div style={{fontSize:24,fontWeight:800,color:a.pnl>=0?"#A3FF12":"#FF5252",fontFamily:"'JetBrains Mono',monospace"}}>{a.pnl>=0?"+":""}{a.pnl}%</div>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:6}}>
            <span style={{fontSize:11,color:"#666"}}>AUM</span>
            <span style={{fontSize:11,color:"#999",fontWeight:600}}>{fmt(a.aum)}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between"}}>
            <span style={{fontSize:11,color:"#666"}}>Trades</span>
            <span style={{fontSize:11,color:"#999"}}>{a.trades.toLocaleString()}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between"}}>
            <span style={{fontSize:11,color:"#666"}}>Uptime</span>
            <span style={{fontSize:11,color:"#A3FF12"}}>{a.uptime}</span>
          </div>
          <div style={{marginTop:6}}><RiskBadge l={a.risk}/><span style={{fontSize:10,color:"#666",marginLeft:6}}>{a.chain}</span></div>
        </div>)}
      </div>
    </Card>
    {/* Revenue Streams — from Pitch Deck */}
    <Card style={{marginTop:16,background:"#0a0f0a",border:"1px solid #1a3a1a"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div><div style={{fontSize:14,fontWeight:600,color:"#fff"}}>Revenue Streams</div><div style={{fontSize:11,color:"#666"}}>Y3 target from pitch deck</div></div>
        <div style={{padding:"8px 16px",borderRadius:8,border:"1px solid #A3FF1240",background:"#A3FF1210"}}><span style={{fontSize:24,fontWeight:800,color:"#A3FF12",fontFamily:"'JetBrains Mono',monospace"}}>$500M+</span><div style={{fontSize:10,color:"#666",textAlign:"center"}}>Annual (Y3)</div></div>
      </div>
      {[
        {name:"AI Constructor (SaaS)",rev:"$150M+",pct:30,color:"#A3FF12",desc:"Zero-code agent builder, 50+ templates, subscription model"},
        {name:"DePC Contracts & Royalties",rev:"$100M+",pct:20,color:"#FF3388",desc:"Talent launchpad: FORGE→ARENA→LABEL, on-chain royalty splits"},
        {name:"DeFi Platform (2-5%)",rev:"$80M+",pct:16,color:"#00E5FF",desc:"Staking, liquidity pools, RWA tokenization fees"},
        {name:"NFT Marketplace (1.5%)",rev:"$60M+",pct:12,color:"#FF9800",desc:"Trading commissions on GEBRID NFT marketplace"},
        {name:"AI Debit Cards (0.5-1%)",rev:"$50M+",pct:10,color:"#E040FB",desc:"Web3 debit cards, crypto→fiat bridge, booking integration"},
        {name:"GameFi Agents",rev:"$35M+",pct:7,color:"#627EEA",desc:"On-chain land/NFT trading bots, yield harvesting, P2E DeFi layer"},
        {name:"Boost & Premium",rev:"$25M+",pct:5,color:"#2775CA",desc:"Priority execution, advanced analytics, white-label features"},
      ].map((r,i)=><div key={i} style={{marginBottom:10}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{width:8,height:8,borderRadius:2,background:r.color,flexShrink:0}}/>
            <span style={{fontSize:13,fontWeight:600,color:"#fff"}}>{r.name}</span>
          </div>
          <span style={{fontSize:14,fontWeight:700,color:r.color,fontFamily:"'JetBrains Mono',monospace"}}>{r.rev}</span>
        </div>
        <div style={{height:6,borderRadius:3,background:"#1F2937",overflow:"hidden",marginBottom:3}}>
          <div style={{height:"100%",width:`${r.pct}%`,background:r.color,borderRadius:3,transition:"width 0.5s ease"}}/>
        </div>
        <div style={{fontSize:10,color:"#555",marginLeft:16}}>{r.desc}</div>
      </div>)}
    </Card>
  </div>;
}

// ═══ AI AGENT CONSOLE ═══
// PRODUCTION NOTE: Replace AGENT_ENDPOINT with your backend proxy:
// - Demo (Claude artifact): direct Anthropic API (proxied by Anthropic infra, no key needed)
// - Production: POST /api/agent/chat → Cloudflare Worker → Anthropic API
//   Worker handles: API key in secrets, rate limiting, audit logging, tenant isolation
const AGENT_ENDPOINT = "https://api.anthropic.com/v1/messages"; // TODO: "/api/agent/chat" in production
const AGENT_TIMEOUT_MS = 30000;
const AGENT_SYSTEM = `You are GEBRID Agent OS — an AI operating system for institutional on-chain capital management. You orchestrate AI agent swarms managing $450M AUM across DeFi, RWA, GameFi, and treasury strategies.

Portfolio: $450M AUM, 6 GEBRID strategy agents, 4 chains. ETH 28%, USDC 20%, BTC 18%, RWA/T-Bills 12%, USDT 8%, DeFi LP 7%, GameFi/NFT 4%.

GEBRID Strategy Agent Returns:
- GEBRID DCA Engine: $125M AUM, +14.8% YTD, institutional TWAP execution, Ethereum
- GEBRID Yield Core: $98M AUM, +22.4% YTD, auto-compound Aave/Lido/Compound, Base
- GEBRID Treasury OS: $142M AUM, +8.6% YTD, DAO & fund rebalancing, Arbitrum
- GEBRID Alpha Momentum: $45M AUM, +31.2% YTD, multi-chain trend following, Ethereum
- GEBRID RWA Bridge: $28M AUM, +6.9% YTD, T-Bill tokenization pipeline
- GEBRID GameFi Suite: $12M AUM, +38.7% YTD, on-chain land & NFT trading, Polygon

GameFi Three-Layer Stack:
- Layer 1 (PRODUCTION): Sandbox 142 lands (1,840 ETH), Decentraland 89 plots (2,410 ETH), Otherside 24 Kodas (4,200 ETH)
- Layer 2 (BETA): P2E DeFi-layer yield ($842K Axie, $420K Illuvium). No gameplay automation.
- Layer 3 (R&D): Gameplay AI with TOS compliance engine.

Revenue Model (Y3 $500M+ target): AI Constructor SaaS $150M, DePC $100M, DeFi Platform 2-5% $80M, NFT Marketplace $60M, AI Debit Cards $50M, GameFi $35M, Premium $25M.

6-layer security: pre-sign screening, time-locks, least-privilege, sandbox isolation, on-chain audit, anti-pressure protection. ERC-4337 native. Max single trade $5M, multi-sig above $10M.

Be concise, professional, cite specific numbers. 2-3 paragraphs max. Reference $450M scale.`;

function AIConsoleView() {
  const [messages, setMessages] = useState([{role:"assistant",content:"GEBRID Agent OS online. Managing $450M AUM across 6 AI strategy agents — DeFi, RWA, Treasury, Alpha, and GameFi.\n\nTry:\n\u2022 \"Show me strategy returns YTD\"\n\u2022 \"Analyze my $450M portfolio risk\"\n\u2022 \"Revenue projections for Y3\"\n\u2022 \"How are GameFi agents performing?\"\n\u2022 \"Compare DCA vs Yield strategy\""}]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);
  const bottomRef = useRef(null);
  const retryRef = useRef(null);
  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:"smooth"})},[messages]);
  useEffect(()=>()=>{abortRef.current?.abort();clearTimeout(retryRef.current)},[]);

  const sendMessage = async (retryMsg) => {
    const userMsg = retryMsg || input.trim();
    if(!userMsg||loading) return;
    if(!retryMsg) { setInput(""); setMessages(p=>[...p,{role:"user",content:userMsg}]); }
    setLoading(true); setError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(()=>controller.abort(), AGENT_TIMEOUT_MS);
    try {
      const history = messages.filter((_,i)=>i>0).concat([{role:"user",content:userMsg}]).slice(-10);
      const res = await fetch(AGENT_ENDPOINT, {
        method:"POST", headers:{"Content-Type":"application/json"}, signal: controller.signal,
        body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1000, system: AGENT_SYSTEM, messages: history })
      });
      clearTimeout(timeout);
      if(!res.ok) { const errBody = await res.text().catch(()=>""); throw new Error(`API ${res.status}: ${errBody.slice(0,100)}`); }
      const data = await res.json();
      const text = data.content?.map(b=>b.text||"").filter(Boolean).join("\n")||"No response from agent.";
      setMessages(p=>[...p,{role:"assistant",content:text}]);
    } catch(e) {
      clearTimeout(timeout);
      if(e.name==="AbortError") { setError({type:"timeout",msg:"Request timed out (30s). Agent may be under load.",userMsg}); }
      else { setError({type:"error",msg:e.message||"Connection failed",userMsg}); }
      setMessages(p=>[...p,{role:"assistant",content:null,error:true}]);
    }
    setLoading(false);
  };
  const cancelRequest = () => { abortRef.current?.abort(); setLoading(false); };

  return <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 120px)"}}>
    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
      <h2 style={{fontSize:20,fontWeight:700,color:"#fff",margin:0}}>AI Agent Console</h2>
      <span style={{background:error?"#2a0a0a":"#0d2818",color:error?"#FF5252":"#A3FF12",padding:"3px 10px",borderRadius:12,fontSize:11,fontWeight:600}}>{error?"\u25cf ERROR":"\u25cf LIVE AI"}</span>
    </div>
    <Card style={{flex:1,display:"flex",flexDirection:"column",padding:0,overflow:"hidden"}}>
      <div style={{flex:1,overflowY:"auto",padding:20}}>
        {messages.map((m,i)=>{
          if(m.error) return <div key={i} style={{display:"flex",gap:10,marginBottom:16}}>
            <div style={{width:32,height:32,borderRadius:8,background:"#FF525220",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0,color:"#FF5252",fontWeight:700}}>!</div>
            <div style={{maxWidth:"75%"}}>
              <div style={{padding:"12px 16px",borderRadius:12,background:"#1a0a0a",border:"1px solid #FF525240",color:"#FF5252",fontSize:13,lineHeight:1.5,borderBottomLeftRadius:4}}>
                {error?.msg||"Connection error"}<br/>
                <span style={{fontSize:11,color:"#FF525280"}}>Agent network interrupted. Risk controls remain active.</span>
              </div>
              <div style={{display:"flex",gap:8,marginTop:6}}>
                <button onClick={()=>{setMessages(p=>p.filter(m=>!m.error));setError(null);sendMessage(error?.userMsg)}} style={{padding:"4px 12px",borderRadius:6,border:"1px solid #FF5252",background:"transparent",color:"#FF5252",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>Retry</button>
                <button onClick={()=>{setMessages(p=>p.filter(m=>!m.error));setError(null)}} style={{padding:"4px 12px",borderRadius:6,border:"1px solid #333",background:"transparent",color:"#888",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>Dismiss</button>
              </div>
            </div>
          </div>;
          return <div key={i} style={{display:"flex",gap:10,marginBottom:16,justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
            {m.role==="assistant"&&<div style={{width:32,height:32,borderRadius:8,background:"#A3FF1220",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0,color:"#A3FF12",fontWeight:700}}>G</div>}
            <div style={{maxWidth:"75%",padding:"12px 16px",borderRadius:12,background:m.role==="user"?"#A3FF12":"#1a1a2e",color:m.role==="user"?"#000":"#ddd",fontSize:13,lineHeight:1.6,whiteSpace:"pre-wrap",borderBottomRightRadius:m.role==="user"?4:12,borderBottomLeftRadius:m.role==="assistant"?4:12}}>{m.content}</div>
          </div>;
        })}
        {loading&&<div style={{display:"flex",gap:10}}>
          <div style={{width:32,height:32,borderRadius:8,background:"#A3FF1220",display:"flex",alignItems:"center",justifyContent:"center",color:"#A3FF12",fontWeight:700}}>G</div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{padding:"12px 16px",borderRadius:12,background:"#1a1a2e",color:"#888",fontSize:13}}>Analyzing...</div>
            <button onClick={cancelRequest} style={{padding:"4px 10px",borderRadius:6,border:"1px solid #333",background:"transparent",color:"#888",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
          </div>
        </div>}
        <div ref={bottomRef}/>
      </div>
      <div style={{padding:"12px 20px",borderTop:"1px solid #1F2937",display:"flex",gap:8}}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendMessage()} placeholder="Ask your AI agent..." style={{flex:1,padding:"10px 14px",borderRadius:8,border:"1px solid #333",background:"#0A0A0A",color:"#fff",fontSize:14,fontFamily:"inherit",outline:"none"}}/>
        <Btn primary onClick={()=>sendMessage()} disabled={loading}>Send</Btn>
      </div>
    </Card>
  </div>;
}

// ═══ TRANSACTION PIPELINE ═══
function PipelineView() {
  const stepColors = {completed:"#A3FF12",screening:"#FF9800",approved:"#2196F3",blocked:"#FF5252"};
  return <div>
    <div style={{marginBottom:20}}><h2 style={{fontSize:20,fontWeight:700,color:"#fff",margin:0}}>Live Transaction Pipeline</h2><p style={{fontSize:13,color:"#888",margin:"4px 0 0"}}>Real-time pre-sign screening flow</p></div>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:20}}>
      <Metric label="In Pipeline" value="5"/><Metric label="Avg Screening" value="1.2s"/><Metric label="Approval Rate" value="82%"/><Metric label="24h Volume" value="$28.4M" trend={12.4}/>
    </div>
    {TX_PIPELINE.map(tx=><Card key={tx.id} style={{padding:16,marginBottom:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div><span style={{fontWeight:600,color:"#fff",fontSize:14}}>{tx.agent}</span><span style={{color:"#888",fontSize:13,marginLeft:8}}>{"\u2192"} {tx.action}</span></div>
        <div style={{display:"flex",alignItems:"center",gap:8}}><span style={{color:"#A3FF12",fontWeight:600}}>{tx.amount}</span><span style={{padding:"2px 8px",borderRadius:4,fontSize:11,fontWeight:600,textTransform:"uppercase",background:tx.status==="completed"?"#0d2818":tx.status==="blocked"?"#2a0a0a":tx.status==="screening"?"#2a1f00":"#0a1a2a",color:stepColors[tx.status]||"#888"}}>{tx.status}</span></div>
      </div>
      <div style={{display:"flex",gap:4,alignItems:"center"}}>
        {tx.steps.map((step,i)=><React.Fragment key={i}>
          <div style={{flex:1,padding:"8px 12px",borderRadius:6,background:step?(tx.status==="blocked"&&i===2?"#2a0a0a":"#0d1520"):"#0A0A0A",border:`1px solid ${step?(tx.status==="blocked"&&i===2?"#FF5252":"#1F2937"):"#111"}`,textAlign:"center"}}>
            <div style={{fontSize:11,color:step?(tx.status==="blocked"&&i===2?"#FF5252":step.includes("...")?"#FF9800":"#A3FF12"):"#333",fontWeight:step?600:400}}>{step||"\u2014"}</div>
          </div>
          {i<3&&<div style={{color:"#333",fontSize:14}}>{"\u2192"}</div>}
        </React.Fragment>)}
      </div>
    </Card>)}
  </div>;
}

// ═══ MARKETPLACE ═══
function MarketplaceView({onDeploy}) {
  const [filter,setFilter] = useState("all");
  const types = ["all","accumulation","yield","treasury","rwa","gamefi"];
  const filtered = filter==="all"?STRATEGIES:STRATEGIES.filter(s=>s.type===filter);
  return <div>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:12}}>
      <div><h2 style={{fontSize:20,fontWeight:700,color:"#fff",margin:0}}>Strategy Marketplace</h2></div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{types.map(t=><button key={t} onClick={()=>setFilter(t)} style={{padding:"6px 12px",borderRadius:6,border:"none",cursor:"pointer",fontSize:12,fontFamily:"inherit",background:filter===t?"#A3FF12":"#1F2937",color:filter===t?"#000":"#888",textTransform:"capitalize"}}>{t==="gamefi"?"\ud83c\udfae GameFi":t}</button>)}</div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:16}}>
      {filtered.map(s=><Card key={s.id} style={{display:"flex",flexDirection:"column",justifyContent:"space-between"}}>
        <div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><h3 style={{fontSize:15,fontWeight:700,color:"#fff",margin:0}}>{s.name}</h3><RiskBadge l={s.risk.toLowerCase()}/></div>
          <p style={{fontSize:12,color:"#999",lineHeight:1.5,margin:"0 0 10px"}}>{s.desc}</p>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>{s.tags.map(t=><span key={t} style={{background:s.type==="gamefi"?"#2a1a30":"#1a2332",color:s.type==="gamefi"?"#E040FB":"#5BA3E6",padding:"2px 8px",borderRadius:4,fontSize:10}}>{t}</span>)}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
            <div><div style={{fontSize:10,color:"#666"}}>APY</div><div style={{fontSize:14,fontWeight:700,color:"#A3FF12"}}>{s.apy}</div></div>
            <div><div style={{fontSize:10,color:"#666"}}>MIN</div><div style={{fontSize:13,fontWeight:600,color:"#fff"}}>{s.minAum}</div></div>
            <div><div style={{fontSize:10,color:"#666"}}>USERS</div><div style={{fontSize:13,fontWeight:600,color:"#fff"}}>{s.users}</div></div>
          </div>
        </div>
        <Btn primary onClick={()=>onDeploy(s)} style={{width:"100%"}}>Deploy Agent</Btn>
      </Card>)}
    </div>
  </div>;
}

// ═══ RISK MONITOR ═══
// PRODUCTION NOTE: Policy rules fetched from GET /api/risk/policies
// UI is display-only; all screening decisions made by risk-engine backend
function RiskView() {
  const icons = {blocked:"\u26d4",warning:"\u26a0\ufe0f",approved:"\u2705"};
  const sevC = {high:"#FF5252",medium:"#FF9800",low:"#A3FF12"};
  return <div>
    <h2 style={{fontSize:20,fontWeight:700,color:"#fff",margin:"0 0 20px"}}>Risk Authority Monitor</h2>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:20}}>
      <Metric label="Screened (24h)" value="1,247"/><Metric label="Blocked" value="3" warn/><Metric label="Warnings" value="12"/><Metric label="Approval" value="99.4%"/>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:16}}>
      <Card>
        <div style={{fontSize:14,fontWeight:600,marginBottom:14,color:"#fff"}}>Live Event Feed</div>
        {RISK_EVENTS.map((e,i)=><div key={i} style={{display:"flex",gap:10,padding:"10px 0",borderBottom:i<RISK_EVENTS.length-1?"1px solid #1F2937":"none"}}>
          <span style={{fontSize:16}}>{icons[e.type]}</span>
          <div style={{flex:1}}><div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:13,fontWeight:600,color:"#fff"}}>{e.agent}</span><span style={{fontSize:11,color:"#666",fontFamily:"monospace"}}>{e.time}</span></div><p style={{fontSize:12,color:"#999",margin:"2px 0 0"}}>{e.desc}</p></div>
          <span style={{width:8,height:8,borderRadius:"50%",background:sevC[e.sev],marginTop:4,flexShrink:0}}/>
        </div>)}
      </Card>
      <div style={{display:"flex",flexDirection:"column",gap:16}}>
        <Card>
          <div style={{fontSize:14,fontWeight:600,marginBottom:10,color:"#fff"}}>Policy Rules</div>
          {[["Max Trade","$50,000"],["Daily Vol","$500,000"],["Concentration","80%"],["Drawdown","-5%/24h"],["Protocols","12 listed"],["Slippage","0.5%"],["Land Max Bid","5 ETH"],["P2E Limit","200 battles"]].map(([k,v],i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #1F2937",fontSize:12}}><span style={{color:"#999"}}>{k}</span><span style={{color:"#A3FF12",fontWeight:600,fontFamily:"monospace"}}>{v}</span></div>)}
        </Card>
        <Card style={{background:"#0d1a0d",border:"1px solid #1a3a1a"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}><span style={{width:10,height:10,borderRadius:"50%",background:"#A3FF12",boxShadow:"0 0 8px #A3FF12"}}/><span style={{fontSize:13,fontWeight:600,color:"#A3FF12"}}>Protection Active</span></div>
          <p style={{fontSize:12,color:"#8a8",margin:0}}>All transactions pass institutional-grade pre-sign screening including GameFi land purchases.</p>
        </Card>
      </div>
    </div>
  </div>;
}

// ═══ ANALYTICS ═══
function AnalyticsView() {
  return <div>
    <h2 style={{fontSize:20,fontWeight:700,color:"#fff",margin:"0 0 20px"}}>Analytics & Performance</h2>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:20}}>
      <Metric label="Sharpe Ratio" value="2.14" sub="annualized"/><Metric label="Max Drawdown" value="-4.8%" sub="30d"/><Metric label="Win Rate" value="76.2%"/><Metric label="Total Return" value="+18.4%" trend={18.4}/>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
      <Card>
        <div style={{fontSize:14,fontWeight:600,marginBottom:12,color:"#fff"}}>Monthly Returns</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={MONTHLY_RET}><CartesianGrid strokeDasharray="3 3" stroke="#1F2937"/>
            <XAxis dataKey="month" stroke="#333" tick={{fontSize:10,fill:"#666"}} tickLine={false}/>
            <YAxis stroke="#333" tick={{fontSize:10,fill:"#666"}} tickLine={false} tickFormatter={v=>`${v}%`}/>
            <Tooltip contentStyle={{background:"#1a1a2e",border:"1px solid #333",borderRadius:8,fontSize:12}} formatter={v=>[`${v}%`,"Return"]}/>
            <Bar dataKey="ret" radius={[4,4,0,0]}>{MONTHLY_RET.map((e,i)=><Cell key={i} fill={e.ret>=0?"#A3FF12":"#FF5252"}/>)}</Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <Card>
        <div style={{fontSize:14,fontWeight:600,marginBottom:12,color:"#fff"}}>Drawdown Analysis</div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={DRAWDOWN}><defs><linearGradient id="gdd" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#FF5252" stopOpacity={0.3}/><stop offset="95%" stopColor="#FF5252" stopOpacity={0}/></linearGradient></defs>
            <XAxis dataKey="day" stroke="#333" tick={{fontSize:10,fill:"#666"}} tickLine={false}/>
            <YAxis stroke="#333" tick={{fontSize:10,fill:"#666"}} tickLine={false} tickFormatter={v=>`${v}%`}/>
            <Tooltip contentStyle={{background:"#1a1a2e",border:"1px solid #333",borderRadius:8,fontSize:12}}/>
            <Area type="monotone" dataKey="dd" stroke="#FF5252" strokeWidth={2} fill="url(#gdd)"/>
          </AreaChart>
        </ResponsiveContainer>
      </Card>
    </div>
    <Card>
      <div style={{fontSize:14,fontWeight:600,marginBottom:12,color:"#fff"}}>Agent Performance Attribution</div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead><tr style={{borderBottom:"1px solid #1F2937"}}>{["Agent","Return","Sharpe","Win Rate","Max DD","Weight"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"left",color:"#666",fontSize:11,textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
        <tbody>{AGENTS.map(a=><tr key={a.id} style={{borderBottom:"1px solid #1F2937"}}>
          <td style={{padding:"9px 10px",fontWeight:600,color:"#fff"}}>{a.name}</td>
          <td style={{padding:"9px 10px",color:a.pnl>=0?"#A3FF12":"#FF5252",fontWeight:600}}>{a.pnl>=0?"+":""}{a.pnl}%</td>
          <td style={{padding:"9px 10px",color:"#fff"}}>{(1.2+a.pnl/10).toFixed(2)}</td>
          <td style={{padding:"9px 10px",color:"#fff"}}>{(60+a.pnl*1.1).toFixed(1)}%</td>
          <td style={{padding:"9px 10px",color:"#FF5252"}}>-{(2+Math.abs(a.pnl)*0.3).toFixed(1)}%</td>
          <td style={{padding:"9px 10px",color:"#A3FF12"}}>{(a.aum/28500).toFixed(1)}%</td>
        </tr>)}</tbody>
      </table>
    </Card>
  </div>;
}

// ═══ GAMEFI / METAVERSE ═══
function GameFiView() {
  const [expanded, setExpanded] = useState(null);
  const tierInfo = {production:{label:"PRODUCTION",color:"#A3FF12",bg:"#0d2818",desc:"Fully on-chain. Smart contract interaction via ethers.js. No TOS risk."},beta:{label:"BETA",color:"#FF9800",bg:"#2a1f00",desc:"DeFi-layer automation (claiming, staking). No gameplay bots."},rd:{label:"R&D",color:"#5BA3E6",bg:"#0a1a2a",desc:"Research phase. Mapping on-chain extractable value."}};
  return <div>
    <div style={{marginBottom:20}}><h2 style={{fontSize:20,fontWeight:700,color:"#fff",margin:0}}>{"\ud83c\udfae"} GameFi & Metaverse Agents</h2><p style={{fontSize:13,color:"#888",margin:"4px 0 0"}}>Autonomous on-chain agents for virtual world asset management</p></div>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:16}}>
      <Metric label="Worlds Active" value="5" sub="of 6 integrated"/><Metric label="Land Value" value="8,450 ETH" trend={28.4}/><Metric label="DeFi Yield (24h)" value="$84.7K" trend={11.2}/><Metric label="On-chain Agents" value="22" sub="autonomous"/>
    </div>
    <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
      {Object.entries(tierInfo).map(([k,v])=><div key={k} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",borderRadius:6,background:v.bg,border:`1px solid ${v.color}30`}}><span style={{width:8,height:8,borderRadius:"50%",background:v.color}}/><span style={{fontSize:11,fontWeight:600,color:v.color}}>{v.label}</span><span style={{fontSize:11,color:"#888"}}>{v.desc}</span></div>)}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:16,marginBottom:16}}>
      {GAMEFI_WORLDS.map((w,i)=>{const t=tierInfo[w.tier];return <Card key={i} onClick={()=>setExpanded(expanded===i?null:i)}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:28}}>{w.icon}</span><div><div style={{fontSize:15,fontWeight:700,color:"#fff"}}>{w.name}</div><div style={{fontSize:11,color:"#888"}}>{w.agents} agent{w.agents!==1?"s":""}</div></div></div>
          <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:700,background:t.bg,color:t.color,border:`1px solid ${t.color}40`}}>{t.label}</span><StatusDot s={w.status}/></div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
          <div><div style={{fontSize:10,color:"#666"}}>VALUE</div><div style={{fontSize:13,fontWeight:700,color:"#fff"}}>{w.value}</div></div>
          <div><div style={{fontSize:10,color:"#666"}}>LANDS</div><div style={{fontSize:13,fontWeight:700,color:"#fff"}}>{w.lands||"\u2014"}</div></div>
          <div><div style={{fontSize:10,color:"#666"}}>P&L</div><div style={{fontSize:13,fontWeight:700,color:"#A3FF12"}}>{w.pnl}</div></div>
        </div>
        <div style={{padding:"8px 10px",borderRadius:6,background:"#0d1520",border:"1px solid #1F2937",marginBottom:expanded===i?10:0}}><div style={{fontSize:10,color:"#666",marginBottom:2}}>CURRENT ACTIVITY</div><div style={{fontSize:12,color:"#E040FB"}}>{w.activity}</div></div>
        {expanded===i&&<div style={{padding:"10px 12px",borderRadius:6,background:"#0A0A0A",border:`1px solid ${t.color}30`}}><div style={{fontSize:10,color:t.color,fontWeight:600,marginBottom:4}}>HOW IT WORKS</div><div style={{fontSize:12,color:"#ccc",lineHeight:1.5}}>{w.how}</div></div>}
      </Card>})}
    </div>
    <Card>
      <div style={{fontSize:14,fontWeight:600,marginBottom:12,color:"#fff"}}>Recent On-Chain Transactions</div>
      {[
        {time:"14:10",world:"\ud83c\udfdc\ufe0f Sandbox",action:"Purchased land (142,-83) via marketplace contract",amount:"-1.2 ETH",pnl:"\u2014",s:"done",tier:"production"},
        {time:"13:45",world:"\ud83c\udf10 Decentraland",action:"Sold land (-22,55) on secondary market",amount:"+2.8 ETH",pnl:"+0.9 ETH",s:"done",tier:"production"},
        {time:"13:20",world:"\u2694\ufe0f Axie",action:"Claimed SLP rewards from Ronin staking",amount:"+340 SLP",pnl:"+$12.40",s:"done",tier:"beta"},
        {time:"12:55",world:"\ud83e\udd8d Otherside",action:"Bid on Koda #4281 via Blur",amount:"12.5 ETH",pnl:"\u2014",s:"pending",tier:"production"},
        {time:"12:30",world:"\ud83c\udfae Illuvium",action:"Harvested ILV from staking pool",amount:"+4.2 ILV",pnl:"+$180",s:"done",tier:"beta"},
        {time:"11:45",world:"\ud83c\udfdc\ufe0f Sandbox",action:"Listed land (88,-44) at 2.0 ETH ask",amount:"2.0 ETH ask",pnl:"\u2014",s:"active",tier:"production"},
      ].map((tx,i)=>{const tc=tierInfo[tx.tier];return <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid #1F2937",fontSize:12,alignItems:"center",flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",gap:8,alignItems:"center"}}><span style={{color:"#666",fontFamily:"monospace",width:38}}>{tx.time}</span><span>{tx.world}</span><span style={{color:"#fff",fontWeight:500}}>{tx.action}</span><span style={{fontSize:9,padding:"1px 5px",borderRadius:3,background:tc.bg,color:tc.color,fontWeight:600}}>{tc.label}</span></div>
        <div style={{display:"flex",gap:12,alignItems:"center"}}><span style={{color:tx.amount.startsWith("+")?"#A3FF12":tx.amount.startsWith("-")?"#FF5252":"#fff",fontWeight:600}}>{tx.amount}</span>{tx.pnl!=="\u2014"&&<span style={{color:"#A3FF12",fontSize:11}}>{tx.pnl}</span>}<span style={{padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:600,background:tx.s==="done"?"#0d2818":tx.s==="pending"?"#2a1f00":"#0a1a2a",color:tx.s==="done"?"#A3FF12":tx.s==="pending"?"#FF9800":"#5BA3E6"}}>{tx.s}</span></div>
      </div>})}
    </Card>
    <Card style={{marginTop:16,background:"#0d1520",border:"1px solid #1a2a3a"}}>
      <div style={{fontSize:14,fontWeight:600,marginBottom:8,color:"#fff"}}>Architecture: Three-Layer GameFi Stack</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
        {[
          {n:"Layer 1: On-Chain Assets",c:"#A3FF12",items:["NFT/Land buy & sell","Marketplace sniping","Floor price monitoring","Automated bidding"],status:"Production"},
          {n:"Layer 2: DeFi Extraction",c:"#FF9800",items:["Reward claiming","Staking optimization","Auto-compounding","Token bridge management"],status:"Beta"},
          {n:"Layer 3: Gameplay AI",c:"#5BA3E6",items:["Battle automation","Quest completion","Resource farming","TOS compliance engine"],status:"R&D / Roadmap"},
        ].map((l,i)=><div key={i} style={{padding:12,borderRadius:8,background:"#111827",border:`1px solid ${l.c}30`}}>
          <div style={{fontSize:12,fontWeight:700,color:l.c,marginBottom:6}}>{l.n}</div>
          {l.items.map((item,j)=><div key={j} style={{fontSize:11,color:"#999",padding:"2px 0",display:"flex",alignItems:"center",gap:6}}><span style={{color:l.c,fontSize:8}}>{"\u25cf"}</span>{item}</div>)}
          <div style={{marginTop:8,fontSize:10,fontWeight:600,color:l.c,padding:"2px 8px",borderRadius:4,background:`${l.c}15`,display:"inline-block"}}>{l.status}</div>
        </div>)}
      </div>
    </Card>
  </div>;
}

// ═══ STAKING & GOVERNANCE ═══
function StakingView() {
  const [stakeAmt, setStakeAmt] = useState("100000");
  const [lockDays, setLockDays] = useState(90);
  const tier = Number(stakeAmt)>=100000?"Platinum":Number(stakeAmt)>=25000?"Gold":Number(stakeAmt)>=5000?"Silver":Number(stakeAmt)>=1000?"Bronze":"Free";
  const apy = lockDays>=365?22:lockDays>=180?18:lockDays>=90?15:12;
  return <div>
    <h2 style={{fontSize:20,fontWeight:700,color:"#fff",margin:"0 0 20px"}}>$GEBRID Staking & Governance</h2>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:20}}>
      <Metric label="Total Staked" value="423M" sub="$GEBRID (42.3%)"/><Metric label="APY" value={`${apy}%`}/><Metric label="Your Stake" value="100K"/><Metric label="Tier" value={tier}/>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
      <Card>
        <div style={{fontSize:14,fontWeight:600,marginBottom:14,color:"#fff"}}>Stake $GEBRID</div>
        <div style={{marginBottom:14}}><label style={{fontSize:12,color:"#888",display:"block",marginBottom:6}}>Amount</label><input type="number" value={stakeAmt} onChange={e=>setStakeAmt(e.target.value)} style={{width:"100%",padding:"10px 14px",borderRadius:8,border:"1px solid #333",background:"#0A0A0A",color:"#fff",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/></div>
        <div style={{marginBottom:14}}><label style={{fontSize:12,color:"#888",display:"block",marginBottom:6}}>Lock: {lockDays}d</label><div style={{display:"flex",gap:8}}>{[30,90,180,365].map(d=><button key={d} onClick={()=>setLockDays(d)} style={{flex:1,padding:"8px",borderRadius:6,border:lockDays===d?"1px solid #A3FF12":"1px solid #333",background:lockDays===d?"#A3FF1215":"#0A0A0A",color:lockDays===d?"#A3FF12":"#888",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>{d}d</button>)}</div></div>
        <div style={{background:"#0d1520",borderRadius:8,padding:12,marginBottom:14}}>
          {[["APY",`${apy}%`],["Annual Reward",`${(Number(stakeAmt)*apy/100).toLocaleString()} $GEBRID`],["Tier",tier]].map(([k,v],i)=><div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:i<2?6:0}}><span style={{color:"#888"}}>{k}</span><span style={{color:i===2?"#FFD700":"#A3FF12",fontWeight:600}}>{v}</span></div>)}
        </div>
        <Btn primary style={{width:"100%"}}>Stake $GEBRID</Btn>
      </Card>
      <Card>
        <div style={{fontSize:14,fontWeight:600,marginBottom:14,color:"#fff"}}>Tier Benefits</div>
        {STAKING_TIERS.map((t,i)=><div key={i} style={{padding:"10px 12px",borderRadius:8,marginBottom:8,background:tier===t.tier?"#111":"#0A0A0A",border:tier===t.tier?`1px solid ${t.color}`:"1px solid #1F2937"}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontWeight:700,color:t.color,fontSize:14}}>{t.tier}</span><span style={{fontSize:12,color:"#888"}}>{t.min}+ $GEBRID</span></div>
          <div style={{fontSize:12,color:"#999"}}>Fee discount: {t.discount}</div>
          <div style={{fontSize:11,color:"#666",marginTop:4}}>{t.benefits.join(" \u00b7 ")}</div>
        </div>)}
      </Card>
    </div>
    <Card>
      <div style={{fontSize:14,fontWeight:600,marginBottom:14,color:"#fff"}}>Governance Proposals</div>
      {PROPOSALS.map(p=>{const total=p.votes.f+p.votes.a;const pct=((p.votes.f/total)*100).toFixed(1);
        return <div key={p.id} style={{padding:"14px 0",borderBottom:"1px solid #1F2937"}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:8,flexWrap:"wrap",gap:8}}>
            <div><div style={{fontSize:14,fontWeight:600,color:"#fff"}}>{p.title}</div><div style={{fontSize:11,color:"#666"}}>by {p.author}</div></div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}><span style={{padding:"2px 8px",borderRadius:4,fontSize:11,fontWeight:600,background:p.status==="active"?"#0d2818":"#1F2937",color:p.status==="active"?"#A3FF12":"#888"}}>{p.status}</span><span style={{fontSize:11,color:"#666"}}>{p.end}</span></div>
          </div>
          <div style={{background:"#0A0A0A",borderRadius:6,height:8,overflow:"hidden",marginBottom:6}}><div style={{width:`${pct}%`,height:"100%",background:"#A3FF12",borderRadius:6}}/></div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}><span style={{color:"#A3FF12"}}>For: {(p.votes.f/1e6).toFixed(2)}M ({pct}%)</span><span style={{color:"#FF5252"}}>Against: {(p.votes.a/1e6).toFixed(2)}M</span></div>
          {p.status==="active"&&<div style={{display:"flex",gap:8,marginTop:10}}><Btn primary style={{flex:1,padding:8}}>Vote For</Btn><Btn style={{flex:1,padding:8}}>Vote Against</Btn></div>}
        </div>})}
    </Card>
  </div>;
}

// ═══ AGENT BUILDER ═══
function BuilderView({strategy,onBack}) {
  const [step,setStep]=useState(1);const [deploying,setDeploying]=useState(false);const [deployed,setDeployed]=useState(false);
  const [cfg,setCfg]=useState({name:strategy?`${strategy.name} Agent`:"My Agent",aum:"100000",chain:"ethereum",maxTrade:"50000",stopLoss:"5"});
  const handleDeploy=()=>{setDeploying(true);setTimeout(()=>{setDeploying(false);setDeployed(true)},2500)};
  if(deployed) return <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:400,gap:16}}>
    <div style={{fontSize:48}}>{"\u2705"}</div><h2 style={{fontSize:24,fontWeight:700,color:"#A3FF12",margin:0}}>Agent Deployed</h2>
    <p style={{fontSize:14,color:"#888"}}>{cfg.name} is live on {cfg.chain} testnet</p>
    <div style={{display:"flex",gap:12}}><Btn onClick={()=>{setDeployed(false);setStep(1);onBack()}}>Dashboard</Btn><Btn primary onClick={()=>{setDeployed(false);setStep(1)}}>Deploy Another</Btn></div>
  </div>;
  const Inp=({label,field,type,suffix})=><div style={{marginBottom:14}}><label style={{fontSize:12,color:"#888",display:"block",marginBottom:6}}>{label}</label><div style={{position:"relative"}}><input type={type||"text"} value={cfg[field]} onChange={e=>setCfg(p=>({...p,[field]:e.target.value}))} style={{width:"100%",padding:"10px 14px",paddingRight:suffix?50:14,borderRadius:8,border:"1px solid #333",background:"#0A0A0A",color:"#fff",fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>{suffix&&<span style={{position:"absolute",right:14,top:"50%",transform:"translateY(-50%)",color:"#666",fontSize:12}}>{suffix}</span>}</div></div>;
  return <div>
    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>{strategy&&<Btn onClick={onBack}>{"\u2190"} Back</Btn>}<h2 style={{fontSize:20,fontWeight:700,color:"#fff",margin:0}}>Agent Builder</h2></div>
    <div style={{display:"flex",gap:8,marginBottom:24}}>{["Configure","Risk","Deploy"].map((s,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer"}} onClick={()=>setStep(i+1)}><div style={{width:26,height:26,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,background:step>i?"#A3FF12":step===i+1?"#A3FF1230":"#1F2937",color:step>i?"#000":step===i+1?"#A3FF12":"#666"}}>{i+1}</div><span style={{fontSize:13,color:step===i+1?"#fff":"#666"}}>{s}</span>{i<2&&<div style={{width:30,height:1,background:step>i+1?"#A3FF12":"#333",margin:"0 4px"}}/>}</div>)}</div>
    <Card style={{maxWidth:560}}>
      {step===1&&<div><Inp label="Agent Name" field="name"/><Inp label="Capital" field="aum" type="number" suffix="USDC"/><div style={{marginBottom:14}}><label style={{fontSize:12,color:"#888",display:"block",marginBottom:6}}>Network</label><div style={{display:"flex",gap:8}}>{["ethereum","base","arbitrum","polygon"].map(c=><button key={c} onClick={()=>setCfg(p=>({...p,chain:c}))} style={{flex:1,padding:"8px",borderRadius:6,border:cfg.chain===c?"1px solid #A3FF12":"1px solid #333",background:cfg.chain===c?"#A3FF1215":"#0A0A0A",color:cfg.chain===c?"#A3FF12":"#888",fontSize:12,cursor:"pointer",fontFamily:"inherit",textTransform:"capitalize"}}>{c}</button>)}</div></div><Btn primary onClick={()=>setStep(2)} style={{width:"100%"}}>Next</Btn></div>}
      {step===2&&<div><Inp label="Max Trade" field="maxTrade" type="number" suffix="USDC"/><Inp label="Stop Loss" field="stopLoss" type="number" suffix="%"/><div style={{display:"flex",gap:8}}><Btn onClick={()=>setStep(1)} style={{flex:1}}>Back</Btn><Btn primary onClick={()=>setStep(3)} style={{flex:2}}>Review</Btn></div></div>}
      {step===3&&<div>{[["Agent",cfg.name],["Capital",`${Number(cfg.aum).toLocaleString()} USDC`],["Network",cfg.chain],["Max Trade",`$${Number(cfg.maxTrade).toLocaleString()}`],["Stop Loss",`${cfg.stopLoss}%`],["Protection","ON"]].map(([k,v],i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #1F2937",fontSize:13}}><span style={{color:"#888"}}>{k}</span><span style={{color:"#fff"}}>{v}</span></div>)}<div style={{display:"flex",gap:8,marginTop:18}}><Btn onClick={()=>setStep(2)} style={{flex:1}}>Back</Btn><Btn primary onClick={handleDeploy} disabled={deploying} style={{flex:2}}>{deploying?"Deploying...":"\u26a1 Deploy"}</Btn></div></div>}
    </Card>
  </div>;
}

// ═══ GUARD AGENTS — INTERACTIVE SIMULATORS ═══
const TEST_TXS = [
  {id:"approve",name:"UNLIMITED APPROVE",fn:"approve(spender, MaxUint256)",risk:92,verdict:"BLOCKED",label:"UNLIMITED APPROVE",
    flags:["UNLIMITED_APPROVAL: MaxUint256 detected","AUTO-BLOCK: rule-001 triggered","DRAIN_RISK: spender unverified"],
    detail:"Unlimited ERC-20 approval (MaxUint256) \u2014 AUTO-BLOCK. Spender has no verified contract. This approval pattern is used in 94% of approval phishing attacks.",
    detailColor:"#FF5252"},
  {id:"setApproval",name:"SET APPROVAL FOR ALL",fn:"setApprovalForAll(operator, true)",risk:90,verdict:"BLOCKED",label:"SET APPROVAL FOR ALL",
    flags:["SET_APPROVAL_FOR_ALL: NFT collection","AUTO-BLOCK: rule-002 triggered","OPERATOR: unverified address"],
    detail:"setApprovalForAll grants operator unlimited NFT transfer rights. HIGH severity. Cannot be overridden.",
    detailColor:"#FF5252"},
  {id:"swap",name:"SAFE SWAP",fn:"swapExactTokens(500 USDC \u2192 ETH)",risk:18,verdict:"APPROVED",label:"SAFE SWAP",
    flags:["SWAP_ROUTE: Uniswap v3 verified","SLIPPAGE: 0.3% within limits","CONTRACT: verified + audited"],
    detail:"Swap within approved parameters. Route verified. Slippage acceptable. Amount within position limits. APPROVED.",
    detailColor:"#A3FF12"},
  {id:"transfer",name:"OWNERSHIP TRANSFER",fn:"transferOwnership(newOwner)",risk:95,verdict:"BLOCKED",label:"OWNERSHIP TRANSFER",
    flags:["CRITICAL_FUNCTION: ownership change","MULTI_SIG_REQUIRED: not present","TIMELOCK: 48h required, not set"],
    detail:"transferOwnership is a critical admin function. Requires multi-sig + 48h timelock. Single-signer attempt \u2014 AUTO-BLOCK.",
    detailColor:"#FF5252"},
];

const PREFLIGHT_SCENARIOS = [
  {id:"poison",icon:"\ud83d\ude08",name:"Address Poisoning",desc:"Lookalike attacker address in tx history",color:"#FF5252",
    addr:"0xA1B2C3d4E5f6a7B8c9D0e1F2a3B4c5D6e7F8a9B2",amount:"$50,000,000",
    checks:[{n:"Denylist Check",r:"CLEAR"},{n:"Dust Quarantine Cross-Check",r:"CLEAR"},{n:"Address Poisoning Detection",r:"BLOCK"},{n:"Address Book Verification",r:"SKIP"},{n:"First-Time High Value",r:"SKIP"},{n:"Amount Anomaly Check",r:"SKIP"},{n:"ProtectionAgent Deep Scan",r:"SKIP"}],
    scanMs:284,riskScore:"100/100"},
  {id:"dust",icon:"\ud83d\udca8",name:"Dust-Then-Drain",desc:"Recipient previously sent micro-transactions",color:"#FF9800",
    addr:"0xDEAD9a2cF1b3A4d5E6f7B8c9d0E1f2A3b4C5d6E7",amount:"$5,000,000",
    checks:[{n:"Denylist Check",r:"CLEAR"},{n:"Dust Quarantine Cross-Check",r:"BLOCK"},{n:"Address Poisoning Detection",r:"SKIP"},{n:"Address Book Verification",r:"SKIP"},{n:"First-Time High Value",r:"SKIP"},{n:"Amount Anomaly Check",r:"SKIP"},{n:"ProtectionAgent Deep Scan",r:"SKIP"}],
    scanMs:198,riskScore:"100/100"},
  {id:"firsttime",icon:"\u26a0\ufe0f",name:"First-Time Large Transfer",desc:"New address, high value \u2014 requires operator sign-off",color:"#FF9800",
    addr:"0x9876FeDcBa5432107654AbCdEf0123456789AaBb",amount:"$1,200,000",
    checks:[{n:"Denylist Check",r:"CLEAR"},{n:"Dust Quarantine Cross-Check",r:"CLEAR"},{n:"Address Poisoning Detection",r:"CLEAR"},{n:"Address Book Verification",r:"WARN"},{n:"First-Time High Value",r:"BLOCK"},{n:"Amount Anomaly Check",r:"SKIP"},{n:"ProtectionAgent Deep Scan",r:"SKIP"}],
    scanMs:312,riskScore:"85/100"},
  {id:"verified",icon:"\u2705",name:"Verified Counterparty",desc:"Address in book, normal amount, known history",color:"#A3FF12",
    addr:"0x1234AbCd5678EfGh9012IjKl3456MnOp7890QrSt",amount:"$25,000",
    checks:[{n:"Denylist Check",r:"CLEAR"},{n:"Dust Quarantine Cross-Check",r:"CLEAR"},{n:"Address Poisoning Detection",r:"CLEAR"},{n:"Address Book Verification",r:"CLEAR"},{n:"First-Time High Value",r:"CLEAR"},{n:"Amount Anomaly Check",r:"CLEAR"},{n:"ProtectionAgent Deep Scan",r:"CLEAR"}],
    scanMs:156,riskScore:"4/100"},
];

// Risk Score Ring SVG
const RiskRing = ({score,size=80}) => {
  const r=32,circ=2*Math.PI*r,pct=score/100,offset=circ*(1-pct);
  const color=score>=70?"#FF5252":score>=40?"#FF9800":"#A3FF12";
  return <svg width={size} height={size} viewBox="0 0 80 80">
    <circle cx="40" cy="40" r={r} fill="none" stroke="#1F2937" strokeWidth="6"/>
    <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
      strokeDasharray={circ} strokeDashoffset={offset} transform="rotate(-90 40 40)" style={{transition:"stroke-dashoffset 0.8s ease"}}/>
    <text x="40" y="44" textAnchor="middle" fill={color} fontSize="20" fontWeight="800" fontFamily="monospace">{score}</text>
  </svg>;
};

function GuardView() {
  const [tab,setTab]=useState("simulator"); // simulator | preflight | quarantine
  const [selectedTx,setSelectedTx]=useState(null);
  const [evalResult,setEvalResult]=useState(null);
  const [animating,setAnimating]=useState(false);
  const [blockedToday,setBlockedToday]=useState(4220);
  const [approvedToday,setApprovedToday]=useState(18947);

  // Protection Agent Simulator
  const runEval=(tx)=>{
    setSelectedTx(tx.id);setEvalResult(null);setAnimating(true);
    setTimeout(()=>{
      setEvalResult(tx);setAnimating(false);
      if(tx.verdict==="BLOCKED") setBlockedToday(p=>p+1); else setApprovedToday(p=>p+1);
    },800);
  };

  // Preflight Scan
  const [selectedScenario,setSelectedScenario]=useState(null);
  const [preflightRunning,setPreflightRunning]=useState(false);
  const [preflightChecks,setPreflightChecks]=useState([]);
  const [preflightDone,setPreflightDone]=useState(false);
  const [scanTime,setScanTime]=useState(0);

  const runPreflight=(scenario)=>{
    setSelectedScenario(scenario);setPreflightRunning(true);setPreflightDone(false);setPreflightChecks([]);setScanTime(0);
    const start=Date.now();
    scenario.checks.forEach((check,i)=>{
      setTimeout(()=>{
        setPreflightChecks(p=>[...p,check]);
        if(check.r==="BLOCK"||i===scenario.checks.length-1){
          setTimeout(()=>{setPreflightRunning(false);setPreflightDone(true);setScanTime(Date.now()-start)},200);
        }
      },(i+1)*280);
    });
  };

  const rColors={CLEAR:"#A3FF12",BLOCK:"#FF5252",WARN:"#FF9800",SKIP:"#444"};

  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:12}}>
      <div>
        <h2 style={{fontSize:20,fontWeight:700,color:"#fff",margin:0}}>{"\ud83d\udee1\ufe0f"} Guard Agents — Protection Layer</h2>
        <p style={{fontSize:13,color:"#888",margin:"4px 0 0"}}>Interactive security simulators</p>
      </div>
      <div style={{display:"flex",gap:4,background:"#111827",borderRadius:8,padding:3}}>
        {[["simulator","\u26a1 Protection Agent"],["preflight","\ud83d\udd12 Payment Guard"],["quarantine","\ud83e\uddea Dust Quarantine"]].map(([id,label])=>
          <button key={id} onClick={()=>setTab(id)} style={{padding:"8px 16px",borderRadius:6,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"'JetBrains Mono',monospace",background:tab===id?"#A3FF12":"transparent",color:tab===id?"#000":"#888"}}>{label}</button>
        )}
      </div>
    </div>

    {tab==="simulator"&&<div>
      {/* Protection Agent Live Simulator */}
      <Card style={{background:"#0a0f0a",border:"1px solid #1a2a1a",padding:0,overflow:"hidden"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 20px",borderBottom:"1px solid #1a2a1a"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:"#FF5252"}}/>
            <span style={{fontSize:13,fontWeight:700,color:"#999",fontFamily:"'JetBrains Mono',monospace",letterSpacing:1}}>{"\u26a1"} PROTECTION AGENT {"\u00b7"} LIVE SIMULATOR</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <span style={{padding:"3px 10px",borderRadius:4,background:"#A3FF1220",color:"#A3FF12",fontSize:11,fontWeight:700,fontFamily:"monospace"}}>DEMO</span>
            <span style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:"#FF5252"}}><span style={{width:6,height:6,borderRadius:"50%",background:"#FF5252",animation:"pulse 1.5s infinite"}}/>INTERCEPTING</span>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",minHeight:340}}>
          {/* Left: Test Transactions */}
          <div style={{padding:20,borderRight:"1px solid #1a2a1a"}}>
            <div style={{fontSize:11,color:"#666",fontFamily:"monospace",textTransform:"uppercase",marginBottom:12,letterSpacing:1}}>Test Transaction</div>
            {TEST_TXS.map(tx=><div key={tx.id} onClick={()=>runEval(tx)} style={{padding:"12px 16px",borderRadius:8,marginBottom:8,cursor:"pointer",border:`1px solid ${selectedTx===tx.id?(tx.verdict==="APPROVED"?"#A3FF12":"#FF5252"):"#1F2937"}`,background:selectedTx===tx.id?"#111":"#0A0A0A",transition:"all 0.2s"}}>
              <div style={{fontSize:13,fontWeight:700,color:tx.verdict==="APPROVED"?"#A3FF12":"#FF5252",fontFamily:"'JetBrains Mono',monospace"}}>{tx.name}</div>
              <div style={{fontSize:11,color:"#666",fontFamily:"monospace",marginTop:2}}>{tx.fn}</div>
            </div>)}
          </div>
          {/* Right: Evaluation Result */}
          <div style={{padding:20}}>
            <div style={{fontSize:11,color:"#666",fontFamily:"monospace",textTransform:"uppercase",marginBottom:12,letterSpacing:1}}>Evaluation Result</div>
            {animating&&<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:250}}><div style={{fontSize:14,color:"#888",fontFamily:"monospace"}}>Scanning transaction...</div></div>}
            {!animating&&!evalResult&&<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:250,color:"#333",fontSize:13}}>Select a transaction to evaluate</div>}
            {!animating&&evalResult&&<div>
              <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:16}}>
                <RiskRing score={evalResult.risk}/>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:16}}>{evalResult.verdict==="BLOCKED"?"\u26d4":"\u2705"}</span><span style={{fontSize:18,fontWeight:800,color:evalResult.verdict==="BLOCKED"?"#FF5252":"#A3FF12",fontFamily:"'JetBrains Mono',monospace"}}>{evalResult.verdict}</span></div>
                  <div style={{fontSize:13,color:"#999",fontFamily:"monospace"}}>{evalResult.label}</div>
                  <div style={{fontSize:11,color:"#666",fontFamily:"monospace"}}>risk score {evalResult.risk}/100</div>
                </div>
              </div>
              {evalResult.flags.map((f,i)=><div key={i} style={{fontSize:12,color:"#999",fontFamily:"monospace",padding:"3px 0",display:"flex",gap:6}}><span style={{color:"#555"}}>{"\u2192"}</span>{f}</div>)}
              <div style={{marginTop:14,padding:"12px 16px",borderRadius:8,background:evalResult.verdict==="BLOCKED"?"#1a0505":"#051a05",border:`1px solid ${evalResult.detailColor}30`}}>
                <div style={{display:"flex",gap:8,alignItems:"flex-start"}}><span style={{fontSize:12,marginTop:1}}>{evalResult.verdict==="BLOCKED"?"\ud83d\udd34":"\ud83d\udfe2"}</span><span style={{fontSize:12,color:evalResult.detailColor,lineHeight:1.5}}>{evalResult.detail}</span></div>
              </div>
            </div>}
          </div>
        </div>
        <div style={{display:"flex",gap:20,padding:"12px 20px",borderTop:"1px solid #1a2a1a",fontFamily:"monospace",fontSize:12}}>
          <span style={{color:"#666"}}>BLOCKED TODAY <span style={{color:"#FF5252",fontWeight:700}}>{blockedToday.toLocaleString()}</span></span>
          <span style={{color:"#666"}}>APPROVED <span style={{color:"#A3FF12",fontWeight:700}}>{approvedToday.toLocaleString()}</span></span>
          <span style={{color:"#666"}}>AVG SCORE <span style={{color:"#FF9800",fontWeight:700}}>39/100</span></span>
        </div>
      </Card>
    </div>}

    {tab==="preflight"&&<div>
      {/* Payment Guard Header */}
      <div style={{marginBottom:24}}>
        <div style={{fontSize:11,color:"#A3FF12",fontFamily:"monospace",fontWeight:600,letterSpacing:1,marginBottom:6}}>{"\u25cf"} PAYMENT GUARD</div>
        <h3 style={{fontSize:28,fontWeight:800,color:"#fff",margin:"0 0 8px",lineHeight:1.2}}>$50M almost left to the wrong wallet. <span style={{color:"#A3FF12"}}>7 layers caught it.</span></h3>
        <p style={{fontSize:14,color:"#888",margin:0,maxWidth:600,lineHeight:1.5}}>Before any outgoing transaction is signed, the system runs a pre-flight scan — address poisoning detection, dust quarantine cross-reference, anomaly analysis, and ProtectionAgent deep scan. Try it below.</p>
      </div>
      <Card style={{background:"#0a0f0a",border:"1px solid #1a2a1a",padding:0,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",minHeight:440}}>
          {/* Left: Outgoing TX Preflight */}
          <div style={{padding:24,borderRight:"1px solid #1a2a1a"}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:20}}><span style={{width:8,height:8,borderRadius:"50%",background:"#A3FF12"}}/>
              <span style={{fontSize:12,color:"#888",fontFamily:"monospace",letterSpacing:1}}>OUTGOING_TX_PREFLIGHT</span></div>
            <div style={{marginBottom:16}}>
              <div style={{fontSize:11,color:"#555",fontFamily:"monospace",marginBottom:6}}>RECIPIENT ADDRESS {"\u00b7"} auto-filled by scenario</div>
              <div style={{padding:"12px 14px",borderRadius:8,background:"#111",border:"1px solid #1F2937",fontFamily:"monospace",fontSize:12,color:"#888",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span>{selectedScenario?.addr||"Select a scenario below"}</span>
                <span style={{color:"#FF9800"}}>{"\ud83d\udd12"}</span>
              </div>
            </div>
            <div style={{marginBottom:20}}>
              <div style={{fontSize:11,color:"#555",fontFamily:"monospace",marginBottom:6}}>TRANSFER AMOUNT (USD) {"\u00b7"} set by scenario</div>
              <div style={{padding:"12px 14px",borderRadius:8,background:"#111",border:"1px solid #1F2937",fontFamily:"monospace",fontSize:16,fontWeight:700,color:"#fff"}}>
                {selectedScenario?.amount||"$0"}
              </div>
            </div>
            <div style={{fontSize:11,color:"#555",fontFamily:"monospace",marginBottom:10,letterSpacing:1}}>SCENARIO</div>
            {PREFLIGHT_SCENARIOS.map(s=><div key={s.id} onClick={()=>!preflightRunning&&runPreflight(s)} style={{padding:"10px 14px",borderRadius:8,marginBottom:8,cursor:preflightRunning?"wait":"pointer",border:`1px solid ${selectedScenario?.id===s.id?s.color:"#1F2937"}`,background:selectedScenario?.id===s.id?"#111":"#0A0A0A",transition:"all 0.2s"}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}><span>{s.icon}</span><span style={{fontSize:13,fontWeight:700,color:s.color}}>{s.name}</span></div>
              <div style={{fontSize:11,color:"#666",marginTop:2}}>{s.desc}</div>
            </div>)}
            {selectedScenario&&!preflightRunning&&preflightDone&&<button onClick={()=>runPreflight(selectedScenario)} style={{width:"100%",padding:"14px",borderRadius:8,border:"none",background:"#A3FF12",color:"#000",fontSize:14,fontWeight:800,fontFamily:"'JetBrains Mono',monospace",cursor:"pointer",marginTop:8,letterSpacing:1}}>RUN PREFLIGHT SCAN {"\u2192"}</button>}
          </div>
          {/* Right: Check Results */}
          <div style={{padding:24}}>
            {!selectedScenario&&<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:"#333",fontSize:13}}>Select a scenario to run preflight scan</div>}
            {selectedScenario&&<div>
              {/* Verdict Header */}
              {preflightDone&&<div style={{padding:"16px 20px",borderRadius:12,marginBottom:20,background:preflightChecks.some(c=>c.r==="BLOCK")?"#1a0505":"#051a05",border:`1px solid ${preflightChecks.some(c=>c.r==="BLOCK")?"#FF525240":"#A3FF1240"}`}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:24}}>{preflightChecks.some(c=>c.r==="BLOCK")?"\ud83d\udeab":"\u2705"}</span>
                  <div>
                    <div style={{fontSize:18,fontWeight:800,fontFamily:"'JetBrains Mono',monospace",color:preflightChecks.some(c=>c.r==="BLOCK")?"#FF5252":"#A3FF12",letterSpacing:1}}>
                      {preflightChecks.some(c=>c.r==="BLOCK")?"TRANSACTION BLOCKED":"TRANSACTION APPROVED"}
                    </div>
                    <div style={{fontSize:12,color:preflightChecks.some(c=>c.r==="BLOCK")?"#FF9800":"#8a8",marginTop:2}}>
                      {preflightChecks.some(c=>c.r==="BLOCK")?"Payment stopped before signing. Funds are safe.":"All checks passed. Transaction safe to sign."}
                    </div>
                  </div>
                </div>
              </div>}
              {/* Check List */}
              <div style={{marginBottom:20}}>
                {selectedScenario.checks.map((check,i)=>{
                  const ran = preflightChecks.length>i;
                  const result = ran?preflightChecks[i]:null;
                  const isRunning = preflightRunning&&preflightChecks.length===i;
                  return <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:"1px solid #1a1a2a",opacity:ran||isRunning?1:0.3,transition:"opacity 0.3s"}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:12}}>{result?.r==="CLEAR"?"\u2713":result?.r==="BLOCK"?"\u2717":result?.r==="WARN"?"\u26a0":"\u25cb"}</span>
                      <span style={{fontSize:13,color:ran?"#ddd":"#555",fontFamily:"monospace"}}>{check.n}</span>
                    </div>
                    <span style={{fontSize:11,fontWeight:700,fontFamily:"monospace",color:result?rColors[result.r]:"#333",letterSpacing:1}}>
                      {isRunning?"SCANNING...":result?.r||"SKIP"}
                    </span>
                  </div>;
                })}
              </div>
              {/* Stats */}
              {preflightDone&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                {[
                  [preflightChecks.length,"CHECKS RUN","#00E5FF"],
                  [`${scanTime>0?scanTime:selectedScenario.scanMs}ms`,"SCAN TIME","#A3FF12"],
                  [selectedScenario.riskScore,"RISK SCORE",preflightChecks.some(c=>c.r==="BLOCK")?"#FF5252":"#A3FF12"]
                ].map(([v,l,c],i)=><div key={i} style={{padding:"12px",borderRadius:8,background:"#0d1520",border:"1px solid #1a2a3a",textAlign:"center"}}>
                  <div style={{fontSize:20,fontWeight:800,fontFamily:"'JetBrains Mono',monospace",color:c}}>{v}</div>
                  <div style={{fontSize:10,color:"#666",fontFamily:"monospace",marginTop:2,letterSpacing:1}}>{l}</div>
                </div>)}
              </div>}
            </div>}
          </div>
        </div>
      </Card>
      {/* Disclaimer */}
      <Card style={{marginTop:16,background:"#0d1520",border:"1px solid #1a2a3a",display:"flex",alignItems:"flex-start",gap:12}}>
        <span style={{fontSize:18,color:"#FF9800",flexShrink:0}}>{"\ud83d\udd12"}</span>
        <p style={{fontSize:12,color:"#999",margin:0,lineHeight:1.5}}>This simulation reflects the actual 7-layer preflight logic built into GEBRID OS. In production, <span style={{color:"#A3FF12",fontWeight:700}}>BLOCK decisions are cryptographically enforced</span> and cannot be bypassed by any agent, strategy, or human operator.</p>
      </Card>
    </div>}

    {tab==="quarantine"&&<div>
      <div style={{marginBottom:24}}>
        <div style={{fontSize:11,color:"#FF9800",fontFamily:"monospace",fontWeight:600,letterSpacing:1,marginBottom:6}}>{"\ud83e\uddea"} INCOMING TX QUARANTINE</div>
        <h3 style={{fontSize:28,fontWeight:800,color:"#fff",margin:"0 0 8px",lineHeight:1.2}}>Dust attacks are caught <span style={{color:"#FF9800"}}>before they touch your wallet.</span></h3>
        <p style={{fontSize:14,color:"#888",margin:0,maxWidth:650,lineHeight:1.5}}>Every incoming transaction under the dust threshold is auto-quarantined. Poisoned addresses from dust never enter your transaction history — preventing copy-paste attacks, address confusion, and drain attempts.</p>
      </div>
      {/* Guardian Agent Explainer */}
      <Card style={{marginBottom:16,background:"#111827",border:"1px solid #FF980030",display:"flex",gap:16,alignItems:"flex-start"}}>
        <div style={{width:48,height:48,borderRadius:12,background:"#FF980015",border:"1px solid #FF980030",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0}}>{"\ud83e\uddea"}</div>
        <div>
          <div style={{fontSize:11,color:"#FF9800",fontFamily:"monospace",fontWeight:600,letterSpacing:1,marginBottom:4}}>DUST & ADDRESS POISONING</div>
          <div style={{fontSize:16,fontWeight:700,color:"#fff",marginBottom:8}}>Guardian Agent</div>
          <p style={{fontSize:13,color:"#bbb",margin:0,lineHeight:1.6}}>Incoming dust tokens and address-poisoning attempts are flagged by Guardian Agent before they can be consolidated into outbound transactions. Marked addresses are quarantined from execution scope until manually reviewed — preventing identity-linkage attacks and misdirected capital flows.</p>
        </div>
      </Card>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:16}}>
        <Metric label="Quarantined" value="1,847" sub="all time" warn/><Metric label="Dust Blocked" value="$0.42" sub="total value"/><Metric label="Drain Prevented" value="$4.2M" sub="protected capital"/><Metric label="Auto-Purged" value="1,203" sub="after 72h"/>
      </div>
      <Card style={{background:"#0a0f0a",border:"1px solid #1a2a1a",padding:0,overflow:"hidden",marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 20px",borderBottom:"1px solid #1a2a1a"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}><span style={{width:8,height:8,borderRadius:"50%",background:"#FF9800"}}/><span style={{fontSize:13,fontWeight:700,color:"#999",fontFamily:"'JetBrains Mono',monospace",letterSpacing:1}}>{"\ud83e\uddea"} QUARANTINE ZONE {"\u00b7"} LIVE MONITOR</span></div>
          <span style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:"#FF9800"}}><span style={{width:6,height:6,borderRadius:"50%",background:"#FF9800",animation:"pulse 1.5s infinite"}}/>SCANNING INBOUND</span>
        </div>
        <div style={{padding:"16px 20px",borderBottom:"1px solid #1a2a1a"}}>
          <div style={{fontSize:11,color:"#555",fontFamily:"monospace",marginBottom:10,letterSpacing:1}}>QUARANTINE FLOW</div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            {[{s:"Inbound TX",i:"\ud83d\udce8",c:"#888"},{s:"Dust check",i:"\ud83d\udd0d",c:"#FF9800"},{s:"Denylist?",i:"\ud83d\udeab",c:"#FF5252"},{s:"Similarity",i:"\ud83e\uddd0",c:"#00E5FF"},{s:"QUARANTINE / ACCEPT",i:"\ud83e\uddea",c:"#A3FF12"}].map((s,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:4}}>
              <div style={{display:"flex",alignItems:"center",gap:4,padding:"6px 10px",borderRadius:6,background:"#111",border:"1px solid #1F2937"}}><span>{s.i}</span><span style={{fontSize:10,color:s.c,fontFamily:"monospace"}}>{s.s}</span></div>
              {i<4&&<span style={{color:"#333"}}>{"\u2192"}</span>}
            </div>)}
          </div>
        </div>
        <div style={{padding:"16px 20px"}}>
          <div style={{fontSize:11,color:"#555",fontFamily:"monospace",marginBottom:10,letterSpacing:1}}>QUARANTINED INCOMING TRANSACTIONS</div>
          {[
            {time:"14:42:18",from:"0xA1B2...9B2f",amount:"0.00001 ETH",reason:"Dust + address poisoning",status:"quarantined",risk:"critical",detail:"Sender mimics your vault address (0xA1B2...9B3d). Classic address poisoning — designed to trick copy-paste."},
            {time:"14:38:05",from:"0x8f3a...a21c",amount:"0.00042 ETH",reason:"Denylisted sender",status:"quarantined",risk:"critical",detail:"Address 0x8f3a...a21c on Chainalysis denylist. Connected to 14 known phishing campaigns."},
            {time:"14:21:33",from:"0xDEAD...d6E7",amount:"0.0001 USDT",reason:"Sequential dust (4th in 48h)",status:"quarantined",risk:"high",detail:"4th micro-tx from this address in 48h. Pattern matches dust-then-drain sequence."},
            {time:"13:55:12",from:"0x7712...f4a9",amount:"0.001 ETH",reason:"New address, micro amount",status:"quarantined",risk:"medium",detail:"First interaction from unknown address. Amount $0.04 below dust threshold. Auto-quarantined 72h."},
            {time:"13:30:44",from:"0x1234...QrSt",amount:"24.5 ETH",reason:"\u2014",status:"accepted",risk:"safe",detail:"Known counterparty, address book match, normal amount range."},
            {time:"12:18:09",from:"0x9f2c...b81e",amount:"0.00005 ETH",reason:"Expired quarantine",status:"purged",risk:"low",detail:"Quarantined 72h ago. No matching drain detected. Auto-purged, sender remains flagged."},
          ].map((tx,i)=>{
            const rc={critical:"#FF5252",high:"#FF9800",medium:"#FFD600",safe:"#A3FF12",low:"#888"};
            const sc={quarantined:{bg:"#2a1f00",fg:"#FF9800"},accepted:{bg:"#0d2818",fg:"#A3FF12"},purged:{bg:"#1a1a2a",fg:"#666"}};
            const s=sc[tx.status]||sc.quarantined;
            return <div key={i}>
              <div style={{display:"flex",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid #1a2a1a",fontSize:12,alignItems:"center",flexWrap:"wrap",gap:8}}>
                <div style={{display:"flex",gap:8,alignItems:"center",flex:1,minWidth:0}}>
                  <span style={{color:"#666",fontFamily:"monospace",width:58,flexShrink:0,fontSize:11}}>{tx.time}</span>
                  <span style={{width:8,height:8,borderRadius:"50%",background:rc[tx.risk],flexShrink:0}}/>
                  <span style={{color:"#999",fontFamily:"monospace",fontSize:11}}>{tx.from}</span>
                  <span style={{color:tx.status==="accepted"?"#A3FF12":"#FF9800",fontWeight:600,fontFamily:"monospace"}}>{tx.amount}</span>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
                  {tx.reason!=="\u2014"&&<span style={{fontSize:10,color:"#999",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tx.reason}</span>}
                  <span style={{padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:700,background:s.bg,color:s.fg,fontFamily:"monospace",textTransform:"uppercase"}}>{tx.status}</span>
                </div>
              </div>
              {tx.status==="quarantined"&&<div style={{padding:"8px 12px 8px 66px",fontSize:11,color:"#888",lineHeight:1.4}}>
                <span style={{color:rc[tx.risk],fontWeight:600}}>{tx.risk.toUpperCase()}:</span> {tx.detail}
                <div style={{display:"flex",gap:6,marginTop:6}}>
                  <button style={{padding:"3px 10px",borderRadius:4,border:"1px solid #FF5252",background:"transparent",color:"#FF5252",fontSize:10,fontWeight:600,cursor:"pointer",fontFamily:"monospace"}}>DESTROY TX</button>
                  <button style={{padding:"3px 10px",borderRadius:4,border:"1px solid #333",background:"transparent",color:"#666",fontSize:10,fontWeight:600,cursor:"pointer",fontFamily:"monospace"}}>RELEASE (RISK)</button>
                  <span style={{fontSize:10,color:"#333",padding:"3px 0"}}>auto-purge in 72h</span>
                </div>
              </div>}
            </div>;
          })}
        </div>
        <div style={{display:"flex",gap:20,padding:"12px 20px",borderTop:"1px solid #1a2a1a",fontFamily:"monospace",fontSize:12}}>
          <span style={{color:"#666"}}>IN QUARANTINE <span style={{color:"#FF9800",fontWeight:700}}>644</span></span>
          <span style={{color:"#666"}}>PURGED (72H) <span style={{color:"#888",fontWeight:700}}>1,203</span></span>
          <span style={{color:"#666"}}>ACCEPTED TODAY <span style={{color:"#A3FF12",fontWeight:700}}>342</span></span>
          <span style={{color:"#666"}}>FALSE POS. <span style={{color:"#00E5FF",fontWeight:700}}>0.02%</span></span>
        </div>
      </Card>
      <Card style={{background:"#0d1520",border:"1px solid #1a2a3a",marginBottom:16}}>
        <div style={{fontSize:14,fontWeight:600,marginBottom:12,color:"#fff"}}>Quarantine Rules (Active)</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))",gap:12}}>
          {[
            {rule:"Dust Threshold",value:"< 0.001 ETH",color:"#FF9800",desc:"Incoming tx below threshold auto-quarantined regardless of sender"},
            {rule:"Denylist Match",value:"Chainalysis + internal",color:"#FF5252",desc:"Sender on known phishing/exploit/mixer denylist"},
            {rule:"Address Similarity",value:"Levenshtein \u2264 3",color:"#00E5FF",desc:"Sender suspiciously similar to your vault or known counterparties"},
            {rule:"Sequential Pattern",value:"3+ micro / 48h",color:"#E040FB",desc:"Multiple dust-size txs from same address in short timeframe"},
            {rule:"Quarantine Hold",value:"72 hours",color:"#A3FF12",desc:"Auto-purge after 72h if no matching drain attempt detected"},
            {rule:"Release Policy",value:"Manual + warning",color:"#FFD600",desc:"Release requires explicit operator action with risk acknowledgement"},
          ].map((r,i)=><div key={i} style={{padding:"12px 14px",borderRadius:8,background:"#111827",border:`1px solid ${r.color}20`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
              <span style={{fontSize:12,fontWeight:700,color:"#fff"}}>{r.rule}</span>
              <span style={{fontSize:10,fontWeight:700,color:r.color,fontFamily:"monospace",padding:"2px 6px",borderRadius:3,background:`${r.color}15`}}>{r.value}</span>
            </div>
            <div style={{fontSize:11,color:"#666",lineHeight:1.4}}>{r.desc}</div>
          </div>)}
        </div>
      </Card>
      <Card style={{background:"#0d1520",border:"1px solid #1a2a3a",display:"flex",alignItems:"flex-start",gap:12}}>
        <span style={{fontSize:18,color:"#FF9800",flexShrink:0}}>{"\ud83e\uddea"}</span>
        <p style={{fontSize:12,color:"#999",margin:0,lineHeight:1.5}}>Quarantined transactions are <span style={{color:"#FF9800",fontWeight:700}}>cryptographically isolated</span> — they never enter your wallet history. This prevents address poisoning where users copy attacker addresses. <span style={{color:"#FF5252",fontWeight:700}}>DESTROY</span> permanently burns the quarantined amount. <span style={{color:"#A3FF12",fontWeight:700}}>RELEASE</span> moves funds to wallet with a permanent risk flag on the sender.</p>
      </Card>
    </div>}
    <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
  </div>;
}

// ═══ MAIN ═══
export default function App() {
  const [view,setView]=useState("dashboard");
  const [connected,setConnected]=useState(false);
  const [selStrat,setSelStrat]=useState(null);
  const [addr,setAddr]=useState("");
  const [time,setTime]=useState(new Date());
  useEffect(()=>{const t=setInterval(()=>setTime(new Date()),1000);return()=>clearInterval(t)},[]);
  const connect=useCallback(()=>{setAddr("0x"+Array.from({length:40},()=>"0123456789abcdef"[Math.floor(Math.random()*16)]).join(""));setConnected(true)},[]);

  if(!connected) return <div style={{background:"#0A0A0A",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Inter',system-ui,sans-serif",color:"#fff"}}>
    <div style={{textAlign:"center",maxWidth:440}}>
      <div style={{fontSize:44,fontWeight:800,color:"#A3FF12",marginBottom:4,letterSpacing:-1}}>GEBRID</div>
      <div style={{fontSize:13,color:"#888",letterSpacing:2,textTransform:"uppercase",marginBottom:32}}>AI-Native Infrastructure for Web3 Capital</div>
      <Card style={{padding:32}}>
        <h2 style={{fontSize:18,fontWeight:600,margin:"0 0 8px"}}>Connect Your Wallet</h2>
        <p style={{fontSize:13,color:"#888",margin:"0 0 24px"}}>Access institutional AI capital management · $450M AUM</p>
        <Btn primary onClick={connect} style={{width:"100%",padding:14,fontSize:15,marginBottom:12}}>Connect Wallet</Btn>
        <div style={{display:"flex",gap:8,justifyContent:"center"}}>{["MetaMask","WalletConnect","Coinbase"].map(w=><span key={w} style={{fontSize:11,color:"#666",padding:"4px 10px",borderRadius:4,background:"#1F2937"}}>{w}</span>)}</div>
      </Card>
      <p style={{fontSize:11,color:"#555",marginTop:16}}>Testnet Mode</p>
    </div>
  </div>;

  const NAV=[
    {id:"dashboard",icon:"\u25a7",label:"Dashboard"},
    {id:"ai",icon:"\ud83e\udd16",label:"AI Console",badge:"AI"},
    {id:"pipeline",icon:"\u26a1",label:"Pipeline"},
    {id:"marketplace",icon:"\u2b50",label:"Marketplace"},
    {id:"gamefi",icon:"\ud83c\udfae",label:"GameFi",badge:"NEW"},
    {id:"risk",icon:"\ud83d\udee1\ufe0f",label:"Risk Monitor"},
    {id:"guard",icon:"\ud83d\udd12",label:"Guard Agents",badge:"5"},
    {id:"analytics",icon:"\ud83d\udcca",label:"Analytics"},
    {id:"staking",icon:"\ud83d\udc8e",label:"Staking"},
    {id:"builder",icon:"\u2699\ufe0f",label:"Agent Builder"},
  ];

  return <div style={{display:"flex",minHeight:"100vh",background:"#0A0A0A",fontFamily:"'Inter',system-ui,sans-serif",color:"#E0E0E0"}}>
    <div style={{width:210,background:"#0d0d14",borderRight:"1px solid #1F2937",padding:"16px 0",display:"flex",flexDirection:"column",flexShrink:0}}>
      <div style={{padding:"0 16px 16px",borderBottom:"1px solid #1F2937",marginBottom:8}}>
        <div style={{fontSize:22,fontWeight:800,color:"#A3FF12",letterSpacing:-0.5}}>GEBRID</div>
        <div style={{fontSize:10,color:"#555",letterSpacing:1.5,textTransform:"uppercase"}}>Agent OS v2.0</div>
      </div>
      <div style={{flex:1,paddingTop:4}}>{NAV.map(n=><SideItem key={n.id} icon={n.icon} label={n.label} badge={n.badge} active={view===n.id} onClick={()=>{if(n.id==="builder")setSelStrat(null);setView(n.id)}}/>)}</div>
      <div style={{padding:"10px 16px",borderTop:"1px solid #1F2937"}}>
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}><span style={{width:8,height:8,borderRadius:"50%",background:"#A3FF12",boxShadow:"0 0 6px #A3FF12"}}/><span style={{fontSize:11,color:"#A3FF12"}}>Connected</span></div>
        <div style={{fontSize:11,color:"#666",fontFamily:"monospace"}}>{addr.slice(0,6)}...{addr.slice(-4)}</div>
        <div style={{fontSize:10,color:"#555",marginTop:2}}>Sepolia Testnet</div>
      </div>
    </div>
    <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 24px",borderBottom:"1px solid #1F2937",background:"#0d0d14"}}>
        <div style={{fontSize:15,fontWeight:600,color:"#fff"}}>{NAV.find(n=>n.id===view)?.label||""}</div>
        <div style={{display:"flex",alignItems:"center",gap:12}}><span style={{fontSize:12,color:"#666",fontFamily:"monospace"}}>{time.toLocaleTimeString()}</span><span style={{padding:"3px 8px",borderRadius:4,background:"#1a2332",color:"#5BA3E6",fontSize:11}}>v2.0-beta</span></div>
      </div>
      <div style={{flex:1,padding:24,overflowY:"auto"}}>
        {view==="dashboard"&&<DashboardView/>}
        {view==="ai"&&<AIConsoleView/>}
        {view==="pipeline"&&<PipelineView/>}
        {view==="marketplace"&&<MarketplaceView onDeploy={s=>{setSelStrat(s);setView("builder")}}/>}
        {view==="gamefi"&&<GameFiView/>}
        {view==="risk"&&<RiskView/>}
        {view==="guard"&&<GuardView/>}
        {view==="analytics"&&<AnalyticsView/>}
        {view==="staking"&&<StakingView/>}
        {view==="builder"&&<BuilderView strategy={selStrat} onBack={()=>setView("dashboard")}/>}
      </div>
    </div>
  </div>;
}
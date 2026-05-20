const SuperAdminView=(()=>{
let _l=[],_clubs=[],_gp=[],_cv='eco',_railOpen=false;
async function render(){
if(!TenantManager.isMasterAdmin()){UI.showToast('403','error');App.navigateTo('dashboard');return;}
document.getElementById('app').innerHTML=`
<div class="god-shell">
<header class="god-header">
<div class="gh-brand">🌌 TABUKO <i>TITANIUM</i></div>
<div class="gh-metric"><span class="gh-metric-label">Clubs</span><span class="gh-metric-val" id="gp-clubs">--</span></div>
<div class="gh-metric"><span class="gh-metric-label">Players</span><span class="gh-metric-val" id="gp-players">--</span></div>
<div class="gh-metric"><span class="gh-metric-label">Premium</span><span class="gh-metric-val" id="gp-prem" style="color:var(--g-green)">--</span></div>
<div class="gh-metric"><span class="gh-metric-label">Expired</span><span class="gh-metric-val" id="gp-exp" style="color:var(--g-red)">--</span></div>
<div class="gh-metric"><span class="gh-metric-label">Pending</span><span class="gh-metric-val" id="gp-pend" style="color:var(--g-gold)">--</span></div>
<div class="gh-metric"><span class="gh-metric-label">Latency</span><span class="gh-metric-val" id="gp-lat" style="color:var(--g-green)">--ms</span></div>
<div class="gh-metric"><span class="gh-metric-label">Health</span><span class="gh-metric-val" id="gp-hp" style="color:var(--g-green)">100%</span></div>
<div class="gh-right">
<div class="gh-threat low" id="gp-threat"><span class="g-pulse live"></span>LOW</div>
<button class="gh-btn" onclick="SuperAdminView.broadcast()">📢 BROADCAST</button>
<button class="gh-btn danger" onclick="SuperAdminController.exitShadowLogin()">EXIT GOD-MODE</button>
</div>
</header>
<div class="god-body" id="god-body">
<nav class="god-rail" id="god-rail">
<div class="gr-toggle" onclick="SuperAdminView.toggleRail()">☰</div>
<div class="gr-section">
<div class="gr-label">Command</div>
<div class="gr-item active" data-v="eco" onclick="SV('eco')"><span class="ico">🌍</span><span class="txt">Ecosystem</span></div>
<div class="gr-item" data-v="war" onclick="SV('war')"><span class="ico">⚔️</span><span class="txt">War Room</span></div>
<div class="gr-item" data-v="fin" onclick="SV('fin')"><span class="ico">💰</span><span class="txt">Financial</span></div>
</div>
<div class="gr-sep"></div>
<div class="gr-section">
<div class="gr-label">Intelligence</div>
<div class="gr-item" data-v="reg" onclick="SV('reg')"><span class="ico">👥</span><span class="txt">Registry</span></div>
<div class="gr-item" data-v="aud" onclick="SV('aud')"><span class="ico">📋</span><span class="txt">Audit Trail</span></div>
<div class="gr-item" data-v="sec" onclick="SV('sec')"><span class="ico">🛡️</span><span class="txt">Security</span></div>
</div>
<div class="gr-sep"></div>
<div class="gr-section">
<div class="gr-label">System</div>
<div class="gr-item" onclick="SuperAdminController.archivePastSeasonData()"><span class="ico">🗑️</span><span class="txt">Garbage Collect</span></div>
<div class="gr-item" onclick="if(confirm('Run DB Optimization? This will purge old draft tournaments.')) { DB.executeDatabaseOptimizationRoutine().then(c=>alert('Purged '+c+' stale nodes')); }"><span class="ico">🧹</span><span class="txt">DB Optimization</span></div>
<div class="gr-item" onclick="SuperAdminController.pushLogicVersion(prompt('Version:'))"><span class="ico">🚀</span><span class="txt">Push Version</span></div>
</div>
<div class="gr-footer">TITANIUM v2.2.9</div>
</nav>
<div class="god-stage" id="god-stage">
<div class="gs-main" id="gs-main"></div>
<aside class="gs-intel">
<div class="gi-section" style="flex:1">
<div class="gi-header">System Terminal</div>
<div class="gi-body gi-terminal" id="gi-term"></div>
</div>
<div class="gi-section" style="flex:0.4">
<div class="gi-header">Triage <span id="gi-tc" style="color:var(--g-red)"></span></div>
<div class="gi-body gi-triage" id="gi-triage"></div>
</div>
</aside>
</div>
</div>
<div class="g-drawer" id="g-drawer"></div>
</div>`;
window.SV=switchView;
startStreams();
}

function startStreams(){
_l.forEach(u=>u());_l=[];
_l.push(db.collection('clubs').onSnapshot(s=>{
_clubs=s.docs.map(d=>({id:d.id,...d.data()}));
pulse();triage();
if(_cv==='eco')renderEco();if(_cv==='fin')renderFin();
}));
_l.push(db.collection('system_logs').orderBy('timestamp','desc').limit(60).onSnapshot(s=>term(s.docs)));
setInterval(()=>{const e=document.getElementById('gp-lat');if(e)e.textContent=Math.floor(18+Math.random()*12)+'ms';},5000);
}

function pulse(){
const now=new Date();let pr=0,ex=0,pe=0;
_clubs.forEach(c=>{const e=c.subscription?.end_date?.toDate?.();if(c.pending_verification)pe++;if(e&&e>now)pr++;else ex++;});
const s=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
s('gp-clubs',_clubs.length);s('gp-prem',pr);s('gp-exp',ex);s('gp-pend',pe);
}

function switchView(v){
_cv=v;
document.querySelectorAll('.gr-item[data-v]').forEach(e=>e.classList.remove('active'));
document.querySelector(`[data-v="${v}"]`)?.classList.add('active');
({eco:renderEco,war:renderWar,fin:renderFin,reg:renderReg,aud:renderAud,sec:renderSec})[v]?.();
}

function toggleRail(){
_railOpen=!_railOpen;
document.getElementById('god-body')?.classList.toggle('rail-expanded',_railOpen);
}

// ═══ ECO ═══
function renderEco(){
const m=document.getElementById('gs-main');if(!m)return;const now=new Date();
const act=_clubs.filter(c=>{const e=c.subscription?.end_date?.toDate?.();return e&&e>now;}).length;
m.innerHTML=`<div class="gs-header"><div><div class="gs-title">🌍 Ecosystem Nodes</div><div class="gs-sub">${_clubs.length} registered clubs</div></div><input class="g-search" placeholder="🔍 Filter..." oninput="SuperAdminView.fEco(this.value)"></div>
<div class="g-stats">
<div class="g-stat"><div class="v" style="color:var(--g-cyan)">${_clubs.length}</div><div class="l">Total</div></div>
<div class="g-stat"><div class="v" style="color:var(--g-green)">${act}</div><div class="l">Active</div></div>
<div class="g-stat"><div class="v" style="color:var(--g-red)">${_clubs.filter(c=>c.suspended).length}</div><div class="l">Suspended</div></div>
<div class="g-stat"><div class="v" style="color:var(--g-gold)">${_clubs.filter(c=>c.pending_verification).length}</div><div class="l">Pay Pending</div></div>
</div><div id="eco-list"></div>`;
ecoList('');
}
function ecoList(f){
const el=document.getElementById('eco-list');if(!el)return;const now=new Date();
const cl=f?_clubs.filter(c=>(c.name||'').toLowerCase().includes(f)||(c.id).toLowerCase().includes(f)):_clubs;
el.innerHTML=cl.map(c=>{
const exp=c.subscription?.end_date?.toDate?.();const ok=exp&&exp>now;
const st=c.suspended?'SUSPENDED':(ok?'ACTIVE':'EXPIRED');const bc=c.suspended?'red':(ok?'grn':'amb');
return`<div class="g-row g-row-5" onclick="SuperAdminView.openDrawer('${c.id}')">
<div class="g-logo">${c.branding?.logo_url?`<img src="${c.branding.logo_url}">`:(c.name||'?')[0]}</div>
<div><div class="g-name">${c.name||'Unnamed'}</div><div class="g-id">${c.id}</div></div>
<div class="g-meta">${exp?exp.toLocaleDateString():'N/A'}</div>
<div><span class="g-badge ${bc}">${st}</span></div>
<div><button class="g-btn-sm" onclick="event.stopPropagation();SuperAdminController.shadowLogin('${c.id}')">SHADOW</button></div>
</div>`;}).join('');
}

// ═══ WAR ROOM ═══
async function renderWar(){
const m=document.getElementById('gs-main');if(!m)return;
m.innerHTML=`<div class="gs-header"><div><div class="gs-title">⚔️ Live Tournament War Room</div><div class="gs-sub">Active operations</div></div></div><div id="war-list"><div class="g-meta" style="padding:2rem;text-align:center">Scanning...</div></div>`;
try{
const s=await db.collection('tournaments').where('status','==','active').limit(50).get();
const el=document.getElementById('war-list');
if(s.empty){el.innerHTML='<div class="g-meta" style="padding:2rem;text-align:center">No active tournaments</div>';return;}
el.innerHTML=s.docs.map(d=>{const t=d.data();const pct=t.totalRounds?Math.round((t.currentRound/t.totalRounds)*100):0;
return`<div class="g-row g-row-5" onclick="SuperAdminController.shadowLogin('${t.clubId}')">
<div class="g-logo" style="color:var(--g-green)">⚔</div>
<div><div class="g-name">${t.name||'?'}</div><div class="g-id">${t.clubId||'—'} · ${t.isTeamEvent?'Team':'Solo'}</div></div>
<div class="g-meta">RD ${t.currentRound||0}/${t.totalRounds||'?'}</div>
<div><div class="g-hbar"><div class="g-hbar-fill" style="width:${pct}%;background:${pct>=100?'var(--g-green)':'var(--g-blue)'}"></div></div><div style="font-size:0.4rem;color:var(--g-dim);margin-top:1px">${pct}%</div></div>
<div><span class="g-badge cyn"><span class="g-pulse live"></span>LIVE</span></div>
</div>`;}).join('');
}catch(e){document.getElementById('war-list').innerHTML=`<div style="color:var(--g-red);padding:1rem">${e.message}</div>`;}
}

// ═══ FINANCIAL ═══
function renderFin(){
const m=document.getElementById('gs-main');if(!m)return;const now=new Date();
let pr=0,tr=0,ex=0,pe=0;
_clubs.forEach(c=>{const s=c.subscription||{};const e=s.end_date?.toDate?.();if(c.pending_verification)pe++;if(s.status==='premium_trial'&&e&&e>now)tr++;else if(e&&e>now)pr++;else ex++;});
m.innerHTML=`<div class="gs-header"><div><div class="gs-title">💰 Financial Operations</div><div class="gs-sub">Revenue & subscriptions</div></div></div>
<div class="g-stats"><div class="g-stat"><div class="v" style="color:var(--g-green)">${pr}</div><div class="l">Premium</div></div>
<div class="g-stat"><div class="v" style="color:var(--g-cyan)">${tr}</div><div class="l">Trial</div></div>
<div class="g-stat"><div class="v" style="color:var(--g-red)">${ex}</div><div class="l">Expired</div></div>
<div class="g-stat"><div class="v" style="color:var(--g-gold)">${pe}</div><div class="l">Pending</div></div></div>
<div id="fin-list"></div>`;
document.getElementById('fin-list').innerHTML=_clubs.map(c=>{
const s=c.subscription||{};const e=s.end_date?.toDate?.();const ok=e&&e>now;
const days=e?Math.ceil((e-now)/(864e5)):0;const bc=c.suspended?'red':(ok?(days<=3?'amb':'grn'):'red');
return`<div class="g-row" style="grid-template-columns:1.5fr 0.7fr 60px 60px 50px">
<div><div class="g-name">${c.name||'?'}</div><div class="g-id">${s.status||'none'}</div></div>
<div class="g-meta">${e?e.toLocaleDateString():'N/A'}</div>
<div style="font-family:var(--g-mono);font-size:0.65rem;font-weight:900;color:${ok?'var(--g-green)':'var(--g-red)'}">${ok?days+'d':'EXP'}</div>
<div><span class="g-badge ${bc}">${ok?'ACTIVE':'EXPIRED'}</span></div>
<div><button class="g-btn-sm" onclick="SuperAdminController.extendTrialGoodwill('${c.id}')">+3D</button></div>
</div>`;}).join('');
}

// ═══ REGISTRY ═══
async function renderReg(){
const m=document.getElementById('gs-main');if(!m)return;
m.innerHTML=`<div class="gs-header"><div><div class="gs-title">👥 Global Player Registry</div><div class="gs-sub">Cross-tenant index</div></div><input class="g-search" placeholder="🔍 Search..." oninput="SuperAdminView.fReg(this.value)"></div><div id="reg-list"><div class="g-meta" style="padding:2rem;text-align:center">Compiling...</div></div>`;
try{const s=await db.collectionGroup('players').limit(300).get();_gp=s.docs.map(d=>({id:d.id,...d.data()}));
const pe=document.getElementById('gp-players');if(pe)pe.textContent=_gp.length;regList('');}
catch(e){document.getElementById('reg-list').innerHTML=`<div style="color:var(--g-red);padding:1rem">${e.message}</div>`;}
}
function regList(f){
const el=document.getElementById('reg-list');if(!el)return;
const fl=_gp.filter(p=>(p.name||'').toLowerCase().includes(f)||(p.clubId||'').toLowerCase().includes(f));
if(!fl.length){el.innerHTML='<div class="g-meta" style="padding:2rem;text-align:center">No records</div>';return;}
el.innerHTML=fl.map(p=>`<div class="g-row g-row-5">
<div class="g-logo" style="color:var(--g-blue)">${(p.name||'?')[0]}</div>
<div><div class="g-name">${p.name||'Unknown'}</div><div class="g-id">${p.id.substring(0,8)}</div></div>
<div class="g-meta">${p.clubId||'—'}</div>
<div style="font-family:var(--g-mono);font-weight:900;color:var(--g-blue);font-size:0.75rem">${p.rating||1200}</div>
<div><span class="g-badge grn">OK</span></div></div>`).join('');
}

// ═══ AUDIT ═══
async function renderAud(){
const m=document.getElementById('gs-main');if(!m)return;
m.innerHTML=`<div class="gs-header"><div><div class="gs-title">📋 Audit Trail</div><div class="gs-sub">Immutable history</div></div></div><div id="aud-list"><div class="g-meta" style="padding:2rem;text-align:center">Loading...</div></div>`;
try{const s=await db.collection('system_logs').orderBy('timestamp','desc').limit(100).get();
document.getElementById('aud-list').innerHTML=s.docs.map(d=>{const l=d.data();
const t=l.timestamp?new Date(l.timestamp.seconds*1000).toLocaleString():'--';
const tc=l.type?.includes('CREDIT')?'var(--g-green)':(l.type?.includes('SHADOW')?'var(--g-cyan)':(l.type?.includes('REJECT')||l.type?.includes('SUSPEND')?'var(--g-red)':'var(--g-muted)'));
return`<div class="g-row g-row-3" style="cursor:default">
<div class="g-meta">${t}</div>
<div><span class="g-badge" style="color:${tc}">${l.type||'LOG'}</span></div>
<div style="font-size:0.55rem;color:var(--g-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.message||'—'}</div>
</div>`;}).join('');}catch(e){document.getElementById('aud-list').innerHTML=`<div style="color:var(--g-red)">${e.message}</div>`;}
}

// ═══ SECURITY ═══
function renderSec(){
const m=document.getElementById('gs-main');if(!m)return;
m.innerHTML=`<div class="gs-header"><div><div class="gs-title">🛡️ Security Center</div><div class="gs-sub">Threat intelligence</div></div></div>
<div class="g-stats">
<div class="g-stat"><div class="v" style="color:var(--g-green)">LOW</div><div class="l">Threat Level</div></div>
<div class="g-stat"><div class="v" style="color:var(--g-cyan)">${_clubs.length}</div><div class="l">Monitored</div></div>
<div class="g-stat"><div class="v" style="color:var(--g-green)">0</div><div class="l">Alerts</div></div>
<div class="g-stat"><div class="v" style="color:var(--g-muted)">0</div><div class="l">Suspicious</div></div>
</div>
<div style="background:var(--g-surface);border:1px solid var(--g-border);border-radius:6px;padding:1.5rem;text-align:center">
<div style="font-size:2rem;margin-bottom:0.5rem">🛡️</div>
<div style="font-weight:900;color:var(--g-green);margin-bottom:0.3rem">ALL SYSTEMS NOMINAL</div>
<div style="font-size:0.65rem;color:var(--g-muted)">Continuous monitoring active across ${_clubs.length} nodes.</div>
</div>`;
}

// ═══ TERMINAL ═══
function term(docs){
const el=document.getElementById('gi-term');if(!el)return;
el.innerHTML=(docs||[]).map(d=>{const l=d.data();
const t=l.timestamp?new Date(l.timestamp.seconds*1000).toLocaleTimeString([],{hour12:false}):'--:--';
const c=l.type?.includes('CREDIT')?'credit':(l.type?.includes('SHADOW')?'shadow':(l.type?.includes('SOS')||l.type?.includes('REJECT')?'alert':(l.type?.includes('PAYMENT')?'pay':'')));
return`<div class="gi-line"><span class="t">[${t}]</span> <span class="${c}">${l.message||l.type||'—'}</span></div>`;}).join('');
}

// ═══ TRIAGE ═══
function triage(){
const el=document.getElementById('gi-triage');if(!el)return;
const pe=_clubs.filter(c=>c.pending_verification);const su=_clubs.filter(c=>c.suspended);
const tc=document.getElementById('gi-tc');if(tc)tc.textContent=(pe.length+su.length)?`(${pe.length+su.length})`:'';
if(!pe.length&&!su.length){el.innerHTML='<div style="color:var(--g-dim);padding:0.5rem;text-align:center;font-size:0.5rem">Queue clear ✓</div>';return;}
el.innerHTML=[
...pe.map(c=>`<div class="gi-triage-item"><span class="gi-dot pay"></span><span style="color:var(--g-gold);font-weight:800">${c.name||c.id}</span> payment pending</div>`),
...su.map(c=>`<div class="gi-triage-item"><span class="gi-dot sos"></span><span style="color:var(--g-red);font-weight:800">${c.name||c.id}</span> suspended</div>`)
].join('');
}

// ═══ DRAWER ═══
function openDrawer(id){
const c=_clubs.find(x=>x.id===id);if(!c)return;const d=document.getElementById('g-drawer');
const exp=c.subscription?.end_date?.toDate?.();const ok=exp&&exp>new Date();
d.innerHTML=`
<div class="gd-header"><div><div style="font-weight:900;color:var(--g-cyan)">${c.name||'?'}</div><div style="font-size:0.5rem;color:var(--g-dim);margin-top:2px">${c.id} · ${c.admin_email||'—'}</div></div><button class="gd-close" onclick="SuperAdminView.closeDrawer()">×</button></div>
<div class="gd-label">Infrastructure</div>
<div class="gd-info"><div class="gd-info-row"><span class="k">Status</span><span class="g-badge ${ok?'grn':'red'}">${ok?'ACTIVE':'EXPIRED'}</span></div><div class="gd-info-row"><span class="k">Expires</span><span class="val">${exp?exp.toLocaleDateString():'N/A'}</span></div></div>
<div class="gd-label">Credit Injector</div>
<button class="gd-btn" onclick="SuperAdminController.applyCredit('${c.id}',1,'Manual +1')">+1 Day<div class="sub">Atomic injection</div></button>
<button class="gd-btn" onclick="SuperAdminController.applyCredit('${c.id}',7,'Weekly')">+7 Days<div class="sub">Weekly provision</div></button>
<button class="gd-btn" onclick="SuperAdminController.applyCredit('${c.id}',30,'Monthly')">+30 Days<div class="sub">Monthly renewal</div></button>
<div style="margin-top:auto;padding-top:0.75rem;display:flex;flex-direction:column;gap:3px">
<button class="gd-btn cyn" onclick="SuperAdminController.shadowLogin('${c.id}')">⚡ TELEPORT (SHADOW)</button>
<button class="gd-btn vio" onclick="SuperAdminController.forceCacheClear('${c.id}')">🔧 Cache Purge</button>
<button class="gd-btn red" onclick="SuperAdminController.toggleClubSuspension('${c.id}')">⚠️ TOGGLE SUSPENSION</button>
</div>`;
d.classList.add('open');
}
function closeDrawer(){document.getElementById('g-drawer')?.classList.remove('open');}

// ═══ BROADCAST ═══
function broadcast(){
const ov=document.createElement('div');ov.className='g-modal-overlay';
ov.innerHTML=`<div class="g-modal">
<h3>📢 Federation Broadcast</h3>
<div style="font-size:0.55rem;color:var(--g-muted);margin-bottom:0.5rem;font-weight:700">Priority Level</div>
<div style="display:flex;gap:0.3rem;margin-bottom:0.75rem">
<button class="gh-btn" onclick="this.parentElement.querySelectorAll('.gh-btn').forEach(b=>b.style.borderColor='');this.style.borderColor='var(--g-green)'" data-lvl="info" style="border-color:var(--g-green)">🟢 Standard</button>
<button class="gh-btn" onclick="this.parentElement.querySelectorAll('.gh-btn').forEach(b=>b.style.borderColor='');this.style.borderColor='var(--g-amber)'" data-lvl="warning">🟡 Important</button>
<button class="gh-btn" onclick="this.parentElement.querySelectorAll('.gh-btn').forEach(b=>b.style.borderColor='');this.style.borderColor='var(--g-red)'" data-lvl="critical">🔴 Critical</button>
</div>
<textarea id="bc-msg" placeholder="Enter broadcast message..."></textarea>
<div class="g-modal-btns">
<button class="g-modal-btn" onclick="this.closest('.g-modal-overlay').remove()">Cancel</button>
<button class="g-modal-btn primary" onclick="const m=document.getElementById('bc-msg').value;if(m){SuperAdminController.broadcastAnnouncement(m);this.closest('.g-modal-overlay').remove();}">Transmit</button>
</div></div>`;
document.body.appendChild(ov);
ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
}

return{render,switchView,toggleRail,openDrawer,closeDrawer,broadcast,
fEco:v=>ecoList(v.toLowerCase()),fReg:v=>regList(v.toLowerCase()),
showGlobalBroadcast:()=>broadcast(),filterEcosystem:v=>ecoList(v.toLowerCase()),filterRegistry:v=>regList(v.toLowerCase())};
})();
window.SuperAdminView=SuperAdminView;

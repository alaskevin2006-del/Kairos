import {documentEditor} from './editor.js';
import {marked} from 'marked';
import DOMPurify from 'dompurify';
import {secretaryUI} from './secretary-ui.js';

const root=document.querySelector('#app');
const adminPage=document.querySelector('meta[name="kairos-space"]')?.content==='admin';
const appBase=new URL(adminPage?'../':'.',location.href).pathname;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const date=s=>new Date(s+'T00:00:00Z');
const key=d=>d.toISOString().slice(0,10);
const add=(s,n)=>{const d=date(s);d.setUTCDate(d.getUTCDate()+n);return key(d);};
const monday=s=>add(s,-((date(s).getUTCDay()+6)%7));
const fmt=s=>{const d=date(s);return `${d.getUTCMonth()+1}月${d.getUTCDate()}日`;};
const clock=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
let page=location.hash.slice(1)||'overview',week=monday(today()),month=today().slice(0,7),view='week',query='',selected={},snapshot=null,session=null,busy=false;
let error='',syncStatus='';
let adminUsers=null;
let focusDay=today();const journalOpen={personal:true,ai:false};
let showCourses=false,uiAccount='';
async function api(url,body){const r=await fetch(appBase+url.replace(/^\//,''),{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok){if(r.status===401)session={authenticated:false};throw Error(d.error||'请求失败');}return d;}
const secretary=secretaryUI({api,esc,markdown:renderMarkdown,modal,toast,refresh,localSettings:settings,openDocument:p=>window.kairos?window.kairos.openObsidian(p).catch(e=>toast(e.message)):editor.openFile(p),browseFiles:()=>editor.browse({open:window.kairos?(p=>window.kairos.openObsidian(p).catch(e=>toast(e.message))):undefined}),pendingItems:()=>snapshot?[...snapshot.events.filter(e=>e.date===today()&&!e.timeKnown&&!e.done),...snapshot.pending.filter(e=>!e.done)]:[]});
const editor=documentEditor({api,esc,markdown:renderMarkdown,modal,toast,refresh,account:()=>session?.spaceId||session?.user?.id||'local'});
function brand(){return `<img class="brand-logo" src="${appBase}logo.png?v=1.0.2" alt="" aria-hidden="true" width="44" height="44"><span>Kairos</span>`;}
function header(){return `<header class="masthead"><a class="wordmark" href="#overview" aria-label="Kairos">${brand()}</a><nav aria-label="主导航">${[['overview','总览'],['secretary','秘书'],['goals','目标'],['reviews','日记']].map(([id,label])=>`<a href="#${id}" class="${page===id?'active':''}" ${page===id?'aria-current="page"':''}>${label}</a>`).join('')}</nav><div class="header-tools">${session.local?'':'<button class="quiet" id="logout">退出</button>'}</div></header>`;}
function login(){root.innerHTML=`<main class="login"><div class="login-brand">${brand()}</div><h1>${adminPage?'管理员登录':'回到自己的节奏'}</h1><form id="login-form"><label>账号<input name="username" autocomplete="username" value="${adminPage?'admin':'kevin'}" required></label><label>密码<input name="password" type="password" autocomplete="current-password" required></label><p class="form-error" role="alert">${esc(error)}</p><button type="submit" class="primary">登录</button></form></main>`;document.querySelector('#login-form').onsubmit=async e=>{e.preventDefault();const submit=e.target.querySelector('button');submit.disabled=true;try{await api('/api/login',Object.fromEntries(new FormData(e.target)));session=await api('/api/session');error='';await refresh(true);}catch(err){error=err.message;login();}};}
function render(){
  if(!session?.authenticated){secretary.reset();uiAccount='';document.querySelector('dialog')?.remove();return login();}
  if(session.user?.role==='admin'){if(!adminPage){location.replace(appBase+'admin/');return;}return renderAdmin();}
  if(adminPage){location.replace(appBase);return;}
  if(uiAccount!==(session.spaceId||session.user?.id||'local')){secretary.reset();uiAccount=session.spaceId||session.user?.id||'local';}
  if(!['overview','secretary','goals','reviews'].includes(page))page='overview';
  const scroll=document.querySelector('.calendar-scroll')?.scrollTop||0;
  root.innerHTML=header()+`<main class="workspace">${error||snapshot?.error?`<div class="notice" role="alert">${esc(error||snapshot.error)}</div>`:''}${!snapshot?'<div class="empty">正在读取内容…</div>':page==='overview'?overview():page==='secretary'?secretary.html():documents()}</main><div class="live-status" aria-live="polite">${esc(syncStatus)}</div>`;
  if(page==='overview')bindCalendar();else if(page==='secretary')secretary.bind();else bindDocuments();
  const cal=document.querySelector('.calendar-scroll');if(cal)cal.scrollTop=scroll||8*60;
  document.querySelector('#logout')?.addEventListener('click',async()=>{await api('/api/logout',{});secretary.reset();uiAccount='';session={authenticated:false};snapshot=null;render();});
}
function overview(){
  return `<section class="overview-layout"><div class="calendar panel"><div class="calendar-toolbar"><div><h1>${view==='week'?`${week.slice(0,4)}年${fmt(week)}—${fmt(add(week,6))}`:`${month.slice(0,4)}年${+month.slice(5)}月`}</h1></div><div class="calendar-controls">${view==='month'?`<label class="calendar-filter"><input id="show-courses" type="checkbox" ${showCourses?'checked':''}>显示课程</label>`:''}<div class="week-control"><button id="previous" aria-label="上一${view==='week'?'周':'月'}">‹</button><button id="current">本${view==='week'?'周':'月'}</button><button id="next" aria-label="下一${view==='week'?'周':'月'}">›</button></div><div class="view-switch"><button id="week-view" class="${view==='week'?'chosen':''}">周</button><button id="month-view" class="${view==='month'?'chosen':''}">月</button></div></div></div>${upcomingDeadlines()}${view==='week'?weekView():monthView()}</div>${overviewAgenda()}</section>`;
}
function eventTime(e){return (e.kind==='deadline'?'截止 · ':'')+(e.timeKnown||e.kind==='course'?clock(e.start)+(e.end>e.start?'—'+clock(e.end):''):e.timeHint||'时间未定');}
function upcomingDeadlines(){
 const deadlines=snapshot.events.filter(e=>e.kind==='deadline'&&!e.done&&e.date>=today()).sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start).slice(0,5);
 if(!deadlines.length)return '';
 return `<details class="upcoming-deadlines"><summary>近期截止 · ${deadlines.length}</summary>${deadlines.map(e=>`<button class="agenda-row" data-event="${esc(e.id)}"><strong>${esc(e.title)}</strong><small>${esc(e.date)} · ${esc(eventTime(e))}</small></button>`).join('')}</details>`;
}
function overviewAgenda(){
 const loose=snapshot.events.filter(e=>e.date===focusDay&&!e.done&&!e.timeKnown&&e.kind!=='course');
 const optional=snapshot.pending.filter(e=>!e.done&&/弹性/.test(e.section||'')&&!/搁置|不追踪|不自动恢复|未确认开展/.test(e.content||''));
 const row=e=>`<button class="agenda-row" data-source="${esc(e.source)}"><strong>${esc(e.title)}</strong>${e.timeHint?`<small>${esc(e.timeHint)}</small>`:''}</button>`;
 return `<aside class="agenda panel"><h2>待安排事项</h2><label class="agenda-date">日期 <input id="agenda-day" type="date" value="${focusDay}"></label><section><h3>${focusDay===today()?'今天要做':'当天事项'} · 未定时间</h3><div class="agenda-loose">${loose.map(row).join('')||'<p class="subtle">暂无事项</p>'}</div></section><section><h3>有空再做</h3><div class="agenda-loose">${optional.map(row).join('')||'<p class="subtle">暂无已确认的弹性事项</p>'}</div></section></aside>`;
}
function weekView(){
 const days=Array.from({length:7},(_,i)=>add(week,i)),all=snapshot.events.filter(e=>days.includes(e.date));
 const heads=days.map((d,i)=>`<div class="day-heading ${d===today()?'today':''}"><button data-focus-day="${d}">${['周一','周二','周三','周四','周五','周六','周日'][i]} ${+d.slice(8)}</button><button class="date-marker" data-focus-day="${d}">${all.filter(e=>e.date===d&&!e.timeKnown&&e.kind!=='course').length} 项时间未定</button></div>`).join('');
 const cols=days.map(day=>{
  const events=all.filter(e=>e.date===day&&(e.timeKnown||e.kind==='course')).sort((a,b)=>a.start-b.start||a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id));
  const groups=[];for(const e of events){const last=groups.at(-1);if(last&&e.start<last.end){last.items.push(e);last.end=Math.max(last.end,e.end,e.start+35);}else groups.push({start:e.start,end:Math.max(e.end,e.start+35),items:[e]});}
  const blocks=groups.map(g=>{const e=g.items[0];return `<button class="event ${e.kind} ${e.done?'done':''}" ${g.items.length>1?`data-date="${day}"`:`data-event="${esc(e.id)}"`} style="top:${g.start}px;height:${Math.max(35,g.end-g.start)}px;left:4px;right:4px;width:auto" title="${esc(g.items.map(e=>e.title).join('；'))}"><strong>${esc(e.title)}</strong><small>${e.end>e.start?'结束 '+clock(e.end):clock(e.start)}</small>${g.items.length>1?`<b class="more">另有 ${g.items.length-1} 项 · 展开</b>`:e.location?`<small>${esc(e.location)}</small>`:''}</button>`;}).join('');
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()).split(':').map(Number),minute=parts[0]*60+parts[1];
  return `<div class="day-column" style="height:1440px;--hour-height:60px">${blocks}${day===today()?`<div class="now-line" style="top:${minute}px"><span>此刻</span></div>`:''}</div>`;
 }).join('');
 return `<div class="week-head"><div></div>${heads}</div><div class="calendar-scroll"><div class="week-body" style="height:1440px"><div class="time-axis">${Array.from({length:24},(_,h)=>`<span style="top:${h*60}px">${String(h).padStart(2,'0')}:00</span>`).join('')}</div>${cols}</div></div>`;
}
function monthView(){
  const first=month+'-01',start=monday(first);
  return `<div class="month-head">${['周一','周二','周三','周四','周五','周六','周日'].map(s=>`<span>${s}</span>`).join('')}</div><div class="month-grid">${Array.from({length:42},(_,i)=>{const d=add(start,i),events=snapshot.events.filter(e=>e.date===d&&!e.done&&(e.kind!=='course'||showCourses)).sort((a,b)=>a.start-b.start);return `<div class="month-day ${d.slice(0,7)!==month?'outside':''} ${d===today()?'today':''}"><button class="month-date" data-date="${d}" title="查看当天安排">${+d.slice(8)}</button>${events.slice(0,4).map(e=>`<button class="month-event ${e.kind==='deadline'?'month-ddl':''}" data-event="${esc(e.id)}">${e.kind==='deadline'?'◇ ':''}${!e.timeKnown&&e.kind!=='course'?'时间未定':clock(e.start)} ${esc(e.title)}</button>`).join('')}${events.length>4?`<button class="more" data-date="${d}">另 ${events.length-4} 项</button>`:''}</div>`;}).join('')}</div>`;
}
function bindCalendar(){
 const chooseDay=d=>{if(!d)return;focusDay=d;week=monday(d);month=d.slice(0,7);render();};
 document.querySelector('#agenda-day').onchange=e=>chooseDay(e.target.value);
 document.querySelectorAll('[data-focus-day]').forEach(b=>b.onclick=()=>chooseDay(b.dataset.focusDay));
 document.querySelector('#browse-files')?.addEventListener('click',()=>editor.browse());document.querySelectorAll('[data-source]').forEach(b=>b.onclick=()=>window.kairos?window.kairos.openObsidian(b.dataset.source).catch(e=>toast(e.message)):editor.openFile(b.dataset.source,{edit:true}));
  const change=n=>{if(view==='week'){week=add(week,n*7);focusDay=week;}else{const d=date(month+'-01');d.setUTCMonth(d.getUTCMonth()+n);month=key(d).slice(0,7);focusDay=month+'-01';}render();};
  document.querySelector('#previous').onclick=()=>change(-1);document.querySelector('#next').onclick=()=>change(1);
  document.querySelector('#current').onclick=()=>{focusDay=today();week=monday(focusDay);month=focusDay.slice(0,7);render();};
  document.querySelector('#week-view').onclick=()=>{if(view==='month')week=monday(month+'-01');view='week';render();};
  document.querySelector('#month-view').onclick=()=>{month=add(week,3).slice(0,7);view='month';render();};
  document.querySelector('#show-courses')?.addEventListener('change',e=>{showCourses=e.target.checked;render();});
  document.querySelectorAll('[data-date]').forEach(el=>el.onclick=()=>dayDetail(el.dataset.date));
  document.querySelectorAll('[data-event]').forEach(el=>el.onclick=()=>detail(snapshot.events.find(e=>e.id===el.dataset.event)));
  document.querySelectorAll('[data-deadlines]').forEach(el=>el.onclick=()=>{const [day,at]=el.dataset.deadlines.split('|');const items=snapshot.events.filter(e=>e.date===day&&e.kind==='deadline'&&e.start===+at);const d=modal(`<h2>${fmt(day)} ${clock(+at)}</h2><div class="day-detail">${items.map(e=>`<button class="day-detail-item ${e.done?'done':''}" data-deadline-item="${esc(e.id)}"><strong>${esc(e.title)}</strong></button>`).join('')}</div>`);d.querySelectorAll('[data-deadline-item]').forEach(b=>b.onclick=()=>detail(items.find(e=>e.id===b.dataset.deadlineItem)));});
  document.querySelectorAll('[data-task]').forEach(el=>el.onclick=()=>detail(snapshot.pending.find(e=>e.id===el.dataset.task)));
}
function documents(){
  const docs=snapshot.documents.filter(d=>d.type===page);
  const filtered=docs.filter(d=>(d.title+' '+d.markdown).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  if(!docs.some(d=>d.id===selected[page]))selected[page]=docs[0]?.id;
  const doc=docs.find(d=>d.id===selected[page]);
  const title=d=>d.title.replace(/(?:^|\s)#长期(?=\s|$)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*_`~]/g,'');
  const rows=list=>list.map(d=>`<button class="doc-item ${d.id===doc?.id?'selected':''}" data-doc="${esc(d.id)}"><strong>${esc(title(d))}</strong>${page==='reviews'?`<small>${esc((d.generatedAt||d.recordedAt||d.modifiedAt).slice(0,10))}</small>`:''}</button>`).join('')||'<p class="empty small">没有匹配的文档</p>';
  const groups=page==='reviews'?[['personal','我的日记'],['ai','AI 研析']].map(([id,label])=>{const list=filtered.filter(d=>(d.author==='AI')===(id==='ai'));return `<details class="journal-group" data-journal-group="${id}" ${journalOpen[id]||query?'open':''}><summary>${label} · ${list.length}</summary>${rows(list)}</details>`;}).join(''):rows(filtered);
  return `<section class="document-layout panel"><aside class="document-list"><label class="doc-search"><span aria-hidden="true">⌕</span><input id="doc-query" aria-label="搜索文档" placeholder="搜索文档" value="${esc(query)}"></label><div class="doc-items">${groups}</div></aside><article class="document-reader">${doc?`<div class="document-bar"><strong>${esc(title(doc))}</strong> <button id="edit-current" class="primary" data-path="${esc(doc.path)}">${window.kairos?'在 Obsidian 中打开':'编辑'}</button></div><div class="markdown">${renderMarkdown(doc.markdown,{preserveLines:page==='reviews',hideTags:page==='goals'})}</div>`:`<div class="empty"><p>还没有文档</p><a href="#secretary">到秘书页浏览文件</a></div>`}</article></section>`;

}
function renderMarkdown(text,{preserveLines=true,hideTags=false}={}){if(hideTags)text=text.replace(/^(#{1,6} .+?)\s+#长期(?=\s|$)/gm,'$1');text=text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,(_m,target,label)=>{const [file,anchor]=target.split('#');return '['+(label||target)+'](/'+file+(file.endsWith('.md')?'':'.md')+(anchor?'#'+anchor:'')+')';});const html=marked.parse(text,{gfm:true,breaks:preserveLines}).replace(/<input\b[^>]*>/gi,tag=>/type="checkbox"/.test(tag)?(/\bchecked\b/.test(tag)?'☑ ':'☐ '):'');return DOMPurify.sanitize(html,{FORBID_TAGS:['style','iframe','form','input','button','video','audio'],FORBID_ATTR:['style'],ALLOW_DATA_ATTR:false});}
function bindDocuments(){
 document.querySelector('#browse-files')?.addEventListener('click',()=>editor.browse()); document.querySelector('#edit-current')?.addEventListener('click',e=>window.kairos?window.kairos.openObsidian(e.target.dataset.path).catch(err=>toast(err.message)):editor.openFile(e.target.dataset.path,{edit:true}));
 document.querySelectorAll('[data-journal-group]').forEach(d=>d.ontoggle=()=>{if(!query)journalOpen[d.dataset.journalGroup]=d.open;});
  const input=document.querySelector('#doc-query');if(input)input.oninput=e=>{const pos=e.target.selectionStart;query=e.target.value;render();const next=document.querySelector('#doc-query');next.focus();next.setSelectionRange(pos,pos);};
  document.querySelectorAll('[data-doc]').forEach(el=>el.onclick=()=>{selected[page]=el.dataset.doc;render();});
  document.querySelectorAll('.markdown a').forEach(a=>{
    const href=a.getAttribute('href');if(!href)return;
    if(/^https?:\/\//i.test(href)){a.target='_blank';a.rel='noopener noreferrer';return;}
    if(href.startsWith('#'))return;
    a.onclick=e=>{e.preventDefault();const current=snapshot.documents.find(d=>d.id===selected[page]);const target=new URL(href,new URL(current.path,'https://workspace.invalid/'));if(target.origin!=='https://workspace.invalid')return toast('不支持此链接');const file=decodeURIComponent(target.pathname.slice(1));if(window.kairos)window.kairos.openObsidian(file).catch(err=>toast(err.message));else editor.openFile(file+target.hash);};
  });
}
function modal(html){document.querySelector('dialog')?.remove();const dialog=document.createElement('dialog');dialog.innerHTML=`<button class="close" aria-label="关闭">×</button>${html}`;document.body.append(dialog);dialog.querySelector('.close').onclick=()=>dialog.close();dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();return dialog;}
function detail(e){if(!e)return;const d=modal(`<h2>${esc(e.title)}</h2>${e.date?`<p class="subtle">${esc(e.date)} ${!e.timeKnown&&e.kind!=='course'?'当天 · 时间未定':e.kind==='deadline'?clock(e.start):clock(e.start)+'—'+clock(e.end)}</p>`:''}<div class="markdown">${renderMarkdown(e.content)}</div><p class="source">${esc(e.source)}</p><div class="form-actions">${e.editable&&!e.done?'<button class="primary" id="complete-item">标记完成</button>':e.done?'<span class="subtle">已完成</span>':''}${e.source?'<button class="quiet" id="open-source">查看原文</button>':''}</div>`);d.querySelector('#open-source')?.addEventListener('click',()=>window.kairos?window.kairos.openObsidian(e.source).catch(err=>toast(err.message)):editor.openFile(e.source,{edit:true}));d.querySelector('#complete-item')?.addEventListener('click',async ev=>{ev.target.disabled=true;try{await api('/api/workspace/complete',{id:e.id});d.close();await refresh(true);toast('已记录完成，可在修改记录中撤销');}catch(err){ev.target.disabled=false;toast(err.message);}});}
function dayDetail(day){const items=snapshot.events.filter(e=>e.date===day).sort((a,b)=>(a.timeKnown||a.kind==='course'?0:1)-(b.timeKnown||b.kind==='course'?0:1)||((!a.timeKnown&&!b.timeKnown)?Number(b.important)-Number(a.important):0)||a.start-b.start||a.id.localeCompare(b.id));const d=modal(`<h2>${esc(day)} · 当天安排</h2><div class="day-detail">${items.map(e=>`<button class="day-detail-item ${e.done?'done':''}" data-day-item="${esc(e.id)}"><span>${esc(eventTime(e))}</span><strong>${esc(e.title)}</strong></button>`).join('')||'<p class="subtle">当天没有安排</p>'}</div><button class="quiet" id="open-day-week">查看这一周</button>`);d.querySelectorAll('[data-day-item]').forEach(el=>el.onclick=()=>detail(items.find(e=>e.id===el.dataset.dayItem)));d.querySelector('#open-day-week').onclick=()=>{week=monday(day);view='week';d.close();render();};}
function renderAdmin(){
 root.innerHTML=`<header class="masthead admin-masthead"><a class="wordmark" href="${appBase}admin/" aria-label="Kairos 管理后台">${brand()}</a><span class="admin-label">管理后台</span><div class="header-tools"><span class="admin-identity">${esc(session.user.username)}</span><button class="quiet" id="logout">退出登录</button></div></header><main class="admin-workspace"><h1>账号管理</h1>${error?`<p class="notice" role="alert">${esc(error)}</p>`:''}<section class="panel admin-account-panel"><form id="create-user" class="create-user"><label>新账号<input name="username" aria-label="新账号" placeholder="3—32位字母或数字" pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}" required></label><button class="primary" type="submit">创建账号</button></form><p class="form-error" id="admin-error" role="alert"></p><div class="admin-table-scroll"><table class="admin-account-table"><thead><tr><th>账号</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody>${adminUsers?adminUsers.map(u=>`<tr><td><strong>${esc(u.username)}</strong></td><td>${u.role==='admin'?'管理员':'普通账号'}</td><td>${u.active?'已启用':'已停用'}</td><td>${u.id!==session.user.id?`<button class="quiet" data-account="${esc(u.id)}" data-operation="reset-password">重置密码</button><button class="quiet" data-account="${esc(u.id)}" data-operation="${u.active?'disable':'enable'}">${u.active?'停用':'启用'}</button>`:'<span class="subtle">当前账号</span>'}</td></tr>`).join(''):'<tr><td colspan="4">正在读取账号…</td></tr>'}</tbody></table></div></section></main>`;
 document.querySelector('#logout').onclick=async()=>{await api('/api/logout',{});session={authenticated:false};adminUsers=null;error='';render();};
 const reload=async()=>{adminUsers=(await api('/api/admin/users')).users;error='';renderAdmin();};
 const reveal=data=>modal(`<h2>${esc(data.user.username)}</h2><p class="subtle">新凭据仅在此显示，请保存后交给账号使用者。</p><label>登录密码<input readonly value="${esc(data.password)}"></label>${data.syncToken?`<label>该账号的同步密钥<input readonly value="${esc(data.syncToken)}"></label>`:''}`);
 document.querySelector('#create-user').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{const result=await api('/api/admin/users',Object.fromEntries(new FormData(e.target)));await reload();reveal(result);}catch(err){document.querySelector('#admin-error').textContent=err.message;button.disabled=false;}};
 document.querySelectorAll('[data-account]').forEach(button=>button.onclick=async()=>{const operation=button.dataset.operation;if(operation==='reset-password'&&!confirm('重置后该账号需要使用新密码登录，继续吗？'))return;button.disabled=true;try{const result=await api('/api/admin/users/'+button.dataset.account,{operation});await reload();if(result.password)reveal(result);}catch(err){document.querySelector('#admin-error').textContent=err.message;button.disabled=false;}});
}
let toastTimer;function toast(text){syncStatus=text;const el=document.querySelector('.live-status');if(el)el.textContent=text;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{syncStatus='';const el=document.querySelector('.live-status');if(el)el.textContent='';},4500);}
async function settings(show=modal){
 if(!window.kairos)return editor.browse();const cfg=await window.kairos.settings();
 const d=show(`<h2>本地空间设置</h2><form><label>本地目录<input name="sourceRoot" value="${esc(cfg.sourceRoot)}"></label><button type="button" id="choose">选择目录</button><label>本地课表 HTML 路径（或通过文件入口导入）<input name="courseFile" value="${esc(cfg.courseFile||'')}"></label><label>独立服务器网址<input name="remoteUrl" value="${esc(cfg.remoteUrl||'')}"></label><p>本地与服务器不自动同步。切换本地目录不会上传文件。</p><button class="primary">保存</button></form>`);d.querySelector('#choose').onclick=async()=>{const p=await window.kairos.chooseFolder();if(p)d.querySelector('[name=sourceRoot]').value=p;};d.querySelector('form').onsubmit=async e=>{e.preventDefault();try{await window.kairos.saveSettings(Object.fromEntries(new FormData(e.target)));session=await api('/api/session');d.close();await refresh(true);}catch(e){toast(e.message);}};
}
async function refresh(force=false){if(busy)return;busy=true;try{if(!session)session=await api('/api/session');if(!session.authenticated)return render();if(session.user?.role==='admin'){if(!adminPage)return render();const data=await api('/api/admin/users');const changed=JSON.stringify(adminUsers)!==JSON.stringify(data.users);adminUsers=data.users;error='';if(force||changed)render();return;}if(adminPage)return render();const data=await api('/api/state');const changed=snapshot?.revision!==data.revision||snapshot?.error!==data.error;snapshot=data;error='';if(force||changed&&page!=='secretary')render();}catch(e){error=e.message;render();}finally{busy=false;}}
window.addEventListener('hashchange',()=>{page=location.hash.slice(1);query='';render();});
window.addEventListener('focus',()=>{if(session?.authenticated)refresh();});
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(snapshot&&session?.authenticated&&!document.querySelector('dialog'))render();},150);});
window.kairos?.onSync?.(status=>toast(status));
refresh(true);setInterval(()=>{if(!document.hidden&&session?.authenticated)refresh();},7000);

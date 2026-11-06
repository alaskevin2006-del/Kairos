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
let showCourses=false,uiAccount='';
async function api(url,body){const r=await fetch(appBase+url.replace(/^\//,''),{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok){if(r.status===401)session={authenticated:false};throw Error(d.error||'请求失败');}return d;}
const icon={left:'‹',right:'›',settings:'⚙',search:'⌕'};
const secretary=secretaryUI({api,esc,markdown:renderMarkdown,modal,toast,refresh,localSettings:settings});
function brand(){return `<img class="brand-logo" src="${appBase}logo.png?v=1.0.2" alt="" aria-hidden="true" width="44" height="44"><span>Kairos</span>`;}
function header(){return `<header class="masthead"><a class="wordmark" href="#overview" aria-label="Kairos">${brand()}</a><nav aria-label="主导航">${[['overview','总览'],['secretary','秘书'],['goals','目标'],['reviews','回顾']].map(([id,label])=>`<a href="#${id}" class="${page===id?'active':''}" ${page===id?'aria-current="page"':''}>${label}</a>`).join('')}</nav><div class="header-tools"><button class="icon-button" id="settings" aria-label="设置" title="设置">${icon.settings}</button>${session.local?'':'<button class="quiet" id="logout">退出</button>'}</div></header>`;}
function login(){root.innerHTML=`<main class="login"><div class="login-brand">${brand()}</div><h1>${adminPage?'管理员登录':'回到自己的节奏'}</h1><form id="login-form"><label>账号<input name="username" autocomplete="username" value="${adminPage?'admin':'kevin'}" required></label><label>密码<input name="password" type="password" autocomplete="current-password" required></label><p class="form-error" role="alert">${esc(error)}</p><button type="submit" class="primary">登录</button></form></main>`;document.querySelector('#login-form').onsubmit=async e=>{e.preventDefault();const submit=e.target.querySelector('button');submit.disabled=true;try{await api('/api/login',Object.fromEntries(new FormData(e.target)));session=await api('/api/session');error='';await refresh(true);}catch(err){error=err.message;login();}};}
function render(){
  if(!session?.authenticated){secretary.reset();uiAccount='';document.querySelector('dialog')?.remove();return login();}
  if(session.user?.role==='admin'){if(!adminPage){location.replace(appBase+'admin/');return;}return renderAdmin();}
  if(adminPage){location.replace(appBase);return;}
  if(uiAccount!==(session.user?.id||'local')){secretary.reset();uiAccount=session.user?.id||'local';}
  if(!['overview','secretary','goals','reviews'].includes(page))page='overview';
  const scroll=document.querySelector('.calendar-scroll')?.scrollTop||0;
  root.innerHTML=header()+`<main class="workspace">${error||snapshot?.error?`<div class="notice" role="alert">${esc(error||snapshot.error)}</div>`:''}${!snapshot?'<div class="empty">正在读取内容…</div>':page==='overview'?overview():page==='secretary'?secretary.html():documents()}</main><div class="live-status" aria-live="polite">${esc(syncStatus)}</div>`;
  if(page==='overview')bindCalendar();else if(page==='secretary')secretary.bind();else bindDocuments();
  const cal=document.querySelector('.calendar-scroll');if(cal)cal.scrollTop=scroll;
  document.querySelector('#settings')?.addEventListener('click',secretary.settings);
  document.querySelector('#logout')?.addEventListener('click',async()=>{await api('/api/logout',{});secretary.reset();uiAccount='';session={authenticated:false};snapshot=null;render();});
}
function overview(){
  return `<section class="overview-layout"><div class="calendar panel"><div class="calendar-toolbar"><div><h1>${view==='week'?`${week.slice(0,4)}年${fmt(week)}—${fmt(add(week,6))}`:`${month.slice(0,4)}年${+month.slice(5)}月`}</h1></div><div class="calendar-controls">${view==='month'?`<label class="calendar-filter"><input id="show-courses" type="checkbox" ${showCourses?'checked':''}>显示课程</label>`:''}<div class="week-control"><button id="previous" aria-label="上一${view==='week'?'周':'月'}">‹</button><button id="current">本${view==='week'?'周':'月'}</button><button id="next" aria-label="下一${view==='week'?'周':'月'}">›</button></div><div class="view-switch"><button id="week-view" class="${view==='week'?'chosen':''}">周</button><button id="month-view" class="${view==='month'?'chosen':''}">月</button></div></div></div>${view==='week'?weekView():monthView()}</div><aside class="pending panel"><h2>待安排</h2><div class="pending-list">${snapshot.pending.filter(t=>!t.done).length?snapshot.pending.filter(t=>!t.done).map(t=>`<button class="pending-item" data-task="${esc(t.id)}"><span>${esc(t.title)}</span></button>`).join(''):'<div class="empty small">没有无日期的待安排事项</div>'}</div></aside></section>`;
}
function weekView(){
  const days=Array.from({length:7},(_,i)=>add(week,i));
  const all=snapshot.events.filter(e=>days.includes(e.date));
  const earliest=Math.min(480,...all.filter(e=>e.kind!=='deadline'&&e.kind!=='date').map(e=>e.start));
  const startHour=Math.max(0,Math.floor(earliest/60));const available=Math.max(430,window.innerHeight-310);const height=Math.min((24-startHour)*46,available-32);
  const timeY=n=>((n-startHour*60)/(1440-startHour*60))*100;
  const heads=days.map((d,i)=>`<div class="day-heading ${d===today()?'today':''}"><span>${['周一','周二','周三','周四','周五','周六','周日'][i]}</span><b>${+d.slice(8)}</b>${all.filter(e=>e.date===d&&e.kind==='date'&&!e.done).length?`<button class="date-marker" data-date="${d}">${all.filter(e=>e.date===d&&e.kind==='date'&&!e.done).length} 项当天事项</button>`:''}</div>`).join('');
  const hours=Array.from({length:25-startHour},(_,i)=>startHour+i);
  const cols=days.map(d=>{
    const timed=all.filter(e=>e.date===d&&e.kind!=='deadline'&&e.kind!=='date').sort((a,b)=>a.start-b.start||b.end-a.end);
    // Connected overlap groups get separate columns so no course hides another.
    const layout=new Map();let group=[],groupEnd=-1;
    const flush=()=>{const ends=[];for(const e of group){let col=ends.findIndex(end=>end<=e.start);if(col<0)col=ends.length;ends[col]=e.end;layout.set(e.id,{col});}for(const e of group)layout.get(e.id).count=ends.length;group=[];};
    for(const e of timed){if(group.length&&e.start>=groupEnd)flush();group.push(e);groupEnd=Math.max(group.length===1?-1:groupEnd,e.end);}flush();
    const blocks=timed.map(e=>{const l=layout.get(e.id);return `<button class="event ${e.kind} ${e.done?'done':''}" data-event="${esc(e.id)}" style="top:${timeY(e.start)}%;height:${Math.max(2,timeY(e.end)-timeY(e.start))}%;left:calc(${l.col/l.count*100}% + 3px);width:calc(${100/l.count}% - 6px)" title="${esc(e.content)}"><strong>${esc(e.title)}</strong><small>${clock(e.start)}—${clock(e.end)}</small>${e.location?`<small>${esc(e.location)}</small>`:''}</button>`;}).join('');
    const deadlines=all.filter(e=>e.date===d&&e.kind==='deadline').sort((a,b)=>a.start-b.start);
    const groups=new Map();for(const e of deadlines){if(!groups.has(e.start))groups.set(e.start,[]);groups.get(e.start).push(e);}
    const markers=[...groups.entries()].map(([at,items])=>{const e=items[0];return `<button class="deadline ${items.every(i=>i.done)?'done':''}" ${items.length===1?`data-event="${esc(e.id)}"`:`data-deadlines="${d}|${at}"`} style="top:${timeY(at)}%;--stack:0" title="${esc(items.map(i=>i.title).join('\n'))}"><span class="diamond">◇</span><span><b>${clock(at)}</b> ${items.length===1?esc(e.title):`${items.length} 项事项`}</span></button>`;}).join('');
    return `<div class="day-column" style="height:${height}px;--hour-height:${height/(24-startHour)}px">${blocks}${markers}</div>`;
  }).join('');
  return `<div class="week-head"><div></div>${heads}</div><div class="calendar-scroll"><div class="week-body" style="height:${height}px"><div class="time-axis">${hours.map(h=>`<span style="top:${(h-startHour)/(24-startHour)*100}%">${String(h).padStart(2,'0')}:00</span>`).join('')}</div>${cols}</div></div>`;
}
function monthView(){
  const first=month+'-01',start=monday(first);
  return `<div class="month-head">${['周一','周二','周三','周四','周五','周六','周日'].map(s=>`<span>${s}</span>`).join('')}</div><div class="month-grid">${Array.from({length:42},(_,i)=>{const d=add(start,i),events=snapshot.events.filter(e=>e.date===d&&!e.done&&(e.kind==='deadline'||e.important||(showCourses&&e.kind==='course'))).sort((a,b)=>a.start-b.start);return `<div class="month-day ${d.slice(0,7)!==month?'outside':''} ${d===today()?'today':''}"><button class="month-date" data-date="${d}" title="查看当天安排">${+d.slice(8)}</button>${events.slice(0,4).map(e=>`<button class="month-event ${e.kind==='deadline'?'month-ddl':''}" data-event="${esc(e.id)}">${e.kind==='deadline'?'◇ ':''}${e.kind==='date'&&!e.timeKnown?'当天':clock(e.start)} ${esc(e.title)}</button>`).join('')}${events.length>4?`<button class="more" data-date="${d}">另 ${events.length-4} 项</button>`:''}</div>`;}).join('')}</div>`;
}
function bindCalendar(){
  const change=n=>{if(view==='week')week=add(week,n*7);else{const d=date(month+'-01');d.setUTCMonth(d.getUTCMonth()+n);month=key(d).slice(0,7);}render();};
  document.querySelector('#previous').onclick=()=>change(-1);document.querySelector('#next').onclick=()=>change(1);
  document.querySelector('#current').onclick=()=>{week=monday(today());month=today().slice(0,7);render();};
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
  return `<section class="document-layout panel"><aside class="document-list"><label class="doc-search"><span aria-hidden="true">⌕</span><input id="doc-query" aria-label="搜索${page==='goals'?'目标':'记录与总结'}" placeholder="搜索${page==='goals'?'目标':'记录与总结'}" value="${esc(query)}"></label><div class="doc-items">${filtered.map(d=>`<button class="doc-item ${d.id===doc?.id?'selected':''}" data-doc="${esc(d.id)}"><strong>${esc(d.title)}</strong>${page==='reviews'?`<small>${d.generatedAt?'生成于':d.recordedAt?'记录于':'更新于'} ${esc((d.generatedAt||d.recordedAt||d.modifiedAt).slice(0,10))}</small>`:''}</button>`).join('')||'<p class="empty small">没有匹配的文档</p>'}</div></aside><article class="document-reader">${doc?`<div class="document-bar">${esc(doc.name)}</div><div class="markdown">${renderMarkdown(doc.markdown)}</div>`:`<div class="empty"><h2>${page==='goals'?'还没有目标文档':'还没有记录或总结'}</h2><p>${page==='goals'?'目标 Markdown 会显示在这里。':'日记和阶段总结会显示在这里，也可请秘书基于已有记录生成总结。'}</p></div>`}</article></section>`;
}
function renderMarkdown(text){const html=marked.parse(text,{gfm:true,breaks:false}).replace(/<input\b[^>]*>/gi,tag=>/type="checkbox"/.test(tag)?(/\bchecked\b/.test(tag)?'☑ ':'☐ '):'');return DOMPurify.sanitize(html,{FORBID_TAGS:['style','iframe','form','input','button','video','audio'],FORBID_ATTR:['style'],ALLOW_DATA_ATTR:false});}
function bindDocuments(){
  const input=document.querySelector('#doc-query');if(input)input.oninput=e=>{const pos=e.target.selectionStart;query=e.target.value;render();const next=document.querySelector('#doc-query');next.focus();next.setSelectionRange(pos,pos);};
  document.querySelectorAll('[data-doc]').forEach(el=>el.onclick=()=>{selected[page]=el.dataset.doc;render();});
  document.querySelectorAll('.markdown a').forEach(a=>{
    const href=a.getAttribute('href');if(!href)return;
    if(/^https?:\/\//i.test(href)){a.target='_blank';a.rel='noopener noreferrer';return;}
    if(href.startsWith('#'))return;
    a.onclick=e=>{e.preventDefault();const name=decodeURIComponent(href).split('/').pop();const doc=snapshot.documents.find(d=>d.name===name);if(doc){selected[doc.type]=doc.id;location.hash=doc.type;}else toast('这个链接指向本地资料，请在原目录查看。');};
  });
}
function modal(html){document.querySelector('dialog')?.remove();const dialog=document.createElement('dialog');dialog.innerHTML=`<button class="close" aria-label="关闭">×</button>${html}`;document.body.append(dialog);dialog.querySelector('.close').onclick=()=>dialog.close();dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();return dialog;}
function detail(e){if(!e)return;const d=modal(`<h2>${esc(e.title)}</h2>${e.date?`<p class="subtle">${esc(e.date)} ${e.kind==='date'?(e.timeKnown?clock(e.start):'当天 · 时间未定'):e.kind==='deadline'?clock(e.start):clock(e.start)+'—'+clock(e.end)}</p>`:''}<div class="markdown">${renderMarkdown(e.content)}</div><p class="source">${esc(e.source)}</p><div class="form-actions">${e.editable&&!e.done?'<button class="primary" id="complete-item">标记完成</button>':e.done?'<span class="subtle">已完成</span>':''}${e.source?'<button class="quiet" id="open-source">查看原文</button>':''}</div>`);d.querySelector('#open-source')?.addEventListener('click',()=>secretary.openFile(e.source));d.querySelector('#complete-item')?.addEventListener('click',async ev=>{ev.target.disabled=true;try{await api('/api/workspace/complete',{id:e.id});d.close();await refresh(true);toast('已记录完成，可在修改记录中撤销');}catch(err){ev.target.disabled=false;toast(err.message);}});}
function dayDetail(day){const items=snapshot.events.filter(e=>e.date===day).sort((a,b)=>a.start-b.start);const d=modal(`<h2>${esc(day)} · 当天安排</h2><div class="day-detail">${items.map(e=>`<button class="day-detail-item ${e.done?'done':''}" data-day-item="${esc(e.id)}"><span>${e.kind==='date'?(e.timeKnown?clock(e.start):'时间未定'):e.kind==='deadline'?'截止 '+clock(e.start):clock(e.start)+'—'+clock(e.end)}</span><strong>${esc(e.title)}</strong></button>`).join('')||'<p class="subtle">当天没有安排</p>'}</div><button class="quiet" id="open-day-week">查看这一周</button>`);d.querySelectorAll('[data-day-item]').forEach(el=>el.onclick=()=>detail(items.find(e=>e.id===el.dataset.dayItem)));d.querySelector('#open-day-week').onclick=()=>{week=monday(day);view='week';d.close();render();};}
function renderAdmin(){
 root.innerHTML=`<header class="masthead admin-masthead"><a class="wordmark" href="${appBase}admin/" aria-label="Kairos 管理后台">${brand()}</a><span class="admin-label">管理后台</span><div class="header-tools"><span class="admin-identity">${esc(session.user.username)}</span><button class="quiet" id="logout">退出登录</button></div></header><main class="admin-workspace"><h1>账号管理</h1>${error?`<p class="notice" role="alert">${esc(error)}</p>`:''}<section class="panel admin-account-panel"><form id="create-user" class="create-user"><label>新账号<input name="username" aria-label="新账号" placeholder="3—32位字母或数字" pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}" required></label><button class="primary" type="submit">创建账号</button></form><p class="form-error" id="admin-error" role="alert"></p><div class="admin-table-scroll"><table class="admin-account-table"><thead><tr><th>账号</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody>${adminUsers?adminUsers.map(u=>`<tr><td><strong>${esc(u.username)}</strong></td><td>${u.role==='admin'?'管理员':'普通账号'}</td><td>${u.active?'已启用':'已停用'}</td><td>${u.id!==session.user.id?`<button class="quiet" data-account="${esc(u.id)}" data-operation="reset-password">重置密码</button><button class="quiet" data-account="${esc(u.id)}" data-operation="${u.active?'disable':'enable'}">${u.active?'停用':'启用'}</button>`:'<span class="subtle">当前账号</span>'}</td></tr>`).join(''):'<tr><td colspan="4">正在读取账号…</td></tr>'}</tbody></table></div></section></main>`;
 document.querySelector('#logout').onclick=async()=>{await api('/api/logout',{});session={authenticated:false};adminUsers=null;error='';render();};
 const reload=async()=>{adminUsers=(await api('/api/admin/users')).users;error='';renderAdmin();};
 const reveal=data=>modal(`<h2>${esc(data.user.username)}</h2><p class="subtle">新凭据仅在此显示，请保存后交给账号使用者。</p><label>登录密码<input readonly value="${esc(data.password)}"></label>${data.syncToken?`<label>该账号的同步密钥<input readonly value="${esc(data.syncToken)}"></label>`:''}`);
 document.querySelector('#create-user').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{const result=await api('/api/admin/users',Object.fromEntries(new FormData(e.target)));await reload();reveal(result);}catch(err){document.querySelector('#admin-error').textContent=err.message;button.disabled=false;}};
 document.querySelectorAll('[data-account]').forEach(button=>button.onclick=async()=>{const operation=button.dataset.operation;if(operation==='reset-password'&&!confirm('重置后该账号需要使用新密码登录，继续吗？'))return;button.disabled=true;try{const result=await api('/api/admin/users/'+button.dataset.account,{operation});await reload();if(result.password)reveal(result);}catch(err){document.querySelector('#admin-error').textContent=err.message;button.disabled=false;}});
}
let toastTimer;function toast(text){syncStatus=text;const el=document.querySelector('.live-status');if(el)el.textContent=text;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{syncStatus='';const el=document.querySelector('.live-status');if(el)el.textContent='';},4500);}
async function settings(){
  if(!window.kairos)return;const cfg=await window.kairos.settings();
  const dialog=modal(`<h2>本地目录与同步</h2><form id="settings-form"><label>管理文档目录<div class="path-field"><input name="sourceRoot" value="${esc(cfg.sourceRoot)}" required><button type="button" id="browse">选择</button></div></label><label>课表 HTML 路径<input name="courseFile" value="${esc(cfg.courseFile||'')}" placeholder="留空时读取桌面学期课表"></label><hr><label>网页地址<input name="remoteUrl" value="${esc(cfg.remoteUrl||'')}" placeholder="https://…"></label><label>同步密钥<input type="password" name="remoteToken" placeholder="${cfg.hasToken?'已保存；留空沿用':'填写一次后加密保存在本机'}" autocomplete="off"></label><label class="check"><input name="autoSync" type="checkbox" ${cfg.autoSync?'checked':''}>本地与服务器文档同步（运行期间）</label><div class="form-actions"><button type="button" class="quiet" id="enable-file-sync">导入原文并启用文档同步</button><button type="button" class="quiet" id="sync-conflicts">同步冲突${cfg.conflicts?' · '+cfg.conflicts:''}</button><button type="button" class="quiet" id="open-cloud">进入服务器空间</button></div><p class="subtle">修改地址和密钥后请先保存。文档同步保留双方冲突，删除文件不会自动传到另一端。</p><p id="settings-error" class="form-error" role="alert"></p><button class="primary" type="submit">保存</button></form>`);
  dialog.querySelector('#enable-file-sync').onclick=async e=>{e.target.disabled=true;try{await window.kairos.enableFileSync();toast('原始文档已导入');}catch(err){dialog.querySelector('#settings-error').textContent=err.message;}finally{e.target.disabled=false;}};
  dialog.querySelector('#open-cloud').onclick=async()=>{try{await window.kairos.openCloud();}catch(err){dialog.querySelector('#settings-error').textContent=err.message;}};
  dialog.querySelector('#sync-conflicts').onclick=syncConflicts;
  dialog.querySelector('#browse').onclick=async()=>{const p=await window.kairos.chooseFolder();if(p)dialog.querySelector('[name=sourceRoot]').value=p;};
  dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();const form=Object.fromEntries(new FormData(e.target));form.autoSync=!!form.autoSync;try{await window.kairos.saveSettings(form);secretary.reset();dialog.close();await refresh(true);toast('已更新设置');}catch(err){dialog.querySelector('#settings-error').textContent=err.message;}};
}
async function syncConflicts(){try{const conflicts=await window.kairos.conflicts();const d=modal(`<h2>同步冲突</h2>${conflicts.map((c,i)=>`<section class="history-item"><strong>${esc(c.path)}</strong><details><summary>比较两份内容</summary><h3>本地</h3><pre class="conflict-text">${esc(c.local?.content??'文件不存在')}</pre><h3>服务器</h3><pre class="conflict-text">${esc(c.remote?.content??'文件不存在')}</pre></details><div class="form-actions"><button class="quiet" data-conflict="${i}" data-choice="local">采用本地版本</button><button class="quiet" data-conflict="${i}" data-choice="remote">采用服务器版本</button></div></section>`).join('')||'<p class="subtle">没有同步冲突</p>'}`);d.querySelectorAll('[data-conflict]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await window.kairos.resolveConflict({path:conflicts[+b.dataset.conflict].path,choice:b.dataset.choice});d.close();toast('已保存所选版本，原版本保留在修改记录中');await refresh(true);}catch(e){b.disabled=false;toast(e.message);}});}catch(e){toast(e.message);}}
async function refresh(force=false){if(busy)return;busy=true;try{if(!session)session=await api('/api/session');if(!session.authenticated)return render();if(session.user?.role==='admin'){if(!adminPage)return render();const data=await api('/api/admin/users');const changed=JSON.stringify(adminUsers)!==JSON.stringify(data.users);adminUsers=data.users;error='';if(force||changed)render();return;}if(adminPage)return render();const data=await api('/api/state');const changed=snapshot?.revision!==data.revision||snapshot?.error!==data.error;snapshot=data;error='';if(force||changed&&page!=='secretary')render();}catch(e){error=e.message;render();}finally{busy=false;}}
window.addEventListener('hashchange',()=>{page=location.hash.slice(1);query='';render();});
window.addEventListener('focus',()=>{if(session?.authenticated)refresh();});
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(snapshot&&session?.authenticated&&!document.querySelector('dialog'))render();},150);});
window.kairos?.onSync?.(status=>toast(status));
refresh(true);setInterval(()=>{if(!document.hidden&&session?.authenticated)refresh();},7000);

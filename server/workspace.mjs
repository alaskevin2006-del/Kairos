import {readFile,writeFile,mkdir,rename,readdir,lstat,unlink} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {readWorkspace,parseAttention,dayKey} from './model.mjs';

export const hash=text=>createHash('sha256').update(text).digest('hex');
export class UserError extends Error{constructor(message,status=400){super(message);this.status=status;}}
export async function atomic(file,value){await mkdir(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,value,{mode:0o600});await rename(tmp,file);}
export function documentPath(value){
 if(typeof value!=='string'||value.length>240||value.includes('\\')||value.includes(':')||value.includes('\0')||value.startsWith('/')||!value.endsWith('.md'))throw new UserError('只允许当前空间内的 Markdown 文档');
 const parts=value.split('/');if(parts.some(p=>!p||p==='.'||p==='..'||p.startsWith('.')||/[<>"|?*\x00-\x1f]/.test(p)))throw new UserError('文档路径无效');
 return value;
}
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&dayKey(...s.split('-').map(Number))===s;
export function validateRecords(records){
 if(!Array.isArray(records)||records.length>200)throw new UserError('日程条目过多或格式无效');
 const ids=new Set();return records.map(r=>{
  if(typeof r.title!=='string'||!r.title.trim()||r.title.length>500)throw new UserError('事项需要简短标题');
  if(!['event','deadline','date','pending'].includes(r.kind))throw new UserError('事项类型无效');
  if(r.kind!=='pending'&&!validDate(r.date))throw new UserError('事项日期无效');
  const n=r.start??(r.kind==='deadline'?1440:0),end=r.end??n;
  if(!Number.isInteger(n)||!Number.isInteger(end)||n<0||end<n||end>1440||(r.kind==='event'&&end===n))throw new UserError('具体安排需要有效的开始与结束时间');
  const id=typeof r.id==='string'&&/^[a-zA-Z0-9@_-]{1,120}$/.test(r.id)?r.id:randomUUID();if(ids.has(id))throw new UserError('事项 ID 重复');ids.add(id);
  let repeat=null;if(r.repeat){const q=r.repeat;if(!Array.isArray(q.days)||!q.days.length||q.days.some(d=>!Number.isInteger(d)||d<0||d>6)||!validDate(q.from)||(q.until&&!validDate(q.until)))throw new UserError('重复规则无效');repeat={days:[...new Set(q.days)],from:q.from,until:q.until||null};}
  return {id,title:r.title.trim(),kind:r.kind,date:r.date||null,start:n,end,done:r.done===true,important:r.important===true,repeat,completedDates:Array.isArray(r.completedDates)?r.completedDates.filter(validDate):[]};
 });
}
export async function openWorkspace({root,privateDir,local=false,courseFile}){
 await mkdir(root,{recursive:true,mode:0o700});await mkdir(privateDir,{recursive:true,mode:0o700});
 const metaFile=path.join(privateDir,'workspace.json');let meta;
 try{meta=JSON.parse(await readFile(metaFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;meta={mode:local?'files':'snapshot',index:{},kinds:{},transactions:[],baseCourses:[]};}
 async function safeFile(name){
  documentPath(name);const parts=name.split('/');let current=root;
  for(const part of parts){current=path.join(current,part);try{if((await lstat(current)).isSymbolicLink())throw new UserError('不能通过链接访问空间外的文件');}catch(e){if(e.code!=='ENOENT')throw e;}}
  return current;
 }
 async function read(name){const target=await safeFile(name);try{const s=await lstat(target);if(s.size>2*1024*1024)throw new UserError('文档超过 2 MB');const content=await readFile(target,'utf8');return{path:name,content,version:hash(content)};}catch(e){if(e.code==='ENOENT')return{path:name,content:null,version:null};throw e;}}
 async function list(){
  const result=[];async function walk(dir,prefix='',depth=0){if(depth>7)return;for(const item of await readdir(dir,{withFileTypes:true})){if(item.isSymbolicLink()||item.name.startsWith('.'))continue;const name=prefix+item.name;if(item.isDirectory())await walk(path.join(dir,item.name),name+'/',depth+1);else if(item.name.endsWith('.md')){const d=await read(name),info=await lstat(path.join(dir,item.name));result.push({...d,modifiedAt:info.mtime.toISOString(),title:d.content.match(/^#\s+(.+)/m)?.[1]||item.name});if(result.length>1000)throw new UserError('文档数量超过限制');}}}await walk(root);return result;
 }
 // An interrupted transaction is either present in the committed manifest or rolled back.
 const journalFile=path.join(privateDir,'pending.json');
 try{const journal=JSON.parse(await readFile(journalFile,'utf8'));if(!meta.transactions.some(t=>t.id===journal.id)){for(const f of journal.before){const target=await safeFile(f.path);if(f.content===null)await unlink(target).catch(e=>{if(e.code!=='ENOENT')throw e;});else await atomic(target,f.content);}}await unlink(journalFile);}catch(e){if(e.code!=='ENOENT')throw e;}
 let queue=Promise.resolve();
 const locked=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
 async function commit(changes,{label='文档更新',mode,baseCourses,allowRules=false,allowDelete=false,guard=()=>true}={}){return locked(async()=>{
  if(!Array.isArray(changes)||changes.length>30)throw new UserError('每次最多更新 30 份文档');
  if(!guard())throw new UserError('账号已失效，请重新登录',401);
  const paths=new Set(),before=[],after=[];
  for(const c of changes){documentPath(c.path);if(paths.has(c.path))throw new UserError('同一文档不能重复写入');paths.add(c.path);
   if(!allowRules&&/^(agent|agents)\.md$/i.test(c.path))throw new UserError('项目规则不由秘书修改');
   if(!(allowDelete&&c.content===null)&&(typeof c.content!=='string'||Buffer.byteLength(c.content)>2*1024*1024))throw new UserError('文档内容无效或过大');
   const old=await read(c.path);if(old.version!==c.version)throw new UserError('文档已有新修改，请重新读取后再试：'+c.path,409);
   before.push(old);after.push({path:c.path,content:c.content,version:c.content===null?null:hash(c.content),records:c.records===undefined?undefined:validateRecords(c.records),kind:c.kind});
  }
  const id=randomUUID(),next=structuredClone(meta),at=new Date().toISOString();
  for(const f of after){if(f.content===null){delete next.index[f.path];delete next.kinds[f.path];continue;}if(f.records!==undefined)next.index[f.path]={hash:f.version,records:f.records};else if(next.index[f.path]?.hash!==f.version)delete next.index[f.path];if(['goal','review','task','plan','note'].includes(f.kind))next.kinds[f.path]=f.kind;}
  if(mode)next.mode=mode;if(baseCourses)next.baseCourses=baseCourses;
  const transaction={id,at,label,files:after.map(f=>({path:f.path,version:f.version})),beforeIndex:Object.fromEntries(before.map(f=>[f.path,meta.index[f.path]?.hash===f.version?meta.index[f.path]:null])),beforeKinds:Object.fromEntries(before.map(f=>[f.path,meta.kinds[f.path]||null]))};next.transactions.push(transaction);
  const record={...transaction,before};await atomic(path.join(privateDir,'history',id+'.json'),JSON.stringify(record));await atomic(journalFile,JSON.stringify(record));
  try{for(const f of after){const target=await safeFile(f.path);if(f.content===null)await unlink(target).catch(e=>{if(e.code!=='ENOENT')throw e;});else await atomic(target,f.content);}if(!guard())throw new UserError('账号已失效',401);await atomic(metaFile,JSON.stringify(next));meta=next;}
  catch(e){for(const f of before){const target=await safeFile(f.path);if(f.content===null)await unlink(target).catch(()=>{});else await atomic(target,f.content);}await unlink(journalFile).catch(()=>{});throw e;}
  await unlink(journalFile).catch(()=>{});return{id,at,label,files:transaction.files};
 });}
 async function undo(id){
  const t=meta.transactions.find(t=>t.id===id);if(!t)throw new UserError('没有找到该次修改');const record=JSON.parse(await readFile(path.join(privateDir,'history',id+'.json'),'utf8'));
  return commit(record.before.map(f=>({path:f.path,version:t.files.find(a=>a.path===f.path).version,content:f.content,records:record.beforeIndex[f.path]?.records,kind:record.beforeKinds[f.path]||'note'})),{label:'撤销：'+t.label,allowDelete:true});
 }
 async function state(){
  await queue;let data=await readWorkspace(root,{courseFile:courseFile?.()});const docs=await list(),byPath=new Map(docs.map(d=>[d.path,d]));
  const indexed=new Set(Object.entries(meta.index).filter(([p,index])=>byPath.get(p)?.version===index.hash).map(([p])=>p));
  data.events=data.events.filter(e=>!indexed.has(e.source));data.pending=data.pending.filter(e=>!indexed.has(e.source));
  if(!local)data.events.push(...meta.baseCourses.filter(e=>e.kind==='course'));
  for(const d of docs)if(/^(tasks|plans)\//.test(d.path)&&!indexed.has(d.path)){
   const parsed=parseAttention(d.content,+d.modifiedAt.slice(0,4));
   for(const item of [...parsed.events,...parsed.pending]){item.source=d.path;item.id=hash(d.path+'|'+item.id).slice(0,20);item.editable=false;}
   data.events.push(...parsed.events);data.pending.push(...parsed.pending);
  }
  const now=new Date(),dateToday=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  for(const p of indexed)for(const r of meta.index[p].records){
   const days=[];if(r.repeat){let at=r.repeat.from;const limit=r.repeat.until||new Date(new Date(dateToday+'T00:00:00Z').getTime()+180*86400000).toISOString().slice(0,10);for(let n=0;at<=limit&&n<1100;n++){if(r.repeat.days.includes(new Date(at+'T00:00:00Z').getUTCDay()))days.push(at);at=new Date(new Date(at+'T00:00:00Z').getTime()+86400000).toISOString().slice(0,10);}}else days.push(r.date);
   for(const day of days){const d={...r,date:day,id:hash(p+'|'+r.id).slice(0,20)+(r.repeat?'@'+day:''),recordId:r.id,source:p,content:byPath.get(p).content,editable:true,done:r.done||r.completedDates.includes(day)};if(r.kind==='pending')data.pending.push(d);else data.events.push(d);}
  }
  // Date-only entries are kept separate from the timed grid; user-authored Markdown stays free-form.
  for(const d of docs){const kind=meta.kinds[d.path];const type=kind==='goal'?'goals':kind==='review'||/^daily\//.test(d.path)?'reviews':null;const recordedAt=/^daily\//.test(d.path)?d.path.match(/(20\d{2}-\d{2}-\d{2})\.md$/)?.[1]||null:null;if(type&&!data.documents.some(x=>x.path===d.path))data.documents.push({id:hash(d.path).slice(0,20),type,title:d.title,name:path.basename(d.path),path:d.path,markdown:d.content,recordedAt,modifiedAt:d.modifiedAt});}
  data.documents.sort((a,b)=>(b.generatedAt||b.recordedAt||b.modifiedAt).localeCompare(a.generatedAt||a.recordedAt||a.modifiedAt));
  data.events=data.events.map(e=>({...e,editable:e.kind!=='course'&&(indexed.has(e.source)||e.source==='_attention.md')}));data.pending=data.pending.map(e=>({...e,editable:indexed.has(e.source)||e.source==='_attention.md'}));
  data.workspaceMode='files';data.revision=hash(JSON.stringify({events:data.events,pending:data.pending,documents:data.documents,versions:docs.map(d=>d.version)}));return data;
 }
 async function complete(id){const data=await state(),item=[...data.events,...data.pending].find(e=>e.id===id);if(!item?.editable)throw new UserError('请在秘书中说明该事项的进展');if(item.done)return{ok:true};const d=await read(item.source);const indexed=meta.index[item.source];
  const records=indexed?.hash===d.version?structuredClone(indexed.records):undefined;if(records){const r=records.find(r=>r.id===item.recordId);if(!r)throw new UserError('事项已变化，请刷新后重试',409);if(r.repeat)r.completedDates=[...new Set([...r.completedDates,item.date])];else r.done=true;}
  const stamp=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',dateStyle:'short'}).format(new Date());const marker=`<!-- kairos-completed:${item.id} -->`;
  return commit([{path:d.path,version:d.version,content:d.content+`\n\n## 完成记录\n- ${stamp} 已完成：${item.title}${item.repeat?'（'+item.date+'）':''} ${marker}\n`,records}],{label:'完成：'+item.title});
 }
 return {read,list,commit,undo,state,complete,mode:()=>meta.mode,index:p=>meta.index[p],kind:p=>meta.kinds[p],courses:()=>meta.baseCourses,history:()=>meta.transactions.slice(-50).reverse().map(({beforeIndex,beforeKinds,...t})=>t)};
}

import {readdir,readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex').slice(0,20);
const caches=new Map();
const parsedCache=new Map();
const plain=s=>s.replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*`]/g,'').trim();
export function resolveLink(from,href){
 const [file,anchor]=decodeURIComponent(href).split('#');
 if(/^[a-z]+:/i.test(file)||file.startsWith('/'))return null;
 const target=path.posix.normalize(path.posix.join(path.posix.dirname(from),file||path.posix.basename(from)));
 if(target.startsWith('../')||target.startsWith('.'))return null;
 return {path:target,anchor:anchor||null};
}
export function parseItems(text,source,today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date())){
 const cacheKey=hash(source+'|'+today+'|'+text);if(parsedCache.has(cacheKey))return structuredClone(parsedCache.get(cacheKey));
 const items=[];let section='',closed=false;
 for(const [line,raw] of text.split(/\r?\n/).entries()){
  if(/^#{1,6} /.test(raw)){section=plain(raw.replace(/^#+\s*/,''));closed=/已确认收口|已办|完成记录|历史摘要/.test(section);continue;}
  const m=raw.match(/^\s*-\s+(?:\[([ xX])\]\s*)?(.+)/);if(!m||closed)continue;
  if(source!=='_attention.md'&&m[1]===undefined&&!/^\*\*20\d{2}-\d{2}-\d{2}/.test(m[2]))continue;
  const body=plain(m[2]),stamp=body.match(/\b(20\d{2}-\d{2}-\d{2})\b/),time=stamp&&body.slice(stamp.index+10).match(/^\s+(\d{2}):(\d{2})(?:\s*[–—至-]\s*(\d{2}):(\d{2}))?/);
  if(stamp){const parsed=new Date(stamp[1]+'T00:00:00Z');if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==stamp[1])continue;}
  if(time&&(+time[1]>23||+time[2]>59||time[3]&&(+time[3]>23||+time[4]>59)))continue;
  const start=time?+time[1]*60+ +time[2]:0,end=time?.[3]?+time[3]*60+ +time[4]:start;if(end<start)continue;
  const link=[...m[2].matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(x=>resolveLink(source,x[1])).find(x=>x?.path.startsWith('matters/'));
  const bold=m[2].match(/^\*\*([^*]+)\*\*/)?.[1];const title=plain(bold&&!/^20\d{2}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?$/.test(bold)?bold:m[2]).replace(/^20\d{2}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}(?:[–—-]\d{2}:\d{2})?)?(?:（[^）]*）)?\s*[｜|：:]?\s*/,'').split(/来源[：:]|。/)[0];
  const done=/x/i.test(m[1]||'')||m[1]===undefined&&/(?:已完成并提交|已提交|已取消)/.test(body)&&!/未提交|不自动|未知/.test(body),date=stamp?.[1]||null,kind=/DDL|截止|提交|交付/i.test(title)?'deadline':time?.[3]?'event':date?'date':'pending';
  const status=/待核实|结果未知|提交状态未知/.test(section+' '+body)||date&&date<today&&!done?'unverified':done?'done':'open';
  items.push({id:hash(source+'|'+raw),title,content:raw,source:link?.path||source,anchor:link?.anchor,indexSource:source,line:line+1,section,date,kind,start,end,timeKnown:!!time,defaultTime:!time,done,status,important:/#重要|重要程度[：:]\s*高/.test(raw),dueAt:kind==='deadline'&&time?`${date}T${time[1]}:${time[2]}:00+08:00`:null,editable:false});
 }
 const recurring=[];
 for(let i=items.length-1;i>=0;i--){const item=items[i];if(!/每周|每天|每日/.test(item.content))continue;
  const dates=[...item.content.matchAll(/20\d{2}-\d{2}-\d{2}/g)].map(m=>m[0]);
  const days=/每天|每日/.test(item.content)?[0,1,2,3,4,5,6]:[...item.content.matchAll(/每周([一二三四五六日天、，和]+)/g)].flatMap(m=>[...m[1]].map(c=>'日一二三四五六'.indexOf(c==='天'?'日':c)).filter(n=>n>=0));
  if(!dates.length||!days.length)continue;
  const times=item.content.match(/(\d{2}):(\d{2})\s*[–—-]\s*(\d{2}):(\d{2})/);
  if(!times)continue;
  const start=+times[1]*60+ +times[2],end=+times[3]*60+ +times[4];if(start>=end||end>1440||+times[2]>59||+times[4]>59)continue;
  const until=dates[1]||new Date(new Date(today+'T00:00:00Z').getTime()+180*86400000).toISOString().slice(0,10);
  items.splice(i,1);let at=new Date(dates[0]+'T00:00:00Z');
  for(let count=0;count<1500&&!Number.isNaN(at.getTime())&&at.toISOString().slice(0,10)<=until;count++,at.setUTCDate(at.getUTCDate()+1)){
   if(!days.includes(at.getUTCDay()))continue;const date=at.toISOString().slice(0,10);recurring.push({...item,id:hash(item.id+'|'+date),date,kind:'event',start,end,timeKnown:true,status:item.done?'done':date<today?'unverified':'open'});
  }
 }
 items.push(...recurring);
 if(parsedCache.size>1500)parsedCache.clear();parsedCache.set(cacheKey,items);return structuredClone(items);
}
export async function scanDocuments(root,{force=false}={}){
 let cache=caches.get(root);if(!cache){cache={files:new Map(),last:0,reads:0};caches.set(root,cache);}
 if(!force&&Date.now()-cache.last<1200)return [...cache.files.values()];
 const found=new Set();
 async function walk(dir,prefix='',depth=0){if(depth>12)return;for(const e of await readdir(dir,{withFileTypes:true})){
  if(e.isSymbolicLink()||e.name.startsWith('.')||['node_modules','data','dist','release'].includes(e.name))continue;
  const name=prefix+e.name,file=path.join(dir,e.name);
  if(e.isDirectory())await walk(file,name+'/',depth+1);else if(e.name.endsWith('.md')){
   const info=await lstat(file);if(info.size>2*1024*1024)continue;found.add(name);const old=cache.files.get(name),signature=info.mtimeMs+'|'+info.ctimeMs+'|'+info.size;
   if(!old||old.signature!==signature){const content=await readFile(file,'utf8');cache.reads++;cache.files.set(name,{path:name,content,version:createHash('sha256').update(content).digest('hex'),signature,modifiedAt:info.mtime.toISOString(),title:plain(content.match(/^#\s+(.+)/m)?.[1]||e.name)});}
   if(found.size>1000)throw Error('文档数量超过限制');
  }
 }}await walk(root);for(const name of cache.files.keys())if(!found.has(name))cache.files.delete(name);cache.last=Date.now();return [...cache.files.values()];
}
export function invalidate(root){const c=caches.get(root);if(c)c.last=0;}
export function indexStats(root){return {reads:caches.get(root)?.reads||0};}
export function synchronizeAttention(attention,oldText,newText,source){
 const before=parseItems(oldText,source),after=parseItems(newText,source);
 const normalize=s=>plain(s).replace(/20\d{2}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}(?:[–—-]\d{2}:\d{2})?)?/g,'').replace(/[｜|：:，。\s]/g,'');
 const lines=attention.split(/\r?\n/);
 for(const old of before){const candidates=after.filter(n=>normalize(n.title)===normalize(old.title));if(candidates.length!==1)continue;const next=candidates[0];
  const targets=parseItems(lines.join('\n'),'_attention.md').filter(i=>i.source===source&&normalize(i.title)===normalize(old.title));
  if(targets.length!==1)continue;const target=targets[0];if(target.date!==old.date||target.done!==old.done)continue;
  let line=lines[target.line-1];
  if(old.date&&next.date&&old.date!==next.date)line=line.replace(old.date,next.date);
  const times=s=>s.match(/\b\d{2}:\d{2}(?:[–—-]\d{2}:\d{2})?/)?.[0];
  const oldTime=times(old.content),newTime=times(next.content);
  if(oldTime!==newTime&&oldTime&&newTime&&times(line)===oldTime)line=line.replace(oldTime,newTime);
  if(old.done!==next.done)line=line.replace(/\[[ xX]\]/,next.done?'[x]':'[ ]');
  lines[target.line-1]=line;
 }
 return lines.join('\n');
}
export async function unifiedState(root,options={}){
 const files=await scanDocuments(root),byPath=new Map(files.map(f=>[f.path,f])),attention=byPath.get('_attention.md');
 const items=attention?parseItems(attention.content,'_attention.md'):[],warnings=[];
 for(const item of items){if(!byPath.has(item.source))warnings.push('链接不存在：'+item.source);else if(item.date&&item.source!=='_attention.md'){
  const original=byPath.get(item.source).content,short=item.date.slice(5).replace('-','/');
  if(!original.includes(item.date)&&!original.includes(short))warnings.push('Attention 日期需与原文核对：'+item.title+' → '+item.source);
 }}
 const normalize=s=>s.replace(/[\s，。；：:｜|（）()]/g,'');
 for(const f of files.filter(f=>f.path.startsWith('matters/'))){
  const own=parseItems(f.content,f.path);
  for(const entry of own){
   const related=items.filter(i=>i.source===f.path&&normalize(i.title)===normalize(entry.title));
   if(related.length){for(const i of related)if(i.date!==entry.date||i.timeKnown!==entry.timeKnown||i.timeKnown&&i.start!==entry.start||i.done!==entry.done)warnings.push('Attention 与主文档事实冲突，请核对：'+i.title);continue;}
   // For linked topics only explicit checkboxes add independent actions, never background date mentions.
   if(!items.some(i=>i.source===f.path)||/^\s*-\s+\[[ xX]\]/.test(entry.content))items.push(entry);
  }
 }
 const documents=files.filter(f=>f.path.startsWith('matters/')||f.path.startsWith('journal/')).map(f=>({id:hash(f.path),path:f.path,name:path.posix.basename(f.path),title:f.title,markdown:f.content,modifiedAt:f.modifiedAt,type:f.path.startsWith('journal/')?'reviews':/(?:^|\s)#长期(?=\s|$)/m.test(f.content)?'goals':'matter',author:f.path.startsWith('journal/AI/')?'AI':'本人',recordedAt:f.path.match(/20\d{2}-\d{2}-\d{2}/)?.[0]||null}));
 return {schema:1,timezone:'Asia/Shanghai',events:items.filter(i=>i.date&&i.status!=='unverified'),pending:items.filter(i=>!i.date&&i.status!=='unverified'),unverified:items.filter(i=>i.status==='unverified'),documents,warnings,revision:hash(files.map(f=>f.version).join('|'))};
}

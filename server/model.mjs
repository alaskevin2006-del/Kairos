import {unifiedState,parseItems} from './document-index.mjs';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import {parseCourses} from './courses.mjs';

const courseCache=new Map();
const hash = text => createHash('sha256').update(text).digest('hex').slice(0,20);
export const clean = s => s.replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*_~`]/g,'').replace(/[❗⚠️✅]/gu,'').trim();
const pad = n=>String(n).padStart(2,'0');
export function dayKey(y,m,d) {
  const dt=new Date(Date.UTC(y,m-1,d));
  if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d)return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
export function nextDay(date) { const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10); }
export function datesIn(text,year) {
  const out=[];
  for(const m of text.matchAll(/(?:(20\d{2})[-年])?(\d{1,2})[\/月-](\d{1,2})(?:日)?(?:\s*[–—~至]\s*(?:(\d{1,2})[\/月-])?(\d{1,2})(?:日)?)?/g)) {
    const y=+(m[1]||year),mo=+m[2],day=+m[3], start=dayKey(y,mo,day);if(!start)continue;
    if(m[5]) {const end=dayKey(y,+(m[4]||mo),+m[5]);let at=start;for(let i=0;end&&at<=end&&i<31;i++,at=nextDay(at))out.push(at);}
    else out.push(start);
  }
  return [...new Set(out)];
}
export function parseAttention(text){
 const items=parseItems(text,'_attention.md');
 return {events:items.filter(i=>i.date&&i.status!=='unverified'),pending:items.filter(i=>!i.date&&i.status!=='unverified'),unverified:items.filter(i=>i.status==='unverified')};
}

export async function readWorkspace(root, options={}) {
  root=await realpath(root);
  let attention='';try {attention=await readFile(path.join(root,'_attention.md'),'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
  const result=await unifiedState(root,options);
  const courseFile=options.courseFile||path.join(root,'sources','courses.html');
  try {const info=await stat(courseFile),signature=info.mtimeMs+'|'+info.ctimeMs+'|'+info.size;let cached=courseCache.get(courseFile);if(!cached||cached.signature!==signature){cached={signature,events:parseCourses(await readFile(courseFile,'utf8'))};courseCache.set(courseFile,cached);}if(!cached.events.length)result.warnings.push('课表未识别到课程，请核对 HTML 数据格式');result.events.push(...cached.events.map(e=>({...e,source:'sources/courses.html'})));}catch(e){if(e.code!=='ENOENT')result.warnings.push('课表读取失败：'+e.message);}
  return {...result,revision:hash(JSON.stringify(result))};
}

export function validateSnapshot(data) {
  if(!data||data.schema!==1||!Array.isArray(data.events)||!Array.isArray(data.pending)||!Array.isArray(data.documents))throw Error('无效的数据快照');
  if(data.events.length>10000||data.pending.length>10000||data.documents.length>1000)throw Error('数据量超过限制');
  for(const e of data.events)if(typeof e.id!=='string'||typeof e.title!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||!Number.isFinite(e.start)||!Number.isFinite(e.end)||e.start<0||e.end<e.start||e.end>1440||!['event','course','deadline','date'].includes(e.kind))throw Error('日程格式错误');
  for(const d of data.documents)if(typeof d.markdown!=='string'||typeof d.id!=='string'||!['goals','reviews'].includes(d.type))throw Error('文档格式错误');
  return data;
}

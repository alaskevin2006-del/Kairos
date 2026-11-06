import { createHash } from 'node:crypto';
import { readdir, readFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import {parseCourses} from './courses.mjs';

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
export function parseAttention(text, fallbackYear=new Date().getFullYear()) {
  const year=+(text.match(/最近整理[^\n]*(20\d{2})-/)?.[1]||fallbackYear);
  const events=[],pending=[];let section='',scope=[],skip=false;
  for(const raw of text.split(/\r?\n/)) {
    if(/^##\s/.test(raw)) {section=clean(raw.replace(/^#+\s*/,''));scope=/及以后|之后/.test(section)?[]:datesIn(section,year);skip=/已办|已收口|待核实|无动作|暂停|完成记录/.test(section);continue;}
    const match=raw.match(/^\s*-\s+\[([ xX])\]\s+(.+)/);if(!match||skip)continue;
    const done=/x/i.test(match[1]), body=clean(match[2]);
    if(!body||/^见\s/.test(body))continue;
    const bold=clean(match[2].match(/^\*\*([^*]+)\*\*/)?.[1]||'');
    const leading=body.match(/^(\d{1,2}\/\d{1,2})\s*(?:周[一二三四五六日])?\s*(?:早上|上午|下午|晚上|早|晚)?\s*[：:]\s*/);
    const baseScope=leading?datesIn(leading[1],year):scope;
    const main=leading?body.slice(leading[0].length):body;
    let pieces=main.split(/\s*\/(?!\d)\s*|\s+\+\s+|\s*→\s*/);
    if(/^六级[：:]/.test(main))pieces=main.replace(/^六级[：:]\s*/,'').split('、').map(p=>'六级'+p);
    if(/^穿插[：:]/.test(main))pieces=main.replace(/^穿插[：:]\s*/,'').split(/\s*\/\s*/);
    const undecided=/方案待定|需用户定|方案未定|待决定/.test(body);
    if(undecided){pending.push({title:bold||main.split(/[：；。]/)[0],content:body,done,source:'_attention.md',section,id:hash(raw)});continue;}
    for(const piece of pieces) {
    const actionable=piece.split(/[。⚠]/)[0].replace(/（[^）]*(?:用户自述|确认|已发)[^）]*）/g,'');
    let title=pieces.length===1&&bold&&!/^(?:\d{1,2}\/\d{1,2}|每晚)/.test(bold)?bold:actionable;
    title=title.replace(/^(?:每晚|每天|每日)\s*\d{1,2}:\d{2}\s*[–—-]\s*\d{1,2}:\d{2}\s*/,'').replace(/^(?:晚上|白天|有空)[：:]?\s*/,'').replace(/[（(].*?[）)]/g,'').replace(/[，；。].*$/,'').trim();
    if(!title)title=actionable;
    const explicit=datesIn(actionable,year);
    let days=explicit.length?explicit:(baseScope.length===1?baseScope:/每晚|每日|每天/.test(body)?baseScope:[]);
    if(baseScope.length===1&&!leading&&!/DDL|截止|提交|正式讲|口试|笔试/.test(actionable))days=baseScope;
    const range=actionable.match(/(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/);
    const time=range||actionable.match(/(\d{1,2}):(\d{2})/);
    // A line with several independent dates is represented as date markers, never a made-up duration.
    const detail={title,content:piece,done,source:'_attention.md',section};
    if(!days.length) {pending.push({...detail,id:hash(raw+'|'+piece)});continue;}
    // Explicit submission deadlines in parentheses do not move a scheduled work block.
    if(range&&scope.length===1)days=scope;
    if(range&&/每晚|每日|每天/.test(body)&&scope.length)days=scope;
    for(let date of days) {
      const isDeadline=/DDL|截止|提交|交付|最晚|(?:\d{1,2}[\/月-]\d{1,2}日?|当天|本周|今天)[^。；\n]{0,8}前|前完成|前交/i.test(actionable+' '+section);
      let kind=range?'event':isDeadline?'deadline':'date',start=kind==='deadline'?1440:0,end=start;
      if(time) {start=+time[1]*60 + +time[2];end=range?+range[3]*60+ +range[4]:start;}
      if(start>1440||end>1440||start<0||end<start||+time?.[2]>59||+range?.[4]>59)continue;
      // 11/9 00:00 is shown at the end of 11/8, but retains its exact timestamp.
      let dueAt=null;
      if(kind==='deadline') {
        dueAt=start===1440?`${nextDay(date)}T00:00:00+08:00`:`${date}T${pad(Math.floor(start/60))}:${pad(start%60)}:00+08:00`;
        if(start===0) {const previous=new Date(`${date}T00:00:00Z`);previous.setUTCDate(previous.getUTCDate()-1);date=previous.toISOString().slice(0,10);start=end=1440;}
      }
      events.push({...detail,id:hash(`${raw}|${piece}|${date}|${start}`),date,kind,start,end,dueAt,defaultTime:!time,timeKnown:!!time});
    }
    }
  }
  const unique=arr=>[...new Map(arr.map(x=>[`${x.date||''}|${x.start||''}|${x.title}|${x.kind||''}`,x])).values()];
  const completed=new Set([...text.matchAll(/<!-- kairos-completed:([a-zA-Z0-9@_-]+) -->/g)].map(m=>m[1]));
  return {events:unique(events).map(e=>({...e,done:e.done||completed.has(e.id)})),pending:unique(pending).map(e=>({...e,done:e.done||completed.has(e.id)}))};
}

async function files(root,depth=0) {
  if(depth>5)return[];
  try {const items=await readdir(root,{withFileTypes:true});const found=[];
    for(const item of items) {if(item.isSymbolicLink()||item.name.startsWith('.'))continue;const p=path.join(root,item.name);if(item.isDirectory())found.push(...await files(p,depth+1));else if(/\.md$/i.test(item.name))found.push(p);if(found.length>500)break;}
    return found;
  }catch(e){if(e.code==='ENOENT')return[];throw e;}
}
export async function readWorkspace(root, options={}) {
  root=await realpath(root);
  let attention='';try {attention=await readFile(path.join(root,'_attention.md'),'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
  const docs=[];
  const goalDir=path.join(root,'goals');let goalFiles=await files(goalDir);
  goalFiles.push(...(await files(path.join(root,'contexts'))).filter(p=>/个人提升计划|六级报名|本学期课程复盘|雅思|长期目标/.test(path.basename(p))));
  let reviewFiles=[...await files(path.join(root,'summaries')),...await files(path.join(root,'reviews')),...await files(path.join(root,'回顾'))];
  try {await stat(path.join(root,'reviews.md'));reviewFiles.push(path.join(root,'reviews.md'));}catch{}
  for(const [type,list] of [['goals',goalFiles],['reviews',reviewFiles]])for(const file of [...new Set(list)]) {
    const canonical=await realpath(file);if(!canonical.startsWith(root+path.sep))continue;
    const info=await stat(file);if(info.size>2*1024*1024)continue;
    const raw=await readFile(file,'utf8');
    const front=raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    const md=front?raw.slice(front[0].length):raw;
    const generated=front?.[1].match(/^generated_at:\s*["']?([^\r\n"']+)/m)?.[1]||raw.match(/^生成(?:日期|时间)[：:]\s*(20\d{2}-\d{2}-\d{2}[^\r\n]*)/m)?.[1]||null;
    docs.push({id:hash(path.relative(root,file)),type,title:clean(md.match(/^#\s+(.+)/m)?.[1]||path.basename(file,'.md')),name:path.basename(file),path:path.relative(root,file).replaceAll('\\','/'),markdown:md,generatedAt:generated,modifiedAt:info.mtime.toISOString()});
  }
  docs.sort((a,b)=>(b.generatedAt||b.modifiedAt).localeCompare(a.generatedAt||a.modifiedAt));
  const schedule=parseAttention(attention);
  const warnings=[];
  const courseFile=options.courseFile||path.join(path.dirname(root),'2026-2027学年第一学期课程','2026-1学期课表.html');
  try {const courseHtml=await readFile(courseFile,'utf8');schedule.events.push(...parseCourses(courseHtml));}catch(e){if(e.code!=='ENOENT')warnings.push('课程文件暂时读取失败');}
  const result={schema:1,timezone:'Asia/Shanghai',...schedule,documents:docs,warnings,sourceUpdated:attention.match(/最近整理[：:]\s*([^。\n]+)/)?.[1]||null};
  return {...result,revision:hash(JSON.stringify(result))};
}

export function validateSnapshot(data) {
  if(!data||data.schema!==1||!Array.isArray(data.events)||!Array.isArray(data.pending)||!Array.isArray(data.documents))throw Error('无效的数据快照');
  if(data.events.length>10000||data.pending.length>10000||data.documents.length>1000)throw Error('数据量超过限制');
  for(const e of data.events)if(typeof e.id!=='string'||typeof e.title!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||!Number.isFinite(e.start)||!Number.isFinite(e.end)||e.start<0||e.end<e.start||e.end>1440||!['event','course','deadline','date'].includes(e.kind))throw Error('日程格式错误');
  for(const d of data.documents)if(typeof d.markdown!=='string'||typeof d.id!=='string'||!['goals','reviews'].includes(d.type))throw Error('文档格式错误');
  return data;
}

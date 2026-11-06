import {createHash} from 'node:crypto';
const literal=(obj,key)=>obj.match(new RegExp(`\\b${key}:\\s*'([^']*)'`))?.[1];
const number=(obj,key)=>+(obj.match(new RegExp(`\\b${key}:\\s*(\\d+)`))?.[1]||0);
const list=(obj,key)=>(obj.match(new RegExp(`\\b${key}:\\s*\\[([\\d,\\s]*)\\]`))?.[1]||'').split(',').filter(s=>s.trim()).map(Number);
const block=(html,name)=>html.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`))?.[1]||'';
export function parseCourses(html) {
  const periods=[...block(html,'P').matchAll(/\{([^{}]+)\}/g)].map(m=>({n:number(m[1],'n'),t:literal(m[1],'t')}));
  const segments=[...block(html,'SEG').matchAll(/\{([^{}]+)\}/g)].map(m=>({s:number(m[1],'s'),e:number(m[1],'e'),a:literal(m[1],'a')}));
  const courses=[...block(html,'C').matchAll(/\{([^{}]+)\}/g)].map(m=>({name:literal(m[1],'n'),teacher:literal(m[1],'t'),location:literal(m[1],'l'),weeks:list(m[1],'w'),day:number(m[1],'d'),periods:list(m[1],'p'),category:literal(m[1],'c')}));
  const special=new Map([...html.matchAll(/'(\d{4}-\d{2}-\d{2})':\s*\{([^}]+)\}/g)].map(m=>[m[1],{type:literal(m[2],'type'),day:number(m[2],'asDay')}]));
  const time=t=>{const match=t?.match(/(\d{2}):(\d{2})[–—-](\d{2}):(\d{2})/);return match?[+match[1]*60+ +match[2],+match[3]*60+ +match[4]]:null;};
  const events=[];
  for(const seg of segments) {if(!/^\d{4}-\d{2}-\d{2}$/.test(seg.a)||seg.e-seg.s>30)continue;
    for(let week=seg.s;week<=seg.e;week++)for(let day=1;day<=7;day++) {
      const dt=new Date(`${seg.a}T00:00:00Z`);dt.setUTCDate(dt.getUTCDate()+(week-seg.s)*7+day-1);const date=dt.toISOString().slice(0,10),change=special.get(date);if(change?.type==='off')continue;
      for(const c of courses.filter(c=>c.weeks.includes(week)&&c.day===(change?.day||day))) {
        const first=time(periods.find(p=>p.n===Math.min(...c.periods))?.t),last=time(periods.find(p=>p.n===Math.max(...c.periods))?.t);if(!first||!last||!c.name)continue;
        events.push({id:createHash('sha256').update(`${date}|${c.name}|${first[0]}`).digest('hex').slice(0,20),date,title:c.name,kind:'course',start:first[0],end:last[1],done:false,location:c.location,content:`${c.name}\n${c.location||''} ${c.teacher||''}\n第 ${week} 周${c.category==='exam'?' · 考试':''}`,source:'2026-1学期课表.html'});
      }
    }
  }
  return events;
}

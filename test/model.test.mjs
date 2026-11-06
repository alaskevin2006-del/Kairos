import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseAttention,validateSnapshot} from '../server/model.mjs';
import {parseCourses} from '../server/courses.mjs';
const source=lines=>`# Attention\n最近整理：2026-11-04 08:05。\n${lines}`;
test('date-only deadline means end of that calendar day, not the beginning',()=>{
 const {events,pending}=parseAttention(source('## 安排\n- [ ] 报告：11/8 前提交'));
 assert.equal(pending.length,0);assert.equal(events[0].date,'2026-11-08');assert.equal(events[0].start,1440);assert.equal(events[0].dueAt,'2026-11-09T00:00:00+08:00');
});
test('an explicit midnight belongs to the preceding day in the calendar',()=>{
 const {events}=parseAttention(source('## 安排\n- [ ] 实验：11/9 00:00 提交'));
 assert.equal(events[0].date,'2026-11-08');assert.equal(events[0].start,1440);assert.equal(events[0].dueAt,'2026-11-09T00:00:00+08:00');
});
test('only genuinely undated work goes to pending',()=>{
 const result=parseAttention(source('## 持续\n- [ ] Java 定题\n- [ ] 六级口试：11/22'));
 assert.equal(result.pending.length,1);assert.equal(result.events.length,1);
});
test('a dated activity is not a deadline and keeps an explicitly known time',()=>{
 const {events}=parseAttention(source('## 安排\n- [ ] 六级口试：11/22\n- [ ] 见面：11/7 14:00'));
 assert.equal(events[0].kind,'date');assert.equal(events[0].start,0);assert.equal(events[0].timeKnown,false);assert.equal(events[1].kind,'date');assert.equal(events[1].start,840);assert.equal(events[1].timeKnown,true);
});
test('recurring work respects its date range and exact hours',()=>{
 const {events}=parseAttention(source('## 实践周（11/5–11/6）\n- [ ] **每晚 20:00–22:00 计组实验**'));
 assert.deepEqual(events.map(e=>e.date),['2026-11-05','2026-11-06']);assert.equal(events[0].start,1200);assert.equal(events[0].end,1320);
});
test('unknown results and closed records never become completed events',()=>{
 const {events}=parseAttention(source('## 待核实\n- [ ] 实验：11/1\n## 已办\n- [x] 报告：11/2'));
 assert.equal(events.length,0);
});
test('past dates remain unconfirmed when the original checkbox is incomplete',()=>{
 const {events}=parseAttention(source('## 安排\n- [ ] 报告：11/1'));
 assert.equal(events[0].done,false);
});
test('course importer reads literal data, never executes HTML scripts',()=>{
 const html="const P = [{n:1,t:'08:00–08:45'}];const SEG = [{s:10,e:10,a:'2026-11-09'}];const C = [{n:'测试课程',t:'老师',l:'A1',w:[10],d:1,p:[1],c:'bi'}];throw new Error('must not execute');";
 const events=parseCourses(html);assert.equal(events.length,1);assert.equal(events[0].date,'2026-11-09');assert.equal(events[0].start,480);
});
test('invalid uploaded snapshot is rejected',()=>{
 assert.throws(()=>validateSnapshot({schema:1,events:[{id:'x',title:'x',date:'2026-11-05',kind:'event',start:-1,end:1}],documents:[],pending:[]}));
});
test('a dated bundle is split without applying a midnight deadline to every task',()=>{
 const {events}=parseAttention(source('## 周末（11/7–11/8）\n- [ ] **11/8 周日**：离散 PPT / 毛概定稿（11/8 前）/ **计组实验 11/9 00:00 提交**'));
 assert.equal(events.length,3);assert.ok(events.every(e=>e.date==='2026-11-08'));assert.ok(events.some(e=>e.title==='离散 PPT'));
 assert.equal(new Set(events.map(e=>e.id)).size,events.length);
});
test('proposed dates in alternatives are not booked',()=>{
 const {events,pending}=parseAttention(source('## 周末（11/7–11/8）\n- [ ] **C 复习**：方案待定 A 11/8 / B 11/7。需用户定'));
 assert.equal(events.length,0);assert.equal(pending.length,1);
});

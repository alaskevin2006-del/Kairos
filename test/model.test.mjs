import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseAttention,validateSnapshot} from '../server/model.mjs';
import {parseCourses} from '../server/courses.mjs';
const source=lines=>`# Attention\n最近整理：2026-11-04 08:05。\n${lines}`;
test('deadlines keep unknown times and real midnight',()=>{
 const {events}=parseAttention('## 近期\n- [ ] 2099-11-08 报告截止\n- [ ] 2099-11-09 00:00 实验提交');
 assert.equal(events[0].timeKnown,false);assert.equal(events[0].dueAt,null);assert.equal(events[1].date,'2099-11-09');assert.equal(events[1].start,0);assert.equal(events[1].dueAt,'2099-11-09T00:00:00+08:00');
});
test('past and explicit unverified entries never become newly scheduled or completed',()=>{
 const result=parseAttention('## 近期\n- [ ] 2020-11-01 提交报告\n## ③ 待核实\n- 2099-11-02 核查');assert.equal(result.events.length,0);assert.equal(result.unverified.length,2);assert.ok(result.unverified.every(i=>!i.done));
});
test('recurring Markdown respects explicit weekdays, range and hours',()=>{
 const {events}=parseAttention('## 固定安排\n- [ ] 每周一、三 10:00–11:00 复习；2099-11-02 至 2099-11-08');
 assert.ok(events.length>0);assert.ok(events.every(e=>[1,3].includes(new Date(e.date+'T00:00:00Z').getUTCDay())));assert.ok(events.every(e=>e.start===600&&e.end===660&&e.date>='2099-11-02'&&e.date<='2099-11-08'));
});
test('course importer reads literal data, never executes HTML scripts',()=>{
 const html="const P = [{n:1,t:'08:00–08:45'}];const SEG = [{s:10,e:10,a:'2026-11-09'}];const C = [{n:'测试课程',t:'老师',l:'A1',w:[10],d:1,p:[1],c:'bi'}];throw new Error('must not execute');";
 const events=parseCourses(html);assert.equal(events.length,1);assert.equal(events[0].date,'2026-11-09');assert.equal(events[0].start,480);
});
test('invalid uploaded snapshot is rejected',()=>{
 assert.throws(()=>validateSnapshot({schema:1,events:[{id:'x',title:'x',date:'2026-11-05',kind:'event',start:-1,end:1}],documents:[],pending:[]}));
});
test('a line containing slashes and plus signs remains one user action',()=>{
 const {events}=parseAttention('## 安排\n- [ ] 2099-11-08 整理 PPT / 讲义 + 录音');assert.equal(events.length,1);
});

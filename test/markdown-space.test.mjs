import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {openWorkspace} from '../server/workspace.mjs';
import {parseItems,scanDocuments,indexStats,synchronizeAttention} from '../server/document-index.mjs';
test('date-only deadlines, real midnight, status groups and source links',()=>{
 const items=parseItems('## ① 近期\n- [ ] **2099-11-09 00:00｜实验提交** 来源：[实验](matters/实验.md#交付)\n- [ ] **2099-11-10｜报告截止**\n## ③ 待核实\n- **2099-11-11｜旧节点**\n## ④ 弹性\n- **有空整理**','_attention.md','2099-11-07');
 assert.equal(items[0].date,'2099-11-09');assert.equal(items[0].start,0);assert.equal(items[0].dueAt,'2099-11-09T00:00:00+08:00');assert.equal(items[0].source,'matters/实验.md');assert.equal(items[0].anchor,'交付');
 assert.equal(items[1].timeKnown,false);assert.equal(items[1].dueAt,null);assert.equal(items[2].status,'unverified');assert.equal(items[3].kind,'pending');
 assert.equal(parseItems('- [ ] 2020-11-01 提交','_attention.md')[0].done,false);
});
test('attention only synchronizes a unique matching action with the same old facts',()=>{
 const attention='## ① 近期\n- [ ] **2099-11-09 12:00｜提交报告** 来源：[报告](matters/报告.md)';
 const old='- [ ] **2099-11-09 12:00｜提交报告**',next='- [x] **2099-11-10 14:00｜提交报告**';
 const changed=synchronizeAttention(attention,old,next,'matters/报告.md');assert.match(changed,/2099-11-10 14:00/);assert.match(changed,/\[x\]/);
 assert.equal(synchronizeAttention(attention,old,next+'\n'+next,'matters/报告.md'),attention);
});
test('new folders, original sources, incremental reads, external changes, history and conflicts',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'kairos-new-'));const root=path.join(dir,'documents');
 try{const w=await openWorkspace({root,privateDir:path.join(dir,'private'),local:true});
  await w.commit([{path:'matters/报告.md',version:null,content:'# 报告 #长期\n- [ ] **2099-11-09 12:00｜提交报告**'},{path:'_attention.md',version:null,content:'## ① 近期\n- [ ] **2099-11-09 12:00｜提交报告** 来源：[报告](matters/报告.md)'},{path:'journal/dairy/2099-11-07.md',version:null,content:'# 本人日记\n仅记录'},{path:'journal/AI/分析.md',version:null,content:'# AI 研析'},{path:'sources/通知.md',version:null,content:'# 原始通知\n2099-11-12 不自动生成任务'}]);
  let state=await w.state();assert.equal(state.events.length,1);assert.equal(state.events[0].source,'matters/报告.md');assert.equal(state.documents.filter(d=>d.type==='goals').length,1);assert.deepEqual(state.documents.filter(d=>d.type==='reviews').map(d=>d.author).sort(),['AI','本人']);
  const reads=indexStats(root).reads;await w.state();assert.equal(indexStats(root).reads,reads);
  const original=await w.read('matters/报告.md');await writeFile(path.join(root,original.path),original.content+'\n外部修改');await assert.rejects(w.commit([{...original,content:'stale'}]),e=>e.status===409);
  await scanDocuments(root,{force:true});assert.equal(indexStats(root).reads,reads+1);
  const latest=await w.read(original.path);const transaction=await w.commit([{...latest,content:latest.content.replace('2099-11-09 12:00','2099-11-10 14:00')}]);assert.equal(transaction.files.length,2);assert.match((await w.read('_attention.md')).content,/2099-11-10 14:00/);
  await w.undo(transaction.id);assert.match((await w.read('_attention.md')).content,/2099-11-09 12:00/);
  const diary=await w.read('journal/dairy/2099-11-07.md');const deletion=await w.commit([{...diary,content:null}],{allowDelete:true});assert.equal((await w.read(diary.path)).content,null);await w.undo(deletion.id);assert.equal((await w.read(diary.path)).content,diary.content);
  await rename(path.join(root,diary.path),path.join(root,'journal/dairy/重命名.md'));await scanDocuments(root,{force:true});assert.ok(!(await w.list()).some(f=>f.path===diary.path));
 }finally{assert.ok(dir.startsWith(path.join(os.tmpdir(),'kairos-new-')));await rm(dir,{recursive:true,force:true});}
});

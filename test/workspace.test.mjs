import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {openWorkspace,hash,documentPath} from '../server/workspace.mjs';
import {planSync} from '../server/file-sync.mjs';

async function fixture(fn){const dir=await mkdtemp(path.join(os.tmpdir(),'kairos-workspace-'));try{const opts={root:path.join(dir,'docs'),privateDir:path.join(dir,'private'),local:true};const w=await openWorkspace(opts);await fn(w,opts);}finally{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'kairos-workspace-'));await rm(dir,{recursive:true,force:true});}}
test('free Markdown, calendar projection, recurrence completion, undo and restart',()=>fixture(async(w,opts)=>{
 const content='# 自由的目标\n\n不需要固定标题或模板。\n周四晚上复习，提交截止 11/8。';
 const saved=await w.commit([{path:'goals/考试.md',version:null,content,kind:'goal',records:[{id:'routine',title:'复习',kind:'event',date:'2026-11-05',start:1200,end:1260,repeat:{days:[4],from:'2026-11-05',until:'2026-11-12'}},{id:'due',title:'提交',kind:'deadline',date:'2026-11-08'},{id:'unknown',title:'另一件事',kind:'pending'}]}]);
 let state=await w.state();assert.equal(state.events.length,3);assert.equal(state.pending.length,1);assert.equal(state.events.find(e=>e.recordId==='due').start,1440);assert.equal(state.documents[0].markdown,content);
 const item=state.events.find(e=>e.recordId==='routine'&&e.date==='2026-11-05'),done=await w.complete(item.id);state=await w.state();assert.equal(state.events.find(e=>e.id===item.id).done,true);assert.equal(state.events.find(e=>e.recordId==='routine'&&e.date==='2026-11-12').done,false);
 assert.match((await w.read('goals/考试.md')).content,/已完成/);await w.undo(done.id);assert.equal((await w.state()).events.find(e=>e.id===item.id).done,false);
 const restarted=await openWorkspace(opts);assert.equal((await restarted.read('goals/考试.md')).content,content);assert.equal((await restarted.state()).events.length,3);
 const undone=await restarted.undo(saved.id);assert.equal((await restarted.read('goals/考试.md')).content,null);assert.equal((await restarted.state()).events.length,0);await restarted.undo(undone.id);assert.equal((await restarted.read('goals/考试.md')).content,content);
}));
test('conflicts reject the entire batch before any source changes',()=>fixture(async(w)=>{
 await w.commit([{path:'a.md',version:null,content:'old'},{path:'b.md',version:null,content:'old'}]);
 await assert.rejects(w.commit([{path:'a.md',version:hash('old'),content:'new'},{path:'b.md',version:hash('stale'),content:'wrong'}]),/已有新修改/);
 assert.equal((await w.read('a.md')).content,'old');
 await assert.rejects(w.commit([{path:'../outside.md',version:null,content:'x'}]));await assert.rejects(w.commit([{path:'agent.md',version:null,content:'replace rules'}]),/规则/);
 assert.throws(()=>documentPath('C:/outside.md'));assert.throws(()=>documentPath('.private/key.md'));
}));
test('interrupted file transaction is recovered without losing the prior version',()=>fixture(async(w,opts)=>{
 await w.commit([{path:'a.md',version:null,content:'before'}]);await writeFile(path.join(opts.privateDir,'pending.json'),JSON.stringify({id:'interrupted',before:[{path:'a.md',content:'before'}]}));await writeFile(path.join(opts.root,'a.md'),'half written');
 const recovered=await openWorkspace(opts);assert.equal((await recovered.read('a.md')).content,'before');
}));
test('legacy completion feedback is durable and does not finish sibling tasks',()=>fixture(async(w)=>{
 await w.commit([{path:'_attention.md',version:null,content:'# Attention\n最近整理：2026-11-05\n## 今日\n- [ ] A 11/5 / B 11/5'}]);
 const s=await w.state();assert.equal(s.events.length,2);const done=await w.complete(s.events[0].id);const after=await w.state();assert.equal(after.events[0].done,true);assert.equal(after.events[1].done,false);await w.undo(done.id);const undone=await w.state();assert.equal(undone.events.length,2);assert.equal(undone.events[0].done,false);
}));
test('three-way sync preserves concurrent edits and first-connection differences',()=>{
 const f=(content)=>({path:'a.md',version:hash(content),content,records:null,kind:null});const old=f('old'),l=f('local'),r=f('remote');
 assert.equal(planSync([l],[r],{'a.md':old.version}).conflicts.length,1);
 assert.equal(planSync([l],[r]).conflicts.length,1);
 assert.equal(planSync([old],[r],{'a.md':old.version}).pull.length,1);
 assert.equal(planSync([l],[old],{'a.md':old.version}).push.length,1);
 assert.equal(planSync([], [r],{'a.md':old.version}).conflicts.length,1);
});
test('equal model-supplied record IDs in separate files cannot finish the wrong item',()=>fixture(async w=>{
 await w.commit(['a','b'].map(name=>({path:'tasks/'+name+'.md',version:null,content:'# '+name,records:[{id:'task-1',title:name,kind:'pending'}]})));
 const before=await w.state();assert.equal(new Set(before.pending.map(e=>e.id)).size,2);const item=before.pending.find(e=>e.source==='tasks/b.md');await w.complete(item.id);const after=await w.state();assert.equal(after.pending.find(e=>e.source==='tasks/a.md').done,false);assert.equal(after.pending.find(e=>e.source==='tasks/b.md').done,true);
}));

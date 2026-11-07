import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {startServer,passwordHash} from '../server/index.mjs';
import {endpoint,publicAddress,modelRequest} from '../server/secretary.mjs';
import http from 'node:http';

test('secretary finds existing documents, commits once, protects keys and isolates accounts',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'kairos-secretary-'));
 Object.assign(process.env,{KAIROS_USER:'kevin',KAIROS_SALT:'test-salt',KAIROS_PASSWORD_HASH:passwordHash('owner-pass','test-salt'),KAIROS_SYNC_TOKEN:'sync-token',KAIROS_ADMIN_USER:'admin',KAIROS_ADMIN_SALT:'admin-test',KAIROS_ADMIN_HASH:passwordHash('admin-pass','admin-test')});
 let calls=0;const request=async(c,p)=>{calls++;assert.equal(c.apiKey,'user-test-api-key');assert.ok(!p.messages[0].content.includes('tasks/<事项>'));const tool=(name,args)=>({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'call-'+calls,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]});
  const toolResults=p.messages.filter(m=>m.role==='tool');if(!toolResults.length)return tool('search_documents',{query:'报告'});
  if(toolResults.length===1)return tool('read_document',{path:'matters/报告.md'});
  const d=JSON.parse(toolResults.at(-1).content);return tool('save_changes',{message:'已记录你的安排，保留提交截止日期。',changes:[{path:d.path,version:d.version,content:'# 报告\n- [ ] 2099-11-07 14:00—15:00 修改报告\n- [ ] 2099-11-08 提交报告',kind:'task',records:[{id:'edit',title:'修改报告',kind:'event',date:'2026-11-07',start:840,end:900},{id:'submit',title:'提交报告',kind:'deadline',date:'2026-11-08'}]}]});};
 let app=await startServer({dataDir:dir,port:0,modelRequest:request});
 const req=async(endpoint,cookie,body,token)=>{const r=await fetch(app.url+endpoint,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 try{
  const owner=(await req('/api/login',null,{username:'kevin',password:'owner-pass'})).cookie,admin=(await req('/api/login',null,{username:'admin',password:'admin-pass'})).cookie;
  assert.equal((await req('/api/workspace/commit',owner,{changes:[{path:'matters/报告.md',version:null,content:'# 报告'}]})).status,200);
  assert.equal((await req('/api/sync',null,{schema:1,events:[],pending:[],documents:[]},'sync-token')).status,410);
  assert.equal((await req('/api/connections',null,undefined,'sync-token')).status,403);assert.equal((await req('/api/connections',admin)).status,403);
  const saved=await req('/api/connections',owner,{name:'自定义连接',url:'https://example.com/v1',model:'my-model',apiKey:'user-test-api-key',parameters:{temperature:0.2},default:true});assert.equal(saved.status,200);const connectionId=saved.data.id;
  assert.ok(!JSON.stringify((await req('/api/connections',owner)).data).includes('user-test-api-key'));
  const encrypted=await readFile(path.join(dir,'spaces','owner','secretary','connections.json'),'utf8');assert.ok(!encrypted.includes('user-test-api-key'));
  assert.equal((await req('/api/connections',owner,{name:'unsafe',url:'https://example.com/v1',model:'m',apiKey:'x',parameters:{messages:[]}})).status,400);
  const result=await req('/api/secretary/messages',owner,{message:'周六14点到15点修改报告，截止还是11月8日',requestId:'unique-request',connectionId});assert.equal(result.status,202);
  let thread;for(let i=0;i<100;i++){thread=(await req('/api/secretary/thread?id='+result.data.threadId,owner)).data;if(thread.turns[0].status!=='running')break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(thread.turns[0].status,'done',JSON.stringify(thread));assert.equal(thread.turns[0].transaction.files.length,1);assert.equal(calls,3);
  const duplicate=await req('/api/secretary/messages',owner,{message:'重复请求',requestId:'unique-request',connectionId});assert.equal(duplicate.data.turnId,result.data.turnId);assert.equal(calls,3);
  const state=(await req('/api/state',owner)).data;assert.equal(state.events.length,2);assert.equal(state.events.find(e=>e.kind==='deadline').timeKnown,false);
  const alice=(await req('/api/admin/users',admin,{username:'alice'})).data;const a=(await req('/api/login',null,{username:'alice',password:alice.password})).cookie;
  assert.deepEqual((await req('/api/connections',a)).data.connections,[]);assert.equal((await req('/api/secretary/thread?id='+result.data.threadId,a)).status,404);assert.equal((await req('/api/workspace/document?path=matters%2F报告.md',a)).data.content,null);
  assert.equal((await req('/api/workspace/document?path=..%2Fconnections.json',owner)).status,400);
  await req('/api/workspace/undo',owner,{id:thread.turns[0].transaction.id});assert.equal((await req('/api/state',owner)).data.events.length,0);
  await new Promise(resolve=>app.server.close(resolve));app=await startServer({dataDir:dir,port:0,modelRequest:request});const again=(await req('/api/login',null,{username:'kevin',password:'owner-pass'})).cookie;assert.equal((await req('/api/secretary/thread?id='+result.data.threadId,again)).data.turns.length,1);
 }finally{await new Promise(resolve=>app.server.close(resolve));assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'kairos-secretary-'));await rm(dir,{recursive:true,force:true});}
});
test('model endpoints and public-network validation prevent internal network requests',()=>{
 assert.equal(endpoint('https://example.com/v1').pathname,'/v1/chat/completions');assert.equal(endpoint('https://example.com/v1/chat/completions').pathname,'/v1/chat/completions');assert.throws(()=>endpoint('http://localhost:8000/v1'));assert.throws(()=>endpoint('https://key:password@example.com/v1'));assert.throws(()=>endpoint('https://example.com/v1?key=secret'));
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','172.16.0.1','::1','::ffff:127.0.0.1','fc00::1'])assert.equal(publicAddress(ip),false,ip);assert.equal(publicAddress('8.8.8.8'),true);
});
test('compatible HTTP transport sends custom parameters without forwarding credentials in the body',async()=>{
 const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);assert.equal(req.url,'/v1/chat/completions');assert.equal(req.headers.authorization,'Bearer transport-test');assert.equal(data.temperature,0.3);assert.ok(!raw.includes('transport-test'));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'OK'}}]}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));try{const result=await modelRequest({url:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'transport-test'},{model:'custom',temperature:0.3,messages:[{role:'user',content:'test'}]},{local:true});assert.equal(result.choices[0].message.content,'OK');}finally{await new Promise(r=>server.close(r));}
});

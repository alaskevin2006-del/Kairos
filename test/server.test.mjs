import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {startServer,passwordHash} from '../server/index.mjs';
test('private APIs, login, authenticated sync and restart persistence',async()=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'kairos-test-'));
 process.env.KAIROS_USER='test';process.env.KAIROS_SALT='testing-only-salt';process.env.KAIROS_PASSWORD_HASH=passwordHash('testing-only-password','testing-only-salt');process.env.KAIROS_SYNC_TOKEN='testing-only-sync-token';
 let app=await startServer({port:0,dataDir:folder});
 try {
  assert.equal((await fetch(app.url+'/api/state')).status,401);
  assert.equal((await fetch(app.url+'/api/login',{method:'POST',body:JSON.stringify({username:'test',password:'wrong'})})).status,401);
  const login=await fetch(app.url+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'test',password:'testing-only-password'})});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const payload={schema:1,events:[],pending:[],documents:[{id:'a',type:'goals',title:'真实目标',markdown:'# 目标\n<script>window.compromised=true</script>'}],revision:'test-revision'};
  assert.equal((await fetch(app.url+'/api/sync',{method:'POST',headers:{Cookie:cookie},body:JSON.stringify(payload)})).status,404);
  assert.equal((await fetch(app.url+'/api/sync',{method:'POST',headers:{Authorization:'Bearer testing-only-sync-token','Content-Type':'application/json'},body:JSON.stringify(payload)})).status,200);
  const read=await fetch(app.url+'/api/state',{headers:{Cookie:cookie}});assert.equal((await read.json()).revision,'test-revision');
  assert.match(read.headers.get('content-security-policy'),/script-src 'self'/);
  const forgery=await fetch(app.url+'/api/logout',{method:'POST',headers:{Cookie:cookie,Origin:'https://other.example'}});assert.equal(forgery.status,403);
  assert.equal((await fetch(app.url+'/%2e%2e/package.json')).status,404);
  await new Promise(resolve=>app.server.close(resolve));app=await startServer({port:0,dataDir:folder});
  const persisted=await fetch(app.url+'/api/state',{headers:{Authorization:'Bearer testing-only-sync-token'}});assert.equal((await persisted.json()).revision,'test-revision');
 }finally{await new Promise(resolve=>app.server.close(resolve));await rm(folder,{recursive:true,force:true});}
});

import http from 'node:http';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {readWorkspace,validateSnapshot} from './model.mjs';
import {openAccounts} from './accounts.mjs';
import {openWorkspace,hash,UserError,documentPath} from './workspace.mjs';
import {openSecretary} from './secretary.mjs';

const base=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const eq=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);};
export function passwordHash(password,salt) {return scryptSync(password,salt,32).toString('hex');}
export async function startServer(options={}) {
  const local=options.local===true;
  const folder=options.dataDir||process.env.DATA_DIR||path.join(base,'data');await mkdir(folder,{recursive:true});
  const snapshotFile=path.join(folder,'snapshot.json');
  const sessions=new Map(),attempts=new Map();
  const webUser=process.env.KAIROS_USER||'kevin',salt=process.env.KAIROS_SALT,passHash=process.env.KAIROS_PASSWORD_HASH;
  const syncToken=process.env.KAIROS_SYNC_TOKEN;
  const cookiePath=local?'/':(process.env.KAIROS_PUBLIC_PATH||'/');
  if(!local&&(!salt||!passHash||!syncToken))throw Error('部署前需要设置登录与同步凭据');
  const accounts=local?null:await openAccounts(folder);
  const spaces=new Map();
  async function space(user){
    const source=local?options.sourceRoot():null,key=local?hash(source):user.id;
    if(!spaces.has(key))spaces.set(key,(async()=>{
      const privateDir=path.join(folder,'spaces',key),root=local?source:path.join(privateDir,'documents');
      const workspace=await openWorkspace({root,privateDir,local,courseFile:options.courseFile});
      if(!local&&workspace.mode()==='snapshot'&&user.id!=='owner'){let hasSnapshot=false;try{await readFile(await accounts.snapshotPath(user.id));hasSnapshot=true;}catch(e){if(e.code!=='ENOENT')throw e;}if(!hasSnapshot)await workspace.commit([],{mode:'files',label:'初始化个人文档空间'});}
      const secretary=await openSecretary({dir:path.join(privateDir,'secretary'),workspace,local,guard:()=>local||!!accounts.byId(user.id)?.active,request:options.modelRequest});
      return{workspace,secretary};
    })().catch(e=>{spaces.delete(key);throw e;}));return spaces.get(key);
  }
  let snapshot={schema:1,events:[],pending:[],documents:[],revision:'empty'},lastError=null;
  try{snapshot=validateSnapshot(JSON.parse(await readFile(snapshotFile,'utf8')));}catch{}
  let reading=null;
  async function state(){
    if(local) {
      if(!reading)reading=(async()=>{try{snapshot=await (await space(null)).workspace.state();lastError=null;}catch(e){lastError='无法读取本地目录，请检查设置。';}finally{reading=null;}})();
      await reading;
    }
    return {...snapshot,error:lastError};
  }
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    const secure=req.headers['x-forwarded-proto']==='https';
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'");
    const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    const cookie=(req.headers.cookie||'').match(/(?:^|;\s*)kairos=([^;]+)/)?.[1];
    const session=sessions.get(cookie);const sessionUser=session&&accounts?.byId(session.userId);
    const signed=!!session&&session.expires>Date.now()&&!!sessionUser?.active&&session.authVersion===sessionUser.authVersion;
    if(session&&!signed)sessions.delete(cookie);
    const tokenUser=accounts?.token((req.headers.authorization||'').match(/^Bearer (.+)$/)?.[1]);
    const user=tokenUser||(signed?sessionUser:null);
    const localSigned=local&&eq(cookie,options.localToken);
    async function body(){let size=0;const parts=[];for await(const chunk of req){size+=chunk.length;if(size>16*1024*1024)throw Error('内容过大');parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString('utf8')||'{}');}
    try {
      if(url.pathname==='/healthz'){return send(200,{ok:true});}
      if(url.pathname==='/api/session'&&req.method==='GET')return send(200,{authenticated:local?localSigned:signed,local,user:signed?accounts.publicUser(sessionUser):null});
      if(url.pathname==='/api/login'&&req.method==='POST'&&!local) {
        const origin=req.headers.origin;if(origin&&new URL(origin).host!==req.headers.host)return send(403,{error:'请求来源不匹配'});
        const ip=req.socket.remoteAddress,now=Date.now();let limit=attempts.get(ip)||{count:0,time:now};if(now-limit.time>900000)limit={count:0,time:now};if(limit.count>=10)return send(429,{error:'尝试次数较多，请15分钟后重试'});
        const data=await body();const authenticated=accounts.login(data.username,data.password);
        if(!authenticated){limit.count++;attempts.set(ip,limit);return send(401,{error:'账号或密码不正确'});}
        attempts.delete(ip);const token=randomBytes(32).toString('hex');sessions.set(token,{userId:authenticated.id,authVersion:authenticated.authVersion,expires:now+7*86400000});if(sessions.size>1000)sessions.delete(sessions.keys().next().value);
        res.setHeader('Set-Cookie',`kairos=${token}; HttpOnly; SameSite=Strict; Path=${cookiePath}; Max-Age=604800${secure?'; Secure':''}`);return send(200,{ok:true});
      }
      if(url.pathname.startsWith('/api/')) {
        const bearer=!!tokenUser;
        if(!(local?localSigned:!!user))return send(401,{error:'请先登录'});
        if(req.method==='POST') {const origin=req.headers.origin;if(origin&&new URL(origin).host!==req.headers.host)return send(403,{error:'请求来源不匹配'});}
        if(url.pathname==='/api/logout'&&req.method==='POST'){sessions.delete(cookie);res.setHeader('Set-Cookie',`kairos=; Max-Age=0; HttpOnly; SameSite=Strict; Path=${cookiePath}`);return send(200,{ok:true});}
        if(url.pathname.startsWith('/api/admin/')){
          if(local||!signed||sessionUser.role!=='admin'||bearer)return send(403,{error:'仅管理员可执行此操作'});
          if(url.pathname==='/api/admin/users'&&req.method==='GET')return send(200,{users:accounts.list()});
          if(url.pathname==='/api/admin/users'&&req.method==='POST'){const data=await body();return send(201,await accounts.create(data.username));}
          const target=url.pathname.match(/^\/api\/admin\/users\/([a-zA-Z0-9-]+)$/);
          if(target&&req.method==='POST'){const data=await body();return send(200,await accounts.update(target[1],data.operation,sessionUser.id));}
          return send(404,{error:'未找到请求内容'});
        }
        if(!local&&user.role==='admin')return send(403,{error:'管理员账号仅用于账号管理，请使用个人账号查看日程'});
        if(bearer&&!['/api/state','/api/sync','/api/workspace/status','/api/workspace/files','/api/workspace/sync','/api/workspace/import'].includes(url.pathname))return send(403,{error:'同步密钥不能用于个人模型或秘书操作'});
        if(url.pathname==='/api/state'&&req.method==='GET'){
          if(local)return send(200,await state());
          const {workspace}=await space(user);if(workspace.mode()==='files')return send(200,await workspace.state());
          try{return send(200,validateSnapshot(JSON.parse(await readFile(await accounts.snapshotPath(user.id),'utf8'))));}catch(e){if(e.code!=='ENOENT')throw e;return send(200,{schema:1,events:[],pending:[],documents:[],revision:'empty-'+user.id,timezone:'Asia/Shanghai'});}
        }
        if(url.pathname==='/api/sync'&&req.method==='POST'&&!local&&bearer){
          if((await space(user)).workspace.mode()==='files')return send(409,{error:'此账号已启用 Markdown 文件空间，请使用新版客户端同步；旧快照不会覆盖文档'});
          const data=validateSnapshot(await body());const target=await accounts.snapshotPath(user.id);const file=target+'.'+randomBytes(8).toString('hex')+'.tmp';
          await writeFile(file,JSON.stringify(data),{mode:0o600});await rename(file,target);return send(200,{revision:data.revision});
        }
        if(url.pathname.startsWith('/api/workspace/')||url.pathname.startsWith('/api/secretary/')||url.pathname==='/api/connections'){
          const {workspace:w,secretary:s}=await space(user);
          if(url.pathname==='/api/workspace/status'&&req.method==='GET')return send(200,{mode:w.mode(),local});
          if(url.pathname==='/api/workspace/import'&&req.method==='POST'&&!local){
            if(w.mode()==='files')throw new UserError('文档空间已经启用，不能再次全量导入',409);const data=await body();if(!Array.isArray(data.files)||data.files.length>1000)throw new UserError('需要导入 Markdown 文件，最多 1000 份');
            const unique=new Set(),files=[];for(const f of data.files){documentPath(f.path);if(unique.has(f.path)||typeof f.content!=='string'||Buffer.byteLength(f.content)>2*1024*1024)throw new UserError('导入内容重复或无效');unique.add(f.path);const prior=await w.read(f.path);if(prior.content!==null&&prior.content!==f.content)throw new UserError('已有文档与导入内容不同，请先核对：'+f.path,409);if(prior.content===null)files.push(f);}
            const old=JSON.parse(await readFile(await accounts.snapshotPath(user.id),'utf8').catch(e=>{if(e.code==='ENOENT')return '{}';throw e;}));
            for(let i=0;i<files.length;i+=30){const batch=files.slice(i,i+30).map(f=>({...f,version:null}));await w.commit(batch,{label:'导入本地 Markdown',allowRules:true});}
            await w.commit([],{mode:'files',baseCourses:(old.events||[]).filter(e=>e.kind==='course'),label:'启用文档空间'});return send(200,{ok:true,files:data.files.length});
          }
          if(url.pathname==='/api/workspace/files'&&req.method==='GET'){if(w.mode()!=='files')throw new UserError('请先从新版客户端导入原始文档',409);return send(200,{files:(await w.list()).map(f=>({...f,records:w.index(f.path)?.hash===f.version?w.index(f.path).records:null,kind:w.kind(f.path)||null}))});}
          if(url.pathname==='/api/workspace/sync'&&req.method==='POST'){if(w.mode()!=='files')throw new UserError('请先导入原始文档',409);const data=await body();let courses;if(data.courses){validateSnapshot({schema:1,events:data.courses,pending:[],documents:[]});if(data.courses.some(e=>e.kind!=='course'))throw new UserError('课表来源类型无效');if(JSON.stringify(data.courses)!==JSON.stringify(w.courses()))courses=data.courses;}if(!data.changes?.length&&!courses)return send(200,{ok:true});return send(200,await w.commit(data.changes,{label:'同步本地文档',allowRules:true,baseCourses:courses}));}
          if(url.pathname==='/api/workspace/complete'&&req.method==='POST'){if(w.mode()!=='files')throw new UserError('请先导入原始文档',409);return send(200,await w.complete((await body()).id));}
          if(url.pathname==='/api/workspace/note'&&req.method==='POST'){if(w.mode()!=='files')throw new UserError('请先导入原始文档',409);const data=await body();if(typeof data.content!=='string'||!data.content.trim()||data.content.length>60000)throw new UserError('请输入要保存的原文');const name='inbox/输入-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(3).toString('hex')+'.md';return send(200,await w.commit([{path:name,version:null,content:data.content,kind:'note',records:[]}],{label:'保存原文'}));}
          if(url.pathname==='/api/workspace/history'&&req.method==='GET')return send(200,{history:w.history()});
          if(url.pathname==='/api/workspace/undo'&&req.method==='POST')return send(200,await w.undo((await body()).id));
          if(url.pathname==='/api/workspace/document'&&req.method==='GET')return send(200,await w.read(url.searchParams.get('path')));
          if(url.pathname==='/api/connections'&&req.method==='GET')return send(200,s.connections());
          if(url.pathname==='/api/connections'&&req.method==='POST')return send(200,await s.saveConnection(await body()));
          if(url.pathname==='/api/secretary/test'&&req.method==='POST')return send(200,await s.testConnection((await body()).id));
          if(url.pathname==='/api/secretary/threads'&&req.method==='GET')return send(200,{threads:s.threads()});
          if(url.pathname==='/api/secretary/thread'&&req.method==='GET')return send(200,s.thread(url.searchParams.get('id')));
          if(url.pathname==='/api/secretary/messages'&&req.method==='POST'){if(w.mode()!=='files')throw new UserError('当前账号仍是展示快照，请先用新版客户端导入 Markdown 原文',409);const version=user?.authVersion;return send(202,await s.send(await body(),()=>local||accounts.byId(user.id)?.authVersion===version));}
        }
        return send(404,{error:'未找到请求内容'});
      }
      if(req.method!=='GET'&&req.method!=='HEAD')return send(405,{error:'不支持的操作'});
      if(url.pathname==='/admin'){res.writeHead(308,{Location:cookiePath.replace(/\/$/,'')+'/admin/'});return res.end();}
      // Public HTML is only the login shell. All personal content lives behind authenticated API.
      const assets={'/':'index.html','/index.html':'index.html','/admin/':'admin.html','/admin/index.html':'admin.html','/app.js':'app.js','/style.css':'style.css','/logo.png':'logo.png','/logo.ico':'logo.ico','/favicon.ico':'logo.ico'};
      const file=assets[url.pathname];if(!file){res.writeHead(404);return res.end('Not found');}
      const content=await readFile(path.join(base,'dist',file));
      const mime=file.endsWith('.png')?'image/png':file.endsWith('.ico')?'image/x-icon':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';res.writeHead(200,{'Content-Type':`${mime}${mime.startsWith('image/')?'':'; charset=utf-8'}`,'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:content);
    }catch(e){send(e instanceof UserError?e.status:400,{error:e instanceof UserError?e.message:e.message==='内容过大'?'内容过大':'读取或处理失败，请重试'});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(options.port??+(process.env.PORT||8080),options.host||'127.0.0.1',resolve);});
  return {server,url:`http://127.0.0.1:${server.address().port}`,state,workspace:local?async()=>(await space(null)).workspace:undefined};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const local=process.env.KAIROS_LOCAL==='1';
  const token=local?randomBytes(32).toString('hex'):null;
  const app=await startServer({local,sourceRoot:()=>process.env.KAIROS_SOURCE,localToken:token,host:process.env.HOST||'127.0.0.1'});
  console.log(`Kairos: ${app.url}`);
  if(local)console.log('Local mode is intended for the desktop app.');
}

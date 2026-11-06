import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID,scryptSync,createHash,timingSafeEqual} from 'node:crypto';
export const digest=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);};
export const hashPassword=(value,salt)=>scryptSync(value,salt,32).toString('hex');
export async function openAccounts(folder){
 const file=path.join(folder,'accounts.json');let db;
 try{db=JSON.parse(await readFile(file,'utf8'));if(db.schema!==1||!Array.isArray(db.users))throw Error('账号存储格式错误');}catch(e){if(e.code!=='ENOENT')throw e;db={schema:1,users:[]};}
 let queue=Promise.resolve();
 async function save(){const tmp=file+'.'+randomBytes(6).toString('hex')+'.tmp';await writeFile(tmp,JSON.stringify(db),{mode:0o600});await rename(tmp,file);}
 async function change(fn){const result=queue.then(async()=>{const before=structuredClone(db);try{const value=await fn();await save();return value;}catch(e){db=before;throw e;}});queue=result.catch(()=>{});return result;}
 if(!db.users.length)await change(()=>{db.users.push({id:'owner',username:process.env.KAIROS_USER||'kevin',role:'user',active:true,salt:process.env.KAIROS_SALT,passwordHash:process.env.KAIROS_PASSWORD_HASH,tokenHash:digest(process.env.KAIROS_SYNC_TOKEN),authVersion:1,createdAt:new Date().toISOString()});});
 if(process.env.KAIROS_ADMIN_USER&&!db.users.some(u=>u.role==='admin'))await change(()=>{
   const username=process.env.KAIROS_ADMIN_USER;if(db.users.some(u=>u.username.toLowerCase()===username.toLowerCase()))throw Error('管理员名称与已有账号重复');
   if(!process.env.KAIROS_ADMIN_SALT||!process.env.KAIROS_ADMIN_HASH)throw Error('管理员初始化凭据不完整');
   db.users.push({id:randomUUID(),username,role:'admin',active:true,salt:process.env.KAIROS_ADMIN_SALT,passwordHash:process.env.KAIROS_ADMIN_HASH,tokenHash:null,authVersion:1,createdAt:new Date().toISOString()});
 });
 const publicUser=u=>({id:u.id,username:u.username,role:u.role,active:u.active,createdAt:u.createdAt});
 return {
   byId:id=>db.users.find(u=>u.id===id),
   login(username,password){const u=db.users.find(u=>u.username.toLowerCase()===String(username).toLowerCase());const salt=u?.salt||'invalid-account';const computed=hashPassword(String(password||''),salt);return u?.active&&equal(computed,u.passwordHash)?u:null;},
   token(value){if(!value)return null;const hash=digest(value);return db.users.find(u=>u.active&&u.tokenHash&&equal(u.tokenHash,hash));},
   list:()=>db.users.map(publicUser),publicUser,
   create:username=>change(()=>{
     username=String(username||'').trim();if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}$/.test(username))throw Error('账号需为3—32位字母、数字、点、下划线或短横线');
     if(db.users.some(u=>u.username.toLowerCase()===username.toLowerCase()))throw Error('账号已存在');
     if(db.users.length>=500)throw Error('账号数量已达上限');
     const password=randomBytes(18).toString('base64url'),token=randomBytes(32).toString('base64url'),salt=randomBytes(16).toString('hex');
     const u={id:randomUUID(),username,role:'user',active:true,salt,passwordHash:hashPassword(password,salt),tokenHash:digest(token),authVersion:1,createdAt:new Date().toISOString()};db.users.push(u);
     return {user:publicUser(u),password,syncToken:token};
   }),
   update:(id,operation,actorId)=>change(()=>{
     const u=db.users.find(u=>u.id===id);if(!u)throw Error('账号不存在');if(u.id===actorId)throw Error('不能在管理入口修改当前管理员');
     if(operation==='reset-password'){const password=randomBytes(18).toString('base64url');u.salt=randomBytes(16).toString('hex');u.passwordHash=hashPassword(password,u.salt);u.authVersion++;return {user:publicUser(u),password};}
     if(operation==='disable'||operation==='enable'){u.active=operation==='enable';u.authVersion++;return {user:publicUser(u)};}
     throw Error('不支持的账号操作');
   }),
   snapshotPath:async id=>{if(id==='owner')return path.join(folder,'snapshot.json');if(!db.users.some(u=>u.id===id))throw Error('账号不存在');const dir=path.join(folder,'users',id);await mkdir(dir,{recursive:true,mode:0o700});return path.join(dir,'snapshot.json');}
 };
}

const {app,BrowserWindow,ipcMain,dialog,safeStorage,Menu,shell}=require('electron');
const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const {randomBytes,createHash}=require('node:crypto');const {pathToFileURL}=require('node:url');
let win,service,config,settingsPath,timer,syncing=false,lastSynced='',lastStatus='';
const defaults={sourceRoot:path.join(os.homedir(),'Desktop','Kairos'),courseFile:'',remoteUrl:'',remoteSecret:'',autoSync:false};
const digest=s=>createHash('sha256').update(s).digest('hex');
async function save(){await fs.writeFile(settingsPath,JSON.stringify(config,null,2),{mode:0o600});}
function secret(){return config.remoteSecret?safeStorage.decryptString(Buffer.from(config.remoteSecret,'base64')):'';}
function report(message){if(lastStatus===message)return;lastStatus=message;win?.webContents.send('sync:status',message);}
async function remote(endpoint,body){const response=await fetch(config.remoteUrl.replace(/\/$/,'')+endpoint,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+secret()},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});const data=await response.json();if(!response.ok)throw Error(data.error||'同步暂未成功');return data;}
function syncFile(){return path.join(app.getPath('userData'),'file-sync-'+digest(config.sourceRoot+'|'+config.remoteUrl+'|'+secret()).slice(0,20)+'.json');}
async function syncCache(){try{return JSON.parse(await fs.readFile(syncFile(),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;return{baseline:{},conflicts:[]};}}
async function cacheSave(cache){const target=syncFile(),temp=target+'.tmp';await fs.writeFile(temp,JSON.stringify(cache),{mode:0o600});await fs.rename(temp,target);}
async function syncFiles(){
 const {planSync}=await import(pathToFileURL(path.join(__dirname,'../server/file-sync.mjs')).href),workspace=await service.workspace(),cache=await syncCache();
 const local=(await workspace.list()).map(f=>({...f,records:workspace.index(f.path)?.hash===f.version?workspace.index(f.path).records:null,kind:workspace.kind(f.path)||null}));
 const cloud=(await remote('/api/workspace/files')).files,plan=planSync(local,cloud,cache.baseline);Object.assign(cache.baseline,plan.shared);
 for(let i=0;i<plan.push.length;i+=30){const changes=plan.push.slice(i,i+30).map(f=>({...f,records:f.records??undefined}));await remote('/api/workspace/sync',{changes});for(const f of changes)cache.baseline[f.path]=digest(f.content);}
 for(let i=0;i<plan.pull.length;i+=30){const changes=plan.pull.slice(i,i+30).map(f=>({...f,records:f.records??undefined}));await workspace.commit(changes,{label:'同步服务器文档',allowRules:true});for(const f of changes)cache.baseline[f.path]=digest(f.content);}
 cache.conflicts=plan.conflicts;await cacheSave(cache);report(plan.conflicts.length?`有 ${plan.conflicts.length} 份文档存在同步冲突，请在同步设置中选择版本`:'Markdown 文档已同步');
 const state=await service.state();if(!state.error){const courses=state.events.filter(e=>e.kind==='course');if(courses.length)await remote('/api/workspace/sync',{changes:[],courses});}
}
async function sync(){
  if(syncing||!config.autoSync||!config.remoteUrl||!config.remoteSecret)return;
  syncing=true;
  try {
    if((await remote('/api/workspace/status')).mode==='files'){await syncFiles();return;}
    const data=await service.state();if(data.error)throw Error(data.error);if(data.revision===lastSynced)return;
    delete data.error;
    const r=await fetch(config.remoteUrl.replace(/\/$/,'')+'/api/sync',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+secret()},body:JSON.stringify(data),signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw Error('同步暂未成功');lastSynced=data.revision;report('网页已同步');
  }catch(e){report(e.message||'网页暂未同步，本地内容仍可查看');}finally{syncing=false;}
}
async function main(){
  await app.whenReady();
  if(process.platform==='win32')app.setAppUserModelId('space.kevin.kairos');
  settingsPath=path.join(app.getPath('userData'),'settings.json');
  config={...defaults};try{Object.assign(config,JSON.parse(await fs.readFile(settingsPath,'utf8')));}catch{}
  // Provisioning is an explicit, local one-time operation; plaintext is never written to app settings.
  const seed=process.argv.find(a=>a.startsWith('--provision='));
  if(seed){const data=JSON.parse(await fs.readFile(seed.slice(12),'utf8'));if(!safeStorage.isEncryptionAvailable())throw Error('本机加密存储不可用');config={...config,sourceRoot:data.sourceRoot||config.sourceRoot,remoteUrl:data.remoteUrl,remoteSecret:safeStorage.encryptString(data.remoteToken).toString('base64'),autoSync:true};await save();if(process.argv.includes('--provision-only')){app.quit();return;}}
  const token=randomBytes(32).toString('hex');
  const {startServer}=await import(pathToFileURL(path.join(__dirname,'../server/index.mjs')).href);
  service=await startServer({local:true,sourceRoot:()=>config.sourceRoot,courseFile:()=>config.courseFile,localToken:token,port:0,dataDir:path.join(app.getPath('userData'),'cache')});
  win=new BrowserWindow({width:1470,height:960,minWidth:940,minHeight:650,title:'Kairos',icon:path.join(__dirname,'../assets/logo.png'),backgroundColor:'#FAF9F0',autoHideMenuBar:true,show:!process.argv.includes('--smoke-test'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  win.webContents.session.setPermissionRequestHandler((wc,permission,callback)=>callback(false));
  await win.webContents.session.cookies.set({url:service.url,name:'kairos',value:token,httpOnly:true,sameSite:'strict',path:'/'});
  const trusted=event=>{if(event.sender!==win.webContents||event.senderFrame?.url?.startsWith(service.url+'/')!==true)throw Error('不允许的请求');};
  ipcMain.handle('settings:get',async event=>{trusted(event);return{sourceRoot:config.sourceRoot,courseFile:config.courseFile,remoteUrl:config.remoteUrl,autoSync:config.autoSync,hasToken:!!config.remoteSecret,conflicts:config.remoteSecret?(await syncCache()).conflicts.length:0};});
  ipcMain.handle('settings:cloud',async event=>{trusted(event);if(!config.remoteUrl)throw Error('请先保存网页地址');await win.loadURL(config.remoteUrl);});
  ipcMain.handle('sync:conflicts',async event=>{trusted(event);return(await syncCache()).conflicts;});
  ipcMain.handle('sync:enable-files',async event=>{trusted(event);if(syncing)throw Error('正在同步，请稍后再试');syncing=true;try{const w=await service.workspace();const files=await w.list();await remote('/api/workspace/import',{files});await syncFiles();return true;}finally{syncing=false;}});
  ipcMain.handle('sync:resolve',async(event,value)=>{
    trusted(event);if(syncing)throw Error('正在同步，请稍后再试');syncing=true;try{const cache=await syncCache(),c=cache.conflicts.find(c=>c.path===value.path);if(!c)throw Error('该冲突已处理，请刷新');const w=await service.workspace(),l=await w.read(c.path),r=(await remote('/api/workspace/files')).files.find(f=>f.path===c.path);
    if(l.version!==(c.local?.version||null)||(r?.version||null)!==(c.remote?.version||null))throw Error('文档又有修改，请关闭窗口，等待同步刷新后再选择');
    if(value.choice==='remote'&&r)await w.commit([{...r,version:l.version,records:r.records??undefined}],{label:'冲突处理：采用服务器版本',allowRules:true});else if(value.choice==='local'&&l.content!==null)await remote('/api/workspace/sync',{changes:[{...l,version:r?.version||null,records:w.index(l.path)?.hash===l.version?w.index(l.path).records:undefined,kind:w.kind(l.path)}]});else throw Error('该版本不存在，不会自动删除另一侧文档');
    cache.baseline[c.path]=value.choice==='remote'?r.version:l.version;cache.conflicts=cache.conflicts.filter(x=>x.path!==c.path);await cacheSave(cache);return true;}finally{syncing=false;}
  });
  ipcMain.handle('settings:folder',async event=>{trusted(event);const result=await dialog.showOpenDialog(win,{properties:['openDirectory']});return result.canceled?null:result.filePaths[0];});
  ipcMain.handle('settings:save',async(event,value)=>{
    trusted(event);if(typeof value.sourceRoot!=='string'||!(await fs.stat(value.sourceRoot)).isDirectory())throw Error('请选择有效的本地目录');
    if(value.remoteUrl){const url=new URL(value.remoteUrl);if(url.protocol!=='https:'&&url.hostname!=='127.0.0.1'&&url.hostname!=='localhost')throw Error('网页同步需要 HTTPS 地址');if(url.username||url.password||url.search||url.hash)throw Error('请输入不含查询参数和密码的网页地址');}
    const next={...config,sourceRoot:value.sourceRoot,courseFile:String(value.courseFile||''),remoteUrl:String(value.remoteUrl||''),autoSync:!!value.autoSync};
    if(value.remoteToken){if(!safeStorage.isEncryptionAvailable())throw Error('本机加密存储不可用');next.remoteSecret=safeStorage.encryptString(String(value.remoteToken)).toString('base64');}
    config=next;await save();lastSynced='';sync();return true;
  });
  win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//.test(url))shell.openExternal(url);return{action:'deny'};});
  win.webContents.on('will-navigate',(event,url)=>{const dest=new URL(url);const cloud=config.remoteUrl?new URL(config.remoteUrl):null;if(dest.origin!==service.url&&!(cloud&&dest.origin===cloud.origin&&dest.pathname.startsWith(cloud.pathname.replace(/\/$/,'')+'/')))event.preventDefault();});
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Kairos',submenu:[{label:'本地空间',click:()=>win.loadURL(service.url)},{label:'服务器空间',click:()=>{if(config.remoteUrl)win.loadURL(config.remoteUrl);}},{label:'重新读取',click:()=>win.webContents.reload()},{type:'separator'},{role:'quit',label:'退出'}]},{label:'查看',submenu:[{role:'zoomIn',label:'放大'},{role:'zoomOut',label:'缩小'},{role:'resetZoom',label:'实际大小'},{role:'togglefullscreen',label:'全屏'}]}]));
  await win.loadURL(service.url);
  if(process.argv.includes('--smoke-test')){const snapshot=await service.state();const cookies=await win.webContents.session.cookies.get({url:service.url});const result={title:win.getTitle(),url:service.url,localCookieSet:cookies.some(c=>c.name==='kairos'&&c.httpOnly&&c.value===token),events:snapshot.events.length,documents:snapshot.documents.length,error:snapshot.error||null};const output=process.argv.find(a=>a.startsWith('--report='));if(output)await fs.writeFile(output.slice(9),JSON.stringify(result,null,2));app.quit();return;}
  sync();timer=setInterval(sync,15000);
}
if(!app.requestSingleInstanceLock())app.quit();else{app.on('second-instance',()=>{win?.show();win?.focus();});main().catch(error=>{dialog.showErrorBox('Kairos 启动失败',error.message);app.quit();});}
app.on('window-all-closed',()=>app.quit());app.on('before-quit',()=>{clearInterval(timer);service?.server.close();});

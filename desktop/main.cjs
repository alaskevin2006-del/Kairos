const {app,BrowserWindow,ipcMain,dialog,safeStorage,Menu,shell}=require('electron');
const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const {randomBytes,createHash}=require('node:crypto');const {pathToFileURL}=require('node:url');
let win,service,config,settingsPath;
async function save(){await fs.writeFile(settingsPath,JSON.stringify(config,null,2),{mode:0o600});}
const defaults={sourceRoot:path.join(os.homedir(),'Desktop','Kairos'),courseFile:'',remoteUrl:'',remoteSecret:'',autoSync:false};
async function main(){
  await app.whenReady();
  if(process.platform==='win32')app.setAppUserModelId('space.kevin.kairos');
  settingsPath=path.join(app.getPath('userData'),'settings.json');
  config={...defaults};try{Object.assign(config,JSON.parse(await fs.readFile(settingsPath,'utf8')));}catch{}
  if(config.autoSync)await fs.copyFile(settingsPath,settingsPath+'.before-1.2.json');
  config.autoSync=false;
  if(!config.courseFile){const original=path.join(os.homedir(),'Desktop','2026-2027学年第一学期课程','2026-1学期课表.html');try{if((await fs.stat(original)).isFile())config.courseFile=original;}catch{}}
  await save();
  const token=randomBytes(32).toString('hex');
  const {startServer}=await import(pathToFileURL(path.join(__dirname,'../server/index.mjs')).href);
  service=await startServer({local:true,sourceRoot:()=>config.sourceRoot,courseFile:()=>config.courseFile,localToken:token,port:0,dataDir:path.join(app.getPath('userData'),'cache')});
  win=new BrowserWindow({width:1470,height:960,minWidth:760,minHeight:650,title:'Kairos',icon:path.join(__dirname,'../assets/logo.png'),backgroundColor:'#FAF9F0',autoHideMenuBar:true,show:!process.argv.includes('--smoke-test'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  win.webContents.session.setPermissionRequestHandler((wc,permission,callback)=>callback(false));
  await win.webContents.session.cookies.set({url:service.url,name:'kairos',value:token,httpOnly:true,sameSite:'strict',path:'/'});
  const trusted=event=>{if(event.sender!==win.webContents||event.senderFrame?.url?.startsWith(service.url+'/')!==true)throw Error('不允许的请求');};
  ipcMain.handle('workspace:obsidian',async(event,file)=>{
    trusted(event);
    if(typeof file!=='string'||!file.endsWith('.md')||path.isAbsolute(file))throw Error('请选择工作区内的 Markdown 文件');
    const root=await fs.realpath(config.sourceRoot);
    const target=await fs.realpath(path.resolve(root,file));
    const relative=path.relative(root,target);
    if(!relative||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||!(await fs.stat(target)).isFile())throw Error('无法打开工作区外的文件');
    await shell.openExternal('obsidian://open?path='+encodeURIComponent(target));
  });
  ipcMain.handle('settings:get',async event=>{trusted(event);return{sourceRoot:config.sourceRoot,courseFile:config.courseFile,remoteUrl:config.remoteUrl,autoSync:false};});
  ipcMain.handle('settings:cloud',async event=>{trusted(event);if(config.remoteUrl)await shell.openExternal(config.remoteUrl);});
  ipcMain.handle('settings:folder',async event=>{trusted(event);const result=await dialog.showOpenDialog(win,{properties:['openDirectory']});return result.canceled?null:result.filePaths[0];});
  ipcMain.handle('settings:save',async(event,value)=>{
    trusted(event);if(typeof value.sourceRoot!=='string'||!(await fs.stat(value.sourceRoot)).isDirectory())throw Error('请选择有效的本地目录');
    if(value.remoteUrl){const url=new URL(value.remoteUrl);if(url.protocol!=='https:'&&url.hostname!=='127.0.0.1'&&url.hostname!=='localhost')throw Error('网页同步需要 HTTPS 地址');if(url.username||url.password||url.search||url.hash)throw Error('请输入不含查询参数和密码的网页地址');}
    const next={...config,sourceRoot:value.sourceRoot,courseFile:String(value.courseFile||''),remoteUrl:String(value.remoteUrl||''),autoSync:false};
    if(value.remoteToken){if(!safeStorage.isEncryptionAvailable())throw Error('本机加密存储不可用');next.remoteSecret=safeStorage.encryptString(String(value.remoteToken)).toString('base64');}
    config=next;await save();return true;
  });
  win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//.test(url))shell.openExternal(url);return{action:'deny'};});
  win.webContents.on('will-navigate',(event,url)=>{const dest=new URL(url);const cloud=config.remoteUrl?new URL(config.remoteUrl):null;if(dest.origin!==service.url&&!(cloud&&dest.origin===cloud.origin&&dest.pathname.startsWith(cloud.pathname.replace(/\/$/,'')+'/')))event.preventDefault();});
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Kairos',submenu:[{label:'本地空间',click:()=>win.loadURL(service.url)},{label:'在浏览器打开本地空间',click:()=>shell.openExternal(service.url+'/local-open?token='+token)},{label:'服务器空间',click:()=>{if(config.remoteUrl)win.loadURL(config.remoteUrl);}},{label:'重新读取',click:()=>win.webContents.reload()},{type:'separator'},{role:'quit',label:'退出'}]},{label:'查看',submenu:[{role:'zoomIn',label:'放大'},{role:'zoomOut',label:'缩小'},{role:'resetZoom',label:'实际大小'},{role:'togglefullscreen',label:'全屏'}]}]));
  await win.loadURL(service.url);
  if(process.argv.includes('--smoke-test')){const snapshot=await service.state();const cookies=await win.webContents.session.cookies.get({url:service.url});const result={title:win.getTitle(),url:service.url,localCookieSet:cookies.some(c=>c.name==='kairos'&&c.httpOnly&&c.value===token),events:snapshot.events.length,documents:snapshot.documents.length,error:snapshot.error||null};const output=process.argv.find(a=>a.startsWith('--report='));if(output)await fs.writeFile(output.slice(9),JSON.stringify(result,null,2));app.quit();return;}

}
if(!app.requestSingleInstanceLock())app.quit();else{app.on('second-instance',()=>{win?.show();win?.focus();});main().catch(error=>{dialog.showErrorBox('Kairos 启动失败',error.message);app.quit();});}
app.on('window-all-closed',()=>app.quit());app.on('before-quit',()=>{service?.server.close();});

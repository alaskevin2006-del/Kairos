const {contextBridge,ipcRenderer}=require('electron');
if(location.protocol==='http:'&&location.hostname==='127.0.0.1')contextBridge.exposeInMainWorld('kairos',{
  settings:()=>ipcRenderer.invoke('settings:get'),
  chooseFolder:()=>ipcRenderer.invoke('settings:folder'),
  saveSettings:value=>ipcRenderer.invoke('settings:save',value),
  enableFileSync:()=>ipcRenderer.invoke('sync:enable-files'),
  conflicts:()=>ipcRenderer.invoke('sync:conflicts'),
  resolveConflict:value=>ipcRenderer.invoke('sync:resolve',value),
  openCloud:()=>ipcRenderer.invoke('settings:cloud'),
  onSync:callback=>{const listener=(_,value)=>callback(value);ipcRenderer.on('sync:status',listener);return()=>ipcRenderer.removeListener('sync:status',listener);}
});

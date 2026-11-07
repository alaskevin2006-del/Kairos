const {contextBridge,ipcRenderer}=require('electron');
if(location.protocol==='http:'&&location.hostname==='127.0.0.1')contextBridge.exposeInMainWorld('kairos',{
  openObsidian:file=>ipcRenderer.invoke('workspace:obsidian',file),
  settings:()=>ipcRenderer.invoke('settings:get'),
  chooseFolder:()=>ipcRenderer.invoke('settings:folder'),
  saveSettings:value=>ipcRenderer.invoke('settings:save',value),
  openCloud:()=>ipcRenderer.invoke('settings:cloud')
});
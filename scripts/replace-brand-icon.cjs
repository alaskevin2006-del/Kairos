const {readFile,writeFile}=require('node:fs/promises');
const path=require('node:path');
const {NtExecutable,NtExecutableResource,Data,Resource}=require('resedit');

module.exports=async context=>{
  if(context.electronPlatformName!=='win32')return;
  const file=path.join(context.appOutDir,'Kairos.exe');
  const executable=NtExecutable.from(await readFile(file));
  const resources=NtExecutableResource.from(executable);
  // Remove every old icon group and image, including unused Electron resources.
  resources.entries=resources.entries.filter(entry=>entry.type!==3&&entry.type!==14);
  const icon=Data.IconFile.from(await readFile(path.join(context.packager.projectDir,'assets','logo.ico')));
  Resource.IconGroupEntry.replaceIconsForResource(resources.entries,1,1033,icon.icons.map(frame=>frame.data));
  resources.outputResource(executable);
  await writeFile(file,Buffer.from(executable.generate()));
  console.log('Kairos: all previous executable icon resources replaced.');
};

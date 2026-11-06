// Merge by the last shared content version. Neither side wins a concurrent edit.
export function planSync(localFiles,remoteFiles,baseline={}){
 const local=new Map(localFiles.map(f=>[f.path,f])),remote=new Map(remoteFiles.map(f=>[f.path,f]));const push=[],pull=[],conflicts=[],shared={};
 for(const p of new Set([...local.keys(),...remote.keys()])){const l=local.get(p),r=remote.get(p),base=baseline[p];
  if(l&&r&&l.version===r.version){shared[p]=l.version;const a=JSON.stringify(l.records||null),b=JSON.stringify(r.records||null);if(a!==b||l.kind!==r.kind)pull.push({...r,version:l.version});continue;}
  if(l&&(!r&&!base||r&&r.version===base)){push.push({...l,version:r?.version||null});continue;}
  if(r&&(!l&&!base||l&&l.version===base)){pull.push({...r,version:l?.version||null});continue;}
  conflicts.push({path:p,local:l||null,remote:r||null,base:base||null});
 }
 return{push,pull,conflicts,shared};
}

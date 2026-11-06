const fs=require('node:fs');const crypto=require('node:crypto');const {NtExecutable,NtExecutableResource}=require('resedit');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const ico=fs.readFileSync('assets/logo.ico');const count=ico.readUInt16LE(4);const expected=new Set();
for(let i=0;i<count;i++){const pos=6+i*16,len=ico.readUInt32LE(pos+8),offset=ico.readUInt32LE(pos+12);expected.add(digest(ico.subarray(offset,offset+len)));}
for(const file of process.argv.slice(2)){
 const res=NtExecutableResource.from(NtExecutable.from(fs.readFileSync(file),{ignoreCert:true}));
 const icons=res.entries.filter(e=>e.type===3),groups=res.entries.filter(e=>e.type===14);
 const old=icons.filter(e=>!expected.has(digest(Buffer.from(e.bin))));
 console.log(JSON.stringify({file,iconImages:icons.length,iconGroups:groups.length,oldIcons:old.length}));
 if(!icons.length||old.length)process.exitCode=1;
}

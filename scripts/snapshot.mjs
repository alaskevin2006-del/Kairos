import {readWorkspace} from '../server/model.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const data=await readWorkspace(process.argv[2]);
await mkdir('.private',{recursive:true});await writeFile('.private/snapshot.json',JSON.stringify(data));
console.log(JSON.stringify({events:data.events.length,pending:data.pending.length,documents:data.documents.map(d=>({title:d.title,type:d.type})),week:data.events.filter(e=>e.date>='2026-11-02'&&e.date<='2026-11-08').map(e=>({title:e.title,date:e.date,start:e.start,end:e.end,kind:e.kind})),pendingTitles:data.pending.map(e=>e.title)},null,2));

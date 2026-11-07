export function documentEditor({api,esc,markdown,modal,toast,refresh,account}){
 let active=null;
 async function openFile(p){
  const [name,anchor]=p.split('#');
  try{
   const f=await api('/api/workspace/document?path='+encodeURIComponent(name));
   if(f.content===null){toast('链接不存在：'+name);return;}
   const key='kairos-draft:'+account()+':'+name;
   let draft=localStorage.getItem(key)??f.content,editing=draft!==f.content,version=f.version;
   const d=modal('');active={path:name,version,dialog:d,dirty:()=>draft!==f.content};
   const paint=()=>{
    d.classList.add('editor-dialog');d.innerHTML=`<button class="close" aria-label="关闭">×</button><h2>${esc(name)}</h2><div class="form-actions"><button id="toggle-edit" class="quiet">${editing?'阅读预览':'编辑源码'}</button><button id="save-doc" class="primary">保存</button><button id="reload-doc" class="quiet">比较／重新读取</button><button id="delete-doc" class="quiet">删除文件</button></div><p id="save-state" role="status">${draft===f.content?'已保存':'有未保存草稿（保存在本机）'}</p>${editing?`<textarea id="doc-source" spellcheck="false" aria-label="Markdown 源码">${esc(draft)}</textarea>`:`<article class="markdown">${markdown(draft)}</article>`}`;
    d.querySelector('.close').onclick=()=>d.close();
    d.querySelector('#toggle-edit').onclick=()=>{editing=!editing;paint();};
    d.querySelector('#doc-source')?.addEventListener('input',e=>{draft=e.target.value;localStorage.setItem(key,draft);d.querySelector('#save-state').textContent='未保存 · 草稿已保留';});
    d.querySelector('#save-doc').onclick=async()=>{try{await api('/api/workspace/commit',{changes:[{path:name,content:draft,version}]});const saved=await api('/api/workspace/document?path='+encodeURIComponent(name));version=saved.version;f.content=draft;active.version=version;localStorage.removeItem(key);paint();await refresh();}catch(e){d.querySelector('#save-state').textContent=e.message+'；草稿已保留，请比较新版本。';}};
    d.querySelector('#reload-doc').onclick=async()=>{try{const latest=await api('/api/workspace/document?path='+encodeURIComponent(name));let comparison=d.querySelector('.comparison');if(!comparison){comparison=document.createElement('section');comparison.className='comparison';d.append(comparison);}comparison.innerHTML=`<h3>磁盘最新版本</h3><pre>${esc(latest.content??'文件已删除')}</pre><button id="adopt-disk">采用磁盘版本（替换当前草稿）</button>`;comparison.querySelector('button').onclick=()=>{if(!confirm('用磁盘版本替换当前草稿？'))return;draft=f.content=latest.content||'';version=latest.version;localStorage.removeItem(key);paint();};}catch(e){toast(e.message);}};
    d.querySelector('#delete-doc').onclick=async()=>{if(!confirm('删除 '+name+'？可从修改记录恢复。'))return;try{await api('/api/workspace/commit',{changes:[{path:name,version,content:null}]});localStorage.removeItem(key);d.close();await refresh(true);}catch(e){toast(e.message);}};
    d.querySelectorAll('.markdown a').forEach(a=>{const href=a.getAttribute('href');if(!href||href.startsWith('#'))return;if(/^https?:/.test(href)){a.target='_blank';a.rel='noopener';return;}a.onclick=e=>{e.preventDefault();const base=new URL(name,'https://workspace.invalid/');const target=new URL(href,base);if(target.origin!==base.origin)return toast('不支持此链接');openFile(decodeURIComponent(target.pathname.slice(1))+target.hash);};});
    if(anchor)for(const heading of d.querySelectorAll('h1,h2,h3'))if(heading.textContent.trim()===decodeURIComponent(anchor))heading.scrollIntoView();
   };
   d.addEventListener('cancel',e=>{if(draft!==f.content&&!confirm('关闭编辑器？未保存草稿会保留在本机。'))e.preventDefault();});
   d.addEventListener('close',()=>{if(active?.dialog===d)active=null;});paint();
  }catch(e){toast(e.message);}
 }
 async function browse(){try{const {files}=await api('/api/workspace/files');const d=modal(`<h2>空间文件</h2><input id="file-filter" placeholder="搜索路径或内容" aria-label="搜索文件"><button id="new-file" class="primary">新建 Markdown</button><label>导入或替换 HTML 课表<input id="course-upload" type="file" accept=".html,.htm"></label><div id="file-results"></div>`);const paint=q=>{d.querySelector('#file-results').innerHTML=files.filter(f=>(f.path+' '+f.content).toLowerCase().includes(q.toLowerCase())).map(f=>`<button class="file-row" data-file="${esc(f.path)}">${esc(f.path)}</button>`).join('');d.querySelectorAll('[data-file]').forEach(b=>b.onclick=()=>openFile(b.dataset.file));};paint('');d.querySelector('#file-filter').oninput=e=>paint(e.target.value);d.querySelector('#new-file').onclick=async()=>{const name=prompt('文档路径，例如 matters/新事项.md 或 journal/dairy/2026-11-07.md');if(!name)return;try{const prior=await api('/api/workspace/document?path='+encodeURIComponent(name));if(prior.content!==null)return openFile(name);await api('/api/workspace/commit',{changes:[{path:name,version:null,content:'# '+name.split('/').pop().replace(/\.md$/,'')+'\n'}]});await refresh();openFile(name);}catch(e){toast(e.message);}};d.querySelector('#course-upload').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const previous=await api('/api/workspace/document?path=sources/courses.html');await api('/api/workspace/courses',{content:await file.text(),version:previous.version});await refresh(true);toast('课表已导入，原始 HTML 已保留');}catch(e){toast(e.message);}};}catch(e){toast(e.message);}}
 setInterval(async()=>{if(!active||active.dialog.querySelector('#doc-source'))return;try{const latest=await api('/api/workspace/document?path='+encodeURIComponent(active.path));if(latest.version!==active.version){if(active.dirty())active.dialog.querySelector('#save-state').textContent='文件已有外部修改；请比较后保存。';else await openFile(active.path);}}catch{}},3500);
 return {openFile,browse};
}

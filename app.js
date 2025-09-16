// Hardened app bootstrap with CDN fallback hooks

let pyodide = null, monacoInstance = null, editor = null;

const state = { files:new Map(), open:[], active:null, timeline:[], theme:'dark' };
const $ = q=>document.querySelector(q), $$ = q=>Array.from(document.querySelectorAll(q));
function statusSplash(msg){ const n=$('#splash-msg'); if(n) n.textContent=msg; }
function nowISO(){ return new Date().toISOString(); }
function saveLocal(){ localStorage.setItem('pyrival_project', JSON.stringify({ files:[...state.files], open:state.open, active:state.active, timeline:state.timeline, theme:state.theme })); }
function loadLocal(){ const r=localStorage.getItem('pyrival_project'); if(!r) return false; const o=JSON.parse(r); state.files=new Map(o.files||[]); state.open=o.open||[]; state.active=o.active||null; state.timeline=o.timeline||[]; state.theme=o.theme||'dark'; return true; }

// Boot once Pyodide is in
window.bootstrap = async function(){
  try {
    statusSplash('Loading editor…');
    await initMonaco();
    statusSplash('Loading Python…');
    await initPyodide();
    statusSplash('Preparing workspace…');
    initUI();
    document.getElementById('splash').style.display='none';
    log('Ready.');
  } catch (e) {
    console.error(e); statusSplash('Failed to load. See console.');
  }
};

function initMonaco(){
  return new Promise((resolve)=>{
    if(window.__MONACO_READY__) return resolve();
    require.config({ paths: { 'vs':'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs' } });
    require(['vs/editor/editor.main'], ()=>{
      window.__MONACO_READY__ = true;
      monacoInstance = monaco;
      editor = monacoInstance.editor.create(document.getElementById('editor'), { value:'', language:'python', theme:'vs-dark', minimap:{enabled:false}, automaticLayout:true });
      resolve();
    });
  });
}

async function initPyodide(){
  if(!window.loadPyodide) throw new Error('Pyodide loader missing.');
  pyodide = await loadPyodide({ indexURL: (window.pyodide && window.pyodide._module && window.pyodide._module.locateFile) ? undefined : 'https://cdn.jsdelivr.net/pyodide/v0.24.1/' });
  pyodide.FS.mkdir('/project'); pyodide.FS.chdir('/project');
  await pyodide.runPythonAsync(`
import sys, io, json, builtins, types, __main__
def _pyrival_vars():
  out = {}
  g = dict(__main__.__dict__)
  for k,v in g.items():
    if k.startswith('_'): continue
    if isinstance(v,(int,float,str,bool,list,tuple,dict,set,type(None))):
      out[k]=repr(v)
  return json.dumps(out)
`);
}

function initUI(){
  loadLocal() || seedProject();
  buildFileTree(); openAllTabs(); bindUI(); applyTheme();
}

function seedProject(){
  const demo=`print("Hello from PYRIVAL")\n`;
  state.files.set('main.py', {content:demo, lang:'python'});
  state.open=['main.py']; state.active='main.py';
}

function bindUI(){
  $('#runBtn').onclick=runCode; $('#stopBtn').onclick=()=>toast('Stop not supported'); $('#newFileBtn').onclick=newFile;
  $('#saveBtn').onclick=()=>{ snapshot(); saveLocal(); toast('Saved'); };
  $('#exportBtn').onclick=exportProject; $('#importBtn').onclick=()=>$('#fileInput').click();
  $('#commandBtn').onclick=commandPalette; $('#themeBtn').onclick=toggleTheme;
  $('#fileInput').addEventListener('change', importFiles);
  editor.onDidChangeModelContent(()=>{ if(!state.active) return; state.files.get(state.active).content = editor.getValue(); saveLocalDebounced(); });
  $('#repl-input').addEventListener('keydown', async e=>{ if(e.key==='Enter'){ const cmd=e.target.value; e.target.value=''; appendRepl('>>> '+cmd); try{ const res=await pyodide.runPythonAsync(cmd); if(res!==undefined) appendRepl(String(res)); }catch(err){ appendRepl(String(err)); } } });
  window.addEventListener('keydown', e=>{ const m = navigator.platform.toUpperCase().includes('MAC') ? e.metaKey : e.ctrlKey; if(m&&e.key.toLowerCase()==='s'){ e.preventDefault(); snapshot(); saveLocal(); toast('Saved'); } if(m&&e.key.toLowerCase()==='k'){ e.preventDefault(); commandPalette(); } if(m&&e.key==='Enter'){ e.preventDefault(); runCode(); } });
}
let saveTimer=null; function saveLocalDebounced(){ clearTimeout(saveTimer); saveTimer=setTimeout(saveLocal,300); }

function buildFileTree(){ const tree=$('#fileTree'); tree.innerHTML=''; [...state.files.keys()].sort().forEach(name=>{ const d=document.createElement('div'); d.className='file'+(name===state.active?' active':''); d.dataset.name=name; d.innerHTML=`<i class="fa-regular fa-file-code"></i><div class="name">${name}</div><div class="meta">${state.files.get(name).content.length}b</div>`; d.onclick=()=>activate(name); tree.appendChild(d); }); }
function openAllTabs(){ const tabs=$('#tabs'); tabs.innerHTML=''; state.open.forEach(name=>{ const t=document.createElement('div'); t.className='tab'+(name===state.active?' active':''); t.dataset.name=name; t.textContent=name; tabs.appendChild(t); }); if(state.active){ const m=monacoInstance.editor.createModel(state.files.get(state.active).content,'python'); editor.setModel(m); } }
function activate(name){ if(!state.open.includes(name)) state.open.push(name); state.active=name; openAllTabs(); buildFileTree(); if(editor.getModel()) editor.getModel().dispose(); const m=monacoInstance.editor.createModel(state.files.get(name).content,'python'); editor.setModel(m); }
function newFile(){ let i=1,n=`file${i}.py`; while(state.files.has(n)){ i++; n=`file${i}.py`; } state.files.set(n,{content:'# new file\\n',lang:'python'}); activate(n); buildFileTree(); openAllTabs(); snapshot(); saveLocal(); }

async function importFiles(e){ const files=[...(e.target.files||[])]; for(const f of files){ const text=await f.text(); state.files.set(f.name,{content:text,lang:guessLang(f.name)}); if(!state.open.includes(f.name)) state.open.push(f.name); state.active=f.name; } openAllTabs(); buildFileTree(); snapshot(); saveLocal(); }
function guessLang(n){ if(n.endsWith('.py')) return 'python'; if(n.endsWith('.md')) return 'markdown'; return 'text'; }

async function exportProject(){ await ensureJSZip(); const zip=new JSZip(); for(const [n,i] of state.files.entries()) zip.file(n,i.content); const blob=await zip.generateAsync({type:'blob'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='pyrival_project.zip'; a.click(); }
function ensureJSZip(){ return new Promise(res=>{ if(window.JSZip) return res(true); const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'; s.onload=()=>res(true); document.body.appendChild(s); }); }

function snapshot(){ if(!state.active) return; state.timeline.unshift({ts:nowISO(),name:state.active,content:state.files.get(state.active).content}); state.timeline=state.timeline.slice(0,100); renderTimeline(); }
function renderTimeline(){ const host=$('#timeline'); host.innerHTML=''; state.timeline.forEach(v=>{ const d=document.createElement('div'); d.className='file'; d.innerHTML=`<i class="fa-regular fa-clock"></i><div class="name">${v.name}</div><div class="meta">${new Date(v.ts).toLocaleTimeString()}</div>`; d.onclick=()=>{ state.files.set(v.name,{content:v.content,lang:'python'}); activate(v.name); buildFileTree(); openAllTabs(); saveLocal(); toast('Restored version'); }; host.appendChild(d); }); }

async function runCode(){ if(!state.active) return; clearOutput(); log('▶ Running…'); for(const [n,i] of state.files.entries()) pyodide.FS.writeFile('/project/'+n,i.content); const entry=state.active; try{ await pyodide.runPythonAsync(`import sys,runpy,os; sys.path.insert(0,'/project'); os.chdir('/project'); runpy.run_path('${entry}', run_name='__main__')`); const vjson=await pyodide.runPythonAsync('_pyrival_vars()'); renderVars(JSON.parse(vjson)); log('✓ Done.'); }catch(err){ log(String(err)); } }
function log(m){ const el=$('#output'); el.textContent+=m+"\\n"; el.scrollTop=el.scrollHeight; }
function clearOutput(){ $('#output').textContent=''; }
function appendRepl(line){ const h=$('#repl-history'); const d=document.createElement('div'); d.textContent=line; h.appendChild(d); h.scrollTop=h.scrollHeight; }
function renderVars(o){ const t=$('#vars-table'); t.innerHTML=''; const rows=Object.entries(o); if(!rows.length){ t.innerHTML='<tr><td style="opacity:.7">No simple variables</td></tr>'; return; } rows.forEach(([k,v])=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${k}</td><td>${v}</td>`; t.appendChild(tr); }); }
function commandPalette(){ const c=prompt('Command (new, run, export, theme, clear):'); if(!c) return; if(c==='new') newFile(); if(c==='run') runCode(); if(c==='export') exportProject(); if(c==='theme') toggleTheme(); if(c==='clear') clearOutput(); }
function toggleTheme(){ state.theme=state.theme==='dark'?'light':'dark'; applyTheme(); saveLocal(); }
function applyTheme(){ document.body.dataset.theme=state.theme; monacoInstance.editor.setTheme(state.theme==='dark'?'vs-dark':'vs'); }
function toast(msg){ const d=document.createElement('div'); d.textContent=msg; d.style.cssText='position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#111827;color:#e8ecf5;padding:8px 12px;border-radius:10px;border:1px solid #1f2937;z-index:99'; document.body.appendChild(d); setTimeout(()=>d.remove(),1200); }

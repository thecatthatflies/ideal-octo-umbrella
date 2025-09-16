// PYRIVAL — Ultra Static Python IDE

let pyodide = null;
let monacoInstance = null;
let editor = null;

const state = {
  files: new Map(),
  open: [],
  active: null,
  timeline: [],
  theme: 'dark',
};

const $ = (q)=>document.querySelector(q);
const $$ = (q)=>Array.from(document.querySelectorAll(q));
function nowISO(){ return new Date().toISOString(); }
function saveLocal(){
  const data = {
    files: Array.from(state.files.entries()),
    open: state.open,
    active: state.active,
    timeline: state.timeline,
    theme: state.theme
  };
  localStorage.setItem('pyrival_project', JSON.stringify(data));
}
function loadLocal(){
  const raw = localStorage.getItem('pyrival_project');
  if(!raw) return false;
  const obj = JSON.parse(raw);
  state.files = new Map(obj.files || []);
  state.open = obj.open || [];
  state.active = obj.active || null;
  state.timeline = obj.timeline || [];
  state.theme = obj.theme || 'dark';
  return true;
}
function statusSplash(msg){ $('#splash-msg').textContent = msg; }

(async function boot(){
  statusSplash('Loading editor…');
  await initMonaco();
  statusSplash('Loading Python…');
  await initPyodide();
  statusSplash('Preparing workspace…');
  initUI();
  $('#splash').style.display = 'none';
  log('Ready.');
})().catch(err=>{
  console.error(err);
  statusSplash('Failed to load. See console.');
});

async function initMonaco(){
  return new Promise((resolve)=>{
    require.config({ paths: { 'vs':'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs' } });
    require(['vs/editor/editor.main'], ()=>{
      monacoInstance = monaco;
      editor = monacoInstance.editor.create(document.getElementById('editor'), {
        value: '',
        language: 'python',
        theme: 'vs-dark',
        fontSize: 14,
        minimap: {enabled:false},
        automaticLayout: true
      });
      resolve();
    });
  });
}

async function initPyodide(){
  pyodide = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.24.1/' });
  pyodide.FS.mkdir('/project'); pyodide.FS.chdir('/project');
  await pyodide.runPythonAsync(`
import sys, io, json, builtins, types, __main__
def _pyrival_vars():
    out = {}
    g = dict(__main__.__dict__)
    for k,v in g.items():
        if k.startswith('_'): continue
        if isinstance(v, (int,float,str,bool,list,tuple,dict,set,type(None))):
            out[k]=repr(v)
    return json.dumps(out)
`);
}

function initUI(){
  loadLocal() || seedProject();
  buildFileTree();
  openAllTabs();
  bindUI();
  applyTheme();
}

function seedProject(){
  const demo = `# PYRIVAL demo
import math

def greet(name: str) -> str:
    return f"Hello, {name}!"

x = 10
y = 32

print(greet("World"))
print("x+y=", x+y)
`;
  state.files.set('main.py', {content: demo, lang:'python'});
  state.open = ['main.py']; state.active = 'main.py';
}

function bindUI(){
  $('#tabs').addEventListener('click', (e)=>{
    const tab = e.target.closest('.tab');
    if(!tab) return;
    activate(tab.dataset.name);
  });

  $('.panel-tabs').addEventListener('click', (e)=>{
    const b = e.target.closest('button'); if(!b) return;
    $$('.panel-tabs button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    $$('.panel-pane').forEach(x=>x.classList.remove('active'));
    $('#'+b.dataset.tab).classList.add('active');
  });

  $('#runBtn').onclick = runCode;
  $('#stopBtn').onclick = stopRun;
  $('#newFileBtn').onclick = newFile;
  $('#saveBtn').onclick = ()=>{ snapshot(); saveLocal(); toast('Saved'); };
  $('#exportBtn').onclick = exportProject;
  $('#importBtn').onclick = ()=>$('#fileInput').click();
  $('#commandBtn').onclick = commandPalette;
  $('#themeBtn').onclick = toggleTheme;
  $('#fileInput').addEventListener('change', importFiles);

  editor.onDidChangeModelContent(()=>{
    if(!state.active) return;
    const f = state.files.get(state.active);
    f.content = editor.getValue();
    saveLocalDebounced();
  });

  $('#repl-input').addEventListener('keydown', async (e)=>{
    if(e.key === 'Enter'){
      const cmd = e.target.value; e.target.value='';
      appendRepl('>>> '+cmd);
      try{
        const res = await pyodide.runPythonAsync(cmd);
        if(res !== undefined) appendRepl(String(res));
      }catch(err){ appendRepl(String(err)); }
    }
  });

  window.addEventListener('keydown', (e)=>{
    const mac = navigator.platform.toUpperCase().includes('MAC');
    const mod = mac ? e.metaKey : e.ctrlKey;
    if(mod && e.key.toLowerCase()==='s'){ e.preventDefault(); snapshot(); saveLocal(); toast('Saved'); }
    if(mod && e.key.toLowerCase()==='k'){ e.preventDefault(); commandPalette(); }
    if(mod && e.key==='Enter'){ e.preventDefault(); runCode(); }
  });
}
let saveTimer=null; function saveLocalDebounced(){ clearTimeout(saveTimer); saveTimer=setTimeout(saveLocal,400); }

function buildFileTree(){
  const tree = $('#fileTree'); tree.innerHTML='';
  [...state.files.keys()].sort().forEach(name=>{
    const div = document.createElement('div');
    div.className = 'file'+(name===state.active?' active':'');
    div.dataset.name = name;
    div.innerHTML = `<i class="fa-regular fa-file-code"></i><div class="name">${name}</div>
      <div class="meta">${(state.files.get(name).content.length)}b</div>`;
    div.onclick = ()=>activate(name);
    tree.appendChild(div);
  });
}
function openAllTabs(){
  const tabs = $('#tabs'); tabs.innerHTML='';
  state.open.forEach(name=>{
    const t = document.createElement('div');
    t.className = 'tab'+(name===state.active?' active':'');
    t.dataset.name = name;
    t.textContent = name;
    tabs.appendChild(t);
  });
  if(state.active) {
    const m = monacoInstance.editor.createModel(state.files.get(state.active).content, 'python');
    editor.setModel(m);
  }
}
function activate(name){
  if(!state.open.includes(name)) state.open.push(name);
  state.active = name;
  openAllTabs(); buildFileTree();
  const f = state.files.get(name);
  if(editor.getModel()) editor.getModel().dispose();
  const m = monacoInstance.editor.createModel(f.content, 'python');
  editor.setModel(m);
}
function newFile(){
  let base='file'; let i=1; let name=`${base}${i}.py`;
  while(state.files.has(name)){ i++; name=`${base}${i}.py`; }
  state.files.set(name,{content:'# new file\\n',lang:'python'});
  activate(name); buildFileTree(); openAllTabs(); snapshot(); saveLocal();
}
async function importFiles(e){
  const files = Array.from(e.target.files||[]);
  for(const f of files){
    const text = await f.text();
    state.files.set(f.name,{content:text,lang: guessLang(f.name)});
    if(!state.open.includes(f.name)) state.open.push(f.name);
    state.active = f.name;
  }
  openAllTabs(); buildFileTree(); snapshot(); saveLocal();
}
function guessLang(name){
  if(name.endsWith('.py')) return 'python';
  if(name.endsWith('.md')) return 'markdown';
  return 'text';
}

async function exportProject(){
  const ready = await ensureJSZip();
  const zip = new JSZip();
  for(const [name,info] of state.files.entries()){
    zip.file(name, info.content);
  }
  const blob = await zip.generateAsync({type:'blob'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pyrival_project.zip';
  a.click();
}
function ensureJSZip(){
  return new Promise((resolve)=>{
    if(window.JSZip) return resolve(true);
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    s.onload=()=>resolve(true);
    document.body.appendChild(s);
  });
}

// Timeline versioning
function snapshot(){
  if(!state.active) return;
  state.timeline.unshift({ ts: nowISO(), name: state.active, content: state.files.get(state.active).content });
  state.timeline = state.timeline.slice(0,100);
  renderTimeline();
}
function renderTimeline(){
  const host = $('#timeline'); host.innerHTML='';
  state.timeline.forEach((v,idx)=>{
    const d = document.createElement('div'); d.className='file';
    d.innerHTML = `<i class="fa-regular fa-clock"></i><div class="name">${v.name}</div><div class="meta">${new Date(v.ts).toLocaleTimeString()}</div>`;
    d.onclick = ()=>{ state.files.set(v.name,{content:v.content, lang:'python'}); activate(v.name); buildFileTree(); openAllTabs(); saveLocal(); toast('Restored version'); };
    host.appendChild(d);
  });
}

// Run
let running = false;
async function runCode(){
  if(!state.active) return;
  running = true;
  clearOutput();
  log('▶ Running…');
  for(const [name,info] of state.files.entries()){
    pyodide.FS.writeFile('/project/'+name, info.content);
  }
  const entry = state.active;
  try{
    await pyodide.runPythonAsync(`
import sys, runpy, os
sys.path.insert(0, '/project')
os.chdir('/project')
try:
  runpy.run_path('${entry}', run_name='__main__')
finally:
  pass
    `);
    const vjson = await pyodide.runPythonAsync('_pyrival_vars()');
    renderVars(JSON.parse(vjson));
    log('✓ Done.');
  }catch(err){
    log(String(err));
  }
}
function stopRun(){ toast('Stop not supported (Pyodide sandbox)'); }

function log(msg){ const el=$('#output'); el.textContent += msg + "\\n"; el.scrollTop = el.scrollHeight; }
function clearOutput(){ $('#output').textContent=''; }
function appendRepl(line){ const h=$('#repl-history'); const div=document.createElement('div'); div.textContent=line; h.appendChild(div); h.scrollTop=h.scrollHeight; }

function renderVars(obj){
  const t = $('#vars-table'); t.innerHTML='';
  const rows = Object.entries(obj);
  if(!rows.length){ t.innerHTML='<tr><td style="opacity:.7">No simple variables</td></tr>'; return; }
  rows.forEach(([k,v])=>{
    const tr=document.createElement('tr'); tr.innerHTML=`<td>${k}</td><td>${v}</td>`; t.appendChild(tr);
  });
}

function commandPalette(){
  const cmd = prompt('Command (new, run, export, theme, clear):');
  if(!cmd) return;
  if(cmd==='new') newFile();
  if(cmd==='run') runCode();
  if(cmd==='export') exportProject();
  if(cmd==='theme') toggleTheme();
  if(cmd==='clear') clearOutput();
}

function toggleTheme(){
  state.theme = state.theme==='dark' ? 'light' : 'dark';
  applyTheme(); saveLocal();
}
function applyTheme(){
  document.body.dataset.theme = state.theme;
  monacoInstance.editor.setTheme(state.theme==='dark' ? 'vs-dark' : 'vs');
}

function toast(msg){
  const d=document.createElement('div');
  d.textContent=msg; d.style.cssText='position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#111827;color:#e8ecf5;padding:8px 12px;border-radius:10px;border:1px solid #1f2937;z-index:99';
  document.body.appendChild(d); setTimeout(()=>d.remove(),1200);
}

// ═══ EXPORT ═══
// The .html and .js exports run the program on the SAME runtime as the IDE. Nothing is re-implemented:
// the runtime source is copied out of this page's own script at export time — every block between a
// "//#emit-runtime-begin" line and the next "//#emit-runtime-end" line (std builtins, JS interop,
// callbacks, string allocation, the `use` library loader). A fix made to the runtime is therefore in
// the next export automatically. Code inside those blocks must not rely on IDE-only code (editor,
// compiler, status bar); the few IDE names it may touch are stubbed by _exportRuntime() below.
// An exported file contains: the WASM bytes (base64), the import list the runtime needs
// (module, name, declaration node, callback count), the libraries resolved from the `use` lines,
// the runtime source and _emitExportBoot() — not the editor, compiler, examples or library catalogue.
// P (optional): the program's _exportProgram data. The parts between "//#emit-mote-begin" and "//#emit-mote-end" lines
// (the Mote helpers and the built-in library loader) are copied only for a program that loads Mote (P.libs has
// emit:mote), so the export of any other program is what it was before Mote existed in Emit. Likewise the parts
// between "//#emit-hud-begin" / "-end" and "//#emit-fx-begin" / "-end" are copied only for a program whose
// importProps has hudMeta / fxMeta (it uses a HUD / particles).
function _exportRuntime(P){
  var B='//#emit-'+'runtime-begin',E='//#emit-'+'runtime-end',parts=[];
  Array.prototype.slice.call(document.scripts).forEach(function(sc){
    var t=sc.textContent||'',p=0;
    for(;;){
      var b=t.indexOf('\n'+B,p);if(b<0)break;
      var e=t.indexOf('\n'+E,b+1);if(e<0)throw new Error('runtime section is not closed in the IDE source');
      parts.push(t.substring(t.indexOf('\n',b+1)+1,e));
      p=e+1;
    }
  });
  if(!parts.length)throw new Error('runtime section not found in the IDE source');
  var mote=!!(P&&P.libs&&P.libs.some(function(l){return l&&l.url===_MOTE_URL}));
  if(!mote)parts=parts.map(function(t){return t.replace(/\n\/\/#emit-mote-begin[^\n]*\n[\s\S]*?\n\/\/#emit-mote-end[^\n]*/g,'')});
  /* the case-insensitive JS lookup (CASE-INSENSITIVE NAMES): only for a program that uses JS interop (or Mote) */
  var jsi=!P||!P.imports||mote||P.imports.some(function(i){return i&&(i.module==='__js__'||i.module==='js')});
  if(!jsi)parts=parts.map(function(t){return t.replace(/\n\/\/#emit-nocase-begin[^\n]*\n[\s\S]*?\n\/\/#emit-nocase-end[^\n]*/g,'')});
  /* HUD and particles (HUD & PARTICLES): only for a program that uses them */
  var ip=P&&P.importProps;
  if(P&&!(ip&&typeof ip.hudMeta==='string'))parts=parts.map(function(t){return t.replace(/\n\/\/#emit-hud-begin[^\n]*\n[\s\S]*?\n\/\/#emit-hud-end[^\n]*/g,'')});
  if(P&&!(ip&&typeof ip.fxMeta==='string'))parts=parts.map(function(t){return t.replace(/\n\/\/#emit-fx-begin[^\n]*\n[\s\S]*?\n\/\/#emit-fx-end[^\n]*/g,'')});
  // The names _emitExportBoot reaches the runtime through. If one is renamed, fail here, not in the exported page.
  ['buildImportObject','_resetJsInterop','_loadUse','_loadLib'].forEach(function(n){if(typeof window[n]!=='function'||parts.join('\n').indexOf('function '+n+'(')<0)throw new Error('runtime function '+n+' is missing from the runtime section')});
  // IDE names the runtime may mention: the library catalogue is not exported, status/navigation calls do nothing.
  var pre='var LIBS=[];function setStatus(){}function showView(){}function jumpToLine(){}\n';
  ['h','sp'].forEach(function(n){if(typeof window[n]==='function')pre+=Function.prototype.toString.call(window[n])+'\n'});
  var post='\nvar __emitRT={build:function(i,l){return buildImportObject(i,l)},setMemory:function(m){_wasmMem=m},reset:function(){_resetJsInterop()},loadUse:function(u){return _loadUse(u)},loadLib:function(u,l){return _loadLib(u,l)},stop:function(){_animRunning=false}};\n';
  var src=pre+parts.join('\n')+post;
  try{new Function(src)}catch(e){throw new Error('runtime section does not parse on its own: '+e.message)}
  return src;
}
// Libraries the exported program must load before it starts, in order — the same ones Run loads:
// every `use` line as _parseUses resolved it, then registry libraries implied by the builtins used.
function _exportLibs(source,imports){
  var libs=[],explicit=new Set();
  _parseUses(source).forEach(function(u){
    if(u.lib)explicit.add(u.lib.cdn);
    var e={label:u.label,alias:u.alias||null,url:u.url,classicUrl:u.classicUrl,module:!!u.module,css:!!u.css,lib:u.lib?{name:u.lib.name,global:u.lib.global||null,needs:u.lib.needs||null,css:u.lib.css||null}:null};
    if(u.altUrl)e.altUrl=u.altUrl;
    if(u.esmOnly)e.esmOnly=true;
    // `use … as Name`: when the program has been run, record the URL that actually worked (jsDelivr or esm.sh
    // module, or the classic script) as the one the export loads; the other module source stays as the retry.
    var res=u.alias&&u.module?_libResolved[_libKey(u)]:null;
    if(res&&res.as==='classic'){e.module=false;e.url=e.classicUrl=res.url;delete e.altUrl}
    else if(res&&res.url!==u.url){e.url=res.url;e.altUrl=u.url}
    libs.push(e);
  });
  var needed=new Set();
  imports.forEach(function(imp){
    var fnCdn=_fnToCdn[imp.name];if(!fnCdn)return;
    var provided=Array.from(explicit).some(function(cdn){var lib=LIBS.find(function(l){return l.cdn===cdn});if(!lib)return false;if(lib.fns.split(' ').indexOf(imp.name)!==-1)return true;var bare=lib.name.replace('.js','').replace('-','');return bare===imp.name||lib.name===imp.name});
    if(!provided&&!(_libIsBuiltin(fnCdn)&&explicit.has(fnCdn)))needed.add(fnCdn);   /* use mote + moteRun(…): Mote once */
  });
  needed.forEach(function(cdn){var reg=LIBS.find(function(l){return l.cdn===cdn});libs.push({label:_libLabel(cdn),alias:null,url:cdn,classicUrl:cdn,module:false,css:false,lib:reg?{name:reg.name,global:reg.global||null,needs:reg.needs||null,css:reg.css||null}:null})});
  // A library built into the IDE page (use mote) has no URL to fetch from: the exported file carries its text.
  libs.forEach(function(l){if(_libIsBuiltin(l.url)){var t=_libBuiltinText(l.url);if(typeof t!=='string')throw new Error('the built-in library "'+l.label+'" is missing from this page');l.text=t}});
  return libs;
}
// Everything an exported file needs to know about the compiled program (plain JSON).
function _exportProgram(source,r){
  var bin='';for(var i=0;i<r.wasm.length;i+=8192)bin+=String.fromCharCode.apply(null,r.wasm.subarray(i,i+8192));
  var imports=(r.imports||[]).map(function(imp){return{module:imp.module,name:imp.name,node:imp.node===undefined?null:JSON.parse(JSON.stringify(imp.node))}});
  // Extra properties the compiler hangs on the imports array (cbCount: size of the callback table)
  var props={};Object.keys(r.imports||[]).forEach(function(k){if(!/^\d+$/.test(k)){var v=r.imports[k];if(v===null||typeof v!=='object')props[k]=v}});
  return{wasm:btoa(bin),imports:imports,importProps:props,libs:_exportLibs(source,r.imports||[])};
}
// Starts an exported program. Copied into exported files with toString(), so it must use nothing from
// the IDE. P: _exportProgram() data; RT: the __emitRT object of the runtime; opts: {output, run, trace}.
// Mirrors what Run does: load libraries, build imports, instantiate, then call every exported function
// that takes no parameters (except frame and the onclick_/ontimer_/onhttp_ handlers).
async function _emitExportBoot(P,RT,opts){
  opts=opts||{};
  var out=opts.output;
  function show(msg){var d=document.createElement('div');d.className='emit-error';d.style.cssText='color:#ef4444;padding:6px 12px;font-family:var(--mono);font-size:13px;white-space:pre-wrap;word-break:break-word;';d.textContent='✗ '+msg;out.appendChild(d)}
  if(!opts.trace&&!out._emitQuiet){
    // The runtime also writes the IDE's small diagnostic lines ("→ call(args)", "[click 1] start");
    // an exported page keeps them in the DOM but hidden. {trace:true} (or ?trace in the .html) shows them
    // (and leaves the output exactly as the IDE writes it, "> " prefix included).
    var add=out.appendChild;out._emitQuiet=true;
    out.appendChild=function(n){try{if(n&&n.nodeType===1&&n.tagName==='DIV'&&!n.firstElementChild&&parseFloat(n.style.fontSize)<12&&/^(→ |\[click \d+\])/.test(n.textContent)){n.style.display='none';n.setAttribute('data-emit-trace','')}
      // print/printNum/printStr lines: the IDE's "> " prefix is IDE styling, an exported page shows the text only
      else if(n&&n.nodeType===1&&n.tagName==='DIV'&&!n.firstElementChild&&n.style.fontSize==='13px'&&n.style.padding==='2px 12px'&&n.textContent.indexOf('> ')===0){n.textContent=n.textContent.slice(2);n.setAttribute('data-emit-print','')}}catch(e){}return add.call(this,n)};
  }
  try{
    RT.stop();
    for(var i=0;i<P.libs.length;i++)await RT.loadUse(P.libs[i]);
    var bin=atob(P.wasm),bytes=new Uint8Array(bin.length);for(var j=0;j<bin.length;j++)bytes[j]=bin.charCodeAt(j);
    var imports=P.imports.slice();for(var k in P.importProps)imports[k]=P.importProps[k];
    var log=[];log.push=function(){return 0}; // the IDE lists these calls under "Results"; here they are dropped
    RT.reset();
    var importObj=RT.build(imports,log);
    var inst=(await WebAssembly.instantiate(bytes,importObj)).instance;
  }catch(e){show((e&&e.message)||String(e));throw e}
  RT.setMemory(inst.exports.memory);
  window._wi=inst; // the runtime finds frame(), onclick_N() … here
  // top-level values that are not literals are set now, once, before anything else runs (see TOP-LEVEL VALUES)
  var initErr=window._emitInitRun?window._emitInitRun(inst):null;
  if(initErr){show(initErr);RT.stop();window._wi=null;throw new Error(initErr)}
  var entries=Object.keys(inst.exports).filter(function(n){var f=inst.exports[n];return typeof f==='function'&&f.length===0&&n!=='frame'&&n.indexOf('onclick_')!==0&&n.indexOf('ontimer_')!==0&&n.indexOf('onhttp_')!==0&&n.indexOf('.')<0});
  function run(){entries.forEach(function(n){try{window._emitCallExport?window._emitCallExport(inst,n,[]):inst.exports[n]()}catch(e){show(n+' → '+((e&&e.message)||e))}})}
  if(opts.run!==false)run();
  return{instance:inst,exports:inst.exports,memory:inst.exports.memory,output:out,entries:entries,run:run,stop:function(){RT.stop()}};
}
// JSON that is safe inside an inline <script> and readable as a JS expression
function _exportJson(v){return JSON.stringify(v).replace(/[<\u2028\u2029]/g,function(c){return'\\u'+('000'+c.charCodeAt(0).toString(16)).slice(-4)})}
// The IDE's :root custom properties (fonts, colours) — runtime elements are styled with var(--mono) etc.
function _exportRootCss(){
  var css='';
  Array.prototype.slice.call(document.styleSheets).forEach(function(sh){try{Array.prototype.slice.call(sh.cssRules).forEach(function(rule){if(rule.selectorText===':root')css+=rule.cssText})}catch(e){}});
  return css||":root{--mono:'JetBrains Mono',monospace}";
}
function _exportHtml(P,E){   // E: embedded libraries (offline export) or undefined
  var rt=_exportRuntime(P).replace(/<\/(script)/gi,'<\\/$1').replace(/<!--/g,'<\\!--');
  return '<!DOCTYPE html>\n<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Emit Program</title>\n'
    +'<!-- Exported from the Emit IDE. One self-contained page: the compiled WebAssembly (base64), the list of\n     imports it needs, the Emit runtime (the same code the IDE runs programs on) and a few lines that start it.\n     '+(E?'Offline export: the libraries named by `use` lines are embedded in this file; it needs no network.':'Libraries named by `use` lines are fetched from their URLs when the page opens.')+'\n     Add ?trace to the address to see the runtime\'s call-trace lines. -->\n'
    +'<style>'+_exportRootCss()+'\nhtml,body{margin:0;min-height:100%;background:var(--bg,#08090d);color:var(--fg,#d4d8e3)}\n#tab-output{font-family:var(--mono);font-size:12px;line-height:1.8;padding:12px;white-space:pre-wrap;word-break:break-word}\n</style></head><body>\n'
    +'<div id="tab-output"></div>\n'
    +'<script>\n// The compiled program\nvar __emitProgram='+_exportJson(P)+';\n<\/script>\n'
    +(E?_offlineEmbedHtml(E):'')
    +'<script>\n// Emit runtime — copied from the IDE\n'+rt+'<\/script>\n'
    +'<script>\n'+_emitExportBoot.toString().replace(/<\/(script)/gi,'<\\/$1')+'\n'
    +'var __emitApp=_emitExportBoot(__emitProgram,__emitRT,{output:document.getElementById("tab-output"),trace:/[?&]trace\\b/.test(location.search)});\n__emitApp.catch(function(e){console.error(e)});\n<\/script>\n</body></html>\n';
}
function _exportJs(P,E){   // E: embedded libraries (offline export) or undefined
  var libLines=P.libs.map(function(l){return' *     '+(_libIsBuiltin(l.url)?l.label+' \u2014 built into Emit; its source is in `program` below, no download':l.alias?(l.module?'import("'+l.url+'") as window.'+l.alias:'<script src="'+l.url+'">, global '+l.alias):'<script src="'+l.url+'">')}).join('\n')||' *     (none)';
  var impLines=P.imports.map(function(i){return i.module+'.'+i.name}).join(', ')||'(none)';
  return '/**\n * Emit program — exported from the Emit IDE as an ES module.\n *\n'
    +' * Contains the compiled WebAssembly (base64), its import list and the Emit runtime (the same code the\n * IDE runs programs on: print/canvas/DOM/sound builtins, JS interop, callbacks, strings). Browser only —\n * the runtime draws into the DOM.\n *\n'
    +' * Use:\n *     import init from "./program.js";\n *     const app = await init({ target: document.getElementById("app") });\n *     app.exports.someFunction();   // every exported Emit function; int parameters/results are BigInt\n *\n'
    +' * init(options) → Promise of { exports, instance, memory, output, entries, run(), stop() }\n'
    +' *   options.target  element that receives the output. Output (print lines, canvas, buttons, inputs) goes into\n *                   the element with id "tab-output"; if the page has none, one is created inside target\n *                   (default: document.body).\n'
    +' *   options.run     false = do not start the program. By default init() does what Run does in the IDE: it\n *                   calls every exported function without parameters (not frame / onclick_N / ontimer_N /\n *                   onhttp_N — the runtime calls those). app.run() does it later; app.entries lists them.\n'
    +' *   options.trace   true = show the runtime\'s call-trace lines (hidden by default).\n'
    +' *   app.stop()      stops the animate() frame loop.\n *\n'
    +(E?' * Libraries: EMBEDDED in this file (offline export, see `embedded` below) \u2014 init() runs them before\n * instantiating and needs no network. They were fetched from:\n':' * Libraries: init() loads these itself before instantiating, exactly as the IDE resolved the `use` lines:\n')+libLines+'\n'
    +' *   If one cannot be loaded, a readable error is written to the output and init() rejects.\n *\n'
    +' * WebAssembly imports satisfied by the runtime: '+impLines.replace(/\*\//g,'* /')+'\n *\n'
    +' * Limits: one Emit program per document (the runtime uses window._wi and the id "tab-output"; use an\n * iframe for a second one). Calling init() again restarts the program and clears its output. The runtime is\n * started with new Function(), so a Content-Security-Policy without \'unsafe-eval\' blocks it — use the .html\n * export there.\n */\n'
    +'export const program = '+_exportJson(P)+';\n\n'
    +(E?'// Libraries embedded by the offline export: source text by URL (scripts, stylesheets, ES modules with the\n// positions of their import specifiers). The runtime runs them from Blob URLs.\nexport const embedded = '+_offlineEmbedJs(E)+';\n\n':'')
    +'// Emit runtime — copied from the IDE. Kept as text so it runs as an ordinary (non-strict) script, as in the IDE.\n'
    +'const runtimeSource = '+_exportJson(_exportRuntime(P))+';\n\n'
    +'const boot = '+_emitExportBoot.toString()+';\n\n'
    +'let runtime = null, started = false;\n\n'
    +'export async function init(options = {}) {\n'
    +'  if (typeof document === "undefined") throw new Error("Emit program: init() needs a browser page (document)");\n'
    +'  let out = document.getElementById("tab-output");\n'
    +'  if (!out) {\n    out = document.createElement("div");\n    out.id = "tab-output";\n    (options.target || document.body).appendChild(out);\n  }\n'
    +'  if (!getComputedStyle(out).getPropertyValue("--mono").trim()) out.style.setProperty("--mono", "ui-monospace,Menlo,Consolas,monospace");\n'
    +(E?'  globalThis.__emitEmbedded = embedded;   // the runtime picks the embedded libraries up from here when it starts\n':'')
    +'  if (!runtime) runtime = new Function(runtimeSource + "\\nreturn __emitRT;")();\n'
    +'  if (started) { runtime.stop(); out.innerHTML = ""; }\n'
    +'  started = true;\n'
    +'  return boot(program, runtime, { output: out, run: options.run, trace: options.trace });\n'
    +'}\n\nexport default init;\n';
}

// ── Library loader: use <registry name | npm spec | URL> [as Name] ──
// The lexer must never see the rest of a `use` line: npm specs contain '@' and unquoted URLs contain '//'.
(function(){var _id=Lexer.prototype.id;Lexer.prototype.id=function(){var prev=this.tokens[this.tokens.length-1],sl=this.line;var t=_id.call(this);if(t.type===TT.KEYWORD&&t.value==='use'&&!(prev&&prev.line===sl)){while(this.p<this.s.length&&this.peek()!=='\n')this.adv()}return t}})();
//#emit-runtime-begin — up to the matching end marker this is copied verbatim into exported .html/.js files (see _exportRuntime); keep IDE-only code out of it
var _libsLoaded=new Set();   // classic script URLs that loaded successfully
var _libModules=new Map();   // ES module URL -> module namespace object
var _libFails={};            // URL -> failed attempts (makes a retried import() a fresh module request)
var _LIB_TIMEOUT=20000;
function _libErr(msg){var e=new Error(msg);e.isLibError=true;return e}
function _libLabel(url){var l=LIBS.find(function(x){return x.cdn===url});return l?l.name:url}
// Stylesheets. _loadCss never rejects: it resolves to null, or to a warning text when the sheet could not be loaded
// (a library without its CSS still runs, it only looks wrong — so that is a warning line, not a failed Run).
var _cssLoaded=new Set();    // stylesheet URLs that loaded successfully
var _CSS_TIMEOUT=10000;
function _loadCss(url,label){
  return new Promise(function(ok){
    if(_cssLoaded.has(url)){ok(null);return}
    if(_libEmbedded&&_libEmbedded.css&&typeof _libEmbedded.css[url]==='string'){_cssText(url,_libEmbedded.css[url]);_cssLoaded.add(url);ok(null);return}   // offline export
    Array.prototype.slice.call(document.querySelectorAll('link[rel="stylesheet"]')).forEach(function(t){if(t.getAttribute('href')===url)t.remove()});
    var l=document.createElement('link'),done=false,timer;
    function finish(why){if(done)return;done=true;clearTimeout(timer);if(why){l.remove();var _msg='Could not load the stylesheet '+url+(label&&label!==url?' for "'+label+'"':'')+' \u2014 '+why+'. The program still runs, but the library may look unstyled.';_libCached(url).then(function(hit){if(!hit){ok(_msg);return}_cssText(url,hit.text);_cssLoaded.add(url);ok(_libCacheNote(label||url,url,hit))})}else{_cssLoaded.add(url);if(_libCache)try{_libCache.save(url,'css')}catch(e){}ok(null)}}
    l.rel='stylesheet';l.href=url;l.setAttribute('data-emit-lib-css','');
    l.onload=function(){finish(null)};
    l.onerror=function(){finish('the request failed (wrong URL, not a stylesheet, or no network)')};
    var _ct=_libTimeout(_CSS_TIMEOUT);
    timer=setTimeout(function(){finish('timed out after '+(_ct/1000)+'s')},_ct);
    document.head.appendChild(l);
  });
}
// A non-fatal library warning: one amber line in the output (IDE Output tab / exported page), never a "\u2717" error.
function _libWarn(msg){
  if(!msg)return;
  try{console.warn(msg)}catch(e){}
  var out=document.getElementById('tab-output');if(!out)return;
  var d=document.createElement('div');d.className='emit-warning';d.style.cssText='color:#f59e0b;padding:2px 0;white-space:pre-wrap;word-break:break-word;';d.textContent='\u26a0 '+msg;out.appendChild(d);
  _libWarnNodes.push(d);
}
// ── Library text that is already in hand: embedded in an offline export, or (IDE only) taken from the offline cache ──
// Offline export: {js:{url:text},css:{url:text},mod:{url:{s:source,d:[[start,end,depUrl]…],t:type}},alias:{requested url:final url}},
// taken from the global __emitEmbedded that an offline export defines before the runtime starts. null in the IDE and in normal exports.
var _libEmbedded=(typeof __emitEmbedded==='object'&&__emitEmbedded)||null;
var _libCache=null;          // IDE only: {usable, get(url) → Promise of {text,t}|null, save(url,kind)}. Stays null in exported files.
var _libResolved={};         // "<url> as <Name>" → {as:'module'|'classic',url}: what worked for a `use … as Name` line (exports record it)
var _libWarnNodes=[];        // warning lines written so far (the IDE puts them back when an error replaces the output)
var _LIB_OFFLINE_TIMEOUT=4000;   // navigator.onLine === false: give the network this long before the cached copy is used
function _libKey(u){return u.url+' as '+u.alias}
//#emit-mote-begin — up to the matching end marker: only in exported programs that use Mote (see _exportRuntime)
// Libraries BUILT INTO the page (URL emit:<name>, e.g. emit:mote for `use mote`): their source text is in hand, so they
// load with no network at all. The IDE keeps the text in a non-executing <script type="text/plain"
// data-emit-builtin="emit:mote"> element; an exported program carries it in its library entry (P.libs[i].text, which
// _loadUse puts here). _loadLib runs it once as a classic script from a Blob URL (_loadLibText), like an offline export.
var _libBuiltin={};
function _libIsBuiltin(url){return/^emit:/.test(String(url||''))}
function _libBuiltinText(url){
  if(typeof _libBuiltin[url]==='string')return _libBuiltin[url];
  try{var els=document.querySelectorAll('script[type="text/plain"][data-emit-builtin]');for(var i=0;i<els.length;i++)if(els[i].getAttribute('data-emit-builtin')===url)return els[i].textContent}catch(e){}
  return null;
}
//#emit-mote-end
function _libTimeout(ms){try{if(_libCache&&_libCache.usable&&navigator.onLine===false)return Math.min(ms,_LIB_OFFLINE_TIMEOUT)}catch(e){}return ms}
function _libShowErr(msg){
  try{console.error(msg)}catch(e){}
  var out=document.getElementById('tab-output');if(!out)return;
  var d=document.createElement('div');d.className='emit-error';d.style.cssText='color:#ef4444;padding:6px 12px;font-family:var(--mono);font-size:13px;white-space:pre-wrap;word-break:break-word;';d.textContent='✗ '+msg;out.appendChild(d);
}
// The cached copy of a URL (IDE only), or null. Never rejects.
function _libCached(url){
  if(!_libCache)return Promise.resolve(null);
  try{return Promise.resolve(_libCache.get(url)).then(function(hit){return hit&&typeof hit.text==='string'?hit:null},function(){return null})}catch(e){return Promise.resolve(null)}
}
function _libCacheNote(label,url,hit){
  var when='';try{if(hit.t)when=' (saved '+new Date(hit.t).toISOString().slice(0,10)+')'}catch(e){}
  return 'Offline: "'+label+'" could not be loaded from the network — using the copy in the offline cache'+when+(label===url?'':': '+url);
}
// Runs library source text as a classic script: a Blob URL in a real <script src>, so it is an ordinary global script
// (non-strict, top-level declarations become globals, document.currentScript is set) exactly as from the CDN.
// If Blob URLs are not available the same text runs as an inline <script> element. An error the library throws
// while loading is written to the output; the load itself still counts (as with <script src>, whose load event
// fires either way). Never rejects.
function _loadLibText(url,label,text,what){
  return new Promise(function(ok){
    var blobUrl=null,errs=[],inline=false,done=false;
    function onErr(ev){if(inline||(blobUrl&&ev&&ev.filename===blobUrl))errs.push(((ev&&ev.message)||'error')+(ev&&ev.lineno?' (line '+ev.lineno+')':''))}
    function finish(){
      if(done)return;done=true;
      window.removeEventListener('error',onErr);
      if(blobUrl)try{URL.revokeObjectURL(blobUrl)}catch(e){}
      if(errs.length)_libShowErr(what+' library "'+label+'" ('+url+') threw while loading: '+errs[0]+'. The program may not work.');
      _libsLoaded.add(url);ok();
    }
    function runInline(){
      var s=document.createElement('script');s.setAttribute('data-emit-lib',url);s.textContent=text;
      inline=true;try{document.head.appendChild(s)}catch(e){errs.push((e&&e.message)||String(e))}inline=false;
      finish();
    }
    window.addEventListener('error',onErr);
    try{blobUrl=URL.createObjectURL(new Blob([text],{type:'text/javascript'}))}catch(e){blobUrl=null}
    if(!blobUrl){runInline();return}
    var s=document.createElement('script');s.setAttribute('data-emit-lib',url);s.src=blobUrl;
    s.onload=finish;
    s.onerror=function(){s.remove();try{URL.revokeObjectURL(blobUrl)}catch(e){}blobUrl=null;runInline()};
    document.head.appendChild(s);
  });
}
function _cssText(url,text){
  Array.prototype.slice.call(document.querySelectorAll('style[data-emit-lib-css]')).forEach(function(t){if(t.getAttribute('data-emit-lib-css')===url)t.remove()});
  var st=document.createElement('style');st.setAttribute('data-emit-lib-css',url);st.textContent=text;document.head.appendChild(st);
}
// Offline export: the Blob URL of an embedded ES module. Its import specifiers were located at export time
// (m.d: [start,end,url] of each string literal); they are replaced by the Blob URLs of the embedded
// dependencies, dependencies first. A cycle cannot be built this way — the export refuses those.
var _embedModUrls={};
function _embedModUrl(url,stack){
  var E=_libEmbedded;if(!E||!E.mod)return null;
  if(E.alias&&E.alias[url])url=E.alias[url];
  var m=E.mod[url];if(!m)return null;
  if(_embedModUrls[url])return _embedModUrls[url];
  stack=stack||[];
  if(stack.indexOf(url)>=0)throw new Error('embedded modules import each other in a cycle: '+stack.concat(url).join(' → '));
  stack.push(url);
  var out='',p=0;
  m.d.forEach(function(d){var dep=_embedModUrl(d[2],stack);out+=m.s.substring(p,d[0])+JSON.stringify(dep||d[2]);p=d[1]});
  out+=m.s.substring(p);
  stack.pop();
  return _embedModUrls[url]=URL.createObjectURL(new Blob([out],{type:m.t||'text/javascript'}));
}
// One short line for the Output tab: imports grouped by module, internal __js__ helpers only counted.
function _importsSummary(imports){
  var by={},order=[];
  imports.forEach(function(i){if(!by[i.module]){by[i.module]=[];order.push(i.module)}by[i.module].push(i.name)});
  return order.map(function(m){
    if(m==='__js__'||m==='__cb__')return by[m].length+' interop helper'+(by[m].length>1?'s':'');
    return m+': '+by[m].join(', ');
  }).join(' \u00b7 ');
}
// A page whose Content Security Policy lacks 'wasm-unsafe-eval' (in-app file previewers, some sandboxes)
// cannot compile any WebAssembly. Say what to do instead of only showing the browser's policy text.
function _wasmBlockedMsg(e){
  var m=String(e&&e.message||e);
  if(!/Content Security Policy|unsafe-eval|wasm-unsafe-eval/i.test(m))return '';
  return 'This page is being shown in a viewer that does not allow WebAssembly (its security policy blocks it), so no program can run here. Open the file in a normal browser tab instead (for example Chrome: download it, then open it from your files). The program itself compiled fine.';
}
function _loadLib(url,label){
  // No label = a registry library auto-loaded because a builtin it provides is called without a `use` line:
  // go through _loadUse so the entry's `needs` and `css` are loaded too.
  if(!label){var _reg=LIBS.find(function(x){return x.cdn===url});if(_reg&&(_reg.needs||_reg.css))return _loadUse({lib:_reg,url:url,classicUrl:url,label:_reg.name,alias:null,module:false})}
  label=label||_libLabel(url);
  return new Promise(function(ok,fail){
    if(_libsLoaded.has(url)){ok();return}
    if(_libEmbedded&&_libEmbedded.js&&typeof _libEmbedded.js[url]==='string'){var _txt=_libEmbedded.js[url];_libEmbedded.js[url]=true;_loadLibText(url,label,_txt,'Embedded').then(ok);return}   // offline export
    if(/^emit:/.test(url)){var _bt=_libBuiltinText(url);if(typeof _bt!=='string'){fail(_libErr('The built-in library "'+label+'" ('+url+') is not in this page'));return}_loadLibText(url,label,_bt,'Built-in').then(ok);return}   // built into the page: no network, nothing to cache
    // A tag left over from a failed or abandoned attempt must not count as "loaded"
    Array.prototype.slice.call(document.scripts).forEach(function(t){if(t.getAttribute('src')===url)t.remove()});
    var s=document.createElement('script'),done=false,timer;
    function finish(err){if(done)return;done=true;clearTimeout(timer);if(err){s.remove();_libCached(url).then(function(hit){if(!hit){fail(err);return}_libWarn(_libCacheNote(label,url,hit));_loadLibText(url,label,hit.text,'Cached').then(ok)})}else{_libsLoaded.add(url);if(_libCache)try{_libCache.save(url,'js')}catch(e){}ok()}}
    s.src=url;
    s.onload=function(){finish(null)};
    s.onerror=function(){finish(_libErr('Could not load library "'+label+'" from '+url+' — the request failed (wrong name or URL, or no network). Fix the use line and Run again.'))};
    var _lt=_libTimeout(_LIB_TIMEOUT);
    timer=setTimeout(function(){finish(_libErr('Could not load library "'+label+'" from '+url+' — timed out after '+(_lt/1000)+'s. Run again to retry.'))},_lt);
    document.head.appendChild(s);
  });
}
function _importLib(url,label){
  if(_libModules.has(url))return Promise.resolve(_libModules.get(url));
  var n=_libFails[url]||0,timer,emb=null;
  try{emb=_embedModUrl(url)}catch(e){return Promise.reject(_libErr('Could not load the embedded library "'+label+'" ('+url+') \u2014 '+e.message))}   // offline export
  // After a failure the browser may remember the failed module; a URL fragment forces a new fetch.
  var load=import(emb||(n?url+'#emit-retry-'+n:url));
  var timeout=new Promise(function(_,fail){timer=setTimeout(function(){fail(new Error('timed out after '+(_LIB_TIMEOUT/1000)+'s'))},_LIB_TIMEOUT)});
  return Promise.race([load,timeout]).then(function(ns){clearTimeout(timer);_libModules.set(url,ns);return ns},function(e){clearTimeout(timer);_libFails[url]=n+1;var why=String((e&&e.message)||e),er=_libErr(emb?'Embedded library "'+label+'" ('+url+') threw while loading: '+why:'Could not load library "'+label+'" as an ES module from '+url+' — '+why);er.reason=why;throw er});
}
// Find every `use` line. Returns [{line,spec,alias,label,url,classicUrl,module,lib,css}]  (css:true = the line names a stylesheet)
function _parseUses(source){
  var uses=[];
  source.split('\n').forEach(function(text,idx){
    var m=text.match(/^\s*use\s+(.*)$/i);if(!m)return;
    var rest=m[1].trim(),spec,after,q=rest.match(/^(["'])(.*?)\1(.*)$/);
    if(q){spec=q[2].trim();after=q[3]}
    else{rest=rest.replace(/(^|\s)\/\/.*$/,'');var u=rest.match(/^(\S+)(.*)$/);if(!u)return;spec=u[1].replace(/;+$/,'');after=u[2]}
    if(!spec)return;
    after=after.replace(/\/\/.*$/,'').replace(/;\s*$/,'').trim();
    var alias=null;
    if(after){var a=after.match(/^as\s+([A-Za-z_][A-Za-z0-9_]*)$/i);if(!a)throw _libErr((idx+1)+':1: Bad use line — expected: use <library name or URL> [as Name]');alias=a[1]}
    var use={line:idx+1,spec:spec,alias:alias,label:spec,lib:null};
    var lib=LIBS.find(function(l){return l.name===spec||l.name.replace('.js','')===spec})||LIBS.find(function(l){var k=spec.toLowerCase();return l.name.toLowerCase()===k||l.name.replace('.js','').toLowerCase()===k});
    // Explicit source for an npm package: use esm.sh:<spec> as Name / use jsdelivr:<spec> [as Name]
    var from=spec.match(/^(esm\.sh|jsdelivr):(.*)$/i),npmRe=/^(@[a-z0-9~._-]+\/)?[a-z0-9~._-]+(@[^\s\/@]+)?(\/[^\s]*)?$/i;
    if(from){
      if(!npmRe.test(from[2]))throw _libErr((idx+1)+':1: "'+from[2]+'" is not an npm package name — expected: use '+from[1]+':<package>[@version] as Name');
      if(from[1].toLowerCase()==='esm.sh'){
        if(!alias)throw _libErr((idx+1)+':1: esm.sh serves ES modules, which need a name — write: use '+spec+' as Name');
        use.url=use.classicUrl='https://esm.sh/'+from[2];use.module=true;use.esmOnly=true;
      }else{use.classicUrl='https://cdn.jsdelivr.net/npm/'+from[2];use.module=!!alias;use.url=use.classicUrl+(alias?'/+esm':'')}
    }
    else if(/^(https?:\/\/|\.{0,2}\/)/i.test(spec)){use.url=use.classicUrl=spec;use.module=!!alias}
    else if(lib){use.lib=lib;use.url=use.classicUrl=lib.cdn;use.module=false}
    else if(npmRe.test(spec)){use.classicUrl='https://cdn.jsdelivr.net/npm/'+spec;use.module=!!alias;use.url=use.classicUrl+(alias?'/+esm':'');if(alias)use.altUrl='https://esm.sh/'+spec}   // altUrl: second source, tried once when the first fails
    else throw _libErr((idx+1)+':1: "'+spec+'" is not a library name, npm package or URL');
    // A stylesheet instead of a script: use "https://…/x.css" (quoted or not), or an npm path ending in .css
    if(!use.lib&&/\.css([?#].*)?$/i.test(spec)){if(alias)throw _libErr((idx+1)+':1: Bad use line — a stylesheet has nothing to name, drop "as '+alias+'"');use.css=true;use.module=false;use.url=use.classicUrl;delete use.altUrl}
    uses.push(use);
  });
  return uses;
}
async function _loadUse(u){
  if(u&&typeof u.text==='string'&&/^emit:/.test(u.url))_libBuiltin[u.url]=u.text;   // an exported program brings the text of a built-in library
  if(u.css){_libWarn(await _loadCss(u.url,u.label));return}   // use "….css"
  if(u.lib&&u.lib.css)for(var _css of u.lib.css)_libWarn(await _loadCss(_css,u.label));   // stylesheets a registry entry ships (e.g. leaflet.css)
  if(u.lib&&u.lib.needs)for(var _need of u.lib.needs)await _loadLib(_need,u.label);   // scripts a registry entry depends on (e.g. Popper for tippy)
  if(!u.alias){await _loadLib(u.url,u.label);return}
  var noGlobal='Library "'+u.label+'" loaded from '+u.classicUrl+', but it has no ES module exports and did not define a global named '+u.alias+'. After "as", use the global name the library defines — or drop "as '+u.alias+'".';
  if(!u.module){ // registry library: classic script, `as` just names (or aliases) its global
    await _loadLib(u.url,u.label);
    if(window[u.alias]===undefined){if(u.lib&&u.lib.global&&window[u.lib.global]!==undefined)window[u.alias]=window[u.lib.global];else throw _libErr(noGlobal)}
    return;
  }
  var ns=null,importErr=null,from=u.url;
  try{ns=await _importLib(u.url,u.label)}catch(e){importErr=e}
  // The module could not be fetched, or threw while it was imported (e.g. it needs Node built-ins):
  // one retry from the second source (esm.sh for an npm name). The error names both attempts.
  if(!ns&&u.altUrl){
    try{ns=await _importLib(u.altUrl,u.label);from=u.altUrl}
    catch(e){importErr=_libErr(importErr.message.replace(/[.\s]+$/,'')+'. Then tried '+u.altUrl+' \u2014 '+(e.reason||e.message))}
  }
  if(ns){
    var keys=Object.keys(ns);
    // Module namespace -> window[Name]. A module whose only export is `default` is exposed as that default.
    if(keys.length){window[u.alias]=(keys.length===1&&keys[0]==='default'&&ns.default!=null&&(typeof ns.default==='object'||typeof ns.default==='function'))?ns.default:ns;_libResolved[_libKey(u)]={as:'module',url:from};return}
    if(window[u.alias]!==undefined){_libResolved[_libKey(u)]={as:'module',url:from};return} // classic script that set its global while running as a module
  }
  // esm.sh serves ES modules only, and an offline export has nothing else embedded: no classic-script attempt
  if(u.esmOnly||_libEmbedded)throw importErr||_libErr('Library "'+u.label+'" loaded from '+from+', but it has no ES module exports and did not define a global named '+u.alias+'.');
  // Not an ES module (or the import failed): try it as a classic script that defines window[Name]
  try{await _loadLib(u.classicUrl,u.label)}catch(e){throw importErr||e}
  if(window[u.alias]===undefined)throw _libErr(noGlobal+(importErr?' ('+importErr.message+')':''));
  _libResolved[_libKey(u)]={as:'classic',url:u.classicUrl};
}
//#emit-mote-begin — up to the matching end marker: only in exported programs that use Mote (see _exportRuntime)
// ═══ MOTE (runtime half; the compiler half is "MOTE SCRIPTS" in the compiler) ═══
// The Mote builtins of Emit are these global functions, reached through the JS interop (__jsCallG): any number and
// type of arguments, results come back as js values, and an error they throw is an ordinary interop error — a red
// line, or the error of the enclosing try / catch. Mote itself is loaded by `use mote` (or automatically when a
// program calls one of them): the built-in library emit:mote.
//   moteVM([steps])                 a sandboxed VM: base string table math coroutine, a step budget per call
//                                   (default _MOTE_STEPS), print → the Output tab (violet lines), and the host
//                                   functions wait(seconds), waitFrames(n), choose(…) for threads (they yield)
//   moteRun(vm, src)                runs Mote source (a script block name is its source); → first result or null
//   moteSet(vm, name, v) / moteGet(vm, name) / moteCall(vm, fn, args…)
//   moteFn(vm, name, f)             f: fnRef(emitFn) — the script calls back into Emit
//   moteThread(vm, fn, args…)       a coroutine (fn: a script block, Mote source, or a global function name)
//   moteResume(th) → bool           call once per frame: runs the thread up to its next wait / waitFrames / choose /
//                                   coroutine.yield (a wait is not over → returns at once); false when finished
//   moteChoices(th) → js / moteChoose(th, n)   the options while the script waits in choose(…) / the answer (1-based)
// Errors name the script and its line, mapped back to the file: "intro:3: attempt to … (scripts.emit:14)".
var _MOTE_STEPS=1e6;
// Global functions whose calls are not traced or listed under Results (their arguments can be whole scripts). name → 1
var _jsQuiet=Object.create(null);
var _moteVMs=new WeakMap(),_moteThs=new WeakMap();
var _MOTE_HDR=/^--\[\[script ([A-Za-z_]\w*) @(?:(.*?):)?(\d+)\]\]/;
function _moteLib(){
  var M=(typeof Mote!=='undefined')?Mote:window.Mote;
  if(!M||typeof M.create!=='function')throw new Error('Mote is not loaded — add the line: use mote');
  return M;
}
function _moteSt(fn,vm){var st=vm&&typeof vm==='object'?_moteVMs.get(vm):null;if(!st)throw new TypeError(fn+': the first argument must be a VM made by moteVM()');return st}
function _moteThSt(fn,th){var T=th&&typeof th==='object'?_moteThs.get(th):null;if(!T)throw new TypeError(fn+': the argument must be a thread made by moteThread(vm, …)');return T}
// Source text → {src, chunk}: a script block's text names its chunk (and where it is) in its first-line comment
function _moteSrc(st,src,fn){
  if(typeof src!=='string')throw new TypeError(fn+': the script must be text (a script block name or a str of Mote source)');
  var m=_MOTE_HDR.exec(src);
  if(!m)return{src:src,chunk:'main'};
  st.chunks[m[1]]={file:m[2]||'',line:+m[3]};
  return{src:src,chunk:m[1]};
}
// A Mote error as the Emit program sees it: Mote's message plus where that line is in the program
function _moteErr(st,e,fn){
  var msg=(e&&e.message!=null)?String(e.message):String(e);
  if(!(e&&e.kind)&&!/^[A-Za-z_][\w.]*:\d+:/.test(msg))msg=fn+': '+msg;   /* a conversion error of the helper itself */
  var m=/^([A-Za-z_][\w.]*):(\d+):/.exec(msg),at=m&&st&&st.chunks[m[1]],x=new Error(msg);
  if(at){var L=at.line+Number(m[2]);x.message=msg+' ('+(at.file?at.file+':':'line ')+L+')';x.file=at.file||null;x.line=L}
  if(m)x.moteLine=Number(m[2]);
  x.moteKind=(e&&e.kind)||'host';
  if(e&&e.value!==undefined)x.value=e.value;
  return x;
}
function _motePrint(s){
  var out=document.getElementById('tab-output');if(!out)return;
  var d=document.createElement('div');d.className='emit-mote-print';
  d.style.cssText='font-family:var(--mono);font-size:13px;padding:2px 10px;margin-left:2px;color:#c4b5fd;border-left:2px solid #7c3aed;white-space:pre-wrap;word-break:break-word;';
  d.textContent=String(s);out.appendChild(d);
}
window.moteVM=function(steps){
  var M=_moteLib(),n=Number(steps);
  var vm=M.create({print:_motePrint,stdlib:['base','string','table','math','coroutine'],maxSteps:(n>0&&isFinite(n))?Math.floor(n):_MOTE_STEPS,maxMemory:16e6,seed:1,caseInsensitive:true});   /* Emit names are case-insensitive: so are the scripts' */
  var st={chunks:{}};_moteVMs.set(vm,st);
  vm.set('wait',function(sec){return vm.yield('wait',Math.max(0,Number(sec)||0))});
  vm.set('waitFrames',function(f){return vm.yield('frames',Math.max(1,Math.floor(Number(f)||1)))});
  vm.set('choose',function(){return vm.yield.apply(vm,['choose'].concat([].slice.call(arguments)))});
  return vm;
};
window.moteRun=function(vm,src){
  var st=_moteSt('moteRun',vm),s=_moteSrc(st,src,'moteRun');
  try{var r=vm.run(s.src,s.chunk);return r.length?r[0]:null}catch(e){throw _moteErr(st,e,'moteRun')}
};
window.moteSet=function(vm,name,v){
  var st=_moteSt('moteSet',vm);
  if(typeof name!=='string'||!name)throw new TypeError('moteSet: the name must be a str');
  try{vm.set(name,v)}catch(e){throw _moteErr(st,e,'moteSet')}
};
window.moteGet=function(vm,name){
  var st=_moteSt('moteGet',vm);
  try{var v=vm.get(name);return v===undefined?null:v}catch(e){throw _moteErr(st,e,'moteGet')}
};
window.moteCall=function(vm,fn){
  var st=_moteSt('moteCall',vm),args=[].slice.call(arguments,2);
  if(typeof fn==='string'&&typeof vm.get(fn)!=='function')throw new Error('moteCall: the script has no function named '+fn);
  try{var r=vm.call.apply(vm,[fn].concat(args));return r.length?r[0]:null}catch(e){throw _moteErr(st,e,'moteCall')}
};
window.moteFn=function(vm,name,f){
  var st=_moteSt('moteFn',vm);
  if(typeof name!=='string'||!/^[A-Za-z_]\w*$/.test(name))throw new TypeError('moteFn: the name must be a Mote name such as "give"');
  if(typeof f!=='function')throw new TypeError('moteFn: the function must be an Emit function: moteFn(vm, "'+name+'", fnRef(myFn))');
  try{vm.set(name,f)}catch(e){throw _moteErr(st,e,'moteFn')}
};
window.moteThread=function(vm,fn){
  var st=_moteSt('moteThread',vm),args=[].slice.call(arguments,2),f=fn;
  try{
    if(typeof fn==='string'&&/^[A-Za-z_]\w*$/.test(fn)){if(typeof vm.get(fn)!=='function')throw new Error('moteThread: the script has no function named '+fn+' (run the script that defines it first, or pass a script block)')}
    else if(typeof fn==='string'){var s=_moteSrc(st,fn,'moteThread');f=vm.compile(s.src,s.chunk)}
    else if(typeof fn!=='function')throw new TypeError('moteThread: give a script block, Mote source, a function name or a Mote function');
    var th=vm.thread.apply(vm,[f].concat(args));
  }catch(e){throw e&&e.kind?_moteErr(st,e,'moteThread'):e}
  _moteThs.set(th,{th:th,vm:vm,st:st,until:0,frames:0,ask:null,pend:[],done:false});
  return th;
};
window.moteResume=function(th){
  var T=_moteThSt('moteResume',th);
  if(T.done)return false;
  if(T.ask)return true;                                  /* waits for moteChoose */
  if(T.frames>0){T.frames--;return true}                 /* waitFrames(n) */
  if(T.until&&performance.now()<T.until)return true;     /* wait(seconds) */
  T.until=0;
  var r,a=T.pend;T.pend=[];
  try{r=T.th.resume.apply(T.th,a)}catch(e){T.done=true;throw _moteErr(T.st,e,'moteResume')}
  if(r.done){T.done=true;return false}
  var v=r.values||[];
  if(v[0]==='wait')T.until=performance.now()+Number(v[1])*1000;
  else if(v[0]==='frames')T.frames=Math.max(0,Number(v[1])-1);
  else if(v[0]==='choose')T.ask=v.slice(1);
  return true;                                           /* coroutine.yield(…) in the script: one frame */
};
window.moteChoices=function(th){var T=_moteThSt('moteChoices',th);return T.ask?T.ask.slice():null};
window.moteChoose=function(th,n){
  var T=_moteThSt('moteChoose',th);
  if(!T.ask)throw new Error('moteChoose: the script is not waiting in choose(…)');
  var k=Math.floor(Number(n));
  if(!(k>=1&&k<=T.ask.length))throw new RangeError('moteChoose: option '+n+' does not exist — choose(…) offered '+T.ask.length+' (1 to '+T.ask.length+')');
  T.ask=null;T.pend=[k];
};
['moteVM','moteRun','moteSet','moteGet','moteCall','moteFn','moteThread','moteResume','moteChoices','moteChoose'].forEach(function(n){_jsQuiet[n]=1});
//#emit-mote-end
//#emit-runtime-end

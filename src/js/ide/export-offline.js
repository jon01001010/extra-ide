// ═══ OFFLINE EXPORT ═══
// "Export .html (offline)" / "Export .js (offline)": the same files as the normal exports, plus the text of
// every library the program loads, fetched now (fetch() from this page, so the server must allow cross-origin
// reads — jsDelivr and esm.sh do) and embedded:
//   classic scripts  as JS string literals; the exported runtime runs each from a Blob URL in a real
//                    <script src> (see _loadLibText), so they behave as global scripts exactly as from the CDN;
//   stylesheets      as text for a <style> element, url(…) references inlined as data: URIs when they can be
//                    fetched and are under 200 KB, otherwise left as absolute URLs (listed in the report);
//   ES modules       with every module they import, statically or by import("literal"): the import specifiers
//                    are located here (_esmImports) and replaced by Blob URLs when the page opens, dependencies
//                    first. Modules that import each other in a cycle cannot be linked that way: the export
//                    stops with a message instead of writing a file that cannot work.
// If anything cannot be fetched the export fails with a message naming it; no file is written.
var _OFFLINE_CSS_INLINE_MAX=200*1024;
// JSON string literal that is also safe inside an inline script element: "<" is escaped where it could start a closing tag or an HTML comment.
function _exportJsStr(s){return JSON.stringify(s).replace(/<(?=[\/!])|[\u2028\u2029]/g,function(c){return'\\u'+('000'+c.charCodeAt(0).toString(16)).slice(-4)})}
// Finds the import specifiers of an ES module without running it: a tokenizer that skips comments, strings,
// template literals and regular expressions, then looks at import/export declarations and import("…") calls.
// Returns {imports:[{s,e,spec,dyn}], computed}: s/e = the string literal including its quotes; computed = the
// number of import(expression) calls whose target is not a string literal (they cannot be followed).
function _esmImports(src){
  var n=src.length,i=0,tt=[],ts=[],te=[];   // token type (1 word, 2 string, 3 punctuator, 4 other value), start, end
  var braces=[],parens=[],lastParenCtl=false;
  if(src.charCodeAt(0)===35&&src[1]==='!'){var hb=src.indexOf('\n');i=hb<0?n:hb}
  function push(t,s,e){tt.push(t);ts.push(s);te.push(e)}
  function regexAllowed(){
    var k=tt.length-1;if(k<0)return true;
    var t=tt[k];
    if(t===2||t===4)return false;
    if(t===1)return/^(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/.test(src.substring(ts[k],te[k]));
    var c=src[ts[k]];
    if(c===')')return lastParenCtl;
    return c!==']';
  }
  // i is inside a template literal; stops after its closing ` (token: value) or after a ${ (token: '{')
  function tpl(s0){
    while(i<n){
      var c=src[i];
      if(c==='\\'){i+=2;continue}
      if(c==='`'){i++;push(4,s0,i);return}
      if(c==='$'&&src[i+1]==='{'){i+=2;braces.push(1);push(3,i-1,i);return}
      i++;
    }
    throw new Error('unterminated template literal');
  }
  while(i<n){
    var c=src[i],cc=src.charCodeAt(i),j;
    if(cc<=32||cc===0xA0||cc===0xFEFF||cc===0x2028||cc===0x2029){i++;continue}
    if(c==='/'){
      var d=src[i+1];
      if(d==='/'){j=src.indexOf('\n',i);i=j<0?n:j;continue}
      if(d==='*'){j=src.indexOf('*/',i+2);if(j<0)throw new Error('unterminated comment');i=j+2;continue}
      if(regexAllowed()){
        var cls=false,closed=false;j=i+1;
        while(j<n){var r=src[j];if(r==='\n'||r==='\r')break;if(r==='\\'){j+=2;continue}if(r==='[')cls=true;else if(r===']')cls=false;else if(r==='/'&&!cls){closed=true;break}j++}
        if(closed){j++;while(j<n&&/[A-Za-z]/.test(src[j]))j++;push(4,i,j);i=j;continue}
      }
      push(3,i,i+1);i++;continue;
    }
    if(c==='"'||c==="'"){
      j=i+1;
      while(j<n){var q=src[j];if(q==='\\'){j+=2;continue}if(q===c)break;if(q==='\n')throw new Error('unterminated string literal');j++}
      if(j>=n)throw new Error('unterminated string literal');
      push(2,i,j+1);i=j+1;continue;
    }
    if(c==='`'){j=i;i++;tpl(j);continue}
    if(c==='{'){braces.push(0);push(3,i,i+1);i++;continue}
    if(c==='}'){var b=braces.pop();i++;if(b===1)tpl(i-1);else push(3,i-1,i);continue}
    if(c==='('){var k0=tt.length-1;parens.push(k0>=0&&tt[k0]===1&&/^(if|while|for|with)$/.test(src.substring(ts[k0],te[k0])));push(3,i,i+1);i++;continue}
    if(c===')'){lastParenCtl=!!parens.pop();push(3,i,i+1);i++;continue}
    if((cc>=65&&cc<=90)||(cc>=97&&cc<=122)||cc===95||cc===36||cc===92||cc>127){
      j=i+1;
      for(;j<n;j++){var x=src.charCodeAt(j);if(!((x>=65&&x<=90)||(x>=97&&x<=122)||(x>=48&&x<=57)||x===95||x===36||x===92||(x>127&&x!==0x2028&&x!==0x2029)))break}
      push(1,i,j);i=j;continue;
    }
    if((cc>=48&&cc<=57)||(c==='.'&&src.charCodeAt(i+1)>=48&&src.charCodeAt(i+1)<=57)){
      j=i+1;
      for(;j<n;j++){var y=src.charCodeAt(j);if(!((y>=48&&y<=57)||(y>=65&&y<=90)||(y>=97&&y<=122)||y===95||y===46))break}
      push(4,i,j);i=j;continue;
    }
    if((c==='+'||c==='-')&&src[i+1]===c){
      // ++ / -- after a value is a postfix operator: the value stays the last token (a following / is a division)
      var kp=tt.length-1,post=kp>=0&&(tt[kp]===4||tt[kp]===2||(tt[kp]===1&&!regexAllowed())||(tt[kp]===3&&(src[ts[kp]]===']'||(src[ts[kp]]===')'&&!lastParenCtl))));
      if(!post)push(3,i,i+2);
      i+=2;continue;
    }
    push(3,i,i+1);i++;
  }
  var T=tt.length,out=[],computed=0;
  function word(k){return k<T&&tt[k]===1?src.substring(ts[k],te[k]):null}
  function punct(k){return k<T&&tt[k]===3?src[ts[k]]:null}
  function add(k,dyn){
    var raw=src.substring(ts[k]+1,te[k]-1);
    if(raw.indexOf('\\')>=0)throw new Error('an import specifier with escapes: '+raw);
    out.push({s:ts[k],e:te[k],spec:raw,dyn:!!dyn});
  }
  for(var k=0;k<T;k++){
    if(tt[k]!==1||te[k]-ts[k]!==6)continue;
    var w=src.substring(ts[k],te[k]);
    if(w!=='import'&&w!=='export')continue;
    if(k>0&&punct(k-1)==='.')continue;            // obj.import / obj.export
    if(w==='import'){
      if(punct(k+1)==='('){
        if(tt[k+2]===2&&(punct(k+3)===')'||punct(k+3)===','))add(k+2,true);else computed++;
        continue;
      }
      if(tt[k+1]===2){add(k+1);continue}          // import "x"
      if(!(tt[k+1]===1||punct(k+1)==='{'||punct(k+1)==='*'))continue;   // import.meta, {import:1}, …
      for(var q=k+1;q<T;q++){
        var pc=punct(q);
        if(pc===';'||pc==='='||pc==='('||pc===':')break;
        if(word(q)==='from'&&tt[q+1]===2){add(q+1);break}
      }
    }else{
      var p1=punct(k+1),f=-1;
      if(p1==='*'){f=k+2;if(word(f)==='as')f+=2}
      else if(p1==='{'){var depth=0;for(var z=k+1;z<T;z++){var pz=punct(z);if(pz==='{')depth++;else if(pz==='}'){depth--;if(!depth){f=z+1;break}}}}
      if(f>0&&word(f)==='from'&&tt[f+1]===2)add(f+1);
    }
  }
  return{imports:out,computed:computed};
}
function _offlineErr(msg){var e=new Error(msg);e.isOfflineError=true;return e}
// fetch() for the offline export: resolves to the Response, or rejects with a message that names the library.
async function _offlineFetch(url,label,what){
  var name=(what||'library')+' "'+label+'"'+(label===url?'':' from '+url),ctl=null,timer=null,r;
  try{ctl=new AbortController();timer=setTimeout(function(){ctl.abort()},60000)}catch(e){}
  try{r=await fetch(url,ctl?{signal:ctl.signal}:{})}
  catch(e){clearTimeout(timer);throw _offlineErr('could not fetch '+name+' \u2014 the request failed (no network, a wrong URL, or that server does not let other pages read its files)')}
  if(r.type==='opaque'||r.type==='opaqueredirect'){clearTimeout(timer);throw _offlineErr('could not read '+name+' \u2014 the server does not let other pages read its files (no CORS)')}
  if(!r.ok){clearTimeout(timer);throw _offlineErr('could not fetch '+name+' \u2014 the server answered '+r.status+(r.statusText?' '+r.statusText:''))}
  r._emitDone=function(){clearTimeout(timer)};
  return r;
}
async function _offlineText(url,label,what){
  var r=await _offlineFetch(url,label,what),text;
  try{text=await r.text()}catch(e){r._emitDone();throw _offlineErr('could not read '+(what||'library')+' "'+label+'" from '+url+' \u2014 the download was interrupted')}
  r._emitDone();
  return{text:text,url:(r.url||url).replace(/#.*$/,''),type:(r.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()};
}
function _blobDataUri(blob){return new Promise(function(ok,fail){var fr=new FileReader();fr.onload=function(){ok(fr.result)};fr.onerror=function(){fail(fr.error||new Error('read failed'))};fr.readAsDataURL(blob)})}
// A stylesheet for embedding: url(…) made absolute, then inlined as data: URIs where possible.
async function _offlineCss(url,label,report){
  var got=await _offlineText(url,label,'stylesheet'),text=_cssAbsUrls(got.text,got.url),uris={},refs=[],re=_cssUrlRe();
  text.replace(re,function(m,a,b,c,off){
    var u=a||b||c||'';
    if(!/^https?:/i.test(u)||refs.some(function(x){return x.url===u}))return m;
    refs.push({url:u,imported:/@import\s*$/i.test(text.substring(Math.max(0,off-16),off))});
    return m;
  });
  for(var i=0;i<refs.length;i++){
    var ref=refs[i];
    if(ref.imported){report.left.push({url:ref.url,from:url,why:'an @import inside the stylesheet is not followed'});continue}
    try{
      var ctl=new AbortController(),timer=setTimeout(function(){ctl.abort()},20000),r=await fetch(ref.url,{signal:ctl.signal});
      if(!r.ok||r.type==='opaque'){clearTimeout(timer);throw new Error('status '+r.status)}
      var blob=await r.blob();clearTimeout(timer);
      if(blob.size>_OFFLINE_CSS_INLINE_MAX){report.left.push({url:ref.url,from:url,why:'larger than 200 KB ('+_fmtSize(blob.size)+')'});continue}
      uris[ref.url]=await _blobDataUri(blob);
      report.inlined.push({url:ref.url,from:url,size:blob.size});
    }catch(e){report.left.push({url:ref.url,from:url,why:'could not be fetched'})}
  }
  return text.replace(re,function(m,a,b,c){var u=a||b||c||'';return uris[u]?'url("'+uris[u]+'")':m});
}
// An ES module and everything it imports, into E.mod (keyed by the final URL after redirects) / E.alias.
async function _offlineModules(rootUrl,label,E,report,tick){
  var state={},seen={};
  async function visit(reqUrl,chain){
    reqUrl=reqUrl.replace(/#.*$/,'');
    if(seen[reqUrl])reqUrl=seen[reqUrl];
    if(state[reqUrl]===2||(E.mod[reqUrl]&&!state[reqUrl]))return reqUrl;
    if(state[reqUrl]===1)throw _offlineErr('the ES modules of "'+label+'" import each other in a cycle ('+chain.slice(chain.indexOf(reqUrl)).concat(reqUrl).join(' \u2192 ')+'). Such a module graph cannot be embedded in one file');
    tick(chain.length?'module '+reqUrl.replace(/^https?:\/\/[^\/]+/,''):null);
    var got=await _offlineText(reqUrl,label,chain.length?'a module of library':'library'),url=got.url;
    if(url!==reqUrl){seen[reqUrl]=url;E.alias[reqUrl]=url;if(state[url]===2||(E.mod[url]&&!state[url]))return url;if(state[url]===1)throw _offlineErr('the ES modules of "'+label+'" import each other in a cycle ('+chain.concat(url).join(' \u2192 ')+'). Such a module graph cannot be embedded in one file')}
    state[url]=1;
    var m={s:got.text,d:[]};
    if(/json|css|wasm/.test(got.type)){m.t=got.type;E.mod[url]=m;state[url]=2;report.embedded.push({url:url,kind:'module',size:got.text.length});return url}
    var found;
    try{found=_esmImports(got.text)}catch(e){throw _offlineErr('could not analyse the ES module '+url+' of "'+label+'" ('+e.message+')')}
    if(found.computed)report.notes.push(url+' calls import() with a computed target '+(found.computed>1?found.computed+' times':'')+' \u2014 whatever that loads is not embedded');
    for(var i=0;i<found.imports.length;i++){
      var im=found.imports[i],spec=im.spec;
      if(/^(data|blob):/i.test(spec))continue;
      if(!/^(\.{0,2}\/|[a-z][a-z0-9+.-]*:)/i.test(spec))throw _offlineErr('the ES module '+url+' of "'+label+'" imports the bare name "'+spec+'", which a browser cannot resolve');
      var abs;try{abs=new URL(spec,url).href}catch(e){throw _offlineErr('the ES module '+url+' of "'+label+'" imports "'+spec+'", which is not a valid URL')}
      m.d.push([im.s,im.e,await visit(abs,chain.concat(url))]);
    }
    E.mod[url]=m;state[url]=2;
    report.embedded.push({url:url,kind:'module',size:got.text.length});
    return url;
  }
  return visit(rootUrl,[]);
}
// Fetches everything P.libs loads — in the order and by the rules of _loadUse — into the structure the
// exported runtime reads (_libEmbedded). progress(text) is called before each fetch.
async function _offlineEmbed(libs,progress){
  var E={js:{},css:{},mod:{},alias:{}},report={embedded:[],inlined:[],left:[],notes:[]},jobs=[];
  libs.forEach(function(l){
    if(_libIsBuiltin(l.url)){report.embedded.push({url:l.url,kind:'built-in script',size:(l.text||'').length});return}   // its text travels in the program data already
    if(l.css){jobs.push({kind:'css',url:l.url,label:l.label});return}
    if(l.lib&&l.lib.css)l.lib.css.forEach(function(u){jobs.push({kind:'css',url:u,label:l.label})});
    if(l.lib&&l.lib.needs)l.lib.needs.forEach(function(u){jobs.push({kind:'js',url:u,label:l.label})});
    jobs.push({kind:l.alias&&l.module?'mod':'js',url:l.url,label:l.label});
  });
  for(var i=0;i<jobs.length;i++){
    var j=jobs[i],step='fetching '+j.label+(j.label===j.url?'':' ('+(i+1)+'/'+jobs.length+')');
    progress(step);
    if(j.kind==='css'){if(E.css[j.url]==null){E.css[j.url]=await _offlineCss(j.url,j.label,report);report.embedded.push({url:j.url,kind:'stylesheet',size:E.css[j.url].length})}}
    else if(j.kind==='js'){if(E.js[j.url]==null){E.js[j.url]=(await _offlineText(j.url,j.label)).text;report.embedded.push({url:j.url,kind:'script',size:E.js[j.url].length})}}
    else await _offlineModules(j.url,j.label,E,report,function(extra){if(extra)progress(step+' \u2014 '+extra)});
  }
  return{embedded:E,report:report};
}
// The embedded libraries as JavaScript source: an object literal for the .js module, or statements that fill
// `name` (one <script> element per library, so no single script is larger than it has to be) for the .html.
function _offlineEmbedJs(E){
  var o={};
  ['js','css','mod','alias'].forEach(function(k){
    o[k]='{'+Object.keys(E[k]).map(function(u){
      var v=E[k][u];
      return _exportJsStr(u)+':'+(k==='mod'?'{s:'+_exportJsStr(v.s)+',d:'+JSON.stringify(v.d)+(v.t?',t:'+_exportJsStr(v.t):'')+'}':_exportJsStr(v));
    }).join(',\n')+'}';
  });
  return'{js:'+o.js+',\ncss:'+o.css+',\nmod:'+o.mod+',\nalias:'+o.alias+'}';
}
function _offlineEmbedHtml(E){
  var html='<script>\n// Libraries embedded by the offline export (source text; the runtime runs them when the program starts)\nvar __emitEmbedded={js:{},css:{},mod:{},alias:{}};\n<\/script>\n';
  ['js','css','mod','alias'].forEach(function(k){
    Object.keys(E[k]).forEach(function(u){
      var v=E[k][u];
      html+='<script>__emitEmbedded.'+k+'['+_exportJsStr(u)+']='+(k==='mod'?'{s:'+_exportJsStr(v.s)+',d:'+JSON.stringify(v.d)+(v.t?',t:'+_exportJsStr(v.t):'')+'}':_exportJsStr(v))+';<\/script>\n';
    });
  });
  return html;
}
var _lastExportReport=null;
function _offlineReportShow(rep){
  var out=document.getElementById('tab-output');if(!out)return;
  Array.prototype.slice.call(out.querySelectorAll('.emit-export-report')).forEach(function(n){n.remove()});
  var d=document.createElement('div');d.className='emit-export-report';d.style.cssText='font-family:var(--mono);font-size:12px;line-height:1.6;padding:8px 12px;margin:8px 0;border:1px solid var(--border);border-radius:6px;color:var(--fg2);white-space:pre-wrap;word-break:break-word;';
  var t='\u2713 '+rep.file+' \u2014 '+_fmtSize(rep.size)+', built in '+(rep.ms/1000).toFixed(1)+' s. It needs no network.\n';
  t+=rep.embedded.length?'Embedded: '+rep.embedded.map(function(e){return e.url.replace(/^https?:\/\/(cdn\.jsdelivr\.net\/npm\/)?/,'')+' ('+e.kind+', '+_fmtSize(e.size)+')'}).join(', ')+'\n':'The program uses no libraries.\n';
  if(rep.inlined.length)t+='Inlined into the stylesheets: '+rep.inlined.length+' file'+(rep.inlined.length===1?'':'s')+' (images, fonts)\n';
  if(rep.left.length)t+='\u26a0 Still loaded from the network (not embedded):\n'+rep.left.map(function(l){return'  '+l.url+' \u2014 '+l.why}).join('\n')+'\n';
  if(rep.notes.length)t+='\u26a0 '+rep.notes.join('\n\u26a0 ')+'\n';
  d.textContent=t;out.appendChild(d);
  if(window.innerWidth<768)showView('run');
}
async function _doExportOffline(fmt,source){
  var t0=performance.now(),js=fmt==='jsoff',file=js?'program-offline.js':'program-offline.html';
  function status(text){setStatus('idle','Offline export: '+text+'\u2026')}
  _lastExportReport=null;
  try{
    status('compiling');
    var r=compile(source,'wasm32');_exportCheck(r);
    // `use … as Name`: which source works (jsDelivr module, esm.sh module, classic script) is only known by
    // loading it, as Run does. Already known after a Run; otherwise load it now.
    var uses=_parseUses(source);
    for(var i=0;i<uses.length;i++){var u=uses[i];if(u.alias&&u.module&&!_libResolved[_libKey(u)]){status('loading '+u.label);await _loadUse(u)}}
    var P=_exportProgram(source,r);
    var built=await _offlineEmbed(P.libs,status);
    status('writing '+file);
    var text=js?_exportJs(P,built.embedded):_exportHtml(P,built.embedded);
    var size=new Blob([text]).size,rep=built.report;
    rep.file=file;rep.size=size;rep.ms=Math.round(performance.now()-t0);
    _download(file,text,js?'text/javascript':'text/html');
    _lastExportReport=rep;
    setStatus('ok','Exported '+file,_fmtSize(size));
    _offlineReportShow(rep);
    return rep;
  }catch(e){
    setStatus('err','Offline export failed');
    var msg=(e&&e.message)||String(e);
    window.alert('Offline export failed: '+msg+'.\n\nNo file was saved. '+(e&&(e.isOfflineError||e.isLibError)?'An offline export has to download every library now. If that is not possible, use "Export '+(js?'.js':'.html')+'" instead: that file loads its libraries from the network when it is opened.':''));
    return null;
  }
}
// A project whose modules do not link compiles to an empty module: refuse to export that.
function _exportCheck(r){
  if(r&&r.errors&&r.errors.length&&(!r.wasm||r.wasm.length<=8))throw new Error('the program has '+r.errors.length+' error'+(r.errors.length>1?'s':'')+' \u2014 fix them first:\n'+r.errors.slice(0,5).join('\n'));
}
function doExport(fmt){
  if(!fmt)return;
  if(fmt==='import'){importFile();return}
  if(fmt==='newfile'){_projAddFile();return}
  if(fmt==='find'){openReplace();return}
  var source=_projText();
  if(fmt==='htmloff'||fmt==='jsoff')return _doExportOffline(fmt,source);   // async: resolves to the export report, or null when it failed
  if(fmt==='emit'){
    _download('program.emit',source,'text/plain');
    return;
  }
  try{
    var r=compile(source,'wasm32');
    _exportCheck(r);
    if(fmt==='wasm'){
      // Raw bytes only: a host must supply every import itself (see Help → Export)
      _download('program.wasm',r.wasm,'application/wasm');
    } else if(fmt==='html'){
      // Standalone page: WASM + import list + the IDE's own runtime
      _download('program.html',_exportHtml(_exportProgram(source,r)),'text/html');
    } else if(fmt==='js'){
      // ES module with the same contents; init() starts the program
      _download('program.js',_exportJs(_exportProgram(source,r)),'text/javascript');
    }
  }catch(e){
    window.alert('Export failed: '+e.message);
  }
}


// ── Offline cache of library files (IDE only — not part of the exported runtime) ──
// Policy: network first. Every Run loads a library from its URL as before; after a classic script or a
// stylesheet has loaded, its text is stored by URL (Cache API when the page has one, else IndexedDB). Only
// when the network load fails (or times out — after _LIB_OFFLINE_TIMEOUT when navigator.onLine is false)
// does the loader use the stored copy, and it says so with one amber line. Version-pinned URLs (…@1.2.3…)
// are stored once; other URLs are refreshed at most once a day. ES modules (`use x as Name`) are not cached.
// On an origin without storage (opaque origins: content:// on Android, file:// in some browsers, sandboxed
// frames) every call below resolves to "nothing" and no request is made: the IDE behaves as without a cache.
var _libStore=(function(){
  var NAME='emit-lib-cache-v1',ready=null;
  function within(p,ms){return new Promise(function(ok,fail){var t=setTimeout(function(){fail(new Error('timeout'))},ms);Promise.resolve(p).then(function(v){clearTimeout(t);ok(v)},function(e){clearTimeout(t);fail(e)})})}
  function idbOpen(f){return new Promise(function(ok,fail){
    var rq=f.open(NAME,1);
    rq.onupgradeneeded=function(){var db=rq.result;if(!db.objectStoreNames.contains('libs'))db.createObjectStore('libs',{keyPath:'url'});if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta',{keyPath:'url'})};
    rq.onsuccess=function(){ok(rq.result)};
    rq.onerror=function(ev){try{ev.preventDefault()}catch(e){}fail(rq.error||new Error('indexedDB'))};
    rq.onblocked=function(){fail(new Error('blocked'))};
  })}
  // One transaction over both stores; fn(libs,meta) returns the request whose result is wanted (or nothing).
  function tx(db,mode,fn){return new Promise(function(ok,fail){
    var t=db.transaction(['libs','meta'],mode),rq=fn(t.objectStore('libs'),t.objectStore('meta')),res;
    if(rq)rq.onsuccess=function(){res=rq.result};
    t.oncomplete=function(){ok(res)};
    t.onerror=function(ev){try{ev.preventDefault()}catch(e){}};
    t.onabort=function(){fail(t.error||new Error('aborted'))};
  })}
  function open(){
    if(!ready)ready=(async function(){
      try{var cs=window.caches;if(cs&&cs.open){var c=await within(cs.open(NAME),2500);await within(c.keys(),2500);return{c:c}}}catch(e){}
      try{var f=window.indexedDB;if(f&&f.open){var db=await within(idbOpen(f),2500);return{db:db}}}catch(e){}
      return null;
    })();
    return ready;
  }
  function metaOf(r){return{t:+r.headers.get('x-emit-saved')||0,size:+r.headers.get('x-emit-size')||0,kind:r.headers.get('x-emit-kind')||'js'}}
  return{
    // 'Cache API' | 'IndexedDB' | null (no storage here)
    kind:async function(){try{var s=await open();return s?(s.c?'Cache API':'IndexedDB'):null}catch(e){return null}},
    get:async function(url){
      try{
        var s=await open();if(!s)return null;
        if(s.c){var r=await s.c.match(url);if(!r)return null;var m=metaOf(r);m.text=await r.text();return m}
        var v=await tx(s.db,'readonly',function(libs){return libs.get(url)});
        return v?{text:v.text,t:v.t,size:v.size,kind:v.kind}:null;
      }catch(e){return null}
    },
    meta:async function(url){
      try{
        var s=await open();if(!s)return null;
        if(s.c){var r=await s.c.match(url);return r?metaOf(r):null}
        return(await tx(s.db,'readonly',function(libs,meta){return meta.get(url)}))||null;
      }catch(e){return null}
    },
    put:async function(url,text,kind){
      try{
        var s=await open();if(!s)return false;
        var size=new Blob([text]).size,t=Date.now();
        if(s.c)await s.c.put(url,new Response(text,{headers:{'content-type':(kind==='css'?'text/css':'text/javascript')+';charset=utf-8','x-emit-saved':String(t),'x-emit-size':String(size),'x-emit-kind':kind}}));
        else await tx(s.db,'readwrite',function(libs,meta){libs.put({url:url,text:text,t:t,size:size,kind:kind});meta.put({url:url,t:t,size:size,kind:kind})});
        return true;
      }catch(e){return false}
    },
    // [{url,size,t,kind}]
    list:async function(){
      try{
        var s=await open();if(!s)return[];
        if(s.c){
          var keys=await s.c.keys(),out=[];
          for(var i=0;i<keys.length;i++){var r=await s.c.match(keys[i]);if(r){var m=metaOf(r);m.url=keys[i].url;out.push(m)}}
          return out;
        }
        return(await tx(s.db,'readonly',function(libs,meta){return meta.getAll()}))||[];
      }catch(e){return[]}
    },
    clear:async function(){
      try{
        var s=await open();if(!s)return;
        if(s.c){ready=null;await window.caches.delete(NAME)}
        else await tx(s.db,'readwrite',function(libs,meta){libs.clear();meta.clear()});
      }catch(e){}
    }
  };
})();
// url(…) and @import "…" inside a stylesheet are relative to the stylesheet's URL; text that is put into a
// <style> element has lost that base, so they are made absolute first.
function _cssUrlRe(){return/url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s][^)]*?))\s*\)/gi}
function _cssAbs(u,base){u=(u||'').trim();if(!u||/^(data:|blob:|about:|#)/i.test(u))return null;try{return new URL(u,base).href}catch(e){return null}}
function _cssAbsUrls(text,base){
  text=text.replace(/@import\s+(?:"([^"]+)"|'([^']+)')/gi,function(m,a,b){var u=_cssAbs(a||b,base);return u?'@import url("'+u+'")':m});
  return text.replace(_cssUrlRe(),function(m,a,b,c){var u=_cssAbs(a||b||c,base);return u?'url("'+u.replace(/"/g,'%22')+'")':m});
}
async function _libCacheSave(url,kind){
  try{
    if(!/^https?:$/.test(new URL(url,location.href).protocol))return;
    if(!(await _libStore.kind()))return;                         // no storage here: no extra request either
    var m=await _libStore.meta(url);
    if(m&&(/@\d/.test(url)||Date.now()-m.t<864e5))return;        // pinned version: never changes; otherwise once a day
    var r=await fetch(url,{cache:'force-cache'});                // normally answered by the browser's HTTP cache
    if(!r.ok)return;
    var text=await r.text();
    if(kind==='css')text=_cssAbsUrls(text,r.url||url);
    if(await _libStore.put(url,text,kind))_libCacheLine();
  }catch(e){}
}
_libCache={usable:false,get:function(url){return _libStore.get(url)},save:function(url,kind){_libCacheSave(url,kind)}};
_libStore.kind().then(function(k){_libCache.usable=!!k},function(){});   // usable: this page has storage (decides the short offline timeout)
function _fmtSize(n){return n<1024?n+' B':n<1048576?(n/1024).toFixed(n<10240?1:0)+' KB':(n/1048576).toFixed(n<10485760?2:1)+' MB'}
// "Offline cache: N libraries, X MB — Clear" in the 📚 panel; nothing when the cache is empty or there is no storage.
function _libCacheLine(){
  var el=document.getElementById('libCacheLine');if(!el)return Promise.resolve();
  return _libStore.list().then(function(items){
    el=document.getElementById('libCacheLine');if(!el)return;
    if(!items.length){el.innerHTML='';return}
    var js=items.filter(function(i){return i.kind!=='css'}).length,css=items.length-js,bytes=0;
    items.forEach(function(i){bytes+=i.size||0});
    el.innerHTML='<div class="lib-live" id="libCacheInfo" style="margin:0 0 14px">Offline cache: <b>'+js+'</b> librar'+(js===1?'y':'ies')+(css?' (+'+css+' stylesheet'+(css===1?'':'s')+')':'')+', '+_fmtSize(bytes)+' &mdash; <button class="lib-add" onclick="_libCacheClear()" title="Delete the stored copies. Libraries load from the network as usual; they are stored again the next time they load.">Clear</button><br><span style="color:var(--fg3)">Used only when a library cannot be loaded from the network.</span></div>';
  },function(){});
}
function _libCacheClear(){return _libStore.clear().then(_libCacheLine,_libCacheLine)}
// A loader warning (⚠ line) is written to the Output tab before compiling. A compile error or a library error then
// replaces the whole output — put the warnings of this Run back underneath it.
(function(){
  var run=compileAndRun;
  compileAndRun=async function(){
    _libWarnNodes.length=0;
    var out=document.getElementById('tab-output'),res;
    try{res=await run.apply(this,arguments)}
    finally{try{_libWarnNodes.forEach(function(n){if(out&&!out.contains(n))out.appendChild(n)})}catch(e){}}
    return res;
  };
})();

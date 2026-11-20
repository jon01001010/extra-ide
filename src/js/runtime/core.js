// Build import object — std builtins get real implementations
//#emit-runtime-begin — up to the matching end marker this is copied verbatim into exported .html/.js files (see _exportRuntime); keep IDE-only code out of it
var _canvas=null,_ctx=null,_curColor='#ffffff',_wasmMem=null,_arrays=[];
var _3d={scene:null,cam:null,renderer:null,objs:[]};
var _phys=null;  // Matter.js state
var _chart=null; // Chart.js state
var _pixi=null;  // PixiJS state
var _cannon=null; // Cannon.js state
var _peer=null;  // PeerJS state
var _keys={};    // keyboard state
var _touch={x:0,y:0,on:0}; // touch state
var _animRunning=false;
var _images=[];  // loaded images
document.addEventListener('keydown',function(e){_keys[e.keyCode]=1});
document.addEventListener('keyup',function(e){_keys[e.keyCode]=0});
document.addEventListener('touchstart',function(e){if(e.touches.length){_touch.x=e.touches[0].clientX;_touch.y=e.touches[0].clientY;_touch.on=1}});
document.addEventListener('touchmove',function(e){if(e.touches.length){_touch.x=e.touches[0].clientX;_touch.y=e.touches[0].clientY}});
document.addEventListener('touchend',function(){_touch.on=0});
document.addEventListener('mousemove',function(e){_touch.x=e.clientX;_touch.y=e.clientY});
document.addEventListener('mousedown',function(){_touch.on=1});
document.addEventListener('mouseup',function(){_touch.on=0});
function _init3d(w,h){
  _3d.scene=new THREE.Scene();
  _3d.scene.background=new THREE.Color(0x111122);
  _3d.cam=new THREE.PerspectiveCamera(60,w/h,0.1,1000);
  _3d.cam.position.set(3,3,3);_3d.cam.lookAt(0,0,0);
  _3d.renderer=new THREE.WebGLRenderer({antialias:true});
  _3d.renderer.setSize(w,h);
  _3d.renderer.domElement.style.cssText='display:block;margin:8px auto;border-radius:6px;max-width:100%;';
  document.getElementById('tab-output').appendChild(_3d.renderer.domElement);
  _3d.objs=[];_3d.controls=null;_3d.shadowsOn=false;
  var amb=new THREE.AmbientLight(0x404040);_3d.scene.add(amb);
  var dl=new THREE.DirectionalLight(0xffffff,0.8);dl.position.set(5,10,5);_3d.scene.add(dl);
}
function _addMesh3d(geom,x,y,z){
  var mat=new THREE.MeshStandardMaterial({color:0x2dd4bf});
  var mesh=new THREE.Mesh(geom,mat);mesh.position.set(x,y,z);
  _3d.scene.add(mesh);var id=_3d.objs.length;_3d.objs.push(mesh);return id;
}
function _chartInit(w,h,type){
  _chart={type:type,labels:[],data:[],colors:[],canvas:null,ctx:null};
  var cv=document.createElement('canvas');cv.width=w;cv.height=h;
  cv.style.cssText='display:block;margin:8px auto;max-width:100%;';
  _chart.canvas=cv;_chart.ctx=cv.getContext('2d');
  document.getElementById('tab-output').appendChild(cv);
}
function _readStr(ptr){if(!_wasmMem)return'[no memory]';var v=new DataView(_wasmMem.buffer);var len=v.getUint32(ptr,true);return new TextDecoder().decode(new Uint8Array(_wasmMem.buffer,ptr+4,len))}
// Scratch region at offset 49152 (48KB). JS-built strings are no longer written here (see _writeBigStr);
// only the "" that _writeStr returns when the string area is exhausted is.
var _strScratchBase=49152,_strScratchSlots=8,_strScratchSize=512,_strScratchIdx=0;
function _writeStr(str){
  if(!_wasmMem)return 0;
  var enc=new TextEncoder().encode(String(str));
  // Every string goes to the string area past the first 64KB page (see "LIFETIME" below): it stays
  // valid for as long as the program can reach it and its space is reused afterwards.
  var big=_writeBigStr(enc);if(big)return big;
  // The area is full of strings that are still in use (or memory cannot grow): never overwrite a
  // live string — report it and hand back "" (a zero length written to the old scratch region).
  _strErrors++;
  if(!_strFailShown){_strFailShown=true;_jsErr('out of string memory','more than '+Math.round((_strLimit-_strHeapBase+65536)/1048576)+' MB of strings are in use at once (strings built during one call are only released when that call returns) — this string is replaced by ""')}
  try{new DataView(_wasmMem.buffer).setUint32(_strScratchBase,0,true)}catch(e){return 0}
  return _strScratchBase;
}
// JS-built strings live in blocks (8-byte aligned: 4-byte length, UTF-8, NUL) in memory grown past
// the first 64KB page, up to _strLimit. A block is never moved and never overwritten while it is
// registered in _strBlocks; _gcCollect() unregisters the blocks the program can no longer reach and
// _strRegap() turns the space between the remaining ones into the gaps new strings are placed in.
// Returns 0 when no gap is large enough (the caller reports it) — there is no wrap-around any more.
function _writeBigStr(enc){
  try{
    var m=_wasmMem;
    if(m!==_strMem)_strReset(m);
    if(!_scRun)_scopeAuto();
    var need=(enc.length+12)&~7,p=0;
    for(;;){
      if(_strPos+need<=_strEnd){p=_strPos;break}
      if(_strGapI>=_strGaps.length)return 0;
      _strPos=_strGaps[_strGapI++];_strEnd=_strGaps[_strGapI++];
    }
    var end=p+need;
    if(end>m.buffer.byteLength)m.grow(Math.ceil((end-m.buffer.byteLength)/65536));
    var view=new DataView(m.buffer);
    view.setUint32(p,enc.length,true);
    new Uint8Array(m.buffer,p+4,enc.length).set(enc);
    view.setUint8(p+4+enc.length,0);
    _strPos=end;_strBlocks.set(p,need);_strLog.push(p);_strLive+=need;_gcNewS+=need;if(end>_strTop)_strTop=end;
    return p;
  }catch(e){return 0}
}
function _need2d(){
  // Lazy-acquire a 2D context on the current canvas. Returns the context, or null if no canvas.
  // This lets WebGL libraries (Babylon/Three/Pixi) claim the canvas first via getCanvas() +
  // their own getContext('webgl'|'webgl2'), and Emit's 2D drawing builtins only create a 2D
  // context when actually called — at which point WebGL is no longer an option, but that's fine
  // because the user already chose 2D by calling rect/circle/text/etc.
  if(_ctx)return _ctx;
  if(!_canvas)return null;
  try{_ctx=_canvas.getContext('2d');if(_ctx){_ctx.fillStyle=_curColor||'#fff';_ctx.strokeStyle=_curColor||'#fff';}}
  catch(e){_ctx=null;}
  return _ctx;
}
// ═══ JS INTEROP — universal dispatch via handle table ═══
// Handles are BigInts: 0 = null/undefined, 1 = window, otherwise _hBase + index, where index is a key of the _handles Map.
// An index is issued once and never reused; the same JS value always gets the same handle while it is live
// (see "LIFETIME" below for when a handle is released).
// _hBase is 2^48 so that an ordinary Emit int (a loop counter, a size) can never be mistaken for a handle.
// Arg buffer at offset 48640: 32 slots × 16 bytes = 512 bytes. Slot layout: [tag:u8][reserved:7][value:f64 OR i64-bits]
// Tags: 0=int (i64; a live handle id is passed as its JS value), 1=num (f64), 2=str (ptr as u32), 3=handle (js-typed values and null), 4=bool, 5=int literal
var _handles=new Map();     // index → JS value (indexes 0 and 1 are never stored: 0 = null, 1 = window)
var _hIds=new Map();        // JS value → index: identity de-duplication (objects by identity, strings/booleans by value)
var _hNext=2;               // next index; monotonic for the whole run, so a released id can never mean another object
var _hWin=null;             // what handle 1 stands for
var _hBase=281474976710656; // 2^48
var _argBufBase=48640;
// ═══ LIFETIME — handles, JS-built strings and Emit arrays are released when the program cannot reach them ═══
// WHAT THE PROGRAM CAN REACH (the roots). A js/str/array value lives in exactly these places:
//   1. a top-level variable — a WASM global. The compiler exports every global as "__g<i>" (and the
//      memory a second time as "__emitGC" to say so; see _emitExportGlobals), so the runtime can read them.
//   2. an element of an Emit array that is itself reachable from 1, 2 or 3.
//   3. an Emit array whose id was handed to JS (an int argument, a callback result, a toJsArray element):
//      JS may give the number back later, so such an array is kept for the rest of the run (_arrEsc).
//      Anything else stored in _arrays under a small index (library objects, arrays not made by newArray)
//      is never released and its elements are roots.
//   4. a local variable or temporary of an invocation that has not returned yet — invisible to the runtime.
// The scan of 1–3 is conservative: ANY number found there that equals a handle id, the address of a string
// block or an Emit array id keeps that thing alive. Ids are chosen so that ordinary numbers do not collide:
// handles start at 2^48, Emit arrays at 2^40 (_aBase), neither is ever reused, strings are addresses ≥ 64KB.
// Because of 4, things are only released at the end of an invocation ("scope"), never while it runs:
//   var t=_scopeEnter(top)  when JS is about to call into the program (frame(), a callback, an entry function)
//   _scopeExit(t)           when that call has COMPLETED — for a call that returns a promise (a suspended
//                           JSPI call) only when the promise settles, not when the call returns it
//   _scopeRun(fn,args,top)  does both around fn.apply(null,args), including the promise case
// At _scopeExit:
//   • no other scope is active → everything not reachable from the roots is released (a full collection;
//     skipped until enough has been created since the last one, see _gcDue).
//   • other scopes are active (an enclosing call further down the stack, or a suspended call) → they may hold
//     anything that existed while they ran. Only what THIS scope created is released, and only if this scope
//     ran synchronously from enter to exit and every scope entered after it has exited; otherwise nothing.
//     A suspended call therefore keeps every handle it could have seen until it completes.
// A call into the program that nobody announced is still safe: the first handle/string/array operation with
// no scope active opens an implicit scope that ends at the next microtask checkpoint, i.e. after the
// synchronous call has returned (_scopeAuto). _scopeEnter() without `top` does the same first, in case it is
// nested in such a call; pass top=true only where the call cannot be nested in program code (the frame loop).
// A promise-returning (suspending) call MUST be announced with _scopeEnter/_scopeExit or _scopeRun.
// If the roots cannot be read (a module without the "__emitGC" export, or no instance in window._wi yet)
// nothing is ever released.
// PARKED SCOPES (await). A call suspended in an `await` (JSPI) keeps its whole WASM stack, which the runtime
// cannot read. So the compiler keeps a SHADOW STACK in every function that can reach an await (see
// _emitAwaitRoots in the compiler; a module that has one exports its memory once more as "__emitSS"): before
// each call that can suspend, the calling frame stores its i32/i64 locals — operand-stack temporaries are moved
// into locals first — at _ssBase+SP…; SP (the u32 at _ssAddr) grows by the frame, and shrinks when the call
// returns. Each call into an async Emit function (_emitEnter with isAsync) is an INVOCATION, _ssInv = {ss0: SP
// when it started, sc: its scope}. When it suspends (__await → _scopePark) its region [ss0, SP) holds exactly
// the frames of its suspended stack: the bytes are copied out (inv.bytes), the values become the scope's roots
// (sc.park), and SP goes back to ss0 for whatever JS runs next. When it resumes (__awaitPost → _scopeResume)
// the bytes are put back at the same place (nothing else runs then: a resumed call starts from a promise job)
// and SP is set to its end minus the awaiting frame (whose size the compiled code put at _ssAddr+4: the frame
// ends with the await, the code after it does not pop it). From _scopePark until _scopeUnpark (the awaited
// promise has settled, before its value gets a handle) the scope is "parked": its frames' values are roots like
// the globals, and it no longer blocks a full collection. A full collection runs when every active scope is parked: at _scopeExit,
// and when a scope parks (so an `await` loop at any call depth releases what it drops).
// Never parked (such a call stays "active, may hold anything" until it completes, as without a shadow stack):
// a module without "__emitSS" (an older build, wasm64), a suspension whose frames did not all fit below 64 KB
// (SP past _ssCap: very deep recursion, or functions with very many locals), an await outside a known invocation.
// _scRun counts the active scopes that are not parked; _scCur is the scope of the Emit code running now
// (set by _scopeRun / _emitCallExport, put back after a suspension by _scopeResume).
var _scN=0,_scRun=0,_scCur=0,_scSeq=0,_scopes=new Map(),_scAutoTok=0; // active scopes: token → {h,s,a: what existed at enter, k: tick, park}
var _ssAddr=53248,_ssBase=53256,_ssCap=12280,_ssInv=null,_ssU32=null; // shadow stack: SP word, first slot, bytes for slots; the running invocation
var _gcTick=0,_gcTickQ=false;                        // _gcTick advances at every microtask checkpoint that follows a _scopeEnter
var _gcNewH=0,_gcNewS=0,_gcNewA=0,_gcScan=0,_gcRuns=0,_gcStale=0,_gcStaleShown=false;
var _strHeapBase=65536;       // first byte of the string area: 65536, or the page after the program's memory regions (imports.heapBase)
var _strMem=null,_strBlocks=new Map(),_strLog=[],_strGaps=[],_strGapI=0,_strPos=65536,_strLimit=33554432,_strEnd=33554432,_strLive=0,_strTop=65536,_strErrors=0,_strFailShown=false;
// Emit arrays made by newArray: id = _aBase + k. _arrMap: k → the array (also mirrored as _arrays[id] for code
// that indexes _arrays directly), _arrEsc: the k that escaped to JS, _arrLog: k in creation order.
var _aBase=1099511627776,_aNext=0,_arrMap=new Map(),_arrEsc=new Set(),_arrLog=[];
function _gcTickBump(){
  _gcTick++;_gcTickQ=false;
  _ssIdle(); /* a microtask: no Emit code is running */
  if(_scAutoTok){var t=_scAutoTok;_scAutoTok=0;_scopeExit(t)}
}
function _scopeEnter(top){
  if(!top&&!_scRun&&!_scAutoTok)_scopeAuto();
  if(!_gcTickQ){_gcTickQ=true;Promise.resolve().then(_gcTickBump)}
  var t=++_scSeq;
  _scopes.set(t,{h:_hNext,s:_strLog.length,a:_arrLog.length,k:_gcTick,park:null});_scN++;_scRun++;
  return t;
}
// Does the running module keep a shadow stack? (asked again until the instance is published in window._wi)
function _ssOn(){
  var m=_wasmMem;if(!m)return false;
  if(m._emitSS!==undefined)return m._emitSS;
  var inst=(typeof window!=='undefined')?window._wi:null;
  if(!inst||!inst.exports||inst.exports.memory!==m)return false;
  return(m._emitSS=!!inst.exports.__emitSS);
}
// SP of the shadow stack: _ssSP() reads it, _ssSP(v) sets it.
function _ssSP(v){
  var buf=_wasmMem.buffer;
  if(!_ssU32||_ssU32.buffer!==buf)_ssU32=new Uint32Array(buf,_ssAddr,1);
  if(v===undefined)return _ssU32[0];
  _ssU32[0]=v>>>0;
}
// No Emit code is running (a promise job): nothing is on the shadow stack.
function _ssIdle(){try{if(_ssOn())_ssSP(0)}catch(e){}}
// The running call is about to suspend in __await (rec = its await ticket). Copy its shadow-stack region out
// and park its scope with those values as roots; in any case remember which scope and invocation it belongs to.
function _scopePark(rec){
  var t=_scCur,sc=_scopes.get(t),inv=_ssInv,roots=null;
  rec.sc=t;rec.inv=inv;_ssInv=null;
  if(inv&&_ssOn()){
    try{
      var sp=_ssSP();
      if(sp<inv.ss0)inv.bad=true; /* SP below where the call started: the region is not its frames */
      inv.len=sp-inv.ss0;inv.top=new Uint32Array(_wasmMem.buffer,_ssAddr+4,1)[0]; /* the awaiting frame's size */
      if(inv.top>inv.len)inv.bad=true;
      inv.bytes=inv.bad?null:new Uint8Array(_wasmMem.buffer.slice(_ssBase+inv.ss0,_ssBase+Math.max(inv.ss0,Math.min(sp,_ssCap))));
      if(!inv.bad&&sp<=_ssCap&&inv.sc===t){
        var dv=new DataView(inv.bytes.buffer);roots=[];
        for(var i=0;i+8<=inv.bytes.length;i+=8)roots.push(Number(dv.getBigInt64(i,true)));
      }
      _ssSP(inv.ss0);
    }catch(e){roots=null;inv.bad=true}
  }
  if(!sc||!roots||sc.park)return;
  sc.park=roots;sc.k=-1;_scRun--;
  if(!_scRun&&_gcDue())_gcCollect(null);
}
// The awaited promise has settled: from here on the call may hold new values again.
function _scopeUnpark(rec){
  _ssIdle(); /* called from the promise job that settles the await: no Emit code is running */
  var sc=_scopes.get(rec.sc);
  if(sc&&sc.park){sc.park=null;_scRun++}
}
// (A call that will never be resumed — the program was stopped — has its scope ended by __await: _scopeExit(rec.sc).)
// First thing a resumed call does (__awaitPost): its scope is current again, its shadow-stack region is back.
function _scopeResume(rec){
  if(!rec)return;
  if(rec.sc)_scCur=rec.sc;
  var inv=rec.inv||null;_ssInv=inv;
  if(inv&&_ssOn()){
    try{
      if(inv.bytes&&inv.bytes.length)new Uint8Array(_wasmMem.buffer,_ssBase+inv.ss0,inv.bytes.length).set(inv.bytes);
      inv.bytes=null;_ssSP(inv.ss0+inv.len-inv.top); /* the awaiting frame is gone: SP as after a returned call */
    }catch(e){inv.bad=true}
  }
}

function _scopeAuto(){if(!_scAutoTok)_scAutoTok=_scopeEnter(true)}
function _scopeExit(t){
  var sc=_scopes.get(t);if(!sc)return;
  _scopes.delete(t);_scN--;
  if(sc.park)sc.park=null;else _scRun--;
  if(_scRun===0){if(_gcDue())_gcCollect(null);return}
  if(sc.k!==_gcTick)return; /* not synchronous: other scopes may have run in between */
  var made=(_hNext-sc.h)+(_arrLog.length-sc.a),madeS=_strLog.length-sc.s;
  if(!made&&!madeS)return;
  var later=false,sameTick=false;
  _scopes.forEach(function(o,k){if(k>t)later=true;if(o.k===_gcTick)sameTick=true});
  if(later)return;
  /* an enclosing synchronous call will collect soon: only bother when this scope itself made a lot */
  if(sameTick&&made<Math.max(256,_gcScan)&&madeS<1024)return;
  _gcCollect(sc);
}
function _scopeRun(fn,args,top,noWait){
  var t=_scopeEnter(top),r,cur=_scCur;
  _scCur=t;
  try{r=args?fn.apply(null,args):fn()}catch(e){_scopeExit(t);throw e}
  finally{_scCur=cur}
  /* noWait: a promise that comes back is just a value (a callback that is not an async Emit function) */
  if(!noWait&&r&&typeof r==='object'&&typeof r.then==='function'){
    if(typeof r.finally==='function')return r.finally(function(){_scopeExit(t)});
    return r.then(function(v){_scopeExit(t);return v},function(e){_scopeExit(t);throw e});
  }
  _scopeExit(t);
  return r;
}
function _gcDue(){
  var n=Math.max(64,_gcScan>>3);
  return _gcNewH>=n||_gcNewA>=n||_gcNewS>=Math.max(16384,_gcScan*64);
}
// The program's WASM globals (WebAssembly.Global objects), or null when they cannot be read.
function _gcGlobals(){
  var m=_wasmMem;if(!m)return null;
  if(m._emitG!==undefined)return m._emitG;
  var inst=(typeof window!=='undefined')?window._wi:null,g=null;
  if(!inst||!inst.exports||inst.exports.memory!==m)return null; /* instance not published yet: ask again later */
  if(inst.exports.__emitGC){
    g=[];
    for(var k in inst.exports)if(/^__g\d+$/.test(k)&&inst.exports[k]&&typeof inst.exports[k]==='object')g.push(inst.exports[k]);
  }
  m._emitG=g;
  return g;
}
// Mark: everything reachable from the roots. Returns {h,s,a} (handle indexes, string addresses, array ids) or null.
function _gcMark(){
  var gl=_gcGlobals();if(!gl)return null;
  var kh=new Set(),ks=new Set(),ka=new Set(),work=[],n=gl.length,i,a;
  function see(x){
    if(typeof x!=='number'){if(typeof x==='bigint')x=Number(x);else return}
    if(x>=_hBase){if(x-_hBase<_hNext)kh.add(x-_hBase)}
    else if(x>=_aBase){var k=x-_aBase;if(!ka.has(k)){var t=_arrMap.get(k);if(t){ka.add(k);work.push(t)}}}
    else if(x>=_strHeapBase){if(_strBlocks.has(x))ks.add(x)}
  }
  for(i=0;i<gl.length;i++){try{see(gl[i].value)}catch(e){return null}}
  _scopes.forEach(function(sc){if(sc.park){n+=sc.park.length;for(var j=0;j<sc.park.length;j++)see(sc.park[j])}});
  _arrEsc.forEach(function(k){see(_aBase+k)});
  for(i=0;i<_arrays.length;i++)if(Array.isArray(_arrays[i]))work.push(_arrays[i]);
  while(work.length){a=work.pop();n+=a.length;for(i=0;i<a.length;i++)see(a[i])}
  _gcScan=n;
  return{h:kh,s:ks,a:ka};
}
function _gcDropH(i){var v=_handles.get(i);if(v!==undefined){_handles.delete(i);if(typeof v!=='number'&&_hIds.get(v)===i)_hIds.delete(v)}}
function _gcDropS(p){var z=_strBlocks.get(p);if(z!==undefined){_strBlocks.delete(p);_strLive-=z}}
function _gcDropA(k){if(_arrMap.has(k)){_arrMap.delete(k);delete _arrays[_aBase+k]}}
// Sweep. sc = null: a full collection. sc = an exiting scope: only what that scope created.
function _gcCollect(sc){
  var k=_gcMark();if(!k)return false;
  var i,keep;
  if(sc){
    for(i=sc.h;i<_hNext;i++)if(!k.h.has(i))_gcDropH(i);
    keep=[];for(i=sc.s;i<_strLog.length;i++){if(k.s.has(_strLog[i]))keep.push(_strLog[i]);else _gcDropS(_strLog[i])}
    _strLog.length=sc.s;for(i=0;i<keep.length;i++)_strLog.push(keep[i]);
    keep=[];for(i=sc.a;i<_arrLog.length;i++){if(k.a.has(_arrLog[i]))keep.push(_arrLog[i]);else _gcDropA(_arrLog[i])}
    _arrLog.length=sc.a;for(i=0;i<keep.length;i++)_arrLog.push(keep[i]);
  }else{
    _handles.forEach(function(v,i){if(!k.h.has(i))_gcDropH(i)});
    _strBlocks.forEach(function(z,p){if(!k.s.has(p))_gcDropS(p)});_strLog.length=0;
    _arrMap.forEach(function(a,id){if(!k.a.has(id))_gcDropA(id)});_arrLog.length=0;
    _scopes.forEach(function(o){o.k=-1;o.s=0;o.a=0}); /* the logs are gone: what is left (parked) never sweeps by scope */
    _gcNewH=0;_gcNewS=0;_gcNewA=0;
  }
  _strRegap();
  _gcRuns++;
  return true;
}
// Free space of the string area = the gaps between the registered blocks, lowest first (flat list: start,end,…).
function _strRegap(){
  var ps=Array.from(_strBlocks.keys()).sort(function(a,b){return a-b}),g=[],at=_strHeapBase;
  for(var i=0;i<ps.length;i++){if(ps[i]>at)g.push(at,ps[i]);at=ps[i]+_strBlocks.get(ps[i])}
  if(at<_strLimit)g.push(at,_strLimit);
  _strGaps=g;_strGapI=0;_strPos=0;_strEnd=0;
}
function _strReset(m){
  _strMem=m||null;_strBlocks=new Map();_strLog=[];_strGaps=[];_strGapI=0;_strPos=_strHeapBase;_strEnd=_strLimit;_strLive=0;_strTop=_strHeapBase;_strErrors=0;_strFailShown=false;
}
// A new run: forget every handle, string block, array record and scope of the previous one.
function _memReset(){
  _handles=new Map();_hIds=new Map();_hNext=2;
  _hWin=typeof window!=='undefined'?window:(typeof globalThis!=='undefined'?globalThis:{});
  _scopes=new Map();_scN=0;_scRun=0;_scCur=0;_scAutoTok=0;
  _ssInv=null;_ssU32=null;
  _traceQ=[];_traceMark=null;_traceDropped=0;_frameCount=0;_frameQuiet=false;
  _gcNewH=0;_gcNewS=0;_gcNewA=0;_gcScan=0;_gcRuns=0;_gcStale=0;_gcStaleShown=false;
  _strReset(null);
  _arrMap=new Map();_arrEsc=new Set();_arrLog=[];_aNext=0;
}
// Emit arrays: newArray (and array literals, which compile to it).
function _arrNew(size){
  if(!_scRun)_scopeAuto();
  var k=_aNext++,a=new Array(Number(size)).fill(0);
  _arrMap.set(k,a);_arrays[_aBase+k]=a;_arrLog.push(k);_gcNewA++;
  return BigInt(_aBase+k);
}
// The array behind an id (undefined if there is none, or it has been released).
function _arrGet(id){var n=Number(id),k=n-_aBase;return k>=0?_arrMap.get(k):_arrays[n]}
// A plain number is about to be handed to JS. If it is the id of an Emit array, JS may hand it back later.
function _arrEscape(n){if(n>=_aBase&&_arrMap.has(n-_aBase))_arrEsc.add(n-_aBase)}
// Counters for tests and diagnostics.
function _memStats(){
  var live=_arrMap.size;for(var i=0;i<_arrays.length;i++)if(_arrays[i]!==undefined&&_arrays[i]!==null)live++;
  return{handles:_handles.size,handleIds:_hNext-2,strBytes:_strLive,strBlocks:_strBlocks.size,strTop:_strTop,strWraps:0,strErrors:_strErrors,arrays:live,arraySlots:_aNext+_arrays.length,arraysEscaped:_arrEsc.size,stale:_gcStale,collections:_gcRuns,scopes:_scN,parked:_scN-_scRun,traceLines:_traceQ.length,traceDropped:_traceDropped,rootsScanned:_gcScan,rootsReadable:!!_gcGlobals()};
}
// A handle id that was issued in this run but has been released: it reads as null, with one red line per run.
function _handleStale(n){
  _gcStale++;
  if(!_gcStaleShown){_gcStaleShown=true;_jsErr('stale js value','a js value was used after it was released (handle '+n+') — it reads as null. Keep js values you need later in a top-level `mut` variable or an Emit array')}
  return null;
}
function _handleFor(v){
  if(v===null||v===undefined)return 0n;
  if(!_scRun)_scopeAuto();
  // Primitives (numbers, strings, booleans) are wrapped in a handle too, so round-trips work.
  // The same object / string / boolean gets the same handle while that handle is live. Numbers are not
  // looked up (they rarely repeat, and it keeps the commonest result cheap): each gets a new handle.
  var i;
  if(typeof v==='number'){i=_hNext++;_handles.set(i,v);_gcNewH++;return BigInt(_hBase+i)}
  i=_hIds.get(v);
  if(i===undefined){i=_hNext++;_handles.set(i,v);_hIds.set(v,i);_gcNewH++}
  return BigInt(_hBase+i);
}
// Number → the live JS value behind that handle id, undefined if it is not a handle id of this run,
// or null if it is one that has been released.
function _handleLive(n){
  var i=n-_hBase;
  if(i>=2&&i<_hNext){
    if(!_scRun)_scopeAuto();
    var v=_handles.get(i);
    if(v!==undefined)return v;
    if(Math.floor(i)===i)return _handleStale(n);
  }
  return undefined;
}
// Lenient read for toStr/toNum/toInt: a handle gives its JS value, 0 gives null, and a plain
// number that is not a handle (e.g. an int callback argument) gives the number itself.
function _handleVal(h){
  if(h===0n||h===0)return null;
  var n=Number(h);
  var v=_handleLive(n);
  if(v===undefined){_arrEscape(n);return n}
  return v;
}
// Implementations of the `js`-type conversion imports (see _JS_CONV_IMPORTS in the compiler).
function _jsIndexKey(k){return(typeof k==='number'||typeof k==='string'||typeof k==='symbol')?k:String(k)}
// Calling a JS function WITHOUT `new` (obj.f(args), f(args), a function value):
//   construct it (as `new` would) when it is a constructor — written with `class`, or its prototype
//   has members of its own / inherits from another class (ES5-style classes such as three.js r128),
//   or a capitalised function whose body assigns to `this` — otherwise call it plainly.
//   String/Number/Boolean/Symbol/BigInt are always plain calls (conversions).
//   A plain call that throws "cannot be invoked without 'new'" is retried as a construction, and a
//   construction that throws "is not a constructor" is retried as a plain call.
function _jsIsCtor(fn,name){
  if(fn===String||fn===Number||fn===Boolean||fn===Symbol||(typeof BigInt!=='undefined'&&fn===BigInt))return false;
  var src='';
  try{src=Function.prototype.toString.call(fn)}catch(e){}
  if(/^class[\s{]/.test(src))return true;
  var p;
  try{p=fn.prototype}catch(e){return false}
  if(!p||typeof p!=='object')return false;
  try{
    var names=Object.getOwnPropertyNames(p);
    if(names.length>1||(names.length===1&&names[0]!=='constructor'))return true;
    if(Object.getOwnPropertySymbols(p).length)return true;
    var pp=Object.getPrototypeOf(p);
    if(pp&&pp!==Object.prototype)return true;
  }catch(e){}
  name=name||fn.name||'';
  var upper=name.length>0&&name[0]===name[0].toUpperCase()&&name[0]!==name[0].toLowerCase();
  return upper&&/\bthis\s*(\.\s*[\w$]+|\[[^\]]*\])\s*=(?!=)/.test(src);
}
function _jsConstruct(fn,args){return new (Function.prototype.bind.apply(fn,[null].concat(args)))()}
function _jsInvoke(fn,thisArg,args,name){
  var triedNew=false;
  if(_jsIsCtor(fn,name)){
    triedNew=true;
    try{return _jsConstruct(fn,args)}
    catch(e){if(_errMsg(e).indexOf('is not a constructor')<0)throw e}
  }
  try{return fn.apply(thisArg,args)}
  catch(e){
    var msg=_errMsg(e);
    if(!triedNew&&(msg.indexOf("without 'new'")>=0||msg.indexOf('without new')>=0||msg.indexOf('cannot be invoked')>=0||msg.indexOf('Illegal constructor')>=0||msg.indexOf("requires 'new'")>=0))return _jsConstruct(fn,args);
    throw e;
  }
}
// The "→ call(args)" / "[click 1]" trace lines: only the newest _traceMax stay in the Output tab (one
// "→ … N earlier trace lines dropped" line marks the cut; program output is never touched), and none are
// created at all where the page hides them (an exported program without ?trace / {trace:true}).
var _traceMax=300,_traceQ=[],_traceMark=null,_traceDropped=0,_logMax=2000;
// Animation frames repeat the same calls, so only the first _frameTraceMax frames are traced; after that
// frame() runs with tracing off (no trace nodes, no argument summaries) and one note says so.
var _frameCount=0,_frameQuiet=false,_frameTraceMax=3;
function _traceOn(){try{if(_frameQuiet)return false;var out=document.getElementById('tab-output');return !!out&&!out._emitQuiet}catch(e){return false}}
function _traceAdd(node){
  if(_frameQuiet)return;
  var out=document.getElementById('tab-output');
  if(!out||out._emitQuiet)return;
  out.appendChild(node);_traceQ.push(node);
  if(_traceQ.length<=_traceMax)return;
  var old=_traceQ.shift();_traceDropped++;
  if(!_traceMark||_traceMark.parentNode!==out){
    _traceMark=document.createElement('div');
    _traceMark.style.cssText='color:#64748b;padding:2px 12px;font-family:var(--mono);font-size:10px;';
    if(old.parentNode===out)out.insertBefore(_traceMark,old);else out.insertBefore(_traceMark,out.firstChild);
  }
  if(old.parentNode)old.parentNode.removeChild(old);
  _traceMark.textContent='→ … '+_traceDropped+' earlier trace lines dropped';
}
// Short text for one traced argument. Library objects are named by their class ([Mesh], [HTMLCanvasElement])
// and never serialised: JSON.stringify would run their toJSON (three.js serialises the whole scene).
// Plain {} objects and arrays are shown one level deep.
function _traceVal(a,deep){
  try{
    if(a===null||a===undefined)return String(a);
    var t=typeof a;
    if(t==='string')return deep?JSON.stringify(a.length>40?a.substring(0,40)+'\u2026':a):a;
    if(t==='function')return '[fn'+(a.name?' '+a.name:'')+']';
    if(t!=='object')return String(a);
    if(Array.isArray(a)){
      if(deep)return '[Array('+a.length+')]';
      return '['+a.slice(0,8).map(function(v){return _traceVal(v,true)}).join(',')+(a.length>8?',\u2026 '+a.length+' items':'')+']';
    }
    var proto=Object.getPrototypeOf(a);
    if(proto===Object.prototype||proto===null){
      if(deep)return '{\u2026}';
      var ks=Object.keys(a);
      return '{'+ks.slice(0,8).map(function(k){return k+':'+_traceVal(a[k],true)}).join(', ')+(ks.length>8?', \u2026 '+ks.length+' keys':'')+'}';
    }
    // Minified libraries have meaningless class names (qn, Wn); many objects carry a readable `type` (three.js: "Mesh")
    var cn=a.constructor&&a.constructor.name,ty=null;
    try{if(typeof a.type==='string'&&/^[A-Za-z][A-Za-z0-9_.]{1,39}$/.test(a.type))ty=a.type}catch(e){}
    if(ty&&(!cn||cn.length<=3))return '['+ty+']';
    return '['+((cn&&cn.length>3)?cn:(ty||'object'))+']';
  }catch(e){return '[obj]'}
}
function _jsArgTrace(label,args){
  if(!_traceOn())return;
  try{
    var dbg=document.createElement('div');
    dbg.style.cssText='color:#94a3b8;padding:2px 12px;font-family:var(--mono);font-size:10px;white-space:pre-wrap;word-break:break-all;';
    dbg.textContent='→ '+label+'('+args.map(function(a){
      if(a===null||a===undefined)return String(a);
      if(typeof a==='object'||typeof a==='function')return _traceVal(a);
      return String(a);
    }).join(', ')+')';
    _traceAdd(dbg);
  }catch(e){}
}
// Imports for calls that are not member calls, JS literals and string `+` (see _JS_CONV_IMPORTS).
function _jsCallImport(name,outputLog){
  function readArgs(nArgs){var n=Number(nArgs),args=[];for(var i=0;i<n;i++)args.push(_readArg(i));return args}
  function logCall(fn,args){try{_log(outputLog,fn,args)}catch(e){}}
  switch(name){
    case'__jsCallG':return function(namePtr,nArgs,flags){
      /* name(args) → window.name(args) */
      var fname=_readStr(namePtr),args=readArgs(nArgs);
      if(!(typeof _jsQuiet==='object'&&_jsQuiet[fname])){logCall(fname,args);_jsArgTrace(fname,args)}   /* _jsQuiet: see MOTE (runtime half) */
      var jsFn;
      try{jsFn=window[_ncProp(window,fname)]}catch(e){if(e&&e._ncAmb){_jsErr(fname+'()',e);return 0n}}
      if(typeof jsFn!=='function'){
        if(_tryMode&&_tryRecord(new TypeError(fname+' is not a function'+(jsFn===undefined?' (window.'+fname+' is not defined)':''))))return 0n;
        /* JS function not available — show a visible warning so silent failures stop happening */
        try{
          var w=document.createElement('div');
          w.style.cssText='color:#fbbf24;padding:2px 12px;font-family:var(--mono);font-size:12px;';
          w.textContent='⚠ '+fname+'(...) — window.'+fname+' is '+(jsFn===undefined?'not loaded':typeof jsFn)+'. CDN may have failed.';
          document.getElementById('tab-output').appendChild(w);
          console.warn('Auto-bridge: window.'+fname+' is not a function ('+typeof jsFn+'). Library not loaded?');
        }catch(e){}
        return 0n;
      }
      var ret;
      try{ret=_jsInvoke(jsFn,window,args,fname)}
      catch(e){logCall(fname+' ERROR',[_errMsg(e)]);_jsErr(fname+'()',e);return 0n}
      if((Number(flags)&1)&&ret!==undefined&&ret!==null&&typeof ret!=='object'&&typeof ret!=='function'){
        /* Show primitive results of a bare call in the output panel (preserves v1.x behavior) */
        try{
          var d=document.createElement('div');
          d.style.cssText='font-family:var(--mono);font-size:13px;padding:2px 12px;color:#38bdf8;';
          d.textContent='< '+String(ret);
          document.getElementById('tab-output').appendChild(d);
        }catch(e){}
      }
      return _js_returnWrap(ret);
    };
    case'__jsCallV':return function(fnH,labelPtr,nArgs){
      /* f(args) — f is a JS function held in a variable or produced by an expression */
      var label=_readStr(labelPtr),fn=_handleGet(fnH),args=readArgs(nArgs);
      logCall(label,args);
      _jsArgTrace(label,args);
      if(typeof fn!=='function'){_jsErr(label+'()','is not a function (it is '+(fn===null||fn===undefined?'null':typeof fn)+')');return 0n}
      try{return _js_returnWrap(_jsInvoke(fn,undefined,args,''))}
      catch(e){_jsErr(label+'()',e);return 0n}
    };
    case'__jsArr':return function(h,nArgs){
      var arr=(h===0n)?[]:_handleGet(h),args=readArgs(nArgs);
      for(var i=0;i<args.length;i++)arr.push(args[i]);
      return(h===0n)?_handleFor(arr):h;
    };
    case'__jsObj':return function(h,nPairs){
      var o=(h===0n)?{}:_handleGet(h),n=Number(nPairs);
      for(var i=0;i<n;i++)o[_readArg(i*2)]=_readArg(i*2+1);
      return(h===0n)?_handleFor(o):h;
    };
    case'__strCat':return function(a,b){return _writeStr(_readStr(a)+_readStr(b))};
    case'__strOfInt':return function(x){var v=_handleLive(Number(x));return _writeStr(v===undefined?x.toString():String(v))};
    case'__strOfNum':return function(x){return _writeStr(String(x))};
    case'__strOfBool':return function(b){return _writeStr(b?'true':'false')};
  }
  return null;
}
function _jsExtraImport(name){
  switch(name){
    case'__jsInt':return function(h){var n=Number(_handleVal(h));return isFinite(n)?BigInt(Math.trunc(n)):0n};
    case'__jsIntH':return function(h){
      var v=_handleLive(Number(h));
      if(typeof v==='number')return isFinite(v)?BigInt(Math.trunc(v)):0n;
      if(typeof v==='boolean')return v?1n:0n;
      if(typeof v==='bigint')return BigInt.asIntN(64,v);
      return h;
    };
    case'__jsCmpNum':return function(h){
      var v=_handleVal(h);
      if(v===null||v===undefined)return 0;
      return(typeof v==='number'||typeof v==='boolean'||typeof v==='bigint')?Number(v):(typeof v==='string'&&v.trim()!=='')?Number(v):NaN;
    };
    case'__jsSame':return function(a,b){return _handleVal(a)===_handleVal(b)?1:0};
    case'__jsEqStr':return function(a,ptr){return _handleVal(a)===_readStr(ptr)?1:0};
    case'__jsStrEq':return function(a,b){return(a===b||_readStr(a)===_readStr(b))?1:0};
    case'__jsFromStr':return function(ptr){return _handleFor(_readStr(ptr))};
    case'__jsFromNum':return function(n){return _handleFor(n)};
    case'__jsFromBool':return function(b){return _handleFor(!!b)};
    case'__jsIdx':return function(h){
      var recv=_handleVal(h),k=_readArg(0);
      if(recv===null||recv===undefined){_jsErr('['+String(k)+']','cannot index null');return 0n}
      try{return _js_returnWrap(recv[_jsIndexKey(k)])}catch(e){_jsErr('['+String(k)+']',e);return 0n}
    };
    case'__jsIdxSet':return function(h){
      var recv=_handleVal(h),k=_readArg(0),v=_readArg(1);
      if(recv===null||recv===undefined){_jsErr('['+String(k)+'] = …','cannot index null');return}
      try{recv[_jsIndexKey(k)]=v}catch(e){_jsErr('['+String(k)+'] = …',e)}
    };
  }
  return null;
}
// A promise rejected with nobody listening (no .catch) while a program is loaded: show it in the
// Output tab like every other JS-side error instead of only in the browser console.
if(typeof window!=='undefined'&&window.addEventListener){
  window.addEventListener('unhandledrejection',function(ev){
    if(!_wasmMem)return;
    _jsErr('unhandled promise rejection',ev&&ev.reason);
    try{ev.preventDefault()}catch(e){} /* reported above; keep the console clean */
  });
}
function _handleGet(h){
  if(h===0n||h===0)return null;
  var idx=Number(h);
  if(idx===1)return _hWin;
  idx-=_hBase;
  if(idx<2||idx>=_hNext)return null;
  if(!_scRun)_scopeAuto();
  var v=_handles.get(idx);
  return v===undefined?_handleStale(idx+_hBase):v;
}
function _readArg(slot){
  // Read one arg from the arg buffer. Returns the real JS value.
  // Tag 0 (int) values are ambiguous — they might be raw integers OR handles.
  // Policy: if the value is a live handle (ids start at _hBase = 2^48), use the handle's contents.
  // Otherwise treat as a plain number. This is what enables `cv` (a handle) to be
  // passed transparently into `BABYLON.Engine(cv, true)`.
  var off=_argBufBase+slot*16;
  var view=new DataView(_wasmMem.buffer);
  var tag=view.getUint8(off);
  switch(tag){
    case 0:{ // int — could be raw number or handle ID
      var lo=view.getUint32(off+8,true),hi=view.getInt32(off+12,true);
      var bh=(BigInt(hi)<<32n)|BigInt(lo);
      var n=Number(bh);
      var hv=_handleLive(n);
      if(hv!==undefined)return hv;
      _arrEscape(n);
      return n;
    }
    case 1: return view.getFloat64(off+8,true);
    case 2: return _readStr(view.getUint32(off+8,true));
    case 3:{ // handle: `null` and js-typed values (0 = null; a plain int stored in a js variable stays a number)
      var lo=view.getUint32(off+8,true),hi=view.getInt32(off+12,true);
      var bh=(BigInt(hi)<<32n)|BigInt(lo);
      return _handleVal(bh);
    }
    case 4: return view.getUint8(off+8)!==0;
    case 5:{ // raw int literal — never a handle
      var lo=view.getUint32(off+8,true),hi=view.getInt32(off+12,true);
      var lit=Number((BigInt(hi)<<32n)|BigInt(lo));
      _arrEscape(lit);
      return lit;
    }
    default: return null;
  }
}
function _js_returnWrap(v){
  if(v===null||v===undefined)return 0n;
  if(typeof v==='number'){
    // Keep primitive numbers as handles (loose typing per C spec)
    return _handleFor(v);
  }
  if(typeof v==='bigint')return _handleFor(Number(v));
  if(typeof v==='boolean')return _handleFor(v);
  if(typeof v==='string')return _handleFor(v);
  return _handleFor(v);
}
// Red, readable error line in the Output tab for anything that goes wrong on the JS side.
function _errMsg(e){return(e&&e.message!==undefined&&e.message!==null)?String(e.message):String(e)}
function _jsErr(what,e){
  var msg=_errMsg(e);
  try{
    var w=document.createElement('div');
    w.style.cssText='color:#ef4444;padding:2px 12px;font-family:var(--mono);font-size:11px;';
    w.textContent='✗ '+what+': '+msg;
    document.getElementById('tab-output').appendChild(w);
  }catch(e2){}
  try{console.warn('Emit JS interop: '+what+': '+msg)}catch(e3){}
}
// Case-insensitive JS names: see CASE-INSENSITIVE NAMES in the compiler
var _ncPropCache=null,_ncProp=function(o,n){return n},_ncExport=function(i,n){return n};
//#emit-nocase-begin — up to the matching end marker: only in exported programs that use JS interop (see _exportRuntime)
_ncPropCache=typeof WeakMap==='function'?new WeakMap():null;
_ncProp=function(o,name){
  if(o===null||o===undefined||typeof name!=='string'||name==='')return name;
  var O=(typeof o==='object'||typeof o==='function')?o:Object(o);
  try{if(name in O)return name}catch(e){return name}
  var c=_ncPropCache&&O===o?_ncPropCache.get(O):null,hit=c?c[name]:undefined;
  if(hit!==undefined){try{if(hit in O)return hit}catch(e){}}
  var k=name.toLowerCase(),found=[],seen=Object.create(null);
  for(var p=O,depth=0;p&&depth<64;p=Object.getPrototypeOf(p),depth++){
    var ns;try{ns=Object.getOwnPropertyNames(p)}catch(e){break}
    for(var i=0;i<ns.length;i++){var n=ns[i];if(!seen[n]&&n.length===name.length&&n.toLowerCase()===k){seen[n]=1;found.push(n)}}
  }
  if(found.length===1){
    if(_ncPropCache&&O===o){if(!c){c=Object.create(null);try{_ncPropCache.set(O,c)}catch(e){}}c[name]=found[0]}
    return found[0];
  }
  if(found.length>1){
    var err=new Error('"'+name+'" is ambiguous: this JavaScript object has '+found.length+' properties that differ only by case ('+found.join(', ')+') — Emit names are case-insensitive, so write one of them exactly');
    err._ncAmb=true;throw err;
  }
  return name;
};
_ncExport=function(inst,name){
  var E=inst&&inst.exports;
  if(!E||typeof name!=='string'||typeof E[name]==='function')return name;
  var k=name.toLowerCase(),ks=Object.keys(E);
  for(var i=0;i<ks.length;i++)if(ks[i].toLowerCase()===k&&typeof E[ks[i]]==='function')return ks[i];
  return name;
};
//#emit-nocase-end
// ── Callbacks: fnRef(fn) → a JS function that calls back into Emit ──
// The compiler turns fnRef(name) into fnRef("@cb:<table index>:<param types>:<return type>:<name>").
// JS arguments are marshalled by the DECLARED parameter types of the Emit function:
//   int  → a JS number arrives as that integer; any other value (object, string, function…) as a handle
//   js   → always a handle, whatever the value is (number, string, object…); null/undefined → 0
//   num  → Number(arg)        str → the string, copied into WASM memory        bool → truthiness
// Missing arguments arrive as 0 / "" / false; extra arguments are dropped. The return value goes
// back by the declared return type (an int that is a live handle is returned as the JS value).
var _cbTable=null;
function _cbArg(a,t){
  if(t==='js')return _handleFor(a);
  if(t==='num'||t==='f64'||t==='f32')return(a===null||a===undefined)?0:Number(a);
  if(t==='str')return _writeStr((a===null||a===undefined)?'':String(a));
  if(t==='bool'||t==='i32')return a?1:0;
  if(typeof a==='number')return Number.isFinite(a)?BigInt(Math.trunc(a)):0n;
  if(typeof a==='bigint')return BigInt.asIntN(64,a);
  if(typeof a==='boolean')return a?1n:0n;
  return _handleFor(a);
}
function _cbRet(v,t){
  if(t==='void'||v===undefined)return undefined;
  if(t==='js')return _handleVal(v);
  if(t==='str')return _readStr(v);
  if(t==='bool'||t==='i32')return !!v;
  if(t==='num'||t==='f64'||t==='f32')return v;
  var n=Number(v),hv=_handleLive(n);
  if(hv===undefined){_arrEscape(n);return n}
  return hv;
}
function _makeCallback(spec){
  var name=spec,idx=-1,ptypes=null,ret='void';
  if(spec.indexOf('@cb:')===0){
    var parts=spec.split(':');
    idx=Number(parts[1]);ptypes=parts[2]?parts[2].split(','):[];ret=parts[3];name=parts.slice(4).join(':');
  }
  var tbl=_cbTable,mem=_wasmMem;
  var wrapper=function(){
    if(mem!==_wasmMem)return; /* callback left over from an earlier run — ignore */
    /* one scope per callback: its arguments, and what the Emit function creates, are released when it returns */
    return _scopeRun(invoke,arguments,false,!_emitIsAsync(name));
  };
  var invoke=function(){
    var fn=null,args=[];
    if(idx>=0&&tbl){
      try{fn=tbl.get(idx)}catch(e){}
      for(var i=0;i<ptypes.length;i++)args.push(_cbArg(arguments[i],ptypes[i]));
    }else if(window._wi&&typeof window._wi.exports[_ncExport(window._wi,name)]==='function'){
      /* Dynamic name (not known at compile time): must be an exported fn; args are marshalled by JS type */
      fn=window._wi.exports[_ncExport(window._wi,name)];
      for(var k=0;k<Math.min(arguments.length,fn.length);k++){
        var a=arguments[k];
        if(typeof a==='number')args.push(Number.isInteger(a)?BigInt(a):a);
        else if(typeof a==='string')args.push(_writeStr(a));
        else if(typeof a==='boolean')args.push(a?1:0);
        else args.push(_handleFor(a));
      }
    }
    if(typeof fn!=='function'){_jsErr('callback '+name+'()','no Emit function with that name');return}
    return _emitCallback(fn,args,ret,name);
  };
  wrapper._emitFnName=name;
  wrapper.toString=function(){return'fnRef('+name+')'};
  return wrapper;
}
function _resetJsInterop(){
  // Called at the start of each run so handles don't leak across runs
  _memReset();
}
function _log(outputLog,fn,args){if(fn&&fn.charCodeAt(0)===95&&fn.charCodeAt(1)===95)return; /* internal __js… helpers are not listed under Results: the trace lines below show those calls readably */ if(outputLog.length>=_logMax)outputLog.splice(0,_logMax>>1); /* the import log keeps the newest calls only */ outputLog.push({fn:fn,mod:'std',args:args.map(function(a){return typeof a==='bigint'?a.toString():String(a)})})}
function buildImportObject(imports,outputLog){
  const obj={};_canvas=null;_ctx=null;_curColor='#ffffff';_arrays=[];_3d={scene:null,cam:null,renderer:null,objs:[]};_phys=null;_chart=null;_pixi=null;_cannon=null;_peer=null;_animRunning=false;_images=[];var _strWritePtr=4096;
  _memReset(); /* handles, strings, array records and scopes of an earlier run (also done by _resetJsInterop) */
  /* Callback table — the WASM module fills it with its functions (see cbElemSection) */
  _cbTable=null;try{_cbTable=new WebAssembly.Table({initial:Math.max(1,imports.cbCount||1),element:'anyfunc'})}catch(e){}
  obj.__cb__={table:_cbTable};
  for(const imp of imports){
    if(!obj[imp.module])obj[imp.module]={};
    if(imp.module==='std'){
      var s=obj.std;
      switch(imp.name){
        // I/O
        case'print':s.print=function(x){var v=typeof x==='bigint'?x.toString():String(x);_log(outputLog,'print',[x]);var d=document.createElement('div');d.style.cssText='font-family:var(--mono);font-size:13px;padding:2px 12px;color:#4ade80;';d.textContent='> '+v;document.getElementById('tab-output').appendChild(d)};break;
        case'printNum':s.printNum=function(x){_log(outputLog,'printNum',[x]);var d=document.createElement('div');d.style.cssText='font-family:var(--mono);font-size:13px;padding:2px 12px;color:#4ade80;';d.textContent='> '+String(x);document.getElementById('tab-output').appendChild(d)};break;
        case'printStr':s.printStr=function(ptr){var str=_readStr(ptr);_log(outputLog,'printStr',[str]);var d=document.createElement('div');d.style.cssText='font-family:var(--mono);font-size:13px;padding:2px 12px;color:#4ade80;';d.textContent='> '+str;document.getElementById('tab-output').appendChild(d)};break;
        case'log':s.log=function(x){_log(outputLog,'log',[x])};break;
        case'alert':s.alert=function(ptr){var str=_readStr(ptr);_log(outputLog,'alert',[str]);window.alert(str)};break;
        // Math
        case'abs':s.abs=function(x){return x<0n?-x:x};break;
        case'min':s.min=function(a,b){return a<b?a:b};break;
        case'max':s.max=function(a,b){return a>b?a:b};break;
        case'sqrt':s.sqrt=function(x){return Math.sqrt(x)};break;
        case'sin':s.sin=function(x){return Math.sin(x)};break;
        case'cos':s.cos=function(x){return Math.cos(x)};break;
        case'pow':s.pow=function(b,e){return Math.pow(b,e)};break;
        case'floor':s.floor=function(x){return BigInt(Math.floor(x))};break;
        case'random':s.random=function(){return Math.random()};break;
        // Time
        case'now':s.now=function(){return BigInt(Date.now())};break;
        case'sleep':s.sleep=function(){};break;
        // Canvas
        case'canvas':s.canvas=function(w,h){
          _canvas=document.createElement('canvas');
          _canvas.width=Number(w);_canvas.height=Number(h);
          _canvas.style.cssText='display:block;margin:8px auto;border:1px solid #1a1d2a;border-radius:6px;max-width:100%;background:#000;';
          // Don't acquire 2d context yet — WebGL libs (Babylon/Three/Pixi) need a fresh canvas.
          // _ctx is lazy-initialized by _need2d() when a 2D drawing op is called.
          _ctx=null;
          var out=document.getElementById('tab-output');out.appendChild(_canvas);
        };break;
        case'color':s.color=function(r,g,b){
          _curColor='rgb('+Number(r)+','+Number(g)+','+Number(b)+')';
          var c=_need2d();if(c){c.fillStyle=_curColor;c.strokeStyle=_curColor}
        };break;
        case'rect':s.rect=function(x,y,w,h){var c=_need2d();if(c)c.fillRect(Number(x),Number(y),Number(w),Number(h))};break;
        case'strokeRect':s.strokeRect=function(x,y,w,h){var c=_need2d();if(c)c.strokeRect(Number(x),Number(y),Number(w),Number(h))};break;
        case'circle':s.circle=function(x,y,r){var c=_need2d();if(c){c.beginPath();c.arc(Number(x),Number(y),Number(r),0,Math.PI*2);c.fill()}};break;
        case'line':s.line=function(x1,y1,x2,y2){var c=_need2d();if(c){c.beginPath();c.moveTo(Number(x1),Number(y1));c.lineTo(Number(x2),Number(y2));c.stroke()}};break;
        case'clear':s.clear=function(){var c=_need2d();if(c)c.clearRect(0,0,_canvas.width,_canvas.height)};break;
        case'alpha':s.alpha=function(a){var c=_need2d();if(c)c.globalAlpha=a};break;
        case'lineWidth':s.lineWidth=function(w){var c=_need2d();if(c)c.lineWidth=Number(w)};break;
        case'text':s.text=function(ptr,x,y,sz){var c=_need2d();if(c){var str=_readStr(ptr);c.font=Number(sz)+'px monospace';c.fillText(str,Number(x),Number(y))}};break;
        case'pixel':s.pixel=function(x,y){var c=_need2d();if(c)c.fillRect(Number(x),Number(y),1,1)};break;
        case'getCanvas':s.getCanvas=function(){return _canvas?_handleFor(_canvas):0n};break;
        case'emptyObj':s.emptyObj=function(){return _handleFor({})};break;
        case'wrapShape':s.wrapShape=function(h){var sh=_handleGet(h);return _handleFor({0:sh,length:1})};break;
        case'textShape':s.textShape=function(textPtr,colorPtr,scalar){
          /* Build a canvas-confetti compatible bitmap shape from text.
           * Prefer the library's own shapeFromText (returns an ImageBitmap, which
           * is transferable to confetti's web worker). Fall back to a canvas-based
           * polyfill only if the library isn't loaded or the helper is missing. */
          var text=_readStr(textPtr);
          var color=_readStr(colorPtr)||'#000000';
          var sc=Number(scalar)||1;
          if(typeof window!=='undefined'&&window.confetti&&typeof window.confetti.shapeFromText==='function'){
            try{
              var shp=window.confetti.shapeFromText({text:text,scalar:sc,color:color});
              return _handleFor(shp);
            }catch(e){/* fall through to polyfill */}
          }
          /* Polyfill — used only if canvas-confetti isn't available. Note: this
           * shape uses an HTMLCanvasElement which won't transfer to a worker. */
          var fontFamily='"Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol","Noto Color Emoji","EmojiOne Color","Android Emoji","Twemoji Mozilla","system emoji",sans-serif';
          var fontSize=10*sc;
          var font=fontSize+'px '+fontFamily;
          var mc=document.createElement('canvas');
          var mctx=mc.getContext('2d');
          mctx.font=font;
          var size=mctx.measureText(text);
          var aLeft=size.actualBoundingBoxLeft||fontSize*0.1;
          var aRight=size.actualBoundingBoxRight||fontSize;
          var aAsc=size.actualBoundingBoxAscent||fontSize*0.8;
          var aDesc=size.actualBoundingBoxDescent||fontSize*0.2;
          var width=Math.ceil(aRight+aLeft);
          var height=Math.ceil(aAsc+aDesc);
          var padding=2;
          var x=aLeft+padding,y=aAsc+padding;
          width+=padding*2;height+=padding*2;
          var rc=document.createElement('canvas');
          rc.width=Math.max(width,1);rc.height=Math.max(height,1);
          var rctx=rc.getContext('2d');
          rctx.font=font;rctx.fillStyle=color;
          rctx.fillText(text,x,y);
          var scaleM=1/sc;
          return _handleFor({
            type:'bitmap',
            bitmap:rc,
            matrix:[scaleM,0,0,scaleM,-width*scaleM/2,-height*scaleM/2]
          });
        };break;
        case'fnRef':s.fnRef=function(namePtr){
          /* The string is a callback descriptor written by the compiler (or a plain export name) */
          return _handleFor(_makeCallback(_readStr(namePtr)));
        };break;
        case'toJsArray':s.toJsArray=function(arrH){var a=_arrays[Number(arrH)];if(!a)return 0n;var jsArr=[];for(var i=0;i<a.length;i++){var v=a[i];/* If element is a bigint or int, try unwrapping (handle/string-ptr/number) */ var n=null;if(typeof v==='bigint')n=Number(v);else if(typeof v==='number'&&Number.isInteger(v))n=v;if(n!==null){/* Handle table lookup first (object refs) */ var _hv=_handleLive(n);if(_hv!==undefined){jsArr.push(_hv);continue}/* String pointer range — read as string from WASM memory */ if(n>=1024&&n<48640&&_wasmMem){try{var view=new DataView(_wasmMem.buffer);var len=view.getUint32(n,true);if(len<10000){jsArr.push(new TextDecoder().decode(new Uint8Array(_wasmMem.buffer,n+4,len)));continue}}catch(e){}}jsArr.push(n);continue}jsArr.push(v)}return _handleFor(jsArr)};break;
        case'toStr':s.toStr=function(h){var v=_handleVal(h);return _writeStr(v==null?'':String(v))};break;
        case'toNum':s.toNum=function(h){var v=_handleVal(h);var n=Number(v);return isFinite(n)?n:0};break;
        case'toInt':s.toInt=function(h){var n=Number(_handleVal(h));return isFinite(n)?BigInt(Math.trunc(n)):0n};break;
        /* Null / type checks. Handle 0 is both null and undefined (they are not distinguished). */
        case'isNull':s.isNull=function(h){return(h===0n||h===0)?1:0};break;
        case'typeOf':s.typeOf=function(h){var v=_handleVal(h);return _writeStr(v===null?'null':Array.isArray(v)?'array':typeof v)};break;
        /* Iterating JS arrays / objects */
        case'jsLen':s.jsLen=function(h){var v=_handleGet(h);if(v===null||v===undefined)return 0n;var n=typeof v.length==='number'?v.length:typeof v.size==='number'?v.size:0;return BigInt(Math.trunc(n)||0)};break;
        case'jsAt':s.jsAt=function(h,i){var v=_handleGet(h);if(v===null||v===undefined){_jsErr('jsAt('+i+')','value is null');return 0n}try{return _js_returnWrap(v[Number(i)])}catch(e){_jsErr('jsAt('+i+')',e);return 0n}};break;
        case'jsGet':s.jsGet=function(h,keyPtr){var key=_readStr(keyPtr);var v=_handleGet(h);if(v===null||v===undefined){_jsErr('jsGet("'+key+'")','value is null');return 0n}try{return _js_returnWrap(v[key])}catch(e){_jsErr('jsGet("'+key+'")',e);return 0n}};break;
        case'jsKeys':s.jsKeys=function(h){var v=_handleGet(h);try{return _handleFor((v===null||v===undefined)?[]:Object.keys(v))}catch(e){_jsErr('jsKeys()',e);return 0n}};break;
        // DOM
        case'button':s.button=function(ptr,id){
          var str=_readStr(ptr);var btn=document.createElement('button');
          btn.textContent=str;btn.id='emit-el-'+Number(id);
          btn.style.cssText='font-family:var(--mono);font-size:13px;padding:8px 16px;margin:4px;border-radius:6px;border:1px solid #334155;background:#1f2333;color:#d4d8e3;cursor:pointer;';
          btn.addEventListener('click',function(){
            var dbg=document.createElement('div');
            dbg.style.cssText='color:#fbbf24;padding:2px 12px;font-family:var(--mono);font-size:11px;';
            dbg.textContent='[click '+Number(id)+'] start';
            _traceAdd(dbg);
            if(!window._wi){console.warn('button: no instance yet');dbg.textContent+=' — no instance';return}
            var fn=window._wi.exports['onclick_'+Number(id)];
            if(!fn){console.warn('button: onclick_'+Number(id)+' not exported');dbg.textContent+=' — fn missing';return}
            dbg.textContent+=' — calling fn';
            try{var rv=_emitCallExport(window._wi,'onclick_'+Number(id),[]);dbg.textContent+=' — done. ret='+String(rv)}catch(e){
              console.error('onclick_'+Number(id)+' failed:',e);
              var d=document.createElement('div');
              d.style.cssText='color:#ef4444;padding:2px 12px;font-family:var(--mono);font-size:12px;';
              d.textContent='✗ onclick_'+Number(id)+': '+e.message;
              document.getElementById('tab-output').appendChild(d);
            }
          });
          document.getElementById('tab-output').appendChild(btn);
        };break;
        case'input':s.input=function(ptr,id){
          var str=_readStr(ptr);var inp=document.createElement('input');
          inp.placeholder=str;inp.id='emit-el-'+Number(id);
          inp.style.cssText='font-family:var(--mono);font-size:13px;padding:8px 12px;margin:4px;border-radius:6px;border:1px solid #334155;background:#0f1118;color:#d4d8e3;width:200px;';
          document.getElementById('tab-output').appendChild(inp);
        };break;
        case'getInput':s.getInput=function(id){
          var el=document.getElementById('emit-el-'+Number(id));
          if(!el)return 0;var val=parseInt(el.value)||0;return BigInt(val);
        };break;
        case'setText':s.setText=function(id,ptr){
          var str=_readStr(ptr);var el=document.getElementById('emit-el-'+Number(id));
          if(el){if(el.tagName==='INPUT')el.value=str;else el.textContent=str}
        };break;
        case'div':s.div=function(ptr){
          var str=_readStr(ptr);var d=document.createElement('div');
          d.textContent=str;d.style.cssText='font-family:var(--mono);font-size:13px;padding:6px 12px;margin:4px;color:#d4d8e3;';
          document.getElementById('tab-output').appendChild(d);
        };break;
        // Arrays — JS arrays stored by id (see _arrNew / _arrGet)
        case'newArray':s.newArray=function(size){return _arrNew(size)};break;
        case'getItem':s.getItem=function(arr,idx){var a=_arrGet(arr);if(!a)return 0n;return BigInt(a[Number(idx)]||0)};break;
        case'setItem':s.setItem=function(arr,idx,val){var a=_arrGet(arr);if(a)a[Number(idx)]=Number(val)};break;
        case'getNumItem':s.getNumItem=function(arr,idx){var a=_arrGet(arr);if(!a)return 0;return a[Number(idx)]||0};break;
        case'setNumItem':s.setNumItem=function(arr,idx,val){var a=_arrGet(arr);if(a)a[Number(idx)]=val};break;
        case'push':s.push=function(arr,val){var a=_arrGet(arr);if(a)a.push(Number(val))};break;
        case'pop':s.pop=function(arr){var a=_arrGet(arr);if(!a||!a.length)return 0n;return BigInt(a.pop())};break;
        case'arrayLen':s.arrayLen=function(arr){var a=_arrGet(arr);return BigInt(a?a.length:0)};break;
        // 3D (Three.js — loaded from CDN on first use)
        case'scene3d':s.scene3d=function(w,h){_init3d(Number(w),Number(h))};break;
        case'box':s.box=function(x,y,z){return BigInt(_addMesh3d(new THREE.BoxGeometry(1,1,1),x,y,z))};break;
        case'sphere':s.sphere=function(x,y,z,r){return BigInt(_addMesh3d(new THREE.SphereGeometry(Number(r),16,16),x,y,z))};break;
        case'plane':s.plane=function(w,h){
          var g=new THREE.PlaneGeometry(Number(w),Number(h));
          var m=new THREE.MeshStandardMaterial({color:0x808080,side:THREE.DoubleSide});
          var mesh=new THREE.Mesh(g,m);mesh.rotation.x=-Math.PI/2;
          _3d.scene.add(mesh);var id=_3d.objs.length;_3d.objs.push(mesh);return BigInt(id);
        };break;
        case'color3d':s.color3d=function(id,r,g,b){var o=_3d.objs[Number(id)];if(o)o.material.color.setRGB(Number(r)/255,Number(g)/255,Number(b)/255)};break;
        case'move3d':s.move3d=function(id,x,y,z){var o=_3d.objs[Number(id)];if(o){o.position.set(x,y,z)}};break;
        case'rotate3d':s.rotate3d=function(id,x,y,z){var o=_3d.objs[Number(id)];if(o){o.rotation.set(x,y,z)}};break;
        case'scale3d':s.scale3d=function(id,sx,sy,sz){var o=_3d.objs[Number(id)];if(o){o.scale.set(sx,sy,sz)}};break;
        case'camera3d':s.camera3d=function(x,y,z){if(_3d.cam)_3d.cam.position.set(x,y,z)};break;
        case'lookAt3d':s.lookAt3d=function(x,y,z){if(_3d.cam)_3d.cam.lookAt(x,y,z)};break;
        case'light3d':s.light3d=function(x,y,z){
          if(!_3d.scene)return;
          var dl=new THREE.DirectionalLight(0xffffff,1);dl.position.set(x,y,z);_3d.scene.add(dl);
        };break;
        case'fog3d':s.fog3d=function(r,g,b,near,far){
          if(!_3d.scene)return;
          var c=new THREE.Color(Number(r)/255,Number(g)/255,Number(b)/255);
          _3d.scene.fog=new THREE.Fog(c,near,far);
          _3d.renderer.setClearColor(c);
        };break;
        case'render3d':s.render3d=function(){if(_3d.renderer&&_3d.scene&&_3d.cam){if(_3d.controls)_3d.controls.update();_3d.renderer.render(_3d.scene,_3d.cam)}};break;
        case'controls3d':s.controls3d=function(){
          if(!_3d.cam||!_3d.renderer)return;
          // Simple mouse drag orbit — no external dependency
          var drag=false,prevX=0,prevY=0,theta=0.8,phi=0.5,radius=6;
          function updCam(){
            _3d.cam.position.x=radius*Math.sin(phi)*Math.cos(theta);
            _3d.cam.position.y=radius*Math.cos(phi);
            _3d.cam.position.z=radius*Math.sin(phi)*Math.sin(theta);
            _3d.cam.lookAt(0,0,0);
          }
          updCam();
          var cv=_3d.renderer.domElement;
          cv.addEventListener('mousedown',function(e){drag=true;prevX=e.clientX;prevY=e.clientY});
          cv.addEventListener('mousemove',function(e){if(!drag)return;theta+=(e.clientX-prevX)*0.01;phi+=(e.clientY-prevY)*0.01;phi=Math.max(0.1,Math.min(Math.PI-0.1,phi));prevX=e.clientX;prevY=e.clientY;updCam();_3d.renderer.render(_3d.scene,_3d.cam)});
          cv.addEventListener('mouseup',function(){drag=false});
          cv.addEventListener('touchstart',function(e){if(e.touches.length){drag=true;prevX=e.touches[0].clientX;prevY=e.touches[0].clientY}});
          cv.addEventListener('touchmove',function(e){if(!drag||!e.touches.length)return;e.preventDefault();theta+=(e.touches[0].clientX-prevX)*0.01;phi+=(e.touches[0].clientY-prevY)*0.01;phi=Math.max(0.1,Math.min(Math.PI-0.1,phi));prevX=e.touches[0].clientX;prevY=e.touches[0].clientY;updCam();_3d.renderer.render(_3d.scene,_3d.cam)},{passive:false});
          cv.addEventListener('touchend',function(){drag=false});
          cv.addEventListener('wheel',function(e){radius+=e.deltaY*0.01;radius=Math.max(1,Math.min(20,radius));updCam();_3d.renderer.render(_3d.scene,_3d.cam)});
          _3d.controls={update:function(){}};
        };break;
        case'wallBox':s.wallBox=function(x,y,z,w,h,d){
          var geom=new THREE.BoxGeometry(w,h,d);
          var mat=new THREE.MeshStandardMaterial({color:0x888888});
          var mesh=new THREE.Mesh(geom,mat);mesh.position.set(x,y,z);
          _3d.scene.add(mesh);var id=_3d.objs.length;_3d.objs.push(mesh);return BigInt(id);
        };break;
        case'cylinder':s.cylinder=function(x,y,z,r,h){
          var geom=new THREE.CylinderGeometry(r,r,h,16);
          var mat=new THREE.MeshStandardMaterial({color:0x2dd4bf});
          var mesh=new THREE.Mesh(geom,mat);mesh.position.set(x,y,z);
          _3d.scene.add(mesh);var id=_3d.objs.length;_3d.objs.push(mesh);return BigInt(id);
        };break;
        case'ambient3d':s.ambient3d=function(r,g,b){
          if(!_3d.scene)return;
          var c=new THREE.Color(Number(r)/255,Number(g)/255,Number(b)/255);
          _3d.scene.children.forEach(function(ch){if(ch.isAmbientLight)_3d.scene.remove(ch)});
          _3d.scene.add(new THREE.AmbientLight(c,1));
        };break;
        case'bgColor3d':s.bgColor3d=function(r,g,b){
          if(!_3d.scene)return;
          _3d.scene.background=new THREE.Color(Number(r)/255,Number(g)/255,Number(b)/255);
        };break;
        case'cone':s.cone=function(x,y,z,r,h){
          var geom=new THREE.ConeGeometry(r,h,16);
          var mat=new THREE.MeshStandardMaterial({color:0x2dd4bf});
          var mesh=new THREE.Mesh(geom,mat);mesh.position.set(x,y,z);
          _3d.scene.add(mesh);var id=_3d.objs.length;_3d.objs.push(mesh);return BigInt(id);
        };break;
        case'torus':s.torus=function(x,y,z,r,tube){
          var geom=new THREE.TorusGeometry(r,tube,16,32);
          var mat=new THREE.MeshStandardMaterial({color:0x2dd4bf});
          var mesh=new THREE.Mesh(geom,mat);mesh.position.set(x,y,z);
          _3d.scene.add(mesh);var id=_3d.objs.length;_3d.objs.push(mesh);return BigInt(id);
        };break;
        case'grid3d':s.grid3d=function(size,divs){
          if(!_3d.scene)return;
          var g=new THREE.GridHelper(Number(size),Number(divs),0x444466,0x333344);
          _3d.scene.add(g);
        };break;
        case'pointLight3d':s.pointLight3d=function(x,y,z,r,g,b){
          if(!_3d.scene)return;
          var c=new THREE.Color(Number(r)/255,Number(g)/255,Number(b)/255);
          var pl=new THREE.PointLight(c,1,50);pl.position.set(x,y,z);
          if(_3d.shadowsOn){pl.castShadow=true}
          _3d.scene.add(pl);
        };break;
        case'spotLight3d':s.spotLight3d=function(x,y,z,tx,ty,tz){
          if(!_3d.scene)return;
          var sl=new THREE.SpotLight(0xffffff,1);sl.position.set(x,y,z);
          sl.target.position.set(tx,ty,tz);
          if(_3d.shadowsOn){sl.castShadow=true}
          _3d.scene.add(sl);_3d.scene.add(sl.target);
        };break;
        case'metallic3d':s.metallic3d=function(id,metal,rough){
          var o=_3d.objs[Number(id)];if(!o)return;
          o.material.metalness=metal;o.material.roughness=rough;
          o.material.needsUpdate=true;
        };break;
        case'opacity3d':s.opacity3d=function(id,val){
          var o=_3d.objs[Number(id)];if(!o)return;
          o.material.transparent=true;o.material.opacity=val;
          o.material.needsUpdate=true;
        };break;
        case'shadow3d':s.shadow3d=function(){
          if(!_3d.renderer)return;
          _3d.renderer.shadowMap.enabled=true;
          _3d.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
          _3d.shadowsOn=true;
          _3d.objs.forEach(function(o){if(o){o.castShadow=true;o.receiveShadow=true}});
        };break;
        case'text3d':s.text3d=function(ptr,x,y,z,size){
          var str=_readStr(ptr);
          var cv=document.createElement('canvas');cv.width=512;cv.height=128;
          var ctx=cv.getContext('2d');ctx.fillStyle='#ffffff';ctx.font=Math.round(Number(size)*40)+'px monospace';
          ctx.fillText(str,10,80);
          var tex=new THREE.CanvasTexture(cv);
          var mat=new THREE.MeshBasicMaterial({map:tex,transparent:true});
          var geom=new THREE.PlaneGeometry(Number(size)*str.length*0.4,Number(size));
          var mesh=new THREE.Mesh(geom,mat);mesh.position.set(x,y,z);
          _3d.scene.add(mesh);var id=_3d.objs.length;_3d.objs.push(mesh);return BigInt(id);
        };break;
        // Tone.js
        case'synth':s.synth=function(type){
          var types=['sine','square','sawtooth','triangle'];
          var syn=new Tone.Synth({oscillator:{type:types[Number(type)]||'sine'}}).toDestination();
          var id=_arrays.length;_arrays.push(syn);return BigInt(id);
        };break;
        case'drum':s.drum=function(type){
          var dr=new Tone.MembraneSynth().toDestination();
          var id=_arrays.length;_arrays.push(dr);return BigInt(id);
        };break;
        case'playNote':s.playNote=function(id,freq,dur){var syn=_arrays[Number(id)];if(syn)syn.triggerAttackRelease(freq,''+dur+'n')};break;
        case'noteOff':s.noteOff=function(id){var syn=_arrays[Number(id)];if(syn&&syn.triggerRelease)syn.triggerRelease()};break;
        case'setBpm':s.setBpm=function(bpm){Tone.Transport.bpm.value=Number(bpm)};break;
        case'setSwing':s.setSwing=function(amt){Tone.Transport.swing=amt};break;
        // Matter.js — 2D physics
        case'physics':s.physics=function(w,h){
          var ww=Number(w),hh=Number(h);
          _phys={engine:Matter.Engine.create(),bodies:[],canvas:null,ctx:null};
          var cv=document.createElement('canvas');cv.width=ww;cv.height=hh;
          cv.style.cssText='display:block;margin:8px auto;border-radius:6px;max-width:100%;background:#111;';
          _phys.canvas=cv;_phys.ctx=cv.getContext('2d');
          document.getElementById('tab-output').appendChild(cv);
        };break;
        case'physBox':s.physBox=function(x,y,w,h){
          var b=Matter.Bodies.rectangle(x,y,w,h);Matter.Composite.add(_phys.engine.world,b);
          var id=_phys.bodies.length;_phys.bodies.push(b);return BigInt(id);
        };break;
        case'physCircle':s.physCircle=function(x,y,r){
          var b=Matter.Bodies.circle(x,y,r);Matter.Composite.add(_phys.engine.world,b);
          var id=_phys.bodies.length;_phys.bodies.push(b);return BigInt(id);
        };break;
        case'physGround':s.physGround=function(y){
          var g=Matter.Bodies.rectangle(400,y,810,10,{isStatic:true});
          Matter.Composite.add(_phys.engine.world,g);
        };break;
        case'physGravity':s.physGravity=function(x,y){_phys.engine.gravity.x=x;_phys.engine.gravity.y=y};break;
        case'physStep':s.physStep=function(){Matter.Engine.update(_phys.engine,1000/60)};break;
        case'physDraw':s.physDraw=function(){
          if(!_phys||!_phys.ctx)return;var ctx=_phys.ctx;
          ctx.clearRect(0,0,_phys.canvas.width,_phys.canvas.height);
          ctx.fillStyle='#2dd4bf';
          _phys.bodies.forEach(function(b){
            ctx.save();ctx.translate(b.position.x,b.position.y);ctx.rotate(b.angle);
            if(b.circleRadius){ctx.beginPath();ctx.arc(0,0,b.circleRadius,0,Math.PI*2);ctx.fill()}
            else{var v=b.vertices;ctx.beginPath();ctx.moveTo(v[0].x-b.position.x,v[0].y-b.position.y);for(var i=1;i<v.length;i++)ctx.lineTo(v[i].x-b.position.x,v[i].y-b.position.y);ctx.closePath();ctx.fill()}
            ctx.restore();
          });
        };break;
        // Chart.js
        case'barChart':s.barChart=function(w,h){_chartInit(Number(w),Number(h),'bar')};break;
        case'lineChart':s.lineChart=function(w,h){_chartInit(Number(w),Number(h),'line')};break;
        case'pieChart':s.pieChart=function(w,h){_chartInit(Number(w),Number(h),'pie')};break;
        case'chartLabel':s.chartLabel=function(ptr){_chart.labels.push(_readStr(ptr))};break;
        case'chartData':s.chartData=function(val){_chart.data.push(val)};break;
        case'chartColor':s.chartColor=function(r,g,b){_chart.colors.push('rgb('+Number(r)+','+Number(g)+','+Number(b)+')')};break;
        case'chartRender':s.chartRender=function(){
          if(!_chart.canvas)return;
          var colors=_chart.colors.length?_chart.colors:['#2dd4bf','#f78c6c','#c792ea','#82aaff','#c3e88d','#ffcb6b','#ff5370','#89ddff'];
          new Chart(_chart.ctx,{type:_chart.type,data:{labels:_chart.labels,datasets:[{data:_chart.data,backgroundColor:colors,borderColor:colors,borderWidth:_chart.type==='line'?2:0,fill:_chart.type==='line'?false:true}]},options:{responsive:false,plugins:{legend:{display:false}}}});
        };break;
        // Howler.js — audio
        case'loadAudio':s.loadAudio=function(ptr){
          var url=_readStr(ptr);var h=new Howl({src:[url]});
          var id=_arrays.length;_arrays.push(h);return BigInt(id);
        };break;
        case'playAudio':s.playAudio=function(id){var h=_arrays[Number(id)];if(h&&h.play)h.play()};break;
        case'stopAudio':s.stopAudio=function(id){var h=_arrays[Number(id)];if(h&&h.stop)h.stop()};break;
        case'loopAudio':s.loopAudio=function(id,on){var h=_arrays[Number(id)];if(h)h.loop(!!Number(on))};break;
        case'volumeAudio':s.volumeAudio=function(id,vol){var h=_arrays[Number(id)];if(h)h.volume(vol)};break;
        // GSAP — animation
        case'tween':s.tween=function(id,prop,val,dur){
          var el=document.getElementById('emit-el-'+Number(id));if(!el)return;
          var props={0:'x',1:'y',2:'scale',3:'rotation',4:'opacity'};
          var p=props[Number(prop)]||'x';var o={duration:dur};o[p]=val;
          gsap.to(el,o);
        };break;
        // Anime.js
        case'animateEl':s.animateEl=function(id,prop,val,dur){
          var el=document.getElementById('emit-el-'+Number(id));if(!el)return;
          var props={0:'translateX',1:'translateY',2:'scale',3:'rotate',4:'opacity'};
          var p=props[Number(prop)]||'translateX';var o={targets:el,duration:Number(dur)*1000};o[p]=val;
          anime(o);
        };break;
        // PixiJS — 2D WebGL
        case'pixiApp':s.pixiApp=function(w,h){
          var ww=Number(w),hh=Number(h);
          _pixi={app:new PIXI.Application({width:ww,height:hh,backgroundColor:0x111122}),objs:[]};
          _pixi.app.view.style.cssText='display:block;margin:8px auto;border-radius:6px;max-width:100%;';
          document.getElementById('tab-output').appendChild(_pixi.app.view);
        };break;
        case'pixiRect':s.pixiRect=function(x,y,w,h,r,g,b){
          var gr=new PIXI.Graphics();gr.beginFill((Number(r)<<16)|(Number(g)<<8)|Number(b));
          gr.drawRect(0,0,Number(w),Number(h));gr.endFill();gr.x=Number(x);gr.y=Number(y);
          _pixi.app.stage.addChild(gr);var id=_pixi.objs.length;_pixi.objs.push(gr);return BigInt(id);
        };break;
        case'pixiCircle':s.pixiCircle=function(x,y,rad,r,g,b){
          var gr=new PIXI.Graphics();gr.beginFill((Number(r)<<16)|(Number(g)<<8)|Number(b));
          gr.drawCircle(0,0,Number(rad));gr.endFill();gr.x=Number(x);gr.y=Number(y);
          _pixi.app.stage.addChild(gr);var id=_pixi.objs.length;_pixi.objs.push(gr);return BigInt(id);
        };break;
        case'pixiText':s.pixiText=function(ptr,x,y,sz){
          var str=_readStr(ptr);var t=new PIXI.Text(str,{fill:0xffffff,fontSize:Number(sz)});
          t.x=Number(x);t.y=Number(y);_pixi.app.stage.addChild(t);
          var id=_pixi.objs.length;_pixi.objs.push(t);return BigInt(id);
        };break;
        case'pixiMove':s.pixiMove=function(id,x,y){var o=_pixi.objs[Number(id)];if(o){o.x=Number(x);o.y=Number(y)}};break;
        case'pixiRender':s.pixiRender=function(){if(_pixi&&_pixi.app)_pixi.app.render()};break;
        // Cannon.js — 3D physics
        case'world3d':s.world3d=function(gx,gy,gz){
          _cannon={world:new CANNON.World(),bodies:[]};
          _cannon.world.gravity.set(gx,gy,gz);
        };break;
        case'bodyBox':s.bodyBox=function(x,y,z,w,h,d,mass){
          var b=new CANNON.Body({mass:mass,shape:new CANNON.Box(new CANNON.Vec3(w/2,h/2,d/2))});
          b.position.set(x,y,z);_cannon.world.addBody(b);
          var id=_cannon.bodies.length;_cannon.bodies.push(b);return BigInt(id);
        };break;
        case'bodySphere':s.bodySphere=function(x,y,z,r,mass){
          var b=new CANNON.Body({mass:mass,shape:new CANNON.Sphere(r)});
          b.position.set(x,y,z);_cannon.world.addBody(b);
          var id=_cannon.bodies.length;_cannon.bodies.push(b);return BigInt(id);
        };break;
        case'bodyPlane':s.bodyPlane=function(){
          var b=new CANNON.Body({mass:0,shape:new CANNON.Plane()});
          /* cannon.js 0.6.2 calls it setFromEuler; other builds setFromEulerAngles */
          if(typeof b.quaternion.setFromEuler==='function')b.quaternion.setFromEuler(-Math.PI/2,0,0);
          else if(typeof b.quaternion.setFromEulerAngles==='function')b.quaternion.setFromEulerAngles(-Math.PI/2,0,0);
          _cannon.world.addBody(b);
          var id=_cannon.bodies.length;_cannon.bodies.push(b);return BigInt(id);
        };break;
        case'bodyForce':s.bodyForce=function(id,fx,fy,fz){
          var b=_cannon.bodies[Number(id)];if(b)b.applyForce(new CANNON.Vec3(fx,fy,fz),b.position);
        };break;
        case'stepWorld':s.stepWorld=function(dt){if(_cannon&&_cannon.world)_cannon.world.step(dt)};break;
        // PeerJS — networking
        case'hostPeer':s.hostPeer=function(ptr){
          var id=_readStr(ptr);_peer={peer:new Peer(id),conn:null};
          _peer.peer.on('connection',function(c){_peer.conn=c;
            c.on('data',function(d){if(_peer.onRecv&&window._wi)_emitCallExport(window._wi,_peer.onRecv,[])});
          });
        };break;
        case'joinPeer':s.joinPeer=function(ptr){
          var id=_readStr(ptr);_peer={peer:new Peer(),conn:null};
          _peer.conn=_peer.peer.connect(id);
          _peer.conn.on('data',function(d){if(_peer.onRecv&&window._wi)_emitCallExport(window._wi,_peer.onRecv,[])});
        };break;
        case'sendInt':s.sendInt=function(val){if(_peer&&_peer.conn)_peer.conn.send(Number(val))};break;
        case'sendStr':s.sendStr=function(ptr){if(_peer&&_peer.conn)_peer.conn.send(_readStr(ptr))};break;
        case'onRecvInt':s.onRecvInt=function(cb){if(_peer)_peer.onRecv='onrecv_'+Number(cb)};break;
        case'onRecvStr':s.onRecvStr=function(cb){if(_peer)_peer.onRecv='onrecv_'+Number(cb)};break;
        // Animation & Input
        case'animate':s.animate=function(){
          if(_animRunning)return;_animRunning=true;
          function loop(){if(!_animRunning)return;_emitFrame();requestAnimationFrame(loop)}
          requestAnimationFrame(loop);
        };break;
        case'keyDown':s.keyDown=function(key){return BigInt(_keys[Number(key)]?1:0)};break;
        case'touchX':s.touchX=function(){return BigInt(Math.round(_touch.x))};break;
        case'touchY':s.touchY=function(){return BigInt(Math.round(_touch.y))};break;
        case'touching':s.touching=function(){return BigInt(_touch.on)};break;
        case'getInputStr':s.getInputStr=function(id){
          var el=document.getElementById('emit-el-'+Number(id));
          if(!el||!el.value)return 0;
          if(!_wasmMem)return 0;
          var enc=new TextEncoder().encode(el.value);
          var ptr=_strWritePtr||4096;
          var view=new DataView(_wasmMem.buffer);
          view.setUint32(ptr,enc.length,true);
          new Uint8Array(_wasmMem.buffer).set(enc,ptr+4);
          _strWritePtr=ptr+4+enc.length+1;
          return ptr;
        };break;
        // Images
        case'loadImage':s.loadImage=function(ptr){
          var url=_readStr(ptr);var img=new Image();img.crossOrigin='anonymous';img.src=url;
          var id=_images.length;_images.push(img);return BigInt(id);
        };break;
        case'drawImage':s.drawImage=function(id,x,y){
          if(!_ctx)return;var img=_images[Number(id)];if(img&&img.complete)_ctx.drawImage(img,Number(x),Number(y));
        };break;
        case'drawImageScaled':s.drawImageScaled=function(id,x,y,w,h){
          if(!_ctx)return;var img=_images[Number(id)];if(img&&img.complete)_ctx.drawImage(img,Number(x),Number(y),Number(w),Number(h));
        };break;
        // Collision
        case'collides':s.collides=function(x1,y1,w1,h1,x2,y2,w2,h2){
          var ax=Number(x1),ay=Number(y1),aw=Number(w1),ah=Number(h1);
          var bx=Number(x2),by=Number(y2),bw=Number(w2),bh=Number(h2);
          return BigInt((ax<bx+bw&&ax+aw>bx&&ay<by+bh&&ay+ah>by)?1:0);
        };break;
        case'dist':s.dist=function(x1,y1,x2,y2){
          var dx=x2-x1,dy=y2-y1;return Math.sqrt(dx*dx+dy*dy);
        };break;
        // Timers
        case'setTimer':s.setTimer=function(ms,id){
          setTimeout(function(){if(window._wi&&window._wi.exports['ontimer_'+Number(id)])_emitCallExport(window._wi,'ontimer_'+Number(id),[])},Number(ms));
        };break;
        case'setInterval':s.setInterval=function(ms,id){
          var iv=window.setInterval(function(){if(window._wi&&window._wi.exports['ontimer_'+Number(id)])_emitCallExport(window._wi,'ontimer_'+Number(id),[]);else clearInterval(iv)},Number(ms));
        };break;
        // Screen
        case'screenW':s.screenW=function(){return BigInt(window.innerWidth)};break;
        case'screenH':s.screenH=function(){return BigInt(window.innerHeight)};break;
        // Mouse
        case'mouseX':s.mouseX=function(){return BigInt(Math.round(_touch.x))};break;
        case'mouseY':s.mouseY=function(){return BigInt(Math.round(_touch.y))};break;
        case'mouseDown':s.mouseDown=function(){return BigInt(_touch.on)};break;
        // Storage
        case'save':s.save=function(ptr,val){try{localStorage.setItem(_readStr(ptr),Number(val))}catch(e){}};break;
        case'load':s.load=function(ptr){try{var v=localStorage.getItem(_readStr(ptr));return v!==null?BigInt(parseInt(v)):0n}catch(e){return 0n}};break;
        case'saveStr':s.saveStr=function(kptr,vptr){try{localStorage.setItem(_readStr(kptr),_readStr(vptr))}catch(e){}};break;
        // HTTP
        case'httpGet':s.httpGet=function(ptr,cb){
          var url=_readStr(ptr);
          fetch(url).then(function(r){return r.text()}).then(function(txt){
            if(window._wi&&window._wi.exports['onhttp_'+Number(cb)]){
              // Store response in WASM memory
              if(_wasmMem){
                var enc=new TextEncoder().encode(txt.substring(0,4000));
                var rptr=_strWritePtr||4096;
                var view=new DataView(_wasmMem.buffer);
                view.setUint32(rptr,enc.length,true);
                new Uint8Array(_wasmMem.buffer).set(enc,rptr+4);
                _strWritePtr=rptr+4+enc.length+1;
              }
              _emitCallExport(window._wi,'onhttp_'+Number(cb),[]);
            }
          }).catch(function(){});
        };break;
        // Random & Math helpers
        case'randInt':s.randInt=function(min,max){
          var lo=Number(min),hi=Number(max);
          return BigInt(lo+Math.floor(Math.random()*(hi-lo+1)));
        };break;
        case'lerp':s.lerp=function(a,b,t){return a+(b-a)*t};break;
        case'clamp':s.clamp=function(val,lo,hi){return Math.min(Math.max(val,lo),hi)};break;
        // Math — extras
        case'ceil':s.ceil=function(x){return BigInt(Math.ceil(Number(x)))};break;
        case'round':s.round=function(x){return BigInt(Math.round(Number(x)))};break;
        case'sign':s.sign=function(x){return BigInt(Math.sign(Number(x)))};break;
        case'absNum':s.absNum=function(x){return Math.abs(x)};break;
        case'minNum':s.minNum=function(a,b){return Math.min(a,b)};break;
        case'maxNum':s.maxNum=function(a,b){return Math.max(a,b)};break;
        case'tan':s.tan=function(x){return Math.tan(x)};break;
        case'asin':s.asin=function(x){return Math.asin(x)};break;
        case'acos':s.acos=function(x){return Math.acos(x)};break;
        case'atan':s.atan=function(x){return Math.atan(x)};break;
        case'atan2':s.atan2=function(y,x){return Math.atan2(y,x)};break;
        case'ln':s.ln=function(x){return Math.log(x)};break;
        case'log2':s.log2=function(x){return Math.log2(x)};break;
        case'exp':s.exp=function(x){return Math.exp(x)};break;
        case'PI':s.PI=function(){return Math.PI};break;
        case'TAU':s.TAU=function(){return Math.PI*2};break;
        case'E':s.E=function(){return Math.E};break;
        // Strings
        case'intToStr':s.intToStr=function(x){return _writeStr(typeof x==='bigint'?x.toString():String(x))};break;
        case'numToStr':s.numToStr=function(x){var n=Number(x);var str=Number.isInteger(n)?n.toFixed(1):String(n);return _writeStr(str)};break;
        case'strLen':s.strLen=function(ptr){if(!_wasmMem)return 0n;var v=new DataView(_wasmMem.buffer);return BigInt(v.getUint32(Number(ptr),true))};break;
        case'strConcat':s.strConcat=function(a,b){return _writeStr(_readStr(Number(a))+_readStr(Number(b)))};break;
        case'substr':s.substr=function(ptr,start,len){var s=_readStr(Number(ptr));var st=Number(start),ln=Number(len);if(st<0)st=0;return _writeStr(s.substr(st,ln))};break;
        case'strEq':s.strEq=function(a,b){return _readStr(Number(a))===_readStr(Number(b))?1:0};break;
        case'charAt':s.charAt=function(ptr,i){var s=_readStr(Number(ptr));var idx=Number(i);return BigInt(idx>=0&&idx<s.length?s.charCodeAt(idx):0)};break;
        // Storage — loadStr
        case'loadStr':s.loadStr=function(ptr){try{var v=localStorage.getItem(_readStr(Number(ptr)));return _writeStr(v===null?'':v)}catch(e){return _writeStr('')}};break;
        // Sound
        case'beep':var _beepAc=null,_beepT=0;s.beep=function(freq,ms){
          // One AudioContext for the page (the sound runtime's, when present), resumed if the browser suspended it.
          // Beeps queue one after another, but never before "now": a beep asked for seconds later (a button)
          // must not be scheduled in the past, where it would play already faded out, i.e. silently.
          try{var _ac=(typeof _sndCtx==='function'&&_sndCtx())||_beepAc||(_beepAc=new (window.AudioContext||window.webkitAudioContext)());
            if(_ac.state==='suspended'){try{var _r=_ac.resume();if(_r&&_r.catch)_r.catch(function(){})}catch(e){}}
            var now=_ac.currentTime;if(_beepT<now+0.01)_beepT=now+0.01;
            var dur=Math.max(0.02,Number(ms)/1000);var o=_ac.createOscillator();var g=_ac.createGain();o.frequency.value=Number(freq);o.type='triangle';o.connect(g);g.connect(_ac.destination);g.gain.setValueAtTime(0.3,_beepT);g.gain.exponentialRampToValueAtTime(0.01,_beepT+dur);o.start(_beepT);o.stop(_beepT+dur+0.02);_beepT+=dur}catch(e){}
        };break;
        default:s[imp.name]=function(){var args=[].slice.call(arguments);_log(outputLog,imp.name,args)};
      }
    } else if(imp.module==='__js__'){
      // Universal JS interop — member calls, global lookup, coercions
      if(imp.name==='__jsGlobal'){
        obj[imp.module][imp.name]=function(namePtr){
          var name=_readStr(namePtr);
          var v;
          try{v=window[_ncProp(window,name)]}catch(e){if(e&&e._ncAmb){_jsErr(name,e);return 0n}v=null}
          if(v===undefined||v===null){_log(outputLog,'__jsGlobal['+name+']',['undefined']);return 0n}
          _log(outputLog,'__jsGlobal',[name]);
          return _handleFor(v);
        };
      }else if(imp.name==='__jsCall'){
        function _jsCallErr(name,msg){if(_tryMode&&_tryRecord(msg,'.'+name+'():'))return;if(_initCur)_jsErr('jsCall .'+name+'()',msg);
          try{
            var w=document.createElement('div');
            w.style.cssText='color:#ef4444;padding:2px 12px;font-family:var(--mono);font-size:11px;';
            w.textContent='✗ jsCall .'+name+'(): '+msg;
            document.getElementById('tab-output').appendChild(w);
          }catch(e){}
        }
        obj[imp.module][imp.name]=function(recvH,namePtr,nArgs){
          var name=_readStr(namePtr);
          var recv=_handleGet(recvH);
          if(recv===null||recv===undefined){_jsCallErr(name,'receiver is null');return 0n}
          var n=Number(nArgs);
          var args=[];
          for(var i=0;i<n;i++)args.push(_readArg(i));
          /* Visible diagnostic */
          if(_traceOn())try{
            var dbg=document.createElement('div');
            dbg.style.cssText='color:#94a3b8;padding:2px 12px;font-family:var(--mono);font-size:10px;white-space:pre-wrap;word-break:break-all;';
            var argSummary=args.map(function(a){
              if(a===null||a===undefined)return String(a);
              if(typeof a==='object'||typeof a==='function')return _traceVal(a);
              return String(a);
            }).join(', ');
            dbg.textContent='→ .'+name+'('+argSummary+')';
            _traceAdd(dbg);
          }catch(e){}
          _log(outputLog,'__jsCall',[name,'('+args.map(function(a){return typeof a==='object'?'[obj]':JSON.stringify(a)}).join(', ')+')']);
          try{name=_ncProp(recv,name)}catch(e){_jsCallErr(name,_errMsg(e));return 0n}
          var fn=recv[name];
          if(typeof fn==='function'){
            /* plain call or construction: see _jsIsCtor / _jsInvoke */
            try{return _js_returnWrap(_jsInvoke(fn,recv,args,name))}
            catch(e){if(_tryMode&&_tryRecord(e))return 0n;_jsCallErr(name,_errMsg(e));return 0n}
          }
          if(typeof recv[name]!=='undefined')return _js_returnWrap(recv[name]);
          _jsCallErr(name,'is not a function (the object has no such method)');
          return 0n;
        };
      }else if(imp.name==='__jsNum'){
        obj[imp.module][imp.name]=function(h){
          var v=_handleVal(h);
          var n=Number(v);
          return isFinite(n)?n:0;
        };
      }else if(imp.name==='__jsBool'){
        /* JS truthiness of a handle: `if (obj.visible)`. 0 = null/undefined = false. */
        obj[imp.module][imp.name]=function(h){return _handleVal(h)?1:0};
      }else if(imp.name==='__jsStr'){
        obj[imp.module][imp.name]=function(h){
          var v=_handleVal(h);
          return _writeStr(v===null||v===undefined?'':String(v));
        };
      }else if(imp.name==='__jsGet'){
        obj[imp.module][imp.name]=function(recvH,namePtr){
          var name=_readStr(namePtr);
          var recv=_handleGet(recvH);
          if(recv===null||recv===undefined){_jsErr('.'+name,'cannot read a property of null');return 0n}
          try{return _js_returnWrap(recv[_ncProp(recv,name)])}catch(e){_jsErr('.'+name,e);return 0n}
        };
      }else if(imp.name==='__jsSet'){
        obj[imp.module][imp.name]=function(recvH,namePtr){
          var name=_readStr(namePtr);
          var recv=_handleGet(recvH);
          if(recv===null||recv===undefined){_log(outputLog,'__jsSet['+name+']',['receiver is null']);_jsErr('.'+name+' = …','cannot set a property of null');return}
          // Value was written into slot 0 of the arg buffer by the codegen
          var value=_readArg(0);
          _log(outputLog,'__jsSet',[name,'= '+(typeof value==='object'?'[obj]':JSON.stringify(value))]);
          try{recv[_ncProp(recv,name)]=value}catch(e){_log(outputLog,'__jsSet ERROR',[name+': '+e.message]);_jsErr('.'+name+' = …',e)}
        };
      }else if(imp.name==='__jsNew'){
        obj[imp.module][imp.name]=function(recvH,namePtr,nArgs){
          var name=_readStr(namePtr);
          var recv=_handleGet(recvH);
          /* name "" means: the receiver itself is the constructor (new X(...)) */
          var label='new '+(name||(recv&&recv.name)||'?')+'()';
          if(recv===null||recv===undefined){_jsErr(label,'constructor is null/undefined');return 0n}
          var Ctor;try{Ctor=name===''?recv:recv[_ncProp(recv,name)]}catch(e){_jsErr(label,e);return 0n}
          if(typeof Ctor!=='function'){_jsErr(label,'is not a constructor');return 0n}
          var n=Number(nArgs);
          var args=[];
          for(var i=0;i<n;i++)args.push(_readArg(i));
          try{return _js_returnWrap(new (Function.prototype.bind.apply(Ctor,[null].concat(args)))())}
          catch(e){_log(outputLog,'__jsNew ERROR',[name+': '+e.message]);_jsErr(label,e);return 0n}
        };
      }else{
        obj[imp.module][imp.name]=_jsCallImport(imp.name,outputLog)||_jsExtraImport(imp.name)||function(){return 0n};
      }
    } else if(imp.module==='js'){
      // Auto-bridged JS function — try to call the real JS global
      // Return values are wrapped as handles so that `.method()` chains work via Path C.
      obj[imp.module][imp.name]=(function(impName,impNode){
        return function(){
          var realArgs=[];
          for(var ai=0;ai<arguments.length;ai++){
            var raw=arguments[ai];
            // Check if this param is str type — read from WASM memory
            var ptype=impNode?.params?.[ai]?.type;
            if(ptype==='str'&&_wasmMem){realArgs.push(_readStr(raw))}
            else if(ptype==='js'){realArgs.push(_handleVal(raw))}
            else if(typeof raw==='bigint'){
              // Int arg: could be a handle, try lookup first
              var n=Number(raw);
              var hv=_handleLive(n);
              if(hv!==undefined){realArgs.push(hv)}
              else{_arrEscape(n);realArgs.push(n)}
            }
            else{realArgs.push(raw)}
          }
          _log(outputLog,impName,realArgs);
          /* DIAGNOSTIC: render args to output panel so we can see what got marshalled */
          if(_traceOn())try{
            var dbg=document.createElement('div');
            dbg.style.cssText='color:#94a3b8;padding:2px 12px;font-family:var(--mono);font-size:10px;white-space:pre-wrap;word-break:break-all;';
            var argSummary=realArgs.map(function(a){
              if(a===null||a===undefined)return String(a);
              if(typeof a==='object'||typeof a==='function')return _traceVal(a);
              return String(a);
            }).join(', ');
            dbg.textContent='→ '+impName+'('+argSummary+')';
            _traceAdd(dbg);
          }catch(e){}
          // Try to call the real JS function
          var jsFn;try{jsFn=window[_ncProp(window,impName)]}catch(e){_jsErr(impName+'()',e);return(impNode?.returnType==='int'||impNode?.returnType==='js')?0n:0}
          if(typeof jsFn==='function'){
            var ret;
            try{
              // plain call or construction: see _jsIsCtor / _jsInvoke
              ret=_jsInvoke(jsFn,window,realArgs,impName);
            }catch(e){_log(outputLog,impName+' ERROR',[e.message]);_jsErr(impName+'()',e);return(impNode?.returnType==='int'||impNode?.returnType==='js')?0n:0}
            // If return type expects int (handle), wrap as handle
            if(impNode?.returnType==='int'||impNode?.returnType==='js'){
              if(ret===null||ret===undefined)return 0n;
              return _handleFor(ret);
            }
            // Show primitive results in the output panel (preserves v1.x behavior)
            if(ret!==undefined&&ret!==null&&typeof ret!=='object'){
              var d=document.createElement('div');
              d.style.cssText='font-family:var(--mono);font-size:13px;padding:2px 12px;color:#38bdf8;';
              d.textContent='< '+String(ret);
              document.getElementById('tab-output').appendChild(d);
            }
          }else{
            /* JS function not available — show a visible warning so silent failures stop happening */
            var w=document.createElement('div');
            w.style.cssText='color:#fbbf24;padding:2px 12px;font-family:var(--mono);font-size:12px;';
            w.textContent='⚠ '+impName+'(...) — window.'+impName+' is '+(jsFn===undefined?'not loaded':typeof jsFn)+'. CDN may have failed.';
            document.getElementById('tab-output').appendChild(w);
            console.warn('Auto-bridge: window.'+impName+' is not a function ('+typeof jsFn+'). Library not loaded?');
            return(impNode?.returnType==='int'||impNode?.returnType==='js')?0n:0;
          }
        }
      })(imp.name,imp.node);
    } else {
      obj[imp.module][imp.name]=function(){var args=[].slice.call(arguments);_log(outputLog,imp.name,args)};
    }
  }
  /* toJsArray copies the elements into a JS array as plain numbers: Emit array ids among them escape to JS */
  if(obj.std&&obj.std.toJsArray){
    var _toJsArray=obj.std.toJsArray;
    obj.std.toJsArray=function(arrH){var a=_arrGet(arrH);if(Array.isArray(a))for(var i=0;i<a.length;i++)_arrEscape(a[i]);return _toJsArray(arrH)};
  }
  return obj;
}
// ── await (JSPI) · try / catch / throw · Emit arrays as values ──
// Runtime half of the compiler section "await · try / catch / finally / throw · arr".
//
// State that belongs to "the Emit call that is running now" (not to the program):
//   _tryMode  1 while that call is inside a try block (or in a function called from one): a failing
//             interop call then records the error (_pendErr) instead of printing the red line.
//   _canWait  true while that call was entered through WebAssembly.promising, i.e. `await` may suspend it.
// Both are saved and reset whenever Emit is entered from JS (_emitEnter); around a suspension they are
// saved by __awaitPre (in a ticket) and put back by __awaitPost, the first thing the resumed call does
// (not in a promise callback: other calls may run between that callback and the actual resume), so a call that runs while another one is suspended (a button
// handler during `await sleep(…)`) never sees the suspended call's state. The pending error is set by an
// import and tested by the compiled code immediately after that import returns, so it is never live
// across a suspension; neither is the argument buffer (arguments are written right before the import
// call and read by the import before it calls into JS; __await takes its operand as a parameter).
var _tryMode=0,_pendHas=false,_pendErr=null,_canWait=false,_awaitGen=0,_asyncFns=null,_tryFns=null,_promMap=null,_frameBusy=false,_awaits=new Map(),_awaitSeq=0;
var _NO_JSPI='This browser does not support await (JSPI: WebAssembly.Suspending / WebAssembly.promising are missing). Use promise.then(fnRef(callback)) instead of await, or open the program in a browser with JSPI (Chrome or Edge 137 and newer).';
var _NO_WAIT='await cannot wait here: this Emit function was called directly from JavaScript, so there is nothing to pause. Call it through the Emit runtime (the Run button, fnRef callbacks, button/timer/frame handlers, _emitCallExport(instance, name, args)) or use promise.then(fnRef(callback)).';
function _jspiOk(){return typeof WebAssembly!=='undefined'&&typeof WebAssembly.Suspending==='function'&&typeof WebAssembly.promising==='function'}
// Inside a try: remember the error for the catch block. A thrown primitive ("text", 42) is wrapped in an
// Error (the original value is kept as .thrown) so that e.message always works.
function _tryRecord(e,what){
  if(!_tryMode)return false;
  if(e===null||e===undefined||(typeof e!=='object'&&typeof e!=='function')){var x=new Error((what?what+' ':'')+String(e));x.thrown=e;e=x}
  _pendErr=e;_pendHas=true;
  return true;
}
function _emitThrow(v){
  if(_tryRecord(v))return;
  if(v===null||v===undefined||(typeof v!=='object'&&typeof v!=='function')){var x=new Error(String(v));x.thrown=v;v=x}
  throw v; /* no try block around: a real JS exception ends the Emit call; whoever started it reports it */
}
function _emitWaitErr(e){
  try{if(typeof WebAssembly!=='undefined'&&WebAssembly.SuspendError&&e instanceof WebAssembly.SuspendError)return new Error(_NO_WAIT)}catch(x){}
  return e;
}
// The error hooks: every interop failure goes through _jsErr (or _jsCallErr for member calls).
_jsErr=(function(report){return function(what,e){
  if(_tryMode&&_tryRecord(e,(typeof e==='string'&&/^(cannot |is not |constructor is )/.test(e))?what:''))return;
  return report(what,e);
}})(_jsErr);
function _emitIsAsync(name){return !!(_asyncFns&&_asyncFns[name]===true)}
// Enter Emit from JS. isAsync: through WebAssembly.promising — returns a promise.
function _emitEnter(f,args,isAsync){
  var sm=_tryMode,sw=_canWait;
  _tryMode=0;
  try{
    if(!isAsync)return f.apply(null,args);
    if(!_jspiOk())throw new Error(_NO_JSPI);
    if(!_promMap)_promMap=new WeakMap();
    var pf=_promMap.get(f);
    if(!pf){pf=WebAssembly.promising(f);_promMap.set(f,pf)}
    _canWait=true;
    var idle=function(){_canWait=false;_tryMode=0};
    return pf.apply(null,args).then(function(v){idle();return v},function(e){idle();throw _emitWaitErr(e)});
  }catch(e){throw _emitWaitErr(e)}
  finally{_tryMode=sm;_canWait=sw}
}
// Call an exported Emit function by name — the way the IDE's Run, the export boot, buttons, timers and
// frame() do. A function that can reach an `await` (the compiler lists them in imports.asyncFns) is
// entered through WebAssembly.promising and the result is a promise that never rejects: a rejection is
// reported as a red line in the output. Any other function is called directly and returns its result.
// Every call is one lifetime scope (see "LIFETIME"): what it creates is released when it has completed —
// for an async function when its promise settles. top: the caller is certainly not nested in Emit code.
function _emitCallExport(inst,name,args,top){
  name=_ncExport(inst,name);
  var f=inst&&inst.exports?inst.exports[name]:null;
  if(typeof f!=='function')throw new Error('there is no exported Emit function "'+name+'"');
  var sc=_scopeEnter(top),cur=_scCur;
  _scCur=sc;
  if(!_emitIsAsync(name)){
    try{return _emitEnter(f,args||[],false)}
    finally{_scCur=cur;_scopeExit(sc)}
  }
  var mem=_wasmMem,p;
  try{p=_emitEnter(f,args||[],true)}catch(e){p=Promise.reject(e)}
  finally{_scCur=cur}
  p=p.then(function(v){_scopeExit(sc);return v},function(e){_scopeExit(sc);if(mem===_wasmMem)_jsErr(name+'()',e)});
  p.toString=function(){return'(async — still running; its output appears below)'};
  return p;
}
if(typeof window!=='undefined')window._emitCallExport=_emitCallExport; /* the export boot reaches it here (the .js export runs this code inside a function) */
// Shadow stack (see PARKED SCOPES): a call into an async Emit function is an invocation whose region starts at
// the SP of the moment; when its synchronous part returns — suspended, finished or failed — SP is put back.
// A synchronous call has no invocation (an await reached in it cannot suspend, and must not park the caller).
_emitEnter=(function(enter){return function(f,args,isAsync){
  var m=_wasmMem;
  if(!(m&&m._emitSS===true)&&!_ssOn())return enter(f,args,isAsync);
  var prev=_ssInv,s0=_ssSP();
  _ssInv=isAsync?{ss0:s0,sc:_scCur,bytes:null,len:0,bad:false}:null;
  try{return enter(f,args,isAsync)}
  finally{_ssInv=prev;_ssSP(s0)}
}})(_emitEnter);
// The IDE and the export boot publish the instance in window._wi only after the entry functions have been
// called: learn whether it keeps a shadow stack from the instance the call is made on.
_emitCallExport=(function(call){return function(inst,name,args,top){
  var m=_wasmMem;
  if(m&&m._emitSS===undefined&&inst&&inst.exports&&inst.exports.memory===m)m._emitSS=!!inst.exports.__emitSS;
  return call.apply(this,arguments);
}})(_emitCallExport);
// One frame() at a time: while an async frame() is suspended in an await the next one is not started.
// This is the one path for frames — the animate() loop and tests/run-memory.js both call it; a frame is
// never nested in Emit code, so its scope is entered with top=true and collects when frame() returns.
function _emitFrame(){
  var wi=window._wi;
  if(!wi||!wi.exports.frame||_frameBusy)return;
  _frameCount++;
  if(_frameCount===_frameTraceMax+1&&_traceOn()){
    var note=document.createElement('div');
    note.style.cssText='color:#64748b;padding:2px 12px;font-family:var(--mono);font-size:10px;';
    note.textContent='→ … frame() keeps running; its calls are traced for the first '+_frameTraceMax+' frames only';
    _traceAdd(note);
  }
  var quietWas=_frameQuiet;if(_frameCount>_frameTraceMax)_frameQuiet=true;
  var r;try{r=_emitCallExport(wi,'frame',[],true)}finally{_frameQuiet=quietWas}
  if(r&&typeof r.then==='function'){var gen=_awaitGen;_frameBusy=true;r.then(function(){if(gen===_awaitGen)_frameBusy=false})}
}
// fnRef callbacks. An async Emit function gives JS a promise, like a JS async function would (a rejection
// nobody handles shows up as the red "unhandled promise rejection" line). A callback that JS calls while
// Emit code is inside a try block (list.forEach(fnRef(f)) in a try) is part of that try: it keeps the
// catching mode, and an error it does not catch itself is thrown to the JS caller — and so reaches the
// catch of that try block, as it would in JavaScript.
function _emitCallback(fn,args,ret,name){
  var outer=_tryMode;
  if(outer&&_tryFns&&_tryFns[name]===true){
    var r;
    try{r=fn.apply(null,args)}finally{_tryMode=outer}
    if(_pendHas){var pe=_pendErr;_pendHas=false;_pendErr=null;throw pe}
    return _cbRet(r,ret);
  }
  try{
    if(_emitIsAsync(name))return _emitEnter(fn,args,true).then(function(v){return _cbRet(v,ret)});
    return _cbRet(_emitEnter(fn,args,false),ret);
  }catch(e){
    if(outer)throw e;
    _jsErr('callback '+name+'()',e);
  }
}
// Emit array (id into _arrays) → a new JS array. Same element rules as toJsArray: an integer that is a
// live handle becomes that JS value, a pointer to a string literal becomes the string.
function _arrToJs(id){var out=_arrVals(id);return out?_js_returnWrap(out):0n}
function _arrVals(id){
  var a=_arrGet(id);
  if(!a)return null;
  var out=[];
  for(var i=0;i<a.length;i++){
    var v=a[i],n=null;
    if(typeof v==='bigint')n=Number(v);else if(typeof v==='number'&&Number.isInteger(v))n=v;
    if(n===null){out.push(v);continue}
    var hv=_handleLive(n);
    if(hv!==undefined){out.push(hv);continue}
    if(n>=1024&&n<48640&&_wasmMem){
      try{var view=new DataView(_wasmMem.buffer),len=view.getUint32(n,true);if(len<10000){out.push(new TextDecoder().decode(new Uint8Array(_wasmMem.buffer,n+4,len)));continue}}catch(e){}
    }
    _arrEscape(n); /* a nested Emit array goes to JS as its id: keep that array */
    out.push(n);
  }
  return out;
}
function _arrInt(v){
  if(typeof v==='bigint')return v;
  var n=Math.trunc(Number(v));
  return(n===n&&isFinite(n))?BigInt(n):0n;
}
// Imports of module "__js__" added by this section (see _JS_CONV_IMPORTS in the compiler).
function _emitExtraImport(name){
  switch(name){
    case'__awaitPre':return function(h){
      var v=_handleVal(h);
      if(!(v&&(typeof v==='object'||typeof v==='function')&&typeof v.then==='function'))return 0n; /* not a promise: the value itself */
      if(!_canWait)throw new Error(_NO_WAIT);
      var t=++_awaitSeq;
      _awaits.set(t,{p:v,mode:_tryMode,mem:_wasmMem,gen:_awaitGen,failed:false,err:null});
      return BigInt(t);
    };
    case'__await':
      if(!_jspiOk())return function(){throw new Error(_NO_JSPI)};
      return new WebAssembly.Suspending(function(t){
        var rec=_awaits.get(Number(t));
        _scopePark(rec); /* lifetime: the locals the compiler stored become roots; may collect */
        _tryMode=0;_canWait=false; /* while this call is suspended other calls start from a clean state */
        /* stale: the program was stopped or run again meanwhile — this call is never resumed */
        function stale(){return rec.mem!==_wasmMem||rec.gen!==_awaitGen}
        return Promise.resolve(rec.p).then(
          function(v){if(stale()){_scopeExit(rec.sc);return new Promise(function(){})}_scopeUnpark(rec);return _js_returnWrap(v)},
          function(e){if(stale()){_scopeExit(rec.sc);return new Promise(function(){})}_scopeUnpark(rec);rec.failed=true;rec.err=e;return 0n});
      });
    case'__awaitPost':return function(t){
      var rec=_awaits.get(Number(t));
      _awaits.delete(Number(t));
      _scopeResume(rec);
      _tryMode=rec.mode;_canWait=true;
      if(rec.failed&&!_tryRecord(rec.err))_jsErr('await',rec.err); /* a rejection is an error like a throwing call */
    };
    case'__trySet':return function(on){var prev=_tryMode;_tryMode=on?1:0;return prev};
    case'__tryErr':return function(){return _pendHas?1:0};
    case'__tryTake':return function(){var e=_pendErr;_pendHas=false;_pendErr=null;return _js_returnWrap(e)};
    case'__throwStr':return function(ptr){_emitThrow(new Error(_readStr(ptr)))};
    case'__throwJs':return function(h){_emitThrow(_handleVal(h))};
    case'__arrGet':return function(a,i){var x=_arrGet(a);return x?_arrInt(x[Number(i)]||0):0n};
    case'__arrGetN':return function(a,i){var x=_arrGet(a);return x?(Number(x[Number(i)])||0):0};
    case'__arrSet':return function(a,i,v){var x=_arrGet(a);if(x)x[Number(i)]=Number(v)};
    case'__arrSetN':return function(a,i,v){var x=_arrGet(a);if(x)x[Number(i)]=v};
    case'__arrLen':return function(a){var x=_arrGet(a);return BigInt(x?x.length:0)};
    case'__arrPush':return function(a,v){var x=_arrGet(a);if(x)x.push(Number(v))};
    case'__arrPushN':return function(a,v){var x=_arrGet(a);if(x)x.push(v)};
    case'__arrPop':return function(a){var x=_arrGet(a);return(x&&x.length)?_arrInt(x.pop()):0n};
    case'__arrPopN':return function(a){var x=_arrGet(a);return(x&&x.length)?(Number(x.pop())||0):0};
    case'__arrJs':return function(a){return _arrToJs(a)};
    case'__arrStr':return function(a){var v=_arrVals(a);return _writeStr(v?String(v):'')};
  }
  return null;
}
// Per-run setup and the imports of this section, added around buildImportObject / _resetJsInterop
// (their bodies are unchanged).
_resetJsInterop=(function(reset){return function(){
  _awaitGen++;_awaits=new Map();_tryMode=0;_pendHas=false;_pendErr=null;_canWait=false;_frameBusy=false; /* calls suspended in an await belong to the previous run: never resumed */
  return reset.apply(this,arguments);
}})(_resetJsInterop);
buildImportObject=(function(build){return function(imports,outputLog){
  _asyncFns=Object.create(null);_tryFns=Object.create(null);_frameBusy=false;_tryMode=0;_pendHas=false;_pendErr=null;_canWait=false;
  String((imports&&imports.asyncFns)||'').split(',').forEach(function(n){if(n)_asyncFns[n]=true});
  String((imports&&imports.tryFns)||'').split(',').forEach(function(n){if(n)_tryFns[n]=true});
  var i,imp;
  for(i=0;i<imports.length;i++)if(imports[i].module==='__js__'&&imports[i].name==='__await'&&!_jspiOk())throw new Error(_NO_JSPI);
  var obj=build.apply(this,arguments);
  for(i=0;i<imports.length;i++){
    imp=imports[i];
    if(imp.module==='__js__'){var f=_emitExtraImport(imp.name);if(f)obj.__js__[imp.name]=f}
    else if(imp.module==='std'&&imp.name==='sleep')obj.std.sleep=function(ms){return _js_returnWrap(new Promise(function(done){setTimeout(done,Number(ms))}))};
  }
  return obj;
}})(buildImportObject);

// ═══ MEMORY REGIONS (runtime half; the compiler half is "MEMORY REGIONS & STRUCTS" in the compiler) ═══
// The program's metadata (imports.regionMeta, JSON) is read by buildImportObject: region names / bases /
// lengths / element types, the struct layouts and the table of source positions error messages point at.
// imports.heapBase moves the string allocator above the regions (_strHeapBase).
var _rgMeta=null,_rgViews=[],_rgScreens=[],_rgGen=0,_rgLoopGen=-1,_rgFrameSeen=new Set();
// Screens are redrawn by the animation-frame loop while the program animates (once per frame), and once after
// any other change (a call, a front-panel poke) — so nothing is drawn twice, and a stopped program costs nothing.
var _rgDirty=false;
var _RG_TA={i8:Int8Array,u8:Uint8Array,i16:Int16Array,u16:Uint16Array,i32:Int32Array,u32:Uint32Array,int:BigInt64Array,f32:Float32Array,num:Float64Array,bool:Uint8Array};
function _rgSetup(imports){
  var m=null;
  try{if(imports&&typeof imports.regionMeta==='string')m=JSON.parse(imports.regionMeta)}catch(e){m=null}
  _rgMeta=m;_rgGen++;_rgViews=[];_rgScreens=[];_rgFrameSeen=new Set();
  var hb=Number(imports&&imports.heapBase)||65536;
  _strHeapBase=hb;_strLimit=hb+33554432-65536; /* the string area keeps its size (32 MB minus the first page) */
}
// The program's memory really is laid out as the metadata says (false between buildImportObject and the
// moment the new instance's memory is published, or when no program with regions is loaded).
function _rgLive(){
  if(!_rgMeta||!_wasmMem||!_rgMeta.regions.length)return false;
  try{var r=_rgMeta.regions[0],dv=new DataView(_wasmMem.buffer);return dv.getUint32(r.desc,true)===r.base&&dv.getUint32(r.desc+4,true)===r.length}catch(e){return false}
}
function _rgByDesc(d){
  if(!_rgMeta||!_wasmMem)return null;
  try{return _rgMeta.regions[new DataView(_wasmMem.buffer).getUint32(d+12,true)]||null}catch(e){return null}
}
function _rgAt(pos){var p=_rgMeta&&_rgMeta.pos[pos];return p?p[0]:'?'}
// A failed check: inside try it is recorded for the catch (returns 1), otherwise a JS Error ends the call.
function _rgRaise(msg,pos){
  var e=new Error(msg+' at '+_rgAt(pos));e.emitRegion=true;
  if(_tryRecord(e))return 1;
  throw e;
}
function _rgIsFrozen(R){return new Uint8Array(_wasmMem.buffer)[R.desc+8]!==0}
function _rgTyped(R){
  var buf=_wasmMem.buffer;
  return typeof R.elem==='string'?new _RG_TA[R.elem](buf,R.base,R.length):new Uint8Array(buf,R.base,R.length*R.elemSize);
}
// view(r): one typed array per region, re-created when memory.grow has replaced the ArrayBuffer.
function _rgView(R){
  var c=_rgViews[R.id],buf=_wasmMem.buffer;
  if(!c||c.buf!==buf){c={buf:buf,a:_rgTyped(R)};_rgViews[R.id]=c}
  return c.a;
}
function _rgOp(op,a,b,vi,vf,pos){
  var A=_rgByDesc(a),B=op>=3?_rgByDesc(b):null;
  if(!A||(op>=3&&!B))return _rgRaise('region operation on an unknown region',pos);
  var dst=op===3?B:A;
  if(_rgIsFrozen(dst))return _rgRaise('write to frozen region '+dst.name,pos);
  if(op===4&&_rgIsFrozen(B))return _rgRaise('write to frozen region '+B.name,pos);
  if(op>=3&&(A.length!==B.length||A.elemSize!==B.elemSize))return _rgRaise((op===3?'copy':'swap')+'('+A.name+', '+B.name+'): the regions differ in length ('+A.length+' and '+B.length+')',pos);
  var u8=new Uint8Array(_wasmMem.buffer),n=A.length*A.elemSize;
  switch(op){
    case 1:{
      var t=A.elem,arr=_rgTyped(A);
      if(t==='num'||t==='f32')arr.fill(vf);
      else if(t==='int')arr.fill(BigInt.asIntN(64,vi));
      else if(t==='bool')arr.fill(vi!==0n?1:0);
      else arr.fill(Number(BigInt.asUintN(8*arr.BYTES_PER_ELEMENT,vi))); /* narrow ints wrap like a store */
      break;
    }
    case 2:u8.fill(0,A.base,A.base+n);break;
    case 3:if(A!==B)u8.copyWithin(B.base,A.base,A.base+n);break;
    case 4:if(A!==B){var tmp=u8.slice(A.base,A.base+n);u8.copyWithin(A.base,B.base,B.base+n);u8.set(tmp,B.base)}break;
  }
  return 0;
}
// screen(r, w, h[, scale]): a canvas in the output that shows the region's bytes as RGBA pixels. It is
// redrawn once per animation frame while the program is loaded, and after every call from the runtime
// (Run, buttons, timers, frame()) so a program without animation still shows its picture.
function _rgBlit1(s){
  try{
    var buf=_wasmMem.buffer;
    if(s.buf!==buf){s.buf=buf;s.img=new ImageData(new Uint8ClampedArray(buf,s.base,s.w*s.h*4),s.w,s.h)}
    s.ctx.putImageData(s.img,0,0);
  }catch(e){}
}
function _rgBlitAll(){for(var i=0;i<_rgScreens.length;i++)_rgBlit1(_rgScreens[i])}
function _rgLoop(){
  if(_rgLoopGen===_rgGen||typeof requestAnimationFrame!=='function')return;
  var g=_rgLoopGen=_rgGen;
  function tick(){if(g!==_rgGen)return;if(_animRunning||_rgDirty){_rgDirty=false;_rgBlitAll()}requestAnimationFrame(tick)}
  requestAnimationFrame(tick);
}
function _rgScreen(d,w,h,scale,pos){
  var R=_rgByDesc(d);
  if(!R)return _rgRaise('screen of an unknown region',pos);
  w=Number(w);h=Number(h);scale=Number(scale);
  if(!(w>=1&&h>=1&&scale>=1))return _rgRaise('screen('+R.name+', '+w+', '+h+(scale!==1?', '+scale:'')+'): width, height and scale must be at least 1',pos);
  if(R.length<w*h*4)return _rgRaise('screen('+R.name+', '+w+', '+h+') needs '+(w*h*4)+' bytes (width × height × 4), but '+R.name+' has '+R.length,pos);
  var s=null;
  for(var i=0;i<_rgScreens.length;i++)if(_rgScreens[i].id===R.id)s=_rgScreens[i];
  if(!s||!s.cv.isConnected||s.w!==w||s.h!==h||s.scale!==scale){
    var cv=document.createElement('canvas');
    cv.width=w;cv.height=h;
    cv.style.cssText='display:block;margin:8px auto;border:1px solid #1a1d2a;border-radius:6px;max-width:100%;background:#000;'+(scale>1?'width:'+(w*scale)+'px;image-rendering:pixelated;image-rendering:crisp-edges;':'');
    if(scale>1)cv.style.imageRendering='pixelated';
    cv.setAttribute('data-emit-screen',R.name);
    var out=document.getElementById('tab-output');
    if(s&&s.cv.isConnected&&s.cv.parentNode)s.cv.parentNode.replaceChild(cv,s.cv);else if(out)out.appendChild(cv);
    var ns={id:R.id,base:R.base,w:w,h:h,scale:scale,cv:cv,ctx:cv.getContext('2d'),buf:null,img:null};
    if(s)_rgScreens[_rgScreens.indexOf(s)]=ns;else _rgScreens.push(ns);
    s=ns;
    _canvas=cv;_ctx=null; /* getCanvas() / canvas drawing builtins see this canvas (the next blit paints over drawings) */
    _rgLoop();
  }
  _rgBlit1(s);
  return 0;
}
// ── introspection (the IDE's Memory panel; also available in exported pages as window._emitRegions …) ──
function _rgStatic(R){return{id:R.id,name:R.name,module:R.module,path:R.path,base:R.base,length:R.length,elemSize:R.elemSize,elem:typeof R.elem==='string'?R.elem:JSON.parse(JSON.stringify(R.elem))}}
function _emitRegions(){
  if(!_rgLive())return[];
  var u8=new Uint8Array(_wasmMem.buffer);
  return _rgMeta.regions.map(function(R){var o=_rgStatic(R);o.frozen=u8[R.desc+8]!==0;return o});
}
function _rgReg(id){return _rgLive()?_rgMeta.regions[Number(id)]||null:null}
// field: undefined for a scalar region; for a struct region a flattened name ("x", "pos.x") — an array field
// is addressed per element as "pos[1]" (or "pos.1").
function _rgField(R,field){
  if(typeof R.elem==='string')return(field===undefined||field===null||field==='')?{type:R.elem,offset:0}:null;
  if(field===undefined||field===null)return null;
  var f=String(field),fs=R.elem.fields,i,x=null,sub=0;
  for(i=0;i<fs.length;i++)if(fs[i].name===f)x=fs[i];
  if(x&&x.count)return null;
  if(!x){
    var m=/^(.*?)(?:\[(\d+)\]|\.(\d+))$/.exec(f);
    if(!m)return null;
    for(i=0;i<fs.length;i++)if(fs[i].name===m[1])x=fs[i];
    sub=Number(m[2]!==undefined?m[2]:m[3]);
    if(!x||!x.count||sub>=x.count)return null;
  }
  return{type:x.type,offset:x.offset+sub*x.size};
}
function _rgAddrOf(R,index,field){
  index=Number(index);
  if(!Number.isInteger(index)||index<0||index>=R.length)return null;
  var f=_rgField(R,field);
  return f?{type:f.type,a:R.base+index*R.elemSize+f.offset}:null;
}
function _emitRegionRead(id,index,field){
  var R=_rgReg(id);if(!R)return undefined;
  var x=_rgAddrOf(R,index,field);if(!x)return undefined;
  var dv=new DataView(_wasmMem.buffer),a=x.a;
  switch(x.type){
    case'i8':return dv.getInt8(a);
    case'u8':return dv.getUint8(a);
    case'i16':return dv.getInt16(a,true);
    case'u16':return dv.getUint16(a,true);
    case'i32':return dv.getInt32(a,true);
    case'u32':return dv.getUint32(a,true);
    case'int':{var b=dv.getBigInt64(a,true);return(b>=-9007199254740991n&&b<=9007199254740991n)?Number(b):b.toString()}
    case'f32':return dv.getFloat32(a,true);
    case'num':return dv.getFloat64(a,true);
    case'bool':return dv.getUint8(a)!==0;
  }
  return undefined;
}
// A write from outside the program (the Memory panel): converted / truncated like a store from Emit, and
// deliberately NOT stopped by freeze. false for a bad id, index, field or value (NaN, non-numeric text).
function _emitRegionWrite(id,index,field,value){
  var ok=_emitRegionWrite1(id,index,field,value);if(ok)_rgDirty=true;   // a poke shows on the screen at the next frame
  return ok;
}
function _emitRegionWrite1(id,index,field,value){
  var R=_rgReg(id);if(!R)return false;
  var x=_rgAddrOf(R,index,field);if(!x)return false;
  var dv=new DataView(_wasmMem.buffer),a=x.a,t=x.type,s=typeof value==='string'?value.trim():null;
  try{
    if(t==='num'||t==='f32'){
      var n=typeof value==='bigint'?Number(value):typeof value==='boolean'?(value?1:0):s===''?NaN:Number(value);
      if(n!==n)return false;
      if(t==='num')dv.setFloat64(a,n,true);else dv.setFloat32(a,n,true);
      return true;
    }
    if(t==='bool'){
      var on;
      if(typeof value==='boolean')on=value;
      else if(s==='true'||s==='false')on=s==='true';
      else{var q=typeof value==='bigint'?Number(value):s===''?NaN:Number(value);if(q!==q)return false;on=q!==0}
      dv.setUint8(a,on?1:0);
      return true;
    }
    var big;
    if(typeof value==='bigint')big=value;
    else if(typeof value==='boolean')big=value?1n:0n;
    else if(s!==null&&/^[-+]?\d+$/.test(s))big=BigInt(s);
    else{var k=s===''?NaN:Number(value);if(!Number.isFinite(k))return false;big=BigInt(Math.trunc(k))}
    switch(t){
      case'i8':case'u8':dv.setUint8(a,Number(BigInt.asUintN(8,big)));break;
      case'i16':case'u16':dv.setUint16(a,Number(BigInt.asUintN(16,big)),true);break;
      case'i32':case'u32':dv.setUint32(a,Number(BigInt.asUintN(32,big)),true);break;
      case'int':dv.setBigInt64(a,BigInt.asIntN(64,big),true);break;
      default:return false;
    }
    return true;
  }catch(e){return false}
}
function _emitRegionFreeze(id,on){
  var R=_rgReg(id);if(!R)return false;
  new Uint8Array(_wasmMem.buffer)[R.desc+8]=on?1:0;
  return true;
}
function _emitRegionBytes(id){
  var R=_rgReg(id);if(!R)return new Uint8Array(0);
  return new Uint8Array(_wasmMem.buffer,R.base,R.length*R.elemSize);
}
_emitExtraImport=(function(extra){return function(name){
  switch(name){
    case'__regionFail':return function(code,d,i,pos){
      var R=_rgByDesc(d),nm=R?R.name:'region',x=_rgMeta&&_rgMeta.pos[pos]&&_rgMeta.pos[pos][1];
      if(code===2)return void _rgRaise('write to frozen region '+nm,pos);
      if(code===4)return void _rgRaise(nm+'[…]'+(x?x.f:'')+'['+i+']: index out of range (length '+(x?x.n:'?')+')',pos);
      _rgRaise(nm+'['+i+']: index out of range (length '+(R?R.length:'?')+')',pos);
    };
    case'__regionOp':return _rgOp;
    case'__regionView':return function(d){var R=_rgByDesc(d);return R?_js_returnWrap(_rgView(R)):0n};
    case'__regionScreen':return _rgScreen;
  }
  return extra(name);
}})(_emitExtraImport);
buildImportObject=(function(build){return function(imports,outputLog){
  _rgSetup(imports); /* before build: its _memReset starts the string area at the new heap base */
  return build.apply(this,arguments);
}})(buildImportObject);
// Repaint the screens after every call from the runtime; a failed bounds / freeze check in frame() is shown
// once per message (frame() keeps being called; the failing call itself stopped at the check).
_emitCallExport=(function(call){return function(inst,name,args,top){
  var r=call.apply(this,arguments);
  if(_rgScreens.length){var redraw=function(){if(_animRunning)_rgDirty=true;else _rgBlitAll()};if(r&&typeof r.then==='function')r.then(redraw,redraw);else redraw()}
  return r;
}})(_emitCallExport);
_emitFrame=(function(frame){return function(){
  try{return frame.apply(this,arguments)}
  catch(e){
    if(!(e&&e.emitRegion))throw e;
    var k=String(e.message);
    if(!_rgFrameSeen.has(k)){_rgFrameSeen.add(k);_jsErr('frame()',e)}
  }
}})(_emitFrame);
if(typeof window!=='undefined'){
  window._emitCallExport=_emitCallExport;
  window._emitRegions=_emitRegions;window._emitRegionRead=_emitRegionRead;window._emitRegionWrite=_emitRegionWrite;
  window._emitRegionFreeze=_emitRegionFreeze;window._emitRegionBytes=_emitRegionBytes;
}

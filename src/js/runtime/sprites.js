// ═══ SPRITES (runtime half; the compiler half is "SPRITES" in the compiler) ═══
// The program's sprites arrive as imports.spriteData (JSON: name, size, fps, palette, frames as w*h pixel
// characters). Each frame is turned into pixels once, when it is first drawn: a Uint32Array of RGBA (for blit)
// and an offscreen canvas (for draw). For other runtime code (things / tiles):
//   _spriteDraw(ctx2d, name, frame, x, y, opts)  frame: a frame name or index; opts {flipX, flipY, scale, alpha,
//                                                 w, h} all optional. Pixel-crisp (no smoothing), x / y rounded.
//                                                 w / h: draw the frame stretched to w x h pixels (a map tile);
//                                                 they win over scale (only one given: the other keeps the shape).
//                                                 An index past the last frame wraps around; a negative index or
//                                                 an unknown name draws nothing. Returns true when it drew.
//   _spriteInfo(name)                             {w, h, frames: [names], fps} or null
//   _spriteRegister(def)                          adds or replaces a sprite: {name, w, h, fps, palette: [hex6],
//                                                 frames: [{name, data}]} (data: w*h chars . 1-9 a-z)
// `name` may also be a sprite's number (its position in the program, as the compiled code passes it).
var _SPR_CH='.123456789abcdefghijklmnopqrstuvwxyz';
var _sprList=[],_sprByName=Object.create(null),_sprWarned=new Set();
function _sprMake(d){
  var pal=new Uint32Array(128);
  (d.palette||[]).forEach(function(h,i){
    var v=parseInt(String(h).replace('#',''),16)||0;
    pal[_SPR_CH.charCodeAt(i+1)]=((255<<24)|((v&255)<<16)|(((v>>8)&255)<<8)|((v>>16)&255))>>>0; /* bytes r g b a, little-endian */
  });
  var S={name:String(d.name),w:Math.max(1,d.w|0),h:Math.max(1,d.h|0),fps:Number(d.fps)>0?Number(d.fps):8,lut:pal,frames:[],byFrame:Object.create(null)};
  (d.frames||[]).forEach(function(f,i){S.frames.push({name:String(f.name||''),data:String(f.data||''),u32:null,cv:null});if(f.name&&!(f.name in S.byFrame))S.byFrame[f.name]=i});
  S.byFrameCI=Object.create(null);S.frames.forEach(function(f,i){var k=f.name.toLowerCase();if(f.name&&!(k in S.byFrameCI))S.byFrameCI[k]=i});
  if(!S.frames.length)S.frames.push({name:'',data:'',u32:null,cv:null});
  return S;
}
function _spriteRegister(d){
  var S=_sprMake(d),old=_sprByName[S.name];
  S.id=old?old.id:_sprList.length;
  _sprList[S.id]=S;_sprByName[S.name]=S;
  return S.id;
}
function _sprSetup(imports){
  _sprList=[];_sprByName=Object.create(null);_sprWarned=new Set();
  var m=null;
  try{if(imports&&typeof imports.spriteData==='string')m=JSON.parse(imports.spriteData)}catch(e){m=null}
  if(m&&m.sprites)m.sprites.forEach(_spriteRegister);
}
function _sprGet(s){
  if(typeof s==='number'||typeof s==='bigint')return _sprList[Number(s)]||null;
  if(s==null)return null;
  var S=_sprByName[String(s)];if(S)return S;
  var k=String(s).toLowerCase();for(var n in _sprByName)if(n.toLowerCase()===k)return _sprByName[n];
  return null;
}
// frame (name or index) → index, or -1
function _sprIx(S,f){
  if(typeof f==='string'){var i=S.byFrame[f];if(i===undefined&&S.byFrameCI)i=S.byFrameCI[f.toLowerCase()];return i===undefined?-1:i}
  var n=Number(f);
  if(!(n>=0)||!isFinite(n))return -1;
  return Math.floor(n)%S.frames.length;
}
function _sprPix(S,i){
  var F=S.frames[i];
  if(!F.u32){
    var n=S.w*S.h,u=new Uint32Array(n),d=F.data,L=S.lut;
    for(var k=0;k<n&&k<d.length;k++){var c=d.charCodeAt(k);u[k]=c<128?L[c]:0}
    F.u32=u;
  }
  return F.u32;
}
function _sprCanvas(S,i){
  var F=S.frames[i];
  if(!F.cv){
    var u=_sprPix(S,i),cv=document.createElement('canvas');
    cv.width=S.w;cv.height=S.h;
    var c=cv.getContext('2d');
    if(c)c.putImageData(new ImageData(new Uint8ClampedArray(u.buffer.slice(0)),S.w,S.h),0,0);
    F.cv=cv;
  }
  return F.cv;
}
function _spriteDraw(ctx,name,frame,x,y,opts){
  var S=_sprGet(name);
  if(!S||!ctx)return false;
  var fi=_sprIx(S,frame==null?0:frame);
  if(fi<0)return false;
  var o=opts||{},sc=o.scale==null?1:Number(o.scale),ow=o.w==null?NaN:Number(o.w),oh=o.h==null?NaN:Number(o.h),w,h;
  if(ow>0&&isFinite(ow)||oh>0&&isFinite(oh)){
    if(!(ow>0&&isFinite(ow)))ow=oh*S.w/S.h;
    if(!(oh>0&&isFinite(oh)))oh=ow*S.h/S.w;
    w=Math.max(1,Math.round(ow));h=Math.max(1,Math.round(oh));
  }else{
    if(!(sc>0)||!isFinite(sc))return false;
    w=Math.max(1,Math.round(S.w*sc));h=Math.max(1,Math.round(S.h*sc));
  }
  var cv=_sprCanvas(S,fi);
  x=Math.round(Number(x)||0);y=Math.round(Number(y)||0);
  ctx.save();
  ctx.imageSmoothingEnabled=false;
  if(o.alpha!=null)ctx.globalAlpha*=Math.max(0,Math.min(1,Number(o.alpha)));
  if(o.flipX||o.flipY){ctx.translate(x+(o.flipX?w:0),y+(o.flipY?h:0));ctx.scale(o.flipX?-1:1,o.flipY?-1:1);ctx.drawImage(cv,0,0,w,h)}
  else ctx.drawImage(cv,x,y,w,h);
  ctx.restore();
  return true;
}
function _spriteInfo(name){
  var S=_sprGet(name);
  return S?{w:S.w,h:S.h,frames:S.frames.map(function(f){return f.name}),fps:S.fps}:null;
}
// A problem while drawing is shown once (a red line), never stops the program.
function _sprWarn(msg){if(_sprWarned.has(msg))return;_sprWarned.add(msg);_jsErr('sprite',new Error(msg))}
// blit: copy a frame into a u8 region (RGBA, w pixels per row), transparent pixels skipped, clipped to the region.
function _sprBlit(id,f,d,x,y,w,pos){
  var S=_sprList[Number(id)];
  if(!S){_sprWarn('blit: there is no sprite number '+id);return 0}
  var R=_rgByDesc(d);
  if(!R)return _rgRaise('blit into an unknown region',pos);
  if(_rgIsFrozen(R))return _rgRaise('write to frozen region '+R.name,pos);
  w=Number(w);
  if(!(w>=1))return _rgRaise('blit('+S.name+', …, '+R.name+', …): the width of the picture must be at least 1, not '+w,pos);
  var fi=_sprIx(S,f);
  if(fi<0)return 0;
  var src=_sprPix(S,fi),H=Math.floor(R.length/4/w),X=Math.round(Number(x)||0),Y=Math.round(Number(y)||0);
  var x0=Math.max(0,X),x1=Math.min(w,X+S.w),y0=Math.max(0,Y),y1=Math.min(H,Y+S.h);
  if(x0>=x1||y0>=y1)return 0;
  var dst=new Uint32Array(_wasmMem.buffer,R.base,H*w);
  for(var yy=y0;yy<y1;yy++){
    var si=(yy-Y)*S.w+(x0-X),di=yy*w+x0;
    for(var xx=x0;xx<x1;xx++,si++,di++){var v=src[si];if(v)dst[di]=v}
  }
  _rgDirty=true;
  return 0;
}
_emitExtraImport=(function(extra){return function(name){
  switch(name){
    case'__sprDraw':return function(id,x,y,f,flip,sc){
      var S=_sprList[Number(id)];
      if(!S)return void _sprWarn('draw: there is no sprite number '+id);
      var c=_need2d();
      if(!c)return void _sprWarn('draw('+S.name+', …): there is no canvas to draw on — call canvas(w, h) first');
      _spriteDraw(c,S.id,f<0n?-1:Number(f),x,y,{flipX:!!flip,scale:sc});
    };
    case'__sprFrame':return function(id,p){
      var S=_sprList[Number(id)],nm=_readStr(p);
      if(!S)return -1n;
      var i=S.byFrame[nm];if(i===undefined&&S.byFrameCI)i=S.byFrameCI[String(nm).toLowerCase()];
      if(i===undefined){_sprWarn('sprite '+S.name+' has no frame "'+nm+'"');return -1n}
      return BigInt(i);
    };
    case'__sprAnim':return function(id,t){
      var S=_sprList[Number(id)];
      if(!S)return 0n;
      var n=S.frames.length,k=Math.floor(Number(t)*S.fps);
      if(!isFinite(k))k=0;
      return BigInt(((k%n)+n)%n);
    };
    case'__sprSize':return function(id,which){var S=_sprList[Number(id)];return S?BigInt(which===0n?S.w:S.h):0n};
    case'__sprBlit':return _sprBlit;
  }
  return extra(name);
}})(_emitExtraImport);
buildImportObject=(function(build){return function(imports,outputLog){
  _sprSetup(imports);
  return build.apply(this,arguments);
}})(buildImportObject);
if(typeof window!=='undefined'){window._spriteDraw=_spriteDraw;window._spriteInfo=_spriteInfo;window._spriteRegister=_spriteRegister}

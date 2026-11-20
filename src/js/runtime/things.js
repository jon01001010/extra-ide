// ═══ THINGS & RULES (runtime half; the compiler half is "THINGS & RULES" in the compiler) ═══
// The program's imports.logicMeta (JSON: stage, kinds with their shape / colour / sprite / map, shown values)
// is read by buildImportObject. The generated code calls the __js__ imports below: __lgIn (input: stick, tap,
// buttons A/B/C, keys, canvas size), __lgFrame (draws the stage, the map, every live thing straight from the
// kinds' regions in WASM memory, and the HUD), __lgSay, __lgShow, __lgPlay, __lgStart, __lgSolid, __lgSpr and
// __lgMap*. Helpers of the other drawer tools are used only when they exist (typeof checks): _spriteDraw /
// _spriteInfo (sprites), _mapDraw / _mapSolidAt / _mapObjects (maps), _ctlState (on-screen controls),
// _sndPlay / _musicPlay (sounds); without them a sprite thing is drawn as a box, there are no solid tiles,
// input is keyboard / touch only and play is silent (one note in the output).
var _lgMeta=null,_lgSay='',_lgSayAt=0,_lgShows=[],_lgTick=0,_lgNoted=Object.create(null),_lgMapList=[],_lgRegCache=null;
function _lgSetup(imports){
  var m=null;
  try{if(imports&&typeof imports.logicMeta==='string')m=JSON.parse(imports.logicMeta)}catch(e){m=null}
  _lgMeta=m;_lgSay='';_lgSayAt=0;_lgShows=[];_lgTick=0;_lgNoted=Object.create(null);_lgMapList=[];_lgRegCache=null;
}
function _lgCtl(){try{if(typeof _ctlState==='function'){var c=_ctlState();if(c&&typeof c==='object')return c}}catch(e){}return null}
function _lgCanvasXY(cx,cy){
  var c=_canvas;if(!c||!c.getBoundingClientRect)return null;
  var r=c.getBoundingClientRect();if(!r.width||!r.height)return null;
  return{x:(cx-r.left)*c.width/r.width,y:(cy-r.top)*c.height/r.height,inside:cx>=r.left&&cx<=r.right&&cy>=r.top&&cy<=r.bottom};
}
function _lgIn(k){
  k=Number(k);
  var c,p;
  if(k>=100)return _keys[k-100]?1:0;
  switch(k){
    case 0:case 1:{
      c=_lgCtl();var v=c?Number(k===0?c.x:c.y)||0:0;
      if(v)return Math.max(-1,Math.min(1,v));
      if(k===0)return(_keys[39]||_keys[68]?1:0)-(_keys[37]||_keys[65]?1:0);
      return(_keys[40]||_keys[83]?1:0)-(_keys[38]||_keys[87]?1:0);
    }
    case 2:case 3:
      c=_lgCtl();
      if(c&&c.tapping&&(c.tapX!=null))return Number(k===2?c.tapX:c.tapY)||0;
      p=_lgCanvasXY(_touch.x,_touch.y);
      return p?(k===2?p.x:p.y):0;
    case 4:
      c=_lgCtl();if(c&&c.tapping)return 1;
      if(!_touch.on)return 0;
      p=_lgCanvasXY(_touch.x,_touch.y);
      return p&&p.inside?1:0;
    case 5:case 6:case 7:
      c=_lgCtl();
      if(c&&c[k===5?'a':k===6?'b':'c'])return 1;
      if(k===5)return _keys[32]||_keys[90]?1:0;
      return _keys[k===6?88:67]?1:0;
    case 10:return _canvas?_canvas.width:(_lgMeta?_lgMeta.stage.w:320);
    case 11:return _canvas?_canvas.height:(_lgMeta?_lgMeta.stage.h:240);
  }
  return 0;
}
// The kind's region: its base, length, element size and field offsets (from the region metadata).
function _lgRegion(K){
  if(!_rgMeta||!_rgMeta.regions)return null;
  if(!_lgRegCache)_lgRegCache=Object.create(null);
  var hit=_lgRegCache[K.struct];if(hit)return hit;
  for(var i=0;i<_rgMeta.regions.length;i++){
    var r=_rgMeta.regions[i],s=r.elem&&r.elem.struct;
    if(!s||(s!==K.struct&&s.slice(-K.struct.length-1)!=='.'+K.struct))continue;
    var off={};r.elem.fields.forEach(function(f){off[f.name]=f.offset});
    return(_lgRegCache[K.struct]={base:r.base,length:r.length,size:r.elemSize,off:off});
  }
  return null;
}
function _lgFmt(v){v=Number(v);return Math.abs(v-Math.round(v))<1e-9?String(Math.round(v)):String(Math.round(v*100)/100)}
function _lgNote(key,msg){
  if(_lgNoted[key])return;_lgNoted[key]=true;
  try{var d=document.createElement('div');d.style.cssText='color:#64748b;padding:2px 12px;font-family:var(--mono);font-size:11px;';d.textContent=msg;var o=document.getElementById('tab-output');if(o)o.appendChild(d)}catch(e){}
}
function _lgDraw(tick,on){
  _lgTick=Number(tick);
  var g=_need2d(),M=_lgMeta;
  if(!g||!M||!_wasmMem)return;
  var W=_canvas.width,H=_canvas.height,dv=new DataView(_wasmMem.buffer);
  g.save();
  g.fillStyle=M.stage.color||'#1a1c2c';g.fillRect(0,0,W,H);
  if(M.stage.map&&typeof _mapDraw==='function'){
    if(typeof _mapInfo==='function'&&!_mapInfo(M.stage.map))_lgNote('map:'+M.stage.map,'stage map '+M.stage.map+': there is no map block '+M.stage.map+' yet — make one with the Drawer\'s STAGE tool');
    try{_mapDraw(g,M.stage.map,0,0)}catch(e){}
  }
  M.kinds.forEach(function(K){
    var R=_lgRegion(K);if(!R)return;
    var o=R.off,info=null;
    if(K.shape==='sprite'&&typeof _spriteInfo==='function'){try{info=_spriteInfo(K.sprite)}catch(e){info=null}}
    var spr=K.shape==='sprite'&&info&&typeof _spriteDraw==='function';
    if(K.shape==='sprite'&&!spr)_lgNote('spr:'+K.sprite,'thing '+K.name+': no sprite named '+K.sprite+' yet — drawn as a box (make one with the Drawer\'s SPRITE tool)');
    for(var i=0;i<R.length;i++){
      var b=R.base+i*R.size;
      if(!dv.getUint8(b+o.alive))continue;
      var x=dv.getFloat64(b+o.x,true),y=dv.getFloat64(b+o.y,true),w=dv.getFloat64(b+o.w,true),h=dv.getFloat64(b+o.h,true),dir=dv.getFloat64(b+o.dir,true);
      var rot=K.track?Math.atan2(dv.getFloat64(b+o.fy,true),dv.getFloat64(b+o.fx,true)):0;
      g.save();
      if(rot){g.translate(x+w/2,y+h/2);g.rotate(rot);g.translate(-x-w/2,-y-h/2)}
      if(spr){
        /* SPRITE's _spriteInfo: frames is the list of frame names; _spriteDraw draws stretched to w x h */
        var fr=dv.getFloat64(b+o.frame,true),n=Math.max(1,Array.isArray(info.frames)?info.frames.length:Number(info.frames)||1),fps=Number(info.fps)||8;
        var f=fr>=0?Math.floor(fr)%n:Math.floor(_lgTick*fps/60)%n;
        try{_spriteDraw(g,K.sprite,f,x,y,{flipX:dir<0&&!K.track,flipY:false,w:w,h:h,alpha:1})}catch(e){}
      }else{
        g.fillStyle=K.color||'#ffffff';
        if(K.shape==='circ'||K.shape==='oval'){g.beginPath();g.ellipse(x+w/2,y+h/2,Math.max(0,w/2),Math.max(0,h/2),0,0,Math.PI*2);g.fill()}
        else g.fillRect(x,y,w,h);
      }
      g.restore();
    }
  });
  g.textBaseline='top';g.font='bold 12px monospace';g.textAlign='left';
  for(var s=0;s<M.shows.length;s++){
    var t=M.shows[s]+' '+_lgFmt(_lgShows[s]||0);
    g.fillStyle='rgba(0,0,0,0.5)';g.fillText(t,7,7+s*16);g.fillStyle='#ffffff';g.fillText(t,6,6+s*16);
  }
  if(_lgSay&&(!on||_lgTick-_lgSayAt<150)){
    g.font='bold 18px sans-serif';g.textAlign='center';g.textBaseline='middle';
    var tw=g.measureText(_lgSay).width;
    g.fillStyle='rgba(0,0,0,0.6)';g.fillRect(W/2-tw/2-12,H/2-18,tw+24,36);
    g.fillStyle='#ffffff';g.fillText(_lgSay,W/2,H/2);
  }
  if(!on){g.font='12px sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillStyle='#cbd5e1';g.fillText('tap to play again',W/2,H/2+30)}
  g.restore();
}
function _lgSolidAt(x,y,w,h){
  var M=_lgMeta;if(!M||!M.stage.map||typeof _mapSolidAt!=='function')return 0;
  if(typeof _mapInfo==='function'&&!_mapInfo(M.stage.map))return 0;   /* STAGE counts every point of an unknown map as solid */
  var st=8,nx=Math.max(1,Math.ceil(w/st)),ny=Math.max(1,Math.ceil(h/st));
  try{
    for(var i=0;i<=nx;i++)for(var j=0;j<=ny;j++){
      var px=Math.min(x+i*st,x+w-0.01),py=Math.min(y+j*st,y+h-0.01);
      if(_mapSolidAt(M.stage.map,px,py))return 1;
    }
  }catch(e){}
  return 0;
}
_emitExtraImport=(function(extra){return function(name){
  switch(name){
    case'__lgIn':return _lgIn;
    case'__lgFrame':return function(t,on){_lgDraw(t,Number(on))};
    case'__lgSay':return function(p){_lgSay=_readStr(p);_lgSayAt=_lgTick};
    case'__lgShow':return function(i,v){_lgShows[Number(i)]=v};
    case'__lgStart':return function(){_lgSay='';_lgSayAt=0;return BigInt(Math.floor(Math.random()*2147483647))};
    case'__lgPlay':return function(p,music){
      var n=_readStr(p);music=Number(music);
      try{
        if(typeof _sndFind==='function'&&!_sndFind(music?'music':'sound',n))return void _lgNote('snd:'+n,(music?'music ':'play ')+n+': there is no '+(music?'music':'sound')+' block '+n+' — make one with the Drawer\'s '+(music?'Music':'Sound')+' tool (the rule is silent)');
        if(music&&typeof _musicPlay==='function')return void _musicPlay(n);
        if(typeof _sndPlay==='function')return void _sndPlay(n);
      }catch(e){}
      _lgNote('snd:'+n,(music?'music ':'play ')+n+': no sound helper in this page — the rule is silent (add sounds with the Drawer\'s SOUND tool)');
    };
    case'__lgSolid':return _lgSolidAt;
    case'__lgSpr':return function(k,what){
      var K=_lgMeta&&_lgMeta.kinds[Number(k)];what=Number(what);
      try{if(K&&typeof _spriteInfo==='function'){var i=_spriteInfo(K.sprite);if(i&&i.w)return Number(what?i.h:i.w)||16}}catch(e){}
      return 16;
    };
    case'__lgMapQ':return function(k){
      var K=_lgMeta&&_lgMeta.kinds[Number(k)];_lgMapList=[];
      try{if(K&&K.map&&typeof _mapObjects==='function')_lgMapList=(_mapObjects(K.map)||[]).filter(function(o){return o&&String(o.kind).toLowerCase()===String(K.name).toLowerCase()})}catch(e){_lgMapList=[]}
      if(K&&K.map&&typeof _mapInfo==='function'&&!_mapInfo(K.map))_lgNote('map:'+K.map,'thing '+K.name+': from map '+K.map+' — there is no map block '+K.map+' yet, so none are placed (make one with the Drawer\'s STAGE tool)');
      if(K&&K.map&&typeof _mapObjects!=='function')_lgNote('map:'+K.map,'thing '+K.name+': from map '+K.map+' — no map helper in this page, so none are placed (make maps with the Drawer\'s MAP tool)');
      return BigInt(_lgMapList.length);
    };
    /* STAGE's _mapObjects: x / y in tiles, px / py in pixels (things are placed in pixels) */
    case'__lgMapAt':return function(j,what){var o=_lgMapList[Number(j)];if(!o)return 0;var v=Number(what)?(o.py!=null?o.py:o.y):(o.px!=null?o.px:o.x);return Number(v)||0};
    case'__lgMapProp':return function(j,p,v){var o=_lgMapList[Number(j)],n=_readStr(p);if(o&&o.props&&o.props[n]!=null&&isFinite(Number(o.props[n])))return Number(o.props[n]);return v};
  }
  return extra(name);
}})(_emitExtraImport);
buildImportObject=(function(build){return function(imports,outputLog){
  _lgSetup(imports);
  return build.apply(this,arguments);
}})(buildImportObject);

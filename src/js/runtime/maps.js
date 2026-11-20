// ═══ MAPS & CONTROLS (runtime half; the compiler half is the "MAPS & CONTROLS" script near the end of the page) ═══
// The compiler hands the program's `map` and `controls` blocks over as imports.stageMeta (JSON, like regionMeta):
//   {v:1, maps:[{name,w,h,tile,legend:{ch:{name,solid,color?,sprite?}},rows:[str],objects:[{kind,x,y,props}]}],
//    controls:[{name,stick:'left'|'right'|'none',dpad,buttons:[{id,label}],side,size,opacity,keys,deadzone}]}
// Map number i / controls number i in the program are index i of these lists (a map name compiles to its number).
// Helpers for other runtime code (exported with the program): _mapInfo(name) _mapTile(name,tx,ty)
// _mapSolidAt(name,px,py) _mapDraw(ctx2d,name,ox,oy) _mapObjects(name) _ctlState().
var _stMaps=[],_stCtls=[],_stErrSeen=new Set();
var _stIn={tx:0,ty:0,tp:null,down:{A:0,B:0,C:0},edge:{A:false,B:false,C:false},kb:{},kbBtn:{A:false,B:false,C:false},tapX:0,tapY:0,tapping:false,tapP:null,ctl:null,el:null};
function _stErr(what,msg){var k=what+'|'+msg;if(_stErrSeen.has(k))return;_stErrSeen.add(k);_jsErr(what,new Error(msg))}
function _stSetup(imports){
  var m=null;
  try{if(imports&&typeof imports.stageMeta==='string')m=JSON.parse(imports.stageMeta)}catch(e){m=null}
  _stMaps=[];_stCtls=[];_stErrSeen=new Set();
  if(m){
    (m.maps||[]).forEach(function(d){_stMaps.push({name:d.name,w:d.w,h:d.h,tile:d.tile,legend:d.legend||{},rows:(d.rows||[]).map(function(r){return Array.from(r)}),objects:d.objects||[]})});
    _stCtls=m.controls||[];
  }
  _stCtlHide();
  _stIn.tx=0;_stIn.ty=0;_stIn.tp=null;_stIn.down={A:0,B:0,C:0};_stIn.edge={A:false,B:false,C:false};_stIn.kb={};_stIn.kbBtn={A:false,B:false,C:false};
  _stIn.tapX=0;_stIn.tapY=0;_stIn.tapping=false;_stIn.tapP=null;
}
function _stMapBy(name){for(var i=0;i<_stMaps.length;i++)if(_stMaps[i].name===name)return _stMaps[i];var k=String(name).toLowerCase();for(i=0;i<_stMaps.length;i++)if(String(_stMaps[i].name).toLowerCase()===k)return _stMaps[i];return null}
function _stMapN(id,what){var m=_stMaps[Number(id)];if(!m)_stErr(what,'there is no map number '+String(id)+' in this program');return m||null}
function _stTileOf(m,tx,ty){tx=Math.floor(tx);ty=Math.floor(ty);if(!m||!(tx>=0&&ty>=0&&tx<m.w&&ty<m.h))return'';return m.rows[ty][tx]}
function _stSolidOf(m,px,py){
  if(!m||!isFinite(px)||!isFinite(py))return true;
  var tx=Math.floor(px/m.tile),ty=Math.floor(py/m.tile);
  if(tx<0||ty<0||tx>=m.w||ty>=m.h)return true;   /* outside the map counts as solid */
  var e=m.legend[m.rows[ty][tx]];return!!(e&&e.solid);
}
function _stDrawOf(c,m,ox,oy){
  if(!c||!m)return;
  ox=Number(ox)||0;oy=Number(oy)||0;
  var t=m.tile,cw=c.canvas?c.canvas.width:1e9,ch=c.canvas?c.canvas.height:1e9;
  var x0=Math.max(0,Math.floor(-ox/t)),y0=Math.max(0,Math.floor(-oy/t)),x1=Math.min(m.w,Math.ceil((cw-ox)/t)),y1=Math.min(m.h,Math.ceil((ch-oy)/t));
  var spr=typeof _spriteDraw==='function'?_spriteDraw:null;
  c.save();
  try{
    for(var y=y0;y<y1;y++)for(var x=x0;x<x1;x++){
      var e=m.legend[m.rows[y][x]];if(!e)continue;
      var px=ox+x*t,py=oy+y*t,done=false;
      if(e.sprite&&spr){try{done=spr(c,e.sprite,0,px,py,{w:t,h:t})!==false}catch(er){done=false}}
      if(!done&&(e.color||e.sprite)){c.fillStyle=e.color||'#808080';c.fillRect(px,py,t,t)}
    }
  }finally{c.restore()}
}
function _stObjsOf(m){return m?m.objects.map(function(o){var p={};for(var k in o.props)p[k]=o.props[k];return{kind:o.kind,x:o.x,y:o.y,px:o.x*m.tile,py:o.y*m.tile,props:p}}):[]}
function _mapInfo(name){
  var m=_stMapBy(name);if(!m)return null;
  var lg={};for(var k in m.legend){var e=m.legend[k],o={name:e.name,solid:!!e.solid};if(e.sprite)o.sprite=e.sprite;if(e.color)o.color=e.color;lg[k]=o}
  return{w:m.w,h:m.h,tile:m.tile,legend:lg};
}
function _mapTile(name,tx,ty){return _stTileOf(_stMapBy(name),tx,ty)}
function _mapSolidAt(name,px,py){return _stSolidOf(_stMapBy(name),Number(px),Number(py))}
function _mapDraw(ctx2d,name,ox,oy){_stDrawOf(ctx2d,_stMapBy(name),ox,oy)}
function _mapObjects(name){return _stObjsOf(_stMapBy(name))}
function _stBtnOn(b){return _stIn.down[b]>0||_stIn.kbBtn[b]}
function _stAxis(){
  var c=_stIn.ctl,kx=0,ky=0;
  if(!c||c.keys!==false){var k=_stIn.kb;kx=(k.right?1:0)-(k.left?1:0);ky=(k.down?1:0)-(k.up?1:0)}
  if(kx&&ky){kx*=Math.SQRT1_2;ky*=Math.SQRT1_2}
  return{x:Math.max(-1,Math.min(1,_stIn.tx+kx)),y:Math.max(-1,Math.min(1,_stIn.ty+ky))};
}
function _ctlState(){var a=_stAxis();return{x:a.x,y:a.y,a:_stBtnOn('A'),b:_stBtnOn('B'),c:_stBtnOn('C'),tapX:_stIn.tapX,tapY:_stIn.tapY,tapping:_stIn.tapping}}
function _stPress(b){if(!_stBtnOn(b))_stIn.edge[b]=true}
function _stPressIn(st,b){if(st===_stIn)_stPress(b);else if(!(st.down[b]>0))st.edge[b]=true}
function _stEdgeClear(){_stIn.edge.A=_stIn.edge.B=_stIn.edge.C=false}
// ── the on-screen overlay: a sticky layer at the bottom of the output area; only the stick / pad and the
//    buttons take touches (touch-action:none), everything around them lets the page scroll as usual ──
function _stCtlHide(){if(_stIn.el&&_stIn.el.parentNode)_stIn.el.parentNode.removeChild(_stIn.el);_stIn.el=null;_stIn.ctl=null;_stIn.tx=_stIn.ty=0;_stIn.tp=null;_stIn.down={A:0,B:0,C:0}}
function _stCtlShow(c){
  var out=document.getElementById('tab-output');
  if(!out)return;
  if(_stIn.el&&_stIn.ctl===c&&_stIn.el.isConnected)return;
  _stCtlHide();
  var wrap=_stCtlBuild(c,_stIn);
  out.appendChild(wrap);
  _stIn.el=wrap;_stIn.ctl=c;
}
// Builds the overlay of controls c; touches update st (tx, ty, tp, down, edge — _stIn for a program, the
// CONTROLS tool passes its own). Returns the outer element (sticky, height 0; the layer hangs above it).
function _stCtlBuild(c,st){
  var sz=Math.max(0.4,Math.min(2.5,Number(c.size)||1)),op=Math.max(0.05,Math.min(1,c.opacity==null?0.5:Number(c.opacity)));
  var D=Math.round(120*sz),K=Math.round(52*sz),B=Math.round(62*sz),M=Math.round(16*sz),H=Math.max(D,B*2+Math.round(30*sz))+M*2;
  var wrap=document.createElement('div');
  wrap.className='emit-controls';wrap.setAttribute('data-emit-controls',c.name);
  wrap.style.cssText='position:sticky;bottom:0;left:0;right:0;height:0;z-index:20;pointer-events:none;';
  var layer=document.createElement('div');
  layer.style.cssText='position:absolute;left:0;right:0;bottom:0;height:'+H+'px;pointer-events:none;opacity:'+op+';';
  wrap.appendChild(layer);
  var side=c.stick==='right'?'right':'left';
  if(c.stick!=='none'){
    var base=document.createElement('div');base.setAttribute('data-ctl',c.dpad?'dpad':'stick');
    base.style.cssText='position:absolute;bottom:'+M+'px;'+side+':'+M+'px;width:'+D+'px;height:'+D+'px;border-radius:'+(c.dpad?'22%':'50%')+';background:rgba(255,255,255,.14);border:2px solid rgba(255,255,255,.45);box-sizing:border-box;pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none;';
    var knob=document.createElement('div');
    knob.style.cssText='position:absolute;left:'+((D-K)/2-2)+'px;top:'+((D-K)/2-2)+'px;width:'+K+'px;height:'+K+'px;border-radius:'+(c.dpad?'18%':'50%')+';background:rgba(255,255,255,.6);pointer-events:none;';
    if(c.dpad){
      knob.style.background='rgba(255,255,255,.35)';
      [['▲','left:50%;top:4%;transform:translateX(-50%)'],['▼','left:50%;bottom:4%;transform:translateX(-50%)'],['◀','left:5%;top:50%;transform:translateY(-50%)'],['▶','right:5%;top:50%;transform:translateY(-50%)']].forEach(function(a){
        var s=document.createElement('span');s.textContent=a[0];s.style.cssText='position:absolute;'+a[1]+';color:#fff;font:'+Math.round(18*sz)+'px sans-serif;pointer-events:none;';base.appendChild(s);
      });
    }
    base.appendChild(knob);
    var dz=c.deadzone==null?0.15:Math.max(0,Math.min(0.9,Number(c.deadzone)));
    var upd=function(e){
      var r=base.getBoundingClientRect(),R=r.width/2||1,dx=(e.clientX-r.left-R)/R,dy=(e.clientY-r.top-R)/R,len=Math.sqrt(dx*dx+dy*dy);
      if(len>1){dx/=len;dy/=len;len=1}
      var x=0,y=0;
      if(len>dz){
        if(c.dpad){x=Math.abs(dx)>0.38*len?(dx>0?1:-1):0;y=Math.abs(dy)>0.38*len?(dy>0?1:-1):0}
        else{var k=(len-dz)/(1-dz)/len;x=dx*k;y=dy*k}
      }
      st.tx=x;st.ty=y;
      knob.style.transform='translate('+(c.dpad?x*D*0.22:dx*(D-K)/2)+'px,'+(c.dpad?y*D*0.22:dy*(D-K)/2)+'px)';
    };
    var end=function(e){if(e.pointerId!==st.tp)return;st.tp=null;st.tx=st.ty=0;knob.style.transform=''};
    base.addEventListener('pointerdown',function(e){if(st.tp!==null)return;st.tp=e.pointerId;try{base.setPointerCapture(e.pointerId)}catch(x){}upd(e);e.preventDefault()});
    base.addEventListener('pointermove',function(e){if(e.pointerId===st.tp)upd(e)});
    base.addEventListener('pointerup',end);base.addEventListener('pointercancel',end);base.addEventListener('lostpointercapture',end);
    layer.appendChild(base);
  }
  var bs=c.buttons||[],bside=c.side||(side==='left'?'right':'left');
  if(c.stick==='none'&&!c.side)bside='right';
  var spots=[[0,B*0.5],[B*1.2,0],[B*0.45,B*1.55]];
  bs.forEach(function(b,i){
    var el=document.createElement('div'),held=new Set();el.setAttribute('data-ctl',b.id);
    var lbl=b.label||b.id,fs=Math.round((lbl.length>2?13:20)*sz);
    el.textContent=lbl;
    el.style.cssText='position:absolute;bottom:'+(M+spots[i][1])+'px;'+bside+':'+(M+spots[i][0])+'px;width:'+B+'px;height:'+B+'px;border-radius:50%;background:rgba(255,255,255,.16);border:2px solid rgba(255,255,255,.5);box-sizing:border-box;color:#fff;font:600 '+fs+'px sans-serif;display:flex;align-items:center;justify-content:center;overflow:hidden;white-space:nowrap;pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none;';
    var look=function(){el.style.background=held.size?'rgba(255,255,255,.55)':'rgba(255,255,255,.16)'};
    el.addEventListener('pointerdown',function(e){if(held.has(e.pointerId))return;if(!held.size)_stPressIn(st,b.id);held.add(e.pointerId);st.down[b.id]=held.size;try{el.setPointerCapture(e.pointerId)}catch(x){}look();e.preventDefault()});
    var up=function(e){if(!held.delete(e.pointerId))return;st.down[b.id]=held.size;look()};
    el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);el.addEventListener('lostpointercapture',up);
    el.addEventListener('contextmenu',function(e){e.preventDefault()});
    layer.appendChild(el);
  });
  return wrap;
}
// keyboard: arrows / WASD move the stick, Z / Space = A, X = B, C = C (not while typing in a text field)
(function(){
  if(typeof document==='undefined')return;
  var DIR={ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowUp:'up',KeyW:'up',ArrowDown:'down',KeyS:'down'},BTN={KeyZ:'A',Space:'A',KeyX:'B',KeyC:'C'};
  var KC={37:'ArrowLeft',38:'ArrowUp',39:'ArrowRight',40:'ArrowDown',65:'KeyA',87:'KeyW',68:'KeyD',83:'KeyS',90:'KeyZ',32:'Space',88:'KeyX',67:'KeyC'};
  function typing(e){var t=e.target,n=t&&t.tagName;return n==='INPUT'||n==='TEXTAREA'||n==='SELECT'||!!(t&&t.isContentEditable)}
  function key(e,on){
    if(typing(e))return;
    var code=e.code||KC[e.keyCode]||'';
    if(DIR[code]){_stIn.kb[DIR[code]]=on;return}
    var b=BTN[code];if(!b)return;
    if(_stIn.ctl&&_stIn.ctl.keys===false)return;
    if(on){if(e.repeat)return;if(!_stIn.kbBtn[b])_stPress(b);_stIn.kbBtn[b]=true}
    else _stIn.kbBtn[b]=false;
  }
  document.addEventListener('keydown',function(e){key(e,true)});
  document.addEventListener('keyup',function(e){key(e,false)});
  if(typeof window!=='undefined')window.addEventListener('blur',function(){_stIn.kb={};_stIn.kbBtn={A:false,B:false,C:false}});
  // taps on the program's canvas (not on the controls): _ctlState().tapX / tapY in canvas pixels
  function tapAt(e){
    var cv=e.target;if(!cv||cv.tagName!=='CANVAS'||!cv.closest||!cv.closest('#tab-output'))return false;
    var r=cv.getBoundingClientRect();if(!r.width||!r.height)return false;
    _stIn.tapX=(e.clientX-r.left)*cv.width/r.width;_stIn.tapY=(e.clientY-r.top)*cv.height/r.height;return true;
  }
  document.addEventListener('pointerdown',function(e){if(_stIn.tapP===null&&tapAt(e)){_stIn.tapP=e.pointerId;_stIn.tapping=true}},true);
  document.addEventListener('pointermove',function(e){if(e.pointerId===_stIn.tapP)tapAt(e)},true);
  var tapEnd=function(e){if(e.pointerId===_stIn.tapP){_stIn.tapP=null;_stIn.tapping=false}};
  document.addEventListener('pointerup',tapEnd,true);document.addEventListener('pointercancel',tapEnd,true);
})();
function _stImport(name){
  switch(name){
    case'drawMap':return function(id,ox,oy){var m=_stMapN(id,'drawMap');if(m)_stDrawOf(_need2d(),m,ox,oy)};
    case'tileAt':return function(id,tx,ty){var m=_stMapN(id,'tileAt');return _writeStr(m?_stTileOf(m,Number(tx),Number(ty)):'')};
    case'solidAt':return function(id,px,py){var m=_stMapN(id,'solidAt');return m&&_stSolidOf(m,Number(px),Number(py))?1:0};
    case'mapW':return function(id){var m=_stMapN(id,'mapW');return BigInt(m?m.w:0)};
    case'mapH':return function(id){var m=_stMapN(id,'mapH');return BigInt(m?m.h:0)};
    case'tileSize':return function(id){var m=_stMapN(id,'tileSize');return BigInt(m?m.tile:0)};
    case'setTile':return function(id,tx,ty,p){
      var m=_stMapN(id,'setTile');if(!m)return;
      var x=Number(tx),y=Number(ty),ch=Array.from(_readStr(Number(p)));
      if(!(x>=0&&y>=0&&x<m.w&&y<m.h))return void _stErr('setTile','('+x+', '+y+') is outside map '+m.name+' ('+m.w+'x'+m.h+')');
      if(ch.length!==1||(ch[0]!==' '&&!m.legend[ch[0]]))return void _stErr('setTile','"'+ch.join('')+'" is not a tile of map '+m.name+' — use one of its legend characters: '+Object.keys(m.legend).join(' '));
      m.rows[y][x]=ch[0];
    };
    case'objCount':return function(id,k){var m=_stMapN(id,'objCount'),kind=_readStr(Number(k)).toLowerCase(),n=0;if(m)m.objects.forEach(function(o){if(String(o.kind).toLowerCase()===kind)n++});return BigInt(n)};
    case'objX':case'objY':var ax=name==='objX'?'x':'y';return function(id,k,i){
      var m=_stMapN(id,'obj'+ax.toUpperCase());if(!m)return 0;
      var kind=_readStr(Number(k)),list=m.objects.filter(function(o){return String(o.kind).toLowerCase()===kind.toLowerCase()}),o=list[Number(i)];
      if(!o){_stErr('obj'+ax.toUpperCase(),'map '+m.name+' has '+list.length+' "'+kind+'" object'+(list.length===1?'':'s')+' — there is no number '+String(i));return 0}
      return o[ax]*m.tile;
    };
    case'useControls':return function(id){var c=_stCtls[Number(id)];if(!c)return void _stErr('useControls','there are no controls number '+String(id)+' in this program');_stCtlShow(c)};
    case'stickX':return function(){return _stAxis().x};
    case'stickY':return function(){return _stAxis().y};
    case'pressed':return function(p){var b=_readStr(Number(p));if(/^[abc]$/.test(b))b=b.toUpperCase();return _stBtnOn(b)?1:0};
    case'justPressed':return function(p){var b=_readStr(Number(p));if(/^[abc]$/.test(b))b=b.toUpperCase();var v=!!_stIn.edge[b];if(!_animRunning)_stIn.edge[b]=false;return v?1:0};
  }
  return null;
}
buildImportObject=(function(build){return function(imports,outputLog){
  _stSetup(imports);
  var obj=build.apply(this,arguments);
  if(imports.stageMeta)for(var i=0;i<imports.length;i++){var imp=imports[i];if(imp.module==='std'){var f=_stImport(imp.name);if(f)obj.std[imp.name]=f}}
  return obj;
}})(buildImportObject);
_emitFrame=(function(frame){return function(){try{return frame.apply(this,arguments)}finally{_stEdgeClear()}}})(_emitFrame);
if(typeof window!=='undefined'){window._mapInfo=_mapInfo;window._mapTile=_mapTile;window._mapSolidAt=_mapSolidAt;window._mapDraw=_mapDraw;window._mapObjects=_mapObjects;window._ctlState=_ctlState}

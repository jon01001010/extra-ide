// ═══ HUD & PARTICLES (runtime half; the compiler half is "HUD & PARTICLES" in the compiler) ═══
// Each half sits between its own markers: an exported program carries the particles part only when it uses
// particles (imports.fxMeta) and the HUD part only when it uses a HUD or say() (imports.hudMeta) — see
// _exportRuntime. Both draw on the program's canvas after every frame (and after a call when the program does
// not animate): first the particles, then the HUD, in canvas pixels. A screen(…) canvas is painted by the
// region blit, so there they are drawn right after the blit. The drawer tools use the same painters:
//   _hudPaintSpec(ctx2d, W, H, items, val(ref) → value)   _hudText(ctx2d, text, x, y, size, color)
//   _fxWorld() → {spawn(spec, x, y, n), step(dt), draw(ctx2d), emitter(spec, x, y), move(h, x, y), stop(h), n()}
//#emit-fx-begin — particles; removed from exports of programs without particles blocks
var _FX_CAP=2000;
function _fxRnd(r){return r[0]+(r[1]-r[0])*Math.random()}
function _fxWorld(){
  var N=0,X=new Float32Array(_FX_CAP),Y=new Float32Array(_FX_CAP),VX=new Float32Array(_FX_CAP),VY=new Float32Array(_FX_CAP),
      AGE=new Float32Array(_FX_CAP),LIFE=new Float32Array(_FX_CAP),SP=[],COL=new Array(_FX_CAP),em=new Map(),next=1;
  function spawn(s,x,y,n){
    if(!s)return 0;
    n=Math.max(0,Math.floor(n));var made=0,cols=s.colors&&s.colors.length?s.colors:['#ffffff'],area=s.area||[0,0];
    for(var k=0;k<n&&N<_FX_CAP;k++){
      var a=_fxRnd(s.angle)*Math.PI/180,v=_fxRnd(s.speed);
      X[N]=x+(Math.random()-0.5)*area[0];Y[N]=y+(Math.random()-0.5)*area[1];
      VX[N]=Math.cos(a)*v;VY[N]=-Math.sin(a)*v;AGE[N]=0;LIFE[N]=Math.max(0.01,_fxRnd(s.life));
      SP[N]=s;COL[N]=cols[Math.floor(Math.random()*cols.length)%cols.length];N++;made++;
    }
    return made;
  }
  function step(dt){
    dt=Number(dt);if(!(dt>0))return;
    em.forEach(function(e){
      if(!e.on)return;
      e.acc+=dt*(e.s.loop?e.s.rate:(e.s.rate||e.s.count));
      var k=Math.floor(e.acc);if(k>0){e.acc-=k;spawn(e.s,e.x,e.y,k)}
    });
    for(var i=0;i<N;i++){
      var s=SP[i];
      AGE[i]+=dt;
      if(AGE[i]>=LIFE[i]){N--;if(i<N){X[i]=X[N];Y[i]=Y[N];VX[i]=VX[N];VY[i]=VY[N];AGE[i]=AGE[N];LIFE[i]=LIFE[N];SP[i]=SP[N];COL[i]=COL[N]}SP[N]=null;i--;continue}
      if(s.gravity)VY[i]+=s.gravity*dt;
      if(s.drag){var f=Math.exp(-s.drag*dt);VX[i]*=f;VY[i]*=f}
      X[i]+=VX[i]*dt;Y[i]+=VY[i]*dt;
    }
  }
  function draw(g){
    if(!g||!N)return;
    g.save();g.imageSmoothingEnabled=false;
    var a0=g.globalAlpha,fs=null;
    for(var i=0;i<N;i++){
      var s=SP[i],t=AGE[i]/LIFE[i],sz=s.size[0]+(s.size[1]-s.size[0])*t;
      if(!(sz>0.05))continue;
      g.globalAlpha=a0*(s.fade?Math.max(0,1-t):1);
      if(COL[i]!==fs){fs=COL[i];g.fillStyle=fs}
      if(s.shape==='circle'&&sz>2.5){g.beginPath();g.arc(X[i],Y[i],sz/2,0,Math.PI*2);g.fill()}
      else{var q=Math.max(1,Math.round(sz));g.fillRect(Math.round(X[i]-q/2),Math.round(Y[i]-q/2),q,q)}
    }
    g.restore();
  }
  return{
    spawn:spawn,step:step,draw:draw,n:function(){return N},
    emitter:function(s,x,y){var h=next++;em.set(h,{s:s,x:Number(x)||0,y:Number(y)||0,acc:0,on:true});return h},
    move:function(h,x,y){var e=em.get(h);if(e){e.x=Number(x)||0;e.y=Number(y)||0}return!!e},
    stop:function(h){return em.delete(h)},
    emitters:function(){return em.size},
    clear:function(){N=0;em.clear();for(var i=0;i<SP.length;i++)SP[i]=null}
  };
}
var _fxW=null,_fxSpecs=Object.create(null),_fxT=0,_fxNoted=Object.create(null);
function _fxSetup(imports){
  if(_fxW)_fxW.clear();
  _fxSpecs=Object.create(null);_fxT=0;_fxNoted=Object.create(null);
  var m=null;try{if(imports&&typeof imports.fxMeta==='string')m=JSON.parse(imports.fxMeta)}catch(e){m=null}
  if(!m){_fxW=null;return}
  _fxW=_fxWorld();
  Object.keys(m.fx||{}).forEach(function(k){_fxSpecs[k.toLowerCase()]=m.fx[k]});
}
function _fxFind(n){
  var s=_fxSpecs[String(n).toLowerCase()];
  if(!s&&!_fxNoted[n]){_fxNoted[n]=true;try{var d=document.createElement('div');d.style.cssText='color:#64748b;padding:2px 12px;font-family:var(--mono);font-size:11px;';d.textContent='particles "'+n+'": there is no particles block with this name — nothing is drawn';var o=document.getElementById('tab-output');if(o)o.appendChild(d)}catch(e){}}
  return s||null;
}
function _fxTick(){
  if(!_fxW)return;
  var now=(typeof performance!=='undefined'?performance.now():Date.now()),dt=_fxT?(now-_fxT)/1000:1/60;
  if(!(dt>0)||dt>0.1)dt=1/60;
  _fxT=now;_fxW.step(dt);
}
function _fxPaint(g){if(_fxW&&g)_fxW.draw(g)}
_emitFrame=(function(frame){return function(){
  try{return frame.apply(this,arguments)}
  finally{if(_fxW){_fxTick();if(_canvas&&!(_canvas.hasAttribute&&_canvas.hasAttribute('data-emit-screen')))_fxPaint(_need2d())}}
}})(_emitFrame);
_rgBlit1=(function(blit){return function(s){var r=blit.apply(this,arguments);if(_fxW&&s&&s.cv===_canvas)_fxPaint(s.ctx);return r}})(_rgBlit1);
buildImportObject=(function(build){return function(imports,outputLog){
  _fxSetup(imports);
  var obj=build.apply(this,arguments),s=obj.std;
  if(s){
    if(s.burst)s.burst=function(p,x,y){var f=_fxFind(_readStr(Number(p)));if(f&&_fxW)_fxW.spawn(f,Number(x),Number(y),f.count)};
    if(s.emitter)s.emitter=function(p,x,y){var f=_fxFind(_readStr(Number(p)));return f&&_fxW?BigInt(_fxW.emitter(f,x,y)):0n};
    if(s.moveEmitter)s.moveEmitter=function(h,x,y){if(_fxW)_fxW.move(Number(h),x,y)};
    if(s.stopEmitter)s.stopEmitter=function(h){if(_fxW)_fxW.stop(Number(h))};
  }
  return obj;
}})(buildImportObject);
if(typeof window!=='undefined'){window._fxWorld=_fxWorld;window._fxLive=function(){return _fxW?_fxW.n():0}}
//#emit-fx-end
//#emit-hud-begin — the HUD and say(); removed from exports of programs without hud blocks or HUD builtins
// The pixel font: 5×7 (8 rows with descenders), proportional. Per character 32…126: its width (1-5), then 8
// rows as base-32 digits (bit x = column x).
var _HUD_FONT='3000000001111110103550000005aavavaa054u5ekf4053j842po056952l9m0111000000221111120212222210504lel4005044v44002000002214000f000010000001050g8421005ehpljhe03232222705ehg842v05v848ghe058ca9v8805v1fgghe05c21fhhe05vg8422205ehhehhe05ehhug860100100100200200210484212480400f0f0004124842105ehg840405ehtlt1e05ehhvhhh05fhhfhhf05eh111he0579hhh9705v11f11v05v11f11105eh1thhu05hhhvhhh03722222705s88889605h95359h05111111v05hrllhhh05hhjlphh05ehhhhhe05fhhf11105ehhhl9m05fhhf59h05u11eggf05v44444405hhhhhhe05hhhhha405hhhllla05hha4ahh05hhha44405vg8421v0231111130501248g0023222223054ah000005000000v0212000000500eguhu0511djhhf0400e111e05ggmphhu0500ehv1e04c2722220500uhhuge511djhhh0110111110340444452411953590332222270500bllll0400799990400699960400799711400e99e88400d31110400e168704227222c04009999e0500hhha40500hhlla0400996990400999e86400f861f03422122401111111103122422105002l8000';
var _HUD_B32='0123456789abcdefghijklmnopqrstuv';
function _hudGlyph(ch){var c=ch.charCodeAt(0);if(c<32||c>126)c=63;return(c-32)*9}
function _hudTextW(s){var w=0;s=String(s);for(var i=0;i<s.length;i++)w+=Number(_HUD_FONT[_hudGlyph(s[i])])+1;return Math.max(0,w-1)}
var _hudCache=new Map();
// The text drawn once into a small canvas (with a 1-pixel shadow), then scaled up without smoothing
function _hudTextCv(s,color){
  var key=color+'\u0000'+s,cv=_hudCache.get(key);
  if(cv)return cv;
  if(_hudCache.size>96)_hudCache.clear();
  var w=_hudTextW(s);
  cv=document.createElement('canvas');cv.width=Math.max(1,w+1);cv.height=9;
  var g=cv.getContext('2d');
  if(g){
    for(var pass=0;pass<2;pass++){
      g.fillStyle=pass?color:'rgba(0,0,0,0.6)';
      var x=pass?0:1,y0=pass?0:1;
      for(var i=0;i<s.length;i++){
        var o=_hudGlyph(s[i]),gw=Number(_HUD_FONT[o]);
        for(var r=0;r<8;r++){var b=_HUD_B32.indexOf(_HUD_FONT[o+1+r]);for(var c=0;c<gw;c++)if(b>>c&1)g.fillRect(x+c,y0+r,1,1)}
        x+=gw+1;
      }
    }
  }
  _hudCache.set(key,cv);
  return cv;
}
function _hudText(g,s,x,y,size,color){
  s=String(s);if(!s||!g)return;
  var cv=_hudTextCv(s,color||'#ffffff');size=Math.max(1,Math.round(size||1));
  g.save();g.imageSmoothingEnabled=false;g.drawImage(cv,Math.round(x),Math.round(y),cv.width*size,cv.height*size);g.restore();
}
function _hudFmt(v){
  if(typeof v==='bigint')return v.toString();
  if(typeof v==='boolean')return v?'true':'false';
  if(typeof v==='number')return Math.abs(v-Math.round(v))<1e-9?String(Math.round(v)):String(Math.round(v*100)/100);
  return String(v);
}
// The size of an item (canvas pixels) and how to draw it
function _hudMeasure(it,val){
  var sz=Math.max(1,it.size||1);
  if(it.kind==='text'){var s=(it.parts||[]).map(function(p){return typeof p==='string'?p:_hudFmt(val(p))}).join('');return{w:_hudTextW(s)*sz,h:8*sz,s:s}}
  if(it.kind==='icons'){
    var n=Math.max(0,Math.min(50,Math.floor(Number(val(it.count))||0))),inf=null;
    try{if(typeof _spriteInfo==='function')inf=_spriteInfo(it.sprite&&it.sprite.name)}catch(e){inf=null}
    var sw=(inf?inf.w:7)*sz,sh=(inf?inf.h:7)*sz;
    return{w:n?n*sw+(n-1)*sz:0,h:sh,n:n,sw:sw,sh:sh,spr:!!inf};
  }
  var lo=Number(val(it.min)),hi=Number(val(it.max)),v=Number(val(it.value)),f=hi===lo?0:(v-lo)/(hi-lo);
  if(!isFinite(f))f=0;
  return{w:it.width||50,h:it.height||(4*sz+2),f:Math.max(0,Math.min(1,f))};
}
function _hudPaintSpec(g,W,H,items,val){
  if(!g||!items||!items.length)return;
  var M=3,stacks={},placed=[];
  items.forEach(function(it){
    var m=_hudMeasure(it,val),k=it.v+' '+it.h,S=stacks[k];
    if(!S||!it.below){S={h:0,list:[]};(stacks[k+'#']=stacks[k+'#']||[]).push(S);stacks[k]=S}
    var y=S.list.length?S.h+2:0;S.list.push({it:it,m:m,y:y});S.h=y+m.h;
  });
  g.save();g.imageSmoothingEnabled=false;
  Object.keys(stacks).forEach(function(k){
    if(k.slice(-1)!=='#')return;
    stacks[k].forEach(function(S){
      S.list.forEach(function(e){
        var it=e.it,m=e.m,v=it.v,h=it.h;
        var y0=v==='top'?M:v==='bottom'?H-M-S.h:Math.round((H-S.h)/2),y=y0+e.y;
        var x=h==='left'?M:h==='right'?W-M-m.w:Math.round((W-m.w)/2);
        var col=it.color||(it.kind==='bar'?'#38b764':'#ffffff');
        if(it.kind==='text')_hudText(g,m.s,x,y,it.size||1,col);
        else if(it.kind==='icons'){
          for(var i=0;i<m.n;i++){
            var ix=x+i*(m.sw+(it.size||1));
            if(m.spr)_spriteDraw(g,it.sprite.name,0,ix,y,{scale:it.size||1});
            else{g.fillStyle=it.color||'#e43b44';g.fillRect(ix,y,m.sw,m.sh)}
          }
        }else{
          g.fillStyle='rgba(0,0,0,0.55)';g.fillRect(x,y,m.w,m.h);
          g.fillStyle='rgba(255,255,255,0.35)';g.fillRect(x,y,m.w,1);g.fillRect(x,y+m.h-1,m.w,1);g.fillRect(x,y,1,m.h);g.fillRect(x+m.w-1,y,1,m.h);
          var fw=Math.round((m.w-2)*m.f);if(fw>0){g.fillStyle=col;g.fillRect(x+1,y+1,fw,m.h-2)}
        }
      });
    });
  });
  g.restore();
}
var _hudMeta=null,_hudCur=-1,_hudShow=true,_hudSayText='',_hudSayEnd=0,_hudNoted=Object.create(null);
function _hudSetup(imports){
  var m=null;try{if(imports&&typeof imports.hudMeta==='string')m=JSON.parse(imports.hudMeta)}catch(e){m=null}
  _hudMeta=m;_hudCur=m&&m.huds&&m.huds.length?0:-1;_hudShow=true;_hudSayText='';_hudSayEnd=0;_hudNoted=Object.create(null);
}
// A HUD value: a number written in the block, or a global variable read from the running instance
function _hudVal(r){
  if(!r)return 0;
  if(r.num!==undefined)return r.num;
  var wi=window._wi,G=wi&&wi.exports&&wi.exports['__g'+r.i];
  if(!G)return 0;
  var v=G.value;
  if(r.t==='str'){try{return v?_readStr(Number(v)):''}catch(e){return''}}
  if(r.t==='bool')return!!Number(v);
  return v;
}
function _hudNow(){return typeof performance!=='undefined'?performance.now():Date.now()}
function _hudPaint(g){
  if(!_hudMeta||!g||!_canvas)return;
  var W=_canvas.width,H=_canvas.height,h=_hudMeta.huds[_hudCur];
  if(_hudShow&&h)try{_hudPaintSpec(g,W,H,h.items,_hudVal)}catch(e){}
  if(_hudSayText&&_hudNow()<_hudSayEnd){
    var sz=Math.max(1,Math.min(4,Math.floor(W/160))),tw=_hudTextW(_hudSayText)*sz,x=Math.round((W-tw)/2),y=Math.round(H/2-4*sz);
    g.save();g.fillStyle='rgba(0,0,0,0.6)';g.fillRect(x-4*sz,y-3*sz,tw+8*sz,13*sz);g.restore();
    _hudText(g,_hudSayText,x,y,sz,'#ffffff');
  }
}
function _hudOnCanvas(){return!!(_canvas&&!(_canvas.hasAttribute&&_canvas.hasAttribute('data-emit-screen')))}
_emitFrame=(function(frame){return function(){
  try{return frame.apply(this,arguments)}
  finally{if(_hudMeta&&_hudOnCanvas())_hudPaint(_need2d())}
}})(_emitFrame);
_emitCallExport=(function(call){return function(inst,name,args,top){
  var r=call.apply(this,arguments);
  if(_hudMeta&&!_animRunning&&name!=='frame'&&_hudOnCanvas()&&!(r&&typeof r.then==='function'))_hudPaint(_need2d());
  return r;
}})(_emitCallExport);
_rgBlit1=(function(blit){return function(s){var r=blit.apply(this,arguments);if(_hudMeta&&s&&s.cv===_canvas)_hudPaint(s.ctx);return r}})(_rgBlit1);
buildImportObject=(function(build){return function(imports,outputLog){
  _hudSetup(imports);
  var obj=build.apply(this,arguments),s=obj.std;
  if(s){
    if(s.hud)s.hud=function(p){
      var n=_readStr(Number(p)),L=_hudMeta?_hudMeta.huds:[],k=String(n).toLowerCase();
      for(var i=0;i<L.length;i++)if(L[i].name.toLowerCase()===k){_hudCur=i;_hudShow=true;return}
      if(!_hudNoted[n]){_hudNoted[n]=true;try{var d=document.createElement('div');d.style.cssText='color:#64748b;padding:2px 12px;font-family:var(--mono);font-size:11px;';d.textContent='hud("'+n+'"): there is no hud block with this name';var o=document.getElementById('tab-output');if(o)o.appendChild(d)}catch(e){}}
    };
    if(s.hudOn)s.hudOn=function(){_hudShow=true};
    if(s.hudOff)s.hudOff=function(){_hudShow=false};
    if(s.say)s.say=function(p,sec){_hudSayText=_readStr(Number(p));sec=Number(sec);_hudSayEnd=_hudNow()+(sec>0?sec:2)*1000};
  }
  return obj;
}})(buildImportObject);
if(typeof window!=='undefined'){window._hudPaintSpec=_hudPaintSpec;window._hudText=_hudText;window._hudTextW=_hudTextW;window._hudState=function(){return{hud:_hudMeta&&_hudMeta.huds[_hudCur]?_hudMeta.huds[_hudCur].name:null,on:_hudShow,say:_hudNow()<_hudSayEnd?_hudSayText:''}}}
//#emit-hud-end

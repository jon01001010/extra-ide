// ═══ TIMELINE — every frame of an animated program is recorded; scrub back, step, poke and resume (IDE only) ═══
// Nothing here is copied into exported programs: it wraps runtime functions from the outside.
// RECORDING. After each frame() that completed (not one suspended in an await) the state of the program is
// added to a ring of frame records:
//   • the bytes of every memory region (thing kinds' regions included) — one buffer, the regions back to back
//     (8-byte aligned). A KEYFRAME holds a full copy (every _TL_CFG.key frames, and whenever a delta would be
//     bigger than 3/4 of a copy); every record holds the XOR delta to the frame before it (d), run-length
//     encoded: [varint gap][varint length][length bytes of XOR] …, found by comparing 32-bit words. XOR makes a
//     delta usable both ways: state(k) = state(k-1) ^ d(k) and state(k-1) = state(k) ^ d(k).
//   • every mutable WASM global (the __g<i> exports): 8 bytes each (f64, or i64 for an int / handle global).
//   • the freeze flag of every region, the tiles of every map (setTile; a new copy only when one changed),
//     the HUD of things (_lgShows, _lgSay, the tick) and the input of the frame (keys, touch, stick, buttons,
//     taps on onclick buttons) — shared with the previous record when unchanged; the live particles and the
//     state of hud / say (HUD & PARTICLES: _fxW.snap(), _hudSnap()), when the program has them.
// The ring keeps at most _TL_CFG.maxFrames records and _TL_CFG.maxBytes bytes; dropping the oldest record turns
// the next one into a keyframe in place (its delta is applied to the dropped copy).
// RESTORING frame k: from the nearest keyframe at or before k forward, or by walking XOR deltas from the frame
// shown last when that is closer; the bytes are written back into the regions, the globals are set (a str /
// js / array global only when what it points to is still alive — the runtime may have released it, see
// LIFETIME), the maps, freeze flags and the HUD of things are put back.
// REDRAW while paused, without advancing the program:
//   • screen(region …): blitted from the restored bytes (exact).
//   • things (LOGIC): _lgDraw(tick, on) draws the stage, the map, every thing and the HUD from the restored
//     regions — the same drawing frame() does, without running the rules (exact).
//   • any other canvas program (its own drawing calls in frame()): the frame is REPLAYED quietly — state k-1
//     is restored, frame() runs once with the input recorded for frame k (print, beep, sounds and error lines
//     are muted), then state k is restored exactly. The picture is the program's own drawing of frame k; a
//     frame that draws something random (random()) may look slightly different from the first time. Not for
//     the oldest recorded frame (nothing before it) or an async frame(): their picture stays as it is.
// FORK. ▶ or "⟲ resume from here" while showing an older frame discards the recorded future and continues
// live from the shown state. A poke on the Memory tab while paused changes the shown frame: that frame is
// recorded again with the poke and the frames after it are discarded at once — history forks.
// Deterministic re-simulation of the old future after a poke is NOT offered: random() and Math.random, now(),
// timers, sounds, library objects and async frames are outside what is recorded, so a replayed future could
// silently differ from what really happened; the Timeline only resumes, it never invents frames.
// Library objects (three.js scenes, physics worlds, any JS object behind a handle) live outside WASM memory and
// are not rewound: the bar says so once per run.
var _TL_CFG={key:30,maxBytes:32*1048576,maxFrames:600,uiMs:200};
var _tl={on:false,pref:null,inst:null,ready:false,frames:[],bytes:0,regs:[],B:0,gl:[],prev:null,view:null,viewPos:-1,pos:-1,sinceKey:0,
  paused:false,stepOnce:false,quiet:false,mapDirty:true,maps:null,lg:null,lgOn:1,inp:null,inpSig:'',evs:[],fz:'',libs:false,
  async:false,tooBig:false,enc:null,refSkipped:0,cost:{n:0,sum:0,max:0,last:0},uiAt:0,bar:null,ginfos:[],ginfo:null};
function _timelineConfig(o){o=o||{};['key','maxBytes','maxFrames','uiMs'].forEach(function(k){if(o[k]>0)_TL_CFG[k]=Number(o[k])});_tlCap();return _TL_CFG}
// The compiler's view of the globals (type and name of each): kept for the last few compiles, matched to the
// instance at setup by count and by which of them are 64-bit.
WasmCodegen.prototype.generate=(function(gen){return function(){
  var r=gen.apply(this,arguments);
  try{
    var names=[];if(this.globalMap)this.globalMap.forEach(function(v,k){names[v.idx]=k});
    _tl.ginfos.push({n:this.globals.length,types:this.globals.map(function(g){return String(g.type||'int')}),names:names});
    if(_tl.ginfos.length>6)_tl.ginfos.shift();
  }catch(e){}
  return r;
}})(WasmCodegen.prototype.generate);
var _TL_NUM=/^(int|i64|i32|u32|i16|u16|i8|u8|num|f64|f32|bool)$/;
function _tlIsBigT(t){return/^(int|i64)$/.test(t)}
function _tlReset(){
  if(_tl.bar&&_tl.bar.parentNode)_tl.bar.parentNode.removeChild(_tl.bar);
  _tl.bar=null;_tl.inst=null;_tl.ready=false;_tl.frames=[];_tl.bytes=0;_tl.regs=[];_tl.B=0;_tl.gl=[];_tl.prev=null;_tl.view=null;_tl.viewPos=-1;_tl.pos=-1;_tl.sinceKey=0;
  _tl.paused=false;_tl.stepOnce=false;_tl.quiet=false;_tl.mapDirty=true;_tl.maps=null;_tl.lg=null;_tl.lgOn=1;_tl.inp=null;_tl.inpSig='';_tl.evs=[];_tl.fz='';_tl.strs=null;
  _tl.libs=false;_tl.hN=undefined;_tl.async=false;_tl.tooBig=false;_tl.enc=null;_tl.refSkipped=0;_tl.cost={n:0,sum:0,max:0,last:0};_tl.uiAt=0;_tl.ginfo=null;
}
// First frame of a new instance: what is recorded, and whether the Timeline starts on
function _tlSetup(){
  var wi=window._wi;
  _tlReset();_tl.inst=wi;
  var regs=[],off=0;
  try{if(_rgLive())_rgMeta.regions.forEach(function(R){var n=R.length*R.elemSize;regs.push({id:R.id,name:R.name,base:R.base,len:n,off:off,desc:R.desc,al:R.base%4===0});off+=(n+7)&~7})}catch(e){regs=[]}
  _tl.regs=regs;_tl.B=off;
  var gs=[];
  for(var i=0;wi&&wi.exports&&wi.exports['__g'+i];i++)gs.push(wi.exports['__g'+i]);
  var info=null;
  for(var j=_tl.ginfos.length-1;j>=0&&!info;j--){
    var c=_tl.ginfos[j];if(c.n!==gs.length)continue;
    var ok=true;for(var q=0;q<gs.length&&ok;q++){var t=c.types[q],big=typeof gs[q].value==='bigint';if(_TL_NUM.test(t)&&_tlIsBigT(t)!==big)ok=false}
    if(ok)info=c;
  }
  _tl.ginfo=info;
  gs.forEach(function(G,i){
    var v=G.value;
    try{G.value=v}catch(e){return}   // an immutable global (let) never changes: not recorded
    var t=info?info.types[i]:'?';
    _tl.gl.push({i:i,G:G,big:typeof v==='bigint',ref:info?!_TL_NUM.test(t):false,str:t==='str'&&typeof v!=='bigint',t:t,name:info&&info.names[i]||('__g'+i)});
  });
  _tl.async=typeof _emitIsAsync==='function'&&_emitIsAsync('frame');
  _tl.tooBig=_tl.B*2+64>_TL_CFG.maxBytes;
  _tl.on=!_tl.async&&!_tl.tooBig&&(_tl.pref!==null?_tl.pref:regs.length>0);
  _tl.ready=true;
  _tlBar();
}
// ── recording ──
function _tlVar(a,e,v){while(v>=128){a[e++]=(v&127)|128;v=Math.floor(v/128)}a[e++]=v;return e}
function _tlXor(dst,d){
  var p=0,i=0,n=d.length,v,s,len;
  while(i<n){
    v=0;s=1;do{var c=d[i++];v+=(c&127)*s;s*=128}while(c&128);p+=v;
    len=0;s=1;do{var c2=d[i++];len+=(c2&127)*s;s*=128}while(c2&128);
    for(var k=0;k<len;k++)dst[p+k]^=d[i+k];
    i+=len;p+=len;
  }
}
// Compare the regions with prev, write the XOR runs to the scratch buffer and bring prev up to date.
// Returns the delta's length.
function _tlDiff(){
  var buf=_wasmMem.buffer,m8=new Uint8Array(buf),m32=new Uint32Array(buf,0,buf.byteLength>>2),p8=_tl.prev,p32=new Uint32Array(p8.buffer,0,p8.length>>2);
  var enc=_tl.enc,e=0,last=0;
  for(var r=0;r<_tl.regs.length;r++){
    var R=_tl.regs[r],nw=R.al?R.len>>2:0,wm=R.base>>2,wp=R.off>>2,i=0;
    while(i<nw){
      if(m32[wm+i]===p32[wp+i]){i++;continue}
      var s=i,end=i+1,j=i+1;
      while(j<nw){if(m32[wm+j]!==p32[wp+j]){end=j+1;j++}else if(j-end<2)j++;else break}
      var bp=R.off+s*4,bl=(end-s)*4;
      e=_tlVar(enc,e,bp-last);e=_tlVar(enc,e,bl);
      for(var k=s;k<end;k++){var x=(m32[wm+k]^p32[wp+k])>>>0;enc[e++]=x&255;enc[e++]=(x>>>8)&255;enc[e++]=(x>>>16)&255;enc[e++]=x>>>24;p32[wp+k]=m32[wm+k]}
      last=bp+bl;i=end;
    }
    for(var b=nw*4;b<R.len;b++){
      var mv=m8[R.base+b],pv=p8[R.off+b];if(mv===pv)continue;
      var bs=b,be=b+1;while(be<R.len&&m8[R.base+be]!==p8[R.off+be])be++;
      e=_tlVar(enc,e,R.off+bs-last);e=_tlVar(enc,e,be-bs);
      for(var q=bs;q<be;q++){enc[e++]=m8[R.base+q]^p8[R.off+q];p8[R.off+q]=m8[R.base+q]}
      last=R.off+be;b=be-1;
    }
  }
  return e;
}
function _tlCopyIn(dst){var m8=new Uint8Array(_wasmMem.buffer);for(var r=0;r<_tl.regs.length;r++){var R=_tl.regs[r];dst.set(m8.subarray(R.base,R.base+R.len),R.off)}}
var _TL_KEYN={8:'⌫',9:'Tab',13:'Enter',16:'Shift',17:'Ctrl',18:'Alt',27:'Esc',32:'Space',37:'←',38:'↑',39:'→',40:'↓'};
function _tlKeyName(c){c=Number(c);if(_TL_KEYN[c])return _TL_KEYN[c];if(c>=48&&c<=90)return String.fromCharCode(c);return'key '+c}
function _tlInput(){
  var ks=[];for(var k in _keys)if(_keys[k])ks.push(k);
  var st=typeof _stIn==='object'&&_stIn?_stIn:null;
  var s=st?[+st.tx.toFixed(2),+st.ty.toFixed(2),st.down.A,st.down.B,st.down.C,st.kbBtn.A?1:0,st.kbBtn.B?1:0,st.kbBtn.C?1:0,st.tapping?1:0,Math.round(st.tapX),Math.round(st.tapY),st.edge.A?1:0,st.edge.B?1:0,st.edge.C?1:0]:[];
  var sig=ks.join(',')+'|'+(_touch.on?_touch.on+','+Math.round(_touch.x)+','+Math.round(_touch.y):'')+'|'+s.join(',');
  if(sig===_tl.inpSig&&_tl.inp)return _tl.inp;
  var lab=[];
  if(ks.length)lab.push('key '+ks.map(_tlKeyName).join(' '));
  if(_touch.on)lab.push('touch '+Math.round(_touch.x)+','+Math.round(_touch.y));
  if(st){
    if(s[0]||s[1])lab.push('stick '+s[0]+','+s[1]);
    var bs=['A','B','C'].filter(function(b,i){return s[2+i]>0||s[5+i]||s[11+i]});if(bs.length)lab.push('button '+bs.join(' '));
    if(s[8])lab.push('tap '+s[9]+','+s[10]);
  }
  _tl.inpSig=sig;
  return(_tl.inp={keys:ks,touch:{x:_touch.x,y:_touch.y,on:_touch.on},st:s,lab:lab.join(' · ')});
}
function _tlMaps(){
  if(typeof _stMaps==='undefined'||!_stMaps.length)return null;
  if(!_tl.mapDirty&&_tl.maps)return _tl.maps;
  _tl.mapDirty=false;
  return(_tl.maps=_stMaps.map(function(m){return m.rows.map(function(r){return r.join('')}).join('\n')}));
}
function _tlLg(){
  if(typeof _lgMeta==='undefined'||!_lgMeta)return null;
  var p=_tl.lg,sh=_lgShows;
  if(p&&p.t===_lgTick&&p.on===_tl.lgOn&&p.say===_lgSay&&p.sayAt===_lgSayAt&&p.shows.length===sh.length&&p.shows.every(function(v,i){return Object.is(v,sh[i])}))return p;
  return(_tl.lg={t:_lgTick,on:_tl.lgOn,say:_lgSay,sayAt:_lgSayAt,shows:sh.slice()});
}
function _tlFz(){
  if(!_tl.regs.length)return'';
  var u8=new Uint8Array(_wasmMem.buffer),s='';for(var r=0;r<_tl.regs.length;r++)s+=u8[_tl.regs[r].desc+8]?'1':'0';
  return s;
}
// One record of the current state. keep: {inp, lab} of a record this one replaces (a fork)
function _tlRecord(keep,inp){
  var t0=performance.now();
  if(!_wasmMem)return;
  var B=_tl.B,F=_tl.frames,rec={n:_frameCount,d:null,full:null,g:null,fz:'',maps:null,lg:null,inp:null,lab:'',sz:96};
  if(B){
    if(!_tl.prev||_tl.prev.length!==B){_tl.prev=new Uint8Array(B);_tlCopyIn(_tl.prev);_tl.enc=new Uint8Array(B*2+64);rec.full=_tl.prev.slice();_tl.sinceKey=0}
    else{
      var e=_tlDiff();
      rec.d=_tl.enc.slice(0,e);
      if(++_tl.sinceKey>=_TL_CFG.key||e>B*0.75){rec.full=_tl.prev.slice();_tl.sinceKey=0}
    }
  }else if(!F.length)rec.full=new Uint8Array(0);
  else rec.d=new Uint8Array(0);
  if(!F.length&&!rec.full)rec.full=_tl.prev.slice();
  var gl=_tl.gl;
  if(gl.length){
    var g=new ArrayBuffer(8*gl.length),f64=new Float64Array(g),i64=new BigInt64Array(g);
    for(var i=0;i<gl.length;i++){var v=gl[i].G.value;if(gl[i].big)i64[i]=v;else f64[i]=v}
    rec.g=g;
    // a str global: its text too (the block it points to may be released and its space reused later)
    var ss=null;
    for(var si=0;si<gl.length;si++)if(gl[si].str){if(!ss)ss=[];var sv=gl[si].G.value;ss.push(sv?_readStr(sv):null)}
    if(ss){var ps=_tl.strs;if(ps&&ps.length===ss.length&&ps.every(function(x,i){return x===ss[i]}))ss=ps;_tl.strs=ss;rec.s=ss}
  }
  rec.fz=_tlFz();rec.maps=_tlMaps();rec.lg=_tlLg();
  /* particles and the HUD's own state (HUD & PARTICLES): live particles are part of the frame */
  if(typeof _fxW!=='undefined'&&_fxW){rec.fx=_fxW.snap();rec.sz+=rec.fx.bytes}
  if(typeof _hudSnap==='function')rec.hud=_hudSnap();
  if(keep){rec.inp=keep.inp;rec.lab=keep.lab}
  else{
    rec.inp=inp||_tlInput();
    var lab=rec.inp.lab;if(_tl.evs.length){lab=(lab?lab+' · ':'')+_tl.evs.join(' · ');_tl.evs=[]}
    rec.lab=lab;
  }
  rec.sz+=(rec.d?rec.d.length:0)+(rec.full?rec.full.length:0)+(rec.g?rec.g.byteLength:0);
  F.push(rec);_tl.bytes+=rec.sz;_tl.pos=F.length-1;
  _tlCap();
  if(!_tl.libs&&_tlUsesLibs()){_tl.libs=true;_tlUi(true)}
  var dt=performance.now()-t0,c=_tl.cost;c.n++;c.sum+=dt;c.last=dt;if(dt>c.max)c.max=dt;
}
function _tlCap(){
  var F=_tl.frames;
  while(F.length>2&&(F.length>_TL_CFG.maxFrames||_tl.bytes>_TL_CFG.maxBytes)){
    var f0=F.shift();_tl.bytes-=f0.sz;
    var nx=F[0];
    if(nx&&!nx.full){var full=f0.full;_tlXor(full,nx.d);nx.full=full;nx.sz+=full.length;_tl.bytes+=full.length}
    _tl.pos--;if(_tl.viewPos>=0)_tl.viewPos--;
  }
  if(_tl.pos<0&&F.length)_tl.pos=0;
}
// State in JS objects: a library the runtime drives (three.js, Matter, Pixi, Cannon, Chart, Peer), a frame that
// made new handles (frame() works on JS objects), or a js / array variable that holds one
function _tlUsesLibs(){
  try{
    if(!!(_3d&&_3d.scene)||!!_pixi||!!_phys||!!_cannon||!!_chart||!!_peer)return true;
    var h=_tl.hN;_tl.hN=_hNext;
    if(h!==undefined&&_hNext>h)return true;
    for(var i=0;i<_tl.gl.length;i++){var x=_tl.gl[i];if(x.ref&&x.big&&Number(x.G.value)>=_hBase)return true}
  }catch(e){}
  return false;
}
// ── restoring ──
function _tlBuild(k){
  var F=_tl.frames,B=_tl.B;
  if(!_tl.view||_tl.view.length!==B){_tl.view=new Uint8Array(B);_tl.viewPos=-1}
  var v=_tl.view,p=_tl.viewPos,kk=k;
  while(kk>0&&!F[kk].full)kk--;
  if(p>=0&&Math.abs(k-p)<=k-kk){
    var ok=true;
    for(var i=p+1;i<=k;i++){if(F[i].d)_tlXor(v,F[i].d);else v.set(F[i].full)}
    for(var j=p;j>k&&ok;j--){if(F[j].d)_tlXor(v,F[j].d);else ok=false}
    if(ok){_tl.viewPos=k;return v}
  }
  v.set(F[kk].full);for(var q=kk+1;q<=k;q++)_tlXor(v,F[q].d);
  _tl.viewPos=k;return v;
}
function _tlLive(x,v){
  try{
    if(x.big){var n=Number(v);if(n>=0&&n<_aBase)return true;if(n>=_hBase)return _handles.has(n-_hBase);return _arrMap.has(n-_aBase)}
    return v===0||v<_strHeapBase||_strBlocks.has(v);
  }catch(e){return true}
}
// Put frame k's state into the program (memory, globals, freeze flags, maps, the HUD of things)
function _tlApply(k){
  var F=_tl.frames[k];if(!F||!_wasmMem)return;
  if(_tl.B){
    var v=_tlBuild(k),m8=new Uint8Array(_wasmMem.buffer);
    for(var r=0;r<_tl.regs.length;r++){var R=_tl.regs[r];m8.set(v.subarray(R.off,R.off+R.len),R.base);if(F.fz)m8[R.desc+8]=F.fz.charCodeAt(r)===49?1:0}
  }
  if(F.g){
    var f64=new Float64Array(F.g),i64=new BigInt64Array(F.g),sn=0;
    for(var i=0;i<_tl.gl.length;i++){
      var x=_tl.gl[i],val=x.big?i64[i]:f64[i],cur=x.G.value;
      if(x.str&&F.s){
        var txt=F.s[sn++];
        if(txt===null){if(cur!==0)try{x.G.value=0}catch(e){}continue}
        if(cur===val&&_tlLive(x,val)&&_readStr(val)===txt)continue;
        if(_tlLive(x,val)&&_readStr(val)===txt){try{x.G.value=val}catch(e){}continue}
        var np=0;try{np=_writeStr(txt)}catch(e){np=0}   // the old block is gone: the same text in a new one
        if(np)try{x.G.value=np}catch(e){}else _tl.refSkipped++;
        continue;
      }
      if(x.big?cur===val:Object.is(cur,val))continue;
      if(x.ref&&!_tlLive(x,val)){_tl.refSkipped++;continue}
      try{x.G.value=val}catch(e){}
    }
  }
  if(F.maps&&F.maps!==_tl.maps&&typeof _stMaps!=='undefined'){
    F.maps.forEach(function(s,i){var m=_stMaps[i];if(m)m.rows=s.split('\n').map(function(r){return Array.from(r)})});
    _tl.maps=F.maps;
  }
  if(F.lg){_lgTick=F.lg.t;_lgSay=F.lg.say;_lgSayAt=F.lg.sayAt;_lgShows=F.lg.shows.slice();_tl.lg=F.lg;_tl.lgOn=F.lg.on}
  if(F.fx&&typeof _fxW!=='undefined'&&_fxW)_fxW.load(F.fx);
  if(F.hud&&typeof _hudLoad==='function')_hudLoad(F.hud);
  if(typeof _rgDirty!=='undefined')_rgDirty=true;
}
function _tlOwnCanvas(){
  if(!_canvas)return false;
  for(var i=0;i<_rgScreens.length;i++)if(_rgScreens[i].cv===_canvas)return false;
  return true;
}
// Show frame k: restore it and redraw without advancing the program (see REDRAW above)
function _tlShow(k){
  var F=_tl.frames;if(!F.length)return;
  k=Math.max(0,Math.min(F.length-1,k|0));
  var f=F[k],how='';
  if(f.lg&&typeof _lgDraw==='function'){_tlApply(k);try{_lgDraw(f.lg.t,f.lg.on)}catch(e){}how='drawn'}
  else if(_tlOwnCanvas()&&k>0&&!_tl.async&&window._wi&&window._wi.exports.frame){_tlReplay(k);how='replayed'}
  else{_tlApply(k);if(_tlOwnCanvas())how='kept'}
  try{_rgBlitAll()}catch(e){}
  _tl.pos=k;_tl.how=how;
  try{_mem.dirty=true;_memKick()}catch(e){}
  _tlUi(true);
}
function _tlReplay(k){
  var F=_tl.frames;
  _tlApply(k-1);
  var save={keys:_keys,touch:{x:_touch.x,y:_touch.y,on:_touch.on},st:null},inp=F[k].inp;
  if(typeof _stIn==='object'&&_stIn)save.st={tx:_stIn.tx,ty:_stIn.ty,down:_stIn.down,kbBtn:_stIn.kbBtn,tapping:_stIn.tapping,tapX:_stIn.tapX,tapY:_stIn.tapY,edge:_stIn.edge};
  var fq=_frameQuiet;
  try{
    if(inp){
      var ks={};inp.keys.forEach(function(c){ks[c]=1});_keys=ks;
      _touch.x=inp.touch.x;_touch.y=inp.touch.y;_touch.on=inp.touch.on;
      var s=inp.st;
      if(save.st&&s.length){_stIn.tx=s[0];_stIn.ty=s[1];_stIn.down={A:s[2],B:s[3],C:s[4]};_stIn.kbBtn={A:!!s[5],B:!!s[6],C:!!s[7]};_stIn.tapping=!!s[8];_stIn.tapX=s[9];_stIn.tapY=s[10];_stIn.edge={A:!!s[11],B:!!s[12],C:!!s[13]}}
    }
    _tl.quiet=true;_frameQuiet=true;
    _emitCallExport(window._wi,'frame',[],true);
  }catch(e){}
  finally{
    _tl.quiet=false;_frameQuiet=fq;
    _keys=save.keys;_touch.x=save.touch.x;_touch.y=save.touch.y;_touch.on=save.touch.on;
    if(save.st)for(var n in save.st)_stIn[n]=save.st[n];
  }
  _tlApply(k);
}
// ── controls ──
function _tlLast(){return _tl.frames.length-1}
function _tlPause(){
  if(!_tl.ready||!_tl.on||_tl.paused)return;
  _tl.paused=true;_tl.pos=_tlLast();
  if(_tl.prev&&_tl.B){if(!_tl.view||_tl.view.length!==_tl.B)_tl.view=new Uint8Array(_tl.B);_tl.view.set(_tl.prev);_tl.viewPos=_tl.pos}
  try{_mem.dirty=true;_memKick()}catch(e){}
  _tlUi(true);
}
// Drop the frames after k; frame k becomes the newest (prev = its state)
function _tlTruncate(k){
  var F=_tl.frames;if(k>=F.length-1)return 0;
  var gone=F.splice(k+1);gone.forEach(function(f){_tl.bytes-=f.sz});
  if(_tl.B){var v=_tlBuild(k);_tl.prev.set(v)}
  var kk=k;while(kk>0&&!F[kk].full)kk--;_tl.sinceKey=k-kk;
  _tl.maps=F[k].maps;_tl.lg=F[k].lg;
  return gone.length;
}
function _tlResume(){
  if(!_tl.ready)return;
  if(_tl.on&&_tl.paused&&_tl.frames.length){
    var k=_tl.pos,gone=_tlTruncate(k);
    if(gone){_frameCount=_tl.frames[k].n;_tl.forked=gone}
  }
  _tl.paused=false;_tl.pos=_tlLast();
  if(!_animRunning&&window._wi===_tl.inst&&window._wi&&window._wi.exports.frame){   // after Stop: start the frame loop again
    _animRunning=true;setStatus('ok','Running');
    (function loop(){if(!_animRunning)return;_emitFrame();requestAnimationFrame(loop)})();
  }
  _tlUi(true);
}
function _tlBack(){if(!_tl.on||!_tl.frames.length)return;_tlPause();if(_tl.pos>0)_tlShow(_tl.pos-1)}
function _tlFwd(){
  if(!_tl.on||!_tl.frames.length)return;
  if(!_tl.paused){_tlPause();return}
  if(_tl.pos<_tlLast()){_tlShow(_tl.pos+1);return}
  // at the present: run one frame
  _tl.stepOnce=true;
  try{_emitFrame()}finally{_tl.stepOnce=false}
  _tl.pos=_tlLast();
  if(_tl.prev&&_tl.B&&_tl.view){_tl.view.set(_tl.prev);_tl.viewPos=_tl.pos}
  try{_mem.dirty=true;_memKick()}catch(e){}
  _tlUi(true);
}
// A poke while paused: the shown frame is recorded again with it, the frames after it are discarded
function _tlFork(){
  var F=_tl.frames,k=_tl.pos;if(!F[k])return;
  var old=F[k];
  var gone=F.length-1-k;
  F.splice(k).forEach(function(f){_tl.bytes-=f.sz});
  if(_tl.B){if(k>0){_tl.viewPos=-1;_tl.prev.set(_tlBuild(k-1))}else _tl.prev=null}
  var kk=k-1;while(kk>0&&!F[kk].full)kk--;_tl.sinceKey=k>0?k-1-kk:0;
  _tl.maps=k>0?F[k-1].maps:null;_tl.mapDirty=true;_tl.lg=k>0?F[k-1].lg:null;
  _frameCount=old.n;
  _tlRecord({inp:old.inp,lab:old.lab?old.lab+' · poke':'poke'});
  F[F.length-1].fork=true;
  _tl.pos=F.length-1;
  if(_tl.B&&_tl.view){_tl.view.set(_tl.prev);_tl.viewPos=_tl.pos}
  _tl.forked=gone;
  _tlUi(true);
}
function _tlToggle(on){
  _tl.pref=!!on;
  if(!_tl.ready){_tlUi(true);return}
  if(on&&(_tl.async||_tl.tooBig)){_tlUi(true);return}
  if(!on){if(_tl.paused)_tlResume();_tl.frames=[];_tl.bytes=0;_tl.prev=null;_tl.view=null;_tl.viewPos=-1;_tl.pos=-1;_tl.maps=null;_tl.mapDirty=true;_tl.lg=null;_tl.inp=null;_tl.inpSig='';_tl.evs=[]}
  _tl.on=!!on;
  _tlUi(true);
}
// ── the bar ──
function _tlBar(){
  var out=document.getElementById('tab-output');if(!out)return null;
  if(_tl.bar&&_tl.bar.isConnected)return _tl.bar;
  var b=document.createElement('div');
  b.className='tl-bar';b.id='tlBar';b.setAttribute('role','group');b.setAttribute('aria-label','Timeline');
  b.innerHTML='<div class="tl-row tl-r1"><button data-tl="play" aria-label="Pause">⏸</button><button data-tl="back" aria-label="Step back one frame" title="Step back one frame">⏮</button><button data-tl="fwd" aria-label="Step forward one frame" title="Step forward: the next recorded frame, or run one frame">⏭</button>'
    +'<div class="tl-track"><input type="range" class="tl-slider" min="0" max="0" value="0" step="1" aria-label="Recorded frames"><div class="tl-ticks" aria-hidden="true"></div></div><span class="tl-lab">—</span></div>'
    +'<div class="tl-row tl-r2"><button class="tl-txt" data-tl="resume" title="Discard the frames after this one and continue from here">⟲ resume from here</button><button class="tl-txt" data-tl="rec" aria-pressed="false"></button><span class="tl-info"></span></div>'
    +'<div class="tl-what" aria-live="polite"></div><div class="tl-note"></div>';
  // under the program's output (canvas, screens, its buttons and fields), above the trace lines that follow it
  var anchor=null;
  try{
    var ui=out.querySelectorAll('button,input,select,textarea,canvas'),lastUi=ui.length?ui[ui.length-1]:null;
    for(var i=0;i<_traceQ.length&&!anchor;i++){var tn=_traceQ[i];if(tn.parentNode===out&&(!lastUi||(lastUi.compareDocumentPosition(tn)&4)))anchor=tn}
    if(_traceMark&&_traceMark.parentNode===out&&(!lastUi||(lastUi.compareDocumentPosition(_traceMark)&4))&&(!anchor||(_traceMark.compareDocumentPosition(anchor)&4)))anchor=_traceMark;
  }catch(e){anchor=null}
  if(anchor)out.insertBefore(b,anchor);else out.appendChild(b);
  _tl.bar=b;
  b.addEventListener('click',function(e){
    var t=e.target.closest&&e.target.closest('[data-tl]');if(!t||t.disabled)return;
    var a=t.getAttribute('data-tl');
    if(a==='play'){if(_tl.paused||!_animRunning)_tlResume();else _tlPause()}
    else if(a==='back')_tlBack();
    else if(a==='fwd')_tlFwd();
    else if(a==='resume')_tlResume();
    else if(a==='rec')_tlToggle(!_tl.on);
  });
  var sl=b.querySelector('.tl-slider');
  sl.addEventListener('input',function(){if(!_tl.on||!_tl.frames.length)return;var k=+sl.value;_tlPause();_tlShow(k)});
  sl.addEventListener('keydown',function(e){if(e.key===' '||e.key==='Enter'){e.preventDefault();if(_tl.paused)_tlResume();else _tlPause()}});
  var tk=b.querySelector('.tl-track');
  tk.addEventListener('mousemove',function(e){
    var F=_tl.frames;if(!F.length)return;
    var r=tk.getBoundingClientRect(),k=Math.round((e.clientX-r.left)/Math.max(1,r.width)*(F.length-1)),f=F[Math.max(0,Math.min(F.length-1,k))];
    tk.title='frame '+f.n+(f.lab?' · '+f.lab:'');
  });
  _tlUi(true);
  return b;
}
// Input ticks under the slider: frames are put in at most 120 buckets; a bucket with input (or a fork) gets a tick
function _tlTicks(c,F){
  var n=F.length,nb=Math.min(n,120),marks=[];
  for(var k=0;k<n;k++){
    var f=F[k];if(!f.lab&&!f.fork)continue;
    var b=n>1?Math.round(k/(n-1)*(nb-1)):0,m=marks[b];
    if(!m)marks[b]=m={k:k,fk:false,lab:f.lab};
    if(f.fork)m.fk=true;
  }
  var h='';
  marks.forEach(function(m,b){h+='<i'+(m.fk?' class="tl-fk"':'')+' style="left:'+(nb>1?(b/(nb-1)*100).toFixed(2):0)+'%" data-k="'+m.k+'"></i>'});
  if(c._h!==h){c._h=h;c.innerHTML=h}
}
function _tlUi(now){
  var b=_tl.bar;if(!b||!b.isConnected)return;
  var t=performance.now();
  if(!now&&t-_tl.uiAt<_TL_CFG.uiMs)return;
  _tl.uiAt=t;
  var F=_tl.frames,on=_tl.on&&_tl.ready,n=F.length,k=Math.max(0,Math.min(n-1,_tl.pos)),past=on&&_tl.paused&&k<n-1,run=_animRunning&&!_tl.paused;
  var q=function(s){return b.querySelector(s)};
  q('.tl-r1').style.display=on?'':'none';
  q('[data-tl="resume"]').style.display=on?'':'none';
  var pl=q('[data-tl="play"]');pl.textContent=run?'⏸':'▶';pl.setAttribute('aria-label',run?'Pause':past?'Resume from this frame':'Resume');pl.title=pl.getAttribute('aria-label');
  q('[data-tl="back"]').disabled=!n||(_tl.paused&&k<=0);
  q('[data-tl="fwd"]').disabled=!n;
  q('[data-tl="resume"]').disabled=!past;
  var sl=q('.tl-slider');
  sl.max=String(Math.max(0,n-1));sl.value=String(k);sl.disabled=!n;
  sl.setAttribute('aria-valuetext',n?'frame '+F[k].n+' of '+F[n-1].n:'nothing recorded');
  q('.tl-lab').textContent=n?'#'+F[k].n:'—';
  b.classList.toggle('tl-past',past);
  var rec=q('[data-tl="rec"]');
  rec.textContent=on?'● Timeline on':'○ Timeline off';rec.setAttribute('aria-pressed',String(on));rec.classList.toggle('tl-on',on);
  rec.title=on?'Stop recording (forgets the recorded frames)':'Record every frame so you can scrub back';
  rec.disabled=!on&&(_tl.async||_tl.tooBig);
  var info='';
  if(!_tl.ready)info='The Timeline records an animated program (one that calls animate()): ▶ Run one.';
  else if(_tl.async)info='frame() awaits: the Timeline records only a frame() without await';
  else if(_tl.tooBig)info='the regions ('+_memBytes(_tl.B)+') are too big to record';
  else if(!on)info='record every frame to scrub back, step and poke the past';
  else{
    var c=_tl.cost;
    info=n+' frame'+(n===1?'':'s')+' · '+_memBytes(_tl.bytes)+(c.n?' · '+(c.sum/c.n).toFixed(2)+' ms/frame':'');
  }
  q('.tl-info').textContent=info;
  var w='';
  if(on&&n){
    var f=F[k];
    w=(past?'⏸ frame '+f.n+' of '+F[n-1].n+' — ▶ or ⟲ continues from here and discards the frames after it':_tl.paused?'⏸ paused at the newest frame — ⏭ runs one frame':'● recording')+(f.lab?' · input: '+f.lab:'');
    if(_tl.paused&&f.fork)w+=' · history forked here';
    if(_tl.paused&&_tl.how==='replayed')w+=' · picture: frame() replayed';
    else if(_tl.paused&&_tl.how==='kept')w+=' · picture not redrawn (no frame before this one to replay)';
  }
  var wh=q('.tl-what');if(wh.textContent!==w)wh.textContent=w;
  var nt=q('.tl-note'),note=_tl.libs&&on?'Timeline restores memory and globals only — library objects (three.js, …) are not rewound':'';
  if(nt.textContent!==note)nt.textContent=note;nt.classList.toggle('show',!!note);
  _tlTicks(q('.tl-ticks'),on?F:[]);
  // phones: the bar sticks to the bottom; on-screen controls (sticky too) sit above it
  try{if(typeof _stIn==='object'&&_stIn&&_stIn.el){var hb=window.innerWidth<768?b.offsetHeight:0;_stIn.el.style.bottom=hb+'px'}}catch(e){}
}
// Drawer card / help: the Output view with the Timeline
function _tlOpen(){
  try{showView('run')}catch(e){}
  var t=document.querySelector('.otab[data-t="output"]');if(t)showOTab(t);
  var b=_tl.bar&&_tl.bar.isConnected?_tl.bar:null;
  if(!b){
    var out=document.getElementById('tab-output');if(!out)return false;
    b=_tlBar();
  }
  if(b){try{b.scrollIntoView({block:'nearest'})}catch(e){}var f=b.querySelector('[data-tl="rec"]');try{(f&&f.offsetParent?f:b).focus()}catch(e){}}
  return!!b;
}
// ── hooks ──
_emitFrame=(function(frame){return function(){
  if(!_tl.on){
    if(window._wi&&window._wi!==_tl.inst&&window._wi.exports.frame){var r0=frame.apply(this,arguments);try{_tlSetup()}catch(e){}return r0}
    return frame.apply(this,arguments);
  }
  if(window._wi!==_tl.inst){try{_tlSetup()}catch(e){}if(!_tl.on)return frame.apply(this,arguments)}
  if(_tl.paused&&!_tl.stepOnce)return;
  var n0=_frameCount,inp=null;try{inp=_tlInput()}catch(e){}   // what this frame sees (edges are cleared after it)
  var r=frame.apply(this,arguments);
  if(_frameCount!==n0&&!_frameBusy&&_tl.on){try{_tlRecord(null,inp)}catch(e){}_tlUi(false)}
  return r;
}})(_emitFrame);
_emitCallExport=(function(call){return function(inst,name){
  if(_tl.on&&typeof name==='string'&&name!=='frame'&&/^on(click|key|touch)_?/.test(name))_tl.evs.push(/^onclick_/.test(name)?'button '+name.slice(8):name);
  return call.apply(this,arguments);
}})(_emitCallExport);
try{window._emitCallExport=_emitCallExport}catch(e){}
_lgDraw=(function(f){return function(t,on){_tl.lgOn=Number(on);return f.apply(this,arguments)}})(_lgDraw);
_jsErr=(function(f){return function(){if(_tl.quiet)return;return f.apply(this,arguments)}})(_jsErr);
// Imports: setTile marks the maps as changed; print and sound are muted while a frame is replayed for its picture
var _TL_QUIET=/^(print\w*|beep|playNote|playAudio|play|music|__lgPlay)$/;
buildImportObject=(function(build){return function(){
  var obj=build.apply(this,arguments);
  try{
    Object.keys(obj).forEach(function(mod){
      var o=obj[mod];if(!o||typeof o!=='object')return;
      Object.keys(o).forEach(function(n){
        var f=o[n];if(typeof f!=='function')return;
        if(n==='setTile')o[n]=function(){_tl.mapDirty=true;return f.apply(this,arguments)};
        else if(_TL_QUIET.test(n))o[n]=function(){if(_tl.quiet)return;return f.apply(this,arguments)};
      });
    });
  }catch(e){}
  return obj;
}})(buildImportObject);
_emitRegionWrite=(function(f){return function(){
  var ok=f.apply(this,arguments);
  if(ok&&_tl.on&&_tl.ready&&_tl.paused&&_tl.frames.length&&window._wi===_tl.inst){try{_tlFork()}catch(e){}}
  return ok;
}})(_emitRegionWrite);
compileAndRun=(function(f){return async function(){
  _tlReset();
  return await f.apply(this,arguments);
}})(compileAndRun);
stopProgram=(function(f){return function(){var r=f.apply(this,arguments);try{if(_tl.ready&&_tl.on&&!_tl.paused){_tl.paused=true;_tl.pos=_tlLast();if(_tl.prev&&_tl.B){if(!_tl.view||_tl.view.length!==_tl.B)_tl.view=new Uint8Array(_tl.B);_tl.view.set(_tl.prev);_tl.viewPos=_tl.pos}}_tlUi(true)}catch(e){}return r}})(stopProgram);
_memLive=(function(f){return function(){
  var r=f.apply(this,arguments);
  try{if(_tl.on&&_tl.paused&&_tl.frames[_tl.pos]){var el=_memEl(),s=el&&el.querySelector('.mlive');if(s){var t='⏸ frame '+_tl.frames[_tl.pos].n;if(s.textContent!==t)s.textContent=t;s.classList.remove('on')}}}catch(e){}
  return r;
}})(_memLive);
window.addEventListener('resize',function(){_tlUi(true)});
_drawerRegister({id:'timeline',label:'Timeline',icon:'⏱',desc:'Scrub back through the frames of the running program: pause, step, poke a frame, resume from it',
  go:function(){_tlOpen()},
  open:function(ctx){ctx.body.appendChild(_drwEl('div',{cls:'drw-empty'},[_drwEl('p',{text:'The Timeline is a bar under the program\'s output in the Output view: it records every frame of an animated program.'}),_drwBtn('Show the Timeline',function(){if(ctx.close())_tlOpen()},'drw-pri drw-btn-l')]))}});

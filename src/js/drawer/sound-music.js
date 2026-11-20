// ═══ DRAWER TOOLS: Sound and Music ═══
// They read the `sound` / `music` blocks with the runtime's parsers, preview with the runtime's synth
// (_sndVoice, _musStart) and write the blocks back: a part whose value did not change keeps its original
// text, parts the tool does not understand are kept as they are, defaults are left out.
// ── writing blocks ──
function _sndPartText(k,s){
  switch(k){
    case'wave':var f2=s.f2!==null&&s.f2!==undefined&&s.f2!==s.f;return s.wave+(s.f!==440||f2?' '+_sndFmt(s.f,2):'')+(f2?' > '+_sndFmt(s.f2,2):'');
    case'len':return _sndFmt(s.len,0)+'ms';
    case'atk':case'dec':case'rel':return k+' '+_sndFmt(s[k],0);
    case'sus':case'vol':return k+' '+_sndFmt(s[k],2);
    case'vib':return s.vibD>0&&s.vibR>0?'vib '+_sndFmt(s.vibD,3)+' '+_sndFmt(s.vibR,1):'';
    case'lowpass':return s.lp>0?'lowpass '+_sndFmt(s.lp,0):'';
    case'highpass':return s.hp>0?'highpass '+_sndFmt(s.hp,0):'';
    case'arp':return s.arpM>0&&s.arpT>0?'arp '+_sndFmt(s.arpM,3)+' '+_sndFmt(s.arpT,0)+'ms':'';
    case'curve':return'curve '+(s.curve==='exp'?'exp':'lin');
  }
  return'';
}
// Rounds a spec the way it is written, so what the tool shows is exactly what reads back
function _sndQ(s){
  function r(v,d){return+(+v).toFixed(d)}
  s.f=r(s.f,2);if(s.f2!==null&&s.f2!==undefined)s.f2=r(s.f2,2);
  ['len','atk','dec','rel','lp','hp','arpT'].forEach(function(k){s[k]=Math.round(s[k])});
  s.sus=r(s.sus,2);s.vol=r(s.vol,2);s.vibD=r(s.vibD,3);s.vibR=r(s.vibR,1);s.arpM=r(s.arpM,3);
  return s;
}
// orig: the _sndParse result of the block as it was read (or null for a new sound)
function _sndWrite(name,spec,orig){
  var d=_sndDefaults(),out=[],comments=[],done={};
  function isDef(k){return k!=='wave'&&(_sndPartText(k,spec)===_sndPartText(k,d)||_sndPartText(k,spec)==='')}
  (orig?orig.parts:[]).forEach(function(p){
    if(p.key==='comment'){if(p.keep!==false)comments.push(p.text);return}
    if(!p.ok){if(p.keep!==false)out.push({k:null,t:p.text});return}
    done[p.key]=true;
    var now=_sndPartText(p.key,spec);
    if(now===_sndPartText(p.key,orig.spec))out.push({k:p.key,t:p.text});
    else if(!isDef(p.key))out.push({k:p.key,t:now});
  });
  if(!done.wave)out.unshift({k:'wave',t:_sndPartText('wave',spec)});
  // a part that is new goes after the last part that comes before it in the usual order
  _SND_ORDER.forEach(function(k,ki){
    if(done[k]||k==='wave'||isDef(k))return;
    var at=0;for(var i=0;i<out.length;i++)if(out[i].k&&_SND_ORDER.indexOf(out[i].k)<ki)at=i+1;
    out.splice(at,0,{k:k,t:_sndPartText(k,spec)});
  });
  return'sound '+name+': '+out.map(function(x){return x.t}).join(', ')+(comments.length?' '+comments.join(' '):'');
}
function _musCellText(tr,c){
  if(tr.drums)return c?c:'.';
  if(c==='-')return'-';
  if(Array.isArray(c)&&c.length)return c.slice().sort(function(a,b){return a-b}).map(_musName).join('+');
  return'.';
}
function _musTrackText(tr){
  var h=tr.name+(tr.drums?(tr.name==='drums'?'':' drums'):' '+(tr.wave||'square'))+(tr.vol!==1&&tr.vol!==undefined?' vol '+_sndFmt(tr.vol,2):'')+(tr.mute?' mute':'');
  return h+': '+tr.cells.map(function(c){return _musCellText(tr,c)}).join(' ');
}
function _musHeadText(k,s){return k==='bpm'?_sndFmt(s.bpm,0)+' bpm':k==='steps'?s.steps+' steps':k==='swing'?(s.swing>0?'swing '+_sndFmt(s.swing,2):''):''}
// orig: the _musParse result as read, with orig.canon[i] = _musTrackText of track i at that time
function _musWrite(name,spec,orig){
  var head=[],done={},lines=[],used=[];
  (orig?orig.head:[]).forEach(function(p){
    if(!p.ok||p.key==='comment'){if(p.keep!==false&&p.key!=='comment')head.push(p.text);return}
    done[p.key]=true;var now=_musHeadText(p.key,spec);
    if(now===_musHeadText(p.key,orig.was||orig.spec))head.push(p.text);else if(now)head.push(now);
  });
  ['bpm','steps','swing'].forEach(function(k){if(!done[k]){var t=_musHeadText(k,spec);if(t)head.push(t)}});
  var hc=(orig?orig.head:[]).filter(function(p){return p.key==='comment'&&p.keep!==false}).map(function(p){return p.text});
  (orig?orig.lines:[]).forEach(function(L){
    if(L.track<0||!L.ok){if(L.keep!==false)lines.push(L.text);return}
    var tr=orig.spec.tracks[L.track];
    if(spec.tracks.indexOf(tr)<0)return;   // deleted
    used.push(tr);
    var now=_musTrackText(tr);
    lines.push(now===orig.canon[L.track]?L.text:now);
  });
  spec.tracks.forEach(function(tr){if(used.indexOf(tr)<0)lines.push(_musTrackText(tr))});
  return'music '+name+': '+head.join(', ')+(hc.length?' '+hc.join(' '):'')+lines.map(function(l){return'\n  '+l}).join('');
}
// Reads a block for a tool: {name, spec, orig, text}
function _sndRead(b){var r=_sndParse(_drawerBody(b.text,'sound'));return{name:b.name,origName:b.name,spec:_sndQ(JSON.parse(JSON.stringify(r.spec))),orig:r,text:b.text,path:b.path,dirty:false}}
function _musRead(b){
  var r=_musParse(_drawerBody(b.text,'music'));
  r.canon=r.spec.tracks.map(_musTrackText);
  r.was={bpm:r.spec.bpm,steps:r.spec.steps,swing:r.spec.swing};   // the tool edits r.spec itself (its tracks keep their identity)
  return{name:b.name,origName:b.name,spec:r.spec,orig:r,text:b.text,path:b.path,dirty:false};
}
// ── Sound tool ──
var _SND_PRESETS={
  coin:{wave:'square',f:988,len:80,atk:1,rel:180,vol:0.4,arpM:1.335,arpT:60},
  jump:{wave:'square',f:300,f2:720,len:150,curve:'exp',atk:2,dec:80,sus:0.5,rel:70,vol:0.4},
  laser:{wave:'saw',f:1500,f2:220,len:170,curve:'exp',atk:1,rel:50,vol:0.35,lp:7000},
  explosion:{wave:'noise',f:900,f2:80,len:420,curve:'exp',atk:2,dec:300,sus:0.3,rel:320,vol:0.7,lp:3200},
  hit:{wave:'noise',f:1800,f2:400,len:70,atk:1,dec:60,sus:0.2,rel:70,vol:0.6,hp:250},
  'power-up':{wave:'triangle',f:330,f2:990,len:420,atk:4,rel:140,vol:0.45,vibD:0.05,vibR:14},
  blip:{wave:'square',f:1760,len:35,atk:1,rel:25,vol:0.3,lp:5000}
};
function _sndPreset(name){var s=_sndDefaults(),p=_SND_PRESETS[name];for(var k in p)s[k]=p[k];return _sndQ(s)}
function _sndRandom(rnd){
  rnd=rnd||Math.random;
  var waves=['square','square','saw','triangle','sine','noise'],s=_sndDefaults();
  s.wave=waves[Math.floor(rnd()*waves.length)];
  s.f=s.wave==='noise'?200+rnd()*2400:110*Math.pow(24,rnd());
  if(rnd()<0.6)s.f2=Math.max(30,Math.min(8000,s.f*Math.pow(4,rnd()*2-1)));
  s.curve=rnd()<0.5?'exp':'lin';
  s.len=40+rnd()*420;s.atk=rnd()*25;s.dec=rnd()<0.6?rnd()*200:0;s.sus=0.3+rnd()*0.7;s.rel=20+rnd()*300;s.vol=0.3+rnd()*0.3;
  if(rnd()<0.3){s.vibD=0.01+rnd()*0.08;s.vibR=3+rnd()*15}
  if(rnd()<0.3)s.lp=600+rnd()*6000;
  if(rnd()<0.2)s.hp=100+rnd()*1500;
  if(rnd()<0.25){s.arpM=[1.25,1.335,1.5,2,0.75][Math.floor(rnd()*5)];s.arpT=Math.max(5,s.len*(0.2+rnd()*0.5))}
  return _sndQ(s);
}
function _sndMutate(s,rnd){
  rnd=rnd||Math.random;s=JSON.parse(JSON.stringify(s));
  function m(v,lo,hi){return Math.max(lo,Math.min(hi,v*(1+(rnd()-0.5)*0.2)))}
  s.f=m(s.f,20,12000);if(s.f2!==null)s.f2=m(s.f2,20,12000);
  s.len=m(s.len,5,5000);s.atk=m(s.atk,0,2000);s.dec=m(s.dec,0,3000);s.sus=m(s.sus,0,1);s.rel=m(s.rel,0,4000);s.vol=m(s.vol,0.05,1);
  if(s.vibD>0){s.vibD=m(s.vibD,0.001,0.5);s.vibR=m(s.vibR,0.5,40)}
  if(s.lp>0)s.lp=m(s.lp,50,20000);if(s.hp>0)s.hp=m(s.hp,20,15000);
  if(s.arpM>0){s.arpM=m(s.arpM,0.1,8);s.arpT=m(s.arpT,1,s.len)}
  return _sndQ(s);
}
// Draws the waveform (its pitch squeezed so the cycles stay visible) under the envelope
function _sndDraw(cv,s){
  var dpr=window.devicePixelRatio||1,W=Math.max(10,cv.clientWidth||300),H=Math.max(10,cv.clientHeight||110);
  if(cv.width!==Math.round(W*dpr)||cv.height!==Math.round(H*dpr)){cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr)}
  var g=cv.getContext('2d');if(!g)return;
  g.setTransform(dpr,0,0,dpr,0,0);
  var cs=getComputedStyle(document.documentElement);
  function col(n,d){return(cs.getPropertyValue(n)||'').trim()||d}
  g.clearRect(0,0,W,H);g.fillStyle=col('--bg','#08090d');g.fillRect(0,0,W,H);
  var env=_sndEnv(s),total=env[env.length-1][0],mid=H/2,amp=H/2-8,N=Math.max(200,Math.floor(W*2)),k=36/Math.max(1,s.f*Math.max(1,s.len)/1000);
  g.strokeStyle=col('--border','#1a1d2a');g.lineWidth=1;g.beginPath();g.moveTo(0,mid);g.lineTo(W,mid);
  var gx=W*s.len/total;g.moveTo(gx,4);g.lineTo(gx,H-4);g.stroke();
  var ph=0,seed=12345,nz=0,vol=Math.max(0,Math.min(1,s.vol));
  g.strokeStyle=col('--cyan','#2dd4bf');g.lineWidth=1.2;g.beginPath();
  for(var i=0;i<=N;i++){
    var t=total*i/N,f=_sndPitchAt(s,t);
    if(s.vibD>0&&s.vibR>0)f*=1+s.vibD*Math.sin(2*Math.PI*s.vibR*t/1000);
    ph+=f*(total/N/1000)*k;
    var x=ph-Math.floor(ph),y;
    if(s.wave==='sine')y=Math.sin(2*Math.PI*x);
    else if(s.wave==='square')y=x<0.5?1:-1;
    else if(s.wave==='saw')y=2*x-1;
    else if(s.wave==='triangle')y=1-4*Math.abs(x-0.5);
    else{if(i%2===0){seed=(seed*1103515245+12345)&0x7fffffff;nz=seed/0x3fffffff-1}y=nz}
    var e=_sndEnvAt(env,t)*vol,px=W*i/N,py=mid-y*e*amp;
    if(i)g.lineTo(px,py);else g.moveTo(px,py);
  }
  g.stroke();
  g.strokeStyle=col('--yellow','#fde047');g.lineWidth=1.5;g.beginPath();
  env.forEach(function(p,i){var px=W*p[0]/total,py=mid-p[1]*vol*amp;if(i)g.lineTo(px,py);else g.moveTo(px,py)});
  g.stroke();
  g.fillStyle=col('--fg2','#8c93a8');g.font='11px '+(col('--mono','monospace'));g.fillText(Math.round(total)+' ms',6,14);
}
// Plays a spec now (a tool button: a user gesture, so audio may start)
function _sndPreview(spec,pitchMul){
  _sndWant=true;_sndUnlock();
  var ac=_sndCtx();if(!ac)return null;
  return _sndVoice(ac,_sndMaster,spec,ac.currentTime+0.01,pitchMul||1,1);
}
function _drwChips(items,cur,onPick,onNew,newLabel){
  var box=_drwEl('div',{cls:'drw-chips',role:'tablist'});
  items.forEach(function(it,i){box.appendChild(_drwEl('button',{type:'button',role:'tab','aria-selected':i===cur?'true':'false',cls:'drw-chip'+(i===cur?' on':'')+(it.dirty?' dirty':''),text:it.name,on:{click:function(){onPick(i)}}}))});
  if(onNew)box.appendChild(_drwBtn(newLabel||'+ New',onNew,'drw-chip drw-add'));
  return box;
}
function _drwLogPos(lo,hi){return{toPos:function(v){return Math.round(1000*Math.log(Math.max(lo,Math.min(hi,v))/lo)/Math.log(hi/lo))},fromPos:function(p){return lo*Math.pow(hi/lo,p/1000)}}}
function _drawerSoundTool(ctx){
  var list=ctx.blocks('sound').map(_sndRead),cur=0,ui={};
  if(!list.length)list.push({name:'coin',origName:null,spec:_sndPreset('coin'),orig:null,dirty:false,fresh:true});
  function S(){return list[cur]}
  function names(except){return list.filter(function(x,i){return i!==except}).map(function(x){return x.name})}
  function textOf(it){return _sndWrite(it.name,it.spec,it.orig)}
  function dirty(){var any=false;list.forEach(function(it){if(it.dirty)any=true});ctx.setDirty(any)}
  function changed(play){S().dirty=true;dirty();refresh();if(play)_sndPreview(S().spec)}
  function refresh(){
    _sndDraw(ui.cv,S().spec);
    ui.code.textContent=textOf(S());
    ui.paint.forEach(function(p){p.paint()});
    ui.chips.querySelectorAll('.drw-chip').forEach(function(c,i){if(list[i])c.classList.toggle('dirty',!!list[i].dirty)});
  }
  function build(){
    var b=ctx.body,it=S(),s=it.spec;b.innerHTML='';ui.paint=[];
    ui.chips=_drwChips(list,cur,function(i){cur=i;build()},function(){
      var n=_drwFreeName('sound',names(-1));list.push({name:n,origName:null,spec:_sndPreset('blip'),orig:null,dirty:true});cur=list.length-1;dirty();build();_sndPreview(S().spec);
    },'+ New sound');
    b.appendChild(ui.chips);
    var nameIn=_drwEl('input',{type:'text',cls:'drw-name',value:it.name,'aria-label':'Sound name',autocomplete:'off',autocapitalize:'none',spellcheck:'false'});
    nameIn.addEventListener('change',function(){
      var n=nameIn.value.trim();
      if(!_drwNameOk(n)){ctx.toast('A name is letters, digits and _ (not starting with a digit)');nameIn.value=it.name;return}
      if(names(cur).indexOf(n)>=0){ctx.toast('There is already a sound called '+n);nameIn.value=it.name;return}
      if(n!==it.name){it.name=n;changed(false);ui.chips.children[cur].textContent=n}
    });
    b.appendChild(_drwEl('div',{cls:'drw-row'},[_drwEl('label',{cls:'drw-lab',text:'Name'}),nameIn]));
    ui.cv=_drwEl('canvas',{cls:'snd-cv','aria-label':'Waveform and envelope of the sound',role:'img'});
    var big=_drwBtn('▶',function(){_sndPreview(S().spec)},'drw-play','Play the sound');
    b.appendChild(_drwEl('div',{cls:'snd-top'},[ui.cv,big]));
    var pre=_drwEl('div',{cls:'drw-wrap'});
    Object.keys(_SND_PRESETS).forEach(function(k){pre.appendChild(_drwBtn(k,function(){it.spec=_sndPreset(k);s=it.spec;changed(true)},'drw-sm'))});
    b.appendChild(_drwEl('div',{cls:'drw-lab',text:'Presets'}));b.appendChild(pre);
    b.appendChild(_drwEl('div',{cls:'drw-wrap'},[_drwBtn('🎲 Randomize',function(){it.spec=_sndRandom();changed(true)}),_drwBtn('🧬 Mutate',function(){it.spec=_sndMutate(it.spec);changed(true)})]));
    function sp(){return S().spec}
    var wave=_drwSeg([['sine','sine'],['square','square'],['saw','saw'],['triangle','triangle'],['noise','noise']],function(){return sp().wave},function(v){sp().wave=v;changed(true)},'Waveform');
    ui.paint.push(wave);
    b.appendChild(_drwEl('div',{cls:'drw-lab',text:'Waveform'}));b.appendChild(wave);
    function sl(o){var r=_drwSlider(o);ui.paint.push(r);return r}
    function hz(v){return _sndFmt(v,v<100?1:0)}
    var LP=_drwLogPos(20,12000),FP=_drwLogPos(50,20000);
    var g1=_drwEl('div',{cls:'drw-group'},[
      sl({label:'Start pitch',min:20,max:12000,get:function(){return sp().f},set:function(v,done){sp().f=+(+v).toFixed(v<100?1:0);changed(done)},fmt:hz,toPos:LP.toPos,fromPos:LP.fromPos,unit:'Hz'}),
      _drwEl('div',{cls:'drw-row'},[(function(){var c=_drwEl('input',{type:'checkbox',id:'sndSweep','aria-label':'Sweep to an end pitch'});c.checked=sp().f2!==null;c.addEventListener('change',function(){sp().f2=c.checked?Math.min(12000,Math.round(sp().f*1.5)):null;changed(true)});ui.paint.push({paint:function(){c.checked=sp().f2!==null}});return c})(),_drwEl('label',{'for':'sndSweep',cls:'drw-ck',text:'Sweep to an end pitch'})]),
      sl({label:'End pitch',min:20,max:12000,get:function(){return sp().f2===null?sp().f:sp().f2},set:function(v,done){sp().f2=+(+v).toFixed(v<100?1:0);changed(done)},fmt:hz,toPos:LP.toPos,fromPos:LP.fromPos,unit:'Hz'}),
      (function(){var c=_drwSeg([['lin','linear'],['exp','exponential']],function(){return sp().curve},function(v){sp().curve=v;changed(true)},'Sweep curve');ui.paint.push(c);return _drwEl('div',{cls:'drw-row'},[_drwEl('span',{cls:'drw-lab',text:'Curve'}),c])})()
    ]);
    b.appendChild(_drwEl('div',{cls:'drw-lab',text:'Pitch'}));b.appendChild(g1);
    function ms(lbl,k,max){return sl({label:lbl,min:0,max:max,get:function(){return sp()[k]},set:function(v,done){sp()[k]=Math.round(v);changed(done)},fmt:function(v){return String(Math.round(v))},unit:'ms'})}
    function unit(lbl,k){return sl({label:lbl,min:0,max:1,step:0.01,get:function(){return sp()[k]},set:function(v,done){sp()[k]=+(+v).toFixed(2);changed(done)},fmt:function(v){return _sndFmt(v,2)}})}
    var lenS=sl({label:'Length',min:5,max:3000,get:function(){return sp().len},set:function(v,done){sp().len=Math.max(5,Math.round(v));changed(done)},fmt:function(v){return String(Math.round(v))},unit:'ms',toPos:_drwLogPos(5,3000).toPos,fromPos:_drwLogPos(5,3000).fromPos});
    b.appendChild(_drwEl('div',{cls:'drw-lab',text:'Envelope'}));
    b.appendChild(_drwEl('div',{cls:'drw-group'},[lenS,ms('Attack','atk',1000),ms('Decay','dec',2000),unit('Sustain','sus'),ms('Release','rel',3000),unit('Volume','vol')]));
    var F=function(lbl,k){return sl({label:lbl,min:0,max:20000,get:function(){return sp()[k]},set:function(v,done){sp()[k]=v<=50.5?0:Math.round(v);changed(done)},fmt:function(v){return v>0?String(Math.round(v)):'off'},parse:function(t){return/^off$/i.test(t)?0:parseFloat(t)},toPos:function(v){return v>0?Math.max(1,FP.toPos(v)):0},fromPos:function(p){return p<=0?0:FP.fromPos(p)},unit:'Hz'})};
    b.appendChild(_drwEl('div',{cls:'drw-lab',text:'Effects'}));
    b.appendChild(_drwEl('div',{cls:'drw-group'},[
      sl({label:'Vibrato depth',min:0,max:0.5,step:0.005,get:function(){return sp().vibD},set:function(v,done){sp().vibD=+(+v).toFixed(3);if(sp().vibD>0&&!(sp().vibR>0))sp().vibR=6;changed(done)},fmt:function(v){return v>0?_sndFmt(v,3):'off'},parse:function(t){return/^off$/i.test(t)?0:parseFloat(t)}}),
      sl({label:'Vibrato rate',min:0,max:40,step:0.5,get:function(){return sp().vibR},set:function(v,done){sp().vibR=+(+v).toFixed(1);changed(done)},fmt:function(v){return _sndFmt(v,1)},unit:'Hz'}),
      F('Low-pass','lp'),F('High-pass','hp'),
      sl({label:'Arp jump ×',min:0,max:4,step:0.005,get:function(){return sp().arpM},set:function(v,done){sp().arpM=+(+v).toFixed(3);if(sp().arpM>0&&!(sp().arpT>0))sp().arpT=Math.max(1,Math.round(sp().len/2));changed(done)},fmt:function(v){return v>0?_sndFmt(v,3):'off'},parse:function(t){return/^off$/i.test(t)?0:parseFloat(t)}}),
      sl({label:'Arp at',min:0,max:3000,get:function(){return sp().arpT},set:function(v,done){sp().arpT=Math.round(v);changed(done)},fmt:function(v){return String(Math.round(v))},unit:'ms'})
    ]));
    if(it.orig)b.appendChild(_drwKept(it.orig.parts.filter(function(p){return!p.ok||p.key==='comment'}),function(){changed(false)}));
    b.appendChild(_drwEl('div',{cls:'drw-lab',text:'Block in the program'+(it.path?' ('+it.path+')':' (new: goes into sounds.emit)')}));
    ui.code=_drwEl('pre',{cls:'drw-code'});b.appendChild(ui.code);
    b.appendChild(_drwEl('p',{cls:'drw-dim',text:'Play it in your program with play('+it.name+'), play('+it.name+', 1.5) for a higher pitch, play('+it.name+', 1.0, 0.5) for half volume.'}));
    refresh();
    requestAnimationFrame(function(){if(ui.cv.isConnected)_sndDraw(ui.cv,S().spec)});
  }
  function save(){
    var done=[];
    list.forEach(function(it){
      if(!it.dirty&&!it.fresh)return;
      if(it.fresh&&!it.dirty)return;
      var text=textOf(it),r=ctx.write('sound',it.origName||it.name,text);
      var nb={name:it.name,text:text,path:r.path};var fresh=_sndRead(nb);
      it.orig=fresh.orig;it.spec=fresh.spec;it.origName=it.name;it.path=r.path;it.dirty=false;it.fresh=false;
      done.push(it.name);
    });
    dirty();build();
    ctx.toast(done.length?'Saved '+done.join(', '):'Nothing to save');
  }
  function del(){
    var it=S();
    if(!window.confirm('Delete the sound '+it.name+(it.origName?' from the program':'')+'?'))return;
    if(it.origName)ctx.remove('sound',it.origName);
    list.splice(cur,1);
    if(!list.length)list.push({name:'coin',origName:null,spec:_sndPreset('coin'),orig:null,dirty:false,fresh:true});
    cur=Math.min(cur,list.length-1);dirty();build();ctx.toast('Deleted '+it.name);
  }
  ctx.footer.appendChild(_drwBtn('Delete',del,'drw-danger'));
  ctx.footer.appendChild(_drwBtn('Save to program',save,'drw-pri'));
  build();
  var onResize=function(){if(ui.cv&&ui.cv.isConnected)_sndDraw(ui.cv,S().spec)};
  window.addEventListener('resize',onResize);
  return function(){window.removeEventListener('resize',onResize)};
}
// ── Music tool ──
var _MUS_LO=36,_MUS_HI=84,_MUS_CW=34,_MUS_RH=24,_MUS_DH=44,_MUS_DRUM_NAMES={K:'Kick',S:'Snare',H:'Hat',C:'Clap'};
function _musNormalize(cells){for(var i=0;i<cells.length;i++)if(cells[i]==='-'&&!(i>0&&(Array.isArray(cells[i-1])||cells[i-1]==='-')))cells[i]=null;return cells}
function _musSetLen(cells,s,L){
  var i;for(i=s+1;i<cells.length&&i<s+L;i++){if(Array.isArray(cells[i]))break;cells[i]='-'}
  for(;i<cells.length&&cells[i]==='-';i++)cells[i]=null;
}
function _musAddNote(cells,s,midi,L){
  var c=cells[s];
  if(Array.isArray(c)){if(c.indexOf(midi)<0)c.push(midi);return}
  cells[s]=[midi];_musSetLen(cells,s,L);_musNormalize(cells);
}
function _musDelNote(cells,s,midi){
  var c=cells[s];if(!Array.isArray(c))return;
  var k=c.indexOf(midi);if(k>=0)c.splice(k,1);
  if(!c.length){cells[s]=null;_musNormalize(cells)}
}
function _musResize(song,n){
  n=Math.max(1,Math.min(64,n|0));song.steps=n;
  song.tracks.forEach(function(tr){while(tr.cells.length<n)tr.cells.push(tr.drums?'':null);tr.cells.length=n;if(!tr.drums)_musNormalize(tr.cells)});
}
function _musNewTrack(song,drums){
  var taken=song.tracks.map(function(t){return t.name});
  var base=drums?'drums':['lead','bass','pad','arp'].filter(function(n){return taken.indexOf(n)<0})[0]||'track';
  var tr={name:_drwFreeName(base,taken),wave:drums?null:(base==='bass'?'triangle':'square'),drums:!!drums,vol:1,mute:false,cells:[]};
  for(var i=0;i<song.steps;i++)tr.cells.push(drums?'':null);
  song.tracks.push(tr);return tr;
}
function _musNewSong(name){var s={bpm:120,steps:16,swing:0,tracks:[]};_musNewTrack(s,false);_musNewTrack(s,true);return{name:name,origName:null,spec:s,orig:null,dirty:false,fresh:true}}
function _drawerMusicTool(ctx){
  var list=ctx.blocks('music').map(_musRead),cur=0,ti=0,newLen=2,ui={},play=null,raf=0;
  if(!list.length)list.push(_musNewSong('theme'));
  function M(){return list[cur]}
  function T(){return M().spec.tracks[ti]||null}
  function names(except){return list.filter(function(x,i){return i!==except}).map(function(x){return x.name})}
  function dirty(){var any=false;list.forEach(function(it){if(it.dirty)any=true});ctx.setDirty(any)}
  function changed(){M().dirty=true;dirty();ui.code.textContent=_musWrite(M().name,M().spec,M().orig);ui.chips.querySelectorAll('.drw-chip').forEach(function(c,i){if(list[i])c.classList.toggle('dirty',!!list[i].dirty)})}
  function stop(){if(play){play.stop();play=null}if(raf){cancelAnimationFrame(raf);raf=0}if(ui.ph)ui.ph.style.display='none';paintTransport()}
  function start(loop){
    stop();_sndWant=true;_sndUnlock();
    var ac=_sndCtx();if(!ac){ctx.toast('This browser has no Web Audio');return}
    play=_musStart(ac,M().spec,{loop:loop,onEnd:function(){if(play&&!play.playing){play=null;stop()}}});play.loop=loop;
    paintTransport();
    var tick=function(){
      raf=0;if(!play)return;
      var st=play.stepAt(ac.currentTime);
      if(ui.ph){if(st<0)ui.ph.style.display='none';else{ui.ph.style.display='block';ui.ph.style.transform='translateX('+(st*_MUS_CW)+'px)'}}
      ui.phStep=st;
      raf=requestAnimationFrame(tick);
    };
    raf=requestAnimationFrame(tick);
  }
  function paintTransport(){if(!ui.tp)return;ui.tp.once.classList.toggle('on',!!(play&&!play.loop));ui.tp.loop.classList.toggle('on',!!(play&&play.loop))}
  function noteEl(s,midi,L){
    var row=_MUS_HI-midi;
    return _drwEl('div',{cls:'mus-note','data-s':String(s),'data-m':String(midi),title:_musName(midi),style:'left:'+(s*_MUS_CW+1)+'px;top:'+(row*_MUS_RH+1)+'px;width:'+(L*_MUS_CW-2)+'px;height:'+(_MUS_RH-2)+'px'},[_drwEl('span',{text:_musName(midi)})]);
  }
  function hitEl(s,k){var lane=_MUS_DRUMS.indexOf(k);return _drwEl('div',{cls:'mus-note mus-hit','data-s':String(s),'data-d':k,style:'left:'+(s*_MUS_CW+3)+'px;top:'+(lane*_MUS_DH+6)+'px;width:'+(_MUS_CW-6)+'px;height:'+(_MUS_DH-12)+'px'})}
  // Notes of the current track: rebuilt from the cells (only the note layer, not the grid)
  function paintNotes(){
    var tr=T(),layer=ui.notes;if(!layer)return;layer.innerHTML='';if(!tr)return;
    tr.cells.forEach(function(c,s){
      if(tr.drums){if(c)for(var k=0;k<c.length;k++)layer.appendChild(hitEl(s,c[k]))}
      else if(Array.isArray(c)){var L=_musLen(tr.cells,s);c.forEach(function(m){if(m>=_MUS_LO&&m<=_MUS_HI)layer.appendChild(noteEl(s,m,L))})}
    });
  }
  function buildRoll(){
    var tr=T(),box=ui.roll;box.innerHTML='';ui.notes=null;ui.ph=null;
    if(!tr){box.appendChild(_drwEl('p',{cls:'drw-dim',text:'No track: add one with + Track or + Drums.'}));return}
    var steps=M().spec.steps,drums=tr.drums,rows=drums?4:(_MUS_HI-_MUS_LO+1),rh=drums?_MUS_DH:_MUS_RH,W=steps*_MUS_CW,H=rows*rh;
    var keys=_drwEl('div',{cls:'mus-keys',style:'height:'+H+'px'});
    var grid=_drwEl('div',{cls:'mus-grid'+(drums?' drums':''),style:'width:'+W+'px;height:'+H+'px;background-size:'+(_MUS_CW*4)+'px 100%,'+_MUS_CW+'px 100%'});
    for(var r=0;r<rows;r++){
      if(drums){var k=_MUS_DRUMS[r];keys.appendChild(_drwEl('div',{cls:'mus-key c',style:'height:'+rh+'px',text:_MUS_DRUM_NAMES[k]+' '+k}));continue}
      var midi=_MUS_HI-r,nm=_musName(midi),black=nm.indexOf('#')>0;
      keys.appendChild(_drwEl('div',{cls:'mus-key'+(black?' b':'')+(midi%12===0?' c':''),style:'height:'+rh+'px',text:nm}));
      if(black||midi%12===0)grid.appendChild(_drwEl('div',{cls:'mus-row'+(black?' b':' c'),style:'top:'+(r*rh)+'px;height:'+rh+'px'}));
    }
    ui.notes=_drwEl('div',{cls:'mus-layer'});grid.appendChild(ui.notes);
    ui.ph=_drwEl('div',{cls:'mus-ph',style:'height:'+H+'px;width:'+_MUS_CW+'px;display:none'});grid.appendChild(ui.ph);
    box.appendChild(_drwEl('div',{cls:'mus-inner',style:'width:'+(W+48)+'px'},[keys,grid]));
    paintNotes();
    // tap on an empty cell: a note (of the chosen length) / a drum hit; tap on a note: remove it;
    // drag a note sideways: its length. Dragging an empty place scrolls the roll.
    var st=null;
    function cell(e){var b=grid.getBoundingClientRect();return{s:Math.floor((e.clientX-b.left)/_MUS_CW),r:Math.floor((e.clientY-b.top)/rh),x:e.clientX-b.left}}
    grid.addEventListener('pointerdown',function(e){
      if(e.button>0)return;
      var n=e.target.closest&&e.target.closest('.mus-note');
      st={x:e.clientX,y:e.clientY,n:n,moved:false,id:e.pointerId};
      if(n&&!drums){try{grid.setPointerCapture(e.pointerId)}catch(x){}e.preventDefault()}
    });
    grid.addEventListener('pointermove',function(e){
      if(!st||st.id!==e.pointerId)return;
      if(Math.abs(e.clientX-st.x)>8||Math.abs(e.clientY-st.y)>8)st.moved=true;
      if(st.n&&!drums&&st.moved){var s=+st.n.getAttribute('data-s'),c=cell(e),L=Math.max(1,Math.min(steps-s,Math.ceil(c.x/_MUS_CW)-s));st.L=L;st.n.style.width=(L*_MUS_CW-2)+'px'}
    });
    grid.addEventListener('pointercancel',function(){if(st&&st.n){st=null;paintNotes()}else st=null});
    grid.addEventListener('pointerup',function(e){
      if(!st||st.id!==e.pointerId)return;
      var a=st;st=null;var tr=T();if(!tr)return;
      if(a.n&&!drums){
        var s=+a.n.getAttribute('data-s'),m=+a.n.getAttribute('data-m');
        if(a.moved){if(a.L){_musSetLen(tr.cells,s,a.L);_musNormalize(tr.cells)}}
        else _musDelNote(tr.cells,s,m);
        paintNotes();changed();return;
      }
      if(a.moved)return;
      var c=cell(e);if(c.s<0||c.s>=steps||c.r<0||c.r>=rows)return;
      if(drums){
        var k=_MUS_DRUMS[c.r],v=tr.cells[c.s]||'';
        tr.cells[c.s]=v.indexOf(k)>=0?v.replace(k,''):_MUS_DRUMS.split('').filter(function(x){return x===k||v.indexOf(x)>=0}).join('');
        if(tr.cells[c.s].indexOf(k)>=0)_sndPreview(_MUS_KIT[k]);
      }else{
        var midi=_MUS_HI-c.r;
        _musAddNote(tr.cells,c.s,midi,newLen);
        _sndPreview(_musNoteSpec(tr,midi,1,60/M().spec.bpm/4));
      }
      paintNotes();changed();
    });
  }
  function buildTrackBar(){
    var box=ui.tbar;box.innerHTML='';var song=M().spec;
    var chips=_drwEl('div',{cls:'drw-chips',role:'tablist','aria-label':'Tracks'});
    song.tracks.forEach(function(tr,i){chips.appendChild(_drwEl('button',{type:'button',role:'tab','aria-selected':i===ti?'true':'false',cls:'drw-chip'+(i===ti?' on':'')+(tr.mute?' muted':''),text:(tr.drums?'🥁 ':'🎹 ')+tr.name,on:{click:function(){ti=i;buildTrackBar();buildRoll();scrollRoll()}}}))});
    chips.appendChild(_drwBtn('+ Track',function(){_musNewTrack(song,false);ti=song.tracks.length-1;changed();buildTrackBar();buildRoll();scrollRoll()},'drw-chip drw-add'));
    chips.appendChild(_drwBtn('+ Drums',function(){_musNewTrack(song,true);ti=song.tracks.length-1;changed();buildTrackBar();buildRoll()},'drw-chip drw-add'));
    box.appendChild(chips);
    box=ui.tset;box.innerHTML='';
    var tr=T();if(!tr)return;
    var nm=_drwEl('input',{type:'text',cls:'drw-name','aria-label':'Track name',value:tr.name,autocomplete:'off',autocapitalize:'none',spellcheck:'false'});
    nm.addEventListener('change',function(){var n=nm.value.trim();if(!_drwNameOk(n)||song.tracks.some(function(t){return t!==tr&&t.name===n})){ctx.toast('Track names are letters, digits and _, each used once');nm.value=tr.name;return}tr.name=n;changed();buildTrackBar()});
    var row=[_drwEl('label',{cls:'drw-lab',text:'Track'}),nm];
    box.appendChild(_drwEl('div',{cls:'drw-row'},row));
    if(!tr.drums)box.appendChild(_drwSeg([['sine','sine'],['square','square'],['saw','saw'],['triangle','triangle'],['noise','noise']],function(){return tr.wave},function(v){tr.wave=v;changed();_sndPreview(_musNoteSpec(tr,72,2,0.125))},'Track waveform'));
    box.appendChild(_drwSlider({label:'Volume',min:0,max:1,step:0.05,get:function(){return tr.vol},set:function(v){tr.vol=+(+v).toFixed(2);changed()},fmt:function(v){return _sndFmt(v,2)}}));
    var mute=_drwBtn(tr.mute?'🔇 Muted':'🔊 Mute',function(){tr.mute=!tr.mute;changed();buildTrackBar()},'drw-sm'+(tr.mute?' on':''),'Mute this track');
    var delT=_drwBtn('Delete track',function(){if(!window.confirm('Delete the track '+tr.name+'?'))return;song.tracks.splice(song.tracks.indexOf(tr),1);ti=Math.max(0,Math.min(ti,song.tracks.length-1));changed();buildTrackBar();buildRoll()},'drw-sm drw-danger');
    var row2=[mute,delT];
    if(!tr.drums){
      row2.push(_drwEl('span',{cls:'drw-lab',text:'New notes'}));
      row2.push(_drwSeg([[1,'1'],[2,'2'],[4,'4'],[8,'8']],function(){return newLen},function(v){newLen=v},'Length of new notes in steps'));
    }
    box.appendChild(_drwEl('div',{cls:'drw-wrap'},row2));
  }
  function scrollRoll(){var tr=T();if(!tr||tr.drums)return;var lo=127;tr.cells.forEach(function(c){if(Array.isArray(c))c.forEach(function(m){if(m>=_MUS_LO&&m<=_MUS_HI&&_MUS_HI-m<lo)lo=_MUS_HI-m})});if(lo===127)lo=_MUS_HI-79;ui.roll.scrollTop=Math.max(0,(lo-2)*_MUS_RH)}
  function build(){
    stop();
    var b=ctx.body,it=M(),song=it.spec;b.innerHTML='';ti=Math.min(ti,Math.max(0,song.tracks.length-1));
    ui.chips=_drwChips(list,cur,function(i){cur=i;ti=0;build()},function(){list.push(_musNewSong(_drwFreeName('song',names(-1))));list[list.length-1].dirty=true;list[list.length-1].fresh=false;cur=list.length-1;ti=0;dirty();build()},'+ New music');
    b.appendChild(ui.chips);
    var nameIn=_drwEl('input',{type:'text',cls:'drw-name',value:it.name,'aria-label':'Music name',autocomplete:'off',autocapitalize:'none',spellcheck:'false'});
    nameIn.addEventListener('change',function(){var n=nameIn.value.trim();if(!_drwNameOk(n)||names(cur).indexOf(n)>=0){ctx.toast(_drwNameOk(n)?'There is already music called '+n:'A name is letters, digits and _');nameIn.value=it.name;return}it.name=n;changed();ui.chips.children[cur].textContent=n});
    b.appendChild(_drwEl('div',{cls:'drw-row'},[_drwEl('label',{cls:'drw-lab',text:'Name'}),nameIn]));
    var bpm=_drwSlider({label:'BPM',min:40,max:300,get:function(){return song.bpm},set:function(v){song.bpm=Math.round(v);changed()},fmt:function(v){return String(Math.round(v))}});
    var steps=_drwSlider({label:'Steps',min:8,max:64,get:function(){return song.steps},set:function(v,done){var n=Math.round(v);if(n!==song.steps){_musResize(song,n);changed();if(done)buildRoll();else{clearTimeout(ui.stT);ui.stT=setTimeout(buildRoll,200)}}},fmt:function(v){return String(Math.round(v))}});
    var swing=_drwSlider({label:'Swing',min:0,max:0.5,step:0.05,get:function(){return song.swing},set:function(v){song.swing=+(+v).toFixed(2);changed()},fmt:function(v){return _sndFmt(v,2)}});
    b.appendChild(_drwEl('div',{cls:'drw-group'},[bpm,steps,swing]));
    ui.tp={once:_drwBtn('▶ Play',function(){if(play&&!play.loop)stop();else start(false)},'drw-btn-l','Play once'),loop:_drwBtn('🔁 Loop',function(){if(play&&play.loop)stop();else start(true)},'drw-btn-l','Play in a loop'),stop:_drwBtn('■ Stop',stop,'drw-btn-l','Stop')};
    b.appendChild(_drwEl('div',{cls:'drw-wrap mus-tp'},[ui.tp.once,ui.tp.loop,ui.tp.stop]));
    ui.tbar=_drwEl('div',{cls:'mus-tbar'});b.appendChild(ui.tbar);
    ui.roll=_drwEl('div',{cls:'mus-roll',role:'group','aria-label':'Piano roll: tap to add a note, tap a note to remove it, drag a note sideways to change its length'});
    b.appendChild(ui.roll);
    ui.tset=_drwEl('div',{cls:'mus-tset'});b.appendChild(ui.tset);
    if(it.orig)b.appendChild(_drwKept(it.orig.lines.filter(function(L){return!L.ok||L.comment}).concat(it.orig.head.filter(function(p){return!p.ok})),function(){changed()}));
    b.appendChild(_drwEl('div',{cls:'drw-lab',text:'Block in the program'+(it.path?' ('+it.path+')':' (new: goes into sounds.emit)')}));
    ui.code=_drwEl('pre',{cls:'drw-code',text:_musWrite(it.name,song,it.orig)});b.appendChild(ui.code);
    b.appendChild(_drwEl('p',{cls:'drw-dim',text:'In your program: music('+it.name+') loops it, stopMusic() stops it, musicPlaying() tells whether it plays.'}));
    buildTrackBar();buildRoll();
    requestAnimationFrame(scrollRoll);
  }
  function save(){
    var done=[];
    list.forEach(function(it){
      if(!it.dirty)return;
      var text=_musWrite(it.name,it.spec,it.orig),r=ctx.write('music',it.origName||it.name,text);
      var fresh=_musRead({name:it.name,text:text,path:r.path});
      var keep=it.spec.tracks.indexOf(T());
      it.orig=fresh.orig;it.spec=fresh.spec;it.origName=it.name;it.path=r.path;it.dirty=false;it.fresh=false;
      if(it===M())ti=Math.max(0,keep);
      done.push(it.name);
    });
    dirty();build();
    ctx.toast(done.length?'Saved '+done.join(', '):'Nothing to save');
  }
  function del(){
    var it=M();
    if(!window.confirm('Delete the music '+it.name+(it.origName?' from the program':'')+'?'))return;
    if(it.origName)ctx.remove('music',it.origName);
    list.splice(cur,1);if(!list.length)list.push(_musNewSong('theme'));
    cur=Math.min(cur,list.length-1);ti=0;dirty();build();ctx.toast('Deleted '+it.name);
  }
  ctx.footer.appendChild(_drwBtn('Delete',del,'drw-danger'));
  ctx.footer.appendChild(_drwBtn('Save to program',save,'drw-pri'));
  build();
  ctx.music={get playing(){return!!play},step:function(){return ui.phStep},start:start,stop:stop};   // for tests
  return function(){stop()};
}
_drawerRegister({id:'sound',label:'Sound',icon:'🔊',desc:'Sound effects: waveform, pitch sweep, envelope, presets',open:_drawerSoundTool});
_drawerRegister({id:'music',label:'Music',icon:'🎵',desc:'Tunes: piano roll, drum lanes, loops',open:_drawerMusicTool});
// ── Blocks in the editor: highlighting, autocomplete ──
['play','music','stopMusic','musicPlaying'].forEach(function(n){_emitBlt.add(n)});
var _BLK_WORDS={sine:1,square:1,saw:1,triangle:1,noise:1,drums:1,atk:1,dec:1,sus:1,rel:1,vol:1,vib:1,lowpass:1,highpass:1,arp:1,curve:1,lin:1,exp:1,len:1,bpm:1,steps:1,swing:1,mute:1};
function _blkHlBody(kind,t){
  if(kind!=='sound'&&kind!=='music')return escH(t);
  return t.replace(/(\/\/.*$)|([A-G](?:#|b)?\d(?:\+[A-G](?:#|b)?\d)*)(?![\w#])|(\d+(?:\.\d+)?(?:ms|s|hz)?)\b|([A-Za-z_]\w*)|([>.\-|+,:])|([^\s])/gm,function(all,cm,note,num,word,op,other){
    if(cm)return'<span class="cmt">'+escH(cm)+'</span>';
    if(note)return'<span class="str">'+note+'</span>';
    if(num)return'<span class="num">'+num+'</span>';
    if(word){if(_BLK_WORDS[word])return'<span class="blt">'+word+'</span>';if(kind==='music'&&/^[KSHC]+$/.test(word))return'<span class="str">'+word+'</span>';return escH(word)}
    if(op)return'<span class="dl">'+escH(op)+'</span>';
    return escH(other);
  });
}
// Block headers get their own colours (kind = keyword, name = type colour); sound / music bodies too.
// The highlighter's output is replaced line by line, only for lines whose markup is complete on the line.
hlCode=(function(hl){return function(){
  var r=hl.apply(this,arguments);
  try{
    var src=ed.value;
    if(!/(^|\n)(sound|music|sprite|map|controls|thing)[ \t]+[A-Za-z_]\w*[ \t]*:|(^|\n)rules[ \t]*:/i.test(src))return r;
    var blocks=_drawerScan(src);if(!blocks.length)return r;
    var html=hlInner.innerHTML,out=html.split('\n'),lines=src.split('\n');
    if(out.length<lines.length)return r;
    blocks.forEach(function(b){
      if(b.kind==='sprite'&&typeof _sprHlBlock==='function')return;   // SPRITE colours its blocks itself
      for(var i=b.start;i<=b.end;i++){var o=out[i];if((o.match(/<span/g)||[]).length!==(o.match(/<\/span>/g)||[]).length)return}
      var m=/^([A-Za-z_]\w*)((?:[ \t]+)([A-Za-z_]\w*))?([ \t]*:)/.exec(lines[b.start]);if(!m)return;
      var rest=lines[b.start].substring(m[0].length);
      out[b.start]='<span class="kw">'+m[1]+'</span>'+(m[2]?escH(m[2].substring(0,m[2].length-m[3].length))+'<span class="ty">'+m[3]+'</span>':'')+escH(m[4].slice(0,-1))+'<span class="dl">:</span>'+_blkHlBody(b.kind,rest);
      for(var j=b.start+1;j<=b.end;j++)out[j]=_blkHlBody(b.kind,lines[j]);
    });
    hlInner.innerHTML=out.join('\n');
  }catch(e){}
  return r;
}})(hlCode);
// play( / music( → the sound / music names of the project; `sound` / `music` at a line start → a block snippet
var _BLK_SNIPS=[['sound','sound name: square 880, 120ms','name'],['music','music name: 120 bpm, 16 steps\n  lead square: C5 . E5 . G5 . E5 . C5 . . . . . . .\n  drums: K . H . S . H . K . H . S . H .','name']];
function _blkACCheck(before){
  try{
    if(_libInStrOrComment(before))return false;
    var m=/(?:^|[^\w$.])(play|music)\(\s*(\w*)$/i.exec(before);
    if(!m)return false;
    var kind=m[1].toLowerCase()==='play'?'sound':'music',typed=m[2].toLowerCase(),items=[];
    _drawerBlocks(kind).forEach(function(b){
      if(b.name.toLowerCase().indexOf(typed)!==0||b.name===m[2])return;
      var d=_drawerBody(b.text,kind).trim().split('\n')[0];
      items.push(_memItem(b.name,kind+' · '+(d.length>40?d.slice(0,40)+'…':d)+(b.path!==_proj.files[_proj.active].path?' · '+b.path:'')));
    });
    if(!items.length)return false;
    _memShowItems(items,before,'blk:'+before.length+':'+m[0]);
    return true;
  }catch(e){}
  return false;
}
function _blkACFallback(before){
  try{
    if(_libInStrOrComment(before))return;
    var lt=before.substring(before.lastIndexOf('\n')+1);
    if(!/^[a-z]{2,}$/.test(lt))return;
    var items=[];
    _BLK_SNIPS.forEach(function(s){if(s[0].indexOf(lt)===0&&s[0]!==lt){var it=_memItem(s[0]+' block',s[1].split('\n')[0]+(s[1].indexOf('\n')>0?' …':''));it._memSnip={text:s[1],sel:s[2],rep:lt.length};items.push(it)}});
    if(!items.length)return;
    var base=acActive?acItems.filter(function(it){return it._libac!=='hint'}):[];
    _libACShow(items.concat(base),before,'bs:'+before.length+':'+lt);
  }catch(e){}
}
checkAC=(function(f){return function(){
  var before=null;try{before=ed.value.substring(0,ed.selectionStart)}catch(e){}
  if(before!==null&&_blkACCheck(before))return;
  var r=f.apply(this,arguments);
  if(before!==null)_blkACFallback(before);
  return r;
}})(checkAC);

// ═══ SOUND & MUSIC (runtime half) ═══
// `sound name: …` and `music name: …` blocks of the program text. This section is shared by the compiler (it
// checks the blocks with the parsers below), the Drawer's Sound and Music tools (they read, edit and write the
// blocks with the same parsers and preview with the same synth) and the program at run time (play, music,
// stopMusic, musicPlaying). The compiler hands the blocks to the runtime as imports.soundMeta (JSON:
// {v:1, sounds:{name:text}, music:{name:text}}, text = what follows "name:"), which _sndSetup parses again here.
//
// Sound block:  sound coin: square 880 > 1320, 90ms, atk 2, dec 20, sus 0.6, rel 60, vol 0.5, vib 0.02 6,
//                           lowpass 4000, highpass 200, arp 1.5 40ms, curve exp
//   Parts are separated by commas (or line breaks). The waveform comes first (sine square saw triangle noise),
//   optionally with the start pitch in Hz and "> end pitch" (a sweep over the length). Times are in ms (a bare
//   number, "90ms" or "0.09s"). Every other part is optional; a missing part has its default (see _sndDefaults).
//   For noise the pitch sets how bright the noise is (1000 = plain white noise).
// Music block:  music theme: 120 bpm, 16 steps, swing 0.2
//                 lead square: C5 . E5 . G5 - - . E5 . C5 . . . G4 .
//                 bass triangle vol 0.6: C3 - - - G2 - - - A2 - - - F2 - - -
//                 drums: K . H . S . H . K K H . S . H .
//   A step is a sixteenth note. Tokens: a note (C5, F#3, Bb2) or a chord (C4+E4+G4), "." rest, "-" hold the
//   previous note one more step; on a drum track K kick, S snare, H hat, C clap, several letters = several hits
//   (KH). "|" may be written between steps for readability. A track line is: name, waveform (or "drums"; a
//   track named drums needs nothing), optional "vol 0.6" and "mute", then ":" and the steps.
//
// Audio unlock: browsers (phones above all) start audio only after a user gesture. The AudioContext is created
// and resumed on the first pointerdown / touchend / keydown / click of the page. A play() before that is dropped
// silently; a music() before that is remembered and starts at the first gesture (musicPlaying() is already true).
var _SND_WAVES={sine:'sine',square:'square',saw:'sawtooth',triangle:'triangle',noise:'noise'};
var _SND_ORDER=['wave','len','atk','dec','sus','rel','vol','vib','lowpass','highpass','arp','curve'];
function _sndDefaults(){return{wave:'square',f:440,f2:null,len:200,atk:5,dec:0,sus:1,rel:50,vol:0.5,vibD:0,vibR:0,lp:0,hp:0,arpM:0,arpT:0,curve:'lin'}}
function _sndNum(s){return/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)?parseFloat(s):null}
// "90ms" "90" "0.09s" → ms (null if not a time)
function _sndTime(s){var m=/^([+-]?(?:\d+\.?\d*|\.\d+))(ms|s)?$/i.exec(s);if(!m)return null;var v=parseFloat(m[1]);return m[2]&&m[2].toLowerCase()==='s'?v*1000:v}
function _sndHz(s){var m=/^((?:\d+\.?\d*|\.\d+))(hz)?$/i.exec(s);return m?parseFloat(m[1]):null}
function _sndFmt(v,d){var s=(+(+v).toFixed(d)).toString();return s==='-0'?'0':s}
// Split text into parts at commas / line breaks; `//` starts a comment to the end of the line.
// → [{text (trimmed), off (offset of its first character), comment:bool}]
function _sndSplit(body){
  var parts=[],i=0,n=body.length,start=0;
  function push(a,b){var t=body.substring(a,b),l=t.length-t.replace(/^\s+/,'').length,tt=t.trim();if(tt)parts.push({text:tt,off:a+l,comment:false})}
  while(i<n){
    var c=body[i];
    if(c==='/'&&body[i+1]==='/'){push(start,i);var e=body.indexOf('\n',i);if(e<0)e=n;parts.push({text:body.substring(i,e).trim(),off:i,comment:true});i=e;start=i;continue}
    if(c===','||c==='\n'){push(start,i);i++;start=i;continue}
    i++;
  }
  push(start,n);
  return parts;
}
function _sndWords(p){var out=[],re=/\S+/g,m;while((m=re.exec(p.text)))out.push({w:m[0],off:p.off+m.index});return out}
// Parse what follows "sound name:". → {spec, parts:[{text, off, key|null, ok, msg}], errors:[{off,msg}], warnings:[{off,msg}]}
// key: one of _SND_ORDER for a part that was understood; parts with errors or unknown words keep their text.
function _sndParse(body){
  body=String(body||'');
  var spec=_sndDefaults(),parts=_sndSplit(body),errors=[],warnings=[],seen={},hasWave=false;
  parts.forEach(function(p,pi){
    p.key=null;p.ok=false;
    if(p.comment){p.key='comment';p.ok=true;return}
    var w=_sndWords(p),k=w[0].w.toLowerCase(),bad=null,at=w[0].off;
    function need(i,what,ex){if(!w[i]){bad=k+' needs '+what+' — '+ex;at=w[w.length-1].off;return null}return w[i]}
    function num(i,what,ex,lo,hi,conv){var t=need(i,what,ex);if(!t)return null;var v=(conv||_sndNum)(t.w);if(v===null||!isFinite(v)){bad=k+' needs '+what+', not "'+t.w+'" — '+ex;at=t.off;return null}if(v<lo||v>hi){bad=k+' must be between '+lo+' and '+hi+' — '+ex;at=t.off;return null}return v}
    function extra(n){if(!bad&&w.length>n){bad='Unexpected "'+w[n].w+'" after '+k+' — write one setting per part, separated by commas';at=w[n].off}}
    var v={};
    if(_SND_WAVES[k]){
      if(pi!==0||hasWave){bad='The waveform comes first, once — sound coin: square 880';}
      else{
        v.wave=k;v.f=440;v.f2=null;
        if(w.length>1){v.f=num(1,'a start pitch in Hz','square 880',1,20000,_sndHz)}
        if(!bad&&w.length>2){
          if(w[2].w!=='>'){bad='Expected > and the end pitch after the start pitch — '+k+' '+w[1].w+' > 1320';at=w[2].off}
          else{v.f2=num(3,'an end pitch in Hz after >',k+' '+w[1].w+' > 1320',1,20000,_sndHz);extra(4)}
        }
        if(!bad){hasWave=true;p.key='wave'}
      }
    }else if(pi===0){bad='A sound starts with its waveform: sine, square, saw, triangle or noise — sound coin: square 880';}
    else if(w.length===1&&_sndTime(k)!==null&&/[a-z]$/.test(k)){v.len=num(0,'a length','90ms',1,60000,_sndTime);if(!bad)p.key='len'}
    else if(k==='len'||k==='length'){v.len=num(1,'a length','len 90ms',1,60000,_sndTime);extra(2);if(!bad)p.key='len'}
    else if(k==='atk'||k==='dec'||k==='rel'){v[k]=num(1,'a time in ms',k+' 20',0,60000,_sndTime);extra(2);if(!bad)p.key=k}
    else if(k==='sus'||k==='vol'){v[k]=num(1,'a number from 0 to 1',k+' 0.5',0,1);extra(2);if(!bad)p.key=k}
    else if(k==='vib'){v.vibD=num(1,'a depth (0 to 1) and a rate in Hz','vib 0.02 6',0,1);if(!bad)v.vibR=num(2,'a depth (0 to 1) and a rate in Hz','vib 0.02 6',0,100,_sndHz);extra(3);if(!bad)p.key='vib'}
    else if(k==='lowpass'||k==='highpass'){v[k]=num(1,'a cutoff in Hz',k+' 2000',0,24000,_sndHz);extra(2);if(!bad)p.key=k}
    else if(k==='arp'){v.arpM=num(1,'a pitch factor and a time','arp 1.5 40ms',0.01,16);if(!bad)v.arpT=num(2,'a pitch factor and a time','arp 1.5 40ms',0,60000,_sndTime);extra(3);if(!bad)p.key='arp'}
    else if(k==='curve'){var c=w[1]&&w[1].w.toLowerCase();if(c==='lin'||c==='linear')v.curve='lin';else if(c==='exp'||c==='exponential')v.curve='exp';else{bad='curve is lin or exp — curve exp';at=w[1]?w[1].off:w[0].off}extra(2);if(!bad)p.key='curve'}
    else{warnings.push({off:p.off,msg:'Unknown part "'+p.text+'" in this sound — ignored (known: '+_SND_ORDER.slice(1).join(', ')+')'});p.msg='unknown';return}
    if(!bad&&p.key&&seen[p.key]){bad=p.key+' is set twice in this sound';at=p.off}
    if(bad){errors.push({off:at,msg:bad});p.key=null;p.msg=bad;return}
    seen[p.key]=true;p.ok=true;p.val=v;
    if(p.key==='wave'){spec.wave=v.wave;spec.f=v.f;spec.f2=v.f2}
    else if(p.key==='vib'){spec.vibD=v.vibD;spec.vibR=v.vibR}
    else if(p.key==='arp'){spec.arpM=v.arpM;spec.arpT=v.arpT}
    else if(p.key==='lowpass')spec.lp=v.lowpass;
    else if(p.key==='highpass')spec.hp=v.highpass;
    else spec[p.key]=v[p.key];
  });
  if(!parts.length||(!hasWave&&!errors.length))errors.push({off:parts.length?parts[0].off:0,msg:'A sound needs a waveform: sine, square, saw, triangle or noise — sound coin: square 880'});
  return{spec:spec,parts:parts,errors:errors,warnings:warnings};
}
// Envelope of one sound: [[ms, level 0..1], …] from the start to the end of the release (levels × vol later).
function _sndEnv(s){
  var len=Math.max(1,s.len),atk=Math.min(Math.max(0,s.atk),len),dec=Math.max(0,s.dec),sus=Math.max(0,Math.min(1,s.sus)),rel=Math.max(0,s.rel);
  var pts=[[0,0],[atk,1]];
  if(dec>0&&sus<1){
    var de=atk+dec;
    if(de<=len)pts.push([de,sus]);
    else pts.push([len,1-(1-sus)*(len-atk)/dec]);
  }else if(sus<1)pts.push([atk,sus]);
  var last=pts[pts.length-1];
  if(last[0]<len)pts.push([len,last[1]]);
  pts.push([len+rel,0]);
  return pts;
}
function _sndEnvAt(pts,t){for(var i=1;i<pts.length;i++){if(t<=pts[i][0]){var a=pts[i-1],b=pts[i],d=b[0]-a[0];return d<=0?b[1]:a[1]+(b[1]-a[1])*(t-a[0])/d}}return 0}
// Pitch (Hz) at time t ms, before vibrato: the sweep from f to f2 over the length, times the arp factor after arpT.
function _sndPitchAt(s,t,pm){
  pm=pm||1;var f=s.f*pm,f2=(s.f2===null||s.f2===undefined?s.f:s.f2)*pm,len=Math.max(1,s.len),x=Math.max(0,Math.min(1,t/len)),v;
  if(f2===f)v=f;else if(s.curve==='exp')v=f*Math.pow(f2/f,x);else v=f+(f2-f)*x;
  if(s.arpM>0&&s.arpT>0&&s.arpT<len&&t>=s.arpT)v*=s.arpM;
  return v;
}
var _sndAC=null,_sndMaster=null,_sndUnlocked=false,_sndDefs={},_musDefs={},_sndResolve=null,_sndLive=[];
function _sndCtx(){
  if(!_sndAC){
    var C=typeof window!=='undefined'&&(window.AudioContext||window.webkitAudioContext);
    if(!C)return null;
    try{_sndAC=new C()}catch(e){return null}
    _sndMaster=_sndAC.createGain();_sndMaster.gain.value=1;_sndMaster.connect(_sndAC.destination);
  }
  return _sndAC;
}
function _sndNoiseBuf(ac){
  if(ac._emitNoise)return ac._emitNoise;
  var n=Math.max(1,Math.floor(ac.sampleRate||44100)),b=ac.createBuffer(1,n,ac.sampleRate||44100),d=b.getChannelData(0),x=0x2545F491;
  for(var i=0;i<n;i++){x^=x<<13;x^=x>>>17;x^=x<<5;d[i]=((x>>>0)/4294967296)*2-1}   // fixed seed: the same noise every time
  ac._emitNoise=b;return b;
}
// THE synth: schedules one sound (a spec from _sndParse) at time `when` (AudioContext seconds) into `dest`.
// pitchMul / volMul scale pitch and volume. Returns {src, gain, end} (end: when the last node stops).
// The editor preview, play() and every note and drum hit of music() go through here.
function _sndVoice(ac,dest,s,when,pitchMul,volMul){
  pitchMul=+pitchMul>0?+pitchMul:1;volMul=+volMul>=0?+volMul:1;
  var t=Math.max(when,ac.currentTime),len=Math.max(1,s.len)/1000,rel=Math.max(0,s.rel)/1000,end=t+len+rel;
  var noise=s.wave==='noise',src,p,scale=noise?1/1000:1;
  if(noise){src=ac.createBufferSource();src.buffer=_sndNoiseBuf(ac);src.loop=true;p=src.playbackRate}
  else{src=ac.createOscillator();src.type=_SND_WAVES[s.wave]||'square';p=src.frequency}
  function P(ms){return Math.max(0.0001,_sndPitchAt(s,ms,pitchMul)*scale)}
  var f2=(s.f2===null||s.f2===undefined)?s.f:s.f2,sweep=f2!==s.f,arp=s.arpM>0&&s.arpT>0&&s.arpT<s.len;
  p.setValueAtTime(P(0),t);
  if(arp){
    var at=t+s.arpT/1000;
    if(sweep){if(s.curve==='exp')p.exponentialRampToValueAtTime(P(s.arpT-0.001),at);else p.linearRampToValueAtTime(P(s.arpT-0.001),at)}
    p.setValueAtTime(P(s.arpT),at);
  }
  if(sweep){if(s.curve==='exp')p.exponentialRampToValueAtTime(P(s.len),t+len);else p.linearRampToValueAtTime(P(s.len),t+len)}
  var node=src,lfo=null;
  if(s.vibD>0&&s.vibR>0){
    lfo=ac.createOscillator();lfo.type='sine';lfo.frequency.setValueAtTime(s.vibR,t);
    var lg=ac.createGain();lg.gain.setValueAtTime(s.vibD*P(0),t);lfo.connect(lg);lg.connect(p);
  }
  if(s.lp>0){var lp=ac.createBiquadFilter();lp.type='lowpass';lp.frequency.setValueAtTime(s.lp,t);node.connect(lp);node=lp}
  if(s.hp>0){var hp=ac.createBiquadFilter();hp.type='highpass';hp.frequency.setValueAtTime(s.hp,t);node.connect(hp);node=hp}
  var g=ac.createGain(),peak=Math.max(0,Math.min(1,s.vol))*volMul,env=_sndEnv(s);
  g.gain.setValueAtTime(0,t);
  for(var i=1;i<env.length;i++)g.gain.linearRampToValueAtTime(env[i][1]*peak,t+env[i][0]/1000);
  node.connect(g);g.connect(dest);
  src.start(t);src.stop(end+0.02);
  if(lfo){lfo.start(t);lfo.stop(end+0.02)}
  return{src:src,gain:g,lfo:lfo,end:end+0.02};
}
// The first gesture: create / resume the AudioContext, start a music() that was asked for earlier.
// The context is created on a gesture only when something may sound (a program with sound / music blocks, a
// tool that previews, a music() waiting): a page that never plays anything never creates one.
var _sndWant=false;
function _sndUnlock(){
  _sndUnlocked=true;
  var k;for(k in _sndDefs)break;if(!k)for(k in _musDefs)break;
  if(!(_sndAC||_sndWant||_musPending||k))return;
  var ac=_sndCtx();if(!ac)return;
  if(ac.state==='suspended'){try{var r=ac.resume();if(r&&r.catch)r.catch(function(){})}catch(e){}}
  if(_musPending){var n=_musPending;_musPending=null;_musicPlay(n)}
}
function _sndReady(){
  if(!_sndUnlocked){var ac=_sndAC;if(!(ac&&ac.state==='running'))return null}
  var c=_sndCtx();
  if(c&&c.state==='suspended'){try{var r=c.resume();if(r&&r.catch)r.catch(function(){})}catch(e){}}
  return c;
}
if(typeof window!=='undefined'&&window.addEventListener)['pointerdown','touchend','keydown','click'].forEach(function(n){window.addEventListener(n,_sndUnlock,true)});
function _sndFind(kind,name){
  name=String(name);
  var d=kind==='sound'?_sndDefs:_musDefs;
  if(Object.prototype.hasOwnProperty.call(d,name))return d[name];
  var lk=name.toLowerCase();for(var dn in d)if(Object.prototype.hasOwnProperty.call(d,dn)&&dn.toLowerCase()===lk)return d[dn];
  if(typeof _sndResolve==='function'){try{return _sndResolve(kind,name)}catch(e){}}
  return null;
}
// Plays the sound block `name` (pitchMul: 2 = an octave up; volMul: 0..1 and more). Before the first user
// gesture, or if there is no such sound, nothing happens.
function _sndPlay(name,pitchMul,volMul){
  var s=_sndFind('sound',name);if(!s)return false;
  var ac=_sndReady();if(!ac)return false;
  var now=ac.currentTime;
  if(_sndLive.length>32)_sndLive=_sndLive.filter(function(e){return e>now});
  if(_sndLive.length>32)return false;   // a burst of sounds (play() in a loop): drop the rest instead of distorting
  try{_sndLive.push(_sndVoice(ac,_sndMaster,s,now+0.005,pitchMul,volMul).end);return true}catch(e){return false}
}
// ── music ──
var _MUS_NOTE={C:0,D:2,E:4,F:5,G:7,A:9,B:11},_MUS_NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
var _MUS_DRUMS='KSHC';
function _musMidi(tok){var m=/^([A-G])(#|b)?(\d)$/.exec(tok);if(!m)return null;return(+m[3]+1)*12+_MUS_NOTE[m[1]]+(m[2]==='#'?1:m[2]==='b'?-1:0)}
function _musName(midi){return _MUS_NAMES[midi%12]+(Math.floor(midi/12)-1)}
function _musHz(midi){return 440*Math.pow(2,(midi-69)/12)}
// Parse what follows "music name:". → {spec:{bpm,steps,swing,tracks:[{name,wave,drums,vol,mute,cells}]}, head:[parts],
// lines:[{text, off, track (index) | -1, ok, msg}], errors, warnings}. cells: melodic null | '-' | [midi…]; drums '' | 'KH'.
function _musParse(body){
  body=String(body||'');
  var nl=body.indexOf('\n'),headText=nl<0?body:body.substring(0,nl),errors=[],warnings=[],lines=[];
  var spec={bpm:120,steps:16,swing:0,tracks:[]},head=_sndSplit(headText),seen={};
  head.forEach(function(p){
    p.key=null;p.ok=false;
    if(p.comment){p.key='comment';p.ok=true;return}
    var w=_sndWords(p),bad=null,at=p.off,a=w[0].w.toLowerCase(),b=w[1]&&w[1].w.toLowerCase();
    if(b==='bpm'||b==='steps'){
      var v=_sndNum(w[0].w);
      if(b==='bpm'&&(v===null||v<20||v>400))bad='bpm is a number from 20 to 400 — 120 bpm';
      else if(b==='steps'&&(v===null||v!==Math.floor(v)||v<1||v>256))bad='steps is a whole number from 1 to 256 — 16 steps';
      else if(w.length>2){bad='Unexpected "'+w[2].w+'" — separate the settings with commas: 120 bpm, 16 steps';at=w[2].off}
      else{p.key=b;spec[b]=v}
    }else if(a==='swing'){
      var sv=w[1]?_sndNum(w[1].w):null;
      if(sv===null||sv<0||sv>0.9){bad='swing is a number from 0 to 0.9 — swing 0.2';at=w[1]?w[1].off:p.off}
      else if(w.length>2){bad='Unexpected "'+w[2].w+'" after swing';at=w[2].off}
      else{p.key='swing';spec.swing=sv}
    }else{warnings.push({off:p.off,msg:'Unknown part "'+p.text+'" in this music — ignored (known: 120 bpm, 16 steps, swing 0.2)'});p.msg='unknown';return}
    if(!bad&&seen[p.key]){bad=p.key+' is set twice';at=p.off}
    if(bad){errors.push({off:at,msg:bad});p.key=null;p.msg=bad;return}
    seen[p.key]=true;p.ok=true;
  });
  var names={},pending=[];
  if(nl>=0){
    var off=nl+1;
    body.substring(nl+1).split('\n').forEach(function(raw){
      var lead=raw.length-raw.replace(/^\s+/,'').length,text=raw.trim(),L={text:text,off:off+lead,track:-1,ok:false};
      off+=raw.length+1;
      if(!text)return;
      lines.push(L);
      if(text.indexOf('//')===0){L.ok=true;L.comment=true;return}
      var c=text.indexOf(':'),bad=null,at=L.off;
      var m=c>0&&/^([A-Za-z_][A-Za-z0-9_]*)((?:\s+[^\s:]+)*)\s*$/.exec(text.substring(0,c));
      if(!m){errors.push({off:L.off,msg:'A track line is: name waveform: steps — lead square: C5 . E5 .'});L.msg='not a track line';return}
      var tr={name:m[1],wave:null,drums:false,vol:1,mute:false,cells:[]},opts=_sndWords({text:m[2],off:L.off+m[1].length});
      for(var i=0;i<opts.length&&!bad;i++){
        var o=opts[i].w.toLowerCase();
        if(_SND_WAVES[o]&&!tr.wave&&!tr.drums)tr.wave=o;
        else if(o==='drums'&&!tr.wave&&!tr.drums)tr.drums=true;
        else if(o==='vol'){var vv=opts[i+1]?_sndNum(opts[i+1].w):null;if(vv===null||vv<0||vv>1){bad='vol is a number from 0 to 1 — '+tr.name+' square vol 0.6:';at=opts[i+1]?opts[i+1].off:opts[i].off}else{tr.vol=vv;i++}}
        else if(o==='mute')tr.mute=true;
        else{bad='Unknown "'+opts[i].w+'" in track '+tr.name+' — name, waveform (sine square saw triangle noise or drums), vol 0.6, mute';at=opts[i].off}
      }
      if(!bad&&!tr.wave&&!tr.drums){if(tr.name.toLowerCase()==='drums')tr.drums=true;else{bad='Track '+tr.name+' needs a waveform (sine square saw triangle noise) or drums — '+tr.name+' square: C5 . E5 .';at=L.off}}
      if(!bad&&names[tr.name]){bad='There are two tracks named '+tr.name+' in this music';at=L.off}
      if(!bad&&names[' '+tr.name.toLowerCase()]){bad='Tracks '+names[' '+tr.name.toLowerCase()]+' and '+tr.name+' differ only by case — names are case-insensitive: rename one of them';at=L.off}
      var st=_sndWords({text:text.substring(c+1),off:L.off+c+1});
      for(var j=0;j<st.length&&!bad;j++){
        var t=st[j].w;
        if(t==='|')continue;
        if(tr.cells.length>=256){bad='Too many steps';at=st[j].off;break}
        if(t==='.'){tr.cells.push(tr.drums?'':null);continue}
        if(t==='-'){var pv=tr.cells[tr.cells.length-1];tr.cells.push(!tr.drums&&(Array.isArray(pv)||pv==='-')?'-':tr.drums?'':null);continue}
        if(tr.drums){
          if(!/^[KSHC]+$/.test(t)){bad='"'+t+'" is not a drum hit — K kick, S snare, H hat, C clap (KH = two at once), . rest';at=st[j].off;break}
          tr.cells.push(_MUS_DRUMS.split('').filter(function(x){return t.indexOf(x)>=0}).join(''));
        }else{
          var ch=t.split('+'),ms=[];
          for(var q=0;q<ch.length;q++){var md=_musMidi(ch[q]);if(md===null||md<12||md>119){bad='"'+t+'" is not a note — C5, F#3, Bb2, a chord C4+E4+G4, . rest, - hold';break}if(ms.indexOf(md)<0)ms.push(md)}
          if(bad){at=st[j].off;break}
          tr.cells.push(ms);
        }
      }
      if(bad){errors.push({off:at,msg:bad});L.msg=bad;return}
      names[tr.name]=true;names[' '+tr.name.toLowerCase()]=tr.name;L.ok=true;L.track=spec.tracks.length;L.stepsOff=st.length?st[st.length-1].off:L.off;
      spec.tracks.push(tr);pending.push({tr:tr,steps:st});
    });
  }
  pending.forEach(function(x){
    var tr=x.tr;
    if(tr.cells.length>spec.steps){var real=x.steps.filter(function(s){return s.w!=='|'});errors.push({off:real[spec.steps].off,msg:'Track '+tr.name+' has '+tr.cells.length+' steps, the music has '+spec.steps+' — remove steps or write '+tr.cells.length+' steps in the first line'});lines.forEach(function(L){if(L.track===spec.tracks.indexOf(tr)){L.ok=false;L.msg='too many steps'}})}
    while(tr.cells.length<spec.steps)tr.cells.push(tr.drums?'':null);
    tr.cells.length=spec.steps;
  });
  errors.sort(function(a,b){return a.off-b.off});
  if(!spec.tracks.length&&!errors.length)warnings.push({off:0,msg:'This music has no tracks yet — add lines like:   lead square: C5 . E5 . G5 - - .'});
  return{spec:spec,head:head,lines:lines,errors:errors,warnings:warnings};
}
// Length in steps of the note / chord that starts at step i
function _musLen(cells,i){var n=1;while(i+n<cells.length&&cells[i+n]==='-')n++;return n}
var _MUS_KIT={
  K:{wave:'sine',f:150,f2:42,curve:'exp',len:110,atk:1,dec:100,sus:0,rel:40,vol:0.95,vibD:0,vibR:0,lp:0,hp:0,arpM:0,arpT:0},
  S:{wave:'noise',f:1000,f2:null,curve:'lin',len:70,atk:1,dec:70,sus:0.15,rel:90,vol:0.55,vibD:0,vibR:0,lp:0,hp:1300,arpM:0,arpT:0},
  H:{wave:'noise',f:1000,f2:null,curve:'lin',len:18,atk:1,dec:18,sus:0,rel:30,vol:0.3,vibD:0,vibR:0,lp:0,hp:7500,arpM:0,arpT:0},
  C:{wave:'noise',f:1000,f2:null,curve:'lin',len:12,atk:1,dec:10,sus:0.4,rel:110,vol:0.6,vibD:0,vibR:0,lp:2600,hp:900,arpM:0,arpT:0}
};
// The instrument of a melodic track: one note of `steps` steps
function _musNoteSpec(tr,midi,steps,stepSec){
  var len=Math.max(20,steps*stepSec*1000-12);
  return{wave:tr.wave||'square',f:_musHz(midi),f2:null,curve:'lin',len:len,atk:4,dec:90,sus:0.65,rel:Math.min(120,len*0.5),vol:0.3,vibD:0,vibR:0,lp:0,hp:0,arpM:0,arpT:0};
}
// Plays a song (spec of _musParse) with lookahead scheduling on the AudioContext clock: every 25 ms the steps
// that start in the next 120 ms are scheduled. The song object is read live, so edits are heard on the next
// pass. opts: {loop, dest, onEnd()}. → {stop(), stepAt(time) → step index playing at AudioContext time (-1),
// playing, ctx}.
function _musStart(ac,song,opts){
  opts=opts||{};
  var dest=opts.dest||_sndMaster||ac.destination,bus=ac.createGain();bus.gain.value=1;bus.connect(dest);
  var next=ac.currentTime+0.06,cur=0,hist=[],voices=[],timer=null,ended=false,ctl;
  function stepSec(){return 60/Math.max(20,Math.min(400,+song.bpm||120))/4}
  function sched(i,t){
    var sw=(i%2===1)?(+song.swing||0)*stepSec():0,at=t+sw;
    song.tracks.forEach(function(tr){
      if(tr.mute)return;var c=tr.cells[i],v=tr.vol===undefined?1:tr.vol;
      if(tr.drums){if(c)for(var k=0;k<c.length;k++){var d=_MUS_KIT[c[k]];if(d)voices.push(_sndVoice(ac,bus,d,at,1,v))}}
      else if(Array.isArray(c)){var L=_musLen(tr.cells,i);for(var q=0;q<c.length;q++)voices.push(_sndVoice(ac,bus,_musNoteSpec(tr,c[q],L,stepSec()),at,1,v))}
    });
  }
  function tick(){
    if(ended)return;
    var now=ac.currentTime;
    if(voices.length>64)voices=voices.filter(function(x){return x.end>now});
    while(next<now+0.12){
      var steps=Math.max(1,song.steps|0);
      if(cur>=steps){
        if(opts.loop)cur=0;
        else{ended=true;clearInterval(timer);ctl.playing=false;var wait=Math.max(0,(next-now)*1000+150);setTimeout(function(){if(opts.onEnd)opts.onEnd()},wait);return}
      }
      sched(cur,next);hist.push([next,cur]);if(hist.length>80)hist.shift();
      next+=stepSec();cur++;
    }
  }
  ctl={ctx:ac,playing:true,
    stop:function(){
      if(!ended){ended=true;clearInterval(timer)}ctl.playing=false;
      var now=ac.currentTime;
      try{bus.gain.cancelScheduledValues(now);bus.gain.setValueAtTime(bus.gain.value,now);bus.gain.linearRampToValueAtTime(0,now+0.03)}catch(e){}
      voices.forEach(function(x){try{x.src.stop(now+0.04)}catch(e){}try{if(x.lfo)x.lfo.stop(now+0.04)}catch(e){}});voices=[];
      setTimeout(function(){try{bus.disconnect()}catch(e){}},100);
    },
    stepAt:function(t){if(!ctl.playing&&!hist.length)return -1;var r=-1;for(var i=0;i<hist.length;i++){if(hist[i][0]<=t)r=hist[i][1];else break}return r}};
  timer=setInterval(tick,25);tick();
  return ctl;
}
var _musCur=null,_musCurName=null,_musPending=null;
// music(name): loops the music block `name` until stopMusic() (or another music()).
function _musicPlay(name){
  name=String(name);
  if((_musPending===name)||(_musCurName===name&&_musCur&&_musCur.playing))return true;   // already playing: keeps playing (music() in frame() is fine)
  var song=_sndFind('music',name);
  _musicStop();
  if(!song)return false;
  var ac=_sndReady();
  if(!ac){_musPending=String(name);return true}
  _musCur=_musStart(ac,song,{loop:true});_musCurName=String(name);
  return true;
}
function _musicStop(){_musPending=null;if(_musCur){try{_musCur.stop()}catch(e){}}_musCur=null;_musCurName=null}
function _musicPlaying(){return!!(_musPending||(_musCur&&_musCur.playing))}
// The blocks of the program being started (imports.soundMeta from the compiler)
function _sndSetup(imports){
  _musicStop();_sndDefs={};_musDefs={};
  var m=null;try{if(imports&&typeof imports.soundMeta==='string')m=JSON.parse(imports.soundMeta)}catch(e){m=null}
  if(!m)return;
  Object.keys(m.sounds||{}).forEach(function(n){_sndDefs[n]=_sndParse(m.sounds[n]).spec});
  Object.keys(m.music||{}).forEach(function(n){_musDefs[n]=_musParse(m.music[n]).spec});
}
buildImportObject=(function(build){return function(imports,outputLog){
  _sndSetup(imports);
  var obj=build.apply(this,arguments);
  if(obj.std){
    if(obj.std.play)obj.std.play=function(name,pitch,vol){_sndPlay(_readStr(Number(name)),Number(pitch),Number(vol))};
    if(obj.std.music)obj.std.music=function(name){_musicPlay(_readStr(Number(name)))};
    if(obj.std.stopMusic)obj.std.stopMusic=function(){_musicStop()};
    if(obj.std.musicPlaying)obj.std.musicPlaying=function(){return _musicPlaying()?1:0};
  }
  return obj;
}})(buildImportObject);
if(typeof window!=='undefined'){
  window._sndPlay=_sndPlay;window._musicPlay=_musicPlay;window._musicStop=_musicStop;window._musicPlaying=_musicPlaying;
}

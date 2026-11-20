// ═══ HUD & PARTICLES ═══ (compiler half; the runtime half is "HUD & PARTICLES" in the runtime block, the
// editor half is drawer/hudfx.js: the HUD and PARTICLES tools)
//
//   hud main:                                           a HUD: text, icons and bars drawn on top of the game,
//     text  "Score: {score}"  top left                  in screen space, after every frame (the first hud block
//     icons heart lives  top right                      of the project is on at the start; hud("name") switches)
//     bar   health 0..100  bottom left  width 60 color #38b764
//     text  "{message}"  center  size 2
//
//   particles sparkle:                                  a particle effect: burst("sparkle", x, y) once,
//     count 12  life 0.4..0.8  speed 40..90  angle 0..360     emitter("smoke", x, y) for a stream
//     gravity 0  size 2..1  colors #ffcd75 #f4f4f4  fade
//
// Both are blocks (BLOCKS, compiler/sound.js): raw text tokens that the parseTop wrapper below checks with
// _hudParse / _fxParse (also used by the tools) into HudDecl / FxDecl nodes. The linker wrapper takes them out
// of the program, checks hud(…) / burst(…) / emitter(…) names (bare or "string", case-insensitive, like play)
// and the names a HUD shows: {name} and the counts / values of icons and bars are global variables (of the
// HUD's own file first, then of any file; rules auto-globals count), icons draw a sprite block. compile() hands
// both to the runtime as imports.hudMeta / imports.fxMeta (JSON); a HUD reads its variables straight from the
// WASM globals (exported as __g<index>, see wasm-rewrite.js), so nothing is added to the program's code.
// A program without these blocks and builtins compiles exactly as before (same bytes, no meta).
_EMIT_BLOCK_KINDS.hud=1;_EMIT_BLOCK_KINDS.particles=1;
_EMIT_RAW_KINDS.hud=1;_EMIT_RAW_KINDS.particles=1;
var _HUD_KINDS=['text','icons','bar'];
var _HUD_WORDS={top:'v',middle:'v',bottom:'v',left:'h',center:'h',centre:'h',right:'h'};
var _HUD_OPTS=['top','middle','bottom','left','center','right','below','size','color','width','height'];
var _FX_PROPS=['count','life','speed','angle','spread','dir','gravity','drag','size','colors','color','fade','shape','loop','rate','area'];
var _FX_MAX=2000;   // live particles at most (the runtime drops new ones past it)
// ── a small tokenizer for block lines: words, numbers, ranges a..b, #hex, "strings" (offsets into s) ──
// → [{t:'w'|'n'|'r'|'h'|'s'|'x', v, off, end, a, b (range), raw (string body), rawOff}]; // comments end a line.
function _hfxToks(s,from,to){
  var out=[],i=from;
  while(i<to){
    var c=s[i];
    if(c===' '||c==='\t'||c==='\r'||c===','){i++;continue}
    if(c==='/'&&s[i+1]==='/')break;
    var st=i;
    if(c==='"'){
      i++;var body='';
      while(i<to&&s[i]!=='"'){if(s[i]==='\\'&&i+1<to){i+=2;continue}i++}
      var closed=i<to;
      out.push({t:'s',off:st,end:closed?i+1:i,raw:s.substring(st+1,i),rawOff:st+1,closed:closed});
      if(closed)i++;
      continue;
    }
    if(c==='#'){i++;while(i<to&&/[0-9A-Za-z]/.test(s[i]))i++;out.push({t:'h',v:s.substring(st,i),off:st,end:i});continue}
    if(/[\d.]/.test(c)||(c==='-'&&/[\d.]/.test(s[i+1]||''))){
      var NUM='-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)',rest=s.substring(i,to);
      var rm=new RegExp('^('+NUM+')\\.\\.('+NUM+'|[A-Za-z_]\\w*)').exec(rest);
      if(rm){var bn=/^[A-Za-z_]/.test(rm[2]);out.push({t:'r',a:Number(rm[1]),b:bn?rm[2]:Number(rm[2]),v:rm[0],off:st,end:st+rm[0].length,bOff:st+rm[0].length-rm[2].length});i=st+rm[0].length;continue}
      var nm=new RegExp('^'+NUM).exec(rest);
      if(nm){out.push({t:'n',v:nm[0],n:Number(nm[0]),off:st,end:st+nm[0].length});i=st+nm[0].length;continue}
    }
    if(/[A-Za-z_]/.test(c)){
      i++;while(i<to&&/\w/.test(s[i]))i++;
      /* name..name or name..number: a range of variables (bars) */
      if(s[i]==='.'&&s[i+1]==='.'){
        var r2=/^\.\.([A-Za-z_]\w*|-?\d+(?:\.\d+)?)/.exec(s.substring(i,to));
        if(r2){var lo=s.substring(st,i);i+=r2[0].length;out.push({t:'r',a:lo,b:/^[A-Za-z_]/.test(r2[1])?r2[1]:Number(r2[1]),v:s.substring(st,i),off:st,end:i,bOff:i-r2[1].length});continue}
      }
      out.push({t:'w',v:s.substring(st,i),off:st,end:i});continue;
    }
    i++;while(i<to&&!/[\s,"#]/.test(s[i]))i++;
    out.push({t:'x',v:s.substring(st,i),off:st,end:i});
  }
  return out;
}
function _hfxHex(v){
  var m=/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(v);if(!m)return null;
  var h=m[1].toLowerCase();if(h.length===3)h=h.replace(/./g,'$&$&');
  return'#'+h;
}
function _hfxNum(n){n=Number(n);return String(Math.round(n*1000)/1000)}
// ── HUD block → {spec:{items:[…]}, errors:[{off,msg}], warnings:[]} ──
// item: {kind:'text'|'icons'|'bar', parts:[str|{name,off}] (text), sprite:{name,off} (icons), count:ref (icons),
//   value:ref, min:ref, max:ref (bar), v:'top'|'middle'|'bottom', h:'left'|'center'|'right', below, size, color,
//   width, height, off (start of the line)}; ref = {num} or {name, off}
function _hudParse(text){
  var s=String(text==null?'':text),errors=[],warnings=[],items=[];
  function err(off,msg){errors.push({off:off,msg:msg})}
  var p=0;
  while(p<=s.length&&!errors.length){
    var e=s.indexOf('\n',p);if(e<0)e=s.length;
    var T=_hfxToks(s,p,e);
    if(T.length)line(T,p);
    p=e+1;
  }
  function ref(t,what){
    if(t.t==='n')return{num:t.n};
    if(t.t==='w'&&!/^(true|false)$/i.test(t.v))return{name:t.v,off:t.off};
    err(t.off,'Expected '+what+', not "'+(t.v||'"')+'"');return null;
  }
  function line(T,lineOff){
    var k=T[0],kind=k.t==='w'?k.v.toLowerCase():'';
    if(_HUD_KINDS.indexOf(kind)<0){
      var c=k.t==='w'?_emitModClosest(k.v,_HUD_KINDS):null;
      return err(k.off,(k.t==='s'?'A HUD line starts with what to draw: text "'+k.raw+'" top left':'Unknown HUD item "'+(k.v||k.raw)+'"'+(c?' — did you mean '+c+'?':' — a line is text "…", icons SPRITE COUNT or bar VALUE MIN..MAX')));
    }
    var it={kind:kind,v:null,h:null,below:false,size:1,color:null,off:k.off},i=1;
    if(kind==='text'){
      var st=T[i];
      if(!st||st.t!=='s')return err(st?st.off:k.end,'text needs the words to show in quotes — text "Score: {score}" top left');
      if(!st.closed)return err(st.off,'This text has no closing " — text "Score: {score}"');
      it.parts=_hudParts(st.raw,st.rawOff,err);if(errors.length)return;
      i++;
    }else if(kind==='icons'){
      var sp=T[i];
      if(!sp||sp.t!=='w')return err(sp?sp.off:k.end,'icons needs a sprite and how many — icons heart lives');
      it.sprite={name:sp.v,off:sp.off};i++;
      var ct=T[i];
      if(!ct||(ct.t!=='w'&&ct.t!=='n')||_HUD_WORDS[ct.v&&ct.v.toLowerCase()]||_HUD_OPTS.indexOf(String(ct.v).toLowerCase())>=0)return err(ct?ct.off:sp.end,'icons needs how many after the sprite: a variable or a number — icons '+sp.v+' lives');
      it.count=ref(ct,'how many');if(!it.count)return;i++;
    }else{
      var vt=T[i];
      if(!vt||vt.t!=='w'||_HUD_WORDS[vt.v.toLowerCase()]||_HUD_OPTS.indexOf(vt.v.toLowerCase())>=0)return err(vt?vt.off:k.end,'bar needs a variable and its range — bar health 0..100');
      it.value={name:vt.v,off:vt.off};i++;
      var rt=T[i];
      if(rt&&rt.t==='r'){
        it.min=typeof rt.a==='number'?{num:rt.a}:{name:rt.a,off:rt.off};
        it.max=typeof rt.b==='number'?{num:rt.b}:{name:rt.b,off:rt.bOff};
        if(typeof rt.a!=='number'&&/^(true|false)$/i.test(rt.a))return err(rt.off,'Expected a number or a variable');
        i++;
      }else if(rt&&rt.t==='n'){it.min={num:0};it.max={num:rt.n};i++}
      else return err(rt?rt.off:vt.end,'bar needs the range of '+vt.v+': MIN..MAX — bar '+vt.v+' 0..100');
      if(it.min.num!==undefined&&it.max.num!==undefined&&it.min.num===it.max.num)return err(rt.off,'The range of a bar needs two different ends — 0..100');
      it.width=50;it.height=null;
    }
    var seen={};
    for(;i<T.length;i++){
      var t=T[i],w=t.t==='w'?t.v.toLowerCase():'';
      if(w==='centre')w='center';
      if(_HUD_WORDS[w]){
        var axis=_HUD_WORDS[w];
        if(w==='center'&&it.h&&!it.v){it.v='middle';continue}
        if(axis==='v'){if(it.v)return err(t.off,'This item already has a place up/down ('+it.v+') — one of top, middle, bottom');it.v=w}
        else{if(it.h)return err(t.off,'This item already has a place left/right ('+it.h+') — one of left, center, right');it.h=w}
        continue;
      }
      if(w==='below'){it.below=true;continue}
      if(w==='size'||w==='width'||w==='height'){
        if(seen[w])return err(t.off,w+' is set twice');seen[w]=1;
        var n=T[i+1];
        if(!n||n.t!=='n'||!(n.n>0)||Math.floor(n.n)!==n.n)return err(n?n.off:t.end,w+' needs a whole number'+(w==='size'?' (1 is the normal size, 2 twice as big) — size 2':' of pixels — '+w+' 60'));
        if(w==='size'&&n.n>8)return err(n.off,'size is 1 to 8 — size 2');
        if(w!=='size'&&kind!=='bar')return err(t.off,w+' is for bars — use size for '+kind);
        it[w]=n.n;i++;continue;
      }
      if(w==='color'||w==='colour'){
        if(seen.color)return err(t.off,'color is set twice');seen.color=1;
        var h=T[i+1],hx=h&&h.t==='h'?_hfxHex(h.v):null;
        if(!hx)return err(h?h.off:t.end,'color needs a colour like #ffcd75');
        it.color=hx;i++;continue;
      }
      if(t.t==='h')return err(t.off,'Write color before a colour — color '+t.v);
      var c2=t.t==='w'?_emitModClosest(w,_HUD_OPTS):null;
      return err(t.off,'Unknown word "'+(t.v||t.raw||'"')+'" in this HUD line'+(c2?' — did you mean '+c2+'?':' — a place (top, middle, bottom, left, center, right, below), size N or color #hex'+(kind==='bar'?', width N, height N':'')));
    }
    if(!it.v&&!it.h){it.v='top';it.h='left'}
    else{if(!it.v)it.v='middle';if(!it.h)it.h='center'}
    items.push(it);
  }
  if(!errors.length&&!items.length)warnings.push({off:0,msg:'This HUD has nothing to show yet — add lines like:   text "Score: {score}" top left'});
  return{spec:{items:items},errors:errors,warnings:warnings};
}
// "Score: {score}" → ['Score: ', {name:'score', off}]; {{ and }} are { and }; \" \\ \n escapes
function _hudParts(raw,off0,err){
  var parts=[],cur='',i=0;
  while(i<raw.length){
    var c=raw[i];
    if(c==='\\'&&i+1<raw.length){var n=raw[i+1];cur+=n==='n'?' ':n;i+=2;continue}
    if(c==='{'&&raw[i+1]==='{'){cur+='{';i+=2;continue}
    if(c==='}'&&raw[i+1]==='}'){cur+='}';i+=2;continue}
    if(c==='{'){
      var e=raw.indexOf('}',i);
      if(e<0){err(off0+i,'{ without } — write {score} to show a variable, {{ for a {');return parts}
      var nm=raw.substring(i+1,e),tn=nm.trim(),at=off0+i+1+(nm.length-nm.replace(/^\s+/,'').length);
      if(!/^[A-Za-z_]\w*$/.test(tn)){err(at,/^[A-Za-z_]\w*\.\w+$/.test(tn)?'{'+tn+'}: a HUD shows global variables — copy it into one in the rules (every frame: set '+tn.split('.').pop()+' '+tn+') and show {'+tn.split('.').pop()+'}':'{'+nm+'} is not a variable name — {score}');return parts}
      if(cur)parts.push(cur);cur='';
      parts.push({name:tn,off:at});
      i=e+1;continue;
    }
    if(c==='}'){err(off0+i,'} without { — write }} for a }');return parts}
    cur+=c;i++;
  }
  if(cur)parts.push(cur);
  return parts;
}
// The text of a HUD block (the HUD tool writes this; the parser reads it back)
function _hudItemText(it){
  function r(x){return!x?'0':x.num!==undefined?_hfxNum(x.num):x.name}
  var s;
  if(it.kind==='text')s='text  "'+(it.parts||[]).map(function(p){return typeof p==='string'?p.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\{/g,'{{').replace(/\}/g,'}}'):'{'+p.name+'}'}).join('')+'"';
  else if(it.kind==='icons')s='icons '+(it.sprite?it.sprite.name:'heart')+' '+r(it.count);
  else s='bar   '+(it.value?it.value.name:'health')+' '+r(it.min)+'..'+r(it.max);
  var v=it.v||'top',h=it.h||'left';
  s+='  '+(v==='middle'&&h==='center'?'center':v==='middle'?h:h==='center'?v:v+' '+h);
  if(it.below)s+=' below';
  if(it.kind==='bar'){if(it.width&&it.width!==50)s+='  width '+it.width;if(it.height)s+='  height '+it.height}
  if(it.size&&it.size!==1)s+='  size '+it.size;
  if(it.color)s+='  color '+it.color;
  return s;
}
function _hudWrite(name,spec){return'hud '+name+':\n'+(spec.items||[]).map(function(it){return'  '+_hudItemText(it)}).join('\n')}
// ── particles block → {spec, errors, warnings} ──
var _FX_DEFAULT={count:10,life:[0.5,1],speed:[30,80],angle:[0,360],gravity:0,drag:0,size:[2,2],colors:['#ffffff'],fade:false,shape:'square',loop:false,rate:20,area:[0,0]};
function _fxDefaults(){return JSON.parse(JSON.stringify(_FX_DEFAULT))}
function _fxParse(text){
  var s=String(text==null?'':text),errors=[],warnings=[],sp=_fxDefaults(),seen={},T=[],p=0,spread=null,dir=null;
  function err(off,msg){if(!errors.length)errors.push({off:off,msg:msg})}
  while(p<=s.length){var e=s.indexOf('\n',p);if(e<0)e=s.length;T=T.concat(_hfxToks(s,p,e));p=e+1}
  var RNG={life:[0.01,30,'seconds'],speed:[0,2000,'pixels per second'],angle:[-720,720,'degrees'],size:[0,64,'pixels']};
  for(var i=0;i<T.length&&!errors.length;i++){
    var t=T[i],w=t.t==='w'?t.v.toLowerCase():'';
    if(w==='colour')w='color';if(w==='colours')w='colors';
    if(_FX_PROPS.indexOf(w)<0){
      var c=t.t==='w'?_emitModClosest(w,_FX_PROPS):null;
      err(t.off,(t.t==='w'?'Unknown setting "'+t.v+'"':'"'+(t.v||t.raw)+'" needs a setting in front of it')+(c?' — did you mean '+c+'?':' — the settings are '+_FX_PROPS.join(', ')));break;
    }
    var key=w==='color'?'colors':w;
    if(seen[key]&&key!=='fade'&&key!=='loop'){err(t.off,w+' is set twice in this effect');break}
    seen[key]=1;
    var n=T[i+1];
    switch(w){
      case'fade':sp.fade=true;break;
      case'loop':sp.loop=true;break;
      case'shape':{var v=n&&n.t==='w'?n.v.toLowerCase():'';if(v!=='square'&&v!=='circle'){err(n?n.off:t.end,'shape is square or circle — shape circle');break}sp.shape=v;i++;break}
      case'colors':case'color':{
        var cs=[];
        while(T[i+1]&&T[i+1].t==='h'){var hx=_hfxHex(T[i+1].v);if(!hx){err(T[i+1].off,'"'+T[i+1].v+'" is not a colour — #ffcd75 or #fc7');break}cs.push(hx);i++}
        if(!errors.length&&!cs.length)err(n?n.off:t.end,w+' needs one or more colours — colors #ffcd75 #f4f4f4');
        sp.colors=cs;break;
      }
      case'count':case'rate':case'gravity':case'drag':case'spread':case'dir':{
        if(!n||n.t!=='n'){err(n?n.off:t.end,w+' needs a number — '+w+' '+({count:12,rate:20,gravity:120,drag:2,spread:60,dir:90})[w]);break}
        var x=n.n;
        if(w==='count'&&(x<1||x>500||Math.floor(x)!==x)){err(n.off,'count is a whole number from 1 to 500 — count 12');break}
        if(w==='rate'&&!(x>0&&x<=1000)){err(n.off,'rate is from 0.1 to 1000 particles per second — rate 20');break}
        if(w==='drag'&&!(x>=0&&x<=20)){err(n.off,'drag is from 0 (none) to 20 — drag 2');break}
        if(w==='gravity'&&Math.abs(x)>5000){err(n.off,'gravity is from -5000 to 5000 pixels per second² — gravity 120');break}
        if(w==='spread'&&!(x>=0&&x<=360)){err(n.off,'spread is 0 to 360 degrees — spread 60');break}
        if(w==='spread')spread=x;else if(w==='dir')dir=x;else sp[w]=x;
        i++;break;
      }
      case'area':{
        var a=T[i+1],b=T[i+2];
        if(!a||a.t!=='n'||!b||b.t!=='n'||a.n<0||b.n<0){err(a?a.off:t.end,'area needs a width and a height in pixels (where the particles start, around the point) — area 320 0');break}
        sp.area=[a.n,b.n];i+=2;break;
      }
      default:{   /* life speed angle size: a number or a range a..b */
        var R=RNG[w];
        if(!n||(n.t!=='n'&&n.t!=='r')||(n.t==='r'&&(typeof n.a!=='number'||typeof n.b!=='number'))){err(n?n.off:t.end,w+' needs a number or a range — '+w+' '+({life:'0.4..0.8',speed:'40..90',angle:'0..360',size:'2..1'})[w]);break}
        var lo=n.t==='n'?n.n:n.a,hi=n.t==='n'?n.n:n.b;
        if(lo<R[0]||hi<R[0]||lo>R[1]||hi>R[1]){err(n.off,w+' is from '+R[0]+' to '+R[1]+' '+R[2]);break}
        sp[w]=[lo,hi];i++;
      }
    }
  }
  if(!errors.length&&(spread!==null||dir!==null)){
    if(seen.angle){var at=T.filter(function(t){return t.t==='w'&&/^(spread|dir)$/i.test(t.v)})[0];err(at?at.off:0,'Use angle a..b, or dir and spread — not both')}
    else{var d=dir===null?90:dir,h=(spread===null?60:spread)/2;sp.angle=[d-h,d+h]}
  }
  if(!errors.length&&!T.length)warnings.push({off:0,msg:'This effect has no settings yet — it uses the defaults (count 10  life 0.5..1  speed 30..80  angle 0..360)'});
  return{spec:sp,errors:errors,warnings:warnings};
}
function _fxRange(r){return r[0]===r[1]?_hfxNum(r[0]):_hfxNum(r[0])+'..'+_hfxNum(r[1])}
function _fxWrite(name,sp){
  var l1='count '+sp.count+(sp.loop?'  loop  rate '+_hfxNum(sp.rate):'')+'  life '+_fxRange(sp.life)+'  speed '+_fxRange(sp.speed)+'  angle '+_fxRange(sp.angle);
  var l2='gravity '+_hfxNum(sp.gravity)+(sp.drag?'  drag '+_hfxNum(sp.drag):'')+'  size '+_fxRange(sp.size)+(sp.shape==='circle'?'  shape circle':'')+(sp.area&&(sp.area[0]||sp.area[1])?'  area '+_hfxNum(sp.area[0])+' '+_hfxNum(sp.area[1]):'');
  var l3='colors '+sp.colors.join(' ')+(sp.fade?'  fade':'');
  return'particles '+name+':\n  '+l1+'\n  '+l2+'\n  '+l3;
}
// ── syntax: hud NAME: / particles NAME: → HudDecl / FxDecl ──
(function(){
  var P=Parser.prototype,top0=P.parseTop;
  P.parseTop=function(){
    var t=this.cur(),n=this.t[this.p+1],c=this.t[this.p+2],b=this.t[this.p+3];
    if(!(t&&t.emitBlock&&n&&c&&b&&b.emitRaw&&(t.value==='hud'||t.value==='particles')))return top0.call(this);
    var k=t.value,r=k==='hud'?_hudParse(b.value):_fxParse(b.value);
    if(r.errors.length){var e=r.errors[0],ps=_emitBlockPos(b,e.off);throw new Error(ps.line+':'+ps.col+': '+e.msg)}
    this.p+=4;
    var d=new BlockDecl(k,n.value,b.value,{line:t.line,col:t.col});
    d.type=k==='hud'?'HudDecl':'FxDecl';
    d.nameRef={loc:{line:n.line,col:n.col}};
    d.spec=r.spec;
    d.warnings=r.warnings.map(function(w){var ps=_emitBlockPos(b,w.off);return{line:ps.line,col:ps.col,msg:w.msg}});
    if(k==='hud')(d.spec.items||[]).forEach(function(it){   /* where each name is: errors point at it */
      function at(x){if(x&&x.name!==undefined){var ps=_emitBlockPos(b,x.off);x.line=ps.line;x.col=ps.col}}
      (it.parts||[]).forEach(function(p){if(typeof p!=='string')at(p)});
      at(it.sprite);at(it.count);at(it.value);at(it.min);at(it.max);
    });
    return d;
  };
})();
// ── builtins ──
BUILTINS.hud={params:[{name:'name',type:'str'}],returnType:'void',module:'std'};
BUILTINS.hudOn={params:[],returnType:'void',module:'std'};
BUILTINS.hudOff={params:[],returnType:'void',module:'std'};
BUILTINS.say={params:[{name:'text',type:'str'},{name:'seconds',type:'num'}],returnType:'void',module:'std'};
BUILTINS.burst={params:[{name:'name',type:'str'},{name:'x',type:'num'},{name:'y',type:'num'}],returnType:'void',module:'std'};
BUILTINS.emitter={params:[{name:'name',type:'str'},{name:'x',type:'num'},{name:'y',type:'num'}],returnType:'int',module:'std'};
BUILTINS.moveEmitter={params:[{name:'h',type:'int'},{name:'x',type:'num'},{name:'y',type:'num'}],returnType:'void',module:'std'};
BUILTINS.stopEmitter={params:[{name:'h',type:'int'}],returnType:'void',module:'std'};
var _HFX_HUD_FNS={hud:1,hudOn:1,hudOff:1,say:1},_HFX_FX_FNS={burst:1,emitter:1,moveEmitter:1,stopEmitter:1};
// ── linking: blocks out of the program, names checked, calls lowered ──
//   hud(main) → hud("main")   say("Hi") → say("Hi", 2.0)   burst(sparkle, x, y) → burst("sparkle", x, y)
var _hfxGen=null;   // the codegen of the compile in progress (its globals: name → index, type)
_emitModLink=(function(link){return function(fr){
  var errs=[],warns=[],huds={},hudOrder=[],fxs={},any=false,usesHud=false,usesFx=false,sprites={};
  function at(m,loc){return fr.pre(m,(loc&&loc.line)||1,(loc&&loc.col)||1)}
  var mods=fr.mods||[];
  mods.forEach(function(m){
    if(!m.ast)return;
    var keep=[];
    m.ast.body.forEach(function(n){
      if(n&&n.type==='SpriteDecl')sprites[n.name.toLowerCase()]=n.name;
      if(!n||(n.type!=='HudDecl'&&n.type!=='FxDecl')){keep.push(n);return}
      any=true;
      var tab=n.type==='HudDecl'?huds:fxs,key=n.name.toLowerCase(),old=tab[key],what=n.type==='HudDecl'?'hud':'particles';
      if(old)errs.push(at(m,n.nameRef.loc)+what+' '+n.name+' is already declared'+(old.m===m?' at line '+old.n.loc.line:' in '+old.m.path+' (line '+old.n.loc.line+')')+' — every '+what+' block needs its own name');
      else{tab[key]={n:n,m:m};if(tab===huds)hudOrder.push(key)}
      (n.warnings||[]).forEach(function(w){warns.push(fr.pre(m,w.line,w.col)+w.msg)});
    });
    if(keep.length!==m.ast.body.length)m.ast.body=keep;
  });
  // the builtins: names checked and lowered (a file's own function of that name is left alone)
  var calls=false;
  mods.forEach(function(m){
    if(!m.ast)return;
    var own={},globals={};
    m.ast.body.forEach(function(n){
      if((n.type==='FunctionDecl'||n.type==='ImportDecl')&&(_HFX_HUD_FNS[n.name]||_HFX_FX_FNS[n.name]))own[n.name]=true;
      if(n.type==='VarDecl')globals[n.name]=true;
      if(n.type==='ModImportDecl'&&!n.star){var last=n.path[n.path.length-1];own[n.alias||last]=true}
    });
    function names(fn){
      var s={};fn.params.forEach(function(p){s[p.name]=true});
      (function walk(x){if(!x||typeof x!=='object')return;if(Array.isArray(x)){x.forEach(walk);return}if(x.type==='VarDecl'&&x.name)s[x.name]=true;if(x.type==='WithStmt'&&x.alias)s[x.alias]=true;for(var k in x){if(k!=='loc'){var v=x[k];if(v&&typeof v==='object')walk(v)}}})(fn.body);
      return s;
    }
    function flt(x){if(x&&x.type==='IntLiteral'&&isFinite(Number(x.value))){var v=String(Number(x.value));return new FloatLiteral(v.indexOf('.')<0&&v.indexOf('e')<0?v+'.0':v,x.loc)}return x}
    function lower(e,locals){
      var fn=e.callee.name,A=e.args;
      calls=true;
      if(_HFX_HUD_FNS[fn])usesHud=true;else usesFx=true;
      var want={hud:[1,1],hudOn:[0,0],hudOff:[0,0],say:[1,2],burst:[3,3],emitter:[3,3],moveEmitter:[3,3],stopEmitter:[1,1]}[fn];
      var use={hud:'hud(main) or hud("main")',hudOn:'hudOn()',hudOff:'hudOff()',say:'say("Hello!") or say("Hello!", 3)',burst:'burst(sparkle, x, y)',emitter:'let smoke = emitter(smoke, x, y)',moveEmitter:'moveEmitter(smoke, x, y)',stopEmitter:'stopEmitter(smoke)'}[fn];
      if(A.length<want[0]||A.length>want[1]){errs.push(at(m,e.loc)+fn+' takes '+(want[0]===want[1]?(want[0]===0?'no arguments':want[0]===1?'one argument':want[0]+' arguments'):want[0]+' or '+want[1]+' arguments')+': '+use);return}
      if(fn==='hud'||fn==='burst'||fn==='emitter'){
        var kind=fn==='hud'?'hud':'particles',tab=fn==='hud'?huds:fxs,a=A[0],nm=null,loc=a.loc;
        if(a.type==='IdentifierExpr'&&!locals[a.name]&&!globals[a.name])nm=a.name;
        else if(a.type==='StringLiteral')nm=String(a.value);
        if(nm!==null){
          var hit=tab[nm.toLowerCase()];
          if(hit)A[0]=new StringLiteral(hit.n.name,loc);
          else{
            var list=Object.keys(tab).map(function(k){return tab[k].n.name}),c=_emitModClosest(nm,list),other=(fn==='hud'?fxs:huds)[nm.toLowerCase()];
            var msg='Unknown '+kind+' "'+nm+'"';
            if(other)msg+=' — '+nm+' is a '+(kind==='hud'?'particles':'hud')+' block';
            else if(c)msg+=' — did you mean "'+c+'"?';
            else if(list.length)msg+=' — the '+kind+' blocks are '+list.slice(0,12).join(', ');
            else msg+=' — there is no '+kind+' block yet: write one (e.g. '+(kind==='hud'?'hud '+nm+':, then lines like   text "Score: {score}" top left':'particles '+nm+':, then   count 12  speed 40..90  fade')+') or make one with the Drawer (🧰 → '+(kind==='hud'?'HUD':'Particles')+')';
            errs.push(at(m,loc)+msg);return;
          }
        }
      }
      if(fn==='say'&&A.length===1)A.push(new FloatLiteral('2.0',e.loc));
      if(fn==='say')A[1]=flt(A[1]);
      if(fn==='burst'||fn==='emitter'||fn==='moveEmitter'){A[1]=flt(A[1]);A[2]=flt(A[2])}
    }
    function walk(x,locals){
      if(!x||typeof x!=='object')return;
      if(Array.isArray(x)){for(var i=0;i<x.length;i++)walk(x[i],locals);return}
      if(x.type==='CallExpr'&&x.callee&&x.callee.type==='IdentifierExpr'&&(_HFX_HUD_FNS[x.callee.name]||_HFX_FX_FNS[x.callee.name])&&!own[x.callee.name]&&!locals[x.callee.name])lower(x,locals);
      for(var k in x){if(k==='loc')continue;var v=x[k];if(v&&typeof v==='object')walk(v,locals)}
    }
    m.ast.body.forEach(function(n){
      if(n.type==='FunctionDecl')walk(n.body,names(n));
      else if(n.type==='VarDecl'&&n.init)walk(n.init,{});
    });
  });
  if(!any&&!calls)return link.apply(this,arguments);
  // the globals every file declares (the nodes: their names after linking are the WASM global names)
  var gl=[];
  mods.forEach(function(m){if(m.ast)m.ast.body.forEach(function(n){if(n&&n.type==='VarDecl'&&n.name&&!/^__/.test(n.name))gl.push({m:m,n:n,name:n.name,key:n.name.toLowerCase()})})});
  var r=link.apply(this,arguments);
  // HUD names → global variables (own file first, then the one file that has it), sprites
  var info={huds:[],fx:{}},gnames=gl.map(function(g){return g.name});
  hudOrder.forEach(function(key){
    var h=huds[key],m=h.m,items=JSON.parse(JSON.stringify(h.n.spec.items));
    function ref(x,what){
      if(!x||x.name===undefined)return;
      var k=x.name.toLowerCase(),own=gl.filter(function(g){return g.m===m&&g.key===k}),all=own.length?own:gl.filter(function(g){return g.key===k});
      if(all.length===1){x.g=all[0].n.name;x.decl=all[0].name;return}
      if(all.length>1){errs.push(at(m,x)+'"'+x.name+'" is a variable of several files ('+all.map(function(g){return g.m.path}).join(', ')+') — move this HUD into the file whose '+x.name+' it shows');return}
      var c=_emitModClosest(x.name,gnames);
      errs.push(at(m,x)+'Unknown variable "'+x.name+'" in hud '+h.n.name+(c?' — did you mean "'+c+'"?':' — a HUD shows global variables: declare it (mut '+x.name+' = 0) or set it in the rules (add '+x.name+' 1)'));
    }
    items.forEach(function(it){
      (it.parts||[]).forEach(function(p){if(typeof p!=='string')ref(p)});
      if(it.sprite){
        var s=sprites[it.sprite.name.toLowerCase()];
        if(s)it.sprite.name=s;
        else{var cs=_emitModClosest(it.sprite.name,Object.keys(sprites).map(function(k){return sprites[k]}));errs.push(at(m,it.sprite)+'Unknown sprite "'+it.sprite.name+'" in hud '+h.n.name+(cs?' — did you mean "'+cs+'"?':' — draw one with the Drawer (🧰 → Sprite), e.g. sprite '+it.sprite.name+': 8x8'))}
      }
      ref(it.count);ref(it.value);ref(it.min);ref(it.max);
    });
    info.huds.push({name:h.n.name,items:items});
  });
  Object.keys(fxs).forEach(function(k){info.fx[fxs[k].n.name]=fxs[k].n.spec});
  info.usesHud=usesHud||hudOrder.length>0;info.usesFx=usesFx||Object.keys(fxs).length>0;
  if(errs.length)r.errors=errs.concat(r.errors||[]);
  if(warns.length)r.warnings=(r.warnings||[]).concat(warns);
  if(r.ast)Object.defineProperty(r.ast,'hfxInfo',{value:info,enumerable:false,configurable:true,writable:true});
  return r;
}})(_emitModLink);
// The codegen's globals (name → {idx, type}): kept for the compile wrapper below
WasmCodegen.prototype.generate=(function(gen){return function(){var r=gen.apply(this,arguments);_hfxGen=this;return r}})(WasmCodegen.prototype.generate);
// The compile result: imports.hudMeta / imports.fxMeta (JSON), r.huds / r.particles (names)
compile=(function(c){return function(source,target){
  _hfxGen=null;
  var r=c.apply(this,arguments),I=r&&r.ast&&r.ast.hfxInfo,G=_hfxGen;_hfxGen=null;
  if(!I||!r.imports)return r;
  r.huds=I.huds.map(function(h){return h.name});r.particles=Object.keys(I.fx);
  if(r.errors&&r.errors.length)return r;
  var bad=[];
  function glob(x,what){
    if(!x||x.g===undefined)return;
    var e=G&&G.globalMap&&G.globalMap.get(x.g);
    if(!e){bad.push(x.decl+' ('+what+')');return}
    var t=String(e.type||'int');
    if(!/^(int|i64|i32|u32|i16|u16|i8|u8|num|f64|f32|bool|str)$/.test(t)){bad.push(x.decl+' is '+t);return}
    x.i=e.idx;x.t=t;delete x.g;delete x.decl;
  }
  I.huds.forEach(function(h){h.items.forEach(function(it){
    (it.parts||[]).forEach(function(p){if(typeof p!=='string')glob(p,'text')});
    glob(it.count,'icons');glob(it.value,'bar');glob(it.min,'bar');glob(it.max,'bar');
    (function strip(o){if(!o||typeof o!=='object')return;if(Array.isArray(o)){o.forEach(strip);return}delete o.off;delete o.line;delete o.col;for(var k in o)strip(o[k])})(it);
  })});
  if(bad.length){r.errors=(r.errors||[]).concat(['1:1: A HUD can show numbers, bools and strings — not '+bad.join(', ')]);r.wasm=new Uint8Array([0,0x61,0x73,0x6D,1,0,0,0]);return r}
  if(I.usesHud)r.imports.hudMeta=JSON.stringify({v:1,huds:I.huds});
  if(I.usesFx)r.imports.fxMeta=JSON.stringify({v:1,fx:I.fx});
  return r;
}})(compile);

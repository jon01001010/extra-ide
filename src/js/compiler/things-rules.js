// ═══ THINGS & RULES ═══ game objects and QR2D-style rules, lowered to ordinary Emit (compiler half; the runtime
// half is "THINGS & RULES (runtime half)" at the end of the first runtime block, the editor half is the LOGIC tool).
//
//   thing hero: box 16 16 #5fcde4, at 40 200, speed 2, hp 3, solid
//   thing coin: circ 5 #ffcd75, count 5, at 30+i*50 80
//   thing slime: oval 14 10 green, count 3, at 260 40+i*60, chase hero 0.6
//   rules:
//     every frame: hero mv stickX()*hero.speed, stickY()*hero.speed
//     on hit hero coin: remove coin : add score 1 : play coin
//     when count(coin) == 0: say "You win!" : stop
//
// Pipeline. The lexer masks #hex colours inside thing / rules blocks (they become identifier tokens marked
// lgHex); parseTop reads `thing NAME:` and `rules:` blocks (column 1, the following indented lines) into
// ThingDecl / RulesDecl; Parser.parse then lowers them (_lgLower) into ordinary declarations of the same file:
// one struct + region per kind (`region hero: __lgT_hero[1]`, so hero[0].x works in user code and the Memory
// tab shows it), auto-declared globals, generated functions (__lg_init, __lg_update, __lg_spawn_K …) and two
// entry points (game, frame) that _emitModLink's wrapper exports under their plain names (also from a
// non-entry file such as game.emit). The generated code is Emit source text parsed by the ordinary parser;
// every generated node gets the position of the thing / rule line it came from, and the user's expressions
// are spliced in with their own positions. A program without thing / rules blocks is not touched at all.
var _LG_KEYS={left:37,up:38,right:39,down:40,space:32,enter:13,shift:16,ctrl:17,alt:18,esc:27,escape:27,tab:9,backspace:8};
(function(){var i;for(i=0;i<26;i++)_LG_KEYS[String.fromCharCode(97+i)]=65+i;for(i=0;i<10;i++)_LG_KEYS[String(i)]=48+i})();
var _LG_COLORS={white:'#ffffff',black:'#000000',red:'#e43b44',green:'#63c74d',blue:'#3b5dc9',yellow:'#feae34',orange:'#f77622',purple:'#b55088',pink:'#f6757a',cyan:'#2ce8f5',gray:'#8b9bb4',grey:'#8b9bb4',brown:'#be4a2f',navy:'#262b44',lime:'#a7f070',gold:'#ffcd75'};
var _LG_BASE_FIELDS=['alive','x','y','vx','vy','w','h','px','py','frame','dir'];
var _LG_THING_WORDS=['box','circ','oval','sprite','at','size','count','pool','from','chase','flee','wander','patrol','track','follow','gravity','bounce','wrap','solid','wall'];
var _LG_EVENT_HELP='on start, every frame, every 2s, every 500ms, on key K, on keydown K, on keyup K, on press A, on hold A, on tap, on touch, on hit A B, when <condition>, each K, each K when <condition>';
var _LG_VERBS=['mv','vel','to','spawn','remove','block','bounce','set','add','play','music','say','frame','restart','stop','call'];
var _LG_SUBJ_VERBS={mv:1,vel:1,to:1,remove:1,block:1,bounce:1,frame:1};
var _LG_FN_HELPERS={rnd:1,stickX:1,stickY:1,tapX:1,tapY:1,count:1};
class ThingDecl extends Z{constructor(n,items,l){super('ThingDecl',l);this.name=n;this.items=items}}
class RulesDecl extends Z{constructor(rules,l){super('RulesDecl',l);this.rules=rules}}
// ── lexer: #hex colours inside thing / rules blocks ──
(function(){
  var tk0=Lexer.prototype.tokenize,HEAD=/^(thing[ \t]+[A-Za-z_]\w*[ \t]*:|rules[ \t]*:)/i;
  /* tokens on lines outside every block (the shared scanner, _emitScanBlocks) get lgOut: a thing / rules block
     ends there even when the line does not start in column 1 (e.g. indented lines after a column-1 comment) */
  function outMark(src,ts){
    var inb=new Uint8Array(src.split('\n').length+2);
    _emitScanBlocks(src).forEach(function(b){for(var i=b.start;i<=b.end;i++)inb[i+1]=1});
    ts.forEach(function(t){if(t&&t.line&&!inb[t.line])t.lgOut=true});
    return ts;
  }
  Lexer.prototype.tokenize=function(){
    if(typeof this.s!=='string'||!/^(thing[ \t]+[A-Za-z_]\w*[ \t]*:|rules[ \t]*:)/mi.test(this.s))return tk0.call(this);
    var src0=this.s;
    var lines=this.s.split('\n'),inB=false,marks=Object.create(null),any=false;
    for(var li=0;li<lines.length;li++){
      var ln=lines[li];
      if(HEAD.test(ln))inB=true;
      else if(/^[^\s\/]/.test(ln))inB=false;
      if(!inB||ln.indexOf('#')<0)continue;
      var out='',q=null;
      for(var c=0;c<ln.length;c++){
        var ch=ln[c];
        if(q){out+=ch;if(ch==='\\'&&c+1<ln.length){out+=ln[++c];continue}if(ch===q)q=null;continue}
        if(ch==='"'||ch==="'"){q=ch;out+=ch;continue}
        if(ch==='/'&&ln[c+1]==='/'){out+=ln.slice(c);break}
        if(ch==='#'&&/[0-9a-fA-F]/.test(ln[c+1]||'')){out+='_';marks[(li+1)+':'+(c+1)]=1;any=true;continue}
        out+=ch;
      }
      lines[li]=out;
    }
    if(!any)return outMark(src0,tk0.call(this));
    var s0=this.s,ts;this.s=lines.join('\n');
    try{ts=tk0.call(this)}finally{this.s=s0}
    ts.forEach(function(t){if(t.type===TT.IDENTIFIER&&marks[t.line+':'+t.col]){t.value='#'+String(t.value).slice(1);t.lgHex=true}});
    return outMark(src0,ts);
  };
})();
// ── syntax: thing NAME: … and rules: … (contextual words in column 1) ──
(function(){
  var P=Parser.prototype,top0=P.parseTop,parse0=P.parse;
  function E(t,m){return new Error(t.line+':'+t.col+': '+m)}
  function tokLen(t){return t.type===TT.STRING?String(t.value).length+2:String(t.value).length||1}
  function Cur(toks,owner){this.t=toks;this.k=0;this.owner=owner}
  Cur.prototype.peek=function(o){return this.t[this.k+(o||0)]};
  Cur.prototype.end=function(){return this.k>=this.t.length};
  Cur.prototype.next=function(){return this.t[this.k++]};
  Cur.prototype.eofTok=function(){var l=this.t[this.t.length-1]||this.owner;return new Token(TT.EOF,'',l.line,l.col+tokLen(l))};
  Cur.prototype.here=function(){return this.end()?this.eofTok():this.peek()};
  Cur.prototype.isWord=function(v,o){var t=this.peek(o);return!!t&&(t.type===TT.IDENTIFIER||t.type===TT.KEYWORD||t.type===TT.TYPE)&&(v===undefined||String(t.value).toLowerCase()===v)};   /* words of thing / rules lines are case-insensitive */
  function lv(t){return t?String(t.value).toLowerCase():''}
  Cur.prototype.isType=function(ty,o){var t=this.peek(o);return!!t&&t.type===ty};
  Cur.prototype.expr=function(what){
    if(this.end()||this.isType(TT.COLON)||this.isType(TT.COMMA))throw E(this.here(),'Expected '+what);
    var sub=new Parser(this.t.slice(this.k).concat([this.eofTok()])),e;
    e=sub.parseExpr();
    e.lgToks=this.t.slice(this.k,this.k+sub.p);
    this.k+=sub.p;
    return e;
  };
  Cur.prototype.word=function(what){var t=this.peek();if(t&&(t.type===TT.IDENTIFIER||t.type===TT.KEYWORD||t.type===TT.TYPE))return this.next();throw E(this.here(),'Expected '+what)};
  // an optional comma between the two numbers of a pair (mv -2, 0) — only when a value follows it
  Cur.prototype.pairSep=function(){
    if(!this.isType(TT.COMMA))return;
    var n=this.peek(1);
    if(n&&(n.type===TT.INTEGER||n.type===TT.FLOAT||n.type===TT.MINUS||n.type===TT.LPAREN||(n.type===TT.IDENTIFIER&&_LG_THING_WORDS.indexOf(lv(n))<0&&!this.owner.lgThing)))this.next();
  };
  P.lgBlock=function(){
    var first=this.cur(),lines=[],cur=null,last=-1;
    while(!this.check(TT.EOF)){
      var t=this.cur();
      if(t.line!==first.line&&(t.col===1||t.lgOut))break;
      if(t.line!==last){cur=[];lines.push(cur);last=t.line}
      cur.push(this.adv());
    }
    return lines;
  };
  P.parseTop=function(){
    var t=this.cur(),n=this.t[this.p+1],n2=this.t[this.p+2];
    if(t.type===TT.IDENTIFIER&&t.col===1&&n&&n.line===t.line){
      if(lv(t)==='thing'&&(n.type===TT.IDENTIFIER||n.type===TT.TYPE||n.type===TT.KEYWORD)){
        if(n.type!==TT.IDENTIFIER)throw E(n,'"'+n.value+'" cannot name a thing — it is a reserved word');
        if(!(n2&&n2.type===TT.COLON&&n2.line===t.line))throw E(n2&&n2.line===t.line?n2:n,'Expected : after thing '+n.value+' — thing '+n.value+': box 16 16 #ffffff');
        return this.parseThing();
      }
      if(lv(t)==='rules'&&n.type===TT.COLON)return this.parseRules();
    }
    return top0.call(this);
  };
  P.parseThing=function(){
    var l=this.loc(),lines=this.lgBlock(),head=lines[0],nt=head[1],items=[];
    lines[0]=head.slice(3);
    var owner={line:head[2].line,col:head[2].col,lgThing:true};
    lines.forEach(function(toks){
      if(!toks.length)return;
      var C=new Cur(toks,owner);
      while(!C.end()){
        items.push(lgThingItem(C,nt.value));
        if(C.end())break;
        if(!C.isType(TT.COMMA))throw E(C.peek(),'Expected , between the parts of thing '+nt.value+' (or a new line)');
        C.next();
        if(C.end())break;
      }
    });
    var d=new ThingDecl(nt.value,items,l);
    d.nameTok=nt;
    return d;
  };
  function color(C){
    var t=C.peek();
    if(t&&t.type===TT.IDENTIFIER&&t.lgHex){
      if(!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(t.value))throw E(t,'"'+t.value+'" is not a colour — write #rgb or #rrggbb, e.g. #ffcd75');
      C.next();return{value:t.value,tok:t};
    }
    if(t&&t.type===TT.IDENTIFIER&&Object.prototype.hasOwnProperty.call(_LG_COLORS,lv(t))){C.next();return{value:lv(t),tok:t}}
    return null;
  }
  function optExpr(C){return(C.end()||C.isType(TT.COMMA))?null:C.expr('a number')}
  function lgThingItem(C,kname){
    var w=C.peek();
    if(w&&w.type===TT.IDENTIFIER&&w.lgHex)throw E(w,'A colour belongs right after the shape — box 16 16 '+w.value);
    w=C.word('a part of thing '+kname+' — box W H #color, circ R #color, oval W H #color, sprite NAME, at X Y, count N, …');
    var it={kind:lv(w),tok:w};
    switch(it.kind){
      case'box':case'oval':it.w=C.expr('the width — '+w.value+' 16 16 #ffffff');it.h=C.expr('the height — '+w.value+' 16 16 #ffffff');it.color=color(C);break;
      case'circ':it.r=C.expr('the radius — circ 8 #ffffff');it.color=color(C);break;
      case'sprite':it.sprite=C.word('a sprite name — sprite hero');break;
      case'at':it.x=C.expr('the x position — at 40 200');C.pairSep();it.y=C.expr('the y position — at 40 200');break;
      case'size':it.w=C.expr('the width — size 16 16');C.pairSep();it.h=C.expr('the height — size 16 16');break;
      case'count':case'pool':it.n=C.expr('how many — '+w.value+' 10');break;
      case'from':
        if(!C.isWord('map'))throw E(C.here(),'Expected map after from — from map level1');
        C.next();it.map=C.word('a map name — from map level1');break;
      case'chase':case'flee':case'track':
        it.target=C.word('the thing to '+w.value+' — '+w.value+' hero'+(lv(w)==='track'?'':' 1.5'));
        if(lv(w)!=='track')it.speed=optExpr(C);
        break;
      case'follow':it.target=C.word('the thing to follow — follow hero');it.gap=optExpr(C);break;
      case'wander':case'patrol':it.speed=optExpr(C);break;
      case'gravity':it.g=C.expr('the pull per frame — gravity 0.3');break;
      case'bounce':case'wrap':case'solid':case'wall':break;
      default:
        if(C.end()||C.isType(TT.COMMA)){
          var hint=_emitModClosest(w.value,_LG_THING_WORDS);
          throw E(w,'Unknown part "'+w.value+'" of thing '+kname+(hint?' — did you mean "'+hint+'"?':' — use box, circ, oval, sprite, at, size, count, pool, from map, chase, flee, wander, patrol, track, follow, gravity, bounce, wrap, solid, wall, or NAME VALUE for a field (hp 3)'));
        }
        if(w.type!==TT.IDENTIFIER)throw E(w,'"'+w.value+'" is a reserved word — it cannot name a field');
        var near=_emitModClosest(w.value,_LG_THING_WORDS);
        var nx=C.peek();
        if(near&&near!==w.value&&nx&&nx.type===TT.IDENTIFIER)throw E(w,'Unknown part "'+w.value+'" of thing '+kname+' — did you mean "'+near+'"?');
        it.kind='field';it.name=w.value;it.value=C.expr('the starting value of field '+w.value+' — '+w.value+' 3');
    }
    return it;
  }
  P.parseRules=function(){
    var l=this.loc(),lines=this.lgBlock(),rules=[];
    lines[0]=lines[0].slice(2);
    var owner=lines[0].length?lines[0][0]:{line:l.line,col:l.col+5};
    lines.forEach(function(toks){if(toks.length)rules.push(lgRule(new Cur(toks,{line:toks[0].line,col:toks[0].col})))});
    var d=new RulesDecl(rules,l);
    void owner;
    return d;
  };
  function keyTok(C,what){
    var t=C.peek();
    if(t&&(t.type===TT.IDENTIFIER||t.type===TT.INTEGER)){
      var k=String(t.value).toLowerCase();
      if(Object.prototype.hasOwnProperty.call(_LG_KEYS,k)){C.next();return{tok:t,code:_LG_KEYS[k],name:k}}
      throw E(t,'Unknown key "'+t.value+'" — use left right up down space enter shift ctrl alt esc tab backspace, a–z or 0–9');
    }
    throw E(C.here(),'Expected a key after '+what+' — '+what+' left');
  }
  function btnTok(C,what){
    var t=C.peek();
    if(t&&t.type===TT.IDENTIFIER&&/^[abcABC]$/.test(t.value)){C.next();return{tok:t,btn:t.value.toUpperCase()}}
    throw E(C.here(),'Expected A, B or C after '+what+' — '+what+' A');
  }
  function lgRule(C){
    var w=C.peek(),r={tok:w,actions:[]};
    if(w.type===TT.IDENTIFIER&&(lv(w)==='stage'||lv(w)==='seed'||lv(w)==='show'))return lgDirective(C);
    if(!(w.type===TT.IDENTIFIER||w.type===TT.KEYWORD))throw E(w,'Expected an event — '+_LG_EVENT_HELP);
    C.next();
    switch(lv(w)){
      case'on':{
        var e=C.word('what to react to after on — on start, on key left, on press A, on tap, on hit hero coin');
        r.ev=lv(e);r.evTok=e;
        switch(r.ev){
          case'start':case'tap':case'touch':break;
          case'key':case'keydown':case'keyup':r.key=keyTok(C,'on '+e.value);break;
          case'press':case'hold':r.btn=btnTok(C,'on '+e.value);break;
          case'hit':r.a=C.word('two things after on hit — on hit hero coin');r.b=C.word('a second thing after on hit '+r.a.value+' — on hit '+r.a.value+' coin (or wall, edge)');[r.a,r.b].forEach(function(t){if(/^(wall|edge)$/i.test(t.value))t.value=t.value.toLowerCase()});break;
          default:{var h=_emitModClosest(e.value,['start','key','keydown','keyup','press','hold','tap','touch','hit']);throw E(e,'Unknown event "on '+e.value+'"'+(h?' — did you mean "on '+h+'"?':' — use on start, on key K, on keydown K, on keyup K, on press A, on hold A, on tap, on touch, on hit A B'))}
        }
        break;
      }
      case'every':{
        if(C.isWord('frame')){C.next();r.ev='frame';break}
        var n=C.peek();
        if(!n||(n.type!==TT.INTEGER&&n.type!==TT.FLOAT))throw E(C.here(),'Expected frame or a time after every — every frame, every 2s, every 500ms');
        C.next();
        var u=C.peek();
        if(!u||u.type!==TT.IDENTIFIER||(lv(u)!=='s'&&lv(u)!=='ms')||u.line!==n.line)throw E(u&&u.line===n.line?u:C.here(),'Expected s or ms after the number — every '+n.value+'s, every 500ms');
        C.next();
        r.ev='every';r.frames=Math.max(1,Math.round(Number(n.value)*(lv(u)==='s'?60:0.06)));r.evTok=n;
        break;
      }
      case'when':r.ev='when';r.cond=C.expr('a condition after when — when score >= 10');break;
      case'each':
        r.ev='each';r.kind=C.word('a thing after each — each slime: mv 0, 1');
        if(C.isWord('when')){C.next();r.cond=C.expr('a condition after when — each slime when slime.y > 240')}
        break;
      default:{var hh=_emitModClosest(w.value,['on','every','when','each','stage','seed','show']);throw E(w,'Unknown event "'+w.value+'"'+(hh?' — did you mean "'+hh+'"?':' — a rule starts with on, every, when or each ('+_LG_EVENT_HELP+')'))}
    }
    if(!C.isType(TT.COLON))throw E(C.here(),C.end()?'Expected : and an action after the event — on tap: hero to tapX(), tapY()':'Expected : after the event — '+(r.ev==='hit'?'on hit '+r.a.value+' '+r.b.value+': remove '+r.b.value:'on start: set score 0'));
    C.next();
    for(;;){
      r.actions.push(lgAction(C));
      if(C.end())break;
      if(!C.isType(TT.COLON))throw E(C.peek(),'Expected : between two actions — add score 1 : play coin');
      C.next();
    }
    return r;
  }
  function lgDirective(C){
    var w=C.next(),r={tok:w,dir:lv(w)};
    if(r.dir==='seed'){r.n=C.expr('a number after seed — seed 42')}
    else if(r.dir==='show'){r.items=[C.expr('what to show — show score')];while(C.isType(TT.COMMA)){C.next();r.items.push(C.expr('what to show — show score, hero.hp'))}}
    else{
      var s=C.word('size, color or map after stage — stage size 320 240');r.what=lv(s);r.whatTok=s;
      if(r.what==='size'){r.w=C.expr('the width — stage size 320 240');C.pairSep();r.h=C.expr('the height — stage size 320 240')}
      else if(r.what==='color'){r.color=color(C);if(!r.color)throw E(C.here(),'Expected a colour — stage color #1a1c2c')}
      else if(r.what==='map'){r.map=C.word('a map name — stage map level1')}
      else if(r.what==='controls'){r.ctl=C.word('the name of a controls block — stage controls pad')}
      else throw E(s,'Unknown stage setting "'+s.value+'" — stage size W H, stage color #rrggbb, stage map NAME, stage controls NAME');
    }
    if(!C.end())throw E(C.peek(),'Unexpected "'+C.peek().value+'" after '+(r.dir==='stage'?'stage '+r.what:r.dir));
    return r;
  }
  function lgAction(C){
    var w=C.peek(),a={tok:w};
    if(!w||!(w.type===TT.IDENTIFIER||w.type===TT.KEYWORD))throw E(C.here(),'Expected an action — '+_LG_VERBS.join(', '));
    var n=C.peek(1);
    if(w.type===TT.IDENTIFIER&&_LG_VERBS.indexOf(lv(w))<0&&n&&n.type===TT.IDENTIFIER&&_LG_SUBJ_VERBS[lv(n)]){a.subj=C.next();w=C.peek();a.tok=w}
    C.next();
    a.verb=lv(w);
    var end=function(){return C.end()||C.isType(TT.COLON)};
    switch(a.verb){
      case'mv':case'vel':case'to':a.x=C.expr('two numbers — '+w.value+' 2, 0');C.pairSep();a.y=C.expr('a second number — '+w.value+' 2, 0');break;
      case'spawn':
        a.kind=C.word('a thing after spawn — spawn bullet at hero.x hero.y vel 6 0');
        if(C.isWord('at')){C.next();a.x=C.expr('x after at');C.pairSep();a.y=C.expr('y after at')}
        if(C.isWord('vel')){C.next();a.vx=C.expr('vx after vel');C.pairSep();a.vy=C.expr('vy after vel')}
        break;
      case'remove':case'block':case'bounce':
        if(!a.subj&&!end())a.subj=C.word('a thing — '+w.value+' hero');
        break;
      case'frame':
        if(!a.subj&&C.isType(TT.IDENTIFIER)){var f1=C.peek(1);if(f1&&f1.line===w.line&&(f1.type===TT.INTEGER||f1.type===TT.FLOAT||f1.type===TT.IDENTIFIER||f1.type===TT.LPAREN||f1.type===TT.STRING))a.subj=C.next()}
        a.value=C.expr('the frame number — frame hero 2');
        break;
      case'set':case'add':{
        var t=C.word('a variable or thing field after '+w.value+' — '+w.value+' score 1, '+w.value+' hero.hp -1');
        a.target=t;
        if(C.isType(TT.DOT)){C.next();a.field=C.word('a field name after '+t.value+'.');}
        a.value=C.expr('a value — '+w.value+' '+t.value+(a.field?'.'+a.field.value:'')+' 1');
        break;
      }
      case'play':case'music':{
        var s=C.peek();
        if(s&&(s.type===TT.IDENTIFIER||s.type===TT.STRING||s.type===TT.KEYWORD)){C.next();a.name=String(s.value);a.nameTok=s}
        else throw E(C.here(),'Expected a sound name after '+w.value+' — '+w.value+' coin');
        break;
      }
      case'say':a.value=C.expr('what to say — say "You win!"');break;
      case'restart':case'stop':break;
      case'call':{
        var f=C.peek();
        if(!f||f.type!==TT.IDENTIFIER)throw E(C.here(),'Expected a function name after call — call openChest');
        if(C.isType(TT.LPAREN,1)){a.callExpr=C.expr('a call')}
        else{C.next();a.fn=f}
        break;
      }
      default:{var hv=_emitModClosest(w.value,_LG_VERBS);throw E(w,'Unknown action "'+w.value+'"'+(hv?' — did you mean "'+hv+'"?':' — use '+_LG_VERBS.join(', ')))}
    }
    if(!end())throw E(C.peek(),'Unexpected "'+C.peek().value+'" after the '+a.verb+' action — separate actions with :');
    return a;
  }
  // The LOGIC tool reads blocks with the compiler's own parser: one thing block, or one rules line wrapped as
  // `rules:\n  <line>`. Returns {decl, tokens} (expressions carry .lgToks) or throws the compiler's error.
  window._lgParseBlock=function(text){
    var ts=new Lexer(String(text)).tokenize(),p=new Parser(ts),d=p.parseTop();
    if(!p.check(TT.EOF))throw new Error(p.cur().line+':'+p.cur().col+': more than one block');
    return{decl:d,tokens:ts};
  };
  P.parse=function(){
    var prog=parse0.apply(this,arguments);
    for(var i=0;i<prog.body.length;i++)if(prog.body[i]&&(prog.body[i].type==='ThingDecl'||prog.body[i].type==='RulesDecl')){_lgLower(prog);break}
    return prog;
  };
})();
// ── lowering ──
function _lgLower(prog){
  function E(at,m){var l=at&&(at.loc||at);return new Error(((l&&l.line)||1)+':'+((l&&l.col)||1)+': '+m)}
  var body=prog.body,things=[],rulesDecl=null,userFns=new Map(),userVars=new Set(),userNames=new Map(),hasImports=false,userFrame=null,usesCanvas=false;
  body.forEach(function(n){
    if(!n)return;
    if(n.type==='ThingDecl'){things.push(n);return}
    if(n.type==='RulesDecl'){if(rulesDecl)throw E(n.loc,'A file has one rules: block — put these rules into the rules: block at line '+rulesDecl.loc.line);rulesDecl=n;return}
    if(n.type==='ModImportDecl')hasImports=true;
    if(n.type==='FunctionDecl'){userFns.set(n.name,n);if(n.name==='frame'&&n.exported)userFrame=n}
    if(n.type==='ImportDecl')userFns.set(n.name,n);
    if(n.type==='VarDecl')userVars.add(n.name);
    if(n.name&&typeof n.name==='string'&&!/^(SoundDecl|MusicDecl|SpriteDecl)$/.test(n.type)){   /* play coin / sprite hero name blocks of their own kind */
      if(/^__lg/.test(n.name))throw E(n.loc,'Names starting with __lg are reserved for the code generated from thing / rules blocks — rename '+n.name);
      userNames.set(n.name,n);
    }
  });
  (function scan(x){
    if(!x||typeof x!=='object'||usesCanvas)return;
    if(Array.isArray(x)){x.forEach(scan);return}
    if(x.type==='CallExpr'&&x.callee&&x.callee.type==='IdentifierExpr'&&/^(canvas|screen|scene3d|pixiApp|physics)$/.test(x.callee.name)){usesCanvas=true;return}
    for(var k in x){var v=x[k];if(v&&typeof v==='object'&&k!=='loc')scan(v)}
  })(body.filter(function(n){return n&&n.type!=='ThingDecl'&&n.type!=='RulesDecl'}));
  // ── kinds ──
  var kinds=new Map(),KL=[];
  things.forEach(function(d){
    if(kinds.has(d.name))throw E(d.nameTok,'thing '+d.name+' is already declared at line '+kinds.get(d.name).decl.loc.line);
    if(userNames.has(d.name))throw E(d.nameTok,'"'+d.name+'" is already declared at line '+((userNames.get(d.name).loc||{}).line||1)+' of this file — a thing name is a top-level name too (its region)');
    if(/^__lg/.test(d.name))throw E(d.nameTok,'Names starting with __lg are reserved');
    if(/^(wall|edge)$/i.test(d.name))throw E(d.nameTok,'"'+d.name+'" is a word of on hit (solid map tiles / the screen edge) — call the thing something else');
    if(/^(sqrt|sin|cos|canvas|animate|wipe|rnd|count|stickX|stickY|tapX|tapY|i|game|frame)$/.test(d.name))throw E(d.nameTok,'"'+d.name+'" is used by the game code (a builtin, a rules helper or an entry point) — call the thing something else');
    var K={name:d.name,decl:d,idx:KL.length,shape:null,sprite:null,at:null,size:null,count:null,pool:null,map:null,beh:[],flags:{},fields:[],fieldSet:new Set(),struct:'__lgT_'+d.name,track:false};
    var seen={};
    d.items.forEach(function(it){
      var once=['at','size','count','pool','from','gravity','follow'];
      var shapeW=['box','circ','oval','sprite'];
      if(shapeW.indexOf(it.kind)>=0){if(K.shape)throw E(it.tok,'thing '+d.name+' already has a shape ('+K.shape.kind+') — a thing has one shape');K.shape=it;return}
      if(once.indexOf(it.kind)>=0&&seen[it.kind])throw E(it.tok,it.kind+' is given twice for thing '+d.name);
      seen[it.kind]=1;
      switch(it.kind){
        case'at':K.at=it;break;
        case'size':K.size=it;break;
        case'count':case'pool':{
          var v=_rgTryFold(it.n);
          if(v===null)throw E(it.n.loc,it.kind+' needs a whole number written as a constant — '+it.kind+' 10');
          if(v<(it.kind==='pool'?1:0)||v>100000)throw E(it.n.loc,it.kind+' must be between '+(it.kind==='pool'?1:0)+' and 100000, not '+v);
          K[it.kind]=v;break;
        }
        case'from':K.map=it.map;break;
        case'bounce':case'wrap':case'solid':case'wall':K.flags[it.kind]=it;break;
        case'gravity':K.gravity=it;break;
        case'field':
          if(_LG_BASE_FIELDS.indexOf(it.name)>=0||it.name==='fx'||it.name==='fy')throw E(it.tok,'"'+it.name+'" is a built-in field of every thing — '+(it.name==='x'||it.name==='y'?'set the position with at X Y':it.name==='w'||it.name==='h'?'set the size with size W H':'choose another name'));
          if(K.fieldSet.has(it.name))throw E(it.tok,'Field "'+it.name+'" is given twice for thing '+d.name);
          K.fieldSet.add(it.name);K.fields.push(it);break;
        default:K.beh.push(it);if(it.kind==='track')K.track=true;
      }
    });
    if(!K.shape)K.shape={kind:'box',tok:d.nameTok,w:null,h:null,color:null};
    var cap=K.count!==null?K.count:(K.pool!==null||K.map?0:1);
    K.alive0=cap;
    if(K.pool!==null)cap=Math.max(cap,K.pool);
    if(K.map&&K.pool===null)cap=Math.max(cap,64);
    K.cap=Math.max(1,cap);
    kinds.set(d.name,K);KL.push(K);
  });
  function kindHint(t){var h=_emitModClosest(t.value,KL.map(function(k){return k.name}));return h?' — did you mean "'+h+'"?':(KL.length?' — the things are: '+KL.map(function(k){return k.name}).join(', '):' — declare it first: thing '+t.value+': box 16 16 #ffffff')}
  function kindOf(t,extra){
    if(kinds.has(t.value))return kinds.get(t.value);
    throw E(t,'Unknown thing "'+t.value+'"'+(extra||'')+kindHint(t));
  }
  KL.forEach(function(K){K.beh.forEach(function(b){if(b.target){b.T=kindOf(b.target)}})});
  // ── generated text ──
  var lines=[],anchors=[],ph=Object.create(null),phn=0,needFirst=new Set(),needFind=new Set(),needCount=new Set(),needSolid=false,needBlock=new Set(),autoVars=new Map(),showLabels=[],stage={w:320,h:240,color:'#1a1c2c',map:null},seed=null,hasStop=false;
  var anchor=things.length?things[0].loc:rulesDecl.loc;
  function L(s,at){String(s).split('\n').forEach(function(x){lines.push(x);anchors.push(at||anchor)})}
  function lit(x){var s=String(x);return/[.eE]/.test(s)?s:s+'.0'}
  function q(s){return JSON.stringify(String(s))}
  // user expression → placeholder, rewritten for its context cx {binds: {kind: idxVar}, i: idxVar|null}
  function X(e,cx){
    var id='__lgX'+(phn++);
    ph[id]=rw(e,cx||{binds:{}},e.lgToks||[]);
    return id;
  }
  function clone(x){
    if(!x||typeof x!=='object')return x;
    if(Array.isArray(x))return x.map(clone);
    var o=Object.create(Object.getPrototypeOf(x));
    for(var k in x)if(Object.prototype.hasOwnProperty.call(x,k))o[k]=k==='lgToks'?undefined:(k==='loc'?(x[k]?{line:x[k].line,col:x[k].col}:x[k]):clone(x[k]));
    delete o.lgToks;
    return o;
  }
  function idxOf(K,cx){
    if(cx.binds&&cx.binds[K.name])return new IdentifierExpr(cx.binds[K.name],null);
    needFirst.add(K);
    return new CallExpr(new IdentifierExpr('__lg_first_'+K.name,null),[],null);
  }
  function propTok(toks,loc){
    for(var j=0;j+2<toks.length;j++)if(toks[j].line===loc.line&&toks[j].col===loc.col&&toks[j+1].type===TT.DOT)return toks[j+2];
    return null;
  }
  function rw(e,cx,toks,nv){
    if(!e||typeof e!=='object')return e;
    if(Array.isArray(e))return e.map(function(x){return rw(x,cx,toks)});
    if(e.type==='IdentifierExpr'){
      if(e.name==='i'&&cx.i)return new IdentifierExpr(cx.i,{line:e.loc.line,col:e.loc.col});
      if(kinds.has(e.name))throw E(e.loc,'"'+e.name+'" is a thing — use one of its fields: '+e.name+'.x, '+e.name+'.y'+(kinds.get(e.name).fields.length?', '+e.name+'.'+kinds.get(e.name).fields[0].name:'')+' (or count('+e.name+'))');
      if(!nv&&!hasImports&&!userVars.has(e.name)&&!userFns.has(e.name)&&!preAuto.has(e.name)&&!userNames.has(e.name)){
        var known=Array.from(userVars).concat(Array.from(preAuto.keys()));
        var hn=_emitModClosest(e.name,known);
        throw E(e.loc,'Unknown name "'+e.name+'"'+(hn?' — did you mean "'+hn+'"?':' — declare it (mut '+e.name+' = 0) or give it a value in a rule (set '+e.name+' 0)'));
      }
      return clone(e);
    }
    if(e.type==='MemberExpr'&&e.object&&e.object.type==='IdentifierExpr'&&kinds.has(e.object.name)){
      var K=kinds.get(e.object.name),f=String(e.property);
      if(_LG_BASE_FIELDS.indexOf(f)<0&&!K.fieldSet.has(f)&&!(K.track&&(f==='fx'||f==='fy'))){
        var all=_LG_BASE_FIELDS.concat(K.fields.map(function(x){return x.name})),h=_emitModClosest(f,all),pt=propTok(toks,e.object.loc);
        throw E(pt||e.loc,'thing '+K.name+' has no field "'+f+'"'+(h?' — did you mean "'+h+'"?':' — its fields: '+all.join(' ')));
      }
      var ie=new IndexExpr(new IdentifierExpr(K.name,{line:e.loc.line,col:e.loc.col}),idxOf(K,cx),{line:e.loc.line,col:e.loc.col});
      return new MemberExpr(ie,f,{line:e.loc.line,col:e.loc.col});
    }
    if(e.type==='CallExpr'&&e.callee&&e.callee.type==='IdentifierExpr'&&_LG_FN_HELPERS[e.callee.name]&&!userFns.has(e.callee.name)){
      var nm=e.callee.name,l={line:e.loc.line,col:e.loc.col},want=nm==='rnd'||nm==='count'?1:0;
      if(e.args.length!==want)throw E(e.loc,nm+'() takes '+(want?'one argument — '+(nm==='rnd'?'rnd(100) is a random number from 0 up to 100':'count(coin) is how many coins are alive'):'no arguments'));
      if(nm==='count'){
        var a=e.args[0];
        if(!a||a.type!=='IdentifierExpr'||!kinds.has(a.name))throw E(a?a.loc:e.loc,'count() takes the name of a thing — count(coin)');
        needCount.add(kinds.get(a.name));
        return new CallExpr(new IdentifierExpr('__lg_count_'+a.name,l),[],l);
      }
      if(nm==='rnd')return new CallExpr(new IdentifierExpr('__lg_rnd',l),[rw(e.args[0],cx,toks)],l);
      var code={stickX:0,stickY:1,tapX:2,tapY:3}[nm];
      return new CallExpr(new IdentifierExpr('__lgIn',l),[new IntLiteral(String(code),l)],l);
    }
    var o=Object.create(Object.getPrototypeOf(e));
    for(var k in e){if(!Object.prototype.hasOwnProperty.call(e,k)||k==='lgToks')continue;var v=e[k];o[k]=k==='loc'?(v?{line:v.line,col:v.col}:v):(v&&typeof v==='object'?rw(v,cx,toks,(e.type==='CallExpr'&&k==='callee')||(e.type==='MemberExpr'&&k==='object')||e.type==='NewExpr'):v)}
    return o;
  }
  function R(K,ix){return '@'+K.name+'['+ix+']'}
  // ── directives ──
  var rules=rulesDecl?rulesDecl.rules:[],preAuto=new Map();
  var autoNum=new Set();
  function intLit(e){return!!e&&(e.type==='IntLiteral'||(e.type==='UnaryExpr'&&e.op==='-'&&intLit(e.operand)))}
  rules.forEach(function(r){(r.actions||[]).forEach(function(a){
    if((a.verb==='set'||a.verb==='add')&&!a.field&&!userVars.has(a.target.value)){
      if(!preAuto.has(a.target.value))preAuto.set(a.target.value,a.target);
      if(!intLit(a.value))autoNum.add(a.target.value);
    }
  })});
  rules.forEach(function(r){
    if(!r.dir)return;
    if(r.dir==='seed'){var s=_rgTryFold(r.n);if(s===null)throw E(r.n.loc,'seed needs a whole number constant — seed 42');seed=s}
    else if(r.dir==='show'){r.items.forEach(function(e){showLabels.push({e:e,label:(e.lgToks||[]).map(function(t){return t.type===TT.STRING?JSON.stringify(t.value):String(t.value)}).join('')})})}
    else if(r.what==='size'){var w=_rgTryFold(r.w),h=_rgTryFold(r.h);if(w===null||w<1)throw E(r.w.loc,'stage size needs whole numbers — stage size 320 240');if(h===null||h<1)throw E(r.h.loc,'stage size needs whole numbers — stage size 320 240');stage.w=w;stage.h=h}
    else if(r.what==='color')stage.color=_LG_COLORS[r.color.value]||r.color.value;
    else if(r.what==='map')stage.map=r.map.value;
    else if(r.what==='controls'){stage.controls=r.ctl.value;Object.defineProperty(stage,'controlsTok',{value:r.ctl,enumerable:false,configurable:true})}   /* STAGE's on-screen controls: useControls(NAME) at the start */
  });
  if(!stage.map)KL.some(function(K){if(K.map){stage.map=K.map.value;return true}});
  function solidUsed(){needSolid=true}
  KL.forEach(function(K){if(K.flags.solid||K.flags.bounce||K.beh.some(function(b){return b.kind==='patrol'}))solidUsed()});
  var wallKinds=KL.filter(function(K){return K.flags.wall});
  // ── one action → lines ──
  // ctx: {binds, i, hit:{A,B,a,b,other}|null, each:K|null, start:bool, rule}
  function subject(a,cx,verb){
    var K=null,ix=null;
    if(a.subj){
      K=kindOf(a.subj);
      if(cx.binds[K.name])ix=cx.binds[K.name];
    }else{
      if(cx.hit){K=cx.hit.A;ix=cx.hit.a}
      else if(cx.each){K=cx.each;ix=cx.binds[K.name]}
      else throw E(a.tok,'Say which thing: '+(KL[0]?KL[0].name:'hero')+' '+verb+(verb==='mv'||verb==='vel'||verb==='to'?' 1, 0':verb==='frame'?' 2':'')+(verb==='remove'||verb==='block'||verb==='bounce'||verb==='frame'?' (or '+verb+' '+(KL[0]?KL[0].name:'hero')+')':'')+' — outside on hit / each, an action needs its thing');
    }
    return{K:K,ix:ix};
  }
  function act(a,cx,ind){
    var at=a.tok,S;
    function W(s){L(ind+s,at)}
    function withSubj(verb,f){
      S=subject(a,cx,verb);
      if(S.ix){f(S.K,S.ix);return}
      needFind.add(S.K);
      var v='__lg_s'+(phn++);
      W('let '+v+' = __lg_find_'+S.K.name+'()');
      W('if ('+v+' >= 0) {');ind+='  ';f(S.K,v);ind=ind.slice(2);W('}');
    }
    switch(a.verb){
      case'mv':withSubj('mv',function(K,ix){W(R(K,ix)+'.x += '+X(a.x,cx));W(R(K,ix)+'.y += '+X(a.y,cx))});break;
      case'vel':withSubj('vel',function(K,ix){W(R(K,ix)+'.vx = '+X(a.x,cx));W(R(K,ix)+'.vy = '+X(a.y,cx))});break;
      case'to':withSubj('to',function(K,ix){var tx=X(a.x,cx),ty=X(a.y,cx);W(R(K,ix)+'.x = '+tx);W(R(K,ix)+'.y = '+ty);W(R(K,ix)+'.px = '+R(K,ix)+'.x');W(R(K,ix)+'.py = '+R(K,ix)+'.y')});break;
      case'frame':withSubj('frame',function(K,ix){W(R(K,ix)+'.frame = '+X(a.value,cx))});break;
      case'remove':withSubj('remove',function(K,ix){W(R(K,ix)+'.alive = false')});break;
      case'block':case'bounce':withSubj(a.verb,function(K,ix){
        var neg=a.verb==='bounce'?'true':'false';
        needBlock.add(K);
        var h=cx.hit,other=null;
        if(h&&ix===h.a)other=h.B?{K:h.B,ix:h.b}:h.other;
        else if(h&&ix===h.b)other={K:h.A,ix:h.a};
        if(other&&other.K)W('__lg_blockB_'+K.name+'('+ix+', '+R(other.K,other.ix)+'.x, '+R(other.K,other.ix)+'.y, '+R(other.K,other.ix)+'.w, '+R(other.K,other.ix)+'.h, '+neg+')');
        else if(other==='wall'){solidUsed();W('__lg_blockW_'+K.name+'('+ix+', '+neg+')')}
        else if(other==='edge')W('__lg_blockE_'+K.name+'('+ix+', '+neg+')');
        else W('__lg_blockP_'+K.name+'('+ix+', '+neg+')');
      });break;
      case'spawn':{
        var K=kindOf(a.kind);
        var x=a.x?X(a.x,cx):'0.0',y=a.y?X(a.y,cx):'0.0',vx=a.vx?X(a.vx,cx):'0.0',vy=a.vy?X(a.vy,cx):'0.0';
        W('__lg_spawn_'+K.name+'('+x+', '+y+', '+vx+', '+vy+', '+(a.x?'false':'true')+')');
        break;
      }
      case'set':case'add':{
        var op=a.verb==='set'?' = ':' += ',val=X(a.value,cx);
        if(a.field){
          var TK=kindOf(a.target),f=a.field.value;
          if(_LG_BASE_FIELDS.indexOf(f)<0&&!TK.fieldSet.has(f)&&!(TK.track&&(f==='fx'||f==='fy'))){var hh=_emitModClosest(f,_LG_BASE_FIELDS.concat(TK.fields.map(function(z){return z.name})));throw E(a.field,'thing '+TK.name+' has no field "'+f+'"'+(hh?' — did you mean "'+hh+'"?':''))}
          if(f==='alive')throw E(a.field,'Use remove / spawn to change whether a thing is alive');
          if(cx.binds[TK.name]){W(R(TK,cx.binds[TK.name])+'.'+f+op+val)}
          else{needFind.add(TK);var v2='__lg_s'+(phn++);W('let '+v2+' = __lg_find_'+TK.name+'()');W('if ('+v2+' >= 0) { '+R(TK,v2)+'.'+f+op+val+' }')}
        }else{
          var nm=a.target.value;
          if(kinds.has(nm))throw E(a.target,'"'+nm+'" is a thing — '+a.verb+' one of its fields: '+a.verb+' '+nm+'.x 10');
          if(nm==='i')throw E(a.target,'i is the number of the thing involved — it cannot be changed');
          if(!userVars.has(nm)){
            if(userFns.has(nm))throw E(a.target,'"'+nm+'" is a function — '+a.verb+' needs a variable');
            if(!autoVars.has(nm))autoVars.set(nm,a.target);
          }
          W('@'+nm+op+val);
        }
        break;
      }
      case'play':case'music':W('__lgPlay('+q(a.name)+', '+(a.verb==='music'?1:0)+')');break;
      case'say':W('__lgSay("" + '+X(a.value,cx)+')');break;
      case'restart':if(cx.start)throw E(at,'restart cannot be an action of on start — it would start again forever');W('__lg_init()');W('return;');break;
      case'stop':if(cx.start)throw E(at,'stop cannot be an action of on start');hasStop=true;W('__lg_on = false');W('__lg_hold = true');W('return;');break;
      case'call':{
        if(a.callExpr){W(X(a.callExpr,cx));break}
        var fn=a.fn.value,fd=userFns.get(fn),idx=[];
        if(cx.hit){idx.push(cx.hit.a);if(cx.hit.B)idx.push(cx.hit.b)}
        else if(cx.each)idx.push(cx.binds[cx.each.name]);
        if(!fd){
          if(kinds.has(fn))throw E(a.fn,'"'+fn+'" is a thing, not a function');
          if(!hasImports){var hf=_emitModClosest(fn,Array.from(userFns.keys()));throw E(a.fn,'Unknown function "'+fn+'"'+(hf?' — did you mean "'+hf+'"?':' — declare it in this file: fn '+fn+'() { … }'))}
          W('@'+fn+'()');break;
        }
        var np=(fd.params||[]).length;
        if(np>idx.length)throw E(a.fn,'call '+fn+': '+fn+'() takes '+np+' parameter'+(np>1?'s':'')+', but this rule has '+(idx.length?idx.length+' thing number'+(idx.length>1?'s':'')+' to pass ('+(cx.hit?'on hit passes the two things involved':'each passes its thing')+')':'no thing to pass (only on hit and each pass the numbers of their things)'));
        W('@'+fn+'('+idx.slice(0,np).join(', ')+')');
        break;
      }
    }
  }
  function acts(r,cx,ind){r.actions.forEach(function(a){act(a,cx,ind)})}
  // ── declarations ──
  KL.forEach(function(K){
    var at=K.decl.loc,f=['alive: bool','x: num','y: num','vx: num','vy: num','w: num','h: num','px: num','py: num','frame: num','dir: num'];
    if(K.track)f.push('fx: num','fy: num');
    K.fields.forEach(function(x){f.push(x.name+': num')});
    L('struct '+K.struct+' { '+f.join(', ')+' }',at);
    L('region @'+K.name+': '+K.struct+'['+K.cap+']',at);
  });
  L('import fn __lgIn(k: int) num from "__js__"');
  L('import fn __lgFrame(tick: num, on: int) from "__js__"');
  L('import fn __lgSay(s: str) from "__js__"');
  L('import fn __lgPlay(name: str, music: int) from "__js__"');
  L('import fn __lgShow(slot: int, v: num) from "__js__"');
  L('import fn __lgStart(seeded: int) int from "__js__"');
  L('mut __lg_on = true');L('mut __lg_hold = false');L('mut __lg_tick = 0');L('mut __lg_seed = 0');L('mut __lg_W = '+lit(stage.w));L('mut __lg_H = '+lit(stage.h));
  L('fn __lg_rnd(n: num) num {');
  L('  __lg_seed = __lg_seed * 6364136223846793005 + 1442695040888963407');
  L('  let r = (__lg_seed >> 33) & 2147483647');
  L('  return r * n / 2147483648.0');
  L('}');
  // per-kind helpers
  var helperAt={};
  KL.forEach(function(K){
    var at=K.decl.loc,cx={binds:{},i:'__lgv_k'};cx.binds[K.name]='__lgv_k';
    var sh=K.shape;
    L('fn __lg_new_'+K.name+'(k: int) {',at);
    L('  '+R(K,'k')+'.alive = true',at);
    var w,h;
    if(K.size){w=X(K.size.w,cx);h=X(K.size.h,cx)}
    else if(sh.kind==='circ'){var rr=X(sh.r,cx);w='2.0 * '+rr;h=null;L('  '+R(K,'k')+'.w = '+w,sh.tok);L('  '+R(K,'k')+'.h = '+R(K,'k')+'.w',sh.tok)}
    else if(sh.kind==='sprite'){w='__lgSpr('+K.idx+', 0)';h='__lgSpr('+K.idx+', 1)';helperAt.spr=true}
    else if(sh.w){w=X(sh.w,cx);h=X(sh.h,cx)}
    else{w='16.0';h='16.0'}
    if(h!==null){L('  '+R(K,'k')+'.w = '+w,K.size?K.size.tok:sh.tok);L('  '+R(K,'k')+'.h = '+h,K.size?K.size.tok:sh.tok)}
    if(K.at){L('  '+R(K,'k')+'.x = '+X(K.at.x,cx),K.at.tok);L('  '+R(K,'k')+'.y = '+X(K.at.y,cx),K.at.tok)}
    else{L('  '+R(K,'k')+'.x = 0.0');L('  '+R(K,'k')+'.y = 0.0')}
    L('  '+R(K,'k')+'.vx = 0.0');L('  '+R(K,'k')+'.vy = 0.0');
    L('  '+R(K,'k')+'.px = '+R(K,'k')+'.x');L('  '+R(K,'k')+'.py = '+R(K,'k')+'.y');
    L('  '+R(K,'k')+'.frame = '+(sh.kind==='sprite'?'-1.0':'0.0'));L('  '+R(K,'k')+'.dir = 1.0');
    if(K.track){L('  '+R(K,'k')+'.fx = 1.0');L('  '+R(K,'k')+'.fy = 0.0')}
    K.fields.forEach(function(fl){L('  '+R(K,'k')+'.'+fl.name+' = '+X(fl.value,cx),fl.tok)});
    K.beh.forEach(function(b){if(b.kind==='patrol')L('  '+R(K,'k')+'.vx = '+spd(K,b,cx),b.tok)});
    L('}',at);
    L('fn __lg_spawn_'+K.name+'(x: num, y: num, vx: num, vy: num, useAt: bool) int {',at);
    L('  for (let k = 0; k < '+K.cap+'; k++) {',at);
    L('    if (!'+R(K,'k')+'.alive) {',at);
    L('      __lg_new_'+K.name+'(k)',at);
    L('      if (!useAt) { '+R(K,'k')+'.x = x\n '+R(K,'k')+'.y = y\n '+R(K,'k')+'.px = x\n '+R(K,'k')+'.py = y }',at);
    L('      if (vx != 0.0 || vy != 0.0) { '+R(K,'k')+'.vx = vx\n '+R(K,'k')+'.vy = vy }',at);
    L('      return k',at);
    L('    }',at);L('  }',at);L('  return -1',at);L('}',at);
  });
  function spd(K,b,cx){return b.speed?X(b.speed,cx):(K.fieldSet.has('speed')?R(K,'k')+'.speed':'1.0')}
  // ── update ──
  var U=[];   // collected later into __lg_update: we generate it in place
  L('fn __lg_update() {');
  // 1. remember positions, behaviours
  KL.forEach(function(K){
    var at=K.decl.loc,cx={binds:{},i:'__lgv_k'};cx.binds[K.name]='__lgv_k';
    L('  for (let k = 0; k < '+K.cap+'; k++) {',at);
    L('    if ('+R(K,'k')+'.alive) {',at);
    L('      '+R(K,'k')+'.px = '+R(K,'k')+'.x',at);
    L('      '+R(K,'k')+'.py = '+R(K,'k')+'.y',at);
    K.beh.forEach(function(b){
      var T=b.T,bt=b.tok,u='_'+(phn++);
      if(b.kind==='chase'||b.kind==='flee'||b.kind==='track'){
        var same=T===K;
        L('      let bt'+u+' = -1',bt);L('      let bd'+u+' = 1000000000000000.0',bt);
        L('      for (let t = 0; t < '+T.cap+'; t++) {',bt);
        L('        if ('+R(T,'t')+'.alive'+(same?' && t != k':'')+') {',bt);
        L('          let ddx'+u+' = '+R(T,'t')+'.x - '+R(K,'k')+'.x',bt);L('          let ddy'+u+' = '+R(T,'t')+'.y - '+R(K,'k')+'.y',bt);
        L('          let dd'+u+' = ddx'+u+' * ddx'+u+' + ddy'+u+' * ddy'+u+'',bt);
        L('          if (dd'+u+' < bd'+u+') { bd'+u+' = dd'+u+'\n bt'+u+' = t }',bt);
        L('        }',bt);L('      }',bt);
        L('      if (bt'+u+' >= 0) {',bt);
        L('        let dx'+u+' = '+R(T,'bt'+u+'')+'.x + '+R(T,'bt'+u+'')+'.w / 2.0 - '+R(K,'k')+'.x - '+R(K,'k')+'.w / 2.0',bt);
        L('        let dy'+u+' = '+R(T,'bt'+u+'')+'.y + '+R(T,'bt'+u+'')+'.h / 2.0 - '+R(K,'k')+'.y - '+R(K,'k')+'.h / 2.0',bt);
        L('        let d'+u+' = sqrt(dx'+u+' * dx'+u+' + dy'+u+' * dy'+u+')',bt);
        L('        if (d'+u+' > 0.0001) {',bt);
        if(b.kind==='track'){L('          '+R(K,'k')+'.fx = dx'+u+' / d'+u+'',bt);L('          '+R(K,'k')+'.fy = dy'+u+' / d'+u+'',bt)}
        else{var s=spd(K,b,cx),sg=b.kind==='flee'?'-':'';L('          '+R(K,'k')+'.vx = '+sg+'dx'+u+' / d'+u+' * '+s,bt);L('          '+R(K,'k')+'.vy = '+sg+'dy'+u+' / d'+u+' * '+s,bt)}
        L('        }',bt);L('      }',bt);
      }else if(b.kind==='wander'){
        L('      if (__lg_rnd(1.0) < 0.02 || ('+R(K,'k')+'.vx == 0.0 && '+R(K,'k')+'.vy == 0.0)) {',bt);
        L('        let wa'+u+' = __lg_rnd(6.283185307179586)',bt);
        var ws=spd(K,b,cx);
        L('        '+R(K,'k')+'.vx = cos(wa'+u+') * '+ws,bt);L('        '+R(K,'k')+'.vy = sin(wa'+u+') * '+ws,bt);
        L('      }',bt);
      }else if(b.kind==='patrol'){
        L('      if ('+R(K,'k')+'.vx == 0.0) { '+R(K,'k')+'.vx = '+spd(K,b,cx)+' }',bt);
      }
    });
    if(K.gravity)L('      '+R(K,'k')+'.vy += '+X(K.gravity.g,cx),K.gravity.tok);
    L('    }',at);L('  }',at);
  });
  // 2. rules except on hit / when, in their order
  var ruleNo=0,stateVars=[],timerVars=[];
  rules.forEach(function(r){
    if(r.dir)return;
    var n=ruleNo++,at=r.tok;
    r.n=n;
    if(r.ev==='hit'||r.ev==='when'||r.ev==='start')return;
    var cx={binds:{}},I='    ';
    switch(r.ev){
      case'frame':acts(r,cx,'  ');break;
      case'every':timerVars.push('__lg_t'+n);L('  __lg_t'+n+' += 1',at);L('  if (__lg_t'+n+' >= '+r.frames+') {',at);L('    __lg_t'+n+' = 0',at);acts(r,cx,I);L('  }',at);break;
      case'key':case'keydown':case'keyup':case'press':case'hold':case'tap':case'touch':{
        var code=r.key?100+r.key.code:r.btn?{A:5,B:6,C:7}[r.btn.btn]:4;
        var cond='__lgIn('+code+') > 0.5';
        if(r.ev==='key'||r.ev==='hold'||r.ev==='touch'){L('  if ('+cond+') {',at);acts(r,cx,I);L('  }',at);break}
        var sv='__lg_e'+n;stateVars.push(sv);
        if(r.ev==='keyup'){L('  if ('+cond+') { '+sv+' = true } else {',at);L('    if ('+sv+') {',at);L('      '+sv+' = false',at);acts(r,cx,'      ');L('    }',at);L('  }',at);break}
        L('  if ('+cond+') {',at);L('    if (!'+sv+') {',at);L('      '+sv+' = true',at);acts(r,cx,'      ');L('    }',at);L('  } else { '+sv+' = false }',at);
        break;
      }
      case'each':{
        var K=kindOf(r.kind),k='__lg_k'+n,cx2={binds:{},i:k,each:K};cx2.binds[K.name]=k;
        L('  for (let '+k+' = 0; '+k+' < '+K.cap+'; '+k+'++) {',at);
        L('    if ('+R(K,k)+'.alive) {',at);
        if(r.cond){L('      if ('+X(r.cond,cx2)+') {',at);acts(r,cx2,'        ');L('      }',at)}
        else acts(r,cx2,'      ');
        L('    }',at);L('  }',at);
        break;
      }
    }
  });
  // 3. move
  KL.forEach(function(K){
    var at=K.decl.loc,k='k',P=R(K,k);
    L('  for (let k = 0; k < '+K.cap+'; k++) {',at);
    L('    if ('+P+'.alive) {',at);
    L('      '+P+'.x += '+P+'.vx',at);L('      '+P+'.y += '+P+'.vy',at);
    var patrol=K.beh.some(function(b){return b.kind==='patrol'}),bnc=!!K.flags.bounce;
    if(K.flags.solid||patrol||bnc){
      var neg=patrol||bnc;
      L('      if (__lg_solid('+P+'.x, '+P+'.py, '+P+'.w, '+P+'.h)) { '+P+'.x = '+P+'.px\n '+P+'.vx = '+(neg?'-'+P+'.vx':'0.0')+' }',at);
      L('      if (__lg_solid('+P+'.x, '+P+'.y, '+P+'.w, '+P+'.h)) { '+P+'.y = '+P+'.py\n '+P+'.vy = '+(bnc?'-'+P+'.vy':'0.0')+' }',at);
    }
    if(patrol||bnc){
      L('      if ('+P+'.x < 0.0 || '+P+'.x + '+P+'.w > __lg_W) { '+P+'.x = '+P+'.px\n '+P+'.vx = -'+P+'.vx }',at);
      if(bnc)L('      if ('+P+'.y < 0.0 || '+P+'.y + '+P+'.h > __lg_H) { '+P+'.y = '+P+'.py\n '+P+'.vy = -'+P+'.vy }',at);
    }
    if(K.flags.wrap){
      L('      if ('+P+'.x < -'+P+'.w) { '+P+'.x = __lg_W\n '+P+'.px = '+P+'.x } else { if ('+P+'.x > __lg_W) { '+P+'.x = -'+P+'.w\n '+P+'.px = '+P+'.x } }',at);
      L('      if ('+P+'.y < -'+P+'.h) { '+P+'.y = __lg_H\n '+P+'.py = '+P+'.y } else { if ('+P+'.y > __lg_H) { '+P+'.y = -'+P+'.h\n '+P+'.py = '+P+'.y } }',at);
    }
    L('      if ('+P+'.x < '+P+'.px) { '+P+'.dir = -1.0 } else { if ('+P+'.x > '+P+'.px) { '+P+'.dir = 1.0 } }',at);
    L('    }',at);L('  }',at);
    K.beh.forEach(function(b){
      if(b.kind!=='follow')return;
      var T=b.T,bt=b.tok,gap=b.gap?X(b.gap,{binds:{},i:null}):null;
      L('  let __lg_fl'+K.idx+' = -1',bt);
      L('  for (let k = 0; k < '+K.cap+'; k++) {',bt);
      L('    if ('+P+'.alive) {',bt);
      L('      let lx = 0.0\n let ly = 0.0\n let ok = false',bt);
      L('      if (__lg_fl'+K.idx+' >= 0) { lx = '+R(K,'__lg_fl'+K.idx)+'.x\n ly = '+R(K,'__lg_fl'+K.idx)+'.y\n ok = true } else {',bt);
      needFind.add(T);
      L('        let li = __lg_find_'+T.name+'()',bt);
      L('        if (li >= 0'+(T===K?' && li != k':'')+') { lx = '+R(T,'li')+'.x\n ly = '+R(T,'li')+'.y\n ok = true }',bt);
      L('      }',bt);
      L('      if (ok) {',bt);
      L('        let g = '+(gap||P+'.w'),bt);
      L('        let dx = lx - '+P+'.x\n let dy = ly - '+P+'.y\n let d = sqrt(dx * dx + dy * dy)',bt);
      L('        if (d > g) { '+P+'.x += dx * (d - g) / d\n '+P+'.y += dy * (d - g) / d }',bt);
      L('        '+P+'.vx = 0.0\n '+P+'.vy = 0.0',bt);
      L('      }',bt);
      L('      __lg_fl'+K.idx+' = k',bt);
      L('    }',bt);L('  }',bt);
    });
  });
  // 4. on hit
  rules.forEach(function(r){
    if(r.ev!=='hit')return;
    var n=r.n,at=r.tok,A=kindOf(r.a,' in on hit'),bw=r.b.value,a='__lg_a'+n,b='__lg_b'+n;
    var B=(bw==='wall'||bw==='edge')?null:kindOf(r.b,' in on hit (or wall: a solid map tile / wall thing, edge: the screen edge)');
    var cx={binds:{},i:a,hit:{A:A,B:B,a:a,b:B?b:null,other:B?null:bw}};
    cx.binds[A.name]=a;if(B&&B!==A)cx.binds[B.name]=b;
    var PA=R(A,a);
    L('  for (let '+a+' = 0; '+a+' < '+A.cap+'; '+a+'++) {',at);
    L('    if ('+PA+'.alive) {',at);
    if(B){
      var PB=R(B,b);
      L('      for (let '+b+' = '+(A===B?a+' + 1':'0')+'; '+b+' < '+B.cap+'; '+b+'++) {',at);
      L('        if ('+PB+'.alive && '+PA+'.alive) {',at);
      L('          if ('+PA+'.x < '+PB+'.x + '+PB+'.w && '+PB+'.x < '+PA+'.x + '+PA+'.w && '+PA+'.y < '+PB+'.y + '+PB+'.h && '+PB+'.y < '+PA+'.y + '+PA+'.h) {',at);
      acts(r,cx,'            ');
      L('          }',at);L('        }',at);L('      }',at);
    }else if(bw==='wall'){
      solidUsed();
      L('      if (__lg_solid('+PA+'.x - 0.5, '+PA+'.y - 0.5, '+PA+'.w + 1.0, '+PA+'.h + 1.0)) {',at);acts(r,cx,'        ');L('      }',at);
    }else{
      L('      if ('+PA+'.x < 0.0 || '+PA+'.y < 0.0 || '+PA+'.x + '+PA+'.w > __lg_W || '+PA+'.y + '+PA+'.h > __lg_H) {',at);acts(r,cx,'        ');L('      }',at);
    }
    L('    }',at);L('  }',at);
  });
  // 5. when
  rules.forEach(function(r){
    if(r.ev!=='when')return;
    var n=r.n,at=r.tok,sv='__lg_w'+n;stateVars.push(sv);
    L('  if ('+X(r.cond,{binds:{}})+') {',at);L('    if (!'+sv+') {',at);L('      '+sv+' = true',at);acts(r,{binds:{}},'      ');L('    }',at);L('  } else { '+sv+' = false }',at);
  });
  L('}');
  // init / start
  L('fn __lg_init() {');
  L('  __lg_W = __lgIn(10)');L('  __lg_H = __lgIn(11)');
  L('  let sd = __lgStart('+(seed===null?0:1)+')');
  if(seed!==null)L('  __lg_seed = '+seed);else L('  __lg_seed = sd');
  L('  __lg_on = true');L('  __lg_hold = false');
  stateVars.forEach(function(v){L('  '+v+' = false')});
  timerVars.forEach(function(v){L('  '+v+' = 0')});
  autoVars.forEach(function(t,nm){L('  @'+nm+' = '+(autoNum.has(nm)?'0.0':'0'),t)});
  KL.forEach(function(K){
    var at=K.decl.loc;
    L('  wipe(@'+K.name+')',at);
    if(K.alive0>0){L('  for (let k = 0; k < '+K.alive0+'; k++) { __lg_new_'+K.name+'(k) }',at)}
    if(K.map){
      L('  let mn'+K.idx+' = __lgMapQ('+K.idx+')',K.map);
      L('  for (let j = 0; j < mn'+K.idx+'; j++) {',K.map);
      L('    let s = __lg_spawn_'+K.name+'(__lgMapAt(j, 0), __lgMapAt(j, 1), 0.0, 0.0, false)',K.map);
      K.fields.forEach(function(fl){L('    if (s >= 0) { '+R(K,'s')+'.'+fl.name+' = __lgMapProp(j, '+q(fl.name)+', '+R(K,'s')+'.'+fl.name+') }',K.map)});
      L('  }',K.map);
    }
  });
  rules.forEach(function(r){if(r.ev==='start')acts(r,{binds:{},start:true},'  ')});
  L('}');
  L('fn __lg_step() {');
  L('  __lg_tick += 1');
  L('  if (__lg_on) { __lg_update() } else {');
  L('    let p = __lgIn(4) > 0.5 || __lgIn(5) > 0.5 || __lgIn(132) > 0.5 || __lgIn(113) > 0.5');
  L('    if (p && !__lg_hold) { __lg_init() }');
  L('    __lg_hold = p');
  L('  }');
  showLabels.forEach(function(s,i){L('  __lgShow('+i+', '+X(s.e,{binds:{}})+')',s.e.loc)});
  L('  if (__lg_on) { __lgFrame(__lg_tick, 1) } else { __lgFrame(__lg_tick, 0) }');
  L('}');
  L('fn __lg_game() {');
  if(!usesCanvas)L('  canvas('+stage.w+', '+stage.h+')');
  if(stage.controls)L('  useControls('+stage.controls+')',stage.controlsTok&&{line:stage.controlsTok.line,col:stage.controlsTok.col});
  L('  __lg_init()');L('  animate()');L('}');
  L('fn __lg_frame() { __lg_step() }');
  // helpers that were asked for
  KL.forEach(function(K){
    var at=K.decl.loc,P=R(K,'k');
    if(needFind.has(K)||needFirst.has(K)){
      L('fn __lg_find_'+K.name+'() int {',at);L('  for (let k = 0; k < '+K.cap+'; k++) { if ('+P+'.alive) { return k } }',at);L('  return -1',at);L('}',at);
    }
    if(needFirst.has(K)){L('fn __lg_first_'+K.name+'() int {',at);L('  let k = __lg_find_'+K.name+'()',at);L('  if (k < 0) { return 0 }',at);L('  return k',at);L('}',at)}
    if(needCount.has(K)){L('fn __lg_count_'+K.name+'() int {',at);L('  let c = 0',at);L('  for (let k = 0; k < '+K.cap+'; k++) { if ('+P+'.alive) { c += 1 } }',at);L('  return c',at);L('}',at)}
    if(needBlock.has(K)){
      // undo the move into a box (per axis, from where the thing was before this frame's move)
      L('fn __lg_blockB_'+K.name+'(k: int, ox: num, oy: num, ow: num, oh: num, neg: bool) {',at);
      L('  let hx = '+P+'.px < ox + ow && ox < '+P+'.px + '+P+'.w',at);
      L('  let hy = '+P+'.py < oy + oh && oy < '+P+'.py + '+P+'.h',at);
      L('  if (hx && !hy) { '+P+'.y = '+P+'.py\n if (neg) { '+P+'.vy = -'+P+'.vy } else { '+P+'.vy = 0.0 } } else {',at);
      L('    if (hy && !hx) { '+P+'.x = '+P+'.px\n if (neg) { '+P+'.vx = -'+P+'.vx } else { '+P+'.vx = 0.0 } } else {',at);
      L('      '+P+'.x = '+P+'.px\n '+P+'.y = '+P+'.py\n if (neg) { '+P+'.vx = -'+P+'.vx\n '+P+'.vy = -'+P+'.vy } else { '+P+'.vx = 0.0\n '+P+'.vy = 0.0 }',at);
      L('    }',at);L('  }',at);L('}',at);
      L('fn __lg_blockW_'+K.name+'(k: int, neg: bool) {',at);
      L('  if (__lg_solid('+P+'.x, '+P+'.py, '+P+'.w, '+P+'.h)) { '+P+'.x = '+P+'.px\n if (neg) { '+P+'.vx = -'+P+'.vx } else { '+P+'.vx = 0.0 } }',at);
      L('  if (__lg_solid('+P+'.x, '+P+'.y, '+P+'.w, '+P+'.h)) { '+P+'.y = '+P+'.py\n if (neg) { '+P+'.vy = -'+P+'.vy } else { '+P+'.vy = 0.0 } }',at);
      L('}',at);
      L('fn __lg_blockE_'+K.name+'(k: int, neg: bool) {',at);
      L('  if ('+P+'.x < 0.0) { '+P+'.x = 0.0\n if (neg) { '+P+'.vx = -'+P+'.vx } else { '+P+'.vx = 0.0 } }',at);
      L('  if ('+P+'.x + '+P+'.w > __lg_W) { '+P+'.x = __lg_W - '+P+'.w\n if (neg) { '+P+'.vx = -'+P+'.vx } else { '+P+'.vx = 0.0 } }',at);
      L('  if ('+P+'.y < 0.0) { '+P+'.y = 0.0\n if (neg) { '+P+'.vy = -'+P+'.vy } else { '+P+'.vy = 0.0 } }',at);
      L('  if ('+P+'.y + '+P+'.h > __lg_H) { '+P+'.y = __lg_H - '+P+'.h\n if (neg) { '+P+'.vy = -'+P+'.vy } else { '+P+'.vy = 0.0 } }',at);
      L('}',at);
      L('fn __lg_blockP_'+K.name+'(k: int, neg: bool) {',at);
      L('  '+P+'.x = '+P+'.px\n '+P+'.y = '+P+'.py',at);
      L('  if (neg) { '+P+'.vx = -'+P+'.vx\n '+P+'.vy = -'+P+'.vy } else { '+P+'.vx = 0.0\n '+P+'.vy = 0.0 }',at);
      L('}',at);
    }
  });
  if(needSolid||needBlock.size){
    L('fn __lg_solid(x: num, y: num, w: num, h: num) bool {');
    if(stage.map)L('  if (__lgSolid(x, y, w, h)) { return true }');
    wallKinds.forEach(function(K){
      var P=R(K,'k');
      L('  for (let k = 0; k < '+K.cap+'; k++) { if ('+P+'.alive) { if (x < '+P+'.x + '+P+'.w && '+P+'.x < x + w && y < '+P+'.y + '+P+'.h && '+P+'.y < y + h) { return true } } }',K.flags.wall.tok);
    });
    L('  return false');L('}');
  }
  if(stage.map)L('import fn __lgSolid(x: num, y: num, w: num, h: num) bool from "__js__"');
  if(helperAt.spr)L('import fn __lgSpr(kind: int, what: int) num from "__js__"');
  if(KL.some(function(K){return K.map}))L('import fn __lgMapQ(kind: int) int from "__js__"'),L('import fn __lgMapAt(j: int, what: int) num from "__js__"'),L('import fn __lgMapProp(j: int, name: str, v: num) num from "__js__"');
  stateVars.forEach(function(v){L('mut '+v+' = false')});
  timerVars.forEach(function(v){L('mut '+v+' = 0')});
  // auto-declared globals (set / add of a name this file does not declare)
  autoVars.forEach(function(t,nm){
    if(/^__lg/.test(nm))throw E(t,'Names starting with __lg are reserved');
    L('mut @'+nm+' = '+(autoNum.has(nm)?'0.0':'0'),t);
  });
  // ── parse, position, splice ──
  // generated locals and parameters get a reserved prefix (k → __lgv_k); kind and user names were written
  // with an @ in front so they are left alone (a thing may be called k, x or d)
  var LOCALS=/^(k|t|j|s|p|sd|c|x|y|vx|vy|useAt|ox|oy|ow|oh|neg|hx|hy|w|h|n|r|lx|ly|ok|li|g|dx|dy|d|wa|bt|bd|dd|ddx|ddy|(?:bt|bd|dd|ddx|ddy|dx|dy|d|wa)_\d+|mn\d+)$/;
  var src=lines.map(function(ln){
    if(/^struct /.test(ln))return ln.replace(/@/g,'');
    return ln.replace(/"(?:[^"\\]|\\.)*"|(@?)([A-Za-z_]\w*)/g,function(m,at,id,off,all){
      if(!id)return m;
      if(at)return id;
      if(off>0&&all[off-1]==='.')return m;
      return LOCALS.test(id)?'__lgv_'+id:m;
    });
  }).join('\n'),gen;
  _lgLower.lastSource=src;   // the generated Emit text (for the tests and for curious users: _lgLower.lastSource)
  try{gen=new Parser(new Lexer(src).tokenize()).parse()}
  catch(e){var m=/^(\d+):(\d+): ([\s\S]*)$/.exec(String(e&&e.message));var al=m?anchors[Number(m[1])-1]:null;throw E(al||anchor,'(generated code'+(m?' line '+m[1]:'')+') '+(m?m[3]:String(e&&e.message)))}
  (function pos(x){
    if(!x||typeof x!=='object')return;
    if(Array.isArray(x)){x.forEach(pos);return}
    for(var k in x){
      var v=x[k];
      if(!v||typeof v!=='object')continue;
      if((k==='loc'||k==='aliasLoc')&&typeof v.line==='number'){var a=anchors[v.line-1]||anchor;x[k]={line:a.line,col:a.col}}
      else pos(v);
    }
  })(gen.body);
  (function splice(x){
    if(!x||typeof x!=='object')return;
    if(Array.isArray(x)){for(var i=0;i<x.length;i++){var v=x[i];if(v&&v.type==='IdentifierExpr'&&ph[v.name])x[i]=clone(ph[v.name]);else splice(v)}return}
    for(var k in x){
      var w=x[k];
      if(!w||typeof w!=='object'||k==='loc')continue;
      if(w.type==='IdentifierExpr'&&ph[w.name])x[k]=clone(ph[w.name]);
      else splice(w);
    }
  })(gen.body);
  var meta={v:1,stage:stage,kinds:KL.map(function(K){
    var sh=K.shape,c=sh.color?(_LG_COLORS[sh.color.value]||sh.color.value):'#ffffff';
    return{name:K.name,struct:K.struct,shape:sh.kind,color:c,sprite:sh.sprite?sh.sprite.value:null,map:K.map?K.map.value:null,track:K.track,fields:K.fields.map(function(f){return f.name})};
  }),shows:showLabels.map(function(s){return s.label}),seeded:seed!==null,stop:hasStop};
  var out=[];
  body.forEach(function(n){if(n&&n.type!=='ThingDecl'&&n.type!=='RulesDecl')out.push(n)});
  gen.body.forEach(function(n){
    if(n.type==='FunctionDecl'){
      if(n.name==='__lg_game'){n.lgExport='game';n.lgMeta=meta}
      else if(n.name==='__lg_frame'){n.lgExport='frame'}
      else if(n.name==='__lg_step')n.lgStep=true;
    }
    n.lgGen=true;
    out.push(n);
  });
  prog.body=out;
  prog.lgUserFrame=userFrame;
  return prog;
}
// int-only operators (% & | ^ << >>) where a num is expected (`x = k % 3` into a num variable or struct field,
// as the generated thing code does with `at (i * 37) % 320 …`): computed on int, then converted. Without this
// the operands were widened to num, for which there is no such instruction, and the module did not validate —
// so only programs that could not run before compile differently.
(function(){
  var gb=WasmCodegen.prototype.genBinary,INT_ONLY={'%':1,'&':1,'|':1,'^':1,'<<':1,'>>':1};
  WasmCodegen.prototype.genBinary=function(e,exp){
    if(e&&INT_ONLY[e.op]&&(exp==='num'||exp==='f64')&&this.inferOpType(e.left,e.right)!=='num'){gb.call(this,e,'int');this.emit(Op.f64_convert_i64_s);return}
    return gb.apply(this,arguments);
  };
})();
// ── thing / rules blocks in several files ──
// When the blocks of a project are in ONE file, that file is lowered while it is parsed (above), exactly as
// before. When two or more files have thing / rules blocks, _emitModFront parses every file with the lowering
// held back (_lgDefer): the ThingDecl / RulesDecl nodes go through the module linker untouched, and the wrapper
// below lowers all of them together in the merged program, after linking:
//   - thing kinds are project-wide names (like sprites, sounds and maps): a rules block or a thing in any file
//     may use a kind declared in any other file, and code in every file reaches a kind's region by its name
//     (hero[0].x). Two things of the same name are an error naming both places.
//   - names in a block's expressions and actions (set score …, call f, f(x), physics.speed) are resolved in
//     the block's own file, as code of that file would be (its own top-level names, its imports); a name no
//     file declares is an auto-declared global shared by every rules block (set score 0).
//   - rules: blocks of several files are concatenated in file order (the order of the project's files, the
//     entry file first) — one rules: block per file, as before. Their stage / seed settings must agree:
//     `stage size 320 240` in one file and `stage size 400 300` in another is an error naming both positions
//     (the same setting written twice is fine).
// Generated code takes positions from the blocks (file:line:col); the struct / region of a kind belong to the
// file of its thing block (Memory tab, LOGIC › link). Error positions: while lowering, the lines of each file's
// blocks are offset by (file number + 1) × 1000000 and mapped back afterwards.
var _lgDefer=false;
_lgLower=(function(low){return function(prog){
  if(_lgDefer){prog.lgDeferred=true;return prog}
  return low.apply(this,arguments);
}})(_lgLower);
_emitModFront=(function(front){return function(text){
  var n=0;
  try{_emitSplitBundle(String(text==null?'':text)).forEach(function(f){if(_emitScanBlocks(f.source).some(function(b){return b.kind==='thing'||b.kind==='rules'}))n++})}catch(e){n=0}
  if(n<2)return front.apply(this,arguments);
  var was=_lgDefer;_lgDefer=true;
  try{var fr=front.apply(this,arguments);fr.lgDeferred=true;return fr}
  finally{_lgDefer=was}
}})(_emitModFront);
_emitModLink=(function(link){return function(fr){
  var r=link.apply(this,arguments);
  if(!fr||!fr.lgDeferred||!r||!r.ast)return r;
  var body=r.ast.body,blocks=body.filter(function(n){return n&&(n.type==='ThingDecl'||n.type==='RulesDecl')});
  if(!blocks.length)return r;
  if(r.errors&&r.errors.length){r.ast.body=body.filter(function(n){return blocks.indexOf(n)<0});return r}
  var OFF=1000000,mods=fr.mods,byPath=new Map();
  mods.forEach(function(m,i){byPath.set(m.path,{m:m,k:i+1})});
  function modOf(n){return byPath.get(n.loc&&n.loc.file)||{m:mods[0],k:1}}
  function pos(m,t){return m.path+':'+((t&&t.line)||1)+':'+((t&&t.col)||1)}
  var kinds=new Set();blocks.forEach(function(b){if(b.type==='ThingDecl')kinds.add(b.name)});
  var warnDrop=new Set(),mangled=new Map(),stubs=[];
  // ── 1. names of each block, resolved in its own file ──
  // (a set / add / call action names its variable / function with a token that becomes generated source text,
  //  where game.score would read as a property: such a name is written as __emitR<n> and put back afterwards)
  blocks.forEach(function(b){
    var m=modOf(b).m;
    function used(imp){if(imp.used)return;imp.used=true;var l=imp.node.loc||{};warnDrop.add(fr.pre(m,l.line||1,l.col||1)+'Unused import '+imp.node.path.join('.')+(imp.kind==='star'?'.*':''))}
    function res(name){
      var d=m.decls&&m.decls.get(name);
      if(d)return d.kind==='raw'?name:d.internal;
      var imp=m.direct&&m.direct.get(name);
      if(imp&&imp.decl){used(imp);return imp.decl.internal}
      var st=m.stars||[];
      for(var i=0;i<st.length;i++){var t=st[i].target,c=t===m?null:t.decls.get(name);if(c&&c.kind!=='raw'&&c.pub){used(st[i]);return c.internal}}
      return null;
    }
    function retok(t){
      if(!t||kinds.has(t.value))return t;
      var nn=res(t.value);if(!nn||nn===t.value)return t;
      if(nn.indexOf('.')>=0){
        var mk=null;mangled.forEach(function(v,k){if(v===nn)mk=k});
        if(!mk){
          mk='__emitR'+mangled.size;mangled.set(mk,nn);
          var dd=null;mods.forEach(function(mm){if(mm.decls)mm.decls.forEach(function(x){if(x.internal===nn)dd=x})});
          if(dd&&dd.kind==='fn'){var sf=new FunctionDecl(mk,dd.node.params,dd.node.returnType,new BlockStmt([],dd.node.loc),false,dd.node.loc);stubs.push(sf)}
          else stubs.push(new VarDecl(mk,null,null,true,(dd&&dd.node.loc)||t));
        }
        nn=mk;
      }
      var c=Object.create(Object.getPrototypeOf(t));for(var k in t)if(Object.prototype.hasOwnProperty.call(t,k))c[k]=t[k];c.value=nn;return c;
    }
    (function fix(x,parent,key){
      if(!x||typeof x!=='object'||x instanceof Token)return;
      if(Array.isArray(x)){for(var i=0;i<x.length;i++)fix(x[i],x,i);return}
      if(x.type==='IdentifierExpr'){if(!kinds.has(x.name)&&x.name!=='i'){var nn=res(x.name);if(nn)x.name=nn}return}
      if(x.type==='MemberExpr'&&x.object&&x.object.type==='IdentifierExpr'&&!kinds.has(x.object.name)&&m.aliases&&m.aliases.has(x.object.name)&&parent){
        var imp=m.aliases.get(x.object.name),d=imp.target.decls.get(String(x.property));
        if(d&&d.kind!=='raw'&&(d.pub||imp.target===m)){used(imp);var ie=new IdentifierExpr(d.internal,x.loc);parent[key]=ie;return}
      }
      if(x.verb&&(x.verb==='set'||x.verb==='add')&&x.target&&!x.field)x.target=retok(x.target);
      if(x.verb==='call'&&x.fn)x.fn=retok(x.fn);
      for(var k in x){if(k==='loc'||k==='lgToks')continue;var v=x[k];if(v&&typeof v==='object')fix(v,x,k)}
    })(b,null,null);
  });
  if(warnDrop.size&&r.warnings)r.warnings=r.warnings.filter(function(w){return!warnDrop.has(w)});
  // ── 2. one rules block: concatenated in file order; stage / seed settings must agree ──
  var rules=blocks.filter(function(b){return b.type==='RulesDecl'}),errs=[];
  var first=new Map(),seenFile=new Map();
  function fold(e){var v=_rgTryFold(e);return v===null?'?':String(v)}
  rules.forEach(function(R){
    var mo=modOf(R).m;
    if(seenFile.has(mo)){var o=seenFile.get(mo);errs.push(pos(mo,R.loc)+': A file has one rules: block — put these rules into the rules: block at line '+o.loc.line);return}
    seenFile.set(mo,R);
    R.rules.forEach(function(x){
      if(!x||!x.dir||x.dir==='show')return;
      var key=x.dir==='stage'?'stage '+x.what:x.dir,val;
      if(x.dir==='seed')val=fold(x.n);
      else if(x.what==='size')val=fold(x.w)+' '+fold(x.h);
      else if(x.what==='color')val=String(x.color&&x.color.value);
      else if(x.what==='map')val=String(x.map&&x.map.value);
      else if(x.what==='controls')val=String(x.ctl&&x.ctl.value);
      else return;
      var p=first.get(key);
      if(!p){first.set(key,{val:val,m:mo,tok:x.tok});return}
      if(p.val!==val)errs.push(pos(mo,x.tok)+': '+key+' '+val+' contradicts '+key+' '+p.val+' at '+pos(p.m,p.tok)+' — a project has one '+(x.dir==='seed'?'seed':'stage')+': make the two the same or remove one');
    });
  });
  if(errs.length){r.errors=(r.errors||[]).concat(errs);r.ast.body=body.filter(function(n){return blocks.indexOf(n)<0});return r}
  // ── 3. lower the merged program; positions: per-file line offsets ──
  var touched=[],seen=new Set();
  blocks.forEach(function(b){
    var k=modOf(b).k;
    (function sh(x){
      if(!x||typeof x!=='object'||seen.has(x))return;
      seen.add(x);
      if(Array.isArray(x)){x.forEach(sh);return}
      if(typeof x.line==='number'&&x.line<OFF){x.line+=k*OFF;touched.push(x)}
      for(var key in x){var v=x[key];if(v&&typeof v==='object')sh(v)}
    })(b);
  });
  if(rules.length>1){
    var R0=rules[0];
    rules.slice(1).forEach(function(R){R0.rules=R0.rules.concat(R.rules)});
    r.ast.body=body=body.filter(function(n){return n.type!=='RulesDecl'||n===R0});
    blocks=blocks.filter(function(n){return n.type!=='RulesDecl'||n===R0});
  }
  function unshift(msg){
    return String(msg).replace(/^(\d+):(\d+): /,function(all,l,c){l=Number(l);if(l<OFF)return all;var mo=mods[Math.floor(l/OFF)-1];return(mo?mo.path+':':'')+(l%OFF)+':'+c+': '})
      .replace(/\b(\d{7,})\b/g,function(all,l){l=Number(l);var mo=mods[Math.floor(l/OFF)-1];return(l%OFF)+(mo?' of '+mo.path:'')});
  }
  var thingMod=new Map();blocks.forEach(function(b){if(b.type==='ThingDecl'&&!thingMod.has(b.name))thingMod.set(b.name,modOf(b).m)});
  var host=modOf(blocks.find(function(b){return b.type==='RulesDecl'})||blocks[0]).m;
  stubs.forEach(function(x){r.ast.body.push(x)});
  function unstub(){if(stubs.length)r.ast.body=r.ast.body.filter(function(n){return stubs.indexOf(n)<0})}
  try{_lgLower(r.ast);unstub()}
  catch(e){
    unstub();
    touched.forEach(function(x){x.line%=OFF});
    r.errors=(r.errors||[]).concat([unshift((e&&e.message)||e)]);
    r.ast.body=r.ast.body.filter(function(n){return n.type!=='ThingDecl'&&n.type!=='RulesDecl'});
    return r;
  }
  touched.forEach(function(x){x.line%=OFF});
  var seen2=new Set();
  r.ast.body.forEach(function(n){
    if(!n||!n.lgGen)return;
    if(n.type==='StructDecl'||n.type==='RegionDecl'){
      var kn=n.type==='StructDecl'?String(n.name).replace(/^__lgT_/,''):n.name,mo=thingMod.get(kn)||host;
      n.module=mo.name;n.path=mo.path;
    }
    (function fx(x){
      if(!x||typeof x!=='object'||seen2.has(x))return;
      seen2.add(x);
      if(Array.isArray(x)){x.forEach(fx);return}
      if(x.type==='IdentifierExpr'&&mangled.has(x.name))x.name=mangled.get(x.name);
      if(typeof x.line==='number'&&x.line>=OFF){var mo=mods[Math.floor(x.line/OFF)-1];x.line%=OFF;if(mo&&fr.multi&&x.file===undefined&&typeof x.col==='number'&&!(x instanceof Token))x.file=mo.path}
      for(var key in x){var v=x[key];if(v&&typeof v==='object')fx(v)}
    })(n);
  });
  return r;
}})(_emitModLink);
// After linking: the generated game / frame become the program's exported game() and frame() — also when the
// thing / rules blocks are in another file than the entry (game.emit). A frame() the program exports itself
// calls the generated step first instead.
_emitModLink=(function(link){return function(fr){
  var r=link.apply(this,arguments);
  if(!r||!r.ast||(r.errors&&r.errors.length))return r;
  var body=r.ast.body,gens=body.filter(function(n){return n&&n.type==='FunctionDecl'&&n.lgExport});
  if(!gens.length)return r;
  function at(n){var l=n.loc||{};return(fr&&fr.multi&&l.file?l.file+':':'')+(l.line||1)+':'+(l.col||1)+': '}
  var games=gens.filter(function(n){return n.lgExport==='game'});
  if(games.length>1){r.errors.push(at(games[1])+'thing / rules blocks are in two files ('+(games[0].loc.file||'')+' and '+(games[1].loc.file||'')+') — keep the game\'s thing and rules blocks in one file');return r}
  var taken=new Set();body.forEach(function(n){if(n&&!n.lgGen&&n.name)taken.add(n.name)});
  var step=body.find(function(n){return n&&n.type==='FunctionDecl'&&n.lgStep});
  gens.forEach(function(n){
    if(n.lgExport==='frame'){
      var uf=body.find(function(x){return x&&x.type==='FunctionDecl'&&!x.lgGen&&x.exported&&x.name==='frame'});
      if(uf){var l={line:uf.loc.line,col:uf.loc.col};if(uf.loc.file)l.file=uf.loc.file;uf.body.statements.unshift(new ExprStmt(new CallExpr(new IdentifierExpr(step.name,l),[],l),l));return}
      n.name='frame';n.exported=true;
    }else{
      n.name=taken.has('game')?'__lg_game':'game';n.exported=true;
    }
  });
  return r;
}})(_emitModLink);
(function(){
  var P=WasmCodegen.prototype,gen0=P.generate;
  P.generate=function(){
    var w=gen0.apply(this,arguments),a=this.ast;
    if(a&&a.body)for(var i=0;i<a.body.length;i++){var n=a.body[i];if(n&&n.type==='FunctionDecl'&&n.lgMeta){this.imports.logicMeta=JSON.stringify(n.lgMeta);break}}
    return w;
  };
})();
// ═══ end THINGS & RULES (compiler half) ═══

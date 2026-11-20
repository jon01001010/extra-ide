// ═══ BLOCKS: sound / music (compiler half; the parsers and the synth are in the runtime, "SOUND & MUSIC") ═══
// A block is a top-level declaration that starts in column 1 with `<kind> <name>:` and goes on over every
// following indented line (a blank line belongs to it when an indented line follows). Its body is not Emit
// code: the lexer hands it to the parser as one raw text token (kinds in _EMIT_RAW_KINDS), the parser checks it
// with the kind's own parser and makes a SoundDecl / MusicDecl node. The module linker takes these nodes out of
// the program (they are assets, not code: every block name is visible from every file of the project without
// import), checks the names used by play() / music() and turns them into string literals; compile() hands the
// blocks to the runtime as imports.soundMeta. Programs without blocks compile exactly as before.
var _EMIT_BLOCK_KINDS={sound:1,music:1,sprite:1,map:1,controls:1,thing:1,rules:1};   // the Drawer contract's kinds
var _EMIT_RAW_KINDS={sound:1,music:1};   // kinds this section lexes and parses
var _EMIT_NOT_BLOCK={region:1,struct:1,public:1,package:1,with:1};
class BlockDecl extends Z{constructor(kind,name,text,l){super(kind==='sound'?'SoundDecl':kind==='music'?'MusicDecl':'BlockDecl',l);this.kind=kind;this.name=name;this.text=text}}
// At offset p (the start of a line): a block header? → {kind, name, nameOff, colon (offset after ':'), end
// (offset of the end of its last line)} or null. raw=true: also a header of an unknown kind (for the error).
function _emitBlockAt(s,p,raw){
  var re=/([A-Za-z_][A-Za-z0-9_]*)[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*:/y;re.lastIndex=p;
  var m=re.exec(s);if(!m)return null;
  var k=m[1].toLowerCase(),n=m[2];   /* block kinds are case-insensitive */
  if(!_EMIT_RAW_KINDS[k]){
    if(!raw||_EMIT_BLOCK_KINDS[k]||_EMIT_NOT_BLOCK[k]||KW.has(k)||TY.has(k)||KW.has(n)||TY.has(n))return null;
  }
  var e=s.indexOf('\n',p);if(e<0)e=s.length;
  var end=e,q=e;
  while(q<s.length){
    var ls=q+1,le=s.indexOf('\n',ls);if(le<0)le=s.length;
    var line=s.substring(ls,le);
    if(/^[ \t]+\S/.test(line)){end=le;q=le;continue}
    if(/^[ \t]*$/.test(line)&&le<s.length){q=le;continue}   // a blank line: part of the block only if an indented line follows
    break;
  }
  return{kind:k,name:n,nameOff:p+m[0].indexOf(n,m[1].length),colon:p+m[0].length,end:end};
}
// The blocks of a source text, for every part that looks for them (the drawer's block helpers, the SPRITE and
// STAGE lexers and tools, the highlighter): one scanner, so all agree on where a block starts and ends.
// For each block header line → {kind, name, start, end} (0-based lines, inclusive). A header is `<kind> <name>:`
// in column 1 (`rules:` has no name) of a contract kind (or kindWanted); the block goes on over every following
// indented line (blank lines inside belong to it when an indented line follows; trailing blank lines do not).
// Lines inside /* */ comments or strings are not looked at, and the lines of a block are not read as code.
function _emitScanBlocks(src,kindWanted){
  var lines=String(src).split('\n'),out=[],inC=false,inS=null;
  var hdr=/^([A-Za-z_][A-Za-z0-9_]*)(?:[ \t]+([A-Za-z_][A-Za-z0-9_]*))?[ \t]*:/;
  for(var i=0;i<lines.length;i++){
    var L=lines[i];
    if(!inC&&!inS){
      var m=hdr.exec(L);
      var mk=m?m[1].toLowerCase():''; /* block kinds are case-insensitive: Sprite Hero: is a sprite block (kind reported in lower case) */
      if(m&&(_EMIT_BLOCK_KINDS[mk]||mk===kindWanted)&&(m[2]!==undefined||mk==='rules'||mk===kindWanted)){
        var end=i,j=i+1;
        while(j<lines.length){
          if(/^[ \t]+\S/.test(lines[j])){end=j;j++;continue}
          if(/^[ \t]*\r?$/.test(lines[j])){var k=j;while(k<lines.length&&/^[ \t]*\r?$/.test(lines[k]))k++;if(k<lines.length&&/^[ \t]+\S/.test(lines[k])){j=k;continue}}
          break;
        }
        out.push({kind:mk,name:m[2]||'',start:i,end:end});
        i=end;continue;
      }
    }
    for(var c=0;c<L.length;c++){
      var ch=L[c];
      if(inC){if(ch==='*'&&L[c+1]==='/'){inC=false;c++}continue}
      if(inS){if(ch==='\\'){c++;continue}if(ch===inS)inS=null;continue}
      if(ch==='/'&&L[c+1]==='/')break;
      if(ch==='/'&&L[c+1]==='*'){inC=true;c++;continue}
      if(ch==='"'||ch==="'")inS=ch;
    }
  }
  return out;
}
(function(){
  var skip0=Lexer.prototype.skip;
  Lexer.prototype.skip=function(){
    skip0.call(this);
    while(this.col===1&&this.p<this.s.length){
      var b=_emitBlockAt(this.s,this.p,true);if(!b)break;
      var L=this.line,kt=new Token(TT.IDENTIFIER,b.kind,L,1),nt=new Token(TT.IDENTIFIER,b.name,L,1+b.nameOff-this.p),
          ct=new Token(TT.COLON,':',L,b.colon-this.p),bt=new Token(TT.STRING,this.s.substring(b.colon,b.end),L,1+b.colon-this.p);
      kt.emitBlock=true;bt.emitRaw=true;
      this.tokens.push(kt,nt,ct,bt);
      while(this.p<b.end)this.adv();
      skip0.call(this);
    }
  };
})();
// line:col of offset `off` in the raw body token `bt`
function _emitBlockPos(bt,off){
  var s=bt.value.substring(0,off),nl=s.lastIndexOf('\n');
  if(nl<0)return{line:bt.line,col:bt.col+off};
  return{line:bt.line+s.split('\n').length-1,col:off-nl};
}
(function(){
  var P=Parser.prototype,top0=P.parseTop,stmt0=P.parseStmt;
  function head(p){
    var t=p.cur(),n=p.t[p.p+1],c=p.t[p.p+2],b=p.t[p.p+3];
    if(!(t&&t.emitBlock&&n&&c&&b&&b.emitRaw))return null;
    return{t:t,n:n,c:c,b:b};
  }
  P.parseTop=function(){
    var h=head(this);
    if(!h)return top0.call(this);
    var k=h.t.value;
    if(!_EMIT_RAW_KINDS[k])throw this.err('Unknown block "'+k+' '+h.n.value+':" — the kinds of blocks are '+Object.keys(_EMIT_BLOCK_KINDS).join(', ')+(_emitModClosest(k,Object.keys(_EMIT_BLOCK_KINDS))?' — did you mean '+_emitModClosest(k,Object.keys(_EMIT_BLOCK_KINDS))+'?':''));
    var r=k==='sound'?_sndParse(h.b.value):_musParse(h.b.value);
    if(r.errors.length){var e=r.errors[0],ps=_emitBlockPos(h.b,e.off);throw new Error(ps.line+':'+ps.col+': '+e.msg)}
    this.p+=4;
    var d=new BlockDecl(k,h.n.value,h.b.value,{line:h.t.line,col:h.t.col});
    d.nameRef={loc:{line:h.n.line,col:h.n.col}};
    d.spec=r.spec;
    d.warnings=r.warnings.map(function(w){var ps=_emitBlockPos(h.b,w.off);return{line:ps.line,col:ps.col,msg:w.msg}});
    return d;
  };
  P.parseStmt=function(){
    var h=head(this);
    if(h)throw this.err(h.t.value+' '+h.n.value+': looks like a block — blocks belong at the top level of a file, starting in column 1');
    var t=this.cur(),n=this.t[this.p+1],c=this.t[this.p+2];
    if(t.type===TT.IDENTIFIER&&_EMIT_RAW_KINDS[t.value]&&n&&n.type===TT.IDENTIFIER&&n.line===t.line&&c&&c.type===TT.COLON)
      throw this.err(t.value+' blocks belong at the top level of a file and start in column 1 — '+t.value+' '+n.value+': …');
    return stmt0.call(this);
  };
})();
BUILTINS.play={params:[{name:'name',type:'str'},{name:'pitch',type:'num'},{name:'vol',type:'num'}],returnType:'void',module:'std'};
BUILTINS.music={params:[{name:'name',type:'str'}],returnType:'void',module:'std'};
BUILTINS.stopMusic={params:[],returnType:'void',module:'std'};
BUILTINS.musicPlaying={params:[],returnType:'bool',module:'std'};
// Before the linker: collect the blocks of every file, check play(name) / music(name) and lower them.
//   play(coin) → play("coin", 1.0, 1.0)   play(coin, 2) → play("coin", 2.0, 1.0)   music(theme) → music("theme")
// The name is a block name written bare (or as a string literal); a variable (str) is passed on as it is and
// looked up when the program runs (an unknown name then plays nothing). A local or parameter of the same name
// wins over a block. A file that declares or imports its own play / music function is left alone.
_emitModLink=(function(link){return function(fr){
  var errs=[],warns=[],tabs={sound:{},music:{}},any=false;
  function at(m,loc){return fr.pre(m,(loc&&loc.line)||1,(loc&&loc.col)||1)}
  fr.mods.forEach(function(m){
    if(!m.ast)return;
    var keep=[];
    m.ast.body.forEach(function(n){
      if(n.type!=='SoundDecl'&&n.type!=='MusicDecl'){keep.push(n);return}
      any=true;
      var tab=tabs[n.kind],old=tab[n.name];
      if(old)errs.push(at(m,n.nameRef.loc)+n.kind+' '+n.name+' is already declared'+(old.m===m?' at line '+old.n.loc.line:' in '+old.m.path+' (line '+old.n.loc.line+')')+' — every '+n.kind+' needs its own name');
      else tab[n.name]={n:n,m:m};
      (n.warnings||[]).forEach(function(w){warns.push(fr.pre(m,w.line,w.col)+w.msg)});
    });
    if(keep.length!==m.ast.body.length)m.ast.body=keep;
  });
  var pubPlay={};
  fr.mods.forEach(function(m){if(m.ast)m.ast.body.forEach(function(n){if(n.type==='FunctionDecl'&&(n.isPublic||n.exported)&&(n.name==='play'||n.name==='music'))(pubPlay[m.name]||(pubPlay[m.name]={}))[n.name]=true})});
  fr.mods.forEach(function(m){
    if(!m.ast)return;
    var own={},globals={};
    m.ast.body.forEach(function(n){
      if(n.type==='FunctionDecl'&&(n.name==='play'||n.name==='music'))own[n.name]=true;
      if(n.type==='VarDecl')globals[n.name]=true;
      if(n.type==='ModImportDecl'){
        var last=n.path[n.path.length-1];
        if(!n.star&&(last==='play'||last==='music'||n.alias==='play'||n.alias==='music'))own[n.alias||last]=true;
        if(n.star&&pubPlay[n.path.join('.')])Object.keys(pubPlay[n.path.join('.')]).forEach(function(k){own[k]=true});
      }
    });
    if(own.play&&own.music)return;
    function names(fn){
      var s={};fn.params.forEach(function(p){s[p.name]=true});
      (function walk(x){if(!x||typeof x!=='object')return;if(Array.isArray(x)){x.forEach(walk);return}if(x.type==='VarDecl'&&x.name)s[x.name]=true;if(x.type==='WithStmt'&&x.alias)s[x.alias]=true;for(var k in x){if(k!=='loc'){var v=x[k];if(v&&typeof v==='object')walk(v)}}})(fn.body);
      return s;
    }
    function lower(e,locals){
      var fn=e.callee.name,kind=fn==='play'?'sound':'music',tab=tabs[kind],other=tabs[kind==='sound'?'music':'sound'],a=e.args[0];
      var use=fn==='play'?'play(coin), play(coin, 1.5) or play(coin, 1.5, 0.8)':'music(theme)';
      if(!e.args.length||e.args.length>(fn==='play'?3:1)){errs.push(at(m,e.loc)+fn+' takes '+(fn==='play'?'1 to 3 arguments':'one argument')+': '+use);return}
      function unknown(name,loc){
        var list=Object.keys(tab),c=_emitModClosest(name,list);
        var msg='Unknown '+kind+' "'+name+'"';
        if(other[name])msg+=' — '+name+' is a '+(kind==='sound'?'music':'sound')+' block: '+(kind==='sound'?'music('+name+')':'play('+name+')');
        else if(c)msg+=' — did you mean "'+c+'"?';
        else if(list.length)msg+=' — the '+kind+(kind==='sound'?'s are ':' blocks are ')+list.slice(0,12).join(', ');
        else msg+=' — there is no '+kind+' block yet: write one (e.g. '+(kind==='sound'?'sound '+name+': square 880, 90ms':'music '+name+': 120 bpm, 16 steps')+') or make one with the Drawer (🧰)';
        errs.push(at(m,loc)+msg);
      }
      if(a.type==='IdentifierExpr'&&!locals[a.name]&&!globals[a.name]){
        if(tab[a.name])e.args[0]=new StringLiteral(a.name,a.loc);
        else{unknown(a.name,a.loc);return}
      }else if(a.type==='StringLiteral'&&!tab[a.value]){
        var ck=Object.keys(tab).filter(function(k){return k.toLowerCase()===String(a.value).toLowerCase()})[0];
        if(ck)e.args[0]=new StringLiteral(ck,a.loc);else{unknown(a.value,a.loc);return}
      }
      if(fn==='play'){
        for(var i=1;i<3;i++){
          var x=e.args[i];
          if(!x)e.args[i]=new FloatLiteral('1.0',e.loc);
          else if(x.type==='IntLiteral'&&isFinite(Number(x.value)))e.args[i]=new FloatLiteral(String(Number(x.value)).indexOf('.')<0?String(Number(x.value))+'.0':String(Number(x.value)),x.loc);
        }
      }
    }
    function walk(x,locals){
      if(!x||typeof x!=='object')return;
      if(Array.isArray(x)){for(var i=0;i<x.length;i++)walk(x[i],locals);return}
      if(x.type==='CallExpr'&&x.callee&&x.callee.type==='IdentifierExpr'&&(x.callee.name==='play'||x.callee.name==='music')&&!own[x.callee.name]&&!locals[x.callee.name])lower(x,locals);
      for(var k in x){if(k==='loc')continue;var v=x[k];if(v&&typeof v==='object')walk(v,locals)}
    }
    m.ast.body.forEach(function(n){
      if(n.type==='FunctionDecl')walk(n.body,names(n));
      else if(n.type==='VarDecl'&&n.init)walk(n.init,{});
    });
  });
  var r=link.apply(this,arguments);
  if(errs.length)r.errors=r.errors.concat(errs);
  if(warns.length)r.warnings=(r.warnings||[]).concat(warns);
  if(any&&r.ast){
    var info={v:1,sounds:{},music:{}};
    Object.keys(tabs.sound).forEach(function(k){info.sounds[k]=tabs.sound[k].n.text});
    Object.keys(tabs.music).forEach(function(k){info.music[k]=tabs.music[k].n.text});
    Object.defineProperty(r.ast,'sndInfo',{value:info,enumerable:false,configurable:true,writable:true});
  }
  return r;
}})(_emitModLink);
// The blocks travel with the program: imports.soundMeta (JSON), also into exported files (_exportProgram).
compile=(function(c){return function(source,target){
  var r=c.apply(this,arguments),I=r&&r.ast&&r.ast.sndInfo;
  if(I&&r.imports){r.imports.soundMeta=JSON.stringify(I);r.sounds=Object.keys(I.sounds);r.music=Object.keys(I.music)}
  return r;
}})(compile);

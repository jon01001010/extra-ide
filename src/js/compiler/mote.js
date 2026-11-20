// ═══ MOTE SCRIPTS (compiler half; the runtime half is "MOTE (runtime half)" in the loader's runtime block, the editor
// half is "MOTE in the editor" with the SCRIPT tool of the drawer) ═══
//
//   script intro:                         a top-level block: `script <name>:` in column 1 and every indented line
//     say("Hello!")                       after it. The body is Mote source (Lua-like, see MOTE.md); it is dedented
//     wait(1)                             by its smallest indentation. Every line of a script must be indented
//     return 42                           (a Mote long string must not reach column 1).
//
// Pipeline. `script` is not a keyword. The lexer wrapper finds script blocks in the raw text (_emitScanBlocks with
// kind 'script', outside comments and strings), blanks them out — the Emit lexer never sees Mote source — and puts
// one IDENTIFIER token "script" carrying the block in the stream; parseTop makes a ScriptDecl, after checking the
// Mote syntax with the embedded Mote (a syntax error is a compile error at its exact line:col in the block). The
// module linker wrapper takes the ScriptDecls out of every file (names are project-wide, like sounds and sprites)
// and turns a script name used as a value into a string literal: the script's source, behind a one-line Mote
// comment `--[[script NAME @FILE:LINE]]` that the runtime helpers read for the chunk name and for mapping Mote
// line numbers back to the file (Mote line n is file line LINE + n). A local, parameter, global or function of
// the same name wins over a script; a top-level declaration with a script's name is an error. The Mote builtins
// (moteVM, moteRun, … _MOTE_SIGS) are JS calls of runtime helpers (window.moteRun …: any argument count, errors
// catchable with try / catch); the annotator checks their arguments with positions. A program without script
// blocks and without Mote builtins compiles exactly as before.
var _MOTE_URL='emit:mote';
_EMIT_BLOCK_KINDS.script=1;
var _DRAWER_MOTE_FILE='scripts.emit';
// name → {p: [[param, kind]], rest: more arguments of any type, use: example}. kinds: js (a VM / thread / function
// value), str, int, val (int num bool str js arr), fn (a str name or a js function value)
var _MOTE_SIGS={
  moteVM:{p:[['steps','int']],min:0,use:'let vm = moteVM()  or  moteVM(100000) for a smaller step budget'},
  moteRun:{p:[['vm','js'],['src','str']],use:'moteRun(vm, intro) — intro: a script block, or a str of Mote source'},
  moteSet:{p:[['vm','js'],['name','str'],['value','val']],use:'moteSet(vm, "hp", 10)'},
  moteGet:{p:[['vm','js'],['name','str']],use:'moteGet(vm, "hp")'},
  moteCall:{p:[['vm','js'],['fn','fn']],rest:true,use:'moteCall(vm, "update", dt)'},
  moteFn:{p:[['vm','js'],['name','str'],['f','js']],use:'moteFn(vm, "give", fnRef(give))'},
  moteThread:{p:[['vm','js'],['fn','fn']],rest:true,use:'let th = moteThread(vm, talk)  — talk: a script block or a function name'},
  moteResume:{p:[['th','js']],use:'if (moteResume(th)) { … }  — false when the script has finished'},
  moteChoices:{p:[['th','js']],use:'let opts = moteChoices(th)  — the options of choose(…), or null'},
  moteChoose:{p:[['th','js'],['n','int']],use:'moteChoose(th, 1)  — answers choose(…) with option 1'}
};
var _MOTE_FNS=Object.keys(_MOTE_SIGS);
// The embedded Mote, for compile-time syntax checks (IDE only): evaluated once from the page's text, as a module
// (it does not touch window.Mote — a program gets its own copy through `use mote`). null when not available.
var _moteC=undefined;
function _moteCompiler(){
  if(_moteC!==undefined)return _moteC;
  _moteC=null;
  try{
    var el=document.querySelector('script[type="text/plain"][data-emit-builtin="'+_MOTE_URL+'"]');
    if(el){var mod={exports:{}};new Function('module','exports',el.textContent)(mod,mod.exports);if(mod.exports&&typeof mod.exports.create==='function')_moteC=mod.exports}
  }catch(e){_moteC=null}
  return _moteC;
}
// Script blocks of a source text: [{name, start, end (0-based line indexes), lines}]
function _moteFindBlocks(src){
  src=String(src==null?'':src);
  if(!/(^|\n)script[ \t]/.test(src))return[];
  var lines=null;
  return _emitScanBlocks(src,'script').filter(function(b){return b.kind==='script'}).map(function(b){
    lines=lines||src.split('\n');
    return{name:b.name,start:b.start,end:b.end,lines:lines.slice(b.start,b.end+1)};
  });
}
// One block (its lines, header first; line0 = 1-based line of the header) → {name, source (dedented Mote), indent,
// errors:[{line,col,msg}], nameCol}. The Mote syntax is checked when the embedded Mote is available.
function _moteParseBlock(lines,line0){
  var errors=[],head=String(lines[0]||'').replace(/\r$/,'');
  var hm=/^script([ \t]+)([A-Za-z_]\w*)([ \t]*):(.*)$/i.exec(head)||[head,' ','script','',''];
  var d={name:hm[2],nameCol:7+hm[1].length,errors:errors,source:'',indent:0,line:line0};
  var rest=hm[4],restCol=7+hm[1].length+hm[2].length+hm[3].length+1;
  if(/\S/.test(rest)&&!/^\s*--/.test(rest))errors.push({line:line0,col:restCol+rest.length-rest.replace(/^\s+/,'').length,msg:'The Mote source of script '+d.name+' goes on the indented lines below the header — script '+d.name+': (nothing after the colon but a -- comment)'});
  var body=lines.slice(1).map(function(l){return String(l).replace(/\r$/,'')}),ind=Infinity;
  body.forEach(function(l){if(/\S/.test(l)){var n=l.length-l.replace(/^[ \t]+/,'').length;if(n<ind)ind=n}});
  if(ind===Infinity){errors.push({line:line0,col:1,msg:'script '+d.name+' has no Mote source — write it on indented lines below the header, e.g.\n  print("hello")'});ind=0}
  d.indent=ind;
  d.source=body.map(function(l){return/\S/.test(l)?l.substring(ind):''}).join('\n');
  if(!errors.length){
    var M=_moteCompiler();
    if(M){
      try{M.create({stdlib:['base'],caseInsensitive:true}).compile(d.source,d.name)}
      catch(e){
        if(e&&e.kind==='syntax'){
          var ml=+e.line||1,mc=+e.column||1,msg=String(e.message||e).replace(/^[^\n]*?:\d+:(?:\d+:)?\s*/,'').replace(/\bat line (\d+)/g,function(m,n){return'at line '+(line0+Number(n))});   /* "(to close '(' at line 3)": a line of the file too */
          errors.push({line:line0+ml,col:mc+ind,msg:'Mote syntax error in script '+d.name+': '+msg});
        }
      }
    }
  }
  return d;
}
// The text a script name stands for: its source behind the header comment the runtime reads (see above)
function _moteScriptText(d,file){return'--[[script '+d.name+' @'+(file?file+':':'')+d.line+']]'+d.source}
// ── syntax ──
(function(){
  var tk0=Lexer.prototype.tokenize,P=Parser.prototype,top0=P.parseTop,stmt0=P.parseStmt;
  Lexer.prototype.tokenize=function(){
    var bl=_moteFindBlocks(this.s);
    if(!bl.length)return tk0.call(this);
    var lines=String(this.s).split('\n');
    bl.forEach(function(b){for(var i=b.start;i<=b.end;i++)lines[i]=lines[i].replace(/[^\r]/g,' ')});
    this.s=lines.join('\n');
    var ts=tk0.call(this);
    bl.forEach(function(b){
      var ln=b.start+1,tok=new Token(TT.IDENTIFIER,'script',ln,1);
      tok.moteScript=_moteParseBlock(b.lines,ln);
      var at=0;while(at<ts.length&&ts[at].type!==TT.EOF&&ts[at].line<=ln)at++;
      ts.splice(at,0,tok);
    });
    return ts;
  };
  P.parseTop=function(){
    var t=this.cur();
    if(t&&t.moteScript){
      this.adv();
      var d=t.moteScript;
      if(d.errors.length){var e=d.errors[0];throw new Error(e.line+':'+e.col+': '+e.msg)}
      return{type:'ScriptDecl',name:d.name,source:d.source,line:d.line,loc:{line:d.line,col:1},nameLoc:{line:d.line,col:d.nameCol}};
    }
    return top0.call(this);
  };
  P.parseStmt=function(){
    var t=this.cur();
    if(t&&t.moteScript)throw this.err('script blocks belong at the top level of a file, not inside a function — is a } missing above?');
    return stmt0.call(this);
  };
})();
// ── linking: script names → their text (before the module linker resolves names) ──
_emitModLink=(function(link){return function(fr){
  var errs=[],tab={},any=false,mods=fr.mods||[];
  function at(m,loc){return fr.pre(m,(loc&&loc.line)||1,(loc&&loc.col)||1)}
  mods.forEach(function(m){
    if(!m.ast)return;
    var keep=[];
    m.ast.body.forEach(function(n){
      if(!n||n.type!=='ScriptDecl'){keep.push(n);return}
      any=true;
      var old=tab[n.name];
      if(old)errs.push(at(m,n.nameLoc)+'script '+n.name+' is already declared'+(old.m===m?' at line '+old.n.line:' in '+old.m.path+' (line '+old.n.line+')')+' — every script of the project needs its own name');
      else tab[n.name]={n:n,m:m,text:_moteScriptText(n,fr.multi?m.path:'')};
    });
    if(keep.length!==m.ast.body.length)m.ast.body=keep;
  });
  var scriptNames=Object.keys(tab);
  // Mote builtins called with a bare name that is no script: an error now (it would be a JS global lookup)
  var calls=false;
  if(!any){
    mods.forEach(function(m){if(m.ast&&!calls)(function scan(x){if(calls||!x||typeof x!=='object')return;if(Array.isArray(x)){x.forEach(scan);return}if(x.type==='CallExpr'&&x.callee&&x.callee.type==='IdentifierExpr'&&(x.callee.name==='moteRun'||x.callee.name==='moteThread')){calls=true;return}for(var k in x)if(k!=='loc'){var v=x[k];if(v&&typeof v==='object')scan(v)}})(m.ast.body)});
    if(!calls)return link.apply(this,arguments);
  }
  if(any){
    // a top-level declaration or another block with a script's name
    mods.forEach(function(m){
      if(!m.ast)return;
      m.ast.body.forEach(function(n){
        if(!n||!n.name||!tab[n.name])return;
        var what={FunctionDecl:'a function',VarDecl:'a variable',StructDecl:'a struct',RegionDecl:'a region',ImportDecl:'an import fn',SpriteDecl:'a sprite',SoundDecl:'a sound',MusicDecl:'a music block'}[n.type];
        if(!what)return;
        var s=tab[n.name];
        errs.push(at(s.m,s.n.nameLoc)+'The name "'+n.name+'" is a script and also '+what+' ('+(m===s.m?'line ':m.path+' line ')+((n.loc&&n.loc.line)||1)+') — script names are seen by every file, so rename one of them');
      });
    });
  }
  mods.forEach(function(m){
    if(!m.ast)return;
    var own={},globals={};
    m.ast.body.forEach(function(n){
      if(n.type==='FunctionDecl'||n.type==='ImportDecl')own[n.name]=true;
      if(n.type==='VarDecl')globals[n.name]=true;
      if(n.type==='ModImportDecl'){var last=n.path[n.path.length-1];if(!n.star)own[n.alias||last]=true}
    });
    function names(fn){
      var s={};fn.params.forEach(function(p){s[p.name]=true});
      (function walk(x){if(!x||typeof x!=='object')return;if(Array.isArray(x)){x.forEach(walk);return}if(x.type==='VarDecl'&&x.name)s[x.name]=true;if(x.type==='WithStmt'&&x.alias)s[x.alias]=true;for(var k in x){if(k!=='loc'){var v=x[k];if(v&&typeof v==='object')walk(v)}}})(fn.body);
      return s;
    }
    function free(nm,locals){return!locals[nm]&&!globals[nm]&&!own[nm]}
    function lit(e,text){var l=e.loc;for(var k in e)if(k!=='loc')delete e[k];e.type='StringLiteral';e.value=text;e.moteScript=true;return e}
    function walk(x,locals){
      if(!x||typeof x!=='object')return;
      if(Array.isArray(x)){for(var i=0;i<x.length;i++)walk(x[i],locals);return}
      if(x.type==='CallExpr'&&x.callee&&x.callee.type==='IdentifierExpr'&&(x.callee.name==='moteRun'||x.callee.name==='moteThread')&&free(x.callee.name,locals)){
        var a=x.args[1];
        if(a&&a.type==='IdentifierExpr'&&free(a.name,locals)&&!tab[a.name]){
          var c=_emitModClosest(a.name,scriptNames);
          errs.push(at(m,a.loc)+'Unknown script "'+a.name+'"'+(c?' — did you mean "'+c+'"?':scriptNames.length?' — the scripts are '+scriptNames.slice(0,12).join(', '):' — there is no script block yet: write one (script '+a.name+':, then Mote source on indented lines) or make one with the Drawer (🧰 → Script)'));
          a.moteChecked=true;
        }
      }
      if(x.type==='AssignExpr'&&x.target&&x.target.type==='IdentifierExpr'&&tab[x.target.name]&&free(x.target.name,locals)){errs.push(at(m,x.target.loc)+x.target.name+' is a script block — its text cannot be assigned');return}
      if(x.type==='CallExpr'&&x.callee&&x.callee.type==='IdentifierExpr'){walk(x.args,locals);return}   /* intro(…) is a call, not the script */
      if(x.type==='IdentifierExpr'&&tab[x.name]&&free(x.name,locals)){lit(x,tab[x.name].text);return}
      for(var k in x){if(k==='loc')continue;var v=x[k];if(v&&typeof v==='object')walk(v,locals)}
    }
    m.ast.body.forEach(function(n){
      if(n.type==='FunctionDecl')walk(n.body,names(n));
      else if(n.type==='VarDecl'&&n.init)walk(n.init,{});
    });
  });
  var r=link.apply(this,arguments);
  if(errs.length)r.errors=errs.concat(r.errors||[]);
  if(any&&r.ast)Object.defineProperty(r.ast,'moteScripts',{value:scriptNames.map(function(k){var s=tab[k];return{name:k,path:s.m.path,line:s.n.line,source:s.n.source}}),enumerable:false,configurable:true,writable:true});
  return r;
}})(_emitModLink);
// The compile result: r.scripts = [{name, path, line, source}] (empty without script blocks)
compile=(function(c){return function(source,target){
  var r=c.apply(this,arguments),L=r&&r.ast&&r.ast.moteScripts;
  if(r)r.scripts=L||[];
  return r;
}})(compile);
// ── the Mote builtins: argument checks (they compile to JS calls of the runtime helpers) ──
(function(){
  var P=TypeAnnotator.prototype,a0=P.a;
  function k(t){t=String(t||'');if(t==='int'||t==='i64')return'int';if(t==='num'||t==='f64')return'num';if(t==='arr'||t==='numarr')return'arr';return t}
  function an(t){return(/^[aeiou]/.test(t)?'an ':'a ')+t}
  P.a=function(e){
    var t=a0.apply(this,arguments);
    if(!e||e.type!=='CallExpr'||e.jsCall!=='global'||!e.callee||e.callee.type!=='IdentifierExpr'||!Object.prototype.hasOwnProperty.call(_MOTE_SIGS,e.callee.name))return t;
    var name=e.callee.name,S=_MOTE_SIGS[name],self=this,n=e.args.length,min=S.min===undefined?S.p.length:S.min;
    if(n<min||(!S.rest&&n>S.p.length))this.fail(name+' takes '+(S.rest?'at least '+S.p.length+' arguments':min===S.p.length?S.p.length+' argument'+(S.p.length===1?'':'s'):min+' to '+S.p.length+' arguments')+': '+S.use,e.loc);
    e.args.forEach(function(arg,i){
      var p=S.p[i],at=k(arg.exprType),loc=arg.loc||e.loc;
      if(at==='void')self.fail(name+'(): argument '+(i+1)+' is a call that returns nothing — there is no value to pass',loc);
      if(!p)return;
      var kind=p[1],ok;
      if(kind==='js')ok=at==='js'||at==='null';
      else if(kind==='str')ok=at==='str';
      else if(kind==='int')ok=at==='int'||at==='js';
      else if(kind==='fn')ok=at==='str'||at==='js';
      else ok=at==='int'||at==='num'||at==='bool'||at==='str'||at==='js'||at==='null'||at==='arr';
      if(ok)return;
      var hint=kind==='js'&&p[0]==='vm'?' — make one with moteVM()':kind==='js'&&p[0]==='th'?' — make one with moteThread(vm, script)':kind==='js'&&p[0]==='f'?' — pass an Emit function as fnRef(myFn)':kind==='str'&&p[0]==='src'?' — a script block name or a str of Mote source':'';
      self.fail(name+'(): parameter '+p[0]+' is '+(kind==='val'?'int, num, bool, str or js':kind==='fn'?'a function name (str) or a function value (js)':kind)+', but this is '+an(String(arg.exprType))+hint,loc);
    });
    return t;
  };
})();

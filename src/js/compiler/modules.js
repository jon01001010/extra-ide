// ═══ MODULES ═══ one file = one module, whole-program compilation
// A project is ONE text (a "bundle"): a line `//// file: <path>` starts a new file, the first file is the
// entry file; text before the first marker (or a text without markers) is the entry file main.emit.
// File game/physics.emit is module game.physics. Front end only: every file is lexed and parsed on its own
// (locations are relative to the file), then _emitModLink() resolves the names of all modules against each
// other and builds ONE merged Program in which every top-level function / variable has a unique internal
// name and every reference (identifier, call, alias.name, fnRef) has been rewritten to it. The annotator,
// checker, async / try analyses and the code generator then run on that program exactly as before.
//   internal names   entry module: the plain name (so a single-file program is the same program as before,
//                    and run / frame / onclick_N keep their export names); every other module:
//                    "<module>.<name>" — which is also the WASM export name of its `export fn`s.
//   import a.b [as p]            p.name / p.name(args) / p.name = v     (alias = last segment)
//   import a.b.name [as n]       name used directly
//   import a.b.*                 every public name directly; a clash is only an error where the name is used
//   public fn / public let / public mut   visible to other modules (export fn implies public)
//   package a                    optional first line, must match the folder of the file
//   import fn f(..) from "m"     unchanged: a raw WASM import (the `fn` tells them apart)
KW.add('public');KW.add('package');
var _EMIT_FILE_MARK='//// file: ';
function _emitSplitBundle(text){
  var lines=String(text==null?'':text).split('\n'),files=[],cur=null;
  for(var i=0;i<lines.length;i++){
    var ln=lines[i];
    if(ln.indexOf(_EMIT_FILE_MARK)===0){cur={path:ln.slice(_EMIT_FILE_MARK.length).trim(),lines:[]};files.push(cur);continue}
    if(!cur){cur={path:'main.emit',lines:[]};files.push(cur)}
    cur.lines.push(ln);
  }
  return files.map(function(f){return{path:f.path,source:f.lines.join('\n')}});
}
function _emitJoinBundle(files){
  return files.map(function(f,i){return(i===0&&f.path==='main.emit'?'':_EMIT_FILE_MARK+f.path+'\n')+f.source}).join('\n');
}
function _emitModName(path){return String(path).replace(/\.emit$/,'').split('/').join('.')}
function _emitPathOk(p){
  if(!/^[A-Za-z0-9_.\/-]+$/.test(p)||!/\.emit$/.test(p))return false;
  var segs=p.split('/');
  for(var i=0;i<segs.length;i++)if(segs[i]===''||segs[i]==='.'||segs[i]==='..')return false;
  return segs[segs.length-1]!=='.emit';
}
// `public` and `package` are keywords only where a declaration can start with them (`public fn|let|mut|export`,
// `package name` at the start of a line); anywhere else they stay ordinary identifiers, so older programs
// with a variable or a JS property of that name keep compiling.
(function(){
  var tokenize2=Lexer.prototype.tokenize;
  Lexer.prototype.tokenize=function(){
    var ts=tokenize2.call(this);
    for(var i=0;i<ts.length;i++){
      var t=ts[i];
      if(t.type!==TT.KEYWORD)continue;
      var n=ts[i+1],p=i>0?ts[i-1]:null;
      if(t.value==='public'){
        if(!(n&&n.type===TT.KEYWORD&&(n.value==='fn'||n.value==='let'||n.value==='mut'||n.value==='export'||n.value==='public')))t.type=TT.IDENTIFIER;
      }else if(t.value==='package'){
        var word=n&&(n.type===TT.IDENTIFIER||n.type===TT.KEYWORD||n.type===TT.TYPE)&&n.line===t.line;
        if(!word||(p&&p.line===t.line))t.type=TT.IDENTIFIER;
      }
    }
    return ts;
  };
})();
class PackageDecl extends Z{constructor(n,l){super('PackageDecl',l);this.name=n}}
class ModImportDecl extends Z{constructor(p,s,a,l){super('ModImportDecl',l);this.path=p;this.star=s;this.alias=a}}
(function(){
  var P=Parser.prototype,top0=P.parseTop;
  P.modWord=function(what){
    var t=this.cur();
    if(t.type===TT.IDENTIFIER||t.type===TT.KEYWORD||t.type===TT.TYPE||t.type===TT.BOOLEAN||t.type===TT.NULL)return this.adv();
    throw this.err(what);
  };
  P.parseModImport=function(){
    var l=this.loc();this.adv();
    var hint='Expected a module name after import — import game.physics, import game.physics.step, import game.physics.* (or import fn name(..) from "module" for a WASM import)';
    var w=this.modWord(hint),segs=[String(w.value)],locs=[{line:w.line,col:w.col}],star=false,alias=null,aliasLoc=null;
    while(this.match(TT.DOT)){
      if(this.match(TT.STAR)){star=true;break}
      w=this.modWord('Expected a name or * after the dot in this import');
      segs.push(String(w.value));locs.push({line:w.line,col:w.col});
    }
    if(this.check(TT.KEYWORD,'as')){
      if(star)throw this.err('import '+segs.join('.')+'.* brings in every public name — it cannot be renamed with as');
      this.adv();
      var a=this.cur();
      if(a.type!==TT.IDENTIFIER)throw this.err('Expected a name after as — import '+segs.join('.')+' as name');
      this.adv();alias=a.value;aliasLoc={line:a.line,col:a.col};
    }
    this.match(TT.SEMICOLON);
    var d=new ModImportDecl(segs,star,alias,l);
    d.locs=locs;if(aliasLoc)d.aliasLoc=aliasLoc;
    return d;
  };
  P.parseTop=function(){
    var n=this.t[this.p+1];
    if(this.check(TT.KEYWORD,'package')){
      var l=this.loc();this.adv();
      var segs=[String(this.modWord('Expected a package name — package game').value)];
      while(this.match(TT.DOT))segs.push(String(this.modWord('Expected a name after the dot in the package name').value));
      this.match(TT.SEMICOLON);
      return new PackageDecl(segs.join('.'),l);
    }
    if(this.check(TT.KEYWORD,'import')&&!(n&&n.type===TT.KEYWORD&&n.value==='fn'))return this.parseModImport();
    if(this.check(TT.KEYWORD,'public')||(this.check(TT.KEYWORD,'export')&&n&&n.type===TT.KEYWORD&&n.value==='public')){
      var sl=this.loc(),pub=false,exp=false;
      for(;;){
        if(this.check(TT.KEYWORD,'public')){if(pub)throw this.err('public is written twice');pub=true;this.adv()}
        else if(this.check(TT.KEYWORD,'export')){if(exp)throw this.err('export is written twice');exp=true;this.adv()}
        else break;
      }
      if(this.check(TT.KEYWORD,'fn')){this.adv();var f=this.parseFn(exp,sl);f.isPublic=true;return f}
      if(!exp&&(this.check(TT.KEYWORD,'let')||this.check(TT.KEYWORD,'mut'))){var v=this.parseVar();v.loc=sl;v.isPublic=true;return v}
      throw this.err(exp?'Expected fn after export — only functions can be exported to JS (a variable can be public: public mut name = 0)':'Expected fn, let or mut after public');
    }
    if(this.check(TT.IDENTIFIER)&&this.cur().value==='public')throw this.err('public must be followed by fn, let or mut — public fn name() { }, public let name = 0');
    if(this.check(TT.IDENTIFIER)&&this.cur().value==='package')throw this.err('package must be alone on its line, followed by a name — package game');
    return top0.call(this);
  };
})();
// Errors of a multi-file project carry the file: path:line:col: message (loc.file is set by _emitModFront).
(function(){
  var fail0=TypeAnnotator.prototype.fail,err0=TypeChecker.prototype.err;
  TypeAnnotator.prototype.fail=function(m,l){
    if(l&&l.file)throw new Error(l.file+':'+l.line+':'+l.col+': '+m);
    return fail0.call(this,m,l);
  };
  TypeChecker.prototype.err=function(m,l){
    if(l&&l.file){this.errors.push(l.file+':'+(l.line||'?')+':'+(l.col||'?')+': '+m);return}
    return err0.call(this,m,l);
  };
})();
function _emitModClosest(name,list){
  function lev(a,b){
    var prev=[],i,j;
    for(j=0;j<=b.length;j++)prev[j]=j;
    for(i=1;i<=a.length;i++){
      var cur=[i];
      for(j=1;j<=b.length;j++)cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a.charCodeAt(i-1)===b.charCodeAt(j-1)?0:1));
      prev=cur;
    }
    return prev[b.length];
  }
  var best=null,bd=1e9;
  for(var k=0;k<list.length;k++){
    var d=lev(String(name).toLowerCase(),String(list[k]).toLowerCase());
    if(d<bd){bd=d;best=list[k]}
  }
  return best!==null&&bd<=Math.max(2,Math.floor(String(name).length/3))?best:null;
}
// Split, check the paths, lex + parse every file. tolerant=false: the first lexer / parser error is thrown
// (as before, with the path in front in a multi-file project). tolerant=true (the editor index): never
// throws; a file that does not parse has failed=true and its error is added to errors.
function _emitModFront(text,tolerant){
  text=String(text==null?'':text);
  var files=_emitSplitBundle(text),multi=files.length>1||text.indexOf(_EMIT_FILE_MARK)===0;
  var mods=[],errors=[],byPath=new Map(),byName=new Map(),tokens=[];
  function pre(m,line,col){return(multi?m.path+':':'')+line+':'+col+': '}
  files.forEach(function(f,i){
    var m={index:i,path:f.path,source:f.source,name:_emitModName(f.path),ast:null,tokens:null,failed:false,bad:false};
    if(!_emitPathOk(f.path)){m.bad=true;errors.push(pre(m,1,1)+'Invalid file path "'+f.path+'" — a path is relative, uses / between folders, only the characters A-Z a-z 0-9 _ . / - and ends with .emit')}
    else if(byPath.has(f.path)){m.bad=true;errors.push(pre(m,1,1)+'Duplicate file path "'+f.path+'" — every file of a project needs its own path')}
    else if(byName.has(m.name)){m.bad=true;errors.push(pre(m,1,1)+'File "'+f.path+'" and file "'+byName.get(m.name).path+'" are both module '+m.name+' — rename one of them')}
    else{byPath.set(f.path,m);byName.set(m.name,m)}
    mods.push(m);
  });
  mods.forEach(function(m){
    if(m.bad)return;
    try{
      try{m.tokens=new Lexer(m.source).tokenize()}
      catch(e){
        var lm=multi&&/^([\s\S]*) at (\d+):(\d+)$/.exec(String(e&&e.message));
        throw lm?new Error(m.path+':'+lm[2]+':'+lm[3]+': '+lm[1]):e;
      }
      try{m.ast=new Parser(m.tokens).parse()}
      catch(e){
        throw multi&&/^\d+:\d+: /.test(String(e&&e.message))?new Error(m.path+':'+e.message):e;
      }
    }catch(e){
      if(!tolerant)throw e;
      m.failed=true;m.ast=null;
      var msg=String((e&&e.message)||e);
      errors.push(multi&&msg.indexOf(m.path+':')!==0?m.path+':1:1: '+msg:msg);
      return;
    }
    if(multi){
      /* every location remembers its file: the annotator / checker put it in front of their messages */
      (function stamp(x){
        if(!x||typeof x!=='object')return;
        if(Array.isArray(x)){for(var i=0;i<x.length;i++)stamp(x[i]);return}
        for(var k in x){
          var v=x[k];
          if(!v||typeof v!=='object')continue;
          if(k==='loc'||k==='aliasLoc'){if(v.file===undefined)v.file=m.path}
          else stamp(v);
        }
      })(m.ast.body);
    }
    for(var i=0;i<m.tokens.length;i++)if(m.tokens[i].type!==TT.EOF)tokens.push(m.tokens[i]);
  });
  var last=mods.length?mods[mods.length-1]:null;
  tokens.push(last&&last.tokens?last.tokens[last.tokens.length-1]:new Token(TT.EOF,'',1,1));
  return{files:files,multi:multi,mods:mods,errors:errors,tokens:tokens,byName:byName,pre:pre};
}
// What a module shows to the others (and to the editor): its public names and its imports.
function _emitModPublics(m){
  var out=[];
  if(!m.ast)return out;
  function litType(e){
    if(!e)return'int';
    if(e.type==='FloatLiteral')return'num';
    if(e.type==='StringLiteral')return'str';
    if(e.type==='BoolLiteral')return'bool';
    if(e.type==='NullLiteral')return'js';
    if(e.type==='UnaryExpr')return litType(e.operand);
    if(e.type==='BinaryExpr')return litType(e.left)==='num'||litType(e.right)==='num'?'num':'int';
    return'int';
  }
  m.ast.body.forEach(function(n){
    if(n.type==='FunctionDecl'&&(n.isPublic||n.exported))out.push({name:n.modName||n.name,kind:'fn',params:n.params.map(function(p){return{name:p.name,type:p.type}}),returnType:n.returnType,mutable:false});
    else if(n.type==='VarDecl'&&n.isPublic)out.push({name:n.modName||n.name,kind:'var',params:[],returnType:n.declType||n.varType||litType(n.init),mutable:!!n.mutable});
  });
  return out;
}
// the module name as the files spell it (module names are case-insensitive: import Game.Physics is game.physics)
function _ncModName(byName,name){if(!byName||byName.has(name))return name;var k=String(name).toLowerCase(),r=name;byName.forEach(function(v,n){if(n.toLowerCase()===k)r=n});return r}
function _emitModImports(m,byName){
  var out=[];
  if(!m.ast)return out;
  m.ast.body.forEach(function(n){
    if(n.type!=='ModImportDecl')return;
    var full=_ncModName(byName,n.path.join('.')),pre=_ncModName(byName,n.path.slice(0,-1).join('.'));
    if(n.star)out.push({module:full,alias:null,names:null,star:true});
    else if(byName.has(full)||n.path.length<2||!byName.has(pre))out.push({module:full,alias:n.alias||n.path[n.path.length-1],names:null,star:false});
    else out.push({module:pre,alias:n.alias||null,names:[n.path[n.path.length-1]],star:false});
  });
  return out;
}
function _emitModTable(fr){
  var t={};
  fr.mods.forEach(function(m){if(!m.bad){t[m.name]={path:m.path,publics:_emitModPublics(m),imports:_emitModImports(m,fr.byName)};_rgIndexAttach(t[m.name],_rgIndexOf(m))}});
  return t;
}
// Resolve all modules against each other and build the merged program.
// Returns {ast, errors, warnings}; with errors the program must not be compiled further.
function _emitModLink(fr){
  var mods=fr.mods,entry=mods[0],byName=fr.byName,errs=[],warns=[],errSeen=new Set();
  function note(list,m,loc,msg){
    var line=(loc&&loc.line)||1,col=(loc&&loc.col)||1,key=m.index+':'+line+':'+col+':'+msg;
    if(errSeen.has(key))return;
    errSeen.add(key);
    list.push({i:m.index,line:line,col:col,text:fr.pre(m,line,col)+msg});
  }
  function E(m,loc,msg){note(errs,m,loc,msg)}
  function W(m,loc,msg){note(warns,m,loc,msg)}
  function fileOf(name){return name.split('.').join('/')+'.emit'}
  function hint(name,list){var c=_emitModClosest(name,list);return c?' — did you mean "'+c+'"?':''}
  function modNames(){return Array.from(byName.keys())}
  function pubNames(t){var r=[];t.decls.forEach(function(d,k){if(d.kind!=='raw'&&d.pub)r.push(k)});return r}
  function where(d){return'line '+((d.node.loc&&d.node.loc.line)||1)}
  // ── 1. declarations of every module ──
  mods.forEach(function(m){
    m.decls=new Map();m.imps=[];m.aliases=new Map();m.direct=new Map();m.stars=[];m.free=new Map();
    var pkg=m.name.indexOf('.')<0?null:m.name.slice(0,m.name.lastIndexOf('.')),first=true;
    m.ast.body.forEach(function(n){
      if(n.type==='PackageDecl'){
        if(!first)E(m,n.loc,'package must be the first declaration of the file');
        else if(pkg===null)E(m,n.loc,'package '+n.name+' does not match this file — '+m.path+' is in the root folder, so it has no package: remove this line');
        else if(n.name!==pkg)E(m,n.loc,'package '+n.name+' does not match this file — '+m.path+' is module '+m.name+', so the line must be: package '+pkg);
      }
      first=false;
      var kind=n.type==='FunctionDecl'?'fn':n.type==='VarDecl'?'var':n.type==='ImportDecl'?'raw':n.type==='StructDecl'?'struct':n.type==='RegionDecl'?'region':null;
      if(kind&&m.decls.has(n.name)&&(kind==='struct'||kind==='region'||m.decls.get(n.name).kind==='struct'||m.decls.get(n.name).kind==='region')){var dup=m.decls.get(n.name);E(m,(n.nameRef&&n.nameRef.loc)||n.loc,'"'+n.name+'" is already declared at '+where(dup)+' of this file — every top-level name (fn, let, mut, struct, region) is declared once');return}
      if(!kind||m.decls.has(n.name))return;
      m.decls.set(n.name,{name:n.name,kind:kind,node:n,mod:m,pub:kind==='fn'?!!(n.isPublic||n.exported):(kind==='var'||kind==='struct'||kind==='region')?!!n.isPublic:false,exported:kind==='fn'&&!!n.exported,leak:false,internal:n.name});
    });
  });
  // ── 2. imports ──
  function member(m,t,name,loc){
    /* a top-level name of module t, used from module m */
    var d=t.decls.get(name);
    if(!d||d.kind==='raw'){E(m,loc,'Module '+t.name+' has no top-level name "'+name+'"'+hint(name,pubNames(t)));return null}
    if(!d.pub&&t!==m){E(m,loc,'"'+name+'" is private to module '+t.name+' — declare it with public (public '+(d.kind==='fn'?'fn '+name+'(..)':d.kind==='struct'?'struct '+name+' { … }':d.kind==='region'?'region '+name+': …':(d.node.mutable?'mut ':'let ')+name)+') to use it from another file');return null}
    return d;
  }
  mods.forEach(function(m){
    m.ast.body.forEach(function(n){
      if(n.type!=='ModImportDecl')return;
      var segs=n.path,full=segs.join('.'),lastLoc=n.locs[n.locs.length-1],imp={node:n,used:false,kind:null,target:null,decl:null,name:null};
      if(n.star){
        if(!byName.has(full)){E(m,n.locs[0],'Unknown module "'+full+'" — there is no file '+fileOf(full)+' in this project'+hint(full,modNames()));return}
        imp.kind='star';imp.target=byName.get(full);m.stars.push(imp);m.imps.push(imp);
        return;
      }
      var pre=segs.slice(0,-1).join('.'),last=segs[segs.length-1],isMod=byName.has(full),preMod=segs.length>1&&byName.has(pre);
      if(isMod&&preMod&&byName.get(pre).decls.has(last)){
        E(m,n.locs[0],'import '+full+' is ambiguous: '+fileOf(full)+' is module '+full+', and module '+pre+' also has a top-level name "'+last+'" — rename one of them');
        return;
      }
      if(isMod){
        imp.kind='module';imp.target=byName.get(full);imp.name=n.alias||last;
        var other=m.aliases.get(imp.name);
        if(other){
          if(other.target!==imp.target)E(m,n.aliasLoc||lastLoc,'The name "'+imp.name+'" is already used for the import of module '+other.target.name+' at line '+other.node.loc.line+' — choose another name: import '+full+' as other');
          return;
        }
        m.aliases.set(imp.name,imp);m.imps.push(imp);
        return;
      }
      if(preMod){
        var d=member(m,byName.get(pre),last,lastLoc);
        if(!d)return;
        imp.kind='member';imp.target=d.mod;imp.decl=d;imp.name=n.alias||last;
        var prev=m.direct.get(imp.name);
        if(prev){
          if(prev.decl!==d)E(m,n.aliasLoc||lastLoc,'"'+imp.name+'" is imported from module '+pre+' here and from module '+prev.target.name+' at line '+prev.node.loc.line+' — rename one of them: import '+full+' as other');
          return;
        }
        m.direct.set(imp.name,imp);m.imps.push(imp);
        return;
      }
      if(segs.length<2)E(m,n.locs[0],'Unknown module "'+full+'" — there is no file '+fileOf(full)+' in this project'+hint(full,modNames()));
      else{
        var c=_emitModClosest(full,modNames())||_emitModClosest(pre,modNames());
        E(m,n.locs[0],'Unknown module "'+full+'" — there is no file '+fileOf(full)+' in this project (and no module '+pre+' with a member "'+last+'")'+(c?' — did you mean "'+c+'"?':''));
      }
    });
    /* one namespace per file: its own top-level names, the names it imports directly and its import aliases */
    m.direct.forEach(function(imp,name){
      var own=m.decls.get(name),n=imp.node;
      if(own&&own!==imp.decl)E(m,n.aliasLoc||n.locs[n.locs.length-1],'"'+name+'" is imported from module '+imp.target.name+' here, but this file declares its own top-level "'+name+'" at '+where(own)+' — rename one of them: import '+n.path.join('.')+' as other');
    });
    m.aliases.forEach(function(imp,name){
      var own=m.decls.get(name),dir=m.direct.get(name),n=imp.node,at=n.aliasLoc||n.locs[n.locs.length-1];
      if(own)E(m,at,'The import name "'+name+'" (module '+imp.target.name+') collides with the top-level "'+name+'" declared at '+where(own)+' of this file — choose another name: import '+n.path.join('.')+' as other');
      else if(dir)E(m,at,'The import name "'+name+'" (module '+imp.target.name+') collides with "'+name+'" imported from module '+dir.target.name+' at line '+dir.node.loc.line+' — choose another name: import '+n.path.join('.')+' as other');
    });
  });
  // ── 3. bodies: resolve every reference ──
  var refs=[],resolved=new Map(),allVars=null;
  function varNames(){
    /* every variable / parameter name of the project (a variable may hold a function name: fnRef(nameVar)) */
    if(allVars)return allVars;
    allVars=new Set();
    mods.forEach(function(m){(function walk(x){
      if(!x||typeof x!=='object')return;
      if(Array.isArray(x)){x.forEach(walk);return}
      if(x.type==='VarDecl'&&x.name)allVars.add(x.name);
      if(x.type==='FunctionDecl')x.params.forEach(function(p){allVars.add(p.name)});
      for(var k in x){if(k==='loc')continue;var v=x[k];if(v&&typeof v==='object')walk(v)}
    })(m.ast.body)});
    return allVars;
  }
  mods.forEach(function(m){
    var scopes=[],seen=new Set(),ambig=new Set();
    function isLocal(n){for(var i=scopes.length-1;i>=0;i--)if(scopes[i].has(n))return true;return false}
    function def(n,loc){
      scopes[scopes.length-1].add(n);
      if(m.aliases.has(n))W(m,loc,'The local "'+n+'" hides the import "'+n+'" (module '+m.aliases.get(n).target.name+') here — '+n+'.name is a property of the local, not a member of the module');
    }
    function ref(node,d,str){refs.push({node:node,decl:d,str:!!str});resolved.set(node,d)}
    function free(name,loc,fnOnly){
      var f=m.free.get(name);
      if(!f)m.free.set(name,{loc:loc,fnOnly:!!fnOnly});
      else if(!fnOnly)f.fnOnly=false;
    }
    /* a plain name: own top-level name, then a name imported directly, then the star imports */
    function lookup(name,loc){
      var d=m.decls.get(name);
      if(d)return d;
      var imp=m.direct.get(name);
      if(imp){imp.used=true;return imp.decl}
      var found=[],from=[];
      for(var i=0;i<m.stars.length;i++){
        var t=m.stars[i].target,c=t===m?null:t.decls.get(name);
        if(c&&c.kind!=='raw'&&c.pub&&found.indexOf(c)<0){found.push(c);from.push(m.stars[i])}
      }
      if(!found.length)return null;
      from.forEach(function(s){s.used=true});
      if(found.length>1&&!ambig.has(name)){
        ambig.add(name);
        E(m,loc,'"'+name+'" is ambiguous — it is public in '+found.map(function(c){return c.mod.name+'.'+name}).join(' and ')+' (both imported with *); import the one you mean by name: import '+found[0].mod.name+'.'+name);
      }
      return found[0];
    }
    function ident(e){
      if(isLocal(e.name))return;
      var d=lookup(e.name,e.loc);
      if(d){ref(e,d);return}
      if(m.aliases.has(e.name)){var a=m.aliases.get(e.name);a.used=true;E(m,e.loc,'"'+e.name+'" is a module (import '+a.target.name+') — use one of its members: '+e.name+'.name');return}
      free(e.name,e.loc,false);
    }
    function qualified(e){
      /* alias.name → the function / variable of that module */
      var o=e.object;
      if(!o||o.type!=='IdentifierExpr'||seen.has(o)||isLocal(o.name)||!m.aliases.has(o.name))return false;
      var imp=m.aliases.get(o.name),d=member(m,imp.target,e.property,e.loc);
      imp.used=true;
      e.type='IdentifierExpr';e.name=d?d.name:o.name+'.'+e.property;
      delete e.object;delete e.property;
      if(d)ref(e,d);
      return true;
    }
    function fnRefArg(a){
      if(!a||seen.has(a))return;
      if(a.type==='MemberExpr'){X(a);return}
      if(a.type==='IdentifierExpr'){
        seen.add(a);
        var d=lookup(a.name,a.loc);
        if(d&&d.kind==='fn'){ref(a,d);return}
        if(isLocal(a.name))return;
        if(d){ref(a,d);return}
        if(m.aliases.has(a.name)){E(m,a.loc,'"'+a.name+'" is a module — fnRef needs a function: fnRef('+a.name+'.name)');return}
        if(fr.multi&&!varNames().has(a.name)){E(m,a.loc,'fnRef('+a.name+') — there is no function named "'+a.name+'" in this file or its imports');return}
        free(a.name,a.loc,true);
        return;
      }
      if(a.type==='StringLiteral'&&a.value.indexOf('@cb:')!==0){
        seen.add(a);
        var dot=a.value.indexOf('.'),t=null;
        if(dot>0&&m.aliases.has(a.value.slice(0,dot))){
          var imp=m.aliases.get(a.value.slice(0,dot)),md=imp.target.decls.get(a.value.slice(dot+1));
          if(md&&md.kind==='fn'&&(md.pub||imp.target===m)){imp.used=true;t=md}
        }else t=lookup(a.value,a.loc);
        if(t&&t.kind==='fn')ref(a,t,true);
        else if(/^[A-Za-z_][A-Za-z0-9_]*$/.test(a.value))free(a.value,a.loc,true);
        return;
      }
      X(a);
    }
    function call(e){
      var c=e.callee,isFnRef=false;
      if(c&&c.type==='MemberExpr')X(c);
      if(c&&c.type==='IdentifierExpr'){
        if(!seen.has(c)){
          seen.add(c);
          var d=lookup(c.name,c.loc);
          if(d&&d.kind!=='var')ref(c,d);
          else if(isLocal(c.name))free(c.name,c.loc,true);
          else if(d)ref(c,d);
          else if(m.aliases.has(c.name)){var a=m.aliases.get(c.name);a.used=true;E(m,c.loc,'"'+c.name+'" is a module (import '+a.target.name+'), not a function — call one of its members: '+c.name+'.name(..)')}
          else{free(c.name,c.loc,false);isFnRef=c.name==='fnRef'}
        }
      }else X(c);
      for(var i=0;i<e.args.length;i++){if(isFnRef&&i===0)fnRefArg(e.args[i]);else X(e.args[i])}
    }
    function kids(x){
      for(var k in x){
        if(k==='loc')continue;
        var v=x[k];
        if(!v||typeof v!=='object')continue;
        if(Array.isArray(v)){for(var i=0;i<v.length;i++)node(v[i])}
        else if(v.type)node(v);
      }
    }
    function isStmt(x){return typeof x.type==='string'&&(/Stmt$/.test(x.type)||x.type==='VarDecl')}
    function node(x){if(x&&typeof x==='object'&&typeof x.type==='string'){if(isStmt(x))S(x);else X(x)}}
    function X(e){
      if(!e||typeof e!=='object'||seen.has(e))return;
      seen.add(e);
      switch(e.type){
        case'IdentifierExpr':ident(e);return;
        case'MemberExpr':if(!qualified(e))X(e.object);return;
        case'CallExpr':call(e);return;
        case'AssignExpr':{
          X(e.target);X(e.value);
          var d=resolved.get(e.target);
          if(d&&d.kind==='var'&&d.mod!==m&&!d.node.mutable)E(m,e.target.loc,'"'+d.name+'" is declared with let in module '+d.mod.name+' — it cannot be assigned from another file (declare it: public mut '+d.name+')');
          return;
        }
      }
      kids(e);
    }
    function S(n){
      if(!n||typeof n!=='object')return;
      switch(n.type){
        case'VarDecl':X(n.init);def(n.name,n.loc);return;
        case'WithStmt':X(n.target);scopes.push(new Set());def(n.alias,n.aliasLoc||n.loc);S(n.body);scopes.pop();return;
        case'BlockStmt':scopes.push(new Set());for(var i=0;i<n.statements.length;i++)S(n.statements[i]);scopes.pop();return;
        case'ForStmt':scopes.push(new Set());S(n.init);X(n.condition);X(n.update);S(n.body);scopes.pop();return;
      }
      kids(n);
    }
    m.ast.body.forEach(function(n){
      if(n.type==='FunctionDecl'){
        scopes=[new Set()];
        n.params.forEach(function(p){def(p.name,n.loc)});
        S(n.body);
      }else if(n.type==='VarDecl'&&n.init){scopes=[new Set()];X(n.init)}
    });
    /* struct names in types: struct fields, region element types, `region T` parameters (Ball, p.Ball) */
    (function(){
      function tref(obj,key,loc,wrapped){
        var name=wrapped?/^region<(.+)>$/.exec(obj[key])[1]:obj[key],d=null;
        if(_rgScalar(name)||/^(str|js|arr|numarr|void)$/.test(name))return;
        var dot=name.lastIndexOf('.');
        if(dot>0){
          var al=name.slice(0,dot),imp=m.aliases.get(al);
          if(!imp){E(m,loc,'Unknown module "'+al+'" in the type '+name+' — import it first (import '+al+')');return}
          imp.used=true;d=member(m,imp.target,name.slice(dot+1),loc);if(!d)return;
        }else{
          d=lookup(name,loc);
          if(!d){var sn=[];m.decls.forEach(function(x){if(x.kind==='struct')sn.push(x.name)});E(m,loc,'Unknown type "'+name+'" — use i8 u8 i16 u16 i32 u32 int f32 num bool or a struct name'+hint(name,sn));return}
        }
        if(d.kind!=='struct'){E(m,loc,'"'+name+'" is '+(d.kind==='fn'?'a function':d.kind==='region'?'a region':'a variable')+', not a struct');return}
        (fr._rgTypeFix||(fr._rgTypeFix=[])).push({obj:obj,key:key,decl:d,wrapped:!!wrapped});
      }
      m.ast.body.forEach(function(n){
        if(n.type==='StructDecl')n.fields.forEach(function(f){tref(f,'type',(f.typeRef&&f.typeRef.loc)||f.loc)});
        else if(n.type==='RegionDecl')tref(n,'elem',(n.elemRef&&n.elemRef.loc)||n.loc);
        else if(n.type==='FunctionDecl')n.params.forEach(function(p){if(/^region<.+>$/.test(p.type))tref(p,'type',p.loc||n.loc,true)});
      });
    })();
    m.imps.forEach(function(imp){
      if(!imp.used)W(m,imp.node.loc,'Unused import '+imp.node.path.join('.')+(imp.kind==='star'?'.*':''));
    });
    if(m!==entry)m.decls.forEach(function(d){
      if(d.exported&&/^(frame|onclick_\d+|ontimer_\d+|onhttp_\d+)$/.test(d.name))W(m,d.node.loc,'export fn '+d.name+' in module '+m.name+' is exported as "'+m.name+'.'+d.name+'" — the page only calls '+d.name+'() of the entry file '+entry.path);
    });
  });
  // ── 4. names that stay plain in the merged program (entry-module names, raw WASM imports) must not
  //       capture a name another module leaves to the builtins / JS globals ──
  var rawFirst=new Map(),dropped=new Set();
  function sig(n){return n.module+'|'+n.params.map(function(p){return p.type}).join(',')+'|'+n.returnType}
  function leak(owner,m,loc,name,declHere){
    if(owner.mod===entry&&owner.kind!=='raw'&&!owner.exported){owner.leak=true;return}
    var who=owner.kind==='raw'?'module '+owner.mod.name+' declares a WASM import fn':'the entry file '+entry.path+' exports a function';
    E(m,loc,(declHere?'import fn '+name+' is declared here, but ':'"'+name+'" is not declared or imported in this file, but ')+who+' with that name — in the compiled program the two would be one name: '+(owner.kind==='raw'?'declare the import in this file too, or rename one of them':declHere?'rename one of them':'import it (import '+entry.name+'.'+name+') or rename one of them'));
  }
  mods.forEach(function(m){
    m.ast.body.forEach(function(n){
      if(n.type!=='ImportDecl')return;
      var f=rawFirst.get(n.name);
      if(!f){rawFirst.set(n.name,{node:n,mod:m});
        if(m!==entry){var own=entry.decls.get(n.name);if(own&&own.kind!=='raw')leak(own,m,n.loc,n.name,true)}
        return}
      if(f.mod===m)return;
      if(sig(f.node)===sig(n))dropped.add(n);
      else E(m,n.loc,'import fn '+n.name+' is declared differently in '+f.mod.path+' (line '+((f.node.loc&&f.node.loc.line)||1)+') — a WASM import has one signature and one module per program: make the two declarations the same or rename one');
    });
  });
  mods.forEach(function(m){
    m.free.forEach(function(f,name){
      if(m!==entry){
        var d=entry.decls.get(name);
        if(d&&d.kind!=='raw'&&!(f.fnOnly&&d.kind==='var'))leak(d,m,f.loc,name);
      }
      var r=rawFirst.get(name);
      if(r&&r.mod!==m)leak({mod:r.mod,kind:'raw',exported:false},m,f.loc,name);
    });
  });
  // ── 5. internal names, merged program ──
  var body=[],names=new Map();
  mods.forEach(function(m){
    m.decls.forEach(function(d){
      if(d.kind!=='raw'&&(m!==entry||d.leak)){d.internal=m.name+'.'+d.name;names.set(d.internal,{name:d.name,path:m.path})}
    });
  });
  refs.forEach(function(r){if(r.str)r.node.value=r.decl.internal;else r.node.name=r.decl.internal});
  (fr._rgTypeFix||[]).forEach(function(x){x.obj[x.key]=x.wrapped?'region<'+x.decl.internal+'>':x.decl.internal});
  mods.forEach(function(m){
    m.ast.body.forEach(function(n){
      if(n.type==='PackageDecl'||n.type==='ModImportDecl'||dropped.has(n))return;
      if(n.type==='FunctionDecl'||n.type==='VarDecl'||n.type==='StructDecl'||n.type==='RegionDecl'){
        var d=m.decls.get(n.name);
        if(d&&d.internal!==n.name){n.modName=n.name;n.name=d.internal}
        if(n.type==='StructDecl'||n.type==='RegionDecl'){n.module=m.name;n.path=m.path}
      }
      body.push(n);
    });
  });
  function fmt(list){return list.sort(function(a,b){return a.i-b.i||a.line-b.line||a.col-b.col}).map(function(x){return x.text})}
  return{ast:new Program(body),errors:fmt(errs),warnings:fmt(warns),names:names};
}
// compile(text, target): the entry point. `text` is a single program or a bundle of files.
var compile=function(source,target){
  target=target||'wasm32';
  var t0=performance.now(),fr=_emitModFront(source,false),tokens=fr.tokens;
  var files=fr.files.map(function(f){return f.path});
  function stop(errors,warnings,ast){
    /* module errors: nothing is compiled (an empty module stands in for the program) */
    var wasm=new Uint8Array([0,0x61,0x73,0x6D,1,0,0,0]),imports=[];
    return{wasm:wasm,ast:ast||new Program([]),tokens:tokens,errors:errors,imports:imports,functions:[],injected:[],autoJs:[],elapsed:performance.now()-t0,stats:{tokens:tokens.length,decls:ast?ast.body.length:0,funcs:0,imports:0,bytes:wasm.length},warnings:warnings||[],files:files,modules:_emitModTable(fr)};
  }
  if(fr.errors.length)return stop(fr.errors,[],null);
  var lk=_emitModLink(fr),ast=lk.ast;
  if(lk.errors.length)return stop(lk.errors,lk.warnings,ast);
  var entryPath=fr.mods[0].path;
  function place(msg){
    /* multi-file: a message without a file belongs to the entry file */
    msg=String(msg);
    if(!fr.multi)return msg;
    var at=/^([A-Za-z0-9_.\/-]+\.emit):\d+:\d+: /.exec(msg);
    if(!at)return entryPath+':1:1: '+msg.replace(/^[?\d]+:[?\d]+: /,'');
    /* inside its own file a name is shown as it is written there (count, not game.physics.count) */
    return at[0]+msg.slice(at[0].length).replace(/[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+/g,function(w){var n=lk.names.get(w);return n&&n.path===at[1]?n.name:w});
  }
  var inj,checker,errors,codegen,wasm;
  try{
    inj=injectBuiltins(ast);
    var annotator=new TypeAnnotator();annotator.annotate(ast);
    checker=new TypeChecker();errors=checker.check(ast);
    codegen=new WasmCodegen(ast,target);wasm=codegen.generate();
  }catch(e){
    if(fr.multi&&e&&typeof e.message==='string'&&place(e.message)!==e.message)throw new Error(place(e.message));
    throw e;
  }
  if(fr.multi)errors=errors.map(place);
  return{wasm,ast,tokens,errors,imports:codegen.imports,functions:codegen.functions,injected:inj.injected,autoJs:inj.autoJs,elapsed:performance.now()-t0,stats:{tokens:tokens.length,decls:ast.body.length,funcs:codegen.functions.length,imports:codegen.imports.length,bytes:wasm.length},warnings:lk.warnings,files:files,modules:_emitModTable(fr)};
};
// A cheap index of the project for the editor (autocomplete): lexes and parses only, never throws.
//   { entry: 'main', modules: { 'game.physics': { path, publics: [{name, kind:'fn'|'var', params:[{name,type}],
//     returnType, mutable}], imports: [{module, alias, names:[..]|null, star}],
//     structs: [{name, public, fields:[{name, type}]}], regions: [{name, public, elem, length|null}] } }, errors?: [..] }
// A file that does not parse is indexed from its declaration lines (best effort).
function _emitModuleIndex(text){
  var out={entry:'main',modules:{}};
  try{
    var fr=_emitModFront(text,true);
    out.entry=fr.mods.length?fr.mods[0].name:'main';
    fr.mods.forEach(function(m){
      if(m.bad)return;
      var e={path:m.path,publics:[],imports:[]};_rgIndexAttach(e,{structs:[],regions:[]});
      out.modules[m.name]=e;
      try{
        if(!m.failed){e.publics=_emitModPublics(m);e.imports=_emitModImports(m,fr.byName);_rgIndexAttach(e,_rgIndexOf(m));return}
        var depth=0;
        m.source.split('\n').forEach(function(line){
          var code=line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g,'""').replace(/\/\/.*$/,'');
          if(/^(public|export|fn|import|package|let|mut|use|struct|region)\b/.test(code))depth=0; /* a declaration at the start of a line is top-level, whatever the braces above it say */
          var at=depth;
          for(var i=0;i<code.length;i++){if(code[i]==='{')depth++;else if(code[i]==='}')depth=Math.max(0,depth-1)}
          if(at>0)return;
          var f=/^\s*((?:public\s+|export\s+)+)fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*)?([A-Za-z_][A-Za-z0-9_]*\??)?/.exec(code);
          if(f){
            var ps=[];
            f[3].split(',').forEach(function(p){var q=/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*\??)\s*$/.exec(p);if(q)ps.push({name:q[1],type:q[2]})});
            e.publics.push({name:f[2],kind:'fn',params:ps,returnType:f[4]||'void',mutable:false});
            return;
          }
          var v=/^\s*public\s+(let|mut)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*([A-Za-z_][A-Za-z0-9_]*\??))?\s*(?:=\s*(.*))?$/.exec(code);
          if(v){
            var init=(v[4]||'').trim(),ty=v[3]||(/^""/.test(init)?'str':/^(true|false)\b/.test(init)?'bool':/^null\b/.test(init)?'js':/[.eE]/.test(init)&&/^-?[\d.]/.test(init)?'num':'int');
            e.publics.push({name:v[2],kind:'var',params:[],returnType:ty,mutable:v[1]==='mut'});
            return;
          }
          var rs=/^\s*(public\s+)?struct\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([^}]*)\}?/.exec(code);
          if(rs){var sf=[];rs[3].split(/[,;]/).forEach(function(p){var q=/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_.]*(?:\[[^\]]*\])?)\s*$/.exec(p);if(q)sf.push({name:q[1],type:q[2]})});e.structs.push({name:rs[2],public:!!rs[1],fields:sf});return}
          var rr=/^\s*(public\s+)?region\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\[([^\]]*)\]/.exec(code);
          if(rr){var rl=null;try{rl=_rgTryFold(new Parser(new Lexer(rr[4]).tokenize()).parseExpr())}catch(x){}e.regions.push({name:rr[2],public:!!rr[1],elem:rr[3],length:rl});return}
          var im=/^\s*import\s+(?!fn\b)([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)(\.\*)?(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?\s*;?\s*$/.exec(code);
          if(im){
            var segs=im[1].split('.'),pre=segs.slice(0,-1).join('.');
            if(im[2])e.imports.push({module:im[1],alias:null,names:null,star:true});
            else if(fr.byName.has(im[1])||segs.length<2||!fr.byName.has(pre))e.imports.push({module:im[1],alias:im[3]||segs[segs.length-1],names:null,star:false});
            else e.imports.push({module:pre,alias:im[3]||null,names:[segs[segs.length-1]],star:false});
          }
        });
      }catch(err){(out.errors||(out.errors=[])).push((fr.multi?m.path+':1:1: ':'1:1: ')+String((err&&err.message)||err))}
    });
    if(fr.errors.length)out.errors=(out.errors||[]).concat(fr.errors);
    for(var mn in out.modules)_rgIndexAttach(out.modules[mn],out.modules[mn]); /* structs / regions found line by line */
  }catch(err){
    (out.errors||(out.errors=[])).push('1:1: '+String((err&&err.message)||err));
  }
  return out;
}

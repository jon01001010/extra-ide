// ═══ TOP-LEVEL VALUES ═══
// A top-level `let` / `mut` may start with any expression: a call, an array or object literal, `new …`,
// JS interop, a string built with +, a region read, a value of another module. A literal (number, string,
// true/false, null, constant arithmetic) stays the WASM global's initial value, exactly as before. Any other
// initialiser is moved into a generated exported function "__emitInit.<k> <name> <position>" (one per
// variable, body: one GlobalInitStmt) and its global starts at zero; the runtime runs these once per
// instance, in the order k, before any other export (_emitInitRun, runtime half above).
// Order: a module's values are set after those of the modules it imports (modules that import each other in
// a cycle: in file order), inside a module in source order. An initialiser may use every literal top-level
// value and the non-literal ones set before it; using one that is set later is a compile error (a function
// called by an initialiser sees such a value still at zero). `await` in an initialiser, or a call of a
// function that waits, is a compile error: nothing can wait before the program has started.
// A top-level `let` cannot be assigned anywhere (the checker reports it; the WASM global of a `let` with a
// non-literal initialiser is mutable so that its initialiser can set it).
TypeAnnotator.prototype.lateInit=function(prog){
  var self=this,rank=prog.initRank||null,idx=new Map(),pending=new Map(),steps=[];
  prog.body.forEach(function(n,i){idx.set(n,i)});
  function rk(n){var f=n.loc&&n.loc.file;return rank&&f&&rank.has(f)?rank.get(f):0}
  function at(n){var l=n.loc||{};return(l.file?l.file+':':'')+(l.line||1)+':'+(l.col||1)}
  function disp(n){return n.modName||n.name}
  var late=this.lateVars.slice().sort(function(a,b){return rk(a)-rk(b)||idx.get(a)-idx.get(b)});
  this.lateVars=null;
  late.forEach(function(n){pending.set(n.name,n)});
  late.forEach(function(n,k){
    (function scan(x){
      if(!x||typeof x!=='object')return;
      if(Array.isArray(x)){x.forEach(scan);return}
      if(x.type==='AwaitExpr')self.fail("await cannot be used in the top-level value '"+disp(n)+"' — top-level values are set before the program starts, where nothing can wait: use it inside a function",x.loc||n.loc);
      if(x.type==='IdentifierExpr'&&pending.has(x.name)){
        var o=pending.get(x.name);
        self.fail(o===n?"Top-level '"+disp(n)+"' uses itself in its own initial value":"Top-level '"+disp(n)+"' uses '"+disp(o)+"', which is set later (at "+at(o)+") — top-level values are set in order: move '"+disp(o)+"' above '"+disp(n)+"'",x.loc||n.loc);
      }
      for(var key in x){if(key==='loc')continue;var v=x[key];if(v&&typeof v==='object')scan(v)}
    })(n.init);
    var it=self.a(n.init),t=n.varType;
    if(it==='void')self.fail("Top-level '"+disp(n)+"' — this call returns nothing, so there is no value to start with",n.init.loc||n.loc);
    if(!t)t=(it==='null')?'js':(it||'int');
    else self.want(n.init,t);
    pending.delete(n.name);
    self.globals.set(n.name,t);self.def(n.name,t);
    n.declType=t;n.varType=t;n.lateInit=n.init;n.init=null;
    var fn=new FunctionDecl('__emitInit.'+k+' '+disp(n)+' '+at(n),[],'void',new BlockStmt([{type:'GlobalInitStmt',name:n.name,value:n.lateInit,decl:n,loc:n.loc}],n.loc),true,n.loc);
    fn.emitInit=n;steps.push(fn);
  });
  steps.forEach(function(f){prog.body.push(f)});
  prog.initFns=steps;
};
(function(){
  // an initialiser that calls a function that waits (await)
  var P=TypeAnnotator.prototype,ann0=P.annotate;
  P.annotate=function(prog){
    var r=ann0.apply(this,arguments);
    if(prog.initFns&&prog.asyncFns&&prog.asyncFns.length){
      var as=new Set(prog.asyncFns),self=this;
      prog.initFns.forEach(function(f){
        if(!as.has(f.name))return;
        var n=f.emitInit,bad=null;
        (function scan(x){
          if(bad||!x||typeof x!=='object')return;
          if(Array.isArray(x)){x.forEach(scan);return}
          if(x.type==='CallExpr'&&x.callee&&x.callee.type==='IdentifierExpr'&&as.has(x.callee.name)){bad=x;return}
          for(var k in x){if(k==='loc')continue;var v=x[k];if(v&&typeof v==='object')scan(v)}
        })(n.lateInit);
        self.fail("Top-level '"+(n.modName||n.name)+"' calls "+(bad?bad.callee.name+'()':'a function')+", which waits (await) — top-level values are set before the program starts, where nothing can wait: call it inside a function",(bad&&bad.loc)||n.loc);
      });
    }
    return r;
  };
  var C=TypeChecker.prototype,check0=C.check,cn0=C.cn,inf0=C.inf;
  C.check=function(prog){
    var lets=this.letGlobals=new Map();
    prog.body.forEach(function(n){if(n&&n.type==='VarDecl'&&!n.mutable)lets.set(n.name,n)});
    this.letSeen=new Set();
    return check0.apply(this,arguments);
  };
  C.cn=function(n){
    if(n&&n.type==='GlobalInitStmt'){
      var t=n.decl.declType,it=this.inf(n.value);
      if(t&&it&&t!==it&&!this.compat(t,it))this.err('Cannot assign '+it+' to '+t,n.value.loc||n.loc);
      return;
    }
    return cn0.apply(this,arguments);
  };
  C.inf=function(e){
    if(e&&e.type==='AssignExpr'&&e.target&&e.target.type==='IdentifierExpr'&&this.letGlobals&&this.letGlobals.has(e.target.name)&&!this.letSeen.has(e)){
      var local=false;
      for(var i=this.scopes.length-1;i>0;i--)if(this.scopes[i].has(e.target.name)){local=true;break}
      if(!local){
        var d=this.letGlobals.get(e.target.name);this.letSeen.add(e);
        this.err("'"+(d.modName||d.name)+"' is declared with let, so it cannot be changed — declare it with mut to assign it",e.target.loc||e.loc);
      }
    }
    return inf0.apply(this,arguments);
  };
  var G=WasmCodegen.prototype,gen0=G.generate,stmt0=G.genStmt;
  G.generate=function(){
    var late=((this.ast&&this.ast.body)||[]).filter(function(n){return n&&n.type==='VarDecl'&&n.lateInit&&!n.mutable});
    late.forEach(function(n){n.mutable=true});
    try{return gen0.apply(this,arguments)}
    finally{late.forEach(function(n){n.mutable=false})}
  };
  G.genStmt=function(s){
    if(s&&s.type==='GlobalInitStmt'){
      var g=this.globalMap.get(s.name),vt=s.value.exprType,isI=vt==='int'||vt==='i64',isN=vt==='num'||vt==='f64';
      /* an i32 / f32 global from an int / num value: generated in its own type, then converted */
      if(g.type==='i32'&&(isI||isN)){this.genExpr(s.value,isI?'int':'num');this.emit(...(isI?[0xA7]:[0xFC,0x02]))}
      else if(g.type==='f32'&&(isI||isN)){this.genExpr(s.value,isI?'int':'num');this.emit(isI?0xB4:0xB6)}
      else this.genExpr(s.value,g.type);
      this.emit(0x24,...eu32(g.idx));
      return;
    }
    return stmt0.apply(this,arguments);
  };
})();
// Init order of the modules: the modules a module imports come first; modules in an import cycle keep file
// order. Tarjan's algorithm emits every strongly connected component after the ones it reaches.
_emitModLink=(function(link){return function(fr){
  var r=link.apply(this,arguments);
  try{
    if(r&&r.ast&&fr&&fr.multi&&fr.mods){
      var mods=fr.mods.filter(function(m){return!m.bad&&m.ast}),num=new Map(),low=new Map(),on=new Set(),st=[],n=0,order=[];
      function deps(m){var o=[];(m.imps||[]).forEach(function(i){if(i.target&&i.target!==m&&o.indexOf(i.target)<0&&mods.indexOf(i.target)>=0)o.push(i.target)});return o}
      function visit(m){
        num.set(m,n);low.set(m,n);n++;st.push(m);on.add(m);
        deps(m).forEach(function(d){
          if(!num.has(d)){visit(d);low.set(m,Math.min(low.get(m),low.get(d)))}
          else if(on.has(d))low.set(m,Math.min(low.get(m),num.get(d)));
        });
        if(low.get(m)===num.get(m)){
          var comp=[],x;
          do{x=st.pop();on.delete(x);comp.push(x)}while(x!==m);
          comp.sort(function(a,b){return a.index-b.index}).forEach(function(c){order.push(c)});
        }
      }
      mods.forEach(function(m){if(!num.has(m))visit(m)});
      var rank=new Map();order.forEach(function(m,i){rank.set(m.path,i)});
      r.ast.initRank=rank;
    }
  }catch(e){}
  return r;
}})(_emitModLink);
// The Run output: the red line of a top-level value that could not be set (clickable, like a compile error).
function _emitInitErrHtml(msg){
  try{_projMarkErrors([msg])}catch(e){}
  var pr=null;try{pr=_projErrRef(msg)}catch(e){}
  if(pr)return _projErrSpan(pr,'✗ '+msg)+'\n';
  var m=/^(\d+):\d+: /.exec(msg);
  return m?'<span class="err clickable-err" onclick="jumpToLine('+m[1]+')">'+h('✗ '+msg)+'</span>\n':sp('err','✗ '+msg)+'\n';
}

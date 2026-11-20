// ═══ DECLARED TYPES AND OPERATORS ═══
// Every combination of declared type and use either compiles to valid WebAssembly or is a compile error with a
// position (tests/run-rough.js "types" audits every type as a global, a local and a parameter: read, assigned
// from every type, arithmetic, comparison, passed to print / printNum / printStr, returned).
//   - i8 u8 i16 u16 i32 u32 f32 are storage types of struct fields and region elements. A variable, parameter or
//     return value declared with one is a compile error (it used to compile to invalid WebAssembly): use int / num.
//   - + - * /: numbers (int, num, js) — + also joins text when one side is a str. A bool, a str (except +), null
//     or an array next to anything but an int is an error. % & | ^ << >>: whole numbers only (int); a num or a
//     JS value (convert it: toInt(x)) is an error.
//   - == / !=: two values of the same kind, int with num, int with an array (array ids), a js value with anything
//     but an array, null with int / js / an array. < > <= >=: no null; an array only with int.
//   - ! needs a bool (or a js value); - needs a number.
//   - assignment x = v: an int takes int / js / an array (a num must be rounded: floor(x)); a num takes int, num,
//     bool, js; a bool, str, array only their own kind (or js); null goes into int, js, str and arrays.
(function(){
  var P=TypeAnnotator.prototype,a0=P.a,ann0=P.annotate;
  var STORE={i8:1,u8:1,i16:1,u16:1,i32:1,u32:1,f32:1};
  function k(t){t=String(t||'');if(t==='int'||t==='i64')return'int';if(t==='num'||t==='f64')return'num';if(t==='arr'||t==='numarr')return'arr';if(t==='bool'||t==='str'||t==='js'||t==='null'||t==='void')return t;return null}
  function shown(e){var c=e&&e.jsConv;return String(c?c.from:e&&e.exprType)}
  function an(t){return(/^[aeiou]/.test(t)?'an ':'a ')+t}
  P.annotate=function(prog){
    var self=this;
    function bad(t,what,loc){self.fail(what+' is declared as '+t+' — i8 u8 i16 u16 i32 u32 and f32 are storage types for struct fields and region elements; a variable, parameter or result is int or num',loc)}
    (function scan(x,inFn){
      if(!x||typeof x!=='object')return;
      if(Array.isArray(x)){x.forEach(function(y){scan(y,inFn)});return}
      if(x.type==='VarDecl'&&STORE[String(x.varType)])bad(x.varType,"'"+(x.modName||x.name)+"'",x.loc);
      if(x.type==='FunctionDecl'){
        (x.params||[]).forEach(function(p){if(STORE[String(p.type)])bad(p.type,"Parameter '"+p.name+"' of "+(x.modName||x.name)+'()',p.loc||x.loc)});
        if(STORE[String(x.returnType)])bad(x.returnType,'The result of '+(x.modName||x.name)+'()',x.loc);
      }
      if(x.type==='StructDecl'||x.type==='RegionDecl'||x.type==='ImportDecl')return;
      for(var key in x){if(key==='loc')continue;var v=x[key];if(v&&typeof v==='object')scan(v,inFn)}
    })(prog.body,false);
    return ann0.apply(this,arguments);
  };
  var ARITH={'+':1,'-':1,'*':1,'/':1},WHOLE={'%':1,'&':1,'|':1,'^':1,'<<':1,'>>':1},EQ={'==':1,'!=':1},REL={'<':1,'>':1,'<=':1,'>=':1};
  P.opCheck=function(e){
    var L=k(e.left.exprType),R=k(e.right.exprType),op=e.op,self=this;
    if(!L||!R||e.jsCmp)return;
    function no(m){self.fail(m,e.loc)}
    if(ARITH[op]){
      if(op==='+'&&(L==='str'||R==='str'||e.strCat))return;
      [[L,e.left],[R,e.right]].forEach(function(p){
        if(p[0]==='bool'||p[0]==='null'||p[0]==='void'||p[0]==='str')no(op+' needs numbers, but '+(p[1]===e.left?'the left':'the right')+' side is '+an(shown(p[1]))+(p[0]==='bool'?' — a bool is not a number':p[0]==='str'&&op!=='+'?' — only + works on text':''));
      });
      if((L==='arr'&&R!=='int'&&R!=='arr'&&R!=='js')||(R==='arr'&&L!=='int'&&L!=='arr'&&L!=='js'))no(op+' on an array — use one of its elements: xs[i]');
      return;
    }
    if(WHOLE[op]){
      var ok=function(x){return x==='int'||x==='arr'};
      if(!ok(L)||!ok(R)){var s=!ok(L)?e.left:e.right;no(op+' works on whole numbers (int), but '+(s===e.left?'the left':'the right')+' side is '+an(shown(s))+(k(shown(s))==='js'?' — convert it first: toInt(x)':k(shown(s))==='num'?' — round it first: floor(x)':''))}
      return;
    }
    if(EQ[op]){
      if(L===R)return;
      var pair=function(a,b){return(L===a&&R===b)||(L===b&&R===a)};
      if(pair('int','num')||pair('int','arr'))return;
      if((L==='js'&&R!=='arr')||(R==='js'&&L!=='arr'))return;
      if(pair('null','int')||pair('null','js')||pair('null','arr'))return;
      no("Can't compare "+an(shown(e.left))+' with '+an(shown(e.right))+' using '+op+(pair('str','null')?' — a str is never null: compare with ""':''));
    }
    if(REL[op]){
      if(L==='null'||R==='null')no("Can't use "+op+' with null — compare with == or !=');
      if((L==='arr'&&R!=='int'&&R!=='arr')||(R==='arr'&&L!=='int'&&L!=='arr'))no("Can't compare "+an(shown(e.left))+' with '+an(shown(e.right))+' using '+op);
    }
  };
  P.asgCheck=function(e){
    var name=e.target.name,local=false,tt=null;
    for(var i=this.scopes.length-1;i>0;i--)if(this.scopes[i].has(name)){local=true;tt=this.scopes[i].get(name);break}
    if(!local)tt=this.globals.get(name);
    var T=k(tt),v=e.value,V=k(v&&v.exprType),self=this;
    function no(hint){self.fail('Cannot assign '+an(shown(v))+" to '"+name+"' ("+tt+')'+(hint||''),v.loc||e.loc)}
    if(V==='null'&&T){if(T==='int'||T==='arr'||T==='js'){if(local||T==='arr')v.argConv={from:'int',ops:[]};return}if(T==='str')return;return no()}
    if(!T||!V||T===V||T==='js'||V==='js')return;
    if(T==='int'){if(V==='arr')return;return no(V==='num'?' — round it first, e.g. floor(x)':'')}
    if(T==='num'){if(V==='int'){if(local)v.argConv={from:'int',ops:[0xB9]};return}if(V==='bool'){v.argConv={from:'bool',ops:[0xB8]};return}return no()}
    if(T==='arr'&&V==='int')return;
    no();
  };
  var walk0=P.walk;
  P.walk=function(n){
    var r=walk0.apply(this,arguments);
    /* let x: num = aBool — the initial value is converted like an assignment */
    if(n&&n.type==='VarDecl'&&n.init&&k(n.declType)==='num'&&k(n.init.exprType)==='bool')n.init.argConv={from:'bool',ops:[0xB8]};
    return r;
  };
  P.a=function(e){
    var t=a0.apply(this,arguments);
    if(!e||typeof e!=='object')return t;
    if(e.type==='BinaryExpr'&&e.left&&e.right)this.opCheck(e);
    else if(e.type==='UnaryExpr'&&e.operand){
      var O=k(e.operand.exprType);
      if(e.op==='!'&&O&&O!=='bool'&&O!=='js')this.fail('! needs a bool, but this is '+an(shown(e.operand))+(O==='int'||O==='num'?' — write x == 0':''),e.loc);
      if(e.op==='-'&&O&&O!=='int'&&O!=='num'&&O!=='js')this.fail('- needs a number, but this is '+an(shown(e.operand)),e.loc);
    }
    else if(e.type==='AssignExpr'&&e.target&&e.target.type==='IdentifierExpr'&&e.value&&!e.arrOp)this.asgCheck(e);
    return t;
  };
})();

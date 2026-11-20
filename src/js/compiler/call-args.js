// ═══ CALL ARGUMENTS ═══
// Every argument of a call of a builtin, an Emit function or a WASM import fn reaches the parameter in its
// declared type, or the program does not compile — never invalid WebAssembly (print(x) with x: num used to
// pass an f64 to the i64 parameter of print). After the annotator has typed a call:
//   print      num → printNum, str → printStr, bool → printStr("true"/"false")
//   builtins   int parameter: num → int (truncated toward zero; NaN → 0), bool → 0/1
//              num parameter: bool → 0/1
//              str parameter: int / num / bool / arr → its text (as in "x: " + x)
//              anything else that does not fit (a str for an int, an arr for a num …): a compile error
//   Emit functions and import fns: num parameter: bool → 0/1 (as `let x: num = true`); anything else that
//              does not fit is a compile error naming the function, the parameter and both types.
// js values keep the conversions the annotator already makes (want()); a void call as an argument is an error.
(function(){
  var P=TypeAnnotator.prototype,a0=P.a,ann0=P.annotate;
  function kind(t){t=String(t||'');if(t==='int'||t==='i64')return'int';if(t==='num'||t==='f64')return'num';if(t==='arr'||t==='numarr')return t;if(t==='bool'||t==='str'||t==='js'||t==='void'||t==='null'||t==='i32'||t==='f32')return t;return null}
  P.a=function(e){
    var t=a0.apply(this,arguments);
    if(!e||e.type!=='CallExpr'||!e.callee||e.callee.type!=='IdentifierExpr'||e.jsCall||e.arrOp)return t;
    var name=e.callee.name,fn=this.functions.get(name);
    if(!fn||fn.module==='js'||(fn.node&&fn.node.auto)||/^__/.test(name))return t;
    var b=BUILTINS[name],builtin=!!(b&&fn.node&&fn.node.type==='ImportDecl'&&fn.node.module===b.module),self=this;
    var shown=(fn.node&&fn.node.modName)||name;
    if(builtin&&name==='print'&&e.args.length===1){
      var at=kind(e.args[0].exprType);
      if(at==='num'){e.callee.name='printNum';this.needBuiltin('printNum');return t}
      if(at==='f32'){e.callee.name='printNum';this.needBuiltin('printNum');e.args[0].argConv={from:'f32',ops:[0xBB]};return t}
      if(at==='str'||at==='bool'){if(at==='bool')this.conv(e.args[0],'str');e.callee.name='printStr';this.needBuiltin('printStr');return t}
    }
    e.args.forEach(function(arg,i){
      var pt=fn.params[i],pk=kind(pt),ak=kind(arg.exprType);
      if(!pk||!ak||ak==='null')return;
      var pn=(fn.node&&fn.node.params&&fn.node.params[i]&&fn.node.params[i].name)||('#'+(i+1));
      function bad(hint){self.fail(shown+'(): parameter '+pn+' is '+pt+', but this is '+arg.exprType+(hint||''),arg.loc||e.loc)}
      if(ak==='void')self.fail(shown+'(): this argument is a call that returns nothing — there is no value to pass as '+pn,arg.loc||e.loc);
      if(pk===ak)return;
      if(pk==='js'){if(ak==='i32'||ak==='f32')return bad(' — store it in an int or num first');return}
      if(pk==='i32'){
        if(ak==='int'){arg.argConv={from:'int',ops:[0xA7]};return}
        if(ak==='bool')return;
        return bad();
      }
      if(pk==='f32'){
        if(ak==='num'){arg.argConv={from:'num',ops:[0xB6]};return}
        if(ak==='int'){arg.argConv={from:'int',ops:[0xB4]};return}
        if(ak==='i32'){arg.argConv={from:'i32',ops:[0xB2]};return}
        return bad();
      }
      if(pk==='int'){
        if(ak==='arr'||ak==='numarr'||ak==='js')return;
        if(ak==='i32'){arg.argConv={from:'i32',ops:[0xAC]};return}
        if(builtin&&ak==='f32'){arg.argConv={from:'f32',ops:[0xFC,0x04]};return}
        if(builtin&&ak==='num'){arg.argConv={from:'num',ops:[0xFC,0x06]};return}
        if(builtin&&ak==='bool'){arg.argConv={from:'bool',ops:[0xAD]};return}
        return bad(ak==='num'?' — round it first, e.g. floor(x)':'');
      }
      if(pk==='num'){
        if(ak==='int')return;
        if(ak==='bool'){arg.argConv={from:'bool',ops:[0xB8]};return}
        if(ak==='i32'){arg.argConv={from:'i32',ops:[0xB7]};return}
        if(ak==='f32'){arg.argConv={from:'f32',ops:[0xBB]};return}
        return bad();
      }
      if(pk==='str'){
        if(builtin&&(ak==='int'||ak==='num'||ak==='bool'||ak==='arr'||ak==='numarr')){self.conv(arg,'str');return}
        return bad(builtin?'':' — make it text first, e.g. "" + x');
      }
      if(pk==='arr'||pk==='numarr'){if((pk==='arr'&&ak==='numarr')||(pk==='numarr'&&ak==='arr')||ak==='int')return;return bad()}
      if(pk==='bool'){if(ak==='i32')return;return bad()}
    });
    return t;
  };
  // print → printNum / printStr: the builtin is declared (now for the annotator, after annotate() in the program)
  P.needBuiltin=function(n){
    if(this.functions.has(n))return;
    var b=BUILTINS[n],d=new ImportDecl(n,b.params.map(function(p){return{name:p.name,type:p.type}}),b.returnType,b.module,{line:0,col:0});
    this.functions.set(n,{params:d.params.map(function(p){return p.type}),returnType:d.returnType,module:d.module,node:d,allJs:d.params.map(function(){return true}),calls:0});
    (this.builtinsNeeded||(this.builtinsNeeded=[])).push(d);
  };
  P.annotate=function(prog){
    var r=ann0.apply(this,arguments);
    if(this.builtinsNeeded)this.builtinsNeeded.forEach(function(d){
      if(!prog.body.some(function(x){return(x.type==='ImportDecl'||x.type==='FunctionDecl')&&x.name===d.name}))prog.body.unshift(d);
    });
    return r;
  };
  var G=WasmCodegen.prototype,expr0=G.genExpr;
  G.genExpr=function(e,exp){
    var c=e&&e.argConv;
    if(!c)return expr0.apply(this,arguments);
    e.argConv=null;
    try{expr0.call(this,e,c.from)}finally{e.argConv=c}
    this.emit(...c.ops);
  };
})();

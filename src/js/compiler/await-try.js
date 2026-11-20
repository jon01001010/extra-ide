// ═══ await · try / catch / finally / throw · arr ═══
// Compiler half; the runtime half is _emitExtraImport() and friends in the runtime block.
//
// await <expr>      AwaitExpr, type js. Compiled to t = __awaitPre(h) (a plain import: is it a promise that must
//                   be waited for?) and, only then, __await(t) — an import the runtime wraps in
//                   WebAssembly.Suspending (JSPI) — followed by __awaitPost(t). A function that contains `await`, or calls an Emit function
//                   that does, is "async" (FunctionDecl.isAsync); their names travel on the import list
//                   (imports.asyncFns) so the runtime enters them through WebAssembly.promising.
// try/catch/throw   No WebAssembly exception opcodes. The runtime keeps a "catching" mode (__trySet) and a pending
//                   error (__tryErr / __tryTake). While the mode is on, a failing interop call records the error
//                   instead of printing the red line; the compiler emits "if pending → branch to the catch" after
//                   every operation that can fail inside a try block, and "if pending → return" after every such
//                   operation in functions that can be called from inside a try block (FunctionDecl.tryAware —
//                   found from the call graph: functions called in a try block, fnRef callbacks, and what those
//                   call). Programs without `try` get none of these checks.
// arr / numarr      Static types for Emit arrays (the i64 id that newArray / [1, 2, 3] return): xs[i], xs[i] = v,
//                   xs.length, xs.push(v), xs.pop(); handed to JS they are converted to a real JS array (__arrJs).
KW.add('await');KW.add('try');KW.add('catch');KW.add('finally');KW.add('throw');
BUILTINS.sleep.returnType='js';     // sleep(ms) → a promise that resolves after ms milliseconds: `await sleep(500)`
BUILTINS.newArray.returnType='arr';
class AwaitExpr extends Z{constructor(o,l){super('AwaitExpr',l);this.operand=o}}
class TryStmt extends Z{constructor(b,h,f,l){super('TryStmt',l);this.body=b;this.handler=h;this.finalizer=f}}
class ThrowStmt extends Z{constructor(v,l){super('ThrowStmt',l);this.value=v}}
class PendingErrExpr extends Z{constructor(l){super('PendingErrExpr',l)}} // the caught error: `catch (e)` is `let e: js = <pending error>`
_JS_CONV_IMPORTS.__awaitPre=[[['h','js']],'int'];   // 0: h is not a promise, use it as it is; else a ticket for __await
_JS_CONV_IMPORTS.__await=[[['t','int']],'js'];      // suspends (JSPI) until the promise settles
_JS_CONV_IMPORTS.__awaitPost=[[['t','int']],'void'];// first thing after resuming: restore this call's state, raise a rejection
_JS_CONV_IMPORTS.__trySet=[[['on','bool']],'bool']; // set the catching mode, returns the previous one
_JS_CONV_IMPORTS.__tryErr=[[],'bool'];              // is an error pending?
_JS_CONV_IMPORTS.__tryTake=[[],'js'];               // the pending error (clears it)
_JS_CONV_IMPORTS.__throwStr=[[['s','str']],'void'];
_JS_CONV_IMPORTS.__throwJs=[[['h','js']],'void'];
_JS_CONV_IMPORTS.__arrGet=[[['a','int'],['i','int']],'int'];
_JS_CONV_IMPORTS.__arrGetN=[[['a','int'],['i','int']],'num'];
_JS_CONV_IMPORTS.__arrSet=[[['a','int'],['i','int'],['v','int']],'void'];
_JS_CONV_IMPORTS.__arrSetN=[[['a','int'],['i','int'],['v','num']],'void'];
_JS_CONV_IMPORTS.__arrLen=[[['a','int']],'int'];
_JS_CONV_IMPORTS.__arrPush=[[['a','int'],['v','int']],'void'];
_JS_CONV_IMPORTS.__arrPushN=[[['a','int'],['v','num']],'void'];
_JS_CONV_IMPORTS.__arrPop=[[['a','int']],'int'];
_JS_CONV_IMPORTS.__arrPopN=[[['a','int']],'num'];
_JS_CONV_IMPORTS.__arrJs=[[['a','int']],'js'];      // Emit array → a new JS array (what toJsArray does)
_JS_CONV_IMPORTS.__arrStr=[[['a','int']],'str'];    // Emit array → "1,2,3" (operand of str + …)
_jsConvFn=(function(f){return function(c){
  if(c.from==='arr'||c.from==='numarr'){if(c.to==='js')return'__arrJs';if(c.to==='str')return'__arrStr'}
  return f(c);
}})(_jsConvFn);
// `arr` / `numarr` are ordinary identifiers (so a variable may be called arr) except as a return type
// written without an arrow: `fn make() arr {`.
(function(){
  var tokenize1=Lexer.prototype.tokenize;
  Lexer.prototype.tokenize=function(){
    var ts=tokenize1.call(this);
    for(var i=1;i+1<ts.length;i++){
      if(ts[i].type===TT.IDENTIFIER&&(ts[i].value==='arr'||ts[i].value==='numarr')&&ts[i-1].type===TT.RPAREN&&ts[i+1].type===TT.LBRACE)ts[i].type=TT.TYPE;
    }
    return ts;
  };
})();
(function(){
  var P=Parser.prototype,stmt0=P.parseStmt,unary0=P.parseUnary;
  P.parseStmt=function(){
    if(this.check(TT.KEYWORD,'try'))return this.parseTry();
    if(this.check(TT.KEYWORD,'throw')){
      const l=this.loc();this.adv();
      if(this.check(TT.RBRACE)||this.check(TT.EOF))throw this.err('throw needs a value — throw "what went wrong" or throw e');
      const v=this.parseExpr();this.match(TT.SEMICOLON);
      return new ThrowStmt(v,l);
    }
    if(this.check(TT.KEYWORD,'catch')||this.check(TT.KEYWORD,'finally'))throw this.err('"'+this.cur().value+'" must follow the } of a try { } block');
    return stmt0.call(this);
  };
  P.parseTry=function(){
    const l=this.loc();this.adv();
    if(!this.check(TT.LBRACE))throw this.err('Expected { after try');
    const body=this.parseBlock();
    let handler=null,fin=null;
    if(this.check(TT.KEYWORD,'catch')){
      const cl=this.loc();this.adv();
      let name=null;
      if(this.match(TT.LPAREN)){
        if(!this.check(TT.IDENTIFIER))throw this.err('Expected a name for the error after catch ( — write catch (e) { }');
        name=this.adv().value;
        if(this.match(TT.COLON))this.parseType();
        this.expect(TT.RPAREN);
      }
      if(!this.check(TT.LBRACE))throw this.err('Expected { after catch'+(name?' ('+name+')':''));
      handler=this.parseBlock();
      handler.statements.unshift(name?new VarDecl(name,'js',new PendingErrExpr(cl),false,cl):new ExprStmt(new PendingErrExpr(cl),cl));
    }
    if(this.check(TT.KEYWORD,'finally')){
      this.adv();
      if(!this.check(TT.LBRACE))throw this.err('Expected { after finally');
      fin=this.parseBlock();
    }
    if(!handler&&!fin)throw this.err('try { } needs a catch (e) { } or a finally { } block after it');
    return new TryStmt(body,handler,fin,l);
  };
  P.parseUnary=function(){
    if(this.check(TT.KEYWORD,'await')){const l=this.loc();this.adv();return new AwaitExpr(this.parseUnary(),l)}
    return unary0.call(this);
  };
})();
(function(){
  var P=TypeAnnotator.prototype,a0=P.a,walk0=P.walk,want0=P.want,jsArg0=P.jsArg,recv0=P.recv,annotate0=P.annotate;
  function isArr(t){return t==='arr'||t==='numarr'}
  // An Emit array where a JS value is wanted becomes a real JS array.
  P.want=function(e,t){
    if(e&&e.type!=='ArrayLiteral'&&isArr(e.exprType)&&t==='js')return this.conv(e,'js');
    if(e&&e.exprType==='js'&&isArr(t))this.fail("This is a JS value, but an Emit array ("+t+") is needed here — declare it as js to keep the JS array",e.loc);
    return want0.call(this,e,t);
  };
  P.jsArg=function(e){const t=jsArg0.call(this,e);return isArr(t)?this.conv(e,'js'):t};
  P.recv=function(e){if(isArr(e.exprType)){this.conv(e,'js');return}recv0.call(this,e)};
  // A value stored into an Emit array: arr holds ints (and handles / string pointers), numarr holds nums.
  P.arrVal=function(v,num){
    const vt=this.a(v);
    if(num){
      if(vt==='js')this.conv(v,'num');
      else if(!(this.isN(vt)||this.isI(vt)||vt==='f32'))this.fail("This array holds nums (numarr) — a "+vt+" can't be stored in it",v.loc);
    }else{
      if(vt==='js')this.conv(v,'inth');
      else if(this.isN(vt)||vt==='f32')this.fail("This array holds whole numbers (arr) — a num can't be stored in it. Start it with a decimal ([1.0, 2.5]) or declare it `numarr` to hold nums, or round the value with floor()",v.loc);
      else if(vt==='void')this.fail("This call returns nothing — there is no value to store",v.loc);
    }
  };
  // Several cases below must know the type of a child before deciding whether the original a() handles
  // the node. this.memo names that child so the original does not annotate it a second time.
  P.aRest=function(e,child){this.memo=child;const t=a0.call(this,e);this.memo=null;return t};
  P.a=function(e){
    if(!e)return a0.call(this,e);
    if(this.memo===e){this.memo=null;return e.exprType}
    if(e.arrOp)delete e.arrOp;
    switch(e.type){
      case'BinaryExpr':{
        if(e.op!=='+')break;
        let t;
        try{t=a0.call(this,e)}
        catch(err){
          /* "xs: " + xs — an Emit array in a string is written as JS writes arrays (1,2,3) */
          const l=e.left,r=e.right,la=isArr(l.exprType),ra=isArr(r.exprType);
          if(!((la&&r.exprType==='str')||(ra&&l.exprType==='str'))||l.jsConv||r.jsConv)throw err;
          this.conv(la?l:r,'str');
          e.strCat=true;this.need('__strCat');
          e.exprType=t='str';
        }
        return t;
      }
      case'AwaitExpr':{
        if(e.jsConv)delete e.jsConv;
        const ot=this.a(e.operand);
        if(ot==='void')this.fail("await needs a value, but this call returns nothing",e.loc);
        if(ot==='str'||ot==='bool'||this.isN(ot)||isArr(ot))this.conv(e.operand,'js');
        this.need('__awaitPre');this.need('__await');this.need('__awaitPost');
        e.exprType='js';return'js';
      }
      case'PendingErrExpr':
        if(e.jsConv)delete e.jsConv;
        this.need('__tryTake');
        e.exprType='js';return'js';
      case'ArrayLiteral':{
        a0.call(this,e);
        e.exprType=e.jsArr?'js':(e.elemType==='num'?'numarr':'arr');
        return e.exprType;
      }
      case'IndexExpr':{
        const ot=this.a(e.object);
        if(!isArr(ot))return this.aRest(e,e.object);
        if(e.jsConv)delete e.jsConv;
        const it=this.a(e.index);
        if(it==='js')this.conv(e.index,'int');
        else if(!this.isI(it))this.fail("An array index must be an int, but this is "+it,e.index.loc||e.loc);
        e.arrOp='get';e.arrElem=ot==='numarr'?'num':'int';
        this.need(ot==='numarr'?'__arrGetN':'__arrGet');
        e.exprType=e.arrElem;return e.exprType;
      }
      case'MemberExpr':{
        const ot=this.a(e.object);
        if(!(isArr(ot)&&e.property==='length'))return this.aRest(e,e.object);
        if(e.jsConv)delete e.jsConv;
        e.arrOp='len';this.need('__arrLen');
        e.exprType='int';return'int';
      }
      case'CallExpr':{
        const c=e.callee;
        if(c.type==='MemberExpr'&&(c.property==='push'||c.property==='pop')){
          const ot=this.a(c.object);
          if(isArr(ot)){
            if(e.jsConv)delete e.jsConv;
            const num=ot==='numarr';
            e.arrElem=num?'num':'int';
            if(c.property==='push'){
              if(e.args.length!==1)this.fail("push takes exactly one value: xs.push(v)",e.loc);
              this.arrVal(e.args[0],num);
              e.arrOp='push';this.need(num?'__arrPushN':'__arrPush');
              e.exprType='void';return'void';
            }
            if(e.args.length)this.fail("pop takes no arguments: xs.pop()",e.loc);
            e.arrOp='pop';this.need(num?'__arrPopN':'__arrPop');
            e.exprType=e.arrElem;return e.exprType;
          }
          return this.aRest(e,c.object);
        }
        return a0.call(this,e);
      }
      case'AssignExpr':{
        if(e.target.type==='IndexExpr'){
          this.a(e.target);
          if(e.target.arrOp==='get'){
            if(e.jsConv)delete e.jsConv;
            const num=e.target.arrElem==='num';
            this.arrVal(e.value,num);
            e.arrOp='set';e.arrElem=e.target.arrElem;this.need(num?'__arrSetN':'__arrSet');
            e.exprType='void';return'void';
          }
          return this.aRest(e,e.target);
        }
        return a0.call(this,e);
      }
    }
    return a0.call(this,e);
  };
  P.walk=function(n){
    if(n&&n.type==='TryStmt'){
      this.need('__trySet');this.need('__tryErr');this.need('__tryTake');
      if(n.finalizer)this.need('__throwJs');
      this.walk(n.body);
      if(n.handler)this.walk(n.handler);
      if(n.finalizer)this.walk(n.finalizer);
      return;
    }
    if(n&&n.type==='ThrowStmt'){
      const t=this.a(n.value);
      if(t==='str')n.throwFn='__throwStr';
      else if(t==='js'||this.isI(t))n.throwFn='__throwJs';
      else if(isArr(t)){this.conv(n.value,'js');n.throwFn='__throwJs'}
      else if(this.isN(t)||t==='bool'){this.conv(n.value,'str');n.throwFn='__throwStr'}
      else this.fail("throw needs a value — a message string or a js value (the error from a catch)",n.loc);
      this.need(n.throwFn);
      return;
    }
    return walk0.call(this,n);
  };
  // After annotation: which functions are async (contain await or call one that does) and which can run
  // inside a try block of a caller (called from a try block, or from a function that is).
  P.annotate=function(prog){
    annotate0.call(this,prog);
    const fns=new Map(),cbTargets=new Set();
    let hasTry=false;
    for(const n of prog.body)if(n.type==='FunctionDecl')fns.set(n.name,{node:n,calls:new Set(),tryCalls:new Set(),hasAwait:false,async:false});
    for(const info of fns.values()){
      (function visit(x,inTry){
        if(!x||typeof x!=='object')return;
        if(Array.isArray(x)){for(const c of x)visit(c,inTry);return}
        if(x.type==='AwaitExpr')info.hasAwait=true;
        if(x.type==='TryStmt'){inTry=true;hasTry=true}
        /* fnRef(f): JS may call f while the caller is inside a try block (list.forEach(fnRef(f))) */
        if(x.type==='CallExpr'&&x.callee&&x.callee.type==='IdentifierExpr'&&x.callee.name==='fnRef'&&x.args[0]&&x.args[0].type==='StringLiteral'&&x.args[0].value.indexOf('@cb:')===0)cbTargets.add(x.args[0].value.split(':').slice(4).join(':'));
        if(x.type==='CallExpr'&&!x.jsCall&&x.callee&&x.callee.type==='IdentifierExpr'&&fns.has(x.callee.name)){
          info.calls.add(x.callee.name);
          if(inTry)info.tryCalls.add(x.callee.name);
        }
        for(const k in x){if(k==='loc'||k==='jsCmp'||k==='jsConv')continue;const v=x[k];if(v&&typeof v==='object')visit(v,inTry)}
      })(info.node.body,false);
    }
    for(let changed=true;changed;){
      changed=false;
      for(const info of fns.values()){
        if(info.async)continue;
        let is=info.hasAwait;
        if(!is)for(const c of info.calls)if(fns.get(c).async){is=true;break}
        if(is){info.async=true;changed=true}
      }
    }
    const aware=new Set(),work=[];
    for(const info of fns.values())for(const c of info.tryCalls)work.push(c);
    if(hasTry)for(const c of cbTargets)if(fns.has(c))work.push(c);
    while(work.length){const c=work.pop();if(aware.has(c))continue;aware.add(c);for(const d of fns.get(c).calls)work.push(d)}
    prog.asyncFns=[];prog.tryFns=[];
    for(const [name,info] of fns){
      if(info.async){info.node.isAsync=true;prog.asyncFns.push(name)}
      if(aware.has(name)){info.node.tryAware=true;if(cbTargets.has(name)&&!info.async)prog.tryFns.push(name)}
    }
    return this;
  };
})();
(function(){
  var P=TypeChecker.prototype,compat1=P.compat,inf1=P.inf,cn0=P.cn;
  function isArr(t){return t==='arr'||t==='numarr'}
  function isI(t){return t==='int'||t==='i64'}
  // An Emit array is an int id: arr, numarr and int are assignment-compatible (older programs keep the id
  // in an int), and an array assigned to a js variable is converted to a JS array.
  P.compat=function(t,s){
    if(isArr(t)&&(isArr(s)||isI(s)))return true;
    if(isArr(s)&&(isI(t)||t==='js'))return true;
    return compat1.call(this,t,s);
  };
  P.inf=function(e){
    if(e&&e.type==='AwaitExpr'){this.inf(e.operand);return e.exprType}
    if(e&&e.type==='PendingErrExpr')return e.exprType;
    return inf1.call(this,e);
  };
  P.cn=function(n){
    if(n&&n.type==='TryStmt'){this.cn(n.body);if(n.handler)this.cn(n.handler);if(n.finalizer)this.cn(n.finalizer);return}
    if(n&&n.type==='ThrowStmt'){this.inf(n.value);return}
    return cn0.call(this,n);
  };
})();
(function(){
  var P=WasmCodegen.prototype,emit0=P.emit,genFunc0=P.genFunc,genStmt0=P.genStmt,nat0=P.genNatural,j2w1=P.j2w,res1=P.exprResType,generate0=P.generate;
  var F64_CONVERT_I64_S=0xB9;
  function isN(t){return t==='num'||t==='f64'}
  P.j2w=function(t){return(t==='arr'||t==='numarr')?VT.i64:j2w1.call(this,t)};
  // this.blk = number of open block/loop/if constructs in the current function. Every emit() call in this
  // compiler passes exactly one instruction with the opcode first, so counting here is reliable. A label is
  // remembered as the value of blk right after its block was opened; `br` to it is blk(now) - label.
  P.emit=function(){
    var op=arguments[0];
    if(op===Op.block||op===Op.loop||op===Op.if)this.blk++;
    else if(op===Op.end)this.blk--;
    return emit0.apply(this,arguments);
  };
  P.genFunc=function(func){
    this.blk=0;this.tryStack=[];this.loopStack=[];this.curFn=func.node;
    genFunc0.call(this,func);
    /* `fn f() int { try { return a } catch (e) { return b } }`: nothing follows the try statement, but the
       function body must still end with a value — give it one (never reached when every path returns) */
    var st=func.node.body.statements,last=st[st.length-1];
    if(last&&last.type==='TryStmt'&&func.node.returnType!=='void'){
      this.currentCode.pop();
      this.genZero(func.node.returnType);
      emit0.call(this,Op.end);
    }
  };
  P.generate=function(){
    var wasm=generate0.call(this),af=this.ast.asyncFns||[];
    if(af.length)this.imports.asyncFns=af.join(','); /* read by the runtime; exported with the import list */
    if((this.ast.tryFns||[]).length)this.imports.tryFns=this.ast.tryFns.join(','); /* callbacks that take part in a caller's try block */
    return wasm;
  };
  P.genZero=function(t){
    if(!t||t==='void')return;
    var w=this.j2w(t);
    if(w===VT.i64)this.emit(Op.i64_const,...ei64(0));
    else if(w===VT.f64)this.emit(Op.f64_const,...ef64(0));
    else if(w===VT.f32)this.emit(Op.f32_const,...ef32(0));
    else this.emit(Op.i32_const,...ei32(0));
  };
  // After an operation that can fail: inside a try block branch to its catch when an error is pending; in a
  // function that can be called from a try block return to the caller (which checks again). Elsewhere: nothing.
  P.genFailCheck=function(){
    if(this.tryStack.length){
      this.jsImportCall('__tryErr');
      this.emit(Op.br_if,...eu32(this.blk-this.tryStack[this.tryStack.length-1].label));
    }else if(this.curFn&&this.curFn.tryAware){
      this.jsImportCall('__tryErr');
      this.emit(Op.if,0x40);
      this.genZero(this.currentFuncRetType);
      this.emit(Op.return);
      this.emit(Op.end);
    }
  };
  P.canFail=function(e){
    if(e.arrOp)return false;
    switch(e.type){
      case'AwaitExpr':case'NewExpr':case'MemberExpr':case'IndexExpr':return true;
      case'AssignExpr':return e.target.type==='MemberExpr'||e.target.type==='IndexExpr';
      case'CallExpr':{
        if(e.jsCall||e.callee.type!=='IdentifierExpr')return true;
        var node=this.lookupFuncNode(e.callee.name);
        return !!(node&&node.tryAware);
      }
    }
    return false;
  };
  P.tryEnter=function(){
    var sv=this.addLocal('_try$'+this.currentLocals.length,'bool');
    this.emit(Op.i32_const,...ei32(1));this.jsImportCall('__trySet');this.emit(Op.local_set,...eu32(sv));
    return sv;
  };
  P.tryRestore=function(sv){this.emit(Op.local_get,...eu32(sv));this.jsImportCall('__trySet');this.emit(Op.drop)};
  // Leave the try blocks above index `downTo` (return / break / continue): restore the mode each one saved
  // and run its finally block, innermost first.
  P.unwindTries=function(downTo){
    for(var i=this.tryStack.length-1;i>=downTo;i--){
      var ent=this.tryStack[i];
      this.tryRestore(ent.saved);
      if(ent.fin){
        var ts=this.tryStack,ls=this.loopStack;
        this.tryStack=ts.slice(0,i);this.loopStack=ls.filter(function(l){return l.tryLen<=i});
        this.genBlock(ent.fin);
        this.tryStack=ts;this.loopStack=ls;
      }
    }
  };
  //   saved = __trySet(1)
  //   block $done
  //     block $catch
  //       body            ; after each operation that can fail: br_if $catch when an error is pending
  //       __trySet(saved) ; br $done
  //     end
  //     __trySet(saved)
  //     handler           ; starts with `let e: js = <pending error>`
  //   end
  P.genTryCatch=function(body,handler){
    var sv=this.tryEnter();
    this.emit(Op.block,0x40);var done=this.blk;
    this.emit(Op.block,0x40);var ct=this.blk;
    this.tryStack.push({saved:sv,label:ct,fin:null});
    this.genBlock(body);
    this.tryStack.pop();
    this.tryRestore(sv);
    this.emit(Op.br,...eu32(this.blk-done));
    this.emit(Op.end);
    this.tryRestore(sv);
    this.genBlock(handler);
    this.emit(Op.end);
  };
  // try { B } [catch (e) { H }] finally { F }  is  try { try { B } catch (e) { H } } catch (x) { F ; throw x }
  // followed by F on the normal path — so an error raised in B (without a catch) or in H still runs F and
  // then continues to the next enclosing try (or is reported, when there is none).
  P.genTry=function(s){
    if(!s.finalizer){this.genTryCatch(s.body,s.handler);return}
    var sv=this.tryEnter();
    this.emit(Op.block,0x40);var done=this.blk;
    this.emit(Op.block,0x40);var ct=this.blk;
    this.tryStack.push({saved:sv,label:ct,fin:s.finalizer});
    if(s.handler)this.genTryCatch(s.body,s.handler);else this.genBlock(s.body);
    this.tryStack.pop();
    this.tryRestore(sv);
    this.genBlock(s.finalizer);
    this.emit(Op.br,...eu32(this.blk-done));
    this.emit(Op.end);
    this.tryRestore(sv);
    var x=this.addLocal('_exc$'+this.currentLocals.length,'int');
    this.jsImportCall('__tryTake');this.emit(Op.local_set,...eu32(x));
    this.genBlock(s.finalizer);
    this.emit(Op.local_get,...eu32(x));this.jsImportCall('__throwJs');
    this.genAfterThrow();
    this.emit(Op.end);
  };
  // After __throwStr/__throwJs. With the catching mode on the runtime recorded the error: go to the catch,
  // or return to a caller that checks. With the mode off the import threw a real JS exception and never returned.
  P.genAfterThrow=function(){
    if(this.tryStack.length)this.emit(Op.br,...eu32(this.blk-this.tryStack[this.tryStack.length-1].label));
    else{this.genZero(this.currentFuncRetType);this.emit(Op.return)}
  };
  P.genStmt=function(s){
    switch(s.type){
      // Loops keep their own labels (this.loopStack) so that break / continue work at any nesting depth
      // (inside if, try, …); `continue` in a for loop runs the update expression.
      case'WhileStmt':{
        this.emit(Op.block,0x40);var wb=this.blk;
        this.emit(Op.loop,0x40);var wt=this.blk;
        this.loopStack.push({brk:wb,cont:wt,tryLen:this.tryStack.length});
        this.genExpr(s.condition,'bool');this.emit(Op.i32_eqz);this.emit(Op.br_if,...eu32(this.blk-wb));
        this.genBlock(s.body);
        this.emit(Op.br,...eu32(this.blk-wt));
        this.loopStack.pop();
        this.emit(Op.end);this.emit(Op.end);
        return;
      }
      case'ForStmt':{
        if(s.init)this.genStmt(s.init);
        this.emit(Op.block,0x40);var fb=this.blk;
        this.emit(Op.loop,0x40);var ft=this.blk;
        if(s.condition){this.genExpr(s.condition,'bool');this.emit(Op.i32_eqz);this.emit(Op.br_if,...eu32(this.blk-fb))}
        this.emit(Op.block,0x40);
        this.loopStack.push({brk:fb,cont:this.blk,tryLen:this.tryStack.length});
        this.genBlock(s.body);
        this.loopStack.pop();
        this.emit(Op.end);
        if(s.update){this.genExpr(s.update);if(this.exprResType(s.update)!=='void')this.emit(Op.drop)}
        this.emit(Op.br,...eu32(this.blk-ft));
        this.emit(Op.end);this.emit(Op.end);
        return;
      }
      case'BreakStmt':case'ContinueStmt':{
        if(!this.loopStack.length)return;
        var L=this.loopStack[this.loopStack.length-1];
        this.unwindTries(L.tryLen);
        this.emit(Op.br,...eu32(this.blk-(s.type==='BreakStmt'?L.brk:L.cont)));
        return;
      }
      case'ReturnStmt':{
        if(!this.tryStack.length)return genStmt0.call(this,s);
        /* return from inside a try block: value first, then leave the try blocks (mode, finally), then return */
        var rv=-1;
        if(s.value){
          this.genExpr(s.value,this.currentFuncRetType);
          rv=this.addLocal('_rv$'+this.currentLocals.length,this.currentFuncRetType);
          this.emit(Op.local_set,...eu32(rv));
        }
        this.unwindTries(0);
        if(rv>=0)this.emit(Op.local_get,...eu32(rv));
        this.emit(Op.return);
        return;
      }
      case'TryStmt':this.genTry(s);return;
      case'ThrowStmt':
        this.genExpr(s.value,s.throwFn==='__throwStr'?'str':'int');
        this.jsImportCall(s.throwFn);
        this.genAfterThrow();
        return;
    }
    return genStmt0.call(this,s);
  };
  P.genArrVal=function(v,num){
    if(num){this.genExpr(v,'num');return}
    var vt=v.exprType;
    if(vt==='str'||vt==='bool'){this.genExpr(v,vt);this.emit(Op.i64_extend_i32_u)}
    else this.genExpr(v,'int');
  };
  P.genNatural=function(e,exp){
    if(e.type==='AwaitExpr'){
      /* h = operand; t = __awaitPre(h); t != 0 ? (r = __await(t), __awaitPost(t), r) : h */
      this.genExpr(e.operand,'int');
      var aw=this.addLocal('_aw$'+this.currentLocals.length,'int'),tk=this.addLocal('_awt$'+this.currentLocals.length,'int');
      this.emit(Op.local_tee,...eu32(aw));
      this.jsImportCall('__awaitPre');
      this.emit(Op.local_tee,...eu32(tk));
      this.emit(Op.i64_const,...ei64(0));this.emit(Op.i64_ne);
      this.emit(Op.if,VT.i64);
      if(this.genAwaitSpill)this.genAwaitSpill(e); /* lifetime: see "PARKED SCOPES" in the runtime */
      this.emit(Op.local_get,...eu32(tk));this.jsImportCall('__await');
      this.emit(Op.local_get,...eu32(tk));this.jsImportCall('__awaitPost');
      this.emit(Op.else);
      this.emit(Op.local_get,...eu32(aw));
      this.emit(Op.end);
    }else if(e.type==='PendingErrExpr'){
      this.jsImportCall('__tryTake');
    }else if(e.arrOp){
      var num=e.arrElem==='num';
      switch(e.arrOp){
        case'get':
          this.genExpr(e.object,'int');this.genExpr(e.index,'int');
          this.jsImportCall(num?'__arrGetN':'__arrGet');
          if(!num&&isN(exp))this.emit(F64_CONVERT_I64_S);
          break;
        case'len':
          this.genExpr(e.object,'int');this.jsImportCall('__arrLen');
          if(isN(exp))this.emit(F64_CONVERT_I64_S);
          break;
        case'set':
          this.genExpr(e.target.object,'int');this.genExpr(e.target.index,'int');this.genArrVal(e.value,num);
          this.jsImportCall(num?'__arrSetN':'__arrSet');
          break;
        case'push':
          this.genExpr(e.callee.object,'int');this.genArrVal(e.args[0],num);
          this.jsImportCall(num?'__arrPushN':'__arrPush');
          break;
        case'pop':
          this.genExpr(e.callee.object,'int');
          this.jsImportCall(num?'__arrPopN':'__arrPop');
          break;
      }
    }else nat0.call(this,e,exp);
    if((this.tryStack.length||(this.curFn&&this.curFn.tryAware))&&this.canFail(e))this.genFailCheck();
  };
  P.exprResType=function(e){
    if(e.arrOp==='set'||e.arrOp==='push')return'void';
    if(e.arrOp||e.type==='AwaitExpr')return'int';
    return res1.call(this,e);
  };
})();

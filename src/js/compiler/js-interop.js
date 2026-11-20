// ── JS interop codegen helpers (separate methods so the long lines above need only tiny edits) ──
// Arg buffer slot tags: 0=int-or-handle, 1=num, 2=str, 3=handle (`null` and js-typed values), 4=bool, 5=int literal.
WasmCodegen.prototype.jsArgTag=function(a){
  var at=(a&&a.exprType)||'int';
  if(a.type==='NullLiteral')return 3;
  if(at==='num'||at==='f64'||at==='f32')return 1;
  if(at==='str')return 2;
  if(at==='bool')return 4;
  if(at==='js')return 3;
  if(a.type==='IntLiteral')return 5;
  return 0;
};
// Push one argument value (i64 / f64 / i32 depending on tag) on the WASM stack.
WasmCodegen.prototype.genJsArgValue=function(a,tag){
  if(tag===3){if(a.type==='NullLiteral')this.emit(Op.i64_const,...ei64(0));else this.genExpr(a,'int')}
  else if(tag===1)this.genExpr(a,'num');
  else if(tag===2||tag===4)this.genExpr(a,a.exprType);
  else this.genExpr(a,'int');
};
// Marshal call arguments into the arg buffer (48640 + slot*16). Every argument is evaluated into a
// temp local FIRST and only then written, so a nested JS call inside an argument (which reuses the
// same buffer) cannot clobber the outer call's slots or tags.
WasmCodegen.prototype.genJsArgs=function(args){
  var tmps=[];
  for(var i=0;i<args.length;i++){
    var tag=this.jsArgTag(args[i]);
    var li=this.addLocal('_ja$'+this.currentLocals.length,tag===1?'num':(tag===2||tag===4)?'bool':'int');
    this.genJsArgValue(args[i],tag);
    this.emit(Op.local_set,...eu32(li));
    tmps.push({li:li,tag:tag});
  }
  for(var j=0;j<tmps.length;j++){
    var slot=48640+j*16;
    this.emit(Op.i32_const,...ei32(slot));this.emit(Op.i32_const,...ei32(tmps[j].tag));this.emit(Op.i32_store8,0,0);
    this.emit(Op.i32_const,...ei32(slot+8));this.emit(Op.local_get,...eu32(tmps[j].li));
    if(tmps[j].tag===1)this.emit(Op.f64_store,3,0);
    else{if(tmps[j].tag===2||tmps[j].tag===4)this.emit(Op.i64_extend_i32_u);this.emit(Op.i64_store,3,0)}
  }
};
// obj.prop = value → __jsSet(recv, "prop"), value in slot 0. The receiver and the value are evaluated
// before the slot is written, for the same nested-call reason as above.
WasmCodegen.prototype.genJsSet=function(e){
  var tag=this.jsArgTag(e.value);
  this.genExpr(e.target.object,'int');
  this.emit(Op.i32_const,...ei32(48648));
  this.genJsArgValue(e.value,tag);
  if(tag===1)this.emit(Op.f64_store,3,0);
  else{if(tag===2||tag===4)this.emit(Op.i64_extend_i32_u);this.emit(Op.i64_store,3,0)}
  this.emit(Op.i32_const,...ei32(48640));this.emit(Op.i32_const,...ei32(tag));this.emit(Op.i32_store8,0,0);
  this.emit(Op.i32_const,...ei32(this.addString(e.target.property)));
  this.emit(Op.call,...eu32(this.funcMap.get('__jsSet')));
};
// new A.B(args) → __jsNew(handle of A, "B", n);  new X(args) → __jsNew(handle of X, "", n)
WasmCodegen.prototype.genNew=function(e){
  if(!this.funcMap.has('__jsNew')){this.emit(Op.i64_const,...ei64(0));return}
  var name='';
  if(e.callee.type==='MemberExpr'){this.genExpr(e.callee.object,'int');name=e.callee.property}
  else this.genExpr(e.callee,'int');
  this.emit(Op.i32_const,...ei32(this.addString(name)));
  this.genJsArgs(e.args);
  this.emit(Op.i64_const,...ei64(e.args.length));
  this.emit(Op.call,...eu32(this.funcMap.get('__jsNew')));
};
// Kept because genExpr still calls it after every JS call / property read. Conversions of JS values
// are now decided by the type annotator (node.jsConv) and emitted by the genExpr wrapper below.
WasmCodegen.prototype.jsCoerce=function(e,exp){};
// ── The `js` type in codegen ──
// A js value is an i64 handle. genExpr is wrapped so that one place handles: the conversions the
// annotator recorded (node.jsConv), a[i] reads and writes, identity comparison of two JS values,
// and an int variable/call used where a num is wanted.
(function(){
  var P=WasmCodegen.prototype,gen0=P.genExpr,j2w0=P.j2w,resType0=P.exprResType;
  var F64_CONVERT_I64_S=0xB9;
  function isI(t){return t==='int'||t==='i64'}
  function isN(t){return t==='num'||t==='f64'}
  P.j2w=function(t){return(t==='js'||t==='js?')?VT.i64:j2w0.call(this,t)};
  P.jsImportCall=function(name){
    if(!this.funcMap.has(name))throw new Error('internal: JS interop import '+name+' was not injected');
    this.emit(Op.call,...eu32(this.funcMap.get(name)));
  };
  // The expression in its own (pre-conversion) type.
  P.genNatural=function(e,exp){
    if(exp==='js')exp='int';
    if(e.type==='IndexExpr'){
      /* a[i] → __jsIdx(a), index in arg slot 0 */
      this.genExpr(e.object,'int');
      this.genJsArgs([e.index]);
      this.jsImportCall('__jsIdx');
      return;
    }
    if(e.type==='AssignExpr'&&e.target.type==='IndexExpr'){
      /* a[i] = v → __jsIdxSet(a), index in slot 0, value in slot 1; leaves nothing on the stack */
      this.genExpr(e.target.object,'int');
      this.genJsArgs([e.target.index,e.value]);
      this.jsImportCall('__jsIdxSet');
      return;
    }
    if(e.type==='CallExpr'&&e.jsCall==='global'){
      /* name(args) on a JS global function → __jsCallG("name", n, flags), arguments in the arg buffer */
      this.emit(Op.i32_const,...ei32(this.addString(e.callee.name)));
      this.genJsArgs(e.args);
      this.emit(Op.i64_const,...ei64(e.args.length));
      this.emit(Op.i64_const,...ei64(e.jsEcho?1:0));
      this.jsImportCall('__jsCallG');
      return;
    }
    if(e.type==='CallExpr'&&e.jsCall==='value'){
      /* f(args) where f is a JS function value → __jsCallV(f, "label for error messages", n) */
      var c=e.callee;
      var label=c.type==='IdentifierExpr'?c.name:(c.type==='CallExpr'&&c.callee&&c.callee.type==='MemberExpr')?c.callee.property+'(…)':(c.type==='CallExpr'&&c.callee&&c.callee.type==='IdentifierExpr')?c.callee.name+'(…)':'(value)';
      this.genExpr(c,'int');
      this.emit(Op.i32_const,...ei32(this.addString(label)));
      this.genJsArgs(e.args);
      this.emit(Op.i64_const,...ei64(e.args.length));
      this.jsImportCall('__jsCallV');
      return;
    }
    if(e.type==='ArrayLiteral'&&e.jsArr){this.genJsLit(e.elements,'__jsArr',1);return}
    if(e.type==='ObjectLiteral'){
      var kv=[];
      for(var oi=0;oi<e.keys.length;oi++){kv.push({type:'StringLiteral',value:e.keys[oi],exprType:'str',loc:e.loc});kv.push(e.values[oi])}
      this.genJsLit(kv,'__jsObj',2);
      return;
    }
    if(e.type==='BinaryExpr'&&e.strCat){
      this.genExpr(e.left,'str');
      this.genExpr(e.right,'str');
      this.jsImportCall('__strCat');
      return;
    }
    if(e.type==='BinaryExpr'&&e.jsCmp){
      /* == / != on JS values or strings: __jsSame / __jsEqStr / __jsStrEq */
      this.genExpr(e.jsCmp.args[0],e.jsCmp.args[0].exprType);
      this.genExpr(e.jsCmp.args[1],e.jsCmp.args[1].exprType);
      this.jsImportCall(e.jsCmp.fn);
      if(e.op==='!=')this.emit(Op.i32_eqz);
      return;
    }
    return gen0.call(this,e,exp);
  };
  P.genExpr=function(e,exp){
    var wantNum=isN(exp),c=e.jsConv;
    if(c){
      this.genNatural(e,c.from==='js'?'int':c.from);
      this.jsImportCall(_jsConvFn(c));
      if(wantNum&&isI(e.exprType))this.emit(F64_CONVERT_I64_S);
      return;
    }
    if(e.exprType==='js'&&(exp==='str'||exp==='bool'||wantNum)){
      /* safety net: a JS value reached a typed position the annotator did not mark */
      this.genNatural(e,'int');
      var sf=exp==='str'?'__jsStr':exp==='bool'?'__jsBool':'__jsNum';
      if(this.funcMap.has(sf))this.jsImportCall(sf);
      return;
    }
    if(wantNum&&isI(e.exprType)&&(e.type==='IdentifierExpr'||e.type==='CallExpr'||(e.type==='UnaryExpr'&&e.op==='-'))){
      /* an int variable / call result where a num is wanted: `i * 2.5`, `x > obj.size` */
      this.genNatural(e,'int');
      this.emit(F64_CONVERT_I64_S);
      return;
    }
    return this.genNatural(e,exp);
  };
  P.inferOpType=function(l,r){
    var lt=l&&l.exprType,rt=r&&r.exprType;
    if(isN(lt)||isN(rt))return'num';
    if(lt==='bool'&&rt==='bool')return'i32';
    return'int';
  };
  // [a, b] / {k: v} as a JS value: fn(handle 0 = create, n) consumes `per` arg slots per item; long
  // literals go through the 32-slot arg buffer in chunks, the handle staying on the WASM stack.
  P.genJsLit=function(items,fn,per){
    this.emit(Op.i64_const,...ei64(0));
    var chunk=32;
    for(var at=0;at<items.length||at===0;at+=chunk){
      var part=items.slice(at,at+chunk);
      this.genJsArgs(part);
      this.emit(Op.i64_const,...ei64(part.length/per));
      this.jsImportCall(fn);
    }
  };
  P.exprResType=function(e){
    if(e.type==='AssignExpr'&&e.target&&e.target.type==='IndexExpr')return'void';
    if(e.type==='CallExpr'&&e.jsCall)return'int';
    return resType0.call(this,e);
  };
})();
// Initial value of a top-level `let`/`mut`: a literal (number, bool, string, null) or constant
// arithmetic on number literals (`-3`, `60 * 60`). WASM global initialisers must be constants, so
// anything else is rejected by the type annotator with a compile error (it used to start at 0).
WasmCodegen.prototype.globalInitValue=function(g){
  var e=g.init;
  if(!e)return 0;
  if(e.type==='BoolLiteral')return e.value?1:0;
  if(e.type==='StringLiteral')return g.type==='str'?this.addString(e.value):0;
  var v=this.constFold(e);
  return(v!==null&&isFinite(v))?v:0;
};
WasmCodegen.prototype.constFold=function(e){
  if(!e)return null;
  if(e.type==='IntLiteral'||e.type==='FloatLiteral')return Number(e.value);
  if(e.type==='UnaryExpr'&&e.op==='-'){var o=this.constFold(e.operand);return o===null?null:-o}
  if(e.type==='BinaryExpr'){
    var l=this.constFold(e.left),r=this.constFold(e.right);
    if(l===null||r===null)return null;
    var intOp=e.exprType==='int';
    switch(e.op){
      case'+':return l+r;
      case'-':return l-r;
      case'*':return l*r;
      case'/':return intOp?Math.trunc(l/r):l/r;
      case'%':return l%r;
    }
  }
  return null;
};
// Callback table: when the program uses fnRef, the module imports a funcref table ("__cb__"."table")
// and an element segment puts every Emit function into it, in declaration order. JS calls a callback
// with table.get(index) — so callback targets need not be exported.
WasmCodegen.prototype.cbTableImport=function(){
  return[...estr('__cb__'),...estr('table'),0x01,0x70,0x00,...eu32(this.functions.length)];
};
WasmCodegen.prototype.cbElemSection=function(){
  var iOff=this.imports.length,idx=[];
  for(var i=0;i<this.functions.length;i++)idx.push(...eu32(iOff+i));
  return evec([[0x00,Op.i32_const,...ei32(0),Op.end,...eu32(this.functions.length),...idx]]);
};
// BUILTINS — auto-imported when used
const BUILTINS={
  // I/O
  print:{params:[{name:'x',type:'int'}],returnType:'void',module:'std'},
  printNum:{params:[{name:'x',type:'num'}],returnType:'void',module:'std'},
  printStr:{params:[{name:'s',type:'str'}],returnType:'void',module:'std'},
  log:{params:[{name:'x',type:'int'}],returnType:'void',module:'std'},
  alert:{params:[{name:'msg',type:'str'}],returnType:'void',module:'std'},
  // Math
  abs:{params:[{name:'x',type:'int'}],returnType:'int',module:'std'},
  min:{params:[{name:'a',type:'int'},{name:'b',type:'int'}],returnType:'int',module:'std'},
  max:{params:[{name:'a',type:'int'},{name:'b',type:'int'}],returnType:'int',module:'std'},
  sqrt:{params:[{name:'x',type:'num'}],returnType:'num',module:'std'},
  sin:{params:[{name:'x',type:'num'}],returnType:'num',module:'std'},
  cos:{params:[{name:'x',type:'num'}],returnType:'num',module:'std'},
  pow:{params:[{name:'b',type:'num'},{name:'e',type:'num'}],returnType:'num',module:'std'},
  floor:{params:[{name:'x',type:'num'}],returnType:'int',module:'std'},
  random:{params:[],returnType:'num',module:'std'},
  // Time
  now:{params:[],returnType:'int',module:'std'},
  sleep:{params:[{name:'ms',type:'int'}],returnType:'void',module:'std'},
  // Canvas drawing
  canvas:{params:[{name:'w',type:'int'},{name:'h',type:'int'}],returnType:'void',module:'std'},
  color:{params:[{name:'r',type:'int'},{name:'g',type:'int'},{name:'b',type:'int'}],returnType:'void',module:'std'},
  alpha:{params:[{name:'a',type:'num'}],returnType:'void',module:'std'},
  lineWidth:{params:[{name:'w',type:'int'}],returnType:'void',module:'std'},
  rect:{params:[{name:'x',type:'int'},{name:'y',type:'int'},{name:'w',type:'int'},{name:'h',type:'int'}],returnType:'void',module:'std'},
  strokeRect:{params:[{name:'x',type:'int'},{name:'y',type:'int'},{name:'w',type:'int'},{name:'h',type:'int'}],returnType:'void',module:'std'},
  circle:{params:[{name:'x',type:'int'},{name:'y',type:'int'},{name:'r',type:'int'}],returnType:'void',module:'std'},
  line:{params:[{name:'x1',type:'int'},{name:'y1',type:'int'},{name:'x2',type:'int'},{name:'y2',type:'int'}],returnType:'void',module:'std'},
  clear:{params:[],returnType:'void',module:'std'},
  text:{params:[{name:'s',type:'str'},{name:'x',type:'int'},{name:'y',type:'int'},{name:'size',type:'int'}],returnType:'void',module:'std'},
  pixel:{params:[{name:'x',type:'int'},{name:'y',type:'int'}],returnType:'void',module:'std'},
  getCanvas:{params:[],returnType:'js',module:'std'},
  emptyObj:{params:[],returnType:'js',module:'std'},
  wrapShape:{params:[{name:'s',type:'js'}],returnType:'js',module:'std'},
  textShape:{params:[{name:'text',type:'str'},{name:'color',type:'str'},{name:'scalar',type:'num'}],returnType:'js',module:'std'},
  textShape:{params:[{name:'text',type:'str'},{name:'color',type:'str'},{name:'scalar',type:'num'}],returnType:'js',module:'std'},
  toJsArray:{params:[{name:'arr',type:'int'}],returnType:'js',module:'std'},
  fnRef:{params:[{name:'name',type:'str'}],returnType:'js',module:'std'},
  toStr:{params:[{name:'h',type:'js'}],returnType:'str',module:'std'},
  toNum:{params:[{name:'h',type:'js'}],returnType:'num',module:'std'},
  toInt:{params:[{name:'h',type:'js'}],returnType:'int',module:'std'},
  isNull:{params:[{name:'h',type:'js'}],returnType:'bool',module:'std'},
  typeOf:{params:[{name:'h',type:'js'}],returnType:'str',module:'std'},
  jsLen:{params:[{name:'h',type:'js'}],returnType:'int',module:'std'},
  jsAt:{params:[{name:'h',type:'js'},{name:'i',type:'int'}],returnType:'js',module:'std'},
  jsGet:{params:[{name:'h',type:'js'},{name:'key',type:'str'}],returnType:'js',module:'std'},
  jsKeys:{params:[{name:'h',type:'js'}],returnType:'js',module:'std'},
  // Sound
  beep:{params:[{name:'freq',type:'int'},{name:'ms',type:'int'}],returnType:'void',module:'std'},
  // DOM
  button:{params:[{name:'label',type:'str'},{name:'id',type:'int'}],returnType:'void',module:'std'},
  input:{params:[{name:'placeholder',type:'str'},{name:'id',type:'int'}],returnType:'void',module:'std'},
  getInput:{params:[{name:'id',type:'int'}],returnType:'int',module:'std'},
  setText:{params:[{name:'id',type:'int'},{name:'val',type:'str'}],returnType:'void',module:'std'},
  div:{params:[{name:'txt',type:'str'}],returnType:'void',module:'std'},
  // Arrays
  newArray:{params:[{name:'size',type:'int'}],returnType:'int',module:'std'},
  getItem:{params:[{name:'arr',type:'int'},{name:'idx',type:'int'}],returnType:'int',module:'std'},
  setItem:{params:[{name:'arr',type:'int'},{name:'idx',type:'int'},{name:'val',type:'int'}],returnType:'void',module:'std'},
  getNumItem:{params:[{name:'arr',type:'int'},{name:'idx',type:'int'}],returnType:'num',module:'std'},
  setNumItem:{params:[{name:'arr',type:'int'},{name:'idx',type:'int'},{name:'val',type:'num'}],returnType:'void',module:'std'},
  push:{params:[{name:'arr',type:'int'},{name:'val',type:'int'}],returnType:'void',module:'std'},
  pop:{params:[{name:'arr',type:'int'}],returnType:'int',module:'std'},
  arrayLen:{params:[{name:'arr',type:'int'}],returnType:'int',module:'std'},
  // 3D (Three.js)
  scene3d:{params:[{name:'w',type:'int'},{name:'h',type:'int'}],returnType:'void',module:'std'},
  box:{params:[{name:'x',type:'num'},{name:'y',type:'num'},{name:'z',type:'num'}],returnType:'int',module:'std'},
  sphere:{params:[{name:'x',type:'num'},{name:'y',type:'num'},{name:'z',type:'num'},{name:'r',type:'num'}],returnType:'int',module:'std'},
  plane:{params:[{name:'w',type:'num'},{name:'h',type:'num'}],returnType:'int',module:'std'},
  color3d:{params:[{name:'id',type:'int'},{name:'r',type:'int'},{name:'g',type:'int'},{name:'b',type:'int'}],returnType:'void',module:'std'},
  move3d:{params:[{name:'id',type:'int'},{name:'x',type:'num'},{name:'y',type:'num'},{name:'z',type:'num'}],returnType:'void',module:'std'},
  rotate3d:{params:[{name:'id',type:'int'},{name:'x',type:'num'},{name:'y',type:'num'},{name:'z',type:'num'}],returnType:'void',module:'std'},
  scale3d:{params:[{name:'id',type:'int'},{name:'sx',type:'num'},{name:'sy',type:'num'},{name:'sz',type:'num'}],returnType:'void',module:'std'},
  camera3d:{params:[{name:'x',type:'num'},{name:'y',type:'num'},{name:'z',type:'num'}],returnType:'void',module:'std'},
  lookAt3d:{params:[{name:'x',type:'num'},{name:'y',type:'num'},{name:'z',type:'num'}],returnType:'void',module:'std'},
  light3d:{params:[{name:'x',type:'num'},{name:'y',type:'num'},{name:'z',type:'num'}],returnType:'void',module:'std'},
  fog3d:{params:[{name:'r',type:'int'},{name:'g',type:'int'},{name:'b',type:'int'},{name:'near',type:'num'},{name:'far',type:'num'}],returnType:'void',module:'std'},
  render3d:{params:[],returnType:'void',module:'std'},
  controls3d:{params:[],returnType:'void',module:'std'},
  cylinder:{params:[{name:'x',type:'num'},{name:'y',type:'num'},{name:'z',type:'num'},{name:'r',type:'num'},{name:'h',type:'num'}],returnType:'int',module:'std'},
  wallBox:{params:[{name:'x',type:'num'},{name:'y',type:'num'},{name:'z',type:'num'},{name:'w',type:'num'},{name:'h',type:'num'},{name:'d',type:'num'}],returnType:'int',module:'std'},
  ambient3d:{params:[{name:'r',type:'int'},{name:'g',type:'int'},{name:'b',type:'int'}],returnType:'void',module:'std'},
  bgColor3d:{params:[{name:'r',type:'int'},{name:'g',type:'int'},{name:'b',type:'int'}],returnType:'void',module:'std'},
  cone:{params:[{name:'x',type:'num'},{name:'y',type:'num'},{name:'z',type:'num'},{name:'r',type:'num'},{name:'h',type:'num'}],returnType:'int',module:'std'},
  torus:{params:[{name:'x',type:'num'},{name:'y',type:'num'},{name:'z',type:'num'},{name:'r',type:'num'},{name:'tube',type:'num'}],returnType:'int',module:'std'},
  grid3d:{params:[{name:'size',type:'int'},{name:'divs',type:'int'}],returnType:'void',module:'std'},
  pointLight3d:{params:[{name:'x',type:'num'},{name:'y',type:'num'},{name:'z',type:'num'},{name:'r',type:'int'},{name:'g',type:'int'},{name:'b',type:'int'}],returnType:'void',module:'std'},
  spotLight3d:{params:[{name:'x',type:'num'},{name:'y',type:'num'},{name:'z',type:'num'},{name:'tx',type:'num'},{name:'ty',type:'num'},{name:'tz',type:'num'}],returnType:'void',module:'std'},
  metallic3d:{params:[{name:'id',type:'int'},{name:'metal',type:'num'},{name:'rough',type:'num'}],returnType:'void',module:'std'},
  opacity3d:{params:[{name:'id',type:'int'},{name:'val',type:'num'}],returnType:'void',module:'std'},
  shadow3d:{params:[],returnType:'void',module:'std'},
  text3d:{params:[{name:'s',type:'str'},{name:'x',type:'num'},{name:'y',type:'num'},{name:'z',type:'num'},{name:'size',type:'num'}],returnType:'int',module:'std'},
  // Tone.js — synths and music
  synth:{params:[{name:'type',type:'int'}],returnType:'int',module:'std'},
  drum:{params:[{name:'type',type:'int'}],returnType:'int',module:'std'},
  playNote:{params:[{name:'id',type:'int'},{name:'freq',type:'num'},{name:'dur',type:'num'}],returnType:'void',module:'std'},
  noteOff:{params:[{name:'id',type:'int'}],returnType:'void',module:'std'},
  setBpm:{params:[{name:'bpm',type:'int'}],returnType:'void',module:'std'},
  setSwing:{params:[{name:'amt',type:'num'}],returnType:'void',module:'std'},
  // Matter.js — 2D physics
  physics:{params:[{name:'w',type:'int'},{name:'h',type:'int'}],returnType:'void',module:'std'},
  physBox:{params:[{name:'x',type:'num'},{name:'y',type:'num'},{name:'w',type:'num'},{name:'h',type:'num'}],returnType:'int',module:'std'},
  physCircle:{params:[{name:'x',type:'num'},{name:'y',type:'num'},{name:'r',type:'num'}],returnType:'int',module:'std'},
  physGround:{params:[{name:'y',type:'num'}],returnType:'void',module:'std'},
  physGravity:{params:[{name:'x',type:'num'},{name:'y',type:'num'}],returnType:'void',module:'std'},
  physStep:{params:[],returnType:'void',module:'std'},
  physDraw:{params:[],returnType:'void',module:'std'},
  // Chart.js
  barChart:{params:[{name:'w',type:'int'},{name:'h',type:'int'}],returnType:'void',module:'std'},
  lineChart:{params:[{name:'w',type:'int'},{name:'h',type:'int'}],returnType:'void',module:'std'},
  pieChart:{params:[{name:'w',type:'int'},{name:'h',type:'int'}],returnType:'void',module:'std'},
  chartLabel:{params:[{name:'s',type:'str'}],returnType:'void',module:'std'},
  chartData:{params:[{name:'val',type:'num'}],returnType:'void',module:'std'},
  chartColor:{params:[{name:'r',type:'int'},{name:'g',type:'int'},{name:'b',type:'int'}],returnType:'void',module:'std'},
  chartRender:{params:[],returnType:'void',module:'std'},
  // Howler.js — audio
  loadAudio:{params:[{name:'url',type:'str'}],returnType:'int',module:'std'},
  playAudio:{params:[{name:'id',type:'int'}],returnType:'void',module:'std'},
  stopAudio:{params:[{name:'id',type:'int'}],returnType:'void',module:'std'},
  loopAudio:{params:[{name:'id',type:'int'},{name:'on',type:'int'}],returnType:'void',module:'std'},
  volumeAudio:{params:[{name:'id',type:'int'},{name:'vol',type:'num'}],returnType:'void',module:'std'},
  // GSAP — animation
  tween:{params:[{name:'id',type:'int'},{name:'prop',type:'int'},{name:'val',type:'num'},{name:'dur',type:'num'}],returnType:'void',module:'std'},
  // Anime.js
  animateEl:{params:[{name:'id',type:'int'},{name:'prop',type:'int'},{name:'val',type:'num'},{name:'dur',type:'num'}],returnType:'void',module:'std'},
  // PixiJS — 2D WebGL
  pixiApp:{params:[{name:'w',type:'int'},{name:'h',type:'int'}],returnType:'void',module:'std'},
  pixiRect:{params:[{name:'x',type:'int'},{name:'y',type:'int'},{name:'w',type:'int'},{name:'h',type:'int'},{name:'r',type:'int'},{name:'g',type:'int'},{name:'b',type:'int'}],returnType:'int',module:'std'},
  pixiCircle:{params:[{name:'x',type:'int'},{name:'y',type:'int'},{name:'rad',type:'int'},{name:'r',type:'int'},{name:'g',type:'int'},{name:'b',type:'int'}],returnType:'int',module:'std'},
  pixiText:{params:[{name:'s',type:'str'},{name:'x',type:'int'},{name:'y',type:'int'},{name:'size',type:'int'}],returnType:'int',module:'std'},
  pixiMove:{params:[{name:'id',type:'int'},{name:'x',type:'int'},{name:'y',type:'int'}],returnType:'void',module:'std'},
  pixiRender:{params:[],returnType:'void',module:'std'},
  // Cannon.js — 3D physics
  world3d:{params:[{name:'gx',type:'num'},{name:'gy',type:'num'},{name:'gz',type:'num'}],returnType:'void',module:'std'},
  bodyBox:{params:[{name:'x',type:'num'},{name:'y',type:'num'},{name:'z',type:'num'},{name:'w',type:'num'},{name:'h',type:'num'},{name:'d',type:'num'},{name:'mass',type:'num'}],returnType:'int',module:'std'},
  bodySphere:{params:[{name:'x',type:'num'},{name:'y',type:'num'},{name:'z',type:'num'},{name:'r',type:'num'},{name:'mass',type:'num'}],returnType:'int',module:'std'},
  bodyPlane:{params:[],returnType:'int',module:'std'},
  bodyForce:{params:[{name:'id',type:'int'},{name:'fx',type:'num'},{name:'fy',type:'num'},{name:'fz',type:'num'}],returnType:'void',module:'std'},
  stepWorld:{params:[{name:'dt',type:'num'}],returnType:'void',module:'std'},
  // PeerJS — networking
  hostPeer:{params:[{name:'id',type:'str'}],returnType:'void',module:'std'},
  joinPeer:{params:[{name:'id',type:'str'}],returnType:'void',module:'std'},
  sendInt:{params:[{name:'val',type:'int'}],returnType:'void',module:'std'},
  sendStr:{params:[{name:'s',type:'str'}],returnType:'void',module:'std'},
  onRecvInt:{params:[{name:'cb',type:'int'}],returnType:'void',module:'std'},
  onRecvStr:{params:[{name:'cb',type:'int'}],returnType:'void',module:'std'},
  // Animation & Input
  animate:{params:[],returnType:'void',module:'std'},
  keyDown:{params:[{name:'key',type:'int'}],returnType:'int',module:'std'},
  touchX:{params:[],returnType:'int',module:'std'},
  touchY:{params:[],returnType:'int',module:'std'},
  touching:{params:[],returnType:'int',module:'std'},
  getInputStr:{params:[{name:'id',type:'int'}],returnType:'str',module:'std'},
  // Images & Sprites
  loadImage:{params:[{name:'url',type:'str'}],returnType:'int',module:'std'},
  drawImage:{params:[{name:'id',type:'int'},{name:'x',type:'int'},{name:'y',type:'int'}],returnType:'void',module:'std'},
  drawImageScaled:{params:[{name:'id',type:'int'},{name:'x',type:'int'},{name:'y',type:'int'},{name:'w',type:'int'},{name:'h',type:'int'}],returnType:'void',module:'std'},
  // Collision
  collides:{params:[{name:'x1',type:'int'},{name:'y1',type:'int'},{name:'w1',type:'int'},{name:'h1',type:'int'},{name:'x2',type:'int'},{name:'y2',type:'int'},{name:'w2',type:'int'},{name:'h2',type:'int'}],returnType:'int',module:'std'},
  dist:{params:[{name:'x1',type:'num'},{name:'y1',type:'num'},{name:'x2',type:'num'},{name:'y2',type:'num'}],returnType:'num',module:'std'},
  // Timers
  setTimer:{params:[{name:'ms',type:'int'},{name:'id',type:'int'}],returnType:'void',module:'std'},
  setInterval:{params:[{name:'ms',type:'int'},{name:'id',type:'int'}],returnType:'void',module:'std'},
  // Screen
  screenW:{params:[],returnType:'int',module:'std'},
  screenH:{params:[],returnType:'int',module:'std'},
  // Mouse
  mouseX:{params:[],returnType:'int',module:'std'},
  mouseY:{params:[],returnType:'int',module:'std'},
  mouseDown:{params:[],returnType:'int',module:'std'},
  // Storage
  save:{params:[{name:'key',type:'str'},{name:'val',type:'int'}],returnType:'void',module:'std'},
  load:{params:[{name:'key',type:'str'}],returnType:'int',module:'std'},
  saveStr:{params:[{name:'key',type:'str'},{name:'val',type:'str'}],returnType:'void',module:'std'},
  // HTTP
  httpGet:{params:[{name:'url',type:'str'},{name:'cb',type:'int'}],returnType:'void',module:'std'},
  // Random & Math helpers
  randInt:{params:[{name:'min',type:'int'},{name:'max',type:'int'}],returnType:'int',module:'std'},
  lerp:{params:[{name:'a',type:'num'},{name:'b',type:'num'},{name:'t',type:'num'}],returnType:'num',module:'std'},
  clamp:{params:[{name:'val',type:'num'},{name:'lo',type:'num'},{name:'hi',type:'num'}],returnType:'num',module:'std'},
  // Math — extras
  ceil:{params:[{name:'x',type:'num'}],returnType:'int',module:'std'},
  round:{params:[{name:'x',type:'num'}],returnType:'int',module:'std'},
  sign:{params:[{name:'x',type:'num'}],returnType:'int',module:'std'},
  absNum:{params:[{name:'x',type:'num'}],returnType:'num',module:'std'},
  minNum:{params:[{name:'a',type:'num'},{name:'b',type:'num'}],returnType:'num',module:'std'},
  maxNum:{params:[{name:'a',type:'num'},{name:'b',type:'num'}],returnType:'num',module:'std'},
  tan:{params:[{name:'x',type:'num'}],returnType:'num',module:'std'},
  asin:{params:[{name:'x',type:'num'}],returnType:'num',module:'std'},
  acos:{params:[{name:'x',type:'num'}],returnType:'num',module:'std'},
  atan:{params:[{name:'x',type:'num'}],returnType:'num',module:'std'},
  atan2:{params:[{name:'y',type:'num'},{name:'x',type:'num'}],returnType:'num',module:'std'},
  ln:{params:[{name:'x',type:'num'}],returnType:'num',module:'std'},
  log2:{params:[{name:'x',type:'num'}],returnType:'num',module:'std'},
  exp:{params:[{name:'x',type:'num'}],returnType:'num',module:'std'},
  PI:{params:[],returnType:'num',module:'std'},
  TAU:{params:[],returnType:'num',module:'std'},
  E:{params:[],returnType:'num',module:'std'},
  // Strings
  intToStr:{params:[{name:'x',type:'int'}],returnType:'str',module:'std'},
  numToStr:{params:[{name:'x',type:'num'}],returnType:'str',module:'std'},
  strLen:{params:[{name:'s',type:'str'}],returnType:'int',module:'std'},
  strConcat:{params:[{name:'a',type:'str'},{name:'b',type:'str'}],returnType:'str',module:'std'},
  substr:{params:[{name:'s',type:'str'},{name:'start',type:'int'},{name:'len',type:'int'}],returnType:'str',module:'std'},
  strEq:{params:[{name:'a',type:'str'},{name:'b',type:'str'}],returnType:'bool',module:'std'},
  charAt:{params:[{name:'s',type:'str'},{name:'i',type:'int'}],returnType:'int',module:'std'},
  // Storage — loadStr (matches saveStr)
  loadStr:{params:[{name:'key',type:'str'}],returnType:'str',module:'std'},
};
// Walk AST to find all called function names and their call info
function findCalls(node,names,callInfo){
  if(!node)return;
  if(node.type==='CallExpr'&&node.callee?.type==='IdentifierExpr'){
    var fn=node.callee.name;
    names.add(fn);
    if(!callInfo.has(fn))callInfo.set(fn,node.args);
  }
  if(node.type==='ArrayLiteral'){
    // Array literals desugar to newArray + setItem (or newNumArray + setNumItem for num).
    // Pick element type from the first non-string element.
    var hasNum=false, hasStr=false;
    for(var _ei=0;_ei<node.elements.length;_ei++){
      var _et=node.elements[_ei].type;
      if(_et==='FloatLiteral')hasNum=true;
      if(_et==='StringLiteral')hasStr=true;
    }
    names.add('newArray');
    if(hasNum)names.add('setNumItem');else names.add('setItem');
  }
  for(const k of Object.keys(node)){const v=node[k];if(v&&typeof v==='object'){if(Array.isArray(v))v.forEach(c=>findCalls(c,names,callInfo));else if(v.type)findCalls(v,names,callInfo)}}
}
// Guess param type from AST node
function guessType(arg){
  if(arg.type==='IntLiteral')return'int';
  if(arg.type==='FloatLiteral')return'num';
  if(arg.type==='StringLiteral')return'str';
  if(arg.type==='BoolLiteral')return'bool';
  return'int';
}
// Inject implicit imports for builtins AND unknown JS functions
function injectBuiltins(ast){
  const declared=new Set();
  for(const n of ast.body){if(n.type==='FunctionDecl'||n.type==='ImportDecl')declared.add(n.name)}
  const called=new Set();
  const callInfo=new Map();
  findCalls(ast,called,callInfo);
  // fnRef(name) or fnRef("name"): replace the argument with a callback descriptor string
  //   "@cb:<callback-table index>:<param types>:<return type>:<name>"
  // so the runtime can call the function through the callback table and marshal JS arguments
  // by the declared parameter types. (Table index = position among the program's functions.)
  var fnDecls=ast.body.filter(function(n){return n.type==='FunctionDecl'});
  // Names of all variables/parameters (a variable may hold a function name: fnRef(nameVar) stays dynamic)
  var _fnRefVars=null;
  function fnRefVarNames(){
    if(_fnRefVars)return _fnRefVars;
    _fnRefVars=new Set();
    (function walk(node){
      if(!node||typeof node!=='object')return;
      if(node.type==='VarDecl'&&node.name)_fnRefVars.add(node.name);
      if(node.type==='FunctionDecl')node.params.forEach(function(p){_fnRefVars.add(p.name)});
      for(const k in node){const v=node[k];if(v&&typeof v==='object'){if(Array.isArray(v))v.forEach(walk);else if(v.type)walk(v)}}
    })(ast);
    return _fnRefVars;
  }
  function findFnRefs(node){
    if(!node||typeof node!=='object')return;
    if(node.type==='CallExpr'&&node.callee&&node.callee.type==='IdentifierExpr'&&node.callee.name==='fnRef'){
      var a0=node.args[0];
      var refName=!a0?null:a0.type==='StringLiteral'?a0.value:a0.type==='IdentifierExpr'?a0.name:null;
      var fi=fnDecls.findIndex(function(f){return f.name===refName});
      if(fi<0&&a0&&a0.type==='IdentifierExpr'&&!fnRefVarNames().has(refName)){
        throw new Error((a0.loc?a0.loc.line+':'+a0.loc.col+': ':'')+'fnRef('+refName+') — there is no function named "'+refName+'" in this program');
      }
      if(fi>=0){
        var fd=fnDecls[fi];
        node.args[0]=new StringLiteral('@cb:'+fi+':'+fd.params.map(function(p){return p.type}).join(',')+':'+fd.returnType+':'+refName,a0.loc);
      }
    }
    for(const k in node){const v=node[k];if(v&&typeof v==='object'){if(Array.isArray(v))v.forEach(findFnRefs);else if(v.type)findFnRefs(v)}}
  }
  findFnRefs(ast);
  const injected=[];
  const autoJs=[];
  // Scan the AST for MemberExpr and bare-global IdentifierExpr
  var hasJsInterop=false;
  var usedGlobals=new Set();
  // Calling any Path C primitive directly also activates JS interop
  if(called.has('__jsGlobal')||called.has('__jsCall')||called.has('__jsGet')||called.has('__jsSet')||called.has('__jsNew')||called.has('__jsNum')||called.has('__jsStr'))hasJsInterop=true;
  if(called.has('jsAt')||called.has('jsGet'))hasJsInterop=true; // their results convert via __jsStr/__jsNum/__jsBool
  function scan(node,boundNames){
    if(!node||typeof node!=='object')return;
    if(node.type==='MemberExpr'||node.type==='IndexExpr')hasJsInterop=true;
    if(node.type==='VarDecl'&&node.name)boundNames.add(node.name);
    if(node.type==='IdentifierExpr'&&node.name){
      if(!boundNames.has(node.name)&&!declared.has(node.name)&&!BUILTINS[node.name]&&!called.has(node.name)){
        // An identifier that isn't a local/param, isn't a declared fn, isn't a builtin,
        // isn't a bare function call — treat as JS global lookup
        usedGlobals.add(node.name);
        hasJsInterop=true;
      }
    }
    for(var k in node){var v=node[k];if(v&&typeof v==='object'){if(Array.isArray(v))v.forEach(function(c){scan(c,boundNames)});else if(v.type)scan(v,boundNames)}}
  }
  // Collect all params+locals first per function, then scan
  for(const fn of ast.body){
    if(fn.type==='FunctionDecl'){
      var bound=new Set();
      for(const p of fn.params)bound.add(p.name);
      // Also top-level globals
      for(const g of ast.body)if(g.type==='VarDecl')bound.add(g.name);
      scan(fn.body,bound);
    }else if(fn.type==='VarDecl'&&fn.init){
      /* a top-level initial value that is not a literal (see TOP-LEVEL VALUES) may use JS interop too */
      var tb=new Set();
      for(const g of ast.body)if(g.type==='VarDecl')tb.add(g.name);
      scan(fn.init,tb);
    }
  }
  if(hasJsInterop){
    // Inject the __js__ imports (bidirectional interop: Global/Get/Call/New, Set, Num/Str conversions)
    ast.body.unshift(new ImportDecl('__jsGlobal',[{name:'namePtr',type:'str'}],'js','__js__',{line:0,col:0}));
    ast.body.unshift(new ImportDecl('__jsCall',[{name:'recv',type:'int'},{name:'namePtr',type:'str'},{name:'nArgs',type:'int'}],'int','__js__',{line:0,col:0}));
    ast.body.unshift(new ImportDecl('__jsNum',[{name:'h',type:'int'}],'num','__js__',{line:0,col:0}));
    ast.body.unshift(new ImportDecl('__jsStr',[{name:'h',type:'int'}],'str','__js__',{line:0,col:0}));
    ast.body.unshift(new ImportDecl('__jsGet',[{name:'recv',type:'int'},{name:'namePtr',type:'str'}],'int','__js__',{line:0,col:0}));
    ast.body.unshift(new ImportDecl('__jsSet',[{name:'recv',type:'int'},{name:'namePtr',type:'str'}],'void','__js__',{line:0,col:0}));
    ast.body.unshift(new ImportDecl('__jsNew',[{name:'recv',type:'int'},{name:'namePtr',type:'str'},{name:'nArgs',type:'int'}],'int','__js__',{line:0,col:0}));
    ast.body.unshift(new ImportDecl('__jsBool',[{name:'h',type:'int'}],'bool','__js__',{line:0,col:0}));
    injected.push('__js__');
  }
  for(const name of called){
    if(declared.has(name))continue;
    if(BUILTINS[name]){
      const b=BUILTINS[name];
      ast.body.unshift(new ImportDecl(name,b.params,b.returnType,b.module,{line:0,col:0}));
      injected.push(name);
    } else if(hasJsInterop&&(name==='__jsGlobal'||name==='__jsCall'||name==='__jsGet'||name==='__jsSet'||name==='__jsNew'||name==='__jsNum'||name==='__jsStr')){
      // Already injected via __js__ — skip auto-bridge to avoid duplicate import
      continue;
    } else {
      // Unknown function — auto-import from "js" with inferred signature
      var args=callInfo.get(name)||[];
      var params=args.map(function(a,i){return{name:'a'+i,type:guessType(a)}});
      // Return type: if the file uses member access anywhere (Path C is active),
      // unknown calls return int (handle) to enable method chains like dayjs().format(...).
      // Otherwise default to void (pure side effect, traditional behavior).
      var retType=hasJsInterop?'js':'void';
      // A variable called like a function (`let f = d3.format(".2f")` … `f(3.14)`) is not a global function.
      if(fnRefVarNames().has(name))continue;
      // The call itself is compiled as window.name(args) through the argument buffer (__jsCallG: any
      // argument count/types per call site, the result is always a js value). This declaration is never
      // called; it only keeps the name in the import list (the "⚡ JS:" line, library auto-loading by name).
      var _autoDecl=new ImportDecl(name,[],'void','js',{line:0,col:0});_autoDecl.auto=true;
      ast.body.unshift(_autoDecl);
      injected.push(name);
      autoJs.push(name);
    }
  }
  return{injected:injected,autoJs:autoJs,usedGlobals:Array.from(usedGlobals)};
}

// ═══ TOP-LEVEL VALUES (runtime half) ═══
// The compiler turns every top-level `let` / `mut` whose initial value is not a literal into an exported
// function "__emitInit.<k> <name> <file:line:col>" (see TOP-LEVEL VALUES in the compiler). _emitInitRun(inst)
// calls them once per instance, in the order k, before any other export of that instance runs: Run and the
// export boot call it right after instantiating, and _emitCallExport calls it first if nobody has (so every
// path into the program — Results, Tap to call, buttons, timers, frame() — sees the values set). A failure —
// a JS exception, an interop error that elsewhere only prints a red line, a region bounds error, a trap —
// stops the initialisation: the message names the variable and its position (path:line:col: …), and every
// later call of an export of that instance throws it again. Returns that message, or null.
var _initState=(typeof WeakMap==='function')?new WeakMap():null,_initCur=null,_initCall=null;
function _emitInitSteps(inst){
  var out=[];
  for(var k in inst.exports){var m=/^__emitInit\.(\d+) (\S+) (\S+)$/.exec(k);if(m&&typeof inst.exports[k]==='function')out.push({k:Number(m[1]),fn:k,name:m[2],at:m[3]})}
  return out.sort(function(a,b){return a.k-b.k});
}
function _emitInitRun(inst){
  if(!inst||!inst.exports||!_initState)return null;
  var st=_initState.get(inst);
  if(st)return st.err;
  st={err:null};_initState.set(inst,st);
  var steps=_emitInitSteps(inst);
  for(var i=0;i<steps.length;i++){
    var s=steps[i],was=_initCur;_initCur=s;
    try{_initCall(inst,s.fn,[])}
    catch(e){st.err=s.at+": Top-level '"+s.name+"' could not be set — "+_errMsg(_emitWaitErr(e));break}
    finally{_initCur=was}
  }
  return st.err;
}
// While an initialiser runs, an interop error ends it (instead of printing a red line and going on with null).
_jsErr=(function(report){return function(what,e){
  if(_initCur&&!_tryMode){var x=new Error(what+': '+_errMsg(e));x.emitInit=true;throw x}
  return report.apply(this,arguments);
}})(_jsErr);
_emitCallExport=(function(call){_initCall=call;return function(inst,name,args,top){
  if(!_initCur&&_initState&&inst&&inst.exports){var err=_emitInitRun(inst);if(err)throw new Error(err)}
  return call.apply(this,arguments);
}})(_emitCallExport);
if(typeof window!=='undefined'){window._emitCallExport=_emitCallExport;window._emitInitRun=_emitInitRun}
//#emit-runtime-end

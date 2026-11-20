// Lifetime hook for the runtime (see "LIFETIME" in the runtime section): the finished module is rewritten so
// that every WASM global is also exported, as "__g<index>", and the memory a second time as "__emitGC".
// The runtime reads the globals through these exports to find the js/str/array values a program still holds.
// Nothing else in the module changes; if the rewrite fails the module is returned as it was (and the
// runtime then never releases anything).
function _emitExportGlobals(bytes){
  var p=8,nG=0,exS=-1,exC=0,exE=0;
  function leb(){var r=0,s=0,c;do{c=bytes[p++];r+=(c&0x7F)*Math.pow(2,s);s+=7}while(c&0x80);return r}
  function name(){var n=leb();p+=n}
  function limits(){var f=leb();leb();if(f&1)leb()}
  while(p<bytes.length){
    var at=p,id=bytes[p++],size=leb(),start=p;
    if(id===2){
      for(var n=leb();n>0;n--){
        name();name();var kind=bytes[p++];
        if(kind===0)leb();else if(kind===1){p++;limits()}else if(kind===2)limits();else if(kind===3){p+=2;nG++}else if(kind===4){p++;leb()}else throw new Error('import kind');
      }
    }else if(id===6)nG+=leb();
    else if(id===7){exS=at;exC=start;exE=start+size}
    p=start+size;
  }
  if(exS<0||p!==bytes.length)throw new Error('module layout');
  p=exC;var count=leb(),body=Array.prototype.slice.call(bytes,p,exE);
  body.push(...estr('__emitGC'),2,...eu32(0));
  for(var g=0;g<nG;g++)body.push(...estr('__g'+g),3,...eu32(g));
  var sec=[...eu32(count+1+nG),...body],out=new Uint8Array(exS+1+eu32(sec.length).length+sec.length+bytes.length-exE);
  out.set(bytes.subarray(0,exS+1),0);p=exS+1;
  out.set(eu32(sec.length),p);p+=eu32(sec.length).length;
  out.set(sec,p);p+=sec.length;
  out.set(bytes.subarray(exE),p);
  return out;
}
(function(){
  var enc=WasmCodegen.prototype.encodeBinary;
  WasmCodegen.prototype.encodeBinary=function(){
    var b=enc.apply(this,arguments);
    try{return _emitExportGlobals(b)}catch(e){return b}
  };
})();
// Lifetime hook 2: the SHADOW STACK (compiler half; the runtime half is "PARKED SCOPES" in the runtime section).
// A call suspended in an `await` (JSPI) keeps its whole WASM stack — every Emit frame from the function JS called
// down to the await, with their locals and operand-stack temporaries — where the runtime cannot see it. So that
// collections can run while such a call is suspended, the finished module is rewritten. Only a module that
// imports __js__.__await is touched; every other module is returned byte for byte as it was.
//   • S = the functions that can reach a call of __await through direct calls, found in the code itself (the
//     compiler emits no call_indirect, so this is exact — whatever wrapper generated the function).
//   • In every function of S, right before each call that can suspend (a call of __await or of a function in S):
//       1. operand-stack values below the call's arguments, and below every enclosing block/loop/if of this
//          function, from the lowest i32/i64 one up (an i32/i64 can be a handle, a string address or an array id)
//          are popped into fresh locals and pushed back: the stack is unchanged, the values are now in locals;
//       2. every i32/i64 local of the function (parameters, variables, temporaries, the fresh locals of 1) is
//          stored in this frame's slots of the shadow stack: SP = the u32 at _SS_ADDR (bytes in use), the slots
//          are _SS_BASE+SP … +8n, then SP += 8n. If they would not fit below 64 KB nothing is stored (SP still
//          moves; the runtime sees SP past _SS_CAP and does not count the call as parked).
//     and right after the call: SP -= 8n — except after __await, which resumes from a promise job: there the
//     frame size 8n is stored at _SS_ADDR+4 before the call, and __awaitPost (the call after it) puts the
//     invocation's region back and sets SP to its end minus 8n (see _scopeResume).
//     Per suspending call: 18 + 3n instructions (+1 per i32 local); per await 15 + 3n; plus 2 per value of
//     step 1 (usually none: statement-level awaits and calls leave nothing on the operand stack).
//   • The memory is exported once more as "__emitSS": the runtime's sign that the module keeps a shadow stack.
// Functions outside S are not changed at all. An instruction or construct the rewriter does not know, or an
// invalid result, makes it give up and return the module unchanged (without "__emitSS" the runtime never parks
// a suspended call: nothing it holds is released before it completes — safe, as before).
var _SS_ADDR=53248,_SS_BASE=53256,_SS_CAP=12280; /* 53248…65535: unused part of the first page (above the string scratch slots) */
function _emitAwaitRoots(bytes){
  var b=bytes,p=8,I=0x7F,L=0x7E,F=0x7D,D=0x7C;
  function u(){var r=0,s=0,c;do{c=b[p++];r+=(c&0x7F)*Math.pow(2,s);s+=7}while(c&0x80);return r}
  function s33(){var r=0,s=0,c;do{c=b[p++];r+=(c&0x7F)*Math.pow(2,s);s+=7}while(c&0x80);if(c&0x40)r-=Math.pow(2,s);return r}
  function skip(){while(b[p++]&0x80);}
  function name(){var n=u(),s='';for(var i=0;i<n;i++)s+=String.fromCharCode(b[p+i]);p+=n;return s}
  function vt(c){if(c===I||c===L||c===F||c===D)return c;throw new Error('value type 0x'+c.toString(16))}
  function limits(){var f=u();u();if(f&1)u();return f}
  // one instruction at p: {op, x} where x is the index / block type / sub-opcode immediate
  function ins(){
    var op=b[p++],x=0;
    if(op===0x02||op===0x03||op===0x04)x=s33();
    else if(op===0x0C||op===0x0D||op===0x10||(op>=0x20&&op<=0x24))x=u();
    else if(op===0x0E){for(var n=u();n>=0;n--)u()}
    else if(op===0x11){x=u();u()}
    else if(op===0x1C){if(u()!==1)throw new Error('select');x=vt(b[p++])}
    else if(op>=0x28&&op<=0x3E){if(u()&0x40)throw new Error('memidx');u()}
    else if(op===0x3F||op===0x40){if(b[p++]!==0)throw new Error('memidx')}
    else if(op===0x41||op===0x42)skip();
    else if(op===0x43)p+=4;
    else if(op===0x44)p+=8;
    else if(op===0xFC){x=u();if(x===8){u();p++}else if(x===9)u();else if(x===10)p+=2;else if(x===11)p++;else if(x>7)throw new Error('0xFC '+x)}
    else if(!(op===0x00||op===0x01||op===0x05||op===0x0B||op===0x0F||op===0x1A||op===0x1B||(op>=0x45&&op<=0xC4)))throw new Error('opcode 0x'+op.toString(16));
    return{op:op,x:x};
  }
  // ── sections ──
  var secs=[],types=[],funcs=[],globals=[],nImp=0,awaitIdx=-1,code=null,exp=null;
  while(p<b.length){
    var at=p,id=b[p++],size=u(),start=p,n,k;
    secs.push({id:id,at:at,start:start,end:start+size});
    if(id===1)for(n=u();n>0;n--){
      if(b[p++]!==0x60)throw new Error('type form');
      var ps=[],rs=[];for(k=u();k>0;k--)ps.push(vt(b[p++]));for(k=u();k>0;k--)rs.push(vt(b[p++]));
      types.push({p:ps,r:rs});
    }else if(id===2)for(n=u();n>0;n--){
      var mod=name(),nm=name(),kind=b[p++];
      if(kind===0){if(mod==='__js__'&&nm==='__await')awaitIdx=funcs.length;funcs.push(u());nImp++}
      else if(kind===1){p++;limits()}
      else if(kind===2){if(limits()&4)return bytes} /* memory64: not handled */
      else if(kind===3){globals.push(vt(b[p++]));p++}
      else throw new Error('import kind');
    }else if(id===3)for(n=u();n>0;n--)funcs.push(u());
    else if(id===5){for(n=u();n>0;n--)if(limits()&4)return bytes}
    else if(id===6)for(n=u();n>0;n--){globals.push(vt(b[p++]));p++;while(ins().op!==0x0B);}
    else if(id===7)exp=secs[secs.length-1];
    else if(id===10)code=secs[secs.length-1];
    p=start+size;
  }
  if(awaitIdx<0)return bytes;
  if(!code||!exp)throw new Error('module layout');
  // ── function bodies: locals, instructions, direct calls ──
  var bodies=[];
  p=code.start;
  for(n=u();n>0;n--){
    var sz=u(),bs=p,be=p+sz,groups=[],locals=[];
    for(k=u();k>0;k--){var c=u(),t=vt(b[p++]);groups.push([c,t]);for(var j=0;j<c;j++)locals.push(t)}
    var is=p,list=[],calls=new Set();
    while(p<be){var at=p,r=ins();list.push({at:at,end:p,op:r.op,x:r.x});if(r.op===0x10)calls.add(r.x);if(r.op===0x11)throw new Error('call_indirect')}
    if(p!==be)throw new Error('body size');
    bodies.push({bs:bs,be:be,is:is,groups:groups,locals:locals,list:list,calls:calls});
  }
  if(bodies.length!==funcs.length-nImp)throw new Error('function count');
  var S=new Set(),more=true;
  while(more){
    more=false;
    bodies.forEach(function(B,i){
      var fi=nImp+i;if(S.has(fi))return;
      for(var c of B.calls)if(c===awaitIdx||S.has(c)){S.add(fi);more=true;break}
    });
  }
  // ── stack effects ──
  var SIG={},o;
  function sg(op,a,r){SIG[op]=[a,r]}
  sg(0x45,[I],I);for(o=0x46;o<=0x4F;o++)sg(o,[I,I],I);sg(0x50,[L],I);for(o=0x51;o<=0x5A;o++)sg(o,[L,L],I);
  for(o=0x5B;o<=0x60;o++)sg(o,[F,F],I);for(o=0x61;o<=0x66;o++)sg(o,[D,D],I);
  for(o=0x67;o<=0x69;o++)sg(o,[I],I);for(o=0x6A;o<=0x78;o++)sg(o,[I,I],I);
  for(o=0x79;o<=0x7B;o++)sg(o,[L],L);for(o=0x7C;o<=0x8A;o++)sg(o,[L,L],L);
  for(o=0x8B;o<=0x91;o++)sg(o,[F],F);for(o=0x92;o<=0x98;o++)sg(o,[F,F],F);
  for(o=0x99;o<=0x9F;o++)sg(o,[D],D);for(o=0xA0;o<=0xA6;o++)sg(o,[D,D],D);
  [[L,I],[F,I],[F,I],[D,I],[D,I],[I,L],[I,L],[F,L],[F,L],[D,L],[D,L],[I,F],[I,F],[L,F],[L,F],[D,F],[I,D],[I,D],[L,D],[L,D],[F,D],[F,I],[D,L],[I,F],[L,D],[I,I],[I,I],[L,L],[L,L],[L,L]]
    .forEach(function(c,i){sg(0xA7+i,[c[0]],c[1])});
  [I,L,F,D,I,I,I,I,L,L,L,L,L,L].forEach(function(t,i){sg(0x28+i,[I],t)});
  [I,L,F,D,I,I,L,L,L].forEach(function(t,i){sg(0x36+i,[I,t],null)});
  sg(0x41,[],I);sg(0x42,[],L);sg(0x43,[],F);sg(0x44,[],D);sg(0x3F,[],I);sg(0x40,[I],I);sg(0x1A,[0],null);
  var SAT=[[F,I],[F,I],[D,I],[D,I],[F,L],[F,L],[D,L],[D,L]];
  function blockSig(x){if(x===-64)return{p:[],r:[]};if(x<0&&x>=-4)return{p:[],r:[128+x]};var t=types[x];if(!t)throw new Error('block type');return t}
  function leb(v){return eu32(v)}
  function sleb(v){return ei32(v)}
  // ── rewrite one function of S ──
  function rewrite(B,fi){
    var ft=types[funcs[fi]],lt=ft.p.concat(B.locals),nFix=lt.length,temps=[];
    var stack=[],ctl=[{h:0,unr:false,dead:false,res:ft.r,rec:null}],fixes=[],sites=[];
    function pop(){var f=ctl[ctl.length-1];if(stack.length<=f.h){if(f.unr)return 0;throw new Error('stack underflow')}return stack.pop()}
    function popT(t){var v=pop();if(v&&t&&v!==t)throw new Error('stack type');return v}
    function cut(f){f.unr=true;stack.length=f.h}
    B.list.forEach(function(it,k){
      var f=ctl[ctl.length-1],op=it.op,x=it.x,s,i;
      if(op===0x02||op===0x03||op===0x04){
        s=blockSig(x);if(s.p.length)throw new Error('block params');
        if(op===0x04)popT(I);
        var rec={k:k,lvl:stack.slice(f.h),top:op===0x04?[I]:[],need:false,dead:f.dead||f.unr};
        fixes.push(rec);
        ctl.push({h:stack.length,unr:false,dead:rec.dead,res:s.r,rec:rec});
      }else if(op===0x05){stack.length=f.h;f.unr=false}
      else if(op===0x0B){ctl.pop();stack.length=f.h;for(i=0;i<f.res.length;i++)stack.push(f.res[i])}
      else if(op===0x00||op===0x0C||op===0x0F)cut(f);
      else if(op===0x0D)popT(I);
      else if(op===0x0E){popT(I);cut(f)}
      else if(op===0x10){
        var ct=types[funcs[x]];
        if((x===awaitIdx||S.has(x))&&!f.unr&&!f.dead){
          var na=ct.p.length,lvl=stack.slice(f.h,stack.length-na),top=stack.slice(stack.length-na);
          if(lvl.length+f.h+na!==stack.length||stack.length-na<f.h)throw new Error('call arguments');
          sites.push({k:k,lvl:lvl,top:top,aw:x===awaitIdx});
          for(i=1;i<ctl.length;i++)ctl[i].rec.need=true;
        }
        for(i=ct.p.length-1;i>=0;i--)popT(ct.p[i]);
        for(i=0;i<ct.r.length;i++)stack.push(ct.r[i]);
      }
      else if(op===0x1B){popT(I);var a=pop(),c=pop();stack.push(a||c)}
      else if(op===0x1C){popT(I);pop();pop();stack.push(x)}
      else if(op===0x20)stack.push(lt[x]);
      else if(op===0x21)popT(lt[x]);
      else if(op===0x22){popT(lt[x]);stack.push(lt[x])}
      else if(op===0x23)stack.push(globals[x]);
      else if(op===0x24)popT(globals[x]);
      else if(op===0xFC){if(x<=7){popT(SAT[x][0]);stack.push(SAT[x][1])}else if(x!==9){popT(I);popT(I);popT(I)}}
      else if(op===0x01){}
      else if(SIG[op]){s=SIG[op];for(i=s[0].length-1;i>=0;i--)popT(s[0][i]);if(s[1])stack.push(s[1])}
      else throw new Error('opcode 0x'+op.toString(16));
    });
    if(ctl.length)throw new Error('unbalanced');
    if(!sites.length)return null;
    function temp(t){temps.push(t);return nFix+temps.length-1}
    // pop the values from the lowest i32/i64 one up (and the `top` values above them) into fresh locals, push back
    function save(lvl,top){
      var j=-1,i;
      for(i=0;i<lvl.length;i++)if(lvl[i]===I||lvl[i]===L){j=i;break}
      if(j<0)return[];
      var keep=lvl.slice(j).concat(top),ix=[],out=[];
      for(i=0;i<keep.length;i++){if(!keep[i])throw new Error('unknown stack type');ix.push(temp(keep[i]))}
      for(i=ix.length-1;i>=0;i--)out.push(0x21,...leb(ix[i]));
      for(i=0;i<ix.length;i++)out.push(0x20,...leb(ix[i]));
      return out;
    }
    var pre=new Map(),post=new Map();
    fixes.forEach(function(r){if(r.need&&!r.dead){var c=save(r.lvl,r.top);if(c.length)pre.set(r.k,c)}});
    sites.forEach(function(st){st.save=save(st.lvl,st.top)});
    var sp=temp(I),all=lt.concat(temps),slots=[];
    for(var i=0;i<all.length;i++)if((all[i]===I||all[i]===L)&&i!==sp)slots.push(i);
    var SIZE=slots.length*8,spill=[],pop2=[];
    if(SIZE){
      spill.push(0x41,...sleb(_SS_ADDR),0x28,2,0,0x22,...leb(sp));
      if(SIZE<=_SS_CAP){
        spill.push(0x41,...sleb(_SS_CAP-SIZE),0x4D,0x04,0x40);
        slots.forEach(function(li,q){spill.push(0x20,...leb(sp),0x20,...leb(li));if(all[li]===I)spill.push(0xAD);spill.push(0x37,3,...leb(_SS_BASE+q*8))});
        spill.push(0x0B);
      }else spill.push(0x1A);
      spill.push(0x41,...sleb(_SS_ADDR),0x20,...leb(sp),0x41,...sleb(SIZE),0x6A,0x36,2,0);
      pop2.push(0x41,...sleb(_SS_ADDR),0x41,...sleb(_SS_ADDR),0x28,2,0,0x41,...sleb(SIZE),0x6B,0x36,2,0);
    }else spill=[];
    /* an await: the frame size goes to _SS_ADDR+4 instead of the pop — the call resumes in a promise job, and
       __awaitPost (the next call) puts the region back and sets SP to its end minus this frame */
    var awSize=[0x41,...sleb(_SS_ADDR+4),0x41,...sleb(SIZE),0x36,2,0];
    sites.forEach(function(st){
      var c=(pre.get(st.k)||[]).concat(st.save,spill,st.aw?awSize:[]);if(c.length)pre.set(st.k,c);
      if(pop2.length&&!st.aw)post.set(st.k,pop2);
    });
    // locals: the original groups, then the new ones
    var g=B.groups.slice(),last=null;
    temps.forEach(function(t){if(last&&last[1]===t)last[0]++;else{last=[1,t];g.push(last)}});
    var head=leb(g.length);g.forEach(function(x){head.push(...leb(x[0]),x[1])});
    var parts=[new Uint8Array(head)],pos=B.is;
    B.list.forEach(function(it,k){
      var c=pre.get(k);
      if(c){parts.push(b.subarray(pos,it.at),new Uint8Array(c));pos=it.at}
      c=post.get(k);
      if(c){parts.push(b.subarray(pos,it.end),new Uint8Array(c));pos=it.end}
    });
    parts.push(b.subarray(pos,B.be));
    return parts;
  }
  // ── reassemble ──
  var out=[],total=0;
  function add(x){x=x instanceof Uint8Array?x:new Uint8Array(x);out.push(x);total+=x.length}
  var cparts=[],clen=0;
  bodies.forEach(function(B,i){
    var parts=S.has(nImp+i)?rewrite(B,nImp+i):null;
    if(!parts)parts=[b.subarray(B.bs,B.be)];
    var len=0;parts.forEach(function(x){len+=x.length});
    var h=new Uint8Array(leb(len));cparts.push(h);clen+=h.length;
    parts.forEach(function(x){cparts.push(x);clen+=x.length});
  });
  add(b.subarray(0,8));
  secs.forEach(function(s){
    if(s.id===10){
      var cnt=leb(bodies.length);add([10].concat(leb(cnt.length+clen)));add(cnt);cparts.forEach(add);
    }else if(s.id===7){
      p=s.start;var c=u(),rest=b.subarray(p,s.end),tail=[].concat(estr('__emitSS'),[2],leb(0)),head=leb(c+1);
      add([7].concat(leb(head.length+rest.length+tail.length)));add(head);add(rest);add(tail);
    }else add(b.subarray(s.at,s.end));
  });
  var res=new Uint8Array(total),q=0;
  out.forEach(function(x){res.set(x,q);q+=x.length});
  if(typeof WebAssembly!=='undefined'&&WebAssembly.validate&&!WebAssembly.validate(res))throw new Error('rewritten module does not validate');
  return res;
}
(function(){
  var enc=WasmCodegen.prototype.encodeBinary;
  WasmCodegen.prototype.encodeBinary=function(){
    var b=enc.apply(this,arguments);
    try{return _emitAwaitRoots(b)}catch(e){return b}
  };
})();

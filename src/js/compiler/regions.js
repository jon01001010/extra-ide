// ═══ MEMORY REGIONS & STRUCTS ═══ data in WebAssembly linear memory, read and written with plain load/store
// instructions (no JS call per access), without C's failure modes. Compiler half; the runtime half is the
// "MEMORY REGIONS" part of the runtime block (_rg… names, _emitRegions() & co.).
//
//   struct Ball { x: num, y: num, r: int, alive: bool, pos: num[3], vel: Vec }   (top level, may be public)
//   region balls: Ball[100]        region fb: u8[320 * 200 * 4]                  (top level, may be public)
//   balls[i].x = 1.5   grid[3] += 1   grid.length   fill wipe copy swap freeze thaw frozen view screen
//   with balls[i] as b { b.x = b.x + b.vx }      fn sum(r: region int) int { … }
//
// Pipeline. The parser makes StructDecl / RegionDecl / WithStmt nodes and `region T` parameter types
// ("region<T>"); _emitModLink resolves struct names in types and region names like any other top-level name
// (public / private / mangled "module.name"). _rgLower(ast) then runs right before injectBuiltins: it lays out
// the structs (natural alignment, declaration order, size rounded to the alignment) and the regions (from
// 65536 up, 8-aligned, then a 16-byte descriptor per region: base u32, length u32, frozen u8, pad, id u32),
// and rewrites every use of a region into RegionPlace (an element, field or field-array slot: load, or store
// target), RegionStore, RegionOp (fill wipe copy swap freeze thaw frozen view screen), RegionArg (a region
// passed to a `region T` parameter: the address of its descriptor) and RegionLen. Nothing of this reaches
// the rest of the compiler as an IdentifierExpr / IndexExpr / MemberExpr, so injectBuiltins never mistakes a
// region for a JS global. A program without struct / region / with is not touched at all (same bytes).
//
//   bounds   every index is checked (one unsigned i64 compare) unless it is a constant in range; a constant
//            out of range is a compile error. A failed check calls __regionFail(code, descriptor, index, posId)
//            — the runtime throws (or, inside try, records) "grid[70]: index out of range (length 64) at
//            main.emit:12:5"; posId indexes a table of source positions carried in the region metadata.
//   freeze   one byte in the descriptor, loaded and tested before every store (__regionFail code 2).
//   alias    `with balls[i] as b { … }`: the element address is computed (and checked) once into a local;
//            b.f is a direct load / store. b is not a value: it cannot be stored, returned, passed, assigned.
//   metadata imports.heapBase (first byte the string allocator may use) and imports.regionMeta (JSON: regions,
//            structs, source positions) ride on the import list like imports.asyncFns, so exported pages get
//            them through importProps. The module's memory section and data segment are patched afterwards
//            (initial pages = heapBase / 65536; the descriptor table as a data segment).
class StructDecl extends Z{constructor(n,f,l){super('StructDecl',l);this.name=n;this.fields=f}}
class RegionDecl extends Z{constructor(n,e,s,l){super('RegionDecl',l);this.name=n;this.elem=e;this.size=s}}
class WithStmt extends Z{constructor(t,a,b,l){super('WithStmt',l);this.target=t;this.alias=a;this.body=b}}
var _RG_SCALAR={i8:{size:1,kind:'int'},u8:{size:1,kind:'int'},i16:{size:2,kind:'int'},u16:{size:2,kind:'int'},i32:{size:4,kind:'int'},u32:{size:4,kind:'int'},int:{size:8,kind:'int'},f32:{size:4,kind:'num'},num:{size:8,kind:'num'},bool:{size:1,kind:'bool'}};
var _RG_OPS={fill:1,wipe:1,copy:1,swap:1,freeze:1,thaw:1,frozen:1,view:1,screen:1};
var _RG_MAX_BYTES=268435456; // 256 MB of static regions in total
function _rgScalar(t){t=t==='i64'?'int':t==='f64'?'num':t;return Object.prototype.hasOwnProperty.call(_RG_SCALAR,t)?t:null}
function _rgParamElem(t){var m=/^region<(.+)>$/.exec(t||'');return m?m[1]:null}
// Constant folding of a size / index expression: int literals, unary -, + - * / % (integer division). null if not constant.
function _rgTryFold(e){
  var v=(function f(x){
    if(!x||typeof x!=='object')return NaN;
    if(x.type==='IntLiteral')return Number(x.value);
    if(x.type==='UnaryExpr'&&x.op==='-')return -f(x.operand);
    if(x.type==='BinaryExpr'){
      var a=f(x.left),b=f(x.right);
      switch(x.op){case'+':return a+b;case'-':return a-b;case'*':return a*b;case'/':return b===0?NaN:Math.trunc(a/b);case'%':return b===0?NaN:a%b}
    }
    return NaN;
  })(e);
  return Number.isSafeInteger(v)?v:null;
}
_JS_CONV_IMPORTS.__regionFail=[[['code','i32'],['rg','i32'],['i','int'],['pos','i32']],'void'];  // 1 index, 2 frozen, 4 field-array index: throws / records
_JS_CONV_IMPORTS.__regionOp=[[['op','i32'],['a','i32'],['b','i32'],['vi','int'],['vf','num'],['pos','i32']],'bool']; // 1 fill 2 wipe 3 copy a→b 4 swap; 1 = failed (recorded)
_JS_CONV_IMPORTS.__regionView=[[['rg','i32']],'js'];                                             // typed array over the region's bytes
_JS_CONV_IMPORTS.__regionScreen=[[['rg','i32'],['w','int'],['h','int'],['scale','int'],['pos','i32']],'bool'];
// ── syntax ──
// `struct` / `region` / `with` are not keywords: they are recognised by position only (a top-level line
// `struct Name {`, `region name:`, a statement `with <expr> as name {`, a type `region T` after `:`), so
// variables and JS properties with these names keep working.
(function(){
  var P=Parser.prototype,top0=P.parseTop,stmt0=P.parseStmt,type0=P.parseType,tk0=Lexer.prototype.tokenize;
  Lexer.prototype.tokenize=function(){
    var ts=tk0.call(this);
    for(var i=0;i+2<ts.length;i++){
      var t=ts[i],n=ts[i+1],n2=ts[i+2];
      if(t.type===TT.IDENTIFIER&&t.value==='public'&&n.type===TT.IDENTIFIER&&(n.value==='struct'||n.value==='region')&&n.line===t.line&&n2.type===TT.IDENTIFIER&&n2.line===t.line)t.type=TT.KEYWORD;
    }
    return ts;
  };
  function word(p,what){var t=p.cur();if(t.type===TT.IDENTIFIER||t.type===TT.TYPE)return p.adv();throw p.err(what)}
  function typeName(p,what){var w=String(word(p,what).value);while(p.check(TT.DOT)){p.adv();w+='.'+String(word(p,'Expected a name after the dot in the type '+w).value)}return w}
  var ELEMS='i8 u8 i16 u16 i32 u32 int f32 num bool or a struct name';
  P.parseStruct=function(l){
    this.adv();
    var nt=this.cur();
    if(nt.type!==TT.IDENTIFIER)throw this.err('Expected a name after struct — struct Ball { x: num, y: num }');
    this.adv();
    if(!this.check(TT.LBRACE))throw this.err('Expected { after struct '+nt.value+' — struct '+nt.value+' { x: num, y: num }');
    this.adv();
    var fields=[];
    while(!this.check(TT.RBRACE)){
      if(this.check(TT.EOF))throw this.err('struct '+nt.value+' is not closed — expected }');
      var f=this.cur();
      if(f.type!==TT.IDENTIFIER&&f.type!==TT.TYPE&&f.type!==TT.KEYWORD)throw this.err('Expected a field name in struct '+nt.value+' — name: type, e.g. x: num');
      this.adv();
      if(!this.match(TT.COLON))throw this.err('Expected : after the field name "'+f.value+'" — write '+f.value+': num');
      var tl=this.loc(),ty=typeName(this,'Expected the type of field "'+f.value+'" — '+ELEMS),count=null;
      if(this.check(TT.LBRACKET)){this.adv();count=this.parseExpr();this.expect(TT.RBRACKET)}
      fields.push({name:String(f.value),type:ty,count:count,loc:{line:f.line,col:f.col},typeRef:{loc:tl}});
      if(!this.match(TT.COMMA))this.match(TT.SEMICOLON);
    }
    this.adv();
    var d=new StructDecl(nt.value,fields,l);
    d.nameRef={loc:{line:nt.line,col:nt.col}};
    return d;
  };
  P.parseRegion=function(l){
    this.adv();
    var nt=this.cur();
    if(nt.type!==TT.IDENTIFIER)throw this.err('Expected a name after region — region grid: int[64]');
    this.adv();
    if(!this.match(TT.COLON))throw this.err('Expected : after region '+nt.value+' — region '+nt.value+': int[64]');
    var tl=this.loc(),ty=typeName(this,'Expected the element type of region '+nt.value+' — region '+nt.value+': int[64] ('+ELEMS+')');
    if(!this.check(TT.LBRACKET))throw this.err('Expected [size] after the element type — region '+nt.value+': '+ty+'[64]');
    this.adv();
    var sz=this.parseExpr();
    this.expect(TT.RBRACKET);
    this.match(TT.SEMICOLON);
    var d=new RegionDecl(nt.value,ty,sz,l);
    d.nameRef={loc:{line:nt.line,col:nt.col}};d.elemRef={loc:tl};
    return d;
  };
  P.parseTop=function(){
    var t=this.cur(),n=this.t[this.p+1];
    if(t.type===TT.KEYWORD&&t.value==='public'&&n&&n.type===TT.IDENTIFIER&&(n.value==='struct'||n.value==='region')){
      var sl=this.loc();this.adv();
      var d=n.value==='struct'?this.parseStruct(sl):this.parseRegion(sl);
      d.isPublic=true;return d;
    }
    if(t.type===TT.IDENTIFIER&&n&&n.type===TT.IDENTIFIER&&n.line===t.line){
      if(t.value==='struct')return this.parseStruct(this.loc());
      if(t.value==='region')return this.parseRegion(this.loc());
    }
    return top0.call(this);
  };
  P.parseStmt=function(){
    var t=this.cur(),n=this.t[this.p+1];
    if(t.type===TT.IDENTIFIER&&n&&n.line===t.line&&n.type===TT.IDENTIFIER){
      if(t.value==='with')return this.parseWith();
      var n2=this.t[this.p+2];
      if((t.value==='struct'&&n2&&n2.type===TT.LBRACE)||(t.value==='region'&&n2&&n2.type===TT.COLON))throw this.err(t.value+' declarations belong at the top level of a file, not inside a function');
    }
    return stmt0.call(this);
  };
  P.parseWith=function(){
    var l=this.loc();this.adv();
    var target=this.parseExpr();
    if(!this.check(TT.KEYWORD,'as'))throw this.err('Expected as after the element — with balls[i] as b { b.x = 0 }');
    this.adv();
    var a=this.cur();
    if(a.type!==TT.IDENTIFIER)throw this.err('Expected a name after as — with balls[i] as b { … }');
    this.adv();
    if(!this.check(TT.LBRACE))throw this.err('Expected { after with … as '+a.value+' — the alias is valid inside that block');
    var w=new WithStmt(target,a.value,this.parseBlock(),l);
    w.aliasLoc={line:a.line,col:a.col};
    return w;
  };
  P.parseType=function(){
    var t=this.cur(),n=this.t[this.p+1];
    if(t.type===TT.IDENTIFIER&&t.value==='region'&&n&&(n.type===TT.IDENTIFIER||n.type===TT.TYPE)&&n.line===t.line){this.adv();return'region<'+typeName(this,'')+'>'}
    return type0.call(this);
  };
  // As the original, plus the position of a `region T` parameter (for its error messages).
  P.parseParams=function(){
    const p=[];if(this.check(TT.RPAREN))return p;
    do{const n=this.expect(TT.IDENTIFIER).value;this.expect(TT.COLON);const l=this.loc(),prm={name:n,type:this.parseType()};if(/^region</.test(prm.type))prm.loc=l;p.push(prm)}while(this.match(TT.COMMA));
    return p;
  };
})();
// The entry module (path, name) — the file a position without a file belongs to.
_emitModLink=(function(link){return function(fr){
  var r=link.apply(this,arguments);
  if(r&&r.ast&&fr&&fr.mods&&fr.mods[0])r.ast.rgEntry={path:fr.mods[0].path,name:fr.mods[0].name};
  return r;
}})(_emitModLink);
injectBuiltins=(function(inj){return function(ast){_rgLower(ast);return inj.apply(this,arguments)}})(injectBuiltins);
// ── layout + lowering ──
function _rgLower(ast){
  var body=ast.body,has=false;
  (function scan(x){
    if(has||!x||typeof x!=='object')return;
    if(Array.isArray(x)){for(var i=0;i<x.length;i++)scan(x[i]);return}
    if(x.type==='StructDecl'||x.type==='RegionDecl'||x.type==='WithStmt'){has=true;return}
    if(x.type==='FunctionDecl'&&(x.params.some(function(p){return /^region</.test(p.type)})||/^region</.test(x.returnType||''))){has=true;return}
    if(x.type==='VarDecl'&&/^region</.test(x.varType||'')){has=true;return}
    for(var k in x){if(k==='loc')continue;var v=x[k];if(v&&typeof v==='object')scan(v)}
  })(body);
  if(!has)return;
  var entry=ast.rgEntry||{path:'main.emit',name:'main'};
  function fail(msg,loc){throw new Error((loc&&loc.file?loc.file+':':'')+(loc?(loc.line||1)+':'+(loc.col||1)+': ':'')+msg)}
  function src(n){return n.modName||n.name}
  function fold(e,what){
    if(e&&e.type==='FloatLiteral')fail(what+' must be a whole number, not '+e.value,e.loc);
    var v=_rgTryFold(e);
    if(v===null)fail(what+' must be a constant: int literals combined with + - * / % and parentheses',e&&e.loc);
    return v;
  }
  // structs
  var SM=new Map(),RM=new Map(),regions=[];
  body.forEach(function(n){if(n.type==='StructDecl')SM.set(n.name,{node:n,name:n.name,src:src(n),module:n.module||entry.name,path:n.path||entry.path,fields:null,size:0,align:1,state:0})});
  function elemDesc(t){var s=_rgScalar(t);return s?s:SM.has(t)?SM.get(t).src:String(t)}
  function elemOf(t,loc,what){
    var s=_rgScalar(t);
    if(s)return{scalar:s,size:_RG_SCALAR[s].size,align:_RG_SCALAR[s].size};
    if(t==='str'||t==='js'||t==='arr'||t==='numarr')fail(what+' cannot be '+t+' — regions and structs hold plain numbers only. A '+t+' is a reference (into the string area, to a JS value or an Emit array) and the collector does not look inside regions, so what it refers to could be released while the region still points to it (not supported in this version — keep an index into an arr instead)',loc);
    if(t==='void')fail(what+' cannot be void — use i8 u8 i16 u16 i32 u32 int f32 num bool or a struct',loc);
    var st=SM.get(t);
    if(!st)fail('Unknown type "'+t+'" — use i8 u8 i16 u16 i32 u32 int f32 num bool or a struct name',loc);
    layout(st,loc);
    return{struct:st,size:st.size,align:st.align};
  }
  function layout(st,at){
    if(st.state===2)return;
    if(st.state===1)fail('struct '+st.src+' contains itself — a struct cannot hold itself by value',at||st.node.loc);
    st.state=1;
    var off=0,al=1,seen=new Set(),fs=[];
    if(!st.node.fields.length)fail('struct '+st.src+' has no fields',st.node.loc);
    st.node.fields.forEach(function(f){
      var fl=(f.typeRef&&f.typeRef.loc)||f.loc;
      if(seen.has(f.name))fail('Field "'+f.name+'" is declared twice in struct '+st.src,f.loc);
      seen.add(f.name);
      var e=elemOf(f.type,fl,'A struct field'),count=null;
      if(f.count){
        if(e.struct)fail('An array of structs inside a struct is not supported yet — keep the '+e.struct.src+'s in a region of their own',fl);
        count=fold(f.count,'The length of field '+f.name);
        if(count<1)fail('The length of field '+f.name+' must be at least 1',f.count.loc||fl);
      }
      off=Math.ceil(off/e.align)*e.align;
      fs.push({name:f.name,type:e.scalar||e.struct.name,struct:e.struct||null,offset:off,size:e.size,count:count});
      off+=e.size*(count||1);al=Math.max(al,e.align);
    });
    st.fields=fs;st.align=al;st.size=Math.ceil(off/al)*al;st.state=2;
    if(st.size>_RG_MAX_BYTES)fail('struct '+st.src+' is larger than 256 MB',st.node.loc);
  }
  SM.forEach(function(st){layout(st)});
  function flat(st,pre,base,out){
    st.fields.forEach(function(f){
      if(f.struct)flat(f.struct,pre+f.name+'.',base+f.offset,out);
      else{var o={name:pre+f.name,type:f.type,offset:base+f.offset,size:f.size};if(f.count)o.count=f.count;out.push(o)}
    });
    return out;
  }
  SM.forEach(function(st){st.flat=flat(st,'',0,[])});
  // regions: from 65536, 8-aligned, in declaration order; then the descriptor table; heapBase = next page
  var cur=65536,total=0;
  body.forEach(function(n){
    if(n.type!=='RegionDecl')return;
    var el=elemOf(n.elem,(n.elemRef&&n.elemRef.loc)||n.loc,'A region element');
    var len=fold(n.size,'The size of region '+src(n));
    if(len<1)fail('The size of region '+src(n)+' must be at least 1, but it is '+len,(n.size&&n.size.loc)||n.loc);
    var bytes=len*el.size;total+=bytes;
    if(total>_RG_MAX_BYTES)fail('Regions are limited to 256 MB in total — region '+src(n)+' ('+len+' × '+el.size+' bytes) goes over it',(n.size&&n.size.loc)||n.loc);
    var base=Math.ceil(cur/8)*8;
    var info={id:regions.length,name:n.name,src:src(n),module:n.module||entry.name,path:n.path||entry.path,elem:el.scalar||el.struct.name,esz:el.size,len:len,base:base,desc:0};
    cur=base+bytes;regions.push(info);RM.set(n.name,info);
  });
  var table=Math.ceil(cur/16)*16;
  regions.forEach(function(r,i){r.desc=table+i*16});
  var heapBase=regions.length?Math.ceil((table+regions.length*16)/65536)*65536:65536;
  // ── lowering ──
  var fns=new Map(),raw=new Set(),wid=0,memo=new Map(),scopes=[],ended=new Map();
  body.forEach(function(n){if(n.type==='FunctionDecl')fns.set(n.name,n);else if(n.type==='ImportDecl')raw.add(n.name)});
  function look(name){
    for(var i=scopes.length-1;i>=0;i--)if(scopes[i].has(name))return scopes[i].get(name);
    var r=RM.get(name);return r?{k:'static',info:r}:null;
  }
  function def(name,v){scopes[scopes.length-1].set(name,v)}
  function rootOf(e){while(e&&(e.type==='MemberExpr'||e.type==='IndexExpr'))e=e.object;return e&&e.type==='IdentifierExpr'?e:null}
  function rgLike(e){var r=rootOf(e);if(!r)return null;var v=look(r.name);return v&&v.k!=='local'?v:null}
  function isRoot(a){if(!a||a.type!=='IdentifierExpr')return false;var v=look(a.name);return!!v&&(v.k==='static'||v.k==='param')}
  function rootDesc(v){return v.k==='static'?{k:'static',id:v.info.id}:{k:'param',name:v.name}}
  function rootElem(v){return v.k==='static'?v.info.elem:v.elem}
  function rootLen(v){return v.k==='static'?v.info.len:null}
  function esz(t){var s=_rgScalar(t);return s?_RG_SCALAR[s].size:SM.get(t).size}
  function firstField(t){var st=SM.get(t);return st&&st.fields.length?st.fields[0].name:'x'}
  function notValue(v,e){
    if(v.k==='alias')fail('"'+e.name+'" stands for '+v.what+' inside its with block — it is not a value: use its fields ('+e.name+'.'+firstField(v.struct)+') or copy the whole element into another one (… = '+e.name+')',e.loc);
    var el=elemDesc(rootElem(v));
    fail('"'+e.name+'" is a region'+(v.k==='param'?' parameter':'')+' of '+el+' — a region is not a value: it cannot be stored in a variable, returned, compared or printed. Index it ('+e.name+'[i]), pass it to a function that takes "region '+el+'", or hand JavaScript a view of it: view('+e.name+')',e.loc);
  }
  function mk(o){o.type='RegionPlace';return o}
  function cp(p){return{type:'RegionPlace',rg:p.rg,wid:p.wid,idx:p.idx,cidx:p.cidx,subs:p.subs.slice(),off:p.off,vt:p.vt,esz:p.esz,loc:p.loc,what:p.what,path:p.path,arr:p.arr||null}}
  // An element / field / field-array place, or {root} (a bare region), {len}, {constLen}.
  function place(e){
    if(e.type==='IdentifierExpr'){
      var v=look(e.name);
      if(v.k==='alias')return mk({rg:v.rg,wid:v.wid,idx:null,cidx:null,subs:[],off:0,vt:v.struct,esz:0,loc:e.loc,what:e.name,path:v.path,arr:null});
      return{root:v,id:e};
    }
    var b,q;
    if(e.type==='IndexExpr'){
      b=place(e.object);
      if(b.root){
        var v2=b.root,idx=X(e.index),c=_rgTryFold(idx),len=rootLen(v2),nm=b.id.name;
        if(c!==null&&(c<0||(len!==null&&c>=len)))fail(nm+'['+c+']: index out of range (length '+(len===null?'only known when the program runs':len)+')',(e.index&&e.index.loc)||e.loc);
        return mk({rg:rootDesc(v2),wid:null,idx:idx,cidx:c,subs:[],off:0,vt:rootElem(v2),esz:esz(rootElem(v2)),loc:e.loc,what:nm+'['+(c===null?'…':c)+']',path:'',arr:null});
      }
      if(b.len||b.constLen!==undefined)fail('.length is a number — it cannot be indexed',e.loc);
      if(b.arr){
        var sidx=X(e.index),sc=_rgTryFold(sidx);
        if(sc!==null&&(sc<0||sc>=b.arr.count))fail(b.what+'['+sc+']: index out of range (length '+b.arr.count+')',(e.index&&e.index.loc)||e.loc);
        q=cp(b);q.subs.push({idx:sidx,cidx:sc,count:b.arr.count,stride:b.arr.stride,path:b.path,loc:(e.index&&e.index.loc)||e.loc});
        q.vt=b.arr.elem;q.arr=null;q.what=b.what+'['+(sc===null?'…':sc)+']';
        return q;
      }
      fail(b.what+' is '+(_rgScalar(b.vt)?'a '+b.vt:'a whole '+elemDesc(b.vt))+' — it cannot be indexed',e.loc);
    }
    if(e.type==='MemberExpr'){
      b=place(e.object);
      if(b.root){
        if(e.property==='length')return{len:b.root};
        fail(b.id.name+' is a region — .length is its only property; a field of an element is '+b.id.name+'[i].'+e.property,e.loc);
      }
      if(b.len||b.constLen!==undefined)fail('.length is a number — it has no .'+e.property,e.loc);
      if(b.arr){
        if(e.property==='length')return{constLen:b.arr.count};
        fail(b.what+' is an array of '+b.arr.count+' '+b.arr.elem+' — index it: '+b.what+'[0]',e.loc);
      }
      var st=SM.get(b.vt);
      if(!st)fail(b.what+' is a '+b.vt+' — it has no field "'+e.property+'"',e.loc);
      var f=null;for(var i=0;i<st.fields.length;i++)if(st.fields[i].name===e.property)f=st.fields[i];
      if(!f){var hn=_emitModClosest(e.property,st.fields.map(function(x){return x.name}));fail('struct '+st.src+' has no field "'+e.property+'"'+(hn?' — did you mean "'+hn+'"?':' — its fields: '+st.fields.map(function(x){return x.name}).join(', ')),e.loc)}
      q=cp(b);q.off=b.off+f.offset;q.what=b.what+'.'+f.name;q.path=b.path+'.'+f.name;q.vt=f.type;
      q.arr=f.count?{count:f.count,stride:f.size,elem:f.type}:null;
      return q;
    }
    fail('Expected a region element',e.loc);
  }
  function lit(n,loc){return new IntLiteral(String(n),loc)}
  function asValue(p,e){
    if(p.len){var v=p.len;return v.k==='static'?lit(v.info.len,e.loc):{type:'RegionLen',rg:rootDesc(v),loc:e.loc}}
    if(p.constLen!==undefined)return lit(p.constLen,e.loc);
    if(p.root)notValue(p.root,p.id);
    if(p.arr)fail(p.what+' is an array of '+p.arr.count+' '+p.arr.elem+' — index it: '+p.what+'[0]',e.loc);
    if(!_rgScalar(p.vt))fail(p.what+' is a whole '+elemDesc(p.vt)+' — use one of its fields ('+p.what+'.'+firstField(p.vt)+'), copy it into another element (… = '+p.what+') or name it for a block: with '+p.what+' as b { … }',e.loc);
    return p;
  }
  function X(e){
    if(!e||typeof e!=='object'||typeof e.type!=='string')return e;
    if(memo.has(e))return memo.get(e);
    if(e.type.indexOf('Region')===0)return e;
    var r=e;
    switch(e.type){
      case'IdentifierExpr':{var v=look(e.name);if(v&&v.k!=='local')notValue(v,e);if(!v&&ended.has(e.name))fail('"'+e.name+'" was the name of '+ended.get(e.name)+' in a with block that has ended — it only exists inside that block',e.loc);break}
      case'IndexExpr':case'MemberExpr':
        if(rgLike(e)){r=asValue(place(e),e);break}
        kids(e);break;
      case'AssignExpr':r=assign(e);break;
      case'CallExpr':r=call(e);break;
      case'NewExpr':e.callee=X(e.callee);e.args=e.args.map(jsArg);break;
      default:kids(e);
    }
    memo.set(e,r);
    return r;
  }
  function kids(e){
    for(var k in e){
      if(k==='loc')continue;
      var v=e[k];
      if(Array.isArray(v)){for(var i=0;i<v.length;i++)if(v[i]&&typeof v[i]==='object'&&typeof v[i].type==='string')v[i]=X(v[i])}
      else if(v&&typeof v==='object'&&typeof v.type==='string')e[k]=X(v);
    }
  }
  function assign(e){
    var t=e.target;
    if(t.type==='IdentifierExpr'){
      var lv=look(t.name);
      if(lv&&lv.k!=='local'){
        if(lv.k==='alias')fail('"'+t.name+'" stands for '+lv.what+' — it cannot be pointed at another element. To copy a whole element write '+lv.what+' = …',t.loc);
        fail('"'+t.name+'" is a region'+(lv.k==='param'?' parameter':'')+' — it cannot be assigned. To copy all elements of another region into it: copy(other, '+t.name+')',t.loc);
      }
      e.value=X(e.value);return e;
    }
    if(!rgLike(t)){e.target=X(t);e.value=X(e.value);return e}
    var p=place(t);
    if(p.root)notValue(p.root,p.id);
    if(p.len||p.constLen!==undefined)fail('The length of a region is fixed — it cannot be assigned',t.loc);
    if(p.arr)fail(p.what+' is an array of '+p.arr.count+' — assign one element: '+p.what+'[0] = …',t.loc);
    if(!_rgScalar(p.vt)){
      var sv=rgLike(e.value)?place(e.value):null;
      if(!sv||sv.root||sv.arr||sv.len||sv.constLen!==undefined||sv.vt!==p.vt)fail('A whole '+elemDesc(p.vt)+' can only be set from another '+elemDesc(p.vt)+' element (balls[j] = balls[i]) — otherwise set its fields one by one',(e.value&&e.value.loc)||e.loc);
      return{type:'RegionStore',target:p,value:sv,copy:true,size:SM.get(p.vt).size,loc:e.loc};
    }
    memo.set(t,p);
    var val=X(e.value);
    return{type:'RegionStore',target:p,value:val,copy:false,loc:e.loc};
  }
  function jsArg(a){
    if(isRoot(a)){var v=look(a.name);memo.set(a,a);return{type:'RegionOp',op:'view',rg:rootDesc(v),args:[],loc:a.loc,auto:true}}
    return X(a);
  }
  function call(e){
    var c=e.callee;
    if(c.type==='IdentifierExpr'){
      var lv=look(c.name);
      if(lv&&lv.k!=='local')fail('"'+c.name+'" is '+(lv.k==='alias'?'an element alias':'a region')+', not a function',c.loc);
      if(!lv){
        if(_RG_OPS[c.name]&&!fns.has(c.name)&&!raw.has(c.name)&&e.args.length&&(isRoot(e.args[0])||rgLike(e.args[0])))return op(e);
        if(c.name==='fnRef'&&e.args[0]){
          var a0=e.args[0],rn=a0.type==='IdentifierExpr'?a0.name:a0.type==='StringLiteral'?a0.value:null,rf=rn&&fns.get(rn);
          if(rf&&rf.params.some(function(p){return _rgParamElem(p.type)}))fail('fnRef('+(rf.modName||rn)+') — this function takes a region parameter, and JavaScript cannot pass a region, so it cannot be a callback',a0.loc||e.loc);
        }
        var fd=fns.get(c.name);
        if(fd){
          fd.params.forEach(function(p,i){if(_rgParamElem(p.type)&&i>=e.args.length)fail(src(fd)+'() needs a region as argument '+(i+1)+' ('+p.name+')',e.loc)});
          e.args=e.args.map(function(a,i){var pt=fd.params[i]&&_rgParamElem(fd.params[i].type);return pt?rgArg(a,pt,fd,i,e):X(a)});
          return e;
        }
        if(BUILTINS[c.name]||raw.has(c.name)){e.args=e.args.map(X);return e}
        e.args=e.args.map(jsArg); /* a JS global function: a region argument arrives as a view (typed array) */
        return e;
      }
      e.args=e.args.map(jsArg);
      return e;
    }
    if(c.type==='MemberExpr'&&rgLike(c.object))fail('A region has no methods — use fill(r, v), wipe(r), copy(a, b), swap(a, b), freeze(r), thaw(r), frozen(r), view(r)',c.loc||e.loc);
    e.callee=X(c);e.args=e.args.map(jsArg);
    return e;
  }
  function rgArg(a,pt,fd,i,e){
    if(!isRoot(a)){
      var lv=a&&a.type==='IdentifierExpr'&&look(a.name);
      if(lv&&lv.k==='alias')fail('"'+a.name+'" is one element ('+lv.what+'), not a region — '+src(fd)+'() takes a whole region',a.loc);
      fail(src(fd)+'() takes a region of '+elemDesc(pt)+' as argument '+(i+1)+' ('+fd.params[i].name+') — pass the name of a region',(a&&a.loc)||e.loc);
    }
    var v=look(a.name),el=rootElem(v);
    if(el!==pt)fail(src(fd)+'() takes a region of '+elemDesc(pt)+', but '+a.name+' holds '+elemDesc(el),a.loc);
    memo.set(a,a);
    return{type:'RegionArg',rg:rootDesc(v),ptype:'region<'+pt+'>',loc:a.loc};
  }
  function op(e){
    var nm=e.callee.name,a=e.args,L=e.loc;
    if(!isRoot(a[0])){
      var lv=a[0].type==='IdentifierExpr'&&look(a[0].name);
      fail(nm+'() takes a whole region'+(lv&&lv.k==='alias'?', but "'+a[0].name+'" is one element ('+lv.what+')':' — pass its name: '+nm+'(grid'+(nm==='fill'?', 0':'')+')'),a[0].loc||L);
    }
    var v=look(a[0].name),el=rootElem(v),sc=_rgScalar(el),r0=a[0].name;
    function argc(n,m,usage){if(a.length<n||a.length>m)fail(nm+' takes '+usage,L)}
    var node={type:'RegionOp',op:nm,rg:rootDesc(v),args:[],loc:L,name:r0};
    memo.set(a[0],a[0]);
    switch(nm){
      case'fill':
        argc(2,2,'a region and a value: fill('+r0+', 0)');
        if(!sc)fail('fill sets every element to one number, but '+r0+' holds '+elemDesc(el)+' structs — use wipe('+r0+') to zero it',L);
        node.elem=sc;node.args=[X(a[1])];break;
      case'wipe':case'freeze':case'thaw':case'frozen':case'view':
        argc(1,1,'one region: '+nm+'('+r0+')');break;
      case'copy':case'swap':{
        argc(2,2,'two regions: '+nm+'(a, b)'+(nm==='copy'?' — copies a into b':''));
        if(!isRoot(a[1]))fail(nm+' needs two regions, but its second argument is not a region',a[1].loc||L);
        var w=look(a[1].name),el2=rootElem(w);
        memo.set(a[1],a[1]);
        if(el!==el2)fail(nm+'('+r0+', '+a[1].name+'): '+r0+' holds '+elemDesc(el)+' but '+a[1].name+' holds '+elemDesc(el2)+' — both regions need the same element type',L);
        var l1=rootLen(v),l2=rootLen(w);
        if(l1!==null&&l2!==null&&l1!==l2)fail(nm+'('+r0+', '+a[1].name+'): the regions differ in length ('+l1+' and '+l2+')',L);
        node.rg2=rootDesc(w);break;
      }
      case'screen':{
        argc(3,4,'a u8 region, a width and a height (and optionally a scale): screen('+r0+', 320, 200)');
        if(el!=='u8')fail('screen needs a u8 region (4 bytes per pixel: red, green, blue, alpha), but '+r0+' holds '+elemDesc(el),a[0].loc||L);
        node.args=a.slice(1).map(X);
        var w0=_rgTryFold(node.args[0]),h0=_rgTryFold(node.args[1]),len=rootLen(v),s0=node.args[2]?_rgTryFold(node.args[2]):1;
        if((w0!==null&&w0<1)||(h0!==null&&h0<1)||(s0!==null&&s0<1))fail('screen: width, height and scale must be at least 1',L);
        if(w0!==null&&h0!==null&&len!==null&&len<w0*h0*4)fail('screen('+r0+', '+w0+', '+h0+') needs '+(w0*h0*4)+' bytes (width × height × 4), but '+r0+' has '+len,L);
        break;
      }
    }
    return node;
  }
  function S(n){
    if(!n)return;
    switch(n.type){
      case'VarDecl':
        if(_rgParamElem(n.varType))fail('A variable cannot hold a region — a region is not a value. Use it by name, or take it as a parameter: fn f(r: region '+_rgParamElem(n.varType)+')',n.loc);
        n.init=X(n.init);def(n.name,{k:'local'});return;
      case'BlockStmt':scopes.push(new Map());for(var i=0;i<n.statements.length;i++)S(n.statements[i]);scopes.pop();return;
      case'ForStmt':scopes.push(new Map());S(n.init);n.condition=X(n.condition);n.update=X(n.update);S(n.body);scopes.pop();return;
      case'IfStmt':n.condition=X(n.condition);S(n.consequent);S(n.alternate);return;
      case'WhileStmt':n.condition=X(n.condition);S(n.body);return;
      case'ReturnStmt':n.value=X(n.value);return;
      case'ExprStmt':n.expression=X(n.expression);return;
      case'ThrowStmt':n.value=X(n.value);return;
      case'TryStmt':S(n.body);S(n.handler);S(n.finalizer);return;
      case'WithStmt':{
        if(!rgLike(n.target))fail('with needs one element of a struct region — with balls[i] as b { … }',(n.target&&n.target.loc)||n.loc);
        var p=place(n.target);
        if(p.root||p.len||p.constLen!==undefined||p.arr||_rgScalar(p.vt))fail('with … as needs one struct element (with balls[i] as b { … })'+(p.what?', but '+p.what+' is '+(p.arr?'an array':'a '+p.vt):''),(n.target&&n.target.loc)||n.loc);
        n.target=p;n.wid=wid++;
        scopes.push(new Map());
        def(n.alias,{k:'alias',wid:n.wid,rg:p.rg,struct:p.vt,what:p.what,path:p.path});
        S(n.body);
        scopes.pop();
        ended.set(n.alias,p.what);
        return;
      }
    }
  }
  body.forEach(function(n){
    if(n.type==='FunctionDecl'){
      scopes=[new Map()];ended=new Map();
      if(_rgParamElem(n.returnType))fail('A function cannot return a region — a region is not a value (it stays where it is declared)',n.loc);
      var hasR=false;
      n.params.forEach(function(p){
        var el=_rgParamElem(p.type);
        if(!el){def(p.name,{k:'local'});return}
        hasR=true;
        var nel=_rgScalar(el)||el;
        if(!_rgScalar(el)&&!SM.has(el))fail('Unknown element type "'+el+'" in region parameter '+p.name+' — i8 u8 i16 u16 i32 u32 int f32 num bool or a struct name',p.loc||n.loc);
        p.type='region<'+nel+'>';
        def(p.name,{k:'param',name:p.name,elem:nel});
      });
      if(hasR&&n.exported)fail('export fn '+src(n)+' takes a region parameter — JavaScript cannot pass a region. Use the region by name inside the function instead',n.loc);
      S(n.body);
    }else if(n.type==='VarDecl'){
      if(_rgParamElem(n.varType))fail('A variable cannot hold a region — a region is not a value',n.loc);
      scopes=[new Map()];n.init=X(n.init);
    }
  });
  ast.rgInfo={entry:entry,regions:regions,heapBase:heapBase,table:table,
    structs:Array.from(SM.values()).map(function(s){return{name:s.name,src:s.src,module:s.module,path:s.path,size:s.size,align:s.align,flat:s.flat}})};
}
// The static description of the regions / structs (compile result r.regions / r.structs, and the metadata).
function _rgDescribe(I){
  var st={};(I.structs||[]).forEach(function(s){st[s.name]=s});
  function copyF(fs){return fs.map(function(f){var o={name:f.name,type:st[f.type]?st[f.type].src:f.type,offset:f.offset,size:f.size};if(f.count)o.count=f.count;return o})}
  return{
    regions:I.regions.map(function(r){return{id:r.id,name:r.src,module:r.module,path:r.path,base:r.base,length:r.len,elemSize:r.esz,elem:st[r.elem]?{struct:st[r.elem].src,fields:copyF(st[r.elem].flat)}:r.elem}}),
    structs:(I.structs||[]).map(function(s){return{name:s.src,module:s.module,path:s.path,size:s.size,align:s.align,fields:copyF(s.flat)}})
  };
}
// Rewrites the finished module: initial memory = heapBase / 65536 pages; the descriptor table as a data segment.
function _rgPatchModule(b,I){
  var p=8,secs=[];
  function leb(){var r=0,s=0,c;do{c=b[p++];r+=(c&0x7F)*Math.pow(2,s);s+=7}while(c&0x80);return r}
  while(p<b.length){var at=p,id=b[p++],size=leb(),start=p;secs.push({id:id,start:start,end:start+size});p=start+size}
  var data=[];
  function u32(v){data.push(v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255)}
  I.regions.forEach(function(r){u32(r.base);u32(r.len);u32(0);u32(r.id)});
  var seg=[0x00,Op.i32_const].concat(ei32(I.table),[Op.end],eu32(data.length),data);
  var parts=[b.subarray(0,8)],hasData=false;
  function sec(id,bytes){parts.push(new Uint8Array([id].concat(eu32(bytes.length))));parts.push(bytes instanceof Uint8Array?bytes:new Uint8Array(bytes))}
  secs.forEach(function(s){
    var body=b.subarray(s.start,s.end);
    if(s.id===5)body=new Uint8Array([1,body[1]].concat(eu32(I.heapBase/65536)));
    else if(s.id===11){
      hasData=true;p=s.start;var n=leb(),rest=b.subarray(p,s.end),head=eu32(n+1),nb=new Uint8Array(head.length+rest.length+seg.length);
      nb.set(head,0);nb.set(rest,head.length);nb.set(seg,head.length+rest.length);body=nb;
    }
    sec(s.id,body);
  });
  if(!hasData)sec(11,[1].concat(seg));
  var len=0;parts.forEach(function(x){len+=x.length});
  var out=new Uint8Array(len),o=0;parts.forEach(function(x){out.set(x,o);o+=x.length});
  return out;
}
// ── types (annotator / checker) ──
(function(){
  var P=TypeAnnotator.prototype,a0=P.a,walk0=P.walk;
  function kindOf(t){var s=_rgScalar(t);return s?_RG_SCALAR[s].kind:'void'}
  P.rgIdx=function(x,what){
    var t=this.a(x);
    if(t==='js')this.conv(x,'int');
    else if(!this.isI(t))this.fail((what||'An index')+' must be an int, but this is '+t,x.loc);
  };
  function an(t){return(/^[aeiou]/.test(t)?'an ':'a ')+t}
  P.rgVal=function(v,kind,what){
    var t=this.a(v);
    if(t==='void')this.fail('This returns nothing — there is no value to store',v.loc);
    if(kind==='int'){
      if(t==='js')this.conv(v,'int');
      else if(!this.isI(t))this.fail('Cannot store '+an(t)+' in '+what+' — it holds whole numbers'+(this.isN(t)||t==='f32'?': round the value first, e.g. floor(x) or round(x)':''),v.loc);
    }else if(kind==='num'){
      if(t==='js')this.conv(v,'num');
      else if(!(this.isI(t)||this.isN(t)||t==='f32'))this.fail('Cannot store '+an(t)+' in '+what+' — it holds numbers',v.loc);
    }else if(kind==='bool'){
      if(t==='js')this.conv(v,'bool');
      else if(t!=='bool')this.fail('Cannot store '+an(t)+' in '+what+' — it holds true / false (write a comparison, e.g. x > 0)',v.loc);
    }
  };
  P.a=function(e){
    if(!e||typeof e.type!=='string'||e.type.indexOf('Region')!==0)return a0.call(this,e);
    if(e.jsConv)delete e.jsConv;
    var t='int',self=this;
    switch(e.type){
      case'RegionPlace':
        if(e.idx)this.rgIdx(e.idx);
        e.subs.forEach(function(s){self.rgIdx(s.idx)});
        this.need('__regionFail');
        t=kindOf(e.vt);break;
      case'RegionStore':
        this.a(e.target);this.need('__regionFail');
        if(e.copy)this.a(e.value);else this.rgVal(e.value,kindOf(e.target.vt),e.target.what+' ('+_rgScalar(e.target.vt)+')');
        t='void';break;
      case'RegionOp':
        switch(e.op){
          case'fill':this.rgVal(e.args[0],_RG_SCALAR[e.elem].kind,e.name+' ('+e.elem+')');this.need('__regionOp');t='void';break;
          case'wipe':case'copy':case'swap':this.need('__regionOp');t='void';break;
          case'freeze':case'thaw':t='void';break;
          case'frozen':t='bool';break;
          case'view':this.need('__regionView');t='js';break;
          case'screen':e.args.forEach(function(x,i){self.rgIdx(x,'The '+['width','height','scale'][i]+' of a screen')});this.need('__regionScreen');t='void';break;
        }
        break;
      case'RegionArg':t=e.ptype;break;
      case'RegionLen':t='int';break;
    }
    e.exprType=t;
    return t;
  };
  P.walk=function(n){
    if(n&&n.type==='WithStmt'){this.a(n.target);this.need('__regionFail');this.push();this.walk(n.body);this.pop();return}
    return walk0.call(this,n);
  };
  var C=TypeChecker.prototype,inf0=C.inf,cn0=C.cn;
  C.inf=function(e){
    if(e&&typeof e.type==='string'&&e.type.indexOf('Region')===0){
      var self=this;
      if(e.idx)this.inf(e.idx);
      if(e.subs)e.subs.forEach(function(s){self.inf(s.idx)});
      if(e.type==='RegionStore'){this.inf(e.target);this.inf(e.value)}
      if(e.args)e.args.forEach(function(x){self.inf(x)});
      return e.exprType;
    }
    return inf0.call(this,e);
  };
  C.cn=function(n){
    if(n&&n.type==='WithStmt'){this.inf(n.target);this.push();this.cn(n.body);this.pop();return}
    return cn0.call(this,n);
  };
})();
// ── code generation ──
(function(){
  var P=WasmCodegen.prototype,nat0=P.genNatural,stmt0=P.genStmt,res0=P.exprResType,gen0=P.generate,enc0=P.encodeBinary;
  // [opcode, alignment] — loads widen into i64 / f64 / i32 (bool); stores take i64 / f32 / f64 / i32
  var LD={i8:[0x30,0],u8:[0x31,0],i16:[0x32,1],u16:[0x33,1],i32:[0x34,2],u32:[0x35,2],int:[0x29,3],f32:[0x2A,2],num:[0x2B,3],bool:[0x2D,0]};
  var ST={i8:[0x3C,0],u8:[0x3C,0],i16:[0x3D,1],u16:[0x3D,1],i32:[0x3E,2],u32:[0x3E,2],int:[0x37,3],f32:[0x38,2],num:[0x39,3],bool:[0x3A,0]};
  var I64_GE_U=0x5A,F64_PROMOTE=0xBB,F32_DEMOTE=0xB6;
  // window.__emitRegionNoElide = true: also check constant indexes (to measure what the elision saves)
  function noElide(){try{return typeof window!=='undefined'&&!!window.__emitRegionNoElide}catch(e){return false}}
  // window.__emitRegionNoChecks = true: compile WITHOUT dynamic bounds checks — a benchmark knob only (it measures
  // what the checks cost); never set by the IDE
  function noChecks(){try{return typeof window!=='undefined'&&!!window.__emitRegionNoChecks}catch(e){return false}}
  P._rgI=function(){return this.ast.rgInfo};
  P._rgPos=function(loc,extra){
    var I=this._rgI(),at=((loc&&loc.file)||I.entry.path)+':'+((loc&&loc.line)||1)+':'+((loc&&loc.col)||1),key=at+'|'+(extra?JSON.stringify(extra):'');
    if(this._rgPosMap.has(key))return this._rgPosMap.get(key);
    var i=this._rgPosTab.length;this._rgPosTab.push(extra?[at,extra]:[at]);this._rgPosMap.set(key,i);
    return i;
  };
  P._rgDesc=function(rg){
    if(rg.k==='static')this.emit(Op.i32_const,...ei32(this._rgI().regions[rg.id].desc));
    else this.emit(Op.local_get,...eu32(this.getLocal(rg.name)));
  };
  P._rgTmp=function(k,d){var n='_rg'+k+'$'+d,i=this.getLocal(n);return i>=0?i:this.addLocal(n,k==='i'?'int':'i32')};
  P._rgFail=function(code,rg,local,pos){
    this.emit(Op.i32_const,...ei32(code));
    this._rgDesc(rg);
    if(local>=0)this.emit(Op.local_get,...eu32(local));else this.emit(Op.i64_const,...ei64(0));
    this.emit(Op.i32_const,...ei32(pos));
    this.jsImportCall('__regionFail');
    this.genAfterThrow();
  };
  // index (i64) → checked against the length lenFn pushes (i64) → i32 byte offset index * stride
  P._rgCheck=function(idx,lenFn,code,rg,pos,stride){
    if(noChecks()){this.genExpr(idx,'int');this.emit(Op.i32_wrap_i64);if(stride!==1){this.emit(Op.i32_const,...ei32(stride));this.emit(Op.i32_mul)}return}
    var t=this._rgTmp('i',this._rgDepth);
    this.genExpr(idx,'int');
    this.emit(Op.local_tee,...eu32(t));
    lenFn.call(this);
    this.emit(I64_GE_U);
    this.emit(Op.if,0x40);this._rgFail(code,rg,t,pos);this.emit(Op.end);
    this.emit(Op.local_get,...eu32(t));this.emit(Op.i32_wrap_i64);
    if(stride!==1){this.emit(Op.i32_const,...ei32(stride));this.emit(Op.i32_mul)}
  };
  // Pushes the i32 address of a place without its constant part, which is returned (for the memarg offset).
  P._rgAddr=function(p){
    var I=this._rgI(),d=this._rgDepth=(this._rgDepth||0)+1,off=p.off,rg=p.rg,ne=noElide(),self=this;
    try{
      if(p.wid!==null&&p.wid!==undefined)this.emit(Op.local_get,...eu32(this._rgWith[p.wid]));
      else if(rg.k==='static'){
        var R=I.regions[rg.id];
        if(p.cidx!==null&&!ne)this.emit(Op.i32_const,...ei32(R.base+p.cidx*R.esz));
        else{
          this._rgCheck(p.idx,function(){this.emit(Op.i64_const,...ei64(R.len))},1,rg,this._rgPos(p.loc),R.esz);
          this.emit(Op.i32_const,...ei32(R.base));this.emit(Op.i32_add);
        }
      }else{
        var L=this.getLocal(rg.name);
        this._rgCheck(p.idx,function(){this.emit(Op.local_get,...eu32(L));this.emit(Op.i32_load,2,...eu32(4));this.emit(Op.i64_extend_i32_u)},1,rg,this._rgPos(p.loc),p.esz);
        this.emit(Op.local_get,...eu32(L));this.emit(Op.i32_load,2,...eu32(0));this.emit(Op.i32_add);
      }
      p.subs.forEach(function(s){
        if(s.cidx!==null&&!ne){off+=s.cidx*s.stride;return}
        self._rgCheck(s.idx,function(){this.emit(Op.i64_const,...ei64(s.count))},4,rg,self._rgPos(s.loc,{f:s.path,n:s.count}),s.stride);
        self.emit(Op.i32_add);
      });
      return off;
    }finally{this._rgDepth=d-1}
  };
  P._rgFrozen=function(rg,pos){
    this._rgDesc(rg);this.emit(0x2D,0,...eu32(8));
    this.emit(Op.if,0x40);this._rgFail(2,rg,-1,pos);this.emit(Op.end);
  };
  // natural type (int: i64, num: f64, bool: i32) → the type the consumer asked for
  P._rgCoerce=function(nat,exp){
    var e=exp==='i64'?'int':exp==='f64'?'num':exp;
    if(!e||e===nat)return;
    if(nat==='int'){if(e==='num')this.emit(0xB9);else if(e==='bool'){this.emit(Op.i64_const,...ei64(0));this.emit(Op.i64_ne)}else if(e==='i32')this.emit(Op.i32_wrap_i64);else if(e==='f32')this.emit(0xB4)}
    else if(nat==='num'){if(e==='int'||e==='js')this.emit(0xFC,6);else if(e==='bool'){this.emit(Op.f64_const,...ef64(0));this.emit(Op.f64_ne)}else if(e==='f32')this.emit(F32_DEMOTE)}
    else if(nat==='bool'){if(e==='int'||e==='js')this.emit(Op.i64_extend_i32_u);else if(e==='num')this.emit(0xB8)}
  };
  P._rgLoad=function(p,exp){
    var c=this._rgCache,off;
    if(c&&c.node===p){this.emit(Op.local_get,...eu32(c.local));off=c.off}
    else off=this._rgAddr(p);
    var vt=_rgScalar(p.vt),o=LD[vt];
    this.emit(o[0],o[1],...eu32(off));
    if(vt==='f32')this.emit(F64_PROMOTE);
    if(vt==='bool'){this.emit(Op.i32_const,...ei32(0));this.emit(Op.i32_ne)}
    this._rgCoerce(_RG_SCALAR[vt].kind,exp);
  };
  P._rgStore=function(e){
    var p=e.target,pos=this._rgPos(e.loc||p.loc),off;
    if(e.copy){
      off=this._rgAddr(p);if(off){this.emit(Op.i32_const,...ei32(off));this.emit(Op.i32_add)}
      this._rgFrozen(p.rg,pos);
      off=this._rgAddr(e.value);if(off){this.emit(Op.i32_const,...ei32(off));this.emit(Op.i32_add)}
      this.emit(Op.i32_const,...ei32(e.size));
      this.emit(0xFC,10,0,0); /* memory.copy */
      return;
    }
    off=this._rgAddr(p);
    this._rgFrozen(p.rg,pos);
    var vt=_rgScalar(p.vt),kind=_RG_SCALAR[vt].kind,v=e.value;
    if(v&&v.type==='BinaryExpr'&&(v.left===p||v.right===p)){
      /* x op= y / x++: the address is computed (and checked) once */
      var a=this._rgTmp('a',0),saved=this._rgCache;
      this.emit(Op.local_tee,...eu32(a));
      this._rgCache={node:p,local:a,off:off};
      try{this.genExpr(v,kind)}finally{this._rgCache=saved}
    }else this.genExpr(v,kind);
    if(vt==='f32')this.emit(F32_DEMOTE);
    var o=ST[vt];
    this.emit(o[0],o[1],...eu32(off));
  };
  P._rgOp=function(e,exp){
    var pos=this._rgPos(e.loc);
    switch(e.op){
      case'freeze':case'thaw':this._rgDesc(e.rg);this.emit(Op.i32_const,...ei32(e.op==='freeze'?1:0));this.emit(Op.i32_store8,0,...eu32(8));return;
      case'frozen':this._rgDesc(e.rg);this.emit(0x2D,0,...eu32(8));this._rgCoerce('bool',exp);return;
      case'view':this._rgDesc(e.rg);this.jsImportCall('__regionView');return;
      case'screen':
        this._rgDesc(e.rg);
        this.genExpr(e.args[0],'int');this.genExpr(e.args[1],'int');
        if(e.args[2])this.genExpr(e.args[2],'int');else this.emit(Op.i64_const,...ei64(1));
        this.emit(Op.i32_const,...ei32(pos));
        this.jsImportCall('__regionScreen');
        break;
      default:{
        this.emit(Op.i32_const,...ei32({fill:1,wipe:2,copy:3,swap:4}[e.op]));
        this._rgDesc(e.rg);
        if(e.rg2)this._rgDesc(e.rg2);else this.emit(Op.i32_const,...ei32(0));
        var k=e.op==='fill'?_RG_SCALAR[e.elem].kind:null;
        if(k==='int')this.genExpr(e.args[0],'int');
        else if(k==='bool'){this.genExpr(e.args[0],'bool');this.emit(Op.i64_extend_i32_u)}
        else this.emit(Op.i64_const,...ei64(0));
        if(k==='num')this.genExpr(e.args[0],'num');else this.emit(Op.f64_const,...ef64(0));
        this.emit(Op.i32_const,...ei32(pos));
        this.jsImportCall('__regionOp');
      }
    }
    this.emit(Op.if,0x40);this.genAfterThrow();this.emit(Op.end);
  };
  P.genNatural=function(e,exp){
    switch(e.type){
      case'RegionPlace':return this._rgLoad(e,exp);
      case'RegionStore':return this._rgStore(e);
      case'RegionOp':return this._rgOp(e,exp);
      case'RegionArg':return this._rgDesc(e.rg);
      case'RegionLen':
        this._rgDesc(e.rg);this.emit(Op.i32_load,2,...eu32(4));this.emit(Op.i64_extend_i32_u);
        this._rgCoerce('int',exp);return;
    }
    return nat0.call(this,e,exp);
  };
  P.genStmt=function(s){
    if(s.type==='WithStmt'){
      var off=this._rgAddr(s.target);
      if(off){this.emit(Op.i32_const,...ei32(off));this.emit(Op.i32_add)}
      var li=this.addLocal('_with$'+s.wid+'$'+this.currentLocals.length,'i32');
      this.emit(Op.local_set,...eu32(li));
      this._rgWith[s.wid]=li;
      this.genBlock(s.body);
      return;
    }
    return stmt0.call(this,s);
  };
  P.exprResType=function(e){
    if(e.type==='RegionStore')return'void';
    if(e.type==='RegionOp'&&e.op!=='frozen'&&e.op!=='view')return'void';
    return res0.call(this,e);
  };
  P.generate=function(){
    this._rgPosTab=[];this._rgPosMap=new Map();this._rgWith={};this._rgDepth=0;this._rgCache=null;
    var I=this.ast.rgInfo;
    if(I&&I.regions.length&&this.target==='wasm64')throw new Error('Memory regions need the wasm32 target');
    var w=gen0.apply(this,arguments);
    if(I&&I.regions.length){
      var D=_rgDescribe(I);
      this.imports.heapBase=I.heapBase;
      this.imports.regionMeta=JSON.stringify({v:1,heapBase:I.heapBase,table:I.table,pos:this._rgPosTab,
        regions:D.regions.map(function(r,i){r.desc=I.regions[i].desc;return r}),structs:D.structs});
    }
    return w;
  };
  P.encodeBinary=function(){
    var b=enc0.apply(this,arguments),I=this.ast&&this.ast.rgInfo;
    return(I&&I.regions.length)?_rgPatchModule(b,I):b;
  };
})();
// The compile result: r.regions (id, name, module, path, base, length, elemSize, elem) and r.structs.
compile=(function(c){return function(source,target){
  var r=c.apply(this,arguments),I=r&&r.ast&&r.ast.rgInfo,D=I?_rgDescribe(I):{regions:[],structs:[]};
  r.regions=D.regions;r.structs=D.structs;
  return r;
}})(compile);

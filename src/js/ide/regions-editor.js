// ── Editor: highlighting and autocomplete for structs and regions ──
['struct','region'].forEach(function(n){_emitKw.add(n)});
['i8','u8','i16','u16','u32'].forEach(function(n){_emitTy.add(n)});
var _MEM_BLT=[
  ['fill','fill(r: region, v)','every element = v'],['wipe','wipe(r: region)','every byte = 0'],
  ['copy','copy(src: region, dst: region)','src into dst'],['swap','swap(a: region, b: region)','exchange contents'],
  ['freeze','freeze(r: region)','writes stop with an error'],['thaw','thaw(r: region)','writable again'],
  ['frozen','frozen(r: region) bool','is it frozen?'],['view','view(r: region) js','typed array, no copy'],
  ['screen','screen(fb: region u8, w: int, h: int, scale: int)','RGBA pixels on a canvas']];
_MEM_BLT.forEach(function(b){
  _emitBlt.add(b[0]);
  if(!_allBuiltins.some(function(x){return x.name===b[0]}))_allBuiltins.push({name:b[0],sig:b[1],desc:b[2]});
});
var _MEM_ELEMS=[['u8','0 … 255'],['i8','-128 … 127'],['u16','0 … 65535'],['i16','16-bit'],['u32','32-bit unsigned'],['i32','32-bit'],['int','64-bit'],['f32','32-bit float'],['num','64-bit float'],['bool','true / false']];
// structs and regions declared in a source text (used when the module index has none, e.g. while a file does not parse)
function _memScan(src){
  var code=String(src||'').replace(/"(?:[^"\\\n]|\\.)*"/g,'""').replace(/\/\/[^\n]*/g,''),structs=[],regions=[],m;
  var sre=/(^|\n)[ \t]*(public[ \t]+)?struct[ \t]+([A-Za-z_]\w*)[ \t]*\{([^{}]*)/g;
  while((m=sre.exec(code))){
    var fs=[];m[4].split(/[,\n]/).forEach(function(p){var q=/^\s*([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*(?:\s*\[[^\]]*\])?)\s*\}?\s*$/.exec(p);if(q)fs.push({name:q[1],type:q[2].replace(/\s+/g,'')})});
    structs.push({name:m[3],public:!!m[2],fields:fs});
  }
  var rre=/(^|\n)[ \t]*(public[ \t]+)?region[ \t]+([A-Za-z_]\w*)[ \t]*:[ \t]*([A-Za-z_]\w*)[ \t]*\[([^\]\n]*)\]/g;
  while((m=rre.exec(code)))regions.push({name:m[3],public:!!m[2],elem:m[4],length:m[5].trim()});
  return{structs:structs,regions:regions};
}
function _memModSrc(idx,name){
  var mod=idx.modules[name];if(!mod)return'';
  var a=_proj.files[_proj.active];if(a&&a.path===mod.path)return ed.value;
  var i=_projFind(mod.path);return i>=0?_proj.files[i].source:'';
}
// {structs, regions} of module `name`: the index's lists, completed by a scan of its source
function _memModDecls(idx,name){
  var mod=idx.modules[name]||{},sc=_memScan(_memModSrc(idx,name));
  function merge(a,b){var out=Array.isArray(a)?a.filter(function(x){return x&&x.name}).slice():[],seen={};out.forEach(function(x){seen[x.name]=1});b.forEach(function(x){if(!seen[x.name])out.push(x)});return out}
  return{structs:merge(mod.structs,sc.structs),regions:merge(mod.regions,sc.regions)};
}
// What the active file can name: its own structs/regions, imported public ones, and import aliases
function _memScope(){
  var idx=_projIndex(),cur=_projCurModule(idx),curName=null,k;
  for(k in idx.modules)if(idx.modules[k]===cur)curName=k;
  var regions={},structs={},quals={};
  var own=curName?_memModDecls(idx,curName):_memScan(ed.value);
  own.regions.forEach(function(r){regions[r.name]={r:r,mod:curName}});
  own.structs.forEach(function(s){structs[s.name]={s:s,mod:curName}});
  ((cur&&cur.imports)||[]).forEach(function(im){
    if(!im||!im.module||!idx.modules[im.module])return;
    var d=_memModDecls(idx,im.module);
    if(im.star||(im.names&&im.names.length)){
      d.regions.forEach(function(r){if(r.public&&(im.star||im.names.indexOf(r.name)>=0)&&!regions[r.name])regions[r.name]={r:r,mod:im.module}});
      d.structs.forEach(function(s){if(s.public&&(im.star||im.names.indexOf(s.name)>=0)&&!structs[s.name])structs[s.name]={s:s,mod:im.module}});
      return;
    }
    quals[im.alias||im.module.substring(im.module.lastIndexOf('.')+1)]=im.module;
  });
  return{idx:idx,cur:curName,regions:regions,structs:structs,quals:quals};
}
function _memFindStruct(sc,name,mod){
  var r=_memFindStruct0(sc,name,mod);if(r||!name)return r;
  var k=String(name).toLowerCase(),n;
  if(mod){var d=_memModDecls(sc.idx,mod);for(var i=0;i<d.structs.length;i++)if(d.structs[i].name.toLowerCase()===k)return d.structs[i]}
  for(n in sc.structs)if(n.toLowerCase()===k)return sc.structs[n].s;
  for(n in sc.idx.modules){var e=_memModDecls(sc.idx,n);for(var j=0;j<e.structs.length;j++)if(e.structs[j].name.toLowerCase()===k)return e.structs[j]}
  return null;
}
function _memFindStruct0(sc,name,mod){
  if(mod){var d=_memModDecls(sc.idx,mod);for(var i=0;i<d.structs.length;i++)if(d.structs[i].name===name)return d.structs[i]}
  if(sc.structs[name])return sc.structs[name].s;
  for(var k in sc.idx.modules){var e=_memModDecls(sc.idx,k);for(var j=0;j<e.structs.length;j++)if(e.structs[j].name===name)return e.structs[j]}
  return null;
}
// region `name`, or `alias.name` through an import alias -> {r, mod}
function _memRegionRef(sc,alias,name){
  if(!alias)return sc.regions[name]||_ncGet(sc.regions,name)||null;
  var mod=_ncGet(sc.quals,alias);if(!mod)return null;
  var d=_memModDecls(sc.idx,mod);
  for(var i=0;i<d.regions.length;i++)if(d.regions[i].name.toLowerCase()===String(name).toLowerCase()&&d.regions[i].public)return{r:d.regions[i],mod:mod};
  return null;
}
function _memItem(name,desc,ins){return{name:escH(name),desc:escH(desc),_libac:'member',_projac:true,_ins:ins==null?name:ins}}
// names that start with exactly what was typed come first, then the case-insensitive matches
function _memRank(list,typed){var a=[],b=[];list.forEach(function(x){(x[0].indexOf(typed)===0?a:b).push(x[1])});return a.concat(b)}
function _memShowItems(items,before,key){_builtinAC=false;_methodAC=false;if(!items.length){hideAC();return}_libACShow(items,before,key)}
// Runs first in checkAC. Returns true when it handled the position.
// Cheap gate: no `region` / `struct` anywhere in the project -> no index work at all
function _memAny(){
  var re=/\b(region|struct)\b/i;if(re.test(ed.value))return true;
  for(var i=0;i<_proj.files.length;i++)if(i!==_proj.active&&re.test(_proj.files[i].source))return true;
  return false;
}
function _memACCheck(before){
  try{
    if(!_memAny()||_libInStrOrComment(before))return false;
    var line=before.substring(before.lastIndexOf('\n')+1),m,sc,items,p;
    // region name: <type>   and   param: region <type>
    if((m=line.match(/^\s*(?:public\s+)?region\s+[A-Za-z_]\w*\s*:\s*(\w*)$/))||(m=line.match(/:\s*region\s+(\w*)$/))){
      sc=_memScope();p=m[1].toLowerCase();items=[];
      _MEM_ELEMS.forEach(function(t){if(t[0].indexOf(p)===0&&t[0]!==m[1])items.push([t[0],_memItem(t[0],t[1])])});
      Object.keys(sc.structs).sort().forEach(function(n){if(n.toLowerCase().indexOf(p)===0&&n!==m[1])items.push([n,_memItem(n,'struct · '+(sc.structs[n].s.fields||[]).length+' fields')])});
      _memShowItems(_memRank(items,m[1]),before,'mt:'+before.length+':'+m[1]);
      return true;
    }
    // region[expr].field   alias.region[expr].field   (also nested: .pos.x)
    if((m=before.match(/(?:^|[^\w$.\]])(?:([A-Za-z_]\w*)\.)?([A-Za-z_]\w*)\[(?:[^\[\]\n]|\[[^\[\]\n]*\])*\]((?:\.[A-Za-z_]\w*)*)\.(\w*)$/))){
      sc=_memScope();var ref=_memRegionRef(sc,m[1],m[2]);
      if(!ref&&m[1]){ref=_memRegionRef(sc,null,m[2])}
      if(!ref)return false;
      var st=_memFindStruct(sc,ref.r.elem,ref.mod);if(!st)return false;
      var path=m[3]?m[3].substring(1).split('.'):[];
      for(var i=0;i<path.length&&st;i++){
        var fd=null;(st.fields||[]).forEach(function(f){if(!fd&&f.name.toLowerCase()===path[i].toLowerCase())fd=f});
        st=fd?_memFindStruct(sc,String(fd.type).replace(/\[.*$/,''),ref.mod):null;
      }
      if(!st)return false;
      p=m[4].toLowerCase();items=[];
      (st.fields||[]).forEach(function(f){if(f.name.toLowerCase().indexOf(p)===0&&f.name!==m[4])items.push([f.name,_memItem(f.name,f.type+' · '+st.name)])});
      _memShowItems(_memRank(items,m[4]),before,'mf:'+before.length+':'+m[0]);
      return true;
    }
    // region.length   alias.region.length
    if((m=before.match(/(?:^|[^\w$.\]])(?:([A-Za-z_]\w*)\.)?([A-Za-z_]\w*)\.(\w*)$/))){
      sc=_memScope();var rf=_memRegionRef(sc,m[1],m[2]);
      if(!rf)return false;
      items='length'.indexOf(m[3])===0&&m[3]!=='length'?[_memItem('length','int · '+rf.r.elem+'['+rf.r.length+']')]:[];
      _memShowItems(items,before,'ml:'+before.length+':'+m[0]);
      return true;
    }
  }catch(e){}
  return false;
}
// Runs last in checkAC: region and struct names join identifier suggestions; region / struct snippets at a line start
var _MEM_SNIPS=[['region','region name: int[64]','name'],['public region','public region name: int[64]','name'],['struct','struct Name { x: num, y: num }','Name'],['public struct','public struct Name { x: num, y: num }','Name']];
function _memACFallback(before){
  try{
    if(_libInStrOrComment(before))return;
    var any=_memAny();
    var wm=before.match(/(?:^|[^\w$.])([A-Za-z_]\w*)$/);
    if(!wm||wm[1].length<2)return;
    var lineText=before.substring(before.lastIndexOf('\n')+1),lt=lineText.replace(/^\s+/,''),items=[],w=wm[1].toLowerCase();
    if(/^(public\s+)?[A-Za-z_]\w*$/.test(lt)){
      _MEM_SNIPS.forEach(function(s){if(s[0].indexOf(lt)===0&&s[0]!==lt&&(lt.indexOf(' ')>0||s[0].indexOf(' ')<0||'public'.indexOf(lt)===0)){var it=_memItem(s[0],s[1]);it._memSnip={text:s[1],sel:s[2],rep:lt.length};items.push(it)}});
    }
    if(any&&!/^(fn|export|use|import|package|struct|region|public\s+(struct|region))\s/.test(lt)&&!/^(let|mut|const)\s+[A-Za-z_]\w*$/.test(lt)){
      var sc=_memScope();
      Object.keys(sc.regions).forEach(function(n){if(n!==wm[1]&&n.toLowerCase().indexOf(w)===0){var r=sc.regions[n].r;items.push(_memItem(n,'region '+r.elem+'['+r.length+']'+(sc.regions[n].mod&&sc.regions[n].mod!==sc.cur?' · '+sc.regions[n].mod:'')))}});
      Object.keys(sc.structs).forEach(function(n){if(n!==wm[1]&&n.toLowerCase().indexOf(w)===0)items.push(_memItem(n,'struct · '+(sc.structs[n].s.fields||[]).length+' fields'))});
    }
    if(!items.length)return;
    var base=acActive?acItems.filter(function(it){return it._libac!=='hint'}):[];
    _libACShow(items.concat(base),before,'mg:'+before.length+':'+wm[1]);
  }catch(e){}
}
checkAC=(function(f){return function(){
  var before=null;try{before=ed.value.substring(0,ed.selectionStart)}catch(e){}
  if(before!==null&&_memACCheck(before))return;
  var r=f.apply(this,arguments);
  if(before!==null)_memACFallback(before);
  return r;
}})(checkAC);
// A snippet replaces what was typed on the line and selects its placeholder
_libACPick=(function(f){return function(idx){
  var it=acItems[idx];
  if(!it||!it._memSnip)return f.apply(this,arguments);
  var pos=ed.selectionStart,start=Math.max(0,pos-it._memSnip.rep),txt=it._memSnip.text;
  ed.value=ed.value.substring(0,start)+txt+ed.value.substring(pos);
  var at=start+txt.indexOf(it._memSnip.sel);
  ed.selectionStart=at;ed.selectionEnd=at+it._memSnip.sel.length;
  _builtinAC=false;_methodAC=false;hideAC();updGutter();hlCode();ed.focus();
  try{_projDirty()}catch(e){}
}})(_libACPick);

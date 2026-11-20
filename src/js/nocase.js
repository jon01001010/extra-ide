// ═══ CASE-INSENSITIVE NAMES ═══ every Emit name is case-insensitive (`Hero` and `hero` are one name)
// Compiler half. Runtime half (the runtime block, next to _jsErr): _ncProp(obj, name) — every JS name a program
// uses (member read / write / call, new A.B, globals, auto-bridged functions) is looked up exactly first (`name in
// obj`, own or inherited); when the object has no such property, the one own-or-inherited property equal to it
// ignoring case is used (three.scene → THREE.Scene), cached per object and name in a WeakMap (a miss rescans);
// two or more such properties are an error naming them, catchable with try / catch. Strings passed to JS are never
// changed. _ncExport(inst, name): _emitCallExport finds an export whatever its case. Both live between
// //#emit-nocase-begin / end, which an export keeps only for programs that use JS interop (else a stub).
// Sprite frames / sprites, sounds, maps, map object kinds and pressed("a") are looked up ignoring case at run time.
// Mote: moteVM() and the Script tool make VMs with Mote's caseInsensitive option (MOTE.md).
//
// How. compile() first runs _ncCanon over the whole bundle: a light lexer (comments, strings, `use` lines and the
// bodies of sprite / sound / music / map / controls / script blocks are skipped; thing and rules bodies are read)
// finds every declaration — fn, let / mut / const, parameters, catch (e), with … as b, struct and its fields,
// region, import (aliases, imported names, .*), package, block names (sprite, sound, music, map, controls, thing,
// script), thing fields, rules auto-globals, `use … as Name` — and the brace scopes they live in. Every use of a
// name is then rewritten, in place, to the spelling of the declaration it resolves to (innermost scope first,
// then the file, its imports, the project-wide block names, the builtins, the rules' auto-globals); keywords and
// type words (FN, Let, Int, TRUE, Struct, U8 …) are written in lower case; the kind word of a block header
// (`Sprite Hero:`) too; import paths and package lines take the spelling of the file path; `.name` after a
// module alias takes the spelling of that module's declaration, any other `.name` the spelling of a struct /
// thing field of that name (a JS property that is not one of those stays as written: the runtime finds it).
// Only the case of letters changes, so every position (line:col) stays the same, and a program that already
// spells every name one way is passed through unchanged — it compiles to the same bytes as before.
// Names are shown as declared (errors, Memory tab, Timeline, tools) because the declaration's spelling wins.
// Exception: an exported function the host calls by name (frame, onclick_N, ontimer_N, onhttp_N, onrecv_N) is
// declared in lower case (that is its WASM export name), however it is written.
// Two declarations in one scope whose names differ only by case are an error (both positions); so are two
// blocks of one kind (sprite hero / sprite Hero), two struct fields, two thing fields and two files that are
// the same module (Game.emit / game.emit). A local that shadows a global of another case shadows it, as today.
var _NC_HOST_EXPORT=/^(frame|on(click|timer|http|recv)_\d+)$/i;
var _NC_CTX_WORDS={struct:1,region:1,with:1,arr:1,numarr:1,i8:1,u8:1,i16:1,u16:1,u32:1};
var _NC_BLOCK_PREF=['thing','sprite','sound','music','map','controls','script','use'];
function _ncKey(s){return String(s).toLowerCase()}
function _ncBuiltins(){
  var spell=new Map(),bad=new Set();
  function add(n){if(typeof n!=='string'||!/^[A-Za-z_]\w*$/.test(n))return;var k=n.toLowerCase();if(spell.has(k)&&spell.get(k)!==n)bad.add(k);else spell.set(k,n)}
  try{_emitBlt.forEach(add)}catch(e){}
  try{_allBuiltins.forEach(function(b){add(b.name)})}catch(e){}
  try{Object.keys(BUILTINS).forEach(add)}catch(e){}
  try{Object.keys(_MOTE_SIGS).forEach(add)}catch(e){}
  try{Object.keys(_LG_FN_HELPERS).forEach(add)}catch(e){}
  try{Object.keys(_JS_CONV_IMPORTS).forEach(add)}catch(e){}
  bad.forEach(function(k){spell.delete(k)});
  return spell;
}
function _ncCanon(text){
  text=String(text==null?'':text);
  var out=text.split(''),errors=[],changed=false;
  var multi=false,files=[];
  (function(){
    var lines=text.split('\n'),off=0,cur=null;
    multi=text.indexOf(_EMIT_FILE_MARK)===0;
    for(var i=0;i<lines.length;i++){
      var ln=lines[i];
      if(ln.indexOf(_EMIT_FILE_MARK)===0){cur={path:ln.slice(_EMIT_FILE_MARK.length).trim(),off:off+ln.length+1,lines:[],index:files.length};files.push(cur)}
      else{if(!cur){cur={path:'main.emit',off:off,lines:[],index:0};files.push(cur)}cur.lines.push(ln)}
      off+=ln.length+1;
    }
    if(files.length>1)multi=true;
    files.forEach(function(f){f.src=f.lines.join('\n');f.mod=_emitModName(f.path)});
  })();
  function set(f,o,v){
    for(var i=0;i<v.length;i++){var g=f.off+o+i;if(out[g]!==v[i]){out[g]=v[i];changed=true}}
  }
  function pos(f,o){var s=f.src.slice(0,o),nl=s.lastIndexOf('\n');return{line:s.split('\n').length,col:o-nl}}
  function where(d,f){return(d.file!==f?d.file.path+':':'')+d.line+':'+d.col}
  function err(f,line,col,msg){errors.push({i:f.index,line:line,col:col,text:(multi?f.path+':':'')+line+':'+col+': '+msg})}
  function clash(f,tok,prev,what){
    err(f,tok.line,tok.col,(what?what+' ':'')+'"'+tok.v+'" and "'+prev.name+'" ('+(what||'declared')+' at '+where(prev,f)+') differ only by case — names in Emit are case-insensitive, so they are the same name: rename one of them');
  }
  // ── modules: one per file; two files that are the same module apart from case clash ──
  var modByKey=new Map();
  files.forEach(function(f){
    var k=_ncKey(f.mod),o=modByKey.get(k);
    if(o&&o.mod!==f.mod)err(f,1,1,'File "'+f.path+'" and file "'+o.path+'" are both module '+o.mod+' — names are case-insensitive: rename one of them');
    else if(!o)modByKey.set(k,f);
  });
  // ── light lexer ──
  var KWS=new Set();KW.forEach(function(k){KWS.add(k)});TY.forEach(function(k){KWS.add(k)});['true','false','null'].forEach(function(k){KWS.add(k)});
  var BLT=_ncBuiltins();
  var project=new Map();   // kind → Map(key → decl)
  var autos=new Map();     // rules auto-globals
  var members=new Map();   // struct / thing field key → decl
  var anyThing=false;
  function projDecl(f,kind,tok){
    var m=project.get(kind);if(!m){m=new Map();project.set(kind,m)}
    var k=_ncKey(tok.v),p=m.get(k);
    if(p){if(p.name!==tok.v)clash(f,tok,p,kind==='use'?'library alias':kind);return p}
    var d={name:tok.v,key:k,file:f,line:tok.line,col:tok.col,kind:kind};m.set(k,d);return d;
  }
  function memberDecl(f,tok,where,scopeMap){
    var k=_ncKey(tok.v);
    if(scopeMap){var p=scopeMap.get(k);if(p&&p.name!==tok.v)clash(f,tok,p,where);if(!p)scopeMap.set(k,{name:tok.v,file:f,line:tok.line,col:tok.col})}
    if(!members.has(k))members.set(k,{name:tok.v});
  }
  function lex(f){
    var src=f.src,toks=[],blocks=_emitScanBlocks(src),bl=new Array(src.split('\n').length+1);
    f.blocks=blocks;
    blocks.forEach(function(b){for(var i=b.start;i<=b.end;i++)bl[i]=b});
    var lines=src.split('\n'),lo=0,inC=false,inS=null,sTok=null;
    for(var li=0;li<lines.length;li++,lo+=lines[li-1].length+1){
      var L=lines[li],b=bl[li],ctx='code';
      if(b&&!inC&&!inS){
        if(li===b.start){
          /* header: kind word (lower case) and the name */
          var hm=/^([A-Za-z_]\w*)(?:([ \t]+)([A-Za-z_]\w*))?/.exec(L);
          toks.push({k:'hk',v:hm[1],o:lo,line:li+1,col:1,blk:b});
          if(hm[3])toks.push({k:'hn',v:hm[3],o:lo+hm[1].length+hm[2].length,line:li+1,col:1+hm[1].length+hm[2].length,blk:b});
          if(b.kind!=='thing'&&b.kind!=='rules')continue;
          var cp=L.indexOf(':');
          ctx=b.kind;L=L;var startC=cp+1;
          scanLine(L,startC,li,lo,ctx,b);
          continue;
        }
        if(b.kind!=='thing'&&b.kind!=='rules')continue;
        ctx=b.kind;
        scanLine(L,0,li,lo,ctx,b);
        continue;
      }
      scanLine(L,0,li,lo,ctx,null);
    }
    function scanLine(L,c0,li,lo,ctx,b){
      var c=c0,first=true;
      while(c<L.length){
        var ch=L[c];
        if(inC){var e=L.indexOf('*/',c);if(e<0){c=L.length;break}inC=false;c=e+2;continue}
        if(inS){
          if(ch==='\\'){sTok.v+=L[c+1]===undefined?'':L[c+1];c+=2;continue}
          if(ch===inS){inS=null;sTok.end=lo+c;c++;continue}
          sTok.v+=ch;c++;continue;
        }
        if(ch===' '||ch==='\t'||ch==='\r'){c++;continue}
        if(ch==='/'&&L[c+1]==='/')break;
        if(ch==='/'&&L[c+1]==='*'){inC=true;c+=2;continue}
        if(ch==='"'||ch==="'"){inS=ch;sTok={k:'s',v:'',o:lo+c+1,line:li+1,col:c+1,ctx:ctx,blk:b};toks.push(sTok);c++;first=false;continue}
        if(ch==='#'&&b){c++;while(c<L.length&&/\w/.test(L[c]))c++;continue}
        if(/[0-9]/.test(ch)){var s=c;c++;while(c<L.length&&/\w/.test(L[c]))c++;if(L[c]==='.'&&/[0-9]/.test(L[c+1]||'')){c++;while(c<L.length&&/\w/.test(L[c]))c++}toks.push({k:'n',v:L.slice(s,c),o:lo+s,line:li+1,col:s+1,ctx:ctx,blk:b});first=false;continue}
        if(/[A-Za-z_]/.test(ch)){
          var s2=c;while(c<L.length&&/\w/.test(L[c]))c++;
          var w=L.slice(s2,c),t={k:'w',v:w,o:lo+s2,line:li+1,col:s2+1,ctx:ctx,blk:b};
          toks.push(t);
          if(first&&ctx==='code'&&_ncKey(w)==='use'){
            var prev=toks.length>1?toks[toks.length-2]:null;
            if(!prev||prev.line!==li+1){
              t.use=L.slice(c);
              c=L.length;break;
            }
          }
          first=false;continue;
        }
        var two=L.substr(c,2);
        if(two==='->'||two==='=='||two==='!='||two==='<='||two==='>='||two==='&&'||two==='||'||two==='??'||two==='++'||two==='--'||two==='+='||two==='-='||two==='*='||two==='/='){toks.push({k:'p',v:two,o:lo+c,line:li+1,col:c+1,ctx:ctx,blk:b});c+=2;first=false;continue}
        toks.push({k:'p',v:ch,o:lo+c,line:li+1,col:c+1,ctx:ctx,blk:b});c++;first=false;
      }
      if(inS)sTok.v+='\n';
    }
    return toks;
  }
  // ── pass 1: scopes and declarations ──
  function Scope(parent,kind,f){this.parent=parent;this.kind=kind;this.decls=new Map();this.file=f}
  function declare(f,scope,tok,kind,extra){
    var k=_ncKey(tok.v),p=scope.decls.get(k);
    if(p){if(p.name!==tok.v)clash(f,tok,p);tok.decl=p;return p}
    var d={name:tok.v,key:k,file:f,line:tok.line,col:tok.col,kind:kind,tok:tok};
    if(extra)for(var x in extra)d[x]=extra[x];
    scope.decls.set(k,d);tok.decl=d;
    return d;
  }
  files.forEach(function(f){
    var T=f.toks=lex(f),fileScope=f.scope=new Scope(null,'file',f);
    f.imports=[];f.stars=[];f.structFields=new Map();
    var scope=fileScope,stack=[],pending=[],parens=[],objKey=[],structNext=false,structFields=null;
    function sig(i){return T[i]}
    function isW(t,v){return t&&t.k==='w'&&(v===undefined||_ncKey(t.v)===v)}
    function isP(t,v){return t&&t.k==='p'&&(v===undefined||t.v===v)}
    for(var i=0;i<T.length;i++){
      var t=T[i];
      if(t.k==='hk'){
        set(f,t.o,_ncKey(t.v));t.v=_ncKey(t.v);
        continue;
      }
      if(t.k==='hn'){
        var bk=t.blk.kind;
        if(bk==='thing')anyThing=true;
        if(bk!=='rules')t.decl=projDecl(f,bk,t);
        t.done=true;
        continue;
      }
      if(t.ctx==='thing'||t.ctx==='rules'){t.scope=fileScope;continue}
      t.scope=scope;
      if(t.k==='w'&&t.use!==undefined){
        set(f,t.o,'use');t.done=true;
        var am=/^(.*?)\bas[ \t]+([A-Za-z_]\w*)[ \t]*(?:\/\/.*)?$/i.exec(t.use);
        if(am){var ao=t.o+3+am[1].length;set(f,ao,'as');var at={v:am[2],o:t.o+3+am[0].indexOf(am[2],am[1].length+2),line:t.line,col:0};at.col=at.o-t.o+t.col;projDecl(f,'use',at)}
        continue;
      }
      if(t.k==='p'){
        if(t.v==='{'){
          var p=T[i-1],kind='block';
          if(structNext){kind='struct';structNext=false}
          else if(p&&((p.k==='p'&&p.v!==')'&&p.v!=='}'&&p.v!==']')||(p.k==='w'&&/^(return|throw|await)$/i.test(p.v))))kind='obj';
          var ns=new Scope(scope,kind,f);
          if(scope.forHdr&&!scope.bodyOpen){scope.bodyOpen=true;ns.closesFor=true}
          if(kind==='block'){pending.forEach(function(x){declare(f,ns,x.tok,x.kind,x.extra)});}
          pending=[];
          stack.push(scope);scope=ns;
          if(kind==='struct'){structFields=new Map()}
          objKey.push(kind==='obj'||kind==='struct');
          continue;
        }
        if(t.v==='}'){if(stack.length){if(scope.kind==='struct')structFields=null;var cf=scope.closesFor;scope=stack.pop();if(cf&&stack.length)scope=stack.pop()}objKey.pop();continue}
        if(t.v==='('){var fh=isW(T[i-1],'for');parens.push({forHdr:fh,catchHdr:isW(T[i-1],'catch')});
          /* for (let i …; i < n; i++) { … }: i is seen in the header and the body (a scope from ( to the body's }) */
          if(fh){stack.push(scope);scope=new Scope(scope,'block',f);scope.forHdr=true}
          continue}
        if(t.v===')'){parens.pop();continue}
        continue;
      }
      if(t.k!=='w')continue;
      var key=_ncKey(t.v),prev=T[i-1],next=T[i+1];
      if(isP(prev,'.')){t.member=true;continue}
      /* object literal key / struct field: a word right after { or , followed by : */
      if((scope.kind==='obj'||scope.kind==='struct')&&isP(next,':')&&prev&&(isP(prev,'{')||isP(prev,',')||isP(prev,';')||(scope.kind==='struct'&&prev.line!==t.line))){
        if(scope.kind==='obj'){t.done=true;continue}
        t.done=true;memberDecl(f,t,'field',structFields);continue;
      }
      if(key==='fn'&&isW(next)){
        var isImp=isW(prev,'import'),isExp=isW(prev,'export')||(isW(prev,'public')&&isW(T[i-2],'export'));
        var nt=next;i++;
        if(isExp&&_NC_HOST_EXPORT.test(nt.v)&&nt.v!==_ncKey(nt.v)){set(f,nt.o,_ncKey(nt.v));nt.v0=nt.v;nt.v=_ncKey(nt.v)}
        declare(f,scope,nt,'fn');nt.done=true;
        if(isP(T[i+1],'(')){
          var j=i+2,depth=1,params=[];
          while(j<T.length&&depth>0){
            var q=T[j];
            if(isP(q,'('))depth++;else if(isP(q,')'))depth--;
            else if(depth===1&&q.k==='w'&&isP(T[j+1],':')&&(isP(T[j-1],'(')||isP(T[j-1],','))){params.push(q);q.done=true;q.scope=scope}
            else if(q.k==='w')q.scope=scope;
            j++;
          }
          /* the body: the next { after the return type (not for import fn … from "m") */
          var k2=j,ok=!isImp;
          while(ok&&k2<T.length&&!isP(T[k2],'{')){var r=T[k2];if(r.k==='s'||isW(r,'from')||isW(r,'fn')||isW(r,'let')||isW(r,'mut')){ok=false;break}k2++}
          if(ok)params.forEach(function(q){pending.push({tok:q,kind:'param'})});
          /* the parameter tokens are resolved (their types) in pass 2 with the outer scope; the names are done */
          for(var z=i+1;z<j;z++)if(!T[z].scope)T[z].scope=scope;
          i=j-1;
        }
        continue;
      }
      if((key==='let'||key==='mut'||key==='const')&&isW(next)){
        var vd=declare(f,scope,next,'var');
        /* the initialiser does not see the name it declares: let notyf = new Notyf() — Notyf is the JS class */
        for(var j4=i+2,dep=0;j4<T.length;j4++){var q4=T[j4];if(q4.k!=='p'&&q4.k!=='w'&&q4.k!=='n'&&q4.k!=='s')break;if(q4.line!==next.line&&dep<=0)break;if(isP(q4,'(')||isP(q4,'[')||isP(q4,'{'))dep++;else if(isP(q4,')')||isP(q4,']')||isP(q4,'}')){if(dep<=0)break;dep--}else if(isP(q4,';')&&dep<=0)break;q4.inInit=vd}
        next.done=true;next.scope=scope;i++;continue;
      }
      if(key==='catch'&&isP(next,'(')&&isW(T[i+2])){pending.push({tok:T[i+2],kind:'var'});T[i+2].done=true;T[i+2].scope=scope;continue}
      if(key==='as'&&isW(next)){
        /* with … as b { — import … as p is handled with the import */
        pending.push({tok:next,kind:'var'});next.done=true;next.scope=scope;i++;continue;
      }
      if(key==='struct'&&isW(next)&&isP(T[i+2],'{')&&(!prev||prev.line!==t.line||isW(prev,'public'))){
        set(f,t.o,'struct');t.done=true;declare(f,scope,next,'struct');next.done=true;next.scope=scope;structNext=true;i++;continue;
      }
      if(key==='region'&&isW(next)&&isP(T[i+2],':')&&(!prev||prev.line!==t.line||isW(prev,'public'))){
        set(f,t.o,'region');t.done=true;declare(f,scope,next,'region');next.done=true;next.scope=scope;i++;continue;
      }
      if(key==='package'&&scope===fileScope&&(!prev||prev.line!==t.line)&&isW(next)&&next.line===t.line){
        set(f,t.o,'package');t.done=true;
        var segs=[],j2=i+1;
        while(isW(T[j2])&&T[j2].line===t.line){segs.push(T[j2]);T[j2].done=true;if(isP(T[j2+1],'.'))j2+=2;else break}
        var want=f.mod.indexOf('.')<0?null:f.mod.slice(0,f.mod.lastIndexOf('.')).split('.');
        if(want&&want.length===segs.length&&segs.every(function(s,x){return _ncKey(s.v)===_ncKey(want[x])}))segs.forEach(function(s,x){set(f,s.o,want[x])});
        i=j2;continue;
      }
      if(key==='import'&&scope===fileScope&&!isW(next,'fn')&&isW(next)){
        set(f,t.o,'import');t.done=true;
        var im={segs:[],star:false,alias:null,tok:t},j3=i+1;
        while(isW(T[j3])&&T[j3].line===t.line){im.segs.push(T[j3]);T[j3].done=true;if(isP(T[j3+1],'.')){if(isP(T[j3+2],'*')){im.star=true;j3+=3;break}j3+=2}else{j3++;break}}
        if(isW(T[j3],'as')&&isW(T[j3+1])&&T[j3+1].line===t.line){set(f,T[j3].o,'as');T[j3].done=true;im.alias=T[j3+1];T[j3+1].done=true;j3+=2}
        f.imports.push(im);
        i=j3-1;continue;
      }
    }
  });
  // ── imports: resolved against the modules (folded); the path takes the spelling of the file path ──
  files.forEach(function(f){
    f.imports.forEach(function(im){
      var segs=im.segs.map(function(s){return _ncKey(s.v)}),full=segs.join('.'),m=modByKey.get(full),name=null,d=null;
      if(m&&!im.star&&false){}
      if(!m&&!im.star&&segs.length>1){
        var pm=modByKey.get(segs.slice(0,-1).join('.'));
        if(pm){var td=pm.scope.decls.get(segs[segs.length-1]);if(td){m=pm;d=td}}
      }
      if(!m)return;
      var parts=m.mod.split('.');
      for(var x=0;x<parts.length&&x<im.segs.length;x++)set(f,im.segs[x].o,parts[x]);
      if(d)set(f,im.segs[im.segs.length-1].o,d.name);
      if(im.star){f.stars.push(m);return}
      var at=im.alias||im.segs[im.segs.length-1];
      if(!im.alias)at={v:d?d.name:parts[parts.length-1],line:at.line,col:at.col,o:at.o};
      var ad=declare(f,f.scope,at,'import',d?{target:d}:{mod:m});
      if(im.alias)im.alias.decl=ad;
    });
  });
  // ── thing / rules bodies: thing fields and rules auto-globals ──
  var THING_WORDS={};_LG_THING_WORDS.forEach(function(w){THING_WORDS[w]=1});
  if(anyThing)_LG_BASE_FIELDS.forEach(function(n){if(!members.has(n))members.set(n,{name:n})});
  files.forEach(function(f){
    var T=f.toks,fieldsOf=new Map();
    for(var i=0;i<T.length;i++){
      var t=T[i];if(t.k!=='w'||t.done)continue;
      var prev=T[i-1],next=T[i+1];
      if(t.ctx==='thing'){
        var itemStart=!prev||prev.line!==t.line||(prev.k==='p'&&(prev.v===','||prev.v===':'))||prev.k==='hn';
        if(itemStart){
          var k=_ncKey(t.v);
          if(THING_WORDS[k]||k==='from'){t.thingWord=k;continue}
          if(next&&next.line===t.line&&!(next.k==='p'&&next.v===',')){
            var owner=t.blk.name,fm=fieldsOf.get(_ncKey(owner));if(!fm){fm=new Map();fieldsOf.set(_ncKey(owner),fm)}
            t.done=true;memberDecl(f,t,'field of thing '+owner,fm);
          }
        }
      }else if(t.ctx==='rules'){
        var pk=prev&&prev.k==='w'?_ncKey(prev.v):'';
        if((pk==='add'||pk==='set')&&!(next&&next.k==='p'&&next.v==='.')&&!(next&&next.k==='p'&&next.v===':'))t.autoCand=true;
      }
    }
  });
  // ── pass 2: uses ──
  function lookupScope(s,k,skip){for(;s;s=s.parent){var d=s.decls.get(k);if(d&&d!==skip)return d}return null}
  function lookupProject(k,pref){
    var order=pref?[pref].concat(_NC_BLOCK_PREF):_NC_BLOCK_PREF;
    for(var i=0;i<order.length;i++){var m=project.get(order[i]);if(m&&m.has(k))return m.get(k)}
    return null;
  }
  function resolve(f,t,pref){
    var k=_ncKey(t.v),d=lookupScope(t.scope||f.scope,k,t.inInit);
    if(d)return d;
    for(var i=0;i<f.stars.length;i++){var sd=f.stars[i].scope.decls.get(k);if(sd)return sd}
    if(pref){d=lookupProject(k,pref);if(d)return d}
    d=lookupProject(k,null);if(d)return d;
    if(BLT.has(k))return{name:BLT.get(k),builtin:true};
    return autos.get(k)||null;
  }
  // rules auto-globals: an add / set target that is nothing else
  files.forEach(function(f){
    f.toks.forEach(function(t){if(t.autoCand&&!resolve(f,t,null)&&!autos.has(_ncKey(t.v)))autos.set(_ncKey(t.v),{name:t.v})});
  });
  files.forEach(function(f){
    var T=f.toks;
    for(var i=0;i<T.length;i++){
      var t=T[i];
      if(t.done||t.k==='hk'||t.k==='hn')continue;
      var prev=T[i-1],next=T[i+1];
      if(t.k==='s'){
        /* fnRef("name") names a function */
        if(prev&&prev.k==='p'&&prev.v==='('&&T[i-2]&&T[i-2].k==='w'&&_ncKey(T[i-2].v)==='fnref'&&next&&next.k==='p'&&next.v===')'&&/^[A-Za-z_]\w*$/.test(t.v)){
          var fd=resolve(f,{v:t.v,scope:T[i-2].scope},null);
          if(fd&&fd.name!==t.v&&fd.name.length===t.v.length)set(f,t.o,fd.name);
        }
        continue;
      }
      if(t.k!=='w')continue;
      var k=_ncKey(t.v);
      if(t.member||(prev&&prev.k==='p'&&prev.v==='.')){
        var base=T[i-2],bd=base&&base.k==='w'?(base.decl||base.res):null,md=null;
        if(bd&&bd.mod)md=bd.mod.scope.decls.get(k);
        if(!md&&!(bd&&bd.mod))md=members.get(k)||((k==='length'||k==='push'||k==='pop')?{name:k}:null);
        if(md){t.res=md;if(md.name!==t.v)set(f,t.o,md.name)}
        continue;
      }
      if(t.thingWord)continue;
      if(KWS.has(k)){if(k!==t.v)set(f,t.o,k);continue}
      if(t.ctx==='thing'&&k==='i'){if(t.v!=='i')set(f,t.o,'i');continue}
      var pref=null;
      if(t.ctx==='thing'){var pw=prev&&prev.k==='w'?_ncKey(prev.v):'';pref=pw==='sprite'?'sprite':pw==='map'?'map':'thing'}
      else if(t.ctx==='rules'){var pw2=prev&&prev.k==='w'?_ncKey(prev.v):'';pref=pw2==='play'?'sound':pw2==='music'?'music':pw2==='map'?'map':pw2==='controls'?'controls':'thing'}
      var d=resolve(f,t,pref);
      if(d){t.res=d;if(d.name!==t.v)set(f,t.o,d.name);continue}
      if(_NC_CTX_WORDS[k]){if(k!==t.v)set(f,t.o,k)}
    }
  });
  return{text:changed?out.join(''):text,changed:changed,errors:errors.sort(function(a,b){return a.i-b.i||a.line-b.line||a.col-b.col}).map(function(e){return e.text})};
}
compile=(function(c){return function(source,target){
  var cn=null;
  try{cn=_ncCanon(source)}catch(e){cn=null;try{console.warn('case-insensitive names: '+((e&&e.stack)||e))}catch(x){}}
  if(!cn)return c.apply(this,arguments);
  var r=c.call(this,cn.text,target);
  if(cn.errors.length&&r){
    r.errors=cn.errors.concat(r.errors||[]);
    r.wasm=new Uint8Array([0,0x61,0x73,0x6D,1,0,0,0]);
  }
  return r;
}})(compile);

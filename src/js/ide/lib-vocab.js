// ═══ Library vocabulary — live autocomplete from whatever JS libraries are loaded ═══
// Nothing here knows how a library was loaded: globals are found by diffing `window` against a
// snapshot taken when the IDE finished starting (see the last <script> of the page).
var _libBaseGlobals=null;
function _libSnapshotGlobals(){try{_libBaseGlobals=new Set(Object.getOwnPropertyNames(window))}catch(e){_libBaseGlobals=null}}
var _libIdentRe=/^[A-Za-z_$][\w$]*$/;
// Names libraries have added to `window` since the snapshot (e.g. THREE, BABYLON, confetti, dayjs).
function _libGlobals(){
  var out=[];
  if(!_libBaseGlobals)return out;
  var names;try{names=Object.getOwnPropertyNames(window)}catch(e){return out}
  for(var i=0;i<names.length;i++){
    var n=names[i];
    if(_libBaseGlobals.has(n)||!_libIdentRe.test(n))continue;
    if(n.charAt(0)==='_'&&n.length>1)continue;   // private/internal (IDE runtime state, __THREE__ …)
    try{
      var d=Object.getOwnPropertyDescriptor(window,n);
      if(!d||!('value' in d))continue;
      var v=d.value,t=typeof v;
      if(v===null||(t!=='function'&&t!=='object')||v===window)continue;
      if(typeof Node==='function'&&v instanceof Node)continue;
      out.push(n);
    }catch(e){}
  }
  return out.sort();
}
function _jsKind(v){
  try{
    var t=typeof v;
    if(t==='function'){
      var p=null;try{p=v.prototype}catch(e){}
      if(p&&typeof p==='object'){
        if(Object.getPrototypeOf(p)!==Object.prototype)return'class';
        if(Object.getOwnPropertyNames(p).length>1)return'class';
        if(/^class\b/.test(Function.prototype.toString.call(v)))return'class';
      }
      return'fn';
    }
    if(t==='object'&&v!==null)return'obj';
  }catch(e){}
  return'value';
}
var _JS_MEMBER_CAP=4000;
var _jsMemberCache=typeof WeakMap==='function'?new WeakMap():null;
var _jsFnSkip={length:1,name:1,prototype:1,arguments:1,caller:1};
// Sorted [{name,kind,arity}] for an object: own + inherited names, stopping before Object/Function.prototype.
// Never throws, never calls a getter, stops after _JS_MEMBER_CAP names (result.truncated is then true).
function _jsMembers(obj){
  var out=[];
  try{
    var ot=typeof obj;
    if(obj===null||(ot!=='object'&&ot!=='function'))return out;
    var own=0;try{own=Object.getOwnPropertyNames(obj).length}catch(e){}
    if(_jsMemberCache){var c=_jsMemberCache.get(obj);if(c&&c.own===own)return c.list}
    var seen=Object.create(null),isFn=ot==='function',o=obj,depth=0;
    while(o&&o!==Object.prototype&&o!==Function.prototype&&depth<32&&out.length<_JS_MEMBER_CAP){
      var names=[];try{names=Object.getOwnPropertyNames(o)}catch(e){}
      for(var i=0;i<names.length&&out.length<_JS_MEMBER_CAP;i++){
        var nm=names[i];
        if(seen[nm]===1)continue;seen[nm]=1;
        if(nm==='constructor'||(isFn&&_jsFnSkip[nm]===1)||!_libIdentRe.test(nm))continue;
        var kind='value',arity=null;
        try{
          var d=Object.getOwnPropertyDescriptor(o,nm);
          if(d&&('value' in d)){kind=_jsKind(d.value);if(typeof d.value==='function')arity=d.value.length|0}
        }catch(e){}
        out.push({name:nm,kind:kind,arity:arity});
      }
      try{o=Object.getPrototypeOf(o)}catch(e){o=null}
      depth++;
    }
    var truncated=out.length>=_JS_MEMBER_CAP;
    out.sort(function(a,b){return a.name<b.name?-1:a.name>b.name?1:0});
    if(truncated)out.truncated=true;
    if(_jsMemberCache)_jsMemberCache.set(obj,{own:own,list:out});
  }catch(e){}
  return out;
}
// Read a data property through the prototype chain without ever running a getter.
function _jsOwnValue(o,name){
  try{
    for(var depth=0;o!==null&&o!==undefined&&depth<32;depth++){
      var d=Object.getOwnPropertyDescriptor(o,name);
      if(d)return('value' in d)?d.value:undefined;
      o=Object.getPrototypeOf(o);
    }
  }catch(e){}
  return undefined;
}
// ['BABYLON','MeshBuilder'] → the live object, or undefined when the root is not a loaded library global.
function _libResolve(path,globals){
  var G=globals||_libGlobals(),p0=path[0];
  if(G.indexOf(p0)<0){p0=null;for(var g=0;g<G.length;g++)if(G[g].toLowerCase()===String(path[0]).toLowerCase()){p0=G[g];break}if(p0===null)return undefined}   /* names are case-insensitive: three.scene → THREE.Scene */
  var o=_jsOwnValue(window,p0);
  for(var i=1;i<path.length&&o!==undefined;i++){
    var pk=path[i];try{pk=_ncProp(o,pk)}catch(e){}
    o=_jsOwnValue(o,pk);
    if(o===null||(typeof o!=='object'&&typeof o!=='function'))return undefined;
  }
  return o;
}
// `let x = Lib.Class(...)` / `new Lib.Class(...)` earlier in the source → Lib.Class.prototype (else undefined).
function _libVarProto(name,before){
  try{
    var re=new RegExp('(?:^|[^\\w$.])(?:let|mut|const)\\s+'+name.replace(/\$/g,'\\$')+'\\s*(?::\\s*[\\w$]+\\s*)?=\\s*(?:new\\s+)?((?:[A-Za-z_$][\\w$]*\\.)*[A-Za-z_$][\\w$]*)\\s*\\(','g');
    var m,last=null;while((m=re.exec(before)))last=m;
    if(!last)return undefined;
    var cls=_libResolve(last[1].split('.'));
    if(typeof cls==='function'&&_jsKind(cls)==='class'&&cls.prototype)return cls.prototype;
  }catch(e){}
  return undefined;
}
// True when the cursor (end of `before`) sits inside a string literal or a // comment on its line.
function _libInStrOrComment(before){
  var line=before.substring(before.lastIndexOf('\n')+1),q='';
  for(var i=0;i<line.length;i++){
    var ch=line.charAt(i);
    if(q){if(ch==='\\')i++;else if(ch===q)q=''}
    else if(ch==='"'||ch==="'")q=ch;
    else if(ch==='/'&&line.charAt(i+1)==='/')return true;
  }
  return q!=='';
}
function _libKindDesc(kind,arity){return kind==='fn'?'fn('+(arity||0)+')':kind}
var _libACKey='',_libACDismissed='';
function _libACShow(items,before,key,passive){
  if(key===_libACDismissed){hideAC();return}
  var keep=(key===_libACKey)?Math.min(acSel,items.length-1):0;
  _libACKey=key;_libACDismissed='';
  var lines=before.split('\n');
  var lineH=ed.scrollHeight/ed.value.split('\n').length||20;
  var y=(lines.length)*lineH-ed.scrollTop+12;
  showAC(items,60,y);
  var els=acPopup.querySelectorAll('.ac-item');
  for(var i=0;i<els.length;i++){
    if(!items[i]||!items[i]._libac)continue;
    els[i].classList.add(items[i]._libac==='hint'?'ac-hint':'ac-lib');
    // Long lists must stay scrollable by touch: pick on a tap (touchend without movement), not on touchstart
    els[i].removeAttribute('ontouchstart');
    (function(el,idx){
      var y0=null;
      el.addEventListener('touchstart',function(e){y0=e.touches[0].clientY},{passive:true});
      el.addEventListener('touchend',function(e){
        if(y0!==null&&Math.abs(e.changedTouches[0].clientY-y0)<10){e.preventDefault();pickAC(idx)}
        y0=null;
      });
    })(els[i],i);
  }
  if(passive){acActive=false;return}   // hint rows never capture Enter/Tab/arrows
  if(keep>0){acSel=keep;updACsel();_libACReveal()}
}
function _libACReveal(){
  try{
    var el=acPopup.querySelector('.ac-item.sel');if(!el)return;
    if(el.offsetTop<acPopup.scrollTop)acPopup.scrollTop=el.offsetTop;
    else if(el.offsetTop+el.offsetHeight>acPopup.scrollTop+acPopup.clientHeight)acPopup.scrollTop=el.offsetTop+el.offsetHeight-acPopup.clientHeight;
  }catch(e){}
}
// Member autocomplete: `THREE.Sc`, `BABYLON.MeshBuilder.Cre`, or `s.` after `let s = THREE.Scene()`.
// Returns true when it took over the popup. Called from checkAC before the hand-written method lists.
function _libACCheck(before){
  try{
    var m=before.match(/(?:^|[^\w$.])((?:[A-Za-z_$][\w$]*\.)+)([\w$]*)$/);
    if(!m||_libInStrOrComment(before))return false;
    var globals=_libGlobals();
    if(!globals.length)return false;
    var path=m[1].slice(0,-1).split('.'),partial=m[2],target;
    if(globals.indexOf(path[0])>=0||globals.some(function(g){return g.toLowerCase()===path[0].toLowerCase()}))target=_libResolve(path,globals);
    else if(path.length===1)target=_libVarProto(path[0],before.substring(0,before.length-m[1].length-m[2].length));
    if(target===undefined)return false;
    var mem=_jsMembers(target),p=partial.toLowerCase(),exact=[],pre=[],sub=[];
    for(var i=0;i<mem.length;i++){
      var nm=mem[i].name;
      if(nm.charAt(0)==='_'&&partial.charAt(0)!=='_')continue;
      var idx=p?nm.toLowerCase().indexOf(p):0;
      if(idx===0){if(nm.indexOf(partial)===0)exact.push(mem[i]);else pre.push(mem[i])}
      else if(idx>0)sub.push(mem[i]);
    }
    var list=exact.concat(pre,sub);
    if(!list.length||(list.length===1&&list[0].name===partial))return false;
    // Parameter names from the hand-written catalogue, when it has this member
    var sigs={};
    if(path.length===1){
      var lib=LIBS.find(function(l){return l.global===path[0]});
      if(lib&&lib.methods)_libCatMembers(lib).forEach(function(s){var q=s.indexOf('('),r=s.indexOf(')');if(q>0&&r>q&&s.substring(0,q).indexOf('.')<0)sigs[s.substring(0,q)]=s.substring(q,r+1)});
    }
    if(!p)list=list.filter(function(e){return sigs[e.name]}).concat(list.filter(function(e){return!sigs[e.name]}));   // bare `Lib.` → curated names first
    var items=list.slice(0,40).map(function(e){
      var call=e.kind==='fn'||e.kind==='class';
      var desc=_libKindDesc(e.kind,e.arity);
      if(call&&sigs[e.name])desc=e.kind+sigs[e.name];
      return{name:e.name,desc:desc,_libac:'member',_ins:e.name+(call?'(':'')};
    });
    _builtinAC=false;_methodAC=false;
    _libACShow(items,before,'m:'+before.length+':'+m[1]+m[2]);
    return true;
  }catch(e){return false}
}
// Does `name` look like the global of a library this file `use`s but that is not loaded yet?
function _libHintFor(name,src){
  try{
    if(name in window)return false;
    if(new RegExp('(?:^|[^\\w$.])(?:let|mut|const|fn)\\s+'+name.replace(/\$/g,'\\$')+'(?![\\w$])').test(src))return false;
    var lines=src.split('\n'),ln=name.toLowerCase();
    for(var i=0;i<lines.length;i++){
      var u=lines[i].match(/^\s*use\s+(\S.*)$/i);
      if(!u)continue;
      var spec=u[1].trim(),as=spec.match(/\s+as\s+([A-Za-z_$][\w$]*)$/i);
      if(as){if(as[1].toLowerCase()===ln)return true;spec=spec.substring(0,as.index)}
      var lib=LIBS.find(function(l){return l.name===spec||l.name.replace('.js','')===spec})||LIBS.find(function(l){var k=spec.toLowerCase();return l.name.toLowerCase()===k||l.name.replace('.js','').toLowerCase()===k});
      if(lib&&lib.global===name)return true;
      if(ln.length>=3&&spec.toLowerCase().replace(/[^a-z0-9]/g,'').indexOf(ln)>=0)return true;
    }
  }catch(e){}
  return false;
}
// Runs after the builtin autocomplete: adds loaded library globals to identifier suggestions,
// or shows a "run once" hint for `X.` when X belongs to a `use`d library that is not loaded yet.
function _libACFallback(before){
  try{
    if(_libInStrOrComment(before))return;
    var dm=before.match(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\.[\w$]*$/);
    if(dm){
      if(!acActive&&_libHintFor(dm[1],_projText()))_libACShow([{name:'Run once to load '+dm[1]+' for suggestions',desc:'▶',_libac:'hint'}],before,'h:'+before.length+':'+dm[0],true);
      return;
    }
    var wm=before.match(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)$/);
    if(!wm||wm[1].length<2)return;
    var lineText=before.substring(before.lastIndexOf('\n')+1).trimStart();
    if(/^(fn|export|use)\s/.test(lineText))return;
    if(/^(let|mut|const)\s/.test(lineText)&&lineText.indexOf('=')<0)return;
    var globals=_libGlobals();
    if(!globals.length)return;
    var w=wm[1].toLowerCase(),pre=[],sub=[];
    globals.forEach(function(g){
      var idx=g.toLowerCase().indexOf(w);
      if(idx===0){if(g!==wm[1])pre.push(g)}
      else if(idx>0&&w.length>=3)sub.push(g);
    });
    var list=pre.concat(sub).slice(0,12);
    if(!list.length)return;
    var items=list.map(function(g){
      var v=_jsOwnValue(window,g),kind=_jsKind(v),call=kind==='fn'||kind==='class';
      return{name:g,desc:'lib · '+_libKindDesc(kind,call?v.length|0:null),_libac:'global',_ins:g+(call?'(':'')};
    });
    var base=(_builtinAC&&acActive)?acItems.slice():[];
    _libACShow(base.concat(items),before,'g:'+before.length+':'+wm[1]);
  }catch(e){}
}
// Insert a picked library row (called first thing from pickAC for rows carrying _libac).
function _libACPick(idx){
  var it=acItems[idx];
  if(!it||it._libac==='hint'){hideAC();ed.focus();return}
  var pos=ed.selectionStart;
  var before=ed.value.substring(0,pos);
  var after=ed.value.substring(pos);
  var wm=before.match(/[\w$]*$/);
  before=before.substring(0,before.length-wm[0].length);
  var ins=it._ins;
  if(ins.charAt(ins.length-1)==='('&&after.charAt(0)==='(')ins=ins.slice(0,-1);
  ed.value=before+ins+after;
  ed.selectionStart=ed.selectionEnd=before.length+ins.length;
  _builtinAC=false;_methodAC=false;hideAC();updGutter();hlCode();ed.focus();
}
ed.addEventListener('keydown',function(e){
  if(e.key==='Escape')_libACDismissed=_libACKey;
  else if(e.key==='ArrowDown'||e.key==='ArrowUp')setTimeout(_libACReveal,0);
});
// 📚 panel: which discovered globals belong to a registry entry, and how big they are
function _libPanelGlobalsFor(l){
  var ln=l.name.replace(/\.js$/,'').toLowerCase().replace(/[^a-z0-9]/g,''),fns=' '+(l.fns||'')+' ';
  return _libGlobals().filter(function(g){
    var gn=g.toLowerCase();
    return g===l.global||fns.indexOf(' '+g+' ')>=0||(gn.length>=3&&ln.length>=3&&(ln.indexOf(gn)>=0||gn.indexOf(ln)>=0));
  });
}
function _libMemberCount(g){var mem=_jsMembers(_jsOwnValue(window,g));return mem.length+(mem.truncated?'+':'')}
function _libPanelInfo(l){
  try{
    var gs=_libPanelGlobalsFor(l);
    if(!gs.length)return'';
    return'<div class="lib-live">loaded: '+gs.slice(0,4).map(function(g){return _libBrowseBtn(g)+' · '+_libMemberCount(g)+' members'}).join(', ')+' <span style="color:var(--fg3)">— tap the name to browse them</span></div>';
  }catch(e){return''}
}
function _libPanelLoaded(){
  try{
    var gs=_libGlobals();
    if(!gs.length)return'';
    return'<div class="lib-live" style="margin:0 0 14px">Loaded now: '+gs.slice(0,12).map(function(g){return _libBrowseBtn(g)+' ('+_libMemberCount(g)+')'}).join(', ')+(gs.length>12?' +'+(gs.length-12)+' more':'')+' &mdash; tap a name to browse its members, or type <b>Name.</b> in the editor for live suggestions.</div>';
  }catch(e){return''}
}

// Member browser for the 📚 panel: tap a loaded library's global name to list its real members
// (read from the live object by _jsMembers), filter them, and tap one to insert it at the cursor.
function _libBrowseOk(n){return/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n)}
function _libBrowseBtn(g){
  if(!_libBrowseOk(g))return'<b>'+g+'</b>';
  return'<b class="lib-browse-btn" onclick="_libBrowse(\''+g+'\',this)">'+g+' ▾</b>';
}
function _libBrowseText(g,m){
  if(m.kind==='class')return'new '+g+'.'+m.name+'()';
  if(m.kind==='fn')return g+'.'+m.name+'()';
  return g+'.'+m.name;
}
function _libBrowse(g,btn){
  var host=btn;while(host&&!(host.classList&&host.classList.contains('lib-live')))host=host.parentNode;
  if(!host)return;
  var next=host.nextSibling;
  if(next&&next.classList&&next.classList.contains('lib-browse')){
    var same=next.getAttribute('data-g')===g;next.parentNode.removeChild(next);if(same)return;
  }
  var box=document.createElement('div');box.className='lib-browse';box.setAttribute('data-g',g);
  box.innerHTML='<input class="lib-browse-q" type="search" placeholder="Filter '+g+' members…" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false"><div class="lib-browse-list"></div>';
  host.parentNode.insertBefore(box,host.nextSibling);
  var q=box.querySelector('.lib-browse-q');
  q.addEventListener('input',function(){_libBrowseFill(box,g,q.value)});
  _libBrowseFill(box,g,'');
}
function _libBrowseFill(box,g,query){
  var list=box.querySelector('.lib-browse-list'),all=[];
  try{all=_jsMembers(_jsOwnValue(window,g)).filter(function(m){return _libBrowseOk(m.name)})}catch(e){}
  var ql=String(query||'').trim().toLowerCase();
  var hits=ql?all.filter(function(m){return m.name.toLowerCase().indexOf(ql)>=0}):all;
  if(ql)hits.sort(function(a,b){var pa=a.name.toLowerCase().indexOf(ql)===0?0:1,pb=b.name.toLowerCase().indexOf(ql)===0?0:1;return pa-pb||(a.name<b.name?-1:a.name>b.name?1:0)});
  var max=60,h='';
  hits.slice(0,max).forEach(function(m){
    var hint=m.kind==='fn'?'fn('+(m.arity||0)+')':m.kind;
    h+='<div class="lib-method lib-browse-row" data-n="'+m.name+'"><span>'+_libBrowseText(g,m).replace(g+'.','<span class="lib-global">'+g+'</span>.')+'</span><span class="lib-browse-kind">'+hint+'</span></div>';
  });
  if(!hits.length)h='<div class="lib-empty">No member of '+g+' matches.</div>';
  else if(hits.length>max)h+='<div class="lib-empty">Showing '+max+' of '+hits.length+' — type to narrow.</div>';
  else h+='<div class="lib-empty">'+hits.length+' of '+all.length+' members.</div>';
  list.innerHTML=h;
  var byName={};hits.forEach(function(m){byName[m.name]=m});
  Array.prototype.forEach.call(list.querySelectorAll('.lib-browse-row'),function(row){
    row.onclick=function(){var m=byName[row.getAttribute('data-n')];if(m)_libBrowsePick(g,m)};
  });
}
function _libBrowsePick(g,m){
  var text=_libBrowseText(g,m),pos=ed.selectionStart;
  ed.value=ed.value.substring(0,pos)+text+ed.value.substring(pos);
  // put the cursor inside the parentheses of a call, otherwise after the name
  var caret=pos+text.length-(/\(\)$/.test(text)?1:0);
  ed.selectionStart=ed.selectionEnd=caret;
  toggleLibs();
  updGutter();hlCode();ed.focus();
}


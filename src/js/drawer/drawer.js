// ═══ DRAWER: tools that edit blocks of the program ═══
// The 🧰 button (and File → Drawer…) opens a sheet of tools. A tool edits blocks of the program text — `sound
// coin: …`, `sprite hero: …` — and writes them back; the program text is the only place their data lives (no
// hidden state lines): a block is readable, can be edited by hand, and is read back when the tool opens again.
//
// Contract (the tools of the other drawer sections code against exactly this):
//   _drawerRegister({id, label, icon, desc, open(ctx)})   a tool file that may load before this section first does
//       if(typeof _drawerRegister!=='function'){window._drawerTools=window._drawerTools||[];window._drawerRegister=function(t){window._drawerTools.push(t)}}
//     (this section adopts what is already in window._drawerTools; window._drawerTools stays the live list).
//   _drawerOpen(id?)   opens the drawer (the list, or straight into tool `id`).
//   open(ctx) builds the tool into ctx.body; ctx = {body, footer (sticky bar for the main buttons), title(text),
//     close(), setDirty(bool), toast(text), blocks(kind), read(kind, name), write(kind, name, text, preferredFile),
//     remove(kind, name), files(), run(), onClose(fn)}. open() may also return a function: it runs when the tool
//     is left (back, close, another tool) — as onClose(fn) does — to stop timers / audio.
//   Leaving a tool after setDirty(true) asks first.
//   A tool may also have go(): its card then closes the drawer and calls go() instead of open() (the Memory card).
// Blocks: a top-level line in column 1 `<kind> <name>:` (rules: has no name) plus every following indented line
// (a blank line when an indented line follows). _drawerBlocks / _drawerRead / _drawerWrite / _drawerRemove work
// on all files of the project; line numbers are 1-based and inclusive.
var _DRAWER_FILES={sound:'sounds.emit',music:'sounds.emit',sprite:'sprites.emit',map:'stages.emit',controls:'stages.emit',thing:'game.emit',rules:'game.emit'};
var _drawer={el:null,tool:null,dirty:false,leave:[],ctx:null,toastT:0};
function _drawerRegister(t){
  var list=window._drawerTools;
  if(!Array.isArray(list))list=window._drawerTools=[];
  if(!t||typeof t!=='object'||!t.id||typeof t.open!=='function'){try{console.warn('_drawerRegister: a tool is {id, label, icon, desc, open(ctx)}',t)}catch(e){}return null}
  for(var i=0;i<list.length;i++)if(list[i]&&list[i].id===t.id){list[i]=t;break}
  if(i===list.length)list.push(t);
  if(_drawer.el&&_drawerIsOpen()&&!_drawer.tool)_drawerList();
  return t;
}
// The registered tools, one per id (the last registration of an id wins; stand-ins pushed twice count once)
function _drawerToolList(){
  var list=Array.isArray(window._drawerTools)?window._drawerTools:[],seen={},out=[];
  for(var i=list.length-1;i>=0;i--){var t=list[i];if(t&&t.id&&typeof t.open==='function'&&!seen[t.id]){seen[t.id]=true;out.unshift(t)}}
  return out;
}
function _drwEl(tag,props,kids){
  var e=document.createElement(tag);
  if(props)for(var k in props){var v=props[k];if(v===undefined||v===null)continue;if(k==='text')e.textContent=v;else if(k==='cls')e.className=v;else if(k==='on')for(var ev in v)e.addEventListener(ev,v[ev]);else if(k==='style')e.style.cssText=v;else if(k in e&&typeof v!=='string')e[k]=v;else e.setAttribute(k,v)}
  (kids||[]).forEach(function(c){if(c!==null&&c!==undefined&&c!==false)e.appendChild(typeof c==='string'?document.createTextNode(c):c)});
  return e;
}
function _drawerEnsure(){
  if(_drawer.el)return _drawer.el;
  var bg=_drwEl('div',{cls:'drw-bg',id:'drawer'});
  var back=_drwEl('button',{cls:'drw-hb drw-back',title:'Back to the tools','aria-label':'Back to the tools',text:'‹',on:{click:function(){_drawerBack()}}});
  var title=_drwEl('div',{cls:'drw-t',id:'drawerTitle',text:'Drawer'});
  var close=_drwEl('button',{cls:'drw-hb drw-x',title:'Close','aria-label':'Close the drawer',text:'✕',on:{click:function(){_drawerClose()}}});
  var body=_drwEl('div',{cls:'drw-body',id:'drawerBody'}),foot=_drwEl('div',{cls:'drw-ft',id:'drawerFoot'});
  var toast=_drwEl('div',{cls:'drw-toast',role:'status','aria-live':'polite'});
  var panel=_drwEl('div',{cls:'drw',role:'dialog','aria-modal':'true','aria-labelledby':'drawerTitle',tabindex:'-1'},[_drwEl('div',{cls:'drw-hd'},[back,title,close]),body,foot,toast]);
  bg.appendChild(panel);
  bg.addEventListener('click',function(e){if(e.target===bg)_drawerClose()});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&_drawerIsOpen()){e.preventDefault();e.stopPropagation();_drawerClose()}},true);
  document.body.appendChild(bg);
  _drawer.el=bg;_drawer.body=body;_drawer.foot=foot;_drawer.title=title;_drawer.back=back;_drawer.toastEl=toast;_drawer.panel=panel;
  return bg;
}
function _drawerIsOpen(){return!!(_drawer.el&&_drawer.el.classList.contains('show'))}
function _drawerFind(id){var l=_drawerToolList();for(var i=0;i<l.length;i++)if(l[i].id===id)return l[i];return null}
// Opens the drawer: the list of tools, or tool `id` (when that tool is registered)
function _drawerOpen(id){
  _drawerEnsure();
  if(_drawerIsOpen()&&_drawer.tool){if(id&&_drawer.tool.id===id)return true;if(!_drawerConfirmLeave())return false}
  try{hideAC()}catch(e){}
  _drawer.el.classList.add('show');
  var t=id?_drawerFind(id):null;
  if(t)_drawerTool(t);else _drawerList();
  try{if(!_drawer.panel.contains(document.activeElement))_drawer.panel.focus({preventScroll:true})}catch(e){}
  return true;
}
function _drawerList(){
  _drawerLeave();
  _drawer.title.textContent='Drawer';_drawer.back.style.visibility='hidden';
  var tools=_drawerToolList(),b=_drawer.body;
  b.innerHTML='';b.scrollTop=0;
  if(!tools.length){
    b.appendChild(_drwEl('div',{cls:'drw-empty'},[_drwEl('div',{cls:'drw-empty-i',text:'🧰'}),_drwEl('p',{text:'No tools in the drawer yet.'}),_drwEl('p',{cls:'drw-dim',text:'Tools that edit sounds, music, sprites, maps and game rules appear here. They write readable blocks into the program, which you can also edit by hand.'})]));
  }else{
    var grid=_drwEl('div',{cls:'drw-cards',role:'list'});
    tools.forEach(function(t){
      grid.appendChild(_drwEl('button',{cls:'drw-card',role:'listitem','data-tool':t.id,on:{click:function(){_drawerTool(t)}}},[
        _drwEl('span',{cls:'drw-ic','aria-hidden':'true',text:t.icon||'🔧'}),
        _drwEl('span',{cls:'drw-ct'},[_drwEl('span',{cls:'drw-cl',text:t.label||t.id}),_drwEl('span',{cls:'drw-cd',text:t.desc||''})])]));
    });
    b.appendChild(grid);
    b.appendChild(_drwEl('p',{cls:'drw-dim drw-note',text:'Each tool edits blocks of your program (sound coin: …). The text is the only copy: edit it by hand any time, the tool reads it back.'}));
  }
  try{var f=b.querySelector('button');if(f&&window.innerWidth>600)f.focus()}catch(e){}
}
function _drawerConfirmLeave(){
  if(!_drawer.tool||!_drawer.dirty)return true;
  return window.confirm('Discard the unsaved changes in '+(_drawer.tool.label||_drawer.tool.id)+'?');
}
// Leaves the open tool (no question asked: callers ask first)
function _drawerLeave(){
  var fns=_drawer.leave;_drawer.leave=[];
  fns.forEach(function(f){try{f()}catch(e){}});
  _drawer.tool=null;_drawer.dirty=false;_drawer.ctx=null;
  if(_drawer.body){_drawer.body.innerHTML='';_drawer.foot.innerHTML=''}
}
function _drawerClose(){
  if(!_drawerIsOpen())return true;
  if(!_drawerConfirmLeave())return false;
  _drawerLeave();
  _drawer.el.classList.remove('show');
  return true;
}
function _drawerBack(){
  if(!_drawerConfirmLeave())return false;
  _drawerList();
  return true;
}
function _drawerToast(text){
  var t=_drawer.toastEl;if(!t)return;
  t.textContent=String(text);t.classList.add('show');
  clearTimeout(_drawer.toastT);_drawer.toastT=setTimeout(function(){t.classList.remove('show')},2600);
}
function _drawerTool(t){
  if(typeof t.go==='function'){   // a card that goes somewhere else (the Memory tab): close the drawer, then go
    _drawerLeave();if(_drawer.el)_drawer.el.classList.remove('show');
    try{t.go()}catch(e){}
    return null;
  }
  _drawerLeave();
  _drawer.el.classList.add('show');
  _drawer.tool=t;_drawer.back.style.visibility='visible';
  _drawer.title.textContent=t.label||t.id;
  _drawer.body.scrollTop=0;
  var mine=t,ctx={
    body:_drawer.body,footer:_drawer.foot,tool:t,
    title:function(s){if(_drawer.tool===mine)_drawer.title.textContent=String(s)},
    close:function(){return _drawerClose()},
    setDirty:function(on){if(_drawer.tool===mine)_drawer.dirty=!!on},
    toast:function(s){_drawerToast(s)},
    blocks:function(k){return _drawerBlocks(k)},
    read:function(k,n){return _drawerRead(k,n)},
    write:function(k,n,text,file){return _drawerWrite(k,n,text,file)},
    remove:function(k,n){return _drawerRemove(k,n)},
    files:function(){_projSync();return _proj.files.map(function(f){return f.path})},
    run:function(){if(!_drawerClose())return null;if(window.innerWidth<768)showView('run');return compileAndRun()},
    onClose:function(fn){if(typeof fn==='function'&&_drawer.tool===mine)_drawer.leave.push(fn)}
  };
  _drawer.ctx=ctx;
  try{
    var r=t.open(ctx);
    if(typeof r==='function')ctx.onClose(r);
  }catch(e){
    _drawer.body.appendChild(_drwEl('p',{cls:'drw-err',text:'This tool could not open: '+((e&&e.message)||e)}));
  }
  return ctx;
}
// ── Blocks in the program text ──
// For each line of `src`: the 0-based index of every block header line → {kind, name, end (0-based last line)}.
// Lines inside /* */ comments or strings are not looked at; the lines of a block are not read as code.
function _drawerScan(src,kindWanted){return _emitScanBlocks(src,kindWanted)}   // (the scanner is in the compiler: BLOCKS)
function _drawerBlocks(kind){
  kind=String(kind||'').toLowerCase();_projSync();   /* kinds and names are case-insensitive: Sprite Hero: is sprite hero */
  var out=[];
  _proj.files.forEach(function(f){
    var lines=null;
    _drawerScan(f.source,kind).forEach(function(b){
      if(b.kind!==kind)return;
      lines=lines||f.source.split('\n');
      out.push({kind:kind,name:b.name,path:f.path,startLine:b.start+1,endLine:b.end+1,text:lines.slice(b.start,b.end+1).join('\n')});
    });
  });
  return out;
}
function _drawerFindBlock(kind,name){
  name=name==null?'':String(name);
  var l=_drawerBlocks(kind);
  for(var i=0;i<l.length;i++)if(l[i].name===name)return l[i];
  for(i=0;i<l.length;i++)if(l[i].name.toLowerCase()===name.toLowerCase())return l[i];
  return null;
}
function _drawerRead(kind,name){var b=_drawerFindBlock(kind,name);return b?b.text:null}
// Puts new text into file i: the textarea if it is the open file (with an undo step and the cursor kept on the
// same text), the file's own undo history otherwise.
function _drawerSetSource(i,src){
  var f=_proj.files[i];if(!f)return;
  var o=f.source,p=0,q=0,lo=o.length,ln=src.length;
  while(p<lo&&p<ln&&o.charCodeAt(p)===src.charCodeAt(p))p++;
  while(q<lo-p&&q<ln-p&&o.charCodeAt(lo-1-q)===src.charCodeAt(ln-1-q))q++;
  var a=p,b=lo-q,n=ln-q-p;
  function mv(x){return x>=b?x+n-(b-a):x>a?a:x}
  if(i===_proj.active){
    var s=ed.selectionStart,e=ed.selectionEnd,top=ed.scrollTop;
    _projSnap();
    ed.value=src;
    try{ed.setSelectionRange(mv(s),mv(e))}catch(x){}
    ed.scrollTop=top;
    f.source=src;
    _projSnap();
    updGutter();hlCode();syncScroll();try{updCurPos()}catch(x){}
  }else{
    if(!f.undo)f.undo=[{v:f.source,s:f.s,e:f.e,t:false}];
    f.source=src;f.s=mv(f.s);f.e=mv(f.e);
    f.undo.push({v:src,s:f.s,e:f.e,t:false});f.redo=[];
  }
  _projDirty();_projSaveSoon();_projTabs();
}
// Replaces block (kind, name) in place, or appends it (after a blank line) to preferredFile / the kind's file,
// creating that file when the project has none. → {path, startLine}
function _drawerWrite(kind,name,text,preferredFile){
  kind=String(kind);name=name==null?'':String(name);
  text=String(text==null?'':text).replace(/\r\n?/g,'\n').replace(/\n+$/,'');
  var b=_drawerFindBlock(kind,name);
  if(b){
    var i=_projFind(b.path),f=_proj.files[i],lines=f.source.split('\n');
    lines.splice(b.startLine-1,b.endLine-b.startLine+1,text);
    _drawerSetSource(i,lines.join('\n'));
    return{path:b.path,startLine:b.startLine};
  }
  var path=String(preferredFile||_DRAWER_FILES[kind]||'blocks.emit');
  if(!/\.emit$/.test(path))path+='.emit';
  var fi=_projFind(path);
  if(fi<0){
    if(!_emitPathOk(path))throw new Error('Invalid file path "'+path+'"');
    _proj.files.push({path:path,source:'',s:0,e:0,top:0,left:0});
    fi=_proj.files.length-1;
  }
  var src=_proj.files[fi].source,base=src.replace(/\s+$/,''),pre=base?base+'\n\n':'',nsrc=pre+text+'\n';
  var start=pre?pre.split('\n').length:1;
  _drawerSetSource(fi,nsrc);
  return{path:path,startLine:start};
}
// Removes block (kind, name) and the blank line in front of it. → true when there was one.
function _drawerRemove(kind,name){
  var b=_drawerFindBlock(kind,name);if(!b)return false;
  var i=_projFind(b.path),f=_proj.files[i],lines=f.source.split('\n'),s=b.startLine-1,n=b.endLine-b.startLine+1;
  if(s>0&&/^[ \t]*$/.test(lines[s-1])){s--;n++}
  else if(s===0&&b.endLine<lines.length&&/^[ \t]*$/.test(lines[b.endLine]))n++;
  lines.splice(s,n);
  _drawerSetSource(i,lines.join('\n'));
  return true;
}
// A block's text without its "kind name:" header (what the parsers take)
function _drawerBody(text,kind){var m=new RegExp('^'+kind+'(?:[ \\t]+[A-Za-z_][A-Za-z0-9_]*)?[ \\t]*:','i').exec(text);return m?text.substring(m[0].length):text}
// play() / music() of the tools and of other tools' previews, while no program is running
_sndResolve=function(kind,name){
  if(kind!=='sound'&&kind!=='music')return null;
  var t=_drawerRead(kind,name);if(t===null)return null;
  return kind==='sound'?_sndParse(_drawerBody(t,'sound')).spec:_musParse(_drawerBody(t,'music')).spec;
};
doExport=(function(f){return function(fmt){if(fmt==='drawer'){_drawerOpen();return}return f.apply(this,arguments)}})(doExport);
// Run pressed (a user gesture) on a program with sound / music blocks: make and resume the AudioContext now, inside
// the gesture, so that phones that only unlock audio there play the first sound too.
compileAndRun=(function(f){return function(){
  try{var t=_projText();if(/(^|\n)(sound|music)[ \t]+[A-Za-z_]\w*[ \t]*:/i.test(t)){_sndWant=true;if(_sndUnlocked)_sndUnlock()}}catch(e){}
  return f.apply(this,arguments);
}})(compileAndRun);
stopProgram=(function(f){return function(){_musicStop();return f.apply(this,arguments)}})(stopProgram);
// ── Tool UI helpers (shared by the drawer tools; optional for others) ──
// _drwBtn(label, onclick, cls) · _drwSeg(options [[value,label]], get, set) · _drwSlider({label,min,max,step,get,set,fmt,toPos,fromPos})
function _drwBtn(label,fn,cls,title){return _drwEl('button',{cls:'drw-btn'+(cls?' '+cls:''),type:'button',text:label,title:title||null,'aria-label':title||null,on:{click:function(e){fn(e)}}})}
function _drwSeg(opts,get,set,label){
  var box=_drwEl('div',{cls:'drw-seg',role:'radiogroup','aria-label':label||null});
  function paint(){var v=get();Array.prototype.forEach.call(box.children,function(b){var on=b.getAttribute('data-v')===String(v);b.classList.toggle('on',on);b.setAttribute('aria-checked',on?'true':'false')})}
  opts.forEach(function(o){box.appendChild(_drwEl('button',{type:'button',role:'radio','data-v':String(o[0]),text:o[1],on:{click:function(){set(o[0]);paint()}}}))});
  box.paint=paint;paint();return box;
}
// A labelled range with a number box. o: {label, min, max, step, get(), set(v, done), fmt(v) → text for the box,
// parse(text) → value, toPos(v)/fromPos(p) for a non-linear range (positions 0..1000), unit}
function _drwSlider(o){
  var id='drw'+(++_drwSlider.n);
  var pos=o.toPos?{min:0,max:1000,step:1}:{min:o.min,max:o.max,step:o.step||1};
  var r=_drwEl('input',{type:'range',id:id,min:String(pos.min),max:String(pos.max),step:String(pos.step),'aria-label':o.label});
  var box=_drwEl('input',{type:'text',inputmode:'decimal',cls:'drw-num','aria-label':o.label+' value',autocomplete:'off',spellcheck:'false'});
  var row=_drwEl('div',{cls:'drw-sl'},[_drwEl('label',{'for':id,text:o.label}),r,box,o.unit?_drwEl('span',{cls:'drw-unit',text:o.unit}):null]);
  function fmt(v){return o.fmt?o.fmt(v):String(v)}
  row.paint=function(){var v=o.get();r.value=String(o.toPos?o.toPos(v):v);if(document.activeElement!==box)box.value=fmt(v)};
  r.addEventListener('input',function(){var p=+r.value,v=o.fromPos?o.fromPos(p):p;o.set(v,false);box.value=fmt(o.get())});
  r.addEventListener('change',function(){o.set(o.get(),true)});
  box.addEventListener('change',function(){var t=box.value.trim(),v=o.parse?o.parse(t):parseFloat(t);if(v===null||v===undefined||isNaN(v)){row.paint();return}v=Math.max(o.min,Math.min(o.max,v));o.set(v,true);row.paint()});
  row.paint();return row;
}
_drwSlider.n=0;
// Name of a new block: base, base2, base3 … not in `taken`
function _drwFreeName(base,taken){var n=base,i=2;while(taken.indexOf(n)>=0)n=base+(i++);return n}
function _drwNameOk(n){return/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)&&!KW.has(n)&&!TY.has(n)}
// The "kept as is" list: parts of a block the tool does not understand. items [{text, keep}], onChange()
function _drwKept(items,onChange){
  var box=_drwEl('div',{cls:'drw-kept'});
  var live=items.filter(function(p){return p.keep!==false});
  if(!live.length)return box;
  box.appendChild(_drwEl('div',{cls:'drw-lab',text:'Kept as is (not understood by this tool, written back unchanged)'}));
  live.forEach(function(p){
    var row=_drwEl('div',{cls:'drw-krow'},[_drwEl('code',{text:p.text+(p.msg&&p.msg!=='unknown'?'  — '+p.msg:'')}),_drwBtn('×',function(){p.keep=false;row.remove();onChange()},'drw-sm','Drop this part')]);
    box.appendChild(row);
  });
  return box;
}

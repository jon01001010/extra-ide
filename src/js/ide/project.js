// ═══ PROJECT: several files in one program ═══
// _proj is the single source of truth: files[0] is the ENTRY file, `active` is the file shown in the
// textarea. The textarea holds the newest text of the active file; _projSync() copies it (with cursor
// and scroll position) back into the model, and everything that reads the whole program calls
// _projText(), which syncs first and returns the BUNDLE: the files joined by "//// file: <path>" marker
// lines (_emitJoinBundle). A project of one file named main.emit has no marker, so its bundle is the
// plain source text — single-file programs are stored, shared and compiled exactly as before.
// Everything that replaces the whole program calls _projLoad(text), which splits a bundle into tabs.
//
// Rule for code that writes the textarea directly (tests, scripts, bookmarklets):
//   ed.value = text; ed.dispatchEvent(new Event('input'))
// - text contains a "//// file: " marker line -> it is a whole bundle: the project is replaced by it;
// - otherwise it is the new text of the ACTIVE file only (on a fresh page: of the single file).
// A real paste of a bundle is treated the same way while the project has one file; typed marker lines
// (or a paste into a project of several files) stay text until the next Run, which splits them into
// tabs and says so in the Output — the marker is implied by the tab and never belongs to a file's text.


var _proj={files:[{path:'main.emit',source:'',s:0,e:0,top:0,left:0}],active:0};
var _PROJ_PATH_RE=/^[A-Za-z0-9_.\/-]+\.emit$/;
// 1-based numbers of the lines of `text` that are "//// file: <path>" marker lines (as _emitSplitBundle sees them)
function _projMarkerLines(text){
  var out=[];text=String(text);
  if(text.indexOf('//// file: ')<0)return out;
  var lines=text.split('\n');
  for(var i=0;i<lines.length;i++){
    if(lines[i].indexOf('//// file: ')!==0)continue;
    try{var f=_emitSplitBundle(lines[i]);if(!(f.length===1&&f[0].source===lines[i]))out.push(i+1)}catch(e){}
  }
  return out;
}
function _projIsBundle(text){return _projMarkerLines(text).length>0}
// More than the one unnamed file of a single-file program? (decides whether the tab strip is shown)
function _projMulti(){return _proj.files.length>1||_proj.files[0].path!=='main.emit'}
function _projFind(path){for(var i=0;i<_proj.files.length;i++)if(_proj.files[i].path===path)return i;return -1}
function _projBase(p){return p.substring(p.lastIndexOf('/')+1)}
// textarea -> model (text, selection, scroll position of the active file)
function _projSync(){
  var f=_proj.files[_proj.active];if(!f)return;
  f.source=ed.value;f.s=ed.selectionStart;f.e=ed.selectionEnd;f.top=ed.scrollTop;f.left=ed.scrollLeft;
}
// The whole program as one text (the bundle)
function _projText(){
  _projSync();
  return _emitJoinBundle(_proj.files.map(function(f){return{path:f.path,source:f.source}}));
}
// Replace the whole program. `active` (optional) is the index of the file to show; default: the entry file.
function _projLoad(text,active){
  text=String(text==null?'':text).replace(/\r\n?/g,'\n');
  var files=null;try{files=_emitSplitBundle(text)}catch(e){}
  if(!files||!files.length)files=[{path:'main.emit',source:text}];
  _proj.files=files.map(function(f){return{path:String(f.path),source:String(f.source),s:0,e:0,top:0,left:0}});
  _proj.active=-1;
  _projDirty();
  _projShow(active>0&&active<_proj.files.length?active:0);
}
// model -> textarea for file i (no stash of the previous file: see _projSetActive)
function _projShow(i){
  var f=_proj.files[i];if(!f)return;
  _proj.active=i;
  ed.value=f.source;
  try{ed.setSelectionRange(f.s,f.e)}catch(e){}
  updGutter();hlCode();
  ed.scrollTop=f.top;ed.scrollLeft=f.left;syncScroll();
  try{updCurPos();hideAC()}catch(e){}
  _projSnap();
  _projTabs();
}
// Switch tabs: stash the textarea into the current file, show file i with its own cursor/scroll/undo history
function _projSetActive(i){
  if(i===_proj.active||!_proj.files[i])return;
  _projSnap();_projSync();
  _projShow(i);
  _projSaveSoon();
}
// Autosave: the bundle under the old key (so code saved by earlier versions restores), the open tab under a new one
var _projSaveT=null;
function _projSave(){try{localStorage.setItem('emit-code',_projText());localStorage.setItem('emit-active',String(_proj.active))}catch(e){}}
function _projSaveSoon(){if(_projSaveT)clearTimeout(_projSaveT);_projSaveT=setTimeout(_projSave,250)}
function _projSavedActive(){try{return parseInt(localStorage.getItem('emit-active'))||0}catch(e){return 0}}
// The editor's `input` handler calls this first. Returns true when the text was taken as a whole bundle.
function _projOnInput(e){
  var t=e&&e.inputType,v=ed.value;
  if(v.indexOf('//// file: ')>=0&&_projIsBundle(v)){
    // set by a script (no inputType), or pasted/dropped into a single-file project: the text is a bundle
    if(!t||((t==='insertFromPaste'||t==='insertFromDrop')&&_proj.files.length===1)){_projLoad(v);return true}
  }
  _projDirty();_projSnap();
  return false;
}
// Entry file text, for `use` lines the 📚 panel adds
function _projEntrySource(){_projSync();return _proj.files[0].source}
function _projSetEntrySource(src){
  _projSync();_proj.files[0].source=src;
  if(_proj.active===0){ed.value=src;ed.selectionStart=ed.selectionEnd=0;updGutter();hlCode();_projSnap()}
  _projDirty();_projSaveSoon();
}

// ── Undo per file ──
// Replacing textarea.value (a tab switch, and also the editor's own Enter/Tab handling) clears the browser's
// undo history, so each file keeps its own list of states: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y and the ↶ ↷ keys
// of the key bar. A burst of typing (pauses under 0.7 s, at most 3 s) is one step. The list is capped by
// size (about 3 million characters per file), and it is not saved: it starts empty after a reload.
function _projSnap(){
  var f=_proj.files[_proj.active];if(!f)return;
  var v=ed.value,now=Date.now(),s=ed.selectionStart,e=ed.selectionEnd;
  if(!f.undo){f.undo=[{v:v,s:s,e:e,t:false}];f.redo=[];f.ut=0;f.ub=0;return}
  var top=f.undo[f.undo.length-1];
  if(top.v===v){top.s=s;top.e=e;return}
  var small=Math.abs(v.length-top.v.length)<=2;
  if(small&&top.t&&f.undo.length>1&&now-f.ut<700&&now-f.ub<3000){top.v=v;top.s=s;top.e=e}
  else{
    f.undo.push({v:v,s:s,e:e,t:small});f.ub=now;
    var cap=Math.max(8,Math.min(150,Math.floor(3e6/(v.length+1))));
    while(f.undo.length>cap)f.undo.shift();
  }
  f.ut=now;f.redo=[];
}
function _projUndo(redo){
  var f=_proj.files[_proj.active];if(!f)return false;
  _projSnap();
  if(redo){if(!f.redo.length)return false;f.undo.push(f.redo.pop())}
  else{if(f.undo.length<2)return false;f.redo.push(f.undo.pop())}
  var st=f.undo[f.undo.length-1];st.t=false;
  ed.value=st.v;try{ed.setSelectionRange(st.s,st.e)}catch(e){}
  updGutter();hlCode();try{updCurPos();hideAC()}catch(e){}
  _projDirty();_projSaveSoon();
  return true;
}
ed.addEventListener('keydown',function(e){
  if(!(e.ctrlKey||e.metaKey)||e.altKey)return;
  var k=(e.key||'').toLowerCase();
  if(k==='z'){e.preventDefault();_projUndo(e.shiftKey)}
  else if(k==='y'){e.preventDefault();_projUndo(true)}
});
ed.addEventListener('keyup',function(){_projDirty();_projSnap()});

// ── File tabs ──
function _projTabs(){
  var el=document.getElementById('fileTabs');if(!el)return;
  if(!_projMulti()){el.classList.remove('show');el.innerHTML='';return}
  var names=_proj.files.map(function(f){return _projBase(f.path)}),html='';
  _proj.files.forEach(function(f,i){
    var dup=names.indexOf(names[i])!==names.lastIndexOf(names[i]);
    html+='<div class="ftab'+(i===_proj.active?' active':'')+(i===0?' entry':'')+(f.err?' haserr':'')+'" role="tab" tabindex="0" aria-selected="'+(i===_proj.active)+'" data-i="'+i+'" title="'+escH(f.path)+(i===0?' (entry file)':'')+(f.err?' — has errors':'')+'">'
      +(i===0?'<span class="ftab-e" aria-label="entry file">▶</span>':'')
      +'<span class="ftab-n">'+escH(dup?f.path:names[i])+'</span>'
      +(f.err?'<span class="ftab-err" aria-label="has errors"></span>':'')
      +(i===_proj.active?'<span class="ftab-m" role="button" aria-label="File actions" title="File actions">⋯</span>':'')
      +'</div>';
  });
  html+='<button class="ftab-add" onclick="_projAddFile()" title="New file" aria-label="New file">+</button>';
  el.innerHTML=html;el.classList.add('show');
  var a=el.querySelector('.ftab.active');
  if(a){
    if(a.offsetLeft<el.scrollLeft)el.scrollLeft=a.offsetLeft;
    else{
      var room=el.clientWidth-el.querySelector('.ftab-add').offsetWidth;   // the + button stays at the right edge
      if(a.offsetLeft+a.offsetWidth>el.scrollLeft+room)el.scrollLeft=a.offsetLeft+a.offsetWidth-room;
    }
  }
}
// Tap = switch; ⋯ on the active tab, a long press or a right click on any tab = actions
(function(){
  var el=document.getElementById('fileTabs');if(!el)return;
  var timer=null,held=false,x0=0,y0=0;
  function idx(t){var tab=t&&t.closest?t.closest('.ftab'):null;return tab?parseInt(tab.getAttribute('data-i')):-1}
  function stop(){if(timer){clearTimeout(timer);timer=null}}
  el.addEventListener('click',function(e){
    if(held){held=false;e.preventDefault();return}
    var i=idx(e.target);if(i<0)return;
    if(e.target.closest('.ftab-m')){_projMenu(i);return}
    if(i!==_proj.active)_projSetActive(i);
  });
  el.addEventListener('keydown',function(e){if((e.key==='Enter'||e.key===' ')&&idx(e.target)>=0&&e.target.classList.contains('ftab')){e.preventDefault();if(idx(e.target)===_proj.active)_projMenu(_proj.active);else _projSetActive(idx(e.target))}});
  el.addEventListener('pointerdown',function(e){
    var i=idx(e.target);held=false;stop();if(i<0)return;
    x0=e.clientX;y0=e.clientY;
    timer=setTimeout(function(){timer=null;held=true;_projMenu(i,true)},550);
  });
  ['pointerup','pointercancel','pointerleave'].forEach(function(n){el.addEventListener(n,stop)});
  el.addEventListener('pointermove',function(e){if(timer&&(Math.abs(e.clientX-x0)>8||Math.abs(e.clientY-y0)>8))stop()});
  el.addEventListener('contextmenu',function(e){var i=idx(e.target);if(i<0)return;e.preventDefault();stop();if(!document.getElementById('projSheet').classList.contains('show'))_projMenu(i,true)});
})();
// A list of large buttons at the bottom of the screen (centred on wide screens). items: [{label, fn, danger}]
var _projSheetAt=0;
function _projSheet(title,items,guard){
  var bg=document.getElementById('projSheet');if(!bg)return;
  var html='<div class="fsheet" role="dialog"><div class="fsheet-t">'+escH(title)+'</div>';
  items.forEach(function(it,i){html+='<button data-k="'+i+'"'+(it.danger?' class="danger"':'')+'>'+escH(it.label)+'</button>'});
  html+='<button data-k="-1">Cancel</button></div>';
  bg.innerHTML=html;bg.classList.add('show');
  _projSheetAt=guard?Date.now():0;   // opened by a long press: ignore the tap that ends the press
  bg.onclick=function(e){
    if(Date.now()-_projSheetAt<350)return;
    var b=e.target.closest?e.target.closest('button'):null;
    if(!b&&e.target!==bg)return;
    _projSheetClose();
    if(b){var k=parseInt(b.getAttribute('data-k'));if(k>=0&&items[k])items[k].fn()}
  };
}
function _projSheetClose(){var bg=document.getElementById('projSheet');if(bg){bg.classList.remove('show');bg.innerHTML='';bg.onclick=null}}
function _projMenu(i,guard){
  var f=_proj.files[i];if(!f)return;
  var items=[];
  if(i!==_proj.active)items.push({label:'Open',fn:function(){_projSetActive(i)}});
  items.push({label:'Rename…',fn:function(){_projRename(i)}});
  if(i!==0)items.push({label:'Make entry file (runs first)',fn:function(){_projMakeEntry(i)}});
  items.push({label:'Delete',danger:true,fn:function(){_projDelete(i)}});
  items.push({label:'+ New file…',fn:function(){_projAddFile()}});
  _projSheet(f.path+(i===0?'  — entry file':''),items,guard);
}
// '' when `path` can be a file of the project, else the reason. `except`: index of the file being renamed.
function _projPathError(path,except){
  if(!path)return'Enter a file name such as name.emit';
  if(!_PROJ_PATH_RE.test(path))return'"'+path+'" is not a valid file path. Use letters, digits, _ - . and / (for folders), ending in .emit — for example game/physics.emit';
  var parts=path.split('/');
  for(var k=0;k<parts.length;k++)if(!parts[k]||parts[k]==='.'||parts[k]==='..'||parts[k]==='.emit')return'"'+path+'" is not a valid file path: every folder and the file need a name (no / at the start, no //, no . or ..)';
  for(var i=0;i<_proj.files.length;i++)if(i!==except&&_proj.files[i].path===path)return'This project already has a file named '+path;
  return'';
}
// Can other files `import` it? game/physics.emit -> module game.physics: every part must be an identifier
function _projImportable(path){return path.replace(/\.emit$/,'').split('/').every(function(s){return/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)})}
function _projCheckPath(p,except,isEntry){
  p=String(p==null?'':p).trim();
  if(p&&!/\.[A-Za-z0-9]+$/.test(p))p+='.emit';   // "physics" -> "physics.emit"
  var err=_projPathError(p,except);
  if(err){alert(err);return null}
  if(!isEntry&&!_projImportable(p)&&!confirm(p+' can be a file of this project, but other files cannot import it: a module name is made of letters, digits and _ (game/physics.emit is the module game.physics).\n\nUse this name anyway?'))return null;
  return p;
}
function _projNewSource(path){
  var parts=path.replace(/\.emit$/,'').split('/'),name=parts.pop();
  return(parts.length?'package '+parts.join('.')+'\n\n':'')+'// public fn hello() int { return 1 }   // other files: import '+parts.concat(name).join('.')+'\n';
}
// Add a file (asks for the path when none is given) and open it. Returns its index, or -1.
function _projAddFile(path){
  if(path===undefined){
    var def='name.emit',n=2;while(_projFind(def)>=0)def='name'+(n++)+'.emit';
    path=prompt('New file in this project.\nPath (letters, digits, _ - . and / for folders), ending in .emit:',def);
    if(path===null)return -1;
  }
  path=_projCheckPath(path,-1,false);if(path===null)return -1;
  _projSnap();_projSync();
  _proj.files.push({path:path,source:_projNewSource(path),s:0,e:0,top:0,left:0});
  _projDirty();
  _projShow(_proj.files.length-1);
  _projSaveSoon();
  if(window.innerWidth<768)showView('edit');
  return _proj.active;
}
function _projRename(i,path){
  var f=_proj.files[i];if(!f)return false;
  if(path===undefined){path=prompt('Rename '+f.path+' to:',f.path);if(path===null)return false}
  path=_projCheckPath(path,i,i===0);if(path===null)return false;
  if(path===f.path)return true;
  f.path=path;
  _projDirty();_projTabs();_projSaveSoon();
  return true;
}
function _projDelete(i){
  var f=_proj.files[i];if(!f)return false;
  if(_proj.files.length===1){alert('A project needs at least one file. Use + (New) in the header to start over.');return false}
  if(i===0){alert(f.path+' is the entry file: the program starts there, so it cannot be deleted while the project has other files.\n\nFirst choose "Make entry file" on another tab.');return false}
  if(!confirm('Delete '+f.path+'? Its text is removed from the project and cannot be restored.'))return false;
  _projSnap();_projSync();
  var act=_proj.active;
  _proj.files.splice(i,1);
  _projDirty();
  if(act===i){_proj.active=-1;_projShow(Math.min(i,_proj.files.length-1))}
  else{if(act>i)_proj.active=act-1;_projTabs()}
  _projSaveSoon();
  return true;
}
function _projMakeEntry(i){
  if(i<=0||!_proj.files[i])return false;
  _projSync();
  var act=_proj.active,f=_proj.files.splice(i,1)[0];
  _proj.files.unshift(f);
  _proj.active=act===i?0:(act<i?act+1:act);
  _projDirty();_projTabs();_projSaveSoon();
  return true;
}
// Desktop: Ctrl+PageUp / Ctrl+PageDown or Alt+← / Alt+→ switch tabs; Escape closes the action sheet
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'&&document.getElementById('projSheet').classList.contains('show')){_projSheetClose();return}
  var d=0;
  if(e.ctrlKey&&!e.altKey&&!e.shiftKey&&!e.metaKey){if(e.key==='PageUp')d=-1;else if(e.key==='PageDown')d=1}
  else if(e.altKey&&!e.ctrlKey&&!e.shiftKey&&!e.metaKey){if(e.key==='ArrowLeft')d=-1;else if(e.key==='ArrowRight')d=1}
  if(!d||_proj.files.length<2)return;
  e.preventDefault();
  var n=_proj.files.length;
  _projSetActive((_proj.active+d+n)%n);
  ed.focus();
});

// ── Running: source, `use` lines, errors across files ──
var _projNotes=[];
// What Run compiles. A file whose text contains marker lines is split into tabs first (with a note for the Output).
function _projRunSource(){
  _projNotes=[];
  _projSync();
  var hit=[];
  _proj.files.forEach(function(f){var ml=_projMarkerLines(f.source);if(ml.length)hit.push(f.path+' line '+ml.join(', '))});
  if(hit.length){
    var path=_proj.files[_proj.active].path;
    _projLoad(_projText());
    var i=_projFind(path);if(i>0)_projShow(i);
    _projNotes.push('⚠ A "//// file: …" line starts a new file of the project, so it cannot be part of a file’s text ('+hit.join('; ')+'). The text below each such line is now a file with its own tab. To add a file use + in the tab strip, or File → New file in project.');
    _projSaveSoon();
  }
  _projMarkErrors([]);
  return _projText();
}
function _projWarnHtml(){return _projNotes.map(function(n){return sp('warn',n)+'\n'}).join('')}
// "3 files, " in front of the stats line of a project with several files
function _projStats(r){return _proj.files.length>1?_proj.files.length+' files, ':''}
// `use` lines of every file. In a bundle the line number of a bad use line is reported as path:line:1.
function _projUses(source){
  if(!_projIsBundle(source))return _parseUses(source);
  var all=[];
  _emitSplitBundle(source).forEach(function(f){
    try{_parseUses(f.source).forEach(function(u){u.file=f.path;all.push(u)})}
    catch(e){if(e&&e.isLibError&&/^\d+:1: /.test(e.message))e.message=f.path+':'+e.message;throw e}
  });
  return all;
}
// "game/physics.emit:12:3: message" (anywhere in the text) -> {path,line,col} when that file is in the project
function _projErrRef(msg){
  var m=String(msg).match(/(?:^|[^A-Za-z0-9_.\/-])([A-Za-z0-9_.\/-]+\.emit):(\d+):(\d+)/);
  if(!m||_projFind(m[1])<0)return null;
  return{path:m[1],line:+m[2],col:+m[3]};
}
function _projErrSpan(ref,text){return'<span class="err clickable-err" onclick="_projJump(\''+ref.path+'\','+ref.line+','+ref.col+')">'+h(text)+'</span>'}
// Mark the tabs of the files named in these error messages; an empty list clears the marks
function _projMarkErrors(list){
  var bad={},ch=false;
  (list||[]).forEach(function(e){var r=_projErrRef(e);if(r)bad[r.path]=1});
  _proj.files.forEach(function(f){var b=!!bad[f.path];if(!!f.err!==b){f.err=b;ch=true}});
  if(ch)_projTabs();
}
// Open `path` and go to line (1-based). With len: select len characters from column col instead of the line.
function _projJump(path,line,col,len){
  var i=_projFind(path);if(i<0)return;
  if(i!==_proj.active)_projSetActive(i);
  var lines=ed.value.split('\n');
  line=Math.max(1,Math.min(parseInt(line)||1,lines.length));
  jumpToLine(line);
  if(len>0&&col>0){
    var pos=0;for(var k=0;k<line-1;k++)pos+=lines[k].length+1;
    pos+=Math.min(col-1,lines[line-1].length);
    try{ed.setSelectionRange(pos,Math.min(pos+len,ed.value.length))}catch(e){}
  }
  var lh=parseFloat(getComputedStyle(ed).lineHeight)||20,y=(line-1)*lh;
  if(y<ed.scrollTop||y>ed.scrollTop+ed.clientHeight-lh*2)ed.scrollTop=Math.max(0,y-ed.clientHeight/3);
  syncScroll();updCurPos();
}

// ── Autocomplete for modules ──
// _emitModuleIndex(bundle) is cached. It is recomputed when the text changed, at most once per 400 ms;
// while typing faster than that (and always for projects over 200 KB) the old index answers and the new
// one is built after 400 ms without a keystroke, then the popup is refreshed.
var _projIdx=null,_projIdxDirty=true,_projIdxAt=0,_projIdxT=null,_projIdxRuns=0;
function _projDirty(){_projIdxDirty=true}
function _projIndexNow(){
  var idx=null;
  try{idx=_emitModuleIndex(_projText())}catch(e){}
  if(!idx||!idx.modules||typeof idx.modules!=='object')idx={entry:null,modules:{}};
  _projIdx=idx;_projIdxDirty=false;_projIdxAt=Date.now();_projIdxRuns++;
  return idx;
}
function _projIndex(){
  if(_projIdx&&!_projIdxDirty)return _projIdx;
  var size=ed.value.length;
  _proj.files.forEach(function(f,i){if(i!==_proj.active)size+=f.source.length});
  if(size<=200000&&Date.now()-_projIdxAt>=400)return _projIndexNow();
  if(_projIdxT)clearTimeout(_projIdxT);
  _projIdxT=setTimeout(function(){
    _projIdxT=null;_projIndexNow();
    try{if(document.activeElement===ed)checkAC()}catch(e){}
  },400);
  return _projIdx||{entry:null,modules:{}};
}
function _projHasImports(){return/(^|\n)[ \t]*import[ \t]+[A-Za-z_]/.test(ed.value)}
function _projCurModule(idx){
  var f=_proj.files[_proj.active],p=f?f.path:'';
  for(var k in idx.modules)if(idx.modules[k]&&idx.modules[k].path===p)return idx.modules[k];
  return null;
}
// What the imports of the active file bring in: quals {alias -> module name} for `import a.b [as x]`,
// names {name -> {mod, pub}} for `import a.b.name` and `import a.b.*`
function _projScope(idx){
  var cur=_projCurModule(idx),quals={},names={};
  ((cur&&cur.imports)||[]).forEach(function(im){
    if(!im||!im.module)return;
    var mod=idx.modules[im.module],pubs=(mod&&mod.publics)||[];
    if(im.star){pubs.forEach(function(p){names[p.name]={mod:im.module,pub:p}});return}
    if(im.names&&im.names.length){
      im.names.forEach(function(n){
        var pub=null;pubs.forEach(function(p){if(p.name===n)pub=p});
        names[(im.names.length===1&&im.alias)||n]={mod:im.module,pub:pub||{name:n,kind:'var'}};
      });
      return;
    }
    quals[im.alias||im.module.substring(im.module.lastIndexOf('.')+1)]=im.module;
  });
  return{quals:quals,names:names};
}
function _projPubDesc(p,modName){
  if(p.kind==='fn')return'fn('+(p.params||[]).map(function(a){return a.name+(a.type?': '+a.type:'')}).join(', ')+')'+(p.returnType&&p.returnType!=='void'?' '+p.returnType:'')+' · '+modName;
  return(p.mutable?'mut':'let')+(p.type?' '+p.type:'')+' · '+modName;
}
function _projPubItem(p,modName,call){return{name:escH(p.name),desc:escH(_projPubDesc(p,modName)),_libac:'member',_projac:true,_ins:p.name+(call&&p.kind==='fn'?'(':'')}}
// Called from checkAC before the library sources, so an import alias wins over a library global of the
// same name. Returns true when it handled the position (popup shown, or deliberately none).
var _projACSel=0,_projACKey='';
// obj[key], or the value under a key that equals it ignoring case (names are case-insensitive) — for the editor's lookups
function _ncGet(obj,key){if(!obj||key==null)return undefined;if(Object.prototype.hasOwnProperty.call(obj,key))return obj[key];var k=String(key).toLowerCase();for(var n in obj)if(Object.prototype.hasOwnProperty.call(obj,n)&&n.toLowerCase()===k)return obj[n];return undefined}
function _ncKeyOf(obj,key){if(!obj||key==null)return key;if(Object.prototype.hasOwnProperty.call(obj,key))return key;var k=String(key).toLowerCase();for(var n in obj)if(Object.prototype.hasOwnProperty.call(obj,n)&&n.toLowerCase()===k)return n;return key}
function _projACCheck(before){
  _projACSel=acActive?acSel:0;   // checkAC rebuilds the popup from scratch; remember the selected row for _projACFallback
  try{
    var line=before.substring(before.lastIndexOf('\n')+1);
    var im=line.match(/^\s*import\s+([A-Za-z_][\w.]*)?$/i);
    if(im){
      var typed=im[1]||'';
      if(typed.toLowerCase()==='fn')return false;   // import fn name(...) from "module": a JS import, not a module
      var idx=_projIndex(),cur=_projCurModule(idx),lt=typed.toLowerCase(),items=[];
      Object.keys(idx.modules).sort().forEach(function(k){
        if(idx.modules[k]===cur||k===typed)return;
        var kl=k.toLowerCase(),at=kl.indexOf(lt);
        while(lt&&at>0&&kl.charAt(at-1)!=='.')at=kl.indexOf(lt,at+1);   // start of the name or of one of its parts
        if(lt&&at<0)return;
        items.push({name:escH(k),desc:'module · '+escH(idx.modules[k].path||''),_libac:'member',_projac:true,_ins:k,_rep:typed.length});
      });
      var dot=typed.lastIndexOf('.');
      if(dot>0){
        var mn=_ncKeyOf(idx.modules,typed.substring(0,dot)),part=typed.substring(dot+1).toLowerCase(),mod=idx.modules[mn];
        if(mod&&mod!==cur){
          var mem=[];
          (mod.publics||[]).forEach(function(p){if((!part||p.name.toLowerCase().indexOf(part)===0)&&p.name.toLowerCase()!==part)mem.push(_projPubItem(p,mn,false))});
          if(!part)mem.push({name:'*',desc:'every public name of '+escH(mn),_libac:'member',_projac:true,_ins:'*'});
          items=mem.concat(items);
        }
      }
      _builtinAC=false;_methodAC=false;
      if(!items.length){hideAC();return true}
      _libACShow(items,before,'pi:'+before.length+':'+typed);
      return true;
    }
    if(!_projHasImports())return false;
    var m=before.match(/(?:^|[^\w$.])([A-Za-z_]\w*)\.(\w*)$/);
    if(!m||_libInStrOrComment(before))return false;
    var ix=_projIndex(),mname=_ncGet(_projScope(ix).quals,m[1]);
    if(!mname)return false;
    var pubs=(ix.modules[mname]&&ix.modules[mname].publics)||[],p=m[2].toLowerCase(),pre=[],sub=[];
    pubs.forEach(function(pb){
      var at=p?pb.name.toLowerCase().indexOf(p):0;
      if(at===0)pre.push(pb);else if(at>0)sub.push(pb);
    });
    var list=pre.concat(sub);
    _builtinAC=false;_methodAC=false;
    if(!list.length||(list.length===1&&list[0].name===m[2])){hideAC();return true}
    _libACShow(list.slice(0,40).map(function(pb){return _projPubItem(pb,mname,true)}),before,'pm:'+before.length+':'+m[1]+'.'+m[2]);
    return true;
  }catch(e){return false}
}
// Runs last in checkAC: names brought in by `import a.b.name` / `import a.b.*` and the import aliases
// themselves join the identifier suggestions (in front of builtins and library globals).
function _projACFallback(before){
  try{
    if(!_projHasImports()||_libInStrOrComment(before))return;
    var wm=before.match(/(?:^|[^\w$.])([A-Za-z_]\w*)$/);
    if(!wm||wm[1].length<2)return;
    var lineText=before.substring(before.lastIndexOf('\n')+1).trimStart();
    if(/^(fn|export|use|import|package|public)\s/.test(lineText))return;
    if(/^(let|mut|const)\s/.test(lineText)&&lineText.indexOf('=')<0)return;
    var idx=_projIndex(),sc=_projScope(idx),w=wm[1].toLowerCase(),items=[];
    Object.keys(sc.names).forEach(function(n){
      if(n===wm[1]||n.toLowerCase().indexOf(w)!==0)return;
      var it=_projPubItem(sc.names[n].pub,sc.names[n].mod,true);
      it.name=escH(n);it._ins=n+(sc.names[n].pub.kind==='fn'?'(':'');
      items.push(it);
    });
    Object.keys(sc.quals).forEach(function(q){
      if(q===wm[1]||q.toLowerCase().indexOf(w)!==0)return;
      items.push({name:escH(q),desc:'module '+escH(sc.quals[q]),_libac:'member',_projac:true,_ins:q});
    });
    if(!items.length)return;
    var base=acActive?acItems.filter(function(it){return it._libac!=='hint'}):[];
    var key='pg:'+before.length+':'+wm[1],keep=key===_projACKey?Math.min(_projACSel,items.length+base.length-1):0;
    _projACKey=key;
    _libACShow(items.concat(base),before,key);
    if(keep>0&&acActive){acSel=keep;updACsel();_libACReveal()}
  }catch(e){}
}
// Picking a module name replaces the whole dotted path typed after `import`, not just its last word
var _libACPick0=_libACPick;
_libACPick=function(idx){
  var it=acItems[idx];
  _projDirty();
  if(!it||it._rep==null)return _libACPick0(idx);
  var pos=ed.selectionStart,start=Math.max(0,pos-it._rep);
  ed.value=ed.value.substring(0,start)+it._ins+ed.value.substring(pos);
  ed.selectionStart=ed.selectionEnd=start+it._ins.length;
  _builtinAC=false;_methodAC=false;hideAC();updGutter();hlCode();ed.focus();
};

// ── Find bar (this file, or all files of the project) ──
var _findAll=false;
function _findShow(repl){
  var bar=document.getElementById('findBar'),q=document.getElementById('findQ');
  bar.classList.add('show');
  document.getElementById('findRepRow').style.display=repl?'flex':'none';
  var sel=ed.value.substring(ed.selectionStart,ed.selectionEnd);
  if(sel&&sel.indexOf('\n')<0&&sel.length<80)q.value=sel;
  if(window.innerWidth<768)showView('edit');
  q.focus();q.select();
  _findList();
}
function _findClose(){document.getElementById('findBar').classList.remove('show');ed.focus()}
function _findToggleAll(on){
  _findAll=on===undefined?!_findAll:!!on;
  document.getElementById('findAllBtn').classList.toggle('on',_findAll);
  _findList();
}
function _findCount(text,q){return q?text.split(q).length-1:0}
// Select the next (or previous) match. In "all files" mode the search continues in the following files.
function _findNext(back){
  var q=document.getElementById('findQ').value;if(!q)return false;
  var v=ed.value,i=back?(ed.selectionStart>0?v.lastIndexOf(q,ed.selectionStart-1):-1):v.indexOf(q,ed.selectionEnd);
  if(i<0&&_findAll&&_proj.files.length>1){
    _projSync();
    var n=_proj.files.length;
    for(var k=1;k<n;k++){
      var j=((_proj.active+(back?-k:k))%n+n)%n,src=_proj.files[j].source,at=back?src.lastIndexOf(q):src.indexOf(q);
      if(at>=0){_projSetActive(j);v=ed.value;i=at;break}
    }
  }
  if(i<0)i=back?v.lastIndexOf(q):v.indexOf(q);   // wrap around in this file
  if(i<0){setStatus('idle','Find: no match');return false}
  var line=v.substring(0,i).split('\n').length,col=i-v.lastIndexOf('\n',i-1);
  _projJump(_proj.files[_proj.active].path,line,col,q.length);
  setStatus('idle','Find: '+(_findCount(v.substring(0,i),q)+1)+' of '+_findCount(v,q)+(_projMulti()?' in '+_proj.files[_proj.active].path:''));
  return true;
}
// "All files" mode: one row per matching line, as path:line: text
function _findList(){
  var box=document.getElementById('findRes'),q=document.getElementById('findQ').value;
  if(!_findAll||!q){box.style.display='none';box.innerHTML='';return}
  _projSync();
  var rows=[],total=0,nf=0;
  _proj.files.forEach(function(f){
    var lines=f.source.split('\n'),hit=false;
    for(var l=0;l<lines.length;l++){
      var c=lines[l].indexOf(q);if(c<0)continue;
      total++;hit=true;
      if(rows.length<200)rows.push({p:f.path,l:l+1,c:c+1,t:lines[l].trim().slice(0,160)});
    }
    if(hit)nf++;
  });
  var html='<div class="fres-h">'+(total?total+' matching line'+(total>1?'s':'')+' in '+nf+' file'+(nf>1?'s':'')+(total>200?' — first 200 shown':''):'No match in '+_proj.files.length+' file'+(_proj.files.length>1?'s':''))+'</div>';
  rows.forEach(function(r){html+='<div class="fres-row" data-p="'+escH(r.p)+'" data-l="'+r.l+'" data-c="'+r.c+'">'+escH(r.p+':'+r.l+': '+r.t)+'</div>'});
  box.innerHTML=html;box.style.display='block';
}
function _findAfterEdit(){updGutter();hlCode();updCurPos();_projSnap();_projDirty();_projSaveSoon();_findList()}
function _findReplace(){
  var q=document.getElementById('findQ').value,r=document.getElementById('findR').value;if(!q)return;
  if(ed.value.substring(ed.selectionStart,ed.selectionEnd)===q){
    var s=ed.selectionStart;_projSnap();
    ed.value=ed.value.substring(0,s)+r+ed.value.substring(ed.selectionEnd);
    ed.setSelectionRange(s+r.length,s+r.length);
    _findAfterEdit();
  }
  _findNext(false);
}
// Replace every match: in this file, or — in "all files" mode, after a confirmation — in every file
function _findReplaceAll(){
  var q=document.getElementById('findQ').value,r=document.getElementById('findR').value;if(!q)return 0;
  _projSnap();_projSync();
  var all=_findAll&&_proj.files.length>1,total=0,nf=0;
  _proj.files.forEach(function(f,i){if(!all&&i!==_proj.active)return;var c=_findCount(f.source,q);if(c){total+=c;nf++}});
  if(!total){setStatus('idle','Find: no match');return 0}
  if(all&&!confirm('Replace '+total+' match'+(total>1?'es':'')+' of "'+q+'" in '+nf+' file'+(nf>1?'s':'')+'?'))return 0;
  _proj.files.forEach(function(f,i){
    if(!all&&i!==_proj.active)return;
    if(i===_proj.active)ed.value=ed.value.split(q).join(r);
    else f.source=f.source.split(q).join(r);
  });
  _findAfterEdit();
  setStatus('idle','Replaced '+total+(all?' in '+nf+' file'+(nf>1?'s':''):''));
  return total;
}
(function(){
  var q=document.getElementById('findQ'),box=document.getElementById('findRes'),bar=document.getElementById('findBar'),t=null;
  if(!q||!box||!bar)return;
  q.addEventListener('input',function(){if(t)clearTimeout(t);t=setTimeout(_findList,150)});
  q.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();_findNext(e.shiftKey)}});
  document.getElementById('findR').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();_findReplace()}});
  box.addEventListener('click',function(e){
    var row=e.target.closest?e.target.closest('.fres-row'):null;if(!row)return;
    _projJump(row.getAttribute('data-p'),+row.getAttribute('data-l'),+row.getAttribute('data-c'),q.value.length);
  });
  document.addEventListener('keydown',function(e){
    if(!bar.classList.contains('show'))return;
    if(e.key==='Escape'&&bar.contains(document.activeElement)){e.preventDefault();_findClose()}
    else if(e.key==='F3'){e.preventDefault();_findNext(e.shiftKey)}
  });
})();

// ── Opening files from the device (one or several) ──
function _projFileName(name){
  var n=String(name).replace(/^.*[\\\/]/,'').replace(/\.(emit|txt|jawa)$/i,'').replace(/[^A-Za-z0-9_.-]/g,'_').replace(/^\.+/,'')||'file';
  return n+'.emit';
}
// list: [{name, text}]. A text with marker lines is a whole project; a plain text is one file.
function _projOpenTexts(list){
  list=list.map(function(x){return{name:x.name,text:String(x.text).replace(/\r\n?/g,'\n')}});
  var bundles=list.filter(function(x){return _projIsBundle(x.text)}),plain=list.filter(function(x){return!_projIsBundle(x.text)});
  if(bundles.length>1){alert('More than one of these files is a whole project ('+bundles.map(function(x){return x.name}).join(', ')+'). Open one project at a time; plain .emit files can be opened together and are added as files.');return}
  function unique(path,taken){if(!taken[path])return path;var b=path.replace(/\.emit$/,''),k=2;while(taken[b+k+'.emit'])k++;return b+k+'.emit'}
  function add(){
    _projSnap();_projSync();
    var taken={},first=_proj.files.length;
    _proj.files.forEach(function(f){taken[f.path]=1});
    plain.forEach(function(x){var p=unique(_projFileName(x.name),taken);taken[p]=1;_proj.files.push({path:p,source:x.text,s:0,e:0,top:0,left:0})});
    _projDirty();
    if(plain.length)_projShow(first);else _projTabs();
    _projSave();
  }
  function replace(){
    var taken={},fs=plain.map(function(x){var p=unique(_projFileName(x.name),taken);taken[p]=1;return{path:p,source:x.text}});
    fs.sort(function(a,b){return(b.path==='main.emit')-(a.path==='main.emit')});   // main.emit, when there is one, is the entry file
    _projLoad(_emitJoinBundle(fs));_projSave();
  }
  if(bundles.length){_projLoad(bundles[0].text);add();return}
  if(plain.length===1&&!_projMulti()){_projLoad(plain[0].text);_projSave();return}   // one file into a single-file program: as before
  var what=plain.length===1?_projFileName(plain[0].name):plain.length+' files';
  _projSheet('Open '+what,[{label:'Add to this project',fn:add},{label:'Replace this project',danger:true,fn:replace}]);
}
function _projOpenFiles(files){
  var list=Array.prototype.slice.call(files);
  return Promise.all(list.map(function(file){
    return new Promise(function(ok,fail){
      var reader=new FileReader();
      reader.onload=function(){ok({name:file.name,text:reader.result})};
      reader.onerror=function(){fail(new Error('Could not read '+file.name))};
      reader.readAsText(file);
    });
  })).then(_projOpenTexts,function(e){alert((e&&e.message)||String(e))});
}

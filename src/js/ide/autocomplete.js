// Autocomplete state
var acPopup=document.getElementById('acPopup');
var acSel=0;var acItems=[];var acActive=false;

function showAC(items,x,y){
  acItems=items;acSel=0;acActive=true;
  var html='';
  for(var i=0;i<items.length;i++){
    html+='<div class="ac-item'+(i===0?' sel':'')+'" data-idx="'+i+'" onmousedown="event.preventDefault();pickAC('+i+')" ontouchstart="event.preventDefault();pickAC('+i+')"><span class="ac-name">'+items[i].name+'</span><span class="ac-desc">'+items[i].desc+'</span></div>';
  }
  acPopup.innerHTML=html;
  acPopup.style.left=Math.min(x,200)+'px';
  acPopup.style.top=y+'px';
  acPopup.classList.add('show');
}

function hideAC(){acPopup.classList.remove('show');acActive=false;acItems=[]}

function pickAC(idx){
  var lib=acItems[idx];
  if(!lib){hideAC();return}
  if(lib._libac){_libACPick(idx);return}
  if(_methodAC){
    // Insert a method signature: replace the partial after the dot with the full sig
    // Also rewrite the identifier before the dot to its canonical case (e.g. babylon → BABYLON)
    var pos=ed.selectionStart;
    var before=ed.value.substring(0,pos);
    var after=ed.value.substring(pos);
    var dotMatch=before.match(/([A-Za-z_]\w*)\.(\w*)$/);
    if(dotMatch){
      // Strip identifier + dot + partial, then rewrite with canonical case
      var totalLen=dotMatch[1].length+1+dotMatch[2].length;
      before=before.substring(0,before.length-totalLen)+(_methodACGlobal||dotMatch[1])+'.';
    }
    // lib._full holds the original signature like "Engine(canvas, antialias)"
    var sig=lib._full||lib.name;
    var tail=sig.indexOf(' —');
    if(tail>=0)sig=sig.substring(0,tail);
    if(sig.indexOf('(')<0)sig=sig+'()';
    ed.value=before+sig+after;
    ed.selectionStart=ed.selectionEnd=before.length+sig.length;
    _methodAC=false;hideAC();updGutter();hlCode();ed.focus();
    return;
  }
  if(_builtinAC){
    // Insert builtin — replace the partial word with full name + ()
    var pos=ed.selectionStart;
    var before=ed.value.substring(0,pos);
    var after=ed.value.substring(pos);
    var wordMatch=before.match(/([a-zA-Z_]\w*)$/);
    if(wordMatch){
      var fnName=lib.name.split('(')[0];
      before=before.substring(0,before.length-wordMatch[1].length);
      ed.value=before+fnName+'('+after;
      ed.selectionStart=ed.selectionEnd=before.length+fnName.length+1;
    }
    _builtinAC=false;hideAC();updGutter();hlCode();ed.focus();
    return;
  }
  // Insert use <libname> on the current line
  var pos=ed.selectionStart;
  var before=ed.value.substring(0,pos);
  var after=ed.value.substring(pos);
  var lineStart=before.lastIndexOf('\n')+1;
  var lineEnd=after.indexOf('\n');if(lineEnd<0)lineEnd=after.length;
  ed.value=before.substring(0,lineStart)+'use '+lib.name+after.substring(lineEnd);
  var newPos=lineStart+4+lib.name.length;
  ed.selectionStart=ed.selectionEnd=newPos;
  hideAC();updGutter();hlCode();ed.focus();
}

// Listen for typing in editor
ed.addEventListener('keydown',function(e){
  if(acActive){
    if(e.key==='ArrowDown'){e.preventDefault();acSel=Math.min(acSel+1,acItems.length-1);updACsel();return}
    if(e.key==='ArrowUp'){e.preventDefault();acSel=Math.max(acSel-1,0);updACsel();return}
    if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();pickAC(acSel);return}
    if(e.key==='Escape'){e.preventDefault();hideAC();return}
  }
  // Tab → insert 2 spaces
  if(e.key==='Tab'){
    e.preventDefault();
    var s=ed.selectionStart,en=ed.selectionEnd;
    ed.value=ed.value.substring(0,s)+'  '+ed.value.substring(en);
    ed.selectionStart=ed.selectionEnd=s+2;
    updGutter();hlCode();
    return;
  }
  // Enter → auto-indent
  if(e.key==='Enter'){
    e.preventDefault();
    var s=ed.selectionStart;
    var before=ed.value.substring(0,s);
    var after=ed.value.substring(ed.selectionEnd);
    var line=before.substring(before.lastIndexOf('\n')+1);
    var indent=line.match(/^(\s*)/)[1];
    // Add extra indent after {
    if(line.trimEnd().endsWith('{'))indent+='  ';
    ed.value=before+'\n'+indent+after;
    ed.selectionStart=ed.selectionEnd=s+1+indent.length;
    updGutter();hlCode();
    return;
  }
  // } → auto-dedent
  if(e.key==='}'){
    var s=ed.selectionStart;
    var before=ed.value.substring(0,s);
    var lineStart=before.lastIndexOf('\n')+1;
    var lineText=before.substring(lineStart);
    if(lineText.match(/^\s+$/)&&lineText.length>=2){
      ed.value=before.substring(0,lineStart)+lineText.substring(2)+'}'+ed.value.substring(s);
      ed.selectionStart=ed.selectionEnd=s-1;
      e.preventDefault();
      updGutter();hlCode();
      return;
    }
  }
  // Ctrl+Enter or Cmd+Enter to run
  if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){
    e.preventDefault();
    compileAndRun();
    return;
  }
});
// Inline builtin autocomplete — shows when typing function names
var _allBuiltins=Object.keys(BUILTINS).map(function(name){
  var b=BUILTINS[name];
  var sig=name+'('+b.params.map(function(p){return p.name+': '+p.type}).join(', ')+')';
  if(b.returnType!=='void')sig+=' '+b.returnType;
  return{name:name,sig:sig,desc:b.module};
});
var _builtinAC=false;
var _methodAC=false;
var _methodACGlobal='';
function checkBuiltinAC(){
  try{
  var pos=ed.selectionStart;
  var before=ed.value.substring(0,pos);
  // Get current word being typed
  var wordMatch=before.match(/([a-zA-Z_]\w*)$/);
  if(!wordMatch||wordMatch[1].length<3){if(_builtinAC){hideAC();_builtinAC=false}return}
  if(typeof _libInStrOrComment==='function'&&_libInStrOrComment(before)){if(_builtinAC){hideAC();_builtinAC=false}return}   /* not in a comment or a string (//// file: extra.emit is not emitter) */
  var word=wordMatch[1].toLowerCase();
  // Don't show if we're in a keyword/type position
  var lineStart=before.lastIndexOf('\n')+1;
  var lineText=before.substring(lineStart).trimStart();
  if(lineText.startsWith('fn ')||lineText.startsWith('export ')||lineText.startsWith('let ')||lineText.startsWith('mut ')||lineText.startsWith('use '))return;
  var matches=_allBuiltins.filter(function(b){return b.name.toLowerCase().indexOf(word)===0&&b.name.toLowerCase()!==word});
  if(matches.length>0&&matches.length<=8){
    _builtinAC=true;
    var items=matches.map(function(b){return{name:b.sig,desc:b.desc}});
    var lines=before.split('\n');
    var lineH=ed.scrollHeight/ed.value.split('\n').length||20;
    var y=(lines.length)*lineH-ed.scrollTop+12;
    showAC(items,60,y);
  } else {if(_builtinAC){hideAC();_builtinAC=false}}
  }catch(e){}
}
ed.addEventListener('blur',function(){setTimeout(hideAC,400)});

function updACsel(){
  var els=acPopup.querySelectorAll('.ac-item');
  els.forEach(function(el,i){el.classList.toggle('sel',i===acSel)});
}

function checkAC(){
  try{
  var pos=ed.selectionStart;
  var before=ed.value.substring(0,pos);
  var lineStart=before.lastIndexOf('\n')+1;
  var lineText=before.substring(lineStart).trimStart();

  if(lineText==='use'||lineText==='use '||(lineText.startsWith('use ')&&lineText.length<20)){
    var filter=lineText.length>4?lineText.substring(4).toLowerCase():'';
    var matches=LIBS.filter(function(l){return!filter||l.name.toLowerCase().indexOf(filter)>=0});
    if(matches.length>0){
      var lines=before.split('\n');
      var lineH=ed.scrollHeight/ed.value.split('\n').length||20;
      var y=(lines.length)*lineH-ed.scrollTop+12;
      var x=60;
      showAC(matches,x,y);
    } else { hideAC() }
    return;
  }
  if(_projACCheck(before))return;  // modules of the project: import lines, alias.member
  if(_libACCheck(before))return;  // live members of a loaded library
  // Identifier-dot autocomplete: typing `BABYLON.` or `dayjs.format` triggers method suggestions
  var dotMatch=before.match(/([A-Za-z_]\w*)\.(\w*)$/);
  if(dotMatch){
    var globalName=dotMatch[1];
    var partial=dotMatch[2].toLowerCase();
    // Find a library whose 'global' field matches the identifier
    var libMatch=LIBS.find(function(l){return l.global&&l.global.toLowerCase()===globalName.toLowerCase()});
    if(libMatch&&libMatch.methods&&libMatch.methods.length){
      var methods=_libCatMembers(libMatch).filter(function(m){
        var sig=m.toLowerCase();
        return sig.indexOf(partial)===0||partial===''||sig.indexOf('.'+partial)>=0;
      });
      if(methods.length>0&&methods.length<=20){
        _methodAC=true;_methodACGlobal=libMatch.global;
        var items=methods.map(function(m){
          var nm=m.split(/[\s—(]/)[0];
          var rest=m.substring(nm.length);
          return{name:nm,desc:rest.trim()||libMatch.name,_full:m};
        });
        var lines=before.split('\n');
        var lineH=ed.scrollHeight/ed.value.split('\n').length||20;
        var y=(lines.length)*lineH-ed.scrollTop+12;
        showAC(items,60,y);
        return;
      }
    }
    // No library match — clear method AC mode
    if(_methodAC){hideAC();_methodAC=false}
  } else if(_methodAC){
    hideAC();_methodAC=false;
  }
  /* Otherwise fall back to builtin AC */ hideAC();checkBuiltinAC();_libACFallback(before);_projACFallback(before)
  }catch(e){}
}


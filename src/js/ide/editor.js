// EXAMPLES
// EX is injected by build script before this file
// UI
const ed=document.getElementById('editor'),gutter=document.getElementById('gutter'),hlInner=document.getElementById('hlInner');let lastFuncs=null,lastImports=null;
var _emitKw=new Set(['fn','let','mut','const','return','if','else','while','for','class','interface','implements','new','this','export','import','from','as','break','continue','use']);
var _emitTy=new Set(['int','num','str','bool','void','i32','i64','f32','f64','js']);
var _emitBlt=new Set(['print','printNum','printStr','log','alert','abs','min','max','sqrt','sin','cos','pow','floor','random','now','canvas','color','alpha','lineWidth','rect','strokeRect','circle','line','clear','text','pixel','beep','sleep','button','input','getInput','setText','div','newArray','getItem','setItem','getNumItem','setNumItem','push','pop','arrayLen','scene3d','box','sphere','plane','color3d','move3d','rotate3d','scale3d','camera3d','lookAt3d','light3d','fog3d','render3d','controls3d','cylinder','wallBox','ambient3d','bgColor3d','cone','torus','grid3d','pointLight3d','spotLight3d','metallic3d','opacity3d','shadow3d','text3d','synth','drum','playNote','noteOff','setBpm','setSwing','physics','physBox','physCircle','physGround','physGravity','physStep','physDraw','barChart','lineChart','pieChart','chartLabel','chartData','chartColor','chartRender','loadAudio','playAudio','stopAudio','loopAudio','volumeAudio','tween','animateEl','pixiApp','pixiRect','pixiCircle','pixiText','pixiMove','pixiRender','world3d','bodyBox','bodySphere','bodyPlane','bodyForce','stepWorld','hostPeer','joinPeer','sendInt','sendStr','onRecvInt','onRecvStr','animate','keyDown','touchX','touchY','touching','getInputStr','loadImage','drawImage','drawImageScaled','collides','dist','setTimer','setInterval','screenW','screenH','mouseX','mouseY','mouseDown','save','load','saveStr','httpGet','randInt','lerp','clamp','ceil','round','sign','absNum','minNum','maxNum','tan','asin','acos','atan','atan2','ln','log2','exp','PI','TAU','E','intToStr','numToStr','strLen','strConcat','substr','strEq','charAt','loadStr','getCanvas','emptyObj','wrapShape','textShape','toStr','toNum','toJsArray','fnRef']);
['toInt','isNull','typeOf','jsLen','jsAt','jsGet','jsKeys'].forEach(function(n){_emitBlt.add(n)});
['await','try','catch','finally','throw'].forEach(function(n){_emitKw.add(n)});_emitTy.add('arr');_emitTy.add('numarr');
['public','package'].forEach(function(n){_emitKw.add(n)});   // module system
function escH(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
var _brD=0;
// names are case-insensitive: PrintStr is printStr (a lower-case copy of _emitBlt, rebuilt when it grows)
var _emitBltLC=null;
function _emitBltHas(w){if(_emitBlt.has(w))return true;if(!_emitBltLC||_emitBltLC.n!==_emitBlt.size){_emitBltLC=new Set();_emitBlt.forEach(function(x){_emitBltLC.add(x.toLowerCase())});_emitBltLC.n=_emitBlt.size}return _emitBltLC.has(w.toLowerCase())}
function hlCode(){
  var src=ed.value,out='',i=0,len=src.length;_brD=0;
  while(i<len){
    var ch=src[i];
    if(ch==='\n'){out+='\n';i++;continue}
    if(ch===' '||ch==='\t'){out+=ch;i++;continue}
    if((ch==='u'||ch==='U')&&src.substr(i,4).toLowerCase()==='use '){ // whole `use` line: the spec may be a URL (contains //) or an npm spec (contains @)
      var ub=i-1;while(ub>=0&&(src[ub]===' '||src[ub]==='\t'))ub--;
      if(ub<0||src[ub]==='\n'){
        var ul='';while(i<len&&src[i]!=='\n')ul+=src[i++];
        var um=ul.match(/^use(\s+)("[^"]*"|'[^']*'|\S+)(?:(\s+)as(\s+)([A-Za-z_][A-Za-z0-9_]*))?(.*)$/i);
        if(!um){out+='<span class="kw">'+escH(ul.slice(0,3))+'</span>'+escH(ul.slice(3));continue}
        var uc=um[6].match(/^(.*?)(\/\/.*)?$/);
        out+='<span class="kw">'+escH(ul.slice(0,3))+'</span>'+um[1]+'<span class="str">'+escH(um[2])+'</span>'+(um[5]?um[3]+'<span class="kw">'+escH(ul.substr(3+um[1].length+um[2].length+um[3].length,2))+'</span>'+um[4]+um[5]:'')+escH(uc[1])+(uc[2]?'<span class="cmt">'+escH(uc[2])+'</span>':'');
        continue;
      }
    }
    if(ch==='/'&&src[i+1]==='/'){var c='';while(i<len&&src[i]!=='\n')c+=src[i++];out+='<span class="cmt">'+escH(c)+'</span>';continue}
    if(ch==='/'&&src[i+1]==='*'){var c='/*';i+=2;while(i<len&&!(src[i]==='*'&&src[i+1]==='/')){c+=src[i++]}if(i<len){c+='*/';i+=2}out+='<span class="cmt">'+escH(c)+'</span>';continue}
    if(ch==='"'||ch==="'"){var q=ch,s=q;i++;while(i<len&&src[i]!==q){if(src[i]==='\\'){s+=src[i++]}if(i<len)s+=src[i++]}if(i<len){s+=q;i++}out+='<span class="str">'+escH(s)+'</span>';continue}
    if((ch>='0'&&ch<='9')||(ch==='.'&&src[i+1]>='0'&&src[i+1]<='9')){var n='';if(ch==='0'&&(src[i+1]==='x'||src[i+1]==='X')){n+=src[i++]+src[i++];while(i<len&&/[0-9a-fA-F]/.test(src[i]))n+=src[i++]}else{while(i<len&&((src[i]>='0'&&src[i]<='9')||src[i]==='.'||src[i]==='e'||src[i]==='E'))n+=src[i++]}out+='<span class="num">'+n+'</span>';continue}
    if((ch>='a'&&ch<='z')||(ch>='A'&&ch<='Z')||ch==='_'){var w='';while(i<len&&((src[i]>='a'&&src[i]<='z')||(src[i]>='A'&&src[i]<='Z')||(src[i]>='0'&&src[i]<='9')||src[i]==='_'))w+=src[i++];var wl=w.toLowerCase();if(_emitKw.has(wl))out+='<span class="kw">'+w+'</span>';else if(_emitTy.has(wl))out+='<span class="ty">'+w+'</span>';else if(_emitBltHas(w))out+='<span class="blt">'+w+'</span>';else out+=w;continue}
    if(ch===','||ch==='.'||ch===';'||ch===':'||ch==='('||ch===')'||ch==='['||ch===']'){out+='<span class="dl">'+escH(ch)+'</span>';i++;continue}
    if(ch==='{'){out+='<span class="br br'+(_brD%4)+'">'+ch+'</span>';_brD++;i++;continue}
    if(ch==='}'){_brD--;if(_brD<0)_brD=0;out+='<span class="br br'+(_brD%4)+'">'+ch+'</span>';i++;continue}
    if(i+1<len){var tw=ch+src[i+1];if(tw==='->'||tw==='=='||tw==='!='||tw==='<='||tw==='>='||tw==='&&'||tw==='||'||tw==='<<'||tw==='>>'||tw==='??'||tw==='++'||tw==='--'||tw==='+='||tw==='-='||tw==='*='||tw==='/='){out+='<span class="op">'+escH(tw)+'</span>';i+=2;continue}}
    if('=+-*/<>!%&|^~?'.includes(ch)){out+='<span class="op">'+escH(ch)+'</span>';i++;continue}
    out+=escH(ch);i++;
  }
  hlInner.innerHTML=out+'\n';
}
function syncScroll(){
  hlInner.style.transform='translate('+ -ed.scrollLeft+'px,'+ -ed.scrollTop+'px)';
  gutter.style.transform='translateY('+ -ed.scrollTop+'px)';
}
(async function(){if(!(await loadFromURL())){var _saved=null;try{_saved=localStorage.getItem('emit-code')}catch(e){}_projLoad((_saved&&_saved.length>0)?_saved:'// New Emit program\n\nexport fn myapp() {\n  print(42)\n}\n',_projSavedActive())};updGutter();hlCode();try{if(!localStorage.getItem('emit-welcomed')&&!location.hash.substring(1)){document.getElementById('welcomeOverlay').classList.add('show')}}catch(e){}})();
function closeWelcome(){document.getElementById('welcomeOverlay').classList.remove('show');try{localStorage.setItem('emit-welcomed','1')}catch(e){}}

// Cursor position display
var curPosEl=document.getElementById('curPos');
function updCurPos(){
  var pos=ed.selectionStart;
  var before=ed.value.substring(0,pos);
  var line=before.split('\n').length;
  var col=pos-before.lastIndexOf('\n');
  curPosEl.textContent='Ln '+line+' Col '+col;
}
ed.addEventListener('click',updCurPos);
ed.addEventListener('keyup',function(){updCurPos();checkAC()});

// Jump to line (used by clickable errors)
function jumpToLine(lineNum){
  var lines=ed.value.split('\n');
  var pos=0;
  for(var i=0;i<lineNum-1&&i<lines.length;i++)pos+=lines[i].length+1;
  ed.selectionStart=pos;
  ed.selectionEnd=pos+lines[lineNum-1].length;
  ed.focus();
  // Highlight the error line
  var hl=document.querySelectorAll('.ln');
  hl.forEach(function(el){el.classList.remove('err-hl')});
  if(hl[lineNum-1])hl[lineNum-1].style.background='rgba(248,113,113,.15)';
  // Switch to editor view on mobile
  if(window.innerWidth<768)showView('edit');
  updCurPos();
}
window.jumpToLine=jumpToLine;

// Find & Replace
function openFind(){_findShow(false)}      // the find bar: see "Find bar" in the project section
function openReplace(){_findShow(true)}

// Select line on gutter click
document.getElementById('gutter').addEventListener('click',function(e){
  if(e.target.classList.contains('ln')){
    var lineNum=parseInt(e.target.textContent);
    if(!isNaN(lineNum))jumpToLine(lineNum);
  }
});

// Ctrl+F find, Ctrl+H replace
document.addEventListener('keydown',function(e){
  if((e.ctrlKey||e.metaKey)&&e.key==='f'){e.preventDefault();openFind()}
  if((e.ctrlKey||e.metaKey)&&e.key==='h'){e.preventDefault();openReplace()}
});
document.getElementById('example').addEventListener('change',function(e){if(EX[e.target.value]){_projLoad(EX[e.target.value]);_projSave()}});
var _saveT=null;ed.addEventListener('input',function(e){_projOnInput(e);updGutter();hlCode();updCurPos();checkAC();if(_saveT)clearTimeout(_saveT);_saveT=setTimeout(_projSave,250)});
ed.addEventListener('scroll',syncScroll);
function updGutter(){
  var lines=ed.value.split('\n');
  var depth=new Uint8Array(lines.length);
  var stack=[];
  for(var i=0;i<lines.length;i++){
    var t=lines[i].trim();
    // closing brace decreases depth
    if(t.startsWith('}')){if(stack.length>0)stack.pop()}
    var loopD=0;for(var j=0;j<stack.length;j++){if(stack[j]==='loop')loopD++}
    depth[i]=loopD;
    // opening brace after while/for = loop block
    if(t.endsWith('{')){
      if(/\b(while|for)\b/.test(t)){depth[i]=loopD+1;stack.push('loop')}
      else stack.push('other');
    }
  }
  var html='';
  for(var i=0;i<lines.length;i++){
    var d=depth[i];
    var cls='ln';
    if(d>0)cls+=' loop lp'+Math.min(d,4);
    else if(lines[i].trim().startsWith('fn ')||lines[i].trim().startsWith('export fn '))cls+=' fn-line';
    html+='<span class="'+cls+'">'+(i+1)+'</span>';
  }
  gutter.innerHTML=html;
}
function showView(v){document.querySelectorAll('.vtab').forEach(t=>t.classList.toggle('active',t.dataset.v===v));const ep=document.getElementById('pnl-edit'),rp=document.getElementById('pnl-run');if(v==='edit'){ep.className='pnl';rp.className='pnl off-r'}else{ep.className='pnl off-l';rp.className='pnl'}}
function showOTab(el){document.querySelectorAll('.otab').forEach(t=>t.classList.remove('active'));el.classList.add('active');document.querySelectorAll('.out-body > .output').forEach(o=>o.style.display='none');document.getElementById('tab-'+el.dataset.t).style.display='block'}
function ins(ch){var s=ed.selectionStart,e=ed.selectionEnd;var pairs={"(":"()","{":"{\n  \n}"};var text=pairs[ch]||ch;ed.value=ed.value.substring(0,s)+text+ed.value.substring(e);ed.selectionStart=ed.selectionEnd=s+(pairs[ch]?1+(ch==="{"?3:0):text.length);ed.focus();updGutter()}
function setStatus(st,text,right=''){document.getElementById('sDot').className='sdot '+st;document.getElementById('sTxt').textContent=text;document.getElementById('sR').textContent=right}
function h(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function sp(cls,t){return'<span class="'+cls+'">'+h(t)+'</span>'}

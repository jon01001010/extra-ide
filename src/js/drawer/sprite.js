// ═══ SPRITES in the editor: highlighting, autocomplete, the example, the SPRITE tool of the drawer ═══
['sprite'].forEach(function(n){_emitKw.add(n)});
var _SPR_BLT=[
  ['draw','draw(spr, x, y, frame)','sprite on the canvas'],['drawEx','drawEx(spr, x, y, frame, flipX: bool, scale: num)','flipped / scaled'],
  ['anim','anim(spr, t: num) int','frame number at t seconds'],['spriteW','spriteW(spr) int','width in pixels'],['spriteH','spriteH(spr) int','height in pixels'],
  ['blit','blit(spr, frame, fb: region u8, x, y, w)','into a screen() region']];
_SPR_BLT.forEach(function(b){
  _emitBlt.add(b[0]);
  if(!_allBuiltins.some(function(x){return x.name===b[0]}))_allBuiltins.push({name:b[0],sig:b[1],desc:b[2]});
});
(function(){try{var st=document.createElement('style');st.textContent='.hl-layer .spr{color:#f5a3c7}.hl-layer .spx{border-radius:2px}.hl-layer .spd{color:var(--fg3)}'+
  '.spt{font-family:var(--mono);font-size:12px;color:var(--fg);display:flex;flex-direction:column;gap:8px;max-width:100%;min-width:0;box-sizing:border-box}'+
  '.spt *{box-sizing:border-box}'+
  '.spt-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-width:0}'+
  '.spt button,.spt select,.spt input{font-family:var(--mono);font-size:12px;background:var(--bg4);color:var(--fg);border:1px solid var(--border);border-radius:6px;min-height:36px;padding:0 9px;min-width:0}'+
  '.spt input[type=number]{width:62px}.spt input.spt-name{flex:1;min-width:90px}.spt select{flex:1;min-width:100px;max-width:100%}'+
  '.spt button.on{background:var(--cyan);color:var(--bg);border-color:var(--cyan)}'+
  '.spt button:disabled{opacity:.4}'+
  '.spt-tools button{min-width:40px;padding:0 6px;font-size:15px}'+
  '.spt-stage{position:relative;width:100%;touch-action:none;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--bg2)}'+
  '.spt-stage canvas{display:block;width:100%;height:100%;touch-action:none}'+
  '.spt-zoom{position:absolute;right:6px;top:6px;display:flex;gap:4px}.spt-zoom button{min-height:32px;min-width:32px;padding:0;background:rgba(15,17,24,.85)}'+
  '.spt-pal{display:flex;flex-wrap:wrap;gap:4px}'+
  '.spt-sw{width:30px;height:30px;min-height:30px!important;padding:0!important;border-radius:5px!important;border:2px solid var(--border)!important;position:relative;font-size:9px!important;color:#fff!important;text-shadow:0 0 2px #000}'+
  '.spt-sw.sel{border-color:#fff!important;box-shadow:0 0 0 2px var(--cyan)}'+
  '.spt-sw.tr{background:repeating-conic-gradient(#555 0 25%,#999 0 50%) 0 0/10px 10px!important}'+
  '.spt-frames{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch;max-width:100%}'+
  '.spt-fr{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:2px;padding:4px!important;min-height:0!important;height:auto}'+
  '.spt-fr canvas{width:44px;height:44px;image-rendering:pixelated;background:repeating-conic-gradient(#333 0 25%,#444 0 50%) 0 0/8px 8px}'+
  '.spt-fr span{font-size:10px;max-width:56px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'+
  '.spt-fr.sel{border-color:var(--cyan)!important}'+
  '.spt-prev{display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap}'+
  '.spt-prev canvas{image-rendering:pixelated;background:repeating-conic-gradient(#333 0 25%,#444 0 50%) 0 0/8px 8px;border:1px solid var(--border);border-radius:4px;max-width:100%}'+
  '.spt-msg{font-size:11px;color:var(--yellow,#fbbf24);white-space:pre-wrap;word-break:break-word}.spt-msg:empty{display:none}'+
  '.spt-lbl{font-size:10px;color:var(--fg3);letter-spacing:1px;text-transform:uppercase}';
  document.head.appendChild(st)}catch(e){}})();
// Sprite names of the whole project (the active file from the editor, the others from the project model)
function _sprProjectBlocks(){
  var out=[];
  try{
    var files=(typeof _proj==='object'&&_proj.files)||[];
    for(var i=0;i<files.length;i++){
      var src=i===_proj.active?ed.value:files[i].source;
      _sprFindBlocks(src).forEach(function(b){out.push({name:b.name,path:files[i].path,block:b})});
    }
  }catch(e){}
  return out;
}
// Highlighting: sprite names in plain code (not in strings / comments / keywords) get class "spr".
// Inside a sprite block of the open file: palette entries are underlined in their colour and every pixel of a
// row is painted in its palette colour, so the rows read as the picture (text width unchanged).
function _sprHlBlock(lines){
  var pal=[],m;
  lines.forEach(function(l){if((m=/^\s+palette\b(.*)$/.exec(l)))(m[1].replace(/\/\/.*$/,'').match(/\S+/g)||[]).forEach(function(h){if(/^#?[0-9a-fA-F]{6}$/.test(h))pal.push(h.replace('#','').toLowerCase())})});
  if(!pal.length)pal=_SPR_DEFAULT_PAL;
  function ink(hx){var v=parseInt(hx,16);return(((v>>16)&255)*299+((v>>8)&255)*587+(v&255)*114)/1000>140?'#000':'#fff'}
  function cmt(c){return c?'<span class="cmt">'+escH(c)+'</span>':''}
  return lines.map(function(raw,i){
    var ca=_sprCmtAt(raw),code=ca>=0?raw.slice(0,ca):raw,c=ca>=0?raw.slice(ca):'',hm;
    if(i===0&&(hm=/^(sprite)(\s+)(\w+)(.*)$/i.exec(code)))return'<span class="kw">'+hm[1]+'</span>'+hm[2]+'<span class="spr">'+escH(hm[3])+'</span>'+escH(hm[4])+cmt(c);
    if((hm=/^(\s+)palette\b(.*)$/i.exec(code)))return hm[1]+'<span class="kw">'+code.substr(hm[1].length,7)+'</span>'+hm[2].replace(/[^\s]+/g,function(h){return/^#?[0-9a-fA-F]{6}$/.test(h)?'<span class="spc" style="box-shadow:inset 0 -3px #'+h.replace('#','')+'">'+escH(h)+'</span>':escH(h)})+cmt(c);
    if((hm=/^(\s+)(frame|rle)\b(.*)$/i.exec(code)))return hm[1]+'<span class="kw">'+hm[2]+'</span>'+escH(hm[3]).replace(/\brle\b/i,function(w){return'<span class="kw">'+w+'</span>'}).replace(/"[^"]*"/,function(q){return'<span class="str">'+q+'</span>'})+cmt(c);
    if((hm=/^(\s+)"([^"]*)"(\s*)$/.exec(code))){
      var out='',t=hm[2];
      for(var k=0;k<t.length;){var ch=t[k],n=1;while(t[k+n]===ch)n++;var v=_SPR_CHARS.indexOf(ch),hx=v>0?pal[v-1]:null;
        out+=hx?'<span class="spx" style="background:#'+hx+';color:'+ink(hx)+'">'+escH(t.substr(k,n))+'</span>':'<span class="spd">'+escH(t.substr(k,n))+'</span>';k+=n}
      return hm[1]+'<span class="str">"</span>'+out+'<span class="str">"</span>'+hm[3]+cmt(c);
    }
    return escH(code)+cmt(c);
  });
}
hlCode=(function(hl){return function(){
  var r=hl.apply(this,arguments);
  try{
    var bl=_sprFindBlocks(ed.value);
    if(bl.length){
      var segs=hlInner.innerHTML.split('\n');
      bl.forEach(function(b){var h=_sprHlBlock(b.lines);for(var i=0;i<h.length;i++)if(b.start+i<segs.length)segs[b.start+i]=h[i]});
      hlInner.innerHTML=segs.join('\n');
    }
  }catch(e){}
  try{
    if(!/sprite/i.test(ed.value)&&!(_proj.files.length>1&&_proj.files.some(function(f){return /sprite/i.test(f.source)})))return r;
    var names=_sprProjectBlocks().map(function(b){return b.name});
    if(!names.length)return r;
    var re=new RegExp('\\b('+names.join('|')+')\\b','g'),kids=Array.prototype.slice.call(hlInner.childNodes);
    kids.forEach(function(n){
      if(n.nodeType!==3||!re.test(n.nodeValue))return;
      re.lastIndex=0;
      var s=n.nodeValue,f=document.createDocumentFragment(),at=0,m;
      while((m=re.exec(s))){
        if(m.index>at)f.appendChild(document.createTextNode(s.slice(at,m.index)));
        var sp=document.createElement('span');sp.className='spr';sp.textContent=m[0];f.appendChild(sp);
        at=m.index+m[0].length;
      }
      if(at<s.length)f.appendChild(document.createTextNode(s.slice(at)));
      n.parentNode.replaceChild(f,n);
    });
  }catch(e){}
  return r;
}})(hlCode);
// Autocomplete: frame names inside draw(hero, x, y, "…") / drawEx / blit(hero, "…"); sprite names; a snippet.
function _sprACCheck(before){
  try{
    if(before.indexOf('"')<0)return false;
    var m=/\b(?:draw|drawEx)\(\s*([A-Za-z_]\w*)\s*,[^,()"\n]*,[^,()"\n]*,\s*"(\w*)$/.exec(before)||/\bblit\(\s*([A-Za-z_]\w*)\s*,\s*"(\w*)$/.exec(before);
    if(!m)return false;
    var bl=_sprProjectBlocks().filter(function(b){return b.name===m[1]})[0];
    if(!bl)return false;
    var d=_sprParse(bl.block.lines,bl.block.start+1,true),p=m[2].toLowerCase(),items=[];
    d.frames.forEach(function(f,i){if(f.name&&f.name.toLowerCase().indexOf(p)===0&&f.name!==m[2])items.push(_memItem(f.name,'frame '+i+' · '+d.name))});
    _memShowItems(items,before,'sf:'+before.length+':'+m[0]);
    return true;
  }catch(e){}
  return false;
}
var _SPR_SNIPS=[['sprite','sprite name: 16x16','name']];
function _sprACFallback(before){
  try{
    if(_libInStrOrComment(before))return;
    var wm=before.match(/(?:^|[^\w$.])([A-Za-z_]\w*)$/);
    if(!wm)return;
    var lineText=before.substring(before.lastIndexOf('\n')+1),items=[],w=wm[1].toLowerCase();
    if(/^[a-z]+$/.test(lineText)&&lineText.length>=2)_SPR_SNIPS.forEach(function(s){if(s[0].indexOf(lineText)===0&&s[0]!==lineText){var it=_memItem(s[0],s[1]);it._memSnip={text:s[1],sel:s[2],rep:lineText.length};items.push(it)}});
    if(/^\s/.test(lineText)||/[(,=]/.test(lineText)){
      _sprProjectBlocks().forEach(function(b){
        if(b.name!==wm[1]&&b.name.toLowerCase().indexOf(w)===0&&!items.some(function(x){return x._ins===b.name})){
          var hm=/:\s*(\d+\s*x\s*\d+)/.exec(b.block.lines[0]);items.push(_memItem(b.name,'sprite'+(hm?' '+hm[1].replace(/\s/g,''):'')))}
      });
    }
    if(!items.length)return;
    var base=acActive?acItems.filter(function(it){return it._libac!=='hint'&&!items.some(function(x){return x._ins===it._ins})}):[];
    _libACShow(items.concat(base),before,'sg:'+before.length+':'+wm[1]);
  }catch(e){}
}
checkAC=(function(f){return function(){
  var before=null;try{before=ed.value.substring(0,ed.selectionStart)}catch(e){}
  if(before!==null&&_sprACCheck(before))return;
  var r=f.apply(this,arguments);
  if(before!==null&&(_sprProjectBlocks().length||/^spr?i?t?e?$/.test(before.substring(before.lastIndexOf('\n')+1))))_sprACFallback(before);
  return r;
}})(checkAC);
// ── the example ──
EX.sprites="// Sprites — a little walker. Its pixels live in sprites.emit (the second tab):\n// each quoted row is a row of pixels, . is transparent, 1-9 / a-z are palette colours.\n// Open 🧰 → Sprite to paint it with the mouse or a finger.\n// Left: blit copies the frame into a memory region that screen() shows (3x).\n// Right: the same frame with drawEx on a canvas — flipped when it turns, 3x.\n\nregion fb: u8[48 * 16 * 4]\n\nmut x = 0.0\nmut dir = 1.0\nmut t = 0.0\n\nexport fn walk() {\n  screen(fb, 48, 16, 3)\n  let left = getCanvas()\n  left.style.display = \"inline-block\"\n  canvas(144, 48)\n  let right = getCanvas()\n  right.style.display = \"inline-block\"\n  animate()\n}\n\nexport fn frame() {\n  t += 1.0 / 60.0\n  x += dir * 0.4\n  if (x > 48.0 - spriteW(walker)) { dir = -1.0 }\n  if (x < 0.0) { dir = 1.0 }\n  let f = anim(walker, t)\n\n  // the canvas: drawEx flips the sprite when it walks left\n  clear()\n  color(37, 113, 121)\n  rect(0, 42, 144, 6)\n  drawEx(walker, x * 3.0, 18, f, dir < 0.0, 3.0)\n  draw(walker, 2, 2, \"walk1\")\n\n  // the region: wipe it, then copy the same frame in (transparent pixels skipped)\n  wipe(fb)\n  blit(walker, f, fb, floor(x), 6, 48)\n}\n//// file: sprites.emit\n// The walker sprite. Saved here by 🧰 → Sprite.\n\nsprite walker: 8x8, fps 6\n  palette 1a1c2c ffcd75 b13e53 3b5dc9 f4f4f4\n  frame walk1\n    \"..1111..\"\n    \".111111.\"\n    \".122251.\"\n    \"..2222..\"\n    \".233332.\"\n    \"..3333..\"\n    \"..4..4..\"\n    \".44...44\"\n  frame walk2\n    \"..1111..\"\n    \".111111.\"\n    \".122251.\"\n    \"..2222..\"\n    \"..3333..\"\n    \"..2332..\"\n    \"...44...\"\n    \"...44...\"\n";
(function(){try{
  var sel=document.getElementById('example');if(!sel||sel.querySelector('option[value="sprites"]'))return;
  var o=document.createElement('option');o.value='sprites';o.textContent='Sprites';
  var mem=sel.querySelector('option[value="memory"]');sel.insertBefore(o,mem||null);
}catch(e){}})();
// ═══ The SPRITE tool (drawer) ═══ a pixel painter for sprite blocks. The program text is the only state:
// opening reads the block (ctx.read), Save writes it back (ctx.write); lines it does not understand are kept.
//
// Ported from Spark's CUSTOM TEX painter and ANIM picker. Their problems, and what is done here instead:
//   hidden JSON state in a REM line          the sprite block itself is read and written (round trip)
//   no transparency, square 8/16/32 only     . is transparent; any size 1×1 … 256×256
//   whole modal re-rendered on every tap     the UI is built once; only the canvas / changed parts redraw
//   fillRect per pixel + grid every move     one ImageData per frame, scaled with drawImage; redraw once per animation frame
//   strokes with gaps, no undo               line between move events (Bresenham); undo / redo, 100 steps
//   mouse and touch handled separately       pointer events; two fingers pinch-zoom and pan, the stroke is undone
//   inline onclick strings, window globals   closures, no globals; names never put into HTML unescaped
//   ANIM previewed coloured boxes, not art   frames strip and animated preview show the real pixels
//   ANIM sequence typed as "0,1,2,1"         frames are named and reordered in the strip; fps a number input
var _SPT_UNDO_MAX=100;
function _sprToolOpen(ctx){
  var body=ctx.body;body.innerHTML='';
  var root=document.createElement('div');root.className='spt';body.appendChild(root);
  function el(tag,cls,txt,parent){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;(parent||root).appendChild(e);return e}
  function btn(txt,title,fn,parent){var b=el('button','',txt,parent);b.type='button';if(title){b.title=title;b.setAttribute('aria-label',title)}b.addEventListener('click',function(e){e.preventDefault();fn(e)});return b}
  // ── state ──
  var S=null,loaded=null,dirty=false,msgs=[];
  var tool='pencil',prevTool='pencil',color=1,mirror=false,onion=true,undo=[],redo=[];
  var zoom=8,ox=0,oy=0,fitDone=false;
  function setDirty(v){dirty=v;try{ctx.setDirty(v)}catch(e){}}
  function blank(w,h){return new Uint8Array(w*h)}
  function fromParsed(d){
    var frames=d.frames.map(function(f){var px=new Uint8Array(d.w*d.h);for(var i=0;i<px.length;i++){var v=_SPR_CHARS.indexOf(f.data[i]);px[i]=v>0?v:0}return{name:f.name,px:px,rowCmt:f.rowCmt||[],extra:f.extra||[],cmt:f.cmt||''}});
    return{name:d.name,w:d.w,h:d.h,fps:d.fps,fpsGiven:d.fpsGiven,palette:d.palette.slice(),frames:frames,extra:d.extra||[],headExtra:d.headExtra||[],cur:0};
  }
  function toDef(){
    return{name:S.name,w:S.w,h:S.h,fps:S.fps,fpsGiven:S.fpsGiven,palette:S.palette,headExtra:S.headExtra,extra:S.extra,
      frames:S.frames.map(function(f){var s='';for(var i=0;i<f.px.length;i++)s+=_SPR_CHARS[f.px[i]];return{name:f.name,data:s,rowCmt:f.rowCmt,extra:f.extra,cmt:f.cmt}})};
  }
  function newSprite(name){return{name:name,w:16,h:16,fps:8,fpsGiven:false,palette:_SPR_DEFAULT_PAL.slice(),frames:[{name:'',px:blank(16,16),rowCmt:[],extra:[],cmt:''}],extra:[],headExtra:[],cur:0}}
  function blocks(){try{return ctx.blocks('sprite')||[]}catch(e){return[]}}
  function freeName(){var used=blocks().map(function(b){return b.name}),n=1;while(used.indexOf('sprite'+n)>=0)n++;return'sprite'+n}
  function load(name){
    msgs=[];
    var text=name?ctx.read('sprite',name):null;
    if(text){
      var d=_sprParse(String(text).split('\n'),1,true);
      S=fromParsed(d);loaded=name;
      d.errors.forEach(function(e){msgs.push('line '+e.line+': '+e.msg)});
    }else{S=newSprite(name||freeName());loaded=null}
    color=Math.min(Math.max(1,color),S.palette.length)||0;
    undo=[];redo=[];fitDone=false;setDirty(false);
    try{ctx.title('Sprite — '+S.name)}catch(e){}
    refreshAll();
  }
  // ── undo ──
  function snapAll(){return{all:true,S:{name:S.name,w:S.w,h:S.h,fps:S.fps,fpsGiven:S.fpsGiven,palette:S.palette.slice(),frames:S.frames.map(function(f){return{name:f.name,px:f.px.slice(),rowCmt:f.rowCmt.slice(),extra:f.extra.slice(),cmt:f.cmt}}),extra:S.extra,headExtra:S.headExtra,cur:S.cur}}}
  function pushUndo(u){undo.push(u);if(undo.length>_SPT_UNDO_MAX)undo.shift();redo=[];setDirty(true);updUndo()}
  function structural(fn){var u=snapAll();fn();pushUndo(u);refreshAll()}
  function swapState(u){
    if(u.all){var now=snapAll();var s=u.S;S={name:s.name,w:s.w,h:s.h,fps:s.fps,fpsGiven:s.fpsGiven,palette:s.palette.slice(),frames:s.frames.map(function(f){return{name:f.name,px:f.px.slice(),rowCmt:f.rowCmt.slice(),extra:f.extra.slice(),cmt:f.cmt}}),extra:s.extra,headExtra:s.headExtra,cur:Math.min(s.cur,s.frames.length-1)};return now}
    var f=S.frames[u.fi];if(!f||f.px.length!==u.px.length)return null;
    var back={fi:u.fi,px:f.px.slice()};f.px.set(u.px);S.cur=u.fi;return back;
  }
  function doUndo(){var u=undo.pop();if(!u)return;var r=swapState(u);if(r)redo.push(r);setDirty(true);refreshAll()}
  function doRedo(){var u=redo.pop();if(!u)return;var r=swapState(u);if(r)undo.push(r);setDirty(true);refreshAll()}
  // ── header: pick a sprite, name, size ──
  var rowPick=el('div','spt-row');
  var pick=el('select','',null,rowPick);pick.setAttribute('aria-label','Sprite');
  var nameIn=el('input','spt-name',null,rowPick);nameIn.setAttribute('aria-label','Sprite name');nameIn.autocapitalize='off';nameIn.spellcheck=false;
  var rowSize=el('div','spt-row');
  el('span','spt-lbl','size',rowSize);
  var wIn=el('input','',null,rowSize);wIn.type='number';wIn.min=1;wIn.max=256;wIn.setAttribute('aria-label','Width');
  el('span','','×',rowSize);
  var hIn=el('input','',null,rowSize);hIn.type='number';hIn.min=1;hIn.max=256;hIn.setAttribute('aria-label','Height');
  var resizeB=btn('Resize','Resize the sprite (pixels keep their place, top left)',function(){
    var w=Math.round(+wIn.value),h=Math.round(+hIn.value);
    if(!(w>=1&&w<=256&&h>=1&&h<=256)){say('Width and height are 1 … 256');wIn.value=S.w;hIn.value=S.h;return}
    if(w===S.w&&h===S.h)return;
    structural(function(){resizeTo(w,h)});fitDone=false;fit();
  },rowSize);
  function resizeTo(w,h){
    S.frames.forEach(function(f){var n=blank(w,h);for(var y=0;y<Math.min(h,S.h);y++)for(var x=0;x<Math.min(w,S.w);x++)n[y*w+x]=f.px[y*S.w+x];f.px=n;f.rowCmt=[]});
    S.w=w;S.h=h;
  }
  pick.addEventListener('change',function(){
    var v=pick.value;
    if(dirty&&!confirm('Discard the changes to sprite '+S.name+'?')){pick.value=loaded||'';return}
    if(v==='\u0000new')load(null);else load(v);
  });
  nameIn.addEventListener('change',function(){
    var v=nameIn.value.trim();
    if(!/^[A-Za-z_]\w*$/.test(v)||KW.has(v)||TY.has(v)){say('A sprite name is a word: letters, digits and _, not starting with a digit (hero, coin_2)');nameIn.value=S.name;return}
    if(v!==S.name){S.name=v;setDirty(true);try{ctx.title('Sprite — '+S.name)}catch(e){}}
  });
  // ── stage: the painting canvas ──
  var stage=el('div','spt-stage');
  var cv=el('canvas','',null,stage);cv.setAttribute('aria-label','Sprite pixels');
  var zb=el('div','spt-zoom',null,stage);
  btn('−','Zoom out',function(){zoomAt(zoom/1.5,null)},zb);
  btn('⤢','Fit',function(){fitDone=false;fit()},zb);
  btn('+','Zoom in',function(){zoomAt(zoom*1.5,null)},zb);
  var g=cv.getContext('2d'),dpr=1,cw=300,ch=300;
  var img=document.createElement('canvas'),ig=img.getContext('2d'),onionImg=document.createElement('canvas'),og=onionImg.getContext('2d');
  // ── tools ──
  var rowTools=el('div','spt-row spt-tools');
  var TOOLS=[['pencil','✏️','Pencil'],['eraser','🧽','Eraser'],['fill','🪣','Fill'],['line','📏','Line'],['rect','▭','Rectangle'],['pick','💧','Eyedropper']],toolBtns={};
  TOOLS.forEach(function(t){toolBtns[t[0]]=btn(t[1],t[2],function(){setTool(t[0])},rowTools);toolBtns[t[0]].setAttribute('data-tool',t[0])});
  var mirB=btn('⇋','Mirror X: paint on both halves',function(){mirror=!mirror;mirB.classList.toggle('on',mirror);render()},rowTools);mirB.setAttribute('data-tool','mirror');
  var undoB=btn('↶','Undo',doUndo,rowTools),redoB=btn('↷','Redo',doRedo,rowTools);
  function setTool(t){if(t==='pick'&&tool!=='pick')prevTool=tool;tool=t;for(var k in toolBtns)toolBtns[k].classList.toggle('on',k===t)}
  function updUndo(){undoB.disabled=!undo.length;redoB.disabled=!redo.length}
  // ── palette ──
  el('div','spt-lbl','palette — tap a colour; ✎ changes it');
  var palBox=el('div','spt-pal');
  var rowPal=el('div','spt-row');
  var colIn=el('input','',null,rowPal);colIn.type='color';colIn.setAttribute('aria-label','Colour of the selected palette entry');colIn.style.cssText='width:44px;padding:2px';
  btn('+ colour','Add a colour to the palette',function(){
    if(S.palette.length>=35){say('A palette has at most 35 colours (1-9, a-z)');return}
    structural(function(){S.palette.push(S.palette[color-1]||'ffffff');color=S.palette.length});
  },rowPal);
  btn('− colour','Remove the selected colour (its pixels become transparent)',function(){
    if(color<1||!S.palette.length)return;
    var used=S.frames.some(function(f){return f.px.indexOf(color)>=0});
    if(used&&!confirm('Colour '+_SPR_CHARS[color]+' is used — its pixels become transparent. Remove it?'))return;
    structural(function(){
      var k=color;S.palette.splice(k-1,1);
      S.frames.forEach(function(f){for(var i=0;i<f.px.length;i++){var v=f.px[i];if(v===k)f.px[i]=0;else if(v>k)f.px[i]=v-1}});
      color=Math.min(k,S.palette.length);
    });
  },rowPal);
  btn('16 default','Use the default 16-colour palette',function(){
    var max=0;S.frames.forEach(function(f){for(var i=0;i<f.px.length;i++)if(f.px[i]>max)max=f.px[i]});
    if(max>16&&!confirm('Pixels use colours above 16 — they become transparent. Continue?'))return;
    structural(function(){S.palette=_SPR_DEFAULT_PAL.slice();S.frames.forEach(function(f){for(var i=0;i<f.px.length;i++)if(f.px[i]>16)f.px[i]=0});color=Math.min(Math.max(color,1),16)});
  },rowPal);
  var colSnap=null;
  colIn.addEventListener('input',function(){
    if(color<1)return;
    if(!colSnap)colSnap=snapAll();
    S.palette[color-1]=colIn.value.replace('#','').toLowerCase();setDirty(true);imgDirty=true;render();drawPal();drawFrames();
  });
  colIn.addEventListener('change',function(){if(colSnap){pushUndo(colSnap);colSnap=null}});
  // ── frames ──
  el('div','spt-lbl','frames');
  var frBox=el('div','spt-frames');
  var rowFr=el('div','spt-row');
  var frName=el('input','spt-name',null,rowFr);frName.setAttribute('aria-label','Frame name');frName.placeholder='frame name';frName.autocapitalize='off';frName.spellcheck=false;
  var rowFr2=el('div','spt-row');
  btn('+ frame','Add an empty frame after this one',function(){structural(function(){S.frames.splice(S.cur+1,0,{name:freeFrame(),px:blank(S.w,S.h),rowCmt:[],extra:[],cmt:''});nameFrames();S.cur++})},rowFr2);
  btn('⧉ copy','Duplicate this frame',function(){structural(function(){var f=S.frames[S.cur];S.frames.splice(S.cur+1,0,{name:freeFrame(),px:f.px.slice(),rowCmt:[],extra:[],cmt:''});nameFrames();S.cur++})},rowFr2);
  btn('🗑','Delete this frame',function(){if(S.frames.length<2){say('A sprite keeps at least one frame');return}structural(function(){S.frames.splice(S.cur,1);S.cur=Math.min(S.cur,S.frames.length-1)})},rowFr2);
  btn('◀','Move this frame left',function(){if(S.cur<1)return;structural(function(){var f=S.frames.splice(S.cur,1)[0];S.frames.splice(S.cur-1,0,f);S.cur--})},rowFr2);
  btn('▶','Move this frame right',function(){if(S.cur>=S.frames.length-1)return;structural(function(){var f=S.frames.splice(S.cur,1)[0];S.frames.splice(S.cur+1,0,f);S.cur++})},rowFr2);
  var onionB=btn('🧅','Onion skin: show the previous frame faintly',function(){onion=!onion;onionB.classList.toggle('on',onion);render()},rowFr2);onionB.classList.add('on');
  function freeFrame(){var n=S.frames.length,nm;do{nm='frame'+(n++)}while(S.frames.some(function(f){return f.name===nm}));return nm}
  function nameFrames(){S.frames.forEach(function(f,i){if(!f.name){var k=i,nm;do{nm='frame'+(k++)}while(S.frames.some(function(x){return x.name===nm}));f.name=nm}})}
  frName.addEventListener('change',function(){
    var v=frName.value.trim(),f=S.frames[S.cur];
    if(S.frames.length===1&&v===''&&f.name){structural(function(){f.name=''});return}
    if(!/^[A-Za-z_]\w*$/.test(v)){say('A frame name is a word: letters, digits and _ (idle, walk1)');frName.value=f.name;return}
    if(S.frames.some(function(x){return x!==f&&x.name===v})){say('Frame "'+v+'" already exists');frName.value=f.name;return}
    if(v!==f.name)structural(function(){f.name=v});
  });
  // ── preview ──
  el('div','spt-lbl','preview');
  var pv=el('div','spt-prev');
  var pcv=el('canvas','',null,pv),pg=pcv.getContext('2d');
  var pctl=el('div','spt-row',null,pv);
  var scaleBtns={},pscale=2;
  [1,2,4].forEach(function(s){scaleBtns[s]=btn(s+'×','Preview at '+s+'×',function(){pscale=s;for(var k in scaleBtns)scaleBtns[k].classList.toggle('on',+k===s);sizePreview()},pctl)});
  scaleBtns[2].classList.add('on');
  el('span','spt-lbl','fps',pctl);
  var fpsIn=el('input','',null,pctl);fpsIn.type='number';fpsIn.min=1;fpsIn.max=60;fpsIn.step=1;fpsIn.setAttribute('aria-label','Frames per second');
  var playing=true,playB=btn('⏸','Play / pause the preview',function(){playing=!playing;playB.textContent=playing?'⏸':'▶'},pctl);
  fpsIn.addEventListener('change',function(){var v=+fpsIn.value;if(!(v>0&&v<=240)){fpsIn.value=S.fps;say('fps is more than 0 and at most 240');return}if(v!==S.fps)structural(function(){S.fps=v;S.fpsGiven=true})});
  // ── import, messages ──
  var rowImp=el('div','spt-row');
  var fileIn=el('input','',null,rowImp);fileIn.type='file';fileIn.accept='image/png,image/*';fileIn.style.display='none';fileIn.setAttribute('aria-label','PNG file');
  btn('Import PNG…','Import a picture into this frame',function(){fileIn.click()},rowImp);
  btn('Clear frame','Make every pixel of this frame transparent',function(){structural(function(){S.frames[S.cur].px.fill(0)})},rowImp);
  var msgEl=el('div','spt-msg');
  function say(t){msgs=[t];msgEl.textContent=t}
  fileIn.addEventListener('change',function(){var f=fileIn.files&&fileIn.files[0];fileIn.value='';if(f)importFile(f)});
  // ── footer ──
  var saveB=document.createElement('button');saveB.type='button';saveB.textContent='Save';saveB.className='spt-save';
  saveB.style.cssText='font-family:var(--mono);font-size:13px;font-weight:700;min-height:40px;padding:0 18px;border-radius:8px;border:none;background:var(--cyan);color:var(--bg)';
  saveB.addEventListener('click',function(e){e.preventDefault();save()});
  try{(ctx.footer||root).appendChild(saveB)}catch(e){root.appendChild(saveB)}
  function save(){
    var nm=S.name;
    if(!/^[A-Za-z_]\w*$/.test(nm)){say('The sprite needs a name');return false}
    if(S.frames.length>1)nameFrames();
    var text=_sprFormat(toDef());
    if(loaded&&loaded!==nm){
      if(blocks().some(function(b){return b.name===nm})&&!confirm('Sprite '+nm+' already exists — replace it?'))return false;
      try{ctx.remove('sprite',loaded)}catch(e){}
    }else if(!loaded&&blocks().some(function(b){return b.name===nm})&&!confirm('Sprite '+nm+' already exists — replace it?'))return false;
    ctx.write('sprite',nm,text,'sprites.emit');
    loaded=nm;setDirty(false);
    try{ctx.toast('Saved sprite '+nm)}catch(e){}
    fillPick();
    return true;
  }
  // ── drawing helpers ──
  var imgDirty=true;
  function lut(){var L=new Uint32Array(36);S.palette.forEach(function(h,i){var v=parseInt(h,16);L[i+1]=((255<<24)|((v&255)<<16)|(((v>>8)&255)<<8)|((v>>16)&255))>>>0});return L}
  function paintInto(c,c2,px,L){
    if(c.width!==S.w||c.height!==S.h){c.width=S.w;c.height=S.h}
    var id=c2.createImageData(S.w,S.h),u=new Uint32Array(id.data.buffer);
    for(var i=0;i<px.length;i++)u[i]=L[px[i]];
    c2.putImageData(id,0,0);
  }
  function setCanvasSize(){
    var w=Math.max(120,Math.floor(stage.clientWidth||root.clientWidth||300)),h=Math.max(160,Math.min(w,Math.floor((window.innerHeight||600)*0.46)));
    stage.style.height=h+'px';
    dpr=Math.min(3,window.devicePixelRatio||1);
    if(cw!==w||ch!==h||cv.width!==Math.round(w*dpr)){cw=w;ch=h;cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr)}
  }
  function fit(){
    setCanvasSize();
    var z=Math.min((cw-16)/S.w,(ch-16)/S.h);
    zoom=z>=1?Math.floor(z):z;zoom=Math.max(0.25,Math.min(64,zoom));
    ox=Math.round((cw-S.w*zoom)/2);oy=Math.round((ch-S.h*zoom)/2);fitDone=stage.clientWidth>0;render();
  }
  function zoomAt(z,at){
    z=Math.max(0.25,Math.min(64,z));
    var cx=at?at.x:cw/2,cy=at?at.y:ch/2;
    ox=cx-(cx-ox)*z/zoom;oy=cy-(cy-oy)*z/zoom;zoom=z;render();
  }
  var raf=0,ver=0;
  function render(){ver++;if(raf)return;raf=requestAnimationFrame(function(){raf=0;draw()})}
  function draw(){
    if(!cv.isConnected)return;
    setCanvasSize();
    var L=lut(),f=S.frames[S.cur];
    if(imgDirty){paintInto(img,ig,f.px,L);imgDirty=false}
    g.setTransform(dpr,0,0,dpr,0,0);
    g.imageSmoothingEnabled=false;
    g.fillStyle='#0f1118';g.fillRect(0,0,cw,ch);
    var W=S.w*zoom,H=S.h*zoom;
    // transparent = a checkerboard behind the sprite
    var cs=Math.max(4,Math.round(zoom>=8?zoom/2:8));
    g.save();g.beginPath();g.rect(ox,oy,W,H);g.clip();
    g.fillStyle='#3a3f52';g.fillRect(ox,oy,W,H);g.fillStyle='#2a2e3d';
    for(var yy=0;yy*cs<H;yy++)for(var xx=(yy&1);xx*cs<W;xx+=2)g.fillRect(ox+xx*cs,oy+yy*cs,cs,cs);
    g.restore();
    if(onion&&S.cur>0){paintInto(onionImg,og,S.frames[S.cur-1].px,L);g.globalAlpha=0.3;g.drawImage(onionImg,ox,oy,W,H);g.globalAlpha=1}
    g.drawImage(img,ox,oy,W,H);
    if(stroke&&stroke.preview){
      g.fillStyle=stroke.v?'#'+S.palette[stroke.v-1]:'rgba(255,255,255,.5)';
      stroke.preview.forEach(function(p){g.fillRect(ox+p[0]*zoom,oy+p[1]*zoom,zoom,zoom)});
    }
    if(zoom>=6){
      g.strokeStyle='rgba(255,255,255,.12)';g.lineWidth=1;g.beginPath();
      for(var x=0;x<=S.w;x++){var X=Math.round(ox+x*zoom)+0.5;g.moveTo(X,oy);g.lineTo(X,oy+H)}
      for(var y=0;y<=S.h;y++){var Y=Math.round(oy+y*zoom)+0.5;g.moveTo(ox,Y);g.lineTo(ox+W,Y)}
      g.stroke();
    }
    if(mirror){g.strokeStyle='rgba(45,212,191,.8)';g.lineWidth=1.5;g.beginPath();g.moveTo(ox+W/2,oy-4);g.lineTo(ox+W/2,oy+H+4);g.stroke()}
    g.strokeStyle='rgba(255,255,255,.35)';g.lineWidth=1;g.strokeRect(ox-0.5,oy-0.5,W+1,H+1);
  }
  // ── pixel operations ──
  function inside(x,y){return x>=0&&y>=0&&x<S.w&&y<S.h}
  function plot(px,x,y,v){if(inside(x,y)){px[y*S.w+x]=v;if(mirror){var mx=S.w-1-x;px[y*S.w+mx]=v}}}
  function lineCells(x0,y0,x1,y1){var out=[],dx=Math.abs(x1-x0),dy=-Math.abs(y1-y0),sx=x0<x1?1:-1,sy=y0<y1?1:-1,e=dx+dy;for(;;){out.push([x0,y0]);if(x0===x1&&y0===y1)break;var e2=2*e;if(e2>=dy){e+=dy;x0+=sx}if(e2<=dx){e+=dx;y0+=sy}}return out}
  function rectCells(x0,y0,x1,y1){var out=[],a=Math.min(x0,x1),b=Math.max(x0,x1),c=Math.min(y0,y1),d=Math.max(y0,y1);for(var x=a;x<=b;x++){out.push([x,c]);if(d!==c)out.push([x,d])}for(var y=c+1;y<d;y++){out.push([a,y]);if(b!==a)out.push([b,y])}return out}
  function flood(px,x,y,v){
    if(!inside(x,y))return;
    var w=S.w,h=S.h,t=px[y*w+x];if(t===v)return;
    var st=[y*w+x];
    while(st.length){var i=st.pop();if(px[i]!==t)continue;px[i]=v;var cx=i%w,cy=(i-cx)/w;if(cx>0)st.push(i-1);if(cx<w-1)st.push(i+1);if(cy>0)st.push(i-w);if(cy<h-1)st.push(i+w)}
  }
  // ── pointers: one finger / the mouse paints, two fingers zoom and pan ──
  var ptrs=new Map(),stroke=null,gesture=null;
  function cellAt(e){var r=cv.getBoundingClientRect();var x=e.clientX-r.left,y=e.clientY-r.top;return{x:Math.floor((x-ox)/zoom),y:Math.floor((y-oy)/zoom),sx:x,sy:y}}
  function startStroke(e){
    var c=cellAt(e),f=S.frames[S.cur],v=tool==='eraser'?0:color;
    if(tool==='pick'){if(inside(c.x,c.y)){color=f.px[c.y*S.w+c.x];drawPal();setTool(prevTool==='pick'?'pencil':prevTool)}return}
    stroke={fi:S.cur,before:f.px.slice(),v:v,x0:c.x,y0:c.y,last:c,changed:false};
    if(tool==='fill'){flood(f.px,c.x,c.y,v);if(mirror)flood(f.px,S.w-1-c.x,c.y,v);endStroke();return}
    if(tool==='line'||tool==='rect'){stroke.preview=[[c.x,c.y]].filter(function(p){return inside(p[0],p[1])});render();return}
    plot(f.px,c.x,c.y,v);imgDirty=true;render();
  }
  function moveStroke(e){
    if(!stroke)return;
    var c=cellAt(e),f=S.frames[stroke.fi];
    if(c.x===stroke.last.x&&c.y===stroke.last.y)return;
    if(tool==='line'||tool==='rect'){
      var cells=(tool==='line'?lineCells:rectCells)(stroke.x0,stroke.y0,c.x,c.y);
      if(mirror)cells=cells.concat(cells.map(function(p){return[S.w-1-p[0],p[1]]}));
      stroke.preview=cells.filter(function(p){return inside(p[0],p[1])});stroke.last=c;render();return;
    }
    lineCells(stroke.last.x,stroke.last.y,c.x,c.y).forEach(function(p){plot(f.px,p[0],p[1],stroke.v)});
    stroke.last=c;imgDirty=true;render();
  }
  function endStroke(){
    if(!stroke)return;
    var f=S.frames[stroke.fi];
    if(stroke.preview){stroke.preview.forEach(function(p){f.px[p[1]*S.w+p[0]]=stroke.v})}
    var same=true;for(var i=0;i<f.px.length;i++)if(f.px[i]!==stroke.before[i]){same=false;break}
    if(!same){pushUndo({fi:stroke.fi,px:stroke.before});drawFrames()}
    stroke=null;imgDirty=true;render();
  }
  function cancelStroke(){if(!stroke)return;S.frames[stroke.fi].px.set(stroke.before);stroke=null;imgDirty=true;render()}
  function gestureInfo(){var a=Array.from(ptrs.values());var r=cv.getBoundingClientRect();var mx=(a[0].x+a[1].x)/2-r.left,my=(a[0].y+a[1].y)/2-r.top;return{d:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)||1,x:mx,y:my}}
  cv.addEventListener('pointerdown',function(e){
    e.preventDefault();
    try{cv.setPointerCapture(e.pointerId)}catch(x){}
    ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(ptrs.size===2){cancelStroke();gesture=gestureInfo();gesture.zoom=zoom;gesture.ox=ox;gesture.oy=oy;return}
    if(ptrs.size>2)return;
    if(e.button===1||e.button===2||(e.pointerType==='mouse'&&e.altKey)){gesture={pan:true,x:e.clientX,y:e.clientY,ox:ox,oy:oy};return}
    if(e.button===0||e.pointerType!=='mouse')startStroke(e);
  });
  cv.addEventListener('pointermove',function(e){
    if(!ptrs.has(e.pointerId))return;
    ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(gesture&&gesture.pan){ox=gesture.ox+e.clientX-gesture.x;oy=gesture.oy+e.clientY-gesture.y;render();return}
    if(gesture&&ptrs.size>=2){
      var n=gestureInfo(),z=Math.max(0.25,Math.min(64,gesture.zoom*n.d/gesture.d));
      /* the sprite point under the first midpoint stays under the fingers' midpoint */
      ox=n.x-(gesture.x-gesture.ox)*z/gesture.zoom;oy=n.y-(gesture.y-gesture.oy)*z/gesture.zoom;zoom=z;render();return;
    }
    if(!gesture){
      var evs=e.getCoalescedEvents?e.getCoalescedEvents():null;
      if(evs&&evs.length>1)evs.forEach(moveStroke);else moveStroke(e);
    }
  });
  function up(e){
    if(!ptrs.has(e.pointerId))return;
    ptrs.delete(e.pointerId);
    if(gesture){if(!ptrs.size)gesture=null;else if(gesture.pan)gesture=null;return}
    if(e.type==='pointercancel')cancelStroke();else endStroke();
  }
  cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
  cv.addEventListener('contextmenu',function(e){e.preventDefault()});
  cv.addEventListener('wheel',function(e){
    e.preventDefault();
    var r=cv.getBoundingClientRect(),at={x:e.clientX-r.left,y:e.clientY-r.top};
    if(e.shiftKey&&!e.ctrlKey){ox-=e.deltaY;oy-=e.deltaX;render();return}
    zoomAt(zoom*Math.pow(1.0015,-e.deltaY*(e.ctrlKey?4:1)),at);
  },{passive:false});
  root.addEventListener('keydown',function(e){
    if(e.target&&/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)doRedo();else doUndo()}
    else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();doRedo()}
  });
  root.tabIndex=-1;
  // ── PNG import: quantised to the palette (at most 35 colours) ──
  function importFile(file){
    var url=URL.createObjectURL(file),im=new Image();
    im.onload=function(){URL.revokeObjectURL(url);importImage(im)};
    im.onerror=function(){URL.revokeObjectURL(url);say('That file is not a picture this browser can read')};
    im.src=url;
  }
  function importImage(im){
    var w=im.naturalWidth||im.width,h=im.naturalHeight||im.height;
    if(!(w>0&&h>0)){say('The picture is empty');return}
    var k=Math.max(1,Math.ceil(Math.max(w,h)/256)),tw=Math.max(1,Math.floor(w/k)),th=Math.max(1,Math.floor(h/k));
    var c=document.createElement('canvas');c.width=tw;c.height=th;var cg=c.getContext('2d');cg.imageSmoothingEnabled=false;cg.drawImage(im,0,0,tw,th);
    importPixels(cg.getImageData(0,0,tw,th).data,tw,th,k>1);
  }
  function importPixels(data,w,h,scaled){
    var note=[];
    if(scaled)note.push('The picture was larger than 256 pixels: scaled down to '+w+'×'+h+'.');
    if(w!==S.w||h!==S.h){
      if(S.frames.length>1&&!confirm('The picture is '+w+'×'+h+', the sprite '+S.w+'×'+S.h+'. Resize every frame to '+w+'×'+h+'?'))return;
    }
    structural(function(){
      if(w!==S.w||h!==S.h)resizeTo(w,h);
      var cur=S.frames[S.cur];
      // palette entries other frames use stay (renumbered in order); the rest of the 35 slots go to the picture
      var used=new Set();S.frames.forEach(function(f){if(f!==cur)for(var i=0;i<f.px.length;i++)if(f.px[i])used.add(f.px[i])});
      var keepIx=Array.from(used).sort(function(a,b){return a-b}),map=new Uint8Array(36);
      keepIx.forEach(function(ix,i){map[ix]=i+1});
      S.frames.forEach(function(f){if(f!==cur)for(var i=0;i<f.px.length;i++)f.px[i]=map[f.px[i]]});
      var pal=keepIx.map(function(ix){return S.palette[ix-1]});
      var counts=new Map(),n=w*h;
      for(var i=0;i<n;i++){if(data[i*4+3]<128)continue;var rgb=(data[i*4]<<16)|(data[i*4+1]<<8)|data[i*4+2];counts.set(rgb,(counts.get(rgb)||0)+1)}
      var have=new Set(pal.map(function(hx){return parseInt(hx,16)})),fresh=[];
      counts.forEach(function(c,rgb){if(!have.has(rgb))fresh.push({rgb:rgb,n:c})});
      var slots=35-pal.length,reps;
      if(fresh.length<=slots)reps=fresh.map(function(x){return x.rgb});
      else{reps=_sprMedianCut(fresh,Math.max(0,slots));note.push('The picture has '+(counts.size)+' colours; it was reduced to '+(pal.length+reps.length)+' (a sprite has at most 35).')}
      reps.forEach(function(rgb){pal.push(('00000'+rgb.toString(16)).slice(-6))});
      S.palette=pal;
      var pr=pal.map(function(hx){var v=parseInt(hx,16);return[v>>16&255,v>>8&255,v&255]}),memo=new Map();
      for(var j=0;j<n;j++){
        if(data[j*4+3]<128){cur.px[j]=0;continue}
        var key=(data[j*4]<<16)|(data[j*4+1]<<8)|data[j*4+2],ix=memo.get(key);
        if(ix===undefined){
          var best=0,bd=1e9,r=data[j*4],gg=data[j*4+1],b=data[j*4+2];
          for(var q=0;q<pr.length;q++){var dr=pr[q][0]-r,dg=pr[q][1]-gg,db=pr[q][2]-b,dd=dr*dr*3+dg*dg*4+db*db*2;if(dd<bd){bd=dd;best=q+1}}
          ix=best;memo.set(key,ix);
        }
        cur.px[j]=ix;
      }
      color=Math.min(Math.max(color,1),S.palette.length);
    });
    fitDone=false;fit();
    msgs=note;msgEl.textContent=note.join('\n')||'Imported '+w+'×'+h+'.';
  }
  // ── UI refresh ──
  function fillPick(){
    pick.innerHTML='';
    var bl=blocks(),seen={};
    bl.forEach(function(b){if(seen[b.name])return;seen[b.name]=1;var o=document.createElement('option');o.value=b.name;o.textContent=b.name+(b.path?'  · '+b.path:'');pick.appendChild(o)});
    if(!loaded){var o2=document.createElement('option');o2.value='';o2.textContent=S.name+' (new)';pick.appendChild(o2)}
    var on=document.createElement('option');on.value='\u0000new';on.textContent='New sprite…';pick.appendChild(on);
    pick.value=loaded||'';
  }
  function drawPal(){
    palBox.innerHTML='';
    var tr=btn('','Transparent (eraser colour)',function(){color=0;drawPal()},palBox);tr.className='spt-sw tr'+(color===0?' sel':'');tr.setAttribute('data-ix','0');
    S.palette.forEach(function(hx,i){
      var b=btn(_SPR_CHARS[i+1],'Colour '+_SPR_CHARS[i+1]+' #'+hx,function(){color=i+1;if(tool==='eraser')setTool('pencil');drawPal()},palBox);
      b.className='spt-sw'+(color===i+1?' sel':'');b.style.background='#'+hx;b.setAttribute('data-ix',String(i+1));
    });
    if(color>0)colIn.value='#'+(S.palette[color-1]||'ffffff');
  }
  function drawFrames(){
    frBox.innerHTML='';var L=lut();
    S.frames.forEach(function(f,i){
      var b=btn('',null,function(){S.cur=i;imgDirty=true;refreshFrameSel();render()},frBox);
      b.className='spt-fr'+(i===S.cur?' sel':'');b.setAttribute('data-fi',String(i));b.title='Frame '+(f.name||i);
      var c=document.createElement('canvas');paintInto(c,c.getContext('2d'),f.px,L);b.appendChild(c);
      var s=document.createElement('span');s.textContent=f.name||'(unnamed)';b.appendChild(s);
    });
    frName.value=S.frames[S.cur].name;
  }
  function refreshFrameSel(){Array.prototype.forEach.call(frBox.children,function(b,i){b.classList.toggle('sel',i===S.cur)});frName.value=S.frames[S.cur].name}
  function sizePreview(){pcv.width=S.w*pscale;pcv.height=S.h*pscale;pcv.style.width=Math.min(S.w*pscale,(root.clientWidth||300)-8)+'px'}
  function refreshAll(){
    if(S.cur>=S.frames.length)S.cur=S.frames.length-1;
    if(color>S.palette.length)color=S.palette.length;
    nameIn.value=S.name;wIn.value=S.w;hIn.value=S.h;fpsIn.value=S.fps;
    fillPick();drawPal();drawFrames();sizePreview();updUndo();setTool(tool);
    msgEl.textContent=msgs.join('\n');
    imgDirty=true;if(!fitDone)fit();else render();
  }
  // animated preview
  var t0=performance.now();
  var pvC=document.createElement('canvas'),pvKey='';
  (function tick(){
    if(!root.isConnected&&performance.now()-t0>2000)return;
    if(root.isConnected&&S){
      var n=S.frames.length,i=playing?Math.floor((performance.now()-t0)/1000*S.fps)%n:S.cur,key=i+':'+ver+':'+pcv.width;
      if(key!==pvKey){pvKey=key;paintInto(pvC,pvC.getContext('2d'),S.frames[Math.min(i,n-1)].px,lut());pg.imageSmoothingEnabled=false;pg.clearRect(0,0,pcv.width,pcv.height);pg.drawImage(pvC,0,0,pcv.width,pcv.height)}
    }
    requestAnimationFrame(tick);
  })();
  try{new ResizeObserver(function(){if(S){if(!fitDone)fit();else render()}}).observe(stage)}catch(e){}
  // the sprite block the editor's cursor is in, else the first sprite of the project, else a new one
  var first=blocks()[0],atCur=null;
  try{var cl=ed.value.slice(0,ed.selectionStart).split('\n').length-1;_sprFindBlocks(ed.value).forEach(function(b){if(cl>=b.start&&cl<=b.end)atCur=b.name})}catch(e){}
  load(atCur&&blocks().some(function(b){return b.name===atCur})?atCur:first?first.name:null);
  // for tests and other tools: the open editor's state
  root._spt={state:function(){return S},save:save,load:load,undo:doUndo,redo:doRedo,setTool:setTool,view:function(){return{zoom:zoom,ox:ox,oy:oy,cw:cw,ch:ch,grid:zoom>=6}},drawNow:draw,
    importPixels:importPixels,setColor:function(c){color=c;drawPal()},setMirror:function(v){mirror=!!v;mirB.classList.toggle('on',mirror)},isDirty:function(){return dirty},text:function(){return _sprFormat(toDef())}};
  return root._spt;
}
// For other tools (tile pickers, previews) in the IDE: frame fi of a sprite as _sprParse returns it, drawn on a
// new canvas at an integer scale (the runtime registry of the running program is not touched).
function _sprFrameCanvas(d,fi,scale){
  scale=Math.max(1,scale|0||1);
  var f=d.frames[Math.max(0,Math.min(d.frames.length-1,fi|0))],c=document.createElement('canvas');c.width=d.w;c.height=d.h;
  var g=c.getContext('2d'),id=g.createImageData(d.w,d.h);
  for(var i=0;i<d.w*d.h;i++){var v=_SPR_CHARS.indexOf(f.data[i]);if(v>0){var h=parseInt(d.palette[v-1],16);id.data[i*4]=h>>16&255;id.data[i*4+1]=h>>8&255;id.data[i*4+2]=h&255;id.data[i*4+3]=255}}
  g.putImageData(id,0,0);
  if(scale===1)return c;
  var o=document.createElement('canvas');o.width=d.w*scale;o.height=d.h*scale;var og=o.getContext('2d');og.imageSmoothingEnabled=false;og.drawImage(c,0,0,o.width,o.height);
  return o;
}
// For other tools (STAGE's map view and legend, LOGIC's thing preview): sprite `name` of the program text as a
// canvas (its first frame, 1:1) — read through the drawer's ctx like every block, parsed with _sprParse
// (tolerant), cached in `cache` (one tool session: the text cannot change while a tool is open). null: no sprite.
function _sprBlockCanvas(ctx,cache,name){
  if(Object.prototype.hasOwnProperty.call(cache,name))return cache[name];
  var cv=null;
  try{
    var t=ctx.read('sprite',name);
    if(t){var d=_sprParse(String(t).split('\n'),1,true);if(d&&d.w>0&&d.h>0&&d.frames&&d.frames.length)cv=_sprFrameCanvas(d,0,1)}
  }catch(e){cv=null}
  cache[name]=cv;return cv;
}
// Median cut over weighted colours {rgb, n} → at most k colours (rgb ints), each the weighted mean of its box.
function _sprMedianCut(cols,k){
  if(k<=0)return[];
  var boxes=[cols.slice()];
  function range(b,s){var lo=255,hi=0;b.forEach(function(c){var v=(c.rgb>>s)&255;if(v<lo)lo=v;if(v>hi)hi=v});return hi-lo}
  while(boxes.length<k){
    var bi=-1,best=-1,sh=0;
    boxes.forEach(function(b,i){if(b.length<2)return;[16,8,0].forEach(function(s){var r=range(b,s);if(r>best){best=r;bi=i;sh=s}})});
    if(bi<0||best<=0)break;
    var b=boxes[bi].sort(function(p,q){return((p.rgb>>sh)&255)-((q.rgb>>sh)&255)}),tot=0,half=0,cut=1;
    b.forEach(function(c){tot+=c.n});
    for(var i=0;i<b.length-1;i++){half+=b[i].n;if(half*2>=tot){cut=i+1;break}cut=i+1}
    boxes.splice(bi,1,b.slice(0,cut),b.slice(cut));
  }
  return boxes.map(function(b){var r=0,g=0,bl=0,n=0;b.forEach(function(c){r+=((c.rgb>>16)&255)*c.n;g+=((c.rgb>>8)&255)*c.n;bl+=(c.rgb&255)*c.n;n+=c.n});return(Math.round(r/n)<<16)|(Math.round(g/n)<<8)|Math.round(bl/n)});
}
if(typeof _drawerRegister!=='function'){window._drawerTools=window._drawerTools||[];window._drawerRegister=function(t){window._drawerTools.push(t)}}
_drawerRegister({id:'sprite',label:'Sprite',icon:'🎨',desc:'Paint pixel sprites and their animation frames',open:_sprToolOpen});

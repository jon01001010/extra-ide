function toggleHelp(){document.getElementById('helpOverlay').classList.toggle('show')}

// Snippet Gallery — each snippet is code stored as a hash
var SNIPPETS=[
  {cat:'Game Helpers',title:'Player Movement',desc:'Arrow keys + WASD movement',
   code:'mut px = 150\nmut py = 150\nmut speed = 3\n\nfn movePlayer() {\n  if (keyDown(37) == 1) { px -= speed }\n  if (keyDown(39) == 1) { px += speed }\n  if (keyDown(38) == 1) { py -= speed }\n  if (keyDown(40) == 1) { py += speed }\n}'},
  {cat:'Game Helpers',title:'Bounce Physics',desc:'Ball bouncing off walls',
   code:'mut bx = 100\nmut by = 50\nmut dx = 4\nmut dy = 3\n\nfn bounceBall(w: int, h: int) {\n  bx += dx\n  by += dy\n  if (bx < 0) { dx = 0 - dx }\n  if (bx > w) { dx = 0 - dx }\n  if (by < 0) { dy = 0 - dy }\n  if (by > h) { dy = 0 - dy }\n}'},
  {cat:'Game Helpers',title:'Collision Check',desc:'Are two rectangles overlapping?',
   code:'fn hit(x1: int, y1: int, w1: int, h1: int, x2: int, y2: int, w2: int, h2: int) int {\n  return collides(x1, y1, w1, h1, x2, y2, w2, h2)\n}'},
  {cat:'Game Helpers',title:'Game Loop',desc:'60fps animation with canvas',
   code:'export fn game() {\n  canvas(400, 300)\n  animate()\n}\n\nexport fn frame() {\n  clear()\n  color(0, 0, 0)\n  rect(0, 0, 400, 300)\n  // draw stuff here\n}'},
  {cat:'Drawing',title:'Rainbow Gradient',desc:'Horizontal color gradient',
   code:'fn rainbow(w: int, h: int) {\n  let x = 0\n  while (x < w) {\n    let hue = x * 360 / w\n    mut r = 0\n    mut g = 0\n    mut b = 0\n    if (hue < 60) { r = 255; g = hue * 4 }\n    if (hue >= 60) { if (hue < 120) { r = 255 - (hue - 60) * 4; g = 255 } }\n    if (hue >= 120) { if (hue < 180) { g = 255; b = (hue - 120) * 4 } }\n    if (hue >= 180) { if (hue < 240) { g = 255 - (hue - 180) * 4; b = 255 } }\n    if (hue >= 240) { if (hue < 300) { r = (hue - 240) * 4; b = 255 } }\n    if (hue >= 300) { r = 255; b = 255 - (hue - 300) * 4 }\n    color(r, g, b)\n    rect(x, 0, 2, h)\n    x += 2\n  }\n}'},
  {cat:'Drawing',title:'Starfield',desc:'Random star background',
   code:'fn stars(w: int, h: int, count: int) {\n  color(0, 0, 0)\n  rect(0, 0, w, h)\n  let i = 0\n  while (i < count) {\n    let x = randInt(0, w)\n    let y = randInt(0, h)\n    let bright = randInt(100, 255)\n    color(bright, bright, bright)\n    pixel(x, y)\n    i++\n  }\n}'},
  {cat:'Drawing',title:'Grid Pattern',desc:'Draw a grid overlay',
   code:'fn grid(w: int, h: int, gap: int) {\n  color(40, 40, 60)\n  let x = 0\n  while (x <= w) {\n    line(x, 0, x, h)\n    x += gap\n  }\n  let y = 0\n  while (y <= h) {\n    line(0, y, w, y)\n    y += gap\n  }\n}'},
  {cat:'Math',title:'Map Range',desc:'Map value from one range to another',
   code:'fn mapRange(val: num, inLo: num, inHi: num, outLo: num, outHi: num) num {\n  return outLo + (val - inLo) * (outHi - outLo) / (inHi - inLo)\n}'},
  {cat:'Math',title:'Smooth Step',desc:'Ease in/out interpolation',
   code:'fn smoothstep(a: num, b: num, t: num) num {\n  let x = clamp((t - a) / (b - a), 0.0, 1.0)\n  return x * x * (3.0 - 2.0 * x)\n}'},
  {cat:'UI',title:'Score Display',desc:'Show score on canvas',
   code:'fn drawScore(label: str, val: int, x: int, y: int) {\n  color(255, 255, 255)\n  text(label, x, y, 14)\n  print(val)\n}'},
  {cat:'UI',title:'Button Bar',desc:'Row of action buttons',
   code:'fn buttonBar() {\n  button("Play", 1)\n  button("Pause", 2)\n  button("Reset", 3)\n}\n\nexport fn onclick_1() { div("Playing!") }\nexport fn onclick_2() { div("Paused!") }\nexport fn onclick_3() { div("Reset!") }'},
  {cat:'3D',title:'3D Scene Setup',desc:'Quick Three.js scene with controls',
   code:'use three.js\n\nfn setup3d() {\n  scene3d(400, 300)\n  bgColor3d(20, 20, 40)\n  grid3d(10, 10)\n  ambient3d(80, 80, 100)\n  light3d(5.0, 8.0, 5.0)\n  camera3d(4.0, 3.0, 4.0)\n  lookAt3d(0.0, 0.0, 0.0)\n  controls3d()\n}'},
  {cat:'3D',title:'Tree',desc:'Simple 3D tree from shapes',
   code:'fn tree(x: num, z: num) {\n  let trunk = cylinder(x, 0.5, z, 0.1, 1.0)\n  color3d(trunk, 100, 60, 30)\n  let leaves = sphere(x, 1.3, z, 0.5)\n  color3d(leaves, 30, 140, 40)\n}'},
  {cat:'Sound',title:'Coin Sound',desc:'Classic coin pickup beep',
   code:'fn coinSound() {\n  beep(880, 60)\n  beep(1175, 120)\n}'},
  {cat:'Sound',title:'Jump Sound',desc:'Ascending tone for jumping',
   code:'fn jumpSound() {\n  beep(200, 40)\n  beep(400, 40)\n  beep(600, 60)\n}'},
  {cat:'Data',title:'High Score',desc:'Save and load best score',
   code:'fn checkHighScore(score: int) {\n  let best = load("highscore")\n  if (score > best) {\n    save("highscore", score)\n    printStr("New high score!")\n    print(score)\n  }\n}'},
];

function toggleSnippets(){document.getElementById('snipOverlay').classList.toggle('show');renderSnippets()}
function toggleLibs(){document.getElementById('libsOverlay').classList.toggle('show');renderLibs()}
// Scan the current source for `use <name>` lines. Returns a Set of library names.
function activeUses(){
  var src=_projText();
  var used=new Set();
  // Same parsing and name resolution as the loader (_parseUses): `use three`, `use three.js as T`, comments, quotes.
  // Line by line, so one malformed use line does not hide the others.
  src.split('\n').forEach(function(line){
    if(!/^\s*use\s/i.test(line))return;
    try{_parseUses(line).forEach(function(u){if(u.lib)used.add(u.lib.name)})}catch(e){}
  });
  return used;
}
function renderLibs(){
  var el=document.getElementById('libsContent');
  var used=activeUses();
  // Partition LIBS into active vs available
  var active=LIBS.filter(function(l){return used.has(l.name)});
  var available=LIBS.filter(function(l){return !used.has(l.name)});
  var html='<h1 style="font-family:var(--mono);color:var(--cyan);font-size:18px;margin-bottom:8px">&#x1F4DA; Libraries</h1>';
  html+='<p style="color:var(--fg3);font-size:12px;margin-bottom:16px">Each library loads from CDN at runtime via <code style="color:var(--blue)">use &lt;name&gt;</code>. Tap a line to insert it at the cursor; <b>Example</b> puts a small working program in the editor.</p>';
  html+=_libPanelLoaded();
  html+='<div id="libCacheLine"></div>';   // filled by _libCacheLine() when the offline cache is not empty
  // Active section
  html+='<div class="snip-cat">Active in this program ('+active.length+')</div>';
  if(active.length===0){
    html+='<div class="lib-empty">None. Add a library below, or type <code>use &lt;name&gt;</code> at the top.</div>';
  }else{
    active.forEach(function(l){html+=renderLibCard(l,true)});
  }
  // Group remaining libs by category
  var byCat={};
  available.forEach(function(l){var c=l.cat||'other';if(!byCat[c])byCat[c]=[];byCat[c].push(l)});
  var cats=Object.keys(byCat).sort();
  cats.forEach(function(c){
    html+='<div class="snip-cat">'+c+'</div>';
    byCat[c].forEach(function(l){html+=renderLibCard(l,false)});
  });
  el.innerHTML=html;
  _libCacheLine();
}
function renderLibCard(l,isActive){
  var h='<div class="lib-card'+(isActive?' active':'')+'">';
  h+='<div class="lib-head"><div><div class="lib-name">'+l.name+'</div><div class="lib-desc">'+l.desc+'</div></div>';
  var li=LIBS.indexOf(l);
  h+='<div style="display:flex;gap:6px;flex-shrink:0;align-items:center">';
  if(l.example)h+='<button class="lib-add" onclick="loadLibExample('+li+')" title="Put a small working '+l.name+' program in the editor">Example</button>';
  if(isActive){h+='<span class="lib-added">in use</span>';}
  else{h+='<button class="lib-add" onclick="addLibUse(\''+l.name+'\')">+ Add</button>';}
  h+='</div></div>';
  h+=_libPanelInfo(l);
  // Catalogue: wrapper builtins, then the library's own names — each row shows exactly the text a tap inserts
  var rows=_libCatRows(l);
  if(rows.length){
    var esc=function(t){return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')};
    h+='<div class="lib-methods">';
    rows.forEach(function(r,ri){
      var t=esc(r.text),k=r.ctor?4:0;
      if(r.root&&r.kind!=='inst')t=esc(r.text.substring(0,k))+'<span class="lib-global">'+r.root+'</span>'+esc(r.text.substring(k+r.root.length));
      h+='<div class="lib-method" onclick="insertLibRow('+li+','+ri+')">'+t+(r.note?' <span style="color:var(--fg3)">\u2014 '+esc(r.note)+'</span>':'')+'</div>';
    });
    h+='</div>';
  }
  h+='</div>';
  return h;
}
// Tap on a catalogue row: insert its text at the cursor.
function insertLibRow(li,ri){
  var l=LIBS[li],r=l&&_libCatRows(l)[ri];if(!r)return;
  var pos=ed.selectionStart;
  ed.value=ed.value.substring(0,pos)+r.text+ed.value.substring(pos);
  ed.selectionStart=ed.selectionEnd=pos+r.text.length;
  toggleLibs();
  updGutter();hlCode();ed.focus();
}
// "Example" button: replace the editor contents with the entry's example program.
function loadLibExample(li){
  var l=LIBS[li];if(!l||!l.example)return;
  var cur=_projText().trim();
  if(cur&&cur!==l.example.trim()&&!confirm('Replace the program in the editor with the '+l.name+' example?'))return;
  _projLoad(l.example+'\n');_projSave();
  toggleLibs();
  ed.focus();
}
function addLibUse(name){
  // Insert `use <name>` at the top of the entry file (after any existing use lines).
  var src=_projEntrySource();
  var lines=src.split('\n');
  // Find the last existing `use` line, insert after it. If none, insert at the very top.
  var insertAt=0;
  for(var i=0;i<lines.length;i++){
    if(/^\s*use\s+/.test(lines[i]))insertAt=i+1;
    else if(lines[i].trim()!=='')break;
  }
  lines.splice(insertAt,0,'use '+name);
  _projSetEntrySource(lines.join('\n'));
  renderLibs();  // refresh the panel to show it as active now
}
function renderSnippets(){
  var el=document.getElementById('snipContent');
  var html='<h1 style="font-family:var(--mono);color:var(--cyan);font-size:18px;margin-bottom:12px">Snippets</h1>';
  html+='<p style="color:var(--fg3);font-size:12px;margin-bottom:16px">Tap to insert into editor. Share any snippet as a URL.</p>';
  var lastCat='';
  SNIPPETS.forEach(function(s,i){
    if(s.cat!==lastCat){html+='<div class="snip-cat">'+s.cat+'</div>';lastCat=s.cat}
    var preview=s.code.split('\n').slice(0,3).join('\n');
    html+='<div class="snip-card" onclick="insertSnippet('+i+')">';
    html+='<div class="snip-title">'+s.title+'</div>';
    html+='<div class="snip-desc">'+s.desc+'</div>';
    html+='<div class="snip-code">'+preview.replace(/</g,'&lt;')+'</div>';
    html+='</div>';
  });
  el.innerHTML=html;
}
function insertSnippet(idx){
  var s=SNIPPETS[idx];
  var pos=ed.selectionStart;
  var before=ed.value.substring(0,pos);
  var after=ed.value.substring(pos);
  // Add newlines if needed
  var insert=(before.length&&!before.endsWith('\n')?'\n':'')+s.code+'\n';
  ed.value=before+insert+after;
  ed.selectionStart=ed.selectionEnd=pos+insert.length;
  toggleSnippets();
  updGutter();hlCode();ed.focus();
}
// LZString — minimal URI-safe compression
// 01001010 01001111 01001110
// Compress/decompress using CompressionStream API (deflate-raw)
var LZ={
c:async function(s){
  if(!s)return'';
  var blob=new Blob([new TextEncoder().encode(s)]);
  var cs=new CompressionStream('deflate-raw');
  var stream=blob.stream().pipeThrough(cs);
  var buf=await new Response(stream).arrayBuffer();
  var bytes=new Uint8Array(buf);
  var bin='';for(var i=0;i<bytes.length;i++)bin+=String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
},
d:async function(s){
  if(!s)return'';
  s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';
  var bin=atob(s);var bytes=new Uint8Array(bin.length);
  for(var i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  var blob=new Blob([bytes]);
  var ds=new DecompressionStream('deflate-raw');
  var stream=blob.stream().pipeThrough(ds);
  return await new Response(stream).text()
}};
async function shareURL(){
  var src=_projText();if(!src.trim()){return}
  var compressed=await LZ.c(src);
  var url=location.href.split('#')[0]+'#'+compressed;
  if(navigator.clipboard){navigator.clipboard.writeText(url).then(function(){alert('Link copied! ('+url.length+' chars, '+Math.round(compressed.length/src.length*100)+'% of original)')}).catch(function(){prompt('Copy this link:',url)})}
  else{prompt('Copy this link:',url)}
}
// Load from URL on startup
async function loadFromURL(){
  var hash=location.hash.substring(1);
  if(hash&&hash.length>2){
    try{await null;var src=await LZ.d(hash);if(src&&src.length>0){_projLoad(src);return true}}catch(e){}
  }
  return false
}
function stopProgram(){_animRunning=false;setStatus('idle','Stopped')}
stopProgram=(function(stop){return function(){_awaitGen++;_frameBusy=false;return stop.apply(this,arguments)}})(stopProgram); // calls waiting in an `await` are never resumed
function _download(name,content,type){var b=new Blob([content],{type:type});var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;a.click();URL.revokeObjectURL(a.href)}
function importFile(){
  var inp=document.createElement('input');inp.type='file';inp.accept='.emit,.txt,.jawa';inp.multiple=true;
  inp.addEventListener('change',function(){
    if(!inp.files.length)return;
    _projOpenFiles(inp.files);   // one file or several: see _projOpenTexts
  });
  inp.click();
}

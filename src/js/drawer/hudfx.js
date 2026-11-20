// ═══ HUD and PARTICLES tools (the editor half of HUD & PARTICLES: compiler/hudfx.js, runtime/hudfx.js) ═══
// HUD: the items of a hud block (text / icons / bar) as a list — add, remove, reorder; each item's text with
// chips of the program's global variables, the 3×3 anchor grid, below, size and colour; a live preview drawn
// over the last frame of the game (or a sample screen). PARTICLES: presets, a slider per setting (min..max
// pairs for ranges), colours, and a looping preview canvas: a tap bursts at that point. Both write their block
// with ctx.write (hud → hud.emit, particles → hud.emit when new), the block text is the only copy.
// Also here: highlighting of the two block kinds, autocomplete for hud( / burst( / emitter( names and the
// block snippets, and the builtins' descriptions in the builtin autocomplete.
// Test hooks: the tools' root elements carry ._hud / ._fx (state and a small API).
var _HFX_PREVIEW_W=320,_HFX_PREVIEW_H=240;
var _hudLastFrame=null;   // the game's last frame before the HUD was painted (for the HUD tool's preview)
_hudPaint=(function(paint){return function(g){
  try{
    var c=g&&g.canvas;
    if(c&&c.width&&c.height&&c.width<=2048&&c.height<=2048){
      var f=_hudLastFrame;
      if(!f||f.width!==c.width||f.height!==c.height){f=document.createElement('canvas');f.width=c.width;f.height=c.height}
      var fg=f.getContext('2d');if(fg){fg.clearRect(0,0,f.width,f.height);fg.drawImage(c,0,0)}
      _hudLastFrame=f;
    }
  }catch(e){}
  return paint.apply(this,arguments);
}})(_hudPaint);
// The program's global variables (for the HUD tool's chips): top-level let / mut and rules auto-globals
function _hfxGlobals(){
  var text='',out=[],seen={};
  try{text=_projText()}catch(e){text=ed.value}
  function add(n){var k=n.toLowerCase();if(!seen[k]&&!/^__/.test(n)){seen[k]=1;out.push(n)}}
  text.replace(/^(?:public\s+)?(?:mut|let)\s+([A-Za-z_]\w*)/gm,function(m,n){add(n)});
  try{
    _emitScanBlocks(text).forEach(function(b){
      if(b.kind!=='rules')return;
      var L=text.split('\n').slice(b.start,b.end+1).join('\n');
      L.replace(/(?:^|[:\s])(?:set|add)\s+([A-Za-z_]\w*)(?![\w.])/gim,function(m,n){add(n)});
    });
  }catch(e){}
  return out;
}
// The size of the game screen: the last canvas, else stage size W H, else 320×240
function _hfxStageSize(){
  try{if(_canvas&&_canvas.width>0)return{w:_canvas.width,h:_canvas.height,live:true}}catch(e){}
  try{var m=/^[ \t]+stage[ \t]+size[ \t]+(\d+)[ \t,]+(\d+)/mi.exec(_projText());if(m)return{w:Math.min(1024,+m[1]),h:Math.min(1024,+m[2])}}catch(e){}
  return{w:_HFX_PREVIEW_W,h:_HFX_PREVIEW_H};
}
// A sample screen behind the preview: sky, ground, a few coins
function _hfxSample(g,W,H){
  var gr=g.createLinearGradient(0,0,0,H);gr.addColorStop(0,'#29366f');gr.addColorStop(1,'#1a1c2c');
  g.fillStyle=gr;g.fillRect(0,0,W,H);
  g.fillStyle='#333c57';g.fillRect(0,Math.round(H*0.8),W,H-Math.round(H*0.8));
  g.fillStyle='#566c86';for(var x=0;x<W;x+=16)g.fillRect(x,Math.round(H*0.8),15,3);
  g.fillStyle='#ffcd75';[[0.3,0.5],[0.5,0.42],[0.7,0.5]].forEach(function(p){g.beginPath();g.arc(Math.round(W*p[0]),Math.round(H*p[1]),5,0,Math.PI*2);g.fill()});
  g.fillStyle='#5fcde4';g.fillRect(Math.round(W*0.15),Math.round(H*0.8)-14,12,14);
}
// ── HUD tool ──
function _hudRead(b){
  var body=_drawerBody(b.text,'hud'),r=_hudParse(body);
  return{name:b.name,orig:b.name,items:r.spec.items.map(function(it){var c=JSON.parse(JSON.stringify(it));delete c.off;return c}),err:r.errors[0]?r.errors[0].msg:null,dirty:false};
}
function _hudNewItem(kind,vars,sprites){
  var v=vars[0]||'score';
  if(kind==='icons')return{kind:'icons',sprite:{name:(sprites&&sprites[0])||'heart'},count:{name:vars.filter(function(n){return/live|hp|heart/i.test(n)})[0]||v},v:'top',h:'right',below:false,size:1,color:null};
  if(kind==='bar')return{kind:'bar',value:{name:vars.filter(function(n){return/hp|health|energy|power/i.test(n)})[0]||v},min:{num:0},max:{num:100},v:'bottom',h:'left',below:false,size:1,color:null,width:60,height:null};
  return{kind:'text',parts:['Score: ',{name:v}],v:'top',h:'left',below:false,size:1,color:null};
}
function _hudPartsText(parts){return(parts||[]).map(function(p){return typeof p==='string'?p.replace(/\{/g,'{{').replace(/\}/g,'}}'):'{'+p.name+'}'}).join('')}
function _drawerHudTool(ctx){
  var list=ctx.blocks('hud').map(_hudRead),cur=0,ui={},vars=_hfxGlobals();
  var sprites=[];try{sprites=ctx.blocks('sprite').map(function(b){return b.name})}catch(e){}
  if(!list.length)list.push({name:'main',orig:null,items:[_hudNewItem('text',vars,sprites)],err:null,dirty:true});
  function S(){return list[cur]}
  function names(except){return list.filter(function(x,i){return i!==except}).map(function(x){return x.name})}
  function textOf(it){return _hudWrite(it.name,{items:it.items})}
  function dirty(){var any=false;list.forEach(function(it){if(it.dirty)any=true});ctx.setDirty(any)}
  function changed(rebuild){S().dirty=true;dirty();if(rebuild)build();else refresh()}
  // sample values for the preview: live values of the running game when it has them, else a sample
  function live(){
    var map={};
    try{if(_hudMeta&&window._wi)_hudMeta.huds.forEach(function(h){h.items.forEach(function(it){[it.count,it.value,it.min,it.max].concat(it.parts||[]).forEach(function(r){if(r&&typeof r==='object'&&r.name&&r.i!==undefined)map[r.name.toLowerCase()]=r})})})}catch(e){}
    return map;
  }
  function val(r){
    if(!r)return 0;if(r.num!==undefined)return r.num;
    var L=ui.live&&ui.live[String(r.name).toLowerCase()];
    if(L){try{return _hudVal(L)}catch(e){}}
    var n=String(r.name).toLowerCase();
    if(/live|heart|hp/.test(n))return 3;
    if(/health|energy|power/.test(n))return 70;
    if(/msg|message|text|name/.test(n))return'Ready!';
    return 42;
  }
  function paint(){
    var cv=ui.cv,g=cv&&cv.getContext('2d');if(!g)return;
    var W=cv.width,H=cv.height;
    g.clearRect(0,0,W,H);g.imageSmoothingEnabled=false;
    var bg=_hudLastFrame&&_hudLastFrame.width===W&&_hudLastFrame.height===H?_hudLastFrame:(_canvas&&_canvas.width===W&&_canvas.height===H&&!_hudMeta?_canvas:null);
    if(bg){try{g.drawImage(bg,0,0)}catch(e){_hfxSample(g,W,H)}}else _hfxSample(g,W,H);
    ui.bgNote.textContent=bg?'Preview over the last frame of your game'+(Object.keys(ui.live).length?' (live values)':''):'Preview over a sample screen — run the game to see it over your own';
    try{_hudPaintSpec(g,W,H,S().items,val)}catch(e){}
  }
  function refresh(){
    ui.code.textContent=textOf(S());
    ui.chips.querySelectorAll('.drw-chip').forEach(function(c,i){if(list[i])c.classList.toggle('dirty',!!list[i].dirty)});
    paint();
  }
  function anchorGrid(it){
    var box=_drwEl('div',{cls:'hfx-grid',role:'radiogroup','aria-label':'Where on the screen'});
    ['top','middle','bottom'].forEach(function(v){['left','center','right'].forEach(function(h){
      var on=it.v===v&&it.h===h;
      box.appendChild(_drwEl('button',{type:'button',role:'radio','aria-checked':on?'true':'false','aria-label':v+' '+h,title:v+' '+h,'data-anchor':v+' '+h,cls:on?'on':null,on:{click:function(){it.v=v;it.h=h;Array.prototype.forEach.call(box.children,function(b){var o=b.getAttribute('data-anchor')===v+' '+h;b.classList.toggle('on',o);b.setAttribute('aria-checked',o?'true':'false')});changed(false)}}}));
    })});
    return box;
  }
  function refSel(r,label,allowNum,onSet){
    /* a variable (chips) or, where allowed, a number */
    var inp=_drwEl('input',{type:'text',cls:'drw-name hfx-ref',value:r?(r.num!==undefined?String(r.num):r.name):'','aria-label':label,autocomplete:'off',autocapitalize:'none',spellcheck:'false',list:'hfx-vars'});
    inp.addEventListener('change',function(){
      var t=inp.value.trim();
      if(allowNum&&/^-?\d+(\.\d+)?$/.test(t)){onSet({num:Number(t)});changed(false);return}
      if(!/^[A-Za-z_]\w*$/.test(t)){ctx.toast(allowNum?'A variable name or a number':'A variable name');inp.value=r?(r.num!==undefined?String(r.num):r.name):'';return}
      onSet({name:t});changed(false);
    });
    return inp;
  }
  function itemCard(it,ix){
    var n=S().items.length;
    var head=_drwEl('div',{cls:'drw-row hfx-ihead'},[
      _drwSeg([['text','text'],['icons','icons'],['bar','bar']],function(){return it.kind},function(k){if(k===it.kind)return;var fresh=_hudNewItem(k,vars,sprites);fresh.v=it.v;fresh.h=it.h;fresh.below=it.below;fresh.size=it.size;S().items[ix]=fresh;changed(true)},'Kind of item'),
      _drwEl('span',{cls:'hfx-sp'}),
      _drwBtn('↑',function(){if(ix>0){var a=S().items;a.splice(ix-1,0,a.splice(ix,1)[0]);changed(true)}},'drw-sm'+(ix===0?' hfx-dis':''),'Move up'),
      _drwBtn('↓',function(){if(ix<n-1){var a=S().items;a.splice(ix+1,0,a.splice(ix,1)[0]);changed(true)}},'drw-sm'+(ix===n-1?' hfx-dis':''),'Move down'),
      _drwBtn('×',function(){S().items.splice(ix,1);changed(true)},'drw-sm drw-danger','Remove this item')
    ]);
    var card=_drwEl('div',{cls:'drw-group hfx-item','data-item':String(ix)},[head]);
    if(it.kind==='text'){
      var ti=_drwEl('input',{type:'text',cls:'drw-name hfx-text',value:_hudPartsText(it.parts),'aria-label':'Text to show','data-f':'text',autocomplete:'off',spellcheck:'false'});
      function setText(){
        var errs=[],parts=_hudParts(ti.value,0,function(o,m){errs.push(m)});
        if(errs.length){ti.classList.add('hfx-bad');ti.title=errs[0];return false}
        ti.classList.remove('hfx-bad');ti.title='';it.parts=parts;changed(false);return true;
      }
      ti.addEventListener('input',setText);
      /* where a chip inserts: the last cursor position in the field, or its end when it was never focused */
      ['select','keyup','click','input','blur'].forEach(function(ev){ti.addEventListener(ev,function(){ti._sel=[ti.selectionStart,ti.selectionEnd]})});
      card.appendChild(_drwEl('div',{cls:'drw-row'},[_drwEl('label',{cls:'drw-lab',text:'Text'}),ti]));
      var chips=_drwEl('div',{cls:'drw-chips hfx-vchips','aria-label':'Insert a variable'});
      vars.forEach(function(v){chips.appendChild(_drwBtn('{'+v+'}',function(){
        var s=ti._sel?ti._sel[0]:ti.value.length,e=ti._sel?ti._sel[1]:s;
        ti.value=ti.value.slice(0,s)+'{'+v+'}'+ti.value.slice(e);setText();
        ti._sel=[s+v.length+2,s+v.length+2];
      },'drw-chip','Insert {'+v+'}'))});
      if(!vars.length)chips.appendChild(_drwEl('span',{cls:'drw-dim',text:'No global variables yet — declare one (mut score = 0) or set one in the rules (add score 1).'}));
      card.appendChild(chips);
    }else if(it.kind==='icons'){
      var opts=sprites.concat(it.sprite&&sprites.indexOf(it.sprite.name)<0?[it.sprite.name]:[]);
      var sel=_drwEl('select',{cls:'drw-name hfx-sel','aria-label':'Sprite','data-f':'sprite'});
      opts.forEach(function(s){sel.appendChild(new Option(s,s))});sel.value=it.sprite?it.sprite.name:'';
      sel.addEventListener('change',function(){it.sprite={name:sel.value};changed(false)});
      card.appendChild(_drwEl('div',{cls:'drw-row'},[_drwEl('label',{cls:'drw-lab',text:'Sprite'}),opts.length?sel:_drwEl('span',{cls:'drw-dim',text:'No sprites yet — draw one with 🧰 → Sprite (e.g. heart)'})]));
      card.appendChild(_drwEl('div',{cls:'drw-row'},[_drwEl('label',{cls:'drw-lab',text:'How many'}),refSel(it.count,'How many (a variable or a number)',true,function(r){it.count=r})]));
    }else{
      card.appendChild(_drwEl('div',{cls:'drw-row'},[_drwEl('label',{cls:'drw-lab',text:'Value'}),refSel(it.value,'Value (a variable)',false,function(r){it.value=r})]));
      card.appendChild(_drwEl('div',{cls:'drw-row'},[_drwEl('label',{cls:'drw-lab',text:'From'}),refSel(it.min,'Lowest value',true,function(r){it.min=r}),_drwEl('label',{cls:'drw-lab',text:'to'}),refSel(it.max,'Highest value',true,function(r){it.max=r})]));
      card.appendChild(_drwSlider({label:'Width',min:8,max:300,get:function(){return it.width||50},set:function(v,done){it.width=Math.round(v);changed(false)},fmt:function(v){return String(Math.round(v))},unit:'px'}));
    }
    var below=_drwEl('input',{type:'checkbox',id:'hfxBelow'+ix,'aria-label':'Below the item before it at the same place'});below.checked=!!it.below;
    below.addEventListener('change',function(){it.below=below.checked;changed(false)});
    var col=_drwEl('input',{type:'color',cls:'hfx-col','aria-label':'Colour',value:it.color||(it.kind==='bar'?'#38b764':'#ffffff')});
    col.addEventListener('input',function(){it.color=col.value;changed(false)});
    var colX=_drwBtn('default',function(){it.color=null;col.value=it.kind==='bar'?'#38b764':'#ffffff';changed(false)},'drw-sm','Default colour');
    card.appendChild(_drwEl('div',{cls:'hfx-place'},[
      anchorGrid(it),
      _drwEl('div',{cls:'hfx-pside'},[
        _drwEl('div',{cls:'drw-row'},[below,_drwEl('label',{'for':'hfxBelow'+ix,cls:'drw-ck',text:'below the one before'})]),
        _drwEl('div',{cls:'drw-row'},[_drwEl('span',{cls:'drw-lab',text:'Colour'}),col,colX])
      ])
    ]));
    card.appendChild(_drwEl('div',{cls:'drw-row'},[_drwEl('span',{cls:'drw-lab',text:'Size'}),_drwSeg([[1,'1'],[2,'2'],[3,'3'],[4,'4']],function(){return it.size||1},function(v){it.size=Number(v);changed(false)},'Size')]));
    return card;
  }
  function build(){
    var b=ctx.body,it=S();b.innerHTML='';ui.live=live();
    var root=_drwEl('div',{cls:'hfx','data-hud-tool':''});b.appendChild(root);
    root._hud={list:list,cur:function(){return cur},S:S,text:function(){return textOf(S())},save:save,build:build,paint:paint};
    ui.chips=_drwChips(list,cur,function(i){cur=i;build()},function(){
      var n=_drwFreeName('hud',names(-1));list.push({name:n,orig:null,items:[_hudNewItem('text',vars,sprites)],err:null,dirty:true});cur=list.length-1;dirty();build();
    },'+ New HUD');
    root.appendChild(ui.chips);
    var nameIn=_drwEl('input',{type:'text',cls:'drw-name',value:it.name,'aria-label':'HUD name',autocomplete:'off',autocapitalize:'none',spellcheck:'false'});
    nameIn.addEventListener('change',function(){
      var n=nameIn.value.trim();
      if(!_drwNameOk(n)){ctx.toast('A name is letters, digits and _ (not starting with a digit)');nameIn.value=it.name;return}
      if(names(cur).map(function(x){return x.toLowerCase()}).indexOf(n.toLowerCase())>=0){ctx.toast('There is already a HUD called '+n);nameIn.value=it.name;return}
      if(n!==it.name){it.name=n;changed(false);ui.chips.children[cur].textContent=n}
    });
    root.appendChild(_drwEl('div',{cls:'drw-row'},[_drwEl('label',{cls:'drw-lab',text:'Name'}),nameIn]));
    if(it.err)root.appendChild(_drwEl('p',{cls:'drw-err',text:'This block has a line the tool cannot read: '+it.err+' — the lines after it are not shown, and Save writes only what you see.'}));
    var st=_hfxStageSize();
    ui.cv=_drwEl('canvas',{cls:'hfx-cv',width:String(st.w),height:String(st.h),role:'img','aria-label':'Preview of the HUD'});
    ui.bgNote=_drwEl('div',{cls:'drw-dim hfx-note'});
    root.appendChild(ui.cv);root.appendChild(ui.bgNote);
    root.appendChild(_drwEl('datalist',{id:'hfx-vars'},vars.map(function(v){return _drwEl('option',{value:v})})));
    root.appendChild(_drwEl('div',{cls:'drw-lab',text:'Items (drawn in this order; the first is the top of a stack)'}));
    it.items.forEach(function(x,i){root.appendChild(itemCard(x,i))});
    if(!it.items.length)root.appendChild(_drwEl('p',{cls:'drw-dim',text:'No items yet — add one below.'}));
    root.appendChild(_drwEl('div',{cls:'drw-wrap'},[
      _drwBtn('+ Text',function(){S().items.push(_hudNewItem('text',vars,sprites));changed(true)},null,'Add a text item'),
      _drwBtn('+ Icons',function(){S().items.push(_hudNewItem('icons',vars,sprites));changed(true)},null,'Add icons (a sprite repeated)'),
      _drwBtn('+ Bar',function(){S().items.push(_hudNewItem('bar',vars,sprites));changed(true)},null,'Add a bar')
    ]));
    root.appendChild(_drwEl('div',{cls:'drw-lab',text:'The block'}));
    ui.code=_drwEl('pre',{cls:'drw-code'});root.appendChild(ui.code);
    root.appendChild(_drwEl('p',{cls:'drw-dim',text:'{name} shows a global variable. hud("other") switches to another HUD, hudOff() / hudOn() hide and show it, say("Hi!", 2) shows a message in the middle.'}));
    ctx.footer.innerHTML='';
    ctx.footer.appendChild(_drwBtn('Delete',del,'drw-danger'));
    ctx.footer.appendChild(_drwBtn('Save to program',save,'drw-pri'));
    refresh();
  }
  function save(){
    var it=S();
    try{
      if(it.orig&&it.orig!==it.name)ctx.remove('hud',it.orig);
      ctx.write('hud',it.name,textOf(it),'hud.emit');
    }catch(e){ctx.toast('Could not save: '+((e&&e.message)||e));return false}
    it.orig=it.name;it.dirty=false;it.err=null;dirty();refresh();ctx.toast('hud '+it.name+' saved');
    return true;
  }
  function del(){
    var it=S();
    if(!window.confirm('Delete hud '+it.name+'?'))return;
    if(it.orig)try{ctx.remove('hud',it.orig)}catch(e){}
    list.splice(cur,1);
    if(!list.length)list.push({name:'main',orig:null,items:[_hudNewItem('text',vars,sprites)],err:null,dirty:false});
    cur=0;dirty();build();ctx.toast('hud '+it.name+' deleted');
  }
  build();
  var t=setInterval(function(){if(!ctx.body.isConnected||!ui.cv||!ui.cv.isConnected)return;ui.live=live();if(Object.keys(ui.live).length)paint()},500);
  return function(){clearInterval(t)};
}
// ── PARTICLES tool ──
var _FX_PRESETS={
  sparkle:{count:14,life:[0.3,0.7],speed:[40,100],angle:[0,360],gravity:60,drag:0,size:[3,1],colors:['#ffcd75','#f4f4f4'],fade:true,shape:'square',loop:false,rate:20,area:[0,0]},
  explosion:{count:60,life:[0.4,1],speed:[60,220],angle:[0,360],gravity:40,drag:2,size:[5,1],colors:['#ffcd75','#ef7d57','#b13e53','#f4f4f4'],fade:true,shape:'circle',loop:false,rate:20,area:[0,0]},
  smoke:{count:6,life:[1,2.2],speed:[8,24],angle:[70,110],gravity:-10,drag:0.5,size:[3,9],colors:['#94b0c2','#566c86','#333c57'],fade:true,shape:'circle',loop:true,rate:14,area:[6,0]},
  dust:{count:10,life:[0.2,0.5],speed:[20,60],angle:[0,180],gravity:80,drag:3,size:[3,1],colors:['#94b0c2','#f4f4f4'],fade:true,shape:'circle',loop:false,rate:20,area:[8,0]},
  confetti:{count:50,life:[1.2,2.4],speed:[80,180],angle:[60,120],gravity:120,drag:1.5,size:[3,3],colors:['#b13e53','#ffcd75','#38b764','#41a6f6','#f4f4f4'],fade:false,shape:'square',loop:false,rate:20,area:[0,0]},
  fire:{count:8,life:[0.4,0.9],speed:[20,50],angle:[75,105],gravity:-60,drag:0.5,size:[5,1],colors:['#ffcd75','#ef7d57','#b13e53'],fade:true,shape:'circle',loop:true,rate:40,area:[10,2]},
  rain:{count:4,life:[0.8,1.2],speed:[220,260],angle:[255,265],gravity:0,drag:0,size:[2,2],colors:['#73eff7','#41a6f6'],fade:false,shape:'square',loop:true,rate:60,area:[320,0]}
};
function _fxPreset(k){return JSON.parse(JSON.stringify(_FX_PRESETS[k]||_FX_PRESETS.sparkle))}
function _fxRead(b){var r=_fxParse(_drawerBody(b.text,'particles'));return{name:b.name,orig:b.name,spec:r.spec,err:r.errors[0]?r.errors[0].msg:null,dirty:false}}
function _drawerFxTool(ctx){
  var list=ctx.blocks('particles').map(_fxRead),cur=0,ui={},world=_fxWorld(),em=0,raf=0,last=0,nextBurst=0;
  if(!list.length)list.push({name:'sparkle',orig:null,spec:_fxPreset('sparkle'),err:null,dirty:true});
  function S(){return list[cur]}
  function names(except){return list.filter(function(x,i){return i!==except}).map(function(x){return x.name})}
  function textOf(it){return _fxWrite(it.name,it.spec)}
  function dirty(){var any=false;list.forEach(function(it){if(it.dirty)any=true});ctx.setDirty(any)}
  function restart(){world.clear();em=0;nextBurst=0}
  function changed(rebuild){S().dirty=true;dirty();restart();if(rebuild)build();else refresh()}
  function refresh(){
    ui.code.textContent=textOf(S());
    ui.paint.forEach(function(p){p.paint()});
    ui.chips.querySelectorAll('.drw-chip').forEach(function(c,i){if(list[i])c.classList.toggle('dirty',!!list[i].dirty)});
    if(ui.cols)paintCols();
  }
  // the preview: a loop emitter in the middle, or a burst again when the last one has gone
  function frame(now){
    raf=requestAnimationFrame(frame);
    var cv=ui.cv;if(!cv||!cv.isConnected)return;
    var dt=last?(now-last)/1000:1/60;if(!(dt>0)||dt>0.1)dt=1/60;last=now;
    var s=S().spec,W=cv.width,H=cv.height;
    if(s.loop){if(!em)em=world.emitter(s,W/2,s.area&&s.area[0]>=W?0:H*0.6)}
    else if(world.n()===0){if(!nextBurst)nextBurst=now+350;else if(now>=nextBurst){world.spawn(s,W/2,H/2,s.count);nextBurst=0}}
    world.step(dt);
    var g=cv.getContext('2d');if(!g)return;
    g.fillStyle='#1a1c2c';g.fillRect(0,0,W,H);
    world.draw(g);
    ui.live.textContent=world.n()+' particles';
  }
  function sl(o){var r=_drwSlider(o);ui.paint.push(r);return r}
  function fmt(v){return _hfxNum(v)}
  function pair(label,key,min,max,step,unit,which){
    return sl({label:label,min:min,max:max,step:step,get:function(){return S().spec[key][which]},set:function(v,done){S().spec[key][which]=+(+v).toFixed(step<1?2:0);changed(false)},fmt:fmt,unit:unit});
  }
  function one(label,key,min,max,step,unit){
    return sl({label:label,min:min,max:max,step:step,get:function(){return S().spec[key]},set:function(v,done){S().spec[key]=+(+v).toFixed(step<1?2:0);changed(false)},fmt:fmt,unit:unit});
  }
  function paintCols(){
    var box=ui.cols,s=S().spec;box.innerHTML='';
    s.colors.forEach(function(c,i){
      var inp=_drwEl('input',{type:'color',cls:'hfx-col',value:c,'aria-label':'Colour '+(i+1)});
      inp.addEventListener('input',function(){s.colors[i]=inp.value;S().dirty=true;dirty();ui.code.textContent=textOf(S())});
      inp.addEventListener('change',function(){changed(false)});
      box.appendChild(_drwEl('span',{cls:'hfx-cw'},[inp,s.colors.length>1?_drwBtn('×',function(){s.colors.splice(i,1);changed(false)},'drw-sm','Remove this colour'):null]));
    });
    if(s.colors.length<8)box.appendChild(_drwBtn('+',function(){s.colors.push('#f4f4f4');changed(false)},'drw-sm','Add a colour'));
  }
  function build(){
    var b=ctx.body,it=S();b.innerHTML='';ui.paint=[];
    var root=_drwEl('div',{cls:'hfx','data-fx-tool':''});b.appendChild(root);
    root._fx={list:list,cur:function(){return cur},S:S,text:function(){return textOf(S())},save:save,world:world,build:build,preset:function(k){it.spec=_fxPreset(k);changed(true)}};
    ui.chips=_drwChips(list,cur,function(i){cur=i;restart();build()},function(){
      var n=_drwFreeName('fx',names(-1));list.push({name:n,orig:null,spec:_fxPreset('sparkle'),err:null,dirty:true});cur=list.length-1;dirty();restart();build();
    },'+ New effect');
    root.appendChild(ui.chips);
    var nameIn=_drwEl('input',{type:'text',cls:'drw-name',value:it.name,'aria-label':'Effect name',autocomplete:'off',autocapitalize:'none',spellcheck:'false'});
    nameIn.addEventListener('change',function(){
      var n=nameIn.value.trim();
      if(!_drwNameOk(n)){ctx.toast('A name is letters, digits and _ (not starting with a digit)');nameIn.value=it.name;return}
      if(names(cur).map(function(x){return x.toLowerCase()}).indexOf(n.toLowerCase())>=0){ctx.toast('There is already an effect called '+n);nameIn.value=it.name;return}
      if(n!==it.name){it.name=n;changed(false);ui.chips.children[cur].textContent=n}
    });
    root.appendChild(_drwEl('div',{cls:'drw-row'},[_drwEl('label',{cls:'drw-lab',text:'Name'}),nameIn]));
    if(it.err)root.appendChild(_drwEl('p',{cls:'drw-err',text:'This block has a part the tool cannot read: '+it.err+' — Save writes the settings shown here.'}));
    ui.cv=_drwEl('canvas',{cls:'hfx-cv hfx-fxcv',width:'256',height:'144',role:'img','aria-label':'Preview of the effect: tap to burst there'});
    ui.cv.addEventListener('pointerdown',function(e){
      var r=ui.cv.getBoundingClientRect();if(!r.width)return;
      var x=(e.clientX-r.left)*ui.cv.width/r.width,y=(e.clientY-r.top)*ui.cv.height/r.height;
      world.spawn(S().spec,x,y,S().spec.count);e.preventDefault();
    });
    ui.live=_drwEl('div',{cls:'drw-dim hfx-note',text:''});
    root.appendChild(ui.cv);root.appendChild(_drwEl('div',{cls:'drw-row hfx-under'},[_drwEl('span',{cls:'drw-dim',text:'Tap the preview to burst there.'}),_drwEl('span',{cls:'hfx-sp'}),ui.live]));
    var pre=_drwEl('div',{cls:'drw-wrap'});
    Object.keys(_FX_PRESETS).forEach(function(k){pre.appendChild(_drwBtn(k,function(){it.spec=_fxPreset(k);changed(true)},'drw-sm','Preset: '+k))});
    root.appendChild(_drwEl('div',{cls:'drw-lab',text:'Presets'}));root.appendChild(pre);
    var s=it.spec;
    var loop=_drwEl('input',{type:'checkbox',id:'fxLoop','aria-label':'Loop: a stream for emitter()'});loop.checked=!!s.loop;
    loop.addEventListener('change',function(){S().spec.loop=loop.checked;changed(true)});
    var fade=_drwEl('input',{type:'checkbox',id:'fxFade','aria-label':'Fade out'});fade.checked=!!s.fade;
    fade.addEventListener('change',function(){S().spec.fade=fade.checked;changed(false)});
    ui.paint.push({paint:function(){loop.checked=!!S().spec.loop;fade.checked=!!S().spec.fade}});
    var shape=_drwSeg([['square','square'],['circle','circle']],function(){return S().spec.shape},function(v){S().spec.shape=v;changed(false)},'Shape');ui.paint.push(shape);
    root.appendChild(_drwEl('div',{cls:'drw-lab',text:'How many'}));
    root.appendChild(_drwEl('div',{cls:'drw-group'},[
      one('Count',  'count',1,200,1,''),
      _drwEl('div',{cls:'drw-row'},[loop,_drwEl('label',{'for':'fxLoop',cls:'drw-ck',text:'loop (a stream: emitter())'})]),
      s.loop?one('Rate','rate',1,200,1,'/s'):null
    ]));
    root.appendChild(_drwEl('div',{cls:'drw-lab',text:'Life and motion (min .. max, random per particle)'}));
    root.appendChild(_drwEl('div',{cls:'drw-group'},[
      pair('Life min','life',0.05,5,0.05,'s',0),pair('Life max','life',0.05,5,0.05,'s',1),
      pair('Speed min','speed',0,400,1,'px/s',0),pair('Speed max','speed',0,400,1,'px/s',1),
      pair('Angle from','angle',-360,360,1,'°',0),pair('Angle to','angle',-360,360,1,'°',1),
      one('Gravity','gravity',-400,400,1,'px/s²'),one('Drag','drag',0,10,0.1,'')
    ]));
    root.appendChild(_drwEl('div',{cls:'drw-lab',text:'Look (size: start → end of life)'}));
    root.appendChild(_drwEl('div',{cls:'drw-group'},[
      pair('Size start','size',0,24,1,'px',0),pair('Size end','size',0,24,1,'px',1),
      _drwEl('div',{cls:'drw-row'},[_drwEl('span',{cls:'drw-lab',text:'Shape'}),shape]),
      _drwEl('div',{cls:'drw-row'},[fade,_drwEl('label',{'for':'fxFade',cls:'drw-ck',text:'fade out'})]),
      _drwEl('div',{cls:'drw-row'},[_drwEl('span',{cls:'drw-lab',text:'Area'}),
        (function(){var a=_drwEl('input',{type:'text',inputmode:'decimal',cls:'drw-num','aria-label':'Area width',value:String(s.area[0])});a.addEventListener('change',function(){var v=Math.max(0,Math.min(2000,parseFloat(a.value)||0));S().spec.area[0]=v;a.value=String(v);changed(false)});return a})(),
        _drwEl('span',{cls:'drw-unit',text:'×'}),
        (function(){var a=_drwEl('input',{type:'text',inputmode:'decimal',cls:'drw-num','aria-label':'Area height',value:String(s.area[1])});a.addEventListener('change',function(){var v=Math.max(0,Math.min(2000,parseFloat(a.value)||0));S().spec.area[1]=v;a.value=String(v);changed(false)});return a})(),
        _drwEl('span',{cls:'drw-unit',text:'px where they start'})])
    ]));
    root.appendChild(_drwEl('div',{cls:'drw-lab',text:'Colours (each particle picks one)'}));
    ui.cols=_drwEl('div',{cls:'drw-wrap hfx-cols'});root.appendChild(ui.cols);
    root.appendChild(_drwEl('div',{cls:'drw-lab',text:'The block'}));
    ui.code=_drwEl('pre',{cls:'drw-code'});root.appendChild(ui.code);
    root.appendChild(_drwEl('p',{cls:'drw-dim',text:'In code: burst("'+it.name+'", x, y) once, or let h = emitter("'+it.name+'", x, y) for a stream (moveEmitter(h, x, y), stopEmitter(h)). In rules: burst '+it.name+' at coin.'}));
    ctx.footer.innerHTML='';
    ctx.footer.appendChild(_drwBtn('Delete',del,'drw-danger'));
    ctx.footer.appendChild(_drwBtn('Save to program',save,'drw-pri'));
    refresh();
  }
  function save(){
    var it=S();
    try{
      if(it.orig&&it.orig!==it.name)ctx.remove('particles',it.orig);
      ctx.write('particles',it.name,textOf(it),'hud.emit');
    }catch(e){ctx.toast('Could not save: '+((e&&e.message)||e));return false}
    it.orig=it.name;it.dirty=false;it.err=null;dirty();refresh();ctx.toast('particles '+it.name+' saved');
    return true;
  }
  function del(){
    var it=S();
    if(!window.confirm('Delete particles '+it.name+'?'))return;
    if(it.orig)try{ctx.remove('particles',it.orig)}catch(e){}
    list.splice(cur,1);
    if(!list.length)list.push({name:'sparkle',orig:null,spec:_fxPreset('sparkle'),err:null,dirty:false});
    cur=0;dirty();restart();build();ctx.toast('particles '+it.name+' deleted');
  }
  build();
  raf=requestAnimationFrame(frame);
  return function(){cancelAnimationFrame(raf);world.clear()};
}
_drawerRegister({id:'hud',label:'HUD',icon:'🏷',desc:'Score, lives and text on top of the game — writes a hud block',open:_drawerHudTool});
_drawerRegister({id:'particles',label:'Particles',icon:'✨',desc:'Sparkles, explosions, smoke, dust — presets and a live preview; writes a particles block',open:_drawerFxTool});
// ── the editor: highlighting, autocomplete, builtin descriptions ──
[['hud','hud(name)','switch to another hud block'],['hudOn','hudOn()','show the HUD'],['hudOff','hudOff()','hide the HUD'],['say','say(text: str, seconds: num)','a message in the middle for a while (2 s if left out)'],
 ['burst','burst(name, x: num, y: num)','particles once at x, y'],['emitter','emitter(name, x: num, y: num) int','a stream of particles: its handle'],['moveEmitter','moveEmitter(h, x: num, y: num)','move a stream'],['stopEmitter','stopEmitter(h)','stop a stream']].forEach(function(b){
  _emitBlt.add(b[0]);
  var e=_allBuiltins.filter(function(x){return x.name===b[0]})[0];
  if(e){e.sig=b[1];e.desc=b[2]}else _allBuiltins.push({name:b[0],sig:b[1],desc:b[2]});
});
var _HFX_HL_WORDS={text:1,icons:1,bar:1,top:1,middle:1,bottom:1,left:1,center:1,centre:1,right:1,below:1,size:1,color:1,colour:1,width:1,height:1,
  count:1,life:1,speed:1,angle:1,spread:1,dir:1,gravity:1,drag:1,colors:1,colours:1,fade:1,shape:1,square:1,circle:1,loop:1,rate:1,area:1};
function _hfxHlBody(t){
  return t.replace(/(\/\/.*$)|("(?:[^"\\]|\\.)*"?)|(#[0-9A-Fa-f]{3,6}\b)|(-?\d+(?:\.\d+)?(?:\.\.-?\d+(?:\.\d+)?)?)|([A-Za-z_]\w*)|([^\s])/gm,function(all,cm,str,hex,num,word,other){
    if(cm)return'<span class="cmt">'+escH(cm)+'</span>';
    if(str)return'<span class="str">'+escH(str).replace(/\{([A-Za-z_]\w*)\}/g,'<span class="ty">{$1}</span>')+'</span>';
    if(hex)return'<span class="num">'+hex+'</span>';
    if(num)return'<span class="num">'+num+'</span>';
    if(word)return _HFX_HL_WORDS[word.toLowerCase()]?'<span class="blt">'+word+'</span>':escH(word);
    return escH(other);
  });
}
hlCode=(function(hl){return function(){
  var r=hl.apply(this,arguments);
  try{
    var src=ed.value;
    if(!/(^|\n)(hud|particles)[ \t]+[A-Za-z_]\w*[ \t]*:/i.test(src))return r;
    var blocks=_drawerScan(src).filter(function(b){return b.kind==='hud'||b.kind==='particles'});if(!blocks.length)return r;
    var html=hlInner.innerHTML,out=html.split('\n'),lines=src.split('\n');
    if(out.length<lines.length)return r;
    blocks.forEach(function(b){
      var m=/^([A-Za-z_]\w*)([ \t]+)([A-Za-z_]\w*)([ \t]*:)/.exec(lines[b.start]);if(!m)return;
      out[b.start]='<span class="kw">'+m[1]+'</span>'+m[2]+'<span class="ty">'+m[3]+'</span>'+escH(m[4].slice(0,-1))+'<span class="dl">:</span>'+_hfxHlBody(lines[b.start].substring(m[0].length));
      for(var j=b.start+1;j<=b.end;j++)out[j]=_hfxHlBody(lines[j]);
    });
    hlInner.innerHTML=out.join('\n');
  }catch(e){}
  return r;
}})(hlCode);
_BLK_SNIPS.push(['hud','hud main:\n  text "Score: {score}" top left','main'],['particles','particles sparkle:\n  count 12  life 0.4..0.8  speed 40..90  angle 0..360\n  gravity 0  size 2..1  colors #ffcd75 #f4f4f4  fade','sparkle']);
checkAC=(function(f){return function(){
  try{
    var before=ed.value.substring(0,ed.selectionStart);
    var m=/(?:^|[^\w$.])(hud|burst|emitter)\(\s*"?(\w*)$/i.exec(before);
    if(m&&!_libInStrOrComment(before.replace(/"\w*$/,''))){
      var kind=m[1].toLowerCase()==='hud'?'hud':'particles',typed=m[2].toLowerCase(),items=[];
      _drawerBlocks(kind).forEach(function(b){
        if(b.name.toLowerCase().indexOf(typed)!==0||b.name===m[2])return;
        var d=_drawerBody(b.text,kind).trim().split('\n')[0].trim();
        items.push(_memItem(b.name,kind+' · '+(d.length>40?d.slice(0,40)+'…':d)+(b.path!==_proj.files[_proj.active].path?' · '+b.path:'')));
      });
      if(items.length){_memShowItems(items,before,'hfx:'+before.length+':'+m[0]);return}
    }
  }catch(e){}
  return f.apply(this,arguments);
}})(checkAC);

// ═══ Memory tab — the program's memory regions as a front panel (IDE only) ═══
// Reads the runtime's region API: _emitRegions(), _emitRegionRead(id, i, field?), _emitRegionWrite(id, i, field,
// value), _emitRegionFreeze(id, on), _emitRegionBytes(id). Without that API, or for a program without regions,
// the tab shows a short note. One card per region; at most _MEM_CAP value cells exist in the DOM across all
// cards (large regions are paged). While the tab is visible and the program runs, the visible cells are re-read
// about 6 times a second (requestAnimationFrame, throttled) and only cells whose value changed are touched.
// Nothing is read while the tab is hidden, the Output view is not shown or the page is in the background.
var _MEM_PAGE=256,_MEM_CAP=600,_MEM_MS=160,_MEM_OPEN_MAX=64;
var _mem={on:false,sig:null,cards:[],view:{},raf:0,last:0,dirty:false,edit:null};
function _memApi(){return typeof _emitRegions==='function'&&typeof _emitRegionRead==='function'}
function _memRegions(){if(!_memApi())return[];try{var r=_emitRegions();return Array.isArray(r)?r:[]}catch(e){return[]}}
function _memEl(){return document.getElementById('tab-memory')}
function _memVisible(){
  var t=_memEl();if(!t||t.style.display==='none'||document.hidden)return false;
  if(window.innerWidth<768&&/off-/.test(document.getElementById('pnl-run').className))return false;
  return true;
}
function _memKey(r){return(r.module||'main')+'.'+r.name}
function _memSig(regs){return(_memApi()?'api\n':'-\n')+regs.map(function(r){return[r.id,r.name,r.module,r.base,r.length,r.elemSize,JSON.stringify(r.elem)].join('|')}).join('\n')}
function _memIsFloat(t){return t==='f32'||t==='num'||t==='f64'}
var _MEM_BITS={i8:8,u8:8,i16:16,u16:16,i32:32,u32:32,int:64,i64:64,u64:64};
function _memIsIntT(t){return!!_MEM_BITS[t]}
function _memSigned(t){return t.charAt(0)!=='u'}
function _memFmt(v,t,mode){
  if(v===undefined||v===null)return'—';
  if(t==='bool'||typeof v==='boolean')return v?'true':'false';
  if(_memIsFloat(t)){var n=Number(v);if(!isFinite(n))return String(n);if(Number.isInteger(n)&&Math.abs(n)<1e15)return String(n);return String(+n.toPrecision(t==='f32'?6:9))}
  if(mode==='hex'&&_memIsIntT(t)){var b=_MEM_BITS[t];try{return BigInt.asUintN(b,BigInt(v)).toString(16).padStart(b/4,'0')}catch(e){return String(v)}}
  if(mode==='ascii'){var c=Number(v);return c>=32&&c<127?"'"+String.fromCharCode(c)+"'":c===10?'\\n':c===0?'\\0':String(c)}
  return String(v);
}
// Parse what was typed into a cell of type t. -> {v} (number | boolean | decimal string for 64-bit values
// outside the safe integer range) or {err}
function _memParse(s,t,mode){
  s=String(s).trim();
  if(t==='bool'){if(/^(true|1)$/i.test(s))return{v:true};if(/^(false|0)$/i.test(s))return{v:false};return{err:'type true or false'}}
  if(_memIsFloat(t)){
    if(!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)&&!/^[-+]?(Infinity|NaN)$/.test(s))return{err:'not a number'};
    return{v:Number(s)};
  }
  if(!_memIsIntT(t))return{err:'cannot edit a '+t};
  var b=_MEM_BITS[t],m,big,hex=false;
  try{
    if((m=/^'([\s\S])'$/.exec(s)))big=BigInt(m[1].charCodeAt(0));
    else if(/^[-+]?\d+$/.test(s))big=BigInt(s.replace(/^\+/,''));
    else if((m=/^([-+]?)0x([0-9a-f]+)$/i.exec(s))){big=BigInt('0x'+m[2]);if(m[1]==='-')big=-big;else hex=true}
    else if(mode==='hex'&&/^[0-9a-f]+$/i.test(s)){big=BigInt('0x'+s);hex=true}
  }catch(e){big=undefined}
  if(big===undefined)return{err:'not a whole number'};
  var sg=_memSigned(t),lo=sg?-(1n<<BigInt(b-1)):0n,hi=sg?(1n<<BigInt(b-1))-1n:(1n<<BigInt(b))-1n;
  if(hex&&sg&&big>hi&&big<(1n<<BigInt(b)))big=BigInt.asIntN(b,big);   // 0xff for an i8 means -1
  if(big<lo||big>hi)return{err:'out of range '+lo+' … '+hi};
  return{v:(big>=-9007199254740991n&&big<=9007199254740991n)?Number(big):big.toString()};
}
function _memBytes(n){return n<1024?n+' B':n<1048576?(+(n/1024).toFixed(1))+' KB':(+(n/1048576).toFixed(2))+' MB'}
function _memElemName(r){return r.elem&&typeof r.elem==='object'?r.elem.struct:String(r.elem)}
// Columns of a struct region: the flattened fields; a fixed array field becomes one column per element (up to 16)
function _memCols(r){
  var out=[];
  ((r.elem&&r.elem.fields)||[]).forEach(function(f){
    if(f.count>1){for(var k=0;k<Math.min(f.count,16);k++)out.push({f:f.name+'['+k+']',t:f.type,h:f.name+'['+k+']'})}
    else out.push({f:f.name,t:f.type,h:f.name});
  });
  return out;
}
function _memModes(r){
  if(r.elem&&typeof r.elem==='object')return _memCols(r).some(function(c){return _memIsIntT(c.t)})?['dec','hex']:[];
  var t=r.elem;
  if(!_memIsIntT(t))return[];
  var ms=['dec','hex'];
  if(t==='u8'){ms.push('ascii');if(r.length>=16)ms.push('dump');if(r.length>=64)ms.push('pixels')}
  return ms;
}
function _memView(r){
  var k=_memKey(r),v=_mem.view[k];
  if(!v){var cells=r.length*(r.elem&&typeof r.elem==='object'?Math.max(1,_memCols(r).length):1);v=_mem.view[k]={open:cells<=_MEM_OPEN_MAX,mode:'dec',start:0,pxw:0}}
  if(_memModes(r).indexOf(v.mode)<0)v.mode='dec';
  return v;
}
function _memRead(r,i,f){try{return f?_emitRegionRead(r.id,i,f):_emitRegionRead(r.id,i)}catch(e){return undefined}}
function _memFlash(el,cls){
  if(cls){el.classList.remove('mfa','mfb','mpk');el.classList.add(cls);el._fl=cls;return}
  var c=el._fl==='mfa'?'mfb':'mfa';el.classList.remove('mfa','mfb','mpk');el.classList.add(c);el._fl=c;   // two identical animations: switching restarts it without a reflow
}
// ── building ──
function _memRender(){
  var box=_memEl();if(!box)return;
  _memEditEnd(false);
  var regs=_memRegions();_mem.sig=_memSig(regs);_mem.cards=[];
  _memDot(regs.length>0);
  if(!regs.length){
    box.innerHTML='<div class="mnote"><b>No memory regions in this program.</b><br>A region is a named block of typed cells that the program keeps in memory: <code>region grid: int[64]</code>, <code>region fb: u8[320 * 200 * 4]</code>, or a <code>struct</code> type: <code>region balls: Ball[100]</code>. Declare one at the top level of a file and Run: each region shows here as a card you can watch live, poke and lock.'+(_memApi()?'':'<br><span style="color:var(--fg3)">(This build of the runtime has no region support yet.)</span>')+'</div>';
    return;
  }
  var total=0;regs.forEach(function(r){total+=r.length*(r.elemSize||0)});
  var html='<div class="msum"><span>'+regs.length+' region'+(regs.length>1?'s':'')+' · '+_memBytes(total)+'</span><span class="mlive"></span></div>';
  regs.forEach(function(r,n){html+='<div class="mcard" data-n="'+n+'"></div>'});
  box.innerHTML=html;
  var budget=_MEM_CAP;
  regs.forEach(function(r,n){
    var c={r:r,n:n,el:box.querySelector('.mcard[data-n="'+n+'"]'),cells:[],vals:[],used:0,frozen:null};
    _mem.cards.push(c);
    _memCardHead(c);
    budget-=_memCardBody(c,budget);
  });
  _memLive();
}
function _memCardHead(c){
  var r=c.r,v=_memView(r),mod=r.module&&r.module!=='main'?'<span class="mmod">'+escH(String(r.module))+'</span>':'';
  var cells=r.elem&&typeof r.elem==='object'?' · '+_memCols(r).length+' fields':'';
  c.el.innerHTML='<div class="mhead"><button class="mtog" data-act="tog" aria-expanded="'+v.open+'"><span class="mname"><span class="mchev">'+(v.open?'▾':'▸')+'</span>'+escH(String(r.name))+mod+'</span>'
    +'<span class="mmeta">'+escH(_memElemName(r))+'['+r.length+']'+cells+' · '+_memBytes(r.length*(r.elemSize||0))+' · @0x'+(Number(r.base)||0).toString(16)+'</span></button>'
    +'<button class="mlock" data-act="lock"></button></div><div class="mbody"'+(v.open?'':' style="display:none"')+'></div>';
  c.body=c.el.querySelector('.mbody');c.frozen=null;
  _memLock(c,!!r.frozen);
}
function _memLock(c,fz){
  if(c.frozen===fz)return;
  c.frozen=fz;c.r.frozen=fz;
  var b=c.el.querySelector('.mlock');
  b.textContent=fz?'🔒':'🔓';b.setAttribute('aria-pressed',String(fz));
  b.title=b.ariaLabel=fz?'Frozen: tap to thaw '+c.r.name:'Tap to freeze '+c.r.name;
  b.setAttribute('aria-label',b.title);
  c.el.classList.toggle('frozen',fz);
  var n=c.body&&c.body.querySelector('.mfz');if(n)n.style.display=fz?'':'none';
}
// Body of an open card with at most `budget` value cells. Returns the number of cells it created.
function _memCardBody(c,budget){
  var r=c.r,v=_memView(r);
  c.cells=[];c.vals=[];c.used=0;c.dump=null;c.px=null;
  if(!v.open){c.body.innerHTML='';return 0}
  var st=r.elem&&typeof r.elem==='object',cols=st?_memCols(r):null,per=st?cols.length+1:1;
  var unit=v.mode==='dump'?16:1;   // a dump row shows 16 bytes and counts as 16 cells
  var page=v.mode==='pixels'?0:Math.max(0,Math.min(_MEM_PAGE,Math.floor(Math.max(0,budget)/per/unit)*unit));
  if(st)page=Math.min(page,Math.max(1,Math.floor(_MEM_PAGE/per)));
  var html='',modes=_memModes(r);
  if(modes.length){
    html+='<div class="mbar"><div class="mseg" role="group" aria-label="Display">';
    modes.forEach(function(m){html+='<button data-act="mode" data-m="'+m+'"'+(m===v.mode?' class="on" aria-pressed="true"':' aria-pressed="false"')+'>'+m+'</button>'});
    html+='</div></div>';
  }
  html+='<div class="mfz"'+(c.frozen?'':' style="display:none"')+'>🔒 Frozen: a write by the program stops it with an error. A tap here still writes — a <b>front panel write</b> overrides the lock.</div>';
  if(v.mode==='pixels'){
    if(!v.pxw)v.pxw=_memGuessW(r.length);
    html+='<div class="mbar"><span class="mrange">width</span><input class="mpxw" data-act="pxw" inputmode="numeric" enterkeyhint="done" aria-label="Pixel width" value="'+(v.pxw||'')+'"><span class="mrange mpxh"></span></div><canvas class="mpx"></canvas>';
    c.body.innerHTML=html;
    c.px={cv:c.body.querySelector('.mpx'),w:0,h:0,img:null};
    _memPxSize(c);_memPxDraw(c);
    return 0;
  }
  if(page<=0){
    c.body.innerHTML=html+'<div class="mnote">Too many cells open at once — close another region to see this one.</div>';
    return 0;
  }
  var n=r.length,start=Math.max(0,Math.min(v.start,n-1));start=Math.floor(start/page)*page;v.start=start;
  var end=Math.min(n,start+page);
  if(n>page){
    var last=Math.floor((n-1)/page)*page;
    html+='<div class="mbar mpager"><button data-act="first" aria-label="First page"'+(start?'':' disabled')+'>⇤</button><button data-act="prev" aria-label="Previous page"'+(start?'':' disabled')+'>‹</button>'
      +'<span class="mrange">'+start+'–'+(end-1)+' of '+n+'</span>'
      +'<button data-act="next" aria-label="Next page"'+(start<last?'':' disabled')+'>›</button><button data-act="last" aria-label="Last page"'+(start<last?'':' disabled')+'>⇥</button>'
      +'<input class="mgoto" data-act="goto" inputmode="numeric" enterkeyhint="go" placeholder="go to #" aria-label="Go to index"></div>';
  }
  html+='<div class="merr" role="status"></div>';
  c.page=page;
  if(v.mode==='dump'){
    var rows='';for(var o=start;o<end;o+=16)rows+='<div class="mdr" data-o="'+o+'"></div>';
    c.body.innerHTML=html+'<div class="mdump">'+rows+'</div>';
    c.dump={rows:[].slice.call(c.body.querySelectorAll('.mdr')),txt:[]};
    _memDumpUpd(c,false);
    c.used=c.dump.rows.length*16;return c.used;
  }
  if(st){
    var t='<div class="mtw"><table class="mtab"><thead><tr><th class="mix">#</th>';
    cols.forEach(function(cl){t+='<th>'+escH(cl.h)+'<small>'+escH(cl.t)+'</small></th>'});
    t+='</tr></thead><tbody>';
    for(var i=start;i<end;i++){t+='<tr><td class="mix">'+i+'</td>';for(var k=0;k<cols.length;k++)t+='<td class="mtd" data-i="'+i+'" data-k="'+k+'"></td>';t+='</tr>'}
    c.body.innerHTML=html+t+'</tbody></table></div>';
    [].forEach.call(c.body.querySelectorAll('.mtd'),function(el){var cl=cols[+el.getAttribute('data-k')];c.cells.push({el:el,i:+el.getAttribute('data-i'),f:cl.f,t:cl.t})});
    c.used=(end-start)*per;
  }else{
    var t=String(r.elem),w=_memCellW(t,v.mode,end-1),g='<div class="mgrid" style="--mw:'+w+'px">';
    for(var i=start;i<end;i++)g+='<div class="mc" data-i="'+i+'"><span class="mi">'+i+'</span><span class="mv"></span></div>';
    c.body.innerHTML=html+g+'</div>';
    [].forEach.call(c.body.querySelectorAll('.mc'),function(el){c.cells.push({el:el,i:+el.getAttribute('data-i'),f:null,t:t})});
    c.used=end-start;
  }
  _memCellsUpd(c,false);
  return c.used;
}
function _memCellW(t,mode,maxIdx){
  var ch=mode==='hex'?(_MEM_BITS[t]||8)/4:mode==='ascii'?4:({u8:3,i8:4,u16:5,i16:6,u32:10,i32:11,int:13,i64:13,f32:9,num:11,bool:5})[t]||8;
  ch=Math.max(ch,String(maxIdx).length*0.7);
  return Math.round(ch*6.7+14);
}
// A width for the pixel preview: the common screen width whose height comes out whole and closest to 4:3
function _memGuessW(len){
  var ws=[640,512,400,320,256,240,200,160,128,120,100,96,80,64,48,40,32,16,8],best=0,bd=1e9;
  for(var i=0;i<ws.length;i++){var h=len/4/ws[i];if(!Number.isInteger(h)||h<1)continue;var d=Math.abs(Math.log(ws[i]/h/(4/3)));if(d<bd){bd=d;best=ws[i]}}
  return best||Math.max(1,Math.floor(Math.sqrt(len/4)));
}
// ── updating ──
function _memCellsUpd(c,flash){
  var mode=_memView(c.r).mode;
  for(var k=0;k<c.cells.length;k++){
    var cell=c.cells[k],raw=_memRead(c.r,cell.i,cell.f);
    if(k in c.vals&&Object.is(raw,c.vals[k]))continue;
    c.vals[k]=raw;
    if(_mem.edit&&_mem.edit.el===cell.el)continue;
    var txt=_memFmt(raw,cell.t,mode),tg=cell.el.classList.contains('mc')?cell.el.lastChild:cell.el;
    if(tg.textContent!==txt)tg.textContent=txt;
    var z=raw===0||raw===false||raw==='0';
    if(cell.el._z!==z){cell.el.classList.toggle('mz',z);cell.el._z=z}
    if(flash)_memFlash(cell.el);
  }
}
function _memDumpUpd(c,flash){
  var b=null;try{b=_emitRegionBytes(c.r.id)}catch(e){}
  if(!b)return;
  for(var k=0;k<c.dump.rows.length;k++){
    var row=c.dump.rows[k],o=+row.getAttribute('data-o'),hx='',as='';
    for(var j=0;j<16;j++){
      if(o+j<b.length){var x=b[o+j];hx+=(x<16?'0':'')+x.toString(16)+(j===7?'  ':' ');as+=x>=32&&x<127?String.fromCharCode(x):'.'}
      else hx+=j===7?'    ':'   ';
    }
    var key=hx+as;if(c.dump.txt[k]===key)continue;
    c.dump.txt[k]=key;
    row.innerHTML='<span class="mdo">'+o.toString(16).padStart(6,'0')+'</span>  '+hx+' <span class="mda">'+escH(as)+'</span>';
    if(flash)_memFlash(row);
  }
}
function _memPxSize(c){
  var v=_memView(c.r),w=Math.max(1,Math.min(4096,v.pxw|0)),h=Math.min(2048,Math.floor(c.r.length/4/w));
  var lab=c.body.querySelector('.mpxh');
  if(h<1){c.px.w=c.px.h=0;c.px.cv.style.display='none';if(lab)lab.textContent='too wide for '+c.r.length+' bytes';return}
  c.px.w=w;c.px.h=h;c.px.cv.width=w;c.px.cv.height=h;c.px.cv.style.display='';c.px.cv.style.width=Math.min(w*Math.max(1,Math.floor(320/w)),9999)+'px';
  c.px.img=null;if(lab)lab.textContent='× '+h+' RGBA';
}
function _memPxDraw(c){
  if(!c.px||!c.px.w)return;
  var b=null;try{b=_emitRegionBytes(c.r.id)}catch(e){}
  if(!b)return;
  try{
    var n=c.px.w*c.px.h*4,ctx=c.px.cv.getContext('2d');
    if(!c.px.img)c.px.img=ctx.createImageData(c.px.w,c.px.h);
    c.px.img.data.set(b.subarray(0,n));ctx.putImageData(c.px.img,0,0);
  }catch(e){}
}
function _memLive(){
  var el=_memEl(),s=el&&el.querySelector('.mlive');if(!s)return;
  var on=!!_animRunning,t=on?'● live':'';
  if(s.textContent!==t){s.textContent=t;s.classList.toggle('on',on)}
}
// Re-read everything visible. A changed program (other regions) rebuilds the cards.
function _memRefresh(flash){
  if(!_memVisible())return;
  var regs=_memRegions();
  if(_memSig(regs)!==_mem.sig){_memRender();return}
  _memLive();
  for(var n=0;n<_mem.cards.length;n++){
    var c=_mem.cards[n];
    _memLock(c,!!(regs[n]&&regs[n].frozen));
    if(!_memView(c.r).open)continue;
    if(c.dump)_memDumpUpd(c,flash);
    else if(c.px)_memPxDraw(c);
    else _memCellsUpd(c,flash);
  }
}
function _memLoop(){
  _mem.raf=0;
  if(!_memVisible())return;   // hidden: the loop ends; showing the tab again starts it
  var now=performance.now();
  if(now-_mem.last>=_MEM_MS&&(_animRunning||_mem.dirty)){_mem.last=now;_mem.dirty=false;_memRefresh(true)}
  if(!_animRunning&&!_mem.dirty)return;   // nothing runs: the loop sleeps until a call into the program, a poke or a Run
  _mem.raf=requestAnimationFrame(_memLoop);
}
function _memKick(){if(!_mem.raf&&_memVisible())_mem.raf=requestAnimationFrame(_memLoop)}
function _memShow(){if(!_memVisible())return;_memRefresh(false);_memKick()}
function _memDot(on){var d=document.getElementById('memDot');if(d)d.classList.toggle('show',!!on)}
function _memCardRebuild(c){
  var others=0;_mem.cards.forEach(function(o){if(o!==c)others+=o.used});
  _memCardBody(c,_MEM_CAP-others);
}
function _memErr(c,msg){
  var e=c.body&&c.body.querySelector('.merr');if(!e)return;
  e.textContent=msg;e.classList.add('show');
  clearTimeout(e._t);e._t=setTimeout(function(){e.classList.remove('show')},2600);
}
// ── poke ──
function _memCellOf(c,el){for(var k=0;k<c.cells.length;k++)if(c.cells[k].el===el)return k;return-1}
function _memWrite(c,k,val){
  var cell=c.cells[k],ok=false;
  try{ok=!!_emitRegionWrite(c.r.id,cell.i,cell.f,val)}catch(e){_memErr(c,'✗ '+((e&&e.message)||e));return false}
  if(!ok){_memErr(c,'✗ the runtime refused the write (is the program loaded?)');return false}
  var raw=_memRead(c.r,cell.i,cell.f);c.vals[k]=raw;
  var tg=cell.el.classList.contains('mc')?cell.el.lastChild:cell.el;
  tg.textContent=_memFmt(raw,cell.t,_memView(c.r).mode);
  cell.el.classList.toggle('mz',raw===0||raw===false||raw==='0');cell.el._z=raw===0||raw===false||raw==='0';
  _memFlash(cell.el,'mpk');
  if(c.frozen)_memErr(c,'🔒 front panel write: '+c.r.name+'['+cell.i+']'+(cell.f?'.'+cell.f:'')+' set although the region is frozen');
  _mem.dirty=true;_memKick();
  return true;
}
function _memEditStart(c,k){
  _memEditEnd(false);
  var cell=c.cells[k];if(!cell)return;
  if(cell.t==='bool'){var cur=_memRead(c.r,cell.i,cell.f);_memWrite(c,k,!(cur===true||cur===1));return}
  if(!_memIsIntT(cell.t)&&!_memIsFloat(cell.t))return;
  var mode=_memView(c.r).mode,raw=_memRead(c.r,cell.i,cell.f);
  var inp=document.createElement('input');
  inp.type='text';inp.setAttribute('autocomplete','off');inp.setAttribute('autocapitalize','off');inp.setAttribute('autocorrect','off');inp.spellcheck=false;
  inp.setAttribute('enterkeyhint','done');
  inp.setAttribute('inputmode',mode==='hex'||mode==='ascii'?'text':_memIsFloat(cell.t)?'decimal':'numeric');
  inp.setAttribute('aria-label',c.r.name+'['+cell.i+']'+(cell.f?'.'+cell.f:''));
  inp.value=raw===undefined?'':mode==='hex'&&_memIsIntT(cell.t)?'0x'+_memFmt(raw,cell.t,'hex'):String(raw);
  var tg=cell.el.classList.contains('mc')?cell.el:cell.el;
  _mem.edit={c:c,k:k,el:cell.el,inp:inp,old:tg.innerHTML};
  tg.classList.add('medit');tg.innerHTML='';tg.appendChild(inp);
  inp.addEventListener('keydown',function(e){
    if(e.key==='Enter'){e.preventDefault();_memEditEnd(true,true)}
    else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();_memEditEnd(false)}
  });
  inp.addEventListener('input',function(){cell.el.classList.remove('bad')});
  inp.addEventListener('blur',function(){if(_mem.edit&&_mem.edit.inp===inp)_memEditEnd(true,false)});
  inp.addEventListener('click',function(e){e.stopPropagation()});
  try{inp.focus();inp.select()}catch(e){}
}
// End the inline editor. commit: write what was typed. keep: on invalid input keep the editor open (Enter).
function _memEditEnd(commit,keep){
  var ed0=_mem.edit;if(!ed0)return;
  var c=ed0.c,cell=c.cells[ed0.k];
  if(commit){
    var p=_memParse(ed0.inp.value,cell.t,_memView(c.r).mode);
    if(p.err){
      _memErr(c,'✗ '+c.r.name+'['+cell.i+']'+(cell.f?'.'+cell.f:'')+': '+p.err+' — nothing written');
      if(keep){ed0.el.classList.add('bad');try{ed0.inp.focus()}catch(e){}return}
      commit=false;
    }
  }
  _mem.edit=null;
  ed0.el.classList.remove('medit','bad');ed0.el.innerHTML=ed0.old;
  delete c.vals[ed0.k];
  if(commit)_memWrite(c,ed0.k,p.v);
  else _memCellsUpd(c,false);
}
// ── events (one delegated listener) ──
(function(){
  var box=_memEl();if(!box)return;
  box.addEventListener('click',function(e){
    var cardEl=e.target.closest&&e.target.closest('.mcard');if(!cardEl)return;
    var c=_mem.cards[+cardEl.getAttribute('data-n')];if(!c)return;
    var v=_memView(c.r),btn=e.target.closest('[data-act]'),act=btn&&btn.getAttribute('data-act');
    if(act==='tog'){
      v.open=!v.open;_memEditEnd(false);
      c.body.style.display=v.open?'':'none';
      btn.setAttribute('aria-expanded',String(v.open));btn.querySelector('.mchev').textContent=v.open?'▾':'▸';
      if(!v.open){c.body.innerHTML='';c.cells=[];c.vals=[];c.used=0;c.dump=null;c.px=null}else _memCardRebuild(c);
      return;
    }
    if(act==='lock'){
      var fz=!c.frozen;
      try{_emitRegionFreeze(c.r.id,fz)}catch(err){}
      var regs=_memRegions();_memLock(c,!!(regs[c.n]?regs[c.n].frozen:fz));
      return;
    }
    if(act==='mode'){v.mode=btn.getAttribute('data-m');_memEditEnd(false);_memCardRebuild(c);return}
    if(act==='first'||act==='prev'||act==='next'||act==='last'){
      var pg=c.page||_MEM_PAGE,last=Math.floor((c.r.length-1)/pg)*pg;
      v.start=act==='first'?0:act==='last'?last:act==='prev'?Math.max(0,v.start-pg):Math.min(last,v.start+pg);
      _memEditEnd(false);_memCardRebuild(c);return;
    }
    if(act)return;
    var row=e.target.closest('.mdr');
    if(row){v.start=+row.getAttribute('data-o');v.mode='hex';_memCardRebuild(c);return}
    var cellEl=e.target.closest('.mc,.mtd');
    if(cellEl&&!cellEl.classList.contains('medit')){var k=_memCellOf(c,cellEl);if(k>=0)_memEditStart(c,k)}
  });
  function field(e){
    var t=e.target,act=t.getAttribute&&t.getAttribute('data-act');if(act!=='goto'&&act!=='pxw')return;
    var cardEl=t.closest('.mcard'),c=cardEl&&_mem.cards[+cardEl.getAttribute('data-n')];if(!c)return;
    var v=_memView(c.r),n=parseInt(t.value,10);
    if(act==='pxw'){if(n>0){v.pxw=n;_memPxSize(c);_memPxDraw(c)}return}
    if(isNaN(n)||n<0||n>=c.r.length){_memErr(c,'✗ index '+t.value+' is outside 0 … '+(c.r.length-1));return}
    v.start=n;_memCardRebuild(c);
    var hit=null;c.cells.forEach(function(cl){if(cl.i===n&&!hit)hit=cl.el});
    if(hit){hit.classList.add('mtarget');_memFlash(hit,'mpk');try{hit.scrollIntoView({block:'nearest'})}catch(er){}}
  }
  box.addEventListener('change',field);
  box.addEventListener('keydown',function(e){if(e.key==='Enter'&&e.target.tagName==='INPUT'&&e.target.getAttribute('data-act')){e.preventDefault();e.target.blur()}});
})();
// ── hooks into the IDE ──
showOTab=(function(f){return function(el){_memEditEnd(false);var r=f.apply(this,arguments);_mem.on=!!(el&&el.dataset&&el.dataset.t==='memory');_memShow();return r}})(showOTab);
showView=(function(f){return function(){var r=f.apply(this,arguments);_memShow();return r}})(showView);
compileAndRun=(function(f){return async function(){
  _mem.dirty=true;
  try{return await f.apply(this,arguments)}
  finally{try{_memDot(_memRegions().length>0);_mem.dirty=true;_memShow()}catch(e){}}   // _memShow re-reads and wakes the loop
}})(compileAndRun);
stopProgram=(function(f){return function(){var r=f.apply(this,arguments);try{_mem.dirty=true;_memLive();_memKick()}catch(e){}return r}})(stopProgram);
// Every call into the program (frame, buttons, timers, callbacks) may change memory: mark it for the next refresh
_emitCallExport=(function(f){return function(){_mem.dirty=true;if(_mem.on&&!_mem.raf)_memKick();return f.apply(this,arguments)}})(_emitCallExport);
try{window._emitCallExport=_emitCallExport}catch(e){}
document.addEventListener('visibilitychange',function(){if(!document.hidden)_memShow()});
// ── Output: make "at path:line:col" at the end of a red runtime line tappable ──
// The runtime writes its error lines (✗ grid[70]: index out of range (length 64) at main.emit:12:5) as plain
// text into #tab-output. Each new top-level line starting with ✗ gets its trailing position wrapped in a link.
function _memAtJump(path,line,col){
  if(path&&_projFind(path)>=0)_projJump(path,line,col);
  else jumpToLine(Math.max(1,Math.min(line,ed.value.split('\n').length)));
}
function _memDecorate(n){
  if(n.nodeType!==1||n._memAt||!/^\s*✗/.test(n.textContent))return;
  if(n.classList.contains('clickable-err')||n.querySelector('.clickable-err'))return;   // compile errors are links already
  var tn=n;while(tn&&tn.nodeType===1)tn=tn.lastChild;
  if(!tn||tn.nodeType!==3)return;
  var t=tn.nodeValue,m=/\bat ((?:([A-Za-z0-9_.\/-]+\.emit):)?(\d+):(\d+))\s*$/.exec(t);if(!m)return;
  n._memAt=1;var host=tn.parentNode;
  var a=document.createElement('span');a.className='mat clickable-err';a.textContent=m[1];
  a.setAttribute('data-p',m[2]||'');a.setAttribute('data-l',m[3]);a.setAttribute('data-c',m[4]);
  a.title='Show in the editor';
  tn.nodeValue=t.substring(0,m.index+3);host.appendChild(a);
  if(t.length>m.index+3+m[1].length)host.appendChild(document.createTextNode(t.substring(m.index+3+m[1].length)));
}
(function(){
  var out=document.getElementById('tab-output');if(!out)return;
  try{new MutationObserver(function(list){for(var i=0;i<list.length;i++){var a=list[i].addedNodes;for(var j=0;j<a.length;j++)_memDecorate(a[j])}}).observe(out,{childList:true})}catch(e){}
  out.addEventListener('click',function(e){
    var a=e.target.closest&&e.target.closest('.mat');if(!a)return;
    _memAtJump(a.getAttribute('data-p'),+a.getAttribute('data-l'),+a.getAttribute('data-c'));
  });
})();

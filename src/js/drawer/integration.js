// ═══ INTEGRATION of the drawer parts (CORE, SPRITE, STAGE, LOGIC) ═══
// What no single part owns: the Memory card of the drawer, and the Memory tab's "open in tool" links.
//   window._memtabToolLink(region) → {label, open()} | null   asked for every card of the Memory tab (when the
//     function exists); a non-null answer adds a button to the card's head that calls open(). A part whose tool
//     generates regions (LOGIC: one region per thing kind) fills this in; a region of plain user code → null.
_drawerRegister({id:'memory',label:'Memory',icon:'🧠',desc:'The running program\'s memory regions, live: the Memory tab of the Output view',
  go:function(){_memtabOpen()},
  open:function(ctx){ctx.body.appendChild(_drwEl('div',{cls:'drw-empty'},[_drwEl('p',{text:'The memory regions of the running program are on the Memory tab of the Output view.'}),_drwBtn('Open the Memory tab',function(){if(ctx.close())_memtabOpen()},'drw-pri drw-btn-l')]))}});
function _memtabOpen(){
  try{if(window.innerWidth<768)showView('run')}catch(e){}
  var t=document.querySelector('.otab[data-t="memory"]');if(t)showOTab(t);
  return!!t;
}
// LOGIC's `stage controls NAME` becomes useControls(NAME) in the generated game(); without any controls block
// STAGE does not look at the call, so the name is checked here, after linking (every file's blocks are known).
_emitModLink=(function(link){return function(fr){
  var r=link.apply(this,arguments);
  try{
    if(!r||!r.ast||(r.errors&&r.errors.length))return r;
    var g=r.ast.body.find(function(n){return n&&n.type==='FunctionDecl'&&n.lgMeta&&n.lgMeta.stage&&n.lgMeta.stage.controls});
    if(!g)return r;
    var want=g.lgMeta.stage.controls,have=r.ast.body.filter(function(n){return n&&n.type==='ControlsDecl'}).map(function(n){return n.name});
    if(have.indexOf(want)<0){
      var t=g.lgMeta.stage.controlsTok||{},f=g.loc&&g.loc.file,c=_emitModClosest(want,have);
      r.errors.push((fr&&fr.multi&&f?f+':':'')+(t.line||1)+':'+(t.col||1)+': stage controls '+want+': there is no controls block '+want+(c?' — did you mean "'+c+'"?':have.length?' — the controls blocks of this project: '+have.join(', '):' — write one (controls '+want+': stick left, buttons A) or make one with the Drawer\'s CONTROLS tool'));
    }
  }catch(e){}
  return r;
}})(_emitModLink);
// LOGIC: a thing kind's region (struct __lgT_<kind>, region <kind>) opens the LOGIC tool on that thing.
function _lgOpenThing(kind){
  if(!_drawerOpen('logic'))return false;
  var t=window._lgTool;if(!t||!t.state)return true;
  var i=-1;(t.state.things||[]).forEach(function(x,k){if(x&&x.name===kind&&i<0)i=k});
  if(i>=0){t.state.tab='things';t.state.sel=i;try{t.render()}catch(e){}}
  return true;
}
window._memtabToolLink=function(region){
  var st=region&&region.elem&&typeof region.elem==='object'?String(region.elem.struct||''):'';
  if(!/(^|\.)__lgT_\w+$/.test(st)||!_drawerFind('logic'))return null;
  var kind=st.replace(/^.*__lgT_/,'');
  return{label:'LOGIC ›',open:function(){_lgOpenThing(kind)}};
};
_memCardHead=(function(f){return function(c){
  var r=f.apply(this,arguments);
  c.link=null;
  try{
    var L=typeof window._memtabToolLink==='function'?window._memtabToolLink(c.r):null;
    if(L&&typeof L.open==='function'){
      var hd=c.el.querySelector('.mhead'),lock=hd&&hd.querySelector('.mlock');
      if(hd){
        var b=document.createElement('button');b.className='mlock mtool';b.setAttribute('data-act','tool');
        b.textContent=String(L.label||'Open in tool');b.title='Open '+String(c.r.name)+' in its tool';b.setAttribute('aria-label',b.title);
        b.style.cssText='width:auto;padding:0 10px;font-size:12px;font-family:var(--mono);color:var(--cyan)';
        hd.insertBefore(b,lock||null);c.link=L;
      }
    }
  }catch(e){c.link=null}
  return r;
}})(_memCardHead);
(function(){
  var box=_memEl();if(!box)return;
  box.addEventListener('click',function(e){
    var b=e.target.closest&&e.target.closest('[data-act="tool"]');if(!b)return;
    var cardEl=b.closest('.mcard'),c=cardEl&&_mem.cards[+cardEl.getAttribute('data-n')];
    if(c&&c.link){e.stopPropagation();try{c.link.open()}catch(err){}}
  },true);
})();

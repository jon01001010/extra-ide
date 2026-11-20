// ═══ CONTROLS: the on-screen controls designer ═══
function _ctlToolOpen(ctx){
  var S={C:null,orig:null,test:false,dirty:false,raf:0,just:{A:0,B:0,C:0}};
  var st={tx:0,ty:0,tp:null,down:{A:0,B:0,C:0},edge:{A:false,B:false,C:false}};
  var root=_stEl('div','stg');root.setAttribute('data-controls-tool','');
  ctx.body.innerHTML='';ctx.body.appendChild(root);
  try{ctx.title('Controls — on-screen stick and buttons')}catch(e){}
  var r1=_stEl('div','stg-row'),pick=_stEl('select'),nameIn=_stEl('input');pick.setAttribute('data-ctl-f','pick');nameIn.setAttribute('data-ctl-f','name');nameIn.style.width='110px';
  r1.append(pick,nameIn);
  var r2=_stEl('div','stg-row'),kindB={};
  [['stick','stick'],['dpad','d-pad'],['none','no stick']].forEach(function(k){var b=_stBtn(k[1],function(){change();if(k[0]==='none'){S.C.stick='none';S.C.dpad=false}else{if(S.C.stick==='none')S.C.stick=S.C.side==='left'?'right':'left';S.C.dpad=k[0]==='dpad'}render()});b.setAttribute('data-ctl-f',k[0]);kindB[k[0]]=b;r2.appendChild(b)});
  var r3=_stEl('div','stg-row'),nB={};r3.append(_stEl('span',null,'buttons'));
  [0,1,2,3].forEach(function(n){var b=_stBtn(String(n),function(){change();var ids=['A','B','C'];while(S.C.buttons.length>n)S.C.buttons.pop();while(S.C.buttons.length<n)S.C.buttons.push({id:ids[S.C.buttons.length],label:null});render()});b.setAttribute('data-ctl-f','n'+n);nB[n]=b;r3.appendChild(b)});
  var labels=_stEl('div','stg-row');
  function slider(label,key,lo,hi,stepv){
    var l=_stEl('label',null,label),i=_stEl('input'),v=_stEl('span','stg-msg');i.type='range';i.min=lo;i.max=hi;i.step=stepv;i.setAttribute('data-ctl-f',key);
    i.oninput=function(){if(!i._snap){change();i._snap=true}S.C[key]=Math.round(+i.value*100)/100;v.textContent=_stFix(S.C[key]);render(true)};i.onchange=function(){i._snap=false};
    l.append(i,v);l._set=function(){i.value=S.C[key];v.textContent=_stFix(S.C[key])};return l;
  }
  var szL=slider('size','size',0.5,2,0.05),opL=slider('opacity','opacity',0.1,1,0.05),dzL=slider('dead zone','deadzone',0,0.9,0.05);
  var keysL=_stEl('label',null,'keyboard'),keysC=_stEl('input');keysC.type='checkbox';keysC.setAttribute('data-ctl-f','keys');keysC.onchange=function(){change();S.C.keys=keysC.checked;render(true)};keysL.prepend(keysC);
  var r4=_stEl('div','stg-row');r4.append(szL,opL,dzL,keysL);
  var phone=_stEl('div','stg-phone');phone.setAttribute('data-ctl-f','phone');
  var shield=_stEl('div','stg-shield');
  var r5=_stEl('div','stg-row'),testB=_stBtn('▶ test',function(){setTest(!S.test)},'try the controls: the values below follow your fingers');testB.setAttribute('data-ctl-f','test');
  var read=_stEl('div','stg-read');read.setAttribute('data-ctl-f','read');
  r5.append(testB,_stEl('span','stg-msg','drag the stick or the buttons to a side'));
  var msg=_stEl('div','stg-msg');
  root.append(r1,r2,r3,labels,r4,phone,r5,read,msg);
  var save=_stBtn('Save',function(){doSave()});save.setAttribute('data-ctl-f','save');
  if(ctx.footer){ctx.footer.innerHTML='';save.style.background='linear-gradient(135deg,var(--cyan),var(--blue))';save.style.color='var(--bg)';save.style.border='none';save.style.fontWeight='700';ctx.footer.appendChild(save)}else root.appendChild(save);
  function toast(t){try{ctx.toast(t)}catch(e){}}
  function names(){try{return(ctx.blocks('controls')||[]).map(function(b){return b.name})}catch(e){return[]}}
  function change(){S.dirty=true;try{ctx.setDirty(true)}catch(e){}}
  function fillPick(){pick.innerHTML='';var ns=names();ns.forEach(function(n){pick.appendChild(new Option('controls '+n,n))});if(S.C&&ns.indexOf(S.C.name)<0)pick.appendChild(new Option('controls '+S.C.name+' (new)',S.C.name));pick.appendChild(new Option('＋ new controls…','\u0000new'));pick.value=S.C?S.C.name:'\u0000new'}
  pick.onchange=function(){if(S.dirty&&!window.confirm('Leave without saving?')){pick.value=S.C.name;return}if(pick.value==='\u0000new')openNew();else open(pick.value)};
  function open(name){var t=null;try{t=ctx.read('controls',name)}catch(e){}var C=t?_stBlockModel('controls',name,t):null;if(!C){openNew();return}S.C=C;S.orig=name;S.dirty=false;try{ctx.setDirty(false)}catch(e){}fillPick();render();msg.textContent=C.problems.map(function(p){return'line '+p.line+': '+p.msg}).join('\n')}
  function openNew(){var n=_stUnique('pad',names());S.C={kind:'controls',name:n,stick:'left',dpad:false,buttons:[{id:'A',label:null},{id:'B',label:null}],side:null,size:1,opacity:0.5,keys:true,deadzone:0.15,items:[],keep:[],problems:[],locs:{}};S.orig=null;change();fillPick();render();msg.textContent=''}
  nameIn.onchange=function(){var v=nameIn.value.trim();if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)||(v!==S.C.name&&names().indexOf(v)>=0)){toast('Choose another name');nameIn.value=S.C.name;return}change();S.C.name=v;fillPick()};
  function render(keepLabels){
    var C=S.C;nameIn.value=C.name;
    kindB.stick.classList.toggle('on',C.stick!=='none'&&!C.dpad);kindB.dpad.classList.toggle('on',C.stick!=='none'&&C.dpad);kindB.none.classList.toggle('on',C.stick==='none');
    for(var n=0;n<4;n++)nB[n].classList.toggle('on',C.buttons.length===n);
    if(!keepLabels){
      labels.innerHTML='';
      C.buttons.forEach(function(b){var l=_stEl('label',null,b.id),i=_stEl('input');i.value=b.label||'';i.placeholder=b.id;i.style.width='80px';i.setAttribute('data-ctl-label',b.id);
        i.onchange=function(){change();b.label=i.value.trim().replace(/"/g,"'")||null;render(true)};l.appendChild(i);labels.appendChild(l)});
    }
    szL._set();opL._set();dzL._set();keysC.checked=C.keys!==false;
    phone.innerHTML='';
    var ov=_stCtlBuild({name:C.name,stick:C.stick,dpad:C.dpad,buttons:C.buttons,side:C.side,size:C.size,opacity:C.opacity,keys:C.keys,deadzone:C.deadzone},st);
    ov.style.position='absolute';phone.appendChild(ov);
    if(!S.test)phone.appendChild(shield);
    phone.setAttribute('data-stick-side',C.stick);phone.setAttribute('data-button-side',buttonSide());
  }
  function buttonSide(){var C=S.C;return C.side||(C.stick==='none'?'right':C.stick==='left'?'right':'left')}
  // edit mode: drag the stick or a button to the left or right half
  var drag=null;
  shield.addEventListener('pointerdown',function(e){
    var hit=null;
    Array.prototype.forEach.call(phone.querySelectorAll('[data-ctl]'),function(el){var r=el.getBoundingClientRect();if(e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom)hit=el});
    if(!hit)return;
    drag={what:hit.getAttribute('data-ctl')==='stick'||hit.getAttribute('data-ctl')==='dpad'?'stick':'buttons',el:hit,x0:e.clientX,y0:e.clientY};
    try{shield.setPointerCapture(e.pointerId)}catch(x){}e.preventDefault();
  });
  shield.addEventListener('pointermove',function(e){if(!drag)return;drag.el.style.translate=(e.clientX-drag.x0)+'px '+(e.clientY-drag.y0)+'px'});
  function dropAt(e){
    if(!drag)return;var d=drag;drag=null;
    var r=phone.getBoundingClientRect(),side=e.clientX<r.left+r.width/2?'left':'right',C=S.C;
    if(d.what==='stick'){if(C.stick!==side){change();C.stick=side;if(C.side===side)C.side=null}}
    else if(buttonSide()!==side){change();C.side=side;if(C.stick===side)C.stick=side==='left'?'right':'left'}
    render();
  }
  shield.addEventListener('pointerup',dropAt);shield.addEventListener('pointercancel',function(){drag=null;render()});
  function setTest(on){
    S.test=on;testB.classList.toggle('on',on);testB.textContent=on?'■ stop test':'▶ test';
    S.just={A:0,B:0,C:0};st.edge={A:false,B:false,C:false};
    render(true);
    cancelAnimationFrame(S.raf);
    if(!on){read.textContent='';return}
    (function loop(){
      if(!root.isConnected){S.test=false;return}   /* the drawer was closed */
      var k=_stIn.kb||{},kx=S.C.keys!==false?(k.right?1:0)-(k.left?1:0):0,ky=S.C.keys!==false?(k.down?1:0)-(k.up?1:0):0;
      var x=Math.max(-1,Math.min(1,st.tx+kx)),y=Math.max(-1,Math.min(1,st.ty+ky));
      ['A','B','C'].forEach(function(b){if(st.edge[b])S.just[b]++;st.edge[b]=false});
      var p=S.C.buttons.map(function(b){return b.id+(st.down[b.id]>0||(S.C.keys!==false&&_stIn.kbBtn&&_stIn.kbBtn[b.id])?'●':'○')+' ×'+S.just[b.id]}).join('  ');
      read.textContent='stickX '+x.toFixed(2)+'  stickY '+y.toFixed(2)+(p?'  '+p:'');
      read.setAttribute('data-x',x.toFixed(3));read.setAttribute('data-y',y.toFixed(3));
      read.setAttribute('data-pressed',S.C.buttons.filter(function(b){return st.down[b.id]>0}).map(function(b){return b.id}).join(''));
      read.setAttribute('data-just',JSON.stringify(S.just));
      S.raf=requestAnimationFrame(loop);
    })();
  }
  function doSave(){
    var text=_stWriteControls(S.C);
    try{if(S.orig&&S.orig!==S.C.name){try{ctx.remove('controls',S.orig)}catch(e){}}ctx.write('controls',S.C.name,text,'stages.emit')}catch(e){toast('Could not save: '+((e&&e.message)||e));return}
    S.orig=S.C.name;S.dirty=false;try{ctx.setDirty(false)}catch(e){}fillPick();toast('controls '+S.C.name+' saved');msg.textContent='saved: '+text;
  }
  var first=names();if(first.length)open(first[0]);else openNew();
  root._ctl=S;root._ctlApi={open:open,save:doSave,text:function(){return _stWriteControls(S.C)},state:st};
  return root;
}
_drawerRegister({id:'stage',label:'Stage',icon:'🗺',desc:'Paint tile maps — legend, rows and objects of a map block; try walking them',open:_stageOpen});
_drawerRegister({id:'controls',label:'Controls',icon:'🎮',desc:'On-screen stick and buttons for phones — writes a controls block',open:_ctlToolOpen});

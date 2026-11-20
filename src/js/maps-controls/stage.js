// ═══ STAGE: the map painter ═══
function _stageOpen(ctx){
  var S={M:null,name:null,tool:'pencil',brush:null,kind:'coin',zoom:1,panX:0,panY:0,undo:[],redo:[],dirty:false,stroke:null,gest:null,preview:null,objSel:-1};
  var root=_stEl('div','stg');root.setAttribute('data-stage-tool','');
  ctx.body.innerHTML='';ctx.body.appendChild(root);
  try{ctx.title('Stage — maps')}catch(e){}
  // ── header: which map, its name, size, tile ──
  var r1=_stEl('div','stg-row'),pick=_stEl('select'),nameIn=_stEl('input'),wIn=_stEl('input'),hIn=_stEl('input'),tIn=_stEl('input');
  pick.setAttribute('data-stg','pick');nameIn.setAttribute('data-stg','name');nameIn.style.width='110px';nameIn.spellcheck=false;
  [wIn,hIn,tIn].forEach(function(i,k){i.type='number';i.min=1;i.max=256;i.setAttribute('data-stg',['w','h','tile'][k])});
  var sizeBtn=_stBtn('resize',function(){resize(+wIn.value,+hIn.value)},'resize the map (the tiles that fit are kept)');sizeBtn.setAttribute('data-stg','resize');
  var lw=_stEl('label',null,'W'),lh=_stEl('label',null,'H'),lt=_stEl('label',null,'tile');lw.appendChild(wIn);lh.appendChild(hIn);lt.appendChild(tIn);
  r1.append(pick,nameIn,lw,lh,sizeBtn,lt);
  // ── tools ──
  var r2=_stEl('div','stg-row'),tbtn={};
  [['pencil','✏','pencil'],['rect','▭','rectangle'],['room','▣','room: walls around a floor'],['fill','◧','fill'],['eraser','⌫','eraser'],['pick','⊙','eyedropper'],['objects','◆','objects']].forEach(function(t){
    var b=_stBtn(t[1]+' '+t[0],function(){setTool(t[0])},t[2]);b.setAttribute('data-tool',t[0]);tbtn[t[0]]=b;r2.appendChild(b);
  });
  var undoB=_stBtn('↶',function(){undo()},'undo'),redoB=_stBtn('↷',function(){redo()},'redo');undoB.setAttribute('data-stg','undo');redoB.setAttribute('data-stg','redo');
  var zo=_stBtn('−',function(){zoomBy(1/1.25)},'zoom out'),zi=_stBtn('+',function(){zoomBy(1.25)},'zoom in'),fit=_stBtn('fit',function(){S.zoom=1;S.panX=S.panY=0;draw()},'whole map');
  zo.setAttribute('data-stg','zoomout');zi.setAttribute('data-stg','zoomin');fit.setAttribute('data-stg','fit');
  var tryB=_stBtn('▶ try it',function(){tryIt()},'walk a hero square around the map');tryB.setAttribute('data-stg','try');
  r2.append(undoB,redoB,zo,zi,fit,tryB);
  // ── brushes (the legend) ──
  var r3=_stEl('div','stg-row');r3.setAttribute('data-stg','brushes');
  var lgPanel=_stEl('div','stg-panel');lgPanel.setAttribute('data-stg','legend');lgPanel.style.display='none';
  // ── object kind ──
  var r4=_stEl('div','stg-row'),kindIn=_stEl('input'),kinds=_stEl('datalist');
  kinds.id='stg-kinds-'+Math.random().toString(36).slice(2);kindIn.setAttribute('list',kinds.id);kindIn.setAttribute('data-stg','kind');kindIn.value=S.kind;kindIn.style.width='120px';
  kindIn.oninput=function(){var v=kindIn.value.trim();if(/^[A-Za-z_][A-Za-z0-9_]*$/.test(v))S.kind=v};
  var kl=_stEl('label',null,'object');kl.appendChild(kindIn);
  r4.append(kl,kinds,_stEl('span','stg-msg','tap: place · drag: move · long press: edit'));r4.style.display='none';
  // ── the map view ──
  var view=_stEl('div','stg-view'),cv=_stEl('canvas');view.appendChild(cv);view.setAttribute('data-stg','view');
  var propPanel=_stEl('div','stg-panel');propPanel.style.display='none';propPanel.setAttribute('data-stg','props');
  var msg=_stEl('div','stg-msg');msg.setAttribute('data-stg','msg');
  var tryPanel=_stEl('div','stg-panel');tryPanel.style.display='none';tryPanel.setAttribute('data-stg','trypanel');
  root.append(r1,r2,r3,lgPanel,r4,view,propPanel,tryPanel,msg);
  var save=_stBtn('Save',function(){doSave()},'write the map block into the program');save.setAttribute('data-stg','save');
  if(ctx.footer){ctx.footer.innerHTML='';save.style.background='linear-gradient(135deg,var(--cyan),var(--blue))';save.style.color='var(--bg)';save.style.border='none';save.style.fontWeight='700';ctx.footer.appendChild(save)}else root.appendChild(save);
  // ── model helpers ──
  function M(){return S.M}
  function eraser(){var e=M().legend.filter(function(x){return x.ch&&!x.solid})[0];return e?e.ch:' '}
  function entry(ch){return M().legend.filter(function(x){return x.ch===ch})[0]||null}
  function getT(x,y){var r=M().rows[y];if(!r)return' ';var a=Array.from(r);return a[x]===undefined?' ':a[x]}
  function setRow(y,arr){M().rows[y]=arr.join('')}
  function grid(){return M().rows.map(function(r){return Array.from(r)})}
  function snap(){return JSON.stringify({w:M().w,h:M().h,tile:M().tile,tileSet:M().tileSet,legend:M().legend,rows:M().rows,objects:M().objects,inline:M().inline,name:M().name})}
  function restore(s){var o=JSON.parse(s);for(var k in o)M()[k]=o[k]}
  function change(){S.undo.push(snap());if(S.undo.length>200)S.undo.shift();S.redo=[];dirty()}
  function dirty(){S.dirty=true;try{ctx.setDirty(true)}catch(e){}btnState()}
  function undo(){if(!S.undo.length)return;S.redo.push(snap());restore(S.undo.pop());dirty();refresh()}
  function redo(){if(!S.redo.length)return;S.undo.push(snap());restore(S.redo.pop());dirty();refresh()}
  function btnState(){undoB.disabled=!S.undo.length;redoB.disabled=!S.redo.length}
  function toast(t){try{ctx.toast(t)}catch(e){}}
  function normalise(m){
    /* an editable picture: size from the rows when the header has none, short rows padded with the eraser */
    if(!m.h)m.h=Math.max(1,m.rows.length);if(!m.w)m.w=Math.max(1,m.rows.reduce(function(a,r){return Math.max(a,Array.from(r).length)},0));
    var er=null;m.legend.forEach(function(e){if(er===null&&e.ch&&!e.solid)er=e.ch});er=er||' ';
    var rows=[];for(var y=0;y<m.h;y++){var a=Array.from(m.rows[y]||'');while(a.length<m.w)a.push(er);rows.push(a.slice(0,m.w).join(''))}
    m.rows=rows;
    m.objects=m.objects.map(function(o){return{kind:o.kind,x:o.x,y:o.y,props:o.props.slice()}});
    m.legend=m.legend.map(function(e){return{ch:e.ch,name:e.name,solid:e.solid,color:e.color,sprite:e.sprite,extra:(e.extra||[]).slice()}});
    return m;
  }
  // ── open / list ──
  function names(){try{return(ctx.blocks('map')||[]).map(function(b){return b.name})}catch(e){return[]}}
  function fillPick(){
    pick.innerHTML='';
    var ns=names();
    ns.forEach(function(n){pick.appendChild(new Option('map '+n,n))});
    if(S.name&&ns.indexOf(S.name)<0)pick.appendChild(new Option('map '+S.name+' (new)',S.name));
    pick.appendChild(new Option('＋ new map…','\u0000new'));
    pick.value=S.name||'\u0000new';
  }
  pick.onchange=function(){
    var v=pick.value;
    if(S.dirty&&!window.confirm('Leave map '+S.name+' without saving?')){pick.value=S.name;return}
    if(v==='\u0000new')openNew();else open(v);
  };
  function open(name){
    var text=null;try{text=ctx.read('map',name)}catch(e){}
    var m=text?_stBlockModel('map',name,text):null;
    if(!m){toast('map '+name+' was not found');openNew();return}
    S.M=normalise(m);S.name=name;S.orig=name;afterOpen(m.problems);
  }
  function openNew(){var n=_stUnique('level1',names());S.M=_stNewMap(n);S.name=n;S.orig=null;afterOpen([]);dirty()}
  function afterOpen(problems){
    S.undo=[];S.redo=[];S.dirty=false;try{ctx.setDirty(false)}catch(e){}
    S.zoom=1;S.panX=S.panY=0;S.objSel=-1;propPanel.style.display='none';
    var b=M().legend.filter(function(e){return e.ch&&e.solid})[0]||M().legend[0];S.brush=b?b.ch:' ';
    S.problems=problems||[];
    fillPick();refresh();btnState();
  }
  function refresh(){
    nameIn.value=M().name;wIn.value=M().w;hIn.value=M().h;tIn.value=M().tile;
    brushes();legendEd();kindList();draw();showMsg();
  }
  function showMsg(t){
    msg.innerHTML='';
    (S.problems||[]).slice(0,6).forEach(function(p){var d=_stEl('div','bad','line '+p.line+' of the block: '+p.msg);msg.appendChild(d)});
    if(M().keep&&M().keep.length)msg.appendChild(_stEl('div',null,M().keep.length+' line(s) this tool does not edit are kept as they are.'));
    msg.appendChild(_stEl('div',null,t||(M().w+'×'+M().h+' tiles of '+M().tile+' px · '+M().objects.length+' object(s) · eraser = '+(eraser()===' '?'space':'"'+eraser()+'"'))));
  }
  nameIn.onchange=function(){
    var v=nameIn.value.trim();
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)){toast('A map name is a word: letters, digits, _');nameIn.value=M().name;return}
    if(v!==M().name&&names().indexOf(v)>=0){toast('There is already a map '+v);nameIn.value=M().name;return}
    change();M().name=v;S.name=v;fillPick();
  };
  tIn.onchange=function(){var t=Math.round(+tIn.value);if(!(t>=1&&t<=256)){tIn.value=M().tile;return}change();M().tile=t;M().tileSet=true;showMsg()};
  function resize(w,h){
    w=Math.round(w);h=Math.round(h);
    if(!(w>=1&&h>=1&&w<=256&&h<=256)){toast('The size is 1 to 256 tiles each way');wIn.value=M().w;hIn.value=M().h;return}
    if(w===M().w&&h===M().h)return;
    change();
    var g=grid(),er=eraser(),rows=[];
    for(var y=0;y<h;y++){var a=[];for(var x=0;x<w;x++)a.push(g[y]&&g[y][x]!==undefined?g[y][x]:er);rows.push(a.join(''))}
    var before=M().objects.length;
    M().objects=M().objects.filter(function(o){return o.x<w&&o.y<h});
    M().w=w;M().h=h;M().rows=rows;
    var lost=before-M().objects.length;
    if(lost)toast(lost+' object(s) outside the new size were removed (undo brings them back)');
    refresh();
  }
  // ── brushes and legend editor ──
  function chip(e){var c=_stEl('span','stg-chip'),sc=e&&e.sprite?_sprBlockCanvas(ctx,S.sprCache||(S.sprCache={}),e.sprite):null;c.style.background=e&&e.color?e.color:e&&e.sprite?'repeating-linear-gradient(45deg,#666 0 3px,#999 3px 6px)':'transparent';
    if(sc){try{c.style.background='url('+sc.toDataURL()+') center/100% 100% no-repeat'+(e.color?' '+e.color:'');c.style.imageRendering='pixelated';c.setAttribute('data-sprite',e.sprite)}catch(x){}}
    return c}
  function brushes(){
    r3.innerHTML='';
    M().legend.forEach(function(e){
      if(!e.ch)return;
      var b=_stBtn('',function(){S.brush=e.ch;if(S.tool==='objects'||S.tool==='eraser'||S.tool==='pick')setTool('pencil');brushes()},'brush '+e.name+' ("'+e.ch+'")');
      b.className='stg-brush'+(S.brush===e.ch&&S.tool!=='objects'&&S.tool!=='eraser'?' on':'');b.setAttribute('data-brush',e.ch);
      b.append(chip(e),document.createTextNode(e.name||e.ch));
      r3.appendChild(b);
    });
    var lb=_stBtn('legend…',function(){lgPanel.style.display=lgPanel.style.display==='none'?'':'none'},'edit the legend');lb.setAttribute('data-stg','legendbtn');
    r3.appendChild(lb);
  }
  function legendEd(){
    lgPanel.innerHTML='';
    var spr=_stSpriteNames(ctx);
    M().legend.forEach(function(e,i){
      var row=_stEl('div','stg-lg');row.setAttribute('data-lg',String(i));
      var ch=_stEl('input','ch'),nm=_stEl('input','nm'),so=_stEl('input'),co=_stEl('input'),sp=_stEl('select');
      ch.value=e.ch;ch.maxLength=2;ch.setAttribute('data-f','ch');nm.value=e.name;nm.setAttribute('data-f','name');nm.spellcheck=false;
      so.type='checkbox';so.checked=!!e.solid;so.setAttribute('data-f','solid');
      co.type='color';co.value=/^#[0-9a-fA-F]{6}$/.test(e.color||'')?e.color:/^#[0-9a-fA-F]{3}$/.test(e.color||'')?'#'+e.color.slice(1).split('').map(function(c){return c+c}).join(''):'#808080';co.setAttribute('data-f','color');
      sp.setAttribute('data-f','sprite');sp.appendChild(new Option('colour',''));
      spr.concat(e.sprite&&spr.indexOf(e.sprite)<0?[e.sprite]:[]).forEach(function(n){sp.appendChild(new Option('sprite '+n,n))});
      sp.value=e.sprite||'';
      ch.onchange=function(){
        var a=Array.from(ch.value);
        if(a.length!==1||a[0]===' '||a[0]===','||a[0]==='"'){toast('One character, not a space, comma or quote');ch.value=e.ch;return}
        if(M().legend.some(function(x){return x!==e&&x.ch===a[0]})){toast('"'+a[0]+'" is already in the legend');ch.value=e.ch;return}
        change();var old=e.ch;
        M().rows=M().rows.map(function(r){return Array.from(r).map(function(c){return c===old?a[0]:c}).join('')});
        e.ch=a[0];if(S.brush===old)S.brush=a[0];refresh();
      };
      nm.onchange=function(){var v=nm.value.trim();if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)){toast('A tile name is a word');nm.value=e.name;return}change();e.name=v;brushes()};
      so.onchange=function(){change();e.solid=so.checked;draw();showMsg()};
      co.oninput=function(){if(!co._snap){change();co._snap=true}e.color=co.value;brushes();draw()};co.onchange=function(){co._snap=false};
      sp.onchange=function(){change();e.sprite=sp.value||null;if(!e.sprite&&!e.color)e.color=co.value;brushes();draw()};
      var del=_stBtn('✕',function(){
        var n=0;M().rows.forEach(function(r){Array.from(r).forEach(function(c){if(c===e.ch)n++})});
        change();M().legend.splice(i,1);
        var er=eraser();if(n)M().rows=M().rows.map(function(r){return Array.from(r).map(function(c){return c===e.ch?er:c}).join('')});
        if(S.brush===e.ch)S.brush=er;
        if(n)toast(n+' tile(s) of '+e.name+' became '+(er===' '?'empty':'"'+er+'"'));refresh();
      },'remove from the legend');del.setAttribute('data-f','del');
      var sl=_stEl('label',null,'solid');sl.prepend(so);
      row.append(ch,nm,sl,co,sp,del);
      lgPanel.appendChild(row);
    });
    var add=_stBtn('＋ tile',function(){
      var pool='#.~gwxo*=%&@$!?^:;+-|<>abcdefhijklmnpqrstuvyz0123456789',c=null;
      for(var i=0;i<pool.length;i++)if(!M().legend.some(function(x){return x.ch===pool[i]})){c=pool[i];break}
      if(!c){toast('The legend is full');return}
      change();var nm=_stUnique('tile',M().legend.map(function(x){return x.name}));
      M().legend.push({ch:c,name:nm,solid:false,color:'#'+(0x1000000+Math.floor(Math.random()*0xffffff)).toString(16).slice(1),sprite:null,extra:[]});
      S.brush=c;refresh();lgPanel.style.display='';
    },'add a tile to the legend');add.setAttribute('data-stg','addtile');
    lgPanel.appendChild(add);
  }
  function kindList(){
    kinds.innerHTML='';var seen={};
    ['hero','coin','enemy','door','key'].concat(M().objects.map(function(o){return o.kind})).forEach(function(k){if(!seen[k]){seen[k]=1;kinds.appendChild(new Option(k,k))}});
  }
  function setTool(t){
    S.tool=t;for(var k in tbtn)tbtn[k].classList.toggle('on',k===t);
    r4.style.display=t==='objects'?'':'none';
    if(t!=='objects'){propPanel.style.display='none';S.objSel=-1}
    brushes();draw();
  }
  // ── drawing ──
  function cellPx(){var r=view.getBoundingClientRect(),W=r.width||300,H=r.height||200;return Math.max(2,Math.min(W/M().w,H/M().h))*S.zoom}
  function origin(){var r=view.getBoundingClientRect(),c=cellPx();return{x:((r.width||300)-c*M().w)/2+S.panX,y:((r.height||200)-c*M().h)/2+S.panY,c:c}}
  function draw(){
    if(!M())return;
    /* the view takes the map's shape: as tall as the map at full width, between 180 px and 55% of the screen */
    var vw=view.clientWidth||300,want=Math.round(Math.max(180,Math.min(window.innerHeight*0.55,vw*M().h/M().w)));
    if(Math.abs(view.clientHeight-want)>1)view.style.height=want+'px';
    var r=view.getBoundingClientRect(),dpr=window.devicePixelRatio||1,W=Math.max(1,Math.round((r.width||300)*dpr)),H=Math.max(1,Math.round((r.height||200)*dpr));
    if(cv.width!==W)cv.width=W;if(cv.height!==H)cv.height=H;
    var g=cv.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,W,H);
    var o=origin(),c=o.c,rows=grid(),rt=typeof _spriteDraw==='function'?_spriteDraw:null;
    /* sprite tiles: the sprite block of the program text; else the running program's sprite (runtime registry) */
    var spr=function(g2,name,f,x0,y0,op){var sc=_sprBlockCanvas(ctx,S.sprCache||(S.sprCache={}),name);if(!sc)return rt?rt(g2,name,f,x0,y0,op):false;g2.save();g2.imageSmoothingEnabled=false;g2.drawImage(sc,x0,y0,op.w,op.h);g2.restore();return true};
    for(var y=0;y<M().h;y++)for(var x=0;x<M().w;x++){
      var ch=rows[y][x],e=entry(ch),px=o.x+x*c,py=o.y+y*c;
      if(px>r.width||py>r.height||px+c<0||py+c<0)continue;
      if(S.preview&&inPreview(x,y))e=entry(previewCh(x,y))||{color:null};
      var done=false;
      if(e&&e.sprite&&spr){try{done=spr(g,e.sprite,0,px,py,{w:c,h:c})!==false}catch(er){}}
      if(!done){
        if(e&&e.color){g.fillStyle=e.color;g.fillRect(px,py,c+0.5,c+0.5)}
        else if(e&&e.sprite){g.fillStyle='#777';g.fillRect(px,py,c,c);g.fillStyle='#ddd';g.font=Math.max(6,c*0.5)+'px sans-serif';g.fillText(e.sprite[0],px+c*0.25,py+c*0.7)}
        else if(ch!==' '){g.fillStyle='#f0f';g.fillRect(px,py,c,c)}
      }
    }
    if(c>=8){
      g.strokeStyle='rgba(255,255,255,.07)';g.lineWidth=1;g.beginPath();
      for(var gx=0;gx<=M().w;gx++){g.moveTo(Math.round(o.x+gx*c)+0.5,o.y);g.lineTo(Math.round(o.x+gx*c)+0.5,o.y+M().h*c)}
      for(var gy=0;gy<=M().h;gy++){g.moveTo(o.x,Math.round(o.y+gy*c)+0.5);g.lineTo(o.x+M().w*c,Math.round(o.y+gy*c)+0.5)}
      g.stroke();
    }
    g.strokeStyle='rgba(45,212,191,.5)';g.strokeRect(o.x-0.5,o.y-0.5,M().w*c+1,M().h*c+1);
    M().objects.forEach(function(ob,i){
      var cx=o.x+(ob.x+0.5)*c,cy=o.y+(ob.y+0.5)*c,rr=Math.max(3,c*0.36);
      g.fillStyle=_stHue(ob.kind);g.beginPath();g.arc(cx,cy,rr,0,Math.PI*2);g.fill();
      g.strokeStyle=i===S.objSel?'#fff':'rgba(0,0,0,.6)';g.lineWidth=i===S.objSel?2:1;g.stroke();
      if(c>=14){g.fillStyle='#000';g.font='bold '+Math.round(rr*1.1)+'px sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(ob.kind[0].toUpperCase(),cx,cy+1);g.textAlign='start';g.textBaseline='alphabetic'}
    });
    view.setAttribute('data-cell',String(Math.round(c*100)/100));
  }
  function inPreview(x,y){var p=S.preview;return x>=Math.min(p.x0,p.x1)&&x<=Math.max(p.x0,p.x1)&&y>=Math.min(p.y0,p.y1)&&y<=Math.max(p.y0,p.y1)}
  function previewCh(x,y,p){p=p||S.preview;if(p.tool==='room'&&x!==p.x0&&x!==p.x1&&y!==p.y0&&y!==p.y1)return eraser();return S.brush}
  // ── painting ──
  function tileAt(ev){var r=view.getBoundingClientRect(),o=origin();return{x:Math.floor((ev.clientX-r.left-o.x)/o.c),y:Math.floor((ev.clientY-r.top-o.y)/o.c)}}
  function inside(t){return t.x>=0&&t.y>=0&&t.x<M().w&&t.y<M().h}
  function put(x,y,ch){if(x<0||y<0||x>=M().w||y>=M().h)return;var a=Array.from(M().rows[y]);if(a[x]===ch)return;a[x]=ch;setRow(y,a)}
  function line(a,b,ch){var dx=Math.abs(b.x-a.x),dy=Math.abs(b.y-a.y),sx=a.x<b.x?1:-1,sy=a.y<b.y?1:-1,er=dx-dy,x=a.x,y=a.y;for(var n=0;n<4096;n++){put(x,y,ch);if(x===b.x&&y===b.y)break;var e2=2*er;if(e2>-dy){er-=dy;x+=sx}if(e2<dx){er+=dx;y+=sy}}}
  function flood(x,y,ch){
    var g=grid(),from=g[y][x];if(from===ch)return;
    var st=[[x,y]],W=M().w,H=M().h;
    while(st.length){var p=st.pop(),px=p[0],py=p[1];if(px<0||py<0||px>=W||py>=H||g[py][px]!==from)continue;g[py][px]=ch;st.push([px+1,py],[px-1,py],[px,py+1],[px,py-1])}
    M().rows=g.map(function(r){return r.join('')});
  }
  function objAt(t){for(var i=M().objects.length-1;i>=0;i--){var o=M().objects[i];if(o.x===t.x&&o.y===t.y)return i}return-1}
  function down(ev){
    var t=tileAt(ev),tool=S.tool;
    if(tool==='objects'){
      var i=objAt(t);
      S.stroke={tool:tool,start:t,last:t,obj:i,moved:false,before:snap(),timer:null};
      if(i>=0){S.objSel=i;var st=S.stroke;st.timer=setTimeout(function(){if(S.stroke===st&&!st.moved){st.long=true;editObj(i)}},500)}
      draw();return;
    }
    if(!inside(t)&&tool!=='rect'&&tool!=='room')return;
    if(tool==='pick'){if(inside(t)){var ch=getT(t.x,t.y);if(ch!==' '&&entry(ch)){S.brush=ch;setTool('pencil')}else toast('An empty tile — nothing to pick')}return}
    var before=snap();
    if(tool==='fill'){if(getT(t.x,t.y)===S.brush)return;change();flood(t.x,t.y,S.brush);draw();return}
    S.stroke={tool:tool,start:t,last:t,before:before,changed:false};
    if(tool==='pencil'||tool==='eraser'){var c0=tool==='eraser'?eraser():S.brush;if(getT(t.x,t.y)!==c0){S.stroke.changed=true;put(t.x,t.y,c0);draw()}}
    else{S.preview={tool:tool,x0:clampX(t.x),y0:clampY(t.y),x1:clampX(t.x),y1:clampY(t.y)};draw()}
  }
  function clampX(x){return Math.max(0,Math.min(M().w-1,x))}
  function clampY(y){return Math.max(0,Math.min(M().h-1,y))}
  function move(ev){
    var s=S.stroke;if(!s)return;
    var t=tileAt(ev);
    if(s.tool==='objects'){
      if(s.obj<0||s.long)return;
      if(t.x===s.last.x&&t.y===s.last.y)return;
      if(!inside(t))return;
      s.moved=true;clearTimeout(s.timer);s.last=t;
      var o=M().objects[s.obj];o.x=t.x;o.y=t.y;draw();return;
    }
    if(s.tool==='pencil'||s.tool==='eraser'){
      if(t.x===s.last.x&&t.y===s.last.y)return;
      var before=M().rows.join('\n');line(s.last,t,s.tool==='eraser'?eraser():S.brush);if(M().rows.join('\n')!==before)s.changed=true;
      s.last=t;draw();return;
    }
    if(S.preview){S.preview.x1=clampX(t.x);S.preview.y1=clampY(t.y);draw()}
  }
  function up(ev){
    var s=S.stroke;S.stroke=null;if(!s)return;
    if(s.tool==='objects'){
      clearTimeout(s.timer);
      if(s.long)return;
      if(s.obj>=0){if(s.moved){S.undo.push(s.before);S.redo=[];dirty();showMsg()}return}
      var t=s.start;if(!inside(t))return;
      change();M().objects.push({kind:S.kind,x:t.x,y:t.y,props:[]});S.objSel=M().objects.length-1;kindList();draw();showMsg();return;
    }
    if(s.tool==='pencil'||s.tool==='eraser'){if(s.changed){S.undo.push(s.before);S.redo=[];dirty()}return}
    if(S.preview){
      var p=S.preview;S.preview=null;
      S.undo.push(s.before);S.redo=[];
      for(var y=Math.min(p.y0,p.y1);y<=Math.max(p.y0,p.y1);y++)for(var x=Math.min(p.x0,p.x1);x<=Math.max(p.x0,p.x1);x++)put(x,y,previewCh(x,y,p));
      dirty();draw();
    }
  }
  function cancelStroke(){
    var s=S.stroke;S.stroke=null;S.preview=null;
    if(!s)return;clearTimeout(s.timer);
    if(s.before&&(s.changed||s.moved))restore(s.before);
    draw();
  }
  // ── pointers: one finger paints, two fingers pinch-zoom and pan ──
  var ptrs=new Map();
  view.addEventListener('pointerdown',function(e){
    e.preventDefault();try{view.setPointerCapture(e.pointerId)}catch(x){}
    ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(ptrs.size===2){cancelStroke();var a=Array.from(ptrs.values());S.gest={d:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)||1,mx:(a[0].x+a[1].x)/2,my:(a[0].y+a[1].y)/2,zoom:S.zoom,panX:S.panX,panY:S.panY};return}
    if(ptrs.size===1&&!S.gest)down(e);
  });
  view.addEventListener('pointermove',function(e){
    if(!ptrs.has(e.pointerId))return;
    ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(S.gest&&ptrs.size>=2){
      var a=Array.from(ptrs.values()),d=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)||1,mx=(a[0].x+a[1].x)/2,my=(a[0].y+a[1].y)/2,G=S.gest;
      var r=view.getBoundingClientRect(),z=Math.max(0.5,Math.min(12,G.zoom*d/G.d)),k=z/G.zoom;
      /* keep the map point under the first midpoint under the fingers' midpoint */
      var cx=r.width/2,cy=r.height/2;
      S.zoom=z;S.panX=(G.panX-(G.mx-r.left-cx))*k+(mx-r.left-cx);S.panY=(G.panY-(G.my-r.top-cy))*k+(my-r.top-cy);
      draw();return;
    }
    if(!S.gest)move(e);
  });
  function ptrEnd(e){
    if(!ptrs.has(e.pointerId))return;
    ptrs.delete(e.pointerId);
    if(S.gest){if(!ptrs.size)S.gest=null;return}
    if(e.type==='pointercancel')cancelStroke();else up(e);
  }
  view.addEventListener('pointerup',ptrEnd);view.addEventListener('pointercancel',ptrEnd);
  view.addEventListener('wheel',function(e){
    e.preventDefault();
    var r=view.getBoundingClientRect(),k=Math.max(0.5,Math.min(2,Math.pow(1.002,-e.deltaY*(e.deltaMode===1?16:1)))),z=Math.max(0.5,Math.min(12,S.zoom*k));k=z/S.zoom;
    var cx=e.clientX-r.left-r.width/2,cy=e.clientY-r.top-r.height/2;
    S.panX=(S.panX-cx)*k+cx;S.panY=(S.panY-cy)*k+cy;S.zoom=z;draw();
  },{passive:false});
  function zoomBy(k){var z=Math.max(0.5,Math.min(12,S.zoom*k));k=z/S.zoom;S.panX*=k;S.panY*=k;S.zoom=z;draw()}
  // ── object properties ──
  function editObj(i){
    var o=M().objects[i];if(!o)return;
    S.objSel=i;draw();
    propPanel.innerHTML='';propPanel.style.display='';
    var before=snap(),touched=false;
    function touch(){if(!touched){S.undo.push(before);S.redo=[];touched=true}dirty()}
    var r=_stEl('div','stg-row'),k=_stEl('input');k.value=o.kind;k.setAttribute('data-f','kind');k.style.width='110px';
    k.onchange=function(){var v=k.value.trim();if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)){k.value=o.kind;return}touch();o.kind=v;kindList();draw()};
    r.append(_stEl('span',null,'object'),k,_stEl('span','stg-msg','at '+o.x+','+o.y));
    propPanel.appendChild(r);
    o.props.forEach(function(p,j){
      var pr=_stEl('div','stg-row'),pk=_stEl('input'),pv=_stEl('input');pk.value=p[0];pv.value=p[1];pk.style.width='90px';pv.style.width='90px';pk.setAttribute('data-f','pk');pv.setAttribute('data-f','pv');
      pk.onchange=function(){var v=pk.value.trim();if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)){pk.value=p[0];return}touch();p[0]=v};
      pv.onchange=function(){var v=pv.value.trim();if(!v||/\s/.test(v)&&!/^".*"$/.test(v))v=/\s/.test(v)?'"'+v.replace(/"/g,"'")+'"':v;if(!v){pv.value=p[1];return}touch();p[1]=v;pv.value=v};
      pr.append(pk,pv,_stBtn('✕',function(){touch();o.props.splice(j,1);editObj(i)},'remove this property'));
      propPanel.appendChild(pr);
    });
    var r2=_stEl('div','stg-row');
    var addP=_stBtn('＋ property',function(){touch();o.props.push([_stUnique('value',o.props.map(function(p){return p[0]})),'1']);editObj(i)});addP.setAttribute('data-f','addprop');
    var del=_stBtn('delete object',function(){touch();M().objects.splice(i,1);S.objSel=-1;propPanel.style.display='none';draw();showMsg()});del.setAttribute('data-f','delobj');
    var ok=_stBtn('done',function(){propPanel.style.display='none';S.objSel=-1;draw();showMsg()});ok.setAttribute('data-f','done');
    r2.append(addP,del,ok);propPanel.appendChild(r2);
  }
  // ── try it: a hero square walks the map ──
  function tryIt(){
    if(tryPanel.style.display!=='none'){tryPanel._stop();return}
    tryPanel.innerHTML='';tryPanel.style.display='';tryB.classList.add('on');
    var info=_stEl('div','stg-msg','Arrows / WASD or the stick move the hero; solid tiles stop it.');
    var box=_stEl('div','stg-phone');box.style.height='auto';box.style.maxWidth='100%';
    var c=_stEl('canvas');c.style.cssText='display:block;width:100%;image-rendering:pixelated';box.appendChild(c);
    var t=M().tile,W=M().w*t,H=M().h*t;c.width=W;c.height=H;
    var pad={tx:0,ty:0,tp:null,down:{A:0,B:0,C:0},edge:{A:false,B:false,C:false}};
    var ov=_stCtlBuild({name:'try',stick:'left',dpad:false,buttons:[],size:0.8,opacity:0.6,keys:true,deadzone:0.15},pad);
    ov.style.position='absolute';ov.style.top='auto';box.appendChild(ov);
    tryPanel.append(info,box,_stBtn('■ stop',function(){tryPanel._stop()}));
    var hs=Math.max(2,Math.round(t*0.7)),hero=M().objects.filter(function(o){return o.kind==='hero'})[0],hx,hy;
    if(hero){hx=hero.x*t+(t-hs)/2;hy=hero.y*t+(t-hs)/2}
    else{outer:for(var y=0;y<M().h;y++)for(var x=0;x<M().w;x++){var e=entry(getT(x,y));if(!e||!e.solid){hx=x*t+(t-hs)/2;hy=y*t+(t-hs)/2;break outer}}}
    if(hx===undefined){hx=hy=0}
    var keys={},rows=grid();
    function solid(px,py){var x=Math.floor(px/t),y=Math.floor(py/t);if(x<0||y<0||x>=M().w||y>=M().h)return true;var e=entry(rows[y][x]);return!!(e&&e.solid)}
    function free(x,y){return!solid(x,y)&&!solid(x+hs-0.01,y)&&!solid(x,y+hs-0.01)&&!solid(x+hs-0.01,y+hs-0.01)}
    function kd(e){var k={ArrowLeft:'l',KeyA:'l',ArrowRight:'r',KeyD:'r',ArrowUp:'u',KeyW:'u',ArrowDown:'d',KeyS:'d'}[e.code];if(k&&!(e.target&&/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))){keys[k]=e.type==='keydown';e.preventDefault()}}
    document.addEventListener('keydown',kd);document.addEventListener('keyup',kd);
    var raf=0,last=0;
    function step(ts){
      if(!root.isConnected){tryPanel._stop();return}   /* the drawer was closed */
      var dt=last?Math.min(0.05,(ts-last)/1000):0;last=ts;
      var ax=pad.tx+(keys.r?1:0)-(keys.l?1:0),ay=pad.ty+(keys.d?1:0)-(keys.u?1:0),sp=t*5*dt;
      ax=Math.max(-1,Math.min(1,ax));ay=Math.max(-1,Math.min(1,ay));
      if(free(hx+ax*sp,hy))hx+=ax*sp;
      if(free(hx,hy+ay*sp))hy+=ay*sp;
      var g=c.getContext('2d');g.clearRect(0,0,W,H);
      for(var y=0;y<M().h;y++)for(var x=0;x<M().w;x++){var e=entry(rows[y][x]);if(e){g.fillStyle=e.color||'#777';g.fillRect(x*t,y*t,t,t)}}
      M().objects.forEach(function(o){if(o.kind==='hero')return;g.fillStyle=_stHue(o.kind);g.beginPath();g.arc((o.x+0.5)*t,(o.y+0.5)*t,t*0.3,0,Math.PI*2);g.fill()});
      g.fillStyle='#2dd4bf';g.fillRect(hx,hy,hs,hs);
      tryPanel.setAttribute('data-hero',Math.round(hx*100)/100+','+Math.round(hy*100)/100);
      raf=requestAnimationFrame(step);
    }
    raf=requestAnimationFrame(step);
    tryPanel._stop=function(){cancelAnimationFrame(raf);document.removeEventListener('keydown',kd);document.removeEventListener('keyup',kd);tryPanel.style.display='none';tryPanel.innerHTML='';tryB.classList.remove('on')};
  }
  // ── save ──
  function doSave(){
    var m=M(),text=_stWriteMap(m);
    try{
      if(S.orig&&S.orig!==m.name){try{ctx.remove('map',S.orig)}catch(e){}}
      ctx.write('map',m.name,text,'stages.emit');
    }catch(e){toast('Could not save: '+((e&&e.message)||e));return}
    S.orig=m.name;S.dirty=false;S.problems=[];try{ctx.setDirty(false)}catch(e){}
    fillPick();showMsg('map '+m.name+' saved');toast('map '+m.name+' saved');
  }
  // ── start ──
  var first=names();
  if(first.length)open(first[0]);else openNew();
  setTool('pencil');
  var ro=null;try{ro=new ResizeObserver(function(){draw()});ro.observe(view)}catch(e){}
  /* screen(tx, ty): the page position of a tile's centre (tests and scripts drive the painter with it) */
  root._stage=S;root._stageApi={open:open,openNew:openNew,save:doSave,undo:undo,redo:redo,setTool:setTool,model:M,text:function(){return _stWriteMap(M())},
    screen:function(tx,ty){var r=view.getBoundingClientRect(),o=origin();return{x:r.left+o.x+(tx+0.5)*o.c,y:r.top+o.y+(ty+0.5)*o.c,cell:o.c}}};
  return root;
}

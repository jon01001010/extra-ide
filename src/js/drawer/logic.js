// ═══ LOGIC tool (Drawer) ═══ builds `thing` and `rules:` blocks with forms and menus. Two tabs: THINGS (one
// form per kind: shape / sprite, size, colour, how many, behaviours, fields) and RULES (rows "WHEN event … DO
// action …" from menus whose choices are the declared things, sounds, maps and variables). Blocks are read
// with the compiler's own parser (_lgParseBlock) and written back through the drawer's ctx.write: what the
// tool did not touch is written back exactly as it was, a rule the tool cannot show as menus is kept as is
// (read-only), a disabled rule is written commented out. Live validation compiles the project with the
// edited blocks in place. IDE-only (not part of the exported runtime).
(function(){
  if(typeof _drawerRegister!=='function'){window._drawerTools=window._drawerTools||[];window._drawerRegister=function(t){window._drawerTools.push(t)}}
  var EVENTS=[['start','on start'],['frame','every frame'],['every','every … (time)'],['key','on key (held)'],['keydown','on keydown'],['keyup','on keyup'],['press','on press (button)'],['hold','on hold (button)'],['tap','on tap'],['touch','on touch (held)'],['hit','on hit'],['when','when (condition)'],['each','each (thing)']];
  var VERBS=[['mv','move by'],['vel','set velocity'],['to','move to'],['spawn','spawn'],['remove','remove'],['block','block'],['bounce','bounce'],['set','set'],['add','add'],['play','play sound'],['music','play music'],['say','say'],['frame','frame'],['call','call fn'],['restart','restart'],['stop','stop'],['burst','burst particles']];
  var SUBJ={mv:1,vel:1,to:1,remove:1,block:1,bounce:1,frame:1};
  var KEYS=['left','right','up','down','space','enter','shift','ctrl','alt','esc','tab','backspace'].concat('abcdefghijklmnopqrstuvwxyz0123456789'.split(''));
  var BEH=[['chase','chase'],['flee','flee'],['wander','wander'],['patrol','patrol'],['track','track (face)'],['follow','follow (chain)'],['gravity','gravity']];
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
  function names(list){return(list||[]).map(function(b){return b&&typeof b==='object'?b.name:b}).filter(function(n){return typeof n==='string'&&n})}
  // ── reading blocks ──
  // the source text of an expression parsed by the compiler (from its first token to the next token on the line)
  function exprText(e,tokens,line){
    var t=e&&e.lgToks;if(!t||!t.length)return'';
    var first=t[0],last=t[t.length-1],k=tokens.indexOf(last),next=tokens[k+1];
    var end=next&&next.line===first.line?next.col-1:line.length;
    return stripComment(line.slice(first.col-1,end)).trim().replace(/,$/,'').trim();
  }
  // text up to a // comment that is not inside a string
  function stripComment(t){var q=null;for(var i=0;i<t.length;i++){var c=t[i];if(q){if(c==='\\')i++;else if(c===q)q=null;continue}if(c==='"'||c==="'")q=c;else if(c==='/'&&t[i+1]==='/')return t.slice(0,i)}return t}
  function parseThing(text){
    var lines=String(text).replace(/\r/g,'').split('\n'),comments=[];
    lines.slice(1).forEach(function(l){if(/^\s*\/\//.test(l))comments.push(l.trim())});
    var r=_lgParseBlock(text),d=r.decl;
    if(!d||d.type!=='ThingDecl')throw new Error('not a thing block');
    var T={name:d.name,shape:{kind:'box',w:'16',h:'16',r:'8',color:'',sprite:''},at:null,size:null,count:'',pool:'',map:'',beh:[],flags:{},fields:[],comments:comments};
    function X(e,it){return exprText(e,r.tokens,lines[(it.tok.line||1)-1]||'')}
    d.items.forEach(function(it){
      switch(it.kind){
        case'box':case'oval':T.shape={kind:it.kind,w:X(it.w,it),h:X(it.h,it),r:'8',color:it.color?it.color.value:'',sprite:''};break;
        case'circ':T.shape={kind:'circ',w:'16',h:'16',r:X(it.r,it),color:it.color?it.color.value:'',sprite:''};break;
        case'sprite':T.shape={kind:'sprite',w:'16',h:'16',r:'8',color:'',sprite:it.sprite.value};break;
        case'at':T.at={x:X(it.x,it),y:X(it.y,it)};break;
        case'size':T.size={w:X(it.w,it),h:X(it.h,it)};break;
        case'count':case'pool':T[it.kind]=X(it.n,it);break;
        case'from':T.map=it.map.value;break;
        case'bounce':case'wrap':case'solid':case'wall':T.flags[it.kind]=true;break;
        case'gravity':T.beh.push({kind:'gravity',target:'',arg:X(it.g,it)});break;
        case'field':T.fields.push({name:it.name,value:X(it.value,it)});break;
        default:T.beh.push({kind:it.kind,target:it.target?it.target.value:'',arg:it.speed?X(it.speed,it):it.gap?X(it.gap,it):''});
      }
    });
    return T;
  }
  function thingText(T){
    var p=[],s=T.shape;
    if(s.kind==='sprite')p.push('sprite '+(s.sprite||T.name));
    else if(s.kind==='circ')p.push('circ '+(s.r||'8')+(s.color?' '+s.color:''));
    else p.push(s.kind+' '+(s.w||'16')+' '+(s.h||'16')+(s.color?' '+s.color:''));
    if(T.at&&(T.at.x!==''||T.at.y!==''))p.push('at '+(T.at.x||'0')+pairSep(T.at.y)+(T.at.y||'0'));
    if(T.size&&(T.size.w!==''||T.size.h!==''))p.push('size '+(T.size.w||'16')+pairSep(T.size.h)+(T.size.h||'16'));
    if(T.count!=='')p.push('count '+T.count);
    if(T.pool!=='')p.push('pool '+T.pool);
    if(T.map)p.push('from map '+T.map);
    T.beh.forEach(function(b){
      if(b.kind==='gravity')p.push('gravity '+(b.arg||'0.3'));
      else if(b.kind==='wander'||b.kind==='patrol')p.push(b.kind+(b.arg?' '+b.arg:''));
      else p.push(b.kind+' '+(b.target||'?')+(b.kind!=='track'&&b.arg?' '+b.arg:''));
    });
    ['solid','wall','bounce','wrap'].forEach(function(f){if(T.flags[f])p.push(f)});
    T.fields.forEach(function(f){if(f.name)p.push(f.name+' '+(f.value===''?'0':f.value))});
    return'thing '+T.name+': '+p.join(', ')+(T.comments.length?'\n'+T.comments.map(function(c){return'  '+c}).join('\n'):'');
  }
  // a comma is needed between two numbers when the second starts with - or ( (else it would be one expression)
  function pairSep(y){return/^\s*[-(]/.test(String(y||''))?', ':' '}
  function parseRuleLine(line){
    var t=line.trim(),off=0,m=/^\/\/\s?(.*)$/.exec(t),enabled=true;
    if(m){enabled=false;t=m[1].trim()}
    if(!t)return null;
    if(/^(stage|seed|show)\b/.test(t))return{type:'setting',enabled:enabled,text:t};
    var src='  '+t,r=_lgParseBlock('rules:\n'+src),d=r.decl;
    if(!d||d.type!=='RulesDecl'||d.rules.length!==1)throw new Error('not one rule');
    var R=d.rules[0];
    function X(e){return exprText(e,r.tokens,src)}
    var ev={kind:R.ev};
    switch(R.ev){
      case'every':{var n=r.tokens[r.tokens.indexOf(R.evTok)],u=r.tokens[r.tokens.indexOf(R.evTok)+1];ev.n=String(n.value);ev.unit=u.value;break}
      case'key':case'keydown':case'keyup':ev.key=R.key.name;break;
      case'press':case'hold':ev.btn=R.btn.btn;break;
      case'hit':ev.a=R.a.value;ev.b=R.b.value;break;
      case'when':ev.cond=X(R.cond);break;
      case'each':ev.k=R.kind.value;ev.cond=R.cond?X(R.cond):'';break;
    }
    var acts=R.actions.map(function(a){
      var A={verb:a.verb,subj:a.subj?a.subj.value:''};
      switch(a.verb){
        case'mv':case'vel':case'to':A.x=X(a.x);A.y=X(a.y);break;
        case'spawn':A.kind=a.kind.value;A.x=a.x?X(a.x):'';A.y=a.y?X(a.y):'';A.vx=a.vx?X(a.vx):'';A.vy=a.vy?X(a.vy):'';break;
        case'set':case'add':A.target=a.target.value+(a.field?'.'+a.field.value:'');A.value=X(a.value);break;
        case'play':case'music':A.name=a.name;break;
        case'burst':A.name=a.name;A.at=a.atThing?a.atThing.value:a.x?X(a.x)+', '+X(a.y):'';break;
        case'say':case'frame':A.value=X(a.value);break;
        case'call':A.fn=a.fn?a.fn.value:X(a.callExpr);break;
      }
      return A;
    });
    return{type:'rule',enabled:enabled,ev:ev,actions:acts};
  }
  function eventText(e){
    switch(e.kind){
      case'start':return'on start';
      case'frame':return'every frame';
      case'every':return'every '+(e.n||'1')+(e.unit||'s');
      case'key':case'keydown':case'keyup':return'on '+e.kind+' '+(e.key||'space');
      case'press':case'hold':return'on '+e.kind+' '+(e.btn||'A');
      case'tap':case'touch':return'on '+e.kind;
      case'hit':return'on hit '+(e.a||'?')+' '+(e.b||'?');
      case'when':return'when '+(e.cond||'true');
      case'each':return'each '+(e.k||'?')+(e.cond?' when '+e.cond:'');
    }
    return'on start';
  }
  function actionText(a){
    var s=a.subj?a.subj+' ':'';
    switch(a.verb){
      case'mv':case'vel':case'to':return s+a.verb+' '+(a.x||'0')+', '+(a.y||'0');
      case'spawn':return'spawn '+(a.kind||'?')+(a.x!==''||a.y!==''?' at '+(a.x||'0')+', '+(a.y||'0'):'')+(a.vx!==''||a.vy!==''?' vel '+(a.vx||'0')+', '+(a.vy||'0'):'');
      case'remove':case'block':case'bounce':return a.verb+(a.subj?' '+a.subj:'');
      case'frame':return'frame '+(a.subj?a.subj+' ':'')+(a.value||'0');
      case'set':case'add':return a.verb+' '+(a.target||'score')+' '+(a.value||(a.verb==='add'?'1':'0'));
      case'play':case'music':return a.verb+' '+(a.name||'?');
      case'say':return'say '+(a.value||'""');
      case'burst':return'burst '+(a.name||'?')+(a.at?' at '+a.at:'');
      case'call':return'call '+(a.fn||'?');
      default:return a.verb;
    }
  }
  function ruleText(row){
    if(row.type==='setting')return row.text;
    return eventText(row.ev)+': '+row.actions.map(actionText).join(' : ');
  }
  function rowLine(row){
    if(row.type==='blank')return'';
    if(row.type==='kept'||!row.dirty)return row.orig;
    return'  '+(row.enabled?'':'// ')+ruleText(row);
  }
  function parseRules(text){
    var lines=String(text||'').replace(/\r/g,'').split('\n');
    return lines.slice(1).map(function(l){
      if(!l.trim())return{type:'blank',orig:l};
      var row=null;
      try{row=parseRuleLine(l)}catch(e){row=null}
      if(!row)return{type:'kept',orig:l,text:l.trim()};
      row.orig=l;row.dirty=false;
      return row;
    });
  }
  function rulesText(rows){
    var out=['rules:'];rows.forEach(function(r){out.push(rowLine(r))});
    while(out.length>1&&!out[out.length-1].trim())out.pop();
    return out.join('\n');
  }
  // ── the whole project text with blocks replaced (for live validation) ──
  function projText(){try{return typeof _projText==='function'?_projText():document.getElementById('editor').value}catch(e){return''}}
  function blockRange(lines,head){
    for(var i=0;i<lines.length;i++)if(head.test(lines[i])){
      var j=i+1;while(j<lines.length&&(/^\s/.test(lines[j])||lines[j]===''||/^\/\//.test(lines[j]))&&!/^\/\/\/\/ file: /.test(lines[j]))j++;
      while(j>i+1&&!lines[j-1].trim())j--;
      return[i,j];
    }
    return null;
  }
  function headRe(kind,name){return kind==='rules'?/^rules\s*:/i:new RegExp('^thing\\s+'+name+'\\s*:','i')}
  function fileStart(lines,i){for(var k=i;k>=0;k--)if(/^\/\/\/\/ file: /.test(lines[k]))return{line:k+1,path:lines[k].slice(11).trim()};return{line:0,path:null}}
  // ── the tool ──
  function open(ctx){
    var S={tab:'things',things:[],removed:[],rules:[],rulesDirty:false,rulesExisted:false,sel:0,errs:{},msg:''};
    var body=ctx.body,timer=null;
    ctx.title('Logic — things & rules');
    function blocksOf(kind){try{return names(ctx.blocks(kind))}catch(e){return[]}}
    function blockFile(kind){try{var b=(ctx.blocks(kind)||[])[0];return b&&typeof b==='object'&&(b.path||b.file)?(b.path||b.file):null}catch(e){return null}}   /* CORE's blocks carry `path` */
    // load
    blocksOf('thing').forEach(function(n){
      var txt=null;try{txt=ctx.read('thing',n)}catch(e){}
      if(txt==null)return;
      var T;try{T=parseThing(txt);T.kept=false}catch(e){T={name:n,kept:true,raw:txt,err:String(e.message||e)}}
      T.orig=txt;T.origName=n;T.dirty=false;
      S.things.push(T);
    });
    var rtxt=null;try{rtxt=ctx.read('rules','')}catch(e){}
    if(rtxt!=null){S.rulesExisted=true;S.rules=parseRules(rtxt);S.rulesOrig=rtxt}
    function kinds(){return S.things.map(function(t){return t.name})}
    function dirty(){ctx.setDirty(true);schedule()}
    function schedule(){clearTimeout(timer);timer=setTimeout(validate,350)}
    // ── live validation: compile the project with the edited blocks in place ──
    function validate(){
      S.errs={};S.msg='';
      var text=projText(),lines=text.split('\n'),place=[];
      function put(kind,name,blockText,key){
        var r=blockRange(lines,headRe(kind,name)),bl=blockText.split('\n');
        if(r){lines.splice.apply(lines,[r[0],r[1]-r[0]].concat(bl));place.push({key:key,at:r[0],n:bl.length})}
        else{lines.push.apply(lines,['']);var at=lines.length;lines.push.apply(lines,bl);place.push({key:key,at:at,n:bl.length})}
        // later blocks move: recompute positions from scratch after all replacements
      }
      S.removed.forEach(function(n){var r=blockRange(lines,headRe('thing',n));if(r)lines.splice(r[0],r[1]-r[0])});
      S.things.forEach(function(T,i){put('thing',T.origName||T.name,T.kept?T.raw:(T.dirty?thingText(T):T.orig),'t'+i)});
      // a kept line that does not compile is left out of the check (it is shown with its own error), so the
      // other rules are still checked
      S.keptErr={};
      var vrows=S.rules.map(function(r,i){
        if(r.type!=='kept'||/^\/\//.test(r.text))return r;
        try{_lgParseBlock('rules:\n  '+r.text);return r}catch(e){S.keptErr[i]=String(e.message||e).replace(/^\d+:\d+: /,'');return{type:'kept',orig:'  // '+r.text,text:r.text}}
      });
      if(S.rules.length||S.rulesExisted)put('rules','',rulesText(vrows),'r');
      var full=lines.join('\n');
      // positions after every replacement: find each block again by its header
      var L2=full.split('\n'),spots=[];
      S.things.forEach(function(T,i){var r=blockRange(L2,headRe('thing',T.name));if(r)spots.push({key:'t'+i,r:r})});
      var rr=blockRange(L2,/^rules\s*:/i);if(rr)spots.push({key:'r',r:rr});
      var errs=[];
      try{var c=compile(full,'wasm32');errs=c.errors||[]}catch(e){errs=[String(e.message||e)]}
      errs.forEach(function(msg){
        var m=/^(?:([A-Za-z0-9_.\/-]+\.emit):)?(\d+):(\d+): ([\s\S]*)$/.exec(msg),hit=false;
        if(m){
          spots.forEach(function(sp){
            var fs=fileStart(L2,sp.r[0]),line=Number(m[2])+fs.line-1;
            if(m[1]&&fs.path&&m[1]!==fs.path)return;
            if(line>=sp.r[0]&&line<sp.r[1]){hit=true;(S.errs[sp.key]=S.errs[sp.key]||[]).push({line:line-sp.r[0],col:Number(m[3]),text:m[4]})}
          });
        }
        if(!hit&&!S.msg)S.msg=msg;
      });
      renderStatus();
      if(S.tab==='rules')markRules();else markThings();
    }
    // ── rendering ──
    var css=document.getElementById('lg-tool-css');
    if(!css){css=document.createElement('style');css.id='lg-tool-css';css.textContent=CSS;document.head.appendChild(css)}
    body.innerHTML='';
    var root=document.createElement('div');root.className='lg-tool';body.appendChild(root);
    root.innerHTML='<div class="lg-tabs"><button class="lg-tab" data-tab="things">THINGS</button><button class="lg-tab" data-tab="rules">RULES</button></div><div class="lg-pane"></div><div class="lg-status"></div>';
    var pane=root.querySelector('.lg-pane'),status=root.querySelector('.lg-status');
    root.querySelectorAll('.lg-tab').forEach(function(b){b.onclick=function(){S.tab=b.getAttribute('data-tab');render()}});
    function renderStatus(){
      var n=Object.keys(S.errs).reduce(function(a,k){return a+S.errs[k].length},0)+Object.keys(S.keptErr||{}).length;
      status.className='lg-status'+(n||S.msg?' bad':'');
      status.textContent=n?'✗ '+n+' problem'+(n>1?'s':'')+' — marked in red':S.msg?'✗ '+S.msg:'✓ compiles';
    }
    function sel(opts,val,attr){return'<select '+attr+'>'+opts.map(function(o){var v=Array.isArray(o)?o[0]:o,l=Array.isArray(o)?o[1]:o;return'<option value="'+esc(v)+'"'+(String(v)===String(val)?' selected':'')+'>'+esc(l)+'</option>'}).join('')+'</select>'}
    function inp(val,attr,ph,list){return'<input '+attr+' value="'+esc(val)+'"'+(ph?' placeholder="'+esc(ph)+'"':'')+(list?' list="'+list+'"':'')+' autocomplete="off" spellcheck="false">'}
    function render(){
      root.querySelectorAll('.lg-tab').forEach(function(b){b.classList.toggle('on',b.getAttribute('data-tab')===S.tab)});
      if(S.tab==='things')renderThings();else renderRules();
      renderStatus();
    }
    // ── THINGS ──
    function renderThings(){
      var h='<div class="lg-kinds">';
      S.things.forEach(function(T,i){h+='<button class="lg-kind'+(i===S.sel?' on':'')+'" data-i="'+i+'">'+esc(T.name)+'</button>'});
      h+='<button class="lg-add-kind">+ thing</button></div>';
      var T=S.things[S.sel];
      if(!T)h+='<p class="lg-hint">No things yet. A thing is a kind of game object: a hero, coins, enemies, bullets. Add one with + thing.</p>';
      else if(T.kept)h+='<div class="lg-thing" data-i="'+S.sel+'"><p class="lg-hint">This thing could not be read as a form ('+esc(T.err)+'). Edit its text:</p><textarea class="lg-raw" rows="4">'+esc(T.raw)+'</textarea><div class="lg-row"><button class="lg-del-thing">Delete thing</button></div></div>';
      else h+=thingForm(T,S.sel);
      pane.innerHTML=h;
      pane.querySelectorAll('.lg-kind').forEach(function(b){b.onclick=function(){S.sel=Number(b.getAttribute('data-i'));renderThings()}});
      pane.querySelector('.lg-add-kind').onclick=function(){
        var n='thing'+(S.things.length+1),k=1;while(kinds().indexOf(n)>=0)n='thing'+(S.things.length+(++k));
        S.things.push({name:n,origName:null,dirty:true,kept:false,shape:{kind:'box',w:'16',h:'16',r:'8',color:'#ffffff',sprite:''},at:{x:'160',y:'120'},size:null,count:'',pool:'',map:'',beh:[],flags:{},fields:[],comments:[]});
        S.sel=S.things.length-1;dirty();renderThings();
      };
      if(T)wireThing(T);
      markThings();
    }
    function thingForm(T,i){
      var s=T.shape,sprites=blocksOf('sprite'),maps=blocksOf('map'),ks=kinds();
      var h='<div class="lg-thing" data-i="'+i+'">';
      h+='<div class="lg-row"><label>name</label>'+inp(T.name,'data-f="name" class="lg-name"','hero')+'<button class="lg-del-thing" title="Delete this thing">🗑</button></div>';
      h+='<div class="lg-row"><label>shape</label>'+sel([['box','box'],['circ','circle'],['oval','oval'],['sprite','sprite']],s.kind,'data-f="shape"');
      if(s.kind==='sprite')h+=sel([''].concat(sprites.length?sprites:[]).concat(s.sprite&&sprites.indexOf(s.sprite)<0?[s.sprite]:[]).map(function(n){return[n,n||'(choose)']}),s.sprite,'data-f="sprite"')+'<canvas class="lg-spr" width="32" height="32"></canvas>';
      else if(s.kind==='circ')h+='<label>r</label>'+inp(s.r,'data-f="r" class="lg-num"','8');
      else h+='<label>w</label>'+inp(s.w,'data-f="w" class="lg-num"','16')+'<label>h</label>'+inp(s.h,'data-f="h" class="lg-num"','16');
      if(s.kind!=='sprite')h+='<input type="color" data-f="colorpick" value="'+esc(/^#[0-9a-fA-F]{6}$/.test(s.color)?s.color:'#ffffff')+'">'+inp(s.color,'data-f="color" class="lg-col"','#ffffff');
      h+='</div>';
      h+='<div class="lg-row"><label>at</label>'+inp(T.at?T.at.x:'','data-f="atx"','x (i = number)')+inp(T.at?T.at.y:'','data-f="aty"','y')+'</div>';
      h+='<div class="lg-row"><label>size</label>'+inp(T.size?T.size.w:'','data-f="sizew" class="lg-num"','w')+inp(T.size?T.size.h:'','data-f="sizeh" class="lg-num"','h')+'<span class="lg-hint">only to override the shape</span></div>';
      h+='<div class="lg-row"><label>count</label>'+inp(T.count,'data-f="count" class="lg-num" inputmode="numeric"','1')+'<label>pool</label>'+inp(T.pool,'data-f="pool" class="lg-num" inputmode="numeric"','—')+'<label>from map</label>'+sel([['','—']].concat(maps.concat(T.map&&maps.indexOf(T.map)<0?[T.map]:[]).map(function(n){return[n,n]})),T.map,'data-f="map"')+'</div>';
      h+='<div class="lg-sub">behaviours</div>';
      T.beh.forEach(function(b,j){
        h+='<div class="lg-row lg-beh" data-j="'+j+'">'+sel(BEH,b.kind,'data-f="bkind"');
        if(b.kind==='chase'||b.kind==='flee'||b.kind==='track'||b.kind==='follow')h+=sel([['','(thing)']].concat(ks.map(function(n){return[n,n]})),b.target,'data-f="btarget"');
        if(b.kind!=='track')h+=inp(b.arg,'data-f="barg" class="lg-num"',b.kind==='gravity'?'0.3':b.kind==='follow'?'gap':'speed');
        h+='<button class="lg-x" data-f="bdel" title="Remove">✕</button></div>';
      });
      h+='<div class="lg-row"><button class="lg-add-beh">+ behaviour</button>';
      ['solid','wall','bounce','wrap'].forEach(function(f){h+='<label class="lg-chk"><input type="checkbox" data-flag="'+f+'"'+(T.flags[f]?' checked':'')+'>'+f+'</label>'});
      h+='</div><div class="lg-sub">fields</div>';
      T.fields.forEach(function(f,j){h+='<div class="lg-row lg-field" data-j="'+j+'">'+inp(f.name,'data-f="fname"','hp')+inp(f.value,'data-f="fvalue" class="lg-num"','3')+'<button class="lg-x" data-f="fdel" title="Remove">✕</button></div>'});
      h+='<div class="lg-row"><button class="lg-add-field">+ field</button></div><div class="lg-errs"></div></div>';
      return h;
    }
    function wireThing(T){
      var box=pane.querySelector('.lg-thing');if(!box)return;
      function ch(){T.dirty=true;dirty()}
      var raw=box.querySelector('.lg-raw');
      if(raw)raw.oninput=function(){T.raw=raw.value;T.dirty=true;var m=/^thing\s+(\w+)/i.exec(raw.value);if(m)T.name=m[1];dirty()};
      box.querySelector('.lg-del-thing').onclick=function(){
        var gone=S.things.splice(S.sel,1)[0];
        if(gone&&gone.origName)S.removed.push(gone.origName);
        S.sel=Math.max(0,S.sel-1);dirty();renderThings();
      };
      if(T.kept)return;
      box.querySelectorAll('input[data-f],select[data-f]').forEach(function(el){
        var f=el.getAttribute('data-f'),row=el.closest('[data-j]'),j=row?Number(row.getAttribute('data-j')):-1;
        var ev=el.tagName==='SELECT'||el.type==='color'?'change':'input';
        el.addEventListener(ev,function(){
          var v=el.value;
          switch(f){
            case'name':{var old=T.name;T.name=v.trim();renameKind(old,T.name);pane.querySelector('.lg-kind.on').textContent=T.name;break}
            case'shape':T.shape.kind=v;ch();renderThings();return;
            case'sprite':T.shape.sprite=v;drawSprite(T);break;
            case'w':case'h':case'r':T.shape[f]=v;break;
            case'color':T.shape.color=v.trim();break;
            case'colorpick':T.shape.color=v;var c=box.querySelector('[data-f="color"]');if(c)c.value=v;break;
            case'atx':case'aty':T.at=T.at||{x:'',y:''};T.at[f==='atx'?'x':'y']=v.trim();break;
            case'sizew':case'sizeh':T.size=T.size||{w:'',h:''};T.size[f==='sizew'?'w':'h']=v.trim();break;
            case'count':case'pool':T[f]=v.trim();break;
            case'map':T.map=v;break;
            case'bkind':T.beh[j].kind=v;ch();renderThings();return;
            case'btarget':T.beh[j].target=v;break;
            case'barg':T.beh[j].arg=v.trim();break;
            case'fname':T.fields[j].name=v.trim();break;
            case'fvalue':T.fields[j].value=v.trim();break;
          }
          ch();
        });
        if(f==='bdel'||f==='fdel')el.onclick=function(){if(f==='bdel')T.beh.splice(j,1);else T.fields.splice(j,1);ch();renderThings()};
      });
      box.querySelectorAll('button[data-f="bdel"],button[data-f="fdel"]').forEach(function(el){
        var f=el.getAttribute('data-f'),j=Number(el.closest('[data-j]').getAttribute('data-j'));
        el.onclick=function(){if(f==='bdel')T.beh.splice(j,1);else T.fields.splice(j,1);ch();renderThings()};
      });
      box.querySelectorAll('input[data-flag]').forEach(function(el){el.onchange=function(){T.flags[el.getAttribute('data-flag')]=el.checked;ch()}});
      box.querySelector('.lg-add-beh').onclick=function(){T.beh.push({kind:'chase',target:kinds().filter(function(n){return n!==T.name})[0]||'',arg:'1'});ch();renderThings()};
      box.querySelector('.lg-add-field').onclick=function(){T.fields.push({name:'hp',value:'3'});ch();renderThings()};
      drawSprite(T);
    }
    function drawSprite(T){
      var c=pane.querySelector('.lg-spr');if(!c)return;
      var g=c.getContext('2d');g.clearRect(0,0,32,32);
      /* the sprite block of the program text (SPRITE's _sprBlockCanvas), scaled into the 32 px preview */
      var sc=T.shape.sprite&&typeof _sprBlockCanvas==='function'?_sprBlockCanvas(ctx,S.sprCache||(S.sprCache={}),T.shape.sprite):null;
      if(sc){var k=Math.min(32/sc.width,32/sc.height);g.save();g.imageSmoothingEnabled=false;g.drawImage(sc,Math.round((32-sc.width*k)/2),Math.round((32-sc.height*k)/2),Math.round(sc.width*k),Math.round(sc.height*k));g.restore()}
      else{g.strokeStyle='#4e5569';g.strokeRect(4.5,4.5,23,23)}
    }
    function renameKind(old,nw){
      if(!old||old===nw)return;
      S.things.forEach(function(t){t.beh.forEach(function(b){if(b.target===old){b.target=nw;t.dirty=true}})});
      S.rules.forEach(function(r){
        if(r.type!=='rule')return;
        var ch=false,e=r.ev;
        ['a','b','k'].forEach(function(k){if(e[k]===old){e[k]=nw;ch=true}});
        var re=new RegExp('(^|[^\\w.])'+old+'(?=\\s*\\.|\\s*\\))','g');
        function ren(o,k){if(typeof o[k]==='string'&&re.test(o[k])){re.lastIndex=0;o[k]=o[k].replace(re,function(m,pre){return pre+nw});ch=true}re.lastIndex=0}
        ren(e,'cond');
        r.actions.forEach(function(a){
          ['x','y','vx','vy','value'].forEach(function(k){ren(a,k)});
          if(a.subj===old){a.subj=nw;ch=true}
          if(a.kind===old){a.kind=nw;ch=true}
          if(a.target&&a.target.split('.')[0]===old){a.target=nw+a.target.slice(old.length);ch=true}
        });
        if(ch){r.dirty=true;S.rulesDirty=true}
      });
    }
    function markThings(){
      var box=pane.querySelector('.lg-thing');if(!box)return;
      var e=S.errs['t'+S.sel]||[],el=box.querySelector('.lg-errs');
      box.classList.toggle('bad',e.length>0);
      if(el)el.innerHTML=e.map(function(x){return'<div class="lg-err">✗ '+esc(x.text)+'</div>'}).join('');
      pane.querySelectorAll('.lg-kind').forEach(function(b){b.classList.toggle('bad',!!(S.errs['t'+b.getAttribute('data-i')]||[]).length)});
    }
    // ── RULES ──
    function evParams(e){
      var ks=kinds(),kopt=[['','(thing)']].concat(ks.map(function(n){return[n,n]})),h='';
      switch(e.kind){
        case'every':h+=inp(e.n,'data-f="n" class="lg-num" inputmode="decimal"','2')+sel([['s','seconds'],['ms','ms']],e.unit||'s','data-f="unit"');break;
        case'key':case'keydown':case'keyup':h+=sel(KEYS,e.key||'space','data-f="key"');break;
        case'press':case'hold':h+=sel(['A','B','C'],e.btn||'A','data-f="btn"');break;
        case'hit':h+=sel(kopt.concat(e.a&&ks.indexOf(e.a)<0?[[e.a,e.a]]:[]),e.a,'data-f="a"')+sel(kopt.concat([['wall','wall'],['edge','edge']]).concat(e.b&&ks.indexOf(e.b)<0&&e.b!=='wall'&&e.b!=='edge'?[[e.b,e.b]]:[]),e.b,'data-f="b"');break;
        case'when':h+=inp(e.cond,'data-f="cond" class="lg-expr"','score >= 10','lg-dl-expr');break;
        case'each':h+=sel(kopt.concat(e.k&&ks.indexOf(e.k)<0?[[e.k,e.k]]:[]),e.k,'data-f="k"')+inp(e.cond,'data-f="cond" class="lg-expr"','when … (optional)','lg-dl-expr');break;
      }
      return h;
    }
    function actParams(a){
      var ks=kinds(),sounds=blocksOf('sound'),h='';
      var subj=sel([['','(the thing involved)']].concat(ks.map(function(n){return[n,n]})).concat(a.subj&&ks.indexOf(a.subj)<0?[[a.subj,a.subj]]:[]),a.subj,'data-f="subj"');
      switch(a.verb){
        case'mv':case'vel':case'to':h+=subj+inp(a.x,'data-f="x" class="lg-expr"','x','lg-dl-expr')+inp(a.y,'data-f="y" class="lg-expr"','y','lg-dl-expr');break;
        case'remove':case'block':case'bounce':h+=subj;break;
        case'frame':h+=subj+inp(a.value,'data-f="value" class="lg-num"','0');break;
        case'spawn':h+=sel([['','(thing)']].concat(ks.map(function(n){return[n,n]})).concat(a.kind&&ks.indexOf(a.kind)<0?[[a.kind,a.kind]]:[]),a.kind,'data-f="kind"')+'<span class="lg-w">at</span>'+inp(a.x,'data-f="x" class="lg-expr"','x','lg-dl-expr')+inp(a.y,'data-f="y" class="lg-expr"','y','lg-dl-expr')+'<span class="lg-w">vel</span>'+inp(a.vx,'data-f="vx" class="lg-expr"','vx','lg-dl-expr')+inp(a.vy,'data-f="vy" class="lg-expr"','vy','lg-dl-expr');break;
        case'set':case'add':h+=inp(a.target,'data-f="target" class="lg-var"','score','lg-dl-var')+inp(a.value,'data-f="value" class="lg-expr"',a.verb==='add'?'1':'0','lg-dl-expr');break;
        case'play':case'music':h+=(sounds.length?sel([['','(sound)']].concat(sounds.concat(a.name&&sounds.indexOf(a.name)<0?[a.name]:[]).map(function(n){return[n,n]})),a.name,'data-f="name"'):inp(a.name,'data-f="name"','coin'));break;
        case'say':h+=inp(a.value,'data-f="value" class="lg-expr"','"You win!"','lg-dl-expr');break;
        case'burst':{var fxs=blocksOf('particles');h+=(fxs.length?sel([['','(particles)']].concat(fxs.concat(a.name&&fxs.indexOf(a.name)<0?[a.name]:[]).map(function(n){return[n,n]})),a.name,'data-f="name"'):inp(a.name,'data-f="name"','sparkle'))+'<span class="lg-w">at</span>'+inp(a.at,'data-f="at" class="lg-expr"','coin, or x, y','lg-dl-at');break}
        case'call':h+=inp(a.fn,'data-f="fn"','openChest','lg-dl-fn');break;
      }
      return h;
    }
    function lists(){
      var text=projText(),vars={},fns={};
      text.replace(/^(?:public\s+)?(?:mut|let)\s+([A-Za-z_]\w*)/gm,function(m,n){vars[n]=1});
      text.replace(/^(?:export\s+|public\s+)*fn\s+([A-Za-z_]\w*)/gm,function(m,n){fns[n]=1});
      S.rules.forEach(function(r){if(r.type==='rule')r.actions.forEach(function(a){if((a.verb==='set'||a.verb==='add')&&a.target&&a.target.indexOf('.')<0)vars[a.target]=1})});
      var fields=[];S.things.forEach(function(T){if(!T.kept){['x','y','vx','vy'].concat(T.fields.map(function(f){return f.name})).forEach(function(f){fields.push(T.name+'.'+f)})}});
      var v=Object.keys(vars).filter(function(n){return!/^__lg/.test(n)}).concat(fields);
      var ex=v.concat(S.things.map(function(T){return'count('+T.name+')'})).concat(['rnd(100)','stickX()','stickY()','tapX()','tapY()','i']);
      function dl(id,items){return'<datalist id="'+id+'">'+items.map(function(n){return'<option value="'+esc(n)+'">'}).join('')+'</datalist>'}
      return dl('lg-dl-var',v)+dl('lg-dl-expr',ex)+dl('lg-dl-at',S.things.map(function(T){return T.name}))+dl('lg-dl-fn',Object.keys(fns).filter(function(n){return n!=='frame'&&!/^__lg/.test(n)}));
    }
    function renderRules(){
      var h=lists()+'<div class="lg-rules">';
      /* rules: blocks of other files run after this one (file order); the tab edits the first block */
      try{var more=(ctx.blocks('rules')||[]).slice(1).map(function(b){return b&&b.path}).filter(Boolean);if(more.length)h='<p class="lg-hint lg-more-rules">These are the rules of '+esc(blockFile('rules')||'')+'. More rules: blocks in '+esc(more.join(', '))+' run after them (in file order) — edit those in their files.</p>'+h}catch(e){}
      S.rules.forEach(function(r,i){
        if(r.type==='blank')return;
        h+='<div class="lg-rule'+(r.type==='kept'?' kept':'')+(r.type==='rule'&&!r.enabled?' off':'')+'" data-i="'+i+'">';
        h+='<div class="lg-rhead"><span class="lg-handle" title="Drag to reorder">≡</span>';
        if(r.type==='kept'){h+='<span class="lg-keptlbl">kept as is</span><code class="lg-kepttext">'+esc(r.text)+'</code>'}
        else if(r.type==='setting'){h+='<label class="lg-chk"><input type="checkbox" data-f="enabled"'+(r.enabled?' checked':'')+'>on</label><span class="lg-w">setting</span>'+inp(r.text,'data-f="text" class="lg-expr lg-wide"','stage size 320 240')}
        else{
          h+='<label class="lg-chk"><input type="checkbox" data-f="enabled"'+(r.enabled?' checked':'')+'>on</label><span class="lg-w">WHEN</span>'+sel(EVENTS,r.ev.kind,'data-f="event"')+evParams(r.ev);
        }
        h+='<span class="lg-sp"></span><button class="lg-mv" data-d="-1" title="Move up">▲</button><button class="lg-mv" data-d="1" title="Move down">▼</button><button class="lg-x lg-delrule" title="Delete rule">🗑</button></div>';
        if(r.type==='rule'){
          r.actions.forEach(function(a,j){h+='<div class="lg-act" data-j="'+j+'"><span class="lg-w">'+(j?'and':'DO')+'</span>'+sel(VERBS,a.verb,'data-f="verb"')+actParams(a)+'<button class="lg-x" data-f="adel" title="Remove action">✕</button></div>'});
          h+='<div class="lg-act"><button class="lg-add-act">+ action</button></div>';
        }
        h+='<div class="lg-errs"></div></div>';
      });
      h+='</div><div class="lg-row"><button class="lg-add-rule">+ rule</button><button class="lg-add-setting">+ setting</button></div>';
      pane.innerHTML=h;
      pane.querySelector('.lg-add-rule').onclick=function(){S.rules.push({type:'rule',enabled:true,dirty:true,ev:{kind:'start'},actions:[{verb:'set',subj:'',target:'score',value:'0'}]});S.rulesDirty=true;dirty();renderRules()};
      pane.querySelector('.lg-add-setting').onclick=function(){S.rules.push({type:'setting',enabled:true,dirty:true,text:'stage size 320 240'});S.rulesDirty=true;dirty();renderRules()};
      pane.querySelectorAll('.lg-rule').forEach(wireRule);
      markRules();
    }
    function touch(r){r.dirty=true;S.rulesDirty=true;dirty()}
    function wireRule(el){
      var i=Number(el.getAttribute('data-i')),r=S.rules[i];
      el.querySelector('.lg-delrule').onclick=function(){S.rules.splice(i,1);S.rulesDirty=true;dirty();renderRules()};
      el.querySelectorAll('.lg-mv').forEach(function(b){b.onclick=function(){moveRule(i,Number(b.getAttribute('data-d')))}});
      dragHandle(el.querySelector('.lg-handle'),i);
      if(r.type==='kept')return;
      el.querySelectorAll('input[data-f],select[data-f]').forEach(function(x){
        var f=x.getAttribute('data-f'),act=x.closest('.lg-act'),j=act&&act.hasAttribute('data-j')?Number(act.getAttribute('data-j')):-1;
        var evn=x.tagName==='SELECT'||x.type==='checkbox'?'change':'input';
        x.addEventListener(evn,function(){
          var v=x.type==='checkbox'?x.checked:x.value;
          if(f==='enabled'){r.enabled=v;el.classList.toggle('off',!v);touch(r);return}
          if(r.type==='setting'){r.text=String(v).trim();touch(r);return}
          if(j<0){
            if(f==='event'){r.ev={kind:v};if(v==='hit'){var ks=kinds();r.ev.a=ks[0]||'';r.ev.b=ks[1]||'edge'}if(v==='each')r.ev.k=kinds()[0]||'';if(v==='every'){r.ev.n='1';r.ev.unit='s'}touch(r);renderRules();return}
            r.ev[f]=f==='cond'||f==='n'?String(v).trim():v;touch(r);return;
          }
          var a=r.actions[j];
          if(f==='verb'){r.actions[j]={verb:v,subj:'',x:'',y:'',vx:'',vy:'',kind:'',target:'',value:'',name:'',fn:''};if(v==='set'||v==='add'){r.actions[j].target='score';r.actions[j].value=v==='add'?'1':'0'}if(v==='mv'||v==='vel'||v==='to'){r.actions[j].x='0';r.actions[j].y='0'}if(v==='spawn')r.actions[j].kind=kinds()[0]||'';if(v==='burst'){r.actions[j].name=blocksOf('particles')[0]||'sparkle';r.actions[j].at=kinds()[0]||''}touch(r);renderRules();return}
          a[f]=typeof v==='string'&&f!=='subj'&&f!=='kind'&&f!=='name'?v.trim():v;touch(r);
        });
      });
      el.querySelectorAll('button[data-f="adel"]').forEach(function(b){var j=Number(b.closest('.lg-act').getAttribute('data-j'));b.onclick=function(){r.actions.splice(j,1);if(!r.actions.length)r.actions.push({verb:'stop',subj:''});touch(r);renderRules()}});
      var add=el.querySelector('.lg-add-act');
      if(add)add.onclick=function(){r.actions.push({verb:'add',subj:'',target:'score',value:'1'});touch(r);renderRules()};
    }
    function moveRule(i,d){
      var vis=S.rules.map(function(r,k){return r.type==='blank'?-1:k}).filter(function(k){return k>=0}),p=vis.indexOf(i),q=p+d;
      if(q<0||q>=vis.length)return;
      var to=vis[q],r=S.rules.splice(i,1)[0];
      S.rules.splice(to,0,r);
      S.rulesDirty=true;dirty();renderRules();
    }
    // drag a rule by its handle (pointer events: mouse, pen and touch)
    function dragHandle(hd,i){
      if(!hd)return;
      hd.style.touchAction='none';
      hd.addEventListener('pointerdown',function(ev){
        ev.preventDefault();
        var rows=Array.prototype.slice.call(pane.querySelectorAll('.lg-rule')),me=hd.closest('.lg-rule');
        me.classList.add('drag');
        try{hd.setPointerCapture(ev.pointerId)}catch(e){}
        function target(y){var t=null;rows.forEach(function(rw){var b=rw.getBoundingClientRect();if(y>b.top+b.height/2)t=rw});return t}
        function mv(e2){rows.forEach(function(rw){rw.classList.remove('dropafter')});var t=target(e2.clientY);if(t&&t!==me)t.classList.add('dropafter');else if(!t&&rows[0]!==me)rows[0].classList.add('dropbefore')}
        function up(e2){
          hd.removeEventListener('pointermove',mv);hd.removeEventListener('pointerup',up);hd.removeEventListener('pointercancel',up);
          var t=target(e2.clientY),from=i,r=S.rules[from];
          var to=t?Number(t.getAttribute('data-i')):-1;
          if(t===me){renderRules();return}
          S.rules.splice(from,1);
          if(to<0)S.rules.unshift(r);else{if(to>from)to--;S.rules.splice(to+1,0,r)}
          S.rulesDirty=true;dirty();renderRules();
        }
        hd.addEventListener('pointermove',mv);hd.addEventListener('pointerup',up);hd.addEventListener('pointercancel',up);
      });
    }
    function markRules(){
      var e=S.errs.r||[];
      pane.querySelectorAll('.lg-rule').forEach(function(el){
        var i=Number(el.getAttribute('data-i')),line=i+1,mine=e.filter(function(x){return x.line===line}).map(function(x){return x.text});
        if(S.keptErr&&S.keptErr[i])mine.push('does not compile: '+S.keptErr[i]);
        el.classList.toggle('bad',mine.length>0);
        el.querySelector('.lg-errs').innerHTML=mine.map(function(x){return'<div class="lg-err">✗ '+esc(x)+'</div>'}).join('');
      });
    }
    // ── save / try ──
    function save(){
      var file=blockFile('rules')||blockFile('thing')||undefined,n=0;
      S.removed.forEach(function(nm){try{ctx.remove('thing',nm);n++}catch(e){}});S.removed=[];
      S.things.forEach(function(T){
        if(!T.dirty)return;
        var txt=T.kept?T.raw:thingText(T);
        var tf=file;   /* a renamed thing stays in the file of its block (things may be in several files) */
        if(T.origName&&T.origName!==T.name){try{var ob=(ctx.blocks('thing')||[]).filter(function(b){return b&&b.name===T.origName})[0];if(ob&&ob.path)tf=ob.path}catch(e){}try{ctx.remove('thing',T.origName)}catch(e){}}
        ctx.write('thing',T.name,txt,tf);n++;
        T.orig=txt;T.origName=T.name;T.dirty=false;
      });
      if(S.rulesDirty){
        var rt=rulesText(S.rules);
        ctx.write('rules','',rt,file);n++;
        S.rules=parseRules(rt);S.rulesDirty=false;S.rulesExisted=true;
      }
      ctx.setDirty(false);
      ctx.toast(n?'Saved '+n+' block'+(n>1?'s':''):'Nothing changed');
      render();validate();
    }
    var foot=ctx.footer;
    foot.innerHTML='<button class="lg-try">▶ Try it</button><button class="lg-save">Save</button>';
    foot.querySelector('.lg-save').onclick=save;
    foot.querySelector('.lg-try').onclick=function(){save();try{ctx.run()}catch(e){}};
    window._lgTool={state:S,save:save,validate:validate,thingText:thingText,ruleText:ruleText,parseThing:parseThing,parseRuleLine:parseRuleLine,render:render};
    render();validate();
  }
  var CSS=[
    '.lg-tool{font-family:var(--sans,sans-serif);color:var(--fg,#d4d8e3);font-size:13px;max-width:100%;box-sizing:border-box}',
    '.lg-tool *{box-sizing:border-box}',
    '.lg-tabs{display:flex;gap:6px;margin-bottom:8px}',
    '.lg-tab{flex:1;padding:8px;border:1px solid var(--border,#1a1d2a);background:var(--bg3,#171a24);color:var(--fg2,#8c93a8);border-radius:6px;font-weight:600;letter-spacing:1px}',
    '.lg-tab.on{color:var(--cyan,#2dd4bf);border-color:var(--cyan,#2dd4bf)}',
    '.lg-kinds{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}',
    '.lg-kind,.lg-add-kind,.lg-tool button{min-height:32px;padding:4px 10px;border:1px solid var(--border,#1a1d2a);background:var(--bg4,#1f2333);color:var(--fg,#d4d8e3);border-radius:6px;font:inherit;max-width:100%}',
    '.lg-kind.on{border-color:var(--cyan,#2dd4bf);color:var(--cyan,#2dd4bf)}',
    '.lg-kind.bad,.lg-rule.bad,.lg-thing.bad{border-color:var(--red,#fb7185)!important}',
    '.lg-thing,.lg-rule{border:1px solid var(--border,#1a1d2a);background:var(--bg2,#0f1118);border-radius:8px;padding:8px;margin-bottom:8px;min-width:0}',
    '.lg-rule.off{opacity:.55}',
    '.lg-rule.kept{border-style:dashed}',
    '.lg-rule.drag{outline:2px solid var(--cyan,#2dd4bf)}',
    '.lg-rule.dropafter{box-shadow:0 3px 0 var(--cyan,#2dd4bf)}',
    '.lg-rule.dropbefore{box-shadow:0 -3px 0 var(--cyan,#2dd4bf)}',
    '.lg-row,.lg-rhead,.lg-act{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:4px 0;min-width:0}',
    '.lg-act{padding-left:18px}',
    '.lg-tool label{color:var(--fg2,#8c93a8);font-size:11px}',
    '.lg-tool input,.lg-tool select,.lg-tool textarea{min-height:32px;background:var(--bg,#08090d);color:var(--fg,#d4d8e3);border:1px solid var(--bg5,#282d3e);border-radius:5px;padding:3px 6px;font:12px var(--mono,monospace);min-width:0;max-width:100%}',
    '.lg-tool input[type=checkbox]{min-height:0;width:18px;height:18px}',
    '.lg-tool input[type=color]{width:36px;padding:1px}',
    '.lg-tool textarea{width:100%}',
    '.lg-num{width:64px}',
    '.lg-col{width:84px}',
    '.lg-name{flex:1 1 120px}',
    '.lg-expr{flex:1 1 110px;width:110px}',
    '.lg-var{flex:1 1 100px;width:100px}',
    '.lg-wide{flex:1 1 180px}',
    '.lg-w{color:var(--fg2,#8c93a8);font-size:11px;font-weight:700}',
    '.lg-sp{flex:1}',
    '.lg-handle{cursor:grab;padding:4px 8px;color:var(--fg3,#4e5569);font-size:18px;user-select:none}',
    '.lg-sub{color:var(--fg3,#4e5569);font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-top:8px}',
    '.lg-chk{display:inline-flex;align-items:center;gap:3px}',
    '.lg-keptlbl{color:var(--yellow,#fde047);font-size:11px}',
    '.lg-kepttext{font:12px var(--mono,monospace);color:var(--fg2,#8c93a8);overflow-wrap:anywhere;flex:1 1 160px;min-width:0}',
    '.lg-err{color:var(--red,#fb7185);font-size:12px;overflow-wrap:anywhere}',
    '.lg-hint{color:var(--fg3,#4e5569);font-size:11px}',
    '.lg-status{font-size:12px;color:var(--green,#4ade80);padding:6px 0;overflow-wrap:anywhere}',
    '.lg-status.bad{color:var(--red,#fb7185)}',
    '.lg-spr{width:32px;height:32px;border:1px solid var(--bg5,#282d3e);border-radius:4px;image-rendering:pixelated}'
  ].join('\n');
  _drawerRegister({id:'logic',label:'Logic',icon:'🧩',desc:'Things (game objects) and rules: what happens when',open:open});
})();

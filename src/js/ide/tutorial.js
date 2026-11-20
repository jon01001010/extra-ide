// ═══ TUTORIAL — a guided tour that makes a tiny "collect the coins" game with the Drawer (IDE only) ═══
// Entry points: the welcome overlay ("Start the tutorial"), 🧰 → Tutorial, and the link at the top of Help
// (_tutStart resumes where it was left, _tutRestart begins anew). A coach panel shows one step at a time —
// title, a few sentences, what to tap, and Back / Do it for me / Next / Skip tutorial:
//   • phones (≤ 600 px): a bottom (or top) sheet; while the drawer is open or the keyboard is up it shrinks to a
//     one-line strip; ▾ or Escape folds it into a "Step 3/12" pill;
//   • desktop: a floating card in the corner that covers least.
// Placement: candidates (mode × position) are tried in order and the first that covers neither the element to
// tap, the drawer's header and Save bar nor what the step needs to see (the game's on-screen controls, the
// Timeline bar, the focused field) wins; failing all, the pill goes where it covers least.
// A pulsing outline (#tutHi, pointer-events none, drawn just outside the element) follows the element to tap
// every animation frame — inside the drawer too; it is clipped to what is visible (scroll boxes, the screen)
// and hidden when nothing of the element is.
// Next unlocks when the step's check passes. Checks read real state — the project's blocks parsed with the
// compiler's own parser (_lgParseBlock for things and rules, compile() for the whole program) and the tools'
// parsers (_sprParse, _stBlockModel), the running program (_lgMeta, _lgTick), the Timeline — never the taps.
// "Do it for me" performs the step (and any earlier step it depends on whose check fails) and leaves exactly
// the state its check expects. Progress is kept under localStorage 'emit-tutorial' (wrapped: without storage
// the tutorial simply starts from the beginning).
(function(){
  var KEY='emit-tutorial',MARK='// My first game — made with the Emit tutorial.';
  var START=MARK+'\n// Everything you make with 🧰 (the Drawer) is written into this program as readable\n// blocks in their own tabs: sprites.emit, sounds.emit, stages.emit and game.emit.\n// This entry file needs no code of its own: the things and the rules make the game.\n';
  var HERO='sprite hero: 12x12\n  palette 1a1c2c 5fcde4 f4f4f4 3b5dc9\n  "...111111..."\n  "..12222221.."\n  ".1222222221."\n  ".1232222321."\n  ".1212222121."\n  ".1222222221."\n  "..12222221.."\n  "...111111..."\n  "..14444441.."\n  ".1444444441."\n  ".1441..1441."\n  "..11....11.."';
  var COIN='sprite coin: 8x8\n  palette b86f50 ffcd75 fff4c0\n  "..1111.."\n  ".122221."\n  "12232221"\n  "12322221"\n  "12222221"\n  "12222221"\n  ".122221."\n  "..1111.."';
  var N=12,WAIT_TL=8000;
  // ── storage (silent: may be unavailable, e.g. a page opened from content://) ──
  function sget(){try{var s=window.localStorage.getItem(KEY);return s?JSON.parse(s):null}catch(e){return null}}
  function sput(o){try{window.localStorage.setItem(KEY,JSON.stringify(o))}catch(e){}}
  var T={on:false,i:0,collapsed:false,userExpanded:false,stepAt:0,el:null,hi:null,res:null,ver:0,sig:'',raf:0,iv:0,
    tgt:null,tgtSay:'',tgtClip:null,tgtSeen:null,cache:{},tl:{scrubbed:false,resumed:false},lastRun:null,speed0:null,ask:false,busy:false};
  function save(){sput({v:1,i:T.i,active:T.on,collapsed:T.collapsed,speed0:T.speed0})}
  // ── reading the project ──
  function q(s,root){try{return(root||document).querySelector(s)}catch(e){return null}}
  function lc(x){return String(x==null?'':x).toLowerCase()}   // names are case-insensitive: Hero is hero
  function blocks(k){try{return _drawerBlocks(k)}catch(e){return[]}}
  function text(){try{return _projText()}catch(e){return''}}
  function painted(){
    var out=[];
    blocks('sprite').forEach(function(b){
      var n=0;try{var d=_sprParse(b.text.split('\n'),1,true);d.frames.forEach(function(f){for(var i=0;i<f.data.length;i++)if(f.data[i]!=='.'&&f.data[i]!==' ')n++})}catch(e){n=0}
      if(n>0)out.push({name:b.name,n:n});
    });
    return out;
  }
  function spriteFor(want,not){var p=painted(),h=p.filter(function(s){return lc(s.name)===lc(want)})[0];if(h)return h.name;h=p.filter(function(s){return lc(s.name)!==lc(not)})[0];return h?h.name:null}
  function mapModel(b){try{return _stBlockModel('map',b.name,b.text)}catch(e){return null}}
  // the first map with solid tiles, a hero object and a coin object (level1 first)
  function level(){
    var best=null;
    blocks('map').forEach(function(b){
      var m=mapModel(b);if(!m)return;
      var solid=m.legend.filter(function(e){return e.solid&&e.ch}).map(function(e){return e.ch}),walls=0;
      m.rows.forEach(function(r){Array.from(r).forEach(function(c){if(solid.indexOf(c)>=0)walls++})});
      var hero=m.objects.filter(function(o){return lc(o.kind)==='hero'}).length,coin=m.objects.filter(function(o){return lc(o.kind)==='coin'}).length;
      var r={name:b.name,walls:walls,hero:hero,coin:coin,w:m.w,h:m.h,tile:m.tile,ok:walls>0&&hero>0&&coin>0};
      if(!best||(r.ok&&!best.ok)||(r.ok&&best.ok&&lc(r.name)==='level1'))best=r;
    });
    return best;
  }
  function pad(){
    var r=null;
    blocks('controls').forEach(function(b){
      if(r&&r.ok)return;
      var C=null;try{C=_stBlockModel('controls',b.name,b.text)}catch(e){}
      if(!C)return;
      var x={name:b.name,ok:C.stick!=='none'&&C.buttons.some(function(k){return k.id==='A'})};
      if(!r||x.ok)r=x;
    });
    return r;
  }
  function things(){
    var o={};
    blocks('thing').forEach(function(b){
      try{
        var d=_lgParseBlock(b.text).decl,t={name:d.name,sprite:null,map:null,speed:null,solid:false,path:b.path,text:b.text};
        d.items.forEach(function(it){if(it.kind==='sprite')t.sprite=it.sprite.value;else if(it.kind==='from')t.map=it.map.value;else if(it.kind==='solid')t.solid=true;else if(it.kind==='field'&&lc(it.name)==='speed'){var m=/(?:^|[,:\s])speed\s+([^,\n]+)/i.exec(b.text);t.speed=m?m[1].trim():'?'}});
        if(!o[lc(d.name)])o[lc(d.name)]=t;
      }catch(e){}
    });
    return o;
  }
  function soundNames(){return blocks('sound').map(function(b){return b.name})}
  function hasName(list,n){return list.some(function(x){return lc(x)===lc(n)})}
  // The rules the game needs, read with the compiler's own parser. `src` (optional) is a rules: block text to
  // judge instead of the project's (the Logic tool's unsaved rows).
  function rulesCheck(src){
    var need={stick:false,wall:false,coin:false,win:false,map:false,ctl:false,show:false},err=null,L=level(),P=pad(),th=things(),snd=soundNames();
    var texts=src?[src]:blocks('rules').map(function(b){return b.text});
    if(!texts.length)return{ok:false,msg:'No rules: block yet.',need:need};
    texts.forEach(function(t){
      var lines=t.split('\n'),d;
      try{d=_lgParseBlock(t).decl}catch(e){err=e.message;return}
      d.rules.forEach(function(R){
        var line=lines[(R.tok&&R.tok.line||1)-1]||'',A=R.actions||[];
        if(R.dir==='stage'&&R.what==='map'&&R.map&&L&&lc(R.map.value)===lc(L.name))need.map=true;
        if(R.dir==='stage'&&R.what==='controls'&&R.ctl&&P&&lc(R.ctl.value)===lc(P.name))need.ctl=true;
        if(R.dir==='show'&&/\bscore\b/i.test(line))need.show=true;
        if(R.dir)return;
        function act(v,s){return A.some(function(a){return a.verb===v&&(s===undefined||(a.subj&&lc(a.subj.value)===s))})}
        if((R.ev==='frame'||R.ev==='touch')&&A.some(function(a){return(a.verb==='mv'||a.verb==='vel')&&a.subj&&lc(a.subj.value)==='hero'})&&/stickX\s*\(/i.test(line)&&/stickY\s*\(/i.test(line))need.stick=true;
        if(R.ev==='hit'&&lc(R.a.value)==='hero'&&lc(R.b.value)==='wall'&&A.some(function(a){return a.verb==='block'&&(!a.subj||lc(a.subj.value)==='hero')}))need.wall=true;
        if(R.ev==='hit'&&lc(R.a.value)==='hero'&&lc(R.b.value)==='coin'&&act('remove','coin')&&A.some(function(a){return a.verb==='add'&&a.target&&lc(a.target.value)==='score'&&!a.field})&&A.some(function(a){return a.verb==='play'&&hasName(snd,a.name)}))need.coin=true;
        if(R.ev==='when'&&/count\s*\(\s*coin\s*\)\s*(==\s*0|<=\s*0|<\s*1)\b/i.test(line)&&act('say'))need.win=true;
      });
    });
    if(th.hero&&th.hero.solid)need.wall=true;
    if(err)return{ok:false,msg:'The rules do not read yet: '+err,need:need};
    var miss=[];
    if(!need.map)miss.push(L?'stage map '+L.name:'stage map (make the level first)');
    if(!need.ctl)miss.push(P?'stage controls '+P.name:'stage controls (make the controls first)');
    if(!need.show)miss.push('show score');
    if(!need.stick)miss.push('every frame: hero mv stickX() * 2, stickY() * 2');
    if(!need.wall)miss.push('on hit hero wall: block hero');
    if(!need.coin)miss.push('on hit hero coin: remove coin : add score 1 : play '+(snd[0]||'coin'));
    if(!need.win)miss.push('when count(coin) == 0: say "You win!"');
    if(miss.length)return{ok:false,msg:'Still missing: '+miss.join(' · '),need:need};
    if(src)return{ok:true,msg:'',need:need};
    var errs=[];try{errs=compile(text(),'wasm32').errors||[]}catch(e){errs=[e.message]}
    if(errs.length)return{ok:false,msg:'The program does not compile yet: '+errs[0],need:need};
    return{ok:true,msg:'✓ The rules are in game.emit and the program compiles.',need:need};
  }
  function heroFile(){var t=things().hero;return t?t.path:null}
  // ── views and the drawer ──
  function phone(){return window.innerWidth<=600}
  function narrow(){return window.innerWidth<768}
  function drawerOpen(){try{return _drawerIsOpen()}catch(e){return false}}
  function toolId(){try{return drawerOpen()&&_drawer.tool?_drawer.tool.id:null}catch(e){return null}}
  function runVisible(){var p=document.getElementById('pnl-run');return!narrow()||!!(p&&!/off-r/.test(p.className))}
  function editVisible(){var p=document.getElementById('pnl-edit');return!narrow()||!!(p&&!/off-l/.test(p.className))}
  // what to tap to get into tool `id` (null once it is open)
  function nav(id,label){
    if(!drawerOpen())return{el:q('.header .hdr-btn[title="Drawer"]'),say:'Tap 🧰 (the Drawer) at the top.'};
    var t=toolId();
    if(!t)return{el:q('#drawer .drw-card[data-tool="'+id+'"]'),say:'Tap '+label+'.'};
    if(t!==id)return{el:q('#drawer .drw-back'),say:'Tap ‹ to go back to the list of tools.'};
    return null;
  }
  function closeDrawerQuietly(){try{if(drawerOpen()){_drawerLeave();_drawer.el.classList.remove('show')}}catch(e){}}
  // after "Do it for me": a tool that is open shows the new blocks
  function reopen(id){try{if(toolId()===id){_drawerLeave();_drawerTool(_drawerFind(id))}}catch(e){}}
  function toRun(){closeDrawerQuietly();try{if(narrow())showView('run')}catch(e){}}
  function run(){toRun();try{var p=compileAndRun();if(p&&p.catch)p.catch(function(){});return p}catch(e){return null}}
  function write(kind,name,txt){return _drawerWrite(kind,name,txt)}
  // ── the steps ──
  function spriteTool(){var r=q('#drawer .spt');return r&&r._spt?r._spt:null}
  function curPixels(api){try{var S=api.state(),n=0;S.frames.forEach(function(f){for(var i=0;i<f.px.length;i++)if(f.px[i])n++});return n}catch(e){return 0}}
  function spriteTarget(want,second){
    var n=nav('sprite','the Sprite card');if(n)return n;
    var api=spriteTool();if(!api)return null;
    var S=api.state(),names=blocks('sprite').map(function(b){return b.name}),saved=names.indexOf(S.name)>=0&&!api.isDirty();
    if(second&&saved&&painted().some(function(p){return p.name===S.name}))return{el:q('#drawer .spt select'),say:'Pick “New sprite…” in the list at the top.'};
    if(/^sprite\d+$/.test(S.name))return{el:q('#drawer .spt input[aria-label="Sprite name"]'),say:'Type '+want+' in the name box.'};
    if(!curPixels(api))return{el:q('#drawer .spt-stage canvas'),say:'Paint: tap a colour in the palette below the grid, then drag a finger over the grid.'};
    return{el:q('#drawer .spt-save'),say:'Tap Save.'};
  }
  function lgState(){try{return toolId()==='logic'&&window._lgTool&&_lgTool.state?_lgTool.state:null}catch(e){return null}}
  var STEPS=[
    {id:'welcome',title:'Welcome',ro:true,
      html:'<p>In about 10 minutes you will make <b>Coin Dash</b>, a tiny game: a hero walks around a walled room and collects coins.</p><p>You draw everything with <b>🧰 the Drawer</b> — and see that it all becomes readable Emit code.</p>',
      target:function(){return{el:null,say:'Tap Next to begin.'}}},
    {id:'project',pure:true,title:'A new project',
      html:'<p>The game goes into a fresh project. If your current program has work in it you can download it first — or cancel.</p>',
      extra:'project',
      check:function(){var f=_proj.files[0];return f&&f.source.indexOf(MARK)===0?{ok:true,msg:'✓ A new project with one file, main.emit.'}:{ok:false,msg:'Not yet: the project is still your old program.'}},
      target:function(){return T.ask?{el:q('#tutCoach .tut-dl'),say:'Download a copy first, replace it, or cancel.'}:{el:q('#tutCoach .tut-new'),say:'Tap “Start a new project” below.'}},
      doIt:function(){newProject(false)}},
    {id:'hero',pure:true,title:'Paint the hero',
      html:'<p>Open <b>🧰 → Sprite</b>. Type <b>hero</b> as the name, paint a small character with your finger (any pixels will do), then tap <b>Save</b>.</p>',
      check:function(){var p=painted();return p.length?{ok:true,msg:'✓ sprite '+p[0].name+' is in sprites.emit ('+p[0].n+' pixels).'}:{ok:false,msg:'Not yet: no sprite block with painted pixels.'}},
      keep:function(){return T.tgt&&!/^(INPUT|SELECT)$/.test(T.tgt.tagName)?[q('#drawer .spt-pal'),q('#drawer .spt-tools'),q('#drawer .spt-stage canvas')]:[]},
      target:function(){return spriteTarget('hero',false)},
      doIt:function(){write('sprite','hero',HERO);reopen('sprite')}},
    {id:'coin',pure:true,title:'Paint a coin',
      html:'<p>Still in <b>Sprite</b>: pick <b>New sprite…</b> in the list at the top, name it <b>coin</b>, paint a coin and <b>Save</b>.</p>',
      deps:['hero'],
      check:function(){var p=painted();return p.length>=2?{ok:true,msg:'✓ Two sprites: '+p[0].name+' and '+p[1].name+'.'}:{ok:false,msg:'Not yet: '+(p.length?'one painted sprite ('+p[0].name+'); paint a second one.':'no painted sprite yet.')}},
      keep:function(){return T.tgt&&!/^(INPUT|SELECT)$/.test(T.tgt.tagName)?[q('#drawer .spt-pal'),q('#drawer .spt-tools'),q('#drawer .spt-stage canvas')]:[]},
      target:function(){return spriteTarget('coin',true)},
      doIt:function(){write('sprite',painted().some(function(p){return lc(p.name)==='coin'})?'coin2':'coin',COIN);reopen('sprite')}},
    {id:'sound',pure:true,title:'A sound',
      html:'<p>Open <b>🧰 → Sound</b>. Tap the <b>coin</b> preset (you will hear it), then <b>Save to program</b>.</p>',
      check:function(){var s=soundNames();return s.length?{ok:true,msg:'✓ sound '+s[0]+' is in sounds.emit.'}:{ok:false,msg:'Not yet: no sound block.'}},
      target:function(){
        var n=nav('sound','the Sound card');if(n)return n;
        var dirty=false;try{dirty=_drawer.dirty}catch(e){}
        if(!dirty){var b=null;Array.prototype.forEach.call(document.querySelectorAll('#drawer .drw-body .drw-sm'),function(x){if(x.textContent==='coin')b=x});return{el:b,say:'Tap the coin preset.'}}
        return{el:q('#drawerFoot .drw-pri'),say:'Tap Save to program.'};
      },
      doIt:function(){write('sound','coin',_sndWrite('coin',_sndPreset('coin'),null));reopen('sound')}},
    {id:'level',pure:true,title:'The level',
      html:'<p>Open <b>🧰 → Stage</b>. A new map already has walls around the edge (draw more with <b>▣ room</b>) and a <b>hero</b> object.</p><p>Tap <b>◆ objects</b>, then tap the floor to place three <b>coin</b> objects (the object box says coin). <b>Save</b>.</p>',
      check:function(){var L=level();if(L&&L.ok)return{ok:true,msg:'✓ map '+L.name+': walls, a hero and '+L.coin+' coin'+(L.coin>1?'s':'')+'.'};return{ok:false,msg:'Not yet: '+(!L?'no map block.':!L.walls?'the map has no solid tiles (walls).':!L.hero?'the map has no hero object.':'the map has no coin objects.')}},
      target:function(){
        var n=nav('stage','the Stage card');if(n)return n;
        var r=q('#drawer [data-stage-tool]');if(!r||!r._stageApi)return null;
        var m=r._stageApi.model(),c=m.objects.filter(function(o){return lc(o.kind)==='coin'}).length,h=m.objects.some(function(o){return lc(o.kind)==='hero'});
        if((c<3||!h)&&r._stage.tool!=='objects')return{el:q('#drawer [data-tool="objects"]'),say:'Tap ◆ objects.'};
        if(c<3)return{el:q('#drawer [data-stg="view"]'),say:'Tap the floor to place a coin ('+c+' of 3).'};
        if(!h)return{el:q('#drawer [data-stg="kind"]'),say:'Type hero in the object box, then tap the floor.'};
        return{el:q('#drawer [data-stg="save"]'),say:'Tap Save.'};
      },
      doIt:function(){
        var m=_stNewMap('level1');
        function wall(y,x0,x1){var a=Array.from(m.rows[y]);for(var x=x0;x<=x1;x++)a[x]='#';m.rows[y]=a.join('')}
        wall(4,5,10);wall(8,9,12);
        [[14,1],[2,10],[13,10],[7,6],[11,3]].forEach(function(p){m.objects.push({kind:'coin',x:p[0],y:p[1],props:[]})});
        write('map','level1',_stWriteMap(m));reopen('stage');
      }},
    {id:'controls',pure:true,title:'Controls',
      html:'<p>Phones need buttons on the screen. Open <b>🧰 → Controls</b>: the new pad has a stick and buttons A and B. Tap <b>1</b> to keep just A, then <b>Save</b>.</p>',
      check:function(){var P=pad();return P&&P.ok?{ok:true,msg:'✓ controls '+P.name+': a stick and button A.'}:{ok:false,msg:P?'Not yet: controls '+P.name+' needs a stick and button A.':'Not yet: no controls block.'}},
      target:function(){
        var n=nav('controls','the Controls card');if(n)return n;
        var r=q('#drawer [data-controls-tool]');if(!r||!r._ctl||!r._ctl.C)return null;
        var C=r._ctl.C;
        if(C.stick==='none')return{el:q('#drawer [data-ctl-f="stick"]'),say:'Tap stick.'};
        if(C.buttons.length!==1)return{el:q('#drawer [data-ctl-f="n1"]'),say:'Tap 1 (one button: A).'};
        return{el:q('#drawer [data-ctl-f="save"]'),say:'Tap Save.'};
      },
      doIt:function(){write('controls','pad','controls pad: stick left, buttons A');reopen('controls')}},
    {id:'things',pure:true,title:'Things',
      html:'<p>Open <b>🧰 → Logic</b> (THINGS). Tap <b>+ thing</b>: name <b>hero</b>, shape <b>sprite</b> → hero, <b>from map</b> → your map; add a field <b>speed 2</b>.</p><p>Again for <b>coin</b> (sprite coin, from map). Then <b>Save</b>.</p>',
      deps:['coin','level'],
      check:function(){
        var th=things(),L=level(),sp=painted().map(function(p){return p.name}),bad=[];
        ['hero','coin'].forEach(function(k){var t=th[k];if(!t)bad.push('no thing '+k);else if(!t.sprite||!hasName(sp,t.sprite))bad.push(k+' does not use a painted sprite');else if(!t.map||!L||lc(t.map)!==lc(L.name))bad.push(k+' is not “from map '+(L?L.name:'…')+'”')});
        return bad.length?{ok:false,msg:'Not yet: '+bad.join(' · ')+'.'}:{ok:true,msg:'✓ thing hero and thing coin come from map '+L.name+'.'};
      },
      target:function(){
        var n=nav('logic','the Logic card');if(n)return n;
        var S=lgState();if(!S)return null;
        if(S.tab!=='things')return{el:q('#drawer .lg-tab[data-tab="things"]'),say:'Tap THINGS.'};
        var L=level(),want=null;
        ['hero','coin'].some(function(k){var t=S.things.filter(function(x){return lc(x.name)===k})[0];if(!t||t.kept||t.shape.kind!=='sprite'||!t.shape.sprite||!t.map){want=k;return true}return false});
        if(!want)return{el:q('#drawer .lg-save'),say:'Tap Save.'};
        var cur=S.things[S.sel],i=-1;S.things.forEach(function(x,j){if(lc(x.name)===want)i=j});
        if(i<0){if(cur&&/^thing\d+$/.test(cur.name))return{el:q('#drawer .lg-thing [data-f="name"]'),say:'Type '+want+' as the name.'};return{el:q('#drawer .lg-add-kind'),say:'Tap + thing.'}}
        if(i!==S.sel)return{el:q('#drawer .lg-kind[data-i="'+i+'"]'),say:'Tap '+want+'.'};
        if(cur.shape.kind!=='sprite')return{el:q('#drawer .lg-thing [data-f="shape"]'),say:'Choose shape: sprite.'};
        if(!cur.shape.sprite)return{el:q('#drawer .lg-thing [data-f="sprite"]'),say:'Choose the sprite '+want+'.'};
        return{el:q('#drawer .lg-thing [data-f="map"]'),say:'Choose from map: '+(L?L.name:'your map')+'.'};
      },
      doIt:function(){
        var L=level(),h=spriteFor('hero',null),c=spriteFor('coin',h);
        write('thing','hero','thing hero: sprite '+h+', from map '+L.name+', speed 2');
        write('thing','coin','thing coin: sprite '+c+', from map '+L.name);
        reopen('logic');
      }},
    {id:'rules',pure:true,title:'Rules',
      html:'<p>In <b>Logic</b>, tap <b>RULES</b> and build these (<b>+ rule</b> for each; <b>+ setting</b> for the first three), then <b>Save</b>:</p><pre>stage map level1\nstage controls pad\nshow score\nevery frame: hero mv stickX() * hero.speed, stickY() * hero.speed\non hit hero wall: block hero\non hit hero coin: remove coin : add score 1 : play coin\nwhen count(coin) == 0: say "You win!"</pre><p>It is a lot of tapping on a phone — “Do it for me” is fine.</p>',
      deps:['sound','controls','things'],
      check:function(){return rulesCheck()},
      target:function(){
        var n=nav('logic','the Logic card');if(n)return n;
        var S=lgState();if(!S)return null;
        if(S.tab!=='rules')return{el:q('#drawer .lg-tab[data-tab="rules"]'),say:'Tap RULES.'};
        var t='rules:';try{S.rules.forEach(function(r){if(r.type!=='blank'&&r.type!=='kept'&&r.enabled)t+='\n  '+_lgTool.ruleText(r);else if(r.type==='kept')t+='\n'+r.orig})}catch(e){}
        var c=rulesCheck(t);
        if(c.ok)return{el:q('#drawer .lg-save'),say:'Tap Save.'};
        var setting=!(c.need.map&&c.need.ctl&&c.need.show);
        return{el:q(setting?'#drawer .lg-add-setting':'#drawer .lg-add-rule'),say:setting?'Tap + setting, then edit its text.':'Tap + rule, then choose WHEN and DO from the menus.'};
      },
      doIt:function(){
        var L=level(),P=pad(),th=things(),s=soundNames(),sp=th.hero&&th.hero.speed!==null?'hero.speed':'2';
        var snd=s.filter(function(x){return lc(x)==='coin'})[0]||s[0];
        write('rules','',['rules:','  stage size '+(L.w*L.tile)+' '+(L.h*L.tile),'  stage map '+L.name,'  stage controls '+P.name,'  show score',
          '  every frame: hero mv stickX() * '+sp+', stickY() * '+sp,'  on hit hero wall: block hero','  on hit hero coin: remove coin : add score 1 : play '+snd,'  when count(coin) == 0: say "You win!"'].join('\n'));
        reopen('logic');
      }},
    {id:'run',title:'Run it',
      html:'<p>Tap <b>▶</b>. Walk with the stick (or the arrow keys / WASD) and grab the coins: the score in the corner goes up.</p>',
      deps:['rules'],
      check:function(){
        var m=null;try{m=_lgMeta}catch(e){}
        var k=m&&m.kinds?m.kinds.map(function(x){return x.name}):[],tick=0;try{tick=_lgTick}catch(e){}
        var ok=!!(window._wi&&window._wi.exports&&window._wi.exports.frame&&hasName(k,'hero')&&hasName(k,'coin')&&m.shows&&hasName(m.shows,'score')&&tick>=5);
        return ok?{ok:true,msg:'✓ It runs: frame() has run '+tick+' times; the score shows in the corner.'}:{ok:false,msg:'Not yet: run the game with ▶.'};
      },
      keep:function(){return[q('#tab-output [data-emit-controls]'),q('#tab-output canvas')]},
      target:function(){
        if(drawerOpen())return{el:q('#drawer .drw-x'),say:'Close the drawer (✕).'};
        if(!this.check().ok)return{el:q('.header .hdr-btn.run'),say:'Tap ▶ (Run).'};
        if(narrow()&&!runVisible())return{el:q('.vtab[data-v="run"]'),say:'Tap Output to see the game.'};
        // once: the game itself into view (on a phone it is below the compile report)
        var cv=q('#tab-output canvas');if(cv&&T.shown!==cv){T.shown=cv;try{cv.scrollIntoView({block:'nearest'})}catch(e){}}
        return{el:null,say:'Play! Walk into a coin.'};
      },
      doIt:function(){return run()}},
    {id:'rewind',title:'Rewind',
      html:'<p>Under the game the <b>Timeline</b> records every frame. Drag its slider back (or tap ⏮ a few times) to see the past, then tap <b>⟲ resume from here</b>.</p>',
      deps:['run'],
      check:function(){
        if(T.tl.scrubbed&&T.tl.resumed)return{ok:true,msg:'✓ You went back in time and resumed from there.'};
        var t=Date.now()-T.stepAt>WAIT_TL;
        return{ok:false,later:t,msg:T.tl.scrubbed?'Now tap ⟲ resume from here (or ▶).':'Not yet: drag the Timeline slider back.'+(t?' (You can also just go on.)':'')};
      },
      keep:function(){return[q('#tlBar'),q('#tab-output canvas')]},
      target:function(){
        if(drawerOpen())return{el:q('#drawer .drw-x'),say:'Close the drawer (✕).'};
        if(narrow()&&!runVisible())return{el:q('.vtab[data-v="run"]'),say:'Tap Output.'};
        if(!q('#tlBar .tl-slider'))return{el:q('.header .hdr-btn.run'),say:'Tap ▶ (Run) first.'};
        if(!T.tl.scrubbed)return{el:q('#tlBar .tl-slider'),say:'Drag the slider to the left.'};
        if(!T.tl.resumed)return{el:q('#tlBar [data-tl="resume"]'),say:'Tap ⟲ resume from here.'};
        return{el:null,say:''};
      },
      doIt:function(){
        var go=function(){
          try{
            var n=_tl.frames.length;if(n<10)return false;
            _tlPause();_tlShow(Math.max(0,n-1-Math.min(30,n-1)));_tlResume();return true;
          }catch(e){return false}
        };
        try{if(_tl.on&&_tl.frames.length>=10&&_animRunning){toRun();go();return}}catch(e){}
        var p=run();
        return Promise.resolve(p).then(function(){return new Promise(function(res){var t0=Date.now();(function w(){if(go()||Date.now()-t0>4000)res();else setTimeout(w,60)})()})});
      }},
    {id:'inside',title:'Look inside',
      html:'<p>Everything you made is plain text. Open the <b>game.emit</b> tab in the Editor, change the hero’s <code>speed 2</code> to <code>speed 3</code> and tap <b>▶</b> again.</p><p class="tut-more"><b>Share</b>: 🔗 makes a link with the whole project. <b>File → Export .html (offline)</b> gives one file that runs anywhere.<br><b>Where next</b>: Example → <b>Game</b> (a bigger Coin Dash with slimes and music), <b>?</b> Help (Things, Rules, Sprites, Maps), and <b>🧰 → Script</b> for Mote scripts (dialogue, level logic).</p>',
      deps:['things'],
      check:function(){
        var t=things().hero;
        if(!t)return{ok:false,msg:'Not yet: there is no thing hero.'};
        if(t.speed===null||t.speed===T.speed0)return{ok:false,msg:'Not yet: change the hero’s speed in '+t.path+'.'};
        if(!T.lastRun||T.lastRun.indexOf(t.text)<0)return{ok:false,msg:'Now tap ▶ to run it again with speed '+t.speed+'.'};
        return{ok:true,msg:'✓ speed '+t.speed+' — you edited the game by hand.'};
      },
      target:function(){
        if(drawerOpen())return{el:q('#drawer .drw-x'),say:'Close the drawer (✕).'};
        var t=things().hero,c=this.check();
        if(t&&t.speed!==null&&t.speed!==T.speed0){if(!c.ok)return{el:q('.header .hdr-btn.run'),say:'Tap ▶ (Run).'};return{el:null,say:'Tap Finish.'}}
        if(narrow()&&!editVisible())return{el:q('.vtab[data-v="edit"]'),say:'Tap Editor.'};
        var p=heroFile(),i=p?_projFind(p):-1;
        if(i>=0&&i!==_proj.active)return{el:q('#fileTabs .ftab[data-i="'+i+'"]'),say:'Tap the '+p+' tab.'};
        return{el:q('#editor'),say:'Find “speed 2” and change the number.'};
      },
      doIt:function(){
        var t=things().hero,v=t.speed===null||t.speed==='2'?'3':t.speed==='3'?'4':'3';
        var nt=t.speed===null?t.text.replace(/^(thing hero:[^\n]*)/i,'$1, speed '+v):t.text.replace(/(^|[,:\s])speed\s+[^,\n]+/i,'$1speed '+v);
        var r=write('thing','hero',nt),i=_projFind(r.path);
        closeDrawerQuietly();
        try{if(narrow())showView('edit');if(i>=0)_projSetActive(i);var p=ed.value.toLowerCase().indexOf('speed '+v,ed.value.toLowerCase().indexOf('thing hero'));if(p>=0){ed.setSelectionRange(p+6,p+6+v.length)}}catch(e){}
        return run();
      }}
  ];
  if(STEPS.length!==N)N=STEPS.length;
  function stepIx(id){for(var i=0;i<STEPS.length;i++)if(STEPS[i].id===id)return i;return-1}
  function res(i){
    var s=STEPS[i];if(!s||s.ro||!s.check)return{ok:true,msg:''};
    // a check that reads only the program text is computed again only when the text changed
    var key=s.pure?text():null;if(s.pure&&T.cache[s.id]&&T.cache[s.id].k===key)return T.cache[s.id].r;
    var r;try{r=s.check()||{ok:false,msg:''}}catch(e){r={ok:false,msg:'Not yet ('+(e&&e.message||e)+').'}}
    if(s.pure)T.cache[s.id]={k:key,r:r};
    return r;
  }
  // ── step 2: a new project (asks first when the current program has work in it) ──
  function worthKeeping(){
    var t=text().trim();if(!t||t===START.trim()||t==='// New Emit program\n\nexport fn myapp() {\n  print(42)\n}')return false;   // (the IDE's first program)
    try{for(var k in EX)if(typeof EX[k]==='string'&&EX[k].trim()===t)return false}catch(e){}
    return true;
  }
  function newProject(force){
    if(!force&&worthKeeping()){T.ask=true;render();return false}
    T.ask=false;closeDrawerQuietly();
    try{_projLoad(START);_projSave();var x=document.getElementById('example');if(x)x.value='';if(narrow())showView('edit')}catch(e){}
    render();return true;
  }
  // ── the panel ──
  var CSS='.tut{position:fixed;z-index:260;left:0;top:0;box-sizing:border-box;display:flex;flex-direction:column;background:var(--bg2);color:var(--fg);border:1px solid var(--cyan);border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.6);font-family:var(--sans);font-size:14px;line-height:1.45;max-width:100vw}'
    +'.tut.tut-ph{border-left:none;border-right:none}.tut.tut-ph.tut-bot{border-radius:14px 14px 0 0;border-bottom-color:transparent}.tut.tut-ph.tut-top{border-radius:0 0 14px 14px;border-top-color:transparent}.tut.tut-ph .tut-skip{margin-bottom:var(--safe-b)}'
    +'.tut-hd{display:flex;align-items:center;gap:8px;padding:4px 4px 2px 12px}.tut-n{font-family:var(--mono);font-size:11px;color:var(--cyan);white-space:nowrap}'
    +'.tut-t{flex:1;min-width:0;margin:0;font-weight:700;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    +'.tut-ib{min-width:44px;min-height:44px;background:none;border:none;color:var(--fg2);font-size:18px;border-radius:8px;cursor:pointer;font-family:var(--mono);flex-shrink:0}'
    +'.tut-body{overflow-y:auto;overflow-x:hidden;padding:0 12px;min-height:0;flex:1 1 auto;overscroll-behavior:contain}.tut-body p{margin:0 0 6px}'
    +'.tut code{font-family:var(--mono);font-size:12px;background:var(--bg4);padding:1px 4px;border-radius:4px}'
    +'.tut pre{font-family:var(--mono);font-size:11.5px;line-height:1.5;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:6px 8px;white-space:pre-wrap;word-break:break-word;margin:4px 0 6px}'
    +'.tut-tap{color:var(--yellow);font-weight:600}.tut-st{font-size:13px;color:var(--fg2)}.tut-st.ok{color:var(--green)}.tut-more{font-size:13px;color:var(--fg2);border-top:1px solid var(--border);padding-top:6px}'
    +'.tut-x{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 8px}'
    +'.tut-btns{display:flex;gap:6px;padding:6px 12px 2px;flex-shrink:0}'
    +'.tut-btn{min-height:44px;min-width:44px;padding:0 10px;border-radius:10px;border:1px solid var(--border);background:var(--bg4);color:var(--fg);font-family:var(--mono);font-size:13px;cursor:pointer;flex:1 1 auto}'
    +'.tut-btn.pri{background:linear-gradient(135deg,var(--cyan),var(--blue));color:var(--bg);border:none;font-weight:700}.tut-btn:disabled{opacity:.4;cursor:default}'
    +'.tut-skip{align-self:center;min-height:40px;min-width:44px;background:none;border:none;color:var(--fg2);font-size:12px;text-decoration:underline;cursor:pointer;flex-shrink:0}'
    +'.tut-mini{display:none;align-items:center;gap:6px;padding:2px 2px 2px 12px;min-height:48px}.tut-mt{flex:1;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tut-mini .tut-btn{flex:0 0 auto}'
    +'.tut-pill{display:none;min-height:44px;padding:0 14px;border:none;border-radius:22px;background:linear-gradient(135deg,var(--cyan),var(--blue));color:var(--bg);font-family:var(--mono);font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap}'
    +'.tut[data-mode="mini"] .tut-hd,.tut[data-mode="mini"] .tut-body,.tut[data-mode="mini"] .tut-btns,.tut[data-mode="mini"] .tut-skip,.tut[data-mode="pill"] .tut-hd,.tut[data-mode="pill"] .tut-body,.tut[data-mode="pill"] .tut-btns,.tut[data-mode="pill"] .tut-skip{display:none}'
    +'.tut[data-mode="mini"] .tut-mini{display:flex}.tut[data-mode="pill"]{background:none;border:none;box-shadow:0 6px 20px rgba(0,0,0,.5);border-radius:22px;padding:0}.tut[data-mode="pill"] .tut-pill{display:block}'
    +'#tutHi{position:fixed;z-index:255;pointer-events:none;box-sizing:border-box;border:3px solid var(--yellow);border-radius:10px;display:none;animation:tutPulse 1.1s ease-in-out infinite}'
    +'@keyframes tutPulse{0%,100%{box-shadow:0 0 0 2px rgba(0,0,0,.55),0 0 6px 2px rgba(253,224,71,.7)}50%{box-shadow:0 0 0 2px rgba(0,0,0,.55),0 0 16px 7px rgba(253,224,71,.35)}}'
    +'@media (prefers-reduced-motion:reduce){#tutHi{animation:none}}'
    +'.tut-wl{display:block;width:100%;margin-top:10px;min-height:48px;border-radius:12px;border:1px solid var(--cyan);background:none;color:var(--cyan);font-family:var(--mono);font-size:14px;font-weight:700;cursor:pointer}.tut-wl2{min-height:40px;margin-top:6px;background:none;border:none;color:var(--fg2);font-family:var(--mono);font-size:12px;text-decoration:underline;cursor:pointer}'
    +'.tut-help{border:1px solid var(--cyan);border-radius:12px;padding:10px 12px;margin:10px 0 14px;background:var(--bg2)}.tut-help button{min-height:44px;margin:6px 6px 0 0;padding:0 14px;border-radius:10px;border:1px solid var(--border);background:var(--bg4);color:var(--fg);font-family:var(--mono);font-size:13px;cursor:pointer}.tut-help button.pri{background:linear-gradient(135deg,var(--cyan),var(--blue));color:var(--bg);border:none;font-weight:700}'
    +'.tut-toast{position:fixed;left:50%;bottom:calc(24px + var(--safe-b));transform:translateX(-50%);z-index:261;max-width:90vw;padding:12px 16px;border-radius:12px;background:var(--bg5);color:var(--fg);font-size:14px;box-shadow:0 6px 20px rgba(0,0,0,.5)}';
  function css(){if(document.getElementById('tut-css'))return;var s=document.createElement('style');s.id='tut-css';s.textContent=CSS;document.head.appendChild(s)}
  function mk(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e}
  function btn(cls,txt,fn,label){var b=mk('button',cls,txt);b.type='button';if(label)b.setAttribute('aria-label',label);b.addEventListener('click',function(e){e.preventDefault();fn()});return b}
  function build(){
    css();
    if(T.el&&T.el.isConnected)return T.el;
    var el=mk('div','tut');el.id='tutCoach';el.setAttribute('role','region');el.setAttribute('aria-label','Tutorial');el.setAttribute('data-mode','full');
    var hd=mk('div','tut-hd'),n=mk('span','tut-n'),t=mk('h2','tut-t');t.id='tutTitle';t.tabIndex=-1;
    hd.append(n,t,btn('tut-ib tut-col','▾',function(){collapse(true)},'Fold the tutorial into a small button'));
    var body=mk('div','tut-body'),live=mk('div','tut-live');live.setAttribute('aria-live','polite');
    var txt=mk('div','tut-txt'),x=mk('div','tut-x'),tap=mk('p','tut-tap'),st=mk('p','tut-st');
    live.append(txt,tap,st);body.append(live,x);
    var bb=mk('div','tut-btns');
    bb.append(btn('tut-btn tut-back','‹ Back',function(){go(T.i-1)},'Back: the previous step'),btn('tut-btn tut-do','Do it for me',function(){doIt()}),btn('tut-btn pri tut-next','Next ›',function(){next()},'Next step'));
    var skip=btn('tut-skip','Skip tutorial',function(){skipTut()});
    var mini=mk('div','tut-mini'),mt=mk('span','tut-mt');
    mini.append(mt,btn('tut-btn tut-mdo','Do it',function(){doIt()},'Do it for me'),btn('tut-btn pri tut-mnext','Next ›',function(){next()},'Next step'),btn('tut-ib tut-exp','▴',function(){T.userExpanded=true;T.collapsed=false;save();render()},'Show the whole step'),btn('tut-ib','▾',function(){collapse(true)},'Fold the tutorial into a small button'));
    var pill=btn('tut-pill','',function(){collapse(false)},'Open the tutorial');
    el.append(hd,body,bb,skip,mini,pill);
    document.body.appendChild(el);
    T.el=el;T.ui={n:n,t:t,txt:txt,x:x,tap:tap,st:st,mt:mt,pill:pill,back:bb.children[0],doB:bb.children[1],next:bb.children[2],mdo:mini.children[1],mnext:mini.children[2],body:body};
    var hi=document.getElementById('tutHi');if(!hi){hi=mk('div');hi.id='tutHi';hi.setAttribute('aria-hidden','true');document.body.appendChild(hi)}T.hi=hi;
    return el;
  }
  function render(){
    if(!T.on)return;
    build();
    var s=STEPS[T.i],u=T.ui,r=T.res||res(T.i),last=T.i===STEPS.length-1;
    u.n.textContent='Step '+(T.i+1)+'/'+STEPS.length;
    if(u.t.textContent!==s.title)u.t.textContent=s.title;
    if(u.txt.getAttribute('data-step')!==s.id){u.txt.innerHTML=s.html;u.txt.setAttribute('data-step',s.id);u.body.scrollTop=0}
    // step 2: the new project button, or the question
    var xk=s.extra==='project'?(T.ask?'ask':'new'):'';
    if(u.x.getAttribute('data-k')!==xk){
      u.x.innerHTML='';u.x.setAttribute('data-k',xk);
      if(xk==='new')u.x.appendChild(btn('tut-btn pri tut-new','Start a new project',function(){newProject(false)}));
      if(xk==='ask'){
        var p=mk('p',null,'Your current program has work in it. Keep a copy first?');p.style.width='100%';p.style.margin='0';
        u.x.append(p,btn('tut-btn pri tut-dl','Download it, then start',function(){try{_download('my-program.emit',text(),'text/plain')}catch(e){}newProject(true)}),btn('tut-btn tut-replace','Replace it',function(){newProject(true)}),btn('tut-btn tut-cancel','Cancel',function(){T.ask=false;render()}));
      }
    }
    var tap=T.tgtSay||'';
    if(u.tap.textContent!==tap)u.tap.textContent=tap;
    u.tap.style.display=tap?'':'none';
    var st=s.ro?'':(r.msg||'');
    if(u.st.textContent!==st)u.st.textContent=st;
    u.st.className='tut-st'+(r.ok&&!s.ro?' ok':'');u.st.style.display=st?'':'none';
    var can=r.ok||!!r.later;
    u.back.disabled=T.i===0;
    u.next.disabled=u.mnext.disabled=!can;
    u.next.textContent=u.mnext.textContent=last?'Finish ✓':'Next ›';
    u.doB.style.display=s.doIt?'':'none';u.doB.disabled=T.busy;
    u.mt.textContent=(T.i+1)+'/'+STEPS.length+' · '+(r.ok&&!s.ro?'✓ ':'')+(tap||s.title);
    u.pill.textContent='Step '+(T.i+1)+'/'+STEPS.length+(r.ok&&!s.ro?' ✓':'');
    u.mnext.style.display=can?'':'none';
    u.mdo.style.display=!can&&s.doIt?'':'none';u.mdo.disabled=T.busy;
    T.ver++;
  }
  // ── the highlight and the panel's place ──
  function rectOf(el){if(!el||!el.isConnected)return null;var r=el.getBoundingClientRect();if(!r.width&&!r.height)return null;return{l:r.left,t:r.top,r:r.right,b:r.bottom}}
  function inter(a,b){if(!a||!b)return null;var l=Math.max(a.l,b.l),t=Math.max(a.t,b.t),r=Math.min(a.r,b.r),bb=Math.min(a.b,b.b);return r>l&&bb>t?{l:l,t:t,r:r,b:bb}:null}
  function area(a){return a?(a.r-a.l)*(a.b-a.t):0}
  function grow(a,d){return a&&{l:a.l-d,t:a.t-d,r:a.r+d,b:a.b+d}}
  function view(){var v=window.visualViewport;return v?{l:v.offsetLeft,t:v.offsetTop,r:v.offsetLeft+v.width,b:v.offsetTop+v.height}:{l:0,t:0,r:window.innerWidth,b:window.innerHeight}}
  function clipsOf(el){var a=[];for(var p=el&&el.parentElement;p&&p!==document.body&&p!==document.documentElement;p=p.parentElement){var c=getComputedStyle(p);if(c.overflowX!=='visible'||c.overflowY!=='visible')a.push(p);if(c.position==='fixed')break}return a}
  // the visible part of the target: the screen and every box that clips it (scrolling sheets, panels)
  function visible(el){
    var r=rectOf(el);if(!r)return null;
    if(T.tgtClip===null||T.tgtSeen!==el){T.tgtClip=clipsOf(el)}
    r=inter(r,view());
    for(var i=0;r&&i<T.tgtClip.length;i++)r=inter(r,rectOf(T.tgtClip[i]));
    if(r){var c=getComputedStyle(el);if(c.visibility==='hidden')r=null}
    return r;
  }
  function setTarget(t){
    var el=t&&t.el||null;T.tgtSay=t&&t.say||'';
    if(el!==T.tgt){
      T.tgt=el;T.tgtClip=null;T.tgtSeen=null;
      if(el){T.tgtClip=clipsOf(el);T.tgtSeen=el;var vr=visible(el),fr=rectOf(el);if((!vr||area(vr)<area(fr)*0.9)&&!(T.el&&T.el.contains(el))){try{el.scrollIntoView({block:'nearest',inline:'nearest'})}catch(e){}}}
    }
  }
  function placeHi(){
    var hi=T.hi;if(!hi)return null;
    var r=T.tgt&&T.el&&T.el.getAttribute('data-mode')!=='full'&&T.el.contains(T.tgt)?null:visible(T.tgt);
    if(!r){if(hi.style.display!=='none')hi.style.display='none';return null}
    var v=view(),g={l:Math.max(v.l,r.l-5),t:Math.max(v.t,r.t-5),r:Math.min(v.r,r.r+5),b:Math.min(v.b,r.b+5)};
    hi.style.display='block';hi.style.left=g.l+'px';hi.style.top=g.t+'px';hi.style.width=(g.r-g.l)+'px';hi.style.height=(g.b-g.t)+'px';
    return r;
  }
  // what the panel must not cover: the element to tap, the drawer's header and Save bar, what the step shows
  function mustRects(tr){
    var m=[];
    if(tr&&!(T.el&&T.el.contains(T.tgt)))m.push(grow(tr,8));
    if(drawerOpen()){var f=rectOf(document.getElementById('drawerFoot'));if(f&&f.b-f.t>1)m.push(f);var h=rectOf(q('#drawer .drw-hd'));if(h)m.push(h)}
    var s=STEPS[T.i];if(s&&s.keep){try{s.keep().forEach(function(e){var r=rectOf(e);if(r)m.push(inter(r,view())||r)})}catch(e){}}
    var a=document.activeElement;if(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)&&!(T.el&&T.el.contains(a))&&a.id!=='editor'){var ar=rectOf(a);if(ar)m.push(grow(ar,4))}
    return m.filter(Boolean);
  }
  function keyboardUp(){var v=window.visualViewport;return!!(v&&v.height<window.innerHeight*0.72)}
  function candidates(){
    var v=view(),ph=phone(),out=[],dr=drawerOpen();
    var top=v.t,bot=v.b;
    if(dr&&ph){var hd=rectOf(q('#drawer .drw-hd')),ft=rectOf(document.getElementById('drawerFoot'));if(hd)top=Math.max(top,hd.b);if(ft&&ft.b-ft.t>1)bot=Math.min(bot,ft.t)}
    var modes=T.collapsed?['pill']:(ph&&(dr||keyboardUp())&&!T.userExpanded)?['mini','pill']:['full','mini','pill'];
    modes.forEach(function(mode){
      if(mode!=='pill'&&ph){out.push({mode:mode,pos:'bot',x:v.l,w:v.r-v.l,y:function(h){return bot-h}},{mode:mode,pos:'top',x:v.l,w:v.r-v.l,y:function(){return top}})}
      else if(mode!=='pill'){
        var w=Math.min(mode==='mini'?400:360,v.r-v.l-24),m=12;
        [['br','r','b'],['bl','l','b'],['tr','r','t'],['tl','l','t'],['mr','r','m'],['ml','l','m']].forEach(function(c){
          out.push({mode:mode,pos:c[0],w:w,x:c[1]==='r'?v.r-w-m:v.l+m,y:function(h){return c[2]==='b'?bot-h-m:c[2]==='t'?top+m+(dr?0:44):top+((bot-top)-h)/2}});
        });
      }else{
        [['br','r','b'],['bl','l','b'],['tr','r','t'],['tl','l','t'],['mr','r','m'],['ml','l','m']].forEach(function(c){
          out.push({mode:'pill',pos:c[0],w:0,x:c[1],y:c[2]});
        });
      }
    });
    return{list:out,top:top,bot:bot,v:v};
  }
  function place(tr){
    var el=T.el,C=candidates(),must=mustRects(tr),best=null,sizes={},m=8;
    function measure(mode,w){
      var k=mode+':'+w;if(sizes[k])return sizes[k];
      el.setAttribute('data-mode',mode);el.style.width=w?w+'px':'auto';el.style.maxHeight=mode==='full'?Math.round((C.bot-C.top)*(phone()?0.55:0.8))+'px':'';
      var b=el.getBoundingClientRect();return sizes[k]={w:b.width,h:b.height};
    }
    // soft: better not covered (the IDE's header buttons), decides between places of the same mode
    var soft=[];if(!drawerOpen()){var hr=rectOf(q('.header'));if(hr)soft.push(hr)}
    var pick=null;
    for(var i=0;i<C.list.length;i++){
      var c=C.list[i],sz=measure(c.mode,c.w),x,y;
      if(pick&&pick.c.mode!==c.mode)break;
      if(c.mode==='pill'){x=c.x==='r'?C.v.r-sz.w-m:C.v.l+m;y=c.y==='b'?C.bot-sz.h-m:c.y==='t'?C.top+m:C.top+((C.bot-C.top)-sz.h)/2}
      else{x=c.x;y=c.y(sz.h)}
      y=Math.max(C.top,Math.min(y,C.bot-sz.h));
      var r={l:x,t:y,r:x+sz.w,b:y+sz.h},cover=0,sc=0;
      must.forEach(function(a){cover+=area(inter(a,r))});
      soft.forEach(function(a){sc+=area(inter(a,r))});
      var cand={c:c,x:x,y:y,cover:cover,soft:sc,w:c.w};
      if(!best||cover<best.cover)best=cand;
      if(!cover&&(!pick||sc<pick.soft))pick=cand;
      if(pick&&!pick.soft)break;
    }
    if(pick)best=pick;
    if(!best)return;
    el.setAttribute('data-mode',best.c.mode);
    el.style.width=best.w?best.w+'px':'auto';
    el.style.maxHeight=best.c.mode==='full'?Math.round((C.bot-C.top)*(phone()?0.55:0.8))+'px':'';
    el.style.left=best.x+'px';el.style.top=best.y+'px';
    el.classList.toggle('tut-ph',phone()&&best.c.mode!=='pill');
    el.classList.toggle('tut-bot',best.c.pos==='bot');el.classList.toggle('tut-top',best.c.pos==='top');
    el.setAttribute('data-pos',best.c.pos);
  }
  function frame(){
    T.raf=0;if(!T.on||!T.el)return;
    var tr=placeHi();
    var v=view(),sig=[T.ver,T.collapsed,T.userExpanded,drawerOpen(),keyboardUp(),Math.round(v.l),Math.round(v.t),Math.round(v.r),Math.round(v.b),window.innerWidth,window.innerHeight].join(',');
    mustRects(tr).forEach(function(a){sig+='|'+Math.round(a.l)+','+Math.round(a.t)+','+Math.round(a.r)+','+Math.round(a.b)});
    if(sig!==T.sig){T.sig=sig;place(tr);placeHi()}
    T.raf=requestAnimationFrame(frame);
  }
  // every 300 ms (and right after a tap): the step's check and what to tap now
  function tick(){
    if(!T.on)return;
    var s=STEPS[T.i],r=res(T.i),t=null;
    try{t=s.target?s.target():null}catch(e){t=null}
    if(r.ok&&!s.ro&&s.id!=='run'&&s.id!=='inside'){t={el:null,say:T.i===STEPS.length-1?'Tap Finish.':'Done — tap Next.'}}
    var key=JSON.stringify([r.ok,!!r.later,r.msg,t&&t.say]);
    T.res=r;setTarget(t);
    if(key!==T.lastKey||T.tgt!==T.lastTgt){T.lastKey=key;T.lastTgt=T.tgt;render()}
  }
  function soon(){setTimeout(tick,60);setTimeout(tick,400)}
  // ── moving through the steps ──
  function go(i){
    i=Math.max(0,Math.min(STEPS.length-1,i|0));
    T.i=i;T.ask=false;T.userExpanded=false;T.stepAt=Date.now();T.res=null;T.shown=null;
    if(STEPS[i].id==='rewind')T.tl={scrubbed:false,resumed:false};
    if(STEPS[i].id==='inside'){var h=things().hero;if(T.speed0===null||T.speed0===undefined)T.speed0=h?h.speed:null}
    else if(i<stepIx('things'))T.speed0=null;
    save();tick();render();
    try{if(!phone()&&T.el&&T.el.getAttribute('data-mode')==='full')T.ui.t.focus({preventScroll:true})}catch(e){}
  }
  function next(){
    var r=res(T.i);if(!(r.ok||r.later||STEPS[T.i].ro))return;
    if(T.i===STEPS.length-1){finish();return}
    go(T.i+1);
  }
  // "Do it for me": first the earlier steps this one needs (when their checks fail), then this step
  function doIt(){
    if(T.busy)return;
    var s=STEPS[T.i];if(!s.doIt)return;
    var seen={},chain=[];
    (function need(st){(st.deps||[]).forEach(function(d){var j=stepIx(d);if(j<0||seen[d])return;seen[d]=1;need(STEPS[j]);if(!res(j).ok)chain.push(STEPS[j])})})(s);
    chain.push(s);
    T.busy=true;render();
    var k=0;
    function step(){
      if(k>=chain.length){T.busy=false;tick();render();return}
      var c=chain[k++],p=null;
      try{p=c.doIt()}catch(e){try{console.warn('tutorial: '+c.id+': '+(e&&e.message||e))}catch(x){}}
      if(p&&typeof p.then==='function')p.then(step,step);else step();
    }
    step();
  }
  function collapse(on){T.collapsed=!!on;if(!on)T.userExpanded=true;save();render();try{(on?T.ui.pill:T.ui.t).focus({preventScroll:true})}catch(e){}}
  function stopUi(){
    T.on=false;if(T.raf)cancelAnimationFrame(T.raf);T.raf=0;if(T.iv)clearInterval(T.iv);T.iv=0;
    if(T.el&&T.el.parentNode)T.el.parentNode.removeChild(T.el);T.el=null;
    if(T.hi)T.hi.style.display='none';T.tgt=null;
  }
  function toast(msg){var t=mk('div','tut-toast',msg);t.setAttribute('role','status');document.body.appendChild(t);setTimeout(function(){if(t.parentNode)t.parentNode.removeChild(t)},4000)}
  function skipTut(){stopUi();save();toast('Tutorial paused at step '+(T.i+1)+' — resume it from Help or 🧰 → Tutorial.');updEntries()}
  function finish(){stopUi();T.i=0;sput({v:1,i:0,active:false,done:true});toast('🎉 You made a game! Help (?) has the rest; the tutorial is in 🧰 any time.');updEntries()}
  function begin(i,collapsed){
    css();T.on=true;T.collapsed=!!collapsed;build();
    try{hideAC()}catch(e){}
    if(!T.iv)T.iv=setInterval(tick,300);
    go(i);
    if(!T.raf)T.raf=requestAnimationFrame(frame);
    updEntries();
  }
  function progress(){var p=sget();return p&&p.v===1&&!p.done&&p.i>0&&p.i<STEPS.length?p:null}
  window._tutStart=function(){
    try{var w=document.getElementById('welcomeOverlay');if(w&&w.classList.contains('show'))closeWelcome()}catch(e){}
    try{var h=document.getElementById('helpOverlay');if(h&&h.classList.contains('show'))toggleHelp()}catch(e){}
    var p=progress();if(p){T.speed0=p.speed0===undefined?null:p.speed0}
    begin(p?p.i:0,false);
  };
  window._tutRestart=function(){
    try{var w=document.getElementById('welcomeOverlay');if(w&&w.classList.contains('show'))closeWelcome()}catch(e){}
    try{var h=document.getElementById('helpOverlay');if(h&&h.classList.contains('show'))toggleHelp()}catch(e){}
    T.speed0=null;begin(0,false);
  };
  // for tests and scripts
  window._tut={state:T,steps:STEPS,check:function(i){return res(i===undefined?T.i:i)},go:go,next:next,doIt:doIt,skip:skipTut,collapse:collapse,tick:tick,
    target:function(){return T.tgt},running:function(){return T.on},start:window._tutStart,restart:window._tutRestart,START:START,HERO:HERO,COIN:COIN,rulesCheck:rulesCheck};
  // ── the real state the checks cannot read from the text: the last Run and the Timeline ──
  compileAndRun=(function(f){return function(){try{T.lastRun=_projText()}catch(e){}var r=f.apply(this,arguments);if(T.on)soon();return r}})(compileAndRun);
  _tlShow=(function(f){return function(k){var r=f.apply(this,arguments);try{if(T.on&&STEPS[T.i].id==='rewind'&&_tl.frames.length>3&&_tl.pos<=_tl.frames.length-3)T.tl.scrubbed=true}catch(e){}return r}})(_tlShow);
  _tlResume=(function(f){return function(){var was=false;try{was=_tl.paused}catch(e){}var r=f.apply(this,arguments);try{if(T.on&&was&&T.tl.scrubbed&&!_tl.paused)T.tl.resumed=true}catch(e){}return r}})(_tlResume);
  // ── keys and taps ──
  window.addEventListener('keydown',function(e){
    if(!T.on||e.key!=='Escape'||!T.el)return;
    var inCoach=T.el.contains(document.activeElement),help=document.getElementById('helpOverlay');
    if(!inCoach&&(drawerOpen()||(help&&help.classList.contains('show'))))return;
    if(T.el.getAttribute('data-mode')==='pill')return;
    e.preventDefault();e.stopPropagation();collapse(true);
  },true);
  document.addEventListener('click',function(){if(T.on)soon()},true);
  document.addEventListener('change',function(){if(T.on)soon()},true);
  window.addEventListener('resize',function(){if(T.on){T.sig='';soon()}});
  // ── entry points: the welcome overlay, the drawer, Help ──
  function updEntries(){
    var p=progress(),lab=p?'🎓 Resume the tutorial (step '+(p.i+1)+'/'+STEPS.length+')':'🎓 Start the tutorial: make a game (10 min)';
    var w=document.getElementById('tutWelcome');if(w)w.textContent=lab;
    var r=document.getElementById('tutWelcomeRe');if(r)r.style.display=p?'':'none';
    var h=document.getElementById('tutHelpGo');if(h)h.textContent=p?'Resume (step '+(p.i+1)+'/'+STEPS.length+')':'Start the tutorial';
  }
  try{
    css();
    var box=q('#welcomeOverlay .welcome-box'),goB=q('#welcomeOverlay .wl-go');
    if(box&&!document.getElementById('tutWelcome')){
      var wb=btn('tut-wl','',function(){window._tutStart()});wb.id='tutWelcome';
      var wr=btn('tut-wl2','or restart the tutorial from step 1',function(){window._tutRestart()});wr.id='tutWelcomeRe';
      if(goB&&goB.nextSibling)box.insertBefore(wr,goB.nextSibling);else box.appendChild(wr);
      box.insertBefore(wb,wr);
    }
    var hc=q('#helpOverlay .help-content');
    if(hc&&!document.getElementById('tutHelp')){
      var d=mk('div','tut-help');d.id='tutHelp';
      d.appendChild(mk('div',null,'🎓 New here? The tutorial makes a tiny game with the 🧰 drawer, step by step (about 10 minutes).'));
      var b1=btn('pri','',function(){window._tutStart()});b1.id='tutHelpGo';
      d.append(b1,btn('','Restart',function(){window._tutRestart()}),btn('','About the tutorial ↓',function(){var x=document.getElementById('help-tutorial');if(x)x.scrollIntoView({block:'start'})}));
      var after=hc.querySelector('h1');after=after&&after.nextElementSibling?after.nextElementSibling:null;
      hc.insertBefore(d,after?after.nextSibling:hc.firstChild);
      var h2=mk('h2',null,'Tutorial');h2.id='help-tutorial';
      var p1=mk('p');p1.innerHTML='Start it from the welcome screen, <b>🧰 → Tutorial</b>, or the button at the top of this help. In twelve steps you paint a hero and a coin (Sprite), make a sound (Sound), a level (Stage), on-screen controls (Controls), the things and rules (Logic), run the game, rewind it with the Timeline and edit it by hand. A small coach panel &mdash; a sheet at the bottom of a phone, a card on a desktop &mdash; explains each step and outlines what to tap; it moves out of the way of the tool&rsquo;s Save button and of what it points to. <b>Next</b> unlocks when the step is really done (the tutorial reads the program, not your taps). <b>Do it for me</b> performs the step, so nobody gets stuck. &#9662; or Escape folds the panel into a small &ldquo;Step 3/12&rdquo; button; tap it to open the step again.';
      var p2=mk('p');p2.innerHTML='<b>Resume / restart.</b> The step you are on is remembered in this browser: start the tutorial again to resume, or choose <b>Restart</b> to begin at step 1 (your program is only replaced at step 2, and if it has work in it you can download it first or cancel). Where the browser keeps no storage (a page opened from <code>content://</code>, private modes) the tutorial simply starts from the beginning. <b>Skip tutorial</b> stops it; it can be resumed later.';
      var nx=d.nextSibling;hc.insertBefore(h2,nx);hc.insertBefore(p1,nx);hc.insertBefore(p2,nx);
    }
    updEntries();
  }catch(e){}
  _drawerRegister({id:'tutorial',label:'Tutorial',icon:'🎓',desc:'Make a tiny coin-collecting game with these tools, step by step (about 10 minutes)',
    go:function(){window._tutStart()},open:function(ctx){ctx.close();window._tutStart()}});
  // a tutorial that was running when the page was left comes back (on the step it was on)
  function resumeOnLoad(){
    var p=sget();if(!p||p.v!==1||!p.active||p.done||T.on)return;
    if(!(p.i>=0&&p.i<STEPS.length))return;
    T.speed0=p.speed0===undefined?null:p.speed0;
    try{var w=document.getElementById('welcomeOverlay');if(w&&w.classList.contains('show'))closeWelcome()}catch(e){}
    begin(p.i,!!p.collapsed);
  }
  if(document.readyState==='complete')setTimeout(resumeOnLoad,0);else window.addEventListener('load',function(){setTimeout(resumeOnLoad,0)});
})();

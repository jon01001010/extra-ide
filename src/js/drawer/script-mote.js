// ═══ MOTE in the editor: script blocks highlighted as Mote, the SCRIPT tool of the drawer, the example ═══
// (the compiler half is "MOTE SCRIPTS", the runtime half "MOTE (runtime half)").
_DRAWER_FILES.script=_DRAWER_MOTE_FILE;
_MOTE_FNS.forEach(function(n){try{_emitBlt.add(n)}catch(e){}});
var _MOTE_KW={'and':1,'break':1,'do':1,'else':1,'elseif':1,'end':1,'false':1,'for':1,'function':1,'goto':1,'if':1,'in':1,'local':1,'nil':1,'not':1,'or':1,'repeat':1,'return':1,'then':1,'true':1,'until':1,'while':1};
var _MOTE_BLT={'print':1,'type':1,'tostring':1,'tonumber':1,'pairs':1,'ipairs':1,'next':1,'select':1,'error':1,'assert':1,'pcall':1,'xpcall':1,'unpack':1,'setmetatable':1,'getmetatable':1,'rawget':1,'rawset':1,'rawequal':1,'rawlen':1,'load':1,'string':1,'table':1,'math':1,'coroutine':1,'wait':1,'waitFrames':1,'choose':1,'self':1,'_G':1};
// Mote source → one HTML string per line (every span closed on its line: long strings and comments are split)
function _moteHlLines(src){
  var s=String(src),out=[''],i=0,n=s.length;
  function put(cls,text){
    var parts=text.split('\n');
    parts.forEach(function(p,k){if(k)out.push('');if(p)out[out.length-1]+=cls?'<span class="'+cls+'">'+escH(p)+'</span>':escH(p)});
  }
  function longEnd(at){var m=/^\[(=*)\[/.exec(s.substr(at,64));if(!m)return -1;var close=']'+m[1]+']',e=s.indexOf(close,at+m[0].length);return e<0?n:e+close.length}
  while(i<n){
    var c=s[i];
    if(c==='-'&&s[i+1]==='-'){
      var le=s[i+2]==='['?longEnd(i+2):-1;
      var e=le>=0?le:(s.indexOf('\n',i)<0?n:s.indexOf('\n',i));
      put('cmt',s.substring(i,e));i=e;continue;
    }
    if(c==='['&&(s[i+1]==='['||s[i+1]==='=')){var L=longEnd(i);if(L>=0){put('str',s.substring(i,L));i=L;continue}}
    if(c==='"'||c==="'"){
      var j=i+1;while(j<n&&s[j]!==c&&s[j]!=='\n'){if(s[j]==='\\')j++;j++}
      if(j<n&&s[j]===c)j++;
      put('str',s.substring(i,j));i=j;continue;
    }
    if(/[0-9]/.test(c)||(c==='.'&&/[0-9]/.test(s[i+1]||''))){var m=/^(0[xX][0-9a-fA-F.]+([pP][+-]?\d+)?|\d*\.?\d+([eE][+-]?\d+)?)/.exec(s.substr(i,40));var t=m?m[0]:c;put('num',t);i+=t.length;continue}
    if(/[A-Za-z_]/.test(c)){var w=/^[A-Za-z_]\w*/.exec(s.substr(i,80))[0];put(_MOTE_KW[w]?'kw':_MOTE_BLT[w]||_MOTE_FNS.indexOf(w)>=0?'blt':null,w);i+=w.length;continue}
    if(c==='\n'){out.push('');i++;continue}
    var op=/^(\.\.\.|\.\.|==|~=|<=|>=|\/\/|::|[-+*\/%^#<>=(){}\[\];:,.])/.exec(s.substr(i,3));
    if(op){put(/[(){}\[\];:,.]/.test(op[0])&&op[0].length===1?'dl':'op',op[0]);i+=op[0].length;continue}
    put(null,c);i++;
  }
  return out;
}
// The main editor: Mote colours for script blocks. The Emit highlighter reads a copy of the text in which the
// script bodies are blanked (a quote in a Mote comment must not start an Emit string that runs on), then the
// script lines are replaced.
hlCode=(function(hl){return function(){
  var src;try{src=ed.value}catch(e){return hl.apply(this,arguments)}
  var bl=_moteFindBlocks(src);
  if(!bl.length)return hl.apply(this,arguments);
  var lines=src.split('\n');
  bl.forEach(function(b){for(var i=b.start+1;i<=b.end;i++)lines[i]=lines[i].replace(/[^\r]/g,' ')});
  var masked=lines.join('\n'),r;
  try{Object.defineProperty(ed,'value',{configurable:true,get:function(){return masked},set:function(v){delete ed.value;ed.value=v}})}catch(e){return hl.apply(this,arguments)}
  try{r=hl.apply(this,arguments)}finally{try{delete ed.value}catch(e){}}
  try{
    var out=hlInner.innerHTML.split('\n'),real=src.split('\n');
    if(out.length<real.length)return r;
    bl.forEach(function(b){
      var hm=/^script([ \t]+)([A-Za-z_]\w*)([ \t]*:)(.*)$/i.exec(real[b.start].replace(/\r$/,''));
      if(hm)out[b.start]='<span class="kw">'+real[b.start].substr(0,6)+'</span>'+hm[1]+'<span class="ty">'+hm[2]+'</span>'+escH(hm[3].slice(0,-1))+'<span class="dl">:</span>'+_moteHlLines(hm[4]).join('');
      var body=real.slice(b.start+1,b.end+1).map(function(l){return l.replace(/\r$/,'')}),ind=Infinity;
      body.forEach(function(l){if(/\S/.test(l)){var k=l.length-l.replace(/^[ \t]+/,'').length;if(k<ind)ind=k}});
      if(ind===Infinity)ind=0;
      var h=_moteHlLines(body.map(function(l){return l.substring(ind)}).join('\n'));
      body.forEach(function(l,k){out[b.start+1+k]=escH(l.substring(0,Math.min(ind,l.length)))+(h[k]||'')});
    });
    hlInner.innerHTML=out.join('\n');
  }catch(e){}
  return r;
}})(hlCode);

// ── the SCRIPT tool ── lists the script blocks of the project, edits one in a Mote editor, runs it in a sandbox
// (its own copy of Mote: print → the output pane; wait / waitFrames are skipped and choose(…) takes option 1, each
// logged; functions the program would provide — say, give … — are stand-ins that log their calls), and saves it
// with ctx.write('script', name, text, 'scripts.emit'). A script that was not edited is written back unchanged.
function _moteToolRead(b){
  var lines=b.text.split('\n'),d=_moteParseBlock(lines,b.startLine);
  var pre='  ',body=lines.slice(1);
  for(var i=0;i<body.length;i++)if(/\S/.test(body[i])){var w=body[i].match(/^[ \t]*/)[0];if(w.length===d.indent){pre=w;break}}
  return{name:b.name,origName:b.name,path:b.path,startLine:b.startLine,text:b.text,src:d.source,orig:d.source,head:lines[0],indent:pre,dirty:false};
}
// The block text for an item: the original text when nothing changed; else the header and the source indented
function _moteToolText(it){
  if(it.origName===it.name&&it.src===it.orig&&it.text!=null)return it.text;
  var head=it.origName===it.name&&it.head?it.head:'script '+it.name+':';
  var body=it.src.replace(/\r\n?/g,'\n').replace(/\s+$/,'').split('\n').map(function(l){return/\S/.test(l)?it.indent+l:''});
  if(!body.some(function(l){return l}))body=[it.indent+'-- (empty)'];
  return head+'\n'+body.join('\n');
}
// Runs Mote source in the tool's sandbox (the compiler's own copy of Mote, a fresh VM each time).
// opts.standIns: a global the script reads but nobody set is a stand-in — callable (the call is logged, the result
// is a stand-in too) and printable as ‹name› — so a script that calls the program's functions (say, give …) runs here too.
// → {lines:[{k:'pr'|'log'|'ok', t}], steps, budget, error:{line (of the script), col, msg, kind}|null}
function _moteToolRun(src,name,budget,opts){
  opts=opts||{};
  var M=_moteCompiler(),res={lines:[],steps:0,error:null,budget:budget};
  function add(k,t){if(res.lines.length<400)res.lines.push({k:k,t:String(t)});else if(res.lines.length===400)res.lines.push({k:'log',t:'… more output not shown'})}
  function show(v){return typeof v==='string'?JSON.stringify(v):v===undefined||v===null?'nil':typeof v==='object'?JSON.stringify(v):String(v)}
  if(!M){res.error={line:0,msg:'Mote is not available in this page',kind:'error'};return res}
  var vm=M.create({print:function(s){add('pr',s)},stdlib:['base','string','table','math','coroutine'],maxSteps:budget,maxMemory:16e6,seed:1,caseInsensitive:true});
  vm.set('wait',function(s){return vm.yield('wait',s)});
  vm.set('waitFrames',function(f){return vm.yield('frames',f)});
  vm.set('choose',function(){return vm.yield.apply(vm,['choose'].concat([].slice.call(arguments)))});
  var total=0,next=[],calls=0;
  function fail(e){
    var msg=String((e&&e.message)||e),m=/^([A-Za-z_][\w.]*):(\d+):(?:(\d+):)?\s*/.exec(msg);
    res.error={line:m?+m[2]:0,col:m&&m[3]?+m[3]:0,msg:m?msg.substring(m[0].length):msg,kind:(e&&e.kind)||'error'};
  }
  try{
    if(opts.standIns!==false){
      vm.set('__standin',function(n){if(++calls<=200)add('log','→ '+n+'('+[].slice.call(arguments,2).map(show).join(', ')+')  — stand-in');});
      vm.run('local log = __standin  __standin = nil\nsetmetatable(_G, {__index = function(t, k)\n  return setmetatable({}, {__call = function(...) log(k, ...) return _G[k .. "()"] end, __tostring = function() return "‹" .. k .. "›" end,\n    __concat = function(a, b) return tostring(a) .. tostring(b) end, __name = "stand-in"})\nend})','standins');
    }
    var th=vm.thread(vm.compile(src,name)),pauses=0;
    for(;;){
      var r=th.resume.apply(th,next);next=[];
      total+=vm.stats().steps;
      if(r.done){if(r.values&&r.values.length&&r.values[0]!==undefined)add('ok','returned '+r.values.map(show).join(', '));break}
      var v=r.values||[];
      if(v[0]==='wait')add('log','⏸ wait('+show(v[1])+') — skipped here; in the program the script waits '+show(v[1])+' s');
      else if(v[0]==='frames')add('log','⏸ waitFrames('+show(v[1])+') — skipped here');
      else if(v[0]==='choose'){add('log','? choose('+v.slice(1).map(show).join(', ')+') → 1 here (the first option)');next=[1]}
      else add('log','⏸ coroutine.yield('+v.map(show).join(', ')+')');
      if(++pauses>=10000){add('log','… stopped after 10000 pauses');break}
    }
  }catch(e){total+=vm.stats().steps;fail(e)}
  res.steps=total;
  return res;
}
function _moteTool(ctx){
  var list=ctx.blocks('script').map(_moteToolRead),cur=0,ui={},budget=1e6,lastRun=null;
  var STARTER='-- A Mote script (Lua-like). Run it from your program:\n--   let vm = moteVM()\n--   moteRun(vm, NAME)\nlocal msg = "hello from NAME"\nprint(msg)\nreturn #msg';
  function fresh(n){return{name:n,origName:null,path:null,text:null,src:STARTER.replace(/NAME/g,n),orig:null,head:null,indent:'  ',dirty:true}}
  if(!list.length){var f=fresh('intro');f.dirty=false;f.fresh=true;list.push(f)}
  function S(){return list[cur]}
  function names(except){return list.filter(function(x,i){return i!==except}).map(function(x){return x.name})}
  function dirty(){var any=false;list.forEach(function(it){if(it.dirty)any=true});ctx.setDirty(any)}
  function paintChips(){ui.chips.querySelectorAll('.drw-chip').forEach(function(c,i){if(list[i])c.classList.toggle('dirty',!!list[i].dirty)})}
  function errLine(){return lastRun&&lastRun.error&&lastRun.error.line?lastRun.error.line:0}
  function paint(){
    var h=_moteHlLines(ui.ta.value),el=errLine();
    ui.hl.innerHTML=h.map(function(l,i){return'<span class="mte-l'+(i+1===el?' mte-err':'')+'">'+(l||' ')+'</span>'}).join('\n')+'\n';
    ui.gut.textContent=h.map(function(_,i){return String(i+1)}).join('\n');
    sync();
  }
  function sync(){ui.hl.style.transform='translate('+(-ui.ta.scrollLeft)+'px,'+(-ui.ta.scrollTop)+'px)';ui.gut.style.transform='translateY('+(-ui.ta.scrollTop)+'px)'}
  function where(it,l){var fl=it.startLine?it.startLine+l:0;return'line '+l+' of the script'+(fl?' ('+(it.path||'')+(it.path?':':'line ')+fl+')':'')}
  function showRun(res,label){
    var it=S(),o=ui.out;o.innerHTML='';
    res.lines.forEach(function(x){o.appendChild(_drwEl('div',{cls:'mte-o mte-'+x.k,text:x.t}))});
    if(res.error)o.appendChild(_drwEl('div',{cls:'mte-o mte-errl',text:'✗ '+(res.error.line?where(it,res.error.line)+': ':'')+res.error.msg}));
    else if(label)o.appendChild(_drwEl('div',{cls:'mte-o mte-ok',text:label}));
    ui.steps.textContent='steps '+res.steps.toLocaleString('en-US')+' / '+res.budget.toLocaleString('en-US')+(res.error&&res.error.kind==='limit'?' — budget used up':'');
    ui.steps.classList.toggle('mte-over',!!(res.error&&res.error.kind==='limit'));
  }
  function run(){
    var it=S();
    lastRun=_moteToolRun(it.src,it.name,budget,{standIns:ui.stand.checked});
    showRun(lastRun,'✓ finished');paint();
    return lastRun;
  }
  function check(){
    var it=S(),d=_moteParseBlock(['script '+it.name+':'].concat(it.src.split('\n').map(function(l){return'  '+l})),0);
    lastRun={lines:[],steps:0,budget:budget,error:d.errors.length?{line:d.errors[0].line,msg:d.errors[0].msg.replace(/^Mote syntax error in script \w+: /,'syntax error: '),kind:'syntax'}:null};
    showRun(lastRun,'✓ the syntax is fine');paint();
    return lastRun;
  }
  function build(){
    var b=ctx.body,it=S();b.innerHTML='';lastRun=null;
    ui.chips=_drwChips(list,cur,function(i){cur=i;build()},function(){
      var n=_drwFreeName('script',names(-1));list.push(fresh(n));cur=list.length-1;dirty();build();
    },'+ New script');
    b.appendChild(ui.chips);
    var nameIn=_drwEl('input',{type:'text',cls:'drw-name',value:it.name,'aria-label':'Script name',autocomplete:'off',autocapitalize:'none',spellcheck:'false'});
    nameIn.addEventListener('change',function(){
      var n=nameIn.value.trim();
      if(!_drwNameOk(n)){ctx.toast('A name is letters, digits and _ (not starting with a digit)');nameIn.value=it.name;return}
      if(names(cur).indexOf(n)>=0){ctx.toast('There is already a script called '+n);nameIn.value=it.name;return}
      if(n!==it.name){it.name=n;it.dirty=true;dirty();ui.chips.children[cur].textContent=n;paintChips();ui.use.textContent=useText()}
    });
    b.appendChild(_drwEl('div',{cls:'drw-row'},[_drwEl('label',{cls:'drw-lab',text:'Name'}),nameIn,_drwEl('span',{cls:'drw-dim',text:it.path?it.path+(it.startLine?' line '+it.startLine:''):'new: goes into '+_DRAWER_MOTE_FILE})]));
    ui.ta=_drwEl('textarea',{cls:'mte-ta',spellcheck:'false',autocapitalize:'none',autocomplete:'off','aria-label':'Mote source of the script',wrap:'off'});
    ui.ta.value=it.src;
    ui.hl=_drwEl('pre',{cls:'mte-hl','aria-hidden':'true'});
    ui.gut=_drwEl('pre',{cls:'mte-gut','aria-hidden':'true'});
    ui.ta.addEventListener('input',function(){it.src=ui.ta.value;if(!it.dirty){it.dirty=true;dirty();paintChips()}lastRun=null;paint()});
    ui.ta.addEventListener('scroll',sync);
    ui.ta.addEventListener('keydown',function(e){if(e.key==='Tab'&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey){e.preventDefault();var s=ui.ta.selectionStart,t=ui.ta.selectionEnd,v=ui.ta.value;ui.ta.value=v.substring(0,s)+'  '+v.substring(t);ui.ta.selectionStart=ui.ta.selectionEnd=s+2;ui.ta.dispatchEvent(new Event('input'))}});
    b.appendChild(_drwEl('div',{cls:'mte'},[_drwEl('div',{cls:'mte-gw'},[ui.gut]),_drwEl('div',{cls:'mte-cw'},[ui.hl,ui.ta])]));
    ui.stand=_drwEl('input',{type:'checkbox',id:'mteStand'});ui.stand.checked=true;
    var bud=_drwEl('input',{type:'text',inputmode:'numeric',cls:'drw-num mte-bud','aria-label':'Step budget',value:String(budget)});
    bud.addEventListener('change',function(){var v=Math.floor(+bud.value.replace(/[^0-9e.]/gi,''));if(v>0&&isFinite(v))budget=Math.min(v,1e8);bud.value=String(budget)});
    b.appendChild(_drwEl('div',{cls:'drw-wrap'},[_drwBtn('▶ Run',run,'drw-pri mte-run','Run the script here, in a sandbox'),_drwBtn('✓ Check',check,'mte-check','Check the syntax'),_drwEl('label',{cls:'drw-dim','for':'mteStand'},[ui.stand,' stand-ins for the program\'s functions'])]));
    ui.steps=_drwEl('span',{cls:'mte-steps',text:'steps — / '+budget.toLocaleString('en-US')});
    b.appendChild(_drwEl('div',{cls:'drw-row'},[_drwEl('span',{cls:'drw-lab',text:'Step budget'}),bud,ui.steps]));
    ui.out=_drwEl('div',{cls:'mte-out','aria-live':'polite'},[_drwEl('div',{cls:'mte-o mte-log',text:'Run shows print() output here. wait / waitFrames are skipped and choose(…) takes the first option; the functions your program provides (moteFn) are stand-ins that only log their calls.'})]);
    b.appendChild(_drwEl('div',{cls:'drw-lab',text:'Output'}));b.appendChild(ui.out);
    function useText(){return'In the program: let vm = moteVM()  ·  moteRun(vm, '+S().name+')  ·  let th = moteThread(vm, '+S().name+') with moteResume(th) in frame()'}
    ui.use=_drwEl('p',{cls:'drw-dim',text:useText()});b.appendChild(ui.use);
    paint();
  }
  function save(){
    var done=[];
    list.forEach(function(it){
      if(!it.dirty)return;
      var text=_moteToolText(it),r=ctx.write('script',it.origName||it.name,text,_DRAWER_MOTE_FILE);
      var nb=ctx.blocks('script').filter(function(x){return x.name===it.name})[0];
      if(nb){var fr=_moteToolRead(nb);it.text=fr.text;it.orig=fr.src;it.src=fr.src;it.head=fr.head;it.indent=fr.indent;it.path=fr.path;it.startLine=fr.startLine}
      it.origName=it.name;it.dirty=false;it.fresh=false;
      done.push(it.name);
    });
    dirty();build();
    ctx.toast(done.length?'Saved '+done.join(', '):'Nothing to save');
  }
  function del(){
    var it=S();
    if(!window.confirm('Delete the script '+it.name+(it.origName?' from the program':'')+'?'))return;
    if(it.origName)ctx.remove('script',it.origName);
    list.splice(cur,1);
    if(!list.length){var f=fresh('intro');f.dirty=false;f.fresh=true;list.push(f)}
    cur=Math.min(cur,list.length-1);dirty();build();ctx.toast('Deleted '+it.name);
  }
  ctx.footer.appendChild(_drwBtn('Delete',del,'drw-danger'));
  ctx.footer.appendChild(_drwBtn('Save to program',save,'drw-pri'));
  build();
  ctx.moteTool={run:run,check:check,save:save,select:function(n){var i=list.findIndex(function(x){return x.name===n});if(i>=0){cur=i;build()}return i>=0},items:function(){return list}};
}
_drawerRegister({id:'script',label:'Script',icon:'📜',desc:'Mote scripts: dialogue, level logic and mods — edit, run in a sandbox, save as script blocks',open:_moteTool});

// ── the example ──
EX.mote="// Mote — scripts in a small Lua-like language, run by your Emit program.\n// The scripts live in scripts.emit (the second tab) as `script NAME:` blocks.\n// Open 🧰 → Script to edit and test them. No network: Mote is built into Emit.\nuse mote\n\nmut vm: js = null\nmut talk: js = null\nmut line = \"\"\nmut opts: js = null\nmut gold = 10\nmut speed = 2\nmut x = 20\nmut t = 0\nmut asked = 0\n\n// Emit functions the scripts call\nfn say(s: str) {\n  line = s\n  printStr(\"says: \" + s)\n}\nfn give(n: int) int {\n  gold = gold + n\n  return gold\n}\nfn setSpeed(v: int) {\n  speed = v\n}\n\nexport fn game() {\n  canvas(320, 200)\n  vm = moteVM()\n  moteFn(vm, \"say\", fnRef(say))\n  moteFn(vm, \"give\", fnRef(give))\n  moteFn(vm, \"setSpeed\", fnRef(setSpeed))\n  moteSet(vm, \"player\", \"Ada\")\n  // a mod, loaded at run time: it changes a game value through setSpeed\n  try {\n    moteRun(vm, mod)\n  } catch (e) {\n    printStr(\"mod failed: \" + e.message)\n  }\n  // the dialogue runs as a coroutine, one step per frame\n  talk = moteThread(vm, dialogue)\n  animate()\n}\n\nexport fn frame() {\n  t++\n  x = x + speed\n  if (x > 300) { x = 20 }\n  if (talk != null) {\n    opts = moteChoices(talk)\n    // the player picks with key 1 / 2 or a tap (left / right half); after 1 s the first option is taken\n    if (opts != null) {\n      asked++\n      if (keyDown(49) == 1) { moteChoose(talk, 1) }\n      else if (keyDown(50) == 1) { moteChoose(talk, 2) }\n      else if (touching() == 1) { if (touchX() < 160) { moteChoose(talk, 1) } else { moteChoose(talk, 2) } }\n      else if (asked > 60) { moteChoose(talk, 1) }\n    }\n    if (!moteResume(talk)) {\n      talk = null\n      printStr(\"dialogue over, gold \" + gold)\n    }\n  }\n  color(20, 24, 40)\n  rect(0, 0, 320, 200)\n  color(255, 205, 117)\n  circle(x, 150, 10)\n  color(230, 230, 240)\n  text(line, 12, 30, 14)\n  text(\"gold \" + gold + \"  speed \" + speed, 12, 190, 12)\n  if (talk != null) {\n    opts = moteChoices(talk)\n  }\n  if (talk != null && opts != null) {\n    color(196, 181, 253)\n    text(\"1: \" + toStr(opts[0]) + \"    2: \" + toStr(opts[1]), 12, 60, 13)\n  }\n}\n//// file: scripts.emit\n// Mote scripts (Lua-like). Each block is visible from every file by its name.\nscript dialogue:\n  say(\"Hello, \" .. player .. \"!\")\n  wait(0.5)\n  say(\"Care for a potion? 5 gold.\")\n  local c = choose(\"Yes\", \"No thanks\")\n  if c == 1 then\n    local left = give(-5)\n    say(\"Here you go. \" .. left .. \" gold left.\")\n  else\n    say(\"Suit yourself.\")\n  end\n  waitFrames(30)\n  say(\"Safe travels!\")\n\nscript mod:\n  -- a player-made mod: runs once when the game starts\n  print(\"mod loaded: double speed\")\n  setSpeed(4)\n";
(function(){try{
  var sel=document.getElementById('example');if(!sel||sel.querySelector('option[value="mote"]'))return;
  var o=document.createElement('option');o.value='mote';o.textContent='Mote';
  var mem=sel.querySelector('option[value="memory"]');sel.insertBefore(o,mem||null);
}catch(e){}})();

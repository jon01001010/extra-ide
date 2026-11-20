// ═══ MAPS & CONTROLS — compiler half, editor, STAGE and CONTROLS drawer tools ═══
// `map` and `controls` are blocks, not statements: a line in column 0 `map <name>:` / `controls <name>:` and the
// indented lines below it. The lexer hands each block to the parser as one BLOCK token (its lines are blanked
// before the ordinary lexer runs, so positions elsewhere do not move); Parser.parseTop turns it into a MapDecl /
// ControlsDecl. Names are project-wide: any file may use a map or controls block of any other file by its bare
// name. Right before injectBuiltins, _stLower turns every name into its number, checks the calls of the map and
// controls builtins, declares them as imports of module std and hangs the blocks' data on the import list
// (imports.stageMeta, read by _stSetup in the runtime). A program without these blocks is not touched (same bytes).
//
//   map level1: 20x15, tile 16
//     legend # wall solid #3a3a5c,  . floor #1b1b2a,  g grass sprite grass
//     rows
//       "####################"
//     objects
//       hero 2,3
//       slime 12,8 speed 0.5
//   controls pad: stick left, buttons A "jump" B, size 1.0, opacity 0.5
// The blocks of a source text: [{kind, name, line (0-based first line), end (0-based last line), lines:[text]}].
// Only lines that start outside a comment or string count.
function _stFindBlocks(src){
  src=String(src==null?'':src);
  var L=null;
  /* the shared block scanner (BLOCKS): the same extent as the drawer's helpers and every other block kind */
  return _emitScanBlocks(src,null).filter(function(b){return b.kind==='map'||b.kind==='controls'}).map(function(b){
    L=L||src.split('\n');
    return{kind:b.kind,name:b.name,line:b.start,end:b.end,lines:L.slice(b.start,b.end+1).map(function(s){return s.replace(/\r$/,'')})};
  });
}
// Comma-separated items / space-separated words of a piece of a line, with their (1-based) columns; quotes kept.
function _stSplit(s,col,sep){
  var out=[],cur='',at=-1,q='';
  for(var i=0;i<=s.length;i++){
    var c=i<s.length?s[i]:null;
    if(c!==null&&q){cur+=c;if(c===q)q='';continue}
    if(c===null||(sep===','?c===',':/\s/.test(c))){if(cur.trim()){var lead=cur.length-cur.replace(/^\s+/,'').length;out.push({text:cur.trim(),col:col+at+lead})}cur='';at=-1;continue}
    if(at<0)at=i;
    if(c==='"')q=c;
    cur+=c;
  }
  return out;
}
function _stNum(s){return/^-?(\d+\.?\d*|\.\d+)$/.test(s)?Number(s):null}
function _stUnq(s){return/^".*"$/.test(s)?s.slice(1,-1):s}
// Parses a map block. b: {name, line (0-based), lines}. Returns the model the tool edits and the compiler checks:
// {name, w, h, tile, tileSet, legend:[{ch,name,solid,color,sprite,extra:[words]}], inline, rows:[str], objects:[{kind,x,y,props:[[k,v]]}],
//  keep:[lines kept as they are: comments and lines this version does not know], problems:[{line,col,msg}] (1-based)}
function _stParseMap(b){
  var M={kind:'map',name:b.name,w:0,h:0,tile:16,tileSet:false,legend:[],inline:false,rows:[],objects:[],keep:[],problems:[],headExtra:[],locs:{}};
  var base=b.line+1,L=b.lines;
  function P(line,col,msg){M.problems.push({line:line,col:col,msg:msg})}
  var hm=/^map[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*:/i.exec(L[0]);
  M.locs.name={line:base,col:L[0].indexOf(b.name,3)+1};
  var items=_stSplit(L[0].slice(hm[0].length),hm[0].length+1,',');
  items.forEach(function(it,k){
    var sm=/^(\d+)\s*x\s*(\d+)$/i.exec(it.text),tm=/^tile\s+(\S+)$/i.exec(it.text);
    if(k===0&&!sm){P(base,it.col,'Expected the size of map '+b.name+' first — map '+b.name+': 20x15, tile 16');if(!tm){M.headExtra.push(it.text);return}}
    if(sm&&k===0){M.w=+sm[1];M.h=+sm[2];M.locs.size={line:base,col:it.col};
      if(M.w<1||M.h<1||M.w>256||M.h>256)P(base,it.col,'The size of map '+b.name+' must be 1x1 to 256x256, not '+it.text)}
    else if(tm){var t=_stNum(tm[1]);M.tileSet=true;if(t===null||t!==Math.floor(t)||t<1||t>256)P(base,it.col+it.text.indexOf(tm[1]),'tile must be a whole number of pixels from 1 to 256, not '+tm[1]);else M.tile=t}
    else{P(base,it.col,'Unknown setting "'+it.text+'" in map '+b.name+' — the header is: map '+b.name+': 20x15, tile 16');M.headExtra.push(it.text)}
  });
  if(!items.length)P(base,L[0].length+1,'Expected the size of map '+b.name+' — map '+b.name+': 20x15, tile 16');
  var sec=null,secInd=-1,legendLines=0;
  for(var i=1;i<L.length;i++){
    var raw=L[i],ln=base+i;
    if(!raw.trim())continue;
    var ind=raw.length-raw.replace(/^[ \t]+/,'').length,txt=raw.trim();
    if(/^\/\//.test(txt)){M.keep.push(raw);continue}
    if(sec&&ind>secInd){
      if(sec==='legend'){legendLines++;legend(raw.slice(ind),ln,ind+1)}
      else if(sec==='rows'){
        var rm=/^"([^"]*)"\s*(\/\/.*)?$/.exec(txt);
        if(!rm){P(ln,ind+1,'A row of map '+b.name+' is written in double quotes — "#....#"');M.keep.push(raw);continue}
        M.rows.push({text:rm[1],line:ln,col:ind+1});
      }else if(sec==='objects')object(txt,ln,ind+1,raw);
      continue;
    }
    var wm=/^(legend|rows|objects)\b(.*)$/i.exec(txt);
    if(!wm){sec=null;P(ln,ind+1,'Unknown line in map '+b.name+' — expected legend, rows or objects');M.keep.push(raw);continue}
    sec=wm[1].toLowerCase();secInd=ind;
    if(sec==='legend'){M.locs.legend={line:ln,col:ind+1};if(wm[2].trim()){M.inline=true;legend(wm[2],ln,ind+1+6)}}
    else if(sec==='rows'){M.locs.rows={line:ln,col:ind+1};if(wm[2].trim())P(ln,ind+6,'The rows of map '+b.name+' go on the lines below "rows", one quoted row per line')}
    else{M.locs.objects={line:ln,col:ind+1};if(wm[2].trim())P(ln,ind+9,'The objects of map '+b.name+' go on the lines below "objects", one per line — hero 2,3')}
  }
  if(M.inline&&legendLines)M.inline=false;
  function legend(s,ln,col){
    _stSplit(s,col,',').forEach(function(it){
      var ws=_stSplit(it.text,it.col,' '),e={ch:'',name:'',solid:false,color:null,sprite:null,extra:[],line:ln,col:it.col};
      var ch=Array.from(ws[0].text);
      if(ch.length!==1||ch[0]==='"'){P(ln,ws[0].col,'A legend entry starts with one character, then a name — # wall solid #3a3a5c');e.extra=ws.map(function(w){return w.text});M.legend.push(e);return}
      e.ch=ch[0];
      var dup=M.legend.filter(function(x){return x.ch===e.ch})[0];
      if(dup)P(ln,ws[0].col,'"'+e.ch+'" is already in the legend of map '+b.name+' (as '+dup.name+') — every character stands for one tile');
      if(e.ch===' ')P(ln,ws[0].col,'A space is always an empty tile — it cannot be in the legend');
      if(!ws[1]||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ws[1].text))P(ln,ws[1]?ws[1].col:ws[0].col+1,'Expected a name after "'+e.ch+'" in the legend — '+e.ch+' wall solid #3a3a5c');
      else{
        e.name=ws[1].text;
        var cl=M.legend.filter(function(x){return x.name&&x.name!==e.name&&x.name.toLowerCase()===e.name.toLowerCase()})[0];
        if(cl)P(ln,ws[1].col,'Legend names "'+e.name+'" and "'+cl.name+'" (line '+cl.line+') differ only by case — names are case-insensitive: rename one of them');
      }
      for(var k=2;k<ws.length;k++){
        var w=ws[k].text;
        if(w.toLowerCase()==='solid'){if(e.solid)P(ln,ws[k].col,'solid is written twice for "'+e.ch+'"');e.solid=true}
        else if(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(w)){if(e.color)P(ln,ws[k].col,'"'+e.ch+'" has two colours');e.color=w}
        else if(w.toLowerCase()==='sprite'){
          var sn=ws[k+1];
          if(!sn||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(sn.text))P(ln,sn?sn.col:ws[k].col+6,'Expected a sprite name after sprite — g grass sprite grass');
          else{e.sprite=sn.text;k++}
        }
        else{P(ln,ws[k].col,'Unknown word "'+w+'" in the legend entry of "'+e.ch+'" — write solid, a colour like #3a3a5c or sprite NAME');e.extra.push(w)}
      }
      M.legend.push(e);
    });
  }
  function object(t,ln,col,raw){
    var ws=_stSplit(t,col,' ');
    var o={kind:ws[0].text,x:0,y:0,props:[],line:ln,col:col,ccol:col};
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(o.kind)){P(ln,col,'An object starts with its kind — hero 2,3');M.keep.push(raw);return}
    var rest=t.slice(ws[0].text.length),cm=/^(\s*)(-?\d+)\s*,\s*(-?\d+)/.exec(rest);
    if(!cm){P(ln,col+ws[0].text.length+1,'Expected tile coordinates after '+o.kind+' — '+o.kind+' 2,3');M.keep.push(raw);return}
    o.x=+cm[2];o.y=+cm[3];o.ccol=col+ws[0].text.length+cm[1].length;
    var pw=_stSplit(rest.slice(cm[0].length),o.ccol+cm[0].length-cm[1].length,' ');
    for(var k=0;k<pw.length;k+=2){
      if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(pw[k].text)){P(ln,pw[k].col,'Expected a property name — '+o.kind+' '+o.x+','+o.y+' speed 0.5');break}
      if(!pw[k+1]){P(ln,pw[k].col+pw[k].text.length,'Expected a value after '+pw[k].text+' — '+pw[k].text+' 1');break}
      o.props.push([pw[k].text,pw[k+1].text]);
    }
    M.objects.push(o);
  }
  // whole-block checks (once every line reads)
  if(M.w&&M.h&&!M.problems.length){
    var known={};M.legend.forEach(function(e){if(e.ch)known[e.ch]=true});
    if(!M.locs.rows)P(M.locs.name.line,M.locs.name.col,'map '+b.name+' has no rows — add "rows" and '+M.h+' quoted rows of '+M.w+' tiles');
    else if(M.rows.length!==M.h)P(M.locs.rows.line,M.locs.rows.col,'map '+b.name+' has '+M.rows.length+' row'+(M.rows.length===1?'':'s')+', but its size says '+M.h+' ('+M.w+'x'+M.h+')');
    M.rows.forEach(function(r,k){
      var cs=Array.from(r.text);
      if(cs.length!==M.w)P(r.line,r.col,'Row '+(k+1)+' of map '+b.name+' has '+cs.length+' tile'+(cs.length===1?'':'s')+', but the map is '+M.w+' wide');
      for(var x=0;x<cs.length;x++)if(cs[x]!==' '&&!known[cs[x]]){P(r.line,r.col+1+cs.slice(0,x).join('').length,'"'+cs[x]+'" in row '+(k+1)+' of map '+b.name+' is not in its legend — add it: legend '+cs[x]+' name #888888');break}
    });
    M.objects.forEach(function(o){
      if(o.x<0||o.y<0||o.x>=M.w||o.y>=M.h)P(o.line,o.ccol,o.kind+' '+o.x+','+o.y+' is outside map '+b.name+' — it is '+M.w+'x'+M.h+' (x 0 to '+(M.w-1)+', y 0 to '+(M.h-1)+')');
    });
  }
  M.rows=M.rows.map(function(r){return r.text});
  M.problems.sort(function(a,c){return a.line-c.line||a.col-c.col});
  return M;
}
// Parses a controls block: {name, stick:'left'|'right'|'none', dpad, buttons:[{id,label}], side|null, size, opacity, keys, deadzone,
// items:[{k, raw}] (the order of the items as written, unknown ones kept), problems}
function _stParseControls(b){
  var C={kind:'controls',name:b.name,stick:'left',dpad:false,buttons:[],side:null,size:1,opacity:0.5,keys:true,deadzone:0.15,items:[],keep:[],problems:[],locs:{}};
  var base=b.line+1,L=b.lines,set={};
  function P(line,col,msg){C.problems.push({line:line,col:col,msg:msg})}
  var hm=/^controls[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*:/i.exec(L[0]);
  C.locs.name={line:base,col:L[0].indexOf(b.name,8)+1};
  var parts=[{s:L[0].slice(hm[0].length),line:base,col:hm[0].length+1}];
  for(var i=1;i<L.length;i++){if(!L[i].trim())continue;var ind=L[i].length-L[i].replace(/^[ \t]+/,'').length;if(/^\/\//.test(L[i].trim())){C.keep.push(L[i]);continue}parts.push({s:L[i].slice(ind),line:base+i,col:ind+1})}
  parts.forEach(function(p){
    _stSplit(p.s,p.col,',').forEach(function(it){
      var ws=_stSplit(it.text,it.col,' '),k=ws[0].text.toLowerCase(),v=ws[1]?(/^"/.test(ws[1].text)?ws[1].text:ws[1].text.toLowerCase()):null,ln=p.line;   /* settings and their words are case-insensitive */
      function once(){if(set[k])P(ln,it.col,k+' is set twice in controls '+b.name);set[k]=true}
      function num(lo,hi){var n=v===null?null:_stNum(v);if(n===null||n<lo||n>hi||ws.length>2){P(ln,ws[1]?ws[1].col:it.col+k.length+1,k+' must be a number from '+lo+' to '+hi+' — '+k+' '+(k==='size'?'1.0':k==='opacity'?'0.5':'0.15'));return null}return n}
      C.items.push({k:k,raw:it.text});
      if(k==='stick'||k==='dpad'){
        once();if(set.stick&&set.dpad)P(ln,it.col,'controls '+b.name+' has a stick and a dpad — choose one');
        if(!(v==='left'||v==='right'||(k==='stick'&&v==='none'))||ws.length>2){P(ln,ws[1]?ws[1].col:it.col+k.length+1,k==='stick'?'Expected left, right or none after stick':'Expected left or right after dpad');return}
        C.stick=v;C.dpad=k==='dpad';
      }else if(k==='buttons'){
        once();
        var j=1;
        if(ws[1]&&(v==='left'||v==='right')){C.side=v;j=2}
        for(;j<ws.length;j++){
          var id=/^[abc]$/.test(ws[j].text)?ws[j].text.toUpperCase():ws[j].text;
          if(!/^[ABC]$/.test(id)){P(ln,ws[j].col,'Buttons are named A, B and C — buttons A "jump" B');return}
          if(C.buttons.some(function(x){return x.id===id})){P(ln,ws[j].col,'Button '+id+' is listed twice');return}
          var lab=null;
          if(ws[j+1]&&/^".*"$/.test(ws[j+1].text)){lab=_stUnq(ws[j+1].text);j++}
          C.buttons.push({id:id,label:lab});
        }
      }else if(k==='size'){once();var n=num(0.5,2);if(n!==null)C.size=n}
      else if(k==='opacity'){once();n=num(0.1,1);if(n!==null)C.opacity=n}
      else if(k==='deadzone'){once();n=num(0,0.9);if(n!==null)C.deadzone=n}
      else if(k==='keys'){once();if((v!=='on'&&v!=='off')||ws.length>2)P(ln,ws[1]?ws[1].col:it.col+5,'Expected on or off after keys');else C.keys=v==='on'}
      else{C.items[C.items.length-1].unknown=true;P(ln,it.col,'Unknown setting "'+k+'" in controls '+b.name+' — stick, dpad, buttons, size, opacity, deadzone or keys')}
    });
  });
  return C;
}
function _stParseBlock(b){return b.kind==='map'?_stParseMap(b):_stParseControls(b)}
// Writes a block back as text. A model read from text and written again gives the same text when the text was
// in this form (one setting per item, two spaces of indent; the legend on one line or one entry per line, as found).
function _stLegendEntry(e){var s=e.ch+' '+e.name;if(e.solid)s+=' solid';if(e.color)s+=' '+e.color;if(e.sprite)s+=' sprite '+e.sprite;if(e.extra&&e.extra.length)s+=' '+e.extra.join(' ');return s}
function _stWriteMap(M){
  var head='map '+M.name+': '+M.w+'x'+M.h;
  if(M.tileSet||M.tile!==16)head+=', tile '+M.tile;
  (M.headExtra||[]).forEach(function(x){head+=', '+x});
  var out=[head],lg=M.legend.map(_stLegendEntry);
  if(lg.length){
    var one='  legend '+lg.join(',  ');
    if(M.inline&&one.length<=100)out.push(one);
    else{out.push('  legend');lg.forEach(function(s){out.push('    '+s)})}
  }
  out.push('  rows');
  M.rows.forEach(function(r){out.push('    "'+r+'"')});
  if(M.objects.length){
    out.push('  objects');
    M.objects.forEach(function(o){out.push('    '+o.kind+' '+o.x+','+o.y+o.props.map(function(p){return' '+p[0]+' '+p[1]}).join(''))});
  }
  (M.keep||[]).forEach(function(k){out.push(k)});
  return out.join('\n');
}
function _stWriteControls(C){
  var known={},items=[];
  function item(k){
    if(k==='stick'||k==='dpad')return C.dpad?'dpad '+C.stick:'stick '+C.stick;
    if(k==='buttons'){if(!C.buttons.length)return null;return'buttons '+(C.side?C.side+' ':'')+C.buttons.map(function(b){return b.id+(b.label?' "'+b.label.replace(/"/g,"'")+'"':'')}).join(' ')}
    if(k==='size')return'size '+_stFix(C.size);
    if(k==='opacity')return'opacity '+_stFix(C.opacity);
    if(k==='deadzone')return'deadzone '+_stFix(C.deadzone);
    if(k==='keys')return'keys '+(C.keys?'on':'off');
    return null;
  }
  (C.items||[]).forEach(function(it){
    var k=it.k==='dpad'?'stick':it.k;
    if(it.unknown){items.push(it.raw);return}
    if(known[k])return;known[k]=true;
    var s=item(k);if(s)items.push(s);
  });
  ['stick','buttons','size','opacity','deadzone','keys'].forEach(function(k){
    if(known[k])return;
    if(k==='deadzone'&&C.deadzone===0.15)return;
    if(k==='keys'&&C.keys)return;
    var s=item(k);if(s)items.push(s);
  });
  return['controls '+C.name+': '+items.join(', ')].concat(C.keep||[]).join('\n');
}
function _stFix(n){n=Math.round(Number(n)*100)/100;var s=String(n);return s.indexOf('.')<0?s+'.0':s}
// ── lexer: blocks become BLOCK tokens ──
(function(){
  var tk0=Lexer.prototype.tokenize;
  Lexer.prototype.tokenize=function(){
    var src=this.s;
    if(typeof src!=='string'||!/(^|\n)(map|controls)[ \t]/i.test(src))return tk0.call(this);
    var bl=_stFindBlocks(src);
    if(!bl.length)return tk0.call(this);
    var L=src.split('\n');
    bl.forEach(function(b){for(var i=b.line;i<=b.end;i++)L[i]=''});
    this.s=L.join('\n');
    var ts;
    try{ts=tk0.call(this)}finally{this.s=src}
    var out=[],k=0;
    bl.forEach(function(b){
      while(k<ts.length&&ts[k].type!==TT.EOF&&ts[k].line<=b.line+1)out.push(ts[k++]);
      var t=new Token('BLOCK',b.kind,b.line+1,1);t.block=b;out.push(t);
    });
    while(k<ts.length)out.push(ts[k++]);
    return out;
  };
  var P=Parser.prototype,top0=P.parseTop,stmt0=P.parseStmt;
  P.parseTop=function(){
    var t=this.cur();
    if(t&&t.type==='BLOCK'){
      this.adv();
      var M=_stParseBlock(t.block);
      if(M.problems.length){var p=M.problems[0];throw new Error(p.line+':'+p.col+': '+p.msg)}
      return{type:M.kind==='map'?'MapDecl':'ControlsDecl',name:M.name,data:M,loc:{line:t.line,col:1},nameLoc:{line:M.locs.name.line,col:M.locs.name.col}};
    }
    return top0.call(this);
  };
  P.parseStmt=function(){
    var t=this.cur();
    if(t&&t.type==='BLOCK')throw new Error(t.line+':1: '+t.value+' blocks belong at the top level of a file, not inside a function');
    return stmt0.call(this);
  };
})();
// ── lowering ──
var _ST_FNS={
  drawMap:{kind:'map',args:[['m','int'],['ox','num'],['oy','num']],ret:'void',min:1},
  tileAt:{kind:'map',args:[['m','int'],['tx','int'],['ty','int']],ret:'str'},
  solidAt:{kind:'map',args:[['m','int'],['px','num'],['py','num']],ret:'bool'},
  mapW:{kind:'map',args:[['m','int']],ret:'int'},
  mapH:{kind:'map',args:[['m','int']],ret:'int'},
  tileSize:{kind:'map',args:[['m','int']],ret:'int'},
  setTile:{kind:'map',args:[['m','int'],['tx','int'],['ty','int'],['ch','str']],ret:'void'},
  objCount:{kind:'map',args:[['m','int'],['kind','str']],ret:'int'},
  objX:{kind:'map',args:[['m','int'],['kind','str'],['i','int']],ret:'num'},
  objY:{kind:'map',args:[['m','int'],['kind','str'],['i','int']],ret:'num'},
  useControls:{kind:'controls',args:[['c','int']],ret:'void'},
  stickX:{args:[],ret:'num'},
  stickY:{args:[],ret:'num'},
  pressed:{args:[['btn','str']],ret:'bool',btn:true},
  justPressed:{args:[['btn','str']],ret:'bool',btn:true}
};
function _stLower(ast){
  var body=ast.body;
  if(!body.some(function(n){return n.type==='MapDecl'||n.type==='ControlsDecl'}))return;
  function fail(msg,loc){throw new Error((loc&&loc.file?loc.file+':':'')+(loc?(loc.line||1)+':'+(loc.col||1)+': ':'')+msg)}
  var blocks=new Map(),maps=[],ctls=[],tops=new Map(),fns=new Set();
  body.forEach(function(n){
    if(n.type==='FunctionDecl'||n.type==='VarDecl'||n.type==='ImportDecl'||n.type==='StructDecl'||n.type==='RegionDecl'){
      tops.set(n.modName||n.name,n);if(n.type==='FunctionDecl'||n.type==='ImportDecl')fns.add(n.name);
    }
    /* sprite names are project-wide bare names too (SPRITE): one name may not be a sprite and a map / controls */
    if(n.type==='SpriteDecl'&&!tops.has(n.name))tops.set(n.name,n);
  });
  function where(l){return(l&&l.file?l.file+':':'line ')+((l&&l.line)||1)}
  body.forEach(function(n){
    if(n.type!=='MapDecl'&&n.type!=='ControlsDecl')return;
    var kw=n.type==='MapDecl'?'map':'controls';
    if(n.nameLoc&&n.loc&&n.loc.file)n.nameLoc.file=n.loc.file;
    var prev=blocks.get(n.name);
    if(prev)fail('"'+n.name+'" is already the name of '+prev.kw+' '+n.name+' at '+where(prev.node.nameLoc)+' — every map and controls block needs its own name',n.nameLoc);
    var top=tops.get(n.name);
    if(top)fail(kw+' '+n.name+' has the same name as '+(top.type==='FunctionDecl'?'the function':top.type==='VarDecl'?'the variable':top.type==='ImportDecl'?'the import':top.type==='StructDecl'?'the struct':top.type==='SpriteDecl'?'the sprite':'the region')+' '+n.name+(top.loc&&top.loc.line?' at '+where(top.loc):'')+' — rename one of them'+(top.type==='SpriteDecl'?' (sprite, map and controls names are seen by every file)':''),n.nameLoc);
    var e={kw:kw,node:n,id:kw==='map'?maps.length:ctls.length};
    blocks.set(n.name,e);
    (kw==='map'?maps:ctls).push(n);
  });
  var names=Array.from(blocks.keys()),used=new Set(),scopes=[],seen=new Set(),need=new Set();
  function isLocal(nm){for(var i=scopes.length-1;i>=0;i--)if(scopes[i].has(nm))return true;return tops.has(nm)&&tops.get(nm).type==='VarDecl'}
  function def(nm){scopes[scopes.length-1].add(nm)}
  function asLit(e,b){e.type='IntLiteral';e.value=String(b.id);e.stBlock=b.node.name;delete e.name}
  function call(e){
    var c=e.callee,f=c&&c.type==='IdentifierExpr'&&!fns.has(c.name)&&!isLocal(c.name)&&Object.prototype.hasOwnProperty.call(_ST_FNS,c.name)?_ST_FNS[c.name]:null;
    if(!f)return;
    var nm=c.name,want=f.args.length,min=f.min||want;
    if(e.args.length<min||e.args.length>want||(f.min&&e.args.length!==min&&e.args.length!==want))
      fail(nm+'() takes '+(f.min&&f.min!==want?f.min+' or '+want:want)+' argument'+(want===1?'':'s')+' — '+nm+'('+f.args.map(function(a){return a[0]}).join(', ')+')',e.loc||c.loc);
    if(f.kind){
      var a=e.args[0];
      if(a&&a.type==='IdentifierExpr'&&!isLocal(a.name)){
        var b=blocks.get(a.name);
        if(!b){
          var same=names.filter(function(x){return blocks.get(x).kw===f.kind}),hint=_emitModClosest(a.name,same);
          fail('Unknown '+(f.kind==='map'?'map':'controls')+' "'+a.name+'"'+(same.length?' — the '+(f.kind==='map'?'maps':'controls')+' of this project: '+same.join(', '):' — this project has no '+(f.kind==='map'?'map':'controls')+' block')+(hint?' (did you mean "'+hint+'"?)':''),a.loc);
        }
        if(b.kw!==f.kind)fail(nm+'() needs '+(f.kind==='map'?'a map':'a controls block')+', but '+a.name+' is '+(b.kw==='map'?'a map':'a controls block'),a.loc);
        seen.add(a);used.add(b.node.name);asLit(a,b);
        if(nm==='setTile'&&e.args[3]&&e.args[3].type==='StringLiteral'){
          var ch=Array.from(e.args[3].value),M=b.node.data;
          if(ch.length!==1||(ch[0]!==' '&&!M.legend.some(function(x){return x.ch===ch[0]})))fail('setTile: "'+e.args[3].value+'" is not a tile of map '+b.node.name+' — use one of its legend characters: '+M.legend.map(function(x){return x.ch}).join(' '),e.args[3].loc);
        }
      }
    }
    if(f.btn&&e.args[0]&&e.args[0].type==='StringLiteral'&&!/^[ABC]$/i.test(e.args[0].value))fail(nm+'("'+e.args[0].value+'") — the buttons are "A", "B" and "C"',e.args[0].loc);
    need.add(nm);
    if(nm==='drawMap'&&e.args.length===1)e.args.push(new FloatLiteral('0.0',e.loc),new FloatLiteral('0.0',e.loc));
  }
  function X(e){
    if(!e||typeof e!=='object')return;
    if(Array.isArray(e)){e.forEach(X);return}
    if(seen.has(e))return;seen.add(e);
    if(typeof e.type==='string'&&(/Stmt$/.test(e.type)||e.type==='VarDecl')){S(e);return}
    if(e.type==='CallExpr')call(e);
    if(e.type==='IdentifierExpr'&&blocks.has(e.name)&&!isLocal(e.name)&&!fns.has(e.name)){var b=blocks.get(e.name);used.add(e.name);asLit(e,b);return}
    kids(e);
  }
  function kids(x){for(var k in x){if(k==='loc'||k==='nameLoc')continue;var v=x[k];if(v&&typeof v==='object')X(v)}}
  function S(n){
    if(!n||typeof n!=='object')return;
    seen.add(n);
    switch(n.type){
      case'VarDecl':X(n.init);def(n.name);return;
      case'BlockStmt':scopes.push(new Set());n.statements.forEach(S);scopes.pop();return;
      case'ForStmt':scopes.push(new Set());S(n.init);X(n.condition);X(n.update);S(n.body);scopes.pop();return;
      case'WithStmt':X(n.target);scopes.push(new Set([n.alias]));S(n.body);scopes.pop();return;
    }
    kids(n);
  }
  body.forEach(function(n){
    if(n.type==='FunctionDecl'){scopes=[new Set(n.params.map(function(p){return p.name}))];S(n.body)}
    else if(n.type==='VarDecl'&&n.init){scopes=[new Set()];X(n.init)}
  });
  // the blocks leave the program; their data rides on the import list
  var meta={v:1,maps:maps.map(function(n){var M=n.data,lg={};M.legend.forEach(function(e){var o={name:e.name,solid:!!e.solid};if(e.color)o.color=e.color;if(e.sprite)o.sprite=e.sprite;lg[e.ch]=o});
      return{name:n.name,w:M.w,h:M.h,tile:M.tile,legend:lg,rows:M.rows.slice(),objects:M.objects.map(function(o){var p={};o.props.forEach(function(kv){var v=_stNum(kv[1]);p[kv[0]]=v===null?_stUnq(kv[1]):v});return{kind:o.kind,x:o.x,y:o.y,props:p}})}}),
    controls:ctls.map(function(n){var C=n.data;return{name:n.name,stick:C.stick,dpad:!!C.dpad,buttons:C.buttons.map(function(b){return{id:b.id,label:b.label}}),side:C.side,size:C.size,opacity:C.opacity,keys:C.keys,deadzone:C.deadzone}})};
  ast.body=body.filter(function(n){return n.type!=='MapDecl'&&n.type!=='ControlsDecl'});
  ast.stageMeta=JSON.stringify(meta);
  ast.stageBlocks={maps:maps.map(function(n){return n.name}),controls:ctls.map(function(n){return n.name})};
  Object.keys(_ST_FNS).forEach(function(k){
    if(!need.has(k))return;
    var f=_ST_FNS[k];
    ast.body.unshift(new ImportDecl(k,f.args.map(function(a){return{name:a[0],type:a[1]}}),f.ret,'std',{line:0,col:0}));
  });
}
injectBuiltins=(function(inj){return function(ast){_stLower(ast);return inj.apply(this,arguments)}})(injectBuiltins);
(function(){
  var gen0=WasmCodegen.prototype.generate;
  WasmCodegen.prototype.generate=function(){
    var w=gen0.apply(this,arguments);
    if(this.ast&&this.ast.stageMeta)this.imports.stageMeta=this.ast.stageMeta;
    return w;
  };
})();
// compile result: r.maps / r.controls — the names of the program's blocks (only when it has any)
compile=(function(c){return function(source,target){
  var r=c.apply(this,arguments);
  if(r&&r.ast&&r.ast.stageBlocks){r.maps=r.ast.stageBlocks.maps;r.controls=r.ast.stageBlocks.controls}
  return r;
}})(compile);
// ── editor: highlighting and autocomplete for the builtins ──
[['drawMap','drawMap(m, ox: num, oy: num)','draw a map block'],['tileAt','tileAt(m, tx, ty) str','the tile character'],['solidAt','solidAt(m, px: num, py: num) bool','is the tile at this pixel solid?'],
 ['mapW','mapW(m) int','width in tiles'],['mapH','mapH(m) int','height in tiles'],['tileSize','tileSize(m) int','pixels per tile'],['setTile','setTile(m, tx, ty, ch: str)','change a tile while running'],
 ['objCount','objCount(m, kind: str) int','objects of a kind'],['objX','objX(m, kind: str, i) num','pixel x of object i'],['objY','objY(m, kind: str, i) num','pixel y of object i'],
 ['useControls','useControls(c)','show on-screen controls'],['stickX','stickX() num','-1 … 1'],['stickY','stickY() num','-1 … 1'],['pressed','pressed(btn: str) bool','"A" "B" "C" held'],['justPressed','justPressed(btn: str) bool','once per press']].forEach(function(b){
  _emitBlt.add(b[0]);
  if(!_allBuiltins.some(function(x){return x.name===b[0]}))_allBuiltins.push({name:b[0],sig:b[1],desc:b[2]});
});
// ── the bundled example ──
EX.stage='//// file: main.emit\n// A room from a map block: walk with the stick or the arrow keys, pick up the coins,\n// the door (+) opens when all of them are taken. The map and the controls live in stages.emit —\n// open them with the drawer tools STAGE and CONTROLS.\nmut px = 0.0\nmut py = 0.0\nmut got = 0\nmut coins = 0\nmut taken = 0\nmut opened = false\n\nexport fn main() {\n  canvas(mapW(room) * tileSize(room), mapH(room) * tileSize(room) + 20)\n  useControls(pad)\n  px = objX(room, "hero", 0)\n  py = objY(room, "hero", 0)\n  coins = objCount(room, "coin")\n  animate()\n}\n\nfn free(x: num, y: num) bool {\n  let s = 11.0\n  return !solidAt(room, x, y) && !solidAt(room, x + s, y) && !solidAt(room, x, y + s) && !solidAt(room, x + s, y + s)\n}\n\nfn collect() {\n  let t = tileSize(room)\n  for (let i = 0; i < coins; i++) {\n    let bit = 1 << i\n    if ((taken & bit) == 0) {\n      let cx = objX(room, "coin", i)\n      let cy = objY(room, "coin", i)\n      if (px + 11.0 > cx && px < cx + 16.0 && py + 11.0 > cy && py < cy + 16.0) {\n        taken = taken | bit\n        got += 1\n        beep(880, 60)\n      }\n    }\n  }\n  if (got == coins && !opened) {\n    opened = true\n    for (let y = 0; y < mapH(room); y++) {\n      for (let x = 0; x < mapW(room); x++) {\n        if (strEq(tileAt(room, x, y), "+")) { setTile(room, x, y, ".") }\n      }\n    }\n  }\n}\n\nexport fn frame() {\n  let speed = 2.0\n  let nx = px + stickX() * speed\n  if (free(nx, py)) { px = nx }\n  let ny = py + stickY() * speed\n  if (free(px, ny)) { py = ny }\n  collect()\n  clear()\n  drawMap(room)\n  for (let i = 0; i < coins; i++) {\n    if ((taken & (1 << i)) == 0) {\n      color(250, 204, 21)\n      circle(floor(objX(room, "coin", i)) + 8, floor(objY(room, "coin", i)) + 8, 5)\n    }\n  }\n  color(45, 212, 191)\n  rect(floor(px), floor(py), 11, 11)\n  color(212, 216, 227)\n  let h = mapH(room) * tileSize(room)\n  if (opened) { text("the door is open!", 4, h + 15, 12) } else { text("coins " + intToStr(got) + " / " + intToStr(coins), 4, h + 15, 12) }\n  if (justPressed("A")) { beep(440, 40) }\n}\n//// file: stages.emit\n// Blocks for the drawer tools: STAGE edits the map, CONTROLS the on-screen controls.\nmap room: 16x10, tile 16\n  legend # wall solid #3a3a5c,  . floor #1b1b2a,  ~ water solid #2050c0,  + door solid #b45309\n  rows\n    "################"\n    "#..............#"\n    "#..~~~.........#"\n    "#..~~~...####..#"\n    "#........#.....#"\n    "#........#.....+"\n    "#####....#.....#"\n    "#........####..#"\n    "#..............#"\n    "################"\n  objects\n    hero 2,1\n    coin 13,2\n    coin 4,8\n    coin 11,5\n    coin 6,4\n\ncontrols pad: stick left, buttons A "beep", size 1.0, opacity 0.5\n';
(function(){var s=document.getElementById('example');if(s&&!s.querySelector('option[value="stage"]'))s.insertBefore(new Option('Stage','stage'),s.querySelector('option[value="memory"]')||s.querySelector('option[value="modules"]'))})();   /* Memory and Modules stay the last two */
// ── drawer tools ──
if(typeof _drawerRegister!=='function'){window._drawerTools=window._drawerTools||[];window._drawerRegister=function(t){window._drawerTools.push(t)}}
(function(){
  if(document.getElementById('stg-css'))return;
  var st=document.createElement('style');st.id='stg-css';
  st.textContent='.stg{font-family:var(--sans);color:var(--fg);font-size:13px;display:flex;flex-direction:column;gap:8px;max-width:100%;box-sizing:border-box;min-width:0}'
    +'.stg *{box-sizing:border-box}'
    +'.stg-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-width:0}'
    +'.stg-row label{font-size:11px;color:var(--fg2);display:flex;align-items:center;gap:4px}'
    +'.stg input,.stg select{background:var(--bg3);color:var(--fg);border:1px solid var(--bg5);border-radius:6px;padding:5px 6px;font:12px var(--mono);min-width:0;max-width:100%}'
    +'.stg input[type=number]{width:58px}.stg input[type=color]{width:34px;height:28px;padding:1px}.stg input[type=range]{width:120px;padding:0}'
    +'.stg button{background:var(--bg4);color:var(--fg);border:1px solid var(--bg5);border-radius:6px;padding:6px 9px;font:12px var(--sans);cursor:pointer;min-height:32px;touch-action:manipulation}'
    +'.stg button.on{border-color:var(--cyan);color:var(--cyan);background:rgba(45,212,191,.12)}'
    +'.stg button:disabled{opacity:.4}'
    +'.stg-brush{display:inline-flex;align-items:center;gap:5px}.stg-chip{width:14px;height:14px;border-radius:3px;border:1px solid rgba(255,255,255,.3);display:inline-block;flex:none}'
    +'.stg-view{position:relative;width:100%;height:min(52vh,420px);background:#05060a;border:1px solid var(--bg5);border-radius:8px;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none}'
    +'.stg-view canvas{position:absolute;left:0;top:0;width:100%;height:100%}'
    +'.stg-panel{background:var(--bg2);border:1px solid var(--bg5);border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:6px}'
    +'.stg-lg{display:flex;flex-wrap:wrap;gap:5px;align-items:center}.stg-lg input.ch{width:32px;text-align:center}.stg-lg input.nm{width:72px}.stg-lg select{max-width:80px}'
    +'.stg-msg{font:11px var(--mono);color:var(--fg2);white-space:pre-wrap;word-break:break-word}.stg-msg .bad{color:var(--red)}'
    +'.stg-phone{position:relative;width:100%;max-width:360px;height:220px;margin:0 auto;border-radius:14px;border:2px solid var(--bg5);overflow:hidden;background:linear-gradient(#1b1b2a,#0b0c14);touch-action:none}'
    +'.stg-shield{position:absolute;inset:0;z-index:30;cursor:grab}'
    +'.stg-read{font:12px var(--mono);color:var(--cyan)}';
  document.head.appendChild(st);
})();
function _stEl(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e}
function _stBtn(txt,fn,title){var b=_stEl('button',null,txt);b.type='button';if(title)b.title=title;b.onclick=fn;return b}
function _stBlockModel(kind,name,text){
  var bl=_stFindBlocks(String(text||'')).filter(function(b){return b.kind===kind&&b.name===name});
  if(!bl.length)bl=_stFindBlocks(String(text||'')).filter(function(b){return b.kind===kind&&String(b.name).toLowerCase()===String(name).toLowerCase()});   /* names are case-insensitive */
  if(!bl.length)return null;
  var b=bl[0];b.line=0;
  return kind==='map'?_stParseMap(b):_stParseControls(b);
}
function _stSpriteNames(ctx){try{return(ctx.blocks('sprite')||[]).map(function(b){return b.name})}catch(e){return[]}}
function _stUnique(base,taken){if(taken.indexOf(base)<0)return base;for(var i=2;;i++)if(taken.indexOf(base+i)<0)return base+i}
function _stHue(s){var h=0;for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))%360;return'hsl('+h+',70%,60%)'}
// A fresh map: walls around a floor, a hero.
function _stNewMap(name){
  var w=16,h=12,rows=[];
  for(var y=0;y<h;y++){var r='';for(var x=0;x<w;x++)r+=(x===0||y===0||x===w-1||y===h-1)?'#':'.';rows.push(r)}
  return{kind:'map',name:name,w:w,h:h,tile:16,tileSet:true,legend:[{ch:'#',name:'wall',solid:true,color:'#3a3a5c',sprite:null,extra:[]},{ch:'.',name:'floor',solid:false,color:'#1b1b2a',sprite:null,extra:[]}],inline:true,rows:rows,objects:[{kind:'hero',x:1,y:1,props:[]}],keep:[],problems:[],headExtra:[],locs:{}};
}

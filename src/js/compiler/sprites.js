// ═══ SPRITES ═══ pixel-art pictures written in the program text (compiler half; the runtime half is the
// "SPRITES" part of the runtime block: _spriteDraw, _spriteInfo, the __spr… imports).
//
//   sprite hero: 16x16, fps 8                    a top-level block: `sprite <name>:` in column 0 and every
//     palette 1a1c2c 5d275d b13e53 ef7d57        indented line after it. Rows are pictures: . is transparent,
//     frame idle                                 1-9 then a-z are palette colours 1-35 (6-digit hex, optional #;
//       "....1111........"                       no palette line = the default 16 colours). Frames are optional:
//       …16 rows…                                rows without a frame line are one unnamed frame.
//     frame walk1 rle ".4 14 .8/.16 *15"         Compact form (written for sprites wider than 64): rows split by
//                                                /, runs "<char><count>" split by spaces, "*N" = the row N times.
//
// Pipeline. `sprite` is not a keyword. The lexer wrapper finds sprite blocks in the raw text (outside comments and
// strings), parses them line by line (_sprParse, also used by the SPRITE tool) and blanks them out, so the token
// stream sees one IDENTIFIER token "sprite" carrying the parsed block; the parseTop wrapper turns it into a
// SpriteDecl (or throws the block's first error, with its exact line:col). The linker passes SpriteDecls through
// untouched: sprite names are project-wide and stay bare. _sprLower runs right after _rgLower (inside
// injectBuiltins, before builtins are injected): it numbers the sprites, turns a sprite name used as a value into
// its number (an int), and rewrites draw / drawEx / anim / spriteW / spriteH / blit calls into SpriteCall nodes
// (constant sprite and frame names are checked here, with positions). SpriteCalls compile to the __spr… imports.
// The pixels travel to the runtime as imports.spriteData (JSON), like imports.regionMeta.
// A program without sprite blocks is not touched at all (same bytes).
var _SPR_CHARS='.123456789abcdefghijklmnopqrstuvwxyz';
function _sprLum(h){h=String(h||'').replace('#','');if(h.length===3)h=h.replace(/./g,'$&$&');var n=parseInt(h,16);if(isNaN(n))return 1;return(0.2126*((n>>16)&255)+0.7152*((n>>8)&255)+0.0722*(n&255))/255}
var _SPR_DEFAULT_PAL=['1a1c2c','5d275d','b13e53','ef7d57','ffcd75','a7f070','38b764','257179','29366f','3b5dc9','41a6f6','73eff7','f4f4f4','94b0c2','566c86','333c57']; // "Sweetie 16"
var _SPR_MAX=256,_SPR_ROWS_MAX_W=64,_SPR_DEFAULT_FPS=8;
var _SPR_FNS={draw:1,drawEx:1,anim:1,spriteW:1,spriteH:1,blit:1};
_JS_CONV_IMPORTS.__sprDraw=[[['id','int'],['x','num'],['y','num'],['f','int'],['flip','bool'],['scale','num']],'void'];
_JS_CONV_IMPORTS.__sprFrame=[[['id','int'],['name','str']],'int'];   // frame index of a frame name; -1 (and a message once) if unknown
_JS_CONV_IMPORTS.__sprAnim=[[['id','int'],['t','num']],'int'];
_JS_CONV_IMPORTS.__sprSize=[[['id','int'],['which','int']],'int'];    // 0 width, 1 height
_JS_CONV_IMPORTS.__sprBlit=[[['id','int'],['f','int'],['rg','i32'],['x','num'],['y','num'],['w','int'],['pos','i32']],'bool'];
// Sprite blocks of a source text: [{name, start, end (0-based line indexes), lines}]. A block is a line
// `sprite <name>:` in column 0 outside comments and strings, plus every following indented line (blank lines
// inside belong to it when an indented line follows).
function _sprFindBlocks(src){
  src=String(src==null?'':src);
  if(!/sprite/i.test(src))return[];
  var lines=null;
  /* the shared block scanner (BLOCKS): the same extent as the drawer's helpers and every other block kind */
  return _emitScanBlocks(src,'sprite').filter(function(b){return b.kind==='sprite'}).map(function(b){
    lines=lines||src.split('\n');
    return{name:b.name,start:b.start,end:b.end,lines:lines.slice(b.start,b.end+1)};
  });
}
// Where a line's comment starts (// outside a "…" string), or -1.
function _sprCmtAt(s){var q=false;for(var i=0;i<s.length;i++){var c=s[i];if(c==='"')q=!q;else if(!q&&c==='/'&&s[i+1]==='/')return i}return -1}
// Run-length encoded rows: "<char><count>" runs split by spaces (count 1 may be left out), "*N" at the end of a
// row repeats it N times, rows split by /.  ".4 14 .8/.16 *3"  =  "....1111........" and three rows of 16 dots.
function _sprRleEncode(rows){
  var out=[];
  for(var i=0;i<rows.length;){
    var r=rows[i],n=1;while(i+n<rows.length&&rows[i+n]===r)n++;
    var toks=[];
    for(var k=0;k<r.length;){var c=r[k],m=1;while(k+m<r.length&&r[k+m]===c)m++;toks.push(m>1?c+m:c);k+=m}
    out.push(toks.join(' ')+(n>1?' *'+n:''));
    i+=n;
  }
  return out.join('/');
}
// → {rows:[{text, off}], err:{off, msg}|null}; off = index into s (for error columns)
function _sprRleDecode(s){
  var rows=[],parts=s.split('/'),at=0;
  for(var p=0;p<parts.length;p++){
    var part=parts[p],start=at;at+=part.length+1;
    if(!/\S/.test(part)){if(p===parts.length-1&&p>0)break;return{rows:rows,err:{off:start,msg:'Empty row in the compact (rle) form — every row between / needs runs such as .4 13'}}}
    var re=/\S+/g,m,row='',rep=1,repSeen=false;
    while((m=re.exec(part))){
      var tok=m[0],off=start+m.index;
      if(repSeen)return{rows:rows,err:{off:off,msg:'*N repeats the row and must come last in it'}};
      if(tok[0]==='*'){
        if(!/^\*\d+$/.test(tok)||+tok.slice(1)<1)return{rows:rows,err:{off:off,msg:'Expected *N (N at least 1) to repeat a row, got "'+tok+'"'}};
        rep=+tok.slice(1);repSeen=true;continue;
      }
      var cnt=tok.length>1?tok.slice(1):'1';
      if(!/^\d+$/.test(cnt)||+cnt<1)return{rows:rows,err:{off:off,msg:'Expected a run: a pixel and how many, e.g. .12 or a3 — got "'+tok+'"'}};
      if(+cnt>_SPR_MAX)return{rows:rows,err:{off:off,msg:'A run of '+cnt+' pixels is longer than a sprite can be wide ('+_SPR_MAX+')'}};
      row+=new Array(+cnt+1).join(tok[0]);
    }
    if(rep>_SPR_MAX)return{rows:rows,err:{off:start,msg:'*'+rep+' repeats a row more often than a sprite can be high ('+_SPR_MAX+')'}};
    for(var q=0;q<rep;q++)rows.push({text:row,off:start});
  }
  return{rows:rows,err:null};
}
// Parses one sprite block. lines: its text lines (header first); line0: the header's 1-based line number.
// tolerant=false (the compiler): every problem is an error. tolerant=true (the SPRITE tool): problems are still
// listed, but the result is always usable (short rows padded, unknown pixels transparent, unknown lines kept).
// → {name, w, h, fps, fpsGiven, palette:[hex6], palGiven, frames:[{name, data (w*h chars of _SPR_CHARS), rle,
//    rowCmt:[], extra:[lines], line}], extra:[lines before the first frame], headExtra:[options], errors:[{line,col,msg}],
//    loc:{line,col}, nameLoc:{line,col}}
function _sprParse(lines,line0,tolerant){
  var errors=[],head=String(lines[0]||'').replace(/\r$/,'');
  function E(ln,col,msg){errors.push({line:ln,col:col,msg:msg})}
  var hm=/^sprite([ \t]+)([A-Za-z_]\w*)([ \t]*):(.*)$/i.exec(head)||[head,' ','sprite','',''];
  var d={name:hm[2],w:0,h:0,fps:_SPR_DEFAULT_FPS,fpsGiven:false,palette:[],palGiven:false,frames:[],extra:[],headExtra:[],errors:errors,
    loc:{line:line0,col:1},nameLoc:{line:line0,col:7+hm[1].length}};
  // header: size and options after the colon
  var rest=hm[4],restCol=7+hm[1].length+hm[2].length+hm[3].length+1,ci=_sprCmtAt(rest);
  if(ci>=0)rest=rest.slice(0,ci);
  var parts=[],po=0;rest.split(',').forEach(function(s){parts.push({s:s,col:restCol+po+(s.length-s.replace(/^\s+/,'').length)});po+=s.length+1});
  var sz=/^(\s*)(\d+)(\s*[xX×]\s*)(\d+)\s*$/.exec(parts[0].s);
  if(!sz){E(line0,parts[0].s.trim()?parts[0].col:restCol,'Expected the size after sprite '+d.name+': — width x height, e.g. sprite '+d.name+': 16x16');d.w=d.h=16}
  else{
    d.w=+sz[2];d.h=+sz[4];
    var wcol=parts[0].col,hcol=parts[0].col+sz[2].length+sz[3].length;
    if(d.w<1||d.w>_SPR_MAX){E(line0,wcol,'A sprite is 1 to '+_SPR_MAX+' pixels wide, not '+d.w);d.w=Math.max(1,Math.min(_SPR_MAX,d.w))}
    if(d.h<1||d.h>_SPR_MAX){E(line0,hcol,'A sprite is 1 to '+_SPR_MAX+' pixels high, not '+d.h);d.h=Math.max(1,Math.min(_SPR_MAX,d.h))}
  }
  for(var pi=1;pi<parts.length;pi++){
    var o=parts[pi].s.trim(),fm=/^fps\s+(\d+(?:\.\d+)?)$/i.exec(o);
    if(fm&&+fm[1]>0&&+fm[1]<=240){d.fps=+fm[1];d.fpsGiven=true;continue}
    if(fm||/^fps\b/i.test(o))E(line0,parts[pi].col,'fps is the number of frames per second, more than 0 and at most 240 — e.g. fps 8');
    else E(line0,parts[pi].col,o?'Unknown sprite option "'+o+'" — after the size only fps N can follow (sprite '+d.name+': 16x16, fps 8)':'Expected an option after the comma — fps 8');
    if(o&&!/^fps\b/i.test(o))d.headExtra.push(o);
  }
  // body
  var cur=null,implicit=null,firstFrameLine=null,rleRows=null,palEntries=[];
  function newFrame(name,ln,rle,col){var f={name:name,rows:[],rle:rle,rowCmt:[],extra:[],line:ln,col:col||1};d.frames.push(f);return f}
  for(var li=1;li<lines.length;li++){
    var raw=String(lines[li]).replace(/\r$/,''),ln=line0+li;
    if(!/\S/.test(raw))continue;
    var ca=_sprCmtAt(raw),code=(ca>=0?raw.slice(0,ca):raw),cmt=ca>=0?raw.slice(ca):'';
    var ind=code.length-code.replace(/^\s+/,'').length,col=ind+1;code=code.trim();
    if(!code){(cur||implicit?(cur||implicit).extra:d.extra).push(raw);continue}
    var m;
    if((m=/^palette\b(.*)$/i.exec(code))){
      d.palGiven=true;
      var re=/\S+/g,pm;
      while((pm=re.exec(m[1]))){
        var hx=pm[0],pcol=col+7+pm.index;
        if(!/^#?[0-9a-fA-F]{6}$/.test(hx)){E(ln,pcol,'Expected a palette colour as 6 hex digits (rrggbb, # optional), got "'+hx+'"');continue}
        if(d.palette.length>=35){E(ln,pcol,'A palette has at most 35 colours (1-9 and a-z)');continue}
        d.palette.push(hx.replace('#','').toLowerCase());
      }
      continue;
    }
    if((m=/^frame\b(\s+([A-Za-z_]\w*))?(\s+rle\b)?\s*(.*)$/i.exec(code))||(m=/^(rle)\b\s*(.*)$/i.exec(code))){
      var isBareRle=String(m[1]).toLowerCase()==='rle'&&m.length===3,fname=isBareRle?'':(m[2]||''),rle=isBareRle||!!m[3],tail=isBareRle?m[2]:m[4];
      if(!isBareRle){
        if(firstFrameLine===null)firstFrameLine=ln;
        if(!m[1]){E(ln,col+5,'Expected a frame name after frame — frame idle');fname='frame'+(d.frames.length+1)}
        else if(d.frames.some(function(f){return f.name===fname})){E(ln,col+code.indexOf(fname,5),'Frame "'+fname+'" is already declared in sprite '+d.name);fname=fname+'_'+(d.frames.length+1)}
        else if(d.frames.some(function(f){return f.name&&f.name.toLowerCase()===fname.toLowerCase()})){var fo=d.frames.filter(function(f){return f.name&&f.name.toLowerCase()===fname.toLowerCase()})[0];E(ln,col+code.indexOf(fname,5),'Frame "'+fname+'" and frame "'+fo.name+'" (line '+fo.line+') differ only by case — names are case-insensitive: rename one of them');fname=fname+'_'+(d.frames.length+1)}
        cur=newFrame(fname,ln,rle,col);
      }else{
        if(!implicit)implicit=newFrame('',ln,true,col);
        cur=null;implicit.rle=true;
      }
      if(tail){
        var tq=/^"([^"]*)"$/.exec(tail),tcol=col+code.length-tail.length;
        if(!rle||!tq)E(ln,tcol,rle?'Expected the rows in quotes after rle — frame '+fname+' rle ".4 14 .8/…"':'Expected the end of the line after frame '+fname+' (rows go on the lines below, or write frame '+fname+' rle "…")');
        else addRle(cur||implicit,tq[1],ln,tcol+1);
      }
      if(cmt)(cur||implicit).cmt=cmt;
      continue;
    }
    if((m=/^"([^"]*)"$/.exec(code))){
      var tgt=cur||implicit;
      if(!tgt){tgt=implicit=newFrame('',ln,false,col)}
      if(tgt.rle)addRle(tgt,m[1],ln,col+1);
      else{tgt.rows.push({text:m[1],line:ln,col:col+1});tgt.rowCmt[tgt.rows.length-1]=cmt?cmt:''}
      continue;
    }
    if(!tolerant)E(ln,col,'Unknown line in sprite '+d.name+' — expected palette, frame or a row of pixels in quotes ("..12..")');
    else E(ln,col,'Kept as it is: an unknown line in sprite '+d.name);
    (cur||implicit?(cur||implicit).extra:d.extra).push(raw);
  }
  function addRle(f,s,ln,col0){
    var r=_sprRleDecode(s);
    r.rows.forEach(function(x){f.rows.push({text:x.text,line:ln,col:col0+x.off})});
    if(r.err)E(ln,col0+r.err.off,r.err.msg);
  }
  if(implicit&&firstFrameLine!==null){
    E(firstFrameLine,1,'Sprite '+d.name+' has rows before its first frame line — put them under a frame line (frame idle), or remove the frame lines');
    if(tolerant){implicit.name='frame0';var k0=0;while(d.frames.some(function(f,i){return f!==implicit&&f.name===implicit.name})){implicit.name='frame'+(++k0)}}
  }
  if(!d.palGiven)d.palette=_SPR_DEFAULT_PAL.slice();
  if(!d.frames.length){E(line0,1,'Sprite '+d.name+' has no pixels — add rows of pixels in quotes ("..12..") or frame lines');d.frames.push({name:'',rows:[],rle:false,rowCmt:[],extra:[],line:line0})}
  // rows → pixel data, checked
  var npal=d.palette.length;
  d.frames.forEach(function(f){
    var data='',what=f.name?'frame '+f.name:'sprite '+d.name;
    if(f.rows.length!==d.h&&f.rows.length)E(f.rows.length>d.h?f.rows[d.h].line:f.line,f.rows.length>d.h?f.rows[d.h].col-(f.rle?0:1):f.col,(f.name?'Frame '+f.name:'Sprite '+d.name)+' has '+f.rows.length+' row'+(f.rows.length===1?'':'s')+', but '+(f.name?'sprite '+d.name:'it')+' is '+d.h+' high');
    else if(!f.rows.length&&f.name)E(f.line,f.col,'Frame '+f.name+' has no rows — sprite '+d.name+' is '+d.w+'x'+d.h+': add '+d.h+' rows in quotes below it');
    for(var r=0;r<d.h;r++){
      var row=f.rows[r],t=row?row.text:'';
      if(row&&t.length!==d.w)E(row.line,row.col-(f.rle?0:1),'Row '+(r+1)+' of '+what+' has '+t.length+' pixel'+(t.length===1?'':'s')+', but '+(f.name?'sprite '+d.name:'it')+' is '+d.w+' wide');
      for(var x=0;x<d.w;x++){
        var c=x<t.length?t[x]:'.',v=_SPR_CHARS.indexOf(c);
        if(v<0){
          if(row&&!f.rle)E(row.line,row.col+x,'Unknown pixel "'+c+'" — use . (transparent), 1-9 or a-z (palette colours 1-35)'+(/[A-Z]/.test(c)?': palette letters are lower case':''));
          else if(row)E(row.line,row.col,'Unknown pixel "'+c+'" — use . (transparent), 1-9 or a-z (palette colours 1-35)');
          c='.';
        }else if(v>npal){
          if(row)E(row.line,row.col+(f.rle?0:x),'Pixel "'+c+'" is palette colour '+v+', but the palette of sprite '+d.name+' has '+npal+' colour'+(npal===1?'':'s'));
          c='.';
        }
        data+=c;
      }
    }
    f.data=data;
    delete f.rows;
  });
  errors.sort(function(a,b){return a.line-b.line||a.col-b.col});
  return d;
}
// The block text for a sprite (the SPRITE tool writes this). d as _sprParse returns it (frames with .data).
// Rows are written as pictures up to 64 pixels wide; wider sprites use the compact rle form (one line per frame).
function _sprFormat(d){
  var out=['sprite '+d.name+': '+d.w+'x'+d.h+(d.frames.length>1||d.fpsGiven?', fps '+(+d.fps||_SPR_DEFAULT_FPS):'')+(d.headExtra||[]).map(function(o){return', '+o}).join('')];
  for(var i=0;i<d.palette.length;i+=8)out.push('  palette '+d.palette.slice(i,i+8).join(' '));
  (d.extra||[]).forEach(function(l){out.push(l)});
  var rle=d.w>_SPR_ROWS_MAX_W,single=d.frames.length===1&&!d.frames[0].name;
  d.frames.forEach(function(f){
    var rows=[];for(var y=0;y<d.h;y++)rows.push(f.data.substr(y*d.w,d.w));
    var ind=single?'  ':'    ';
    var fc=f.cmt?'  '+f.cmt:'';
    if(rle)out.push((single?'  rle "':'  frame '+f.name+' rle "')+_sprRleEncode(rows)+'"'+fc);
    else{
      if(!single)out.push('  frame '+f.name+fc);
      rows.forEach(function(r,y){out.push(ind+'"'+r+'"'+(f.rowCmt&&f.rowCmt[y]?'  '+f.rowCmt[y]:''))});
    }
    (f.extra||[]).forEach(function(l){out.push(l)});
  });
  return out.join('\n');
}
// ── syntax ──
(function(){
  var tk0=Lexer.prototype.tokenize,P=Parser.prototype,top0=P.parseTop,stmt0=P.parseStmt;
  Lexer.prototype.tokenize=function(){
    var bl=_sprFindBlocks(this.s);
    if(!bl.length)return tk0.call(this);
    var lines=String(this.s).split('\n');
    bl.forEach(function(b){for(var i=b.start;i<=b.end;i++)lines[i]=lines[i].replace(/[^\r]/g,' ')});
    this.s=lines.join('\n');
    var ts=tk0.call(this);
    bl.forEach(function(b){
      var ln=b.start+1,tok=new Token(TT.IDENTIFIER,'sprite',ln,1);
      tok.sprite=_sprParse(b.lines,ln,false);
      var at=0;while(at<ts.length&&ts[at].type!==TT.EOF&&ts[at].line<=ln)at++;
      ts.splice(at,0,tok);
    });
    return ts;
  };
  P.parseTop=function(){
    var t=this.cur();
    if(t&&t.sprite){
      this.adv();
      var d=t.sprite;
      if(d.errors.length){var e=d.errors[0];throw new Error(e.line+':'+e.col+': '+e.msg)}
      return{type:'SpriteDecl',name:d.name,w:d.w,h:d.h,fps:d.fps,palette:d.palette.slice(),frames:d.frames.map(function(f){return{name:f.name,data:f.data}}),loc:{line:d.loc.line,col:1},nameLoc:{line:d.nameLoc.line,col:d.nameLoc.col}};
    }
    return top0.call(this);
  };
  P.parseStmt=function(){
    var t=this.cur();
    if(t&&t.sprite)throw this.err('sprite declarations belong at the top level of a file, not inside a function — is a } missing above?');
    return stmt0.call(this);
  };
})();
// ── lowering: numbers for sprite names, SpriteCall nodes (runs after _rgLower, before the builtins are injected) ──
function _sprTake(ast){
  var S=[],b=ast.body;
  for(var i=0;i<b.length;i++)if(b[i]&&b[i].type==='SpriteDecl')S.push(b[i]);
  if(!S.length)return null;
  ast.body=b.filter(function(n){return!(n&&n.type==='SpriteDecl')});
  return S;
}
_rgLower=(function(lower){return function(ast){
  var S=_sprTake(ast),r=lower.apply(this,arguments);
  if(S)_sprLower(ast,S);
  return r;
}})(_rgLower);
function _sprLower(ast,S){
  function fail(msg,loc){throw new Error((loc&&loc.file?loc.file+':':'')+(loc?(loc.line||1)+':'+(loc.col||1)+': ':'')+msg)}
  function where(loc){return(loc&&loc.file?loc.file+':':'line ')+((loc&&loc.line)||1)}
  var byName=new Map(),list=[];
  S.forEach(function(d){
    var o=byName.get(d.name);
    if(o)fail('Sprite "'+d.name+'" is already declared at '+where(o.loc)+' — every sprite of the project needs its own name',d.nameLoc&&{file:d.loc.file,line:d.nameLoc.line,col:d.nameLoc.col});
    d.id=list.length;byName.set(d.name,d);list.push(d);
  });
  var fns=new Set(),globals=new Set();
  ast.body.forEach(function(n){
    if(n.type==='FunctionDecl'||n.type==='ImportDecl')fns.add(n.name);
    if(n.type==='VarDecl')globals.add(n.name);
    var sp=n.name&&byName.get(n.name);
    if(sp&&/^(FunctionDecl|VarDecl|StructDecl|RegionDecl|ImportDecl)$/.test(n.type)&&!(n.type==='RegionDecl'&&/(^|\.)__lgT_/.test(String(n.elem)))){   /* a thing's region (LOGIC) may share its sprite's name */
      var what={FunctionDecl:'a function',VarDecl:'a variable',StructDecl:'a struct',RegionDecl:'a region',ImportDecl:'an import fn'}[n.type];
      fail('The name "'+n.name+'" is a sprite and also '+what+' (at '+where(n.loc)+') — sprite names are seen by every file, so rename one of them',{file:sp.loc.file,line:sp.nameLoc.line,col:sp.nameLoc.col});
    }
  });
  var names=list.map(function(d){return d.name});
  function hint(n){var c=_emitModClosest(n,names);return c?' — did you mean "'+c+'"?':''}
  var scopes=[new Set()],seen=new Set(),fnParams=[];
  function isVar(n){for(var i=scopes.length-1;i>=0;i--)if(scopes[i].has(n))return true;return globals.has(n)}
  function def(n){scopes[scopes.length-1].add(n)}
  function sprOf(e){return e&&e.type==='IdentifierExpr'&&byName.has(e.name)&&!isVar(e.name)?byName.get(e.name):null}
  function asInt(e,v){var o=e;for(var k in o)if(k!=='loc')delete o[k];o.type='IntLiteral';o.value=String(v);return o}
  function frameList(d){return d.frames.map(function(f){return f.name?'"'+f.name+'"':'(unnamed)'}).join(', ')}
  // the sprite argument: {node, d (constant sprite or null)}
  function sprArg(a,fn,L){
    if(!a)fail(fn+' needs a sprite as its first argument',L);
    if(a.type==='StringLiteral'){
      var ds=byName.get(a.value);
      if(!ds)fail('Unknown sprite "'+a.value+'"'+hint(a.value),a.loc||L);
      return{node:asInt(a,ds.id),d:ds};
    }
    if(a.type==='IdentifierExpr'){
      var d=sprOf(a);
      if(d)return{node:asInt(a,d.id),d:d};
      if(!isVar(a.name)&&!fns.has(a.name))fail('Unknown sprite "'+a.name+'"'+hint(a.name)+(list.length?'':' — declare one: sprite '+a.name+': 16x16'),a.loc||L);
    }
    if(a.type==='RegionOp')fail(fn+' needs a sprite as its first argument, not a region',a.loc||L);
    X(a);
    return{node:a,d:null};
  }
  // a constant frame argument is checked against a constant sprite
  function frameArg(f,d,fn,L){
    if(!f)return null;
    if(d&&f.type==='StringLiteral'){
      var i=-1;d.frames.forEach(function(x,k){if(i<0&&x.name&&x.name.toLowerCase()===String(f.value).toLowerCase())i=k});
      if(i<0){var c=_emitModClosest(f.value,d.frames.map(function(x){return x.name}).filter(Boolean));fail('Sprite '+d.name+' has no frame "'+f.value+'"'+(c?' — did you mean "'+c+'"?':' — its frames: '+frameList(d)),f.loc||L)}
      return asInt(f,i);
    }
    var v=_rgTryFold(f);
    if(d&&v!==null&&(v<0||v>=d.frames.length))fail('Sprite '+d.name+' has '+d.frames.length+' frame'+(d.frames.length===1?'':'s')+' (0'+(d.frames.length>1?' … '+(d.frames.length-1):'')+'), not frame '+v,f.loc||L);
    X(f);
    return f;
  }
  function call(e){
    var nm=e.callee.name,a=e.args,L=e.loc;
    function argc(n,m,usage){if(a.length<n||a.length>m)fail(nm+' takes '+usage,L)}
    var node={type:'SpriteCall',op:nm,loc:L},s;
    switch(nm){
      case'draw':
        argc(3,4,'a sprite, x and y, and optionally a frame: draw(hero, 10, 20) or draw(hero, 10, 20, "walk1")');
        s=sprArg(a[0],nm,L);node.spr=s.node;node.frame=frameArg(a[3],s.d,nm,L);X(a[1]);X(a[2]);node.x=a[1];node.y=a[2];break;
      case'drawEx':
        argc(4,6,'a sprite, x, y, a frame, flipX and scale: drawEx(hero, 10, 20, 0, true, 2.0)');
        s=sprArg(a[0],nm,L);node.spr=s.node;node.frame=frameArg(a[3],s.d,nm,L);X(a[1]);X(a[2]);node.x=a[1];node.y=a[2];
        if(a[4]){X(a[4]);node.flip=a[4]}
        if(a[5]){X(a[5]);node.scale=a[5]}
        break;
      case'anim':
        argc(2,2,'a sprite and a time in seconds: anim(hero, t) — the frame number at t');
        s=sprArg(a[0],nm,L);node.spr=s.node;X(a[1]);node.t=a[1];
        break;
      case'spriteW':case'spriteH':
        argc(1,1,'one sprite: '+nm+'(hero)');
        s=sprArg(a[0],nm,L);node.spr=s.node;
        if(s.d)return asInt(e,nm==='spriteW'?s.d.w:s.d.h);
        break;
      case'blit':{
        argc(6,6,'a sprite, a frame, a u8 region, x, y and the width of the picture in the region: blit(hero, 0, fb, 10, 20, 160)');
        s=sprArg(a[0],nm,L);node.spr=s.node;node.frame=frameArg(a[1],s.d,nm,L);
        var r=a[2],el=null;
        if(r&&r.type==='RegionOp'&&r.op==='view'&&r.auto){
          var rname=r.rg.name;
          if(r.rg.k==='static'){var R=ast.rgInfo&&ast.rgInfo.regions[r.rg.id];el=R?R.elem:null;rname=R&&(R.src||R.name)}
          else for(var pi=fnParams.length-1;pi>=0&&el===null;pi--){var pp=fnParams[pi]&&fnParams[pi].get(r.rg.name);if(pp)el=pp}
          if(el!=='u8')fail('blit needs a u8 region (4 bytes per pixel, as screen shows it), but '+(rname||'this region')+' holds '+el,(r.loc||L));
          node.rg=r.rg;
        }else fail('blit copies into a u8 region: its third argument is the region\'s name (region fb: u8[160 * 120 * 4])',(r&&r.loc)||L);
        X(a[3]);X(a[4]);X(a[5]);node.x=a[3];node.y=a[4];node.w=a[5];
        var w0=_rgTryFold(a[5]);if(w0!==null&&w0<1)fail('blit: the width of the picture in the region must be at least 1',a[5].loc||L);
        break;
      }
    }
    for(var k in e)if(k!=='loc')delete e[k];
    for(var k2 in node)e[k2]=node[k2];
    return e;
  }
  function X(x){
    if(!x||typeof x!=='object'||seen.has(x))return;
    seen.add(x);
    if(Array.isArray(x)){x.forEach(X);return}
    switch(x.type){
      case'IdentifierExpr':{var d=sprOf(x);if(d)asInt(x,d.id);return}
      case'CallExpr':{
        var c=x.callee;
        if(c&&c.type==='IdentifierExpr'&&_SPR_FNS[c.name]&&!fns.has(c.name)&&!isVar(c.name)){call(x);return}
        if(c&&c.type==='IdentifierExpr'){seen.add(c);if(sprOf(c))fail('"'+c.name+'" is a sprite, not a function — draw it: draw('+c.name+', x, y)',c.loc||x.loc)}
        else X(c);
        x.args.forEach(X);return;
      }
      case'MemberExpr':if(sprOf(x.object))fail('"'+x.object.name+'" is a sprite — it has no members. Use spriteW('+x.object.name+'), spriteH('+x.object.name+'), anim('+x.object.name+', t)',x.object.loc||x.loc);break;
      case'AssignExpr':if(sprOf(x.target))fail('"'+x.target.name+'" is a sprite — it cannot be assigned',x.target.loc||x.loc);break;
      case'BlockStmt':scopes.push(new Set());x.statements.forEach(X);scopes.pop();return;
      case'ForStmt':scopes.push(new Set());X(x.init);X(x.condition);X(x.update);X(x.body);scopes.pop();return;
      case'VarDecl':X(x.init);def(x.name);return;
      case'WithStmt':X(x.target);scopes.push(new Set());def(x.alias);X(x.body);scopes.pop();return;
    }
    for(var k in x){if(k==='loc')continue;var v=x[k];if(v&&typeof v==='object')X(v)}
  }
  ast.body.forEach(function(n){
    if(n.type==='FunctionDecl'){
      scopes=[new Set()];var pm=new Map();fnParams=[pm];
      n.params.forEach(function(p){def(p.name);var el=_rgParamElem(p.type);if(el)pm.set(p.name,el)});
      X(n.body);
    }else if(n.type==='VarDecl'){scopes=[new Set()];X(n.init)}
  });
  ast.sprites=list.map(function(d){return{name:d.name,w:d.w,h:d.h,fps:d.fps,palette:d.palette,frames:d.frames,path:(d.loc&&d.loc.file)||null,line:d.loc&&d.loc.line}});
}
// ── types ──
(function(){
  var P=TypeAnnotator.prototype,a0=P.a,C=TypeChecker.prototype,inf0=C.inf;
  P.a=function(e){
    if(!e||e.type!=='SpriteCall')return a0.call(this,e);
    var self=this;
    function num(x,what){var t=self.a(x);if(t==='js')self.conv(x,'num');else if(!(self.isI(t)||self.isN(t)))self.fail(e.op+': '+what+' must be a number, but this is '+t,x.loc||e.loc)}
    function int(x,what){var t=self.a(x);if(t==='js')self.conv(x,'int');else if(!self.isI(t))self.fail(e.op+': '+what+' must be an int, but this is '+t+(self.isN(t)?' — round it first, e.g. floor(x)':''),x.loc||e.loc)}
    int(e.spr,'the sprite (a sprite name or its number)');
    if(e.frame){
      var ft=this.a(e.frame);
      if(ft==='str'){e.frameStr=true;this.need('__sprFrame')}
      else if(ft==='js')this.conv(e.frame,'int');
      else if(!this.isI(ft))this.fail(e.op+': the frame must be a frame number (int) or a frame name in quotes, but this is '+ft,e.frame.loc||e.loc);
    }
    if(e.x)num(e.x,'x');
    if(e.y)num(e.y,'y');
    if(e.scale)num(e.scale,'the scale');
    if(e.t)num(e.t,'the time (seconds)');
    if(e.flip){var bt=this.a(e.flip);if(bt==='js')this.conv(e.flip,'bool');else if(bt!=='bool')this.fail(e.op+': flipX must be true or false, but this is '+bt,e.flip.loc||e.loc)}
    if(e.w)int(e.w,'the width of the picture in the region');
    var t='void';
    switch(e.op){
      case'draw':case'drawEx':this.need('__sprDraw');break;
      case'anim':this.need('__sprAnim');t='int';break;
      case'spriteW':case'spriteH':this.need('__sprSize');t='int';break;
      case'blit':this.need('__sprBlit');break;
    }
    e.exprType=t;
    return t;
  };
  C.inf=function(e){
    if(e&&e.type==='SpriteCall'){
      var self=this;
      ['spr','frame','x','y','scale','t','flip','w'].forEach(function(k){if(e[k])self.inf(e[k])});
      return e.exprType;
    }
    return inf0.call(this,e);
  };
})();
// ── code generation ──
(function(){
  var P=WasmCodegen.prototype,nat0=P.genNatural,res0=P.exprResType,gen0=P.generate;
  function isI(t){return t==='int'||t==='i64'}
  P._sprNum=function(x){if(isI(x.exprType)){this.genExpr(x,'int');this.emit(0xB9)}else this.genExpr(x,'num')};
  // pushes the frame index (i64); a frame name (str) is looked up at run time with the sprite id kept in a local
  P._sprFrame=function(e,idLocal){
    if(!e.frame){this.emit(Op.i64_const,...ei64(0));return}
    if(!e.frameStr){this.genExpr(e.frame,'int');return}
    this.emit(Op.local_get,...eu32(idLocal));
    this.genExpr(e.frame,'str');
    this.jsImportCall('__sprFrame');
  };
  P._sprId=function(e){
    var d=this._sprDepth=(this._sprDepth||0)+1,li=-1;
    this.genExpr(e.spr,'int');
    if(e.frameStr){var n='_spr$'+d;li=this.getLocal(n);if(li<0)li=this.addLocal(n,'int');this.emit(Op.local_tee,...eu32(li))}
    return li;
  };
  P.genNatural=function(e,exp){
    if(!e||e.type!=='SpriteCall')return nat0.call(this,e,exp);
    var li;
    try{
      switch(e.op){
        case'draw':case'drawEx':
          li=this._sprId(e);
          this._sprNum(e.x);this._sprNum(e.y);
          this._sprFrame(e,li);
          if(e.flip)this.genExpr(e.flip,'bool');else this.emit(Op.i32_const,...ei32(0));
          if(e.scale)this._sprNum(e.scale);else this.emit(Op.f64_const,...ef64(1));
          this.jsImportCall('__sprDraw');
          return;
        case'anim':
          this.genExpr(e.spr,'int');this._sprNum(e.t);this.jsImportCall('__sprAnim');
          this._rgCoerce('int',exp);return;
        case'spriteW':case'spriteH':
          this.genExpr(e.spr,'int');this.emit(Op.i64_const,...ei64(e.op==='spriteW'?0:1));this.jsImportCall('__sprSize');
          this._rgCoerce('int',exp);return;
        case'blit':
          li=this._sprId(e);
          this._sprFrame(e,li);
          this._rgDesc(e.rg);
          this._sprNum(e.x);this._sprNum(e.y);
          this.genExpr(e.w,'int');
          this.emit(Op.i32_const,...ei32(this._rgPos(e.loc)));
          this.jsImportCall('__sprBlit');
          this.emit(Op.if,0x40);this.genAfterThrow();this.emit(Op.end);
          return;
      }
    }finally{if(e.op==='draw'||e.op==='drawEx'||e.op==='blit')this._sprDepth--}
  };
  P.exprResType=function(e){
    if(e&&e.type==='SpriteCall')return(e.op==='anim'||e.op==='spriteW'||e.op==='spriteH')?'int':'void';
    return res0.call(this,e);
  };
  P.generate=function(){
    this._sprDepth=0;
    var w=gen0.apply(this,arguments),L=this.ast&&this.ast.sprites;
    if(L&&L.length)this.imports.spriteData=JSON.stringify({v:1,sprites:L.map(function(d){return{name:d.name,w:d.w,h:d.h,fps:d.fps,palette:d.palette,frames:d.frames.map(function(f){return{name:f.name,data:f.data}})}})});
    return w;
  };
})();
// The compile result: r.sprites = [{name, w, h, fps, frames: [names], path, line}] (empty without sprites).
compile=(function(c){return function(source,target){
  var r=c.apply(this,arguments),L=r&&r.ast&&r.ast.sprites;
  if(r)r.sprites=(L||[]).map(function(d){return{name:d.name,w:d.w,h:d.h,fps:d.fps,frames:d.frames.map(function(f){return f.name}),path:d.path,line:d.line}});
  return r;
}})(compile);
// _emitModuleIndex: structs and regions of a parsed module (names as written; length null when not constant).
function _rgIndexOf(m){
  var out={structs:[],regions:[]};
  if(!m||!m.ast)return out;
  m.ast.body.forEach(function(n){
    if(n.type==='StructDecl')out.structs.push({name:n.name,public:!!n.isPublic,fields:n.fields.map(function(f){var c=f.count?_rgTryFold(f.count):null;return{name:f.name,type:f.type+(f.count?'['+(c===null?'?':c)+']':'')}})});
    else if(n.type==='RegionDecl')out.regions.push({name:n.name,public:!!n.isPublic,elem:n.elem,length:_rgTryFold(n.size)});
  });
  return out;
}
// Index / module-table entries always have .structs and .regions; they are enumerable (and so part of the
// JSON) only when the module declares any — entries of programs without them stay exactly as they were.
function _rgIndexAttach(e,rx){
  ['structs','regions'].forEach(function(k){var v=rx[k]||[];Object.defineProperty(e,k,{value:v,enumerable:v.length>0,writable:true,configurable:true})});
  return e;
}

// ═══ EMIT COMPILER v0.4 — int/num + imports ═══
const TT={INTEGER:'INTEGER',FLOAT:'FLOAT',STRING:'STRING',BOOLEAN:'BOOLEAN',NULL:'NULL',IDENTIFIER:'IDENTIFIER',KEYWORD:'KEYWORD',TYPE:'TYPE',PLUS:'PLUS',MINUS:'MINUS',STAR:'STAR',SLASH:'SLASH',PERCENT:'PERCENT',AMP:'AMP',PIPE:'PIPE',CARET:'CARET',TILDE:'TILDE',SHL:'SHL',SHR:'SHR',AND:'AND',OR:'OR',NOT:'NOT',EQ:'EQ',NEQ:'NEQ',LT:'LT',GT:'GT',LTE:'LTE',GTE:'GTE',ASSIGN:'ASSIGN',QUESTION:'QUESTION',NULLCOALESCE:'NULLCOALESCE',ARROW:'ARROW',DOT:'DOT',LPAREN:'LPAREN',RPAREN:'RPAREN',LBRACE:'LBRACE',RBRACE:'RBRACE',LBRACKET:'LBRACKET',RBRACKET:'RBRACKET',SEMICOLON:'SEMICOLON',COLON:'COLON',COMMA:'COMMA',PLUSPLUS:'PLUSPLUS',MINUSMINUS:'MINUSMINUS',PLUSEQ:'PLUSEQ',MINUSEQ:'MINUSEQ',STAREQ:'STAREQ',SLASHEQ:'SLASHEQ',EOF:'EOF'};
const KW=new Set(['fn','let','mut','const','return','if','else','while','for','class','interface','implements','new','this','export','import','from','as','break','continue','use']);
const TY=new Set(['i32','i64','f32','f64','bool','void','int','num','str','js']);
class Token{constructor(t,v,l,c){this.type=t;this.value=v;this.line=l;this.col=c}toString(){return this.type+'('+this.value+') @'+this.line+':'+this.col}}
class Lexer{constructor(s){this.s=s;this.p=0;this.line=1;this.col=1;this.tokens=[]}peek(){return this.p<this.s.length?this.s[this.p]:'\0'}adv(){const c=this.s[this.p++];if(c==='\n'){this.line++;this.col=1}else this.col++;return c}la(n=1){return this.p+n<this.s.length?this.s[this.p+n]:'\0'}skip(){while(this.p<this.s.length){const c=this.peek();if(' \t\r\n'.includes(c)){this.adv();continue}if(c==='/'&&this.la()==='/'){while(this.p<this.s.length&&this.peek()!=='\n')this.adv();continue}if(c==='/'&&this.la()==='*'){this.adv();this.adv();while(this.p<this.s.length){if(this.peek()==='*'&&this.la()==='/'){this.adv();this.adv();break}this.adv()}continue}break}}num(){const sl=this.line,sc=this.col;let n='',f=false;if(this.peek()==='0'&&'xX'.includes(this.la())){n+=this.adv();n+=this.adv();while(/[0-9a-fA-F_]/.test(this.peek())){const c=this.adv();if(c!=='_')n+=c}return new Token(TT.INTEGER,n,sl,sc)}while(/[0-9_]/.test(this.peek())){const c=this.adv();if(c!=='_')n+=c}if(this.peek()==='.'&&/[0-9]/.test(this.la())){f=true;n+=this.adv();while(/[0-9_]/.test(this.peek())){const c=this.adv();if(c!=='_')n+=c}}if('eE'.includes(this.peek())){f=true;n+=this.adv();if('+-'.includes(this.peek()))n+=this.adv();while(/[0-9]/.test(this.peek()))n+=this.adv()}return new Token(f?TT.FLOAT:TT.INTEGER,n,sl,sc)}str(){const sl=this.line,sc=this.col,q=this.adv();let s='';while(this.p<this.s.length&&this.peek()!==q){if(this.peek()==='\\'){this.adv();const e=this.adv();s+=({n:'\n',t:'\t',r:'\r','\\':'\\','0':'\0'}[e]||e)}else s+=this.adv()}if(this.p<this.s.length)this.adv();return new Token(TT.STRING,s,sl,sc)}id(){const sl=this.line,sc=this.col;let i='';while(/[a-zA-Z0-9_]/.test(this.peek()))i+=this.adv();if(i==='true'||i==='false')return new Token(TT.BOOLEAN,i,sl,sc);if(i==='null')return new Token(TT.NULL,i,sl,sc);if(TY.has(i))return new Token(TT.TYPE,i,sl,sc);if(KW.has(i))return new Token(TT.KEYWORD,i,sl,sc);return new Token(TT.IDENTIFIER,i,sl,sc)}tokenize(){while(this.p<this.s.length){this.skip();if(this.p>=this.s.length)break;const c=this.peek(),sl=this.line,sc=this.col;if(/[0-9]/.test(c)){this.tokens.push(this.num());continue}if(c==='"'||c==="'"){this.tokens.push(this.str());continue}if(/[a-zA-Z_]/.test(c)){this.tokens.push(this.id());continue}const tw=c+this.la();const tm={'->':TT.ARROW,'==':TT.EQ,'!=':TT.NEQ,'<=':TT.LTE,'>=':TT.GTE,'&&':TT.AND,'||':TT.OR,'<<':TT.SHL,'>>':TT.SHR,'??':TT.NULLCOALESCE,'++':TT.PLUSPLUS,'--':TT.MINUSMINUS,'+=':TT.PLUSEQ,'-=':TT.MINUSEQ,'*=':TT.STAREQ,'/=':TT.SLASHEQ};if(tm[tw]){this.adv();this.adv();this.tokens.push(new Token(tm[tw],tw,sl,sc));continue}this.adv();const om={'+':TT.PLUS,'-':TT.MINUS,'*':TT.STAR,'/':TT.SLASH,'%':TT.PERCENT,'&':TT.AMP,'|':TT.PIPE,'^':TT.CARET,'~':TT.TILDE,'!':TT.NOT,'<':TT.LT,'>':TT.GT,'=':TT.ASSIGN,'?':TT.QUESTION,'.':TT.DOT,'(':TT.LPAREN,')':TT.RPAREN,'{':TT.LBRACE,'}':TT.RBRACE,'[':TT.LBRACKET,']':TT.RBRACKET,';':TT.SEMICOLON,':':TT.COLON,',':TT.COMMA};if(om[c])this.tokens.push(new Token(om[c],c,sl,sc));else throw new Error("Unexpected '"+c+"' at "+sl+":"+sc)}this.tokens.push(new Token(TT.EOF,'',this.line,this.col));return this.tokens}}
// `js` is a type word only where a type can stand (after `:`, `)` or `->`); anywhere else it stays an
// ordinary identifier, so programs with a variable or library global called `js` keep compiling.
(function(){
  var tokenize0=Lexer.prototype.tokenize;
  Lexer.prototype.tokenize=function(){
    var ts=tokenize0.call(this);
    for(var i=0;i<ts.length;i++){
      if(ts[i].type!==TT.TYPE||ts[i].value!=='js')continue;
      var pt=i>0?ts[i-1].type:null;
      if(pt!==TT.COLON&&pt!==TT.RPAREN&&pt!==TT.ARROW)ts[i].type=TT.IDENTIFIER;
    }
    return ts;
  };
})();
// AST
class Z{constructor(t,l){this.type=t;this.loc=l}}class Program extends Z{constructor(b){super('Program',b[0]?.loc);this.body=b}}class FunctionDecl extends Z{constructor(n,p,r,b,e,l){super('FunctionDecl',l);this.name=n;this.params=p;this.returnType=r;this.body=b;this.exported=e}}class VarDecl extends Z{constructor(n,t,i,m,l){super('VarDecl',l);this.name=n;this.varType=t;this.init=i;this.mutable=m}}class ImportDecl extends Z{constructor(n,p,r,mod,l){super('ImportDecl',l);this.name=n;this.params=p;this.returnType=r;this.module=mod}}class BlockStmt extends Z{constructor(s,l){super('BlockStmt',l);this.statements=s}}class ReturnStmt extends Z{constructor(v,l){super('ReturnStmt',l);this.value=v}}class IfStmt extends Z{constructor(c,t,a,l){super('IfStmt',l);this.condition=c;this.consequent=t;this.alternate=a}}class WhileStmt extends Z{constructor(c,b,l){super('WhileStmt',l);this.condition=c;this.body=b}}class ForStmt extends Z{constructor(i,c,u,b,l){super('ForStmt',l);this.init=i;this.condition=c;this.update=u;this.body=b}}class ExprStmt extends Z{constructor(e,l){super('ExprStmt',l);this.expression=e}}class BreakStmt extends Z{constructor(l){super('BreakStmt',l)}}class ContinueStmt extends Z{constructor(l){super('ContinueStmt',l)}}class BinaryExpr extends Z{constructor(o,l,r,loc){super('BinaryExpr',loc);this.op=o;this.left=l;this.right=r}}class UnaryExpr extends Z{constructor(o,e,l){super('UnaryExpr',l);this.op=o;this.operand=e}}class CallExpr extends Z{constructor(c,a,l){super('CallExpr',l);this.callee=c;this.args=a}}class MemberExpr extends Z{constructor(o,p,l){super('MemberExpr',l);this.object=o;this.property=p}}class AssignExpr extends Z{constructor(t,v,l){super('AssignExpr',l);this.target=t;this.value=v}}class IdentifierExpr extends Z{constructor(n,l){super('IdentifierExpr',l);this.name=n}}class IntLiteral extends Z{constructor(v,l){super('IntLiteral',l);this.value=v}}class FloatLiteral extends Z{constructor(v,l){super('FloatLiteral',l);this.value=v}}class BoolLiteral extends Z{constructor(v,l){super('BoolLiteral',l);this.value=v}}class NullLiteral extends Z{constructor(l){super('NullLiteral',l)}}
class StringLiteral extends Z{constructor(v,l){super('StringLiteral',l);this.value=v}}
class ArrayLiteral extends Z{constructor(elements,l){super('ArrayLiteral',l);this.elements=elements}}
class NewExpr extends Z{constructor(c,a,l){super('NewExpr',l);this.callee=c;this.args=a}}
// PARSER with import support
class Parser{constructor(t){this.t=t;this.p=0}cur(){return this.t[this.p]}adv(){return this.t[this.p++]}expect(type,val){const t=this.cur();if(t.type!==type||(val!==undefined&&t.value!==val))throw this.err('Expected '+type+(val?'('+val+')':'')+', got '+t.type+'('+t.value+')');return this.adv()}match(type,val){const t=this.cur();if(t.type===type&&(val===undefined||t.value===val))return this.adv();return null}check(type,val){const t=this.cur();return t.type===type&&(val===undefined||t.value===val)}err(m){const t=this.cur();return new Error(t.line+':'+t.col+': '+m)}loc(){const t=this.cur();return{line:t.line,col:t.col}}parse(){const b=[];while(!this.check(TT.EOF)){var n=this.parseTop();if(n)b.push(n)}return new Program(b)}parseTop(){if(this.check(TT.KEYWORD,'use')){this.adv();while(!this.check(TT.EOF)&&this.cur().line===this.t[this.p-1].line)this.adv();this.match(TT.SEMICOLON);return null}if(this.check(TT.KEYWORD,'import'))return this.parseImport();if(this.check(TT.KEYWORD,'export')){const l=this.loc();this.adv();this.expect(TT.KEYWORD,'fn');return this.parseFn(true,l)}if(this.check(TT.KEYWORD,'fn')){const l=this.loc();this.adv();return this.parseFn(false,l)}if(this.check(TT.KEYWORD,'let')||this.check(TT.KEYWORD,'mut'))return this.parseVar();throw this.err('Unexpected "'+this.cur().value+'" — each line should be fn, let, mut, export, or use')}parseImport(){const l=this.loc();this.expect(TT.KEYWORD,'import');this.expect(TT.KEYWORD,'fn');const name=this.expect(TT.IDENTIFIER).value;this.expect(TT.LPAREN);const params=this.parseParams();this.expect(TT.RPAREN);let ret='void';if(this.match(TT.ARROW))ret=this.parseType();else if(this.check(TT.TYPE))ret=this.parseType();this.expect(TT.KEYWORD,'from');const mod=this.expect(TT.STRING).value;this.match(TT.SEMICOLON);return new ImportDecl(name,params,ret,mod,l)}parseFn(exp,sl){const name=this.expect(TT.IDENTIFIER).value;this.expect(TT.LPAREN);const params=this.parseParams();this.expect(TT.RPAREN);let ret='void';if(this.match(TT.ARROW))ret=this.parseType();else if(this.check(TT.TYPE))ret=this.parseType();return new FunctionDecl(name,params,ret,this.parseBlock(),exp,sl)}parseType(){const t=this.cur();if(t.type===TT.TYPE||t.type===TT.IDENTIFIER){this.adv();let ty=t.value;if(this.match(TT.QUESTION))ty+='?';return ty}throw this.err('Expected a type (int, num, str, bool, void) after :')}parseStmt(){if(this.check(TT.KEYWORD,'let')||this.check(TT.KEYWORD,'mut'))return this.parseVar();if(this.check(TT.KEYWORD,'return'))return this.parseReturn();if(this.check(TT.KEYWORD,'if'))return this.parseIf();if(this.check(TT.KEYWORD,'while'))return this.parseWhile();if(this.check(TT.KEYWORD,'for'))return this.parseFor();if(this.check(TT.KEYWORD,'break')){const l=this.loc();this.adv();this.match(TT.SEMICOLON);return new BreakStmt(l)}if(this.check(TT.KEYWORD,'continue')){const l=this.loc();this.adv();this.match(TT.SEMICOLON);return new ContinueStmt(l)}if(this.check(TT.LBRACE))return this.parseBlock();return this.parseExprStmt()}parseVar(){const l=this.loc();const m=this.cur().value==='mut';this.adv();const n=this.expect(TT.IDENTIFIER).value;let t=null;if(this.match(TT.COLON))t=this.parseType();let i=null;if(this.match(TT.ASSIGN))i=this.parseExpr();this.match(TT.SEMICOLON);return new VarDecl(n,t,i,m,l)}parseReturn(){const l=this.loc();this.adv();let v=null;if(!this.check(TT.SEMICOLON))v=this.parseExpr();this.match(TT.SEMICOLON);return new ReturnStmt(v,l)}parseIf(){const l=this.loc();this.adv();this.expect(TT.LPAREN);const c=this.parseExpr();this.expect(TT.RPAREN);const t=this.parseBlock();let a=null;if(this.match(TT.KEYWORD,'else')){a=this.check(TT.KEYWORD,'if')?this.parseIf():this.parseBlock()}return new IfStmt(c,t,a,l)}parseWhile(){const l=this.loc();this.adv();this.expect(TT.LPAREN);const c=this.parseExpr();this.expect(TT.RPAREN);return new WhileStmt(c,this.parseBlock(),l)}parseFor(){const l=this.loc();this.adv();this.expect(TT.LPAREN);let i=null;if(this.check(TT.KEYWORD,'let')||this.check(TT.KEYWORD,'mut'))i=this.parseVar();else if(!this.check(TT.SEMICOLON))i=this.parseExprStmt();else this.match(TT.SEMICOLON);let c=null;if(!this.check(TT.SEMICOLON))c=this.parseExpr();this.match(TT.SEMICOLON);let u=null;if(!this.check(TT.RPAREN))u=this.parseExpr();this.expect(TT.RPAREN);return new ForStmt(i,c,u,this.parseBlock(),l)}parseBlock(){const l=this.loc();this.expect(TT.LBRACE);const s=[];while(!this.check(TT.RBRACE)&&!this.check(TT.EOF))s.push(this.parseStmt());this.expect(TT.RBRACE);return new BlockStmt(s,l)}parseExprStmt(){const e=this.parseExpr();this.match(TT.SEMICOLON);return new ExprStmt(e,e.loc)}parseExpr(){return this.parseAssign()}parseAssign(){const l=this.parseNullC();if(this.match(TT.ASSIGN))return new AssignExpr(l,this.parseAssign(),l.loc);if(this.match(TT.PLUSEQ))return new AssignExpr(l,new BinaryExpr('+',l,this.parseAssign(),l.loc),l.loc);if(this.match(TT.MINUSEQ))return new AssignExpr(l,new BinaryExpr('-',l,this.parseAssign(),l.loc),l.loc);if(this.match(TT.STAREQ))return new AssignExpr(l,new BinaryExpr('*',l,this.parseAssign(),l.loc),l.loc);if(this.match(TT.SLASHEQ))return new AssignExpr(l,new BinaryExpr('/',l,this.parseAssign(),l.loc),l.loc);return l}parseNullC(){let l=this.parseOr();while(this.match(TT.NULLCOALESCE))l=new BinaryExpr('??',l,this.parseOr(),l.loc);return l}parseOr(){let l=this.parseAnd();while(this.match(TT.OR))l=new BinaryExpr('||',l,this.parseAnd(),l.loc);return l}parseAnd(){let l=this.parseBOr();while(this.match(TT.AND))l=new BinaryExpr('&&',l,this.parseBOr(),l.loc);return l}parseBOr(){let l=this.parseBXor();while(this.match(TT.PIPE))l=new BinaryExpr('|',l,this.parseBXor(),l.loc);return l}parseBXor(){let l=this.parseBAnd();while(this.match(TT.CARET))l=new BinaryExpr('^',l,this.parseBAnd(),l.loc);return l}parseBAnd(){let l=this.parseEq();while(this.match(TT.AMP))l=new BinaryExpr('&',l,this.parseEq(),l.loc);return l}parseEq(){let l=this.parseCmp();while(true){if(this.match(TT.EQ))l=new BinaryExpr('==',l,this.parseCmp(),l.loc);else if(this.match(TT.NEQ))l=new BinaryExpr('!=',l,this.parseCmp(),l.loc);else break}return l}parseCmp(){let l=this.parseShift();while(true){if(this.match(TT.LT))l=new BinaryExpr('<',l,this.parseShift(),l.loc);else if(this.match(TT.GT))l=new BinaryExpr('>',l,this.parseShift(),l.loc);else if(this.match(TT.LTE))l=new BinaryExpr('<=',l,this.parseShift(),l.loc);else if(this.match(TT.GTE))l=new BinaryExpr('>=',l,this.parseShift(),l.loc);else break}return l}parseShift(){let l=this.parseAdd();while(true){if(this.match(TT.SHL))l=new BinaryExpr('<<',l,this.parseAdd(),l.loc);else if(this.match(TT.SHR))l=new BinaryExpr('>>',l,this.parseAdd(),l.loc);else break}return l}parseAdd(){let l=this.parseMul();while(true){if(this.match(TT.PLUS))l=new BinaryExpr('+',l,this.parseMul(),l.loc);else if(this.match(TT.MINUS))l=new BinaryExpr('-',l,this.parseMul(),l.loc);else break}return l}parseMul(){let l=this.parseUnary();while(true){if(this.match(TT.STAR))l=new BinaryExpr('*',l,this.parseUnary(),l.loc);else if(this.match(TT.SLASH))l=new BinaryExpr('/',l,this.parseUnary(),l.loc);else if(this.match(TT.PERCENT))l=new BinaryExpr('%',l,this.parseUnary(),l.loc);else break}return l}parseUnary(){if(this.match(TT.MINUS))return new UnaryExpr('-',this.parseUnary(),this.loc());if(this.match(TT.NOT))return new UnaryExpr('!',this.parseUnary(),this.loc());if(this.match(TT.TILDE))return new UnaryExpr('~',this.parseUnary(),this.loc());return this.parsePostfix()}parsePrimary(){const t=this.cur();if(this.match(TT.LPAREN)){const e=this.parseExpr();this.expect(TT.RPAREN);return e}if(t.type===TT.INTEGER){this.adv();return new IntLiteral(t.value,{line:t.line,col:t.col})}if(t.type===TT.FLOAT){this.adv();return new FloatLiteral(t.value,{line:t.line,col:t.col})}if(t.type===TT.BOOLEAN){this.adv();return new BoolLiteral(t.value==='true',{line:t.line,col:t.col})}if(t.type===TT.NULL){this.adv();return new NullLiteral({line:t.line,col:t.col})}if(t.type===TT.STRING){this.adv();return new StringLiteral(t.value,{line:t.line,col:t.col})}if(t.type===TT.KEYWORD&&t.value==='new')return this.parseNew();if(t.type===TT.KEYWORD&&t.value==='this'){this.adv();return new IdentifierExpr('this',{line:t.line,col:t.col})}if(t.type===TT.IDENTIFIER){this.adv();return new IdentifierExpr(t.value,{line:t.line,col:t.col})}if(this.match(TT.LBRACKET)){var _els=[];if(!this.check(TT.RBRACKET)){do _els.push(this.parseExpr());while(this.match(TT.COMMA))}this.expect(TT.RBRACKET);return new ArrayLiteral(_els,{line:t.line,col:t.col})}throw this.err(t.value?'Unexpected "'+t.value+'" — did you forget a function name or closing brace?':'Unexpected end of input — check for missing } or )')}}
// `new X(args)` / `new A.B.C(args)` → NewExpr, compiled to __jsNew. The argument list is optional (`new Map`).
Parser.prototype.parseNew=function(){
  const t=this.adv(),l={line:t.line,col:t.col};
  const first=this.expect(TT.IDENTIFIER);
  let c=new IdentifierExpr(first.value,{line:first.line,col:first.col});
  while(this.match(TT.DOT))c=new MemberExpr(c,this.expect(TT.IDENTIFIER).value,l);
  const a=[];
  if(this.match(TT.LPAREN)){if(!this.check(TT.RPAREN)){do a.push(this.parseExpr());while(this.match(TT.COMMA))}this.expect(TT.RPAREN)}
  return new NewExpr(c,a,l);
};
// a[i] on a JS value → IndexExpr (read: __jsIdx, write: __jsIdxSet).
class IndexExpr extends Z{constructor(o,i,l){super('IndexExpr',l);this.object=o;this.index=i}}
// Postfix operators. Replaces the method defined inside the Parser class to add `a[i]` (the `[` must
// be on the same line as the expression it indexes, so an array literal can still start a new line)
// and to accept type words as property names (`obj.js`, `obj.int`).
Parser.prototype.parsePostfix=function(){
  let e=this.parsePrimary();
  while(true){
    if(this.match(TT.LPAREN)){
      const a=[];
      if(!this.check(TT.RPAREN)){do a.push(this.parseExpr());while(this.match(TT.COMMA))}
      this.expect(TT.RPAREN);
      e=new CallExpr(e,a,e.loc);
    }else if(this.match(TT.DOT)){
      let pn;
      // After a dot any word is a member name, including keywords (gsap.from, obj.new, x.class)
      if(this.check(TT.INTEGER)||this.check(TT.TYPE)||this.check(TT.KEYWORD)||this.check(TT.BOOLEAN)||this.check(TT.NULL))pn=String(this.adv().value);
      else pn=this.expect(TT.IDENTIFIER).value;
      e=new MemberExpr(e,pn,e.loc);
    }else if(this.check(TT.LBRACKET)&&this.p>0&&this.t[this.p-1].line===this.cur().line){
      this.adv();
      const ix=this.parseExpr();
      this.expect(TT.RBRACKET);
      e=new IndexExpr(e,ix,e.loc);
    }else if(this.match(TT.PLUSPLUS)){
      e=new AssignExpr(e,new BinaryExpr('+',e,new IntLiteral('1',e.loc),e.loc),e.loc);
    }else if(this.match(TT.MINUSMINUS)){
      e=new AssignExpr(e,new BinaryExpr('-',e,new IntLiteral('1',e.loc),e.loc),e.loc);
    }else break;
  }
  return e;
};
// {key: value, "key": value, 3: value} → ObjectLiteral, a new JS object (type js). parsePrimary is only
// reached in expression position (after `=`, `(`, `,`, `:`, `return`, `[`…): a `{` at the start of a
// statement is taken by parseStmt as a block before any expression is parsed, so the two cannot be confused.
class ObjectLiteral extends Z{constructor(k,v,l){super('ObjectLiteral',l);this.keys=k;this.values=v}}
(function(){
  var primary0=Parser.prototype.parsePrimary;
  Parser.prototype.parsePrimary=function(){
    if(!this.check(TT.LBRACE))return primary0.call(this);
    var t=this.adv(),keys=[],vals=[];
    while(!this.check(TT.RBRACE)){
      var k=this.cur();
      if(k.type===TT.IDENTIFIER||k.type===TT.STRING||k.type===TT.KEYWORD||k.type===TT.TYPE||k.type===TT.BOOLEAN||k.type===TT.NULL)keys.push(String(k.value));
      else if(k.type===TT.INTEGER||k.type===TT.FLOAT)keys.push(String(Number(k.value)));
      else throw this.err('Expected a property name (a word, "a string" or a number) in { }, got "'+k.value+'"');
      this.adv();
      if(!this.check(TT.COLON))throw this.err('Expected : after the property name "'+keys[keys.length-1]+'" — an object literal is written {name: value, other: value}');
      this.adv();
      if(this.cur().type===TT.TYPE&&this.cur().value==='js')this.cur().type=TT.IDENTIFIER; /* a variable called js as the value */
      vals.push(this.parseExpr());
      if(!this.match(TT.COMMA))break;
    }
    this.expect(TT.RBRACE);
    return new ObjectLiteral(keys,vals,{line:t.line,col:t.col});
  };
})();
// Imports behind the `js` type (module "__js__"). The annotator adds only the ones a program needs.
var _JS_CONV_IMPORTS={
  __jsNum:[[['h','int']],'num'],          // js → num (NaN/null → 0)
  __jsStr:[[['h','int']],'str'],          // js → str
  __jsBool:[[['h','int']],'bool'],        // js → bool, JS truthiness
  __jsInt:[[['h','js']],'int'],           // js → int, toInt semantics
  __jsIntH:[[['h','js']],'int'],          // js → int if it is a JS number/boolean, else the handle itself
  __jsCmpNum:[[['h','js']],'num'],        // js → num for comparisons (null = 0, non-numbers = NaN)
  __jsSame:[[['a','js'],['b','js']],'bool'],   // JS ===
  __jsEqStr:[[['a','js'],['b','str']],'bool'], // JS value === Emit string
  __jsStrEq:[[['a','str'],['b','str']],'bool'],// Emit string == Emit string
  __jsFromStr:[[['s','str']],'js'],       // Emit string → handle to a JS string
  __jsFromNum:[[['n','num']],'js'],
  __jsFromBool:[[['b','bool']],'js'],
  __jsIdx:[[['recv','js']],'js'],         // recv[arg slot 0]
  __jsIdxSet:[[['recv','js']],'void']     // recv[arg slot 0] = arg slot 1
};
// Calls that go through the argument buffer, JS literals and string `+`.
_JS_CONV_IMPORTS.__jsCallG=[[['name','str'],['n','int'],['flags','int']],'js']; // window[name](args); flags&1: echo a primitive result as "< value"
_JS_CONV_IMPORTS.__jsCallV=[[['f','js'],['label','str'],['n','int']],'js'];     // f(args) — f is a function value
_JS_CONV_IMPORTS.__jsArr=[[['h','js'],['n','int']],'js'];                       // h=0: new [] ; push n arg slots; returns the array
_JS_CONV_IMPORTS.__jsObj=[[['h','js'],['n','int']],'js'];                       // h=0: new {} ; set n (key,value) slot pairs; returns the object
_JS_CONV_IMPORTS.__jsGlobal=[[['namePtr','str']],'js'];                         // window[name] (normally injected by injectBuiltins)
_JS_CONV_IMPORTS.__strCat=[[['a','str'],['b','str']],'str'];
_JS_CONV_IMPORTS.__strOfInt=[[['x','int']],'str'];
_JS_CONV_IMPORTS.__strOfNum=[[['x','num']],'str'];
_JS_CONV_IMPORTS.__strOfBool=[[['b','bool']],'str'];
// Name of the import that performs a conversion recorded by TypeAnnotator.conv (node.jsConv).
function _jsConvFn(c){
  if(c.to==='str'&&c.from!=='js')return c.from==='bool'?'__strOfBool':(c.from==='num'||c.from==='f64')?'__strOfNum':'__strOfInt'; /* operand of str + … */
  if(c.to==='js')return c.from==='str'?'__jsFromStr':c.from==='bool'?'__jsFromBool':'__jsFromNum';
  return{str:'__jsStr',num:'__jsNum',bool:'__jsBool',int:'__jsInt',inth:'__jsIntH',cnum:'__jsCmpNum'}[c.to];
}
// TYPE ANNOTATOR — single source of truth for expression types
// Walks the AST after parsing+injectBuiltins, sets node.exprType on every expression.
// Runs BEFORE TypeChecker and Codegen; both read annotations instead of re-inferring.
class TypeAnnotator {
  constructor(){ this.scopes=[new Map()]; this.functions=new Map(); this.globals=new Map(); this.hasJsInterop=false; }
  push(){ this.scopes.push(new Map()); }
  pop(){ this.scopes.pop(); }
  def(n,t){ this.scopes[this.scopes.length-1].set(n,t); }
  look(n){ for(let i=this.scopes.length-1;i>=0;i--) if(this.scopes[i].has(n)) return this.scopes[i].get(n); return null; }
  norm(t){ if(t==='i32'||t==='i64') return'int'; if(t==='f32'||t==='f64') return'num'; return t; }
  prom(a,b){ const na=this.norm(a),nb=this.norm(b); if(na===nb) return na; if(na==='num'||nb==='num') return'num'; return'int'; }
  // ── The `js` type: a JS value held by Emit (an i64 handle, 0 = null/undefined) ──
  // Property reads, method calls, `new`, a[i], JS globals, auto-bridged JS functions and the
  // emptyObj/jsAt/jsGet/jsKeys/toJsArray/getCanvas/__jsGlobal builtins all have type `js`,
  // and so does a `let` initialised from one of them.
  //
  // conv(e,to) records a conversion on the node: e.jsConv={from,to}, and e.exprType becomes the
  // type the consumer sees. Codegen (the genExpr wrapper) generates the node in its `from` type and
  // then emits the conversion. Kinds of `to`:
  //   'str' 'num' 'bool'  js → that type (__jsStr/__jsNum/__jsBool)
  //   'int'               js → integer, toInt semantics (__jsInt)          — arithmetic
  //   'inth'              js → integer if the value is a JS number/boolean, else the handle
  //                       unchanged (__jsIntH) — a declared `int`, which may also hold a handle
  //   'cnum'              js → number for a comparison: null is 0, non-numbers are NaN (__jsCmpNum)
  //   'js'                str/num/bool → a handle to that JS value (__jsFromStr/Num/Bool)
  conv(e,to){
    e.jsConv={from:e.exprType,to:to};
    this.need(_jsConvFn(e.jsConv));
    e.exprType=(to==='int'||to==='inth')?'int':(to==='cnum')?'num':to;
    return e.exprType;
  }
  need(name){ (this.needed||(this.needed=new Set())).add(name); }
  isI(t){ return t==='int'||t==='i64'; }
  isN(t){ return t==='num'||t==='f64'; }
  // Contextual typing: the expression is used where type t is declared/required.
  want(e,t){
    if(!e||!t) return e&&e.exprType;
    if(t==='js'&&e.type==='ArrayLiteral'&&!e.jsArr) return this.jsLit(e);
    const s=e.exprType;
    if(s==='js'){
      if(t==='str'||t==='bool') this.conv(e,t);
      else if(this.isN(t)) this.conv(e,'num');
      else if(this.isI(t)) this.conv(e,'inth');
    } else if(t==='js'){
      if(s==='str'||s==='bool'||this.isN(s)) this.conv(e,'js');
    }
    return e.exprType;
  }
  // An array literal written where a JS value goes (a JS call argument, a property/index assignment,
  // a js-typed variable, an element of another such literal) is a real JS array, not an Emit array.
  jsLit(e){
    e.jsArr=true; e.exprType='js'; this.need('__jsArr');
    for(const el of e.elements) if(el.type==='ArrayLiteral') this.jsLit(el);
    return 'js';
  }
  // Annotate a value that is handed to JS.
  jsArg(e){ const t=this.a(e); return e.type==='ArrayLiteral'?this.jsLit(e):t; }
  // A str/num/bool used as the receiver of a member call, property read or index becomes a JS value.
  recv(e){ const s=e.exprType; if(s==='str'||s==='bool'||this.isN(s)) this.conv(e,'js'); }
  // `a == b` / `a != b` compiled as a call: e.jsCmp={fn, args}
  cmpFn(e,fn,a,b){ e.jsCmp={fn:fn,args:[a,b]}; this.need(fn); }
  fail(m,l){ throw new Error((l?l.line+':'+l.col+': ':'')+m); }
  // Top-level initialisers must be compile-time constants (WASM global initialisers are constants).
  constInit(e){
    if(!e) return true;
    if(e.type==='IntLiteral'||e.type==='FloatLiteral'||e.type==='BoolLiteral'||e.type==='StringLiteral'||e.type==='NullLiteral') return true;
    if(e.type==='UnaryExpr'&&e.op==='-') return this.constNum(e.operand);
    return this.constNum(e);
  }
  constNum(e){
    if(!e) return false;
    if(e.type==='IntLiteral'||e.type==='FloatLiteral') return true;
    if(e.type==='UnaryExpr'&&e.op==='-') return this.constNum(e.operand);
    if(e.type==='BinaryExpr'&&['+','-','*','/','%'].includes(e.op)) return this.constNum(e.left)&&this.constNum(e.right);
    return false;
  }
  annotate(prog){
    // Pass 1: register all top-level function signatures and globals
    for(const n of prog.body){
      if(n.type==='FunctionDecl'||n.type==='ImportDecl') this.functions.set(n.name,{params:n.params.map(p=>p.type),returnType:n.returnType,module:n.module,node:n,allJs:n.params.map(()=>true),calls:0});
      if(n.name==='__jsGlobal'||n.name==='__jsCall'||n.name==='__jsGet') this.hasJsInterop=true;
    }
    for(const n of prog.body){
      if(n.type==='VarDecl'){
        let t=n.varType;
        if(n.init&&(!this.constInit(n.init)||(t==='js'&&n.init.type!=='NullLiteral'&&n.init.type!=='IntLiteral'))){(this.lateVars||(this.lateVars=[])).push(n);continue;} /* set at start-up: see TOP-LEVEL VALUES */
        const git=n.init?this.a(n.init):null;
        if(!t) t=(git==='null')?'js':git;
        if(!t) t='int';
        if(t==='js'&&n.init&&n.init.type!=='NullLiteral'&&n.init.type!=='IntLiteral') this.fail("Top-level js variable '"+n.name+"' must start as null — assign the real value inside a function",n.init.loc||n.loc);
        this.globals.set(n.name,t);
        this.def(n.name,t);
        n.declType=t;
      }
    }
    if(this.lateVars&&this.lateVars.length) this.lateInit(prog);
    // Pass 2: walk function bodies and annotate every expression
    for(const n of prog.body) this.walk(n);
    // Auto-bridged JS functions: a parameter that only ever receives `js` values is a `js` parameter
    // (so a null handle reaches the JS function as null, not as the number 0).
    for(const fn of this.functions.values()){
      if(fn.module!=='js'||!fn.calls) continue;
      fn.node.params.forEach((p,i)=>{ if(fn.allJs[i]&&this.isI(p.type)) p.type='js'; });
    }
    // Add the __js__ imports this program turned out to need.
    for(const name of (this.needed||[])){
      if(this.functions.has(name)) continue;
      const d=_JS_CONV_IMPORTS[name];
      prog.body.unshift(new ImportDecl(name,d[0].map(p=>({name:p[0],type:p[1]})),d[1],'__js__',{line:0,col:0}));
    }
    return this;
  }
  walk(n){
    if(!n) return;
    switch(n.type){
      case'FunctionDecl':
        this.push();
        this.currentRet=n.returnType;
        for(const p of n.params) this.def(p.name,p.type);
        this.walk(n.body);
        this.pop();
        this.currentRet=null;
        break;
      case'ImportDecl': break;
      case'VarDecl':{
        let t=n.varType;
        if(n.init){
          const it=this.a(n.init);
          if(!t) t=(it==='null')?'js':(it||'int');
          else this.want(n.init,t);
        }
        if(!t) t='int';
        this.def(n.name,t);
        n.declType=t;
        break;
      }
      case'BlockStmt':
        this.push();
        for(const s of n.statements) this.walk(s);
        this.pop();
        break;
      case'ReturnStmt': if(n.value){ this.a(n.value); this.want(n.value,this.currentRet); } break;
      case'IfStmt': this.a(n.condition); this.want(n.condition,'bool'); this.walk(n.consequent); if(n.alternate) this.walk(n.alternate); break;
      case'WhileStmt': this.a(n.condition); this.want(n.condition,'bool'); this.walk(n.body); break;
      case'ForStmt':
        this.push();
        if(n.init) this.walk(n.init);
        if(n.condition){ this.a(n.condition); this.want(n.condition,'bool'); }
        if(n.update) this.a(n.update);
        this.walk(n.body);
        this.pop();
        break;
      case'ExprStmt':
        this.a(n.expression);
        /* a bare `foo(1)` in a program without any other JS interop echoes a primitive result ("< 7"), as it always did */
        if(n.expression.jsCall==='global'&&!this.hasJsInterop) n.expression.jsEcho=true;
        break;
    }
  }
  // Annotate an expression and return its type
  a(e){
    if(!e) return'int';
    let t='int';
    if(e.jsConv) delete e.jsConv; /* a node shared by `x += 1` is annotated twice */
    if(e.jsCmp) delete e.jsCmp;
    switch(e.type){
      case'IntLiteral':   t='int'; break;
      case'FloatLiteral': t='num'; break;
      case'BoolLiteral':  t='bool'; break;
      case'StringLiteral':t='str'; break;
      case'NullLiteral':  t='null'; break;
      case'IdentifierExpr':{
        const local=this.look(e.name);
        if(local){ t=local; }
        else if(this.globals.has(e.name)){ t=this.globals.get(e.name); }
        else if(this.hasJsInterop){ t='js'; /* JS global handle */ }
        else if(this.functions.has(e.name)&&this.functions.get(e.name).node.auto){ t='js'; this.need('__jsGlobal'); /* a global function used as a value: `let f = parseInt` */ }
        else { t='int'; /* fallback; TypeChecker will report error */ }
        break;
      }
      case'UnaryExpr':{
        let opT=this.a(e.operand);
        if(e.op==='!') this.want(e.operand,'bool');
        else if(opT==='js') opT=this.conv(e.operand,'num');
        t = (e.op==='!') ? 'bool' : opT;
        break;
      }
      case'BinaryExpr':{
        const lt=this.a(e.left), rt=this.a(e.right);
        const lj=lt==='js', rj=rt==='js';
        if(e.op==='&&'||e.op==='||'){ this.want(e.left,'bool'); this.want(e.right,'bool'); t='bool'; }
        else if(e.op==='=='||e.op==='!='){
          if(lj||rj){
            const o=lj?rt:lt, j=lj?e.left:e.right, other=lj?e.right:e.left;
            if(lj&&rj) this.cmpFn(e,'__jsSame',e.left,e.right);      /* identity (JS ===) */
            else if(o==='null'){ /* null check: the handle is compared with 0 */ }
            else if(o==='str') this.cmpFn(e,'__jsEqStr',j,other);    /* string equality */
            else if(o==='bool') this.conv(j,'bool');
            else this.conv(j,'cnum');                                /* number comparison */
          }
          else if(lt==='str'&&rt==='str') this.cmpFn(e,'__jsStrEq',e.left,e.right);
          t='bool';
        }
        else if(['<','>','<=','>='].includes(e.op)){
          if(lj) this.conv(e.left,'cnum');
          if(rj) this.conv(e.right,'cnum');
          t='bool';
        }
        else if(e.op==='+'&&(lt==='str'||rt==='str')){
          /* string concatenation: the other operand (js, int, num, bool) is converted to a string */
          for(const o of [e.left,e.right]){
            const ot=o.exprType;
            if(ot==='str') continue;
            if(ot==='js'||this.isI(ot)||this.isN(ot)||ot==='bool') this.conv(o,'str');
            else this.fail("Can't add "+ot+" to a string with +",o.loc||e.loc);
          }
          e.strCat=true; this.need('__strCat'); t='str';
        }
        else if(lj||rj){
          /* arithmetic on a JS value: with a num (or another JS value) → num, with an int → int */
          const o=lj?rt:lt;
          if((lj&&rj)||this.isN(o)||o==='f32'){ if(lj) this.conv(e.left,'num'); if(rj) this.conv(e.right,'num'); t='num'; }
          else { this.conv(lj?e.left:e.right,'int'); t='int'; }
        }
        else { t=this.prom(lt,rt); }
        break;
      }
      case'CallExpr':{
        if(e.callee.type==='MemberExpr'){
          this.a(e.callee.object); this.recv(e.callee.object);
          for(const arg of e.args) this.jsArg(arg);
          t='js';
        } else if(e.callee.type==='IdentifierExpr'&&!(this.functions.has(e.callee.name)&&!this.functions.get(e.callee.name).node.auto)){
          /* not an Emit function, builtin or declared import: a variable holding a JS function → call
             the value; anything else → window.name(args). Both take any arguments (argument buffer). */
          const vt=this.look(e.callee.name);
          if(vt){
            if(vt!=='js'&&!this.isI(vt)) this.fail("'"+e.callee.name+"' is a "+vt+" variable, not a function — it cannot be called",e.loc);
            this.a(e.callee); e.jsCall='value'; this.need('__jsCallV');
          } else { e.jsCall='global'; this.need('__jsCallG'); }
          for(const arg of e.args) this.jsArg(arg);
          t='js';
        } else if(e.callee.type==='IdentifierExpr'){
          const fn=this.functions.get(e.callee.name);
          if(fn) fn.calls++;
          e.args.forEach((arg,i)=>{
            const at=this.a(arg), pt=fn&&fn.params[i];
            if(!pt) return;
            if(fn.module==='js'){
              /* auto-bridged JS function: a JS value goes through as itself */
              if(at!=='js') fn.allJs[i]=false;
              if(at==='js'&&this.isI(pt)) return;
            }
            this.want(arg,pt);
          });
          t = fn ? fn.returnType : 'int';
        } else {
          /* a call on any other expression — f(x)(y), fns[0](x) — calls that JS function value */
          const ct=this.a(e.callee);
          if(ct!=='js'&&!this.isI(ct)) this.fail("This is a "+ct+", not a function — it cannot be called",e.loc);
          e.jsCall='value'; this.need('__jsCallV');
          for(const arg of e.args) this.jsArg(arg);
          t='js';
        }
        break;
      }
      case'ObjectLiteral':{
        for(const v of e.values) this.jsArg(v);
        this.need('__jsObj');
        t='js';
        break;
      }
      case'MemberExpr':{
        this.a(e.object); this.recv(e.object);
        t='js';
        break;
      }
      case'IndexExpr':{
        const ot=this.a(e.object);
        this.a(e.index);
        this.need('__jsIdx');
        if(ot==='str') this.recv(e.object);
        else if(ot!=='js') this.fail("[ ] works on JS values (type js) and strings, but this is "+ot+" — an Emit array held in an int variable: declare it as arr (or use getItem / setItem); a JS value held in an int variable: declare it as js",e.loc);
        t='js';
        break;
      }
      case'AssignExpr':{
        const tt=this.a(e.target);
        t=(e.target.type==='MemberExpr'||e.target.type==='IndexExpr')?this.jsArg(e.value):this.a(e.value);
        if(e.target.type==='IdentifierExpr') t=this.want(e.value,tt);
        else if(e.target.type==='IndexExpr') this.need('__jsIdxSet');
        break;
      }
      case'NewExpr':{
        this.a(e.callee);
        for(const arg of e.args) this.jsArg(arg);
        t='js'; /* handle to the constructed object */
        break;
      }
      case'ArrayLiteral':{
        // Annotate each element. The literal itself is an int (array handle).
        // Track elemType so codegen knows whether to use setItem or setNumItem.
        var hasNum=false;
        for(const el of e.elements){
          var et=this.a(el);
          if(et==='num'||et==='f64'||et==='f32')hasNum=true;
        }
        e.elemType=hasNum?'num':'int';
        t='int';
        break;
      }
      default: t='int';
    }
    e.exprType=t;
    return t;
  }
}
// TYPE CHECKER
class TypeChecker{constructor(){this.scopes=[new Map()];this.functions=new Map();this.errors=[];this.cf=null}err(m,l){this.errors.push((l?.line||'?')+':'+(l?.col||'?')+': '+m)}push(){this.scopes.push(new Map())}pop(){this.scopes.pop()}def(n,t){this.scopes[this.scopes.length-1].set(n,t)}look(n){for(let i=this.scopes.length-1;i>=0;i--)if(this.scopes[i].has(n))return this.scopes[i].get(n);return null}check(prog){for(const n of prog.body){if(n.type==='FunctionDecl'||n.type==='ImportDecl')this.functions.set(n.name,{params:n.params.map(p=>p.type),returnType:n.returnType});if(n.type==='VarDecl'){var gt=n.varType||(n.init?this.inf(n.init):'int');this.def(n.name,gt)}}for(const n of prog.body)this.cn(n);return this.errors}cn(n){if(!n)return;switch(n.type){case'FunctionDecl':this.push();this.cf=n;for(const p of n.params)this.def(p.name,p.type);this.cn(n.body);this.cf=null;this.pop();break;case'ImportDecl':break;case'VarDecl':{let t=n.varType;const it=n.init?this.inf(n.init):null;if(t&&it&&t!==it&&!this.compat(t,it))this.err('Cannot assign '+it+' to '+t,n.loc);if(!t)t=it||'int';this.def(n.name,t);break}case'BlockStmt':this.push();for(const s of n.statements)this.cn(s);this.pop();break;case'ReturnStmt':{const rt=this.cf?this.cf.returnType:'void';if(n.value){const vt=this.inf(n.value);if(rt==='void')this.err("Function returns void \u2014 don't return a value",n.loc);else if(vt&&vt!==rt&&!this.compat(rt,vt))this.err('Return type is '+rt+" but this returns "+vt+" \u2014 change the return type to "+vt+" or cast the value",n.loc)}else if(rt!=='void')this.err('Function returns '+rt+' but this return has no value',n.loc);break}case'IfStmt':this.inf(n.condition);this.cn(n.consequent);if(n.alternate)this.cn(n.alternate);break;case'WhileStmt':this.inf(n.condition);this.cn(n.body);break;case'ForStmt':this.push();if(n.init)this.cn(n.init);if(n.condition)this.inf(n.condition);if(n.update)this.inf(n.update);this.cn(n.body);this.pop();break;case'ExprStmt':this.inf(n.expression);break}}inf(e){if(!e)return'int';if(e.exprType){if(e.type==='IdentifierExpr'&&!this.look(e.name)&&!this.functions.has('__jsGlobal'))this.err("'"+e.name+"' is not defined — declare it with let or mut first",e.loc);if(e.type==='BinaryExpr'&&['<','>','<=','>='].includes(e.op)){const lt=e.left.exprType,rt=e.right.exprType;if(lt==='bool'||rt==='bool')this.err("Can't compare a bool with "+e.op+" \u2014 Emit doesn't allow chained comparisons; use && instead (e.g. a < b && b < c)",e.loc);else if(lt==='str'||rt==='str')this.err("Can't compare strings with "+e.op,e.loc)}if(e.type==='CallExpr'&&e.callee.type==='IdentifierExpr'){const fn=e.callee.name;if(!this.functions.has(fn)&&fn!=='__jsGlobal')this.err("'"+fn+"()' is not a known function — check spelling or add it as a builtin",e.loc);for(const a of e.args)this.inf(a);return e.exprType}if(e.type==='BinaryExpr'||e.type==='UnaryExpr'||e.type==='MemberExpr'||e.type==='AssignExpr'){if(e.left)this.inf(e.left);if(e.right)this.inf(e.right);if(e.operand)this.inf(e.operand);if(e.object)this.inf(e.object);if(e.value)this.inf(e.value);if(e.target)this.inf(e.target)}else if(e.type==='CallExpr'){if(e.callee&&e.callee.type!=='IdentifierExpr')this.inf(e.callee);for(const a of e.args)this.inf(a)}else if(e.type==='ArrayLiteral'){for(const el of e.elements)this.inf(el)}else if(e.type==='NewExpr'){this.inf(e.callee);for(const a of e.args)this.inf(a)}return e.exprType}switch(e.type){case'AssignExpr':return this.inf(e.value);default:return e&&e.exprType||'int'}}norm(t){if(t==='i32'||t==='i64')return'int';if(t==='f32'||t==='f64')return'num';return t}prom(a,b){const na=this.norm(a),nb=this.norm(b);if(na===nb)return na;if(na==='num'||nb==='num')return'num';return'int'}compat(t,s){if(t===s)return true;const nt=this.norm(t),ns=this.norm(s);if(nt===ns)return true;if(nt==='num'&&(ns==='int'||ns==='bool'))return true;if(t.endsWith('?')&&(s==='null'||t.slice(0,-1)===s))return true;return false}}
// `js` in the type checker: js and int are assignment-compatible in both directions (an int may hold a
// handle — that is how every program was written before the js type existed), and null is a js value.
(function(){
  var P=TypeChecker.prototype,compat0=P.compat,inf0=P.inf;
  P.compat=function(t,s){
    var ti=t==='int'||t==='i64',si=s==='int'||s==='i64';
    if(t==='js'&&(s==='js'||si||s==='null'))return true;
    if(s==='js'&&ti)return true;
    return compat0.call(this,t,s);
  };
  P.inf=function(e){
    if(e&&e.type==='IndexExpr'){this.inf(e.object);this.inf(e.index);return e.exprType}
    if(e&&e.type==='CallExpr'&&e.jsCall){if(e.jsCall==='value')this.inf(e.callee);for(var i=0;i<e.args.length;i++)this.inf(e.args[i]);return e.exprType}
    if(e&&e.type==='ObjectLiteral'){for(var j=0;j<e.values.length;j++)this.inf(e.values[j]);return e.exprType}
    return inf0.call(this,e);
  };
})();
// WASM CODEGEN
function eu32(v){const b=[];do{let byte=v&0x7F;v>>>=7;if(v!==0)byte|=0x80;b.push(byte)}while(v!==0);return b}function ei32(v){const b=[];let more=true;while(more){let byte=v&0x7F;v>>=7;if((v===0&&(byte&0x40)===0)||(v===-1&&(byte&0x40)!==0))more=false;else byte|=0x80;b.push(byte)}return b}function ei64(v){const bv=BigInt(v);const b=[];let more=true,val=bv;while(more){let byte=Number(val&0x7Fn);val>>=7n;if((val===0n&&(byte&0x40)===0)||(val===-1n&&(byte&0x40)!==0))more=false;else byte|=0x80;b.push(byte)}return b}function ef32(v){const buf=new ArrayBuffer(4);new Float32Array(buf)[0]=v;return[...new Uint8Array(buf)]}function ef64(v){const buf=new ArrayBuffer(8);new Float64Array(buf)[0]=v;return[...new Uint8Array(buf)]}function estr(s){const e=new TextEncoder().encode(s);return[...eu32(e.length),...e]}function esec(id,c){return[id,...eu32(c.length),...c]}function evec(items){return[...eu32(items.length),...items.flat()]}
const VT={i32:0x7F,i64:0x7E,f32:0x7D,f64:0x7C};const Op={block:2,loop:3,if:4,else:5,end:0xB,br:0xC,br_if:0xD,return:0xF,call:0x10,drop:0x1A,local_get:0x20,local_set:0x21,local_tee:0x22,i32_const:0x41,i64_const:0x42,f32_const:0x43,f64_const:0x44,i32_eqz:0x45,i32_eq:0x46,i32_ne:0x47,i32_lt_s:0x48,i32_gt_s:0x4A,i32_le_s:0x4C,i32_ge_s:0x4E,i32_add:0x6A,i32_sub:0x6B,i32_mul:0x6C,i32_div_s:0x6D,i32_rem_s:0x6F,i32_and:0x71,i32_or:0x72,i32_xor:0x73,i32_shl:0x74,i32_shr_s:0x75,i64_eq:0x51,i64_ne:0x52,i64_lt_s:0x53,i64_gt_s:0x55,i64_le_s:0x57,i64_ge_s:0x59,i64_add:0x7C,i64_sub:0x7D,i64_mul:0x7E,i64_div_s:0x7F,i64_rem_s:0x81,i64_and:0x83,i64_or:0x84,i64_xor:0x85,i64_shl:0x86,i64_shr_s:0x87,f32_eq:0x5B,f32_ne:0x5C,f32_lt:0x5D,f32_gt:0x5E,f32_le:0x5F,f32_ge:0x60,f32_add:0x92,f32_sub:0x93,f32_mul:0x94,f32_div:0x95,f64_eq:0x61,f64_ne:0x62,f64_lt:0x63,f64_gt:0x64,f64_le:0x65,f64_ge:0x66,f64_add:0xA0,f64_sub:0xA1,f64_mul:0xA2,f64_div:0xA3,i32_store:0x36,i64_store:0x37,f32_store:0x38,f64_store:0x39,i32_store8:0x3A,i32_store16:0x3B,i32_load:0x28,i64_load:0x29,f64_load:0x2B,i64_extend_i32_u:0xAD,i64_extend_i32_s:0xAC,i32_wrap_i64:0xA7,i32_trunc_f64_s:0xB0,f64_convert_i64_s:0xB9,f64_convert_i32_s:0xB7};
class WasmCodegen{constructor(ast,target='wasm32'){this.ast=ast;this.target=target;this.ptrType=target==='wasm64'?VT.i64:VT.i32;this.types=[];this.typeMap=new Map();this.imports=[];this.functions=[];this.funcMap=new Map();this.currentLocals=[];this.localMap=new Map();this.currentCode=[];this.breakLabels=[];this.continueLabels=[];this.currentFuncRetType='void';this.strings=[];this.stringMap=new Map();this.dataOffset=1024;this.globals=[];this.globalMap=new Map()}j2w(t){if(!t)return VT.i32;const b=t.replace('?','');switch(b){case'i32':case'bool':return VT.i32;case'i64':case'int':return VT.i64;case'f32':return VT.f32;case'f64':case'num':return VT.f64;case'str':return this.ptrType;default:return this.ptrType}}getOrCreateType(pt,rt){const wp=pt.map(t=>this.j2w(t)),wr=rt==='void'?[]:[this.j2w(rt)];const k='('+wp+')=>'+wr;if(this.typeMap.has(k))return this.typeMap.get(k);const i=this.types.length;this.types.push({params:wp,results:wr});this.typeMap.set(k,i);return i}addLocal(n,t){const i=this.currentLocals.length;this.currentLocals.push(this.j2w(t));this.localMap.set(n,i);return i}getLocal(n){return this.localMap.has(n)?this.localMap.get(n):-1}emit(...b){this.currentCode.push(...b)}addString(v){if(this.stringMap.has(v))return this.stringMap.get(v);var enc=new TextEncoder().encode(v);var off=this.dataOffset;this.strings.push({value:v,offset:off,encoded:enc,length:enc.length});this.stringMap.set(v,off);this.dataOffset+=4+enc.length+1;return off}lookupFuncNode(name){const imp=this.imports.find(i=>i.name===name);if(imp)return imp.node;const local=this.functions.find(f=>f.name===name);if(local)return local.node;return null}generate(){for(const n of this.ast.body){if(n.type==='VarDecl'){var gt=n.declType||n.varType;if(!gt&&n.init)gt=this.inferET(n.init);if(!gt)gt='int';var gi=this.globals.length;this.globalMap.set(n.name,{idx:gi,type:gt});this.globals.push({type:gt,mutable:n.mutable,init:n.init})}}for(const n of this.ast.body){if(n.type==='ImportDecl'){const ti=this.getOrCreateType(n.params.map(p=>p.type),n.returnType);this.funcMap.set(n.name,this.imports.length);this.imports.push({name:n.name,module:n.module,typeIdx:ti,node:n})}}const iOff=this.imports.length;for(const n of this.ast.body){if(n.type==='FunctionDecl'){const ti=this.getOrCreateType(n.params.map(p=>p.type),n.returnType);this.funcMap.set(n.name,iOff+this.functions.length);this.functions.push({name:n.name,typeIdx:ti,node:n,locals:[],code:[],exported:n.exported})}}for(let i=0;i<this.functions.length;i++)this.genFunc(this.functions[i]);return this.encodeBinary()}genFunc(func){const n=func.node;this.currentLocals=[];this.localMap=new Map();this.currentCode=[];this.breakLabels=[];this.continueLabels=[];this.currentFuncRetType=n.returnType;for(const p of n.params)this.addLocal(p.name,p.type);this.genBlock(n.body);this.emit(Op.end);func.locals=this.currentLocals.slice(n.params.length);func.code=this.currentCode}genBlock(b){for(const s of b.statements)this.genStmt(s)}genStmt(s){switch(s.type){case'VarDecl':{let t=s.declType||s.varType;if(!t&&s.init)t=this.inferET(s.init);if(!t)t='int';const i=this.addLocal(s.name,t);if(s.init){this.genExpr(s.init,t);this.emit(Op.local_set,...eu32(i))}break}case'ReturnStmt':if(s.value)this.genExpr(s.value,this.currentFuncRetType);this.emit(Op.return);break;case'IfStmt':this.genExpr(s.condition,'bool');this.emit(Op.if,0x40);this.genBlock(s.consequent);if(s.alternate){this.emit(Op.else);if(s.alternate.type==='IfStmt')this.genStmt(s.alternate);else this.genBlock(s.alternate)}this.emit(Op.end);break;case'WhileStmt':this.emit(Op.block,0x40);this.emit(Op.loop,0x40);this.breakLabels.push(1);this.continueLabels.push(0);this.genExpr(s.condition,'bool');this.emit(Op.i32_eqz);this.emit(Op.br_if,...eu32(1));this.genBlock(s.body);this.emit(Op.br,...eu32(0));this.breakLabels.pop();this.continueLabels.pop();this.emit(Op.end);this.emit(Op.end);break;case'ForStmt':if(s.init)this.genStmt(s.init);this.emit(Op.block,0x40);this.emit(Op.loop,0x40);this.breakLabels.push(1);this.continueLabels.push(0);if(s.condition){this.genExpr(s.condition,'bool');this.emit(Op.i32_eqz);this.emit(Op.br_if,...eu32(1))}this.genBlock(s.body);if(s.update){this.genExpr(s.update);if(s.update.type!=='AssignExpr')this.emit(Op.drop)}this.emit(Op.br,...eu32(0));this.breakLabels.pop();this.continueLabels.pop();this.emit(Op.end);this.emit(Op.end);break;case'BreakStmt':if(this.breakLabels.length)this.emit(Op.br,...eu32(this.breakLabels[this.breakLabels.length-1]));break;case'ContinueStmt':if(this.continueLabels.length)this.emit(Op.br,...eu32(this.continueLabels[this.continueLabels.length-1]));break;case'ExprStmt':{this.genExpr(s.expression);const rt=this.exprResType(s.expression);if(rt!=='void')this.emit(Op.drop);break}case'BlockStmt':this.genBlock(s);break}}genExpr(e,exp){switch(e.type){case'IntLiteral':{const v=Number(e.value);if(exp==='i64'||exp==='int'||!exp)this.emit(Op.i64_const,...ei64(e.value));else if(exp==='f32')this.emit(Op.f32_const,...ef32(v));else if(exp==='f64'||exp==='num')this.emit(Op.f64_const,...ef64(v));else if(exp==='i32'||exp==='bool')this.emit(Op.i32_const,...ei32(v));else this.emit(Op.i64_const,...ei64(e.value));break}case'FloatLiteral':{const v=Number(e.value);if(exp==='f32')this.emit(Op.f32_const,...ef32(v));else this.emit(Op.f64_const,...ef64(v));break}case'BoolLiteral':this.emit(Op.i32_const,...ei32(e.value?1:0));break;case'StringLiteral':{var soff=this.addString(e.value);this.emit(Op.i32_const,...ei32(soff));break}case'NullLiteral':if(exp==='int'||exp==='i64'){this.emit(Op.i64_const,...ei64(0));break}this.target==='wasm64'?this.emit(Op.i64_const,...ei64(0)):this.emit(Op.i32_const,...ei32(0));break;case'IdentifierExpr':{const i=this.getLocal(e.name);if(i>=0)this.emit(Op.local_get,...eu32(i));else if(this.globalMap.has(e.name))this.emit(0x23,...eu32(this.globalMap.get(e.name).idx));else if(this.funcMap.has('__jsGlobal')){var _nPtr=this.addString(e.name);this.emit(Op.i32_const,...ei32(_nPtr));this.emit(Op.call,...eu32(this.funcMap.get('__jsGlobal')))}else this.emit(Op.i32_const,...ei32(0));break}case'BinaryExpr':this.genBinary(e,exp);break;case'UnaryExpr':{var unt=e.exprType||exp||this.inferET(e.operand)||'int';this.genExpr(e.operand,unt);if(e.op==='-'){if(unt==='num'||unt==='f64'){this.emit(Op.f64_const,...ef64(-1));this.emit(Op.f64_mul)}else if(unt==='f32'){this.emit(Op.f32_const,...ef32(-1));this.emit(Op.f32_mul)}else{this.emit(Op.i64_const,...ei64(-1));this.emit(Op.i64_mul)}}else if(e.op==='!')this.emit(Op.i32_eqz);else if(e.op==='~'){this.emit(Op.i32_const,...ei32(-1));this.emit(Op.i32_xor)}break}case'CallExpr':{if(e.callee.type==='MemberExpr'){if(this.funcMap.has('__jsCall')){this.genExpr(e.callee.object,'int');var _mP=this.addString(e.callee.property);this.emit(Op.i32_const,...ei32(_mP));this.genJsArgs(e.args);this.emit(Op.i64_const,...ei64(e.args.length));this.emit(Op.call,...eu32(this.funcMap.get('__jsCall')));this.jsCoerce(e,exp);break}else{this.emit(Op.i64_const,...ei64(0));break}}let fn;if(e.callee.type==='IdentifierExpr')fn=e.callee.name;const fi=this.funcMap.get(fn);if(fi===undefined){this.emit(Op.i32_const,...ei32(0));break}const fnode=this.lookupFuncNode(fn);for(let i=0;i<e.args.length;i++)this.genExpr(e.args[i],fnode?.params[i]?.type||'int');this.emit(Op.call,...eu32(fi));if(fnode&&((fnode.module==='js'&&fnode.returnType==='int')||fn==='jsAt'||fn==='jsGet'))this.jsCoerce(e,exp);break}case'NewExpr':this.genNew(e);this.jsCoerce(e,exp);break;case'MemberExpr':{if(this.funcMap.has('__jsGet')){this.genExpr(e.object,'int');var _gP=this.addString(e.property);this.emit(Op.i32_const,...ei32(_gP));this.emit(Op.call,...eu32(this.funcMap.get('__jsGet')));this.jsCoerce(e,exp)}else{this.emit(Op.i64_const,...ei64(0))}break}case'AssignExpr':if(e.target.type==='IdentifierExpr'){const i=this.getLocal(e.target.name);if(i>=0){this.genExpr(e.value);this.emit(Op.local_tee,...eu32(i))}else if(this.globalMap.has(e.target.name)){var ginfo=this.globalMap.get(e.target.name);this.genExpr(e.value,ginfo.type);this.emit(0x24,...eu32(ginfo.idx));this.emit(0x23,...eu32(ginfo.idx))}}else if(e.target.type==='MemberExpr'&&this.funcMap.has('__jsSet')){/* obj.prop = value  →  __jsSet(recv, "prop") with value written to slot 0 */ this.genJsSet(e)}break;case'ArrayLiteral':{
  /* [a, b, c]  →  let _arr = newArray(N); setItem(_arr, 0, a); ...; _arr */
  var _et=e.elemType||'int';
  var _setFn=_et==='num'?'setNumItem':'setItem';
  var _newIdx=this.funcMap.get('newArray');
  var _setIdx=this.funcMap.get(_setFn);
  if(_newIdx===undefined||_setIdx===undefined){this.emit(Op.i64_const,...ei64(0));break}
  /* Allocate: newArray(N) — returns handle (int) on stack */
  this.emit(Op.i64_const,...ei64(e.elements.length));
  this.emit(Op.call,...eu32(_newIdx));
  /* Stash result in a temp local */
  var _tmpIdx=this.addLocal('_arr$'+this.currentLocals.length,'int');
  this.emit(Op.local_set,...eu32(_tmpIdx));
  /* For each element: setItem(_arr, i, elem) */
  for(var _i=0;_i<e.elements.length;_i++){
    this.emit(Op.local_get,...eu32(_tmpIdx));
    this.emit(Op.i64_const,...ei64(_i));
    var _el=e.elements[_i];
    var _elT=(_el&&_el.exprType)||'int';
    if(_et==='num'){
      this.genExpr(_el,'num');
    }else if(_elT==='str'){
      /* String pointer is i32; setItem expects int (i64). Extend. */
      this.genExpr(_el,'str');
      this.emit(Op.i64_extend_i32_u);
    }else if(_elT==='bool'){
      this.genExpr(_el,'bool');
      this.emit(Op.i64_extend_i32_u);
    }else{
      this.genExpr(_el,'int');
    }
    this.emit(Op.call,...eu32(_setIdx));
  }
  /* Leave the array handle on the stack as the expression value */
  this.emit(Op.local_get,...eu32(_tmpIdx));
  break;
}default:this.emit(Op.i32_const,...ei32(0))}}genBinary(e,exp){const isCmp=['==','!=','<','>','<=','>='].includes(e.op),isLog=['&&','||'].includes(e.op);if(isLog){this.genExpr(e.left,'bool');if(e.op==='&&'){this.emit(Op.if,VT.i32);this.genExpr(e.right,'bool');this.emit(Op.else);this.emit(Op.i32_const,...ei32(0));this.emit(Op.end)}else{this.emit(Op.if,VT.i32);this.emit(Op.i32_const,...ei32(1));this.emit(Op.else);this.genExpr(e.right,'bool');this.emit(Op.end)}return}let nt=this.inferOpType(e.left,e.right);if(!isCmp&&exp&&exp!=='bool'){const rank={i32:0,bool:0,i64:1,int:1,f32:2,f64:3,num:3};if((rank[exp]||0)>(rank[nt]||0))nt=exp}this.genExpr(e.left,nt);this.genExpr(e.right,nt);const opmap={i32:{'+':Op.i32_add,'-':Op.i32_sub,'*':Op.i32_mul,'/':Op.i32_div_s,'%':Op.i32_rem_s,'&':Op.i32_and,'|':Op.i32_or,'^':Op.i32_xor,'<<':Op.i32_shl,'>>':Op.i32_shr_s,'==':Op.i32_eq,'!=':Op.i32_ne,'<':Op.i32_lt_s,'>':Op.i32_gt_s,'<=':Op.i32_le_s,'>=':Op.i32_ge_s},int:{'+':Op.i64_add,'-':Op.i64_sub,'*':Op.i64_mul,'/':Op.i64_div_s,'%':Op.i64_rem_s,'&':Op.i64_and,'|':Op.i64_or,'^':Op.i64_xor,'<<':Op.i64_shl,'>>':Op.i64_shr_s,'==':Op.i64_eq,'!=':Op.i64_ne,'<':Op.i64_lt_s,'>':Op.i64_gt_s,'<=':Op.i64_le_s,'>=':Op.i64_ge_s},num:{'+':Op.f64_add,'-':Op.f64_sub,'*':Op.f64_mul,'/':Op.f64_div,'==':Op.f64_eq,'!=':Op.f64_ne,'<':Op.f64_lt,'>':Op.f64_gt,'<=':Op.f64_le,'>=':Op.f64_ge}};const m=opmap[nt]||opmap.int;if(m[e.op]!==undefined)this.emit(m[e.op])}inferET(e){return(e&&e.exprType)||'int'}exprResType(e){if(e.type==='AssignExpr'){if(e.target&&e.target.type==='MemberExpr')return'void';return'int'}if(e.type==='CallExpr'){const n=e.callee?.name;const node=this.lookupFuncNode(n);if(node?.returnType==='void')return'void'}return'int'}encodeBinary(){const b=[];b.push(0,0x61,0x73,0x6D,1,0,0,0);const te=this.types.map(t=>[0x60,...eu32(t.params.length),...t.params,...eu32(t.results.length),...t.results]);if(te.length)b.push(...esec(1,evec(te)));const useCb=this.funcMap.has('fnRef')&&this.functions.length>0;if(this.imports.length||useCb){const ie=this.imports.map(imp=>[...estr(imp.module),...estr(imp.name),0x00,...eu32(imp.typeIdx)]);if(useCb){ie.push(this.cbTableImport());this.imports.cbCount=this.functions.length}b.push(...esec(2,evec(ie)))}const fi=this.functions.map(f=>eu32(f.typeIdx));if(fi.length)b.push(...esec(3,evec(fi)));const mf=this.target==='wasm64'?0x04:0x00;b.push(...esec(5,[1,mf,...eu32(1)]));if(this.globals.length){var ge=this.globals.map(function(g){var wt=this.j2w(g.type);var mut=g.mutable?1:0;var gv=this.globalInitValue(g);var initOp;if(wt===VT.i64)initOp=[Op.i64_const,...ei64(Math.trunc(gv)),0x0B];else if(wt===VT.f64)initOp=[Op.f64_const,...ef64(gv),0x0B];else if(wt===VT.f32)initOp=[Op.f32_const,...ef32(gv),0x0B];else initOp=[Op.i32_const,...ei32(Math.trunc(gv)),0x0B];return[wt,mut,...initOp]}.bind(this));b.push(...esec(6,evec(ge)))}const ex=[[...estr('memory'),2,...eu32(0)]];const iOff=this.imports.length;for(let i=0;i<this.functions.length;i++)if(this.functions[i].exported)ex.push([...estr(this.functions[i].name),0,...eu32(iOff+i)]);if(ex.length)b.push(...esec(7,evec(ex)));const cb=this.functions.map(func=>{const body=[];const nl=func.locals;const lg=[];if(nl.length){let ct=nl[0],cn=1;for(let i=1;i<nl.length;i++){if(nl[i]===ct)cn++;else{lg.push([...eu32(cn),ct]);ct=nl[i];cn=1}}lg.push([...eu32(cn),ct])}body.push(...eu32(lg.length));for(const g of lg)body.push(...g);body.push(...func.code);return[...eu32(body.length),...body]});if(useCb)b.push(...esec(9,this.cbElemSection()));if(cb.length)b.push(...esec(10,evec(cb)));if(this.strings.length){const de=this.strings.map(function(s){var db=[];var len=s.encoded.length;db.push(len&0xFF,(len>>8)&0xFF,(len>>16)&0xFF,(len>>24)&0xFF);for(var i=0;i<s.encoded.length;i++)db.push(s.encoded[i]);db.push(0);return[0x00,Op.i32_const,...ei32(s.offset),Op.end,...eu32(db.length),...db]});b.push(...esec(11,evec(de)))}return new Uint8Array(b)}}

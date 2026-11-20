#!/usr/bin/env node
// tact v2, headless. the same core as tact.html, cut out between its TACT-CORE markers. run: node tact.js FILE
// ==TACT-CORE-BEGIN==
// tact v2 core: spec + checker + interpreter + tests. no DOM. runs in a browser or under node.
(function (root) {
"use strict";
const VERSION = "tact v2";
const MAXDEPTH = 600, TOL = 1e-9, MAXLEN = 1e6, LINEBASE = 1e6;

/* ------------------------------------------------------------------ spec */
const PRELUDE = `(sum Opt [Some [?a] None []])
(sum Res [Ok [?a] Err [Str Str]])
(rec Pair [a ?a b ?b])`;
// packs: side loaded. the core spec stays short enough to sit in a model's context every time;
// a pack costs context only in the programs that say (use name).
const PACKS = {
  chart: { say: "line scatter bar hist and f(x) graphs as Draw shapes. loads draw", needs: ["draw"], types: "(rec Series [name Str xs (Vec Num) ys (Vec Num)])",
    notes: "a chart is a (Vec Draw): read it with ascii, keep it with svg, io.frame or io.sheet.\nsize w h 80..4096. light background, ticks on nice numbers, a legend for 2 or more series." },
  math: { say: "trig, gcd lcm clamp hypot, stats: median quantile sd corr, seeded shuffle", types: "", notes: "" },
  text: { say: "pad repeat wrap words, edit distance", types: "", notes: "" },
  csv: { say: "csv to rows or to maps by header, and back", types: "", notes: "rfc 4180: quotes, \"\" inside quotes, newlines inside quotes. a bad quote = E15." },
  re: { say: "regex: test find replace split", types: "", notes: "js unicode regex. a pattern written as a literal is checked before anything runs (E12).\na pattern like (a+)+ can take forever on some text: no budget stops a regex." },
  json: { say: "parse and print json as the Json sum", types: "(sum Json [JNull [] JBool [Bool] JNum [Num] JStr [Str] JArr [(Vec Json)] JObj [(Map Str Json)]])", notes: "match on Json has to face every case." },
  time: { say: "dates to and from ms", types: "", notes: "" },
  bit: { say: "whole number bit ops", types: "", notes: "" },
  bytes: { say: "utf8 bytes, base64, sha256, other bases", types: "", notes: "" },
  mat: { say: "vector math, matrices: multiply svd rank det solve pinv eig", types: "", notes: "@Mat = (Vec (Vec Num)). rows must be one length (E11)." },
  draw: { say: "shapes to pixels: text pictures, frames, png sheets", types: "(sum Draw [Line [Num Num Num Num Str] Box [Num Num Num Num Str] Dot [Num Num Str] Text [Num Num Num Str Str]])",
    notes: `a frame is a (Vec Draw), drawn in order: (Line x1 y1 x2 y2 color) (Box x y w h color) (Dot x y color)
(Text x y size s color): a 3x5 pixel font, size = pixel scale 1..64, a char is 4*size wide, 6*size tall.
x right, y down. color = "#rgb" "#rrggbb" (rgb r g b) or a short name, else E14.
shapes become pixels in the core: the same picture on every host.
to look at a frame:  (ascii w h shapes cols)  gives text, one char per cell, contrast stretched. pure. check works on it.
to keep the frames:  (io.frame w h shapes) adds one. (io.sheet "f.png" cols) writes them all
as one png grid, left to right, top to bottom: a whole animation in one image.` },
  io: { say: "files, paths, stdin, args, env, shell, http, clock", types: "(rec Sh [code Num out Str err Str])\n(rec Http [status Num body Str])",
    notes: `effects. args evaluate left to right, forms top to bottom.
hosts  node: files, shell, http, stdin, args, env.  browser: memory files, http.
what a host lacks = E13. what a host tried and could not do = E19. try catches both.` },
};
const KINDPACK = { chart: "chart", math: "math", text: "text", csv: "csv", re: "re", json: "json", time: "time", bit: "bit", bytes: "bytes", mat: "mat", kern: "mat", draw: "draw", io: "io" };

const SYNTAX = `TACT v2. one file = spec + checker + interpreter + tests. backend here: js.

PROGRAM = top forms only. anything else at top = E8.
  (let name expr)                  bind once ever. visible from the next form on.
  (fn name [p T  q T ..] R body)   declared boundary. every fn sees every fn.
  (rec Name [field T ..])          ctor (Name a b ..) positional. reader (Name.field r).
                                   immutable. a field may hold Name itself.
  (sum Name [A [T ..]  B []])      variants. (A x ..) builds one. B with no fields is a value.
  (show expr)                      print the value.
  (check expr expected)            ok, or ECHECK. numbers equal within 1e-9 (relative above 1).
  (do expr ..)                     run for effect. prints nothing.
  (use "lib.tact")                 take let fn rec sum check from a file. once per file.
                                   path is relative to the file that says use.
  (use name)                       load a pack of builtins. see PACKS.

EXPRESSIONS
  42  -1.5  2e3  "text"  true  false  name  [a b c]   vector items share one type
  {k v  k v}                       map. keys share one type, values share one type. {} is empty
  (f a b)                          call: builtin, fn, ctor, reader or fun value
  (if c a b)                       c is Bool. both branches same type
  (match x (A p q) e1  B e2  _ e3) arm = (Ctor names ..), Ctor, a literal, or _. patterns are flat.
                                   every ctor covered or a last _ arm, else E18. recs match too.
  (with [x e1  y e2] body)         sequential binds. no shadowing
  (fun [x y] body)                 lambda. types inferred. _ = a param or for name not used
  (fun [x y] R body)               lambda with declared result type
  (for [x xs  y ys] body)          flat: one vector over every combination
  (for [x xs] guard body)          guard = one Bool expression
  (-> x f (g 1) (h _ 2))           = (h (g (f x) 1) 2). bare name = call. _ = slot, one a step.
                                   no _ = insert as first arg. expands before check.
  (do a b c)                       in order. value of the last
  (cat a b c)                      one Str. a Str goes in as is, anything else as show prints it
  (up r Name.field v ..)           a copy of rec r with those fields replaced
  (try expr)                       (Ok value) or (Err "code" "msg"). catches any run error
  (fail "code" "msg")              E16. fits any type. try gives (Err "code" "msg")
  ; comment to eol                 escapes: \\n \\t \\r \\" \\\\

TYPES  Num  Bool  Str  (Vec T)  (Map K V)  (Fn A B R)  Name  (Name T ..)  ?a
       ?a in fn, rec and sum signatures: rigid inside a fn body, fresh at every use.
       a rec or sum that mentions ?a ?b takes them in order of first mention: (Pair Num Str).

BUILT IN TYPES
${PRELUDE.split("\n").map(l => "  " + l).join("\n")}

RULES  single assignment. no mutation. no loops. no shadowing (builtins and type names included).
       tail calls are free. other calls nest at most ${MAXDEPTH} deep (E9).
       Num is finite only: Inf or NaN = E17. a literal too big for a double = E12.
       = compares Num exactly. same compares any two values structurally.
       cmp orders any two values of one type. maps keep their keys in cmp order.
       functions compare by identity and have no order: two lambdas are never the same.
       and / or take exactly two args and evaluate both.
       vectors, maps and repeats are capped at ${MAXLEN} items (E17).
       io.print is the one effect in the core. the rest live in packs.

ERRORS check phase  E1-E8 E12 E18 E20   every error reported at once, each with its line. nothing runs.
       once names and types are clean, every top form that reaches no io and no regex is tried,
       under a small budget. a run error it ends in is reported in the check phase, all at once.
       a form that reaches io is only read: an error its literals and lets make certain, on code
       that must run, is reported. the rest wait for the run.
       run phase    E9-E11 E13-E17 E19 ECHECK   stops at the first. try catches all but ECHECK.

CLI    tact FILE [args ..] | -e SRC | - | --spec [PACK|all] | --check FILE | --sigs FILE | --test | --fuzz N SEED | --list [PACK|all] | --run FILE | --show FILE`;

const MATRIX = `name kind n in out note
if form 3 Bool,@T,@T @T branches same type
match form 3+ x,arms @T flat patterns. all ctors or a last _
with form 2 binds,body @T sequential no shadow
fun form 2|3 params,[@T],body @fn types inferred or declared
for form 2|3 binds,[when],body @Vec.@T flat. guard total
-> form 2+ x,steps @T bare name calls. _ = slot. no _ = first
do form 1+ exprs @T in order. last value
cat form 1+ any Str Str as is. rest as shown
try form 1 @T @Res.@T Ok value or Err code msg
up form 3+ r,field,value.. @T copy of a rec. fields replaced
fail form 2 Str,Str @T E16. fits any position
( form ! f,args @T call
[ form ! @T... @Vec.@T one type
{ form ! k,v... @Map.@K.@V key type. value type
; form ! ! ! comment to eol
esc form ! ! ! \\n \\t \\r \\" \\\\
let top 2 name,expr ! bind once ever
fn top 4 name,params,@T,body ! declared boundary
show top 1 expr ! print
check top 2 expr,expected ! tol 1e-9. ok or slip
rec top 2 Name,fields ! ctor positional. Name.field reader. immutable. self ref ok
sum top 2 Name,variants ! Ctor [T ..] pairs. no fields = a value
do top 1+ exprs ! effects. prints nothing
use top 1 Str|name ! a file: its let fn rec sum check, once. a name: that pack
Num type ! ! ! finite
Bool type ! ! ! !
Str type ! ! ! !
Vec type 1 @T ! all one type
Map type 2 @K,@V ! keys in cmp order
Fn type 1+ @A..,@R ! !
?a type ! ! ! fn rec sum signatures
Opt type 1 @T ! Some x. None
Res type 1 @T ! Ok x. Err code msg
Pair type 2 @A,@B ! Pair.a Pair.b
Json json ! ! ! JNull JBool JNum JStr JArr JObj
Sh io ! ! ! Sh.code Sh.out Sh.err
Http io ! ! ! Http.status Http.body
Draw draw ! ! ! Line Box Dot Text. see notes
pi num ! ! Num a value. not a call
neg num 1 Num Num !
abs num 1 Num Num !
sign num 1 Num Num -1 0 1
sqrt num 1 Num Num E17 neg
exp num 1 Num Num E17 overflow
log num 1 Num Num E17 nonpos
sin num 1 Num Num !
cos num 1 Num Num !
tan math 1 Num Num !
asin math 1 Num Num E17 outside -1..1
acos math 1 Num Num E17 outside -1..1
atan math 1 Num Num !
atan2 math 2 Num,Num Num y x
floor num 1 Num Num !
ceil num 1 Num Num !
round num 1 Num Num half goes up
trunc num 1 Num Num toward zero
isint num 1 Num Bool !
+ num 2 Num,Num Num !
- num 2 Num,Num Num !
* num 2 Num,Num Num !
/ num 2 Num,Num Num E17 zero
rem num 2 Num,Num Num sign of a
mod num 2 Num,Num Num sign of b
idiv num 2 Num,Num Num floor of a/b
pow num 2 Num,Num Num E17 bad
max num 2 Num,Num Num !
min num 2 Num,Num Num !
iroot num 2 Num,Num Num largest r r^k<=v exact
rand num 2 Num,Num @Vec.Num seed n. uniform 0..1. same seed same numbers
= cmp 2 Num,Num Bool exact
< cmp 2 Num,Num Bool !
<= cmp 2 Num,Num Bool !
> cmp 2 Num,Num Bool !
>= cmp 2 Num,Num Bool !
cmp cmp 2 @T,@T Num -1 0 1. structural. E17 on functions
not bool 1 Bool Bool !
and bool 2 Bool,Bool Bool strict. nest for more
or bool 2 Bool,Bool Bool strict. nest for more
len vec 1 @Vec.@T Num !
get vec 2 @Vec.@T,Num @T E10
first vec 1 @Vec.@T @Opt.@T !
last vec 1 @Vec.@T @Opt.@T !
slice vec 3 @Vec.@T,Num,Num @Vec.@T a..b-1. 0<=a<=b<=len
take vec 2 @Vec.@T,Num @Vec.@T first n. fewer if short
drop vec 2 @Vec.@T,Num @Vec.@T all but first n
push vec 2 @Vec.@T,@T @Vec.@T new vector. x at the end
concat vec 2 @Vec.@T,@Vec.@T @Vec.@T !
rev vec 1 @Vec.@T @Vec.@T !
rep vec 2 Num,@T @Vec.@T n copies
has vec 2 @Vec.@T,@T Bool structural exact
index vec 2 @Vec.@T,@T @Opt.Num first place
chunk vec 2 @Vec.@T,Num @Vec.@Vec.@T runs of n. last may be short
zip vec 2 @Vec.@A,@Vec.@B @Vec.@Pair E11
enum vec 1 @Vec.@T @Vec.@Pair Pair i x
order vec 1 @Vec.@T @Vec.@T asc by cmp. stable
range vnum 1 Num @Vec.Num 0..n-1
onehot mat 2 Num,Num @Vec.Num n zeros 1 at i
vadd mat 2 @Vec.Num,@Vec.Num @Vec.Num E11
vsub mat 2 @Vec.Num,@Vec.Num @Vec.Num E11
scale mat 2 @Vec.Num,Num @Vec.Num !
vsum vnum 1 @Vec.Num Num !
vnorm mat 1 @Vec.Num Num !
vmax vnum 1 @Vec.Num Num E10 empty
vmin vnum 1 @Vec.Num Num E10 empty
mean vnum 1 @Vec.Num Num E10 empty
dot mat 2 @Vec.Num,@Vec.Num Num E11
sort vnum 1 @Vec.Num @Vec.Num asc
map hof 2 @fn,@Vec.@T @Vec.@T !
map2 hof 3 @fn,@Vec.@T,@Vec.@T @Vec.@T E11
fold hof 3 @fn,@T,@Vec.@T @T !
scan hof 3 @fn,@T,@Vec.@T @Vec.@T every fold step
filter hof 2 @fn,@Vec.@T @Vec.@T !
find hof 2 @fn,@Vec.@T @Opt.@T first that holds
any hof 2 @fn,@Vec.@T Bool !
all hof 2 @fn,@Vec.@T Bool !
count hof 2 @fn,@Vec.@T Num how many hold
sortby hof 2 @fn,@Vec.@T @Vec.@T asc by cmp of key. stable
group hof 2 @fn,@Vec.@T @Map key to items in order
iter hof 3 @fn,@T,Num @T f applied n times
else opt 2 @Opt.@T,@T @T value or fallback
need opt 2 @Opt.@T,Str @T value or E16 with msg
unwrap opt 1 @Res.@T @T value or the caught error again
mget map 2 @Map,@K @Opt.@V !
mput map 3 @Map,@K,@V @Map new map
mdel map 2 @Map,@K @Map new map
mhas map 2 @Map,@K Bool !
mlen map 1 @Map Num !
mkeys map 1 @Map @Vec.@K cmp order
mvals map 1 @Map @Vec.@V key order
mitems map 1 @Map @Vec.@Pair Pair k v
mfrom map 1 @Vec.@Pair @Map later wins
mmerge map 2 @Map,@Map @Map second wins
mupd map 4 @Map,@K,@V,@fn @Map f on the value. or on the given default
mmap map 2 @fn,@Map @Map f on every value
matmul mat 2 @Mat,@Mat @Mat E11
tpose mat 1 @Mat @Mat !
svdvals mat 1 @Mat @Vec.Num desc
slen str 1 Str Num !
sget str 2 Str,Num Str by char. E10
ssub str 3 Str,Num,Num Str by char. 0<=a<=b<=len
scat str 2 Str,Str Str !
slt str 2 Str,Str Bool by code point
code str 1 Str Num first char. E10 empty
chr str 1 Num Str !
split str 2 Str,Str @Vec.Str sep "" = chars
lines str 1 Str @Vec.Str \\n or \\r\\n. no empty last
join str 2 @Vec.Str,Str Str !
upper str 1 Str Str !
lower str 1 Str Str !
trim str 1 Str Str both ends
starts str 2 Str,Str Bool s prefix
ends str 2 Str,Str Bool s suffix
shas str 2 Str,Str Bool s part
sfind str 2 Str,Str @Opt.Num by char. first place
sreplace str 3 Str,Str,Str Str s old new. every one
srep text 2 Str,Num Str n copies
padl text 3 Str,Num,Str Str to width. fill on the left
padr text 3 Str,Num,Str Str to width. fill on the right
snum str 1 Str Num E15
pnum str 1 Str @Opt.Num snum that cannot fail
fix str 2 Num,Num Str x with d decimals
radix bytes 2 Num,Num Str whole n in base 2..36
pradix bytes 2 Str,Num @Opt.Num read base 2..36
str str 1 @T Str !
svg draw 3 Num,Num,@Vec.Draw Str w h shapes. an svg file as text
rgb draw 3 Num,Num,Num Str #rrggbb. each clamped to 0..255
ascii draw 4 Num,Num,@Vec.Draw,Num Str w h shapes cols. text picture. rows = cols*h/w/2. background = space. most ink = @
utf8 bytes 1 Str @Vec.Num bytes
unutf8 bytes 1 @Vec.Num Str E15 bad bytes
b64.enc bytes 1 Str Str utf8 then base64
b64.dec bytes 1 Str Str E15
re.test re 2 Str,Str Bool pattern s. js unicode regex
re.find re 2 Str,Str @Vec.@Vec.Str every match. [whole g1 g2 ..]
re.replace re 3 Str,Str,Str Str pattern s new. every match. $1 = group
re.split re 2 Str,Str @Vec.Str pattern s. groups stay in the result
json.parse json 1 Str Json E15
json.str json 1 Json Str compact. keys in cmp order
json.pretty json 1 Json Str 2 space indent
json.get json 2 Json,Str @Opt.Json field of a JObj
date.iso time 1 Num Str ms since 1970 to iso utc
date.parse time 1 Str Num iso only. a time needs Z or +hh:mm. E15
bxor bit 2 Num,Num Num ints
band bit 2 Num,Num Num ints
bor bit 2 Num,Num Num ints
shl bit 2 Num,Num Num ints
shr bit 2 Num,Num Num ints
pairs build 2 Num,Num @Mat [i j] lo<=i<j<hi
uniq build 1 @Vec.@T @Vec.@T structural exact
flat build 1 @Vec.@Vec.@T @Vec.@T one level
same build 2 @T,@T Bool structural exact
k.svd kern 1 @Mat @Vec.Num desc
k.matmul kern 2 @Mat,@Mat @Mat !
k.rank kern 1 @Mat Num threshold not measure
k.det kern 1 @Mat Num !
k.solve kern 2 @Mat,@Mat @Mat E14 singular
k.pinv kern 1 @Mat @Mat !
k.eig kern 1 @Mat @Mat [[re..] [im..]] re desc. E14 not square
k.randn kern 3 Num,Num,Num @Mat rows cols seed. per backend
k.backend kern 0 ! Str numpy or js
io.print str 1 Str Str one line out. gives the Str back
io.read io 1 Str Str E19
io.write io 2 Str,Str Num path text. chars written
io.append io 2 Str,Str Num path text
io.exists io 1 Str Bool !
io.isdir io 1 Str Bool !
io.ls io 1 Str @Vec.Str names. sorted
io.rm io 1 Str Bool file or empty dir. false = was not there
io.mkdir io 1 Str Bool parents too
io.readb io 1 Str @Vec.Num bytes
io.writeb io 2 Str,@Vec.Num Num bytes 0..255
io.stdin io 0 ! Str all of it
io.args io 0 ! @Vec.Str after FILE on the command line
io.env io 1 Str @Opt.Str !
io.sh io 1 Str Sh shell line. exit code is data not an error
io.exec io 3 Str,@Vec.Str,Str Sh program args stdin. no shell
io.http io 4 Str,Str,@Map,Str Http method url headers body. status is data
io.now io 0 ! Num ms since 1970
io.rand io 0 ! Num 0..1. not seeded
io.sleep io 1 Num Num ms
io.frame draw 3 Num,Num,@Vec.Draw Num width height shapes. frames so far. E14 bad color
io.sheet draw 2 Str,Num Num path cols. every frame so far as one png grid
gcd math 2 Num,Num Num whole numbers
lcm math 2 Num,Num Num whole numbers
clamp math 3 Num,Num,Num Num x lo hi
hypot math 2 Num,Num Num no overflow on the way
median math 1 @Vec.Num Num E10 empty
quantile math 2 @Vec.Num,Num Num q in 0..1. linear between
sd math 1 @Vec.Num Num sample. E10 under 2
corr math 2 @Vec.Num,@Vec.Num Num pearson. E11 E17 flat
shuffle math 2 Num,@Vec.@T @Vec.@T seed v. same seed same order
words text 1 Str @Vec.Str split on whitespace. no empties
wrap text 2 Str,Num @Vec.Str lines of at most width. long words alone
edits text 2 Str,Str Num edit distance by char
csv.parse csv 1 Str @Vec.@Vec.Str rows of fields
csv.str csv 1 @Vec.@Vec.Str Str quotes where needed. a newline per row
csv.maps csv 1 Str @Vec.@Map first row = keys. E15 short row
sha256 bytes 1 Str Str utf8 then hex
path.join io 2 Str,Str Str b absolute wins. normalized
path.dir io 1 Str Str "." if none
path.base io 1 Str Str last part
path.ext io 1 Str Str ".txt" or ""
Series chart ! ! ! Series name xs ys. xs ys same length
chart.line chart 4 Num,Num,Str,@Vec.Series @Vec.Draw w h title series. joins points in the order given
chart.scatter chart 4 Num,Num,Str,@Vec.Series @Vec.Draw w h title series. a mark a point
chart.bar chart 5 Num,Num,Str,@Vec.Str,@Vec.Num @Vec.Draw w h title labels values. from 0. E11
chart.hist chart 5 Num,Num,Str,@Vec.Num,Num @Vec.Draw w h title values bins. equal width bins
chart.fn chart 6 Num,Num,Str,@fn,Num,Num @Vec.Draw w h title f lo hi. f at every pixel. an f error stops it
E1 err ! ! ! check. unknown name. nearest known. or the pack to use. or the tact for a foreign word
E2 err ! ! ! check. wrong arity
E3 err ! ! ! check. rebind or shadow
E4 err ! ! ! check. type mismatch. arg named
E5 err ! ! ! check. if or match branches differ
E6 err ! ! ! check. mixed vector or map literal
E7 err ! ! ! check. condition not Bool
E8 err ! ! ! check. misplaced top or body form
E9 err ! ! ! run. depth 600
E10 err ! ! ! run. index out of range
E11 err ! ! ! run. length or shape
E12 err ! ! ! check. parse. bad regex literal. use unreadable
E13 err ! ! ! run. this host lacks it
E14 err ! ! ! run. refused input
E15 err ! ! ! run. unreadable text
E16 err ! ! ! run. fail on purpose
E17 err ! ! ! run. domain. nonfinite
E18 err ! ! ! check. match not exhaustive or arm unreachable
E19 err ! ! ! run. io failed
E20 err ! ! ! check. bound and never used. with and match
ECHECK err ! ! ! run. check sides differ`;

/* ------------------------------------------------------------------ errors */
class TErr extends Error { constructor(code, msg, line) { super(msg); this.code = code; this.line = line; } }
const E = (code, msg, line) => ({ code, msg, line });
const R = (code, msg) => { throw new TErr(code, msg); };
let FILES = [""];                    // a line from a used file is fileIndex * LINEBASE + line
const LN = n => n < LINEBASE ? String(n) : `${n % LINEBASE} of ${FILES[Math.floor(n / LINEBASE)]}`;

const FORMS = { "if": 3, "with": 2, "fun": [2, 3], "for": [2, 3], "->": "2+", "fail": 2, "match": "3+odd", "try": 1, "do": "1+", "cat": "1+", "up": "3+odd" };
const TOPS = { "let": 2, "fn": 4, "show": 1, "check": 2, "rec": 2, "sum": 2, "do": "1+", "use": 1 };
const TYPENAMES = ["Num", "Bool", "Str", "Vec", "Fn", "Map"];
const RESERVED = new Set([...Object.keys(FORMS), ...Object.keys(TOPS), ...TYPENAMES, "true", "false", "_"]);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/* ------------------------------------------------------------------ format */
function fmtNum(v) {
  if (v === 0) return "0";
  if (Number.isInteger(v) && Math.abs(v) < 1e21) return String(v);
  return String(Number(v.toPrecision(15)));
}
function quote(s) {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/\r/g, "\\r") + '"';
}
let FMTN = 0;
function fmt(v, top) { FMTN = 0; return fmt1(v, top); }
function fmt1(v, top) {
  if (++FMTN > 2e6) R("E17", "value too large to print");
  if (typeof v === "number") return fmtNum(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return top ? v : quote(v);
  if (Array.isArray(v)) return "[" + v.map(x => fmt1(x, false)).join(" ") + "]";
  switch (v.k) {
    case "rv": return v.nul ? v.name : "(" + [v.name, ...v.vals.map(x => fmt1(x, false))].join(" ") + ")";
    case "map": return "{" + tnodes(v.root).map(n => fmt1(n.key, false) + " " + fmt1(n.val, false)).join(" ") + "}";
    case "clo": return v.name ? `<fn ${v.name}>` : "<fun>";
    case "bi": return `<builtin ${v.name}>`;
    case "ctor": return `<ctor ${v.name}>`;
    case "rd": return `<reader ${v.name}>`;
  }
  return "?";
}
function sx(s) {
  if (!s) return "?";
  switch (s.t) {
    case "num": return fmtNum(s.v);
    case "str": return quote(s.v);
    case "sym": return s.v;
    case "list": return "(" + s.items.map(sx).join(" ") + ")";
    case "vec": return "[" + s.items.map(sx).join(" ") + "]";
    case "map": return "{" + s.items.map(sx).join(" ") + "}";
  }
  return "?";
}

/* ------------------------------------------------------------------ lex + parse */
const NUMRE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const OPEN = { "(": ")", "[": "]", "{": "}" }, KIND = { "(": "list", "[": "vec", "{": "map" };
const isClose = k => k === ")" || k === "]" || k === "}";
function lex(src, errs, base = 0) {
  const toks = []; let i = 0, line = base + 1; const n = src.length;
  const ESC = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\" };
  while (i < n) {
    const c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === ";") { while (i < n && src[i] !== "\n") i++; continue; }
    if (own(OPEN, c) || isClose(c)) { toks.push({ k: c, line }); i++; continue; }
    if (c === '"') {
      let s = "", j = i + 1, ok = false; const l0 = line;
      while (j < n) {
        const d = src[j];
        if (d === '"') { ok = true; j++; break; }
        if (d === "\\") {
          const e = src[j + 1];
          if (e !== undefined && own(ESC, e)) s += ESC[e];
          else errs.push(E("E12", `bad escape \\${e === undefined ? "" : e}; use \\n \\t \\r \\" \\\\`, line));
          j += 2; continue;
        }
        if (d === "\n") line++;
        s += d; j++;
      }
      if (!ok) errs.push(E("E12", "unterminated string", l0));
      toks.push({ k: "str", v: s, line: l0 }); i = j; continue;
    }
    let j = i; while (j < n && !/[\s()\[\]{};"]/.test(src[j])) j++;
    const w = src.slice(i, j); i = j;
    if (NUMRE.test(w)) {
      const v = Number(w);
      if (!Number.isFinite(v)) errs.push(E("E12", `number literal ${w} is too big`, line));
      toks.push({ k: "num", v: Number.isFinite(v) && v !== 0 ? v : 0, line });
    } else toks.push({ k: "sym", v: w, line });
  }
  return toks;
}
function parse(toks, errs) {
  let p = 0, depth = 0, deep = false; const out = [];
  function item() {
    const t = toks[p++];
    if (own(OPEN, t.k)) {
      const close = OPEN[t.k], items = [];
      if (++depth > 200 && !deep) { deep = true; errs.push(E("E12", "nested more than 200 deep. name the inner parts with let, with or fn", t.line)); }
      while (p < toks.length && toks[p].k !== close) {
        if (isClose(toks[p].k)) {
          errs.push(E("E12", `${toks[p].k} does not match ${t.k} opened on line ${LN(t.line)}`, toks[p].line)); p++; continue;
        }
        items.push(item());
      }
      if (p >= toks.length) errs.push(E("E12", `${t.k} opened here is never closed`, t.line)); else p++;
      depth--;
      return { t: KIND[t.k], items, line: t.line };
    }
    if (t.k === "num") return { t: "num", v: t.v, line: t.line };
    if (t.k === "str") return { t: "str", v: t.v, line: t.line };
    return { t: "sym", v: t.v, line: t.line };
  }
  while (p < toks.length) {
    if (isClose(toks[p].k)) { errs.push(E("E12", `unexpected ${toks[p].k}`, toks[p].line)); p++; continue; }
    out.push(item());
  }
  return out;
}

/* ------------------------------------------------------------------ lower (s-expr -> AST). -> expands here */
const isSym = s => s && s.t === "sym";
const arityOk = (spec, n) => Array.isArray(spec) ? spec.includes(n) : spec === "2+" ? n >= 2 : spec === "1+" ? n >= 1 : spec === "3+odd" ? n >= 3 && n % 2 === 1 : n === spec;
const arityTxt = spec => Array.isArray(spec) ? spec.join(" or ") : spec === "2+" ? "2 or more" : spec === "1+" ? "1 or more" : spec === "3+odd" ? "a value then pairs:" : String(spec);

function pairs(v, what, kind, errs, L) {
  if (!v || v.t !== "vec") { errs.push(E("E12", `${what}: expected [name ${kind} ..]`, v ? v.line : L)); return null; }
  if (v.items.length % 2) { errs.push(E("E12", `${what}: odd item count, need name ${kind} pairs`, v.line)); return null; }
  const out = [];
  for (let i = 0; i < v.items.length; i += 2) {
    const n = v.items[i];
    if (!isSym(n)) { errs.push(E("E12", `${what}: ${sx(n)} is not a name`, n.line)); return null; }
    out.push([n.v, v.items[i + 1], n.line]);
  }
  return out;
}
function lowerTop(s, errs) {
  const head = s.t === "list" && s.items.length && isSym(s.items[0]) ? s.items[0].v : null;
  if (!head || !own(TOPS, head)) {
    errs.push(E("E8", head && own(FORMS, head)
      ? `(${head} ..) is an expression; at top level wrap it in (show ..) or (let name ..)`
      : head && foreign(head) ? foreign(head)
      : `top level takes only (let ..) (fn ..) (rec ..) (sum ..) (show ..) (check ..) (do ..) (use ..); got ${sx(s).slice(0, 40)}`, s.line));
    return null;
  }
  const a = s.items.slice(1), L = s.line;
  if (!arityOk(TOPS[head], a.length)) { errs.push(E("E2", `${head} takes ${arityTxt(TOPS[head])} parts, got ${a.length}`, L)); return null; }
  const name = what => { if (isSym(a[0])) return a[0].v; errs.push(E("E12", `${what} needs a name, got ${sx(a[0])}`, L)); return null; };
  switch (head) {
    case "let": { const n = name("let"); if (n === null) return null; return { t: "let", name: n, expr: lowerExpr(a[1], errs), line: L }; }
    case "show": return { t: "show", expr: lowerExpr(a[0], errs), line: L };
    case "do": return { t: "dotop", exprs: a.map(x => lowerExpr(x, errs)), line: L };
    case "check": return { t: "check", a: lowerExpr(a[0], errs), b: lowerExpr(a[1], errs), line: L };
    case "fn": {
      const n = name("fn"); const ps = pairs(a[1], "fn params", "Type", errs, L);
      if (n === null || !ps) return null;
      return { t: "fn", name: n, params: ps, ret: a[2], body: lowerExpr(a[3], errs), line: L };
    }
    case "rec": {
      const n = name("rec"); const fs = pairs(a[1], "rec fields", "Type", errs, L);
      if (n === null || !fs) return null;
      return { t: "rec", name: n, fields: fs, line: L };
    }
    case "sum": {
      const n = name("sum"); const cs = pairs(a[1], "sum variants", "[T ..]", errs, L);
      if (n === null || !cs) return null;
      if (!cs.length) { errs.push(E("E12", `sum ${n} needs at least one variant`, L)); return null; }
      for (const [c, v, l] of cs) if (v.t !== "vec") { errs.push(E("E12", `sum ${n}: after ${c} write its field types as [T ..], or [] for none`, l)); return null; }
      return { t: "sum", name: n, ctors: cs, line: L };
    }
    case "use": {
      if (isSym(a[0]) && own(PACKS, a[0].v)) return { t: "use", pack: a[0].v, line: L };
      if (isSym(a[0])) { const near = nearest(a[0].v, Object.keys(PACKS)); errs.push(E("E1", `unknown pack ${a[0].v}` + (near ? `. nearest known: ${near}` : "") + `. packs: ${Object.keys(PACKS).join(" ")}`, L)); }
      else errs.push(E("E12", `use takes a "path" or a pack name`, L));
      return null;
    }
  }
}
function lowerExpr(s, errs) {
  switch (s.t) {
    case "num": return { t: "num", v: s.v, line: s.line };
    case "str": return { t: "str", v: s.v, line: s.line };
    case "errx": return { t: "err", line: s.line };
    case "sym":
      if (s.v === "true" || s.v === "false") return { t: "bool", v: s.v === "true", line: s.line };
      if (own(FORMS, s.v) || own(TOPS, s.v)) { errs.push(E("E8", `${s.v} is a form; write (${s.v} ..)`, s.line)); return { t: "err", line: s.line }; }
      return { t: "var", name: s.v, line: s.line };
    case "vec": return { t: "vec", items: s.items.map(x => lowerExpr(x, errs)), line: s.line };
    case "map": {
      if (s.items.length % 2) { errs.push(E("E12", "map literal: odd item count, need key value pairs", s.line)); return { t: "err", line: s.line }; }
      const ps = [];
      for (let i = 0; i < s.items.length; i += 2) ps.push([lowerExpr(s.items[i], errs), lowerExpr(s.items[i + 1], errs)]);
      return { t: "map", pairs: ps, line: s.line };
    }
    case "list": {
      const L = s.line;
      if (!s.items.length) { errs.push(E("E12", "empty () is not an expression", L)); return { t: "err", line: L }; }
      const h = s.items[0], a = s.items.slice(1);
      if (isSym(h) && own(FORMS, h.v)) return lowerForm(h.v, a, L, errs);
      if (isSym(h) && own(TOPS, h.v)) {
        const INSIDE = { let: "use (with [name expr] body)", fn: "use (fun [x] body), or move the fn to top level", sum: "to add numbers use (vsum v)", show: "use (io.print (str x)) or move it to top level", check: "move it to top level", rec: "move it to top level", use: "move it to top level" };
        errs.push(E("E8", `(${h.v} ..) is a top form; not allowed inside an expression. ${INSIDE[h.v]}`, L)); return { t: "err", line: L };
      }
      return { t: "call", f: lowerExpr(h, errs), args: a.map(x => lowerExpr(x, errs)), line: L };
    }
  }
  return { t: "err", line: s.line };
}
function lowerPat(p, errs) {
  const flat = () => { errs.push(E("E12", `pattern ${sx(p)}: write Ctor, (Ctor a b ..), a literal or _. patterns are flat: match again inside`, p.line)); return null; };
  if (p.t === "num" || p.t === "str") return { k: "lit", v: p.v, line: p.line };
  if (p.t === "sym") {
    if (p.v === "_") return { k: "any", line: p.line };
    if (p.v === "true" || p.v === "false") return { k: "lit", v: p.v === "true", line: p.line };
    return { k: "ctor", name: p.v, binds: null, line: p.line };
  }
  if (p.t === "list" && p.items.length && p.items.every(isSym)) {
    const [h, ...r] = p.items;
    if (RESERVED.has(h.v)) return flat();
    return { k: "ctor", name: h.v, binds: r.map(x => x.v === "_" ? null : x.v), line: p.line };
  }
  return flat();
}
function lowerForm(k, a, L, errs) {
  const bad = { t: "err", line: L };
  if (!arityOk(FORMS[k], a.length)) { errs.push(E("E2", `${k} takes ${arityTxt(FORMS[k])} parts, got ${a.length}` + (k === "if" && a.length === 2 ? ". if needs both branches" : ""), L)); return bad; }
  const X = s => lowerExpr(s, errs);
  switch (k) {
    case "if": return { t: "if", c: X(a[0]), a: X(a[1]), b: X(a[2]), line: L };
    case "do": return { t: "do", items: a.map(X), line: L };
    case "cat": return { t: "cat", items: a.map(X), line: L };
    case "try": return { t: "try", e: X(a[0]), line: L };
    case "up": {
      const sets = [];
      for (let i = 1; i < a.length; i += 2) {
        if (!isSym(a[i])) { errs.push(E("E12", `up: ${sx(a[i])} is not a field. write Name.field then its new value`, a[i].line)); return bad; }
        sets.push({ field: a[i].v, e: X(a[i + 1]), line: a[i].line });
      }
      return { t: "up", x: X(a[0]), sets, line: L };
    }
    case "match": {
      const arms = []; let ok = true;
      for (let i = 1; i < a.length; i += 2) { const p = lowerPat(a[i], errs); if (!p) ok = false; else arms.push({ p, body: X(a[i + 1]), line: a[i].line }); }
      return ok ? { t: "match", x: X(a[0]), arms, line: L } : bad;
    }
    case "with": {
      const bs = pairs(a[0], "with binds", "expr", errs, L); if (!bs) return bad;
      return { t: "with", binds: bs.map(([n, x, l]) => [n, X(x), l]), body: X(a[1]), line: L };
    }
    case "for": {
      const bs = pairs(a[0], "for binds", "vector", errs, L); if (!bs) return bad;
      return { t: "for", binds: bs.map(([n, x, l]) => [n, X(x), l]), guard: a.length === 3 ? X(a[1]) : null, body: X(a[a.length - 1]), line: L };
    }
    case "fun": {
      const p = a[0];
      if (!p || p.t !== "vec" || !p.items.every(isSym)) { errs.push(E("E12", "fun params: expected [x y ..], names only. types are inferred", L)); return bad; }
      return { t: "fun", params: p.items.map(s => s.v), pline: p.line, ret: a.length === 3 ? a[1] : null, body: X(a[a.length - 1]), line: L };
    }
    case "fail": return { t: "fail", a: X(a[0]), b: X(a[1]), line: L };
    case "->": return X(thread(a, errs));
  }
  return bad;
}
function thread(a, errs) {
  let acc = a[0];
  if (a.length > 201) { errs.push(E("E12", "-> has more than 200 steps. split it with a let", a[0].line)); return { t: "errx", line: a[0].line }; }
  for (const st of a.slice(1)) {
    if (isSym(st)) acc = { t: "list", items: [st, acc], line: st.line };
    else if (st.t === "list" && st.items.length) {
      const slot = x => isSym(x) && x.v === "_", isMatch = isSym(st.items[0]) && st.items[0].v === "match";
      const n = isMatch ? 0 : st.items.filter(slot).length;      // in a match step _ is the wildcard arm
      if (n > 1) { errs.push(E("E8", "-> step has more than one _. the value would be computed twice: bind it with (with [x ..] ..)", st.line)); return { t: "errx", line: st.line }; }
      acc = n ? { t: "list", items: st.items.map(x => slot(x) ? acc : x), line: st.line }
        : { t: "list", items: [st.items[0], acc, ...st.items.slice(1)], line: st.line };
    } else { errs.push(E("E8", `-> step must be a name or (call ..), got ${sx(st)}`, st.line)); return { t: "errx", line: st.line }; }
  }
  return acc;
}
function unPat(p) {
  if (p.k === "any") return "_";
  if (p.k === "lit") return typeof p.v === "string" ? quote(p.v) : typeof p.v === "number" ? fmtNum(p.v) : String(p.v);
  return p.binds ? "(" + [p.name, ...p.binds.map(b => b === null ? "_" : b)].join(" ") + ")" : p.name;
}
function un(e) {
  switch (e.t) {
    case "num": return fmtNum(e.v);
    case "str": return quote(e.v);
    case "bool": return String(e.v);
    case "var": return e.name;
    case "vec": return "[" + e.items.map(un).join(" ") + "]";
    case "map": return "{" + e.pairs.map(([k, v]) => un(k) + " " + un(v)).join(" ") + "}";
    case "do": case "cat": return "(" + [e.t, ...e.items.map(un)].join(" ") + ")";
    case "try": return `(try ${un(e.e)})`;
    case "up": return "(" + ["up", un(e.x), ...e.sets.map(s => s.field + " " + un(s.e))].join(" ") + ")";
    case "match": return "(" + ["match", un(e.x), ...e.arms.map(a => unPat(a.p) + " " + un(a.body))].join(" ") + ")";
    case "if": return `(if ${un(e.c)} ${un(e.a)} ${un(e.b)})`;
    case "with": return `(with [${e.binds.map(([n, x]) => n + " " + un(x)).join(" ")}] ${un(e.body)})`;
    case "fun": return `(fun [${e.params.join(" ")}]${e.ret ? " " + sx(e.ret) : ""} ${un(e.body)})`;
    case "for": return `(for [${e.binds.map(([n, x]) => n + " " + un(x)).join(" ")}]${e.guard ? " " + un(e.guard) : ""} ${un(e.body)})`;
    case "fail": return `(fail ${un(e.a)} ${un(e.b)})`;
    case "call": return "(" + [un(e.f), ...e.args.map(un)].join(" ") + ")";
  }
  return "?";
}
function unTop(t) {
  const ps = xs => "[" + xs.map(([n, ty]) => n + " " + sx(ty)).join(" ") + "]";
  switch (t.t) {
    case "let": return `(let ${t.name} ${un(t.expr)})`;
    case "fn": return `(fn ${t.name} ${ps(t.params)} ${sx(t.ret)} ${un(t.body)})`;
    case "rec": return `(rec ${t.name} ${ps(t.fields)})`;
    case "sum": return `(sum ${t.name} ${ps(t.ctors)})`;
    case "dotop": return "(" + ["do", ...t.exprs.map(un)].join(" ") + ")";
    case "use": return `(use ${t.pack})`;
    case "show": return `(show ${un(t.expr)})`;
    case "check": return `(check ${un(t.a)} ${un(t.b)})`;
  }
}

/* ------------------------------------------------------------------ types */
let TV = 0;
const NUM = { k: "num" }, BOOL = { k: "bool" }, STR = { k: "str" };
const fresh = () => ({ k: "var", id: ++TV, ref: null });
const vecT = e => ({ k: "vec", e });
const fnT = (ps, r) => ({ k: "fn", ps, r });
const recT = (name, args) => ({ k: "rec", name, args });      // rec, sum and Map types
function prune(t) { while (t.k === "var" && t.ref) t = t.ref; return t; }
function occurs(v, t) {
  t = prune(t); tick(); if (t === v) return true;
  if (t.k === "vec") return occurs(v, t.e);
  if (t.k === "rec") return t.args.some(a => occurs(v, a));
  if (t.k === "fn") return t.ps.some(p => occurs(v, p)) || occurs(v, t.r);
  return false;
}
function unify(a, b) {
  a = prune(a); b = prune(b);
  if (a === b) return true;
  if (a.k === "var") { if (occurs(a, b)) return false; a.ref = b; return true; }
  if (b.k === "var") return unify(b, a);
  if (a.k !== b.k) return false;
  switch (a.k) {
    case "num": case "bool": case "str": return true;
    case "vec": return unify(a.e, b.e);
    case "rec":
      if (a.name !== b.name || a.args.length !== b.args.length) return false;
      for (let i = 0; i < a.args.length; i++) if (!unify(a.args[i], b.args[i])) return false;
      return true;
    case "rigid": return a.name === b.name && a.owner === b.owner;
    case "fn":
      if (a.ps.length !== b.ps.length) return false;
      for (let i = 0; i < a.ps.length; i++) if (!unify(a.ps[i], b.ps[i])) return false;
      return unify(a.r, b.r);
  }
  return false;
}
function showT(t, nm = new Map()) {
  t = prune(t); tick();
  switch (t.k) {
    case "num": return "Num"; case "bool": return "Bool"; case "str": return "Str";
    case "vec": return `(Vec ${showT(t.e, nm)})`;
    case "fn": return `(Fn ${[...t.ps, t.r].map(x => showT(x, nm)).join(" ")})`;
    case "rec": return t.args.length ? `(${[t.name, ...t.args.map(x => showT(x, nm))].join(" ")})` : t.name;
    case "rigid": return t.name;
    case "gen": case "var":
      if (!nm.has(t.id)) nm.set(t.id, "'" + "abcdefghijklmnopqrstuvwxyz"[nm.size % 26]);
      return nm.get(t.id);
  }
  return "?";
}
class TooBig extends Error {}
let TWORK = 0, CURLINE = 0;
const tick = () => { if (++TWORK > 3e6) throw new TooBig(); };
function mapT(t, f) {                // rebuild a type, f decides the leaves
  t = prune(t); tick();
  switch (t.k) {
    case "vec": return vecT(mapT(t.e, f));
    case "fn": return fnT(t.ps.map(p => mapT(p, f)), mapT(t.r, f));
    case "rec": return t.args.length ? recT(t.name, t.args.map(a => mapT(a, f))) : t;
  }
  return f(t);
}
function inst(t, m = new Map()) {
  return mapT(t, x => { if (x.k !== "gen") return x; if (!m.has(x.id)) m.set(x.id, fresh()); return m.get(x.id); });
}
const generalize = t => mapT(t, x => x.k === "var" ? { k: "gen", id: x.id } : x);
const rigidToGen = t => mapT(t, x => x.k === "rigid" ? { k: "gen", id: x.owner + ":" + x.name } : x);
function typeVarsOf(s, out) {
  if (s.t === "sym") { if (s.v[0] === "?" && s.v.length > 1 && !out.includes(s.v)) out.push(s.v); }
  else if (s.items) for (const x of s.items) typeVarsOf(x, out);
  return out;
}
function parseType(s, ctx, errs) {
  const plural = n => `${n} type arg${n === 1 ? "" : "s"}`;
  if (s.t === "sym") {
    const v = s.v;
    if (v === "Num") return NUM; if (v === "Bool") return BOOL; if (v === "Str") return STR;
    if (v[0] === "?" && v.length > 1) {
      if (!ctx.rigid) { errs.push(E("E4", `${v}: type variables belong in fn, rec and sum signatures only`, s.line)); return fresh(); }
      if (!ctx.rigid.has(v)) ctx.rigid.set(v, { k: "rigid", name: v, owner: ctx.owner });
      return ctx.rigid.get(v);
    }
    if (ctx.recs.has(v)) {
      const d = ctx.recs.get(v);
      if (d.params.length) errs.push(E("E4", `${v} takes ${plural(d.params.length)}: write (${v} ${d.params.map(() => "T").join(" ")})`, s.line));
      return recT(v, d.params.map(fresh));
    }
    const near = nearest(v, [...TYPENAMES, ...ctx.recs.keys()]);
    errs.push(E("E1", (ctx.packs && packHint(v, ctx)) || `unknown type ${v}` + (near ? `. nearest known: ${near}` : ""), s.line)); return fresh();
  }
  if (s.t === "list" && s.items.length && isSym(s.items[0])) {
    const h = s.items[0].v, r = s.items.slice(1);
    if (h === "Vec" && r.length === 1) return vecT(parseType(r[0], ctx, errs));
    if (h === "Fn" && r.length >= 1) { const ts = r.map(x => parseType(x, ctx, errs)); return fnT(ts.slice(0, -1), ts[ts.length - 1]); }
    if (ctx.recs.has(h)) {
      const d = ctx.recs.get(h), ts = r.map(x => parseType(x, ctx, errs));
      if (ts.length === d.params.length) return recT(h, ts);
      errs.push(E("E4", `${h} takes ${plural(d.params.length)}, got ${ts.length}`, s.line));
      return recT(h, d.params.map(fresh));
    }
  }
  errs.push(E("E12", `bad type ${sx(s)}; write Num Bool Str (Vec T) (Map K V) (Fn A .. R) ?a or a rec or sum name`, s.line));
  return fresh();
}
function sigType(s) {
  if (s.t === "sym") {
    if (s.v === "Num") return NUM; if (s.v === "Bool") return BOOL; if (s.v === "Str") return STR;
    if (/^[a-d]$/.test(s.v)) return { k: "gen", id: "b:" + s.v };
    if (/^[A-Z]/.test(s.v)) return recT(s.v, []);
  } else if (s.t === "list") {
    const [h, ...r] = s.items;
    if (h.v === "Vec") return vecT(sigType(r[0]));
    if (h.v === "Fn") { const ts = r.map(sigType); return fnT(ts.slice(0, -1), ts[ts.length - 1]); }
    if (/^[A-Z]/.test(h.v)) return recT(h.v, r.map(sigType));
  }
  throw new Error("bad builtin signature " + sx(s));
}
function parseSig(str) {
  const errs = [], xs = parse(lex(str, errs), errs);
  const i = xs.findIndex(x => isSym(x) && x.v === "->");
  return i < 0 ? sigType(xs[0]) : fnT(xs.slice(0, i).map(sigType), sigType(xs[i + 1]));
}

/* ------------------------------------------------------------------ names */
function lev(a, b) {
  const m = a.length, n = b.length; let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
function nearest(name, names) {
  let best = null, bd = Infinity;
  for (const c of names) { const d = lev(name, c); if (d < bd) { bd = d; best = c; } }
  return best !== null && bd <= Math.max(2, Math.floor(name.length / 2)) ? best : null;
}

/* ------------------------------------------------------------------ builtins */
const isInt = Number.isInteger;
const fin = (x, op) => { if (!Number.isFinite(x)) R("E17", `${op} gave ${x}`); return x === 0 ? 0 : x; };
const idx = (i, n, op) => { if (!isInt(i) || i < 0 || i >= n) R("E10", `${op}: index ${fmtNum(i)} outside 0..${n - 1}`); return i; };
const span = (a, b, n, op) => { if (!isInt(a) || !isInt(b) || a < 0 || a > b || b > n) R("E10", `${op}: range ${fmtNum(a)}..${fmtNum(b)} needs 0<=a<=b<=${n}`); };
const count = (n, op) => { if (!isInt(n) || n < 0) R("E17", `${op}: count ${fmtNum(n)} must be a whole number >= 0`); if (n > MAXLEN) R("E17", `${op}: ${n} items is over the ${MAXLEN} cap`); return n; };
const ints = (op, ...xs) => { for (const x of xs) if (!isInt(x)) R("E17", `${op} needs whole numbers, got ${fmtNum(x)}`); };
const sameLen = (a, b, op) => { if (a.length !== b.length) R("E11", `${op}: lengths ${a.length} and ${b.length} differ`); };
const chars = s => Array.from(s);

/* values: Num Bool Str are js values. Vec = array. rec and sum = {k:"rv"}. Map = {k:"map"} over a persistent AVL tree */
const RV = (name, vals) => ({ k: "rv", name, vals });
const NONE = { k: "rv", name: "None", vals: [], nul: true };
const SOME = x => RV("Some", [x]);
const opt = x => x === undefined || x === null ? NONE : SOME(x);
const ASTRAL = /[\uD800-\uDFFF]/;
function scmp(a, b) {                // by code point, the same unit slen sget and code count in
  if (ASTRAL.test(a) || ASTRAL.test(b)) { const x = Array.from(a, c => c.codePointAt(0)), y = Array.from(b, c => c.codePointAt(0)); for (let i = 0; i < x.length && i < y.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return x.length < y.length ? -1 : x.length > y.length ? 1 : 0; }
  return a < b ? -1 : a > b ? 1 : 0;
}
function rank(v) {
  if (typeof v === "number") return 0; if (typeof v === "string") return 1; if (typeof v === "boolean") return 2;
  if (Array.isArray(v)) return 3; if (v.k === "rv") return 4; if (v.k === "map") return 5;
  return R("E17", "functions have no order: they cannot be compared, sorted or used as map keys");
}
function cmp(a, b) {
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  switch (ra) {
    case 0: return a < b ? -1 : a > b ? 1 : 0;
    case 1: return scmp(a, b);
    case 2: return a === b ? 0 : a ? 1 : -1;
    case 3: {
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) { const c = cmp(a[i], b[i]); if (c) return c; }
      return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
    }
    case 4: return a.name < b.name ? -1 : a.name > b.name ? 1 : cmp(a.vals, b.vals);
  }
  return cmp(tnodes(a.root).map(n => [n.key, n.val]), tnodes(b.root).map(n => [n.key, n.val]));
}
const H = n => n ? n.h : 0;
const mk = (key, val, l, r) => ({ key, val, l, r, h: 1 + Math.max(H(l), H(r)) });
function bal(key, val, l, r) {
  const hl = H(l), hr = H(r);
  if (hl > hr + 1) {
    if (H(l.l) >= H(l.r)) return mk(l.key, l.val, l.l, mk(key, val, l.r, r));
    const x = l.r; return mk(x.key, x.val, mk(l.key, l.val, l.l, x.l), mk(key, val, x.r, r));
  }
  if (hr > hl + 1) {
    if (H(r.r) >= H(r.l)) return mk(r.key, r.val, mk(key, val, l, r.l), r.r);
    const x = r.l; return mk(x.key, x.val, mk(key, val, l, x.l), mk(r.key, r.val, x.r, r.r));
  }
  return mk(key, val, l, r);
}
function tput(n, k, v) {
  if (!n) return mk(k, v, null, null);
  const c = cmp(k, n.key);
  if (c === 0) return mk(k, v, n.l, n.r);
  return c < 0 ? bal(n.key, n.val, tput(n.l, k, v), n.r) : bal(n.key, n.val, n.l, tput(n.r, k, v));
}
function tget(n, k) { while (n) { const c = cmp(k, n.key); if (c === 0) return n; n = c < 0 ? n.l : n.r; } return null; }
function tdelmin(n) { return n.l ? bal(n.key, n.val, tdelmin(n.l), n.r) : n.r; }
function tdel(n, k) {
  if (!n) return null;
  const c = cmp(k, n.key);
  if (c < 0) return bal(n.key, n.val, tdel(n.l, k), n.r);
  if (c > 0) return bal(n.key, n.val, n.l, tdel(n.r, k));
  if (!n.l) return n.r; if (!n.r) return n.l;
  let m = n.r; while (m.l) m = m.l;
  return bal(m.key, m.val, n.l, tdelmin(n.r));
}
function tnodes(n, out = []) { if (n) { tnodes(n.l, out); out.push(n); tnodes(n.r, out); } return out; }
const EMPTY = { k: "map", root: null, n: 0 };
function mput(m, k, v) {
  rank(k);
  const had = tget(m.root, k);
  if (!had && m.n >= MAXLEN) R("E17", `map: over the ${MAXLEN} item cap`);
  return { k: "map", root: tput(m.root, k, v), n: m.n + (had ? 0 : 1) };
}

function same(a, b, tol) {
  if (a === b) return true;
  if (typeof a === "number") return typeof b === "number" && (a === b || (tol && Math.abs(a - b) <= TOL * Math.max(1, Math.abs(a), Math.abs(b))));
  if (typeof a !== "object") return a === b;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i], tol)) return false;
    return true;
  }
  if (a.k === "rv") return b.k === "rv" && a.name === b.name && same(a.vals, b.vals, tol);
  if (a.k === "map") {
    if (b.k !== "map" || a.n !== b.n) return false;
    const x = tnodes(a.root), y = tnodes(b.root);
    for (let i = 0; i < x.length; i++) if (!same(x[i].key, y[i].key, false) || !same(x[i].val, y[i].val, tol)) return false;
    return true;
  }
  return a === b;
}
function mshape(A, op) {
  const n = A.length, m = n ? A[0].length : 0;
  for (const r of A) if (r.length !== m) R("E11", `${op}: ragged matrix, rows of ${m} and ${r.length}`);
  return [n, m];
}
function matmul(A, B, op) {
  const [n, m] = mshape(A, op), [p, q] = mshape(B, op);
  if (m !== p) R("E11", `${op}: ${n}x${m} times ${p}x${q}`);
  if (n * q > MAXLEN || n * m * q > 2e8) R("E17", `${op}: ${n}x${m} times ${p}x${q} is too large`);
  const C = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(q).fill(0);
    for (let k = 0; k < m; k++) { const a = A[i][k]; for (let j = 0; j < q; j++) row[j] += a * B[k][j]; }
    C.push(row.map(x => fin(x, op)));
  }
  return C;
}
function jacobi(S) {
  const n = S.length, A = S.map(r => r.slice());
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0, tot = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const v = A[i][j] * A[i][j]; tot += v; if (i !== j) off += v; }
    if (off === 0 || off <= 1e-30 * tot) break;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
      const apq = A[p][q]; if (apq === 0) continue;
      const th = (A[q][q] - A[p][p]) / (2 * apq);
      const t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
    }
  }
  return A.map((r, i) => r[i]);
}
const EPS = 2.220446049250313e-16;
const ident = n => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 1 : 0));
function svd(A, op) {              // one-sided Jacobi on A itself: A = U diag(s) V^T, thin, s desc. no AtA, so small values stay exact
  const [n, m] = mshape(A, op);
  if (!n || !m) return { U: [], s: [], V: [] };
  if (n * m * Math.min(n, m) > 3e7) R("E17", `${op}: ${n}x${m} is too large for the js backend`);
  if (n < m) { const r = svd(A[0].map((_, j) => A.map(row => row[j])), op); return { U: r.V, s: r.s, V: r.U }; }
  let big = 0; for (const r of A) for (const x of r) big = Math.max(big, Math.abs(x));
  if (big === 0) return { U: A.map(() => new Array(m).fill(0)), s: new Array(m).fill(0), V: ident(m) };
  const U = A.map(r => r.map(x => x / big)), V = ident(m);
  for (let sweep = 0; sweep < 80; sweep++) {
    let rot = 0;
    for (let p = 0; p < m - 1; p++) for (let q = p + 1; q < m; q++) {
      let al = 0, be = 0, ga = 0;
      for (let k = 0; k < n; k++) { const x = U[k][p], y = U[k][q]; al += x * x; be += y * y; ga += x * y; }
      if (ga === 0 || Math.abs(ga) <= 1e-15 * Math.sqrt(al * be)) continue;
      rot++;
      const ze = (be - al) / (2 * ga), t = (ze >= 0 ? 1 : -1) / (Math.abs(ze) + Math.sqrt(1 + ze * ze));
      const c = 1 / Math.sqrt(1 + t * t), s = c * t;
      for (let k = 0; k < n; k++) { const x = U[k][p], y = U[k][q]; U[k][p] = c * x - s * y; U[k][q] = s * x + c * y; }
      for (let k = 0; k < m; k++) { const x = V[k][p], y = V[k][q]; V[k][p] = c * x - s * y; V[k][q] = s * x + c * y; }
    }
    if (!rot) break;
  }
  const cols = [];
  for (let j = 0; j < m; j++) {
    let top = 0, s = 0; for (let k = 0; k < n; k++) top = Math.max(top, Math.abs(U[k][j]));
    if (top) for (let k = 0; k < n; k++) { const x = U[k][j] / top; s += x * x; }
    cols.push({ j, s: top * Math.sqrt(s) });
  }
  cols.sort((a, b) => b.s - a.s);
  return { U: U.map(r => cols.map(c => c.s ? r[c.j] / c.s : 0)), s: cols.map(c => fin(c.s * big, op)), V: V.map(r => cols.map(c => r[c.j])) };
}
const svals = (A, op) => svd(A, op).s;
function pinv(A) {
  const [n, m] = mshape(A, "k.pinv");
  if (!n || !m) return Array.from({ length: m }, () => new Array(n).fill(0));
  const { U, s, V } = svd(A, "k.pinv"), tol = s[0] * Math.max(n, m) * EPS;
  return Array.from({ length: m }, (_, i) => Array.from({ length: n }, (_, j) => {
    let x = 0; for (let k = 0; k < s.length; k++) if (s[k] > tol) x += V[i][k] * U[j][k] / s[k];
    return fin(x, "k.pinv");
  }));
}
function eig(A) {                  // eigenvalues of a real square matrix: [[re ..] [im ..]], re desc
  const [n, m] = mshape(A, "k.eig"); if (n !== m) R("E14", `k.eig needs a square matrix, got ${n}x${m}`);
  let sym = true, big = 0;
  for (let i = 0; i < n && sym; i++) for (let j = 0; j < i; j++) if (A[i][j] !== A[j][i]) { sym = false; break; }
  for (const r of A) for (const x of r) big = Math.max(big, Math.abs(x));
  if (big === 0) return [new Array(n).fill(0), new Array(n).fill(0)];
  A = A.map(r => r.map(x => x / big));                             // work near 1: squares cannot overflow or vanish
  let wr, wi;
  if (sym) { wr = jacobi(A); wi = wr.map(() => 0); }
  else {
    const a = [null]; for (const r of A) a.push([0, ...r]);       // 1-based from here on
    for (let again = true; again;) {                               // balance: rows and columns to like size, by powers of 2
      again = false;
      for (let i = 1; i <= n; i++) {
        let r = 0, c = 0;
        for (let j = 1; j <= n; j++) if (j !== i) { c += Math.abs(a[j][i]); r += Math.abs(a[i][j]); }
        if (c === 0 || r === 0) continue;
        let g = r / 2, f = 1; const s = c + r;
        while (c < g) { f *= 2; c *= 4; }
        g = r * 2;
        while (c > g) { f /= 2; c /= 4; }
        if ((c + r) / f < 0.95 * s) { again = true; for (let j = 1; j <= n; j++) a[i][j] /= f; for (let j = 1; j <= n; j++) a[j][i] *= f; }
      }
    }
    for (let mm = 2; mm < n; mm++) {                               // to Hessenberg form by elimination
      let x = 0, i = mm;
      for (let j = mm; j <= n; j++) if (Math.abs(a[j][mm - 1]) > Math.abs(x)) { x = a[j][mm - 1]; i = j; }
      if (i !== mm) {
        for (let j = mm - 1; j <= n; j++) { const t = a[i][j]; a[i][j] = a[mm][j]; a[mm][j] = t; }
        for (let j = 1; j <= n; j++) { const t = a[j][i]; a[j][i] = a[j][mm]; a[j][mm] = t; }
      }
      if (x !== 0) for (i = mm + 1; i <= n; i++) {
        let y = a[i][mm - 1];
        if (y !== 0) {
          y /= x; a[i][mm - 1] = y;
          for (let j = mm; j <= n; j++) a[i][j] -= y * a[mm][j];
          for (let j = 1; j <= n; j++) a[j][mm] += y * a[j][i];
        }
      }
    }
    for (let i = 3; i <= n; i++) for (let j = 1; j < i - 1; j++) a[i][j] = 0;
    wr = new Array(n + 1).fill(0); wi = new Array(n + 1).fill(0);
    const SIGN = (x, y) => y >= 0 ? Math.abs(x) : -Math.abs(x);
    let nn = n, t = 0, anorm = 0, p = 0, q = 0, r = 0, s = 0, w, x, y, z, l, mm, its;
    for (let i = 1; i <= n; i++) for (let j = Math.max(i - 1, 1); j <= n; j++) anorm += Math.abs(a[i][j]);
    while (nn >= 1) {                                              // shifted QR, one or two roots at a time
      its = 0;
      do {
        for (l = nn; l >= 2; l--) {
          s = Math.abs(a[l - 1][l - 1]) + Math.abs(a[l][l]); if (s === 0) s = anorm;
          if (Math.abs(a[l][l - 1]) + s === s) { a[l][l - 1] = 0; break; }
        }
        x = a[nn][nn];
        if (l === nn) { wr[nn] = x + t; wi[nn--] = 0; }
        else {
          y = a[nn - 1][nn - 1]; w = a[nn][nn - 1] * a[nn - 1][nn];
          if (l === nn - 1) {
            p = 0.5 * (y - x); q = p * p + w; z = Math.sqrt(Math.abs(q)); x += t;
            if (q >= 0) { z = p + SIGN(z, p); wr[nn - 1] = wr[nn] = x + z; if (z) wr[nn] = x - w / z; wi[nn - 1] = wi[nn] = 0; }
            else { wr[nn - 1] = wr[nn] = x + p; wi[nn - 1] = z; wi[nn] = -z; }
            nn -= 2;
          } else {
            if (its === 60) R("E14", "k.eig did not converge");
            if (its && its % 10 === 0) {
              t += x; for (let i = 1; i <= nn; i++) a[i][i] -= x;
              s = Math.abs(a[nn][nn - 1]) + Math.abs(a[nn - 1][nn - 2]); y = x = 0.75 * s; w = -0.4375 * s * s;
            }
            ++its;
            for (mm = nn - 2; mm >= l; mm--) {
              z = a[mm][mm]; r = x - z; s = y - z;
              p = (r * s - w) / a[mm + 1][mm] + a[mm][mm + 1]; q = a[mm + 1][mm + 1] - z - r - s; r = a[mm + 2][mm + 1];
              s = Math.abs(p) + Math.abs(q) + Math.abs(r); p /= s; q /= s; r /= s;
              if (mm === l) break;
              const u = Math.abs(a[mm][mm - 1]) * (Math.abs(q) + Math.abs(r));
              const v = Math.abs(p) * (Math.abs(a[mm - 1][mm - 1]) + Math.abs(z) + Math.abs(a[mm + 1][mm + 1]));
              if (u + v === v) break;
            }
            for (let i = mm + 2; i <= nn; i++) { a[i][i - 2] = 0; if (i !== mm + 2) a[i][i - 3] = 0; }
            for (let k = mm; k <= nn - 1; k++) {
              if (k !== mm) {
                p = a[k][k - 1]; q = a[k + 1][k - 1]; r = k !== nn - 1 ? a[k + 2][k - 1] : 0;
                if ((x = Math.abs(p) + Math.abs(q) + Math.abs(r)) !== 0) { p /= x; q /= x; r /= x; }
              }
              if ((s = SIGN(Math.sqrt(p * p + q * q + r * r), p)) !== 0) {
                if (k === mm) { if (l !== mm) a[k][k - 1] = -a[k][k - 1]; } else a[k][k - 1] = -s * x;
                p += s; x = p / s; y = q / s; z = r / s; q /= p; r /= p;
                for (let j = k; j <= nn; j++) {
                  p = a[k][j] + q * a[k + 1][j];
                  if (k !== nn - 1) { p += r * a[k + 2][j]; a[k + 2][j] -= p * z; }
                  a[k + 1][j] -= p * y; a[k][j] -= p * x;
                }
                const mmin = nn < k + 3 ? nn : k + 3;
                for (let i = l; i <= mmin; i++) {
                  p = x * a[i][k] + y * a[i][k + 1];
                  if (k !== nn - 1) { p += z * a[i][k + 2]; a[i][k + 2] -= p * r; }
                  a[i][k + 1] -= p * q; a[i][k] -= p;
                }
              }
            }
          }
        }
      } while (l < nn - 1);
    }
    wr.shift(); wi.shift();
  }
  const ord = wr.map((_, i) => i).sort((i, j) => wr[j] - wr[i] || wi[j] - wi[i]);
  return [ord.map(i => fin(wr[i] * big, "k.eig")), ord.map(i => fin(wi[i] * big, "k.eig"))];
}
function det(A) {
  const [n, m] = mshape(A, "k.det"); if (n !== m) R("E14", `k.det needs a square matrix, got ${n}x${m}`);
  const M = A.map(r => r.slice()); let d = 1;
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    if (M[p][i] === 0) return 0;
    if (p !== i) { [M[p], M[i]] = [M[i], M[p]]; d = -d; }
    d *= M[i][i];
    for (let r = i + 1; r < n; r++) { const f = M[r][i] / M[i][i]; for (let c = i; c < n; c++) M[r][c] -= f * M[i][c]; }
  }
  return fin(d, "k.det");
}
function solve(A, B) {
  const [n, m] = mshape(A, "k.solve"), [p, q] = mshape(B, "k.solve");
  if (n !== m || p !== n) R("E14", `k.solve needs n x n and n x k, got ${n}x${m} and ${p}x${q}`);
  const M = A.map((r, i) => r.concat(B[i])), sc = A.map(r => r.reduce((a, x) => Math.max(a, Math.abs(x)), 0));
  if (sc.some(s => s === 0)) R("E14", "k.solve: matrix is singular");
  for (let i = 0; i < n; i++) {                                    // a pivot is small only next to the size of its own row
    let piv = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) / sc[r] > Math.abs(M[piv][i]) / sc[piv]) piv = r;
    if (!(Math.abs(M[piv][i]) / sc[piv] > 1e-13)) R("E14", "k.solve: matrix is singular");
    if (piv !== i) { [M[piv], M[i]] = [M[i], M[piv]]; [sc[piv], sc[i]] = [sc[i], sc[piv]]; }
    for (let r = 0; r < n; r++) if (r !== i) {
      const f = M[r][i] / M[i][i]; if (f !== 0) for (let c = i; c < n + q; c++) M[r][c] -= f * M[i][c];
    }
  }
  return M.map((r, i) => r.slice(n).map(x => fin(x / M[i][i], "k.solve")));
}
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function iroot(v, k) {
  if (!isInt(k) || k < 1) R("E17", `iroot: k must be a whole number >= 1, got ${fmtNum(k)}`);
  if (v < 0) R("E17", `iroot of negative ${fmtNum(v)}`);
  if (k > 1100) return v >= 1 ? 1 : 0;
  const fv = BigInt(Math.floor(v)), K = BigInt(k);
  let lo = 0n, hi = 1n << BigInt(Math.ceil(fv.toString(2).length / k) + 1);      // all in BigInt: doubles cannot step past 2^53
  while (lo < hi) { const mid = (lo + hi + 1n) >> 1n; if (mid ** K <= fv) lo = mid; else hi = mid - 1n; }
  return Number(lo);
}
const bit = (op, f) => ([a, b]) => { ints(op, a, b); return fin(Number(f(BigInt(a), BigInt(b))), op); };

const M_ = "(Vec (Vec Num))";
const B = {};
function def(name, sig, fn) { B[name] = { sig, type: parseSig(sig), fn }; }
function defv(name, sig, val) { B[name] = { sig, type: parseSig(sig), val }; }
const N1 = "Num -> Num", N2 = "Num Num -> Num";
def("neg", N1, ([a]) => fin(-a, "neg"));
def("abs", N1, ([a]) => Math.abs(a));
def("sqrt", N1, ([a]) => a < 0 ? R("E17", `sqrt of negative ${fmtNum(a)}`) : Math.sqrt(a));
def("exp", N1, ([a]) => fin(Math.exp(a), "exp overflow:"));
def("log", N1, ([a]) => a <= 0 ? R("E17", `log of nonpositive ${fmtNum(a)}`) : Math.log(a));
def("sin", N1, ([a]) => Math.sin(a));
def("cos", N1, ([a]) => Math.cos(a));
def("floor", N1, ([a]) => Math.floor(a));
def("+", N2, ([a, b]) => fin(a + b, "+"));
def("-", N2, ([a, b]) => fin(a - b, "-"));
def("*", N2, ([a, b]) => fin(a * b, "*"));
def("/", N2, ([a, b]) => b === 0 ? R("E17", "division by zero") : fin(a / b, "/"));
def("rem", N2, ([a, b]) => b === 0 ? R("E17", "rem by zero") : fin(a % b, "rem"));
def("pow", N2, ([a, b]) => fin(Math.pow(a, b), `pow ${fmtNum(a)} ${fmtNum(b)}`));
def("max", N2, ([a, b]) => Math.max(a, b));
def("min", N2, ([a, b]) => Math.min(a, b));
def("iroot", N2, ([v, k]) => iroot(v, k));
def("=", "Num Num -> Bool", ([a, b]) => a === b);
def("<", "Num Num -> Bool", ([a, b]) => a < b);
def("<=", "Num Num -> Bool", ([a, b]) => a <= b);
def("not", "Bool -> Bool", ([a]) => !a);
def("and", "Bool Bool -> Bool", ([a, b]) => a && b);
def("or", "Bool Bool -> Bool", ([a, b]) => a || b);
def("len", "(Vec a) -> Num", ([v]) => v.length);
def("get", "(Vec a) Num -> a", ([v, i]) => v[idx(i, v.length, "get")]);
def("slice", "(Vec a) Num Num -> (Vec a)", ([v, a, b]) => { span(a, b, v.length, "slice"); return v.slice(a, b); });
def("concat", "(Vec a) (Vec a) -> (Vec a)", ([a, b]) => { if (a.length + b.length > MAXLEN) R("E17", "concat: over the item cap"); return a.concat(b); });
def("rev", "(Vec a) -> (Vec a)", ([v]) => v.slice().reverse());
def("rep", "Num a -> (Vec a)", ([n, x]) => new Array(count(n, "rep")).fill(x));
def("range", "Num -> (Vec Num)", ([n]) => Array.from({ length: count(n, "range") }, (_, i) => i));
def("onehot", "Num Num -> (Vec Num)", ([n, i]) => { const v = new Array(count(n, "onehot")).fill(0); v[idx(i, n, "onehot")] = 1; return v; });
def("vadd", "(Vec Num) (Vec Num) -> (Vec Num)", ([a, b]) => { sameLen(a, b, "vadd"); return a.map((x, i) => fin(x + b[i], "vadd")); });
def("vsub", "(Vec Num) (Vec Num) -> (Vec Num)", ([a, b]) => { sameLen(a, b, "vsub"); return a.map((x, i) => fin(x - b[i], "vsub")); });
def("scale", "(Vec Num) Num -> (Vec Num)", ([a, k]) => a.map(x => fin(x * k, "scale")));
def("vsum", "(Vec Num) -> Num", ([a]) => { let s = 0; for (const x of a) s += x; return fin(s, "vsum"); });
def("vnorm", "(Vec Num) -> Num", ([a]) => { let top = 0, s = 0; for (const x of a) top = Math.max(top, Math.abs(x)); if (!top) return 0; for (const x of a) s += (x / top) * (x / top); return fin(top * Math.sqrt(s), "vnorm"); });
def("dot", "(Vec Num) (Vec Num) -> Num", ([a, b]) => { sameLen(a, b, "dot"); let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return fin(s, "dot"); });
def("sort", "(Vec Num) -> (Vec Num)", ([a]) => a.slice().sort((x, y) => x - y));
def("map", "(Fn a b) (Vec a) -> (Vec b)", ([f, v], cx) => v.map(x => cx.apply(f, [x])));
def("map2", "(Fn a b c) (Vec a) (Vec b) -> (Vec c)", ([f, a, b], cx) => { sameLen(a, b, "map2"); return a.map((x, i) => cx.apply(f, [x, b[i]])); });
def("fold", "(Fn b a b) b (Vec a) -> b", ([f, z, v], cx) => { let acc = z; for (const x of v) acc = cx.apply(f, [acc, x]); return acc; });
def("filter", "(Fn a Bool) (Vec a) -> (Vec a)", ([f, v], cx) => v.filter(x => cx.apply(f, [x])));
def("matmul", `${M_} ${M_} -> ${M_}`, ([a, b]) => matmul(a, b, "matmul"));
def("tpose", `${M_} -> ${M_}`, ([a]) => { const [n, m] = mshape(a, "tpose"); return Array.from({ length: n ? m : 0 }, (_, j) => a.map(r => r[j])); });
def("svdvals", `${M_} -> (Vec Num)`, ([a]) => svals(a, "svdvals"));
def("slen", "Str -> Num", ([s]) => chars(s).length);
def("sget", "Str Num -> Str", ([s, i]) => { const c = chars(s); return c[idx(i, c.length, "sget")]; });
def("ssub", "Str Num Num -> Str", ([s, a, b]) => { const c = chars(s); span(a, b, c.length, "ssub"); return c.slice(a, b).join(""); });
def("scat", "Str Str -> Str", ([a, b]) => a + b);
def("slt", "Str Str -> Bool", ([a, b]) => scmp(a, b) < 0);
def("code", "Str -> Num", ([s]) => { if (!s.length) R("E10", "code of empty string"); return s.codePointAt(0); });
def("chr", "Num -> Str", ([n]) => { if (!isInt(n) || n < 0 || n > 0x10FFFF || (n >= 0xD800 && n <= 0xDFFF)) R("E17", `chr: ${fmtNum(n)} is not a code point`); return String.fromCodePoint(n); });
const capped = (v, op) => v.length > MAXLEN ? R("E17", `${op}: over the item cap`) : v;
def("split", "Str Str -> (Vec Str)", ([s, sep]) => { if (s.length > MAXLEN * 8) R("E17", "split: text too long"); return capped(sep === "" ? chars(s) : s.split(sep), "split"); });
def("join", "(Vec Str) Str -> Str", ([v, sep]) => v.join(sep));
def("snum", "Str -> Num", ([s]) => {
  const t = s.trim();
  if (!NUMRE.test(t)) R("E15", `snum cannot read ${quote(s)}`);
  const v = Number(t); if (!Number.isFinite(v)) R("E15", `snum: ${quote(s)} is too big`); return v === 0 ? 0 : v;
});
def("str", "a -> Str", ([v]) => fmt(v, true));
def("bxor", N2, bit("bxor", (a, b) => a ^ b));
def("band", N2, bit("band", (a, b) => a & b));
def("bor", N2, bit("bor", (a, b) => a | b));
def("pairs", `Num Num -> ${M_}`, ([lo, hi]) => {
  ints("pairs", lo, hi); const out = [];
  for (let i = lo; i < hi; i++) for (let j = i + 1; j < hi; j++) { out.push([i, j]); if (out.length > MAXLEN) R("E17", "pairs: over the item cap"); }
  return out;
});
def("uniq", "(Vec a) -> (Vec a)", ([v]) => {
  try { let t = null; const out = []; for (const x of v) if (!tget(t, x)) { t = tput(t, x, 1); out.push(x); } return out; }
  catch (e) { const out = []; for (const x of v) if (!out.some(y => same(x, y, false))) out.push(x); return out; }      // functions have no order: compare one by one
});
def("flat", "(Vec (Vec a)) -> (Vec a)", ([v]) => { let n = 0; for (const x of v) n += x.length; if (n > MAXLEN) R("E17", "flat: over the item cap"); const out = []; for (const x of v) for (const y of x) out.push(y); return out; });
def("same", "a a -> Bool", ([a, b]) => same(a, b, false));
def("k.svd", `${M_} -> (Vec Num)`, ([a]) => svals(a, "k.svd"));
def("k.matmul", `${M_} ${M_} -> ${M_}`, ([a, b]) => matmul(a, b, "k.matmul"));
def("k.rank", `${M_} -> Num`, ([a]) => {
  const s = svals(a, "k.rank"); if (!s.length || s[0] === 0) return 0;
  const [n, m] = mshape(a, "k.rank"), tol = s[0] * Math.max(n, m) * EPS;
  return s.filter(x => x > tol).length;
});
def("k.det", `${M_} -> Num`, ([a]) => det(a));
def("k.solve", `${M_} ${M_} -> ${M_}`, ([a, b]) => solve(a, b));
def("k.pinv", `${M_} -> ${M_}`, ([a]) => pinv(a));
def("k.eig", `${M_} -> ${M_}`, ([a]) => eig(a));
def("k.randn", `Num Num Num -> ${M_}`, ([r, c, seed]) => {
  if (!isInt(r) || !isInt(c) || r < 0 || c < 0 || !isInt(seed)) R("E14", "k.randn needs whole rows >= 0, cols >= 0 and a whole seed");
  if (r * c > MAXLEN) R("E14", "k.randn: too many entries");
  const rnd = mulberry32(seed), out = [];
  for (let i = 0; i < r; i++) {
    const row = [];
    for (let j = 0; j < c; j++) { const u = rnd() || 1e-300, v = rnd(); row.push(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)); }
    out.push(row);
  }
  return out;
});
def("k.backend", "-> Str", () => "js");

/* ---- v2: numbers */
defv("pi", "Num", Math.PI);
def("sign", N1, ([a]) => a > 0 ? 1 : a < 0 ? -1 : 0);
def("tan", N1, ([a]) => fin(Math.tan(a), "tan"));
def("asin", N1, ([a]) => fin(Math.asin(a), `asin of ${fmtNum(a)}:`));
def("acos", N1, ([a]) => fin(Math.acos(a), `acos of ${fmtNum(a)}:`));
def("atan", N1, ([a]) => Math.atan(a));
def("atan2", N2, ([y, x]) => fin(Math.atan2(y, x), "atan2"));
def("ceil", N1, ([a]) => fin(Math.ceil(a), "ceil"));
def("round", N1, ([a]) => fin(Math.round(a), "round"));
def("trunc", N1, ([a]) => fin(Math.trunc(a), "trunc"));
def("isint", "Num -> Bool", ([a]) => isInt(a));
def("mod", N2, ([a, b]) => b === 0 ? R("E17", "mod by zero") : fin(((a % b) + b) % b, "mod"));
def("idiv", N2, ([a, b]) => b === 0 ? R("E17", "idiv by zero") : fin(Math.floor(a / b), "idiv"));
def("rand", "Num Num -> (Vec Num)", ([seed, n]) => { ints("rand", seed); const r = mulberry32(seed); return Array.from({ length: count(n, "rand") }, () => r()); });
def(">", "Num Num -> Bool", ([a, b]) => a > b);
def(">=", "Num Num -> Bool", ([a, b]) => a >= b);
def("cmp", "a a -> Num", ([a, b]) => cmp(a, b));
const shift = (op, f) => ([a, b]) => { ints(op, a, b); if (b < 0 || b > 1023) R("E17", `${op}: shift ${fmtNum(b)} outside 0..1023`); return fin(Number(f(BigInt(a), BigInt(b))), op); };
def("shl", N2, shift("shl", (a, b) => a << b));
def("shr", N2, shift("shr", (a, b) => a >> b));

/* ---- v2: vectors */
const nonEmpty = (v, op) => { if (!v.length) R("E10", `${op} of an empty vector`); return v; };
const sortBy = (keys, v) => v.map((_, i) => i).sort((i, j) => cmp(keys[i], keys[j])).map(i => v[i]);
def("first", "(Vec a) -> (Opt a)", ([v]) => opt(v[0]));
def("last", "(Vec a) -> (Opt a)", ([v]) => opt(v[v.length - 1]));
const whole = (n, op) => { if (!isInt(n) || n < 0) R("E17", `${op}: count ${fmtNum(n)} must be a whole number >= 0`); return n; };
def("take", "(Vec a) Num -> (Vec a)", ([v, n]) => v.slice(0, whole(n, "take")));
def("drop", "(Vec a) Num -> (Vec a)", ([v, n]) => v.slice(whole(n, "drop")));
def("push", "(Vec a) a -> (Vec a)", ([v, x]) => { if (v.length >= MAXLEN) R("E17", "push: over the item cap"); const r = v.slice(); r.push(x); return r; });
def("has", "(Vec a) a -> Bool", ([v, x]) => v.some(y => same(x, y, false)));
def("index", "(Vec a) a -> (Opt Num)", ([v, x]) => { const i = v.findIndex(y => same(x, y, false)); return i < 0 ? NONE : SOME(i); });
def("chunk", "(Vec a) Num -> (Vec (Vec a))", ([v, n]) => { if (count(n, "chunk") < 1) R("E17", "chunk: size must be >= 1"); const out = []; for (let i = 0; i < v.length; i += n) out.push(v.slice(i, i + n)); return out; });
def("zip", "(Vec a) (Vec b) -> (Vec (Pair a b))", ([a, b]) => { sameLen(a, b, "zip"); return a.map((x, i) => RV("Pair", [x, b[i]])); });
def("enum", "(Vec a) -> (Vec (Pair Num a))", ([v]) => v.map((x, i) => RV("Pair", [i, x])));
def("order", "(Vec a) -> (Vec a)", ([v]) => sortBy(v, v));
def("vmax", "(Vec Num) -> Num", ([v]) => nonEmpty(v, "vmax").reduce((a, b) => Math.max(a, b)));
def("vmin", "(Vec Num) -> Num", ([v]) => nonEmpty(v, "vmin").reduce((a, b) => Math.min(a, b)));
def("mean", "(Vec Num) -> Num", ([v]) => { let s = 0; for (const x of nonEmpty(v, "mean")) s += x; return fin(s / v.length, "mean"); });
def("scan", "(Fn b a b) b (Vec a) -> (Vec b)", ([f, z, v], cx) => { let acc = z; return v.map(x => acc = cx.apply(f, [acc, x])); });
def("find", "(Fn a Bool) (Vec a) -> (Opt a)", ([f, v], cx) => { for (const x of v) if (cx.apply(f, [x])) return SOME(x); return NONE; });
def("any", "(Fn a Bool) (Vec a) -> Bool", ([f, v], cx) => v.some(x => cx.apply(f, [x])));
def("all", "(Fn a Bool) (Vec a) -> Bool", ([f, v], cx) => v.every(x => cx.apply(f, [x])));
def("count", "(Fn a Bool) (Vec a) -> Num", ([f, v], cx) => { let n = 0; for (const x of v) if (cx.apply(f, [x])) n++; return n; });
def("sortby", "(Fn a b) (Vec a) -> (Vec a)", ([f, v], cx) => sortBy(v.map(x => cx.apply(f, [x])), v));
def("group", "(Fn a b) (Vec a) -> (Map b (Vec a))", ([f, v], cx) => {
  let m = EMPTY;
  for (const x of v) { const k = cx.apply(f, [x]), had = tget(m.root, k); if (had) had.val.push(x); else m = mput(m, k, [x]); }
  return m;
});
def("iter", "(Fn a a) a Num -> a", ([f, x, n], cx) => { count(n, "iter"); for (let i = 0; i < n; i++) x = cx.apply(f, [x]); return x; });

/* ---- v2: Opt and Res */
function raise(code, msg) {
  if (/^E(9|1[0-9])$/.test(code)) R(code, msg);
  const x = new TErr("E16", `${code}: ${msg}`); x.ucode = code; x.umsg = msg; throw x;
}
def("else", "(Opt a) a -> a", ([o, d]) => o.nul ? d : o.vals[0]);
def("need", "(Opt a) Str -> a", ([o, msg]) => o.nul ? raise("need", msg) : o.vals[0]);
def("unwrap", "(Res a) -> a", ([r]) => r.name === "Ok" ? r.vals[0] : raise(r.vals[0], r.vals[1]));

/* ---- v2: maps */
def("mget", "(Map a b) a -> (Opt b)", ([m, k]) => { const n = tget(m.root, k); return n ? SOME(n.val) : NONE; });
def("mput", "(Map a b) a b -> (Map a b)", ([m, k, v]) => mput(m, k, v));
def("mdel", "(Map a b) a -> (Map a b)", ([m, k]) => tget(m.root, k) ? { k: "map", root: tdel(m.root, k), n: m.n - 1 } : m);
def("mhas", "(Map a b) a -> Bool", ([m, k]) => !!tget(m.root, k));
def("mlen", "(Map a b) -> Num", ([m]) => m.n);
def("mkeys", "(Map a b) -> (Vec a)", ([m]) => tnodes(m.root).map(n => n.key));
def("mvals", "(Map a b) -> (Vec b)", ([m]) => tnodes(m.root).map(n => n.val));
def("mitems", "(Map a b) -> (Vec (Pair a b))", ([m]) => tnodes(m.root).map(n => RV("Pair", [n.key, n.val])));
def("mfrom", "(Vec (Pair a b)) -> (Map a b)", ([v]) => { let m = EMPTY; for (const p of v) m = mput(m, p.vals[0], p.vals[1]); return m; });
def("mmerge", "(Map a b) (Map a b) -> (Map a b)", ([a, b]) => { let m = a; for (const n of tnodes(b.root)) m = mput(m, n.key, n.val); return m; });
def("mupd", "(Map a b) a b (Fn b b) -> (Map a b)", ([m, k, d, f], cx) => { const n = tget(m.root, k); return mput(m, k, cx.apply(f, [n ? n.val : d])); });
def("mmap", "(Fn b c) (Map a b) -> (Map a c)", ([f, m], cx) => { const go = n => n && { key: n.key, val: cx.apply(f, [n.val]), l: go(n.l), r: go(n.r), h: n.h }; return { k: "map", root: go(m.root), n: m.n }; });

/* ---- v2: strings */
const padFill = (s, n, f, op) => { if (f === "") R("E17", `${op}: fill is empty`); const need = count(n, op) - chars(s).length; return need > 0 ? chars(f.repeat(need)).slice(0, need).join("") : ""; };
def("lines", "Str -> (Vec Str)", ([s]) => { const v = s.split(/\r?\n/); if (v[v.length - 1] === "") v.pop(); return v; });
def("upper", "Str -> Str", ([s]) => s.toUpperCase());
def("lower", "Str -> Str", ([s]) => s.toLowerCase());
def("trim", "Str -> Str", ([s]) => s.trim());
def("starts", "Str Str -> Bool", ([s, p]) => s.startsWith(p));
def("ends", "Str Str -> Bool", ([s, p]) => s.endsWith(p));
def("shas", "Str Str -> Bool", ([s, p]) => s.includes(p));
def("sfind", "Str Str -> (Opt Num)", ([s, p]) => { const i = s.indexOf(p); return i < 0 ? NONE : SOME(chars(s.slice(0, i)).length); });
def("sreplace", "Str Str Str -> Str", ([s, a, b]) => a === "" ? R("E17", "sreplace: nothing to look for") : s.split(a).join(b));
def("srep", "Str Num -> Str", ([s, n]) => { if (count(n, "srep") * s.length > 1e8) R("E17", "srep: result too long"); return s.repeat(n); });
def("padl", "Str Num Str -> Str", ([s, n, f]) => padFill(s, n, f, "padl") + s);
def("padr", "Str Num Str -> Str", ([s, n, f]) => s + padFill(s, n, f, "padr"));
def("pnum", "Str -> (Opt Num)", ([s]) => { const t = s.trim(); if (!NUMRE.test(t)) return NONE; const v = Number(t); return Number.isFinite(v) ? SOME(v === 0 ? 0 : v) : NONE; });
def("fix", "Num Num -> Str", ([x, d]) => { if (!isInt(d) || d < 0 || d > 100) R("E17", `fix: ${fmtNum(d)} decimals outside 0..100`); if (Math.abs(x) >= 1e21) R("E17", `fix: ${fmtNum(x)} is too big to write out`); return x.toFixed(d); });
const base = (b, op) => { if (!isInt(b) || b < 2 || b > 36) R("E17", `${op}: base ${fmtNum(b)} outside 2..36`); return b; };
def("radix", "Num Num -> Str", ([n, b]) => { ints("radix", n); return BigInt(n).toString(base(b, "radix")); });
def("pradix", "Str Num -> (Opt Num)", ([s, b]) => {
  base(b, "pradix"); const m = /^(-?)([0-9a-z]+)$/i.exec(s.trim()); if (!m) return NONE;
  let v = 0; for (const c of m[2].toLowerCase()) { const d = parseInt(c, 36); if (d >= b) return NONE; v = v * b + d; }
  return Number.isFinite(v) ? SOME(m[1] && v !== 0 ? -v : v) : NONE;
});
const bytes = (v, op, code = "E17") => { for (const x of v) if (!isInt(x) || x < 0 || x > 255) R(code, `${op}: ${fmtNum(x)} is not a byte 0..255`); return Uint8Array.from(v); };
const decode = (u8, op) => { try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(u8); } catch (x) { return R("E15", `${op}: bytes are not utf8 text`); } };
def("utf8", "Str -> (Vec Num)", ([s]) => Array.from(new TextEncoder().encode(s)));
def("unutf8", "(Vec Num) -> Str", ([v]) => decode(bytes(v, "unutf8", "E15"), "unutf8"));
def("b64.enc", "Str -> Str", ([s]) => { let b = ""; for (const x of new TextEncoder().encode(s)) b += String.fromCharCode(x); return btoa(b); });
def("b64.dec", "Str -> Str", ([s]) => { let b; try { b = atob(s.trim()); } catch (x) { R("E15", "b64.dec: not base64"); } return decode(Uint8Array.from(b, c => c.charCodeAt(0)), "b64.dec"); });

/* ---- v2: regex (js, unicode mode). a literal pattern is also checked in the check phase */
function regex(p, flags) { try { return new RegExp(p, flags + "u"); } catch (x) { return R("E14", `bad regex ${quote(p)}: ${x.message.replace(/^Invalid regular expression: /, "")}`); } }
const strs = a => Array.from(a, x => x === undefined ? "" : x);
def("re.test", "Str Str -> Bool", ([p, s]) => regex(p, "").test(s));
def("re.find", "Str Str -> (Vec (Vec Str))", ([p, s]) => { const out = []; for (const m of s.matchAll(regex(p, "g"))) { out.push(strs(m)); if (out.length > MAXLEN) R("E17", "re.find: over the item cap"); } return out; });
def("re.replace", "Str Str Str -> Str", ([p, s, r]) => s.replace(regex(p, "g"), r));
def("re.split", "Str Str -> (Vec Str)", ([p, s]) => { if (s.length > MAXLEN * 8) R("E17", "re.split: text too long"); return capped(strs(s.split(regex(p, ""))), "re.split"); });

/* ---- v2: json and dates */
const JNULL = { k: "rv", name: "JNull", vals: [], nul: true };
function toJson(v) {
  if (v === null) return JNULL;
  if (typeof v === "boolean") return RV("JBool", [v]);
  if (typeof v === "number") return Number.isFinite(v) ? RV("JNum", [v === 0 ? 0 : v]) : R("E15", "json.parse: a number is too big");
  if (typeof v === "string") return RV("JStr", [v]);
  if (Array.isArray(v)) return RV("JArr", [v.map(toJson)]);
  let m = EMPTY; for (const k of Object.keys(v)) m = mput(m, k, toJson(v[k]));
  return RV("JObj", [m]);
}
function fromJson(j) {
  switch (j.name) {
    case "JNull": return null;
    case "JArr": return j.vals[0].map(fromJson);
    case "JObj": { const o = {}; for (const n of tnodes(j.vals[0].root)) Object.defineProperty(o, n.key, { value: fromJson(n.val), enumerable: true }); return o; }
  }
  return j.vals[0];
}
def("json.parse", "Str -> Json", ([s]) => { let v; try { v = JSON.parse(s); } catch (x) { R("E15", `json.parse: ${x.message}`); } return toJson(v); });
function jser(j, pad, at) {
  const nl = pad ? "\n" + at + pad : "", end = pad ? "\n" + at : "", sep = pad ? ": " : ":";
  switch (j.name) {
    case "JNull": return "null";
    case "JArr": return j.vals[0].length ? "[" + j.vals[0].map(x => nl + jser(x, pad, at + pad)).join(",") + end + "]" : "[]";
    case "JObj": return j.vals[0].n ? "{" + tnodes(j.vals[0].root).map(n => nl + JSON.stringify(n.key) + sep + jser(n.val, pad, at + pad)).join(",") + end + "}" : "{}";
  }
  return JSON.stringify(j.vals[0]);
}
def("json.str", "Json -> Str", ([j]) => jser(j, "", ""));
def("json.pretty", "Json -> Str", ([j]) => jser(j, "  ", ""));
def("json.get", "Json Str -> (Opt Json)", ([j, k]) => { const n = j.name === "JObj" ? tget(j.vals[0].root, k) : null; return n ? SOME(n.val) : NONE; });
def("date.iso", "Num -> Str", ([ms]) => { const d = new Date(ms); return Number.isNaN(d.getTime()) ? R("E17", `date.iso: ${fmtNum(ms)} is outside the calendar`) : d.toISOString(); });
def("date.parse", "Str -> Num", ([s]) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/.exec(s.trim());
  const bad = () => R("E15", `date.parse cannot read ${quote(s)}. write 2020-01-31 or 2020-01-31T12:00:00Z (Z or +hh:mm is needed with a time)`);
  if (!m) return bad();
  const day = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (day.getUTCMonth() !== +m[2] - 1 || day.getUTCDate() !== +m[3]) return bad();
  const v = Date.parse(s.trim()); return Number.isNaN(v) ? bad() : v;
});

/* ---- v2: io. every effect goes through the host, so a host decides what a program may touch */
/* ---- drawing: shapes become pixels here, in the core, so every host and every reader gets the same picture */
const NAMED = { black: "000000", white: "ffffff", red: "ff0000", green: "00a000", blue: "0000ff", yellow: "ffff00", cyan: "00ffff", magenta: "ff00ff", gray: "808080", orange: "ff8000" };
function color(s) {
  const h = own(NAMED, s) ? NAMED[s] : /^#[0-9a-f]{6}$/i.test(s) ? s.slice(1) : /^#[0-9a-f]{3}$/i.test(s) ? s[1] + s[1] + s[2] + s[2] + s[3] + s[3] : null;
  if (h === null) R("E14", `color ${quote(s)}: write #rgb, #rrggbb, (rgb r g b) or one of ${Object.keys(NAMED).join(" ")}`);
  const n = parseInt(h, 16); return [n >> 16, n >> 8 & 255, n & 255];
}
function raster(w, h, shapes, op) {
  if (!isInt(w) || !isInt(h) || w < 1 || h < 1 || w > 4096 || h > 4096) R("E17", `${op}: size ${fmtNum(w)} x ${fmtNum(h)} must be whole and 1..4096`);
  const px = new Uint8Array(w * h * 3);
  const dot = (x, y, c) => { if (x >= 0 && y >= 0 && x < w && y < h) { const i = (y * w + x) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; } };
  for (const s of shapes) {
    const v = s.vals, c = color(v[v.length - 1]), col = c;
    if (s.name === "Dot") dot(Math.floor(v[0]), Math.floor(v[1]), c);
    else if (s.name === "Box") {
      const x0 = Math.max(0, Math.round(v[0])), y0 = Math.max(0, Math.round(v[1])), x1 = Math.min(w, Math.round(v[0] + v[2])), y1 = Math.min(h, Math.round(v[1] + v[3]));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; }
    } else if (s.name === "Text") {
      const z = textSize(v[2]), x0 = Math.round(v[0]), y0 = Math.round(v[1]);
      glyphs(v[3]).forEach((g, k) => { for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (g[r] >> (2 - c) & 1) for (let yy = 0; yy < z; yy++) for (let xx = 0; xx < z; xx++) dot(x0 + (4 * k + c) * z + xx, y0 + r * z + yy, col); });
    } else {
      let t0 = 0, t1 = 1, ok = true; const dx = v[2] - v[0], dy = v[3] - v[1];
      for (const [p, q] of [[-dx, v[0] + 1], [dx, w - v[0]], [-dy, v[1] + 1], [dy, h - v[1]]]) {       // keep only the part on the canvas
        if (p === 0) { if (q < 0) ok = false; } else { const r = q / p; if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r); }
      }
      if (!ok || t0 > t1) continue;
      const ax = v[0] + dx * t0, ay = v[1] + dy * t0, bx = v[0] + dx * t1, by = v[1] + dy * t1;
      const n = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)));
      for (let i = 0; i <= n; i++) dot(Math.floor(n ? (ax * (n - i) + bx * i) / n : ax), Math.floor(n ? (ay * (n - i) + by * i) / n : ay), c);      // exact at whole steps
    }
  }
  return px;
}
function asciiArt(w, h, px, cols) {
  if (!isInt(cols) || cols < 1 || cols > 400) R("E17", `ascii: ${fmtNum(cols)} columns outside 1..400`);
  const RAMP = " .:-=+*#%@", rows = Math.max(1, Math.round(cols * h / w / 2)), cells = [];
  if (rows > 400) R("E17", `ascii: ${rows} rows is over 400. use fewer columns`);
  const seen = new Map(), stride = Math.max(1, Math.floor(w * h / 1e5));     // the background is the commonest color
  let bg = 0, most = 0;
  for (let k = 0; k < w * h; k += stride) { const i = k * 3, key = px[i] << 16 | px[i + 1] << 8 | px[i + 2], n = (seen.get(key) || 0) + 1; seen.set(key, n); if (n > most) { most = n; bg = key; } }
  const br = bg >> 16, bgr = bg >> 8 & 255, bb = bg & 255;
  let lo = Infinity, hi = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {     // the pixel least like the background, so a thin line still shows
    const x0 = Math.floor(c * w / cols), x1 = Math.max(x0 + 1, Math.floor((c + 1) * w / cols)), y0 = Math.floor(r * h / rows), y1 = Math.max(y0 + 1, Math.floor((r + 1) * h / rows));
    let top = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 3, a = px[i] - br, b = px[i + 1] - bgr, d = px[i + 2] - bb, l = a * a + b * b + d * d; if (l > top) top = l; }
    top = Math.sqrt(top); cells.push(top); if (top < lo) lo = top; if (top > hi) hi = top;
  }
  const out = [];                                                      // background = space, most ink = @: contrast is stretched to fit
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) line += RAMP[hi > lo ? Math.min(9, Math.floor((cells[r * cols + c] - lo) / (hi - lo) * 10)) : hi > 0 ? 9 : 0];
    out.push(line.replace(/ +$/, ""));
  }
  return out.join("\n");
}
function deflate(raw) {              // small deflate for hosts without zlib: fixed codes, runs of one byte only. enough for flat pictures
  const out = new Uint8Array(Math.ceil(raw.length * 9 / 8) + 16); let o = 2, acc = 0, nb = 0;
  out[0] = 0x78; out[1] = 0x01;
  const bits = (v, n) => { acc |= v << nb; nb += n; while (nb >= 8) { out[o++] = acc & 255; acc >>>= 8; nb -= 8; } };          // lsb first
  const code = (c, n) => { let r = 0; for (let i = 0; i < n; i++) r |= (c >> i & 1) << n - 1 - i; bits(r, n); };                // huffman codes go msb first
  const sym = s => s < 144 ? code(0x30 + s, 8) : s < 256 ? code(0x190 + s - 144, 9) : s < 280 ? code(s - 256, 7) : code(0xC0 + s - 280, 8);
  const LB = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258], LX = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  bits(1, 1); bits(1, 2);
  for (let i = 0; i < raw.length;) {
    let r = 0;
    if (i > 0) while (i + r < raw.length && raw[i + r] === raw[i - 1]) r++;
    if (r < 3) { sym(raw[i++]); continue; }
    while (r >= 3) {
      const L = Math.min(r, 258); let k = 28; while (LB[k] > L) k--;
      sym(257 + k); bits(L - LB[k], LX[k]); code(0, 5);
      i += L; r -= L;
    }
  }
  sym(256); if (nb) bits(0, 8 - nb);
  let a = 1, b = 0; for (const x of raw) { a = (a + x) % 65521; b = (b + a) % 65521; }
  out.set([b >> 8, b & 255, a >> 8, a & 255], o);
  return out.subarray(0, o + 4);
}
function png(w, h, rgb, plain) {     // 8 bit rgb, each row stored as differences from the pixel to its left
  const raw = new Uint8Array(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    const r = y * (w * 3 + 1), s = y * w * 3; raw[r] = 1;
    for (let x = 0; x < w * 3; x++) raw[r + 1 + x] = rgb[s + x] - (x >= 3 ? rgb[s + x - 3] : 0);
  }
  const z = !plain && typeof require === "function" ? require("zlib").deflateSync(raw) : deflate(raw);
  const be = n => Uint8Array.of(n >>> 24, n >>> 16 & 255, n >>> 8 & 255, n & 255);
  const chunk = (type, data) => {
    const td = join8([Uint8Array.from(type, c => c.charCodeAt(0)), data]); let c = -1;
    for (const x of td) { c ^= x; for (let k = 0; k < 8; k++) c = c >>> 1 ^ (c & 1 ? 0xEDB88320 : 0); }
    return join8([be(data.length), td, be(~c >>> 0)]);
  };
  return join8([Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk("IHDR", join8([be(w), be(h), Uint8Array.of(8, 2, 0, 0, 0)])), chunk("IDAT", z), chunk("IEND", new Uint8Array(0))]);
}
function join8(parts) { let n = 0; for (const p of parts) n += p.length; const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
let FRAMES = [];
def("rgb", "Num Num Num -> Str", (v) => "#" + v.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join(""));
def("ascii", "Num Num (Vec Draw) Num -> Str", ([w, h, v, cols]) => asciiArt(w, h, raster(w, h, v, "ascii"), cols));
let HOST = null, EMIT = null;
function io(name, ...a) {
  const h = HOST && HOST[name];
  if (typeof h !== "function") R("E13", `io.${name} needs a host that has it; this host is ${HOST && HOST.name || "none"}`);
  try { return h(...a); }
  catch (x) { if (x instanceof TErr) throw x; return R("E19", `io.${name}: ${String(x && x.message || x).split("\n")[0]}`); }
}
const shRes = r => RV("Sh", [r.code, String(r.out), String(r.err)]);
def("io.print", "Str -> Str", ([s]) => { EMIT(s); return s; });
def("io.read", "Str -> Str", ([p]) => String(io("read", p)));
def("io.write", "Str Str -> Num", ([p, s]) => { io("write", p, s); return chars(s).length; });
def("io.append", "Str Str -> Num", ([p, s]) => { io("append", p, s); return chars(s).length; });
def("io.exists", "Str -> Bool", ([p]) => !!io("exists", p));
def("io.isdir", "Str -> Bool", ([p]) => !!io("isdir", p));
def("io.ls", "Str -> (Vec Str)", ([p]) => Array.from(io("ls", p), String));
def("io.rm", "Str -> Bool", ([p]) => !!io("rm", p));
def("io.mkdir", "Str -> Bool", ([p]) => { io("mkdir", p); return true; });
def("io.readb", "Str -> (Vec Num)", ([p]) => Array.from(io("readb", p)));
def("io.writeb", "Str (Vec Num) -> Num", ([p, v]) => { io("writeb", p, bytes(v, "io.writeb")); return v.length; });
def("io.stdin", "-> Str", () => String(io("stdin")));
def("io.args", "-> (Vec Str)", () => Array.from(io("args"), String));
def("io.env", "Str -> (Opt Str)", ([n]) => opt(io("env", n)));
def("io.sh", "Str -> Sh", ([c]) => shRes(io("sh", c)));
def("io.exec", "Str (Vec Str) Str -> Sh", ([f, a, input]) => shRes(io("exec", f, a, input)));
def("io.http", "Str Str (Map Str Str) Str -> Http", ([method, url, hs, body]) => {
  if (!/^https?:\/\//i.test(url)) R("E14", `io.http: ${quote(url)} is not an http or https url`);
  if (!/^[A-Za-z]+$/.test(method)) R("E14", `io.http: ${quote(method)} is not a method`);
  const r = io("http", method.toUpperCase(), url, tnodes(hs.root).map(n => [n.key, n.val]), body);
  return RV("Http", [r.status, String(r.body)]);
});
def("io.frame", "Num Num (Vec Draw) -> Num", ([w, h, v]) => {
  const px = raster(w, h, v, "io.frame");
  if (FRAMES.length >= 2000 || FRAMES.reduce((a, f) => a + f.px.length, px.length) > 3e8) R("E17", "io.frame: over the frame cap (2000 frames, 100 million pixels)");
  FRAMES.push({ w, h, px });
  if (HOST && typeof HOST.frame === "function") HOST.frame(w, h, px);
  return FRAMES.length;
});
def("io.sheet", "Str Num -> Num", ([path, cols]) => {
  if (!FRAMES.length) R("E14", "io.sheet: no frames yet. io.frame makes them");
  if (!isInt(cols) || cols < 1) R("E17", `io.sheet: ${fmtNum(cols)} columns must be a whole number >= 1`);
  const n = FRAMES.length, cw = Math.max(...FRAMES.map(f => f.w)), ch = Math.max(...FRAMES.map(f => f.h));
  const gx = Math.min(cols, n), gy = Math.ceil(n / cols), W = gx * (cw + 1) - 1, Ht = gy * (ch + 1) - 1;
  if (W > 16384 || Ht > 16384 || W * Ht > 5e7) R("E17", `io.sheet: ${W} x ${Ht} pixels is over 16384 a side or 50 million pixels. change the columns, or make fewer frames`);
  const img = new Uint8Array(W * Ht * 3).fill(255);
  FRAMES.forEach((f, k) => {
    const ox = (k % cols) * (cw + 1), oy = Math.floor(k / cols) * (ch + 1);
    for (let y = 0; y < f.h; y++) img.set(f.px.subarray(y * f.w * 3, (y + 1) * f.w * 3), ((oy + y) * W + ox) * 3);
  });
  io("writeb", path, png(W, Ht, img));
  return n;
});
def("io.now", "-> Num", () => io("now"));
def("io.rand", "-> Num", () => io("rand"));
def("io.sleep", "Num -> Num", ([ms]) => { if (!(ms >= 0)) R("E17", "io.sleep: ms must be >= 0"); io("sleep", ms); return ms; });

function memHost(files = {}) {       // files live in memory. the browser host, and the default when no host is given
  const F = new Map(Object.entries(files)), D = new Set(), norm = p => normPath(p.replace(/\/+$/, ""));
  const get = p => { p = norm(p); if (!F.has(p)) throw new Error(`no such file ${p}`); return F.get(p); };
  const text = v => typeof v === "string" ? v : new TextDecoder().decode(v);
  const frames = [];
  const inDir = d => { d = norm(d); const pre = d === "" || d === "." ? "" : d + "/"; return [...F.keys()].filter(k => k.startsWith(pre)).map(k => k.slice(pre.length)); };
  return {
    name: "memory", files: F,
    read: p => text(get(p)),
    write: (p, s) => { F.set(norm(p), s); },
    append: (p, s) => { p = norm(p); F.set(p, (F.has(p) ? text(F.get(p)) : "") + s); },
    exists: p => F.has(norm(p)) || D.has(norm(p)) || inDir(p).length > 0,
    isdir: p => !F.has(norm(p)) && (D.has(norm(p)) || inDir(p).length > 0),
    ls: d => [...new Set(inDir(d).map(k => k.split("/")[0]))].sort(),
    rm: p => F.delete(norm(p)),
    mkdir: p => { D.add(norm(p)); },
    readb: p => { const v = get(p); return typeof v === "string" ? new TextEncoder().encode(v) : v; },
    writeb: (p, u8) => { F.set(norm(p), u8); },
    stdin: () => "", args: () => [], env: () => null,
    frames, frame: (w, h, px) => { frames.push({ w, h, px }); },
    now: () => Date.now(), rand: () => Math.random(),
  };
}
function nodeHost() {                // the real machine: files, processes, network
  const fs = require("fs"), cp = require("child_process");
  const spawn = (file, args, input, shell) => {
    const r = cp.spawnSync(file, args, { input, encoding: "utf8", shell, maxBuffer: 1 << 28 });
    if (r.error) throw r.error;
    return { code: r.status === null ? -1 : r.status, out: r.stdout, err: r.stderr };
  };
  const FETCH = `let s="";process.stdin.on("data",d=>s+=d).on("end",async()=>{try{const q=JSON.parse(s);const r=await fetch(q.url,{method:q.method,headers:q.headers,body:q.body===""?undefined:q.body});process.stdout.write(JSON.stringify({status:r.status,body:await r.text()}))}catch(e){process.stderr.write(String(e.cause&&e.cause.message||e.message));process.exit(1)}})`;
  return {
    name: "node",
    read: p => fs.readFileSync(p, "utf8"),
    write: (p, s) => fs.writeFileSync(p, s),
    append: (p, s) => fs.appendFileSync(p, s),
    exists: p => fs.existsSync(p),
    isdir: p => fs.existsSync(p) && fs.statSync(p).isDirectory(),
    ls: p => fs.readdirSync(p).sort(),
    rm: p => { if (!fs.existsSync(p)) return false; if (fs.statSync(p).isDirectory()) fs.rmdirSync(p); else fs.unlinkSync(p); return true; },
    mkdir: p => { fs.mkdirSync(p, { recursive: true }); },
    readb: p => fs.readFileSync(p),
    writeb: (p, u8) => fs.writeFileSync(p, u8),
    stdin: () => fs.readFileSync(0, "utf8"),
    args: () => [],
    env: n => own(process.env, n) ? process.env[n] : null,
    sh: c => spawn(c, [], "", true),
    exec: (f, a, input) => spawn(f, a, input, false),
    http: (method, url, headers, body) => {
      const a = ["-sS", "-X", method, "--max-time", "300", "-w", "\n%{http_code}"];
      for (const [k, v] of headers) a.push("-H", `${k}: ${v}`);
      if (body !== "") a.push("--data-binary", "@-");
      let r = cp.spawnSync("curl", [...a, "--", url], { input: body, encoding: "utf8", maxBuffer: 1 << 28 });
      if (r.error && r.error.code === "ENOENT") {              // no curl here: ask a child node to fetch
        r = cp.spawnSync(process.execPath, ["-e", FETCH], { input: JSON.stringify({ method, url, headers: Object.fromEntries(headers), body }), encoding: "utf8", maxBuffer: 1 << 28 });
        if (r.error) throw r.error;
        if (r.status !== 0) throw new Error(r.stderr.trim() || "request failed");
        return JSON.parse(r.stdout);
      }
      if (r.error) throw r.error;
      if (r.status !== 0) throw new Error(r.stderr.trim() || `curl exit ${r.status}`);
      const i = r.stdout.lastIndexOf("\n");
      return { status: Number(r.stdout.slice(i + 1)), body: r.stdout.slice(0, i) };
    },
    now: () => Date.now(), rand: () => Math.random(),
    sleep: ms => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); },
    out: s => { process.stdout.write(s + "\n"); },
  };
}

/* ---- text in pictures: a 3x5 pixel font, so labels are the same pixels on every host */
const FONT = {};
{
  const G = "0 75557 1 26227 2 71747 3 71717 4 55711 5 74717 6 74757 7 71122 8 75757 9 75717 A 25755 B 65656 C 34443 D 65556 E 74647 F 74644 G 34553 H 55755 I 72227 J 11152 K 55655 L 44447 M 57755 N 65555 O 25552 P 65644 Q 25563 R 65655 S 34216 T 72222 U 55557 V 55552 W 55775 X 55255 Y 55222 Z 71247 . 00002 , 00024 - 00700 + 02720 : 02020 / 11244 % 51245 ( 24442 ) 21112 = 07070 _ 00007 ? 71202 # 57575 * 05250 < 12421 > 42124 ! 22202 \" 55000 ' 22000 [ 64446 ] 31113 $ 36236 & 25253 @ 75743".split(" ");
  for (let i = 0; i < G.length; i += 2) FONT[G[i]] = Array.from(G[i + 1], d => parseInt(d, 8));
  FONT[" "] = [0, 0, 0, 0, 0];
}
function glyphs(s) { return Array.from(s.toUpperCase(), c => FONT[c] || FONT["?"]); }

/* ---- svg: the same shapes as text, sharp at any size, for people; still plain text for the model */
const hex2 = c => "#" + c.map(x => x.toString(16).padStart(2, "0")).join("");
const xmlEsc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
def("svg", "Num Num (Vec Draw) -> Str", ([w, h, v]) => {
  if (!isInt(w) || !isInt(h) || w < 1 || h < 1 || w > 4096 || h > 4096) R("E17", `svg: size ${fmtNum(w)} x ${fmtNum(h)} must be whole and 1..4096`);
  const r = x => Math.round(x * 100) / 100, out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`];
  let n = 0;
  for (const s of v) {
    const a = s.vals, c = hex2(color(a[a.length - 1]));
    if (s.name === "Line") out.push(`<line x1="${r(a[0] + .5)}" y1="${r(a[1] + .5)}" x2="${r(a[2] + .5)}" y2="${r(a[3] + .5)}" stroke="${c}" stroke-linecap="square"/>`);
    else if (s.name === "Box") { if (a[2] > 0 && a[3] > 0) out.push(`<rect x="${r(a[0])}" y="${r(a[1])}" width="${r(a[2])}" height="${r(a[3])}" fill="${c}"/>`); }
    else if (s.name === "Dot") out.push(`<rect x="${Math.floor(a[0])}" y="${Math.floor(a[1])}" width="1" height="1" fill="${c}"/>`);
    else { const z = textSize(a[2]); out.push(`<text x="${r(a[0])}" y="${r(a[1] + 5 * z)}" font-family="monospace" font-size="${6 * z}" fill="${c}">${xmlEsc(a[3])}</text>`); }
    if ((n += out[out.length - 1].length) > 5e7) R("E17", "svg: too large");
  }
  return out.join("\n") + "\n</svg>\n";
});
const textSize = z => Math.max(1, Math.min(64, Math.round(z)));

/* ---- charts: data to (Vec Draw). light background, axes with ticks, legend for 2 or more series */
const PAL = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#17becf"];
const INK = "#222222", AXIS = "#555555", GRID = "#e6e6e6", BG = "#ffffff";
const Dr = (name, ...vals) => RV(name, vals);
function niceStep(x) { const e = Math.pow(10, Math.floor(Math.log10(x))), f = x / e; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * e; }
function ticks(lo, hi) {
  const step = niceStep((hi - lo) / 5), out = [];
  for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + step * 1e-9 && out.length < 50; k++) { const v = Number((k * step).toPrecision(12)); out.push(v === 0 ? 0 : v); }
  return out;
}
const tickTxt = v => fmtNum(Number(v.toPrecision(6)));
function chartFrame(w, h, title, x0, x1, y0, y1, op, xmode) {      // xmode: "num" ticks and stretch, "fixed" ticks only, "cat" none
  if (!isInt(w) || !isInt(h) || w < 80 || h < 80 || w > 4096 || h > 4096) R("E17", `${op}: size ${fmtNum(w)} x ${fmtNum(h)} must be whole and 80..4096`);
  if (x0 === x1) { x0 -= 1; x1 += 1; }
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const s = h >= 360 ? 2 : 1, cw = 4 * s, ch = 6 * s;
  const ext = (a, b) => { const st = niceStep((b - a) / 5); return [Math.floor(a / st + 1e-9) * st, Math.ceil(b / st - 1e-9) * st]; };      // out to the next tick
  [y0, y1] = ext(y0, y1);
  if (xmode === "num") [x0, x1] = ext(x0, x1);
  const yt = ticks(y0, y1);
  let xt = xmode === "cat" ? [] : ticks(x0, x1);
  const ylab = yt.map(tickTxt), left = Math.max(...ylab.map(t => t.length)) * cw + 4 * s + 6;
  const top = title ? 2 * ch + 4 : 8, bottom = ch + 12, W = w - left - 12, H = h - top - bottom;
  if (W < 20 || H < 20) R("E17", `${op}: ${w} x ${h} leaves no room to plot`);
  const px = x => left + (x - x0) / (x1 - x0) * W, py = y => top + H - (y - y0) / (y1 - y0) * H;
  const out = [Dr("Box", 0, 0, w, h, BG)];
  if (title) out.push(Dr("Text", left, 6, s, Array.from(title).slice(0, Math.max(1, Math.floor((w - left) / cw))).join(""), INK));
  yt.forEach((v, i) => { const y = py(v); out.push(Dr("Line", left, y, left + W, y, GRID), Dr("Text", left - 4 - ylab[i].length * cw, y - 2.5 * s, s, ylab[i], INK)); });
  xt = xt.filter(v => v >= x0 - 1e-9 * Math.abs(x1 - x0) && v <= x1 + 1e-9 * Math.abs(x1 - x0));
  let lastEnd = -Infinity;
  for (const v of xt) {
    const x = px(v), t = tickTxt(v), tw = t.length * cw, tx = Math.max(0, Math.min(w - tw, x - tw / 2));
    out.push(Dr("Line", x, top, x, top + H, GRID));
    if (tx > lastEnd + cw) { out.push(Dr("Text", tx, top + H + 5, s, t, INK)); lastEnd = tx + tw; }
  }
  out.push(Dr("Line", left, top, left, top + H, AXIS), Dr("Line", left, top + H, left + W, top + H, AXIS));
  return { out, px, py, s, cw, ch, left, top, W, H };
}
function legend(F, names) {
  if (names.length < 2) return;
  const n = names.map(t => Array.from(t).slice(0, 24).join("")), lw = Math.max(...n.map(t => t.length)) * F.cw + 4 * F.s + 10;
  const x = F.left + F.W - lw - 4, y = F.top + 4;
  F.out.push(Dr("Box", x, y, lw, n.length * (F.ch + 3) + 4, BG));
  n.forEach((t, i) => { const yy = y + 4 + i * (F.ch + 3); F.out.push(Dr("Box", x + 3, yy, 3 * F.s, 5 * F.s, PAL[i % PAL.length]), Dr("Text", x + 6 + 4 * F.s, yy, F.s, t, INK)); });
}
function seriesData(ss, op) {
  const all = ss.map(s => { const [name, xs, ys] = s.vals; if (xs.length !== ys.length) R("E11", `${op}: series ${quote(name)} has ${xs.length} xs and ${ys.length} ys`); return { name, xs, ys }; });
  const xs = all.flatMap(s => s.xs), ys = all.flatMap(s => s.ys);
  if (!xs.length) R("E10", `${op}: nothing to plot`);
  if (xs.length > MAXLEN) R("E17", `${op}: too many points`);
  return { all, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
const mark = (F, x, y, c) => { const z = 2 * F.s + 1; return Dr("Box", F.px(x) - z / 2, F.py(y) - z / 2, z, z, c); };
def("chart.line", "Num Num Str (Vec Series) -> (Vec Draw)", ([w, h, title, ss]) => {
  const D = seriesData(ss, "chart.line"), F = chartFrame(w, h, title, D.x0, D.x1, D.y0, D.y1, "chart.line", "num");
  D.all.forEach((s, k) => {
    const c = PAL[k % PAL.length];
    for (let i = 1; i < s.xs.length; i++) F.out.push(Dr("Line", F.px(s.xs[i - 1]), F.py(s.ys[i - 1]), F.px(s.xs[i]), F.py(s.ys[i]), c));
    if (s.xs.length <= 40) s.xs.forEach((x, i) => F.out.push(mark(F, x, s.ys[i], c)));
  });
  legend(F, D.all.map(s => s.name)); return F.out;
});
def("chart.scatter", "Num Num Str (Vec Series) -> (Vec Draw)", ([w, h, title, ss]) => {
  const D = seriesData(ss, "chart.scatter"), F = chartFrame(w, h, title, D.x0, D.x1, D.y0, D.y1, "chart.scatter", "num");
  D.all.forEach((s, k) => s.xs.forEach((x, i) => F.out.push(mark(F, x, s.ys[i], PAL[k % PAL.length]))));
  legend(F, D.all.map(s => s.name)); return F.out;
});
function bars(F, n, vals, at, width, labels) {
  vals.forEach((v, i) => { const y = F.py(Math.max(v, 0)), y0 = F.py(Math.min(v, 0)); F.out.push(Dr("Box", at(i), y, width, Math.max(1, y0 - y), PAL[0])); });
  F.out.push(Dr("Line", F.left, F.py(0), F.left + F.W, F.py(0), AXIS));
  if (labels) {
    const slot = F.W / n, fit = Math.max(1, Math.floor(slot / F.cw) - 1);
    labels.forEach((t, i) => { const tt = Array.from(t).slice(0, fit).join(""); F.out.push(Dr("Text", F.left + slot * (i + 0.5) - tt.length * F.cw / 2, F.top + F.H + 5, F.s, tt, INK)); });
  }
  return F.out;
}
def("chart.bar", "Num Num Str (Vec Str) (Vec Num) -> (Vec Draw)", ([w, h, title, labels, vals]) => {
  if (labels.length !== vals.length) R("E11", `chart.bar: ${labels.length} labels and ${vals.length} values`);
  if (!vals.length) R("E10", "chart.bar: nothing to plot");
  if (vals.length > 4096) R("E17", "chart.bar: over 4096 bars");
  const F = chartFrame(w, h, title, 0, vals.length, Math.min(0, ...vals), Math.max(0, ...vals), "chart.bar", "cat"), slot = F.W / vals.length;
  return bars(F, vals.length, vals, i => F.left + slot * (i + 0.15), Math.max(1, slot * 0.7), labels);
});
def("chart.hist", "Num Num Str (Vec Num) Num -> (Vec Draw)", ([w, h, title, v, bins]) => {
  if (!isInt(bins) || bins < 1 || bins > 1000) R("E17", `chart.hist: ${fmtNum(bins)} bins must be whole and 1..1000`);
  nonEmpty(v, "chart.hist");
  let lo = Math.min(...v), hi = Math.max(...v); if (lo === hi) { lo -= 0.5; hi += 0.5; }
  const n = new Array(bins).fill(0); for (const x of v) n[Math.min(bins - 1, Math.floor((x - lo) / (hi - lo) * bins))]++;
  const F = chartFrame(w, h, title, lo, hi, 0, Math.max(...n), "chart.hist", "fixed"), bw = F.W / bins;
  return bars(F, bins, n, i => F.left + bw * i, Math.max(1, bw - 1), null);
});
def("chart.fn", "Num Num Str (Fn Num Num) Num Num -> (Vec Draw)", ([w, h, title, f, lo, hi], cx) => {
  if (!(lo < hi)) R("E17", `chart.fn: low ${fmtNum(lo)} must be under high ${fmtNum(hi)}`);
  if (!isInt(w) || w < 80 || w > 4096) R("E17", `chart.fn: size ${fmtNum(w)} x ${fmtNum(h)} must be whole and 80..4096`);
  const xs = [], ys = [];
  for (let i = 0; i <= w; i++) { const x = lo + (hi - lo) * i / w; xs.push(x); ys.push(cx.apply(f, [x])); }
  const F = chartFrame(w, h, title, lo, hi, Math.min(...ys), Math.max(...ys), "chart.fn", "fixed");
  for (let i = 1; i < xs.length; i++) F.out.push(Dr("Line", F.px(xs[i - 1]), F.py(ys[i - 1]), F.px(xs[i]), F.py(ys[i]), PAL[0]));
  return F.out;
});

/* ---- v2 packs: math text csv, and more in bytes and io */
def("gcd", N2, ([a, b]) => { ints("gcd", a, b); a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; });
def("lcm", N2, ([a, b]) => { ints("lcm", a, b); if (!a || !b) return 0; let x = Math.abs(a), y = Math.abs(b); while (y) [x, y] = [y, x % y]; return fin(Math.abs(a / x * b), "lcm"); });
def("clamp", "Num Num Num -> Num", ([x, lo, hi]) => lo > hi ? R("E17", `clamp: low ${fmtNum(lo)} is over high ${fmtNum(hi)}`) : Math.min(hi, Math.max(lo, x)));
def("hypot", N2, ([a, b]) => fin(Math.hypot(a, b), "hypot"));
const sorted = (v, op) => nonEmpty(v, op).slice().sort((x, y) => x - y);
const at = (s, q) => { const p = q * (s.length - 1), i = Math.floor(p); return i + 1 < s.length ? s[i] + (s[i + 1] - s[i]) * (p - i) : s[i]; };
def("median", "(Vec Num) -> Num", ([v]) => at(sorted(v, "median"), 0.5));
def("quantile", "(Vec Num) Num -> Num", ([v, q]) => { if (!(q >= 0 && q <= 1)) R("E17", `quantile: q ${fmtNum(q)} outside 0..1`); return at(sorted(v, "quantile"), q); });
const meanOf = v => { let s = 0; for (const x of v) s += x; return s / v.length; };
def("sd", "(Vec Num) -> Num", ([v]) => { if (v.length < 2) R("E10", "sd needs 2 or more numbers"); const m = meanOf(v); let s = 0; for (const x of v) s += (x - m) * (x - m); return fin(Math.sqrt(s / (v.length - 1)), "sd"); });
def("corr", "(Vec Num) (Vec Num) -> Num", ([a, b]) => {
  sameLen(a, b, "corr"); if (a.length < 2) R("E10", "corr needs 2 or more pairs");
  const ma = meanOf(a), mb = meanOf(b); let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  if (!saa || !sbb) R("E17", "corr: one side does not vary"); return fin(sab / Math.sqrt(saa * sbb), "corr");
});
def("shuffle", "Num (Vec a) -> (Vec a)", ([seed, v]) => { ints("shuffle", seed); const r = mulberry32(seed), out = v.slice(); for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; });

def("words", "Str -> (Vec Str)", ([s]) => capped(s.split(/\s+/).filter(Boolean), "words"));
def("wrap", "Str Num -> (Vec Str)", ([s, w]) => {
  if (!isInt(w) || w < 1) R("E17", `wrap: width ${fmtNum(w)} must be a whole number >= 1`);
  const out = []; let line = "";
  for (const word of s.split(/\s+/).filter(Boolean)) {
    if (line && chars(line).length + 1 + chars(word).length > w) { out.push(line); line = word; } else line = line ? line + " " + word : word;
  }
  if (line) out.push(line); return out;
});
def("edits", "Str Str -> Num", ([a, b]) => { const x = chars(a), y = chars(b); if (x.length * y.length > 1e8) R("E17", "edits: texts too long"); return lev(x, y); });

function csvParse(s) {
  const rows = []; let row = [], f = "", i = 0, q = false, any = false;
  const end = () => { row.push(f); f = ""; }, line = () => { end(); rows.push(row); row = []; any = false; if (rows.length > MAXLEN) R("E17", "csv.parse: over the item cap"); };
  while (i < s.length) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; } f += c; i++; continue; }
    if (c === '"') { if (f !== "") R("E15", `csv.parse: a quote in the middle of a field, row ${rows.length + 1}`); q = true; any = true; i++; continue; }
    if (c === ",") { end(); any = true; i++; continue; }
    if (c === "\r" && s[i + 1] === "\n") { line(); i += 2; continue; }
    if (c === "\n") { line(); i++; continue; }
    f += c; any = true; i++;
  }
  if (q) R("E15", `csv.parse: a quoted field is never closed, row ${rows.length + 1}`);
  if (any || f !== "" || row.length) line();
  return rows;
}
const csvField = f => /[",\r\n]/.test(f) ? '"' + f.replace(/"/g, '""') + '"' : f;
def("csv.parse", "Str -> (Vec (Vec Str))", ([s]) => csvParse(s));
def("csv.str", "(Vec (Vec Str)) -> Str", ([v]) => v.map(r => r.map(csvField).join(",") + "\n").join(""));
def("csv.maps", "Str -> (Vec (Map Str Str))", ([s]) => {
  const [head, ...rows] = csvParse(s); if (!head) return [];
  return rows.map((r, n) => { if (r.length !== head.length) R("E15", `csv.maps: row ${n + 2} has ${r.length} fields, the header has ${head.length}`); let m = EMPTY; head.forEach((h, i) => { m = mput(m, h, r[i]); }); return m; });
});

function sha256(bytes) {                 // FIPS 180-4, over utf8 bytes
  const K = [], H = [], isP = n => { for (let d = 2; d * d <= n; d++) if (n % d === 0) return false; return true; };
  for (let n = 2, k = 0; k < 64; n++) if (isP(n)) { if (k < 8) H[k] = (Math.pow(n, 1 / 2) % 1) * 4294967296 | 0; K[k++] = (Math.pow(n, 1 / 3) % 1) * 4294967296 | 0; }
  const len = bytes.length, total = ((len + 9 + 63) >> 6) << 6, m = new Uint8Array(total);
  m.set(bytes); m[len] = 0x80;
  const bits = len * 8; for (let i = 0; i < 8; i++) m[total - 1 - i] = Math.floor(bits / Math.pow(2, 8 * i)) & 255;
  const W = new Int32Array(64), rr = (x, n) => x >>> n | x << (32 - n);
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = m[o + 4 * i] << 24 | m[o + 4 * i + 1] << 16 | m[o + 4 * i + 2] << 8 | m[o + 4 * i + 3];
    for (let i = 16; i < 64; i++) { const a = W[i - 15], b = W[i - 2]; W[i] = (rr(a, 7) ^ rr(a, 18) ^ a >>> 3) + W[i - 16] + (rr(b, 17) ^ rr(b, 19) ^ b >>> 10) + W[i - 7] | 0; }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = h + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + (e & f ^ ~e & g) + K[i] + W[i] | 0, t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + (a & b ^ a & c ^ b & c) | 0;
      h = g; g = f; f = e; e = d + t1 | 0; d = c; c = b; b = a; a = t1 + t2 | 0;
    }
    [a, b, c, d, e, f, g, h].forEach((x, i) => { H[i] = H[i] + x | 0; });
  }
  return H.map(x => (x >>> 0).toString(16).padStart(8, "0")).join("");
}
def("sha256", "Str -> Str", ([s]) => { if (s.length > 1e8) R("E17", "sha256: text too long"); return sha256(new TextEncoder().encode(s)); });

def("path.join", "Str Str -> Str", ([a, b]) => b[0] === "/" ? normPath(b) : normPath(a === "" ? b : a + "/" + b));
def("path.dir", "Str -> Str", ([p]) => { const n = normPath(p), i = n.lastIndexOf("/"); return i < 0 ? "." : i === 0 ? "/" : n.slice(0, i); });
def("path.base", "Str -> Str", ([p]) => { const n = normPath(p); return n.slice(n.lastIndexOf("/") + 1); });
def("path.ext", "Str -> Str", ([p]) => { const b = normPath(p).split("/").pop(), i = b.lastIndexOf("."); return i > 0 ? b.slice(i) : ""; });

/* ---- which pack owns which name: builtins by their matrix kind, pack types by their prelude */
const PACKOF = new Map();
{
  const kindOf = new Map(MATRIX.split("\n").slice(1).map(l => l.split(" ")).map(p => [p[0], p[1]]));
  for (const n of Object.keys(B)) { const p = KINDPACK[kindOf.get(n)]; if (p) { B[n].pack = p; PACKOF.set(n, p); } }
  for (const [p, d] of Object.entries(PACKS)) for (const s of parse(lex(d.types, []), [])) {
    const t = lowerTop(s, []); PACKOF.set(t.name, p);
    if (t.t === "rec") for (const [f] of t.fields) PACKOF.set(t.name + "." + f, p); else for (const [c] of t.ctors) PACKOF.set(c, p);
  }
}
const ROWNOTE = new Map(MATRIX.split("\n").slice(1).map(l => l.split(" ")).map(p => [p[0], p.slice(5).join(" ")]));
function packHint(name, C) {
  const p = PACKOF.get(name); if (!p || C.packs.has(p)) return null;
  let what = "";
  if (own(B, name)) { const note = ROWNOTE.get(name); what = `. ${name} : ${B[name].sig}` + (note && note !== "!" ? `. ${note}` : ""); }
  else { const decl = PACKS[p].types.split("\n").find(l => new RegExp("[ \\[(]" + name.split(".")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[ \\])]").test(l)); if (decl) what = ". " + decl; }
  return `${name} is in pack ${p}: add (use ${p})${what}`;
}

/* ------------------------------------------------------------------ checker */
class Scope { constructor(p) { this.m = new Map(); this.p = p; } }
function lookup(name, sc, C) { for (let s = sc; s; s = s.p) if (s.m.has(name)) return s.m.get(name); return C.g.get(name); }
function where(en) { return en ? en.line ? ` (line ${LN(en.line)})` : " (builtin)" : ""; }
function declare(name, type, sc, line, C) {
  if (RESERVED.has(name)) C.errs.push(E("E3", `${name} is reserved`, line));
  else if (C.decls.has(name)) C.errs.push(E("E3", `${name} is a type name${where(C.decls.get(name))}; no shadowing`, line));
  else { const en = lookup(name, sc, C); if (en) C.errs.push(E("E3", `${name} is already bound${where(en)}; no shadowing`, line)); else if (C.letLines.has(name)) C.errs.push(E("E3", `${name} is a let on line ${LN(C.letLines.get(name))}; no shadowing`, line)); }
  sc.m.set(name, { kind: "local", type, line });
}
function unknown(name, line, sc, C) {
  if (name === "_") return C.errs.push(E("E1", "_ is a slot only at the top of a -> step, a wildcard in match patterns, and an unused name in fun and for", line));
  if (C.letLines.has(name) && !C.g.has(name)) return C.errs.push(E("E1", `${name} is not defined yet: its let is on line ${LN(C.letLines.get(name))}`, line));
  const hint = packHint(name, C) || foreign(name); if (hint) return C.errs.push(E("E1", hint, line));
  const names = new Set([...C.g.keys(), "true", "false"]);
  for (let s = sc; s; s = s.p) for (const k of s.m.keys()) names.add(k);
  const near = nearest(name, names);
  C.errs.push(E("E1", `unknown name ${name}` + (near ? `. nearest known: ${near}` : ""), line));
}
function inferMatch(e, sc, C) {
  const errs = C.errs, ts = infer(e.x, sc, C);
  let rt = null, sawAny = false, decl = null, lits = null;
  const seen = new Set();
  for (const arm of e.arms) {
    const p = arm.p, s2 = new Scope(sc);
    if (sawAny) errs.push(E("E18", "this arm comes after _ and can never match", arm.line));
    if (p.k === "any") {
      if ((decl && decl.ctors.every(c => seen.has(c.name))) || (seen.has("boolean:true") && seen.has("boolean:false"))) errs.push(E("E18", "every case is already covered: this _ can never match", arm.line));
      sawAny = true;
    }
    else if (p.k === "lit") {
      const lt = typeof p.v === "number" ? NUM : typeof p.v === "string" ? STR : BOOL, got = showT(ts);
      if (!unify(ts, lt)) errs.push(E("E4", `pattern ${unPat(p)} is ${showT(lt)}, the matched value is ${got}`, arm.line));
      const key = typeof p.v + ":" + p.v;
      if (seen.has(key)) errs.push(E("E18", `pattern ${unPat(p)} appears twice`, arm.line));
      seen.add(key); lits = lt;
    } else {
      const en = C.g.get(p.name);
      if (!en || en.kind !== "ctor") {
        const near = nearest(p.name, [...C.g].filter(([, v]) => v.kind === "ctor").map(([k]) => k));
        errs.push(E("E1", packHint(p.name, C) || `unknown constructor ${p.name} in pattern` + (near ? `. nearest known: ${near}` : ""), arm.line));
        for (const b of p.binds || []) if (b !== null) declare(b, fresh(), s2, arm.line, C);
      } else {
        const ct = prune(inst(en.type)), fields = en.nul ? [] : ct.ps, built = en.nul ? ct : ct.r, got = showT(ts);
        if (p.binds === null && !en.nul) errs.push(E("E2", `${p.name} has ${fields.length} field${fields.length === 1 ? "" : "s"}: write (${[p.name, ...fields.map(() => "_")].join(" ")})`, arm.line));
        else if (p.binds !== null && en.nul) errs.push(E("E2", `${p.name} has no fields: write ${p.name} without ( )`, arm.line));
        else if (p.binds !== null && p.binds.length !== fields.length) { errs.push(E("E2", `${p.name} has ${fields.length} field${fields.length === 1 ? "" : "s"}, pattern names ${p.binds.length}`, arm.line)); arm.broken = true; }
        if (!unify(ts, built)) errs.push(E("E4", `pattern ${p.name} is a ${showT(built)}, the matched value is ${got}`, arm.line));
        (p.binds || []).forEach((b, i) => { if (b !== null) declare(b, fields[i] || fresh(), s2, arm.line, C); });
        if (seen.has(p.name)) errs.push(E("E18", `${p.name} appears twice`, arm.line));
        seen.add(p.name); decl = C.decls.get(en.decl);
      }
    }
    const bt = infer(arm.body, s2, C);
    if (!arm.broken) for (const [n, en] of s2.m) if (!en.used) errs.push(E("E20", `${n} is bound and never used. write _ in its place`, arm.line));
    if (!rt) rt = bt;
    else { const a = showT(rt), b = showT(bt); if (!unify(rt, bt)) errs.push(E("E5", `match arms differ: ${a} vs ${b}`, arm.line)); }
  }
  if (!sawAny) {
    if (decl) {
      const miss = decl.ctors.map(c => c.name).filter(n => !seen.has(n));
      if (miss.length) errs.push(E("E18", `match on ${decl.name} misses ${miss.join(" ")}. cover ${miss.length > 1 ? "them" : "it"} or end with _`, e.line));
    } else if (lits === BOOL) { if (!(seen.has("boolean:true") && seen.has("boolean:false"))) errs.push(E("E18", "match on Bool needs true and false, or a last _ arm", e.line)); }
    else if (lits) errs.push(E("E18", `match on ${showT(lits)} needs a last _ arm`, e.line));
  }
  return rt;
}
function infer(e, sc, C) {
  const errs = C.errs;
  switch (e.t) {
    case "err": return fresh();
    case "num": return NUM;
    case "str": return STR;
    case "bool": return BOOL;
    case "var": {
      const en = lookup(e.name, sc, C);
      if (!en) { unknown(e.name, e.line, sc, C); return fresh(); }
      en.used = true;
      if (en.kind === "builtin" && /^(io|re)\./.test(e.name)) C.deps.impure = true;
      if (en.kind === "fn") C.deps.fns.add(e.name); else if (en.kind === "let") C.deps.lets.add(e.name);
      return inst(en.type);
    }
    case "vec": {
      if (!e.items.length) return vecT(fresh());
      const t0 = infer(e.items[0], sc, C);
      for (let i = 1; i < e.items.length; i++) {
        const ti = infer(e.items[i], sc, C), a = showT(ti), b = showT(t0);
        if (!unify(t0, ti)) errs.push(E("E6", `vector item ${i + 1} is ${a}, item 1 is ${b}`, e.items[i].line));
      }
      return vecT(t0);
    }
    case "map": {
      const kt = fresh(), vt = fresh();
      e.pairs.forEach(([k, v], i) => {
        const a = infer(k, sc, C), b = infer(v, sc, C), as = showT(a), bs = showT(b), ks = showT(kt), vs = showT(vt);
        if (!unify(kt, a)) errs.push(E("E6", `map key ${i + 1} is ${as}, key 1 is ${ks}`, k.line));
        if (!unify(vt, b)) errs.push(E("E6", `map value ${i + 1} is ${bs}, value 1 is ${vs}`, v.line));
      });
      return recT("Map", [kt, vt]);
    }
    case "do": { let t = null; for (const x of e.items) t = infer(x, sc, C); return t; }
    case "cat": for (const x of e.items) infer(x, sc, C); return STR;
    case "try": return recT("Res", [infer(e.e, sc, C)]);
    case "up": {
      const tx = infer(e.x, sc, C), seen = new Set();
      for (const s of e.sets) {
        const en = C.g.get(s.field), tv = infer(s.e, sc, C);
        if (!en || en.kind !== "reader") { errs.push(E("E1", `${s.field} is not a field. write Name.field` + (nearest(s.field, [...C.g].filter(([, v]) => v.kind === "reader").map(([k]) => k)) ? `. nearest known: ${nearest(s.field, [...C.g].filter(([, v]) => v.kind === "reader").map(([k]) => k))}` : ""), s.line)); continue; }
        const rt = prune(inst(en.type)), a = showT(tx), b = showT(tv), want = showT(rt.r);
        if (!unify(rt.ps[0], tx)) errs.push(E("E4", `${s.field} is a field of ${showT(rt.ps[0])}, the value is ${a}`, s.line));
        else if (!unify(rt.r, tv)) errs.push(E("E4", `${s.field} holds ${want}, got ${b}`, s.e.line));
        if (seen.has(s.field)) errs.push(E("E2", `${s.field} is set twice`, s.line));
        seen.add(s.field); s.idx = en.idx;
      }
      return tx;
    }
    case "match": return inferMatch(e, sc, C);
    case "if": {
      const c = infer(e.c, sc, C), cs = showT(c);
      if (!unify(c, BOOL)) errs.push(E("E7", `if condition is ${cs}, needs Bool`, e.c.line));
      const a = infer(e.a, sc, C), b = infer(e.b, sc, C), as = showT(a), bs = showT(b);
      if (!unify(a, b)) errs.push(E("E5", `if branches differ: ${as} vs ${bs}`, e.line));
      return a;
    }
    case "with": {
      const s2 = new Scope(sc);
      for (const [n, x, l] of e.binds) declare(n, infer(x, s2, C), s2, l, C);
      const bt = infer(e.body, s2, C);
      for (const [n, , l] of e.binds) if (!s2.m.get(n).used) errs.push(E("E20", `${n} is bound and never used. use it, delete it, or run it for effect with (do ..)`, l));
      return bt;
    }
    case "fun": {
      const s2 = new Scope(sc), ps = e.params.map(() => fresh());
      e.params.forEach((n, i) => { if (n !== "_") declare(n, ps[i], s2, e.pline, C); });
      const r = infer(e.body, s2, C);
      if (e.ret) {
        const rt = parseType(e.ret, { recs: C.decls, rigid: null, packs: C.packs }, errs), a = showT(r), b = showT(rt);
        if (!unify(r, rt)) errs.push(E("E4", `fun body is ${a}, declared ${b}`, e.line));
      }
      return fnT(ps, r);
    }
    case "for": {
      const s2 = new Scope(sc);
      for (const [n, x, l] of e.binds) {
        const t = infer(x, s2, C), el = fresh(), ts = showT(t);
        if (!unify(t, vecT(el))) errs.push(E("E4", `for binds ${n} to ${ts}, needs a Vec`, l));
        if (n !== "_") declare(n, el, s2, l, C);
      }
      if (e.guard) { const g = infer(e.guard, s2, C), gs = showT(g); if (!unify(g, BOOL)) errs.push(E("E7", `for guard is ${gs}, needs Bool`, e.guard.line)); }
      return vecT(infer(e.body, s2, C));
    }
    case "fail": {
      for (const [x, i] of [[e.a, 1], [e.b, 2]]) { const t = infer(x, sc, C), ts = showT(t); if (!unify(t, STR)) errs.push(E("E4", `fail arg ${i} is ${ts}, needs Str`, e.line)); }
      return fresh();
    }
    case "call": {
      let ft, label;
      if (e.f.t === "var") {
        label = e.f.name;
        const en = lookup(label, sc, C);
        if (!en) { unknown(label, e.f.line, sc, C); e.args.forEach(a => infer(a, sc, C)); return fresh(); }
        en.used = true;
        if (en.kind === "builtin" && /^(io|re)\./.test(label)) C.deps.impure = true;
        if (en.kind === "fn") C.deps.fns.add(label); else if (en.kind === "let") C.deps.lets.add(label);
        ft = inst(en.type);
        if (en.kind === "builtin" && label.startsWith("re.") && e.args.length && e.args[0].t === "str") {
          try { new RegExp(e.args[0].v, "u"); }
          catch (x) { errs.push(E("E12", `bad regex ${quote(e.args[0].v)}: ${x.message.replace(/^Invalid regular expression: /, "")}`, e.args[0].line)); }
        }
      } else { label = "this call"; ft = infer(e.f, sc, C); }
      const ats = e.args.map(a => infer(a, sc, C));
      const p = prune(ft);
      if (p.k === "fn") {
        if (p.ps.length !== ats.length) { errs.push(E("E2", `${label} takes ${p.ps.length} arg${p.ps.length === 1 ? "" : "s"}, got ${ats.length}`, e.line)); return p.r; }
        const kd = t => { t = prune(t); return t.k === "rec" ? t.name : t.k; }, kp = p.ps.map(kd), ka = ats.map(kd), firm = k => k !== "var" && k !== "gen" && k !== "rigid";
        let swap = "";
        for (let i = 0; i < ats.length && !swap; i++) for (let j = i + 1; j < ats.length; j++)
          if ([kp[i], kp[j], ka[i], ka[j]].every(firm) && kp[i] !== ka[i] && kp[i] === ka[j] && kp[j] === ka[i]) { swap = `. args ${i + 1} and ${j + 1} look swapped`; break; }
        for (let i = 0; i < ats.length; i++) {
          const nm = new Map(), want = showT(p.ps[i], nm), got = showT(ats[i], nm);
          if (!unify(p.ps[i], ats[i])) errs.push(E("E4", `arg ${i + 1} of ${label}: expected ${want}, got ${got}` + swap, e.args[i].line));
        }
        return p.r;
      }
      if (p.k === "var") {
        const r = fresh(), ft2 = fnT(ats, r), want = showT(ft2);
        if (!unify(p, ft2)) errs.push(E("E4", `${label} cannot be a function ${want}: its type would contain itself`, e.line));
        return r;
      }
      errs.push(E("E4", `${label} is ${showT(p)}, not a function` + (p.k === "rec" && !ats.length ? `: write ${label} without ( )` : ""), e.line));
      return fresh();
    }
  }
  return fresh();
}
function checkProgram(tops, errs, packs) {
  TV = 0; TWORK = 0;
  const g = new Map(), decls = new Map(), info = [], letLines = new Map();
  for (const [name, b] of Object.entries(B)) if (!b.pack || packs.has(b.pack)) g.set(name, { kind: "builtin", type: b.type, line: 0 });
  decls.set("Map", { name: "Map", params: ["?k", "?v"], ctors: [], line: 0 });
  tops.forEach((t, i) => { t.pos = i; if (t.t === "let" && !letLines.has(t.name)) letLines.set(t.name, t.line); });
  const taken = n => RESERVED.has(n) || g.has(n) || decls.has(n);
  const dup = (n, line) => errs.push(E("E3", RESERVED.has(n) ? `${n} is reserved` : `${n} is already bound${where(g.get(n) || decls.get(n))}`, line));

  for (const t of tops) if (t.t === "rec" || t.t === "sum") {       // type names first: every type sees every type
    if (taken(t.name)) { dup(t.name, t.line); t.skip = true; continue; }
    const ctors = t.t === "rec"
      ? [{ name: t.name, fields: t.fields.map(f => f[0]), tys: t.fields.map(f => f[1]), line: t.line }]
      : t.ctors.map(([n, v, l]) => ({ name: n, fields: null, tys: v.items, line: t.prelude ? 0 : l }));
    const params = []; for (const c of ctors) for (const ty of c.tys) typeVarsOf(ty, params);
    decls.set(t.name, { name: t.name, params, ctors, isRec: t.t === "rec", line: t.line, top: t });
  }
  for (const [name, d] of decls) {
    if (!d.top) continue;
    const ctx = { recs: decls, rigid: new Map(), owner: name, packs }, sigs = [];
    for (const p of d.params) ctx.rigid.set(p, { k: "rigid", name: p, owner: name });
    const rt = recT(name, d.params.map(p => ctx.rigid.get(p)));
    if (d.isRec) { const seen = new Set(); for (const [f, , l] of d.top.fields) { if (seen.has(f)) errs.push(E("E3", `field ${f} appears twice in ${name}`, l)); seen.add(f); } }
    for (const c of d.ctors) {
      const fts = c.tys.map(ty => parseType(ty, ctx, errs));
      if (d.isRec ? g.has(c.name) : taken(c.name)) { dup(c.name, c.line); c.dead = true; continue; }
      const nul = !d.isRec && !fts.length, ty = rigidToGen(nul ? rt : fnT(fts, rt));
      g.set(c.name, { kind: "ctor", type: ty, line: c.line, decl: name, nul });
      sigs.push(d.isRec ? showT(ty) : `${c.name} ${showT(ty)}`);
      if (d.isRec) c.fields.forEach((f, i) => { const rn = name + "." + f; if (taken(rn)) dup(rn, d.line); else g.set(rn, { kind: "reader", type: rigidToGen(fnT([rt], fts[i])), line: d.line, idx: i }); });
    }
    d.ctors = d.ctors.filter(c => !c.dead);
    d.top.sig = sigs.join("  |  ");
  }
  for (const t of tops) if (t.t === "fn") {
    if (taken(t.name)) { dup(t.name, t.line); t.skip = true; continue; }
    const ctx = { recs: decls, rigid: new Map(), owner: t.name, packs };
    t.pts = t.params.map(([, ty]) => parseType(ty, ctx, errs));
    t.rt = parseType(t.ret, ctx, errs);
    t.sig = fnT(t.pts, t.rt);
    g.set(t.name, { kind: "fn", type: rigidToGen(t.sig), line: t.line });
  }
  for (const t of tops) {
    const C = { g, decls, errs, letLines, packs, deps: { fns: new Set(), lets: new Set() } };
    const note = (text) => { if (!t.prelude) info.push({ line: t.line, text, code: unTop(t) }); };
    CURLINE = t.line;
    t.deps = C.deps;
    switch (t.t) {
      case "let": {
        const ty = infer(t.expr, null, C);
        if (taken(t.name)) dup(t.name, t.line);
        else g.set(t.name, { kind: "let", type: generalize(ty), line: t.line, pos: t.pos });
        note(`let ${t.name} : ${showT(ty)}`);
        break;
      }
      case "fn": {
        if (t.skip) break;
        const sc = new Scope(null);
        t.params.forEach(([n, , l], i) => declare(n, t.pts[i], sc, l, C));
        const bt = infer(t.body, sc, C), got = showT(bt), want = showT(t.rt);
        if (!unify(bt, t.rt)) errs.push(E("E4", `fn ${t.name} body is ${got}, declared ${want}`, t.body.line));
        note(`fn ${t.name} : ${showT(t.sig)}`);
        break;
      }
      case "show": note(`show : ${showT(infer(t.expr, null, C))}`); break;
      case "dotop": { let ty = null; for (const x of t.exprs) ty = infer(x, null, C); note(`do : ${showT(ty)}`); break; }
      case "check": {
        const a = infer(t.a, null, C), b = infer(t.b, null, C), as = showT(a), bs = showT(b);
        if (!unify(a, b)) errs.push(E("E4", `check sides differ in type: ${as} vs ${bs}`, t.line));
        note(`check : ${showT(a)}`);
        break;
      }
      case "rec": case "sum": if (!t.skip) note(`${t.t} ${t.name} : ${t.sig}`); break;
    }
  }
  // a let, show, check or do may reach a let through fns. that let must already exist.
  const fnTops = new Map(tops.filter(t => t.t === "fn" && !t.skip).map(t => [t.name, t]));
  for (const t of tops) {
    if (t.t === "fn" || !t.deps) continue;
    const seen = new Set(), stack = [...t.deps.fns], reported = new Set();
    while (stack.length) {
      const f = stack.pop(); if (seen.has(f)) continue; seen.add(f);
      const ft = fnTops.get(f); if (!ft) continue;
      for (const l of ft.deps.lets) {
        const en = g.get(l);
        if (en && en.kind === "let" && en.pos >= t.pos && !reported.has(l)) {
          reported.add(l);
          errs.push(E("E1", `${l} is used through fn ${f} before its let on line ${LN(en.line)}`, t.line));
        }
      }
      stack.push(...ft.deps.fns);
    }
  }
  return info;
}

/* ------------------------------------------------------------------ interpreter */
class Env {
  constructor(p) { this.m = new Map(); this.p = p; }
  get(n) { let e = this; do { const v = e.m.get(n); if (v !== undefined) return v; e = e.p; } while (e); }
}
let steps = 0, budget = 0;
const hostLimit = x => /call stack/i.test(x.message) ? new TErr("E9", "too deep for the host stack") : new TErr("E17", `too large for the host (${x.message})`);
function ev(e, env, depth, inFn) {
  for (;;) {
    if (++steps > budget) { const x = new TErr("E9", `step budget of ${budget} spent: endless recursion, or too much data?`, e.line); x.fatal = true; throw x; }
    switch (e.t) {
      case "num": case "str": case "bool": return e.v;
      case "var": return env.get(e.name);
      case "vec": { const r = new Array(e.items.length); for (let i = 0; i < r.length; i++) r[i] = ev(e.items[i], env, depth, false); return r; }
      case "map": { let m = EMPTY; for (const [k, v] of e.pairs) { const kv = ev(k, env, depth, false); m = mput(m, kv, ev(v, env, depth, false)); } return m; }
      case "if": e = ev(e.c, env, depth, false) ? e.a : e.b; continue;
      case "do": { const n = e.items.length - 1; for (let i = 0; i < n; i++) ev(e.items[i], env, depth, false); e = e.items[n]; continue; }
      case "cat": { let s = ""; for (const x of e.items) s += fmt(ev(x, env, depth, false), true); return s; }
      case "up": { const v = ev(e.x, env, depth, false), vals = v.vals.slice(); for (const s of e.sets) vals[s.idx] = ev(s.e, env, depth, false); return { k: "rv", name: v.name, vals }; }
      case "try":
        try { return RV("Ok", [ev(e.e, env, depth, false)]); }
        catch (x) {
          if (x instanceof RangeError) x = hostLimit(x);
          if (x instanceof TErr && !x.fatal) return RV("Err", [x.ucode !== undefined ? x.ucode : x.code, x.umsg !== undefined ? x.umsg : x.message]);
          throw x;
        }
      case "match": {
        const v = ev(e.x, env, depth, false); let arm = null;
        for (const a of e.arms) { const p = a.p; if (p.k === "any" || (p.k === "lit" ? v === p.v : v.name === p.name)) { arm = a; break; } }
        if (!arm) throw new Error("match fell through: " + fmt(v, false));
        if (arm.p.binds && arm.p.binds.length) { env = new Env(env); arm.p.binds.forEach((b, i) => { if (b !== null) env.m.set(b, v.vals[i]); }); }
        e = arm.body; continue;
      }
      case "with": env = new Env(env); for (const [n, x] of e.binds) env.m.set(n, ev(x, env, depth, false)); e = e.body; continue;
      case "fun": return { k: "clo", params: e.params, body: e.body, env, name: null };
      case "for": return evFor(e, env, depth);
      case "fail": {
        const a = ev(e.a, env, depth, false), b = ev(e.b, env, depth, false);
        const x = new TErr("E16", `${a}: ${b}`, e.line); x.ucode = a; x.umsg = b; throw x;
      }
      case "call": {
        const f = ev(e.f, env, depth, false);
        const args = new Array(e.args.length);
        for (let i = 0; i < args.length; i++) args[i] = ev(e.args[i], env, depth, false);
        if (f.k === "clo") {                      // in tail position the frame is replaced, not stacked
          if (!inFn) { depth++; inFn = true; if (depth > MAXDEPTH) throw new TErr("E9", `calls nested deeper than ${MAXDEPTH} (only tail calls are free)`, e.line); }
          env = new Env(f.env);
          for (let i = 0; i < args.length; i++) env.m.set(f.params[i], args[i]);
          e = f.body; continue;
        }
        try { return callPrim(f, args, depth); }
        catch (x) { if (x instanceof TErr && x.line == null) x.line = e.line; throw x; }
      }
    }
    throw new Error("bad node " + e.t);
  }
}
function evFor(e, env, depth) {
  const out = [];
  const go = (i, en) => {
    if (i === e.binds.length) {
      if (e.guard && !ev(e.guard, en, depth, false)) return;
      if (out.length >= MAXLEN) throw new TErr("E17", `for: over the ${MAXLEN} item cap`, e.line);
      out.push(ev(e.body, en, depth, false)); return;
    }
    const [n, x] = e.binds[i], xs = ev(x, en, depth, false);
    for (const v of xs) { const e2 = new Env(en); e2.m.set(n, v); go(i + 1, e2); }
  };
  go(0, env);
  return out;
}
function applyFn(f, args, depth) {
  if (f.k === "clo") {
    if (depth + 1 > MAXDEPTH) R("E9", `calls nested deeper than ${MAXDEPTH} (only tail calls are free)`);
    const env = new Env(f.env);
    for (let i = 0; i < args.length; i++) env.m.set(f.params[i], args[i]);
    return ev(f.body, env, depth + 1, true);
  }
  return callPrim(f, args, depth);
}
function callPrim(f, args, depth) {
  switch (f.k) {
    case "bi": {                      // what a builtin makes counts against the step budget
      if (steps > budget) { const x = new TErr("E9", `step budget of ${budget} spent: endless recursion, or too much data?`); x.fatal = true; throw x; }
      const r = f.fn(args, { apply: (g, a) => applyFn(g, a, depth) });
      if (Array.isArray(r)) steps += r.length * 4; else if (typeof r === "string") steps += r.length >> 3;
      return r;
    }
    case "ctor": return { k: "rv", name: f.name, vals: args };
    case "rd": return args[0].vals[f.idx];
  }
  throw new Error("not callable");
}
function makeEnv(tops) {
  const G = new Env(null);
 for (const n of Object.keys(B)) G.m.set(n, B[n].fn ? { k: "bi", name: n, fn: B[n].fn } : B[n].val);
  for (const t of tops) {
    if (t.t === "rec") {
      G.m.set(t.name, { k: "ctor", name: t.name });
      t.fields.forEach(([f], i) => G.m.set(t.name + "." + f, { k: "rd", name: t.name + "." + f, idx: i }));
    } else if (t.t === "sum") for (const [c, v] of t.ctors) G.m.set(c, v.items.length ? { k: "ctor", name: c } : { k: "rv", name: c, vals: [], nul: true });
  }
  for (const t of tops) if (t.t === "fn") G.m.set(t.name, { k: "clo", params: t.params.map(p => p[0]), body: t.body, env: G, name: t.name });
  return G;
}
function runProgram(tops, emit, st, opts) {
  steps = 0; budget = opts.maxSteps || 2e8; HOST = opts.io; EMIT = emit; FRAMES = [];
  const G = makeEnv(tops);
  for (const t of tops) {
    try {
      switch (t.t) {
        case "let": G.m.set(t.name, ev(t.expr, G, 0, false)); break;
        case "show": emit(fmt(ev(t.expr, G, 0, false), true)); break;
        case "dotop": for (const x of t.exprs) ev(x, G, 0, false); break;
        case "check": {
          const a = ev(t.a, G, 0, false), b = ev(t.b, G, 0, false);
          if (!same(a, b, true)) throw new TErr("ECHECK", `check slipped: got ${fmt(a, false)}, expected ${fmt(b, false)}`, t.line);
          st.checks++; break;
        }
      }
    } catch (x) {
      if (x instanceof TErr) { if (x.line == null) x.line = t.line; throw x; }
      if (x instanceof RangeError) { const y = hostLimit(x); y.line = t.line; throw y; }
      throw x;
    }
  }
}
/* ------------------------------------------------------------------ known before running
   names never change, so a value built from literals, lets and pure builtins is known at check time.
   a run error that such a value makes certain is reported in the check phase, with its usual code. */
function foldProgram(tops, errs) {
  const base = new Map(), consts = new Map(), fns = new Set();
  for (const n of Object.keys(B)) base.set(n, B[n].fn ? { k: "bi", name: n, fn: B[n].fn } : B[n].val);
  for (const t of tops) {
    if (t.t === "rec") { base.set(t.name, { k: "ctor", name: t.name }); t.fields.forEach(([f], i) => base.set(t.name + "." + f, { k: "rd", idx: i })); }
    else if (t.t === "sum") for (const [c, v] of t.ctors) base.set(c, v.items.length ? { k: "ctor", name: c } : { k: "rv", name: c, vals: [], nul: true });
    else if (t.t === "fn") fns.add(t.name);
    else if (t.t === "let") consts.set(t.name, undefined);
  }
  const BIG = 2000, GEN = new Set(["range", "rep", "onehot", "srep", "rand", "pairs", "padl", "padr", "k.randn", "chunk", "shl"]);
  const isFn = v => typeof v === "object" && !Array.isArray(v) && v.k !== "rv" && v.k !== "map";
  const small = v => (Array.isArray(v) && v.length > BIG) || (typeof v === "string" && v.length > 1e5) || (v && v.k === "map" && v.n > BIG) ? undefined : v;
  const look = (name, sc) => { for (let s = sc; s; s = s.p) if (s.m.has(name)) return s.m.get(name); return consts.has(name) ? consts.get(name) : fns.has(name) ? undefined : base.get(name); };
  const sub = sc => ({ m: new Map(), p: sc });
  const all = xs => xs.every(x => x !== undefined);
  let live = true;                   // fold only walks code that must run, so an error it meets is certain. forms the dry pass tried are not reported twice
  const weigh = v => { let n = 0; const go = x => { if (++n > 5000) return; if (Array.isArray(x)) x.forEach(go); else if (x && x.k === "rv") x.vals.forEach(go); else if (x && x.k === "map") n += x.n * 2; }; go(v); return n; };
  const sure = (line, f) => { try { return small(f()); } catch (x) { if (x instanceof TErr && live) errs.push(E(x.code, x.message + ". known before running", line)); return undefined; } };
  function fold(e, sc) {
    switch (e.t) {
      case "num": case "str": case "bool": return e.v;
      case "var": return look(e.name, sc);
      case "vec": { const xs = e.items.map(x => fold(x, sc)); return all(xs) ? small(xs) : undefined; }
      case "map": { const ps = e.pairs.map(([k, v]) => [fold(k, sc), fold(v, sc)]); return ps.every(all) ? sure(e.line, () => ps.reduce((m, [k, v]) => mput(m, k, v), EMPTY)) : undefined; }
      case "if": { const c = fold(e.c, sc); if (c === true) return fold(e.a, sc); if (c === false) return fold(e.b, sc); return undefined; }
      case "do": { let v; for (const x of e.items) v = fold(x, sc); return v; }
      case "cat": { const xs = e.items.map(x => fold(x, sc)); return all(xs) && !xs.some(isFn) ? small(xs.map(x => fmt(x, true)).join("")) : undefined; }
      case "try": return undefined;                        // inside try an error is a value, not a mistake
      case "fail": fold(e.a, sc); fold(e.b, sc); return undefined;
      case "with": { const s2 = sub(sc); for (const [n, x] of e.binds) s2.m.set(n, fold(x, s2)); return fold(e.body, s2); }
      case "fun": return undefined;
      case "for": { const s2 = sub(sc); for (const [n, x] of e.binds) { fold(x, s2); s2.m.set(n, undefined); } return undefined; }
      case "up": { const v = fold(e.x, sc), xs = e.sets.map(s => fold(s.e, sc)); if (v === undefined || !all(xs)) return undefined; const vals = v.vals.slice(); e.sets.forEach((s, i) => { vals[s.idx] = xs[i]; }); return RV(v.name, vals); }
      case "match": {
        const v = fold(e.x, sc);
        const bind = (a, on) => { const s2 = sub(sc); (a.p.binds || []).forEach((b, i) => { if (b !== null) s2.m.set(b, on ? v.vals[i] : undefined); }); return fold(a.body, s2); };
        if (v === undefined || isFn(v)) return undefined;
        const arm = e.arms.find(a => a.p.k === "any" || (a.p.k === "lit" ? v === a.p.v : v.name === a.p.name));
        return arm ? bind(arm, arm.p.k === "ctor") : undefined;
      }
      case "call": {
        const f = fold(e.f, sc), args = e.args.map(a => fold(a, sc));
        if (f === undefined || typeof f !== "object" || !all(args)) return undefined;
        if (f.k === "ctor") return RV(f.name, args);
        if (f.k === "rd") return args[0].vals[f.idx];
        if (f.k !== "bi" || f.name.startsWith("io.") || args.some(isFn)) return undefined;
        if (GEN.has(f.name) && args.some(a => typeof a === "number" && a > BIG)) return undefined;
        if (f.name.startsWith("re.") || args.some(a => weigh(a) > 5000)) return undefined;      // a regex has no time bound. big data waits for the run
        return sure(e.line, () => f.fn(args, {}));
      }
    }
    return undefined;
  }
  for (const t of tops) {
    live = !!t.dirty;
    if (t.t === "let") consts.set(t.name, fold(t.expr, null));
    else if (t.t === "show") fold(t.expr, null);
    else if (t.t === "dotop") for (const x of t.exprs) fold(x, null);
    else if (t.t === "check") {
      const a = fold(t.a, null), b = fold(t.b, null);
      if (live && a !== undefined && b !== undefined && !isFn(a) && !isFn(b) && !same(a, b, true)) errs.push(E("ECHECK", `check slipped: got ${fmt(a, false)}, expected ${fmt(b, false)}. known before running`, t.line));
    }
  }
}

/* names a model brings from other languages. the E1 says what tact writes instead. */
const FOREIGN = new Map();
for (const [names, say] of [
  ["lambda λ", "(fun [x y] body)"],
  ["def define defn defun defvar", "(let name expr) for a value, (fn name [p T ..] R body) for a function"],
  ["var const val set set! setq setf", "nothing is reassigned: (let name expr) at top, (with [name expr] body) inside"],
  ["let* letrec", "(with [a e1  b e2] body). binds are sequential"],
  ["cond elif elsif", "nest (if c a b), or (match x ..)"],
  ["when unless", "(if c a b). both branches are needed"],
  ["begin progn block", "(do a b c)"],
  ["while loop foreach for-each forEach dotimes doseq recur until repeat", "no loops: (for [x xs] body), fold, iter, or a fn whose last call is itself"],
  ["return", "no return: the last expression is the value"],
  ["throw raise error panic assert", '(fail "code" "msg")'],
  ["catch except rescue finally", "(try expr) gives (Ok v) or (Err code msg). match on it"],
  ["import require include load", '(use "file.tact") or (use pack)'],
  ["struct class defrecord defstruct record type data enum union interface", "(rec Name [field T ..]) or (sum Name [A [T ..]  B []])"],
  ["switch case", "(match x pattern body ..  _ body)"],
  ["nil null NULL undefined none Nothing", "there is no null. None, in an (Opt T)"],
  ["True False TRUE FALSE #t #f", "true false"],
  ["== === eq eq? equal equal? equals", "= for Num. same for any two values"],
  ["!= !== not= <> neq /=", "(not (= a b)) or (not (same a b))"],
  ["&& ||", "and or. two args each"], ["!", "not"],
  ["%", "rem (sign of a) or mod (sign of b)"], ["** ^ expt", "pow"], ["// quot div", "idiv"],
  ["++", "concat for Vec. scat or cat for Str"], ["inc dec add1 sub1 1+ 1-", "(+ x 1) (- x 1)"],
  ["length size strlen", "len for Vec, slen for Str, mlen for Map"],
  ["nth elt at aref", "(get v i). (sget s i) for Str"],
  ["car head hd", "(first v) gives an Opt. (get v 0) gives the item"],
  ["cdr tail tl rest", "(drop v 1)"],
  ["cons append conj snoc", "(push v x) or (concat a b)"],
  ["list vector array vec tuple", "[a b c]. (Pair a b) for two types"],
  ["reduce foldl foldr inject", "(fold f start v). f takes acc then item"],
  ["mapcar each map-indexed", "map. enum gives (Pair i x)"],
  ["reverse", "rev"], ["product", "(fold * 1 v)"], ["apply funcall call", "just call it: (f a b)"],
  ["compose comp pipe |>", "(-> x f (g 1))"],
  ["print println printf puts echo display console.log", "(show expr) at top level. (io.print str) inside"],
  ["format sprintf string-append strcat str-join", "(cat a b c) makes one Str"],
  ["substring substr subs", "(ssub s a b)"], ["to-string toString tostring string repr", "(str x)"],
  ["parse-int parseInt parseFloat int float number to-number string->number", "(snum s). (pnum s) gives an Opt"],
  ["dict hash-map hashmap hash table object make-hash", "{k v  k v}"],
  ["assoc put insert", "(mput m k v)"], ["dissoc remove delete", "(mdel m k)"],
  ["contains contains? member includes in has-key", "(has v x) for Vec, (mhas m k) for Map, (shas s part) for Str"],
  ["keys values vals items entries", "mkeys mvals mitems"], ["lookup fetch", "(mget m k) gives an Opt"],
  ["zero? empty? null? nil? even? odd? positive? negative?", "compare: (= x 0), (= (len v) 0), (= (rem x 2) 0)"],
  ["number? string? list? typeof type-of instanceof", "types are checked before running. there are no type tests"],
]) for (const n of names.split(" ")) FOREIGN.set(n, say);
const foreign = name => FOREIGN.has(name) ? `${name} is not tact: ${FOREIGN.get(name)}` : null;

function normPath(p) {              // a/./b and a/x/../b are a/b, so one file has one name
  const out = [];
  for (const part of p.split("/")) { if (part === "." || (part === "" && out.length)) continue; if (part === ".." && out.length && out[out.length - 1] !== ".." && out[out.length - 1] !== "") out.pop(); else out.push(part); }
  return out.join("/");
}
/* ------------------------------------------------------------------ tried before running
   a top form that reaches no io and no regex gives the same result every time. so it is run here, inside
   a small budget, and a run error it ends in is reported in the check phase: every such error at once,
   where the run phase would stop at the first. */
const DRY = 2e5;
function dryProgram(tops, errs) {
  const fnTop = new Map(), letTop = new Map(), mine = tops.filter(t => t.deps);
  for (const t of tops) { if (t.t === "fn") fnTop.set(t.name, t); else if (t.t === "let") letTop.set(t.name, t); }
  for (const t of mine) { t.dirty = !!t.deps.impure; t.lets = new Set(t.deps.lets); }
  for (let again = true; again;) {                       // what a form reaches through fns and lets, to a fixed point
    again = false;
    for (const t of mine) {
      for (const d of [...[...t.deps.fns].map(f => fnTop.get(f)), ...[...t.lets].map(l => letTop.get(l))]) {
        if (!d) continue;
        if (d.dirty && !t.dirty) { t.dirty = true; again = true; }
        if (d.t === "fn") for (const l of d.lets) if (!t.lets.has(l)) { t.lets.add(l); again = true; }
      }
    }
  }
  HOST = null; EMIT = () => {}; FRAMES = [];
  const G = makeEnv(tops), unknown = new Set();
  for (const t of tops) {
    if (t.t !== "let" && t.t !== "show" && t.t !== "check" && t.t !== "dotop") continue;
    if (t.dirty || [...t.lets].some(l => unknown.has(l))) { if (t.t === "let") unknown.add(t.name); continue; }
    steps = 0; budget = DRY;
    try {
      if (t.t === "let") G.m.set(t.name, ev(t.expr, G, 0, false));
      else if (t.t === "show") ev(t.expr, G, 0, false);
      else if (t.t === "dotop") for (const x of t.exprs) ev(x, G, 0, false);
      else {
        const a = ev(t.a, G, 0, false), b = ev(t.b, G, 0, false);
        if (!same(a, b, true)) errs.push(E("ECHECK", `check slipped: got ${fmt(a, false)}, expected ${fmt(b, false)}. known before running`, t.line));
      }
    } catch (x) {
      if (t.t === "let") unknown.add(t.name);
      if (x instanceof TErr && !x.fatal) errs.push(E(x.code, x.message + ". known before running" + (x.line != null && x.line !== t.line ? `. it fails on line ${LN(x.line)}` : ""), t.line));      // the form that leads there, and where it breaks
    }
  }
}
const dirOf = p => { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i + 1); };
const headOf = s => s.t === "list" && s.items.length && isSym(s.items[0]) ? s.items[0].v : null;
function expandUses(sxs, file, U) {   // (use "path") becomes that file's let fn rec sum check forms, in place, once
  const out = [];
  for (const s of sxs) {
    if (headOf(s) !== "use" || s.items.length !== 2 || s.items[1].t !== "str") { out.push(s); continue; }
    const rel = s.items[1].v, path = normPath(rel[0] === "/" ? rel : dirOf(file) + rel);
    if (U.seen.has(path)) continue;
    U.seen.add(path);
    let text;
    try { if (!U.io || typeof U.io.read !== "function") throw new Error("this host cannot read files"); text = String(U.io.read(path)); }
    catch (x) { U.errs.push(E("E12", `use: cannot read ${path}: ${String(x && x.message || x).split("\n")[0]}`, s.line)); continue; }
    FILES.push(path);
    const n0 = U.errs.length, sub = parse(lex(text, U.errs, (FILES.length - 1) * LINEBASE), U.errs);
    if (U.errs.length !== n0) continue;
    for (const x of expandUses(sub, path, U)) { const h = headOf(x); if (h !== "show" && h !== "do") out.push(x); }
  }
  return out;
}
function preludeTops(packs) {
  const errs = [], text = [PRELUDE, ...[...packs].map(p => PACKS[p].types)].join("\n"), tops = parse(lex(text, errs), errs).map(s => lowerTop(s, errs));
  if (errs.length) throw new Error("prelude: " + errs[0].msg);
  for (const t of tops) { t.prelude = true; t.line = 0; }
  return tops;
}
function run(src, opts = {}) {
  const errs = [], st = { checks: 0 }, out = [];
  const io = opts.io || memHost(), file = opts.file || "";
  const emit = s => { out.push(s); if (opts.onOut) opts.onOut(s); };
  const place = e => { const l = e.line || 0, r = { code: e.code, msg: e.msg, line: l % LINEBASE }; if (l >= LINEBASE) r.file = files[Math.floor(l / LINEBASE)]; return r; };
  let info = [];
  const files = FILES = [file];
  try {
    const toks = lex(src, errs);
    const before = errs.length;
    let sxs = parse(toks, errs);
    if (errs.length === before) sxs = expandUses(sxs, file, { errs, io, seen: new Set([normPath(file)]) });
    if (errs.length === before) {       // structure is sound: lower and check everything, report all
      const mine = [], packs = new Set();
      for (const s of sxs) { const t = lowerTop(s, errs); if (t) { mine.push(t); if (t.t === "use") packs.add(t.pack); } }
      for (const p of [...packs]) for (const q of PACKS[p].needs || []) packs.add(q);
      const tops = [...preludeTops(packs), ...mine];
      info = checkProgram(tops, errs, packs);
      if (!errs.length) { dryProgram(tops, errs); foldProgram(tops, errs); }
      for (const i of info) if (i.line >= LINEBASE) { i.file = files[Math.floor(i.line / LINEBASE)]; i.line %= LINEBASE; }
      if (!errs.length) {
        if (!opts.checkOnly) runProgram(tops, emit, st, { maxSteps: opts.maxSteps, io });
        return { phase: "ok", errors: [], output: out, checks: st.checks, info };
      }
    }
    const keyed = new Map();
    for (const e of errs) keyed.set(e.code + "|" + e.line + "|" + e.msg, e);
    return { phase: "check", errors: [...keyed.values()].sort((a, b) => a.line - b.line).map(place), output: [], checks: 0, info };
  } catch (x) {
    if (x instanceof TErr) return { phase: "run", errors: [place({ code: x.code, msg: x.message, line: x.line })], output: out, checks: st.checks, info };
    if (x instanceof TooBig) return { phase: "check", errors: [place({ code: "E4", msg: "the types here grow too large to check. give the pieces fn signatures", line: CURLINE })], output: [], checks: 0, info };
    if (x instanceof RangeError) return { phase: "check", errors: [{ code: "E12", msg: "too deep or too large to check. name the inner parts with let, with or fn", line: 0 }], output: [], checks: 0, info };
    return { phase: "internal", errors: [{ code: "BUG", msg: String(x && x.stack || x), line: 0 }], output: out, checks: st.checks, info };
  }
}

/* ------------------------------------------------------------------ tests */
const TESTS = [
  ["arith","(show (+ 1 2))\n(show (/ 1 4))\n(show (* 1.5 2))\n(show (neg 0))\n(show (rem 7 3))","3\n0.25\n3\n0\n1"],
  ["let","(let x 5)\n(show (* x x))","25"],
  ["fn recursion","(fn fact [n Num] Num (if (<= n 1) 1 (* n (fact (- n 1)))))\n(show (fact 10))","3628800"],
  ["tail call is free","(fn loop [n Num acc Num] Num (if (= n 0) acc (loop (- n 1) (+ acc 1))))\n(show (loop 100000 0))","100000"],
  ["tail call through with","(fn cnt [n Num] Num (if (= n 0) 0 (with [m (- n 1)] (cnt m))))\n(show (cnt 50000))","0"],
  ["depth 500 ok","(fn down [n Num] Num (if (= n 0) 0 (+ 1 (down (- n 1)))))\n(show (down 500))","500"],
  ["depth 700 = E9","(fn down [n Num] Num (if (= n 0) 0 (+ 1 (down (- n 1)))))\n(show (down 700))","!E9"],
  ["depth inside map = E9","(fn d [n Num] Num (if (= n 0) 0 (vsum (map d [(- n 1)]))))\n(show (d 700))","!E9"],
  ["with","(show (with [a 2 b (* a 3)] (+ a b)))","8"],
  ["map fun","(show (map (fun [x] (* x x)) [1 2 3]))","[1 4 9]"],
  ["builtin as value","(show (fold + 0 (range 5)))","10"],
  ["fold acc","(show (fold (fun [acc x] (scat acc (str x))) \"\" [1 2 3]))","123"],
  ["filter","(show (filter (fun [x] (< 2 x)) [1 5 2 7]))","[5 7]"],
  ["for flat + guard","(show (for [i (range 3) j (range 3)] (< i j) [i j]))","[[0 1] [0 2] [1 2]]"],
  ["pairs","(check (pairs 0 3) [[0 1] [0 2] [1 2]])\n(show (len (pairs 2 6)))","6"],
  ["-> slots","(show (-> 3 (+ 1) (* 2) (- 100 _)))","92"],
  ["-> bare names","(show (-> [3 1 2] sort rev))","[3 2 1]"],
  ["rec","(rec P [x Num y Num])\n(let p (P 1 2))\n(show (P.x p))\n(show p)\n(show (map P.y [p (P 3 4)]))","1\n(P 1 2)\n[2 4]"],
  ["rec self ref","(rec T [v Num kids (Vec T)])\n(fn total [t T] Num (+ (T.v t) (vsum (map total (T.kids t)))))\n(show (total (T 1 [(T 2 []) (T 3 [])])))","6"],
  ["generic fn","(fn twice [f (Fn ?a ?a) x ?a] ?a (f (f x)))\n(show (twice (fun [n] (* n 3)) 2))\n(show (twice (fun [s] (scat s \"!\")) \"hi\"))","18\nhi!!"],
  ["?a rigid in body","(fn bad [x ?a] ?a (+ x 1))","!E4,E4"],
  ["?a outside a signature","(show ((fun [x] ?a x) 1))","!E4"],
  ["let is polymorphic","(let id (fun [x] x))\n(show (id 3))\n(show (id \"a\"))","3\na"],
  ["mutual recursion","(fn ev [n Num] Bool (if (= n 0) true (od (- n 1))))\n(fn od [n Num] Bool (if (= n 0) false (ev (- n 1))))\n(show (ev 10))\n(show (od 7))","true\ntrue"],
  ["strings","(show (split \"a,b,c\" \",\"))\n(show (join [\"a\" \"b\"] \"-\"))\n(show (slen \"héllo\"))\n(show (sget \"abc\" 1))\n(show (ssub \"hello\" 1 3))\n(show (code \"A\"))\n(show (chr 66))\n(show (snum \" 3.5 \"))\n(show (str [1 2]))\n(show (slt \"ab\" \"b\"))\n(show (split \"hi\" \"\"))","[\"a\" \"b\" \"c\"]\na-b\n5\nb\nel\n65\nB\n3.5\n[1 2]\ntrue\n[\"h\" \"i\"]"],
  ["escapes","(show \"a\\tb\")\n(show (slen \"a\\nb\"))\n(show [\"q\\\"\"])","a\tb\n3\n[\"q\\\"\"]"],
  ["check tol 1e-9","(check (+ 0.1 0.2) 0.3)\n(show (= (+ 0.1 0.2) 0.3))","false"],
  ["check slip","(check (+ 1 1) 3)","!ECHECK"],
  ["fn compare by identity","(let f (fun [x] x))\n(show (same f f))\n(show (same (fun [x] x) (fun [x] x)))","true\nfalse"],
  ["iroot exact","(show (iroot 27 3))\n(show (iroot 26 3))\n(show (iroot 1000000000000 2))\n(show (iroot 9007199254740993 1))","3\n2\n1000000\n9007199254740992"],
  ["bits","(use bit)\n(show (bxor 5 3))\n(show (band 6 3))\n(show (bor 4 1))","6\n2\n5"],
  ["uniq flat","(show (uniq [3 1 3 2 1]))\n(show (flat [[1] [] [2 3]]))\n(show (uniq [[1 2] [1 2] [2]]))","[3 1 2]\n[1 2 3]\n[[1 2] [2]]"],
  ["vector ops","(use mat)\n(show (rep 3 \"x\"))\n(show (onehot 3 1))\n(show (sort [3 -1 2]))\n(show (slice [1 2 3] 1 3))\n(show (concat [1] [2 3]))\n(show (dot [1 2] [3 4]))\n(show (vnorm [3 4]))\n(show (scale [1 2] 3))\n(show (vsub [5 5] [1 2]))","[\"x\" \"x\" \"x\"]\n[0 1 0]\n[-1 2 3]\n[2 3]\n[1 2 3]\n11\n5\n[3 6]\n[4 3]"],
  ["matrix","(use mat)\n(show (matmul [[1 2] [3 4]] [[0 1] [1 0]]))\n(show (tpose [[1 2 3]]))","[[2 1] [4 3]]\n[[1] [2] [3]]"],
  ["svdvals","(use mat)\n(check (svdvals [[3 0] [0 4]]) [4 3])\n(check (svdvals [[1 2] [3 4]]) [(sqrt (+ 15 (sqrt 221))) (sqrt (- 15 (sqrt 221)))])\n(show (len (svdvals [[1 2 3]])))","1"],
  ["kernels js","(use mat)\n(show (k.backend))\n(show (k.rank [[1 2] [2 4]]))\n(show (k.rank [[1 0] [0 1]]))\n(check (k.det [[1 2] [3 4]]) -2)\n(check (k.solve [[2 0] [0 4]] [[2] [8]]) [[1] [2]])\n(check (k.randn 2 3 7) (k.randn 2 3 7))\n(show (len (get (k.randn 2 3 7) 0)))","js\n1\n2\n3"],
  ["empty vec","(show (len []))","0"],
  ["comments","; hello\n(show 1) ; trailing","1"],
  ["fun declared result","(show ((fun [x] Num (* x 2)) 4))","8"],
  ["show fn values","(fn sq [x Num] Num (* x x))\n(show sq)\n(show (fun [x] x))\n(show len)","<fn sq>\n<fun>\n<builtin len>"],
  ["E1 typo","(show (lenn [1]))","!E1"],
  ["E1 let later","(fn f [x Num] Num (+ x c))\n(let c 2)","!E1"],
  ["E1 through fn","(let a (f 1))\n(let c 2)\n(fn f [x Num] Num (+ x c))","!E1"],
  ["E1 _ outside ->","(show (+ _ 1))","!E1"],
  ["E2 builtin","(show (+ 1))","!E2"],
  ["E2 fun value","(let f (fun [x] x))\n(show (f 1 2))","!E2"],
  ["E2 form","(show (if true 1))","!E2"],
  ["E3 rebind","(let x 1)\n(let x 2)","!E3"],
  ["E3 shadow builtin","(show (with [len 3] len))","!E3"],
  ["E3 shadow param","(fn f [x Num] Num (with [x 2] x))","!E3"],
  ["E4","(show (+ 1 \"a\"))","!E4"],
  ["E4 self application","(show (map (fun [x] (x x)) [1 2]))","!E4"],
  ["E4 fn result","(fn f [x Num] Str (+ x 1))","!E4"],
  ["E5","(show (if true 1 \"a\"))","!E5"],
  ["E6","(show [1 \"a\"])","!E6"],
  ["E7","(show (if 1 2 3))","!E7"],
  ["E7 guard","(show (for [x [1 2]] x x))","!E7"],
  ["E8 expression at top","(+ 1 2)","!E8"],
  ["E8 let inside","(show (let x 1))","!E8"],
  ["E10 get","(show (get [1 2] 5))","!E10"],
  ["E10 slice","(show (slice [1 2 3] 2 1))","!E10"],
  ["E11 vadd","(use mat)\n(show (vadd [1 2] [1]))","!E11"],
  ["E11 map2","(show (map2 + [1 2] [1]))","!E11"],
  ["E11 matmul","(use mat)\n(show (matmul [[1 2]] [[1 2]]))","!E11"],
  ["E12 unclosed","(show (+ 1 2)","!E12"],
  ["E12 big literal","(show 1e400)","!E12"],
  ["E14 singular","(use mat)\n(show (k.solve [[1 2] [2 4]] [[1] [2]]))","!E14"],
  ["E15","(show (snum \"x1\"))","!E15"],
  ["E16","(show (fail \"oops\" \"bad input\"))","!E16"],
  ["E17 zero","(show (/ 1 0))","!E17"],
  ["E17 sqrt","(show (sqrt -1))","!E17"],
  ["E17 overflow","(show (exp 1000))","!E17"],
  ["all check errors at once","(show (lenn 1))\n(show (+ 1 \"a\"))\n(show (if true 1 \"b\"))","!E1,E4,E5"],
  ["nothing runs after a check error","(show 1)\n(show (+ 1 \"a\"))","!E4"],
  ["run stops at first error","(use io)\n(fn inv [x Num] Num (/ 1 x))\n(show 1)\n(show (inv (len (io.args))))\n(show (get [] (len (io.args))))","run!E17"],
  ["sum + match","(sum Shape [Circle [Num] Rect [Num Num] Point []])\n(fn area [s Shape] Num (match s (Circle r) (* r r) (Rect w h) (* w h) Point 0))\n(show (map area [(Circle 2) (Rect 2 3) Point]))\n(show Point)\n(show (Circle 1))","[4 6 0]\nPoint\n(Circle 1)"],
  ["match literals","(fn nm [n Num] Str (match n 0 \"zero\" 1 \"one\" _ \"many\"))\n(show (map nm [0 1 5]))\n(show (match true true 1 false 0))\n(show (match \"b\" \"a\" 1 _ 2))","[\"zero\" \"one\" \"many\"]\n1\n2"],
  ["match rec","(rec P [x Num y Num])\n(show (match (P 1 2) (P a _) a))","1"],
  ["match is a tail call","(fn cnt [n Num] Num (match (= n 0) true 0 false (cnt (- n 1))))\n(show (cnt 50000))","0"],
  ["E18 ctor missed","(show (match (Some 1) (Some x) x))","!E18"],
  ["E18 Num needs _","(show (match 1 1 2))","!E18"],
  ["E18 arm after _","(show (match 1 _ 2 1 3))","!E18"],
  ["E18 twice","(show (match (Some 1) None 0 None 1 (Some x) x))","!E18"],
  ["E1 unknown ctor","(show (match (Some 1) (Sme x) x _ 0))","!E1"],
  ["E2 pattern arity","(show (match (Some 1) (Some x y) x None 0))","!E2"],
  ["E4 pattern type","(show (match 1 None 0 _ 1))","!E4"],
  ["E5 match arms","(show (match (Some 1) (Some x) x None \"a\"))","!E5"],
  ["E3 pattern shadows","(let x 1)\n(show (match (Some 1) (Some x) x None 0))","!E3"],
  ["E12 nested pattern","(show (match (Some (Some 1)) (Some (Some x)) x _ 0))","!E12"],
  ["generic rec","(rec Cell [v ?a])\n(fn uncell [b (Cell ?a)] ?a (Cell.v b))\n(show (uncell (Cell \"s\")))\n(show (Cell.v (Cell 2)))","s\n2"],
  ["generic sum","(sum Tree [Leaf [] Node [(Tree ?a) ?a (Tree ?a)]])\n(fn size [t (Tree ?a)] Num (match t Leaf 0 (Node l _ r) (+ 1 (+ (size l) (size r)))))\n(show (size (Node Leaf 1 (Node Leaf 2 Leaf))))","2"],
  ["E4 type args","(rec Cell [v ?a])\n(fn f [b Cell] Num 1)\n(fn g [b (Cell Num Num)] Num 1)","!E4,E4"],
  ["E3 ctor and type names","(sum A [B []])\n(let B 1)\n(let A 2)\n(sum C [B []])","!E3,E3,E3"],
  ["E4 nullary ctor called","(show (None))","!E4"],
  ["Opt","(show (first [1 2]))\n(show (first []))\n(show (else (last [1 2]) 0))\n(show (else (mget {} \"k\") 7))\n(show (map Some [1]))","(Some 1)\nNone\n2\n7\n[(Some 1)]"],
  ["need = E16","(show (need (find (fun [x] (< 5 x)) [1 2]) \"nothing over 5\"))","!E16"],
  ["try","(show (try (/ 1 0)))\n(show (try (+ 1 2)))\n(show (try (fail \"nope\" \"bad input\")))\n(show (unwrap (try (get [1] 0))))\n(show (match (try (get [1] 9)) (Ok _) \"ok\" (Err c _) c))","(Err \"E17\" \"division by zero\")\n(Ok 3)\n(Err \"nope\" \"bad input\")\n1\nE10"],
  ["unwrap raises again","(show (unwrap (try (get [1] 3))))","!E10"],
  ["try cannot catch the step budget","(fn spin [n Num] Num (spin (+ n 1)))\n(show (try (spin 0)))","!E9",null,100000],
  ["do + cat","(show (do 1 2 \"x\"))\n(show (cat \"n=\" 3 \" v=\" [\"a\" \"b\"] \" \" true))","x\nn=3 v=[\"a\" \"b\"] true"],
  ["top do + io.print","(do (io.print \"a\") (io.print (cat 1 2)))\n(show 3)","a\n12\n3"],
  ["maps","(let m {\"b\" 2 \"a\" 1})\n(show m)\n(show (mget m \"a\"))\n(show (mget m \"z\"))\n(show (mput m \"c\" 3))\n(show (mkeys (mdel m \"a\")))\n(show (mlen m))\n(show {})\n(show (mhas m \"b\"))\n(show (mvals (mmerge m {\"a\" 9})))\n(show (mmap (fun [v] (* v 10)) m))","{\"a\" 1 \"b\" 2}\n(Some 1)\nNone\n{\"a\" 1 \"b\" 2 \"c\" 3}\n[\"b\"]\n2\n{}\ntrue\n[9 2]\n{\"a\" 10 \"b\" 20}"],
  ["maps build","(fn tally [ws (Vec Str)] (Map Str Num) (fold (fun [m w] (mupd m w 0 (fun [n] (+ n 1)))) {} ws))\n(show (tally (split \"a b a c a\" \" \")))\n(show (mitems (mfrom [(Pair 2 \"x\") (Pair 1 \"y\")])))\n(show (group (fun [x] (rem x 2)) (range 5)))\n(check {1 2} (mput {} 1 2))\n(show {[1 2] \"v\"})","{\"a\" 3 \"b\" 1 \"c\" 1}\n[(Pair 1 \"y\") (Pair 2 \"x\")]\n{0 [0 2 4] 1 [1 3]}\n{[1 2] \"v\"}"],
  ["maps stay balanced","(let m (fold (fun [acc i] (mput acc i (* i i))) {} (range 20000)))\n(show (mlen m))\n(show (mget m 19999))\n(show (mlen (fold (fun [acc i] (mdel acc i)) m (range 19990))))","20000\n(Some 399960001)\n10"],
  ["E6 map","(show {1 \"a\" 2 3})","!E6"],
  ["E12 map odd","(show {1 2 3})","!E12"],
  ["E17 fn as key","(show (mput {1 len} 2 len))\n(show (mput {} len 1))","!E17"],
  ["vectors v2","(show (zip [1 2] [\"a\" \"b\"]))\n(show (enum [\"x\"]))\n(show (sortby (fun [s] (slen s)) [\"ccc\" \"a\" \"bb\"]))\n(show (order [\"b\" \"a\"]))\n(show (take [1 2 3] 2))\n(show (drop [1 2 3] 2))\n(show (any (fun [x] (> x 2)) [1 3]))\n(show (all (fun [x] (>= x 2)) [1 3]))\n(show (index [5 6] 6))\n(show (chunk [1 2 3] 2))\n(show (scan + 0 [1 2 3]))\n(show (iter (fun [x] (* x 2)) 1 10))\n(show (cmp [1 2] [1 3]))\n(show (push [1] 2))\n(show (has [\"a\"] \"a\"))\n(show (count isint [1 1.5 2]))\n(show (mean [1 2 6]))\n(show (vmax [1 5 2]))","[(Pair 1 \"a\") (Pair 2 \"b\")]\n[(Pair 0 \"x\")]\n[\"a\" \"bb\" \"ccc\"]\n[\"a\" \"b\"]\n[1 2]\n[3]\ntrue\nfalse\n(Some 1)\n[[1 2] [3]]\n[1 3 6]\n1024\n-1\n[1 2]\ntrue\n2\n3\n5"],
  ["E10 vmax empty","(show (vmax []))","!E10"],
  ["numbers v2","(use math)\n(use bit)\n(show (round 2.5))\n(show (ceil 1.2))\n(show (trunc -1.7))\n(show (idiv 7 2))\n(show (mod -1 3))\n(show (fix pi 2))\n(show (sign -3))\n(show (shl 1 10))\n(show (shr 1024 3))\n(check (atan2 1 1) (/ pi 4))\n(check (tan (atan 2)) 2)\n(show (len (rand 1 5)))\n(check (rand 7 3) (rand 7 3))","3\n2\n-1\n3\n2\n3.14\n-1\n1024\n128\n5"],
  ["E17 asin","(use math)\n(show (asin 2))","!E17"],
  ["strings v2","(use text)\n(use bytes)\n(show (upper \"ab\"))\n(show (trim \"  x \"))\n(show (sfind \"hello\" \"ll\"))\n(show (sreplace \"a-b-c\" \"-\" \"+\"))\n(show (starts \"hello\" \"he\"))\n(show (lines \"a\\nb\\n\"))\n(show (padl \"7\" 3 \"0\"))\n(show (padr \"ab\" 4 \".\"))\n(show (pnum \"x\"))\n(show (pnum \"2.5\"))\n(show (radix 255 16))\n(show (pradix \"ff\" 16))\n(show (pradix \"12\" 2))\n(show (srep \"ab\" 2))","AB\nx\n(Some 2)\na+b+c\ntrue\n[\"a\" \"b\"]\n007\nab..\nNone\n(Some 2.5)\nff\n(Some 255)\nNone\nabab"],
  ["regex","(use re)\n(show (re.test \"^a+$\" \"aaa\"))\n(show (re.find \"(\\\\d+)-(\\\\d+)\" \"1-2 30-40\"))\n(show (re.replace \"\\\\s+\" \"a  b   c\" \" \"))\n(show (re.split \",\\\\s*\" \"a, b,c\"))\n(show (re.replace \"(\\\\w)(\\\\w)\" \"ab\" \"$2$1\"))","true\n[[\"1-2\" \"1\" \"2\"] [\"30-40\" \"30\" \"40\"]]\na b c\n[\"a\" \"b\" \"c\"]\nba"],
  ["E12 regex literal is checked first","(use re)\n(show 1)\n(show (re.test \"(\" \"a\"))","!E12"],
  ["E14 regex built at run time","(use re)\n(show (re.test (scat \"(\" \"\") \"a\"))","!E14"],
  ["json","(use json)\n(let j (json.parse \"{\\\"b\\\": \\\"x\\\", \\\"a\\\": [1, true, null]}\"))\n(show j)\n(show (json.str j))\n(show (json.get j \"b\"))\n(show (json.get j \"zz\"))\n(show (json.str (JArr [(JNum 1.5) (JObj {\"k\" JNull})])))","(JObj {\"a\" (JArr [(JNum 1) (JBool true) JNull]) \"b\" (JStr \"x\")})\n{\"a\":[1,true,null],\"b\":\"x\"}\n(Some (JStr \"x\"))\nNone\n[1.5,{\"k\":null}]"],
  ["E15 json","(use json)\n(show (json.parse \"{\"))","!E15"],
  ["bytes + dates","(use time)\n(use bytes)\n(show (b64.enc \"hé\"))\n(show (b64.dec \"aMOp\"))\n(show (utf8 \"é\"))\n(show (unutf8 [104 105]))\n(show (date.iso 0))\n(show (date.parse \"1970-01-02T00:00:00Z\"))","aMOp\nhé\n[195 169]\nhi\n1970-01-01T00:00:00.000Z\n86400000"],
  ["E15 bad utf8","(use bytes)\n(show (unutf8 [255]))","!E15"],
  ["kernels v2","(use mat)\n(check (k.pinv [[2 0] [0 4]]) [[0.5 0] [0 0.25]])\n(check (k.pinv [[1 2] [2 4]]) [[0.04 0.08] [0.08 0.16]])\n(check (matmul [[1 2] [3 4] [5 6]] (matmul (k.pinv [[1 2] [3 4] [5 6]]) [[1 2] [3 4] [5 6]])) [[1 2] [3 4] [5 6]])\n(check (k.eig [[2 0] [0 3]]) [[3 2] [0 0]])\n(check (k.eig [[0 -1] [1 0]]) [[0 0] [1 -1]])\n(check (k.eig [[0 1 0] [0 0 1] [6 -11 6]]) [[3 2 1] [0 0 0]])\n(check (k.eig [[1 2 0 0] [-2 1 0 0] [0 0 5 1] [0 0 0 7]]) [[7 5 1 1] [0 0 2 -2]])\n(show (< (abs (- (/ (get (svdvals [[1 0] [0 1e-12]]) 1) 1e-12) 1)) 1e-6))\n(show (len (k.pinv [[1 2 3]])))","true\n3"],
  ["E14 eig not square","(use mat)\n(show (k.eig [[1 2 3]]))","!E14"],
  ["io memory files","(use io)\n(do (io.write \"a.txt\" \"hi\\nyo\"))\n(show (io.read \"a.txt\"))\n(show (io.exists \"a.txt\"))\n(show (io.ls \".\"))\n(do (io.append \"a.txt\" \"!\") (io.writeb \"d/b.bin\" [0 255]))\n(show (lines (io.read \"a.txt\")))\n(show (io.readb \"d/b.bin\"))\n(show (io.ls \".\"))\n(show (io.isdir \"d\"))\n(show (io.rm \"a.txt\"))\n(show (io.exists \"a.txt\"))\n(show (io.args))\n(show (io.env \"NOPE\"))\n(show (io.stdin))","hi\nyo\ntrue\n[\"a.txt\"]\n[\"hi\" \"yo!\"]\n[0 255]\n[\"a.txt\" \"d\"]\ntrue\ntrue\nfalse\n[]\nNone\n"],
  ["E19 io failed","(use io)\n(show (io.read \"missing.txt\"))","!E19"],
  ["E19 is caught by try","(use io)\n(show (match (try (io.read \"nope\")) (Ok s) s (Err c _) c))","E19"],
  ["E13 host lacks it","(use io)\n(show (Sh.code (io.sh \"true\")))","!E13"],
  ["E14 http url","(use io)\n(show (Http.status (io.http \"GET\" \"file:///etc/passwd\" {} \"\")))","!E14"],
  ["use","(use \"lib/a.tact\")\n(use \"lib/a.tact\")\n(show (double base))\n(show (Tag.n (Tag 1)))","20\n1",{"lib/a.tact":"(use \"b.tact\")\n(fn double [x Num] Num (* x 2))\n(show \"hidden\")\n(do (io.print \"hidden too\"))\n(check (double 2) 4)","lib/b.tact":"(use \"a.tact\")\n(let base 10)\n(rec Tag [n Num])"}],
  ["use reports the file","(use \"bad.tact\")\n(show 1)","!E4@bad.tact:2",{"bad.tact":"(let p 1)\n(let q (+ 1 \"a\"))"}],
  ["E12 use unreadable","(use \"nope.tact\")\n(show 1)","!E12"],
  ["E8 top form inside","(show (sum X [A []]))","!E8"],
  ["frames","(use io)\n(use draw)\n(show (rgb 255 0 300.4))\n(show (for [t (range 3)] (io.frame 8 8 [(Box 0 0 8 8 \"black\") (Line 0 0 t t (rgb 9 9 9)) (Dot t 1 \"red\")])))\n(show (io.sheet \"s.png\" 2))\n(show (take (io.readb \"s.png\") 4))\n(show (try (io.sheet \"s.png\" 0)))","#ff00ff\n[1 2 3]\n3\n[137 80 78 71]\n(Err \"E17\" \"io.sheet: 0 columns must be a whole number >= 1\")"],
  ["ascii is a value","(use draw)\n(show (ascii 8 8 [(Box 0 0 8 8 \"#222\") (Line 0 0 7 7 \"white\") (Box 4 0 4 2 \"gray\")] 8))\n(check (ascii 4 2 [(Dot 0 0 \"white\")] 4) \"@\")","@@  ====\n  @@\n    @@\n      @@"],
  ["E14 color","(use draw)\n(show (ascii 4 4 [(Dot 0 0 \"rebeccapurple\")] 4))","!E14"],
  ["E14 sheet without frames","(use draw)\n(show (io.sheet \"s.png\" 4))","!E14"],
  ["E4 frame takes shapes","(use draw)\n(show (io.frame 8 8 [1 2]))","!E4"],
  ["E17 frame size","(use draw)\n(show (io.frame 0 8 []))","!E17"],
  ["E1 names the pack","(show (json.parse \"1\"))\n(fn f [j Json] Num 1)\n(show (match 1 (JNum n) n _ 0))\n(show (io.read \"x\"))","!E1,E1,E1,E1"],
  ["E1 unknown pack","(use jsn)","!E1"],
  ["pack names are free until used","(rec Box [v Num])\n(fn rgb [x Num] Num x)\n(let Json 3)\n(show (+ (Box.v (Box 1)) (rgb Json)))","4"],
  ["E3 pack names are taken once used","(use draw)\n(rec Box [v Num])","!E3"],
  ["a used file brings its packs","(use \"j.tact\")\n(show (size \"[1,2]\"))","2",{"j.tact":"(use json)\n(fn size [s Str] Num (match (json.parse s) (JArr v) (len v) _ 0))"}],
  ["known before running: let + index","(let xs [1 2 3])\n(show 1)\n(show (get xs 5))","check!E10"],
  ["known before running: every one at once","(use mat)\n(use json)\n(show (matmul [[1 2]] [[1 2]]))\n(show (snum \"12x\"))\n(show (json.parse \"{\"))\n(show (with [v [1] i 3] (get v i)))\n(show (sqrt (- 1 2)))","check!E11,E15,E15,E10,E17"],
  ["what may never run is left to the run","(let zero (- 2 2))\n(fn f [x Num] Num (+ x (/ 1 zero)))\n(fn g [] Num (get [1] 5))\n(show (try (g)))\n(show (map (fun [x] (if (> x 9) (need None \"big\") x)) [1 2]))\n(show (for [_ []] (/ 1 0)))","(Err \"E10\" \"get: index 5 outside 0..0\")\n[1 2]\n[]"],
  ["known before running: check","(let n (len [1 2 3]))\n(check n 4)\n(show 1)","check!ECHECK"],
  ["known before running: rec and match","(rec P [x Num v (Vec Num)])\n(let p (up (P 1 [5]) P.x 0))\n(show (match (first (P.v p)) (Some a) (/ a (P.x p)) None 0))","check!E17"],
  ["a branch not taken is not an error","(show (if true 1 (/ 1 0)))\n(show (match (first []) (Some x) x None (get [7] 0)))\n(let n 0)\n(show (if (= n 0) 0 (/ 1 n)))\n(show (try (/ 1 0)))","1\n7\n0\n(Err \"E17\" \"division by zero\")"],
  ["unknown values still fail at run","(use io)\n(fn at [v (Vec Num) i Num] Num (get v i))\n(show 1)\n(show (at [1] (+ 4 (len (io.args)))))","run!E10"],
  ["up","(rec P [x Num y Num])\n(let p (P 1 2))\n(show (up p P.y 5))\n(show (up p P.x 9 P.y 8))\n(show p)\n(rec Cell [v ?a])\n(show (up (Cell 1) Cell.v 2))","(P 1 5)\n(P 9 8)\n(P 1 2)\n(Cell 2)"],
  ["up is checked","(rec P [x Num y Num])\n(rec Q [z Num])\n(let p (P 1 2))\n(show (up p P.z 5))\n(show (up p P.x \"a\"))\n(show (up p Q.z 1))\n(show (up p P.x 1 P.x 2))\n(show (up 3 P.x 1))","!E1,E4,E4,E2,E4"],
  ["E20 with bind never used","(show (with [a 1 b 2] a))","!E20"],
  ["E20 match bind never used","(show (match (Some 1) (Some x) 0 None 1))","!E20"],
  ["a bind used by a later bind is used","(show (with [a 1 b (+ a 1)] b))","2"],
  ["foreign words name the tact","(define x 1)\n(show (lambda [y] y))\n(show (length [1]))\n(show (if (== 1 1) nil 2))\n(show (let [a 1] a))\n(show (sum [1 2]))\n(show (println \"x\"))","!E8,E1,E1,E1,E1,E1,E8,E8,E1"],
  ["swapped args are named","(show (map [1 2] (fun [x] x)))","!E4,E4"],
  ["E3 reader names collide","(rec io [print Num])\n(sum S [P.x [Str]])\n(rec P [x Num])\n(rec A [x Num])\n(rec A.x [y Num])","!E3,E3,E3"],
  ["E3 a local may not shadow a later let","(fn f [x Num] Num (with [y 1] (+ x y)))\n(let y 5)","!E3"],
  ["E12 nested too deep","(show (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg (neg 1)))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))","check!E12"],
  ["E12 far too deep is still a tact error","(show [[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]])","check!E12"],
  ["E12 -> too long","(show (-> 1 neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg neg ))","check!E12"],
  ["E8 -> one slot a step","(show (-> 2 (+ _ _)))","!E8"],
  ["-> match step keeps its _","(show (-> (Some 1) (match (Some a) a _ 0)))\n(show (-> 5 (- 10 _)))","1\n5"],
  ["E4 types that explode","(let f0 (fun [x] (Pair x x)))\n(let f1 (fun [x] (f0 (f0 x))))\n(let f2 (fun [x] (f1 (f1 x))))\n(let f3 (fun [x] (f2 (f2 x))))\n(let f4 (fun [x] (f3 (f3 x))))\n(let f5 (fun [x] (f4 (f4 x))))\n(show 1)","check!E4"],
  ["E18 _ after every case","(show (match (Some 1) (Some x) x None 0 _ 9))\n(show (match true true 1 false 2 _ 3))","!E18,E18"],
  ["_ is an unused name in fun and for","(show (map (fun [_] 1) [1 2]))\n(show (for [_ (range 3)] 0))\n(show (fold (fun [acc _] (+ acc 1)) 0 [5 5]))","[1 1]\n[0 0 0]\n2"],
  ["iroot large","(show (iroot 1e60 2))\n(show (iroot 1e300 3))\n(show (iroot 0 5))","1e+30\n1e+100\n0"],
  ["sizes are capped","(use mat)\n(use re)\n(use draw)\n(fn id [x ?a] ?a x)\n(show (try (len (matmul (id (rep 1000000 [1])) [(range 1000)]))))\n(show (try (len (flat (id (rep 1000 (rep 2000 0)))))))\n(show (try (slen (str (id (rep 1000000 (rep 1000000 0)))))))\n(show (try (k.rank (id (k.randn 1000 1000 1)))))\n(show (try (slen (ascii 1 (id 4096) [] 400))))\n(show (len (uniq (range 200000))))\n(show (take [1 2] 2000000))","(Err \"E17\" \"matmul: 1000000x1 times 1x1000 is too large\")\n(Err \"E17\" \"flat: over the item cap\")\n(Err \"E17\" \"value too large to print\")\n(Err \"E17\" \"k.rank: 1000x1000 is too large for the js backend\")\n(Err \"E17\" \"ascii: 819200 rows is over 400. use fewer columns\")\n200000\n[1 2]"],
  ["E9 data counts against the budget","(show (len (map (fun [_] (range 1000000)) (range 1000000))))","run!E9",null,20000000],
  ["try catches host limits","(rec L [v Num next (Opt L)])\n(fn build [n Num acc (Opt L)] (Opt L) (if (= n 0) acc (build (- n 1) (Some (L n acc)))))\n(show (match (try (slen (str (build 20000 None)))) (Ok _) \"ok\" (Err c _) c))\n(show (try (fail \"\" \"m\")))","E9\n(Err \"\" \"m\")"],
  ["eig at the edges of scale","(use mat)\n(check (k.eig [[0 1e200] [1e200 0]]) [[1e200 -1e200] [0 0]])\n(check (k.eig [[1e160 2e160] [2e160 4e160]]) [[5e160 0] [0 0]])\n(check (get (k.eig [[1 1e9 0] [1e-9 1 1e9] [0 1e-9 1]]) 0) [(+ 1 (sqrt 2)) 1 (- 1 (sqrt 2))])\n(check (get (k.eig [[1 1e12 0] [1e-12 1 1e12] [0 1e-12 1]]) 0) [(+ 1 (sqrt 2)) 1 (- 1 (sqrt 2))])\n(show (get (k.eig [[1e-170 2e-170] [2e-170 1e-170]]) 0))","[3e-170 -1e-170]"],
  ["solve and svd at the edges of scale","(use mat)\n(check (k.solve [[1e-20 0] [0 1]] [[1] [1]]) [[1e20] [1]])\n(check (k.solve [[1 0] [0 1e-13]] [[1] [1]]) [[1] [1e13]])\n(show (svdvals [[1e200 0] [0 1]]))\n(show (svdvals [[1 0] [0 1e-170]]))\n(show (vnorm [3e200 4e200]))","[1e+200 1]\n[1 1e-170]\n5e+200"],
  ["dates are iso and never the host zone","(use time)\n(show (date.parse \"2020-01-01T00:00:00Z\"))\n(show (date.parse \"2020-01-01\"))\n(show (date.parse \"2020-01-01T01:00:00+01:00\"))\n(show (map (fun [s] (match (try (date.parse s)) (Ok _) \"ok\" (Err c _) c)) [\"2020-01-01T00:00\" \"Jan 1 2020\" \"2\" \"2020-02-30\"]))","1577836800000\n1577836800000\n1577836800000\n[\"E15\" \"E15\" \"E15\" \"E15\"]"],
  ["json keys come out in cmp order","(use json)\n(show (json.str (JObj {\"10\" (JNum 1) \"9\" (JNum 2) \"a\" (JArr [])})))\n(check (json.parse (json.pretty (JObj {\"k\" (JArr [(JNum 1) JNull (JObj {})])}))) (JObj {\"k\" (JArr [(JNum 1) JNull (JObj {})])}))","{\"10\":1,\"9\":2,\"a\":[]}"],
  ["rows that were wrong","(use math)\n(use bytes)\n(show [(mod -1 3) (mod 1 -3) (mod -1e-20 3)])\n(show (try (unutf8 [300])))\n(show (utf8 (unutf8 [239 187 191 97])))\n(show (try (fix 1e21 2)))\n(show (atan2 0 -0))\n(show (slt \"😀\" \"ｚ\"))\n(show (order [\"ｚ\" \"😀\" \"a\"]))\n(show (try (chr 55357)))","[2 -2 0]\n(Err \"E15\" \"unutf8: 300 is not a byte 0..255\")\n[239 187 191 97]\n(Err \"E17\" \"fix: 1e+21 is too big to write out\")\n0\nfalse\n[\"a\" \"ｚ\" \"😀\"]\n(Err \"E17\" \"chr: 55357 is not a code point\")"],
  ["a line longer than the canvas is solid","(use draw)\n(check (ascii 60 2 [(Line 0 0 100000 0 \"white\")] 60) (ascii 60 2 [(Line 0 0 59 0 \"white\")] 60))\n(show (ascii 8 8 [(Line -500 -500 500 500 \"white\")] 8))\n(show (ascii 8 8 [(Line 20 0 30 5 \"white\")] 8))","@@\n  @@\n    @@\n      @@\n\n\n\n"],
  ["memory host: made dirs exist, .. resolves","(use io)\n(use \"lib/a.tact\")\n(use \"lib/../lib/a.tact\")\n(do (io.mkdir \"d\") (io.write \"d/../e.txt\" \"x\"))\n(show [(io.isdir \"d\") (io.exists \"e.txt\")])\n(show z)","[true true]\n1",{"lib/a.tact":"(use \"../z.tact\")","z.tact":"(let z 1)"}],
  ["tried before running: errors in fn bodies, all at once","(fn at [v (Vec Num) i Num] Num (get v i))\n(show 1)\n(show (at [1] 4))\n(show (at [1 2] 9))","check!E10,E10"],
  ["tried before running: recursion and check","(fn fact [n Num] Num (if (<= n 1) 1 (* n (fact (- n 1)))))\n(check (fact 5) 120)\n(check (fact 5) 121)\n(show (fact 3))","check!ECHECK"],
  ["tried before running: depth","(fn down [n Num] Num (if (= n 0) 0 (+ 1 (down (- n 1)))))\n(show (down 500))\n(show (down 800))","check!E9"],
  ["tried before running: try still catches","(fn boom [] Num (/ 1 0))\n(show (try (boom)))\n(let r (try (boom)))\n(show (match r (Ok _) \"ok\" (Err c _) c))","(Err \"E17\" \"division by zero\")\nE17"],
  ["tried before running: a let after a failed let is not tried","(let a (get [1] 3))\n(let b (+ a 1))\n(show b)","check!E10"],
  ["io waits for the run","(use io)\n(let n (len (io.args)))\n(show 1)\n(show (/ 1 n))","run!E17"],
  ["a regex waits for the run","(use re)\n(fn m [s Str] Num (len (re.find \"a\" s)))\n(show (get [] (m \"b\")))","run!E10"],
  ["the budget spent is not an error up front","(fn spin [n Num acc Num] Num (if (= n 0) acc (spin (- n 1) (+ acc 1))))\n(show (spin 1000000 0))","1000000"],
  ["E1 for an unloaded pack gives the call","(show (csv.parse \"a\"))","!E1"],
  ["math","(use math)\n(show [(gcd 12 18) (lcm 4 6) (clamp 5 0 3) (hypot 3e200 4e200)])\n(show [(median [3 1 2]) (median [4 1 3 2]) (quantile [1 2 3 4 5] 0.25)])\n(check (sd [2 4 4 4 5 5 7 9]) 2.13808993529939)\n(check (corr [1 2 3] [2 4 6]) 1)\n(check (corr [1 2 3] [3 2 1]) -1)\n(check (shuffle 7 (range 10)) (shuffle 7 (range 10)))\n(show (order (shuffle 3 (range 6))))\n(check (atan2 1 1) (/ pi 4))","[6 12 3 5e+200]\n[2 2.5 2]\n[0 1 2 3 4 5]"],
  ["E math edges","(use math)\n(fn id [x ?a] ?a x)\n(show (map (fun [r] (match r (Ok _) \"ok\" (Err c _) c)) [(try (median (id []))) (try (sd (id [1]))) (try (corr (id [1 1]) [1 2])) (try (quantile [1] (id 2))) (try (clamp 1 (id 3) 2)) (try (gcd (id 1.5) 2))]))","[\"E10\" \"E10\" \"E17\" \"E17\" \"E17\" \"E17\"]"],
  ["text","(use text)\n(show (words \"  a  b\\tc\\n\"))\n(show (wrap \"the quick brown fox jumps\" 10))\n(show (wrap \"supercalifragilistic x\" 5))\n(show [(edits \"kitten\" \"sitting\") (edits \"\" \"abc\") (edits \"é\" \"e\")])\n(show (padl \"7\" 3 \"0\"))","[\"a\" \"b\" \"c\"]\n[\"the quick\" \"brown fox\" \"jumps\"]\n[\"supercalifragilistic\" \"x\"]\n[3 3 1]\n007"],
  ["csv","(use csv)\n(let t \"name,note\\r\\nann,\\\"says \\\"\\\"hi\\\"\\\", ok\\\"\\nbo,\\\"two\\nlines\\\"\\n\")\n(show (csv.parse t))\n(check (csv.parse (csv.str (csv.parse t))) (csv.parse t))\n(show (csv.str [[\"a\" \"b,c\"] [\"\" \"q\\\"\"]]))\n(show (map (fun [m] (else (mget m \"name\") \"?\")) (csv.maps t)))\n(show (csv.parse \"\"))\n(show (csv.parse \"a,\"))","[[\"name\" \"note\"] [\"ann\" \"says \\\"hi\\\", ok\"] [\"bo\" \"two\\nlines\"]]\na,\"b,c\"\n,\"q\"\"\"\n\n[\"ann\" \"bo\"]\n[]\n[[\"a\" \"\"]]"],
  ["E15 csv","(use csv)\n(fn id [x ?a] ?a x)\n(show (map (fun [s] (match (try (csv.maps s)) (Ok _) \"ok\" (Err c _) c)) [(id \"a,\\\"b\") (id \"a,b\\\"c\") (id \"h1,h2\\n1\")]))","[\"E15\" \"E15\" \"E15\"]"],
  ["sha256","(use text)\n(use bytes)\n(show (sha256 \"\"))\n(show (sha256 \"abc\"))\n(show (sha256 \"héllo 😀\"))\n(show (slen (sha256 (srep \"a\" 1000))))","e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\nba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad\na53c56966616f0ec3ed9db7ea07a6034430149528bbaba8966c284f9373669c2\n64"],
  ["paths","(use io)\n(show [(path.join \"a/b\" \"../c.txt\") (path.join \"a\" \"/x\") (path.dir \"a/b/c.txt\") (path.dir \"c.txt\") (path.base \"a/b/c.txt\") (path.ext \"a/b/c.tar.gz\") (path.ext \".bashrc\") (path.ext \"a.b/c\")])","[\"a/c.txt\" \"/x\" \"a/b\" \".\" \"c.txt\" \".gz\" \"\" \"\"]"],
  ["chart: shapes a model can read","(use chart)\n(let c (chart.line 200 100 \"t\" [(Series \"a\" [0 1 2] [0 1 4]) (Series \"b\" [0 1 2] [4 1 0])]))\n(show (> (len c) 20))\n(show (any (fun [s] (match s (Text _ _ _ t _) (same t \"t\") _ false)) c))\n(show (> (slen (trim (ascii 200 100 c 40))) 100))\n(show (starts (svg 200 100 c) \"<svg\"))\n(show (> (len (chart.bar 120 80 \"\" [\"a\" \"b\"] [1 -2])) 5))\n(show (> (len (chart.hist 120 80 \"h\" [1 2 2 3] 3)) 5))\n(show (> (len (chart.fn 120 80 \"\" (fun [x] (* x x)) -1 1)) 120))\n(show (> (len (chart.scatter 120 80 \"\" [(Series \"p\" [1] [1])])) 3))","true\ntrue\ntrue\ntrue\ntrue\ntrue\ntrue\ntrue"],
  ["chart errors before running","(use chart)\n(show (chart.line 200 100 \"\" [(Series \"a\" [0 1] [0])]))\n(show (chart.line 50 100 \"\" [(Series \"a\" [0] [0])]))\n(show (chart.scatter 200 100 \"\" [(Series \"a\" [] [])]))\n(show (chart.bar 200 100 \"\" [\"a\"] [1 2]))\n(show (chart.hist 200 100 \"\" [1] 0))\n(show (chart.fn 200 100 \"\" (fun [x] x) 1 1))\n(show (chart.fn 200 100 \"\" log -1 1))","check!E11,E17,E10,E11,E17,E17,E17"],
  ["text and svg","(use draw)\n(check (ascii 40 8 [(Text 0 0 1 \"abc?\" \"white\")] 40) (ascii 40 8 [(Text 0 0 1 \"ABC?\" \"white\")] 40))\n(show (same (ascii 8 8 [(Text 0 0 1 \"A\" \"white\")] 8) (ascii 8 8 [(Text 0 0 1 \"B\" \"white\")] 8)))\n(show (shas (svg 10 10 [(Text 0 0 1 \"a<b & \\\"c\\\"\" \"red\")]) \"a&lt;b &amp; &quot;c&quot;\"))\n(show (lines (svg 4 4 [(Box 0 0 2 2 \"#0f0\") (Box 0 0 0 2 \"red\")])))","false\ntrue\n[\"<svg xmlns=\\\"http://www.w3.org/2000/svg\\\" width=\\\"4\\\" height=\\\"4\\\" viewBox=\\\"0 0 4 4\\\">\" \"<rect x=\\\"0\\\" y=\\\"0\\\" width=\\\"2\\\" height=\\\"2\\\" fill=\\\"#00ff00\\\"/>\" \"</svg>\"]"],
  ["ascii reads dark ink on light","(use draw)\n(show (ascii 8 8 [(Box 0 0 8 8 \"white\") (Line 0 0 7 7 \"black\")] 8))","@@\n  @@\n    @@\n      @@"],
];
function runTests() {
  const rs = TESTS.map(([name, src, want, files, maxSteps]) => {
    const r = run(src, { io: memHost(files || {}), maxSteps });
    let got = r.errors.length ? (/^(check|run)!/.test(want) ? r.phase : "") + "!" + r.errors.map(e => e.code).join(",") : r.output.join("\n");
    if (want.includes("@") && r.errors.length) got += "@" + r.errors.map(e => `${e.file}:${e.line}`).join(",");
    let ok = got === want;
    if (ok && r.phase === "check" && r.output.length) ok = false;
    return { name, ok, got, want, src, errors: r.errors };
  });
  // the spec must describe the language as built: every builtin and every form has a matrix row
  const rows = new Set(MATRIX.split("\n").slice(1).map(l => l.split(" ")[0]));
  const lost = [...Object.keys(B), ...Object.keys(FORMS), ...Object.keys(TOPS)].filter(n => !rows.has(n));
  const ghost = MATRIX.split("\n").slice(1).map(l => l.split(" ")).filter(p => !["form", "top", "type", "err"].includes(p[1]) && !own(B, p[0]) && !PACKOF.has(p[0])).map(p => p[0]);
  const got = [...lost.map(n => "no row: " + n), ...ghost.map(n => "no builtin: " + n)].join(", ");
  rs.push({ name: "matrix = builtins", ok: got === "", got, want: "", src: "; compares the matrix with the builtin table", errors: [] });
  const size = specText().length;
  rs.push({ name: `core spec fits the context budget`, ok: size <= CORE_BUDGET, got: `${size} chars`, want: `<= ${CORE_BUDGET} chars`, src: "; tact --spec must stay short. new things go in packs or in side loaded .tact files", errors: [] });
  return rs;
}
function fuzz(n, seed) {
  const rnd = mulberry32(seed), pick = a => a[Math.floor(rnd() * a.length)];
  const pool = ["(", ")", "[", "]", "{", "}", "1", "-3.5", "0", "1e308", "1e400", '"s"', '""', "x", "_", "->", "if", "with", "fun", "for", "let", "fn",
    "show", "check", "rec", "sum", "match", "try", "do", "cat", "use", "map", "fold", "get", "Num", "?a", "(Vec Num)", "(Map Str Num)", "(Opt ?a)", "true",
    "k.svd", "k.eig", "k.pinv", "svdvals", "/", "iroot", "pow", "slice", "range", "rep", "same", "Some", "None", "Ok", "Err", "Pair", "mput", "mget", "{}",
    "cmp", "order", "group", "json.parse", "json.str", "re.find", '"("', "io.read", "io.write", "io.print", "unwrap", "need", "else", "shl", "radix", "chunk"];
  const kinds = {}, fails = [];
  for (let i = 0; i < n; i++) {
    const toks = pick(TESTS)[1].match(/"(?:[^"\\]|\\.)*"|[()\[\]{}]|[^\s()\[\]{}"]+/g) || [];
    const muts = 1 + Math.floor(rnd() * 3);
    for (let j = 0; j < muts; j++) {
      const op = Math.floor(rnd() * 4), p = Math.floor(rnd() * (toks.length + 1));
      if (op === 0 && toks.length) toks.splice(p % toks.length, 1);
      else if (op === 1 && toks.length) toks.splice(p, 0, pick(toks));
      else if (op === 2) toks.splice(p, 0, pick(pool));
      else if (toks.length > 1) { const a = Math.floor(rnd() * toks.length), b = Math.floor(rnd() * toks.length); [toks[a], toks[b]] = [toks[b], toks[a]]; }
    }
    const src = toks.join(" "), r = run(src, { maxSteps: 2e6, io: memHost({ "lib/a.tact": "(let base 10)" }) });
    const k = r.phase === "internal" ? "BUG" : r.errors.length ? r.errors[0].code : "ok";
    kinds[k] = (kinds[k] || 0) + 1;
    if (k === "BUG") fails.push({ src, msg: r.errors[0].msg.split("\n")[0] });
  }
  return { n, seed, kinds, fails };
}

/* ------------------------------------------------------------------ spec text: the part a model keeps in context */
const CORE_BUDGET = 12000;           // characters, about 3400 tokens: 10% of a 32k window, the floor for a 70b-class model. a test holds the core spec under this
function specText(which) {
  const [head, ...rows] = MATRIX.split("\n"), packOf = r => KINDPACK[r.split(" ")[1]] || "core";
  const core = rows.filter(r => packOf(r) === "core");
  const pack = p => { const d = PACKS[p], rs = rows.filter(r => packOf(r) === p); return [`PACK ${p}. (use ${p}). ${d.say}. ${rs.length} rows`, d.notes, d.types, head, ...rs].filter(Boolean).join("\n"); };
  const index = "PACKS  (use name) loads one. a name from an unloaded pack = E1 with the pack and the call. tact --spec NAME.\n" +
    Object.keys(PACKS).map(p => `  ${p.padEnd(6)}${PACKS[p].say}`).join("\n");
  const base = SYNTAX + "\n\n" + index + "\n\nMATRIX core " + core.length + " rows\n" + head + "\n" + core.join("\n");
  if (which === undefined) return base;
  if (which === "all") return base + "\n\n" + Object.keys(PACKS).map(pack).join("\n\n");
  if (own(PACKS, which)) return pack(which);
  return null;
}

/* ------------------------------------------------------------------ cli */
const USAGE = "usage: tact FILE [args ..] | -e SRC | - | --spec [PACK|all] | --check FILE | --sigs FILE | --test | --fuzz N SEED | --list [PACK|all] | --run FILE [args ..] | --show FILE";
function errLines(r) { return r.errors.map(e => `${e.code} ${e.file ? e.file + " " : ""}line ${e.line}: ${e.msg}`).join("\n"); }
function cli(args, host) {           // host = the io host. it also needs read and stdin to load the program itself
  const a = args.slice();
  const runIt = (src, showTypes, file, rest) => {
    const io = Object.assign({}, host, { args: () => rest || [] });
    if (showTypes) {
      const r = run(src, { io, file, checkOnly: true });
      const txt = r.info.map(i => `${i.file ? i.file + " " : ""}line ${String(i.line).padEnd(4)} ${i.text}\n          ${i.code}`).join("\n");
      return { out: txt, err: errLines(r), code: r.errors.length ? 1 : 0, result: r };
    }
    const r = run(src, { io, file, onOut: host.out });
    return { out: host.out ? "" : r.output.join("\n"), err: errLines(r), code: r.errors.length ? 1 : 0, result: r };
  };
  const src = p => { if (p === undefined) throw new Error("missing FILE"); return p === "-" ? host.stdin() : host.read(p); };
  const file = p => p === "-" ? "" : p;
  try {
    switch (a[0]) {
      case undefined: case "-h": case "--help": return { out: USAGE, err: "", code: a[0] ? 0 : 2 };
      case "--spec": { const t = specText(a[1]); return t === null ? { out: "", err: `unknown pack ${a[1]}. packs: ${Object.keys(PACKS).join(" ")}`, code: 2 } : { out: t, err: "", code: 0 }; }
      case "--check": { const r = run(src(a[1]), { io: host, file: file(a[1]), checkOnly: true }); return { out: r.errors.length ? "" : "ok", err: errLines(r), code: r.errors.length ? 1 : 0 }; }
      case "--sigs": {                 // what a side loaded tact file offers, without its source
        const r = run(src(a[1]), { io: host, file: file(a[1]), checkOnly: true });
        return { out: r.info.filter(i => /^(let|fn|rec|sum) /.test(i.text) && !i.file).map(i => i.text).join("\n"), err: errLines(r), code: r.errors.length ? 1 : 0 };
      }
      case "--list": return { out: Object.entries(B).filter(([, b]) => a[1] === "all" || (b.pack || "core") === (a[1] || "core")).map(([n, b]) => `${n.padEnd(12)} ${b.sig}` + (a[1] === "all" && b.pack ? `   ; ${b.pack}` : "")).join("\n"), err: "", code: 0 };
      case "--test": {
        const rs = runTests(), bad = rs.filter(r => !r.ok);
        const lines = bad.map(r => `FAIL ${r.name}\n  want ${JSON.stringify(r.want)}\n  got  ${JSON.stringify(r.got)}` + (r.errors.length ? `\n  ${errLines({ errors: r.errors })}` : ""));
        lines.push(`${rs.length - bad.length}/${rs.length} tests pass`);
        return { out: lines.join("\n"), err: "", code: bad.length ? 1 : 0 };
      }
      case "--fuzz": {
        const n = Number(a[1] || 200), seed = Number(a[2] || 1);
        if (!isInt(n) || !isInt(seed)) return { out: "", err: "--fuzz N SEED: whole numbers", code: 2 };
        const f = fuzz(n, seed);
        const lines = [`fuzz ${n} programs, seed ${seed}: ` + Object.entries(f.kinds).sort().map(([k, v]) => `${k} ${v}`).join("  ")];
        for (const x of f.fails.slice(0, 10)) lines.push(`BUG ${x.msg}\n  ${x.src}`);
        lines.push(f.fails.length ? `${f.fails.length} crashes` : "no crashes: every program ended in a value or a tact error");
        return { out: lines.join("\n"), err: "", code: f.fails.length ? 1 : 0 };
      }
      case "-e": if (a[1] === undefined) return { out: "", err: "-e needs SRC", code: 2 }; return runIt(a[1], false, "", a.slice(2));
      case "--run": return runIt(src(a[1]), false, file(a[1]), a.slice(2));
      case "--show": return runIt(src(a[1]), true, file(a[1]));
      default:
        if (a[0].startsWith("--")) return { out: "", err: `unknown flag ${a[0]}\n${USAGE}`, code: 2 };
        return runIt(src(a[0]), false, file(a[0]), a.slice(1));
    }
  } catch (x) { return { out: "", err: String(x.message || x), code: 2 }; }
}

const TACT = { VERSION, SYNTAX, MATRIX, PRELUDE, TESTS, run, runTests, fuzz, cli, builtins: B, fmt, memHost, nodeHost, png, PACKS, specText };
if (typeof module === "object" && module.exports) {
  module.exports = TACT;
  if (typeof require === "function" && require.main === module) {
    const r = cli(process.argv.slice(2), nodeHost());
    if (r.out) process.stdout.write(r.out + "\n");
    if (r.err) process.stderr.write(r.err + "\n");
    process.exitCode = r.code;
  }
} else root.TACT = TACT;
})(typeof globalThis !== "undefined" ? globalThis : this);
// ==TACT-CORE-END==

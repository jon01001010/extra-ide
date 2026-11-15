#!/usr/bin/env node
// JS-interop regression tests for an Emit IDE build: small Emit programs, each with the output
// lines it must produce. Runs in headless Chromium, offline (every network request is aborted).
//
//   node tests/run-interop.js [path/to/emit-ide.html] [testName ...]
//   VERBOSE=1 prints each program's Output tab.
//
// Exit code 0 only when every program compiles, runs and prints exactly what is expected.
const { chromium } = require('playwright');
const path = require('path');

// A stand-in "third-party library" (window.fakeLib) so library-shaped behaviour can be tested offline:
// functions returning promises, functions that throw, a class, a function taking a callback.
const FAKE_LIB = `
window.typeNameG = function (x) { return x === null ? 'null' : typeof x; };
// a global function that accepts anything, like numeral(…) / dayjs(…): reports what it was given
window.describeArgs = function () { return [].map.call(arguments, function (a) { return (a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a) + ':' + (typeof a === 'object' ? JSON.stringify(a) : String(a)); }).join(' '); };
window.makeBox = function (v) { return { value: function () { return v; } }; };
window.fakeLib = {
  fetchUser: function (id) { return new Promise(function (ok) { setTimeout(function () { ok({ id: id, name: 'user' + id }); }, 20); }); },
  failLater: function () { return new Promise(function (ok, fail) { setTimeout(function () { fail(new Error('server said no')); }, 20); }); },
  boom: function () { throw new Error('kaboom'); },
  throwString: function () { throw 'plain string'; },
  Counter: class Counter { constructor(start) { this.n = start; } inc() { this.n++; return this.n; } },
  each: function (list, cb) { for (var i = 0; i < list.length; i++) cb(list[i], i, list); },
  compute: function (cb) { return cb(20, 1.5, 'x', true, { tag: 'obj' }); },
  join: function (a, b) { return String(a) + '|' + String(b); },
  ident: function (x) { return x; },
  typeName: function (x) { return x === null ? 'null' : typeof x; },
  big: function (n) { return new Array(n + 1).join('x'); },
  // plain functions with capitalised names (Phaser.Math.Distance.Between style)
  Geom: { Between: function (x1, y1, x2, y2) { return Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)); }, Label: function (n) { return 'label ' + n; } },
  // ES5-style classes (three.js r128 style): a function with prototype members, one that only inherits, one with neither
  OldPoint: (function () { function OldPoint(x, y) { this.x = x; this.y = y; } OldPoint.prototype.sum = function () { return this.x + this.y; }; return OldPoint; })(),
  OldChild: (function () { function Base() {} Base.prototype.kind = function () { return 'child of base'; }; function OldChild() { Base.call(this); } OldChild.prototype = Object.create(Base.prototype); OldChild.prototype.constructor = OldChild; return OldChild; })(),
  Bare: function (v) { this.v = v; },
  // functions that return functions (d3.format / scales / curried APIs)
  adder: function (a) { return function (b) { return a + b; }; },
  fns: [function (x) { return x * 2; }, function (x) { return 'second ' + x; }],
  format: function (digits) { return function (x) { return x.toFixed(digits); }; },
  config: { name: 'cfg', size: 2.5, count: 7, visible: true, hidden: false, nothing: null, list: [10, 20, 30, 40, 50], child: { label: 'kid' } }
};
`;

// Each test: src (Emit program with one `export fn run()`), expect (lines that must appear, in order,
// as complete lines of the Output tab; a RegExp matches a whole line), and optionally:
//   errors: true  → red "✗" lines are expected (otherwise any "✗" fails the test)
//   count: {line: n} → that exact line must appear exactly n times
//   wait: ms to wait after the run for timers/promises (default 250)
//   rerun: true → press Run twice in a row; timers/promises of the first run must not fire into the second
const TESTS = [
  // ── 1. Callbacks that receive arguments ──
  { name: 'callback-int-args', src: `
fn visit(value: int, index: int) {
  print(index * 100 + value)
}
export fn run() {
  let arr = JSON.parse("[7, 8, 9]")
  arr.forEach(fnRef(visit))
}`, expect: ['> 7', '> 108', '> 209'], count: { '> 7': 1 } },

  { name: 'callback-string-name-form', src: `
fn visit(value: int) {
  print(value)
}
export fn run() {
  let arr = JSON.parse("[4, 5]")
  arr.forEach(fnRef("visit"))
}`, expect: ['> 4', '> 5'] },

  { name: 'callback-num-arg', src: `
fn visit(x: num) {
  printNum(x * 2.0)
}
export fn run() {
  let arr = toJsArray([1.5, 2.25])
  arr.forEach(fnRef(visit))
  // an integer-valued JS number into a num parameter
  let ints = JSON.parse("[3]")
  ints.forEach(fnRef(visit))
}`, expect: ['> 3', '> 4.5', '> 6'] },

  { name: 'callback-str-arg', src: `
fn visit(s: str, i: int) {
  printStr(strConcat(intToStr(i), strConcat("=", s)))
}
export fn run() {
  let arr = JSON.parse("[\\"alpha\\", \\"beta\\"]")
  arr.forEach(fnRef(visit))
}`, expect: ['> 0=alpha', '> 1=beta'] },

  { name: 'callback-object-arg-as-handle', src: `
fn visit(o: int) {
  let name: str = o.name
  printStr(name)
  printStr(typeOf(o))
}
export fn run() {
  let arr = JSON.parse("[{\\"name\\":\\"ann\\"},{\\"name\\":\\"bob\\"}]")
  arr.forEach(fnRef(visit))
}`, expect: ['> ann', '> object', '> bob', '> object'] },

  { name: 'callback-mixed-types-and-missing-args', src: `
fn mixed(i: int, n: num, s: str, b: bool, o: int, extra: int, extraStr: str) num {
  print(i)
  printNum(n)
  printStr(s)
  if (b) { printStr("flag on") }
  let tag: str = o.tag
  printStr(tag)
  print(extra)
  printStr(strConcat("[", strConcat(extraStr, "]")))
  return n * 2.0
}
export fn run() {
  // fakeLib.compute calls cb(20, 1.5, 'x', true, {tag:'obj'}) and returns what cb returns
  let r: num = fakeLib.compute(fnRef(mixed))
  printNum(r)
}`, expect: ['> 20', '> 1.5', '> x', '> flag on', '> obj', '> 0', '> []', '> 3'] },

  { name: 'callback-return-values', src: `
fn double(x: num) num {
  return x * 2.0
}
fn isBig(x: int) bool {
  return x > 4
}
fn label(x: int) str {
  return strConcat("n", intToStr(x))
}
fn sum(acc: int, x: int) int {
  return acc + x
}
fn pick(o: int) int {
  return o.inner
}
export fn run() {
  let arr = JSON.parse("[3, 5, 8]")
  printStr(toStr(JSON.stringify(arr.map(fnRef(double)))))
  printStr(toStr(JSON.stringify(arr.filter(fnRef(isBig)))))
  printStr(toStr(JSON.stringify(arr.map(fnRef(label)))))
  printStr(toStr(arr.reduce(fnRef(sum), 0)))
  // a callback returning a handle gives JS the object itself
  let objs = JSON.parse("[{\\"inner\\":{\\"k\\":1}},{\\"inner\\":{\\"k\\":2}}]")
  printStr(toStr(JSON.stringify(objs.map(fnRef(pick)))))
}`, expect: ['> [6,10,16]', '> [5,8]', '> ["n3","n5","n8"]', '> 16', '> [{"k":1},{"k":2}]'] },

  { name: 'callback-settimeout-not-auto-run', wait: 400, src: `
mut n = 3
fn tick() {
  printStr(strConcat("tick ", intToStr(n)))
  n--
  if (n > 0) {
    setTimeout(fnRef(tick), 20)
  }
}
export fn run() {
  printStr("start")
  setTimeout(fnRef(tick), 20)
}`, expect: ['> start', '> tick 3', '> tick 2', '> tick 1'], count: { '> tick 3': 1, '> tick 1': 1 } },

  { name: 'fnRef-unknown-function-is-a-compile-error', status: 'Error', errors: true, src: `
export fn run() {
  setTimeout(fnRef(nosuch), 10)
}`, expect: [/^✗ 2:20: fnRef\(nosuch\) — there is no function named "nosuch"/] },

  { name: 'callbacks-from-a-previous-run-are-dropped', wait: 400, rerun: true, src: `
fn tick() {
  printStr("tick")
}
export fn run() {
  setTimeout(fnRef(tick), 60)
}`, expect: ['> tick'], count: { '> tick': 1 } },

  { name: 'callback-dom-event', src: `
mut clicks = 0
fn onPing(ev: int) {
  clicks++
  let kind: str = ev.type
  printStr(strConcat(kind, strConcat(" #", intToStr(clicks))))
}
export fn run() {
  let el = document.createElement("div")
  el.addEventListener("ping", fnRef(onPing))
  el.dispatchEvent(new Event("ping"))
  el.dispatchEvent(new Event("ping"))
}`, expect: ['> ping #1', '> ping #2'] },

  { name: 'callback-through-library-function', src: `
fn show(item: num, index: int, all: int) {
  printNum(item + toNum(all.length))
}
export fn run() {
  fakeLib.each(fakeLib.config.list, fnRef(show))
}`, expect: ['> 15', '> 25', '> 35', '> 45', '> 55'] },

  // ── 2. Promises ──
  { name: 'promise-resolve-int', src: `
fn done(v: int) {
  print(v + 1)
}
export fn run() {
  let P = __jsGlobal("Promise")
  let p = P.resolve(42)
  p.then(fnRef(done))
  printStr("scheduled")
}`, expect: ['> scheduled', '> 43'] },

  { name: 'promise-resolve-str-and-num', src: `
fn gotStr(s: str) {
  printStr(strConcat("got ", s))
}
fn gotNum(x: num) {
  printNum(x)
}
export fn run() {
  Promise.resolve("text").then(fnRef(gotStr))
  Promise.resolve(2.5).then(fnRef(gotNum))
}`, expect: ['> got text', '> 2.5'] },

  { name: 'promise-resolve-handle-toStr', src: `
fn done(v: int) {
  // an int parameter that received a plain number still converts with toStr/toNum
  printStr(strConcat("resolved ", toStr(v)))
}
fn doneObj(o: int) {
  printStr(toStr(JSON.stringify(o)))
}
export fn run() {
  Promise.resolve(42).then(fnRef(done))
  Promise.resolve(JSON.parse("{\\"a\\":1}")).then(fnRef(doneObj))
}`, expect: ['> resolved 42', '> {"a":1}'] },

  { name: 'promise-rejected-catch', src: `
fn onErr(e: int) {
  let m: str = e.message
  printStr(strConcat("caught: ", m))
}
fn onErrStr(e: str) {
  printStr(e)
}
fn never(v: int) {
  printStr("SHOULD NOT RUN")
}
export fn run() {
  let p = Promise.reject(new Error("boom"))
  p.then(fnRef(never)).catch(fnRef(onErr))
  Promise.reject(new Error("as text")).catch(fnRef(onErrStr))
}`, expect: ['> Error: as text', '> caught: boom'], count: { '> SHOULD NOT RUN': 0 } },

  { name: 'promise-chain-uses-callback-return', src: `
fn first(x: num) num {
  return x + 0.5
}
fn second(x: num) {
  printNum(x)
}
export fn run() {
  Promise.resolve(1).then(fnRef(first)).then(fnRef(second))
}`, expect: ['> 1.5'] },

  { name: 'promise-from-library-function', wait: 400, src: `
fn gotUser(u: int) {
  let name: str = u.name
  printStr(name)
  printStr(toStr(u.id))
}
fn failed(e: int) {
  printStr(strConcat("failed: ", toStr(e.message)))
}
export fn run() {
  fakeLib.fetchUser(7).then(fnRef(gotUser))
  fakeLib.failLater().then(fnRef(gotUser)).catch(fnRef(failed))
}`, expect: ['> user7', '> 7', '> failed: server said no'] },

  // ── 3. Null / undefined ──
  { name: 'null-checks', src: `
export fn run() {
  let missing = document.getElementById("no-such-element")
  if (isNull(missing)) { printStr("missing is null") }
  let body = document.body
  if (!isNull(body)) { printStr("body is not null") }
  if (isNull(fakeLib.config.nothing)) { printStr("null property") }
  if (isNull(fakeLib.config.undefinedThing)) { printStr("undefined property") }
  if (isNull(fakeLib.config.hidden)) { printStr("WRONG: false is not null") }
  if (missing == null) { printStr("== null works") }
  if (body != null) { printStr("!= null works") }
  if (missing == 0) { printStr("== 0 works") }
}`, expect: ['> missing is null', '> body is not null', '> null property', '> undefined property', '> == null works', '> != null works', '> == 0 works'], count: { '> WRONG: false is not null': 0 } },

  { name: 'typeOf', src: `
fn f() {
}
export fn run() {
  let c = fakeLib.config
  printStr(typeOf(c))
  printStr(typeOf(c.name))
  printStr(typeOf(c.size))
  printStr(typeOf(c.visible))
  printStr(typeOf(c.list))
  printStr(typeOf(c.nothing))
  printStr(typeOf(fakeLib.boom))
  printStr(typeOf(fnRef(f)))
}`, expect: ['> object', '> string', '> number', '> boolean', '> array', '> null', '> function', '> function'] },

  { name: 'null-argument-reaches-js-as-null', src: `
export fn run() {
  printStr(toStr(fakeLib.typeName(null)))
  let o = emptyObj()
  o.x = null
  printStr(toStr(JSON.stringify(o)))
}`, expect: ['> null', '> {"x":null}'] },

  // ── 4. JS exceptions ──
  { name: 'exception-in-library-call', errors: true, src: `
export fn run() {
  let r = fakeLib.boom()
  if (isNull(r)) { printStr("failed call returned null") }
  fakeLib.throwString()
  JSON.parse("{bad")
  // later calls are unaffected
  printStr(toStr(fakeLib.join("a", "b")))
  let c = new fakeLib.Counter(1)
  printStr(toStr(c.inc()))
}`, expect: ['✗ jsCall .boom(): kaboom', '> failed call returned null', '✗ jsCall .throwString(): plain string', /^✗ jsCall \.parse\(\): .*JSON/, '> a|b', '> 2'] },

  { name: 'exception-missing-method-null-receiver-bad-constructor', errors: true, src: `
export fn run() {
  fakeLib.noSuchMethod(1)
  let missing = document.getElementById("no-such-element")
  missing.focus()
  let t = missing.textContent
  let x = new fakeLib.NoSuchClass(1)
  let y = new URL("not a url")
  printStr("still running")
}`, expect: [/^✗ jsCall \.noSuchMethod\(\): is not a function/, '✗ jsCall .focus(): receiver is null', /^✗ \.textContent: cannot read a property of null/, /^✗ new NoSuchClass\(\): is not a constructor/, /^✗ new URL\(\): .*Invalid URL/, '> still running'] },

  { name: 'exception-inside-callback-and-global-call', errors: true, wait: 400, src: `
fn bad(x: int) {
  fakeLib.boom()
  printStr(strConcat("callback continued ", intToStr(x)))
}
export fn run() {
  JSON.parse("[1]").forEach(fnRef(bad))
  let v = atob("***")
  printStr("after")
}`, expect: ['✗ jsCall .boom(): kaboom', '> callback continued 1', /^✗ atob\(\): .*not correctly encoded/, '> after'] },

  // ── 5. Iterating JS arrays / objects ──
  { name: 'iterate-array-jsLen-jsAt', src: `
export fn run() {
  let list = fakeLib.config.list
  let total = 0.0
  for (let i = 0; i < jsLen(list); i++) {
    let v: num = jsAt(list, i)
    total = total + v
  }
  printNum(total)
  // elements as handles
  let people = JSON.parse("[{\\"n\\":\\"ann\\"},{\\"n\\":\\"bob\\"},{\\"n\\":\\"cy\\"}]")
  for (let i = 0; i < jsLen(people); i++) {
    let p = jsAt(people, i)
    printStr(toStr(p.n))
  }
  print(jsLen(JSON.parse("[]")))
  print(jsLen(JSON.parse("[1,2,3,4,5]")))
}`, expect: ['> 150', '> ann', '> bob', '> cy', '> 0', '> 5'] },

  { name: 'iterate-array-length-and-at-method', src: `
export fn run() {
  // .length and .at(i) work too; the loop variable must reach JS as a number, never as a handle
  let list = fakeLib.config.list
  let n = toInt(list.length)
  for (let i = 0; i < n; i++) {
    printStr(toStr(list.at(i)))
  }
}`, expect: ['> 10', '> 20', '> 30', '> 40', '> 50'] },

  { name: 'iterate-object-keys', src: `
export fn run() {
  let o = JSON.parse("{\\"a\\":1,\\"b\\":\\"two\\",\\"c\\":true}")
  let keys = jsKeys(o)
  for (let i = 0; i < jsLen(keys); i++) {
    let k: str = jsAt(keys, i)
    let v: str = jsGet(o, k)
    printStr(strConcat(k, strConcat("=", v)))
  }
  let m = new Map()
  m.set("k", 1)
  m.set("j", 2)
  print(jsLen(m))
}`, expect: ['> a=1', '> b=two', '> c=true', '> 2'] },

  // ── 6. Explicit new ──
  { name: 'new-expression', src: `
export fn run() {
  let d = new Date(2020, 0, 15)
  printStr(toStr(d.getFullYear()))
  let c = new fakeLib.Counter(5)
  c.inc()
  printStr(toStr(c.inc()))
  // constructor held in a variable
  let K = fakeLib.Counter
  let c2 = new K(100)
  printStr(toStr(c2.inc()))
  // no argument list, chaining, nested new as an argument
  let m = new Map
  m.set("a", 1)
  printStr(toStr(m.size))
  printStr(toStr(new Date(2021, 5, 1).getMonth()))
  let u = new URL("/path?q=1", new URL("https://example.com/base"))
  let href: str = u.href
  printStr(href)
  printStr(toStr(new Error("oops").message))
}`, expect: ['> 2020', '> 7', '> 101', '> 1', '> 5', '> https://example.com/path?q=1', '> oops'] },

  { name: 'implicit-new-fallback-still-works', src: `
export fn run() {
  let d = Date(2020, 0, 15)
  printStr(toStr(d.getFullYear()))
  let c = fakeLib.Counter(5)
  printStr(toStr(c.inc()))
}`, expect: ['> 2020', '> 6'] },

  // ── 7. Strings / numbers / bools coming back from JS in typed positions ──
  { name: 'typed-values-from-js', src: `
fn nameOf(o: int) str {
  return o.name
}
fn sizeOf(o: int) num {
  return o.size
}
fn shown(o: int) bool {
  return o.visible
}
export fn run() {
  let c = fakeLib.config
  let s: str = c.name
  printStr(s)
  let n: num = c.size
  printNum(n + 1.0)
  if (c.visible) { printStr("visible") }
  if (c.hidden) { printStr("WRONG: hidden") }
  if (!c.hidden) { printStr("not hidden") }
  if (c.nothing) { printStr("WRONG: null is falsy") }
  if (c.visible && !c.hidden) { printStr("both") }
  let b: bool = c.visible
  if (b) { printStr("bool var") }
  // straight into typed parameters and arithmetic
  printStr(c.child.label)
  printNum(c.size * 2.0)
  printStr(strConcat("name=", c.name))
  printStr(nameOf(c))
  printNum(sizeOf(c))
  if (shown(c)) { printStr("shown") }
  // assignment to an existing typed variable; method-call results
  let t = "start"
  t = c.name
  printStr(t)
  let up: str = c.name.toUpperCase()
  printStr(up)
  let cnt = toInt(c.count)
  print(cnt + 1)
  while (c.hidden) { printStr("WRONG: loop") }
}`, expect: ['> cfg', '> 3.5', '> visible', '> not hidden', '> both', '> bool var', '> kid', '> 5', '> name=cfg', '> cfg', '> 2.5', '> shown', '> cfg', '> CFG', '> 8'],
    count: { '> WRONG: hidden': 0, '> WRONG: null is falsy': 0, '> WRONG: loop': 0 } },

  // ── Handle round-trips and argument marshalling ──
  { name: 'handles-round-trip-and-ints-stay-ints', src: `
export fn run() {
  let c = fakeLib.config
  // a string / number / boolean read from JS can be handed straight back to JS
  let name = c.name
  let size = c.size
  let vis = c.visible
  let o = emptyObj()
  o.who = name
  o.size = size
  o.vis = vis
  printStr(toStr(JSON.stringify(o)))
  // int variables are numbers, whatever their value (they used to collide with small handle ids)
  let arr = new Array()
  for (let k = 0; k < 6; k++) {
    arr.push(k)
  }
  printStr(toStr(JSON.stringify(arr)))
  // a function handle is passed as the function
  printStr(toStr(fakeLib.typeName(fakeLib.boom)))
}`, expect: ['> {"who":"cfg","size":2.5,"vis":true}', '> [0,1,2,3,4,5]', '> function'] },

  { name: 'nested-calls-in-arguments', src: `
export fn run() {
  // inner calls reuse the argument buffer; outer arguments must survive
  printStr(toStr(fakeLib.join(1, fakeLib.ident(2))))
  printStr(toStr(fakeLib.join(fakeLib.ident("a"), fakeLib.join("b", fakeLib.ident(3)))))
  printStr(toStr(fakeLib.ident(fakeLib.ident("str"))))
  let o = emptyObj()
  o.v = fakeLib.ident("text")
  o.w = fakeLib.join(1.5, "z")
  printStr(toStr(JSON.stringify(o)))
}`, expect: ['> 1|2', '> a|b|3', '> str', '> {"v":"text","w":"1.5|z"}'] },

  // Callbacks keep their state in top-level variables, so literal initial values must be honoured.
  { name: 'global-initial-values', src: `
mut count = 5
mut ratio = 2.5
mut neg = -3
mut title = "hello"
mut on = true
export fn run() {
  print(count)
  printNum(ratio)
  print(neg)
  printStr(title)
  if (on) { printStr("on") }
}`, expect: ['> 5', '> 2.5', '> -3', '> hello', '> on'] },

  { name: 'long-strings-from-js', src: `
fn got(s: str) {
  print(strLen(s))
}
export fn run() {
  let s: str = fakeLib.big(3000)
  print(strLen(s))
  print(strLen(toStr(fakeLib.big(70000))))
  Promise.resolve(fakeLib.big(1234)).then(fnRef(got))
  printStr(substr(s, 0, 3))
}`, expect: ['> 3000', '> 70000', '> xxx', '> 1234'] },

  // ── 8. The `js` type: a JS value is no longer an int ──
  // The four footguns that used to do arithmetic on handle ids / fail WASM validation.
  { name: 'js-arithmetic-and-comparison-use-the-number', src: `
export fn run() {
  let obj = fakeLib.config
  let c = obj.count
  print(c + 1)
  print(obj.count + 1)
  if (obj.count > 5) { printStr("count > 5") }
  if (c > 5) { printStr("c > 5") }
  if (c < 5) { printStr("WRONG: c < 5") }
  if (obj.count == 7) { printStr("count == 7") }
  if (obj.count != 7) { printStr("WRONG: count != 7") }
  // with a num operand the result is a num; two JS values give a num
  printNum(obj.size * 2.0)
  printNum(obj.size + obj.count)
  // compared with an int variable, and a fractional JS number against an int literal
  let n = 3
  if (obj.count > n) { printStr("count > n") }
  if (obj.size > 2) { printStr("size > 2") }
  print(c * 2 - 4)
  print(obj.count / 2)
  print(obj.count % 2)
  printNum(-c)
  c++
  print(c)
  c += 10
  print(c)
  // straight into int / num parameters
  print(obj.count)
  printNum(obj.count)
}`, expect: ['> 8', '> 8', '> count > 5', '> c > 5', '> count == 7', '> 5', '> 9.5', '> count > n', '> size > 2', '> 10', '> 3', '> 1', '> -7', '> 8', '> 18', '> 7', '> 7'],
    count: { '> WRONG: c < 5': 0, '> WRONG: count != 7': 0 } },

  { name: 'js-variable-in-conditions-is-truthiness', src: `
export fn run() {
  let o = fakeLib.config
  let v = o.visible
  if (v) { printStr("v") }
  let h = o.hidden
  if (!h) { printStr("not h") }
  if (v && !h) { printStr("both") }
  if (h || v) { printStr("either") }
  while (h) { printStr("WRONG: while") }
  let nothing = o.nothing
  if (nothing) { printStr("WRONG: null is falsy") }
  if (nothing == null) { printStr("null") }
  if (o != null) { printStr("o not null") }
  let name = o.name
  if (name) { printStr("name truthy") }
  if (o.visible && o.count > 5) { printStr("mixed") }
  for (let k = 0; v; k++) {
    printStr("loop once")
    v = o.hidden
  }
}`, expect: ['> v', '> not h', '> both', '> either', '> null', '> o not null', '> name truthy', '> mixed', '> loop once'],
    count: { '> WRONG: while': 0, '> WRONG: null is falsy': 0, '> loop once': 1 } },

  { name: 'js-variable-converts-where-a-type-is-declared', src: `
fn takesInt(n: int) {
  print(n + 1)
}
fn takesStr(s: str) {
  printStr(s)
}
fn nameOfIntHandle(o: int) str {
  return o.name
}
fn countOf(o: js) int {
  let c = o.count
  return c
}
fn labelOf(o: js) str {
  let l = o.child.label
  return l
}
fn sizeOf(o: js) num {
  let s = o.size
  return s
}
fn isVisible(o: js) bool {
  let v = o.visible
  return v
}
export fn run() {
  let o = fakeLib.config
  let nm = o.name
  let s: str = nm
  printStr(s)
  printStr(nm)
  takesStr(nm)
  let sz = o.size
  printNum(sz)
  let x: num = sz
  printNum(x + 1.0)
  let i: int = o.count
  print(i)
  let cv = o.count
  takesInt(cv)
  printStr(nameOfIntHandle(o))
  print(countOf(o))
  printStr(labelOf(o))
  printNum(sizeOf(o))
  if (isVisible(o)) { printStr("visible") }
  let b: bool = o.hidden
  if (!b) { printStr("not hidden") }
  let t = "x"
  t = nm
  printStr(t)
  printStr(strConcat("n=", o.count))
}`, expect: ['> cfg', '> cfg', '> cfg', '> 2.5', '> 3.5', '> 7', '> 8', '> cfg', '> 7', '> kid', '> 2.5', '> visible', '> not hidden', '> cfg', '> n=7'] },

  { name: 'js-null-variable-reaches-js-as-null', src: `
mut cur: js = null
export fn run() {
  let missing = fakeLib.config.nothing
  printStr(toStr(fakeLib.typeName(missing)))
  // an int variable is still a number
  let z = 0
  printStr(toStr(fakeLib.typeName(z)))
  // through an auto-bridged global function and a property assignment too
  printStr(toStr(typeNameG(missing)))
  let o = emptyObj()
  o.x = missing
  printStr(toStr(JSON.stringify(o)))
  let e: js = null
  printStr(toStr(fakeLib.typeName(e)))
  printStr(toStr(fakeLib.typeName(cur)))
  // a variable that starts as null is a js variable
  let q = null
  printStr(toStr(fakeLib.typeName(q)))
  q = fakeLib.config
  printStr(q.name)
}`, expect: ['> null', '> number', '> null', '> {"x":null}', '> null', '> null', '> null', '> cfg'] },

  { name: 'js-declared-type-and-int-stay-compatible', src: `
mut g = 0
mut cur: js = null
fn make() js {
  return emptyObj()
}
fn show(o: js) {
  printStr(strConcat(typeOf(o), strConcat(":", toStr(o))))
}
export fn run() {
  if (cur == null) { printStr("cur starts null") }
  cur = fakeLib.config
  printStr(cur.name)
  // an int global / local may still hold a handle, as every older program does
  g = fakeLib.config
  printStr(g.name)
  let old: int = fakeLib.config
  printStr(old.name)
  // …and an int assigned from a JS number is that number
  g = fakeLib.config.count
  print(g + 1)
  let m = make()
  m.a = 1
  printStr(toStr(JSON.stringify(m)))
  // Emit values passed where js is declared
  show("hi")
  show(5)
  show(2.5)
  show(true)
  let v = fakeLib.config.name
  v = "lit"
  printStr(v)
  printStr(toStr(1))
}`, expect: ['> cur starts null', '> cfg', '> cfg', '> cfg', '> 8', '> {"a":1}', '> string:hi', '> number:5', '> number:2.5', '> boolean:true', '> lit', '> 1'] },

  { name: 'js-equality-identity-string-bool', src: `
export fn run() {
  if (fakeLib.config == fakeLib.config) { printStr("same object") }
  if (fakeLib.config != fakeLib.config.child) { printStr("different objects") }
  if (fakeLib.config == fakeLib.config.child) { printStr("WRONG: identity") }
  if (fakeLib.config.name == "cfg") { printStr("name == cfg") }
  if (fakeLib.config.name != "zzz") { printStr("name != zzz") }
  if (fakeLib.config.visible == true) { printStr("visible == true") }
  let w = window
  if (w == window) { printStr("window same") }
  // an existing object is not "== 0"; null is
  if (fakeLib.config == 0) { printStr("WRONG: object == 0") }
  if (fakeLib.config.nothing == 0) { printStr("null == 0") }
  // Emit strings compare by content
  let s = "abc"
  if (s == "abc") { printStr("str ==") }
  if (s != "abd") { printStr("str !=") }
  if (typeOf(w) == "object") { printStr("typeOf ==") }
}`, expect: ['> same object', '> different objects', '> name == cfg', '> name != zzz', '> visible == true', '> window same', '> null == 0', '> str ==', '> str !=', '> typeOf =='],
    count: { '> WRONG: identity': 0, '> WRONG: object == 0': 0 } },

  { name: 'js-builtins-without-member-access', src: `
fn f(o: js) {
  if (o) { printStr("truthy") }
  if (o == null) { printStr("null") }
}
export fn run() {
  let o = emptyObj()
  f(o)
  f(null)
  print(toInt("42") + 1)
  printStr(toStr(2.5))
  printStr(typeOf(5))
  printStr(typeOf("s"))
  let i = 3
  printNum(i * 2.5)
}`, expect: ['> truthy', '> null', '> 43', '> 2.5', '> number', '> string', '> 7.5'] },

  // ── 9. Callback parameters typed js ──
  { name: 'callback-js-params-receive-anything', src: `
fn each(v: js, i: int) {
  printStr(strConcat(intToStr(i), strConcat(":", typeOf(v))))
  if (typeOf(v) == "number") { print(v + 1) }
  if (typeOf(v) == "string") { printStr(v) }
}
fn pick(o: js) js {
  return o.inner
}
fn onPing(ev: js) {
  printStr(ev.type)
}
export fn run() {
  let arr = JSON.parse("[1, \\"two\\", {\\"a\\":1}, null, true, 2.5]")
  arr.forEach(fnRef(each))
  let objs = JSON.parse("[{\\"inner\\":{\\"k\\":1}},{\\"inner\\":5},{\\"inner\\":\\"s\\"}]")
  printStr(toStr(JSON.stringify(objs.map(fnRef(pick)))))
  let el = document.createElement("div")
  el.addEventListener("ping", fnRef(onPing))
  el.dispatchEvent(new Event("ping"))
}`, expect: ['> 0:number', '> 2', '> 1:string', '> two', '> 2:object', '> 3:null', '> 4:boolean', '> 5:number', '> 3', '> [{"k":1},5,"s"]', '> ping'] },

  // ── 10. Index syntax on JS values ──
  { name: 'index-read-write', src: `
export fn run() {
  let a = JSON.parse("[10,20,30]")
  print(a[1] + 1)
  a[0] = 5
  a[1] += 5
  let total = 0
  for (let i = 0; i < jsLen(a); i++) {
    total = total + a[i]
  }
  print(total)
  let sum = 0.0
  for (let i = 0; i < a.length; i++) { sum = sum + a[i] }
  printNum(sum)
  // string keys, keys in variables, a JS value as the index
  let o = emptyObj()
  o["key"] = "v"
  let k = "name"
  o[k] = fakeLib.config.name
  printStr(toStr(JSON.stringify(o)))
  printStr(fakeLib.config[k])
  let last = a[2]
  a[last] = 1
  print(jsLen(a))
  // nested, and on the result of a call
  let m = JSON.parse("[[1,2],[3,4]]")
  print(m[1][0] + 0)
  m[0][1] = 9
  printStr(toStr(JSON.stringify(m)))
  printStr(toStr(jsKeys(o)[1]))
  // assignment as a for-loop update
  let b = JSON.parse("[7,7,7]")
  for (let j = 0; j < 2; b[j] = 0) { j++ }
  printStr(toStr(JSON.stringify(b)))
  // a missing element is null
  if (b[99] == null) { printStr("out of range is null") }
  // Emit arrays are untouched: literals and getItem still work, also right after another statement
  let xs = [1, 2, 3]
  print(getItem(xs, 1))
  let js2 = toJsArray([4, 5, 6])
  print(js2[2] + 0)
}`, expect: ['> 21', '> 60', '> 60', '> {"key":"v","name":"cfg"}', '> cfg', '> 31', '> 3', '> [[1,9],[3,4]]', '> name', '> [7,0,0]', '> out of range is null', '> 2', '> 6'] },

  { name: 'index-on-emit-array-is-a-compile-error', status: 'Error', errors: true, src: `
export fn run() {
  let xs = [1, 2, 3]
  print(xs[1])
}`, expect: [/^✗ 3:9: \[ \] works on JS values \(type js\) and strings, but this is int/] },

  { name: 'index-null-receiver-is-reported', errors: true, src: `
export fn run() {
  let missing = fakeLib.config.nothing
  let x = missing[0]
  missing[1] = 5
  printStr("still running")
}`, expect: ['✗ [0]: cannot index null', '✗ [1] = …: cannot index null', '> still running'] },

  // ── 11. Methods and properties on Emit strings ──
  { name: 'string-methods', src: `
export fn run() {
  let parts = "a,b,c".split(",")
  print(jsLen(parts))
  printStr(parts[2])
  let s = "hello"
  printStr(s.toUpperCase())
  let n: int = s.length
  print(n)
  print(s.length + 1)
  printStr("ab".repeat(3))
  printStr(s[1])
  if (s.startsWith("he")) { printStr("starts with he") }
  if (s.includes("zz")) { printStr("WRONG: includes") }
  print(s.indexOf("l") + 0)
  let up: str = s.slice(1, 3).toUpperCase()
  printStr(up)
  printStr(strConcat("x", "y").padEnd(4, "!"))
  // numbers take methods too
  let x = 3.14159
  printStr(x.toFixed(2))
}`, expect: ['> 3', '> c', '> HELLO', '> 5', '> 6', '> ababab', '> e', '> starts with he', '> 2', '> EL', '> xy!!', '> 3.14'],
    count: { '> WRONG: includes': 0 } },

  // ── 12. Unhandled promise rejections are shown ──
  { name: 'unhandled-promise-rejection-is-shown', errors: true, wait: 400, src: `
export fn run() {
  fakeLib.failLater()
  Promise.reject("plain reason")
  printStr("ran")
}`, expect: ['> ran', '✗ unhandled promise rejection: plain reason', '✗ unhandled promise rejection: server said no'] },

  // ── 13. Top-level initialisers ──
  { name: 'global-non-literal-initialiser-is-a-compile-error', status: 'Error', errors: true, src: `
fn f() int {
  return 5
}
mut x = f()
export fn run() {
  print(x)
}`, expect: [/^✗ 4:9: Top-level 'x' must start with a literal/] },

  { name: 'global-constant-arithmetic-initialiser', src: `
mut secs = 60 * 60
mut half = 5.0 / 2.0
mut neg = -(2 + 3)
export fn run() {
  print(secs)
  printNum(half)
  print(neg)
}`, expect: ['> 3600', '> 2.5', '> -5'] },

  // `js` is only a type word in type position; it is still usable as a name and a property
  { name: 'js-is-still-an-identifier', src: `
export fn run() {
  let js = 5
  print(js + 1)
  let p = fakeLib.config.js
  if (p == null) { printStr("no .js property") }
}`, expect: ['> 6', '> no .js property'] },

  // ── 14. Global JS functions: usable result, any arguments per call site ──
  { name: 'global-function-result-without-member-call', src: `
export fn run() {
  printStr(toStr(parseInt("12")))
}`, expect: ['> 12'] },

  { name: 'global-function-result-in-typed-positions', src: `
export fn run() {
  let n = parseInt("40")
  print(n + 2)
  let f: num = parseFloat("2.5")
  printNum(f * 2.0)
  let s: str = encodeURIComponent("a b")
  printStr(s)
  if (isNaN(parseInt("x"))) { printStr("nan") }
}`, expect: ['> 42', '> 5', '> a%20b', '> nan'] },

  { name: 'global-function-different-arguments-per-call-site', src: `
export fn run() {
  printStr(toStr(describeArgs(1234.5)))
  printStr(toStr(describeArgs("1,000")))
  printStr(toStr(describeArgs()))
  printStr(toStr(describeArgs(true, null, 3, "s", 2.5)))
  let i = 7
  printStr(toStr(describeArgs(i, fakeLib.config.child)))
  // numeral(1234.5).format(…) then numeral("1,000").value(): a number at one call site, a string at the next
  printNum(makeBox(1234.5).value())
  printStr(makeBox("1,000").value())
  // booleans reach JS as booleans
  printStr(toStr(String(false)))
  printStr(toStr(String(true)))
}`, expect: ['> number:1234.5', '> string:1,000', '>', '> boolean:true null:null number:3 string:s number:2.5', '> number:7 object:{"label":"kid"}', '> 1234.5', '> 1,000', '> false', '> true'] },

  { name: 'global-function-missing-is-a-warning-not-a-crash', src: `
export fn run() {
  let r = noSuchGlobalFunction(1)
  if (r == null) { printStr("null result") }
}`, expect: [/^⚠ noSuchGlobalFunction\(\.\.\.\) — window\.noSuchGlobalFunction is not loaded/, '> null result'] },

  // ── 15. A call without new is a plain call unless the function is a constructor ──
  { name: 'capitalised-plain-functions-are-plain-calls', src: `
export fn run() {
  printNum(fakeLib.Geom.Between(0.0, 0.0, 3.0, 4.0))
  printStr(fakeLib.Geom.Label(3))
  printStr(toStr(Math.max(1, 2)))
  printStr(typeOf(String(5)))
  printStr(toStr(String(5)))
  print(Number("3") + 1)
  printStr(typeOf(Number("3")))
  printStr(typeOf(Boolean(1)))
  printStr(typeOf(Date.now()))
  printStr(toStr(JSON.stringify(JSON.parse("[1,2]"))))
}`, expect: ['> 5', '> label 3', '> 2', '> string', '> 5', '> 4', '> number', '> boolean', '> number', '> [1,2]'] },

  { name: 'constructors-still-construct-without-new', src: `
export fn run() {
  // class syntax
  let c = fakeLib.Counter(5)
  printStr(toStr(c.inc()))
  // ES5-style: prototype members, inherited prototype, and a capitalised function that only assigns to this
  let p = fakeLib.OldPoint(3, 4)
  printStr(toStr(p.sum()))
  printStr(toStr(fakeLib.OldChild().kind()))
  let b = fakeLib.Bare(9)
  printStr(toStr(b.v))
  // natives
  let d = Date(2020, 0, 15)
  printStr(toStr(d.getFullYear()))
  let m = Map()
  m.set("k", 1)
  printStr(toStr(m.size))
  let K = fakeLib.OldPoint
  let p2 = K(1, 2)
  printStr(toStr(p2.sum()))
  // explicit new on a plain capitalised function still constructs
  let g = new fakeLib.Bare(2)
  printStr(toStr(g.v))
}`, expect: ['> 6', '> 7', '> child of base', '> 9', '> 2020', '> 1', '> 3', '> 2'] },

  // ── 16. Calling a function value ──
  { name: 'call-function-value', src: `
mut saved: js = null
fn apply(f: js, x: num) num {
  return f(x)
}
export fn run() {
  let f = fakeLib.format(2)
  printStr(toStr(f(3.14159)))
  printStr(toStr(fakeLib.format(1)(3.14159)))
  let add10 = fakeLib.adder(10)
  print(add10(5) + 0)
  print(fakeLib.adder(1)(2) + 0)
  printStr(toStr(fakeLib.fns[1]("x")))
  print(fakeLib.fns[0](21) + 0)
  printNum(apply(fakeLib.fns[0], 1.5))
  saved = fakeLib.adder(100)
  print(saved(1) + 0)
  // a function held in a variable, called with different arguments
  let d = describeArgs
  printStr(toStr(d(1, "a")))
  printStr(toStr(d(true)))
}`, expect: ['> 3.14', '> 3.1', '> 15', '> 3', '> second x', '> 42', '> 3', '> 101', '> number:1 string:a', '> boolean:true'] },

  { name: 'global-function-used-as-a-value-and-called', src: `
export fn run() {
  print(parseInt("3") + 1)
  let p = parseInt
  print(p("40") + 2)
}`, expect: ['> 4', '> 42'] },

  { name: 'call-non-function-value-is-reported', errors: true, src: `
export fn run() {
  let f = fakeLib.config.nothing
  let r = f(1)
  let g = fakeLib.config.name
  g(2)
  fakeLib.adder(1)(2)(3)
  printStr("still running")
}`, expect: ['✗ f(): is not a function (it is null)', '✗ g(): is not a function (it is string)', '✗ (value)(): is not a function (it is number)', '> still running'] },

  { name: 'emit-functions-and-builtins-keep-their-names', src: `
fn twice(x: int) int {
  return x * 2
}
export fn run() {
  print(twice(4))
  print(max(3, 9))
  let n = 5
  print(twice(n))
}`, expect: ['> 8', '> 9', '> 10'] },

  { name: 'calling-a-non-js-variable-is-a-compile-error', status: 'Error', errors: true, src: `
export fn run() {
  let s = "text"
  s(1)
}`, expect: [/^✗ 3:3: 's' is a str variable, not a function/] },

  // ── 17. Array literals handed to JS are JS arrays ──
  { name: 'array-literal-as-js-value', src: `
export fn run() {
  printStr(toStr(JSON.stringify([1, 2, 3])))
  printStr(toStr(JSON.stringify([1.5, "two", true, null, [3, [4]], fakeLib.config.child])))
  printStr(toStr(JSON.stringify([])))
  printStr(toStr(describeArgs([1, 2], "x")))
  let o = emptyObj()
  o.list = [1, 2]
  o["names"] = ["a", "b"]
  printStr(toStr(JSON.stringify(o)))
  let a: js = [10, 20, 30]
  print(a[1] + 1)
  print(jsLen(a))
  let m = new Map([["k", 1], ["j", 2]])
  printStr(toStr(m.get("j")))
  let n = 4
  printStr(toStr(JSON.stringify([n, n + 1, n * 2.5])))
  // more elements than the argument buffer has slots
  let big: js = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39]
  print(jsLen(big))
  print(big[39] + 0)
  // Emit arrays are unchanged
  let xs = [1, 2, 3]
  print(getItem(xs, 2))
  print(arrayLen(xs))
  let nums = [1.5, 2.5]
  printNum(getNumItem(nums, 1))
  printStr(toStr(JSON.stringify(toJsArray(xs))))
}`, expect: ['> [1,2,3]', '> [1.5,"two",true,null,[3,[4]],{"label":"kid"}]', '> []', '> array:[1,2] string:x', '> {"list":[1,2],"names":["a","b"]}', '> 21', '> 3', '> 2', '> [4,5,10]', '> 40', '> 39', '> 3', '> 3', '> 2.5', '> [1,2,3]'] },

  // ── 18. Object literals ──
  { name: 'object-literal', src: `
fn make(n: int) js {
  return {n: n, sq: n * n}
}
export fn run() {
  let o = {a: 1, name: "x", nested: {b: 2}, list: [1, 2]}
  printStr(toStr(JSON.stringify(o)))
  printStr(o.name)
  print(o.nested.b + 1)
  let e = {}
  printStr(toStr(JSON.stringify(e)))
  let k = {"quoted key": true, 3: 1.5, type: null, new: "kw",}
  printStr(toStr(JSON.stringify(k)))
  printStr(toStr(JSON.stringify(make(3))))
  printStr(toStr(describeArgs({x: 1}, {y: [{z: "deep"}]})))
  let multi = {
    first: fakeLib.config.name,
    second: fakeLib.join("a", "b"),
    third: {inner: [1, {four: 4}]}
  }
  printStr(toStr(JSON.stringify(multi)))
  o.extra = {added: true}
  o["more"] = {n: 1}
  printStr(toStr(JSON.stringify(o.extra)))
  let arr2: js = [{id: 1}, {id: 2}]
  print(arr2[1].id + 0)
  // blocks are still blocks; emptyObj() + assignment still works
  if (true) {
    { printStr("inner block") }
  }
  let old = emptyObj()
  old.v = 1
  printStr(toStr(JSON.stringify(old)))
  // more properties than fit the argument buffer at once
  let wide = {p0:0,p1:1,p2:2,p3:3,p4:4,p5:5,p6:6,p7:7,p8:8,p9:9,p10:10,p11:11,p12:12,p13:13,p14:14,p15:15,p16:16,p17:17,p18:18,p19:19}
  print(jsLen(jsKeys(wide)))
  print(wide.p19 + 0)
}`, expect: ['> {"a":1,"name":"x","nested":{"b":2},"list":[1,2]}', '> x', '> 3', '> {}', '> {"3":1.5,"quoted key":true,"type":null,"new":"kw"}', '> {"n":3,"sq":9}', '> object:{"x":1} object:{"y":[{"z":"deep"}]}', '> {"first":"cfg","second":"a|b","third":{"inner":[1,{"four":4}]}}', '> {"added":true}', '> 2', '> inner block', '> {"v":1}', '> 20', '> 19'] },

  { name: 'object-literal-syntax-error-is-readable', status: 'Error', errors: true, src: `
export fn run() {
  let o = {a 1}
}`, expect: [/^✗ 2:14: Expected : after the property name "a"/] },

  // ── 19. String + ──
  { name: 'string-plus', src: `
fn greet(name: str) str {
  return "hello " + name + "!"
}
export fn run() {
  let a = "ab"
  let b = "cd"
  printStr(a + b)
  printStr("name=" + fakeLib.config.name)
  printStr(fakeLib.config.name + "/" + fakeLib.config.count)
  let i = 7
  printStr("i=" + i)
  printStr(i + " items")
  printStr("n=" + 2.5 + " whole=" + 3.0)
  printStr("b=" + true)
  printStr("sum=" + (1 + 2))
  printStr("a" + 1 + 2)
  printStr(greet("bob"))
  let s = "x"
  s += "y"
  s += 1
  s += fakeLib.config.child.label
  printStr(s)
  let t: str = "len " + a.length
  printStr(t)
  printStr("null:[" + fakeLib.config.nothing + "]")
  if ("a" + "b" == "ab") { printStr("eq") }
  print(strLen("abc" + "de"))
  // numbers still add
  print(1 + 2)
  printNum(1.5 + 2)
  print(fakeLib.config.count + 1)
}`, expect: ['> abcd', '> name=cfg', '> cfg/7', '> i=7', '> 7 items', '> n=2.5 whole=3', '> b=true', '> sum=3', '> a12', '> hello bob!', '> xy1kid', '> len 2', '> null:[]', '> eq', '> 5', '> 3', '> 3.5', '> 8'] },
];

async function runTest(browser, fileUrl, t) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const problems = [];
  page.on('pageerror', e => problems.push('pageerror: ' + e.message.slice(0, 300)));
  await page.route(/^https?:/, route => route.abort());
  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof compileAndRun === 'function');
  await page.evaluate(FAKE_LIB);
  await page.evaluate(src => {
    try { closeWelcome(); } catch (e) {}
    const ed = document.getElementById('editor');
    ed.value = src;
    ed.dispatchEvent(new Event('input'));
  }, t.src.trim() + '\n');
  for (let i = 0; i < (t.rerun ? 2 : 1); i++) {
    await page.evaluate(() => compileAndRun()).catch(e => problems.push('run rejected: ' + e.message.slice(0, 300)));
  }
  await page.waitForTimeout(t.wait || 250);
  const status = await page.evaluate(() => document.getElementById('sTxt').innerText);
  const output = await page.evaluate(() => document.getElementById('tab-output').innerText);
  await page.close();

  const lines = output.split('\n').map(l => l.trim());
  if (status !== (t.status || 'Done')) {
    problems.push('status: ' + status + ' — ' + (lines.find(l => /✗/.test(l)) || ''));
  }
  // Expected lines, in order.
  let at = 0;
  for (const want of t.expect) {
    const hit = lines.findIndex((l, i) => i >= at && (want instanceof RegExp ? want.test(l) : l === want));
    if (hit < 0) { problems.push('missing (or out of order): ' + want); break; }
    at = hit + 1;
  }
  for (const [line, n] of Object.entries(t.count || {})) {
    const got = lines.filter(l => l === line).length;
    if (got !== n) problems.push('expected "' + line + '" ' + n + ' time(s), got ' + got);
  }
  // Red error lines must be announced by the test (errors: true), and then each must be expected.
  const errLines = lines.filter(l => /^✗/.test(l));
  if (!t.errors && errLines.length) problems.push('unexpected error line: ' + errLines[0]);
  if (t.errors) {
    for (const l of errLines) {
      if (!t.expect.some(w => (w instanceof RegExp ? w.test(l) : l === w))) problems.push('unexpected error line: ' + l);
    }
  }
  return { ok: problems.length === 0, problems, output };
}

(async () => {
  const args = process.argv.slice(2);
  const file = path.resolve(args[0] && /\.html$/.test(args[0]) ? args.shift() : path.join(__dirname, '..', 'emit-ide-1_32.html'));
  const tests = TESTS.filter(t => !args.length || args.includes(t.name));
  const browser = await chromium.launch();
  let failed = 0;
  for (const t of tests) {
    const r = await runTest(browser, 'file://' + file, t);
    if (r.ok) console.log('PASS  ' + t.name);
    else { failed++; console.log('FAIL  ' + t.name + '\n      ' + r.problems.join('\n      ')); }
    if (process.env.VERBOSE || (!r.ok && process.env.VERBOSE !== '0')) {
      console.log(r.output.split('\n').filter(l => l.trim()).map(l => '      | ' + l).join('\n'));
    }
  }
  await browser.close();
  console.log('\n' + (tests.length - failed) + '/' + tests.length + ' interop tests passed');
  process.exit(failed || !tests.length ? 1 : 0);
})();

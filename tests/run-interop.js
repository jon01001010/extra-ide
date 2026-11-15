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

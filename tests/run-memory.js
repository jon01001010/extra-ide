#!/usr/bin/env node
// Memory / lifetime tests for an Emit IDE build: long-lived programs are run for many frames and the
// runtime's stores are measured — the JS handle table, the string area in WASM memory, the Emit
// array store, WASM memory size and the JS heap.
//
//   node tests/run-memory.js [path/to/emit-ide.html] [programName ...]
//   FRAMES=20000 (default)   number of frames driven per program
//   BASELINE=1               only measure and print the table, assert nothing (for a runtime without
//                            lifetime management — this is how the "before" numbers were recorded)
//   BENCH=1                  also run the interop micro-benchmark (1e5 property reads etc.)
//   VERBOSE=1                print each program's Output tab
//
// Frames are not waited for in real time: requestAnimationFrame is stubbed out before Run, and the frame
// function is driven in a tight loop through the same runtime path the loop uses (_emitFrame()).
// The IDE writes a small "→ call(args)" trace line to the Output tab and an entry to the import log
// for every interop call; the test removes those every 500 frames so the JS heap figure shows what
// the handle table keeps alive (the number of removed trace lines is reported as "trace").
//
// Exit code 0 only when every assertion holds:
//   steady programs  live handles / string bytes / arrays at the last frame are within a small margin
//                    of the values at frame FRAMES/10, and WASM memory did not grow in between
//   every program    no red "✗" line (so no stale-handle warning, no string-area error), no page error
//   guard programs   every value stored in globals / Emit arrays / JS objects reads back correctly
//   string-exhaustion  a single call that keeps more than 32 MB of strings in use gets one red error line
//                    and "" — no string a global points to is overwritten — and the program carries on
//   scope API        _scopeEnter/_scopeExit/_scopeRun: nested and suspended invocations keep their handles,
//                    a released handle id reads as null with one warning line (never as another object)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const LIBS = path.join(__dirname, 'node_modules');
const CDN_MAP = [
  [/three(\.min)?\.js/, 'three/build/three.min.js'],
  [/babylon/, 'babylonjs/babylon.js'],
];
const FRAMES = Number(process.env.FRAMES || 20000);
const BASELINE = !!process.env.BASELINE;

// A stand-in library, available offline.
const MEM_LIB = `
window.memLib = (function () {
  var child = { name: 'child' };
  function Thing(n) { this.n = n; this.payload = new Array(64).fill(n); }
  Thing.prototype.get = function () { return this.n; };
  return {
    Thing: Thing,
    makeObj: function () { var o = { x: 0, last: null, child: child }; o.self = function () { return o; }; o.getChild = function () { return child; }; o.fresh = function () { return { n: 0, payload: new Array(64).fill(1) }; }; return o; },
    tagged: function (n) { return { tag: n, payload: new Array(32).fill(n) }; },
    fresh: function () { return { payload: new Array(64).fill(7) }; },
    big: function (n) { return new Array(n + 1).join('x'); },
    label: function (n) { return 'label-' + n; },
    list: function (n) { var a = []; for (var i = 0; i < n; i++) a.push(i + 1); return a; },
    objs: function (n) { var a = []; for (var i = 0; i < n; i++) a.push({ n: i }); return a; },
    strs: function (n) { var a = []; for (var i = 0; i < n; i++) a.push('s' + i); return a; },
    each: function (cb) { cb({ n: 1 }); cb({ n: 2 }); },
    callZero: function () { if (window.memLibCb) window.memLibCb(); },
    setCb: function (f) { window.memLibCb = f; }
  };
})();
`;

// kind: 'steady' → bounded-growth assertions; guard: lines the `check()` export must print at the end.
// ex: name of a bundled example (EX[name]) instead of src.
const PROGRAMS = [
  // (a) canvas builtins only, text built per frame with intToStr / strConcat / string +
  { name: 'canvas-text', kind: 'steady', src: `
mut n = 0
export fn game() {
  canvas(200, 100)
  animate()
}
export fn frame() {
  n++
  clear()
  color(10, 10, 30)
  rect(0, 0, 200, 100)
  color(255, 255, 255)
  text("score: " + intToStr(n), 5, 20, 12)
  let s = "n=" + n
  text(s, 5, 40, 12)
  text(strConcat("t ", numToStr(1.5)), 5, 60, 12)
  text(substr("hello world", 0, 5), 5, 80, 12)
}` },

  // (b) property reads/writes on one long-lived JS object
  { name: 'prop-readwrite', kind: 'steady', src: `
mut o: js = null
export fn run() {
  o = memLib.makeObj()
  animate()
}
export fn frame() {
  o.x = o.x + 1
  let v: num = o.x
  o.y = v * 2.0
  let c = o.child
  let nm: str = c.name
}
export fn check() {
  let v: int = o.x
  print(v)
}`, guard: f => ['> ' + f] },

  // (c) member calls returning the same object, and fresh objects (`new` in the loop)
  { name: 'member-calls', kind: 'steady', src: `
mut o: js = null
mut cnt = 0
export fn run() {
  o = memLib.makeObj()
  animate()
}
export fn frame() {
  cnt = cnt + 1
  let same = o.self()
  let child = o.getChild()
  let fresh = o.fresh()
  fresh.n = cnt
  let t = new memLib.Thing(cnt)
  let d = new Date()
  let ms: num = d.getTime()
  o.last = t
  let lbl: str = memLib.label(cnt)
}
export fn check() {
  if (cnt > 0) { doCheck() }
}
fn doCheck() {
  let t = o.last
  let v: int = t.get()
  print(v)
}`, guard: f => ['> ' + f] },

  // (d) bundled examples
  { name: 'ex-orbit', kind: 'steady', ex: 'orbit' },
  { name: 'ex-babylon', kind: 'steady', ex: 'babylon' },
  { name: 'ex-pong', kind: 'steady', ex: 'pong' },
  { name: 'ex-snake', kind: 'steady', ex: 'snake' },

  // (e) callbacks every frame
  { name: 'callbacks', kind: 'steady', src: `
mut total = 0
mut seen = 0
mut chars = 0
mut list: js = null
mut objs: js = null
mut strs: js = null
fn visit(v: int, i: int) {
  total += v
}
fn visitObj(o: js) {
  let n: int = o.n
  seen += n
}
fn visitStr(s: str) {
  chars += strLen(s)
}
export fn run() {
  list = memLib.list(10)
  objs = memLib.objs(10)
  strs = memLib.strs(10)
  animate()
}
export fn frame() {
  list.forEach(fnRef(visit))
  objs.forEach(fnRef(visitObj))
  strs.forEach(fnRef(visitStr))
  memLib.each(fnRef(visitObj))
}
export fn check() {
  print(total)
  print(seen)
  print(chars)
}`, guard: f => ['> ' + 55 * f, '> ' + 48 * f, '> ' + 20 * f] },

  // (f) correctness guard: handles and strings legitimately kept alive across frames
  { name: 'guard-keepalive', kind: 'steady', src: `
mut cur: js = null
mut first: js = null
mut asInt = 0
mut label: str = ""
mut firstLabel: str = ""
mut arr = 0
mut nested = 0
mut box: js = null
mut jsArr: js = null
mut frameN = 0
mut held = 0
mut zeroCb = 0

fn onZero() {
  zeroCb++
}
export fn run() {
  arr = newArray(8)
  nested = newArray(2)
  setItem(arr, 7, nested)
  setItem(nested, 0, 4242)
  box = emptyObj()
  box.inner = newArray(3)
  let inner: int = box.inner
  setItem(inner, 2, 777)
  jsArr = memLib.list(0)
  first = memLib.tagged(11)
  firstLabel = memLib.label(11)
  asInt = memLib.tagged(12)
  memLib.setCb(fnRef(onZero))
  animate()
}
export fn frame() {
  frameN++
  // churn: garbage handles, strings and arrays every frame
  let tmp = memLib.fresh()
  let junk = "junk " + intToStr(frameN)
  let junk2: str = memLib.big(200)
  let scratch = newArray(4)
  setItem(scratch, 0, frameN)
  let lit = [1, 2, 3]
  // a value read out of a global, the global overwritten, then a callback with no arguments
  let old = cur
  // replace what is stored now and then
  if (frameN % 500 == 1) {
    cur = memLib.tagged(frameN)
    label = "label " + intToStr(frameN)
    setItem(arr, 0, memLib.tagged(frameN + 1))
    setItem(arr, 1, memLib.tagged(frameN + 2))
    box.held = memLib.tagged(frameN + 3)
    jsArr.push(memLib.tagged(frameN + 4))
    held = frameN
    memLib.callZero()
    if (!isNull(old)) {
      let ot: int = old.tag
      if (ot != frameN - 500) { printStr("BAD old tag") }
    }
  }
}
export fn check() {
  if (frameN > 0) { doCheck() }
}
fn doCheck() {
  print(held)
  let a: int = cur.tag
  print(a)
  printStr(label)
  let h0 = getItem(arr, 0)
  let b: int = h0.tag
  print(b)
  let h1 = getItem(arr, 1)
  let c: int = h1.tag
  print(c)
  let bh = box.held
  let d: int = bh.tag
  print(d)
  let last = jsArr.pop()
  let e: int = last.tag
  print(e)
  let f: int = first.tag
  print(f)
  printStr(firstLabel)
  let g: int = asInt.tag
  print(g)
  print(getItem(getItem(arr, 7), 0))
  let inner: int = box.inner
  print(getItem(inner, 2))
  print(zeroCb)
}`, guard: f => { const h = Math.floor((f - 1) / 500) * 500 + 1; return ['> ' + h, '> ' + h, '> label ' + h, '> ' + (h + 1), '> ' + (h + 2), '> ' + (h + 3), '> ' + (h + 4), '> 11', '> label-11', '> 12', '> 4242', '> 777', '> ' + (Math.floor((f - 1) / 500) + 1)]; } },

  // (g) string pressure: far more than 32 MB of strings while a str global must stay intact
  { name: 'guard-string-pressure', kind: 'steady', src: `
mut keep: str = ""
mut keepLate: str = ""
mut n = 0
export fn run() {
  keep = memLib.label(1)
  animate()
}
export fn frame() {
  n++
  let a: str = memLib.big(3000)
  let b = a + "!"
  if (n == 1500) { keepLate = "late " + intToStr(n) }
}
export fn check() {
  printStr(keep)
  printStr(keepLate)
}`, guard: f => ['> label-1', f >= 1500 ? '> late 1500' : '> '] },

  // (h) Emit arrays created every frame
  { name: 'arrays-per-frame', kind: 'steady', src: `
mut keep = 0
mut n = 0
export fn run() {
  keep = newArray(4)
  setItem(keep, 0, 31337)
  animate()
}
export fn frame() {
  n++
  let a = newArray(16)
  setItem(a, 0, n)
  let b = [n, n + 1, n + 2]
  let j = toJsArray(b)
  let len = jsLen(j)
  if (n % 1000 == 0) {
    let k = newArray(4)
    setItem(k, 0, n)
    setItem(keep, 1, k)
  }
}
export fn check() {
  if (n >= 1000) { doCheck() }
}
fn doCheck() {
  print(getItem(keep, 0))
  print(getItem(getItem(keep, 1), 0))
}`, guard: f => ['> 31337', '> ' + Math.floor(f / 1000) * 1000] },

  // (i) one call that holds more than the whole string area: a clear error, no corruption, and it recovers
  { name: 'string-exhaustion', kind: 'exhaust', frames: 2, src: `
mut keep: str = ""
mut n = 0
export fn run() {
  keep = memLib.label(7)
  animate()
}
export fn frame() {
  n++
  let i = 0
  let last: str = ""
  while (i < 12000) {
    last = memLib.big(3000)
    i++
  }
}
export fn check() {
  if (n > 0) { doCheck() }
}
fn doCheck() {
  printStr(keep)
  let t: str = memLib.label(n)
  printStr(t)
}`, guard: f => ['> label-7', '> label-' + f] },
];

// Runs in the page: one sample of every store. Works on runtimes with and without _memStats().
function sampleInPage() {
  /* eslint-disable no-undef */
  var s;
  if (typeof _memStats === 'function') s = _memStats();
  else {
    var live = 0;
    for (var i = 0; i < _arrays.length; i++) if (_arrays[i] !== undefined && _arrays[i] !== null) live++;
    s = { handles: _handles.length - 2, handleIds: _handles.length - 2, arrayIds: _arrays.length, strBytes: ((_wasmMem && _wasmMem._emitBig) || 65536) - 65536, strTop: (_wasmMem && _wasmMem._emitBig) || 65536, strWraps: window.__memWraps || 0, arrays: live, arraySlots: _arrays.length, stale: 0, strErrors: 0, collections: 0 };
  }
  if (s.arrayIds === undefined) s.arrayIds = s.arraySlots;
  s.memBytes = _wasmMem ? _wasmMem.buffer.byteLength : 0;
  return s;
}

async function runProgram(browser, fileUrl, prog) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 300)));
  await page.addInitScript(MEM_LIB);
  await page.route(/^https?:/, route => {
    const url = route.request().url();
    const hit = CDN_MAP.find(([re]) => re.test(url));
    const file = hit && path.join(LIBS, hit[1]);
    if (file && fs.existsSync(file)) return route.fulfill({ body: fs.readFileSync(file), contentType: 'application/javascript' });
    return route.abort();
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return (await cdp.send('Runtime.getHeapUsage')).usedSize; };

  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof compileAndRun === 'function' && typeof EX === 'object');
  await page.evaluate(p => {
    try { closeWelcome(); } catch (e) {}
    const ed = document.getElementById('editor');
    ed.value = p.ex ? EX[p.ex] : p.src;
    ed.dispatchEvent(new Event('input'));
    // animate() must not run frames on its own: every frame is driven (and counted) by this test
    window.requestAnimationFrame = function () { return 0; };
    // Count wrap-arounds of the string allocator on a runtime that does not report them itself
    if (typeof _memStats !== 'function' && typeof _writeBigStr === 'function') {
      const orig = _writeBigStr; let last = 0; window.__memWraps = 0;
      window._writeBigStr = function (enc) { const p = orig(enc); if (p && p < last) window.__memWraps++; if (p) last = p; return p; };
    }
  }, { ex: prog.ex, src: prog.src });
  await page.evaluate(() => compileAndRun()).catch(e => errors.push('run rejected: ' + e.message.slice(0, 300)));
  await page.waitForTimeout(prog.ex ? 1200 : 300);
  const status = await page.evaluate(() => document.getElementById('sTxt').innerText);
  if (status !== 'Done') errors.push('status: ' + status + ' — ' + (await page.evaluate(() => document.getElementById('tab-output').innerText)).slice(0, 400));

  const hasFrame = await page.evaluate(() => !!(window._wi && window._wi.exports.frame));
  if (!hasFrame) errors.push('program has no frame()');

  const samples = [];
  const F = prog.frames || FRAMES;
  const marks = prog.frames ? [0, 1, 1, F] : [0, Math.round(F / 10), Math.round(F / 2), F];
  let trace = 0, done = 0;
  const t0 = Date.now();
  for (const mark of marks) {
    while (done < mark && !errors.length) {
      const n = Math.min(500, mark - done);
      const r = await page.evaluate(n => {
        /* eslint-disable no-undef */
        const f = window._wi.exports.frame;
        try {
          for (let i = 0; i < n; i++) { if (typeof _emitFrame === 'function') _emitFrame(); else f(); }
        } catch (e) { return { err: String((e && e.message) || e) }; }
        // drop the per-call trace lines and the import log (see the header comment)
        let removed = 0;
        const out = document.getElementById('tab-output');
        for (const d of [...out.children]) {
          if (d.tagName === 'DIV' && !d.firstElementChild && /^(→ |< )/.test(d.textContent)) { d.remove(); removed++; }
        }
        if (window._impLog) window._impLog.length = 0;
        return { removed };
      }, n);
      if (r.err) { errors.push('frame threw: ' + r.err); break; }
      trace += r.removed; done += n;
    }
    const s = await page.evaluate(sampleInPage);
    s.frame = mark; s.heap = await heap(); s.trace = trace;
    samples.push(s);
  }
  const ms = Date.now() - t0;

  // Guard: call check() through the same kind of top-level call the IDE's "Tap to call" makes.
  let guardLines = null;
  if (prog.guard && !errors.length) {
    guardLines = await page.evaluate(() => {
      const out = document.getElementById('tab-output');
      const before = out.children.length;
      try { window._wi.exports.check(); } catch (e) { return ['check() threw: ' + e.message]; }
      return [...out.children].slice(before).map(d => d.textContent).filter(t => !/^(→ |< )/.test(t));
    });
  }
  await page.waitForTimeout(50);
  const output = await page.evaluate(() => document.getElementById('tab-output').innerText);
  await page.close();

  let bad = output.split('\n').filter(l => /✗|\bERROR\b|BAD /.test(l));
  const exhausted = bad.filter(l => /out of string memory/.test(l)).length;
  if (prog.kind === 'exhaust') bad = bad.filter(l => !/out of string memory/.test(l));
  return { prog, samples, errors, guardLines, bad, output, ms, exhausted };
}

function judge(r) {
  const fails = r.errors.slice();
  const [, a, , z] = r.samples;
  if (!a || !z) return fails.concat('no samples');
  if (r.bad.length) fails.push('output reports an error: ' + r.bad[0].slice(0, 200));
  if (r.prog.kind === 'steady') {
    if (z.handles > a.handles + 300) fails.push(`live handles grew: ${a.handles} at frame ${a.frame} → ${z.handles} at frame ${z.frame}`);
    if (z.strBytes > a.strBytes + 262144) fails.push(`string bytes grew: ${a.strBytes} → ${z.strBytes}`);
    if (z.strTop > a.strTop + 262144) fails.push(`string area high-water mark grew: ${a.strTop} → ${z.strTop}`);
    if (z.arrays > a.arrays + 64) fails.push(`live Emit arrays grew: ${a.arrays} → ${z.arrays}`);
    if (z.memBytes > a.memBytes) fails.push(`WASM memory grew: ${a.memBytes} → ${z.memBytes}`);
    if (z.strWraps) fails.push('string allocator wrapped around ' + z.strWraps + ' times');
  }
  if (z.stale) fails.push('stale handle uses: ' + z.stale);
  if (r.prog.kind === 'exhaust') {
    if (!z.strErrors) fails.push('the string area was not reported as exhausted');
    if (r.exhausted !== 1) fails.push('expected exactly one "out of string memory" line, saw ' + r.exhausted);
    if (z.strWraps) fails.push('string allocator wrapped around');
    if (z.memBytes > 33554432) fails.push('WASM memory grew past the 32 MB string area: ' + z.memBytes);
  } else if (z.strErrors) fails.push('string area errors: ' + z.strErrors);
  if (r.prog.guard) {
    const want = r.prog.guard(r.prog.frames || FRAMES), got = r.guardLines || [];
    if (JSON.stringify(want) !== JSON.stringify(got)) fails.push('guard read-back mismatch\n        want ' + JSON.stringify(want) + '\n        got  ' + JSON.stringify(got));
  }
  return fails;
}

// Micro-benchmark: interop calls per second in one top-level call.
const BENCH_SRC = `
mut o: js = null
mut list: js = null
mut total = 0
fn visit(v: int, i: int) {
  total += v
}
export fn run() {
  o = memLib.makeObj()
  list = memLib.list(100)
}
export fn callbacks(n: int) int {
  for (let i = 0; i < n / 100; i++) {
    list.forEach(fnRef(visit))
  }
  return total
}
export fn readProps(n: int) int {
  let acc = 0
  for (let i = 0; i < n; i++) {
    let c = o.child
    acc += 1
  }
  return acc
}
export fn readNums(n: int) num {
  let acc = 0.0
  for (let i = 0; i < n; i++) {
    let v: num = o.x
    acc = acc + v
  }
  return acc
}
export fn writeProps(n: int) int {
  for (let i = 0; i < n; i++) {
    o.x = i
  }
  return n
}
export fn calls(n: int) int {
  for (let i = 0; i < n; i++) {
    let c = o.getChild()
  }
  return n
}
export fn freshObjs(n: int) int {
  for (let i = 0; i < n; i++) {
    let c = memLib.fresh()
  }
  return n
}
export fn strings(n: int) int {
  let acc = 0
  for (let i = 0; i < n; i++) {
    let s = "v=" + intToStr(i)
    acc += strLen(s)
  }
  return acc
}`;

async function bench(browser, fileUrl) {
  const page = await browser.newPage();
  await page.addInitScript(MEM_LIB);
  await page.route(/^https?:/, r => r.abort());
  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof compileAndRun === 'function');
  await page.evaluate(src => { try { closeWelcome(); } catch (e) {} const ed = document.getElementById('editor'); ed.value = src; ed.dispatchEvent(new Event('input')); }, BENCH_SRC);
  await page.evaluate(() => compileAndRun());
  await page.waitForTimeout(300);
  const res = await page.evaluate(() => {
    /* eslint-disable no-undef */
    const out = document.getElementById('tab-output');
    // the per-call trace lines dominate everything else; keep them out of the timing
    const add = out.appendChild; out.appendChild = function (n) { return n; };
    const N = 100000, r = {};
    for (const name of ['readProps', 'readNums', 'writeProps', 'calls', 'freshObjs', 'strings', 'callbacks']) {
      const fn = window._wi.exports[name];
      const call = () => (typeof _scopeRun === 'function' ? _scopeRun(fn, [BigInt(N)], true) : fn(BigInt(N)));
      call(); if (window._impLog) window._impLog.length = 0;
      let best = 1e9;
      for (let k = 0; k < 5; k++) { const t = performance.now(); call(); best = Math.min(best, performance.now() - t); if (window._impLog) window._impLog.length = 0; }
      r[name] = Math.round(best * 1e6 / N);
    }
    out.appendChild = add;
    return r;
  });
  await page.close();
  return res;
}

// Direct tests of the scope API the invocation paths use (and that a JSPI wrapper has to call).
async function scopeApi(browser, fileUrl) {
  const page = await browser.newPage();
  await page.addInitScript(MEM_LIB);
  await page.route(/^https?:/, r => r.abort());
  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof compileAndRun === 'function');
  await page.evaluate(() => {
    try { closeWelcome(); } catch (e) {}
    const ed = document.getElementById('editor');
    ed.value = 'mut held: js = null\nmut n = 0\nexport fn run() {\n  held = memLib.tagged(5)\n}\nexport fn bump() {\n  n++\n}';
    ed.dispatchEvent(new Event('input'));
  });
  await page.evaluate(() => compileAndRun());
  await page.waitForTimeout(200);
  const fails = [];
  const check = (ok, what) => { if (!ok) fails.push(what); };
  const has = "h => _handles.has(Number(h) - _hBase)";
  /* eslint-disable no-undef */
  // 1. a suspended invocation (entered, not exited) keeps its handles while complete frames come and go
  await page.evaluate(() => {
    window.T = {}; T.has = h => _handles.has(Number(h) - _hBase);
    T.tS = _scopeEnter();                       // "suspended" call: entered here, exits much later
    T.hS = _handleFor({ who: 'suspended' });
    T.oldObj = { who: 'old' }; T.hOld = _handleFor(T.oldObj);
  });
  await page.waitForTimeout(20);
  const r1 = await page.evaluate(() => {
    const tF = _scopeEnter(true);               // a complete, synchronous frame
    const mine = []; for (let i = 0; i < 300; i++) mine.push(_handleFor({ i }));
    const again = _handleFor(T.oldObj);         // an object the suspended call already holds
    const s = _writeStr('frame string');
    _scopeExit(tF);
    return { mineLeft: mine.filter(T.has).length, suspendedLive: T.has(T.hS), sameId: again === T.hOld, oldLive: T.has(T.hOld), strFreed: !_strBlocks.has(s), scopes: _scN, held: _handleGet(window._wi.exports.__g0.value) && _handleGet(window._wi.exports.__g0.value).tag };
  });
  check(r1.mineLeft === 0, 'frame handles were not released while another call was suspended: ' + r1.mineLeft + ' left');
  check(r1.suspendedLive && r1.oldLive, 'a suspended call lost a handle');
  check(r1.sameId, 'the same object got two handle ids');
  check(r1.strFreed, 'frame string was not released while another call was suspended');
  check(r1.held === 5, 'the global lost its handle: ' + r1.held);
  // 2. a callback nested in a running frame releases nothing the frame holds
  const r2 = await page.evaluate(() => {
    const tF = _scopeEnter(true);
    const outer = _handleFor({ who: 'outer' }), outerStr = _writeStr('outer string');
    const tC = _scopeEnter();
    const inner = []; for (let i = 0; i < 2000; i++) inner.push(_handleFor({ i }));
    _scopeExit(tC);
    const res = { outerLive: T.has(outer), outerStr: _strBlocks.has(outerStr), innerLeft: inner.filter(T.has).length };
    _scopeExit(tF);
    res.outerAfter = T.has(outer);
    return res;
  });
  check(r2.outerLive && r2.outerStr, 'a nested callback released what the enclosing frame holds');
  check(r2.innerLeft === 0, 'a nested callback that made 2000 handles did not release them at its end');
  // 3. the suspended call completes: now its handles go; a second _scopeExit of the same token is ignored
  const r3 = await page.evaluate(() => {
    _scopeExit(T.tS); _scopeExit(T.tS);
    const t = _scopeEnter(true); for (let i = 0; i < 300; i++) _handleFor({ i }); _scopeExit(t);
    return { hS: T.has(T.hS), scopes: _scN, held: _handleGet(window._wi.exports.__g0.value).tag };
  });
  check(!r3.hS, 'handles of a completed suspended call were not released');
  check(r3.scopes === 0, 'scope count is ' + r3.scopes + ' after every scope exited');
  check(r3.held === 5, 'the global lost its handle after a full collection');
  // 4. _scopeRun with a promise-returning function: the scope ends when the promise settles
  const r4 = await page.evaluate(async () => {
    let h, release;
    const p = _scopeRun(() => { h = _handleFor({ who: 'async' }); return new Promise(ok => { release = ok; }); });
    await new Promise(ok => setTimeout(ok, 10));
    const t = _scopeEnter(true); for (let i = 0; i < 300; i++) _handleFor({ i }); _scopeExit(t);
    const during = T.has(h), scopesDuring = _scN;
    release(42); const v = await p; await new Promise(ok => setTimeout(ok, 10));
    const t2 = _scopeEnter(true); for (let i = 0; i < 300; i++) _handleFor({ i }); _scopeExit(t2);
    return { during, scopesDuring, v, after: T.has(h), scopes: _scN };
  });
  check(r4.during && r4.scopesDuring === 1, 'a promise-returning call lost its scope before the promise settled');
  check(r4.v === 42 && !r4.after && r4.scopes === 0, '_scopeRun did not end the scope when the promise settled: ' + JSON.stringify(r4));
  // 5. a call nobody announced: the implicit scope protects it until the synchronous call has returned
  const r5 = await page.evaluate(async () => {
    const h = _handleFor({ who: 'implicit' });                 // no scope active → implicit scope
    const t = _scopeEnter(); for (let i = 0; i < 2000; i++) _handleFor({ i }); _scopeExit(t);  // a callback inside it
    const during = T.has(h);
    await new Promise(ok => setTimeout(ok, 10));
    const t2 = _scopeEnter(true); for (let i = 0; i < 300; i++) _handleFor({ i }); _scopeExit(t2);
    return { during, after: T.has(h) };
  });
  check(r5.during, 'an unannounced call lost a handle to a callback nested in it');
  check(!r5.after, 'the implicit scope never ended');
  // 6. a released id reads as null — never as another object — with exactly one warning line
  const r6 = await page.evaluate(() => {
    const a = _handleGet(T.hS), b = _handleGet(T.hS), c = _handleVal(T.hS);
    const lines = document.getElementById('tab-output').innerText.split('\n').filter(l => /stale js value/.test(l));
    return { a, b, c, lines: lines.length, stale: _memStats().stale, ids: _memStats().handleIds };
  });
  check(r6.a === null && r6.b === null && r6.c === null, 'a released handle id did not read as null');
  check(r6.lines === 1 && r6.stale === 3, 'expected one stale warning line for 3 uses, saw ' + r6.lines + ' / ' + r6.stale);
  await page.close();
  return fails;
}

(async () => {
  const args = process.argv.slice(2);
  const file = path.resolve(args[0] && /\.html$/.test(args[0]) ? args.shift() : path.join(__dirname, '..', 'emit-ide-1_32.html'));
  const only = args;
  const fileUrl = 'file://' + file;
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc'] });
  const progs = PROGRAMS.filter(p => !only.length || only.includes(p.name));
  let failed = 0;
  const kb = n => (n / 1024).toFixed(0) + 'K';
  console.log(`${FRAMES} frames per program${BASELINE ? '  (BASELINE: measuring only)' : ''}`);
  console.log('program                 frame  handles   ids-issued  strBytes   strTop  wraps    arrays/ids  wasmMem  jsHeap   trace');
  for (const prog of progs) {
    const r = await runProgram(browser, fileUrl, prog);
    for (const s of r.samples) {
      console.log('  ' + prog.name.padEnd(22) + String(s.frame).padStart(6) + String(s.handles).padStart(9) + String(s.handleIds).padStart(13) + kb(s.strBytes).padStart(10) + kb(s.strTop).padStart(9) + String(s.strWraps || 0).padStart(7) + (s.arrays + '/' + s.arrayIds).padStart(14) + kb(s.memBytes).padStart(9) + kb(s.heap).padStart(8) + String(s.trace).padStart(8));
    }
    const fails = judge(r);
    if (r.guardLines) console.log('      guard read-back: ' + JSON.stringify(r.guardLines));
    if (BASELINE) console.log('      (baseline) ' + (fails.length ? 'would fail: ' + fails.join(' | ') : 'would pass') + `   [${r.ms} ms]`);
    else if (fails.length) { failed++; console.log('FAIL  ' + prog.name + `   [${r.ms} ms]\n      ` + fails.join('\n      ')); }
    else console.log('PASS  ' + prog.name + `   [${r.ms} ms]`);
    if (process.env.VERBOSE) console.log(r.output.replace(/^/gm, '      | ').slice(0, 4000));
  }
  let extra = 0, extraFailed = 0;
  if (!BASELINE && !only.length) {
    extra = 1;
    const fails = await scopeApi(browser, fileUrl);
    if (fails.length) { extraFailed = 1; console.log('FAIL  scope-api\n      ' + fails.join('\n      ')); }
    else console.log('PASS  scope-api');
  }
  if (process.env.BENCH) {
    const b = await bench(browser, fileUrl);
    console.log('\nmicro-benchmark, ns per iteration (best of 5 runs of 100000): ' + JSON.stringify(b));
  }
  await browser.close();
  if (BASELINE) { console.log('\nbaseline measured (no assertions)'); process.exit(0); }
  console.log('\n' + (progs.length + extra - failed - extraFailed) + '/' + (progs.length + extra) + ' memory tests passed');
  process.exit(failed || extraFailed ? 1 : 0);
})();

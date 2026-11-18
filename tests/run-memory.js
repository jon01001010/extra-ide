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
// Nothing is cleaned up by the test: the "→ call(args)" trace lines and the import log are capped by the
// runtime itself, so the JS heap column is the real figure. "out" is the number of nodes in the Output tab.
// Programs with `await` run on real JSPI (WebAssembly.Suspending / promising); they are driven through a
// gate promise (memLib.gate) or real button clicks instead of the frame loop — see `drive`.
//
// Exit code 0 only when every assertion holds:
//   steady programs  live handles / string bytes / arrays at the last frame are within a small margin
//                    of the values at frame FRAMES/10, and WASM memory did not grow in between
//   every program    no red "✗" line (so no stale-handle warning, no string-area error), no page error
//   guard programs   every value stored in globals / Emit arrays / JS objects reads back correctly
//   string-exhaustion  a single call that keeps more than 32 MB of strings in use gets one red error line
//                    and "" — no string a global points to is overwritten — and the program carries on
//   await programs   values held across an await in locals, on the operand stack (awaits inside expressions),
//                    globals, arr variables and JS objects read back correctly although collections ran while
//                    the call was suspended; await loops at any call depth (helpers 1–3 calls deep, recursion,
//                    try/catch/finally, two suspended calls at once, async callbacks called from a frame) stay
//                    bounded, and the runtime reports the suspended calls as parked; a call whose frames do not
//                    fit on the shadow stack is not parked (and still reads its values back intact); between
//                    calls the shadow stack is empty
//   Output tab       the number of nodes stays bounded (trace lines are capped), program output is kept
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
window.memGate = { budget: 0, passed: 0, waiting: null };
// await sleep(ms) with a very long ms never fires on its own: the test fires those timers when it wants to
(function () { var st = window.setTimeout; window.__longTimers = []; window.setTimeout = function (f, ms) { if (ms >= 100000) { window.__longTimers.push(f); return 0; } return st.apply(window, arguments); }; })();
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
    fail: function (n) { return Promise.reject(new Error('fail ' + n)); },
    tick: function (v) { return Promise.resolve(v === undefined ? 1 : v); },
    // gate(): resolves at once while the test has granted iterations, otherwise when it grants more
    gate: function () { var g = window.memGate; g.passed++; if (g.budget > 0) { g.budget--; return Promise.resolve(g.passed); } return new Promise(function (ok) { g.waiting = function () { g.waiting = null; g.budget--; ok(g.passed); }; }); },
    sum: function (a) { var t = 0; for (var i = 0; i < a.length; i++) t += a[i]; return t; },
    isArray: function (a) { return Array.isArray(a) ? 1 : 0; },
    boom: function (n) { throw new Error('boom ' + n); },
    callZero: function () { if (window.memLibCb) window.memLibCb(); },
    // memory regions: every string block lies above the heap base the program declared (and that base is past 64 KB)
    strsAboveHeap: function () { var ok = 1; _strBlocks.forEach(function (z, a) { if (a < _strHeapBase) ok = 0; }); return (_strHeapBase > 65536 && ok) ? 1 : 0; },
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
  { name: 'member-calls', kind: 'steady', keepLine: '> first line', src: `
mut o: js = null
mut cnt = 0
export fn run() {
  printStr("first line")
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
  let rawId: int = newArray(3)
  box.inner = rawId
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

  // (h0) memory regions: struct / int regions updated every frame while strings and handles churn; the collector
  //      must neither treat region bytes as roots nor place a string inside a region (they lie below the heap base)
  { name: 'regions-guard', kind: 'steady', src: `
struct P { x: num, n: int, tag: u8 }
region ps: P[256]
region hist: int[1000]
mut n = 0
export fn run() {
  for (let i = 0; i < ps.length; i++) {
    ps[i].x = i * 0.5
    ps[i].n = i
    ps[i].tag = i
  }
  animate()
}
export fn frame() {
  n++
  let s = "frame " + n + memLib.big(100)
  let o = memLib.fresh()
  hist[n % 1000] += 1
  with ps[n % 256] as p { p.n += 256 }
}
export fn check() {
  let bad = 0
  let total = 0
  let nsum = 0
  for (let i = 0; i < ps.length; i++) {
    if (ps[i].tag != i || ps[i].x != i * 0.5) { bad++ }
    nsum += ps[i].n
  }
  for (let i = 0; i < hist.length; i++) { total += hist[i] }
  print(bad)
  print(total)
  print(nsum)
  print(toInt(memLib.strsAboveHeap()))
}`, guard: f => ['> 0', '> ' + f, '> ' + (32640 + 256 * f), '> 1'] },

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

  // ── await (real JSPI) ──
  // (j) a frame function that awaits; locals of every kind are held across the await
  { name: 'await-frame', kind: 'steady', drive: 'asyncFrames', src: `
mut n = 0
mut bad = 0
mut caught = 0
mut box: js = null
mut keep: js = null
export fn run() {
  box = emptyObj()
  animate()
}
export fn frame() {
  n++
  let o = memLib.tagged(n)
  let s = "f" + intToStr(n)
  let xs = [n, n + 1]
  let junk = memLib.fresh()
  box.cur = memLib.tagged(n + 7)
  if (n % 100 == 1) { keep = memLib.tagged(n) }
  let r = await memLib.tick(n)
  let t: int = o.tag
  if (t != n) { bad++ }
  if (!strEq(s, "f" + intToStr(n))) { bad++ }
  if (xs[1] != n + 1) { bad++ }
  let rr: int = r
  if (rr != n) { bad++ }
  let c = box.cur
  let ct: int = c.tag
  if (ct != n + 7) { bad++ }
  // an awaited object comes back as the same object; a rejected await lands in catch
  let same = await memLib.tick(o)
  let st: int = same.tag
  if (st != n) { bad++ }
  try {
    await memLib.fail(n)
    bad++
  } catch (e) {
    let m: str = e.message
    if (strEq(m, "fail " + intToStr(n))) { caught++ }
  }
  let t2: int = o.tag
  if (t2 != n) { bad++ }
}
export fn check() {
  if (n > 0) { doCheck() }
}
fn doCheck() {
  print(n)
  print(bad)
  let k: int = keep.tag
  print(k)
  print(caught)
}`, guard: f => ['> ' + f, '> 0', '> ' + (Math.floor((f - 1) / 100) * 100 + 1), '> ' + f] },

  // (k) the idiomatic animation: one call that loops with an await as a statement. Other calls (churn) run
  //     and collect while it is suspended; its locals must survive, and what it drops must be released.
  { name: 'await-loop', kind: 'steady', drive: 'gate', parked: 1, src: `
mut n = 0
mut bad = 0
mut box: js = null
mut held: js = null
mut label: str = ""
mut churned = 0
export fn run() {
  box = emptyObj()
  let first = memLib.tagged(4242)
  let firstStr: str = memLib.label(4242)
  let ring = [0, 0, 0]
  while (true) {
    n++
    let o = memLib.tagged(n)
    let s = "i" + intToStr(n)
    let xs = [n, n + 1]
    let junk = memLib.fresh()
    let junkStr: str = memLib.big(100)
    box.cur = memLib.tagged(n + 7)
    ring[n % 3] = n
    if (n % 500 == 1) {
      held = memLib.tagged(n)
      label = "held " + intToStr(n)
    }
    let g: int = await memLib.gate()
    let t: int = o.tag
    if (t != n) { bad++ }
    if (!strEq(s, "i" + intToStr(n))) { bad++ }
    if (xs[0] != n) { bad++ }
    if (ring[n % 3] != n) { bad++ }
    if (g != n) { bad++ }
    let ft: int = first.tag
    if (ft != 4242) { bad++ }
    if (!strEq(firstStr, "label-4242")) { bad++ }
    let c = box.cur
    let ct: int = c.tag
    if (ct != n + 7) { bad++ }
  }
}
export fn churn() {
  churned++
  let i = 0
  while (i < 200) {
    let o = memLib.fresh()
    let s = "churn " + intToStr(i)
    i++
  }
}
export fn check() {
  if (n > 1) { doCheck() }
}
fn doCheck() {
  print(n)
  print(bad)
  let h: int = held.tag
  print(h)
  printStr(label)
}`, guard: f => { const h = Math.floor(f / 500) * 500 + 1; return ['> ' + (f + 1), '> 0', '> ' + h, '> held ' + h]; } },

  // (l) the same loop inside a helper function: the suspended stack is run() + loop(); both frames are on the
  //     shadow stack, so the call is parked and what each iteration drops is released
  { name: 'await-loop-in-helper', kind: 'steady', drive: 'gate', parked: 1, src: `
mut n = 0
mut bad = 0
fn loop() {
  while (true) {
    n++
    let o = memLib.tagged(n)
    let s = "i" + intToStr(n)
    let xs = [n, n + 1]
    await memLib.gate()
    let t: int = o.tag
    if (t != n) { bad++ }
    if (!strEq(s, "i" + intToStr(n))) { bad++ }
    if (xs[0] != n) { bad++ }
  }
}
export fn run() {
  loop()
}
export fn churn() {
  let i = 0
  while (i < 200) {
    let o = memLib.fresh()
    i++
  }
}
export fn check() {
  if (n > 1) { doCheck() }
}
fn doCheck() {
  print(n)
  print(bad)
}`, guard: f => ['> ' + (f + 1), '> 0'] },

  // ── await at any depth (the shadow stack): every shape below is driven like (k) — iterations granted through
  //    memLib.gate(), and between batches churn() replaces the globals and makes garbage, so full collections run
  //    while the loop is suspended. Values held only in locals and on the operand stack must read back intact,
  //    and live handles / strings / arrays must stay bounded. ──
  // (p) the loop two calls deep: run() → outer() → loop(); every frame holds handles, strings and arrays (and
  //     js objects inside an array) that only it holds; loop() returns every 50 iterations and outer() checks its own
  { name: 'await-loop-depth-2', kind: 'steady', drive: 'gate', parked: 1, src: `
mut n = 0
mut bad = 0
mut box: js = null
fn loop(tagBase: int, keepO: js, keepS: str) int {
  let mine = memLib.tagged(tagBase)
  let mineS = "loop " + intToStr(tagBase)
  let ring = [0, 0, 0]
  let k = 0
  while (k < 50) {
    k++
    n++
    let o = memLib.tagged(n)
    let s = "i" + intToStr(n)
    let xs = [n, n + 1]
    let objs = newArray(2)
    objs[0] = o
    objs[1] = memLib.tagged(n + 1)
    let junk = memLib.fresh()
    let junkStr: str = memLib.big(100)
    box = memLib.tagged(n + 7)
    ring[n % 3] = n
    let g: int = await memLib.gate()
    let t: int = o.tag
    if (t != n) { bad++ }
    if (!strEq(s, "i" + intToStr(n))) { bad++ }
    if (xs[1] != n + 1) { bad++ }
    if (ring[n % 3] != n) { bad++ }
    if (g != n) { bad++ }
    let o0: js = objs[0]
    let t0: int = o0.tag
    if (t0 != n) { bad++ }
    let o1: js = objs[1]
    let t1: int = o1.tag
    if (t1 != n + 1) { bad++ }
    let mt: int = mine.tag
    if (mt != tagBase) { bad++ }
    if (!strEq(mineS, "loop 41")) { bad++ }
    let kt: int = keepO.tag
    if (kt != 40) { bad++ }
    if (!strEq(keepS, "outer 40")) { bad++ }
  }
  return k
}
fn outer() {
  let o = memLib.tagged(40)
  let s = "outer " + intToStr(40)
  let mineO = memLib.tagged(42)
  let mineS = "only outer " + intToStr(42)
  let xs = [40, 41]
  let objs = newArray(1)
  objs[0] = memLib.tagged(43)
  while (true) {
    let r = loop(41, o, s)
    if (r != 50) { bad++ }
    let t: int = mineO.tag
    if (t != 42) { bad++ }
    if (!strEq(mineS, "only outer 42")) { bad++ }
    if (xs[1] != 41) { bad++ }
    let a0: js = objs[0]
    let t0: int = a0.tag
    if (t0 != 43) { bad++ }
  }
}
export fn run() {
  let top = memLib.tagged(1)
  outer()
  let t: int = top.tag
  print(t)
}
export fn churn() {
  box = memLib.tagged(-1)
  let i = 0
  while (i < 200) {
    let o = memLib.fresh()
    let s = "churn " + intToStr(i)
    let a = [i, i]
    i++
  }
}
export fn check() {
  if (n > 1) { doCheck() }
}
fn doCheck() {
  print(n)
  print(bad)
}`, guard: f => ['> ' + (f + 1), '> 0'] },

  // (q) three calls deep, and awaits inside expressions: the values evaluated before an await (a global read,
  //     a function result) are on the operand stack while the call is suspended; churn() replaces the globals
  { name: 'await-loop-depth-3-expr', kind: 'steady', drive: 'gate', parked: 1, src: `
mut n = 0
mut bad = 0
mut box: js = null
mut lab: str = ""
mut arrG: arr = 0
fn tagOf(o: js) int {
  let t: int = o.tag
  return t
}
fn triple(a: js, s: str, xs: arr, b: js) int {
  let x: int = a.tag
  let y: int = b
  if (!strEq(s, "L" + intToStr(x))) { return -1 }
  if (xs[0] != x * 3) { return -2 }
  return x * 1000 + y
}
fn cat(a: str, b: js) str {
  let t: int = b
  return a + "/" + intToStr(t)
}
fn first(xs: arr, b: js) int {
  let t: int = b
  return xs[0] + t
}
fn f(a: int, b: js) int {
  let t: int = b
  return a + t
}
fn g(o: js) int {
  let t: int = o.tag
  return t
}
fn step() {
  n++
  box = memLib.tagged(n)
  lab = "L" + intToStr(n)
  arrG = [n * 3, 0]
  // the global values are only on the operand stack while the call waits; churn() replaces them meanwhile
  let p = triple(box, lab, arrG, await memLib.gate())
  if (p != n * 1000 + n) { bad++ }
  let c = cat("pre" + intToStr(n), await memLib.tick(n))
  if (!strEq(c, "pre" + intToStr(n) + "/" + intToStr(n))) { bad++ }
  let fx = first([n * 3, 0], await memLib.tick(1))
  if (fx != n * 3 + 1) { bad++ }
  // let x = f(g(await p), await q)
  let x = f(g(await memLib.tick(memLib.tagged(n))), await memLib.tick(5))
  if (x != n + 5) { bad++ }
  // a string concatenation whose left side waits on the stack, and an async call inside an expression
  let s = "s" + intToStr(n) + ":" + intToStr(tagOf(await memLib.tick(memLib.tagged(n + 2))))
  if (!strEq(s, "s" + intToStr(n) + ":" + intToStr(n + 2))) { bad++ }
  let y = tagOf(memLib.tagged(n)) + depthTwo(memLib.tagged(n))
  if (y != n + n + 1) { bad++ }
}
fn depthTwo(o: js) int {
  let t: int = await memLib.tick(o.tag)
  return t + 1
}
fn middle() {
  let keep = memLib.tagged(-5)
  while (true) {
    step()
    let k: int = keep.tag
    if (k != -5) { bad++ }
  }
}
export fn run() {
  middle()
}
export fn churn() {
  box = memLib.tagged(-1)
  lab = "churned"
  arrG = [-1, -1]
  let i = 0
  while (i < 200) {
    let o = memLib.fresh()
    let s = "churn " + intToStr(i)
    i++
  }
}
export fn check() {
  if (n > 1) { doCheck() }
}
fn doCheck() {
  print(n)
  print(bad)
}`, guard: f => ['> ' + (f + 1), '> 0'] },

  // (r) try / catch / finally around awaits; an error thrown in a called function after its await and caught
  //     by the caller; a rejected await caught; values held across all of them
  { name: 'await-try-finally', kind: 'steady', drive: 'gate', parked: 1, src: `
mut n = 0
mut bad = 0
mut caught = 0
mut fin = 0
fn thrower(k: int) int {
  let mine = memLib.tagged(k)
  await memLib.gate()
  let t: int = mine.tag
  if (t != k) { bad++ }
  throw "boom " + intToStr(k)
  return 0
}
fn loop() {
  while (true) {
    n++
    let o = memLib.tagged(n)
    let s = "t" + intToStr(n)
    let xs = [n, n]
    try {
      let r = thrower(n)
      bad++
    } catch (e) {
      let m: str = e.message
      if (strEq(m, "boom " + intToStr(n))) { caught++ } else { bad++ }
    }
    try {
      await memLib.fail(n)
      bad++
    } catch (e) {
      let m: str = e.message
      if (!strEq(m, "fail " + intToStr(n))) { bad++ }
    } finally {
      fin++
    }
    let t: int = o.tag
    if (t != n) { bad++ }
    if (!strEq(s, "t" + intToStr(n))) { bad++ }
    if (xs[1] != n) { bad++ }
  }
}
export fn run() {
  loop()
}
export fn churn() {
  let i = 0
  while (i < 200) {
    let o = memLib.fresh()
    i++
  }
}
export fn check() {
  if (n > 1) { doCheck() }
}
fn doCheck() {
  print(n)
  print(bad)
  print(caught)
  print(fin)
}`, guard: f => ['> ' + (f + 1), '> 0', '> ' + f, '> ' + f] },

  // (s) recursion with awaits: ten frames of the same function, each holding its own values
  { name: 'await-recursion', kind: 'steady', drive: 'gate', parked: 1, src: `
mut n = 0
mut bad = 0
fn rec(d: int, o: js, s: str) int {
  let mine = memLib.tagged(d)
  let mineS = "d" + intToStr(d)
  let xs = [d, d]
  let r = 0
  if (d == 0) {
    n++
    let junk = memLib.fresh()
    r = await memLib.gate()
  } else {
    r = rec(d - 1, memLib.tagged(d * 100), "s" + intToStr(d))
  }
  let t: int = mine.tag
  if (t != d) { bad++ }
  if (!strEq(mineS, "d" + intToStr(d))) { bad++ }
  if (xs[1] != d) { bad++ }
  let ot: int = o.tag
  if (ot != (d + 1) * 100) { bad++ }
  if (!strEq(s, "s" + intToStr(d + 1))) { bad++ }
  return r
}
export fn run() {
  while (true) {
    let r = rec(9, memLib.tagged(1000), "s10")
    if (r != n) { bad++ }
  }
}
export fn churn() {
  let i = 0
  while (i < 200) {
    let o = memLib.fresh()
    i++
  }
}
export fn check() {
  if (n > 1) { doCheck() }
}
fn doCheck() {
  print(n)
  print(bad)
}`, guard: f => ['> ' + (f + 1), '> 0'] },

  // (t) two suspended invocations at once, each holding different values: second() waits in a long sleep
  //     (ended by the test at the end) while run()'s helper loop goes on
  { name: 'await-two-invocations', kind: 'steady', drive: 'gate', parked: 2, src: `
mut n = 0
mut bad = 0
fn loop(o: js) {
  while (true) {
    n++
    let mine = memLib.tagged(n)
    let s = "r" + intToStr(n)
    await memLib.gate()
    let t: int = mine.tag
    if (t != n) { bad++ }
    if (!strEq(s, "r" + intToStr(n))) { bad++ }
    let ot: int = o.tag
    if (ot != 11) { bad++ }
  }
}
export fn run() {
  loop(memLib.tagged(11))
}
fn waitLong(o: js, s: str, xs: arr) {
  let mine = memLib.tagged(22)
  await sleep(1000000)
  let t: int = o.tag
  print(t)
  printStr(s)
  print(xs[1])
  let mt: int = mine.tag
  print(mt)
}
export fn second() {
  let objs = newArray(1)
  objs[0] = memLib.tagged(33)
  waitLong(memLib.tagged(21), "second " + intToStr(2), [5, 6])
  let o: js = objs[0]
  let t: int = o.tag
  print(t)
}
export fn churn() {
  let i = 0
  while (i < 200) {
    let o = memLib.fresh()
    i++
  }
}
export fn check() {
  if (n > 1) { doCheck() }
}
fn doCheck() {
  print(n)
  print(bad)
}`, finish: ['> 21', '> second 2', '> 6', '> 22', '> 33'], guard: f => ['> ' + (f + 1), '> 0'] },

  // (u) an async callback called from a frame: frame() hands memLib.each two callbacks that await; they are
  //     suspended while frame() ends and later frames collect
  { name: 'await-callback-from-frame', kind: 'steady', src: `
mut n = 0
mut bad = 0
mut done = 0
fn onItem(o: js) {
  let mine = memLib.tagged(n)
  let my = n
  let s = "cb" + intToStr(n)
  let xs = [n, n]
  let k: int = o.n
  let back = await memLib.tick(o)
  let t: int = mine.tag
  if (t != my) { bad++ }
  if (!strEq(s, "cb" + intToStr(my))) { bad++ }
  if (xs[1] != my) { bad++ }
  let k2: int = back.n
  if (k2 != k) { bad++ }
  done++
}
export fn run() {
  animate()
}
export fn frame() {
  n++
  let junk = memLib.fresh()
  memLib.each(fnRef(onItem))
}
export fn check() {
  if (n > 1) { doCheck() }
}
fn doCheck() {
  print(n)
  print(bad)
  print(done)
}`, guard: f => ['> ' + f, '> 0', '> ' + 2 * f] },

  // (v) the shadow stack overflows: every even iteration waits 150 calls deep, more frames than fit below 64 KB.
  //     Such a suspension is not parked (nothing is released while it waits — safe; the batches end there, so
  //     churn() runs and collects during it), every odd iteration waits 3 calls deep and is parked again (what
  //     the deep ones made is released then); the values of every frame read back intact either way
  { name: 'await-recursion-overflow', kind: 'steady', drive: 'gate', parked: 0, frames: 401, marks: [0, 41, 201, 401], src: `
mut n = 0
mut bad = 0
mut deepSeen = 0
fn rec(d: int, o: js, s: str) int {
  let mine = memLib.tagged(d)
  let mineS = "d" + intToStr(d)
  let r = 0
  if (d == 0) {
    let junk = memLib.fresh()
    let sp: int = _ssSP()
    if (sp > 12280) { deepSeen++ }
    r = await memLib.gate()
  } else {
    r = rec(d - 1, memLib.tagged(d * 100), "s" + intToStr(d))
  }
  let t: int = mine.tag
  if (t != d) { bad++ }
  if (!strEq(mineS, "d" + intToStr(d))) { bad++ }
  let ot: int = o.tag
  if (ot != (d + 1) * 100) { bad++ }
  if (!strEq(s, "s" + intToStr(d + 1))) { bad++ }
  return r
}
export fn run() {
  while (true) {
    n++
    let depth = 3
    if (n % 2 == 0) { depth = 150 }
    let r = rec(depth, memLib.tagged((depth + 1) * 100), "s" + intToStr(depth + 1))
    if (r != n) { bad++ }
  }
}
export fn churn() {
  let i = 0
  while (i < 200) {
    let o = memLib.fresh()
    i++
  }
}
export fn check() {
  if (n > 1) { doCheck() }
}
fn doCheck() {
  print(n)
  print(bad)
  print(deepSeen)
}`, guard: f => ['> ' + (f + 1), '> 0', '> ' + (f + 1) / 2] },

  // (m) a button handler that awaits, clicked many times while run() is suspended in a long `await sleep`
  { name: 'await-button-during-sleep', kind: 'steady', drive: 'clicks', parked: 1, src: `
mut clicks = 0
mut done = 0
mut bad = 0
mut held: js = null
export fn run() {
  button("go", 1)
  held = memLib.tagged(5)
  let mine = memLib.tagged(6)
  let mineStr: str = memLib.label(6)
  let xs = [61, 62]
  await sleep(1000000)
  let t: int = mine.tag
  print(t)
  printStr(mineStr)
  print(xs[1])
  let h: int = held.tag
  print(h)
}
export fn onclick_1() {
  clicks++
  let my = clicks
  let o = memLib.tagged(my)
  let s = "c" + intToStr(my)
  let junk = memLib.fresh()
  await memLib.tick()
  let t: int = o.tag
  if (t != my) { bad++ }
  if (!strEq(s, "c" + intToStr(my))) { bad++ }
  done++
}
export fn check() {
  if (clicks > 0) { doCheck() }
}
fn doCheck() {
  print(clicks)
  print(done)
  print(bad)
}`, finish: ['> 6', '> label-6', '> 62', '> 5'], guard: f => ['> ' + f, '> ' + f, '> 0'] },

  // (n) try / catch in every frame, after and between many collections
  { name: 'try-catch-frame', kind: 'steady', src: `
mut n = 0
mut caught = 0
mut bad = 0
mut last: js = null
export fn run() {
  animate()
}
export fn frame() {
  n++
  let o = memLib.tagged(n)
  let junk = memLib.fresh()
  try {
    memLib.boom(n)
    bad++
  } catch (e) {
    let m: str = e.message
    if (strEq(m, "boom " + intToStr(n))) { caught++ }
    last = e
  }
  let t: int = o.tag
  if (t != n) { bad++ }
}
export fn check() {
  if (n > 0) { doCheck() }
}
fn doCheck() {
  print(caught)
  print(bad)
  let m: str = last.message
  printStr(m)
}`, guard: f => ['> ' + f, '> 0', '> boom ' + f] },

  // (o) typed arrays: xs[i], xs.push, xs.pop, xs.length, an array handed to JS — per frame, and kept in globals
  { name: 'arr-typed', kind: 'steady', src: `
mut keep: arr = 0
mut keepNums: numarr = 0
mut nested: arr = 0
mut n = 0
mut bad = 0
mut total = 0
export fn run() {
  keep = newArray(4)
  keepNums = [1.5, 2.5]
  nested = newArray(2)
  keep[0] = 31337
  nested[0] = keep
  animate()
}
export fn frame() {
  n++
  // small values only: an int element between 1024 and 48640 is taken for a string-literal address
  // when an array is converted for JS (a rule of toJsArray that is older than this test)
  let m = n % 100
  let xs = [m, m + 1, m + 2]
  xs.push(m + 3)
  let v = xs[1]
  if (v != m + 1) { bad++ }
  if (xs.length != 4) { bad++ }
  let s: int = memLib.sum(xs)
  if (s != m * 4 + 6) { bad++ }
  let isA: int = memLib.isArray(xs)
  if (isA != 1) { bad++ }
  let p = xs.pop()
  if (p != m + 3) { bad++ }
  let fs = [0.5, 1.5]
  fs.push(2.5)
  total += xs.length
  if (n % 1000 == 0) {
    keep = [n, n * 2]
    keepNums.push(0.25)
  }
}
export fn check() {
  if (n >= 1000) { doCheck() }
}
fn doCheck() {
  print(bad)
  print(keep[1])
  print(keep.length)
  print(keepNums.length)
  print(total)
}`, guard: f => ['> 0', '> ' + Math.floor(f / 1000) * 2000, '> 2', '> ' + (2 + Math.floor(f / 1000)), '> ' + 3 * f] },

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
  s.out = document.getElementById('tab-output').getElementsByTagName('*').length;
  s.log = window._impLog ? window._impLog.length : 0;
  // the shadow stack (await): between calls nothing is on it
  s.ssSP = (typeof _ssSP === 'function' && typeof _ssOn === 'function' && _ssOn()) ? _ssSP() : 0;
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
  // Frames are traced only for the first few (_frameTraceMax); the trace-cap check needs every frame traced.
  if (prog.keepLine) await page.evaluate(() => { if (typeof _frameTraceMax !== 'undefined') window._frameTraceMax = 1e9; });
  await page.evaluate(() => compileAndRun()).catch(e => errors.push('run rejected: ' + e.message.slice(0, 300)));
  await page.waitForTimeout(prog.ex ? 1200 : 300);
  const status = await page.evaluate(() => document.getElementById('sTxt').innerText);
  if (status !== 'Done') errors.push('status: ' + status + ' — ' + (await page.evaluate(() => document.getElementById('tab-output').innerText)).slice(0, 400));

  const drive = prog.drive || 'frames';
  const hasFrame = await page.evaluate(() => !!(window._wi && window._wi.exports.frame));
  if (!hasFrame && (drive === 'frames' || drive === 'asyncFrames')) errors.push('program has no frame()');

  const samples = [];
  const F = prog.frames || FRAMES;
  const marks = prog.marks || (prog.frames ? [0, 1, 1, F] : [0, Math.round(F / 10), Math.round(F / 2), F]);
  let done = 0;
  const t0 = Date.now();
  for (const mark of marks) {
    while (done < mark && !errors.length) {
      const n = Math.min(500, mark - done);
      const r = await page.evaluate(async ({ n, drive }) => {
        /* eslint-disable no-undef */
        const turn = () => new Promise(ok => setTimeout(ok, 0));
        try {
          if (drive === 'frames') {
            for (let i = 0; i < n; i++) _emitFrame();
          } else if (drive === 'asyncFrames') {
            // an async frame() finishes in a later microtask: wait for it before starting the next one
            for (let i = 0; i < n; i++) { _emitFrame(); while (_frameBusy) await Promise.resolve(); }
          } else if (drive === 'gate') {
            // let the suspended loop run n iterations, then run other calls while it is suspended again
            const g = window.memGate; g.budget += n; if (g.waiting) g.waiting();
            while (g.budget > 0 || !g.waiting) await turn();
            for (let i = 0; i < 3; i++) window._emitCallExport(window._wi, 'churn', []);
          } else if (drive === 'clicks') {
            const b = document.querySelector('#tab-output button');
            for (let i = 0; i < n; i++) { b.click(); if (i % 50 === 49) await turn(); }
            await turn();
          }
        } catch (e) { return { err: String((e && e.message) || e) }; }
        return {};
      }, { n, drive });
      if (r.err) { errors.push('frame threw: ' + r.err); break; }
      done += n;
    }
    const s = await page.evaluate(sampleInPage);
    s.frame = mark; s.heap = await heap();
    samples.push(s);
  }
  const ms = Date.now() - t0;

  // Guard: call check() through the same kind of top-level call the IDE's "Tap to call" makes.
  let guardLines = null, finishLines = null;
  if (prog.guard && !errors.length) {
    // what the program prints from here on (the trace cap removes old nodes, so count from a marker node)
    const printed = () => page.evaluate(() => {
      const out = document.getElementById('tab-output'), all = [...out.children];
      return all.slice(all.indexOf(window.__mark) + 1).map(d => d.textContent).filter(t => !/^(→ |< |\[click )/.test(t));
    });
    const markHere = () => page.evaluate(() => { window.__mark = document.createElement('div'); window.__mark.style.display = 'none'; document.getElementById('tab-output').appendChild(window.__mark); });
    if (prog.finish) {
      // end the long sleep: the suspended run() resumes and prints what it held in locals all along
      await markHere();
      await page.evaluate(() => { window.__longTimers.splice(0).forEach(f => f()); });
      await page.waitForTimeout(100);
      finishLines = await printed();
    }
    await markHere();
    const threw = await page.evaluate(() => { try { window._emitCallExport(window._wi, 'check', []); } catch (e) { return 'check() threw: ' + e.message; } return null; });
    guardLines = threw ? [threw] : await printed();
  }
  await page.waitForTimeout(50);
  const output = await page.evaluate(() => document.getElementById('tab-output').innerText);
  await page.close();

  let bad = output.split('\n').filter(l => /✗|\bERROR\b|BAD /.test(l));
  const exhausted = bad.filter(l => /out of string memory/.test(l)).length;
  if (prog.kind === 'exhaust') bad = bad.filter(l => !/out of string memory/.test(l));
  return { prog, samples, errors, guardLines, finishLines, bad, output, ms, exhausted };
}

function judge(r) {
  const fails = r.errors.slice();
  const [, a, , z] = r.samples;
  if (!a || !z) return fails.concat('no samples');
  if (r.bad.length) fails.push('output reports an error: ' + r.bad[0].slice(0, 200));
  if (z.out > a.out + 400) fails.push(`Output tab grew: ${a.out} nodes at frame ${a.frame} → ${z.out} at frame ${z.frame}`);
  if (z.log > 2000) fails.push('import log grew to ' + z.log + ' entries');
  if (r.prog.finish && JSON.stringify(r.prog.finish) !== JSON.stringify(r.finishLines)) fails.push('values held in locals across the long await: want ' + JSON.stringify(r.prog.finish) + ' got ' + JSON.stringify(r.finishLines));
  if (r.prog.keepLine && !BASELINE) {
    // 100,000 trace lines later: the program's own first output line is still there, with one marker line
    const lines = r.output.split('\n');
    if (!lines.includes(r.prog.keepLine)) fails.push('program output line "' + r.prog.keepLine + '" was dropped from the Output tab');
    const marks = lines.filter(l => /earlier trace lines dropped/.test(l));
    if (marks.length !== 1) fails.push('expected one "earlier trace lines dropped" line, saw ' + marks.length);
  }
  if (r.prog.ex === 'babylon' && !BASELINE) {
    // By default only the first frames are traced: one note, and no per-frame trace lines piling up
    const lines = (r.output || '').split('\n');
    const notes = lines.filter(l => /frame\(\) keeps running/.test(l)).length;
    const rot = lines.filter(l => /\.rotate\(/.test(l)).length;
    if (notes !== 1) fails.push('expected one "frame() keeps running" note, saw ' + notes);
    if (rot > 10) fails.push('frame calls are still traced after the first frames: ' + rot + ' .rotate( lines');
  }
  if (r.prog.parked !== undefined && z.parked !== r.prog.parked) fails.push('expected ' + r.prog.parked + ' suspended call(s) with known locals (parked), the runtime reports ' + z.parked);
  if (r.prog.kind === 'steady') {
    if (z.handles > a.handles + 300) fails.push(`live handles grew: ${a.handles} at frame ${a.frame} → ${z.handles} at frame ${z.frame}`);
    if (z.strBytes > a.strBytes + 262144) fails.push(`string bytes grew: ${a.strBytes} → ${z.strBytes}`);
    if (z.strTop > a.strTop + 262144) fails.push(`string area high-water mark grew: ${a.strTop} → ${z.strTop}`);
    if (z.arrays > a.arrays + 64) fails.push(`live Emit arrays grew: ${a.arrays} → ${z.arrays}`);
    if (z.memBytes > a.memBytes) fails.push(`WASM memory grew: ${a.memBytes} → ${z.memBytes}`);
    if (z.strWraps) fails.push('string allocator wrapped around ' + z.strWraps + ' times');
  }
  if (z.stale) fails.push('stale handle uses: ' + z.stale);
  if (z.ssSP) fails.push('the shadow stack is not empty between calls: SP = ' + z.ssSP);
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

// Micro-benchmark of the shadow stack: calls of an async function that does not wait (the spill before each
// call and the pop after it), and awaits that do wait (spill + the runtime's copy-out / put-back and
// collections), each with the shadow stack and with the module left as the compiler made it (no "__emitSS").
const AWAIT_BENCH_SRC = `
fn inc(x: int, o: js, s: str) int {
  if (x < 0) { await sleep(1) }
  return x + 1
}
export fn calls(n: int) int {
  let o = emptyObj()
  let s = "x" + intToStr(n)
  let acc = 0
  for (let i = 0; i < n; i++) { acc = inc(acc, o, s) }
  return acc
}
export fn awaits(n: int) int {
  let o = emptyObj()
  let acc = 0
  for (let i = 0; i < n; i++) {
    let junk = memLib.fresh()
    let v: int = await memLib.tick(i)
    acc += 1
  }
  return acc
}`;
async function benchAwait(browser, fileUrl) {
  const res = {};
  for (const mode of ['shadow stack', 'none']) {
    const page = await browser.newPage();
    await page.addInitScript(MEM_LIB);
    await page.route(/^https?:/, r => r.abort());
    await page.goto(fileUrl);
    await page.waitForFunction(() => typeof compileAndRun === 'function');
    await page.evaluate(([src, mode]) => {
      try { closeWelcome(); } catch (e) {}
      if (mode === 'none') window._emitAwaitRoots = b => b;
      const ed = document.getElementById('editor'); ed.value = src; ed.dispatchEvent(new Event('input'));
    }, [AWAIT_BENCH_SRC, mode]);
    await page.evaluate(() => compileAndRun());
    await page.waitForTimeout(300);
    res[mode] = await page.evaluate(async () => {
      const out = document.getElementById('tab-output'), add = out.appendChild; out.appendChild = function (n) { return n; };
      const r = { ss: !!window._wi.exports.__emitSS };
      for (const [name, N] of [['calls', 1000000], ['awaits', 20000]]) {
        let best = 1e9;
        for (let k = 0; k < 3; k++) { const t = performance.now(); await window._emitCallExport(window._wi, name, [BigInt(N)]); best = Math.min(best, performance.now() - t); if (window._impLog) window._impLog.length = 0; }
        r[name] = Math.round(best * 1e6 / N);
      }
      out.appendChild = add;
      return r;
    });
    await page.close();
  }
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
  console.log('program                    frame  handles   ids-issued  strBytes   strTop  wraps    arrays/ids  wasmMem  jsHeap     out    log');
  for (const prog of progs) {
    const r = await runProgram(browser, fileUrl, prog);
    for (const s of r.samples) {
      console.log('  ' + prog.name.padEnd(25) + String(s.frame).padStart(6) + String(s.handles).padStart(9) + String(s.handleIds).padStart(13) + kb(s.strBytes).padStart(10) + kb(s.strTop).padStart(9) + String(s.strWraps || 0).padStart(7) + (s.arrays + '/' + s.arrayIds).padStart(14) + kb(s.memBytes).padStart(9) + kb(s.heap).padStart(8) + String(s.out).padStart(8) + String(s.log).padStart(7));
    }
    const fails = judge(r);
    if (r.guardLines) console.log('      guard read-back: ' + JSON.stringify(r.guardLines) + (r.finishLines ? '  after the long await: ' + JSON.stringify(r.finishLines) : ''));
    if (prog.kind === 'grows' && r.samples[3]) console.log('      (not bounded by design, see the header) handles ' + r.samples[1].handles + ' → ' + r.samples[3].handles + ', string bytes ' + r.samples[1].strBytes + ' → ' + r.samples[3].strBytes + ', arrays ' + r.samples[1].arrays + ' → ' + r.samples[3].arrays);
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
    const ab = await benchAwait(browser, fileUrl);
    console.log('await micro-benchmark, ns per call of an async function that does not wait (1e6) / per await (2e4), best of 3: ' + JSON.stringify(ab));
  }
  await browser.close();
  if (BASELINE) { console.log('\nbaseline measured (no assertions)'); process.exit(0); }
  console.log('\n' + (progs.length + extra - failed - extraFailed) + '/' + (progs.length + extra) + ' memory tests passed');
  process.exit(failed || extraFailed ? 1 : 0);
})();

#!/usr/bin/env node
// Memory regions and structs: programs with expected output lines, compile errors with exact positions,
// the introspection API (_emitRegions & co.), views, screen(), freeze, collections, modules, and byte
// identity of programs without regions. Runs in headless Chromium, offline.
//
//   node tests/run-regions.js [path/to/emit-ide.html] [testName ...]
//   VERBOSE=1 prints each program's Output tab.
//
// Kinds of tests:
//   run   {src, expect, errors?, status?, after?, wait?, rerun?}  src goes through the editor and Run, as in
//         run-interop.js: expected lines appear in order; red "✗" lines only when errors: true (then each
//         must be expected). after(page) → problems[] runs after Run (direct calls, DOM checks).
//   diag  {src, diag: [string | RegExp]}  compile(src) must throw / return exactly these errors.
//   page  {page: async page => problems[]}  free-form checks on a loaded IDE page.
// Exit code 0 only when every test passes.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const MARK = '//// file: ';
const join = files => files.map((f, i) => (i === 0 && f[0] === 'main.emit' ? '' : MARK + f[0] + '\n') + f[1].replace(/^\n/, '')).join('\n');
const BASE_COMMIT = '4e11aa4'; // last commit without memory regions

// A stand-in library: reads typed arrays handed over from Emit, keeps one, writes through one.
const RG_LIB = `
window.rgLib = {
  describe: function (a) { return a.constructor.name + ':' + a.length + ':' + Array.prototype.slice.call(a, 0, 4).map(String).join(','); },
  keep: function (a) { window.rgKept = a; return a.length; },
  keptLen: function () { return window.rgKept.length; },
  keptAt: function (i) { return Number(window.rgKept[i]); },
  put: function (a, i, v) { a[i] = (a instanceof BigInt64Array) ? BigInt(v) : v; },
  sum: function (a) { var s = 0; for (var i = 0; i < a.length; i++) s += Number(a[i]); return s; },
  big: function (n) { return new Array(n + 1).join('x'); },
  each: function (n, cb) { for (var i = 0; i < n; i++) cb(i); }
};
`;

const TESTS = [
  // ── scalar element types: store / read / extension / truncation ──
  { name: 'scalar-types-read-write-extend-truncate', src: `
region a: i8[2]
region b: u8[2]
region c: i16[2]
region d: u16[2]
region e: i32[2]
region f: u32[2]
region g: int[2]
region h: f32[2]
region k: num[2]
region m: bool[2]
export fn run() {
  a[0] = 200
  a[1] = -128
  print(a[0] + a[1])
  b[0] = 300
  b[1] = -1
  print(b[0])
  print(b[1])
  c[0] = 40000
  c[1] = -32768
  print(c[0])
  print(c[1])
  d[0] = -1
  d[1] = 65536 + 7
  print(d[0])
  print(d[1])
  e[0] = 4294967295
  e[1] = 2147483648
  print(e[0])
  print(e[1])
  f[0] = -1
  print(f[0])
  g[0] = 9007199254740993
  g[1] = -5
  print(g[0])
  print(g[1])
  h[0] = 0.1
  h[1] = 3
  printNum(h[0])
  printNum(h[1] * 2.0)
  k[0] = 0.1
  k[1] = 7
  printNum(k[0] + k[1])
  m[1] = true
  m[0] = 3 > 4
  if (m[1] && !m[0]) { printStr("bools ok") }
  let x: num = b[0]
  printNum(x / 8.0)
  printStr("i8 " + a[0] + " f32 " + h[0])
}`, expect: ['> -184', '> 44', '> 255', '> -25536', '> -32768', '> 65535', '> 7', '> -1', '> -2147483648', '> 4294967295', '> 9007199254740993', '> -5', '> 0.10000000149011612', '> 6', '> 7.1', '> bools ok', '> 5.5', '> i8 -56 f32 0.10000000149011612'] },

  // ── struct layout: natural alignment, declaration order, size rounded to the alignment ──
  { name: 'struct-layout-offsets', src: `
struct Vec { x: num, y: num }
struct Mixed { a: u8, b: i32, c: u8, d: int, e: i16, f: bool, g: f32 }
struct Ball { tag: u8, pos: Vec, hist: i16[3], f: f32, n: int, alive: bool }
struct Small { a: u8, b: u8, c: u16 }
region balls: Ball[4]
region mixes: Mixed[2]
region smalls: Small[3]
region bytes: u8[5]
region after: int[1]
export fn run() { printStr("ok") }`, expect: ['> ok'],
    after: async page => {
      const got = await page.evaluate(() => ({ regions: _emitRegions(), structs: compile(document.getElementById('editor').value).structs }));
      const p = [];
      const want = {
        Ball: [['tag', 'u8', 0, 1], ['pos.x', 'num', 8, 8], ['pos.y', 'num', 16, 8], ['hist', 'i16', 24, 2, 3], ['f', 'f32', 32, 4], ['n', 'int', 40, 8], ['alive', 'bool', 48, 1]],
        Mixed: [['a', 'u8', 0, 1], ['b', 'i32', 4, 4], ['c', 'u8', 8, 1], ['d', 'int', 16, 8], ['e', 'i16', 24, 2], ['f', 'bool', 26, 1], ['g', 'f32', 28, 4]],
        Small: [['a', 'u8', 0, 1], ['b', 'u8', 1, 1], ['c', 'u16', 2, 2]],
      };
      const sizes = { Vec: [16, 8], Ball: [56, 8], Mixed: [32, 8], Small: [4, 2] };
      for (const s of got.structs) {
        if (sizes[s.name] && (s.size !== sizes[s.name][0] || s.align !== sizes[s.name][1])) p.push(s.name + ': size/align ' + s.size + '/' + s.align + ', want ' + sizes[s.name]);
        if (!want[s.name]) continue;
        const f = s.fields.map(x => [x.name, x.type, x.offset, x.size].concat(x.count ? [x.count] : []));
        if (JSON.stringify(f) !== JSON.stringify(want[s.name])) p.push(s.name + ' fields ' + JSON.stringify(f));
      }
      const r = got.regions;
      const expectR = [['balls', 65536, 4, 56], ['mixes', 65760, 2, 32], ['smalls', 65824, 3, 4], ['bytes', 65840, 5, 1], ['after', 65848, 1, 8]];
      expectR.forEach(([n, base, len, sz], i) => {
        const x = r[i];
        if (!x || x.id !== i || x.name !== n || x.base !== base || x.length !== len || x.elemSize !== sz || x.frozen !== false || x.module !== 'main' || x.path !== 'main.emit') p.push('region ' + n + ': ' + JSON.stringify(x));
      });
      if (JSON.stringify(r[0].elem.fields.map(f => f.name)) !== JSON.stringify(want.Ball.map(f => f[0]))) p.push('balls elem fields ' + JSON.stringify(r[0].elem));
      if (r[0].elem.struct !== 'Ball' || r[3].elem !== 'u8') p.push('elem shapes: ' + JSON.stringify([r[0].elem.struct, r[3].elem]));
      return p;
    } },

  // ── access forms, compound assignment, nested structs, field arrays, whole-element copy ──
  { name: 'access-forms-and-compound-assignment', src: `
struct Vec { x: num, y: num }
struct P { id: int, pos: Vec, hist: i16[3], hits: u8 }
region ps: P[4]
region grid: int[8]
region fl: num[3]
mut calls = 0
fn idx(i: int) int {
  calls++
  return i
}
export fn run() {
  grid[2] = 10
  grid[2] += 5
  grid[2] -= 3
  grid[2] *= 4
  grid[2] /= 6
  grid[2]++
  grid[2]--
  grid[2]++
  print(grid[2])
  grid[idx(3)] += 7
  grid[idx(3)]++
  print(grid[3])
  print(calls)
  for (let i = 0; i < grid.length; i++) { grid[i] = i * i }
  print(grid[7] - grid[grid[2] - 2])
  ps[1].pos.x = 1.5
  ps[1].pos.x += 0.25
  ps[1].pos.y = ps[1].pos.x * 2.0
  ps[1].hist[0] = 1
  ps[1].hist[2] = ps[1].hist[0] + 41
  ps[1].hist[1]++
  ps[1].hits += 255
  ps[1].hits++
  ps[1].id = -7
  printNum(ps[1].pos.y)
  print(ps[1].hist[0] + ps[1].hist[1] + ps[1].hist[2])
  print(ps[1].hits)
  let j = 2
  ps[1].hist[j] -= 2
  print(ps[1].hist[j])
  ps[3] = ps[1]
  ps[1].id = 99
  print(ps[3].id)
  printNum(ps[3].pos.x)
  print(ps[3].hist[2])
  fl[1] = 2
  fl[1] /= 4
  printNum(fl[1])
  let k = 0
  calls = 0
  ps[idx(k)].pos.x += 1.0
  print(calls)
  print(ps.length + fl.length + ps[0].hist.length)
}`, expect: ['> 9', '> 8', '> 2', '> 45', '> 3.5', '> 44', '> 0', '> 40', '> -7', '> 1.75', '> 40', '> 0.5', '> 1', '> 10'] },

  // ── with … as: one checked address, direct field access, nested aliases, copy from an alias ──
  { name: 'with-alias', src: `
struct Vec { x: num, y: num }
struct Ball { pos: Vec, vel: Vec, n: int, hist: int[2] }
region balls: Ball[5]
fn step(bs: region Ball) {
  for (let i = 0; i < bs.length; i++) {
    with bs[i] as b {
      b.pos.x += b.vel.x
      b.n++
      with b.pos as p { p.y = p.x * 10.0 }
    }
  }
}
export fn run() {
  for (let i = 0; i < balls.length; i++) {
    with balls[i] as b { b.vel.x = i + 0.5  b.hist[1] = i }
  }
  step(balls)
  step(balls)
  printNum(balls[3].pos.x)
  printNum(balls[3].pos.y)
  print(balls[4].n + balls[4].hist[1])
  with balls[2] as b { balls[0] = b }
  printNum(balls[0].vel.x)
  let b = 5
  print(b)
}`, expect: ['> 7', '> 70', '> 6', '> 2.5', '> 5'] },

  // ── region parameters: by reference, lengths differ at run time ──
  { name: 'region-parameters-same-module', src: `
region small: int[3]
region big: int[10]
region none: num[2]
fn sum(r: region int) int {
  let s = 0
  for (let i = 0; i < r.length; i++) { s += r[i] }
  return s
}
fn setAll(r: region int, v: int) {
  for (let i = 0; i < r.length; i++) { r[i] = v }
}
fn len(r: region int) int { return r.length }
fn poke(r: region int, i: int) { r[i] = 1 }
export fn run() {
  setAll(small, 2)
  setAll(big, 3)
  print(sum(small))
  print(sum(big))
  print(len(small) * 100 + len(big))
  poke(big, 9)
  print(big[9])
  try {
    poke(small, 3)
  } catch (e) {
    printStr(e.message)
  }
  poke(small, -1)
}`, errors: true, expect: ['✗ run → small[-1]: index out of range (length 3) at main.emit:13:34', '> 6', '> 30', '> 310', '> 1', '> small[3]: index out of range (length 3) at main.emit:13:34'] },

  { name: 'region-parameters-across-modules', src: join([
    ['main.emit', `
import game.physics as ph
import game.physics.Body
region mine: Body[3]
export fn run() {
  ph.bodies[1].m = 2.5
  ph.step(ph.bodies)
  ph.step(mine)
  printNum(ph.bodies[1].m)
  printNum(mine[0].m)
  print(ph.counts[0])
  print(ph.counts.length)
  ph.fillUp(ph.counts)
  print(ph.counts[6])
}`],
    ['game/physics.emit', `
package game
public struct Body { m: num, v: num }
public region bodies: Body[10]
public region counts: int[7]
region hidden: u8[3]
public fn step(bs: region Body) {
  for (let i = 0; i < bs.length; i++) { bs[i].m = bs[i].m * 2.0 + 1.0 }
  counts[0] += bs.length
}
public fn fillUp(r: region int) {
  r[r.length - 1] = hidden.length
}`]]), expect: ['> 6', '> 1', '> 13', '> 7', '> 3'],
    after: async page => {
      const r = await page.evaluate(() => _emitRegions().map(x => [x.id, x.name, x.module, x.path, typeof x.elem === 'string' ? x.elem : x.elem.struct].join(' ')));
      const want = ['0 mine main main.emit Body', '1 bodies game.physics game/physics.emit Body', '2 counts game.physics game/physics.emit int', '3 hidden game.physics game/physics.emit u8'];
      return JSON.stringify(r) === JSON.stringify(want) ? [] : ['_emitRegions: ' + JSON.stringify(r)];
    } },

  // ── bounds failures at run time: position, try/catch, await, callbacks, frame() ──
  { name: 'bounds-runtime-error-line-with-position', errors: true, src: `
region grid: int[64]
export fn run() {
  printStr("before")
  let i = 70
  grid[i] = 1
  printStr("not reached")
}`, expect: ['✗ run → grid[70]: index out of range (length 64) at main.emit:5:3', '> before'], count: { '> not reached': 0 } },

  { name: 'bounds-catchable-in-try-and-message', src: `
struct A { v: num[2] }
region grid: int[4]
region arrs: A[2]
fn deep(i: int) int { return grid[i] }
export fn run() {
  try {
    print(deep(4))
    printStr("not reached")
  } catch (e) {
    printStr("caught " + e.message)
  }
  let j = 2
  try { arrs[1].v[j] = 1.0 } catch (e) { printStr(e.message) }
  try { print(grid[j * 3]) } catch (e) { printStr(e.name) } finally { printStr("finally") }
  printStr("carries on")
}`, expect: ['> caught grid[4]: index out of range (length 4) at main.emit:4:30', '> arrs[…].v[2]: index out of range (length 2) at main.emit:13:19', '> Error', '> finally', '> carries on'], count: { '> not reached': 0 } },

  { name: 'bounds-in-await-function', errors: true, wait: 400, src: `
region grid: int[4]
fn later(i: int) int {
  await sleep(5)
  return grid[i]
}
export fn run() {
  try {
    print(later(9))
  } catch (e) {
    printStr("caught: " + e.message)
  }
  await sleep(5)
  print(later(2))
  print(later(-3))
  printStr("not reached")
}`, expect: ['> caught: grid[9]: index out of range (length 4) at main.emit:4:10', '> 0', '✗ run(): grid[-3]: index out of range (length 4) at main.emit:4:10'], count: { '> not reached': 0 } },

  { name: 'bounds-in-callback-and-frame', errors: true, wait: 700, src: `
region grid: int[4]
mut n = 0
fn visit(i: int) {
  grid[i * 2] = i
}
export fn run() {
  rgLib.each(4, fnRef(visit))
  printStr("after callbacks")
  print(grid[2])
  animate()
}
export fn frame() {
  n++
  if (n > 2 && n < 6) { grid[n] = 1 }
  if (n == 20) { printStr("frames go on") }
}`, expect: ['✗ callback visit(): grid[4]: index out of range (length 4) at main.emit:4:3', '✗ callback visit(): grid[6]: index out of range (length 4) at main.emit:4:3', '> after callbacks', '> 1', '✗ frame(): grid[4]: index out of range (length 4) at main.emit:14:25', '✗ frame(): grid[5]: index out of range (length 4) at main.emit:14:25', '> frames go on'],
    count: { '✗ frame(): grid[4]: index out of range (length 4) at main.emit:14:25': 1, '✗ callback visit(): grid[4]: index out of range (length 4) at main.emit:4:3': 1 } },

  // ── freeze / thaw / frozen, whole-region operations, the Memory panel bypass ──
  { name: 'freeze-thaw-frozen', errors: true, src: `
struct S { a: int }
region grid: int[4]
region other: int[4]
region ss: S[2]
fn tryWrite(what: str) {
  try {
    if (strEq(what, "store")) { grid[1] = 5 }
    if (strEq(what, "compound")) { grid[1] += 1 }
    if (strEq(what, "fill")) { fill(grid, 1) }
    if (strEq(what, "wipe")) { wipe(grid) }
    if (strEq(what, "copy")) { copy(other, grid) }
    if (strEq(what, "copyfrom")) { copy(grid, other) }
    if (strEq(what, "swap")) { swap(other, grid) }
    if (strEq(what, "field")) { ss[0].a = 1 }
    printStr(what + " ok")
  } catch (e) {
    printStr(what + ": " + e.message)
  }
}
export fn run() {
  grid[1] = 3
  freeze(grid)
  if (frozen(grid) && !frozen(other)) { printStr("grid is frozen") }
  print(grid[1])
  tryWrite("store")
  tryWrite("compound")
  tryWrite("fill")
  tryWrite("wipe")
  tryWrite("copy")
  tryWrite("copyfrom")
  tryWrite("swap")
  print(grid[1] + other[1])
  thaw(grid)
  tryWrite("store")
  print(grid[1])
  freeze(ss)
  tryWrite("field")
  with ss[1] as s { s.a = 2 }
}
export fn check() { print(grid[2]) }`, expect: ['✗ run → write to frozen region ss at main.emit:38:21', '> grid is frozen', '> 3', '> store: write to frozen region grid at main.emit:7:33', '> compound: write to frozen region grid at main.emit:8:36', '> fill: write to frozen region grid at main.emit:9:32', '> wipe: write to frozen region grid at main.emit:10:32', '> copy: write to frozen region grid at main.emit:11:32', '> copyfrom ok', '> swap: write to frozen region grid at main.emit:13:32', '> 6', '> store ok', '> 5', '> field: write to frozen region ss at main.emit:14:33'], expectAfter: ['> 77'],
    after: async page => {
      return page.evaluate(() => {
        const p = [];
        if (_emitRegions()[0].frozen !== false) p.push('grid should read as not frozen');
        _emitRegionFreeze(0, true);
        if (_emitRegions()[0].frozen !== true) p.push('_emitRegionFreeze(0, true) not visible in _emitRegions()');
        if (_emitRegionWrite(0, 2, undefined, 77) !== true) p.push('_emitRegionWrite on a frozen region must succeed (bypass)');
        if (_emitRegionRead(0, 2) !== 77) p.push('read back ' + _emitRegionRead(0, 2));
        _emitCallExport(window._wi, 'check', []);
        return p;
      });
    } },

  { name: 'fill-wipe-copy-swap', errors: true, src: `
struct V { x: num, y: num }
region a: int[4]
region b: int[4]
region c: int[5]
region u: u8[3]
region f: f32[2]
region t: bool[2]
region va: V[2]
region vb: V[2]
fn cp(x: region int, y: region int) { copy(x, y) }
export fn run() {
  fill(a, 7)
  fill(u, 257)
  fill(f, 0.5)
  fill(t, true)
  print(a[0] + a[3])
  print(u[2])
  printNum(f[1])
  if (t[0] && t[1]) { printStr("bools filled") }
  copy(a, b)
  print(b[2])
  b[0] = 1
  swap(a, b)
  print(a[0] * 10 + b[0])
  wipe(a)
  print(a[0] + a[1] + a[2] + a[3])
  va[0].x = 1.5
  vb[1].y = 2.5
  swap(va, vb)
  printNum(va[1].y + vb[0].x)
  wipe(vb)
  printNum(vb[0].x)
  cp(a, b)
  cp(c, a)
}`, expect: ['✗ run → copy(c, a): the regions differ in length (5 and 4) at main.emit:10:39', '> 14', '> 1', '> 0.5', '> bools filled', '> 7', '> 17', '> 0', '> 4', '> 0'] },

  // ── views for JavaScript ──
  { name: 'views-of-every-element-type', src: `
struct P { a: u8, b: num }
region a: i8[3]
region b: u8[3]
region c: i16[3]
region d: u16[3]
region e: i32[3]
region f: u32[3]
region g: int[3]
region h: f32[3]
region k: num[3]
region m: bool[3]
region s: P[2]
export fn run() {
  a[0] = -2
  b[0] = 250
  c[0] = -300
  d[0] = 60000
  e[0] = -70000
  f[0] = 4000000000
  g[0] = -9
  h[0] = 1.5
  k[0] = 2.25
  m[1] = true
  s[0].a = 7
  printStr(rgLib.describe(view(a)))
  printStr(rgLib.describe(view(b)))
  printStr(rgLib.describe(view(c)))
  printStr(rgLib.describe(view(d)))
  printStr(rgLib.describe(view(e)))
  printStr(rgLib.describe(view(f)))
  printStr(rgLib.describe(view(g)))
  printStr(rgLib.describe(view(h)))
  printStr(rgLib.describe(view(k)))
  printStr(rgLib.describe(view(m)))
  printStr(rgLib.describe(view(s)))
  rgLib.put(view(e), 2, 123)
  rgLib.put(view(g), 1, 77)
  rgLib.put(view(k), 2, 0.125)
  print(e[2] + g[1])
  printNum(k[2])
  printStr(rgLib.describe(b))
  print(toInt(rgLib.sum(e)))
  let v = view(k)
  printNum(toNum(v[0]))
}`, expect: ['> Int8Array:3:-2,0,0', '> Uint8Array:3:250,0,0', '> Int16Array:3:-300,0,0', '> Uint16Array:3:60000,0,0', '> Int32Array:3:-70000,0,0', '> Uint32Array:3:4000000000,0,0', '> BigInt64Array:3:-9,0,0', '> Float32Array:3:1.5,0,0', '> Float64Array:3:2.25,0,0', '> Uint8Array:3:0,1,0', '> Uint8Array:32:7,0,0,0', '> 200', '> 0.125', '> Uint8Array:3:250,0,0', '> -69877', '> 2.25'] },

  { name: 'views-after-memory-growth', src: `
region grid: int[4]
export fn run() {
  grid[3] = 11
  let n = rgLib.keep(view(grid))
  print(n)
  let s: str = rgLib.big(400000)
  print(strLen(s))
  printStr("kept view length now " + rgLib.keptLen())
  let fresh = view(grid)
  printStr(rgLib.describe(fresh))
  printStr(rgLib.describe(grid))
  grid[0] = 5
  print(toInt(fresh[0]))
}`, expect: ['> 4', '> 400000', '> kept view length now 0', '> BigInt64Array:4:0,0,0,11', '> BigInt64Array:4:0,0,0,11', '> 5'],
    after: async page => page.evaluate(() => { const p = []; if (!(_wasmMem.buffer.byteLength > 131072)) p.push('memory did not grow: ' + _wasmMem.buffer.byteLength); return p; }) },

  // ── screen(): a memory-mapped canvas ──
  { name: 'screen-static-picture', src: `
region fb: u8[16 * 8 * 4]
export fn run() {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 16; x++) {
      let o = (y * 16 + x) * 4
      fb[o] = x * 16
      fb[o + 1] = y * 32
      fb[o + 2] = 200
      fb[o + 3] = 255
    }
  }
  screen(fb, 16, 8, 3)
  fb[0] = 1
}`, expect: [], rerun: true,
    after: async page => page.evaluate(() => {
      const p = [], cs = document.querySelectorAll('canvas[data-emit-screen]');
      if (cs.length !== 1) p.push(cs.length + ' screen canvases (want 1 after a re-Run)');
      const c = cs[cs.length - 1];
      if (c.width !== 16 || c.height !== 8) p.push('canvas ' + c.width + 'x' + c.height);
      if (c.style.width !== '48px' || !/pixelated/.test(c.style.imageRendering)) p.push('style ' + c.style.cssText);
      const px = (x, y) => Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data).join(',');
      if (px(3, 2) !== '48,64,200,255') p.push('pixel 3,2 = ' + px(3, 2));
      if (px(15, 7) !== '240,224,200,255') p.push('pixel 15,7 = ' + px(15, 7));
      if (px(0, 0) !== '1,0,200,255') p.push('pixel 0,0 (written after screen(), shown after the call) = ' + px(0, 0));
      return p;
    }) },

  { name: 'screen-animated', wait: 50, src: `
region fb: u8[4 * 4 * 4]
mut t = 0
export fn run() {
  screen(fb, 4, 4)
  animate()
}
export fn frame() {
  t++
  for (let i = 0; i < 16; i++) {
    fb[i * 4] = t
    fb[i * 4 + 3] = 255
  }
}`, expect: [],
    after: async page => {
      const p = [];
      const read = () => page.evaluate(() => { const c = document.querySelector('canvas[data-emit-screen]'); return c ? c.getContext('2d').getImageData(2, 2, 1, 1).data[0] : -1; });
      await page.waitForTimeout(200);
      const a = await read();
      await page.waitForTimeout(300);
      const b = await read();
      const t = await page.evaluate(() => Number(window._wi.exports.__g0 ? window._wi.exports.__g0.value : -1));
      if (!(a > 0 && b > a)) p.push('red channel did not advance with the frames: ' + a + ' → ' + b);
      if (b > t || b < t - 2) p.push('canvas red ' + b + ' is not the frame count ' + t + ' (blit per frame)');
      return p;
    } },

  // ── introspection API contract ──
  { name: 'introspection-api-contract', src: `
struct Vec { x: num, y: num }
struct B { p: Vec, h: i16[2], ok: bool, big: int }
region bs: B[3]
region g: int[2]
region f: f32[1]
region u: u8[2]
export fn run() {
  bs[1].p.y = 2.5
  bs[1].h[1] = -3
  bs[2].ok = true
  g[1] = 9007199254740993
  g[0] = -12
}
export fn show() {
  printNum(bs[0].p.x)
  print(bs[0].h[0])
  print(u[1])
  print(g[0])
  if (bs[0].ok) { printStr("ok set") }
  printNum(f[0])
}`, expect: [],
    after: async page => page.evaluate(() => {
      const p = [], eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) p.push(what + ': ' + JSON.stringify(a) + ' (want ' + JSON.stringify(b) + ')'); };
      const rs = _emitRegions();
      eq(rs.map(r => Object.keys(r).join(',')), Array(4).fill('id,name,module,path,base,length,elemSize,elem,frozen'), 'keys');
      eq(rs[0].elem, { struct: 'B', fields: [{ name: 'p.x', type: 'num', offset: 0, size: 8 }, { name: 'p.y', type: 'num', offset: 8, size: 8 }, { name: 'h', type: 'i16', offset: 16, size: 2, count: 2 }, { name: 'ok', type: 'bool', offset: 20, size: 1 }, { name: 'big', type: 'int', offset: 24, size: 8 }] }, 'struct elem');
      eq(rs.map(r => r.elem.struct || r.elem), ['B', 'int', 'f32', 'u8'], 'elems');
      eq(_emitRegionRead(0, 1, 'p.y'), 2.5, 'read p.y');
      eq(_emitRegionRead(0, 1, 'h[1]'), -3, 'read h[1]');
      eq(_emitRegionRead(0, 1, 'h.1'), -3, 'read h.1');
      eq(_emitRegionRead(0, 2, 'ok'), true, 'read bool');
      eq(_emitRegionRead(1, 1), '9007199254740993', 'unsafe int as string');
      eq(_emitRegionRead(1, 0), -12, 'safe int as number');
      eq([_emitRegionRead(1, 2), _emitRegionRead(1, -1), _emitRegionRead(0, 0, 'nope'), _emitRegionRead(0, 0, 'h'), _emitRegionRead(0, 0, 'h[2]'), _emitRegionRead(0, 0), _emitRegionRead(1, 0, 'x'), _emitRegionRead(9, 0)], Array(8).fill(undefined), 'undefined cases');
      eq([_emitRegionWrite(0, 0, 'p.x', 1.25), _emitRegionWrite(0, 0, 'h[0]', 70000), _emitRegionWrite(3, 1, undefined, '300'), _emitRegionWrite(1, 0, undefined, 2.9), _emitRegionWrite(0, 0, 'ok', 1), _emitRegionWrite(2, 0, undefined, 0.1)], [true, true, true, true, true, true], 'writes');
      eq([_emitRegionWrite(1, 0, undefined, NaN), _emitRegionWrite(1, 0, undefined, 'abc'), _emitRegionWrite(1, 5, undefined, 1), _emitRegionWrite(0, 0, 'zz', 1), _emitRegionWrite(2, 0, undefined, ''), _emitRegionWrite(1, 0, undefined, Infinity)], [false, false, false, false, false, false], 'rejected writes');
      eq([_emitRegionRead(0, 0, 'h[0]'), _emitRegionRead(3, 1), _emitRegionRead(1, 0), _emitRegionRead(0, 0, 'ok')], [4464, 44, 2, true], 'truncation like a store');
      eq(_emitRegionRead(2, 0), Math.fround(0.1), 'f32');
      const by = _emitRegionBytes(0);
      eq([by instanceof Uint8Array, by.length, by.byteOffset, by[8 + 32 + 7]], [true, 96, 65536, 64], 'bytes');
      eq(_emitRegionFreeze(1, true), true, 'freeze returns');
      eq(_emitRegions()[1].frozen, true, 'frozen live');
      _emitRegionFreeze(1, false);
      eq(_emitRegions()[1].frozen, false, 'thawed live');
      const r = compile(document.getElementById('editor').value);
      eq(Object.keys(r.regions[0]).join(','), 'id,name,module,path,base,length,elemSize,elem', 'r.regions keys');
      eq(r.structs.map(s => s.name + ':' + s.size), ['Vec:16', 'B:32'], 'r.structs');
      eq(typeof r.imports.heapBase + ' ' + r.imports.heapBase, 'number 131072', 'imports.heapBase');
      eq(JSON.parse(r.imports.regionMeta).regions.length, 4, 'regionMeta');
      _emitCallExport(window._wi, 'show', []);
      return p;
    }), expectAfter: ['> 1.25', '> 4464', '> 44', '> 2', '> ok set', '> 0.10000000149011612'] },

  { name: 'introspection-empty-without-regions', src: `
export fn run() { printStr("plain") }`, expect: ['> plain'],
    after: async page => page.evaluate(() => {
      const p = [], r = compile(document.getElementById('editor').value);
      if (JSON.stringify(_emitRegions()) !== '[]') p.push('_emitRegions() = ' + JSON.stringify(_emitRegions()));
      if (r.regions.length || r.structs.length || r.imports.heapBase !== undefined || r.imports.regionMeta !== undefined) p.push('compile result has region data');
      if (_emitRegionRead(0, 0) !== undefined || _emitRegionWrite(0, 0, undefined, 1) !== false || _emitRegionBytes(0).length !== 0) p.push('API on no regions');
      if (_strHeapBase !== 65536) p.push('heap base ' + _strHeapBase);
      return p;
    }) },

  // ── zero-initialisation on every Run, heap base, collections never touch regions ──
  { name: 'zero-initialised-on-rerun', rerun: true, src: `
region grid: int[100]
struct S { a: num, b: bool }
region ss: S[3]
export fn run() {
  let s = 0
  for (let i = 0; i < grid.length; i++) { s += grid[i] }
  if (ss[2].b) { s += 1000 }
  print(s)
  for (let i = 0; i < grid.length; i++) { grid[i] = i }
  ss[2].b = true
}`, expect: ['> 0'], count: { '> 0': 1 },
    after: async page => page.evaluate(() => (_emitRegionRead(0, 99) === 99 && _emitRegionRead(1, 2, 'b') === true ? [] : ['the second Run did not write its values'])) },

  { name: 'collections-never-touch-regions', wait: 50, src: `
region keep: int[1000]
region bytes: u8[4096]
mut n = 0
export fn run() {
  for (let i = 0; i < keep.length; i++) { keep[i] = i * 7 + 1 }
  for (let i = 0; i < bytes.length; i++) { bytes[i] = i }
}
export fn frame() {
  n++
  let s = "frame " + n + " " + rgLib.big(200)
  let o = JSON.parse("{\\"a\\": 1}")
  keep[n % 1000] = keep[n % 1000] + 0
  if (strLen(s) < 3) { printStr(s) }
}
export fn check() {
  let bad = 0
  for (let i = 0; i < keep.length; i++) { if (keep[i] != i * 7 + 1) { bad++ } }
  for (let i = 0; i < bytes.length; i++) { if (bytes[i] != i % 256) { bad++ } }
  print(bad)
}`, expect: [],
    after: async page => page.evaluate(() => {
      const p = [], hb = JSON.parse(compile(document.getElementById('editor').value).imports.regionMeta).heapBase;
      let minStr = Infinity;
      for (let i = 0; i < 3000; i++) { _emitFrame(); _strBlocks.forEach((z, a) => { if (a < minStr) minStr = a; }); }
      const st = _memStats();
      if (!(st.collections > 0)) p.push('no collection ran');
      if (minStr < hb) p.push('a string was placed at ' + minStr + ', below the heap base ' + hb);
      if (_strHeapBase !== hb || hb !== 131072) p.push('heap base ' + _strHeapBase + ' / ' + hb);
      _emitCallExport(window._wi, 'check', []);
      return p;
    }), expectAfter: ['> 0'] },

  // ── shadowing, region names as ordinary words elsewhere ──
  { name: 'shadowing-and-contextual-words', src: `
region g: int[3]
fn f(g: int) int { return g * 2 }
export fn run() {
  g[0] = 4
  let region = 3
  let struct = 4
  let with = 5
  print(region + struct + with)
  print(f(g[0]))
  if (true) {
    let g = 10
    print(g)
  }
  print(g[0])
}`, expect: ['> 12', '> 8', '> 10', '> 4'] },

  { name: 'region-handed-to-js-directly', src: `
region samples: num[4]
export fn run() {
  for (let i = 0; i < samples.length; i++) { samples[i] = i * 0.5 }
  printNum(toNum(rgLib.sum(samples)))
  let d: str = rgLib.describe(samples)
  printStr(d)
  printStr(toStr(typeOf(view(samples))))
}`, expect: ['> 3', '> Float64Array:4:0,0.5,1,1.5', '> object'] },

  // ── compile errors: exact messages and positions ──
  { name: 'diag-unknown-struct', diag: ['1:11: Unknown type "Foo" — use i8 u8 i16 u16 i32 u32 int f32 num bool or a struct name'], src: 'region r: Foo[3]\nexport fn run() {}' },
  { name: 'diag-unknown-struct-hint', diag: ['2:11: Unknown type "Bal" — use i8 u8 i16 u16 i32 u32 int f32 num bool or a struct name — did you mean "Ball"?'], src: 'struct Ball { x: num }\nregion r: Bal[3]\nexport fn run() {}' },
  { name: 'diag-unknown-field', diag: ['3:19: struct A has no field "y" — did you mean "x"?'], src: 'struct A { x: num }\nregion r: A[3]\nexport fn run() { r[0].y = 1.0 }' },
  { name: 'diag-non-constant-size', diag: ['2:15: The size of region r must be a constant: int literals combined with + - * / % and parentheses'], src: 'let n = 4\nregion r: int[n]\nexport fn run() {}' },
  { name: 'diag-non-positive-size', diag: ['1:15: The size of region r must be at least 1, but it is 0'], src: 'region r: int[2 - 2]\nexport fn run() {}' },
  { name: 'diag-float-size', diag: ['1:15: The size of region r must be a whole number, not 2.5'], src: 'region r: int[2.5]\nexport fn run() {}' },
  { name: 'diag-too-large', diag: ['2:15: Regions are limited to 256 MB in total — region b (20000000 × 8 bytes) goes over it'], src: 'region a: int[20000000]\nregion b: int[20000000]\nexport fn run() {}' },
  { name: 'diag-duplicate-names', diag: ['2:8: "r" is already declared at line 1 of this file — every top-level name (fn, let, mut, struct, region) is declared once', '4:8: "S" is already declared at line 3 of this file — every top-level name (fn, let, mut, struct, region) is declared once', '5:1: "r" is already declared at line 1 of this file — every top-level name (fn, let, mut, struct, region) is declared once'], src: 'region r: int[3]\nregion r: u8[3]\nstruct S { a: int }\nstruct S { b: int }\nfn r() {}\nexport fn run() {}' },
  { name: 'diag-duplicate-field', diag: ['1:20: Field "a" is declared twice in struct S'], src: 'struct S { a: int, a: num }\nexport fn run() {}' },
  { name: 'diag-constant-index-out-of-range', diag: ['2:21: r[3]: index out of range (length 3)'], src: 'region r: int[3]\nexport fn run() { r[3] = 1 }' },
  { name: 'diag-negative-constant-index', diag: ['2:29: r[-1]: index out of range (length 3)'], src: 'region r: int[3]\nexport fn run() { print(r[-1]) }' },
  { name: 'diag-constant-field-index', diag: ['3:26: r[0].p[3]: index out of range (length 3)'], src: 'struct A { p: num[3] }\nregion r: A[2]\nexport fn run() { r[0].p[3] = 1.0 }' },
  { name: 'diag-store-str', diag: ['2:26: Cannot store a str in r[0] (int) — it holds whole numbers'], src: 'region r: int[3]\nexport fn run() { r[0] = "x" }' },
  { name: 'diag-store-num-in-int', diag: ['2:26: Cannot store a num in r[0] (u8) — it holds whole numbers: round the value first, e.g. floor(x) or round(x)'], src: 'region r: u8[3]\nexport fn run() { r[0] = 1.5 }' },
  { name: 'diag-store-int-in-bool', diag: ['2:26: Cannot store an int in r[0] (bool) — it holds true / false (write a comparison, e.g. x > 0)'], src: 'region r: bool[3]\nexport fn run() { r[0] = 1 }' },
  { name: 'diag-copy-length-mismatch', diag: ['3:19: copy(a, b): the regions differ in length (3 and 4)'], src: 'region a: int[3]\nregion b: int[4]\nexport fn run() { copy(a, b) }' },
  { name: 'diag-swap-type-mismatch', diag: ['3:19: swap(a, b): a holds int but b holds u8 — both regions need the same element type'], src: 'region a: int[3]\nregion b: u8[3]\nexport fn run() { swap(a, b) }' },
  { name: 'diag-region-as-value', diag: ['2:27: "r" is a region of int — a region is not a value: it cannot be stored in a variable, returned, compared or printed. Index it (r[i]), pass it to a function that takes "region int", or hand JavaScript a view of it: view(r)'], src: 'region r: int[3]\nexport fn run() { let x = r }' },
  { name: 'diag-region-returned', diag: [/^2:21: "r" is a region of int — a region is not a value/], src: 'region r: int[3]\nfn f() int { return r }\nexport fn run() {}' },
  { name: 'diag-region-printed', diag: [/^2:25: "r" is a region of int — a region is not a value/], src: 'region r: int[3]\nexport fn run() { print(r) }' },
  { name: 'diag-region-compared', diag: [/^3:23: "a" is a region of int — a region is not a value/], src: 'region a: int[3]\nregion b: int[3]\nexport fn run() { if (a == b) { } }' },
  { name: 'diag-region-assigned', diag: ['3:19: "a" is a region — it cannot be assigned. To copy all elements of another region into it: copy(other, a)'], src: 'region a: int[3]\nregion b: int[3]\nexport fn run() { a = b }' },
  { name: 'diag-region-variable-type', diag: ['1:19: A variable cannot hold a region — a region is not a value. Use it by name, or take it as a parameter: fn f(r: region int)'], src: 'export fn run() { let x: region int = 0 }' },
  { name: 'diag-region-return-type', diag: ['1:1: A function cannot return a region — a region is not a value (it stays where it is declared)'], src: 'fn f() -> region int { }\nexport fn run() {}' },
  { name: 'diag-str-field', diag: [/^1:15: A struct field cannot be str — regions and structs hold plain numbers only\. .*collector does not look inside regions/], src: 'struct A { s: str }\nexport fn run() {}' },
  { name: 'diag-js-field', diag: [/^1:15: A struct field cannot be js — /], src: 'struct A { o: js }\nexport fn run() {}' },
  { name: 'diag-arr-region', diag: [/^1:11: A region element cannot be arr — /], src: 'region r: arr[3]\nexport fn run() {}' },
  { name: 'diag-struct-contains-itself', diag: ['1:15: struct A contains itself — a struct cannot hold itself by value'], src: 'struct A { a: A }\nexport fn run() {}' },
  { name: 'diag-struct-array-field', diag: ['2:15: An array of structs inside a struct is not supported yet — keep the Vs in a region of their own'], src: 'struct V { x: num }\nstruct A { v: V[2] }\nexport fn run() {}' },
  { name: 'diag-struct-inside-function', diag: ['1:19: struct declarations belong at the top level of a file, not inside a function'], src: 'export fn run() { struct X { a: int } }' },
  { name: 'diag-screen-not-u8', diag: ['2:26: screen needs a u8 region (4 bytes per pixel: red, green, blue, alpha), but r holds int'], src: 'region r: int[3]\nexport fn run() { screen(r, 1, 1) }' },
  { name: 'diag-screen-too-small', diag: ['2:19: screen(r, 4, 2) needs 32 bytes (width × height × 4), but r has 30'], src: 'region r: u8[30]\nexport fn run() { screen(r, 4, 2) }' },
  { name: 'diag-struct-element-as-value', diag: ['3:27: r[0] is a whole A — use one of its fields (r[0].x), copy it into another element (… = r[0]) or name it for a block: with r[0] as b { … }'], src: 'struct A { x: num }\nregion r: A[3]\nexport fn run() { let v = r[0] }' },
  { name: 'diag-field-array-as-value', diag: ['3:28: r[0].p is an array of 3 num — index it: r[0].p[0]'], src: 'struct A { p: num[3] }\nregion r: A[2]\nexport fn run() { printNum(r[0].p) }' },
  { name: 'diag-fill-struct-region', diag: ['3:19: fill sets every element to one number, but r holds A structs — use wipe(r) to zero it'], src: 'struct A { x: num }\nregion r: A[3]\nexport fn run() { fill(r, 0) }' },
  { name: 'diag-index-not-int', diag: ['3:10: An index must be an int, but this is num'], src: 'region r: int[3]\nexport fn run() { let f = 1.5\n print(r[f]) }' },
  // the alias cannot escape
  { name: 'diag-alias-stored', diag: ['3:44: "b" stands for r[0] inside its with block — it is not a value: use its fields (b.x) or copy the whole element into another one (… = b)'], src: 'struct A { x: num }\nregion r: A[3]\nexport fn run() { with r[0] as b { let c = b } }' },
  { name: 'diag-alias-returned', diag: [/^3:38: "b" stands for r\[0\] inside its with block — it is not a value/], src: 'struct A { x: num }\nregion r: A[3]\nfn f() int { with r[0] as b { return b } return 0 }\nexport fn run() {}' },
  { name: 'diag-alias-passed', diag: [/^4:38: "b" stands for r\[0\] inside its with block — it is not a value/], src: 'struct A { x: num }\nregion r: A[3]\nfn g(x: int) {}\nexport fn run() { with r[0] as b { g(b) } }' },
  { name: 'diag-alias-passed-as-region', diag: ['4:38: "b" is one element (r[0]), not a region — g() takes a whole region'], src: 'struct A { x: num }\nregion r: A[3]\nfn g(x: region A) {}\nexport fn run() { with r[0] as b { g(b) } }' },
  { name: 'diag-alias-to-js', diag: [/^3:48: "b" stands for r\[0\] inside its with block/], src: 'struct A { x: num }\nregion r: A[3]\nexport fn run() { with r[0] as b { console.log(b) } }' },
  { name: 'diag-alias-reassigned', diag: ['3:36: "b" stands for r[0] — it cannot be pointed at another element. To copy a whole element write r[0] = …'], src: 'struct A { x: num }\nregion r: A[3]\nexport fn run() { with r[0] as b { b = r[1] } }' },
  { name: 'diag-alias-after-block', diag: ['3:48: "b" was the name of r[0] in a with block that has ended — it only exists inside that block'], src: 'struct A { x: num }\nregion r: A[3]\nexport fn run() { with r[0] as b { b.x = 1.0 } b.x = 2.0 }' },
  { name: 'diag-with-scalar', diag: ['2:24: with … as needs one struct element (with balls[i] as b { … }), but g[0] is a int'], src: 'region g: int[3]\nexport fn run() { with g[0] as b { } }' },
  // region parameters
  { name: 'diag-export-fn-region-param', diag: ['1:1: export fn f takes a region parameter — JavaScript cannot pass a region. Use the region by name inside the function instead'], src: 'export fn f(r: region int) {}\nexport fn run() {}' },
  { name: 'diag-region-param-type-mismatch', diag: ['3:21: f() takes a region of int, but a holds u8'], src: 'region a: u8[3]\nfn f(r: region int) {}\nexport fn run() { f(a) }' },
  { name: 'diag-region-param-not-region', diag: ['2:21: f() takes a region of int as argument 1 (r) — pass the name of a region'], src: 'fn f(r: region int) {}\nexport fn run() { f(3) }' },
  { name: 'diag-region-param-unknown-elem', diag: ['1:9: Unknown type "Nope" — use i8 u8 i16 u16 i32 u32 int f32 num bool or a struct name'], src: 'fn f(r: region Nope) {}\nexport fn run() {}' },
  { name: 'diag-fnref-region-fn', diag: ['3:36: fnRef(f) — this function takes a region parameter, and JavaScript cannot pass a region, so it cannot be a callback'], src: 'region a: int[3]\nfn f(r: region int) {}\nexport fn run() { setTimeout(fnRef(f), 1) }' },
  { name: 'diag-region-param-reassigned', diag: ['3:3: "r" is a region parameter — it cannot be assigned. To copy all elements of another region into it: copy(other, r)'], src: 'region a: int[3]\nfn f(r: region int) {\n  r = a\n}\nexport fn run() {}' },
  // modules
  { name: 'diag-private-struct', diag: ['main.emit:2:11: "S" is private to module m — declare it with public (public struct S { … }) to use it from another file'], src: join([['main.emit', 'import m\nregion r: m.S[3]\nexport fn run() { m.f() }'], ['m.emit', 'struct S { a: int }\npublic fn f() {}']]) },
  { name: 'diag-private-region', diag: ['main.emit:2:25: "g" is private to module m — declare it with public (public region g: …) to use it from another file'], src: join([['main.emit', 'import m\nexport fn run() { print(m.g[0]) }'], ['m.emit', 'region g: int[3]\npublic fn f() {}']]) },
  { name: 'diag-runtime-position-in-module', diag: ['m.emit:2:19: g[5]: index out of range (length 3)'], src: join([['main.emit', 'import m\nexport fn run() { m.f() }'], ['m.emit', 'public region g: int[3]\npublic fn f() { g[5] = 1 }']]) },
  { name: 'diag-unknown-module-in-type', diag: ['main.emit:1:11: Unknown module "q" in the type q.S — import it first (import q)'], src: join([['main.emit', 'region r: q.S[3]\nexport fn run() { }'], ['m.emit', 'public fn f() {}']]) },
  { name: 'diag-not-a-struct', diag: ['main.emit:2:11: "f" is a function, not a struct'], src: join([['main.emit', 'import m.f\nregion r: f[3]\nexport fn run() { f() }'], ['m.emit', 'public fn f() {}']]) },
  { name: 'diag-syntax-region', diag: ['2:1: Expected [size] after the element type — region g: int[64]'], src: 'region g: int\nexport fn run() {}' },
  { name: 'diag-syntax-with', diag: ['3:29: Expected as after the element — with balls[i] as b { b.x = 0 }'], src: 'struct A { x: num }\nregion r: A[3]\nexport fn run() { with r[0] { } }' },

  // ── a whole project: public struct / region, mangled names, star import ──
  { name: 'module-visibility-and-star-import', src: join([
    ['main.emit', `
import lib.*
region local: Item[2]
export fn run() {
  items[0].n = 4
  local[1] = items[0]
  print(local[1].n + total(items))
}`],
    ['lib.emit', `
public struct Item { n: int, w: num }
public region items: Item[3]
public fn total(r: region Item) int {
  let s = 0
  for (let i = 0; i < r.length; i++) { s += r[i].n }
  return s
}`]]), expect: ['> 8'] },

  // ── the editor index: structs / regions without compiling ──
  { name: 'module-index-structs-and-regions', page: async page => page.evaluate(joinSrc => {
    const join = eval('(' + joinSrc + ')'), MARK = '//// file: ';
    const p = [];
    const text = join([['main.emit', 'import g\nstruct Local { a: u8, p: num[2] }\nregion grid: int[8 * 8]\nregion n: int[g.k]\nexport fn run() { }'], ['g.emit', 'public struct Ball { x: num, v: g.Vec }\npublic region balls: Ball[100]\nregion hidden: u8[3]\npublic fn f() {}'], ['h.emit', 'public region broken: u16[4 * 4]\npublic struct Flat { a: int, b: num }\nfn oops( {']]);
    const ix = _emitModuleIndex(text);
    const m = ix.modules;
    const eq = (a, b, w) => { if (JSON.stringify(a) !== JSON.stringify(b)) p.push(w + ': ' + JSON.stringify(a)); };
    eq(m.main.structs, [{ name: 'Local', public: false, fields: [{ name: 'a', type: 'u8' }, { name: 'p', type: 'num[2]' }] }], 'main structs');
    eq(m.main.regions, [{ name: 'grid', public: false, elem: 'int', length: 64 }, { name: 'n', public: false, elem: 'int', length: null }], 'main regions');
    eq(m.g.structs, [{ name: 'Ball', public: true, fields: [{ name: 'x', type: 'num' }, { name: 'v', type: 'g.Vec' }] }], 'g structs');
    eq(m.g.regions, [{ name: 'balls', public: true, elem: 'Ball', length: 100 }, { name: 'hidden', public: false, elem: 'u8', length: 3 }], 'g regions');
    eq(m.h.regions, [{ name: 'broken', public: true, elem: 'u16', length: 16 }], 'unparsable file regions (line by line)');
    eq(m.h.structs, [{ name: 'Flat', public: true, fields: [{ name: 'a', type: 'int' }, { name: 'b', type: 'num' }] }], 'unparsable file structs');
    const plain = _emitModuleIndex('export fn run() { }').modules.main;
    eq([plain.structs, plain.regions, JSON.stringify(plain).indexOf('structs')], [[], [], -1], 'no structs: empty and not enumerated');
    return p;
  }, join.toString()) },

  // ── programs without regions compile to the same bytes as before regions existed ──
  { name: 'byte-identical-without-regions', page: async (page, ctx) => {
    let old;
    try { old = execFileSync('git', ['show', BASE_COMMIT + ':emit-ide-1_32.html'], { cwd: path.join(__dirname, '..'), maxBuffer: 64 << 20 }).toString(); }
    catch (e) { return ['cannot read ' + BASE_COMMIT + ' with git: ' + e.message.slice(0, 120)]; }
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'emit-rg-')), 'old.html');
    fs.writeFileSync(tmp, old);
    const interop = fs.readFileSync(path.join(__dirname, 'run-interop.js'), 'utf8');
    const a = interop.indexOf('const TESTS = ['), b = interop.indexOf('\nasync function runTest');
    const progs = eval(interop.slice(interop.indexOf('const FAKE_LIB'), a) + interop.slice(a, b) + '\nTESTS.map(t => t.src.trim() + "\\n")');
    // Programs are matched by key (example name, or interop index), so examples added later — such as the
    // region-based 'memory' example — are compared only where the old file has the same example.
    const sums = async pg => pg.evaluate(progs => {
      const keys = Object.keys(EX).map(k => 'ex:' + k).concat(progs.map((_, i) => 'interop:' + i));
      const srcs = Object.keys(EX).map(k => EX[k]).concat(progs), out = {};
      for (let n = 0; n < srcs.length; n++) { const s = srcs[n], key = keys[n];
        try { const r = compile(s, 'wasm32'), props = {}; Object.keys(r.imports).forEach(k => { if (!/^\d+$/.test(k)) props[k] = r.imports[k]; }); out[key] = Array.from(r.wasm).join(',') + '|' + JSON.stringify(props); }
        catch (e) { out[key] = 'THROW ' + e.message; }
      }
      return out;
    }, progs);
    const now = await sums(page);
    const EXsrc = await page.evaluate(() => { const o = {}; Object.keys(EX).forEach(k => { o['ex:' + k] = EX[k]; }); return o; });
    const op = await ctx.browser.newPage();
    await op.route(/^https?:/, r => r.abort());
    await op.goto('file://' + tmp);
    await op.waitForFunction(() => typeof compile === 'function' && typeof EX === 'object');
    const before = await sums(op);
    await op.close();
    const p = [];
    const common = Object.keys(before).filter(k => k in now);
    if (common.length < 100 || common.length !== Object.keys(before).length) p.push('programs compared ' + common.length + ' of ' + Object.keys(before).length + ' in ' + BASE_COMMIT);
    // (rough-edges: a program that did not compile before — e.g. a non-literal top-level initialiser — may compile now)
    // Programs that use `await` get the await shadow stack (see _emitAwaitRoots), which replaced the earlier
    // statement-only spill: they are not compared (tests/run-memory.js covers them).
    const srcOf = k => (k in EXsrc ? EXsrc[k] : progs[Number(k.slice(8))]) || '';
    const awaits = common.filter(k => /\bawait\b/.test(srcOf(k)) && now[k] !== before[k]);
    common.forEach(k => { if (now[k] !== before[k] && awaits.indexOf(k) < 0 && !/^THROW /.test(before[k])) p.push(k + ' differs'); });
    const added = Object.keys(now).filter(k => !(k in before));
    ctx.note = (common.length - awaits.length) + ' programs (examples + interop) byte-identical to ' + BASE_COMMIT + (awaits.length ? '; ' + awaits.length + ' with await not compared (shadow stack)' : '') + (added.length ? '; not in ' + BASE_COMMIT + ': ' + added.join(', ') : '');
    return p;
  } },
];

async function newPage(browser, fileUrl, problems) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message.slice(0, 300)));
  await page.route(/^https?:/, route => route.abort());
  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof compileAndRun === 'function');
  await page.evaluate(RG_LIB);
  await page.evaluate(() => { try { closeWelcome(); } catch (e) {} });
  return page;
}

function matchLines(lines, expect, problems, from) {
  let at = from || 0;
  for (const want of expect) {
    const hit = lines.findIndex((l, i) => i >= at && (want instanceof RegExp ? want.test(l) : l === want));
    if (hit < 0) { problems.push('missing (or out of order): ' + want); return -1; }
    at = hit + 1;
  }
  return at;
}

async function runTest(browser, fileUrl, t) {
  const problems = [], ctx = { browser };
  const page = await newPage(browser, fileUrl, problems);
  let output = '';
  try {
    if (t.page) {
      problems.push(...((await t.page(page, ctx)) || []));
    } else if (t.diag) {
      const got = await page.evaluate(src => { try { const r = compile(src, 'wasm32'); return r.errors; } catch (e) { return [String(e.message)]; } }, t.src);
      if (got.length !== t.diag.length) problems.push('expected ' + t.diag.length + ' error(s), got ' + got.length + ': ' + JSON.stringify(got));
      else t.diag.forEach((w, i) => { if (!(w instanceof RegExp ? w.test(got[i]) : got[i] === w)) problems.push('error ' + (i + 1) + '\n        want ' + w + '\n        got  ' + got[i]); });
      output = got.join('\n');
    } else {
      await page.evaluate(src => { const ed = document.getElementById('editor'); ed.value = src; ed.dispatchEvent(new Event('input')); }, t.src.trim() + '\n');
      for (let i = 0; i < (t.rerun ? 2 : 1); i++) await page.evaluate(() => compileAndRun()).catch(e => problems.push('run rejected: ' + e.message.slice(0, 300)));
      await page.waitForTimeout(t.wait || 200);
      const before = await page.evaluate(() => document.getElementById('tab-output').innerText);
      if (t.after) problems.push(...((await t.after(page).catch(e => ['after() failed: ' + e.message.slice(0, 300)])) || []));
      const status = await page.evaluate(() => document.getElementById('sTxt').innerText);
      output = await page.evaluate(() => document.getElementById('tab-output').innerText);
      const lines = output.split('\n').map(l => l.trim());
      if (status !== (t.status || 'Done')) problems.push('status: ' + status + ' — ' + (lines.find(l => /✗/.test(l)) || ''));
      const end = matchLines(lines, t.expect, problems);
      if (t.expectAfter && end >= 0) matchLines(lines, t.expectAfter, problems, end);
      for (const [line, n] of Object.entries(t.count || {})) {
        const got = lines.filter(l => l === line).length;
        if (got !== n) problems.push('expected "' + line + '" ' + n + ' time(s), got ' + got);
      }
      const errLines = lines.filter(l => /^✗/.test(l));
      if (!t.errors && errLines.length) problems.push('unexpected error line: ' + errLines[0]);
      if (t.errors) for (const l of errLines) if (!t.expect.some(w => (w instanceof RegExp ? w.test(l) : l === w))) problems.push('unexpected error line: ' + l);
      void before;
    }
  } catch (e) { problems.push('test failed: ' + e.message.slice(0, 300)); }
  await page.close();
  return { ok: problems.length === 0, problems, output, note: ctx.note };
}

(async () => {
  const args = process.argv.slice(2);
  const file = path.resolve(args[0] && /\.html$/.test(args[0]) ? args.shift() : path.join(__dirname, '..', 'emit-ide-1_32.html'));
  const tests = TESTS.filter(t => !args.length || args.includes(t.name));
  const browser = await chromium.launch();
  let failed = 0;
  for (const t of tests) {
    const r = await runTest(browser, 'file://' + file, t);
    if (r.ok) console.log('PASS  ' + t.name + (r.note ? ' (' + r.note + ')' : ''));
    else { failed++; console.log('FAIL  ' + t.name + '\n      ' + r.problems.join('\n      ')); }
    if (process.env.VERBOSE || (!r.ok && process.env.VERBOSE !== '0')) console.log(r.output.split('\n').filter(l => l.trim()).map(l => '      | ' + l).join('\n'));
  }
  await browser.close();
  console.log('\n' + (tests.length - failed) + '/' + tests.length + ' region tests passed');
  process.exit(failed || !tests.length ? 1 : 0);
})();

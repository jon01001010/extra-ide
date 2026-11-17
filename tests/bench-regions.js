#!/usr/bin/env node
// Micro-benchmarks for memory regions, each next to the closest way Emit had before regions:
//   1. sum of a 1e6-element int region            vs  an Emit arr of the same length via xs[i]
//   2. balls[i].x += balls[i].vx over 1e5 structs  vs  the same data as JS objects through js handles
//   3. one 320x200 RGBA frame written into a u8 region and shown with screen()  vs  pixel() per pixel
//   4. constant indexes with and without compile-time check elision
//   5. what the dynamic bounds checks cost (compiled once more with window.__emitRegionNoChecks, a benchmark-only knob)
// Prints ns per element (median of REPS runs after a warm-up) and the size of each module.
//
//   node tests/bench-regions.js [path/to/emit-ide.html]      REPS=7 (default)
const { chromium } = require('playwright');
const path = require('path');

const REPS = Number(process.env.REPS || 7);
const BENCH_LIB = `window.benchLib = { objs: function (n) { var a = []; for (var i = 0; i < n; i++) a.push({ x: i * 0.5, vx: 0.25 }); return a; } };`;

const SRC = {
  regionSum: `
region big: int[1000000]
export fn setup() { for (let i = 0; i < big.length; i++) { big[i] = i } }
export fn bench() int {
  let s = 0
  for (let i = 0; i < big.length; i++) { s += big[i] }
  return s
}`,
  arrSum: `
mut xs: arr = 0
export fn setup() {
  xs = newArray(1000000)
  for (let i = 0; i < 1000000; i++) { xs[i] = i }
}
export fn bench() int {
  let s = 0
  for (let i = 0; i < 1000000; i++) { s += xs[i] }
  return s
}`,
  structStep: `
struct Ball { x: num, vx: num }
region balls: Ball[100000]
export fn setup() { for (let i = 0; i < balls.length; i++) { balls[i].x = i * 0.5  balls[i].vx = 0.25 } }
export fn bench() {
  for (let i = 0; i < balls.length; i++) { balls[i].x += balls[i].vx }
}`,
  structStepWith: `
struct Ball { x: num, vx: num }
region balls: Ball[100000]
export fn setup() { for (let i = 0; i < balls.length; i++) { balls[i].x = i * 0.5  balls[i].vx = 0.25 } }
export fn bench() {
  for (let i = 0; i < balls.length; i++) { with balls[i] as b { b.x += b.vx } }
}`,
  jsObjects: `
mut objs: js = null
export fn setup() { objs = benchLib.objs(100000) }
export fn bench() {
  for (let i = 0; i < 100000; i++) {
    let o = objs[i]
    o.x = o.x + o.vx
  }
}`,
  screenFill: `
region fb: u8[320 * 200 * 4]
mut t = 0
export fn setup() { screen(fb, 320, 200) }
export fn bench() {
  t++
  for (let y = 0; y < 200; y++) {
    for (let x = 0; x < 320; x++) {
      let o = (y * 320 + x) * 4
      fb[o] = x + t
      fb[o + 1] = y
      fb[o + 2] = t
      fb[o + 3] = 255
    }
  }
}`,
  pixelCalls: `
mut t = 0
export fn setup() { canvas(320, 200) }
export fn bench() {
  t++
  for (let y = 0; y < 200; y++) {
    for (let x = 0; x < 320; x++) {
      color((x + t) % 256, y, t % 256)
      pixel(x, y)
    }
  }
}`,
  constIndex: `
region lut: int[8]
export fn setup() { for (let i = 0; i < lut.length; i++) { lut[i] = i } }
export fn bench() int {
  let s = 0
  for (let i = 0; i < 1000000; i++) { s += lut[0] + lut[3] + lut[7] }
  return s
}`,
};

async function measure(page, name, flags) {
  return page.evaluate(async ({ src, flags, reps, name }) => {
    window.__emitRegionNoElide = !!flags.noElide; window.__emitRegionNoChecks = !!flags.noChecks;
    const out = document.getElementById('tab-output'); out.innerHTML = ''; _canvas = null; _ctx = null; _resetJsInterop();
    let r;
    try { r = compile(src, 'wasm32'); } finally { window.__emitRegionNoElide = false; window.__emitRegionNoChecks = false; }
    if (r.errors.length) return { error: r.errors.join('; ') };
    const inst = await WebAssembly.instantiate(await WebAssembly.compile(r.wasm), buildImportObject(r.imports, []));
    _wasmMem = inst.exports.memory; window._wi = inst; _frameQuiet = true;
    _emitCallExport(inst, 'setup', [], true);
    // the browser's clock is coarse (0.1 ms): every sample repeats the call until it took at least 40 ms
    const once = () => { const t0 = performance.now(); _emitCallExport(inst, 'bench', [], true); return performance.now() - t0; };
    once();
    let calls = 1, tw = 0;
    while ((tw = (() => { const t0 = performance.now(); for (let c = 0; c < calls; c++) _emitCallExport(inst, 'bench', [], true); return performance.now() - t0; })()) < 40) calls *= 2;
    const times = [], blit = [];
    for (let k = 0; k < reps; k++) {
      const t0 = performance.now();
      for (let c = 0; c < calls; c++) _emitCallExport(inst, 'bench', [], true);
      times.push((performance.now() - t0) / calls);
      if (name === 'screenFill') { const b0 = performance.now(); for (let c = 0; c < 50; c++) _rgBlitAll(); blit.push((performance.now() - b0) / 50); }
    }
    times.sort((a, b) => a - b); blit.sort((a, b) => a - b);
    return { ms: times[times.length >> 1], blitMs: blit.length ? blit[blit.length >> 1] : null, bytes: r.wasm.length };
  }, { src: SRC[name], flags, reps: REPS, name });
}

(async () => {
  const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'emit-ide-1_32.html'));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.route(/^https?:/, r => r.abort());
  await page.goto('file://' + file);
  await page.waitForFunction(() => typeof compile === 'function' && typeof _rgBlitAll === 'function');
  await page.evaluate(BENCH_LIB);
  await page.evaluate(() => { try { closeWelcome(); } catch (e) {} });
  const rows = [];
  const run = async (label, name, n, flags = {}) => {
    const m = await measure(page, name, flags);
    if (m.error) { rows.push([label, 'ERROR ' + m.error]); return m; }
    rows.push([label, (m.ms * 1e6 / n).toFixed(2) + ' ns/elem', m.ms.toFixed(3) + ' ms', m.bytes + ' B'].concat(m.blitMs !== null ? ['+ screen blit ' + m.blitMs.toFixed(3) + ' ms/frame'] : []));
    return m;
  };
  await run('1a int region sum, 1e6 (checked)', 'regionSum', 1e6);
  await run('1b   same, no bounds checks (knob)', 'regionSum', 1e6, { noChecks: true });
  await run('1c Emit arr xs[i] sum, 1e6', 'arrSum', 1e6);
  await run('2a balls[i].x += balls[i].vx, 1e5', 'structStep', 1e5);
  await run('2b   same, no bounds checks (knob)', 'structStep', 1e5, { noChecks: true });
  await run('2c with balls[i] as b { b.x += b.vx }', 'structStepWith', 1e5);
  await run('2d JS objects via js handles, 1e5', 'jsObjects', 1e5);
  await run('3a 320x200 RGBA into a region (per px)', 'screenFill', 64000);
  await run('3b   same, no bounds checks (knob)', 'screenFill', 64000, { noChecks: true });
  await run('3c color()+pixel() per pixel', 'pixelCalls', 64000);
  await run('4a 3 constant indexes x 1e6 (elided)', 'constIndex', 1e6);
  await run('4b   same, checks kept (no elision)', 'constIndex', 1e6, { noElide: true });
  await browser.close();
  const w = [0, 0, 0, 0, 0];
  rows.forEach(r => r.forEach((c, i) => { w[i] = Math.max(w[i] || 0, String(c).length); }));
  console.log('Memory region benchmarks (median of ' + REPS + ', headless Chromium)\n');
  rows.forEach(r => console.log(r.map((c, i) => String(c).padEnd(w[i] + 2)).join('')));
})();

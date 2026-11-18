#!/usr/bin/env node
// Checks the Timeline of an Emit IDE build in headless Chromium: recording of animated programs (regions, things,
// globals, maps, input), the ring buffer and its caps, exact restore from keyframes + XOR deltas (game, memory,
// stage, sprites, a program with globals of every type, a map program), scrubbing, pause / step / resume, the
// fork after a Memory-tab poke, the library-objects note, input ticks, the per-frame cost, the layout at 360 px,
// the Off state (nothing recorded, no cost), the help section and drawer card, and that exported pages have no
// Timeline. About half of the checks run in a phone viewport with touch (360 px wide), the rest on a desktop
// viewport. The run is offline: every network request is aborted.
//
//   node tests/run-timeline.js [path/to/emit-ide.html]
//
// Exit code 0 when every check passes.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

let failed = 0, passed = 0;
function check(label, ok, detail) {
  if (ok) { passed++; console.log('PASS  ' + label); }
  else { failed++; console.log('FAIL  ' + label + (detail !== undefined ? '\n      ' + String(detail).slice(0, 900) : '')); }
}

const PHONE = { viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true };
const DESK = { viewport: { width: 1200, height: 800 } };
const COST_BUDGET_MS = 1.0;   // average recording cost per frame for the bundled examples

// A program with a global of every type the compiler handles (int, num, bool, str, f32, js) and
// scalar and struct regions of several element types.
const SYN = `struct P { x: num, y: f32, k: i16, ok: bool, id: int }
region cells: i32[16]
region ps: P[4]
region bytes: u8[8]
mut gi = 0
mut gn = 0.5
mut gb = false
mut gs = "a"
mut gf: f32 = 1.5
mut gd: js = null
export fn go() {
  gd = document.body
  canvas(40, 40)
  animate()
}
export fn frame() {
  gi += 1
  gn = gn * 1.01 + 0.25
  gb = !gb
  gs = "s" + intToStr(gi)
  if (gb) { gf = 2.25 } else { gf = 1.5 }
  cells[gi % 16] = gi * 7
  ps[gi % 4].x = gn
  ps[gi % 4].y = 0.5
  ps[gi % 4].k = gi
  ps[gi % 4].ok = gb
  ps[gi % 4].id = gi * 1000000000
  bytes[gi % 8] = gi
  clear()
  rect(gi % 40, 10, 4, 4)
}
`;
// Tiles change with setTile; no regions (so the Timeline starts off and is switched on)
const MAPSYN = `//// file: main.emit
mut t = 0
export fn go() {
  canvas(32, 24)
  animate()
}
export fn frame() {
  t += 1
  if (t % 3 == 0) { setTile(lvl, 1 + t % 2, 1, "#") } else { setTile(lvl, 1 + t % 2, 1, ".") }
  clear()
  drawMap(lvl)
}
//// file: maps.emit
map lvl: 4x3, tile 8
  legend # wall solid #333333,  . floor #111111
  rows
    "####"
    "#..#"
    "####"
`;
// Only globals, no regions and no library: the Timeline is offered, not on
const PLAIN = 'mut n = 0\nexport fn go() {\n  canvas(20, 20)\n  animate()\n}\nexport fn frame() {\n  n += 1\n  clear()\n  rect(n % 20, 5, 3, 3)\n}\n';

async function openIde(browser, fileUrl, mode) {
  const ctx = await browser.newContext(mode);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message.slice(0, 300)));
  page.on('dialog', d => d.accept());
  await page.route(/^https?:/, route => route.abort());
  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof compileAndRun === 'function' && typeof _projLoad === 'function' && typeof EX === 'object');
  await page.waitForTimeout(150);
  await page.evaluate(() => { try { closeWelcome(); } catch (e) {} });
  return page;
}
const setSource = (page, text) => page.evaluate(t => { _projLoad(t); }, text);
async function run(page, src, opts) {
  opts = opts || {};
  await page.evaluate(o => { _tl.pref = o.pref === undefined ? null : o.pref; _timelineConfig({ key: 30, maxBytes: 32 * 1048576, maxFrames: 600 }); }, opts);
  await setSource(page, src);
  await page.evaluate(() => compileAndRun());
  await page.waitForTimeout(opts.wait || 600);
}
const ex = (page, name) => page.evaluate(n => EX[n], name);
// Wraps _tlRecord (test only): a direct copy of the state at every frame whose number is ≡ 2 (mod 5)
const CAPTURE = (px) => page => page.evaluate(px => {
  window.__cap = {};
  if (!window.__tlRecOrig) window.__tlRecOrig = _tlRecord;
  const orig = window.__tlRecOrig;
  window._tlRecord = function () {
    const r = orig.apply(this, arguments);
    const f = _tl.frames[_tl.frames.length - 1];
    if (f && f.n % 5 === 2 && !arguments[0]) {
      const u8 = new Uint8Array(_wasmMem.buffer);
      __cap[f.n] = {
        regs: _tl.regs.map(R => u8.slice(R.base, R.base + R.len)),
        fz: _tl.regs.map(R => u8[R.desc + 8]),
        g: _tl.gl.map(x => x.str ? 'str:' + (x.G.value ? _readStr(x.G.value) : '') : String(x.G.value)),
        maps: typeof _stMaps !== 'undefined' ? _stMaps.map(m => m.rows.map(r => r.join('')).join('\n')) : [],
        hud: typeof _lgMeta !== 'undefined' && _lgMeta ? JSON.stringify([_lgShows, _lgSay, _lgTick]) : '',
        px: px && _canvas ? _canvas.toDataURL() : null,
        scr: px ? _rgScreens.map(s => s.cv.toDataURL()) : [],
      };
    }
    return r;
  };
}, px);
// Drive n frames synchronously (the rAF loop may add a few more in between calls)
const frames = (page, n) => page.evaluate(n => { for (let i = 0; i < n; i++) _emitFrame(); }, n);
// Show every captured frame still in the ring, in the given order, and compare with the direct copy
const verify = (page, order, px) => page.evaluate(({ order, px }) => {
  const F = _tl.frames, out = { checked: 0, bad: [], pxChecked: 0, pxBad: [] };
  let idx = F.map((f, i) => i).filter(i => __cap[F[i].n]);
  if (order === 'back') idx.reverse();
  if (order === 'shuffle') { let s = 7; idx.sort(() => ((s = (s * 1103515245 + 12345) & 0x7fffffff) % 3) - 1); }
  for (const i of idx) {
    const c = __cap[F[i].n];
    _tlShow(i);
    const u8 = new Uint8Array(_wasmMem.buffer);
    out.checked++;
    _tl.regs.forEach((R, r) => {
      const a = c.regs[r];
      for (let b = 0; b < R.len; b++) if (u8[R.base + b] !== a[b]) { out.bad.push('frame ' + F[i].n + ' ' + R.name + '[' + b + '] ' + u8[R.base + b] + ' != ' + a[b]); break; }
      if (u8[R.desc + 8] !== c.fz[r]) out.bad.push('frame ' + F[i].n + ' freeze flag of ' + R.name);
    });
    const g = _tl.gl.map(x => x.str ? 'str:' + (x.G.value ? _readStr(x.G.value) : '') : String(x.G.value));
    g.forEach((v, k) => { if (v !== c.g[k]) out.bad.push('frame ' + F[i].n + ' global ' + _tl.gl[k].name + ' ' + v + ' != ' + c.g[k]); });
    const maps = typeof _stMaps !== 'undefined' ? _stMaps.map(m => m.rows.map(r => r.join('')).join('\n')) : [];
    if (JSON.stringify(maps) !== JSON.stringify(c.maps)) out.bad.push('frame ' + F[i].n + ' maps');
    if (c.hud && JSON.stringify([_lgShows, _lgSay, _lgTick]) !== c.hud) out.bad.push('frame ' + F[i].n + ' HUD ' + JSON.stringify([_lgShows, _lgSay, _lgTick]) + ' != ' + c.hud);
    if (px && c.px) {
      out.pxChecked++;
      if (_canvas.toDataURL() !== c.px) out.pxBad.push(F[i].n);
      _rgScreens.forEach((s, k) => { if (c.scr[k] && s.cv.toDataURL() !== c.scr[k]) out.pxBad.push(F[i].n + ' screen ' + k); });
    }
  }
  return out;
}, { order, px });
const tlState = page => page.evaluate(() => ({ on: _tl.on, ready: _tl.ready, paused: _tl.paused, n: _tl.frames.length, pos: _tl.pos, bytes: _tl.bytes, cnt: _frameCount,
  first: _tl.frames[0] ? _tl.frames[0].n : -1, last: _tl.frames.length ? _tl.frames[_tl.frames.length - 1].n : -1, cur: _tl.frames[_tl.pos] ? _tl.frames[_tl.pos].n : -1,
  keys: _tl.frames.filter(f => f.full).length, cost: _tl.cost, libs: _tl.libs, B: _tl.B,
  lab: (document.querySelector('#tlBar .tl-lab') || {}).textContent, what: (document.querySelector('#tlBar .tl-what') || {}).textContent,
  note: (document.querySelector('#tlBar .tl-note.show') || {}).textContent || '', rec: (document.querySelector('#tlBar [data-tl="rec"]') || {}).textContent,
  info: (document.querySelector('#tlBar .tl-info') || {}).textContent }));
async function tap(page, sel, mobile) {
  const el = await page.$(sel);
  if (!el) throw new Error('no element ' + sel);
  await el.scrollIntoViewIfNeeded();
  if (mobile) await el.tap(); else await el.click();
  await page.waitForTimeout(60);
}
const overflow = page => page.evaluate(() => ({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, ob: document.querySelector('.out-body').scrollWidth - document.querySelector('.out-body').clientWidth, w: innerWidth }));

// ── exact restore (desktop) ──
async function exactChecks(browser, fileUrl) {
  const page = await openIde(browser, fileUrl, DESK);
  const P = 'desktop: ';
  let r;
  for (const [name, src, opts] of [['memory', await ex(page, 'memory'), {}], ['game', await ex(page, 'game'), {}], ['stage', await ex(page, 'stage'), { pref: true }],
    ['sprites', await ex(page, 'sprites'), {}], ['every-type program', SYN, {}], ['map program', MAPSYN, { pref: true }]]) {
    const px = name !== 'memory';   // canvas pictures: compared for all but the 96 KB sand (its screen is compared through the bytes)
    await run(page, src, opts);
    await page.evaluate(() => { stopProgram(); _tlResume(); });   // after Stop, ▶ starts the frames again; now the test drives them
    await page.evaluate(() => { _animRunning = false; });
    await page.evaluate(() => _timelineConfig({ key: 30, maxFrames: 90 }));
    await CAPTURE(px)(page);
    await page.evaluate(() => { _tl.paused = false; });
    // input on some frames: a key held for a while, a touch
    await page.evaluate(() => { for (let i = 0; i < 40; i++) _emitFrame(); _keys[39] = 1; for (let i = 0; i < 25; i++) _emitFrame(); _keys[39] = 0; _touch.on = 1; for (let i = 0; i < 10; i++) _emitFrame(); _touch.on = 0; for (let i = 0; i < 125; i++) _emitFrame(); });
    let s = await tlState(page);
    check(P + name + ': recording is on and the ring keeps the last 90 frames (maxFrames)', s.on && s.n === 90 && s.last === s.cnt && s.last - s.first === 89, JSON.stringify(s));
    check(P + name + ': the oldest record is a keyframe; keyframes every 30 frames', await page.evaluate(() => !!_tl.frames[0].full && _tl.frames.filter(f => f.full).length >= 3 && _tl.frames.filter(f => f.full).length <= 5), JSON.stringify(s));
    await page.evaluate(() => _tlPause());
    for (const order of ['back', 'fwd', 'shuffle']) {
      const r = await verify(page, order, px && order === 'shuffle');
      check(P + name + ': restore is exact (' + order + '): regions, freeze flags, globals' + (name === 'game' ? ', HUD' : '') + (name === 'map program' ? ', map tiles' : '') + ' equal the copy taken at the frame (' + r.checked + ' frames)', r.checked >= 15 && !r.bad.length, JSON.stringify(r.bad.slice(0, 6)));
      if (px && order === 'shuffle') check(P + name + ': the picture redrawn while paused equals the one drawn live (' + r.pxChecked + ' frames, ' + (await page.evaluate(() => _tl.how || 'blit')) + ')', r.pxChecked >= 15 && !r.pxBad.length, JSON.stringify(r.pxBad.slice(0, 8)));
    }
    if (name === 'every-type program') {
      const g = await page.evaluate(() => _tl.gl.map(x => x.name + ':' + x.t + (x.ref ? ':ref' : '')));
      check(P + name + ': every global is recorded with its type (int, num, bool, str, f32, js)', ['gi:int', 'gn:num', 'gb:bool', 'gs:str:ref', 'gf:f32', 'gd:js:ref'].every(x => g.includes(x)), JSON.stringify(g));
      // a str global whose block was released: the text comes back in a new block
      const r = await page.evaluate(() => { const i = _tl.frames.length - 60; const want = __cap[_tl.frames[i].n]; for (let k = 0; k < 5; k++) _gcCollect && _gcCollect(null); _tlShow(i); const x = _tl.gl.find(x => x.name === 'gs'); return { got: _readStr(x.G.value), want: want ? want.g[_tl.gl.indexOf(x)] : null, n: _tl.frames[i].n }; }).catch(e => ({ err: e.message }));
      check(P + name + ': a str variable gets its text back even after a collection', r.want === null || 'str:' + r.got === r.want, JSON.stringify(r));
      s = await tlState(page);
      check(P + name + ': a js variable holding a library object shows the note once', s.libs && s.note === 'Timeline restores memory and globals only — library objects (three.js, …) are not rewound', JSON.stringify(s));
    }
    if (name === 'map program') check(P + name + ': setTile changes are recorded (the map differs between frames)', await page.evaluate(() => new Set(_tl.frames.map(f => f.maps)).size >= 2));
    if (name === 'memory' || name === 'game' || name === 'stage') check(P + name + ': no library note', !(await tlState(page)).note);
    // input ticks
    const t = await page.evaluate(() => ({ labs: [...new Set(_tl.frames.map(f => f.lab).filter(Boolean))], ticks: document.querySelectorAll('#tlBar .tl-ticks i').length }));
    check(P + name + ': frames with input are labelled (key →, touch) and ticked on the slider', t.labs.some(l => /key →/.test(l)) && t.labs.some(l => /touch/.test(l)) && t.ticks >= 2, JSON.stringify(t));
    await page.evaluate(() => stopProgram());
  }
  // cost of recording, the examples running live
  const costs = {};
  for (const name of ['game', 'memory', 'stage', 'sprites']) {
    await run(page, await ex(page, name), { pref: true, wait: 2500 });
    const c = await page.evaluate(() => _tl.cost);
    costs[name] = { avg: +(c.sum / c.n).toFixed(3), max: +c.max.toFixed(2), n: c.n };
    await page.evaluate(() => stopProgram());
  }
  console.log('      recording cost per frame (ms): ' + JSON.stringify(costs));
  check(P + 'recording costs under ' + COST_BUDGET_MS + ' ms per frame on average for game, memory, stage, sprites', Object.values(costs).every(c => c.n >= 60 && c.avg < COST_BUDGET_MS), JSON.stringify(costs));

  // the byte cap: keeps at least the newest frames, never more than maxBytes
  await run(page, await ex(page, 'memory'), {});
  await page.evaluate(() => { stopProgram(); _tlResume(); _animRunning = false; _timelineConfig({ maxBytes: 600 * 1024, maxFrames: 600 }); for (let i = 0; i < 200; i++) _emitFrame(); });
  let s = await tlState(page);
  check(P + 'the byte cap (600 KB here) bounds the ring; the oldest record stays a keyframe', s.bytes <= 600 * 1024 && s.n >= 10 && s.n < 200 && (await page.evaluate(() => !!_tl.frames[0].full)), JSON.stringify(s));
  await page.evaluate(() => _timelineConfig({ maxBytes: 32 * 1048576 }));

  // Off: nothing recorded, no recording work at all
  await run(page, PLAIN, {});
  s = await tlState(page);
  check(P + 'a program without regions: the Timeline is offered (off), nothing recorded', s.ready && !s.on && s.n === 0 && /Timeline off/.test(s.rec), JSON.stringify(s));
  r = await page.evaluate(() => { let calls = 0; const a = _tlRecord, b = _tlInput, c = _tlDiff; window._tlRecord = function () { calls++; return a.apply(this, arguments); }; window._tlInput = function () { calls++; return b.apply(this, arguments); }; window._tlDiff = function () { calls++; return c.apply(this, arguments); };
    const n0 = _tl.cost.n; for (let i = 0; i < 50; i++) _emitFrame(); const out = { calls, cost: _tl.cost.n - n0, frames: _tl.frames.length }; window._tlRecord = a; window._tlInput = b; window._tlDiff = c; return out; });
  check(P + 'while off, frames run without any recording call and nothing is stored', r.calls === 0 && r.cost === 0 && r.frames === 0, JSON.stringify(r));
  await tap(page, '#tlBar [data-tl="rec"]', false);
  await frames(page, 20);
  s = await tlState(page);
  check(P + 'tapping "○ Timeline off" starts recording', s.on && s.n >= 20 && /Timeline on/.test(s.rec), JSON.stringify(s));
  await tap(page, '#tlBar [data-tl="rec"]', false);
  s = await tlState(page);
  check(P + 'switching it off again forgets the frames', !s.on && s.n === 0 && s.bytes === 0, JSON.stringify(s));
  await page.evaluate(() => { _tl.pref = null; stopProgram(); });

  // a frame() that awaits is not recorded
  await run(page, 'export fn go() {\n  canvas(20, 20)\n  animate()\n}\nexport fn frame() {\n  await sleep(1)\n  clear()\n}\n', { pref: true });
  s = await tlState(page);
  check(P + 'an async frame(): not recorded, the bar says why', !s.on && s.n === 0 && /await/.test(s.info), JSON.stringify(s));
  await page.evaluate(() => stopProgram());

  // pause / step / resume / fork-by-resume (desktop, mouse)
  await run(page, await ex(page, 'memory'), { wait: 1200 });
  await tap(page, '#tlBar [data-tl="play"]', false);
  s = await tlState(page);
  await page.waitForTimeout(300);
  let s2 = await tlState(page);
  check(P + '⏸ pauses the frames: frame() is no longer called', s.paused && s2.cnt === s.cnt && s2.n === s.n && /▶/.test(await page.textContent('#tlBar [data-tl="play"]')), JSON.stringify([s, s2]));
  await tap(page, '#tlBar [data-tl="fwd"]', false);
  s2 = await tlState(page);
  check(P + '⏭ at the newest frame runs exactly one frame and records it', s2.cnt === s.cnt + 1 && s2.n === Math.min(600, s.n + 1) && s2.cur === s2.cnt && s2.paused, JSON.stringify([s, s2]));
  await tap(page, '#tlBar [data-tl="back"]', false); await tap(page, '#tlBar [data-tl="back"]', false); await tap(page, '#tlBar [data-tl="back"]', false);
  s = await tlState(page);
  check(P + '⏮ ×3 steps back three frames; the label shows the frame number', s.cur === s2.cnt - 3 && s.lab === '#' + s.cur && /frame/.test(s.what), JSON.stringify(s));
  const statsAt = await page.evaluate(() => _emitRegionRead(_emitRegions().find(r => r.name === 'stats').id, 1));
  await tap(page, '#tlBar [data-tl="fwd"]', false);
  s2 = await tlState(page);
  check(P + '⏭ in the past shows the next recorded frame (no new frame runs)', s2.cur === s.cur + 1 && s2.cnt === s.cnt && s2.n === s.n, JSON.stringify(s2));
  await tap(page, '#tlBar [data-tl="back"]', false);
  check(P + 'the restored frame counter in memory is that frame\'s (stats[1])', statsAt === (await page.evaluate(() => _emitRegionRead(_emitRegions().find(r => r.name === 'stats').id, 1))), String(statsAt));
  // the slider
  await page.evaluate(() => { const sl = document.querySelector('#tlBar .tl-slider'); sl.value = String(Math.max(0, _tl.frames.length - 40)); sl.dispatchEvent(new Event('input')); });
  s = await tlState(page);
  check(P + 'moving the slider shows that frame', s.pos === s.n - 40 && s.lab === '#' + s.cur, JSON.stringify(s));
  const before = s;
  await tap(page, '#tlBar [data-tl="resume"]', false);
  s = await tlState(page);
  check(P + '⟲ resume from here discards the recorded future and continues from the shown frame', !s.paused && s.n <= before.pos + 3 && s.first === before.first && (await page.evaluate(n => _tl.frames.some(f => f.n === n), before.cur)), JSON.stringify([before, s]));
  await page.waitForTimeout(400);
  s2 = await tlState(page);
  check(P + '…and goes on recording from there (frame numbers continue from the fork)', s2.n > s.n && s2.last > before.cur && s2.last < before.last + 30, JSON.stringify([before, s2]));
  // running while not paused: the slider pauses
  await page.evaluate(() => { const sl = document.querySelector('#tlBar .tl-slider'); sl.value = '3'; sl.dispatchEvent(new Event('input')); });
  s = await tlState(page);
  check(P + 'dragging the slider while running pauses on that frame', s.paused && s.pos === 3, JSON.stringify(s));
  // ▶ in the past resumes from there as well
  await tap(page, '#tlBar [data-tl="play"]', false);
  s = await tlState(page);
  check(P + '▶ on an older frame resumes from it (the frames after it are gone)', !s.paused && s.n <= 6, JSON.stringify(s));
  // Stop: paused; ▶ starts the frames again
  await page.evaluate(() => stopProgram());
  s = await tlState(page);
  check(P + 'after Stop the Timeline can still scrub (paused at the newest frame)', s.paused && s.n > 0, JSON.stringify(s));
  await tap(page, '#tlBar [data-tl="back"]', false);
  await tap(page, '#tlBar [data-tl="play"]', false);
  await page.waitForTimeout(300);
  s2 = await tlState(page);
  check(P + '…and ▶ after Stop continues the program from the shown frame', !s2.paused && s2.cnt > s.cnt - 1 && (await page.evaluate(() => _animRunning)), JSON.stringify([s, s2]));
  await page.evaluate(() => stopProgram());

  // the Memory tab while paused shows the restored values and "⏸ frame N"
  await page.evaluate(() => { _tlResume(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { _tlPause(); _tlShow(_tl.frames.length - 10); showOTab(document.querySelector('.otab[data-t="memory"]')); });
  await page.waitForTimeout(400);
  r = await page.evaluate(() => { const c = _mem.cards.find(c => c.r.name === 'stats'); return { live: document.querySelector('#tab-memory .mlive').textContent, v: c && c.body.querySelectorAll('.mc .mv')[1].textContent, want: String(_emitRegionRead(c.r.id, 1)), n: _tl.frames[_tl.pos].n }; });
  check(P + 'the Memory tab shows the restored frame (⏸ frame N, its values)', r.live === '⏸ frame ' + r.n && r.v === r.want, JSON.stringify(r));
  await page.evaluate(() => { showOTab(document.querySelector('.otab[data-t="output"]')); stopProgram(); });

  // exported pages have no Timeline
  const src = await ex(page, 'memory');
  const html = await page.evaluate(s => { const r = compile(s, 'wasm32'); return _exportHtml(_exportProgram(s, r)); }, src);
  check(P + 'an exported page contains no Timeline code', !/_tlRecord|tl-bar|_tlSetup|TIMELINE/.test(html), (html.match(/.{40}(_tlRecord|tl-bar|_tlSetup|TIMELINE).{40}/) || [''])[0]);
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'emit-tl-')), 'memory.html');
  fs.writeFileSync(tmp, html);
  const ep = await page.context().newPage();
  const eErr = []; ep.on('pageerror', e => eErr.push(e.message));
  await ep.route(/^https?:/, route => route.abort());
  await ep.goto('file://' + tmp);
  await ep.waitForTimeout(1200);
  r = await ep.evaluate(() => ({ frames: typeof _frameCount === 'number' ? _frameCount : -1, tl: typeof _tl, bar: !!document.querySelector('.tl-bar'), btns: document.querySelectorAll('#tab-output button').length }));
  check(P + 'the exported page runs its frames as before, without a Timeline bar or recorder', r.frames > 20 && r.tl === 'undefined' && !r.bar && r.btns === 3 && !eErr.length, JSON.stringify(r) + eErr.join('|'));
  await ep.close();

  check(P + 'no page errors', !page.errors.length, page.errors.join(' | '));
  await page.context().close();
}

// ── phone: layout, touch, poke fork, help, drawer ──
async function phoneChecks(browser, fileUrl) {
  const page = await openIde(browser, fileUrl, PHONE);
  const P = 'phone: ';
  const mobile = true;
  await run(page, await ex(page, 'memory'), { wait: 1500 });
  let s = await tlState(page);
  check(P + 'the memory example (regions) runs with the Timeline on by default', s.ready && s.on && s.n > 20, JSON.stringify(s));
  let r = await page.evaluate(() => {
    const b = document.getElementById('tlBar'), out = document.getElementById('tab-output'), kids = [...out.children], i = kids.indexOf(b);
    const scr = out.querySelector('canvas[data-emit-screen]'), btn = [...out.querySelectorAll('button')].filter(x => !b.contains(x));
    return { inOut: b.parentNode === out, afterScreen: !!scr && !!(scr.compareDocumentPosition(b) & 4), afterButtons: btn.every(x => !!(x.compareDocumentPosition(b) & 4)), firstBtnIsProgram: out.querySelector('button') === btn[0], pos: getComputedStyle(b).position, bottom: getComputedStyle(b).bottom };
  });
  check(P + 'the bar is in the Output, under the program\'s screen and buttons (the first button stays the program\'s)', r.inOut && r.afterScreen && r.afterButtons && r.firstBtnIsProgram, JSON.stringify(r));
  check(P + 'on a phone the bar sticks to the bottom', r.pos === 'sticky' && r.bottom === '0px', JSON.stringify(r));
  r = await page.evaluate(() => { const b = document.getElementById('tlBar').getBoundingClientRect(), ob = document.querySelector('.out-body').getBoundingClientRect(); return { bBottom: Math.round(b.bottom), obBottom: Math.round(ob.bottom), h: Math.round(b.height) }; });
  check(P + 'the sticky bar is visible at the bottom of the output area', r.bBottom <= r.obBottom + 1 && r.bBottom >= r.obBottom - r.h - 40, JSON.stringify(r));
  let o = await overflow(page);
  check(P + 'no horizontal overflow at 360 px (page and output)', o.doc <= o.w && o.body <= o.w && o.ob <= 0, JSON.stringify(o));
  r = await page.evaluate(() => [...document.querySelectorAll('#tlBar button, #tlBar .tl-slider')].filter(e => e.offsetParent).map(e => { const b = e.getBoundingClientRect(); return [e.getAttribute('data-tl') || 'slider', Math.round(b.width), Math.round(b.height), Math.round(b.right)]; }));
  check(P + 'every control of the bar is at least 40 px wide and tall (slider: 28 px track in a 40 px row) and inside the screen', r.every(c => (c[0] === 'slider' ? c[2] >= 28 : c[2] >= 40 && c[1] >= 40) && c[3] <= 360), JSON.stringify(r));
  r = await page.evaluate(() => [...document.querySelectorAll('#tlBar button')].map(b => b.getAttribute('aria-label') || b.textContent));
  check(P + 'the buttons say what they do (⏸ Pause, ⏮ back, ⏭ forward, ⟲ resume from here, ● Timeline on)', r.join('|') === 'Pause|Step back one frame|Step forward one frame|⟲ resume from here|● Timeline on', r.join('|'));
  await page.screenshot({ path: path.join(__dirname, 'timeline-phone.png') });

  // touch on the screen: input on the frames, ticks on the slider
  const box = await (await page.$('canvas[data-emit-screen]')).boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + 10);
  await page.evaluate(() => { _touch.on = 1; });
  await page.waitForTimeout(250);
  await page.evaluate(() => { _touch.on = 0; });
  await page.waitForTimeout(200);
  r = await page.evaluate(() => ({ labs: _tl.frames.filter(f => /touch/.test(f.lab)).length, ticks: document.querySelectorAll('#tlBar .tl-ticks i').length }));
  check(P + 'a touch marks its frames: label "touch x,y" and ticks under the slider', r.labs >= 3 && r.ticks >= 1, JSON.stringify(r));
  // pause with a tap, step back, and the frame's input shows in the line under the bar
  await tap(page, '#tlBar [data-tl="play"]', mobile);
  const k = await page.evaluate(() => _tl.frames.findIndex(f => /touch/.test(f.lab)));
  await page.evaluate(k => { const sl = document.querySelector('#tlBar .tl-slider'); sl.value = String(k); sl.dispatchEvent(new Event('input')); }, k);
  s = await tlState(page);
  check(P + 'on a frame with input the line under the bar names it', s.paused && /input: touch \d+,\d+/.test(s.what) && /frame \d+ of \d+/.test(s.what), JSON.stringify(s));
  r = await page.evaluate(() => document.querySelector('#tlBar .tl-bar, #tlBar').classList.contains('tl-past'));
  check(P + 'an older frame is marked as the past (violet label)', r);
  o = await overflow(page);
  check(P + 'paused in the past: still no horizontal overflow', o.doc <= o.w && o.ob <= 0, JSON.stringify(o));
  await tap(page, '#tlBar [data-tl="back"]', mobile);
  s = await tlState(page);
  check(P + 'tapping ⏮ steps back one frame', s.pos === k - 1, JSON.stringify(s));

  // fork: poke on the Memory tab while paused in the past
  await page.evaluate(() => { _tlShow(_tl.frames.length - 30); });
  const before = await tlState(page);
  await page.evaluate(() => { showOTab(document.querySelector('.otab[data-t="memory"]')); });
  await page.waitForTimeout(300);
  const cardSel = await page.evaluate(() => '.mcard[data-n="' + _mem.cards.find(c => c.r.name === 'stats').n + '"]');
  await tap(page, cardSel + ' .mc >> nth=0', mobile);
  const inp = await page.$(cardSel + ' .medit input');
  await inp.fill('4242');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  s = await tlState(page);
  r = await page.evaluate(() => ({ fork: !!_tl.frames[_tl.pos].fork, lab: _tl.frames[_tl.pos].lab, v: _emitRegionRead(_emitRegions().find(r => r.name === 'stats').id, 0) }));
  check(P + 'a poke while paused in the past forks: the frames after it are discarded, the frame is recorded again with the poke', s.paused && s.n === before.pos + 1 && s.pos === before.pos && s.cur === before.cur && r.fork && /poke/.test(r.lab) && r.v === 4242, JSON.stringify([before, s, r]));
  // scrub away and back: the poked frame keeps the poke
  await page.evaluate(() => { _tlShow(_tl.pos - 5); _tlShow(_tl.frames.length - 1); });
  r = await page.evaluate(() => _emitRegionRead(_emitRegions().find(r => r.name === 'stats').id, 0));
  check(P + 'the poked frame keeps the poke when scrubbed away and back', r === 4242, String(r));
  await page.evaluate(() => { showOTab(document.querySelector('.otab[data-t="output"]')); });
  await page.waitForTimeout(100);
  await tap(page, '#tlBar [data-tl="play"]', mobile);
  await page.waitForTimeout(600);
  r = await page.evaluate(() => ({ v: _emitRegionRead(_emitRegions().find(r => r.name === 'stats').id, 0), n: _tl.frames.length, paused: _tl.paused, ticks: document.querySelectorAll('#tlBar .tl-ticks i.tl-fk').length }));
  check(P + 'resuming continues from the poked state (grains poured go on from 4242)', !r.paused && r.v >= 4243 && r.n > before.pos + 5, JSON.stringify(r));
  check(P + 'the fork is a yellow tick on the slider', r.ticks >= 1, JSON.stringify(r));
  await page.evaluate(() => stopProgram());

  // things (LOGIC) on a phone: scrub redraws the stage from the regions
  await run(page, await ex(page, 'game'), { wait: 1500 });
  s = await tlState(page);
  check(P + 'the game (things) runs with the Timeline on', s.on && s.n > 20 && s.B > 0, JSON.stringify(s));
  await tap(page, '#tlBar [data-tl="play"]', mobile);
  const img0 = await page.evaluate(() => _canvas.toDataURL());
  await page.evaluate(() => { const sl = document.querySelector('#tlBar .tl-slider'); sl.value = '0'; sl.dispatchEvent(new Event('input')); });
  r = await page.evaluate(() => ({ img: _canvas.toDataURL(), how: _tl.how, pos: _tl.pos }));
  check(P + 'scrubbing the game to its first recorded frame redraws the stage from that frame (things drawn, not replayed)', r.how === 'drawn' && r.pos === 0 && r.img !== img0, JSON.stringify({ how: r.how, pos: r.pos }));
  await page.evaluate(() => { const sl = document.querySelector('#tlBar .tl-slider'); sl.value = String(_tl.frames.length - 1); sl.dispatchEvent(new Event('input')); });
  r = await page.evaluate(() => _canvas.toDataURL());
  check(P + '…and back to the newest frame gives the picture it had when paused', r === img0);
  o = await overflow(page);
  check(P + 'the game with its bar: no horizontal overflow', o.doc <= o.w && o.ob <= 0, JSON.stringify(o));
  await page.evaluate(() => stopProgram());

  // on-screen controls (stage) sit above the sticky bar
  await run(page, await ex(page, 'stage'), { pref: true, wait: 1200 });
  r = await page.evaluate(() => { const c = document.querySelector('#tab-output .emit-controls'), b = document.getElementById('tlBar'); return { c: !!c, bottom: c && c.style.bottom, h: b && b.offsetHeight }; });
  check(P + 'the on-screen controls move up by the height of the sticky bar', r.c && r.bottom === r.h + 'px', JSON.stringify(r));
  await page.evaluate(() => stopProgram());

  // help and drawer
  r = await page.evaluate(() => { const h = document.getElementById('helpOverlay'); const hs = [...h.querySelectorAll('h2')]; const e = hs.find(x => x.textContent === 'Timeline'); let t = ''; if (e) { let n = e.nextElementSibling; while (n && n.tagName !== 'H2') { t += n.textContent + '\n'; n = n.nextElementSibling; } } return t; });
  check(P + 'the help has a "Timeline" section (scrub, step, fork, ticks, limits, library objects)', /resume from here/.test(r) && /forks/.test(r) && /600 frames/.test(r) && /32 MB/.test(r) && /not rewound/.test(r) && /tick/.test(r) && /re-run/.test(r), r.slice(0, 300));
  await page.evaluate(() => { showView('edit'); _drawerOpen(); });
  await page.waitForTimeout(200);
  r = await page.evaluate(() => { const c = document.querySelector('#drawer .drw-card[data-tool="timeline"]'); return c ? [c.querySelector('.drw-cl').textContent, c.querySelector('.drw-cd').textContent] : null; });
  check(P + 'the drawer has a Timeline card', r && r[0] === 'Timeline' && /Scrub/.test(r[1]), JSON.stringify(r));
  await tap(page, '#drawer .drw-card[data-tool="timeline"]', mobile);
  await page.waitForTimeout(300);
  r = await page.evaluate(() => ({ drawer: _drawerIsOpen(), run: document.getElementById('pnl-run').className, tab: document.querySelector('.otab.active').dataset.t, bar: !!document.getElementById('tlBar') && document.getElementById('tlBar').isConnected }));
  check(P + 'the Timeline card closes the drawer and shows the Output view with the Timeline', !r.drawer && !/off-/.test(r.run) && r.tab === 'output' && r.bar, JSON.stringify(r));
  check(P + 'no page errors', !page.errors.length, page.errors.join(' | '));
  await page.context().close();
}

(async () => {
  const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'emit-ide-1_32.html'));
  const fileUrl = 'file://' + file;
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    await phoneChecks(browser, fileUrl);
    await exactChecks(browser, fileUrl);
  } catch (e) { failed++; console.log('FAIL  crashed: ' + (e && e.stack || e)); }
  await browser.close();
  console.log('\n' + passed + '/' + (passed + failed) + ' timeline checks passed');
  process.exit(failed ? 1 : 0);
})();

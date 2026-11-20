#!/usr/bin/env node
// Checks particles in an Emit IDE build in headless Chromium: `particles NAME:` blocks (parser errors and
// warnings with exact positions, ranges, dir / spread, names case-insensitive across files), burst() /
// emitter() / moveEmitter() / stopEmitter() (names checked like play), the runtime (positions, life, gravity,
// drag, angles, the 2000 cap, its cost per frame), `burst NAME at THING` in rules (Coin Dash: sparkles where the
// coin was) and the LOGIC tool keeping it, the PARTICLES tool on a 360×740 phone (presets, sliders, colours,
// loop, the live preview and a tap that bursts, Save → block → reopen) and exported .html / .js pages.
// Offline: every network request is aborted.
//
//   node tests/run-particles.js [path/to/emit-ide.html]
//   SHOTS=dir  also saves phone screenshots there.
//
// Exit code 0 when every check passes.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

let failed = 0, passed = 0;
function check(label, ok, detail) {
  if (ok) { passed++; console.log('PASS  ' + label); }
  else { failed++; console.log('FAIL  ' + label + (detail !== undefined ? '\n      ' + String(detail).slice(0, 700) : '')); }
}
const PHONE = { viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true };
const DESK = { viewport: { width: 1100, height: 800 } };
const SHOTS = process.env.SHOTS || '';

const ERRORS = [
  ['an unknown setting, with a suggestion', 'particles p:\n  count 12 lifee 3\n', { thrown: '2:12: Unknown setting "lifee" — did you mean life?' }],
  ['count out of range', 'particles p:\n  count 0\n', { thrown: '2:9: count is a whole number from 1 to 500 — count 12' }],
  ['colors without a colour', 'particles p:\n  count 12  colors\n', { thrown: '2:19: colors needs one or more colours — colors #ffcd75 #f4f4f4' }],
  ['a range that is not a number', 'particles p:\n  speed fast\n', { thrown: '2:9: speed needs a number or a range — speed 40..90' }],
  ['a range out of bounds', 'particles p:\n  speed 10..5000\n', { thrown: '2:9: speed is from 0 to 2000 pixels per second' }],
  ['a setting twice', 'particles p:\n  count 3 count 4\n', { thrown: '2:11: count is set twice in this effect' }],
  ['angle and spread together', 'particles p:\n  angle 0..90  spread 30\n', { thrown: '2:16: Use angle a..b, or dir and spread — not both' }],
  ['an unknown shape', 'particles p:\n  shape star\n', { thrown: '2:9: shape is square or circle — shape circle' }],
  ['area needs two numbers', 'particles p:\n  area 10\n', { thrown: '2:8: area needs a width and a height in pixels (where the particles start, around the point) — area 320 0' }],
  ['a bad colour', 'particles p:\n  colors #ff #00ff00\n', { thrown: '2:10: "#ff" is not a colour — #ffcd75 or #fc7' }],
  ['a number without a setting', 'particles p:\n  12\n', { thrown: '2:3: "12" needs a setting in front of it — the settings are count, life, speed, angle, spread, dir, gravity, drag, size, colors, color, fade, shape, loop, rate, area' }],
  ['burst() of an unknown name, no particles block', 'export fn main() {\n  burst(nope, 1, 2)\n}\n', '2:9: Unknown particles "nope" — there is no particles block yet: write one (e.g. particles nope:, then   count 12  speed 40..90  fade) or make one with the Drawer (🧰 → Particles)'],
  ['burst() with a suggestion', 'particles spark:\n  count 3\nexport fn main() {\n  burst(sprak, 1, 2)\n}\n', '4:9: Unknown particles "sprak" — did you mean "spark"?'],
  ['burst() with two arguments', 'particles spark:\n  count 3\nexport fn main() {\n  burst(spark, 1)\n}\n', '4:3: burst takes 3 arguments: burst(sparkle, x, y)'],
  ['a hud name given to burst()', 'particles spark:\n  count 3\nhud main:\n  text "x"\nexport fn main() {\n  burst(main, 1, 2)\n}\n', '6:9: Unknown particles "main" — main is a hud block'],
  ['two particles names that differ only by case', 'particles spark:\n  count 3\nparticles Spark:\n  count 4\n', '3:11: particles "Spark" and "spark" (particles at 1:11) differ only by case — names in Emit are case-insensitive, so they are the same name: rename one of them'],
  ['a particles block inside a function', 'export fn main() {\n  particles p:\n    count 3\n}\n', { thrown: '2:3: particles blocks belong at the top level of a file and start in column 1 — particles p: …' }],
  ['rules: burst of an unknown name', 'thing hero: box 4 4\nrules:\n  on start: burst spark at hero\n', '3:13: Unknown particles "spark" — there is no particles block yet: write one (e.g. particles spark:, then   count 12  speed 40..90  fade) or make one with the Drawer (🧰 → Particles)'],
  ['rules: burst outside on hit / each needs at', 'particles spark:\n  count 3\nthing hero: box 4 4\nrules:\n  every frame: burst spark\n', { thrown: '5:16: Say where: burst spark at hero (a thing), or at 160, 120 — outside on hit / each there is no thing involved' }],
  ['rules: burst without a name', 'particles spark:\n  count 3\nthing hero: box 4 4\nrules:\n  on tap: burst\n', { thrown: '5:16: Expected a particles name after burst — burst sparkle at coin' }],
  ['an empty effect is a warning', 'particles p:\n', { warn: '1:13: This effect has no settings yet — it uses the defaults (count 10  life 0.5..1  speed 30..80  angle 0..360)' }],
];
const PROG = `particles spark:
  count 20  life 1  speed 0  size 4  colors #ff0000
particles stream:
  count 1  life 0.5  speed 0  size 2  colors #00ff00  loop  rate 60
particles fall:
  count 1  life 3  speed 0  gravity 600  size 1
particles slide:
  count 1  life 3  speed 100  angle 0  drag 2  size 1
particles up:
  count 1  life 3  speed 60  angle 90  size 1
mut h = 0
mut cmd = 0
mut arg = 0

export fn main() {
  canvas(100, 60)
  animate()
}
// the test sets cmd (and arg), then runs one frame
export fn frame() {
  color(0, 0, 0)
  rect(0, 0, 100, 60)
  if (cmd == 1) { burst(spark, 50, 30) }
  if (cmd == 2) { h = emitter(STREAM, 10.0, 10.0) }
  if (cmd == 3) { moveEmitter(h, 80, 50) }
  if (cmd == 4) { stopEmitter(h) }
  if (cmd == 5) {
    burst(fall, 10, 0)
    burst(slide, 0, 10)
    burst(up, 50, 50)
  }
  if (cmd == 6) {
    for (let i = 0; i < arg; i++) {
      burst("spark", 50.0, 30.0)
    }
  }
  if (cmd == 7) {
    let s = "nope"
    burst(s, 1, 1)
  }
  cmd = 0
}
`;
async function newPage(browser, mode) {
  const ctx = await browser.newContext(mode || DESK);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message.slice(0, 300)));
  page.on('dialog', d => d.accept());
  await page.route(/^https?:/, r => r.abort());
  return page;
}
async function openIde(browser, fileUrl, mode) {
  const page = await newPage(browser, mode);
  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof compileAndRun === 'function' && typeof _projLoad === 'function');
  await page.waitForTimeout(100);
  await page.evaluate(() => { try { closeWelcome(); } catch (e) {} });
  return page;
}
const comp = (page, src) => page.evaluate(s => { try { const r = compile(s); return { errors: r.errors, warnings: r.warnings || [], fx: r.imports && r.imports.fxMeta || null, hud: r.imports && r.imports.hudMeta || null, particles: r.particles || [] }; } catch (e) { return { thrown: e.message }; } }, src);
const frames = (page, n) => page.evaluate(n => { _animRunning = false; for (let i = 0; i < n; i++) _emitFrame(); return _fxLive(); }, n);
const CMD = { boom: 1, start: 2, go: 3, halt: 4, one: 5, many: 6, byName: 7 };
const call = (page, name, arg) => page.evaluate(({ c, arg }) => { _animRunning = false; window._wi.exports.__g1.value = BigInt(c); window._wi.exports.__g2.value = BigInt(arg || 0); _emitFrame(); return _fxLive(); }, { c: CMD[name], arg });
const px = (page, pts, sel) => page.evaluate(({ pts, sel }) => { const c = sel ? document.querySelector(sel) : _canvas, g = c.getContext('2d'); return pts.map(p => Array.from(g.getImageData(p[0], p[1], 1, 1).data.slice(0, 3)).join(',')); }, { pts, sel });

(async () => {
  const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'emit-ide-1_32.html'));
  const fileUrl = 'file://' + file;
  const browser = await chromium.launch();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'emit-fx-'));
  let page = await openIde(browser, fileUrl);

  // ── the language ──
  for (const [label, src, want] of ERRORS) {
    const r = await comp(page, src);
    if (typeof want === 'string') check('error: ' + label, r.errors && r.errors[0] === want, JSON.stringify(r));
    else if (want.thrown) check('error: ' + label, r.thrown === want.thrown, JSON.stringify(r));
    else check('warning: ' + label, r.errors && !r.errors.length && r.warnings.indexOf(want.warn) >= 0, JSON.stringify(r));
  }
  let r = await comp(page, 'particles spark:\n  dir 90 spread 40 gravity -30 drag 2 size 4..0 shape circle loop rate 30 area 20 10 colors #fff #ff0000 fade\nexport fn main() {\n  let s = "spark"\n  burst(s, 1, 2)\n  let h = emitter(Spark, 3, 4)\n  moveEmitter(h, 5, 6)\n  stopEmitter(h)\n}\n');
  let sp = r.fx ? JSON.parse(r.fx).fx.spark : null;
  check('compile: every setting; dir 90 spread 40 → angle 70..110; #fff → #ffffff; a str variable is passed on; Spark → spark', !r.errors.length && sp && sp.angle.join() === '70,110' && sp.gravity === -30 && sp.drag === 2 && sp.size.join() === '4,0' && sp.shape === 'circle' && sp.loop && sp.rate === 30 && sp.area.join() === '20,10' && sp.colors.join() === '#ffffff,#ff0000' && sp.fade && sp.count === 10 && !r.hud, JSON.stringify(r).slice(0, 500));
  r = await comp(page, 'Particles Boom:\n  COUNT 5  Life 0.2..0.4  SPEED 10  Fade  Shape CIRCLE  Colours #ABC\nexport fn main() {\n  Burst(BOOM, 1, 2)\n  burst("boom", 1, 2)\n}\n');
  sp = r.fx ? JSON.parse(r.fx).fx.Boom : null;
  check('names: Particles Boom: / COUNT / Shape CIRCLE / Colours / Burst(BOOM) / "boom" — case-insensitive, shown as declared', !r.errors.length && !r.thrown && sp && sp.count === 5 && sp.shape === 'circle' && sp.fade && sp.colors[0] === '#aabbcc' && r.particles.join() === 'Boom', JSON.stringify(r).slice(0, 400));
  r = await comp(page, '//// file: main.emit\nexport fn main() {\n  canvas(10, 10)\n  burst(dust, 1.5, 2)\n}\n//// file: fx.emit\nparticles dust:\n  count 4\n');
  check('compile: a particles block of another file is seen without import', !r.errors.length && r.fx, JSON.stringify(r));
  r = await comp(page, 'fn burst(a: int) {\n}\nexport fn main() {\n  burst(1)\n}\n');
  check('compile: a file\'s own burst() is left alone (no particles part)', !r.errors.length && !r.fx, JSON.stringify(r));
  r = await comp(page, 'particles spark:\n  count 3\nthing hero: box 4 4\nthing coin: box 4 4\nrules:\n  on hit hero coin: burst SPARK at Coin\n  on tap: burst spark at 10, 20\n  each coin: burst spark\n');
  check('rules: burst NAME at THING, at X, Y and inside each (names in any case) compile', !r.errors.length && !r.thrown && r.fx, JSON.stringify(r));

  // ── the runtime ──
  await page.evaluate(s => { _projLoad(s); }, PROG);
  await page.evaluate(async () => { await compileAndRun(); _animRunning = false; });
  let n = await call(page, 'boom');
  check('burst: count particles at once', n === 20, n);
  let p = await px(page, [[50, 30], [48, 28], [51, 31], [47, 30], [52, 30]]);
  check('draw: the particles are drawn after the frame, a 4×4 square of the colour at the point', p.slice(0, 3).every(c => c === '255,0,0') && p[3] === '0,0,0' && p[4] === '0,0,0', JSON.stringify(p));
  n = await frames(page, 58);
  check('life 1: alive for a second (59 frames) …', n === 20, n);
  n = await frames(page, 3);
  p = await px(page, [[50, 30]]);
  check('… and gone after it (nothing drawn)', n === 0 && p[0] === '0,0,0', n + ' ' + p);
  n = await call(page, 'start');
  check('emitter: returns a handle (> 0), starts with no particles', await page.evaluate(() => window._wi.exports.__g0.value > 0n) && n === 0, n);
  n = await frames(page, 20);
  p = await px(page, [[10, 10]]);
  check('emitter: rate 60 → one particle per frame where it is', n === 20 && p[0] === '0,255,0', n + ' ' + p);
  await call(page, 'go');
  n = await frames(page, 40);
  p = await px(page, [[80, 50], [10, 10]]);
  check('moveEmitter: new particles come from the new place; the old ones die (life 0.5 = 30 frames)', n >= 28 && n <= 31 && p[0] === '0,255,0' && p[1] === '0,0,0', n + ' ' + JSON.stringify(p));
  await call(page, 'halt');
  n = await frames(page, 40);
  check('stopEmitter: no new particles; the stream runs dry', n === 0, n);
  await call(page, 'one');
  await frames(page, 30);
  const pos = await page.evaluate(() => { const z = _fxW.snap(), o = []; for (let i = 0; i < z.n; i++)o.push([z.f[i * 6], z.f[i * 6 + 1], z.f[i * 6 + 2], z.f[i * 6 + 3]]); return o; });
  const fall = pos.find(q => Math.abs(q[0] - 10) < 0.01), slide = pos.find(q => Math.abs(q[1] - 10) < 0.01 && q[0] > 1), up = pos.find(q => Math.abs(q[0] - 50) < 0.01);
  check('motion: gravity 600 accelerates down (≈ 77 px in 30 frames); drag 2 slows 100 px/s (≈ 31 px, speed ≈ 37); angle 90 goes up 30 px', pos.length === 3 && fall && fall[1] > 70 && fall[1] < 85 && slide && slide[0] > 26 && slide[0] < 36 && slide[2] > 30 && slide[2] < 42 && up && Math.abs(up[1] - 20) < 0.5, JSON.stringify(pos));
  await frames(page, 200);
  n = await call(page, 'many', 200);
  check('cap: 200 bursts of 20 → at most 2000 live particles', n === 2000, n);
  const cost = await page.evaluate(() => { const g = _need2d(), t0 = performance.now(); for (let i = 0; i < 30; i++) { _fxW.step(1 / 60); _fxW.draw(g); } return (performance.now() - t0) / 30; });
  check('cost: 2000 particles move and draw in ' + cost.toFixed(2) + ' ms per frame (< 8 ms)', cost < 8, cost);
  await frames(page, 80);
  await call(page, 'byName');
  const out = await page.evaluate(() => document.getElementById('tab-output').innerText);
  check('runtime: an unknown name in a str variable draws nothing and says so once', /particles "nope": there is no particles block with this name/.test(out) && await page.evaluate(() => _fxLive()) === 0);
  check('runtime: no page errors', !page.errors.length, page.errors.join(' | '));
  // a program without particles: no particle state
  await page.evaluate(s => { _projLoad(s); }, 'export fn main() {\n  canvas(10, 10)\n}\n');
  await page.evaluate(() => compileAndRun());
  await page.waitForTimeout(200);
  check('runtime: a program without particles has no particle world', await page.evaluate(() => _fxW === null));
  // Coin Dash: the hero takes a coin → sparkles where the coin was (rules: burst sparkle at coin)
  await page.selectOption('#example', 'game').catch(() => {});
  await page.evaluate(async () => { await compileAndRun(); });
  await page.waitForTimeout(300);
  const cd = await page.evaluate(() => {
    _animRunning = false;
    const K = _lgMeta.kinds[0], R = _lgRegion(K), dv = new DataView(_wasmMem.buffer);
    [['x', 110], ['y', 36], ['px', 110], ['py', 36]].forEach(([f, v]) => dv.setFloat64(R.base + R.off[f], v, true));
    _emitFrame();
    const z = _fxW.snap(), xs = [], ys = [];
    for (let i = 0; i < z.n; i++) { xs.push(z.f[i * 6]); ys.push(z.f[i * 6 + 1]); }
    return { n: z.n, xs, ys, cols: Array.from(new Set(z.col)), score: _hudMeta && Number(_hudVal(_hudMeta.huds[0].items[0].parts[1])) };
  });
  check('Coin Dash: taking a coin bursts 14 sparkles at the coin\'s centre (119, 45) in its colours; score 1', cd.n === 14 && cd.xs.every(x => Math.abs(x - 119) < 0.01) && cd.ys.every(y => Math.abs(y - 45) < 0.01) && cd.cols.every(c => c === '#ffcd75' || c === '#f4f4f4') && Number(cd.score) === 1, JSON.stringify(cd).slice(0, 300));
  const moved = await page.evaluate(() => { for (let i = 0; i < 10; i++) _emitFrame(); return _fxLive(); });
  check('Coin Dash: the sparkles fly out and fade (still alive after 10 frames, gone after 45)', moved === 14 && await page.evaluate(() => { for (let i = 0; i < 35; i++) _emitFrame(); return _fxLive(); }) === 0, moved);
  // the LOGIC tool keeps the burst action
  await page.evaluate(() => { stopProgram(); _drawerOpen('logic'); });
  await page.waitForTimeout(300);
  let rules = await page.evaluate(() => _lgTool.state.rules.filter(x => x.type === 'rule').map(x => _lgTool.ruleText(x)));
  check('Logic tool: reads "burst sparkle at coin" and "burst dust at hero" back as they are', rules.includes('on hit hero coin: remove coin : add score 1 : play coin : burst sparkle at coin') && rules.includes('on hit hero slime: add hero.hp -1 : remove slime : say "Ouch!" : play hurt : burst dust at hero'), JSON.stringify(rules));
  await page.click('.lg-tab[data-tab="rules"]');
  await page.waitForTimeout(100);
  const opts = await page.evaluate(() => { const s = [...document.querySelectorAll('.lg-act [data-f="verb"]')].find(x => x.value === 'burst'); const a = s.closest('.lg-act'); return { verbs: [...s.options].map(o => o.value).includes('burst'), name: a.querySelector('[data-f="name"]').value, list: [...a.querySelectorAll('[data-f="name"] option')].map(o => o.value), at: a.querySelector('[data-f="at"]').value }; });
  check('Logic tool: a burst action has a menu of the particles blocks and an "at" field', opts.verbs && opts.name === 'sparkle' && opts.list.join() === ',sparkle,dust' && opts.at === 'coin', JSON.stringify(opts));
  await page.evaluate(() => { const s = [...document.querySelectorAll('.lg-act [data-f="name"]')].find(x => x.value === 'dust'); s.value = 'sparkle'; s.dispatchEvent(new Event('change')); });
  await page.evaluate(() => _lgTool.save());
  await page.waitForTimeout(150);
  const gtext = await page.evaluate(() => _drawerRead('rules', ''));
  check('Logic tool: changing the particles of a burst and saving writes "burst sparkle at hero"', /on hit hero slime: add hero\.hp -1 : remove slime : say "Ouch!" : play hurt : burst sparkle at hero$/m.test(gtext) && /: burst sparkle at coin$/m.test(gtext), gtext);
  check('Coin Dash: no page errors', !page.errors.length, page.errors.join(' | '));
  await page.context().close();

  // ── the PARTICLES tool on a phone ──
  page = await openIde(browser, fileUrl, PHONE);
  await page.evaluate(() => { _projLoad('export fn main() {\n  canvas(320, 240)\n}\n'); });
  await page.evaluate(() => _drawerOpen());
  await page.waitForTimeout(150);
  await page.tap('#drawer .drw-card[data-tool="particles"]');
  await page.waitForTimeout(600);
  let t = await page.evaluate(() => { const R = document.querySelector('[data-fx-tool]'); return { ok: !!R, text: R._fx.text(), n: R._fx.world.n(), presets: [...document.querySelectorAll('[data-fx-tool] .drw-wrap .drw-btn')].map(b => b.textContent) }; });
  check('tool: a card opens the PARTICLES tool: a new sparkle effect bursting in the preview; the seven presets', t.ok && /^particles sparkle:\n  count 14  life 0\.3\.\.0\.7  speed 40\.\.100  angle 0\.\.360\n  gravity 60  size 3\.\.1\n  colors #ffcd75 #f4f4f4  fade$/.test(t.text) && t.n > 0 && ['sparkle', 'explosion', 'smoke', 'dust', 'confetti', 'fire', 'rain'].every(k => t.presets.includes(k)), JSON.stringify(t));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'particles-tool-phone.png') });
  await page.tap('[data-fx-tool] .drw-btn[aria-label="Preset: explosion"]');
  await page.waitForTimeout(100);
  t = await page.evaluate(() => document.querySelector('[data-fx-tool]')._fx.text());
  check('tool: the explosion preset writes its settings', /count 60 .*speed 60\.\.220/.test(t) && /drag 2  size 5\.\.1  shape circle/.test(t), t);
  await page.tap('[data-fx-tool] .drw-btn[aria-label="Preset: smoke"]');
  await page.waitForTimeout(400);
  t = await page.evaluate(() => { const R = document.querySelector('[data-fx-tool]'); return { text: R._fx.text(), rate: [...document.querySelectorAll('.drw-sl label')].some(l => l.textContent === 'Rate'), em: R._fx.world.emitters(), n: R._fx.world.n() }; });
  check('tool: smoke is a loop: Rate appears, the preview runs a stream', /count 6  loop  rate 14/.test(t.text) && t.rate && t.em === 1 && t.n > 0, JSON.stringify(t));
  await page.tap('[data-fx-tool] .drw-btn[aria-label="Preset: sparkle"]');
  await page.waitForTimeout(100);
  // a slider and its number box
  await page.evaluate(() => { const row = [...document.querySelectorAll('.drw-sl')].find(r => r.querySelector('label').textContent === 'Speed max'), b = row.querySelector('.drw-num'); b.value = '150'; b.dispatchEvent(new Event('change')); });
  await page.evaluate(() => { const row = [...document.querySelectorAll('.drw-sl')].find(r => r.querySelector('label').textContent === 'Gravity'), s = row.querySelector('input[type=range]'); s.value = '-20'; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); });
  await page.tap('[data-fx-tool] .drw-seg[aria-label="Shape"] button[data-v="circle"]');
  await page.tap('[data-fx-tool] .hfx-cols .drw-btn[aria-label="Add a colour"]');
  await page.tap('#fxFade');
  t = await page.evaluate(() => document.querySelector('[data-fx-tool]')._fx.text());
  check('tool: Speed max 150, gravity -20, circle, a third colour, fade off', /speed 40\.\.150/.test(t) && /gravity -20  size 3\.\.1  shape circle/.test(t) && /colors #ffcd75 #f4f4f4 #f4f4f4$/.test(t), t);
  // tap the preview: a burst there
  const tapped = await page.evaluate(async () => {
    const R = document.querySelector('[data-fx-tool]'), W = R._fx.world; W.clear();
    const cv = document.querySelector('.hfx-fxcv'), r = cv.getBoundingClientRect();
    cv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: r.left + r.width * 0.25, clientY: r.top + r.height * 0.25, pointerType: 'touch' }));
    const z = W.snap(); return { n: z.n, x: z.f[0], y: z.f[1], w: cv.width, h: cv.height };
  });
  check('tool: tapping the preview bursts at that point', tapped.n === 14 && Math.abs(tapped.x - tapped.w * 0.25) < 1 && Math.abs(tapped.y - tapped.h * 0.25) < 1, JSON.stringify(tapped));
  const ov = await page.evaluate(() => { const b = document.getElementById('drawerBody'); return { sw: b.scrollWidth, cw: b.clientWidth, doc: document.documentElement.scrollWidth }; });
  check('tool: no horizontal overflow at 360 px', ov.sw <= ov.cw && ov.doc <= 360, JSON.stringify(ov));
  const small = await page.evaluate(() => [...document.querySelectorAll('[data-fx-tool] button, [data-fx-tool] input[type=color], [data-fx-tool] input[type=checkbox], #drawerFoot button')].filter(b => b.offsetParent && b.type !== 'checkbox').map(b => { const r = b.getBoundingClientRect(); return { t: b.textContent || b.getAttribute('aria-label'), h: Math.round(r.height), w: Math.round(r.width) }; }).filter(x => x.h < 44 || x.w < 44));
  check('tool: every button is a 44 px touch target', !small.length, JSON.stringify(small.slice(0, 6)));
  t = await page.evaluate(() => document.querySelector('[data-fx-tool]')._fx.text());
  await page.tap('#drawerFoot .drw-pri');
  await page.waitForTimeout(150);
  const saved = await page.evaluate(() => ({ dirty: _drawer.dirty, block: _drawerRead('particles', 'sparkle'), files: _proj.files.map(f => f.path) }));
  check('save: the block goes to a new hud.emit, exactly the tool\'s text; not dirty any more', saved.block === t && saved.files.includes('hud.emit') && !saved.dirty, JSON.stringify(saved));
  r = await comp(page, await page.evaluate(() => _projText()) + '\n//// file: more.emit\nexport fn go() {\n  burst(sparkle, 1, 2)\n}\n');
  check('save: the saved block compiles and burst(sparkle, …) finds it', !r.errors.length && !r.thrown && r.fx, JSON.stringify(r).slice(0, 300));
  await page.click('#drawer .drw-back').catch(() => {});
  await page.tap('#drawer .drw-card[data-tool="particles"]');
  await page.waitForTimeout(200);
  t = await page.evaluate(() => document.querySelector('[data-fx-tool]')._fx.text());
  check('round trip: reopening reads the same settings and writes the same text', t === saved.block, t);
  const hand = 'particles rainy:\n  count 4  loop  rate 60  life 0.8..1.2  speed 220..260  angle 255..265\n  gravity 0  size 2  area 320 0\n  colors #73eff7 #41a6f6';
  await page.evaluate(h => _drawerWrite('particles', 'rainy', h, 'hud.emit'), hand);
  await page.click('#drawer .drw-back').catch(() => {});
  await page.tap('#drawer .drw-card[data-tool="particles"]');
  await page.waitForTimeout(200);
  t = await page.evaluate(() => { [...document.querySelectorAll('.drw-chips[role=tablist] .drw-chip')][1].click(); return document.querySelector('[data-fx-tool]')._fx.text(); });
  check('round trip: a hand-written block (loop, rate, single numbers, area) is read and written back unchanged', t === hand, t);
  check('tool: no page errors', !page.errors.length, page.errors.join(' | '));
  if (SHOTS) {
    await page.evaluate(() => _drawerClose());
    await page.selectOption('#example', 'game').catch(() => {});
    await page.evaluate(() => compileAndRun());
    await page.waitForTimeout(600);
    await page.evaluate(() => { const K = _lgMeta.kinds[0], R = _lgRegion(K), dv = new DataView(_wasmMem.buffer); [['x', 110], ['y', 36], ['px', 110], ['py', 36]].forEach(([f, v]) => dv.setFloat64(R.base + R.off[f], v, true)); });
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(SHOTS, 'particles-game-phone.png') });
  }
  await page.context().close();

  // ── export ──
  page = await openIde(browser, fileUrl);
  const EXP = 'particles spark:\n  count 30  life 5  speed 0  size 4  colors #ff0000\nexport fn main() {\n  canvas(60, 40)\n  burst(spark, 30, 20)\n  animate()\n}\nexport fn frame() {\n  color(0, 0, 0)\n  rect(0, 0, 60, 40)\n}\n';
  const ex = await page.evaluate(src => { const r = compile(src), P = _exportProgram(src, r); return { html: _exportHtml(P), js: _exportJs(P), rt: _exportRuntime(P) }; }, EXP);
  check('export: the runtime of a particles program has the particles, not the HUD', /function _fxWorld\(/.test(ex.rt) && !/function _hudPaintSpec\(/.test(ex.rt));
  await page.context().close();
  const hf = path.join(tmp, 'fx.html'); fs.writeFileSync(hf, ex.html);
  page = await newPage(browser);
  await page.goto('file://' + hf);
  await page.waitForFunction(() => document.querySelector('canvas'), null, { timeout: 20000 });
  await page.waitForTimeout(400);
  p = await page.evaluate(() => { const c = document.querySelector('canvas'), g = c.getContext('2d'); return [[30, 20], [5, 5]].map(q => Array.from(g.getImageData(q[0], q[1], 1, 1).data.slice(0, 3)).join()); });
  check('export .html: the exported page draws the burst', p[0] === '255,0,0' && p[1] === '0,0,0', JSON.stringify(p) + ' ' + page.errors.join(' | '));
  await page.context().close();
  page = await newPage(browser);
  await page.route('http://export.test/program.js', r => r.fulfill({ body: ex.js, contentType: 'text/javascript' }));
  await page.route('http://export.test/index.html', r => r.fulfill({ body: '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><div id="app"></div><script type="module">import init from "./program.js"; init({ target: document.getElementById("app") }).then(a => { window.__state = "ready"; }, e => { window.__state = "error " + e.message; });</script></body></html>', contentType: 'text/html' }));
  await page.goto('http://export.test/index.html');
  await page.waitForFunction(() => window.__state, null, { timeout: 20000 });
  await page.waitForTimeout(400);
  p = await page.evaluate(() => { const c = document.querySelector('canvas'); if (!c) return ['no canvas', window.__state]; const g = c.getContext('2d'); return [[30, 20]].map(q => Array.from(g.getImageData(q[0], q[1], 1, 1).data.slice(0, 3)).join()); });
  check('export .js: the module draws the burst too', p[0] === '255,0,0', JSON.stringify(p) + ' ' + page.errors.join(' | '));
  await page.context().close();

  await browser.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + passed + '/' + (passed + failed) + ' particles checks passed');
  process.exit(failed ? 1 : 0);
})();

#!/usr/bin/env node
// Things and rules: `thing NAME: …` and `rules:` blocks — parsing, lowering to structs / regions / generated
// frame code, every shape, behaviour, event and action, exact error positions, edge-triggered `when`,
// collisions (thing pairs, `wall` with a real map block, `edge`), pools, `call` into user functions, drawing
// (getImageData), frame-by-frame determinism with `seed`, the other drawer parts for real (sprite, map,
// controls, sound and music blocks; spies record their calls), a whole game using all of them, multi-file
// projects, exported .html / .js / offline pages, the Memory tab, byte identity of programs without thing /
// rules blocks, and a performance measurement. Runs in headless Chromium, offline.
//
//   node tests/run-rules.js [path/to/emit-ide.html] [testName ...]
//   VERBOSE=1 prints each test's notes.
//
// Frames are stepped by hand: after Run the animate() loop is stopped (_animRunning = false) and the test
// calls _emitFrame() itself, so every frame is deterministic. Input is set directly (_keys, _touch).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const BASE_COMMIT = '8d7f2b4'; // the commit before thing / rules blocks
const MARK = '//// file: ';
const join = files => files.map((f, i) => (i === 0 && f[0] === 'main.emit' ? '' : MARK + f[0] + '\n') + f[1].replace(/^\n/, '')).join('\n');

// Spies on the other parts' real runtime helpers (SPRITE, STAGE, CORE): they record each call and then run the
// real function (installed after load, so the page's own definitions are the ones wrapped).
const SPIES = `
window.__calls = { sprite: [], map: [], snd: [], music: [] };
(function () {
  const sd = _spriteDraw; window._spriteDraw = function (g, name, frame, x, y, o) { window.__calls.sprite.push([name, frame, Math.round(x), Math.round(y), !!(o && o.flipX), o && o.w, o && o.h]); return sd.apply(this, arguments); };
  const md = _mapDraw; window._mapDraw = function (g, name) { window.__calls.map.push(name); return md.apply(this, arguments); };
  const sp = _sndPlay; window._sndPlay = function (name) { window.__calls.snd.push(name); return sp.apply(this, arguments); };
  const mp = _musicPlay; window._musicPlay = function (name) { window.__calls.music.push(name); return mp.apply(this, arguments); };
})();
`;
// Real blocks of the other parts used by the tests below.
const rowsOf = (w, h, f) => Array.from({ length: h }, (_, y) => '    "' + Array.from({ length: w }, (_, x) => f(x, y)).join('') + '"').join('\n');
// sprite hero: 12x20, 4 frames (all magenta, so any frame paints #ff00ff), fps 6
const SPR_HERO = 'sprite hero: 12x20, fps 6\n  palette ff00ff\n' + ['a', 'b', 'c', 'd'].map(f => '  frame ' + f + ' rle "112 *20"').join('\n') + '\n';
// map level1 (320 x 240, tile 8): the floor from y 200 down, a wall at x < 16, a post at x 160..175 from y 96 down
const MAP_WALLS = 'map level1: 40x30, tile 8\n  legend # wall solid #404040,  . air\n  rows\n' + rowsOf(40, 30, (x, y) => (y >= 25 || x < 2 || ((x === 20 || x === 21) && y >= 12)) ? '#' : '.') + '\n';
// map level1 (tile 10) with objects: gems at tiles (4,5) (9,6) (14,7), a door at (1,2)
const MAP_OBJECTS = 'map level1: 32x24, tile 10\n  legend . air\n  rows\n' + rowsOf(32, 24, () => '.') + '\n  objects\n    gem 4,5 value 5\n    gem 9,6\n    door 1,2\n    gem 14,7 value x\n';

// In-page helpers (test code, injected after load).
const HELPERS = `
window.T = {
  async run(src) {
    const ed = document.getElementById('editor');
    ed.value = src; ed.dispatchEvent(new Event('input'));
    await compileAndRun();
    _animRunning = false;
    return { out: document.getElementById('tab-output').innerText, status: document.getElementById('sTxt').innerText };
  },
  step(n) { for (let i = 0; i < (n || 1); i++) _emitFrame(); },
  id(r) { const R = _emitRegions().find(x => x.name === r); if (!R) throw new Error('no region ' + r); return R.id; },
  get(r, i, f) { return _emitRegionRead(T.id(r), i, f); },
  alive(r) { const R = _emitRegions().find(x => x.name === r); let c = 0; for (let i = 0; i < R.length; i++) if (T.get(r, i, 'alive')) c++; return c; },
  xy(r, i) { return [Math.round(T.get(r, i, 'x') * 100) / 100, Math.round(T.get(r, i, 'y') * 100) / 100]; },
  px(x, y) { const c = document.querySelector('#tab-output canvas'); const d = c.getContext('2d').getImageData(x, y, 1, 1).data; return '#' + [d[0], d[1], d[2]].map(v => ('0' + v.toString(16)).slice(-2)).join(''); },
  key(code, on) { _keys[code] = on ? 1 : 0; },
  tap(x, y, on) { const c = document.querySelector('#tab-output canvas'), r = c.getBoundingClientRect(); _touch.x = r.left + x * r.width / c.width; _touch.y = r.top + y * r.height / c.height; _touch.on = on ? 1 : 0; },
  lines() { return document.getElementById('tab-output').innerText.split('\\n').map(l => l.trim()).filter(Boolean); },
  diag(src) { try { const r = compile(src, 'wasm32'); return r.errors; } catch (e) { return [String(e.message)]; } },
};
`;

function eq(p, what, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) p.push(what + ': got ' + a + ', want ' + b);
}
function near(p, what, got, want, tol) {
  if (!(Math.abs(got - want) <= (tol || 1e-6))) p.push(what + ': got ' + got + ', want ' + want + ' ±' + (tol || 1e-6));
}
async function ok(page, p, src) {
  const r = await page.evaluate(s => T.run(s), src);
  if (r.status !== 'Done') p.push('status ' + r.status + ': ' + r.out.split('\n').filter(l => /✗/.test(l)).join(' | ').slice(0, 400));
  return r;
}

const TESTS = [];
const test = (name, fn, opts) => TESTS.push(Object.assign({ name, fn }, opts || {}));
// diag tests: compile(src) must throw / return exactly these errors
const diag = (name, src, want) => test(name, async page => {
  const p = [], got = await page.evaluate(s => T.diag(s), src);
  if (got.length !== want.length) p.push('expected ' + want.length + ' error(s), got ' + JSON.stringify(got));
  else want.forEach((w, i) => { if (!(w instanceof RegExp ? w.test(got[i]) : got[i] === w)) p.push('error ' + (i + 1) + '\n        want ' + w + '\n        got  ' + got[i]); });
  return p;
});

// ── shapes, positions, counts, pools, fields ──
test('shapes-sizes-fields', async page => {
  const p = [];
  await ok(page, p, `
thing a: box 10 6 #ff0000, at 5 7, hp 3, score 0
thing b: circ 4 #00ff00, at 50 60
thing c: oval 12 8 blue, at 100 20
thing d: sprite hero, at 200 100
thing e: sprite nope, at 10 200, size 5 9
thing f: count 3, at 30+i*40 80-i
` + SPR_HERO);
  const g = await page.evaluate(() => ({
    a: [T.get('a', 0, 'w'), T.get('a', 0, 'h'), T.get('a', 0, 'hp'), T.get('a', 0, 'score'), T.xy('a', 0)],
    b: [T.get('b', 0, 'w'), T.get('b', 0, 'h')], c: [T.get('c', 0, 'w'), T.get('c', 0, 'h')],
    d: [T.get('d', 0, 'w'), T.get('d', 0, 'h'), T.get('d', 0, 'frame')], e: [T.get('e', 0, 'w'), T.get('e', 0, 'h')],
    f: [0, 1, 2].map(i => T.xy('f', i)), fw: T.get('f', 0, 'w'),
    regions: _emitRegions().map(r => r.name + ':' + r.length),
  }));
  eq(p, 'box', g.a, [10, 6, 3, 0, [5, 7]]);
  eq(p, 'circ', g.b, [8, 8]);
  eq(p, 'oval', g.c, [12, 8]);
  eq(p, 'sprite size from the sprite block (_spriteInfo), frame -1 = animate', g.d, [12, 20, -1]);
  eq(p, 'size overrides', g.e, [5, 9]);
  eq(p, 'count with i', g.f, [[30, 80], [70, 79], [110, 78]]);
  eq(p, 'default box 16', g.fw, 16);
  eq(p, 'regions', g.regions, ['a:1', 'b:1', 'c:1', 'd:1', 'e:1', 'f:3']);
  return p;
});

test('pool-spawn-remove', async page => {
  const p = [];
  await ok(page, p, `
thing hero: box 8 8, at 100 100
thing bullet: box 4 2 #ffffff, pool 3
rules:
  on keydown space: spawn bullet at hero.x hero.y vel 6 0
  on hit bullet edge: remove bullet
`);
  const g = await page.evaluate(() => {
    const r = [T.alive('bullet')];
    T.key(32, 1); T.step(1); r.push(T.alive('bullet'), T.xy('bullet', 0));
    T.step(1); r.push(T.alive('bullet'), T.xy('bullet', 0)); // held: no second spawn
    T.key(32, 0); T.step(1); T.key(32, 1); T.step(1); T.key(32, 0); T.step(1); T.key(32, 1); T.step(1); T.key(32, 0); T.step(1); T.key(32, 1); T.step(1); T.key(32, 0);
    r.push(T.alive('bullet'));   // pool of 3: the 4th press finds no free slot
    T.step(40); r.push(T.alive('bullet'));   // all left the screen
    return r;
  });
  eq(p, 'pool starts dead', g[0], 0);
  eq(p, 'spawned at hero, then moved by vel in the same frame', [g[1], g[2]], [1, [106, 100]]);
  eq(p, 'keydown fires once while held', [g[3], g[4]], [1, [112, 100]]);
  eq(p, 'pool full', g[5], 3);
  eq(p, 'removed at the edge', g[6], 0);
  return p;
});

test('from-map-with-props', async page => {
  const p = [];
  await ok(page, p, `
thing gem: circ 3 #ffcd75, from map level1, value 1
thing door: box 4 4, from map level1, pool 2
` + MAP_OBJECTS);
  const g = await page.evaluate(() => ({ n: T.alive('gem'), cap: _emitRegions().find(r => r.name === 'gem').length, xy: [0, 1, 2].map(i => T.xy('gem', i)), v: [0, 1, 2].map(i => T.get('gem', i, 'value')), door: [T.alive('door'), T.xy('door', 0)] }));
  eq(p, 'one gem per map object, default capacity 64', [g.n, g.cap], [3, 64]);
  eq(p, 'positions', g.xy, [[40, 50], [90, 60], [140, 70]]);
  eq(p, 'numeric props override the field, others keep the default', g.v, [5, 1, 1]);
  eq(p, 'door (pool 2), placed in pixels (STAGE objects are in tiles: 1,2 x tile 10)', g.door, [1, [10, 20]]);
  return p;
});

test('from-map-without-map-block', async page => {
  const p = [];
  await ok(page, p, 'thing gem: circ 3, from map level1\nrules:\n  every frame: add n 1\n');
  const g = await page.evaluate(() => ({ n: T.alive('gem'), lines: T.lines() }));
  eq(p, 'no map block level1: none placed', g.n, 0);
  if (!g.lines.some(l => /from map level1 — there is no map block level1/.test(l))) p.push('no note about the missing map block: ' + JSON.stringify(g.lines.slice(-3)));
  return p;
}, { spies: false });

// ── behaviours ──
test('behaviour-chase-flee-track', async page => {
  const p = [];
  await ok(page, p, `
thing hero: box 10 10, at 100 100
thing c: box 10 10, at 0 100, chase hero 2
thing f: box 10 10, at 150 100, flee hero 1.5
thing t: box 10 10, at 100 0, track hero
`);
  const g = await page.evaluate(() => { T.step(5); return { c: T.xy('c', 0), f: T.xy('f', 0), t: [T.get('t', 0, 'fx'), T.get('t', 0, 'fy')], tv: T.xy('t', 0) }; });
  eq(p, 'chase moves 2 px/frame toward', g.c, [10, 100]);
  eq(p, 'flee moves away', g.f, [157.5, 100]);
  near(p, 'track fx', g.t[0], 0, 1e-9); near(p, 'track fy', g.t[1], 1, 1e-9);
  eq(p, 'track does not move', g.tv, [100, 0]);
  return p;
});

test('behaviour-chase-uses-speed-field-and-nearest', async page => {
  const p = [];
  await ok(page, p, `
thing hero: box 10 10, count 2, at 20+i*200 100
thing s: box 10 10, at 200 100, speed 3, chase hero
`);
  const g = await page.evaluate(() => { T.step(2); return T.xy('s', 0); });
  eq(p, 'goes to the nearer hero (220) at its speed field', g, [206, 100]);
  return p;
});

test('behaviour-gravity-solid-patrol-bounce-wrap', async page => {
  const p = [];
  await ok(page, p, `
thing floor: box 320 20, at 0 200, wall
thing post: box 10 40, at 200 160, wall
thing g: box 10 10, at 20 100, gravity 1, solid
thing pt: box 10 10, at 150 190, patrol 2
thing bb: circ 5, at 300 5, bounce
thing w: box 10 10, at 315 50, wrap
rules:
  on start: bb vel 4, -3 : w vel 3, 0
`);
  const g = await page.evaluate(() => {
    const r = {};
    T.step(30); r.g = T.xy('g', 0); r.gvy = T.get('g', 0, 'vy');
    r.pt = []; for (let i = 0; i < 30; i++) { T.step(1); r.pt.push(T.get('pt', 0, 'x')); }
    r.bb = [T.get('bb', 0, 'vx'), T.get('bb', 0, 'vy')];
    r.w = T.xy('w', 0);
    return r;
  });
  eq(p, 'falls and lands on the wall thing (y + h = 200), vy 0', [g.g, g.gvy], [[20, 190], 0]);
  if (Math.max(...g.pt) > 190 || !g.pt.some((x, i) => i && x < g.pt[i - 1])) p.push('patrol must turn at the post (x + w <= 200): ' + g.pt.join(','));
  if (!(g.bb[0] < 0 && g.bb[1] > 0)) p.push('bounce must reverse both: ' + g.bb);
  if (!(g.w[0] < 320)) p.push('wrap: ' + g.w);
  return p;
});

test('behaviour-wander-deterministic-with-seed', async page => {
  const p = [];
  const src = 'thing m: box 4 4, count 5, at 100+i*20 100, wander 1.5\nrules:\n  seed 42\n';
  await ok(page, p, src);
  const a = await page.evaluate(() => { T.step(60); return [0, 1, 2, 3, 4].map(i => T.xy('m', i)); });
  await ok(page, p, src);
  const b = await page.evaluate(() => { T.step(60); return [0, 1, 2, 3, 4].map(i => T.xy('m', i)); });
  eq(p, 'same seed, same frames', b, a);
  if (a.every((xy, i) => xy[0] === 100 + i * 20 && xy[1] === 100)) p.push('wander did not move');
  const c = await page.evaluate(() => { T.step(1); return T.get('m', 0, 'vx') * T.get('m', 0, 'vx') + T.get('m', 0, 'vy') * T.get('m', 0, 'vy'); });
  near(p, 'wander speed', c, 2.25, 1e-9);
  return p;
});

test('behaviour-follow-chain', async page => {
  const p = [];
  await ok(page, p, `
thing head: box 10 10, at 100 100
thing tail: box 10 10, count 3, at 100 100, follow head 12
rules:
  every frame: head mv 3, 0
`);
  const g = await page.evaluate(() => { T.step(40); return [T.xy('head', 0)].concat([0, 1, 2].map(i => T.xy('tail', i))); });
  eq(p, 'head', g[0], [220, 100]);
  eq(p, 'links at 12 px behind each other', g.slice(1), [[208, 100], [196, 100], [184, 100]]);
  return p;
});

// ── events ──
test('events-start-frame-every-key-tap-press', async page => {
  const p = [];
  await ok(page, p, `
mut keyN = 0
rules:
  on start: set s 10 : set fr 0
  every frame: add fr 1
  every 2s: add two 1
  every 250ms: add q 1
  on key left: add held 1
  on keydown right: add down 1
  on keyup right: add up 1
  on press A: add pa 1
  on hold B: add hb 1
  on tap: add taps 1 : set tx tapX() : set ty tapY()
  show s, fr, two, q, held, down, up, pa, hb, taps, tx, ty
`);
  const g = await page.evaluate(() => {
    const v = () => _lgShows.slice();
    T.step(240);
    T.key(37, 1); T.step(5); T.key(37, 0);
    T.key(39, 1); T.step(5); T.key(39, 0); T.step(1);
    T.key(90, 1); T.step(3); T.key(90, 0); T.step(1);   // Z = A
    T.key(88, 1); T.step(4); T.key(88, 0);              // X = B (held)
    T.tap(50, 60, 1); T.step(3); T.tap(50, 60, 0); T.step(1);
    T.tap(-500, -500, 1); T.step(2); T.tap(0, 0, 0);   // outside the canvas: no tap
    return v();
  });
  eq(p, 'values (265 frames: every 2s fired at 120 and 240, every 250ms 17 times)', g, [10, 265, 2, 17, 5, 1, 1, 1, 4, 1, 50, 60]);
  return p;
});

test('events-real-controls', async page => {
  const p = [];
  await ok(page, p, `
controls pad: stick left, buttons A B C
thing hero: box 10 10, at 100 100
rules:
  stage controls pad
  every frame: hero mv stickX()*2, stickY()*2
  on press A: add a 1
  on press C: add c 1
  on tap: hero to tapX(), tapY()
  show a, c
`);
  const at = sel => page.evaluate(sel => { const e = document.querySelector(sel); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 }; }, sel);
  const r = [];
  const st = await at('#tab-output [data-emit-controls="pad"] [data-ctl="stick"]');
  await page.mouse.move(st.x, st.y); await page.mouse.down(); await page.mouse.move(st.x + st.r * 1.5, st.y);
  await page.evaluate(() => T.step(2)); r.push(await page.evaluate(() => T.xy('hero', 0)));
  await page.mouse.up();
  for (const b of ['A', 'C']) { const q = await at('#tab-output [data-ctl="' + b + '"]'); await page.mouse.move(q.x, q.y); await page.mouse.down(); await page.evaluate(() => T.step(2)); await page.mouse.up(); await page.evaluate(() => T.step(1)); }
  r.push(await page.evaluate(() => _lgShows.slice()));
  const cv = await page.evaluate(() => { const c = document.querySelector('#tab-output canvas'); c.scrollIntoView({ block: 'center' }); const b = c.getBoundingClientRect(); return { x: b.left + 30 * b.width / c.width, y: b.top + 40 * b.height / c.height }; });
  await page.mouse.move(cv.x, cv.y); await page.mouse.down(); await page.evaluate(() => T.step(1)); r.push(await page.evaluate(() => T.xy('hero', 0))); await page.mouse.up();
  await page.evaluate(() => { T.key(39, 1); T.step(1); T.key(39, 0); }); r.push(await page.evaluate(() => T.xy('hero', 0)));
  eq(p, 'the on-screen stick (stage controls pad) moves the hero', r[0], [104, 100]);
  eq(p, 'on-screen buttons A and C: on press, once each', r[1], [1, 1]);
  eq(p, 'a tap on the game canvas (STAGE tapX / tapY in canvas pixels)', r[2], [30, 40]);
  eq(p, 'arrow keys still work', r[3], [32, 40]);
  return p;
});

test('when-is-edge-triggered', async page => {
  const p = [];
  await ok(page, p, `
mut v = 0
rules:
  every frame: add t 1
  when v > 2: add fired 1
  show fired
`);
  const g = await page.evaluate(() => {
    const r = [];
    T.step(3); r.push(_lgShows[0]);
    _emitRegionRead; window._wi.exports; // v is a global: set it through a tiny exported setter below
    return r;
  });
  eq(p, 'not fired while false', g, [0]);
  // drive v through rules instead (globals are not exported)
  await ok(page, p, `
rules:
  every frame: add t 1
  when t % 10 < 3: add fired 1
  when t >= 5: add once 1
  show fired, once
`);
  const h = await page.evaluate(() => { T.step(35); return _lgShows.slice(); });
  // t = 1..35: t%10<3 is true at 1-2, 10-12, 20-22, 30-32: four rising edges; t >= 5 rises once
  eq(p, 'rising edges only', h, [4, 1]);
  return p;
});

test('each-and-each-when', async page => {
  const p = [];
  await ok(page, p, `
thing r: box 4 4, count 4, at 10 i*70
rules:
  each r: mv 0, 1
  each r when r.y > 200: remove r : add gone 1
  show gone
`);
  const g = await page.evaluate(() => { T.step(5); return [T.alive('r'), T.xy('r', 0), _lgShows[0]]; });
  eq(p, 'each moves all, each-when removes past 200', g, [3, [10, 5], 1]);
  return p;
});

// ── collisions ──
test('hit-pairs-and-same-kind', async page => {
  const p = [];
  await ok(page, p, `
thing hero: box 10 10, at 0 0
thing coin: box 6 6, count 4, at 20+i*30 2
thing ball: box 10 10, count 3, at i*8 100
rules:
  every frame: hero mv 2, 0
  on hit hero coin: remove coin : add score 1 : play coin
  on hit ball ball: add pairs 1
  show score, pairs
sound coin: square 988, 60ms
`);
  const g = await page.evaluate(() => { T.step(50); const r = [_lgShows.slice()]; T.step(5); r.push(T.alive('coin'), window.__calls.snd.slice()); return r; });
  // balls 0-8 overlap 8-18? 0..10 & 8..18 overlap; 8..18 & 16..26 overlap; 0..10 & 16..26 no → 2 pairs per frame
  eq(p, 'score after 50 frames (hero 100..110 does not touch the coin at 110 yet), pairs 2 per frame × 50', g[0], [3, 100]);
  eq(p, 'coins left', g[1], 0);
  eq(p, 'play → _sndPlay', g[2], ['coin', 'coin', 'coin', 'coin']);
  return p;
});

test('hit-wall-real-map-and-block', async page => {
  const p = [];
  await ok(page, p, `
thing hero: box 10 10, at 50 150, gravity 0.5
rules:
  stage map level1
  on hit hero wall: block hero : add touching 1
  every frame: hero mv 2, 0
  show touching
` + MAP_WALLS);
  const g = await page.evaluate(() => { T.step(80); return { xy: T.xy('hero', 0), vy: T.get('hero', 0, 'vy'), t: _lgShows[0], maps: window.__calls.map.length, floor: T.px(100, 220), post: T.px(165, 150) }; });
  // floor at y >= 200 → stands at y 190; the post at x 160..176 (y >= 100) stops it at x + w <= 160
  eq(p, 'stands on the floor next to the post', g.xy, [150, 190]);
  eq(p, 'vy zeroed', g.vy, 0);
  if (!(g.t > 20)) p.push('wall hits counted: ' + g.t);
  if (!(g.maps >= 80)) p.push('map drawn each frame via _mapDraw: ' + g.maps);
  eq(p, 'the map\'s wall tiles are drawn (floor, post)', [g.floor, g.post], ['#404040', '#404040']);
  return p;
});

test('hit-edge-block-and-bounce', async page => {
  const p = [];
  await ok(page, p, `
thing a: box 10 10, at 300 50
thing b: box 10 10, at 100 230
rules:
  stage size 320 240
  on start: a vel 4, 0 : b vel 0, 3
  on hit a edge: block a
  on hit b edge: bounce b
`);
  const g = await page.evaluate(() => { T.step(10); return [T.xy('a', 0), T.get('a', 0, 'vx'), T.get('b', 0, 'vy')]; });
  eq(p, 'a clamped at the right edge, vx 0', [g[0], g[1]], [[310, 50], 0]);
  eq(p, 'b bounced', g[2] < 0, true);
  return p;
});

test('hit-block-against-thing-per-axis', async page => {
  const p = [];
  await ok(page, p, `
thing hero: box 10 10, at 0 50, gravity 1
thing ground: box 200 10, at 0 80
rules:
  every frame: hero mv 1, 0
  on hit hero ground: block hero
`);
  const g = await page.evaluate(() => { T.step(30); return [T.xy('hero', 0), T.get('hero', 0, 'vy')]; });
  eq(p, 'lands (y 70) and keeps walking', g, [[30, 70], 0]);
  return p;
});

// ── actions ──
test('actions-set-add-to-vel-frame-say-call', async page => {
  const p = [];
  await ok(page, p, `
mut hits = 0
fn openChest(h: int, c: int) {
  hits += 1
  chest[c].gold = 0.0
  hero[h].hp = hero[h].hp + 10.0
}
thing hero: box 10 10, at 0 0, hp 3
thing chest: box 10 10, at 30 0, gold 7
rules:
  every frame: hero vel 5, 0
  on hit hero chest: call openChest : say "Gold " + chest.gold : frame hero 2 : set chest.gold 1
  when hits == 1: add hero.hp 1 : music theme
  show hits, hero.hp, chest.gold
music theme: 120 bpm, 4 steps
  lead square: C5 . E5 .
`);
  const g = await page.evaluate(() => { T.step(6); return [_lgShows.slice(), T.get('hero', 0, 'frame'), _lgSay, window.__calls.music.slice()]; });
  // the hero (vel 5) overlaps the chest at x 25 and 30 within 6 frames: two hits
  eq(p, 'call passes both indices; set after; when adds', g[0], [2, 3 + 10 * 2 + 1, 1]);
  eq(p, 'frame', g[1], 2);
  eq(p, 'say text (expression, evaluated after call set gold 0)', g[2], 'Gold 0');
  eq(p, 'music → _musicPlay', g[3], ['theme']);
  return p;
});

test('actions-restart-and-stop', async page => {
  const p = [];
  await ok(page, p, `
thing hero: box 10 10, at 0 0, hp 3
rules:
  every frame: add hero.hp -1 : hero mv 1, 0
  when hero.hp <= 0: add deaths 1 : restart
  when deaths >= 2: say "Game over" : stop
  show deaths
`);
  const g = await page.evaluate(() => {
    const r = [];
    T.step(3); r.push(T.xy('hero', 0), T.get('hero', 0, 'hp'), _lgShows[0]);   // hp 0 → restart (auto globals reset, so deaths 0)
    return r;
  });
  eq(p, 'restart resets things and auto globals', g, [[0, 0], 3, 0]);
  await ok(page, p, `
mut deaths = 0
thing hero: box 10 10, at 0 0, hp 2
rules:
  every frame: add hero.hp -1 : hero mv 1, 0
  when hero.hp <= 0: add deaths 1 : restart
  when deaths >= 2: say "Game over" : stop
`);
  const h = await page.evaluate(() => {
    const r = [];
    T.step(2); r.push(T.xy('hero', 0));    // restarted once (declared globals are kept)
    T.step(10); r.push(T.xy('hero', 0), _lgSay);
    T.tap(10, 10, 1); T.step(1); r.push(T.xy('hero', 0)); T.tap(10, 10, 0); T.step(1); r.push(T.xy('hero', 0));
    return r;
  });
  eq(p, 'after the first restart', h[0], [0, 0]);
  eq(p, 'stopped: frozen', [h[1], h[2]], [[1, 0], 'Game over']);
  eq(p, 'a tap restarts a stopped game', h[3], [0, 0]);
  return p;
});

test('play-unknown-sound-is-silent-with-one-note', async page => {
  const p = [];
  await ok(page, p, 'rules:\n  every frame: play laser\n');
  const g = await page.evaluate(() => { T.step(5); return T.lines().filter(l => /play laser/.test(l)).length; });
  eq(p, 'one note', g, 1);
  return p;
}, { spies: false });

// ── drawing ──
test('drawing-getImageData', async page => {
  const p = [];
  await ok(page, p, `
thing a: box 20 10 #ff0000, at 10 10
thing b: circ 10 #00ff00, at 100 100
thing c: oval 30 10 #0000ff, at 200 50
thing d: sprite hero, at 250 150
thing e: sprite nope, at 40 200
thing dead: box 10 10 #ffffff, pool 2
rules:
  stage color #102030
  every frame: add n 1
  show n
` + SPR_HERO);
  const g = await page.evaluate(() => { T.step(1); return { a: T.px(15, 12), b: T.px(110, 110), bc: T.px(101, 101), c: T.px(215, 55), d: T.px(251, 151), e: T.px(45, 205), bg: T.px(300, 230), spr: window.__calls.sprite.slice(-1)[0], lines: T.lines() }; });
  eq(p, 'box', g.a, '#ff0000');
  eq(p, 'circle centre', g.b, '#00ff00');
  eq(p, 'circle corner is background', g.bc, '#102030');
  eq(p, 'oval', g.c, '#0000ff');
  eq(p, 'sprite via _spriteDraw (the sprite block\'s pixels)', g.d, '#ff00ff');
  eq(p, 'sprite call (name, auto frame, x, y, flip, w, h: the thing\'s size)', g.spr, ['hero', 0, 250, 150, false, 12, 20]);
  eq(p, 'unknown sprite: white box', g.e, '#ffffff');
  eq(p, 'stage color', g.bg, '#102030');
  if (!g.lines.some(l => /no sprite named nope/.test(l))) p.push('no note about the missing sprite');
  return p;
});

test('drawing-sprite-without-sprite-block-and-canvas-size', async page => {
  const p = [];
  await ok(page, p, 'thing d: sprite hero, at 20 20\nrules:\n  stage size 200 100\n');
  const g = await page.evaluate(() => { T.step(1); const c = document.querySelector('#tab-output canvas'); return [c.width, c.height, T.px(25, 25), T.get('d', 0, 'w')]; });
  eq(p, 'stage size, box fallback, 16 px default', g, [200, 100, '#ffffff', 16]);
  return p;
}, { spies: false });

test('user-canvas-and-user-frame', async page => {
  const p = [];
  await ok(page, p, `
mut frames = 0
export fn setup() {
  canvas(200, 150)
}
export fn frame() {
  frames += 1
  color(255, 255, 0)
  rect(0, 0, 5, 5)
}
export fn getFrames() int { return frames }
thing hero: box 10 10 #ff0000, at 50 50
rules:
  every frame: hero mv 1, 0
`);
  const g = await page.evaluate(() => { T.step(3); const cs = document.querySelectorAll('#tab-output canvas'); return [cs.length, cs[0].width, Number(window._wi.exports.getFrames()), T.xy('hero', 0), T.px(2, 2), T.px(55, 55)]; });
  eq(p, 'one canvas (the program\'s), user frame + generated step each frame, user drawing on top', g, [1, 200, 3, [53, 50], '#ffff00', '#ff0000']);
  return p;
});

// ── errors: exact positions ──
diag('diag-unknown-kind-in-hit', 'thing hero: box 8 8\nrules:\n  on hit hero coinn: remove coinn\n', ['3:15: Unknown thing "coinn" in on hit (or wall: a solid map tile / wall thing, edge: the screen edge) — the things are: hero']);
diag('diag-unknown-kind-hint', 'thing hero: box 8 8\nthing coin: box 4 4\nrules:\n  on hit hero con: remove coin\n', ['4:15: Unknown thing "con" in on hit (or wall: a solid map tile / wall thing, edge: the screen edge) — did you mean "coin"?']);
diag('diag-unknown-field', 'thing hero: box 8 8, hp 3\nrules:\n  when hero.hpp <= 0: restart\n', ['3:13: thing hero has no field "hpp" — did you mean "hp"?']);
diag('diag-unknown-field-in-set', 'thing hero: box 8 8, hp 3\nrules:\n  on start: set hero.lives 1\n', [/^3:22: thing hero has no field "lives"/]);
diag('diag-bad-event', 'rules:\n  on hitt hero coin: stop\n', ['2:6: Unknown event "on hitt" — did you mean "on hit"?']);
diag('diag-bad-event-word', 'rules:\n  wen x > 1: stop\n', ['2:3: Unknown event "wen" — did you mean "when"?']);
diag('diag-bad-action', 'rules:\n  on start: sett score 1\n', ['2:13: Unknown action "sett" — did you mean "set"?']);
diag('diag-missing-colon', 'rules:\n  on start set score 1\n', ['2:12: Expected : after the event — on start: set score 0']);
diag('diag-between-actions', 'rules:\n  on start: set a 1 set b 2\n', ['2:21: Unexpected "set" after the set action — separate actions with :']);
diag('diag-unknown-key', 'rules:\n  on key lft: stop\n', ['2:10: Unknown key "lft" — use left right up down space enter shift ctrl alt esc tab backspace, a–z or 0–9']);
diag('diag-every-unit', 'rules:\n  every 2: stop\n', ['2:10: Expected s or ms after the number — every 2s, every 500ms']);
diag('diag-thing-part', 'thing hero: box 8 8, chace\n', ['1:22: Unknown part "chace" of thing hero — did you mean "chase"?']);
diag('diag-thing-part-typo-with-target', 'thing hero: box 8 8\nthing s: box 4 4, chace hero 1\n', ['2:19: Unknown part "chace" of thing s — did you mean "chase"?']);
diag('diag-thing-colour', 'thing hero: box 8 8 #12345\n', ['1:21: "#12345" is not a colour — write #rgb or #rrggbb, e.g. #ffcd75']);
diag('diag-thing-no-colon', 'thing hero box 8 8\n', ['1:12: Expected : after thing hero — thing hero: box 16 16 #ffffff']);
diag('diag-duplicate-thing', 'thing a: box 1 1\nthing a: box 2 2\n', ['2:7: thing a is already declared at line 1']);
diag('diag-thing-name-taken', 'mut hero = 1\nthing hero: box 1 1\n', ['2:7: "hero" is already declared at line 1 of this file — a thing name is a top-level name too (its region)']);
diag('diag-chase-unknown', 'thing s: box 4 4, chase heroo 1\nthing hero: box 4 4\n', ['1:25: Unknown thing "heroo" — did you mean "hero"?']);
diag('diag-builtin-field', 'thing s: box 4 4, x 3\n', ['1:19: "x" is a built-in field of every thing — set the position with at X Y']);
diag('diag-count-constant', 'mut n = 3\nthing s: box 4 4, count n\n', ['2:25: count needs a whole number written as a constant — count 10']);
diag('diag-two-shapes', 'thing s: box 4 4, circ 3\n', ['1:19: thing s already has a shape (box) — a thing has one shape']);
diag('diag-bare-kind', 'thing hero: box 4 4\nrules:\n  when hero > 1: stop\n', ['3:8: "hero" is a thing — use one of its fields: hero.x, hero.y (or count(hero))']);
diag('diag-unknown-name', 'mut score = 0\nrules:\n  when scor >= 1: stop\n', ['3:8: Unknown name "scor" — did you mean "score"?']);
diag('diag-subject-needed', 'thing hero: box 4 4\nrules:\n  every frame: mv 1, 0\n', ['3:16: Say which thing: hero mv 1, 0 — outside on hit / each, an action needs its thing']);
diag('diag-call-arity', 'fn f(a: int, b: int) {}\nthing hero: box 4 4\nrules:\n  every frame: call f\n', ['4:21: call f: f() takes 2 parameters, but this rule has no thing to pass (only on hit and each pass the numbers of their things)']);
diag('diag-call-unknown', 'fn openChest() {}\nrules:\n  every frame: call openChst\n', ['3:21: Unknown function "openChst" — did you mean "openChest"?']);
diag('diag-restart-in-start', 'rules:\n  on start: restart\n', ['2:13: restart cannot be an action of on start — it would start again forever']);
diag('diag-two-rules-blocks', 'rules:\n  on start: set a 1\nrules:\n  on start: set b 1\n', ['3:1: A file has one rules: block — put these rules into the rules: block at line 1']);
diag('diag-reserved-name', 'mut __lg_x = 1\nrules:\n  on start: set a 1\n', ['1:1: Names starting with __lg are reserved for the code generated from thing / rules blocks — rename __lg_x']);
diag('diag-type-error-in-rule-points-at-the-action', 'thing hero: box 4 4\nrules:\n  every frame: hero mv "a", 0\n', ['3:21: Cannot store a str in hero[…].x (num) — it holds numbers']);
diag('diag-multi-file', join([['main.emit', 'export fn run() {}'], ['game.emit', 'thing hero: box 4 4\nrules:\n  on hit hero cion: stop\n']]), ['game.emit:3:15: Unknown thing "cion" in on hit (or wall: a solid map tile / wall thing, edge: the screen edge) — the things are: hero']);

// ── projects, exports, Memory tab ──
test('multi-file-game-in-game-emit', async page => {
  const p = [];
  await ok(page, p, join([
    ['main.emit', 'import game\nmut n = 0\nexport fn frame() {\n  n += 1\n}\nexport fn count() int { return n }'],
    ['game.emit', 'thing hero: box 10 10 #ff0000, at 10 10\nrules:\n  every frame: hero mv 1, 0 : add steps 1\n  show steps\n'],
  ]));
  const g = await page.evaluate(() => { T.step(4); return [Number(window._wi.exports.count()), _lgShows[0], T.xy('hero', 0), Object.keys(window._wi.exports).filter(k => /game|frame/.test(k)).sort()]; });
  eq(p, 'entry frame() calls the generated step; game() exported plainly', g, [4, 4, [14, 10], ['frame', 'game']]);
  return p;
});

test('memory-tab-shows-thing-regions', async page => {
  const p = [];
  await ok(page, p, 'thing hero: box 10 10, at 10 10, hp 3\nthing coin: box 4 4, count 5\n');
  const txt = await page.evaluate(async () => {
    const b = document.querySelector('[data-tab="memory"],#tab-btn-memory') || Array.from(document.querySelectorAll('button,div,span')).find(e => e.textContent.trim() === 'Memory' && e.offsetParent);
    if (b) b.click();
    await new Promise(r => setTimeout(r, 300));
    const m = document.getElementById('tab-memory');
    return m ? m.innerText : '(no #tab-memory)';
  });
  if (!/hero/.test(txt) || !/coin/.test(txt) || !/hp/.test(txt)) p.push('memory tab text: ' + txt.slice(0, 300));
  return p;
});

test('exports-html-js-offline', async (page, ctx) => {
  const p = [];
  await ok(page, p, 'thing hero: box 20 20 #ff0000, at 10 10\nthing coin: circ 5 #00ff00, count 2, at 100+i*40 15\nrules:\n  every frame: hero mv 2, 0\n  on hit hero coin: remove coin : add score 1\n  on hit hero edge: block hero\n  show score\n');
  const files = await page.evaluate(async () => {
    const got = {};
    window._download = (name, content) => { got[name] = typeof content === 'string' ? content : null; };
    window.alert = () => {};
    for (const f of ['html', 'js', 'htmloff']) { try { await doExport(f); } catch (e) { got['err ' + f] = e.message; } }
    return got;
  });
  const names = Object.keys(files);
  const html = files['program.html'], js = files['program.js'];
  if (!html || !js) { p.push('exports: ' + names.join(', ')); return p; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emit-rules-'));
  async function check(label, url, serve) {
    const pg = await ctx.browser.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(e.message));
    await pg.route(/^https?:/, r => { const s = serve && serve[r.request().url()]; return s ? r.fulfill({ body: s[0], contentType: s[1] }) : r.abort(); });
    await pg.goto(url);
    await pg.waitForFunction(() => document.querySelector('canvas') && window._emitRegionRead && !window._emitRegionRead(1, 0, 'alive') && !window._emitRegionRead(1, 1, 'alive'), null, { timeout: 8000 }).catch(() => errs.push('the coins were not collected within 8 s'));
    const g = await pg.evaluate(() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let red = 0; for (let i = 0; i < d.length; i += 4) if (d[i] === 255 && !d[i + 1] && !d[i + 2]) red++; return { red, x: window._emitRegionRead(0, 0, 'x'), regions: window._emitRegions().map(r => r.name) }; }).catch(e => ({ err: e.message }));
    await pg.close();
    if (errs.length) p.push(label + ': ' + errs.join('; '));
    if (!(g.red >= 300) || !(g.x > 120) || JSON.stringify(g.regions) !== '["hero","coin"]') p.push(label + ': ' + JSON.stringify(g));
  }
  fs.writeFileSync(path.join(dir, 'program.html'), html);
  await check('.html', 'file://' + path.join(dir, 'program.html'));
  const host = '<!DOCTYPE html><html><body><div id="app"></div><script type="module">const m=await import("./program.js");window.__app=await m.init({target:document.getElementById("app")});</script></body></html>';
  await check('.js', 'http://export.test/index.html', { 'http://export.test/index.html': [host, 'text/html'], 'http://export.test/program.js': [js, 'text/javascript'] });
  const off = files['program-offline.html'] || Object.keys(files).filter(k => /offline.*\.html$/.test(k)).map(k => files[k])[0];
  if (!off) p.push('no offline .html: ' + names.join(', '));
  else { fs.writeFileSync(path.join(dir, 'off.html'), off); await check('offline .html', 'file://' + path.join(dir, 'off.html')); }
  return p;
});

// ── byte identity: programs without thing / rules blocks ──
test('byte-identical-without-things', async (page, ctx) => {
  let old;
  try { old = execFileSync('git', ['show', BASE_COMMIT + ':emit-ide-1_32.html'], { cwd: path.join(__dirname, '..'), maxBuffer: 64 << 20 }).toString(); }
  catch (e) { return ['cannot read ' + BASE_COMMIT + ' with git: ' + e.message.slice(0, 120)]; }
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'emit-lg-')), 'old.html');
  fs.writeFileSync(tmp, old);
  const interop = fs.readFileSync(path.join(__dirname, 'run-interop.js'), 'utf8');
  const a = interop.indexOf('const TESTS = ['), b = interop.indexOf('\nasync function runTest');
  const progs = eval(interop.slice(interop.indexOf('const FAKE_LIB'), a) + interop.slice(a, b) + '\nTESTS.map(t => t.src.trim() + "\\n")');
  const sums = async pg => pg.evaluate(progs => {
    const keys = Object.keys(EX).map(k => 'ex:' + k).concat(progs.map((_, i) => 'interop:' + i));
    const srcs = Object.keys(EX).map(k => EX[k]).concat(progs), out = {};
    for (let n = 0; n < srcs.length; n++) {
      const s = srcs[n], key = keys[n];
      try { const r = compile(s, 'wasm32'), props = {}; Object.keys(r.imports).forEach(k => { if (!/^\d+$/.test(k)) props[k] = r.imports[k]; }); out[key] = Array.from(r.wasm).join(',') + '|' + JSON.stringify(props) + '|' + JSON.stringify(r.errors); }
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
  if (common.length < 100 || common.length !== Object.keys(before).length) p.push('programs compared ' + common.length + ' of ' + Object.keys(before).length);
  // Programs that use `await` get the await shadow stack (see _emitAwaitRoots): not compared (tests/run-memory.js covers them).
  const srcOf = k => (k.indexOf('interop:') === 0 ? progs[Number(k.slice(8))] : EXsrc[k]) || '';
  const awaits = common.filter(k => now[k] !== before[k] && /\bawait\b/.test(srcOf(k)));
  common.forEach(k => { if (now[k] !== before[k] && awaits.indexOf(k) < 0) p.push(k + ' differs'); });
  const added = Object.keys(now).filter(k => !(k in before));
  ctx.note = (common.length - awaits.length) + ' programs (examples + interop) byte-identical to ' + BASE_COMMIT + (awaits.length ? '; ' + awaits.length + ' with await not compared (shadow stack)' : '') + (added.length ? '; new: ' + added.join(', ') : '');
  return p;
});

// ── a whole game with every other part for real: a sprite, a map with walls and objects, controls, a sound ──
test('game-with-real-sprite-map-controls-sound', async page => {
  const p = [];
  const MAP = 'map level1: 20x15, tile 16\n  legend # wall solid #404040,  . floor #102030\n  rows\n' + rowsOf(20, 15, (x, y) => (x === 0 || y === 0 || x === 19 || y === 14) ? '#' : '.') + '\n  objects\n    coin 3,2 value 5\n    coin 6,2\n    slime 10,10\n';
  await ok(page, p, `
sprite hero: 2x2
  palette ff00ff
  "11"
  "11"
` + MAP + `
controls pad: stick left, buttons A
sound pick: square 988, 60ms
thing hero: sprite hero, at 40 60, size 12 12
thing coin: circ 4 #ffcd75, from map level1, value 1
thing slime: box 10 10 #6ec850, from map level1, chase hero 1
rules:
  stage map level1
  stage controls pad
  every frame: hero mv stickX()*2, stickY()*2
  on hit hero wall: block hero
  on hit hero coin: add score coin.value : remove coin : play pick
  on press A: add jumps 1
  show score, jumps
`);
  const at = sel => page.evaluate(sel => { const e = document.querySelector(sel); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 }; }, sel);
  const snap = () => page.evaluate(() => ({ hero: T.xy('hero', 0), coins: T.alive('coin'), coinXY: [T.xy('coin', 0), T.xy('coin', 1)], slime: T.xy('slime', 0), shows: _lgShows.slice(), snd: window.__calls.snd.slice() }));
  const s0 = await snap();
  eq(p, 'start: hero at 40,60; two coins from the map objects (tiles 3,2 and 6,2 → pixels); the slime at tile 10,10', [s0.hero, s0.coins, s0.coinXY, s0.slime], [[40, 60], 2, [[48, 32], [96, 32]], [160, 160]]);
  // push the on-screen stick up (held for the next frames)
  const st = await at('#tab-output [data-emit-controls="pad"] [data-ctl="stick"]');
  await page.mouse.move(st.x, st.y); await page.mouse.down(); await page.mouse.move(st.x, st.y - st.r * 1.5);
  const trace = await page.evaluate(() => { const r = []; for (let f = 1; f <= 30; f++) { T.step(1); r.push([T.xy('hero', 0)[1], T.alive('coin'), _lgShows[0], window.__calls.snd.length]); } return r; });
  await page.mouse.up();
  const hitAt = trace.findIndex(x => x[1] === 1) + 1;
  // the hero (40..52 x 60..72) moves up 2 px per frame; it overlaps the coin at 48..56 x 32..40 once its top is above 40: frame 11
  eq(p, 'frame by frame: y goes 58, 56, … ; the coin is taken in frame 11 (score += its value 5, pick played once)', [trace[0][0], trace[1][0], hitAt, trace[10][2], trace[10][3], trace[9][3]], [58, 56, 11, 5, 1, 0]);
  eq(p, 'the top wall (y < 16) stops the hero: block hero', trace[29][0], 16);
  const s1 = await snap();
  const moved = Math.hypot(s1.slime[0] - 160, s1.slime[1] - 160);
  if (!(moved > 28 && moved < 30.5 && s1.slime[0] < 160 && s1.slime[1] < 160)) p.push('the slime chases the hero (1 px per frame up-left for 30 frames): ' + JSON.stringify([s1.slime, s1.hero, moved]));
  eq(p, 'the sound played by the rule is the sound block (spy on _sndPlay)', s1.snd, ['pick']);
  const a = await at('#tab-output [data-ctl="A"]');
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.evaluate(() => T.step(3)); await page.mouse.up(); await page.evaluate(() => T.step(1));
  eq(p, 'on press A with the on-screen button: once', (await page.evaluate(() => _lgShows.slice()))[1], 1);
  const px = await page.evaluate(() => { const h = T.xy('hero', 0); return [T.px(310, 230), T.px(100, 100), T.px(h[0] + 1, h[1] + 1), T.px(h[0] + 11, h[1] + 11)]; });
  eq(p, 'drawn: the map (wall, floor) under the things; the hero is its sprite stretched to 12x12', px, ['#404040', '#102030', '#ff00ff', '#ff00ff']);
  return p;
});

// ── the bundled example ──
test('example-game-runs', async page => {
  const p = [];
  const src = await page.evaluate(() => EX.game);
  if (!src) return ['EX.game is missing'];
  await ok(page, p, src);
  const g = await page.evaluate(() => { T.step(120); const c = document.querySelector('#tab-output canvas'); return { w: c.width, kinds: _lgMeta.kinds.map(k => k.name), alive: _lgMeta.kinds.map(k => T.alive(k.name)) }; });
  if (!g.kinds.length || g.alive.every(n => !n)) p.push('example: ' + JSON.stringify(g));
  return p;
});

// ── performance: 500 chasers + collisions ──
test('performance-500-chasers', async (page, ctx) => {
  const p = [];
  await ok(page, p, `
thing hero: box 10 10 #5fcde4, at 160 120
thing slime: box 6 6 #6ec850, count 500, at (i * 37) % 320, (i * 53) % 240, chase hero 0.5
thing bullet: box 4 4, pool 32
rules:
  seed 1
  every frame: hero mv stickX()*2, stickY()*2
  every 100ms: spawn bullet at hero.x hero.y vel 4 1
  on hit bullet slime: remove bullet : remove slime : spawn slime at rnd(320) 0
  on hit hero slime: add hits 1 : slime to rnd(320), 0
  on hit bullet edge: remove bullet
  show hits
`);
  const g = await page.evaluate(() => {
    T.step(30);
    let t0 = performance.now(); for (let i = 0; i < 300; i++) window._wi.exports.frame(); const all = (performance.now() - t0) / 300;
    // the simulation alone (no drawing): __lgFrame is replaced by a no-op for the measurement
    const keep = _lgDraw; _lgDraw = function () {};
    t0 = performance.now(); for (let i = 0; i < 300; i++) window._wi.exports.frame(); const sim = (performance.now() - t0) / 300;
    _lgDraw = keep;
    return { all, sim, alive: T.alive('slime') };
  });
  if (g.alive !== 500) p.push('slimes alive: ' + g.alive);
  // worst case: every slime against every other slime (124 750 pairs per frame, no spatial grid)
  await ok(page, p, `
thing hero: box 10 10, at 160 120
thing slime: box 6 6, count 500, at (i * 37) % 320, (i * 53) % 240, chase hero 0.5
rules:
  on hit slime slime: add bumps 1
`);
  const w = await page.evaluate(() => {
    T.step(5);
    const keep = _lgDraw; _lgDraw = function () {};
    const t0 = performance.now(); for (let i = 0; i < 60; i++) window._wi.exports.frame(); const sim = (performance.now() - t0) / 60;
    _lgDraw = keep;
    return sim;
  });
  ctx.note = '500 chasers + 32 bullets, hit checks bullet×slime, hero×slime: ' + g.sim.toFixed(3) + ' ms/frame simulation, ' + g.all.toFixed(3) + ' ms/frame with drawing (headless Chromium, software canvas); 500 slimes with on hit slime slime (124750 pairs): ' + w.toFixed(2) + ' ms/frame';
  if (g.all > 16) p.push('slower than 60 fps: ' + g.all.toFixed(2) + ' ms/frame');
  return p;
});

async function newPage(browser, fileUrl, problems, spies) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message.slice(0, 300)));
  await page.route(/^https?:/, route => route.abort());
  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof compileAndRun === 'function');
  await page.evaluate(HELPERS);
  if (spies) await page.evaluate(SPIES);
  await page.evaluate(() => { try { closeWelcome(); } catch (e) {} });
  return page;
}

(async () => {
  const args = process.argv.slice(2);
  const file = path.resolve(args[0] && /\.html$/.test(args[0]) ? args.shift() : path.join(__dirname, '..', 'emit-ide-1_32.html'));
  const tests = TESTS.filter(t => !args.length || args.includes(t.name));
  const browser = await chromium.launch();
  let failed = 0;
  for (const t of tests) {
    const problems = [], ctx = { browser };
    let page;
    try {
      page = await newPage(browser, 'file://' + file, problems, t.spies !== false);
      problems.push(...((await t.fn(page, ctx)) || []));
    } catch (e) { problems.push('test failed: ' + e.message.slice(0, 400)); }
    if (page) await page.close();
    if (!problems.length) console.log('PASS  ' + t.name + (ctx.note ? ' (' + ctx.note + ')' : ''));
    else { failed++; console.log('FAIL  ' + t.name + '\n      ' + problems.join('\n      ')); }
  }
  await browser.close();
  console.log('\n' + (tests.length - failed) + '/' + tests.length + ' rules tests passed');
  process.exit(failed || !tests.length ? 1 : 0);
})();

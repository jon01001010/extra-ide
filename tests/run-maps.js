#!/usr/bin/env node
// Maps and controls: `map` / `controls` blocks, their compile errors (exact positions), every builtin
// (drawMap pixels, a sprite tile drawn from a real sprite block, setTile at run time, objects),
// the runtime helpers for other runtime code (_mapInfo & co., _ctlState), multi-file projects, the exported
// .html / .js / offline pages, the on-screen controls under synthesized multi-touch, the keyboard mapping,
// and byte identity of programs without these blocks. Runs in headless Chromium, offline.
//
//   node tests/run-maps.js [path/to/emit-ide.html] [testName ...]
//   VERBOSE=1 prints each program's Output tab.
//
// Kinds of tests (as in run-regions.js):
//   run   {src, expect, errors?, after?, wait?, init?}  src goes through the editor and Run; expected lines appear in
//         order; red "✗" lines only when errors: true. after(page) → problems[]. init: TEST-ONLY page script.
//   diag  {src, diag: [string | RegExp]}  compile(src) must throw / return exactly these errors.
//   page  {page: async (page, ctx) => problems[]}  free-form checks on a loaded IDE page.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const MARK = '//// file: ';
const join = files => files.map((f, i) => (i === 0 && f[0] === 'main.emit' ? '' : MARK + f[0] + '\n') + f[1].replace(/^\n/, '')).join('\n');
const BASE_COMMIT = '8d7f2b4'; // last commit without maps and controls

// Real sprite blocks (SPRITE) for the map legend's `sprite grass` / `sprite other`: drawMap draws them through
// the real _spriteDraw at the tile size (opts w / h), pixel-crisp.
const SPR_GRASS4 = `
sprite grass: 2x2
  palette ff00ff 00ffff ffff00 ffffff
  "12"
  "34"
`;
const SPR_GRASS_MAGENTA = `
sprite grass: 1x1
  palette ff00ff
  "1"
`;

const M4 = `
map m: 4x2, tile 16
  legend # wall solid #ff0000,  . floor #00ff00,  g grass sprite grass #0000ff
  rows
    "#.g#"
    "...."
  objects
    coin 1,0 value 5
    coin 2,1
    hero 0,1 name "Ann Lee"
`;
// pixel of the output canvas
const px = (page, x, y) => page.evaluate(([x, y]) => Array.from(document.querySelector('#tab-output canvas').getContext('2d').getImageData(x, y, 1, 1).data).slice(0, 3).join(','), [x, y]);

const CTL_PROG = `
controls pad: stick left, buttons A "jump" B, size 1.0, opacity 0.5
map arena: 2x1
  legend . floor #222222
  rows
    ".."
export fn main() {
  canvas(300, 120)
  drawMap(arena)
  useControls(pad)
  animate()
}
export fn frame() {
  let a = 0
  if (pressed("A")) { a = 1 }
  let j = 0
  if (justPressed("A")) { j = 1 }
  let b = 0
  if (pressed("B")) { b = 1 }
  rec(stickX(), stickY(), a, j, b)
}`;

const TESTS = [
  // ── builtins ──
  { name: 'builtins-values', src: M4 + `
export fn run() {
  print(mapW(m))
  print(mapH(m))
  print(tileSize(m))
  printStr(tileAt(m, 0, 0) + tileAt(m, 1, 0) + tileAt(m, 2, 0))
  printStr("[" + tileAt(m, 9, 0) + "]")
  if (solidAt(m, 1.0, 1.0)) { printStr("wall solid") }
  if (!solidAt(m, 20.0, 1.0)) { printStr("floor free") }
  if (!solidAt(m, 40, 4)) { printStr("grass free") }
  if (solidAt(m, -1.0, 5.0)) { printStr("outside solid") }
  if (solidAt(m, 64.0, 5.0)) { printStr("right of the map solid") }
  print(objCount(m, "coin"))
  print(objCount(m, "slime"))
  printNum(objX(m, "coin", 1))
  printNum(objY(m, "coin", 1))
  printNum(objY(m, "hero", 0))
  setTile(m, 1, 1, "#")
  printStr(tileAt(m, 1, 1))
  if (solidAt(m, 17.0, 17.0)) { printStr("now solid") }
  let k = m
  print(mapW(k))
}`, expect: ['> 4', '> 2', '> 16', '> #.g', '> []', '> wall solid', '> floor free', '> grass free', '> outside solid', '> right of the map solid', '> 2', '> 0', '> 32', '> 16', '> 16', '> #', '> now solid', '> 4'] },
  { name: 'drawmap-pixels-colours-offset-and-colour-state', src: M4 + `
export fn run() {
  canvas(96, 32)
  color(1, 2, 3)
  drawMap(m)
  rect(80, 0, 16, 16)
  drawMap(m, 64.0, 16.0)
}`, expect: [], after: async page => {
    const p = [], want = { '8,8': '255,0,0', '24,8': '0,255,0', '40,8': '0,0,255', '56,8': '255,0,0', '8,24': '0,255,0', '88,8': '1,2,3', '72,24': '255,0,0', '88,24': '0,255,0' };
    for (const [k, v] of Object.entries(want)) { const [x, y] = k.split(',').map(Number); const got = await px(page, x, y); if (got !== v) p.push('pixel ' + k + ': ' + got + ', want ' + v); }
    return p;
  } },
  { name: 'drawmap-sprite-tile-from-sprite-block', src: M4 + SPR_GRASS4 + `
export fn run() {
  canvas(64, 32)
  drawMap(m)
}`, expect: [], after: async page => {
    const p = [];
    // the 2x2 sprite stretched to the 16x16 tile at (32, 0): four 8x8 quarters, crisp edges
    const want = [[32, 0, '255,0,255'], [39, 7, '255,0,255'], [40, 0, '0,255,255'], [47, 7, '0,255,255'], [32, 8, '255,255,0'], [39, 15, '255,255,0'], [40, 8, '255,255,255'], [47, 15, '255,255,255']];
    for (const [x, y, c] of want) { const got = await px(page, x, y); if (got !== c) p.push('sprite tile pixel ' + x + ',' + y + ' = ' + got + ', want ' + c); }
    if (await px(page, 8, 8) !== '255,0,0') p.push('colour tile pixel ' + await px(page, 8, 8));
    if (await px(page, 48, 8) !== '255,0,0') p.push('the next tile is untouched: ' + await px(page, 48, 8));
    const info = await page.evaluate(() => { const c = document.createElement('canvas').getContext('2d'); return [_spriteDraw(c, 'grass', 0, 0, 0, { w: 16, h: 16 }), _spriteDraw(c, 'nosuch', 0, 0, 0, { w: 16, h: 16 }), _spriteDraw(c, 'grass', 'nosuchframe', 0, 0, { w: 16, h: 16 })]; });
    if (JSON.stringify(info) !== '[true,false,false]') p.push('_spriteDraw returns ' + JSON.stringify(info) + ', want [true,false,false]');
    return p;
  } },
  { name: 'drawmap-sprite-falls-back-to-colour', src: `
map m: 3x1, tile 8
  legend a one sprite missing #123456,  b two sprite other,  c three sprite gone
  rows
    "abc"
sprite other: 1x1
  palette ff00ff
  "1"
export fn run() {
  canvas(24, 8)
  drawMap(m)
}`, expect: [], after: async page => {
    const p = [];
    if (await px(page, 4, 4) !== '18,52,86') p.push('unknown sprite: its colour expected, got ' + await px(page, 4, 4));
    if (await px(page, 12, 4) !== '255,0,255') p.push('sprite tile ' + await px(page, 12, 4));
    if (await px(page, 20, 4) !== '128,128,128') p.push('unknown sprite without a colour: grey expected, got ' + await px(page, 20, 4));
    return p;
  } },
  { name: 'drawmap-sprite-without-sprite-block-uses-colour', src: M4 + `
export fn run() {
  canvas(64, 32)
  drawMap(m)
}`, expect: [], after: async page => (await px(page, 40, 8)) === '0,0,255' ? [] : ['no sprite block grass: colour expected, got ' + await px(page, 40, 8)] },
  { name: 'settile-at-run-time-redraws', src: M4 + `
mut n = 0
export fn main() {
  canvas(64, 32)
  animate()
}
export fn frame() {
  n += 1
  if (n == 3) { setTile(m, 1, 0, "#") }
  drawMap(m)
}`, wait: 400, expect: [], after: async page => (await px(page, 24, 8)) === '255,0,0' ? [] : ['door tile not changed: ' + await px(page, 24, 8)] },
  { name: 'runtime-helpers-for-other-runtime-code', src: M4 + `
export fn run() { setTile(m, 3, 1, "g") }`, expect: [], after: async page => page.evaluate(() => {
    const p = [], eq = (a, b, w) => { if (JSON.stringify(a) !== JSON.stringify(b)) p.push(w + ': ' + JSON.stringify(a)); };
    eq(_mapInfo('m'), { w: 4, h: 2, tile: 16, legend: { '#': { name: 'wall', solid: true, color: '#ff0000' }, '.': { name: 'floor', solid: false, color: '#00ff00' }, g: { name: 'grass', solid: false, sprite: 'grass', color: '#0000ff' } } }, '_mapInfo');
    eq(_mapInfo('nope'), null, '_mapInfo unknown');
    eq([_mapTile('m', 0, 0), _mapTile('m', 3, 1), _mapTile('m', 4, 0)], ['#', 'g', ''], '_mapTile');
    eq([_mapSolidAt('m', 1, 1), _mapSolidAt('m', 17, 1), _mapSolidAt('m', -3, 1)], [true, false, true], '_mapSolidAt');
    eq(_mapObjects('m'), [{ kind: 'coin', x: 1, y: 0, px: 16, py: 0, props: { value: 5 } }, { kind: 'coin', x: 2, y: 1, px: 32, py: 16, props: {} }, { kind: 'hero', x: 0, y: 1, px: 0, py: 16, props: { name: 'Ann Lee' } }], '_mapObjects');
    const c = document.createElement('canvas'); c.width = 64; c.height = 32; const g = c.getContext('2d');
    _mapDraw(g, 'm', 0, 0);
    eq(Array.from(g.getImageData(8, 8, 1, 1).data).slice(0, 3), [255, 0, 0], '_mapDraw');
    eq(Object.keys(_ctlState()).sort(), ['a', 'b', 'c', 'tapX', 'tapY', 'tapping', 'x', 'y'], '_ctlState keys');
    return p;
  }) },
  { name: 'runtime-errors-are-red-lines', errors: true, src: M4 + `
export fn run() {
  printNum(objX(m, "coin", 5))
  let s = "xy"
  setTile(m, 0, 0, s)
  setTile(m, 9, 0, ".")
  printStr("still running")
}`, expect: ['✗ objX: map m has 2 "coin" objects — there is no number 5', '> 0', '✗ setTile: "xy" is not a tile of map m — use one of its legend characters: # . g', '✗ setTile: (9, 0) is outside map m (4x2)', '> still running'] },
  { name: 'user-functions-win-over-builtins', src: M4 + `
fn tileAt(a: int, b: int, c: int) str { return "mine" }
export fn run() {
  printStr(tileAt(1, 2, 3))
  print(mapW(m))
}`, expect: ['> mine', '> 4'] },
  // ── projects of several files: names are project-wide ──
  { name: 'project-wide-names', src: join([
    ['main.emit', `
import game
export fn run() {
  print(mapW(level1) + game.width())
  printStr(tileAt(level1, 0, 0))
}`],
    ['game.emit', `
public fn width() int {
  return mapW(level1) * 10
}`],
    ['stages.emit', `
map level1: 3x1, tile 8
  legend # wall solid #333333,  . floor #000000
  rows
    "#.#"
controls pad: stick right`]]), expect: ['> 33', '> #'] },
  // ── compile errors with exact positions ──
  { name: 'diag-unknown-map', diag: ['6:27: Unknown map "mm" — the maps of this project: m (did you mean "m"?)'], src: 'map m: 3x2\n  legend # wall solid #333,  . floor #111\n  rows\n    "#.#"\n    "..."\nexport fn run() { drawMap(mm) }' },
  { name: 'diag-unknown-map-no-maps', diag: ['2:27: Unknown map "q" — this project has no map block'], src: 'controls c: stick left\nexport fn run() { drawMap(q) }' },
  { name: 'diag-arguments', diag: ['6:19: drawMap() takes 1 or 3 arguments — drawMap(m, ox, oy)'], src: 'map m: 3x2\n  legend # wall solid #333,  . floor #111\n  rows\n    "#.#"\n    "..."\nexport fn run() { drawMap(m, 1) }' },
  { name: 'diag-row-length', diag: ['5:5: Row 2 of map m has 4 tiles, but the map is 3 wide'], src: 'map m: 3x2\n  legend # wall solid #333,  . floor #111\n  rows\n    "#.#"\n    "...."\nexport fn run() { }' },
  { name: 'diag-row-count', diag: ['3:3: map m has 1 row, but its size says 2 (3x2)'], src: 'map m: 3x2\n  legend # wall\n  rows\n    "###"\nexport fn run() { }' },
  { name: 'diag-duplicate-legend-char', diag: ['2:30: "#" is already in the legend of map m (as wall) — every character stands for one tile'], src: 'map m: 3x2\n  legend # wall solid #333,  # floor #111\n  rows\n    "#.#"\n    "###"\nexport fn run() { }' },
  { name: 'diag-char-not-in-legend', diag: ['4:7: "x" in row 1 of map m is not in its legend — add it: legend x name #888888'], src: 'map m: 3x2\n  legend # wall solid #333\n  rows\n    "#x#"\n    "###"\nexport fn run() { }' },
  { name: 'diag-object-off-map', diag: ['7:10: coin 3,1 is outside map m — it is 3x2 (x 0 to 2, y 0 to 1)'], src: 'map m: 3x2\n  legend # wall\n  rows\n    "###"\n    "###"\n  objects\n    coin 3,1\nexport fn run() { }' },
  { name: 'diag-object-without-coordinates', diag: ['4:10: Expected tile coordinates after coin — coin 2,3'], src: 'map m: 1x1\n  legend # wall\n  rows\n    "#"\n  objects\n    coin x\nexport fn run() { }'.replace('rows\n    "#"\n  objects\n    coin x', 'objects\n    coin x\n  rows\n    "#"') },
  { name: 'diag-legend-word', diag: ['2:17: Unknown word "hard" in the legend entry of "#" — write solid, a colour like #3a3a5c or sprite NAME'], src: 'map m: 1x1\n  legend # wall hard\n  rows\n    "#"\nexport fn run() { }' },
  { name: 'diag-unquoted-row', diag: ['4:5: A row of map m is written in double quotes — "#....#"'], src: 'map m: 1x1\n  legend # wall\n  rows\n    #\nexport fn run() { }' },
  { name: 'diag-unknown-line', diag: ['3:3: Unknown line in map m — expected legend, rows or objects'], src: 'map m: 1x1\n  legend # wall\n  colours\n  rows\n    "#"\nexport fn run() { }' },
  { name: 'diag-header', diag: ['1:8: Expected the size of map m first — map m: 20x15, tile 16'], src: 'map m: tile 8\n  legend # wall\n  rows\n    "#"\nexport fn run() { }' },
  { name: 'diag-tile-size', diag: ['1:18: tile must be a whole number of pixels from 1 to 256, not 0'], src: 'map m: 1x1, tile 0\n  legend # wall\n  rows\n    "#"\nexport fn run() { }' },
  { name: 'diag-controls-stick', diag: ['1:19: Expected left, right or none after stick'], src: 'controls c: stick middle\nexport fn run() { }' },
  { name: 'diag-controls-button-twice', diag: ['1:23: Button A is listed twice'], src: 'controls c: buttons A A\nexport fn run() { }' },
  { name: 'diag-controls-size', diag: ['1:18: size must be a number from 0.5 to 2 — size 1.0'], src: 'controls c: size 5\nexport fn run() { }' },
  { name: 'diag-controls-unknown', diag: ['1:26: Unknown setting "colour" in controls c — stick, dpad, buttons, size, opacity, deadzone or keys'], src: 'controls c: stick left,  colour red\nexport fn run() { }' },
  { name: 'diag-wrong-kind', diag: ['7:31: useControls() needs a controls block, but m is a map'], src: 'map m: 3x2\n  legend # wall solid #333,  . floor #111\n  rows\n    "#.#"\n    "..."\ncontrols c: stick left\nexport fn run() { useControls(m) }' },
  { name: 'diag-settile-constant', diag: ['6:36: setTile: "x" is not a tile of map m — use one of its legend characters: # .'], src: 'map m: 3x2\n  legend # wall solid #333,  . floor #111\n  rows\n    "#.#"\n    "..."\nexport fn run() { setTile(m, 0, 0, "x") }' },
  { name: 'diag-button-name', diag: ['6:31: pressed("D") — the buttons are "A", "B" and "C"'], src: 'map m: 3x2\n  legend # wall solid #333,  . floor #111\n  rows\n    "#.#"\n    "..."\nexport fn run() { if (pressed("D")) {} }' },
  { name: 'diag-name-taken-by-function', diag: ['1:5: map m has the same name as the function m at line 6 — rename one of them'], src: 'map m: 3x2\n  legend # wall solid #333,  . floor #111\n  rows\n    "#.#"\n    "..."\nfn m() {}\nexport fn run() { }' },
  { name: 'diag-block-inside-function', diag: ['2:1: map blocks belong at the top level of a file, not inside a function'], src: 'export fn run() {\nmap q: 2x2\n}' },
  { name: 'diag-duplicate-across-files', diag: ['b.emit:1:10: "lvl" is already the name of map lvl at main.emit:1 — every map and controls block needs its own name'], src: join([['main.emit', 'map lvl: 1x1\n  legend . f #000\n  rows\n    "."\nexport fn run() { }'], ['b.emit', 'controls lvl: stick left']]) },
  { name: 'diag-position-in-other-file', diag: ['stages.emit:4:5: Row 1 of map lvl has 3 tiles, but the map is 4 wide'], src: join([['main.emit', 'export fn run() { print(mapW(lvl)) }'], ['stages.emit', 'map lvl: 4x1\n  legend . f #000\n  rows\n    "..."']]) },
  { name: 'diag-unknown-map-in-other-file', diag: ['main.emit:1:30: Unknown map "lv" — the maps of this project: lvl (did you mean "lvl"?)'], src: join([['main.emit', 'export fn run() { print(mapW(lv)) }'], ['stages.emit', 'map lvl: 4x1\n  legend . f #000\n  rows\n    "...."']]) },
  // ── not a block: inside comments and strings, or not in column 0 ──
  { name: 'not-blocks-in-comments-and-strings', src: `
/*
map x: 1x1
*/
let s = "a
map y: 2x2
b"
export fn run() {
  printStr("ok " + intToStr(strLen(s)))
}`, expect: ['> ok 14'] },
  // ── the parser and writer the tools use: a block written back is the same text ──
  { name: 'block-text-round-trip', page: async page => page.evaluate(() => {
    const p = [];
    const texts = [
      'map level1: 20x3, tile 16\n  legend # wall solid #3a3a5c,  . floor #1b1b2a,  ~ water solid #2050c0,  g grass sprite grass\n  rows\n    "####################"\n    "#..........~~...g..#"\n    "####################"\n  objects\n    hero 2,1\n    slime 12,1 speed 0.5\n    sign 3,1 text "hi there"',
      'map m: 2x1\n  legend\n    a one #111111\n    b two solid sprite rock\n  rows\n    "ab"',
      'map m: 2x1, tile 8\n  legend a one #111\n  rows\n    "a "\n  // a note kept\n  weather rain',
      'controls pad: stick left, buttons A "jump" B, size 1.0, opacity 0.5',
      'controls pad: dpad right, buttons left A B C, size 1.25, opacity 0.8, deadzone 0.3, keys off, wobble 3',
    ];
    texts.forEach((t, i) => {
      const b = _stFindBlocks(t)[0]; b.line = 0;
      const m = _stParseBlock(b), out = m.kind === 'map' ? _stWriteMap(m) : _stWriteControls(m);
      if (out !== t) p.push('text ' + i + ' written back as:\n' + out);
    });
    return p;
  }) },
  // ── controls: the overlay, multi-touch, keyboard ──
  { name: 'controls-overlay-multitouch-per-frame', touch: true, src: CTL_PROG, expect: [], wait: 300, after: async page => {
    const p = [];
    await page.evaluate(() => { window.F = []; });
    const r = await page.evaluate(() => { const g = s => { const b = document.querySelector('[data-ctl="' + s + '"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, r: b.width / 2 }; }; return { s: g('stick'), a: g('A'), b: g('B'), layer: getComputedStyle(document.querySelector('.emit-controls')).position }; });
    if (r.layer !== 'sticky') p.push('overlay position ' + r.layer);
    const cdp = await page.context().newCDPSession(page);
    const T = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
    const last = () => page.evaluate(() => window.F[window.F.length - 1]);
    const take = async () => { const f = await page.evaluate(() => { const f = window.F; window.F = []; return f; }); return f; };
    await T('touchStart', [[r.s.x + r.s.r * 0.98, r.s.y, 1], [r.a.x, r.a.y, 2]]);
    await page.waitForTimeout(250);
    let f = await take(), l = f[f.length - 1];
    if (!l || !(l[0] > 0.95) || Math.abs(l[1]) > 0.05 || l[2] !== 1 || l[4] !== 0) p.push('stick right + A: ' + JSON.stringify(l));
    if (f.filter(x => x[3] === 1).length !== 1) p.push('justPressed("A") should be true in exactly one frame, got ' + f.filter(x => x[3] === 1).length);
    await T('touchMove', [[r.s.x, r.s.y - r.s.r * 0.6, 1], [r.a.x, r.a.y, 2]]);
    await page.waitForTimeout(150);
    l = await last();
    if (!l || Math.abs(l[0]) > 0.05 || !(l[1] < -0.45 && l[1] > -0.65) || l[2] !== 1) p.push('stick up 0.6 with dead zone 0.15 → about -0.53: ' + JSON.stringify(l));
    await T('touchEnd', [[r.a.x, r.a.y, 2]]);  // A released while the stick finger stays
    await T('touchStart', [[r.s.x, r.s.y - r.s.r * 0.6, 1], [r.b.x, r.b.y, 3]]);  // B pressed
    await page.waitForTimeout(150);
    await take();
    await page.waitForTimeout(100);
    l = await last();
    if (!l || l[2] !== 0 || l[4] !== 1) p.push('A up, B down: ' + JSON.stringify(l));
    await T('touchStart', [[r.s.x, r.s.y - r.s.r * 0.6, 1], [r.b.x, r.b.y, 3], [r.a.x, r.a.y, 4]]);  // three fingers
    await page.waitForTimeout(200);
    f = await take();
    if (f.filter(x => x[3] === 1).length !== 1 || f[f.length - 1][2] !== 1 || f[f.length - 1][4] !== 1) p.push('A again with B held: ' + JSON.stringify(f.slice(-2)) + ' just=' + f.filter(x => x[3] === 1).length);
    const st = await page.evaluate(() => _ctlState());
    if (!(st.a && st.b && !st.c && st.y < -0.4)) p.push('_ctlState ' + JSON.stringify(st));
    await T('touchEnd', []);
    await page.waitForTimeout(150);
    l = await last();
    if (!l || l[0] !== 0 || l[1] !== 0 || l[2] !== 0 || l[4] !== 0) p.push('all released: ' + JSON.stringify(l));
    // a touch elsewhere on the page is not taken by the overlay (it may scroll), a tap on the canvas is recorded
    const cv = await page.evaluate(() => { const b = document.querySelector('#tab-output canvas').getBoundingClientRect(); return { x: b.left + 30, y: b.top + 10, w: b.width }; });
    await T('touchStart', [[cv.x, cv.y, 7]]);
    await page.waitForTimeout(60);
    const tap = await page.evaluate(() => _ctlState());
    await T('touchEnd', []);
    if (!tap.tapping || Math.abs(tap.tapX - 30 * 300 / cv.w) > 1.5 || Math.abs(tap.tapY - 10 * 300 / cv.w) > 1.5) p.push('tap on canvas: ' + JSON.stringify(tap));
    const ta = await page.evaluate(() => [...document.querySelectorAll('.emit-controls *')].filter(e => getComputedStyle(e).pointerEvents !== 'none').map(e => getComputedStyle(e).touchAction));
    if (ta.length !== 3 || ta.some(t => t !== 'none')) p.push('only stick and buttons take touches: ' + JSON.stringify(ta));
    return p;
  } },
  { name: 'controls-keyboard-mapping', src: CTL_PROG, expect: [], wait: 300, after: async page => {
    const p = [];
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.F = []; });
    await page.keyboard.down('ArrowLeft'); await page.keyboard.down('KeyW');
    await page.waitForTimeout(120);
    let l = await page.evaluate(() => window.F[window.F.length - 1]);
    if (!l || Math.abs(l[0] + Math.SQRT1_2) > 0.01 || Math.abs(l[1] + Math.SQRT1_2) > 0.01) p.push('left + up: ' + JSON.stringify(l));
    await page.keyboard.up('ArrowLeft'); await page.keyboard.up('KeyW');
    await page.evaluate(() => { window.F = []; });
    await page.keyboard.down('KeyZ'); await page.waitForTimeout(150);
    let f = await page.evaluate(() => window.F);
    if (f[f.length - 1][2] !== 1 || f.filter(x => x[3] === 1).length !== 1) p.push('Z = A held, justPressed once: ' + JSON.stringify(f.slice(-1)) + ' just ' + f.filter(x => x[3] === 1).length);
    await page.keyboard.up('KeyZ'); await page.keyboard.down('KeyX'); await page.waitForTimeout(80);
    l = await page.evaluate(() => window.F[window.F.length - 1]);
    if (l[2] !== 0 || l[4] !== 1) p.push('X = B: ' + JSON.stringify(l));
    await page.keyboard.up('KeyX');
    // typing in the editor does not move the stick
    await page.focus('#editor'); await page.keyboard.down('ArrowRight'); await page.waitForTimeout(80);
    l = await page.evaluate(() => window.F[window.F.length - 1]);
    await page.keyboard.up('ArrowRight');
    if (l[0] !== 0) p.push('arrow keys in the editor moved the stick');
    return p;
  } },
  { name: 'controls-keys-off', src: CTL_PROG.replace('opacity 0.5', 'opacity 0.5, keys off'), expect: [], wait: 300, after: async page => {
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.F = []; });
    await page.keyboard.down('ArrowRight'); await page.keyboard.down('KeyZ'); await page.waitForTimeout(120);
    const l = await page.evaluate(() => window.F[window.F.length - 1]);
    await page.keyboard.up('ArrowRight'); await page.keyboard.up('KeyZ');
    return l && l[0] === 0 && l[2] === 0 ? [] : ['keys off, but: ' + JSON.stringify(l)];
  } },
  { name: 'controls-dpad-and-labels', touch: true, src: CTL_PROG.replace('stick left, buttons A "jump" B', 'dpad right, buttons left A "jump" B'), expect: [], wait: 300, after: async page => {
    const p = [];
    const r = await page.evaluate(() => { const d = document.querySelector('[data-ctl="dpad"]').getBoundingClientRect(), a = document.querySelector('[data-ctl="A"]'), o = document.getElementById('tab-output').getBoundingClientRect(); return { x: d.left + d.width / 2, y: d.top + d.height / 2, r: d.width / 2, right: d.left > o.left + o.width / 2, aLeft: a.getBoundingClientRect().left < o.left + o.width / 2, label: a.textContent }; });
    if (!r.right || !r.aLeft || r.label !== 'jump') p.push('placement / label: ' + JSON.stringify(r));
    const cdp = await page.context().newCDPSession(page);
    await page.evaluate(() => { window.F = []; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + r.r * 0.5, y: r.y - r.r * 0.45, id: 1 }] });
    await page.waitForTimeout(120);
    const l = await page.evaluate(() => window.F[window.F.length - 1]);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    if (!l || l[0] !== 1 || l[1] !== -1) p.push('d-pad up-right should be exactly 1, -1: ' + JSON.stringify(l));
    return p;
  } },
  { name: 'controls-without-animate-justpressed-once-per-read', src: `
controls pad: buttons A
export fn main() { useControls(pad) }
export fn check() {
  let n = 0
  if (justPressed("A")) { n = 1 }
  if (justPressed("A")) { n += 2 }
  print(n)
}`, expect: [], wait: 100, after: async page => {
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); document.getElementById('tab-output').innerHTML = ''; });
    await page.keyboard.press('Space');
    await page.evaluate(() => { _emitCallExport(window._wi, 'check', []); _emitCallExport(window._wi, 'check', []); });
    const out = await page.evaluate(() => document.getElementById('tab-output').innerText.split('\n').filter(l => /^> /.test(l)));
    return JSON.stringify(out) === '["> 1","> 0"]' ? [] : ['justPressed outside frame(): ' + JSON.stringify(out)];
  } },
  // ── exported pages ──
  { name: 'export-html-js-offline', touch: true, page: async (page, ctx) => {
    const p = [];
    const src = M4 + SPR_GRASS_MAGENTA + `
controls pad: stick left, buttons A
export fn main() {
  canvas(64, 32)
  drawMap(m)
  setTile(m, 3, 1, "#")
  printStr(tileAt(m, 3, 1))
  print(objCount(m, "coin"))
  useControls(pad)
  animate()
}
export fn frame() {
  drawMap(m)
  if (pressed("A")) { setTile(m, 0, 1, "g") }
}`;
    await page.evaluate(src => { const ed = document.getElementById('editor'); ed.value = src; ed.dispatchEvent(new Event('input')); }, src.trim() + '\n');
    const files = await page.evaluate(async () => {
      const got = {}; window._download = (name, content) => { got[name] = typeof content === 'string' ? content : '[binary]'; };
      doExport('html'); doExport('js'); await doExport('htmloff'); await doExport('jsoff');
      return got;
    });
    const want = ['program.html', 'program.js', 'program-offline.html', 'program-offline.js'];
    want.forEach(n => { if (!files[n]) p.push('no ' + n + ' (got ' + Object.keys(files).join(', ') + ')'); });
    if (p.length) return p;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emit-maps-'));
    const check = async (pg, tag) => {
      await pg.waitForFunction(() => document.querySelector('#tab-output canvas') && document.querySelector('[data-ctl="A"]'), null, { timeout: 5000 }).catch(() => p.push(tag + ': no canvas / controls'));
      await pg.waitForTimeout(200);
      const lines = await pg.evaluate(() => document.getElementById('tab-output').innerText.split('\n').map(s => s.trim()).filter(Boolean));
      if (lines.slice(0, 2).join('|') !== '#|2') p.push(tag + ': output ' + JSON.stringify(lines));
      const c = await pg.evaluate(() => { const g = document.querySelector('#tab-output canvas').getContext('2d'); return [8, 40].map(x => Array.from(g.getImageData(x, 8, 1, 1).data).slice(0, 3).join(',')).concat(Array.from(g.getImageData(56, 24, 1, 1).data).slice(0, 3).join(',')); });
      if (c.join(' ') !== '255,0,0 255,0,255 255,0,0') p.push(tag + ': pixels ' + c.join(' '));
      const info = await pg.evaluate(() => typeof _mapInfo === 'function' ? _mapInfo('m').w : 'no _mapInfo');
      if (info !== 4 && !/\.js/.test(tag)) p.push(tag + ': _mapInfo ' + info);
      const a = await pg.evaluate(() => { const b = document.querySelector('[data-ctl="A"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
      const cdp = await pg.context().newCDPSession(pg);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
      await pg.waitForTimeout(150);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const g = await pg.evaluate(() => Array.from(document.querySelector('#tab-output canvas').getContext('2d').getImageData(8, 24, 1, 1).data).slice(0, 3).join(','));
      if (g !== '255,0,255') p.push(tag + ': button A in the exported page did not reach pressed(): ' + g);
    };
    const ctxT = await ctx.browser.newContext({ hasTouch: true, viewport: { width: 800, height: 700 } });
    for (const n of ['program.html', 'program-offline.html']) {
      fs.writeFileSync(path.join(dir, n), files[n]);
      const pg = await ctxT.newPage();
      const reqs = [];
      pg.on('pageerror', e => p.push(n + ' pageerror: ' + e.message.slice(0, 200)));
      await pg.route(/^https?:/, r => { reqs.push(r.request().url()); r.abort(); });
      await pg.goto('file://' + path.join(dir, n));
      await check(pg, n);
      if (/offline/.test(n) && reqs.length) p.push(n + ' made requests: ' + reqs.join(', '));
      await pg.close();
    }
    for (const n of ['program.js', 'program-offline.js']) {
      const pg = await ctxT.newPage();
      pg.on('pageerror', e => p.push(n + ' pageerror: ' + e.message.slice(0, 200)));
      await pg.route(/^https?:/, r => {
        const u = r.request().url();
        if (u === 'http://export.test/index.html') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><body><div id="app"></div><script type="module">import init from "./' + n + '"; window.app = await init({ target: document.getElementById("app") });</script></body>' });
        if (u === 'http://export.test/' + n) return r.fulfill({ contentType: 'text/javascript', body: files[n] });
        return r.abort();
      });
      await pg.goto('http://export.test/index.html');
      await check(pg, n);
      await pg.close();
    }
    await ctxT.close();
    return p;
  } },
  // ── programs without maps or controls compile to the same bytes as before they existed ──
  { name: 'byte-identical-without-blocks', page: async (page, ctx) => {
    let old;
    try { old = execFileSync('git', ['show', BASE_COMMIT + ':emit-ide-1_32.html'], { cwd: path.join(__dirname, '..'), maxBuffer: 64 << 20 }).toString(); }
    catch (e) { return ['cannot read ' + BASE_COMMIT + ' with git: ' + e.message.slice(0, 120)]; }
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'emit-maps-')), 'old.html');
    fs.writeFileSync(tmp, old);
    const interop = fs.readFileSync(path.join(__dirname, 'run-interop.js'), 'utf8');
    const a = interop.indexOf('const TESTS = ['), b = interop.indexOf('\nasync function runTest');
    const progs = eval(interop.slice(interop.indexOf('const FAKE_LIB'), a) + interop.slice(a, b) + '\nTESTS.map(t => t.src.trim() + "\\n")');
    const sums = async pg => pg.evaluate(progs => {
      const keys = Object.keys(EX).map(k => 'ex:' + k).concat(progs.map((_, i) => 'interop:' + i));
      const srcs = Object.keys(EX).map(k => EX[k]).concat(progs), out = {};
      for (let n = 0; n < srcs.length; n++) { const s = srcs[n], key = keys[n];
        try { const r = compile(s, 'wasm32'), props = {}; Object.keys(r.imports).forEach(k => { if (!/^\d+$/.test(k)) props[k] = r.imports[k]; }); out[key] = Array.from(r.wasm).join(',') + '|' + JSON.stringify(props) + '|' + JSON.stringify(r.imports.map(i => [i.module, i.name])); }
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
    // Programs that use `await` get the await shadow stack (see _emitAwaitRoots): not compared (tests/run-memory.js covers them).
    const srcOf = k => (k.indexOf('interop:') === 0 ? progs[Number(k.slice(8))] : EXsrc[k]) || '';
    const awaits = common.filter(k => now[k] !== before[k] && /\bawait\b/.test(srcOf(k)));
    common.forEach(k => { if (now[k] !== before[k] && awaits.indexOf(k) < 0) p.push(k + ' differs'); });
    const added = Object.keys(now).filter(k => !(k in before));
    ctx.note = (common.length - awaits.length) + ' programs (examples + interop) byte-identical to ' + BASE_COMMIT + (awaits.length ? '; ' + awaits.length + ' with await not compared (shadow stack)' : '') + (added.length ? '; not in ' + BASE_COMMIT + ': ' + added.join(', ') : '');
    return p;
  } },
];

async function newPage(browser, fileUrl, problems, t) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, hasTouch: !!t.touch });
  if (t.init) await context.addInitScript(t.init);
  const page = await context.newPage();
  page.on('pageerror', e => problems.push('pageerror: ' + e.message.slice(0, 300)));
  await page.route(/^https?:/, route => route.abort());
  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof compileAndRun === 'function');
  await page.evaluate(() => { try { closeWelcome(); } catch (e) {} window.F = []; window.rec = function () { window.F.push(Array.prototype.slice.call(arguments).map(Number)); }; });
  return page;
}

function matchLines(lines, expect, problems) {
  let at = 0;
  for (const want of expect) {
    const hit = lines.findIndex((l, i) => i >= at && (want instanceof RegExp ? want.test(l) : l === want));
    if (hit < 0) { problems.push('missing (or out of order): ' + want); return -1; }
    at = hit + 1;
  }
  return at;
}

async function runTest(browser, fileUrl, t) {
  const problems = [], ctx = { browser };
  const page = await newPage(browser, fileUrl, problems, t);
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
      await page.evaluate(() => compileAndRun()).catch(e => problems.push('run rejected: ' + e.message.slice(0, 300)));
      await page.waitForTimeout(t.wait || 200);
      if (t.after) problems.push(...((await t.after(page).catch(e => ['after() failed: ' + e.message.slice(0, 300)])) || []));
      const status = await page.evaluate(() => document.getElementById('sTxt').innerText);
      output = await page.evaluate(() => document.getElementById('tab-output').innerText);
      const lines = output.split('\n').map(l => l.trim());
      if (status !== 'Done') problems.push('status: ' + status + ' — ' + (lines.find(l => /✗/.test(l)) || ''));
      matchLines(lines, t.expect, problems);
      const errLines = lines.filter(l => /^✗/.test(l));
      if (!t.errors && errLines.length) problems.push('unexpected error line: ' + errLines[0]);
      if (t.errors) for (const l of errLines) if (!t.expect.some(w => (w instanceof RegExp ? w.test(l) : l === w))) problems.push('unexpected error line: ' + l);
    }
  } catch (e) { problems.push('test failed: ' + e.message.slice(0, 300)); }
  await page.context().close();
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
  console.log('\n' + (tests.length - failed) + '/' + tests.length + ' map / controls tests passed');
  process.exit(failed || !tests.length ? 1 : 0);
})();

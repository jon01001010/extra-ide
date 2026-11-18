#!/usr/bin/env node
// Sprites: sprite blocks (row and compact rle forms, palettes, frames, edge sizes), compile errors with exact
// positions, the builtins draw / drawEx / anim / spriteW / spriteH / blit checked pixel by pixel with
// getImageData (flip, scale, transparency, frames by name and number), the runtime helpers _spriteInfo /
// _spriteDraw / _spriteRegister, multi-file projects (sprites.emit used from main.emit), the exported .html / .js
// / offline pages, the editor support (highlighting, autocomplete, example, help) and byte identity of
// programs without sprites. Runs in headless Chromium, offline.
//
//   node tests/run-sprites.js [path/to/emit-ide.html] [testName ...]
//   VERBOSE=1 prints each program's Output tab.
//
// Kinds of tests (as in run-regions.js):
//   run   {src, expect, errors?, after?, wait?}  src goes through the editor and Run; expected lines appear in
//         order; after(page) → problems[] runs after Run (pixel checks, direct calls).
//   diag  {src, diag: [string | RegExp]}  compile(src) must throw / return exactly these errors.
//   page  {page: async (page, ctx) => problems[]}  free-form checks on a loaded IDE page.
// Exit code 0 only when every test passes.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const MARK = '//// file: ';
const join = files => files.map((f, i) => (i === 0 && f[0] === 'main.emit' ? '' : MARK + f[0] + '\n') + f[1].replace(/^\n/, '')).join('\n');
const BASE_COMMIT = '8d7f2b4'; // last commit without sprites

// RGBA of canvas #ci in the output at the given points: "r,g,b,a"
const pixels = (page, ci, pts) => page.evaluate(({ ci, pts }) => {
  const c = document.querySelectorAll('#tab-output canvas')[ci];
  if (!c) return null;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  return pts.map(([x, y]) => Array.from(d.slice((y * c.width + x) * 4, (y * c.width + x) * 4 + 4)).join(','));
}, { ci, pts });
const RED = '255,0,0,255', GREEN = '0,255,0,255', BLUE = '0,0,255,255', NONE = '0,0,0,0';
function same(got, want, what) { return JSON.stringify(got) === JSON.stringify(want) ? [] : [what + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)]; }

// A 4×2 sprite with two frames: a = "1..2 / 2112", b = ".... / 3333"
const AB = `sprite ab: 4x2, fps 4
  palette ff0000 00ff00 0000ff
  frame a
    "1..2"
    "2112"
  frame b
    "...."
    "3333"
`;

const TESTS = [
  // ── draw: pixels, transparency, frames by name and by number ──
  { name: 'draw-pixels-transparency-frames', src: AB + `
export fn run() {
  canvas(16, 16)
  color(10, 20, 30)
  rect(0, 0, 16, 16)
  draw(ab, 1, 1)
  draw(ab, 8, 1, "b")
  draw(ab, 1, 5, 1)
  let k = 6
  let m = -1
  draw(ab, 8, 5, k)
  draw(ab, 1, 9, m)
}`, expect: [], after: async page => {
    const got = await pixels(page, 0, [[1, 1], [2, 1], [4, 1], [1, 2], [2, 2], [8, 1], [8, 2], [11, 2], [1, 6], [8, 5], [9, 6], [1, 9], [1, 10]]);
    return same(got, [RED, '10,20,30,255', GREEN, GREEN, RED, '10,20,30,255', BLUE, BLUE, BLUE, RED, RED, '10,20,30,255', '10,20,30,255'], 'pixels (6 wraps to frame 0, -1 draws nothing)');
  } },
  // ── drawEx: flipX and scale, crisp ──
  { name: 'drawEx-flip-and-scale-crisp', src: AB + `
export fn run() {
  canvas(20, 20)
  drawEx(ab, 0, 0, "a", true, 1.0)
  drawEx(ab, 0, 4, 0, false, 3.0)
  drawEx(ab, 10.4, 0.6, "a", false, 1.0)
}`, expect: [], after: async page => {
    // flipped row 0 "1..2" → "2..1"; scale 3: pixel (0,0) covers 0..2, crisp edges; 10.4/0.6 round to 10/1
    const got = await pixels(page, 0, [[0, 0], [3, 0], [1, 0], [0, 4], [2, 6], [3, 4], [5, 4], [9, 4], [11, 7], [10, 1], [13, 1], [10, 0]]);
    return same(got, [GREEN, RED, NONE, RED, RED, NONE, NONE, GREEN, GREEN, RED, GREEN, NONE], 'pixels');
  } },
  // ── anim, spriteW / spriteH, sprites as values, a frame name held in a variable ──
  { name: 'anim-size-values-dynamic-frame', src: AB + `
sprite one: 3x5
  "123"
  "..."
  "..."
  "..."
  "321"
export fn run() {
  print(anim(ab, 0.0))
  print(anim(ab, 0.3))
  print(anim(ab, 0.5))
  print(anim(ab, 0.76))
  print(anim(ab, -0.1))
  print(anim(one, 12.0))
  print(spriteW(ab) * 10 + spriteH(ab))
  print(spriteW(one) * 10 + spriteH(one))
  let s = one
  print(s)
  print(spriteW(s) * 10 + spriteH(s))
  let w = spriteW(ab) * 1.5
  printNum(w)
  canvas(8, 8)
  let f = "b"
  draw(ab, 0, 0, f)
  draw(s, 4, 0)
  let g = "nope"
  draw(ab, 0, 4, g)
  draw(ab, 0, 4, g)
}`, expect: ['> 0', '> 1', '> 0', '> 1', '> 1', '> 0', '> 42', '> 35', '> 1', '> 35', '> 6', '✗ sprite: sprite ab has no frame "nope"'], errors: true, count: { '✗ sprite: sprite ab has no frame "nope"': 1 }, after: async page => {
    const got = await pixels(page, 0, [[0, 0], [0, 1], [4, 0], [6, 4], [0, 4]]);
    return same(got, [NONE, BLUE, '26,28,44,255', '26,28,44,255', NONE], 'pixels (default palette for "one")');
  } },
  // ── blit: bytes in the region, transparency skipped, clipping, a region parameter ──
  { name: 'blit-into-region', src: AB + `
region fb: u8[6 * 4 * 4]
fn put(r: region u8, x: int) {
  blit(ab, "b", r, x, 2, 6)
}
export fn run() {
  fill(fb, 7)
  blit(ab, 0, fb, 1, 0, 6)
  print(fb[(0 * 6 + 1) * 4])
  print(fb[(0 * 6 + 2) * 4])
  print(fb[(0 * 6 + 2) * 4 + 3])
  print(fb[(0 * 6 + 4) * 4 + 1])
  print(fb[(1 * 6 + 3) * 4 + 0])
  blit(ab, 1, fb, 4, -1, 6)
  print(fb[(0 * 6 + 5) * 4 + 2])
  print(fb[(0 * 6 + 4) * 4 + 1])
  put(fb, -2)
  print(fb[(3 * 6 + 0) * 4 + 2])
  print(fb[(3 * 6 + 2) * 4 + 2])
  blit(ab, 0, fb, 100, 100, 6)
  print(fb[0])
}`, expect: ['> 255', '> 7', '> 7', '> 255', '> 255', '> 255', '> 0', '> 255', '> 7', '> 7'] },
  { name: 'blit-screen-and-frozen-region', src: AB + `
region fb: u8[8 * 4 * 4]
export fn run() {
  screen(fb, 8, 4)
  blit(ab, 0, fb, 2, 1, 8)
  freeze(fb)
  try {
    blit(ab, 0, fb, 0, 0, 8)
  } catch (e) {
    printStr("caught: " + e.message)
  }
}`, expect: ['> caught: write to frozen region fb at main.emit:16:5'], after: async page => {
    await page.waitForTimeout(100);
    const got = await pixels(page, 0, [[2, 1], [3, 1], [5, 1], [2, 2], [0, 0]]);
    return same(got, [RED, NONE, GREEN, GREEN, NONE], 'screen pixels');
  } },
  // ── the compact form: the same pixels as rows; *N; bare rle; 1×1 and 256×256 ──
  { name: 'rle-equals-rows-and-edge-sizes', page: async page => page.evaluate(() => {
    const p = [];
    const a = compile('sprite s: 6x3\n  palette ff0000 00ff00\n  frame f\n    "..11.2"\n    "222222"\n    "222222"\nexport fn run() {}');
    const b = compile('sprite s: 6x3\n  palette ff0000 00ff00\n  frame f rle ".2 12 . 2/26 *2"\nexport fn run() {}');
    const c = compile('sprite s: 6x3\n  palette ff0000 00ff00\n  frame f rle\n    ".2 12 . 2"\n    "26/26"\nexport fn run() {}');
    const d = compile('sprite s: 6x3\n  palette ff0000 00ff00\n  rle ".2 12 . 2/26 *2"\nexport fn run() {}');
    const data = r => JSON.parse(r.imports.spriteData).sprites[0].frames[0].data;
    if (data(a) !== '..11.2222222222222') p.push('rows: ' + data(a));
    if (data(b) !== data(a)) p.push('rle one line: ' + data(b));
    if (data(c) !== data(a)) p.push('rle on several lines: ' + data(c));
    if (data(d) !== data(a)) p.push('bare rle: ' + data(d));
    const one = compile('sprite dot: 1x1\n  "1"\nexport fn run() {}');
    if (JSON.parse(one.imports.spriteData).sprites[0].frames[0].data !== '1') p.push('1x1');
    const big = compile('sprite big: 256x256\n  palette 123456\n  rle ".255 1 *255/1256"\nexport fn run() {}');
    const bd = JSON.parse(big.imports.spriteData).sprites[0].frames[0].data;
    if (bd.length !== 65536 || bd[255] !== '1' || bd[256 * 255] !== '1' || bd[0] !== '.' || bd.split('1').length - 1 !== 255 + 256) p.push('256x256: ' + bd.length);
    // encoder / parser round trip
    const rows = ['....1111........', '................', '................', 'aaaaabbbbbbbb9..'];
    const enc = _sprRleEncode(rows);
    if (enc !== '.4 14 .8/.16 *2/a5 b8 9 .2') p.push('encode: ' + enc);
    const back = _sprParse(['sprite x: 16x4', '  palette ' + new Array(12).fill('ffffff').join(' '), '  rle "' + enc + '"'], 1, false);
    if (back.errors.length || back.frames[0].data !== rows.join('')) p.push('decode: ' + JSON.stringify(back.errors) + back.frames[0].data);
    return p;
  }) },
  { name: 'palette-forms-comments-default-palette', page: async page => page.evaluate(() => {
    const p = [];
    const r = compile('// a comment\nsprite s: 3x1, fps 12  // header comment\n  palette #FF0000 00ff00\n  palette 0000Ff\n  // a row follows\n  "123"   // trailing\n\nsprite t: 2x1\n  "1g"\nexport fn run() {}');
    const sp = JSON.parse(r.imports.spriteData).sprites;
    if (sp[0].palette.join() !== 'ff0000,00ff00,0000ff' || sp[0].fps !== 12 || sp[0].frames[0].data !== '123') p.push('s: ' + JSON.stringify(sp[0]));
    if (sp[1].palette.length !== 16 || sp[1].palette[0] !== '1a1c2c' || sp[1].fps !== 8 || sp[1].frames[0].data !== '1g') p.push('t (default palette): ' + JSON.stringify(sp[1]));
    if (JSON.stringify(r.sprites) !== JSON.stringify([{ name: 's', w: 3, h: 1, fps: 12, frames: [''], path: null, line: 2 }, { name: 't', w: 2, h: 1, fps: 8, frames: [''], path: null, line: 8 }])) p.push('r.sprites: ' + JSON.stringify(r.sprites));
    // not a sprite block: inside a block comment, inside a string, indented
    const n = compile('/*\nsprite s: 3x1\n  "123"\n*/\nexport fn run() {\n  let t = "a\nsprite q: 1x1\n"\n  printStr(t)\n}');
    if (n.errors.length || n.sprites.length || n.imports.spriteData) p.push('comment / string: ' + JSON.stringify(n.sprites) + n.errors);
    return p;
  }) },
  // ── compile errors: exact messages and positions ──
  { name: 'diag-bad-pixel', diag: ['3:6: Unknown pixel "Z" — use . (transparent), 1-9 or a-z (palette colours 1-35): palette letters are lower case'], src: 'sprite s: 4x2\n  "1..2"\n  "21Z2"\nexport fn run() {}' },
  { name: 'diag-bad-pixel-symbol', diag: ['2:6: Unknown pixel "#" — use . (transparent), 1-9 or a-z (palette colours 1-35)'], src: 'sprite s: 4x1\n  "1.#2"\nexport fn run() {}' },
  { name: 'diag-row-too-short', diag: ['3:3: Row 2 of sprite s has 3 pixels, but it is 4 wide'], src: 'sprite s: 4x2\n  "1..2"\n  "211"\nexport fn run() {}' },
  { name: 'diag-row-too-long-in-frame', diag: ['4:5: Row 1 of frame idle has 5 pixels, but sprite s is 4 wide'], src: 'sprite s: 4x1\n  palette ff0000\n  frame idle\n    "1...."\nexport fn run() {}' },
  { name: 'diag-too-few-rows', diag: ['2:3: Frame b has 1 row, but sprite s is 2 high'], src: 'sprite s: 4x2\n  frame b\n    "1..2"\nexport fn run() {}' },
  { name: 'diag-too-many-rows', diag: ['4:3: Sprite s has 3 rows, but it is 2 high'], src: 'sprite s: 4x2\n  "1..2"\n  "1..2"\n  "1..2"\nexport fn run() {}' },
  { name: 'diag-frame-without-rows', diag: ['2:3: Frame a has no rows — sprite s is 1x1: add 1 rows in quotes below it'], src: 'sprite s: 1x1\n  frame a\n  frame b\n    "1"\nexport fn run() {}' },
  { name: 'diag-colour-not-in-palette', diag: ['3:7: Pixel "2" is palette colour 2, but the palette of sprite s has 1 colour'], src: 'sprite s: 4x2\n  palette ff0000\n  "1..2"\n  "1111"\nexport fn run() {}' },
  { name: 'diag-bad-palette-entry', diag: ['2:18: Expected a palette colour as 6 hex digits (rrggbb, # optional), got "12345"'], src: 'sprite s: 1x1\n  palette ff0000 12345\n  "1"\nexport fn run() {}' },
  { name: 'diag-palette-too-long', diag: ['3:60: A palette has at most 35 colours (1-9 and a-z)'], src: 'sprite s: 1x1\n' + '  palette ' + new Array(28).fill('000000').join(' ') + '\n  palette ' + new Array(8).fill('111111').join(' ') + '\n  "1"\nexport fn run() {}' },
  { name: 'diag-size-missing', diag: ['1:10: Expected the size after sprite s: — width x height, e.g. sprite s: 16x16'], src: 'sprite s:\n  "1"\nexport fn run() {}' },
  { name: 'diag-size-too-wide', diag: ['1:11: A sprite is 1 to 256 pixels wide, not 300'], src: 'sprite s: 300x2\n  "1"\nexport fn run() {}' },
  { name: 'diag-size-zero-high', diag: ['1:15: A sprite is 1 to 256 pixels high, not 0'], src: 'sprite s: 2 x 0\n  "11"\nexport fn run() {}' },
  { name: 'diag-bad-fps', diag: ['1:16: fps is the number of frames per second, more than 0 and at most 240 — e.g. fps 8'], src: 'sprite s: 1x1, fps 0\n  "1"\nexport fn run() {}' },
  { name: 'diag-unknown-option', diag: ['1:16: Unknown sprite option "speed 3" — after the size only fps N can follow (sprite s: 16x16, fps 8)'], src: 'sprite s: 1x1, speed 3\n  "1"\nexport fn run() {}' },
  { name: 'diag-unknown-line', diag: ['3:3: Unknown line in sprite s — expected palette, frame or a row of pixels in quotes ("..12..")'], src: 'sprite s: 1x1\n  "1"\n  hitbox 0 0 1 1\nexport fn run() {}' },
  { name: 'diag-no-pixels', diag: ['1:1: Sprite s has no pixels — add rows of pixels in quotes ("..12..") or frame lines'], src: 'sprite s: 1x1\nexport fn run() {}' },
  { name: 'diag-rows-before-frames', diag: ['3:1: Sprite s has rows before its first frame line — put them under a frame line (frame idle), or remove the frame lines'], src: 'sprite s: 1x1\n  "1"\n  frame a\n    "1"\nexport fn run() {}' },
  { name: 'diag-duplicate-frame', diag: ['4:9: Frame "a" is already declared in sprite s'], src: 'sprite s: 1x1\n  frame a\n    "1"\n  frame a\n    "1"\nexport fn run() {}' },
  { name: 'diag-frame-without-name', diag: ['2:8: Expected a frame name after frame — frame idle'], src: 'sprite s: 1x1\n  frame\n    "1"\nexport fn run() {}' },
  { name: 'diag-rle-bad-run', diag: ['2:11: Expected a run: a pixel and how many, e.g. .12 or a3 — got "1x"'], src: 'sprite s: 3x1\n  rle ".2 1x"\nexport fn run() {}' },
  { name: 'diag-rle-wrong-width', diag: ['2:11: Row 2 of sprite s has 2 pixels, but it is 3 wide'], src: 'sprite s: 3x2\n  rle ".3/.2"\nexport fn run() {}' },
  { name: 'diag-rle-repeat-not-last', diag: ['2:14: *N repeats the row and must come last in it'], src: 'sprite s: 3x2\n  rle ".3 *2 1"\nexport fn run() {}' },
  { name: 'diag-unknown-sprite', diag: ['3:24: Unknown sprite "heor" — did you mean "hero"?'], src: 'sprite hero: 1x1\n  "1"\nexport fn run() { draw(heor, 1, 2) }' },
  { name: 'diag-unknown-sprite-string', diag: ['3:24: Unknown sprite "nope"'], src: 'sprite hero: 1x1\n  "1"\nexport fn run() { draw("nope", 1, 2) }' },
  { name: 'diag-unknown-frame', diag: ['9:34: Sprite ab has no frame "c" — did you mean "a"?'], src: AB + 'export fn run() { draw(ab, 1, 2, "c") }' },
  { name: 'diag-frame-number-out-of-range', diag: ['9:34: Sprite ab has 2 frames (0 … 1), not frame 2'], src: AB + 'export fn run() { draw(ab, 1, 2, 2) }' },
  { name: 'diag-blit-unknown-frame', diag: ['9:28: Sprite ab has no frame "jump" — its frames: "a", "b"'], src: AB + 'export fn run() { blit(ab, "jump", fb, 0, 0, 4) }\nregion fb: u8[64]' },
  { name: 'diag-blit-not-u8', diag: ['10:31: blit needs a u8 region (4 bytes per pixel, as screen shows it), but fb holds int'], src: AB + 'region fb: int[16]\nexport fn run() { blit(ab, 0, fb, 0, 0, 4) }' },
  { name: 'diag-blit-no-region', diag: ['9:31: blit copies into a u8 region: its third argument is the region\'s name (region fb: u8[160 * 120 * 4])'], src: AB + 'export fn run() { blit(ab, 0, 3, 0, 0, 4) }' },
  { name: 'diag-draw-arity', diag: ['9:19: draw takes a sprite, x and y, and optionally a frame: draw(hero, 10, 20) or draw(hero, 10, 20, "walk1")'], src: AB + 'export fn run() { draw(ab, 1) }' },
  { name: 'diag-draw-bad-x', diag: ['9:28: draw: x must be a number, but this is str'], src: AB + 'export fn run() { draw(ab, "1", 2) }' },
  { name: 'diag-flip-not-bool', diag: ['9:39: drawEx: flipX must be true or false, but this is int'], src: AB + 'export fn run() { drawEx(ab, 1, 2, 0, 1, 2.0) }' },
  { name: 'diag-sprite-named-like-fn', diag: ['2:8: The name "ab" is a sprite and also a function (at line 1) — sprite names are seen by every file, so rename one of them'], src: 'fn ab() {}\nsprite ab: 1x1\n  "1"\nexport fn run() {}' },
  { name: 'diag-duplicate-sprite', diag: ['3:8: Sprite "s" is already declared at line 1 — every sprite of the project needs its own name'], src: 'sprite s: 1x1\n  "1"\nsprite s: 1x1\n  "1"\nexport fn run() {}' },
  { name: 'diag-sprite-inside-function', diag: ['2:1: sprite declarations belong at the top level of a file, not inside a function — is a } missing above?'], src: 'export fn run() {\nsprite s: 1x1\n  "1"\n}' },
  { name: 'diag-sprite-member', diag: ['3:25: "s" is a sprite — it has no members. Use spriteW(s), spriteH(s), anim(s, t)'], src: 'sprite s: 1x1\n  "1"\nexport fn run() { print(s.w) }' },
  { name: 'diag-sprite-called', diag: ['3:19: "s" is a sprite, not a function — draw it: draw(s, x, y)'], src: 'sprite s: 1x1\n  "1"\nexport fn run() { s() }' },
  { name: 'diag-module-position', diag: ['sprites.emit:3:5: Unknown pixel "?" — use . (transparent), 1-9 or a-z (palette colours 1-35)'], src: join([['main.emit', 'export fn run() { }'], ['sprites.emit', 'sprite s: 2x2\n  "11"\n  "1?"']]) },
  { name: 'diag-module-unknown-frame', diag: ['main.emit:3:17: Sprite s has no frame "c" — did you mean "a"?'], src: join([['main.emit', 'export fn run() {\n  canvas(4, 4)\n  draw(s, 0, 0, "c")\n}'], ['sprites.emit', 'sprite s: 1x1\n  frame a\n    "1"']]) },
  { name: 'diag-module-duplicate', diag: ['b.emit:1:8: Sprite "s" is already declared at main.emit:1 — every sprite of the project needs its own name'], src: join([['main.emit', 'sprite s: 1x1\n  "1"\nexport fn run() { }'], ['b.emit', 'sprite s: 1x1\n  "1"']]) },
  // a local variable hides a sprite of the same name; a user's own draw() wins
  { name: 'shadowing-and-own-draw', src: 'sprite s: 1x1\n  "1"\nfn draw(a: int, b: int, c: int) { print(a + b + c) }\nexport fn run() {\n  let s = 40\n  print(s)\n  draw(1, 2, 3)\n  print(spriteW(s))\n}', expect: ['> 40', '> 6'], errors: true },
  // ── several files: sprites.emit used from main.emit and from a module ──
  { name: 'multi-file-project', src: join([
    ['main.emit', `
import game.hud
export fn run() {
  canvas(8, 4)
  draw(coin, 0, 0, "spin")
  hud.show()
  print(spriteW(coin))
}`],
    ['game/hud.emit', `
package game
public fn show() {
  draw(coin, 4, 0)
  print(anim(coin, 0.25))
}`],
    ['sprites.emit', `
// all the pictures
sprite coin: 2x2, fps 4
  palette ff0000 0000ff
  frame flat
    "11"
    "11"
  frame spin
    "2."
    ".2"
`]]), expect: ['> 1', '> 2'], after: async page => {
      const got = await pixels(page, 0, [[0, 0], [1, 0], [4, 0], [5, 1]]);
      const info = await page.evaluate(() => JSON.stringify(_spriteInfo('coin')));
      return same(got, [BLUE, NONE, RED, RED], 'pixels').concat(same(info, JSON.stringify({ w: 2, h: 2, frames: ['flat', 'spin'], fps: 4 }), '_spriteInfo'));
    } },
  // ── the runtime helpers for other code (things / tiles) ──
  { name: 'runtime-helpers', src: AB + 'export fn run() {\n  canvas(4, 4)\n}', expect: [], after: async page => page.evaluate(() => {
    const p = [], c = document.createElement('canvas'); c.width = 16; c.height = 16; const g = c.getContext('2d');
    const px = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data).join(',');
    if (JSON.stringify(_spriteInfo('ab')) !== JSON.stringify({ w: 4, h: 2, frames: ['a', 'b'], fps: 4 })) p.push('_spriteInfo(ab) ' + JSON.stringify(_spriteInfo('ab')));
    if (_spriteInfo('nope') !== null) p.push('_spriteInfo(nope) should be null');
    if (!_spriteDraw(g, 'ab', 'b', 0, 0)) p.push('_spriteDraw by frame name returned false');
    if (px(0, 1) !== '0,0,255,255' || px(0, 0) !== '0,0,0,0') p.push('frame b: ' + px(0, 1) + ' ' + px(0, 0));
    _spriteDraw(g, 'ab', 0, 0, 4, { flipX: true, flipY: true, scale: 2 });
    // frame a flipped both ways at 2x: row 1 "2112" reversed on top → (0,4) green, row 0 "1..2" reversed at the bottom → (0,6) green, (6,6) red
    if (px(0, 4) !== '0,255,0,255' || px(0, 6) !== '0,255,0,255' || px(6, 6) !== '255,0,0,255' || px(2, 6) !== '0,0,0,0') p.push('flipX+flipY+scale: ' + [px(0, 4), px(0, 6), px(6, 6), px(2, 6)]);
    _spriteDraw(g, 'ab', 'a', 8, 0, { alpha: 0.5 });
    const a = g.getImageData(8, 0, 1, 1).data[3];
    if (a < 120 || a > 135) p.push('alpha 0.5 → ' + a);
    if (_spriteDraw(g, 'ab', 'zzz', 0, 0) || _spriteDraw(g, 'ab', -1, 0, 0) || _spriteDraw(g, 'nope', 0, 0, 0)) p.push('unknown frame / negative / unknown sprite should draw nothing');
    if (!_spriteDraw(g, 'ab', 3, 12, 12) || px(12, 13) !== '0,0,255,255') p.push('index 3 wraps to frame 1');
    const id = _spriteRegister({ name: 'dot', w: 1, h: 1, palette: ['00ff00'], frames: [{ name: 'x', data: '1' }] });
    _spriteDraw(g, 'dot', 'x', 15, 15);
    if (px(15, 15) !== '0,255,0,255' || id !== 1) p.push('_spriteRegister: ' + px(15, 15) + ' id ' + id);
    if (g.imageSmoothingEnabled !== true) p.push('the caller\'s smoothing setting must be restored');
    return p;
  }) },
  // ── the example ──
  { name: 'example-sprites', page: async page => {
    const p = [];
    await page.selectOption('#example', 'sprites');
    await page.evaluate(() => compileAndRun());
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => {
      const cs = document.querySelectorAll('#tab-output canvas'), out = document.getElementById('tab-output').innerText;
      const painted = c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; };
      const a = cs[0] && cs[0].getBoundingClientRect(), b = cs[1] && cs[1].getBoundingClientRect();
      return { side: !!(a && b && Math.abs(a.top - b.top) < 4 && b.left >= a.right), n: cs.length, sizes: Array.from(cs).map(c => c.width + 'x' + c.height), painted: Array.from(cs).map(painted), err: /✗/.test(out), status: document.getElementById('sTxt').innerText, opt: Array.from(document.querySelectorAll('#example option')).map(o => o.value) };
    });
    if (r.status !== 'Done' || r.err) p.push('status ' + r.status + (r.err ? ' with an error line' : ''));
    if (r.sizes.join() !== '48x16,144x48' || !r.side) p.push('canvases: ' + r.sizes.join());
    if (!(r.painted[0] > 10 && r.painted[1] > 100)) p.push('painted pixels: ' + r.painted.join());
    if (r.opt[r.opt.length - 1] !== 'modules' || r.opt.indexOf('sprites') < 0) p.push('dropdown: ' + r.opt.join());
    // it walks: the blitted frame moves
    const a = await page.evaluate(() => document.querySelectorAll('#tab-output canvas')[0].toDataURL());
    await page.waitForTimeout(700);
    const b = await page.evaluate(() => document.querySelectorAll('#tab-output canvas')[0].toDataURL());
    if (a === b) p.push('the screen does not change while it runs');
    await page.evaluate(() => stopProgram());
    return p;
  } },
  // ── editor: highlighting, autocomplete, help ──
  { name: 'editor-highlight-autocomplete-help', page: async page => {
    const p = [];
    const src = AB + 'export fn run() {\n  draw(ab, 1, 2, "';
    await page.evaluate(src => { const ed = document.getElementById('editor'); ed.value = src; ed.dispatchEvent(new Event('input')); ed.focus(); ed.selectionStart = ed.selectionEnd = ed.value.length; }, src);
    const hl = await page.evaluate(() => Array.from(document.querySelectorAll('#hlInner .spr')).map(s => s.textContent).join() + '|' + Array.from(document.querySelectorAll('#hlInner .kw')).map(s => s.textContent).filter(t => t === 'sprite').length + '|' + Array.from(document.querySelectorAll('#hlInner .blt')).map(s => s.textContent).filter(t => t === 'draw').length);
    if (hl !== 'ab,ab|1|1') p.push('highlight (sprite names | sprite keyword | draw builtin): ' + hl);
    const px = await page.evaluate(() => Array.from(document.querySelectorAll('#hlInner .spx')).slice(0, 3).map(s => s.textContent + ':' + getComputedStyle(s).backgroundColor).join() + '|' + Array.from(document.querySelectorAll('#hlInner .spc')).map(s => s.textContent).join());
    if (px !== '1:rgb(255, 0, 0),2:rgb(0, 255, 0),2:rgb(0, 255, 0)|ff0000,00ff00,0000ff') p.push('pixels of the rows painted in their colours, palette entries marked: ' + px);
    await page.evaluate(() => checkAC());
    let ac = await page.evaluate(() => Array.from(document.querySelectorAll('.ac-item .ac-name')).map(e => e.textContent));
    if (ac.join() !== 'a,b') p.push('frame names after draw(ab, 1, 2, ": ' + ac.join());
    await page.evaluate(() => { const ed = document.getElementById('editor'); ed.value = ed.value.replace(/draw\(ab, 1, 2, "$/, 'drawEx(a'); ed.selectionStart = ed.selectionEnd = ed.value.length; ed.dispatchEvent(new Event('input')); checkAC(); });
    ac = await page.evaluate(() => Array.from(document.querySelectorAll('.ac-item .ac-name')).map(e => e.textContent));
    if (ac.indexOf('ab') < 0) p.push('sprite name after drawEx(a: ' + ac.join());
    await page.evaluate(() => { const ed = document.getElementById('editor'); ed.value = 'export fn run() {\n  spr'; ed.selectionStart = ed.selectionEnd = ed.value.length; ed.dispatchEvent(new Event('input')); checkAC(); });
    ac = await page.evaluate(() => Array.from(document.querySelectorAll('.ac-item .ac-name')).map(e => e.textContent));
    if (!ac.some(t => t.indexOf('spriteW') === 0) || !ac.some(t => t.indexOf('spriteH') === 0)) p.push('builtins spriteW / spriteH in autocomplete: ' + ac.join());
    await page.evaluate(() => { const ed = document.getElementById('editor'); ed.value = 'spr'; ed.selectionStart = ed.selectionEnd = 3; ed.dispatchEvent(new Event('input')); checkAC(); });
    ac = await page.evaluate(() => Array.from(document.querySelectorAll('.ac-item')).map(e => e.textContent));
    if (!ac.some(t => /sprite name: 16x16/.test(t))) p.push('sprite snippet at a line start: ' + ac.join(' | '));
    const help = await page.evaluate(() => { const h = Array.from(document.querySelectorAll('h2')).find(h => h.textContent === 'Sprites'); let t = ''; for (let n = h && h.nextElementSibling; n && n.tagName !== 'H2'; n = n.nextElementSibling) t += n.textContent + '\n'; return t; });
    ['rle', 'palette', 'drawEx(spr, x, y, frame, flipX: bool, scale: num)', 'anim(spr, t: num)', 'blit(spr, frame, fb, x, y, w)', 'spriteW', 'SPRITE tool', 'Import PNG', 'sprites.emit'].forEach(w => { if (help.indexOf(w) < 0) p.push('help lacks ' + w); });
    return p;
  } },
  // ── exported pages: .html, .js and the offline .html run the sprites the same way ──
  { name: 'exported-pages', page: async (page, ctx) => {
    const p = [];
    const src = join([['main.emit', 'region fb: u8[4 * 2 * 4]\nexport fn run() {\n  screen(fb, 4, 2)\n  blit(ab, "a", fb, 0, 0, 4)\n  canvas(8, 4)\n  drawEx(ab, 0, 0, "b", true, 1.0)\n  print(anim(ab, 0.3) + spriteW(ab))\n}'], ['sprites.emit', AB]]);
    await page.evaluate(src => _projLoad(src), src);
    const files = await page.evaluate(async () => {
      const got = {}; window._download = (name, content) => { got[name] = typeof content === 'string' ? content : null; };
      await doExport('html'); await doExport('js'); await doExport('htmloff');
      return got;
    });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'emit-spr-'));
    const look = async pg => {
      await pg.waitForTimeout(400);
      return pg.evaluate(() => {
        const cs = document.querySelectorAll('#tab-output canvas'), out = document.getElementById('tab-output').innerText;
        const px = (c, x, y) => Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data).join(',');
        return { lines: out.split('\n').map(s => s.trim()).filter(s => /^\d+$/.test(s) || /✗/.test(s)), scr: cs[0] && [px(cs[0], 0, 0), px(cs[0], 1, 0), px(cs[0], 3, 1)], cv: cs[1] && [px(cs[1], 0, 1), px(cs[1], 3, 0), px(cs[1], 0, 0)], info: typeof _spriteInfo === 'function' ? JSON.stringify(_spriteInfo('ab')) : String(window._spriteInfo && JSON.stringify(window._spriteInfo('ab'))) };
      });
    };
    const want = { lines: ['5'], scr: [RED, NONE, GREEN], cv: [BLUE, NONE, NONE], info: JSON.stringify({ w: 4, h: 2, frames: ['a', 'b'], fps: 4 }) };
    for (const name of ['program.html', 'program-offline.html']) {
      if (!files[name]) { p.push('no ' + name); continue; }
      const f = path.join(tmp, name); fs.writeFileSync(f, files[name]);
      const pg = await ctx.browser.newPage(); const req = [];
      await pg.route(/^https?:/, r => { req.push(r.request().url()); r.abort(); });
      pg.on('pageerror', e => p.push(name + ' pageerror: ' + e.message));
      await pg.goto('file://' + f);
      const got = await look(pg);
      p.push(...same(got, want, name));
      if (name === 'program-offline.html' && req.filter(u => !/fonts\.(googleapis|gstatic)/.test(u)).length) p.push('offline page made requests: ' + req.join(', '));
      await pg.close();
    }
    if (!files['program.js']) p.push('no program.js');
    else {
      const pg = await ctx.browser.newPage();
      pg.on('pageerror', e => p.push('program.js pageerror: ' + e.message));
      await pg.route(/^https?:/, r => {
        const u = r.request().url();
        if (u === 'http://export.test/') return r.fulfill({ contentType: 'text/html', body: '<!DOCTYPE html><html><body><div id="app"></div><script type="module">import init from "./program.js"; window.app = await init({ target: document.getElementById("app") }); window._spriteInfo = window._spriteInfo || null;</script></body></html>' });
        if (u === 'http://export.test/program.js') return r.fulfill({ contentType: 'text/javascript', body: files['program.js'] });
        return r.abort();
      });
      await pg.goto('http://export.test/');
      await pg.waitForFunction(() => window.app !== undefined, null, { timeout: 5000 }).catch(() => p.push('program.js: init() did not finish'));
      const got = await look(pg);
      p.push(...same(Object.assign({}, got, { info: want.info }), want, 'program.js'));
      await pg.close();
    }
    return p;
  } },
  // ── programs without sprites compile to the same bytes as before sprites existed ──
  { name: 'byte-identical-without-sprites', page: async (page, ctx) => {
    let old;
    try { old = execFileSync('git', ['show', BASE_COMMIT + ':emit-ide-1_32.html'], { cwd: path.join(__dirname, '..'), maxBuffer: 64 << 20 }).toString(); }
    catch (e) { return ['cannot read ' + BASE_COMMIT + ' with git: ' + e.message.slice(0, 120)]; }
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'emit-spr-')), 'old.html');
    fs.writeFileSync(tmp, old);
    const interop = fs.readFileSync(path.join(__dirname, 'run-interop.js'), 'utf8');
    const a = interop.indexOf('const TESTS = ['), b = interop.indexOf('\nasync function runTest');
    const progs = eval(interop.slice(interop.indexOf('const FAKE_LIB'), a) + interop.slice(a, b) + '\nTESTS.map(t => t.src.trim() + "\\n")');
    const sums = async pg => pg.evaluate(progs => {
      const keys = Object.keys(EX).map(k => 'ex:' + k).concat(progs.map((_, i) => 'interop:' + i));
      const srcs = Object.keys(EX).map(k => EX[k]).concat(progs), out = {};
      for (let n = 0; n < srcs.length; n++) { const s = srcs[n], key = keys[n];
        try { const r = compile(s, 'wasm32'), props = {}; Object.keys(r.imports).forEach(k => { if (!/^\d+$/.test(k)) props[k] = r.imports[k]; }); out[key] = Array.from(r.wasm).join(',') + '|' + JSON.stringify(props) + '|' + JSON.stringify(r.errors); }
        catch (e) { out[key] = 'THROW ' + e.message; }
      }
      return out;
    }, progs);
    const now = await sums(page);
    const op = await ctx.browser.newPage();
    await op.route(/^https?:/, r => r.abort());
    await op.goto('file://' + tmp);
    await op.waitForFunction(() => typeof compile === 'function' && typeof EX === 'object');
    const before = await sums(op);
    await op.close();
    const p = [];
    const common = Object.keys(before).filter(k => k in now);
    if (common.length < 100 || common.length !== Object.keys(before).length) p.push('programs compared ' + common.length + ' of ' + Object.keys(before).length + ' in ' + BASE_COMMIT);
    common.forEach(k => { if (now[k] !== before[k]) p.push(k + ' differs'); });
    const added = Object.keys(now).filter(k => !(k in before));
    ctx.note = common.length + ' programs (examples + interop) byte-identical to ' + BASE_COMMIT + (added.length ? '; not in ' + BASE_COMMIT + ': ' + added.join(', ') : '');
    return p;
  } },
];

async function newPage(browser, fileUrl, problems) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message.slice(0, 300)));
  await page.route(/^https?:/, route => route.abort());
  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof compileAndRun === 'function');
  await page.evaluate(() => { try { closeWelcome(); } catch (e) {} });
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
      await page.evaluate(src => _projLoad(src), t.src.trim() + '\n');
      await page.evaluate(() => compileAndRun()).catch(e => problems.push('run rejected: ' + e.message.slice(0, 300)));
      await page.waitForTimeout(t.wait || 200);
      if (t.after) problems.push(...((await t.after(page).catch(e => ['after() failed: ' + e.message.slice(0, 300)])) || []));
      const status = await page.evaluate(() => document.getElementById('sTxt').innerText);
      output = await page.evaluate(() => document.getElementById('tab-output').innerText);
      const lines = output.split('\n').map(l => l.trim());
      if (status !== (t.status || 'Done')) problems.push('status: ' + status + ' — ' + (lines.find(l => /✗/.test(l)) || ''));
      matchLines(lines, t.expect, problems);
      for (const [line, n] of Object.entries(t.count || {})) {
        const got = lines.filter(l => l === line).length;
        if (got !== n) problems.push('expected "' + line + '" ' + n + ' time(s), got ' + got);
      }
      const errLines = lines.filter(l => /^✗/.test(l));
      if (!t.errors && errLines.length) problems.push('unexpected error line: ' + errLines[0]);
      if (t.errors) for (const l of errLines) if (!t.expect.some(w => (w instanceof RegExp ? w.test(l) : l === w))) problems.push('unexpected error line: ' + l);
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
  console.log('\n' + (tests.length - failed) + '/' + tests.length + ' sprite tests passed');
  process.exit(failed || !tests.length ? 1 : 0);
})();

#!/usr/bin/env node
// Checks the HUD of an Emit IDE build in headless Chromium: `hud NAME:` blocks (parser errors and warnings with
// exact positions, names checked across files, case-insensitive), hud() / hudOn() / hudOff() / say(), what the
// runtime draws (the pixel font, anchors, below, icons, bars, live values of int / num / bool / str globals and
// rules auto-globals) on a canvas program, a program that does not animate, a screen(…) program and the Coin Dash
// example (things), the HUD tool of the drawer on a 360×740 phone (items, anchors, chips, preview, Save →
// block → reopen) and the exported .html / .js pages (runtime part only when a program uses a HUD).
// Offline: every network request is aborted.
//
//   node tests/run-hud.js [path/to/emit-ide.html]
//   SHOTS=dir  also saves phone screenshots there.
//
// Exit code 0 when every check passes.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let failed = 0, passed = 0;
function check(label, ok, detail) {
  if (ok) { passed++; console.log('PASS  ' + label); }
  else { failed++; console.log('FAIL  ' + label + (detail !== undefined ? '\n      ' + String(detail).slice(0, 700) : '')); }
}
const PHONE = { viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true };
const DESK = { viewport: { width: 1100, height: 800 } };
const SHOTS = process.env.SHOTS || '';

// [label, program, expected first error / {warn} / {thrown}]
const ERRORS = [
  ['an unknown item, with a suggestion', 'hud main:\n  txt "a"\n', { thrown: '2:3: Unknown HUD item "txt" — did you mean text?' }],
  ['text without quotes', 'hud main:\n  text score top left\n', { thrown: '2:8: text needs the words to show in quotes — text "Score: {score}" top left' }],
  ['a text without its closing quote', 'hud main:\n  text "abc\n', { thrown: '2:8: This text has no closing " — text "Score: {score}"' }],
  ['an unknown word (suggestion)', 'mut score = 1\nhud main:\n  text "{score}" botom left\n', { thrown: '3:18: Unknown word "botom" in this HUD line — did you mean bottom?' }],
  ['two places up/down', 'mut score = 1\nhud main:\n  text "{score}" top bottom\n', { thrown: '3:22: This item already has a place up/down (top) — one of top, middle, bottom' }],
  ['size is a whole number', 'mut score = 1\nhud main:\n  text "{score}" size 1.5\n', { thrown: '3:23: size needs a whole number (1 is the normal size, 2 twice as big) — size 2' }],
  ['size at most 8', 'mut score = 1\nhud main:\n  text "{score}" size 9\n', { thrown: '3:23: size is 1 to 8 — size 2' }],
  ['a colour is #hex', 'mut score = 1\nhud main:\n  text "{score}" color red\n', { thrown: '3:24: color needs a colour like #ffcd75' }],
  ['a bar needs its range', 'mut hp = 1\nhud main:\n  bar hp left\n', { thrown: '3:10: bar needs the range of hp: MIN..MAX — bar hp 0..100' }],
  ['width is for bars', 'mut score = 1\nhud main:\n  text "{score}" width 40\n', { thrown: '3:18: width is for bars — use size for text' }],
  ['a thing field in {…} says how to show it', 'hud main:\n  text "HP {hero.hp}"\n', { thrown: '2:13: {hero.hp}: a HUD shows global variables — copy it into one in the rules (every frame: set hp hero.hp) and show {hp}' }],
  ['{ without }', 'mut score = 1\nhud main:\n  text "{score" top left\n', { thrown: '3:9: { without } — write {score} to show a variable, {{ for a {' }],
  ['an unknown variable (position of the name, suggestion)', 'mut score = 1\nhud main:\n  text "Score: {scor}" top left\n', '3:17: Unknown variable "scor" in hud main — did you mean "score"?'],
  ['an unknown variable in a bar range', 'mut hp = 3\nhud main:\n  bar hp 0..maxhp\n', '3:13: Unknown variable "maxhp" in hud main — a HUD shows global variables: declare it (mut maxhp = 0) or set it in the rules (add maxhp 1)'],
  ['an unknown sprite', 'mut lives = 3\nhud main:\n  icons heart lives top right\n', '3:9: Unknown sprite "heart" in hud main — draw one with the Drawer (🧰 → Sprite), e.g. sprite heart: 8x8'],
  ['a variable that is neither number, bool nor string', 'mut xs = [1, 2]\nhud main:\n  text "{xs}"\n', '3:10: A HUD shows numbers, bools and strings — xs is an arr'],
  ['two hud blocks with one name', 'mut score = 1\nhud main:\n  text "{score}"\nhud main:\n  text "x"\n', '4:5: hud main is already declared at line 2 — every hud block needs its own name'],
  ['two hud names that differ only by case', 'mut score = 1\nhud main:\n  text "{score}" top left\nhud Main:\n  text "x"\n', '4:5: hud "Main" and "main" (hud at 2:5) differ only by case — names in Emit are case-insensitive, so they are the same name: rename one of them'],
  ['a variable of several files is ambiguous', '//// file: main.emit\nexport fn main() {\n}\n//// file: a.emit\nmut n = 1\n//// file: b.emit\nmut n = 2\n//// file: hud.emit\nhud main:\n  text "{n}"\n', 'hud.emit:2:10: "n" is a variable of several files (a.emit, b.emit) — move this HUD into the file whose n it shows'],
  ['hud() of an unknown name, no hud block', 'export fn main() {\n  hud(nope)\n}\n', '2:7: Unknown hud "nope" — there is no hud block yet: write one (e.g. hud nope:, then lines like   text "Score: {score}" top left) or make one with the Drawer (🧰 → HUD)'],
  ['hud() of an unknown name, with a suggestion', 'hud main:\n  text "x"\nexport fn main() {\n  hud(mian)\n}\n', '4:7: Unknown hud "mian" — did you mean "main"?'],
  ['say() with three arguments', 'export fn main() {\n  say("a", 1.0, 2)\n}\n', '2:3: say takes 1 or 2 arguments: say("Hello!") or say("Hello!", 3)'],
  ['a hud block inside a function', 'export fn main() {\n  hud main:\n    text "x"\n}\n', { thrown: '2:3: hud blocks belong at the top level of a file and start in column 1 — hud main: …' }],
  ['an empty hud is a warning', 'hud main:\n', { warn: '1:10: This HUD has nothing to show yet — add lines like:   text "Score: {score}" top left' }],
];
const PROG = `mut score = 7
mut hp = 50.0
mut lives = 3
mut msg = "hi"
mut on = true
mut t = 0

hud main:
  text "{score}" top left
  bar hp 0..100 bottom left width 40 color #ff0000
  icons h lives top right
  text "{hp} {on} {msg} {lives}" bottom right

hud other:
  text "{score}" top right

sprite h: 2x2
  palette 00ff00
  "11"
  "11"

export fn main() {
  canvas(100, 60)
  animate()
}

export fn frame() {
  t += 1
  color(0, 0, 0)
  rect(0, 0, 100, 60)
  if (t == 3) { hudOff() }
  if (t == 5) { hudOn() }
  if (t == 7) { hud("Other") }
  if (t == 9) { say("Hi", 0.1) }
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
const comp = (page, src) => page.evaluate(s => { try { const r = compile(s); return { errors: r.errors, warnings: r.warnings || [], hud: r.imports && r.imports.hudMeta || null, fx: r.imports && r.imports.fxMeta || null, huds: r.huds || [] }; } catch (e) { return { thrown: e.message }; } }, src);
async function run(page, src, wait) {
  await page.evaluate(s => { _projLoad(s); }, src);
  await page.evaluate(() => compileAndRun()).catch(e => page.errors.push('run: ' + e.message));
  await page.waitForTimeout(wait || 300);
}
// frames driven by the test: the animation loop stopped, n frames run
const frames = (page, n) => page.evaluate(n => { _animRunning = false; for (let i = 0; i < n; i++) _emitFrame(); }, n);
const px = (page, pts, sel) => page.evaluate(({ pts, sel }) => { const c = sel ? document.querySelector(sel) : _canvas, g = c.getContext('2d'); return pts.map(p => Array.from(g.getImageData(p[0], p[1], 1, 1).data.slice(0, 3)).join(',')); }, { pts, sel });

(async () => {
  const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'emit-ide-1_32.html'));
  const fileUrl = 'file://' + file;
  const browser = await chromium.launch();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'emit-hud-'));
  let page = await openIde(browser, fileUrl);

  // ── the language ──
  for (const [label, src, want] of ERRORS) {
    const r = await comp(page, src);
    if (typeof want === 'string') check('error: ' + label, r.errors && r.errors[0] === want, JSON.stringify(r));
    else if (want.thrown) check('error: ' + label, r.thrown === want.thrown, JSON.stringify(r));
    else check('warning: ' + label, r.errors && !r.errors.length && r.warnings.indexOf(want.warn) >= 0, JSON.stringify(r));
  }
  let r = await comp(page, PROG);
  let meta = r.hud ? JSON.parse(r.hud) : null;
  check('compile: the program compiles; imports.hudMeta lists both HUDs in order, no fxMeta', !r.errors.length && meta && meta.huds.map(h => h.name).join() === 'main,other' && !r.fx && r.huds.join() === 'main,other', JSON.stringify(r).slice(0, 400));
  const it = meta && meta.huds[0].items;
  check('compile: items keep kind, place, below, size, colour; {score} is global 0 (int), hp num, msg str, on bool',
    it && it.length === 4 && it[0].kind === 'text' && it[0].v === 'top' && it[0].h === 'left' && it[0].parts[0].i === 0 && it[0].parts[0].t === 'int' &&
    it[1].kind === 'bar' && it[1].value.t === 'num' && it[1].min.num === 0 && it[1].max.num === 100 && it[1].width === 40 && it[1].color === '#ff0000' &&
    it[2].kind === 'icons' && it[2].sprite.name === 'h' && it[2].count.t === 'int' && it[3].parts.filter(p => typeof p !== 'string').map(p => p.t).join() === 'num,bool,str,int', JSON.stringify(it));
  r = await comp(page, 'mut Score = 1\nsprite Heart: 1x1\n  "1"\nHUD Main:\n  TEXT "{SCORE}" Top Left Size 2 COLOR #FFF\n  Icons HEART score Bottom\nexport fn main() {\n  Hud(MAIN)\n  hud("main")\n  SAY("x")\n}\n');
  meta = r.hud ? JSON.parse(r.hud) : null;
  check('names: HUD Main: / TEXT / Top Left / {SCORE} / HEART / Hud(MAIN) — all case-insensitive, shown as declared', !r.errors.length && !r.thrown && meta && meta.huds[0].name === 'Main' && meta.huds[0].items[0].color === '#ffffff' && meta.huds[0].items[0].size === 2 && meta.huds[0].items[1].sprite.name === 'Heart' && meta.huds[0].items[1].v === 'bottom' && meta.huds[0].items[1].h === 'center', JSON.stringify(r).slice(0, 400));
  r = await comp(page, 'export fn main() {\n  say("hello")\n}\n');
  check('compile: say() alone (no hud block) still gives the runtime its HUD part (no huds)', !r.errors.length && r.hud && JSON.parse(r.hud).huds.length === 0, JSON.stringify(r));
  r = await comp(page, 'fn say(s: str) {\n}\nexport fn main() {\n  say("x")\n}\n');
  check('compile: a file\'s own say() function is left alone (no HUD part)', !r.errors.length && !r.hud, JSON.stringify(r));
  r = await comp(page, await page.evaluate(() => EX.game));
  meta = r.hud ? JSON.parse(r.hud) : null;
  check('compile: Coin Dash — hud.emit shows rules auto-globals of game.emit (score, lives, coinsLeft)', !r.errors.length && meta && meta.huds[0].items.length === 3 && /^(int|num)$/.test(meta.huds[0].items[1].count.t) && /^(int|num)$/.test(meta.huds[0].items[2].parts[1].t), JSON.stringify(r).slice(0, 300));

  // ── the runtime ──
  await page.evaluate(s => { _projLoad(s); }, PROG);
  await page.evaluate(async () => { await compileAndRun(); _animRunning = false; });
  await frames(page, 1);
  let p = await px(page, [[3, 3], [7, 3], [3, 4], [7, 4], [4, 54], [5, 53], [30, 53], [89, 3], [92, 3], [95, 3], [91, 3]]);
  check('draw: "7" at top left in the pixel font (row 0 #####, row 1 ....#)', p[0] === '255,255,255' && p[1] === '255,255,255' && p[2] === '0,0,0' && p[3] === '255,255,255', JSON.stringify(p));
  check('draw: the bar at bottom left, half full (hp 50 of 0..100) in its colour', p[5] === '255,0,0' && p[6] === '0,0,0', JSON.stringify(p));
  check('draw: three icons of sprite h at top right, one pixel apart', p[7] === '0,255,0' && p[8] === '0,255,0' && p[9] === '0,255,0' && p[10] === '0,0,0', JSON.stringify(p));
  const txt = await page.evaluate(() => _hudMeta.huds[0].items[3].parts.map(q => typeof q === 'string' ? q : _hudFmt(_hudVal(q))).join(''));
  check('values: num 50.0 → "50", bool → "true", str → its text, int → "3"', txt === '50 true hi 3', txt);
  await page.evaluate(() => { const g = _hudMeta.huds[0].items[0].parts[0].i, l = _hudMeta.huds[0].items[2].count.i; window._wi.exports['__g' + g].value = 1n; window._wi.exports['__g' + l].value = 0n; });
  await frames(page, 1);
  p = await px(page, [[3, 3], [4, 3], [89, 3], [95, 3]]);
  check('live: a new value is drawn the next frame ("1": row 0 .#.); lives 0 → no icons', p[0] === '0,0,0' && p[1] === '255,255,255' && p[2] === '0,0,0' && p[3] === '0,0,0', JSON.stringify(p));
  let st = await page.evaluate(() => { const o = []; for (let i = 0; i < 9; i++) { _emitFrame(); o.push(JSON.stringify(_hudState())); } return o; });
  st = st.map(s => JSON.parse(s));
  check('builtins: hudOff() hides, hudOn() shows, hud("Other") switches, say("Hi", 0.1) shows for 6 frames',
    st[0].on === false && st[2].on === true && st[4].hud === 'other' && st[6].say === 'Hi', JSON.stringify(st));
  p = await px(page, [[4, 3], [95, 3]]);
  check('draw: hud other puts the score at top right; main is gone', p[0] === '0,0,0' && p[1] === '255,255,255', JSON.stringify(p));
  st = await page.evaluate(() => { for (let i = 0; i < 6; i++) _emitFrame(); return _hudState(); });
  check('builtins: the say() message is gone after its time', st.say === '', JSON.stringify(st));
  check('runtime: no page errors', !page.errors.length, page.errors.join(' | '));
  // a program that does not animate: the HUD is drawn after main()
  await run(page, 'hud main:\n  text "5" top left\nexport fn main() {\n  canvas(50, 30)\n}\n', 300);
  p = await px(page, [[3, 3], [7, 3]]);
  check('draw: a program without frame() gets its HUD after main()', p[0] === '255,255,255' && p[1] === '255,255,255', JSON.stringify(p));
  // screen(…): drawn after the blit
  await run(page, 'region fb: u8[32 * 24 * 4]\nhud main:\n  text "1" top left\nexport fn main() {\n  screen(fb, 32, 24, 2)\n  animate()\n}\nexport fn frame() {\n  fb[0] = 255\n}\n', 500);
  p = await px(page, [[4, 3], [3, 3]], 'canvas[data-emit-screen]');
  check('draw: on a screen(…) the HUD is drawn after the blit', p[0] === '255,255,255' && p[1] === '0,0,0', JSON.stringify(p));
  // no HUD: nothing set up
  await run(page, 'export fn main() {\n  canvas(10, 10)\n}\n', 200);
  check('runtime: a program without a HUD has no HUD state', await page.evaluate(() => _hudMeta === null));
  // Coin Dash (things)
  await page.selectOption('#example', 'game').catch(() => {});
  await page.evaluate(() => compileAndRun());
  await page.waitForTimeout(900);
  st = await page.evaluate(() => _hudState());
  p = await px(page, [[4, 3], [3, 3], [4, 13]]);
  check('Coin Dash: hud main is on; "Score" at top left over the stage (S row 0 .####), hearts below it', st.hud === 'main' && p[0] === '255,255,255' && p[1] !== '255,255,255' && p[2] === '228,59,68', JSON.stringify({ st, p }));
  check('Coin Dash: no page errors', !page.errors.length, page.errors.join(' | '));
  await page.evaluate(() => stopProgram());
  await page.context().close();

  // ── the HUD tool on a phone ──
  page = await openIde(browser, fileUrl, PHONE);
  await page.evaluate(() => { _projLoad('//// file: main.emit\nmut score = 0\nmut lives = 3\nexport fn main() {\n  canvas(320, 240)\n}\n//// file: sprites.emit\nsprite heart: 2x2\n  "11"\n  "11"\n'); });
  await page.evaluate(() => _drawerOpen());
  await page.waitForTimeout(150);
  await page.tap('#drawer .drw-card[data-tool="hud"]');
  await page.waitForTimeout(250);
  let t = await page.evaluate(() => { const R = document.querySelector('[data-hud-tool]'); return { ok: !!R, n: R._hud.S().items.length, text: R._hud.text(), chips: [...document.querySelectorAll('.hfx-vchips .drw-chip')].map(c => c.textContent), cv: !!document.querySelector('.hfx-cv') }; });
  check('tool: a card opens the HUD tool: a new hud main with one text item, chips of the globals, a preview', t.ok && t.n === 1 && /^hud main:\n  text  "Score: \{score\}"  top left$/.test(t.text) && t.chips.join() === '{score},{lives}' && t.cv, JSON.stringify(t));
  await page.tap('.hfx-item[data-item="0"] .hfx-grid button[data-anchor="bottom right"]');
  await page.tap('.hfx-item[data-item="0"] .hfx-vchips .drw-chip:nth-child(2)');
  t = await page.evaluate(() => document.querySelector('[data-hud-tool]')._hud.text());
  check('tool: the 3×3 grid puts the item bottom right; a chip inserts {lives} into the text', /text  "Score: \{score\}\{lives\}"  bottom right$/.test(t), t);
  await page.tap('.drw-wrap .drw-btn[aria-label="Add icons (a sprite repeated)"]');
  await page.waitForTimeout(100);
  t = await page.evaluate(() => document.querySelector('[data-hud-tool]')._hud.text());
  check('tool: + Icons adds icons of the first sprite counted by a lives-like variable', /\n  icons heart lives  top right$/.test(t), t);
  await page.tap('.hfx-item[data-item="1"] input[type=checkbox]');
  await page.tap('.hfx-item[data-item="1"] .drw-seg[aria-label="Size"] button[data-v="2"]');
  await page.tap('.hfx-item[data-item="1"] .drw-btn[aria-label="Move up"]');
  await page.waitForTimeout(100);
  t = await page.evaluate(() => document.querySelector('[data-hud-tool]')._hud.text());
  check('tool: below, size 2 and ↑ (the icons move first)', /^hud main:\n  icons heart lives  top right below  size 2\n  text  /.test(t), t);
  await page.tap('.drw-wrap .drw-btn[aria-label="Add a bar"]');
  await page.waitForTimeout(100);
  await page.tap('.hfx-item[data-item="2"] .drw-btn[aria-label="Remove this item"]');
  await page.waitForTimeout(100);
  const ov = await page.evaluate(() => { const b = document.getElementById('drawerBody'); return { sw: b.scrollWidth, cw: b.clientWidth, doc: document.documentElement.scrollWidth }; });
  check('tool: no horizontal overflow at 360 px', ov.sw <= ov.cw && ov.doc <= 360, JSON.stringify(ov));
  const small = await page.evaluate(() => [...document.querySelectorAll('[data-hud-tool] button, [data-hud-tool] input[type=color], #drawerFoot button')].filter(b => b.offsetParent).map(b => { const r = b.getBoundingClientRect(); return { t: b.textContent || b.getAttribute('aria-label'), h: Math.round(r.height), w: Math.round(r.width) }; }).filter(x => x.h < 44 || x.w < 44));
  check('tool: every button is a 44 px touch target', !small.length, JSON.stringify(small.slice(0, 6)));
  const pv = await page.evaluate(() => { const c = document.querySelector('.hfx-cv'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const seen = new Set(); for (let i = 0; i < d.length; i += 4) seen.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]); return { w: c.width, h: c.height, colours: seen.size, white: seen.has('255,255,255') }; });
  check('tool: the preview is the game size (320×240) and shows the HUD over a sample screen', pv.w === 320 && pv.h === 240 && pv.colours > 5 && pv.white, JSON.stringify(pv));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'hud-tool-phone.png') });
  t = await page.evaluate(() => document.querySelector('[data-hud-tool]')._hud.text());
  await page.tap('#drawerFoot .drw-pri');
  await page.waitForTimeout(150);
  const saved = await page.evaluate(() => ({ dirty: _drawer.dirty, block: _drawerRead('hud', 'main'), files: _proj.files.map(f => f.path) }));
  check('save: the block is written to a new hud.emit, exactly the tool\'s text; not dirty any more', saved.block === t && saved.files.includes('hud.emit') && !saved.dirty, JSON.stringify(saved));
  r = await comp(page, await page.evaluate(() => _projText()));
  check('save: the project compiles with the saved HUD', !r.errors.length && !r.thrown && r.hud, JSON.stringify(r).slice(0, 300));
  await page.click('#drawer .drw-back').catch(() => {});
  await page.waitForTimeout(100);
  await page.tap('#drawer .drw-card[data-tool="hud"]');
  await page.waitForTimeout(200);
  t = await page.evaluate(() => { const R = document.querySelector('[data-hud-tool]'); return { text: R._hud.text(), n: R._hud.S().items.length }; });
  check('round trip: reopening reads the block back to the same items and text', t.text === saved.block && t.n === 2, JSON.stringify(t));
  // a hand-written block with every item kind reads back to the same text
  const hand = 'hud top:\n  text  "Coins {{left}} {score}"  top right  color #ffcd75\n  icons heart lives  top right below\n  bar   score 0..lives  bottom left  width 60  color #38b764\n  text  "x"  center  size 2';
  await page.evaluate(h => { _drawerWrite('hud', 'top', h, 'hud.emit'); }, hand);
  await page.click('#drawer .drw-back').catch(() => {});
  await page.tap('#drawer .drw-card[data-tool="hud"]');
  await page.waitForTimeout(200);
  t = await page.evaluate(() => { const R = document.querySelector('[data-hud-tool]'); const chips = [...document.querySelectorAll('.drw-chips[role=tablist] .drw-chip')]; chips[1].click(); return document.querySelector('[data-hud-tool]')._hud.text(); });
  check('round trip: a hand-written block (all kinds, {{ }}, ranges of variables) is read and written back unchanged', t === hand, t);
  // the preview over the last frame of the game
  await page.evaluate(() => { _drawerClose(); });
  await page.evaluate(() => _projLoad('mut score = 4\nhud main:\n  text "{score}" top left\nexport fn main() {\n  canvas(120, 80)\n  animate()\n}\nexport fn frame() {\n  color(200, 0, 0)\n  rect(0, 0, 120, 80)\n}\n'));
  await page.evaluate(() => compileAndRun());
  await page.waitForTimeout(500);
  await page.evaluate(() => { stopProgram(); _drawerOpen('hud'); });
  await page.waitForTimeout(250);
  t = await page.evaluate(() => { const c = document.querySelector('.hfx-cv'), g = c.getContext('2d'); return { w: c.width, h: c.height, bg: Array.from(g.getImageData(60, 60, 1, 1).data.slice(0, 3)).join(), txt: Array.from(g.getImageData(3, 3, 1, 1).data.slice(0, 3)).join(), four: Array.from(g.getImageData(6, 3, 1, 1).data.slice(0, 3)).join(), note: document.querySelector('.hfx-note').textContent }; });
  check('tool: after a run the preview is the game\'s last frame (120×80, red) with the HUD and its live value ("4": row 0 ...#.)', t.w === 120 && t.bg === '200,0,0' && t.txt === '200,0,0' && t.four === '255,255,255' && /last frame/.test(t.note) && /live values/.test(t.note), JSON.stringify(t));
  check('tool: no page errors', !page.errors.length, page.errors.join(' | '));
  if (SHOTS) {
    await page.evaluate(() => { _drawerClose(); });
    await page.selectOption('#example', 'game').catch(() => {});
    await page.evaluate(() => compileAndRun());
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SHOTS, 'hud-game-phone.png') });
  }
  await page.context().close();

  // ── export ──
  page = await openIde(browser, fileUrl);
  const ex = await page.evaluate(async src => {
    const r = compile(src), P = _exportProgram(src, r);
    const plain = compile('export fn main() {\n  canvas(10, 10)\n}\n'), P0 = _exportProgram('', plain);
    return { html: _exportHtml(P), js: _exportJs(P), rt: _exportRuntime(P), rt0: _exportRuntime(P0), html0: _exportHtml(P0).length };
  }, PROG.replace('  if (t == 3) { hudOff() }\n  if (t == 5) { hudOn() }\n  if (t == 7) { hud("Other") }\n  if (t == 9) { say("Hi", 0.1) }\n', ''));
  check('export: the runtime of a HUD program has the HUD painter and the font, not the particles', /function _hudPaintSpec\(/.test(ex.rt) && /_HUD_FONT='/.test(ex.rt) && !/function _fxWorld\(/.test(ex.rt));
  check('export: the runtime of a program without HUD or particles has neither (nor their markers)', !/_hudPaintSpec|_fxWorld|emit-hud-|emit-fx-/.test(ex.rt0));
  // the same runtime as the base build for a program without them
  let base = null;
  try {
    const bf = path.join(tmp, 'base.html');
    fs.writeFileSync(bf, execFileSync('git', ['show', '361ad22:emit-ide-1_32.html'], { cwd: path.join(__dirname, '..'), maxBuffer: 64 << 20 }));
    const bp = await newPage(browser);
    await bp.goto('file://' + bf);
    await bp.waitForFunction(() => typeof compileAndRun === 'function');
    base = await bp.evaluate(() => { const plain = compile('export fn main() {\n  canvas(10, 10)\n}\n'), P0 = _exportProgram('', plain); return { rt0: _exportRuntime(P0), html0: _exportHtml(P0).length }; });
    await bp.context().close();
  } catch (e) { base = { err: e.message }; }
  check('export: a program without HUD or particles exports the very same runtime as before (361ad22); .html size growth ' + (base && base.html0 ? (ex.html0 - base.html0) + ' bytes' : '?'), base && base.rt0 === ex.rt0 && Math.abs(ex.html0 - base.html0) < 64, JSON.stringify({ base: base && (base.err || base.rt0.length), cur: ex.rt0.length, html: [base && base.html0, ex.html0] }));
  await page.context().close();
  const hf = path.join(tmp, 'hud.html'); fs.writeFileSync(hf, ex.html);
  page = await newPage(browser);
  await page.goto('file://' + hf);
  await page.waitForFunction(() => document.querySelector('canvas'), null, { timeout: 20000 });
  await page.waitForTimeout(400);
  p = await page.evaluate(() => { const c = document.querySelector('canvas'), g = c.getContext('2d'); return [[3, 3], [5, 53], [89, 3]].map(q => Array.from(g.getImageData(q[0], q[1], 1, 1).data.slice(0, 3)).join()); });
  check('export .html: the exported page draws the HUD (text, bar, icons)', p[0] === '255,255,255' && p[1] === '255,0,0' && p[2] === '0,255,0', JSON.stringify(p) + ' ' + page.errors.join(' | '));
  await page.context().close();
  page = await newPage(browser);
  await page.route('http://export.test/program.js', r => r.fulfill({ body: ex.js, contentType: 'text/javascript' }));
  await page.route('http://export.test/index.html', r => r.fulfill({ body: '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><div id="app"></div><script type="module">import init from "./program.js"; init({ target: document.getElementById("app") }).then(a => { window.__state = "ready"; }, e => { window.__state = "error " + e.message; });</script></body></html>', contentType: 'text/html' }));
  await page.goto('http://export.test/index.html');
  await page.waitForFunction(() => window.__state, null, { timeout: 20000 });
  await page.waitForTimeout(400);
  p = await page.evaluate(() => { const c = document.querySelector('canvas'); if (!c) return ['no canvas', window.__state]; const g = c.getContext('2d'); return [[3, 3], [5, 53]].map(q => Array.from(g.getImageData(q[0], q[1], 1, 1).data.slice(0, 3)).join()); });
  check('export .js: the module draws the HUD too', p[0] === '255,255,255' && p[1] === '255,0,0', JSON.stringify(p) + ' ' + page.errors.join(' | '));
  await page.context().close();

  await browser.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + passed + '/' + (passed + failed) + ' HUD checks passed');
  process.exit(failed ? 1 : 0);
})();

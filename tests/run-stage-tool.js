#!/usr/bin/env node
// The STAGE (map painter) and CONTROLS drawer tools of an Emit IDE build, in headless Chromium.
// The tools open in the real drawer (CORE) with its real ctx; sprite tiles are drawn from real sprite blocks
// (SPRITE). The checks run twice: on a phone viewport with touch (360 px wide) and on a desktop viewport with a
// mouse.
//
//   node tests/run-stage-tool.js [path/to/emit-ide.html] [phone|desk]
const { chromium } = require('playwright');
const path = require('path');

let failed = 0, passed = 0;
function check(label, ok, detail) {
  if (ok) { passed++; console.log('PASS  ' + label); }
  else { failed++; console.log('FAIL  ' + label + (detail !== undefined ? '\n      ' + String(detail).slice(0, 800) : '')); }
}
const PHONE = { viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true };
const DESK = { viewport: { width: 1200, height: 800 } };

// ── The real drawer (CORE) and the real sprites (SPRITE) ──
// Test hooks over the real drawer: __openTool(id) opens tool id afresh (also when it is already open), __ctx is
// the ctx the real drawer gave the tool, __toasts records ctx.toast, __dirty reads the drawer's dirty flag,
// __writes counts ctx.write. The sprites grass (all #00aa00) and rock (all #999999) are real sprite blocks
// in sprites.emit, which the STAGE view draws from the program text.
const HOOKS = `
window.__toasts = []; window.__writes = 0;
window.__openTool = function (id) {
  _drawerEnsure();
  var t = _drawerFind(id); if (!t) throw new Error('no tool ' + id);
  _drawerTool(t);
  window.__ctx = _drawer.ctx;
  return true;
};
(function () {
  var toast0 = _drawerToast; window._drawerToast = function (s) { window.__toasts.push(String(s)); return toast0.apply(this, arguments); };
  var write0 = _drawerWrite; window._drawerWrite = function () { window.__writes++; return write0.apply(this, arguments); };
  Object.defineProperty(window, '__dirty', { configurable: true, get: function () { return _drawer.dirty; } });
})();`;

const MAIN = 'export fn main() {\n  canvas(mapW(level1) * tileSize(level1), mapH(level1) * tileSize(level1))\n  drawMap(level1)\n  print(objCount(level1, "coin"))\n}\n';
const LEVEL = [
  'map level1: 10x6, tile 16',
  '  legend # wall solid #3a3a5c,  . floor #1b1b2a,  ~ water solid #2050c0',
  '  rows',
  '    "##########"',
  '    "#........#"',
  '    "#..~~....#"',
  '    "#........#"',
  '    "#........#"',
  '    "##########"',
  '  objects',
  '    hero 1,1',
  '    coin 7,2 value 5',
].join('\n');
// a hand-written block in the other style: legend one per line, a comment, a line this version does not know
const HAND = [
  'map cave: 3x2',
  '  legend',
  '    r rock solid #555555',
  '    s sand #c2b280 sprite grass',
  '  rows',
  '    "rsr"',
  '    "s s"',
  '  // keep me',
  '  weather rain',
].join('\n');
const CTL = 'controls pad: stick left, buttons A "jump", size 1.0, opacity 0.5';
const SPRITES = 'sprite grass: 2x2\n  palette 00aa00\n  "11"\n  "11"\n\nsprite rock: 2x2\n  palette 999999\n  "11"\n  "11"\n';
const BUNDLE = MAIN + '//// file: stages.emit\n' + LEVEL + '\n\n' + HAND + '\n\n' + CTL + '\n//// file: sprites.emit\n' + SPRITES;

async function openIde(browser, fileUrl, mode) {
  const ctx = await browser.newContext(mode);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message.slice(0, 300)));
  page.on('dialog', d => d.accept());
  await page.route(/^https?:/, r => r.abort());
  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof compileAndRun === 'function' && typeof _projLoad === 'function' && typeof _drawerFind === 'function' && _drawerFind('stage') && _drawerFind('controls'));
  await page.waitForTimeout(150);
  await page.evaluate(h => { (0, eval)(h); }, HOOKS);
  await page.evaluate(b => { try { closeWelcome(); } catch (e) {} _projLoad(b); }, BUNDLE);
  return page;
}
const api = (page, fn, arg) => page.evaluate(([f, a]) => { const r = document.querySelector('[data-stage-tool]'); return eval('(' + f + ')')(r._stageApi, r._stage, a); }, [fn.toString(), arg]);
const model = page => api(page, a => JSON.parse(JSON.stringify(a.model())));
// the page point of a tile's centre; the map view is scrolled into sight first (the sheet scrolls on a phone)
const scr = async (page, tx, ty) => { await page.$eval('[data-stg="view"]', e => { const r = e.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) e.scrollIntoView({ block: 'center' }); }); return api(page, (a, s, t) => a.screen(t[0], t[1]), [tx, ty]); };
const blockText = (page, kind, name) => page.evaluate(([k, n]) => window.__ctx.read(k, n), [kind, name]);

// one pointer along a path of page points: touch (CDP) on the phone, the mouse on the desktop
async function stroke(page, phone, pts, holdMs) {
  if (phone) {
    const cdp = page.__cdp || (page.__cdp = await page.context().newCDPSession(page));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0].x, y: pts[0].y, id: 1 }] });
    if (holdMs) await page.waitForTimeout(holdMs);
    for (const p of pts.slice(1)) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y, id: 1 }] }); await page.waitForTimeout(20); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(pts[0].x, pts[0].y); await page.mouse.down();
    if (holdMs) await page.waitForTimeout(holdMs);
    for (const p of pts.slice(1)) { await page.mouse.move(p.x, p.y, { steps: 3 }); }
    await page.mouse.up();
  }
  await page.waitForTimeout(40);
}
const tap = (page, phone, p) => stroke(page, phone, [p]);
const click = (page, sel) => page.click(sel);
const rowsOf = m => m.rows.join('/');

async function stageChecks(browser, fileUrl, phone) {
  const T = phone ? '[phone] ' : '[desk] ';
  const page = await openIde(browser, fileUrl, phone ? PHONE : DESK);
  await page.evaluate(() => __openTool('stage'));
  await page.waitForSelector('[data-stage-tool] [data-stg="view"]');
  let m = await model(page);
  check(T + 'opens the first map of the project', m.name === 'level1' && m.w === 10 && m.h === 6 && m.objects.length === 2, JSON.stringify(m).slice(0, 200));
  const opts = await page.$$eval('[data-stg="pick"] option', os => os.map(o => o.textContent));
  check(T + 'the map list shows every map block and "new map"', JSON.stringify(opts) === JSON.stringify(['map level1', 'map cave', '＋ new map…']), JSON.stringify(opts));
  // unchanged save: the block text is exactly what was written by hand
  await click(page, '[data-stg="save"]');
  check(T + 'open + save without changes keeps the block text exactly', await blockText(page, 'map', 'level1') === LEVEL, await blockText(page, 'map', 'level1'));
  // pencil: a stroke from (1,4) to (4,4) with the wall brush
  await click(page, '[data-brush="#"]');
  await stroke(page, phone, [await scr(page, 1, 4), await scr(page, 2, 4), await scr(page, 4, 4)]);
  m = await model(page);
  check(T + 'pencil paints a stroke (no gaps)', m.rows[4] === '#####....#', m.rows[4]);
  // rectangle with water
  await click(page, '[data-brush="~"]'); await click(page, '[data-tool="rect"]');
  await stroke(page, phone, [await scr(page, 6, 1), await scr(page, 7, 1), await scr(page, 8, 2)]);
  m = await model(page);
  check(T + 'rectangle fills the dragged box', m.rows[1] === '#.....~~~#' && m.rows[2] === '#..~~.~~~#', rowsOf(m));
  // room: walls around a floor
  await click(page, '[data-brush="#"]'); await click(page, '[data-tool="room"]');
  await stroke(page, phone, [await scr(page, 1, 1), await scr(page, 3, 3), await scr(page, 4, 3)]);
  m = await model(page);
  check(T + 'room draws walls around a floor', m.rows[1] === '#####.~~~#' && m.rows[2] === '##..#.~~~#' && m.rows[3] === '#####....#', rowsOf(m));
  // fill: the floor area right of the room becomes water
  await click(page, '[data-brush="~"]'); await click(page, '[data-tool="fill"]');
  await tap(page, phone, await scr(page, 5, 3));
  m = await model(page);
  check(T + 'fill floods the connected area only', m.rows[3] === '#####~~~~#' && m.rows[1] === '#####~~~~#' && m.rows[2] === '##..#~~~~#' && m.rows[5] === '##########' && m.rows[2].slice(2, 4) === '..', rowsOf(m));
  // eraser = first non-solid entry (floor)
  await click(page, '[data-tool="eraser"]');
  await stroke(page, phone, [await scr(page, 6, 3), await scr(page, 8, 3)]);
  m = await model(page);
  check(T + 'eraser paints the first non-solid tile', m.rows[3] === '#####~...#', m.rows[3]);
  // eyedropper
  await click(page, '[data-tool="pick"]');
  await tap(page, phone, await scr(page, 6, 1));
  const st = await api(page, (a, s) => [s.brush, s.tool]);
  check(T + 'eyedropper picks the tile and goes back to the pencil', st[0] === '~' && st[1] === 'pencil', JSON.stringify(st));
  // undo / redo
  const before = rowsOf(await model(page));
  await click(page, '[data-stg="undo"]');
  const undone = rowsOf(await model(page));
  await click(page, '[data-stg="redo"]');
  check(T + 'undo takes back the eraser stroke, redo repeats it', undone.split('/')[3] === '#####~~~~#' && rowsOf(await model(page)) === before, undone + ' | ' + before);
  // legend: rename, solid, colour, sprite, new tile, change a character, delete
  await click(page, '[data-stg="legendbtn"]');
  const row = i => '[data-stg="legend"] [data-lg="' + i + '"] ';
  await page.fill(row(1) + '[data-f="name"]', 'ground'); await page.press(row(1) + '[data-f="name"]', 'Enter');
  await page.dispatchEvent(row(1) + '[data-f="name"]', 'change');
  await page.check(row(2) + '[data-f="solid"]').catch(() => {});
  await page.uncheck(row(2) + '[data-f="solid"]');
  await page.$eval(row(0) + '[data-f="color"]', e => { e.value = '#112233'; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); });
  await page.selectOption(row(1) + '[data-f="sprite"]', 'grass');
  await click(page, '[data-stg="addtile"]');
  m = await model(page);
  const added = m.legend[3];
  check(T + 'legend edits: name, solid off, colour, sprite, a new tile', m.legend[1].name === 'ground' && m.legend[1].sprite === 'grass' && m.legend[2].solid === false && m.legend[0].color === '#112233' && added && added.ch === 'g' && !added.solid, JSON.stringify(m.legend));
  await page.fill(row(2) + '[data-f="ch"]', 'w'); await page.dispatchEvent(row(2) + '[data-f="ch"]', 'change');
  m = await model(page);
  check(T + 'changing a legend character changes it in the rows', m.legend[2].ch === 'w' && !m.rows.join('').includes('~') && m.rows[1] === '#####wwww#', rowsOf(m));
  await page.fill(row(0) + '[data-f="ch"]', '.'); await page.dispatchEvent(row(0) + '[data-f="ch"]', 'change');
  check(T + 'a character already in the legend is refused', (await model(page)).legend[0].ch === '#' && (await page.evaluate(() => __toasts[__toasts.length - 1])).includes('already'), await page.evaluate(() => __toasts.slice(-1)[0]));
  await click(page, row(2) + '[data-f="del"]');
  m = await model(page);
  check(T + 'deleting a legend entry turns its tiles into the eraser tile', m.legend.length === 3 && m.rows[1] === '#####....#', rowsOf(m));
  const pix = await page.evaluate(() => { const c = document.querySelector('[data-stg="view"] canvas'), a = document.querySelector('[data-stage-tool]')._stageApi, r = c.getBoundingClientRect(), p = a.screen(8, 2), d = window.devicePixelRatio || 1; return Array.from(c.getContext('2d').getImageData(Math.round((p.x - r.left) * d), Math.round((p.y - r.top) * d), 1, 1).data).slice(0, 3).join(','); });
  check(T + 'a sprite tile is drawn from its sprite block', pix === '0,170,0', pix);
  // objects: place, move, long-press edit, delete
  await click(page, '[data-tool="objects"]');
  await page.fill('[data-stg="kind"]', 'slime');
  await tap(page, phone, await scr(page, 3, 4));
  m = await model(page);
  check(T + 'objects: a tap places one of the chosen kind', m.objects.length === 3 && JSON.stringify(m.objects[2]) === JSON.stringify({ kind: 'slime', x: 3, y: 4, props: [] }), JSON.stringify(m.objects));
  await stroke(page, phone, [await scr(page, 3, 4), await scr(page, 5, 4), await scr(page, 6, 4)]);
  m = await model(page);
  check(T + 'objects: dragging one moves it', m.objects[2].x === 6 && m.objects[2].y === 4 && m.objects.length === 3, JSON.stringify(m.objects));
  await stroke(page, phone, [await scr(page, 7, 2)], 700);
  const panel = await page.isVisible('[data-stg="props"]');
  await click(page, '[data-stg="props"] [data-f="addprop"]');
  await page.fill('[data-stg="props"] [data-f="pv"] >> nth=1', 'big one');
  await page.dispatchEvent('[data-stg="props"] [data-f="pv"] >> nth=1', 'change');
  m = await model(page);
  check(T + 'objects: a long press opens its properties; a property is added and edited', panel && JSON.stringify(m.objects[1].props) === JSON.stringify([['value', '5'], ['value2', '"big one"']]), JSON.stringify(m.objects[1]));
  await click(page, '[data-stg="props"] [data-f="delobj"]');
  m = await model(page);
  check(T + 'objects: delete removes it', m.objects.length === 2 && m.objects.every(o => o.kind !== 'coin'), JSON.stringify(m.objects));
  // zoom / pan
  const c0 = Number(await page.getAttribute('[data-stg="view"]', 'data-cell')), rows0 = rowsOf(await model(page));
  if (phone) {
    const cdp = page.__cdp;
    const v = await page.$eval('[data-stg="view"]', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: v.x - 20, y: v.y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: v.x - 20, y: v.y, id: 1 }, { x: v.x + 20, y: v.y, id: 2 }] });
    for (let k = 1; k <= 5; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: v.x - 20 - k * 12, y: v.y + k * 4, id: 1 }, { x: v.x + 20 + k * 12, y: v.y + k * 4, id: 2 }] }); await page.waitForTimeout(30); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    const v = await page.$eval('[data-stg="view"]', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(v.x, v.y); await page.mouse.wheel(0, -300); await page.waitForTimeout(100);
  }
  await page.waitForTimeout(100);
  const c1 = Number(await page.getAttribute('[data-stg="view"]', 'data-cell')), pan = await api(page, (a, s) => [s.panX, s.panY]);
  check(T + (phone ? 'pinch zooms in and two fingers pan, without painting' : 'the wheel zooms in'), c1 > c0 * 1.3 && rowsOf(await model(page)) === rows0 && (!phone || Math.abs(pan[1]) > 5), c0 + ' → ' + c1 + ' pan ' + pan);
  await click(page, '[data-stg="zoomout"]');
  check(T + 'zoom buttons', Number(await page.getAttribute('[data-stg="view"]', 'data-cell')) < c1, '');
  await click(page, '[data-stg="fit"]');
  // painting still hits the right tile after zooming (zoom in, paint, check)
  await click(page, '[data-stg="zoomin"]'); await click(page, '[data-stg="zoomin"]');
  await click(page, '[data-brush="#"]');
  await tap(page, phone, await scr(page, 2, 2));
  check(T + 'zoomed in, a tap still paints the tile under the finger', (await model(page)).rows[2][2] === '#', (await model(page)).rows[2]);
  await click(page, '[data-stg="fit"]');
  // resize keeps content, drops objects outside, undo brings everything back
  const mBefore = await model(page);
  await page.fill('[data-stg="w"]', '6'); await page.fill('[data-stg="h"]', '8');
  await click(page, '[data-stg="resize"]');
  m = await model(page);
  check(T + 'resize keeps the tiles that fit and fills new ones with the eraser tile', m.w === 6 && m.h === 8 && m.rows.length === 8 && m.rows[0] === '######' && m.rows[6] === '......' && m.rows.every(r => r.length === 6) && m.objects.every(o => o.x < 6), rowsOf(m));
  await click(page, '[data-stg="undo"]');
  check(T + 'undo after resize restores the map and its objects', JSON.stringify(await model(page)) === JSON.stringify(mBefore), '');
  // try it: the hero (moved to an open spot first) walks right until a wall stops it
  await click(page, '[data-tool="objects"]');
  await stroke(page, phone, [await scr(page, 1, 1), await scr(page, 3, 3), await scr(page, 5, 3)]);
  check(T + 'objects: the hero is dragged out of the wall', JSON.stringify((await model(page)).objects[0]) === JSON.stringify({ kind: 'hero', x: 5, y: 3, props: [] }), JSON.stringify((await model(page)).objects));
  await click(page, '[data-stg="try"]');
  await page.$eval('[data-stg="trypanel"]', e => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(100);
  const h0 = (await page.getAttribute('[data-stg="trypanel"]', 'data-hero')).split(',').map(Number);
  if (phone) {
    const cdp = page.__cdp;
    const s = await page.$eval('[data-stg="trypanel"] [data-ctl="stick"]', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 }; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: s.x + s.r * 0.9, y: s.y, id: 1 }] });
    await page.waitForTimeout(1500);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.keyboard.down('ArrowRight'); await page.waitForTimeout(1500); await page.keyboard.up('ArrowRight');
  }
  const h1 = (await page.getAttribute('[data-stg="trypanel"]', 'data-hero')).split(',').map(Number);
  m = await model(page);
  const wallX = m.rows[3].indexOf('#', 6), t = m.tile, hs = Math.round(t * 0.7);
  check(T + 'try it: the hero moves and a solid tile stops it', h1[0] > h0[0] + 10 && h1[0] + hs <= wallX * t + 0.01 && h1[0] + hs > wallX * t - 3 && h1[1] === h0[1], 'start ' + h0 + ' end ' + h1 + ' wall at x ' + wallX * t + ' row ' + m.rows[3]);
  await click(page, '[data-stg="try"]');
  // save → exact text in the project → the program compiles → reopen → identical
  await click(page, '[data-stg="save"]');
  const saved = await blockText(page, 'map', 'level1'), written = await api(page, a => a.text());
  check(T + 'save writes exactly the block text into stages.emit', saved === written && /^map level1: 10x6, tile 16\n  legend # wall solid #112233,  \. ground #1b1b2a sprite grass,  g tile #[0-9a-f]{6}\n  rows\n/.test(saved) && /\n  objects\n    hero 5,3\n    slime 6,4$/.test(saved), saved);
  check(T + 'the tool says it is saved (setDirty false)', await page.evaluate(() => window.__dirty) === false, '');
  // (without the hand-written block below, whose unknown line is a compile error on purpose)
  const comp = await page.evaluate(() => { try { const r = compile(_projText().replace(/map cave:[\s\S]*?weather rain\n/, '')); return r.errors.join(' | ') || 'OK'; } catch (e) { return e.message; } });
  check(T + 'the saved program compiles', comp === 'OK', comp);
  await page.evaluate(() => __openTool('stage'));
  await page.waitForSelector('[data-stage-tool]');
  check(T + 'reopened, the map reads back to the same text', await api(page, a => a.text()) === saved, await api(page, a => a.text()));
  await click(page, '[data-stg="save"]');
  check(T + 'saving again changes nothing', await blockText(page, 'map', 'level1') === saved, '');
  // the hand-written block: other legend style, comment and unknown line kept
  await page.selectOption('[data-stg="pick"]', 'cave');
  const cm = await model(page), msg = await page.textContent('[data-stg="msg"]');
  await click(page, '[data-stg="save"]');
  check(T + 'a hand-written block reads back, its comment and unknown line are kept', await blockText(page, 'map', 'cave') === HAND && cm.rows[1] === 's s' && /weather rain/.test(JSON.stringify(cm.keep)) && /Unknown line/.test(msg), (await blockText(page, 'map', 'cave')) + ' | ' + msg);
  // a new map
  await page.selectOption('[data-stg="pick"]', '\u0000new');
  await page.fill('[data-stg="name"]', 'arena'); await page.dispatchEvent('[data-stg="name"]', 'change');
  await click(page, '[data-stg="save"]');
  const arena = await page.evaluate(() => _proj.files.map(f => f.path + ':' + (_stFindBlocks(f.source).map(b => b.kind + ' ' + b.name).join(','))).join(' | '));
  check(T + 'a new map is written to stages.emit', /stages\.emit:map level1,map cave,controls pad,map arena/.test(arena), arena);
  // no horizontal overflow
  const ov = await page.evaluate(() => { const s = document.querySelector('#drawer .drw'), bd = document.getElementById('drawerBody'), R = s.getBoundingClientRect(); return { doc: document.documentElement.scrollWidth, sheet: bd.scrollWidth, cw: bd.clientWidth, wide: [...s.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > R.left + s.clientWidth + 1).map(e => e.tagName + '.' + e.className + '[' + (e.getAttribute('data-stg') || '') + ']').slice(0, 5) }; });
  check(T + 'no horizontal overflow in the tool', ov.sheet <= ov.cw && ov.wide.length === 0, JSON.stringify(ov));
  check(T + 'no page errors', !page.errors.length, page.errors.join(' | '));
  await page.context().close();
}

async function controlsChecks(browser, fileUrl, phone) {
  const T = phone ? '[phone] ' : '[desk] ';
  const page = await openIde(browser, fileUrl, phone ? PHONE : DESK);
  await page.evaluate(() => __openTool('controls'));
  await page.waitForSelector('[data-controls-tool] [data-ctl-f="phone"]');
  const side = async () => page.$eval('[data-ctl-f="phone"]', e => [e.getAttribute('data-stick-side'), e.getAttribute('data-button-side')]);
  check(T + 'controls: opens controls pad with its stick and button', JSON.stringify(await side()) === '["left","right"]' && await page.$eval('[data-ctl-f="phone"] [data-ctl="A"]', e => e.textContent) === 'jump', JSON.stringify(await side()));
  await click(page, '[data-ctl-f="save"]');
  check(T + 'controls: open + save keeps the text', await blockText(page, 'controls', 'pad') === CTL, await blockText(page, 'controls', 'pad'));
  // drag the stick to the right half
  const ph = await page.$eval('[data-ctl-f="phone"]', e => { const r = e.getBoundingClientRect(); return { l: r.left, w: r.width }; });
  const sp = await page.$eval('[data-ctl-f="phone"] [data-ctl="stick"]', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await stroke(page, phone, [sp, { x: ph.l + ph.w * 0.6, y: sp.y }, { x: ph.l + ph.w * 0.85, y: sp.y }]);
  check(T + 'controls: dragging the stick to the right puts the buttons on the left', JSON.stringify(await side()) === '["right","left"]', JSON.stringify(await side()));
  await click(page, '[data-ctl-f="dpad"]'); await click(page, '[data-ctl-f="n3"]');
  await page.fill('[data-ctl-label="B"]', 'run'); await page.dispatchEvent('[data-ctl-label="B"]', 'change');
  await page.$eval('[data-ctl-f="size"]', e => { e.value = '1.25'; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); });
  await page.$eval('[data-ctl-f="opacity"]', e => { e.value = '0.8'; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); });
  await page.uncheck('[data-ctl-f="keys"]');
  await click(page, '[data-ctl-f="save"]');
  const t1 = await blockText(page, 'controls', 'pad');
  check(T + 'controls: d-pad, three buttons, a label, size, opacity, keys off are written', t1 === 'controls pad: dpad right, buttons A "jump" B "run" C, size 1.25, opacity 0.8, keys off', t1);
  const comp = await page.evaluate(() => { try { const r = compile(_projText().replace(/map cave:[\s\S]*?weather rain\n/, '')); return r.errors.join(' | ') || 'OK'; } catch (e) { return e.message; } });
  check(T + 'controls: the program still compiles', comp === 'OK', comp);
  // test mode: the values follow the fingers
  await click(page, '[data-ctl-f="test"]');
  const d = await page.$eval('[data-ctl-f="phone"] [data-ctl="dpad"]', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 }; });
  const a = await page.$eval('[data-ctl-f="phone"] [data-ctl="A"]', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  let rd;
  if (phone) {
    const cdp = page.__cdp || (page.__cdp = await page.context().newCDPSession(page));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: d.x - d.r * 0.8, y: d.y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: d.x - d.r * 0.8, y: d.y, id: 1 }, { x: a.x, y: a.y, id: 2 }] });
    await page.waitForTimeout(150);
    rd = await page.$eval('[data-ctl-f="read"]', e => [e.getAttribute('data-x'), e.getAttribute('data-y'), e.getAttribute('data-pressed'), e.getAttribute('data-just')]);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.waitForTimeout(150);
    rd = await page.$eval('[data-ctl-f="read"]', e => [e.getAttribute('data-x'), e.getAttribute('data-y'), e.getAttribute('data-pressed'), e.getAttribute('data-just')]);
    await page.mouse.up();
    await page.mouse.move(d.x - d.r * 0.8, d.y); await page.mouse.down(); await page.waitForTimeout(150);
    rd[0] = await page.getAttribute('[data-ctl-f="read"]', 'data-x');
    await page.mouse.up();
  }
  check(T + 'controls test mode: stickX / pressed / justPressed follow the pointer(s)', rd[0] === '-1.000' && rd[1] === '0.000' && (phone ? rd[2] === 'A' : rd[2] === 'A') && JSON.parse(rd[3]).A === 1, JSON.stringify(rd));
  await page.waitForTimeout(100);
  const after = await page.$eval('[data-ctl-f="read"]', e => [e.getAttribute('data-x'), e.getAttribute('data-pressed'), JSON.parse(e.getAttribute('data-just')).A]);
  check(T + 'controls test mode: released → 0, nothing pressed, still one press counted', after[0] === '0.000' && after[1] === '' && after[2] === 1, JSON.stringify(after));
  await click(page, '[data-ctl-f="test"]');
  const ov = await page.evaluate(() => { const s = document.querySelector('#drawer .drw'), bd = document.getElementById('drawerBody'), R = s.getBoundingClientRect(); return { sheet: bd.scrollWidth, cw: bd.clientWidth, wide: [...s.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > R.left + s.clientWidth + 1).map(e => e.tagName + '[' + (e.getAttribute('data-ctl-f') || e.getAttribute('data-ctl') || '') + ']').slice(0, 5) }; });
  check(T + 'controls: no horizontal overflow', ov.sheet <= ov.cw && !ov.wide.length, JSON.stringify(ov));
  check(T + 'controls: no page errors', !page.errors.length, page.errors.join(' | '));
  await page.context().close();
}

(async () => {
  const args = process.argv.slice(2);
  const file = path.resolve(args[0] && /\.html$/.test(args[0]) ? args.shift() : path.join(__dirname, '..', 'emit-ide-1_32.html'));
  const modes = args.length ? args : ['phone', 'desk'];
  const browser = await chromium.launch();
  for (const mode of modes) {
    await stageChecks(browser, 'file://' + file, mode === 'phone');
    await controlsChecks(browser, 'file://' + file, mode === 'phone');
  }
  await browser.close();
  console.log('\n' + passed + '/' + (passed + failed) + ' stage tool checks passed');
  process.exit(failed ? 1 : 0);
})();

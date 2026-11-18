#!/usr/bin/env node
// The guided tutorial of an Emit IDE build (welcome → 12 steps → a small Coin Dash), in headless Chromium:
//   PHONE (360 px, touch): started from the welcome overlay; step 2's question (download / replace / cancel);
//     the Sprite (hero and coin), Sound, Stage and Controls steps done with the real tools (synthesized pointer /
//     touch events), Things and Rules with "Do it for me", Run with the real ▶, Rewind with the real Timeline
//     slider and ⟲, Look inside by editing the text by hand; each check fails before its action and passes after;
//     Back / Next / collapse (▾, pill, Escape) / resume after a reload / Skip and resume from Help / restart;
//     the highlight follows the element to tap into the drawer and stays on screen; the panel never covers
//     the element to tap or the drawer's Save bar; buttons ≥ 40 px; no horizontal overflow.
//   DESKTOP: started from Help; every step done with "Do it for me" (check fails before, passes after);
//     a floating card that avoids the target and the drawer's header and footer; the drawer card; Escape.
//   SKIPPING: "Do it for me" on the Rules step of an empty project does every step it needs.
//   NO STORAGE: localStorage throws (as on content://): no errors, the tutorial just restarts.
//   THE GAME: the final project compiles, runs, the keys move the hero, a coin pickup adds to the score.
// Offline: every network request is aborted. AudioContext is replaced by tests/fake-audio.js (a recorder).
//
//   node tests/run-tutorial.js [path/to/emit-ide.html]      SHOT=1 also writes tests/tutorial-phone.png
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const FAKE_AUDIO = require('./fake-audio.js');

let failed = 0, passed = 0;
function check(label, ok, detail) {
  if (ok) { passed++; console.log('PASS  ' + label); }
  else { failed++; console.log('FAIL  ' + label + (detail !== undefined ? '\n      ' + String(detail).slice(0, 900) : '')); }
}
const PHONE = { viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true };
const DESK = { viewport: { width: 1200, height: 800 } };
const NO_STORAGE = `Object.defineProperty(window, 'localStorage', { configurable: true, get: function () { throw new Error('SecurityError: storage is not available'); } });`;

async function openIde(browser, fileUrl, mode, opts = {}) {
  const ctx = await browser.newContext(mode);
  await ctx.addInitScript(FAKE_AUDIO);
  if (opts.noStorage) await ctx.addInitScript(NO_STORAGE);
  const page = await ctx.newPage();
  page.errors = []; page.dialogs = [];
  page.on('pageerror', e => page.errors.push(e.message.slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push('console: ' + m.text().slice(0, 300)); });
  page.on('dialog', d => { page.dialogs.push(d.message()); d.accept(); });
  await page.route(/^https?:/, r => r.abort());
  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof compileAndRun === 'function' && typeof _tut === 'object' && typeof _drawerOpen === 'function');
  await page.waitForTimeout(200);
  return page;
}
const isPhone = page => !!(page.context()._options && page.context()._options.hasTouch);
const tap = async (page, sel) => { if (isPhone(page)) await page.tap(sel); else await page.click(sel); await page.waitForTimeout(60); };
// let the tutorial look again (its 300 ms tick) and place the panel and the highlight (next animation frames)
const settle = async page => { await page.evaluate(() => _tut.tick()); await page.waitForTimeout(140); };
const S = page => page.evaluate(() => { const c = _tut.check(); return { i: _tut.state.i, on: _tut.running(), ok: c.ok, later: !!c.later, msg: c.msg, say: _tut.state.tgtSay }; });
const doIt = async page => { const mode = await page.evaluate(() => document.getElementById('tutCoach').getAttribute('data-mode')); await tap(page, mode === 'mini' ? '#tutCoach .tut-mdo' : '#tutCoach .tut-do'); await page.waitForFunction(() => !_tut.state.busy, null, { timeout: 8000 }); await page.waitForTimeout(150); await settle(page); };
const next = async page => {
  const mode = await page.evaluate(() => document.getElementById('tutCoach').getAttribute('data-mode'));
  await tap(page, mode === 'mini' ? '#tutCoach .tut-mnext' : '#tutCoach .tut-next');
  await settle(page);
};
// geometry of the panel, the highlight, the element to tap and the drawer's Save bar
const geo = page => page.evaluate(() => {
  const R = e => { if (!e || !e.isConnected) return null; const r = e.getBoundingClientRect(); return r.width || r.height ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
  const c = document.getElementById('tutCoach'), hi = document.getElementById('tutHi'), t = _tut.target(), open = _drawerIsOpen();
  const vis = r => r && { l: Math.max(0, r.l), t: Math.max(0, r.t), r: Math.min(innerWidth, r.r), b: Math.min(innerHeight, r.b) };
  let tv = vis(R(t));
  // the part of the target that its scroll boxes show
  for (let p = t && t.parentElement; tv && p && p !== document.body; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.overflowY !== 'visible' || cs.overflowX !== 'visible') { const pr = R(p); if (pr) tv = { l: Math.max(tv.l, pr.l), t: Math.max(tv.t, pr.t), r: Math.min(tv.r, pr.r), b: Math.min(tv.b, pr.b) }; } if (cs.position === 'fixed') break; }
  if (tv && (tv.r - tv.l < 1 || tv.b - tv.t < 1)) tv = null;
  return {
    mode: c && c.getAttribute('data-mode'), coach: R(c), hi: hi && hi.style.display !== 'none' ? R(hi) : null,
    tgt: R(t), tvis: tv, tIn: !!(t && c && c.contains(t)), tName: t ? (t.className || t.tagName) + '' : null,
    foot: open ? R(document.getElementById('drawerFoot')) : null, head: open ? R(document.querySelector('#drawer .drw-hd')) : null,
    vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, csw: c ? c.scrollWidth - c.clientWidth : 0,
    small: c ? [...c.querySelectorAll('button')].filter(b => { const r = b.getBoundingClientRect(); return r.width && (r.width < 40 || r.height < 40); }).map(b => b.className + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height)) : [],
  };
});
const over = (a, b) => !!(a && b && Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5);
const encloses = (a, b) => !!(a && b && a.l <= b.l + 0.5 && a.t <= b.t + 0.5 && a.r >= b.r - 0.5 && a.b >= b.b - 0.5);
// the layout rules that hold at every moment: the panel on screen, covering neither the element to tap nor the
// drawer's Save bar or header; the highlight on screen and around what is visible of the target; no overflow
async function layout(page, T, label) {
  await settle(page);
  const g = await geo(page), bad = [];
  if (!g.coach) bad.push('no panel');
  else {
    if (g.coach.l < -0.5 || g.coach.t < -0.5 || g.coach.r > g.vw + 0.5 || g.coach.b > g.vh + 0.5) bad.push('panel off screen ' + JSON.stringify(g.coach));
    if (g.tvis && !g.tIn && over(g.coach, g.tvis)) bad.push('panel covers the target ' + g.tName);
    if (g.foot && over(g.coach, g.foot)) bad.push('panel covers the drawer footer (Save)');
    if (g.head && over(g.coach, g.head)) bad.push('panel covers the drawer header');
  }
  if (g.hi && (g.hi.l < -0.5 || g.hi.t < -0.5 || g.hi.r > g.vw + 0.5 || g.hi.b > g.vh + 0.5)) bad.push('highlight off screen ' + JSON.stringify(g.hi));
  if (g.tvis && !g.tIn && !g.hi) bad.push('no highlight for the visible target ' + g.tName);
  if (g.tvis && !g.tIn && g.hi && !encloses(g.hi, g.tvis)) bad.push('the highlight does not surround the target ' + g.tName + ' ' + JSON.stringify([g.hi, g.tvis]));
  if (!g.tvis && g.hi) bad.push('highlight shown without a visible target');
  if (g.sw > g.vw) bad.push('horizontal overflow ' + g.sw);
  if (g.csw > 0) bad.push('the panel scrolls sideways');
  if (g.coach && g.mode !== 'pill' && g.small.length) bad.push('small buttons ' + g.small.join(', '));
  check(T + 'layout — ' + label, !bad.length, bad.join(' | ') + ' ' + JSON.stringify({ mode: g.mode, coach: g.coach, tgt: g.tName }));
  return g;
}
// a stroke over sprite cells, with synthesized pointer events (touch on the phone)
const sprStroke = (page, cells, type) => page.evaluate(({ cells, type }) => {
  const api = document.querySelector('#drawer .spt')._spt, cv = document.querySelector('#drawer .spt-stage canvas'), r = cv.getBoundingClientRect(), v = api.view();
  const at = c => ({ x: r.left + v.ox + (c[0] + 0.5) * v.zoom, y: r.top + v.oy + (c[1] + 0.5) * v.zoom });
  const ev = (t, p) => cv.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 7, pointerType: type, isPrimary: true, button: t === 'pointermove' ? -1 : 0, buttons: t === 'pointerup' ? 0 : 1, clientX: p.x, clientY: p.y }));
  ev('pointerdown', at(cells[0])); for (let i = 1; i < cells.length; i++) ev('pointermove', at(cells[i])); ev('pointerup', at(cells[cells.length - 1]));
}, { cells, type });
// a tap on a tile of the Stage view: a real touch (CDP) on the phone, the mouse on the desktop
async function stageTap(page, tx, ty) {
  await page.$eval('#drawer [data-stg="view"]', e => { const r = e.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) e.scrollIntoView({ block: 'center' }); });
  const p = await page.evaluate(([x, y]) => document.querySelector('#drawer [data-stage-tool]')._stageApi.screen(x, y), [tx, ty]);
  if (isPhone(page)) {
    const cdp = page.__cdp || (page.__cdp = await page.context().newCDPSession(page));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else { await page.mouse.click(p.x, p.y); }
  await page.waitForTimeout(60);
}
// the running game: score, live coins, the hero's position; a coin pickup by putting the hero on a coin
const game = page => page.evaluate(() => {
  const R = n => _emitRegions().find(x => x.name === n);
  const H = R('hero'), C = R('coin'); if (!H || !C) return null;
  let alive = 0; for (let i = 0; i < C.length; i++) if (_emitRegionRead(C.id, i, 'alive')) alive++;
  return { score: _lgShows[0], alive, x: Number(_emitRegionRead(H.id, 0, 'x')), y: Number(_emitRegionRead(H.id, 0, 'y')), say: _lgSay, controls: !!document.querySelector('#tab-output [data-emit-controls] [data-ctl="stick"]'), canvas: !!document.querySelector('#tab-output canvas') };
});
async function gameChecks(page, T) {
  await page.waitForTimeout(300);
  let g0 = await game(page);
  check(T + 'the final game runs: a canvas, the on-screen stick, the score shown (0), coins alive', g0 && g0.canvas && g0.controls && g0.score === 0 && g0.alive >= 3, JSON.stringify(g0));
  // the keys move the hero (arrow right, as the stick would)
  await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(350); await page.keyboard.up('ArrowRight'); await page.waitForTimeout(80);
  const g1 = await game(page);
  check(T + 'the controls move the hero (arrow key → stickX → hero mv)', g1 && g1.x > g0.x + 8, JSON.stringify([g0, g1]));
  // a coin pickup: the hero put on a live coin
  const s = await page.evaluate(async () => {
    const H = _emitRegions().find(x => x.name === 'hero'), C = _emitRegions().find(x => x.name === 'coin');
    let k = 0; while (k < C.length && !_emitRegionRead(C.id, k, 'alive')) k++;
    _emitRegionWrite(H.id, 0, 'x', Number(_emitRegionRead(C.id, k, 'x'))); _emitRegionWrite(H.id, 0, 'y', Number(_emitRegionRead(C.id, k, 'y')));
    await new Promise(r => setTimeout(r, 250));
    return true;
  });
  const g2 = await game(page);
  check(T + 'a coin pickup adds 1 to the score and removes the coin (the sound rule ran: no error)', s && g2.score === g1.score + 1 && g2.alive === g1.alive - 1, JSON.stringify([g1, g2]));
}

(async () => {
  const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'emit-ide-1_32.html'));
  const fileUrl = 'file://' + file;
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  let page, s, g, r;

  // ═════════════════════════════ PHONE (360 px, touch) ═════════════════════════════
  {
    const T = '[phone] ';
    page = await openIde(browser, fileUrl, PHONE);
    r = await page.evaluate(() => { const w = document.getElementById('welcomeOverlay'), b = document.getElementById('tutWelcome'), br = b && b.getBoundingClientRect(); return { shown: w.classList.contains('show'), txt: b && b.textContent, h: br && br.height, re: getComputedStyle(document.getElementById('tutWelcomeRe')).display }; });
    check(T + 'the welcome overlay has "Start the tutorial" (≥ 44 px), no restart link without progress', r.shown && /Start the tutorial/.test(r.txt) && r.h >= 44 && r.re === 'none', JSON.stringify(r));
    // a program with work in it, to be asked about at step 2
    await page.evaluate(() => { _projLoad('// mine\nexport fn mine() {\n  print(7)\n}\n'); });
    await tap(page, '#tutWelcome');
    await settle(page);
    s = await S(page);
    g = await geo(page);
    check(T + 'the tutorial starts at step 1/12; the welcome overlay closes', s.on && s.i === 0 && await page.evaluate(() => !document.getElementById('welcomeOverlay').classList.contains('show') && /Step 1\/12/.test(document.querySelector('#tutCoach .tut-n').textContent)), JSON.stringify(s));
    check(T + 'a bottom sheet: full width, at the bottom', g.mode === 'full' && Math.round(g.coach.l) === 0 && Math.round(g.coach.r) === 360 && Math.round(g.coach.b) === 740, JSON.stringify(g.coach));
    r = await page.evaluate(() => ({ live: document.querySelector('#tutCoach [aria-live="polite"]') && document.querySelector('#tutCoach [aria-live="polite"]').textContent, back: document.querySelector('#tutCoach .tut-back').disabled, next: document.querySelector('#tutCoach .tut-next').disabled, focusable: [...document.querySelectorAll('#tutCoach button')].every(b => b.tabIndex >= 0) }));
    check(T + 'step text in an aria-live region; Back disabled on step 1, Next enabled (read-only step); buttons focusable', /Coin Dash/.test(r.live) && r.back && !r.next && r.focusable, JSON.stringify(r));
    await layout(page, T, 'step 1');
    await next(page);
    // ── step 2: a new project, with the question ──
    s = await S(page);
    check(T + 'step 2 (new project): the check fails while the old program is there', s.i === 1 && !s.ok && await page.evaluate(() => document.querySelector('#tutCoach .tut-next').disabled), JSON.stringify(s));
    await layout(page, T, 'step 2, the button in the panel');
    await tap(page, '#tutCoach .tut-new');
    r = await page.evaluate(() => [...document.querySelectorAll('#tutCoach .tut-x button')].map(b => b.textContent));
    check(T + 'step 2: the program has work in it → download / replace / cancel', JSON.stringify(r) === JSON.stringify(['Download it, then start', 'Replace it', 'Cancel']), JSON.stringify(r));
    await tap(page, '#tutCoach .tut-cancel');
    check(T + 'step 2: Cancel keeps the program (check still fails)', !(await S(page)).ok && await page.evaluate(() => _projText().indexOf('export fn mine()') >= 0));
    await page.evaluate(() => { window.__dl = []; window._download = (n, c) => window.__dl.push([n, c]); });
    await tap(page, '#tutCoach .tut-new');
    await tap(page, '#tutCoach .tut-dl');
    await settle(page);
    r = await page.evaluate(() => ({ dl: window.__dl, files: _proj.files.map(f => f.path), text: _projText() }));
    s = await S(page);
    check(T + 'step 2: "Download it, then start" downloads the old program and starts the new project → check passes', s.ok && r.dl.length === 1 && /export fn mine\(\)/.test(r.dl[0][1]) && /\.emit$/.test(r.dl[0][0]) && r.text === await page.evaluate(() => _tut.START) && JSON.stringify(r.files) === '["main.emit"]', JSON.stringify([s, r]));
    await next(page);

    // ── step 3: the hero, with the real Sprite tool ──
    s = await S(page);
    check(T + 'step 3 (hero): the check fails before', s.i === 2 && !s.ok, JSON.stringify(s));
    g = await layout(page, T, 'step 3: 🧰 is the target');
    check(T + 'step 3: the highlight is on 🧰', /hdr-btn/.test(g.tName) && encloses(g.hi, g.tgt), JSON.stringify(g));
    await tap(page, '.header .hdr-btn[title="Drawer"]');
    g = await layout(page, T, 'step 3: the drawer list, the Sprite card is the target');
    check(T + 'step 3: the highlight follows into the drawer (Sprite card); the panel is a one-line strip while the drawer is open', g.tName === 'drw-card' && encloses(g.hi, g.tgt) && g.mode === 'mini', JSON.stringify(g));
    await tap(page, '#drawer .drw-card[data-tool="sprite"]');
    g = await layout(page, T, 'step 3: the name box');
    check(T + 'step 3: target = the sprite name box', /spt-name/.test(g.tName), g.tName);
    await page.fill('#drawer .spt input[aria-label="Sprite name"]', 'hero');
    await page.dispatchEvent('#drawer .spt input[aria-label="Sprite name"]', 'change');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    g = await layout(page, T, 'step 3: the painting canvas');
    check(T + 'step 3: target = the painting canvas', g.tName === 'CANVAS', g.tName);
    await sprStroke(page, [[2, 2], [3, 2], [4, 2], [4, 3], [4, 4]], 'touch');
    await settle(page);
    check(T + 'step 3: painted but not saved → the check still fails (it reads the program, not the taps)', !(await S(page)).ok);
    g = await layout(page, T, 'step 3: Save in the footer');
    check(T + 'step 3: target = Save, highlighted in the footer; the panel avoids it', /spt-save/.test(g.tName) && encloses(g.hi, g.tgt) && !over(g.coach, g.tgt), JSON.stringify(g));
    if (process.env.SHOT) await page.screenshot({ path: path.join(__dirname, 'tutorial-phone.png') });
    await tap(page, '#drawer .spt-save');
    await settle(page);
    s = await S(page);
    check(T + 'step 3: after Save the check passes (sprite hero, 5 pixels)', s.ok && /hero/.test(s.msg) && /5 pixels/.test(s.msg), JSON.stringify(s));
    // Back and Next
    await tap(page, '#tutCoach .tut-mini .tut-exp');
    await settle(page);
    check(T + '▴ shows the whole step while the drawer is open', (await geo(page)).mode === 'full');
    await tap(page, '#tutCoach .tut-back');
    s = await S(page);
    check(T + 'Back goes to step 2 (still done)', s.i === 1 && s.ok, JSON.stringify(s));
    await next(page);
    await next(page);
    // ── step 4: the coin ──
    s = await S(page);
    check(T + 'step 4 (coin): the check fails before', s.i === 3 && !s.ok, JSON.stringify(s));
    g = await layout(page, T, 'step 4: the sprite list');
    check(T + 'step 4: target = the sprite list ("New sprite…")', g.tName === 'SELECT', g.tName);
    await page.selectOption('#drawer .spt select', '\u0000new');
    await page.fill('#drawer .spt input[aria-label="Sprite name"]', 'coin');
    await page.dispatchEvent('#drawer .spt input[aria-label="Sprite name"]', 'change');
    await sprStroke(page, [[6, 6], [7, 6], [7, 7], [6, 7]], 'touch');
    await layout(page, T, 'step 4: Save');
    await tap(page, '#drawer .spt-save');
    await settle(page);
    s = await S(page);
    check(T + 'step 4: after Save the check passes (two sprites)', s.ok && /hero and coin/.test(s.msg), JSON.stringify(s));
    await next(page);
    // ── step 5: the sound, with the real Sound tool ──
    s = await S(page);
    check(T + 'step 5 (sound): the check fails before', s.i === 4 && !s.ok, JSON.stringify(s));
    g = await layout(page, T, 'step 5: ‹ back to the list');
    check(T + 'step 5: target = ‹ (another tool is open)', /drw-back/.test(g.tName), g.tName);
    await tap(page, '#drawer .drw-back');
    await tap(page, '#drawer .drw-card[data-tool="sound"]');
    g = await layout(page, T, 'step 5: the coin preset');
    check(T + 'step 5: target = the coin preset', g.tName && /drw-sm/.test(g.tName), g.tName);
    await page.evaluate(() => { [...document.querySelectorAll('#drawer .drw-sm')].find(b => b.textContent === 'coin').scrollIntoView({ block: 'center' }); });
    await page.evaluate(() => [...document.querySelectorAll('#drawer .drw-sm')].find(b => b.textContent === 'coin').click());
    await layout(page, T, 'step 5: Save to program');
    await tap(page, '#drawerFoot .drw-pri');
    await settle(page);
    s = await S(page);
    check(T + 'step 5: after Save the check passes', s.ok && /sound coin/.test(s.msg), JSON.stringify(s));
    // collapse, the pill, Escape, resume after a reload
    await tap(page, '#tutCoach .tut-mini .tut-ib:last-child');
    g = await layout(page, T, 'collapsed to the pill');
    r = await page.evaluate(() => document.querySelector('#tutCoach .tut-pill').textContent);
    check(T + '▾ folds the panel into a "Step 5/12" pill (≥ 40 px, ✓ when done), clear of the Save bar', g.mode === 'pill' && /^Step 5\/12/.test(r) && g.coach.b - g.coach.t >= 40 && !over(g.coach, g.foot), r + JSON.stringify(g.coach));
    await tap(page, '#tutCoach .tut-pill');
    check(T + 'tapping the pill opens the step again', (await geo(page)).mode !== 'pill');
    await page.focus('#tutCoach .tut-do').catch(() => {});
    await page.evaluate(() => document.querySelector('#tutCoach .tut-mnext') && document.querySelector('#tutCoach .tut-mnext').focus());
    await page.keyboard.press('Escape');
    await settle(page);
    check(T + 'Escape (focus in the panel) folds it into the pill and leaves the drawer open', (await geo(page)).mode === 'pill' && await page.evaluate(() => _drawerIsOpen()));
    await page.reload();
    await page.waitForFunction(() => typeof _tut === 'object' && _tut.running(), null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    s = await S(page);
    g = await geo(page);
    check(T + 'after a reload the tutorial resumes on step 5, folded as it was, with the project restored', s.on && s.i === 4 && s.ok && g.mode === 'pill' && await page.evaluate(() => _drawerBlocks('sprite').length === 2), JSON.stringify([s, g.mode]));
    await tap(page, '#tutCoach .tut-pill');
    await next(page);
    // ── step 6: the level, with the real Stage tool ──
    s = await S(page);
    check(T + 'step 6 (level): the check fails before', s.i === 5 && !s.ok, JSON.stringify(s));
    await layout(page, T, 'step 6: 🧰');
    await tap(page, '.header .hdr-btn[title="Drawer"]');
    await tap(page, '#drawer .drw-card[data-tool="stage"]');
    await page.waitForSelector('#drawer [data-stage-tool] [data-stg="view"]');
    g = await layout(page, T, 'step 6: ◆ objects');
    check(T + 'step 6: target = ◆ objects', /objects/.test(await page.evaluate(() => _tut.target() && _tut.target().getAttribute('data-tool'))), g.tName);
    await tap(page, '#drawer [data-tool="objects"]');
    g = await layout(page, T, 'step 6: the map view');
    check(T + 'step 6: target = the map view (tap the floor)', await page.evaluate(() => _tut.target() && _tut.target().getAttribute('data-stg') === 'view'), g.tName);
    await stageTap(page, 4, 3); await stageTap(page, 9, 6); await stageTap(page, 12, 9);
    r = await page.evaluate(() => document.querySelector('#drawer [data-stage-tool]')._stageApi.model().objects.map(o => o.kind + ' ' + o.x + ',' + o.y));
    check(T + 'step 6: three coins placed with touches', JSON.stringify(r) === JSON.stringify(['hero 1,1', 'coin 4,3', 'coin 9,6', 'coin 12,9']), JSON.stringify(r));
    s = await S(page);
    check(T + 'step 6: placed but not saved → the check still fails', !s.ok, JSON.stringify(s));
    g = await layout(page, T, 'step 6: Save');
    check(T + 'step 6: target = Save', await page.evaluate(() => _tut.target() && _tut.target().getAttribute('data-stg') === 'save'), g.tName);
    await tap(page, '#drawer [data-stg="save"]');
    await settle(page);
    s = await S(page);
    check(T + 'step 6: after Save the check passes (walls, hero, 3 coins)', s.ok && /3 coins/.test(s.msg), JSON.stringify(s));
    await next(page);
    // ── step 7: controls, with the real Controls tool ──
    s = await S(page);
    check(T + 'step 7 (controls): the check fails before', s.i === 6 && !s.ok, JSON.stringify(s));
    await tap(page, '#drawer .drw-back');
    await tap(page, '#drawer .drw-card[data-tool="controls"]');
    g = await layout(page, T, 'step 7: one button');
    check(T + 'step 7: target = "1" (one button)', await page.evaluate(() => _tut.target() && _tut.target().getAttribute('data-ctl-f') === 'n1'), g.tName);
    await tap(page, '#drawer [data-ctl-f="n1"]');
    await layout(page, T, 'step 7: Save');
    await tap(page, '#drawer [data-ctl-f="save"]');
    await settle(page);
    s = await S(page);
    check(T + 'step 7: after Save the check passes', s.ok && /stick and button A/.test(s.msg), JSON.stringify(s));
    await next(page);
    // ── step 8: things (the real Logic tool opens; Do it for me fills it) ──
    s = await S(page);
    check(T + 'step 8 (things): the check fails before', s.i === 7 && !s.ok, JSON.stringify(s));
    await tap(page, '#drawer .drw-back');
    await tap(page, '#drawer .drw-card[data-tool="logic"]');
    g = await layout(page, T, 'step 8: + thing');
    check(T + 'step 8: target = + thing', /lg-add-kind/.test(g.tName), g.tName);
    await doIt(page);
    s = await S(page);
    r = await page.evaluate(() => [_drawerRead('thing', 'hero'), _drawerRead('thing', 'coin'), _drawer.tool && _drawer.tool.id, _lgTool.state.things.map(t => t.name).join()]);
    check(T + 'step 8: Do it for me writes thing hero / thing coin (sprite, from map level1) → passes; the open Logic tool shows them', s.ok && r[0] === 'thing hero: sprite hero, from map level1, speed 2' && r[1] === 'thing coin: sprite coin, from map level1' && r[2] === 'logic' && r[3] === 'hero,coin', JSON.stringify([s, r]));
    await layout(page, T, 'step 8 done');
    await next(page);
    // ── step 9: rules ──
    s = await S(page);
    check(T + 'step 9 (rules): the check fails before and names what is missing', s.i === 8 && !s.ok && /No rules/.test(s.msg), JSON.stringify(s));
    g = await layout(page, T, 'step 9: RULES tab');
    check(T + 'step 9: target = the RULES tab', await page.evaluate(() => _tut.target() && _tut.target().getAttribute('data-tab') === 'rules'), g.tName);
    await doIt(page);
    s = await S(page);
    check(T + 'step 9: Do it for me writes the rules → passes (the program compiles)', s.ok && /compiles/.test(s.msg), JSON.stringify(s));
    await next(page);
    // ── step 10: run, with the real ▶ ──
    s = await S(page);
    g = await layout(page, T, 'step 10: close the drawer');
    check(T + 'step 10 (run): fails before; the target is ✕ while the drawer is open', s.i === 9 && !s.ok && /drw-x/.test(g.tName), JSON.stringify([s, g.tName]));
    await tap(page, '#drawer .drw-x');
    g = await layout(page, T, 'step 10: ▶');
    check(T + 'step 10: target = ▶', /run/.test(g.tName), g.tName);
    await tap(page, '.header .hdr-btn.run');
    await page.waitForTimeout(700);
    await settle(page);
    s = await S(page);
    check(T + 'step 10: after ▶ the check passes (frame() ran, score shown)', s.ok && /frame\(\) has run/.test(s.msg), JSON.stringify(s));
    if (await page.evaluate(() => /off-r/.test(document.getElementById('pnl-run').className))) await tap(page, '.vtab[data-v="run"]');
    g = await layout(page, T, 'step 10: playing');
    r = await page.evaluate(() => { const e = document.querySelector('#tab-output [data-emit-controls]'); const b = e && e.getBoundingClientRect(); return b && { l: b.left, t: b.top, r: b.right, b: b.bottom }; });
    check(T + 'step 10: the panel does not cover the game\'s on-screen controls', r && !over(g.coach, { l: r.l, t: Math.max(0, r.t), r: r.r, b: Math.min(740, r.b) }), JSON.stringify([g.coach, r]));
    await gameChecks(page, T);
    await next(page);
    // ── step 11: rewind, with the real Timeline ──
    s = await S(page);
    check(T + 'step 11 (rewind): the check fails before', s.i === 10 && !s.ok && !s.later, JSON.stringify(s));
    g = await layout(page, T, 'step 11: the slider');
    check(T + 'step 11: target = the Timeline slider; the panel leaves the Timeline bar free', /tl-slider/.test(g.tName) && !over(g.coach, await page.evaluate(() => { const b = document.getElementById('tlBar').getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; })), g.tName);
    await page.$eval('#tlBar .tl-slider', e => { e.value = String(Math.max(0, +e.max - 25)); e.dispatchEvent(new Event('input', { bubbles: true })); });
    await settle(page);
    s = await S(page);
    g = await layout(page, T, 'step 11: ⟲ resume');
    check(T + 'step 11: scrubbed back but not resumed → still fails; target = ⟲ resume from here', !s.ok && await page.evaluate(() => _tut.target() && _tut.target().getAttribute('data-tl') === 'resume'), JSON.stringify(s));
    await tap(page, '#tlBar [data-tl="resume"]');
    await settle(page);
    s = await S(page);
    check(T + 'step 11: after ⟲ the check passes', s.ok, JSON.stringify(s));
    await next(page);
    // ── step 12: look inside — edit the speed by hand, run again ──
    s = await S(page);
    check(T + 'step 12 (look inside): fails before; "Finish" instead of Next', s.i === 11 && !s.ok && await page.evaluate(() => /Finish/.test(document.querySelector('#tutCoach .tut-next').textContent)), JSON.stringify(s));
    g = await layout(page, T, 'step 12: Editor');
    if (/vtab/.test(g.tName)) await tap(page, '.vtab[data-v="edit"]');
    g = await layout(page, T, 'step 12: the game.emit tab');
    check(T + 'step 12: target = the game.emit tab', await page.evaluate(() => _tut.target() && _tut.target().classList.contains('ftab') && _proj.files[+_tut.target().getAttribute('data-i')].path === 'game.emit'), g.tName);
    await tap(page, '#fileTabs .ftab[data-i="' + await page.evaluate(() => _projFind('game.emit')) + '"]');
    await page.evaluate(() => { const ed = document.getElementById('editor'), p = ed.value.indexOf('speed 2'); ed.focus(); ed.setSelectionRange(p + 6, p + 7); });
    await page.keyboard.insertText('3');
    await page.evaluate(() => document.activeElement.blur());
    await settle(page);
    s = await S(page);
    check(T + 'step 12: edited but not run → still fails, asks for ▶', !s.ok && /run it again/.test(s.msg), JSON.stringify(s));
    await layout(page, T, 'step 12: ▶');
    await tap(page, '.header .hdr-btn.run');
    await page.waitForTimeout(500);
    await settle(page);
    s = await S(page);
    check(T + 'step 12: after ▶ the check passes (speed 3)', s.ok && /speed 3/.test(s.msg), JSON.stringify(s));
    r = await page.evaluate(() => document.querySelector('#tutCoach .tut-more') && document.querySelector('#tutCoach .tut-more').textContent);
    check(T + 'step 12 points to sharing, the offline export and where next (examples, help, Mote scripts)', /🔗/.test(r) && /offline/.test(r) && /Example/.test(r) && /Help/.test(r) && /Script/.test(r), r);
    const finalText = await page.evaluate(() => _projText());
    await next(page);
    r = await page.evaluate(() => ({ on: _tut.running(), coach: !!document.getElementById('tutCoach'), hi: document.getElementById('tutHi').style.display, ls: JSON.parse(localStorage.getItem('emit-tutorial')) }));
    check(T + 'Finish closes the tutorial and remembers it is done', !r.on && !r.coach && r.hi === 'none' && r.ls.done === true, JSON.stringify(r));
    const errs = await page.evaluate(t => compile(t, 'wasm32').errors, finalText);
    check(T + 'the project made with the real tools compiles', errs.length === 0, JSON.stringify(errs));
    // restart from Help
    await page.evaluate(() => toggleHelp());
    r = await page.evaluate(() => { const h = document.getElementById('tutHelp'), hc = document.querySelector('#helpOverlay .help-content'), kids = [...hc.children]; const i = kids.indexOf(h); const sec = document.getElementById('help-tutorial'); let t = ''; for (let n = sec && sec.nextElementSibling; n && n.tagName !== 'H2'; n = n.nextElementSibling) t += n.textContent; return { i, txt: h && h.textContent, t, go: document.getElementById('tutHelpGo').textContent }; });
    check(T + 'Help: the tutorial link is at the top (after the intro) and a "Tutorial" section says how to start, resume and restart', r.i > 0 && r.i <= 3 && /Start the tutorial/.test(r.go) && /Restart/.test(r.txt) && /resume/i.test(r.t) && /Restart/.test(r.t) && /content:\/\//.test(r.t), JSON.stringify(r));
    await tap(page, '#tutHelp button:nth-of-type(2)');
    s = await S(page);
    check(T + 'Help → Restart begins at step 1 and closes Help', s.on && s.i === 0 && await page.evaluate(() => !document.getElementById('helpOverlay').classList.contains('show')), JSON.stringify(s));
    // skip, then resume from the drawer card
    await next(page); await next(page);
    await tap(page, '#tutCoach .tut-skip');
    r = await page.evaluate(() => ({ on: _tut.running(), ls: JSON.parse(localStorage.getItem('emit-tutorial')) }));
    check(T + 'Skip tutorial stops it and keeps the step for later', !r.on && r.ls.active === false && r.ls.i === 2, JSON.stringify(r));
    await tap(page, '.header .hdr-btn[title="Drawer"]');
    r = await page.evaluate(() => { const c = document.querySelector('#drawer .drw-card[data-tool="tutorial"]'); const b = c && c.getBoundingClientRect(); return c && [c.querySelector('.drw-cl').textContent, c.querySelector('.drw-ic').textContent, Math.round(b.height)]; });
    check(T + 'the drawer has a Tutorial card', r && r[0] === 'Tutorial' && r[2] >= 60, JSON.stringify(r));
    await tap(page, '#drawer .drw-card[data-tool="tutorial"]');
    s = await S(page);
    check(T + '🧰 → Tutorial resumes at step 3 and closes the drawer', s.on && s.i === 2 && !(await page.evaluate(() => _drawerIsOpen())), JSON.stringify(s));
    check(T + 'no page errors', !page.errors.length, page.errors.join(' | '));
    await page.context().close();
  }

  // ═════════════════════════════ DESKTOP: every step with "Do it for me" ═════════════════════════════
  {
    const T = '[desk] ';
    page = await openIde(browser, fileUrl, DESK);
    await page.evaluate(() => { closeWelcome(); toggleHelp(); });
    await page.click('#tutHelpGo');
    await settle(page);
    g = await geo(page);
    check(T + 'Help → Start the tutorial: a floating card (not full width) on step 1', (await S(page)).i === 0 && g.mode === 'full' && g.coach.r - g.coach.l <= 400 && g.coach.l > 100 && g.coach.b < 800, JSON.stringify(g.coach));
    await layout(page, T, 'step 1');
    await next(page);
    s = await S(page);
    check(T + 'step 2: the IDE\'s first program is not "work": no question', !s.ok, JSON.stringify(s));
    await doIt(page);
    s = await S(page);
    check(T + 'step 2: Do it for me → a new project → passes', s.ok && await page.evaluate(() => _projText() === _tut.START), JSON.stringify(s));
    await next(page);
    const titles = [];
    for (let i = 2; i < 12; i++) {
      s = await S(page);
      const title = await page.evaluate(() => document.querySelector('#tutCoach .tut-t').textContent);
      titles.push(title);
      // open the tool the step is about, so the highlight and the panel are checked inside the drawer
      const tool = ['sprite', 'sprite', 'sound', 'stage', 'controls', 'logic', 'logic'][i - 2];
      if (tool) { await page.evaluate(id => { if (!_drawerIsOpen() || !_drawer.tool || _drawer.tool.id !== id) { _drawerClose(); _drawerOpen(id); } }, tool); await layout(page, T, 'step ' + (i + 1) + ' (' + title + ') in the ' + tool + ' tool'); }
      else await layout(page, T, 'step ' + (i + 1) + ' (' + title + ')');
      check(T + 'step ' + (i + 1) + ' (' + title + '): the check fails before', s.i === i && !s.ok && !s.later, JSON.stringify(s));
      await doIt(page);
      if (i >= 9) await page.waitForTimeout(400);
      await settle(page);
      s = await S(page);
      check(T + 'step ' + (i + 1) + ' (' + title + '): passes after Do it for me', s.ok, JSON.stringify(s));
      await layout(page, T, 'step ' + (i + 1) + ' done');
      if (i === 9) await gameChecks(page, T);
      if (i < 11) await next(page);
    }
    check(T + 'the twelve steps', JSON.stringify(titles) === JSON.stringify(['Paint the hero', 'Paint a coin', 'A sound', 'The level', 'Controls', 'Things', 'Rules', 'Run it', 'Rewind', 'Look inside']), JSON.stringify(titles));
    const text = await page.evaluate(() => _projText());
    check(T + 'the final project: files, blocks, the hand edit (speed 3) and the rules', /\/\/\/\/ file: sprites\.emit\nsprite hero: 12x12/.test(text) && /sprite coin: 8x8/.test(text) && /\/\/\/\/ file: sounds\.emit\nsound coin: square 988/.test(text) && /\/\/\/\/ file: stages\.emit\nmap level1: 16x12, tile 16/.test(text) && /controls pad: stick left, buttons A/.test(text) && /thing hero: sprite hero, from map level1, speed 3/.test(text) && /on hit hero coin: remove coin : add score 1 : play coin/.test(text) && /when count\(coin\) == 0: say "You win!"/.test(text), text);
    r = await page.evaluate(t => compile(t, 'wasm32').errors, text);
    check(T + 'the final project compiles', r.length === 0, JSON.stringify(r));
    await gameChecks(page, T + '(speed 3) ');
    // the whole game won: every coin collected → "You win!"
    r = await page.evaluate(async () => {
      const H = _emitRegions().find(x => x.name === 'hero'), C = _emitRegions().find(x => x.name === 'coin');
      for (let k = 0; k < C.length; k++) if (_emitRegionRead(C.id, k, 'alive')) { _emitRegionWrite(H.id, 0, 'x', Number(_emitRegionRead(C.id, k, 'x'))); _emitRegionWrite(H.id, 0, 'y', Number(_emitRegionRead(C.id, k, 'y'))); await new Promise(r => setTimeout(r, 120)); }
      await new Promise(r => setTimeout(r, 150));
      return { say: _lgSay, score: _lgShows[0] };
    });
    check(T + 'collecting every coin says "You win!"', r.say === 'You win!' && r.score === 5, JSON.stringify(r));
    // Escape: focus in the drawer → the drawer closes; focus in the panel → the panel folds
    await page.evaluate(() => _drawerOpen('sound'));
    await page.evaluate(() => document.querySelector('#drawer .drw').focus());
    await page.keyboard.press('Escape');
    check(T + 'Escape with the focus in the drawer closes the drawer, the panel stays open', !(await page.evaluate(() => _drawerIsOpen())) && (await geo(page)).mode !== 'pill');
    await page.focus('#tutCoach .tut-next');
    await page.keyboard.press('Escape');
    await settle(page);
    check(T + 'Escape with the focus in the panel folds it into the pill', (await geo(page)).mode === 'pill');
    await page.setViewportSize({ width: 700, height: 600 });
    await page.waitForTimeout(150);
    await layout(page, T, 'after a resize (the pill)');
    check(T + 'no page errors', !page.errors.length, page.errors.join(' | '));
    await page.context().close();
  }

  // ═════════════════════════════ SKIPPING: Do it for me on the Rules step of an empty project ═════════════════════════════
  {
    const T = '[skip] ';
    page = await openIde(browser, fileUrl, PHONE);
    await page.evaluate(() => { closeWelcome(); _tutStart(); _projLoad(_tut.START); _tut.go(8); });
    await settle(page);
    s = await S(page);
    check(T + 'step 9 on a new project fails', s.i === 8 && !s.ok, JSON.stringify(s));
    await doIt(page);
    s = await S(page);
    r = await page.evaluate(() => [1, 2, 3, 4, 5, 6, 7, 8].map(i => _tut.check(i).ok));
    check(T + 'Do it for me also does the earlier steps it needs (sprites, sound, level, controls, things): all their checks pass', s.ok && r.every(Boolean), JSON.stringify([s, r]));
    await next(page);
    await doIt(page);
    await page.waitForTimeout(300);
    s = await S(page);
    check(T + 'step 10 Do it for me runs it', s.ok, JSON.stringify(s));
    await layout(page, T, 'running on the phone');
    await gameChecks(page, T);
    // Do it for me on step 11 right after a reload (nothing recorded yet): it runs the game first
    await page.reload();
    await page.waitForFunction(() => typeof _tut === 'object' && _tut.running());
    await page.evaluate(() => _tut.go(10));
    await doIt(page);
    await page.waitForTimeout(200);
    s = await S(page);
    check(T + 'step 11 Do it for me after a reload: runs, scrubs back and resumes → passes', s.ok, JSON.stringify(s));
    await page.evaluate(() => _tut.go(11));
    await doIt(page);
    await page.waitForTimeout(400);
    s = await S(page);
    check(T + 'step 12 Do it for me → passes', s.ok, JSON.stringify(s));
    check(T + 'no page errors', !page.errors.length, page.errors.join(' | '));
    await page.context().close();
  }

  // ═════════════════════════════ NO STORAGE (localStorage throws, as on content://) ═════════════════════════════
  {
    const T = '[no storage] ';
    page = await openIde(browser, fileUrl, PHONE, { noStorage: true });
    check(T + 'the page loads; localStorage really throws', await page.evaluate(() => { try { localStorage.getItem('x'); return false; } catch (e) { return true; } }));
    await page.evaluate(() => { try { closeWelcome(); } catch (e) {} });
    await page.evaluate(() => _tutStart());
    await next(page);
    await doIt(page);
    await next(page);
    await doIt(page);
    s = await S(page);
    check(T + 'the tutorial runs without storage (steps 2 and 3 done)', s.i === 2 && s.ok, JSON.stringify(s));
    await tap(page, '#tutCoach .tut-col');
    await page.reload();
    await page.waitForFunction(() => typeof _tut === 'object');
    await page.waitForTimeout(400);
    check(T + 'after a reload nothing resumes (nothing could be kept)', !(await page.evaluate(() => _tut.running())));
    await page.evaluate(() => _tutStart());
    s = await S(page);
    check(T + 'starting again begins at step 1', s.on && s.i === 0, JSON.stringify(s));
    check(T + 'no page errors', !page.errors.length, page.errors.join(' | '));
    await page.context().close();
  }

  await browser.close();
  console.log('\n' + passed + '/' + (passed + failed) + ' tutorial checks passed');
  process.exit(failed ? 1 : 0);
})();

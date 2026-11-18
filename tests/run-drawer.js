#!/usr/bin/env node
// Checks the Drawer (🧰) of an Emit IDE build in headless Chromium: opening and closing, the list of tools,
// back / close / unsaved-changes questions, phone and desktop layouts, tools registered before the drawer code
// loads, the block helpers (_drawerBlocks / _drawerRead / _drawerWrite / _drawerRemove) across the files of a
// project, and the Sound and Music tools end to end (open, change, write, reopen and get the same settings,
// hand-edited blocks, parts kept as they are, playback).
// About half of the checks run in a phone viewport with touch (360 px wide), the rest on a desktop viewport.
// Offline: every network request is aborted.
//
//   node tests/run-drawer.js [path/to/emit-ide.html]
//
// TEST-ONLY stand-ins (in the page, never in the product):
//   - FAKE_AUDIO (tests/fake-audio.js) replaces AudioContext with a recorder, so what the synth schedules
//     (oscillators, frequency ramps, envelope points, start / stop times) can be checked; nothing is heard.
//   - EARLY_TOOL registers a tool "test" with the guard of the drawer contract BEFORE the page's scripts run,
//     standing in for a tool file that loads before the drawer section. It records its ctx in window.__testCtx.
//
// Exit code 0 when every check passes.
const { chromium } = require('playwright');
const path = require('path');
const FAKE_AUDIO = require('./fake-audio.js');

let failed = 0, passed = 0;
function check(label, ok, detail) {
  if (ok) { passed++; console.log('PASS  ' + label); }
  else { failed++; console.log('FAIL  ' + label + (detail !== undefined ? '\n      ' + String(detail).slice(0, 700) : '')); }
}
const PHONE = { viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true };
const DESK = { viewport: { width: 1200, height: 800 } };

// TEST-ONLY: a tool registered through the contract's guard before the drawer code exists (twice: one card)
const EARLY_TOOL = `(function () {
  function reg() {
    if (typeof _drawerRegister !== 'function') { window._drawerTools = window._drawerTools || []; window._drawerRegister = function (t) { window._drawerTools.push(t); }; }
    _drawerRegister({ id: 'test', label: 'Test tool', icon: '🧪', desc: 'A stand-in registered before the drawer loaded', open: function (ctx) {
      window.__testCtx = ctx; window.__testOpened = (window.__testOpened || 0) + 1; window.__testLeft = 0;
      var b = document.createElement('button'); b.className = 'drw-btn'; b.id = 'testDirty'; b.textContent = 'Make dirty'; b.onclick = function () { ctx.setDirty(true); };
      ctx.body.appendChild(b);
      var f = document.createElement('button'); f.className = 'drw-btn drw-pri'; f.id = 'testSave'; f.textContent = 'Save'; f.onclick = function () { ctx.setDirty(false); ctx.toast('saved'); };
      ctx.footer.appendChild(f);
      return function () { window.__testLeft = (window.__testLeft || 0) + 1; };
    } });
  }
  reg(); reg();
})();`;

async function openIde(browser, fileUrl, mode, opts = {}) {
  const ctx = await browser.newContext(mode);
  const page = await ctx.newPage();
  page.errors = []; page.consoleErrors = []; page.dialogs = []; page.answers = [];
  page.on('pageerror', e => page.errors.push(e.message.slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.consoleErrors.push(m.text().slice(0, 300)); });
  page.on('dialog', async d => {
    page.dialogs.push({ type: d.type(), message: d.message() });
    const a = page.answers.length ? page.answers.shift() : true;
    if (a === false) await d.dismiss(); else await d.accept(typeof a === 'string' ? a : undefined);
  });
  await page.route(/^https?:/, route => route.abort());
  await page.addInitScript(FAKE_AUDIO);
  if (opts.early !== false) await page.addInitScript(EARLY_TOOL);
  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof compileAndRun === 'function' && typeof _projLoad === 'function' && typeof _drawerOpen === 'function');
  await page.waitForTimeout(150);
  await page.evaluate(() => { try { closeWelcome(); } catch (e) {} try { localStorage.clear(); } catch (e) {} });
  return page;
}
const load = (page, text) => page.evaluate(t => { _projLoad(t); }, text);
const D = page => page.evaluate(() => {
  const el = document.getElementById('drawer'), open = !!(el && el.classList.contains('show'));
  const r = open ? document.querySelector('#drawer .drw').getBoundingClientRect() : null;
  return {
    open, title: open ? document.getElementById('drawerTitle').textContent : null,
    cards: open ? [...document.querySelectorAll('#drawer .drw-card')].map(c => c.getAttribute('data-tool')) : [],
    back: open ? getComputedStyle(document.querySelector('#drawer .drw-back')).visibility : null,
    tool: _drawer.tool ? _drawer.tool.id : null, dirty: _drawer.dirty,
    rect: r && { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    sw: document.documentElement.scrollWidth, iw: innerWidth,
    bodyOver: open ? document.getElementById('drawerBody').scrollWidth - document.getElementById('drawerBody').clientWidth : 0,
  };
});
const tapSel = async (page, sel) => { if (page.context()._options && page.context()._options.hasTouch) await page.tap(sel); else await page.click(sel); };
// every visible clickable control of the drawer is at least `min` px in both directions
const smallTargets = (page, min) => page.evaluate(min => [...document.querySelectorAll('#drawer button, #drawer input, #drawer select')].filter(e => {
  const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false;
  if (e.type === 'checkbox') return false;   // the checkbox comes with its label (≥ 40 px high, same row)
  if (e.type === 'range') return r.height < min;
  return r.height < min || r.width < min;
}).map(e => (e.className || e.tagName) + ':' + (e.textContent || e.getAttribute('aria-label') || '').slice(0, 20) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)), min);
const audio = page => page.evaluate(() => {
  const c = window.__audio.ctx; if (!c) return { made: window.__audio.made, nodes: [] };
  const P = p => p ? p.events.map(e => [e[0], +(+e[1]).toFixed(4), +(+e[2]).toFixed(4)]) : null;
  return { made: window.__audio.made, state: c.state, now: c.currentTime, nodes: c.nodes.map(n => ({ kind: n.kind, type: n.type, startT: n.startT, stopT: n.stopT, f: P(n.frequency), g: P(n.gain), r: P(n.playbackRate), loop: n.loop, to: n.out.map(o => o.kind || (o.name ? 'param:' + o.name : '?')) })) };
});
const sinceN = (a, n) => a.nodes.slice(n);

(async () => {
  const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'emit-ide-1_32.html'));
  const fileUrl = 'file://' + file;
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  let page, s, r, a, n0;

  // ═════════════════════════════ PHONE (360 px, touch) ═════════════════════════════
  page = await openIde(browser, fileUrl, PHONE);
  r = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.header .hdr-btn')].find(x => x.title === 'Drawer');
    const o = [...document.querySelectorAll('#exportSel option')].find(x => /^Drawer…$/.test(x.textContent));
    return { btn: !!b, txt: b && b.textContent, opt: o && o.value };
  });
  check('phone: header has a 🧰 button titled "Drawer" and the File menu a "Drawer…" entry', r.btn && r.txt === '🧰' && r.opt === 'drawer', JSON.stringify(r));
  await page.tap('.header .hdr-btn[title="Drawer"]');
  s = await D(page);
  check('phone: 🧰 opens the drawer with the list (no back button, title Drawer)', s.open && s.title === 'Drawer' && s.back === 'hidden' && !s.tool, JSON.stringify(s));
  check('phone: the list has the tool registered before the drawer loaded (once), Sound and Music', s.cards.filter(c => c === 'test').length === 1 && s.cards.includes('sound') && s.cards.includes('music'), JSON.stringify(s.cards));
  check('phone: window._drawerTools is the live list (adopted array, with the drawer\'s own tools)', await page.evaluate(() => Array.isArray(window._drawerTools) && window._drawerTools.some(t => t.id === 'test') && window._drawerTools.some(t => t.id === 'sound')));
  check('phone: the drawer is a full-screen sheet', s.rect && s.rect.x === 0 && s.rect.y === 0 && s.rect.w === 360 && s.rect.h === 740, JSON.stringify(s.rect));
  check('phone: no horizontal overflow (page and drawer)', s.sw <= 360 && s.bodyOver <= 0, JSON.stringify(s));
  r = await page.evaluate(() => [...document.querySelectorAll('#drawer .drw-card')].map(c => { const b = c.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height), c.querySelector('.drw-ic').textContent, c.querySelector('.drw-cl').textContent, c.querySelector('.drw-cd').textContent]; }));
  check('phone: cards are large (≥ 300×60) with icon, label and description', r.length >= 3 && r.every(c => c[0] >= 300 && c[1] >= 60 && c[2] && c[3] && c[4]), JSON.stringify(r));
  check('phone: every control of the list is at least 40 px', (await smallTargets(page, 40)).length === 0, JSON.stringify(await smallTargets(page, 40)));
  await page.evaluate(() => _drawerRegister({ id: 'late', label: 'Late tool', icon: '⏰', desc: 'registered while the list is open', open: function (ctx) { ctx.body.textContent = 'late'; } }));
  s = await D(page);
  check('phone: a tool registered while the list is open appears at once', s.cards.includes('late'), JSON.stringify(s.cards));
  await page.evaluate(() => _drawerRegister({ id: 'late', label: 'Late tool 2', icon: '⏰', desc: 'same id', open: function (ctx) { ctx.body.textContent = 'late2'; } }));
  check('phone: registering the same id again replaces it (one card)', (await D(page)).cards.filter(c => c === 'late').length === 1 && await page.evaluate(() => document.querySelector('#drawer .drw-card[data-tool="late"] .drw-cl').textContent === 'Late tool 2'));
  r = await page.evaluate(() => { const bad = _drawerRegister({ id: 'x' }); return bad === null && !window._drawerTools.some(t => t.id === 'x'); });
  check('phone: a registration without open() is refused with a warning, not a crash', r);
  // open a tool
  await page.tap('#drawer .drw-card[data-tool="test"]');
  s = await D(page);
  r = await page.evaluate(() => { const c = window.__testCtx; return c && ['body', 'footer'].every(k => c[k] instanceof HTMLElement) && ['title', 'close', 'setDirty', 'toast', 'blocks', 'read', 'write', 'remove', 'files', 'run'].every(k => typeof c[k] === 'function'); });
  check('phone: tapping a card opens the tool in place of the list (title, ‹ back) with the full ctx', s.tool === 'test' && s.title === 'Test tool' && s.back === 'visible' && s.cards.length === 0 && r, JSON.stringify(s));
  r = await page.evaluate(() => { const f = document.getElementById('drawerFoot'), b = f.getBoundingClientRect(); return { h: Math.round(b.height), bottom: Math.round(b.bottom), btn: !!f.querySelector('#testSave') }; });
  check('phone: the footer is a bar at the bottom of the screen with the tool\'s buttons', r.btn && r.bottom === 740 && r.h >= 44, JSON.stringify(r));
  await page.evaluate(() => window.__testCtx.title('Renamed'));
  check('phone: ctx.title() sets the title', (await D(page)).title === 'Renamed');
  await page.tap('#drawer .drw-back');
  s = await D(page);
  check('phone: ‹ back (nothing changed) returns to the list without asking; the tool\'s cleanup ran', s.open && !s.tool && s.cards.length >= 3 && page.dialogs.length === 0 && await page.evaluate(() => window.__testLeft === 1), JSON.stringify(s) + JSON.stringify(page.dialogs));
  await page.tap('#drawer .drw-card[data-tool="test"]');
  await page.tap('#testDirty');
  page.answers.push(false);
  await page.tap('#drawer .drw-back');
  s = await D(page);
  check('phone: back with unsaved changes asks; Cancel stays in the tool', page.dialogs.length === 1 && page.dialogs[0].type === 'confirm' && /unsaved/i.test(page.dialogs[0].message) && s.tool === 'test' && s.dirty, JSON.stringify(page.dialogs));
  page.answers.push(false);
  await page.tap('#drawer .drw-x');
  s = await D(page);
  check('phone: ✕ with unsaved changes asks too; Cancel keeps the drawer open', page.dialogs.length === 2 && s.open && s.tool === 'test', JSON.stringify(page.dialogs));
  page.answers.push(true);
  await page.tap('#drawer .drw-x');
  s = await D(page);
  check('phone: OK closes it and runs the cleanup', page.dialogs.length === 3 && !s.open && await page.evaluate(() => window.__testLeft === 1), JSON.stringify(s));
  page.dialogs.length = 0;
  await page.evaluate(() => _drawerOpen('test'));
  s = await D(page);
  check('phone: _drawerOpen(id) opens straight into that tool', s.open && s.tool === 'test');
  await page.tap('#testDirty'); await page.tap('#testSave');
  await page.waitForTimeout(50);
  r = await page.evaluate(() => document.querySelector('#drawer .drw-toast').textContent);
  await page.tap('#drawer .drw-x');
  check('phone: setDirty(false) after a save closes without asking; ctx.toast shows a message', !(await D(page)).open && page.dialogs.length === 0 && r === 'saved', r + JSON.stringify(page.dialogs));
  await page.selectOption('#exportSel', 'drawer');
  s = await D(page);
  check('phone: File → Drawer… opens the list', s.open && !s.tool && s.cards.length >= 3 && await page.evaluate(() => document.getElementById('exportSel').value === ''));
  await page.evaluate(() => _drawerClose());
  check('phone: _drawerOpen(unknown id) shows the list', await page.evaluate(() => { _drawerOpen('nope'); return !_drawer.tool && document.querySelectorAll('#drawer .drw-card').length >= 3; }));
  r = await page.evaluate(() => { const keep = window._drawerTools.slice(); window._drawerTools.length = 0; _drawerOpen(); const t = document.getElementById('drawerBody').innerText; window._drawerTools.push.apply(window._drawerTools, keep); _drawerClose(); return t; });
  check('phone: with no tools registered the drawer says so', /No tools in the drawer yet/.test(r), r);
  await page.evaluate(() => _drawerRegister({ id: 'broken', label: 'Broken', icon: 'x', desc: 'throws', open: function () { throw new Error('boom'); } }));
  r = await page.evaluate(() => { _drawerOpen('broken'); const t = document.getElementById('drawerBody').innerText; _drawerClose(); return t; });
  check('phone: a tool that throws in open() shows its error in the panel', /could not open: boom/.test(r), r);

  // ── Block helpers across a project ──
  const PROJ = 'export fn run() {\n  play(coin)\n}\n\nsound coin: square 880, 90ms\n\nfn after() {\n}\n'
    + '//// file: sounds.emit\nsound jump: square 300 > 700, 150ms\nmusic theme: 120 bpm, 4 steps\n  lead square: C5 . E5 .\n\n  drums: K . S .\n\nsprite coin: 8x8\n  ..##..\n/* sound hidden: sine\n*/\nrules:\n  when x\nsound last: sine 440'
    + '\n//// file: game/extra.emit\npackage game\n\nmusic tune: 90 bpm, 2 steps\n  a sine: C4 -';
  await load(page, PROJ);
  r = await page.evaluate(() => ({ snd: _drawerBlocks('sound'), mus: _drawerBlocks('music'), spr: _drawerBlocks('sprite'), rules: _drawerBlocks('rules') }));
  check('blocks: _drawerBlocks(sound) in file order across files, 1-based inclusive lines, exact text',
    JSON.stringify(r.snd) === JSON.stringify([
      { kind: 'sound', name: 'coin', path: 'main.emit', startLine: 5, endLine: 5, text: 'sound coin: square 880, 90ms' },
      { kind: 'sound', name: 'jump', path: 'sounds.emit', startLine: 1, endLine: 1, text: 'sound jump: square 300 > 700, 150ms' },
      { kind: 'sound', name: 'last', path: 'sounds.emit', startLine: 13, endLine: 13, text: 'sound last: sine 440' }]), JSON.stringify(r.snd));
  check('blocks: a multi-line block keeps an inner blank line, stops before the blank line that ends it',
    r.mus.length === 2 && r.mus[0].startLine === 2 && r.mus[0].endLine === 5 && r.mus[0].text === 'music theme: 120 bpm, 4 steps\n  lead square: C5 . E5 .\n\n  drums: K . S .' && r.mus[1].path === 'game/extra.emit' && r.mus[1].text === 'music tune: 90 bpm, 2 steps\n  a sine: C4 -', JSON.stringify(r.mus));
  check('blocks: a header inside a /* */ comment is not a block; rules: has the name ""', !r.snd.some(b => b.name === 'hidden') && r.rules.length === 1 && r.rules[0].name === '' && r.rules[0].text === 'rules:\n  when x', JSON.stringify(r.rules));
  r = await page.evaluate(() => [_drawerRead('sprite', 'coin'), _drawerRead('sound', 'coin'), _drawerRead('sound', 'nope'), _drawerRead('rules', '')]);
  check('blocks: _drawerRead by kind and name (same name in another kind is another block); null when missing', r[0] === 'sprite coin: 8x8\n  ..##..' && r[1] === 'sound coin: square 880, 90ms' && r[2] === null && r[3] === 'rules:\n  when x', JSON.stringify(r));
  // cursor in the open file, after the block that is replaced
  await page.evaluate(() => { _projSetActive(0); const ed = document.getElementById('editor'); const p = ed.value.indexOf('fn after'); ed.focus(); ed.setSelectionRange(p, p + 8); });
  r = await page.evaluate(() => {
    const w = _drawerWrite('sound', 'coin', 'sound coin: square 990, 80ms\n  // second line');
    const ed = document.getElementById('editor');
    return { w, sel: ed.value.substring(ed.selectionStart, ed.selectionEnd), main: _proj.files[0].source, active: _proj.active, other: _proj.files[1].source.split('\n')[0] };
  });
  check('write: replaces the block in place (same file, same line), other files untouched',
    r.w.path === 'main.emit' && r.w.startLine === 5 && r.main === 'export fn run() {\n  play(coin)\n}\n\nsound coin: square 990, 80ms\n  // second line\n\nfn after() {\n}' && r.other === 'sound jump: square 300 > 700, 150ms', JSON.stringify(r));
  check('write: the cursor stays on the same text of the open file', r.sel === 'fn after' && r.active === 0, JSON.stringify(r.sel));
  r = await page.evaluate(() => { const ed = document.getElementById('editor'); return { hl: document.getElementById('hlInner').textContent === ed.value + '\n', g: document.querySelectorAll('#gutter .ln').length === ed.value.split('\n').length }; });
  check('write: highlight layer and gutter follow', r.hl && r.g, JSON.stringify(r));
  r = await page.evaluate(() => { const ok = _projUndo(); return { ok, has: document.getElementById('editor').value.indexOf('sound coin: square 880, 90ms') >= 0 }; });
  check('write: one undo step in the open file brings the old block back', r.ok && r.has, JSON.stringify(r));
  await page.evaluate(() => _projUndo(true));
  r = await page.evaluate(() => { const w = _drawerWrite('music', 'theme', 'music theme: 100 bpm, 2 steps\n  lead sine: C5 -'); return { w, src: _proj.files[1].source, active: _proj.active }; });
  check('write: a multi-line block in another file is replaced in place (the inner blank line goes with it)', r.w.path === 'sounds.emit' && r.w.startLine === 2 && r.src.split('\n').slice(0, 4).join('\n') === 'sound jump: square 300 > 700, 150ms\nmusic theme: 100 bpm, 2 steps\n  lead sine: C5 -\n' && /\nsprite coin: 8x8\n/.test(r.src) && r.active === 0, JSON.stringify(r));
  r = await page.evaluate(() => { const w = _drawerWrite('sound', 'last', 'sound last: saw 220, 50ms'); return { w, src: _proj.files[1].source }; });
  check('write: a block at the very end of a file (no newline after it) is replaced', r.w.startLine === 11 && /\nsound last: saw 220, 50ms$/.test(r.src), JSON.stringify(r));
  r = await page.evaluate(() => { const w = _drawerWrite('sound', 'zap', 'sound zap: noise 900, 60ms'); return { w, src: _proj.files[1].source }; });
  check('write: a new block is appended to the kind\'s file after a blank line', r.w.path === 'sounds.emit' && /\nsound last: saw 220, 50ms\n\nsound zap: noise 900, 60ms\n$/.test(r.src) && r.w.startLine === r.src.split('\n').length - 1, JSON.stringify(r));
  r = await page.evaluate(() => { const w = _drawerWrite('sound', 'pew', 'sound pew: sine 1000', 'game/extra.emit'); return { w, src: _proj.files[2].source }; });
  check('write: preferredFile puts a new block into that file', r.w.path === 'game/extra.emit' && /a sine: C4 -\n\nsound pew: sine 1000\n$/.test(r.src), JSON.stringify(r));
  r = await page.evaluate(() => { const w = _drawerWrite('thing', 'coin', 'thing coin: 1 hp'); return { w, paths: _proj.files.map(f => f.path), src: _proj.files[_proj.files.length - 1].source, tabs: document.querySelectorAll('#fileTabs .ftab').length, active: _proj.active, entry: _proj.files[0].path }; });
  check('write: a kind without its file creates it (game.emit), not as the entry file, tab shown', r.w.path === 'game.emit' && r.w.startLine === 1 && r.paths[r.paths.length - 1] === 'game.emit' && r.src === 'thing coin: 1 hp\n' && r.tabs === r.paths.length && r.active === 0 && r.entry === 'main.emit', JSON.stringify(r));
  r = await page.evaluate(() => [_drawerRead('thing', 'coin'), _drawerRead('sound', 'coin').split('\n')[0], _drawerRead('sprite', 'coin').split('\n')[0]]);
  check('write: the same name in three kinds are three blocks', r[0] === 'thing coin: 1 hp' && r[1] === 'sound coin: square 990, 80ms' && r[2] === 'sprite coin: 8x8', JSON.stringify(r));
  r = await page.evaluate(() => { const a = _drawerRemove('sound', 'zap'), b = _drawerRemove('sound', 'zap'); return { a, b, src: _proj.files[1].source }; });
  check('remove: the block and the blank line before it go; a second remove returns false', r.a === true && r.b === false && /\nsound last: saw 220, 50ms\n$/.test(r.src), JSON.stringify(r));
  r = await page.evaluate(() => { _drawerRemove('music', 'theme'); return _proj.files[1].source.split('\n').slice(0, 3); });
  check('remove: a multi-line block in the middle of a file', JSON.stringify(r) === JSON.stringify(['sound jump: square 300 > 700, 150ms', '', 'sprite coin: 8x8']), JSON.stringify(r));
  await page.waitForTimeout(400);
  r = await page.evaluate(() => localStorage.getItem('emit-code'));
  check('write/remove: the project is autosaved', r && r.indexOf('thing coin: 1 hp') >= 0 && r.indexOf('sound zap') < 0, String(r).slice(0, 200));
  r = await page.evaluate(() => { _projSetActive(1); _projUndo(); return document.getElementById('editor').value.indexOf('music theme') >= 0; });
  check('remove: a change to a file that was not open is one undo step of that file', r);
  // single-file project → write creates sounds.emit and shows the tabs
  await load(page, 'export fn run() {\n  print(1)\n}\n');
  r = await page.evaluate(() => { const before = getComputedStyle(document.getElementById('fileTabs')).display; const w = _drawerWrite('sound', 'beep', 'sound beep: sine 660, 50ms'); return { before, w, paths: _proj.files.map(f => f.path), strip: getComputedStyle(document.getElementById('fileTabs')).display, active: _proj.active, ed: document.getElementById('editor').value }; });
  check('write: a single-file project gets sounds.emit and turns multi-file (tabs shown), the editor stays on main.emit',
    r.before === 'none' && r.w.path === 'sounds.emit' && r.paths.join() === 'main.emit,sounds.emit' && r.strip !== 'none' && r.active === 0 && r.ed === 'export fn run() {\n  print(1)\n}\n', JSON.stringify(r));
  r = await page.evaluate(() => { const c = compile(_projText()); return { e: c.errors, s: c.sounds }; });
  check('write: the new file\'s block compiles as part of the program', r.e.length === 0 && JSON.stringify(r.s) === '["beep"]', JSON.stringify(r));

  // ── Sound tool (phone) ──
  await load(page, await page.evaluate(() => EX.sfx));
  await page.tap('.header .hdr-btn[title="Drawer"]');
  await page.tap('#drawer .drw-card[data-tool="sound"]');
  s = await D(page);
  r = await page.evaluate(() => ({ chips: [...document.querySelectorAll('#drawer .drw-chips .drw-chip:not(.drw-add)')].map(c => c.textContent), name: document.querySelector('#drawer .drw-name').value, code: document.querySelector('#drawer .drw-code').textContent }));
  check('sound: opens with the program\'s sounds as a list, the first one selected', s.tool === 'sound' && JSON.stringify(r.chips) === '["coin","jump","laser","boom"]' && r.name === 'coin', JSON.stringify(r));
  check('sound: an unchanged sound shows exactly its block', r.code === 'sound coin: square 988, 80ms, atk 1, rel 180, vol 0.4, arp 1.335 60ms', r.code);
  check('sound: phone layout — no horizontal overflow', s.sw <= 360 && s.bodyOver <= 0, JSON.stringify(s));
  check('sound: every control is at least 40 px (range sliders 40 px high)', (await smallTargets(page, 40)).length === 0, JSON.stringify(await smallTargets(page, 40)));
  r = await page.evaluate(() => { const c = document.querySelector('#drawer .snd-cv'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 150) lit++; return { w: c.width, lit }; });
  check('sound: the waveform / envelope drawing has pixels', r.w > 100 && r.lit > 200, JSON.stringify(r));
  a = await audio(page); n0 = a.nodes.length;
  await page.tap('#drawer .drw-play');
  a = await audio(page);
  let nn = sinceN(a, n0), osc = nn.find(x => x.kind === 'osc'), gain = nn.find(x => x.kind === 'gain' && x.to.includes('gain'));
  check('sound: ▶ plays the current settings: a square oscillator at 988 Hz that jumps ×1.335 after 60 ms',
    a.made === 1 && osc && osc.type === 'square' && osc.f[0][0] === 'set' && osc.f[0][1] === 988 && osc.f.some(e => e[0] === 'set' && Math.abs(e[1] - 988 * 1.335) < 0.01 && Math.abs(e[2] - osc.f[0][2] - 0.06) < 0.002), JSON.stringify(nn).slice(0, 600));
  check('sound: the envelope: 0 → 0.4 in 1 ms, held to 80 ms, 0 at 80 + 180 ms; stop after the release',
    gain && JSON.stringify(gain.g.map(e => [e[0], e[1], +(e[2] - osc.startT).toFixed(3)])) === JSON.stringify([['set', 0, 0], ['lin', 0.4, 0.001], ['lin', 0.4, 0.08], ['lin', 0, 0.26]]) && Math.abs(osc.stopT - osc.startT - 0.28) < 0.001, JSON.stringify(gain && gain.g) + ' start ' + (osc && osc.startT) + ' stop ' + (osc && osc.stopT));
  check('sound: the tool resumed the audio context (a tap is the unlock gesture)', a.state === 'running');
  n0 = a.nodes.length;
  await page.tap('#drawer .drw-wrap .drw-btn:text-is("laser")');
  a = await audio(page); nn = sinceN(a, n0); osc = nn.find(x => x.kind === 'osc');
  r = await page.evaluate(() => ({ code: document.querySelector('#drawer .drw-code').textContent, dirty: _drawer.dirty, chip: document.querySelector('#drawer .drw-chip.on').classList.contains('dirty') }));
  check('sound: a preset plays at once: saw 1500 Hz, exponential sweep to 220 Hz over 170 ms, through a low-pass at 7000 Hz',
    osc && osc.type === 'sawtooth' && osc.f[0][1] === 1500 && osc.f.some(e => e[0] === 'exp' && e[1] === 220 && Math.abs(e[2] - osc.f[0][2] - 0.17) < 0.002) && nn.some(x => x.kind === 'filter' && x.type === 'lowpass' && x.f[0][1] === 7000), JSON.stringify(nn).slice(0, 500));
  check('sound: …and the block text follows; the sound is marked unsaved', r.code === 'sound coin: saw 1500 > 220, 170ms, atk 1, vol 0.35, lowpass 7000, curve exp' && r.dirty && r.chip, JSON.stringify(r));
  // change values through the number boxes
  await page.evaluate(() => {
    const set = (label, v) => { const row = [...document.querySelectorAll('#drawer .drw-sl')].find(x => x.querySelector('label').textContent === label); const b = row.querySelector('.drw-num'); b.value = v; b.dispatchEvent(new Event('change')); };
    set('Start pitch', '600'); set('Release', '90'); set('Vibrato depth', '0.03'); set('Vibrato rate', '7'); set('High-pass', '300'); set('Sustain', '0.5'); set('Decay', '40');
  });
  r = await page.evaluate(() => document.querySelector('#drawer .drw-code').textContent);
  check('sound: sliders / number boxes change the block (defaults left out)', r === 'sound coin: saw 600 > 220, 170ms, atk 1, dec 40, sus 0.5, rel 90, vol 0.35, vib 0.03 7, lowpass 7000, highpass 300, curve exp', r);
  n0 = (await audio(page)).nodes.length;
  await page.tap('#drawer .drw-play');
  a = await audio(page); nn = sinceN(a, n0);
  const lfo = nn.find(x => x.kind === 'osc' && x.type === 'sine');
  check('sound: vibrato is an LFO at 7 Hz into the frequency; a high-pass at 300 Hz follows the low-pass',
    lfo && lfo.f[0][1] === 7 && nn.some(x => x.kind === 'gain' && x.to.includes('param:frequency') && Math.abs(x.g[0][1] - 0.03 * 600) < 0.001) && nn.filter(x => x.kind === 'filter').map(x => x.type).join() === 'lowpass,highpass', JSON.stringify(nn).slice(0, 600));
  const env = nn.find(x => x.kind === 'gain' && x.to.includes('gain')), st = nn.find(x => x.kind === 'osc' && x.type === 'sawtooth').startT;
  check('sound: ADSR: attack 1 ms to 0.35, decay 40 ms to 0.175, sustain until 170 ms, release 90 ms',
    env && JSON.stringify(env.g.map(e => [e[0], e[1], +(e[2] - st).toFixed(3)])) === JSON.stringify([['set', 0, 0], ['lin', 0.35, 0.001], ['lin', 0.175, 0.041], ['lin', 0.175, 0.17], ['lin', 0, 0.26]]), JSON.stringify(env && env.g));
  await page.tap('#drawer .drw-ft .drw-pri');
  r = await page.evaluate(() => ({ blk: _drawerBlocks('sound')[0], dirty: _drawer.dirty, toast: document.querySelector('#drawer .drw-toast').textContent, chipDirty: !!document.querySelector('#drawer .drw-chip.dirty') }));
  check('sound: Save to program writes the block in place (same line of main.emit)', r.blk.path === 'main.emit' && r.blk.startLine === 5 && r.blk.text === 'sound coin: saw 600 > 220, 170ms, atk 1, dec 40, sus 0.5, rel 90, vol 0.35, vib 0.03 7, lowpass 7000, highpass 300, curve exp' && !r.dirty && !r.chipDirty && /Saved coin/.test(r.toast), JSON.stringify(r));
  await page.tap('#drawer .drw-x');
  check('sound: after saving, ✕ closes without asking', !(await D(page)).open && page.dialogs.length === 0, JSON.stringify(page.dialogs));
  await page.evaluate(() => _drawerOpen('sound'));
  r = await page.evaluate(() => ({ code: document.querySelector('#drawer .drw-code').textContent, nums: [...document.querySelectorAll('#drawer .drw-sl')].map(x => x.querySelector('label').textContent + '=' + x.querySelector('.drw-num').value).join(' '), wave: document.querySelector('#drawer .drw-seg button.on').textContent }));
  check('sound: reopened, the tool shows the same settings (round trip)', r.code === 'sound coin: saw 600 > 220, 170ms, atk 1, dec 40, sus 0.5, rel 90, vol 0.35, vib 0.03 7, lowpass 7000, highpass 300, curve exp' && r.wave === 'saw' && /Start pitch=600 /.test(r.nums) && /End pitch=220 /.test(r.nums) && /Release=90 /.test(r.nums) && /High-pass=300 /.test(r.nums) && /Vibrato rate=7 /.test(r.nums), JSON.stringify(r));
  await page.evaluate(() => _drawerClose());
  // a hand-written block: other units, unknown parts, a comment
  await page.evaluate(() => { _projSetActive(0); const ed = document.getElementById('editor'); ed.value = ed.value.replace('sound jump:', 'sound zap: sine 440 > 880, 0.2s, reverb 3, vol 0.3, atk x // my note\nsound jump:'); ed.dispatchEvent(new Event('input')); });
  await page.evaluate(() => _drawerOpen('sound'));
  await page.tap('#drawer .drw-chip:text-is("zap")');
  r = await page.evaluate(() => ({ kept: [...document.querySelectorAll('#drawer .drw-kept code')].map(c => c.textContent), label: (document.querySelector('#drawer .drw-kept .drw-lab') || {}).textContent, code: document.querySelector('#drawer .drw-code').textContent, len: [...document.querySelectorAll('#drawer .drw-sl')].find(x => x.querySelector('label').textContent === 'Length').querySelector('.drw-num').value }));
  check('sound: a hand-edited block is read back (0.2s = 200 ms) and unchanged it is written exactly as it is', r.len === '200' && r.code === 'sound zap: sine 440 > 880, 0.2s, reverb 3, vol 0.3, atk x // my note', JSON.stringify(r));
  check('sound: parts it does not understand are listed as "kept as is" (unknown word, bad value, comment)', /kept as is/i.test(r.label || '') && r.kept.length === 3 && r.kept[0] === 'reverb 3' && /^atk x  — atk needs/.test(r.kept[1]) && r.kept[2] === '// my note', JSON.stringify(r.kept));
  await page.evaluate(() => { const row = [...document.querySelectorAll('#drawer .drw-sl')].find(x => x.querySelector('label').textContent === 'Volume'); const b = row.querySelector('.drw-num'); b.value = '0.6'; b.dispatchEvent(new Event('change')); });
  await page.tap('#drawer .drw-kept .drw-krow:nth-of-type(3) button');   // drop "atk x"
  await page.tap('#drawer .drw-ft .drw-pri');
  r = await page.evaluate(() => _drawerRead('sound', 'zap'));
  check('sound: after an edit the changed part is rewritten, untouched parts keep their text, kept parts stay (a dropped one goes)', r === 'sound zap: sine 440 > 880, 0.2s, reverb 3, vol 0.6 // my note', r);
  // new sound, randomize, mutate, noise
  n0 = (await audio(page)).nodes.length;
  await page.tap('#drawer .drw-chips .drw-add');
  r = await page.evaluate(() => ({ name: document.querySelector('#drawer .drw-name').value, dirty: _drawer.dirty }));
  a = await audio(page);
  check('sound: + New sound adds "sound" (unsaved) and plays it', r.name === 'sound' && r.dirty && a.nodes.length > n0, JSON.stringify(r));
  await page.evaluate(() => { const i = document.querySelector('#drawer .drw-name'); i.value = 'boom2'; i.dispatchEvent(new Event('change')); });
  await page.evaluate(() => { const i = document.querySelector('#drawer .drw-name'); i.value = 'coin'; i.dispatchEvent(new Event('change')); });
  r = await page.evaluate(() => ({ name: document.querySelector('#drawer .drw-name').value, toast: document.querySelector('#drawer .drw-toast').textContent }));
  check('sound: renaming onto a name that exists is refused', r.name === 'boom2' && /already a sound called coin/.test(r.toast), JSON.stringify(r));
  const before = await page.evaluate(() => document.querySelector('#drawer .drw-code').textContent);
  n0 = (await audio(page)).nodes.length;
  await page.tap('#drawer .drw-btn:text("Randomize")');
  r = await page.evaluate(() => document.querySelector('#drawer .drw-code').textContent);
  check('sound: Randomize changes the sound and plays it', r !== before && /^sound boom2: (sine|square|saw|triangle|noise)/.test(r) && (await audio(page)).nodes.length > n0, r);
  const r2 = r; n0 = (await audio(page)).nodes.length;
  await page.tap('#drawer .drw-btn:text("Mutate")');
  r = await page.evaluate(() => document.querySelector('#drawer .drw-code').textContent);
  check('sound: Mutate changes it a little (same waveform) and plays it', r !== r2 && r.split(' ')[2] === r2.split(' ')[2] && (await audio(page)).nodes.length > n0, r2 + ' → ' + r);
  await page.tap('#drawer .drw-seg button:text-is("noise")');
  a = await audio(page); nn = sinceN(a, n0);
  const buf = nn.reverse().find(x => x.kind === 'buffer');
  check('sound: noise is a looping noise buffer whose rate follows the pitch', buf && buf.loop === true && buf.r && buf.r[0][0] === 'set' && buf.r[0][1] > 0, JSON.stringify(buf));
  r = await page.evaluate(() => { const t = document.querySelector('#drawer .drw-code').textContent; _sndParse(_drawerBody(t, 'sound')); return { t, p: _sndParse(_drawerBody(t, 'sound')).errors }; });
  check('sound: what the tool writes always parses without errors', r.p.length === 0, JSON.stringify(r));
  await page.tap('#drawer .drw-ft .drw-pri');
  r = await page.evaluate(() => _drawerBlocks('sound').map(b => b.name + '@' + b.path));
  check('sound: the new sound is appended to sounds.emit (created)', r.join() === 'coin@main.emit,zap@main.emit,jump@main.emit,laser@main.emit,boom@main.emit,boom2@sounds.emit', r.join());
  page.answers.push(true);
  await page.tap('#drawer .drw-ft .drw-danger');
  r = await page.evaluate(() => ({ list: _drawerBlocks('sound').map(b => b.name).join(), chips: document.querySelectorAll('#drawer .drw-chip:not(.drw-add)').length }));
  check('sound: Delete (confirmed) removes the block from the program', page.dialogs.length === 1 && r.list === 'coin,zap,jump,laser,boom' && r.chips === 5, JSON.stringify(r));
  await page.evaluate(() => _drawerClose());
  page.dialogs.length = 0;

  // ── Music tool (phone) ──
  await load(page, await page.evaluate(() => EX.sfx));
  await page.evaluate(() => _drawerOpen('music'));
  await page.waitForTimeout(100);
  s = await D(page);
  r = await page.evaluate(() => ({ chips: [...document.querySelectorAll('#drawer .mus-tbar .drw-chip:not(.drw-add)')].map(c => c.textContent), notes: document.querySelectorAll('#drawer .mus-note').length, keys: document.querySelectorAll('#drawer .mus-key').length, c: [...document.querySelectorAll('#drawer .mus-key.c')].map(k => k.textContent), code: document.querySelector('#drawer .drw-code').textContent }));
  check('music: opens the program\'s music with its tracks; lead has 6 notes in a C2–C6 roll with octave labels', s.tool === 'music' && JSON.stringify(r.chips) === '["🎹 lead","🎹 bass","🥁 drums"]' && r.notes === 6 && r.keys === 49 && r.c.join() === 'C6,C5,C4,C3,C2', JSON.stringify(r));
  check('music: unchanged, the block is shown exactly as written', r.code === 'music theme: 132 bpm, 16 steps\n  lead square vol 0.7: E5 . G5 . C6 - - . G5 . E5 . D5 - - .\n  bass triangle: C3 - - - C3 - - - A2 - - - G2 - - -\n  drums: K . H . S . H . K K H . S . H H', r.code);
  check('music: phone layout — no horizontal overflow of the page or the panel (the roll scrolls inside)', s.sw <= 360 && s.bodyOver <= 0 && await page.evaluate(() => { const r = document.querySelector('#drawer .mus-roll'); return r.scrollWidth > r.clientWidth; }), JSON.stringify(s));
  check('music: every control is at least 40 px', (await smallTargets(page, 40)).length === 0, JSON.stringify(await smallTargets(page, 40)));
  r = await page.evaluate(() => { const n = document.querySelector('#drawer .mus-note[data-s="4"]'); return { w: n.offsetWidth, m: n.getAttribute('data-m') }; });
  check('music: a held note is drawn over its steps (C6 - - = 3 steps)', r.m === '84' && r.w === 3 * 34 - 2, JSON.stringify(r));
  // tap an empty cell: step 1, row of A5 (81)
  const cellXY = async (step, midi) => { await page.waitForTimeout(60); return page.evaluate(([step, midi]) => { const g = document.querySelector('#drawer .mus-grid'), roll = document.querySelector('#drawer .mus-roll'); roll.scrollIntoView({ block: 'start' }); const top = (84 - midi) * 24; roll.scrollTop = Math.max(0, top - 60); roll.scrollLeft = Math.max(0, step * 34 - 100); const b = g.getBoundingClientRect(); return { x: Math.round(b.left + step * 34 + 17), y: Math.round(b.top + top + 12) }; }, [step, midi]); };
  await page.evaluate(() => { document.querySelector('#drawer .mus-roll').scrollIntoView(); });
  r = await page.evaluate(() => { document.querySelector('#drawer .mus-grid').setAttribute('data-keep', '1'); return 0; });
  let xy = await cellXY(13, 81);
  n0 = (await audio(page)).nodes.length;
  await page.touchscreen.tap(xy.x, xy.y);
  r = await page.evaluate(() => ({ notes: document.querySelectorAll('#drawer .mus-note').length, code: document.querySelector('#drawer .drw-code').textContent.split('\n')[1], same: !!document.querySelector('#drawer .mus-grid[data-keep]') }));
  a = await audio(page); nn = sinceN(a, n0);
  check('music: tapping a cell adds a note of the chosen length (2 steps), cutting the held D5 short, without rebuilding the grid', r.notes === 7 && r.code === '  lead square vol 0.7: E5 . G5 . C6 - - . G5 . E5 . D5 A5 - .' && r.same, JSON.stringify(r));
  check('music: …and plays it (880 Hz, square)', nn.some(x => x.kind === 'osc' && x.type === 'square' && x.f[0][1] === 880), JSON.stringify(nn).slice(0, 300));
  xy = await cellXY(13, 81);
  await page.touchscreen.tap(xy.x, xy.y);
  r = await page.evaluate(() => document.querySelector('#drawer .drw-code').textContent.split('\n')[1]);
  check('music: tapping a note removes it (its hold goes too)', r === '  lead square vol 0.7: E5 . G5 . C6 - - . G5 . E5 . D5 . . .', r);
  xy = await cellXY(0, 72);
  await page.touchscreen.tap(xy.x, xy.y);
  r = await page.evaluate(() => document.querySelector('#drawer .drw-code').textContent.split('\n')[1]);
  check('music: a note on a step that has one makes a chord (one note per step is not a limit)', r === '  lead square vol 0.7: C5+E5 . G5 . C6 - - . G5 . E5 . D5 . . .', r);
  // drag the D5 at step 12 sideways (touch): 4 steps long
  await cellXY(12, 74);
  r = await page.evaluate(() => { const n = document.querySelector('#drawer .mus-note[data-s="12"][data-m="74"]'); const b = n.getBoundingClientRect(); return { x: b.left + 10, y: b.top + 10 }; });
  await page.evaluate(([x, y]) => {
    const n = document.querySelector('#drawer .mus-note[data-s="12"][data-m="74"]'), g = document.querySelector('#drawer .mus-grid');
    const ev = (t, x) => new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, button: 0, isPrimary: true });
    n.dispatchEvent(ev('pointerdown', x)); g.dispatchEvent(ev('pointermove', x + 40)); g.dispatchEvent(ev('pointermove', x + 100)); g.dispatchEvent(ev('pointerup', x + 100));
  }, [r.x, r.y]);
  r = await page.evaluate(() => ({ line: document.querySelector('#drawer .drw-code').textContent.split('\n')[1], w: document.querySelector('#drawer .mus-note[data-s="12"][data-m="74"]').offsetWidth }));
  check('music: dragging a note sideways sets its length (D5 - - -)', r.line === '  lead square vol 0.7: C5+E5 . G5 . C6 - - . G5 . E5 . D5 - - -' && r.w === 4 * 34 - 2, JSON.stringify(r));
  // drums: switch track, tap Clap lane at step 1
  await page.tap('#drawer .mus-tbar .drw-chip:text("drums")');
  r = await page.evaluate(() => ({ keys: [...document.querySelectorAll('#drawer .mus-key')].map(k => k.textContent), hits: document.querySelectorAll('#drawer .mus-hit').length }));
  check('music: the drum track has Kick / Snare / Hat / Clap lanes with its hits', r.keys.join() === 'Kick K,Snare S,Hat H,Clap C' && r.hits === 10, JSON.stringify(r));
  r = await page.evaluate(() => { const g = document.querySelector('#drawer .mus-grid'); document.querySelector('#drawer .mus-roll').scrollLeft = 0; const b = g.getBoundingClientRect(); return { x: Math.round(b.left + 34 + 17), y: Math.round(b.top + 3 * 44 + 22) }; });
  n0 = (await audio(page)).nodes.length;
  await page.touchscreen.tap(r.x, r.y);
  a = await audio(page); nn = sinceN(a, n0);
  r = await page.evaluate(() => document.querySelector('#drawer .drw-code').textContent.split('\n')[3]);
  check('music: tapping a drum lane adds a hit (and plays the clap: noise through a band of filters)', r === '  drums: K C H . S . H . K K H . S . H H' && nn.some(x => x.kind === 'buffer') && nn.filter(x => x.kind === 'filter').length === 2, r);
  // BPM, steps
  await page.evaluate(() => { const set = (label, v) => { const row = [...document.querySelectorAll('#drawer .drw-sl')].find(x => x.querySelector('label').textContent === label); const b = row.querySelector('.drw-num'); b.value = v; b.dispatchEvent(new Event('change')); }; set('BPM', '150'); set('Steps', '8'); set('Swing', '0.2'); });
  r = await page.evaluate(() => document.querySelector('#drawer .drw-code').textContent);
  check('music: BPM, steps (8: every track is cut) and swing change the block', r === 'music theme: 150 bpm, 8 steps, swing 0.2\n  lead square vol 0.7: C5+E5 . G5 . C6 - - .\n  bass triangle: C3 - - - C3 - - -\n  drums: K C H . S . H .', r);
  // mute / volume / wave of bass
  await page.tap('#drawer .mus-tbar .drw-chip:text("bass")');
  await page.tap('#drawer .mus-tset .drw-btn:text("Mute")');
  await page.tap('#drawer .mus-tset .drw-seg button:text-is("saw")');
  r = await page.evaluate(() => document.querySelector('#drawer .drw-code').textContent.split('\n')[2]);
  check('music: per-track waveform and mute', r === '  bass saw mute: C3 - - - C3 - - -', r);
  // add a track, write a note
  await page.tap('#drawer .mus-tbar .drw-add:text("+ Track")');
  xy = await cellXY(2, 60);
  await page.touchscreen.tap(xy.x, xy.y);
  r = await page.evaluate(() => document.querySelector('#drawer .drw-code').textContent.split('\n'));
  check('music: + Track adds a melodic track (named pad) that you can write into', r[4] === '  pad square: . . C4 - . . . .', JSON.stringify(r));
  // playback: loop on the fake clock
  await page.evaluate(() => document.querySelector('#drawer .mus-grid').setAttribute('data-keep', '1'));
  n0 = (await audio(page)).nodes.length;
  await page.tap('#drawer .mus-tp .drw-btn:text("Loop")');
  await page.waitForTimeout(450);
  r = await page.evaluate(() => { const ph = document.querySelector('#drawer .mus-ph'); return { disp: ph.style.display, tr: ph.style.transform, playing: _drawer.ctx.music.playing, same: !!document.querySelector('#drawer .mus-grid[data-keep]') }; });
  await page.waitForTimeout(500);
  const r3 = await page.evaluate(() => document.querySelector('#drawer .mus-ph').style.transform);
  a = await audio(page); nn = sinceN(a, n0);
  check('music: Loop plays with a moving playhead (transform only, the roll is not rebuilt)', r.playing && r.disp === 'block' && /translateX/.test(r.tr) && r3 !== r.tr && r.same, JSON.stringify(r) + ' ' + r3);
  // timing: notes of lead (square) start at multiples of the step (0.1 s at 150 bpm), swing 0.2 on odd steps
  const sq = nn.filter(x => x.kind === 'osc' && x.type === 'square').map(x => x.startT).sort((p, q) => p - q);
  const kicks = nn.filter(x => x.kind === 'osc' && x.type === 'sine' && x.f && x.f[0][1] === 150).map(x => x.startT).sort((p, q) => p - q);
  const step = 60 / 150 / 4;
  check('music: lookahead scheduling on the audio clock: notes start exactly one bar (8 steps) apart, chords together',
    sq.length >= 4 && Math.abs(sq[1] - sq[0]) < 1e-6 && kicks.length >= 2 && Math.abs((kicks[1] - kicks[0]) - 8 * step) < 1e-6, JSON.stringify({ sq, kicks }));
  check('music: …the muted bass is not played; the pad (C4 at step 2) is', !nn.some(x => x.kind === 'osc' && x.type === 'sawtooth') && nn.some(x => x.kind === 'osc' && x.type === 'square' && Math.abs(x.f[0][1] - 261.6256) < 0.01 && Math.abs((x.startT - kicks[0]) - 2 * step) < 1e-6), JSON.stringify(nn.filter(x => x.kind === 'osc').map(x => [x.type, x.f[0][1], x.startT])).slice(0, 400));
  const clap = nn.filter(x => x.kind === 'buffer').map(x => x.startT).sort((p, q) => p - q);
  check('music: swing delays the odd steps (the clap on step 1 comes 1.2 steps after the kick)', clap.length >= 1 && Math.abs((clap[0] - kicks[0]) - 1.2 * step) < 1e-6, JSON.stringify({ clap: clap.slice(0, 3), kick: kicks[0] }));
  check('music: the lead\'s per-track volume 0.7 scales its notes', nn.some(x => x.kind === 'gain' && x.g && x.g.some(e => e[0] === 'lin' && Math.abs(e[1] - 0.3 * 0.7) < 1e-4)), '');
  await page.tap('#drawer .mus-tp .drw-btn:text("Stop")');
  r = await page.evaluate(() => ({ playing: _drawer.ctx.music.playing, ph: document.querySelector('#drawer .mus-ph').style.display }));
  check('music: Stop stops (playhead hidden)', !r.playing && r.ph === 'none', JSON.stringify(r));
  // save, reopen = same
  await page.tap('#drawer .drw-ft .drw-pri');
  const saved = await page.evaluate(() => _drawerRead('music', 'theme'));
  check('music: Save to program writes the block in place', saved === 'music theme: 150 bpm, 8 steps, swing 0.2\n  lead square vol 0.7: C5+E5 . G5 . C6 - - .\n  bass saw mute: C3 - - - C3 - - -\n  drums: K C H . S . H .\n  pad square: . . C4 - . . . .' && await page.evaluate(() => _drawerBlocks('music')[0].startLine === 10), saved);
  await page.evaluate(() => _drawerClose());
  await page.evaluate(() => _drawerOpen('music'));
  r = await page.evaluate(() => ({ code: document.querySelector('#drawer .drw-code').textContent, bpm: [...document.querySelectorAll('#drawer .drw-sl')].find(x => x.querySelector('label').textContent === 'BPM').querySelector('.drw-num').value, tracks: [...document.querySelectorAll('#drawer .mus-tbar .drw-chip:not(.drw-add)')].map(c => c.textContent + (c.classList.contains('muted') ? '(m)' : '')) }));
  check('music: reopened, the same song comes back (round trip)', r.code === saved && r.bpm === '150' && r.tracks.join() === '🎹 lead,🎹 bass(m),🥁 drums,🎹 pad', JSON.stringify(r));
  await page.evaluate(() => _drawerClose());
  // hand-edited music: bars, comment line, unknown header part, a bad line
  const HAND = 'music hand: 100 bpm, 8 steps, groove 3\n  // intro\n  lead square: C5 . | E5 . | G5 - | . .\n  oops this is not a track\n  drums: K . H . | S . H .';
  await page.evaluate(t => { _drawerWrite('music', 'hand', t); }, HAND);
  await page.evaluate(() => _drawerOpen('music'));
  await page.tap('#drawer .drw-chips .drw-chip:text-is("hand")');
  r = await page.evaluate(() => ({ code: document.querySelector('#drawer .drw-code').textContent, kept: [...document.querySelectorAll('#drawer .drw-kept code')].map(c => c.textContent) }));
  check('music: a hand-written block (bars |, comment, unknown header part, a line it cannot read) reads back and, unchanged, is written exactly as it is', r.code === HAND, r.code);
  check('music: …the comment, the unreadable line and the unknown part are listed as kept as is', r.kept.length === 3 && r.kept[0] === '// intro' && /^oops this is not a track/.test(r.kept[1]) && /^groove 3/.test(r.kept[2]), JSON.stringify(r.kept));
  await page.evaluate(() => { const set = (label, v) => { const row = [...document.querySelectorAll('#drawer .drw-sl')].find(x => x.querySelector('label').textContent === label); const b = row.querySelector('.drw-num'); b.value = v; b.dispatchEvent(new Event('change')); }; set('BPM', '110'); });
  xy = await cellXY(1, 72);
  await page.touchscreen.tap(xy.x, xy.y);
  await page.tap('#drawer .drw-ft .drw-pri');
  r = await page.evaluate(() => _drawerRead('music', 'hand'));
  check('music: after an edit only the changed line and setting are rewritten; kept lines stay in place', r === 'music hand: 110 bpm, 8 steps, groove 3\n  // intro\n  lead square: C5 C5 E5 . G5 - . .\n  oops this is not a track\n  drums: K . H . | S . H .', r);
  // leaving the tool while playing stops the music
  await page.tap('#drawer .mus-tp .drw-btn:text("Play")');
  r = await page.evaluate(() => { const c = _drawer.ctx; const was = c.music.playing; _drawerBack(); return { was, now: c.music.playing }; });
  check('music: leaving the tool while it plays stops the music', r.was === true && r.now === false, JSON.stringify(r));
  await page.evaluate(() => _drawerClose());
  // play once ends by itself
  await load(page, 'music short: 400 bpm, 2 steps\n  a sine: C5 .\n');
  await page.evaluate(() => _drawerOpen('music'));
  await page.tap('#drawer .mus-tp .drw-btn:text("Play")');
  await page.waitForTimeout(700);
  r = await page.evaluate(() => ({ playing: _drawer.ctx.music.playing, ph: document.querySelector('#drawer .mus-ph').style.display }));
  check('music: ▶ Play plays once and stops by itself', !r.playing && r.ph === 'none', JSON.stringify(r));
  await page.evaluate(() => _drawerClose());
  check('phone: no page or console errors', page.errors.length === 0 && page.consoleErrors.length === 0, page.errors.concat(page.consoleErrors).join(' | '));
  await page.context().close();

  // ═════════════════════════════ DESKTOP ═════════════════════════════
  page = await openIde(browser, fileUrl, DESK);
  await page.click('.header .hdr-btn[title="Drawer"]');
  s = await D(page);
  check('desktop: the drawer is a centred panel, not full screen', s.open && s.rect.w < 1200 && s.rect.h < 800 && Math.abs(s.rect.x + s.rect.w / 2 - 600) <= 1 && Math.abs(s.rect.y + s.rect.h / 2 - 400) <= 1, JSON.stringify(s.rect));
  r = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('#drawer .drw')); return { bg: cs.backgroundColor, root: getComputedStyle(document.documentElement).getPropertyValue('--bg2').trim() }; });
  check('desktop: styled with the IDE\'s colours (--bg2 panel)', r.bg === 'rgb(15, 17, 24)' && r.root === '#0f1118', JSON.stringify(r));
  check('desktop: tools in a grid of cards', (await page.evaluate(() => { const c = [...document.querySelectorAll('#drawer .drw-card')].map(x => x.getBoundingClientRect().top); return c.length >= 3 && c[0] === c[1]; })));
  await page.keyboard.press('Escape');
  check('desktop: Escape closes the drawer', !(await D(page)).open);
  await page.click('.header .hdr-btn[title="Drawer"]');
  await page.mouse.click(20, 400);
  check('desktop: a click outside the panel closes it', !(await D(page)).open);
  await page.click('.header .hdr-btn[title="Drawer"]');
  await page.click('#drawer .drw-card[data-tool="test"]');
  await page.click('#testDirty');
  page.answers.push(false);
  await page.mouse.click(20, 400);
  check('desktop: a click outside with unsaved changes asks first', (await D(page)).open && page.dialogs.length === 1);
  page.answers.push(true);
  await page.keyboard.press('Escape');
  check('desktop: Escape with unsaved changes asks; OK closes', !(await D(page)).open && page.dialogs.length === 2);
  // sound tool on desktop with mouse
  await load(page, 'sound pew: triangle 440 > 220, 100ms\nexport fn run() {\n  play(pew)\n}\n');
  await page.click('.header .hdr-btn[title="Drawer"]');
  await page.click('#drawer .drw-card[data-tool="sound"]');
  n0 = (await audio(page)).nodes.length;
  await page.click('#drawer .drw-play');
  a = await audio(page); nn = sinceN(a, n0); osc = nn.find(x => x.kind === 'osc');
  check('desktop: Sound ▶ with the mouse: triangle 440 → 220 Hz linear', osc && osc.type === 'triangle' && osc.f[0][1] === 440 && osc.f.some(e => e[0] === 'lin' && e[1] === 220), JSON.stringify(osc));
  await page.click('#drawer .drw-seg button:text-is("exponential")');
  await page.click('#drawer .drw-play');
  r = await page.evaluate(() => document.querySelector('#drawer .drw-code').textContent);
  a = await audio(page); osc = a.nodes.filter(x => x.kind === 'osc').pop();
  check('desktop: curve exponential → an exponential ramp', r === 'sound pew: triangle 440 > 220, 100ms, curve exp' && osc.f.some(e => e[0] === 'exp' && e[1] === 220), r);
  await page.click('#drawer .drw-ft .drw-pri');
  await page.click('#drawer .drw-x');
  r = await page.evaluate(() => _projText());
  check('desktop: saved into the single file in place (no new file needed)', r === 'sound pew: triangle 440 > 220, 100ms, curve exp\nexport fn run() {\n  play(pew)\n}\n', r);
  // music: mouse drag to make a long note
  await load(page, 'music m: 120 bpm, 8 steps\n  lead square: . . . . . . . .\n');
  await page.click('.header .hdr-btn[title="Drawer"]');
  await page.click('#drawer .drw-card[data-tool="music"]');
  await page.waitForTimeout(100);
  xy = await cellXY(1, 72);
  await page.mouse.click(xy.x, xy.y);
  r = await page.evaluate(() => { const n = document.querySelector('#drawer .mus-note'); const b = n.getBoundingClientRect(); return { x: b.left + 5, y: b.top + 5 }; });
  await page.mouse.move(r.x, r.y); await page.mouse.down(); await page.mouse.move(r.x + 60, r.y, { steps: 3 }); await page.mouse.move(r.x + 160, r.y, { steps: 3 }); await page.mouse.up();
  r = await page.evaluate(() => document.querySelector('#drawer .drw-code').textContent.split('\n')[1]);
  check('desktop: Music — click adds a note, dragging it with the mouse makes it longer', r === '  lead square: . C5 - - - - . .', r);
  r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  check('desktop: no horizontal overflow', r.sw <= r.iw, JSON.stringify(r));
  page.answers.push(true);
  await page.click('#drawer .drw-x');
  check('desktop: no page or console errors', page.errors.length === 0 && page.consoleErrors.length === 0, page.errors.concat(page.consoleErrors).join(' | '));
  await page.context().close();

  // ═════════════ the drawer code alone (no tool registered early) ═════════════
  page = await openIde(browser, fileUrl, PHONE, { early: false });
  r = await page.evaluate(() => ({ ids: _drawerToolList().map(t => t.id), live: window._drawerTools === window._drawerTools && Array.isArray(window._drawerTools) }));
  check('without early tools the list holds the drawer\'s own tools', r.ids.join() === 'sound,music' && r.live, JSON.stringify(r));
  await page.context().close();

  await browser.close();
  console.log('\n' + passed + '/' + (passed + failed) + ' drawer checks passed');
  process.exit(failed ? 1 : 0);
})();

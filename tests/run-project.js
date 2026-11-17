#!/usr/bin/env node
// Checks the multi-file project editor of an Emit IDE build in headless Chromium: the project model,
// file tabs, per-file editor state, errors across files, module autocomplete, find in all files,
// open/save/share/autosave of bundles and the `use` lines of non-entry files.
// About half of the checks run in a phone viewport with touch (360 px wide), the rest on a desktop viewport.
// The run is offline: every network request is aborted (nothing here needs a CDN library).
//
//   node tests/run-project.js [path/to/emit-ide.html]
//
// TEST-ONLY SHIMS (in the page, never in the product): where a check needs a compile result for a
// project of several files — errors in `path:line:col: message` form, or a successful Run — the page's
// global `compile` is replaced by a stub (see stubCompile). The IDE-side handling is what is tested;
// the real multi-file compiler is only exercised by the "after merge" section at the end, which
// prints SKIP while the IDE still runs on the temporary stand-ins for _emitSplitBundle/_emitModuleIndex.
//
// Exit code 0 when every check passes.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

let failed = 0, passed = 0, skipped = 0;
function check(label, ok, detail) {
  if (ok) { passed++; console.log('PASS  ' + label); }
  else { failed++; console.log('FAIL  ' + label + (detail !== undefined ? '\n      ' + String(detail).slice(0, 600) : '')); }
}
function skip(label, why) { skipped++; console.log('SKIP  ' + label + ' — ' + why); }

const PHONE = { viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true };
const DESK = { viewport: { width: 1200, height: 800 } };

const MAIN = 'import game.physics\nimport game.draw\n\nexport fn run() {\n  physics.step(1.0)\n  draw.render()\n}\n';
const PHYS = 'package game\n\npublic let gravity = 9\npublic mut ticks = 0\n\npublic fn step(dt: num) num {\n  return dt\n}\n\npublic fn reset() {\n}\n\nfn hidden() int {\n  return 1\n}\n';
const DRAW = 'package game\n\npublic fn render() {\n}\n\npublic fn resize(w: int, h: int) int {\n  return w\n}';
const BUNDLE = MAIN + '//// file: game/physics.emit\n' + PHYS + '//// file: game/draw.emit\n' + DRAW;
const PHYS_SRC = PHYS.replace(/\n$/, '');   // inside the bundle the file ends where the next marker line starts
const SINGLE = 'export fn hello() int {\n  print(42)\n  return 7\n}\n';

// Opens the IDE. opts: {ctx} reuse a context, {hash} URL fragment, {init} script run before the page's own.
// page.dialogs collects every dialog; page.answers is a queue of replies (string = prompt text / true = OK /
// false = Cancel); with an empty queue a dialog is accepted with its default value.
async function openIde(browser, fileUrl, mode, opts = {}) {
  const ctx = opts.ctx || await browser.newContext(mode);
  const page = await ctx.newPage();
  page.errors = []; page.consoleErrors = []; page.dialogs = []; page.answers = [];
  page.on('pageerror', e => page.errors.push(e.message.slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.consoleErrors.push(m.text().slice(0, 300)); });
  page.on('dialog', async d => {
    page.dialogs.push({ type: d.type(), message: d.message(), value: d.defaultValue() });
    const a = page.answers.length ? page.answers.shift() : true;
    if (a === false) await d.dismiss(); else await d.accept(typeof a === 'string' ? a : (d.type() === 'prompt' ? d.defaultValue() : undefined));
  });
  await page.route(/^https?:/, route => route.abort());
  if (opts.init) await page.addInitScript(opts.init);
  await page.goto(fileUrl + (opts.hash ? '#' + opts.hash : ''));
  await page.waitForFunction(() => typeof compileAndRun === 'function' && typeof _projLoad === 'function' && typeof EX === 'object');
  await page.waitForTimeout(150);   // the start-up code (autosave / share link restore) is asynchronous
  await page.evaluate(() => {
    try { closeWelcome(); } catch (e) {}
    window._saved = [];
    window._download = function (name, content, type) { window._saved.push({ name: name, content: typeof content === 'string' ? content : null, type: type }); };
  });
  return page;
}
// The pattern every other suite uses to put a program into the editor
const setEditor = (page, text) => page.evaluate(t => {
  const ed = document.getElementById('editor');
  ed.value = t;
  ed.dispatchEvent(new Event('input'));
}, text);
const state = page => page.evaluate(() => ({
  paths: _proj.files.map(f => f.path), active: _proj.active, value: document.getElementById('editor').value,
  strip: getComputedStyle(document.getElementById('fileTabs')).display !== 'none',
  tabs: [...document.querySelectorAll('#fileTabs .ftab')].map(t => ({
    text: t.querySelector('.ftab-n').textContent, title: t.title, active: t.classList.contains('active'),
    entry: !!t.querySelector('.ftab-e'), err: !!t.querySelector('.ftab-err'), menu: !!t.querySelector('.ftab-m') })),
  sheet: document.getElementById('projSheet').classList.contains('show'),
  sheetItems: [...document.querySelectorAll('#projSheet button')].map(b => b.textContent),
  status: document.getElementById('sTxt').innerText, right: document.getElementById('sR').innerText,
  curPos: document.getElementById('curPos').textContent,
  gutter: document.querySelectorAll('#gutter .ln').length,
  hl: document.getElementById('hlInner').textContent,
  output: document.getElementById('tab-output').innerText,
}));
const popup = page => page.evaluate(() => {
  const p = document.getElementById('acPopup');
  const rows = [...p.querySelectorAll('.ac-item')].map(el => ({ name: el.querySelector('.ac-name').textContent, desc: el.querySelector('.ac-desc').textContent }));
  return { shown: p.classList.contains('show'), rows: p.classList.contains('show') ? rows : [] };
});
const names = p => p.rows.map(r => r.name);
// TEST-ONLY SHIM: replace the page's compile(). kind 'errors': a result carrying `errors`; 'throw': throws
// `errors[0]`; 'ok': a clean result. The result itself comes from the real compiler run on a one-line program.
const stubCompile = (page, kind, errors) => page.evaluate(([kind, errors]) => {
  if (!window._realCompile) window._realCompile = compile;
  window.compile = function (source, target) {
    window._compiled = source;
    if (kind === 'throw') throw new Error(errors[0]);
    const r = window._realCompile('export fn stub() {\n  print(1)\n}\n', target);
    r.errors = kind === 'errors' ? errors.slice() : [];
    return r;
  };
}, [kind, errors || []]);
const unstubCompile = page => page.evaluate(() => { if (window._realCompile) window.compile = window._realCompile; });
const run = async page => { await page.evaluate(() => compileAndRun()); await page.waitForTimeout(250); };
// Cursor to the end of the editor, optional new line, then real key events
async function typeAtEnd(page, text, { newline = true } = {}) {
  await page.evaluate(() => { try { hideAC(); if (innerWidth < 768) showView('edit'); } catch (e) {} const ed = document.getElementById('editor'); ed.focus(); ed.selectionStart = ed.selectionEnd = ed.value.length; });
  if (newline) await page.keyboard.press('Enter');
  await page.keyboard.type(text, { delay: 12 });
  await page.waitForTimeout(550);   // the module index is rebuilt after 400 ms without a keystroke
}
const curLine = page => page.evaluate(() => { const ed = document.getElementById('editor'); const b = ed.value.substring(0, ed.selectionStart); return b.substring(b.lastIndexOf('\n') + 1); });

(async () => {
  const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'emit-ide-1_32.html'));
  const fileUrl = 'file://' + file;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'emit-project-'));
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  let page, s, p, r;

  // ═════════════════════════════ PHONE (360 px, touch) ═════════════════════════════
  // ── Project model, single file ──
  page = await openIde(browser, fileUrl, PHONE);
  s = await state(page);
  check('phone: fresh page is one file main.emit, tab strip hidden', s.paths.join() === 'main.emit' && !s.strip && s.tabs.length === 0, JSON.stringify(s.paths) + ' strip=' + s.strip);
  check('phone: single-file bundle is the source itself', await page.evaluate(() => _projText() === document.getElementById('editor').value));
  await setEditor(page, SINGLE);
  await run(page);
  s = await state(page);
  check('phone: ed.value = single file + input + compileAndRun() runs (pattern of the other suites)', s.status === 'Done' && /hello\(\) = 7/.test(s.output), s.status + ' | ' + s.output.slice(0, 200));
  check('phone: that pattern replaced the one file only, no tabs', s.paths.join() === 'main.emit' && !s.strip && await page.evaluate(t => _projText() === t, SINGLE));
  check('phone: single-file stats line has no file count', !/\d+ files?,/.test(s.output), s.output.slice(0, 120));
  r = await page.evaluate(() => { const b = _emitJoinBundle([{ path: 'main.emit', source: 'a\nb' }, { path: 'x/y.emit', source: '' }, { path: 'z.emit', source: 'c\n' }]); return { b, back: _emitSplitBundle(b) }; });
  check('model: join/split round trip (empty file, trailing newline)', r.b === 'a\nb\n//// file: x/y.emit\n\n//// file: z.emit\nc\n' && JSON.stringify(r.back) === JSON.stringify([{ path: 'main.emit', source: 'a\nb' }, { path: 'x/y.emit', source: '' }, { path: 'z.emit', source: 'c\n' }]), JSON.stringify(r));
  r = await page.evaluate(() => { const b = _emitJoinBundle([{ path: 'app.emit', source: 'x' }]); return { b, back: _emitSplitBundle(b), plain: _emitSplitBundle('just text\n// a comment') }; });
  check('model: an entry file not named main.emit gets a marker; plain text is main.emit', r.b === '//// file: app.emit\nx' && r.back.length === 1 && r.back[0].path === 'app.emit' && r.plain.length === 1 && r.plain[0].path === 'main.emit' && r.plain[0].source === 'just text\n// a comment', JSON.stringify(r));

  // ── Adding a file: File menu, validation ──
  await page.evaluate(() => showView('edit'));
  page.answers.push('game/physics');
  await page.selectOption('#exportSel', 'newfile');
  await page.waitForTimeout(100);
  s = await state(page);
  check('phone: File → New file in project… adds game/physics.emit and shows the tab strip', s.paths.join() === 'main.emit,game/physics.emit' && s.strip && s.active === 1, JSON.stringify(s.paths) + ' ' + JSON.stringify(page.dialogs.slice(-1)));
  check('phone: the prompt suggests name.emit', page.dialogs.length && page.dialogs[page.dialogs.length - 1].value === 'name.emit', JSON.stringify(page.dialogs.slice(-1)));
  check('phone: a new file in a folder starts with its package line and one commented example', /^package game\n\n\/\/ public fn /.test(s.value) && s.value.split('\n').filter(l => l.trim()).length === 2, JSON.stringify(s.value));
  check('phone: tabs show the file name, the full path as tooltip, the entry mark on the first', s.tabs.length === 2 && s.tabs[0].text === 'main.emit' && s.tabs[0].entry && !s.tabs[1].entry && s.tabs[1].text === 'physics.emit' && /^game\/physics\.emit/.test(s.tabs[1].title) && s.tabs[1].active && s.tabs[1].menu && !s.tabs[0].menu, JSON.stringify(s.tabs));
  r = await page.evaluate(() => ['', 'a b.emit', '/x.emit', 'a//b.emit', '../x.emit', 'x.txt', 'ü.emit', 'dir/.emit', 'game/physics.emit', 'ok_1/new-file.v2.emit'].map(p => _projPathError(p, -1)));
  check('validation: bad paths are refused with a reason, a good one passes', r.slice(0, 9).every(e => e.length > 10) && r[9] === '' && /already/.test(r[8]), JSON.stringify(r));
  page.dialogs.length = 0; page.answers.push('bad name.emit');
  await page.tap('#fileTabs .ftab-add');
  await page.waitForTimeout(100);
  s = await state(page);
  check('phone: + in the strip with an invalid path shows the reason and adds nothing', s.paths.length === 2 && page.dialogs.length === 2 && page.dialogs[1].type === 'alert' && /not a valid file path/.test(page.dialogs[1].message), JSON.stringify(page.dialogs));
  page.dialogs.length = 0; page.answers.push('game/physics.emit');
  await page.tap('#fileTabs .ftab-add');
  await page.waitForTimeout(100);
  check('phone: a path that exists is refused', (await state(page)).paths.length === 2 && /already has a file/.test((page.dialogs[1] || {}).message || ''), JSON.stringify(page.dialogs));
  page.dialogs.length = 0; page.answers.push('my-notes.emit', false);
  await page.tap('#fileTabs .ftab-add');
  await page.waitForTimeout(100);
  check('phone: a name that cannot be imported asks first (Cancel adds nothing)', (await state(page)).paths.length === 2 && page.dialogs.length === 2 && page.dialogs[1].type === 'confirm' && /cannot import/.test(page.dialogs[1].message), JSON.stringify(page.dialogs));
  page.answers.push('draw');
  await page.tap('#fileTabs .ftab-add');
  await page.waitForTimeout(100);
  s = await state(page);
  check('phone: "draw" becomes draw.emit (no package line at the top level)', s.paths[2] === 'draw.emit' && s.active === 2 && /^\/\/ public fn /.test(s.value), JSON.stringify(s.paths) + JSON.stringify(s.value));

  // ── Touch targets, switching, per-file state ──
  r = await page.evaluate(() => {
    const box = el => { const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; };
    return { tabs: [...document.querySelectorAll('#fileTabs .ftab')].map(box), menu: box(document.querySelector('#fileTabs .ftab-m')), add: box(document.querySelector('#fileTabs .ftab-add')) };
  });
  check('phone: tabs, ⋯ and + are at least 40 px touch targets', r.tabs.every(b => b.h >= 40 && b.w >= 40) && r.menu.w >= 40 && r.menu.h >= 40 && r.add.w >= 40 && r.add.h >= 40, JSON.stringify(r));
  const LONG = Array.from({ length: 120 }, (_, i) => 'let v' + i + ' = ' + i + '   // a fairly long line so the editor can scroll sideways too ' + 'x'.repeat(30)).join('\n');
  await page.tap('#fileTabs .ftab[data-i="0"]');
  await setEditor(page, LONG);
  r = await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const a = ed.value.indexOf('let v80'), b = a + 7;
    ed.focus(); ed.setSelectionRange(a, b); ed.scrollTop = 900; ed.scrollLeft = 55;
    return { top: ed.scrollTop, left: ed.scrollLeft, a, b };
  });
  await page.tap('#fileTabs .ftab[data-i="1"]');
  s = await state(page);
  check('phone: tapping a tab switches the editor to that file', s.active === 1 && /^package game/.test(s.value) && s.tabs[1].active && !s.tabs[0].active, s.active + ' ' + s.value.slice(0, 30));
  check('phone: highlight overlay, gutter and Ln/Col follow the switch', s.hl === s.value + '\n' && s.gutter === s.value.split('\n').length && s.curPos === 'Ln 1 Col 1', s.gutter + ' ' + s.curPos + ' ' + JSON.stringify(s.hl.slice(0, 40)));
  await page.evaluate(() => { const ed = document.getElementById('editor'); ed.focus(); ed.setSelectionRange(8, 12); });
  await page.keyboard.type('zone');
  await page.tap('#fileTabs .ftab[data-i="0"]');
  const back = await page.evaluate(() => { const ed = document.getElementById('editor'); return { top: ed.scrollTop, left: ed.scrollLeft, a: ed.selectionStart, b: ed.selectionEnd, len: ed.value.length, tr: document.getElementById('hlInner').style.transform }; });
  check('phone: cursor, selection and scroll position of a file are restored', back.a === r.a && back.b === r.b && Math.abs(back.top - r.top) <= 1 && Math.abs(back.left - r.left) <= 1 && back.len === LONG.length, JSON.stringify([r, back]));
  check('phone: the overlay is scrolled with it and Ln/Col shows the restored line', /translate\(-55px, ?-900px\)/.test(back.tr) && (await state(page)).curPos === 'Ln 81 Col 1', back.tr + ' ' + (await state(page)).curPos);
  await page.tap('#fileTabs .ftab[data-i="1"]');
  r = await page.evaluate(() => { const ed = document.getElementById('editor'); return { v: ed.value.split('\n')[0], a: ed.selectionStart }; });
  check('phone: text typed in the other file is kept there, with its cursor', r.v === 'package zone' && r.a === 12, JSON.stringify(r));
  check('phone: the bundle has one marker line per extra file and none inside a file', await page.evaluate(() => { const t = _projText(); return t.split('\n').filter(l => l.indexOf('//// file: ') === 0).join('|') === '//// file: game/physics.emit|//// file: draw.emit' && _proj.files.every(f => f.source.indexOf('//// file: ') < 0); }));

  // ── Actions: ⋯ / long press, rename, make entry, delete ──
  await page.tap('#fileTabs .ftab-m');
  s = await state(page);
  check('phone: ⋯ on the active tab opens the actions', s.sheet && ['Rename…', 'Delete'].every(x => s.sheetItems.includes(x)) && s.sheetItems.some(x => /^Make entry file/.test(x)) && s.sheetItems.includes('Cancel'), JSON.stringify(s.sheetItems));
  r = await page.evaluate(() => [...document.querySelectorAll('#projSheet button')].map(b => Math.round(b.getBoundingClientRect().height)));
  check('phone: every action is at least 40 px high and inside the screen', r.every(h => h >= 40) && await page.evaluate(() => document.querySelector('#projSheet .fsheet').getBoundingClientRect().bottom <= innerHeight + 1), JSON.stringify(r));
  page.dialogs.length = 0; page.answers.push('game/world.emit');
  await page.tap('#projSheet button:has-text("Rename")');
  await page.waitForTimeout(100);
  s = await state(page);
  check('phone: Rename changes the path (prompt pre-filled with the old one)', s.paths[1] === 'game/world.emit' && s.tabs[1].text === 'world.emit' && !s.sheet && page.dialogs[0].value === 'game/physics.emit', JSON.stringify(s.paths));
  page.dialogs.length = 0; page.answers.push('draw.emit');
  await page.evaluate(() => _projRename(1));
  check('phone: renaming onto another file is refused', (await state(page)).paths[1] === 'game/world.emit' && /already has a file/.test((page.dialogs[1] || {}).message || ''), JSON.stringify(page.dialogs));
  // long press on a tab that is not active
  await page.dispatchEvent('#fileTabs .ftab[data-i="2"]', 'pointerdown', { clientX: 300, clientY: 110, pointerType: 'touch', bubbles: true });
  await page.waitForTimeout(700);
  await page.dispatchEvent('#fileTabs .ftab[data-i="2"]', 'pointerup', { pointerType: 'touch', bubbles: true });
  s = await state(page);
  check('phone: a long press on another tab opens its actions (with Open)', s.sheet && s.sheetItems[0] === 'Open' && s.active === 1 && /draw\.emit/.test(await page.evaluate(() => document.querySelector('#projSheet .fsheet-t').textContent)), JSON.stringify(s.sheetItems));
  await page.waitForTimeout(400);
  await page.tap('#projSheet button:has-text("Cancel")');
  check('phone: Cancel closes the actions and changes nothing', !(await state(page)).sheet && (await state(page)).paths.length === 3);
  await page.dispatchEvent('#fileTabs .ftab[data-i="0"]', 'pointerdown', { clientX: 30, clientY: 110, pointerType: 'touch', bubbles: true });
  await page.dispatchEvent('#fileTabs .ftab[data-i="0"]', 'pointermove', { clientX: 80, clientY: 110, pointerType: 'touch', bubbles: true });
  await page.waitForTimeout(700);
  check('phone: a press that moves (scrolling the strip) opens nothing', !(await state(page)).sheet);
  page.dialogs.length = 0;
  r = await page.evaluate(() => _projDelete(0));
  check('phone: the entry file cannot be deleted while there are other files', r === false && (await state(page)).paths.length === 3 && page.dialogs.length === 1 && /entry file/.test(page.dialogs[0].message) && /Make entry file/.test(page.dialogs[0].message), JSON.stringify(page.dialogs));
  await page.tap('#fileTabs .ftab-m');
  await page.tap('#projSheet button:has-text("Make entry file")');
  s = await state(page);
  check('phone: Make entry file moves the file to the front and keeps it open', s.paths.join() === 'game/world.emit,main.emit,draw.emit' && s.active === 0 && s.tabs[0].entry && s.tabs[0].active && /^package zone/.test(s.value), JSON.stringify(s.paths) + ' active=' + s.active);
  check('phone: the bundle now starts with the marker of the new entry file', await page.evaluate(() => _projText().indexOf('//// file: game/world.emit\npackage zone') === 0));
  page.dialogs.length = 0; page.answers.push(false);
  await page.evaluate(() => _projDelete(2));
  check('phone: Delete asks first; Cancel keeps the file', (await state(page)).paths.length === 3 && page.dialogs[0].type === 'confirm' && /Delete draw\.emit/.test(page.dialogs[0].message));
  await page.tap('#fileTabs .ftab[data-i="2"]');
  await page.tap('#fileTabs .ftab-m');
  await page.tap('#projSheet button:has-text("Delete")');
  await page.waitForTimeout(100);
  s = await state(page);
  check('phone: Delete removes the open file and opens its neighbour', s.paths.join() === 'game/world.emit,main.emit' && s.active === 1 && s.value === LONG, JSON.stringify(s.paths) + ' ' + s.active);
  await page.evaluate(() => { _projMakeEntry(1); });
  await page.evaluate(() => _projDelete(1));
  s = await state(page);
  check('phone: back to the single file main.emit the strip is hidden again', s.paths.join() === 'main.emit' && !s.strip && s.value === LONG && await page.evaluate(t => _projText() === t, LONG), JSON.stringify(s.paths) + ' strip=' + s.strip);
  page.dialogs.length = 0;
  r = await page.evaluate(() => _projDelete(0));
  check('phone: the last file cannot be deleted', r === false && page.dialogs.length === 1 && /at least one file/.test(page.dialogs[0].message));

  // ── Whole-bundle paste through ed.value + input ──
  await setEditor(page, BUNDLE);
  s = await state(page);
  check('phone: ed.value = bundle + input creates the tabs', s.paths.join() === 'main.emit,game/physics.emit,game/draw.emit' && s.strip && s.active === 0 && s.value === MAIN.replace(/\n$/, ''), JSON.stringify(s.paths) + JSON.stringify(s.value.slice(-20)));
  check('phone: the project text is that bundle again, files hold no marker', await page.evaluate(b => _projText() === b && _proj.files.every(f => f.source.indexOf('//// file: ') < 0), BUNDLE));
  await page.tap('#fileTabs .ftab[data-i="2"]');
  await setEditor(page, 'package game\n\npublic fn render() {\n  print(2)\n}');
  s = await state(page);
  check('phone: ed.value = plain text + input in a project replaces the open file only', s.paths.length === 3 && s.active === 2 && await page.evaluate(() => _proj.files[0].source.indexOf('import game.physics') === 0 && _projText().endsWith('//// file: game/draw.emit\npackage game\n\npublic fn render() {\n  print(2)\n}')), JSON.stringify(s.paths));
  await setEditor(page, DRAW);
  const fire = (text, inputType) => page.evaluate(([t, it]) => { const ed = document.getElementById('editor'); ed.value = t; ed.dispatchEvent(new InputEvent('input', { inputType: it })); }, [text, inputType]);
  await fire(DRAW + '\n//// file: pasted.emit\nlet a = 1', 'insertFromPaste');
  s = await state(page);
  check('phone: a real paste with a marker line into a project of several files stays text of that file', s.paths.length === 3 && /\/\/\/\/ file: pasted\.emit/.test(s.value), JSON.stringify(s.paths));
  await setEditor(page, DRAW);
  await page.evaluate(() => _projLoad('let old = 1'));
  await fire('let a = 1\n//// file: typed.emit\nlet b = 2', 'insertText');
  check('phone: typing a marker line never splits while editing', (await state(page)).paths.join() === 'main.emit');
  await fire(BUNDLE, 'insertFromPaste');
  check('phone: a real paste of a bundle into a single-file program opens it as a project', (await state(page)).paths.join() === 'main.emit,game/physics.emit,game/draw.emit');
  await page.evaluate(() => _projSetActive(2));

  // ── Highlighter ──
  r = await page.evaluate(() => [...document.querySelectorAll('#hlInner .kw')].map(e => e.textContent));
  check('phone: package and public are coloured as keywords', r.includes('package') && r.includes('public') && r.includes('fn'), r.join(' '));

  // ── Layout at 360 px ──
  await page.evaluate(() => { for (let i = 0; i < 5; i++) _projAddFile('a_rather_long_folder_name/another_long_file_name_' + i + '.emit'); });
  r = await page.evaluate(() => { const el = document.getElementById('fileTabs'), a = el.querySelector('.ftab.active').getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, iw: innerWidth, stripSw: el.scrollWidth, stripCw: el.clientWidth, aL: a.left, aR: a.right, addL: el.querySelector('.ftab-add').getBoundingClientRect().left, addR: el.querySelector('.ftab-add').getBoundingClientRect().right, bodySw: document.body.scrollWidth }; });
  check('phone: nothing overflows horizontally with 8 tabs (scrollWidth <= innerWidth)', r.sw <= r.iw && r.bodySw <= r.iw, JSON.stringify(r));
  check('phone: the strip itself scrolls, keeps the open tab in view and + at the right edge', r.stripSw > r.stripCw && r.aL >= -1 && r.aR <= r.addL + 1 && r.addR <= r.iw + 1 && r.addL > 300, JSON.stringify(r));
  await setEditor(page, BUNDLE);
  await page.evaluate(() => { _projSetActive(1); _projMarkErrors(['game/draw.emit:3:1: example']); });
  const shot = path.join(__dirname, 'project-tabs-phone.png');
  await page.screenshot({ path: shot, clip: { x: 0, y: 0, width: 360, height: 300 } });
  const shotSize = fs.statSync(shot).size;
  if (shotSize >= 100 * 1024) fs.unlinkSync(shot);
  check('phone: screenshot of the tab strip saved (tests/project-tabs-phone.png, under 100 KB)', shotSize < 100 * 1024, shotSize + ' bytes');
  await page.evaluate(() => _projMarkErrors([]));

  // ── Find in all files (phone) ──
  await page.selectOption('#exportSel', 'find');
  await page.waitForTimeout(100);
  r = await page.evaluate(() => ({ bar: getComputedStyle(document.getElementById('findBar')).display, rep: getComputedStyle(document.getElementById('findRepRow')).display, focus: document.activeElement.id,
    sizes: [...document.querySelectorAll('#findBar button')].map(b => { const x = b.getBoundingClientRect(); return [Math.round(x.width), Math.round(x.height)]; }), sw: document.documentElement.scrollWidth }));
  check('phone: File → Find / replace… opens the find bar with 40 px buttons, no overflow', r.bar === 'block' && r.rep === 'flex' && r.focus === 'findQ' && r.sizes.every(([w, h]) => w >= 40 && h >= 40) && r.sw <= 360, JSON.stringify(r));
  await page.fill('#findQ', 'render');
  await page.tap('#findAllBtn');
  await page.waitForTimeout(250);
  r = await page.evaluate(() => ({ head: document.querySelector('#findRes .fres-h').textContent, rows: [...document.querySelectorAll('#findRes .fres-row')].map(e => e.textContent), on: document.getElementById('findAllBtn').classList.contains('on'), h: [...document.querySelectorAll('#findRes .fres-row')].map(e => Math.round(e.getBoundingClientRect().height)) }));
  check('phone: "all files" lists the matches as path:line: text', r.on && r.rows.join('|') === 'main.emit:6: draw.render()|game/draw.emit:3: public fn render() {' && /2 matching lines in 2 files/.test(r.head) && r.h.every(h => h >= 40), JSON.stringify(r));
  await page.tap('#findRes .fres-row >> nth=1');
  await page.waitForTimeout(350);
  s = await state(page);
  r = await page.evaluate(() => { const ed = document.getElementById('editor'); return { sel: ed.value.substring(ed.selectionStart, ed.selectionEnd), view: document.getElementById('pnl-edit').className, focus: document.activeElement.id }; });
  check('phone: tapping a result opens that file with the match selected', s.active === 2 && r.sel === 'render' && s.curPos === 'Ln 3 Col 11' && r.view === 'pnl' && r.focus === 'editor', JSON.stringify([s.active, r, s.curPos]));
  await page.evaluate(() => _findNext(false));
  s = await state(page);
  check('phone: ↓ in all-files mode continues into the next file', s.active === 0 && s.curPos === 'Ln 6 Col 8' && /Find: 1 of 1 in main\.emit/.test(s.status), s.active + ' ' + s.curPos + ' ' + s.status);
  await page.fill('#findR', 'paint');
  page.dialogs.length = 0;
  await page.tap('#findRepRow button:has-text("All")');
  await page.waitForTimeout(100);
  r = await page.evaluate(() => ({ t: _projText(), rows: [...document.querySelectorAll('#findRes .fres-row')].length, st: document.getElementById('sTxt').innerText }));
  check('phone: Replace All in all-files mode asks, then replaces in every file', page.dialogs.length === 1 && page.dialogs[0].type === 'confirm' && /2 matches of "render" in 2 files/.test(page.dialogs[0].message) && !/render/.test(r.t) && /draw\.paint\(\)/.test(r.t) && /public fn paint\(\)/.test(r.t) && r.rows === 0 && /Replaced 2 in 2 files/.test(r.st), JSON.stringify([page.dialogs, r.st]));
  await page.fill('#findQ', 'paint');
  await page.tap('#findAllBtn');
  await page.fill('#findR', 'render');
  await page.evaluate(() => { _projSetActive(2); _findReplaceAll(); });
  r = await page.evaluate(() => ({ a: _proj.files[0].source, c: document.getElementById('editor').value, res: getComputedStyle(document.getElementById('findRes')).display }));
  check('phone: without all-files mode Replace All changes the open file only', /draw\.paint\(\)/.test(r.a) && /public fn render\(\)/.test(r.c) && r.res === 'none', JSON.stringify(r));
  await page.tap('#findBar button[aria-label="Close find"]');
  check('phone: × closes the find bar', await page.evaluate(() => getComputedStyle(document.getElementById('findBar')).display === 'none'));

  // ── Save .emit / open .emit ──
  await setEditor(page, BUNDLE);
  await page.evaluate(() => { _projSetActive(1); window._saved.length = 0; doExport('emit'); });
  r = await page.evaluate(() => window._saved);
  check('phone: Save .emit writes the bundle as program.emit', r.length === 1 && r[0].name === 'program.emit' && r[0].content === BUNDLE, JSON.stringify(r).slice(0, 200));
  fs.writeFileSync(path.join(tmp, 'program.emit'), BUNDLE);
  fs.writeFileSync(path.join(tmp, 'other.emit'), '//// file: other.emit\nexport fn o() {\n}\n//// file: lib/x.emit\npackage lib\n');
  fs.writeFileSync(path.join(tmp, 'helper.emit'), 'public fn help() int {\r\n  return 3\r\n}\r\n');
  fs.writeFileSync(path.join(tmp, 'My Notes (2).txt'), '// notes\n');
  fs.writeFileSync(path.join(tmp, 'single.emit'), SINGLE);
  const openFiles = async (files) => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => doExport('import'))]);
    const multi = chooser.isMultiple();
    await chooser.setFiles(files.map(f => path.join(tmp, f)));
    await page.waitForTimeout(250);
    return multi;
  };
  await setEditor(page, SINGLE);
  await page.evaluate(() => _projAddFile('junk.emit'));
  r = await openFiles(['program.emit']);
  s = await state(page);
  check('phone: Open .emit (file input accepts several files) restores the saved project', r === true && s.paths.join() === 'main.emit,game/physics.emit,game/draw.emit' && s.active === 0 && await page.evaluate(b => _projText() === b, BUNDLE), JSON.stringify(s.paths));
  await openFiles(['helper.emit', 'My Notes (2).txt']);
  s = await state(page);
  check('phone: opening plain files asks "add" or "replace"', s.sheet && s.sheetItems.join('|') === 'Add to this project|Replace this project|Cancel' && s.paths.length === 3, JSON.stringify(s.sheetItems));
  await page.tap('#projSheet button:has-text("Add to this project")');
  await page.waitForTimeout(100);
  s = await state(page);
  check('phone: "Add" appends them as helper.emit and My_Notes__2_.emit and opens the first', s.paths.join() === 'main.emit,game/physics.emit,game/draw.emit,helper.emit,My_Notes__2_.emit' && s.active === 3 && s.value === 'public fn help() int {\n  return 3\n}\n', JSON.stringify(s.paths) + JSON.stringify(s.value));
  await openFiles(['helper.emit']);
  await page.tap('#projSheet button:has-text("Add to this project")');
  check('phone: a second helper.emit gets a free name, nothing is overwritten', (await state(page)).paths[5] === 'helper2.emit', JSON.stringify((await state(page)).paths));
  page.dialogs.length = 0;
  await openFiles(['program.emit', 'other.emit']);
  s = await state(page);
  check('phone: two project files at once are refused with a message', s.paths.length === 6 && page.dialogs.length === 1 && /More than one of these files is a whole project/.test(page.dialogs[0].message), JSON.stringify(page.dialogs));
  await openFiles(['other.emit', 'helper.emit']);
  s = await state(page);
  check('phone: a project file plus plain files: the project is opened, the plain files are added', s.paths.join() === 'other.emit,lib/x.emit,helper.emit' && !s.sheet, JSON.stringify(s.paths));
  await openFiles(['helper.emit', 'single.emit']);
  await page.tap('#projSheet button:has-text("Replace this project")');
  await page.waitForTimeout(100);
  check('phone: "Replace" makes the picked files the project', (await state(page)).paths.join() === 'helper.emit,single.emit', JSON.stringify((await state(page)).paths));
  await setEditor(page, 'export fn old() {\n}\n');
  await page.evaluate(() => { _projLoad('export fn old() {\n}\n'); });
  await openFiles(['single.emit']);
  s = await state(page);
  check('phone: one plain file into a single-file program replaces it, as before', s.paths.join() === 'main.emit' && !s.strip && !s.sheet && s.value === SINGLE, JSON.stringify(s.paths) + s.sheet);
  await page.evaluate(() => { window._saved.length = 0; doExport('emit'); });
  check('phone: Save .emit of a single-file program is its source, byte for byte', await page.evaluate(t => window._saved[0].content === t, SINGLE));

  // ── Share link ──
  await setEditor(page, BUNDLE);
  await page.evaluate(() => { _projSetActive(2); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: u => { window._shared = u; return Promise.resolve(); } } }); });
  await page.evaluate(() => shareURL());
  await page.waitForTimeout(200);
  const shared = await page.evaluate(() => window._shared);
  check('phone: share link is produced for the 3-file project', typeof shared === 'string' && /#.{20,}/.test(shared) && shared.length < 4096, String(shared).slice(0, 120));
  check('phone: no page or console errors', page.errors.length === 0 && page.consoleErrors.length === 0, page.errors.concat(page.consoleErrors).join(' | '));
  await page.context().close();
  page = await openIde(browser, fileUrl, PHONE, { hash: String(shared).split('#')[1] });
  s = await state(page);
  check('phone: opening the share link restores all three files', s.paths.join() === 'main.emit,game/physics.emit,game/draw.emit' && s.strip && s.active === 0 && await page.evaluate(b => _projText() === b, BUNDLE), JSON.stringify(s.paths));

  // ── Autosave with storage ──
  await page.evaluate(() => _projSetActive(1));
  await page.evaluate(() => { const ed = document.getElementById('editor'); ed.focus(); ed.setSelectionRange(ed.value.length, ed.value.length); });
  await page.keyboard.type('// edited');
  await page.waitForTimeout(450);
  r = await page.evaluate(() => ({ code: localStorage.getItem('emit-code'), active: localStorage.getItem('emit-active') }));
  check('phone: autosave stores the bundle under emit-code and the open tab under emit-active', r.active === '1' && r.code === BUNDLE.replace(PHYS, PHYS_SRC + '// edited\n'), JSON.stringify(r).slice(0, 300));
  let ctx = page.context();
  await page.close();
  page = await openIde(browser, fileUrl, PHONE, { ctx });
  s = await state(page);
  check('phone: a reload restores the project and the open tab', s.paths.join() === 'main.emit,game/physics.emit,game/draw.emit' && s.active === 1 && s.value === PHYS_SRC + '// edited' && s.strip, JSON.stringify(s.paths) + ' active=' + s.active);
  await page.evaluate(t => { localStorage.setItem('emit-code', t); localStorage.setItem('emit-active', '7'); }, SINGLE);
  await page.close();
  page = await openIde(browser, fileUrl, PHONE, { ctx });
  s = await state(page);
  check('phone: single-file code saved by an older version restores (stale tab index ignored)', s.paths.join() === 'main.emit' && s.value === SINGLE && !s.strip && s.active === 0, JSON.stringify(s.paths));
  check('phone: no page or console errors after the reloads', page.errors.length === 0 && page.consoleErrors.length === 0, page.errors.concat(page.consoleErrors).join(' | '));
  await ctx.close();

  // ── No storage at all (the content:// situation) ──
  page = await openIde(browser, fileUrl, PHONE, { init: () => {
    const deny = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
    for (const k of ['localStorage', 'sessionStorage', 'indexedDB', 'caches']) { try { Object.defineProperty(window, k, { configurable: true, get: deny }); } catch (e) {} }
  } });
  r = await page.evaluate(() => { try { localStorage.getItem('x'); return 'readable'; } catch (e) { return e.name; } });
  s = await state(page);
  check('no storage: the page starts with the default program', r === 'SecurityError' && s.paths.join() === 'main.emit' && /New Emit program/.test(s.value), r + ' ' + JSON.stringify(s.paths));
  await setEditor(page, BUNDLE);
  await page.tap('#fileTabs .ftab[data-i="1"]');
  await page.evaluate(() => { const ed = document.getElementById('editor'); ed.focus(); ed.setSelectionRange(0, 0); });
  await page.keyboard.type('// x\n');
  page.answers.push('more.emit');
  await page.tap('#fileTabs .ftab-add');
  await page.evaluate(() => { _projRename(3, 'more2.emit'); _projMakeEntry(3); _projMakeEntry(1); _projDelete(1); });
  await page.selectOption('#example', 'basics');
  await run(page);
  await page.waitForTimeout(600);
  s = await state(page);
  check('no storage: editing, tabs, examples and Run work', s.status === 'Done' && s.paths.join() === 'main.emit', s.status + ' ' + JSON.stringify(s.paths));
  check('no storage: no page errors and no console noise', page.errors.length === 0 && page.consoleErrors.length === 0, page.errors.concat(page.consoleErrors).join(' | '));
  await page.context().close();

  // ═════════════════════════════ DESKTOP (1200 px, keyboard) ═════════════════════════════
  page = await openIde(browser, fileUrl, DESK);
  s = await state(page);
  check('desktop: fresh page has no tab strip', !s.strip && s.paths.join() === 'main.emit');
  await setEditor(page, SINGLE);
  await run(page);
  check('desktop: single-file ed.value + input + compileAndRun() runs', (await state(page)).status === 'Done');
  await setEditor(page, 'export fn bad() int {\n  return "x"\n}\n');
  await run(page);
  r = await page.evaluate(() => [...document.querySelectorAll('#tab-output .clickable-err')].map(e => e.getAttribute('onclick')));
  check('desktop: a single-file type error is reported and linked exactly as before (line:col, jumpToLine)', r.length >= 1 && r.every(o => /^jumpToLine\(\d+\)$/.test(o)) && /^\s*\d+:\d+: /m.test((await state(page)).output), JSON.stringify(r) + (await state(page)).output.slice(0, 200));

  // ── Keyboard tab switching, per-file undo ──
  await setEditor(page, BUNDLE);
  await page.focus('#editor');
  await page.keyboard.press('Control+PageDown');
  r = [(await state(page)).active];
  await page.keyboard.press('Control+PageDown'); r.push((await state(page)).active);
  await page.keyboard.press('Control+PageDown'); r.push((await state(page)).active);
  await page.keyboard.press('Control+PageUp'); r.push((await state(page)).active);
  await page.keyboard.press('Alt+ArrowLeft'); r.push((await state(page)).active);
  await page.keyboard.press('Alt+ArrowRight'); r.push((await state(page)).active);
  check('desktop: Ctrl+PageDown/PageUp and Alt+←/→ switch tabs (wrapping around)', r.join() === '1,2,0,2,1,2' && await page.evaluate(() => document.activeElement.id === 'editor'), r.join());
  await page.evaluate(() => { _projSetActive(0); const ed = document.getElementById('editor'); ed.focus(); ed.setSelectionRange(ed.value.length, ed.value.length); });
  await page.keyboard.type('// first');
  await page.waitForTimeout(900);
  await page.keyboard.type(' second');
  await page.keyboard.press('Control+PageDown');
  await page.evaluate(() => { const ed = document.getElementById('editor'); ed.setSelectionRange(ed.value.length, ed.value.length); });
  await page.keyboard.type('// phys');
  await page.keyboard.press('Control+PageUp');
  await page.keyboard.press('Control+z');
  r = [await page.evaluate(() => document.getElementById('editor').value)];
  await page.keyboard.press('Control+z'); r.push(await page.evaluate(() => document.getElementById('editor').value));
  await page.keyboard.press('Control+Shift+z'); r.push(await page.evaluate(() => document.getElementById('editor').value));
  await page.keyboard.press('Control+y'); r.push(await page.evaluate(() => document.getElementById('editor').value));
  const m0 = MAIN.replace(/\n$/, '');
  check('desktop: undo/redo work per file after switching tabs (typing bursts are steps)', r[0] === m0 + '// first' && r[1] === m0 && r[2] === m0 + '// first' && r[3] === m0 + '// first second' && await page.evaluate(p => _proj.files[1].source === p + '// phys', PHYS_SRC), JSON.stringify(r.map(x => x.slice(-22))));
  await page.keyboard.press('Control+PageDown');
  await page.keyboard.press('Control+z');
  check('desktop: undo in the other file only touches that file', await page.evaluate(([p, m]) => document.getElementById('editor').value === p && _proj.files[0].source === m + '// first second', [PHYS_SRC, m0]));

  // ── Errors across files (TEST-ONLY compile stub) ──
  await setEditor(page, BUNDLE);
  await stubCompile(page, 'errors', ['game/physics.emit:7:10: Type mismatch: expected num, got str', 'game/draw.emit:6:3: Unknown name w2', 'game/physics.emit:13:3: Second error', '4:1: an error without a file']);
  await run(page);
  s = await state(page);
  r = await page.evaluate(() => [...document.querySelectorAll('#tab-output .clickable-err')].map(e => ({ t: e.textContent, o: e.getAttribute('onclick') })));
  check('desktop: errors are shown as path:line:col: message and are clickable', r.length === 4 && r[0].t === 'game/physics.emit:7:10: Type mismatch: expected num, got str' && r[0].o === "_projJump('game/physics.emit',7,10)" && r[1].o === "_projJump('game/draw.emit',6,3)" && r[3].o === 'jumpToLine(4)', JSON.stringify(r));
  check('desktop: compile received the bundle', await page.evaluate(b => window._compiled === b, BUNDLE));
  check('desktop: tabs of files with errors are marked, the others are not', s.tabs.map(t => t.err).join() === 'false,true,true' && /has errors/.test(s.tabs[1].title) && /type errors/.test(s.status), JSON.stringify(s.tabs));
  await page.click('#tab-output .clickable-err >> nth=0');
  s = await state(page);
  r = await page.evaluate(() => { const ed = document.getElementById('editor'); return { sel: ed.value.substring(ed.selectionStart, ed.selectionEnd), focus: document.activeElement.id }; });
  check('desktop: clicking an error opens its file and selects the line', s.active === 1 && r.sel === '  return dt' && s.curPos === 'Ln 7 Col 1' && r.focus === 'editor', JSON.stringify([s.active, r, s.curPos]));
  await page.click('#tab-output .clickable-err >> nth=1');
  s = await state(page);
  check('desktop: clicking an error in another file switches again', s.active === 2 && s.curPos === 'Ln 6 Col 1', s.active + ' ' + s.curPos);
  await stubCompile(page, 'throw', ['game/draw.emit:3:8: Unexpected token "fn"']);
  await run(page);
  s = await state(page);
  r = await page.evaluate(() => [...document.querySelectorAll('#tab-output .clickable-err')].map(e => ({ t: e.textContent, o: e.getAttribute('onclick') })));
  check('desktop: a thrown (lexer/parser) error with a path is clickable and marks only its tab', r.length === 1 && r[0].o === "_projJump('game/draw.emit',3,8)" && /^✗ game\/draw\.emit:3:8: Unexpected token/.test(r[0].t) && s.tabs.map(t => t.err).join() === 'false,false,true' && s.status === 'Error', JSON.stringify(r) + JSON.stringify(s.tabs.map(t => t.err)));
  await page.evaluate(() => _projSetActive(0));
  await page.click('#tab-output .clickable-err');
  check('desktop: clicking it jumps to that file and line', (await state(page)).active === 2 && (await state(page)).curPos === 'Ln 3 Col 1');
  await stubCompile(page, 'ok');
  await run(page);
  s = await state(page);
  check('desktop: a successful Run clears the error marks', s.status === 'Done' && s.tabs.every(t => !t.err), JSON.stringify(s.tabs.map(t => t.err)) + s.status);
  check('desktop: the stats line of a project shows the file count', /^3 files, \d+ tok/m.test(s.output), s.output.slice(0, 120));
  await stubCompile(page, 'errors', ['main.emit:1:1: again']);
  await run(page);
  await page.evaluate(() => _projRename(0, 'app.emit'));
  s = await state(page);
  check('desktop: marks follow the file (kept after a rename, cleared by the next good Run)', s.tabs[0].err && s.paths[0] === 'app.emit');
  await stubCompile(page, 'ok');
  await run(page);
  check('desktop: … cleared', (await state(page)).tabs.every(t => !t.err));

  // ── Marker line typed into a file ──
  await setEditor(page, BUNDLE);
  await page.evaluate(() => _projSetActive(2));
  await typeAtEnd(page, '//// file: extra.emit');
  await page.keyboard.press('Enter');
  await page.keyboard.type('public fn extra() {');
  await page.keyboard.press('Enter');
  await page.keyboard.type('}');
  s = await state(page);
  check('desktop: a typed "//// file:" line stays text of the file while editing', s.paths.length === 3 && s.active === 2 && /\/\/\/\/ file: extra\.emit\npublic fn extra\(\) \{/.test(s.value), JSON.stringify(s.paths));
  await run(page);
  s = await state(page);
  check('desktop: Run splits it into a tab of its own and says so in the Output', s.paths.join() === 'main.emit,game/physics.emit,game/draw.emit,extra.emit' && s.active === 2 && s.value === DRAW && /⚠ A "\/\/\/\/ file: …" line starts a new file/.test(s.output) && /game\/draw\.emit line 9/.test(s.output) && await page.evaluate(() => _proj.files[3].source === 'public fn extra() {\n  \n}' || _proj.files[3].source.indexOf('public fn extra() {') === 0), JSON.stringify(s.paths) + s.output.slice(0, 300));
  await run(page);
  check('desktop: the next Run has no such note', !/⚠/.test((await state(page)).output));
  await unstubCompile(page);

  // ── `use` lines in files other than the entry (loader and export scan) ──
  const USEB = 'export fn run() {\n  print(1)\n}\n//// file: util/time.emit\npackage util\nuse dayjs\nuse "https://example.com/x.css"\n\npublic fn now2() int {\n  return 1\n}';
  await setEditor(page, USEB);
  await page.evaluate(() => { window._usesSeen = []; window._realLoadUse = _loadUse; window._loadUse = async u => { window._usesSeen.push((u.css ? 'css:' : '') + u.label + '@' + u.file + ':' + u.line); }; });
  await stubCompile(page, 'ok');
  await run(page);
  r = await page.evaluate(() => window._usesSeen);
  check('desktop: use lines of a non-entry file reach the loader (with file and line)', r.join('|') === 'dayjs@util/time.emit:2|css:https://example.com/x.css@util/time.emit:3', JSON.stringify(r));
  r = await page.evaluate(() => ({ all: _parseUses(_projText()).map(u => u.label + ':' + u.line), libs: _exportLibs(_projText(), []).map(l => l.label + '|' + l.url + '|' + l.css), active: [...activeUses()] }));
  check('desktop: the export scan (_parseUses on the bundle, _exportLibs) sees them; marker lines are not use lines', r.all.join() === 'dayjs:6,https://example.com/x.css:7' && r.libs.length === 2 && /dayjs/.test(r.libs[0]) && /x\.css\|true$/.test(r.libs[1]) && r.active.join() === 'dayjs', JSON.stringify(r));
  await page.evaluate(() => { window._saved.length = 0; doExport('html'); });
  r = await page.evaluate(() => ({ n: window._saved.length, name: window._saved[0] && window._saved[0].name, hasLib: /"label":"dayjs"/.test(window._saved[0] ? window._saved[0].content : ''), src: window._compiled }));
  check('desktop: Export .html compiles the bundle and lists the library of the non-entry file', r.n === 1 && r.name === 'program.html' && r.hasLib && r.src === USEB, JSON.stringify({ n: r.n, name: r.name, hasLib: r.hasLib }));
  await page.evaluate(() => { _projSetActive(1); _findClose(); addLibUse('three.js'); });
  r = await page.evaluate(() => ({ entry: _proj.files[0].source, other: document.getElementById('editor').value, active: _proj.active }));
  check('desktop: the 📚 panel adds its use line to the top of the entry file, whatever tab is open', r.entry.indexOf('use three.js\nexport fn run()') === 0 && r.active === 1 && !/three/.test(r.other), JSON.stringify(r.entry.slice(0, 40)));
  await setEditor(page, USEB.replace('use dayjs', 'use day js as'));
  await page.evaluate(() => _projSetActive(0));
  await run(page);
  s = await state(page);
  r = await page.evaluate(() => { const e = document.querySelector('#tab-output .clickable-err'); return e ? { t: e.textContent, o: e.getAttribute('onclick') } : null; });
  check('desktop: a bad use line in a non-entry file is reported as path:line:1 and marks the tab', r && /^✗ util\/time\.emit:2:1: Bad use line/.test(r.t) && r.o === "_projJump('util/time.emit',2,1)" && s.tabs[1].err && s.status === 'Library error', JSON.stringify(r) + s.status);
  await page.click('#tab-output .clickable-err');
  check('desktop: … and clicking it opens that file at the line', (await state(page)).active === 1 && (await state(page)).curPos === 'Ln 2 Col 1');
  await page.evaluate(() => { window._loadUse = window._realLoadUse; });
  await unstubCompile(page);

  // ── Module autocomplete (whatever _emitModuleIndex the page has: the stand-in now, the real one after the merge) ──
  r = await page.evaluate(b => _emitModuleIndex(b), BUNDLE);
  const shapeOk = idx => idx && typeof idx === 'object' && typeof idx.modules === 'object' && Object.keys(idx.modules).every(k => {
    const m = idx.modules[k];
    return typeof m.path === 'string' && Array.isArray(m.publics) && Array.isArray(m.imports)
      && m.publics.every(q => typeof q.name === 'string' && (q.kind === 'fn' || q.kind === 'var') && (q.kind !== 'fn' || (Array.isArray(q.params) && q.params.every(a => typeof a.name === 'string' && typeof a.type === 'string'))))
      && m.imports.every(i => typeof i.module === 'string');
  });
  const phys = r && r.modules && r.modules['game.physics'];
  check('contract: _emitModuleIndex(bundle) has the agreed shape', shapeOk(r) && Object.keys(r.modules).sort().join() === 'game.draw,game.physics,main' && r.entry === 'main' && r.modules.main.path === 'main.emit' && phys.path === 'game/physics.emit', JSON.stringify(r).slice(0, 500));
  check('contract: publics are the public names only, with parameters and return type', phys && phys.publics.map(q => q.name + ':' + q.kind).join() === 'gravity:var,ticks:var,step:fn,reset:fn' && JSON.stringify(phys.publics[2].params) === '[{"name":"dt","type":"num"}]' && phys.publics[2].returnType === 'num' && phys.publics[1].mutable === true && !phys.publics[0].mutable, JSON.stringify(phys));
  check('contract: imports of the entry file name the two modules', r.modules.main.imports.map(i => i.module).sort().join() === 'game.draw,game.physics' && r.modules.main.imports.every(i => !i.star && !(i.names && i.names.length)), JSON.stringify(r.modules.main.imports));
  check('contract: _emitModuleIndex never throws on broken input', await page.evaluate(() => { try { const i = _emitModuleIndex('//// file: a.emit\nimport ((( \npublic fn (\n//// file: b.emit\n"unterminated'); return !!i && typeof i.modules === 'object'; } catch (e) { return false; } }));

  await setEditor(page, BUNDLE);
  await typeAtEnd(page, 'import ');
  p = await popup(page);
  check('autocomplete 1: after "import " the other modules of the project are offered', p.shown && names(p).join() === 'game.draw,game.physics' && /module · game\/draw\.emit/.test(p.rows[0].desc), JSON.stringify(p));
  await page.keyboard.type('phy', { delay: 12 });
  await page.waitForTimeout(550);
  p = await popup(page);
  check('autocomplete 1: "import phy" narrows to game.physics (match on a name part)', p.shown && names(p).join() === 'game.physics', JSON.stringify(p));
  await page.keyboard.press('Enter');
  check('autocomplete 1: picking it writes the whole module name', (await curLine(page)) === 'import game.physics', await curLine(page));
  await page.keyboard.type('.', { delay: 12 });
  await page.waitForTimeout(550);
  p = await popup(page);
  check('autocomplete 2: after "import game.physics." its public members and * are offered, private ones are not', p.shown && names(p).join() === 'gravity,ticks,step,reset,*' && !names(p).includes('hidden') && /fn\(dt: num\) num/.test(p.rows[2].desc), JSON.stringify(p));
  await page.keyboard.type('st', { delay: 12 });
  await page.waitForTimeout(550);
  p = await popup(page);
  check('autocomplete 2: "import game.physics.st" narrows to step', names(p).join() === 'step', JSON.stringify(p));
  await page.keyboard.press('Enter');
  check('autocomplete 2: picking a member completes the import line (no bracket)', (await curLine(page)) === 'import game.physics.step', await curLine(page));
  await typeAtEnd(page, 'import fn ', { newline: true });
  p = await popup(page);
  check('autocomplete: "import fn …" (a JS import) offers no modules', !p.rows.some(x => /^game\./.test(x.name)), JSON.stringify(p));

  await setEditor(page, MAIN.replace('import game.draw', 'import game.draw as d') + '//// file: game/physics.emit\n' + PHYS + '//// file: game/draw.emit\n' + DRAW);
  await typeAtEnd(page, 'physics.', { newline: true });
  p = await popup(page);
  check('autocomplete 3: "physics." lists the public functions with parameters and return type, and the variables', p.shown && names(p).join() === 'gravity,ticks,step,reset' && /^fn\(dt: num\) num · game\.physics$/.test(p.rows[2].desc) && /^let\b.*game\.physics$/.test(p.rows[0].desc) && /^mut\b/.test(p.rows[1].desc) && /^fn\(\) · game\.physics$/.test(p.rows[3].desc), JSON.stringify(p));
  await page.keyboard.type('st', { delay: 12 });
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
  check('autocomplete 3: picking a function inserts name(', (await curLine(page)) === 'physics.step(', await curLine(page));
  await typeAtEnd(page, 'd.re', { newline: true });
  p = await popup(page);
  check('autocomplete 3: an "as" alias works the same way (d.re → render, resize)', names(p).join() === 'render,resize' && /fn\(w: int, h: int\) int · game\.draw/.test(p.rows[1].desc), JSON.stringify(p));
  await typeAtEnd(page, 'draw.', { newline: true });
  p = await popup(page);
  check('autocomplete 3: the module name is not usable once it was imported under an alias', !p.rows.some(x => x.name === 'render'), JSON.stringify(p));

  await setEditor(page, 'import game.physics.step\nimport game.draw.*\n\nexport fn run() {\n}\n//// file: game/physics.emit\n' + PHYS + '//// file: game/draw.emit\n' + DRAW);
  await typeAtEnd(page, 'ste', { newline: true });
  p = await popup(page);
  check('autocomplete 4: a directly imported name joins the plain suggestions', p.shown && names(p)[0] === 'step' && /fn\(dt: num\) num · game\.physics/.test(p.rows[0].desc), JSON.stringify(p));
  await page.keyboard.press('Enter');
  check('autocomplete 4: picking it inserts step(', (await curLine(page)) === 'step(', await curLine(page));
  await typeAtEnd(page, 'res', { newline: true });
  p = await popup(page);
  check('autocomplete 4: names from a star import are offered too (resize), not names that were not imported (reset)', names(p).includes('resize') && !names(p).includes('reset'), JSON.stringify(p));
  await typeAtEnd(page, 'ren', { newline: true });
  p = await popup(page);
  check('autocomplete 4: imported names come together with the builtins (render + render3d)', names(p)[0] === 'render' && names(p).some(n => /^render3d\(/.test(n)), JSON.stringify(p));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  check('autocomplete 4: a builtin row of the mixed list still inserts the builtin', /^render3d\($/.test(await curLine(page)), await curLine(page));

  // an import alias wins over a library global of the same name
  await page.evaluate(() => { window.Stage = { addChild: function (a) {}, removeChild: function (a) {}, children: [] }; });
  await setEditor(page, 'export fn run() {\n}');
  await typeAtEnd(page, 'Stage.', { newline: true });
  p = await popup(page);
  check('autocomplete: (control) a library global lists its own members', p.shown && names(p).includes('addChild'), JSON.stringify(p));
  await setEditor(page, 'import game.physics as Stage\n\nexport fn run() {\n}\n//// file: game/physics.emit\n' + PHYS);
  await typeAtEnd(page, 'Stage.', { newline: true });
  p = await popup(page);
  check('autocomplete: an import alias wins over a library global of the same name', p.shown && names(p).join() === 'gravity,ticks,step,reset', JSON.stringify(p));
  await page.evaluate(() => { delete window.Stage; });

  // the same four situations against an index written by hand in the CONTRACT shape (independent of the stand-in)
  await page.evaluate(() => {
    window._realIndex = _emitModuleIndex;
    window._emitModuleIndex = function (text) {
      window._indexCalls = (window._indexCalls || 0) + 1;
      return { entry: 'main', modules: {
        'main': { path: 'main.emit', publics: [], imports: [
          { module: 'net.http', alias: null, names: [], star: false },
          { module: 'net.socket', alias: 'ws', names: [], star: false },
          { module: 'util.text', alias: null, names: ['padLeft'], star: false },
          { module: 'util.math', alias: null, names: [], star: true } ] },
        'net.http': { path: 'net/http.emit', imports: [], publics: [
          { name: 'fetchText', kind: 'fn', params: [{ name: 'url', type: 'str' }, { name: 'retries', type: 'int' }], returnType: 'str', mutable: false },
          { name: 'timeout', kind: 'var', params: [], returnType: null, mutable: true } ] },
        'net.socket': { path: 'net/socket.emit', imports: [], publics: [{ name: 'open', kind: 'fn', params: [{ name: 'host', type: 'str' }], returnType: 'js', mutable: false }] },
        'util.text': { path: 'util/text.emit', imports: [], publics: [{ name: 'padLeft', kind: 'fn', params: [{ name: 's', type: 'str' }, { name: 'n', type: 'int' }], returnType: 'str', mutable: false }, { name: 'padRight', kind: 'fn', params: [], returnType: 'str', mutable: false }] },
        'util.math': { path: 'util/math.emit', imports: [], publics: [{ name: 'squared', kind: 'fn', params: [{ name: 'x', type: 'num' }], returnType: 'num', mutable: false }, { name: 'squareSide', kind: 'var', params: [], returnType: null, mutable: false }] },
      } };
    };
  });
  await setEditor(page, 'import net.http\nimport net.socket as ws\nimport util.text.padLeft\nimport util.math.*\n\nexport fn run() {\n}');
  await typeAtEnd(page, 'import ut', { newline: true });
  p = await popup(page);
  check('contract index 1: import → module names', names(p).join() === 'util.math,util.text', JSON.stringify(p));
  await page.keyboard.type('il.text.', { delay: 12 });
  await page.waitForTimeout(550);
  p = await popup(page);
  check('contract index 2: import util.text. → publics and *', names(p).join() === 'padLeft,padRight,*', JSON.stringify(p));
  await typeAtEnd(page, 'http.', { newline: true });
  p = await popup(page);
  check('contract index 3: http. (alias null → last part of the module name) → members with signature', names(p).join() === 'fetchText,timeout' && p.rows[0].desc === 'fn(url: str, retries: int) str · net.http' && /^mut · net\.http$/.test(p.rows[1].desc), JSON.stringify(p));
  await typeAtEnd(page, 'ws.', { newline: true });
  p = await popup(page);
  check('contract index 3: ws. (alias) → members of net.socket', names(p).join() === 'open' && p.rows[0].desc === 'fn(host: str) js · net.socket', JSON.stringify(p));
  await typeAtEnd(page, 'socket.', { newline: true });
  p = await popup(page);
  check('contract index 3: socket. is not offered (it is known as ws)', !names(p).includes('open'), JSON.stringify(p));
  await typeAtEnd(page, 'pad', { newline: true });
  p = await popup(page);
  check('contract index 4: names: [padLeft] → padLeft is suggested, padRight is not', names(p).includes('padLeft') && !names(p).includes('padRight'), JSON.stringify(p));
  await typeAtEnd(page, 'squ', { newline: true });
  p = await popup(page);
  check('contract index 4: star: true → every public of util.math', names(p).slice(0, 2).join() === 'squared,squareSide' && p.rows[0].desc === 'fn(x: num) num · util.math' && /^let · util\.math$/.test(p.rows[1].desc), JSON.stringify(p));
  // caching
  await page.waitForTimeout(500);
  r = await page.evaluate(() => { const a = window._indexCalls; _projIndex(); _projIndex(); _projIndex(); return window._indexCalls - a; });
  check('index cache: an unchanged project is not indexed again', r === 0, 'calls: ' + r);
  r = await page.evaluate(() => window._indexCalls);
  await typeAtEnd(page, 'ws.open("a") ws.open("b") ws.open("c") ws.open("d")', { newline: true });
  const calls = (await page.evaluate(() => window._indexCalls)) - r;
  check('index cache: 50 keystrokes in about a second rebuild the index a few times at most (400 ms rule)', calls >= 1 && calls <= 6, 'rebuilds: ' + calls);
  await page.evaluate(() => { window._emitModuleIndex = window._realIndex; _projDirty(); });

  // ── Find (desktop, one file) ──
  await setEditor(page, BUNDLE);
  await page.focus('#editor');
  await page.keyboard.press('Control+f');
  await page.keyboard.type('game');
  await page.keyboard.press('Enter');
  s = await state(page);
  r = await page.evaluate(() => { const ed = document.getElementById('editor'); return { sel: ed.value.substring(ed.selectionStart, ed.selectionEnd), rep: getComputedStyle(document.getElementById('findRepRow')).display }; });
  check('desktop: Ctrl+F opens the bar, Enter selects the first match in the open file', r.sel === 'game' && s.curPos === 'Ln 1 Col 8' && /Find: 1 of 2 in main\.emit/.test(s.status) && r.rep === 'none', JSON.stringify(r) + s.curPos + s.status);
  await page.keyboard.press('F3');
  await page.keyboard.press('F3');
  s = await state(page);
  check('desktop: F3 goes on and wraps around inside the file (all-files mode off)', s.active === 0 && s.curPos === 'Ln 1 Col 8', s.active + ' ' + s.curPos);
  await page.keyboard.press('Control+h');
  await page.fill('#findR', 'engine');
  await page.click('#findBar button:has-text("Replace") >> nth=0');
  r = await page.evaluate(() => ({ v: document.getElementById('editor').value.split('\n').slice(0, 2).join('|'), other: _proj.files[1].source.split('\n')[0] }));
  check('desktop: Ctrl+H shows the replace row; Replace changes the selected match and moves on', /^import engine\.physics\|import game\.draw$/.test(r.v) && r.other === 'package game', JSON.stringify(r));
  await page.keyboard.press('Control+z');
  check('desktop: … and it can be undone', (await page.evaluate(() => document.getElementById('editor').value.split('\n')[0])) === 'import game.physics');
  await page.focus('#findQ');
  await page.keyboard.press('Escape');
  check('desktop: Escape closes the find bar', await page.evaluate(() => getComputedStyle(document.getElementById('findBar')).display === 'none' && document.activeElement.id === 'editor'));

  // ── Example dropdown, New, library example ──
  await page.selectOption('#example', 'modules');
  s = await state(page);
  check('desktop: the Modules example opens as three tabs', s.paths.join() === 'main.emit,game/physics.emit,game/draw.emit' && s.strip && s.active === 0 && /^\/\/ Modules/.test(s.value), JSON.stringify(s.paths));
  r = await page.evaluate(() => { const i = _emitModuleIndex(EX.modules); return { step: i.modules['game.physics'].publics.map(q => q.name).join(), draw: i.modules['game.draw'].publics.map(q => q.name).join(), imp: i.modules['game.draw'].imports.map(q => q.module).join() }; });
  check('desktop: its index: physics has public and private names, draw imports physics', /\bsetup\b/.test(r.step) && /\bstep\b/.test(r.step) && !/speed|outside|keep/.test(r.step) && r.draw === 'render' && r.imp === 'game.physics', JSON.stringify(r));
  r = await page.evaluate(() => [...document.querySelectorAll('#example option')].map(o => o.value + '=' + o.textContent).pop());
  check('desktop: the dropdown has the entry Modules', r === 'modules=Modules', r);
  await page.selectOption('#example', 'basics');
  s = await state(page);
  check('desktop: choosing a single-file example afterwards replaces the whole project', s.paths.join() === 'main.emit' && !s.strip && await page.evaluate(() => _projText() === EX.basics && localStorage.getItem('emit-code') === EX.basics));
  await page.selectOption('#example', 'modules');
  page.dialogs.length = 0; page.answers.push('1');
  await page.click('button[title="New"]');
  s = await state(page);
  check('desktop: + (New) says it replaces the project and offers "New file in this project"', s.paths.join() === 'main.emit' && /replaces the whole project, 3 files/.test(page.dialogs[0].message) && /6\. New file in this project/.test(page.dialogs[0].message), page.dialogs[0] && page.dialogs[0].message);
  page.dialogs.length = 0; page.answers.push('6', 'side.emit');
  await page.click('button[title="New"]');
  check('desktop: … and that entry adds a file instead', (await state(page)).paths.join() === 'main.emit,side.emit', JSON.stringify((await state(page)).paths));
  page.dialogs.length = 0;
  await page.evaluate(() => { toggleLibs(); loadLibExample(LIBS.findIndex(l => l.example)); });
  s = await state(page);
  check('desktop: a library example asks, then replaces the whole project', page.dialogs.length === 1 && page.dialogs[0].type === 'confirm' && s.paths.join() === 'main.emit' && !s.strip, JSON.stringify(page.dialogs) + JSON.stringify(s.paths));
  r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  check('desktop: no horizontal overflow either', r.sw <= r.iw, JSON.stringify(r));
  check('desktop: no page or console errors', page.errors.length === 0 && page.consoleErrors.length === 0, page.errors.concat(page.consoleErrors).join(' | '));

  // ═════════════════════════════ AFTER THE MERGE ═════════════════════════════
  // These need the real multi-file compiler. With the stand-ins in place they are skipped.
  const standIn = await page.evaluate(() => !!(_emitSplitBundle.fallback || _emitModuleIndex.fallback));
  if (standIn) {
    skip('merge: the Modules example compiles and runs', 'the page runs on the temporary stand-ins (no module compiler in this branch)');
    skip('merge: a real compile error in game/physics.emit is reported as path:line:col and opens that tab', 'needs the module compiler');
  } else {
    await page.selectOption('#example', 'modules');
    await run(page);
    await page.waitForTimeout(800);
    s = await state(page);
    check('merge: the Modules example compiles and runs', s.status === 'Done' && !/✗/.test(s.output) && /^3 files, /m.test(s.output), s.status + ' | ' + s.output.slice(0, 300));
    await page.evaluate(() => { stopProgram(); _projSetActive(1); const ed = document.getElementById('editor'); ed.value = ed.value.replace('return n\n', 'return "n"\n'); ed.dispatchEvent(new Event('input')); _projSetActive(0); });
    await run(page);
    s = await state(page);
    r = await page.evaluate(() => { const e = document.querySelector('#tab-output .clickable-err'); return e ? e.getAttribute('onclick') : null; });
    check('merge: a real compile error in game/physics.emit is reported as path:line:col and opens that tab', /^_projJump\('game\/physics\.emit',\d+,\d+\)$/.test(r || '') && s.tabs[1].err, r + ' ' + s.output.slice(0, 300));
  }
  await page.context().close();

  await browser.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + passed + '/' + (passed + failed) + ' project checks passed' + (skipped ? ' (' + skipped + ' skipped until the merge)' : ''));
  process.exit(failed ? 1 : 0);
})();

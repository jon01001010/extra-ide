#!/usr/bin/env node
// The LOGIC tool of the Drawer: THINGS and RULES tabs that build `thing` and `rules:` blocks. Opened through a
// the real drawer; things are added and edited in the form, rules are built from the menus, reordered (buttons
// and drag handle), disabled; live validation marks the row with the compile error; ▶ Try it saves and runs;
// Save writes exact block text and reopening shows the same; hand-written rules read back, lines the tool cannot
// show are kept as is; nothing overflows at 360 px. About half of the checks run in a phone viewport with touch.
//
//   node tests/run-logic-tool.js [path/to/emit-ide.html]
//
// The tool opens in the real drawer (CORE) with its real ctx; test hooks record its writes, removes, runs and
// toasts. Offline.
const { chromium } = require('playwright');
const path = require('path');

let failed = 0, passed = 0;
function check(label, ok, detail) {
  if (ok) { passed++; console.log('PASS  ' + label); }
  else { failed++; console.log('FAIL  ' + label + (detail !== undefined ? '\n      ' + String(detail).slice(0, 900) : '')); }
}
const PHONE = { viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true };
const DESK = { viewport: { width: 1200, height: 800 } };

// Test hooks over the real drawer (CORE), injected after load: __openTool(id) opens tool id afresh in the real
// drawer, __closeTool() leaves it without asking; __dr records what the tool did through its real ctx (writes,
// removes, runs, toasts) and reads the drawer's dirty flag and title.
const HOOKS = `
(function () {
  window.__dr = { writes: [], removes: [], runs: 0, toasts: [] };
  Object.defineProperty(__dr, 'dirty', { get: function () { return _drawer.tool ? _drawer.dirty : null; } });
  Object.defineProperty(__dr, 'title', { get: function () { return _drawer.title ? _drawer.title.textContent : ''; } });
  var w0 = _drawerWrite; window._drawerWrite = function (k, n, t, f) { __dr.writes.push([k, n, t, f || null]); return w0.apply(this, arguments); };
  var r0 = _drawerRemove; window._drawerRemove = function (k, n) { __dr.removes.push([k, n]); return r0.apply(this, arguments); };
  var t0 = _drawerToast; window._drawerToast = function (t) { __dr.toasts.push(String(t)); return t0.apply(this, arguments); };
  var c0 = compileAndRun; window.compileAndRun = function () { __dr.runs++; return c0.apply(this, arguments); };
  window.__openTool = function (id) { _drawerEnsure(); _drawerTool(_drawerFind(id)); };
  window.__closeTool = function () { if (_drawerIsOpen()) { _drawerLeave(); _drawer.el.classList.remove('show'); } };
})();
`;

async function open(browser, opts, src) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.route(/^https?:/, r => r.abort());
  await page.goto('file://' + FILE);
  await page.waitForFunction(() => typeof compileAndRun === 'function');
  await page.evaluate(() => { try { closeWelcome(); } catch (e) {} });
  await page.evaluate(HOOKS);
  await page.evaluate(s => _projLoad(s), src || 'export fn hello() int {\n  return 1\n}\n');
  return page;
}
const projText = page => page.evaluate(() => _projText());
const tool = (page, id) => page.evaluate(i => __openTool(i || 'logic'), id);
const settle = page => page.waitForTimeout(450);   // live validation is debounced (350 ms)
async function overflow(page) {
  return page.evaluate(() => {
    const b = document.getElementById('drawerBody'), bad = [];
    b.querySelectorAll('*').forEach(e => { const r = e.getBoundingClientRect(); if (r.width && (r.right > innerWidth + 0.5 || r.left < -0.5)) bad.push(e.tagName + '.' + e.className + ' ' + Math.round(r.left) + '..' + Math.round(r.right)); });
    return { sw: b.scrollWidth, cw: b.clientWidth, doc: document.documentElement.scrollWidth, iw: innerWidth, bad: bad.slice(0, 5) };
  });
}

const FILE = path.resolve(process.argv[2] && /\.html$/.test(process.argv[2]) ? process.argv[2] : path.join(__dirname, '..', 'emit-ide-1_32.html'));

(async () => {
  const browser = await chromium.launch();

  // ── desktop: registration, things form, rules from menus, save → exact text, reopen identical ──
  {
    const page = await open(browser, DESK);
    // (changed by the merge: the real drawer lists every part's tools; LOGIC's icon is 🧩, 🎮 is CONTROLS')
    const reg = await page.evaluate(() => _drawerToolList().filter(t => t.id === 'logic').map(t => [t.id, t.label, t.icon, typeof t.open]));
    check('registers with the drawer (id, label, icon, open)', JSON.stringify(reg) === JSON.stringify([['logic', 'Logic', '🧩', 'function']]), JSON.stringify(reg));
    await tool(page);
    check('opens on THINGS with a hint when there are no things', await page.isVisible('.lg-tab.on[data-tab="things"]') && /No things yet/.test(await page.textContent('#drawerBody')));
    // hero
    await page.click('.lg-add-kind');
    await page.fill('.lg-thing [data-f="name"]', 'hero');
    await page.fill('.lg-thing [data-f="w"]', '14');
    await page.fill('.lg-thing [data-f="h"]', '14');
    await page.fill('.lg-thing [data-f="color"]', '#5fcde4');
    await page.fill('.lg-thing [data-f="atx"]', '40');
    await page.fill('.lg-thing [data-f="aty"]', '200');
    await page.click('.lg-add-field');
    await page.fill('.lg-field [data-f="fname"]', 'hp');
    await page.fill('.lg-field [data-f="fvalue"]', '3');
    await page.check('input[data-flag="solid"]');
    // coin
    await page.click('.lg-add-kind');
    await page.fill('.lg-thing [data-f="name"]', 'coin');
    await page.selectOption('.lg-thing [data-f="shape"]', 'circ');
    await page.fill('.lg-thing [data-f="r"]', '5');
    await page.fill('.lg-thing [data-f="color"]', '#ffcd75');
    await page.fill('.lg-thing [data-f="count"]', '5');
    await page.fill('.lg-thing [data-f="atx"]', '30 + i * 50');
    await page.fill('.lg-thing [data-f="aty"]', '-20');
    // slime with chase
    await page.click('.lg-add-kind');
    await page.fill('.lg-thing [data-f="name"]', 'slime');
    await page.selectOption('.lg-thing [data-f="shape"]', 'oval');
    await page.fill('.lg-thing [data-f="color"]', 'green');
    await page.click('.lg-add-beh');
    await page.selectOption('.lg-beh [data-f="btarget"]', 'hero');
    await page.fill('.lg-beh [data-f="barg"]', '0.5');
    await page.fill('.lg-thing [data-f="atx"]', '260');
    await page.fill('.lg-thing [data-f="aty"]', '40');
    const kindsShown = await page.$$eval('.lg-kind', b => b.map(x => x.textContent));
    check('three kinds listed', JSON.stringify(kindsShown) === '["hero","coin","slime"]', kindsShown);
    // rules
    await page.click('.lg-tab[data-tab="rules"]');
    await page.click('.lg-add-rule');                          // on start: set score 0 (default)
    await page.click('.lg-add-rule');
    await page.selectOption('.lg-rule[data-i="1"] [data-f="event"]', 'hit');
    await page.selectOption('.lg-rule[data-i="1"] [data-f="a"]', 'hero');
    await page.selectOption('.lg-rule[data-i="1"] [data-f="b"]', 'coin');
    await page.selectOption('.lg-rule[data-i="1"] .lg-act[data-j="0"] [data-f="verb"]', 'remove');
    await page.selectOption('.lg-rule[data-i="1"] .lg-act[data-j="0"] [data-f="subj"]', 'coin');
    await page.click('.lg-rule[data-i="1"] .lg-add-act');       // add score 1 (default)
    await page.click('.lg-rule[data-i="1"] .lg-add-act');
    await page.selectOption('.lg-rule[data-i="1"] .lg-act[data-j="2"] [data-f="verb"]', 'play');
    await page.fill('.lg-rule[data-i="1"] .lg-act[data-j="2"] [data-f="name"]', 'coin');
    await page.click('.lg-add-rule');
    await page.selectOption('.lg-rule[data-i="2"] [data-f="event"]', 'every');
    await page.selectOption('.lg-rule[data-i="2"] .lg-act[data-j="0"] [data-f="verb"]', 'mv');
    await page.selectOption('.lg-rule[data-i="2"] .lg-act[data-j="0"] [data-f="subj"]', 'hero');
    await page.fill('.lg-rule[data-i="2"] .lg-act[data-j="0"] [data-f="x"]', 'stickX() * 2');
    await page.fill('.lg-rule[data-i="2"] .lg-act[data-j="0"] [data-f="y"]', '-1');
    await page.selectOption('.lg-rule[data-i="2"] [data-f="event"]', 'frame');
    await page.selectOption('.lg-rule[data-i="2"] .lg-act[data-j="0"] [data-f="verb"]', 'mv');
    await page.selectOption('.lg-rule[data-i="2"] .lg-act[data-j="0"] [data-f="subj"]', 'hero');
    await page.fill('.lg-rule[data-i="2"] .lg-act[data-j="0"] [data-f="x"]', 'stickX() * 2');
    await page.fill('.lg-rule[data-i="2"] .lg-act[data-j="0"] [data-f="y"]', 'stickY() * 2');
    await page.click('.lg-add-rule');
    await page.selectOption('.lg-rule[data-i="3"] [data-f="event"]', 'when');
    await page.fill('.lg-rule[data-i="3"] [data-f="cond"]', 'count(coin) == 0');
    await page.selectOption('.lg-rule[data-i="3"] .lg-act[data-j="0"] [data-f="verb"]', 'say');
    await page.fill('.lg-rule[data-i="3"] .lg-act[data-j="0"] [data-f="value"]', '"You win!"');
    await page.click('.lg-rule[data-i="3"] .lg-add-act');
    await page.selectOption('.lg-rule[data-i="3"] .lg-act[data-j="1"] [data-f="verb"]', 'stop');
    await settle(page);
    const st = await page.textContent('.lg-status');
    check('live validation: the built program compiles', /✓ compiles/.test(st), st);
    check('editing marks the drawer dirty', await page.evaluate(() => __dr.dirty) === true);
    await page.click('.lg-save');
    // (changed by the merge: the real drawer writes new thing / rules blocks into their default file game.emit)
    const want = [
      'export fn hello() int {', '  return 1', '}', '', '//// file: game.emit',
      'thing hero: box 14 14 #5fcde4, at 40 200, solid, hp 3', '',
      'thing coin: circ 5 #ffcd75, at 30 + i * 50, -20, count 5', '',
      'thing slime: oval 16 16 green, at 260 40, chase hero 0.5', '',
      'rules:', '  on start: set score 0', '  on hit hero coin: remove coin : add score 1 : play coin', '  every frame: hero mv stickX() * 2, stickY() * 2', '  when count(coin) == 0: say "You win!" : stop', ''].join('\n');
    const got = await projText(page);
    check('Save writes the exact block text', got === want, JSON.stringify(got));
    const w = await page.evaluate(() => __dr.writes.map(x => [x[0], x[1]]));
    check('Save writes through ctx.write per block (thing ×3, rules)', JSON.stringify(w) === '[["thing","hero"],["thing","coin"],["thing","slime"],["rules",""]]', JSON.stringify(w));
    check('Save clears dirty and toasts', await page.evaluate(() => __dr.dirty === false && /Saved 4 blocks/.test(__dr.toasts.join('|'))), await page.evaluate(() => __dr.toasts));
    // reopen: identical model and text
    await page.evaluate(() => __closeTool());
    await tool(page);
    const back = await page.evaluate(() => ({ things: _lgTool.state.things.map(t => _lgTool.thingText(t)), rules: _lgTool.state.rules.filter(r => r.type !== 'blank').map(r => _lgTool.ruleText(r)) }));
    check('reopen: the things read back identical', JSON.stringify(back.things) === JSON.stringify(['thing hero: box 14 14 #5fcde4, at 40 200, solid, hp 3', 'thing coin: circ 5 #ffcd75, at 30 + i * 50, -20, count 5', 'thing slime: oval 16 16 green, at 260 40, chase hero 0.5']), JSON.stringify(back.things));
    check('reopen: the rules read back identical', JSON.stringify(back.rules) === JSON.stringify(['on start: set score 0', 'on hit hero coin: remove coin : add score 1 : play coin', 'every frame: hero mv stickX() * 2, stickY() * 2', 'when count(coin) == 0: say "You win!" : stop']), JSON.stringify(back.rules));
    await page.evaluate(() => { __dr.writes = []; });
    await page.click('.lg-save');
    check('reopen + Save without changes writes nothing', await page.evaluate(() => __dr.writes.length === 0 && /Nothing changed/.test(__dr.toasts.slice(-1)[0])) && await projText(page) === want);
    // ▶ Try it: runs the program
    await page.click('.lg-try');
    await page.waitForTimeout(400);
    const ran = await page.evaluate(() => ({ runs: __dr.runs, status: document.getElementById('sTxt').innerText, canvas: !!document.querySelector('#tab-output canvas') }));
    check('▶ Try it runs the program (game canvas)', ran.runs === 1 && ran.status === 'Done' && ran.canvas, JSON.stringify(ran));
    check('no page errors (desktop build)', !page.errors.length, page.errors.join(' | '));
    await page.context().close();
  }

  // ── desktop: hand-written rules, kept-as-is lines, disable, reorder (buttons and drag), validation ──
  {
    const SRC = [
      'mut lives = 3',
      'fn openChest(h: int, c: int) {',
      '}',
      'thing hero: box 8 8, at 10 10   // the player',
      '  speed 2',
      'thing chest: box 8 8 #aa7733, at 100 10',
      'rules:',
      '  stage size 200 100',
      '  on hit hero chest:   call openChest',
      '  on hitt hero chest: stop',
      '  // when lives <= 0: restart',
      '  // a plain comment',
      '',
      '  every 2s: chest to rnd(180),   20',
      '  on keydown space: spawn chest at hero.x, hero.y - 10 vel 0, -1',
      ''].join('\n');
    const page = await open(browser, DESK, SRC);
    await tool(page);
    const things = await page.evaluate(() => _lgTool.state.things.map(t => [t.name, _lgTool.thingText(t)]));
    check('hand-written things read into the form (continuation lines, comments)', JSON.stringify(things) === JSON.stringify([['hero', 'thing hero: box 8 8, at 10 10, speed 2'], ['chest', 'thing chest: box 8 8 #aa7733, at 100 10']]), JSON.stringify(things));
    await page.click('.lg-tab[data-tab="rules"]');
    const rows = await page.$$eval('.lg-rule', rs => rs.map(r => (r.classList.contains('kept') ? 'kept: ' + r.querySelector('.lg-kepttext').textContent : r.classList.contains('off') ? 'off' : 'on')));
    check('rules read back: setting, rule, kept-as-is (bad event, plain comment), disabled rule', JSON.stringify(rows) === JSON.stringify(['on', 'on', 'kept: on hitt hero chest: stop', 'off', 'kept: // a plain comment', 'on', 'on']), JSON.stringify(rows));
    const parsed = await page.evaluate(() => _lgTool.state.rules.filter(r => r.type === 'rule').map(r => _lgTool.ruleText(r)));
    check('hand-written rules shown as menus', JSON.stringify(parsed) === JSON.stringify(['on hit hero chest: call openChest', 'when lives <= 0: restart', 'every 2s: chest to rnd(180), 20', 'on keydown space: spawn chest at hero.x, hero.y - 10 vel 0, -1']), JSON.stringify(parsed));
    const sel = await page.evaluate(() => { const r = document.querySelector('.lg-rule[data-i="1"]'); return [r.querySelector('[data-f="event"]').value, r.querySelector('[data-f="a"]').value, r.querySelector('[data-f="b"]').value, r.querySelector('[data-f="verb"]').value, r.querySelector('[data-f="fn"]').value]; });
    check('menus show the rule (event, things, action, fn)', JSON.stringify(sel) === '["hit","hero","chest","call","openChest"]', JSON.stringify(sel));
    const evOpts = await page.$$eval('.lg-rule[data-i="1"] [data-f="b"] option', o => o.map(x => x.value));
    check('thing menus list the declared things plus wall / edge', JSON.stringify(evOpts) === '["","hero","chest","wall","edge"]', JSON.stringify(evOpts));
    // enable the disabled rule, disable the every-2s rule
    await page.uncheck('.lg-rule[data-i="6"] [data-f="enabled"]');
    await page.check('.lg-rule[data-i="3"] [data-f="enabled"]');
    // reorder: move the keydown rule up with ▲, then drag the setting to the end
    await page.click('.lg-rule[data-i="7"] .lg-mv[data-d="-1"]');
    const h = await page.$('.lg-rule[data-i="0"] .lg-handle'), last = await page.$('.lg-rule:last-of-type');
    // (the real drawer's body scrolls inside a panel shorter than the window: bring the list's top into view first)
    await page.evaluate(() => document.querySelector('.lg-rule[data-i="0"]').scrollIntoView({ block: 'start' }));
    const hb = await h.boundingBox(), lb = await last.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2, lb.y + lb.height - 4, { steps: 6 });
    await page.mouse.up();
    await settle(page);
    await page.click('.lg-save');
    const got = await projText(page);
    const wantRules = [
      'rules:',
      '  on hit hero chest:   call openChest',
      '  on hitt hero chest: stop',
      '  when lives <= 0: restart',
      '  // a plain comment',
      '',
      '  on keydown space: spawn chest at hero.x, hero.y - 10 vel 0, -1',
      '  // every 2s: chest to rnd(180), 20',
      '  stage size 200 100'].join('\n');
    check('Save: untouched lines verbatim (spacing kept), kept-as-is lines kept, disabled written commented out, new order', got.indexOf(wantRules) > 0 && got.indexOf('thing hero: box 8 8, at 10 10   // the player\n  speed 2') > 0, got.slice(got.indexOf('rules:')));
    // validation: an unknown field marks its row with the compiler message
    await page.click('.lg-add-rule');
    const n = await page.$$eval('.lg-rule', r => r.length);
    const idx = await page.$eval('.lg-rule:last-of-type', r => r.getAttribute('data-i'));
    await page.selectOption('.lg-rule[data-i="' + idx + '"] [data-f="event"]', 'when');
    await page.fill('.lg-rule[data-i="' + idx + '"] [data-f="cond"]', 'hero.hpp > 1');
    await settle(page);
    const bad = await page.evaluate(i => { const r = document.querySelector('.lg-rule[data-i="' + i + '"]'); return [r.classList.contains('bad'), r.querySelector('.lg-errs').textContent, document.querySelector('.lg-status').textContent]; }, idx);
    if (process.env.DEBUG) console.log(await page.evaluate(() => JSON.stringify(_lgTool.state.errs) + ' ' + _lgTool.state.msg));
    check('live validation marks the rule with the compile error', bad[0] && /thing hero has no field "hpp"/.test(bad[1]) && /2 problems/.test(bad[2]), JSON.stringify(bad) + ' rows ' + n);
    const ke = await page.$eval('.lg-rule.kept .lg-errs', e => e.textContent);
    check('a kept line that does not compile shows its own error', ke === '✗ does not compile: Unknown event "on hitt" — did you mean "on hit"?', ke);
    await page.fill('.lg-rule[data-i="' + idx + '"] [data-f="cond"]', 'hero.speed > 1');
    await settle(page);
    check('…and clears it when fixed', !(await page.$eval('.lg-rule[data-i="' + idx + '"]', r => r.classList.contains('bad'))));
    // a thing error is shown on its form
    await page.click('.lg-tab[data-tab="things"]');
    await page.fill('.lg-thing [data-f="count"]', 'lives');
    await settle(page);
    const tb = await page.evaluate(() => [document.querySelector('.lg-thing').classList.contains('bad'), document.querySelector('.lg-thing .lg-errs').textContent, document.querySelector('.lg-kind.on').classList.contains('bad')]);
    check('a thing error is shown on its form and its tab', tb[0] && tb[2] && /count needs a whole number written as a constant/.test(tb[1]), JSON.stringify(tb));
    // renaming a thing renames it in the rules; delete a thing removes its block
    await page.fill('.lg-thing [data-f="count"]', '');
    await page.fill('.lg-thing [data-f="name"]', 'player');
    await page.click('.lg-kind[data-i="1"]');
    await page.click('.lg-del-thing');
    await settle(page);
    await page.click('.lg-save');
    const t2 = await projText(page);
    check('rename follows into the rules; delete removes the block (ctx.remove)', /thing player: box 8 8, at 10 10, speed 2/.test(t2) && /on hit player chest:/.test(t2) && !/^thing chest/m.test(t2) && await page.evaluate(() => JSON.stringify(__dr.removes)) === '[["thing","chest"],["thing","hero"]]', t2 + ' ' + await page.evaluate(() => JSON.stringify(__dr.removes)));
    check('no page errors (hand-written)', !page.errors.length, page.errors.join(' | '));
    await page.context().close();
  }

  // ── phone (360 px, touch): build a game, reorder by tap, try it, no horizontal overflow ──
  {
    const page = await open(browser, PHONE);
    await tool(page);
    await page.tap('.lg-add-kind');
    await page.fill('.lg-thing [data-f="name"]', 'hero');
    await page.tap('.lg-add-beh');
    await page.tap('.lg-add-field');
    let o = await overflow(page);
    check('phone: THINGS form fits in 360 px (no horizontal overflow)', o.sw <= o.cw && o.doc <= o.iw && !o.bad.length, JSON.stringify(o));
    await page.tap('.lg-add-kind');
    await page.fill('.lg-thing [data-f="name"]', 'gem');
    await page.selectOption('.lg-thing [data-f="shape"]', 'sprite');
    await page.tap('.lg-kind[data-i="0"]');
    await page.selectOption('.lg-beh [data-f="btarget"]', 'gem');
    await page.tap('.lg-tab[data-tab="rules"]');
    await page.tap('.lg-add-rule');
    await page.tap('.lg-add-rule');
    await page.selectOption('.lg-rule[data-i="1"] [data-f="event"]', 'hit');
    await page.selectOption('.lg-rule[data-i="1"] .lg-act[data-j="0"] [data-f="verb"]', 'spawn');
    await page.tap('.lg-rule[data-i="1"] .lg-add-act');
    await page.tap('.lg-add-setting');
    o = await overflow(page);
    check('phone: RULES rows wrap inside 360 px (no horizontal overflow)', o.sw <= o.cw && o.doc <= o.iw && !o.bad.length, JSON.stringify(o));
    const sizes = await page.$$eval('.lg-rule button, .lg-rule select, .lg-rule input:not([type=checkbox])', els => els.map(e => Math.round(e.getBoundingClientRect().height)).filter(hh => hh < 32));
    check('phone: controls are at least 32 px tall', !sizes.length, JSON.stringify(sizes));
    await page.tap('.lg-rule[data-i="0"] .lg-mv[data-d="1"]');
    const order = await page.evaluate(() => _lgTool.state.rules.map(r => r.type === 'rule' ? r.ev.kind : r.type));
    check('phone: ▼ moves a rule down', JSON.stringify(order) === '["hit","start","setting"]', JSON.stringify(order));
    await page.tap('.lg-try');
    await page.waitForTimeout(500);
    const t = await projText(page);
    check('phone: the built blocks are saved', /^thing hero: box 16 16 #ffffff, at 160 120, chase gem 1, hp 3$/m.test(t) && /^thing gem: sprite gem, at 160 120$/m.test(t) && /^  on hit hero gem: spawn hero : add score 1$/m.test(t), t);
    check('phone: ▶ Try it runs it', await page.evaluate(() => __dr.runs === 1 && document.getElementById('sTxt').innerText === 'Done'), await page.evaluate(() => document.getElementById('tab-output').innerText.slice(0, 300)));
    check('no page errors (phone)', !page.errors.length, page.errors.join(' | '));
    await page.context().close();
  }

  await browser.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();

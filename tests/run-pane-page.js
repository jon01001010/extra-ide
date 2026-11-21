#!/usr/bin/env node
// Playwright tests for the Pane browser shell (pane.html): built-in pages offline, links and history,
// scrolling by wheel, keys and touch at device pixel ratios 1, 2 and 3, relayout on resize, widgets and
// statements through real clicks and keys, the dialog, the text-only copy for screen readers, and pages
// loaded over http (served by the test itself; nothing leaves the machine).
//
//   node tests/run-pane-page.js [path/to/pane.html] [--shots DIR]
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const shotsAt = args.indexOf('--shots');
const shots = shotsAt >= 0 ? args.splice(shotsAt, 2)[1] : null;
const file = path.resolve(args[0] || path.join(__dirname, '..', 'pane.html'));
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) pass++;
  else { fail++; console.log(`✗ ${name}${detail !== undefined ? '\n    ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500) : ''}`); }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// Pages the test serves at https://site.test/…
const SITE = {
  '/a.pane': { body: 'title Page A\nfnt 14\ntxt This is page A\nlnk To page B b.pane\nlnk Up and over ../other/c.pane\nlnk Missing nope.pane\nlnk Script javascript:alert(1)' },
  '/b.pane': { body: 'title Page B\ntxt This is page B\nwibble\nwobble' },
  '/other/c.pane': { body: 'txt This is page C' },
  '/web.pane': { body: 'txt price {price} status {price_status}\nbtn Load 1\nif tap 1=1 do web /price.txt price' },
  '/price.txt': { body: '12.5' },
  '/page.html': { body: '<!doctype html><title>x</title>', type: 'text/html' },
  '/sneaky.pane': { body: '<html><script>alert(1)</script></html>' },
  '/big.pane': { body: 'txt ' + 'x'.repeat(2.1e6) },
};

(async () => {
  try {
    execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'build-pane-html.js'), '--check'], { stdio: 'pipe' });
    ok('pane.html contains the current pane.js and pages', true);
  } catch (e) { ok('pane.html contains the current pane.js and pages', false, String(e.stderr)); }

  const browser = await chromium.launch();
  async function open(opts, hash) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1 }, opts));
    const page = await ctx.newPage();
    const t = { ctx, page, errors: [], requests: [], dialogs: 0 };
    page.on('pageerror', e => t.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) t.errors.push(m.text()); });
    page.on('dialog', d => { t.dialogs++; d.dismiss(); });
    await page.route(/^(https?|wss?):/, r => {
      const u = new URL(r.request().url());
      t.requests.push(r.request().url());
      if (u.hostname === '127.0.0.1') return r.continue();
      const hit = u.host === 'site.test' ? SITE[u.pathname] : null;
      if (!hit) return u.host === 'site.test' ? r.fulfill({ status: 404, contentType: 'text/plain', body: 'not here' }) : r.abort();
      return r.fulfill({ status: 200, contentType: hit.type || 'text/plain; charset=utf-8', headers: { 'access-control-allow-origin': '*' }, body: hit.body });
    });
    await page.goto('file://' + file + (hash ? '#' + hash : ''));
    await settled(page);
    return t;
  }
  // wait until no navigation is in flight and the page shown has been painted
  const settled = page => page.waitForFunction(() => window.paneShell && paneShell.current && !/^Loading /.test(document.getElementById('status').textContent) && paneShell.view.paints > 0)
    .then(() => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))));
  const url = page => page.evaluate(() => paneShell.current.url);
  const state = (page, expr) => page.evaluate(new Function('const v = paneShell.view, p = v.page, st = v.state; return ' + expr));
  // where a node is on screen: the centre of its box, in page (CSS) pixels; null when it is not there
  const where = (page, pred) => page.evaluate(src => {
    const pred = new Function('n', 'return ' + src), v = paneShell.view, r = v.canvas.getBoundingClientRect();
    let found = null, offset = v.page.scrollY;
    (function walk(n, off) { if (found || n.hidden) return; if (pred(n)) { found = n; offset = off; return; } if (n.children) for (const c of n.children) walk(c, n.type === 'dlg' ? 0 : off + (n.scrollY && !n.isRoot ? n.scrollY : 0)); })(v.page.root, v.page.scrollY);
    return found && { x: r.left + found.x + found.w / 2, y: r.top + found.y + found.h / 2 - offset, w: found.w, h: found.h, left: r.left + found.x, top: r.top + found.y - offset };
  }, pred);
  async function clickNode(page, pred, dx) {
    const at = await where(page, pred);
    if (!at) throw new Error('no node: ' + pred);
    await page.mouse.click(dx != null ? at.left + dx : at.x, at.y);
    await settled(page);
  }
  const texts = page => page.evaluate(() => { const out = []; (function walk(n) { if (n.hidden) return; if (n.lines) out.push(n.lines.join(' ')); if (n.children) n.children.forEach(walk); })(paneShell.view.page.root); return out; });
  const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };

  // ───────────── start page, links, history ─────────────
  {
    const t = await open(), page = t.page;
    eq('start: opens the built-in start page', [await url(page), await page.title(), await page.inputValue('#addr')], ['pane:home', 'Pane — Pane', 'pane:home']);
    eq('start: back and forward are off', [await page.isDisabled('#back'), await page.isDisabled('#fwd')], [true, true]);
    ok('start: the page text is drawn', (await texts(page)).join(' ').includes('A small browser for pages'));
    ok('start: the canvas is not blank', await page.evaluate(() => { const c = paneShell.view.canvas, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 300) lit++; return lit > 500; }));
    await shot(page, 'home-360');

    await clickNode(page, "n.type === 'lnk' && n.url === 'article'");
    eq('link: a click opens the page it names', [await url(page), await page.title(), await page.inputValue('#addr')], ['pane:article', 'Why text has to be measured first — Pane', 'pane:article']);
    eq('link: back is on, forward is off', [await page.isDisabled('#back'), await page.isDisabled('#fwd')], [false, true]);
    eq('link: the address is kept in the window address', await page.evaluate(() => location.hash), '#pane:article');

    // scrolling
    const max = await state(page, 'p.maxScroll');
    ok('scroll: the article is taller than the window', max > 300, max);
    await page.mouse.move(180, 300); await page.mouse.wheel(0, 250); await settled(page);
    eq('scroll: the wheel moves the page', await state(page, 'p.scrollY'), 250);
    await page.focus('#view'); await page.keyboard.press('PageDown'); await settled(page);
    ok('scroll: Page Down moves the page by most of a window', (await state(page, 'p.scrollY')) > 600, await state(page, 'p.scrollY'));
    await page.keyboard.press('End'); await settled(page);
    eq('scroll: End goes to the bottom and stops there', await state(page, 'p.scrollY'), max);
    await page.mouse.wheel(0, 500); await settled(page);
    eq('scroll: cannot go past the end', await state(page, 'p.scrollY'), max);
    // the scroll area inside the article takes the wheel first, then hands over to the page
    const scl = await where(page, "n.type === 'scl'");
    await page.mouse.move(scl.x, scl.y); await page.mouse.wheel(0, -100); await settled(page);
    eq('scroll: at the top of the inner area the page takes the wheel', await state(page, 'p.scrollY'), max - 100);
    const scl2 = await where(page, "n.type === 'scl'");
    await page.mouse.move(scl2.x, scl2.y); await page.mouse.wheel(0, 30); await settled(page);
    eq('scroll: the inner area scrolls first', [await page.evaluate(() => { let s; (function w(n) { if (n.type === 'scl') s = n; if (n.children) n.children.forEach(w); })(paneShell.view.page.root); return s.scrollY; }), await state(page, 'p.scrollY')], [30, max - 100]);
    const paintsBefore = await state(page, 'v.layouts');
    await page.mouse.move(180, 100); await page.mouse.wheel(0, -40); await settled(page);
    eq('scroll: scrolling repaints without laying out again', await state(page, 'v.layouts'), paintsBefore);
    await shot(page, 'article-scrolled-360');
    const kept = await state(page, 'p.scrollY');

    // a link below the fold, then history
    await page.keyboard.press('End'); await settled(page);
    await clickNode(page, "n.type === 'lnk' && n.url === 'home'");
    eq('history: three entries after following a link back to the start', await page.evaluate(() => paneShell.history), { entries: ['pane:home', 'pane:article', 'pane:home'], at: 2 });
    await page.click('#back'); await settled(page);
    eq('history: back returns to the article', [await url(page), await page.isDisabled('#fwd')], ['pane:article', false]);
    eq('history: and to where it was scrolled', await state(page, 'p.scrollY'), max);
    await page.click('#back'); await settled(page);
    await page.click('#fwd'); await settled(page);
    await page.click('#fwd'); await settled(page);
    eq('history: forward twice ends on the last entry', [await url(page), await page.isDisabled('#fwd'), await page.evaluate(() => paneShell.history.at)], ['pane:home', true, 2]);
    await page.click('#back'); await settled(page); await page.click('#back'); await settled(page);
    await clickNode(page, "n.type === 'lnk' && n.url === 'table'");
    eq('history: a new page from the middle drops the entries after it', await page.evaluate(() => paneShell.history), { entries: ['pane:home', 'pane:table'], at: 1 });
    await page.click('#reload'); await settled(page);
    eq('reload: same address, same history', [await url(page), await page.evaluate(() => paneShell.history.entries.length)], ['pane:table', 2]);

    // the address bar
    await page.fill('#addr', 'Widgets'); await page.press('#addr', 'Enter'); await settled(page);
    eq('address bar: a bare word is a built-in page', await url(page), 'pane:widgets');
    await page.fill('#addr', 'nosuchpage'); await page.press('#addr', 'Enter'); await settled(page);
    ok('address bar: an unknown built-in page says so', (await texts(page)).join(' ').includes('No such built-in page') && /Could not open/.test(await page.textContent('#status')), await texts(page));
    await page.fill('#addr', 'javascript:alert(1)'); await page.press('#addr', 'Enter'); await settled(page);
    ok('address bar: other kinds of address are refused', (await texts(page)).join(' ').includes('cannot be opened') && t.dialogs === 0, await texts(page));
    await clickNode(page, "n.type === 'lnk'");
    eq('error page: its link goes to the start page', await url(page), 'pane:home');
    eq('offline: no request left the page, no errors', [t.requests, t.errors], [[], []]);
    await t.ctx.close();
  }

  // ───────────── resize ─────────────
  {
    const t = await open({ viewport: { width: 360, height: 640 } }, 'pane:article'), page = t.page;
    const narrow = await state(page, '[p.vw, p.contentH, p.root.children[0].w]');
    await page.setViewportSize({ width: 1100, height: 700 }); await settled(page);
    await page.waitForFunction(() => paneShell.view.page.vw === 1100);
    const wide = await state(page, '[p.vw, p.contentH, p.root.children[0].w, p.root.children[0].x]');
    ok('resize: the page is laid out again for the new width', narrow[0] === 360 && wide[0] === 1100 && wide[1] < narrow[1] && wide[2] === 640 && wide[3] === 230, { narrow, wide });
    eq('resize: the canvas keeps one backing pixel per CSS pixel at ratio 1', await page.evaluate(() => [paneShell.view.canvas.width, paneShell.view.canvas.clientWidth]), [1100, 1100]);
    await shot(page, 'article-1100');
    await page.setViewportSize({ width: 320, height: 500 }); await settled(page);
    await page.waitForFunction(() => paneShell.view.page.vw === 320);
    ok('resize: narrower than before wraps into more lines', (await state(page, 'p.contentH')) > narrow[1]);
    eq('resize: no errors', t.errors, []);
    await t.ctx.close();
  }

  // ───────────── widgets, statements, keys ─────────────
  {
    const t = await open({}, 'pane:widgets'), page = t.page;
    await clickNode(page, "n.type === 'inp'");
    eq('input: a click gives it the keys', await state(page, 'st.activeInput'), 1);
    await page.keyboard.type('Adaa'); await page.keyboard.press('Backspace'); await settled(page);
    eq('input: typing and Backspace', await state(page, 'st.inputs[1]'), 'Ada');
    ok('input: text that shows it follows at once', (await texts(page)).includes('Hello, Ada'), await texts(page));
    await page.keyboard.press('Enter'); await settled(page);
    eq('input: Enter lets go of the keys', await state(page, 'st.activeInput'), -1);
    await clickNode(page, "n.type === 'sel'"); await clickNode(page, "n.type === 'sel'");
    await clickNode(page, "n.type === 'chk'");
    const tog = await where(page, "n.type === 'tog'");
    await page.mouse.click(tog.left + 10, tog.y); await settled(page);
    eq('switch: only the switch itself takes the click, not the empty part of its row', await state(page, 'st.togs[1]'), undefined);
    await page.mouse.click(tog.left + tog.w - 22, tog.y); await settled(page);
    eq('select, checkbox, switch', await state(page, '[st.sels[1], st.chks[1], st.togs[1]]'), [2, true, true]);
    ok('their values show in the text', (await texts(page)).includes('Size number 2') && (await texts(page)).includes('Newsletter: 1'), await texts(page));
    const sld = await where(page, "n.type === 'sld'");
    await page.mouse.click(sld.left + 8 + (sld.w - 16) * 0.8, sld.y); await settled(page);
    ok('slider: a click sets it by position', Math.abs((await state(page, 'st.slds[1]')) - 8) < 0.05, await state(page, 'st.slds[1]'));
    await page.mouse.move(sld.left + 8 + (sld.w - 16) * 0.8, sld.y); await page.mouse.down(); await page.mouse.move(sld.left + 8 + (sld.w - 16) * 0.3, sld.y + 40, { steps: 4 }); await page.mouse.up(); await settled(page);
    ok('slider: dragging follows the pointer, also outside its box', Math.abs((await state(page, 'st.slds[1]')) - 3) < 0.05, await state(page, 'st.slds[1]'));
    await clickNode(page, "n.type === 'rat'", 70);
    eq('stars: the fourth star', await state(page, 'st.vars.rat2'), 4);
    await clickNode(page, "n.type === 'btn' && n.id === 1"); await clickNode(page, "n.type === 'btn' && n.id === 1");
    ok('button: runs the statements (count twice, copy the slider)', (await state(page, 'st.vars.n')) === 2 && Math.abs((await state(page, 'st.vars.vol')) - 3) < 0.05 && (await texts(page)).includes('Count: 2'), await state(page, 'st.vars'));
    await clickNode(page, "n.type === 'btn' && n.id === 2");
    eq('button: reset', await state(page, 'st.vars.n'), 0);
    await shot(page, 'widgets-used-360');
    eq('widgets: no errors', t.errors, []);

    await page.fill('#addr', 'calculator'); await page.press('#addr', 'Enter'); await settled(page);
    for (const label of ['7', '*', '6', '=']) await clickNode(page, `n.type === 'btn' && n.label === '${label}'`);
    ok('calculator: 7 * 6 = 42 through real clicks', (await state(page, 'st.vars.display')) === 42 && (await texts(page))[0] === '42', await texts(page));
    await shot(page, 'calculator-360');

    await page.fill('#addr', 'settings'); await page.press('#addr', 'Enter'); await settled(page);
    eq('a new page starts with fresh state', await state(page, '[st.vars.display === undefined, Object.keys(st.inputs).length]'), [true, 0]);
    await clickNode(page, "n.type === 'inp'"); await page.keyboard.type('grace'); await clickNode(page, "n.type === 'btn' && n.id === 1");
    ok('settings: Save reads the text field', (await texts(page)).includes('Saved as grace'), await texts(page));
    await t.ctx.close();
  }

  // ───────────── tabs, accordion, dialog ─────────────
  {
    const t = await open({}, 'pane:panels'), page = t.page;
    eq('dialog: open at the start', await state(page, 'p.dialogs.length'), 1);
    await shot(page, 'panels-dialog-360');
    const tab = await where(page, "n.type === 'tab'");
    await page.mouse.click(tab.left + tab.w * 0.5, tab.top + 14); await settled(page);
    eq('dialog: while it is open, the page under it does not take clicks', await page.evaluate(() => { let s; (function w(n) { if (n.type === 'tab') s = n; if (n.children) n.children.forEach(w); })(paneShell.view.page.root); return s.sel; }), 0);
    await page.mouse.move(180, 300); await page.mouse.wheel(0, 100); await settled(page);
    await clickNode(page, "n.type === 'btn' && n.id === 9");
    eq('dialog: its own button takes the click and it stays open', await state(page, 'p.dialogs.length'), 1);
    const dlg = await where(page, "n.type === 'dlg'");
    await page.mouse.click(dlg.left + dlg.w - 15, dlg.top + 15); await settled(page);
    eq('dialog: the cross closes it', await state(page, 'p.dialogs.length'), 0);
    const before = await where(page, "n.type === 'txt' && n.text === 'Below the panels.'");
    await page.mouse.click(tab.left + tab.w * 0.5, tab.top + 14); await settled(page);
    const after = await where(page, "n.type === 'txt' && n.text === 'Below the panels.'");
    ok('tabs: the second tab shows its taller panel and the page moves down', (await texts(page)).includes('The second panel is taller.') && !(await texts(page)).includes('The first panel. It is short.') && after.y > before.y, { before, after });
    await clickNode(page, "n.type === 'acc'", 20);
    const opened = await where(page, "n.type === 'txt' && n.text === 'Below the panels.'");
    ok('accordion: opens and pushes the page down', (await texts(page)).some(s => s.startsWith('An accordion keeps')) && opened.y > after.y, { after, opened });
    await shot(page, 'panels-open-360');
    eq('panels: no errors', t.errors, []);
    await t.ctx.close();
  }

  // ───────────── device pixel ratio and touch ─────────────
  for (const dpr of [2, 3]) {
    const t = await open({ viewport: { width: 360, height: 640 }, deviceScaleFactor: dpr, hasTouch: true, isMobile: true }, 'pane:article'), page = t.page;
    eq(`ratio ${dpr}: the canvas has ${dpr} backing pixels per CSS pixel, and layout is in CSS pixels`, await page.evaluate(() => [paneShell.view.canvas.width, paneShell.view.canvas.height === Math.round(paneShell.view.canvas.clientHeight * devicePixelRatio), paneShell.view.page.vw]), [360 * dpr, true, 360]);
    // drag a finger up by 200 px: the page must move by exactly 200, whatever the ratio
    const client = await page.context().newCDPSession(page);
    const touch = (type, y) => client.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: 180, y }] });
    await touch('touchStart', 500); for (let y = 480; y >= 300; y -= 20) await touch('touchMove', y); await touch('touchEnd'); await settled(page);
    eq(`ratio ${dpr}: a 200 px finger drag scrolls the page by 200 px`, await state(page, 'p.scrollY'), 200);
    eq(`ratio ${dpr}: a drag is not a click`, await url(page), 'pane:article');
    // a tap lands on what is under the finger
    await page.evaluate(() => { paneShell.view.page.scrollY = paneShell.view.page.maxScroll; paneShell.view.paintNow(); });
    const link = await where(page, "n.type === 'lnk' && n.url === 'home'");
    await page.touchscreen.tap(link.x, link.y); await settled(page);
    eq(`ratio ${dpr}: a tap on a link at the bottom of a scrolled page opens it`, await url(page), 'pane:home');
    await shot(page, 'home-ratio' + dpr);
    eq(`ratio ${dpr}: no errors`, t.errors, []);
    await t.ctx.close();
  }

  // ───────────── the text-only copy ─────────────
  {
    const t = await open({}, 'pane:panels'), page = t.page;
    const mirror = () => page.evaluate(() => document.getElementById('mirror').innerText.replace(/\s+/g, ' '));
    ok('mirror: carries the page text for screen readers', (await mirror()).includes('The first panel. It is short.') && (await mirror()).includes('Below the panels.'), await mirror());
    eq('mirror: controls have roles', await page.evaluate(() => [!!document.querySelector('#mirror [role=dialog]'), document.querySelectorAll('#mirror button').length > 1, !!document.querySelector('#mirror a')]), [true, true, true]);
    await page.evaluate(() => { [...document.querySelectorAll('#mirror button')].find(b => b.textContent === 'More details').click(); });
    await settled(page);
    ok('mirror: its buttons work the page', (await texts(page)).some(s => s.startsWith('An accordion keeps')));
    // text that looks like markup stays text
    await page.evaluate(() => paneShell.view.load('txt <img src=x onerror="window.pwned=1"> & <b>bold</b>\nbtn <script>window.pwned=2</script> 1\nlnk <i>x</i> home\ndlg <svg onload="window.pwned=3">\ntxt in\nend'));
    await settled(page);
    eq('mirror: markup in page text is not markup', await page.evaluate(() => [document.querySelectorAll('#mirror img, #mirror b, #mirror script, #mirror i, #mirror svg').length, window.pwned === undefined, document.querySelector('#mirror p').textContent]),
      [0, true, '<img src=x onerror="window.pwned=1"> & <b>bold</b>']);
    eq('mirror: no errors', t.errors, []);
    await t.ctx.close();
  }

  // ───────────── timers ─────────────
  {
    const t = await open({}, 'pane:clock'), page = t.page;
    await page.waitForFunction(() => paneShell.view.state.vars.tmr1 >= 2, null, { timeout: 5000 });
    ok('timer: counts and the text follows', (await texts(page)).some(s => /^Seconds on this page: [2-9]/.test(s)), await texts(page));
    ok('spinner: keeps the page painting', await page.evaluate(() => new Promise(r => { const a = paneShell.view.paints; setTimeout(() => r(paneShell.view.paints > a), 300); })));
    await page.fill('#addr', 'home'); await page.press('#addr', 'Enter'); await settled(page);
    const frozen = await page.evaluate(() => new Promise(r => { const v = paneShell.view, a = v.paints, b = v.layouts; setTimeout(() => r([v.paints - a, v.layouts - b, v.state.vars.tmr1 === undefined]), 1300); }));
    eq('timer and spinner stop when the page is left', frozen, [0, 0, true]);
    eq('clock: no errors', t.errors, []);
    await t.ctx.close();
  }

  // ───────────── pages over http ─────────────
  {
    const t = await open({}, 'https://site.test/a.pane'), page = t.page;
    eq('http: a page opens from its address', [await url(page), await page.title(), (await texts(page))[0]], ['https://site.test/a.pane', 'Page A — Pane', 'This is page A']);
    ok('http: the status line shows the address and the answer', /site\.test\/a\.pane · 200/.test(await page.textContent('#status')), await page.textContent('#status'));
    await clickNode(page, "n.type === 'lnk' && n.url === 'b.pane'");
    eq('http: a link is read against the page it is on', [await url(page), (await texts(page))[0]], ['https://site.test/b.pane', 'This is page B']);
    ok('http: lines the engine does not know are counted in the status line', /2 lines not understood \(first: line 3\)/.test(await page.textContent('#status')), await page.textContent('#status'));
    await page.click('#back'); await settled(page);
    await clickNode(page, "n.type === 'lnk' && n.url === '../other/c.pane'");
    eq('http: .. in a link', await url(page), 'https://site.test/other/c.pane');
    await page.click('#back'); await settled(page);
    await clickNode(page, "n.type === 'lnk' && n.url === 'nope.pane'");
    ok('http: a missing page shows the answer code', (await texts(page)).join(' ').includes('The server answered 404') && /Could not open .* · 404/.test(await page.textContent('#status')), [await texts(page), await page.textContent('#status')]);
    await page.click('#back'); await settled(page);
    await clickNode(page, "n.type === 'lnk' && n.url === 'javascript:alert(1)'");
    ok('http: a javascript: link is refused', (await texts(page)).join(' ').includes('cannot be opened') && t.dialogs === 0);
    for (const [addr, want] of [['https://site.test/page.html', 'This is not a Pane page'], ['https://site.test/sneaky.pane', 'This is not a Pane page'], ['https://site.test/big.pane', 'The page is too large'], ['https://elsewhere.test/x.pane', 'The page did not load']]) {
      await page.fill('#addr', addr); await page.press('#addr', 'Enter'); await settled(page);
      ok(`http: ${addr.replace('https://', '')} → "${want}"`, (await texts(page))[0] === want, await texts(page));
    }
    eq('http: what is typed becomes an address', await page.evaluate(() => ['site.test/x.pane', 'Clock', 'https://a.test/b', 'pane:home'].map(paneShell.fromTyped)), ['https://site.test/x.pane', 'pane:clock', 'https://a.test/b', 'pane:home']);
    // a real redirect, from a server on this machine
    const server = http.createServer((req, res) => {
      if (req.url === '/redirect.pane') { res.writeHead(302, { location: '/landed.pane', 'access-control-allow-origin': '*' }); res.end(); }
      else if (req.url === '/landed.pane') { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }); res.end('txt Landed\nlnk Next next.pane'); }
      else { res.writeHead(404, { 'access-control-allow-origin': '*' }); res.end(); }
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const local = 'http://127.0.0.1:' + server.address().port;
    await page.fill('#addr', local + '/redirect.pane'); await page.press('#addr', 'Enter'); await settled(page);
    eq('http: after a redirect the address is the final one, and links are read against it', [await url(page), await page.inputValue('#addr'), (await texts(page))[0], await page.evaluate(() => paneShell.resolve('next.pane', paneShell.current.url))],
      [local + '/landed.pane', local + '/landed.pane', 'Landed', local + '/next.pane']);
    server.close();
    await page.fill('#addr', 'https://site.test/web.pane'); await page.press('#addr', 'Enter'); await settled(page);
    await clickNode(page, "n.type === 'btn'");
    await page.waitForFunction(() => paneShell.view.state.vars.price_status === 200);
    await settled(page);
    eq('http: web reads a value, with the full text and the answer code', [await state(page, '[st.vars.price, st.vars.price_txt, st.vars.price_status]'), (await texts(page))[0]], [[12.5, '12.5', 200], 'price 12.5 status 200']);
    ok('http: every request went to the test site, this machine, or was refused', t.requests.every(u => /^https:\/\/(site|elsewhere)\.test\/|^http:\/\/127\.0\.0\.1:/.test(u)), t.requests);
    eq('http: no errors, no dialogs', [t.errors, t.dialogs], [[], 0]);
    await t.ctx.close();
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

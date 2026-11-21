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
  // phase 2: scripts, storage, other sites
  '/store.pane': { body: 'txt v\nid out\nbtn Save 1\nid save\nscript\npage.find("out").text = "stored: " .. tostring(store.get("secret"))\npage.on("save", "click", function() store.set("secret", "of site.test") page.find("out").text = "saved" end)\nend script' },
  '/quota.pane': { body: 'txt v\nid out\nscript\nlocal n, err = 0, nil\nfor i = 1, 20 do local ok, e = pcall(store.set, "k" .. i, string.rep("x", 10000)) if not ok then err = e break end n = i end\npage.find("out").text = n .. " " .. tostring(err)\nend script' },
  '/cross.pane': { body: 'img https://other.test/pic.png\nimg pic.png\ntxt web {v} {v_status}\ntxt fetched\nid out\nbtn Go 1\nif tap 1=1 do web https://other.test/data.txt v\nscript\npage.fetch("https://other.test/data.txt", function(status, body) page.find("out").text = "fetch " .. status .. " " .. body end)\nend script' },
  '/font.pane': { body: 'font pacifico\ntxt fancy' },
  '/go.pane': { body: 'txt page with go\nbtn Leave 1\nid leave\ntmr 1 100\nif tmr1=1 do go https://site.test/b.pane\nscript\npage.go("https://site.test/b.pane")\npage.after(50, function() page.go("https://site.test/b.pane") end)\npage.on("leave", "click", function() page.go("b.pane") end)\nend script' },
  '/loop.pane': { body: 'txt n is {n}\nbtn Hang 1\nid hang\nbtn Count 2\nid count\nscript\npage.on("hang", "click", function() while true do end end)\npage.on("count", "click", function() page.set("n", (page.get("n") or 0) + 1) end)\nend script' },
  '/ticker.pane': { body: 'txt t\nscript\npage.every(50, function() print("tick") end)\nend script' },
  '/pic.png': { type: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAYAAACzzX7wAAAAEklEQVR4nGP4z8Dwn4GBgYEBAA8MAgCPu0qEAAAAAElFTkSuQmCC' },
};
// … and at https://other.test/…
const OTHER = {
  '/data.txt': { body: '42' },
  '/pic.png': SITE['/pic.png'],
  '/store.pane': { body: 'txt v\nid out\nscript\npage.find("out").text = "stored: " .. tostring(store.get("secret")) .. " keys: " .. #store.keys()\nend script' },
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
      const hit = u.host === 'site.test' ? SITE[u.pathname] : u.host === 'other.test' ? OTHER[u.pathname] : null;
      if (!hit) return u.host === 'site.test' ? r.fulfill({ status: 404, contentType: 'text/plain', body: 'not here' }) : r.abort();
      return r.fulfill({ status: 200, contentType: hit.type || 'text/plain; charset=utf-8', headers: { 'access-control-allow-origin': '*' }, body: hit.base64 ? Buffer.from(hit.base64, 'base64') : hit.body });
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

  // ───────────── a page with a script: Notes ─────────────
  {
    const t = await open({}, 'pane:notes'), page = t.page;
    const items = () => page.evaluate(() => paneShell.view.page.names.list.children.map(c => c.text));
    const go = async addr => { await page.fill('#addr', addr); await page.press('#addr', 'Enter'); await settled(page); };
    eq('notes: starts empty', [await items(), (await texts(page)).includes('Notes: 0'), t.errors], [[], true, []]);
    for (const words of ['buy milk', '{count} and count', 'btn Evil 9']) {
      await clickNode(page, "n.type === 'inp'"); await page.keyboard.type(words);
      await clickNode(page, "n.name === 'add'");
    }
    eq('notes: Add puts each note in the list and clears the field', [await items(), await state(page, 'st.inputs[1]'), (await texts(page)).includes('Notes: 3')], [['buy milk', '{count} and count', 'btn Evil 9'], '', true]);
    ok('notes: words that look like page lines or {expr} are shown as words', (await texts(page)).includes('{count} and count') && (await texts(page)).includes('btn Evil 9') && (await page.evaluate(() => paneShell.view.page.names.list.children.every(c => c.type === 'txt'))), await texts(page));
    await shot(page, 'notes-360');
    await page.click('#reload'); await settled(page);
    eq('notes: are still there after a reload', await items(), ['buy milk', '{count} and count', 'btn Evil 9']);
    ok('notes: are kept under the built-in site\'s own prefix', await page.evaluate(() => Object.keys(localStorage).length === 4 && Object.keys(localStorage).every(k => k.startsWith('pane.store|pane:|'))), await page.evaluate(() => Object.keys(localStorage)));
    await clickNode(page, "n.name === 'clear'");
    eq('notes: Clear all empties the list and the store', [await items(), await page.evaluate(() => Object.keys(localStorage).sort())], [[], ['pane.store|pane:|count']]);
    eq('notes: no script errors, nothing blocked', [await page.evaluate(() => paneShell.log), t.errors], [[], []]);

    // ───────────── storage belongs to a site ─────────────
    await go('https://site.test/store.pane');
    eq('storage: a site starts with nothing, whatever other sites kept', (await texts(page))[0], 'stored: nil');
    await clickNode(page, "n.name === 'save'");
    await page.click('#reload'); await settled(page);
    eq('storage: a site reads back its own value', (await texts(page))[0], 'stored: of site.test');
    await go('https://other.test/store.pane');
    eq('storage: another site sees none of it, not even the keys', (await texts(page))[0], 'stored: nil keys: 0');
    await go('pane:notes');
    eq('storage: nor does a built-in page', await items(), []);
    eq('storage: each site has its own prefix', await page.evaluate(() => Object.keys(localStorage).sort()), ['pane.store|https://site.test|secret', 'pane.store|pane:|count']);
    await go('https://site.test/quota.pane');
    ok('storage: a site can keep about 100 KB, then set fails with an error the script can catch', /^9 .*storage is full$/.test((await texts(page))[0]), await texts(page));
    await go('https://other.test/store.pane');
    eq('storage: one site being full does not affect another', (await texts(page))[0], 'stored: nil keys: 0');
    eq('storage: no errors', t.errors, []);
    await t.ctx.close();
  }

  // ───────────── other sites: asked first ─────────────
  {
    const t = await open({}, 'https://site.test/cross.pane'), page = t.page;
    const toOther = () => t.requests.filter(u => u.startsWith('https://other.test/'));
    await clickNode(page, "n.type === 'btn'");
    await page.waitForFunction(() => paneShell.view.state.vars.v_status === 0 && paneShell.view.page.names.out.text.startsWith('fetch'));
    await settled(page);
    eq('other site: nothing is requested from it before the user allows', [toOther(), (await texts(page))], [[], ['web 0 0', 'fetch 0 ']]);
    ok('other site: the page\'s own site needs no asking', t.requests.includes('https://site.test/pic.png'));
    eq('other site: the bar asks, naming both', [await page.isVisible('#perm'), await page.textContent('#permText')], [true, 'https://site.test wants to load from https://other.test.']);
    ok('other site: the status line says what was blocked', /blocked: /.test(await page.textContent('#status')), await page.textContent('#status'));
    await shot(page, 'permission-360');
    await page.click('#permNo'); await settled(page);
    await clickNode(page, "n.type === 'btn'"); await page.waitForTimeout(100);
    eq('other site: "Not now" hides the bar, and the page stays blocked without asking again', [await page.isVisible('#perm'), toOther()], [false, []]);
    await page.click('#reload'); await settled(page);
    await page.waitForSelector('#perm:not([hidden])');
    await page.click('#permAllow'); await settled(page);
    await page.waitForFunction(() => paneShell.view.page.names.out.text === 'fetch 200 42');
    await clickNode(page, "n.type === 'btn'");
    await page.waitForFunction(() => paneShell.view.state.vars.v_status === 200); await settled(page);
    ok('other site: after Allow the page loads again and its requests go through', toOther().includes('https://other.test/pic.png') && toOther().includes('https://other.test/data.txt') && (await texts(page)).join('|') === 'web 42 200|fetch 200 42' && !(await page.isVisible('#perm')), [toOther(), await texts(page)]);
    eq('other site: the permission is for that pair only', await page.evaluate(() => [paneShell.allow('web', 'https://other.test/x', 'https://site.test'), paneShell.allow('web', 'https://third.test/x', 'https://site.test'), paneShell.allow('web', 'https://site.test/x', 'https://other.test'), paneShell.allow('web', 'https://other.test/x', null)]), [true, false, false, false]);
    eq('other site: what is never allowed', await page.evaluate(() => [paneShell.allow('img', 'data:image/png;base64,AAAA', 'https://site.test'), paneShell.allow('web', 'data:text/plain,hi', 'https://site.test'), paneShell.allow('web', 'file:///etc/passwd', 'https://site.test'), paneShell.allow('img', 'javascript:alert(1)', 'https://site.test'), paneShell.allow('web', 'https://site.test/x', 'https://site.test')]), [true, false, false, false, true]);
    await page.fill('#addr', 'https://site.test/font.pane'); await page.press('#addr', 'Enter'); await settled(page);
    eq('other site: a font from a font service is asked for in the same way', [t.requests.filter(u => /googleapis/.test(u)), await page.textContent('#permText')], [[], 'https://site.test wants to load from https://fonts.googleapis.com.']);
    eq('other site: no errors', t.errors, []);
    await t.ctx.close();
  }

  // ───────────── scripts cannot take the user elsewhere, hang the page, or outlive it ─────────────
  {
    const t = await open({}, 'https://site.test/go.pane'), page = t.page;
    await page.waitForTimeout(400); await settled(page);
    eq('go: at load, from a timer, and from a tmr statement, a page cannot navigate', [await url(page), await page.evaluate(() => paneShell.log.filter(l => l.kind === 'blocked').length)], ['https://site.test/go.pane', 3]);
    await clickNode(page, "n.name === 'leave'");
    eq('go: from a click it can', await url(page), 'https://site.test/b.pane');

    await page.fill('#addr', 'https://site.test/loop.pane'); await page.press('#addr', 'Enter'); await settled(page);
    await clickNode(page, "n.name === 'count'");
    const started = Date.now();
    await clickNode(page, "n.name === 'hang'");
    const took = Date.now() - started;
    await clickNode(page, "n.name === 'count'");
    ok('loop: a handler that never ends is stopped and the page still works', (await texts(page))[0] === 'n is 2' && /script error: .*step budget exhausted/.test(await page.textContent('#status')) && took < 5000, [await texts(page), await page.textContent('#status'), took]);
    await page.click('#back'); await settled(page);
    eq('loop: so does the browser', await url(page), 'https://site.test/b.pane');

    await page.fill('#addr', 'https://site.test/ticker.pane'); await page.press('#addr', 'Enter'); await settled(page);
    await page.waitForFunction(() => paneShell.log.length >= 2);
    await page.fill('#addr', 'home'); await page.press('#addr', 'Enter'); await settled(page);
    await page.waitForTimeout(300);
    eq('leaving: the script of the page before does nothing more', await page.evaluate(() => paneShell.log.length), 0);
    eq('scripts: no errors', t.errors, []);
    await t.ctx.close();
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

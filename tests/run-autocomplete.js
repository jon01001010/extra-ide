#!/usr/bin/env node
// Checks the live library autocomplete of an Emit IDE build in headless Chromium:
// after a Run has loaded a library, typing `THREE.Sc`, `BABYLON.MeshBuilder.Cre` or `conf`
// must offer the library's real names. Typing is done with real keyboard events.
// CDN requests are answered from tests/node_modules exactly as in run-examples.js.
//
//   node tests/run-autocomplete.js [path/to/emit-ide.html]
//
// Exit code 0 when every check passes.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const LIBS = path.join(__dirname, 'node_modules');
const CDN_MAP = [
  [/three(\.min)?\.js/, 'three/build/three.min.js'],
  [/babylon/, 'babylonjs/babylon.js'],
  [/canvas-confetti/, 'canvas-confetti/dist/confetti.browser.js'],
  [/dayjs/, 'dayjs/dayjs.min.js'],
];

let failed = 0, passed = 0;
function check(label, ok, detail) {
  if (ok) { passed++; console.log('PASS  ' + label); }
  else { failed++; console.log('FAIL  ' + label + (detail !== undefined ? '\n      ' + String(detail).slice(0, 400) : '')); }
}

async function openIde(browser, fileUrl, example, { run = true, touch = false } = {}) {
  const ctx = await browser.newContext(touch
    ? { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true }
    : { viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message.slice(0, 300)));
  await page.route(/^https?:/, route => {
    const url = route.request().url();
    const hit = CDN_MAP.find(([re]) => re.test(url));
    const file = hit && path.join(LIBS, hit[1]);
    if (file && fs.existsSync(file)) {
      return route.fulfill({ body: fs.readFileSync(file), contentType: 'application/javascript' });
    }
    return route.abort();
  });
  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof compileAndRun === 'function' && typeof EX === 'object');
  await page.evaluate(n => {
    try { closeWelcome(); } catch (e) {}
    const ed = document.getElementById('editor');
    ed.value = EX[n];
    ed.dispatchEvent(new Event('input'));
  }, example);
  if (run) {
    await page.evaluate(() => compileAndRun());
    await page.waitForTimeout(1200);
    const status = await page.evaluate(() => document.getElementById('sTxt').innerText);
    if (status !== 'Done') throw new Error(example + ' did not run: ' + status);
  }
  return page;
}

// Put the cursor at the end of the first line containing `anchor`, open a new line (real Enter key)
// and type `text` with real key events.
async function typeAfter(page, anchor, text) {
  const ok = await page.evaluate(a => {
    const ed = document.getElementById('editor');
    const i = ed.value.indexOf(a);
    if (i < 0) return false;
    let end = ed.value.indexOf('\n', i); if (end < 0) end = ed.value.length;
    try { hideAC(); if (innerWidth < 768) showView('edit'); } catch (e) {}
    ed.focus(); ed.selectionStart = ed.selectionEnd = end;
    return true;
  }, anchor);
  if (!ok) throw new Error('anchor not found: ' + anchor);
  await page.waitForTimeout(350);   // panel slide on phones
  await page.keyboard.press('Enter');
  await page.keyboard.type(text, { delay: 15 });
  await page.waitForTimeout(80);
}
const popup = page => page.evaluate(() => {
  const p = document.getElementById('acPopup');
  const rows = [...p.querySelectorAll('.ac-item')].map(el => ({
    name: el.querySelector('.ac-name').textContent, desc: el.querySelector('.ac-desc').textContent,
    lib: el.classList.contains('ac-lib'), hint: el.classList.contains('ac-hint'), sel: el.classList.contains('sel'),
  }));
  return { shown: p.classList.contains('show') && getComputedStyle(p).display !== 'none', rows: p.classList.contains('show') ? rows : [] };
});
const curLine = page => page.evaluate(() => {
  const ed = document.getElementById('editor');
  const b = ed.value.substring(0, ed.selectionStart);
  return b.substring(b.lastIndexOf('\n') + 1);
});
const names = p => p.rows.map(r => r.name);

(async () => {
  const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'emit-ide-1_32.html'));
  const fileUrl = 'file://' + file;
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  let page, p;

  // ── No library loaded ───────────────────────────────────────────────
  page = await openIde(browser, fileUrl, 'orbit', { run: false });
  check('fresh page: no library globals', (await page.evaluate(() => _libGlobals().length)) === 0,
    await page.evaluate(() => _libGlobals().join(' ')));
  await typeAfter(page, 'let cv = getCanvas()', 'THREE.');
  p = await popup(page);
  check('not loaded: typing THREE. offers no members', p.rows.filter(r => r.lib).length === 0, JSON.stringify(p.rows));
  check('not loaded: "Run once" hint row is shown', p.shown && p.rows.length === 1 && p.rows[0].hint && /Run once to load THREE/.test(p.rows[0].name), JSON.stringify(p));
  await page.keyboard.type('Sc', { delay: 15 });
  await page.keyboard.press('Enter');
  check('not loaded: hint does not swallow Enter', (await curLine(page)) === '  ' && /THREE\.Sc\n/.test(await page.evaluate(() => document.getElementById('editor').value)), JSON.stringify(await curLine(page)));
  await typeAfter(page, 'let cv = getCanvas()', 'foo.');
  p = await popup(page);
  check('not loaded: unknown name foo. shows nothing', !p.shown, JSON.stringify(p));
  check('not loaded: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();

  // ── three.js (orbit example) ────────────────────────────────────────
  page = await openIde(browser, fileUrl, 'orbit');
  const g3 = await page.evaluate(() => _libGlobals());
  check('orbit: discovered globals are exactly [THREE]', g3.join(',') === 'THREE', g3.join(','));
  await typeAfter(page, 'let cv = getCanvas()', 'THREE.Sc');
  p = await popup(page);
  check('orbit: THREE.Sc shows the popup with Scene', p.shown && names(p).includes('Scene'), JSON.stringify(p));
  check('orbit: Scene is first, selected, hinted "class"', p.rows[0] && p.rows[0].name === 'Scene' && p.rows[0].sel && p.rows[0].desc === 'class' && p.rows[0].lib, JSON.stringify(p.rows[0]));
  check('orbit: prefix matches come before substring matches',
    (() => { const n = names(p); const firstSub = n.findIndex(x => !/^sc/i.test(x)); return firstSub < 0 || n.slice(firstSub).every(x => !/^sc/i.test(x) && /sc/i.test(x)); })(), names(p).join(' '));
  if (process.env.SCREENSHOT) {   // SCREENSHOT=1 refreshes tests/autocomplete-three.png
    const shot = path.join(__dirname, 'autocomplete-three.png');
    await page.locator('.ed-area').screenshot({ path: shot }).catch(() => page.screenshot({ path: shot }));
  }
  await page.keyboard.press('Enter');
  check('orbit: Enter inserts THREE.Scene(', (await curLine(page)) === '  THREE.Scene(', JSON.stringify(await curLine(page)));
  check('orbit: popup closed after pick', !(await popup(page)).shown);
  // fn hint with arity, arrow-key navigation survives keyup
  await typeAfter(page, 'let cv = getCanvas()', 'THREE.MathUtils.cl');
  p = await popup(page);
  check('orbit: chain THREE.MathUtils.cl offers clamp fn(3)', p.rows.some(r => r.name === 'clamp' && r.desc === 'fn(3)'), JSON.stringify(p.rows));
  await typeAfter(page, 'let cv = getCanvas()', 'THREE.Sc');
  const second = (await popup(page)).rows[1].name;
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(50);
  p = await popup(page);
  check('orbit: ArrowDown selects the 2nd row and it stays selected', p.rows[1] && p.rows[1].sel, JSON.stringify(p.rows.slice(0, 3)));
  await page.keyboard.press('Tab');
  check('orbit: Tab inserts the 2nd row (' + second + ')', (await curLine(page)).startsWith('  THREE.' + second), JSON.stringify(await curLine(page)));
  // Escape dismisses and it stays dismissed
  await typeAfter(page, 'let cv = getCanvas()', 'THREE.Sc');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(50);
  check('orbit: Escape closes the popup', !(await popup(page)).shown);
  // Variable initialised from a library class
  await typeAfter(page, 'let p = cam.position', 'cam.updateP');
  p = await popup(page);
  check('orbit: cam.updateP (let cam = THREE.PerspectiveCamera(..)) offers updateProjectionMatrix', names(p).includes('updateProjectionMatrix'), JSON.stringify(p.rows));
  // Not inside strings / comments
  await typeAfter(page, 'let cv = getCanvas()', 'printStr("THREE.Sc');
  check('orbit: nothing inside a string literal', !(await popup(page)).rows.some(r => r.lib), JSON.stringify(await popup(page)));
  await typeAfter(page, 'let cv = getCanvas()', '// THREE.Sc');
  check('orbit: nothing inside a comment', !(await popup(page)).rows.some(r => r.lib), JSON.stringify(await popup(page)));
  // Global name suggestion
  await typeAfter(page, 'let cv = getCanvas()', 'let v = TH');
  p = await popup(page);
  check('orbit: typing TH offers the THREE global, marked lib', p.rows.some(r => r.name === 'THREE' && r.lib && /^lib/.test(r.desc)), JSON.stringify(p.rows));
  // Library panel
  await page.evaluate(() => toggleLibs());
  const live = await page.evaluate(() => [...document.querySelectorAll('#libsContent .lib-live')].map(e => e.textContent));
  check('orbit: library panel shows "THREE · N members"', live.some(t => /THREE(?: ▾)? · \d+\+? members/.test(t)), live.join(' | '));
  // Member browser: tapping the global's name lists the live members; a filter narrows them; a tap inserts.
  await page.locator('.lib-card .lib-browse-btn').first().click();
  const browseAll = await page.locator('.lib-browse-row').count();
  await page.locator('.lib-browse-q').fill('sc');
  await page.waitForTimeout(150);
  const browseRows = (await page.locator('.lib-browse-row').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
  check('orbit: member browser lists THREE members and filters them', browseAll > 20 && /^new THREE\.Scene\(\) class$/.test(browseRows[0] || ''), browseAll + ' rows; ' + browseRows.slice(0, 4).join(' | '));
  await page.evaluate(() => { const ed = document.getElementById('editor'); ed.setSelectionRange(ed.value.length, ed.value.length); });
  await page.locator('.lib-browse-row').first().click();
  const browsePicked = await page.evaluate(() => ({ text: document.getElementById('editor').value.slice(-17), open: document.getElementById('libsOverlay').classList.contains('show') }));
  check('orbit: tapping a member inserts it and closes the panel', browsePicked.text === 'new THREE.Scene()' && !browsePicked.open, JSON.stringify(browsePicked));
  await page.evaluate(() => { const ed = document.getElementById('editor'); ed.value = ed.value.slice(0, -17); ed.dispatchEvent(new Event('input')); toggleLibs(); renderLibs(); });
  console.log('      panel: ' + live.join(' | '));
  check('orbit: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();

  // ── Babylon ─────────────────────────────────────────────────────────
  page = await openIde(browser, fileUrl, 'babylon');
  console.log('      babylon globals: ' + (await page.evaluate(() => _libGlobals().join(' '))));
  const perf = await page.evaluate(() => {
    const t0 = performance.now(); let threw = null, m = [];
    try { m = _jsMembers(BABYLON); } catch (e) { threw = String(e); }
    const t1 = performance.now(); _jsMembers(BABYLON); const t2 = performance.now();
    const sorted = m.every((e, i) => i === 0 || m[i - 1].name < e.name);
    const kinds = {}; m.forEach(e => { kinds[e.kind] = (kinds[e.kind] || 0) + 1; });
    const shape = m.every(e => typeof e.name === 'string' && ['class', 'fn', 'obj', 'value'].includes(e.kind) && (e.arity === null || Number.isInteger(e.arity)));
    return { first: t1 - t0, cached: t2 - t1, n: m.length, truncated: !!m.truncated, threw, sorted, kinds, shape };
  });
  console.log('      _jsMembers(BABYLON): ' + perf.n + ' members' + (perf.truncated ? ' (truncated)' : '') + ', first call ' + perf.first.toFixed(1) + ' ms, cached ' + perf.cached.toFixed(2) + ' ms, kinds ' + JSON.stringify(perf.kinds));
  check('babylon: _jsMembers(BABYLON) does not throw', perf.threw === null, perf.threw);
  check('babylon: _jsMembers(BABYLON) under 200 ms (' + perf.first.toFixed(1) + ' ms)', perf.first < 200);
  check('babylon: result is sorted, de-duplicated, well-formed', perf.sorted && perf.shape && perf.n > 100);
  const hostile = await page.evaluate(() => {
    const bad = { get boom() { throw new Error('getter'); } };
    Object.defineProperty(bad, 'hidden', { enumerable: false, get() { throw new Error('getter2'); } });
    const proxy = new Proxy({}, { ownKeys() { throw new Error('ownKeys'); }, getPrototypeOf() { throw new Error('proto'); }, getOwnPropertyDescriptor() { throw new Error('gopd'); } });
    const rev = Proxy.revocable({}, {}); rev.revoke();
    class A { m(a, b) {} static s() {} } class B extends A { n() {} }
    const out = [];
    try {
      for (const v of [null, undefined, 1, 'str', true, Symbol('x'), bad, proxy, rev.proxy, window, document, Object.create(null), [], new B(), B, () => 1]) out.push(_jsMembers(v).length);
    } catch (e) { return { threw: String(e) }; }
    const nb = _jsMembers(new B()).map(e => e.name + ':' + e.kind + ':' + e.arity).join(',');
    const sb = _jsMembers(B).map(e => e.name + ':' + e.kind).join(',');
    const bm = _jsMembers(bad).map(e => e.name + ':' + e.kind).join(',');
    return { out, nb, sb, bm, kA: _jsKind(A), kf: _jsKind(function () {}), ka: _jsKind(() => 1) };
  });
  check('_jsMembers never throws on hostile values (throwing getters, proxies, primitives)', !hostile.threw, hostile.threw);
  check('_jsMembers walks the prototype chain, reports kind/arity, never runs getters',
    hostile.nb === 'm:fn:2,n:fn:0' && hostile.sb === 's:fn' && hostile.bm === 'boom:value,hidden:value' && hostile.kA === 'class' && hostile.kf === 'fn' && hostile.ka === 'fn', JSON.stringify(hostile));
  await typeAfter(page, 'let cv = getCanvas()', 'BABYLON.');
  p = await popup(page);
  check('babylon: bare BABYLON. lists hand-catalogued names first, with their parameter names', p.rows[0] && p.rows[0].lib && /\(.*[a-z].*\)/.test(p.rows[0].desc) && p.rows.length === 40, JSON.stringify(p.rows.slice(0, 3)));
  await typeAfter(page, 'let cv = getCanvas()', 'BABYLON.MeshBuilder.Cre');
  p = await popup(page);
  check('babylon: BABYLON.MeshBuilder.Cre offers CreateBox', p.shown && names(p).includes('CreateBox'), JSON.stringify(p));
  const idx = names(p).indexOf('CreateBox');
  await page.locator('#acPopup .ac-item').nth(idx).click();   // mouse pick
  check('babylon: clicking CreateBox inserts BABYLON.MeshBuilder.CreateBox(', (await curLine(page)) === '  BABYLON.MeshBuilder.CreateBox(', JSON.stringify(await curLine(page)));
  // typing latency: per-keystroke autocomplete cost on the biggest namespace
  const keyCost = await page.evaluate(() => {
    const ed = document.getElementById('editor'); const i = ed.value.indexOf('let cv = getCanvas()') + 20;
    ed.value = ed.value.slice(0, i) + '\n  BABYLON.Ve' + ed.value.slice(i); ed.selectionStart = ed.selectionEnd = i + 13;
    const t0 = performance.now(); for (let k = 0; k < 20; k++) checkAC(); return (performance.now() - t0) / 20;
  });
  console.log('      checkAC() on "BABYLON.Ve": ' + keyCost.toFixed(2) + ' ms per keystroke');
  check('babylon: autocomplete costs under 16 ms per keystroke', keyCost < 16, keyCost);
  check('babylon: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();

  // ── confetti: a library whose global is a function ──────────────────
  page = await openIde(browser, fileUrl, 'confetti');
  console.log('      confetti globals: ' + (await page.evaluate(() => _libGlobals().join(' '))));
  await typeAfter(page, 'origin.y = 0.7', 'conf');
  p = await popup(page);
  check('confetti: typing conf offers the confetti global, marked lib', p.shown && p.rows.some(r => r.name === 'confetti' && r.lib), JSON.stringify(p));
  const ci = p.rows.findIndex(r => r.name === 'confetti' && r.lib);
  for (let i = 0; i < ci; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  check('confetti: picking it inserts confetti(', (await curLine(page)) === '  confetti(', JSON.stringify(await curLine(page)));
  await typeAfter(page, 'origin.y = 0.7', 'confetti.');
  p = await popup(page);
  check('confetti: confetti. lists the function\'s own members (reset, create …)', names(p).includes('reset') && names(p).includes('create') && !names(p).includes('length'), JSON.stringify(p.rows));
  check('confetti: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();

  // ── Touch: tap picks, as the existing popup does ────────────────────
  page = await openIde(browser, fileUrl, 'orbit', { touch: true });
  await typeAfter(page, 'let cv = getCanvas()', 'THREE.Sc');
  p = await popup(page);
  check('touch: popup shows on a phone-sized touch viewport', p.shown && names(p).includes('Scene'), JSON.stringify(p));
  const box = await page.locator('#acPopup .ac-item').first().boundingBox();
  const vp = page.viewportSize();
  check('touch: first row is inside the viewport', box && box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width + 1 && box.y + box.height <= vp.height + 1, JSON.stringify(box));
  await page.locator('#acPopup .ac-item').first().tap();
  check('touch: tapping Scene inserts THREE.Scene(', (await curLine(page)) === '  THREE.Scene(', JSON.stringify(await curLine(page)));
  check('touch: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();

  await browser.close();
  console.log('\n' + passed + '/' + (passed + failed) + ' autocomplete checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL  runner crashed: ' + (e && e.stack || e)); process.exit(1); });

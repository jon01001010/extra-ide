#!/usr/bin/env node
// Runs against the REAL CDNs (no offline routing): every bundled example, every registry library's
// example, the npm / `as Name` / esm.sh forms, and an offline export built from the live CDN.
// Needs network access to cdn.jsdelivr.net and esm.sh; everything else is blocked and reported.
//
//   node tests/run-live.js [path/to/emit-ide.html] [name ...]      (names: example or library names)
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ALLOWED = /^https:\/\/(cdn\.jsdelivr\.net|esm\.sh)\//;
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;

function launchOpts() {
  const o = { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] };
  if (proxy) {
    const u = new URL(proxy);
    o.proxy = { server: u.protocol + '//' + u.host };
    if (u.username) { o.proxy.username = decodeURIComponent(u.username); o.proxy.password = decodeURIComponent(u.password); }
  }
  return o;
}

async function newPage(browser, stats) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page._errs = [];
  page.on('pageerror', e => page._errs.push('pageerror: ' + e.message.slice(0, 200)));
  await page.route(/^https?:/, route => {
    const url = route.request().url();
    if (ALLOWED.test(url)) { stats.live.add(url.split('?')[0]); return route.continue(); }
    if (!/fonts\.(googleapis|gstatic)\.com/.test(url)) stats.blocked.add(url.split('?')[0]);
    return route.abort();
  });
  page.on('requestfailed', r => { if (ALLOWED.test(r.url())) stats.failed.add(r.url() + ' — ' + (r.failure() || {}).errorText); });
  return page;
}

async function runSource(browser, fileUrl, src, stats, waitMs) {
  const page = await newPage(browser, stats);
  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof compileAndRun === 'function' && typeof EX === 'object');
  const t0 = Date.now();
  await page.evaluate(s => {
    try { closeWelcome(); } catch (e) {}
    const ed = document.getElementById('editor');
    ed.value = typeof s === 'function' ? s() : s;
    ed.dispatchEvent(new Event('input'));
  }, src);
  await page.evaluate(() => compileAndRun()).catch(e => page._errs.push('run rejected: ' + e.message.slice(0, 200)));
  await page.waitForTimeout(waitMs || 1500);
  const status = await page.evaluate(() => document.getElementById('sTxt').innerText);
  const output = await page.evaluate(() => document.getElementById('tab-output').innerText);
  const errors = page._errs.slice();
  if (status !== 'Done') errors.push('status: ' + status);
  const bad = output.split('\n').filter(l => /✗|⚠|\bERROR\b/.test(l));
  if (bad.length) errors.push('output: ' + bad[0].slice(0, 260));
  return { page, errors, output, ms: Date.now() - t0 };
}

(async () => {
  const file = path.resolve(process.argv[2] && /\.html$/.test(process.argv[2]) ? process.argv[2] : path.join(__dirname, '..', 'emit-ide-1_32.html'));
  const only = process.argv.slice(2).filter(a => !/\.html$/.test(a));
  const fileUrl = 'file://' + file;
  const stats = { live: new Set(), blocked: new Set(), failed: new Set() };
  const browser = await chromium.launch(launchOpts());

  const probe = await newPage(browser, stats);
  await probe.goto(fileUrl);
  await probe.waitForFunction(() => typeof EX === 'object' && typeof LIBS === 'object');
  const exNames = await probe.evaluate(() => Object.keys(EX));
  const libs = await probe.evaluate(() => LIBS.map(l => ({ name: l.name, example: l.example || null, cdn: l.cdn })));
  await probe.context().close();

  const cases = [];
  exNames.forEach(n => cases.push({ id: 'example:' + n, name: n, src: `EX[${JSON.stringify(n)}]`, fromPage: true }));
  libs.forEach(l => { if (l.example) cases.push({ id: 'lib:' + l.name, name: l.name, src: l.example }); });
  cases.push({ id: 'form:npm-name', name: 'npm-name', src: 'use tinycolor2@1.6.0\nexport fn run() {\n  printStr("hex=" + tinycolor("red").toHexString())\n}', expect: 'hex=#ff0000' });
  cases.push({ id: 'form:as-name-esm', name: 'as-name-esm', src: 'use tinycolor2@1.6.0 as TC\nexport fn run() {\n  printStr("mix=" + TC.mix("#ff0000", "#0000ff", 50).toHexString())\n}', expect: 'mix=#800080' });
  cases.push({ id: 'form:esm.sh', name: 'esm.sh', src: 'use esm.sh:tinycolor2@1.6.0 as TC\nexport fn run() {\n  printStr("hex=" + TC("blue").toHexString())\n}', expect: 'hex=#0000ff' });
  cases.push({ id: 'form:url', name: 'url', src: 'use "https://cdn.jsdelivr.net/npm/dayjs@1.11.23/dayjs.min.js"\nexport fn run() {\n  printStr("y=" + dayjs("2024-03-15").format("YYYY"))\n}', expect: 'y=2024' });
  cases.push({ id: 'form:css-url', name: 'css-url', src: 'use nprogress\nexport fn run() {\n  NProgress.start()\n  printStr("started")\n}', expect: 'started' });
  cases.push({ id: 'form:missing-package', name: 'missing-package', src: 'use this-package-does-not-exist-emit-test@9.9.9\nexport fn run() { printStr("x") }', expectError: /Could not load|not load|failed/i });

  const run = cases.filter(c => !only.length || only.includes(c.name) || only.includes(c.id));
  let failed = 0;
  for (const c of run) {
    const src = c.fromPage ? new Function('return ' + c.src) : c.src;
    let r;
    if (c.fromPage) {
      const page = await newPage(browser, stats);
      await page.goto(fileUrl);
      await page.waitForFunction(() => typeof compileAndRun === 'function');
      await page.evaluate(n => { try { closeWelcome(); } catch (e) {} const ed = document.getElementById('editor'); ed.value = EX[n]; ed.dispatchEvent(new Event('input')); }, c.name);
      const t0 = Date.now();
      await page.evaluate(() => compileAndRun()).catch(e => page._errs.push('run rejected: ' + e.message.slice(0, 200)));
      await page.waitForTimeout(1500);
      const status = await page.evaluate(() => document.getElementById('sTxt').innerText);
      const output = await page.evaluate(() => document.getElementById('tab-output').innerText);
      const errors = page._errs.slice();
      if (status !== 'Done') errors.push('status: ' + status);
      const bad = output.split('\n').filter(l => /✗|⚠|\bERROR\b/.test(l));
      if (bad.length) errors.push('output: ' + bad[0].slice(0, 260));
      r = { page, errors, output, ms: Date.now() - t0 };
    } else {
      r = await runSource(browser, fileUrl, src, stats, 1800);
    }
    let errors = r.errors;
    if (c.expectError) {
      errors = c.expectError.test(r.output) ? [] : ['expected a readable load error, got: ' + r.output.replace(/\n+/g, ' | ').slice(0, 300)];
    } else if (c.expect && !r.output.split('\n').some(l => l.replace(/^> /, '').trim() === c.expect)) {
      errors.push('missing output line "' + c.expect + '"; got: ' + r.output.split('\n').filter(l => /^>/.test(l)).join(' | ').slice(0, 200));
    }
    await r.page.context().close();
    if (errors.length) { failed++; console.log('FAIL  ' + c.id + '\n      ' + errors.join('\n      ')); }
    else console.log('PASS  ' + c.id + '  [' + r.ms + ' ms]');
  }

  // Offline export built from the live CDN, then opened with every request blocked.
  for (const ex of ['orbit', 'babylon'].filter(n => !only.length || only.includes('offline') || only.includes('offline-' + n))) {
    const page = await newPage(browser, stats);
    await page.goto(fileUrl);
    await page.waitForFunction(() => typeof compileAndRun === 'function');
    await page.evaluate(n => { try { closeWelcome(); } catch (e) {} const ed = document.getElementById('editor'); ed.value = EX[n]; ed.dispatchEvent(new Event('input')); }, ex);
    await page.evaluate(() => compileAndRun()); await page.waitForTimeout(2500);
    let html = null, alertText = '';
    page.on('dialog', d => { alertText = d.message(); d.dismiss().catch(() => {}); });
    const t0 = Date.now();
    const got = await page.evaluate(() => new Promise(res => {
      const orig = window._download; let done = false;
      window._download = function (name, data, type) { if (!done) { done = true; res({ name: name, text: typeof data === 'string' ? data : null, size: data.length || data.size || 0 }); } };
      Promise.resolve(doExport('htmloff')).then(rep => { if (!done && !rep) { done = true; res({ err: 'export reported failure' }); } }).catch(e => { if (!done) { done = true; res({ err: String(e && e.message || e) }); } });
      setTimeout(() => { if (!done) { done = true; res({ err: 'timeout' }); } window._download = orig; }, 120000);
    }));
    const ms = Date.now() - t0;
    await page.context().close();
    const errs = [];
    if (!got || got.err || !got.text) errs.push('offline export produced no file: ' + (got && got.err || alertText || 'no text'));
    else {
      html = got.text;
      const f = path.join(os.tmpdir(), 'emit-live-offline-' + ex + '.html');
      fs.writeFileSync(f, html);
      const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
      const p2 = await ctx.newPage(); const pe = []; let reqs = 0;
      p2.on('pageerror', e => pe.push(e.message.slice(0, 200)));
      await p2.route(/^https?:/, r => { reqs++; r.abort(); });
      await p2.goto('file://' + f); await p2.waitForTimeout(3000);
      const info = await p2.evaluate(() => ({ canvases: [...document.querySelectorAll('canvas')].map(c => c.width + 'x' + c.height), text: document.body.innerText.slice(0, 300) }));
      if (pe.length) errs.push('page errors offline: ' + pe.join(' ; '));
      if (reqs) errs.push(reqs + ' network request(s) attempted by the offline page');
      if (!info.canvases.length) errs.push('no canvas in the offline page; text: ' + info.text.replace(/\n+/g, ' | '));
      if (/✗/.test(info.text)) errs.push('offline page shows an error: ' + info.text.replace(/\n+/g, ' | '));
      await ctx.close();
    }
    if (errs.length) { failed++; console.log('FAIL  offline-export:' + ex + '\n      ' + errs.join('\n      ')); }
    else console.log('PASS  offline-export:' + ex + '  [' + (html.length / 1024 | 0) + ' KB, built in ' + ms + ' ms]');
  }

  await browser.close();
  console.log('\nlive CDN URLs fetched: ' + stats.live.size);
  if (stats.failed.size) console.log('live requests that failed:\n  ' + [...stats.failed].join('\n  '));
  if (stats.blocked.size) console.log('requests to hosts outside jsDelivr/esm.sh (blocked):\n  ' + [...stats.blocked].slice(0, 40).join('\n  '));
  console.log('\n' + (failed ? failed + ' FAILED' : 'all passed'));
  process.exit(failed ? 1 : 0);
})();

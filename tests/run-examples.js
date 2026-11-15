#!/usr/bin/env node
// Runs every bundled example of an Emit IDE build in headless Chromium.
// CDN requests are answered from tests/node_modules (run `npm install` in tests/ first);
// any other network request is blocked, so the run is offline and repeatable.
//
//   node tests/run-examples.js [path/to/emit-ide.html] [exampleName ...]
//
// Exit code 0 when every example compiles, runs and raises no page error.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const LIBS = path.join(__dirname, 'node_modules');
// CDN URL pattern -> file under tests/node_modules. Add a line when an example needs another library.
const CDN_MAP = [
  [/three(\.min)?\.js/, 'three/build/three.min.js'],
  [/babylon/, 'babylonjs/babylon.js'],
  [/canvas-confetti/, 'canvas-confetti/dist/confetti.browser.js'],
  [/dayjs/, 'dayjs/dayjs.min.js'],
];

async function runExample(browser, fileUrl, name) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  const blocked = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 300)));
  await page.route(/^https?:/, route => {
    const url = route.request().url();
    const hit = CDN_MAP.find(([re]) => re.test(url));
    const file = hit && path.join(LIBS, hit[1]);
    if (file && fs.existsSync(file)) {
      return route.fulfill({ body: fs.readFileSync(file), contentType: 'application/javascript' });
    }
    if (!/fonts\.(googleapis|gstatic)\.com/.test(url)) blocked.push(url);
    return route.abort();
  });
  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof compileAndRun === 'function' && typeof EX === 'object');
  await page.evaluate(n => {
    try { closeWelcome(); } catch (e) {}
    const ed = document.getElementById('editor');
    ed.value = EX[n];
    ed.dispatchEvent(new Event('input'));
  }, name);
  await page.evaluate(() => compileAndRun()).catch(e => errors.push('run rejected: ' + e.message.slice(0, 300)));
  await page.waitForTimeout(1500);
  // Press every button the program created, so click handlers are exercised too.
  const buttons = await page.evaluate(() => {
    const bs = [...document.querySelectorAll('#tab-output button')];
    bs.forEach(b => b.click());
    return bs.length;
  });
  if (buttons) await page.waitForTimeout(800);
  const status = await page.evaluate(() => document.getElementById('sTxt').innerText);
  const output = await page.evaluate(() => document.getElementById('tab-output').innerText);
  await page.close();
  if (status !== 'Done') errors.push('status: ' + status);
  if (/\bERROR\b|✗/.test(output)) {
    errors.push('output reports an error: ' + (output.match(/.*(?:\bERROR\b|✗).*/) || [''])[0].slice(0, 300));
  }
  if (blocked.length) errors.push('blocked requests (add to CDN_MAP): ' + blocked.join(', '));
  return { name, ok: errors.length === 0, errors, buttons, output };
}

(async () => {
  const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'emit-ide-1_32.html'));
  const only = process.argv.slice(3);
  const fileUrl = 'file://' + file;
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const probe = await browser.newPage();
  await probe.route(/^https?:/, r => r.abort());
  await probe.goto(fileUrl);
  const names = (await probe.evaluate(() => Object.keys(EX))).filter(n => !only.length || only.includes(n));
  await probe.close();
  let failed = 0;
  for (const name of names) {
    const r = await runExample(browser, fileUrl, name);
    if (r.ok) console.log('PASS  ' + name);
    else { failed++; console.log('FAIL  ' + name + '\n      ' + r.errors.join('\n      ')); }
    if (process.env.VERBOSE) console.log(r.output.replace(/^/gm, '      | '));
  }
  await browser.close();
  console.log('\n' + (names.length - failed) + '/' + names.length + ' examples passed');
  process.exit(failed ? 1 : 0);
})();

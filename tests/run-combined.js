#!/usr/bin/env node
// Checks that the loader, the interop and the autocomplete work together:
// an ES-module library loaded with `use … as Name` is callable with callbacks,
// and its members and the interop builtins show up in autocomplete.
//
//   node tests/run-combined.js [path/to/emit-ide.html]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const LIBS = path.join(__dirname, 'node_modules');

const PROGRAM = [
  'use tinycolor2@1.6.0 as TC',
  '',
  'fn show(v: num, i: int) {',
  '  printStr(strConcat(intToStr(i), strConcat(":", numToStr(v))))',
  '}',
  '',
  'fn done(s: str) {',
  '  printStr(strConcat("resolved ", s))',
  '}',
  '',
  'export fn run() {',
  '  let c = TC.mix("#ff0000", "#0000ff", 50)',
  '  let hex: str = c.toHexString()',
  '  printStr(hex)',
  '  let rgb = c.toRgb()',
  '  let parts = new Array(toNum(rgb.r), toNum(rgb.g), toNum(rgb.b))',
  '  parts.forEach(fnRef(show))',
  '  let P = __jsGlobal("Promise")',
  '  P.resolve(hex).then(fnRef(done))',
  '}',
].join('\n');

(async () => {
  const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'emit-ide-1_32.html'));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.route(/^https?:/, route => {
    const url = route.request().url();
    if (/tinycolor2@1\.6\.0\/\+esm/.test(url)) {
      return route.fulfill({ body: fs.readFileSync(path.join(LIBS, 'tinycolor2/esm/tinycolor.js')), contentType: 'application/javascript' });
    }
    return route.abort();
  });
  await page.goto('file://' + file);
  await page.waitForFunction(() => typeof compileAndRun === 'function');
  await page.evaluate(src => {
    try { closeWelcome(); } catch (e) {}
    const ed = document.getElementById('editor');
    ed.value = src;
    ed.dispatchEvent(new Event('input'));
  }, PROGRAM);
  await page.evaluate(() => compileAndRun());
  await page.waitForTimeout(1200);
  const output = await page.evaluate(() => document.getElementById('tab-output').innerText);
  const status = await page.evaluate(() => document.getElementById('sTxt').innerText);

  const typeAndRead = async text => {
    await page.evaluate(() => {
      try { showView('edit'); } catch (e) {}
      const ed = document.getElementById('editor');
      const at = ed.value.indexOf('  let P = ');
      ed.value = ed.value.slice(0, at) + '  \n' + ed.value.slice(at);
      ed.focus();
      ed.setSelectionRange(at + 2, at + 2);
      ed.dispatchEvent(new Event('input'));
    });
    await page.keyboard.type(text, { delay: 20 });
    await page.waitForTimeout(250);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.ac-item')]
      .filter(e => e.offsetParent !== null).map(e => e.innerText.replace(/\s+/g, ' ').trim()));
    await page.keyboard.press('Escape');
    return rows;
  };
  const libGlobals = await page.evaluate(() => _libGlobals());
  const members = await typeAndRead('TC.mi');
  const builtins = await typeAndRead('jsL');

  const checks = [
    ['status is Done', status === 'Done', status],
    ['member call on the `as` module returns a string', /#800080/.test(output), output.slice(-400)],
    ['callback receives each array element with its index', /0:128/.test(output) && /1:0/.test(output) && /2:128/.test(output), output.slice(-400)],
    ['promise resolves into an Emit callback', /resolved #800080/.test(output), output.slice(-400)],
    ['no red error lines in the output', !/✗|\bERROR\b/.test(output), (output.match(/.*(?:✗|ERROR).*/) || [''])[0]],
    ['the `as` name is discovered as a library global', libGlobals.includes('TC'), libGlobals.join(' ')],
    ['typing TC.mi offers mix', members.some(r => /^mix\b/.test(r)), members.join(' | ')],
    ['typing jsL offers the jsLen builtin', builtins.some(r => /^jsLen\b/.test(r)), builtins.join(' | ')],
    ['no page errors', pageErrors.length === 0, pageErrors.join(' ; ')],
  ];
  let failed = 0;
  for (const [name, ok, detail] of checks) {
    if (ok) console.log('PASS  ' + name);
    else { failed++; console.log('FAIL  ' + name + '\n      ' + String(detail).replace(/\n/g, '\n      ')); }
  }
  await browser.close();
  console.log('\n' + (checks.length - failed) + '/' + checks.length + ' combined checks passed');
  process.exit(failed ? 1 : 0);
})();

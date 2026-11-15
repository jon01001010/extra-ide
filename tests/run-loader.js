#!/usr/bin/env node
// Tests the `use` library loader of an Emit IDE build in headless Chromium:
// URL form, npm-name form, `as Name` (ES module) form, load errors and retry after a failed load.
// Like run-examples.js it is fully offline: every request is answered by the route handler below
// (from tests/node_modules or from inline sources) or aborted.
//
//   node tests/run-loader.js [path/to/emit-ide.html]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const LIBS = path.join(__dirname, 'node_modules');
const npmFile = f => fs.readFileSync(path.join(LIBS, f), 'utf8');

// URL -> script body. A function is called with the request count for that URL; returning null aborts the request.
const ROUTES = {
  'https://libs.test/hello.js': 'window.helloLib={greet:function(n){return "hello "+n}};',
  'https://libs.test/mathmod.js': 'export function add(a,b){return a+b}\nexport const name="mathmod";',
  'https://libs.test/classic-global.js': 'window.ClassicThing={twice:function(n){return n*2}};',
  'https://cdn.jsdelivr.net/npm/tinycolor2@1.6.0': () => npmFile('tinycolor2/cjs/tinycolor.js'),
  'https://cdn.jsdelivr.net/npm/tinycolor2@1.6.0/+esm': () => npmFile('tinycolor2/esm/tinycolor.js'),
  'https://cdn.jsdelivr.net/npm/@emit-test/scoped@1': 'window.scopedLib={id:function(){return "scoped-ok"}};',
  // Fails on the first request, works from the second one on.
  'https://libs.test/flaky.js': n => (n < 2 ? null : 'window.flakyLib={ok:function(){return "flaky-ok"}};'),
  'https://libs.test/flakymod.js': n => (n < 2 ? null : 'export function ok(){return "flakymod-ok"}'),
};

let browser, fileUrl, failed = 0;

async function open() {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const t = { page, pageErrors: [], requests: {} };
  page.on('pageerror', e => t.pageErrors.push(e.message.slice(0, 300)));
  await page.route(/^https?:/, route => {
    const url = route.request().url().replace(/#.*$/, '');
    const n = (t.requests[url] = (t.requests[url] || 0) + 1);
    let body = ROUTES[url];
    if (typeof body === 'function') body = body(n);
    if (body == null) return route.abort();
    return route.fulfill({ body, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof compileAndRun === 'function' && typeof EX === 'object');
  await page.evaluate(() => { try { closeWelcome(); } catch (e) {} });
  // Runs a program; resolves to what the user would see.
  t.run = async src => {
    await page.evaluate(s => {
      const ed = document.getElementById('editor');
      ed.value = s;
      ed.dispatchEvent(new Event('input'));
    }, src);
    const rejected = await page.evaluate(() => compileAndRun().then(() => null, e => 'compileAndRun rejected: ' + (e && e.message || e)));
    await page.waitForTimeout(300);
    return page.evaluate(rej => ({
      rejected: rej,
      status: document.getElementById('sTxt').innerText,
      dot: document.getElementById('sDot').className,
      output: document.getElementById('tab-output').innerText,
      errRed: !!document.querySelector('#tab-output .err'),
    }), rejected);
  };
  return t;
}

function check(cond, msg, detail) {
  if (!cond) throw new Error(msg + (detail !== undefined ? '\n        got: ' + JSON.stringify(detail).slice(0, 600) : ''));
}
function expectDone(r, text) {
  check(!r.rejected, 'compileAndRun rejected', r.rejected);
  check(r.status === 'Done', 'status should be Done', r);
  check(!/✗/.test(r.output), 'output reports an error', r.output);
  check(r.output.includes(text), 'output should contain ' + JSON.stringify(text), r.output);
}
function expectLibError(r, ...needles) {
  check(!r.rejected, 'compileAndRun must not reject', r.rejected);
  check(!/Compiling|Loading/.test(r.status), 'status is stuck', r.status);
  check(/\berr\b/.test(r.dot), 'status dot should be in the error state', r.dot);
  check(r.errRed, 'error should be rendered with the red .err class');
  check(/✗/.test(r.output), 'output should show an error', r.output);
  for (const n of needles) check(r.output.includes(n), 'error should mention ' + JSON.stringify(n), r.output);
  check(!/\[object |undefined/.test(r.output), 'error should be readable', r.output);
}

const prog = (useLine, body) => useLine + '\n\nexport fn main() {\n' + body + '\n}\n';

const TESTS = {
  'URL form, quoted': async t => {
    const r = await t.run(prog('use "https://libs.test/hello.js"', '  printStr(toStr(helloLib.greet("emit")))'));
    expectDone(r, 'hello emit');
  },
  'URL form, unquoted (with trailing comment)': async t => {
    const r = await t.run(prog('use https://libs.test/hello.js // a comment', '  printStr(toStr(helloLib.greet("bare")))'));
    expectDone(r, 'hello bare');
    check(t.requests['https://libs.test/hello.js'] === 1, 'URL should be requested exactly once', t.requests);
  },
  'npm name form (name@version)': async t => {
    const r = await t.run(prog('use tinycolor2@1.6.0', '  printStr(toStr(tinycolor("#ff0000").toHexString()))'));
    expectDone(r, '#ff0000');
    check(t.requests['https://cdn.jsdelivr.net/npm/tinycolor2@1.6.0'] === 1, 'should request the jsDelivr npm URL', t.requests);
  },
  'npm name form (@scope/pkg@version)': async t => {
    const r = await t.run(prog('use @emit-test/scoped@1', '  printStr(toStr(scopedLib.id()))'));
    expectDone(r, 'scoped-ok');
  },
  'registry names keep their own URL': async t => {
    const r = await t.run(prog('use dayjs', '  printStr("x")'));
    // The registry URL is not routed here, so the load fails - what matters is which URL was asked for.
    const urls = Object.keys(t.requests).filter(u => /dayjs/.test(u));
    check(urls.length === 1 && !/cdn\.jsdelivr\.net\/npm\/dayjs$/.test(urls[0]) , 'registry URL expected', t.requests);
    expectLibError(r, 'dayjs', urls[0]);
  },
  'as Name: ES module from a URL, member call': async t => {
    const r = await t.run(prog('use "https://libs.test/mathmod.js" as M', '  let s = M.add(2, 40)\n  printStr(toStr(s))'));
    expectDone(r, '42');
    const kind = await t.page.evaluate(() => Object.prototype.toString.call(window.M) + ':' + Object.keys(window.M).sort().join(','));
    check(kind === '[object Module]:add,name', 'window.M should be the module namespace', kind);
  },
  'as Name: ES module from an unquoted URL': async t => {
    const r = await t.run(prog('use https://libs.test/mathmod.js as Mm', '  printStr(toStr(Mm.add(20, 3)))'));
    expectDone(r, '23');
  },
  'as Name: npm package via /+esm, member call': async t => {
    const r = await t.run(prog('use tinycolor2@1.6.0 as TC', '  printStr(toStr(TC.mix("#000000", "#ffffff", 50).toHexString()))'));
    expectDone(r, '#808080');
    check(t.requests['https://cdn.jsdelivr.net/npm/tinycolor2@1.6.0/+esm'] === 1, 'should request the /+esm URL', t.requests);
    check(!t.requests['https://cdn.jsdelivr.net/npm/tinycolor2@1.6.0'], 'should not also load the classic build', t.requests);
  },
  'as Name: classic script that defines that global': async t => {
    const r = await t.run(prog('use "https://libs.test/classic-global.js" as ClassicThing', '  printStr(toStr(ClassicThing.twice(21)))'));
    expectDone(r, '42');
  },
  'as Name: classic script without that global -> clear error': async t => {
    const r = await t.run(prog('use "https://libs.test/classic-global.js" as Nope', '  printStr("x")'));
    expectLibError(r, 'https://libs.test/classic-global.js', 'Nope');
  },
  'unreachable npm library -> readable error, status not stuck': async t => {
    const r = await t.run(prog('use no-such-lib-xyz', '  printStr("x")'));
    expectLibError(r, 'no-such-lib-xyz', 'https://cdn.jsdelivr.net/npm/no-such-lib-xyz');
    check(t.pageErrors.length === 0, 'no uncaught page errors', t.pageErrors);
  },
  'unreachable URL with as Name -> readable error': async t => {
    const r = await t.run(prog('use https://libs.test/missing.js as Gone', '  printStr("x")'));
    expectLibError(r, 'https://libs.test/missing.js');
    check(t.pageErrors.length === 0, 'no uncaught page errors', t.pageErrors);
  },
  'malformed use line -> readable error': async t => {
    const r = await t.run(prog('use tinycolor2 as', '  printStr("x")'));
    expectLibError(r, 'use');
  },
  'retry: a second Run after a failed load requests the library again': async t => {
    const src = prog('use no-such-lib-xyz', '  printStr("x")');
    const url = 'https://cdn.jsdelivr.net/npm/no-such-lib-xyz';
    expectLibError(await t.run(src), 'no-such-lib-xyz');
    const first = t.requests[url];
    check(first === 1, 'first Run should request the library once', t.requests);
    expectLibError(await t.run(src), 'no-such-lib-xyz');
    check(t.requests[url] === 2, 'second Run should request the library again', t.requests);
  },
  'retry: classic script that fails once then loads': async t => {
    const src = prog('use https://libs.test/flaky.js', '  printStr(toStr(flakyLib.ok()))');
    expectLibError(await t.run(src), 'https://libs.test/flaky.js');
    expectDone(await t.run(src), 'flaky-ok');
    check(t.requests['https://libs.test/flaky.js'] === 2, 'expected exactly 2 requests', t.requests);
    expectDone(await t.run(src), 'flaky-ok');
    check(t.requests['https://libs.test/flaky.js'] === 2, 'a loaded library must not be fetched again', t.requests);
  },
  'retry: ES module that fails once then loads': async t => {
    const src = prog('use https://libs.test/flakymod.js as Flaky', '  printStr(toStr(Flaky.ok()))');
    expectLibError(await t.run(src), 'https://libs.test/flakymod.js');
    const first = t.requests['https://libs.test/flakymod.js'];
    expectDone(await t.run(src), 'flakymod-ok');
    check(t.requests['https://libs.test/flakymod.js'] > first, 'second Run should request the module again', t.requests);
  },
  'syntax highlighter copes with every use form': async t => {
    const src = ['use "https://libs.test/hello.js"', 'use https://libs.test/hello.js as H // note', 'use lodash@4.17.21', '  use @scope/pkg@1 as P',
      'use three.js', 'let used = 1 // use me', 'user(1)', 'use'].join('\n');
    const res = await t.page.evaluate(s => {
      const ed = document.getElementById('editor');
      ed.value = s;
      hlCode();
      const el = document.getElementById('hlInner');
      return { text: el.textContent, html: el.innerHTML };
    }, src);
    check(res.text === src + '\n', 'highlighted text must equal the source', res.text);
    check(res.html.includes('<span class="str">https://libs.test/hello.js</span>'), 'unquoted URL should not be shown as a comment', res.html);
    check(res.html.includes('<span class="cmt">// note</span>'), 'trailing comment should stay a comment', res.html);
    check(t.pageErrors.length === 0, 'no page errors', t.pageErrors);
  },
};

(async () => {
  const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'emit-ide-1_32.html'));
  fileUrl = 'file://' + file;
  browser = await chromium.launch();
  const names = Object.keys(TESTS);
  for (const name of names) {
    const t = await open(); // fresh page per test: nothing is "already loaded"
    try { await TESTS[name](t); console.log('PASS  ' + name); }
    catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + e.message); }
    await t.page.close();
  }
  await browser.close();
  console.log('\n' + (names.length - failed) + '/' + names.length + ' loader tests passed');
  process.exit(failed ? 1 : 0);
})();

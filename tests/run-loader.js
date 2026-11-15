#!/usr/bin/env node
// Tests the `use` library loader of an Emit IDE build in headless Chromium:
// URL form, npm-name form, `as Name` (ES module) form, load errors and retry after a failed load,
// stylesheets (`use "….css"`, a registry entry's `css`, the non-fatal warning when one cannot be loaded)
// and which registry library a bare builtin call auto-loads.
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
  // Stylesheets (served as text/css — anything ending in .css is)
  'https://libs.test/style.css': '.emit-css-probe{position:fixed;height:7px}',
  'https://libs.test/flaky.css': n => (n < 2 ? null : '.emit-css-probe{height:9px}'),
  'https://cdn.jsdelivr.net/npm/notyf@3.10.0/notyf.min.css': () => npmFile('notyf/notyf.min.css'),
  // Registry libraries (URLs as in the LIBS array)
  'https://cdn.jsdelivr.net/npm/nprogress@0.2.0/nprogress.js': () => npmFile('nprogress/nprogress.js'),
  'https://cdn.jsdelivr.net/npm/nprogress@0.2.0/nprogress.css': () => npmFile('nprogress/nprogress.css'),
  'https://cdn.jsdelivr.net/npm/notyf@3.10.0/notyf.min.js': () => npmFile('notyf/notyf.min.js'),   // its .css is routed above
  'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/flatpickr.min.js': () => npmFile('flatpickr/dist/flatpickr.min.js'),   // its .css is NOT routed
  'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.js': () => npmFile('canvas-confetti/dist/confetti.browser.js'),
  'https://cdn.jsdelivr.net/npm/@tsparticles/confetti@3.0.1/tsparticles.confetti.bundle.min.js': () => npmFile('@tsparticles/confetti/tsparticles.confetti.bundle.min.js'),
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
    return route.fulfill({ body, contentType: /\.css$/.test(url) ? 'text/css' : 'application/javascript', headers: { 'access-control-allow-origin': '*' } });
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

// Like expectDone, plus exactly `n` amber warning lines mentioning every needle — and nothing shown as an error.
async function expectWarned(t, r, text, n, ...needles) {
  expectDone(r, text);
  check(!r.errRed, 'a stylesheet problem must not be rendered as an error', r.output);
  const warns = await t.page.evaluate(() => [...document.querySelectorAll('#tab-output .emit-warning')].map(e => e.textContent));
  check(warns.length === n, 'expected ' + n + ' warning line(s)', warns);
  for (const w of warns) {
    check(/^⚠ /.test(w) && !/\[object |undefined/.test(w), 'warning should be readable', w);
    for (const needle of needles) check(w.includes(needle), 'warning should mention ' + JSON.stringify(needle), w);
  }
}
// Computed style of a fresh element carrying `cls` (or built from `html`).
const styleOf = (t, cls, prop, html) => t.page.evaluate(([cls, prop, html]) => {
  const d = document.createElement('div');
  if (html) d.innerHTML = html; else d.className = cls;
  document.body.appendChild(d);
  const v = getComputedStyle(html ? d.querySelector(cls) : d)[prop];
  d.remove();
  return v;
}, [cls, prop, html || null]);

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
  'css: use "https://….css" (quoted) loads a stylesheet': async t => {
    check(await styleOf(t, 'emit-css-probe', 'height') !== '7px', 'probe must be unstyled before the run');
    const r = await t.run(prog('use "https://libs.test/style.css"', '  printStr("styled")'));
    await expectWarned(t, r, 'styled', 0);
    check(await styleOf(t, 'emit-css-probe', 'height') === '7px', 'the stylesheet should apply', await styleOf(t, 'emit-css-probe', 'height'));
    const links = await t.page.evaluate(() => document.querySelectorAll('link[rel="stylesheet"][href="https://libs.test/style.css"]').length);
    check(links === 1 && (await t.page.evaluate(() => document.scripts.length && ![...document.scripts].some(s => /style\.css/.test(s.src)))), 'one <link>, no <script> for a .css URL', links);
  },
  'css: unquoted .css URL with a comment, next to a script; loaded once over two Runs': async t => {
    const src = 'use https://libs.test/style.css // the look\nuse https://libs.test/hello.js\n\nexport fn main() {\n  printStr(toStr(helloLib.greet("css")))\n}\n';
    await expectWarned(t, await t.run(src), 'hello css', 0);
    await expectWarned(t, await t.run(src), 'hello css', 0);
    check(t.requests['https://libs.test/style.css'] === 1, 'stylesheet should be requested exactly once', t.requests);
    check(await t.page.evaluate(() => document.querySelectorAll('link[href="https://libs.test/style.css"]').length) === 1, 'no duplicate <link>');
    check(await styleOf(t, 'emit-css-probe', 'position') === 'fixed', 'the stylesheet should apply');
  },
  'css: npm path ending in .css goes to jsDelivr as a stylesheet': async t => {
    const r = await t.run(prog('use notyf@3.10.0/notyf.min.css', '  printStr("x")'));
    await expectWarned(t, r, 'x', 0);
    check(t.requests['https://cdn.jsdelivr.net/npm/notyf@3.10.0/notyf.min.css'] === 1, 'should request the jsDelivr URL', t.requests);
    check(await styleOf(t, 'notyf', 'position') === 'fixed', 'notyf.min.css should apply');
  },
  'css: a stylesheet that cannot be loaded is a warning, the program still runs; retried on the next Run': async t => {
    const src = prog('use "https://libs.test/flaky.css"', '  printStr("ran anyway")');
    await expectWarned(t, await t.run(src), 'ran anyway', 1, 'https://libs.test/flaky.css', 'stylesheet');
    check(t.pageErrors.length === 0, 'no uncaught page errors', t.pageErrors);
    await expectWarned(t, await t.run(src), 'ran anyway', 0);
    check(t.requests['https://libs.test/flaky.css'] === 2, 'second Run should request the stylesheet again', t.requests);
    check(await styleOf(t, 'emit-css-probe', 'height') === '9px', 'the stylesheet should apply after the retry');
  },
  'css: "as Name" on a stylesheet -> readable error': async t => {
    const r = await t.run(prog('use "https://libs.test/style.css" as Style', '  printStr("x")'));
    expectLibError(r, 'stylesheet', 'Style');
  },
  'css: a registry entry loads its stylesheet (use nprogress)': async t => {
    const r = await t.run(prog('use nprogress', '  NProgress.start()\n  printStr("bar")'));
    await expectWarned(t, r, 'bar', 0);
    check(t.requests['https://cdn.jsdelivr.net/npm/nprogress@0.2.0/nprogress.css'] === 1 && t.requests['https://cdn.jsdelivr.net/npm/nprogress@0.2.0/nprogress.js'] === 1, 'script and stylesheet requested once each', t.requests);
    const bar = await t.page.evaluate(() => { const b = document.querySelector('#nprogress .bar'); const cs = b && getComputedStyle(b); return cs && [cs.position, cs.height].join(); });
    check(bar === 'fixed,2px', 'the real NProgress bar should be styled (fixed, 2px high)', bar);
  },
  'css: a registry stylesheet that fails -> warning naming the library, library still usable': async t => {
    const r = await t.run(prog('use flatpickr', '  printStr(typeOf(flatpickr))'));
    await expectWarned(t, r, 'function', 1, 'flatpickr', 'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/flatpickr.min.css');
  },
  'auto-load: bare confetti() without a use line loads canvas-confetti, not tsparticles': async t => {
    const r = await t.run('export fn main() {\n  confetti()\n  printStr("party")\n}\n');
    expectDone(r, 'party');
    const urls = Object.keys(t.requests).filter(u => /confetti/.test(u));
    check(urls.length === 1 && /canvas-confetti@1\.9\.2\/dist\/confetti\.browser\.js$/.test(urls[0]), 'only canvas-confetti should be requested', t.requests);
    check(await t.page.evaluate(() => typeof confetti === 'function' && typeof tsParticles === 'undefined'), 'window.confetti from canvas-confetti, no tsParticles');
  },
  'auto-load: use tsparticles + confetti() does not also load canvas-confetti': async t => {
    const r = await t.run(prog('use tsparticles', '  confetti()\n  printStr("party")'));
    expectDone(r, 'party');
    const urls = Object.keys(t.requests).filter(u => /confetti/.test(u));
    check(urls.length === 1 && /@tsparticles\/confetti/.test(urls[0]), 'only the tsparticles bundle should be requested', t.requests);
    check(await t.page.evaluate(() => typeof tsParticles === 'object'), 'tsParticles global expected');
  },
  'auto-load: a builtin provided by a registry library with css/needs loads those too': async t => {
    // No use line: the call to the library global makes the IDE load the entry — through _loadUse, so its css comes along.
    const info = await t.page.evaluate(() => { const l = LIBS.find(x => x.name === 'nprogress'); return { cdn: l.cdn, css: l.css, auto: _fnToCdn.NProgress }; });
    check(info.auto === info.cdn && info.css && info.css.length === 1, 'registry should map NProgress to the nprogress entry, which has css', info);
    await t.page.evaluate(u => _loadLib(u), info.cdn);
    check(t.requests[info.css[0]] === 1 && t.requests[info.cdn] === 1, 'label-less _loadLib of a registry URL should load script and stylesheet', t.requests);
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

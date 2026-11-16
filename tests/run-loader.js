#!/usr/bin/env node
// Tests the `use` library loader of an Emit IDE build in headless Chromium:
// URL form, npm-name form, `as Name` (ES module) form, load errors and retry after a failed load,
// stylesheets (`use "….css"`, a registry entry's `css`, the non-fatal warning when one cannot be loaded)
// and which registry library a bare builtin call auto-loads;
// the offline library cache (network first, stored copy when the network fails) over two http:// test
// origins — http://localhost (a secure context: Cache API) and http://ide.test (not secure: IndexedDB) —,
// with storage blocked, and inside a sandboxed frame (a real opaque origin);
// esm.sh as the second source for `use <npm name> as Name`, the esm.sh: / jsdelivr: prefixes;
// the "in use" marker of the library panel; loader warnings surviving a compile error.
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
  // esm.sh as the second source. emit-fallback: jsDelivr has no /+esm for it (not routed -> aborted).
  'https://esm.sh/emit-fallback@1': 'export function hi(){return "from esm.sh"}',
  // emit-node: the jsDelivr module throws while it is imported, as a package that needs Node built-ins does.
  'https://cdn.jsdelivr.net/npm/emit-node@1/+esm': 'throw new Error("Cannot find module node:fs");\nexport const x = 1;',
  'https://esm.sh/emit-node@1': 'export function hi(){return "node-free build"}',
  // emit-both: fine on both; only jsDelivr may be asked.
  'https://cdn.jsdelivr.net/npm/emit-both@1/+esm': 'export function hi(){return "from jsdelivr"}',
  'https://esm.sh/emit-both@1': 'export function hi(){return "from esm.sh"}',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js': () => npmFile('three/build/three.min.js'),
};

let browser, fileUrl, ideHtml, failed = 0;

// opts (all optional): context — open the page in this browser context (pages of one context share storage);
// url — an http:// address the IDE is served from instead of file://; offline — abort every library request;
// hang — URLs that are never answered; init — a function run in the page before its scripts;
// frame — the IDE runs in a sandboxed <iframe> of the page at `url` (an opaque origin).
async function open(opts = {}) {
  const page = await (opts.context || browser).newPage({ viewport: { width: 1200, height: 800 } });
  const t = { page, pageErrors: [], requests: {}, fetches: {}, console: [] };
  page.on('pageerror', e => t.pageErrors.push(e.message.slice(0, 300)));
  // What the page's own code (or the browser, about its code) writes to the console as a problem. A failed
  // request is reported by the browser itself ("Failed to load resource") — that is not the IDE's doing. The
  // loader's own warning lines (shown in the output, and passed to console.warn as before) are expected too.
  page.on('console', m => { if (/error|warning/.test(m.type()) && !/Failed to load resource|net::ERR_|^(Offline: |Could not load the stylesheet )/.test(m.text())) t.console.push(m.type() + ': ' + m.text().slice(0, 200)); });
  if (opts.init) await page.addInitScript(opts.init);
  const ideAt = opts.url ? (opts.frame ? new URL('/emit.html', opts.url).href : opts.url) : null;
  await page.route(/^https?:/, route => {
    const url = route.request().url().replace(/#.*$/, '');
    if (opts.frame && url === opts.url) return route.fulfill({ body: '<!DOCTYPE html><html><body style="margin:0"><iframe id="ide" sandbox="allow-scripts allow-modals" src="/emit.html" style="width:1200px;height:780px;border:0"></iframe></body></html>', contentType: 'text/html' });
    if (ideAt && url === ideAt) return route.fulfill({ body: ideHtml, contentType: 'text/html' });
    if (opts.offline) { t.requests[url] = (t.requests[url] || 0) + 1; return route.abort(); }
    if (opts.hang && opts.hang.includes(url)) { t.requests[url] = (t.requests[url] || 0) + 1; return; }
    // t.requests counts what the loader itself loads (<script>, <link>, import()). The offline cache reads a
    // loaded file once more with fetch() to store its text — those are counted apart, in t.fetches.
    const viaFetch = route.request().resourceType() === 'fetch';
    const counts = viaFetch ? t.fetches : t.requests;
    const n = (counts[url] = (counts[url] || 0) + 1);
    let body = ROUTES[url];
    if (typeof body === 'function') body = body(n);
    if (body == null) return route.abort();
    return route.fulfill({ body, contentType: /\.css$/.test(url) ? 'text/css' : 'application/javascript', headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto(opts.url || fileUrl);
  // `ide`: where the IDE lives — the page, or the sandboxed frame inside it.
  const ide = opts.frame ? await (await page.waitForSelector('#ide')).contentFrame() : page;
  t.ide = ide;
  await ide.waitForFunction(() => typeof compileAndRun === 'function' && typeof EX === 'object');
  await ide.evaluate(() => { try { closeWelcome(); } catch (e) {} });
  // Runs a program; resolves to what the user would see.
  t.run = async src => {
    const page = ide;
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

// ── offline cache ──
const CACHE_SRC = 'use "https://libs.test/style.css"\nuse "https://libs.test/hello.js"\n\nexport fn main() {\n  printStr(toStr(helloLib.greet("cache")))\n}\n';
const cacheList = t => t.ide.evaluate(() => _libStore.list().then(l => l.map(i => i.url + ' ' + i.kind + ' ' + i.size).sort()));
const cachePanel = async t => {
  await t.ide.evaluate(() => { document.getElementById('libsOverlay').classList.remove('show'); toggleLibs(); });
  await t.page.waitForTimeout(400);
  return t.ide.evaluate(() => { const e = document.getElementById('libCacheInfo'); return e ? e.innerText.replace(/\s+/g, ' ') : null; });
};
const warnings = t => t.ide.evaluate(() => [...document.querySelectorAll('#tab-output .emit-warning')].map(e => e.textContent));
// One full round over an http:// origin: online run stores, offline run uses the store, Clear empties it.
async function cacheRound(origin, wantKind) {
  const context = await browser.newContext();
  const url = origin + '/emit.html';
  try {
    // 1. online: loads from the network, then stores the two files
    let t = await open({ context, url });
    check(await t.ide.evaluate(() => _libStore.kind()) === wantKind, 'storage kind on ' + origin, await t.ide.evaluate(() => _libStore.kind()));
    check(await cachePanel(t) === null, 'an empty cache must not show a line in the panel');
    expectDone(await t.run(CACHE_SRC), 'hello cache');
    check((await warnings(t)).length === 0, 'an online run must not warn', await warnings(t));
    await t.ide.waitForFunction(() => _libStore.list().then(l => l.length === 2), null, { timeout: 5000 });
    check(JSON.stringify(await cacheList(t)) === JSON.stringify(['https://libs.test/hello.js js 55', 'https://libs.test/style.css css 42']), 'both files stored with kind and size', await cacheList(t));
    check(t.requests['https://libs.test/hello.js'] === 1 && t.fetches['https://libs.test/hello.js'] === 1, 'one <script> load and one fetch for the cache', [t.requests, t.fetches]);
    const line = await cachePanel(t);
    check(/^Offline cache: 1 library \(\+1 stylesheet\), 97 B — Clear/.test(line || ''), 'panel line', line);
    // a second online run in the same page asks for nothing more (already loaded, already stored)
    expectDone(await t.run(CACHE_SRC), 'hello cache');
    check(t.requests['https://libs.test/hello.js'] === 1 && t.fetches['https://libs.test/hello.js'] === 1, 'no further requests', [t.requests, t.fetches]);
    check(t.pageErrors.length === 0 && t.console.length === 0, 'no page errors, no console noise', [t.pageErrors, t.console]);
    await t.page.close();
    // 2. a fresh page that is online again: the network is used, not the store (no stale code while the network works)
    t = await open({ context, url });
    expectDone(await t.run(CACHE_SRC), 'hello cache');
    check(t.requests['https://libs.test/hello.js'] === 1 && (await warnings(t)).length === 0, 'network first', [t.requests, await warnings(t)]);
    await t.page.waitForTimeout(300);
    check(!t.fetches['https://libs.test/hello.js'], 'a stored file is not fetched again within a day', t.fetches);
    await t.page.close();
    // 3. offline: every library request is aborted — the program still runs, and says where the code came from
    t = await open({ context, url, offline: true });
    const r = await t.run(CACHE_SRC);
    expectDone(r, 'hello cache');
    const w = await warnings(t);
    check(w.length === 2 && w.every(x => /^⚠ Offline: /.test(x) && /offline cache \(saved \d{4}-\d\d-\d\d\)/.test(x)) && /style\.css/.test(w[0]) && /hello\.js/.test(w[1]), 'one amber line per file taken from the cache', w);
    check(t.requests['https://libs.test/hello.js'] === 1 && t.requests['https://libs.test/style.css'] === 1, 'the network was tried first', t.requests);
    check(await styleOf({ page: t.ide }, 'emit-css-probe', 'height') === '7px', 'the cached stylesheet applies');
    check(await t.ide.evaluate(() => document.querySelectorAll('style[data-emit-lib-css="https://libs.test/style.css"]').length) === 1, 'cached stylesheet is one <style>');
    expectDone(await t.run(CACHE_SRC), 'hello cache');   // again: loaded once, not re-run
    check(await t.ide.evaluate(() => document.querySelectorAll('script[data-emit-lib]').length) === 1, 'the cached script ran once');
    check(t.pageErrors.length === 0 && t.console.length === 0, 'no page errors, no console noise', [t.pageErrors, t.console]);
    // 4. Clear
    await cachePanel(t);
    await t.ide.evaluate(() => document.querySelector('#libCacheInfo button').click());
    await t.ide.waitForFunction(() => !document.getElementById('libCacheInfo'), null, { timeout: 5000 });
    check((await cacheList(t)).length === 0, 'Clear empties the cache', await cacheList(t));
    await t.page.close();
    // 5. offline with an empty cache: the normal readable error
    t = await open({ context, url, offline: true });
    expectLibError(await t.run(CACHE_SRC.replace('use "https://libs.test/style.css"\n', '')), 'Could not load library', 'https://libs.test/hello.js');
    check(t.pageErrors.length === 0 && t.console.length === 0, 'no page errors, no console noise', [t.pageErrors, t.console]);
    await t.page.close();
  } finally { await context.close(); }
}
// Makes both storage APIs fail the way they do on an origin without storage.
const NO_STORAGE = () => {
  const deny = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
  Object.defineProperty(window, 'caches', { get: deny, configurable: true });
  Object.defineProperty(window, 'indexedDB', { get: deny, configurable: true });
};
async function noStorageRound(opts) {
  const context = await browser.newContext();
  try {
    let t = await open({ context, ...opts });
    check(await t.ide.evaluate(() => _libStore.kind()) === null, 'no storage expected', await t.ide.evaluate(() => _libStore.kind()));
    expectDone(await t.run(CACHE_SRC), 'hello cache');
    await t.page.waitForTimeout(500);
    check(Object.keys(t.fetches).length === 0, 'without storage there must be no extra request', t.fetches);
    check(t.requests['https://libs.test/hello.js'] === 1, 'loaded exactly as before', t.requests);
    check(await t.ide.evaluate(() => document.querySelectorAll('link[href="https://libs.test/style.css"]').length) === 1 && (await warnings(t)).length === 0, 'stylesheet loaded as a <link>, no warning');
    check(await cachePanel(t) === null, 'no cache line in the panel');
    check(await t.ide.evaluate(() => _libStore.clear().then(() => _libStore.list()).then(l => l.length)) === 0, 'clear/list are harmless');
    check(t.pageErrors.length === 0 && t.console.length === 0, 'no page errors, no console noise', [t.pageErrors, t.console]);
    await t.page.close();
    t = await open({ context, ...opts, offline: true });
    const r = await t.run(CACHE_SRC);
    expectLibError(r, 'Could not load library', 'https://libs.test/hello.js', 'no network');
    check((await warnings(t)).length === 1 && /Could not load the stylesheet/.test((await warnings(t))[0]), 'the stylesheet warning is still shown under the error', await warnings(t));
    check(t.pageErrors.length === 0 && t.console.length === 0, 'no page errors, no console noise', [t.pageErrors, t.console]);
    await t.page.close();
  } finally { await context.close(); }
}
// The names of the library cards marked "in use" in the 📚 panel for a given source.
const inUse = (t, src) => t.page.evaluate(s => {
  const ed = document.getElementById('editor');
  ed.value = s;
  document.getElementById('libsOverlay').classList.remove('show');
  toggleLibs();
  return [...document.querySelectorAll('#libsContent .lib-card')].filter(c => c.querySelector('.lib-added') && c.querySelector('.lib-added').textContent === 'in use').map(c => c.querySelector('.lib-name').textContent).sort().join(',');
}, src);

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
  'cache: stored after an online run, used when offline, cleared by the panel button — http://localhost (Cache API)': async () => {
    await cacheRound('http://localhost:8377', 'Cache API');
  },
  'cache: the same over http://ide.test (not a secure context: IndexedDB)': async () => {
    await cacheRound('http://ide.test', 'IndexedDB');
  },
  'cache: navigator.onLine false -> a hanging network gets a few seconds, then the stored copy runs': async () => {
    const context = await browser.newContext();
    try {
      const url = 'http://ide.test/emit.html', src = prog('use "https://libs.test/hello.js"', '  printStr(toStr(helloLib.greet("slow")))');
      let t = await open({ context, url });
      expectDone(await t.run(src), 'hello slow');
      await t.ide.waitForFunction(() => _libStore.list().then(l => l.length === 1), null, { timeout: 5000 });
      await t.page.close();
      t = await open({ context, url, hang: ['https://libs.test/hello.js'], init: () => Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false, configurable: true }) });
      const t0 = Date.now(), r = await t.run(src), ms = Date.now() - t0;
      expectDone(r, 'hello slow');
      check(ms > 3500 && ms < 9000, 'the cached copy should be used after the short offline timeout (about 4 s), took ' + ms + ' ms');
      check((await warnings(t)).length === 1, 'one amber line', await warnings(t));
      await t.page.close();
    } finally { await context.close(); }
  },
  'cache: storage blocked (both APIs throw) -> exactly as without a cache, no errors, no console noise': async () => {
    await noStorageRound({ url: 'http://ide.test/emit.html', init: NO_STORAGE });
  },
  'cache: opaque origin (IDE inside a sandboxed frame) -> exactly as without a cache': async () => {
    await noStorageRound({ url: 'http://ide.test/frame.html', frame: true });
  },
  'cache: a failed load of a library that was never stored keeps its normal error (file://)': async t => {
    expectLibError(await t.run(prog('use https://libs.test/missing.js', '  printStr("x")')), 'Could not load library', 'https://libs.test/missing.js');
    check(t.pageErrors.length === 0, 'no uncaught page errors', t.pageErrors);
  },
  'esm.sh: jsDelivr /+esm unreachable -> esm.sh is tried once and works; the export records the URL that worked': async t => {
    const r = await t.run(prog('use emit-fallback@1 as Fb', '  printStr(toStr(Fb.hi()))'));
    expectDone(r, 'from esm.sh');
    check(t.requests['https://cdn.jsdelivr.net/npm/emit-fallback@1/+esm'] === 1 && t.requests['https://esm.sh/emit-fallback@1'] === 1, 'jsDelivr first, then esm.sh, once each', t.requests);
    check(!t.requests['https://cdn.jsdelivr.net/npm/emit-fallback@1'], 'no classic-script attempt after esm.sh worked', t.requests);
    const lib = await t.page.evaluate(() => _exportLibs(document.getElementById('editor').value, [])[0]);
    check(lib.url === 'https://esm.sh/emit-fallback@1' && lib.module === true && lib.altUrl === 'https://cdn.jsdelivr.net/npm/emit-fallback@1/+esm', 'export should load esm.sh first', lib);
    expectDone(await t.run(prog('use emit-fallback@1 as Fb', '  printStr(toStr(Fb.hi()))')), 'from esm.sh');
    check(t.requests['https://esm.sh/emit-fallback@1'] === 1, 'a loaded module is not requested again', t.requests);
  },
  'esm.sh: an offline export made without a Run first finds the working source itself and embeds it': async t => {
    const got = await t.page.evaluate(async src => {
      const ed = document.getElementById('editor');
      ed.value = src;
      const files = {}, alerts = [];
      window._download = (name, content) => { files[name] = content; };
      window.alert = m => alerts.push(String(m));
      const rep = await doExport('htmloff');
      const html = files['program-offline.html'] || '';
      const m = html.match(/var __emitProgram=(.*);\n<\/script>/);
      return { alerts, rep, lib: m && JSON.parse(m[1]).libs[0], embedded: /__emitEmbedded\.mod\["https:\/\/esm\.sh\/emit-fallback@1"\]=\{s:"export function hi/.test(html), jsdelivrEmbedded: /__emitEmbedded\.\w+\["https:\/\/cdn\.jsdelivr/.test(html) };
    }, prog('use emit-fallback@1 as Fb', '  printStr(toStr(Fb.hi()))'));
    check(got.alerts.length === 0 && got.rep && got.rep.embedded.length === 1, 'the export should succeed', got);
    check(got.lib && got.lib.url === 'https://esm.sh/emit-fallback@1' && got.embedded && !got.jsdelivrEmbedded, 'esm.sh module recorded and embedded, nothing from jsDelivr', got);
    check(t.requests['https://cdn.jsdelivr.net/npm/emit-fallback@1/+esm'] === 1, 'jsDelivr was tried first', t.requests);
  },
  'esm.sh: jsDelivr module throws while importing (needs Node built-ins) -> esm.sh works': async t => {
    const r = await t.run(prog('use emit-node@1 as N', '  printStr(toStr(N.hi()))'));
    expectDone(r, 'node-free build');
    check(t.requests['https://cdn.jsdelivr.net/npm/emit-node@1/+esm'] === 1 && t.requests['https://esm.sh/emit-node@1'] === 1, 'both sources asked once', t.requests);
  },
  'esm.sh: jsDelivr works -> esm.sh is not asked; the export keeps jsDelivr': async t => {
    expectDone(await t.run(prog('use emit-both@1 as B', '  printStr(toStr(B.hi()))')), 'from jsdelivr');
    check(!Object.keys(t.requests).some(u => /esm\.sh/.test(u)), 'esm.sh must not be requested', t.requests);
    const lib = await t.page.evaluate(() => _exportLibs(document.getElementById('editor').value, [])[0]);
    check(lib.url === 'https://cdn.jsdelivr.net/npm/emit-both@1/+esm' && lib.altUrl === 'https://esm.sh/emit-both@1', 'export should keep jsDelivr first', lib);
  },
  'esm.sh: both sources fail -> one readable error naming both attempts': async t => {
    const r = await t.run(prog('use emit-nowhere@1 as Nw', '  printStr("x")'));
    expectLibError(r, 'emit-nowhere@1', 'https://cdn.jsdelivr.net/npm/emit-nowhere@1/+esm', 'Then tried https://esm.sh/emit-nowhere@1');
    check(t.requests['https://esm.sh/emit-nowhere@1'] === 1, 'esm.sh is tried exactly once', t.requests);
    check(t.pageErrors.length === 0, 'no uncaught page errors', t.pageErrors);
  },
  'esm.sh: explicit prefix "use esm.sh:<pkg> as Name" goes straight to esm.sh': async t => {
    expectDone(await t.run(prog('use esm.sh:emit-both@1 as B // from esm.sh', '  printStr(toStr(B.hi()))')), 'from esm.sh');
    check(t.requests['https://esm.sh/emit-both@1'] === 1 && !Object.keys(t.requests).some(u => /jsdelivr/.test(u)), 'only esm.sh is requested', t.requests);
    const lib = await t.page.evaluate(() => _exportLibs(document.getElementById('editor').value, [])[0]);
    check(lib.url === 'https://esm.sh/emit-both@1' && lib.esmOnly === true && !lib.altUrl, 'export entry', lib);
  },
  'esm.sh: explicit prefix "use jsdelivr:<pkg> as Name" never falls back to esm.sh': async t => {
    expectDone(await t.run(prog('use jsdelivr:emit-both@1 as B', '  printStr(toStr(B.hi()))')), 'from jsdelivr');
    const r = await t.run(prog('use jsdelivr:emit-fallback@1 as Fb', '  printStr("x")'));
    expectLibError(r, 'emit-fallback@1', 'https://cdn.jsdelivr.net/npm/emit-fallback@1/+esm');
    check(!Object.keys(t.requests).some(u => /esm\.sh/.test(u)) && !/esm\.sh/.test(r.output), 'esm.sh must not be tried or mentioned', [t.requests, r.output]);
  },
  'esm.sh: prefix errors are readable (no "as Name", not a package name); jsdelivr: without "as" is a classic script': async t => {
    expectLibError(await t.run(prog('use esm.sh:emit-both@1', '  printStr("x")')), 'esm.sh', 'as Name');
    expectLibError(await t.run(prog('use esm.sh:https://x.test/a.js as A', '  printStr("x")')), 'not an npm package name');
    expectDone(await t.run(prog('use jsdelivr:tinycolor2@1.6.0', '  printStr(toStr(tinycolor("#ff0000").toHexString()))')), '#ff0000');
    check(t.requests['https://cdn.jsdelivr.net/npm/tinycolor2@1.6.0'] === 1, 'classic jsDelivr URL', t.requests);
  },
  'panel: "in use" follows the loader\'s own parsing of use lines': async t => {
    const cases = {
      'use three.js': 'three.js',
      'use three': 'three.js',
      'use three.js as T': 'three.js',
      'use three as T // alias': 'three.js',
      'use three.js // comment': 'three.js',
      '  use "three.js"': 'three.js',
      'use three;\nuse confetti // party\nuse leaflet as Leaf': 'confetti,leaflet,three.js',
      'use three as\nuse confetti': 'confetti',                       // a malformed line does not hide the others
      'use threejs-not-a-registry-name': '',
      'use https://libs.test/three.js': '',
      'use jsdelivr:three': '',
      '// use three.js\nlet user = 1': '',
    };
    for (const [src, want] of Object.entries(cases)) {
      const got = await inUse(t, src + '\n\nexport fn main() {\n}\n');
      check(got === want, 'cards in use for ' + JSON.stringify(src) + ' should be ' + JSON.stringify(want), got);
    }
    // and the loader agrees: what is marked is what Run loads
    expectDone(await t.run(prog('use three as T // alias', '  printStr(toStr(T.REVISION))')), '128');
    check(t.pageErrors.length === 0, 'no page errors', t.pageErrors);
  },
  'warnings: a stylesheet warning survives a compile error and a library error': async t => {
    const css = 'use "https://libs.test/missing.css"\n';
    let r = await t.run(css + '\nexport fn main() {\n  let = \n}\n');
    check(/✗/.test(r.output) && r.errRed, 'the compile error is shown', r.output);
    let w = await t.page.evaluate(() => [...document.querySelectorAll('#tab-output .emit-warning')].map(e => e.textContent));
    check(w.length === 1 && /Could not load the stylesheet https:\/\/libs\.test\/missing\.css/.test(w[0]), 'the warning is still there, once', [w, r.output]);
    check(await t.page.evaluate(() => { const o = document.getElementById('tab-output'); return o.firstElementChild.classList.contains('err') && o.lastElementChild.classList.contains('emit-warning'); }), 'the error comes first, the warning after it');
    r = await t.run(css + 'use https://libs.test/missing.js\n\nexport fn main() {\n}\n');
    expectLibError(r, 'Could not load library', 'https://libs.test/missing.js');
    w = await t.page.evaluate(() => [...document.querySelectorAll('#tab-output .emit-warning')].map(e => e.textContent));
    check(w.length === 1, 'one warning under the library error, none left over from the run before', w);
    r = await t.run('export fn main() {\n  printStr("fine")\n}\n');
    expectDone(r, 'fine');
    check(!/⚠/.test(r.output), 'no stale warning in a later run', r.output);
  },
  'header says v0.4; the welcome screen counts the builtins itself': async t => {
    const v = await t.page.evaluate(() => ({ logo: document.querySelector('.logo').textContent, n: document.getElementById('wlBuiltins').textContent, real: Object.keys(BUILTINS).length, line: document.getElementById('wlBuiltins').parentElement.textContent }));
    check(v.logo === 'EMITv0.4', 'logo', v.logo);
    check(v.n === String(v.real) && v.real > 100 && v.line === v.real + ' builtins', 'builtin count', v);
    console.log('      (BUILTINS has ' + v.real + ' entries)');
  },
  'syntax highlighter copes with every use form': async t => {
    const src = ['use "https://libs.test/hello.js"', 'use https://libs.test/hello.js as H // note', 'use lodash@4.17.21', '  use @scope/pkg@1 as P', 'use esm.sh:nanoid@5 as Nano // prefix', 'use jsdelivr:@scope/pkg@1/x.js',
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
  ideHtml = fs.readFileSync(file);
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

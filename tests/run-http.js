#!/usr/bin/env node
// Tests for the Emit builtins that hand text from outside to a program: httpGet / httpText and getInputStr.
// Both used to write the text at a fixed place in the first page of memory (offset 4096), over the program's
// own string literals, and httpGet cut the answer at 4000 bytes and gave the program no way to read it.
// Runs in headless Chromium; the "server" is this test (nothing leaves the machine).
//
//   node tests/run-http.js [path/to/emit-ide.html]
'use strict';
const { chromium } = require('playwright');
const path = require('path');

const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'emit-ide-1_32.html'));
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) pass++;
  else { fail++; console.log(`✗ ${name}${detail !== undefined ? '\n    ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500) : ''}`); }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// 3,500 characters of literal before TAIL: offset 4096 of memory is inside these literals
const PAD = 'p'.repeat(3500);
const LONG = 'a'.repeat(9997) + 'END';            // an answer longer than the old 4000-byte cut
const HTTP = `
let pad = "${PAD}"
let tail = "TAIL-INTACT"
export fn run() {
  printStr("[" + httpText() + "]")
  httpGet("https://api.test/long", 1)
  httpGet("https://api.test/short", 2)
  httpGet("https://api.test/missing", 3)
}
export fn onhttp_1() {
  let t = httpText()
  print(strLen(t))
  printStr(substr(t, 9997, 3))
  printStr(tail)
  print(strLen(pad))
}
export fn onhttp_2() {
  printStr("short: " + httpText())
  printStr(tail)
}
export fn onhttp_3() {
  printStr("missing: " + httpText())
}`;
const INPUT = `
let pad = "${PAD}"
let tail = "TAIL-INTACT"
export fn run() {
  input("name", 1)
  button("Go", 1)
  printStr("[" + httpText() + "]")
}
export fn onclick_1() {
  let s = getInputStr(1)
  printStr(s)
  print(strLen(s))
  printStr(tail)
  print(strLen(pad))
}`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/^(https?|wss?):/, r => {
    const u = new URL(r.request().url());
    requests.push(u.href);
    if (u.host !== 'api.test') return r.abort();
    const delay = u.pathname === '/long' ? 0 : u.pathname === '/short' ? 150 : 300;       // answers arrive in this order
    const body = u.pathname === '/long' ? LONG : u.pathname === '/short' ? 'hello' : 'no such thing';
    setTimeout(() => r.fulfill({ status: u.pathname === '/missing' ? 404 : 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body }), delay);
  });
  await page.goto('file://' + file);
  await page.waitForFunction(() => typeof compileAndRun === 'function');
  await page.evaluate(() => { if (typeof closeWelcome === 'function') closeWelcome(); });
  const run = async src => {
    await page.evaluate(src => { const ed = document.getElementById('editor') || document.querySelector('textarea'); ed.value = src; ed.dispatchEvent(new Event('input')); }, src);
    await page.evaluate(() => compileAndRun());
  };
  const lines = () => page.evaluate(() => document.getElementById('tab-output').innerText.split('\n').map(s => s.trim()).filter(s => /^>( |$)/.test(s)).map(s => s.slice(2)));
  const reds = () => page.evaluate(() => document.getElementById('tab-output').innerText.split('\n').filter(s => s.includes('✗')));

  await run(HTTP);
  await page.waitForFunction(() => /missing:/.test(document.getElementById('tab-output').innerText), null, { timeout: 10000 }).catch(() => {});
  eq('httpGet: each answer reaches its handler through httpText(), whole, and the program\'s own strings are untouched', await lines(),
    ['[]', '10000', 'END', 'TAIL-INTACT', '3500', 'short: hello', 'TAIL-INTACT', 'missing: no such thing']);
  eq('httpGet: no error lines', await reds(), []);

  await run(INPUT);
  eq('a new run starts with no answer left over from the one before', await lines(), ['[]']);
  // an answer that arrives after the program was run again belongs to no one
  await run(HTTP.replace('"https://api.test/long", 1', '"https://api.test/missing", 1'));
  await run(INPUT);
  await page.waitForTimeout(500);
  eq('an answer for an earlier run is dropped', await lines(), ['[]']);
  const typed = 'é'.repeat(2500) + ' and the end';     // 5,012 bytes: longer than the gap up to the literals
  await page.evaluate(v => { document.getElementById('emit-el-1').value = v; }, typed);
  await page.evaluate(() => document.querySelector('#tab-output button').click());
  await page.waitForFunction(() => /TAIL/.test(document.getElementById('tab-output').innerText), null, { timeout: 5000 }).catch(() => {});
  eq('getInputStr: gives the text of the field, whole, and the program\'s own strings are untouched', await lines(), ['[]', typed, '5012', 'TAIL-INTACT', '3500']);
  await page.evaluate(() => { document.getElementById('emit-el-1').value = ''; });
  await page.evaluate(() => document.querySelector('#tab-output button').click()); await page.waitForTimeout(150);
  eq('getInputStr: an empty field is an empty string', (await lines()).slice(5), ['', '0', 'TAIL-INTACT', '3500']);
  eq('getInputStr: no error lines', await reds(), []);

  // the exported runtime is cut out of the IDE's own source: it must carry the new builtin and still stand alone
  const rt = await page.evaluate(() => { try { return _exportRuntime(); } catch (e) { return 'ERR ' + e.message; } });
  ok('export: the runtime that exported pages get has httpText and parses on its own', !rt.startsWith('ERR') && rt.includes("case'httpText'") && rt.includes('var _httpText') && !rt.includes('_strWritePtr'), rt.slice(0, 200));
  ok('the builtin is known to the compiler and the highlighter', await page.evaluate(() => !!BUILTINS.httpText && BUILTINS.httpText.returnType === 'str' && _emitBlt.has('httpText')));
  ok('the program asked only the test server', requests.filter(u => !/^https:\/\/fonts\.g/.test(u)).every(u => u.startsWith('https://api.test/')), requests);   // (the IDE's own font link is refused here)
  eq('no page errors', errors, []);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

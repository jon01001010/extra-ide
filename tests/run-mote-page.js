#!/usr/bin/env node
// Playwright tests for the Mote playground (mote.html): offline, phone-sized (360 px, touch), every
// example, host-driven waits and choices, the step budget, the sandbox, errors and the API panel.
//
//   node tests/run-mote-page.js [path/to/mote.html] [--shots DIR]
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const shotsAt = args.indexOf('--shots');
const shots = shotsAt >= 0 ? args.splice(shotsAt, 2)[1] : null;
const file = path.resolve(args[0] || path.join(__dirname, '..', 'mote.html'));
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) pass++;
  else { fail++; console.log(`✗ ${name}${detail ? '\n    ' + String(detail).slice(0, 400) : ''}`); }
};

(async () => {
  try {
    execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'build-mote-html.js'), '--check'], { stdio: 'pipe' });
    ok('mote.html contains the current mote.js', true);
  } catch (e) { ok('mote.html contains the current mote.js', false, String(e.stderr)); }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route(/^(https?|wss?):/, r => { requests.push(r.request().url()); r.abort(); });
  await page.goto('file://' + file);
  await page.waitForFunction(() => /done/.test(document.getElementById('status').textContent));

  const outText = () => page.$eval('#out', e => e.innerText);
  const apiText = () => page.$eval('#api', e => e.textContent);
  const status = () => page.$eval('#status', e => e.textContent);
  async function runExample(name, until = /^(done|.*error|stopped by limit)$/) {
    await page.selectOption('#examples', name);
    await page.waitForFunction(re => new RegExp(re).test(document.getElementById('status').textContent), until.source, { timeout: 15000 });
    return outText();
  }

  ok('no network requests', requests.length === 0, requests.join(' '));
  ok('Mote global is defined', await page.evaluate(() => typeof Mote === 'object' && typeof Mote.create === 'function' && /^\d/.test(Mote.version)));
  ok('hello runs on load', /Hello from Mote!/.test(await outText()));
  ok('no horizontal scroll at 360 px', await page.evaluate(() => document.documentElement.scrollWidth <= 360), await page.evaluate(() => document.documentElement.scrollWidth));
  ok('syntax highlighting', await page.$eval('#hlin', e => e.querySelectorAll('.k').length > 0 && e.querySelectorAll('.s').length > 0 && e.querySelectorAll('.c').length > 0));
  ok('number formatting in output', /2\.5\t5\t2\t1024\t11\t1/.test(await outText()), await outText());
  if (shots) await page.screenshot({ path: path.join(shots, 'mote-hello-360.png') });

  let o = await runExample('tables');
  ok('tables example', /potions:\t3\titems:\t3/.test(o) && /\(3, 4\)\t5/.test(o) && /1\tbo\t50/.test(o), o);
  o = await runExample('closures');
  ok('closures example', /1\t2\t10\t3/.test(o) && /1\t4\t9/.test(o) && /hp\t10/.test(o) && /trim me\|/.test(o), o);

  const t0 = Date.now();
  o = await runExample('coroutines');
  const took = Date.now() - t0;
  ok('coroutines example: host wait resumed by timers', /countdown\t3\ncountdown\t2\ncountdown\t1\nliftoff!/.test(o) && /generator:\t1 4 7 10/.test(o) && /bat\tstep\t3/.test(o) && /all done/.test(o), o);
  ok('coroutines example took the waits (≥ 1.6 s)', took >= 1500, took);
  const a = await apiText();
  ok('API panel logs create/set/thread/resume/setTimeout', /Mote\.create\(/.test(a) && /vm\.set\('wait'/.test(a) && /vm\.thread\(chunk\)/.test(a) && /th\.resume\(\)/.test(a) && /setTimeout\(\(\) => th\.resume\(\), 400\)/.test(a), a.slice(0, 600));

  // dialogue: tap a choice (touch)
  await page.selectOption('#examples', 'dialogue');
  await page.waitForSelector('#out .choices button', { timeout: 5000 });
  ok('dialogue shows the merchant line and choices', /Merchant: Welcome, traveller!/.test(await outText()) && (await page.$$('#out .choices button')).length === 3);
  if (shots) await page.screenshot({ path: path.join(shots, 'mote-dialogue-360.png') });
  await page.tap('#out .choices button:nth-child(2)');
  await page.waitForFunction(() => document.querySelectorAll('#out .choices').length === 2, null, { timeout: 5000 });
  await page.tap('#out .choices:nth-of-type(2) button:nth-child(1)').catch(async () => {
    const bs = await page.$$('#out .choices'); const b = await bs[1].$('button'); await b.tap();
  });
  await page.waitForFunction(() => document.getElementById('status').textContent === 'done', null, { timeout: 5000 });
  o = await outText();
  ok('dialogue resumes with the tapped choice', /Wolves to the north/.test(o) && /Any time, friend\./.test(o) && /end of dialogue, gold:\t10/.test(o), o);
  ok('API log shows resume with the choice', /th\.resume\(2\)/.test(await apiText()) && /th\.resume\(1\)/.test(await apiText()));

  o = await runExample('runaway');
  ok('runaway loop stopped by the step budget', /playground:6: step budget exhausted \(200000 steps\)/.test(o) && !/never printed/.test(o), o);
  ok('status shows the limit', (await status()) === 'stopped by limit', await status());
  ok('VM still usable after the limit', /vm\.run\('return 1 \+ 1'\).*→ \[2\]/.test(await apiText()), await apiText());
  ok('the offending line is marked', await page.$eval('#gutin .bad', e => e.textContent) === '6');

  o = await runExample('sandbox');
  const lines = o.split('\n');
  ok('sandbox: host globals unreachable', lines[0] === 'nil\tnil\tnil\tnil\tnil\tnil' && lines[1] === 'nil\tnil\tnil', o);
  ok('sandbox: function prototype unreachable', /false\tplayground:4: attempt to index a function value \(global 'print'\)/.test(o), o);
  ok('sandbox: ref with allow-list', /Ada\t10\tuserdata/.test(o) && /healed to\t12/.test(o) && /nil\tnil\tnil/.test(lines.slice(5).join('\n')) && /cannot set field '__proto__'/.test(o) && /cannot set field 'secret'/.test(o), o);
  ok('sandbox: JS object changed through the ref', /player\.hp.*→ 12/.test(await apiText()));

  o = await runExample('errors');
  ok('errors example: messages with lines', /false\tplayground:6: division by zero/.test(o) && /attempt to index a nil value \(local 't'\)/.test(o) && /playground:12: attempt to index a nil value \(field 'weapon'\)/.test(o), o);
  ok('errors example: traceback and marked line', /stack traceback:/.test(o) && await page.$eval('#gutin .bad', e => e.textContent) === '12');

  // typing a custom script, Stop, compile error
  await page.fill('#code', 'for i = 1, 100 do print("tick", i) wait(0.3) end');
  await page.tap('#run');
  await page.waitForFunction(() => /tick\t1/.test(document.getElementById('out').innerText));
  await page.tap('#stop');
  await page.waitForTimeout(800);
  o = await outText();
  ok('stop halts a waiting script', /— stopped/.test(o) && !/tick\t3/.test(o), o);
  await page.fill('#code', 'local x = = 1');
  await page.tap('#run');
  await page.waitForFunction(() => /error/.test(document.getElementById('status').textContent));
  ok('compile error shown with line and column', /playground:1:11: unexpected symbol near '='/.test(await outText()) && (await status()) === 'syntax error', await outText());
  ok('highlight follows typed text', await page.$eval('#hlin', e => e.textContent.startsWith('local x = = 1')));

  // phone tabs: API panel reachable
  await page.tap('.tabs button[data-t=api]');
  ok('API tab visible on phone', await page.$eval('#api', e => e.offsetHeight > 50));
  if (shots) await page.screenshot({ path: path.join(shots, 'mote-api-360.png') });
  await page.tap('.tabs button[data-t=out]');

  // Ctrl+Enter runs
  await page.fill('#code', 'print(6 * 7)');
  await page.focus('#code');
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => /^42/.test(document.getElementById('out').innerText));
  ok('Ctrl+Enter runs', true);

  // desktop layout
  await page.setViewportSize({ width: 1200, height: 760 });
  await runExample('coroutines');
  ok('desktop: output and API side by side', await page.evaluate(() => {
    const o = document.getElementById('out').getBoundingClientRect(), a = document.getElementById('api').getBoundingClientRect(), c = document.getElementById('code').getBoundingClientRect();
    return o.left > c.right - 2 && a.top > o.top && o.height > 100 && a.height > 100;
  }));
  if (shots) await page.screenshot({ path: path.join(shots, 'mote-desktop.png') });

  ok('no page errors', errors.length === 0, errors.join('\n'));
  ok('still no network requests', requests.length === 0, requests.join(' '));
  await browser.close();
  console.log(`\nMote playground: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

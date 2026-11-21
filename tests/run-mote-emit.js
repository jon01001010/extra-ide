#!/usr/bin/env node
// Mote inside Emit, in headless Chromium: `use mote` (built into the IDE page — no network), the Mote builtins
// (moteVM, moteRun, moteSet, moteGet, moteCall, moteFn, moteThread, moteResume, moteChoices, moteChoose), errors
// from scripts as catchable Emit errors with their lines, a coroutine driven per frame (wait / waitFrames /
// choose), the step budget, the sandbox, `script NAME:` blocks (compile-time names, multi-file, errors with
// positions), the 📜 Script tool of the drawer (round trip, run, check, error line mapping, step budget), the
// "mote" example, the help, highlighting, and the .html / .js / offline exports of a Mote program — every page
// with ALL network requests aborted and counted (they must be zero). Programs that do not use Mote must compile
// to the same bytes as before Mote was added (compared with the page at git commit BASE, when git has it), and
// their exports must not carry Mote.
// Half of the checks run on a 360 px touch viewport (phone), half on a desktop one.
//
//   node tests/run-mote-emit.js [path/to/emit-ide.html]
//
// Exit code 0 when every check passes.
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const file = path.resolve(process.argv[2] || path.join(ROOT, 'emit-ide-1_32.html'));
const fileUrl = 'file://' + file;
const BASE = '2326988';   // the last commit before Mote was added to the Emit page
const PHONE = { viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true };
const DESK = { viewport: { width: 1100, height: 820 } };
const JS_ORIGIN = 'http://export.test';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mote-emit-'));

let passed = 0, failed = 0;
function check(label, ok, detail) {
  if (ok) { passed++; console.log('PASS  ' + label); }
  else { failed++; console.log('FAIL  ' + label + (detail !== undefined ? '\n      ' + String(detail).slice(0, 900) : '')); }
}

// A page whose every http(s) request is aborted and counted. page.netCount() → requests since the last reset.
async function newPage(browser, mode, opts = {}) {
  const ctx = await browser.newContext(mode);
  const page = await ctx.newPage();
  page.errors = []; page.requests = []; page.dialogs = [];
  page.on('pageerror', e => page.errors.push(e.message.slice(0, 300)));
  page.on('dialog', d => { page.dialogs.push(d.message()); d.accept(); });
  await page.route(/^(https?|wss?):/, route => {
    const url = route.request().url();
    if (opts.serve && url in opts.serve) return route.fulfill({ body: opts.serve[url][0], contentType: opts.serve[url][1] });
    page.requests.push(url);
    return route.abort();
  });
  return page;
}
async function openIde(browser, mode) {
  const page = await newPage(browser, mode);
  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof compileAndRun === 'function' && typeof _projLoad === 'function' && typeof _drawerOpen === 'function');
  await page.waitForTimeout(150);
  await page.evaluate(() => { try { closeWelcome(); } catch (e) {} try { localStorage.clear(); } catch (e) {} });
  // The IDE page itself asks Google Fonts for its fonts when it opens (not part of Emit or Mote): count from here.
  page.requests.length = 0;
  return page;
}
// Loads a program (a project bundle is fine), runs it, waits; → {status, out (Output tab text), prints (program
// lines: "> …" and Mote print lines), motePrints, errs (red ✗ lines)}
async function run(page, src, wait = 400) {
  await page.evaluate(s => { _projLoad(s); }, src);
  await page.evaluate(() => compileAndRun()).catch(e => page.errors.push('run rejected: ' + e.message));
  await page.waitForTimeout(wait);
  return outputOf(page);
}
const outputOf = page => page.evaluate(() => {
  const out = document.getElementById('tab-output');
  const divs = [...out.querySelectorAll('div')].filter(d => !d.firstElementChild);
  return {
    status: document.getElementById('sTxt').innerText,
    out: out.innerText,
    prints: divs.filter(d => d.classList.contains('emit-mote-print') || /^> /.test(d.textContent)).map(d => d.classList.contains('emit-mote-print') ? 'mote: ' + d.textContent : d.textContent.slice(2)),
    motePrints: [...out.querySelectorAll('.emit-mote-print')].map(d => ({ text: d.textContent, color: getComputedStyle(d).color })),
    errs: divs.filter(d => /^✗/.test(d.textContent)).map(d => d.textContent),
  };
});
const has = (arr, s) => arr.some(x => (s instanceof RegExp ? s.test(x) : x === s));

// ═════════════ programs ═════════════
const EVERY = `use mote

mut gold = 10

fn give(n: int) int {
  gold = gold + n
  return gold
}
fn shout(s: str) str {
  return s + "!"
}

export fn run() {
  let vm = moteVM()
  moteFn(vm, "give", fnRef(give))
  moteFn(vm, "shout", fnRef(shout))
  moteSet(vm, "i", 7)
  moteSet(vm, "f", 2.5)
  moteSet(vm, "b", true)
  moteSet(vm, "s", "text")
  moteSet(vm, "list", [3, 4, 5])
  let o = emptyObj()
  o.hp = 12
  moteSet(vm, "obj", o)
  printStr("types " + toStr(moteRun(vm, "return type(i) .. ',' .. type(f) .. ',' .. type(b) .. ',' .. type(s) .. ',' .. #list .. ',' .. obj.hp")))
  printStr("sum " + toStr(moteRun(vm, "return i + f + list[3]")))
  printStr("first only " + toStr(moteRun(vm, "return 1, 2, 3")))
  printStr("nothing is null " + isNull(moteRun(vm, "local x = 1")))
  moteRun(vm, "print('hello from Mote', 1 + 1)")
  printStr("give " + toStr(moteRun(vm, "return give(5) + give(1)")))
  printStr("gold " + gold)
  printStr("shout " + toStr(moteRun(vm, "return shout('hey')")))
  moteRun(vm, "hp = 99  stats = {1, 2, 3}  pos = {x = 4, y = 5}  function add(a, b) return a + b end  function pair() return 'p', 'q' end")
  let hp: int = moteGet(vm, "hp")
  printStr("get " + hp + " " + toStr(moteGet(vm, "stats").length) + " " + toStr(moteGet(vm, "pos").y) + " " + isNull(moteGet(vm, "nope")))
  printStr("call " + toStr(moteCall(vm, "add", 40, 2)) + " " + toStr(moteCall(vm, "pair")) + " " + toStr(moteCall(vm, moteGet(vm, "add"), 1, 2)))
  let th = moteThread(vm, "return 1")
  printStr("one-step thread " + toStr(moteResume(th)) + " " + toStr(moteResume(th)))
  let th2 = moteThread(vm, "local a, b = ... coroutine.yield(a) coroutine.yield(b)", 1, 2)
  mut n = 0
  while (moteResume(th2)) { n++ }
  printStr("thread resumed " + n)
  let small = moteVM(500)
  try {
    moteRun(small, "for i = 1, 10000 do end")
  } catch (e) {
    printStr("small budget: " + e.message)
  }
}
`;

const SCRIPTS = `use mote

export fn run() {
  let vm = moteVM()
  printStr(toStr(moteRun(vm, hello)))
  try {
    moteRun(vm, broken)
  } catch (e) {
    printStr("caught: " + e.message)
    printStr("line " + toStr(e.line) + " mote line " + toStr(e.moteLine) + " file " + toStr(e.file))
  }
  try {
    moteRun(vm, "local x = 1\\nx = x +")
  } catch (e) {
    printStr("syntax: " + e.message)
  }
  try {
    moteRun(vm, "error({code = 7})")
  } catch (e) {
    printStr("value: " + toStr(e.value.code))
  }
  try {
    moteRun(vm, "wait(1)")
  } catch (e) {
    printStr("wait outside: " + e.message)
  }
  moteRun(vm, broken)
}
//// file: scripts.emit
// two scripts
script hello:
  -- it's a comment with an apostrophe (the Emit highlighter must not see a string)
  local parts = {"hel", "lo"}
  return table.concat(parts)

script broken:
  local t = nil
  print("before the error")
  return t.field
`;

const FRAMES = `use mote

mut vm: js = null
mut th: js = null
mut frames = 0
mut log = ""

fn note(s: str) {
  log = log + s + "@" + frames + " "
}

export fn game() {
  vm = moteVM()
  moteFn(vm, "note", fnRef(note))
  th = moteThread(vm, steps)
  animate()
}

export fn frame() {
  frames++
  if (th != null) {
    let opts = moteChoices(th)
    if (opts != null) {
      note("asked:" + toStr(opts.length) + ":" + toStr(opts[1]))
      moteChoose(th, 2)
    }
    if (!moteResume(th)) {
      th = null
      printStr(log)
    }
  }
}

script steps:
  note("a")
  waitFrames(3)
  note("b")
  wait(0.25)
  note("c")
  local c = choose("tea", "coffee", "water")
  note("picked" .. c)
  coroutine.yield()
  note("d")
`;

const RUNAWAY = `use mote

mut vm: js = null
mut th: js = null
mut ticks = 0

export fn run() {
  vm = moteVM()
  try {
    moteRun(vm, "while true do end")
  } catch (e) {
    printStr("stopped: " + e.message)
  }
  try {
    moteRun(vm, "local s = 'x' while true do s = s .. s end")
  } catch (e) {
    printStr("stopped: " + e.message)
  }
  try {
    moteRun(vm, "local ok, err = pcall(function() while true do end end) return 'pcall caught it'")
  } catch (e) {
    printStr("pcall did not catch: " + e.message)
  }
  printStr("vm still works: " + toStr(moteRun(vm, "return 6 * 7")))
  th = moteThread(vm, "while true do end")
  try {
    moteResume(th)
  } catch (e) {
    printStr("thread stopped: " + e.message)
  }
  printStr("resume after: " + toStr(moteResume(th)))
}
`;

const SANDBOX = `use mote

export fn run() {
  let vm = moteVM()
  printStr("window " + toStr(moteRun(vm, "return type(window)")))
  printStr("globalThis " + toStr(moteRun(vm, "return type(globalThis)")))
  printStr("document " + toStr(moteRun(vm, "return type(document)")))
  printStr("require " + toStr(moteRun(vm, "return type(require)")) + " io " + toStr(moteRun(vm, "return type(io)")) + " os " + toStr(moteRun(vm, "return type(os)")))
  printStr("ctor " + toStr(moteRun(vm, "return tostring(('').constructor)")))
  printStr("proto " + toStr(moteRun(vm, "return tostring(({}).__proto__)")))
  try {
    moteRun(vm, "return print.constructor")
  } catch (e) {
    printStr("fn index: " + e.message)
  }
  printStr("load " + toStr(moteRun(vm, "local f = load('return window') return tostring(f())")))
  moteRun(vm, "pollute = {__proto__ = {pwned = true}}")
  let p = moteGet(vm, "pollute")
  printStr("pollution " + toStr(emptyObj().pwned))
}
`;

// ═════════════ main ═════════════
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const moteJs = fs.readFileSync(path.join(ROOT, 'mote.js'), 'utf8');

  // ── the page carries mote.js ──
  {
    let ok = true, msg = '';
    try { execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-mote-html.js'), '--check'], { stdio: 'pipe' }); } catch (e) { ok = false; msg = String(e.stderr || e.stdout); }
    check('tools/build-mote-html.js --check: mote.html and the Emit page contain the current mote.js', ok, msg);
    const html = fs.readFileSync(file, 'utf8');
    const m = html.match(/<!-- MOTE:BEGIN[^\n]*-->\n<script type="text\/plain" id="mote-src" data-emit-builtin="emit:mote">\n([\s\S]*?)<\/script>\n<!-- MOTE:END -->/);
    check('the Emit page embeds mote.js in a non-executing <script type="text/plain"> between the markers', !!m && m[1] === moteJs.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--'), m ? 'text differs' : 'markers not found');
  }

  // ═════════════ desktop: use mote, every builtin, errors, frames, budget, sandbox ═════════════
  let page = await openIde(browser, DESK);
  check('desktop: Mote is not running when the IDE opens (window.Mote undefined, the text is inert)', await page.evaluate(() => typeof window.Mote === 'undefined' && !!document.getElementById('mote-src')));
  let r = await run(page, EVERY);
  check('use mote: the program runs (status Done, no error lines)', r.status === 'Done' && !r.errs.length, r.status + ' ' + JSON.stringify(r.errs) + ' ' + r.out.slice(-1500));
  check('use mote: zero network requests', page.requests.length === 0, page.requests.join(', '));
  check('use mote: window.Mote is the embedded Mote, loaded once as a classic script from a Blob URL', await page.evaluate(() => typeof Mote === 'object' && typeof Mote.create === 'function' && document.querySelectorAll('script[data-emit-lib="emit:mote"]').length === 1));
  const want = [
    'types number,number,boolean,string,3,12', 'sum 14.5', 'first only 1', 'nothing is null true', 'mote: hello from Mote\t2',
    'give 31', 'gold 16', 'one-step thread false false', 'shout hey!', 'get 99 3 5 true', 'call 42 p 3', 'thread resumed 2',
  ];
  for (const w of want) check('builtins: ' + w, has(r.prints, w), r.prints.join(' | '));
  check('builtins: moteVM(500) has a budget of 500 steps', has(r.prints, /^small budget: main:1: step budget exhausted \(500 steps\)$/), r.prints.join(' | '));
  check('print from Mote: its own line in the Output tab, violet (not the green of printStr)', r.motePrints.length === 1 && r.motePrints[0].color === 'rgb(196, 181, 253)', JSON.stringify(r.motePrints));
  check('Mote calls are not traced line by line in the Output tab (no "→ moteRun(" lines with whole scripts)', !/→ mote\w*\(/.test(r.out), (r.out.match(/.*→ mote.*/g) || []).join(' | ').slice(0, 600));
  await page.waitForTimeout(300);
  check('offline cache: nothing stored for the built-in library (nothing to cache)', await page.evaluate(async () => !(await _libStore.list()).some(i => /^emit:|mote/.test(i.url))));
  check('📚 panel: Mote is listed as active in the program', await page.evaluate(() => { toggleLibs(); const c = [...document.querySelectorAll('#libsContent .lib-card')].find(x => x.querySelector('.lib-name').textContent === 'mote'); const html = document.getElementById('libsContent').innerHTML; toggleLibs(); return !!c && /Active in this program \(1\)/.test(html); }));
  await page.evaluate(() => compileAndRun());
  await page.waitForTimeout(300);
  check('a second Run reuses the loaded Mote (still one script element, still zero requests)', await page.evaluate(() => document.querySelectorAll('script[data-emit-lib="emit:mote"]').length === 1) && page.requests.length === 0);

  // auto-load: a Mote builtin without a use line
  r = await run(page, 'export fn run() {\n  let vm = moteVM()\n  printStr("auto " + toStr(moteRun(vm, "return 1 + 2")))\n}\n');
  check('a Mote builtin without `use mote` loads Mote by itself', has(r.prints, 'auto 3') && !r.errs.length, JSON.stringify(r).slice(0, 400));

  // scripts, errors
  r = await run(page, SCRIPTS);
  check('script block: moteRun(vm, hello) runs the block and returns its result', has(r.prints, 'hello'), r.prints.join(' | '));
  check('a runtime error in a script block is a catchable Emit error naming the script, its line and the file line', has(r.prints, "caught: broken:3: attempt to index a nil value (local 't') (scripts.emit:10)"), r.prints.join(' | '));
  check('the caught error has e.line (file line), e.moteLine, e.file', has(r.prints, 'line 10 mote line 3 file scripts.emit'), r.prints.join(' | '));
  check('a syntax error in Mote source text is catchable, with Mote line and column', has(r.prints, /^syntax: main:2:8: unexpected symbol near <eof>$/), r.prints.join(' | '));
  check('error{…} with a table: e.value carries it', has(r.prints, 'value: 7'), r.prints.join(' | '));
  check('wait() outside a thread is an error, not a hang', has(r.prints, /^wait outside: (main:1: )?attempt to yield from outside a coroutine/), r.prints.join(' | '));
  check('an uncaught script error is a red line with the script line and the file line', r.errs.some(e => e === "✗ moteRun(): broken:3: attempt to index a nil value (local 't') (scripts.emit:10)"), r.errs.join(' | '));
  check('scripts.emit is a file of the project (multi-file)', await page.evaluate(() => _proj.files.map(f => f.path).join()) === 'main.emit,scripts.emit');

  // frames
  r = await run(page, FRAMES, 1500);
  check('coroutine driven per frame: waitFrames(3), wait(0.25 s), choose → moteChoices / moteChoose, coroutine.yield', r.prints.length === 1 && (() => { const m = /^a@1 b@4 c@(\d+) asked:3:coffee@(\d+) picked2@(\d+) d@(\d+) $/.exec(r.prints[0]); return !!m && +m[1] >= 15 && +m[2] === +m[1] + 1 && +m[3] === +m[2] && +m[4] === +m[3] + 1; })(), r.prints.join(' | '));

  // budget
  const t0 = Date.now();
  r = await run(page, RUNAWAY, 300);
  const ms = Date.now() - t0;
  check('step budget: a runaway loop stops with a limit error', has(r.prints, 'stopped: main:1: step budget exhausted (1000000 steps)'), r.prints.join(' | '));
  check('memory limit: runaway allocation stops', has(r.prints, /^stopped: main:1: memory limit exceeded/), r.prints.join(' | '));
  check('pcall cannot catch the budget', has(r.prints, /^pcall did not catch: main:1: step budget exhausted/), r.prints.join(' | '));
  check('the VM stays usable; a runaway thread stops and is finished', has(r.prints, 'vm still works: 42') && has(r.prints, /^thread stopped: main:1: step budget exhausted/) && has(r.prints, 'resume after: false'), r.prints.join(' | '));
  const resp = await page.evaluate(() => { const t = performance.now(); return new Promise(ok => requestAnimationFrame(() => ok(performance.now() - t))); });
  check('the page did not freeze (whole run ' + ms + ' ms, next frame after ' + Math.round(resp) + ' ms)', ms < 8000 && resp < 1000, ms + ' / ' + resp);

  // sandbox
  r = await run(page, SANDBOX);
  check('sandbox: no window / globalThis / document / require / io / os', has(r.prints, 'window nil') && has(r.prints, 'globalThis nil') && has(r.prints, 'document nil') && has(r.prints, 'require nil io nil os nil'), r.prints.join(' | '));
  check('sandbox: no constructor / __proto__ through strings and tables', has(r.prints, 'ctor nil') && has(r.prints, 'proto nil'), r.prints.join(' | '));
  check('sandbox: host functions cannot be indexed; load() cannot reach window', has(r.prints, /^fn index: main:1: attempt to index a function value/) && has(r.prints, 'load nil'), r.prints.join(' | '));
  check('sandbox: a table with __proto__ does not pollute JS prototypes', has(r.prints, 'pollution ') && await page.evaluate(() => ({}).pwned === undefined), r.prints.join(' | '));
  check('desktop: zero network requests for all of the above', page.requests.length === 0, page.requests.join(', '));

  // ── compile-time checks ──
  const C = await page.evaluate(() => {
    const T = s => { try { const r = compile(s); return (r.errors || []).join(' | ') || 'OK'; } catch (e) { return e.message; } };
    return {
      unknown: T('script intro:\n  print(1)\nexport fn run() {\n  let vm = moteVM()\n  moteRun(vm, intor)\n}\n'),
      none: T('export fn run() {\n  let vm = moteVM()\n  moteRun(vm, nothere)\n}\n'),
      syntax: T('export fn run() {\n}\nscript intro:\n  local x = 1\n  if x then\n    print(x\n  end\n'),
      syntaxOther: T('export fn run() {\n}\n//// file: scripts.emit\nscript s1:\n    print(1 +)\n'),
      dup: T('script a:\n  print(1)\n//// file: b.emit\nscript a:\n  print(2)\n'),
      clash: T('script a:\n  print(1)\nfn a() {\n}\n'),
      clashSprite: T('sprite hero: 1x1\n  "1"\nscript hero:\n  print(1)\n'),
      head: T('script intro: oops\n  print(1)\n'),
      empty: T('script intro:\nexport fn run() {\n}\n'),
      inFn: T('export fn run() {\nscript intro:\n  print(1)\n}\n'),
      assign: T('export fn run() {\n  intro = "x"\n}\nscript intro:\n  print(1)\n'),
      argType: T('export fn run() {\n  let vm = moteVM()\n  moteRun(vm, 5)\n}\n'),
      argVm: T('export fn run() {\n  moteRun(1, "x")\n}\n'),
      argCount: T('export fn run() {\n  let vm = moteVM()\n  moteRun(vm)\n}\n'),
      argFn: T('export fn run() {\n  let vm = moteVM()\n  moteFn(vm, "f", 3)\n}\n'),
      argVoid: T('fn nothing() {\n}\nexport fn run() {\n  let vm = moteVM()\n  moteSet(vm, "x", nothing())\n}\n'),
      argChoose: T('export fn run() {\n  let vm = moteVM()\n  let th = moteThread(vm, "x = 1")\n  moteChoose(th, "one")\n}\n'),
      tooMany: T('export fn run() {\n  let vm = moteVM(1, 2)\n}\n'),
      shadow: T('export fn run() {\n  let intro = "print(2)"\n  let vm = moteVM()\n  moteRun(vm, intro)\n}\nscript intro:\n  print(1)\n'),
      ownFn: T('fn moteRun(a: int, b: int) int {\n  return a + b\n}\nexport fn run() {\n  print(moteRun(1, 2))\n}\n'),
    };
  });
  const CE = {
    unknown: '5:15: Unknown script "intor" — did you mean "intro"?',
    none: '3:15: Unknown script "nothere" — there is no script block yet: write one (script nothere:, then Mote source on indented lines) or make one with the Drawer (🧰 → Script)',
    syntax: "7:3: Mote syntax error in script intro: ')' expected (to close '(' at line 6) near 'end'",
    syntaxOther: "scripts.emit:2:14: Mote syntax error in script s1: unexpected symbol near ')'",
    dup: 'b.emit:1:8: script a is already declared in main.emit (line 1) — every script of the project needs its own name',
    clash: '1:8: The name "a" is a script and also a function (line 3) — script names are seen by every file, so rename one of them',
    clashSprite: '3:8: The name "hero" is a script and also a sprite (line 1) — script names are seen by every file, so rename one of them',
    head: '1:15: The Mote source of script intro goes on the indented lines below the header — script intro: (nothing after the colon but a -- comment)',
    empty: '1:1: script intro has no Mote source — write it on indented lines below the header, e.g.\n  print("hello")',
    inFn: '2:1: script blocks belong at the top level of a file, not inside a function — is a } missing above?',
    assign: '2:3: intro is a script block — its text cannot be assigned',
    argType: '3:15: moteRun(): parameter src is str, but this is an int — a script block name or a str of Mote source',
    argVm: '2:11: moteRun(): parameter vm is js, but this is an int — make one with moteVM()',
    argCount: '3:3: moteRun takes 2 arguments: moteRun(vm, intro) — intro: a script block, or a str of Mote source',
    argFn: '3:19: moteFn(): parameter f is js, but this is an int — pass an Emit function as fnRef(myFn)',
    argVoid: '5:20: moteSet(): argument 3 is a call that returns nothing — there is no value to pass',
    argChoose: '4:18: moteChoose(): parameter n is int, but this is a str',
    tooMany: '2:12: moteVM takes 0 to 1 arguments: let vm = moteVM()  or  moteVM(100000) for a smaller step budget',
    shadow: 'OK', ownFn: 'OK',
  };
  for (const k of Object.keys(CE)) check('compile: ' + k + ' → ' + CE[k].split('\n')[0].slice(0, 90), C[k] === CE[k], C[k]);

  // multi-file: a script used from a non-entry module, a local of the same name wins
  r = await run(page, 'use mote\nimport game\n\nexport fn run() {\n  printStr(game.greet())\n  let level = "return \'local wins\'"\n  let vm = moteVM()\n  printStr(toStr(moteRun(vm, level)))\n}\n//// file: game.emit\npublic fn greet() str {\n  let vm = moteVM()\n  return toStr(moteRun(vm, level))\n}\n//// file: levels/scripts.emit\nscript level:\n  return "level " .. 1 + 1\n');
  check('multi-file: a script block of another file is usable by name from a module (project-wide names)', has(r.prints, 'level 2') && has(r.prints, 'local wins') && !r.errs.length, JSON.stringify(r).slice(0, 500));
  const blk = await page.evaluate(() => { const r = compile(_projText()); return r.scripts; });
  check('compile result lists the scripts: r.scripts [{name, path, line, source}]', JSON.stringify(blk) === JSON.stringify([{ name: 'level', path: 'levels/scripts.emit', line: 1, source: 'return "level " .. 1 + 1' }]), JSON.stringify(blk));

  // byte-identical compiles for programs without Mote (against the page before Mote, when git has it)
  {
    let base = null;
    try { base = execFileSync('git', ['-C', ROOT, 'show', BASE + ':emit-ide-1_32.html'], { maxBuffer: 64 << 20 }).toString('utf8'); } catch (e) { base = null; }
    if (!base) console.log('note  git has no commit ' + BASE + ': byte-identical compile check skipped');
    else {
      const bf = path.join(tmpDir, 'base.html'); fs.writeFileSync(bf, base);
      const bp = await newPage(browser, DESK);
      await bp.goto('file://' + bf);
      await bp.waitForFunction(() => typeof compileAndRun === 'function' && typeof EX === 'object');
      const progs = await page.evaluate(() => Object.keys(EX).filter(n => n !== 'mote').map(n => [n, EX[n]]));
      progs.push(['sound', 'sound coin: square 880\nexport fn run() {\n  play(coin)\n}\n'], ['interop', 'export fn run() {\n  let o = emptyObj()\n  o.x = 1\n  printStr(toStr(o.x))\n}\n']);
      const hashes = async (p, list) => p.evaluate(list => list.map(([n, s]) => { try { const r = compile(s); let h = 0; for (const b of r.wasm) h = (h * 31 + b) >>> 0; return n + ':' + r.wasm.length + ':' + h + ':' + (r.errors || []).length; } catch (e) { return n + ':throws:' + e.message; } }), list);
      const a = await hashes(bp, progs), b = await hashes(page, progs);
      const diffs = a.filter((x, i) => x !== b[i]);
      check('programs without Mote compile to the same bytes as before Mote (' + progs.length + ' programs: every example but mote)', diffs.length === 0, diffs.join(' | ') + ' vs ' + b.filter((x, i) => x !== a[i]).join(' | '));
      // exports of a program without Mote: no Mote in them, and the size as before (± the few lines of loader hooks)
      const plain = 'export fn run() {\n  printStr("plain")\n}\n';
      const exp = async p => p.evaluate(s => { const r = compile(s); const P = _exportProgram(s, r); return { html: _exportHtml(P), js: _exportJs(P) }; }, plain);
      const eb = await exp(bp), en = await exp(page);
      const grow = { html: en.html.length - eb.html.length, js: en.js.length - eb.js.length };
      check('exports of a program without Mote carry no Mote (no moteVM helpers, no Mote source)', !/moteVM|Mote\.create|class MoteError/.test(en.html) && !/moteVM|Mote\.create|class MoteError/.test(en.js));
      check('exports of a program without Mote stay the size they were (+' + grow.html + ' / +' + grow.js + ' bytes of loader hooks)', grow.html >= 0 && grow.html < 600 + 1900 + 600 && grow.js < 700 + 1900 + 600, JSON.stringify(grow));   // + ~1.8 KB: case-insensitive names in the runtime (sprite / sound / map / controls lookups, the JS-interop stubs); + ~0.6 KB: str cells in regions (the collector reads them) and httpText
      await bp.context().close();
    }
  }

  // ── highlighting of script blocks in the main editor ──
  await page.evaluate(s => { _projLoad(s); }, 'script talk:\n  -- don\'t break: a quote in a Mote comment\n  local s = [[long\n  string]]\n  print("x")\n\nexport fn run() {\n  let a = 1\n}\n');
  await page.waitForTimeout(150);
  const hl = await page.evaluate(() => { const l = document.getElementById('hlInner').innerHTML.split('\n'); return { head: l[0], cmt: l[1], long: l[2] + '|' + l[3], fn: l[6], let: l[7] }; });
  check('editor: the script header is highlighted as a block (script = keyword, name = type colour)', /<span class="kw">script<\/span> <span class="ty">talk<\/span>/.test(hl.head), hl.head);
  check('editor: Mote comments / long strings get Mote colours', /<span class="cmt">-- don't break/.test(hl.cmt) && hl.long.includes('<span class="str">[[long</span>|  <span class="str">string]]</span>'), JSON.stringify(hl));
  check('editor: a quote inside a script does not spill into the Emit code after it', /<span class="kw">export<\/span>/.test(hl.fn) && /<span class="kw">let<\/span>/.test(hl.let), JSON.stringify(hl));

  // ── help, registry ──
  const help = await page.evaluate(() => { const hs = [...document.querySelectorAll('#helpOverlay h2')].map(h => h.textContent); const t = document.getElementById('helpOverlay').textContent; return { hs, sigs: ['moteVM()', 'moteRun(vm', 'moteSet(vm', 'moteGet(vm', 'moteCall(vm', 'moteFn(vm', 'moteThread(vm', 'moteResume(th)', 'moteChoices(th)', 'moteChoose(th'].filter(s => !t.includes(s)) }; });
  check('help: "Mote scripts" and "Mote builtins" sections, every builtin documented', help.hs.includes('Mote scripts') && help.hs.includes('Mote builtins') && !help.sigs.length, JSON.stringify(help));
  const reg = await page.evaluate(() => { const l = LIBS.find(x => x.name === 'mote'); return l && { cdn: l.cdn, global: l.global, auto: _fnToCdn.moteRun, autoVM: _fnToCdn.moteVM }; });
  check('registry: the mote entry is built in (emit:mote); the builtins auto-load it', reg && reg.cdn === 'emit:mote' && reg.global === 'Mote' && reg.auto === 'emit:mote' && reg.autoVM === 'emit:mote', JSON.stringify(reg));
  check('desktop: no page errors', page.errors.length === 0, page.errors.join(' | '));

  // ── exports of a Mote program: .html, .js, offline .html, offline .js — zero network ──
  {
    await page.evaluate(s => { _projLoad(s); }, FRAMES.replace('printStr(log)', 'printStr(log)\n      printStr(toStr(moteRun(vm, extra)))') + '\nscript extra:\n  print("extra ran")\n  return "done"\n');
    await page.evaluate(() => compileAndRun());
    await page.waitForTimeout(1500);
    const ide = await outputOf(page);
    const files = await page.evaluate(async () => {
      const got = {}, alerts = [];
      window._download = (name, content) => { got[name] = String(content); };
      window.alert = m => alerts.push(String(m));
      for (const fmt of ['html', 'js', 'htmloff', 'jsoff']) { try { await doExport(fmt); } catch (e) { alerts.push(fmt + ': ' + e.message); } }
      return { got, alerts, report: (document.querySelector('#tab-output .emit-export-report') || {}).textContent || '' };
    });
    check('exports: the four files were written (no alert)', ['program.html', 'program.js', 'program-offline.html', 'program-offline.js'].every(n => typeof files.got[n] === 'string') && !files.alerts.length, files.alerts.join(' | ') + ' ' + Object.keys(files.got));
    check('exports: each carries the Mote source once', ['program.html', 'program.js', 'program-offline.html', 'program-offline.js'].every(n => { const t = files.got[n] || ''; return (t.match(/class MoteError extends Error/g) || []).length === 1; }), ['program.html', 'program.js', 'program-offline.html', 'program-offline.js'].map(n => (files.got[n] || '').split('class MoteError extends Error').length - 1).join());
    check('offline export report lists Mote as built in, nothing fetched', /emit:mote \(built-in script/.test(files.report) && /needs no network/.test(files.report), files.report);
    check('exports: the IDE run of the program shows the dialogue log', ide.prints.length === 3 && /^a@1 b@4 /.test(ide.prints[0]) && ide.prints[1] === 'mote: extra ran' && ide.prints[2] === 'done', ide.prints.join(' | '));
    for (const name of ['program.html', 'program-offline.html']) {
      const f = path.join(tmpDir, name); fs.writeFileSync(f, files.got[name]);
      const p = await newPage(browser, PHONE);
      await p.goto('file://' + f);
      await p.waitForTimeout(1800);
      const shown = await p.evaluate(() => [...document.querySelectorAll('#tab-output div')].filter(d => !d.firstElementChild && getComputedStyle(d).display !== 'none').map(d => d.textContent));
      check(name + ' (phone): runs with zero network requests and shows what the IDE shows', p.requests.length === 0 && shown.length === 3 && /^a@1 b@4 c@\d+ asked:3:coffee@\d+ picked2@\d+ d@\d+ $/.test(shown[0]) && shown[1] === 'extra ran' && shown[2] === 'done' && !p.errors.length, JSON.stringify({ req: p.requests, shown, errors: p.errors }));
      await p.context().close();
    }
    for (const name of ['program.js', 'program-offline.js']) {
      const p = await newPage(browser, DESK, { serve: {
        [JS_ORIGIN + '/program.js']: [files.got[name], 'text/javascript'],
        [JS_ORIGIN + '/index.html']: ['<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><div id="app"></div><script type="module">\ntry{const m=await import("./program.js");window.__app=await m.init({target:document.getElementById("app")});window.__state="ready"}catch(e){window.__state="error: "+(e&&e.message||e)}\n<\/script></body></html>', 'text/html'],
      } });
      await p.goto(JS_ORIGIN + '/index.html');
      await p.waitForFunction(() => window.__state, null, { timeout: 20000 }).catch(() => {});
      await p.waitForTimeout(1800);
      const st = await p.evaluate(() => ({ state: window.__state, shown: [...document.querySelectorAll('#tab-output div')].filter(d => !d.firstElementChild && getComputedStyle(d).display !== 'none').map(d => d.textContent) }));
      check(name + ': init() runs the program with zero network requests (besides the module itself)', st.state === 'ready' && p.requests.length === 0 && st.shown.length === 3 && /^a@1 b@4 /.test(st.shown[0]) && st.shown[1] === 'extra ran' && !p.errors.length, JSON.stringify({ st, req: p.requests, errors: p.errors }));
      await p.context().close();
    }
  }
  await page.context().close();

  // ═════════════ phone: the example, the Script tool ═════════════
  page = await openIde(browser, PHONE);
  const opts = await page.$$eval('#example option', os => os.map(o => o.value));
  check('phone: the Example menu has Mote; Memory and Modules stay the last two', opts.includes('mote') && opts.slice(-2).join() === 'memory,modules' && opts.indexOf('mote') === opts.length - 3, opts.join());
  await page.selectOption('#example', 'mote');
  check('phone: the example is a two-file project (main.emit, scripts.emit)', await page.evaluate(() => _proj.files.map(f => f.path).join()) === 'main.emit,scripts.emit');
  await page.evaluate(() => compileAndRun());
  await page.waitForTimeout(3500);
  r = await outputOf(page);
  check('phone: the example runs: the mod changes the speed through setSpeed, the dialogue talks, chooses, gives gold',
    r.status === 'Done' && !r.errs.length && has(r.prints, 'mote: mod loaded: double speed') && has(r.prints, 'says: Hello, Ada!') && has(r.prints, 'says: Care for a potion? 5 gold.') && has(r.prints, 'says: Here you go. 5 gold left.') && has(r.prints, 'says: Safe travels!') && has(r.prints, 'dialogue over, gold 5'), JSON.stringify(r.prints) + ' ' + r.errs.join(' | '));
  check('phone: the example draws on its canvas', await page.evaluate(() => { const c = document.querySelector('#tab-output canvas'); if (!c) return false; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 4; i < d.length; i += 4) if (d[i] !== d[0] || d[i + 1] !== d[1]) return true; return false; }));
  check('phone: the example needs no network', page.requests.length === 0, page.requests.join(', '));
  await page.evaluate(() => { try { stopProgram(); } catch (e) {} });

  // the Script tool
  await page.evaluate(() => _drawerOpen());
  await page.waitForTimeout(150);
  const card = await page.evaluate(() => { const c = document.querySelector('#drawer .drw-card[data-tool="script"]'); return c && { icon: c.querySelector('.drw-ic').textContent, label: c.querySelector('.drw-cl').textContent }; });
  check('phone: the drawer has a Script card with 📜', card && card.icon === '📜' && card.label === 'Script', JSON.stringify(card));
  await page.tap('#drawer .drw-card[data-tool="script"]');
  await page.waitForTimeout(200);
  const before = await page.evaluate(() => _projText());
  let T = await page.evaluate(() => ({ chips: [...document.querySelectorAll('#drawer .drw-chip:not(.drw-add)')].map(c => c.textContent), src: document.querySelector('#drawer .mte-ta').value, sw: document.documentElement.scrollWidth, iw: window.innerWidth, panelW: document.querySelector('#drawer .drw').getBoundingClientRect().width }));
  check('Script tool: lists the script blocks of the project', T.chips.join() === 'dialogue,mod', JSON.stringify(T.chips));
  check('Script tool: shows the dedented Mote source', T.src.split('\n')[0] === 'say("Hello, " .. player .. "!")' && !/^ /.test(T.src), JSON.stringify(T.src.slice(0, 80)));
  check('phone: Script tool fits 360 px (no horizontal scroll)', T.sw <= T.iw && T.panelW <= 360, JSON.stringify(T));
  check('Script tool: Mote highlighting in its editor', await page.evaluate(() => /<span class="blt">wait<\/span>/.test(document.querySelector('#drawer .mte-hl').innerHTML) && /<span class="kw">local<\/span>/.test(document.querySelector('#drawer .mte-hl').innerHTML)));
  // Run (sandbox, stand-ins)
  await page.tap('#drawer .mte-run');
  await page.waitForTimeout(150);
  T = await page.evaluate(() => ({ out: [...document.querySelectorAll('#drawer .mte-o')].map(d => d.textContent), steps: document.querySelector('#drawer .mte-steps').textContent }));
  check('Script tool Run: the dialogue runs in the sandbox — stand-ins log say/give, wait skipped, choose takes 1',
    T.out[0] === '→ say("Hello, ‹player›!")  — stand-in' && T.out.includes('? choose("Yes", "No thanks") → 1 here (the first option)') && T.out.includes('→ give(-5)  — stand-in') && T.out[T.out.length - 1] === '✓ finished', JSON.stringify(T.out));
  check('Script tool: the step budget is shown (steps used / budget)', /^steps \d+ \/ 1,000,000$/.test(T.steps), T.steps);
  check('Script tool: running does not touch the program, the window or the IDE Mote', await page.evaluate(b => _projText() === b && window.player === undefined && window.say === undefined, before));
  // the mod: print goes to the pane; the round trip of an unchanged save
  await page.evaluate(() => _drawer.ctx.moteTool.select('mod'));
  await page.tap('#drawer .mte-run');
  T = await page.evaluate(() => [...document.querySelectorAll('#drawer .mte-o')].map(d => d.className + '|' + d.textContent));
  check('Script tool: print() of the script goes to the output pane', T.includes('mte-o mte-pr|mod loaded: double speed') && T.includes('mte-o mte-log|→ setSpeed(4)  — stand-in'), JSON.stringify(T));
  await page.evaluate(() => { _drawer.ctx.moteTool.items().forEach(it => { it.dirty = true; }); _drawer.ctx.moteTool.save(); });
  check('Script tool: saving unchanged scripts writes the program back byte for byte', await page.evaluate(b => _projText() === b, before));
  // error line mapping: break line 3 of the dialogue
  await page.evaluate(() => _drawer.ctx.moteTool.select('dialogue'));
  await page.evaluate(() => { const ta = document.querySelector('#drawer .mte-ta'); const l = ta.value.split('\n'); l[2] = 'say("Care for a potion?" .. nil)'; ta.value = l.join('\n'); ta.dispatchEvent(new Event('input')); });
  await page.tap('#drawer .mte-run');
  T = await page.evaluate(() => ({ last: [...document.querySelectorAll('#drawer .mte-o')].pop().textContent, marked: [...document.querySelectorAll('#drawer .mte-hl .mte-l')].findIndex(l => l.classList.contains('mte-err')) + 1, dirty: _drawer.dirty, chip: document.querySelector('#drawer .drw-chip.on').classList.contains('dirty') }));
  check('Script tool: a runtime error names the script line and the file line, and marks the line', T.last === '✗ line 3 of the script (scripts.emit:5): attempt to concatenate a nil value' && T.marked === 3, JSON.stringify(T));
  check('Script tool: an edit makes the tool dirty (chip dot)', T.dirty === true && T.chip === true, JSON.stringify(T));
  await page.evaluate(() => { const ta = document.querySelector('#drawer .mte-ta'); const l = ta.value.split('\n'); l[2] = 'say("Care for a potion?"'; ta.value = l.join('\n'); ta.dispatchEvent(new Event('input')); });
  await page.tap('#drawer .mte-check');
  T = await page.evaluate(() => ({ last: [...document.querySelectorAll('#drawer .mte-o')].pop().textContent, marked: [...document.querySelectorAll('#drawer .mte-hl .mte-l')].findIndex(l => l.classList.contains('mte-err')) + 1 }));
  check('Script tool Check: a syntax error with its line in the script and in the file', T.last === "✗ line 4 of the script (scripts.emit:6): syntax error: ')' expected (to close '(' at line 3) near 'local'" && T.marked === 4, JSON.stringify(T));
  // budget
  await page.evaluate(() => { const ta = document.querySelector('#drawer .mte-ta'); ta.value = 'local n = 0\nwhile true do n = n + 1 end'; ta.dispatchEvent(new Event('input')); const b = document.querySelector('#drawer .mte-bud'); b.value = '5000'; b.dispatchEvent(new Event('change')); });
  const tb = Date.now();
  await page.tap('#drawer .mte-run');
  T = await page.evaluate(() => ({ last: [...document.querySelectorAll('#drawer .mte-o')].pop().textContent, steps: document.querySelector('#drawer .mte-steps').textContent, over: document.querySelector('#drawer .mte-steps').classList.contains('mte-over') }));
  check('Script tool: a runaway script stops at the step budget, shown in red', T.last === '✗ line 2 of the script (scripts.emit:4): step budget exhausted (5000 steps)' && /budget used up/.test(T.steps) && T.over && Date.now() - tb < 3000, JSON.stringify(T));
  // save an edit: the block is re-indented with the block's own indentation, reads back the same
  await page.evaluate(() => { const ta = document.querySelector('#drawer .mte-ta'); ta.value = 'say("Short now")\nlocal c = choose("A", "B")\nif c == 1 then\n  say("A!")\nend'; ta.dispatchEvent(new Event('input')); });
  await page.tap('#drawer .drw-ft .drw-pri');
  await page.waitForTimeout(100);
  T = await page.evaluate(() => ({ text: _proj.files[1].source, dirty: _drawer.dirty, src: document.querySelector('#drawer .mte-ta').value }));
  check('Script tool Save: the block in scripts.emit holds the new source, indented', T.text.includes('script dialogue:\n  say("Short now")\n  local c = choose("A", "B")\n  if c == 1 then\n    say("A!")\n  end\n\nscript mod:') && !T.dirty && T.src.startsWith('say("Short now")'), JSON.stringify(T));
  check('Script tool Save: the program still compiles', await page.evaluate(() => { const r = compile(_projText()); return !r.errors.length && r.scripts.map(s => s.name).join() === 'dialogue,mod'; }));
  // a new script goes into scripts.emit; rename; round trip after reopening
  await page.evaluate(() => { _drawerClose(); _projLoad('use mote\nexport fn run() {\n  let vm = moteVM()\n  printStr(toStr(moteRun(vm, greeting)))\n}\n'); });
  await page.evaluate(() => _drawerOpen('script'));
  await page.waitForTimeout(100);
  T = await page.evaluate(() => ({ chips: [...document.querySelectorAll('#drawer .drw-chip:not(.drw-add)')].map(c => c.textContent), dirty: _drawer.dirty }));
  check('Script tool: a project without scripts starts with a starter script that is not saved by itself', T.chips.join() === 'intro' && !T.dirty, JSON.stringify(T));
  await page.evaluate(() => { const n = document.querySelector('#drawer .drw-name'); n.value = 'greeting'; n.dispatchEvent(new Event('change')); const ta = document.querySelector('#drawer .mte-ta'); ta.value = '-- greets\nreturn "hi " .. 40 + 2\n'; ta.dispatchEvent(new Event('input')); });
  await page.tap('#drawer .drw-ft .drw-pri');
  T = await page.evaluate(() => ({ files: _proj.files.map(f => f.path + '=' + JSON.stringify(f.source)) }));
  check('Script tool: a new script is written to scripts.emit', T.files.join(' ') === 'main.emit="use mote\\nexport fn run() {\\n  let vm = moteVM()\\n  printStr(toStr(moteRun(vm, greeting)))\\n}\\n" scripts.emit="script greeting:\\n  -- greets\\n  return \\"hi \\" .. 40 + 2\\n"', T.files.join(' '));
  await page.evaluate(() => _drawerClose());
  await page.evaluate(() => _drawerOpen('script'));
  T = await page.evaluate(() => ({ src: document.querySelector('#drawer .mte-ta').value, chips: [...document.querySelectorAll('#drawer .drw-chip:not(.drw-add)')].map(c => c.textContent) }));
  check('Script tool: reopening reads the block back exactly', T.src === '-- greets\nreturn "hi " .. 40 + 2' && T.chips.join() === 'greeting', JSON.stringify(T));
  await page.evaluate(() => _drawerClose());
  r = await run(page, await page.evaluate(() => _projText()));
  check('phone: the program runs the script the tool wrote', has(r.prints, 'hi 42') && page.requests.length === 0, JSON.stringify(r.prints));
  // hand-written block with tabs and blank lines round-trips through the tool
  const hand = 'export fn run() {\n}\n//// file: scripts.emit\nscript tabs: -- header comment\n\tlocal a = 1\n\n\tif a then\n\t\tprint(a)\n\tend\n';
  await page.evaluate(s => _projLoad(s), hand);
  await page.evaluate(() => _drawerOpen('script'));
  const rt = await page.evaluate(() => { const before = _projText(); const t = _drawer.ctx.moteTool; t.items()[0].dirty = true; t.save(); const same = _projText() === before; const ta = document.querySelector('#drawer .mte-ta'); ta.value = ta.value + '\nprint(2)'; ta.dispatchEvent(new Event('input')); t.save(); return { same, src: _proj.files[1].source }; });
  check('Script tool: a hand-written block (tabs, a blank line, a header comment) round-trips; an edit keeps its indentation and header', rt.same && rt.src === 'script tabs: -- header comment\n\tlocal a = 1\n\n\tif a then\n\t\tprint(a)\n\tend\n\tprint(2)\n', JSON.stringify(rt));
  await page.evaluate(() => _drawerClose());
  check('phone: no page errors', page.errors.length === 0, page.errors.join(' | '));
  check('phone: zero network requests', page.requests.length === 0, page.requests.join(', '));
  await page.context().close();

  await browser.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + passed + '/' + (passed + failed) + ' mote-emit checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

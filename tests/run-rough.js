#!/usr/bin/env node
// Rough edges: (1) top-level values of any kind, (2) things and rules across files, (3) call arguments
// (print(x) with x: num, and an audit of every builtin), (4) the help paragraphs. Headless Chromium, offline.
//
//   node tests/run-rough.js [path/to/emit-ide.html] [section ...]      sections: values export memory audit types things help
//   VERBOSE=1 prints the Output tab of every IDE run.
//
// Exit code 0 only when every check passes. The builtin audit prints its table summary: every builtin is called
// with each argument type (int, num, bool, str, js, arr; as a local and as a literal) in every parameter position
// (the other arguments of their declared type) and its result is used; every program must compile to VALID
// WebAssembly (WebAssembly.validate) or fail with a readable compile error — never invalid WASM.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const FILE = path.resolve(args[0] && /\.html$/.test(args[0]) ? args.shift() : path.join(__dirname, '..', 'emit-ide-1_32.html'));
const ONLY = new Set(args);
const want = s => !ONLY.size || ONLY.has(s);

let passed = 0, failed = 0;
function check(label, ok, detail) {
  if (ok) { passed++; console.log('PASS  ' + label); }
  else { failed++; console.log('FAIL  ' + label + (detail !== undefined ? '\n      ' + String(detail).slice(0, 1200) : '')); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A stand-in library: a function that throws, an ES5 class, values.
const FAKE_LIB = `
window.fakeLib = {
  boom: function () { throw new Error('kaboom'); },
  OldPoint: (function () { function OldPoint(x, y) { this.x = x; this.y = y; } OldPoint.prototype.sum = function () { return this.x + this.y; }; return OldPoint; })(),
  label: function (n) { return 'label ' + n; },
  fetchUser: function (id) { return new Promise(function (ok) { setTimeout(function () { ok({ id: id }); }, 10); }); },
  list: function (n) { var a = []; for (var i = 0; i < n; i++) a.push(i * 10); return a; },
};
window.makeBox = function (v) { return { value: function () { return v; }, v: v }; };
`;
const MARK = '//// file: ';
const join = files => files.map(([p, s]) => MARK + p + '\n' + s.replace(/\n*$/, '\n')).join('');

async function newPage(browser, opts) {
  const page = await browser.newPage(opts || { viewport: { width: 1200, height: 800 } });
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.route(/^https?:/, r => r.abort());
  await page.goto('file://' + FILE);
  await page.waitForFunction(() => typeof compileAndRun === 'function');
  await page.evaluate(FAKE_LIB);
  await page.evaluate(() => { try { closeWelcome(); } catch (e) {} });
  return page;
}
// Run in the IDE: the text goes in as a project (a bundle is split into files), then Run.
async function run(page, src, wait) {
  await page.evaluate(s => _projLoad(s), src);
  await page.evaluate(() => { window.requestAnimationFrame = function () { return 0; }; });
  await page.evaluate(() => compileAndRun()).catch(e => page.errors.push('run rejected: ' + e.message));
  await page.waitForTimeout(wait || 200);
  const r = await page.evaluate(() => ({ status: document.getElementById('sTxt').innerText, out: document.getElementById('tab-output').innerText }));
  r.lines = r.out.split('\n').map(l => l.trim()).filter(Boolean);
  r.printed = r.lines.filter(l => /^> /.test(l));
  r.red = r.lines.filter(l => /^✗/.test(l));
  if (process.env.VERBOSE) console.log(r.lines.map(l => '      | ' + l).join('\n'));
  return r;
}
const compileOnly = (page, src) => page.evaluate(s => {
  try { const r = compile(s, 'wasm32'); return { errors: r.errors, valid: WebAssembly.validate(r.wasm), exports: r.functions.filter(f => f.exported).map(f => f.name) }; }
  catch (e) { return { thrown: e.message }; }
}, src);

// ═══ 1. top-level values ═══
const KINDS = `
fn five() int {
  return 5
}
struct Ball { x: num, hp: u8 }
region balls: Ball[4]
fn setup() int {
  balls[1].x = 2.5
  balls[1].hp = 7
  return 1
}
mut x = five()
let prices = [3, 4, 5]
let weights = [0.5, 1.5]
let cfg = {speed: 2, name: "fast"}
let title = "level " + toStr(x)
let root = sqrt(2.0)
let half: num = five()
let box = makeBox(7)
let pt = new fakeLib.OldPoint(1, 2)
let lbl = fakeLib.label(3)
let tag: js = "hello"
let ready = setup()
let bx = balls[1].x
let hp = balls[1].hp
let after = x * 10 + prices[2]
let flag = x > 3
export fn run() {
  print(x)
  print(prices[1])
  printNum(weights[1])
  print(cfg.speed)
  printStr(cfg.name)
  printStr(title)
  printNum(root)
  printNum(half)
  print(box.value())
  print(pt.sum())
  printStr(lbl)
  printStr(tag)
  printNum(bx)
  print(hp)
  print(after)
  print(flag)
  x = x + 1
  print(x)
}`;
const KINDS_OUT = ['> 5', '> 4', '> 1.5', '> 2', '> fast', '> level 5', '> 1.4142135623730951', '> 5', '> 7', '> 3', '> label 3', '> hello', '> 2.5', '> 7', '> 55', '> true', '> 6'];

// modules: util is imported by game.physics and main, game.physics by main → util, game.physics, main.
// a and b import each other (a cycle): file order — b.emit is listed before a.emit.
const MODS = join([
  ['main.emit', `import game.physics
import util
import a
let total = note("main", physics.speed * 2 + util.base + a.av)
export fn run() {
  print(total)
  printStr(util.tag)
}
fn note(s: str, v: int) int {
  printStr("init " + s)
  return v
}`],
  ['game/physics.emit', `package game
import util
public let speed = util.note("game.physics", util.base + 1)`],
  ['b.emit', `import a
public let bv = a.note("b", 2)`],
  ['a.emit', `import b
public let av = note("a", 1)
public fn note(s: str, v: int) int {
  printStr("init " + s)
  return v
}
fn unused() int { return b.bv }`],
  ['util.emit', `public let base = note("util", 10)
public let tag = "u" + toStr(base)
public fn note(s: str, v: int) int {
  printStr("init " + s)
  return v
}`],
]);

async function sectionValues(browser) {
  console.log('\n── 1. top-level values ──');
  const page = await newPage(browser);
  let r = await run(page, KINDS);
  check('every kind of initial value: call, arr, numarr, object literal, str +, builtin, typed num, interop fn, new, method, js from str, region reads, other globals', r.status === 'Done' && same(r.printed, KINDS_OUT) && !r.red.length, JSON.stringify({ status: r.status, printed: r.printed, red: r.red }));
  const ex = await compileOnly(page, KINDS);
  check('one exported __emitInit.<k> function per non-literal value, named with the variable and its position', same(ex.exports.filter(n => /^__emitInit/.test(n)).slice(0, 3), ['__emitInit.0 x 12:1', '__emitInit.1 prices 13:1', '__emitInit.2 weights 14:1']), JSON.stringify(ex.exports));
  check('the Results / Tap to call lists do not show the __emitInit functions', !r.lines.some(l => /__emitInit/.test(l)), r.lines.filter(l => /__emitInit/.test(l)).join(' | '));
  const lit = await compileOnly(page, 'mut a = 1\nlet s = "x"\nmut n = -2.5 * 2\nexport fn run() {\n  print(a)\n}\n');
  check('a program with only literal initial values has no __emitInit export', same(lit.exports, ['run']), JSON.stringify(lit.exports));


  r = await run(page, MODS);
  check('modules: a module\'s values are set after those of the modules it imports; an import cycle keeps file order', r.status === 'Done' && same(r.printed, ['> init util', '> init game.physics', '> init b', '> init a', '> init main', '> 33', '> u10']), JSON.stringify({ status: r.status, printed: r.printed, red: r.red }));

  // once per instance: Run, Tap to call, frames, buttons and timers all see the values set once
  r = await run(page, `mut inits = 0
fn count() int {
  inits = inits + 1
  return now()
}
let started = count()
mut frames = 0
export fn run() {
  button("go", 1)
  setTimer(20, 1)
}
export fn onclick_1() {
  printStr("click " + toStr(inits))
}
export fn ontimer_1() {
  printStr("timer " + toStr(inits))
}
export fn frame() {
  frames = frames + 1
}
export fn report() int {
  return inits
}`, 150);
  const once = await page.evaluate(() => {
    for (let i = 0; i < 5; i++) _emitFrame();
    document.querySelector('#tab-output button').click();
    return [Number(_emitCallExport(window._wi, 'report', [])), Number(_emitCallExport(window._wi, 'frames' in window._wi.exports ? 'report' : 'report', []))];
  });
  await page.waitForTimeout(80);
  const after = await page.evaluate(() => document.getElementById('tab-output').innerText.split('\n').map(l => l.trim()).filter(l => /^> /.test(l)));
  check('the initialiser runs exactly once per instance (Run, frames, a button, a timer, direct calls)', same(once, [1, 1]) && after.includes('> click 1') && after.includes('> timer 1'), JSON.stringify({ once, after }));

  // an instance made outside the IDE's Run: the first _emitCallExport runs the initialisers first
  const host = await page.evaluate(async () => {
    const r = compile('let s = "v" + toStr(41 + 1)\nexport fn get() str {\n  return s\n}\n', 'wasm32');
    const inst = await WebAssembly.instantiate(await WebAssembly.compile(r.wasm), buildImportObject(r.imports, []));
    _wasmMem = inst.exports.memory;
    const p = _emitCallExport(inst, 'get', []);
    return _readStr(p);
  });
  check('_emitCallExport on a fresh instance runs its initialisers before the first export', host === 'v42', host);

  // errors at start-up: a red line naming the variable and its position; nothing else runs
  r = await run(page, 'fn f() int {\n  return 5\n}\nmut x = f()\nlet bad = fakeLib.boom()\nexport fn run() {\n  printStr("ran")\n}\n');
  check('a JS exception in an initialiser: red line with position and name, the Run stops (no Results, run() not called)', r.status === 'Error' && same(r.red, ["✗ 5:1: Top-level 'bad' could not be set — jsCall .boom(): kaboom"]) && !r.printed.length && !r.lines.some(l => /Results|Tap to call/.test(l)), JSON.stringify(r.lines));
  const errHtml = await page.evaluate(() => document.querySelector('#tab-output .clickable-err') ? document.querySelector('#tab-output .clickable-err').getAttribute('onclick') : null);
  check('the start-up error line is clickable (jumps to the line)', errHtml === 'jumpToLine(5)', errHtml);
  const stopped = await page.evaluate(() => window._wi === null);
  check('after a failed start-up no instance is published (frames / buttons do not run)', stopped, stopped);
  r = await run(page, 'region grid: int[8]\nlet i = 9\nlet g = grid[i]\nexport fn run() {\n  print(g)\n}\n');
  check('a region bounds error in an initialiser', r.status === 'Error' && same(r.red, ["✗ 3:1: Top-level 'g' could not be set — grid[9]: index out of range (length 8) at main.emit:3:9"]) && !r.printed.length, JSON.stringify(r.lines));
  r = await run(page, 'fn check(n: int) int {\n  if (n > 2) {\n    throw "too big: " + toStr(n)\n  }\n  return n\n}\nlet a = check(1)\nlet b = check(3)\nexport fn run() {\n  print(a)\n}\n');
  check('a throw in a function called by an initialiser', r.status === 'Error' && same(r.red, ["✗ 8:1: Top-level 'b' could not be set — too big: 3"]), JSON.stringify(r.lines));
  r = await run(page, join([['main.emit', 'import b\nexport fn run() {\n  print(b.x)\n}'], ['b.emit', '// one\npublic let x = fakeLib.boom()']]));
  check('an initialiser error in another file names that file', r.status === 'Error' && same(r.red, ["✗ b.emit:2:1: Top-level 'x' could not be set — jsCall .boom(): kaboom"]), JSON.stringify(r.lines));
  r = await run(page, 'let n = 2\nlet v = 10 / (n - 2)\nexport fn run() {\n  print(v)\n}\n');
  check('a WebAssembly trap in an initialiser (integer divide by zero)', r.status === 'Error' && r.red.length === 1 && /^✗ 2:1: Top-level 'v' could not be set — /.test(r.red[0]), JSON.stringify(r.lines));

  // compile errors
  const errs = [
    ['let a = b + 1\nlet b = sqrt(4.0)\nexport fn run() {\n}\n', "1:9: Top-level 'a' uses 'b', which is set later (at 2:1) — top-level values are set in order: move 'b' above 'a'"],
    ['let a = a + 1\nexport fn run() {\n}\n', "1:9: Top-level 'a' uses itself in its own initial value"],
    ['let p = await fakeLib.fetchUser(1)\nexport fn run() {\n}\n', "1:9: await cannot be used in the top-level value 'p' — top-level values are set before the program starts, where nothing can wait: use it inside a function"],
    ['fn load() js {\n  return await fakeLib.fetchUser(1)\n}\nlet p = load()\nexport fn run() {\n}\n', "4:9: Top-level 'p' calls load(), which waits (await) — top-level values are set before the program starts, where nothing can wait: call it inside a function"],
    ['fn nothing() {\n}\nlet v = nothing()\nexport fn run() {\n}\n', "3:9: Top-level 'v' — this call returns nothing, so there is no value to start with"],
    [join([['main.emit', 'import b\nexport fn run() {\n  print(b.started)\n}'], ['b.emit', '// one\npublic mut started = await now()']]), "b.emit:2:22: await cannot be used in the top-level value 'started' — top-level values are set before the program starts, where nothing can wait: use it inside a function"],
  ];
  for (const [src, msg] of errs) {
    const c = await compileOnly(page, src);
    check('compile error: ' + msg.slice(0, 70), c.thrown === msg, JSON.stringify(c));
  }
  const letErr = await compileOnly(page, 'let z = 1\nlet y = toStr(3)\nexport fn run() {\n  z = 2\n  y = "q"\n  let y = 5\n  y = 6\n}\n');
  check('a top-level let stays immutable (literal or not): assigning it is a compile error, a local of the same name is not', same(letErr.errors, ["4:3: 'z' is declared with let, so it cannot be changed — declare it with mut to assign it", "5:3: 'y' is declared with let, so it cannot be changed — declare it with mut to assign it"]), JSON.stringify(letErr));
  const typed = await compileOnly(page, 'fn f() str {\n  return "s"\n}\nlet n: int = f()\nexport fn run() {\n}\n');
  check('a typed initial value of the wrong type is a checker error', same(typed.errors, ['4:1: Cannot assign str to int']) || same(typed.errors, ['4:14: Cannot assign str to int']), JSON.stringify(typed));
  check('no page errors (values)', !page.errors.length, page.errors.join(' | '));
  await page.close();
}

// ═══ exports (.html, .js, offline .html) ═══
async function sectionExport(browser) {
  console.log('\n── 1b. exported pages ──');
  const page = await newPage(browser);
  const progs = {
    good: 'let title = "level " + toStr(2 + 3)\nlet prices = [3, 4, 5]\nlet box = makeBox(9)\nexport fn main() {\n  printStr(title)\n  print(prices[2])\n  print(box.value())\n}\n',
    bad: 'let ok = sqrt(4.0)\nlet bad = fakeLib.boom()\nexport fn main() {\n  printStr("ran")\n}\n',
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emit-rough-'));
  for (const [name, src] of Object.entries(progs)) {
    await run(page, src);
    const files = await page.evaluate(async () => {
      const got = {};
      window._download = (n, c) => { got[n] = typeof c === 'string' ? c : null; };
      window.alert = m => { got.alert = String(m); };
      for (const f of ['html', 'js', 'htmloff']) { try { await doExport(f); got['ok ' + f] = true; } catch (e) { got['err ' + f] = e.message; } }
      return got;
    });
    const html = files['program.html'], js = files['program.js'];
    if (!html || !js) { check('exports of ' + name, false, Object.keys(files).join(', ')); continue; }
    async function view(label, url, serve) {
      const pg = await browser.newPage();
      const errs = [];
      pg.on('pageerror', e => errs.push(e.message));
      await pg.route(/^https?:/, r => (serve && serve(r)) || r.abort());
      await pg.addInitScript(FAKE_LIB);
      await pg.goto(url);
      await pg.waitForTimeout(400);
      const lines = await pg.evaluate(() => { const o = document.getElementById('tab-output'); return o ? o.innerText.split('\n').map(l => l.trim()).filter(Boolean) : []; });
      await pg.close();
      return { lines, errs };
    }
    const f1 = path.join(dir, name + '.html'); fs.writeFileSync(f1, html);
    const vh = await view('html', 'file://' + f1);
    const offName = Object.keys(files).find(k => /offline/.test(k) && /\.html$/.test(k)) || null;
    let vo = null;
    if (offName && files[offName]) { const f2 = path.join(dir, name + '-off.html'); fs.writeFileSync(f2, files[offName]); vo = await view('offline', 'file://' + f2); }
    const host = '<!DOCTYPE html><html><body><div id="app"></div><script type="module">import init from "./program.js"; init({ target: document.getElementById("app") }).catch(e => { window.__initErr = e.message; });</script></body></html>';
    const vj = await view('js', 'http://export.test/index.html', r => {
      const u = r.request().url();
      if (/index\.html$/.test(u)) { r.fulfill({ contentType: 'text/html', body: host }); return true; }
      if (/program\.js$/.test(u)) { r.fulfill({ contentType: 'text/javascript', body: js }); return true; }
      return false;
    });
    if (name === 'good') {
      const wantL = ['level 5', '5', '9'];
      check('.html export: the initial values are set before main()', same(vh.lines, wantL) && !vh.errs.length, JSON.stringify(vh));
      check('.js export: the initial values are set before main()', same(vj.lines, wantL), JSON.stringify(vj));
      check('offline .html export: the initial values are set before main()', vo && same(vo.lines, wantL), JSON.stringify(vo) + ' ' + Object.keys(files).join(','));
    } else {
      const wantE = ["✗ 2:1: Top-level 'bad' could not be set — jsCall .boom(): kaboom"];
      check('.html export: a failing initialiser shows the red line and nothing runs', same(vh.lines, wantE), JSON.stringify(vh));
      check('.js export: a failing initialiser shows the red line and nothing runs', same(vj.lines, wantE), JSON.stringify(vj));
    }
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  await page.close();
}

// ═══ memory: values held only by globals survive collections ═══
async function sectionMemory(browser) {
  console.log('\n── 1c. collector keeps values held by globals ──');
  const page = await newPage(browser);
  const r = await run(page, `fn mk(n: int) str {
  return "item " + toStr(n)
}
let label = mk(7)
let nums = [1, 2, 3]
let box = makeBox(42)
let items = fakeLib.list(4)
mut churn = 0
export fn run() {
  animate()
}
export fn frame() {
  let i = 0
  while (i < 20) {
    let s = "junk " + toStr(i) + toStr(churn)
    let a = [i, i + 1, i + 2]
    let o = makeBox(i)
    churn = churn + strLen(s) - strLen(s) + a.length - 3 + o.v - i + 1
    i = i + 1
  }
}
export fn check() {
  printStr(label)
  print(nums[2])
  print(box.value())
  print(items[3])
  print(churn)
}`, 150);
  const frames = 3000;
  const res = await page.evaluate(async n => {
    const g0 = _gcRuns;
    for (let i = 0; i < n; i++) _emitFrame();
    await new Promise(ok => setTimeout(ok, 20));
    _emitCallExport(window._wi, 'check', []);
    return { runs: _gcRuns - g0, handles: _handles.size };
  }, frames);
  const lines = await page.evaluate(() => document.getElementById('tab-output').innerText.split('\n').map(l => l.trim()).filter(l => /^> |^✗/.test(l)));
  check('after ' + frames + ' frames of churn the str / arr / js values set by initialisers read back (collections ran: ' + res.runs + ', live handles ' + res.handles + ')',
    r.status === 'Done' && res.runs > 0 && same(lines.slice(-5), ['> item 7', '> 3', '> 42', '> 30', '> ' + frames * 20]), JSON.stringify({ status: r.status, res, lines }));
  check('the churn is released (live handles stay small)', res.handles < 200, res.handles);
  check('no page errors (memory)', !page.errors.length, page.errors.join(' | '));
  await page.close();
}

// ═══ 3. call arguments: print(num) and the builtin audit ═══
async function sectionAudit(browser) {
  console.log('\n── 3. call arguments ──');
  const page = await newPage(browser);
  const r = await run(page, `fn half(x: num) num {
  return x / 2.0
}
export fn run() {
  let x = 2.5
  print(x)
  print(half(5.0))
  print("s")
  print(true)
  print(3)
  printStr(5)
  printStr(x)
  printStr(false)
  printStr([1, 2])
  print(abs(-2.7))
  printNum(true)
  print(max(x, 9.9))
  rect(x, x, 4.9, 4)
}`);
  check('print(num) prints the num; print(str/bool) prints the text; builtin int ← num truncates, str ← int/num/bool/arr is the text', r.status === 'Done' && same(r.printed, ['> 2.5', '> 2.5', '> s', '> true', '> 3', '> 5', '> 2.5', '> false', '> 1,2', '> 2', '> 1', '> 9']), JSON.stringify(r.lines));
  const emitFnErrs = await page.evaluate(() => {
    const out = [];
    for (const [src] of [['fn f(n: int) int {\n  return n\n}\nexport fn run() {\n  let x = 2.5\n  print(f(x))\n}\n'], ['fn g(s: str) {\n}\nexport fn run() {\n  g(true)\n}\n'], ['fn h() {\n}\nexport fn run() {\n  print(h())\n}\n']]) {
      try { compile(src, 'wasm32'); out.push('compiled'); } catch (e) { out.push(e.message); }
    }
    return out;
  });
  check('Emit functions: an argument that does not fit its parameter is a compile error naming the function and parameter', same(emitFnErrs, ['6:11: f(): parameter n is int, but this is num — round it first, e.g. floor(x)', '4:5: g(): parameter s is str, but this is bool — make it text first, e.g. "" + x', '4:9: print(): this argument is a call that returns nothing — there is no value to pass as x']), JSON.stringify(emitFnErrs));

  const audit = await page.evaluate(() => {
    const LOC = { int: 'vi', num: 'vn', bool: 'vb', str: 'vs', js: 'vj', arr: 'va' };
    const LIT = { int: '3', num: '2.5', bool: 'true', str: '"s"', js: 'emptyObj()', arr: '[1, 2]' };
    const nat = t => ({ int: 'vi', i64: 'vi', i32: 'vi', num: 'vn', f64: 'vn', f32: 'vn', bool: 'vb', str: 'vs', js: 'vj', arr: 'va', numarr: 'va' })[t] || 'vi';
    const pre = '  let vi = 3\n  let vn = 2.5\n  let vb = true\n  let vs = "s"\n  let vj = emptyObj()\n  let va = [1, 2]\n';
    const rows = [];
    function one(name, label, call, use) {
      const src = 'export fn run() {\n' + pre + (use ? '  let r = ' : '  ') + call + '\n' + (use ? '  let q = r\n' : '') + '}\n';
      let k, msg = '';
      try {
        const r = compile(src, 'wasm32');
        if (r.errors.length) { k = 'error'; msg = r.errors[0]; }
        else if (WebAssembly.validate(r.wasm)) k = 'valid';
        else { k = 'INVALID'; try { new WebAssembly.Module(r.wasm); } catch (e) { msg = e.message; } }
      } catch (e) { k = 'error'; msg = e.message; }
      rows.push({ name, label, k, msg });
    }
    for (const name of Object.keys(BUILTINS).sort()) {
      const P = BUILTINS[name].params, rt = BUILTINS[name].returnType;
      one(name, 'natural' + (rt !== 'void' ? ' (result used)' : ''), name + '(' + P.map(q => nat(q.type)).join(', ') + ')', rt !== 'void');
      for (let i = 0; i < P.length; i++) for (const T of Object.keys(LOC)) for (const [form, V] of [['local', LOC], ['literal', LIT]]) {
        one(name, 'arg ' + i + ' (' + P[i].name + ': ' + P[i].type + ') ← ' + T + ' ' + form, name + '(' + P.map((q, j) => j === i ? V[T] : nat(q.type)).join(', ') + ')', false);
      }
    }
    // Emit functions with every parameter type, called with every argument type
    for (const pt of ['int', 'num', 'bool', 'str', 'js', 'arr']) for (const T of Object.keys(LOC)) {
      const src = 'fn f(p: ' + pt + ') {\n}\nexport fn run() {\n' + pre + '  f(' + LOC[T] + ')\n}\n';
      let k, msg = '';
      try { const r = compile(src, 'wasm32'); if (r.errors.length) { k = 'error'; msg = r.errors[0]; } else if (WebAssembly.validate(r.wasm)) k = 'valid'; else k = 'INVALID'; } catch (e) { k = 'error'; msg = e.message; }
      rows.push({ name: 'fn f(p: ' + pt + ')', label: '← ' + T, k, msg });
    }
    return { rows, n: Object.keys(BUILTINS).length };
  });
  const by = {}; audit.rows.forEach(x => { by[x.k] = (by[x.k] || 0) + 1; });
  const unreadable = audit.rows.filter(x => x.k === 'error' && !/^\d+:\d+: \S/.test(x.msg));
  console.log('      builtin audit: ' + audit.n + ' builtins, ' + audit.rows.length + ' programs — ' + Object.entries(by).map(([k, v]) => v + ' ' + k).join(', '));
  const perName = {};
  audit.rows.forEach(x => { const p = perName[x.name] || (perName[x.name] = { valid: 0, error: 0, INVALID: 0 }); p[x.k]++; });
  if (process.env.VERBOSE) Object.entries(perName).forEach(([n, p]) => console.log('      ' + n.padEnd(16) + ' valid ' + String(p.valid).padStart(3) + '  compile error ' + String(p.error).padStart(3) + '  INVALID ' + p.INVALID));
  const bad = audit.rows.filter(x => x.k === 'INVALID');
  check('builtin audit: no program compiles to invalid WebAssembly', !bad.length, bad.slice(0, 12).map(x => x.name + ' ' + x.label + ': ' + x.msg.slice(0, 80)).join('\n      '));
  check('builtin audit: every rejected program has a readable compile error with a position', !unreadable.length, unreadable.slice(0, 5).map(x => x.name + ' ' + x.label + ': ' + x.msg).join('\n      '));
  check('builtin audit: every builtin compiles with arguments of its declared types', !audit.rows.some(x => /^natural/.test(x.label) && x.k !== 'valid'), audit.rows.filter(x => /^natural/.test(x.label) && x.k !== 'valid').map(x => x.name + ': ' + x.msg).join(' | '));
  check('no page errors (audit)', !page.errors.length, page.errors.join(' | '));
  await page.close();
}

// ═══ 3b. every declared type × global / local / parameter × read, assignment from every type, arithmetic,
//     comparison, print / printNum / printStr, return — valid WebAssembly or a readable compile error ═══
function typeAuditPrograms() {
  const TYPES = ['i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'int', 'f32', 'num', 'bool', 'str', 'js', 'arr', 'numarr'];
  const INIT = { i8: '5', u8: '5', i16: '5', u16: '5', i32: '5', u32: '5', int: '5', f32: '1.5', num: '1.5', bool: 'true', str: '"s"', js: 'null', arr: '[1, 2]', numarr: '[1.5, 2.5]' };
  const SRC = { int: ['si', '3'], num: ['sn', '2.5'], bool: ['sb', 'false'], str: ['ss', '"t"'], js: ['sj', 'emptyObj()'], arr: ['sa', '[3, 4]'], null: [null, 'null'] };
  const PRE = '  let si = 3\n  let sn = 2.5\n  let sb = false\n  let ss = "t"\n  let sj = emptyObj()\n  let sa = [3, 4]\n';
  const ops = [['init si', 'mut w: T = si'], ['init sn', 'mut w: T = sn'], ['init sb', 'mut w: T = sb'], ['init ss', 'mut w: T = ss'], ['init sj', 'mut w: T = sj'], ['init null', 'mut w: T = null'], ['read', 'let r = v\n  let q = r'], ['self', 'v = v'], ['print', 'print(v)'], ['printNum', 'printNum(v)'], ['printStr', 'printStr(v)'], ['ret', null], ['inc', 'v++'], ['neg', 'let r = -v'], ['not', 'let r = !v']];
  for (const [s, [loc, lit]] of Object.entries(SRC)) for (const [form, x] of [['local', loc], ['literal', lit]]) {
    if (!x) continue;
    const tag = s + '.' + form;
    ops.push(['assign ' + tag, 'v = ' + x], ['add ' + tag, 'let r = v + ' + x], ['sub ' + tag, 'let r = v - ' + x], ['mul ' + tag, 'let r = v * ' + x], ['div ' + tag, 'let r = v / ' + x],
      ['mod ' + tag, 'let r = v % ' + x], ['eq ' + tag, 'let r = v == ' + x], ['lt ' + tag, 'let r = v < ' + x], ['compound ' + tag, 'v += ' + x], ['radd ' + tag, 'let r = ' + x + ' + v']);
  }
  const rows = [];
  for (const T of TYPES) for (const ctx of ['global', 'local', 'param']) for (const [op, code] of ops) {
    let src;
    if (op === 'ret') {
      src = (ctx === 'global' ? 'mut v: ' + T + ' = ' + INIT[T] + '\n' : '') + 'fn f(' + (ctx === 'param' ? 'v: ' + T : '') + ') -> ' + T + ' {\n' + (ctx === 'local' ? '  mut v: ' + T + ' = ' + INIT[T] + '\n' : '') + '  return v\n}\nexport fn run() {\n}\n';
    } else {
      const code2 = code.replace(/: T /g, ': ' + T + ' ');
      const decl = ctx === 'local' ? '  mut v: ' + T + ' = ' + INIT[T] + '\n' : '';
      src = (ctx === 'global' ? 'mut v: ' + T + ' = ' + INIT[T] + '\n' : '') + 'fn f(' + (ctx === 'param' ? 'v: ' + T : '') + ') {\n' + PRE + decl + '  ' + code2 + '\n}\nexport fn run() {\n}\n';
    }
    rows.push({ T, ctx, op, src });
  }
  return rows;
}
async function sectionTypes(browser) {
  console.log('\n── 3b. declared types and operators ──');
  const page = await newPage(browser);
  const rows = typeAuditPrograms();
  const res = await page.evaluate(rows => rows.map(r => {
    let k, msg = '';
    try { const c = compile(r.src, 'wasm32'); if (c.errors.length) { k = 'error'; msg = c.errors[0]; } else if (WebAssembly.validate(c.wasm)) k = 'valid'; else { k = 'INVALID'; try { new WebAssembly.Module(c.wasm); } catch (e) { msg = e.message; } } }
    catch (e) { k = 'error'; msg = e.message; }
    return { T: r.T, ctx: r.ctx, op: r.op, k, msg };
  }), rows);
  const tab = {};
  res.forEach(r => { const t = tab[r.T] || (tab[r.T] = { valid: 0, error: 0, INVALID: 0 }); t[r.k]++; });
  console.log('      type audit: ' + res.length + ' programs (14 types × global/local/param × ' + (res.length / 42) + ' uses)');
  Object.entries(tab).forEach(([t, c]) => console.log('      ' + t.padEnd(7) + ' valid ' + String(c.valid).padStart(4) + '  compile error ' + String(c.error).padStart(4) + '  INVALID ' + c.INVALID));
  const bad = res.filter(r => r.k === 'INVALID');
  check('type audit: no program compiles to invalid WebAssembly', !bad.length, bad.slice(0, 12).map(r => r.T + ' ' + r.ctx + ' ' + r.op + ': ' + r.msg.slice(0, 80)).join('\n      '));
  const unreadable = res.filter(r => r.k === 'error' && !/^\d+:\d+: \S/.test(r.msg));
  check('type audit: every rejected program has a readable compile error with a position', !unreadable.length, unreadable.slice(0, 5).map(r => r.T + ' ' + r.ctx + ' ' + r.op + ': ' + r.msg).join('\n      '));
  const must = (T, ctx, op) => (res.find(r => r.T === T && r.ctx === ctx && r.op === op) || {}).k;
  const basics = [];
  for (const T of ['int', 'num', 'bool', 'str', 'js', 'arr', 'numarr']) for (const ctx of ['global', 'local', 'param']) for (const op of ['read', 'self', 'printStr', 'ret', 'eq ' + (T === 'numarr' ? 'arr' : T === 'arr' ? 'arr' : T) + '.local']) if (must(T, ctx, op) !== 'valid') basics.push(T + ' ' + ctx + ' ' + op + ': ' + must(T, ctx, op));
  for (const ctx of ['global', 'local', 'param']) for (const op of ['add int.local', 'add num.literal', 'mul int.literal', 'lt num.local', 'compound int.literal', 'assign int.local', 'print', 'printNum']) if (must('num', ctx, op) !== 'valid') basics.push('num ' + ctx + ' ' + op + ': ' + must('num', ctx, op));
  for (const ctx of ['global', 'local', 'param']) for (const op of ['add int.local', 'mod int.literal', 'assign null.literal', 'compound int.literal', 'inc', 'print', 'printNum']) if (must('int', ctx, op) !== 'valid') basics.push('int ' + ctx + ' ' + op + ': ' + must('int', ctx, op));
  check('type audit: ordinary uses of int / num / bool / str / js / arr / numarr compile (read, assign, +, %, <, ==, print, return…)', !basics.length, basics.join(' | '));
  const store = res.filter(r => /^(i8|u8|i16|u16|i32|u32|f32)$/.test(r.T) && !(r.k === 'error' && / is declared as (i8|u8|i16|u16|i32|u32|f32) — /.test(r.msg) || r.k === 'error' && /Expected LBRACE/.test(r.msg)));
  check('a variable / parameter / result declared i8 u8 i16 u16 i32 u32 or f32 is a compile error saying they are storage types', !store.length, store.slice(0, 5).map(r => r.T + ' ' + r.ctx + ' ' + r.op + ': ' + r.k + ' ' + r.msg).join(' | '));
  const reported = await page.evaluate(() => [['mut g: i32 = 5\nexport fn run() {\n  g = g + 1\n}\n'], ['mut f: f32 = 1.5\nexport fn run() {\n  f = f + 1.0\n  let d = f * 2.0\n}\n']].map(([s]) => { try { compile(s, 'wasm32'); return 'compiled'; } catch (e) { return e.message; } }));
  check('the two reported programs (an i32 global, arithmetic on an f32 global) are compile errors, not invalid WebAssembly', /^1:1: 'g' is declared as i32 — /.test(reported[0]) && /^1:1: 'f' is declared as f32 — /.test(reported[1]), JSON.stringify(reported));
  const conv = await run(page, 'fn f(b: bool) num {\n  mut n = 1.5\n  n = 2\n  mut x: js = emptyObj()\n  x = null\n  mut k = 3\n  k = null\n  let m: num = b\n  return n + m\n}\nexport fn run() {\n  printNum(f(true))\n}\n');
  check('assignments that used to be invalid WebAssembly now convert: num ← int, js / int ← null, num ← bool', conv.status === 'Done' && same(conv.printed, ['> 3']), JSON.stringify(conv.lines));
  check('no page errors (types)', !page.errors.length, page.errors.join(' | '));
  await page.close();
}

// ═══ 2. things and rules across files ═══
const T_HELPERS = `
window.T = {
  step(n) { for (let i = 0; i < (n || 1); i++) _emitFrame(); },
  id(r) { const R = _emitRegions().find(x => x.name === r); if (!R) throw new Error('no region ' + r); return R.id; },
  get(r, i, f) { return _emitRegionRead(T.id(r), i, f); },
  alive(r) { const R = _emitRegions().find(x => x.name === r); let c = 0; for (let i = 0; i < R.length; i++) if (T.get(r, i, 'alive')) c++; return c; },
  xy(r, i) { return [Math.round(T.get(r, i, 'x') * 100) / 100, Math.round(T.get(r, i, 'y') * 100) / 100]; },
};`;
const GAME = join([
  ['main.emit', `import heroes.hello
export fn run() {
  printStr("start")
}
export fn getA() int {
  return order
}
export fn getScore() int {
  return score
}
export fn heroHp() num {
  return hero[0].hp
}
rules:
  stage size 320 240
  on start: set score 0 : set order 1 : call hello
  on hit hero coin: remove coin : add score 1
  every frame: hero mv 2, 0`],
  ['heroes.emit', `public fn hello() {
  printStr("hello from heroes")
}
thing hero: box 8 8, at 10 10, hp 3`],
  ['coins.emit', `thing coin: circ 4, count 3, at 30 + i * 20 10
rules:
  stage size 320 240
  on start: set order 2
  every frame: set hero.hp hero.hp + 0
  when count(coin) == 0: say "all" : stop`],
]);
async function sectionThings(browser) {
  console.log('\n── 2. things and rules in several files ──');
  const page = await newPage(browser);
  await page.evaluate(T_HELPERS);
  let r = await run(page, GAME, 250);
  check('a game spread over three files compiles and starts (a rules block may call a function imported in its file)', r.status === 'Done' && r.printed.includes('> start') && r.printed.includes('> hello from heroes') && !r.red.length, JSON.stringify(r.lines));
  const g = await page.evaluate(() => { _animRunning = false; const before = [T.xy('hero', 0), T.alive('coin')]; T.step(40); return { before, after: [T.xy('hero', 0), T.alive('coin')], score: Number(_emitCallExport(window._wi, 'getScore', [])), order: Number(_emitCallExport(window._wi, 'getA', [])), hp: Number(_emitCallExport(window._wi, 'heroHp', [])), say: typeof _lgSay === 'string' ? _lgSay : null, regions: _emitRegions().filter(x => /hero|coin/.test(x.name)).map(x => [x.name, x.module, x.path]) }; });
  check('the rules of both files act on the things of all three files (hero moves, coins collected, score, say)', g.before[1] === 3 && g.after[1] === 0 && g.score === 3 && g.hp === 3 && g.say === 'all', JSON.stringify(g));
  check('rules blocks run in file order: on start of main.emit, then of coins.emit', g.order === 2, g.order);
  check('a kind\'s struct / region belong to the file of its thing block (Memory tab)', same(g.regions, [['hero', 'heroes', 'heroes.emit'], ['coin', 'coins', 'coins.emit']]), JSON.stringify(g.regions));
  const link = await page.evaluate(() => { const R = _emitRegions().find(x => x.name === 'coin'); const L = window._memtabToolLink ? window._memtabToolLink(R) : null; return L ? L.label : null; });
  check('the Memory tab offers LOGIC › for a thing of another file', link === 'LOGIC ›', link);

  // errors with positions in the right file
  const E = [
    [join([['main.emit', 'export fn run() {}\nthing hero: box 4 4'], ['b.emit', '// b\nthing hero: box 4 4\nrules:\n  every frame: hero mv 1, 0']]), 'b.emit:2:7: thing hero is already declared at line 2 of main.emit'],
    [join([['main.emit', 'export fn run() {}\nthing hero: box 4 4'], ['b.emit', '// b\nrules:\n  on hit hero cion: stop']]), 'b.emit:3:15: Unknown thing "cion" in on hit (or wall: a solid map tile / wall thing, edge: the screen edge) — the things are: hero'],
    [join([['main.emit', 'export fn run() {}\nthing hero: box 4 4\nrules:\n  stage size 320 240'], ['b.emit', '\nrules:\n  stage size 400 300']]), 'b.emit:3:3: stage size 400 300 contradicts stage size 320 240 at main.emit:4:3 — a project has one stage: make the two the same or remove one'],
    [join([['main.emit', 'export fn run() {}\nthing hero: box 4 4\nrules:\n  stage color #000000'], ['b.emit', 'rules:\n  stage color white\n  seed 1'], ['c.emit', 'rules:\n  seed 2']]), ['b.emit:2:3: stage color white contradicts stage color #000000 at main.emit:4:3 — a project has one stage: make the two the same or remove one', 'c.emit:2:3: seed 2 contradicts seed 1 at b.emit:3:3 — a project has one seed: make the two the same or remove one']],
    [join([['main.emit', 'export fn run() {}\nthing hero: box 4 4'], ['b.emit', 'rules:\n  on start: set a 1\nrules:\n  on start: set b 1']]), 'b.emit:3:1: A file has one rules: block — put these rules into the rules: block at line 1'],
    [join([['main.emit', 'export fn run() {}\nrules:\n  every frame: hero mv 1, 0'], ['b.emit', '// b\n// c\nthing hero: box 4 4, count n']]), null],
  ];
  const errs = await page.evaluate(list => list.map(([src]) => { try { const r = compile(src, 'wasm32'); return r.errors; } catch (e) { return ['THROWN ' + e.message]; } }), E);
  E.forEach(([, msg], i) => {
    if (Array.isArray(msg)) check('errors across files: ' + msg[0].slice(0, 70) + ' (and the seed)', same(errs[i], msg), JSON.stringify(errs[i]));
    else if (msg) check('error across files: ' + msg.slice(0, 80), errs[i].length === 1 && (errs[i][0] === msg || errs[i][0] === 'THROWN ' + msg), JSON.stringify(errs[i]));
    else check('error in a thing of a non-entry file has that file\'s position', errs[i].length === 1 && /^(THROWN )?b\.emit:3:\d+: /.test(errs[i][0]), JSON.stringify(errs[i]));
  });
  const sameStage = await page.evaluate(src => { try { return compile(src, 'wasm32').errors; } catch (e) { return [e.message]; } }, join([['main.emit', 'export fn run() {}\nthing hero: box 4 4\nrules:\n  stage size 320 240'], ['b.emit', 'rules:\n  stage size 320 240\n  every frame: hero mv 1, 0']]));
  check('the same stage setting in two files is fine', same(sameStage, []), JSON.stringify(sameStage));
  // private names of the block's own file; an auto variable shared by all rules blocks
  r = await run(page, join([['main.emit', 'import lvl\nexport fn run() {\n}\nexport fn total() int {\n  return lvl.peek() + hits\n}\nthing hero: box 4 4, at 0 0\nrules:\n  every frame: add hits 1'], ['lvl.emit', 'mut bonus = 5\nfn bump() {\n  bonus = bonus + 10\n}\npublic fn peek() int {\n  return bonus\n}\nthing gem: box 2 2, at 100 100\nrules:\n  on start: call bump : add hits 100\n  every frame: add bonus 1']]), 200);
  const t = await page.evaluate(() => { _animRunning = false; const a = Number(_emitCallExport(window._wi, 'total', [])); T.step(3); return [a, Number(_emitCallExport(window._wi, 'total', []))]; });
  check('a rules block uses the private names of its own file; an undeclared name is one auto variable for all files', r.status === 'Done' && t[1] - t[0] === 6, JSON.stringify({ t, lines: r.lines }));

  // single-file programs are lowered as before (same generated text)
  const lone = await page.evaluate(() => { compile('thing hero: box 4 4, at 1 1\nrules:\n  every frame: hero mv 1, 0\n', 'wasm32'); return _lgLower.lastSource.length > 100; });
  check('a project whose blocks are in one file is lowered while parsing, as before', lone, lone);
  check('no page errors (things)', !page.errors.length, page.errors.join(' | '));
  await page.close();

  // ── the LOGIC tool with blocks in several files ──
  const lp = await newPage(browser);
  await lp.evaluate(`window.__openTool = function (id) { _drawerEnsure(); _drawerTool(_drawerFind(id)); };`);
  await lp.evaluate(s => _projLoad(s), GAME);
  await lp.evaluate(() => __openTool('logic'));
  await lp.waitForTimeout(500);
  const st = await lp.evaluate(() => ({ things: _lgTool.state.things.map(t => t.name), rules: _lgTool.state.rules.filter(r => r.type !== 'blank').length, status: document.querySelector('.lg-status').textContent }));
  check('LOGIC lists the things of every file and validates the project (✓ compiles)', same(st.things, ['hero', 'coin']) && /✓ compiles/.test(st.status), JSON.stringify(st));
  await lp.evaluate(() => { const T = _lgTool.state.things.find(t => t.name === 'coin'); T.name = 'gem'; T.dirty = true; _lgTool.state.rules.forEach(r => { if (r.type === 'rule') r.text = r.text; }); _lgTool.save(); });
  await lp.waitForTimeout(300);
  const files = await lp.evaluate(() => _proj.files.map(f => [f.path, /^thing gem:/m.test(f.source), /^thing coin:/m.test(f.source), /^thing hero:/m.test(f.source)]));
  check('LOGIC: a renamed thing stays in its own file; the other things stay where they are', same(files, [['main.emit', false, false, false], ['heroes.emit', false, false, true], ['coins.emit', true, false, false]]), JSON.stringify(files));
  await lp.evaluate(() => { _lgTool.state.tab = 'rules'; _lgTool.render(); });
  const hint = await lp.evaluate(() => (document.querySelector('.lg-more-rules') || {}).textContent || '');
  check('LOGIC RULES tab names the rules blocks of the other files', /coins\.emit/.test(hint), hint);
  check('no page errors (LOGIC)', !lp.errors.length, lp.errors.join(' | '));
  await lp.close();
}

// ═══ 4. help ═══
async function sectionHelp(browser) {
  console.log('\n── 4. help ──');
  const html = fs.readFileSync(FILE, 'utf8');
  check('help: a "Top-level values" paragraph', /<h[234][^>]*>Top-level values<\/h[234]>/.test(html) && /set once, in order, before/.test(html), '');
  check('help: things and rules in several files', /rules: blocks in several files/.test(html), '');
  check('help: the old "must start with a literal" sentence is gone', !/A top-level variable must start with a literal/.test(html), '');
}

(async () => {
  const browser = await chromium.launch();
  if (want('values')) await sectionValues(browser);
  if (want('export')) await sectionExport(browser);
  if (want('memory')) await sectionMemory(browser);
  if (want('audit')) await sectionAudit(browser);
  if (want('types')) await sectionTypes(browser);
  if (want('things')) await sectionThings(browser);
  if (want('help')) await sectionHelp(browser);
  await browser.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();

#!/usr/bin/env node
// Tests for apps in Pane: WebAssembly programs that run in a worker of their own.
// The programs are written in Emit and compiled here by the compiler inside emit-ide-1_32.html (opened
// headless; nothing is fetched), so what is tested is the real path: Emit source → .wasm → Pane.
// Part 1 drives the worker's inside (Pane.appCore) directly in Node. Part 2 runs pages in pane.html:
// drawing, keys and pointer, the game in pages/, and what must be refused or stopped — a program that
// never returns, one that imports what apps do not have, one that grabs memory, one from another site.
//
//   node tests/run-pane-app.js [--shots DIR]
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Pane = require('../pane.js');
const { compileEmit, openIde, paneFor } = require('../tools/emit-to-pane.js');

const args = process.argv.slice(2);
const shotsAt = args.indexOf('--shots');
const shots = shotsAt >= 0 ? args.splice(shotsAt, 2)[1] : null;
const file = path.join(__dirname, '..', 'pane.html');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) pass++;
  else { fail++; console.log(`✗ ${name}${detail !== undefined ? '\n    ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600) : ''}`); }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const EMIT = {
  draw: `export fn main() {
  canvas(64, 48)
  color(255, 0, 0)
  rect(1, 2, 3, 4)
  alpha(0.5)
  lineWidth(2)
  strokeRect(5, 6, 7, 8)
  circle(10, 11, 12)
  line(1, 2, 3, 4)
  pixel(9, 9)
  text("n=" + 7, 2, 20, 10)
  print(42)
  printNum(1.5)
  printStr("hi " + intToStr(3) + numToStr(2.0))
  print(strLen("héllo"))
  print(charAt("abc", 1))
  print(floor(sqrt(81.0)) + round(2.6) + abs(0 - 5) + max(2, 9) + min(2, 9))
}`,
  count: `mut n: int = 0
mut list: int = 0
export fn main() {
  canvas(32, 32)
  list = newArray(3)
  setItem(list, 0, 10)
  push(list, 7)
  animate()
}
export fn frame() {
  n = n + 1
  setItem(list, 1, n)
  clear()
  color(0, 255, 0)
  rect(n, 0, 1, 1)
  text("frame " + n, 0, 10, 8)
  if (n == 3) {
    print(getItem(list, 0) + getItem(list, 1) + getItem(list, 3) + arrayLen(list))
  }
}`,
  keeper: `mut label: str = "start"
mut n: int = 0
export fn main() {
  animate()
}
export fn frame() {
  n = n + 1
  label = "kept " + n
  text(label + " and a temporary " + n, 0, 10, 8)
  if (n == 60000) {
    printStr(label)
  }
}`,
  input: `export fn main() {
  canvas(100, 50)
  animate()
}
export fn frame() {
  clear()
  color(0, 0, 0)
  rect(0, 0, 100, 50)
  if (keyDown(39) == 1) {
    color(255, 255, 255)
    rect(0, 0, 4, 4)
  }
  if (touching() == 1) {
    color(255, 0, 0)
  } else {
    color(0, 0, 255)
  }
  rect(touchX() - 2, touchY() - 2, 5, 5)
}`,
  hang: `mut n: int = 0
export fn main() {
  canvas(40, 30)
  color(0, 200, 0)
  rect(0, 0, 40, 30)
  animate()
}
export fn frame() {
  n = n + 1
  if (n > 3) {
    while (true) {
    }
  }
}`,
  hangAtStart: `export fn main() {
  while (true) {
  }
}`,
  flood: `mut n: int = 0
export fn main() {
  canvas(20, 20)
  animate()
}
export fn frame() {
  n = n + 1
  mut i: int = 0
  while (i < 100000) {
    rect(i, 0, 1, 1)
    i = i + 1
  }
  print(n)
}`,
  arrays: `export fn main() {
  mut i: int = 0
  while (i < 100) {
    let a = newArray(100000)
    i = i + 1
  }
}`,
  texts: `mut keep: int = 0
export fn main() {
  keep = newArray(0)
  mut i: int = 0
  mut s: str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  while (i < 20) {
    s = s + s
    i = i + 1
  }
}`,
  region: `region grid: u8[64]
mut at: int = 0
export fn main() {
  grid[1] = 5
  grid[63] = 7
  print(grid[1] + grid[63])
  printStr("text " + grid[1])
  animate()
}
export fn frame() {
  at = at + 40
  grid[at] = 1
  print(at)
}`,
  regionText: `struct Item { name: str, n: int }
region items: Item[8]
mut n: int = 0
export fn main() {
  for (let i = 0; i < 8; i++) {
    items[i].name = "item " + i
  }
  animate()
}
export fn frame() {
  n = n + 1
  text("a temporary " + n + " that nobody keeps after this frame", 0, 10, 8)
  items[n % 8].name = "item " + (n % 8) + " at " + n
  if (n == 60000) {
    mut bad: int = 0
    for (let i = 0; i < 8; i++) {
      if (substr(items[i].name, 0, 5) != "item ") {
        bad = bad + 1
      }
    }
    printStr("bad " + bad + " / " + items[0].name)
  }
}`,
  alert: `export fn main() {
  alert("hello")
}`,
  storage: `export fn main() {
  save("k", 1)
  httpGet("https://example.org/", 1)
  beep(440, 100)
  button("Go", 1)
}`,
  interop: `export fn main() {
  let t = document.title
  printStr(toStr(t))
}`,
};

// hand-made WebAssembly, for what Emit would not write
const leb = n => { const out = []; do { let b = n & 127; n >>>= 7; if (n) b |= 128; out.push(b); } while (n); return out; };
const str = s => [...leb(s.length), ...Buffer.from(s)];
const sec = (id, body) => [id, ...leb(body.length), ...body];
const vec = items => [...leb(items.length), ...items.flat()];
const WASM = body => Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...body]);
const T_VOID = [0x60, 0, 0];
const HAND = {
  // memory of 2000 pages (125 MB) from the start
  bigMemory: WASM([...sec(1, vec([T_VOID])), ...sec(3, vec([[0]])), ...sec(5, vec([[0, ...leb(2000)]])), ...sec(7, vec([[...str('memory'), 2, 0], [...str('main'), 0, 0]])), ...sec(10, vec([[2, 0, 0x0b]]))]),
  // frame grows memory by 2000 pages each time
  grower: WASM([...sec(1, vec([T_VOID])), ...sec(2, vec([[...str('std'), ...str('animate'), 0, 0]])), ...sec(3, vec([[0], [0]])), ...sec(5, vec([[0, 1]])),
    ...sec(7, vec([[...str('memory'), 2, 0], [...str('main'), 0, 1], [...str('frame'), 0, 2]])),
    ...sec(10, vec([[4, 0, 0x10, 0, 0x0b], [...leb(8), 0, 0x41, ...[0xd0, 0x0f], 0x40, 0, 0x1a, 0x0b]]))]),
  // imports a memory and a global instead of functions
  importsMemory: WASM([...sec(2, vec([[...str('std'), ...str('memory'), 2, 0, 1]]))]),
  importsGlobal: WASM([...sec(2, vec([[...str('std'), ...str('random'), 3, 0x7c, 0]]))]),
  importsEnv: WASM([...sec(1, vec([T_VOID])), ...sec(2, vec([[...str('env'), ...str('fetch'), 0, 0], [...str('__js__'), ...str('__jsGlobal'), 0, 0], [...str('std'), ...str('constructor'), 0, 0], [...str('__proto__'), ...str('x'), 0, 0]]))]),
  notWasm: Buffer.from('this is not a program'),
};

/** The worker's inside, driven directly: messages in, a list of messages out. */
function core(limits) {
  const out = [], c = Pane.appCore(m => out.push(m));
  return { out, load: bytes => c.handle({ t: 'load', bytes: new Uint8Array(bytes).buffer, limits: Object.assign({}, Pane.APP_LIMITS, limits) }), frame: input => c.handle({ t: 'frame', input: input || {} }), last: () => out[out.length - 1] };
}

(async () => {
  try {
    execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'build-pane-html.js'), '--check'], { stdio: 'pipe' });
    ok('pane.html contains the current pane.js and pages', true);
  } catch (e) { ok('pane.html contains the current pane.js and pages', false, String(e.stderr)); }

  const browser = await chromium.launch();
  const ide = await openIde(browser);
  const built = {};
  for (const name of Object.keys(EMIT)) built[name] = await compileEmit(ide, EMIT[name]);
  eq('every test program compiles', Object.keys(built).filter(n => built[n].errors.length).map(n => n + ': ' + built[n].errors[0]), []);
  await ide.close();

  // ───────────── part 1: the worker's inside, in Node ─────────────
  eq('imports: the allowed list has no duplicates and only the two tables', [new Set(Pane.APP_IMPORTS).size === Pane.APP_IMPORTS.length, Pane.APP_IMPORTS.every(n => /^(std|__js__)\.[A-Za-z_][A-Za-z0-9_]*$/.test(n))], [true, true]);
  {
    const c = core(); await c.load(built.draw.wasm);
    const m = c.last();
    eq('draw: ready, with the picture size and no frame loop', [m.t, m.w, m.h, m.animate, c.out.length], ['ready', 64, 48, false, 1]);
    eq('draw: every drawing call became a command, in order', m.cmds, ['c', 255, 0, 0, 'r', 1, 2, 3, 4, 'a', 0.5, 'w', 2, 's', 5, 6, 7, 8, 'o', 10, 11, 12, 'l', 1, 2, 3, 4, 'p', 9, 9, 't', 'n=7', 2, 20, 10]);
    eq('draw: print, numbers, text built at run time, text length in bytes, character codes, integer maths', m.logs, ['42', '1.5', 'hi 32.0', '6', '98', '28']);
  }
  {
    const c = core(); await c.load(built.count.wasm);
    eq('count: ready and wants frames', [c.last().t, c.last().animate, c.last().w], ['ready', true, 32]);
    c.frame(); c.frame(); c.frame();
    const m = c.last();
    eq('count: each frame is answered; clear drops what was drawn before it', [c.out.length, m.t, m.cmds], [4, 'frame', ['x', 'c', 0, 255, 0, 'r', 3, 0, 1, 1, 't', 'frame 3', 0, 10, 8]]);
    eq('count: arrays keep their numbers between frames', m.logs, [String(10 + 3 + 7 + 4)]);
  }
  {
    // 60,000 frames, each building text; one string is kept in a global the whole time
    const c = core(); await c.load(built.keeper.wasm);
    for (let i = 0; i < 60000; i++) { c.frame(); if (c.last().t === 'error') break; c.out.splice(0, c.out.length - 1); }
    const m = c.last();
    eq('text memory: the kept string is intact after 60,000 frames', [m.t, m.logs], ['frame', ['kept 60000']]);
  }
  {
    // the same program with room for one chunk of text only: the kept string pins that chunk, so the next one is refused
    const c = core({ strings: 1048576 }); await c.load(built.keeper.wasm);
    let n = 0; while (n < 60000 && c.last().t !== 'error') { c.frame(); n++; c.out.splice(0, c.out.length - 1); }
    ok('text memory: when more text is in use at once than allowed, the app is stopped with a message', c.last().t === 'error' && /out of text memory \(1 MB/.test(c.last().message) && n > 1000, [n, c.last()]);
    const d = core(); await d.load(built.texts.wasm);
    eq('text memory: one string cannot grow without end (it is cut at 100,000 characters)', d.last().t, 'ready');
    const a = core(); await a.load(built.arrays.wasm);
    ok('arrays: there is a limit on how many numbers an app keeps', a.last().t === 'error' && /too many arrays/.test(a.last().message), a.last());
    a.frame();
    eq('a stopped app answers nothing more', a.out.length, 1);
  }
  {
    const c = core(); await c.load(built.flood.wasm); c.frame();
    const m = c.last();
    ok('flood: 100,000 drawing calls in a frame are cut to the limit, and the app goes on', m.t === 'frame' && m.cmds.length <= Pane.APP_LIMITS.cmds && m.dropped === true && m.logs[0] === '1', [m.t, m.cmds && m.cmds.length, m.dropped]);
  }
  {
    const c = core(); await c.load(built.region.wasm);
    eq('regions: a program reads and writes its own typed memory, and text built by the host does not land in it', [c.last().t, c.last().logs], ['ready', ['12', 'text 5']]);
    c.frame(); eq('regions: an index inside the region', [c.last().t, c.last().logs], ['frame', ['40']]);
    c.frame();
    ok('regions: an index outside it stops the app with a message', c.last().t === 'error' && /outside its region/.test(c.last().message), c.last());
  }
  {
    // text kept in a region, replaced a little each frame, among text nobody keeps
    const c = core(); await c.load(built.regionText.wasm);
    for (let i = 0; i < 60000; i++) { c.frame(); if (c.last().t === 'error') break; c.out.splice(0, c.out.length - 1); }
    eq('regions: text a region points to is intact after 60,000 frames of throwaway text', [c.last().t, c.last().logs], ['frame', ['bad 0 / item 0 at 60000']]);
  }
  for (const [name, want] of [['alert', 'alert'], ['storage', 'save, httpGet, beep, button'], ['interop', '']]) {
    const c = core(); await c.load(built[name].wasm);
    const m = c.last();
    ok(`refused: ${name} — a program that imports what apps do not have is not started`, c.out.length === 1 && m.t === 'error' && /apps in Pane do not have/.test(m.message) && want.split(', ').every(w => m.message.includes(w)), m);
    ok(`refused: ${name} — and the compile tool says the same`, built[name].refused.length > 0, built[name].refused);
  }
  ok('refused: the interop program was asking for the JS bridge', built.interop.refused.some(i => i.startsWith('__js__.') || i.startsWith('js.')), built.interop.refused);
  for (const [name, want] of [['bigMemory', /more than 64 MB of memory/], ['importsMemory', /std\.memory/], ['importsGlobal', /std\.random/], ['importsEnv', /env\.fetch, __js__\.__jsGlobal, constructor, __proto__\.x/], ['notWasm', /./]]) {
    const c = core(); await c.load(HAND[name]);
    ok(`refused: hand-made ${name}`, c.out.length === 1 && c.last().t === 'error' && want.test(c.last().message), c.last());
  }
  {
    const c = core(); await c.load(HAND.grower);
    eq('grower: starts', c.last().t, 'ready');
    c.frame();
    ok('grower: a program that grows its memory past the limit is stopped after that call', c.last().t === 'error' && /more than 64 MB/.test(c.last().message), c.last());
  }
  eq('replay: malformed commands end the replay', [Pane.appReplay({}, ['r', 1, 2, 3], 1, 1), Pane.appReplay({}, ['r', 1, 2, NaN, 4], 1, 1), Pane.appReplay({}, ['?'], 1, 1), Pane.appReplay({}, ['t', 5, 1, 2, 3], 1, 1), Pane.appReplay({}, [], 1, 1)], [false, false, false, false, true]);

  // ───────────── part 2: in the browser ─────────────
  const b64 = bytes => 'data:application/wasm;base64,' + Buffer.from(bytes).toString('base64');
  const pageWith = (...apps) => 'txt top\n' + apps.map(a => 'app ' + a).join('\n') + '\nbtn Count 1\nid count\ntxt n is {n}\nif tap 1=1 do set n n+1';
  const SITE = {
    '/draw.pane': pageWith(b64(built.draw.wasm)),
    '/input.pane': pageWith(b64(built.input.wasm)),
    '/hang.pane': pageWith(b64(built.hang.wasm)),
    '/hang0.pane': pageWith(b64(built.hangAtStart.wasm)),
    '/alert.pane': pageWith(b64(built.alert.wasm)),
    '/five.pane': pageWith(...Array(5).fill(b64(built.draw.wasm))),
    '/url.pane': pageWith('count.wasm', 'https://other.test/count.wasm', 'missing.wasm'),
    '/count.wasm': built.count.wasm,
    '/tool.pane': paneFor('Made by the tool', built.count.wasm),
  };
  async function open(opts, hash) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 400, height: 640 }, deviceScaleFactor: 1 }, opts));
    const page = await ctx.newPage();
    const t = { ctx, page, errors: [], requests: [] };
    page.on('pageerror', e => t.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) t.errors.push(m.text()); });
    await page.route(/^(https?|wss?):/, r => {
      const u = new URL(r.request().url());
      t.requests.push(r.request().url());
      const hit = u.host === 'site.test' ? SITE[u.pathname] : u.host === 'other.test' && u.pathname === '/count.wasm' ? built.count.wasm : null;
      if (hit == null) return r.fulfill({ status: 404, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: 'not here' });
      return r.fulfill({ status: 200, contentType: Buffer.isBuffer(hit) ? 'application/wasm' : 'text/plain; charset=utf-8', headers: { 'access-control-allow-origin': '*' }, body: hit });
    });
    await page.goto('file://' + file + (hash ? '#' + hash : ''));
    await page.waitForFunction(() => window.paneShell && paneShell.current && !/^Loading /.test(document.getElementById('status').textContent) && paneShell.view.paints > 0);
    return t;
  }
  const go = async (page, addr) => { await page.fill('#addr', addr); await page.press('#addr', 'Enter'); await page.waitForFunction(a => paneShell.current && paneShell.current.url === a && !/^Loading /.test(document.getElementById('status').textContent), addr); };
  const frames = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
  // every app of the page: what it says, whether it runs, and its picture
  const apps = page => page.evaluate(() => [...paneShell.view.apps.values()].map(a => ({ note: a.note, running: !!a.worker, animate: a.animate, w: a.n.aw, h: a.n.ah })));
  const settledApps = (page, n) => page.waitForFunction(n => paneShell.view.apps.size === n && [...paneShell.view.apps.values()].every(a => a.note !== 'loading…'), n, { timeout: 15000 });
  const pixel = (page, i, x, y) => page.evaluate(([i, x, y]) => { const a = [...paneShell.view.apps.values()][i]; return a.canvas ? [...a.canvas.getContext('2d').getImageData(x, y, 1, 1).data] : null; }, [i, x, y]);
  // where an app's picture is on screen
  const box = (page, i) => page.evaluate(i => { const a = [...paneShell.view.apps.values()][i], r = paneShell.view.canvas.getBoundingClientRect(); return { x: r.left + a.n._ax, y: r.top + a.n._ay, s: a.n._as }; }, i);
  const clickCount = async page => { const at = await page.evaluate(() => { const n = paneShell.view.page.names.count, r = paneShell.view.canvas.getBoundingClientRect(); return [r.left + n.x + n.w / 2, r.top + n.y + n.h / 2 - paneShell.view.page.scrollY]; }); await page.mouse.click(at[0], at[1]); await frames(page); return page.evaluate(() => paneShell.view.state.vars.n); };
  const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };

  {
    const t = await open({}, 'https://site.test/draw.pane'), page = t.page;
    await settledApps(page, 1); await frames(page);
    eq('browser: the app ran in a worker and is shown at its own size', await apps(page), [{ note: null, running: true, animate: false, w: 64, h: 48 }]);
    eq('browser: its drawing is in its picture (a red rectangle at 1,2)', [await pixel(page, 0, 2, 3), await pixel(page, 0, 40, 40)], [[255, 0, 0, 255], [0, 0, 0, 0]]);
    eq('browser: what it printed is in the page log', await page.evaluate(() => paneShell.log.map(l => l.kind + ':' + l.text)), ['print:42', 'print:1.5', 'print:hi 32.0', 'print:6', 'print:98', 'print:28']);
    ok('browser: the page around it is laid out with it', await page.evaluate(() => { const [top, app, btn] = paneShell.view.page.root.children; return app.y >= top.y + top.h && app.h === 48 && btn.y >= app.y + app.h; }));
    await shot(page, 'app-draw');
    eq('browser: no errors', t.errors, []);

    // keys and pointer
    await go(page, 'https://site.test/input.pane'); await settledApps(page, 1);
    await page.waitForFunction(() => [...paneShell.view.apps.values()][0].animate);
    const at = await box(page, 0);
    await page.mouse.move(at.x + 30 * at.s, at.y + 20 * at.s); await frames(page); await frames(page);
    eq('pointer: the app sees where the mouse is, in its own coordinates (blue square at 30,20)', [await pixel(page, 0, 30, 20), await pixel(page, 0, 60, 40)], [[0, 0, 255, 255], [0, 0, 0, 255]]);
    await page.mouse.down(); await frames(page); await frames(page);
    eq('pointer: and that the button is down (the square turns red)', await pixel(page, 0, 30, 20), [255, 0, 0, 255]);
    await page.mouse.move(at.x + 70 * at.s, at.y + 30 * at.s, { steps: 3 }); await frames(page); await frames(page);
    eq('pointer: a drag on the app moves in the app and does not scroll or click the page', [await pixel(page, 0, 70, 30), await page.evaluate(() => paneShell.view.page.scrollY)], [[255, 0, 0, 255], 0]);
    await page.mouse.up(); await frames(page); await frames(page);
    eq('pointer: released', await pixel(page, 0, 70, 30), [0, 0, 255, 255]);
    eq('keys: before a key is pressed', await pixel(page, 0, 1, 1), [0, 0, 0, 255]);
    await page.keyboard.down('ArrowRight'); await frames(page); await frames(page);
    eq('keys: the app that was clicked gets the keys', await pixel(page, 0, 1, 1), [255, 255, 255, 255]);
    await page.keyboard.up('ArrowRight'); await frames(page); await frames(page);
    eq('keys: and their release', await pixel(page, 0, 1, 1), [0, 0, 0, 255]);
    await page.keyboard.press('Escape'); await page.keyboard.down('ArrowRight'); await frames(page); await frames(page);
    eq('keys: Escape takes the keys back from the app', await pixel(page, 0, 1, 1), [0, 0, 0, 255]);
    await page.keyboard.up('ArrowRight');
    eq('input: no errors', t.errors, []);
    await t.ctx.close();
  }
  {
    // a narrow window: the picture is scaled down, and the pointer still maps
    const t = await open({ viewport: { width: 80, height: 500 }, deviceScaleFactor: 2 }, 'https://site.test/input.pane'), page = t.page;
    await settledApps(page, 1); await page.waitForFunction(() => [...paneShell.view.apps.values()][0].animate); await frames(page);
    const at = await box(page, 0);
    ok('scale: a picture wider than the window is drawn smaller', at.s < 1 && at.s > 0.5, at);
    await page.mouse.move(at.x + 50 * at.s, at.y + 25 * at.s); await frames(page); await frames(page);
    eq('scale: the pointer is still in the app\'s own coordinates', await pixel(page, 0, 50, 25), [0, 0, 255, 255]);
    await t.ctx.close();
  }
  {
    // the game
    const t = await open({ viewport: { width: 360, height: 640 } }, 'pane:bounce'), page = t.page;
    await settledApps(page, 1); await page.waitForFunction(() => [...paneShell.view.apps.values()][0].animate);
    const snap = () => page.evaluate(() => [...paneShell.view.apps.values()][0].canvas.toDataURL());
    const a = await snap(); await page.waitForTimeout(200); const b = await snap();
    ok('bounce: the game is running (the picture changes)', a !== b);
    const paddle = () => page.evaluate(() => { const c = [...paneShell.view.apps.values()][0].canvas, d = c.getContext('2d').getImageData(0, 187, 320, 1).data; for (let x = 0; x < 320; x++) if (d[x * 4] === 100 && d[x * 4 + 1] === 160) return x; return -1; });
    const before = await paddle(), at = await box(page, 0);
    await page.mouse.click(at.x + 300 * at.s, at.y + 100 * at.s);
    await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(300); await page.keyboard.up('ArrowLeft'); await frames(page);
    const after = await paddle();
    ok('bounce: the left arrow moves the paddle left', before >= 0 && after >= 0 && after < 200, [before, after]);
    await shot(page, 'bounce');
    eq('bounce: built from pages/apps/bounce.emit with allowed imports only', (await compileEmit(await openIde(browser), fs.readFileSync(path.join(__dirname, '..', 'pages', 'apps', 'bounce.emit'), 'utf8'))).refused, []);
    await go(page, 'pane:home'); await frames(page);
    eq('bounce: leaving the page ends its app', [await page.evaluate(() => paneShell.view.apps.size), t.errors], [0, []]);
    await t.ctx.close();
  }
  {
    // an app that never returns
    const t = await open({}, 'https://site.test/hang.pane'), page = t.page;
    await settledApps(page, 1);
    await page.waitForFunction(() => /took too long/.test([...paneShell.view.apps.values()][0].note || ''), null, { timeout: 15000 });
    eq('hang: an app that stops answering is ended', (await apps(page)).map(a => [a.running, a.animate, /it was stopped: it took too long/.test(a.note)]), [[false, false, true]]);
    eq('hang: its last picture stays (green)', await pixel(page, 0, 5, 5), [0, 200, 0, 255]);
    ok('hang: the status line says so', /app: it was stopped/.test(await page.textContent('#status')), await page.textContent('#status'));
    eq('hang: the page itself never stopped working', [await clickCount(page), await clickCount(page)], [1, 2]);
    await shot(page, 'app-stopped');
    await go(page, 'https://site.test/hang0.pane'); await settledApps(page, 1);
    const started = Date.now();
    eq('hang: the page works while an app hangs in its first call', await clickCount(page), 1);
    ok('hang: (the click did not wait for the app)', Date.now() - started < 2000);
    await page.waitForFunction(() => /took too long/.test([...paneShell.view.apps.values()][0].note || ''), null, { timeout: 15000 });
    eq('hang: and that app is ended too', (await apps(page))[0].running, false);
    await page.click('#back'); await page.waitForFunction(() => paneShell.current.url === 'https://site.test/hang.pane');
    eq('hang: the browser goes on', await page.evaluate(() => paneShell.current.url), 'https://site.test/hang.pane');
    eq('hang: no errors', t.errors, []);
    await t.ctx.close();
  }
  {
    const t = await open({}, 'https://site.test/alert.pane'), page = t.page;
    let dialogs = 0; page.on('dialog', d => { dialogs++; d.dismiss(); });
    await settledApps(page, 1);
    ok('refused: in the browser, an app that imports alert is not started, and no alert appears', /do not have: alert/.test((await apps(page))[0].note) && !(await apps(page))[0].running && dialogs === 0, await apps(page));

    await go(page, 'https://site.test/five.pane'); await settledApps(page, 5);
    eq('limit: a page runs four apps; the fifth says why it does not', (await apps(page)).map(a => a.note), [null, null, null, null, 'a page can run 4 apps']);

    await go(page, 'https://site.test/url.pane'); await settledApps(page, 3);
    const list = await apps(page);
    ok('address: an app from the page\'s own site loads and runs', list[0].note === null && list[0].animate && list[0].w === 32, list[0]);
    ok('address: one from another site is not fetched, and the bar asks', list[1].note === 'this app could not be loaded' && !t.requests.includes('https://other.test/count.wasm') && (await page.textContent('#permText')) === 'https://site.test wants to load from https://other.test.', [list[1], await page.textContent('#permText')]);
    ok('address: a missing one says the answer', /could not be loaded: the server answered 404/.test(list[2].note), list[2]);

    await go(page, 'https://site.test/tool.pane'); await settledApps(page, 1);
    eq('tool: a page written by tools/emit-to-pane.js runs', [(await apps(page))[0].note, (await apps(page))[0].animate, await page.title()], [null, true, 'Made by the tool — Pane']);
    eq('refused and limits: no errors', t.errors, []);
    await t.ctx.close();
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

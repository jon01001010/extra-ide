#!/usr/bin/env node
// Tests the File-menu exports of an Emit IDE build in headless Chromium.
//
// For every bundled example (and a few extra programs that cover `use` URL / ES-module libraries,
// a failing library, library stylesheets, keyboard and mouse input) it
//   1. runs the program in the IDE and records what the Output tab shows (printed lines, buttons,
//      inputs, canvases and whether they have pixels), before and after pressing every button;
//   2. triggers each export (.wasm, .html, .js, .emit) and captures the generated file by replacing
//      the IDE's _download();
//   3. opens the exported .html in a fresh page from a temp file (file://), and imports the exported
//      .js module in a fresh page served from http://export.test/, and compares what each shows with (1).
//
// The IDE's Run also calls exported functions that take parameters, with made-up test arguments; an
// exported program only calls the parameterless ones. So the IDE reference run is made with genArgs()
// narrowed to parameterless functions — everything else in the IDE is untouched.
// Math.random and the clock are made deterministic in every page so the two sides can be compared.
//
// Offline like the other runners: CDN requests are answered from tests/node_modules, the rest is aborted.
//
//   node tests/run-export.js [path/to/emit-ide.html] [name ...]
//
// Ends with a PASS/FAIL table per program for the .html and .js exports; exit code 1 on any failure.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LIBS = path.join(__dirname, 'node_modules');
const npmFile = f => fs.readFileSync(path.join(LIBS, f), 'utf8');
const CDN_MAP = [
  [/three(\.min)?\.js/, 'three/build/three.min.js'],
  [/babylon/, 'babylonjs/babylon.js'],
  [/canvas-confetti/, 'canvas-confetti/dist/confetti.browser.js'],
  [/tinycolor2@1\.6\.0\/\+esm/, 'tinycolor2/esm/tinycolor.js'],
  [/dayjs/, 'dayjs/dayjs.min.js'],
  [/tinycolor2/, 'tinycolor2/cjs/tinycolor.js'],
  [/nprogress@0\.2\.0\/nprogress\.js$/, 'nprogress/nprogress.js'],
  [/nprogress@0\.2\.0\/nprogress\.css$/, 'nprogress/nprogress.css'],
];
const typeOfUrl = url => (/\.css$/.test(url) ? 'text/css' : 'application/javascript');
// Exact URL -> script body, for the extra programs.
const ROUTES = {
  'https://libs.test/hello.js': 'window.helloLib={greet:function(n){return "hello "+n}};',
  'https://libs.test/mathmod.js': 'export function add(a,b){return a+b}\nexport const name="mathmod";',
  'https://libs.test/style.css': '.emit-css-probe{position:fixed;height:7px}',
};
// Runs in an exported page: what only nprogress.css gives the real NProgress bar / only style.css gives a probe.
const NPROGRESS_STYLED = () => {
  const p = [], bar = document.querySelector('#nprogress .bar'), cs = bar && getComputedStyle(bar);
  if (!bar) p.push('NProgress did not create its bar');
  else if (cs.position !== 'fixed' || cs.height !== '2px') p.push('the NProgress bar is unstyled (nprogress.css not applied): position ' + cs.position + ', height ' + cs.height);
  const links = document.querySelectorAll('link[rel="stylesheet"][href$="nprogress@0.2.0/nprogress.css"]').length;
  if (links !== 1) p.push('expected exactly one <link> for nprogress.css, found ' + links);
  return p;
};
const PROBE_STYLED = () => {
  const d = document.createElement('div');
  d.className = 'emit-css-probe';
  document.body.appendChild(d);
  const h = getComputedStyle(d).height;
  d.remove();
  return h === '7px' ? [] : ['the stylesheet from the use line is not applied (probe height ' + h + ')'];
};
const JS_ORIGIN = 'http://export.test';

const prog = (useLine, body) => useLine + '\n\nexport fn main() {\n' + body + '\n}\n';
// Programs that are not bundled examples. `drive` runs in every page after the first snapshot.
const EXTRA = {
  '+use-url': {
    src: prog('use "https://libs.test/hello.js"', '  printStr(toStr(helloLib.greet("emit")))'), expect: 'hello emit',
    // .html?trace shows the runtime's call-trace lines that are hidden by default
    htmlCheck: async (page, url) => {
      await page.goto(url + '?trace');
      await page.waitForTimeout(800);
      const text = await page.evaluate(() => document.getElementById('tab-output').innerText);
      return /^→ \.greet\(/m.test(text) && text.includes('hello emit') ? [] : ['?trace should show the call trace, shows: ' + JSON.stringify(text.slice(0, 200))];
    },
    // The module API: init() again restarts with a cleared output; {run:false} does not call anything until run()
    jsCheck: page => page.evaluate(async () => {
      const p = [], out = document.getElementById('tab-output');
      if (!document.getElementById('app').contains(out)) p.push('output element was not created inside options.target');
      const app = await window.__mod.default({ run: false });
      if (out.innerText.trim()) p.push('init({run:false}) should leave a cleared output, shows: ' + out.innerText.slice(0, 100));
      if (app.entries.join() !== 'main') p.push('entries should be [main], got ' + app.entries.join());
      if (typeof app.exports.main !== 'function' || !(app.memory instanceof WebAssembly.Memory)) p.push('exports/memory missing');
      app.run();
      if ((out.innerText.match(/hello emit/g) || []).length !== 1) p.push('run() should print once, shows: ' + out.innerText.slice(0, 100));
      return p;
    }),
  },
  '+use-esm-as': { src: prog('use "https://libs.test/mathmod.js" as M', '  let s = M.add(2, 40)\n  printStr(toStr(s))'), expect: '42' },
  '+use-npm-esm': { src: prog('use tinycolor2@1.6.0 as TC', '  printStr(toStr(TC.mix("#000000", "#ffffff", 50).toHexString()))'), expect: '#808080' },
  // A registry library that ships a stylesheet: the export must carry the entry's `css` and load it.
  '+use-css': {
    src: prog('use nprogress', '  NProgress.start()\n  NProgress.set(0.4)\n  printStr("bar shown")'), expect: 'bar shown',
    programCheck: P => (P.libs.length === 1 && P.libs[0].lib && Array.isArray(P.libs[0].lib.css) && /nprogress\.css$/.test(P.libs[0].lib.css[0]) ? [] : ['exported program data does not carry the library css: ' + JSON.stringify(P.libs)]),
    htmlCheck: page => page.evaluate(NPROGRESS_STYLED),
    jsCheck: page => page.evaluate(NPROGRESS_STYLED),
  },
  // A stylesheet named directly by a use line, next to a script.
  '+use-css-url': {
    src: 'use "https://libs.test/style.css"\nuse "https://libs.test/hello.js"\n\nexport fn main() {\n  printStr(toStr(helloLib.greet("css")))\n}\n', expect: 'hello css',
    htmlCheck: page => page.evaluate(PROBE_STYLED),
    jsCheck: page => page.evaluate(PROBE_STYLED),
  },
  // The export is opened with the stylesheet unreachable: one warning line, the program still runs, init() resolves.
  '+css-fails': {
    src: prog('use nprogress', '  NProgress.start()\n  printStr("ran anyway")'), expect: 'ran anyway',
    exportBlocks: ['https://cdn.jsdelivr.net/npm/nprogress@0.2.0/nprogress.css'],
    exportWarns: ['Could not load the stylesheet', 'nprogress.css', 'nprogress'],
  },
  '+use-fails': {
    src: prog('use "https://libs.test/hello.js"', '  printStr(toStr(helloLib.greet("emit")))'),
    // The export is opened with the library unreachable: it must say so, readably, and not throw.
    exportBlocks: ['https://libs.test/hello.js'],
    exportMustShow: ['Could not load library', 'https://libs.test/hello.js'],
  },
  '+keyboard-mouse': {
    src: [
      'mut seenKey = 0', 'mut seenDown = 0', 'mut frames = 0', '',
      'export fn main() {', '  canvas(120, 80)', '  animate()', '}', '',
      'export fn frame() {', '  frames++', '  color(40, 200, 120)', '  rect(10, 10, 60, 40)',
      '  if (keyDown(65) == 1) {', '    if (seenKey == 0) {', '      seenKey = 1', '      printStr("key A down")', '    }', '  }',
      '  if (touching() == 1) {', '    if (seenDown == 0) {', '      seenDown = 1', '      printStr("pointer down")', '    }', '  }',
      '}', ''].join('\n'),
    drive: async page => {
      await page.keyboard.down('KeyA'); await page.waitForTimeout(150); await page.keyboard.up('KeyA');
      await page.mouse.move(30, 30); await page.mouse.down(); await page.waitForTimeout(150); await page.mouse.up();
    },
    expect: 'key A down',
    expect2: 'pointer down',
  },
  // await (JSPI), try / catch / finally / throw and Emit arrays in an exported page. The export boot starts
  // async entry functions through the runtime's _emitCallExport, exactly as Run does.
  '+await-try': {
    src: [
      'fn load(id: int) str {', '  await sleep(30)', '  if (id < 0) { throw "bad id " + id }', '  return "item" + id', '}', '',
      'export fn main() {', '  printStr("start")', '  let v = await Promise.resolve(41)', '  print(v + 1)',
      '  for (let i = 0; i < 3; i++) {', '    if (i == 1) { continue }', '    printStr(load(i))', '  }',
      '  try {', '    printStr(load(-1))', '  } catch (e) {', '    printStr("caught: " + e.message)', '  } finally {', '    printStr("finally")', '  }',
      '  try { JSON.parse("{bad") } catch (e) { printStr("parse: " + e.name) }',
      '  try { await Promise.reject(new Error("rejected")) } catch (e) { printStr("await: " + e.message) }',
      '  let xs = [1, 2, 3]', '  xs.push(xs[0] + xs.length)', '  printStr(toStr(JSON.stringify(xs)))',
      '  let r = await Promise.reject(new Error("not caught"))', '  printStr("after the red line")',
      '  throw "main gives up"', '}', '',
      'export fn second() {', '  printStr("second starts while main waits")', '  await sleep(400)', '  printStr("second done")', '}', ''].join('\n'),
    expect: 'caught: bad id -1',
    expect2: 'main gives up',
    // The module API: an async export called directly cannot wait (readable error); through the runtime it can.
    jsCheck: page => page.evaluate(async () => {
      const p = [], out = document.getElementById('tab-output');
      const app = await window.__mod.default({ run: false });
      let msg = '';
      try { app.exports.second(); } catch (e) { msg = e.message; }
      if (!/^await cannot wait here/.test(msg)) p.push('a direct call of an async export should throw the readable error, got: ' + JSON.stringify(msg));
      if (typeof window._emitCallExport !== 'function') return p.concat('window._emitCallExport is missing');
      await window._emitCallExport(app.instance, 'second', []);
      if (!/second done/.test(out.innerText)) p.push('_emitCallExport(app.instance, "second", []) should run it to the end, shows: ' + out.innerText.slice(0, 200));
      return p;
    }),
  },
  '+await-button': {
    src: [
      'mut clicks = 0', '',
      'export fn main() {', '  button("load", 1)', '  printStr("ready")', '  await sleep(400)', '  printStr("main woke up, clicks so far: " + clicks)', '}', '',
      'export fn onclick_1() {', '  clicks++', '  let me = clicks', '  printStr("click " + me)',
      '  let d = await Promise.resolve({name: "data" + me})', '  await sleep(20)', '  printStr("loaded " + d.name)',
      '  try {', '    await Promise.reject(new Error("offline"))', '  } catch (e) {', '    printStr("failed: " + e.message)', '  }',
      '  if (me == 1) { throw "handler stops" }', '}', ''].join('\n'),
    expect: 'loaded data1',
    expect2: 'handler stops',
  },
};

// Runs in every page before its own scripts: repeatable Math.random and a frozen clock.
const DETERMINISM = () => {
  let seed = 123456789;
  Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const RealDate = Date, T = 1750000000000;
  // eslint-disable-next-line no-global-assign
  Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(T); } static now() { return T; } };
};

// What a page shows. rootSel: the container of the program's output.
// ideChrome: skip the IDE's own result block and its call-trace lines (they are not program output).
const SNAPSHOT = ([rootSel, ideChrome]) => {
  const root = document.querySelector(rootSel) || document.body;
  const shown = el => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const lines = [];
  const walk = el => {
    for (const c of el.children) {
      const tag = c.tagName;
      if (/^(SCRIPT|STYLE|CANVAS|BUTTON|INPUT)$/.test(tag) || !shown(c)) continue;
      if (ideChrome && (c.classList.contains('output') || c.classList.contains('run-result'))) continue;
      if (c.querySelector('canvas,button,input')) { walk(c); continue; }
      for (let t of c.innerText.split('\n')) {
        t = t.trim().replace(/^> ?/, '');
        if (!t) continue;
        if (ideChrome && (/^→ /.test(t) || /^\[click \d+\]/.test(t))) continue;
        // "< 7": the runtime echoes the result of a bare JS call. For setTimeout that is a timer id, which
        // depends on how many timers the page (IDE vs. bare export) has already used — compare the shape only.
        t = t.replace(/^< \d+$/, '< (integer)');
        lines.push(t);
      }
    }
  };
  walk(root);
  return {
    lines,
    buttons: [...root.querySelectorAll('button')].filter(shown).map(b => b.textContent.trim()),
    inputs: [...root.querySelectorAll('input')].filter(shown).length,
    canvases: [...root.querySelectorAll('canvas')].filter(shown).map(c => c.width + 'x' + c.height),
    text: (root.innerText || '').slice(0, 4000),
  };
};

let browser, tools, tmpDir;

async function newPage(extra) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const t = { page, errors: [], blocked: [] };
  page.on('pageerror', e => t.errors.push('pageerror: ' + e.message.slice(0, 300)));
  await page.addInitScript(DETERMINISM);
  await page.route(/^https?:/, route => {
    const url = route.request().url().replace(/#.*$/, '');
    if (extra && extra.block && extra.block.includes(url)) return route.abort();
    if (extra && extra.serve && url in extra.serve) {
      const [body, contentType] = extra.serve[url];
      return route.fulfill({ body, contentType });
    }
    const js = { contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } };
    if (url in ROUTES) return route.fulfill({ body: ROUTES[url], ...js, contentType: typeOfUrl(url) });
    const hit = CDN_MAP.find(([re]) => re.test(url));
    const file = hit && path.join(LIBS, hit[1]);
    if (file && fs.existsSync(file)) return route.fulfill({ body: fs.readFileSync(file), ...js, contentType: typeOfUrl(url) });
    if (!/fonts\.(googleapis|gstatic)\.com/.test(url)) t.blocked.push(url);
    return route.abort();
  });
  return t;
}

// true when the canvas shows more than one colour (screenshot based, so it works for WebGL too).
async function canvasPainted(page, rootSel, i) {
  let png;
  try { png = await page.locator(rootSel + ' canvas').nth(i).screenshot({ timeout: 5000 }); } catch (e) { return false; }
  return tools.evaluate(async b64 => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const m = Math.min(8, Math.floor(Math.min(c.width, c.height) / 4)); // ignore border and rounded corners
    const d = g.getImageData(m, m, c.width - 2 * m, c.height - 2 * m).data;
    for (let p = 4; p < d.length; p += 4) if (d[p] !== d[0] || d[p + 1] !== d[1] || d[p + 2] !== d[2]) return true;
    return false;
  }, png.toString('base64'));
}

// Waits until the printed lines stop changing (timers, promises, frame loops), then snapshots.
async function settle(page, rootSel, ideChrome) {
  let last = null, stableSince = Date.now();
  const t0 = Date.now();
  for (;;) {
    const s = await page.evaluate(SNAPSHOT, [rootSel, ideChrome]);
    const key = JSON.stringify([s.lines, s.buttons, s.canvases]);
    if (key !== last) { last = key; stableSince = Date.now(); }
    if (Date.now() - stableSince >= 1500 || Date.now() - t0 > 12000) {
      s.painted = [];
      for (let i = 0; i < s.canvases.length; i++) s.painted.push(await canvasPainted(page, rootSel, i));
      return s;
    }
    await page.waitForTimeout(250);
  }
}

// Snapshot, then use the page the way a person would (type, press every button, keys/mouse), snapshot again.
async function observe(t, rootSel, ideChrome, c) {
  const before = await settle(t.page, rootSel, ideChrome);
  await t.page.evaluate(sel => {
    const root = document.querySelector(sel) || document.body;
    root.querySelectorAll('input').forEach(i => { i.value = 'hello'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    root.querySelectorAll('button').forEach(b => b.click());
  }, rootSel);
  if (c.drive) await c.drive(t.page);
  const after = await settle(t.page, rootSel, ideChrome);
  return { before, after };
}

async function runInIde(fileUrl, c) {
  const t = await newPage();
  const { page } = t;
  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof compileAndRun === 'function' && typeof EX === 'object');
  const src = await page.evaluate(([name, given]) => {
    try { closeWelcome(); } catch (e) {}
    const ed = document.getElementById('editor');
    ed.value = given != null ? given : EX[name];
    ed.dispatchEvent(new Event('input'));
    // Reference run: only parameterless exported functions are called (see the header).
    window.genArgs = params => (params.length ? [] : [[]]);
    return ed.value;
  }, [c.name, c.src == null ? null : c.src]);
  await page.evaluate(() => compileAndRun()).catch(e => t.errors.push('run rejected: ' + e.message.slice(0, 300)));
  const seen = await observe(t, '#tab-output', true, c);
  const status = await page.evaluate(() => document.getElementById('sTxt').innerText);
  if (status !== 'Done') t.errors.push('IDE status: ' + status);
  // Capture every export.
  const files = await page.evaluate(async () => {
    const got = {}, alerts = [];
    window._download = (name, content, type) => {
      const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      got[name] = { type, size: bytes.length, b64: btoa(bin), binary: typeof content !== 'string' };
    };
    window.alert = m => alerts.push(String(m));
    for (const fmt of ['wasm', 'html', 'js', 'emit']) {
      try { await doExport(fmt); } catch (e) { alerts.push(fmt + ' threw: ' + e.message); }
    }
    return { got, alerts };
  });
  await page.close();
  const out = {};
  for (const [name, f] of Object.entries(files.got)) out[name] = { ...f, data: Buffer.from(f.b64, 'base64') };
  return { src, seen, errors: t.errors, blocked: t.blocked, files: out, alerts: files.alerts };
}

function diff(label, want, got) {
  const a = JSON.stringify(want), b = JSON.stringify(got);
  return a === b ? [] : [label + ' differ\n          IDE:    ' + a.slice(0, 400) + '\n          export: ' + b.slice(0, 400)];
}
function compare(ide, exp, c) {
  const p = [];
  for (const when of ['before', 'after']) {
    const tag = when === 'before' ? '' : ' (after pressing buttons)';
    p.push(...diff('printed lines' + tag, ide[when].lines, exp[when].lines));
    p.push(...diff('buttons' + tag, ide[when].buttons, exp[when].buttons));
    p.push(...diff('inputs' + tag, ide[when].inputs, exp[when].inputs));
    p.push(...diff('canvases' + tag, ide[when].canvases, exp[when].canvases));
    p.push(...diff('canvas has pixels' + tag, ide[when].painted, exp[when].painted));
  }
  const all = exp.after.lines.join('\n');
  for (const e of [c.expect, c.expect2]) if (e && !all.includes(e)) p.push('export does not show ' + JSON.stringify(e));
  if (/^→ |^\[click \d+\]/m.test(exp.after.text)) p.push('export shows IDE call-trace lines');
  return p;
}

async function checkExport(kind, c, ide) {
  const problems = [];
  const file = ide.files[kind === 'html' ? 'program.html' : 'program.js'];
  if (file && c.programCheck && kind === 'html') {
    const m = file.data.toString('utf8').match(/var __emitProgram=(.*);\n<\/script>/);
    if (!m) problems.push('cannot find __emitProgram in the exported page'); else problems.push(...c.programCheck(JSON.parse(m[1])));
  }
  if (!file) return ['no ' + kind + ' file was produced' + (ide.alerts.length ? ' (' + ide.alerts.join('; ') + ')' : '')];
  const t = await newPage({
    block: c.exportBlocks,
    serve: kind === 'js' ? {
      [JS_ORIGIN + '/program.js']: [file.data, 'text/javascript'],
      [JS_ORIGIN + '/index.html']: ['<!DOCTYPE html><html><head><meta charset="UTF-8"><title>host</title></head><body style="background:#111;color:#eee">' +
        '<div id="app"></div><script type="module">\n' +
        'try{\n  const m=await import("./program.js");window.__mod=m;\n' +
        '  if(typeof m.init==="function"){window.__app=await m.init({target:document.getElementById("app")});}\n' +
        // Baseline API (before the fix): load(imports) -> exports. Call the parameterless functions like Run does.
        '  else{const ex=await m.load();window.__app={exports:ex};for(const k in ex){if(typeof ex[k]==="function"&&ex[k].length===0&&k!=="frame"&&!/^on(click|timer|http)_/.test(k))ex[k]();}}\n' +
        '  window.__state="ready";\n}catch(e){window.__state="error: "+(e&&e.message||e);}\n<\/script></body></html>', 'text/html'],
    } : null,
  });
  const { page } = t;
  let rootSel = '#tab-output';
  try {
    if (kind === 'html') {
      const f = path.join(tmpDir, c.name.replace(/[^\w.-]/g, '_') + '.html');
      fs.writeFileSync(f, file.data);
      await page.goto('file://' + f);
    } else {
      await page.goto(JS_ORIGIN + '/index.html');
      await page.waitForFunction(() => window.__state, null, { timeout: 30000 });
      const state = await page.evaluate(() => window.__state);
      if (c.exportMustShow) { // init() must reject with the same readable message it writes to the page
        if (!/^error: /.test(state) || !c.exportMustShow.every(n => state.includes(n))) problems.push('init() should reject with the library error, got: ' + state);
      } else if (state !== 'ready') problems.push('module ' + state);
      const hasExports = await page.evaluate(() => !!(window.__app && window.__app.exports && Object.keys(window.__app.exports).length));
      if (state === 'ready' && !hasExports && !c.exportMustShow) problems.push('init() did not return the program exports');
    }
    if (!(await page.$(rootSel))) rootSel = 'body';
    const seen = await observe(t, rootSel, false, c);
    if (c.exportMustShow) {
      for (const n of c.exportMustShow) if (!seen.after.text.includes(n)) problems.push('page should show ' + JSON.stringify(n) + ', shows: ' + JSON.stringify(seen.after.text.slice(0, 300)));
      if (/\[object |undefined/.test(seen.after.text)) problems.push('error is not readable: ' + seen.after.text.slice(0, 200));
    } else {
      if (c.exportWarns) { // the warning is extra output of the export only; everything else must match the IDE
        for (const when of ['before', 'after']) {
          const warns = seen[when].lines.filter(l => /^⚠ /.test(l));
          seen[when].lines = seen[when].lines.filter(l => !/^⚠ /.test(l));
          if (warns.length !== 1) problems.push('expected exactly one warning line, got ' + JSON.stringify(warns));
          else for (const n of c.exportWarns) if (!warns[0].includes(n)) problems.push('warning should mention ' + JSON.stringify(n) + ': ' + warns[0]);
        }
        if (/✗/.test(seen.after.text)) problems.push('a missing stylesheet must not be shown as an error: ' + seen.after.text.slice(0, 200));
      }
      problems.push(...compare(ide.seen, seen, c));
    }
    if (kind === 'js' && c.jsCheck) problems.push(...await c.jsCheck(page));
    if (kind === 'html' && c.htmlCheck) problems.push(...await c.htmlCheck(page, page.url()));
  } catch (e) {
    problems.push('harness: ' + e.message.split('\n')[0].slice(0, 300));
  }
  problems.push(...t.errors);
  if (t.blocked.length) problems.push('blocked requests: ' + t.blocked.join(', '));
  await page.close();
  return problems;
}

async function checkOthers(c, ide) {
  const p = [];
  const w = ide.files['program.wasm'], e = ide.files['program.emit'];
  if (!w || !(await tools.evaluate(b64 => WebAssembly.validate(Uint8Array.from(atob(b64), ch => ch.charCodeAt(0))), w.b64))) p.push('.wasm is missing or not valid WebAssembly');
  if (!e || e.data.toString('utf8') !== ide.src) p.push('.emit is missing or differs from the source');
  return p;
}

(async () => {
  const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'emit-ide-1_32.html'));
  const only = process.argv.slice(3);
  const fileUrl = 'file://' + file;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emit-export-'));
  browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  tools = await browser.newPage();
  await tools.route(/^https?:/, r => r.abort());
  await tools.goto(fileUrl);
  const exNames = await tools.evaluate(() => Object.keys(EX));
  await tools.goto('about:blank');
  const cases = exNames.map(name => ({ name })).concat(Object.entries(EXTRA).map(([name, c]) => ({ name, ...c })))
    .filter(c => !only.length || only.includes(c.name));

  const rows = [];
  for (const c of cases) {
    const ide = await runInIde(fileUrl, c);
    const row = { name: c.name, ide: ide.errors.concat(ide.blocked.map(u => 'blocked: ' + u)), sizes: {} };
    for (const [n, f] of Object.entries(ide.files)) row.sizes[n.replace('program.', '')] = f.size;
    row.html = await checkExport('html', c, ide);
    row.js = await checkExport('js', c, ide);
    row.other = await checkOthers(c, ide);
    if (ide.alerts.length) row.other.push('export alert: ' + ide.alerts.join('; '));
    rows.push(row);
    const mark = p => (p.length ? 'FAIL' : 'PASS');
    console.log(c.name.padEnd(17) + ' html ' + mark(row.html) + '   js ' + mark(row.js) + (row.ide.length ? '   (IDE run: ' + row.ide.join('; ') + ')' : ''));
    if (process.env.VERBOSE || process.env.DETAILS) {
      for (const k of ['html', 'js', 'other']) for (const p of row[k]) console.log('      ' + k + ': ' + p);
    }
  }
  await browser.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}

  const kb = n => (n == null ? '-' : n < 10240 ? (n / 1024).toFixed(1) + 'K' : Math.round(n / 1024) + 'K');
  const why = p => (p.length ? 'FAIL  ' + p[0].split('\n')[0].slice(0, 70) + (p.length > 1 ? ' (+' + (p.length - 1) + ')' : '') : 'PASS');
  console.log('\n' + 'program'.padEnd(17) + '.html'.padEnd(84) + '.js');
  for (const r of rows) console.log(r.name.padEnd(17) + why(r.html).padEnd(84) + why(r.js));
  console.log('\n' + 'program'.padEnd(17) + ['wasm', 'html', 'js', 'emit'].map(s => s.padStart(8)).join(''));
  for (const r of rows) console.log(r.name.padEnd(17) + ['wasm', 'html', 'js', 'emit'].map(s => kb(r.sizes[s]).padStart(8)).join(''));
  const bad = k => rows.filter(r => r[k].length).length;
  const ex = rows.filter(r => r.name[0] !== '+'), exBad = k => ex.filter(r => r[k].length).length;
  const ideBad = rows.filter(r => r.ide.length).length;
  console.log('\n.html export: ' + (rows.length - bad('html')) + '/' + rows.length + ' passed (' + (ex.length - exBad('html')) + '/' + ex.length + ' bundled examples)');
  console.log('.js export:   ' + (rows.length - bad('js')) + '/' + rows.length + ' passed (' + (ex.length - exBad('js')) + '/' + ex.length + ' bundled examples)');
  console.log('.wasm/.emit:  ' + (rows.length - bad('other')) + '/' + rows.length + ' passed');
  if (ideBad) console.log('IDE reference run had problems for ' + ideBad + ' program(s) — see above');
  process.exit(bad('html') || bad('js') || bad('other') || ideBad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

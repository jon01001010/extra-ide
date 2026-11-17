#!/usr/bin/env node
// Checks the Memory tab of an Emit IDE build in headless Chromium: the fifth Output tab, its region cards
// (scalar grids, struct tables, paging, display modes, hex dump, pixel preview), poke, lock, live refresh and
// its cost, the tappable "at path:line:col" of red runtime lines, and the editor support for structs and
// regions (highlighting, autocomplete, snippets), the Memory example and the help section.
// About half of the checks run in a phone viewport with touch (360 px wide), the rest on a desktop viewport.
// The run is offline: every network request is aborted.
//
//   node tests/run-memtab.js [path/to/emit-ide.html]
//
// TEMPORARY STAND-INS (test only, never in the product): the runtime's region API (_emitRegions,
// _emitRegionRead, _emitRegionWrite, _emitRegionFreeze, _emitRegionBytes) comes from the structs-and-regions
// branch of the compiler/runtime. Until it is merged — and so that these checks stay deterministic after
// it — the page gets a fake region store over one ArrayBuffer (STUB below, added with page.addInitScript and
// installed with __memStub.install(), which replaces whatever the page has). A timer mutates it to imitate a
// running program. Where autocomplete needs the module index's `structs` / `regions`, _emitModuleIndex is
// wrapped to add them. The "after merge" checks at the end print SKIP while the compiler has no regions.
//
// Exit code 0 when every check passes.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

let failed = 0, passed = 0, skipped = 0;
function check(label, ok, detail) {
  if (ok) { passed++; console.log('PASS  ' + label); }
  else { failed++; console.log('FAIL  ' + label + (detail !== undefined ? '\n      ' + String(detail).slice(0, 700) : '')); }
}
function skip(label, why) { skipped++; console.log('SKIP  ' + label + ' — ' + why); }

const PHONE = { viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true };
const DESK = { viewport: { width: 1200, height: 800 } };

// ── TEMPORARY STAND-IN for the runtime's region API (test only) ──
const STUB = () => {
  window.__memStub = {
    install(opts) {
      opts = opts || {};
      const T = { i8: [1, 'Int8'], u8: [1, 'Uint8'], i16: [2, 'Int16'], u16: [2, 'Uint16'], i32: [4, 'Int32'], u32: [4, 'Uint32'], int: [8, 'BigInt64'], f32: [4, 'Float32'], num: [8, 'Float64'], bool: [1, 'Uint8'] };
      const ball = { struct: 'Ball', fields: [
        { name: 'x', type: 'num', offset: 0, size: 8 }, { name: 'y', type: 'num', offset: 8, size: 8 },
        { name: 'r', type: 'i32', offset: 16, size: 4 }, { name: 'hp', type: 'i16', offset: 20, size: 2 },
        { name: 'tint', type: 'u8', offset: 22, size: 1 }, { name: 'alive', type: 'bool', offset: 23, size: 1 },
        { name: 'pos.x', type: 'f32', offset: 24, size: 4 }, { name: 'pos.y', type: 'f32', offset: 28, size: 4 },
        { name: 'id', type: 'int', offset: 32, size: 8 }] };
      const defs = opts.regions || [
        { name: 'fb', elem: 'u8', length: 64 * 48 * 4 },
        { name: 'grid', elem: 'int', length: 64 },
        { name: 'balls', elem: ball, length: 100, module: 'game.physics', path: 'game/physics.emit' },
        { name: 'big', elem: 'u16', length: 100000 },
        { name: 'locked', elem: 'i8', length: 16, frozen: true },
        { name: 'w16', elem: 'i16', length: 8 }, { name: 'w32', elem: 'i32', length: 8 }, { name: 'd32', elem: 'u32', length: 8 },
        { name: 'temps', elem: 'f32', length: 8 }, { name: 'nums', elem: 'num', length: 8 }, { name: 'flags', elem: 'bool', length: 8 }];
      let base = 4096;
      const regs = defs.map((d, id) => {
        const elemSize = typeof d.elem === 'string' ? T[d.elem][0] : 40;
        const r = { id, name: d.name, module: d.module || 'main', path: d.path || 'main.emit', base, length: d.length, elemSize, elem: d.elem, frozen: !!d.frozen };
        base += Math.ceil(d.length * elemSize / 8) * 8;
        return r;
      });
      const buf = new ArrayBuffer(base + 64), dv = new DataView(buf);
      const S = this;
      S.regs = regs; S.dv = dv; S.reads = 0; S.writes = []; S.mutating = false; S.ticks = 0;
      function loc(r, i, f) {
        if (!(i >= 0 && i < r.length) || Math.floor(i) !== i) return null;
        if (typeof r.elem === 'string') return { at: r.base + i * r.elemSize, t: r.elem };
        const fd = r.elem.fields.find(x => x.name === f);
        return fd ? { at: r.base + i * r.elemSize + fd.offset, t: fd.type } : null;
      }
      function get(l) {
        const v = dv['get' + T[l.t][1]](l.at, true);
        if (l.t === 'bool') return v !== 0;
        if (typeof v === 'bigint') return (v >= -9007199254740991n && v <= 9007199254740991n) ? Number(v) : v.toString();
        return v;
      }
      function put(l, v) {
        if (l.t === 'int') dv.setBigInt64(l.at, BigInt(v), true);
        else if (l.t === 'bool') dv.setUint8(l.at, v ? 1 : 0);
        else dv['set' + T[l.t][1]](l.at, Number(v), true);
      }
      S.get = (id, i, f) => { const l = loc(regs[id], i, f); return l ? get(l) : undefined; };
      S.put = (id, i, f, v) => { const l = loc(regs[id], i, f); if (l) put(l, v); };
      // initial contents
      regs.forEach(r => {
        const n = Math.min(r.length, 300);
        for (let i = 0; i < n; i++) {
          if (typeof r.elem === 'string') { if (r.elem === 'bool') S.put(r.id, i, null, i % 3 === 0); else if (r.elem !== 'u8') S.put(r.id, i, null, r.elem === 'f32' || r.elem === 'num' ? i + 0.5 : i * 3); }
          else { S.put(r.id, i, 'x', i * 1.5); S.put(r.id, i, 'y', 100 - i); S.put(r.id, i, 'r', 5); S.put(r.id, i, 'hp', -i); S.put(r.id, i, 'tint', i); S.put(r.id, i, 'alive', i % 2 === 0); S.put(r.id, i, 'pos.x', i / 4); S.put(r.id, i, 'id', 1000 + i); }
        }
        if (r.name === 'fb') { const s = 'Hello, memory!'; for (let i = 0; i < r.length; i++) dv.setUint8(r.base + i, i < s.length ? s.charCodeAt(i) : (i * 7) & 255); }
      });
      window._emitRegions = function () { return regs.map(r => Object.assign({}, r, { elem: typeof r.elem === 'string' ? r.elem : JSON.parse(JSON.stringify(r.elem)) })); };
      window._emitRegionRead = function (id, i, f) { S.reads++; const r = regs[id]; return r ? S.get(id, i, f) : undefined; };
      window._emitRegionWrite = function (id, i, f, v) {
        const r = regs[id]; if (!r) return false;
        const l = loc(r, i, f); if (!l) return false;
        S.writes.push({ id, i, f, v }); put(l, v); return true;     // bypasses freeze, like the real one
      };
      window._emitRegionFreeze = function (id, on) { if (regs[id]) regs[id].frozen = !!on; };
      window._emitRegionBytes = function (id) { S.reads++; const r = regs[id]; return new Uint8Array(buf, r.base, r.length * r.elemSize); };
      if (S.timer) clearInterval(S.timer);
      // imitates a running program: a few cells change every 40 ms
      S.timer = setInterval(() => {
        if (!S.mutating) return;
        S.ticks++;
        const g = regs.find(r => r.name === 'grid'), b = regs.find(r => r.name === 'balls'), big = regs.find(r => r.name === 'big'), fb = regs.find(r => r.name === 'fb');
        if (g) { S.put(g.id, 0, null, S.ticks); S.put(g.id, 5, null, S.ticks * 2); }
        if (b) S.put(b.id, 1, 'x', S.ticks / 2);
        if (big) S.put(big.id, 3, null, S.ticks & 0xffff);
        if (fb) dv.setUint8(fb.base + 20, S.ticks & 255);
      }, 40);
      return regs.length;
    },
    uninstall() { ['_emitRegions', '_emitRegionRead', '_emitRegionWrite', '_emitRegionFreeze', '_emitRegionBytes'].forEach(n => { try { delete window[n]; } catch (e) {} window[n] = undefined; }); },
  };
};

async function openIde(browser, fileUrl, mode) {
  const ctx = await browser.newContext(mode);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message.slice(0, 300)));
  page.on('dialog', d => d.accept());
  await page.route(/^https?:/, route => route.abort());
  await page.addInitScript(STUB);
  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof compileAndRun === 'function' && typeof _projLoad === 'function' && typeof EX === 'object');
  await page.waitForTimeout(150);
  await page.evaluate(() => { try { closeWelcome(); } catch (e) {} });
  return page;
}
const setEditor = (page, text) => page.evaluate(t => { const ed = document.getElementById('editor'); ed.value = t; ed.dispatchEvent(new Event('input')); }, text);
const PROG = 'export fn go() {\n  canvas(20, 20)\n  animate()\n}\n\nexport fn frame() {\n  clear()\n}\n';
async function runProg(page) { await setEditor(page, PROG); await page.evaluate(() => compileAndRun()); await page.waitForTimeout(300); }
const memTab = page => page.evaluate(() => { showView('run'); showOTab(document.querySelector('.otab[data-t="memory"]')); });
const reads = page => page.evaluate(() => window.__memStub.reads);
const card = (page, name) => page.evaluate(n => {
  const c = _mem.cards.find(c => c.r.name === n); if (!c) return null;
  return { n: c.n, head: c.el.querySelector('.mtog').innerText, mod: (c.el.querySelector('.mmod') || {}).textContent || '', lock: c.el.querySelector('.mlock').textContent,
    open: c.body.style.display !== 'none', frozenNote: !!c.body.querySelector('.mfz') && c.body.querySelector('.mfz').style.display !== 'none',
    cells: c.body.querySelectorAll('.mc').length, tds: c.body.querySelectorAll('.mtd').length, rows: c.body.querySelectorAll('.mdr').length,
    range: (c.body.querySelector('.mrange') || {}).textContent || '', err: c.body.querySelector('.merr.show') ? c.body.querySelector('.merr').textContent : '',
    vals: [...c.body.querySelectorAll('.mc .mv, .mtd')].slice(0, 12).map(e => e.textContent), modes: [...c.body.querySelectorAll('[data-act="mode"]')].map(b => b.textContent + (b.classList.contains('on') ? '*' : '')) };
}, name);
const cardBox = (page, name) => page.evaluate(n => '.mcard[data-n="' + _mem.cards.find(c => c.r.name === n).n + '"]', name);
async function tap(page, sel, mobile) {
  const el = await page.$(sel);
  if (!el) throw new Error('no element ' + sel);
  await el.scrollIntoViewIfNeeded();
  if (mobile) await el.tap(); else await el.click();
  await page.waitForTimeout(60);
}
async function openCard(page, name, mobile) { const c = await card(page, name); if (!c.open) await tap(page, (await cardBox(page, name)) + ' .mtog', mobile); }
async function closeCard(page, name, mobile) { const c = await card(page, name); if (c.open) await tap(page, (await cardBox(page, name)) + ' .mtog', mobile); }
// Tap cell #k of region `name` (k-th cell on the page), type, Enter
async function poke(page, name, k, text, mobile, key = 'Enter') {
  const box = await cardBox(page, name);
  await tap(page, box + ' :is(.mc,.mtd) >> nth=' + k, mobile);
  const inp = await page.$(box + ' .medit input');
  if (!inp) return { opened: false };
  const im = await inp.getAttribute('inputmode');
  await inp.fill(text);
  await page.keyboard.press(key);
  await page.waitForTimeout(80);
  return { opened: true, inputmode: im };
}
const domCells = page => page.evaluate(() => document.querySelectorAll('#tab-memory .mc, #tab-memory .mtd').length + document.querySelectorAll('#tab-memory .mdr').length * 16);
const overflow = page => page.evaluate(() => ({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, ob: document.querySelector('.out-body').scrollWidth - document.querySelector('.out-body').clientWidth, w: innerWidth }));

async function panelChecks(browser, fileUrl, mode, P) {
  const mobile = !!mode.hasTouch;
  const page = await openIde(browser, fileUrl, mode);
  let r, c;

  // ── the tab row ──
  await page.evaluate(() => showView('run'));
  r = await page.evaluate(() => {
    const row = document.querySelector('.out-tabs'), tabs = [...row.querySelectorAll('.otab')];
    return { names: tabs.map(t => t.textContent.trim()), rowW: row.clientWidth, scrollW: row.scrollWidth, right: Math.max(...tabs.map(t => t.getBoundingClientRect().right)), rowRight: row.getBoundingClientRect().right, scrollable: getComputedStyle(row).overflowX };
  });
  check(P + 'Output has five tabs, MEMORY last', r.names.join() === 'Output,WASM,AST,Tokens,Memory', r.names.join());
  check(P + 'the tab row fits (or scrolls sideways) at this width', (r.scrollW <= r.rowW && r.right <= r.rowRight + 1) || r.scrollable === 'auto', JSON.stringify(r));
  // the other four still work
  for (const t of ['wasm', 'ast', 'tokens', 'output']) {
    await tap(page, '.otab[data-t="' + t + '"]', mobile);
    r = await page.evaluate(t => ({ shown: [...document.querySelectorAll('.out-body > .output')].filter(o => o.style.display !== 'none').map(o => o.id), active: document.querySelector('.otab.active').dataset.t }), t);
    check(P + 'tab ' + t + ' still shows only its own panel', r.shown.join() === 'tab-' + t && r.active === t, JSON.stringify(r));
  }

  // ── empty states ──
  await page.evaluate(() => window.__memStub.uninstall());
  await tap(page, '.otab[data-t="memory"]', mobile);
  r = await page.evaluate(() => document.getElementById('tab-memory').innerText);
  check(P + 'without the region API the tab explains regions', /No memory regions in this program/.test(r) && /region grid: int\[64\]/.test(r) && /no region support yet/.test(r), r);
  check(P + 'no dot on MEMORY without regions', !(await page.evaluate(() => document.getElementById('memDot').classList.contains('show'))));
  await page.evaluate(() => window.__memStub.install({ regions: [] }));
  await tap(page, '.otab[data-t="output"]', mobile); await tap(page, '.otab[data-t="memory"]', mobile);
  r = await page.evaluate(() => document.getElementById('tab-memory').innerText);
  check(P + 'with the API but no regions: the same note, without the "no support" line', /No memory regions/.test(r) && !/no region support/.test(r), r);

  // ── cards ──
  await page.evaluate(() => window.__memStub.install());
  await tap(page, '.otab[data-t="output"]', mobile);
  await runProg(page);
  check(P + 'after Run the MEMORY tab has a dot', await page.evaluate(() => document.getElementById('memDot').classList.contains('show')));
  await memTab(page);
  r = await page.evaluate(() => ({ cards: [...document.querySelectorAll('#tab-memory .mcard .mname')].map(e => e.firstChild.nextSibling.textContent), sum: document.querySelector('#tab-memory .msum').innerText }));
  check(P + 'one card per region, in declaration order', r.cards.join() === 'fb,grid,balls,big,locked,w16,w32,d32,temps,nums,flags', JSON.stringify(r));
  check(P + 'summary: region count and total size, live while running', /11 regions/i.test(r.sum) && /KB/.test(r.sum) && /live/i.test(r.sum), r.sum);
  c = await card(page, 'fb');
  const fbBase = await page.evaluate(() => window.__memStub.regs[0].base.toString(16));
  check(P + 'header: name, type[length], bytes, base address in hex', /fb/.test(c.head) && /u8\[12288\]/.test(c.head) && /12 KB/.test(c.head) && c.head.indexOf('@0x' + fbBase) >= 0 && c.mod === '', c.head);
  c = await card(page, 'balls');
  check(P + 'a region of another module shows the module; a struct shows its type and field count', c.mod === 'game.physics' && /Ball\[100\]/.test(c.head) && /9 fields/.test(c.head) && /3\.9 KB/.test(c.head), c.head + ' | ' + c.mod);
  r = await page.evaluate(() => _mem.cards.map(c => c.r.name + ':' + (c.body.style.display !== 'none' ? 'open' : 'closed')).join(' '));
  check(P + 'regions of up to 64 cells start open, bigger ones closed', r === 'fb:closed grid:open balls:closed big:closed locked:open w16:open w32:open d32:open temps:open nums:open flags:open', r);
  c = await card(page, 'locked');
  check(P + 'a frozen region shows 🔒 and says that a poke overrides the lock', c.lock === '🔒' && c.frozenNote && /front panel write/.test(await page.evaluate(() => document.querySelector('.mcard.frozen .mfz').textContent)), JSON.stringify(c));
  c = await card(page, 'grid');
  check(P + 'an unfrozen region shows 🔓, no note', c.lock === '🔓' && !c.frozenNote);
  // lock toggling
  const gb = await cardBox(page, 'grid');
  await tap(page, gb + ' .mlock', mobile);
  r = await page.evaluate(() => window.__memStub.regs[1].frozen);
  c = await card(page, 'grid');
  check(P + 'tapping 🔓 freezes the region through _emitRegionFreeze', r === true && c.lock === '🔒' && c.frozenNote && await page.evaluate(b => document.querySelector(b + ' .mlock').getAttribute('aria-pressed'), gb) === 'true', JSON.stringify([r, c.lock]));
  await tap(page, gb + ' .mlock', mobile);
  c = await card(page, 'grid');
  check(P + 'tapping 🔒 thaws it again', !(await page.evaluate(() => window.__memStub.regs[1].frozen)) && c.lock === '🔓' && !c.frozenNote);
  await page.evaluate(() => { window.__memStub.regs[1].frozen = true; });
  await page.waitForTimeout(400);
  c = await card(page, 'grid');
  check(P + 'a freeze by the program shows up live on the card', c.lock === '🔒' && c.frozenNote, c.lock);
  await page.evaluate(() => { window.__memStub.regs[1].frozen = false; });
  await page.waitForTimeout(300);
  // values
  c = await card(page, 'grid');
  check(P + 'scalar cells show index and value', c.cells === 64 && c.vals.slice(0, 4).join() === '0,3,6,9' && await page.evaluate(b => document.querySelector(b + ' .mc .mi').textContent, gb) === '0', JSON.stringify(c.vals));
  r = await page.evaluate(b => { const el = document.querySelector(b + ' .mc:nth-child(3)'); const s = getComputedStyle(el); return { align: s.textAlign, font: s.fontFamily, w: el.getBoundingClientRect().width }; }, gb);
  check(P + 'values are right-aligned in mono', r.align === 'right' && /Mono|mono/.test(r.font), JSON.stringify(r));
  c = await card(page, 'temps');
  check(P + 'f32 / num / bool cells format their values', c.vals.slice(0, 2).join() === '0.5,1.5' && (await card(page, 'flags')).vals.slice(0, 3).join() === 'true,false,false', JSON.stringify([c.vals, (await card(page, 'flags')).vals]));
  await page.screenshot({ path: path.join(__dirname, '.memtab-tmp.png') });

  // ── paging on 100,000 cells ──
  await openCard(page, 'big', mobile);
  c = await card(page, 'big');
  check(P + 'a big region shows one page of 256 cells and a pager', c.cells === 256 && /^0–255 of 100000$/.test(c.range) && c.vals[1] === '3', JSON.stringify([c.cells, c.range]));
  const bb = await cardBox(page, 'big');
  await tap(page, bb + ' [data-act="next"]', mobile);
  c = await card(page, 'big');
  check(P + 'next page', /^256–511 of 100000$/.test(c.range) && c.vals[0] === '768', c.range + ' ' + c.vals[0]);
  await tap(page, bb + ' [data-act="last"]', mobile);
  c = await card(page, 'big');
  check(P + 'last page', /^99840–99999 of 100000$/.test(c.range) && c.cells === 160, c.range + ' ' + c.cells);
  await tap(page, bb + ' [data-act="prev"]', mobile);
  check(P + 'previous page', /^99584–99839/.test((await card(page, 'big')).range));
  await tap(page, bb + ' [data-act="first"]', mobile);
  check(P + 'first page', /^0–255/.test((await card(page, 'big')).range));
  await page.fill(bb + ' .mgoto', '54321');
  await page.press(bb + ' .mgoto', 'Enter');
  await page.waitForTimeout(80);
  c = await card(page, 'big');
  r = await page.evaluate(b => { const t = document.querySelector(b + ' .mc.mtarget'); return t ? t.getAttribute('data-i') : null; }, bb);
  check(P + 'go to index 54321 opens its page and marks the cell', /^54272–54527/.test(c.range) && r === '54321', c.range + ' ' + r);
  await page.fill(bb + ' .mgoto', '100000');
  await page.press(bb + ' .mgoto', 'Enter');
  await page.waitForTimeout(80);
  c = await card(page, 'big');
  check(P + 'go to an index outside the region: an inline error, the page stays', /outside 0 … 99999/.test(c.err) && /^54272/.test(c.range), c.err);
  // the cap
  await openCard(page, 'fb', mobile); await openCard(page, 'balls', mobile);
  r = await domCells(page);
  check(P + 'with every card open, at most ~600 value cells exist in the DOM', r <= 600 && r > 300, r);
  c = await card(page, 'nums');
  check(P + 'later cards still render within the cap (small ones need little)', c.cells === 8, JSON.stringify(c));
  await closeCard(page, 'balls', mobile);
  r = await page.evaluate(() => _mem.cards.find(c => c.r.name === 'balls').body.childElementCount);
  check(P + 'a closed card costs nothing (empty body)', r === 0, r);

  // ── display modes ──
  await tap(page, gb + ' [data-act="mode"][data-m="hex"]', mobile);
  c = await card(page, 'grid');
  check(P + 'grid: dec/hex modes; hex shows 64-bit two\'s complement digits', c.modes.join() === 'dec,hex*' && c.vals[1] === '0000000000000003', JSON.stringify(c));
  await tap(page, gb + ' [data-act="mode"][data-m="dec"]', mobile);
  const fbb = await cardBox(page, 'fb');
  c = await card(page, 'fb');
  check(P + 'u8 region: dec, hex, ascii, dump, pixels', c.modes.join() === 'dec*,hex,ascii,dump,pixels', c.modes.join());
  await tap(page, fbb + ' [data-act="mode"][data-m="ascii"]', mobile);
  c = await card(page, 'fb');
  check(P + 'ascii mode shows characters', c.vals.slice(0, 5).join('') === "'H''e''l''l''o'", c.vals.slice(0, 6).join(' '));
  await tap(page, fbb + ' [data-act="mode"][data-m="dump"]', mobile);
  r = await page.evaluate(b => [...document.querySelectorAll(b + ' .mdr')].slice(0, 2).map(e => e.textContent), fbb);
  check(P + 'hex dump: offset, 16 bytes, ASCII gutter', /^000000  48 65 6c 6c 6f 2c 20 6d  65 6d 6f 72 79 21 [0-9a-f]{2} [0-9a-f]{2}  Hello, memory!..$/.test(r[0]) && /^000010 /.test(r[1]), JSON.stringify(r));
  r = await page.evaluate(b => { const d = document.querySelector(b + ' .mdump'); return { sw: d.scrollWidth, cw: d.clientWidth, rows: d.children.length }; }, fbb);
  check(P + 'the dump pages too (16 rows = 256 bytes at most)', r.rows <= 16 && r.rows > 0, JSON.stringify(r));
  await tap(page, fbb + ' .mdr >> nth=1', mobile);
  c = await card(page, 'fb');
  check(P + 'tapping a dump row opens those bytes as hex cells', c.modes.join().indexOf('hex*') >= 0 && /^0–/.test(c.range) && c.vals[0] === '48' && await page.evaluate(b => !!document.querySelector(b + ' .mc[data-i="16"]'), fbb), JSON.stringify(c));
  await tap(page, fbb + ' [data-act="mode"][data-m="pixels"]', mobile);
  r = await page.evaluate(b => { const cv = document.querySelector(b + ' canvas.mpx'); return cv ? { w: cv.width, h: cv.height, lab: document.querySelector(b + ' .mpxh').textContent, val: document.querySelector(b + ' .mpxw').value } : null; }, fbb);
  check(P + 'pixel preview: guesses a width that fits, draws a canvas', r && r.w === 64 && r.h === 48 && r.val === '64' && /48/.test(r.lab), JSON.stringify(r));
  await page.fill(fbb + ' .mpxw', '32');
  await page.press(fbb + ' .mpxw', 'Enter');
  await page.waitForTimeout(60);
  r = await page.evaluate(b => { const cv = document.querySelector(b + ' canvas.mpx'); const px = cv.getContext('2d').getImageData(0, 0, 1, 1).data; return { w: cv.width, h: cv.height, px: [...px] }; }, fbb);
  check(P + 'typing a width re-shapes the preview; pixels are the region bytes (RGBA)', r.w === 32 && r.h === 96 && [72, 101, 108].every((v, i) => Math.abs(r.px[i] - v) <= 3) && r.px[3] === 108 /* alpha 108: the canvas rounds premultiplied colour */, JSON.stringify(r));
  await tap(page, fbb + ' [data-act="mode"][data-m="dec"]', mobile);
  await closeCard(page, 'fb', mobile);

  // ── struct table ──
  await openCard(page, 'balls', mobile);
  const blb = await cardBox(page, 'balls');
  r = await page.evaluate(b => ({ heads: [...document.querySelectorAll(b + ' th')].map(t => t.innerText.replace(/\s+/g, ' ')), rows: document.querySelectorAll(b + ' tbody tr').length, first: [...document.querySelectorAll(b + ' tbody tr:nth-child(2) td')].map(t => t.textContent) }), blb);
  check(P + 'struct table: one column per flattened field, name and type in the header', r.heads.join('|') === '#|x num|y num|r i32|hp i16|tint u8|alive bool|pos.x f32|pos.y f32|id int', r.heads.join('|'));
  check(P + 'struct rows: one per element (windowed), values per field', r.rows >= 8 && r.rows <= 64 && r.first.join() === '1,1.5,99,5,-1,1,false,0.25,0,1001', JSON.stringify(r));
  c = await card(page, 'balls');
  check(P + 'struct regions page like scalar ones', /^0–\d+ of 100$/.test(c.range), c.range);
  r = await page.evaluate(b => { const w = document.querySelector(b + ' .mtw'); const ob = document.querySelector('.out-body'); const before = [ob.scrollLeft, document.scrollingElement.scrollLeft]; w.scrollLeft = 400; return { sw: w.scrollWidth, cw: w.clientWidth, sl: w.scrollLeft, before, after: [ob.scrollLeft, document.scrollingElement.scrollLeft], ox: getComputedStyle(w).overflowX, ob: ob.scrollWidth - ob.clientWidth }; }, blb);
  if (mobile) check(P + 'the table scrolls sideways inside its card, the page does not', r.sw > r.cw && r.sl > 0 && r.after.join() === '0,0' && r.ob <= 0 && r.ox === 'auto', JSON.stringify(r));
  else check(P + 'the table sits in a sideways-scrolling box; the page never scrolls sideways', r.ox === 'auto' && r.after.join() === '0,0' && r.ob <= 0, JSON.stringify(r));
  if (mobile) {
    // a real swipe on the table
    const bx = await page.evaluate(b => { const t = document.querySelector(b + ' .mtw').getBoundingClientRect(); return { x: t.left + t.width * 0.7, y: t.top + 30 }; }, blb);
    await page.evaluate(b => { document.querySelector(b + ' .mtw').scrollLeft = 0; }, blb);
    const cdp = await page.context().newCDPSession(page);
    const pt = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(bx.x, bx.y) });
    for (let k = 1; k <= 10; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(bx.x - k * 18, bx.y) }); await page.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);
    r = await page.evaluate(b => ({ sl: document.querySelector(b + ' .mtw').scrollLeft, ob: document.querySelector('.out-body').scrollLeft, doc: document.scrollingElement.scrollLeft }), blb);
    check(P + 'a sideways swipe moves the table, not the page', r.sl > 0 && r.ob === 0 && r.doc === 0, JSON.stringify(r));
  }
  r = await overflow(page);
  check(P + 'nothing overflows the viewport horizontally', r.doc <= r.w && r.body <= r.w && r.ob <= 0, JSON.stringify(r));

  // ── poke ──
  await page.evaluate(() => { window.__memStub.writes = []; });
  r = await poke(page, 'grid', 2, '-42', mobile);
  c = await card(page, 'grid');
  r.w = await page.evaluate(() => window.__memStub.writes.slice(-1)[0]);
  check(P + 'poke int: tap, type, Enter writes through _emitRegionWrite', r.opened && c.vals[2] === '-42' && r.w && r.w.id === 1 && r.w.i === 2 && r.w.v === -42 && await page.evaluate(() => window.__memStub.get(1, 2)) === -42, JSON.stringify(r) + ' ' + c.vals[2]);
  check(P + 'the poke editor asks for the numeric keypad', r.inputmode === 'numeric', r.inputmode);
  check(P + 'a successful poke flashes the cell', await page.evaluate(b => document.querySelector(b + ' .mc:nth-child(3)').classList.contains('mpk'), gb));
  r = await poke(page, 'grid', 3, '9007199254740993', mobile);
  r.w = await page.evaluate(() => window.__memStub.writes.slice(-1)[0]);
  c = await card(page, 'grid');
  check(P + 'poke a 64-bit value beyond the safe integer range: string in, string out', r.w.v === '9007199254740993' && c.vals[3] === '9007199254740993' && await page.evaluate(() => window.__memStub.get(1, 3)) === '9007199254740993', JSON.stringify(r) + ' ' + c.vals[3]);
  r = await poke(page, 'grid', 4, '-9223372036854775808', mobile);
  check(P + 'the smallest int64 is accepted', (await card(page, 'grid')).vals[4] === '-9223372036854775808');
  r = await poke(page, 'grid', 5, '9223372036854775808', mobile);
  c = await card(page, 'grid');
  check(P + 'int64 overflow is refused with an inline error, editor stays open', /out of range/.test(c.err) && /nothing written/.test(c.err) && await page.$(gb + ' .medit input') !== null, c.err);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(60);
  c = await card(page, 'grid');
  check(P + 'Escape cancels: no editor, value unchanged', await page.$(gb + ' .medit') === null && c.vals[5] === '15', c.vals[5]);
  // each scalar kind
  const kinds = [['w16', '-32768', '-32768', 'numeric'], ['w32', '-2147483648', '-2147483648', 'numeric'], ['d32', '4294967295', '4294967295', 'numeric'], ['temps', '2.5', '2.5', 'decimal'], ['nums', '3.14159', '3.14159', 'decimal']];
  for (const [n, txt, want, im] of kinds) {
    r = await poke(page, n, 1, txt, mobile);
    c = await card(page, n);
    check(P + 'poke ' + n + ' (' + (await page.evaluate(n => _mem.cards.find(c => c.r.name === n).r.elem, n)) + ') = ' + txt, r.opened && c.vals[1] === want && r.inputmode === im, JSON.stringify([r, c.vals[1]]));
  }
  r = await poke(page, 'd32', 2, '-1', mobile);
  c = await card(page, 'd32');
  check(P + 'u32 refuses a negative value', /out of range 0 … 4294967295/.test(c.err) && await page.evaluate(() => window.__memStub.get(7, 2)) === 6, c.err);
  await page.keyboard.press('Escape');
  r = await poke(page, 'temps', 2, '1.2.3', mobile);
  c = await card(page, 'temps');
  check(P + 'f32 refuses text that is not a number', /not a number/.test(c.err), c.err);
  await page.keyboard.press('Escape');
  // u8 via the big fb region (dec)
  await openCard(page, 'fb', mobile);
  r = await poke(page, 'fb', 0, '255', mobile);
  check(P + 'poke u8 = 255', (await card(page, 'fb')).vals[0] === '255');
  r = await poke(page, 'fb', 1, '256', mobile);
  c = await card(page, 'fb');
  check(P + 'u8 refuses 256', /out of range 0 … 255/.test(c.err) && await page.evaluate(() => window.__memStub.get(0, 1)) === 101, c.err);
  await page.keyboard.press('Escape');
  r = await poke(page, 'fb', 1, "'A'", mobile);
  check(P + "u8 takes a character literal 'A'", (await card(page, 'fb')).vals[1] === '65');
  await closeCard(page, 'fb', mobile);
  // bool
  const flb = await cardBox(page, 'flags');
  await tap(page, flb + ' .mc >> nth=0', mobile);
  c = await card(page, 'flags');
  check(P + 'tapping a bool cell toggles it (true -> false)', c.vals[0] === 'false' && await page.evaluate(() => window.__memStub.get(10, 0)) === false && await page.$(flb + ' .medit') === null, c.vals[0]);
  await tap(page, flb + ' .mc >> nth=0', mobile);
  check(P + 'and back (false -> true)', (await card(page, 'flags')).vals[0] === 'true');
  // frozen region: poke still writes, and says so
  r = await poke(page, 'locked', 1, '0xff', mobile);
  c = await card(page, 'locked');
  check(P + 'poke on a frozen region succeeds (hex 0xff into i8 = -1) and is labelled a front panel write', c.vals[1] === '-1' && await page.evaluate(() => window.__memStub.get(4, 1)) === -1 && /front panel write/.test(c.err) && await page.evaluate(() => window.__memStub.regs[4].frozen) === true, JSON.stringify([c.vals[1], c.err]));
  // struct field poke
  await openCard(page, 'balls', mobile);
  r = await poke(page, 'balls', 3, '7', mobile);   // row 0, column r (index 3 in the row: x, y, r) -> 3rd td is r
  c = await card(page, 'balls');
  r.w = await page.evaluate(() => window.__memStub.writes.slice(-1)[0]);
  check(P + 'poke a struct field writes (id, index, field, value)', r.w && r.w.id === 2 && r.w.i === 0 && r.w.f === 'hp' && r.w.v === 7, JSON.stringify(r.w));
  await closeCard(page, 'balls', mobile);
  // blur commits
  await tap(page, gb + ' .mc >> nth=6', mobile);
  await page.fill(gb + ' .medit input', '77');
  await tap(page, '#tab-memory .msum', mobile);
  check(P + 'leaving the editor (blur) commits too', (await card(page, 'grid')).vals[6] === '77');

  // ── live refresh ──
  r = await page.evaluate(async b => {
    const cells = [...document.querySelectorAll(b + ' .mc')];
    const touched = new Set();
    const mo = new MutationObserver(list => list.forEach(m => { const c = (m.target.nodeType === 1 ? m.target : m.target.parentNode).closest('.mc'); if (c) touched.add(c.getAttribute('data-i')); }));
    mo.observe(document.querySelector(b + ' .mgrid'), { subtree: true, childList: true, characterData: true });
    const before = window.__memStub.reads;
    window.__memStub.mutating = true;
    await new Promise(ok => setTimeout(ok, 900));
    window.__memStub.mutating = false;
    await new Promise(ok => setTimeout(ok, 250));
    mo.disconnect();
    const flash = cells.filter(c => c.classList.contains('mfa') || c.classList.contains('mfb')).map(c => c.getAttribute('data-i'));
    const perRefresh = document.querySelectorAll('#tab-memory .mc, #tab-memory .mtd').length + document.querySelectorAll('#tab-memory .mdr, #tab-memory canvas.mpx').length;
    return { touched: [...touched].sort(), flash, reads: window.__memStub.reads - before, perRefresh, refreshes: (window.__memStub.reads - before) / perRefresh, v0: cells[0].lastChild.textContent, ticks: window.__memStub.ticks };
  }, gb);
  check(P + 'live refresh updates changed cells only (grid[0], grid[5])', r.touched.join() === '0,5' && r.v0 === String(r.ticks), JSON.stringify(r));
  check(P + 'changed cells flash', r.flash.join() === '0,5', JSON.stringify(r.flash));
  check(P + 'refresh is throttled (~6 Hz over 1.15 s, not every frame)', r.refreshes >= 2 && r.refreshes <= 10, JSON.stringify([r.reads, r.perRefresh, r.refreshes]));
  // costs nothing when hidden
  await page.evaluate(() => { window.__memStub.mutating = true; });
  await tap(page, '.otab[data-t="wasm"]', mobile);
  let r0 = await reads(page); await page.waitForTimeout(700); let r1 = await reads(page);
  check(P + 'no region reads while another Output tab is selected', r1 === r0, r1 - r0);
  await tap(page, '.otab[data-t="memory"]', mobile);
  r0 = await reads(page); await page.waitForTimeout(400); r1 = await reads(page);
  check(P + 'reads resume when the tab is shown again', r1 > r0, r1 - r0);
  if (mobile) {
    await page.evaluate(() => showView('edit'));
    r0 = await reads(page); await page.waitForTimeout(700); r1 = await reads(page);
    check(P + 'no region reads while the editor view is shown', r1 === r0, r1 - r0);
    await page.evaluate(() => showView('run'));
  }
  // Stop / Run
  await page.evaluate(() => stopProgram());
  await page.waitForTimeout(300);
  r0 = await reads(page); await page.waitForTimeout(700); r1 = await reads(page);
  const liveTxt = await page.evaluate(() => document.querySelector('#tab-memory .mlive').textContent);
  check(P + 'after Stop the refresh stops (the program no longer runs)', r1 === r0 && liveTxt === '', JSON.stringify([r1 - r0, liveTxt]));
  r = await poke(page, 'grid', 9, '123', mobile);
  check(P + 'poking still works after Stop', (await card(page, 'grid')).vals[9] === '123');
  await page.evaluate(() => compileAndRun());
  await page.waitForTimeout(300);
  await memTab(page);
  r0 = await reads(page); await page.waitForTimeout(500); r1 = await reads(page);
  check(P + 'Run again: refresh resumes', r1 > r0 && await page.evaluate(() => document.querySelector('#tab-memory .mlive').textContent) === '● live', r1 - r0);
  check(P + 'a re-run of the same program keeps the cards (and which are open)', (await card(page, 'big')).open && (await card(page, 'grid')).open);
  await page.evaluate(() => { window.__memStub.mutating = false; stopProgram(); });
  r = await overflow(page);
  check(P + 'nothing overflows horizontally after all that', r.doc <= r.w && r.ob <= 0, JSON.stringify(r));
  if (mobile) {
    // a representative view: the scalar grid closed, the struct table and the small regions open
    await closeCard(page, 'big', true); await closeCard(page, 'grid', true); await openCard(page, 'balls', true);
    await page.evaluate(() => { document.querySelector('.out-body').scrollTop = 0; });
    await page.waitForTimeout(3000);   // inline messages and flashes fade first
    const shot = path.join(__dirname, 'memtab-phone.png');
    await page.screenshot({ path: shot, type: 'png' });
    const size = fs.statSync(shot).size;
    if (size > 100 * 1024) { await page.screenshot({ path: shot.replace(/png$/, 'jpg'), type: 'jpeg', quality: 70 }); fs.unlinkSync(shot); }
    const kept = fs.existsSync(shot) ? shot : shot.replace(/png$/, 'jpg');
    check(P + 'phone screenshot of the Memory tab saved (' + path.basename(kept) + ', ' + Math.round(fs.statSync(kept).size / 1024) + ' KB)', fs.statSync(kept).size < 100 * 1024);
  }
  try { fs.unlinkSync(path.join(__dirname, '.memtab-tmp.png')); } catch (e) {}
  // a different program rebuilds the cards; no regions -> note again
  await page.evaluate(() => window.__memStub.install({ regions: [{ name: 'solo', elem: 'u8', length: 4 }] }));
  await tap(page, '.otab[data-t="output"]', mobile); await tap(page, '.otab[data-t="memory"]', mobile);
  r = await page.evaluate(() => [...document.querySelectorAll('#tab-memory .mcard')].length + ':' + document.querySelector('#tab-memory .mname').textContent);
  check(P + 'another program (other regions) rebuilds the cards when the tab is shown', /^1:/.test(r) && /solo/.test(r), r);
  check(P + 'no page errors', !page.errors.length, page.errors.join(' | '));
  await page.context().close();
}

async function errorJumpChecks(browser, fileUrl, mode, P) {
  const mobile = !!mode.hasTouch;
  const page = await openIde(browser, fileUrl, mode);
  let r;
  // single-file
  await setEditor(page, 'region grid: int[64]\n\nexport fn go() {\n  print(1)\n  grid[70] = 1\n}\n');
  await page.evaluate(() => { showView('run'); });
  await page.evaluate(() => { const d = document.createElement('div'); d.style.cssText = 'color:#ef4444;padding:2px 12px;font-family:var(--mono);font-size:11px;'; d.textContent = '✗ grid[70]: index out of range (length 64) at main.emit:5:3'; document.getElementById('tab-output').appendChild(d); });
  await page.waitForTimeout(50);
  r = await page.evaluate(() => { const a = document.querySelector('#tab-output .mat'); return a ? { t: a.textContent, line: a.parentNode.textContent } : null; });
  check(P + 'a red runtime line gets its "at path:line:col" as a link, text unchanged', r && r.t === 'main.emit:5:3' && r.line === '✗ grid[70]: index out of range (length 64) at main.emit:5:3', JSON.stringify(r));
  await tap(page, '#tab-output .mat', mobile);
  r = await page.evaluate(() => { const ed = document.getElementById('editor'); const b = ed.value.substring(0, ed.selectionStart); return { line: b.split('\n').length, sel: ed.value.substring(ed.selectionStart, ed.selectionEnd), edit: document.getElementById('pnl-edit').className }; });
  check(P + 'tapping it jumps to the line (single file)', r.line === 5 && r.sel === '  grid[70] = 1' && (!mobile || r.edit === 'pnl'), JSON.stringify(r));
  await page.evaluate(() => { showView('run'); const d = document.createElement('div'); d.textContent = '✗ write to frozen region grid at 4:3'; document.getElementById('tab-output').appendChild(d); });
  await page.waitForTimeout(50);
  await tap(page, '#tab-output .mat >> nth=1', mobile);
  r = await page.evaluate(() => { const ed = document.getElementById('editor'); return ed.value.substring(0, ed.selectionStart).split('\n').length; });
  check(P + '"at line:col" without a path works in a single-file program', r === 4, r);
  await page.evaluate(() => { const d = document.createElement('div'); d.textContent = '✓ all fine at 3:1'; document.getElementById('tab-output').appendChild(d); const e = document.createElement('div'); e.textContent = '✗ no position here'; document.getElementById('tab-output').appendChild(e); });
  await page.waitForTimeout(30);
  check(P + 'lines that are not ✗ errors, or have no position, are left alone', await page.evaluate(() => document.querySelectorAll('#tab-output .mat').length) === 2);
  // multi-file
  const BUNDLE = 'import game.physics\n\nexport fn go() {\n  physics.step()\n}\n//// file: game/physics.emit\npackage game\n\npublic fn step() {\n  print(1)\n  print(2)\n}\n';
  await setEditor(page, BUNDLE);
  await page.evaluate(() => { showView('run'); _projSetActive(0); const d = document.createElement('div'); d.style.color = '#ef4444'; d.textContent = '✗ write to frozen region grid at game/physics.emit:5:3'; document.getElementById('tab-output').appendChild(d); });
  await page.waitForTimeout(50);
  await tap(page, '#tab-output .mat >> nth=-1', mobile);
  r = await page.evaluate(() => { const ed = document.getElementById('editor'); return { path: _proj.files[_proj.active].path, line: ed.value.substring(0, ed.selectionStart).split('\n').length, sel: ed.value.substring(ed.selectionStart, ed.selectionEnd) }; });
  check(P + 'multi-file: the link opens game/physics.emit at the line', r.path === 'game/physics.emit' && r.line === 5 && r.sel === '  print(2)', JSON.stringify(r));
  await page.evaluate(() => { showView('run'); const d = document.createElement('div'); d.textContent = '✗ boom at nowhere/else.emit:2:1'; document.getElementById('tab-output').appendChild(d); });
  await page.waitForTimeout(30);
  await tap(page, '#tab-output .mat >> nth=-1', mobile);
  check(P + 'a path that is not in the project falls back to the line of the open file', !page.errors.length && await page.evaluate(() => { const ed = document.getElementById('editor'); return ed.value.substring(0, ed.selectionStart).split('\n').length; }) === 2);
  check(P + 'no page errors (error links)', !page.errors.length, page.errors.join(' | '));
  await page.context().close();
}

// ── editor support ──
async function editorChecks(browser, fileUrl, mode, P) {
  const page = await openIde(browser, fileUrl, mode);
  let r, p;
  const popup = () => page.evaluate(() => { const el = document.getElementById('acPopup'); return el.classList.contains('show') ? [...el.querySelectorAll('.ac-item')].map(i => ({ name: i.querySelector('.ac-name').textContent, desc: i.querySelector('.ac-desc').textContent })) : []; });
  const names = p => p.map(x => x.name);
  async function typeAt(text, src) {
    if (src !== undefined) await setEditor(page, src);
    await page.evaluate(() => { hideAC(); if (innerWidth < 768) showView('edit'); const ed = document.getElementById('editor'); ed.focus(); ed.selectionStart = ed.selectionEnd = ed.value.length; });
    await page.keyboard.type(text, { delay: 10 });
    await page.waitForTimeout(500);
    await page.evaluate(() => checkAC());
    await page.waitForTimeout(60);
    return popup();
  }
  // highlighting
  await setEditor(page, 'struct Ball { x: num, hp: i16, t: u8 }\nregion balls: Ball[8]\npublic region grid: u32[4]\nexport fn go() {\n  fill(grid, 0)\n  freeze(grid)\n  screen(fb, 8, 8)\n  let a: i8 = 1\n}\n');
  r = await page.evaluate(() => { const o = {}; document.querySelectorAll('#hlInner span').forEach(s => { (o[s.className] = o[s.className] || []).push(s.textContent); }); return o; });
  check(P + 'struct and region are highlighted as keywords', ['struct', 'region'].every(w => (r.kw || []).includes(w)), JSON.stringify(r.kw));
  check(P + 'element types u8 i8 i16 u32 are highlighted as types', ['u8', 'i8', 'i16', 'u32'].every(w => (r.ty || []).includes(w)), JSON.stringify(r.ty));
  check(P + 'fill / freeze / screen are highlighted as builtins', ['fill', 'freeze', 'screen'].every(w => (r.blt || []).includes(w)), JSON.stringify(r.blt));
  r = await page.evaluate(() => ['fill', 'wipe', 'copy', 'swap', 'freeze', 'thaw', 'frozen', 'view', 'screen'].every(n => _emitBlt.has(n)) && ['i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'f32'].every(n => _emitTy.has(n)));
  check(P + 'all nine region builtins and seven element types are in the highlight lists', r);
  // builtin autocomplete with signatures
  p = await typeAt('fre', 'export fn go() {\n  ');
  check(P + 'typing "fre" suggests freeze(r: region)', names(p).some(n => /^freeze\(r: region\)/.test(n)), JSON.stringify(p));
  p = await typeAt('fro', 'export fn go() {\n  ');
  check(P + 'typing "fro" suggests frozen(r: region) bool', names(p).some(n => /^frozen\(r: region\) bool/.test(n)), JSON.stringify(p));
  p = await typeAt('wip', 'export fn go() {\n  ');
  check(P + 'typing "wip" suggests wipe(r: region)', names(p).some(n => /^wipe\(r: region\)/.test(n)), JSON.stringify(p));
  p = await typeAt('scr', 'export fn go() {\n  ');
  check(P + 'typing "scr" suggests screen with its parameters', names(p).some(n => /^screen\(fb: region u8, w: int, h: int/.test(n)), JSON.stringify(p));
  await page.evaluate(() => { const ps = [...document.querySelectorAll('#acPopup .ac-item .ac-name')].map(e => e.textContent); acSel = ps.findIndex(n => /^screen\(fb/.test(n)); updACsel(); });
  await page.keyboard.press('Enter');
  r = await page.evaluate(() => document.getElementById('editor').value.split('\n').pop());
  check(P + 'picking a builtin inserts name and (', r === '  screen(', r);

  // declarations in the file itself (found by scanning, as before the merge)
  const SRC = 'struct Ball { x: num, y: num, alive: bool }\nstruct Wrap { pos: Ball, n: int }\nregion balls: Ball[100]\nregion grid: int[64]\nregion wraps: Wrap[4]\n\nexport fn go() {\n';
  p = await typeAt('region cells: ', SRC);
  check(P + 'after "region name: " element types and struct names are suggested', ['u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'int', 'f32', 'num', 'bool', 'Ball', 'Wrap'].every(n => names(p).includes(n)), JSON.stringify(names(p)));
  p = await typeAt('B');
  check(P + 'typing narrows the type list (B -> Ball)', names(p).join() === 'Ball' || (names(p).includes('Ball') && !names(p).includes('u8')), JSON.stringify(names(p)));
  await page.keyboard.press('Enter');
  r = await page.evaluate(() => { const ed = document.getElementById('editor'); return ed.value.split('\n').pop(); });
  check(P + 'picking a struct name completes it', r === 'region cells: Ball', r);
  p = await typeAt('  balls[i + 1].', SRC);
  check(P + 'after "balls[i + 1]." the struct fields are suggested with their types', names(p).join() === 'x,y,alive' && p[0].desc === 'num · Ball' && p[2].desc === 'bool · Ball', JSON.stringify(p));
  p = await typeAt('a');
  check(P + 'typing narrows the fields', names(p).join() === 'alive', JSON.stringify(p));
  await page.keyboard.press('Enter');
  r = await page.evaluate(() => document.getElementById('editor').value.split('\n').pop());
  check(P + 'picking a field completes it', r === '  balls[i + 1].alive', r);
  p = await typeAt('  wraps[grid[2]].pos.', SRC);
  check(P + 'nested struct fields through a nested index: wraps[grid[2]].pos.', names(p).join() === 'x,y,alive', JSON.stringify(p));
  p = await typeAt('  grid.', SRC);
  check(P + 'after "grid." the region offers length', names(p).join() === 'length' && /int/.test(p[0].desc), JSON.stringify(p));
  p = await typeAt('  x = gr', SRC);
  check(P + 'region names join identifier completion', names(p).includes('grid') && p.find(x => x.name === 'grid').desc === 'region int[64]', JSON.stringify(p));
  p = await typeAt('  let b: Ba', SRC);
  check(P + 'struct names join identifier completion', names(p).includes('Ball'), JSON.stringify(p));
  p = await typeAt('fn sum(r: region ', SRC.replace(/export fn go\(\) \{\n$/, ''));
  check(P + 'after "r: region " (a region parameter) element types are suggested', ['int', 'u8', 'Ball'].every(n => names(p).includes(n)), JSON.stringify(names(p)));
  // snippets
  p = await typeAt('reg', '// x\n');
  check(P + 'typing "reg" at the start of a line offers the region snippet', names(p).includes('region') && p.find(x => x.name === 'region').desc === 'region name: int[64]', JSON.stringify(p));
  await page.evaluate(() => { const ps = [...document.querySelectorAll('#acPopup .ac-item .ac-name')].map(e => e.textContent); acSel = ps.indexOf('region'); updACsel(); });
  await page.keyboard.press('Enter');
  r = await page.evaluate(() => { const ed = document.getElementById('editor'); return { line: ed.value.split('\n').pop(), sel: ed.value.substring(ed.selectionStart, ed.selectionEnd) }; });
  check(P + 'the snippet is inserted with its name selected', r.line === 'region name: int[64]' && r.sel === 'name', JSON.stringify(r));
  p = await typeAt('stru', '// x\n');
  check(P + 'typing "stru" offers the struct snippet', names(p).includes('struct'), JSON.stringify(p));
  p = await typeAt('public re', '// x\n');
  check(P + 'typing "public re" offers public region', names(p).includes('public region'), JSON.stringify(p));
  await page.evaluate(() => { const ps = [...document.querySelectorAll('#acPopup .ac-item .ac-name')].map(e => e.textContent); acSel = ps.indexOf('public region'); updACsel(); });
  await page.keyboard.press('Enter');
  r = await page.evaluate(() => document.getElementById('editor').value.split('\n').pop());
  check(P + 'picking it replaces what was typed on the line', r === 'public region name: int[64]', r);
  p = await typeAt('  x = reg', '// no regions in here\nexport fn go() {\n');
  check(P + 'no snippet in the middle of a line', !names(p).includes('region'), JSON.stringify(p));

  // through the module index (TEST-ONLY wrap adds `structs` / `regions`, as the merged index will) and import aliases
    // (the words region/struct appear only in comments: the declarations come from the wrapped index alone)
  const PROJ = 'import game.physics\nimport game.draw.*\n\nexport fn go() {\n' + '//// file: game/physics.emit\npackage game\n\n// its region and struct come from the index\npublic fn step() {\n}\n' + '//// file: game/draw.emit\npackage game\n\npublic fn render() {\n}\n';
  await setEditor(page, PROJ);
  await page.evaluate(() => {
    if (!window._realIndex) window._realIndex = _emitModuleIndex;
    window._emitModuleIndex = function (t) {
      const i = window._realIndex(t);
      if (i.modules['game.physics']) { i.modules['game.physics'].structs = [{ name: 'Ball', public: true, fields: [{ name: 'x', type: 'num' }, { name: 'y', type: 'num' }, { name: 'hp', type: 'i16' }] }]; i.modules['game.physics'].regions = [{ name: 'balls', public: true, elem: 'Ball', length: 100 }, { name: 'secret', public: false, elem: 'int', length: 4 }]; }
      if (i.modules['game.draw']) { i.modules['game.draw'].structs = []; i.modules['game.draw'].regions = [{ name: 'canvasBuf', public: true, elem: 'u8', length: 1024 }]; }
      return i;
    };
    _projDirty();
  });
  await page.waitForTimeout(450);
  p = await typeAt('  physics.balls[3].');
  check(P + 'through an import alias: physics.balls[3]. lists Ball\'s fields (from the module index)', names(p).join() === 'x,y,hp' && p[2].desc === 'i16 · Ball', JSON.stringify(p));
  p = await typeAt('  physics.balls.', PROJ);
  check(P + 'physics.balls. offers length', names(p).join() === 'length', JSON.stringify(p));
  p = await typeAt('  physics.secret.', PROJ);
  check(P + 'a private region of another module is not offered', !names(p).includes('length'), JSON.stringify(p));
  p = await typeAt('\ncan', PROJ);
  check(P + 'a public region brought in by import game.draw.* joins identifier completion', names(p).includes('canvasBuf'), JSON.stringify(p));
  p = await typeAt('  physics.st', PROJ);
  check(P + 'module member completion still works next to it (physics.st -> step)', names(p).includes('step'), JSON.stringify(p));
  // the index without structs/regions (before the merge) is tolerated
  await page.evaluate(() => { window._emitModuleIndex = function (t) { const i = window._realIndex(t); Object.keys(i.modules).forEach(k => { delete i.modules[k].structs; delete i.modules[k].regions; }); return i; }; _projDirty(); });
  await page.waitForTimeout(450);
  p = await typeAt('  physics.balls[3].', PROJ);
  check(P + 'an index without structs/regions: no popup, no error', !page.errors.length && !names(p).includes('x'), JSON.stringify(p));
  // a file that does not parse still offers its own declarations (scan)
  p = await typeAt('  balls[0].', 'struct Ball { x: num, y: num }\nregion balls: Ball[4]\nexport fn go( {\n');
  check(P + 'a file that does not parse still offers its own fields', names(p).join() === 'x,y', JSON.stringify(p));
  await page.evaluate(() => { window._emitModuleIndex = window._realIndex; _projDirty(); });
  // no change for programs without regions
  p = await typeAt('  pri', 'export fn go() {\n');
  check(P + 'ordinary builtin completion is unchanged (pri -> print…)', names(p).some(n => /^print\(/.test(n)), JSON.stringify(p));
  // key bar: region is not added (it would not fit on the first screen)
  r = await page.evaluate(() => [...document.querySelectorAll('.kbar .kb')].map(b => b.textContent));
  check(P + 'the key bar is unchanged (no room for region on its first screen)', r.join(' ') === '( ) { } : " TAB fn let mut int num ret exp imp pub ↶ ↷', r.join(' '));
  check(P + 'no page errors (editor)', !page.errors.length, page.errors.join(' | '));
  await page.context().close();
}

async function exampleAndHelpChecks(browser, fileUrl, mode, P) {
  const page = await openIde(browser, fileUrl, mode);
  let r;
  r = await page.evaluate(() => [...document.querySelectorAll('#example option')].map(o => o.value + '=' + o.textContent));
  check(P + 'the Example dropdown has Memory (before Modules, which stays last)', r.includes('memory=Memory') && r[r.length - 1] === 'modules=Modules' && r.indexOf('memory=Memory') === r.length - 2, r.join(' '));
  await page.selectOption('#example', 'memory');
  r = await page.evaluate(() => ({ paths: _proj.files.map(f => f.path), first: document.getElementById('editor').value.split('\n')[0] }));
  check(P + 'the Memory example opens as a project of two files', r.paths.join() === 'main.emit,sand/world.emit' && /^\/\/ Memory/.test(r.first), JSON.stringify(r));
  r = await page.evaluate(() => EX.memory);
  check(P + 'the example uses struct, region, a struct region, screen, freeze/thaw/frozen, wipe, fill, .length, try/catch',
    /\nstruct Spark \{/.test(r) && /\nregion fb: u8\[160 \* 120 \* 4\]/.test(r) && /\nregion sparks: Spark\[12\]/.test(r) && /public region grid: u8\[/.test(r) && /screen\(fb, 160, 120, 2\)/.test(r) && /freeze\(grid\)/.test(r) && /thaw\(grid\)/.test(r) && /frozen\(grid\)/.test(r) && /wipe\(/.test(r) && /fill\(stats, 0\)/.test(r) && /sparks\.length/.test(r) && /try \{/.test(r) && /catch \(e\)/.test(r) && /world\.grid\[p\]/.test(r), '');
  check(P + 'the example avoids the alias forms that are not decided yet (with … as / ref)', !/\bwith\s+\w+\[/.test(r) && !/=\s*ref\s/.test(r));
  r = await page.evaluate(() => { const h = document.getElementById('helpOverlay'); const hs = [...h.querySelectorAll('h2')].map(e => e.textContent); const i = hs.indexOf('Memory tab'); let t = ''; if (i >= 0) { let n = h.querySelectorAll('h2')[i].nextElementSibling; while (n && n.tagName !== 'H2') { t += n.textContent + '\n'; n = n.nextElementSibling; } } return { i, t }; });
  check(P + 'the help has a "Memory tab" section about cards, modes, poke and lock', r.i >= 0 && /front panel write/.test(r.t) && /dump/.test(r.t) && /pixels/.test(r.t) && /Escape/.test(r.t) && /freeze/.test(r.t), r.t.slice(0, 200));
  // after the merge: the example compiles and runs, and its regions appear in the tab
  const res = await page.evaluate(() => { try { const r = compile(_projText(), 'wasm32'); return { errors: r.errors }; } catch (e) { return { thrown: e.message }; } });
  const regionsReal = await page.evaluate(() => typeof _emitRegions === 'function' && !/__memStub/.test(String(_emitRegions)));
  if (!regionsReal) {
    skip(P + 'after merge: the Memory example compiles', 'the compiler has no structs/regions yet: ' + res.thrown.slice(0, 100));
    skip(P + 'after merge: running it fills the Memory tab with fb, sparks, stats, grid', 'needs the merged runtime');
  } else {
    check(P + 'after merge: the Memory example compiles', !res.thrown && !(res.errors || []).length, JSON.stringify(res));
    await page.evaluate(() => compileAndRun());
    await page.waitForTimeout(800);
    await page.evaluate(() => { showView('run'); showOTab(document.querySelector('.otab[data-t="memory"]')); });
    await page.waitForTimeout(300);
    r = await page.evaluate(() => [...document.querySelectorAll('#tab-memory .mname')].map(e => e.textContent).join(' '));
    check(P + 'after merge: running it fills the Memory tab with fb, sparks, stats, grid', /fb/.test(r) && /sparks/.test(r) && /stats/.test(r) && /grid/.test(r), r);
    await page.evaluate(() => stopProgram());
  }
  check(P + 'no page errors (example/help)', !page.errors.length, page.errors.join(' | '));
  await page.context().close();
}

(async () => {
  const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'emit-ide-1_32.html'));
  const fileUrl = 'file://' + file;
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    await panelChecks(browser, fileUrl, PHONE, 'phone: ');
    await panelChecks(browser, fileUrl, DESK, 'desktop: ');
    await errorJumpChecks(browser, fileUrl, PHONE, 'phone: ');
    await errorJumpChecks(browser, fileUrl, DESK, 'desktop: ');
    await editorChecks(browser, fileUrl, DESK, 'desktop: ');
    await editorChecks(browser, fileUrl, PHONE, 'phone: ');
    await exampleAndHelpChecks(browser, fileUrl, PHONE, 'phone: ');
  } catch (e) { failed++; console.log('FAIL  crashed: ' + (e && e.stack || e)); }
  await browser.close();
  console.log('\n' + passed + '/' + (passed + failed) + ' memory-tab checks passed' + (skipped ? ', ' + skipped + ' skipped (after merge)' : ''));
  process.exit(failed ? 1 : 0);
})();

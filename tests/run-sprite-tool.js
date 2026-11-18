#!/usr/bin/env node
// Checks the SPRITE tool of the drawer in headless Chromium: opening it on the project's sprite blocks, every
// painting tool (synthesized pointer events), fill, undo / redo, frames (add, copy, delete, reorder, rename),
// onion skin, zoom / pan (wheel, buttons, two-finger pinch), the palette editor, PNG import (a PNG made in the
// test), Save → the exact block text → reopen → the same pixels, hand-written blocks, unknown lines kept, no
// horizontal overflow at 360 px, and the time a 64×64 painting stroke takes.
// About half of the checks run in a phone viewport with touch (360 px wide), the rest on a desktop viewport.
// The run is offline: every network request is aborted.
//
//   node tests/run-sprite-tool.js [path/to/emit-ide.html]
//   SHOTS=dir  also saves screenshots there.
//
// TEST-ONLY STAND-INS (added with page.addInitScript, never in the product): the drawer framework and its ctx
// helpers (blocks / read / write / remove …) are built by another branch (CORE). Until that is merged the page
// gets the small stand-in DRAWER below: _drawerRegister collects tools, __drawerOpen(id) opens one in a
// full-screen sheet with ctx.body and ctx.footer, and the block helpers work on the project text exactly as the
// shared contract describes them (`<kind> <name>:` in column 0 plus the indented lines after it; a new block is
// appended to sprites.emit). If the page already has a real drawer, the stand-in still replaces it, so these
// checks stay deterministic; the "after merge" check at the end opens the tool through the real drawer when
// one exists and prints SKIP otherwise.
//
// Exit code 0 when every check passes.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

let failed = 0, passed = 0, skipped = 0;
function check(label, ok, detail) {
  if (ok) { passed++; console.log('PASS  ' + label); }
  else { failed++; console.log('FAIL  ' + label + (detail !== undefined ? '\n      ' + String(detail).slice(0, 700) : '')); }
}
function skip(label, why) { skipped++; console.log('SKIP  ' + label + ' — ' + why); }

const PHONE = { viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true };
const DESK = { viewport: { width: 1200, height: 800 } };

// ── TEST-ONLY STAND-IN for the drawer framework and its block helpers ──
const DRAWER = () => {
  window._drawerTools = window._drawerTools || [];
  window.__realDrawerRegister = typeof window._drawerRegister === 'function' ? window._drawerRegister : null;
  window._drawerRegister = function (t) { window._drawerTools.push(t); if (window.__realDrawerRegister) try { window.__realDrawerRegister(t); } catch (e) {} };
  window.__drawerLog = [];
  function files() { _projSync(); return _proj.files.map(f => ({ path: f.path, source: f.source })); }
  function find(kind, name) {
    const out = [];
    files().forEach(f => {
      const L = f.source.split('\n'), re = new RegExp('^' + kind + '[ \\t]+([A-Za-z_]\\w*)[ \\t]*:');
      for (let i = 0; i < L.length; i++) {
        const m = re.exec(L[i]); if (!m) continue;
        let end = i; for (let j = i + 1; j < L.length && (/^[ \t]/.test(L[j]) || !/\S/.test(L[j])); j++) if (/\S/.test(L[j])) end = j;
        if (!name || m[1] === name) out.push({ kind, name: m[1], path: f.path, startLine: i + 1, endLine: end + 1, text: L.slice(i, end + 1).join('\n') });
        i = end;
      }
    });
    return out;
  }
  function store(fs2) { const act = _proj.active; _projLoad(_emitJoinBundle(fs2), act); _projSave(); }
  window.__drawerCtx = function (body, footer) {
    return {
      body, footer,
      title(t) { window.__drawerLog.push('title:' + t); document.getElementById('__drwTitle').textContent = t; },
      close() { document.getElementById('__drw').remove(); },
      setDirty(v) { window.__drawerDirty = !!v; },
      toast(t) { window.__drawerLog.push('toast:' + t); },
      blocks(kind) { return find(kind); },
      read(kind, name) { const b = find(kind, name)[0]; return b ? b.text : null; },
      write(kind, name, text, preferredFile) {
        const fs2 = files(), b = find(kind, name)[0];
        if (b) { const f = fs2.find(x => x.path === b.path), L = f.source.split('\n'); L.splice(b.startLine - 1, b.endLine - b.startLine + 1, ...text.split('\n')); f.source = L.join('\n'); }
        else {
          const p = preferredFile || (kind + 's.emit'); let f = fs2.find(x => x.path === p);
          if (!f) { f = { path: p, source: '' }; fs2.push(f); }
          f.source = f.source.replace(/\n*$/, '') + (f.source.trim() ? '\n\n' : '') + text + '\n';
        }
        store(fs2); window.__drawerLog.push('write:' + kind + ':' + name);
      },
      remove(kind, name) {
        const fs2 = files(), b = find(kind, name)[0]; if (!b) return false;
        const f = fs2.find(x => x.path === b.path), L = f.source.split('\n'); L.splice(b.startLine - 1, b.endLine - b.startLine + 1); f.source = L.join('\n');
        store(fs2); return true;
      },
      files() { return files(); },
      run() { return compileAndRun(); },
    };
  };
  window.__drawerOpen = function (id) {
    const old = document.getElementById('__drw'); if (old) old.remove();
    const t = window._drawerTools.filter(x => x.id === id).pop();
    const sh = document.createElement('div'); sh.id = '__drw';
    sh.style.cssText = 'position:fixed;inset:0;z-index:300;background:var(--bg);display:flex;flex-direction:column';
    sh.innerHTML = '<div style="padding:8px 12px;border-bottom:1px solid var(--border);color:var(--fg)" id="__drwTitle"></div><div id="__drwBody" style="flex:1;overflow:auto;padding:12px"></div><div id="__drwFoot" style="position:sticky;bottom:0;padding:8px 12px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end"></div>';
    document.body.appendChild(sh);
    const ctx = window.__drawerCtx(document.getElementById('__drwBody'), document.getElementById('__drwFoot'));
    return t.open(ctx);
  };
};

async function openIde(browser, fileUrl, mode, src) {
  const ctx = await browser.newContext(mode);
  const page = await ctx.newPage();
  page.errors = []; page.dialogs = []; page.answers = [];
  page.on('pageerror', e => page.errors.push(e.message.slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push('console: ' + m.text().slice(0, 300)); });
  page.on('dialog', async d => { page.dialogs.push(d.message()); const a = page.answers.length ? page.answers.shift() : true; if (a === false) await d.dismiss(); else await d.accept(typeof a === 'string' ? a : undefined); });
  await page.route(/^https?:/, r => r.abort());
  await page.addInitScript(DRAWER);
  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof compileAndRun === 'function' && typeof _projLoad === 'function');
  await page.evaluate(src => { try { closeWelcome(); } catch (e) {} _projLoad(src); }, src);
  return page;
}
const open = page => page.evaluate(() => { window.__spt = __drawerOpen('sprite'); return !!window.__spt; });
const state = page => page.evaluate(() => { const S = __spt.state(); return { name: S.name, w: S.w, h: S.h, fps: S.fps, cur: S.cur, palette: S.palette.slice(), frames: S.frames.map(f => ({ name: f.name, px: Array.from(f.px).join('') })) }; });
// a pointer gesture on the painting canvas, in sprite pixel coordinates (centre of the cell)
async function stroke(page, cells, opts = {}) {
  return page.evaluate(({ cells, opts }) => {
    const cv = document.querySelector('.spt-stage canvas'), r = cv.getBoundingClientRect(), v = __spt.view();
    const at = c => ({ x: r.left + v.ox + (c[0] + 0.5) * v.zoom, y: r.top + v.oy + (c[1] + 0.5) * v.zoom });
    const ev = (type, p, id) => cv.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id || 1, pointerType: opts.type || 'mouse', isPrimary: true, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, clientX: p.x, clientY: p.y }));
    ev('pointerdown', at(cells[0]));
    for (let i = 1; i < cells.length; i++) ev('pointermove', at(cells[i]));
    ev('pointerup', at(cells[cells.length - 1]));
  }, { cells, opts });
}
const tool = (page, t) => page.click('.spt-tools button[data-tool="' + t + '"]');

// A PNG file (RGBA, no filter), made here so the import has something real to read.
function png(w, h, pix) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = pix(x, y); raw.set(p, y * (w * 4 + 1) + 1 + x * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const HERO = `export fn run() {
  canvas(64, 64)
  draw(hero, 0, 0)
}
//// file: sprites.emit
// sprites of the game
sprite hero: 4x3, fps 5
  palette 1a1c2c #F4F4F4 ef7d57
  // eyes
  frame idle
    "1..1"
    ".22."  // mouth
    "3333"
  frame walk
    "1..1"
    ".33."
    "2222"
  hitbox 0 0 4 3
`;

(async () => {
  const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'emit-ide-1_32.html'));
  const fileUrl = 'file://' + file, shots = process.env.SHOTS;
  const browser = await chromium.launch();
  let page, s, r;

  // ═════════════════════════════ PHONE (360 px, touch) ═════════════════════════════
  page = await openIde(browser, fileUrl, PHONE, HERO);
  check('phone: the tool registers with the drawer (id sprite, label, icon, desc, open)', await page.evaluate(() => { const t = _drawerTools.filter(x => x.id === 'sprite')[0]; return !!t && t.label === 'Sprite' && !!t.icon && !!t.desc && typeof t.open === 'function'; }));
  await open(page);
  s = await state(page);
  check('phone: opens the first sprite of the project (hand-written block read back)', s.name === 'hero' && s.w === 4 && s.h === 3 && s.fps === 5 && s.frames.map(f => f.name).join() === 'idle,walk', JSON.stringify(s));
  check('phone: …its pixels and palette (# and upper case accepted)', s.frames[0].px === '100102203333' && s.frames[1].px === '100103302222' && s.palette.join() === '1a1c2c,f4f4f4,ef7d57', JSON.stringify(s));
  r = await page.evaluate(() => document.querySelector('.spt-msg').textContent);
  check('phone: the unknown line is reported as kept', /Kept as it is/.test(r) && /hitbox|unknown line/.test(r), r);
  r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, bw: document.getElementById('__drwBody').scrollWidth, bc: document.getElementById('__drwBody').clientWidth }));
  check('phone: no horizontal overflow at 360 px (page and drawer body)', r.sw <= r.iw && r.bw <= r.bc, JSON.stringify(r));
  if (shots) await page.screenshot({ path: path.join(shots, 'sprite-tool-phone.png') });
  // save without changes: the same text, unknown line and comments kept
  r = await page.evaluate(() => { const before = __drawerCtx(null, null).read('sprite', 'hero'); __spt.save(); return { before, after: __drawerCtx(null, null).read('sprite', 'hero') }; });
  check('phone: Save of an unchanged hand-written block keeps its pixels, comments and the unknown line', /\/\/ eyes/.test(r.after) && /"\.22\."  \/\/ mouth/.test(r.after) && /^  hitbox 0 0 4 3$/m.test(r.after), r.after);
  // touch painting: tap with a touch pointer
  await page.evaluate(() => __spt.load('hero'));
  await page.evaluate(() => __spt.setColor(3));
  await stroke(page, [[1, 0]], { type: 'touch' });
  s = await state(page);
  check('phone: a tap with the pencil paints one pixel in the selected colour', s.frames[0].px === '130102203333', s.frames[0].px);
  // pinch zoom with two touch pointers
  await page.tap('.spt-zoom button[title="Zoom out"]'); await page.tap('.spt-zoom button[title="Zoom out"]');
  r = await page.evaluate(() => {
    const cv = document.querySelector('.spt-stage canvas'), b = cv.getBoundingClientRect(), v0 = __spt.view(), px0 = Array.from(__spt.state().frames[0].px).join('');
    const ev = (type, id, x, y) => cv.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', clientX: b.left + x, clientY: b.top + y, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
    const cx = b.width / 2, cy = b.height / 2;
    ev('pointerdown', 11, cx - 20, cy); ev('pointerdown', 12, cx + 20, cy);
    ev('pointermove', 11, cx - 40, cy); ev('pointermove', 12, cx + 40, cy);
    ev('pointermove', 11, cx - 30, cy + 30); ev('pointermove', 12, cx + 50, cy + 30);
    ev('pointerup', 11, cx - 30, cy + 30); ev('pointerup', 12, cx + 50, cy + 30);
    const v1 = __spt.view();
    // the sprite point that was under the fingers' first midpoint is under their last midpoint
    const u0 = [(cx - v0.ox) / v0.zoom, (cy - v0.oy) / v0.zoom], u1 = [(cx + 10 - v1.ox) / v1.zoom, (cy + 30 - v1.oy) / v1.zoom];
    return { z0: v0.zoom, z1: v1.zoom, du: Math.hypot(u0[0] - u1[0], u0[1] - u1[1]), same: Array.from(__spt.state().frames[0].px).join('') === px0 };
  });
  check('phone: two fingers pinch-zoom (×2) and pan (the point under the fingers stays there), and paint nothing', Math.abs(r.z1 / r.z0 - 2) < 0.05 && r.du < 0.01 && r.same, JSON.stringify(r));
  await page.click('.spt-zoom button[title="Fit"]');
  // frames on the phone
  await page.tap('button[title="Add an empty frame after this one"]');
  s = await state(page);
  check('phone: + frame adds an empty, named frame after the current one', s.frames.length === 3 && s.cur === 1 && s.frames[1].px === '000000000000' && /^frame\d+$/.test(s.frames[1].name), JSON.stringify(s.frames.map(f => f.name)));
  r = await page.evaluate(() => { const S = __spt.state(); return { onion: document.querySelector('button[title^="Onion"]').classList.contains('on') }; });
  // onion skin: the previous frame shows faintly on the canvas of an empty frame
  r = await page.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => {
    const cv = document.querySelector('.spt-stage canvas'), v = __spt.view(), g = cv.getContext('2d'), d = devicePixelRatio || 1;
    const px = (x, y) => Array.from(g.getImageData(Math.floor((v.ox + (x + 0.5) * v.zoom) * d), Math.floor((v.oy + (y + 0.5) * v.zoom) * d), 1, 1).data);
    res({ a: px(0, 2), b: px(1, 1) });
  }))));
  const onionOn = r;
  await page.tap('button[title^="Onion"]');
  r = await page.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => {
    const cv = document.querySelector('.spt-stage canvas'), v = __spt.view(), g = cv.getContext('2d'), d = devicePixelRatio || 1;
    const px = (x, y) => Array.from(g.getImageData(Math.floor((v.ox + (x + 0.5) * v.zoom) * d), Math.floor((v.oy + (y + 0.5) * v.zoom) * d), 1, 1).data);
    res({ a: px(0, 2), b: px(1, 1) });
  }))));
  check('phone: onion skin shows the previous frame faintly (orange-ish over the checkerboard), off hides it', onionOn.a[0] > r.a[0] + 20 && onionOn.a[0] > onionOn.a[2], JSON.stringify({ on: onionOn, off: r }));
  await page.tap('button[title^="Onion"]');
  check('phone: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();

  // ── the sprite under the editor's cursor opens; _sprFrameCanvas for other tools ──
  page = await openIde(browser, fileUrl, DESK, 'sprite one: 1x1\n  "1"\n\nsprite two: 2x1\n  palette 00ff00\n  "1."\nexport fn run() {}\n');
  await page.evaluate(() => { const ed = document.getElementById('editor'); ed.focus(); ed.selectionStart = ed.selectionEnd = ed.value.indexOf('"1."') + 1; });
  await open(page);
  s = await state(page);
  check('desktop: the sprite block the editor cursor is in is the one that opens', s.name === 'two', s.name);
  r = await page.evaluate(() => { const d = _sprParse(['sprite two: 2x1', '  palette 00ff00', '  "1."'], 1, true), c = _sprFrameCanvas(d, 0, 3), g = c.getContext('2d'); return [c.width, c.height, Array.from(g.getImageData(1, 1, 1, 1).data).join(), Array.from(g.getImageData(4, 1, 1, 1).data).join()].join(' '); });
  check('desktop: _sprFrameCanvas draws a parsed frame at an integer scale', r === '6 3 0,255,0,255 0,0,0,0', r);
  await page.context().close();

  // ═════════════════════════════ DESKTOP ═════════════════════════════
  page = await openIde(browser, fileUrl, DESK, 'export fn run() {\n}\n');
  await open(page);
  s = await state(page);
  check('desktop: without sprites it starts a new 16×16 sprite with the default palette', s.name === 'sprite1' && s.w === 16 && s.h === 16 && s.palette.length === 16 && s.frames.length === 1 && s.frames[0].name === '', JSON.stringify({ n: s.name, w: s.w, p: s.palette.length }));
  // resize to 8×8 for readable pixel strings
  await page.fill('input[aria-label="Width"]', '8'); await page.fill('input[aria-label="Height"]', '8');
  await page.click('button:has-text("Resize")');
  await page.fill('input[aria-label="Sprite name"]', 'coin'); await page.press('input[aria-label="Sprite name"]', 'Enter');
  s = await state(page);
  check('desktop: resize and rename', s.w === 8 && s.h === 8 && s.name === 'coin' && s.frames[0].px.length === 64, JSON.stringify({ w: s.w, h: s.h, n: s.name }));
  const row = (st, y, f) => st.frames[f || 0].px.slice(y * 8, y * 8 + 8);
  // pencil: a diagonal drag paints a continuous line (no gaps between move events)
  await page.click('.spt-pal button[data-ix="2"]');
  await tool(page, 'pencil');
  await stroke(page, [[0, 0], [3, 3]]);
  s = await state(page);
  check('desktop: pencil drag paints a gap-free line between move events', [0, 1, 2, 3].every(i => row(s, i)[i] === '2') && s.frames[0].px.split('2').length - 1 === 4, s.frames[0].px);
  // eraser
  await tool(page, 'eraser');
  await stroke(page, [[1, 1], [2, 2]]);
  s = await state(page);
  check('desktop: eraser clears pixels', row(s, 1)[1] === '0' && row(s, 2)[2] === '0' && row(s, 0)[0] === '2', s.frames[0].px);
  // line and rectangle
  await page.click('.spt-pal button[data-ix="3"]');
  await tool(page, 'line');
  await stroke(page, [[0, 7], [3, 7], [7, 7]]);
  s = await state(page);
  check('desktop: line from the press to the release', row(s, 7) === '33333333', row(s, 7));
  await page.click('.spt-pal button[data-ix="4"]');
  await tool(page, 'rect');
  await stroke(page, [[4, 0], [6, 2]]);
  s = await state(page);
  check('desktop: rectangle outline', row(s, 0).slice(4, 7) === '444' && row(s, 1).slice(4, 7) === '404' && row(s, 2).slice(4, 7) === '444', [row(s, 0), row(s, 1), row(s, 2)].join('|'));
  // fill inside the rectangle, and a fill of the big empty area stops at borders
  await page.click('.spt-pal button[data-ix="5"]');
  await tool(page, 'fill');
  await stroke(page, [[5, 1]]);
  s = await state(page);
  check('desktop: fill fills the enclosed pixel only', row(s, 1).slice(4, 7) === '454' && row(s, 3) === '00020000', [row(s, 1), row(s, 3)].join('|'));
  // eyedropper picks colour 3 from the line, goes back to the previous tool
  await tool(page, 'pick');
  await stroke(page, [[2, 7]]);
  r = await page.evaluate(() => ({ sel: document.querySelector('.spt-sw.sel').getAttribute('data-ix'), tool: document.querySelector('.spt-tools button.on').getAttribute('data-tool') }));
  check('desktop: eyedropper picks the colour and returns to the previous tool', r.sel === '3' && r.tool === 'fill', JSON.stringify(r));
  // mirror-X
  await tool(page, 'pencil');
  await page.click('.spt-tools button[data-tool="mirror"]');
  await stroke(page, [[1, 5]]);
  await page.click('.spt-tools button[data-tool="mirror"]');
  s = await state(page);
  check('desktop: mirror-X paints the mirrored pixel too', row(s, 5) === '03000030', row(s, 5));
  // undo / redo
  const beforeUndo = s.frames[0].px;
  await page.click('.spt button[title="Undo"]');
  s = await state(page);
  const afterUndo = s.frames[0].px;
  await page.click('.spt button[title="Redo"]');
  s = await state(page);
  check('desktop: undo takes the last stroke back, redo puts it back', row({ frames: [{ px: afterUndo }] }, 5) === '00000000' && s.frames[0].px === beforeUndo, afterUndo + ' / ' + s.frames[0].px);
  for (let i = 0; i < 55; i++) { await page.evaluate(i => __spt.setColor(1 + i % 3), i); await stroke(page, [[i % 8, 6]]); }
  r = await page.evaluate(() => { let n = 0; while (!document.querySelector('.spt button[title="Undo"]').disabled && n < 200) { __spt.undo(); n++; } return { n, px: Array.from(__spt.state().frames[0].px).join('') }; });
  check('desktop: at least 50 undo steps', r.n >= 50, JSON.stringify(r));
  await page.evaluate(() => { let n = 0; while (!document.querySelector('.spt button[title="Redo"]').disabled && n < 200) { __spt.redo(); n++; } });
  s = await state(page);
  // zoom with the wheel and buttons; the grid hides when zoomed out
  r = await page.evaluate(() => __spt.view().zoom);
  const z0 = r;
  await page.click('.spt-zoom button[title="Zoom in"]');
  const z1 = await page.evaluate(() => __spt.view().zoom);
  await page.hover('.spt-stage canvas');
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(50);
  const z2 = await page.evaluate(() => __spt.view().zoom);
  check('desktop: + button zooms in, the wheel zooms out', z1 > z0 * 1.4 && z2 < z1 * 0.8, [z0, z1, z2].join(' '));
  r = await page.evaluate(() => new Promise(res => {
    const S = __spt.state(), cv = document.querySelector('.spt-stage canvas'), g = cv.getContext('2d'), d = devicePixelRatio || 1;
    // a transparent pixel's cell: at zoom ≥ 6 a grid line crosses it, below 6 there is none
    const look = () => { const v = __spt.view(); const x = Math.round(v.ox + 7 * v.zoom) + 0.5, y = v.oy + 3.5 * v.zoom; return Array.from(g.getImageData(Math.floor(x * d), Math.floor(y * d), 1, 1).data); };
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const zin = __spt.view().zoom, a = look();
      // zoom far out
      for (let i = 0; i < 12; i++) document.querySelector('.spt-zoom button[title="Zoom out"]').click();
      requestAnimationFrame(() => requestAnimationFrame(() => { res({ zin, a, zout: __spt.view().zoom }); }));
    }));
  }));
  check('desktop: zoomed out far the zoom stops at its minimum', r.zout <= 1, JSON.stringify(r));
  r = await page.evaluate(() => { const g1 = __spt.view().grid; document.querySelector('.spt-zoom button[title="Fit"]').click(); return { out: g1, fit: __spt.view().grid, z: __spt.view().zoom }; });
  check('desktop: the grid hides when zoomed out (under 6 screen px per pixel) and shows at fit', r.out === false && r.fit === true, JSON.stringify(r));
  await page.click('.spt-zoom button[title="Fit"]');
  // frames: copy, rename, reorder, delete
  await page.click('button[title="Duplicate this frame"]');
  s = await state(page);
  check('desktop: ⧉ copy duplicates the frame (both get names)', s.frames.length === 2 && s.frames[1].px === s.frames[0].px && s.cur === 1 && s.frames.every(f => /^\w+$/.test(f.name)), JSON.stringify(s.frames.map(f => f.name)));
  await page.fill('input[aria-label="Frame name"]', 'shine'); await page.press('input[aria-label="Frame name"]', 'Enter');
  await tool(page, 'pencil'); await page.click('.spt-pal button[data-ix="6"]');
  await stroke(page, [[3, 4]]);
  await page.click('button[title="Move this frame left"]');
  s = await state(page);
  check('desktop: rename and ◀ reorder', s.frames[0].name === 'shine' && s.cur === 0 && row(s, 4, 0)[3] === '6' && row(s, 4, 1)[3] !== '6', JSON.stringify(s.frames.map(f => f.name)));
  await page.fill('input[aria-label="Frame name"]', 'shine'); // no-op
  r = await page.evaluate(() => { const i = document.querySelector('input[aria-label="Frame name"]'); i.value = '9bad'; i.dispatchEvent(new Event('change')); return { msg: document.querySelector('.spt-msg').textContent, name: __spt.state().frames[0].name }; });
  check('desktop: a bad frame name is refused with a message', r.name === 'shine' && /frame name is a word/.test(r.msg), JSON.stringify(r));
  await page.click('.spt-fr[data-fi="1"]');
  await page.click('button[title="Delete this frame"]');
  s = await state(page);
  check('desktop: 🗑 deletes the current frame', s.frames.length === 1 && s.frames[0].name === 'shine', JSON.stringify(s.frames.map(f => f.name)));
  await page.click('.spt button[title="Undo"]');
  s = await state(page);
  check('desktop: … and undo brings it back', s.frames.length === 2, JSON.stringify(s.frames.map(f => f.name)));
  // palette editing
  await page.click('.spt-pal button[data-ix="2"]');
  await page.evaluate(() => { const c = document.querySelector('input[type=color]'); c.value = '#123456'; c.dispatchEvent(new Event('input')); c.dispatchEvent(new Event('change')); });
  s = await state(page);
  check('desktop: ✎ colour picker changes the selected palette entry', s.palette[1] === '123456', s.palette.join());
  const palN = s.palette.length;
  await page.click('button[title="Add a colour to the palette"]');
  s = await state(page);
  const added = s.palette.length === palN + 1;
  await page.click('button[title^="Remove the selected colour"]');
  s = await state(page);
  check('desktop: + adds a colour, − removes it (pixels using later colours renumbered)', added && s.palette.length === palN, palN + ' ' + s.palette.length);
  // animated preview at 1× / 2× / 4× and fps
  await page.click('button[title="Preview at 4×"]');
  r = await page.evaluate(() => { const c = document.querySelector('.spt-prev canvas'); return { w: c.width, h: c.height }; });
  check('desktop: preview at 4× is 32×32 for an 8×8 sprite', r.w === 32 && r.h === 32, JSON.stringify(r));
  await page.fill('input[aria-label="Frames per second"]', '12'); await page.press('input[aria-label="Frames per second"]', 'Enter');
  r = await page.evaluate(() => new Promise(res => {
    const c = document.querySelector('.spt-prev canvas'), g = c.getContext('2d'), seen = new Set(); let n = 0;
    (function t() { seen.add(Array.from(g.getImageData(0, 0, c.width, c.height).data).join(',').length + ':' + Array.from(g.getImageData(12, 16, 1, 1).data).join()); if (++n < 40) requestAnimationFrame(t); else res(seen.size); })();
  }));
  s = await state(page);
  check('desktop: the preview animates through the frames at the fps', s.fps === 12 && r >= 2, 'fps ' + s.fps + ', distinct ' + r);
  // Save → block text → reopen → same pixels
  const painted = await state(page);
  r = await page.evaluate(() => { __spt.save(); return { text: __drawerCtx(null, null).read('sprite', 'coin'), files: _proj.files.map(f => f.path) }; });
  const wantHead = 'sprite coin: 8x8, fps 12\n  palette ';
  check('desktop: Save writes the block into sprites.emit, rows as pictures', r.files.join() === 'main.emit,sprites.emit' && r.text.indexOf(wantHead) === 0 && /\n  frame shine\n    "/.test(r.text) && r.text.split('\n').filter(l => /^    "[.1-9a-z]{8}"$/.test(l)).length === 16, r.files.join() + '\n' + r.text);
  const expectRows = painted.frames.map(f => { const rows = []; for (let y = 0; y < 8; y++) rows.push('    "' + f.px.slice(y * 8, y * 8 + 8).split('').map(c => '.123456789abcdefghijklmnopqrstuvwxyz'[+c]).join('') + '"'); return '  frame ' + f.name + '\n' + rows.join('\n'); }).join('\n');
  const pal = painted.palette; const palLines = []; for (let i = 0; i < pal.length; i += 8) palLines.push('  palette ' + pal.slice(i, i + 8).join(' '));
  check('desktop: … exactly the expected text', r.text === 'sprite coin: 8x8, fps 12\n' + palLines.join('\n') + '\n' + expectRows, r.text);
  await page.evaluate(() => __spt.load('coin'));
  s = await state(page);
  check('desktop: reopen → identical pixels, names, palette and fps', JSON.stringify(s) === JSON.stringify(Object.assign({}, painted, { cur: 0 })), JSON.stringify(s).slice(0, 300));
  r = await page.evaluate(() => { const t1 = __drawerCtx(null, null).read('sprite', 'coin'); __spt.save(); return t1 === __drawerCtx(null, null).read('sprite', 'coin'); });
  check('desktop: saving again writes the same text (round trip)', r);
  r = await page.evaluate(() => { const r = compile(_projText()); return { errors: r.errors, sprites: r.sprites.map(x => x.name + ':' + x.frames.join('/')) }; });
  check('desktop: the saved project compiles; the compiler sees the sprite', r.errors.length === 0 && r.sprites.join() === 'coin:shine/frame0', JSON.stringify(r));
  // the saved pixels draw exactly as the tool shows them
  r = await page.evaluate(async () => {
    _projSetActive(0); const ed = document.getElementById('editor'); ed.value = 'export fn run() {\n  canvas(8, 8)\n  draw(coin, 0, 0, "shine")\n}\n'; ed.dispatchEvent(new Event('input'));
    await compileAndRun(); await new Promise(r => setTimeout(r, 200));
    const c = document.querySelector('#tab-output canvas'), d = c.getContext('2d').getImageData(0, 0, 8, 8).data, S = __spt.state(), f = S.frames[0], bad = [];
    for (let i = 0; i < 64; i++) { const v = f.px[i], want = v ? S.palette[v - 1] : null, got = d[i * 4 + 3] ? [0, 1, 2].map(k => ('0' + d[i * 4 + k].toString(16)).slice(-2)).join('') : null; if (want !== got) bad.push(i + ':' + want + '/' + got); }
    return bad;
  });
  check('desktop: draw() in the program paints exactly the saved pixels', r.length === 0, r.join(' '));
  // PNG import: 6 colours fit; 50 colours are reduced with a note
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'spt-'));
  const p1 = path.join(tmp, 'six.png'), cols = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255], [255, 0, 255]];
  fs.writeFileSync(p1, png(12, 6, (x, y) => (x + y) % 7 === 6 ? [0, 0, 0, 0] : [...cols[(x + y) % 7 % 6], 255]));
  await page.evaluate(() => __spt.load(null));
  await page.setInputFiles('.spt input[type=file]', p1);
  await page.waitForFunction(() => __spt.state().w === 12);
  s = await state(page);
  r = await page.evaluate(() => document.querySelector('.spt-msg').textContent);
  check('desktop: PNG import: size taken over, 6 colours become the palette, transparent stays transparent', s.w === 12 && s.h === 6 && s.palette.length === 6 && s.palette.indexOf('ff0000') >= 0 && s.frames[0].px[6] === '0' && !/reduced/.test(r), JSON.stringify({ w: s.w, p: s.palette, px: s.frames[0].px.slice(0, 12), r }));
  const p2 = path.join(tmp, 'many.png');
  fs.writeFileSync(p2, png(10, 5, (x, y) => [x * 25, y * 50, (x * y * 7) % 256, 255]));
  await page.setInputFiles('.spt input[type=file]', p2);
  await page.waitForFunction(() => __spt.state().w === 10);
  s = await state(page);
  r = await page.evaluate(() => ({ msg: document.querySelector('.spt-msg').textContent, opaque: __spt.state().frames[0].px.every(v => v > 0) }));
  check('desktop: PNG with 50 colours is quantised to at most 35, with a note', s.palette.length <= 35 && s.palette.length >= 30 && /50 colours.*reduced to \d+/.test(r.msg) && r.opaque, s.palette.length + ' ' + JSON.stringify(r));
  // performance: a 64×64 stroke
  await page.evaluate(() => __spt.load(null));
  await page.fill('input[aria-label="Width"]', '64'); await page.fill('input[aria-label="Height"]', '64');
  await page.click('button:has-text("Resize")');
  r = await page.evaluate(() => {
    const cv = document.querySelector('.spt-stage canvas'), b = cv.getBoundingClientRect(), v = __spt.view();
    const ev = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: b.left + v.ox + (x + 0.5) * v.zoom, clientY: b.top + v.oy + (y + 0.5) * v.zoom }));
    // 50 display frames of 4 pointer moves each, every frame redrawn at once: the work one frame costs
    let i = 0, worst = 0; const t0 = performance.now();
    ev('pointerdown', 0, 0);
    for (let f = 0; f < 50; f++) { const t1 = performance.now(); for (let k = 0; k < 4; k++, i++) ev('pointermove', (i * 7) % 64, Math.floor(i / 3) % 64); __spt.drawNow(); worst = Math.max(worst, performance.now() - t1); }
    ev('pointerup', 1, 1);
    return { ms: performance.now() - t0, worst, painted: Array.from(__spt.state().frames[0].px).filter(Boolean).length };
  });
  check('desktop: a 64×64 painting stroke: 4 moves + a full redraw cost under 8 ms per frame (worst under 16)', r.ms / 50 < 8 && r.worst < 16 && r.painted > 150, JSON.stringify(r));
  check('desktop: no page errors', page.errors.length === 0, page.errors.join(' | '));
  if (shots) await page.screenshot({ path: path.join(shots, 'sprite-tool-desk.png') });
  await page.context().close();

  // ═════════════════════════════ PHONE: a 64×64 stroke and RLE ═════════════════════════════
  page = await openIde(browser, fileUrl, PHONE, 'export fn run() {\n}\n');
  await open(page);
  await page.fill('input[aria-label="Width"]', '64'); await page.fill('input[aria-label="Height"]', '64');
  await page.tap('button:has-text("Resize")');
  r = await page.evaluate(() => {
    const cv = document.querySelector('.spt-stage canvas'), b = cv.getBoundingClientRect(), v = __spt.view();
    const ev = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 5, pointerType: 'touch', button: 0, buttons: 1, clientX: b.left + v.ox + (x + 0.5) * v.zoom, clientY: b.top + v.oy + (y + 0.5) * v.zoom }));
    let i = 0, worst = 0; const t0 = performance.now();
    ev('pointerdown', 0, 0);
    for (let f = 0; f < 50; f++) { const t1 = performance.now(); for (let k = 0; k < 4; k++, i++) ev('pointermove', (i * 5) % 64, Math.floor(i / 4) % 64); __spt.drawNow(); worst = Math.max(worst, performance.now() - t1); }
    ev('pointerup', 1, 1);
    return { ms: performance.now() - t0, worst, painted: Array.from(__spt.state().frames[0].px).filter(Boolean).length, zoom: v.zoom };
  });
  check('phone: a 64×64 touch stroke: 4 moves + a full redraw cost under 8 ms per frame (worst under 16), and it paints', r.ms / 50 < 8 && r.worst < 16 && r.painted > 150, JSON.stringify(r));
  r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, bw: document.getElementById('__drwBody').scrollWidth, bc: document.getElementById('__drwBody').clientWidth }));
  check('phone: still no horizontal overflow with a 64×64 sprite', r.sw <= r.iw && r.bw <= r.bc, JSON.stringify(r));
  // a wide sprite is written in the compact form and read back
  await page.fill('input[aria-label="Width"]', '100'); await page.fill('input[aria-label="Height"]', '3');
  await page.tap('button:has-text("Resize")');
  await page.evaluate(() => { __spt.setColor(2); __spt.setTool('line'); });
  await stroke(page, [[0, 1], [99, 1]], { type: 'touch' });
  const wide = await state(page);
  r = await page.evaluate(() => { __spt.save(); return __drawerCtx(null, null).read('sprite', __spt.state().name); });
  check('phone: a sprite wider than 64 is saved in the compact rle form', /^sprite \w+: 100x3\n  palette [^\n]+\n  palette [^\n]+\n  rle "[^"\n]+"$/.test(r) && r.split('\n').every(l => l.length < 200), r);
  await page.evaluate(() => __spt.load(__spt.state().name));
  s = await state(page);
  check('phone: … and reads back to the same pixels', JSON.stringify(s.frames) === JSON.stringify(wide.frames) && s.w === 100, JSON.stringify(s.frames).slice(0, 200));
  if (shots) await page.screenshot({ path: path.join(shots, 'sprite-tool-phone-64.png') });
  check('phone: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();

  // ═════════════════════════════ AFTER THE MERGE ═════════════════════════════
  page = await (async () => { const ctx = await browser.newContext(DESK); const p = await ctx.newPage(); await p.route(/^https?:/, r => r.abort()); await p.goto(fileUrl); await p.waitForFunction(() => typeof compileAndRun === 'function'); return p; })();
  r = await page.evaluate(() => ({ real: typeof _drawerOpen === 'function' || !!document.querySelector('[title*="rawer"]'), listed: (window._drawerTools || []).some(t => t.id === 'sprite') }));
  check('merge: without the stand-in the tool is still registered (in _drawerTools or the real drawer)', r.listed || r.real, JSON.stringify(r));
  if (!r.real) skip('merge: opening the tool through the real drawer (🧰)', 'the drawer framework (CORE) is not in this branch yet');
  else skip('merge: opening the tool through the real drawer (🧰)', 'write this check against the merged drawer');
  await page.context().close();

  await browser.close();
  console.log('\n' + passed + '/' + (passed + failed) + ' sprite tool checks passed' + (skipped ? ' (' + skipped + ' skipped until the merge)' : ''));
  process.exit(failed ? 1 : 0);
})();

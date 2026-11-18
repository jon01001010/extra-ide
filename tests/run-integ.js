#!/usr/bin/env node
// The drawer parts working together (CORE: drawer, sound, music · SPRITE · STAGE: maps, controls · LOGIC when
// merged), in headless Chromium, offline:
//   - one program using every block kind, in one file and spread over several files: it compiles, runs, draws
//     the map with a sprite tile and a sprite, plays a sound on a button press and keeps the music going;
//   - error positions (line:col, file) after each kind of block and inside each kind of block;
//   - the block helpers of the drawer and the parts' own block finders agree on every block's extent;
//   - the default files of new blocks; the Example dropdown order; the three tool examples loaded and run in
//     turn through the dropdown in one page;
//   - the Memory card of the drawer and the Memory tab's "open in tool" hook (_memtabToolLink).
// AudioContext is replaced by tests/fake-audio.js (a recorder): nothing is heard here.
//
//   node tests/run-integ.js [path/to/emit-ide.html]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const FAKE_AUDIO = require('./fake-audio.js');

let failed = 0, passed = 0;
function check(label, ok, detail) {
  if (ok) { passed++; console.log('PASS  ' + label); }
  else { failed++; console.log('FAIL  ' + label + (detail !== undefined ? '\n      ' + String(detail).slice(0, 900) : '')); }
}
const PHONE = { viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true };
const DESK = { viewport: { width: 1200, height: 800 } };

const SOUNDS = `sound coin: square 988, 80ms, vol 0.4
music theme: 120 bpm, 8 steps
  lead square: C5 . E5 . G5 . E5 .`;
const SPRITES = `sprite hero: 2x2
  palette ff00ff 00ffff
  "12"
  "21"`;
const STAGES = `map room: 4x2, tile 8
  legend # wall solid #ff0000,  . floor #00ff00,  h herotile sprite hero #0000ff
  rows
    "#.h#"
    "...."
  objects
    coin 1,1 value 5

controls pad: stick left, buttons A`;
const CODE = `mut presses = 0
export fn main() {
  canvas(32, 16)
  drawMap(room)
  draw(hero, 8, 8)
  print(spriteW(hero))
  print(mapW(room))
  print(objCount(room, "coin"))
  printNum(objX(room, "coin", 0))
  printStr(tileAt(room, 2, 0))
  if (solidAt(room, 4.0, 4.0)) { printStr("solid") }
  useControls(pad)
  music(theme)
  if (musicPlaying()) { printStr("music on") }
  animate()
}
export fn frame() {
  drawMap(room)
  draw(hero, 8, 8)
  if (justPressed("A")) {
    presses = presses + 1
    play(coin)
    print(presses)
  }
}`;
const ONE_FILE = SOUNDS + '\n\n' + SPRITES + '\n\n' + STAGES + '\n\n' + CODE + '\n';
const MULTI = '//// file: main.emit\n' + CODE + '\n//// file: sounds.emit\n' + SOUNDS + '\n//// file: sprites.emit\n' + SPRITES + '\n//// file: stages.emit\n' + STAGES + '\n';

async function openIde(browser, fileUrl, mode) {
  const ctx = await browser.newContext(mode);
  await ctx.addInitScript(FAKE_AUDIO);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message.slice(0, 300)));
  page.on('dialog', d => d.accept());
  await page.route(/^https?:/, r => r.abort());
  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof compileAndRun === 'function' && typeof _projLoad === 'function' && typeof _drawerOpen === 'function');
  await page.evaluate(() => { try { closeWelcome(); } catch (e) {} });
  return page;
}
// the program's printed values ("> …" lines of the Output tab)
const outLines = page => page.evaluate(() => document.getElementById('tab-output').innerText.split('\n').map(s => s.trim()).filter(s => /^> /.test(s)).map(s => s.slice(2)));
const pix = (page, x, y) => page.evaluate(([x, y]) => { const c = document.querySelector('#tab-output canvas'); return c ? Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data).slice(0, 3).join(',') : 'no canvas'; }, [x, y]);
// the oscillators of the shared synth's AudioContext (the IDE's own "done" beep uses a context of its own)
const oscs = page => page.evaluate(() => { const c = _sndAC; return c ? c.nodes.filter(n => n.kind === 'osc').map(n => n.frequency.events.length ? n.frequency.events[0][1] : n.frequency.value) : []; });

async function allKinds(page, T, bundle) {
  await page.evaluate(b => _projLoad(b), bundle);
  // a tap on the page first (unlocks audio, as on a phone), then Run
  await page.mouse.click(5, 5);
  await page.evaluate(() => compileAndRun());
  await page.waitForTimeout(500);
  const lines = await outLines(page);
  check(T + 'every block kind together: compiles and runs (sprite, map, objects, tiles, solid, controls, music)', lines.slice(0, 7).join('|') === '2|4|1|8|h|solid|music on' && !/✗|\bERROR\b/.test(await page.evaluate(() => document.getElementById('tab-output').innerText)), JSON.stringify(lines));
  const px = [];
  for (const [x, y] of [[16, 0], [19, 3], [20, 0], [23, 3], [16, 4], [20, 4], [8, 8], [9, 8], [8, 9], [9, 9], [12, 12], [0, 0]]) px.push(await pix(page, x, y));
  check(T + 'the map tile with `sprite hero` shows the sprite (stretched to the 8 px tile), draw() shows it at 1:1, colour tiles stay',
    px.join(' ') === '255,0,255 255,0,255 0,255,255 0,255,255 0,255,255 255,0,255 255,0,255 0,255,255 0,255,255 255,0,255 0,255,0 255,0,0', px.join(' '));
  check(T + 'the controls of the program are on screen', await page.evaluate(() => !!document.querySelector('#tab-output [data-emit-controls="pad"] [data-ctl="A"]')), '');
  const music = await page.evaluate(() => _musicPlaying());
  check(T + 'music(theme) plays (the shared synth)', music === true && (await oscs(page)).length > 0, JSON.stringify(await oscs(page)).slice(0, 200));
  const before = (await oscs(page)).filter(f => Math.abs(f - 988) < 0.01).length;
  await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
  await page.keyboard.down('z'); await page.waitForTimeout(120); await page.keyboard.up('z'); await page.waitForTimeout(120);
  const after = (await oscs(page)).filter(f => Math.abs(f - 988) < 0.01).length;
  const lines2 = await outLines(page);
  check(T + 'button A (keyboard Z) → justPressed → play(coin): one 988 Hz voice, presses printed once', after === before + 1 && lines2[lines2.length - 1] === '1', 'voices ' + before + ' → ' + after + ', output ' + JSON.stringify(lines2));
  // the on-screen button too (pointer events on the overlay)
  const a = await page.evaluate(() => { const b = document.querySelector('#tab-output [data-ctl="A"]'); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up(); await page.waitForTimeout(120);
  const lines3 = await outLines(page);
  check(T + 'the on-screen button A reaches justPressed / play', lines3[lines3.length - 1] === '2' && (await oscs(page)).filter(f => Math.abs(f - 988) < 0.01).length === before + 2, JSON.stringify(lines3.slice(-3)));
  await page.evaluate(() => stopProgram());
  check(T + 'Stop stops the music', await page.evaluate(() => _musicPlaying()) === false, '');
}

// The all-kinds program exported (.html and offline .html): it runs on its own, draws the sprite tile, its
// on-screen button A reaches justPressed / play (touch), the music plays.
async function exportChecks(browser, fileUrl) {
  const page = await openIde(browser, fileUrl, DESK);
  await page.evaluate(b => _projLoad(b), MULTI);
  const files = await page.evaluate(async () => {
    const got = {}; window._download = (name, content) => { got[name] = typeof content === 'string' ? content : '[binary]'; };
    doExport('html'); await doExport('htmloff');
    return got;
  });
  await page.context().close();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emit-integ-'));
  const ctx = await browser.newContext({ hasTouch: true, viewport: { width: 800, height: 700 } });
  await ctx.addInitScript(FAKE_AUDIO);
  for (const n of ['program.html', 'program-offline.html']) {
    if (!files[n]) { check('export ' + n, false, 'not exported: ' + Object.keys(files).join(', ')); continue; }
    fs.writeFileSync(path.join(dir, n), files[n]);
    const pg = await ctx.newPage(), errs = [], reqs = [];
    pg.on('pageerror', e => errs.push(e.message.slice(0, 200)));
    await pg.route(/^https?:/, r => { reqs.push(r.request().url()); r.abort(); });
    await pg.goto('file://' + path.join(dir, n));
    await pg.waitForFunction(() => document.querySelector('canvas') && document.querySelector('[data-ctl="A"]'), null, { timeout: 5000 }).catch(() => errs.push('no canvas / controls'));
    await pg.waitForTimeout(300);
    const px = await pg.evaluate(() => { const g = document.querySelector('canvas').getContext('2d'); return [[16, 0], [20, 0], [8, 8], [0, 0]].map(([x, y]) => Array.from(g.getImageData(x, y, 1, 1).data).slice(0, 3).join(',')).join(' '); });
    const a = await pg.evaluate(() => { const r = document.querySelector('[data-ctl="A"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const cdp = await pg.context().newCDPSession(pg);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
    await pg.waitForTimeout(150);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await pg.waitForTimeout(150);
    const st = await pg.evaluate(() => ({ text: document.body.innerText, music: typeof _musicPlaying === 'function' && _musicPlaying(), coin: typeof _sndAC !== 'undefined' && _sndAC ? _sndAC.nodes.filter(x => x.kind === 'osc' && x.frequency.events.length && Math.abs(x.frequency.events[0][1] - 988) < 0.01).length : -1 }));
    check('exported ' + n + ': runs, draws the sprite tile, the first tap on button A unlocks audio and plays the sound, the music plays',
      px === '255,0,255 0,255,255 255,0,255 255,0,0' && /\b1\b/.test(st.text) && st.music === true && st.coin === 1 && !errs.length && (!/offline/.test(n) || !reqs.length),
      JSON.stringify({ px, st: { music: st.music, coin: st.coin, text: st.text.slice(-120) }, errs, reqs }));
    await pg.close();
  }
  await ctx.close();
}

async function compileChecks(page) {
  const r = await page.evaluate(([ONE_FILE, MULTI]) => {
    const out = {};
    function errs(src) { try { return compile(src).errors; } catch (e) { return ['throws ' + e.message]; } }
    out.one = errs(ONE_FILE); out.multi = errs(MULTI);
    // an error right after each kind of block
    const blocks = {
      sound: 'sound coin: square 880, 90ms',
      music: 'music theme: 120 bpm, 4 steps\n  lead square: C5 . E5 .\n\n  bass saw: C3 . . .',
      sprite: 'sprite hero: 2x1\n  "11"',
      map: 'map room: 2x1, tile 8\n  legend # wall solid #ff0000\n  rows\n    "##"',
      controls: 'controls pad: stick left, buttons A' };
    out.after = {};
    for (const k in blocks) {
      out.after[k] = [errs(blocks[k] + '\nexport fn main() {\n  let x = 1\n  let y: int = "a"\n}\n'), errs(blocks[k] + '\nexport fn main() {\n  let x = 1\n  let z = (1 +\n}\n'), blocks[k].split('\n').length];
    }
    // every kind in one file, then the error
    const all = Object.values(blocks).join('\n');
    out.allAfter = [errs(all + '\nexport fn main() {\n  let y: int = "a"\n}\n'), all.split('\n').length];
    // several files: an error in main.emit after its own code and in stages.emit after its blocks
    out.files = errs('//// file: main.emit\nexport fn main() {\n  play(coin)\n  draw(hero, 1, 1)\n  drawMap(room)\n  useControls(pad)\n  let y: int = "a"\n}\n//// file: sounds.emit\nsound coin: square 880, 90ms\n\nmusic theme: 120 bpm, 4 steps\n  lead square: C5 . E5 .\n//// file: sprites.emit\nsprite hero: 2x1\n  "11"\n//// file: stages.emit\nmap room: 2x1, tile 8\n  legend # wall solid #ff0000\n  rows\n    "##"\n\ncontrols pad: stick left, buttons A\nfn helper() int {\n  return "s"\n}\n');
    // an error inside each kind of block, in its own file after another block
    const main = '//// file: main.emit\nexport fn main() {\n  print(1)\n}\n';
    out.inside = [
      '//// file: sounds.emit\nsound ok: sine 440\n\nsound coin: sqare 880, 90ms\n',
      '//// file: sounds.emit\nsound ok: sine 440\nmusic theme: 120 bpm, 4 steps\n  lead square: C5 . X5 .\n',
      '//// file: sprites.emit\nsprite ok: 1x1\n  "1"\nsprite hero: 2x2\n  "11"\n  "1"\n',
      '//// file: stages.emit\nsprite ok: 1x1\n  "1"\nmap room: 2x1, tile 8\n  legend # wall solid #ff0000\n  rows\n    "#?"\n',
      '//// file: stages.emit\nsound ok: sine 440\ncontrols pad: stick middle, buttons A\n',
    ].map(s => errs(main + s).join(' | ').replace(/:\s.*$/, m => m.split(' ')[0]));
    out.clash = [
      errs('sprite room: 1x1\n  "1"\nmap room: 1x1\n  legend # w #ffffff\n  rows\n    "#"\nexport fn main() {\n  drawMap(room)\n}\n'),
      errs('//// file: main.emit\nexport fn main() {\n  draw(pad, 1, 1)\n}\n//// file: sprites.emit\nsprite pad: 1x1\n  "1"\n//// file: stages.emit\ncontrols pad: stick left\n'),
      errs('sound coin: sine 440\nsprite coin: 1x1\n  "1"\nexport fn main() {\n  play(coin)\n  draw(coin, 1, 1)\n}\n')];
    return out;
  }, [ONE_FILE, MULTI]);
  check('a sprite and a map / controls of the same name is an error at the second one (in one file and across files)',
    /^throws 3:5: map room has the same name as the sprite room at line 1/.test(r.clash[0][0]) && /^throws stages\.emit:1:10: controls pad has the same name as the sprite pad at sprites\.emit:1/.test(r.clash[1][0]), JSON.stringify(r.clash));
  check('a sound and a sprite may share a name (play() and draw() tell them apart)', JSON.stringify(r.clash[2]) === '[]', JSON.stringify(r.clash[2]));
  check('all kinds in one file compile without errors', JSON.stringify(r.one) === '[]', JSON.stringify(r.one));
  check('all kinds over four files compile without errors', JSON.stringify(r.multi) === '[]', JSON.stringify(r.multi));
  for (const k in r.after) {
    const [type, syn, n] = r.after[k];
    check('an error after a ' + k + ' block is at its own line (type and syntax errors)', JSON.stringify(type) === JSON.stringify([(n + 3) + ':3: Cannot assign str to int']) && syn.length === 1 && syn[0].startsWith('throws ' + (n + 4) + ':1: '), JSON.stringify([type, syn]));
  }
  check('an error after all five kinds of blocks in one file', JSON.stringify(r.allAfter[0]) === JSON.stringify([(r.allAfter[1] + 2) + ':3: Cannot assign str to int']), JSON.stringify(r.allAfter));
  check('errors in several files after blocks keep their file:line:col', JSON.stringify(r.files) === JSON.stringify(['main.emit:6:3: Cannot assign str to int', 'stages.emit:8:3: Return type is int but this returns str — change the return type to str or cast the value']), JSON.stringify(r.files));
  check('an error inside each kind of block (after another block in its file) has the exact file:line:col',
    JSON.stringify(r.inside) === JSON.stringify(['throws sounds.emit:3:13:', 'throws sounds.emit:3:21:', 'throws sprites.emit:5:3:', 'throws stages.emit:6:7:', 'throws stages.emit:2:21:']), JSON.stringify(r.inside));
}

async function extentChecks(page) {
  const SRCS = [
    // trailing blank lines are not part of a block; blank lines inside are
    'sprite a: 1x1\n  "1"\n\n\nmap m: 1x1\n  legend # w #ffffff\n\n  rows\n    "#"\n\n\nexport fn main() {}\n',
    // headers inside comments and strings are ignored
    '/* sprite x: 1x1\n  "1"\nmap q: 1x1 */\nlet s = "sprite y: 1x1"\n// controls c: stick left\nsprite real: 1x1\n  "1"\n',
    // a block body that looks like code / comments / strings to the other parts
    'sound s: square 880, /* not a comment opener (an unknown part: a warning)\nsprite after: 1x1\n  "1"\nmusic t: 120 bpm, 4 steps\n  lead square: C5 . . .\ncontrols pad: stick left, buttons A "it\'s"\nmap m: 1x1\n  legend # w #ffffff\n  rows\n    "#"\n',
    // indentation with tabs, CRLF, blocks at the end of the text without a newline
    'sprite t: 1x1\r\n\t"1"\r\n\r\ncontrols p: stick none, buttons A\r\nmap e: 1x1\n  legend # w #ffffff\n  rows\n    "#"',
    // a header not in column 1, a header of a kind that is not a block, a block right after another one
    '  sprite no: 1x1\nregion r: int[4]\nsprite a: 1x1\n  "1"\nsprite b: 1x1\n  "1"\nmap m: 1x1\n  legend # w #ffffff\n  rows\n    "#"\ncontrols c: stick left\n',
  ];
  const r = await page.evaluate(SRCS => SRCS.map(src => {
    const core = _drawerScan(src).map(b => b.kind + ' ' + b.name + ' ' + b.start + '-' + b.end);
    const own = _sprFindBlocks(src).map(b => 'sprite ' + b.name + ' ' + b.start + '-' + b.end)
      .concat(_stFindBlocks(src).map(b => b.kind + ' ' + b.name + ' ' + b.line + '-' + b.end));
    _projLoad('//// file: a.emit\n' + src.replace(/\r/g, '') + '\n//// file: b.emit\n' + src.replace(/\r/g, ''));
    const helpers = ['sprite', 'map', 'controls'].map(k => _drawerBlocks(k).map(b => b.path + ' ' + k + ' ' + b.name + ' ' + (b.startLine - 1) + '-' + (b.endLine - 1))).flat();
    const finders = ['a.emit', 'b.emit'].map(p => { const s = _proj.files[_projFind(p)].source; return _sprFindBlocks(s).map(b => p + ' sprite ' + b.name + ' ' + b.start + '-' + b.end).concat(_stFindBlocks(s).map(b => p + ' ' + b.kind + ' ' + b.name + ' ' + b.line + '-' + b.end)); }).flat();
    return { core: core.filter(x => /^(sprite|map|controls) /.test(x)).sort(), own: own.sort(), helpers: helpers.sort(), finders: finders.sort(), all: core };
  }), SRCS);
  const want = [
    ['map m 4-8', 'sprite a 0-1'],
    ['sprite real 5-6'],
    ['controls pad 5-5', 'map m 6-9', 'sprite after 1-2'],
    ['controls p 3-3', 'map e 4-7', 'sprite t 0-1'],
    ['controls c 10-10', 'map m 6-9', 'sprite a 2-3', 'sprite b 4-5'],
  ];
  r.forEach((x, i) => {
    check('block extent ' + (i + 1) + ': the drawer scanner, SPRITE\'s and STAGE\'s finders and the drawer\'s helpers agree', JSON.stringify(x.core) === JSON.stringify(x.own) && JSON.stringify(x.helpers) === JSON.stringify(x.finders) && JSON.stringify(x.core) === JSON.stringify(want[i].map(s => s.replace(/^(\w+) (\w+)/, '$1 $2')).sort()), JSON.stringify(x));
  });
  // the compiler sees the same blocks: source 3 (a sound body with "/*") and 5 compile
  const comp = await page.evaluate(SRCS => [2].map(i => { try { return compile(SRCS[i].replace(/"it's"/, '"ok"') + '\nexport fn main() {\n  print(1)\n}\n').errors.join(' | ') || 'OK'; } catch (e) { return e.message; } }), SRCS);
  check('the compiler finds the same blocks (a "/*" inside a sound line does not hide the sprite after it)', comp.every(c => c === 'OK'), JSON.stringify(comp));
}

async function filesAndExamples(browser, fileUrl) {
  const page = await openIde(browser, fileUrl, DESK);
  const r = await page.evaluate(() => {
    const files = JSON.stringify(_DRAWER_FILES);
    _projLoad('export fn main() {\n  print(1)\n}\n');
    const at = {};
    at.sound = _drawerWrite('sound', 's1', 'sound s1: sine 440').path;
    at.music = _drawerWrite('music', 'm1', 'music m1: 120 bpm, 4 steps\n  lead square: C5 . . .').path;
    at.sprite = _drawerWrite('sprite', 'p1', 'sprite p1: 1x1\n  "1"').path;
    at.map = _drawerWrite('map', 'r1', 'map r1: 1x1\n  legend # w #ffffff\n  rows\n    "#"').path;
    at.controls = _drawerWrite('controls', 'c1', 'controls c1: stick left, buttons A').path;
    let errs; try { errs = compile(_projText()).errors.join(' | ') || 'OK'; } catch (e) { errs = e.message; }
    return { files, at, paths: _proj.files.map(f => f.path), errs };
  });
  check('default files: sounds / music → sounds.emit, sprites → sprites.emit, maps / controls → stages.emit, things / rules → game.emit',
    r.files === JSON.stringify({ sound: 'sounds.emit', music: 'sounds.emit', sprite: 'sprites.emit', map: 'stages.emit', controls: 'stages.emit', thing: 'game.emit', rules: 'game.emit' }), r.files);
  check('new blocks are written to their default files, and the project compiles', JSON.stringify(r.at) === JSON.stringify({ sound: 'sounds.emit', music: 'sounds.emit', sprite: 'sprites.emit', map: 'stages.emit', controls: 'stages.emit' }) && r.errs === 'OK', JSON.stringify(r));
  const opts = await page.$$eval('#example option', os => os.map(o => o.value));
  check('Example dropdown: the tool examples are listed, Memory and Modules are the last two', ['sfx', 'sprites', 'stage'].every(v => opts.includes(v)) && opts.slice(-2).join() === 'memory,modules', JSON.stringify(opts));
  // the three tool examples, loaded through the dropdown and run in turn in one page
  await page.mouse.click(5, 5);
  const seen = [];
  for (const ex of ['sfx', 'sprites', 'stage', 'sfx']) {
    await page.selectOption('#example', ex);
    await page.evaluate(() => compileAndRun());
    await page.waitForTimeout(1200);
    const st = await page.evaluate(() => ({
      status: document.getElementById('sTxt').innerText, out: document.getElementById('tab-output').innerText,
      canvas: !!document.querySelector('#tab-output canvas'), controls: !!document.querySelector('#tab-output [data-emit-controls]'),
      files: _proj.files.map(f => f.path) }));
    seen.push(ex + ':' + st.status);
    check('example ' + ex + ' (from the dropdown, after the others) runs without errors', st.status === 'Done' && !/✗|\bERROR\b/.test(st.out), JSON.stringify(st).slice(0, 400));
    if (ex === 'stage') check('example stage shows its on-screen controls', st.controls, '');
    if (ex === 'sfx' && seen.length > 1) check('back to the sound example: the stage controls are gone', !st.controls, '');
  }
  check('examples: no page errors', !page.errors.length, page.errors.join(' | '));
  await page.context().close();
}

async function memoryChecks(browser, fileUrl, mode, T) {
  const page = await openIde(browser, fileUrl, mode);
  await page.evaluate(() => {
    window._memtabToolLink = function (r) { return r.name === 'pts' ? { label: 'Edit pts', open: function () { window.__opened = r.name; } } : null; };
    _projLoad('region pts: int[4]\nregion other: int[2]\nexport fn main() {\n  pts[1] = 7\n  print(pts[1])\n}\n');
  });
  await page.evaluate(() => compileAndRun());
  await page.waitForTimeout(300);
  await page.evaluate(() => _drawerOpen());
  const card = await page.$('#drawer .drw-card[data-tool="memory"]');
  check(T + 'the drawer has a Memory card', !!card, '');
  if (card) await card.click();
  await page.waitForTimeout(200);
  const st = await page.evaluate(() => ({
    drawer: _drawerIsOpen(), tab: document.getElementById('tab-memory').style.display, active: document.querySelector('.otab.active').dataset.t,
    run: document.getElementById('pnl-run').className, cards: [...document.querySelectorAll('#tab-memory .mcard')].length,
    links: [...document.querySelectorAll('#tab-memory .mcard [data-act="tool"]')].map(b => b.textContent) }));
  check(T + 'the Memory card closes the drawer and shows the Memory tab of the Output view', !st.drawer && st.tab === 'block' && st.active === 'memory' && !/off-/.test(st.run) && st.cards === 2, JSON.stringify(st));
  check(T + 'the Memory tab asks _memtabToolLink for each region: a link only where it returns one', JSON.stringify(st.links) === '["Edit pts"]', JSON.stringify(st.links));
  if (st.links.length) {
    await page.click('#tab-memory .mcard [data-act="tool"]');
    const o = await page.evaluate(() => ({ opened: window.__opened, open: [...document.querySelectorAll('#tab-memory .mcard')].map(c => c.querySelector('.mbody').style.display) }));
    check(T + 'the link calls open() (and does not toggle the card)', o.opened === 'pts', JSON.stringify(o));
  }
  await page.evaluate(() => { _drawerOpen('memory'); });
  check(T + '_drawerOpen("memory") goes to the Memory tab too', await page.evaluate(() => !_drawerIsOpen() && document.querySelector('.otab.active').dataset.t === 'memory'), '');
  check(T + 'memory: no page errors', !page.errors.length, page.errors.join(' | '));
  await page.context().close();
}

async function highlightChecks(browser, fileUrl) {
  const page = await openIde(browser, fileUrl, DESK);
  const r = await page.evaluate(src => {
    _projLoad(src);
    hlCode();
    const lines = hlInner.innerHTML.split('\n');
    const at = re => lines[src.split('\n').findIndex(l => re.test(l))];
    return { sound: at(/^sound coin/), sprite: at(/^sprite hero/), row: at(/^  "12"/), map: at(/^map room/), controls: at(/^controls pad/) };
  }, ONE_FILE);
  const kw = s => (s.match(/<span class="kw">/g) || []).length;
  check('highlighting: every block header coloured once (sound, map, controls by the drawer; sprite by SPRITE), sprite rows painted',
    kw(r.sound) === 1 && kw(r.sprite) === 1 && kw(r.map) === 1 && kw(r.controls) === 1 && /class="spx"/.test(r.row) && /class="spr"/.test(r.sprite), JSON.stringify(r));
  await page.context().close();
}

(async () => {
  const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'emit-ide-1_32.html'));
  const fileUrl = 'file://' + file;
  const browser = await chromium.launch();
  let page = await openIde(browser, fileUrl, DESK);
  await compileChecks(page);
  await extentChecks(page);
  check('compile / extent checks: no page errors', !page.errors.length, page.errors.join(' | '));
  await page.context().close();
  for (const [mode, T] of [[DESK, '[desk] '], [PHONE, '[phone] ']]) {
    page = await openIde(browser, fileUrl, mode);
    await allKinds(page, T + 'one file: ', ONE_FILE);
    await allKinds(page, T + 'four files: ', MULTI);
    check(T + 'no page errors', !page.errors.length, page.errors.join(' | '));
    await page.context().close();
  }
  await exportChecks(browser, fileUrl);
  await filesAndExamples(browser, fileUrl);
  await memoryChecks(browser, fileUrl, DESK, '[desk] ');
  await memoryChecks(browser, fileUrl, PHONE, '[phone] ');
  await highlightChecks(browser, fileUrl);
  await browser.close();
  console.log('\n' + passed + '/' + (passed + failed) + ' integration checks passed');
  process.exit(failed ? 1 : 0);
})();

#!/usr/bin/env node
// Language and runtime checks for `sound` / `music` blocks and the play / music / stopMusic / musicPlaying
// builtins of an Emit IDE build, in headless Chromium: compile errors and warnings with exact positions,
// blocks across the files of a project, what the program schedules when it plays (in start code, button
// handlers, frame(), callbacks and await functions), the audio unlock on the first gesture, the music loop,
// and the exported .html / .js / offline .html pages. Offline: every network request is aborted.
//
//   node tests/run-sound.js [path/to/emit-ide.html]
//
// TEST-ONLY: tests/fake-audio.js replaces AudioContext in every page with a recorder (nothing is heard here):
// the checks look at the oscillators, buffer sources, gains and filters the synth schedules.
//
// Exit code 0 when every check passes.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const FAKE_AUDIO = require('./fake-audio.js');

let failed = 0, passed = 0;
function check(label, ok, detail) {
  if (ok) { passed++; console.log('PASS  ' + label); }
  else { failed++; console.log('FAIL  ' + label + (detail !== undefined ? '\n      ' + String(detail).slice(0, 700) : '')); }
}
const JS_ORIGIN = 'http://export.test';

const SFX = 'sound coin: square 880, 60ms, atk 1, rel 40, vol 0.5\nsound boom: noise 900 > 80, 300ms, lowpass 2000, curve exp\n\nmusic theme: 240 bpm, 4 steps\n  lead square: C5 . E5 -\n  drums: K . S .\n';
// [label, program, expected first error (exact), or {warn: exact warning}]
const ERRORS = [
  ['unknown sound name (bare), with a suggestion', SFX + 'export fn run() {\n  play(coni)\n}\n', '8:8: Unknown sound "coni" — did you mean "coin"?'],
  ['unknown sound name (string literal)', SFX + 'export fn run() {\n  play("zap")\n}\n', '8:8: Unknown sound "zap" — the sounds are coin, boom'],
  ['a music name given to play()', SFX + 'export fn run() {\n  play(theme)\n}\n', '8:8: Unknown sound "theme" — theme is a music block: music(theme)'],
  ['a sound name given to music()', SFX + 'export fn run() {\n  music(coin)\n}\n', '8:9: Unknown music "coin" — coin is a sound block: play(coin)'],
  ['play() of a name when there is no sound block at all', 'export fn run() {\n  play(x)\n}\n', '2:8: Unknown sound "x" — there is no sound block yet: write one (e.g. sound x: square 880, 90ms) or make one with the Drawer (🧰)'],
  ['play() with too many arguments', SFX + 'export fn run() {\n  play(coin, 1.0, 1.0, 2.0)\n}\n', '8:3: play takes 1 to 3 arguments: play(coin), play(coin, 1.5) or play(coin, 1.5, 0.8)'],
  ['a sound without a waveform', 'sound coin: sqare 880\n', '1:13: A sound starts with its waveform: sine, square, saw, triangle or noise — sound coin: square 880'],
  ['an empty sound', 'sound coin:\nexport fn run() {\n}\n', '1:12: A sound needs a waveform: sine, square, saw, triangle or noise — sound coin: square 880'],
  ['a bad value (position of the value)', 'sound coin: square, atk x\n', '1:25: atk needs a time in ms, not "x" — atk 20'],
  ['a value out of range', 'sound coin: square 880, vol 2\n', '1:29: vol must be between 0 and 1 — vol 0.5'],
  ['a missing end pitch', 'sound coin: square 880 >\n', '1:24: square needs an end pitch in Hz after > — square 880 > 1320'],
  ['a setting written twice', 'sound coin: square, vol 0.2, vol 0.3\n', '1:30: vol is set twice in this sound'],
  ['a bad note in a music track (line 3)', 'music m: 120 bpm, 4 steps\n  lead square: C5 . E5 .\n  bass sine: C2 H9 . .\n', '3:17: "H9" is not a note — C5, F#3, Bb2, a chord C4+E4+G4, . rest, - hold'],
  ['a bad drum letter', 'music m: 120 bpm, 4 steps\n  drums: K . X .\n', '2:14: "X" is not a drum hit — K kick, S snare, H hat, C clap (KH = two at once), . rest'],
  ['more steps than the music has', 'music m: 120 bpm, 4 steps\n  lead square: C5 . E5 . G5\n', '2:26: Track lead has 5 steps, the music has 4 — remove steps or write 5 steps in the first line'],
  ['a track without a waveform', 'music m: 120 bpm, 2 steps\n  lead: C5 .\n', '2:3: Track lead needs a waveform (sine square saw triangle noise) or drums — lead square: C5 . E5 .'],
  ['a bad bpm', 'music m: fast bpm\n', '1:10: bpm is a number from 20 to 400 — 120 bpm'],
  ['an unknown kind of block', 'sprit hero: 16x16\n  ..##..\nexport fn run() {\n}\n', '1:1: Unknown block "sprit hero:" — the kinds of blocks are sound, music, sprite, map, controls, thing, rules — did you mean sprite?'],
  ['two sounds with one name', 'sound coin: square\nsound coin: sine\n', '2:7: sound coin is already declared at line 1 — every sound needs its own name'],
  ['a block inside a function (indented)', 'export fn run() {\n  sound coin: square\n}\n', '2:3: sound blocks belong at the top level of a file and start in column 1 — sound coin: …'],
  ['a block header in column 1 inside a function', 'export fn run() {\nsound coin: square\n}\n', '2:1: sound coin: looks like a block — blocks belong at the top level of a file, starting in column 1'],
  ['an error in a sound block of another file names that file', 'export fn run() {\n  play(coin)\n}\n//// file: sounds.emit\nsound pew: sine\nsound coin: square, curve wobbly\n', 'sounds.emit:2:27: curve is lin or exp — curve exp'],
  ['an unknown sound in a non-entry file names that file', 'sound coin: square\nexport fn run() {\n}\n//// file: game/play.emit\npackage game\n\npublic fn go() {\n  play(coins)\n}\n', 'game/play.emit:4:8: Unknown sound "coins" — did you mean "coin"?'],
  ['an unknown part is a warning with its position (and compiles)', 'sound coin: square, reverb 2\nexport fn run() {\n  play(coin)\n}\n', { warn: '1:21: Unknown part "reverb 2" in this sound — ignored (known: len, atk, dec, sus, rel, vol, vib, lowpass, highpass, arp, curve)' }],
  ['a music without tracks is a warning', 'music m: 120 bpm, 8 steps\n', { warn: '1:9: This music has no tracks yet — add lines like:   lead square: C5 . E5 . G5 - - .' }],
];

async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext(opts.mode || { viewport: { width: 1000, height: 800 } });
  const page = await ctx.newPage();
  page.errors = []; page.requests = [];
  page.on('pageerror', e => page.errors.push(e.message.slice(0, 300)));
  await page.addInitScript(FAKE_AUDIO);
  if (opts.routes) await page.route(/^https?:/, route => { const u = route.request().url(); const f = opts.routes[u]; if (f) return route.fulfill({ body: f[0], contentType: f[1] }); page.requests.push(u); return route.abort(); });
  else await page.route(/^https?:/, route => { page.requests.push(route.request().url()); return route.abort(); });
  return page;
}
async function openIde(browser, fileUrl) {
  const page = await newPage(browser);
  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof compileAndRun === 'function' && typeof _projLoad === 'function');
  await page.waitForTimeout(100);
  await page.evaluate(() => { try { closeWelcome(); } catch (e) {} });
  return page;
}
const audio = page => page.evaluate(() => {
  // the runtime's own context (the IDE also makes one for its short "done" chime after each Run)
  const c = (typeof _sndAC !== 'undefined' && _sndAC) || (typeof _sndAC === 'undefined' ? window.__audio.ctx : null); if (!c) return { made: typeof _sndAC !== 'undefined' ? 0 : window.__audio.made, nodes: [] };
  const P = p => p ? p.events.map(e => [e[0], +(+e[1]).toFixed(4), +(+e[2]).toFixed(4)]) : null;
  return { made: typeof _sndAC !== 'undefined' ? 1 : window.__audio.made, state: c.state, now: c.currentTime, nodes: c.nodes.map(n => ({ kind: n.kind, type: n.type, startT: n.startT, stopT: n.stopT, f: P(n.frequency), g: P(n.gain), r: P(n.playbackRate), to: n.out.map(o => o.kind || (o.name ? 'param:' + o.name : '?')) })) };
});
const oscs = a => a.nodes.filter(n => n.kind === 'osc' && n.to.indexOf('param:frequency') < 0);
const runIde = async (page, src, wait) => { await page.evaluate(s => { _projLoad(s); }, src); await page.evaluate(() => compileAndRun()); await page.waitForTimeout(wait || 300); return page.evaluate(() => ({ status: document.getElementById('sTxt').innerText, out: document.getElementById('tab-output').innerText })); };
const gesture = page => page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));

(async () => {
  const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'emit-ide-1_32.html'));
  const fileUrl = 'file://' + file;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'emit-sound-'));
  const browser = await chromium.launch();
  let page = await openIde(browser, fileUrl), r, a, o;

  // ── compile errors and warnings ──
  const res = await page.evaluate(list => list.map(([label, src]) => { try { const c = compile(src); return { errors: c.errors, warnings: c.warnings }; } catch (e) { return { errors: [e.message], warnings: [], thrown: true }; } }), ERRORS);
  ERRORS.forEach(([label, src, exp], i) => {
    const got = res[i];
    if (typeof exp === 'string') check('error: ' + label, got.errors[0] === exp, JSON.stringify(got.errors) + ' expected ' + exp);
    else check('warning: ' + label, got.errors.length === 0 && got.warnings.indexOf(exp.warn) >= 0, JSON.stringify(got));
  });
  r = await page.evaluate(() => { _projLoad('sound coin: square\nexport fn run() {\n  play(coni)\n}\n'); compileAndRun(); return 0; });
  await page.waitForTimeout(200);
  r = await page.evaluate(() => { const e = document.querySelector('#tab-output .clickable-err, #tab-output .err'); return { status: document.getElementById('sTxt').innerText, txt: document.getElementById('tab-output').innerText }; });
  check('error: Run shows the unknown-sound error with its line and column', r.status !== 'Done' && /3:8: Unknown sound "coni"/.test(r.txt), JSON.stringify(r));
  // ── lowering, names, files ──
  r = await page.evaluate(src => { const c = compile(src); return { e: c.errors, meta: c.imports.soundMeta, imps: c.imports.map(i => i.module + '.' + i.name).sort().join(), sounds: c.sounds, music: c.music }; }, SFX + 'export fn run() {\n  play(coin)\n  play(boom, 2)\n  play("coin", 1.5, 0.5)\n  music(theme)\n  if (musicPlaying()) { stopMusic() }\n}\n');
  check('compile: the four builtins are imported from std; the blocks travel as imports.soundMeta (JSON)', r.e.length === 0 && r.imps === 'std.music,std.musicPlaying,std.play,std.stopMusic' && JSON.parse(r.meta).sounds.coin === ' square 880, 60ms, atk 1, rel 40, vol 0.5' && JSON.parse(r.meta).music.theme === ' 240 bpm, 4 steps\n  lead square: C5 . E5 -\n  drums: K . S .' && r.sounds.join() === 'coin,boom' && r.music.join() === 'theme', JSON.stringify(r));
  r = await page.evaluate(() => { const c = compile('export fn run() {\n  print(1)\n}\n'); return { meta: 'soundMeta' in c.imports, keys: Object.keys(c.imports).filter(k => !/^\d+$/.test(k)) }; });
  check('compile: a program without blocks carries no sound metadata', !r.meta, JSON.stringify(r));
  r = await page.evaluate(() => { const c = compile('sound coin: square\nfn play(n: int) {\n  print(n)\n}\nexport fn run() {\n  play(7)\n}\n'); return { e: c.errors, imps: c.imports.map(i => i.name).join() }; });
  check('compile: a program with its own fn play keeps calling it', r.e.length === 0 && r.imps.indexOf('play') < 0, JSON.stringify(r));
  r = await page.evaluate(() => { const c = compile('sound coin: square\nsound jump: sine\nexport fn run() {\n  let coin = "jump"\n  play(coin)\n}\n'); return { e: c.errors, ast: JSON.stringify(c.ast) }; });
  check('compile: a local variable named like a sound wins (passed on as a str)', r.e.length === 0 && r.ast.indexOf('"type":"StringLiteral","value":"coin"') < 0, JSON.stringify(r).slice(0, 300));
  r = await page.evaluate(() => compile('sound coin: square\nmusic coin: 120 bpm, 2 steps\n  a sine: C4 .\nexport fn run() {\n  play(coin)\n  music(coin)\n}\n').errors);
  check('compile: a sound and a music may share a name', r.length === 0, JSON.stringify(r));
  r = await page.evaluate(() => { const c = compile('export fn run() {\n  play(coin)\n  music(song)\n}\n//// file: sounds.emit\nsound coin: square 440\n//// file: audio/songs.emit\npackage audio\n\nmusic song: 100 bpm, 2 steps\n  a sine: C4 .\n'); return { e: c.errors, meta: JSON.parse(c.imports.soundMeta || 'null') }; });
  check('compile: blocks of other files (also in a folder) are visible by their bare name, no import needed', r.e.length === 0 && r.meta && r.meta.sounds.coin && r.meta.music.song, JSON.stringify(r));
  r = await page.evaluate(() => compile('sound coin: square\nexport fn run() {\n}\n//// file: x.emit\nsound coin: sine\n').errors);
  check('compile: one name in two files is an error naming the other file', r[0] === 'x.emit:1:7: sound coin is already declared in main.emit (line 1) — every sound needs its own name', JSON.stringify(r));
  r = await page.evaluate(() => { const ast = compile('sound coin: square\nexport fn run() {\n  play(coin)\n}\n').ast; return JSON.stringify(ast).indexOf('SoundDecl') < 0; });
  check('compile: blocks are not part of the compiled program (no SoundDecl in the AST)', r);
  r = await page.evaluate(() => { const ed = document.getElementById('editor'); _projLoad('sound coin: square 880, 90ms // hi\nmusic m: 120 bpm, 2 steps\n  lead square: C#5 -\nexport fn run() {\n  play(coin)\n}\n'); hlCode(); return document.getElementById('hlInner').innerHTML.split('\n').slice(0, 3); });
  check('editor: block lines are highlighted (kind keyword, name, numbers, notes, comment) with the text unchanged',
    r[0].indexOf('<span class="kw">sound</span> <span class="ty">coin</span><span class="dl">:</span> <span class="blt">square</span> <span class="num">880</span>') === 0 && r[0].indexOf('<span class="cmt">// hi</span>') > 0 && r[2].indexOf('<span class="str">C#5</span>') > 0 && await page.evaluate(() => document.getElementById('hlInner').textContent === document.getElementById('editor').value + '\n'), JSON.stringify(r));
  r = await page.evaluate(() => { const ed = document.getElementById('editor'); _projLoad('sound coin: square\nsound coal: sine\nexport fn run() {\n  play(co'); ed.focus(); ed.setSelectionRange(ed.value.length, ed.value.length); checkAC(); const p = document.getElementById('acPopup'); return { shown: p.classList.contains('show'), names: [...p.querySelectorAll('.ac-name')].map(e => e.textContent) }; });
  check('editor: play( suggests the sound names of the project', r.shown && r.names.join() === 'coin,coal', JSON.stringify(r));
  r = await page.evaluate(() => { const ed = document.getElementById('editor'); _projLoad('sou'); ed.focus(); ed.setSelectionRange(3, 3); checkAC(); const p = document.getElementById('acPopup'); return { names: [...p.querySelectorAll('.ac-name')].map(e => e.textContent) }; });
  check('editor: "sou" at a line start offers the sound block snippet', r.names.indexOf('sound block') >= 0, JSON.stringify(r));
  r = await page.evaluate(() => { const ed = document.getElementById('editor'); const p = document.getElementById('acPopup'); const i = [...p.querySelectorAll('.ac-name')].findIndex(e => e.textContent === 'sound block'); pickAC(i); return { v: ed.value, sel: ed.value.substring(ed.selectionStart, ed.selectionEnd) }; });
  check('editor: picking it writes a sound block with the name selected', r.v === 'sound name: square 880, 120ms' && r.sel === 'name', JSON.stringify(r));
  r = await page.evaluate(() => ['play', 'music', 'stopMusic', 'musicPlaying'].every(n => _allBuiltins.some(b => b.name === n)) && _emitBlt.has('stopMusic'));
  check('editor: the four builtins are in the autocomplete list and highlighted', r);

  // ── running in the IDE (recording AudioContext) ──
  const PRE = SFX + 'mut n = 0\n';
  r = await runIde(page, PRE + 'export fn start() {\n  play(coin)\n  music(theme)\n  if (musicPlaying()) { printStr("pending") }\n}\n');
  a = await audio(page);
  check('unlock: before any gesture play() is dropped silently (no AudioContext made) and music() waits', r.status === 'Done' && a.made === 0 && /pending/.test(r.out), JSON.stringify(r) + JSON.stringify(a).slice(0, 200));
  await gesture(page);
  await page.waitForTimeout(250);
  a = await audio(page);
  check('unlock: the first gesture creates and resumes the AudioContext and starts the waiting music', a.made === 1 && a.state === 'running' && oscs(a).some(x => x.type === 'square' && Math.abs(x.f[0][1] - 523.2511) < 0.01), JSON.stringify(a).slice(0, 300));
  r = await page.evaluate(() => _musicPlaying());
  await page.evaluate(() => stopProgram());
  check('music: Stop (■) stops the music', r === true && await page.evaluate(() => !_musicPlaying()));
  // a button handler
  r = await runIde(page, PRE + 'export fn start() {\n  button("go", 1)\n}\nexport fn onclick_1() {\n  play(coin, 2.0, 0.5)\n}\n');
  let n0 = (await audio(page)).nodes.length;
  await page.click('#tab-output button');
  await page.waitForTimeout(100);
  a = await audio(page); o = oscs({ nodes: a.nodes.slice(n0) });
  let g = a.nodes.slice(n0).find(x => x.kind === 'gain' && x.to.indexOf('gain') >= 0);
  check('play: in a button handler, with pitch 2 and volume 0.5: 1760 Hz square, peak 0.25', o.length === 1 && o[0].type === 'square' && o[0].f[0][1] === 1760 && g && g.g[1][1] === 0.25, JSON.stringify(a.nodes.slice(n0)).slice(0, 400));
  check('play: the envelope ends after length + release (60 + 40 ms) and the oscillator stops then', g && Math.abs(g.g[g.g.length - 1][2] - o[0].startT - 0.1) < 0.002 && Math.abs(o[0].stopT - o[0].startT - 0.12) < 0.002, JSON.stringify(g && g.g) + ' ' + JSON.stringify(o[0]));
  // frame()
  n0 = (await audio(page)).nodes.length;
  r = await runIde(page, PRE + 'export fn start() {\n  canvas(10, 10)\n  animate()\n}\nexport fn frame() {\n  n++\n  if (n % 10 == 0) { play(boom) }\n}\n', 700);
  await page.evaluate(() => stopProgram());
  a = await audio(page);
  let bufs = a.nodes.slice(n0).filter(x => x.kind === 'buffer');
  check('play: in frame() — noise with an exponential rate sweep and a low-pass, several times', r.status === 'Done' && bufs.length >= 2 && bufs[0].r[0][1] === 0.9 && bufs[0].r.some(e => e[0] === 'exp' && e[1] === 0.08) && a.nodes.slice(n0).some(x => x.kind === 'filter' && x.type === 'lowpass'), JSON.stringify(bufs.slice(0, 1)) + r.out.slice(0, 200));
  // a callback (setTimeout with fnRef)
  n0 = (await audio(page)).nodes.length;
  r = await runIde(page, PRE + 'fn later() {\n  play(coin, 0.5)\n}\nexport fn start() {\n  setTimeout(fnRef(later), 50)\n}\n', 400);
  a = await audio(page); o = oscs({ nodes: a.nodes.slice(n0) });
  check('play: in a callback (setTimeout + fnRef)', r.status === 'Done' && o.length === 1 && o[0].f[0][1] === 440, r.out.slice(0, 200) + JSON.stringify(o));
  // an await function
  n0 = (await audio(page)).nodes.length;
  r = await runIde(page, PRE + 'export fn start() {\n  await sleep(50)\n  play(coin)\n  let s = "boom"\n  play(s)\n  play("coin", 1.5)\n  music(theme)\n  await sleep(50)\n  if (musicPlaying()) { printStr("playing") }\n  stopMusic()\n  if (!musicPlaying()) { printStr("stopped") }\n}\n', 500);
  a = await audio(page); const nodes = a.nodes.slice(n0);
  check('play / music: in an await function; a str variable as the name; musicPlaying() / stopMusic()', r.status === 'Done' && /playing/.test(r.out) && /stopped/.test(r.out) && oscs({ nodes }).filter(x => x.type === 'square' && (x.f[0][1] === 880 || x.f[0][1] === 1320)).length >= 2 && nodes.some(x => x.kind === 'buffer'), r.out.slice(0, 300) + JSON.stringify(oscs({ nodes }).map(x => x.f[0][1])));
  // the music loop: 240 bpm, 4 steps = 0.25 s per bar; kick every bar, E5 held 2 steps
  n0 = (await audio(page)).nodes.length;
  r = await runIde(page, PRE + 'export fn start() {\n  music(theme)\n}\n', 900);
  a = await audio(page);
  const kicks = a.nodes.slice(n0).filter(x => x.kind === 'osc' && x.type === 'sine' && x.f && x.f[0][1] === 150).map(x => x.startT).sort((p, q) => p - q);
  const e5 = a.nodes.slice(n0).filter(x => x.kind === 'osc' && x.type === 'square' && Math.abs(x.f[0][1] - 659.2551) < 0.01);
  check('music: loops — a kick at the start of every bar, exactly 4 steps (0.25 s) apart on the audio clock', kicks.length >= 3 && kicks.slice(1).every((k, i) => Math.abs(k - kicks[i] - 0.25) < 1e-6), JSON.stringify(kicks));
  check('music: a held note (E5 -) sounds for its two steps', e5.length >= 1 && Math.abs(e5[0].stopT - e5[0].startT - (2 * 0.0625 - 0.012 + Math.min(0.12, (2 * 0.0625 - 0.012) * 0.5) + 0.02)) < 0.002, JSON.stringify(e5[0]));
  // music(theme) called in every frame keeps the one that plays (no restart each frame)
  await page.evaluate(() => stopProgram()); await page.waitForTimeout(100);
  n0 = (await audio(page)).nodes.length;
  r = await runIde(page, PRE + 'export fn start() {\n  canvas(10, 10)\n  animate()\n}\nexport fn frame() {\n  music(theme)\n}\n', 900);
  a = await audio(page);
  const k2 = a.nodes.slice(n0).filter(x => x.kind === 'osc' && x.type === 'sine' && x.f && x.f[0][1] === 150).map(x => x.startT).sort((p, q) => p - q);
  await page.evaluate(() => stopProgram());
  check('music: music(theme) in every frame() keeps the music playing (not restarted 60 times a second)', k2.length >= 3 && k2.length <= 5 && k2.slice(1).every((k, i) => Math.abs(k - k2[i] - 0.25) < 1e-6), JSON.stringify(k2));
  r = await runIde(page, PRE + 'export fn start() {\n  music(theme)\n}\n', 300);
  const before = (await audio(page)).nodes.length;
  r = await runIde(page, PRE + 'export fn start() {\n  print(1)\n}\n', 200);
  const mid = (await audio(page)).nodes.length;
  await page.waitForTimeout(400);
  a = await audio(page);
  check('music: a new Run stops the music of the previous one (nothing more is scheduled)', before > 0 && a.nodes.length === mid && !(await page.evaluate(() => _musicPlaying())), (a.nodes.length - mid) + ' nodes after the new Run');
  check('IDE: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();

  // ── exported pages ──
  page = await openIde(browser, fileUrl);
  const PROG = SFX + 'export fn start() {\n  button("coin", 1)\n  button("music", 2)\n}\nexport fn onclick_1() {\n  play(coin)\n}\nexport fn onclick_2() {\n  music(theme)\n}\n';
  const files = await page.evaluate(async src => {
    _projLoad(src);
    const r = compile(src);
    const P = _exportProgram(src, r);
    const out = { html: _exportHtml(P), js: _exportJs(P), rt: _exportRuntime() };
    window._saved = []; window._download = function (n, c) { window._saved.push({ n, c }); };
    await _doExportOffline('htmloff', src);
    out.off = (window._saved.find(x => /\.html$/.test(x.n)) || {}).c || null;
    return out;
  }, PROG);
  check('export: the runtime section has the synth and the players and nothing of the drawer', /function _sndVoice\(/.test(files.rt) && /function _musStart\(/.test(files.rt) && /function _sndParse\(/.test(files.rt) && !/_drawer/.test(files.rt) && !/\bed\.value\b/.test(files.rt), '');
  await page.context().close();
  const tryPage = async (kind, body) => {
    let p;
    if (kind === 'js') {
      p = await newPage(browser, { routes: {
        [JS_ORIGIN + '/program.js']: [files.js, 'text/javascript'],
        [JS_ORIGIN + '/index.html']: ['<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><div id="app"></div><script type="module">import init from "./program.js"; init({ target: document.getElementById("app") }).then(a => { window.__app = a; window.__state = "ready"; }, e => { window.__state = "error: " + e.message; });</script></body></html>', 'text/html'] } });
      await p.goto(JS_ORIGIN + '/index.html');
      await p.waitForFunction(() => window.__state, null, { timeout: 20000 });
    } else {
      p = await newPage(browser);
      const f = path.join(tmp, kind + '.html'); fs.writeFileSync(f, body);
      await p.goto('file://' + f);
    }
    await p.waitForFunction(() => document.querySelectorAll('button').length >= 2, null, { timeout: 20000 });
    const out = {};
    out.before = (await audio(p)).made;
    await p.click('button:text-is("coin")');
    await p.waitForTimeout(100);
    let a = await audio(p);
    out.coin = oscs(a).filter(x => x.type === 'square' && x.f[0][1] === 880).length;
    await p.click('button:text-is("music")');
    await p.waitForTimeout(400);
    a = await audio(p);
    out.music = a.nodes.filter(x => x.kind === 'osc' && x.type === 'sine' && x.f && x.f[0][1] === 150).length;
    out.state = a.state; out.errors = p.errors; out.requests = p.requests.filter(u => !u.startsWith(JS_ORIGIN));
    await p.context().close();
    return out;
  };
  for (const [kind, body] of [['html', files.html], ['js', files.js], ['offline-html', files.off]]) {
    if (!body) { check('export ' + kind + ': produced', false, 'no file'); continue; }
    r = await tryPage(kind, body);
    check('export ' + kind + ': no sound before a gesture; a click plays the sound block; music() loops; no network, no errors',
      r.before === 0 && r.coin === 1 && r.music >= 2 && r.state === 'running' && r.errors.length === 0 && r.requests.length === 0, JSON.stringify(r));
  }

  await browser.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + passed + '/' + (passed + failed) + ' sound checks passed');
  process.exit(failed ? 1 : 0);
})();

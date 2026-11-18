#!/usr/bin/env node
// Case-insensitive names: every Emit name is case-insensitive (`Hero` and `hero` are one name), names that differ
// only by case clash, names are shown as declared, JS names fall back to a property of another case, Mote with
// caseInsensitive, the drawer tools and the tutorial read mixed-case blocks. Headless Chromium, offline.
//
//   node tests/run-nocase.js [path/to/emit-ide.html] [filter]
//
// Exit code 0 when every check passes.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const FILE = path.resolve(args[0] && /\.html$/.test(args[0]) ? args.shift() : path.join(__dirname, '..', 'emit-ide-1_32.html'));
const FILTER = args[0] || '';
let passed = 0, failed = 0;
function check(label, ok, detail) {
  if (FILTER && label.indexOf(FILTER) < 0) return;
  if (ok) { passed++; console.log('PASS  ' + label); }
  else { failed++; console.log('FAIL  ' + label + (detail !== undefined ? '\n      ' + String(detail).slice(0, 900) : '')); }
}

// A stand-in "library" (window.FakeLib) so the JS-interop fallback can be tested offline.
const FAKE = `
window.FakeLib = {
  Scene: class Scene { constructor(n) { this.kind = 'scene'; this.n = n || 0; } },
  MakeIt: function (x) { return 'made ' + x; },
  Value: 5, both: 1, Both: 2,
  Inner: { DeepName: function () { return 'deep'; } },
};
window.Gizmo = function () { return 'big G'; };
window.dupe = function () { return 'lower'; };
window.Dupe = function () { return 'upper'; };
`;

async function newPage(browser, opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1200, height: 800 } }, opts || {}));
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message.slice(0, 300)));
  page.on('dialog', d => d.accept().catch(() => {}));
  await page.route(/^https?:/, r => r.abort());
  await page.goto('file://' + FILE);
  await page.waitForFunction(() => typeof compileAndRun === 'function' && typeof _projLoad === 'function');
  await page.evaluate(() => { try { closeWelcome(); } catch (e) {} try { localStorage.clear(); } catch (e) {} });
  await page.evaluate(FAKE);
  return page;
}
// compile in the page → {errors, exports (names of the WASM exports), sprites, regions, structs, sounds, maps, kinds}
const comp = (page, src) => page.evaluate(async s => {
  let r;
  try { r = compile(s, 'wasm32'); } catch (e) { return { thrown: e.message }; }
  let exp = [];
  try { if (!r.errors.length) { const m = await WebAssembly.compile(r.wasm); exp = WebAssembly.Module.exports(m).map(x => x.name); } } catch (e) { exp = ['?' + e.message]; }
  return { errors: r.errors, exports: exp, sprites: (r.sprites || []).map(x => x.name + ':' + x.frames.join('/')), regions: (r.regions || []).map(x => x.name), structs: (r.structs || []).map(x => x.name + '{' + (x.fields || []).map(f => f.name).join(',') + '}'), sounds: r.sounds || [], music: r.music || [], maps: (r.maps || []).map(m => m.name || m), wasm: Array.from(r.wasm).join(',') };
}, src);
// run in the editor (as the IDE does) → the Output tab's lines
async function run(page, src, wait) {
  await page.evaluate(s => { _projLoad(s); }, src);
  await page.evaluate(() => compileAndRun()).catch(e => page.errors.push('run: ' + e.message));
  await page.waitForTimeout(wait || 300);
  return page.evaluate(() => document.getElementById('tab-output').innerText.split('\n').map(l => l.trim()).filter(Boolean));
}
const has = (lines, want) => lines.some(l => l === want);
const inOrder = (lines, wants) => { let at = 0; for (const w of wants) { const i = lines.findIndex((l, k) => k >= at && (w instanceof RegExp ? w.test(l) : l === w)); if (i < 0) return false; at = i + 1; } return true; };

// ─────────────────────────── programs: names declared in one case, used in others ───────────────────────────
const RUNS = [
  { name: 'variables, functions, parameters, globals', src: `
FN Greet(Name: STR) {
  PrintStr("hi " + NAME)
}
Let Total = 3
mut COUNT = 0
Export fn Run() {
  greet("ann")
  count = Count + total
  Print(COUNT)
  If (TRUE) { PRINT(1) } Else { print(0) }
  Let e2: INT = 5
  print(E2 * 2)
  let F: Num = 2.5
  printNum(f)
}`, out: ['> hi ann', '> 3', '> 1', '> 10', '> 2.5'] },
  { name: 'keywords and types: While, For, Return, Break, NULL, Js', src: `
fn Sum(N: Int) INT {
  MUT s = 0
  FOR (LET i = 0; I < n; i++) { s += I }
  WHILE (true) { BREAK }
  RETURN S
}
export fn run() {
  print(sum(5))
  let o: JS = NULL
  if (O == null) { printStr("null ok") }
}`, out: ['> 10', '> null ok'] },
  { name: 'builtins in any case (PrintStr, printstr, FLOOR, Sqrt)', src: `
export fn run() {
  PrintStr("a")
  printstr("b")
  PRINT(FLOOR(2.7))
  print(Floor(SQRT(16.0)))
}`, out: ['> a', '> b', '> 2', '> 4'] },
  { name: 'a local shadows a global of another case (as shadowing today)', src: `
let Hero = 1
export fn run() {
  let hero = 5
  print(HERO)
  show()
}
fn show() { print(hero) }`, out: ['> 5', '> 1'] },
  { name: 'catch (Err) and E (the builtin) in the same program', src: `
export fn run() {
  try { throw "boom" } catch (Err) { printStr(err) }
  print(floor(e() * 100.0))
}`, out: ['> Error: boom', '> 271'] },
  { name: 'structs, fields, regions, with … as', src: `
STRUCT Ball { X: Num, y: num, Alive: Bool }
REGION balls: BALL[4]
export fn run() {
  Balls[0].x = 1.5
  BALLS[0].Y = 2.5
  balls[1].ALIVE = true
  With balls[0] As B { printNum(b.X + B.Y) }
  print(balls.LENGTH)
  if (BALLS[1].alive) { printStr("alive") }
}`, out: ['> 4', '> 4', '> alive'] },
  { name: 'fnRef(Name) and fnRef("name") find the function', src: `
fn Tick(v: int) { print(v) }
export fn run() {
  let P1 = __jsGlobal("Promise")
  p1.resolve(5).then(fnRef(TICK))
  P1.Resolve(6).then(fnRef("tick"))
}`, out: ['> 5', '> 6'], wait: 500 },
  { name: 'modules: Import Game.Physics finds game/physics.emit; alias and members in any case; package GAME', src: `
Import Game.Physics
import GAME.physics.STEP as Go
export fn run() {
  physics.Step(1)
  print(Physics.TICKS)
  go(2)
  print(PHYSICS.ticks)
}
//// file: game/physics.emit
Package GAME
public mut Ticks = 0
public fn step(n: int) { ticks = TICKS + n }
`, out: ['> 1', '> 3'] },
  { name: 'modules: import Util.* (names in any case)', src: `
import UTIL.*
export fn run() { print(DOUBLE(4)) }
//// file: util.emit
public fn double(x: int) int { return X * 2 }
`, out: ['> 8'] },
  { name: 'JS interop: members, calls, new, globals in another case', src: `
export fn run() {
  let s = new fakelib.scene(3)
  printStr(s.KIND)
  print(S.N)
  printStr(FAKELIB.makeit("x"))
  print(fakeLib.value)
  fakelib.VALUE = 7
  print(FakeLib.Value)
  printStr(gizmo())
  printStr(fakelib.inner.deepname())
  let o = {Name: "x"}
  o.newProp = 3
  print(o.NEWPROP)
  printStr(o.name)
}`, out: ['> scene', '> 3', '> made x', '> 5', '> 7', '> big G', '> deep', '> 3', '> x'] },
  { name: 'JS interop: let scene = new FakeLib.Scene() / let gizmo = Gizmo() — an initialiser does not see the name it declares', src: `
export fn run() {
  let gizmo = Gizmo()
  printStr(GIZMO)
  let fakelib = FakeLib.MakeIt("y")
  printStr(fakeLib)
}`, out: ['> big G', '> made y'] },
  { name: 'JS interop: the exact name wins (dupe / Dupe are two globals)', src: `
export fn run() {
  printStr(dupe())
  printStr(Dupe())
}`, out: ['> lower', '> upper'] },
  { name: 'JS interop: two properties that differ only by case → a catchable error naming both', src: `
export fn run() {
  try { print(fakelib.BOTH) } catch (e) { printStr("caught: " + e) }
  print(fakelib.both)
  print(fakelib.Both)
}`, out: [/^> caught: Error: "BOTH" is ambiguous: this JavaScript object has 2 properties that differ only by case \(both, Both\)/, '> 1', '> 2'] },
  { name: 'Mote through Emit: moteVM is case-insensitive', src: `
export fn run() {
  let vm = MoteVM()
  moteSet(vm, "HeroHp", 10)
  let r = moteRun(vm, "LOCAL Bonus = 5 IF herohp > 5 THEN Bonus = BONUS + HEROHP END RETURN bonus")
  print(r)
  moteRun(vm, "FUNCTION Update(dt) RETURN Math.Floor(dt * 10) END")
  print(moteCall(vm, "UPDATE", 1.25))
  print(moteGet(vm, "HEROHP"))
}`, out: ['> 15', '> 12', '> 10'] },
];

// ─────────────────────────── clashes: names that differ only by case ───────────────────────────
const CLASHES = [
  { name: 'two globals hero / Hero', src: 'let hero = 1\nlet Hero = 2\nexport fn run() { print(hero) }\n', err: [/^2:5: "Hero" and "hero" \(declared at 1:5\) differ only by case/] },
  { name: 'a function and a variable', src: 'fn Score() int { return 1 }\nlet score = 2\nexport fn run() { print(score) }\n', err: [/^2:5: "score" and "Score" \(declared at 1:4\) differ only by case/] },
  { name: 'two parameters', src: 'fn f(a: int, A: int) int { return a }\nexport fn run() { print(f(1, 2)) }\n', err: [/^1:14: "A" and "a" \(declared at 1:6\)/] },
  { name: 'two locals in one block', src: 'export fn run() {\n  let x = 1\n  let X = 2\n  print(x)\n}\n', err: [/^3:7: "X" and "x" \(declared at 2:7\)/] },
  { name: 'locals in two functions do not clash', src: 'fn a() { let hp = 1 print(hp) }\nfn b() { let HP = 2 print(Hp) }\nexport fn run() { a() b() }\n', err: [] },
  { name: 'two struct fields', src: 'struct P { x: num, X: num }\nregion ps: P[2]\nexport fn run() { print(ps.length) }\n', err: [/^1:20: field "X" and "x" \(field at 1:12\) differ only by case/] },
  { name: 'two sprite blocks (sprite hero / sprite Hero)', src: 'sprite hero: 2x2\n  "11"\n  "11"\nsprite Hero: 2x2\n  "11"\n  "11"\nexport fn run() { draw(hero, 0, 0) }\n', err: [/^4:8: sprite "Hero" and "hero" \(sprite at 1:8\) differ only by case/] },
  { name: 'blocks of different kinds may share a name in another case', src: 'sprite Hero: 2x2\n  "11"\n  "11"\nthing hero: sprite HERO, at 10 10\n', err: [] },
  { name: 'two files that are the same module (Game.emit / game.emit)', src: 'export fn run() { print(1) }\n//// file: Game.emit\npublic fn a() {}\n//// file: game.emit\npublic fn b() {}\n', err: [/^game\.emit:1:1: File "game\.emit" and file "Game\.emit" are both module Game/] },
  { name: 'two fields of one thing', src: 'thing hero: box 8 8, hp 3, HP 4\n', err: [/field of thing hero "HP" and "hp" .* differ only by case/] },
  { name: 'two frames of a sprite', src: 'sprite s: 1x1, fps 2\n  frame Walk\n    "1"\n  frame walk\n    "1"\nexport fn run() { draw(s, 0, 0) }\n', err: [/Frame "walk" and frame "Walk" \(line 2\) differ only by case/] },
  { name: 'two legend names of a map', src: 'map m: 2x1\n  legend # Wall solid, = wall solid\n  rows\n    "#="\nexport fn run() { drawMap(m) }\n', err: [/Legend names "wall" and "Wall" \(line 2\) differ only by case/] },
  { name: 'two tracks of a music block', src: 'music t: 120 bpm, 4 steps\n  Lead square: C4 . . .\n  lead saw: C4 . . .\nexport fn run() { music(t) }\n', err: [/Tracks Lead and lead differ only by case/] },
  { name: 'an import alias and a top-level name', src: 'import util\nlet Util = 1\nexport fn run() { print(1) }\n//// file: util.emit\npublic fn f() {}\n', err: [/main\.emit:\d:\d: "(Util|util)" and "(util|Util)" \(declared at (1:8|2:5)\) differ only by case/] },
];

const MIXED_GAME = g => g.replace(/thing hero: sprite hero/, 'Thing hero: Sprite HERO').replace(/chase hero 0.6/, 'Chase HERO 0.6')
  .replace(/^rules:/m, 'Rules:').replace(/on hit hero coin: remove coin : add score 1 : play coin/, 'On Hit Hero COIN: Remove Coin : Add score 1 : Play Coin')
  .replace(/show score, hero.hp/, 'Show SCORE, HERO.HP').replace(/every frame: hero mv/, 'Every Frame: Hero MV')
  .replace(/^sprite hero: 14x14, fps 6/m, 'Sprite hero: 14X14, FPS 6').replace(/  frame idle/, '  Frame idle').replace(/  palette /, '  Palette ')
  .replace(/^sound coin:/m, 'Sound coin:').replace(/^music theme: 120 bpm, 16 steps/m, 'Music theme: 120 BPM, 16 Steps').replace(/on start: music theme/, 'On Start: Music THEME')
  .replace(/when hero.hp <= 0/, 'When Hero.Hp <= 0').replace(/stage size 320 240/, 'Stage Size 320 240').replace('square 988, 80ms, atk 1', 'Square 988, 80MS, ATK 1')
  .replace('lead square vol 0.5:', 'lead SQUARE Vol 0.5:').replace('  drums: K', '  Drums: K');

(async () => {
  const browser = await chromium.launch();
  try {
    // ── run every program ──
    {
      const page = await newPage(browser);
      for (const t of RUNS) {
        const lines = await run(page, t.src.trim() + '\n', t.wait);
        const bad = lines.filter(l => /^✗/.test(l) && !t.out.some(w => w instanceof RegExp ? w.test(l) : w === l));
        check('run: ' + t.name, inOrder(lines, t.out) && !bad.length, lines.join(' | '));
      }
      check('run: no page errors', !page.errors.length, page.errors.join(' | '));
      await page.context().close();
    }
    // ── clashes ──
    {
      const page = await newPage(browser);
      for (const t of CLASHES) {
        const r = await comp(page, t.src);
        const errs = r.thrown ? [r.thrown] : r.errors;
        const ok = t.err.length ? t.err.every(re => errs.some(e => re.test(e))) : !errs.length;
        check('clash: ' + t.name + (t.err.length ? ' → an error with both positions' : ' → no error'), ok, JSON.stringify(errs));
      }
      // the error stops the program: nothing runs
      const lines = await run(page, 'let hero = 1\nlet Hero = 2\nexport fn run() { print(77) }\n');
      check('clash: a clash is a compile error (the program does not run)', !has(lines, '> 77') && lines.some(l => /differ only by case/.test(l)), lines.join(' | '));
      await page.context().close();
    }
    // ── exports: the host finds frame / onclick_N however they are written ──
    {
      const page = await newPage(browser);
      const r = await comp(page, 'mut n = 0\nexport fn Frame() { N++ }\nexport fn OnClick_1() { print(n) }\nexport fn Start() { button("Go", 1) }\n');
      check('exports: export fn Frame / OnClick_1 are exported as frame / onclick_1 (other exports keep their spelling)', !r.errors.length && r.exports.includes('frame') && r.exports.includes('onclick_1') && r.exports.includes('Start'), JSON.stringify(r.exports));
      const lines = await run(page, 'mut n = 0\nexport fn FRAME() { N++ }\nexport fn ONCLICK_1() { print(n) }\nexport fn Start() { button("Go", 1) }\n', 400);
      await page.evaluate(() => { _emitCallExport(window._wi, 'frame', []); _emitCallExport(window._wi, 'FRAME', []); });
      const ticks = await page.evaluate(() => { const b = [...document.querySelectorAll('#tab-output button, #tab-output .emit-btn, button')].find(x => x.textContent === 'Go'); if (b) b.click(); return !!b; });
      await page.waitForTimeout(250);
      const after = await page.evaluate(() => document.getElementById('tab-output').innerText);
      check('exports: the host calls frame() (as "frame" and "FRAME"), the button calls onclick_1 and prints the count', ticks && /> [2-9]\d*\s*$/.test(after), after.slice(-300));
      const via = await page.evaluate(() => { try { return String(_emitCallExport(window._wi, 'start', [])); } catch (e) { return 'threw ' + e.message; } });
      check('exports: _emitCallExport(inst, "start") finds Start', !/threw/.test(via), via);
      await page.context().close();
    }
    // ── blocks in any case: the Coin Dash example with mixed-case keywords and uses compiles to the same bytes ──
    {
      const page = await newPage(browser);
      const g = await page.evaluate(() => EX.game);
      const a = await comp(page, g), b = await comp(page, MIXED_GAME(g));
      check('blocks: Coin Dash with Thing / Rules: / On Hit Hero COIN / Sprite / FPS / Sound / Music / BPM / Stage Size … compiles to the same WASM', !b.errors.length && a.wasm === b.wasm, JSON.stringify(b.errors));
      const st = await page.evaluate(() => EX.stage);
      const v = st.replace('useControls(pad)', 'UseControls(PAD)').replace('coins = objCount(room, "coin")', 'COINS = ObjCount(Room, "COIN")').replace('px = objX(room, "hero", 0)', 'PX = objx(ROOM, "Hero", 0)')
        .replace('map room: 16x10, tile 16', 'Map room: 16X10, Tile 16').replace('  legend #', '  Legend #').replace('wall solid', 'wall SOLID').replace('  rows', '  ROWS').replace('  objects', '  Objects')
        .replace('controls pad: stick left, buttons A "beep", size 1.0', 'Controls pad: Stick Left, Buttons a "beep", SIZE 1.0').replace('justPressed("A")', 'JustPressed("a")').replace('drawMap(room)', 'DRAWMAP(Room)');
      const c = await comp(page, v);
      check('blocks: the Stage example with Map / Legend / ROWS / Objects / Controls / Stick Left / Buttons a and mixed-case uses compiles', !c.errors.length && c.maps.length === 1, JSON.stringify(c.errors));
      // names as declared
      const d = await comp(page, 'Sprite Hero: 2x1, fps 2\n  Frame Walk\n    "11"\n  frame Jump\n    "1."\nSound Coin: square 880\nstruct Vec { X: num, y: num }\nregion Spots: VEC[2]\nexport fn run() { draw(hero, 0, 0, "walk") anim(HERO, 1.0) play(COIN) play("coin") spots[0].x = 1.0 }\n');
      check('blocks: names are shown as declared (sprites Hero:Walk/Jump, sound Coin, region Spots, struct Vec{X,y})', !d.errors.length && d.sprites.join() === 'Hero:Walk/Jump' && d.sounds.join() === 'Coin' && d.regions.join() === 'Spots' && d.structs.join() === 'Vec{X,y}', JSON.stringify(d));
      const sc = await comp(page, 'Script Intro:\n  LOCAL n = 1\n  IF n == 1 THEN Print("hi") END\nexport fn run() {\n  let vm = moteVM()\n  moteRun(vm, INTRO)\n}\n');
      check('blocks: Script Intro: with Mote keywords in capitals compiles; INTRO names the script', !sc.errors.length, JSON.stringify(sc.errors || sc.thrown));
      // the game runs, the rules see the things
      const lines = await run(page, MIXED_GAME(g), 700);
      const meta = await page.evaluate(() => { try { return { kinds: _lgMeta.kinds.map(k => k.name), shows: _lgMeta.shows, tick: _lgTick }; } catch (e) { return { err: e.message }; } });
      check('blocks: the mixed-case Coin Dash runs (frames tick, kinds hero / coin / rock / slime, show score)', !lines.some(l => /^✗/.test(l)) && meta.tick > 3 && meta.kinds && meta.kinds.join() === 'hero,coin,rock,slime', JSON.stringify(meta) + ' ' + lines.filter(l => /✗/.test(l)).join(' | '));
      check('blocks: no page errors', !page.errors.length, page.errors.join(' | '));
      await page.context().close();
    }
    // ── the drawer tools read mixed-case blocks; writing keeps the user's spelling ──
    {
      const page = await newPage(browser);
      const PROJ = '//// file: main.emit\nexport fn run() { print(1) }\n//// file: sprites.emit\nSprite Hero: 4x2\n  Palette 1a1c2c 5fcde4\n  FRAME Idle\n    "1221"\n    "2112"\n//// file: sounds.emit\nSound Coin: Square 988, 80MS, ATK 1\nMusic Theme: 120 BPM, 4 Steps\n  Lead SQUARE: C5 . E5 .\n  Drums: K . S .\n//// file: stages.emit\nMap Level1: 3x2, TILE 8\n  LEGEND # Wall SOLID #3a3a5c, . floor #1b1b2a\n  ROWS\n    "#.#"\n    "..."\n  OBJECTS\n    HERO 1,1\n    Coin 2,1\nControls Pad: Stick LEFT, Buttons a "jump"\n//// file: game.emit\nThing HERO: Sprite hero, From Map LEVEL1, Speed 2\nthing coin: BOX 4 4, From Map Level1\nRules:\n  Stage Map level1\n  On Hit Hero COIN: Remove Coin : Add Score 1\n//// file: scripts.emit\nScript Intro:\n  PRINT("hi")\n';
      await page.evaluate(t => _projLoad(t), PROJ);
      const r = await page.evaluate(() => {
        const names = k => _drawerBlocks(k).map(b => b.name).join();
        const out = { bn: { sprite: names('sprite'), sound: names('sound'), music: names('music'), map: names('map'), controls: names('controls'), thing: names('thing'), rules: _drawerBlocks('rules').length, script: names('script') } };
        out.readHero = (_drawerRead('sprite', 'hero') || '').split('\n')[0];
        out.readHERO = (_drawerRead('SPRITE', 'HERO') || '').split('\n')[0];
        const d = _sprParse(_drawerRead('sprite', 'hero').split('\n'), 1, true);
        out.spr = { name: d.name, w: d.w, h: d.h, frames: d.frames.map(f => f.name).join(), pal: d.palette.join(' '), errs: d.errors.map(e => e.msg) };
        out.fmt = _sprFormat(d).split('\n')[0];
        const M = _stBlockModel('map', 'level1', _drawerRead('map', 'LEVEL1'));
        out.map = { name: M.name, w: M.w, tile: M.tile, legend: M.legend.map(e => e.ch + e.name + (e.solid ? '!' : '')).join(' '), objects: M.objects.map(o => o.kind).join(), problems: M.problems.map(p => p.msg) };
        const C = _stBlockModel('controls', 'pad', _drawerRead('controls', 'PAD'));
        out.ctl = { stick: C.stick, buttons: C.buttons.map(b => b.id + (b.label || '')).join(), problems: C.problems.map(p => p.msg) };
        const T = _lgParseBlock(_drawerRead('thing', 'hero')).decl;
        out.thing = { name: T.name, items: T.items.map(i => i.kind + (i.sprite ? ':' + i.sprite.value : i.map ? ':' + i.map.value : i.name ? ':' + i.name : '')).join() };
        const R = _lgParseBlock(_drawerRead('rules', '')).decl;
        out.rules = R.rules.map(x => (x.dir || x.ev) + (x.what ? ':' + x.what : '') + (x.a ? ':' + x.a.value + '/' + x.b.value : '') + '>' + (x.actions || []).map(a => a.verb).join('/')).join(' ');
        const S = _sndParse(_drawerBody(_drawerRead('sound', 'coin'), 'sound'));
        out.snd = { wave: S.spec.wave, len: S.spec.len, errs: S.errors.length };
        const Mu = _musParse(_drawerBody(_drawerRead('music', 'THEME'), 'music'));
        out.mus = { bpm: Mu.spec.bpm, steps: Mu.spec.steps, tracks: Mu.spec.tracks.map(t => t.name + (t.drums ? ':drums' : ':' + t.wave)).join(), errs: Mu.errors.length };
        try { out.compile = compile(_projText(), 'wasm32').errors; } catch (e) { out.compile = [e.message]; }
        return out;
      });
      check('tools: _drawerBlocks finds Sprite / Sound / Music / Map / Controls / Thing / Rules: / Script headers, names as written', r.bn.sprite === 'Hero' && r.bn.sound === 'Coin' && r.bn.music === 'Theme' && r.bn.map === 'Level1' && r.bn.controls === 'Pad' && r.bn.thing === 'HERO,coin' && r.bn.rules === 1 && r.bn.script === 'Intro', JSON.stringify(r.bn));
      check('tools: _drawerRead(kind, name) finds a block whatever the case of kind and name', r.readHero === 'Sprite Hero: 4x2' && r.readHERO === 'Sprite Hero: 4x2', JSON.stringify([r.readHero, r.readHERO]));
      check('tools: the SPRITE parser reads Palette / FRAME, keeps the name Hero; written back as sprite Hero:', r.spr.name === 'Hero' && r.spr.w === 4 && r.spr.frames === 'Idle' && r.spr.pal === '1a1c2c 5fcde4' && !r.spr.errs.length && r.fmt === 'sprite Hero: 4x2', JSON.stringify(r.spr) + ' ' + r.fmt);
      check('tools: the STAGE model reads Map / TILE / LEGEND / SOLID / ROWS / OBJECTS', r.map.name === 'Level1' && r.map.w === 3 && r.map.tile === 8 && r.map.legend === '#Wall! .floor' && r.map.objects === 'HERO,Coin' && !r.map.problems.length, JSON.stringify(r.map));
      check('tools: the CONTROLS model reads Stick LEFT, Buttons a', r.ctl.stick === 'left' && r.ctl.buttons === 'Ajump' && !r.ctl.problems.length, JSON.stringify(r.ctl));
      check('tools: the LOGIC parser reads Thing HERO: Sprite hero, From Map LEVEL1, Speed 2', r.thing.name === 'HERO' && r.thing.items === 'sprite:hero,from:LEVEL1,field:Speed', JSON.stringify(r.thing));
      check('tools: the LOGIC parser reads Rules: Stage Map … / On Hit Hero COIN: Remove … : Add …', r.rules === 'stage:map> hit:Hero/COIN>remove/add', r.rules);
      check('tools: the SOUND / MUSIC parsers read Square / 80MS / ATK / BPM / Steps / SQUARE / Drums', r.snd.wave === 'square' && r.snd.len === 80 && !r.snd.errs && r.mus.bpm === 120 && r.mus.steps === 4 && r.mus.tracks === 'Lead:square,Drums:drums' && !r.mus.errs, JSON.stringify([r.snd, r.mus]));
      check('tools: the whole mixed-case project compiles', !r.compile.length, JSON.stringify(r.compile));
      // writing a block found under another case replaces it (no second block), keeping the file
      const w = await page.evaluate(() => {
        const t = _drawerRead('sprite', 'HERO').replace('"1221"', '"2112"');
        const at = _drawerWrite('sprite', 'hero', t);
        const b = _drawerBlocks('sprite');
        return { n: b.length, name: b[0].name, path: at.path, row: /"2112"\n    "2112"/.test(b[0].text) };
      });
      check('tools: _drawerWrite("sprite", "hero", …) replaces Sprite Hero: in place (one block, the name as written)', w.n === 1 && w.name === 'Hero' && w.path === 'sprites.emit' && w.row, JSON.stringify(w));
      // the Sprite tool opens the block and Save writes it back with the user's name
      const sp = await page.evaluate(async () => {
        _drawerOpen(); const ctx = _drawerTool(_drawerFind('sprite'));
        await new Promise(r => setTimeout(r, 100));
        const sel = document.querySelector('#drawer .spt select'), opts = sel ? [...sel.options].map(o => o.textContent) : [];
        return { opts, title: document.getElementById('drawerTitle').textContent };
      });
      check('tools: the SPRITE tool lists the sprite Hero', sp.opts.some(o => /Hero/.test(o)), JSON.stringify(sp));
      await page.evaluate(() => { try { _drawerClose(); } catch (e) {} });
      // the Script tool runs a script with capital keywords
      const mt = await page.evaluate(() => { const r = _moteToolRun('LOCAL Msg = "hey"\nIF msg THEN PRINT(MSG) END\nRETURN #Msg', 'intro', 5000, { standIns: true }); return { lines: r.lines.map(l => l.k + ':' + l.t), err: r.error }; });
      check('tools: the SCRIPT tool runs Mote with capital keywords and names in any case', !mt.err && mt.lines.join('|') === 'pr:hey|ok:returned 3', JSON.stringify(mt));
      check('tools: no page errors', !page.errors.length, page.errors.join(' | '));
      await page.context().close();
    }
    // ── autocomplete and highlighting ──
    {
      const page = await newPage(browser);
      await page.evaluate(() => _projLoad('import Game.Physics\nexport fn run() { }\n//// file: game/physics.emit\npublic fn step(n: int) { }\npublic let Gravity = 2\n'));
      const ac = await page.evaluate(() => {
        _projSetActive(0);
        const before = 'import Game.Physics\nexport fn run() { PHYSICS.';
        const shown = _projACCheck(before);
        const items = acActive ? acItems.map(i => i._ins || i.name) : [];
        hideAC();
        ed.value = 'FN f() { PrintStr("x") }\nUse three\n';
        hlCode();
        const html = hlInner.innerHTML;
        return { shown, items, kw: /<span class="kw">FN<\/span>/.test(html), blt: /<span class="blt">PrintStr<\/span>/.test(html), use: /<span class="kw">Use<\/span>/.test(html) };
      });
      check('autocomplete: PHYSICS. (alias typed in another case) lists the module members', ac.shown && ac.items.some(i => /^step/.test(i)) && ac.items.includes('Gravity'), JSON.stringify(ac));
      check('highlighting: FN is a keyword, PrintStr a builtin, Use starts a use line (text as written)', ac.kw && ac.blt && ac.use, JSON.stringify(ac));
      await page.context().close();
    }
    // ── the tutorial with a Hero sprite and mixed-case names ──
    {
      const page = await newPage(browser, { viewport: { width: 1200, height: 800 } });
      await page.evaluate(() => { _tut.restart(); });
      await page.waitForTimeout(150);
      await page.evaluate(() => { _tut.go(1); });
      await page.evaluate(() => _tut.doIt());
      await page.waitForFunction(() => !_tut.state.busy, null, { timeout: 8000 });
      const s1 = await page.evaluate(() => _tut.check(1).ok);
      check('tutorial: step 2 (new project) by "Do it for me"', s1);
      // the user makes the blocks by hand, in mixed case
      await page.evaluate(() => {
        _drawerWrite('sprite', 'Hero', _tut.HERO.replace('sprite hero:', 'Sprite Hero:').replace('  palette', '  Palette'));
      });
      const h = await page.evaluate(() => _tut.check(2));
      check('tutorial: step 3 accepts Sprite Hero: (painted)', h.ok && /Hero/.test(h.msg), JSON.stringify(h));
      await page.evaluate(() => _tut.go(3));
      await page.evaluate(() => _tut.doIt());
      await page.waitForFunction(() => !_tut.state.busy, null, { timeout: 8000 });
      const c = await page.evaluate(() => ({ r: _tut.check(3), names: _drawerBlocks('sprite').map(b => b.name) }));
      check('tutorial: step 4 by "Do it for me" next to Sprite Hero (two sprites)', c.r.ok && c.names.join() === 'Hero,coin', JSON.stringify(c));
      await page.evaluate(() => {
        _drawerWrite('sound', 'COIN', 'Sound COIN: Square 988, 80MS, ATK 1, REL 180, VOL 0.4');
        _drawerWrite('map', 'Level1', 'Map Level1: 8x6, TILE 16\n  LEGEND # Wall SOLID #3a3a5c, . Floor #1b1b2a\n  ROWS\n    "########"\n    "#......#"\n    "#......#"\n    "#......#"\n    "#......#"\n    "########"\n  OBJECTS\n    HERO 1,1\n    Coin 4,2\n    COIN 5,4');
        _drawerWrite('controls', 'Pad', 'Controls Pad: Stick LEFT, Buttons a "jump"');
        _drawerWrite('thing', 'Hero', 'Thing HERO: Sprite hero, From Map LEVEL1, Speed 2');
        _drawerWrite('thing', 'Coin', 'Thing Coin: SPRITE COIN, FROM MAP level1');
        _drawerWrite('rules', '', 'Rules:\n  Stage Size 128 96\n  Stage Map LEVEL1\n  Stage Controls PAD\n  Show Score\n  Every Frame: Hero MV StickX() * Hero.Speed, STICKY() * HERO.SPEED\n  On Hit HERO Wall: Block Hero\n  On Hit Hero Coin: Remove COIN : Add SCORE 1 : Play Coin\n  When Count(Coin) == 0: Say "You win!"');
      });
      const st = await page.evaluate(() => [4, 5, 6, 7, 8].map(i => { const r = _tut.check(i); return _tut.steps[i].id + ':' + (r.ok ? 'ok' : r.msg); }));
      check('tutorial: steps sound / level / controls / things / rules accept COIN, Level1, HERO / Coin objects, Pad, Thing HERO, Rules: in capitals', st.every(x => /:ok$/.test(x)), st.join(' | '));
      await page.evaluate(() => _tut.go(9));
      await page.evaluate(() => compileAndRun());
      await page.waitForFunction(() => { try { return _tut.check(9).ok; } catch (e) { return false; } }, null, { timeout: 8000 }).catch(() => {});
      const rn = await page.evaluate(() => ({ r: _tut.check(9), kinds: (_lgMeta && _lgMeta.kinds || []).map(k => k.name) }));
      check('tutorial: step 10 (run): the game runs (kinds HERO / Coin, score shown)', rn.r.ok && rn.kinds.join() === 'HERO,Coin', JSON.stringify(rn));
      await page.evaluate(() => _tut.go(11));
      await page.waitForTimeout(100);
      await page.evaluate(() => _tut.doIt());
      await page.waitForFunction(() => !_tut.state.busy, null, { timeout: 8000 });
      await page.waitForFunction(() => { try { return _tut.check(11).ok; } catch (e) { return false; } }, null, { timeout: 8000 }).catch(() => {});
      const ins = await page.evaluate(() => ({ r: _tut.check(11), t: _drawerRead('thing', 'hero') }));
      check('tutorial: step 12 (inside) by "Do it for me" on Thing HERO: … Speed 2 (the name kept, the speed changed, run again)', ins.r.ok && /^Thing HERO: Sprite hero, From Map LEVEL1, speed [34]$/.test(ins.t), JSON.stringify(ins));
      check('tutorial: no page errors', !page.errors.length, page.errors.join(' | '));
      await page.context().close();
    }
  } finally {
    await browser.close();
  }
  console.log('\n' + passed + '/' + (passed + failed) + ' case-insensitivity checks passed');
  process.exit(failed ? 1 : 0);
})();

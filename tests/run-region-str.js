#!/usr/bin/env node
// Tests for str in memory regions and structs (Emit): reading, writing, every region operation, type errors,
// and above all the collector — a string a region points to must stay, and one it no longer points to must go.
// Runs in headless Chromium, offline.
//
//   node tests/run-region-str.js [path/to/emit-ide.html]
'use strict';
const { chromium } = require('playwright');
const path = require('path');

const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'emit-ide-1_32.html'));
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) pass++;
  else { fail++; console.log(`✗ ${name}${detail !== undefined ? '\n    ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600) : ''}`); }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const BASICS = `
struct Node { tag: str, text: str, parent: int, flag: bool, names: str[2], pos: Vec }
struct Vec { x: num, label: str }
region nodes: Node[8]
region words: str[4]
region other: str[4]
mut count: int = 0

fn add(tag: str, text: str, parent: int) int {
  let i = count
  nodes[i].tag = tag
  nodes[i].text = text
  nodes[i].parent = parent
  count = count + 1
  return i
}
fn longest(r: region str) str {
  mut best: str = ""
  for (let i = 0; i < r.length; i++) {
    if (strLen(r[i]) > strLen(best)) {
      best = r[i]
    }
  }
  return best
}
fn rename(ns: region Node, i: int, to: str) {
  ns[i].text = to
}

export fn run() {
  printStr("[" + nodes[3].text + "]" + strLen(words[0]))
  let root = add("col", "", 0 - 1)
  let a = add("txt", "Hello " + "world", root)
  let b = add("btn", "Item " + 2, root)
  nodes[a].text += "!"
  nodes[b].names[1] = "second"
  nodes[b].pos.label = "inner " + nodes[b].tag
  printStr(nodes[a].tag + ": " + nodes[a].text)
  printStr(nodes[b].tag + ": " + nodes[b].text + " / " + nodes[b].names[1] + "|" + nodes[b].names[0] + "| " + nodes[b].pos.label)
  print(strLen(nodes[a].text))
  if (nodes[a].tag == "txt" && nodes[a].tag != nodes[b].tag) {
    printStr("compares")
  }
  words[0] = "zero"
  fill(words, "same")
  words[2] = nodes[a].text
  printStr(words[0] + " " + words[2] + " " + words[3])
  printStr(longest(words))
  with nodes[a] as n {
    n.text = n.tag + "/" + n.text
    printStr(n.text)
  }
  nodes[b] = nodes[a]
  rename(nodes, a, "renamed")
  printStr(nodes[b].text + " " + nodes[a].text)
  copy(words, other)
  swap(words, other)
  wipe(words)
  printStr("[" + words[1] + "] " + other[2])
  freeze(other)
  try {
    other[0] = "no"
  } catch (e) {
    printStr("frozen: " + other[0])
  }
  let v = view(other)
  printStr("view length " + v.length)
  console.log(nodes[b].text)
  printStr(JSON.stringify(nodes[a].text) + " " + nodes[a].text.length)
  nodes[a].text = document.title
  printStr("from js: " + nodes[a].text)
}`;

// The collector. Each call of step builds text that nobody keeps, and replaces some of what the regions keep.
// Its three steps are named frame, ontimer_1 and onclick_1: those are the exported functions Run does not call by itself.
const GC = `
struct Item { name: str, n: int, tags: str[2] }
region items: Item[64]
region labels: str[16]
mut frames: int = 0
mut lost: int = 0

export fn run() {
  for (let i = 0; i < 64; i++) {
    items[i].name = "item number " + i
    items[i].tags[1] = "tag of " + i
  }
  for (let i = 0; i < 16; i++) {
    labels[i] = "label " + i
  }
}
export fn frame() {
  frames = frames + 1
  for (let k = 0; k < 400; k++) {
    let junk = "junk that nobody keeps " + frames + " " + k
    if (strLen(junk) < 5) {
      lost = lost + 1
    }
  }
  let slot = frames % 64
  items[slot].name = "item number " + slot + " as of frame " + frames
  labels[frames % 16] = "label " + (frames % 16) + " v" + frames
}
export fn ontimer_1() {
  mut bad = 0
  for (let i = 0; i < 64; i++) {
    if (substr(items[i].name, 0, 12) != "item number ") {
      bad = bad + 1
    }
    if (items[i].tags[1] != "tag of " + i) {
      bad = bad + 1
    }
    if (items[i].tags[0] != "") {
      bad = bad + 1
    }
  }
  for (let i = 0; i < 16; i++) {
    if (substr(labels[i], 0, 6) != "label ") {
      bad = bad + 1
    }
  }
  printStr("bad " + bad)
}
export fn onclick_1() {
  wipe(labels)
  for (let i = 0; i < 64; i++) {
    items[i].name = ""
    items[i].tags[1] = ""
  }
}`;

const DIAGS = [
  ['an int stored in a str field', 'struct A { s: str }\nregion items: A[2]\nexport fn run() {\n  items[0].s = 5\n}', /^4:\d+: Cannot store an int in items\[0\]\.s \(str\) — it holds text: make it text first, e\.g\. intToStr\(x\) or "" \+ x/],
  ['a num stored in a str region', 'region w: str[2]\nexport fn run() {\n  w[0] = 1.5\n}', /^3:\d+: Cannot store a num in w\[0\] \(str\) — it holds text: make it text first, e\.g\. numToStr/],
  ['a str stored in an int field', 'struct A { n: int }\nregion items: A[2]\nexport fn run() {\n  items[0].n = "x"\n}', /^4:\d+: Cannot store a str in items\[0\]\.n \(int\) — it holds whole numbers/],
  ['fill with the wrong type', 'region w: str[2]\nexport fn run() {\n  fill(w, 3)\n}', /^3:\d+: Cannot store an int in w \(str\) — it holds text/],
  ['arr is still refused', 'struct A { s: arr }\nexport fn run() {}', /^1:\d+: A struct field cannot be arr — regions and structs hold numbers, true \/ false and str\./],
  ['js is still refused', 'region r: js[4]\nexport fn run() {}', /^1:\d+: A region element cannot be js — /],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [], consoleLines = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'log') consoleLines.push(m.text()); });
  await page.route(/^(https?|wss?):/, r => r.abort());
  await page.goto('file://' + file);
  await page.waitForFunction(() => typeof compileAndRun === 'function');
  await page.evaluate(() => { if (typeof closeWelcome === 'function') closeWelcome(); document.title = 'Emit title'; });
  const run = async src => {
    await page.evaluate(src => { const ed = document.getElementById('editor') || document.querySelector('textarea'); ed.value = src; ed.dispatchEvent(new Event('input')); }, src);
    await page.evaluate(() => compileAndRun());
    await page.waitForTimeout(150);
  };
  const lines = () => page.evaluate(() => document.getElementById('tab-output').innerText.split('\n').map(s => s.trim()).filter(s => /^>( |$)/.test(s)).map(s => s.slice(2)));
  const reds = () => page.evaluate(() => document.getElementById('tab-output').innerText.split('\n').filter(s => s.includes('✗')));

  // ───────────── reading, writing, every operation ─────────────
  await run(BASICS);
  eq('basics: fields, arrays of str in a struct, structs in structs, +=, ==, fill, parameters, with, struct copy, copy / swap / wipe, freeze, view, to and from JS', await lines(), [
    '[]0', 'txt: Hello world!', 'btn: Item 2 / second|| inner btn', '12', 'compares', 'same Hello world! same', 'Hello world!',
    'txt/Hello world!', 'txt/Hello world! renamed', '[] Hello world!', 'frozen: same', 'view length 4', '"renamed" 7', 'from js: Emit title']);
  eq('basics: no error lines', await reds(), []);
  ok('basics: a str passed to a JS function arrives as the text', consoleLines.includes('txt/Hello world!'), consoleLines);

  // layout and what the Memory panel sees
  const meta = await page.evaluate(() => { const R = _emitRegions(); const n = R.find(r => r.name === 'nodes'), w = R.find(r => r.name === 'words'); return { node: [n.elemSize, n.elem.fields.map(f => f.name + ':' + f.type + '@' + f.offset + (f.count ? 'x' + f.count : ''))], words: [w.elem, w.elemSize, w.length] }; });
  eq('layout: a str is 4 bytes at 4-byte alignment', meta, { node: [48, ['tag:str@0', 'text:str@4', 'parent:int@8', 'flag:bool@16', 'names:str@20x2', 'pos.x:num@32', 'pos.label:str@40']], words: ['str', 4, 4] });
  const ids = await page.evaluate(() => { const R = _emitRegions(); return [R.find(r => r.name === 'nodes').id, R.find(r => r.name === 'other').id]; });
  eq('panel: reads the text of a str cell', await page.evaluate(([n, o]) => [_emitRegionRead(n, 0, 'text'), _emitRegionRead(n, 1, 'tag'), _emitRegionRead(n, 2, 'text'), _emitRegionRead(o, 2), _emitRegionRead(n, 7, 'text'), _emitRegionRead(n, 7, 'names[1]')], ids), ['', 'txt', 'txt/Hello world!', 'Hello world!', '', '']);
  eq('panel: shows it quoted, and takes text typed with or without quotes', await page.evaluate(() => [_memFmt('a "b"', 'str'), _memParse('plain  text ', 'str').v, _memParse(' "quoted \\"x\\"" ', 'str').v]), ['"a \\"b\\""', 'plain  text ', 'quoted "x"']);
  eq('panel: a write puts new text in the cell', await page.evaluate(([n]) => [_emitRegionWrite(n, 5, 'text', 'poked in'), _emitRegionRead(n, 5, 'text'), _emitRegionWrite(n, 5, 'names[1]', 'in an array'), _emitRegionWrite(n, 5, 'pos.label', 'in a struct'), _emitRegionRead(n, 5, 'names[1]') + '/' + _emitRegionRead(n, 5, 'pos.label'), _emitRegionWrite(n, 5, 'nope', 'x')], ids), [true, 'poked in', true, true, 'in an array/in a struct', false]);

  // ───────────── type errors ─────────────
  for (const [name, src, want] of DIAGS) {
    const msg = await page.evaluate(src => { try { const r = compile(src); return r.errors.length ? String(r.errors[0].message || r.errors[0]) : 'compiled'; } catch (e) { return e.message; } }, src);
    ok('error: ' + name, want.test(msg), msg);
  }

  // ───────────── the collector ─────────────
  await run(GC);
  const call = name => page.evaluate(name => { _emitCallExport(window._wi, { step: 'frame', check: 'ontimer_1', drop: 'onclick_1' }[name], [], true); }, name);
  const check = async () => { await call('check'); const all = await lines(); return Number(all[all.length - 1].replace('bad ', '')); };
  const stats = () => page.evaluate(() => { const s = _memStats(); return { live: s.strLive !== undefined ? s.strLive : s.strings, blocks: _strBlocks.size, runs: _gcRuns, refs: _rgRefs.map(r => r.R.name + ':' + r.offs.join(',')) }; });
  const start = await stats();
  eq('collector: knows where the regions keep text', start.refs, ['items:0,16,20', 'labels:0']);
  let worst = 0, bad = 0;
  for (let f = 0; f < 3000; f++) { await call('step'); if (f % 250 === 249) { bad += await check(); worst = Math.max(worst, (await stats()).blocks); } }
  const after = await stats();
  eq('collector: after 3,000 calls that each make 400 throwaway strings, every string a region points to is intact', bad, 0);
  ok('collector: it ran many times in between', after.runs - start.runs > 20, [start.runs, after.runs]);
  ok('collector: the throwaway strings were released (1,200,000 made; a few thousand blocks at most at any time)', worst < 20000 && after.blocks < 20000, { worst, after: after.blocks });
  // the kept strings are exactly the ones still pointed to: 64 names + 64 tags + 16 labels, plus literals are not blocks
  await page.evaluate(() => { _gcCollect(null); });
  const settled = await stats();
  ok('collector: after a full collection, what is left is what the regions point to', settled.blocks >= 144 && settled.blocks <= 160, settled);
  await call('drop'); await page.evaluate(() => { _gcCollect(null); });
  const dropped = await stats();
  ok('collector: text a region stops pointing to is released', dropped.blocks < 16, dropped);
  eq('collector: and the regions read as empty text', await check(), 144);
  // a string poked in from the panel is a root too
  const lab = await page.evaluate(() => _emitRegions().find(r => r.name === 'labels').id);
  await page.evaluate(id => { _emitRegionWrite(id, 3, undefined, 'kept by the panel'); }, lab);
  for (let f = 0; f < 300; f++) await call('step');
  await page.evaluate(() => { _gcCollect(null); });
  ok('collector: text written from the Memory panel stays until it is replaced', (await page.evaluate(id => _emitRegionRead(id, 3), lab)).startsWith('label 3 v') || (await page.evaluate(id => _emitRegionRead(id, 3), lab)) === 'kept by the panel');
  eq('collector: no error lines', await reds(), []);

  // a program without str in its regions is compiled exactly as before
  const same = await page.evaluate(() => { const r = compile('struct B { x: num, n: int }\nregion bs: B[4]\nexport fn run() {\n  bs[1].x = 2.5\n  print(bs[1].n)\n}'); return [r.wasm.length, JSON.parse(r.imports.regionMeta).regions[0].elem.fields.map(f => f.type)]; });
  eq('a program without str in its regions is unchanged', same[1], ['num', 'int']);
  const rt = await page.evaluate(() => { try { return _exportRuntime(); } catch (e) { return 'ERR ' + e.message; } });
  ok('export: the runtime that exported pages get looks into regions too', !rt.startsWith('ERR') && rt.includes('_rgRefs') && rt.includes("str:Uint32Array"), rt.slice(0, 200));
  eq('no page errors', errors, []);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
// Byte identity: programs without sound / music (or other drawer) blocks must compile exactly as before.
// Compiles every bundled example (EX of the base build) and every program of tests/run-interop.js with a base
// build and with this build, and compares the WASM bytes, the import list, the extra import properties and the
// errors. The base build is taken from git (default commit 8d7f2b4, the commit the drawer work started from).
//
//   node tests/run-bytes.js [path/to/emit-ide.html] [base-commit]
//
// Exit code 0 when every program is identical.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

(async () => {
  const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'emit-ide-1_32.html'));
  const ref = process.argv[3] || '8d7f2b4';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'emit-bytes-'));
  const baseFile = path.join(tmp, 'base.html');
  fs.writeFileSync(baseFile, execFileSync('git', ['show', ref + ':emit-ide-1_32.html'], { cwd: path.join(__dirname, '..'), maxBuffer: 64 << 20 }));
  const src = fs.readFileSync(path.join(__dirname, 'run-interop.js'), 'utf8').split('\n');
  const a = src.findIndex(l => /^const TESTS = \[/.test(l)), b = src.findIndex((l, i) => i > a && /^\];/.test(l));
  const TESTS = eval('(' + src.slice(a, b + 1).join('\n').replace(/^const TESTS = /, '').replace(/;\s*$/, '') + ')');
  const browser = await chromium.launch();
  async function load(f) { const p = await browser.newPage(); await p.route(/^https?:/, r => r.abort()); await p.goto('file://' + f); await p.waitForFunction(() => typeof compileAndRun === 'function'); return p; }
  const base = await load(baseFile), cur = await load(file);
  const progs = [];
  for (const n of await base.evaluate(() => Object.keys(EX))) progs.push(['EX.' + n, await base.evaluate(n => EX[n], n)]);
  TESTS.forEach(t => progs.push(['interop.' + t.name, t.src]));
  const comp = (p, list) => p.evaluate(list => list.map(([n, s]) => { try { const r = compile(s, 'wasm32'); const props = {}; Object.keys(r.imports).forEach(k => { if (!/^\d+$/.test(k)) props[k] = r.imports[k]; }); return { n, w: Array.from(r.wasm).join(','), i: JSON.stringify(r.imports.map(x => x.module + '.' + x.name)), p: JSON.stringify(props), e: JSON.stringify(r.errors) }; } catch (e) { return { n, t: e.message }; } }), list);
  const A = await comp(base, progs), B = await comp(cur, progs);
  // A program that did not compile with the base build (it threw, e.g. a non-literal top-level initialiser before
  // rough-edges) cannot be byte-identical; it is listed as NEW and not counted as a difference.
  let same = 0, fresh = 0;
  A.forEach((x, i) => { if (JSON.stringify(x) === JSON.stringify(B[i])) same++; else if (x.t !== undefined && B[i].t === undefined) { fresh++; console.log('NEW   ' + x.n + ' (the base build did not compile it: ' + x.t.slice(0, 80) + ')'); } else console.log('DIFF  ' + x.n); });
  await browser.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + same + '/' + (A.length - fresh) + ' programs compile byte-identically to ' + ref + ' (wasm, imports, import props, errors)' + (fresh ? '; ' + fresh + ' did not compile with ' + ref : ''));
  process.exit(same === A.length - fresh ? 0 : 1);
})();

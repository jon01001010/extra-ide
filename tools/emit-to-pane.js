#!/usr/bin/env node
// Turns an Emit program into a Pane page that runs it as an app.
//
//   node tools/emit-to-pane.js program.emit [page.pane] [--title Title]
//
// The program is compiled by the compiler inside emit-ide-1_32.html (opened headless with Playwright; nothing
// is fetched), and the WebAssembly is put into the page as a data: address. Before that, its imports are
// checked against what apps in Pane may use (Pane.APP_IMPORTS in pane.js): drawing, keys and pointer, numbers,
// text and arrays of numbers. A program that needs anything else — JS interop, `use` libraries, the DOM,
// storage, the network, sound, regions — is refused here with the list, as Pane itself would refuse it.
'use strict';
const fs = require('fs');
const path = require('path');
const Pane = require('../pane.js');

const IDE = path.join(__dirname, '..', 'emit-ide-1_32.html');

/** Compile Emit source in an open IDE page. → { wasm: Buffer, errors: [text], imports: ['module.name'], refused: [...] } */
async function compileEmit(idePage, source) {
  const r = await idePage.evaluate(src => {
    try {
      const out = compile(src);
      return { bytes: Array.from(out.wasm), errors: out.errors.map(e => (e.loc ? e.loc.line + ':' + e.loc.col + ': ' : '') + (e.message || e.msg || String(e))), imports: out.imports.map(i => i.module + '.' + i.name) };
    } catch (e) { return { bytes: [], errors: [String(e && e.message || e)], imports: [] }; }
  }, source);
  const allowed = new Set(Pane.APP_IMPORTS);
  return { wasm: Buffer.from(r.bytes), errors: r.errors, imports: r.imports, refused: r.imports.filter(i => !allowed.has(i)) };
}
async function openIde(browser) {
  const page = await browser.newPage();
  await page.route(/^(https?|wss?):/, r => r.abort());
  await page.goto('file://' + IDE);
  await page.waitForFunction(() => typeof compile === 'function');
  return page;
}
/** The page text for a compiled program. */
function paneFor(title, wasm, from) {
  const clean = String(title).replace(/[\r\n{}]+/g, ' ').trim() || 'App';
  return ['title ' + clean,
    'rem Made' + (from ? ' from ' + from : '') + ' by tools/emit-to-pane.js. The program runs in a worker of its own: it can draw, read keys',
    'rem and the pointer, and compute; it cannot reach the page, storage or the network.',
    'align center', 'col', '  w 100%', '  maxw 680', '  pad 16', '  gap 10', '  fnt 22', '  fg 235 240 255', '  txt ' + clean,
    '  app data:application/wasm;base64,' + wasm.toString('base64'),
    '  fnt 13', '  fg 150 170 200', '  txt Click the picture to give it the keys. Esc gives them back.',
    '  fnt 14', '  lnk Back to the start page home', 'end', ''].join('\n');
}
module.exports = { compileEmit, openIde, paneFor };

if (require.main === module) (async () => {
  const args = process.argv.slice(2), at = args.indexOf('--title');
  const title = at >= 0 ? args.splice(at, 2)[1] : null;
  if (!args[0]) { console.error('usage: node tools/emit-to-pane.js program.emit [page.pane] [--title Title]'); process.exit(2); }
  const src = fs.readFileSync(args[0], 'utf8'), outPath = args[1] || args[0].replace(/\.emit$/, '') + '.pane';
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const r = await compileEmit(await openIde(browser), src);
    if (r.errors.length) { console.error(args[0] + ' does not compile:\n  ' + r.errors.join('\n  ')); process.exit(1); }
    if (r.refused.length) {
      console.error(args[0] + ' uses what apps in Pane do not have:\n  ' + r.refused.map(i => i.replace(/^std\./, '')).join(', ') +
        '\nApps can draw, read keys and the pointer, compute, and use text and arrays of numbers.');
      process.exit(1);
    }
    fs.writeFileSync(outPath, paneFor(title || path.basename(args[0], '.emit'), r.wasm, path.relative(path.join(__dirname, '..'), path.resolve(args[0]))));
    console.log(`${outPath}: ${r.wasm.length} bytes of WebAssembly, ${r.imports.length} imports, all allowed`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });

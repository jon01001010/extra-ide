#!/usr/bin/env node
// Copies mote.js (the source of truth) into the pages that carry it, between their MOTE:BEGIN / MOTE:END markers:
//   mote.html            the playground — an executing <script> (defines window.Mote when the page opens)
//   emit-ide-1_32.html   the Emit IDE — a NON-executing <script type="text/plain" id="mote-src"> that `use mote`
//                        runs on demand (once, as a classic script from a Blob URL; see _libBuiltinText in the IDE)
//   pane.html            the Pane browser — an executing <script>; page scripts run in Mote VMs
// Everything else in those pages is edited by hand.
//
//   node tools/build-mote-html.js           rebuild the pages
//   node tools/build-mote-html.js --check   exit 1 when a page does not contain the current mote.js
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'mote.js'), 'utf8');
// "</script" would end the script element early; "<\/script" means the same inside JS strings, comments and
// regexps. "<!--" could switch the HTML parser into its "escaped" script state; "<\!--" means the same in JS.
const body = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

const PAGES = [
  { file: 'mote.html', open: '<script>\n' },
  { file: 'emit-ide-1_32.html', open: '<script type="text/plain" id="mote-src" data-emit-builtin="emit:mote">\n' },
  { file: 'pane.html', open: '<script>\n' },
];
const BEGIN = /<!-- MOTE:BEGIN[^\n]*-->\n/, END = '<!-- MOTE:END -->';
const check = process.argv.includes('--check');
let stale = 0;
for (const p of PAGES) {
  const htmlPath = path.join(root, p.file);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const b = BEGIN.exec(html), e = html.indexOf(END);
  if (!b || e < b.index) { console.error(p.file + ': MOTE:BEGIN / MOTE:END markers not found'); process.exit(2); }
  const out = html.slice(0, b.index + b[0].length) + p.open + body + '</script>\n' + html.slice(e);
  if (check) {
    if (out !== html) { console.error(p.file + ' is out of date: run node tools/build-mote-html.js'); stale++; }
    else console.log(p.file + ' is up to date');
  } else {
    if (out !== html) fs.writeFileSync(htmlPath, out);
    console.log(`${p.file}: mote.js (${js.length} bytes) ${out === html ? 'already current' : 'inlined'}, page ${out.length} bytes`);
  }
}
if (stale) process.exit(1);

#!/usr/bin/env node
// Inlines mote.js (the source of truth) into mote.html between the MOTE:BEGIN / MOTE:END markers,
// so the playground is one self-contained file. Everything else in mote.html is edited by hand.
//
//   node tools/build-mote-html.js           rebuild mote.html
//   node tools/build-mote-html.js --check   exit 1 when mote.html does not contain the current mote.js
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const htmlPath = path.join(root, 'mote.html');
const js = fs.readFileSync(path.join(root, 'mote.js'), 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');

const BEGIN = /<!-- MOTE:BEGIN[^\n]*-->\n/, END = '<!-- MOTE:END -->';
const b = BEGIN.exec(html), e = html.indexOf(END);
if (!b || e < b.index) { console.error('mote.html: MOTE:BEGIN / MOTE:END markers not found'); process.exit(2); }
// "</script" would end the inline script early; "<\/script" means the same inside JS strings, comments and regexps.
const inline = '<script>\n' + js.replace(/<\/script/gi, '<\\/script') + '</script>\n';
const out = html.slice(0, b.index + b[0].length) + inline + html.slice(e);

if (process.argv.includes('--check')) {
  if (out !== html) { console.error('mote.html is out of date: run node tools/build-mote-html.js'); process.exit(1); }
  console.log('mote.html is up to date');
} else {
  fs.writeFileSync(htmlPath, out);
  console.log(`mote.html: inlined mote.js (${js.length} bytes), page ${out.length} bytes`);
}

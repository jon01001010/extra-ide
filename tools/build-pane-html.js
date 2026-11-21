#!/usr/bin/env node
// Copies the Pane engine and the sample pages into pane.html, the browser shell, so that it stays one file
// that works offline:
//   pane.js          (the source of truth) → an executing <script> between PANE:BEGIN / PANE:END
//   pages/*.pane     → one <script type="text/plain" data-page="name"> each, between PAGES:BEGIN / PAGES:END
// Everything else in pane.html is edited by hand.
//
//   node tools/build-pane-html.js           rebuild pane.html
//   node tools/build-pane-html.js --check   exit 1 when pane.html is not current
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const htmlPath = path.join(root, 'pane.html');
const js = fs.readFileSync(path.join(root, 'pane.js'), 'utf8');
// "</script" would end the script element early; "<\/script" means the same inside JS strings, comments and
// regexps. "<!--" could switch the HTML parser into its "escaped" script state; "<\!--" means the same in JS.
const engine = '<script>\n' + js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--') + '</script>\n';

const dir = path.join(root, 'pages');
let pages = '';
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.pane')).sort()) {
  const name = f.slice(0, -5), text = fs.readFileSync(path.join(dir, f), 'utf8');
  if (!/^[a-z0-9-]+$/.test(name)) { console.error(f + ': page names are lower-case letters, digits and -'); process.exit(2); }
  // page text sits in a non-executing script element as it is; these two would end it or change how it is read
  if (/<\/script|<!--/i.test(text)) { console.error(f + ': a built-in page cannot contain </script or <!--'); process.exit(2); }
  pages += `<script type="text/plain" data-page="${name}">\n${text}</script>\n`;
}

function between(html, name, body) {
  const begin = new RegExp('<!-- ' + name + ':BEGIN[^\\n]*-->\\n').exec(html), end = html.indexOf('<!-- ' + name + ':END -->');
  if (!begin || end < begin.index) { console.error(`pane.html: ${name}:BEGIN / ${name}:END markers not found`); process.exit(2); }
  return html.slice(0, begin.index + begin[0].length) + body + html.slice(end);
}
const html = fs.readFileSync(htmlPath, 'utf8');
const out = between(between(html, 'PANE', engine), 'PAGES', pages);
if (process.argv.includes('--check')) {
  if (out !== html) { console.error('pane.html is out of date: run node tools/build-pane-html.js'); process.exit(1); }
  console.log('pane.html is up to date');
} else {
  if (out !== html) fs.writeFileSync(htmlPath, out);
  console.log(`pane.html: pane.js (${js.length} bytes) and ${pages.split('data-page=').length - 1} pages ${out === html ? 'already current' : 'inlined'}, page ${out.length} bytes`);
}

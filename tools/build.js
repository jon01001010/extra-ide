#!/usr/bin/env node
// Builds emit-ide-1_32.html, the single self-contained page of the Emit IDE, from the files in src/.
//
//   node tools/build.js           write emit-ide-1_32.html, then run tools/build-mote-html.js (mote.html too)
//   node tools/build.js --check   exit 1 when emit-ide-1_32.html (or a Mote page) differs from a fresh build
//
// src/index.html is the page itself. A line that is exactly
//     <!--#include file="path/inside/src" -->
// is replaced by that file's text, unchanged (the file ends with a newline, which stands for the directive's
// own). Includes are not nested. A line that is exactly <!--#note ... --> is a note for whoever edits
// src/index.html and is left out of the page. Everything else in index.html is copied as it is. Between the page's
// MOTE:BEGIN / MOTE:END markers the build puts mote.js, in the same way tools/build-mote-html.js does (that
// tool owns the Mote embed; see there). No dependencies: plain Node.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const mote = require('./build-mote-html.js');

const root = path.join(__dirname, '..');
const SRC = path.join(root, 'src');
const OUT = path.join(root, 'emit-ide-1_32.html');
const INCLUDE = /^<!--#include file="([^"]+)" -->$/;
const NOTE = /^<!--#note .* -->$/;

function build() {
  const index = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  const lines = index.split('\n');
  let out = '', inScript = false;
  lines.forEach((line, i) => {
    const last = i === lines.length - 1;
    if (NOTE.test(line)) return;
    const m = INCLUDE.exec(line);
    if (!m) {
      if (/^<script\b[^>]*>$/i.test(line)) inScript = true;
      else if (/^<\/script>/i.test(line)) inScript = false;
      out += line + (last ? '' : '\n');
      return;
    }
    const file = path.join(SRC, m[1]);
    if (path.relative(SRC, file).startsWith('..')) throw new Error('index.html:' + (i + 1) + ': ' + m[1] + ' is outside src/');
    const text = fs.readFileSync(file, 'utf8');
    if (text !== '' && !text.endsWith('\n')) throw new Error(m[1] + ' must end with a newline');
    // "</script" in JS text would end the inline script element early (write "<\/script" instead)
    if (inScript && /<\/script/i.test(text)) throw new Error(m[1] + ' contains "</script": write "<\\/script" instead');
    if (last) throw new Error('index.html must end with a newline after the last include');
    out += text;
  });
  return mote.inline(out, mote.PAGES.find(p => p.file === 'emit-ide-1_32.html').open, 'src/index.html');
}

const check = process.argv.includes('--check');
const html = build();
const moteArgs = [path.join(__dirname, 'build-mote-html.js')].concat(check ? ['--check'] : []);
if (check) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  let bad = 0;
  if (cur !== html) { console.error('emit-ide-1_32.html is out of date with src/: run node tools/build.js'); bad = 1; }
  else console.log('emit-ide-1_32.html is up to date with src/');
  try { process.stdout.write(execFileSync(process.execPath, moteArgs, { encoding: 'utf8' })); }
  catch (e) { process.stderr.write(String(e.stdout || '') + String(e.stderr || '')); bad = 1; }
  process.exit(bad);
} else {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  if (cur !== html) fs.writeFileSync(OUT, html);
  console.log('emit-ide-1_32.html: ' + (cur === html ? 'already current' : 'written') + ', ' + Buffer.byteLength(html) + ' bytes');
  // keeps mote.html in step with mote.js as well (the IDE page already is)
  process.stdout.write(execFileSync(process.execPath, moteArgs, { encoding: 'utf8' }));
}

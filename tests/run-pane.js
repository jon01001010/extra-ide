#!/usr/bin/env node
// Node tests for the Pane engine (pane.js): the parser, expressions and statements, and layout.
// Layout runs here with a fixed-width measure (every character is 0.6 × the font size wide), so the numbers
// are the same on every machine. Each sample page in pages/ is laid out at three widths, checked against
// rules that must always hold (nothing overlaps, nothing sticks out sideways, every text line fits), and
// compared with the stored picture in tests/pane-layout.snap.json.
//
//   node tests/run-pane.js             run
//   node tests/run-pane.js --update    rewrite the stored layout pictures from the current engine
'use strict';
const fs = require('fs');
const path = require('path');
const Pane = require('../pane.js');

const update = process.argv.includes('--update');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) pass++;
  else { fail++; console.log(`✗ ${name}${detail !== undefined ? '\n    ' + String(detail).slice(0, 600) : ''}`); }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const measure = (text, px) => text.length * px * 0.6;
function lay(src, w, h, st) {
  const page = Pane.parse(src);
  st = st || Pane.newState();
  Pane.runStatements(page, st, 'load', {});
  Pane.layout(page, w, h || 640, { measure, state: st });
  return { page, st, relayout: (w2, h2) => Pane.layout(page, w2 || w, h2 || h || 640, { measure, state: st }) };
}
const find = (page, pred) => { let hit = null; (function walk(n) { if (!hit && pred(n)) hit = n; if (n.children) n.children.forEach(walk); })(page.root); return hit; };
const all = (page, pred) => { const out = []; (function walk(n) { if (pred(n)) out.push(n); if (n.children) n.children.forEach(walk); })(page.root); return out; };

// ───────────────────────────── parser ─────────────────────────────
{
  const p = Pane.parse('col\n  pad 8\n  txt Hello there\n  row\n    btn Save now 3\n    btn Go\n  end\n  lnk Read the article article.pane\nend');
  const col = p.root.children[0];
  eq('parse: tree shape', [col.type, col.children.map(c => c.type)], ['col', ['txt', 'row', 'lnk']]);
  eq('parse: pad is a property of the open container', col.props.pad, 8);
  eq('parse: btn label and id', [col.children[1].children[0].label, col.children[1].children[0].id], ['Save now', 3]);
  eq('parse: btn without an id', [col.children[1].children[1].label, col.children[1].children[1].id], ['Go', 0]);
  eq('parse: lnk text and address', [col.children[2].text, col.children[2].url], ['Read the article', 'article.pane']);
  eq('parse: no warnings', p.warnings, []);
}
{
  const p = Pane.parse('row\ncol\ntxt deep\nwibble 3\nend\nend\nend\nrem a comment\ntitle  My page ');
  eq('parse: unknown word and stray end are reported with their lines', p.warnings.map(w => w.line), [4, 7]);
  eq('parse: title', p.title, 'My page');
  eq('parse: containers left open are closed', Pane.parse('col\nrow\ntxt a').root.children[0].children[0].children[0].text, 'a');
}
{
  const p = Pane.parse('fg 1 2 3\nfnt 20\ncol\n  txt a\n  fnt 12\n  fg 9 9 999\n  txt b\nend');
  const [a, b] = p.root.children[0].children;
  eq('parse: a child takes colour and size as they are when it is made', [a.props.fnt, a.props.fg, b.props.fnt, b.props.fg], [20, [1, 2, 3], 12, [9, 9, 255]]);
  const q = Pane.parse('box 120\nend\nbox 25%\nw 50%\nminw 10\nmaxh 300\ngrow 2\nalign center\njust between\nend\nbox huge\nw wide\nalign sideways\nend');
  const [b1, b2, b3] = q.root.children;
  eq('parse: sizes', [b1.props.size, b2.props.size, b2.props.w, b2.props.minw, b2.props.maxh, b2.props.grow, b2.props.align, b2.props.just],
    [120, { pct: 25 }, { pct: 50 }, 10, 300, 2, 'center', 'between']);
  eq('parse: bad sizes are dropped and reported', [b3.props.size, b3.props.w, b3.props.align, q.warnings.length], [null, undefined, undefined, 2]);
  const f = Pane.parse('font open sans\nfont <script>\ntxt x');
  eq('parse: font names', [f.fonts, f.warnings.length], [['Open Sans'], 1]);
  eq('parse: statements are kept apart from the tree', Pane.parse('set a 1\nIF a=1 do set b 2\ntxt x').stmts.map(s => s.line), [1, 2]);
}

// ───────────────────────────── expressions ─────────────────────────────
{
  const st = Pane.newState();
  Object.assign(st.vars, { a: 5, b: 2, name: 'Ada', rat3: 4 });
  st.inputs[1] = '12.5'; st.inputs[2] = 'hi'; st.taps[7] = true; st.chks[1] = true; st.togs[2] = true; st.sels[1] = 2; st.slds[1] = 3.5;
  const E = s => Pane.evalExpr(s, st);
  eq('expr: precedence', [E('1+2*3'), E('(1+2)*3'), E('10-4-3'), E('2*3+4*5'), E('8/2/2'), E('-a+1'), E('a*-b')], [7, 9, 3, 26, 2, -4, -10]);
  eq('expr: division by zero is 0', E('5/0'), 0);
  eq('expr: variables ignore case, unknown ones are 0', [E('A+B'), E('nope+1')], [7, 1]);
  eq('expr: comparisons', [E('a=5'), E('a==5'), E('a<>5'), E('a!=4'), E('a<b'), E('a>b'), E('a>=5'), E('a<=4')], [1, 1, 0, 1, 0, 1, 1, 0]);
  eq('expr: and, or, not', [E('a=5 and b=2'), E('a=5 and b=3'), E('a=1 or b=2'), E('not a=1'), E('not a=5 or b=2'), E('not (a=5 or b=2)'), E('a=1 or b=9 or 1'), E('A=5 AND B=2')], [1, 0, 1, 1, 1, 0, 1, 1]);
  eq('expr: widget values', [E('val 1'), E('val 2'), E('str 2'), E('tap 7'), E('tap 8'), E('chk 1'), E('tog 2'), E('sel 1'), E('sld 1'), E('rat 3'), E('val 9')],
    [12.5, 'hi', 'hi', 1, 0, 1, 1, 2, 3.5, 4, 0]);
  eq('expr: Tiny forms still work', [E('tap 7=1'), E('tap 7=1 and a=5'), E('a*10+1')], [1, 1, 51]);
  eq('expr: strings', [E('"x"'), E('name="Ada"'), E('name="ada"'), E('val 2="hi"'), E('"Hello, "+name'), E('"n="+a'), E('name<>"Bob"')], ['x', 1, 0, 1, 'Hello, Ada', 'n=5', 1]);
  eq('expr: malformed is 0', [E('1+'), E('(1'), E('1 2'), E('@'), E(''), E('a=')], [0, 0, 0, 0, 0, 0]);
  eq('display: variable names and {expr}', [Pane.display('a', st), Pane.display('A', st), Pane.display('a is {a}, half is {a/2}', st), Pane.display('{name} has {b*1.1}', st), Pane.display('plain', st), Pane.display('{1/3}', st)],
    ['5', '5', 'a is 5, half is 2.5', 'Ada has 2.2', 'plain', '0.333333']);
}

// ───────────────────────────── statements ─────────────────────────────
{
  const page = Pane.parse(fs.readFileSync(path.join(__dirname, '..', 'pages', 'calculator.pane'), 'utf8'));
  const st = Pane.newState();
  Pane.runStatements(page, st, 'load', {});
  const tap = id => { st.taps[id] = true; Pane.runStatements(page, st, 'event', {}); st.taps = Object.create(null); };
  const keys = { '0': 10, '+': 11, '-': 12, '*': 13, '/': 14, '=': 15, C: 16 };
  const type = s => { for (const ch of s) tap(keys[ch] || Number(ch)); return st.vars.display; };
  eq('calculator: starts at 0', st.vars.display, 0);
  eq('calculator: 12+30=', type('12+30='), 42);
  eq('calculator: continues from the result', type('*2='), 84);
  eq('calculator: 7-9=', type('C7-9='), -2);
  eq('calculator: 9/4=', type('9/4='), 2.25);
  eq('calculator: C clears', type('C'), 0);
  eq('calculator: 105', type('105'), 105);
}
{
  const calls = [];
  const host = { navigate: u => calls.push(['go', u]), web: (u, n) => calls.push(['web', u, n]), sound: u => calls.push(['snd', u]) };
  const page = Pane.parse('set n 1\nset greeting = "hi"\nif tap 1=1 do set n n+1:web https://example.org/api?x=1 Price:go next:snd beep.mp3\nif tap 2=1 then set n 0\nif n>5 do set big 1');
  const st = Pane.newState();
  Pane.runStatements(page, st, 'load', host);
  eq('statements: set runs at load, if does not', [st.vars.n, st.vars.greeting, calls.length], [1, 'hi', 0]);
  st.taps[1] = true; Pane.runStatements(page, st, 'event', host);
  eq('statements: actions run in order, and "://" does not split an action', calls, [['web', 'https://example.org/api?x=1', 'price'], ['go', 'next'], ['snd', 'beep.mp3']]);
  eq('statements: set at load does not run again on events', st.vars.n, 2);
  st.taps = { 2: true }; Pane.runStatements(page, st, 'event', host);
  eq('statements: then works like do', st.vars.n, 0);
}

// ───────────────────────────── layout: single rules ─────────────────────────────
{
  // 0.6 × 10 px = 6 px per character; a txt is its text + 4 wide and one line is 14 tall, further lines 13 each
  const long = 'aaaa bbbb cccc dddd eeee ffff';
  const { page, relayout } = lay('fnt 10\ntxt ' + long + '\ntxt below', 400);
  const [t, below] = page.root.children;
  eq('text: one line when it fits', [t.lines.length, t.h, below.y], [1, 14, 14]);
  relayout(100);
  eq('text: wraps to the width', t.lines, ['aaaa bbbb cccc', 'dddd eeee ffff']);
  eq('text: height follows the lines, and what follows moves down', [t.h, below.y], [27, 27]);
  relayout(40);
  eq('text: one word per line when that is all that fits', [t.lines.length, t.h, below.y], [6, 79, 79]);
  const w = lay('fnt 10\ntxt https://example.org/a/very/long/address', 64).page.root.children[0];
  ok('text: a word wider than the line is broken between characters', w.lines.length > 1 && w.lines.every(l => measure(l, 10) <= 60) && w.lines.join('') === 'https://example.org/a/very/long/address', w.lines);
}
{
  const { page } = lay('fnt 10\ntxt top\ntxt bottom', 300, 500);
  eq('column: children stack at their natural height from the top', page.root.children.map(c => [c.y, c.h]), [[0, 14], [14, 14]]);
  eq('column: the page is at least as tall as the window', [page.root.h, page.contentH, page.maxScroll], [500, 28, 0]);
  const g = lay('fnt 10\ntxt top\nbox\n  grow 1\nend\ntxt bottom', 300, 500).page;
  eq('column: grow takes the spare height', g.root.children.map(c => [c.y, c.h]), [[0, 14], [14, 472], [486, 14]]);
  const j = lay('just between\nfnt 10\ntxt a\ntxt b\ntxt c', 300, 500).page;
  eq('column: just between', j.root.children.map(c => c.y), [0, 243, 486]);
  const c = lay('align center\nfnt 10\ntxt abcde', 300, 100).page.root.children[0];
  eq('column: align center gives children their natural width', [c.x, c.w], [133, 34]);
}
{
  const row = src => lay(src, 320).page.root.children[0].children.map(c => Math.round(c.w * 10) / 10);
  eq('row: equal shares', row('row\nbox\nend\nbox\nend\nend'), [160, 160]);
  eq('row: gap and pad come off first', row('row\npad 10\ngap 20\nbox\nend\nbox\nend\nend'), [140, 140]);
  eq('row: grow weights', row('row\nbox\ngrow 1\nend\nbox\ngrow 3\nend\nend'), [80, 240]);
  eq('row: a box size is a width', row('row\nbox 100\nend\nbox\nend\nend'), [100, 220]);
  eq('row: percentages', row('row\nbox 25%\nend\nbox\nw 50%\nend\nbox\nend\nend'), [80, 160, 80]);
  eq('row: minw is kept and the rest share what is left', row('row\nbox\nminw 200\nend\nbox\nend\nbox\nend\nend'), [200, 60, 60]);
  eq('row: maxw is kept and the rest share what is left', row('row\nbox\nmaxw 50\nend\nbox\nend\nbox\nend\nend'), [50, 135, 135]);
  eq('row: a child is never narrower than its longest word', row('fnt 10\nrow\ntxt incomprehensibilities and more\ntxt a\ntxt b\nend'), [130, 95, 95]);
  eq('row: just gives natural widths', row('fnt 10\nrow\njust end\ntxt abc\ntxt abcdef\nend'), [22, 40]);
  const r = lay('fnt 10\nrow\ngap 10\ntxt one two three four five six seven eight nine ten eleven twelve\ntxt short\nend\ntxt after', 200).page;
  const [a, b] = r.root.children[0].children;
  ok('row: is as tall as its tallest child, and the next element starts below it', a.lines.length > 1 && r.root.children[0].h === a.h && b.h === a.h && r.root.children[1].y === a.h, [a.h, b.h, r.root.children[0].h, r.root.children[1].y]);
  const al = lay('fnt 10\nrow\nh 100\nalign center\ntxt a\nend', 200).page.root.children[0].children[0];
  eq('row: align center', [al.y, al.h], [43, 14]);
  const col = lay('col\nbox 100\nend\nbox\nh 50%\nend\nend', 200, 400).page.root.children[0].children;
  eq('column: a box size is a height', col.map(c => c.h)[0], 100);
}
{
  const src = 'fnt 10\nscl 50\n' + 'txt line\n'.repeat(10) + 'end\ntxt after';
  const { page } = lay(src, 200, 400);
  const scl = page.root.children[0];
  eq('scroll area: keeps its height and scrolls its content', [scl.h, scl.contentH, scl.maxScroll, page.root.children[1].y], [50, 140, 90, 50]);
  eq('scroll area: content leaves room for the scrollbar', scl.children[0].w, 192);
  const tall = lay('fnt 10\n' + 'txt line\n'.repeat(100), 200, 400).page;
  eq('page: scrolls when taller than the window', [tall.contentH, tall.maxScroll], [1400, 1000]);
}
{
  const { page, relayout } = lay('fnt 10\ntab A, B\ncol\ntxt a\nend\ncol\ntxt b1\ntxt b2\ntxt b3\nend\nend\nacc More\ntxt hidden\nend\ntxt after', 300);
  const [tab, acc, after] = page.root.children;
  eq('tabs: only the selected panel takes space', [tab.h, tab.children[0].hidden, tab.children[1].hidden], [28 + 14, false, true]);
  eq('accordion: closed shows only its header', [acc.h, acc.children[0].hidden, after.y], [24, true, 42 + 24]);
  tab.sel = 1; acc.open = true; relayout();
  eq('tabs: selecting a taller panel moves the page', [tab.h, tab.children[0].hidden, tab.children[1].hidden], [28 + 42, true, false]);
  eq('accordion: open shows its body', [acc.h, acc.children[0].hidden, after.y], [38, false, 70 + 38]);
}
{
  const { page, relayout } = lay('fnt 10\ntxt under\ndlg Hello\ntxt inside the dialog\nbtn OK 1\nend', 360, 600);
  const dlg = page.root.children[1];
  eq('dialog: takes no room in the page', [page.contentH, page.dialogs.length], [14, 1]);
  ok('dialog: sits in the middle of the window', Math.abs(dlg.x + dlg.w / 2 - 180) < 1 && Math.abs(dlg.y + dlg.h / 2 - 300) < 1 && dlg.children[0].x > dlg.x && dlg.children[1].y > dlg.children[0].y, [dlg.x, dlg.y, dlg.w, dlg.h]);
  dlg.open = false; relayout();
  eq('dialog: closed', [page.dialogs.length, dlg.hidden], [0, true]);
}
{
  const g = lay('fnt 10\ngrid 2\ngap 10\ntxt aa\ntxt bb bb bb bb bb bb bb bb bb bb bb bb\ntxt cc\nend', 210).page.root.children[0];
  const [a, b, c] = g.children;
  ok('grid: equal columns, rows as tall as their tallest cell', a.w === 100 && b.w === 100 && b.x === 110 && b.lines.length > 1 && a.h === b.h && c.y === a.h + 10 && g.h === a.h + 10 + c.h, Pane.dump(lay('fnt 10\ngrid 2\ngap 10\ntxt aa\ntxt bb bb bb bb bb bb bb bb bb bb bb bb\ntxt cc\nend', 210).page));
  const t = lay('fnt 10\ntbl\ntxt a | b | c\ntxt 1 | 2 | 3\nend', 300).page.root.children[0];
  eq('table: one row per line, cells split on |', [t.h, t.children[1].y, t.children[0].cells], [44, 22, ['a', 'b', 'c']]);
  const l = lay('fnt 10\nlst\ntxt one\ntxt two\nend', 300).page.root.children[0];
  eq('list: items are indented for their numbers', [l.children[0].x, l.children[0].w], [20, 280]);
  const st = Pane.newState(); st.vars.msg = 'short';
  const d = lay('fnt 10\ntxt msg\ntxt after', 100, 300, st);
  st.vars.msg = 'now a much longer message that wraps'; d.relayout();
  ok('layout: follows the state (a variable that grows pushes the page down)', d.page.root.children[0].lines.length > 1 && d.page.root.children[1].y === d.page.root.children[0].h, Pane.dump(d.page));
}

// ───────────────────────────── names, adding and removing, hiding ─────────────────────────────
{
  const p = Pane.parse('col\nid main\n  txt a\n  id first\n  row\n  end\n  id therow\n  id first\n  id 9x\nend\nid Outer\nscript\n  local x = 1\n\nprint(x)\nend script\ntxt after\nscript\nprint(2)\nend script');
  eq('id: names the element before it, or the container just opened or closed', [p.names.first.text, p.names.therow.type], ['a', 'row']);
  eq('id: an element named twice keeps the later name', [p.names.outer.type, p.names.outer.name, p.names.main], ['col', 'outer', undefined]);
  eq('id: a name used twice or badly formed is reported', p.warnings.map(w => w.line), [8, 9]);
  const lines = p.script.split('\n');
  eq('script: kept at its own line numbers, the rest blank', [lines.length, lines[12], lines[14], lines[18], lines.filter(Boolean).length], [20, '  local x = 1', 'print(x)', 'print(2)', 3]);
  eq('script: its lines are not page lines', [p.root.children.length, p.nodes], [2, 4]);
  eq('script: without end script is reported', Pane.parse('script\nprint(1)').warnings.length, 1);
  eq('no script', Pane.parse('txt a').script, null);
}
{
  const p = Pane.parse('fg 9 9 9\ncol\nid list\nfnt 20\nend\ntxt after');
  eq('append: returns how many were added', Pane.append(p, p.names.list, 'txt one\nrow\nbtn Go 1\nid go\nend'), 3);
  const [one, row] = p.names.list.children;
  eq('append: new elements take the container\'s colour and size, and can be named', [one.props.fnt, one.props.fg, row.children[0].type, p.names.go === row.children[0], p.nodes], [20, [9, 9, 9], 'btn', true, 5]);
  Pane.append(p, p.names.list, 'title Evil\nset a 1\nif a=1 do go x\nscript\npage.go("x")\nend script\ntxt two');
  eq('append: title, statements and scripts are refused; the rest is added', [p.title, p.stmts.length, p.script, p.names.list.children.length, p.warnings.length], ['', 0, null, 3, 4]);
  Pane.clear(p, p.names.list);
  eq('clear: removes the elements and their names', [p.names.list.children.length, p.names.go, p.nodes], [0, undefined, 2]);
  let threw = '';
  try { Pane.append(p, p.names.list, 'txt x\n'.repeat(Pane.LIMITS.nodes + 10)); } catch (e) { threw = e.message; }
  ok('append: a page has a limit on elements', /5000 elements/.test(threw) && p.nodes === Pane.LIMITS.nodes, [threw, p.nodes]);
}
{
  const { page, relayout } = lay('fnt 10\ntxt a\ncol\nid box\ntxt inside\nend\ntxt b', 200);
  eq('hidden: before', page.root.children.map(c => c.y), [0, 14, 28]);
  page.names.box.off = true; relayout();
  eq('hidden: an element switched off takes no room, with everything in it', [page.root.children.map(c => c.y), page.names.box.hidden, page.names.box.children[0].hidden, Pane.dump(page).includes('inside')], [[0, 0, 14], true, true, false]);
  page.names.box.off = false; relayout();
  eq('hidden: and comes back', page.root.children.map(c => c.y), [0, 14, 28]);
}

// ───────────────────────────── scripts ─────────────────────────────
const Mote = require('../mote.js');
/** A page with a script, and a host made of plain objects: timers and requests wait until the test fires them. */
function scripted(src, opt) {
  const page = Pane.parse(src), st = Pane.newState(), h = { log: [], timers: [], requests: [], went: [], titles: [], changed: 0, store: new Map() };
  Pane.runStatements(page, st, 'load', {});
  const hooks = {
    log: (kind, text) => h.log.push(kind + ': ' + text), changed: () => h.changed++, navigate: a => h.went.push(a), title: t => h.titles.push(t),
    setTimer: (fn, ms, repeat) => { const t = { fn, ms, repeat, live: true }; h.timers.push(t); return t; }, clearTimer: t => { t.live = false; },
    fetch: (address, done) => h.requests.push({ address, done }),
    storage: opt && opt.noStorage ? () => null : () => ({ get: k => h.store.get(k), set: (k, v) => { h.store.set(k, v); }, remove: k => { h.store.delete(k); }, keys: () => [...h.store.keys()].sort() }),
  };
  h.rt = Pane.createRuntime(page, st, hooks, opt && opt.noMote ? null : Mote);
  h.page = page; h.st = st;
  h.click = name => h.rt.dispatch(page.names[name], 'click', 0);
  h.errors = () => h.log.filter(l => l.startsWith('error'));
  return h;
}
const BODY = 'txt hello\nid msg\nbtn Go 1\nid go\nbtn Other 2\nid other\ninp 1\nid field\ntog 1\nid sw\nchk 2 Agree\nid agree\nsel 1 A, B, C\nid pick\nsld 0 10 1\nid vol\nrat 3 5\nid stars\nprg 20 100\nid bar\ncol\nid list\nend\nacc More\nid more\ntxt in\nend\ntab X, Y\nid tabs\ncol\nend\ncol\nend\nend\nlnk Home home\nid link\n';
const run = (lua, opt) => scripted(BODY + 'script\n' + lua + '\nend script', opt);
{
  const h = run('print(page.find("msg").text, page.find("msg").kind, page.find("msg").name)\nprint(page.find("nope") == nil, page.find("msg") == page.find("msg"), type(page.find("msg")))');
  eq('script: finds elements by name', h.log, ['print: hello\ttxt\tmsg', 'print: true\ttrue\tuserdata']);
}
{
  const h = run(`local f = page.find
f("msg").text = "changed" f("go").text = "Run" f("agree").text = "Yes" f("more").text = "Less"
f("field").value = "typed" f("vol").value = 99 f("pick").value = 3 f("stars").value = 4 f("bar").value = 55 f("tabs").value = 2 f("link").value = "other"
f("sw").checked = true f("agree").checked = true f("more").open = true f("list").hidden = true
print(f("field").value, f("vol").value, f("pick").value, f("stars").value, f("bar").value, f("tabs").value, f("link").value, f("sw").checked, f("more").open, f("list").hidden, f("msg").value)`);
  eq('script: reads back what it wrote', h.log, ['print: typed\t10\t3\t4\t55\t2\tother\ttrue\ttrue\ttrue\tnil']);
  const n = h.page.names, st = h.st;
  eq('script: writes reach the page', [n.msg.text, n.go.label, n.agree.label, n.more.title, st.inputs[1], st.slds[1], st.sels[1], st.vars.rat3, n.bar.val, n.tabs.sel, n.link.url, st.togs[1], st.chks[2], n.more.open, n.list.off],
    ['changed', 'Run', 'Yes', 'Less', 'typed', 10, 2, 4, '55', 1, 'other', true, true, true, true]);
  ok('script: every write asks for a new layout', h.changed >= 15, h.changed);
}
{
  const h = run(`local function try(f) local ok, err = pcall(f) print(ok, err) end
try(function() page.find("msg").value = 1 end)
try(function() page.find("msg").checked = true end)
try(function() page.find("msg").open = true end)
try(function() page.find("msg").kind = "btn" end)
try(function() page.find("msg").name = "x" end)
try(function() page.find("msg").colour = "red" end)
try(function() page.find("vol").value = "loud" end)
try(function() page.find("msg").text = {} end)
try(function() page.find("list").text = "x" end)
try(function() page.find(42) end)
try(function() page.on("nope", "click", print) end)
try(function() page.on("go", "hover", print) end)
try(function() page.on("go", "click", "print") end)
try(function() page.add("msg", "txt x") end)
try(function() page.add("list", "", "words") end)
try(function() page.add("list", "div", "words") end)
try(function() page.set("9lives", 1) end)
try(function() page.set("x", {}) end)
try(function() page.after("soon", print) end)
try(function() page.go(nil) end)`);
  eq('script: wrong calls are errors the script can catch, with the line they happened on', h.log.map(l => l.replace('print: false\t', '')), [
    'page:39: a txt has no value', 'page:40: a txt has no checked', 'page:41: a txt has no open', 'page:42: kind cannot be changed', 'page:43: name cannot be changed',
    "page:44: cannot set field 'colour' on a host object", 'page:45: expected a number', 'page:46: expected text or a number', 'page:47: a col has no text', 'page:48: expected a name',
    'page:49: no element is called "nope"', 'page:50: events are "click" and "change"', 'page:51: expected a function', 'page:52: a txt cannot hold elements',
    'page:53: nothing was added to put the text in', 'page:54: a div has no text', 'page:55: expected a name', 'page:56: expected text or a number', 'page:57: expected a number', 'page:58: expected an address']);
}
{
  const h = run(`local n = 0
page.on("go", "click", function(value, el)
  n = n + 1
  page.set("count", n)
  page.add("list", "txt", "item " .. n)
  el.text = "Go " .. n
end)
page.on("go", "click", function() page.set("second", 1) end)
page.on("vol", "change", function(v) page.set("heard", v) end)`);
  h.click('go'); h.click('go');
  eq('script: click handlers run in order, each time', [h.st.vars.count, h.st.vars.second, h.page.names.list.children.map(c => c.text), h.page.names.go.label], [2, 1, ['item 1', 'item 2'], 'Go 2']);
  h.rt.dispatch(h.page.names.vol, 'change', 7.5);
  eq('script: change handlers get the new value', h.st.vars.heard, 7.5);
  h.rt.dispatch(h.page.names.other, 'click', 0);
  eq('script: an element without handlers is fine', h.errors(), []);
  // variables are shared with {expr} and with the page's statements
  eq('script: variables it sets show in text', Pane.display('Count: {count}', h.st), 'Count: 2');
}
{
  const h = run('page.add("list", "txt", "{count} and count\\nlnk Evil pane:evil")\npage.add("list", "btn", "{1+1}")\npage.find("msg").text = "{2*3}"\npage.set("count", 7)');
  const st = h.st, list = h.page.names.list.children;
  eq('script: text given as words is one element, shown exactly as given', [list.length, list.map(c => c.type), Pane.display('{count}', st)], [2, ['txt', 'btn'], '7']);
  const { page } = (() => { Pane.layout(h.page, 400, 600, { measure, state: st }); return { page: h.page }; })();
  ok('script: no variable and no {expr} is read from such text', list[0].lines.join(' ') === '{count} and count lnk Evil pane:evil' && page.names.msg.lines[0] === '{2*3}' && !Object.keys(page.names).includes('evil'), [list[0].lines, page.names.msg.lines]);
}
{
  const h = run('page.title("New title")\npage.on("go", "click", function() page.go("next.pane") end)');
  h.click('go');
  eq('script: title and go reach the host', [h.titles, h.page.title, h.went], [['New title'], 'New title', ['next.pane']]);
}
{
  const h = run(`local ticks = 0
local once = page.after(100, function() page.set("once", 1) end)
local rep = page.every(1, function() ticks = ticks + 1 page.set("ticks", ticks) end)
local gone = page.after(5, function() page.set("gone", 1) end)
page.cancel(gone)
page.on("go", "click", function() page.cancel(rep) end)`);
  eq('timers: delays are kept sensible', h.timers.map(t => [t.ms, t.repeat, t.live]), [[100, false, true], [50, true, true], [10, false, false]]);
  h.timers[0].fn(); h.timers[1].fn(); h.timers[1].fn();
  eq('timers: fire into the script', [h.st.vars.once, h.st.vars.ticks, h.st.vars.gone], [1, 2, undefined]);
  h.click('go');
  eq('timers: cancel', h.timers[1].live, false);
}
{
  const h = run(`page.fetch("data.txt", function(status, body) page.set("status", status) page.set("body", body) end)
store.set("name", "Ada") store.set("n", 3) store.set("on", true)
print(store.get("name"), store.get("n"), store.get("on"), store.get("missing"), #store.keys())
store.remove("n")
print(store.get("n"))`);
  eq('fetch: the request goes to the host', h.requests.map(r => r.address), ['data.txt']);
  h.requests[0].done(200, 'hello');
  eq('fetch: the answer comes back to the script', [h.st.vars.status, h.st.vars.body], [200, 'hello']);
  eq('store: values of each kind, missing is nil, remove', h.log, ['print: Ada\t3\ttrue\tnil\t3', 'print: nil']);
  const none = run('print(pcall(store.get, "k"))', { noStorage: true });
  eq('store: says so when the host gives none', none.log, ['print: false\tstorage is not available here']);
}

// ── limits ──
{
  const h = run(`page.on("go", "click", function() while true do end end)
page.on("other", "click", function() page.set("alive", (page.get("alive") or 0) + 1) end)`);
  h.click('go');
  ok('limits: a handler that never ends is stopped, with a message', h.errors().length === 1 && /step budget exhausted/.test(h.errors()[0]), h.log);
  h.click('other'); h.click('go'); h.click('other');
  eq('limits: and the page goes on working', [h.st.vars.alive, h.errors().length], [2, 2]);
}
{
  const h = run('page.on("go", "click", function() local s = "x" while true do s = s .. s end end)\npage.on("other", "click", function() local t = {} while true do t[#t + 1] = {} end end)');
  h.click('go'); h.click('other');
  ok('limits: runaway memory is stopped', h.errors().length === 2 && h.errors().every(e => /memory|budget/.test(e)), h.log);
}
{
  const h = run('while true do end');
  ok('limits: a script that never ends at load is stopped; the page is still there', h.errors().length === 1 && h.page.names.msg.text === 'hello', h.log);
  const t = run('page.every(100, function() while true do end end)\npage.every(100, function() page.set("ok", 1) end)');
  t.timers[0].fn(); t.timers[1].fn();
  eq('limits: a repeating timer that hits the limit is stopped, others go on', [t.timers.map(x => x.live), t.st.vars.ok, t.errors().length], [[false, true], 1, 1]);
}
{
  const h = run(`local function count(f) local n = 0 while n < 10000 do local ok, err = pcall(f, n) if not ok then return n, err end n = n + 1 end return n end
print(count(function() page.every(1000, print) end))
print(count(function() page.fetch("x", print) end))
print(count(function() page.on("go", "change", print) end))
print(count(function(i) page.add("list", "txt " .. i) end))
page.find("msg").text = string.rep("x", 30000)
print(#page.find("msg").text)
print(pcall(store.set, string.rep("k", 101), 1))
print(pcall(store.set, "k", string.rep("v", 20001)))
print(pcall(store.set, "k", {}))
print(pcall(store.set, "", 1))`);
  eq('limits: timers, requests at once, handlers, elements, text and stored values', h.log.map(l => l.replace(/^print: /, '').replace(/page:\d+: /, '').replace(/^49\d\d\t/, 'N\t')), [
    '32\ta page can have 32 timers at once', '4\ta page can have 4 requests at once', '500\ta page can have 500 handlers',
    'N\ta page can hold 5000 elements', '20000', 'false\ta key is text of 1 to 100 characters',
    'false\ta stored value can be 20000 characters', 'false\ta stored value is text, a number or true / false', 'false\ta key is text of 1 to 100 characters']);
}

// ── what a script cannot reach ──
{
  const h = run(`local names = {"window", "document", "globalThis", "self", "global", "process", "require", "module", "Function", "eval", "fetch", "XMLHttpRequest", "localStorage", "Pane", "Mote", "console", "setTimeout", "io", "os", "debug", "dofile", "loadstring"}
local found = {}
for _, n in ipairs(names) do if _G[n] ~= nil then found[#found + 1] = n end end
print(#found, table.concat(found, ","))
local el = page.find("msg")
print(el.constructor, el.__proto__, el.toString, el.valueOf, el.hasOwnProperty, el.prototype, el.__defineGetter__)
print(pcall(function() return page.find.constructor end))
print(pcall(function() return store.get.constructor end))
print(pcall(function() el.__proto__ = {} end))
print(pcall(function() el.constructor = 1 end))
print(getmetatable("").__index.constructor, ("x").constructor, pcall(function() return print.constructor end))
print(page.find("__proto__"), page.find("constructor"), page.find("tostring"), page.find("hasownproperty"))
print(pcall(page.on, "__proto__", "click", print))
page.set("__proto__", 5) page.set("constructor", 6)
print(page.get("__proto__"), page.get("constructor"), page.get("tostring"))
store.set("__proto__", "p") store.set("constructor", "c")
print(store.get("__proto__"), store.get("constructor"), store.get("toString"))`);
  const out = h.log.map(l => l.replace(/^print: /, ''));
  eq('escape: no host global is there', out[0], '0\t');
  eq('escape: an element handle has only its seven fields', out[1], 'nil\tnil\tnil\tnil\tnil\tnil\tnil');
  ok('escape: host functions cannot be looked into', /^false\t/.test(out[2]) && /^false\t/.test(out[3]), out.slice(2, 4));
  ok('escape: nor can a handle be given a prototype or a constructor', /^false\t/.test(out[4]) && /^false\t/.test(out[5]), out.slice(4, 6));
  ok('escape: strings and functions lead nowhere', /^nil\tnil\tfalse\t/.test(out[6]), out[6]);
  eq('escape: names like __proto__ are just names that no element has', [out[7], /^false\t.*no element is called/.test(out[8])], ['nil\tnil\tnil\tnil', true]);
  eq('escape: variables and stored keys with such names are plain entries', [out[9], out[10]], ['5\t6\tnil', 'p\tc\tnil']);
  ok('escape: nothing leaked onto Object.prototype', ({}).p === undefined && Object.prototype.constructor === Object && !('5' in {}) && h.st.vars.constructor === 6);
  eq('escape: no errors', h.errors(), []);
}
{
  // two pages: nothing of one is in the other
  const a = run('secret = "from a"\nstring.leak = "from a"\npage.set("mine", 1)'), b = run('print(secret, string.leak, page.get("mine"))');
  eq('escape: each page has its own VM, globals, string table and variables', b.log, ['print: nil\tnil\tnil']);
  ok('escape: they are different VMs', a.rt.vm !== b.rt.vm);
}
{
  // a page that was left: nothing it started can act any more
  const h = run(`page.on("go", "click", function() page.set("clicks", (page.get("clicks") or 0) + 1) end)
page.every(100, function() page.set("ticks", (page.get("ticks") or 0) + 1) page.go("evil") end)
page.fetch("late.txt", function() page.set("late", 1) page.go("evil") store.set("late", 1) end)`);
  h.rt.stop();
  h.click('go'); h.timers[0].fn(); h.requests[0].done(200, 'x');
  eq('escape: after its page is left, a script gets no clicks, ticks or answers', [h.st.vars.clicks, h.st.vars.ticks, h.st.vars.late, h.went, h.store.size, h.timers[0].live], [undefined, undefined, undefined, [], 0, false]);
}
{
  const h = run('print(1)', { noMote: true });
  ok('a page with a script still shows when there is no script engine', h.errors().length === 1 && h.page.names.msg.text === 'hello', h.log);
  const e = run('local x = = 1');
  ok('a script with a mistake is reported with its line in the page file', /^error: page:38:\d+: /.test(e.errors()[0]) && e.page.names.msg.text === 'hello', e.log);
}

// ───────────────────────────── layout: every sample page ─────────────────────────────
const pagesDir = path.join(__dirname, '..', 'pages'), snapPath = path.join(__dirname, 'pane-layout.snap.json');
const names = fs.readdirSync(pagesDir).filter(f => f.endsWith('.pane')).map(f => f.slice(0, -5)).sort();
const stored = fs.existsSync(snapPath) ? JSON.parse(fs.readFileSync(snapPath, 'utf8')) : {};
const fresh = {};
ok('pages: there are at least 10 sample pages', names.length >= 10, names.length);
for (const name of names) {
  const src = fs.readFileSync(path.join(pagesDir, name + '.pane'), 'utf8');
  for (const [w, h] of [[360, 640], [768, 1024], [1280, 800]]) {
    const { page } = lay(src, w, h), tag = `${name} @${w}`, bad = [];
    const EPS = 0.01;
    eq(`${tag}: no line of the page was skipped`, page.warnings, []);
    (function check(n, parent) {
      if (n.hidden || n.type === 'tmr') return;
      const inDialog = parent && parent.type === 'dlg';
      if ([n.x, n.y, n.w, n.h].some(v => typeof v !== 'number' || !isFinite(v))) bad.push(`${n.type} line ${n.line}: not placed`);
      if (n.w < -EPS || n.h < -EPS) bad.push(`${n.type} line ${n.line}: negative size`);
      if (parent && !inDialog && parent.type !== 'tbl' && (n.x < parent.x - EPS || n.x + n.w > parent.x + parent.w + EPS)) bad.push(`${n.type} line ${n.line}: sticks out of its ${parent.type} sideways (${n.x}..${n.x + n.w} in ${parent.x}..${parent.x + parent.w})`);
      if (n.x < -EPS || n.x + n.w > w + EPS) bad.push(`${n.type} line ${n.line}: outside the window sideways`);
      if (n.lines) {
        for (const line of n.lines) if (line.length > 1 && measure(line, n.props.fnt) > n.w - 4 + EPS) bad.push(`${n.type} line ${n.line}: text line wider than its box: "${line}"`);
        if (n.h + EPS < (n.lines.length - 1) * (n.props.fnt + 3) + n.props.fnt + 4) bad.push(`${n.type} line ${n.line}: box shorter than its ${n.lines.length} lines`);
      }
      if (n.children) {
        const kids = n.children.filter(c => !c.hidden && c.type !== 'tmr' && c.type !== 'dlg');
        // children of anything but a row or a grid are stacked: each must start at or below the end of the one before
        if (n.type !== 'row' && n.type !== 'grid') for (let i = 1; i < kids.length; i++) if (kids[i].y + EPS < kids[i - 1].y + kids[i - 1].h) bad.push(`${kids[i].type} line ${kids[i].line}: overlaps the ${kids[i - 1].type} above it`);
        if (n.type === 'row') for (let i = 1; i < kids.length; i++) if (kids[i].x + EPS < kids[i - 1].x + kids[i - 1].w) bad.push(`${kids[i].type} line ${kids[i].line}: overlaps the ${kids[i - 1].type} to its left`);
        // a container holds its children's full height, unless it scrolls or was given a height
        if (n.type !== 'scl' && n.type !== 'dlg' && n.props.h == null && n.props.size == null) for (const c of kids) if (c.y + c.h > n.y + n.h + EPS) bad.push(`${c.type} line ${c.line}: runs past the bottom of its ${n.type}`);
        for (const c of n.children) check(c, n);
      }
    })(page.root, null);
    eq(`${tag}: layout rules hold`, bad.slice(0, 5), []);
    ok(`${tag}: the page is as tall as its content`, page.contentH > 0 && page.root.h === Math.max(h, page.contentH) && page.maxScroll === Math.max(0, page.contentH - h));
    fresh[tag] = Pane.dump(page).split('\n');
    if (!update) ok(`${tag}: layout matches the stored picture`, JSON.stringify(stored[tag]) === JSON.stringify(fresh[tag]),
      stored[tag] ? 'first difference: ' + JSON.stringify((fresh[tag].find((l, i) => l !== stored[tag][i]) || 'length')) + ' — if intended, run with --update' : 'no stored picture: run with --update');
  }
}
{
  const narrow = lay(fs.readFileSync(path.join(pagesDir, 'article.pane'), 'utf8'), 360).page, wide = lay(fs.readFileSync(path.join(pagesDir, 'article.pane'), 'utf8'), 1280).page;
  ok('article: taller on a phone than on a desktop, and its column stops at 640', narrow.contentH > wide.contentH && wide.root.children[0].w === 640 && wide.root.children[0].x === 320, [narrow.contentH, wide.contentH, wide.root.children[0].x]);
  ok('article: scrolls on a phone', narrow.maxScroll > 300);
}
if (update) { fs.writeFileSync(snapPath, JSON.stringify(fresh, null, 1) + '\n'); console.log(`wrote ${Object.keys(fresh).length} layout pictures to ${path.relative(process.cwd(), snapPath)}`); }
else ok('pages: no stored picture is left over from a page that is gone', Object.keys(stored).every(k => k in fresh), Object.keys(stored).filter(k => !(k in fresh)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

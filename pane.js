/*
 * Pane — a small page engine: Tiny's UI language as a page format.
 *
 *   const page = Pane.parse(source);
 *   Pane.layout(page, 360, 640, { measure: (text, px, family, bold) => width });   // pure, runs in Node
 *   const view = Pane.createView(canvas, { onNavigate: url => … });                // browser
 *   view.load(source, baseUrl);
 *
 * One dependency-free file. Use it as a classic <script> (defines window.Pane) or from Node with
 * require('./pane.js'). Page format reference: PANE.md. The browser shell pane.html embeds a copy of this
 * file; after editing pane.js rebuild it with
 *   node tools/build-pane-html.js
 *
 * Pipeline: source → parse (element tree + statements) → layout (boxes, wrapped text lines)
 *           → paint (canvas 2D, hit regions) → events (click, scroll, keys) → statements → layout …
 * The grammar and the look of every widget come from the UI mode of tiny-v3-8.html. What is new here:
 * text is wrapped and measured during layout (so nothing overlaps), columns stack at their natural height
 * and the page scrolls, rows share width without overflowing, sizes can be percentages with min / max,
 * {expr} inside text, links that navigate, and no globals: all state lives in the page and the view.
 */
(function (root) {
'use strict';

const VERSION = '0.2';
const DEFAULT_FONT = 'Courier New';
const CONTAINERS = new Set(['row', 'col', 'box', 'scl', 'tbl', 'grid', 'lst', 'dlg', 'acc', 'tab']);
const ALIGN = new Set(['start', 'center', 'end', 'stretch']);
const JUST = new Set(['start', 'center', 'end', 'between']);
const LIST_NUM_W = 20, SCROLLBAR_W = 8, TAB_H = 28;

// ════════════════════════════════════════════ parse ════════════════════════════════════════════

function int(s, d) { const v = parseInt(s, 10); return isNaN(v) ? d : v; }
function rgb3(parts, at) {
  const c = [int(parts[at], 0), int(parts[at + 1], 0), int(parts[at + 2], 0)];
  return c.map(v => Math.max(0, Math.min(255, v)));
}
/** "120" → 120, "50%" → {pct: 50}, anything else → null. */
function parseSize(s) {
  if (s == null) return null;
  const m = /^(\d+(?:\.\d+)?)(%?)$/.exec(s);
  if (!m) return null;
  return m[2] ? { pct: parseFloat(m[1]) } : parseFloat(m[1]);
}

const NAME = /^[a-z_][a-z0-9_]*$/;
const LIMITS = { nodes: 5000, text: 20000, steps: 2e6, memory: 8e6, handlers: 500, timers: 32, requests: 4, body: 1e6, key: 100, value: 20000 };

function newPage() {
  const rootNode = {
    type: 'col', isRoot: true, children: [], line: 0,
    props: { bg: [6, 14, 26], fg: [187, 221, 255], fnt: 14, pad: 0, gap: 0, brd: null, size: null, fontFamily: null },
  };
  return { root: rootNode, stmts: [], title: '', fonts: [], warnings: [], scrollY: 0, nodes: 0, names: Object.create(null), script: null };
}

/**
 * Source text → page. One statement per line; indentation is free; `end` closes a container and containers
 * left open at the end are closed. Unknown lines are skipped and listed in page.warnings.
 * Lines between `script` and `end script` are kept as they are in page.script (a Mote program), at their
 * own line numbers.
 */
function parse(src) {
  const page = newPage();
  parseInto(page, page.root, String(src).split(/\r?\n/), false);
  return page;
}

/** Add elements written in the page format to a container of a page that is already there. Returns how many. */
function append(page, container, src) {
  const before = page.nodes;
  parseInto(page, container, String(src).split(/\r?\n/), true);
  return page.nodes - before;
}

/** Remove everything inside a container. */
function clear(page, container) {
  (function drop(n) {
    for (const c of n.children || []) { if (c.name && page.names[c.name] === c) delete page.names[c.name]; page.nodes--; drop(c); }
  })(container);
  container.children = [];
}

function parseInto(page, container, lines, fragment) {
  const stack = [container];
  const cur = () => stack[stack.length - 1];
  const warn = (line, msg) => { if (page.warnings.length < 200) page.warnings.push({ line, msg }); };
  const inherit = () => {
    const p = cur().props;
    return { bg: null, fg: p.fg ? p.fg.slice() : null, fnt: p.fnt, pad: 0, gap: 0, brd: null, size: null, fontFamily: p.fontFamily || null };
  };
  let last = null, script = null, inScript = false;
  const add = (n, lineNo) => {
    if (page.nodes >= LIMITS.nodes) throw new Error('a page can hold ' + LIMITS.nodes + ' elements');
    n.props = inherit(); n.line = lineNo; page.nodes++; cur().children.push(n); last = n; return n;
  };
  const open = (n, lineNo) => { n.children = []; add(n, lineNo); stack.push(n); return n; };

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim(), lineNo = i + 1;
    if (inScript) { if (/^end\s+script$/i.test(t)) inScript = false; else if (script) script[i] = lines[i]; continue; }
    if (!t) continue;
    const parts = t.split(/\s+/), cmd = parts[0].toLowerCase();
    const rest = t.slice(parts[0].length).trim();
    if (cmd === 'rem') continue;
    if (cmd === 'script' && parts.length === 1) {
      if (fragment) { warn(lineNo, 'script cannot be added to a page that is running'); }
      else if (!script) script = new Array(lines.length).fill('');
      inScript = true;
      continue;
    }
    const p = cur().props;
    switch (cmd) {
      // containers
      case 'row': case 'col': case 'tbl': case 'lst': open({ type: cmd }, lineNo); break;
      case 'box': case 'scl': open({ type: cmd }, lineNo).props.size = parseSize(parts[1]); break;
      case 'grid': open({ type: 'grid', cols: Math.max(1, Math.min(50, int(parts[1], 2))) }, lineNo); break;
      case 'dlg': open({ type: 'dlg', title: rest, open: true }, lineNo); break;
      case 'acc': open({ type: 'acc', title: rest, open: false }, lineNo); break;
      case 'tab': open({ type: 'tab', tabs: rest.split(',').map(s => s.trim()).filter(Boolean), sel: 0 }, lineNo); break;
      case 'end': if (stack.length > 1) last = stack.pop(); else warn(lineNo, 'end without an open container'); break;
      // a name for the element written just before (or the container just opened or closed)
      case 'id': {
        const name = (parts[1] || '').toLowerCase();
        if (!NAME.test(name)) warn(lineNo, 'id needs a name made of letters, digits and _');
        else if (!last) warn(lineNo, 'id names the element before it, and there is none');
        else if (page.names[name]) warn(lineNo, 'the name "' + name + '" is already used');
        else { if (last.name) delete page.names[last.name]; last.name = name; page.names[name] = last; }
        break;
      }
      // properties of the current container
      case 'pad': p.pad = Math.max(0, int(parts[1], 0)); break;
      case 'gap': p.gap = Math.max(0, int(parts[1], 0)); break;
      case 'bg': if (parts.length >= 4) { p.bg = rgb3(parts, 1); delete p.bgA; } break;
      case 'bge': if (parts.length >= 5) { p.bg = rgb3(parts, 1); p.bgA = Math.max(0, Math.min(1, parseFloat(parts[4]) / 255 || 0)); } break;
      case 'fg': if (parts.length >= 4) p.fg = rgb3(parts, 1); break;
      case 'brd': if (parts.length >= 4) p.brd = rgb3(parts, 1); break;
      case 'fnt': p.fnt = Math.max(6, Math.min(200, int(parts[1], 14))); break;
      case 'font': {
        const name = rest.split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
        if (/^[A-Za-z0-9 ]{1,60}$/.test(name)) { p.fontFamily = name; if (!page.fonts.includes(name)) page.fonts.push(name); }
        else warn(lineNo, 'font name not understood');
        break;
      }
      case 'grow': p.grow = Math.max(0, parseFloat(parts[1]) || 0); break;
      case 'w': case 'h': case 'minw': case 'maxw': case 'minh': case 'maxh': {
        const v = parseSize(parts[1]);
        if (v == null) warn(lineNo, cmd + ' needs a number or a percentage'); else p[cmd] = v;
        break;
      }
      case 'align': if (ALIGN.has(parts[1])) p.align = parts[1]; else warn(lineNo, 'align: start, center, end or stretch'); break;
      case 'just': if (JUST.has(parts[1])) p.just = parts[1]; else warn(lineNo, 'just: start, center, end or between'); break;
      case 'title': if (fragment) warn(lineNo, 'title belongs at the top of a page'); else page.title = rest; break;
      // elements
      case 'txt': add({ type: 'txt', text: rest }, lineNo); break;
      case 'btn': {
        const hasId = parts.length > 2 && /^\d+$/.test(parts[parts.length - 1]);
        add({ type: 'btn', label: hasId ? parts.slice(1, -1).join(' ') : rest, id: hasId ? int(parts[parts.length - 1], 0) : 0 }, lineNo);
        break;
      }
      case 'inp': add({ type: 'inp', id: int(parts[1], 0) }, lineNo); break;
      case 'tog': add({ type: 'tog', id: int(parts[1], 0) }, lineNo); break;
      case 'chk': add({ type: 'chk', id: int(parts[1], 0), label: parts.slice(2).join(' ') }, lineNo); break;
      case 'sel': add({ type: 'sel', id: int(parts[1], 0), opts: parts.slice(2).join(' ').split(',').map(s => s.trim()).filter(Boolean) }, lineNo); break;
      case 'sld': {
        const min = parseFloat(parts[1]) || 0; let max = parseFloat(parts[2]); if (isNaN(max)) max = 100; if (max <= min) max = min + 1;
        add({ type: 'sld', min, max, id: int(parts[3], 0) }, lineNo);
        break;
      }
      case 'prg': add({ type: 'prg', val: parts[1] || '0', max: parts[2] || '100' }, lineNo); break;
      case 'img': add({ type: 'img', url: rest }, lineNo); break;
      case 'avt': add({ type: 'avt', url: rest }, lineNo); break;
      case 'lnk': {
        const sp = rest.lastIndexOf(' ');
        add({ type: 'lnk', text: sp > 0 ? rest.slice(0, sp) : rest, url: sp > 0 ? rest.slice(sp + 1) : rest }, lineNo);
        break;
      }
      case 'div': add({ type: 'div' }, lineNo); break;
      case 'spn': add({ type: 'spn' }, lineNo); break;
      case 'tmr': add({ type: 'tmr', id: int(parts[1], 0), ms: Math.max(50, int(parts[2], 1000)) }, lineNo); break;
      case 'bdg': add({ type: 'bdg', text: rest }, lineNo); break;
      case 'rat': add({ type: 'rat', id: int(parts[1], 0), max: Math.max(1, Math.min(20, int(parts[2], 5))) }, lineNo); break;
      case 'ico': add({ type: 'ico', name: parts[1] || '' }, lineNo); break;
      // statements: run at load (set) and on widget events / timer ticks (if)
      case 'if': case 'set': if (fragment) warn(lineNo, 'statements belong to the page, not to added elements'); else page.stmts.push({ text: t, line: lineNo }); break;
      default: warn(lineNo, 'unknown word "' + parts[0] + '"');
    }
  }
  if (inScript) warn(lines.length, 'script without end script');
  if (script && !fragment) page.script = script.join('\n');
}

// ════════════════════════════════════════════ expressions ════════════════════════════════════════════

/** A fresh state: variables and widget values. Keys of vars are lower-case. */
function newState() {
  return { vars: Object.create(null), inputs: Object.create(null), togs: Object.create(null), chks: Object.create(null),
    sels: Object.create(null), slds: Object.create(null), taps: Object.create(null), activeInput: -1 };
}

const TOKEN = /\s*(?:(\d+\.?\d*|\.\d+)|"([^"]*)"|([A-Za-z_][A-Za-z0-9_]*)|(<>|>=|<=|==|!=|[-+*\/()=<>]))/y;
const ACCESSORS = new Set(['val', 'str', 'tap', 'chk', 'tog', 'sel', 'sld', 'rat']);
const num = v => typeof v === 'number' ? v : (v === '' || isNaN(Number(v)) ? 0 : Number(v));
const truthy = v => typeof v === 'string' ? v !== '' : v !== 0;

function tokenize(src) {
  const out = []; TOKEN.lastIndex = 0;
  for (;;) {
    const at = TOKEN.lastIndex, m = TOKEN.exec(src);
    if (!m) { if (src.slice(at).trim()) throw new Error('unexpected ' + src.slice(at).trim()[0]); break; }
    if (m[1] !== undefined) out.push({ k: 'num', v: parseFloat(m[1]) });
    else if (m[2] !== undefined) out.push({ k: 'str', v: m[2] });
    else if (m[3] !== undefined) out.push({ k: 'id', v: m[3].toLowerCase() });
    else out.push({ k: 'op', v: m[4] });
  }
  return out;
}

/**
 * Evaluate an expression against a state. Numbers, "strings", variables (unknown → 0), ( ), unary -,
 * * /, + - (+ joins when either side is a string), = <> < > <= >= (== and != also accepted), not, and, or.
 * Widget values: val N (input as a number, or its text when it is not a number), str N (input text), tap N,
 * chk N, tog N, sel N, sld N, rat N. A malformed expression is 0.
 */
function evalExpr(src, st) {
  let toks, i = 0;
  try { toks = tokenize(String(src)); } catch (e) { return 0; }
  const peek = () => toks[i], isOp = v => toks[i] && toks[i].k === 'op' && toks[i].v === v, isId = v => toks[i] && toks[i].k === 'id' && toks[i].v === v;
  function primary() {
    const t = toks[i++];
    if (!t) throw new Error('unexpected end');
    if (t.k === 'num' || t.k === 'str') return t.v;
    if (t.k === 'op' && t.v === '(') { const v = or(); if (!isOp(')')) throw new Error('missing )'); i++; return v; }
    if (t.k === 'op' && t.v === '-') return -num(primary());
    if (t.k === 'id') {
      if (ACCESSORS.has(t.v) && peek() && peek().k === 'num') {
        const id = toks[i++].v;
        switch (t.v) {
          case 'val': { const s = st.inputs[id] || ''; return s !== '' && !isNaN(Number(s)) ? Number(s) : s === '' ? 0 : s; }
          case 'str': return st.inputs[id] || '';
          case 'tap': return st.taps[id] ? 1 : 0;
          case 'chk': return st.chks[id] ? 1 : 0;
          case 'tog': return st.togs[id] ? 1 : 0;
          case 'sel': return st.sels[id] || 0;
          case 'sld': return st.slds[id] || 0;
          case 'rat': return st.vars['rat' + id] || 0;
        }
      }
      return t.v in st.vars ? st.vars[t.v] : 0;
    }
    throw new Error('unexpected ' + t.v);
  }
  function mul() {
    let l = primary();
    while (isOp('*') || isOp('/')) { const op = toks[i++].v, r = num(primary()); l = op === '*' ? num(l) * r : (r ? num(l) / r : 0); }
    return l;
  }
  function addp() {
    let l = mul();
    while (isOp('+') || isOp('-')) {
      const op = toks[i++].v, r = mul();
      l = op === '-' ? num(l) - num(r) : (typeof l === 'string' || typeof r === 'string') ? fmt(l) + fmt(r) : l + r;
    }
    return l;
  }
  function cmp() {
    const l = addp(), t = peek();
    if (!t || t.k !== 'op' || !/^(<>|>=|<=|==|!=|=|<|>)$/.test(t.v)) return l;
    i++;
    const r = addp(), strs = typeof l === 'string' || typeof r === 'string';
    const a = strs ? String(l) : l, b = strs ? String(r) : r;
    switch (t.v) {
      case '=': case '==': return a === b ? 1 : 0;
      case '<>': case '!=': return a !== b ? 1 : 0;
      case '<': return a < b ? 1 : 0;
      case '>': return a > b ? 1 : 0;
      case '<=': return a <= b ? 1 : 0;
      default: return a >= b ? 1 : 0;
    }
  }
  function not() { if (isId('not')) { i++; return truthy(not()) ? 0 : 1; } return cmp(); }
  function and() { let l = not(); while (isId('and')) { i++; const r = not(); l = truthy(l) && truthy(r) ? 1 : 0; } return l; }
  function or() { let l = and(); while (isId('or')) { i++; const r = and(); l = truthy(l) || truthy(r) ? 1 : 0; } return l; }
  try { const v = or(); if (i < toks.length) throw new Error('unexpected ' + toks[i].v); return v; } catch (e) { return 0; }
}

/** How a value is shown in text: integers as they are, other numbers with at most 6 decimals. */
function fmt(v) {
  if (typeof v !== 'number') return String(v);
  if (!isFinite(v)) return '0';
  return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(6)));
}

/** The text an element shows: a text that is exactly a variable's name shows the variable; {expr} is replaced. */
function display(text, st) {
  if (!text) return '';
  const key = text.toLowerCase();
  if (key in st.vars) return fmt(st.vars[key]);
  return text.indexOf('{') < 0 ? text : text.replace(/\{([^{}]*)\}/g, (_, e) => fmt(evalExpr(e, st)));
}

const textOf = n => (n.type === 'btn' || n.type === 'chk' ? n.label : n.type === 'acc' || n.type === 'dlg' ? n.title : n.text) || '';
/** What an element shows. Text a script put there is shown as it is: no variable, no {expr}. */
const shownText = (n, st) => n.raw ? textOf(n) : display(textOf(n), st);

/** One action of a statement. host: { navigate(url), sound(url), web(url, name) }, each optional. */
function execAction(a, st, host) {
  a = a.trim();
  const sp = a.search(/\s/), word = (sp < 0 ? a : a.slice(0, sp)).toLowerCase(), rest = sp < 0 ? '' : a.slice(sp).trim();
  if (word === 'set') {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=?\s*(.*)$/.exec(rest);
    if (m) st.vars[m[1].toLowerCase()] = evalExpr(m[2], st);
  } else if (word === 'go') { if (host && host.navigate) host.navigate(rest); }
  else if (word === 'snd') { if (host && host.sound) host.sound(rest); }
  else if (word === 'web') { const p = rest.split(/\s+/); if (host && host.web && p[0]) host.web(p[0], (p[1] || 'data').toLowerCase()); }
}

/** Run the page's statements. phase 'load' runs the top-level set lines; phase 'event' runs the if lines. */
function runStatements(page, st, phase, host) {
  for (const s of page.stmts) {
    const t = s.text, low = t.toLowerCase();
    if (low.startsWith('set ')) { if (phase === 'load') execAction(t, st, host); continue; }
    if (phase !== 'event') continue;
    let at = low.indexOf(' do '), len = 4;
    if (at < 0) { at = low.indexOf(' then '); len = 6; }
    if (at < 0) continue;
    if (!truthy(evalExpr(t.slice(3, at), st))) continue;
    // ":" separates actions; "://" inside a URL does not
    for (const a of t.slice(at + len).split(/:(?!\/\/)/)) execAction(a, st, host);
  }
}

// ════════════════════════════════════════════ layout ════════════════════════════════════════════

const fam = n => n.props.fontFamily || null;
const px = n => n.props.fnt || 14;
const flow = n => n.children.filter(c => c.type !== 'dlg' && c.type !== 'tmr' && !c.off);
function clamp(v, lo, hi) { if (hi != null && v > hi) v = hi; if (lo != null && v < lo) v = lo; return v; }
/** A size property against the space it is a percentage of; null when unset or not resolvable. */
function resolve(v, of) { return v == null ? null : typeof v === 'number' ? v : of == null ? null : of * v.pct / 100; }

/**
 * Lay the page out for a viewport. env.measure(text, px, family, bold) → width in px (required);
 * env.image(url) → {w, h} or null; env.state → the state texts are read from.
 * Sets x, y, w, h on every node in page coordinates (scrolling is applied when painting), the wrapped lines
 * of every text, page.contentH and page.maxScroll.
 */
function layout(page, vw, vh, env) {
  const st = env.state || newState();
  const cache = env.cache || (env.cache = new Map());
  const widthOf = (text, size, family, bold) => {
    const key = size + '|' + (family || '') + '|' + (bold ? 1 : 0) + '|' + text;
    let w = cache.get(key);
    if (w === undefined) { w = env.measure(text, size, family, !!bold); if (cache.size > 20000) cache.clear(); cache.set(key, w); }
    return w;
  };
  const tw = (n, text, bold) => widthOf(text, px(n), fam(n), bold);

  /** Break text into lines no wider than maxW. A word wider than the line is broken between characters. */
  function wrap(n, text, maxW) {
    const lines = []; let line = '';
    for (const word of text.split(' ')) {
      const test = line ? line + ' ' + word : word;
      if (tw(n, test) <= maxW || !line && tw(n, word) <= maxW) { line = test; continue; }
      if (line) { lines.push(line); line = ''; }
      if (tw(n, word) <= maxW) { line = word; continue; }
      let part = '';
      for (const ch of word) {
        if (part && tw(n, part + ch) > maxW) { lines.push(part); part = ch; } else part += ch;
      }
      line = part;
    }
    if (line || !lines.length) lines.push(line);
    return lines;
  }
  const longestWord = (n, text) => text.split(' ').reduce((m, w) => Math.max(m, tw(n, w)), 0);
  const shown = n => shownText(n, st);
  const cellsOf = n => shown(n).split('|').map(s => s.trim());
  const imgSize = n => (env.image && env.image(n.url)) || null;

  // ── intrinsic widths: [min-content, max-content] ──
  function widths(n) {
    if (n._wd) return n._wd;
    const f = px(n), k = n.children ? flow(n) : null, p = n.props;
    let mn, mx;
    switch (n.type) {
      case 'txt': case 'lnk': { const t = shown(n); mx = tw(n, t) + 4; mn = Math.min(mx, Math.max(longestWord(n, t), f) + 4); break; }
      case 'btn': mn = mx = tw(n, shown(n)) + 24; break;
      case 'inp': mn = 80; mx = 200; break;
      case 'tog': mn = mx = 44; break;
      case 'prg': mn = 40; mx = 120; break;
      case 'img': { const s = imgSize(n); mn = Math.min(64, s ? s.w : 64); mx = s ? s.w : 64; break; }
      case 'sel': mn = mx = n.opts.reduce((m, o) => Math.max(m, tw(n, o)), 0) + 40; break;
      case 'chk': mn = mx = 22 + tw(n, shown(n)) + 6; break;
      case 'sld': mn = 60; mx = 120; break;
      case 'div': mn = mx = 10; break;
      case 'spn': mn = mx = 24; break;
      case 'avt': mn = mx = 40; break;
      case 'bdg': mn = mx = tw(n, shown(n)) + 16; break;
      case 'rat': mn = mx = n.max * 20; break;
      case 'ico': mn = mx = f + 4; break;
      case 'tmr': mn = mx = 0; break;
      case 'row': {
        mn = mx = Math.max(0, k.length - 1) * p.gap;
        for (const c of k) { const fx = resolve(mainFixed(c, true), null), w = widths(c); mn += fx != null ? fx : w[0]; mx += fx != null ? fx : w[1]; }
        break;
      }
      case 'grid': {
        const gap = p.gap || 4; let a = 0, b = 0;
        for (const c of k) { const w = widths(c); a = Math.max(a, w[0]); b = Math.max(b, w[1]); }
        mn = a * n.cols + gap * (n.cols - 1); mx = b * n.cols + gap * (n.cols - 1);
        break;
      }
      case 'tbl': {
        mn = mx = 0;
        for (const r of k) { const cells = cellsOf(r); mx = Math.max(mx, cells.length * (Math.max(...cells.map(c => tw(n, c, true))) + 12)); mn = Math.max(mn, cells.length * 40); }
        break;
      }
      default: { // col, box, scl, lst, acc, tab, dlg
        mn = mx = 0;
        for (const c of n.type === 'tab' ? k.slice(n.sel, n.sel + 1) : k) {
          const fx = resolve(c.props.w, null), w = widths(c);
          mn = Math.max(mn, fx != null ? fx : w[0]); mx = Math.max(mx, fx != null ? fx : w[1]);
        }
        if (n.type === 'lst') { mn += LIST_NUM_W; mx += LIST_NUM_W; }
        if (n.type === 'scl') { mn += SCROLLBAR_W; mx += SCROLLBAR_W; }
        if (n.type === 'acc') { const h = tw(n, shown(n), true) + 30; mn = Math.max(mn, h); mx = Math.max(mx, h); }
        if (n.type === 'tab') { const h = n.tabs.reduce((s, t) => s + tw(n, t) + 24, 0); mn = Math.max(mn, h); mx = Math.max(mx, h); }
      }
    }
    if (n.children && n.type !== 'tbl') { mn += p.pad * 2; mx += p.pad * 2; }
    const lo = resolve(p.minw, null), hi = resolve(p.maxw, null);
    return (n._wd = [clamp(mn, lo, hi), clamp(mx, lo, hi)]);
  }
  /** The fixed size a child asks for along its parent's main axis (number, {pct} or null). */
  function mainFixed(c, inRow) {
    const own = inRow ? c.props.w : c.props.h;
    return own != null ? own : (c.type === 'box' || c.type === 'scl') ? c.props.size : null;
  }

  /**
   * Widths of a row's children inside innerW: fixed sizes first, then the rest share by grow, never below
   * min-content. grow defaults to 1 (equal shares); in a row with `just` it defaults to 0 (natural widths),
   * because only spare width can be justified.
   */
  function rowWidths(n, k, innerW) {
    const gap = n.props.gap, out = new Array(k.length), flex = [];
    let avail = innerW - Math.max(0, k.length - 1) * gap;
    k.forEach((c, i) => {
      const w = widths(c), lo = Math.max(w[0], resolve(c.props.minw, innerW) || 0), hi = resolve(c.props.maxw, innerW);
      const fx = resolve(mainFixed(c, true), innerW), grow = c.props.grow != null ? c.props.grow : n.props.just ? 0 : 1;
      if (fx != null) { out[i] = clamp(fx, resolve(c.props.minw, innerW), hi); avail -= out[i]; }
      else if (grow === 0) { out[i] = clamp(w[1], lo, hi); avail -= out[i]; }
      else flex.push({ i, grow, lo, hi });
    });
    // freeze children whose share would break their min or max, then share what is left again
    for (let live = flex.slice(); live.length;) {
      const total = live.reduce((s, f) => s + f.grow, 0);
      const broke = live.filter(f => { const share = Math.max(0, avail) * f.grow / total; return share < f.lo || (f.hi != null && share > f.hi); });
      if (!broke.length) { for (const f of live) out[f.i] = Math.max(0, avail) * f.grow / total; break; }
      const under = broke.filter(f => Math.max(0, avail) * f.grow / total < f.lo);
      for (const f of under.length ? under : broke) { out[f.i] = under.length ? f.lo : f.hi; avail -= out[f.i]; live.splice(live.indexOf(f), 1); }
    }
    return out;
  }

  const textH = (n, lines) => (lines - 1) * (px(n) + 3) + px(n) + 4;
  const tblRowH = n => px(n) + 12;
  const accHeadH = n => Math.max(24, px(n) + 10);
  /** Width a column-like container gives a child. */
  function colChildW(n, c, innerW) {
    const fx = resolve(c.props.w, innerW), stretch = (n.props.align || 'stretch') === 'stretch';
    const w = fx != null ? fx : stretch ? innerW : Math.min(innerW, widths(c)[1]);
    return clamp(w, resolve(c.props.minw, innerW), resolve(c.props.maxw, innerW));
  }
  const innerWOf = (n, w) => Math.max(0, w - n.props.pad * 2 - (n.type === 'scl' ? SCROLLBAR_W : 0) - (n.type === 'lst' ? LIST_NUM_W : 0));

  /** Natural height of a node at a given width. */
  function heightFor(n, w) {
    const key = Math.round(w * 100);
    if (n._hk === key) return n._hv;
    const f = px(n), p = n.props;
    let h;
    switch (n.type) {
      case 'txt': case 'lnk': h = textH(n, wrap(n, shown(n), Math.max(1, w - 4)).length); break;
      case 'btn': case 'inp': case 'sel': h = f + 16; break;
      case 'tog': case 'sld': case 'spn': h = 24; break;
      case 'prg': h = 16; break;
      case 'img': { const s = imgSize(n); h = s && s.w ? Math.min(w, s.w) * s.h / s.w : 64; break; }
      case 'chk': h = Math.max(20, f + 4); break;
      case 'div': h = 9; break;
      case 'avt': h = 40; break;
      case 'bdg': h = f + 10; break;
      case 'rat': h = 20; break;
      case 'ico': h = f + 4; break;
      case 'tmr': h = 0; break;
      case 'tbl': h = flow(n).length * tblRowH(n); break;
      case 'row': {
        const k = flow(n), iw = innerWOf(n, w), ws = rowWidths(n, k, iw);
        h = 0; k.forEach((c, i) => { h = Math.max(h, childH(c, ws[i], null)); });
        h += p.pad * 2; break;
      }
      case 'grid': {
        const k = flow(n), gap = p.gap || 4, iw = innerWOf(n, w), cw = (iw - gap * (n.cols - 1)) / n.cols;
        h = p.pad * 2;
        for (let r = 0; r * n.cols < k.length; r++) {
          let rh = 0; for (const c of k.slice(r * n.cols, (r + 1) * n.cols)) rh = Math.max(rh, childH(c, cw, null));
          h += rh + (r ? gap : 0);
        }
        break;
      }
      default: { // col, box, scl, lst, acc, tab
        const iw = innerWOf(n, w);
        let k = flow(n);
        if (n.type === 'tab') k = k.slice(n.sel, n.sel + 1);
        if (n.type === 'acc' && !n.open) k = [];
        h = p.pad * 2 + Math.max(0, k.length - 1) * p.gap;
        for (const c of k) h += childH(c, colChildW(n, c, iw), null);
        if (n.type === 'tab') h += TAB_H;
        if (n.type === 'acc') h += accHeadH(n);
      }
    }
    n._hk = key; n._hv = h;
    return h;
  }
  /** Height of a child in a column-like parent: its fixed size if it has one, else natural, within min / max. */
  function childH(c, w, parentInnerH) {
    const fx = resolve(mainFixedCol(c), parentInnerH);
    return clamp(fx != null ? fx : heightFor(c, w), resolve(c.props.minh, parentInnerH), resolve(c.props.maxh, parentInnerH));
  }
  /** h always applies; a box / scl size applies along the parent's main axis, so only in column-like parents. */
  function mainFixedCol(c) { return c.props.h != null ? c.props.h : (c._inRow ? null : mainFixed(c, false)); }

  function place(n, x, y, w, h) {
    n.x = x; n.y = y; n.w = w; n.h = h;
    if (n.type === 'txt' || n.type === 'lnk') { n.lines = wrap(n, shown(n), Math.max(1, w - 4)); return; }
    if (!n.children) return;
    const p = n.props, pad = p.pad, k = flow(n), iw = innerWOf(n, w), ih = Math.max(0, h - pad * 2);
    const ix = x + pad + (n.type === 'lst' ? LIST_NUM_W : 0), iy = y + pad;
    if (n.type === 'tbl') { const rh = tblRowH(n); k.forEach((c, i) => { c.x = x; c.y = y + i * rh; c.w = w; c.h = rh; c.cells = cellsOf(c); }); return; }
    if (n.type === 'row') {
      const ws = rowWidths(n, k, iw), align = p.align || 'stretch';
      const used = ws.reduce((s, v) => s + v, 0) + Math.max(0, k.length - 1) * p.gap, spare = Math.max(0, iw - used);
      let cx = ix + (p.just === 'center' ? spare / 2 : p.just === 'end' ? spare : 0);
      const between = p.just === 'between' && k.length > 1 ? spare / (k.length - 1) : 0;
      k.forEach((c, i) => {
        const fx = resolve(c.props.h, ih);
        let ch = fx != null ? fx : align === 'stretch' ? ih : Math.min(ih, heightFor(c, ws[i]));
        ch = clamp(ch, resolve(c.props.minh, ih), resolve(c.props.maxh, ih));
        const cy = iy + (align === 'center' ? (ih - ch) / 2 : align === 'end' ? ih - ch : 0);
        place(c, cx, cy, ws[i], ch);
        cx += ws[i] + p.gap + between;
      });
      return;
    }
    if (n.type === 'grid') {
      const gap = p.gap || 4, cw = (iw - gap * (n.cols - 1)) / n.cols;
      let cy = iy;
      for (let r = 0; r * n.cols < k.length; r++) {
        const cells = k.slice(r * n.cols, (r + 1) * n.cols);
        const rh = cells.reduce((m, c) => Math.max(m, childH(c, cw, null)), 0);
        cells.forEach((c, i) => place(c, ix + i * (cw + gap), cy, cw, rh));
        cy += rh + gap;
      }
      return;
    }
    // column-like: col, box, scl, lst, acc, tab
    let kids = k, top = iy;
    if (n.type === 'tab') { kids = k.slice(n.sel, n.sel + 1); top += TAB_H; for (const c of k) if (kids.indexOf(c) < 0) hide(c); }
    if (n.type === 'acc') { top += accHeadH(n); if (!n.open) { kids = []; for (const c of k) hide(c); } }
    const availH = n.type === 'tab' ? ih - TAB_H : n.type === 'acc' ? ih - accHeadH(n) : ih;
    const hs = kids.map(c => childH(c, colChildW(n, c, iw), n.type === 'scl' ? null : availH));
    const used = hs.reduce((s, v) => s + v, 0) + Math.max(0, kids.length - 1) * p.gap;
    let spare = n.type === 'scl' ? 0 : Math.max(0, availH - used);
    const growSum = kids.reduce((s, c) => s + (c.props.grow || 0), 0);
    if (spare > 0 && growSum > 0) { kids.forEach((c, i) => { hs[i] += spare * (c.props.grow || 0) / growSum; }); spare = 0; }
    let cy = top + (p.just === 'center' ? spare / 2 : p.just === 'end' ? spare : 0);
    const between = p.just === 'between' && kids.length > 1 ? spare / (kids.length - 1) : 0;
    const align = p.align || 'stretch';
    kids.forEach((c, i) => {
      const cw = colChildW(n, c, iw);
      const cx = ix + (align === 'center' ? (iw - cw) / 2 : align === 'end' ? iw - cw : 0);
      place(c, cx, cy, cw, hs[i]);
      cy += hs[i] + p.gap + between;
    });
    if (n.type === 'scl') {
      n.contentH = used + pad * 2;
      n.maxScroll = Math.max(0, n.contentH - h);
      n.scrollY = Math.max(0, Math.min(n.scrollY || 0, n.maxScroll));
    }
  }
  /** A node that is not shown (a closed accordion's body, an unselected tab panel). */
  function hide(n) { n.x = n.y = n.w = n.h = 0; n.hidden = true; if (n.children) for (const c of n.children) hide(c); }

  // reset what the last layout left, and mark children of rows (a box size is a width there)
  // (an element a script switched off, and everything inside it, is hidden and takes no room)
  (function reset(n, inRow, off) {
    n._wd = null; n._hk = null; n.hidden = off = off || !!n.off; n._inRow = inRow;
    if (off) n.x = n.y = n.w = n.h = 0;
    if (n.children) for (const c of n.children) reset(c, n.type === 'row', off);
  })(page.root, false, false);

  const rootNode = page.root;
  page.vw = vw; page.vh = vh;
  page.contentH = heightFor(rootNode, vw);
  place(rootNode, 0, 0, vw, Math.max(vh, page.contentH));
  page.maxScroll = Math.max(0, page.contentH - vh);
  page.scrollY = Math.max(0, Math.min(page.scrollY || 0, page.maxScroll));

  // open dialogs sit over the viewport, outside the flow
  page.dialogs = [];
  (function findDialogs(n) {
    if (!n.children || n.hidden) return;
    for (const c of n.children) {
      if (c.hidden) continue;
      if (c.type === 'dlg') {
        if (!c.open) { hide(c); continue; }
        const dw = Math.max(120, Math.min(vw - 32, 320)), iw = dw - 24, kids = flow(c), gap = c.props.gap || 4;
        let dh = 38 + 12;
        const hs = kids.map(k => { const kh = childH(k, iw, null); dh += kh + gap; return kh; });
        dh = Math.min(dh, Math.max(80, vh - 32));
        c.x = (vw - dw) / 2; c.y = Math.max(16, (vh - dh) / 2); c.w = dw; c.h = dh;
        let cy = c.y + 38;
        kids.forEach((k, i) => { place(k, c.x + 12, cy, iw, hs[i]); cy += hs[i] + gap; });
        page.dialogs.push(c);
      } else findDialogs(c);
    }
  })(rootNode);
  return page;
}

/** A compact text picture of a laid-out page, for tests: one line per node, indented. */
function dump(page) {
  const out = [];
  (function walk(n, depth) {
    if (n.hidden) return;
    let line = '  '.repeat(depth) + n.type + ' ' + [n.x, n.y, n.w, n.h].map(v => Math.round(v * 10) / 10).join(' ');
    if (n.lines) line += ' | ' + n.lines.join(' / ');
    out.push(line);
    if (n.children) for (const c of n.children) walk(c, depth + 1);
  })(page.root, 0);
  out.push('content ' + Math.round(page.contentH * 10) / 10 + ' scroll ' + Math.round(page.maxScroll * 10) / 10);
  return out.join('\n');
}

// ════════════════════════════════════════════ paint ════════════════════════════════════════════

const EMOJI = { heart: '❤️', star: '⭐', fire: '🔥', check: '✅', warn: '⚠️', info: 'ℹ️', mail: '📧', home: '🏠', gear: '⚙️', user: '👤',
  search: '🔍', lock: '🔒', bell: '🔔', pin: '📌', edit: '✏️', trash: '🗑️', plus: '➕', minus: '➖', up: '⬆️', down: '⬇️', left: '⬅️',
  right: '➡️', sun: '☀️', moon: '🌙', cloud: '☁️', bolt: '⚡', music: '🎵', cam: '📷', vid: '🎬', code: '💻', bug: '🐛', ok: '👍', no: '👎',
  smile: '😊', sad: '😢', rage: '😡', skull: '💀', bomb: '💣', gem: '💎', cup: '🏆', flag: '🏁', clock: '🕐', link: '🔗', key: '🔑',
  eye: '👁️', rocket: '🚀' };
const css = (c, a) => a != null && a < 1 ? `rgba(${c[0]},${c[1]},${c[2]},${a})` : `rgb(${c[0]},${c[1]},${c[2]})`;
const scale = (c, f) => [c[0] * f | 0, c[1] * f | 0, c[2] * f | 0];
const shift = (c, d) => c.map(v => Math.max(0, Math.min(255, v + d)));

/**
 * Paint a laid-out page. X is a 2D context already scaled so that one unit is one CSS pixel.
 * opts: state, font (default family), image(url) → drawable or null, spin (spinner angle).
 * Returns { hits, scrolls, spinning }: hits are clickable regions in viewport coordinates, in paint order,
 * each already cut to what is visible; scrolls are the scroll containers under the same rule.
 */
function paint(X, page, opts) {
  const st = opts.state, defFont = opts.font || DEFAULT_FONT;
  const hits = [], scrolls = [];
  let spinning = false, dy = 0, clip = { x0: 0, y0: 0, x1: page.vw, y1: page.vh };
  const font = (n, bold, size) => { X.font = (bold ? 'bold ' : '') + (size || px(n)) + 'px ' + JSON.stringify(n.props.fontFamily || defFont) + ', monospace'; };
  const hit = (n, x, y, w, h, extra) => {
    const r = { n, x0: Math.max(x, clip.x0), y0: Math.max(y + dy, clip.y0), x1: Math.min(x + w, clip.x1), y1: Math.min(y + h + dy, clip.y1) };
    if (r.x1 > r.x0 && r.y1 > r.y0) hits.push(Object.assign(r, extra));
  };
  const rr = (x, y, w, h, r) => { X.beginPath(); if (X.roundRect) X.roundRect(x, y, w, h, r); else X.rect(x, y, w, h); };
  function clipped(x, y, w, h, body) {
    const saved = clip;
    clip = { x0: Math.max(x, clip.x0), y0: Math.max(y + dy, clip.y0), x1: Math.min(x + w, clip.x1), y1: Math.min(y + h + dy, clip.y1) };
    X.save(); X.beginPath(); X.rect(x, y, w, h); X.clip();
    if (clip.x1 > clip.x0 && clip.y1 > clip.y0) body();
    X.restore(); clip = saved;
  }
  function kids(n) { for (const c of n.children) if (c.type !== 'dlg') node(c); }

  function node(n) {
    if (n.hidden || n.type === 'tmr') return;
    if (n.y + dy > clip.y1 || n.y + n.h + dy < clip.y0) return;   // not on screen
    const p = n.props, x = n.x, y = n.y, w = n.w, h = n.h, f = px(n);
    if (p.bg && n.type !== 'btn' && n.type !== 'bdg') { X.fillStyle = css(p.bg, p.bgA); X.fillRect(x, y, w, h); }
    if (p.brd && n.type !== 'inp' && n.type !== 'sel') { X.strokeStyle = css(p.brd); X.lineWidth = 1; X.strokeRect(x + .5, y + .5, w - 1, h - 1); }
    X.textAlign = 'left';
    switch (n.type) {
      case 'txt': case 'lnk': {
        const fg = p.fg || (n.type === 'lnk' ? [80, 180, 255] : [187, 221, 255]), c = n.type === 'lnk' ? [80, 180, 255] : fg;
        font(n); X.fillStyle = css(c); X.textBaseline = 'top';
        n.lines.forEach((line, i) => {
          const ly = y + 2 + i * (f + 3);
          X.fillText(line, x + 2, ly);
          if (n.type === 'lnk') X.fillRect(x + 2, ly + f, X.measureText(line).width, 1);
        });
        if (n.type === 'lnk') hit(n, x, y, w, h);
        break;
      }
      case 'btn': {
        const bg = p.bg || [40, 55, 85], fg = p.fg || [204, 221, 238];
        X.fillStyle = css(bg); X.fillRect(x, y, w, h);
        X.fillStyle = css(shift(bg, 25)); X.fillRect(x, y, w, 2); X.fillRect(x, y, 2, h);
        X.fillStyle = css(shift(bg, -15)); X.fillRect(x, y + h - 2, w, 2); X.fillRect(x + w - 2, y, 2, h);
        font(n); X.fillStyle = css(fg); X.textBaseline = 'middle'; X.textAlign = 'center';
        X.fillText(shownText(n, st), x + w / 2, y + h / 2); X.textAlign = 'left';
        hit(n, x, y, w, h);
        break;
      }
      case 'inp': {
        const v = st.inputs[n.id] || '', on = st.activeInput === n.id, bg = p.bg || [10, 16, 30];
        X.fillStyle = css(on ? [bg[0] + 5, bg[1] + 6, bg[2] + 10] : bg); X.fillRect(x, y, w, h);
        const brd = p.brd || p.fg || [30, 45, 70];
        X.strokeStyle = css(on ? [Math.min(255, brd[0] + 30), Math.min(255, brd[1] + 55), Math.min(255, brd[2] + 90)] : brd);
        X.lineWidth = 1; X.strokeRect(x + .5, y + .5, w - 1, h - 1);
        font(n); const fg = p.fg || [200, 220, 255];
        clipped(x + 1, y + 1, w - 2, h - 2, () => {
          X.fillStyle = v ? css(fg) : 'rgb(60,80,100)'; X.textBaseline = 'middle';
          const vw = X.measureText(v).width, off = Math.min(0, w - 20 - vw);   // keep the caret in view
          X.fillText(v || (on ? '' : 'type here...'), x + 8 + off, y + h / 2);
          if (on) { X.fillStyle = css(fg); X.fillRect(x + 8 + off + vw + 1, y + 4, 2, h - 8); }
        });
        hit(n, x, y, w, h);
        break;
      }
      case 'tog': {
        const on = !!st.togs[n.id], fg = p.fg || [80, 200, 130], tw = 40, th = 22, tx = x + w - tw - 2, ty = y + (h - th) / 2;
        X.fillStyle = on ? css(scale(fg, .5)) : 'rgb(30,35,50)'; rr(tx, ty, tw, th, th / 2); X.fill();
        X.fillStyle = on ? css(fg) : 'rgb(70,80,100)';
        X.beginPath(); X.arc((on ? tx + tw - th + 2 : tx + 2) + th / 2 - 2, ty + th / 2, th / 2 - 3, 0, Math.PI * 2); X.fill();
        hit(n, tx, ty, tw, th);
        break;
      }
      case 'prg': {
        const key = String(n.val).toLowerCase(), val = key in st.vars ? num(st.vars[key]) : parseFloat(n.val) || 0;
        const max = parseFloat(n.max) || 100, pct = Math.max(0, Math.min(1, val / max)), bh = Math.min(h, 14), by = y + (h - bh) / 2;
        X.fillStyle = css(p.bg || [20, 30, 50]); rr(x, by, w, bh, bh / 2); X.fill();
        if (pct > 0) { X.fillStyle = css(p.fg || [60, 160, 220]); rr(x, by, Math.max(bh, w * pct), bh, bh / 2); X.fill(); }
        break;
      }
      case 'img': {
        const im = opts.image && opts.image(n.url);
        if (im) {
          const ar = im.width / im.height; let dw = w, dh = w / ar; if (dh > h) { dh = h; dw = h * ar; }
          X.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
        } else {
          X.fillStyle = css(p.bg || [20, 30, 50]); X.fillRect(x, y, w, h);
          font(n, false, 11); X.fillStyle = css(p.fg || [60, 80, 100]); X.textBaseline = 'middle'; X.textAlign = 'center';
          X.fillText('image', x + w / 2, y + h / 2); X.textAlign = 'left';
        }
        break;
      }
      case 'sel': {
        X.fillStyle = css(p.bg || [15, 22, 40]); X.fillRect(x, y, w, h);
        X.strokeStyle = css(p.brd || [30, 50, 80]); X.lineWidth = 1; X.strokeRect(x + .5, y + .5, w - 1, h - 1);
        font(n); X.fillStyle = css(p.fg || [187, 221, 255]); X.textBaseline = 'middle';
        X.fillText(n.opts[st.sels[n.id] || 0] || '', x + 8, y + h / 2); X.fillText('▾', x + w - 18, y + h / 2);
        hit(n, x, y, w, h);
        break;
      }
      case 'chk': {
        const on = !!st.chks[n.id], fg = p.fg || [187, 221, 255], sz = 16, bx = x + 2, by = y + (h - sz) / 2;
        X.fillStyle = on ? css(scale(fg, .5)) : 'rgb(20,30,50)'; rr(bx, by, sz, sz, 3); X.fill();
        X.strokeStyle = css(scale(fg, .25)); X.lineWidth = 1; X.strokeRect(bx + .5, by + .5, sz - 1, sz - 1);
        if (on) { X.strokeStyle = '#fff'; X.lineWidth = 2; X.beginPath(); X.moveTo(bx + 3, by + sz / 2); X.lineTo(bx + sz / 2 - 1, by + sz - 4); X.lineTo(bx + sz - 3, by + 3); X.stroke(); }
        font(n); X.fillStyle = css(fg); X.textBaseline = 'middle'; X.fillText(shownText(n, st), x + 24, y + h / 2);
        hit(n, x, y, w, h);
        break;
      }
      case 'sld': {
        const val = st.slds[n.id] !== undefined ? st.slds[n.id] : (n.min + n.max) / 2, pct = (val - n.min) / (n.max - n.min);
        const fg = p.fg || [60, 160, 220], ty = y + h / 2;
        X.fillStyle = 'rgb(20,30,50)'; rr(x + 8, ty - 2, w - 16, 4, 2); X.fill();
        X.fillStyle = css(fg); rr(x + 8, ty - 2, (w - 16) * pct, 4, 2); X.fill();
        const tx = x + 8 + (w - 16) * pct;
        X.fillStyle = css([Math.min(255, fg[0] + 120), Math.min(255, fg[1] + 50), Math.min(255, fg[2] + 20)]); X.beginPath(); X.arc(tx, ty, 7, 0, Math.PI * 2); X.fill();
        X.fillStyle = css(fg); X.beginPath(); X.arc(tx, ty, 5, 0, Math.PI * 2); X.fill();
        hit(n, x, y, w, h);
        break;
      }
      case 'div': X.fillStyle = css(p.fg || [40, 55, 80]); X.fillRect(x + 4, y + Math.floor(h / 2), w - 8, 1); break;
      case 'spn': {
        const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) / 2 - 2, fg = p.fg || [60, 160, 220], a = opts.spin || 0;
        X.lineWidth = 3; X.strokeStyle = css(scale(fg, 1 / 3)); X.beginPath(); X.arc(cx, cy, r, 0, Math.PI * 2); X.stroke();
        X.strokeStyle = css(fg); X.lineCap = 'round'; X.beginPath(); X.arc(cx, cy, r, a, a + Math.PI * 1.2); X.stroke(); X.lineCap = 'butt';
        spinning = true;
        break;
      }
      case 'tbl': {
        const fg = p.fg || [187, 221, 255];
        flow(n).forEach((row, ri) => {
          const cells = row.cells || [], cw = w / Math.max(1, cells.length);
          if (ri > 0) { X.fillStyle = css(scale(fg, 1 / 6)); X.fillRect(x, row.y, w, 1); }
          X.fillStyle = css(ri === 0 ? fg : scale(fg, .7)); X.textBaseline = 'middle'; font(n, ri === 0);
          cells.forEach((cell, ci) => clipped(x + ci * cw, row.y, cw, row.h, () => X.fillText(cell, x + ci * cw + 6, row.y + row.h / 2)));
        });
        break;
      }
      case 'lst': {
        const fg = p.fg || [187, 221, 255];
        flow(n).forEach((c, i) => {
          font(c); X.fillStyle = css(scale(fg, .5)); X.textBaseline = 'top'; X.textAlign = 'left';
          X.fillText((i + 1) + '.', x + p.pad, c.y + 2);
          node(c);
        });
        break;
      }
      case 'acc': {
        const fg = p.fg || [187, 221, 255], bg = p.bg || [25, 35, 55], hh = Math.max(24, f + 10);
        X.fillStyle = css(shift(bg, 10)); X.fillRect(x, y, w, hh);
        X.fillStyle = css(fg); font(n, true); X.textBaseline = 'middle';
        X.fillText((n.open ? '▾ ' : '▸ ') + shownText(n, st), x + 8, y + hh / 2);
        hit(n, x, y, w, hh);
        if (n.open) kids(n);
        break;
      }
      case 'tab': {
        const fg = p.fg || [187, 221, 255], tw = w / Math.max(1, n.tabs.length);
        font(n);
        n.tabs.forEach((label, i) => {
          const on = i === n.sel;
          X.fillStyle = on ? css(scale(fg, .2)) : 'rgba(0,0,0,0.2)'; X.fillRect(x + i * tw, y, tw, TAB_H);
          X.fillStyle = css(on ? fg : scale(fg, .5)); X.textBaseline = 'middle'; X.textAlign = 'center';
          X.fillText(label, x + i * tw + tw / 2, y + TAB_H / 2); X.textAlign = 'left';
          if (on) X.fillRect(x + i * tw, y + TAB_H - 2, tw, 2);
        });
        hit(n, x, y, w, TAB_H);
        kids(n);
        break;
      }
      case 'avt': {
        const r = Math.min(w, h) / 2 - 2, cx = x + w / 2, cy = y + h / 2, im = opts.image && opts.image(n.url);
        X.save(); X.beginPath(); X.arc(cx, cy, r, 0, Math.PI * 2); X.clip();
        if (im) X.drawImage(im, cx - r, cy - r, r * 2, r * 2); else { X.fillStyle = 'rgb(40,60,90)'; X.fill(); }
        X.restore();
        X.strokeStyle = 'rgb(60,90,130)'; X.lineWidth = 2; X.beginPath(); X.arc(cx, cy, r, 0, Math.PI * 2); X.stroke();
        break;
      }
      case 'bdg': {
        const text = shownText(n, st); font(n);
        const bw = X.measureText(text).width + 12;
        X.fillStyle = css(p.bg || [60, 120, 200]); rr(x, y + (h - f - 8) / 2, bw, f + 8, (f + 8) / 2); X.fill();
        X.fillStyle = css(p.fg || [255, 255, 255]); X.textBaseline = 'middle'; X.textAlign = 'center';
        X.fillText(text, x + bw / 2, y + h / 2); X.textAlign = 'left';
        break;
      }
      case 'rat': {
        const fg = p.fg || [255, 200, 60], val = num(st.vars['rat' + n.id] || 0);
        X.font = '16px serif'; X.textBaseline = 'top';
        for (let i = 0; i < n.max; i++) { X.fillStyle = i < val ? css(fg) : 'rgb(40,45,60)'; X.fillText('★', x + i * 20 + 2, y + (h - 16) / 2); }
        hit(n, x, y, n.max * 20, h);
        break;
      }
      case 'ico': X.font = f + 'px serif'; X.textBaseline = 'top'; X.fillStyle = css(p.fg || [187, 221, 255]); X.fillText(EMOJI[n.name] || n.name, x, y + 2); break;
      case 'scl': {
        const sy = n.scrollY || 0;
        scrolls.push({ n, x0: Math.max(x, clip.x0), y0: Math.max(y + dy, clip.y0), x1: Math.min(x + w, clip.x1), y1: Math.min(y + h + dy, clip.y1) });
        clipped(x, y, w, h, () => { X.translate(0, -sy); dy -= sy; kids(n); dy += sy; });
        if (n.maxScroll > 0) scrollbar(x + w - 6, y, h, n.contentH, sy, n.maxScroll);
        break;
      }
      default: if (n.children) kids(n);   // row, col, box, grid
    }
  }
  function scrollbar(bx, y, h, contentH, sy, max) {
    const barH = Math.max(20, h * (h / contentH)), barY = y + (h - barH) * (sy / max);
    X.fillStyle = 'rgba(60,90,130,0.4)'; rr(bx, y, 5, h, 2.5); X.fill();
    X.fillStyle = 'rgba(100,160,220,0.6)'; rr(bx, barY, 5, barH, 2.5); X.fill();
  }

  const rootNode = page.root;
  X.fillStyle = css(rootNode.props.bg || [6, 14, 26]); X.fillRect(0, 0, page.vw, page.vh);
  X.save(); X.translate(0, -page.scrollY); dy = -page.scrollY;
  node(rootNode);
  X.restore(); dy = 0;
  if (page.maxScroll > 0) scrollbar(page.vw - 6, 0, page.vh, page.contentH, page.scrollY, page.maxScroll);

  // dialogs: over everything, and while one is open only it takes clicks
  let modalFrom = -1;
  for (const d of page.dialogs || []) {
    const fg = d.props.fg || [220, 230, 255];
    X.fillStyle = 'rgba(0,0,0,0.5)'; X.fillRect(0, 0, page.vw, page.vh);
    if (modalFrom < 0) modalFrom = hits.length;
    X.fillStyle = 'rgb(20,30,50)'; X.fillRect(d.x, d.y, d.w, d.h);
    X.strokeStyle = 'rgb(40,60,90)'; X.lineWidth = 1; X.strokeRect(d.x + .5, d.y + .5, d.w - 1, d.h - 1);
    font(d, true); X.fillStyle = css(fg); X.textBaseline = 'top'; X.textAlign = 'left';
    X.fillText(shownText(d, st) || 'Dialog', d.x + 12, d.y + 10);
    X.fillStyle = 'rgb(60,80,100)'; X.fillRect(d.x + 10, d.y + 30, d.w - 20, 1);
    X.fillStyle = 'rgb(150,60,60)'; X.font = '14px serif'; X.fillText('✕', d.x + d.w - 24, d.y + 6);
    hit(d, d.x + d.w - 30, d.y, 30, 30, { close: true });
    clipped(d.x, d.y + 32, d.w, d.h - 33, () => kids(d));
  }
  return { hits, scrolls, spinning, modalFrom };
}

// ════════════════════════════════════════════ scripts ════════════════════════════════════════════

/**
 * The script of a page, if it has one, in a Mote VM of its own. The script sees two tables, `page` and
 * `store`, and nothing else of the host: every call it can make is one of the functions below, and each
 * checks its arguments. Element handles are host objects with a fixed list of fields.
 * hooks: log(kind, text), changed(), navigate(address), title(text), setTimer(fn, ms, repeat) → id,
 * clearTimer(id), fetch(address, done(status, text)), storage() → { get, set, remove, keys } or null.
 * A handler that runs out of steps or memory ends with an error in the log; the page goes on.
 */
function createRuntime(page, st, hooks, Mote) {
  const rt = { vm: null, dead: false, handlers: Object.create(null), handlerCount: 0, timers: new Map(), requests: 0, nextTimer: 1 };
  const log = (kind, text) => { if (hooks.log) hooks.log(kind, String(text).slice(0, 500)); };
  /** Call into the script. Returns false when the call was stopped by a limit. */
  function enter(fn, args) {
    if (rt.dead) return true;
    try { fn.apply(null, args); return true; }
    catch (e) { log('error', (e && e.message) || e); return !(e && e.kind === 'limit'); }
    finally { if (hooks.changed) hooks.changed(); }
  }
  rt.dispatch = (n, event, value) => {
    if (rt.dead || !n.name) return;
    const list = rt.handlers[n.name + ' ' + event];
    if (list) for (const fn of list.slice()) enter(fn, [value, handle(n)]);
  };
  rt.stop = () => { rt.dead = true; for (const t of rt.timers.values()) hooks.clearTimer(t); rt.timers.clear(); };
  if (!page.script) return rt;
  if (!Mote) { log('error', 'this page has a script, and the script engine is not loaded'); return rt; }

  const vm = rt.vm = Mote.create({ print: s => log('print', s), maxSteps: LIMITS.steps, maxMemory: LIMITS.memory });
  const touch = () => { if (hooks.changed) hooks.changed(); };
  const text = v => {
    if (typeof v === 'number') v = fmt(v); else if (typeof v === 'boolean') v = String(v);
    if (typeof v !== 'string') throw new Error('expected text or a number');
    return v.replace(/[\r\n]+/g, ' ').slice(0, LIMITS.text);
  };
  const number = v => { if (typeof v !== 'number' || isNaN(v)) throw new Error('expected a number'); return v; };
  const nameOf = v => { const s = typeof v === 'string' ? v.toLowerCase() : ''; if (!NAME.test(s)) throw new Error('expected a name'); return s; };
  const node = v => { const n = page.names[nameOf(v)]; if (!n) throw new Error('no element is called "' + v + '"'); return n; };
  const callback = fn => { if (typeof fn !== 'function') throw new Error('expected a function'); return fn; };

  // ── element handles ──
  const handles = new WeakMap();
  function handle(n) {
    let h = handles.get(n);
    if (!h) { h = vm.ref(facade(n), { allow: EL_KEYS }); handles.set(n, h); }
    return h;
  }
  function facade(n) {
    const f = {}, no = what => { throw new Error('a ' + n.type + ' has no ' + what); };
    const def = (key, get, set) => Object.defineProperty(f, key, { enumerable: true, get, set: set || (() => { throw new Error(key + ' cannot be changed'); }) });
    const textKey = n.type === 'btn' || n.type === 'chk' ? 'label' : n.type === 'acc' || n.type === 'dlg' ? 'title' : 'text' in n ? 'text' : null;
    def('name', () => n.name || '');
    def('kind', () => n.type);
    def('text', () => textKey ? n[textKey] : '', v => { if (!textKey) no('text'); n[textKey] = text(v); n.raw = true; touch(); });
    def('value', () => {
      switch (n.type) {
        case 'inp': return st.inputs[n.id] || '';
        case 'sld': return st.slds[n.id] !== undefined ? st.slds[n.id] : (n.min + n.max) / 2;
        case 'sel': return (st.sels[n.id] || 0) + 1;
        case 'rat': return num(st.vars['rat' + n.id] || 0);
        case 'prg': { const k = String(n.val).toLowerCase(); return k in st.vars ? num(st.vars[k]) : parseFloat(n.val) || 0; }
        case 'tab': return n.sel + 1;
        case 'lnk': case 'img': case 'avt': return n.url;
        default: return undefined;
      }
    }, v => {
      switch (n.type) {
        case 'inp': st.inputs[n.id] = text(v); break;
        case 'sld': st.slds[n.id] = Math.max(n.min, Math.min(n.max, number(v))); break;
        case 'sel': st.sels[n.id] = Math.max(0, Math.min(n.opts.length - 1, Math.round(number(v)) - 1)); break;
        case 'rat': st.vars['rat' + n.id] = Math.max(0, Math.min(n.max, Math.round(number(v)))); break;
        case 'prg': n.val = String(number(v)); break;
        case 'tab': n.sel = Math.max(0, Math.min(n.tabs.length - 1, Math.round(number(v)) - 1)); break;
        case 'lnk': case 'img': case 'avt': n.url = text(v); break;
        default: no('value');
      }
      touch();
    });
    def('checked', () => n.type === 'tog' ? !!st.togs[n.id] : n.type === 'chk' ? !!st.chks[n.id] : undefined,
      v => { if (n.type === 'tog') st.togs[n.id] = !!v; else if (n.type === 'chk') st.chks[n.id] = !!v; else no('checked'); touch(); });
    def('hidden', () => !!n.off, v => { n.off = !!v; touch(); });
    def('open', () => n.type === 'acc' || n.type === 'dlg' ? !!n.open : undefined,
      v => { if (n.type !== 'acc' && n.type !== 'dlg') no('open'); n.open = !!v; touch(); });
    return f;
  }

  // ── the page table ──
  function timer(ms, fn, repeat) {
    callback(fn);
    if (rt.timers.size >= LIMITS.timers) throw new Error('a page can have ' + LIMITS.timers + ' timers at once');
    const id = rt.nextTimer++, wait = Math.max(repeat ? 50 : 10, Math.min(864e5, number(ms)));
    rt.timers.set(id, hooks.setTimer(() => {
      if (!repeat) rt.timers.delete(id);
      if (!enter(fn, []) && repeat) cancel(id);   // a repeating timer that hits a limit is stopped
    }, wait, repeat));
    return id;
  }
  function cancel(id) { const t = rt.timers.get(id); if (t !== undefined) { hooks.clearTimer(t); rt.timers.delete(id); } }
  const api = {
    find: name => { const n = page.names[nameOf(name)]; return n ? handle(n) : null; },   // null: one nil, not no value
    on: (name, event, fn) => {
      const n = node(name);
      if (event !== 'click' && event !== 'change') throw new Error('events are "click" and "change"');
      callback(fn);
      if (rt.handlerCount >= LIMITS.handlers) throw new Error('a page can have ' + LIMITS.handlers + ' handlers');
      rt.handlerCount++;
      (rt.handlers[n.name + ' ' + event] || (rt.handlers[n.name + ' ' + event] = [])).push(fn);
    },
    get: name => { const k = nameOf(name); return k in st.vars ? st.vars[k] : null; },
    set: (name, v) => {
      const k = nameOf(name);
      st.vars[k] = typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : text(v);
      touch();
    },
    go: address => { if (typeof address !== 'string') throw new Error('expected an address'); hooks.navigate(address.slice(0, 2000)); },
    title: v => { page.title = text(v).slice(0, 200); if (hooks.title) hooks.title(page.title); },
    // add(container, source [, words]): words become the text of the last element added, exactly as given.
    // That is the way to show text that came from a person or from the network: it is never read as page lines.
    add: (name, source, words) => {
      const n = node(name);
      if (!n.children) throw new Error('a ' + n.type + ' cannot hold elements');
      if (typeof source !== 'string') throw new Error('expected page text');
      const safe = words === undefined ? null : text(words), before = n.children.length;
      const added = append(page, n, source.slice(0, 1e5));
      if (safe !== null) {
        if (n.children.length === before) throw new Error('nothing was added to put the text in');
        let last = n.children[n.children.length - 1];
        while (last.children && last.children.length) last = last.children[last.children.length - 1];
        const k = last.type === 'btn' || last.type === 'chk' ? 'label' : last.type === 'acc' || last.type === 'dlg' ? 'title' : 'text' in last ? 'text' : null;
        if (!k) throw new Error('a ' + last.type + ' has no text');
        last[k] = safe; last.raw = true;
      }
      touch();
      return added;
    },
    clear: name => { const n = node(name); if (!n.children) throw new Error('a ' + n.type + ' cannot hold elements'); clear(page, n); touch(); },
    after: (ms, fn) => timer(ms, fn, false),
    every: (ms, fn) => timer(ms, fn, true),
    cancel: id => cancel(id),
    fetch: (address, fn) => {
      if (typeof address !== 'string') throw new Error('expected an address');
      callback(fn);
      if (rt.requests >= LIMITS.requests) throw new Error('a page can have ' + LIMITS.requests + ' requests at once');
      rt.requests++;
      hooks.fetch(address.slice(0, 2000), (status, body) => { rt.requests--; enter(fn, [status, body]); });
    },
  };
  const storage = () => { const s = hooks.storage && hooks.storage(); if (!s) throw new Error('storage is not available here'); return s; };
  const key = k => { if (typeof k !== 'string' || !k || k.length > LIMITS.key) throw new Error('a key is text of 1 to ' + LIMITS.key + ' characters'); return k; };
  const store = {
    get: k => { const v = storage().get(key(k)); return v === undefined ? null : v; },
    set: (k, v) => {
      if (typeof v === 'string') { if (v.length > LIMITS.value) throw new Error('a stored value can be ' + LIMITS.value + ' characters'); }
      else if (typeof v !== 'number' && typeof v !== 'boolean') throw new Error('a stored value is text, a number or true / false');
      storage().set(key(k), v);
    },
    remove: k => storage().remove(key(k)),
    keys: () => storage().keys(),
  };
  try {
    vm.set('page', api); vm.set('store', store);
    vm.run(page.script, 'page');
  } catch (e) { log('error', (e && e.message) || e); }
  return rt;
}
const EL_KEYS = ['name', 'kind', 'text', 'value', 'checked', 'hidden', 'open'];

// ════════════════════════════════════════════ view (browser) ════════════════════════════════════════════

/**
 * Bind a canvas to pages. The canvas is sized by CSS; the view keeps its backing store at the device pixel
 * ratio and works in CSS pixels throughout.
 * opts:
 *   onNavigate(address)       links, `go` and page.go, only while a click or key of the user is being handled
 *   onTitle(title), onLog(kind, text, site)      kind: 'print', 'error', 'blocked'
 *   resolve(ref) → absolute URL or null          for img, avt, snd, web, page.fetch
 *   allow(kind, url, site) → boolean             asked before every request a page causes; kind is 'img',
 *                                                'snd', 'web' or 'font'. Without it everything is allowed.
 *   storage(site) → { get, set, remove, keys } or null      what `store` in scripts reads and writes
 *   mirror     an element that receives a text-only copy of the page for screen readers
 *   Mote       the script engine (default: the global Mote); font, fetch, loadFonts
 * view.load(source, { site }) shows a page; site is who the page is, and is handed back to allow and storage.
 */
function createView(canvas, opts) {
  opts = opts || {};
  const X = canvas.getContext('2d');
  const view = { canvas, page: null, state: newState(), painted: { hits: [], scrolls: [], spinning: false, modalFrom: -1 }, layouts: 0, paints: 0 };
  const env = { measure, image: imageSize, state: view.state, cache: new Map() };
  const images = new Map();
  let timers = [], spin = 0, spinTimer = 0, raf = 0, dead = false, drag = null, generation = 0;
  let site = null, rt = null, userActive = 0, needLayout = false, inputs = Object.create(null);
  const defFont = () => opts.font || DEFAULT_FONT;
  const log = (kind, text) => { if (opts.onLog) opts.onLog(kind, text, site); };

  /** The absolute URL a page may request for a reference, or null: not resolvable, or not allowed. */
  function request(kind, ref) {
    let abs = null;
    try { abs = opts.resolve ? opts.resolve(ref) : ref; } catch (e) {}
    if (!abs) return null;
    if (opts.allow && !opts.allow(kind, abs, site)) { log('blocked', kind + ' ' + abs); return null; }
    return abs;
  }
  function measure(text, size, family, bold) {
    X.font = (bold ? 'bold ' : '') + size + 'px ' + JSON.stringify(family || defFont()) + ', monospace';
    return X.measureText(text).width;
  }
  function image(ref) {
    let e = images.get(ref);
    if (!e) {
      e = { el: null, ok: false };
      images.set(ref, e);
      const abs = request('img', ref), gen = generation;
      if (abs) { e.el = new Image(); e.el.onload = () => { e.ok = e.el.naturalWidth > 0; if (gen === generation) invalidate(); }; e.el.src = abs; }
    }
    return e.ok ? e.el : null;
  }
  function imageSize(url) { const im = image(url); return im ? { w: im.naturalWidth, h: im.naturalHeight } : null; }

  /** GET for a page: no cookies, the answer capped, and done(status, text) is always called later, never at once. */
  function doFetch(ref, done) {
    const abs = request('web', ref), gen = generation;
    const finish = (status, text) => { if (gen === generation && !dead) done(status, text); };
    if (!abs) { Promise.resolve().then(() => finish(0, '')); return; }
    (opts.fetch || root.fetch)(abs, { credentials: 'omit', redirect: 'follow' })
      .then(r => r.text().then(t => finish(r.status, t.slice(0, LIMITS.body))))
      .catch(() => finish(0, ''));
  }
  const host = {
    navigate: address => {
      if (!userActive) { log('blocked', 'go outside a click or key'); return; }
      if (opts.onNavigate) opts.onNavigate(address);
    },
    sound: ref => {
      if (!userActive) { log('blocked', 'snd outside a click or key'); return; }
      const abs = request('snd', ref);
      if (abs) try { new Audio(abs).play().catch(() => {}); } catch (e) {}
    },
    web: (ref, name) => {
      const st = view.state;
      doFetch(ref, (status, text) => {
        const v = parseFloat(text);
        st.vars[name] = isNaN(v) ? 0 : v; st.vars[name + '_txt'] = text; st.vars[name + '_status'] = status;
        invalidate();
      });
    },
  };

  function size() {
    const dpr = root.devicePixelRatio || 1, w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    return { w, h, dpr };
  }
  function layoutNow() {
    const s = size();
    layout(view.page, s.w, s.h, env);
    needLayout = false;
    view.layouts++;
    syncMirror();
  }
  /** Something that can change sizes happened: lay out and paint on the next frame (many changes, one layout). */
  function invalidate() { if (dead || !view.page) return; needLayout = true; repaint(); }
  function repaint() {
    if (dead || !view.page || raf) return;
    raf = root.requestAnimationFrame(() => { raf = 0; paintNow(); });
  }
  function paintNow() {
    if (dead || !view.page) return;
    const s = size();
    if (needLayout || s.w !== view.page.vw || s.h !== view.page.vh) layoutNow();
    X.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    view.painted = paint(X, view.page, { state: view.state, font: defFont(), image, spin });
    view.paints++;
    if (view.painted.spinning && !spinTimer) spinTimer = root.setInterval(() => { spin += 0.15; repaint(); }, 50);
    if (!view.painted.spinning && spinTimer) { root.clearInterval(spinTimer); spinTimer = 0; }
  }

  /** A text-only copy of the page for assistive technology. Text goes in as text, never as markup. */
  function syncMirror() {
    const m = opts.mirror;
    if (!m) return;
    const st = view.state, doc = m.ownerDocument;
    const el = (tag, text, role) => { const e = doc.createElement(tag); if (text != null) e.textContent = text; if (role) e.setAttribute('role', role); return e; };
    function build(n, into) {
      if (n.hidden || n.type === 'tmr') return;
      let e = null;
      switch (n.type) {
        case 'txt': e = el('p', shownText(n, st)); break;
        case 'lnk': e = el('a', shownText(n, st)); e.setAttribute('href', '#'); e.addEventListener('click', ev => { ev.preventDefault(); activate(n, 0); }); break;
        case 'btn': e = el('button', shownText(n, st)); e.addEventListener('click', () => activate(n, 0)); break;
        case 'chk': e = el('button', shownText(n, st), 'checkbox'); e.setAttribute('aria-checked', String(!!st.chks[n.id])); e.addEventListener('click', () => activate(n, 0)); break;
        case 'tog': e = el('button', 'switch ' + n.id, 'switch'); e.setAttribute('aria-checked', String(!!st.togs[n.id])); e.addEventListener('click', () => activate(n, 0)); break;
        case 'inp': e = el('span', st.inputs[n.id] || '', 'textbox'); break;
        case 'sel': e = el('span', n.opts[st.sels[n.id] || 0] || '', 'combobox'); break;
        case 'bdg': e = el('span', shownText(n, st)); break;
        case 'img': case 'avt': e = el('span', 'image', 'img'); break;
        case 'tbl': e = el('table'); for (const r of flow(n)) { const tr = el('tr'); for (const c of r.cells || []) tr.appendChild(el('td', c)); e.appendChild(tr); } break;
        case 'acc': e = el('section'); { const b = el('button', shownText(n, st)); b.setAttribute('aria-expanded', String(n.open)); b.addEventListener('click', () => activate(n, 0)); e.appendChild(b); } break;
        case 'dlg': e = el('section', null, 'dialog'); e.setAttribute('aria-label', shownText(n, st)); break;
        default: if (n.children) e = el(n.type === 'lst' ? 'ol' : 'div');
      }
      if (!e) return;
      if (n.children && n.type !== 'tbl') for (const c of n.children) { const holder = n.type === 'lst' ? e.appendChild(el('li')) : e; build(c, holder); }
      into.appendChild(e);
    }
    m.textContent = '';
    build(view.page.root, m);
  }

  // ── events ──
  const point = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function hitAt(x, y) {
    const hs = view.painted.hits, from = Math.max(0, view.painted.modalFrom);
    for (let i = hs.length - 1; i >= from; i--) { const h = hs[i]; if (x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1) return h; }
    return null;
  }
  /** Scroll what is under (x, y) by d; the innermost container that can move takes it, else the page. */
  function scrollBy(x, y, d) {
    if (!view.page || view.painted.modalFrom >= 0) return false;
    const ss = view.painted.scrolls;
    for (let i = ss.length - 1; i >= 0; i--) {
      const s = ss[i], n = s.n;
      if (x < s.x0 || x > s.x1 || y < s.y0 || y > s.y1 || !n.maxScroll) continue;
      const to = Math.max(0, Math.min(n.maxScroll, (n.scrollY || 0) + d));
      if (to !== n.scrollY) { n.scrollY = to; repaint(); return true; }
    }
    const p = view.page, to = Math.max(0, Math.min(p.maxScroll, p.scrollY + d));
    if (to === p.scrollY) return false;
    p.scrollY = to; repaint();
    return true;
  }
  /** The user did something to an element: run the page's if lines, then the script's handlers for it. */
  function fire(n, event, value) {
    userActive++;
    try {
      runStatements(view.page, view.state, 'event', host);
      if (rt) rt.dispatch(n, event, value);
    } finally { userActive--; }
    invalidate();
  }
  function setSlider(n, x) {
    const v = n.min + (n.max - n.min) * Math.max(0, Math.min(1, (x - (n.x + 8)) / Math.max(1, n.w - 16)));
    view.state.slds[n.id] = v;
    fire(n, 'change', v);
  }
  /** What a click on a node does. x is the click position in viewport coordinates (tabs, stars and sliders use it). */
  function activate(n, x, h) {
    const st = view.state;
    st.activeInput = n.type === 'inp' ? n.id : -1;
    switch (n.type) {
      case 'btn': st.taps[n.id] = true; try { fire(n, 'click', n.id); } finally { st.taps = Object.create(null); } break;
      case 'tog': st.togs[n.id] = !st.togs[n.id]; fire(n, 'change', st.togs[n.id]); break;
      case 'chk': st.chks[n.id] = !st.chks[n.id]; fire(n, 'change', st.chks[n.id]); break;
      case 'sel': st.sels[n.id] = ((st.sels[n.id] || 0) + 1) % Math.max(1, n.opts.length); fire(n, 'change', st.sels[n.id] + 1); break;
      case 'sld': if (h) setSlider(n, x); break;
      case 'lnk': userActive++; try { if (rt) rt.dispatch(n, 'click', n.url); host.navigate(n.url); } finally { userActive--; } break;
      case 'acc': n.open = !n.open; fire(n, 'change', n.open); break;
      case 'tab': if (h) { n.sel = Math.max(0, Math.min(n.tabs.length - 1, Math.floor((x - n.x) / (n.w / n.tabs.length)))); fire(n, 'change', n.sel + 1); } break;
      case 'rat': if (h) { st.vars['rat' + n.id] = Math.max(0, Math.min(n.max, Math.floor((x - n.x) / 20) + 1)); fire(n, 'change', st.vars['rat' + n.id]); } break;
      case 'dlg': n.open = false; fire(n, 'change', false); break;
      case 'inp': if (st.inputs[n.id] == null) st.inputs[n.id] = ''; break;
    }
    invalidate();
  }
  function click(x, y) {
    const h = hitAt(x, y);
    if (!h) { if (view.state.activeInput !== -1) { view.state.activeInput = -1; repaint(); } return; }
    activate(h.n, x, h);
  }
  const on = (target, type, fn, o) => { target.addEventListener(type, fn, o); listeners.push([target, type, fn, o]); };
  const listeners = [];
  on(canvas, 'pointerdown', e => {
    if (!view.page) return;
    const p = point(e), h = hitAt(p.x, p.y);
    drag = { id: e.pointerId, x: p.x, y: p.y, lastY: p.y, moved: false, touch: e.pointerType !== 'mouse', slider: h && h.n.type === 'sld' ? h.n : null };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    canvas.focus({ preventScroll: true });
    if (drag.slider) setSlider(drag.slider, p.x);
  });
  on(canvas, 'pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = point(e);
    if (drag.slider) { drag.moved = true; setSlider(drag.slider, p.x); return; }
    if (!drag.moved && Math.abs(p.y - drag.y) + Math.abs(p.x - drag.x) > 6) drag.moved = true;
    if (drag.moved && drag.touch) { scrollBy(drag.x, drag.y, drag.lastY - p.y); drag.lastY = p.y; }
  });
  on(canvas, 'pointerup', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag, p = point(e); drag = null;
    if (d.slider) { view.state.activeInput = -1; invalidate(); return; }
    if (!d.moved) click(p.x, p.y);
  });
  on(canvas, 'pointercancel', () => { drag = null; });
  on(canvas, 'wheel', e => {
    if (!view.page) return;
    const p = point(e), d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * view.page.vh : e.deltaY;
    if (scrollBy(p.x, p.y, d)) e.preventDefault();
  }, { passive: false });
  on(canvas, 'keydown', e => {
    if (!view.page || e.ctrlKey || e.metaKey || e.altKey) return;
    const st = view.state, id = st.activeInput;
    if (id >= 0) {
      const v = st.inputs[id] || '';
      if (e.key === 'Backspace') st.inputs[id] = Array.from(v).slice(0, -1).join('');
      else if (e.key === 'Enter' || e.key === 'Escape') st.activeInput = -1;
      else if (Array.from(e.key).length === 1) st.inputs[id] = (v + e.key).slice(0, LIMITS.text);
      else return;
      e.preventDefault();
      if (st.inputs[id] !== v && inputs[id]) fire(inputs[id], 'change', st.inputs[id]); else invalidate();
      return;
    }
    const page = view.page.vh * 0.9;
    const d = { ArrowDown: 40, ArrowUp: -40, PageDown: page, PageUp: -page, ' ': e.shiftKey ? -page : page, Home: -1e9, End: 1e9 }[e.key];
    if (d && scrollBy(view.page.vw / 2, view.page.vh / 2, d)) e.preventDefault();
  });
  const ro = root.ResizeObserver ? new root.ResizeObserver(() => invalidate()) : null;
  if (ro) ro.observe(canvas); else on(root, 'resize', () => invalidate());
  if (canvas.tabIndex < 0) canvas.tabIndex = 0;
  canvas.style.touchAction = 'none';
  canvas.style.outline = 'none';

  function stopPage() {
    generation++;
    for (const t of timers) root.clearInterval(t);
    timers = [];
    if (rt) rt.stop();
    rt = null;
    if (spinTimer) { root.clearInterval(spinTimer); spinTimer = 0; }
    drag = null; userActive = 0;
  }
  function loadFont(name) {
    const doc = canvas.ownerDocument, id = 'pane-font-' + name.replace(/ /g, '-');
    if (opts.loadFonts === false || doc.getElementById(id)) return;
    const href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(name).replace(/%20/g, '+') + '&display=swap';
    if (opts.allow && !opts.allow('font', href, site)) { log('blocked', 'font ' + href); return; }
    const link = doc.createElement('link');
    link.id = id; link.rel = 'stylesheet'; link.href = href;
    doc.head.appendChild(link);
    const gen = generation;
    if (doc.fonts && doc.fonts.load) link.onload = () => doc.fonts.load('14px "' + name + '"').then(() => { env.cache.clear(); if (gen === generation) invalidate(); }).catch(() => {});
  }

  /**
   * Show a page. Everything from the page before (state, script, timers, scroll, requests in flight) is
   * dropped: its callbacks can no longer do anything. info.site says who the new page is.
   */
  view.load = function (src, info) {
    stopPage();
    site = info && info.site != null ? info.site : null;
    const page = parse(src), st = newState(), mine = site;
    view.page = page; view.state = st; env.state = st; env.cache.clear(); images.clear();
    inputs = Object.create(null);
    (function index(n) { if (n.type === 'inp' && !inputs[n.id]) inputs[n.id] = n; if (n.children) for (const c of n.children) index(c); })(page.root);
    for (const name of page.fonts) loadFont(name);
    runStatements(page, st, 'load', host);
    rt = createRuntime(page, st, {
      log, changed: invalidate, navigate: host.navigate, fetch: doFetch,
      title: t => { if (opts.onTitle) opts.onTitle(t); },
      setTimer: (fn, ms, repeat) => ({ repeat, id: repeat ? root.setInterval(fn, ms) : root.setTimeout(fn, ms) }),
      clearTimer: t => (t.repeat ? root.clearInterval : root.clearTimeout)(t.id),
      storage: () => opts.storage ? opts.storage(mine) : null,
    }, opts.Mote || root.Mote);
    (function startTimers(n) {
      if (n.type === 'tmr') timers.push(root.setInterval(() => { st.vars['tmr' + n.id] = num(st.vars['tmr' + n.id] || 0) + 1; runStatements(page, st, 'event', host); invalidate(); }, n.ms));
      if (n.children) for (const c of n.children) startTimers(c);
    })(page.root);
    if (opts.onTitle) opts.onTitle(page.title);
    layoutNow();
    repaint();
    return page;
  };
  view.relayout = invalidate;
  view.paintNow = paintNow;
  view.hitAt = hitAt;
  view.scrollBy = scrollBy;
  view.destroy = function () {
    stopPage(); dead = true;
    if (raf) root.cancelAnimationFrame(raf);
    if (ro) ro.disconnect();
    for (const [t, type, fn, o] of listeners) t.removeEventListener(type, fn, o);
  };
  return view;
}

const Pane = { VERSION, LIMITS, parse, append, clear, layout, paint, dump, evalExpr, display, runStatements, newState, createRuntime, createView };
if (typeof module === 'object' && module.exports) module.exports = Pane;
else root.Pane = Pane;
})(typeof globalThis !== 'undefined' ? globalThis : this);

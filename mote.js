/*
 * Mote — a tiny, embeddable, Lua-like scripting language for JavaScript hosts.
 *
 *   const vm = Mote.create({ print: s => console.log(s) });
 *   vm.run('print("hello from Mote")');
 *
 * One dependency-free file. Use it as a classic <script> (defines window.Mote) or from Node with
 * require('./mote.js'). Language reference and embedding guide: MOTE.md.
 * The playground mote.html embeds a copy of this file; after editing mote.js rebuild it with
 *   node tools/build-mote-html.js
 *
 * Pipeline: source → lexer → parser (AST) → compiler (stack bytecode, one proto per function)
 *           → VM with an explicit call stack per coroutine.
 * Mote calls never use the JS call stack, so a coroutine can be suspended at any point, including
 * inside a host function that asks to yield (vm.yield). Host code calling back into Mote (a sort
 * comparator, __tostring, gsub with a function) runs a nested VM loop; like Lua's C boundary, a
 * yield cannot cross such a nested call.
 */
(function (root) {
'use strict';

// ════════════════════════════════════════════ values ════════════════════════════════════════════

/** Thrown to the host: kind is 'syntax', 'runtime' or 'limit'. */
class MoteError extends Error {
  constructor(message, info) {
    super(message);
    this.name = 'MoteError';
    this.kind = 'runtime';
    if (info) Object.assign(this, info);
  }
}

// A Mote error in flight inside the VM. Cheap (no JS stack capture). pos: prefix "chunk:line: ".
class Throw { constructor(v, pos) { this.v = v; this.pos = pos; } }
const rt = msg => new Throw(msg, true);

/** Tables: an array part arr (arr[i-1] is t[i]; arr never ends in nil, so #t = arr.length is a
 *  border) and a Map for every other key. */
class LTable {
  constructor() { this.arr = []; this.hash = null; this.mt = null; this.keys = null; this.ki = 0; this.id = 0; }
  get(k) {
    if (typeof k === 'number') {
      const a = this.arr;
      if (k >= 1 && k <= a.length && Number.isInteger(k)) return a[k - 1];
    }
    return this.hash === null ? undefined : this.hash.get(k);
  }
  /** Raw set. Returns true when a new slot was created (for the memory estimate). */
  set(k, v) {
    const a = this.arr;
    if (typeof k === 'number' && k >= 1 && k <= a.length + 1 && Number.isInteger(k)) {
      const n = a.length;
      if (k <= n) {
        if (v === undefined && k === n) { a.pop(); this.trim(); } else a[k - 1] = v;
        return false;
      }
      if (v === undefined) return false;
      a.push(v);
      if (this.hash !== null && this.hash.size) this.migrate();
      return true;
    }
    if (this.hash === null) { if (v === undefined) return false; this.hash = new Map(); }
    const h = this.hash;
    if (v === undefined) { h.delete(k); return false; }
    const size = h.size;
    h.set(k, v);
    if (h.size !== size) { this.keys = null; return true; }
    return false;
  }
  trim() { const a = this.arr; while (a.length && a[a.length - 1] === undefined) a.pop(); }
  migrate() {   // keys n+1, n+2, … that sit in the hash move to the array part
    const a = this.arr, h = this.hash;
    let v;
    while ((v = h.get(a.length + 1)) !== undefined) { h.delete(a.length + 1); a.push(v); this.keys = null; }
  }
  /** Lua's next(): array part first, then the hash in insertion order. Returns [k, v] or null. */
  next(k) {
    const a = this.arr;
    let i = 0;
    if (k !== undefined) {
      if (typeof k === 'number' && k >= 1 && k <= a.length && Number.isInteger(k)) i = k;
      else return this.nextHash(k);
    }
    for (; i < a.length; i++) if (a[i] !== undefined) return [i + 1, a[i]];
    return this.nextHash(undefined);
  }
  nextHash(k) {
    const h = this.hash;
    // an integer key past the array part: the array shrank during traversal (t[k] = nil), go on with the hash
    const shrunk = typeof k === 'number' && k >= 1 && Number.isInteger(k);
    if (h === null) { if (k === undefined || shrunk) return null; throw rt("invalid key to 'next'"); }
    if (this.keys === null) { this.keys = Array.from(h.keys()); this.ki = 0; }
    const keys = this.keys;
    let i = 0;
    if (k !== undefined) {
      i = keys[this.ki] === k ? this.ki + 1 : keys.indexOf(k) + 1;
      if (i === 0 && !shrunk) throw rt("invalid key to 'next'");
    }
    for (; i < keys.length; i++) {
      const v = h.get(keys[i]);
      if (v !== undefined) { this.ki = i; return [keys[i], v]; }
    }
    return null;
  }
}

class UpVal { constructor(R, i) { this.R = R; this.i = i; } }   // open: R is a frame's slots; closed: R = [value]
class LClosure { constructor(p, up) { this.p = p; this.up = up; this.id = 0; } }
class HostFn { constructor(name, fn, special) { this.name = name; this.fn = fn; this.special = special || 0; this.id = 0; } }
class Coroutine {
  constructor(fn) {
    this.fn = fn; this.frames = []; this.status = 'suspended'; this.started = false; this.isMain = false;
    this.resumer = null;            // the coroutine that resumed us, or null when the host did
    this.nny = 0;                   // nested host calls on this stack (no yield across them)
    this.yNres = -1; this.yPost = 0; // how the pending yield call wants its results
    this.rNres = 0; this.rPost = 0; this.rMode = 0;  // how our pending resume call wants its results
    this.id = 0;
  }
}
/** A JS object exposed by reference (vm.ref). Mote type "userdata". */
class Ref {
  constructor(obj, opts) {
    this.obj = obj; this.id = 0; this.methods = new Map();
    this.allow = opts && opts.allow ? new Set(opts.allow) : null;
    this.deep = !!(opts && opts.deep); this.readonly = !!(opts && opts.readonly);
  }
}
class YieldReq { constructor(vals) { this.vals = vals; } }
class Multi { constructor(vals) { this.vals = vals; } }

function typeOf(v) {
  switch (typeof v) {
    case 'undefined': return 'nil';
    case 'boolean': return 'boolean';
    case 'number': return 'number';
    case 'string': return 'string';
  }
  if (v instanceof LTable) return 'table';
  if (v instanceof LClosure || v instanceof HostFn) return 'function';
  if (v instanceof Coroutine) return 'thread';
  return 'userdata';
}
const truthy = v => v !== undefined && v !== false;

// ── numbers ──
function fmtE(x, p) { return x.toExponential(p).replace(/e([+-])(\d)$/, 'e$10$2'); }
function fmtF(x, p) {
  if (Math.abs(x) < 1e21) return x.toFixed(p);
  return BigInt(Math.round(x)).toString() + (p > 0 ? '.' + '0'.repeat(p) : '');
}
function fmtG(x, P, alt) {   // C's %.<P>g
  if (P === 0) P = 1;
  if (x === 0) return Object.is(x, -0) ? '-0' : '0';
  const e = x.toExponential(P - 1), X = +e.slice(e.indexOf('e') + 1);
  if (X < -4 || X >= P) { const s = fmtE(x, P - 1); return alt ? s : s.replace(/\.?0+e/, 'e'); }
  const s = x.toFixed(P - 1 - X);
  return alt || s.indexOf('.') < 0 ? s : s.replace(/\.?0+$/, '');
}
/** How Mote prints numbers: integral values below 1e16 without a fraction, others like Lua's %.14g. */
function num2str(n) {
  if (Number.isInteger(n) && n < 1e16 && n > -1e16) return String(n);
  if (n !== n) return 'nan';
  if (n === Infinity) return 'inf';
  if (n === -Infinity) return '-inf';
  return fmtG(n, 14);
}
const NUM_RE = /^[ \t\n\r\f\v]*([-+])?(?:0[xX]([0-9a-fA-F]*)(?:\.([0-9a-fA-F]*))?(?:[pP]([-+]?\d+))?|((?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?))[ \t\n\r\f\v]*$/;
/** Lua's string→number conversion (decimal, hex, hex floats). undefined when not a number. */
function str2num(s) {
  const m = NUM_RE.exec(s);
  if (!m) return undefined;
  let n;
  if (m[5] !== undefined) n = Number(m[5]);
  else {
    const ip = m[2] || '', fp = m[3] || '';
    if (!ip && !fp) return undefined;
    n = ip ? parseInt(ip, 16) : 0;
    for (let i = 0; i < fp.length; i++) n += parseInt(fp[i], 16) / Math.pow(16, i + 1);
    if (m[4] !== undefined) n *= Math.pow(2, +m[4]);
  }
  return m[1] === '-' ? -n : n;
}
const tonum = v => typeof v === 'number' ? v : typeof v === 'string' ? str2num(v) : undefined;
function mod(a, b) { const m = a % b; return m !== 0 && (m < 0) !== (b < 0) ? m + b : m; }

// ═══════════════════════════════════════════ lexer ═══════════════════════════════════════════════

const KEYWORDS = new Set(('and break do else elseif end false for function goto if in local nil not or ' +
  'repeat return then true until while').split(' '));
const OPS3 = new Set(['...']);
const OPS2 = new Set(['==', '~=', '<=', '>=', '//', '..', '::', '<<', '>>']);
const OPS1 = new Set('+-*/%^#&~|<>=(){}[];:,.'.split(''));
const isDigit = c => c >= '0' && c <= '9';
const isAlpha = c => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isAlnum = c => isAlpha(c) || isDigit(c);

function syntaxError(chunk, line, col, msg) {
  return new MoteError(`${chunk}:${line}:${col}: ${msg}`, { kind: 'syntax', chunk, line, column: col });
}

function lex(src, chunk) {
  const toks = [], n = src.length;
  let i = 0, line = 1, ls = 0;
  const fail = (msg, l, c) => { throw syntaxError(chunk, l, c, msg); };
  if (src[0] === '#') while (i < n && src[i] !== '\n') i++;   // shebang line
  const longLevel = () => { let j = i + 1, lvl = 0; while (src[j] === '=') { j++; lvl++; } return src[j] === '[' ? lvl : -1; };
  function readLong(lvl, what, sl, sc) {
    i += lvl + 2;
    if (src[i] === '\r') i++;
    if (src[i] === '\n') { i++; line++; ls = i; }   // a newline right after the opening bracket is skipped
    const close = ']' + '='.repeat(lvl) + ']', end = src.indexOf(close, i);
    if (end < 0) fail(`unfinished long ${what}`, sl, sc);
    for (let j = i; j < end; j++) if (src[j] === '\n') { line++; ls = j + 1; }
    const s = src.slice(i, end);
    i = end + close.length;
    return s;
  }
  function readString(q, tl, tc) {
    let s = '', start = ++i;
    for (;;) {
      if (i >= n || src[i] === '\n') fail('unfinished string', tl, tc);
      const c = src[i];
      if (c === q) { s += src.slice(start, i); i++; return s; }
      if (c !== '\\') { i++; continue; }
      s += src.slice(start, i);
      const e = src[++i];
      const esc = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'" }[e];
      if (esc !== undefined) { s += esc; i++; }
      else if (e === '\n') { s += '\n'; i++; line++; ls = i; }
      else if (e === 'x') {
        const h = src.slice(i + 1, i + 3);
        if (!/^[0-9a-fA-F]{2}$/.test(h)) fail('hexadecimal digit expected', line, i - ls + 1);
        s += String.fromCharCode(parseInt(h, 16)); i += 3;
      } else if (e === 'z') {
        i++;
        while (i < n && /\s/.test(src[i])) { if (src[i] === '\n') { line++; ls = i + 1; } i++; }
      } else if (e === 'u') {
        const m = /^\{([0-9a-fA-F]+)\}/.exec(src.slice(i + 1, i + 12));
        if (!m || parseInt(m[1], 16) > 0x10FFFF) fail('invalid unicode escape', line, i - ls + 1);
        s += String.fromCodePoint(parseInt(m[1], 16)); i += m[0].length + 1;
      } else if (isDigit(e)) {
        let j = i; while (j < i + 3 && isDigit(src[j])) j++;
        const v = +src.slice(i, j);
        if (v > 255) fail('decimal escape too large', line, i - ls + 1);
        s += String.fromCharCode(v); i = j;
      } else fail('invalid escape sequence', line, i - ls + 1);
      start = i;
    }
  }
  const NUM = /0[xX][0-9a-fA-F]*(?:\.[0-9a-fA-F]*)?(?:[pP][-+]?\d+)?|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
  for (;;) {
    const c = src[i];
    if (c === '\n') { line++; i++; ls = i; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { i++; continue; }
    const tl = line, tc = i - ls + 1, start = i;
    if (c === '-' && src[i + 1] === '-') {
      i += 2;
      if (src[i] === '[') { const lvl = longLevel(); if (lvl >= 0) { readLong(lvl, 'comment', tl, tc); continue; } }
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (i >= n) { toks.push({ t: '<eof>', raw: '<eof>', line, col: tc }); return toks; }
    let tok;
    if (isAlpha(c)) {
      let j = i + 1; while (j < n && isAlnum(src[j])) j++;
      const w = src.slice(i, j); i = j;
      tok = KEYWORDS.has(w) ? { t: w } : { t: 'name', v: w };
    } else if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
      NUM.lastIndex = i; const m = NUM.exec(src);
      i += m[0].length;
      const v = str2num(m[0]);
      if (v === undefined || (i < n && (isAlnum(src[i]) || src[i] === '.'))) {
        while (i < n && (isAlnum(src[i]) || src[i] === '.')) i++;
        fail(`malformed number near '${src.slice(start, i)}'`, tl, tc);
      }
      tok = { t: 'num', v };
    } else if (c === '"' || c === "'") {
      tok = { t: 'str', v: readString(c, tl, tc) };
    } else if (c === '[' && longLevel() >= 0) {
      tok = { t: 'str', v: readLong(longLevel(), 'string', tl, tc) };
    } else {
      const s3 = src.substr(i, 3), s2 = src.substr(i, 2);
      if (OPS3.has(s3)) { tok = { t: s3 }; i += 3; }
      else if (OPS2.has(s2)) { tok = { t: s2 }; i += 2; }
      else if (OPS1.has(c)) { tok = { t: c }; i += 1; }
      else fail(`unexpected symbol near '${c}'`, tl, tc);
    }
    tok.line = tl; tok.col = tc; tok.raw = src.slice(start, Math.min(i, start + 40));
    toks.push(tok);
  }
}

// ═══════════════════════════════════════════ parser ══════════════════════════════════════════════
// Produces a small AST: { k: 'Kind', line, ... }.

const BINPRI = {
  or: [1, 1], and: [2, 2], '<': [3, 3], '>': [3, 3], '<=': [3, 3], '>=': [3, 3], '~=': [3, 3], '==': [3, 3],
  '|': [4, 4], '~': [5, 5], '&': [6, 6], '<<': [7, 7], '>>': [7, 7], '..': [9, 8],
  '+': [10, 10], '-': [10, 10], '*': [11, 11], '/': [11, 11], '//': [11, 11], '%': [11, 11], '^': [14, 13],
};
const UNARY_PRI = 12;
const BITOPS = new Set(['|', '~', '&', '<<', '>>']);
const MAX_LEVELS = 200;

class Parser {
  constructor(src, chunk) { this.toks = lex(src, chunk); this.i = 0; this.chunk = chunk; this.depth = 0; this.va = [true]; }
  get tok() { return this.toks[this.i]; }
  check(t) { return this.toks[this.i].t === t; }
  accept(t) { if (this.toks[this.i].t === t) { this.i++; return true; } return false; }
  next() { const t = this.toks[this.i]; if (t.t !== '<eof>') this.i++; return t; }
  fail(msg, tok = this.tok) { throw syntaxError(this.chunk, tok.line, tok.col, msg); }
  errNear(msg, tok = this.tok) { this.fail(`${msg} near ${tok.t === '<eof>' ? '<eof>' : `'${tok.raw}'`}`, tok); }
  expect(t) { if (!this.check(t)) this.errNear(`'${t}' expected`); return this.next(); }
  expectMatch(t, open, line) {
    if (!this.check(t)) this.errNear(line === this.tok.line ? `'${t}' expected` : `'${t}' expected (to close '${open}' at line ${line})`);
    return this.next();
  }
  name() { const t = this.tok; if (t.t !== 'name') this.errNear('<name> expected'); this.i++; return t.v; }
  enter() { if (++this.depth > MAX_LEVELS) this.fail('chunk has too many syntax levels'); }

  parseChunk() {
    const body = this.block();
    if (!this.check('<eof>')) this.errNear("'<eof>' expected");
    return body;
  }
  blockEnd() { const t = this.tok.t; return t === 'end' || t === 'else' || t === 'elseif' || t === 'until' || t === '<eof>'; }
  block() {
    const stmts = [];
    while (!this.blockEnd()) {
      if (this.check('return')) {
        const line = this.next().line;
        const exprs = this.blockEnd() || this.check(';') ? [] : this.exprlist();
        this.accept(';');
        if (!this.blockEnd()) this.errNear("'end' expected");
        stmts.push({ k: 'Return', exprs, line });
        break;
      }
      this.enter();
      const s = this.statement();
      this.depth--;
      if (s) stmts.push(s);
    }
    return stmts;
  }
  statement() {
    const t = this.tok, line = t.line;
    switch (t.t) {
      case ';': this.i++; return null;
      case 'if': {
        this.i++;
        const conds = [this.expr()], blocks = [];
        this.expect('then'); blocks.push(this.block());
        while (this.accept('elseif')) { conds.push(this.expr()); this.expect('then'); blocks.push(this.block()); }
        const els = this.accept('else') ? this.block() : null;
        this.expectMatch('end', 'if', line);
        return { k: 'If', conds, blocks, els, line };
      }
      case 'while': {
        this.i++;
        const cond = this.expr(); this.expect('do');
        const body = this.block(); this.expectMatch('end', 'while', line);
        return { k: 'While', cond, body, line };
      }
      case 'do': { this.i++; const body = this.block(); this.expectMatch('end', 'do', line); return { k: 'Do', body, line }; }
      case 'for': {
        this.i++;
        const n1 = this.name();
        if (this.accept('=')) {
          const start = this.expr(); this.expect(',');
          const limit = this.expr(), step = this.accept(',') ? this.expr() : null;
          this.expect('do'); const body = this.block(); this.expectMatch('end', 'for', line);
          return { k: 'NumFor', v: n1, start, limit, step, body, line };
        }
        if (!this.check(',') && !this.check('in')) this.errNear("'=' or 'in' expected");
        const names = [n1];
        while (this.accept(',')) names.push(this.name());
        this.expect('in');
        const exprs = this.exprlist(); this.expect('do');
        const body = this.block(); this.expectMatch('end', 'for', line);
        return { k: 'GenFor', names, exprs, body, line };
      }
      case 'repeat': {
        this.i++;
        const body = this.block(); this.expectMatch('until', 'repeat', line);
        return { k: 'Repeat', body, cond: this.expr(), line };
      }
      case 'function': {
        this.i++;
        const path = [this.name()];
        let method = null;
        while (this.accept('.')) path.push(this.name());
        if (this.accept(':')) method = this.name();
        const func = this.funcbody(line, !!method, path.join('.') + (method ? ':' + method : ''));
        return { k: 'FuncStat', path, method, func, line };
      }
      case 'local': {
        this.i++;
        if (this.accept('function')) { const name = this.name(); return { k: 'LocalFunc', name, func: this.funcbody(line, false, name), line }; }
        const names = [], consts = [];
        do {
          names.push(this.name());
          let isConst = false;
          if (this.check('<')) {
            this.i++;
            const at = this.tok, a = this.name();
            if (a === 'close') this.fail("'<close>' variables are not supported in Mote", at);
            if (a !== 'const') this.fail(`unknown attribute '${a}'`, at);
            this.expect('>'); isConst = true;
          }
          consts.push(isConst);
        } while (this.accept(','));
        const exprs = this.accept('=') ? this.exprlist() : [];
        return { k: 'Local', names, consts, exprs, line };
      }
      case 'break': this.i++; return { k: 'Break', line };
      case 'goto': case '::': this.fail("'goto' and labels are not supported in Mote"); break;
      default: {
        const e = this.suffixedexp();
        if (this.check('=') || this.check(',')) {
          const targets = [e];
          while (this.accept(',')) targets.push(this.suffixedexp());
          for (const x of targets) if (x.k !== 'Name' && x.k !== 'Index') this.errNear('syntax error');
          this.expect('=');
          return { k: 'Assign', targets, exprs: this.exprlist(), line };
        }
        if (e.k !== 'Call' && e.k !== 'Method') this.errNear('syntax error');
        return { k: 'CallStat', call: e, line };
      }
    }
  }
  funcbody(line, isMethod, name) {
    this.expect('(');
    const params = isMethod ? ['self'] : [];
    let vararg = false;
    if (!this.check(')')) {
      do {
        if (this.accept('...')) { vararg = true; break; }
        params.push(this.name());
      } while (this.accept(','));
    }
    this.expect(')');
    this.va.push(vararg);
    const body = this.block();
    this.va.pop();
    const endLine = this.tok.line;
    this.expectMatch('end', 'function', line);
    return { k: 'Func', params, vararg, body, line, endLine, name };
  }
  exprlist() { const l = [this.expr()]; while (this.accept(',')) l.push(this.expr()); return l; }
  expr(limit = 0) {
    this.enter();
    const t = this.tok;
    let e;
    if (t.t === 'not' || t.t === '-' || t.t === '#' || t.t === '~') {
      if (t.t === '~') this.fail('bitwise operators are not supported in Mote');
      this.i++;
      const a = this.expr(UNARY_PRI);
      e = t.t === '-' && a.k === 'Num' && a.v !== 0 ? { k: 'Num', v: -a.v, line: t.line } : { k: 'Un', op: t.t, a, line: t.line };
    } else e = this.simpleexp();
    for (;;) {
      const op = this.tok.t, pr = BINPRI[op];
      if (!pr || pr[0] <= limit) break;
      if (BITOPS.has(op)) this.fail('bitwise operators are not supported in Mote');
      const line = this.tok.line;
      this.i++;
      const b = this.expr(pr[1]);
      e = op === 'and' ? { k: 'And', a: e, b, line } : op === 'or' ? { k: 'Or', a: e, b, line } : { k: 'Bin', op, a: e, b, line };
    }
    this.depth--;
    return e;
  }
  simpleexp() {
    const t = this.tok, line = t.line;
    switch (t.t) {
      case 'num': this.i++; return { k: 'Num', v: t.v, line };
      case 'str': this.i++; return { k: 'Str', v: t.v, line };
      case 'nil': this.i++; return { k: 'Nil', line };
      case 'true': this.i++; return { k: 'True', line };
      case 'false': this.i++; return { k: 'False', line };
      case '...':
        if (!this.va[this.va.length - 1]) this.fail("cannot use '...' outside a vararg function");
        this.i++; return { k: 'Vararg', line };
      case '{': return this.table();
      case 'function': this.i++; return this.funcbody(line, false, null);
      default: return this.suffixedexp();
    }
  }
  primaryexp() {
    const t = this.tok;
    if (t.t === 'name') { this.i++; return { k: 'Name', name: t.v, line: t.line }; }
    if (t.t === '(') {
      this.i++;
      const e = this.expr();
      this.expectMatch(')', '(', t.line);
      return { k: 'Paren', e, line: t.line };
    }
    this.errNear('unexpected symbol');
  }
  suffixedexp() {
    let e = this.primaryexp();
    for (;;) {
      const t = this.tok, line = t.line;
      switch (t.t) {
        case '.': this.i++; e = { k: 'Index', obj: e, key: { k: 'Str', v: this.name(), line }, line }; break;
        case '[': { this.i++; const key = this.expr(); this.expect(']'); e = { k: 'Index', obj: e, key, line }; break; }
        case ':': { this.i++; const name = this.name(); e = { k: 'Method', obj: e, name, args: this.callargs(), line }; break; }
        case '(': case 'str': case '{': e = { k: 'Call', fn: e, args: this.callargs(), line }; break;
        default: return e;
      }
    }
  }
  callargs() {
    const t = this.tok;
    if (t.t === 'str') { this.i++; return [{ k: 'Str', v: t.v, line: t.line }]; }
    if (t.t === '{') return [this.table()];
    this.expect('(');
    if (this.accept(')')) return [];
    const l = this.exprlist();
    this.expectMatch(')', '(', t.line);
    return l;
  }
  table() {
    const line = this.expect('{').line, items = [];
    while (!this.check('}')) {
      if (this.check('[')) {
        this.i++;
        const key = this.expr(); this.expect(']'); this.expect('=');
        items.push({ type: 'key', key, v: this.expr() });
      } else if (this.check('name') && this.toks[this.i + 1].t === '=') {
        const name = this.name(); this.i++;
        items.push({ type: 'named', name, v: this.expr() });
      } else items.push({ type: 'pos', v: this.expr() });
      if (!this.accept(',') && !this.accept(';')) break;
    }
    this.expectMatch('}', '{', line);
    return { k: 'Table', items, line };
  }
}

// ══════════════════════════════════════════ bytecode ═════════════════════════════════════════════
// Each instruction is 4 numbers: op, a, b, c. The VM is a stack machine: locals live in slots
// 0..nslots-1 of a frame's array R, the operand stack grows above them.

const NIL = 0, LOADK = 1, TRUE = 2, FALSE = 3, GETL = 4, SETL = 5, GETU = 6, SETU = 7, GETG = 8, SETG = 9,
  GETI = 10, GETF = 11, SETI = 12, SETF = 13, SETIL = 14, SELF = 15, NEWT = 16, TSETI = 17, TSETF = 18,
  TSETK = 19, SETLIST = 20, ADD = 21, SUB = 22, MUL = 23, DIV = 24, MOD = 25, IDIV = 26, POW = 27,
  CONCAT = 28, EQ = 29, NE = 30, LT = 31, LE = 32, GT = 33, GE = 34, UNM = 35, NOT = 36, LEN = 37,
  JMP = 38, JMPF = 39, JMPT = 40, AND = 41, OR = 42, POP = 43, CALL = 44, TAILCALL = 45, RET = 46,
  VARARG = 47, CLOSURE = 48, CLOSE = 49, FORPREP = 50, FORLOOP = 51, TFORLOOP = 52;
const BINOP = { '+': ADD, '-': SUB, '*': MUL, '/': DIV, '%': MOD, '//': IDIV, '^': POW, '..': CONCAT,
  '==': EQ, '~=': NE, '<': LT, '<=': LE, '>': GT, '>=': GE };
const EVENTS = { [ADD]: '__add', [SUB]: '__sub', [MUL]: '__mul', [DIV]: '__div', [MOD]: '__mod', [IDIV]: '__idiv',
  [POW]: '__pow', [UNM]: '__unm', [CONCAT]: '__concat' };

// ═════════════════════════════════════════ compiler ══════════════════════════════════════════════

/** A compiled function: bytecode, constants, nested protos, upvalue descriptors, debug info. */
class Proto {
  constructor(name, line, chunk) {
    this.code = []; this.lines = []; this.k = []; this.kmap = new Map(); this.protos = []; this.ups = [];
    this.nparams = 0; this.vararg = false; this.nslots = 0; this.name = name; this.line = line; this.chunk = chunk;
    this.dbg = []; this.isMain = false; this.tramp = false;
  }
}
class FuncState {
  constructor(parent, name, line, chunk) {
    this.parent = parent;
    this.p = new Proto(name, line, chunk);
    this.actives = [];   // {name, slot, captured, isConst}, innermost last
    this.upnames = []; this.upvars = [];
    this.block = null;
  }
}
const isMulti = e => e.k === 'Call' || e.k === 'Method' || e.k === 'Vararg';

class Compiler {
  constructor(chunk) { this.chunk = chunk; this.fs = null; this.line = 1; }
  err(msg, line) { throw new MoteError(`${this.chunk}:${line}: ${msg}`, { kind: 'syntax', chunk: this.chunk, line }); }
  emit(op, a = 0, b = 0, c = 0) {
    const p = this.fs.p, at = p.code.length;
    p.code.push(op, a, b, c); p.lines.push(this.line);
    return at;
  }
  here() { return this.fs.p.code.length; }
  setDbg(d) { if (d) this.fs.p.dbg[(this.fs.p.code.length >> 2) - 1] = d; }   // describes the last instruction's operands
  k(v) {
    const p = this.fs.p;
    let i = p.kmap.get(v);
    if (i === undefined) { i = p.k.length; p.k.push(v); p.kmap.set(v, i); }
    return i;
  }
  declare(name, isConst) {
    const fs = this.fs, v = { name, slot: fs.actives.length, captured: false, isConst: !!isConst };
    fs.actives.push(v);
    if (fs.actives.length > fs.p.nslots) fs.p.nslots = fs.actives.length;
    return v;
  }
  enterBlock(loop) { this.fs.block = { parent: this.fs.block, base: this.fs.actives.length, loop, breaks: [] }; }
  leaveBlock(close = true) {
    const fs = this.fs, b = fs.block;
    if (close && fs.actives.slice(b.base).some(v => v.captured)) this.emit(CLOSE, b.base);
    fs.actives.length = b.base;
    fs.block = b.parent;
    return b;
  }
  patchBreaks(b) { for (const j of b.breaks) this.fs.p.code[j + 1] = this.here(); }

  compileChunk(body) {
    this.fs = new FuncState(null, 'main chunk', 0, this.chunk);
    this.fs.p.vararg = true; this.fs.p.isMain = true;
    this.block(body);
    this.emit(RET, 0, 0, 0);
    const p = this.fs.p;
    finishProto(p);
    return p;
  }
  block(stmts) { for (const s of stmts) this.stmt(s); }
  scoped(stmts) { this.enterBlock(false); this.block(stmts); this.leaveBlock(); }

  resolveIn(fs, name) {
    for (let i = fs.actives.length - 1; i >= 0; i--) {
      const v = fs.actives[i];
      if (v.name === name) return { k: 'local', slot: v.slot, v };
    }
    const idx = fs.upnames.indexOf(name);
    if (idx >= 0) return { k: 'up', idx, v: fs.upvars[idx] };
    if (!fs.parent) return null;
    const r = this.resolveIn(fs.parent, name);
    if (!r) return null;
    if (r.k === 'local') { r.v.captured = true; fs.p.ups.push(1, r.slot); } else fs.p.ups.push(0, r.idx);
    fs.upnames.push(name); fs.upvars.push(r.v);
    return { k: 'up', idx: fs.upnames.length - 1, v: r.v };
  }
  describe(e) {
    if (!e) return null;
    if (e.k === 'Name') {
      if (this.fs.actives.some(v => v.name === e.name)) return `local '${e.name}'`;
      if (this.fs.upnames.includes(e.name)) return `upvalue '${e.name}'`;
      return `global '${e.name}'`;
    }
    if (e.k === 'Index' && e.key.k === 'Str') return `field '${e.key.v}'`;
    if (e.k === 'Str') return `constant '${e.v.length > 30 ? e.v.slice(0, 27) + '...' : e.v}'`;
    return null;
  }

  // ── statements ──
  stmt(s) {
    this.line = s.line;
    switch (s.k) {
      case 'Local': {
        const n = s.names.length;
        if (n === 1 && s.exprs.length === 1 && s.exprs[0].k === 'Func' && !s.exprs[0].name) s.exprs[0].name = s.names[0];
        this.explist(s.exprs, n);
        const vars = s.names.map((nm, i) => this.declare(nm, s.consts[i]));
        for (let i = n - 1; i >= 0; i--) this.emit(SETL, vars[i].slot);
        break;
      }
      case 'LocalFunc': {
        const v = this.declare(s.name);
        this.funcExp(s.func);
        this.emit(SETL, v.slot);
        break;
      }
      case 'Assign': this.assign(s); break;
      case 'CallStat': this.callExp(s.call, 0); break;
      case 'Do': this.scoped(s.body); break;
      case 'While': {
        const top = this.here();
        this.exp(s.cond);
        const jf = this.emit(JMPF);
        this.enterBlock(true); this.block(s.body); const b = this.leaveBlock();
        this.emit(JMP, top);
        this.fs.p.code[jf + 1] = this.here();
        this.patchBreaks(b);
        break;
      }
      case 'Repeat': {
        const top = this.here();
        this.enterBlock(true);
        this.block(s.body);
        this.exp(s.cond);
        const b = this.fs.block;
        if (this.fs.actives.slice(b.base).some(v => v.captured)) this.emit(CLOSE, b.base);
        this.emit(JMPF, top);
        this.leaveBlock(false);
        this.patchBreaks(b);
        break;
      }
      case 'If': {
        const ends = [];
        s.conds.forEach((c, i) => {
          this.exp(c);
          const jf = this.emit(JMPF);
          this.scoped(s.blocks[i]);
          if (i < s.conds.length - 1 || s.els) ends.push(this.emit(JMP));
          this.fs.p.code[jf + 1] = this.here();
        });
        if (s.els) this.scoped(s.els);
        for (const j of ends) this.fs.p.code[j + 1] = this.here();
        break;
      }
      case 'NumFor': {
        this.enterBlock(true);
        this.exp(s.start); this.exp(s.limit);
        if (s.step) this.exp(s.step); else this.emit(LOADK, this.k(1));
        const base = this.fs.actives.length;
        this.declare('(for)'); this.declare('(for)'); this.declare('(for)');
        this.emit(SETL, base + 2); this.emit(SETL, base + 1); this.emit(SETL, base);
        this.line = s.line;
        const prep = this.emit(FORPREP, base);
        const body = this.here();
        this.enterBlock(false); this.declare(s.v); this.block(s.body); this.leaveBlock();
        this.line = s.line;
        this.emit(FORLOOP, base, body);
        this.fs.p.code[prep + 2] = this.here();
        this.patchBreaks(this.leaveBlock());
        break;
      }
      case 'GenFor': {
        this.enterBlock(true);
        this.explist(s.exprs, 3);
        const base = this.fs.actives.length, nv = s.names.length;
        this.declare('(for)'); this.declare('(for)'); this.declare('(for)');
        this.emit(SETL, base + 2); this.emit(SETL, base + 1); this.emit(SETL, base);
        const top = this.here();
        this.line = s.line;
        this.emit(GETL, base); this.emit(GETL, base + 1); this.emit(GETL, base + 2);
        this.emit(CALL, 2, nv, 0); this.setDbg('for iterator');
        const tf = this.emit(TFORLOOP, base, nv);
        this.enterBlock(false);
        for (const nm of s.names) this.declare(nm);
        this.block(s.body);
        this.leaveBlock();
        this.emit(JMP, top);
        this.fs.p.code[tf + 3] = this.here();
        this.patchBreaks(this.leaveBlock());
        break;
      }
      case 'FuncStat': {
        const { path, method } = s;
        if (path.length === 1 && !method) { this.funcExp(s.func); this.store({ k: 'Name', name: path[0], line: s.line }); break; }
        const objPath = method ? path : path.slice(0, -1), key = method || path[path.length - 1];
        this.exp({ k: 'Name', name: objPath[0], line: s.line });
        for (let i = 1; i < objPath.length; i++) this.emit(GETF, this.k(objPath[i]));
        this.funcExp(s.func);
        this.line = s.line;
        this.emit(SETF, this.k(key));
        break;
      }
      case 'Return': {
        const ex = s.exprs;
        if (ex.length === 1 && (ex[0].k === 'Call' || ex[0].k === 'Method')) {
          this.callExp(ex[0], -1, true);
          this.emit(RET, 0, 0, 1);
        } else {
          const r = this.explist(ex, -1);
          this.emit(RET, r.fixed, 0, r.variable ? 1 : 0);
        }
        break;
      }
      case 'Break': {
        let b = this.fs.block;
        while (b && !b.loop) b = b.parent;
        if (!b) this.err("break outside a loop", s.line);
        this.emit(CLOSE, b.base);
        b.breaks.push(this.emit(JMP));
        break;
      }
    }
  }
  store(target) {   // pops the top value into a Name target
    const r = this.resolveIn(this.fs, target.name);
    if (r && r.v && r.v.isConst) this.err(`attempt to assign to const variable '${target.name}'`, target.line);
    if (!r) this.emit(SETG, this.k(target.name));
    else if (r.k === 'local') this.emit(SETL, r.slot);
    else this.emit(SETU, r.idx);
  }
  assign(s) {
    const { targets, exprs } = s;
    if (targets.length === 1 && exprs.length === 1) {
      const t = targets[0];
      if (t.k === 'Name') { this.exp(exprs[0]); this.line = s.line; this.store(t); return; }
      this.exp(t.obj);
      if (t.key.k === 'Str') { this.exp(exprs[0]); this.line = s.line; this.emit(SETF, this.k(t.key.v)); }
      else { this.exp(t.key); this.exp(exprs[0]); this.line = s.line; this.emit(SETI); }
      this.setDbg(this.describe(t.obj));
      return;
    }
    // multiple targets: evaluate table/key of indexed targets into hidden locals, then the values
    const fs = this.fs, saved = fs.actives.length, slots = [];
    for (const t of targets) {
      if (t.k !== 'Index') { slots.push(null); continue; }
      this.exp(t.obj); const o = this.declare('(tmp)'); this.emit(SETL, o.slot);
      this.exp(t.key); const kk = this.declare('(tmp)'); this.emit(SETL, kk.slot);
      slots.push([o.slot, kk.slot]);
    }
    this.explist(exprs, targets.length);
    this.line = s.line;
    for (let i = targets.length - 1; i >= 0; i--) {
      if (slots[i]) { this.emit(SETIL, slots[i][0], slots[i][1]); this.setDbg(this.describe(targets[i].obj)); }
      else this.store(targets[i]);
    }
    fs.actives.length = saved;
  }

  // ── expressions ──
  /** Pushes exactly n values (n >= 0); with n = -1 pushes all and returns {fixed, variable}. */
  explist(list, n) {
    const len = list.length;
    if (n === -1) {
      if (!len) return { fixed: 0, variable: false };
      for (let i = 0; i < len - 1; i++) this.exp(list[i]);
      const last = list[len - 1];
      if (isMulti(last)) { this.multi(last, -1); return { fixed: len - 1, variable: true }; }
      this.exp(last);
      return { fixed: len, variable: false };
    }
    if (!len) { if (n) this.emit(NIL, n); return; }
    for (let i = 0; i < len - 1; i++) this.exp(list[i]);
    const last = list[len - 1];
    if (isMulti(last)) {
      const want = n - (len - 1);
      this.multi(last, Math.max(want, 0));
      if (want < 0) this.emit(POP, -want);
    } else {
      this.exp(last);
      if (len > n) this.emit(POP, len - n); else if (len < n) this.emit(NIL, n - len);
    }
  }
  multi(e, nres) { if (e.k === 'Vararg') { this.line = e.line; this.emit(VARARG, nres); } else this.callExp(e, nres); }
  callExp(e, nres, tail) {
    let fixed = 0, variable = 0;
    if (e.k === 'Method') {
      this.exp(e.obj);
      this.line = e.line;
      this.emit(SELF, this.k(e.name)); this.setDbg(this.describe(e.obj));
      fixed = 1;
    } else this.exp(e.fn);
    e.args.forEach((a, i) => {
      if (i === e.args.length - 1 && isMulti(a)) { this.multi(a, -1); variable = 1; } else { this.exp(a); fixed++; }
    });
    this.line = e.line;
    this.emit(tail ? TAILCALL : CALL, fixed, nres, variable);
    this.setDbg(e.k === 'Method' ? `method '${e.name}'` : this.describe(e.fn));
  }
  funcExp(e) {
    const parent = this.fs;
    const fs = this.fs = new FuncState(parent, e.name || 'anonymous', e.line, this.chunk);
    fs.p.vararg = e.vararg; fs.p.nparams = e.params.length;
    for (const pn of e.params) this.declare(pn);
    this.block(e.body);
    this.line = e.endLine;
    this.emit(RET, 0, 0, 0);
    finishProto(fs.p);
    this.fs = parent;
    parent.p.protos.push(fs.p);
    this.line = e.line;
    this.emit(CLOSURE, parent.p.protos.length - 1);
  }
  exp(e) {
    if (e.line) this.line = e.line;
    switch (e.k) {
      case 'Nil': this.emit(NIL, 1); break;
      case 'True': this.emit(TRUE); break;
      case 'False': this.emit(FALSE); break;
      case 'Num': case 'Str': this.emit(LOADK, this.k(e.v)); break;
      case 'Vararg': this.emit(VARARG, 1); break;
      case 'Func': this.funcExp(e); break;
      case 'Name': {
        const r = this.resolveIn(this.fs, e.name);
        if (!r) this.emit(GETG, this.k(e.name));
        else if (r.k === 'local') this.emit(GETL, r.slot);
        else this.emit(GETU, r.idx);
        break;
      }
      case 'Index':
        this.exp(e.obj);
        if (e.key.k === 'Str') { this.line = e.line; this.emit(GETF, this.k(e.key.v)); }
        else { this.exp(e.key); this.line = e.line; this.emit(GETI); }
        this.setDbg(this.describe(e.obj));
        break;
      case 'Call': case 'Method': this.callExp(e, 1); break;
      case 'Paren': this.exp(e.e); break;
      case 'And': case 'Or': {
        this.exp(e.a);
        const j = this.emit(e.k === 'And' ? AND : OR);
        this.exp(e.b);
        this.fs.p.code[j + 1] = this.here();
        break;
      }
      case 'Bin':
        this.exp(e.a); this.exp(e.b);
        this.line = e.line;
        this.emit(BINOP[e.op]);
        this.setDbg([this.describe(e.a), this.describe(e.b)]);
        break;
      case 'Un':
        this.exp(e.a);
        this.line = e.line;
        this.emit(e.op === '-' ? UNM : e.op === 'not' ? NOT : LEN);
        this.setDbg(this.describe(e.a));
        break;
      case 'Table': {
        this.emit(NEWT);
        let ai = 1;
        e.items.forEach((it, i) => {
          if (it.type === 'pos') {
            if (i === e.items.length - 1 && isMulti(it.v)) { this.multi(it.v, -1); this.emit(SETLIST, ai); }
            else { this.exp(it.v); this.emit(TSETI, ai++); }
          } else if (it.type === 'named') { this.exp(it.v); this.emit(TSETF, this.k(it.name)); }
          else { this.exp(it.key); this.exp(it.v); this.emit(TSETK); }
        });
        break;
      }
      default: throw new Error('Mote compiler: unknown node ' + e.k);
    }
  }
}
function finishProto(p) { p.kmap = null; p.code = Int32Array.from(p.code); }

// A hand-assembled function used to call any value (host function, table with __call) as a frame:
// varargs are (f, args...); it calls f and returns all results. pcall, coroutines and nested calls
// use it so every protected region and coroutine bottom is a Mote frame.
const TRAMP = new LClosure(Object.assign(new Proto('?', 0, '[host]'), { code: Int32Array.from([VARARG, -1, 0, 0, CALL, -1, -1, 1, RET, 0, 0, 1]),
  lines: [0, 0, 0], kmap: null, vararg: true, tramp: true }), []);

// ═══════════════════════════════════════════════ VM ══════════════════════════════════════════════

// frame.post: what happens to a frame's results when it returns
const P_NONE = 0, P_BOOL = 1, P_NOT = 2, P_PCALL = 3, P_XPCALL = 4, P_BOUNDARY = 5, P_SELF = 6;
// HostFn.special: functions the VM implements itself
const S_PCALL = 1, S_XPCALL = 2, S_YIELD = 3, S_RESUME = 4, S_WRAP = 5;
const R_RESUME = 0, R_WRAP = 1;
const EMPTY = [];
const MAX_NEST = 180;    // nested host→Mote calls (they use the JS stack)
const SZ_TABLE = 40, SZ_SLOT = 16, SZ_CLOSURE = 32, SZ_STR = 16;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const BLOCKED = new Set(['__proto__', 'constructor', 'prototype', '__defineGetter__', '__defineSetter__',
  '__lookupGetter__', '__lookupSetter__', 'caller', 'callee', 'arguments']);

class Frame {
  constructor(cl, R, va, nres, post) {
    this.cl = cl; this.p = cl.p; this.R = R; this.va = va; this.pc = 0; this.sp = cl.p.nslots;
    this.nres = nres; this.post = post; this.vn = 0; this.open = null; this.aux = undefined; this.handler = undefined;
  }
}
const top = co => co.frames[co.frames.length - 1];
const lineOf = f => (f.pc > 0 && f.p.lines[(f.pc >> 2) - 1]) || f.p.line;

class Thread {
  constructor(vm, co, args) { this._vm = vm; this._co = co; this._args = args || []; }
  get status() { return this._co.status; }
  /** Resume with values. The first resume passes vm.thread()'s extra args first. → {done, values} */
  resume(...vals) { const a = this._args.concat(vals); this._args = []; return this._vm._resumeThread(this._co, a); }
}

class VM {
  constructor(opts = {}) {
    this.opts = opts;
    this.maxSteps = opts.maxSteps === undefined ? 1e7 : opts.maxSteps;
    this.maxMemory = opts.maxMemory === undefined ? 16e6 : opts.maxMemory;
    this.maxDepth = opts.maxDepth === undefined ? 20000 : opts.maxDepth;
    this.printFn = opts.print || (s => console.log(s));
    this.reset();
  }
  /** Fresh globals and standard library; host-set globals are dropped. */
  reset() {
    this.G = new LTable(); this.strmt = null; this.cur = null; this.depth = 0;
    this.budget = this.budgetStart = 0; this.mem = 0; this.idc = 0; this.totalSteps = 0;
    this.toMoteMap = new WeakMap(); this.toJSMap = new WeakMap(); this.refCache = new WeakMap(); this.proxies = new WeakMap();
    this.rng = makeRng(this.opts.seed === undefined ? 0 : this.opts.seed);
    openLibs(this, this.opts.stdlib || DEFAULT_LIBS);
  }

  // ── accounting ──
  limitError(msg) { const e = new MoteError(msg, { kind: 'limit' }); e.needsWhere = true; return e; }
  outOfSteps() { this.budget = 0; throw this.limitError(`step budget exhausted (${this.budgetStart} steps)`); }
  alloc(n) { if ((this.mem += n) > this.maxMemory && this.depth > 0) throw this.limitError(`memory limit exceeded (${this.maxMemory})`); }
  tick(n) { if ((this.budget -= n) < 0) this.outOfSteps(); }
  beginEntry() {
    if (this.depth > 0) return;
    this.budget = this.budgetStart = Math.min(this.maxSteps, MAX_SAFE);
    this.mem = 0;
  }
  endEntry() { if (this.depth === 0) this.totalSteps += this.budgetStart - Math.max(this.budget, 0); }

  // ── helpers ──
  newTable() { this.alloc(SZ_TABLE); return new LTable(); }
  rawset(t, k, v) {
    if (k === undefined) throw rt('table index is nil');
    if (k !== k) throw rt('table index is NaN');
    if (t.set(k, v)) this.alloc(SZ_SLOT);
  }
  getmt(v) { return v instanceof LTable ? v.mt : typeof v === 'string' ? this.strmt : null; }
  metaOf(v, ev) { const mt = this.getmt(v); return mt ? mt.get(ev) : undefined; }
  idOf(v) { if (!v.id) v.id = ++this.idc; return '0x' + v.id.toString(16).padStart(8, '0'); }
  tostr(v) {
    switch (typeof v) {
      case 'string': return v;
      case 'number': return num2str(v);
      case 'boolean': return v ? 'true' : 'false';
      case 'undefined': return 'nil';
    }
    const mt = this.getmt(v);
    if (mt) {
      const h = mt.get('__tostring');
      if (h !== undefined) {
        const r = this.callNested(h, [v])[0];
        if (typeof r === 'string') return r;
        if (typeof r === 'number') return num2str(r);
        throw rt("'__tostring' must return a string");
      }
      const nm = mt.get('__name');
      if (typeof nm === 'string') return `${nm}: ${this.idOf(v)}`;
    }
    return `${typeOf(v)}: ${this.idOf(v)}`;
  }
  where(level) {
    const fs = this.cur ? this.cur.frames : EMPTY, i = fs.length - level;
    if (i < 0) return '';
    const f = fs[i];
    return f.p.tramp ? '' : `${f.p.chunk}:${lineOf(f)}: `;
  }
  descr(i) {   // " (local 'x')" for the operand i of the instruction that is failing
    const f = top(this.cur), d = f.p.dbg[(f.pc >> 2) - 1];
    const s = Array.isArray(d) ? d[i] : (i ? null : d);
    return s ? ` (${s})` : '';
  }
  traceback(co, from) {
    const out = ['stack traceback:'];
    for (let i = co.frames.length - 1; i >= from; i--) {
      const f = co.frames[i];
      if (f.p.tramp) { out.push('\t[host]: in ?'); continue; }
      out.push(`\t${f.p.chunk}:${lineOf(f)}: in ${f.p.isMain ? 'main chunk' : `function '${f.p.name}'`}`);
    }
    return out.join('\n');
  }

  // ── calls ──
  pushFrame(co, cl, src, start, n, nres, post) {
    if (co.frames.length >= this.maxDepth) throw rt('stack overflow');
    const p = cl.p, np = p.nparams, R = new Array(p.nslots + 12);
    for (let i = 0; i < np; i++) R[i] = i < n ? src[start + i] : undefined;
    const va = p.vararg && n > np ? src.slice(start + np, start + n) : EMPTY;
    const f = new Frame(cl, R, va, nres, post);
    co.frames.push(f);
    return f;
  }
  /** Delivers results to frame fr (the caller), adjusted to nres, after applying post. */
  deliver(fr, vals, nres, post, aux) {
    switch (post) {
      case P_BOOL: vals = [truthy(vals[0])]; break;
      case P_NOT: vals = [!truthy(vals[0])]; break;
      case P_PCALL: case P_XPCALL: vals = [true].concat(vals); break;
    }
    const R = fr.R;
    let sp = fr.sp;
    if (nres < 0) { for (let i = 0; i < vals.length; i++) R[sp++] = vals[i]; fr.vn = vals.length; }
    else for (let i = 0; i < nres; i++) R[sp++] = vals[i];
    if (post === P_SELF) R[sp++] = aux;
    fr.sp = sp;
  }
  /** Call any value from inside the VM loop: a closure gets a frame, a host function runs now. */
  callValue(f, args, nres, post, aux) {
    if (f instanceof LClosure) { this.pushFrame(this.cur, f, args, 0, args.length, nres, post).aux = aux; return; }
    if (f instanceof HostFn) return this.callHost(f, args, nres, post, aux);
    const h = this.metaOf(f, '__call');
    if (h !== undefined) return this.callValue(h, [f].concat(args), nres, post, aux);
    throw rt(`attempt to call a ${typeOf(f)} value${this.descr(0)}`);
  }
  callHost(f, args, nres, post, aux) {
    const co = this.cur;
    switch (f.special) {
      case 0: {
        const r = f.fn(args, this);
        if (r instanceof YieldReq) return this.yieldCo(co, r.vals, nres, post);
        this.deliver(top(co), r, nres, post, aux);
        return;
      }
      case S_PCALL: case S_XPCALL: {
        const x = f.special === S_XPCALL;
        if (!args.length) throw rt(`bad argument #1 to '${f.name}' (value expected)`);
        const g = args[0], rest = x ? args.slice(2) : args.slice(1);
        const fr = g instanceof LClosure ? this.pushFrame(co, g, rest, 0, rest.length, nres, x ? P_XPCALL : P_PCALL)
          : this.pushFrame(co, TRAMP, [g].concat(rest), 0, rest.length + 1, nres, x ? P_XPCALL : P_PCALL);
        if (x) fr.handler = args[1];
        return;
      }
      case S_YIELD: return this.yieldCo(co, args, nres, post);
      case S_RESUME: case S_WRAP: {
        const wrap = f.special === S_WRAP, B = wrap ? f.co : args[0];
        if (!(B instanceof Coroutine)) throw rt(`bad argument #1 to 'resume' (coroutine expected)`);
        if (B.status !== 'suspended') {
          const msg = `cannot resume ${B.status === 'dead' ? 'dead' : 'non-suspended'} coroutine`;
          if (wrap) throw rt(msg);
          this.deliver(top(co), [false, msg], nres, post);
          return;
        }
        co.status = 'normal'; co.rNres = nres; co.rPost = post; co.rMode = wrap ? R_WRAP : R_RESUME;
        B.resumer = co;
        return this.startResume(B, wrap ? args : args.slice(1));
      }
    }
  }
  startResume(B, vals) {
    this.cur = B; B.status = 'running';
    if (!B.started) {
      B.started = true;
      if (B.fn instanceof LClosure) this.pushFrame(B, B.fn, vals, 0, vals.length, -1, P_NONE);
      else { const a = [B.fn].concat(vals); this.pushFrame(B, TRAMP, a, 0, a.length, -1, P_NONE); }
      return;
    }
    this.deliver(top(B), vals, B.yNres, B.yPost);
  }
  yieldCo(co, vals, nres, post) {
    if (co.isMain) throw new Throw('attempt to yield from outside a coroutine', false);
    if (co.nny > 0) throw new Throw('attempt to yield across a host call boundary', false);
    co.status = 'suspended'; co.yNres = nres; co.yPost = post;
    const R = co.resumer;
    co.resumer = null;
    if (!R) return { yielded: true, vals };
    this.cur = R; R.status = 'running';
    this.deliver(top(R), R.rMode === R_WRAP ? vals : [true].concat(vals), R.rNres, R.rPost);
  }
  finishCo(co, vals) {
    co.status = 'dead';
    const R = co.resumer;
    co.resumer = null;
    if (!R) return { done: true, vals };
    this.cur = R; R.status = 'running';
    this.deliver(top(R), R.rMode === R_WRAP ? vals : [true].concat(vals), R.rNres, R.rPost);
  }
  afterReturn(co, fr, vals) {
    if (fr.post === P_BOUNDARY) { co.nny--; return { vals }; }
    if (co.frames.length === 0) return this.finishCo(co, vals);
    this.deliver(top(co), vals, fr.nres, fr.post, fr.aux);
  }
  findUp(fr, idx) {
    let o = fr.open;
    if (o === null) o = fr.open = [];
    for (let i = 0; i < o.length; i++) if (o[i].i === idx) return o[i];
    const u = new UpVal(fr.R, idx);
    o.push(u);
    return u;
  }
  close(fr, level) {
    const o = fr.open;
    let j = 0;
    for (let i = 0; i < o.length; i++) {
      const u = o[i];
      if (u.i >= level) { u.R = [u.R[u.i]]; u.i = 0; } else o[j++] = u;
    }
    o.length = j;
    if (!j) fr.open = null;
  }
  /** Synchronous call from host code into Mote (runs a nested VM loop; no yields across it). */
  callNested(f, args) {
    const co = this.cur;
    if (this.depth >= MAX_NEST) throw rt('stack overflow (too many nested host calls)');
    if (f instanceof LClosure) this.pushFrame(co, f, args, 0, args.length, -1, P_BOUNDARY);
    else { const a = [f].concat(args); this.pushFrame(co, TRAMP, a, 0, a.length, -1, P_BOUNDARY); }
    co.nny++;
    this.depth++;
    try { return this.execute().vals; } finally { this.depth--; }
  }

  // ── metamethod-aware operations used by the VM loop (results go to the top frame) ──
  /** Resolves t[k] through __index tables; returns the value, or NEEDCALL with this.ih/this.it set. */
  lookup(t, k, inLoop) {
    for (let n = 0; n < 100; n++) {
      let h;
      if (t instanceof LTable) {
        const v = t.get(k);
        if (v !== undefined || t.mt === null) return v;
        h = t.mt.get('__index');
        if (h === undefined) return undefined;
      } else if (t instanceof Ref) return this.refGet(t, k);
      else {
        h = this.metaOf(t, '__index');
        if (h === undefined) throw rt(`attempt to index a ${typeOf(t)} value${inLoop && n === 0 ? this.descr(0) : ''}`);
      }
      if (h instanceof LClosure || h instanceof HostFn) { this.ih = h; this.it = t; return NEEDCALL; }
      t = h;
    }
    throw rt("'__index' chain too long; possible loop");
  }
  index(t, k, post, aux) {
    const v = this.lookup(t, k, true);
    if (v === NEEDCALL) return this.callValue(this.ih, [this.it, k], 1, post || P_NONE, aux);
    const fr = top(this.cur);
    fr.R[fr.sp++] = v;
    if (post === P_SELF) fr.R[fr.sp++] = aux;
  }
  indexSync(t, k) {
    const v = this.lookup(t, k, false);
    return v === NEEDCALL ? this.callNested(this.ih, [this.it, k])[0] : v;
  }
  /** Performs t[k] = v through __newindex tables; returns true with this.ih/this.it set when a handler must run. */
  lookupSet(t, k, v, inLoop) {
    for (let n = 0; n < 100; n++) {
      let h;
      if (t instanceof LTable) {
        if (t.mt === null || (h = t.mt.get('__newindex')) === undefined || t.get(k) !== undefined) { this.rawset(t, k, v); return false; }
      } else if (t instanceof Ref) { this.refSet(t, k, v); return false; }
      else {
        h = this.metaOf(t, '__newindex');
        if (h === undefined) throw rt(`attempt to index a ${typeOf(t)} value${inLoop && n === 0 ? this.descr(0) : ''}`);
      }
      if (h instanceof LClosure || h instanceof HostFn) { this.ih = h; this.it = t; return true; }
      t = h;
    }
    throw rt("'__newindex' chain too long; possible loop");
  }
  setindex(t, k, v) { if (this.lookupSet(t, k, v, true)) return this.callValue(this.ih, [this.it, k, v], 0, P_NONE); }
  setindexSync(t, k, v) { if (this.lookupSet(t, k, v, false)) this.callNested(this.ih, [this.it, k, v]); }
  push1(v) { const fr = top(this.cur); fr.R[fr.sp++] = v; }
  arith(op, x, y) {
    if (op === CONCAT) {
      const ok = v => typeof v === 'string' || typeof v === 'number';
      if (ok(x) && ok(y)) return this.push1(this.concat(x, y));
      const h = this.metaOf(x, '__concat') ?? this.metaOf(y, '__concat');
      if (h !== undefined) return this.callValue(h, [x, y], 1, P_NONE);
      const bad = ok(x) ? 1 : 0;
      throw rt(`attempt to concatenate a ${typeOf(bad ? y : x)} value${this.descr(bad)}`);
    }
    const nx = tonum(x), ny = tonum(y);
    if (nx !== undefined && ny !== undefined) return this.push1(arithNum(op, nx, ny));
    const ev = EVENTS[op], h = this.metaOf(x, ev) ?? this.metaOf(y, ev);
    if (h !== undefined) return this.callValue(h, [x, y], 1, P_NONE);
    const bad = nx === undefined ? 0 : 1, v = bad ? y : x;
    if (typeof v === 'string') throw rt(`attempt to perform arithmetic on a string value${this.descr(bad)}`);
    throw rt(`attempt to perform arithmetic on a ${typeOf(v)} value${this.descr(bad)}`);
  }
  concat(x, y) {
    const a = typeof x === 'string' ? x : num2str(x), b = typeof y === 'string' ? y : num2str(y);
    this.alloc(SZ_STR + Math.min(a.length, b.length));   // V8 builds ropes: charge the shorter side
    return a + b;
  }
  /** x < y (le: x <= y). Returns a boolean, or undefined after starting a metamethod call. */
  compare(le, x, y, post) {
    const tx = typeof x, ty = typeof y;
    if ((tx === 'number' && ty === 'number') || (tx === 'string' && ty === 'string')) return le ? x <= y : x < y;
    const ev = le ? '__le' : '__lt', h = this.metaOf(x, ev) ?? this.metaOf(y, ev);
    if (h !== undefined) {
      if (post === undefined) return truthy(this.callNested(h, [x, y])[0]);
      return this.callValue(h, [x, y], 1, post) || null;   // null: a frame was pushed
    }
    const a = typeOf(x), b = typeOf(y);
    throw rt(a === b ? `attempt to compare two ${a} values` : `attempt to compare ${a} with ${b}`);
  }
  lessThan(x, y) { return this.compare(false, x, y, undefined); }
  len(v) {
    if (typeof v === 'string') return this.push1(v.length);
    const h = this.metaOf(v, '__len');
    if (h !== undefined) return this.callValue(h, [v], 1, P_NONE);
    if (v instanceof LTable) return this.push1(v.arr.length);
    if (v instanceof Ref) return this.push1(this.refLen(v));
    throw rt(`attempt to get length of a ${typeOf(v)} value${this.descr(0)}`);
  }

  // ── the interpreter loop ──
  /** Runs this.cur until a nested boundary frame returns ({vals}), or a host-resumed coroutine
   *  yields ({yielded, vals}) or finishes ({done, vals}). Errors not caught by pcall propagate as MoteError. */
  execute() {
    // The case labels are numeric literals (opcode names in comments) so V8 compiles a jump table.
    const vm = this;
    let co, fr, R, code, K, pc = 0, sp = 0, ex;
    outer: for (;;) {
      try {
        co = vm.cur; fr = co.frames[co.frames.length - 1];
        R = fr.R; code = fr.p.code; K = fr.p.k; pc = fr.pc; sp = fr.sp;
        for (;;) {
          const op = code[pc], a = code[pc + 1];
          pc += 4;
          if (--vm.budget < 0) { fr.pc = pc; vm.outOfSteps(); }
          switch (op) {
            case 0 /* NIL */: for (let i = 0; i < a; i++) R[sp++] = undefined; break;
            case 1 /* LOADK */: R[sp++] = K[a]; break;
            case 2 /* TRUE */: R[sp++] = true; break;
            case 3 /* FALSE */: R[sp++] = false; break;
            case 4 /* GETL */: R[sp++] = R[a]; break;
            case 5 /* SETL */: R[a] = R[--sp]; break;
            case 6 /* GETU */: { const u = fr.cl.up[a]; R[sp++] = u.R[u.i]; break; }
            case 7 /* SETU */: { const u = fr.cl.up[a]; u.R[u.i] = R[--sp]; break; }
            case 8 /* GETG */: {
              const G = vm.G, v = G.get(K[a]);
              if (v !== undefined || G.mt === null) { R[sp++] = v; break; }
              fr.pc = pc; fr.sp = sp; if ((ex = vm.index(G, K[a])) !== undefined) return ex; continue outer;
            }
            case 9 /* SETG */: {
              const G = vm.G, v = R[--sp];
              if (G.mt === null) { vm.rawset(G, K[a], v); break; }
              fr.pc = pc; fr.sp = sp; if ((ex = vm.setindex(G, K[a], v)) !== undefined) return ex; continue outer;
            }
            case 10 /* GETI */: {
              const k = R[--sp], t = R[sp - 1];
              if (t instanceof LTable) { const v = t.get(k); if (v !== undefined || t.mt === null) { R[sp - 1] = v; break; } }
              fr.pc = pc; fr.sp = sp - 1; if ((ex = vm.index(t, k)) !== undefined) return ex; continue outer;
            }
            case 11 /* GETF */: {
              const t = R[sp - 1];
              if (t instanceof LTable) {
                let v = t.get(K[a]);
                if (v !== undefined || t.mt === null) { R[sp - 1] = v; break; }
                const h = t.mt.get('__index');   // one level of class-style __index tables inline
                if (h instanceof LTable && ((v = h.get(K[a])) !== undefined || h.mt === null)) { R[sp - 1] = v; break; }
              }
              fr.pc = pc; fr.sp = sp - 1; if ((ex = vm.index(t, K[a])) !== undefined) return ex; continue outer;
            }
            case 12 /* SETI */: {
              const v = R[--sp], k = R[--sp], t = R[--sp];
              if (t instanceof LTable && t.mt === null) { vm.rawset(t, k, v); break; }
              fr.pc = pc; fr.sp = sp; if ((ex = vm.setindex(t, k, v)) !== undefined) return ex; continue outer;
            }
            case 13 /* SETF */: {
              const v = R[--sp], t = R[--sp];
              if (t instanceof LTable && t.mt === null) { vm.rawset(t, K[a], v); break; }
              fr.pc = pc; fr.sp = sp; if ((ex = vm.setindex(t, K[a], v)) !== undefined) return ex; continue outer;
            }
            case 14 /* SETIL */: {
              const v = R[--sp], t = R[a], k = R[code[pc - 2]];
              if (t instanceof LTable && t.mt === null) { vm.rawset(t, k, v); break; }
              fr.pc = pc; fr.sp = sp; if ((ex = vm.setindex(t, k, v)) !== undefined) return ex; continue outer;
            }
            case 15 /* SELF */: {
              const o = R[sp - 1], key = K[a];
              let f;
              if (o instanceof LTable) {
                f = o.get(key);
                if (f !== undefined || o.mt === null) { R[sp - 1] = f; R[sp++] = o; break; }
                const h = o.mt.get('__index');
                if (h instanceof LTable && ((f = h.get(key)) !== undefined || h.mt === null)) { R[sp - 1] = f; R[sp++] = o; break; }
              }
              else if (typeof o === 'string' && vm.strmt !== null) {
                const s = vm.strmt.get('__index');
                if (s instanceof LTable && (f = s.get(key)) !== undefined) { R[sp - 1] = f; R[sp++] = o; break; }
              }
              fr.pc = pc; fr.sp = sp - 1; if ((ex = vm.index(o, key, P_SELF, o)) !== undefined) return ex; continue outer;
            }
            case 16 /* NEWT */: R[sp++] = vm.newTable(); break;
            case 17 /* TSETI */: { const v = R[--sp]; vm.rawset(R[sp - 1], a, v); break; }
            case 18 /* TSETF */: { const v = R[--sp]; vm.rawset(R[sp - 1], K[a], v); break; }
            case 19 /* TSETK */: { const v = R[--sp], k = R[--sp]; vm.rawset(R[sp - 1], k, v); break; }
            case 20 /* SETLIST */: {
              const n = fr.vn, t = R[sp - n - 1];
              for (let i = 0; i < n; i++) vm.rawset(t, a + i, R[sp - n + i]);
              sp -= n;
              break;
            }
            case 21 /* ADD */: { const y = R[--sp], x = R[sp - 1]; if (typeof x === 'number' && typeof y === 'number') { R[sp - 1] = x + y; break; } fr.pc = pc; fr.sp = --sp; if ((ex = vm.arith(op, x, y)) !== undefined) return ex; continue outer; }
            case 22 /* SUB */: { const y = R[--sp], x = R[sp - 1]; if (typeof x === 'number' && typeof y === 'number') { R[sp - 1] = x - y; break; } fr.pc = pc; fr.sp = --sp; if ((ex = vm.arith(op, x, y)) !== undefined) return ex; continue outer; }
            case 23 /* MUL */: { const y = R[--sp], x = R[sp - 1]; if (typeof x === 'number' && typeof y === 'number') { R[sp - 1] = x * y; break; } fr.pc = pc; fr.sp = --sp; if ((ex = vm.arith(op, x, y)) !== undefined) return ex; continue outer; }
            case 24 /* DIV */: { const y = R[--sp], x = R[sp - 1]; if (typeof x === 'number' && typeof y === 'number') { R[sp - 1] = x / y; break; } fr.pc = pc; fr.sp = --sp; if ((ex = vm.arith(op, x, y)) !== undefined) return ex; continue outer; }
            case 25 /* MOD */: case 26 /* IDIV */: case 27 /* POW */: {
              const y = R[--sp], x = R[sp - 1];
              if (typeof x === 'number' && typeof y === 'number') { R[sp - 1] = arithNum(op, x, y); break; }
              fr.pc = pc; fr.sp = --sp; if ((ex = vm.arith(op, x, y)) !== undefined) return ex; continue outer;
            }
            case 28 /* CONCAT */: {
              const y = R[--sp], x = R[sp - 1];
              if ((typeof x === 'string' || typeof x === 'number') && (typeof y === 'string' || typeof y === 'number')) { fr.pc = pc; R[sp - 1] = vm.concat(x, y); break; }
              fr.pc = pc; fr.sp = --sp; if ((ex = vm.arith(op, x, y)) !== undefined) return ex; continue outer;
            }
            case 35 /* UNM */: {
              const x = R[sp - 1];
              if (typeof x === 'number') { R[sp - 1] = -x; break; }
              fr.pc = pc; fr.sp = --sp; if ((ex = vm.arith(op, x, x)) !== undefined) return ex; continue outer;
            }
            case 29 /* EQ */: case 30 /* NE */: {
              const y = R[--sp], x = R[sp - 1];
              let r = x === y;
              if (!r && x instanceof LTable && y instanceof LTable && (x.mt !== null || y.mt !== null)) {
                const h = vm.metaOf(x, '__eq') ?? vm.metaOf(y, '__eq');
                if (h !== undefined) { fr.pc = pc; fr.sp = --sp; if ((ex = vm.callValue(h, [x, y], 1, op === EQ ? P_BOOL : P_NOT)) !== undefined) return ex; continue outer; }
              }
              R[sp - 1] = op === EQ ? r : !r;
              break;
            }
            case 31 /* LT */: case 32 /* LE */: case 33 /* GT */: case 34 /* GE */: {
              let y = R[--sp], x = R[sp - 1];
              if (typeof x === 'number' && typeof y === 'number') {
                R[sp - 1] = op === LT ? x < y : op === LE ? x <= y : op === GT ? x > y : x >= y;
                break;
              }
              if (op === GT || op === GE) { const t = x; x = y; y = t; }
              fr.pc = pc; fr.sp = sp - 1;
              const r = vm.compare(op === LE || op === GE, x, y, P_BOOL);
              if (typeof r === 'boolean') { R[sp - 1] = r; break; }
              if (r) return r;
              continue outer;
            }
            case 36 /* NOT */: { const v = R[sp - 1]; R[sp - 1] = v === undefined || v === false; break; }
            case 37 /* LEN */: {
              const v = R[sp - 1];
              if (typeof v === 'string') { R[sp - 1] = v.length; break; }
              if (v instanceof LTable && v.mt === null) { R[sp - 1] = v.arr.length; break; }
              fr.pc = pc; fr.sp = --sp; if ((ex = vm.len(v)) !== undefined) return ex; continue outer;
            }
            case 38 /* JMP */: pc = a; break;
            case 39 /* JMPF */: { const v = R[--sp]; if (v === undefined || v === false) pc = a; break; }
            case 40 /* JMPT */: { const v = R[--sp]; if (v !== undefined && v !== false) pc = a; break; }
            case 41 /* AND */: { const v = R[sp - 1]; if (v === undefined || v === false) pc = a; else sp--; break; }
            case 42 /* OR */: { const v = R[sp - 1]; if (v !== undefined && v !== false) pc = a; else sp--; break; }
            case 43 /* POP */: sp -= a; break;
            case 45 /* TAILCALL */: {
              const nargs = code[pc - 1] ? a + fr.vn : a, fpos = sp - nargs - 1, f = R[fpos];
              if (f instanceof LClosure) {
                if (fr.open !== null) vm.close(fr, 0);
                co.frames.pop();
                const nf = vm.pushFrame(co, f, R, fpos + 1, nargs, fr.nres, fr.post);
                nf.aux = fr.aux; nf.handler = fr.handler;
                continue outer;
              }
            }
            // falls through: other callables are called normally, then RET returns their results
            case 44 /* CALL */: {
              const nres = code[pc - 2], nargs = code[pc - 1] ? a + fr.vn : a, fpos = sp - nargs - 1, f = R[fpos];
              fr.pc = pc; fr.sp = fpos;
              if (f instanceof LClosure) {
                fr = vm.pushFrame(co, f, R, fpos + 1, nargs, nres, P_NONE);
                R = fr.R; code = fr.p.code; K = fr.p.k; pc = 0; sp = fr.sp;
                break;
              }
              const args = R.slice(fpos + 1, sp);
              if (f instanceof HostFn && f.special === 0) {
                const r = f.fn(args, vm);
                if (r instanceof YieldReq) { const x = vm.yieldCo(co, r.vals, nres, P_NONE); if (x) return x; continue outer; }
                sp = fpos;
                if (nres < 0) { for (let i = 0; i < r.length; i++) R[sp++] = r[i]; fr.vn = r.length; }
                else for (let i = 0; i < nres; i++) R[sp++] = r[i];
                break;
              }
              const x = vm.callValue(f, args, nres, P_NONE);
              if (x) return x;
              continue outer;
            }
            case 46 /* RET */: {
              const n = code[pc - 1] ? a + fr.vn : a;
              if (fr.open !== null) vm.close(fr, 0);
              co.frames.pop();
              if (fr.post === P_NONE && co.frames.length > 0) {   // fast path: plain return to a Mote caller
                const cf = co.frames[co.frames.length - 1], nres = fr.nres, CR = cf.R;
                let csp = cf.sp;
                if (nres < 0) { for (let i = 0; i < n; i++) CR[csp++] = R[sp - n + i]; cf.vn = n; }
                else for (let i = 0; i < nres; i++) CR[csp++] = i < n ? R[sp - n + i] : undefined;
                cf.sp = csp;
                fr = cf; R = CR; code = fr.p.code; K = fr.p.k; pc = fr.pc; sp = csp;
                break;
              }
              const x = vm.afterReturn(co, fr, R.slice(sp - n, sp));
              if (x) return x;
              continue outer;
            }
            case 47 /* VARARG */: {
              const va = fr.va;
              if (a < 0) { for (let i = 0; i < va.length; i++) R[sp++] = va[i]; fr.vn = va.length; }
              else for (let i = 0; i < a; i++) R[sp++] = va[i];
              break;
            }
            case 48 /* CLOSURE */: {
              const p = fr.p.protos[a], ups = p.ups, up = new Array(ups.length >> 1);
              for (let i = 0; i < ups.length; i += 2) up[i >> 1] = ups[i] ? vm.findUp(fr, ups[i + 1]) : fr.cl.up[ups[i + 1]];
              fr.pc = pc;
              vm.alloc(SZ_CLOSURE);
              R[sp++] = new LClosure(p, up);
              break;
            }
            case 49 /* CLOSE */: if (fr.open !== null) vm.close(fr, a); break;
            case 50 /* FORPREP */: {
              const i0 = R[a], lim = R[a + 1], st = R[a + 2];
              fr.pc = pc;
              if (typeof i0 !== 'number') throw rt("'for' initial value must be a number");
              if (typeof lim !== 'number') throw rt("'for' limit must be a number");
              if (typeof st !== 'number') throw rt("'for' step must be a number");
              if (st === 0) throw rt("'for' step is zero");
              if (st > 0 ? i0 <= lim : i0 >= lim) R[a + 3] = i0; else pc = code[pc - 2];
              break;
            }
            case 51 /* FORLOOP */: {
              const st = R[a + 2], i = R[a] + st;
              if (st > 0 ? i <= R[a + 1] : i >= R[a + 1]) { R[a] = i; R[a + 3] = i; pc = code[pc - 2]; }
              break;
            }
            case 52 /* TFORLOOP */: {
              const nv = code[pc - 2];
              sp -= nv;
              const v = R[sp];
              if (v === undefined) { pc = code[pc - 1]; break; }
              for (let i = 0; i < nv; i++) R[a + 3 + i] = R[sp + i];
              R[a + 2] = v;
              break;
            }
            default: throw new Error('Mote VM: bad opcode ' + op);
          }
        }
      } catch (e) {
        if (fr !== undefined) fr.pc = pc;
        vm.handleError(e);
      }
    }
  }

  // ── errors ──
  errValue(e) {
    if (e instanceof Throw) return e.pos && typeof e.v === 'string' ? this.where(1) + e.v : e.v;
    if (e instanceof MoteError) return 'moteValue' in e ? e.moteValue : e.message;
    if (e instanceof RangeError) return this.where(1) + (/call stack/i.test(e.message) ? 'stack overflow' : e.message);
    return this.where(1) + (e && e.message !== undefined ? e.message : String(e));
  }
  mkError(v, tb, prev) {
    let msg = typeof v === 'string' ? v : typeof v === 'number' ? num2str(v) : `(error object is a ${typeOf(v)} value)`;
    if (this.metaOf(v, '__tostring') !== undefined && this.cur) { try { msg = this.tostr(v); } catch (_) { /* keep the generic message */ } }
    const m = typeof v === 'string' && /^([^\n]*?):(\d+): /.exec(v);
    if (prev instanceof MoteError && prev.traceback) tb = prev.traceback + '\n' + tb.replace(/^stack traceback:\n?/, '');
    const err = new MoteError(msg, { kind: 'runtime', chunk: m ? m[1] : undefined, line: m ? +m[2] : undefined, traceback: tb });
    err.moteValue = v;
    try { err.value = this.toJS(v); } catch (_) { err.value = msg; }
    return err;
  }
  /** Unwinds to the nearest pcall (and continues there), or rethrows at a boundary / coroutine bottom. */
  handleError(e) {
    let err = e;
    for (;;) {
      const co = this.cur, fs = co.frames;
      if (err instanceof MoteError && err.kind === 'limit') {   // not catchable by pcall
        if (err.needsWhere) {
          err.needsWhere = false;
          const w = this.where(1);
          err.message = w + err.message;
          const m = /^([^\n]*?):(\d+): /.exec(w);
          if (m) { err.chunk = m[1]; err.line = +m[2]; }
          err.traceback = this.traceback(co, 0);
        }
        while (fs.length) {
          const f = fs.pop();
          if (f.open !== null) this.close(f, 0);
          if (f.post === P_BOUNDARY) { co.nny--; throw err; }
        }
        co.status = 'dead';
        const R = co.resumer;
        co.resumer = null;
        if (R) { this.cur = R; continue; }
        throw err;
      }
      let v = this.errValue(err);
      let i = fs.length - 1;
      while (i >= 0 && fs[i].post !== P_PCALL && fs[i].post !== P_XPCALL && fs[i].post !== P_BOUNDARY) i--;
      if (i >= 0 && fs[i].post !== P_BOUNDARY) {   // caught by pcall / xpcall
        const pf = fs[i];
        if (pf.post === P_XPCALL) {
          try { v = this.callNested(pf.handler, [v])[0]; } catch (e2) {
            if (e2 instanceof MoteError && e2.kind === 'limit') { err = e2; continue; }
            v = this.errValue(e2);
          }
        }
        while (fs.length > i) { const f = fs.pop(); if (f.open !== null) this.close(f, 0); }
        this.deliver(top(co), [false, v], pf.nres, P_NONE);
        return;
      }
      const tb = this.traceback(co, Math.max(i, 0));
      while (fs.length > Math.max(i, 0)) { const f = fs.pop(); if (f.open !== null) this.close(f, 0); }
      if (i >= 0) { co.nny--; throw this.mkError(v, tb, err); }   // escapes a nested call
      co.status = 'dead';
      const R = co.resumer;
      co.resumer = null;
      if (!R) throw this.mkError(v, tb, err);
      this.cur = R; R.status = 'running';
      if (R.rMode === R_WRAP) { err = new Throw(v, false); continue; }   // coroutine.wrap rethrows in the caller
      this.deliver(top(R), [false, v], R.rNres, R.rPost);
      return;
    }
  }

  // ── host entry points ──
  _load(src, chunk) {
    if (typeof src !== 'string') throw new TypeError('Mote: source must be a string');
    try {
      const body = new Parser(src, chunk).parseChunk();
      return new LClosure(new Compiler(chunk).compileChunk(body), []);
    } catch (e) {
      if (e instanceof RangeError) throw new MoteError(`${chunk}: chunk is too complex`, { kind: 'syntax', chunk });
      throw e;
    }
  }
  /** Calls a Mote value with Mote arguments from the host; returns raw Mote results. */
  _invoke(f, args) {
    if (this.cur) return this.callNested(f, args);   // re-entered from a host function
    this.beginEntry();
    const co = new Coroutine(null);
    co.isMain = true; co.started = true; co.status = 'running';
    this.cur = co;
    try { return this.callNested(f, args); }
    finally { co.status = 'dead'; this.cur = null; this.endEntry(); }
  }
  _resumeThread(co, jsvals) {
    if (co.status !== 'suspended') throw new MoteError(`cannot resume ${co.status === 'dead' ? 'dead' : 'non-suspended'} coroutine`);
    const prev = this.cur;
    if (prev) prev.status = 'normal';
    this.beginEntry();
    this.depth++;
    try {
      co.resumer = null;
      this.startResume(co, jsvals.map(v => this.toMote(v)));
      const r = this.execute();
      return { done: !!r.done, values: r.vals.map(v => this.toJS(v)) };
    } finally {
      this.depth--;
      this.cur = prev;
      if (prev) prev.status = 'running';
      this.endEntry();
    }
  }

  // ── conversions ──
  /** JS → Mote. Primitives map directly (null/undefined → nil); arrays and plain objects are copied
   *  into tables; functions become host functions; vm.ref() values pass by reference. */
  toMote(v, seen) {
    switch (typeof v) {
      case 'undefined': case 'boolean': case 'number': case 'string': return v;
      case 'bigint': return Number(v);
      case 'function': return this.toMoteMap.get(v) || this.hostFn(v);
      case 'symbol': throw new TypeError('Mote: cannot convert a symbol');
    }
    if (v === null) return undefined;
    if (v instanceof LTable || v instanceof LClosure || v instanceof HostFn || v instanceof Coroutine || v instanceof Ref) return v;
    if (v instanceof Thread) return v._co;
    if (seen && seen.has(v)) return seen.get(v);
    const proto = Object.getPrototypeOf(v);
    if (Array.isArray(v)) {
      const t = new LTable();
      (seen = seen || new Map()).set(v, t);
      for (let i = 0; i < v.length; i++) t.set(i + 1, this.toMote(v[i], seen));
      return t;
    }
    if (proto === Object.prototype || proto === null) {
      const t = new LTable();
      (seen = seen || new Map()).set(v, t);
      for (const k of Object.keys(v)) {
        const key = /^(0|[1-9]\d{0,14})$/.test(k) ? +k : k;
        t.set(key, this.toMote(v[k], seen));
      }
      return t;
    }
    throw new TypeError(`Mote: cannot convert ${proto && proto.constructor ? proto.constructor.name : 'object'} to a Mote value (use vm.ref(obj))`);
  }
  /** Mote → JS. Tables are copied to arrays (when they are a non-empty sequence) or plain objects,
   *  or wrapped in a live Proxy with {proxy: true}; Mote functions become JS functions. */
  toJS(v, opts, seen) {
    switch (typeof v) {
      case 'undefined': case 'boolean': case 'number': case 'string': return v;
    }
    if (v instanceof LTable) {
      if (opts && opts.proxy) return this.proxy(v);
      if (seen && seen.has(v)) return seen.get(v);
      seen = seen || new Map();
      const n = v.arr.length;
      if (n > 0 && (v.hash === null || v.hash.size === 0)) {
        const out = new Array(n);
        seen.set(v, out);
        for (let i = 0; i < n; i++) out[i] = this.toJS(v.arr[i], opts, seen);
        return out;
      }
      const out = {};
      seen.set(v, out);
      const put = (k, x) => Object.defineProperty(out, k, { value: this.toJS(x, opts, seen), enumerable: true, writable: true, configurable: true });
      for (let i = 0; i < n; i++) if (v.arr[i] !== undefined) put(String(i + 1), v.arr[i]);
      if (v.hash) for (const [k, x] of v.hash) if (typeof k === 'string' || typeof k === 'number') put(typeof k === 'number' ? num2str(k) : k, x);
      return out;
    }
    if (v instanceof HostFn && v.js) return v.js;
    if (v instanceof LClosure || v instanceof HostFn) {
      let w = this.toJSMap.get(v);
      if (!w) {
        w = (...args) => this.call(v, ...args)[0];
        this.toJSMap.set(v, w); this.toMoteMap.set(w, v);
      }
      return w;
    }
    if (v instanceof Coroutine) {
      let h = this.toJSMap.get(v);
      if (!h) { h = new Thread(this, v); this.toJSMap.set(v, h); }
      return h;
    }
    if (v instanceof Ref) return v.obj;
    return v;
  }
  proxy(t) {
    let p = this.proxies.get(t);
    if (p) return p;
    const vm = this;
    const key = k => (typeof k === 'string' && k !== '' && String(Number(k)) === k ? Number(k) : k);
    p = new Proxy(Object.create(null), {
      get(_, k) {
        if (typeof k === 'symbol') return undefined;
        const v = t.get(key(k));
        if (v === undefined && k === 'length') return t.arr.length;
        return vm.toJS(v, { proxy: true });
      },
      set(_, k, v) { if (typeof k !== 'symbol') vm.rawset(t, key(k), vm.toMote(v)); return true; },
      has(_, k) { return typeof k !== 'symbol' && t.get(key(k)) !== undefined; },
      deleteProperty(_, k) { if (typeof k !== 'symbol') t.set(key(k), undefined); return true; },
      ownKeys() {
        const ks = [];
        for (let i = 0; i < t.arr.length; i++) if (t.arr[i] !== undefined) ks.push(String(i + 1));
        if (t.hash) for (const k of t.hash.keys()) if (typeof k === 'string' || typeof k === 'number') ks.push(typeof k === 'number' ? num2str(k) : k);
        return ks;
      },
      getOwnPropertyDescriptor(_, k) {
        const v = typeof k === 'symbol' ? undefined : t.get(key(k));
        return v === undefined ? undefined : { value: vm.toJS(v, { proxy: true }), enumerable: true, configurable: true, writable: true };
      },
    });
    this.proxies.set(t, p);
    return p;
  }
  /** Wraps a JS function as a Mote function. args: 'copy' (default) | 'proxy' | 'raw'. */
  hostFn(js, opts) {
    const mode = (opts && opts.args) || 'copy';
    const conv = mode === 'raw' ? null : { proxy: mode === 'proxy' };
    const h = new HostFn((opts && opts.name) || js.name || '?', args => {
      const r = js.apply(undefined, conv ? args.map(x => this.toJS(x, conv)) : args);
      return this.hostResult(r);
    });
    if (!opts) { h.js = js; this.toMoteMap.set(js, h); }
    return h;
  }
  hostResult(r, deepRef) {
    const cv = deepRef ? x => this.refValue(deepRef, x) : x => this.toMote(x);
    if (r === undefined) return [];
    if (r instanceof YieldReq) return new YieldReq(r.vals.map(cv));
    if (r instanceof Multi) return r.vals.map(cv);
    return [cv(r)];
  }

  // ── host objects by reference ──
  refKeyOk(r, k) {
    if (BLOCKED.has(k)) return false;
    if (r.allow) return r.allow.has(k);
    for (let p = r.obj; p !== null && p !== undefined; p = Object.getPrototypeOf(p)) {
      if (Object.prototype.hasOwnProperty.call(p, k)) return p !== Object.prototype && p !== Function.prototype;
    }
    return false;
  }
  refValue(r, v) {
    if (r && r.deep && v !== null && typeof v === 'object' && !(v instanceof Ref)) return this.ref(v, { deep: true, readonly: r.readonly });
    return this.toMote(v);
  }
  refGet(r, k) {
    const o = r.obj;
    if (typeof k === 'number') return Array.isArray(o) && Number.isInteger(k) && k >= 1 ? this.refValue(r, o[k - 1]) : undefined;
    if (typeof k !== 'string' || !this.refKeyOk(r, k)) return undefined;
    const v = o[k];
    if (typeof v !== 'function') return this.refValue(r, v);
    let m = r.methods.get(k);
    if (!m) {   // r:m(...) and r.m(...) both call with this = the object
      m = new HostFn(k, args => {
        const a = args[0] === r ? args.slice(1) : args;
        return this.hostResult(v.apply(o, a.map(x => this.toJS(x))), r.deep ? r : null);
      });
      r.methods.set(k, m);
    }
    return m;
  }
  refSet(r, k, v) {
    const o = r.obj;
    if (r.readonly) throw rt('attempt to modify a read-only host object');
    if (typeof k === 'number' && Array.isArray(o) && Number.isInteger(k) && k >= 1) { o[k - 1] = this.toJS(v); return; }
    if (typeof k !== 'string' || BLOCKED.has(k) || (r.allow && !r.allow.has(k))) throw rt(`cannot set field '${this.tostr(k)}' on a host object`);
    r.methods.delete(k);
    o[k] = this.toJS(v);
  }
  refLen(r) {
    const n = Array.isArray(r.obj) ? r.obj.length : r.obj.length;
    if (typeof n !== 'number') throw rt('attempt to get length of a userdata value');
    return n;
  }
  refPairs(r) {
    const o = r.obj;
    const keys = Array.isArray(o) ? o.map((_, i) => i + 1) : Object.keys(o).filter(k => this.refKeyOk(r, k));
    let i = 0;
    const it = new HostFn('next', () => i < keys.length ? [keys[i], this.refGet(r, keys[i++])] : [undefined]);
    return [it, r, undefined];
  }

  // ══════════════════════════════════ public embedding API ══════════════════════════════════
  /** Sets a global (JS value converted with toMote). */
  set(name, value) { this.G.set(name, this.toMote(value)); return this; }
  /** Reads a global, converted to JS (opts.proxy: live view of tables). */
  get(name, opts) { return this.toJS(this.G.get(name), opts); }
  /** Compiles and runs source; returns the chunk's results as JS values. Throws MoteError. */
  run(source, chunkName) { return this._invoke(this._load(source, chunkName || 'main'), []).map(v => this.toJS(v)); }
  /** Compiles source to a JS function that runs the chunk (returning its first result). */
  compile(source, chunkName) { return this.toJS(this._load(source, chunkName || 'main')); }
  /** Calls a Mote function (a global name, or a function value) with JS args; returns all results. */
  call(fn, ...args) {
    const f = typeof fn === 'string' ? this.G.get(fn) : this.toMote(fn);
    if (f === undefined) throw new MoteError(`attempt to call a nil value${typeof fn === 'string' ? ` (global '${fn}')` : ''}`);
    return this._invoke(f, args.map(a => this.toMote(a))).map(v => this.toJS(v));
  }
  /** A coroutine driven from JS: thread.resume(...vals) → {done, values}. */
  thread(fn, ...args) {
    const f = typeof fn === 'string' ? this.G.get(fn) : this.toMote(fn);
    if (!(f instanceof LClosure || f instanceof HostFn)) throw new TypeError('Mote: vm.thread needs a function');
    const co = new Coroutine(f), h = new Thread(this, co, args);
    this.toJSMap.set(co, h);
    return h;
  }
  /** Exposes a JS object by reference. opts: {allow: [keys], readonly, deep}. */
  ref(obj, opts) {
    if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) throw new TypeError('Mote: vm.ref needs an object');
    if (typeof obj === 'function') return this.hostFn(obj);
    if (opts) return new Ref(obj, opts);
    let r = this.refCache.get(obj);
    if (!r) { r = new Ref(obj, null); this.refCache.set(obj, r); }
    return r;
  }
  /** Wraps a JS function with options: {name, args: 'copy' | 'proxy' | 'raw'}. */
  fn(js, opts) { return this.hostFn(js, opts || {}); }
  /** Return this from a host function to suspend the running coroutine; the values go to the resumer. */
  yield(...vals) { return new YieldReq(vals); }
  /** Return this from a host function to return several values. */
  multi(...vals) { return new Multi(vals); }
  stats() {
    return { steps: this.budgetStart - Math.max(this.budget, 0), totalSteps: this.totalSteps, memory: this.mem,
      maxSteps: this.maxSteps, maxMemory: this.maxMemory, running: this.depth > 0 };
  }
}
const NEEDCALL = {};

function arithNum(op, x, y) {
  switch (op) {
    case ADD: return x + y;
    case SUB: return x - y;
    case MUL: return x * y;
    case DIV: return x / y;
    case MOD: return mod(x, y);
    case IDIV: return Math.floor(x / y);
    case POW: return Math.pow(x, y);
    case UNM: return -x;
  }
}

// xoshiro128** seeded through splitmix32: deterministic per VM.
function makeRng(seed) {
  let a = 0, b = 0, c = 0, d = 0;
  const rotl = (x, k) => (x << k) | (x >>> (32 - k));
  const rng = {
    seed(n) {
      let x = (Math.floor(n) ^ Math.floor(n / 4294967296)) | 0;
      const sm = () => {
        x = (x + 0x9e3779b9) | 0;
        let z = x;
        z = Math.imul(z ^ (z >>> 16), 0x85ebca6b); z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
        return (z ^ (z >>> 16)) | 0;
      };
      a = sm(); b = sm(); c = sm(); d = sm();
      if (!(a | b | c | d)) a = 1;
    },
    next() {
      const r = Math.imul(rotl(Math.imul(b, 5), 7), 9) >>> 0, t = b << 9;
      c ^= a; d ^= b; b ^= c; a ^= d; c ^= t; d = rotl(d, 11);
      return r;
    },
    float() { return ((rng.next() >>> 5) * 67108864 + (rng.next() >>> 6)) / 9007199254740992; },
  };
  rng.seed(seed);
  return rng;
}

// ═════════════════════════════════════ standard library ══════════════════════════════════════════

const argError = (i, f, msg) => rt(`bad argument #${i} to '${f}' (${msg})`);
const typeErr = (a, i, f, exp) => argError(i + 1, f, `${exp} expected, got ${i < a.length ? typeOf(a[i]) : 'no value'}`);
function checkTable(a, i, f) { const v = a[i]; if (v instanceof LTable) return v; throw typeErr(a, i, f, 'table'); }
function checkNum(a, i, f) {
  const v = a[i];
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const n = str2num(v); if (n !== undefined) return n; }
  throw typeErr(a, i, f, 'number');
}
function checkInt(a, i, f) {
  const n = checkNum(a, i, f);
  if (Number.isInteger(n)) return n;
  throw argError(i + 1, f, 'number has no integer representation');
}
const optInt = (a, i, f, d) => (a[i] === undefined ? d : checkInt(a, i, f));
function checkStr(a, i, f) {
  const v = a[i];
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return num2str(v);
  throw typeErr(a, i, f, 'string');
}
function checkAny(a, i, f) { if (i >= a.length) throw argError(i + 1, f, 'value expected'); return a[i]; }
const posrelat = (pos, len) => (pos >= 0 ? pos : -pos > len ? 0 : len + pos + 1);

const DEFAULT_LIBS = ['base', 'string', 'table', 'math', 'coroutine'];
function openLibs(vm, libs) {
  for (const name of libs) {
    const open = LIBS[name];
    if (!open) throw new Error(`Mote: unknown library '${name}'`);
    open(vm, vm.G);
  }
}
function def(t, name, fn, special) { const h = new HostFn(name, fn, special); t.set(name, h); return h; }
function lib(vm, name) { const t = new LTable(); vm.G.set(name, t); return t; }

const LIBS = {
  base(vm, G) {
    G.set('_G', G);
    G.set('_VERSION', 'Mote 1.0');
    def(G, 'print', a => { vm.printFn(a.map(v => vm.tostr(v)).join('\t')); return EMPTY; });
    def(G, 'type', a => [typeOf(checkAny(a, 0, 'type'))]);
    def(G, 'tostring', a => [vm.tostr(checkAny(a, 0, 'tostring'))]);
    def(G, 'tonumber', a => {
      const v = checkAny(a, 0, 'tonumber');
      if (a[1] === undefined) return [typeof v === 'number' ? v : typeof v === 'string' ? str2num(v) : undefined];
      const base = checkInt(a, 1, 'tonumber');
      if (base < 2 || base > 36) throw argError(2, 'tonumber', 'base out of range');
      const s = checkStr(a, 0, 'tonumber').trim().toLowerCase();
      const m = /^(-)?([0-9a-z]+)$/.exec(s);
      if (!m) return [undefined];
      let n = 0;
      for (const ch of m[2]) {
        const d = parseInt(ch, 36);
        if (d >= base) return [undefined];
        n = n * base + d;
      }
      return [m[1] ? -n : n];
    });
    const next = def(G, 'next', a => checkTable(a, 0, 'next').next(a[1]) || [undefined]);
    def(G, 'pairs', a => {
      const t = checkAny(a, 0, 'pairs'), h = vm.metaOf(t, '__pairs');
      if (h !== undefined) { const r = vm.callNested(h, [t]); return [r[0], r[1], r[2]]; }
      if (t instanceof LTable) return [next, t, undefined];
      if (t instanceof Ref) return vm.refPairs(t);
      throw typeErr(a, 0, 'pairs', 'table');
    });
    const inext = new HostFn('ipairs_iterator', a => {
      const t = a[0], i = a[1] + 1;
      const v = t instanceof LTable && t.mt === null ? t.get(i) : vm.indexSync(t, i);
      return v === undefined ? [undefined] : [i, v];
    });
    def(G, 'ipairs', a => [inext, checkAny(a, 0, 'ipairs'), 0]);
    def(G, 'select', a => {
      const n = a[0], count = a.length - 1;
      if (n === '#') return [count];
      let i = checkInt(a, 0, 'select');
      if (i < 0) { i = count + i; if (i < 0) throw argError(1, 'select', 'index out of range'); return a.slice(1 + i); }
      if (i === 0) throw argError(1, 'select', 'index out of range');
      return a.slice(i);
    });
    def(G, 'rawget', a => [checkTable(a, 0, 'rawget').get(a[1])]);
    def(G, 'rawset', a => { const t = checkTable(a, 0, 'rawset'); vm.rawset(t, a[1], a[2]); return [t]; });
    def(G, 'rawequal', a => [a[0] === a[1]]);
    def(G, 'rawlen', a => {
      const v = a[0];
      if (v instanceof LTable) return [v.arr.length];
      if (typeof v === 'string') return [v.length];
      throw argError(1, 'rawlen', 'table or string expected');
    });
    def(G, 'assert', a => {
      if (truthy(a[0])) return a;
      if (a.length < 2) throw rt('assertion failed!');
      throw new Throw(a[1], false);
    });
    def(G, 'error', a => {
      let v = a[0];
      const level = optInt(a, 1, 'error', 1);
      if (typeof v === 'string' && level > 0) v = vm.where(level) + v;
      throw new Throw(v, false);
    });
    def(G, 'pcall', null, S_PCALL);
    def(G, 'xpcall', null, S_XPCALL);
    def(G, 'unpack', unpack);
    def(G, 'setmetatable', a => {
      const t = checkTable(a, 0, 'setmetatable'), mt = a[1];
      if (mt !== undefined && !(mt instanceof LTable)) throw typeErr(a, 1, 'setmetatable', 'nil or table');
      if (t.mt && t.mt.get('__metatable') !== undefined) throw rt('cannot change a protected metatable');
      t.mt = mt || null;
      return [t];
    });
    def(G, 'getmetatable', a => {
      const mt = vm.getmt(a[0]);
      if (!mt) return [undefined];
      const p = mt.get('__metatable');
      return [p !== undefined ? p : mt];
    });
    def(G, 'load', a => {
      const s = a[0];
      if (typeof s !== 'string') throw typeErr(a, 0, 'load', 'string');
      const name = a[1] === undefined ? 'load' : checkStr(a, 1, 'load');
      try { return [vm._load(s, name)]; } catch (e) {
        if (e instanceof MoteError && e.kind === 'syntax') return [undefined, e.message];
        throw e;
      }
    });
  },

  string(vm) {
    const S = lib(vm, 'string');
    vm.strmt = new LTable();
    vm.strmt.set('__index', S);
    const str = (a, f) => checkStr(a, 0, f);
    def(S, 'len', a => [str(a, 'len').length]);
    def(S, 'sub', a => {
      const s = str(a, 'sub'), l = s.length;
      let i = posrelat(optInt(a, 1, 'sub', 1), l), j = posrelat(optInt(a, 2, 'sub', -1), l);
      if (i < 1) i = 1;
      if (j > l) j = l;
      return [i > j ? '' : s.slice(i - 1, j)];
    });
    def(S, 'upper', a => [str(a, 'upper').toUpperCase()]);
    def(S, 'lower', a => [str(a, 'lower').toLowerCase()]);
    def(S, 'rep', a => {
      const s = str(a, 'rep'), n = checkInt(a, 1, 'rep'), sep = a[2] === undefined ? '' : checkStr(a, 2, 'rep');
      if (n <= 0) return [''];
      vm.alloc(SZ_STR + n * (s.length + sep.length));
      return [sep ? Array(n).fill(s).join(sep) : s.repeat(n)];
    });
    def(S, 'reverse', a => [Array.from(str(a, 'reverse')).reverse().join('')]);
    def(S, 'byte', a => {
      const s = str(a, 'byte'), l = s.length;
      const i = posrelat(optInt(a, 1, 'byte', 1), l);
      let j = posrelat(a[2] === undefined ? i : checkInt(a, 2, 'byte'), l);
      const out = [];
      for (let k = Math.max(i, 1); k <= Math.min(j, l); k++) out.push(s.charCodeAt(k - 1));
      return out;
    });
    def(S, 'char', a => {
      let s = '';
      for (let i = 0; i < a.length; i++) {
        const c = checkInt(a, i, 'char');
        if (c < 0 || c > 0xFFFF) throw argError(i + 1, 'char', 'value out of range');
        s += String.fromCharCode(c);
      }
      return [s];
    });
    def(S, 'format', a => [format(vm, a)]);
    def(S, 'find', a => strFind(vm, a, true));
    def(S, 'match', a => strFind(vm, a, false));
    def(S, 'gmatch', a => {
      const s = str(a, 'gmatch'), p = checkStr(a, 1, 'gmatch');
      let pos = 0, last = -1;
      return [new HostFn('gmatch_iterator', () => {
        const ms = new MatchState(vm, s, p);
        for (let src = pos; src <= s.length; src++) {
          ms.level = 0;
          const e = doMatch(ms, src, 0);
          if (e !== -1 && e !== last) { pos = last = e; return captures(ms, src, e, true); }
        }
        return [undefined];
      })];
    });
    def(S, 'gsub', a => gsub(vm, a));
  },

  table(vm) {
    const T = lib(vm, 'table');
    def(T, 'insert', a => {
      const t = checkTable(a, 0, 'insert'), n = t.arr.length;
      if (a.length === 2) { vm.rawset(t, n + 1, a[1]); return EMPTY; }
      if (a.length !== 3) throw rt("wrong number of arguments to 'insert'");
      const pos = checkInt(a, 1, 'insert');
      if (pos < 1 || pos > n + 1) throw argError(2, 'insert', 'position out of bounds');
      if (pos === n + 1) vm.rawset(t, pos, a[2]);
      else { t.arr.splice(pos - 1, 0, a[2]); vm.alloc(SZ_SLOT); if (t.hash) t.migrate(); }
      return EMPTY;
    });
    def(T, 'remove', a => {
      const t = checkTable(a, 0, 'remove'), n = t.arr.length;
      const pos = a.length < 2 ? n : checkInt(a, 1, 'remove');
      if (a.length >= 2 && pos !== n && (pos < 1 || pos > n + 1)) throw argError(2, 'remove', 'position out of bounds');
      if (pos >= 1 && pos <= n) { const v = t.arr.splice(pos - 1, 1)[0]; t.trim(); return [v]; }
      const v = t.get(pos);
      if (pos === n + 1 && v !== undefined) t.set(pos, undefined);
      return [v];
    });
    def(T, 'concat', a => {
      const t = checkTable(a, 0, 'concat'), sep = a[1] === undefined ? '' : checkStr(a, 1, 'concat');
      const i = optInt(a, 2, 'concat', 1), j = a[3] === undefined ? t.arr.length : checkInt(a, 3, 'concat');
      const parts = [];
      let size = 0;
      for (let k = i; k <= j; k++) {
        const v = t.get(k);
        if (typeof v === 'string') parts.push(v);
        else if (typeof v === 'number') parts.push(num2str(v));
        else throw rt(`invalid value (at index ${k}) in table for 'concat'`);
        size += parts[parts.length - 1].length + sep.length;
      }
      vm.alloc(SZ_STR + size);
      return [parts.join(sep)];
    });
    def(T, 'sort', a => {
      const t = checkTable(a, 0, 'sort'), comp = a[1];
      if (comp !== undefined && !(comp instanceof LClosure || comp instanceof HostFn)) throw typeErr(a, 1, 'sort', 'function');
      const lt = comp !== undefined ? (x, y) => truthy(vm.callNested(comp, [x, y])[0])
        : (x, y) => {
          if (typeof x === 'number' && typeof y === 'number') return x < y;
          if (typeof x === 'string' && typeof y === 'string') return x < y;
          return vm.lessThan(x, y);
        };
      vm.tick(t.arr.length);
      const sorted = mergeSort(t.arr.slice(), lt, vm);
      for (let i = 0; i < sorted.length; i++) t.arr[i] = sorted[i];
      return EMPTY;
    });
    def(T, 'unpack', unpack);
    def(T, 'pack', a => {
      const t = vm.newTable();
      for (let i = 0; i < a.length; i++) vm.rawset(t, i + 1, a[i]);
      t.set('n', a.length);
      return [t];
    });
  },

  math(vm) {
    const M = lib(vm, 'math');
    const n1 = (name, f) => def(M, name, a => [f(checkNum(a, 0, name))]);
    n1('floor', Math.floor); n1('ceil', Math.ceil); n1('abs', Math.abs); n1('sqrt', Math.sqrt);
    n1('sin', Math.sin); n1('cos', Math.cos); n1('tan', Math.tan); n1('asin', Math.asin); n1('acos', Math.acos);
    n1('exp', Math.exp);
    def(M, 'atan', a => [Math.atan2(checkNum(a, 0, 'atan'), a[1] === undefined ? 1 : checkNum(a, 1, 'atan'))]);
    def(M, 'log', a => {
      const x = checkNum(a, 0, 'log');
      if (a[1] === undefined) return [Math.log(x)];
      const b = checkNum(a, 1, 'log');
      return [b === 2 ? Math.log2(x) : b === 10 ? Math.log10(x) : Math.log(x) / Math.log(b)];
    });
    const minmax = (name, pick) => def(M, name, a => {
      let m = checkNum(a, 0, name);
      for (let i = 1; i < a.length; i++) { const v = checkNum(a, i, name); if (pick(v, m)) m = v; }
      return [m];
    });
    minmax('max', (v, m) => v > m); minmax('min', (v, m) => v < m);
    def(M, 'fmod', a => [checkNum(a, 0, 'fmod') % checkNum(a, 1, 'fmod')]);
    def(M, 'modf', a => {
      const x = checkNum(a, 0, 'modf'), ip = x >= 0 ? Math.floor(x) : Math.ceil(x);
      return [ip, Number.isFinite(x) ? x - ip : 0];
    });
    def(M, 'tointeger', a => [Number.isInteger(a[0]) ? a[0] : undefined]);
    def(M, 'type', a => [typeof checkAny(a, 0, 'type') !== 'number' ? undefined : Number.isInteger(a[0]) ? 'integer' : 'float']);
    def(M, 'random', a => {
      const r = vm.rng.float();
      if (a.length === 0) return [r];
      let lo = 1, hi;
      if (a.length === 1) hi = checkInt(a, 0, 'random');
      else { lo = checkInt(a, 0, 'random'); hi = checkInt(a, 1, 'random'); }
      if (lo > hi) throw argError(a.length === 1 ? 1 : 2, 'random', 'interval is empty');
      return [lo + Math.floor(r * (hi - lo + 1))];
    });
    def(M, 'randomseed', a => { vm.rng.seed(a.length ? checkNum(a, 0, 'randomseed') : Date.now()); return EMPTY; });
    M.set('pi', Math.PI); M.set('huge', Infinity);
    M.set('maxinteger', Number.MAX_SAFE_INTEGER); M.set('mininteger', Number.MIN_SAFE_INTEGER);
  },

  coroutine(vm) {
    const C = lib(vm, 'coroutine');
    const isFn = v => v instanceof LClosure || v instanceof HostFn;
    def(C, 'create', a => { if (!isFn(a[0])) throw typeErr(a, 0, 'create', 'function'); return [new Coroutine(a[0])]; });
    def(C, 'resume', null, S_RESUME);
    def(C, 'yield', null, S_YIELD);
    const co = (a, f) => { if (a[0] instanceof Coroutine) return a[0]; throw typeErr(a, 0, f, 'coroutine'); };
    def(C, 'status', a => [co(a, 'status').status]);
    def(C, 'running', () => [vm.cur, vm.cur.isMain]);
    def(C, 'isyieldable', () => [!vm.cur.isMain && vm.cur.nny === 0]);
    def(C, 'wrap', a => {
      if (!isFn(a[0])) throw typeErr(a, 0, 'wrap', 'function');
      const h = new HostFn('wrap', null, S_WRAP);
      h.co = new Coroutine(a[0]);
      return [h];
    });
    def(C, 'close', a => {
      const c = co(a, 'close');
      if (c.status !== 'suspended' && c.status !== 'dead') throw rt(`cannot close a ${c.status} coroutine`);
      for (const f of c.frames) if (f.open !== null) vm.close(f, 0);
      c.frames = []; c.status = 'dead';
      return [true];
    });
  },

  os(vm) {
    const O = lib(vm, 'os');
    const t0 = Date.now();
    def(O, 'time', () => [Math.floor(Date.now() / 1000)]);
    def(O, 'clock', () => [(Date.now() - t0) / 1000]);
  },
};

function unpack(a) {
  const t = checkTable(a, 0, 'unpack'), i = optInt(a, 1, 'unpack', 1), j = a[2] === undefined ? t.arr.length : checkInt(a, 2, 'unpack');
  if (i > j) return EMPTY;
  if (j - i >= 1e6) throw rt('too many results to unpack');
  const out = new Array(j - i + 1);
  for (let k = i; k <= j; k++) out[k - i] = t.get(k);
  return out;
}
function mergeSort(a, lt, vm) {
  const n = a.length;
  let src = a, dst = new Array(n);
  for (let w = 1; w < n; w *= 2) {
    for (let lo = 0; lo < n; lo += 2 * w) {
      const mid = Math.min(lo + w, n), hi = Math.min(lo + 2 * w, n);
      let i = lo, j = mid, k = lo;
      while (i < mid && j < hi) dst[k++] = lt(src[j], src[i]) ? src[j++] : src[i++];
      while (i < mid) dst[k++] = src[i++];
      while (j < hi) dst[k++] = src[j++];
    }
    vm.tick(n >> 2);
    const t = src; src = dst; dst = t;
  }
  return src;
}

// ── string.format ──
function format(vm, a) {
  const f = checkStr(a, 0, 'format');
  let out = '', ai = 1;
  for (let i = 0; i < f.length; i++) {
    const c = f[i];
    if (c !== '%') { out += c; continue; }
    if (f[i + 1] === '%') { out += '%'; i++; continue; }
    const m = /^([-+ #0]*)(\d{0,2})(?:\.(\d{0,2}))?([a-zA-Z])/.exec(f.slice(i + 1, i + 12));
    if (!m || !'dicxXoeEfFgGsq'.includes(m[4])) throw rt(`invalid conversion '%${f.slice(i + 1, i + 6)}' to 'format'`);
    i += m[0].length;
    const flags = m[1], width = +m[2] || 0, prec = m[3] === undefined ? -1 : +m[3] || 0, conv = m[4], n = ai++;
    if (n >= a.length) throw argError(n + 1, 'format', 'no value');
    const pad = s => s.length >= width ? s : flags.includes('-') ? s + ' '.repeat(width - s.length) : ' '.repeat(width - s.length) + s;
    const num = (body, neg) => {
      const pre = neg ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
      if (flags.includes('0') && !flags.includes('-') && /^[0-9a-fA-F]/.test(body)) return pre + body.padStart(width - pre.length, '0');
      return pad(pre + body);
    };
    switch (conv) {
      case 'd': case 'i': {
        const x = checkNum(a, n, 'format');
        if (!Number.isInteger(x)) throw argError(n + 1, 'format', 'number has no integer representation');
        let s = String(Math.abs(x));
        if (prec >= 0) s = s.padStart(prec, '0');
        out += num(s, x < 0);
        break;
      }
      case 'x': case 'X': case 'o': {
        const x = checkNum(a, n, 'format');
        if (!Number.isInteger(x)) throw argError(n + 1, 'format', 'number has no integer representation');
        const radix = conv === 'o' ? 8 : 16;
        let s = x < 0 ? BigInt.asUintN(64, BigInt(x)).toString(radix) : x.toString(radix);
        if (conv === 'X') s = s.toUpperCase();
        if (prec >= 0) s = s.padStart(prec, '0');
        out += num(s, false);
        break;
      }
      case 'c': out += pad(String.fromCharCode(checkInt(a, n, 'format'))); break;
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        const x = checkNum(a, n, 'format'), p = prec < 0 ? 6 : prec, ax = Math.abs(x);
        let s;
        if (!Number.isFinite(x)) s = x !== x ? 'nan' : 'inf';
        else if (conv === 'e' || conv === 'E') s = fmtE(ax, p);
        else if (conv === 'f' || conv === 'F') s = fmtF(ax, p);
        else s = fmtG(ax, p, flags.includes('#'));
        if (conv === 'E' || conv === 'G' || conv === 'F') s = s.toUpperCase();
        out += Number.isFinite(x) ? num(s, x < 0 || Object.is(x, -0)) : pad((x < 0 ? '-' : '') + s);
        break;
      }
      case 's': {
        let s = vm.tostr(a[n]);
        if (prec >= 0) s = s.slice(0, prec);
        out += pad(s);
        break;
      }
      case 'q': {
        const v = a[n];
        if (typeof v === 'string') {
          out += '"' + v.replace(/[\\"\n\r\0]|[\x01-\x1f\x7f]/g, ch => ch === '\n' ? '\\\n' : ch === '\r' ? '\\r' :
            ch === '\\' || ch === '"' ? '\\' + ch : '\\' + ch.charCodeAt(0)) + '"';
        } else if (typeof v === 'number') out += v === Math.floor(v) || !Number.isFinite(v) ? (v !== v ? '(0/0)' : v === Infinity ? '1e9999' : v === -Infinity ? '-1e9999' : num2str(v)) : fmtG(v, 17);
        else if (v === undefined || typeof v === 'boolean') out += vm.tostr(v);
        else throw argError(n + 1, 'format', 'value has no literal form');
        break;
      }
    }
  }
  vm.alloc(SZ_STR + out.length);
  return out;
}

// ── Lua patterns (a port of lstrlib.c's matcher: classes, sets, * + - ?, anchors, captures, %b, %f) ──
const CAP_UNF = -1, CAP_POS = -2, MAX_MATCH_DEPTH = 200;
class MatchState {
  constructor(vm, src, pat) { this.vm = vm; this.src = src; this.pat = pat; this.level = 0; this.cap = []; this.depth = 0; }
}
function classEnd(ms, p) {
  const pat = ms.pat;
  const c = pat[p++];
  if (c === '%') {
    if (p >= pat.length) throw rt("malformed pattern (ends with '%')");
    return p + 1;
  }
  if (c === '[') {
    if (pat[p] === '^') p++;
    do {
      if (p >= pat.length) throw rt("malformed pattern (missing ']')");
      const cc = pat[p++];
      if (cc === '%' && p < pat.length) p++;
    } while (pat[p] !== ']');
    return p + 1;
  }
  return p;
}
function matchClass(c, cl) {
  let r;
  const lower = cl | 0x20;
  switch (String.fromCharCode(lower)) {
    case 'a': r = (c >= 65 && c <= 90) || (c >= 97 && c <= 122); break;
    case 'c': r = c < 32 || c === 127; break;
    case 'd': r = c >= 48 && c <= 57; break;
    case 'g': r = c > 32 && c < 127; break;
    case 'l': r = c >= 97 && c <= 122; break;
    case 'p': r = (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126); break;
    case 's': r = c === 32 || (c >= 9 && c <= 13); break;
    case 'u': r = c >= 65 && c <= 90; break;
    case 'w': r = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122); break;
    case 'x': r = (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102); break;
    default: return cl === c;
  }
  return (cl >= 65 && cl <= 90) ? !r : r;
}
function matchBracket(ms, c, p, ec) {   // p at '[', ec at ']'
  const pat = ms.pat;
  let sig = true;
  if (pat[p + 1] === '^') { sig = false; p++; }
  while (++p < ec) {
    if (pat[p] === '%') { p++; if (matchClass(c, pat.charCodeAt(p))) return sig; }
    else if (pat[p + 1] === '-' && p + 2 < ec) { p += 2; if (pat.charCodeAt(p - 2) <= c && c <= pat.charCodeAt(p)) return sig; }
    else if (pat.charCodeAt(p) === c) return sig;
  }
  return !sig;
}
function singleMatch(ms, s, p, ep) {
  if (s >= ms.src.length) return false;
  const c = ms.src.charCodeAt(s);
  switch (ms.pat[p]) {
    case '.': return true;
    case '%': return matchClass(c, ms.pat.charCodeAt(p + 1));
    case '[': return matchBracket(ms, c, p, ep - 1);
    default: return ms.pat.charCodeAt(p) === c;
  }
}
function doMatch(ms, s, p) {
  if (++ms.depth > MAX_MATCH_DEPTH) throw rt('pattern too complex');
  const r = match(ms, s, p);
  ms.depth--;
  return r;
}
function match(ms, s, p) {
  const pat = ms.pat, src = ms.src, vm = ms.vm;
  for (;;) {
    if (--vm.budget < 0) vm.outOfSteps();
    if (p === pat.length) return s;
    const pc = pat[p];
    if (pc === '(') {
      if (pat[p + 1] === ')') return startCapture(ms, s, p + 2, CAP_POS);
      return startCapture(ms, s, p + 1, CAP_UNF);
    }
    if (pc === ')') return endCapture(ms, s, p + 1);
    if (pc === '$' && p + 1 === pat.length) return s === src.length ? s : -1;
    if (pc === '%' && pat[p + 1] === 'b') {
      s = matchBalance(ms, s, p + 2);
      if (s === -1) return -1;
      p += 4; continue;
    }
    if (pc === '%' && pat[p + 1] === 'f') {
      p += 2;
      if (pat[p] !== '[') throw rt("missing '[' after '%f' in pattern");
      const ep = classEnd(ms, p);
      const prev = s === 0 ? 0 : src.charCodeAt(s - 1), cur = s < src.length ? src.charCodeAt(s) : 0;
      if (!matchBracket(ms, prev, p, ep - 1) && matchBracket(ms, cur, p, ep - 1)) { p = ep; continue; }
      return -1;
    }
    if (pc === '%' && pat[p + 1] >= '0' && pat[p + 1] <= '9') {
      s = matchCapture(ms, s, pat.charCodeAt(p + 1));
      if (s === -1) return -1;
      p += 2; continue;
    }
    const ep = classEnd(ms, p), epc = pat[ep];
    if (!singleMatch(ms, s, p, ep)) {
      if (epc === '*' || epc === '?' || epc === '-') { p = ep + 1; continue; }
      return -1;
    }
    switch (epc) {
      case '?': { const r = doMatch(ms, s + 1, ep + 1); if (r !== -1) return r; p = ep + 1; continue; }
      case '+': return maxExpand(ms, s + 1, p, ep);
      case '*': return maxExpand(ms, s, p, ep);
      case '-': return minExpand(ms, s, p, ep);
      default: s++; p = ep;
    }
  }
}
function maxExpand(ms, s, p, ep) {
  let i = 0;
  while (singleMatch(ms, s + i, p, ep)) i++;
  ms.vm.tick(i >> 3);
  while (i >= 0) {
    const r = doMatch(ms, s + i, ep + 1);
    if (r !== -1) return r;
    i--;
  }
  return -1;
}
function minExpand(ms, s, p, ep) {
  for (;;) {
    const r = doMatch(ms, s, ep + 1);
    if (r !== -1) return r;
    if (singleMatch(ms, s, p, ep)) s++; else return -1;
  }
}
function startCapture(ms, s, p, what) {
  ms.cap[ms.level] = { init: s, len: what };
  ms.level++;
  const r = doMatch(ms, s, p);
  if (r === -1) ms.level--;
  return r;
}
function endCapture(ms, s, p) {
  let l = ms.level - 1;
  while (l >= 0 && ms.cap[l].len !== CAP_UNF) l--;
  if (l < 0) throw rt('invalid pattern capture');
  ms.cap[l].len = s - ms.cap[l].init;
  const r = doMatch(ms, s, p);
  if (r === -1) ms.cap[l].len = CAP_UNF;
  return r;
}
function matchBalance(ms, s, p) {
  if (p + 1 >= ms.pat.length) throw rt("malformed pattern (missing arguments to '%b')");
  const src = ms.src;
  if (s >= src.length || src[s] !== ms.pat[p]) return -1;
  const b = ms.pat[p], e = ms.pat[p + 1];
  let cont = 1;
  for (let i = s + 1; i < src.length; i++) {
    const c = src[i];
    if (c === e) { if (--cont === 0) return i + 1; } else if (c === b) cont++;
  }
  return -1;
}
function checkCapture(ms, l) {
  l -= 49;   // '1'
  if (l < 0 || l >= ms.level || ms.cap[l].len === CAP_UNF) throw rt(`invalid capture index %${l + 1}`);
  return l;
}
function matchCapture(ms, s, l) {
  const c = ms.cap[checkCapture(ms, l)], cap = ms.src.substr(c.init, c.len);
  return ms.src.startsWith(cap, s) ? s + c.len : -1;
}
function getCapture(ms, i, s, e) {
  if (i >= ms.level) {
    if (i === 0) return ms.src.slice(s, e);
    throw rt(`invalid capture index %${i + 1}`);
  }
  const c = ms.cap[i];
  if (c.len === CAP_UNF) throw rt('unfinished capture');
  return c.len === CAP_POS ? c.init + 1 : ms.src.substr(c.init, c.len);
}
function captures(ms, s, e, wholeIfNone) {
  const n = ms.level === 0 && wholeIfNone ? 1 : ms.level, out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = getCapture(ms, i, s, e);
  return out;
}
function strFind(vm, a, find) {
  const f = find ? 'find' : 'match';
  const s = checkStr(a, 0, f), pat = checkStr(a, 1, f), l = s.length;
  let init = posrelat(optInt(a, 2, f, 1), l);
  if (init < 1) init = 1;
  if (init > l + 1) return [undefined];
  if (find && (truthy(a[3]) || !/[\^$*+?.()[\]%-]/.test(pat))) {
    const i = s.indexOf(pat, init - 1);
    return i < 0 ? [undefined] : [i + 1, i + pat.length];
  }
  const ms = new MatchState(vm, s, pat), anchor = pat[0] === '^', p = anchor ? 1 : 0;
  let s1 = init - 1;
  do {
    ms.level = 0; ms.depth = 0;
    const e = doMatch(ms, s1, p);
    if (e !== -1) return find ? [s1 + 1, e].concat(captures(ms, s1, e, false)) : captures(ms, s1, e, true);
    s1++;
  } while (s1 <= l && !anchor);
  return [undefined];
}
function gsub(vm, a) {
  const s = checkStr(a, 0, 'gsub'), pat = checkStr(a, 1, 'gsub'), repl = a[2];
  const tr = typeOf(repl);
  if (tr !== 'number' && tr !== 'string' && tr !== 'table' && tr !== 'function') throw typeErr(a, 2, 'gsub', 'string/function/table');
  const maxN = a[3] === undefined ? Infinity : checkInt(a, 3, 'gsub');
  const anchor = pat[0] === '^', p = anchor ? 1 : 0, ms = new MatchState(vm, s, pat), out = [];
  let src = 0, last = -1, n = 0, size = 0;
  while (n < maxN) {
    ms.level = 0; ms.depth = 0;
    const e = doMatch(ms, src, p);
    if (e !== -1 && e !== last) {
      n++;
      const whole = s.slice(src, e);
      let r;
      if (tr === 'string' || tr === 'number') {
        const rs = typeof repl === 'string' ? repl : num2str(repl);
        r = '';
        for (let i = 0; i < rs.length; i++) {
          const ch = rs[i];
          if (ch !== '%') { r += ch; continue; }
          const d = rs[++i];
          if (d === '%') r += '%';
          else if (d >= '0' && d <= '9') {
            const v = d === '0' ? whole : getCapture(ms, d.charCodeAt(0) - 49, src, e);
            r += typeof v === 'number' ? num2str(v) : v;
          } else throw rt("invalid use of '%' in replacement string");
        }
      } else {
        const caps = captures(ms, src, e, true);
        const v = tr === 'table' ? vm.indexSync(repl, caps[0]) : vm.callNested(repl, caps)[0];
        if (v === undefined || v === false) r = whole;
        else if (typeof v === 'string' || typeof v === 'number') r = typeof v === 'string' ? v : num2str(v);
        else throw rt(`invalid replacement value (a ${typeOf(v)})`);
      }
      out.push(r); size += r.length;
      src = last = e;
    } else if (src < s.length) { out.push(s[src++]); size++; }
    else break;
    if (anchor) break;
  }
  if (src < s.length) out.push(s.slice(src));
  vm.alloc(SZ_STR + size);
  return [out.join(''), n];
}

// ═══════════════════════════════════════════ exports ═════════════════════════════════════════════

const Mote = {
  version: '1.0.0',
  /** Creates an independent VM. See MOTE.md for options. */
  create(opts) { return new VM(opts); },
  Error: MoteError,
};
if (typeof module === 'object' && module && module.exports) module.exports = Mote;
else root.Mote = Mote;
})(typeof globalThis !== 'undefined' ? globalThis : this);

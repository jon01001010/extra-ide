#!/usr/bin/env node
// Module-system tests for an Emit IDE build: multi-file projects (bundles), each with the output lines it
// must produce or the compile errors / warnings it must report. Headless Chromium, offline.
//
//   node tests/run-modules.js [path/to/emit-ide.html] [--editor] [testName ...]
//   VERBOSE=1 prints each project's Output tab.
//
// A project is a list of {path, source}; the files are joined into ONE text with the bundle marker lines
// (`//// file: <path>`, the same rule as _emitJoinBundle in the page) and that text is what gets compiled.
//
// Two ways to run a project:
//   default    DIRECT: compile(text) in the page, then the same run path as the Run button
//              (_parseUses/_loadUse, buildImportObject, instantiate, _emitCallExport for every exported
//              function of the ENTRY file that takes no parameters). Independent of the editor plumbing.
//   --editor   the text is put into #editor and compileAndRun() is called, like tests/run-interop.js.
// Diagnostics tests always call compile(text) directly and compare the errors exactly
// (a thrown Error counts as a one-element list).
//
// Also here: split/join round trip (random sources), _emitModuleIndex (good, broken, fuzzed — never throws),
// a generated 12-file project, file-order independence, and byte identity of the bundled single-file
// examples against the compiler as it was before modules (commit BASE_COMMIT, read with `git show`).
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE_COMMIT = '38889c7'; // last commit before the module system
const MARK = '//// file: ';
const join = files => files.map((f, i) => (i === 0 && f.path === 'main.emit' ? '' : MARK + f.path + '\n') + f.source).join('\n');
const F = (p, source) => ({ path: p, source: source.replace(/^\n/, '') });

// A stand-in JS library (window.modLib) for callbacks, promises and errors.
const MOD_LIB = `
window.modLib = {
  fetchUser: function (id) { return new Promise(function (ok) { setTimeout(function () { ok({ id: id, name: 'user' + id }); }, 5); }); },
  failLater: function (why) { return new Promise(function (ok, fail) { setTimeout(function () { fail(new Error(why)); }, 5); }); },
  boom: function () { throw new Error('kaboom'); },
  each: function (list, cb) { for (var i = 0; i < list.length; i++) cb(list[i], i); },
  later: function (cb) { setTimeout(function () { cb(42); }, 10); },
  tagged: function (n) { return { tag: n }; },
  fresh: function () { return { junk: new Array(50).join('x') }; }
};
`;
const USE_LIB = 'window.modGreeter = { greet: function (n) { return "hello " + n + " from a library"; } };';

// ───────────────────────────── projects that run ─────────────────────────────
// expect: lines of the Output tab, in order. Optional: after(page) → problems[], wait (ms), errorsOk
// (red ✗ lines are expected), warnings: exact list, check(result) → problems[] (result of the compile).
const PHYSICS = F('game/physics.emit', `
package game
public let gravity = 9.5
public mut ticks = 0
mut calls = 0
public fn step(dt: num) num {
  calls++
  return gravity * dt
}
public fn count() int {
  return calls
}
fn secret() int {
  return 7
}
`);

const RUN = [
  { name: 'import-module-qualified', files: [
    F('main.emit', `
import game.physics
export fn run() {
  printNum(physics.step(2.0))
  printNum(physics.gravity)
  physics.ticks = physics.ticks + 5
  physics.ticks += 1
  physics.ticks++
  print(physics.ticks)
  let half: num = physics.gravity / 2.0
  printNum(half)
  print(physics.count())
}
`), PHYSICS], expect: ['> 19', '> 9.5', '> 7', '> 4.75', '> 1'], warnings: [] },

  { name: 'import-module-alias', files: [
    F('main.emit', `
import game.physics as p
export fn run() {
  printNum(p.step(1.0) + p.step(1.0))
  p.ticks = 41
  p.ticks++
  print(p.ticks)
  print(p.count())
}
`), PHYSICS], expect: ['> 19', '> 42', '> 2'] },

  { name: 'import-member-and-renamed-member', files: [
    F('main.emit', `
import game.physics.step
import game.physics.step as advance
import game.physics.ticks
import game.physics.count as howMany
export fn run() {
  printNum(step(2.0))
  printNum(advance(4.0))
  ticks = 3
  ticks += 2
  print(ticks)
  print(howMany())
}
`), PHYSICS], expect: ['> 19', '> 38', '> 5', '> 2'] },

  { name: 'import-star', files: [
    F('main.emit', `
import game.physics.*
export fn run() {
  printNum(step(2.0))
  ticks = ticks + 9
  print(ticks)
  printNum(gravity)
  print(count())
}
`), PHYSICS], expect: ['> 19', '> 9', '> 9.5', '> 1'] },

  { name: 'imports-between-other-declarations', files: [
    F('main.emit', `
mut seen = 0
import util.text
fn twice(s: str) str {
  return text.join(s, s)
}
import util.text.shout
export fn run() {
  printStr(twice("ab"))
  printStr(shout("hey"))
}
`), F('util/text.emit', `
public fn join(a: str, b: str) str {
  return a + "+" + b
}
public fn shout(s: str) str {
  return toStr(s.toUpperCase()) + "!"
}
`)], expect: ['> ab+ab', '> HEY!'] },

  { name: 'same-names-in-different-modules', files: [
    F('main.emit', `
import a
import b
mut count = 100
fn bump() int {
  count++
  return count
}
export fn run() {
  print(bump())
  print(a.next())
  print(a.next())
  print(b.next())
  print(bump())
  print(a.total())
  print(b.total())
}
`), F('a.emit', `
mut count = 0
fn bump() int {
  count = count + 1
  return count
}
public fn next() int {
  return bump()
}
public fn total() int {
  return count
}
`), F('b.emit', `
mut count = 1000
fn bump() int {
  count = count + 10
  return count
}
public fn next() int {
  return bump()
}
public fn total() int {
  return count
}
`)], expect: ['> 101', '> 1', '> 2', '> 1010', '> 102', '> 2', '> 1010'] },

  { name: 'cyclic-imports', files: [
    F('main.emit', `
import parity.even
import parity.odd
public fn report(n: int, yes: bool) {
  if (yes) { printStr(intToStr(n) + " yes") } else { printStr(intToStr(n) + " no") }
}
export fn run() {
  print(even.isEven(10))
  print(odd.isOdd(7))
  print(even.isEven(7))
  even.tell(4)
}
`), F('parity/even.emit', `
package parity
import parity.odd
import main
public fn isEven(n: int) int {
  if (n == 0) { return 1 }
  return odd.isOdd(n - 1)
}
public fn tell(n: int) {
  main.report(n, isEven(n) == 1)
}
`), F('parity/odd.emit', `
package parity
import parity.even.isEven
public fn isOdd(n: int) int {
  if (n == 0) { return 0 }
  return isEven(n - 1)
}
`)], expect: ['> 1', '> 1', '> 0', '> 4 yes'] },

  { name: 'explicit-and-local-win-over-star', files: [
    F('main.emit', `
import a.*
import b.*
import b.name
fn level() int {
  return 3
}
export fn run() {
  printStr(name())
  print(level())
  printStr(onlyA())
  printStr(onlyB())
}
`), F('a.emit', `
public fn name() str { return "a" }
public fn level() int { return 1 }
public fn onlyA() str { return "only a" }
`), F('b.emit', `
public fn name() str { return "b" }
public fn level() int { return 2 }
public fn onlyB() str { return "only b" }
`)], expect: ['> b', '> 3', '> only a', '> only b'] },

  { name: 'local-shadows-import-alias', files: [
    F('main.emit', `
import game.physics
fn viaParam(physics: js) {
  printNum(physics.gravity)
}
export fn run() {
  printNum(physics.gravity)
  viaParam(JSON.parse("{\\"gravity\\": 1.5}"))
  if (true) {
    let physics = JSON.parse("{\\"gravity\\": 2.5}")
    printNum(physics.gravity)
  }
  printNum(physics.step(1.0))
}
`), PHYSICS], expect: ['> 9.5', '> 1.5', '> 2.5', '> 9.5'],
    warnings: [
      'main.emit:2:1: The local "physics" hides the import "physics" (module game.physics) here — physics.name is a property of the local, not a member of the module',
      'main.emit:9:5: The local "physics" hides the import "physics" (module game.physics) here — physics.name is a property of the local, not a member of the module',
    ] },

  { name: 'fnref-imported-function-as-js-callback', files: [
    F('main.emit', `
import cb.handlers
import cb.handlers.visit
import cb.handlers.visit as seeIt
import cb.handlers.*
export fn run() {
  let list = JSON.parse("[1, 2]")
  list.forEach(fnRef(handlers.visit))
  list.forEach(fnRef(visit))
  list.forEach(fnRef(seeIt))
  list.forEach(fnRef("visit"))
  list.forEach(fnRef("handlers.visit"))
  list.forEach(fnRef(twice))
  print(handlers.total)
  modLib.each(list, fnRef(handlers.withIndex))
  modLib.later(fnRef(handlers.late))
}
`), F('cb/handlers.emit', `
public mut total = 0
public fn visit(v: int) {
  total = total + v
}
public fn twice(v: int) {
  total = total + 2 * v
}
public fn withIndex(v: int, i: int) {
  printStr("item " + intToStr(i) + " = " + intToStr(v))
}
public fn late(v: int) {
  printStr("late " + intToStr(v + total))
}
`)], expect: ['> 21', '> item 0 = 1', '> item 1 = 2', '> late 63'], wait: 300 },

  { name: 'fnref-imported-function-as-button-handler', files: [
    F('main.emit', `
import ui.buttons
import ui.buttons.clicked as onPress
export fn onclick_1() {
  buttons.fromBuiltin()
}
export fn run() {
  let out = document.getElementById("tab-output")
  let b1 = document.createElement("button")
  b1.id = "mod-b1"
  b1.onclick = fnRef(buttons.clicked)
  out.appendChild(b1)
  let b2 = document.createElement("button")
  b2.id = "mod-b2"
  b2.addEventListener("click", fnRef(onPress))
  out.appendChild(b2)
  button("builtin", 1)
}
`), F('ui/buttons.emit', `
package ui
mut clicks = 0
public fn clicked(ev: js) {
  clicks++
  printStr("clicked " + intToStr(clicks) + " " + toStr(ev.type))
}
public fn fromBuiltin() {
  clicks = clicks + 10
  printStr("builtin button " + intToStr(clicks))
}
`)], expect: ['> clicked 1 click', '> clicked 2 click', '> builtin button 12'],
    after: async page => {
      await page.click('#mod-b1');
      await page.click('#mod-b2');
      await page.evaluate(() => { document.getElementById('emit-el-1').click(); });
      return [];
    } },

  { name: 'await-across-modules-in-a-loop-with-try', files: [
    F('main.emit', `
import data.store
import net.api.fetchName
export fn run() {
  for (let i = 1; i <= 3; i++) {
    try {
      let name: str = await store.load(i)
      printStr("got " + name)
    } catch (e) {
      printStr("caught " + toStr(e.message) + " at " + intToStr(i))
    }
  }
  let direct: str = fetchName(9)
  printStr("direct " + direct)
  printStr("loads " + intToStr(store.loads))
}
`), F('data/store.emit', `
package data
import net.api
public mut loads = 0
public fn load(id: int) str {
  loads++
  if (id == 2) {
    api.fail("no user " + intToStr(id))
  }
  let n: str = api.fetchName(id)
  return n + "!"
}
`), F('net/api.emit', `
package net
public fn fetchName(id: int) str {
  let u = await modLib.fetchUser(id)
  let n: str = u.name
  return n
}
public fn fail(why: str) {
  let never = await modLib.failLater(why)
  printStr("not reached")
}
`)], expect: ['> got user1!', '> caught no user 2 at 2', '> got user3!', '> direct user9', '> loads 3'], wait: 500,
    check: r => (r.asyncFns.split(',').sort().join(',') === 'data.store.load,net.api.fail,net.api.fetchName,run' ? [] : ['asyncFns should name the functions of all three modules, got ' + r.asyncFns]) },

  { name: 'try-catches-an-error-thrown-two-modules-deep', files: [
    F('main.emit', `
import mid
export fn run() {
  try {
    mid.work(1)
    printStr("after work (not reached)")
  } catch (e) {
    printStr("caught: " + toStr(e.message))
  }
  try {
    mid.work(2)
  } catch (e) {
    printStr("caught: " + toStr(e.message))
  }
  try {
    JSON.parse("[1, 2]").forEach(fnRef(mid.visit))
  } catch (e) {
    printStr("caught: " + toStr(e.message))
  }
  printStr("steps " + intToStr(mid.steps))
}
`), F('mid.emit', `
import deep
public mut steps = 0
public fn work(n: int) {
  steps++
  deep.explode(n)
  steps = steps + 100
  printStr("mid continues (not reached)")
}
public fn visit(v: int) {
  steps = steps + 10
  if (v == 2) { throw "visit " + intToStr(v) }
}
`), F('deep.emit', `
public fn explode(n: int) {
  if (n == 1) { modLib.boom() }
  throw "deep " + intToStr(n)
}
`)], expect: ['> caught: kaboom', '> caught: deep 2', '> caught: visit 2', '> steps 22'] },

  { name: 'arrays-and-strings-between-modules', files: [
    F('main.emit', `
import lists
import lists.label as tag
export fn run() {
  let xs = [3, 4, 5]
  print(lists.sum(xs))
  lists.addTwice(xs, 10)
  print(xs.length)
  print(lists.sum(xs))
  let ns = lists.halves(3)
  printNum(ns[2])
  printStr(tag("id", 7))
  let words: js = lists.words()
  printStr(toStr(words.join("-")))
  lists.keep(xs)
  print(lists.kept.length)
  printStr(lists.title + "/" + tag(lists.title, 1))
}
`), F('lists.emit', `
public mut kept: arr = 0
public let title = "lists"
public fn sum(xs: arr) int {
  let t = 0
  for (let i = 0; i < xs.length; i++) { t = t + xs[i] }
  return t
}
public fn addTwice(xs: arr, v: int) {
  xs.push(v)
  xs.push(v)
}
public fn halves(n: int) numarr {
  let out = [0.5]
  for (let i = 1; i < n; i++) { out.push(i + 0.5) }
  return out
}
public fn label(s: str, n: int) str {
  return s + "#" + intToStr(n)
}
public fn words() js {
  return ["a", "b", "c"]
}
public fn keep(xs: arr) {
  kept = xs
}
`)], expect: ['> 12', '> 5', '> 32', '> 2.5', '> id#7', '> a-b-c', '> 5', '> lists/lists#1'] },

  // Module-level variables are WASM globals of the one compiled module: what they hold must survive the
  // collector while frames churn garbage (the collector scans the exported globals).
  { name: 'module-globals-stay-alive-across-frames', files: [
    F('main.emit', `
import state.keep
import state.keep.frameN
export fn run() {
  keep.setup()
  animate()
}
export fn frame() {
  frameN++
  let tmp = modLib.fresh()
  let junk = "junk " + intToStr(frameN)
  let scratch = [frameN, 2, 3]
  keep.tick(frameN)
}
export fn check() {
  if (frameN > 0) { keep.report() }
}
`), F('state/keep.emit', `
package state
public mut frameN = 0
mut obj: js = null
mut label: str = ""
mut list: arr = 0
mut nums: numarr = 0
mut cur: js = null
mut curAt = 0
public fn setup() {
  obj = modLib.tagged(11)
  label = "label " + intToStr(11)
  list = [5, 6, 7]
  nums = [1.5, 2.5]
}
public fn tick(n: int) {
  if (n % 500 == 1) {
    cur = modLib.tagged(n)
    curAt = n
    list.push(n)
  }
}
public fn report() {
  let t: int = obj.tag
  print(t)
  printStr(label)
  print(list[1] + list.length)
  printNum(nums[1])
  let c: int = cur.tag
  print(c - curAt)
  print(frameN)
}
`)], expect: ['> 11', '> label 11', '> 17', '> 2.5', '> 0', '> 4000'],
    before: page => page.evaluate(() => { window.requestAnimationFrame = function () { return 0; }; }),
    after: async page => page.evaluate(() => {
      const p = [];
      for (let i = 0; i < 4000; i++) _emitFrame();
      const st = _memStats();
      if (!(st.collections > 0)) p.push('the collector never ran in 4000 frames: ' + JSON.stringify(st));
      if (st.handles > 200) p.push('handles leak: ' + st.handles);
      _emitCallExport(window._wi, 'check', []);
      return p;
    }) },

  { name: 'use-line-in-a-non-entry-module', files: [
    F('main.emit', `
import greet.hello
export fn run() {
  printStr(hello.to("emit"))
}
`), F('greet/hello.emit', `
use "https://libs.test/modgreeter.js"
package greet
public fn to(name: str) str {
  let s: str = modGreeter.greet(name)
  return s
}
`)], expect: ['> hello emit from a library'] },

  { name: 'export-fn-in-a-non-entry-module', files: [
    F('main.emit', `
import game.physics
export fn run() {
  printNum(physics.step(1.0))
}
`), F('game/physics.emit', `
mut calls = 0
export fn step(dt: num) num {
  calls++
  return dt * 2.0
}
export fn hostOnly() {
  printStr("hostOnly ran")
}
public export fn both() int { return calls }
export public fn both2() int { return calls + 1 }
`)], expect: ['> 2'],
    check: r => {
      const p = [], want = 'game.physics.both,game.physics.both2,game.physics.hostOnly,game.physics.step,run';
      if (r.exports.slice().sort().join(',') !== want) p.push('exports should be ' + want + ', got ' + r.exports.slice().sort().join(','));
      return p;
    },
    after: async page => page.evaluate(direct => {
      const p = [], out = document.getElementById('tab-output');
      // DIRECT mode runs entry-file exports only; the IDE's Run today calls every export (see the report)
      if (direct && /hostOnly ran/.test(out.innerText)) p.push('a non-entry export was auto-run');
      const v = _emitCallExport(window._wi, 'game.physics.step', [4.5]);
      if (v !== 9) p.push('game.physics.step(4.5) from the host should be 9, got ' + v);
      const n = _emitCallExport(window._wi, 'game.physics.both', []);
      if (!(n >= 2n)) p.push('game.physics.both() should count the calls, got ' + n);
      return p;
    }, !process.argv.includes('--editor')) },

  { name: 'package-line-matches', files: [
    F('app/main.emit', `
package app
import app.util.fmt
export fn run() {
  printStr(fmt.wrap("x"))
}
`), F('app/util/fmt.emit', `
package app.util
public fn wrap(s: str) str { return "[" + s + "]" }
`)], expect: ['> [x]'],
    check: r => (r.exports.join(',') === 'run' && r.files.join(',') === 'app/main.emit,app/util/fmt.emit' ? [] : ['entry exports keep their plain name / files: ' + r.exports + ' / ' + r.files]) },

  // The entry file's names stay plain in the compiled program; they must not capture a builtin or a JS
  // global that another module uses under the same name.
  { name: 'entry-names-do-not-leak-into-other-modules', files: [
    F('main.emit', `
import other
mut title = 5
fn print(x: int) {
  printStr("main's own print " + intToStr(x))
}
fn parseInt(s: str) int {
  return 111
}
export fn run() {
  print(title)
  print(parseInt("7"))
  other.show()
}
`), F('other.emit', `
public fn show() {
  print(3)
  let n: int = parseInt("42")
  print(n)
  document.title = "from other"
  let t: str = document.title
  printStr(t)
  let w = window
  w.title = "window title"
  printStr(typeOf(title))
  printStr(toStr(title))
}
`)], expect: ["> main's own print 5", "> main's own print 111", '> 3', '> 42', '> from other', '> string', '> window title'] },

  { name: 'raw-wasm-import-and-old-identifiers', files: [
    F('main.emit', `
import lib
export fn run() {
  let public = 3
  let package = 4
  let o = JSON.parse("{\\"public\\": 5, \\"package\\": 6, \\"import\\": 7}")
  let a: int = o.public
  let b: int = o.package
  let c: int = o.import
  print(public + package + a + b + c)
  print(lib.viaMath(2.0))
}
`), F('lib.emit', `
import fn jsSqrt(x: num) num from "Math"
public fn viaMath(x: num) int {
  return 5
}
`)], expect: ['> 25', '> 5'] },

  { name: 'locals-and-imported-names', files: [
    F('main.emit', `
import m.step
import m.*
export fn run() {
  let step = 3
  print(step)
  print(step(2))
  let other = JSON.parse("5")
  let n: int = other
  print(n + total)
  for (let total = 0; total < 1; total++) { print(total) }
  print(total)
  try { throw "x" } catch (total) { printStr(toStr(total.message)) }
}
`), F('m.emit', `
public mut total = 40
public fn step(x: int) int { return x * 10 }
`)], expect: ['> 3', '> 20', '> 45', '> 0', '> 40', '> x'] },

  { name: 'fnref-by-name-inside-a-module', files: [
    F('main.emit', `
import m
export fn run() { m.go() }
export fn hit(x: int) { print(x + 100) }
`), F('m.emit', `
fn mine(x: int) { print(x) }
// a name only known at run time is looked up among the exported functions (here: hit of the entry file);
// done from a timer because the IDE publishes the instance only after its first calls
fn later() {
  let name = "hit"
  JSON.parse("[1]").forEach(fnRef(name))
}
public fn go() {
  let list = JSON.parse("[1]")
  list.forEach(fnRef("mine"))
  list.forEach(fnRef(mine))
  setTimeout(fnRef(later), 30)
}
`)], expect: ['> 1', '> 1', '> 101'], wait: 400 },

  { name: 'module-function-named-like-a-builtin', files: [
    F('main.emit', `
import out.print
import out
export fn run() {
  print(3)
  out.print(4)
  out.show()
  out.builtin()
}
`), F('out.emit', `
public fn print(x: int) { printStr("out.print " + intToStr(x)) }
public fn show() { print(5) }
public fn builtin() { printNum(1.5) }
`)], expect: ['> out.print 3', '> out.print 4', '> out.print 5', '> 1.5'] },

  { name: 'qualified-names-in-every-position', files: [
    F('main.emit', `
import cfg
import main
import main.helper as h
fn helper() int { return 4 }
export fn run() {
  cfg.init()
  printStr(toStr(cfg.data.name.toUpperCase()))
  cfg.data.name = "changed"
  let s: str = cfg.data.name
  printStr(s)
  print(cfg.list[1])
  cfg.list[1] = 9
  print(cfg.list[1] + cfg.list.length)
  printStr(cfg.title + "!")
  let v = await cfg.later()
  printStr(toStr(v))
  if (cfg.ready && !cfg.off) { print(main.helper() + h()) }
  let o = {n: cfg.list, t: cfg.title}
  printStr(toStr(JSON.stringify(o)))
  cfg.scale = cfg.scale * 2.0
  printNum(-cfg.scale)
}
`), F('cfg.emit', `
public mut data: js = null
public mut list: arr = 0
public let title = "cfg"
public let ready = true
public let off = false
public mut scale = 1.25
public fn init() {
  data = JSON.parse("{\\"name\\": \\"n1\\"}")
  list = [1, 2, 3]
}
public fn later() js {
  return Promise.resolve("later ok")
}
`)], expect: ['> N1', '> changed', '> 2', '> 12', '> cfg!', '> later ok', '> 8', '> {"n":[1,9,3],"t":"cfg"}', '> -2.5'], wait: 300 },

  { name: 'single-file-with-public-and-no-markers', files: [
    F('main.emit', `
public mut n = 2
public fn twice(x: int) int { return x * n }
public export fn run() {
  print(twice(21))
}
`)], expect: ['> 42'],
    check: r => (r.files.join(',') === 'main.emit' && Object.keys(r.modules).join(',') === 'main' && r.modules.main.publics.map(p => p.name + ':' + p.kind + ':' + p.returnType + ':' + p.mutable).join(' ') === 'n:var:int:true twice:fn:int:false run:fn:void:false' ? [] : ['files/modules of a single-file project: ' + JSON.stringify([r.files, r.modules])]) },
];

// ───────────────────────────── diagnostics ─────────────────────────────
// errors: the exact list compile() must report (errors array, or the message of the thrown Error).
// warnings: exact list (optional). thrown: true → must be thrown, false → must be in the errors array.
const A_B = [F('a.emit', 'public fn name() str { return "a" }\npublic fn onlyA() int { return 1 }\nfn hidden() int { return 0 }\npublic let limit = 10\nmut privateCount = 0\n'),
  F('b.emit', 'public fn name() str { return "b" }\n')];
const DIAG = [
  { name: 'diag-unknown-module', files: [F('main.emit', `
import game.physic
import gmae.physics.step
import nothere
import game.physics.*
import game.physisc.*
export fn run() { }
`), PHYSICS], errors: [
    'main.emit:1:8: Unknown module "game.physic" — there is no file game/physic.emit in this project (and no module game with a member "physic") — did you mean "game.physics"?',
    'main.emit:2:8: Unknown module "gmae.physics.step" — there is no file gmae/physics/step.emit in this project (and no module gmae.physics with a member "step") — did you mean "game.physics"?',
    'main.emit:3:8: Unknown module "nothere" — there is no file nothere.emit in this project',
    'main.emit:5:8: Unknown module "game.physisc" — there is no file game/physisc.emit in this project — did you mean "game.physics"?',
  ], thrown: false },

  { name: 'diag-unknown-and-private-member', files: [F('main.emit', `
import game.physics
import game.physics.stepp
import game.physics.secret
export fn run() {
  physics.stp(1.0)
  print(physics.secret())
  print(physics.calls)
  physics.nothing = 3
}
`), PHYSICS], errors: [
    'main.emit:2:21: Module game.physics has no top-level name "stepp" — did you mean "step"?',
    'main.emit:3:21: "secret" is private to module game.physics — declare it with public (public fn secret(..)) to use it from another file',
    'main.emit:5:3: Module game.physics has no top-level name "stp" — did you mean "step"?',
    'main.emit:6:9: "secret" is private to module game.physics — declare it with public (public fn secret(..)) to use it from another file',
    'main.emit:7:9: "calls" is private to module game.physics — declare it with public (public mut calls) to use it from another file',
    'main.emit:8:3: Module game.physics has no top-level name "nothing"',
  ], thrown: false },

  { name: 'diag-star-import-ambiguity-only-when-used', files: [F('main.emit', `
import a.*
import b.*
export fn run() {
  print(onlyA())
  printStr(name())
}
`), ...A_B], errors: [
    'main.emit:5:12: "name" is ambiguous — it is public in a.name and b.name (both imported with *); import the one you mean by name: import a.name',
  ], thrown: false },

  { name: 'diag-star-import-collision-unused-is-fine', files: [F('main.emit', `
import a.*
import b.*
export fn run() {
  print(onlyA())
}
`), ...A_B], errors: [], warnings: ['main.emit:2:1: Unused import b.*'] },

  { name: 'diag-direct-import-collisions', files: [F('main.emit', `
import a.name
import b.name
import a.onlyA
import a.limit as cap
import b as cap
import a as onlyA
fn onlyA() int { return 2 }
mut cap = 0
export fn run() { }
`), ...A_B], errors: [
    'main.emit:2:10: "name" is imported from module b here and from module a at line 1 — rename one of them: import b.name as other',
    'main.emit:3:10: "onlyA" is imported from module a here, but this file declares its own top-level "onlyA" at line 7 — rename one of them: import a.onlyA as other',
    'main.emit:4:19: "cap" is imported from module a here, but this file declares its own top-level "cap" at line 8 — rename one of them: import a.limit as other',
    'main.emit:5:13: The import name "cap" (module b) collides with the top-level "cap" declared at line 8 of this file — choose another name: import b as other',
    'main.emit:6:13: The import name "onlyA" (module a) collides with the top-level "onlyA" declared at line 7 of this file — choose another name: import a as other',
  ], thrown: false },

  { name: 'diag-duplicate-import-alias', files: [F('main.emit', `
import a
import b as a
import x.a
import a
export fn run() { print(a.onlyA()) }
`), ...A_B, F('x/a.emit', 'public fn z() int { return 1 }\n')], errors: [
    'main.emit:2:13: The name "a" is already used for the import of module a at line 1 — choose another name: import b as other',
    'main.emit:3:10: The name "a" is already used for the import of module a at line 1 — choose another name: import x.a as other',
  ], thrown: false },

  { name: 'diag-module-vs-member-ambiguity', files: [F('main.emit', `
import a.b.c
export fn run() { }
`), F('a/b.emit', 'public fn c() int { return 1 }\n'), F('a/b/c.emit', 'public fn d() int { return 2 }\n')], errors: [
    'main.emit:1:8: import a.b.c is ambiguous: a/b/c.emit is module a.b.c, and module a.b also has a top-level name "c" — rename one of them',
  ], thrown: false },

  { name: 'diag-longest-prefix-wins', files: [F('main.emit', `
import a.b.c
import a.b.d
export fn run() { print(c.e() + d()) }
`), F('a/b.emit', 'public fn d() int { return 1 }\n'), F('a/b/c.emit', 'public fn e() int { return 2 }\n')], errors: [], warnings: [] },

  { name: 'diag-package-mismatch', files: [F('main.emit', `
package main
import game.physics
import game.util.vec
export fn run() { print(physics.x() + vec.y()) }
`), F('game/physics.emit', 'package games\npublic fn x() int { return 1 }\n'),
  F('game/util/vec.emit', 'use dayjs\npublic fn y() int { return 1 }\npackage game.util\n'),
  F('game/util/ok.emit', '// a comment first is fine\npackage game.util\n')], errors: [
    'main.emit:1:1: package main does not match this file — main.emit is in the root folder, so it has no package: remove this line',
    'game/physics.emit:1:1: package games does not match this file — game/physics.emit is module game.physics, so the line must be: package game',
    'game/util/vec.emit:3:1: package must be the first declaration of the file',
  ], thrown: false },

  { name: 'diag-duplicate-and-invalid-paths', files: [F('main.emit', 'export fn run() { }\n'), F('a.emit', 'fn x() { }\n'), F('a.emit', 'fn y() { }\n'),
    F('../up.emit', ''), F('notes.txt', ''), F('sp ace.emit', ''), F('/abs.emit', ''), F('a//b.emit', ''), F('x/a.b.emit', ''), F('x/a/b.emit', '')], errors: [
    'a.emit:1:1: Duplicate file path "a.emit" — every file of a project needs its own path',
    '../up.emit:1:1: Invalid file path "../up.emit" — a path is relative, uses / between folders, only the characters A-Z a-z 0-9 _ . / - and ends with .emit',
    'notes.txt:1:1: Invalid file path "notes.txt" — a path is relative, uses / between folders, only the characters A-Z a-z 0-9 _ . / - and ends with .emit',
    'sp ace.emit:1:1: Invalid file path "sp ace.emit" — a path is relative, uses / between folders, only the characters A-Z a-z 0-9 _ . / - and ends with .emit',
    '/abs.emit:1:1: Invalid file path "/abs.emit" — a path is relative, uses / between folders, only the characters A-Z a-z 0-9 _ . / - and ends with .emit',
    'a//b.emit:1:1: Invalid file path "a//b.emit" — a path is relative, uses / between folders, only the characters A-Z a-z 0-9 _ . / - and ends with .emit',
    'x/a/b.emit:1:1: File "x/a/b.emit" and file "x/a.b.emit" are both module x.a.b — rename one of them',
  ], thrown: false },

  { name: 'diag-module-used-as-a-value', files: [F('main.emit', `
import a
export fn run() {
  let x = a
  a()
  let f = fnRef(a)
}
`), ...A_B], errors: [
    'main.emit:3:11: "a" is a module (import a) — use one of its members: a.name',
    'main.emit:4:3: "a" is a module (import a), not a function — call one of its members: a.name(..)',
    'main.emit:5:17: "a" is a module — fnRef needs a function: fnRef(a.name)',
  ], thrown: false },

  { name: 'diag-assign-to-let-of-another-module', files: [F('main.emit', `
import a
import a.limit
export fn run() {
  a.limit = 3
  limit += 1
}
`), ...A_B], errors: [
    'main.emit:4:3: "limit" is declared with let in module a — it cannot be assigned from another file (declare it: public mut limit)',
    'main.emit:5:3: "limit" is declared with let in module a — it cannot be assigned from another file (declare it: public mut limit)',
  ], thrown: false },

  { name: 'diag-fnref-unknown-function', files: [F('main.emit', `
import a
export fn run() {
  setTimeout(fnRef(a.onlyA), 10)
  setTimeout(fnRef(nothing), 10)
}
`), ...A_B], errors: [
    'main.emit:4:20: fnRef(nothing) — there is no function named "nothing" in this file or its imports',
  ], thrown: false },

  { name: 'diag-entry-export-would-capture-a-name', files: [F('main.emit', `
import other
export fn helper() { }
export fn run() { other.go() }
`), F('other.emit', `
public fn go() {
  helper()
}
`)], errors: [
    'other.emit:2:3: "helper" is not declared or imported in this file, but the entry file main.emit exports a function with that name — in the compiled program the two would be one name: import it (import main.helper) or rename one of them',
  ], thrown: false },

  { name: 'diag-raw-import-declared-two-ways', files: [F('main.emit', `
import fn hostLog(x: int) from "env"
import fn hostAdd(a: int, b: int) int from "env"
import other
export fn run() { hostLog(other.go()) }
`), F('other.emit', `
import fn hostLog(x: num) from "env"
import fn hostAdd(a: int, b: int) int from "env"
public fn go() int {
  return hostAdd(1, 2)
}
`)], errors: [
    'other.emit:1:1: import fn hostLog is declared differently in main.emit (line 1) — a WASM import has one signature and one module per program: make the two declarations the same or rename one',
  ], thrown: false },

  { name: 'diag-raw-import-of-another-module-would-capture-a-name', files: [F('main.emit', `
import b
export fn run() {
  hostLog(1)
  b.go()
}
`), F('b.emit', `
import fn hostLog(x: int) from "env"
public fn go() { hostLog(2) }
`)], errors: [
    'main.emit:3:3: "hostLog" is not declared or imported in this file, but module b declares a WASM import fn with that name — in the compiled program the two would be one name: declare the import in this file too, or rename one of them',
  ], thrown: false },

  { name: 'diag-undefined-name-in-a-module-without-js', files: [F('main.emit', `
import b
export fn run() { print(b.f()) }
`), F('b.emit', `
public fn f() int {
  let x: str = 5
  return missing(1)
}
`)], errors: ['b.emit:2:3: Cannot assign int to str'], thrown: false },

  { name: 'diag-raw-import-shared-by-two-modules', files: [F('main.emit', `
import fn hostAdd(a: int, b: int) int from "env"
import other
export fn run() { print(hostAdd(1, other.go())) }
`), F('other.emit', `
import fn hostAdd(a: int, b: int) int from "env"
public fn go() int {
  return hostAdd(1, 2)
}
`)], errors: [], check: r => (r.importNames.filter(n => n === 'env.hostAdd').length === 1 ? [] : ['the shared WASM import should be declared once: ' + r.importNames]) },

  // every kind of error carries path:line:col with the line relative to its file
  { name: 'diag-lexer-error-in-second-file', files: [F('main.emit', 'import b\nexport fn run() { b.f() }\n'), F('b.emit', '// one\n// two\npublic fn f() {\n  let x = 1 # 2\n}\n')],
    errors: ["b.emit:4:13: Unexpected '#'"], thrown: true },
  { name: 'diag-parser-error-in-second-file', files: [F('main.emit', 'import b\nexport fn run() { b.f() }\n'), F('b.emit', '// one\npublic fn f() {\n  let = 3\n}\n')],
    errors: ['b.emit:3:7: Expected IDENTIFIER, got ASSIGN(=)'], thrown: true },
  { name: 'diag-annotator-error-in-second-file', files: [F('main.emit', 'import b\nexport fn run() { b.f() }\n'), F('b.emit', '// one\n// two\npublic mut started = now()\npublic fn f() { }\n')],
    errors: [/^b\.emit:3:22: Top-level 'started' must start with a literal .* write e\.g\. `mut started = 0` here/], thrown: true },
  { name: 'diag-checker-errors-in-two-files', files: [F('main.emit', 'import b\nexport fn run() {\n  let s: str = 5\n  b.f()\n}\n'), F('b.emit', '// one\npublic fn f() int {\n  let t: str = 1.5\n  return "no"\n}\n')],
    errors: ['main.emit:3:3: Cannot assign int to str', 'b.emit:3:3: Cannot assign num to str', /^b\.emit:4:3: Return type is int but this returns str/], thrown: false },
  { name: 'diag-single-file-keeps-the-old-format', files: [F('main.emit', 'export fn run() {\n  let s: str = 5\n}\n')],
    errors: ['2:3: Cannot assign int to str'], thrown: false },
  { name: 'diag-single-file-import-of-missing-module', files: [F('main.emit', 'import game.physics\npackage x\nexport fn run() { }\n')],
    errors: ['1:8: Unknown module "game.physics" — there is no file game/physics.emit in this project (and no module game with a member "physics")', '2:1: package must be the first declaration of the file'], thrown: false },
  { name: 'diag-single-file-parse-errors-keep-the-old-format', files: [F('main.emit', 'export fn run() {\n  let = 3\n}\n')],
    errors: ['2:7: Expected IDENTIFIER, got ASSIGN(=)'], thrown: true },
  { name: 'diag-one-file-with-a-marker-is-a-project', files: [F('app.emit', 'export fn run() {\n  let s: str = 5\n}\n')],
    errors: ['app.emit:2:3: Cannot assign int to str'], thrown: false },
  { name: 'diag-import-syntax', files: [F('main.emit', 'import a.* as x\n'), ...A_B],
    errors: ['main.emit:1:12: import a.* brings in every public name — it cannot be renamed with as'], thrown: true },
  { name: 'diag-public-syntax', files: [F('main.emit', 'public count = 0\n'), ...A_B],
    errors: ['main.emit:1:1: public must be followed by fn, let or mut — public fn name() { }, public let name = 0'], thrown: true },

  { name: 'diag-warnings', files: [F('main.emit', `
import a
import b.name
import game.loop
export fn run() { loop.go() }
`), ...A_B, F('game/loop.emit', 'public fn go() { }\nexport fn frame() { }\nexport fn onclick_3() { }\n')], errors: [], warnings: [
    'main.emit:1:1: Unused import a',
    'main.emit:2:1: Unused import b.name',
    'game/loop.emit:2:1: export fn frame in module game.loop is exported as "game.loop.frame" — the page only calls frame() of the entry file main.emit',
    'game/loop.emit:3:1: export fn onclick_3 in module game.loop is exported as "game.loop.onclick_3" — the page only calls onclick_3() of the entry file main.emit',
  ] },
];

// ───────────────────────────── generated projects ─────────────────────────────
// 12 files: m0 … m10 form a ring of imports (each calls the next two, cyclic) plus the entry.
function bigProject() {
  const N = 11, files = [];
  let main = '';
  for (let i = 0; i < N; i++) main += 'import mods.m' + i + (i % 3 === 0 ? ' as q' + i : '') + '\n';
  main += 'export fn run() {\n  let t = 0\n';
  for (let i = 0; i < N; i++) main += '  t = t + ' + (i % 3 === 0 ? 'q' + i : 'm' + i) + '.value(3)\n';
  main += '  print(t)\n';
  for (let i = 0; i < N; i++) main += '  ' + (i % 3 === 0 ? 'q' + i : 'm' + i) + '.bump()\n';
  main += '  print(' + Array.from({ length: N }, (_, i) => (i % 3 === 0 ? 'q' + i : 'm' + i) + '.hits').join(' + ') + ')\n}\n';
  files.push(F('main.emit', main));
  for (let i = 0; i < N; i++) {
    const a = (i + 1) % N, b = (i + 2) % N;
    files.push(F('mods/m' + i + '.emit', `package mods
import mods.m${a}
import mods.m${b}.value as far
public mut hits = 0
mut depth = 0
fn local(n: int) int { return n * ${i + 1} }
public fn value(n: int) int {
  if (n == 0) { return local(1) }
  return local(n) + m${a}.value(n - 1) + far(n - 1)
}
public fn bump() {
  hits = hits + ${i + 1}
  m${a}.hits = m${a}.hits + 1
}
`));
  }
  return files;
}
// What value(3) summed over all modules must be — the same recursion in JS.
function bigExpected() {
  const N = 11, value = (i, n) => (n === 0 ? i + 1 : n * (i + 1) + value((i + 1) % N, n - 1) + value((i + 2) % N, n - 1));
  let t = 0;
  for (let i = 0; i < N; i++) t += value(i, 3);
  return ['> ' + t, '> ' + (N * (N + 1) / 2 + N)];
}

// ───────────────────────────── page helpers ─────────────────────────────
const EDITOR = process.argv.includes('--editor');

async function newPage(browser, fileUrl, problems) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message.slice(0, 300)));
  await page.route(/^https?:/, route => (route.request().url() === 'https://libs.test/modgreeter.js'
    ? route.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: USE_LIB })
    : route.abort()));
  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof compile === 'function' && typeof _emitSplitBundle === 'function');
  await page.evaluate(MOD_LIB);
  await page.evaluate(() => { try { closeWelcome(); } catch (e) {} });
  return page;
}

// compile(text) only: {errors, warnings, thrown, ...}
const compileOnly = (page, text) => page.evaluate(text => {
  try {
    const r = compile(text, 'wasm32');
    return { errors: r.errors, warnings: r.warnings || [], thrown: null, files: r.files, modules: r.modules, importNames: r.imports.map(i => i.module + '.' + i.name), asyncFns: r.imports.asyncFns || '', bytes: r.wasm.length };
  } catch (e) { return { errors: [], warnings: [], thrown: String(e.message) }; }
}, text);

// DIRECT run: compile(text) + what the Run button does after compiling.
const runDirect = (page, text) => page.evaluate(async text => {
  const out = document.getElementById('tab-output');
  out.innerHTML = ''; _canvas = null; _ctx = null; _animRunning = false; _resetJsInterop();
  const fail = m => { const d = document.createElement('div'); d.textContent = '✗ ' + m; out.appendChild(d); };
  try { for (const u of _parseUses(text)) await _loadUse(u); } catch (e) { fail('use: ' + e.message); return { status: 'Error' }; }
  let r;
  try { r = compile(text, 'wasm32'); } catch (e) { fail(e.message); return { status: 'Error' }; }
  const info = { status: 'Done', errors: r.errors, warnings: r.warnings || [], files: r.files, modules: r.modules, asyncFns: r.imports.asyncFns || '', importNames: r.imports.map(i => i.module + '.' + i.name) };
  if (r.errors.length) { r.errors.forEach(fail); info.status = 'Error'; return info; }
  const impLog = [];
  const inst = await WebAssembly.instantiate(await WebAssembly.compile(r.wasm), buildImportObject(r.imports, impLog));
  _wasmMem = inst.exports.memory; window._wi = inst; window._impLog = impLog;
  info.exports = Object.keys(inst.exports).filter(k => typeof inst.exports[k] === 'function');
  const entries = info.exports.filter(k => inst.exports[k].length === 0 && k.indexOf('.') < 0 && k !== 'frame' && !/^(onclick_|ontimer_|onhttp_)/.test(k));
  for (const n of entries) { try { _emitCallExport(inst, n, []); } catch (e) { fail(n + ' → ' + e.message); } }
  return info;
}, text);

// EDITOR run: the text goes through the editor and compileAndRun().
async function runEditor(page, text) {
  await page.evaluate(src => {
    const ed = document.getElementById('editor');
    ed.value = src;
    ed.dispatchEvent(new Event('input'));
  }, text);
  let rejected = null;
  await page.evaluate(() => compileAndRun()).catch(e => { rejected = e.message.slice(0, 300); });
  const info = await compileOnly(page, text);
  info.status = rejected ? 'run rejected: ' + rejected : await page.evaluate(() => document.getElementById('sTxt').innerText);
  info.exports = await page.evaluate(() => (window._wi ? Object.keys(window._wi.exports).filter(k => typeof window._wi.exports[k] === 'function') : []));
  return info;
}

function sameList(got, want, what) {
  const p = [];
  if (got.length !== want.length) p.push(what + ': expected ' + want.length + ', got ' + got.length + (got.length ? '\n        ' + got.join('\n        ') : ''));
  else want.forEach((w, i) => { if (!(w instanceof RegExp ? w.test(got[i]) : got[i] === w)) p.push(what + ' ' + (i + 1) + ':\n        want ' + w + '\n        got  ' + got[i]); });
  return p;
}

async function runProject(browser, fileUrl, t) {
  const problems = [];
  const page = await newPage(browser, fileUrl, problems);
  const text = join(t.files);
  if (t.before) await t.before(page);
  const info = await (EDITOR ? runEditor(page, text) : runDirect(page, text)).catch(e => ({ status: 'run failed: ' + e.message.slice(0, 300) }));
  if (t.after) problems.push(...((await t.after(page).catch(e => ['after() failed: ' + e.message.slice(0, 300)])) || []));
  await page.waitForTimeout(t.wait || 200);
  const output = await page.evaluate(() => document.getElementById('tab-output').innerText);
  await page.close();
  const lines = output.split('\n').map(l => l.trim());
  if (info.status !== 'Done') problems.push('status: ' + info.status + ' — ' + (lines.find(l => /✗/.test(l)) || ''));
  let at = 0;
  for (const want of t.expect) {
    const hit = lines.findIndex((l, i) => i >= at && (want instanceof RegExp ? want.test(l) : l === want));
    if (hit < 0) { problems.push('missing (or out of order): ' + want); break; }
    at = hit + 1;
  }
  const errLines = lines.filter(l => /^✗/.test(l));
  if (!t.errorsOk && errLines.length) problems.push('unexpected error line: ' + errLines[0]);
  if (/not reached/.test(output)) problems.push('a line marked "not reached" was printed');
  if (t.warnings && info.warnings) problems.push(...sameList(info.warnings, t.warnings, 'warning'));
  if (t.check && info.status === 'Done') problems.push(...t.check(info));
  return { ok: problems.length === 0, problems, output };
}

async function runDiag(page, t) {
  const r = await compileOnly(page, join(t.files));
  const got = r.thrown !== null ? [r.thrown] : r.errors;
  const problems = sameList(got, t.errors, 'error');
  if (t.thrown === true && r.thrown === null && t.errors.length) problems.push('expected a thrown Error, got the errors array');
  if (t.thrown === false && r.thrown !== null) problems.push('expected the errors array, but compile() threw');
  if (t.warnings) problems.push(...sameList(r.warnings, t.warnings, 'warning'));
  if (t.check && r.thrown === null) problems.push(...t.check(r));
  return { ok: problems.length === 0, problems, output: got.join('\n') };
}

// ───────────────────────────── property / structural tests ─────────────────────────────
const SPECIAL = [
  { name: 'split-join-round-trip', run: async page => page.evaluate(MARK => {
    const p = [];
    let seed = 12345;
    const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const bits = ['fn a() { }', '', '  ', 'let x = 1', '// file: no', '/// file: a.emit', ' //// file: indented.emit', '////file: x.emit', 'x //// file: y.emit', '\t', '"//// file: s.emit"', 'é ✓ 日本', '}', '\r'];
    const names = ['main.emit', 'a.emit', 'game/physics.emit', 'x/y/z.emit', 'main.emit', 'UPPER_1.emit', 'a-b/c.d.emit'];
    for (let n = 0; n < 400; n++) {
      const files = [];
      for (let i = 0, k = 1 + rnd(5); i < k; i++) {
        const lines = [];
        for (let j = 0, m = rnd(6); j < m; j++) lines.push(bits[rnd(bits.length)]);
        files.push({ path: names[rnd(names.length)], source: lines.join('\n') });
      }
      const text = _emitJoinBundle(files), back = _emitSplitBundle(text);
      const want = files.map((f, i) => (i === 0 && f.path === 'main.emit' ? '' : MARK + f.path + '\n') + f.source).join('\n');
      if (text !== want) { p.push('join differs from the contract for ' + JSON.stringify(files)); break; }
      if (JSON.stringify(back) !== JSON.stringify(files)) { p.push('round trip failed for ' + JSON.stringify(files) + '\n        got ' + JSON.stringify(back)); break; }
      if (_emitJoinBundle(back) !== text) { p.push('join(split(text)) !== text'); break; }
    }
    const eq = (text, want) => { const got = JSON.stringify(_emitSplitBundle(text)); if (got !== JSON.stringify(want)) p.push('split(' + JSON.stringify(text) + ') = ' + got); };
    eq('', [{ path: 'main.emit', source: '' }]);
    eq('fn a() { }\n', [{ path: 'main.emit', source: 'fn a() { }\n' }]);
    eq('x\n//// file: b.emit\ny', [{ path: 'main.emit', source: 'x' }, { path: 'b.emit', source: 'y' }]);
    eq('//// file: app.emit\nx\n//// file: b.emit', [{ path: 'app.emit', source: 'x' }, { path: 'b.emit', source: '' }]);
    eq('\n//// file: b.emit\n', [{ path: 'main.emit', source: '' }, { path: 'b.emit', source: '' }]);
    return p;
  }, MARK) },

  { name: 'module-index-good-project', run: async page => {
    const idx = await page.evaluate(text => _emitModuleIndex(text), join([
      F('main.emit', 'import game.physics\nimport game.physics as p\nimport game.physics.step\nimport game.physics.step as advance\nimport game.physics.*\nimport fn hostLog(x: int) from "env"\nexport fn run() { }\nfn helper() { }\npublic mut score: num = 0\n'), PHYSICS]));
    const want = {
      entry: 'main',
      modules: {
        main: { path: 'main.emit',
          publics: [{ name: 'run', kind: 'fn', params: [], returnType: 'void', mutable: false }, { name: 'score', kind: 'var', params: [], returnType: 'num', mutable: true }],
          imports: [{ module: 'game.physics', alias: 'physics', names: null, star: false }, { module: 'game.physics', alias: 'p', names: null, star: false },
            { module: 'game.physics', alias: null, names: ['step'], star: false }, { module: 'game.physics', alias: 'advance', names: ['step'], star: false },
            { module: 'game.physics', alias: null, names: null, star: true }] },
        'game.physics': { path: 'game/physics.emit',
          publics: [{ name: 'gravity', kind: 'var', params: [], returnType: 'num', mutable: false }, { name: 'ticks', kind: 'var', params: [], returnType: 'int', mutable: true },
            { name: 'step', kind: 'fn', params: [{ name: 'dt', type: 'num' }], returnType: 'num', mutable: false }, { name: 'count', kind: 'fn', params: [], returnType: 'int', mutable: false }],
          imports: [] },
      },
    };
    return JSON.stringify(idx) === JSON.stringify(want) ? [] : ['index differs:\n        got  ' + JSON.stringify(idx) + '\n        want ' + JSON.stringify(want)];
  } },

  { name: 'module-index-broken-project', run: async page => {
    const p = [];
    const idx = await page.evaluate(text => _emitModuleIndex(text), join([
      F('main.emit', 'import game.physics\nexport fn run() {\n  physics.\n'),
      F('game/physics.emit', 'package game\nimport util.vec as v\nimport util.vec.len\npublic let gravity = 9.5\npublic mut name = "x"\npublic fn step(dt: num, n: int) num {\n  let x = \n}\npublic fn area(w: num) -> num {\nfn hidden() { }\nexport fn spin() { }\n'),
      F('util/vec.emit', 'public fn len(x: num, y: num) num { return x + y }\nlet a = 1 # 2\n'),
      F('bad path.emit', 'public fn nope() { }'), F('ok.emit', 'public fn fine() int { return 1 }\n')]));
    const m = idx.modules || {};
    const sig = n => (m[n] ? m[n].publics.map(x => x.name + ':' + x.kind + ':' + x.returnType + '(' + x.params.map(q => q.name + ':' + q.type).join(',') + ')' + (x.mutable ? ':mut' : '')).join(' ') : '(missing)');
    if (idx.entry !== 'main') p.push('entry: ' + idx.entry);
    if (Object.keys(m).join(',') !== 'main,game.physics,util.vec,ok') p.push('modules: ' + Object.keys(m).join(','));
    if (sig('main') !== 'run:fn:void()') p.push('main publics: ' + sig('main'));
    if (sig('game.physics') !== 'gravity:var:num() name:var:str():mut step:fn:num(dt:num,n:int) area:fn:num(w:num) spin:fn:void()') p.push('game.physics publics: ' + sig('game.physics'));
    if (JSON.stringify(m['game.physics'] && m['game.physics'].imports) !== JSON.stringify([{ module: 'util.vec', alias: 'v', names: null, star: false }, { module: 'util.vec', alias: null, names: ['len'], star: false }])) p.push('game.physics imports: ' + JSON.stringify(m['game.physics'] && m['game.physics'].imports));
    if (sig('util.vec') !== 'len:fn:num(x:num,y:num)') p.push('util.vec publics: ' + sig('util.vec'));
    if (sig('ok') !== 'fine:fn:int()') p.push('ok publics: ' + sig('ok'));
    const errs = idx.errors || [];
    const wantErr = [/^main\.emit:4:1: /, /^game\/physics\.emit:8:1: /, /^util\/vec\.emit:2:11: Unexpected '#'$/, /^bad path\.emit:1:1: Invalid file path/];
    wantErr.forEach(w => { if (!errs.some(e => w.test(e))) p.push('missing index error ' + w + ' in ' + JSON.stringify(errs)); });
    if (errs.length !== wantErr.length) p.push('index errors: ' + JSON.stringify(errs));
    return p;
  } },

  { name: 'module-index-never-throws', run: async page => page.evaluate(text => {
    const p = [];
    let seed = 99;
    const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const junk = ['{', '}', '(', '"', "'", '#', '\n', '//// file: ', '//// file: x.emit\n', 'import ', 'public ', 'package ', '.', '*', ' as ', '\u0000', '/*'];
    const inputs = [undefined, null, 0, '', '\n', '//// file: ', '//// file: \n', '//// file: a.emit', 'import', 'public', 'package', 'import a.', 'import a.* as', 'public fn', 'public let', '//// file: a.emit\n//// file: a.emit\n'];
    for (let i = 0; i < 300; i++) {
      let s = text.slice(0, rnd(text.length + 1));
      for (let k = 0, n = rnd(4); k < n; k++) { const at = rnd(s.length + 1); s = s.slice(0, at) + junk[rnd(junk.length)] + s.slice(at); }
      inputs.push(s);
    }
    for (const s of inputs) {
      try {
        const idx = _emitModuleIndex(s);
        if (!idx || typeof idx.entry !== 'string' || typeof idx.modules !== 'object') { p.push('bad shape for ' + JSON.stringify(s)); break; }
        for (const k in idx.modules) { const m = idx.modules[k]; if (typeof m.path !== 'string' || !Array.isArray(m.publics) || !Array.isArray(m.imports)) { p.push('bad module shape for ' + JSON.stringify(s)); break; } }
        if (idx.errors && !idx.errors.every(e => typeof e === 'string')) { p.push('errors must be strings'); break; }
      } catch (e) { p.push('_emitModuleIndex threw ' + e.message + ' for ' + JSON.stringify(s)); break; }
      try { _emitSplitBundle(s); } catch (e) { p.push('_emitSplitBundle threw for ' + JSON.stringify(s)); break; }
    }
    return p;
  }, join(RUN[0].files.concat(RUN[4].files.slice(1)))) },

  { name: 'compile-result-lists-files-and-modules', run: async page => {
    const r = await compileOnly(page, join(RUN[0].files));
    const p = [];
    if (r.thrown) return ['threw ' + r.thrown];
    if (r.files.join(',') !== 'main.emit,game/physics.emit') p.push('files: ' + r.files);
    const idx = await page.evaluate(text => _emitModuleIndex(text), join(RUN[0].files));
    if (JSON.stringify(r.modules) !== JSON.stringify(idx.modules)) p.push('compile().modules differs from _emitModuleIndex().modules:\n        ' + JSON.stringify(r.modules) + '\n        ' + JSON.stringify(idx.modules));
    return p;
  } },

  // A function with a statement-level await that no Emit function calls stores its locals before waiting
  // (the "parked scopes" spill: i32.const 53248 …). A call from another module counts as a call.
  { name: 'await-spill-sees-cross-module-calls', run: async page => page.evaluate(([called, notCalled]) => {
    const p = [];
    const has = (text, name) => {
      const f = compile(text, 'wasm32').functions.find(x => x.name === name);
      if (!f) { p.push('no function ' + name); return null; }
      const c = f.code;
      for (let i = 0; i + 3 < c.length; i++) if (c[i] === 0x41 && c[i + 1] === 0x80 && c[i + 2] === 0xA0 && c[i + 3] === 0x03) return true;
      return false;
    };
    if (has(called, 'w.work') !== false) p.push('w.work is called from main: it must not spill its locals');
    if (has(called, 'run') !== true) p.push('run is a root: it must spill its locals');
    if (has(notCalled, 'w.work') !== true) p.push('w.work is exported and not called: it must spill its locals');
    return p;
  }, [join([F('main.emit', 'import w\nexport fn run() {\n  let a = emptyObj()\n  await w.work()\n  printStr(typeOf(a))\n}\n'), F('w.emit', 'public fn work() int {\n  let o = emptyObj()\n  await sleep(1)\n  printStr(typeOf(o))\n  return 1\n}\n')]),
    join([F('main.emit', 'import w\nexport fn run() {\n  print(w.one())\n}\n'), F('w.emit', 'public fn one() int { return 1 }\nexport fn work() {\n  let o = emptyObj()\n  await sleep(1)\n  printStr(typeOf(o))\n}\n')])]) },
];

// ───────────────────────────── main ─────────────────────────────
(async () => {
  const args = process.argv.slice(2).filter(a => a !== '--editor');
  const file = path.resolve(args[0] && /\.html$/.test(args[0]) ? args.shift() : path.join(__dirname, '..', 'emit-ide-1_32.html'));
  const fileUrl = 'file://' + file;
  const want = n => !args.length || args.includes(n);
  const browser = await chromium.launch();
  let failed = 0, total = 0;
  const report = (name, r) => {
    total++;
    if (r.ok) console.log('PASS  ' + name);
    else { failed++; console.log('FAIL  ' + name + '\n      ' + r.problems.join('\n      ')); }
    if (r.output && (process.env.VERBOSE || (!r.ok && process.env.VERBOSE !== '0'))) console.log(r.output.split('\n').filter(l => l.trim()).map(l => '      | ' + l).join('\n'));
  };

  console.log('mode: ' + (EDITOR ? 'EDITOR (#editor + compileAndRun)' : 'DIRECT (compile(text) + the run path of the Run button)'));
  for (const t of RUN) if (want(t.name)) report(t.name, await runProject(browser, fileUrl, t));

  // generated 12-file project, then the same project with the non-entry files in other orders
  const big = bigProject(), bigWant = bigExpected();
  if (want('twelve-files')) {
    const t0 = Date.now();
    const r = await runProject(browser, fileUrl, { files: big, expect: bigWant, warnings: [] });
    if (Date.now() - t0 > 20000) { r.ok = false; r.problems.push('took ' + (Date.now() - t0) + 'ms'); }
    report('twelve-files', r);
  }
  if (want('file-order-does-not-matter')) {
    const orders = [big.slice(1).reverse(), big.slice(1).sort((a, b) => (a.path.length - b.path.length) || (a.path < b.path ? 1 : -1)), big.slice(4).concat(big.slice(1, 4))];
    const problems = [];
    for (const rest of orders) {
      const r = await runProject(browser, fileUrl, { files: [big[0]].concat(rest), expect: bigWant, warnings: [] });
      problems.push(...r.problems);
    }
    // a different entry file: the same modules, but mods/m0.emit first → nothing is exported as "run"
    const p2 = [];
    const page = await newPage(browser, fileUrl, p2);
    const r2 = await page.evaluate(text => { const r = compile(text, 'wasm32'); return { errors: r.errors, fns: r.functions.filter(f => f.exported).map(f => f.name), files: r.files }; }, join(big.slice(1).concat([big[0]])));
    await page.close();
    if (r2.errors.length || r2.fns.join(',') !== 'main.run' || r2.files[0] !== 'mods/m0.emit') problems.push('with mods/m0.emit first, run must be exported as main.run: ' + JSON.stringify(r2));
    report('file-order-does-not-matter', { ok: !problems.length && !p2.length, problems: problems.concat(p2) });
  }

  const pageProblems = [];
  const page = await newPage(browser, fileUrl, pageProblems);
  for (const t of DIAG) if (want(t.name)) report(t.name, await runDiag(page, t));
  for (const t of SPECIAL) if (want(t.name)) { const problems = await t.run(page).catch(e => ['failed: ' + e.message.slice(0, 400)]); report(t.name, { ok: !problems.length, problems }); }

  // Byte identity: every bundled example compiles to the same bytes (and the same import list, async
  // function list and errors) as with the compiler before the module system.
  if (want('examples-byte-identical')) {
    const problems = [];
    let n = 0, how = '';
    const snap = () => {
      const out = {};
      for (const k of Object.keys(EX)) {
        try {
          const r = compile(EX[k], 'wasm32');
          out[k] = { wasm: Array.from(r.wasm).join(','), errors: r.errors.join('|'), imports: r.imports.map(i => i.module + '.' + i.name).join(','), asyncFns: r.imports.asyncFns || '', tryFns: r.imports.tryFns || '', cb: r.imports.cbCount || 0 };
        } catch (e) { out[k] = { thrown: e.message }; }
      }
      return out;
    };
    const now = await page.evaluate(snap);
    const sources = await page.evaluate(() => EX);
    let before = null;
    try {
      const html = execFileSync('git', ['show', BASE_COMMIT + ':emit-ide-1_32.html'], { cwd: path.join(__dirname, '..'), maxBuffer: 64 * 1024 * 1024 });
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emit-modules-'));
      fs.writeFileSync(path.join(dir, 'before.html'), html);
      const old = await browser.newPage();
      await old.route(/^https?:/, r => r.abort());
      await old.goto('file://' + path.join(dir, 'before.html'));
      await old.waitForFunction(() => typeof compile === 'function');
      // the examples of TODAY's page, compiled by the old compiler
      before = await old.evaluate(([fn, EXnow]) => { window.EX = EXnow; return (0, eval)('(' + fn + ')')(); }, [snap.toString(), sources]);
      await old.close();
      fs.rmSync(dir, { recursive: true, force: true });
      how = 'against commit ' + BASE_COMMIT;
    } catch (e) {
      problems.push('could not load the compiler of commit ' + BASE_COMMIT + ' (git show): ' + String(e.message).slice(0, 200));
    }
    if (before) {
      for (const k of Object.keys(now)) {
        n++;
        // a multi-file example (added later by the IDE) has no "before": the old compiler cannot read it
        if (sources[k].split('\n').some(l => l.indexOf(MARK) === 0) || /^\s*(import\s+(?!fn\b)|public\s|package\s)/m.test(sources[k])) { n--; continue; }
        // an example the old page does not have (EX there is a const, so it keeps its own list): e.g. 'game', which
        // uses thing / rules blocks the old compiler cannot read — run-rules.js checks byte identity for the rest
        if (!before[k]) { n--; continue; }
        if (JSON.stringify(now[k]) !== JSON.stringify(before[k])) problems.push('example "' + k + '" compiles differently than before the module system' + (now[k].thrown || before[k].thrown ? ': ' + JSON.stringify([before[k].thrown, now[k].thrown]) : ''));
        else if (now[k].thrown) problems.push('example "' + k + '" does not compile: ' + now[k].thrown);
      }
      if (n < 20) problems.push('expected at least 20 single-file examples, compared ' + n);
    }
    report('examples-byte-identical (' + n + ' examples ' + how + ')', { ok: !problems.length, problems });
  }
  await page.close();
  if (pageProblems.length) { failed++; console.log('FAIL  page errors: ' + pageProblems.join('; ')); }

  await browser.close();
  console.log('\n' + (total - failed) + '/' + total + ' module tests passed');
  process.exit(failed || !total ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

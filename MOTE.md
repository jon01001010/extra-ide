# Mote

A tiny, embeddable, Lua-like scripting language for JavaScript hosts. One dependency-free file,
`mote.js` (~2,550 lines; 113 KB raw, 66 KB minified, ~22 KB minified+gzip). It is meant for
player-made levels, mods and dialogue scripts that a game loads at run time, and it runs anywhere
JavaScript runs (no WebAssembly, no `eval`).

```html
<script src="mote.js"></script>          <!-- defines window.Mote -->
```
```js
const Mote = require('./mote.js');       // Node
const vm = Mote.create({ print: s => console.log(s) });
vm.run('print("hello from Mote")');
```

* Playground: `mote.html` (one file, offline, phone-friendly). It inlines `mote.js`; after editing
  `mote.js` rebuild it with `node tools/build-mote-html.js` (`--check` verifies it is current).
* Tests: `node tests/run-mote.js` (language + API, Node only) and
  `NODE_PATH=… node tests/run-mote-page.js` (playground, Playwright). Benchmarks: `node tests/bench-mote.js`.

---

## 1. Language reference

Mote uses Lua 5.4 syntax and semantics for everything it supports. When in doubt, it behaves like Lua 5.4.

### Values

| type | notes |
|---|---|
| `nil`, `boolean` | only `nil` and `false` are false |
| `number` | **one** number type (a JS double). See *Numbers* below |
| `string` | immutable JS strings (UTF-16 code units; `#s` counts code units, `string.byte` returns code units) |
| `table` | arrays and maps in one; 1-based array part; any key except `nil`/NaN |
| `function` | Mote closures and host (JS) functions |
| `thread` | coroutines |
| `userdata` | JS objects exposed by reference with `vm.ref` |

### Numbers

* Integral values print without a fraction: `print(10/2)` → `5` (Lua 5.4 prints `5.0`), `print(3)` → `3`,
  `print(3.5)` → `3.5`. Other numbers print like Lua's `%.14g`: `1e100` → `1e+100`, `0.1+0.2` → `0.3`,
  `2^63` → `9.2233720368548e+18`. Integral values up to 1e16 print in full (`1e15` → `1000000000000000`,
  Lua 5.4: `1e+15`). `-0` prints `0`; `0/0` prints `nan`; `1/0` prints `inf`.
* `//` is `floor(a / b)`, `%` is `a - floor(a / b) * b` (Lua's float semantics: `-7 % 3` = `2`,
  `5 % -math.huge` = `-inf`); `x // 0` → `±inf`, `x % 0` → `nan` (no integer-division error).
* Strings convert to numbers in arithmetic (`"10" + 1` → `11`, hex and exponents allowed) and numbers to
  strings in `..`.
* `math.type(x)` reports `"integer"` for integral values, `"float"` otherwise.
  `math.maxinteger` is 2^53 − 1. No integer overflow wrap-around.

### Syntax

```lua
local a, b = 1, 2                 -- locals, multiple assignment
local k <const> = 10              -- <const> is checked at compile time; <close> is not supported
x, y = y, x                       -- globals; all right-hand values are evaluated first
local t = {1, 2, x = 3, ["k"] = 4, [10] = 5}
t.k, t[1], #t                     -- field, index, length (border, like Lua)

if a < b then … elseif … else … end
while cond do … end
repeat … until cond               -- the condition sees the body's locals
for i = 10, 1, -2 do … end        -- numeric for; the loop variable is a fresh local per iteration
for k, v in pairs(t) do … end     -- generic for (Lua iterator protocol: f, s, control)
for i, v in ipairs(t) do … end
do … end
break                             -- goto and ::labels:: are NOT supported (compile error)

function f(a, b, ...) return a, b, select('#', ...) end
local function g() … end
function obj.field.method(self) … end
function obj:method(x) return self.x + x end     -- implicit self
obj:method(1)                     -- method call
f{1, 2}  f"str"                   -- call with a table / string literal
```

Expressions: `+ - * / // % ^`, unary `-`, `not`, `#`, `..`, `== ~= < <= > >=`, `and`/`or`
(short-circuit, return an operand), varargs `...`. Precedence is Lua's (low → high):
`or` · `and` · comparisons · `..` (right) · `+ -` · `* / // %` · unary · `^` (right).
Multiple results are adjusted exactly like Lua: only the last expression in a list expands, `(f())`
truncates to one value. Proper tail calls (`return f(x)`) do not grow the stack.
Comments `--` and `--[[ … ]]`, long strings `[[…]]`/`[==[…]==]`, escapes `\n \t \\ \" \ddd \xhh \z \u{…}`.
Bitwise operators (`& | ~ << >>`) are not supported.

### Metatables

`setmetatable` / `getmetatable` with: `__index` (table or function), `__newindex` (table or function),
`__call`, `__tostring`, `__name`, `__eq` (tables only, like Lua), `__lt`, `__le`, `__add`, `__sub`,
`__mul`, `__div`, `__mod`, `__idiv`, `__pow`, `__unm`, `__concat`, `__len`, `__pairs`, `__metatable`.
Not supported: `__gc`, `__mode` (weak tables), `__close`, bitwise metamethods.
Strings have a metatable whose `__index` is the `string` table, so `("x"):upper()` works.

```lua
local Animal = {}  Animal.__index = Animal
function Animal.new(name) return setmetatable({name = name}, Animal) end
function Animal:speak() return self.name .. " makes a sound" end
local Dog = setmetatable({}, {__index = Animal})  Dog.__index = Dog
function Dog:speak() return self.name .. " barks" end
print(setmetatable(Animal.new("Rex"), Dog):speak())   --> Rex barks
```

### Errors

`error(v [, level])`, `pcall(f, ...)`, `xpcall(f, handler, ...)`, `assert(v [, msg])`.
String errors get a `chunk:line:` prefix (level 1 = where `error` was called, 2 = its caller, 0 = none).
Runtime errors read like Lua's: `main:3: attempt to index a nil value (local 't')`,
`attempt to call a nil value (global 'foo')`, `attempt to perform arithmetic on a table value`,
`attempt to compare number with nil`, `bad argument #1 to 'insert' (table expected, got nil)`.
Compile errors carry line **and column**: `main:2:11: unexpected symbol near '='`.
Deep recursion gives a clean `stack overflow` error (default limit 20,000 Mote frames), never a JS `RangeError`.

### Coroutines

`coroutine.create / resume / yield / status / wrap / isyieldable / running / close`. The VM keeps an
explicit call stack per coroutine, so a coroutine can yield from any depth of Mote calls, through
`pcall`/`xpcall`, from inside metamethods (`__index`, `__add`, …) and from host functions that ask to
yield (`vm.yield`, below). Like Lua's C boundary, a yield cannot cross a *host function that calls back
into Mote* (the comparator of `table.sort`, a `string.gsub` replacement function, `__tostring` called by
`tostring`/`print`, `__pairs`, `__index` reached from `ipairs`): that raises
`attempt to yield across a host call boundary`.

```lua
local function range(n) return coroutine.wrap(function() for i = 1, n do coroutine.yield(i) end end) end
for i in range(3) do print(i) end
```

### Standard library

Each library can be left out (`stdlib` option). Everything is per VM.

* **base**: `print` (to the host), `type`, `tostring`, `tonumber(s [, base])`, `pairs`, `ipairs`, `next`,
  `select`, `rawget`, `rawset`, `rawequal`, `rawlen`, `assert`, `error`, `pcall`, `xpcall`, `unpack`,
  `setmetatable`, `getmetatable`, `load(string [, chunkname])` (strings only; no `env`/`mode`), `_G`, `_VERSION`.
* **string**: `len sub upper lower rep reverse byte char format find match gmatch gsub`.
  `format` supports `%d %i %c %x %X %o %e %E %f %F %g %G %s %q %%` (not `%a`, `%u`) with flags
  `- + space 0 #`, width and precision (up to 2 digits each). Patterns are Lua patterns: `.`, classes
  `%a %c %d %g %l %p %s %u %w %x` (and upper-case complements, ASCII only), sets `[...]`/`[^...]`
  with ranges, quantifiers `* + - ?`, anchors `^ $`, captures incl. position captures `()`,
  back-references `%1`, **`%b()` and `%f[set]` are supported**. `gsub` takes a string, table or function.
* **table**: `insert remove concat sort unpack pack`. They use raw access (no metamethods).
  `sort` is a stable merge sort (Lua's is not stable); an inconsistent comparator gives some order, no error.
* **math**: `floor ceil abs min max sqrt sin cos tan asin acos atan(y [, x]) exp log(x [, base]) fmod modf
  tointeger type random randomseed pi huge maxinteger mininteger`. `random` is xoshiro128\*\*, seeded per VM
  (`seed` option, default 0) — deterministic, good for replays. `random(m, n)` with `m > n` is an error
  (also `random(0)`, which Lua 5.4 allows).
* **coroutine**: see above.
* **os** (only if the host lists it): `time()`, `clock()`.

Not present: `io`, `debug`, `require`, `dofile`, `loadstring`, `string.pack`, `utf8`, `collectgarbage`.

### Differences from Lua 5.4 in one list

* One number type: integral results print without `.0`; no integer overflow, no integer-division error.
* Strings are JS strings (UTF-16), not byte strings.
* No `goto`/labels, bitwise operators, `<close>`, `_ENV`, weak tables, `__gc`, `load` with env/mode/reader.
* `pairs` order: array part, then keys in insertion order (Lua: unspecified).
* `table.sort` is stable; `table.*` ignore metamethods.
* `error` objects that are tables reach the host as `Mote.Error` with `value` set to the converted table.
* A function that `error`s with level 1 when called directly from `pcall` gets no position (as in Lua).

---

## 2. Embedding guide

### Creating a VM

```js
const vm = Mote.create({
  print: s => log(s),            // where print() goes (default console.log)
  stdlib: ['base', 'string', 'table', 'math', 'coroutine'],   // default; add 'os' for os.time/os.clock
  maxSteps: 1e6,                 // VM instructions per host entry (default 1e7; Infinity = no limit)
  maxMemory: 16e6,               // allocation estimate per host entry (default 16e6)
  maxDepth: 20000,               // Mote call depth (default 20000)
  seed: 1,                       // math.random seed (default 0)
});
```

VMs are fully independent: separate globals, string metatable, random generator, limits.
Do not pass values from one VM into another.

### API

| call | does |
|---|---|
| `vm.set(name, value)` | set a global; the JS value is converted (below) |
| `vm.get(name [, {proxy:true}])` | read a global, converted to JS |
| `vm.run(source [, chunkName])` | compile and run; returns an **array** of the chunk's results (JS values); throws `Mote.Error` |
| `vm.compile(source [, chunkName])` | compile only; returns a JS function that runs the chunk (returns its first result) |
| `vm.call(fn, ...args)` | call a Mote function (a global name or a function value) — returns an array of all results |
| `vm.thread(fn, ...args)` | a coroutine driven from JS: `th.resume(...vals)` → `{done, values}`; `th.status` |
| `vm.yield(...values)` | **return** this from a host function to suspend the running coroutine |
| `vm.multi(...values)` | return this from a host function to return several values |
| `vm.ref(obj [, {allow, readonly, deep}])` | expose a JS object by reference (Mote type `userdata`) |
| `vm.fn(jsFn, {name, args: 'copy'｜'proxy'｜'raw'})` | wrap a JS function with explicit argument conversion |
| `vm.toJS(v [, {proxy:true}])`, `vm.toMote(v)` | the conversions, for raw host functions |
| `vm.reset()` | fresh globals and stdlib (host-set globals are dropped) |
| `vm.stats()` | `{steps, totalSteps, memory, maxSteps, maxMemory, running}` (`steps`/`memory`: last entry) |
| `vm.maxSteps`, `vm.maxMemory`, `vm.maxDepth` | the limits; may be changed between calls |

The chunk name defaults to `"main"` and appears in messages: `main:3: …`.

### Conversions (explicit and by copy unless you ask otherwise)

JS → Mote (`vm.set`, arguments of `vm.call`/`resume`, host function results):

| JS | Mote |
|---|---|
| `undefined`, `null` | `nil` |
| boolean, number, string | same (bigint → number) |
| array | new table, 1-based (`[a, b]` → `{a, b}`) — a **copy** |
| plain object (`{}`/`Object.create(null)`) | new table with the same keys (canonical integer strings become number keys) — a **copy** |
| function | host function; a function that came out of this VM goes back as the original Mote function |
| `vm.ref(obj)` | `userdata` by reference |
| Thread handle | the coroutine |
| anything else (class instances, Map, Date, DOM nodes…) | `TypeError: cannot convert … (use vm.ref(obj))` |

Cycles and shared sub-objects are preserved.

Mote → JS (`vm.get`, results, host function arguments):

| Mote | JS |
|---|---|
| `nil` | `undefined` |
| non-empty sequence table (only keys 1..n) | array copy |
| other table (incl. `{}`) | plain object copy; number keys become strings; keys that are not strings/numbers are skipped; `__proto__` is stored as an own property (no prototype pollution) |
| table with `{proxy: true}` | live `Proxy`: reads/writes go to the table (raw, no metamethods); `length` reports `#t` |
| Mote function | JS function `(...args) => firstResult`; use `vm.call(f, ...)` for all results |
| coroutine | Thread handle (`resume`, `status`) |
| `userdata` from `vm.ref` | the original object |

Host functions receive **copies** by default. Use `vm.fn(f, {args: 'proxy'})` to get live table proxies,
or `{args: 'raw'}` to get internal Mote values (convert with `vm.toJS`).

### Host functions that yield (game `wait`, dialogue choices)

```js
vm.set('wait', seconds => vm.yield('wait', seconds));      // suspends the calling coroutine
vm.set('choose', (...opts) => vm.yield('choose', ...opts));

const th = vm.thread(vm.compile(levelScript, 'level1.lua'));
function frame() {                                         // e.g. per animation frame or on a timer
  const r = th.resume();                                   // first resume starts the script
  if (r.done) return;                                      // r.values: the script's return values
  const [kind, arg] = r.values;                            // what the script yielded
  if (kind === 'wait') setTimeout(frame, arg * 1000);
}
frame();
```

The values passed to the next `th.resume(...)` become the results of the `wait(...)`/`choose(...)` call
in the script. Yields work from any depth of Mote calls, through `pcall`, and inside metamethods.
`vm.yield` outside a coroutine (in `vm.run`) raises `attempt to yield from outside a coroutine`.
Mote coroutines can also be created in a script and returned to JS: they arrive as Thread handles.
A thread that errors throws `Mote.Error` from `resume` and becomes `dead`. To cancel a suspended thread,
just stop resuming it.

Host functions can call back into Mote (`vm.call`, a Mote function passed as a JS callback, even
`vm.run`); such nested calls run synchronously and cannot yield across.

### Exposing host objects: `vm.ref`

```js
const player = { name: 'Ada', hp: 10, heal(n) { this.hp += n; return this.hp; } };
vm.set('player', vm.ref(player, { allow: ['name', 'hp', 'heal'] }));
vm.run('player.hp = player.hp - 3  print(player:heal(5))');   // player.hp is now 12 in JS
```

* Reads and writes go to the real object; values are converted per access.
* Methods: `player:heal(5)` and `player.heal(5)` both call with `this = player`. Method functions are
  opaque to scripts (indexing them is an error).
* Arrays: `ref[1]` is `arr[0]`, `#ref` is `arr.length`, `pairs(ref)` iterates indices/allowed keys.
* `allow`: only these keys are readable/writable. `readonly: true`: writes raise an error.
* Nested objects are **copied** unless `deep: true` (then nested objects are refs too — only use it on
  objects whose whole reachable graph is safe to expose).
* Refs from `vm.ref(obj)` without options are cached, so the same object is the same userdata (`==`).

### Sandbox

A script can only reach what the host passed in. Specifically:

* No host globals exist: no `window`, `globalThis`, `document`, `Function`, `eval`, `require`, `process`,
  `io`, `debug`. Strings index only the per-VM `string` table; tables are backed by `Map`s (so `__proto__`
  and `constructor` are ordinary, absent keys); host functions and closures cannot be indexed.
* Refs never expose `__proto__`, `constructor`, `prototype`, `__defineGetter__`, `__defineSetter__`,
  `__lookupGetter__`, `__lookupSetter__`, `caller`, `callee`, `arguments`, nor anything inherited from
  `Object.prototype` or `Function.prototype` (`toString`, `hasOwnProperty`, `valueOf`, …); those keys cannot
  be set either. With `allow`, only the listed keys exist.
* Converting tables to JS never sets prototypes (`{__proto__ = …}` becomes an own property).
* Class instances returned by host functions are not converted implicitly (error) — the host must `vm.ref` them.
* A script can modify its own VM's `string` table/metatable; other VMs are unaffected.

The tests (`tests/run-mote.js`, "sandbox" checks) try these escapes: `("").constructor`,
`getmetatable("").__index.constructor`, `({}).__proto__`, `print.constructor`, `(1).constructor`,
`ref.constructor`, `ref.__proto__`, `ref.toString`, `ref.method.constructor`, assigning `ref.__proto__`,
prototype pollution through returned tables, and cross-VM leakage.

Not a sandbox against: the host exposing something dangerous (a `deep` ref to a DOM node, a host
function that evaluates code), or a host function that runs a long JS loop (only Mote instructions are counted).

### Limits

* **`maxSteps`** — VM instructions per host entry (`run`, `call`, `thread.resume`, a call through a
  converted function). The budget refills at every entry (nested entries from host functions share the
  outer budget). Pattern matching and `table.sort` also consume steps. When exhausted, the current entry
  ends with a `Mote.Error` of `kind: 'limit'` (`main:3: step budget exhausted (1000000 steps)`).
  **`pcall` cannot catch it**; a coroutine (or thread) that hits it becomes dead. The VM stays usable.
* **`maxMemory`** — an *allocation estimate* per host entry, not a measurement of live memory: a table
  costs 40, each new table slot 16, a closure 32, a string from `..` costs 16 + the length of the shorter
  operand (V8 builds ropes, so this tracks real growth of `s = s .. x` loops), results of
  `rep/format/gsub/concat` cost their length. Garbage is never credited back, and memory kept in globals
  across entries is not counted against later entries. It reliably stops runaway allocation
  (`while true do t = {t} end`, `s = s .. s`, `string.rep("x", 1e9)`) with a `kind: 'limit'` error.
* **`maxDepth`** — Mote call depth (default 20,000), a catchable `stack overflow` error. Nested host→Mote
  calls are limited to ~180 levels (they use the JS stack).

### Errors on the host side

`Mote.Error` (extends `Error`): `message` (`chunk:line: text`), `kind` (`'syntax'`, `'runtime'`, `'limit'`),
`chunk`, `line`, `column` (syntax errors), `traceback` (runtime/limit), `value` (the error value converted
to JS, e.g. the table passed to `error{…}`). JS exceptions thrown by host functions become Mote errors
(catchable by `pcall`, message `chunk:line: <exception message>`).

### Implementation notes

`source → lexer → parser (AST) → compiler → VM`. The compiler emits stack bytecode per function
(4 integers per instruction); locals live in frame slots, closures use Lua-style open/closed upvalues
(fresh per loop iteration). The VM loop keeps an explicit frame stack per coroutine; Mote→Mote calls,
returns, `pcall`, coroutine resume/yield and metamethod calls never recurse on the JS stack. Host
functions and protected calls on non-Mote callables run through a small trampoline frame, so every
protected region and coroutine bottom is a VM frame.

Performance (Node 22, this machine): `fib(25)` 58 ms, 1e6-iteration loop 34 ms, insert+sort 1e5 numbers
75 ms, sort with a Mote comparator 147 ms, 1e6 method calls 206 ms. Fengari 0.1.4 on the same programs:
184 / 87 / 654 / 1438 / 857 ms.

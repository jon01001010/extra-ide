#!/usr/bin/env node
// Mote tests (Node, no browser): a table of programs with expected output / errors, written from
// Lua 5.4 semantics, plus the embedding API, sandbox, limits and coroutine/host-yield behaviour.
//
//   node tests/run-mote.js [filter]
'use strict';
const Mote = require('../mote.js');

const filter = process.argv[2] || '';
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`✗ ${name}${detail ? '\n    ' + detail : ''}`); }
}

// ─────────────────────────────── language: programs → printed output ───────────────────────────────
// [name, source, expected] — expected is the printed output (lines joined by \n), or {err: RegExp}
// for a run that must throw a Mote.Error whose message matches.
const P = [];
const t = (name, src, expected) => P.push([name, src, expected]);

// numbers and printing
t('print basics', `print("hello", 1, 2.5, true, nil)`, 'hello\t1\t2.5\ttrue\tnil');
t('number formatting', `print(3, 3.5, 10/2, 1e100, 2^53, 2^63, 0.1 + 0.2, 100/3, 1e15, 1e16, -0.0, 1e-5, 123456789012)`,
  '3\t3.5\t5\t1e+100\t9007199254740992\t9.2233720368548e+18\t0.3\t33.333333333333\t1000000000000000\t1e+16\t0\t1e-05\t123456789012');
t('inf and nan', `print(1/0, -1/0, 0/0 ~= 0/0, math.huge == 1/0)`, 'inf\t-inf\ttrue\ttrue');
t('numeric literals', `print(0x10, 0xff, 1e3, .5, 3., 0x.8p1, 2^-1, 0XA, 1E2)`, '16\t255\t1000\t0.5\t3\t1\t0.5\t10\t100');
t('arithmetic', `print(7 // 2, -7 // 2, 7 % 3, -7 % 3, 7 % -3, 5.5 % 2, 2^10, 7 / 2, 7 // 2.0, -7.5 // 2)`,
  '3\t-4\t1\t2\t-2\t1.5\t1024\t3.5\t3\t-4');
t('mod and idiv edge cases', `print(1 // 0, -1 // 0, 3 % math.huge, -3 % math.huge, 5 % -math.huge, 0/0 == 0/0)`, 'inf\t-inf\t3\tinf\t-inf\tfalse');
t('precedence', `print(2 + 3 * 4 ^ 2 / 2, -2 ^ 2, 2 ^ 3 ^ 2, 1 .. 2 .. 3, not nil == true, 1 < 2 == true, "a" .. "b" == "ab", 2 * 3 % 4, -3 % 5, #"abc" + 1, not 1 and 2)`,
  '26\t-4\t512\t123\ttrue\ttrue\ttrue\t2\t2\t4\tfalse');
t('precedence: comparison vs concat vs arithmetic', `print(1 + 2 .. "", "x" .. 1 + 2, 2 ^ -1, - - 2, not not nil)`, '3\tx3\t0.5\t2\tfalse');
t('and/or return operands', `print(nil or "d", false and 1, 1 and 2, nil and 1, false or nil, 0 or 1, "" or 1, nil or false)`,
  'd\tfalse\t2\tnil\tnil\t0\t\tfalse');
t('short circuit', `local n = 0 local function f() n = n + 1 return true end
local _ = false and f() local _ = true or f() local _ = nil and f() or f() print(n)`, '1');
t('string coercion', `print("10" + 5, "3" * "4", "0x10" + 0, " 5 " + 1, 1 .. 2, "a" .. 1.5, 10 .. "", "2" ^ 2, -"3")`,
  '15\t12\t16\t6\t12\ta1.5\t10\t4\t-3');
t('comparisons', `print("a" < "b", "abc" < "abd", "Z" < "a", "" < "a", 1 == "1", nil == false, {} == {}, 1 == 1.0, 1 <= 1, "b" >= "a")`,
  'true\ttrue\ttrue\ttrue\tfalse\tfalse\tfalse\ttrue\ttrue\ttrue');
t('integer-looking values', `print(5 // 2 * 2 + 5 % 2, 2^31, -2^31, 3 * 1.5, 4.0, math.maxinteger)`, '5\t2147483648\t-2147483648\t4.5\t4\t9007199254740991');

// strings and lexer
t('string escapes', `print("a\\tb\\\\n\\65\\x41\\u{48}", 'q\\'s', "\\"")`, 'a\tb\\nAAH\tq\'s\t"');
t('\\z escape', 'print("x\\z\n       y")', 'xy');
t('long strings', 'local s = [[\nline1\nline2]] print(s) print([==[a]]b]==])', 'line1\nline2\na]]b');
t('comments', '--[[ multi\nline ]] print("after") -- trailing\n--[==[ x ]==] print(1)', 'after\n1');
t('semicolons', 'local a = 1; local b = 2; print(a + b);;', '3');
t('string length and methods', `local s = "hello" print(#s, s:upper(), ("abc"):len(), s:sub(2, 3), ("x"):rep(3):upper())`, '5\tHELLO\t3\tel\tXXX');

// multiple results and varargs
t('multiple results', `local function f() return 1, 2, 3 end
print(f()) print(f(), 10) print((f())) local t = {f(), f()} print(#t)
local a, b, c, d = f() print(a, b, c, d) local x, y = 1 print(x, y) local p, q = 1, 2, 3 print(p, q)`,
  '1\t2\t3\n1\t10\n1\n4\n1\t2\t3\tnil\n1\tnil\n1\t2');
t('select and varargs', `local function f() return 1, 2, 3 end
print(select('#', f())) print(select(2, f())) print(select(-1, f()))
local function g(...) return select('#', ...) end print(g(nil, nil), g())
local function h(...) local a, b = ... return a, b end print(h(5))
local function v(...) return ... end print(v(1, nil, 3))
local function pk(...) return {...}, select('#', ...) end local tt, n = pk(1, 2, 3) print(#tt, n)
print(select('#', ...))`,
  '3\n2\t3\n3\n2\t0\n5\tnil\n1\tnil\t3\n3\t3\n0');
t('varargs in middle are truncated', `local function f() return 1, 2 end print(f(), f()) local t = {f(), f(), x = 1} print(#t)`, '1\t1\t2\n2');
t('table.unpack and unpack', `print(table.unpack({1, 2, 3})) print(unpack({1, 2, 3}, 2)) print(table.unpack({1, 2, 3}, 2, 3)) print(select('#', table.unpack({}, 1, 3)))`,
  '1\t2\t3\n2\t3\n2\t3\n3');
t('assignment evaluation order', `local a = {} local i = 1 i, a[i] = i + 1, 20 print(i, a[1], a[2])
local x, y = 1, 2 x, y = y, x print(x, y)`, '2\t20\tnil\n2\t1');
t('multiple assignment with calls', `local function f() return 1, 2, 3 end local t = {} t.a, t.b, t.c = f() print(t.a, t.b, t.c) t.a, t.b, t.c = 0, f() print(t.a, t.b, t.c)`,
  '1\t2\t3\n0\t1\t2');

// closures
t('counter closures', `local function counter() local c = 0 return function() c = c + 1 return c end end
local a, b = counter(), counter() print(a(), a(), b())`, '1\t2\t1');
t('closures capture loop variables per iteration', `local fs = {}
for i = 1, 3 do fs[i] = function() return i end end print(fs[1](), fs[2](), fs[3]())
local gs = {} for _, v in ipairs({"a", "b"}) do gs[#gs + 1] = function() return v end end print(gs[1](), gs[2]())
local hs = {} local j = 1 while j <= 3 do local k = j hs[j] = function() return k end j = j + 1 end print(hs[1](), hs[3]())`,
  '1\t2\t3\na\tb\n1\t3');
t('shared upvalues', `local function mk() local n = 0 return function() n = n + 1 return n end, function() return n end end
local inc, get = mk() inc() inc() print(get())
local fs = {} for i = 1, 2 do local x = i fs[i] = function() return x end x = x * 10 end print(fs[1](), fs[2]())`,
  '2\n10\t20');
t('repeat-until sees body locals; closures per iteration', `local r = {} local i = 0
repeat local z = i r[#r + 1] = function() return z end i = i + 1 until z >= 2 print(#r, r[1](), r[3]())`, '3\t0\t2');
t('break closes upvalues', `local fs = {}
for i = 1, 10 do local x = i * 2 fs[#fs + 1] = function() return x end if i == 2 then break end end print(#fs, fs[1](), fs[2]())`,
  '2\t2\t4');
t('nested closures 3 levels', `local function a() local x = 1 return function() local y = 2 return function() x = x + 1 return x + y end end end
local f = a()() print(f(), f())`, '4\t5');
t('recursive local function', `local function fact(n) if n <= 1 then return 1 end return n * fact(n - 1) end print(fact(10))`, '3628800');
t('mutual recursion via locals', `local even, odd
function even(n) if n == 0 then return true end return odd(n - 1) end
function odd(n) if n == 0 then return false end return even(n - 1) end print(even(10), odd(7))`, 'true\ttrue');

// control flow
t('numeric for', `local t = {} for i = 10, 1, -3 do t[#t + 1] = i end print(table.concat(t, ","))
t = {} for i = 1, 2, 0.5 do t[#t + 1] = i end print(table.concat(t, ","))
for i = 1, 0 do print("never") end
local n = 0 for i = 1, 3 do i = i * 10 n = n + 1 end print(n)`, '10,7,4,1\n1,1.5,2\n3');
t('while, repeat, break', `local i = 0 while true do i = i + 1 if i > 5 then break end end print(i)
local j = 0 repeat j = j + 2 until j >= 7 print(j)
for a = 1, 3 do for b = 1, 3 do if b == 2 then break end print(a, b) end end`, '6\n8\n1\t1\n2\t1\n3\t1');
t('if/elseif/else', `local function c(n) if n < 0 then return "neg" elseif n == 0 then return "zero" elseif n < 10 then return "small" else return "big" end end
print(c(-1), c(0), c(5), c(50))`, 'neg\tzero\tsmall\tbig');
t('do blocks and shadowing', `local x = 1 do local x = 2 print(x) end print(x) local x = x + 10 print(x)`, '2\n1\n11');
t('for errors', `print(pcall(function() for i = "a", 2 do end end))`, "false\tmain:1: 'for' initial value must be a number");
t('for step zero', `print(pcall(function() for i = 1, 2, 0 do end end))`, "false\tmain:1: 'for' step is zero");

// tables
t('length border', `local t = {} t[1] = "a" t[2] = "b" t[4] = "d" print(#t) t[3] = "c" print(#t) t[4] = nil print(#t)
local u = {[1] = 1, [2] = 2, [3] = 3} print(#u)`, '2\n4\n3\n3');
t('key normalisation and types', `local k = {} k[1.0] = "one" print(k[1]) k["1"] = "str" print(k[1], k["1"])
local tk = {} local key = {} tk[key] = 5 print(tk[key], tk[{}]) k[true] = "yes" print(k[true], k[false])
k[2^53] = "big" print(k[2^53]) k[-1] = "neg" k[0] = "zero" k[1.5] = "half" print(k[-1], k[0], k[1.5])`,
  'one\none\tstr\n5\tnil\nyes\tnil\nbig\nneg\tzero\thalf');
t('table constructors', `local t = {1, 2, x = 3, ["k"] = 4, [10] = 5; 6} print(#t, t[3], t.x, t.k, t[10])
local n = {{1, 2}, {3, 4}} print(n[2][1]) local c = {[1] = "a", "b"} print(c[1])`, '3\t6\t3\t4\t5\n3\nb');
t('nil and NaN keys', `print(pcall(function() local t = {} t[nil] = 1 end)) print(pcall(function() local t = {} t[0/0] = 1 end)) print(({})[nil])`,
  'false\tmain:1: table index is nil\nfalse\tmain:1: table index is NaN\nnil');
t('pairs order: array part, then insertion order', `local t = {10, 20, 30, x = 1, y = 2} t.z = 3
local keys = {} for k, v in pairs(t) do keys[#keys + 1] = tostring(k) .. "=" .. v end print(table.concat(keys, " "))`,
  '1=10 2=20 3=30 x=1 y=2 z=3');
t('next', `print(next({})) print(next({5})) local t = {a = 1} print(next(t, "a")) print(pcall(next, t, "nope"))`,
  "nil\n1\t5\nnil\nfalse\tinvalid key to 'next'");
t('clearing fields during traversal', `local t = {a = 1, b = 2, c = 3, d = 4, 1, 2} for k in pairs(t) do t[k] = nil end print(next(t))`, 'nil');
t('ipairs stops at nil', `local s = 0 for i, v in ipairs({1, 2, nil, 4}) do s = s + v end print(s)`, '3');
t('ipairs respects __index', `local p = setmetatable({}, {__index = function(t, i) if i <= 3 then return i * 10 end end})
local s = {} for i, v in ipairs(p) do s[#s + 1] = v end print(table.concat(s, " "))`, '10 20 30');
t('custom stateless iterator', `local function iter(n, i) if i < n then return i + 1, (i + 1) ^ 2 end end
for i, sq in iter, 4, 0 do print(i, sq) end`, '1\t1\n2\t4\n3\t9\n4\t16');
t('stateful iterator (closure)', `local function chars(s) local i = 0 return function() i = i + 1 if i <= #s then return s:sub(i, i) end end end
local out = {} for c in chars("abc") do out[#out + 1] = c:upper() end print(table.concat(out))`, 'ABC');

// metatables and OOP
t('OOP with __index and inheritance', `local Animal = {} Animal.__index = Animal
function Animal.new(name, sound) local self = setmetatable({}, Animal) self.name = name self.sound = sound return self end
function Animal:speak() return self.name .. " says " .. self.sound end
local Dog = setmetatable({}, {__index = Animal}) Dog.__index = Dog
function Dog.new(name) local d = Animal.new(name, "woof") return setmetatable(d, Dog) end
function Dog:fetch() return self.name .. " fetches" end
local d = Dog.new("Rex") print(d:speak()) print(d:fetch()) print(getmetatable(d) == Dog, d.missing)`,
  'Rex says woof\nRex fetches\ntrue\tnil');
t('arithmetic and comparison metamethods', `local V = {} V.__index = V
local function vec(x, y) return setmetatable({x = x, y = y}, V) end
V.__add = function(a, b) return vec(a.x + b.x, a.y + b.y) end
V.__sub = function(a, b) return vec(a.x - b.x, a.y - b.y) end
V.__mul = function(a, b) if type(b) == "number" then return vec(a.x * b, a.y * b) end return a.x * b.x + a.y * b.y end
V.__eq = function(a, b) return a.x == b.x and a.y == b.y end
V.__tostring = function(v) return "(" .. v.x .. "," .. v.y .. ")" end
V.__lt = function(a, b) return a.x < b.x end
V.__le = function(a, b) return a.x <= b.x end
V.__unm = function(a) return vec(-a.x, -a.y) end
V.__len = function(a) return 2 end
V.__concat = function(a, b) return tostring(a) .. tostring(b) end
V.__call = function(self, k) return self[k] end
V.__div = function(a, b) return "div" end V.__mod = function() return "mod" end V.__idiv = function() return "idiv" end V.__pow = function() return "pow" end
local a, b = vec(1, 2), vec(3, 4)
print(tostring(a + b), tostring(b - a), a * b, tostring(a * 2))
print(a == vec(1, 2), a ~= b, a < b, a <= b, a > b, b >= a, a == a)
print(tostring(-a), #a, a .. b, a .. "!", "!" .. a, a("y"))
print(a / 1, a % 1, a // 1, a ^ 1)`,
  '(4,6)\t(2,2)\t11\t(2,4)\ntrue\ttrue\ttrue\ttrue\tfalse\ttrue\ttrue\n(-1,-2)\t2\t(1,2)(3,4)\t(1,2)!\t!(1,2)\t2\ndiv\tmod\tidiv\tpow');
t('__index function and __newindex', `local t = setmetatable({}, {__index = function(t, k) return k .. "!" end}) print(t.foo, t[1])
local p = setmetatable({}, {__newindex = function(t, k, v) rawset(t, k, v * 2) end}) p.x = 5 print(p.x) p.x = 7 print(p.x)
local store = {} local q = setmetatable({}, {__newindex = store}) q.a = 1 print(rawget(q, "a"), store.a)
local base = {greet = "hi"} local mid = setmetatable({}, {__index = base}) local top = setmetatable({}, {__index = mid}) print(top.greet)`,
  'foo!\t1!\n10\n7\nnil\t1\nhi');
t('__metatable protection', `local t = setmetatable({}, {__metatable = "locked"}) print(getmetatable(t)) print(pcall(setmetatable, t, {}))`,
  'locked\nfalse\tcannot change a protected metatable');
t('__eq only for tables, rawequal', `local mt = {__eq = function() return true end} local a, b = setmetatable({}, mt), setmetatable({}, mt)
print(a == b, rawequal(a, b), a == 1, rawlen({1, 2}), rawlen("abc"))`, 'true\tfalse\tfalse\t2\t3');
t('__call with varargs', `local c = setmetatable({}, {__call = function(self, ...) return select('#', ...), ... end}) print(c(1, 2, 3))`, '3\t1\t2\t3');
t('__tostring used by print', `local t = setmetatable({}, {__tostring = function() return "custom!" end}) print(t)`, 'custom!');
t('__index on _G (strict mode)', `setmetatable(_G, {__newindex = function(t, k, v) rawset(t, k, v) end, __index = function(_, k) error("undefined variable '" .. k .. "'", 2) end})
x = 1 print(x)
print(pcall(function() return y end))`, "1\nfalse\tmain:3: undefined variable 'y'");
t('string metatable', `print(getmetatable("").__index == string, ("%d"):format(5), ("a,b"):find(",", 1, true))`, 'true\t5\t2\t2');
t('__pairs', `local p = setmetatable({}, {__pairs = function(t) return function(_, k) if not k then return 1, "one" end end, t, nil end})
for k, v in pairs(p) do print(k, v) end`, '1\tone');
t('__lt for sort', `local mt = {__lt = function(a, b) return a.v < b.v end}
local l = {} for _, v in ipairs({3, 1, 2}) do l[#l + 1] = setmetatable({v = v}, mt) end table.sort(l) print(l[1].v, l[2].v, l[3].v)`, '1\t2\t3');

// errors
t('error and pcall', `print(pcall(error, "boom")) print(pcall(function() error("boom") end)) print(pcall(function() error("boom", 0) end))
local ok, e = pcall(function() error({code = 42}) end) print(ok, e.code) print(pcall(error))`,
  'false\tboom\nfalse\tmain:1: boom\nfalse\tboom\nfalse\t42\nfalse\tnil');
t('runtime error messages', `print(pcall(function() local x = nil; return x.y end))
print(pcall(function() return undefinedfn() end))
print(pcall(function() return 1 + {} end))
print(pcall(function() return "a" < 1 end))
print(pcall(function() return {} < {} end))
print(pcall(function() return #nil end))
print(pcall(function() local t = {} t.x.y = 1 end))
print(pcall(function() return ("x") .. {} end))
print(pcall(function() local t = {} t:nomethod() end))
print(pcall(function() return "abc" + 1 end))
print(pcall(function() local s = "x" return s.y.z end))
print(pcall(function() return math.floor("x") end))`,
  ["false\tmain:1: attempt to index a nil value (local 'x')",
   "false\tmain:2: attempt to call a nil value (global 'undefinedfn')",
   'false\tmain:3: attempt to perform arithmetic on a table value',
   'false\tmain:4: attempt to compare string with number',
   'false\tmain:5: attempt to compare two table values',
   'false\tmain:6: attempt to get length of a nil value',
   "false\tmain:7: attempt to index a nil value (field 'x')",
   'false\tmain:8: attempt to concatenate a table value',
   "false\tmain:9: attempt to call a nil value (method 'nomethod')",
   "false\tmain:10: attempt to perform arithmetic on a string value (constant 'abc')",
   "false\tmain:11: attempt to index a nil value (field 'y')",
   "false\tmain:12: bad argument #1 to 'floor' (number expected, got string)"].join('\n'));
t('error level 2', `local function check(x) if not x then error("bad input", 2) end end
local function caller() check(false) end
print(pcall(caller))`, 'false\tmain:2: bad input');
t('assert', `print(pcall(assert, false)) print(pcall(assert, nil, "custom")) print(assert(1, 2, 3)) print(pcall(assert, false, {1}))`,
  'false\tassertion failed!\nfalse\tcustom\n1\t2\t3\nfalse\t' + '<table>');
t('nested pcall and rethrow', `print(pcall(function() local ok, e = pcall(error, "inner") error("outer:" .. e, 0) end))`, 'false\touter:inner');
t('xpcall', `print(xpcall(function() error("x", 0) end, function(m) return "handled " .. m end))
print(xpcall(function(a, b) return a + b end, print, 2, 3))
print(xpcall(function() local t = nil return t.x end, function(m) return "H:" .. m end))`,
  "false\thandled x\ntrue\t5\nfalse\tH:main:3: attempt to index a nil value (local 't')");
t('pcall returns all results', `print(pcall(function() return 1, 2, 3 end)) print(select('#', pcall(function() end)))`, 'true\t1\t2\t3\n1');
t('error in error position (multi-line)', `local t = nil
local x = 1
print(t.field)`, { err: /^main:3: attempt to index a nil value \(local 't'\)$/ });
t('uncaught error object', `error({code = 1})`, { err: /^\(error object is a table value\)$/ });
t('uncaught error string', `error("plain", 0)`, { err: /^plain$/ });

// recursion depth
t('deep recursion is fine', `local function d(n) if n == 0 then return 0 end return 1 + d(n - 1) end print(d(15000))`, '15000');
t('stack overflow is a clean error', `local function inf(n) return 1 + inf(n) end print(pcall(inf, 1))`, 'false\tmain:1: stack overflow');
t('stack overflow uncaught', `local function inf(n) return 1 + inf(n) end inf(1)`, { err: /^main:1: stack overflow$/ });
t('tail calls do not grow the stack', `local function loop(n) if n == 0 then return "done" end return loop(n - 1) end print(loop(100000))`, 'done');
t('nested host-call overflow is clean', `local t = setmetatable({}, {__tostring = function(s) return tostring(s) end}) print(pcall(tostring, t))`,
  { out: /^false\t.*stack overflow/ });

// compile errors
t('syntax: unexpected symbol', `x = = 1`, { err: /^main:1:5: unexpected symbol near '='$/ });
t('syntax: missing end', `if x then`, { err: /^main:1:10: 'end' expected near <eof>$/ });
t('syntax: missing end, other line', `while true do\n  x = 1\n`, { err: /^main:3:1: 'end' expected \(to close 'while' at line 1\) near <eof>$/ });
t('syntax: name expected', `local 1 = 2`, { err: /^main:1:7: <name> expected near '1'$/ });
t('syntax: eof in expression', `x = 1 +`, { err: /^main:1:8: unexpected symbol near <eof>$/ });
t('syntax: goto unsupported', `goto done`, { err: /goto' and labels are not supported/ });
t('syntax: unfinished string', `print("abc`, { err: /^main:1:7: unfinished string$/ });
t('syntax: bitwise unsupported', `x = 3 & 4`, { err: /bitwise operators are not supported/ });
t('syntax: for needs comma', `for i = 1 do end`, { err: /^main:1:11: ',' expected near 'do'$/ });
t('syntax: const assignment', `local x <const> = 1\nx = 2`, { err: /^main:2: attempt to assign to const variable 'x'$/ });
t('syntax: break outside loop', `break`, { err: /^main:1: break outside a loop$/ });
t('syntax: vararg outside vararg function', `function f() return ... end`, { err: /cannot use '\.\.\.' outside a vararg function/ });
t('syntax: malformed number', `x = 0x`, { err: /malformed number near '0x'/ });
t('syntax: line and column', `local a = 1\nlocal b = = 2`, { err: /^main:2:11: unexpected symbol near '='$/ });
t('syntax: invalid escape', `x = "\\q"`, { err: /invalid escape sequence/ });
t('syntax: too deep', 'x = ' + '('.repeat(300) + '1' + ')'.repeat(300), { err: /too many syntax levels/ });
t('syntax: close unsupported', `local x <close> = nil`, { err: /'<close>' variables are not supported/ });

// string library
t('string.sub', `print(("hello"):sub(2, 4), ("hello"):sub(-3), ("hello"):sub(2), ("hello"):sub(0), ("hello"):sub(10), ("hello"):sub(-100, 2))`,
  'ell\tllo\tello\thello\t\the');
t('byte/char/rep/reverse', `print(string.byte("A"), string.char(72, 105), ("abc"):byte(1, -1)) print(("abc"):rep(3, "-"), ("abc"):reverse(), #("x"):rep(0), ("ab"):rep(2))`,
  '65\tHi\t97\t98\t99\nabc-abc-abc\tcba\t0\tabab');
t('upper/lower/len', `print(string.upper("MiXed"), string.lower("MiXed"), string.len("four"))`, 'MIXED\tmixed\t4');
t('string.format integers', `print(string.format("%d %5d %-5d| %05d %x %X %o %i %+d", 42, 42, 42, 42, 255, 255, 8, -7, 5))`,
  '42    42 42   | 00042 ff FF 10 -7 +5');
t('string.format floats', `print(string.format("%.2f %10.3f %e %g %g %g", 3.14159, 2.5, 12345.678, 0.0001, 1e20, 100))
print(string.format("%g %g %g %.3g %5.1f%%", 1/3, 123456789, 0.1, 2/3, 99.44))`,
  '3.14      2.500 1.234568e+04 0.0001 1e+20 100\n0.333333 1.23457e+08 0.1 0.667  99.4%');
t('string.format strings', `print(string.format("%s %s %s|%5s|%-5s|%.2s", 1, true, nil, "ab", "ab", "abcdef")) print(string.format("%q", 'a "q"\\n\\0'))`,
  '1 true nil|   ab|ab   |ab\n"a \\"q\\"\\\n\\0"');
t('string.format errors', `print(pcall(string.format, "%d", 1.5)) print(pcall(string.format, "%d")) print(string.format("%x", -1), string.format("%%"))`,
  "false\tbad argument #2 to 'format' (number has no integer representation)\nfalse\tbad argument #2 to 'format' (no value)\nffffffffffffffff\t%");
t('string.format uses __tostring', `local t = setmetatable({}, {__tostring = function() return "T" end}) print(string.format("<%s>", t))`, '<T>');
t('string.find', `print(string.find("hello world", "o w")) print(string.find("hello world", "l+")) print(string.find("hello", "xyz"))
print(string.find("a.b", ".", 1, true)) print(string.find("hello", "(l)(l)")) print(string.find("abc", "[b-c]+")) print(string.find("abc", "b", -1)) print(string.find("a+b", "+", 1, true))
print(string.find("abc", "", 10)) print(string.find("abc", "", 4))`,
  '5\t7\n3\t4\nnil\n2\t2\n3\t4\tl\tl\n2\t3\nnil\n2\t2\nnil\n4\t3');
t('string.match', `print(string.match("key=value", "(%w+)=(%w+)")) print(string.match("  trim  ", "^%s*(.-)%s*$")) print(string.match("2024-01-15", "(%d+)-(%d+)-(%d+)"))
print(string.match("hello", "()ll()")) print(string.match("abc", "^b")) print(string.match("[[x]]", "%[(.-)%]")) print(string.match("hello123", "%a+%d+"))
print(string.match("x = 10", "^(%w+)%s*=%s*(%d+)$")) print(string.match("caaat", "ca-t"), string.match("caaat", "ca*"), string.match("ct", "ca?t"))
print(string.match("%d", "%%d"), string.match("a1b2", "%d", 3), string.match("hello", "(h)(e)(l)"))
print(string.match("  x", "^%s?x"), string.match("hello", ".-(l+)(.*)"))`,
  'key\tvalue\ntrim\n2024\t01\t15\n3\t5\nnil\n[x\nhello123\nx\t10\ncaaat\tcaaa\tct\n%d\t2\th\te\tl\nnil\tll\to');
t('string.gsub', `print(string.gsub("hello world", "o", "0")) print(string.gsub("hello", "", "-")) print(string.gsub("abc", "%w", "%0%0"))
print(string.gsub("hello world", "(%w+)", "<%1>")) print(string.gsub("$name is $age", "%$(%w+)", {name = "Bob", age = 30}))
print(string.gsub("1 2 3", "%d", function(d) return d * 2 end)) print(string.gsub("abc", "b", "%%")) print(string.gsub("hello", "l", "L", 1))
print(string.gsub("THE (quick) fox", "%((%w+)%)", "%1")) print(string.gsub("f(a(b)c)d", "%b()", "")) print(string.gsub("THE (quick) fox", "%f[%a]%a+", "W"))
print(string.gsub("abc", "^a", "X")) print(string.gsub("keep", "(e)", function() return nil end)) print(pcall(string.gsub, "x", "x", "%2"))`,
  "hell0 w0rld\t2\n-h-e-l-l-o-\t6\naabbcc\t3\n<hello> <world>\t2\nBob is 30\t2\n2 4 6\t3\na%c\t1\nheLlo\t1\nTHE quick fox\t1\nfd\t1\nW (W) W\t3\nXbc\t1\nkeep\t2\nfalse\tinvalid capture index %2");
t('string.gmatch', `local words = {} for w in string.gmatch("one two  three", "%a+") do words[#words + 1] = w end print(#words, words[3])
for k, v in string.gmatch("a=1, b=2", "(%w+)=(%w+)") do print(k, v) end
local n = 0 for _ in ("abc"):gmatch("") do n = n + 1 end print(n)`,
  '3\tthree\na\t1\nb\t2\n4');
t('pattern classes', `print(("a1 B_!"):gsub("%a", "a")) print(("a1 B_!"):gsub("%d", "d")) print(("a1 B_!"):gsub("%s", "s")) print(("a1 B_!"):gsub("%w", "w"))
print(("a1 B_!"):gsub("%p", "p")) print(("a1 B_!"):gsub("%l", "l")) print(("a1 B_!"):gsub("%u", "u")) print(("ff 0x1G"):gsub("%x", "x")) print(("a1 B"):gsub("%A", "."))
print(("a]b"):gsub("[]]", "!")) print(("a-b"):gsub("[a-]", "?")) print(("x^y"):gsub("[%^]", "^^")) print(("abc"):gsub("[^b]", "."))`,
  'a1 a_!\t2\nad B_!\t1\na1sB_!\t1\nww w_!\t3\na1 Bpp\t2\nl1 B_!\t1\na1 u_!\t1\nxx xxxG\t4\na..B\t2\na!b\t1\n??b\t2\nx^^y\t1\n.b.\t2');
t('pattern errors', `print(pcall(string.find, "x", "%")) print(pcall(string.find, "x", "[a")) print(pcall(string.match, "x", "(()"))`,
  "false\tmalformed pattern (ends with '%')\nfalse\tmalformed pattern (missing ']')\nfalse\tunfinished capture");
t('tostring/tonumber', `print(tonumber("10"), tonumber("0x1F"), tonumber("1e2"), tonumber("  5  "), tonumber("abc"), tonumber("10", 2), tonumber("ff", 16), tonumber("zz", 36), tonumber("8", 8), tonumber(nil), tonumber(""), tonumber("1e"), tonumber("inf"), tonumber("0x"), tonumber(" -7 "))
print(tostring(12), tostring(1.25), tostring(true), tostring(nil), tostring("s"))`,
  '10\t31\t100\t5\tnil\t2\t255\t1295\tnil\tnil\tnil\tnil\tnil\tnil\t-7\n12\t1.25\ttrue\tnil\ts');
t('type', `print(type(print), type(nil), type({}), type("s"), type(2), type(true), type(coroutine.create(print)), math.type(1), math.type(1.5), math.type("1"))`,
  'function\tnil\ttable\tstring\tnumber\tboolean\tthread\tinteger\tfloat\tnil');
t('tostring of tables/functions', `local s = tostring({}) print(s:match("^table: 0x%x+$") ~= nil, tostring(print):match("^function: ") ~= nil, tostring({}) ~= tostring({}))`,
  'true\ttrue\ttrue');

// table library
t('table.insert/remove/concat', `local t = {1, 2, 3} table.insert(t, 4) table.insert(t, 1, 0) print(table.concat(t, ","))
print(table.remove(t), table.remove(t, 1), table.concat(t, ",")) print(table.concat({}, ","), table.concat({1, "a", 2.5}, "-"), table.concat({1, 2, 3, 4}, ",", 2, 3))
local e = {} print(table.remove(e), #e) table.insert(t, #t + 1, "end") print(t[#t])`,
  '0,1,2,3,4\n4\t0\t1,2,3\n\t1-a-2.5\t2,3\nnil\t0\nend');
t('table errors', `print(pcall(table.concat, {1, {}, 3})) print(pcall(table.insert, {1, 2}, 5, 1)) print(pcall(table.insert, nil, 1)) print(pcall(table.remove, {1}, 5))`,
  "false\tinvalid value (at index 2) in table for 'concat'\nfalse\tbad argument #2 to 'insert' (position out of bounds)\nfalse\tbad argument #1 to 'insert' (table expected, got nil)\nfalse\tbad argument #2 to 'remove' (position out of bounds)");
t('table.sort', `local s = {5, 2, 8, 1, 9} table.sort(s) print(table.concat(s, " ")) table.sort(s, function(a, b) return a > b end) print(table.concat(s, " "))
local names = {"bob", "alice", "Carl"} table.sort(names) print(table.concat(names, " "))
local recs = {{n = "b", v = 2}, {n = "a", v = 1}, {n = "c", v = 3}} table.sort(recs, function(x, y) return x.v < y.v end) print(recs[1].n, recs[2].n, recs[3].n)
print((pcall(table.sort, {3, "a", 1})))`,
  '1 2 5 8 9\n9 8 5 2 1\nCarl alice bob\na\tb\tc\nfalse');
t('table.sort is stable and handles many items', `local t = {} for i = 1, 1000 do t[i] = {k = i % 7, i = i} end table.sort(t, function(a, b) return a.k < b.k end)
local okk = true for i = 2, #t do if t[i - 1].k == t[i].k and t[i - 1].i > t[i].i then okk = false end end print(okk, t[1].k, t[1000].k)`, 'true\t0\t6');
t('table.pack', `local p = table.pack(1, nil, 3) print(p.n, p[1], p[3]) print(table.pack().n)`, '3\t1\t3\n0');

// math library
t('math', `print(math.floor(3.7), math.ceil(3.2), math.floor(-3.5), math.abs(-4), math.max(1, 5, 3), math.min(4, 2, 8))
print(math.sqrt(16), math.pi > 3.14, math.huge, -math.huge, math.fmod(7, 3), math.fmod(-7, 3))
print(math.modf(3.7)) print(math.modf(-3.7)) print(math.tointeger(3), math.tointeger(3.5)) print(math.log(8, 2), math.log(100, 10), math.exp(0), math.sin(0), math.cos(0))
print(math.atan(1, 1) == math.pi / 4, math.ceil(-0.5))`,
  '3\t4\t-4\t4\t5\t2\n4\ttrue\tinf\t-inf\t1\t-1\n3\t0.7\n-3\t-0.7\n3\tnil\n3\t2\t1\t0\t1\ntrue\t0');
t('math.random ranges and seeding', `local okk = true for i = 1, 200 do local r = math.random(1, 6) if r < 1 or r > 6 or r % 1 ~= 0 then okk = false end local f = math.random() if f < 0 or f >= 1 then okk = false end end
math.randomseed(42) local a = {math.random(100), math.random(100), math.random()} math.randomseed(42) local b = {math.random(100), math.random(100), math.random()}
print(okk, a[1] == b[1] and a[2] == b[2] and a[3] == b[3], math.random(5, 5)) print(pcall(math.random, 2, 1))`,
  "true\ttrue\t5\nfalse\tbad argument #2 to 'random' (interval is empty)");
t('math.max errors', `print(pcall(math.max))`, "false\tbad argument #1 to 'max' (number expected, got no value)");

// coroutines
t('coroutine basics', `local co = coroutine.create(function(a, b)
  print("start", a, b)
  local c = coroutine.yield(a + b)
  print("got", c)
  local d, e = coroutine.yield(c * 2)
  print("got2", d, e)
  return "end"
end)
print(coroutine.resume(co, 1, 2)) print(coroutine.status(co)) print(coroutine.resume(co, 10)) print(coroutine.resume(co, "x", "y")) print(coroutine.status(co)) print(coroutine.resume(co))`,
  'start\t1\t2\ntrue\t3\nsuspended\ngot\t10\ntrue\t20\ngot2\tx\ty\ntrue\tend\ndead\nfalse\tcannot resume dead coroutine');
t('generator via wrap', `local function range(n) return coroutine.wrap(function() for i = 1, n do coroutine.yield(i) end end) end
local s = 0 for i in range(10) do s = s + i end print(s)`, '55');
t('yield across nested Mote calls', `local function inner() coroutine.yield("inner") return "r" end
local function middle() local r = inner() coroutine.yield("middle " .. r) end
local co = coroutine.wrap(function() middle() return "done" end) print(co(), co(), co())`, 'inner\tmiddle r\tdone');
t('yield through pcall', `local co = coroutine.create(function()
  local ok, err = pcall(function() coroutine.yield(1) error("after yield", 0) end)
  coroutine.yield(ok, err)
  return "fin"
end)
print(coroutine.resume(co)) print(coroutine.resume(co)) print(coroutine.resume(co))`, 'true\t1\ntrue\tfalse\tafter yield\ntrue\tfin');
t('pcall(coroutine.yield)', `local co = coroutine.create(function() local a, b = pcall(coroutine.yield, "y") return a, b end)
print(coroutine.resume(co)) print(coroutine.resume(co, "back"))`, 'true\ty\ntrue\ttrue\tback');
t('yield inside metamethod', `local t = setmetatable({}, {__index = function(_, k) return coroutine.yield(k) end})
local co = coroutine.wrap(function() return "value: " .. t.foo end) print(co()) print(co("bar"))`, 'foo\nvalue: bar');
t('error inside coroutine', `local co = coroutine.create(function() error("oops") end) print(coroutine.resume(co)) print(coroutine.status(co))
local f = coroutine.wrap(function() error("bad", 0) end) print(pcall(f))`, 'false\tmain:1: oops\ndead\nfalse\tbad');
t('running/isyieldable', `print(coroutine.isyieldable())
local co = coroutine.create(function() print(coroutine.isyieldable()) local c, m = coroutine.running() print(type(c), m, coroutine.status(c)) end)
print(coroutine.resume(co)) local _, ismain = coroutine.running() print(ismain)`, 'false\ntrue\nthread\tfalse\trunning\ntrue\ntrue');
t('resume non-suspended', `local co co = coroutine.create(function() return coroutine.resume(co) end) print(coroutine.resume(co))
local outer outer = coroutine.create(function() local inner = coroutine.create(function() return coroutine.status(outer) end) return coroutine.resume(inner) end) print(coroutine.resume(outer))`,
  'true\tfalse\tcannot resume non-suspended coroutine\ntrue\ttrue\tnormal');
t('yield outside coroutine', `print(pcall(coroutine.yield, 1))`, 'false\tattempt to yield from outside a coroutine');
t('yield across host boundary', `local co = coroutine.create(function() table.sort({3, 1, 2}, function(a, b) coroutine.yield() return a < b end) end)
print(coroutine.resume(co))`, 'false\tattempt to yield across a host call boundary');
t('producer/consumer', `local p = coroutine.create(function() for _, item in ipairs({"a", "b", "c"}) do coroutine.yield(item) end end)
local out = {} while true do local _, v = coroutine.resume(p) if not v then break end out[#out + 1] = v end print(table.concat(out))`, 'abc');
t('tree walker', `local function walk(t) if t then walk(t.left) coroutine.yield(t.v) walk(t.right) end end
local tree = {v = 2, left = {v = 1}, right = {v = 3, right = {v = 4}}} local o = {} for v in coroutine.wrap(function() walk(tree) end) do o[#o + 1] = v end print(table.concat(o, " "))`, '1 2 3 4');
t('permutations (PIL)', `local function permgen(a, n) n = n or #a if n <= 1 then coroutine.yield(a) else for i = 1, n do a[n], a[i] = a[i], a[n] permgen(a, n - 1) a[n], a[i] = a[i], a[n] end end end
local function permutations(a) return coroutine.wrap(function() permgen(a) end) end
local count, first = 0 for p in permutations({"a", "b", "c"}) do count = count + 1 first = first or table.concat(p, " ") end print(count, first)`, '6\tb c a');
t('coroutine.close', `local co = coroutine.create(function() coroutine.yield() end) coroutine.resume(co) print(coroutine.close(co), coroutine.status(co))`, 'true\tdead');
t('coroutine of a host function', `local co = coroutine.create(print) print(coroutine.resume(co, "via host"))
local w = coroutine.wrap(coroutine.yield) print(w(1, 2)) print(w("back"))`, 'via host\ntrue\n1\t2\nback');
t('many coroutines', `local cos = {} for i = 1, 500 do cos[i] = coroutine.wrap(function() local n = i while true do coroutine.yield(n) n = n + 1 end end) end
local s = 0 for r = 1, 3 do for i = 1, 500 do s = s + cos[i]() end end print(s)`, String(3 * (500 * 501 / 2) + 500 * 3));
t('coroutine stack overflow is clean', `local co = coroutine.create(function() local function f() return 1 + f() end return f() end) print(coroutine.resume(co))`, 'false\tmain:1: stack overflow');

// globals, load, misc
t('_G and _VERSION', `_G.x = 5 print(x, _G._G == _G, _VERSION) y = 1 print(_G.y)`, '5\ttrue\tMote 1.0\n1');
t('load', `local f = load("return 1 + 2") print(f()) local g = load("local a, b = ... return a * b") print(g(6, 7)) print(select('#', load("x = ")))
local _, e = load("x = ") print(e)`, '3\n42\n2\nload:1:5: unexpected symbol near <eof>');
t('function statements on fields and methods', `local a = {b = {}} function a.b.f(x) return x * 2 end function a.b:m(x) return self == a.b, x end print(a.b.f(4), a.b:m(1))`, '8\ttrue\t1');
t('method call on string literal needs parens', `print(("abc"):upper(), #("abc"):rep(2))`, 'ABC\t6');
t('long string concatenation loop', `local s = "" for i = 1, 1000 do s = s .. "x" end print(#s)`, '1000');
t('integer keys via float arithmetic', `local t = {} t[3 / 3] = "a" t[2 * 1.0] = "b" print(#t, t[1], t[2])`, '2\ta\tb');
t('closures in table constructor', `local t = {f = function(x) return x + 1 end, g = function(self) return self.v end, v = 9} print(t.f(1), t:g())`, '2\t9');
t('varargs with nils at end', `local function f(...) return select('#', ...) end print(f(1, nil), f(nil), f(f()))`, '2\t1\t1');
t('string comparison with metamethod-less tables errors', `print(pcall(function() return {} .. "" end))`, 'false\tmain:1: attempt to concatenate a table value');
t('numeric for with float accumulation', `local n = 0 for x = 0, 1, 0.1 do n = n + 1 end print(n)`, '11');
t('goto-free continue idiom', `local out = {} for i = 1, 5 do repeat if i % 2 == 0 then break end out[#out + 1] = i until true end print(table.concat(out, ","))`, '1,3,5');

// ─────────────────────────────────────────── runner ────────────────────────────────────────────
function runProgram(src, opts) {
  const out = [];
  const vm = Mote.create(Object.assign({ print: s => out.push(s) }, opts));
  let err = null;
  try { vm.run(src); } catch (e) { err = e; }
  return { out: out.join('\n'), err };
}
for (const [name, src, exp] of P) {
  if (filter && !name.includes(filter)) continue;
  const { out, err } = runProgram(src);
  if (typeof exp === 'string') {
    let got = out;
    if (exp.includes('<table>')) got = got.replace(/table: 0x[0-9a-f]+/g, '<table>');
    ok(name, !err && got === exp, err ? `threw ${err.message}` : `expected ${JSON.stringify(exp)}\n    got      ${JSON.stringify(got)}`);
  } else if (exp.err) {
    ok(name, err instanceof Mote.Error && exp.err.test(err.message), err ? `message ${JSON.stringify(err.message)} (${err.constructor.name})` : 'did not throw');
  } else if (exp.out) {
    ok(name, !err && exp.out.test(out), err ? `threw ${err.message}` : `got ${JSON.stringify(out)}`);
  }
}

// ───────────────────────────────────── embedding API tests ─────────────────────────────────────
const A = [];
const api = (name, fn) => A.push([name, fn]);
const throws = (fn, re, kind) => {
  try { fn(); } catch (e) { return e instanceof Mote.Error && re.test(e.message) && (!kind || e.kind === kind) ? true : `threw ${e.constructor.name}: ${e.message} (${e.kind})`; }
  return 'did not throw';
};

api('run returns converted results', () => {
  const vm = Mote.create();
  const r = vm.run('return 1, "a", {1, 2}, {a = 1, b = {true}}, nil, 2.5');
  return JSON.stringify(r) === JSON.stringify([1, 'a', [1, 2], { a: 1, b: [true] }, undefined, 2.5]) || JSON.stringify(r);
});
api('set/get conversions', () => {
  const vm = Mote.create();
  vm.set('n', 42); vm.set('s', 'str'); vm.set('b', false); vm.set('nul', null);
  vm.set('arr', [10, 20, 30]); vm.set('obj', { x: 1, nested: { y: [1, 2] } });
  const r = vm.run('return n, s, b, nul == nil, #arr, arr[1], obj.x, obj.nested.y[2], type(obj)');
  if (JSON.stringify(r) !== JSON.stringify([42, 'str', false, true, 3, 10, 1, 2, 'table'])) return JSON.stringify(r);
  vm.run('t = {1, 2, 3} m = {k = "v", [1] = "one"} e = {}');
  const g = [vm.get('t'), vm.get('m'), vm.get('e'), vm.get('missing')];
  return JSON.stringify(g) === JSON.stringify([[1, 2, 3], { 1: 'one', k: 'v' }, {}, undefined]) || JSON.stringify(g);
});
api('tables are copied by default', () => {
  const vm = Mote.create();
  const cfg = { a: 1 };
  vm.set('cfg', cfg);
  vm.run('cfg.a = 2 cfg.b = 3');
  return (cfg.a === 1 && cfg.b === undefined && vm.get('cfg').a === 2) || JSON.stringify(cfg);
});
api('cyclic structures convert', () => {
  const vm = Mote.create();
  const o = { name: 'o' }; o.self = o;
  vm.set('o', o);
  const r = vm.run('return o.self.self.name, o.self == o');
  const back = vm.run('local t = {} t.me = t return t')[0];
  return (r[0] === 'o' && r[1] === true && back.me === back) || JSON.stringify(r);
});
api('host functions: converted args, multi returns', () => {
  const vm = Mote.create();
  let seen;
  vm.set('host', (a, b, c) => { seen = [a, b, c]; return vm.multi(a + 1, 'two'); });
  const r = vm.run('local x, y = host(1, {1, 2}, {k = "v"}) return x, y');
  return (JSON.stringify(seen) === JSON.stringify([1, [1, 2], { k: 'v' }]) && r[0] === 2 && r[1] === 'two') || JSON.stringify([seen, r]);
});
api('host function returning nothing returns no values', () => {
  const vm = Mote.create();
  vm.set('f', () => {});
  return vm.run('return select("#", f())')[0] === 0;
});
api('Mote functions to JS and back', () => {
  const vm = Mote.create();
  vm.run('function add(a, b) return a + b end function pair() return 1, 2 end');
  const add = vm.get('add');
  if (add(2, 3) !== 5) return 'add';
  if (JSON.stringify(vm.call('pair')) !== '[1,2]') return 'pair';
  if (JSON.stringify(vm.call(add, 4, 5)) !== '[9]') return 'call(fn)';
  vm.set('cb', add);
  if (vm.run('return cb == add')[0] !== true) return 'identity';
  let stored;
  vm.set('register', f => { stored = f; });
  vm.run('register(function(x) return x * 10 end)');
  return stored(4) === 40 || 'stored callback';
});
api('compile returns a callable chunk', () => {
  const vm = Mote.create();
  const f = vm.compile('local a = ... counter = (counter or 0) + a return counter', 'chunk');
  f(1); f(2);
  return vm.get('counter') === 3 && vm.call(f, 10)[0] === 13;
});
api('Mote.Error fields for runtime errors', () => {
  const vm = Mote.create();
  try { vm.run('local x = 1\nlocal function boom()\n  return nil + 1\nend\nboom()', 'level.lua'); } catch (e) {
    return (e instanceof Mote.Error && e.kind === 'runtime' && e.line === 3 && e.chunk === 'level.lua' &&
      e.message === 'level.lua:3: attempt to perform arithmetic on a nil value' &&
      /level\.lua:3: in function 'boom'/.test(e.traceback) && /level\.lua:5: in main chunk/.test(e.traceback)) || JSON.stringify(e) + e.traceback;
  }
  return 'did not throw';
});
api('Mote.Error fields for syntax errors', () => {
  const vm = Mote.create();
  try { vm.compile('x = 1\ny = )', 'mod.lua'); } catch (e) {
    return (e.kind === 'syntax' && e.line === 2 && e.column === 5 && e.chunk === 'mod.lua') || JSON.stringify(e);
  }
  return 'did not throw';
});
api('error values pass to the host', () => {
  const vm = Mote.create();
  try { vm.run('error({code = 7, msg = "x"})'); } catch (e) { return (e.value.code === 7 && e.value.msg === 'x') || JSON.stringify(e.value); }
  return 'did not throw';
});
api('JS exceptions in host functions become Mote errors', () => {
  const vm = Mote.create();
  vm.set('bad', () => { throw new Error('host failure'); });
  const r = vm.run('local ok, e = pcall(bad) return ok, e');
  if (r[0] !== false || r[1] !== 'host failure') return JSON.stringify(r);   // called directly by pcall: no position (as in Lua)
  const r1 = vm.run('local ok, e = pcall(function() bad() end) return e');
  if (r1[0] !== 'main:1: host failure') return JSON.stringify(r1);
  return throws(() => vm.run('\nbad()'), /^main:2: host failure$/);
});
api('VM usable after errors', () => {
  const vm = Mote.create();
  try { vm.run('error("x")'); } catch (e) {}
  try { vm.run('x = = 1'); } catch (e) {}
  return vm.run('return 1 + 1')[0] === 2;
});
api('step budget: runaway loop is stopped, not catchable by pcall, VM stays usable', () => {
  const vm = Mote.create({ maxSteps: 1e5 });
  let r = throws(() => vm.run('while true do end'), /^main:1: step budget exhausted \(100000 steps\)$/, 'limit');
  if (r !== true) return r;
  r = throws(() => vm.run('local ok = pcall(function() while true do end end) print("caught?", ok)'), /step budget exhausted/, 'limit');
  if (r !== true) return r;
  r = throws(() => vm.run('local co = coroutine.wrap(function() while true do end end) co()'), /step budget exhausted/, 'limit');
  if (r !== true) return r;
  r = throws(() => vm.run('table.sort({3, 2, 1}, function(a, b) while true do end end)'), /step budget exhausted/, 'limit');
  if (r !== true) return r;
  r = throws(() => vm.run('string.find(string.rep("a", 5000), ".-.-.-.-.-b")'), /step budget exhausted/, 'limit');
  if (r !== true) return r;
  if (vm.run('local s = 0 for i = 1, 100 do s = s + i end return s')[0] !== 5050) return 'not usable';
  const st = vm.stats();
  return (st.steps > 100 && st.steps < 2000 && st.maxSteps === 1e5) || JSON.stringify(st);
});
api('step budget counts per entry and is configurable', () => {
  const vm = Mote.create({ maxSteps: 5000 });
  vm.run('function tick() local s = 0 for i = 1, 100 do s = s + i end return s end');
  for (let i = 0; i < 100; i++) vm.call('tick');   // 100 × ~500 steps: fine, budget refills per call
  vm.maxSteps = 100;
  const r = throws(() => vm.call('tick'), /step budget exhausted/, 'limit');
  vm.maxSteps = Infinity;
  return r === true && vm.call('tick')[0] === 5050 ? true : r;
});
api('memory limit', () => {
  const vm = Mote.create({ maxMemory: 1e6 });
  let r = throws(() => vm.run('local t = {} for i = 1, 1e7 do t[i] = i end'), /memory limit exceeded/, 'limit');
  if (r !== true) return r;
  r = throws(() => vm.run('local s = "x" while true do s = s .. s end'), /memory limit exceeded/, 'limit');
  if (r !== true) return r;
  r = throws(() => vm.run('return string.rep("x", 1e9)'), /memory limit exceeded/, 'limit');
  if (r !== true) return r;
  r = throws(() => vm.run('local t = {} while true do t = {t} end'), /memory limit exceeded/, 'limit');
  if (r !== true) return r;
  return vm.run('local t = {} for i = 1, 1000 do t[i] = i end return #t')[0] === 1000;
});
api('deep recursion: clean stack overflow error (not a JS RangeError)', () => {
  const vm = Mote.create();
  const r = throws(() => vm.run('local function f(n) return f(n + 1) + 1 end f(1)'), /stack overflow/, 'runtime');
  if (r !== true) return r;
  return throws(() => vm.run('local t = setmetatable({}, {__index = function(t, k) return t[k] end}) return t.x'), /stack overflow/, 'runtime');
});
api('sandbox: no host globals', () => {
  const vm = Mote.create();
  const r = vm.run('return type(window), type(globalThis), type(Function), type(eval), type(require), type(process), type(io), type(os), type(debug), type(module), type(dofile), type(loadstring)');
  return r.every(x => x === 'nil') || JSON.stringify(r);
});
api('sandbox: escape attempts through strings, tables and functions', () => {
  const vm = Mote.create();
  const r = vm.run(`local r = {}
    r[1] = ("").constructor
    r[2] = getmetatable("").__index.constructor
    r[3] = ({}).__proto__
    r[4] = ({}).constructor
    r[5] = string.constructor
    r[6] = rawget(_G, "constructor")
    r[7] = select(2, pcall(function() return print.constructor end))
    r[8] = select(2, pcall(function() return (1).constructor end))
    r[9] = ("x").__proto__
    return r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9]`);
  const exp = [undefined, undefined, undefined, undefined, undefined, undefined,
    "main:8: attempt to index a function value (global 'print')", 'main:9: attempt to index a number value', undefined];
  return JSON.stringify(r) === JSON.stringify(exp) || JSON.stringify(r);
});
api('sandbox: refs block prototype access', () => {
  const vm = Mote.create();
  class Player { constructor() { this.hp = 10; this.inv = []; } heal(n) { this.hp += n; return this.hp; } }
  const p = new Player();
  vm.set('p', vm.ref(p));
  const r = vm.run(`local r = {}
    r[1] = p.constructor  r[2] = p.__proto__  r[3] = p.toString  r[4] = p.hasOwnProperty  r[5] = p.__defineGetter__
    r[6] = p.valueOf  r[7] = select(2, pcall(function() return p.heal.constructor end))
    r[8] = p.heal ~= nil  r[9] = p.prototype
    return r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9]`);
  const exp = [undefined, undefined, undefined, undefined, undefined, undefined, "main:3: attempt to index a function value (field 'heal')", true, undefined];
  if (JSON.stringify(r) !== JSON.stringify(exp)) return JSON.stringify(r);
  const e = vm.run('return select(2, pcall(function() p.__proto__ = {} end)), select(2, pcall(function() p.constructor = 1 end))');
  if (!/cannot set field '__proto__'/.test(e[0]) || !/cannot set field 'constructor'/.test(e[1])) return JSON.stringify(e);
  return Object.getPrototypeOf(p) === Player.prototype && !('polluted' in Object.prototype);
});
api('sandbox: converting tables back cannot pollute prototypes', () => {
  const vm = Mote.create();
  const r = vm.run('return {__proto__ = {polluted = true}, constructor = "c"}')[0];
  return ({}).polluted === undefined && Object.getPrototypeOf(r) === Object.prototype && r.__proto__.polluted === true && r.constructor === 'c';
});
api('sandbox: class instances are not converted implicitly', () => {
  const vm = Mote.create();
  vm.set('getDate', () => new Date());
  const r = vm.run('return pcall(getDate)');
  return (r[0] === false && /cannot convert Date/.test(r[1])) || JSON.stringify(r);
});
api('sandbox: independent VMs share nothing', () => {
  const a = Mote.create(), b = Mote.create();
  a.run('x = 1 getmetatable("").__index.upper = function() return "hacked" end string.lower = nil table.insert = nil');
  const r = b.run('return x, ("a"):upper(), string.lower("B"), type(table.insert)');
  if (JSON.stringify(r) !== JSON.stringify([undefined, 'A', 'b', 'function'])) return JSON.stringify(r);
  const c = Mote.create({ seed: 7 }), d = Mote.create({ seed: 7 });
  const rc = c.run('return math.random(1000), math.random(1000)'), rd = d.run('return math.random(1000), math.random(1000)');
  return JSON.stringify(rc) === JSON.stringify(rd) || 'random differs';
});
api('stdlib selection', () => {
  const vm = Mote.create({ stdlib: ['base', 'math'] });
  const r = vm.run('return type(string), type(table), type(coroutine), type(math), type(os), type(print)');
  if (JSON.stringify(r) !== JSON.stringify(['nil', 'nil', 'nil', 'table', 'nil', 'function'])) return JSON.stringify(r);
  const r2 = vm.run('return pcall(function() return ("x"):upper() end)');
  if (r2[0] !== false) return 'string methods without string lib';
  const os = Mote.create({ stdlib: ['base', 'os'] });
  return os.run('return type(os.time()), type(os.clock())').join() === 'number,number';
});
api('refs: live properties, methods, arrays, allow-list, readonly, pairs', () => {
  const vm = Mote.create();
  const player = { x: 1, y: 2, name: 'p', move(dx) { this.x += dx; return this.x; } };
  vm.set('player', vm.ref(player));
  vm.run('player.x = player.x + 10 player:move(5) player.move(1) player.score = 3');
  if (player.x !== 17 || player.score !== 3) return JSON.stringify(player);
  const arr = [1, 2, 3];
  vm.set('arr', vm.ref(arr));
  const r = vm.run('arr[1] = 100 arr:push(4) local s = 0 for k, v in pairs(arr) do s = s + v end return #arr, arr[1], s');
  if (JSON.stringify(r) !== JSON.stringify([4, 100, 109]) || arr[0] !== 100) return JSON.stringify([r, arr]);
  const secret = { pub: 1, priv: 2 };
  vm.set('lim', vm.ref(secret, { allow: ['pub'] }));
  const r2 = vm.run('local ks = {} for k in pairs(lim) do ks[#ks + 1] = k end return lim.pub, lim.priv, table.concat(ks, ","), pcall(function() lim.priv = 5 end)');
  if (r2[0] !== 1 || r2[1] !== undefined || r2[2] !== 'pub' || r2[3] !== false || secret.priv !== 2) return JSON.stringify(r2);
  vm.set('ro', vm.ref({ a: 1 }, { readonly: true }));
  const r3 = vm.run('return pcall(function() ro.a = 2 end)');
  if (r3[0] !== false || !/read-only/.test(r3[1])) return JSON.stringify(r3);
  vm.set('p2', vm.ref(player));
  return vm.run('return player == p2, type(player)').join() === 'true,userdata';
});
api('refs: deep option exposes nested objects live', () => {
  const vm = Mote.create();
  const world = { pos: { x: 1 }, list: [{ v: 1 }] };
  vm.set('shallow', vm.ref(world));
  vm.set('deep', vm.ref(world, { deep: true }));
  vm.run('shallow.pos.x = 50 deep.pos.x = deep.pos.x + 1 deep.list[1].v = 9');
  return (world.pos.x === 2 && world.list[0].v === 9) || JSON.stringify(world);
});
api('host function yields: game-style wait', () => {
  const vm = Mote.create();
  const log = [];
  vm.set('wait', s => vm.yield('wait', s));
  vm.set('say', s => { log.push(s); });
  const th = vm.thread(vm.compile('say("a") local x = wait(1) say("b" .. x) wait(2) say("c") return "done"'));
  let r = th.resume();
  if (r.done || JSON.stringify(r.values) !== '["wait",1]' || log.join() !== 'a') return JSON.stringify([r, log]);
  r = th.resume(42);
  if (r.done || log.join() !== 'a,b42' || th.status !== 'suspended') return JSON.stringify([r, log]);
  r = th.resume();
  if (!r.done || r.values[0] !== 'done' || th.status !== 'dead') return JSON.stringify(r);
  return throws(() => th.resume(), /cannot resume dead coroutine/);
});
api('host yield through pcall, metamethods, nested Mote calls', () => {
  const vm = Mote.create();
  vm.set('wait', s => vm.yield(s));
  vm.run(`function script()
    local ok, v = pcall(wait, 1)
    local t = setmetatable({}, {__index = function(_, k) return wait(k) end})
    local function deep(n) if n == 0 then return wait("deep") end return deep(n - 1) end
    return ok, v, t.key, deep(50)
  end`);
  const th = vm.thread('script');
  const seq = [th.resume(), th.resume('one'), th.resume('two'), th.resume('three')];
  const exp = [{ done: false, values: [1] }, { done: false, values: ['key'] }, { done: false, values: ['deep'] }, { done: true, values: [true, 'one', 'two', 'three'] }];
  return JSON.stringify(seq) === JSON.stringify(exp) || JSON.stringify(seq);
});
api('host yield outside a thread / across host boundary fails cleanly', () => {
  const vm = Mote.create();
  vm.set('wait', () => vm.yield());
  let r = throws(() => vm.run('wait()'), /attempt to yield from outside a coroutine/);
  if (r !== true) return r;
  const th = vm.thread(vm.compile('table.sort({2, 1}, function(a, b) wait() return a < b end)'));
  r = throws(() => th.resume(), /attempt to yield across a host call boundary/);
  return r === true && th.status === 'dead' ? true : r;
});
api('thread args, errors, Mote coroutines returned to JS', () => {
  const vm = Mote.create();
  vm.run('function gen(a, b) local x = coroutine.yield(a + b) error("stop " .. x, 0) end');
  const th = vm.thread('gen', 1, 2);
  const r = th.resume();
  if (r.values[0] !== 3) return JSON.stringify(r);
  try { th.resume('now'); return 'no throw'; } catch (e) { if (e.message !== 'stop now' || th.status !== 'dead') return e.message; }
  const co = vm.run('return coroutine.create(function(x) coroutine.yield(x * 2) return "end" end)')[0];
  const a = co.resume(5), b = co.resume();
  return (a.values[0] === 10 && b.done && b.values[0] === 'end') || JSON.stringify([a, b]);
});
api('per-frame game loop with many threads', () => {
  const vm = Mote.create({ maxSteps: 1e4 });
  vm.set('wait', n => vm.yield(n));
  vm.run('function actor(id) local steps = 0 while true do steps = steps + 1 wait(id) if steps == 30 then return steps end end end');
  const threads = Array.from({ length: 20 }, (_, i) => vm.thread('actor', i + 1));
  let frames = 0, alive = threads.length;
  while (alive && frames < 100) {
    frames++;
    for (const th of threads) if (th.status === 'suspended') { const r = th.resume(); if (r.done) alive--; }
  }
  return (alive === 0 && frames === 31) || JSON.stringify({ alive, frames });
});
api('re-entrancy: host functions calling back into Mote', () => {
  const vm = Mote.create();
  vm.set('twice', f => f(f(1)));
  vm.set('evalStr', s => vm.run(s)[0]);
  const r = vm.run('local a = twice(function(x) return x * 3 end) local b = evalStr("return 40 + 2") return a, b');
  if (JSON.stringify(r) !== '[9,42]') return JSON.stringify(r);
  const r2 = vm.run('return pcall(evalStr, "error(\'inner\', 0)")');
  return (r2[0] === false && r2[1] === 'inner') || JSON.stringify(r2);
});
api('proxy view of tables', () => {
  const vm = Mote.create();
  vm.run('state = {score = 1, items = {"a"}}');
  const st = vm.get('state', { proxy: true });
  st.score = 99; st.items[2] = 'b';
  const r = vm.run('return state.score, #state.items, state.items[2]');
  if (JSON.stringify(r) !== '[99,2,"b"]') return JSON.stringify(r);
  vm.run('state.score = 5');
  if (st.score !== 5 || st.items.length !== 2 || Object.keys(st).join() !== 'score,items') return JSON.stringify(Object.keys(st));
  let got;
  vm.set('inspect', vm.fn(t => { got = t; t.touched = true; }, { args: 'proxy' }));
  return vm.run('local t = {1} inspect(t) return t.touched')[0] === true && got[1] === 1;
});
api('raw host functions', () => {
  const vm = Mote.create();
  vm.set('count', vm.fn(args => args.length, { args: 'raw', name: 'count' }));
  vm.set('rawarg', vm.fn(t => vm.toJS(t)[0], { args: 'raw' }));
  return vm.run('return rawarg({7})')[0] === 7;
});
api('reset clears state', () => {
  const vm = Mote.create();
  vm.run('x = 1'); vm.set('y', 2);
  vm.reset();
  return vm.run('return x, y, type(print)').join() === ',,function';
});
api('print routing and tostring', () => {
  const out = [];
  const vm = Mote.create({ print: s => out.push(s) });
  vm.run('print(1, "two", nil, 3.5) print()');
  return JSON.stringify(out) === JSON.stringify(['1\ttwo\tnil\t3.5', '']) || JSON.stringify(out);
});
api('stats', () => {
  const vm = Mote.create();
  vm.run('local t = {} for i = 1, 100 do t[i] = {} end');
  const s = vm.stats();
  return (s.steps > 300 && s.memory >= 100 * 40 && s.totalSteps >= s.steps && !s.running) || JSON.stringify(s);
});
api('vm.call errors on missing global', () => throws(() => Mote.create().call('nope'), /attempt to call a nil value \(global 'nope'\)/));

for (const [name, fn] of A) {
  if (filter && !name.includes(filter)) continue;
  let r;
  try { r = fn(); } catch (e) { r = `threw ${e && e.stack || e}`; }
  ok('api: ' + name, r === true, r === true ? '' : String(r));
}

for (const f of failures) console.log(f);
console.log(`\nMote: ${pass} passed, ${fail} failed (${P.length} programs, ${A.length} API checks)`);
process.exit(fail ? 1 : 0);

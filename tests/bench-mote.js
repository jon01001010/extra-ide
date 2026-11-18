#!/usr/bin/env node
// Mote micro-benchmarks.   node tests/bench-mote.js
'use strict';
const Mote = require('../mote.js');
const BENCH = {
  'fib(25) recursive': 'local function fib(n) if n < 2 then return n end return fib(n - 1) + fib(n - 2) end return fib(25)',
  '1e6-iteration numeric loop': 'local s = 0 for i = 1, 1e6 do s = s + i % 7 end return s',
  'table insert + sort 1e5': 'local t = {} for i = 1, 1e5 do t[#t + 1] = (i * 7919) % 100003 end table.sort(t) return t[1], t[#t]',
  'sort 1e5 with comparator': 'local t = {} for i = 1, 1e5 do t[i] = (i * 7919) % 100003 end table.sort(t, function(a, b) return a > b end) return t[1]',
  'string building (concat 1e5)': 'local s = "" for i = 1, 1e5 do s = s .. "x" end return #s',
  'string building (table.concat 1e5)': 'local p = {} for i = 1, 1e5 do p[i] = tostring(i) end return #table.concat(p, ",")',
  'method calls 1e6 (OOP)': 'local P = {} P.__index = P function P:inc() self.n = self.n + 1 end local o = setmetatable({n = 0}, P) for i = 1, 1e6 do o:inc() end return o.n',
  'closures + pairs': 'local s = 0 for r = 1, 200 do local t = {} for i = 1, 500 do t["k" .. i] = function() return i end end for k, f in pairs(t) do s = s + f() end end return s',
};
for (const [name, src] of Object.entries(BENCH)) {
  const vm = Mote.create({ maxSteps: Infinity, maxMemory: Infinity });
  vm.run(src);   // warm-up
  const t0 = process.hrtime.bigint();
  const r = vm.run(src);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`${name.padEnd(36)} ${ms.toFixed(1).padStart(8)} ms   steps ${String(vm.stats().steps).padStart(10)}   → ${r.join(', ')}`);
}

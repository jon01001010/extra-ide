# Tact packs: todo

Tact is a Lua for LLMs: a small checked core, and helpers for what a model
cannot do reliably by writing text or a few lines of code.

A pack earns its place when the model would otherwise get it wrong:
exact arithmetic, calendar rules, binary file formats, encodings and escaping,
algorithms with fiddly edge cases, numeric methods. Anything a model already
writes well as plain text (markdown, html pages, prose templates, known
formulas) stays out.

Rule for every pack: loaded only by `(use name)`, one index line in the core
spec, errors before running wherever the input is known, a result the model can
read back (text, `ascii`, or a value `check` can test), and a file a person can
open where that makes sense.

Budget: the core spec is about 11,500 of 12,000 characters. Each pack costs one
index line (~70 chars). Merge into existing packs where it fits.

## Done

- [x] **chart**: line, scatter, bar, histogram, function graphs as `(Vec Draw)`.
- [x] **svg**: `(Vec Draw)` to an svg file. `Text` in `draw`.

## 1. Models get these wrong; high value

- [x] **time** (extend): date parts, weekday, add days and months (month ends,
      leap years), days between, format with a pattern, durations. UTC and fixed
      offsets only, so results never depend on the machine.
- [x] **dec**: exact decimals for money (no 0.1 + 0.2 drift), rounding modes,
      big integers.
- [x] **diff**: edits as "here it is, there it should be", found by their text,
      never a line number. make, apply (E14 when here is missing or not found
      once, with a hint), and a unified diff for people.
- [x] **table**: (built as the query pack) group by with sum/mean/count, join on a key, pivot, multi-key
      sort, select columns, over `(Vec (Map Str Str))` or recs. Each is a fold a
      model can write, but long and easy to get subtly wrong. May fold into query.
- [x] **query**: (in memory and JSON done; SQL through a host is not built) the idea behind SQL and JQL, not their syntax: ask for data by
      saying what you want (select, where, join, group, order, limit, paths into
      JSON), and have it checked against a schema before anything runs. Unknown
      columns or fields get the nearest name; comparing a text column with a
      number, grouping without an aggregate, or joining on mismatched types are
      check errors; the result type follows from the query, so the code that uses
      it is checked too. Works on rows in memory, on JSON, and through a host on a
      real database: the host gives the schema as types, and the query is sent
      as that database's SQL with parameters, never built from strings, so no
      injection.
- [ ] **math** (extend): find a root of f, minimize f on a range, integrate f,
      seeded normal / int range / weighted pick / sample without replacement, for
      simulations and test data. Covers loans, IRR and most finance asks without
      a finance pack.

## 2. Binary formats a model cannot write as text

- [ ] **zip**: write and read zip archives, gzip. Uses the deflate in draw.
- [ ] **xlsx**: spreadsheets people open in Excel: sheets, numbers vs text,
      header row. Built on zip.
- [ ] **img**: read PNG to pixels, crop, resize, grayscale, write back. Needs inflate.
- [ ] **gif**: frames to one animated GIF, for people to watch.
- [ ] **wav**: samples to a WAV file, tones and envelopes. Sound for people,
      numbers the model can check.
- [ ] **pdf**: text and shapes to a simple PDF. Largest; last.

## 3. Small helpers, folded into existing packs

- [ ] **bytes**: url encode/decode, query strings to a map, hex, html escape.
      Escaping is the part of html a model gets wrong; the page it writes itself.
- [ ] **prop**: property checks: a predicate over N seeded inputs, report the
      first failing input, shrunk. A model testing its own code beyond examples.
- [ ] **graph**: shortest path, BFS/DFS order, topological sort with cycle report,
      connected parts. Scheduling, dependencies, routes, puzzles.

## Dropped: a model writes these directly

- md pack, html page builder, text templates, slugify, plurals, ordinals,
  unit conversion, geo formulas, finance formulas, sets.

## Lua-like tooling

- [x] **Host functions**: a host program registers its own functions with Tact
      types, and the checker checks calls to them like builtins. This is what
      makes Tact embeddable the way Lua is: the host gives the model a typed,
      checked set of tools.
- [x] `tact --fmt FILE`: one canonical layout, so diffs of model edits stay small.
- [ ] Short spec mode (~1,500 tokens) for 8k-context models.
- [ ] Measure the spec in real tokens (Llama and Claude tokenizers).
- [ ] Rerun the adversarial agent on everything added since its last pass.

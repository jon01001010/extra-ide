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
- [x] **math** (extend): find a root of f, minimize f on a range, integrate f,
      seeded normal / int range / weighted pick / sample without replacement, for
      simulations and test data. Covers loans, IRR and most finance asks without
      a finance pack.

## 2. Binary formats a model cannot write as text

- [x] **zip**: write and read zip archives, gzip. Uses the deflate in draw.
- [x] **xlsx**: spreadsheets people open in Excel: sheets, numbers vs text,
      header row. Built on zip.
- [x] **img**: read PNG to pixels, crop, resize, grayscale, write back. Needs inflate.
- [x] **gif**: frames to one animated GIF, for people to watch.
- [x] **wav**: samples to a WAV file, tones and envelopes. Sound for people,
      numbers the model can check.
- [x] **pdf**: text and shapes to a simple PDF. Largest; last.

## 3. Small helpers, folded into existing packs

- [x] **bytes**: url encode/decode, query strings to a map, hex, html escape.
      Escaping is the part of html a model gets wrong; the page it writes itself.
- [x] **prop**: property checks: a predicate over N seeded inputs, report the
      first failing input, shrunk. A model testing its own code beyond examples.
- [x] **graph**: shortest path, BFS/DFS order, topological sort with cycle report,
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
- [x] Rerun the adversarial agent on everything added since its last pass.

## Context-only: the model is the runtime

Findings (Nov 20): exact over 120 records on three model sizes. Over 2,000
records with messy values, Haiku in chunks of ~288 got about half the final
values wrong by small amounts and reported them as finished. The limit is the
number of steps, and timestamp conversion is the riskiest step.

- [x] Readme and spec say first that Tact is context-only; packs that need the
      interpreter are marked `*`.
- [x] Readme states the measured limits and the habits that follow: count the
      steps, reconcile every tally and report both numbers, keep a written
      table, compare text exactly, keep dates as iso text.
- [x] `date.daynum` for day counts from iso text, with the by-hand method in
      the time pack's notes.
- [ ] Audit every spec row for precision: ties, rounding, order, empty input,
      so two models cannot reasonably work out different answers.
- [x] A reasoning procedure for large data, from the measurements: batches of
      about 50, mergeable partial results (`q.merge`), a second pass, one date
      per batch checked against an anchor, a reconciliation. In the readme.
      Measured before these changes: Haiku at ~50 per batch was exact on 38 of
      40 batches and 22 of 25 final values; at ~288 on no batch.
- [x] Run, db, run, db: the `db` pack. A db file is Tact, `(let name value)`
      lines loaded with `(use "state.tact")`, so names and types are checked
      up front; `db.let` and `db.text` write values exactly. Each run is one
      batch in a fresh context. Shown on the interpreter: 41 runs of 50 over
      2,015 trapped tickets give the same answers as one run.
- [x] First run of the db loop with a model as the runtime (Nov 21): six
      chained runs of 50 records, a fresh Haiku each, told to run no code,
      iso dates, the readme's procedure, the anchors. All 30 values exact
      against the interpreter redoing each step. One sample per batch; 300
      of 2,015 records; "no code" rests on the models' own tool reports.
- [ ] Run all 41 batches, and repeat, to get a rate and not one sample.
- [x] The db grew: the lists kept for medians were copied by every run
      (about 1,000 numbers by the last). Decided: no run needs another.
      Run n reads only its batch and writes only `part-n.tact` (300 to 600
      bytes here); a merge step folds parts into `total.tact`, adding and
      joining only. Runs go in any order or at once, a slip stays in its
      part, any part is redone alone. Shown on the interpreter: 41 runs at
      once, merged in scrambled order, same answers as one run. Chaining is
      kept only for a batch that truly needs an earlier result.
- [x] Modularity in the program too: a file names its own packs (E1 when
      it leans on a pack another file loaded), so each file is checked
      alone and a run is given only the files it uses.
- [x] Private names in a file: a let or fn whose name starts with `_`
      stays in its file. Not seen by the loader (E1 says it is private and
      to which file), no clash, left out of `--sigs`. Recs and sums are
      still always public.
- [x] Pictures in reasoning: pixels as plain data, rows of `[r g b]`.
      `px.svg` is text a model can write itself; `px.img` and `img.px` join
      it to the Image functions. An example makes one picture both ways:
      one pixel after another, and all at once from noise in steps.
- [ ] Have a model make a 16 x 16 picture in reasoning, both ways, and
      compare its svg text with the interpreter's.
- [ ] Run the independent parts with a model as the runtime (the Haiku
      runs so far used the chained design). Each part is compared with the
      interpreter's part for that batch alone.
- [x] Run the db loop with a model as the runtime: each run reads the db
      file, works one batch in reasoning, writes the db file. Compare each
      db file with the interpreter's, to find the batch where a slip happens.
      (Done for six chained runs, above.)
- [ ] Retest Haiku at 2,000 records with the readme's procedure, iso dates
      and the anchors. The two errors that survived batches of 50 were a
      record with two traps at once and a wrong month table for one batch.
- [ ] Try a batch size between 50 and 288, and repeat runs to measure
      variance: each setup has run once.
- [ ] Test Haiku on writing programs.
- [ ] Test Sonnet and Opus in context at 2,000 records.
- [ ] Data shaped for reasoning: a guide for whoever supplies the data (iso
      dates, day numbers, trimmed and cased values, no duplicates).

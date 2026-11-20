# Tact packs: todo

Rule for every item: loaded only by `(use name)`, one index line in the core spec,
errors before running wherever the input is known, output an LLM can read back
(text, `ascii`, or a value `check` can test), and a file a person can open.

Budget: the core spec is 11,431 of 12,000 characters. Each new pack costs one
index line (~70 chars), so about 8 more fit. Merge small packs or raise the
budget before adding more.

## 1. Most asked for, high value

- [ ] **time** (extend): date parts (year month day weekday), add days/months,
      difference in days, format with a pattern, durations. UTC and fixed
      offsets only, so results never depend on the machine.
- [ ] **table**: rows as `(Vec (Map Str Str))` or recs. group by + sum/mean/count,
      join two tables on a key, pivot, sort by several keys, select columns.
      The everyday "analyse this spreadsheet" request.
- [x] **chart**: line, bar, scatter, histogram to `(Vec Draw)` with axes, ticks
      and labels. People see the PNG; the model reads it with `ascii`.
      Also `chart.fn` graphs a function. `Text` added to `draw`.
- [x] **svg**: `(Vec Draw)` to an SVG string. Sharp charts and diagrams for people,
      plain text for the model.
- [ ] **html**: escape, and an element builder that escapes by construction,
      so a generated page cannot be broken by its data. Reports and small tools.
- [ ] **dec**: exact decimals for money (no 0.1 + 0.2 drift), rounding modes,
      and big integers. Floats are wrong for invoices and totals.
- [ ] **diff**: line diff of two texts, unified patch out, apply a patch back.
      How a model shows and makes changes to files.

## 2. Often asked for

- [ ] **xlsx**: write a spreadsheet people open in Excel (sheets, numbers vs text,
      header row). Built on the zip writer below.
- [ ] **zip**: write and read zip archives, gzip. Uses the deflate already in draw.
- [ ] **url** (into bytes): url encode/decode, query strings, hex, html entities.
- [ ] **fill** (into text): templates "Hello {name}" from a map, slugify,
      thousands separators, plural, ordinal ("1st").
- [ ] **rnd** (into math): seeded normal, whole numbers in a range, weighted pick,
      sample without replacement. Simulations and test data.
- [ ] **prop**: property checks: run a predicate over N seeded inputs, report the
      first failing input, shrunk. Lets a model test its own code beyond examples.
- [ ] **graph**: shortest path, BFS/DFS, topological sort, connected parts.
      Scheduling, dependencies, routes, puzzles.
- [ ] **set** (into core or map): union, intersect, difference over sorted vectors.

## 3. Useful, bigger or narrower

- [ ] **img**: read PNG to pixels, crop, resize, grayscale, write back. Needs inflate.
- [ ] **gif**: frames to one animated GIF, so people can watch what `io.frame` made.
- [ ] **wav**: samples to a WAV file, tones and envelopes. Sound for people,
      numbers the model can check.
- [ ] **geo**: haversine distance, bearing, polygon area and point-in-polygon.
- [ ] **fin**: loan payment, NPV, IRR, compound growth, amortization table.
- [ ] **unit**: convert lengths, masses, temperatures, data sizes; errors on
      mismatched kinds (metres to kilograms) before running.
- [ ] **pdf**: text and shapes to a simple PDF. Large; after svg and chart.

## Tooling, not packs

- [ ] `tact --fmt FILE`: one canonical layout, so diffs of model edits stay small.
- [ ] Short spec mode (~1,500 tokens) for 8k-context models.
- [ ] Measure the spec in real tokens (Llama and Claude tokenizers), not chars / 3.5.
- [ ] Rerun the adversarial agent on everything added since its last pass.

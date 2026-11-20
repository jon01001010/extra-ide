# Building the Emit IDE

The IDE is one self-contained page, `emit-ide-1_32.html`: open it from the phone's file system or any
browser, no server, works offline. Its source is in `src/`; the page is built from it and committed too
(it is the file people download).

## Edit

* `src/index.html` is the page. Each line `<!--#include file="…" -->` stands for a file of `src/`, inserted
  as it is; `<!--#note … -->` lines are comments for editors and are left out of the page.
* `src/css/` styles, `src/html/` body markup (the app and the help), `src/js/` the scripts. Where things are,
  and which definition of a function runs: **docs/SOURCE-MAP.md**.
* The files inside one `<script>` element are a single script cut into pieces: keep a statement in one file,
  keep the order. A new file goes into `index.html` where it must run.
* Inside a script, write `<\/script` for `</script` (the build refuses the latter).
* Do not edit `emit-ide-1_32.html` by hand: the next build overwrites it.
* Mote is not in `src/`: it is `mote.js` at the top of the repository (see `tools/build-mote-html.js`).

## Build

```
node tools/build.js           # writes emit-ide-1_32.html, then runs tools/build-mote-html.js (keeps mote.html current)
node tools/build.js --check   # exit 1 if emit-ide-1_32.html or a Mote page differs from a fresh build
```

Plain Node, no `npm install`. Commit `src/` and the rebuilt `emit-ide-1_32.html` together; run
`--check` before committing.

## Test

The suites in `tests/` load `emit-ide-1_32.html`, so build first. They use Node and Playwright (with its
Chromium), and `tests/node_modules` for offline copies of the CDN libraries.

```
node tests/run-examples.js
node tests/run-bytes.js                          # compiled WASM byte identity against an older commit
node tests/run-bytes.js emit-ide-1_32.html HEAD  # … against the last commit: a refactor must keep every program identical
```

Run a few suites at a time, not all in one command (`timeout 900 node tests/run-….js`). The suites
are: run-examples, run-interop, run-modules, run-project, run-regions, run-memtab, run-memory, run-loader,
run-autocomplete, run-combined, run-registry, run-drawer, run-sound, run-bytes, run-sprites, run-sprite-tool,
run-maps, run-stage-tool, run-integ, run-rules, run-logic-tool, run-rough, run-timeline, run-mote,
run-mote-page, run-mote-emit, run-tutorial, run-live, run-nocase, run-hud, run-particles, run-export (long; read its last lines: a
failing category may not change the exit code). Some suites read older commits with `git show`, so run them
in the git checkout. Suites rewrite screenshots in `tests/`; `git checkout -- tests/*.png` afterwards
unless the change is meant to alter them.

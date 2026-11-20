# Emit IDE: source map

`emit-ide-1_32.html` is built from `src/` by `node tools/build.js` (see BUILDING.md). This file says where
things live in `src/` and how the pieces depend on each other. Paths below are relative to `src/js/` unless
they start with `src/`, `css/` or `html/`.

## How the page runs

The page has **nine executing `<script>` elements** plus one non-executing one (Mote). They are classic scripts
sharing one global scope and run in page order. Several files in `src/` make up one script: the files of a
script are only a split of one text, so top-level `function` declarations are hoisted across all of them (for
example `ide/lib-cache.js` wraps `compileAndRun`, which `ide/run.js` declares further down the same script).

| # | `src/index.html` element | Files (in order) |
|---|---|---|
| | `<style>` | `css/ide.css` |
| | body markup | `html/app.html` (header, editor, output, status bar, overlays), `html/help.html` (the `?` reference) |
| 1 | `<script>` | `examples.js`, `compiler/*` (core … things-rules, hudfx), `ide/editor.js`, `compiler/wasm-rewrite.js`, `runtime/*` (core … things, hudfx, toplevel), `compiler/toplevel.js`, `compiler/call-args.js`, `compiler/declared-types.js`, `runtime/loader.js`, `ide/*` (lib-cache … regions-editor), `drawer/drawer.js`, `drawer/sound-music.js`, `drawer/sprite.js` |
| 2 | `<script>` | `maps-controls/compiler-editor.js`, `maps-controls/stage.js`, `maps-controls/controls.js` |
| 3 | `<script>` | `drawer/logic.js`, `drawer/hudfx.js` |
| 4 | `<script>` | `drawer/integration.js` |
| | `<style>` | `css/timeline.css` |
| 5 | `<script>` | `ide/timeline.js` |
| 6 | `<script>` | `drawer/script-mote.js` |
| 7 | `<script>` | `ide/tutorial.js` |
| 8 | `<script>` | `nocase.js` |
| | `<script type="text/plain" id="mote-src">` | `mote.js` from the repository root, put between `MOTE:BEGIN` / `MOTE:END` by the build |
| 9 | `<script>` (inline in index.html) | `_libSnapshotGlobals()`: records the IDE's own globals (library autocomplete leaves them out) |

Load-time order matters in two places:

* **Startup** is the `(async function(){ … loadFromURL() … _projLoad(…) })()` line in `ide/editor.js`. Its
  `await` makes the project load run after script 1 has finished but before script 2 starts (microtask
  checkpoint between scripts). Code that must see the loaded project at startup belongs in a later script.
* **Wrappers.** A later file (or script) replaces a function by one that calls the previous one
  (`f=(function(f0){return function(){… f0.apply(this,arguments) …}})(f)`, or `var x0=P.x; P.x=function(){… x0 …}`).
  The definition that runs is the **last one in page order**. See the table below.

Script boundaries are kept as they were: a later script runs only after everything above has finished,
including the startup microtask. Do not merge scripts.

## Files

### Examples
* `examples.js`: `const EX = {…}` (the bundled examples: the example menu) plus `EX.sfx`, `EX.game`. More
  examples are added next to their features: `EX.sprites` (drawer/sprite.js), `EX.stage`
  (maps-controls/compiler-editor.js), `EX.mote` (drawer/script-mote.js).

### Compiler (`compiler/`)
| File | Content |
|---|---|
| `core.js` | Tokens (`TT`, `KW`, `TY`), `Lexer`, AST classes, `Parser`, `TypeAnnotator`, `TypeChecker`, `WasmCodegen` (opcodes, encoder). The class bodies are long single lines; many methods are wrapped later. |
| `js-interop.js` | The `js` type: interop codegen helpers (`genJs*`), `BUILTINS`, `injectBuiltins`, int/num conversions (`genNatural`). |
| `await-try.js` | `await`, `try / catch / finally / throw`, `arr`. |
| `modules.js` | One file = one module: `_emitModFront` (split bundle, lex), `_emitModLink` (link, rename, diagnostics), and `var compile=function(source,target)`, the compiler entry point that every later `compile` wraps. |
| `regions.js` | `struct` / `region`: syntax, layout, lowering (`_rgLower`), types, codegen. |
| `sprites.js` | `sprite` blocks (compiler half). |
| `sound.js` | `sound` / `music` blocks (compiler half), and `_emitScanBlocks`, the block scanner every block kind and the drawer share. |
| `mote.js` | `script` blocks and the Mote builtins (compiler half). |
| `things-rules.js` | `thing` / `rules:` blocks lowered to ordinary Emit (`_lgLower`), across files. |
| `hudfx.js` | `hud` / `particles` blocks (compiler half): `_hudParse` / `_fxParse` (also used by the tools), `_hudWrite` / `_fxWrite`, the builtins hud hudOn hudOff say burst emitter moveEmitter stopEmitter, their names and the HUD's variables checked in the linker, `imports.hudMeta` / `imports.fxMeta`. |
| `wasm-rewrite.js` | Post-processing of the finished module: `_emitExportGlobals` (globals exported for the lifetime GC) and `_emitAwaitRoots` (await shadow stack), hooked into `WasmCodegen#encodeBinary`. |
| `toplevel.js` | Top-level values (non-literal initialisers, `__emitInit.*`). |
| `call-args.js` | Call argument checks. |
| `declared-types.js` | Declared types and operator checks. |

`maps-controls/compiler-editor.js` (script 2) is the compiler half of `map` / `controls` blocks plus their
editor highlighting and the `EX.stage` example; `nocase.js` (script 8) makes every Emit name case-insensitive
(`_ncCanon` runs over the whole bundle first: the **outermost `compile` wrapper**).

### Runtime (`runtime/`): copied into exported programs
| File | Content |
|---|---|
| `core.js` | Starts with `//#emit-runtime-begin`. Canvas/graphics state, `buildImportObject` (the `std` builtins), JS interop handle table, LIFETIME (handles, strings, arrays released when unreachable), `//#emit-nocase-begin/end` (`_ncProp`, `_ncExport`), callbacks (`fnRef`), await (JSPI), try / catch, arrays as values. |
| `regions.js` | Memory regions (runtime half) and the introspection used by the Memory tab. |
| `sound.js` | Sound and music synth. |
| `sprites.js` | Sprite drawing. |
| `maps.js` | Maps and the on-screen controls overlay. |
| `things.js` | Things and rules (runtime half). |
| `hudfx.js` | Particles (`_fxWorld`, between `//#emit-fx-begin/end`) and the HUD (`_hudPaintSpec`, the 5×7 pixel font, say; between `//#emit-hud-begin/end`), drawn after each frame / at the end of `_lgDraw` / after a screen blit. |
| `toplevel.js` | Top-level values (runtime half). Ends with `//#emit-runtime-end`. |
| `loader.js` | The library loader (`use …`), a second `//#emit-runtime-begin … end` section; inside it `//#emit-mote-begin/end` (twice: the Mote builtin text and the Mote runtime half: `moteVM`, `moteRun`, …). Its first lines (before the marker) are a compiler hook: the lexer must not see the rest of a `use` line. |

### IDE (`ide/`)
| File | Content |
|---|---|
| `editor.js` | Editor globals (`ed`, `gutter`, `hlInner`), keyword sets, `hlCode` (highlighter), scroll sync, **startup** (load from URL / localStorage, welcome), cursor position, `jumpToLine`, find/replace entry points, `updGutter`, `showView`, `showOTab`, `ins`, `setStatus`, `h`, `sp`. |
| `lib-cache.js` | Offline cache of library files (Cache API / IndexedDB), the libraries panel cache lines. |
| `run.js` | `compileAndRun`, the output-panel helpers, panel layout at load, `newFile`. |
| `libraries.js` | `LIBS` (the library registry) and `_LIB_EXAMPLES`. |
| `lib-vocab.js` | Library vocabulary: autocomplete from the loaded JS libraries (`_libAC*`, browse panel). |
| `autocomplete.js` | The autocomplete popup (`showAC`, `pickAC`), builtin and method completion, `checkAC`. |
| `panels.js` | Help, snippets (`SNIPPETS`), libraries panel, share (`LZ`, `shareURL`, `loadFromURL`), `stopProgram`, `importFile`. |
| `export.js` | `.html` / `.js` / `.wasm` export: `_exportRuntime` collects the `//#emit-runtime-*` sections from `document.scripts`, `_emitExportBoot`. |
| `export-offline.js` | `.html (offline)`: libraries, stylesheets and modules embedded. |
| `project.js` | Projects (several files): file tabs, undo per file, run source, errors across files, module autocomplete, the find bar, opening files. |
| `memory-tab.js` | The Memory tab (regions as a front panel) and tappable `at file:line:col` in runtime errors. |
| `regions-editor.js` | Highlighting and autocomplete for `struct` / `region`. |
| `timeline.js` (script 5) | The Timeline: records every frame, scrub, step, poke, resume. |
| `tutorial.js` (script 7) | The guided tour. |

### Drawer and its tools
| File | Content |
|---|---|
| `drawer/drawer.js` | The drawer (`_drawerRegister`, `_drawerToolList`), blocks in the program text, tool UI helpers (`_drwEl`, `_drwBtn`, `_drwSeg`, `_drwSlider`). |
| `drawer/sound-music.js` | Sound and Music tools, sound/music blocks in the editor. |
| `drawer/sprite.js` | Sprites in the editor, `EX.sprites`, the SPRITE tool. |
| `maps-controls/stage.js` (script 2) | The STAGE tool (map painter). |
| `maps-controls/controls.js` (script 2) | The CONTROLS tool. |
| `drawer/logic.js` (script 3) | The LOGIC tool (`thing` / `rules:` blocks). |
| `drawer/hudfx.js` (script 3) | The HUD and PARTICLES tools, highlighting and autocomplete of their blocks and builtins, `_hudLastFrame` (the HUD tool's preview background). |
| `drawer/integration.js` (script 4) | The Memory card of the drawer, Memory tab ↔ tool links. |
| `drawer/script-mote.js` (script 6) | Mote in the editor, the SCRIPT tool, `EX.mote`. |

## Marked regions

These markers are found by text at run time or by tools; keep each one on a line of its own and in the
same order. The build does not look at them.

| Marker | Where | Used by |
|---|---|---|
| `//#emit-runtime-begin` / `//#emit-runtime-end` | `runtime/core.js` … `runtime/toplevel.js`; `runtime/loader.js` | `_exportRuntime` (ide/export.js) copies each section into exported pages. It searches for `"\n" + marker`, so a marker must not be the first character of a script. |
| `//#emit-mote-begin` / `//#emit-mote-end` | `runtime/loader.js` (two pairs) | Removed from exports of programs without Mote. |
| `//#emit-nocase-begin` / `//#emit-nocase-end` | `runtime/core.js` | Removed from exports of programs without JS interop. |
| `//#emit-fx-begin` / `//#emit-fx-end` | `runtime/hudfx.js` | Removed from exports of programs without particles (no `importProps.fxMeta`). |
| `//#emit-hud-begin` / `//#emit-hud-end` | `runtime/hudfx.js` | Removed from exports of programs without a HUD or say() (no `importProps.hudMeta`). |
| `<!-- MOTE:BEGIN … -->` / `<!-- MOTE:END -->` | `src/index.html` (empty there) | `tools/build.js` and `tools/build-mote-html.js` put `mote.js` in between, as `<script type="text/plain" id="mote-src" data-emit-builtin="emit:mote">`. |

## Wrapper chains (which definition runs)

Every function that is defined more than once at load time, in page order. **The last one is the one that
runs** (this was checked in a headless page by comparing each live function's `toString()` with the source,
61 of 62 chains). The exception is `_drawerRegister`: the three later definitions are fallbacks guarded by
`if(typeof _drawerRegister!=='function')` for a tool loaded without the drawer; in this page the first
(drawer/drawer.js) always runs.

`function` = declaration, `class` = method in a class body, `var` = `var x=function`, `wrap` =
`x=(function(x0){…})(x)`, `assign` = `x=function(){…}`, which usually still calls the previous version it
saved in a local first (`var tokenize0=Lexer.prototype.tokenize`). `A#m` means `A.prototype.m`.

They were left as chains on purpose: folding one means re-ordering code across features (and scripts), with
little gain, while the chain order is part of the behaviour (e.g. the case-insensitive names rewrite,
`_ncCanon`, must see the source before anything else, so it is the outermost `compile` wrapper).

| Function | Defs | In page order |
|---|---|---|
| `_jsConvFn` | 2 | compiler/core.js:123 (function) → compiler/await-try.js:44 (wrap) |
| `injectBuiltins` | 3 | compiler/js-interop.js:470 (function) → compiler/regions.js:168 (wrap) → maps-controls/compiler-editor.js:387 (wrap) |
| `_emitModFront` | 2 | compiler/modules.js:150 (function) → compiler/things-rules.js:990 (wrap) |
| `_emitModLink` | 9 | compiler/modules.js:242 (function) → compiler/regions.js:163 (wrap) → compiler/sound.js:129 (wrap) → compiler/mote.js:125 (wrap) → compiler/things-rules.js:998 (wrap) → compiler/things-rules.js:1133 (wrap) → compiler/hudfx.js:307 (wrap) → compiler/toplevel.js:117 (wrap) → drawer/integration.js:16 (wrap) |
| `_rgLower` | 2 | compiler/regions.js:170 (function) → compiler/sprites.js:268 (wrap) |
| `_lgLower` | 2 | compiler/things-rules.js:333 (function) → compiler/things-rules.js:986 (wrap) |
| `hlCode` | 5 | ide/editor.js:16 (function) → drawer/sound-music.js:484 (wrap) → drawer/sprite.js:72 (wrap) → drawer/hudfx.js:409 (wrap) → drawer/script-mote.js:40 (wrap) |
| `showView` | 2 | ide/editor.js:130 (function) → ide/memory-tab.js:393 (wrap) |
| `showOTab` | 2 | ide/editor.js:131 (function) → ide/memory-tab.js:392 (wrap) |
| `_jsErr` | 4 | runtime/core.js:683 (function) → runtime/core.js:1579 (wrap) → runtime/toplevel.js:31 (wrap) → ide/timeline.js:522 (wrap) |
| `_resetJsInterop` | 2 | runtime/core.js:790 (function) → runtime/core.js:1757 (wrap) |
| `buildImportObject` | 10 | runtime/core.js:795 (function) → runtime/core.js:1761 (wrap) → runtime/regions.js:222 (wrap) → runtime/sound.js:371 (wrap) → runtime/sprites.js:155 (wrap) → runtime/maps.js:199 (wrap) → runtime/things.js:169 (wrap) → runtime/hudfx.js:105 (wrap) → runtime/hudfx.js:246 (wrap) → ide/timeline.js:525 (wrap) |
| `_emitEnter` | 2 | runtime/core.js:1585 (function) → runtime/core.js:1627 (wrap) |
| `_emitCallExport` | 8 | runtime/core.js:1606 (function) → runtime/core.js:1637 (wrap) → runtime/regions.js:228 (wrap) → runtime/hudfx.js:96 (wrap) → runtime/hudfx.js:237 (wrap) → runtime/toplevel.js:35 (wrap) → ide/memory-tab.js:401 (wrap) → ide/timeline.js:516 (wrap) |
| `_emitFrame` | 4 | runtime/core.js:1645 (function) → runtime/regions.js:233 (wrap) → runtime/maps.js:205 (wrap) → ide/timeline.js:504 (wrap) |
| `_emitExtraImport` | 4 | runtime/core.js:1707 (function) → runtime/regions.js:208 (wrap) → runtime/sprites.js:127 (wrap) → runtime/things.js:134 (wrap) |
| `_emitRegionWrite` | 2 | runtime/regions.js:161 (function) → ide/timeline.js:539 (wrap) |
| `_rgBlit1` | 3 | runtime/regions.js:71 (function) → runtime/hudfx.js:104 (wrap) → runtime/hudfx.js:245 (wrap) |
| `_hudPaint` | 2 | runtime/hudfx.js:225 (function) → drawer/hudfx.js:12 (wrap) |
| `_lgDraw` | 4 | runtime/things.js:71 (function) → runtime/hudfx.js:103 (wrap) → runtime/hudfx.js:244 (wrap) → ide/timeline.js:521 (wrap) |
| `compileAndRun` | 6 | ide/run.js:3 (function) → ide/lib-cache.js:124 (assign) → ide/memory-tab.js:394 (wrap) → drawer/drawer.js:249 (wrap) → ide/timeline.js:544 (wrap) → ide/tutorial.js:629 (wrap) |
| `_libACPick` | 3 | ide/lib-vocab.js:251 (function) → ide/project.js:499 (assign) → ide/regions-editor.js:161 (wrap) |
| `checkAC` | 5 | ide/autocomplete.js:165 (function) → ide/regions-editor.js:153 (wrap) → drawer/sound-music.js:535 (wrap) → drawer/sprite.js:136 (wrap) → drawer/hudfx.js:427 (wrap) |
| `stopProgram` | 5 | ide/panels.js:205 (function) → ide/panels.js:206 (wrap) → ide/memory-tab.js:399 (wrap) → drawer/drawer.js:253 (wrap) → ide/timeline.js:548 (wrap) |
| `doExport` | 2 | ide/export-offline.js:283 (function) → drawer/drawer.js:246 (wrap) |
| `_memCardHead` | 2 | ide/memory-tab.js:108 (function) → drawer/integration.js:44 (wrap) |
| `_memLive` | 2 | ide/memory-tab.js:249 (function) → ide/timeline.js:549 (wrap) |
| `_drawerRegister` | 4 | drawer/drawer.js:22 (function) → drawer/sprite.js:647 (assign) → maps-controls/compiler-editor.js:414 (assign) → drawer/logic.js:9 (assign) |
| `Lexer#skip` | 2 | compiler/core.js:6 (class) → compiler/sound.js:71 (assign) |
| `Lexer#id` | 2 | compiler/core.js:6 (class) → runtime/loader.js:3 (assign) |
| `Lexer#tokenize` | 9 | compiler/core.js:6 (class) → compiler/core.js:11 (assign) → compiler/await-try.js:52 (assign) → compiler/modules.js:45 (assign) → compiler/regions.js:64 (assign) → compiler/sprites.js:229 (assign) → compiler/mote.js:93 (assign) → compiler/things-rules.js:43 (assign) → maps-controls/compiler-editor.js:241 (assign) |
| `Parser#parse` | 2 | compiler/core.js:27 (class) → compiler/things-rules.js:337 (assign) |
| `Parser#parseTop` | 9 | compiler/core.js:27 (class) → compiler/modules.js:91 (assign) → compiler/regions.js:115 (assign) → compiler/sprites.js:244 (assign) → compiler/sound.js:97 (assign) → compiler/mote.js:108 (assign) → compiler/things-rules.js:109 (assign) → compiler/hudfx.js:275 (assign) → maps-controls/compiler-editor.js:260 (assign) |
| `Parser#parseType` | 2 | compiler/core.js:27 (class) → compiler/regions.js:150 (assign) |
| `Parser#parseStmt` | 7 | compiler/core.js:27 (class) → compiler/await-try.js:62 (assign) → compiler/regions.js:128 (assign) → compiler/sprites.js:254 (assign) → compiler/sound.js:111 (assign) → compiler/mote.js:118 (assign) → maps-controls/compiler-editor.js:270 (assign) |
| `Parser#parseUnary` | 2 | compiler/core.js:27 (class) → compiler/await-try.js:99 (assign) |
| `Parser#parsePrimary` | 2 | compiler/core.js:27 (class) → compiler/core.js:76 (assign) |
| `TypeAnnotator#want` | 2 | compiler/core.js:163 (class) → compiler/await-try.js:108 (assign) |
| `TypeAnnotator#jsArg` | 2 | compiler/core.js:184 (class) → compiler/await-try.js:113 (assign) |
| `TypeAnnotator#recv` | 2 | compiler/core.js:186 (class) → compiler/await-try.js:114 (assign) |
| `TypeAnnotator#fail` | 2 | compiler/core.js:189 (class) → compiler/modules.js:120 (assign) |
| `TypeAnnotator#annotate` | 5 | compiler/core.js:204 (class) → compiler/await-try.js:246 (assign) → compiler/toplevel.js:51 (assign) → compiler/call-args.js:79 (assign) → compiler/declared-types.js:21 (assign) |
| `TypeAnnotator#walk` | 4 | compiler/core.js:240 (class) → compiler/await-try.js:223 (assign) → compiler/regions.js:602 (assign) → compiler/declared-types.js:82 (assign) |
| `TypeAnnotator#a` | 7 | compiler/core.js:288 (class) → compiler/await-try.js:130 (assign) → compiler/regions.js:572 (assign) → compiler/sprites.js:407 (assign) → compiler/mote.js:212 (assign) → compiler/call-args.js:16 (assign) → compiler/declared-types.js:88 (assign) |
| `TypeChecker#err` | 2 | compiler/core.js:446 (class) → compiler/modules.js:124 (assign) |
| `TypeChecker#check` | 2 | compiler/core.js:446 (class) → compiler/toplevel.js:70 (assign) |
| `TypeChecker#cn` | 4 | compiler/core.js:446 (class) → compiler/await-try.js:303 (assign) → compiler/regions.js:618 (assign) → compiler/toplevel.js:76 (assign) |
| `TypeChecker#inf` | 6 | compiler/core.js:446 (class) → compiler/core.js:457 (assign) → compiler/await-try.js:298 (assign) → compiler/regions.js:607 (assign) → compiler/sprites.js:435 (assign) → compiler/toplevel.js:84 (assign) |
| `TypeChecker#compat` | 3 | compiler/core.js:446 (class) → compiler/core.js:451 (assign) → compiler/await-try.js:293 (assign) |
| `WasmCodegen#j2w` | 3 | compiler/core.js:467 (class) → compiler/js-interop.js:76 (assign) → compiler/await-try.js:313 (assign) |
| `WasmCodegen#emit` | 2 | compiler/core.js:467 (class) → compiler/await-try.js:317 (assign) |
| `WasmCodegen#generate` | 9 | compiler/core.js:467 (class) → compiler/await-try.js:335 (assign) → compiler/regions.js:795 (assign) → compiler/sprites.js:499 (assign) → compiler/things-rules.js:1156 (assign) → compiler/hudfx.js:417 (assign) → compiler/toplevel.js:96 (assign) → maps-controls/compiler-editor.js:390 (assign) → ide/timeline.js:45 (wrap) |
| `WasmCodegen#genFunc` | 2 | compiler/core.js:467 (class) → compiler/await-try.js:323 (assign) |
| `WasmCodegen#genStmt` | 4 | compiler/core.js:467 (class) → compiler/await-try.js:448 (assign) → compiler/regions.js:778 (assign) → compiler/toplevel.js:102 (assign) |
| `WasmCodegen#genExpr` | 3 | compiler/core.js:467 (class) → compiler/js-interop.js:141 (assign) → compiler/call-args.js:87 (assign) |
| `WasmCodegen#genBinary` | 2 | compiler/core.js:503 (class) → compiler/things-rules.js:962 (assign) |
| `WasmCodegen#exprResType` | 5 | compiler/core.js:503 (class) → compiler/js-interop.js:182 (assign) → compiler/await-try.js:560 (assign) → compiler/regions.js:790 (assign) → compiler/sprites.js:495 (assign) |
| `WasmCodegen#encodeBinary` | 4 | compiler/core.js:503 (class) → compiler/regions.js:808 (assign) → compiler/wasm-rewrite.js:35 (assign) → compiler/wasm-rewrite.js:274 (assign) |
| `WasmCodegen#genNatural` | 4 | compiler/js-interop.js:82 (assign) → compiler/await-try.js:514 (assign) → compiler/regions.js:766 (assign) → compiler/sprites.js:463 (assign) |
| `compile` | 8 | compiler/modules.js:572 (var) → compiler/regions.js:814 (wrap) → compiler/sprites.js:507 (wrap) → compiler/sound.js:216 (wrap) → compiler/mote.js:202 (wrap) → compiler/hudfx.js:419 (wrap) → maps-controls/compiler-editor.js:397 (wrap) → nocase.js:391 (wrap) |
| `_ncProp` | 2 | runtime/core.js:694 (var) → runtime/core.js:697 (assign) |
| `_ncExport` | 2 | runtime/core.js:694 (var) → runtime/core.js:718 (assign) |
| `_tlShow` | 2 | ide/timeline.js:287 (function) → ide/tutorial.js:630 (wrap) |
| `_tlResume` | 2 | ide/timeline.js:340 (function) → ide/tutorial.js:631 (wrap) |

## Removed in the cleanup (were dead)

* The original single-file `function compile(source,target)` and `var _emitCompileSingle=compile` (never
  read): the module compiler (`compiler/modules.js`) replaced it before anything could call it.
* Class-body methods replaced in the same script by plain prototype assignments that do not call them:
  `Parser#parsePostfix`, `Parser#parseParams`, `WasmCodegen#inferOpType`.
* Unused helpers: `insertMethod` (libraries panel), `_ST_KINDS` / `_ST_HEAD` (maps), `_tlEsc` (timeline).

## Known leftovers (kept on purpose)

* `_strScratchSlots`, `_strScratchSize`, `_strScratchIdx` (runtime/core.js) are no longer read; they are in the
  exported runtime, so they were left as they are.
* The `_drawerRegister` fallbacks (above) are dead in this page but are the documented way a tool registers
  itself (drawer/drawer.js header).
* `ide/editor.js` starts with the comment "EX is injected by build script before this file": historical; `EX`
  is in `examples.js`, the file before it in the same script.
* Test hooks such as `root._spt` (sprite tool), `_memStats`, `_timelineConfig` are used by `tests/` only.

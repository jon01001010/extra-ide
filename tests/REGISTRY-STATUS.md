# Library registry status

What `use <name>` does for each of the 47 entries of the `LIBS` registry in `emit-ide-1_32.html`,
as measured by `node tests/run-registry.js` (headless Chromium, software WebGL).

**Read this first — what the results do and do not prove**

- The CDNs (jsDelivr, cdnjs, unpkg, cdn.babylonjs.com) are not reachable from the test sandbox. Every
  library was installed from npm at the registry's version and the runner answers the registry URL with
  the corresponding file from `tests/node_modules`. So the table says "this file, loaded by the IDE,
  works"; it does **not** prove that the CDN URL resolves. For jsDelivr `…/npm/<pkg>@<ver>/<path>` URLs
  the path is literally a file of the npm package, so those are as good as verified. For **cdnjs** URLs
  (15 entries) the file name on cdnjs was matched to the npm dist file by convention and could not be
  checked. The five URLs in "Unverified URLs" below are the ones most worth opening in a browser once.
- "works" means: the library loads with no error, its global appears, a small Emit program makes real
  calls into it through the interop and prints the expected values, and every name in the entry's
  catalogue exists. It does not mean the whole library API is usable from Emit — see "Interop problems".
- Nothing was judged by eye. Rendering libraries were checked through their object model (a chart has
  3 bars, a canvas exists, a scene has 1 mesh), not by looking at pixels.

## Summary

| | count |
|---|---|
| works (load, global, call, catalogue all pass) | 42 |
| works for the offline-safe part only; the rest is network/hardware-bound and untested | 5 (tone.js, howler.js, peer.js, socket.io, ml5.js) |
| loads but call failed | 0 (was 1 before the fixes: vanta) |
| does not load | 0 (was 1 before the fixes: tippy) |
| untestable offline | 0 |

Before the fixes, 10 further entries loaded fine but advertised 46 wrapper builtins that do not exist
anywhere in the page (`phaserGame`, `mapView`, `fireConfetti`, `typeText`, `connectSocket`, `p5setup`,
`lottieLoad`, `mlClassify`, `kbInit`, `plWorld`, …); calling one was a compile error. No entry is
ESM-only: all 47 files are classic scripts that define a global.

## Per library

"Version" is the npm version tested. "Status" is after the registry fixes in this commit.

| Library | Version | Global | Status | Note |
|---|---|---|---|---|
| three.js | three 0.128.0 | `THREE` | works | All 27 wrapper builtins (`scene3d` … `text3d`) called without error, plus `new THREE.Vector3`. Added `global`. |
| tone.js | tone 14.8.49 | `Tone` | works (no audio check) | `Tone.Frequency("A4").toFrequency()` = 440; all 6 wrappers called. Nothing audible was verified. cdnjs file `Tone.min.js` is not in the npm package (npm has `build/Tone.js`) — URL unverified. Added `global`. |
| matter.js | matter-js 0.19.0 | `Matter` | works | Engine/Bodies/Composite via interop, a body falls; all 7 wrappers called. Added `global`. |
| chart.js | chart.js 4.6.1 | `Chart` | works | `new Chart(getCanvas(), cfg)` builds 3 bars; bar/line/pie wrappers render. URL was unversioned (`/npm/chart.js`); pinned to the file jsDelivr's default resolves to today. Added `global`. |
| gsap | gsap 3.12.2 | `gsap` | works | `gsap.to(obj, {x:100})` reaches 100; `tween()` moves a `button()` element. Added `global`. |
| howler.js | howler 2.2.4 | `Howl`, `Howler` | works (no audio check) | A `Howl` built from a data: URI reaches state `loaded`; all 5 wrappers called. Playback not audible/verified. Added `global`. |
| anime.js | animejs 3.2.2 | `anime` | works | `anime({targets: obj, v: 50})` reaches 50; `animateEl()` moves a `button()` element. The 3.2.2 build reports `anime.version` 3.2.1 (library quirk). Added `global`. |
| pixi.js | pixi.js 7.3.2 | `PIXI` | works | `new PIXI.Point`, and all 6 wrappers (WebGL via swiftshader). Added `global`. |
| cannon.js | cannon 0.6.2 | `CANNON` | works, 1 wrapper broken | World/Body/Sphere via interop, body falls; 5 of 6 wrappers work. **`bodyPlane()` throws** — runtime bug, see problem 9. Added `global`. |
| peer.js | peerjs 1.5.1 | `Peer` | offline-safe part only | `new Peer()` constructs and `destroy()` works. Connecting, sending, receiving and the `hostPeer`/`joinPeer`/`sendInt`/… wrappers need the signalling server: **untested** (wrappers only checked to have an implementation). Added `global`. |
| phaser | phaser 3.90.0 | `Phaser` | works | `new Phaser.Game({type: Phaser.CANVAS})` boots; `Phaser.Math.Vector2`. `Phaser.Math.Between`-style functions return garbage (problem 3). Pinned `@3` → `@3.90.0`; the 5 phantom wrappers replaced by a member catalogue. |
| leaflet | leaflet 1.9.4 | `L` | works (unstyled) | Map, marker, `distanceTo`. Tiles are network-bound: untested. `leaflet.css` is not loaded by `use`. cdnjs file `leaflet.min.js` is not in the npm package (npm has `dist/leaflet.js`) — URL unverified. 5 phantom wrappers replaced by a member catalogue. |
| confetti | canvas-confetti 1.9.2 | `confetti` | works | `confetti(opts)` returns a promise that resolves. `confetti.browser.min.js` is not in the npm package (jsDelivr minifies `confetti.browser.js` on the fly; the library's README uses this URL). 3 phantom wrappers replaced. |
| typed.js | typed.js 2.0.16 | `Typed` | works | `new Typed(el, opts)` types "hello" into the element. 3 phantom wrappers replaced. |
| socket.io | socket.io-client 4.8.4 | `io` | offline-safe part only | `io(url, {autoConnect:false})` builds a socket. Connecting/emitting/receiving need a server: **untested**. Pinned `@4` → `@4.8.4`; 3 phantom wrappers replaced. |
| p5.js | p5 1.9.0 | `p5` | works | Instance mode: `new p5(fnRef(sketch))`, `setup` runs, `createCanvas`; `p5.Vector`. Global mode (bare `setup()`/`draw()`) does not fit Emit and was not tried. 7 phantom wrappers replaced. |
| lottie | lottie-web 5.12.2 | `lottie` (also `bodymovin`) | works | `lottie.loadAnimation` with inline `animationData` renders an SVG. Loading by URL (`path:`) untested. 4 phantom wrappers replaced. |
| ml5.js | ml5 0.12.2 | `ml5` | offline-safe part only | `ml5.neuralNetwork(opts)` + `addData`. Every pre-trained model (classifier, poseNet, detector) downloads weights: **untested**. 3 phantom wrappers replaced. |
| kaboom | kaboom 3000.1.17 | `kaboom` | works | `kaboom({global:false})`, `k.add([k.rect, k.pos])`. `dist/kaboom.min.js` is not in the npm package; now points at `dist/kaboom.js` (already minified) and is pinned. 8 phantom wrappers replaced. |
| planck.js | planck 1.4.2 | `planck` | works | World, dynamic body, fixture, `step` — body falls. Pinned `@1` → `@1.4.2`; 5 phantom wrappers replaced. |
| babylon.js | babylonjs 9.36.0 | `BABYLON` | works | Engine on `getCanvas()`, scene, camera, box, `scene.render()`. The URL (`cdn.babylonjs.com/babylon.js`) is unversioned and serves "latest"; tested against npm 9.36.0 — assumption. Left unpinned (the versioned URL scheme could not be checked). |
| dayjs | dayjs 1.11.23 | `dayjs` | works | `format`, `add`, `year`. Pinned `@1` → `@1.11.23`. |
| fabric | fabric 5.3.0 | `fabric` | works | `new fabric.Canvas(getCanvas())`, add a `Rect`. |
| rough.js | roughjs 4.6.6 | `rough` | works | `rough.canvas(getCanvas()).rectangle(…)`. Catalogue lists `rectangle`, `circle`, … next to `canvas`/`svg`: they are methods of the object `rough.canvas()` returns, not of `rough`. |
| konva | konva 9.3.0 | `Konva` | works | Stage, Layer, Circle. |
| marked | marked 11.1.0 | `marked` | works | `marked.parse`, `marked.parseInline`. |
| dompurify | dompurify 3.0.6 | `DOMPurify` | works | `sanitize` strips `onerror`. |
| mathjs | mathjs 12.2.1 | `math` | works | `evaluate`, `sqrt`, `derivative`, `unit(...).to(...)`. |
| numeral | numeral 2.0.6 | `numeral` | works | `numeral(1234.5).format("$0,0.00")`. Mixing `numeral(number)` and `numeral("string")` in one program does not compile (problem 2). |
| qrcode | qrcodejs 1.0.0 | `QRCode` | works | `new QRCode(el, "hello")` draws a canvas; `makeCode`, `clear`. |
| papaparse | papaparse 5.4.1 | `Papa` | works | `parse`, `unparse`. |
| json5 | json5 2.2.3 | `JSON5` | works | `parse`, `stringify`. |
| d3 | d3 7.8.5 | `d3` | works | `d3.sum`, `d3.select(...).append(...)`, formats and scales — but a format/scale is a function and must be called as `f.call(null, x)` (problem 4). |
| apexcharts | apexcharts 3.45.1 | `ApexCharts` | works | `new ApexCharts(el, opts).render()` resolves and draws 3 bars. |
| plotly | plotly.js-dist-min 2.27.1 | `Plotly` | works | `Plotly.newPlot(el, [trace])` resolves and draws 1 trace. `plotly.js-dist@2.27.1/plotly.min.js` is not in that package (it ships only `plotly.js`, 8.5 MB); now points at the official minified package `plotly.js-dist-min`. |
| motion | motion 10.16.4 | `Motion` | works | `Motion.animate(el, kf, opts)`; its `finished` promise resolves. |
| excalibur | excalibur 0.29.0 | `ex` | works | `new ex.Engine`, `new ex.Actor`, `game.add`, `ex.Color.Red`. The game loop (`game.start()`) was not run. |
| axios | axios 1.6.2 | `axios` | works | `axios.get(url).then(fnRef(ok))` against a fake JSON endpoint served by the test: status 200 and the body arrive. Real servers untested. |
| alpine | alpinejs 3.13.3 | `Alpine` | works | `Alpine.store`, `Alpine.reactive`. The bundle calls `Alpine.start()` itself, which scans the IDE page; declarative `x-data` HTML was not tried. No catalogue. |
| tippy | tippy.js 6.3.7 | `tippy` | works (was: did not load) | The UMD bundle needs the global `Popper` and threw on load. The entry now has `needs:[…@popperjs/core@2.11.8…]` and the loader loads that first. `tippy(el, opts)`, `show()`. |
| flatpickr | flatpickr 4.6.13 | `flatpickr` | works (unstyled) | `flatpickr(el, opts)`, `setDate`, `flatpickr.formatDate`. `flatpickr.css` is not loaded by `use`. |
| swiper | swiper 11.0.5 | `Swiper` | works (unstyled) | `new Swiper(el, opts)` finds 3 slides, `slideNext`. `swiper-bundle.css` is not loaded by `use`, so it will not look like a carousel. |
| notyf | notyf 3.10.0 | `Notyf` | works (unstyled) | `new Notyf().success("saved")` adds a toast to the DOM. `notyf.min.css` is not loaded by `use`. |
| sweetalert2 | sweetalert2 11.10.1 | `Swal` | works | `Swal.fire(title, text, icon)`, `isVisible`, `close`. Switched to `sweetalert2.all.min.js`, which bundles its CSS; the previous `sweetalert2.min.js` has no styles (the old file itself was not tested). |
| nprogress | nprogress 0.2.0 | `NProgress` | works (unstyled) | `start`, `set(0.4)`, `done`. `nprogress.css` is not loaded by `use`, so the bar is invisible. cdnjs file `nprogress.min.js` is not in the npm package (npm has `nprogress.js`) — URL unverified. |
| tsparticles | @tsparticles/confetti 3.0.1 | `confetti`, `tsParticles` | works | `confetti(opts)` resolves with a container; `tsParticles.dom()` has 1 entry. Removed `loadJSON` from the catalogue (not in v3). The bundle adds about 150 globals to `window`. |
| vanta | vanta 0.5.24 | `VANTA` | works (was: call failed) | `VANTA.WAVES(opts)` returned null because three.js was not loaded; the entry now has `needs:[three r128]`. The file only contains WAVES: removed FOG/CLOUDS/NET/BIRDS/HALO from the catalogue (each is a separate file, e.g. `use vanta@0.5.24/dist/vanta.fog.min.js`). |

### Which checks each library got

All 47 got all four checks (a load, b global, c call, d catalogue). Check c is shallow by design — one
small program per library — and deliberately incomplete for:

- **peer.js, socket.io** — construction only; no connection.
- **ml5.js** — `neuralNetwork` construction and `addData` only; no model, no training.
- **tone.js, howler.js** — calls succeed; nothing is heard or measured.
- **leaflet** — no tiles. **axios** — fake endpoint only. **lottie** — inline data only.
- **excalibur, kaboom, phaser, p5.js** — an engine/instance is created (Phaser is seen to boot); no game
  loop, input or collision was exercised.
- **flatpickr, swiper, notyf, nprogress, leaflet** — behaviour only; unstyled because `use` loads no CSS.

## Registry fixes made

1. `global` added to the 20 entries that had none (three.js, tone.js, matter.js, chart.js, gsap,
   howler.js, anime.js, pixi.js, cannon.js, peer.js, phaser, leaflet, confetti, typed.js, socket.io,
   p5.js, lottie, ml5.js, kaboom, planck.js), each confirmed by diffing `window`.
2. Ten entries listed wrapper builtins in `fns` that have no `BUILTINS` signature and no implementation
   (46 names in total): phaser, leaflet, confetti, typed.js, socket.io, p5.js, lottie, ml5.js, kaboom,
   planck.js. Their `fns` is now the library's global, with a `methods` catalogue of members that were
   checked to exist, and the misleading "— 1 line" description is replaced.
3. CDN paths: `chart.js` (unversioned) → `chart.js@4.6.1/dist/chart.umd.min.js`;
   `kaboom@3000/dist/kaboom.min.js` → `kaboom@3000.1.17/dist/kaboom.js`;
   `plotly.js-dist@2.27.1/plotly.min.js` → `plotly.js-dist-min@2.27.1/plotly.min.js`;
   `sweetalert2.min.js` → `sweetalert2.all.min.js`.
4. Version ranges pinned to the version tested: `phaser@3` → `3.90.0`, `socket.io-client@4` → `4.8.4`,
   `planck@1` → `1.4.2`, `dayjs@1` → `1.11.23`.
5. Catalogue members that do not exist removed: `tsParticles.loadJSON`; `VANTA.FOG/CLOUDS/NET/BIRDS/HALO`.
6. Dependencies: `tippy` needs Popper, `vanta` needs three.js. Both entries got a `needs:[url]` field and
   **one line was added to the loader** (`_loadUse`) to load those URLs first. This is the only change
   outside the `LIBS` array. Code that reads `LIBS` elsewhere (for example an export template that emits
   `<script>` tags) does not know about `needs` yet.

## Unverified URLs — worth opening once in a browser

| Entry | URL | Why it is uncertain |
|---|---|---|
| tone.js | `cdnjs…/tone/14.8.49/Tone.min.js` | npm has only `build/Tone.js` |
| leaflet | `cdnjs…/leaflet/1.9.4/leaflet.min.js` | npm has only `dist/leaflet.js` |
| nprogress | `cdnjs…/nprogress/0.2.0/nprogress.min.js` | npm has only `nprogress.js` |
| confetti | `jsdelivr…/canvas-confetti@1.9.2/dist/confetti.browser.min.js` | not a file of the package; relies on jsDelivr's on-the-fly `.min.js` |
| babylon.js | `cdn.babylonjs.com/babylon.js` | unversioned "latest"; tested with npm babylonjs 9.36.0 |

The other 12 cdnjs URLs (three.js, matter.js, gsap, howler.js, anime.js, pixi.js, cannon.js, peer.js,
typed.js, p5.js, lottie, qrcode) use a file name that also
exists in the npm package at that version, which makes them likely but still unverified.

## Interop problems that are not registry problems

Found while writing the call tests. Each has the smallest Emit program that shows it. Problems 2, 3, 4
and 9 are also kept in `run-registry.js` as `known` entries: they are reported on every run without
failing it, and the runner says so when one starts passing.

**Update — fixed since this list was written:** problems 1, 2, 3, 4, 7, 8 and 9 (and 5 and 6 before
them). Global JS functions are compiled as `window.name(args)` through the argument buffer (any
arguments per call site, the result is always a `js` value, bools arrive as booleans); a call without
`new` is a plain call unless the function is recognisably a constructor (see the help, *Constructors*);
`f(x)` / `a.b(x)(y)` call a function value; array literals handed to JS are JS arrays; `{a: 1}` object
literals exist; `bodyPlane()` uses `setFromEuler`. The four `known` entries of `run-registry.js` are
now ordinary checks in the cannon.js, phaser, numeral, dayjs and d3 tests, and `run-interop.js` has a
case for each. The text below is kept as the description of what each problem was.

**1. The result of a global JS function cannot be used unless the program also has a member call.**
WASM validation error (`not enough arguments on the stack for call (need 1, got 0)`): the function is
imported as returning nothing.
```
export fn run() {
  printStr(toStr(parseInt("12")))
}
```
Same with `use numeral` + `printStr(toStr(numeral(5.0)))`. In the cases tried, adding a member call anywhere in
the program (e.g. `.format(...)` on the result) makes it compile.

**2. A global JS function called with different argument types or counts at two call sites does not compile.**
The signature is fixed by the first call. WASM validation error (`call[0] expected type f64, found i32.const`).
```
use numeral
export fn run() {
  printStr(toStr(numeral(1234.5).format("0,0")))
  printNum(numeral("1,000").value())
}
```
Same for `dayjs()` followed by `dayjs("2024-03-15")` (`expected 0 elements on the stack for fallthru`).
Related: a `bool` argument to a global function arrives as a number — with a member call elsewhere in
the program, `printStr(toStr(String(false)))` prints `0`.

**3. A plain function whose name starts with a capital letter is called with `new`.** The runtime's
implicit-`new` rule (`nameStartsUpper`) constructs it, so a primitive return value is thrown away and an
empty object comes back. Hits most of `Phaser.Math.*`.
```
use phaser
export fn run() {
  printNum(Phaser.Math.Distance.Between(0.0, 0.0, 3.0, 4.0))
}
```
Prints `0`, expected `5`. Workaround: `let f = Phaser.Math.Distance.Between` then `f.call(null, 0.0, 0.0, 3.0, 4.0)`.

**4. A function value cannot be called.** `f(x)` on a handle silently returns nothing; calling a call
result is a WASM validation error. d3 formats, scales, line generators and curried APIs all need this.
```
use d3
export fn run() {
  let f = d3.format(".2f")
  printStr(toStr(f(3.14159)))
}
```
Prints an empty line, expected `3.14`. `printStr(toStr(d3.format(".2f")(3.14159)))` does not compile
(`call[0] expected type i64, found i32.const`). Workaround: `f.call(null, 3.14159)`.

**5. Methods on an Emit string do not compile.** WASM validation error (`call[0] expected type i64, found local.get of type i32`).
```
export fn run() {
  let s = "a,b"
  let parts = s.split(",")
  print(jsLen(parts))
}
```

**6. No index syntax.** `a[1]` on a JS array is a parse error (`Expected RPAREN, got LBRACKET`); use `jsAt(a, 1)`.
```
export fn run() {
  let a = JSON.parse("[5,6,7]")
  printNum(a[1])
}
```

**7. An Emit array literal passed straight to a JS function arrives as a number** (its slot in the
runtime array table), silently. Libraries that take `[lat, lng]`-style arrays need `toJsArray([...])`.
```
export fn run() {
  printStr(toStr(JSON.stringify([1, 2, 3])))
}
```
Prints `1`, expected `[1,2,3]`.

**8. No object literals.** `let o = {a: 1}` is a parse error; `emptyObj()` plus one assignment per field
is the only way, which makes nested chart/plot configs long (`JSON.parse("…")` is a usable shortcut).

**9. `bodyPlane()` (cannon.js wrapper) throws** `b.quaternion.setFromEulerAngles is not a function` —
cannon.js 0.6.2 calls it `setFromEuler`. The bug is in the wrapper in `buildImportObject`.
```
use cannon.js
export fn run() {
  world3d(0.0, -9.8, 0.0)
  let p = bodyPlane()
  print(p)
}
```

**10. `use` loads no CSS.** leaflet, flatpickr, swiper, notyf and nprogress work but are unstyled
(nprogress is invisible). A registry `css:` field plus a `<link>` in the loader would fix it.

**11. Calling `confetti()` without a `use` line loads the tsparticles bundle, not canvas-confetti.** The
auto-load map (`_fnToCdn`) is built from every entry's `fns` and the last entry naming `confetti` wins.
`use confetti` is unaffected. Not changed, because dropping `confetti` from the tsparticles entry would
make `use tsparticles` + `confetti()` load canvas-confetti on top of it.

**12. The 📚 panel prefixes every catalogue entry with the global**, so entries that *are* the global
insert wrong code: `dayjs.dayjs()`, `ApexCharts.ApexCharts(element, options)`, `tippy.tippy.delegate(…)`,
and instance methods read as statics (`dayjs.format(str)`, `Swiper.slideNext()`). Pre-existing; the new
catalogues follow the same convention. The runner accepts a catalogue name if it exists on the global,
on its prototype, or on an instance.

Things that worked and are worth knowing: promises through `.then(fnRef(cb))` (confetti, apexcharts,
plotly, axios, motion), callbacks invoked by a library (`new p5(fnRef(sketch))`, `setTimeout`), `new`
with nested `new` arguments, deep member chains, and nested field assignment (`el.style.width = "300px"`).

## Re-running

```
cd tests && npm install        # ~820 MB in tests/node_modules (gitignored)
node tests/run-registry.js                 # all 47
node tests/run-registry.js d3 tippy vanta  # a subset, by registry name
VERBOSE=1 node tests/run-registry.js d3    # globals found, catalogue classification, Output tab
```

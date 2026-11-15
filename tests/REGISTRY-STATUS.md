# Library registry status

What `use <name>` does for each of the 47 entries of the `LIBS` registry in `emit-ide-1_32.html`,
as measured by `node tests/run-registry.js` (headless Chromium, software WebGL).

**Read this first — what the results do and do not prove**

- The CDNs are not reachable from the test sandbox. Every library was installed from npm at the
  registry's version and the runner answers the registry URL with the corresponding file from
  `tests/node_modules`. So the table says "this file, loaded by the IDE, works"; no URL was ever
  fetched from the real CDN. What is checked instead ("verified by package", step a of the runner):
  every registry URL — script, `needs` dependency and stylesheet, 54 URLs in all — has the form
  `https://cdn.jsdelivr.net/npm/<pkg>@<version>/<path>`, `<version>` is the installed version and
  `<path>` is literally a file of that npm package. jsDelivr serves npm package files under exactly
  that scheme, so these are as good as verified; there is no cdnjs / cdn.babylonjs.com URL left.
- "works" means: the library loads with no error, its global appears, a small Emit program makes real
  calls into it through the interop and prints the expected values, and every name in the entry's
  catalogue exists. It does not mean the whole library API is usable from Emit — see "Interop problems".
- The runner judges nothing by eye. Rendering libraries are checked through their object model (a chart
  has 3 bars, a canvas exists, a scene has 1 mesh); stylesheets through a computed style that only the
  stylesheet provides. The registry examples were additionally looked at once in screenshots while they
  were written (see "Examples" below) — that is not repeated by the runner.

## Summary

| | count |
|---|---|
| works (load, global, call, catalogue, css where the entry has one, example, insert all pass) | 42 |
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
| tone.js | tone 14.8.49 | `Tone` | works (no audio check) | `Tone.Frequency("A4").toFrequency()` = 440; all 6 wrappers called. Nothing audible was verified. Now loads `tone@14.8.49/build/Tone.js` from jsDelivr (the cdnjs `Tone.min.js` was not a file of the package). Added `global`. |
| matter.js | matter-js 0.19.0 | `Matter` | works | Engine/Bodies/Composite via interop, a body falls; all 7 wrappers called. Added `global`. |
| chart.js | chart.js 4.6.1 | `Chart` | works | `new Chart(getCanvas(), cfg)` builds 3 bars; bar/line/pie wrappers render. URL was unversioned (`/npm/chart.js`); pinned to the file jsDelivr's default resolves to today. Added `global`. |
| gsap | gsap 3.12.2 | `gsap` | works | `gsap.to(obj, {x:100})` reaches 100; `tween()` moves a `button()` element. Added `global`. |
| howler.js | howler 2.2.4 | `Howl`, `Howler` | works (no audio check) | A `Howl` built from a data: URI reaches state `loaded`; all 5 wrappers called. Playback not audible/verified. Added `global`. |
| anime.js | animejs 3.2.2 | `anime` | works | `anime({targets: obj, v: 50})` reaches 50; `animateEl()` moves a `button()` element. The 3.2.2 build reports `anime.version` 3.2.1 (library quirk). Added `global`. |
| pixi.js | pixi.js 7.3.2 | `PIXI` | works | `new PIXI.Point`, and all 6 wrappers (WebGL via swiftshader). Added `global`. |
| cannon.js | cannon 0.6.2 | `CANNON` | works, 1 wrapper broken | World/Body/Sphere via interop, body falls; 5 of 6 wrappers work. **`bodyPlane()` throws** — runtime bug, see problem 9. Added `global`. |
| peer.js | peerjs 1.5.1 | `Peer` | offline-safe part only | `new Peer()` constructs and `destroy()` works. Connecting, sending, receiving and the `hostPeer`/`joinPeer`/`sendInt`/… wrappers need the signalling server: **untested** (wrappers only checked to have an implementation). Added `global`. |
| phaser | phaser 3.90.0 | `Phaser` | works | `new Phaser.Game({type: Phaser.CANVAS})` boots; `Phaser.Math.Vector2`. `Phaser.Math.Between`-style functions return garbage (problem 3). Pinned `@3` → `@3.90.0`; the 5 phantom wrappers replaced by a member catalogue. |
| leaflet | leaflet 1.9.4 | `L` | works | Map, marker, `distanceTo`. Tiles are network-bound: untested. `leaflet.css` is loaded by `use` (entry `css`). 5 phantom wrappers replaced by a member catalogue. |
| confetti | canvas-confetti 1.9.2 | `confetti` | works | `confetti(opts)` returns a promise that resolves. Now loads `dist/confetti.browser.js`, a file of the package (`confetti.browser.min.js` is not; jsDelivr would have to minify it on the fly). 3 phantom wrappers replaced. |
| typed.js | typed.js 2.0.16 | `Typed` | works | `new Typed(el, opts)` types "hello" into the element. 3 phantom wrappers replaced. |
| socket.io | socket.io-client 4.8.4 | `io` | offline-safe part only | `io(url, {autoConnect:false})` builds a socket. Connecting/emitting/receiving need a server: **untested**. Pinned `@4` → `@4.8.4`; 3 phantom wrappers replaced. |
| p5.js | p5 1.9.0 | `p5` | works | Instance mode: `new p5(fnRef(sketch))`, `setup` runs, `createCanvas`; `p5.Vector`. Global mode (bare `setup()`/`draw()`) does not fit Emit and was not tried. 7 phantom wrappers replaced. |
| lottie | lottie-web 5.12.2 | `lottie` (also `bodymovin`) | works | `lottie.loadAnimation` with inline `animationData` renders an SVG. Loading by URL (`path:`) untested. 4 phantom wrappers replaced. |
| ml5.js | ml5 0.12.2 | `ml5` | offline-safe part only | `ml5.neuralNetwork(opts)` + `addData`. Every pre-trained model (classifier, poseNet, detector) downloads weights: **untested**. 3 phantom wrappers replaced. |
| kaboom | kaboom 3000.1.17 | `kaboom` | works | `kaboom({global:false})`, `k.add([k.rect, k.pos])`. `dist/kaboom.min.js` is not in the npm package; now points at `dist/kaboom.js` (already minified) and is pinned. 8 phantom wrappers replaced. |
| planck.js | planck 1.4.2 | `planck` | works | World, dynamic body, fixture, `step` — body falls. Pinned `@1` → `@1.4.2`; 5 phantom wrappers replaced. |
| babylon.js | babylonjs 9.36.0 | `BABYLON` | works | Engine on `getCanvas()`, scene, camera, box, `scene.render()`. Pinned: `cdn.babylonjs.com/babylon.js` (unversioned "latest") → jsDelivr `babylonjs@9.36.0/babylon.js`, the tested version and a file of the package. |
| dayjs | dayjs 1.11.23 | `dayjs` | works | `format`, `add`, `year`. Pinned `@1` → `@1.11.23`. |
| fabric | fabric 5.3.0 | `fabric` | works | `new fabric.Canvas(getCanvas())`, add a `Rect`. |
| rough.js | roughjs 4.6.6 | `rough` | works | `rough.canvas(getCanvas()).rectangle(…)`. `rectangle`, `circle`, … are methods of the object `rough.canvas()` returns; the catalogue now shows them as `rc.rectangle(…)`. |
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
| flatpickr | flatpickr 4.6.13 | `flatpickr` | works | `flatpickr(el, opts)`, `setDate`, `flatpickr.formatDate`. `flatpickr.min.css` is loaded by `use` (entry `css`). |
| swiper | swiper 11.0.5 | `Swiper` | works | `new Swiper(el, opts)` finds 3 slides, `slideNext`. `swiper-bundle.min.css` is loaded by `use` (entry `css`). |
| notyf | notyf 3.10.0 | `Notyf` | works | `new Notyf().success("saved")` adds a toast to the DOM. `notyf.min.css` is loaded by `use` (entry `css`). |
| sweetalert2 | sweetalert2 11.10.1 | `Swal` | works | `Swal.fire(title, text, icon)`, `isVisible`, `close`. Switched to `sweetalert2.all.min.js`, which bundles its CSS; the previous `sweetalert2.min.js` has no styles (the old file itself was not tested). |
| nprogress | nprogress 0.2.0 | `NProgress` | works | `start`, `set(0.4)`, `done`. `nprogress.css` is loaded by `use` (entry `css`), so the bar is visible. Now loads `nprogress@0.2.0/nprogress.js` from jsDelivr (the cdnjs `nprogress.min.js` was not a file of the package). |
| tsparticles | @tsparticles/confetti 3.0.1 | `confetti`, `tsParticles` | works | `confetti(opts)` resolves with a container; `tsParticles.dom()` has 1 entry. Removed `loadJSON` from the catalogue (not in v3). Bare `confetti()` without a `use` line now auto-loads canvas-confetti, not this bundle; `use tsparticles` + `confetti()` loads only this bundle (both in `run-loader.js`). The bundle adds about 150 globals to `window`. |
| vanta | vanta 0.5.24 | `VANTA` | works (was: call failed) | `VANTA.WAVES(opts)` returned null because three.js was not loaded; the entry now has `needs:[three r128]`. The file only contains WAVES: removed FOG/CLOUDS/NET/BIRDS/HALO from the catalogue (each is a separate file, e.g. `use vanta@0.5.24/dist/vanta.fog.min.js`). |

### Which checks each library got

All 47 got checks a load (including "URL verified by package"), b global, c call, d catalogue,
f example and g insert; the 5 entries with a stylesheet also got e css. Check c is shallow by design —
one small program per library — and deliberately incomplete for:

- **peer.js, socket.io** — construction only; no connection.
- **ml5.js** — `neuralNetwork` construction and `addData` only; no model, no training.
- **tone.js, howler.js** — calls succeed; nothing is heard or measured.
- **leaflet** — no tiles. **axios** — fake endpoint only. **lottie** — inline data only.
- **excalibur, kaboom, phaser, p5.js** — an engine/instance is created (Phaser is seen to boot); no game
  loop, input or collision was exercised.
- **flatpickr, swiper, notyf, nprogress, leaflet** — behaviour, plus one computed style per library that
  only its stylesheet provides (e.g. the NProgress bar is `position:fixed; height:2px`). Not a pixel check.

## CSS, examples, catalogue, URLs — per library

"CSS": *yes* = the entry has a `css` field and `use` loads it; *bundled* = the script the registry loads
injects its own styles (found by reading the dist file for `createElement("style")` and, for the ones
with an example, seeing the styled result); *no* = nothing to load. "Lines" counts non-blank lines.
"URL verified by package" lists every URL of the entry (script, `needs`, `css`) after
`https://cdn.jsdelivr.net/npm/`; each is checked against `tests/node_modules` on every run.

| Library | CSS | Example (`f`) | Lines | Catalogue rows (`d`, `g`) | URL verified by package |
|---|---|---|---|---|---|
| three.js | no — the package ships no stylesheet | passes — a lit cube on a grid | 11 | 27 | yes — `three@0.128.0/build/three.min.js` |
| tone.js | no — the package ships no stylesheet | passes — plays A4 (not audible in the test), prints 440 | 8 | 14 | yes — `tone@14.8.49/build/Tone.js` |
| matter.js | no — the package ships no stylesheet | passes — a box and a ball fall onto the ground | 12 | 14 | yes — `matter-js@0.19.0/build/matter.min.js` |
| chart.js | no — the package ships no stylesheet | passes — a 3-bar chart | 12 | 10 | yes — `chart.js@4.6.1/dist/chart.umd.min.js` |
| gsap | no — the package ships no stylesheet | passes — a button slides right | 8 | 6 | yes — `gsap@3.12.2/dist/gsap.min.js` |
| howler.js | no — the package ships no stylesheet | passes — loads a tiny inline WAV, prints "sound loaded" | 11 | 11 | yes — `howler@2.2.4/dist/howler.min.js` |
| anime.js | no — the package ships no stylesheet | passes — a button slides right | 10 | 7 | yes — `animejs@3.2.2/lib/anime.min.js` |
| pixi.js | no — the package ships no stylesheet | passes — rectangle, circle and text | 8 | 13 | yes — `pixi.js@7.3.2/dist/pixi.min.js` |
| cannon.js | no — the only .css files belong to its demos/docs | passes — prints the height of a falling ball | 12 | 12 | yes — `cannon@0.6.2/build/cannon.min.js` |
| peer.js | no — the package ships no stylesheet | passes — creates a peer; the "open" callback needs the PeerJS server (not reached offline) | 9 | 11 | yes — `peerjs@1.5.1/dist/peerjs.min.js` |
| phaser | no — the package ships no stylesheet | passes — a teal game canvas, prints 5 | 12 | 7 | yes — `phaser@3.90.0/dist/phaser.min.js` |
| leaflet | yes — `dist/leaflet.css` (marker/control images are fetched relative to it; not served in the tests) | passes — a styled map with zoom control and marker (tiles need the network) | 11 | 9 | yes — `leaflet@1.9.4/dist/leaflet.js`, `leaflet@1.9.4/dist/leaflet.css` |
| confetti | no — the package ships no stylesheet | passes — confetti burst | 8 | 5 | yes — `canvas-confetti@1.9.2/dist/confetti.browser.js` |
| typed.js | bundled — the script injects the cursor-blink rule; the package has no .css | passes — typewriter text | 9 | 6 | yes — `typed.js@2.0.16/dist/typed.umd.js` |
| socket.io | no — the package ships no stylesheet | passes — builds an unconnected socket, prints its URL | 10 | 6 | yes — `socket.io-client@4.8.4/dist/socket.io.min.js` |
| p5.js | no — the package ships no stylesheet | passes — a circle on a p5 canvas (instance mode) | 16 | 9 | yes — `p5@1.9.0/lib/p5.min.js` |
| lottie | no — the package ships no stylesheet | passes — loads an empty inline animation, prints 60 frames (nothing to see) | 12 | 6 | yes — `lottie-web@5.12.2/build/player/lottie.min.js` |
| ml5.js | no — the package ships no stylesheet | passes — adds 2 training examples, prints 2 | 12 | 4 | yes — `ml5@0.12.2/dist/ml5.min.js` |
| kaboom | no — the package ships no stylesheet | passes — a circle on a kaboom canvas | 11 | 9 | yes — `kaboom@3000.1.17/dist/kaboom.js` |
| planck.js | no — the package ships no stylesheet | passes — prints the height of a falling ball | 9 | 5 | yes — `planck@1.4.2/dist/planck.min.js` |
| babylon.js | no — the package ships no stylesheet | passes — a lit sphere (was failing: `CreateSphere("ball", 0, scene)` and no `new`) | 15 | 14 | yes — `babylonjs@9.36.0/babylon.js` |
| dayjs | no — the package ships no stylesheet | passes — today, formatted two ways | 7 | 12 | yes — `dayjs@1.11.23/dayjs.min.js` |
| fabric | no — canvas only, no .css in the package | passes — a draggable rectangle | 11 | 8 | yes — `fabric@5.3.0/dist/fabric.min.js` |
| rough.js | no — the package ships no stylesheet | passes — sketchy rectangle, circle, line | 11 | 7 | yes — `roughjs@4.6.6/bundled/rough.js` |
| konva | no — canvas only, no .css in the package | passes — a draggable circle | 12 | 8 | yes — `konva@9.3.0/konva.min.js` |
| marked | no — the package ships no stylesheet | passes — rendered Markdown | 7 | 3 | yes — `marked@11.1.0/marked.min.js` |
| dompurify | no — the package ships no stylesheet | passes — HTML before/after sanitising | 7 | 3 | yes — `dompurify@3.0.6/dist/purify.min.js` |
| mathjs | no — the package ships no stylesheet | passes — 4 results | 7 | 9 | yes — `mathjs@12.2.1/lib/browser/math.js` |
| numeral | no — the package ships no stylesheet | passes — 3 formatted numbers | 6 | 4 | yes — `numeral@2.0.6/min/numeral.min.js` |
| qrcode | no — the package ships no stylesheet | passes — a QR code | 9 | 4 | yes — `qrcodejs@1.0.0/qrcode.min.js` |
| papaparse | no — the only .css in the package belongs to its demo page | passes — parsed CSV rows | 9 | 4 | yes — `papaparse@5.4.1/papaparse.min.js` |
| json5 | no — the package ships no stylesheet | passes — parsed relaxed JSON | 7 | 3 | yes — `json5@2.2.3/dist/index.min.js` |
| d3 | no — the package ships no stylesheet | passes — an SVG circle and square, prints 6.5 | 8 | 9 | yes — `d3@7.8.5/dist/d3.min.js` |
| apexcharts | bundled — the script injects the content of `dist/apexcharts.css` | passes — a 3-bar chart | 10 | 5 | yes — `apexcharts@3.45.1/dist/apexcharts.min.js` |
| plotly | bundled — the script injects its rules | passes — a line plot | 12 | 5 | yes — `plotly.js-dist-min@2.27.1/plotly.min.js` |
| motion | no — the package ships no stylesheet | passes — a button moves and fades | 11 | 4 | yes — `motion@10.16.4/dist/motion.min.js` |
| excalibur | bundled — loader/toaster CSS is inside the script | passes — vector maths and a colour (no engine, no canvas) | 10 | 6 | yes — `excalibur@0.29.0/build/dist/excalibur.min.js` |
| axios | no — the package ships no stylesheet | passes — GET of a public JSON API, prints status and title (the test serves that URL itself) | 11 | 5 | yes — `axios@1.6.2/dist/axios.min.js` |
| alpine | no — the package ships no stylesheet | passes — store and reactive values | 10 | 4 | yes — `alpinejs@3.13.3/dist/cdn.min.js` |
| tippy | bundled — `tippy-bundle.umd.min.js` injects its own `<style>` (the package also ships `dist/tippy.css` for the non-bundle build) | passes — a tooltip on a button | 8 | 4 | yes — `tippy.js@6.3.7/dist/tippy-bundle.umd.min.js`, `@popperjs/core@2.11.8/dist/umd/popper.min.js` |
| flatpickr | yes — `dist/flatpickr.min.css` | passes — a styled inline calendar | 10 | 8 | yes — `flatpickr@4.6.13/dist/flatpickr.min.js`, `flatpickr@4.6.13/dist/flatpickr.min.css` |
| swiper | yes — `swiper-bundle.min.css` | passes — a 3-slide carousel | 10 | 6 | yes — `swiper@11.0.5/swiper-bundle.min.js`, `swiper@11.0.5/swiper-bundle.min.css` |
| notyf | yes — `notyf.min.css` | passes — two styled toasts | 7 | 6 | yes — `notyf@3.10.0/notyf.min.js`, `notyf@3.10.0/notyf.min.css` |
| sweetalert2 | bundled — `sweetalert2.all.min.js` injects it | passes — a modal dialog | 5 | 5 | yes — `sweetalert2@11.10.1/dist/sweetalert2.all.min.js` |
| nprogress | yes — `nprogress.css` | passes — the loading bar at 60% | 7 | 6 | yes — `nprogress@0.2.0/nprogress.js`, `nprogress@0.2.0/nprogress.css` |
| tsparticles | no — the package ships no stylesheet | passes — confetti burst | 8 | 4 | yes — `@tsparticles/confetti@3.0.1/tsparticles.confetti.bundle.min.js` |
| vanta | no — the package ships no stylesheet | passes — animated WebGL waves | 10 | 1 | yes — `vanta@0.5.24/dist/vanta.waves.min.js`, `three@0.128.0/build/three.min.js` |

### Stylesheets

- Registry entries may carry `css:[url, …]`. `_loadUse` adds one `<link rel="stylesheet">` per URL (in
  `<head>`, de-duplicated by URL, awaited, 10 s timeout) before the entry's scripts.
- `use "https://…/x.css"` — any URL or npm path ending in `.css`, quoted or not — loads a stylesheet
  instead of a script. `as Name` on such a line is a readable error.
- A stylesheet that cannot be loaded never fails the Run: the output gets one amber line
  `⚠ Could not load the stylesheet <url> for "<library>" — <why>. The program still runs, …`, and the next
  Run tries again. Limit: if the program then has a *compile* error, the IDE replaces the whole output with
  that error and the warning line is lost for that Run.
- Exports: `_exportLibs` serialises `css` next to `needs` (also for libraries that are auto-loaded
  without a `use` line), and the exported `.html` / `.js` load it through the same `_loadUse`.
  `run-export.js` has three programs for it (`+use-css`, `+use-css-url`, `+css-fails`).
- Not covered: stylesheets of libraries loaded by npm name outside the registry (`use some-pkg`) — the
  IDE cannot know them; add a second line `use some-pkg@x.y.z/dist/some.css`. leaflet.css refers to
  marker/layer images by relative URL; on jsDelivr they resolve next to the stylesheet, which was not
  exercised by the runner (image requests are aborted offline).

### Examples

Every entry now has an `example` (babylon.js in its entry, the other 46 in `_LIB_EXAMPLES` right after
the registry); the 📚 panel shows an **Example** button that puts it in the editor. Step f compiles and
runs each one in a fresh page and fails on a `✗`/ERROR line, a warning line, a page error, a blocked CDN
request, a missing `use <name>` line, or when nothing visible is produced.

- Examples that fail because of a compiler / interop limitation: **none** — all 47 pass.
- p5.js is 16 lines (instance mode needs the sketch and setup functions); all others are 5–12.
- Weak examples, by necessity: **lottie** (an empty inline animation — a real one is a long JSON
  document or a URL), **peer.js** and **socket.io** (nothing happens without a server), **tone.js** and
  **howler.js** (sound cannot be checked), **excalibur** (maths only; the engine was not put on screen),
  **axios** (a public demo API; offline the test answers that URL itself), **ml5.js** (no model).
- fabric: do not hand it the canvas made by `canvas(w, h)` — fabric copies that element's inline style
  (black background) onto its own overlay canvas, which then hides the drawing. The example creates its
  own `<canvas>` element. (The call test still uses `getCanvas()`; it checks the object model only.)
- Each example was looked at once in a screenshot when it was written; the runner does not compare pixels.

### Catalogue (📚 panel)

The panel used to prefix every `methods` string with the entry's global (`dayjs.dayjs()`,
`ApexCharts.ApexCharts(…)`, instance methods shown as statics). A row is now built by `_libCatRows()`
from the signature's shape — see the comment above it — and the row's visible text is exactly what a tap
inserts: `dayjs()`, `new ApexCharts(element, options)`, `L.map(element)`, `new BABYLON.Scene(engine)`,
`chart.render()` (instance methods go on a variable named by the entry's new `inst` field), and wrapper
builtins with their parameter names (`scene3d(w, h)`). Step d checks every row against the loaded
library (exists; a row with `new` is a function; an ES class must have `new`; a "member" that only exists
on instances is an error), step g compiles the inserted text as a statement inside a function, and one
panel check clicks every row (348) and compares editor text with row text.

- Classes written with `new` in all catalogues (babylon, konva, excalibur, swiper are ES classes and
  cannot be called without it; for the others it is the conventional form).
- Could not be catalogued: **`gsap.from(…)`, `PIXI.Texture.from(…)`** — `from` is an Emit keyword, so
  `x.from(` does not parse (`Expected IDENTIFIER, got KEYWORD(from)`). Compiler limitation, not worked
  around; the rows were left out. Placeholder names that are Emit type names (`str`) do not parse either
  and were renamed.
- `Howler` (howler.js's second global) has no rows: an entry has one `global`.
- three.js has no member catalogue, only its 27 wrapper builtins: giving it one changes what the
  editor's dot-autocomplete shows for `THREE.` before/after the first Run, which `run-autocomplete.js`
  pins. The nine other wrapper libraries (tone.js … peer.js) did get member rows, so typing e.g. `Tone.`
  before the first Run now offers those rows instead of the "Run once to load" hint.
- Argument lists are placeholders to overwrite; they are checked to parse, not to be the library's exact
  parameter names.

### Auto-load of a library by a bare call

`_fnToCdn` maps a builtin/global name to the registry URL that provides it. It is now deterministic: the
first entry listing the name in `fns` wins, except that an entry whose own `name` or `global` is that name
wins over one that merely lists it. The only name listed by two entries is `confetti` (confetti,
tsparticles) → canvas-confetti. An auto-loaded entry now also gets its `needs` and `css`.

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
   the loader (`_loadUse`) loads those URLs first; exports carry `needs` too.
7. All 15 cdnjs URLs, the unversioned babylon URL and the on-the-fly-minified confetti URL were moved to
   jsDelivr npm URLs whose path is a file of the installed package (see the next section). vanta's
   `needs` follows three.js. `tests/package.json` now pins every package to the version tested.
8. `css` added to leaflet, flatpickr, swiper, notyf, nprogress; `inst` and corrected catalogues for most
   entries; `example` for all 47.

## URLs

No registry URL is unverified-by-package any more. The five that were flagged:

| Entry | Was | Now (a file of the installed npm package) |
|---|---|---|
| tone.js | `cdnjs…/tone/14.8.49/Tone.min.js` | `tone@14.8.49/build/Tone.js` (not minified: the package has no minified build) |
| leaflet | `cdnjs…/leaflet/1.9.4/leaflet.min.js` | `leaflet@1.9.4/dist/leaflet.js` |
| nprogress | `cdnjs…/nprogress/0.2.0/nprogress.min.js` | `nprogress@0.2.0/nprogress.js` (not minified) |
| confetti | `canvas-confetti@1.9.2/dist/confetti.browser.min.js` | `canvas-confetti@1.9.2/dist/confetti.browser.js` (not minified) |
| babylon.js | `cdn.babylonjs.com/babylon.js` (latest) | `babylonjs@9.36.0/babylon.js` |

The other 12 cdnjs entries (three.js, matter.js, gsap, howler.js, anime.js, pixi.js, cannon.js, peer.js,
typed.js, p5.js, lottie, qrcode) moved to the same file in the npm package. Could not be moved: none.

Still assumptions, since nothing was fetched: that jsDelivr serves these packages at all (it mirrors
npm, but very large files can be refused — `babylonjs/babylon.js` is about 9 MB and `plotly.min.js`
3.6 MB; whether jsDelivr's size limits allow them was not checked), and that the npm package named `qrcodejs@1.0.0`
is the library people expect under that name (it is the file the tests pass with; it was previously
loaded from cdnjs's `qrcodejs/1.0.0`, which could be a different publisher's copy).

## Interop problems that are not registry problems

Found while writing the call tests. Each has the smallest Emit program that shows it. Problems 2, 3, 4
and 9 are also kept in `run-registry.js` as `known` entries: they are reported on every run without
failing it, and the runner says so when one starts passing.

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

**10. `use` loads no CSS.** Fixed — see "Stylesheets" above.

**11. Calling `confetti()` without a `use` line loaded the tsparticles bundle, not canvas-confetti.**
Fixed — see "Auto-load of a library by a bare call" above.

**12. The 📚 panel prefixed every catalogue entry with the global.** Fixed — see "Catalogue" above.

**13. A member named like an Emit keyword cannot be called.** `gsap.from(target, vars)` and
`PIXI.Texture.from(source)` are parse errors (`Expected IDENTIFIER, got KEYWORD(from)`); `Array.from`
would be too. Found by the insert check; open.

Problems 1–9 were written before later compiler/interop work (the IDE's help now documents index syntax
and string methods, for instance) and were not re-measured here, except 2, 3, 4 and 9, which the runner
still reports as failing on every run.

Things that worked and are worth knowing: promises through `.then(fnRef(cb))` (confetti, apexcharts,
plotly, axios, motion), callbacks invoked by a library (`new p5(fnRef(sketch))`, `setTimeout`), `new`
with nested `new` arguments, deep member chains, and nested field assignment (`el.style.width = "300px"`).

## Re-running

```
cd tests && npm install        # ~820 MB in tests/node_modules (gitignored)
node tests/run-registry.js                 # all 47 + the 📚 panel check (about 3 minutes)
node tests/run-registry.js d3 tippy vanta  # a subset, by registry name
VERBOSE=1 node tests/run-registry.js d3    # globals found, catalogue classification, inserted texts, Output tab, example output
node tests/run-loader.js                   # the loader, incl. .css URLs, the CSS warning and the confetti auto-load
node tests/run-export.js +use-css +use-css-url +css-fails   # stylesheets in exported pages
```

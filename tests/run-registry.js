#!/usr/bin/env node
// Checks every entry of the IDE's built-in library registry (the LIBS array) in headless Chromium.
// CDN requests are answered from tests/node_modules (run `npm install` in tests/ first); any other
// network request is blocked, so the run is offline and repeatable.
//
//   node tests/run-registry.js [path/to/emit-ide.html] [libraryName ...]
//   VERBOSE=1     also prints globals, catalogue classification and each program's Output tab
//   JSON_OUT=file writes the raw results as JSON
//
// For each registry entry, in a fresh page:
//   a  load       `use <name>` loads: status ends at Done, no load error, no page error, no unmapped request
//   b  global     the entry's `global` (and the globals listed in the table below) exist on window
//   c  call       a small Emit program calls into the library through the interop and prints expected values
//   d  catalogue  every member in the entry's `methods` exists on the loaded library, and every wrapper
//                 builtin in `fns` has a BUILTINS signature and a `case'name':` implementation in the page
// Exit code 0 only when every checked library passes all four.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const NM = path.join(__dirname, 'node_modules');

// Registry CDN URL -> file under tests/node_modules that the CDN serves for it.
// `exact: false` marks URLs whose local file is an assumption (the CDN path does not exist under that
// name in the npm package, or the URL is unversioned) — see REGISTRY-STATUS.md.
const CDN_FILES = {
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js': { file: 'three/build/three.min.js' },
  'https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.min.js': { file: 'tone/build/Tone.js', exact: false },
  'https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js': { file: 'matter-js/build/matter.min.js' },
  'https://cdn.jsdelivr.net/npm/chart.js@4.6.1/dist/chart.umd.min.js': { file: 'chart.js/dist/chart.umd.min.js' },
  'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js': { file: 'gsap/dist/gsap.min.js' },
  'https://cdnjs.cloudflare.com/ajax/libs/howler/2.2.4/howler.min.js': { file: 'howler/dist/howler.min.js' },
  'https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.2/anime.min.js': { file: 'animejs/lib/anime.min.js' },
  'https://cdnjs.cloudflare.com/ajax/libs/pixi.js/7.3.2/pixi.min.js': { file: 'pixi.js/dist/pixi.min.js' },
  'https://cdnjs.cloudflare.com/ajax/libs/cannon.js/0.6.2/cannon.min.js': { file: 'cannon/build/cannon.min.js' },
  'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.1/peerjs.min.js': { file: 'peerjs/dist/peerjs.min.js' },
  'https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js': { file: 'phaser/dist/phaser.min.js' },
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js': { file: 'leaflet/dist/leaflet.js', exact: false },
  'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js': { file: 'canvas-confetti/dist/confetti.browser.js', exact: false },
  'https://cdnjs.cloudflare.com/ajax/libs/typed.js/2.0.16/typed.umd.js': { file: 'typed.js/dist/typed.umd.js' },
  'https://cdn.jsdelivr.net/npm/socket.io-client@4.8.4/dist/socket.io.min.js': { file: 'socket.io-client/dist/socket.io.min.js' },
  'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js': { file: 'p5/lib/p5.min.js' },
  'https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js': { file: 'lottie-web/build/player/lottie.min.js' },
  'https://cdn.jsdelivr.net/npm/ml5@0.12.2/dist/ml5.min.js': { file: 'ml5/dist/ml5.min.js' },
  'https://cdn.jsdelivr.net/npm/kaboom@3000.1.17/dist/kaboom.js': { file: 'kaboom/dist/kaboom.js' },
  'https://cdn.jsdelivr.net/npm/planck@1.4.2/dist/planck.min.js': { file: 'planck/dist/planck.min.js' },
  'https://cdn.babylonjs.com/babylon.js': { file: 'babylonjs/babylon.js', exact: false },
  'https://cdn.jsdelivr.net/npm/dayjs@1.11.23/dayjs.min.js': { file: 'dayjs/dayjs.min.js' },
  'https://cdn.jsdelivr.net/npm/fabric@5.3.0/dist/fabric.min.js': { file: 'fabric/dist/fabric.min.js' },
  'https://cdn.jsdelivr.net/npm/roughjs@4.6.6/bundled/rough.js': { file: 'roughjs/bundled/rough.js' },
  'https://cdn.jsdelivr.net/npm/konva@9.3.0/konva.min.js': { file: 'konva/konva.min.js' },
  'https://cdn.jsdelivr.net/npm/marked@11.1.0/marked.min.js': { file: 'marked/marked.min.js' },
  'https://cdn.jsdelivr.net/npm/dompurify@3.0.6/dist/purify.min.js': { file: 'dompurify/dist/purify.min.js' },
  'https://cdn.jsdelivr.net/npm/mathjs@12.2.1/lib/browser/math.js': { file: 'mathjs/lib/browser/math.js' },
  'https://cdn.jsdelivr.net/npm/numeral@2.0.6/min/numeral.min.js': { file: 'numeral/min/numeral.min.js' },
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js': { file: 'qrcodejs/qrcode.min.js' },
  'https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js': { file: 'papaparse/papaparse.min.js' },
  'https://cdn.jsdelivr.net/npm/json5@2.2.3/dist/index.min.js': { file: 'json5/dist/index.min.js' },
  'https://cdn.jsdelivr.net/npm/d3@7.8.5/dist/d3.min.js': { file: 'd3/dist/d3.min.js' },
  'https://cdn.jsdelivr.net/npm/apexcharts@3.45.1/dist/apexcharts.min.js': { file: 'apexcharts/dist/apexcharts.min.js' },
  'https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.27.1/plotly.min.js': { file: 'plotly.js-dist-min/plotly.min.js' },
  'https://cdn.jsdelivr.net/npm/motion@10.16.4/dist/motion.min.js': { file: 'motion/dist/motion.min.js' },
  'https://cdn.jsdelivr.net/npm/excalibur@0.29.0/build/dist/excalibur.min.js': { file: 'excalibur/build/dist/excalibur.min.js' },
  'https://cdn.jsdelivr.net/npm/axios@1.6.2/dist/axios.min.js': { file: 'axios/dist/axios.min.js' },
  'https://cdn.jsdelivr.net/npm/alpinejs@3.13.3/dist/cdn.min.js': { file: 'alpinejs/dist/cdn.min.js' },
  'https://cdn.jsdelivr.net/npm/tippy.js@6.3.7/dist/tippy-bundle.umd.min.js': { file: 'tippy.js/dist/tippy-bundle.umd.min.js' },
  'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/flatpickr.min.js': { file: 'flatpickr/dist/flatpickr.min.js' },
  'https://cdn.jsdelivr.net/npm/swiper@11.0.5/swiper-bundle.min.js': { file: 'swiper/swiper-bundle.min.js' },
  'https://cdn.jsdelivr.net/npm/notyf@3.10.0/notyf.min.js': { file: 'notyf/notyf.min.js' },
  'https://cdn.jsdelivr.net/npm/sweetalert2@11.10.1/dist/sweetalert2.all.min.js': { file: 'sweetalert2/dist/sweetalert2.all.min.js' },
  'https://cdnjs.cloudflare.com/ajax/libs/nprogress/0.2.0/nprogress.min.js': { file: 'nprogress/nprogress.js', exact: false },
  'https://cdn.jsdelivr.net/npm/@tsparticles/confetti@3.0.1/tsparticles.confetti.bundle.min.js': { file: '@tsparticles/confetti/tsparticles.confetti.bundle.min.js' },
  'https://cdn.jsdelivr.net/npm/vanta@0.5.24/dist/vanta.waves.min.js': { file: 'vanta/dist/vanta.waves.min.js' },
  // Not registry entries of their own: dependencies named in an entry's `needs`.
  'https://cdn.jsdelivr.net/npm/@popperjs/core@2.11.8/dist/umd/popper.min.js': { file: '@popperjs/core/dist/umd/popper.min.js' },
};

// A fake JSON endpoint so an HTTP client library can make a real request offline.
const FAKE_JSON_URL = 'https://emit-test.invalid/data.json';
const SILENT_WAV = 'data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAAC' + 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

// Per-library test. Keys are registry names.
//   pkg       npm package (version is read from tests/node_modules for the report)
//   globals   globals the library must define, in addition to the entry's `global` field
//   instance  JS expression (run in the page) giving an object on which the catalogue's instance
//             methods are looked up, for entries whose `methods` mix static and instance members
//   src       Emit program; expect: lines the Output tab must contain, in order (string = whole line, RegExp = match)
//   wait      ms to wait after Run for timers/promises (default 400)
//   untested  what this test deliberately does not cover
//   known     [{title, src, expect}] programs that SHOULD work but fail today because of a problem outside
//             the registry (compiler / runtime). They are reported, not counted as failures; when one
//             starts passing the runner says so and the entry can be folded into the main test.
const TESTS = {
  'three.js': { pkg: 'three', globals: ['THREE'], src: `
use three.js
export fn run() {
  let v = new THREE.Vector3(3.0, 4.0, 0.0)
  printNum(v.length())
  printStr(toStr(THREE.REVISION))
  scene3d(200, 150)
  bgColor3d(20, 20, 40)
  ambient3d(80, 80, 80)
  light3d(1.0, 2.0, 3.0)
  pointLight3d(0.0, 3.0, 0.0, 255, 255, 255)
  spotLight3d(0.0, 5.0, 0.0, 0.0, 0.0, 0.0)
  fog3d(0, 0, 0, 1.0, 50.0)
  grid3d(10, 10)
  shadow3d()
  let b = box(0.0, 0.5, 0.0)
  color3d(b, 45, 212, 191)
  move3d(b, 1.0, 0.5, 0.0)
  rotate3d(b, 0.1, 0.2, 0.3)
  scale3d(b, 2.0, 1.0, 1.0)
  metallic3d(b, 0.5, 0.5)
  opacity3d(b, 0.8)
  sphere(0.0, 1.0, 0.0, 0.5)
  plane(4.0, 4.0)
  cylinder(1.0, 0.0, 0.0, 0.3, 1.0)
  wallBox(0.0, 0.0, -2.0, 4.0, 2.0, 0.2)
  cone(-1.0, 0.0, 0.0, 0.3, 1.0)
  torus(0.0, 2.0, 0.0, 0.5, 0.1)
  let t = text3d("hi", 0.0, 0.0, 0.0, 0.5)
  camera3d(3.0, 2.0, 3.0)
  lookAt3d(0.0, 0.0, 0.0)
  controls3d()
  render3d()
  print(t)
}`, expect: ['> 5', '> 128', '> 7'] },

  'tone.js': { pkg: 'tone', globals: ['Tone'], untested: 'audible playback (no audio device; playNote is called but nothing is heard or measured)', src: `
use tone.js
export fn run() {
  printNum(Tone.Frequency("A4").toFrequency())
  printStr(toStr(Tone.Frequency(440.0).toNote()))
  let s = synth(1)
  let d = drum(0)
  setBpm(90)
  setSwing(0.2)
  printNum(Tone.Transport.bpm.value)
  playNote(s, 440.0, 8.0)
  noteOff(s)
  print(d)
}`, expect: ['> 440', '> A4', '> 90', '> 1'] },

  'matter.js': { pkg: 'matter-js', globals: ['Matter'], src: `
use matter.js
export fn run() {
  let engine = Matter.Engine.create()
  let b = Matter.Bodies.rectangle(100.0, 50.0, 40.0, 40.0)
  Matter.Composite.add(engine.world, b)
  Matter.Engine.update(engine, 16.0)
  print(jsLen(Matter.Composite.allBodies(engine.world)))
  let y: num = b.position.y
  if (y > 50.0) { printStr("fell") }
  physics(200, 200)
  let id = physBox(50.0, 20.0, 20.0, 20.0)
  physCircle(80.0, 20.0, 10.0)
  physGravity(0.0, 1.0)
  physGround(190.0)
  physStep()
  physDraw()
  print(id)
}`, expect: ['> 1', '> fell', '> 0'] },

  'chart.js': { pkg: 'chart.js', globals: ['Chart'], src: `
use chart.js
export fn run() {
  canvas(300, 200)
  let ds = emptyObj()
  ds.label = "sales"
  ds.data = toJsArray([1.0, 2.0, 3.0])
  let data = emptyObj()
  data.labels = toJsArray(["a", "b", "c"])
  data.datasets = new Array(ds)
  let opts = emptyObj()
  opts.responsive = false
  opts.animation = false
  let cfg = emptyObj()
  cfg.type = "bar"
  cfg.data = data
  cfg.options = opts
  let ch = new Chart(getCanvas(), cfg)
  print(jsLen(ch.data.datasets))
  printStr(toStr(ch.config.type))
  print(jsLen(ch.getDatasetMeta(0).data))
  barChart(200, 120)
  chartLabel("x")
  chartData(4.0)
  chartColor(255, 0, 0)
  chartRender()
  lineChart(200, 120)
  chartLabel("y")
  chartData(2.0)
  chartRender()
  pieChart(200, 120)
  chartLabel("z")
  chartData(1.0)
  chartRender()
  print(jsLen(document.querySelectorAll("#tab-output canvas")))
}`, expect: ['> 1', '> bar', '> 3', '> 4'] },

  'gsap': { pkg: 'gsap', globals: ['gsap'], wait: 700, src: `
use gsap
mut objH = 0
fn check() {
  printNum(objH.x)
  printStr(toStr(document.getElementById("emit-el-1").style.transform))
}
export fn run() {
  printStr(toStr(gsap.version))
  let o = emptyObj()
  o.x = 0.0
  objH = o
  let t = emptyObj()
  t.x = 100.0
  t.duration = 0.1
  gsap.to(o, t)
  button("moved by tween()", 1)
  tween(1, 0, 60.0, 0.1)
  setTimeout(fnRef(check), 400)
}`, expect: ['> 3.12.2', '> 100', /^> translate\(60px/] },

  'howler.js': { pkg: 'howler', globals: ['Howl', 'Howler'], wait: 1200, untested: 'audible playback (no audio device) and loading a real audio file over the network (a data: URI is used)', src: `
use howler.js
mut howlH = 0
fn check() {
  printStr(toStr(howlH.state()))
  printNum(howlH.volume())
}
export fn run() {
  Howler.volume(0.5)
  printNum(Howler.volume())
  let o = emptyObj()
  o.src = toJsArray(["${SILENT_WAV}"])
  let h = new Howl(o)
  h.volume(0.25)
  howlH = h
  let id = loadAudio("${SILENT_WAV}")
  volumeAudio(id, 0.5)
  loopAudio(id, 0)
  playAudio(id)
  stopAudio(id)
  print(id)
  setTimeout(fnRef(check), 800)
}`, expect: ['> 0.5', '> 1', '> loaded', '> 0.25'] },   // id 1: slot 0 of the runtime table is the src array literal

  'anime.js': { pkg: 'animejs', globals: ['anime'], wait: 900, src: `
use anime.js
mut objH = 0
fn check() {
  printNum(objH.v)
  printStr(toStr(document.getElementById("emit-el-1").style.transform))
}
export fn run() {
  printStr(toStr(anime.version))
  let o = emptyObj()
  o.v = 0
  objH = o
  let p = emptyObj()
  p.targets = o
  p.v = 50
  p.duration = 100
  p.easing = "linear"
  anime(p)
  button("moved by animateEl()", 1)
  animateEl(1, 0, 60.0, 0.1)
  setTimeout(fnRef(check), 600)
}`, expect: [/^> 3\.2\.[12]$/, '> 50', /^> translateX\(60px\)/] },   // the 3.2.2 build reports anime.version 3.2.1

  'pixi.js': { pkg: 'pixi.js', globals: ['PIXI'], src: `
use pixi.js
export fn run() {
  printStr(toStr(PIXI.VERSION))
  let p = new PIXI.Point(3.0, 4.0)
  printNum(p.x + p.y)
  pixiApp(200, 150)
  let r = pixiRect(10, 10, 50, 40, 255, 0, 0)
  let c = pixiCircle(100, 80, 20, 0, 255, 0)
  let t = pixiText("hi", 5, 5, 14)
  pixiMove(r, 20, 20)
  pixiRender()
  print(t)
}`, expect: ['> 7.3.2', '> 7', '> 2'] },

  'cannon.js': { pkg: 'cannon', globals: ['CANNON'], src: `
use cannon.js
export fn run() {
  let w = new CANNON.World()
  w.gravity.set(0.0, -10.0, 0.0)
  let o = emptyObj()
  o.mass = 1.0
  o.shape = new CANNON.Sphere(1.0)
  let b = new CANNON.Body(o)
  w.addBody(b)
  w.step(0.1)
  let vy: num = b.velocity.y
  if (vy < 0.0) { printStr("falling") }
  world3d(0.0, -9.8, 0.0)
  let id = bodySphere(0.0, 5.0, 0.0, 1.0, 1.0)
  let bx = bodyBox(2.0, 5.0, 0.0, 1.0, 1.0, 1.0, 1.0)
  bodyForce(id, 0.0, 10.0, 0.0)
  stepWorld(0.016)
  print(bx)
  // bodyPlane() used to throw (cannon.js 0.6.2 has quaternion.setFromEuler, not setFromEulerAngles)
  let p = bodyPlane()
  print(p)
}`, expect: ['> falling', '> 1', '> 2'] },

  'peer.js': { pkg: 'peerjs', globals: ['Peer'], untested: 'everything that needs the PeerJS signalling server or a second peer (connect, send, receive); hostPeer/joinPeer wrappers not called', src: `
use peer.js
export fn run() {
  let p = new Peer()
  printStr(typeOf(p))
  if (!p.destroyed) { printStr("alive") }
  p.destroy()
  if (p.destroyed) { printStr("destroyed") }
}`, expect: ['> object', '> alive', '> destroyed'] },

  'phaser': { pkg: 'phaser', wait: 1500, src: `
use phaser
mut gameH = 0
fn check() {
  if (gameH.isBooted) { printStr("booted") }
}
export fn run() {
  let v = new Phaser.Math.Vector2(3.0, 4.0)
  printNum(v.length())
  printNum(v.distance(new Phaser.Math.Vector2(0.0, 0.0)))
  let cfg = emptyObj()
  cfg.type = Phaser.CANVAS
  cfg.width = 200
  cfg.height = 150
  cfg.banner = false
  // plain functions with capitalised names are plain calls (they used to be called with "new")
  printNum(Phaser.Math.Distance.Between(0.0, 0.0, 6.0, 8.0))
  printNum(Phaser.Math.Clamp(15.0, 0.0, 12.0))
  // …and a class called without new still constructs
  let v2 = Phaser.Math.Vector2(6.0, 8.0)
  printNum(v2.length() + 3.0)
  gameH = new Phaser.Game(cfg)
  setTimeout(fnRef(check), 1000)
}`, expect: ['> 5', '> 5', '> 10', '> 12', '> 13', '> booted'] },

  'leaflet': { pkg: 'leaflet', untested: 'map tiles (tile servers are network-bound); leaflet.css is not loaded by `use`', src: `
use leaflet
export fn run() {
  let el = document.createElement("div")
  let st = el.style
  st.width = "300px"
  st.height = "200px"
  document.body.appendChild(el)
  let m = L.map(el)
  m.setView(toJsArray([51.5, 0.1]), 13)
  printNum(m.getZoom())
  let mk = L.marker(toJsArray([51.5, 0.1]))
  mk.addTo(m)
  printNum(mk.getLatLng().lat)
  let d: num = L.latLng(51.5, 0.1).distanceTo(L.latLng(51.5, 0.2))
  if (d > 6000.0 && d < 8000.0) { printStr("about 7 km") }
}`, expect: ['> 13', '> 51.5', '> about 7 km'] },

  'confetti': { pkg: 'canvas-confetti', wait: 1500, src: `
use confetti
fn done() {
  printStr("finished")
}
export fn run() {
  let o = emptyObj()
  o.particleCount = 5
  o.ticks = 10
  let p = confetti(o)
  printStr(typeOf(p))
  p.then(fnRef(done))
}`, expect: ['> object', '> finished'] },

  'typed.js': { pkg: 'typed.js', wait: 1200, instance: 'Typed.prototype', src: `
use typed.js
mut elH = 0
fn check() {
  printStr(elH.textContent)
}
export fn run() {
  let el = document.createElement("span")
  document.body.appendChild(el)
  elH = el
  let o = emptyObj()
  o.strings = toJsArray(["hello"])
  o.typeSpeed = 1
  o.showCursor = false
  let t = new Typed(el, o)
  setTimeout(fnRef(check), 900)
}`, expect: ['> hello'] },

  'socket.io': { pkg: 'socket.io-client', instance: 'io("http://localhost:1", { autoConnect: false })', untested: 'connecting, emitting and receiving (needs a socket.io server)', src: `
use socket.io
export fn run() {
  printStr(typeOf(io.Manager))
  let o = emptyObj()
  o.autoConnect = false
  let s = io("http://localhost:1", o)
  if (!s.connected) { printStr("not connected") }
  printStr(toStr(s.io.uri))
}`, expect: ['> function', '> not connected', '> http://localhost:1'] },

  'p5.js': { pkg: 'p5', wait: 1000, instance: 'p5.prototype', src: `
use p5.js
mut pH = 0
fn onSetup() {
  pH.createCanvas(120, 80)
  pH.background(255, 0, 0)
  pH.noLoop()
  printNum(pH.width)
}
fn sketch(p: int) {
  pH = p
  p.setup = fnRef(onSetup)
}
export fn run() {
  let v = new p5.Vector(3.0, 4.0)
  printNum(v.mag())
  let inst = new p5(fnRef(sketch))
}`, expect: ['> 5', '> 120'] },

  'lottie': { pkg: 'lottie-web', untested: 'loading an animation by URL (path:) — only inline animationData', src: `
use lottie
export fn run() {
  let el = document.createElement("div")
  document.body.appendChild(el)
  let o = emptyObj()
  o.container = el
  o.renderer = "svg"
  o.loop = false
  o.autoplay = false
  o.animationData = JSON.parse("{\\"v\\":\\"5.5.2\\",\\"fr\\":30,\\"ip\\":0,\\"op\\":60,\\"w\\":100,\\"h\\":100,\\"layers\\":[]}")
  let a = lottie.loadAnimation(o)
  printNum(a.totalFrames)
  printNum(a.getDuration(false))
  a.goToAndStop(30, true)
  print(jsLen(el.querySelectorAll("svg")))
}`, expect: ['> 60', '> 2', '> 1'] },

  'ml5.js': { pkg: 'ml5', untested: 'every pre-trained model (imageClassifier, poseNet, objectDetector … download weights from the network)', src: `
use ml5.js
export fn run() {
  printStr(toStr(ml5.version))
  let o = emptyObj()
  o.task = "regression"
  o.inputs = 1
  o.outputs = 1
  let nn = ml5.neuralNetwork(o)
  nn.addData(toJsArray([1.0]), toJsArray([2.0]))
  nn.addData(toJsArray([2.0]), toJsArray([4.0]))
  print(jsLen(nn.neuralNetworkData.data.raw))
}`, expect: ['> 0.12.2', '> 2'] },

  'kaboom': { pkg: 'kaboom', wait: 800, instance: 'kaboom({ global: false, width: 50, height: 50 })', src: `
use kaboom
export fn run() {
  let o = emptyObj()
  o.global = false
  o.width = 200
  o.height = 150
  let k = kaboom(o)
  let obj = k.add(new Array(k.rect(10.0, 10.0), k.pos(5.0, 6.0)))
  printNum(obj.pos.x)
  printNum(k.width())
  print(jsLen(k.get("*")))
}`, expect: ['> 5', '> 200', '> 1'] },

  'planck.js': { pkg: 'planck', src: `
use planck.js
export fn run() {
  let w = new planck.World(planck.Vec2(0.0, -10.0))
  let b = w.createDynamicBody(planck.Vec2(0.0, 10.0))
  b.createFixture(planck.Circle(1.0), 1.0)
  w.step(0.1)
  let y: num = b.getPosition().y
  if (y < 10.0) { printStr("falling") }
  print(toInt(w.getBodyCount()))
}`, expect: ['> falling', '> 1'] },

  'babylon.js': { pkg: 'babylonjs', src: `
use babylon.js
export fn run() {
  let v = new BABYLON.Vector3(3.0, 4.0, 0.0)
  printNum(v.length())
  canvas(200, 150)
  let engine = new BABYLON.Engine(getCanvas(), true)
  let scene = new BABYLON.Scene(engine)
  let cam = new BABYLON.FreeCamera("cam", new BABYLON.Vector3(0.0, 5.0, -10.0), scene)
  BABYLON.MeshBuilder.CreateBox("b", emptyObj(), scene)
  print(jsLen(scene.meshes))
  scene.render()
  printStr("rendered")
}`, expect: ['> 5', '> 1', '> rendered'], instance: 'null' },

  'dayjs': { pkg: 'dayjs', instance: 'dayjs()', src: `
use dayjs
export fn run() {
  let d = dayjs("2024-03-15")
  printStr(toStr(d.format("YYYY/MM/DD")))
  printStr(toStr(d.add(1, "month").format("MMM")))
  printNum(d.year())
  // the same global function with no argument (now) and with an options-style second argument
  if (dayjs().year() > 2024) { printStr("now is after 2024") }
  printStr(toStr(dayjs("15-03-2024", "DD-MM-YYYY").isValid()))
  // its result is usable without any member call on it
  printStr(typeOf(dayjs()))
}`, expect: ['> 2024/03/15', '> Apr', '> 2024', '> now is after 2024', /^> (true|false)$/, '> object'] },

  'fabric': { pkg: 'fabric', src: `
use fabric
export fn run() {
  printStr(toStr(fabric.version))
  canvas(200, 150)
  let c = new fabric.Canvas(getCanvas())
  let o = emptyObj()
  o.width = 50
  o.height = 30
  o.left = 10
  o.fill = "red"
  let r = new fabric.Rect(o)
  c.add(r)
  print(jsLen(c.getObjects()))
  printNum(r.width)
}`, expect: ['> 5.3.0', '> 1', '> 50'] },

  'rough.js': { pkg: 'roughjs', instance: 'rough.canvas(document.createElement("canvas"))', src: `
use rough.js
export fn run() {
  canvas(200, 150)
  let rc = rough.canvas(getCanvas())
  let d = rc.rectangle(10, 10, 100, 50)
  printStr(toStr(d.shape))
  let c = rc.circle(80, 80, 40)
  printStr(toStr(c.shape))
}`, expect: ['> rectangle', '> circle'] },

  'konva': { pkg: 'konva', src: `
use konva
export fn run() {
  printStr(toStr(Konva.version))
  let el = document.createElement("div")
  document.body.appendChild(el)
  let so = emptyObj()
  so.container = el
  so.width = 200
  so.height = 100
  let stage = new Konva.Stage(so)
  let layer = new Konva.Layer()
  stage.add(layer)
  let co = emptyObj()
  co.x = 50
  co.y = 50
  co.radius = 20
  co.fill = "red"
  let circle = new Konva.Circle(co)
  layer.add(circle)
  print(jsLen(layer.getChildren()))
  printNum(circle.radius())
}`, expect: ['> 9.3.0', '> 1', '> 20'] },

  'marked': { pkg: 'marked', src: `
use marked
export fn run() {
  printStr(toStr(marked.parse("# hi")))
  printStr(toStr(marked.parseInline("**b**")))
}`, expect: [/^> <h1>hi<\/h1>\s*$/, '> <strong>b</strong>'] },

  'dompurify': { pkg: 'dompurify', src: `
use dompurify
export fn run() {
  printStr(toStr(DOMPurify.sanitize("<img src=x onerror=alert(1)><b>ok</b>")))
  printStr(toStr(DOMPurify.version))
}`, expect: ['> <img src="x"><b>ok</b>', '> 3.0.6'] },

  'mathjs': { pkg: 'mathjs', src: `
use mathjs
export fn run() {
  printStr(toStr(math.evaluate("2 + 3 * 4")))
  printNum(math.sqrt(16))
  printStr(toStr(math.derivative("x^2", "x").toString()))
  printStr(toStr(math.format(math.unit(5, "cm").to("mm"))))
}`, expect: ['> 14', '> 4', '> 2 * x', '> 50 mm'] },

  'numeral': { pkg: 'numeral', instance: 'numeral(1)', src: `
use numeral
export fn run() {
  printStr(toStr(numeral(1234.5).format("$0,0.00")))
  printStr(toStr(numeral(0.256).format("0.0%")))
  printNum(numeral(1500.0).value())
  // a number at one call site, a string at another, no argument at a third
  printStr(toStr(numeral(1234.5).format("0,0")))
  printNum(numeral("1,000").value())
  printNum(numeral().value())
}`, expect: ['> $1,234.50', '> 25.6%', '> 1500', '> 1,235', '> 1000', '> 0'] },

  'qrcode': { pkg: 'qrcodejs', instance: 'new QRCode(document.createElement("div"), "x")', src: `
use qrcode
export fn run() {
  let el = document.createElement("div")
  document.body.appendChild(el)
  let q = new QRCode(el, "hello")
  print(jsLen(el.querySelectorAll("canvas")))
  q.makeCode("another text")
  q.clear()
  printStr("ok")
}`, expect: ['> 1', '> ok'] },

  'papaparse': { pkg: 'papaparse', src: `
use papaparse
export fn run() {
  let r = Papa.parse("a,b,c")
  print(jsLen(jsAt(r.data, 0)))
  printStr(toStr(Papa.unparse(r.data)))
  printStr(toStr(r.meta.delimiter))
}`, expect: ['> 3', '> a,b,c', '> ,'] },

  'json5': { pkg: 'json5', src: `
use json5
export fn run() {
  let o = JSON5.parse("{a: 1, b: 'x', /* c */ }")
  printNum(o.a)
  printStr(toStr(JSON5.stringify(o)))
}`, expect: ['> 1', "> {a:1,b:'x'}"] },

  'd3': { pkg: 'd3', src: `
use d3
export fn run() {
  printNum(d3.sum(toJsArray([1.0, 2.0, 3.5])))
  let f = d3.format(".2f")
  printStr(toStr(f.call(null, 3.14159)))
  let s = d3.scaleLinear()
  s.domain(toJsArray([0.0, 10.0]))
  s.range(toJsArray([0.0, 100.0]))
  printNum(s.call(null, 2.5))
  // a function value is called directly; an array literal is a JS array
  printStr(toStr(f(2.71828)))
  printStr(toStr(d3.format(",")(1234567)))
  let s2 = d3.scaleLinear().domain([0, 10]).range([0, 50])
  printNum(s2(5))
  printNum(d3.max([3, 9, 4]))
  d3.select("body").append("p").attr("id", "d3-made").text("from d3")
  printStr(toStr(d3.select("#d3-made").text()))
}`, expect: ['> 6.5', '> 3.14', '> 25', '> 2.72', '> 1,234,567', '> 25', '> 9', '> from d3'] },

  'apexcharts': { pkg: 'apexcharts', wait: 1500, instance: 'ApexCharts.prototype', src: `
use apexcharts
mut elH = 0
fn done() {
  print(jsLen(elH.querySelectorAll(".apexcharts-bar-area")))
}
export fn run() {
  let el = document.createElement("div")
  document.body.appendChild(el)
  elH = el
  let chart = emptyObj()
  chart.type = "bar"
  chart.height = 200
  chart.width = 300
  let s = emptyObj()
  s.name = "sales"
  s.data = toJsArray([1.0, 2.0, 3.0])
  let opts = emptyObj()
  opts.chart = chart
  opts.series = new Array(s)
  let ch = new ApexCharts(el, opts)
  ch.render().then(fnRef(done))
}`, expect: ['> 3'] },

  'plotly': { pkg: 'plotly.js-dist-min', wait: 2500, src: `
use plotly
mut elH = 0
fn done() {
  print(jsLen(elH.data))
  print(jsLen(elH.querySelectorAll(".scatterlayer .trace")))
}
export fn run() {
  printStr(toStr(Plotly.version))
  let el = document.createElement("div")
  let st = el.style
  st.width = "400px"
  st.height = "300px"
  document.body.appendChild(el)
  elH = el
  let tr = emptyObj()
  tr.x = toJsArray([1.0, 2.0, 3.0])
  tr.y = toJsArray([2.0, 4.0, 8.0])
  tr.type = "scatter"
  Plotly.newPlot(el, new Array(tr)).then(fnRef(done))
}`, expect: ['> 2.27.1', '> 1', '> 1'] },

  'motion': { pkg: 'motion', wait: 1000, src: `
use motion
fn done() {
  printStr("finished")
}
export fn run() {
  let el = document.createElement("div")
  document.body.appendChild(el)
  let kf = emptyObj()
  kf.opacity = 0.5
  let o = emptyObj()
  o.duration = 0.1
  let a = Motion.animate(el, kf, o)
  printNum(a.duration)
  a.finished.then(fnRef(done))
}`, expect: ['> 0.1', '> finished'] },

  'excalibur': { pkg: 'excalibur', src: `
use excalibur
export fn run() {
  let v = new ex.Vector(3.0, 4.0)
  printNum(v.size)
  let o = emptyObj()
  o.width = 200
  o.height = 150
  o.suppressConsoleBootMessage = true
  let game = new ex.Engine(o)
  let ao = emptyObj()
  ao.x = 10
  ao.y = 20
  ao.width = 5
  ao.height = 5
  let a = new ex.Actor(ao)
  game.add(a)
  printNum(a.pos.y)
  printStr(toStr(ex.Color.Red.toHex()))
}`, expect: ['> 5', '> 20', '> #ff0000'] },

  'axios': { pkg: 'axios', wait: 1000, untested: 'requests to real servers (a fake JSON endpoint is served by the test)', src: `
use axios
fn ok(res: int) {
  printNum(res.status)
  printStr(toStr(res.data.name))
}
fn failed(err: int) {
  printStr(strConcat("failed: ", toStr(err.message)))
}
export fn run() {
  let cfg = emptyObj()
  cfg.url = "/a"
  cfg.params = JSON.parse("{\\"q\\":1}")
  printStr(toStr(axios.getUri(cfg)))
  axios.get("${FAKE_JSON_URL}").then(fnRef(ok)).catch(fnRef(failed))
}`, expect: ['> /a?q=1', '> 200', '> emit'] },

  'alpine': { pkg: 'alpinejs', src: `
use alpine
export fn run() {
  printStr(toStr(Alpine.version))
  Alpine.store("count", 5)
  printNum(Alpine.store("count"))
  let o = emptyObj()
  o.n = 1
  let r = Alpine.reactive(o)
  r.n = 7
  printNum(o.n)
}`, expect: ['> 3.13.3', '> 5', '> 7'] },

  'tippy': { pkg: 'tippy.js', globals: ['Popper'], untested: 'appearance (tippy.css is injected by the bundle, not checked visually)', src: `
use tippy
export fn run() {
  let el = document.createElement("button")
  el.textContent = "hover me"
  document.body.appendChild(el)
  let o = emptyObj()
  o.content = "hello tip"
  o.duration = 0
  let t = tippy(el, o)
  printStr(toStr(t.props.content))
  t.show()
  if (t.state.isVisible) { printStr("visible") }
  printStr(toStr(t.popper.textContent))
}`, expect: ['> hello tip', '> visible', '> hello tip'] },

  'flatpickr': { pkg: 'flatpickr', untested: 'appearance (flatpickr.css is not loaded by `use`)', src: `
use flatpickr
export fn run() {
  let el = document.createElement("input")
  document.body.appendChild(el)
  let fp = flatpickr(el, emptyObj())
  fp.setDate("2024-03-15")
  printStr(el.value)
  printStr(toStr(flatpickr.formatDate(new Date(2024, 0, 15), "Y-m-d")))
}`, expect: ['> 2024-03-15', '> 2024-01-15'] },

  'swiper': { pkg: 'swiper', instance: 'Swiper.prototype', untested: 'appearance and touch dragging (swiper-bundle.css is not loaded by `use`)', src: `
use swiper
export fn run() {
  let el = document.createElement("div")
  el.className = "swiper"
  let st = el.style
  st.width = "200px"
  el.innerHTML = "<div class='swiper-wrapper'><div class='swiper-slide'>1</div><div class='swiper-slide'>2</div><div class='swiper-slide'>3</div></div>"
  document.body.appendChild(el)
  let o = emptyObj()
  o.speed = 0
  let s = new Swiper(el, o)
  print(jsLen(s.slides))
  s.slideNext(0)
  printNum(s.activeIndex)
}`, expect: ['> 3', '> 1'] },

  'notyf': { pkg: 'notyf', instance: 'new Notyf()', untested: 'appearance (notyf.min.css is not loaded by `use`)', src: `
use notyf
export fn run() {
  let n = new Notyf()
  let t = n.success("saved")
  print(jsLen(document.querySelectorAll(".notyf__toast")))
  printStr(toStr(document.querySelector(".notyf__message").textContent))
}`, expect: ['> 1', '> saved'] },

  'sweetalert2': { pkg: 'sweetalert2', src: `
use sweetalert2
export fn run() {
  Swal.fire("Title here", "body text", "info")
  if (Swal.isVisible()) { printStr("visible") }
  printStr(toStr(Swal.getTitle().textContent))
  Swal.close()
}`, expect: ['> visible', '> Title here'] },

  'nprogress': { pkg: 'nprogress', untested: 'appearance (nprogress.css is not loaded by `use`)', src: `
use nprogress
export fn run() {
  NProgress.start()
  NProgress.set(0.4)
  printNum(NProgress.status)
  print(jsLen(document.querySelectorAll("#nprogress")))
  NProgress.done()
}`, expect: ['> 0.4', '> 1'] },

  'tsparticles': { pkg: '@tsparticles/confetti', globals: ['confetti', 'tsParticles'], wait: 1500, src: `
use tsparticles
fn fired(container: int) {
  printStr(typeOf(container))
  print(jsLen(tsParticles.dom()))
}
export fn run() {
  let o = emptyObj()
  o.particleCount = 5
  confetti(o).then(fnRef(fired))
}`, expect: ['> object', '> 1'] },

  'vanta': { pkg: 'vanta', globals: ['THREE'], wait: 600, src: `
use vanta
export fn run() {
  let el = document.createElement("div")
  let st = el.style
  st.width = "300px"
  st.height = "200px"
  document.body.appendChild(el)
  let o = emptyObj()
  o.el = el
  let fx = VANTA.WAVES(o)
  printStr(typeOf(fx.renderer))
  print(jsLen(el.querySelectorAll("canvas")))
  fx.destroy()
}`, expect: ['> object', '> 1'] },
};

function pkgVersion(pkg) {
  try { return JSON.parse(fs.readFileSync(path.join(NM, pkg, 'package.json'), 'utf8')).version; } catch (e) { return '?'; }
}

async function setAndRun(page, src) {
  await page.evaluate(s => {
    try { closeWelcome(); } catch (e) {}
    const ed = document.getElementById('editor');
    ed.value = s;
    ed.dispatchEvent(new Event('input'));
  }, src);
  let rejected = null;
  await page.evaluate(() => compileAndRun()).catch(e => { rejected = e.message.slice(0, 300); });
  // "not stuck": the status must leave Loading…/Compiling…
  const t0 = Date.now();
  let status = '';
  while (Date.now() - t0 < 30000) {
    status = await page.evaluate(() => document.getElementById('sTxt').innerText);
    if (!/Loading|Compiling/.test(status)) break;
    await page.waitForTimeout(100);
  }
  return { status, rejected };
}
const readOutput = page => page.evaluate(() => document.getElementById('tab-output').innerText);
const errLine = out => (out.match(/.*(?:\bERROR\b|✗).*/) || [''])[0].slice(0, 300);

// Lines of `expect` must appear in order among the output lines.
function matchExpect(output, expect) {
  const lines = output.split('\n').map(l => l.replace(/\s+$/, ''));
  let at = 0;
  for (const want of expect) {
    let found = -1;
    for (let i = at; i < lines.length; i++) {
      if (typeof want === 'string' ? lines[i] === want : want.test(lines[i])) { found = i; break; }
    }
    if (found < 0) return 'missing expected output line ' + String(want) + ' (got: ' + lines.filter(l => /^> /.test(l)).join(' | ').slice(0, 300) + ')';
    at = found + 1;
  }
  return null;
}

async function checkLibrary(browser, fileUrl, lib, html) {
  const t = TESTS[lib.name];
  const res = { name: lib.name, cdn: lib.cdn, pkg: t && t.pkg, version: t ? pkgVersion(t.pkg) : '?', fail: {}, notes: [], globalsFound: [], catalogue: [] };
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const pageErrors = [], blocked = [], served = [];
  page.on('pageerror', e => pageErrors.push(e.message.slice(0, 300)));
  await page.route(/^https?:/, route => {
    const url = route.request().url();
    if (url === FAKE_JSON_URL) {
      return route.fulfill({ body: '{"name":"emit","n":1}', contentType: 'application/json', headers: { 'access-control-allow-origin': '*' } });
    }
    const hit = CDN_FILES[url];
    const file = hit && path.join(NM, hit.file);
    if (file && fs.existsSync(file)) {
      served.push(url);
      return route.fulfill({ body: fs.readFileSync(file), contentType: 'application/javascript' });
    }
    if (!/fonts\.(googleapis|gstatic)\.com/.test(url)) blocked.push(url);
    return route.abort();
  });
  await page.goto(fileUrl);
  await page.waitForFunction(() => typeof compileAndRun === 'function' && typeof LIBS === 'object');

  // ── a. load ──
  const a = [];
  if (!CDN_FILES[lib.cdn]) a.push('registry URL has no local file in CDN_FILES: ' + lib.cdn);
  else if (!fs.existsSync(path.join(NM, CDN_FILES[lib.cdn].file))) a.push('local file missing (npm install in tests/): ' + CDN_FILES[lib.cdn].file);
  else if (CDN_FILES[lib.cdn].exact === false) res.notes.push('CDN file name is not in the npm package / unversioned; served ' + CDN_FILES[lib.cdn].file);
  const load = await setAndRun(page, 'use ' + lib.name + '\n\nexport fn run() {\n  print(1)\n}\n');
  await page.waitForTimeout(300);
  const loadOut = await readOutput(page);
  if (load.rejected) a.push('run rejected: ' + load.rejected);
  if (load.status !== 'Done') a.push('status after `use ' + lib.name + '`: ' + load.status + (errLine(loadOut) ? ' — ' + errLine(loadOut) : ''));
  else if (errLine(loadOut)) a.push('output reports an error: ' + errLine(loadOut));
  if (!served.includes(lib.cdn)) a.push('the registry URL was never requested');
  const loadBlocked = blocked.splice(0);
  // Requests the library itself makes while loading (telemetry, workers, fonts) are noted, not failed.
  const libBlocked = loadBlocked.filter(u => u !== lib.cdn && !(lib.needs || []).includes(u));
  loadBlocked.filter(u => !libBlocked.includes(u)).forEach(u => a.push('blocked (no local file mapped): ' + u));
  if (libBlocked.length) res.notes.push('library requested while loading (blocked offline): ' + libBlocked.join(', '));
  if (pageErrors.length) a.push('page error while loading: ' + pageErrors.splice(0).join(' ; '));
  if (a.length) res.fail.a = a;

  // ── b. globals ──
  res.globalsFound = await page.evaluate(() => _libGlobals());
  const wantGlobals = [...new Set([].concat(lib.global ? [lib.global] : [], (t && t.globals) || []))];
  const b = [];
  if (!wantGlobals.length) b.push('no expected global: entry has no `global` field and the test table lists none (found: ' + res.globalsFound.join(' ') + ')');
  const missing = await page.evaluate(names => names.filter(n => window[n] === undefined || window[n] === null), wantGlobals);
  if (missing.length) b.push('global not defined: ' + missing.join(', ') + ' (globals added by the load: ' + (res.globalsFound.join(' ') || 'none') + ')');
  if (b.length) res.fail.b = b;

  // ── d. catalogue ──
  const d = [];
  if (lib.methods && lib.methods.length) {
    res.catalogue = await page.evaluate(({ lib, instanceExpr }) => {
      const g = window[lib.global];
      let inst = null, instErr = null;
      if (instanceExpr) { try { inst = (0, eval)(instanceExpr); } catch (e) { instErr = String(e.message || e); } }
      const walk = (root, parts) => {
        let o = root;
        for (const p of parts) {
          if (o === null || o === undefined) return false;
          try { if (!(p in Object(o))) return false; o = o[p]; } catch (e) { return false; }
        }
        return true;
      };
      return lib.methods.map(m => {
        const sig = m.split(/\s+—/)[0];
        const name = sig.split('(')[0].trim();
        const parts = name.split('.');
        if (parts[0] === lib.global) parts.shift();
        let kind = 'missing';
        if (g === undefined || g === null) kind = 'missing (global not loaded)';
        else if (!parts.length) kind = 'global';
        else if (walk(g, parts)) kind = 'static';
        else if (g.prototype && walk(g.prototype, parts)) kind = 'instance';
        else if (inst !== null && inst !== undefined && walk(inst, parts)) kind = 'instance';
        return { entry: m, name, kind, instErr };
      });
    }, { lib: { global: lib.global, methods: lib.methods }, instanceExpr: (t && t.instance) || null });
    res.catalogue.filter(c => /^missing/.test(c.kind)).forEach(c => d.push('catalogue member does not exist: ' + (lib.global || '') + '.' + c.name + (c.instErr ? ' (instance expression threw: ' + c.instErr + ')' : '')));
  }
  // Wrapper builtins: every word of `fns` that is not one of the library's globals must be implemented.
  const wrappers = (lib.fns || '').split(' ').filter(f => f && f !== lib.global && !wantGlobals.includes(f));
  res.wrappers = wrappers;
  if (wrappers.length) {
    const hasSig = await page.evaluate(names => names.map(n => !!BUILTINS[n]), wrappers);
    wrappers.forEach((w, i) => {
      const impl = new RegExp("case\\s*'" + w + "'\\s*:").test(html);
      if (!hasSig[i] && !impl) d.push('wrapper builtin catalogued in fns but not implemented: ' + w);
      else if (!hasSig[i]) d.push('wrapper builtin has an implementation but no BUILTINS signature: ' + w);
      else if (!impl) d.push('wrapper builtin has a BUILTINS signature but no implementation: ' + w);
    });
  }
  if (d.length) res.fail.d = d;

  // ── c. call ──
  const c = [];
  if (!t || !t.src) c.push('no call test for this library in TESTS');
  else {
    const run = await setAndRun(page, t.src.trim() + '\n');
    await page.waitForTimeout(t.wait || 400);
    res.output = await readOutput(page);
    if (run.rejected) c.push('run rejected: ' + run.rejected);
    if (run.status !== 'Done') c.push('status: ' + run.status);
    if (errLine(res.output)) c.push('output reports an error: ' + errLine(res.output));
    const miss = matchExpect(res.output, t.expect || []);
    if (miss) c.push(miss);
    const callBlocked = blocked.filter(u => CDN_FILES[u] === undefined && /cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|cdn\.babylonjs\.com/.test(u));
    if (callBlocked.length) c.push('blocked CDN request: ' + callBlocked.join(', '));
    const other = blocked.filter(u => !callBlocked.includes(u));
    if (other.length) res.notes.push('network requests made by the library during the call test (blocked offline): ' + [...new Set(other)].join(', ').slice(0, 300));
    if (pageErrors.length) c.push('page error: ' + pageErrors.join(' ; '));
    if (t.untested) res.notes.push('untested: ' + t.untested);
  }
  if (c.length) res.fail.c = c;

  await page.close();

  // ── known issues outside the registry (reported, not counted) ──
  res.known = [];
  for (const k of (t && t.known) || []) {
    const kp = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const kErrors = [];
    kp.on('pageerror', e => kErrors.push(e.message.slice(0, 200)));
    await kp.route(/^https?:/, route => {
      const hit = CDN_FILES[route.request().url()];
      return hit ? route.fulfill({ body: fs.readFileSync(path.join(NM, hit.file)), contentType: 'application/javascript' }) : route.abort();
    });
    await kp.goto(fileUrl);
    await kp.waitForFunction(() => typeof compileAndRun === 'function');
    const run = await setAndRun(kp, k.src.trim() + '\n');
    await kp.waitForTimeout(400);
    const out = await readOutput(kp);
    await kp.close();
    const why = run.status !== 'Done' ? 'status ' + run.status + (errLine(out) ? ': ' + errLine(out) : '') : errLine(out) || matchExpect(out, k.expect) || kErrors[0] || null;
    res.known.push({ title: k.title, stillFails: !!why, why });
  }
  res.ok = Object.keys(res.fail).length === 0;
  return res;
}

(async () => {
  let args = process.argv.slice(2);
  let file = path.join(__dirname, '..', 'emit-ide-1_32.html');
  if (args[0] && /\.html?$/i.test(args[0])) file = args.shift();
  file = path.resolve(file);
  const only = args;
  const fileUrl = 'file://' + file;
  const html = fs.readFileSync(file, 'utf8');
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const probe = await browser.newPage();
  await probe.route(/^https?:/, r => r.abort());
  await probe.goto(fileUrl);
  await probe.waitForFunction(() => typeof LIBS === 'object');
  const all = await probe.evaluate(() => LIBS.map(l => ({ name: l.name, cdn: l.cdn, fns: l.fns, global: l.global || null, methods: l.methods || null, needs: l.needs || null })));
  await probe.close();
  const unknown = only.filter(n => !all.some(l => l.name === n || l.name.replace('.js', '') === n));
  if (unknown.length) { console.log('Not in the registry: ' + unknown.join(', ')); await browser.close(); process.exit(2); }
  const libs = all.filter(l => !only.length || only.includes(l.name) || only.includes(l.name.replace('.js', '')));
  const LABEL = { a: 'load', b: 'global', c: 'call', d: 'catalogue' };
  const results = [];
  let failed = 0, knownCount = 0, knownFixed = 0;
  for (const lib of libs) {
    let r;
    try { r = await checkLibrary(browser, fileUrl, lib, html); }
    catch (e) { r = { name: lib.name, ok: false, fail: { a: ['runner error: ' + e.message.split('\n')[0]] }, notes: [], globalsFound: [], catalogue: [], wrappers: [], known: [] }; }
    results.push(r);
    const head = (r.name + ' '.repeat(14)).slice(0, 14) + ((r.pkg || '') + '@' + (r.version || '?'));
    if (r.ok) console.log('PASS  ' + head + '  [load global call catalogue]');
    else {
      failed++;
      console.log('FAIL  ' + head + '  failed: ' + Object.keys(r.fail).map(k => k + '-' + LABEL[k]).join(', '));
      for (const k of Object.keys(r.fail)) r.fail[k].forEach(m => console.log('      ' + k + '. ' + m));
    }
    r.notes.forEach(n => console.log('      note: ' + n));
    (r.known || []).forEach(k => {
      knownCount++;
      if (k.stillFails) console.log('      known issue (not a registry problem, not counted): ' + k.title + ' — ' + String(k.why).slice(0, 200));
      else { knownFixed++; console.log('      known issue NOW PASSES — move it into the main test: ' + k.title); }
    });
    if (process.env.VERBOSE) {
      console.log('      globals: ' + r.globalsFound.join(' '));
      if (r.catalogue.length) console.log('      catalogue: ' + r.catalogue.map(c => c.name + '=' + c.kind).join(', '));
      if (r.wrappers && r.wrappers.length) console.log('      wrappers: ' + r.wrappers.join(' '));
      if (r.output) console.log(r.output.replace(/^/gm, '      | '));
    }
  }
  await browser.close();
  if (process.env.JSON_OUT) fs.writeFileSync(process.env.JSON_OUT, JSON.stringify(results, null, 1));
  const missingTests = Object.keys(TESTS).filter(n => !all.some(l => l.name === n));
  if (missingTests.length) console.log('\nTESTS entries with no registry entry: ' + missingTests.join(', '));
  console.log('\n' + (libs.length - failed) + '/' + libs.length + ' registry libraries passed' + (knownCount ? ' (' + (knownCount - knownFixed) + ' known non-registry issue' + (knownCount - knownFixed === 1 ? '' : 's') + ' still failing' + (knownFixed ? ', ' + knownFixed + ' now passing' : '') + ')' : ''));
  process.exit(failed ? 1 : 0);
})();

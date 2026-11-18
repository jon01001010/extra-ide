// TEST-ONLY: a stand-in Web Audio API for headless Chromium, used by run-drawer.js and run-sound.js through
// page.addInitScript(FAKE_AUDIO). Real audio cannot be heard here, so the page's AudioContext is replaced by
// one that records what is scheduled: every node (oscillators with their type, gains, buffer sources,
// biquad filters), every AudioParam event (setValueAtTime / linear / exponential ramps with value and time),
// connections, start / stop times and resume() calls. currentTime follows the page clock.
//   window.__audio = { made: number of contexts created, ctx: the last one, resumes }
//   ctx.nodes: [{kind:'osc'|'gain'|'buffer'|'filter', type, startT, stopT, out:[nodes], params...}]
//   param.events: [['set'|'lin'|'exp'|'cancel', value, time]]
module.exports = `(function () {
  window.__audio = { made: 0, ctx: null, resumes: 0 };
  function Param(name, node, v) { this.name = name; this.node = node; this.value = v; this.defaultValue = v; this.events = []; this.inputs = []; }
  Param.prototype.setValueAtTime = function (v, t) { this.events.push(['set', v, t]); this.value = v; return this; };
  Param.prototype.linearRampToValueAtTime = function (v, t) { this.events.push(['lin', v, t]); return this; };
  Param.prototype.exponentialRampToValueAtTime = function (v, t) { if (!(v > 0)) throw new RangeError('exponential ramp to a value that is not positive: ' + v); this.events.push(['exp', v, t]); return this; };
  Param.prototype.cancelScheduledValues = function (t) { this.events.push(['cancel', 0, t]); return this; };
  function Node(ctx, kind) { this.context = ctx; this.kind = kind; this.out = []; this.id = ctx.nodes.length; ctx.nodes.push(this); }
  Node.prototype.connect = function (n) { this.out.push(n); if (n && n.events) n.inputs.push(this); return n; };
  Node.prototype.disconnect = function () { this.out = []; };
  function src(n) { n.startT = null; n.stopT = null; n.start = function (t) { if (n.startT !== null) throw new Error('start() twice'); n.startT = t === undefined ? 0 : t; }; n.stop = function (t) { n.stopT = t === undefined ? 0 : t; }; return n; }
  function Ctx() {
    this.nodes = []; this.state = 'suspended'; this.sampleRate = 44100; this._t0 = performance.now();
    this.destination = { kind: 'destination', out: [] };
    window.__audio.made++; window.__audio.ctx = this;
  }
  Object.defineProperty(Ctx.prototype, 'currentTime', { get: function () { return (performance.now() - this._t0) / 1000; } });
  Ctx.prototype.resume = function () { this.state = 'running'; window.__audio.resumes++; return Promise.resolve(); };
  Ctx.prototype.createOscillator = function () { var n = src(new Node(this, 'osc')); n.type = 'sine'; n.frequency = new Param('frequency', n, 440); n.detune = new Param('detune', n, 0); return n; };
  Ctx.prototype.createGain = function () { var n = new Node(this, 'gain'); n.gain = new Param('gain', n, 1); return n; };
  Ctx.prototype.createBufferSource = function () { var n = src(new Node(this, 'buffer')); n.buffer = null; n.loop = false; n.playbackRate = new Param('playbackRate', n, 1); return n; };
  Ctx.prototype.createBiquadFilter = function () { var n = new Node(this, 'filter'); n.type = 'lowpass'; n.frequency = new Param('frequency', n, 350); n.Q = new Param('Q', n, 1); return n; };
  Ctx.prototype.createBuffer = function (ch, len, sr) { var d = new Float32Array(len); return { numberOfChannels: ch, length: len, sampleRate: sr, getChannelData: function () { return d; } }; };
  window.AudioContext = Ctx; window.webkitAudioContext = Ctx;
})();`;

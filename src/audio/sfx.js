import { settings } from '../core/settings.js';

// Sons 100 % synthétisés (WebAudio) : nappe ambiante + effets.
// Pas d'assets à charger, et une réverbe générée pour l'espace « cosmique ».
// Trois bus : général → { musique, effets }, chacun avec sa propre réverbe.

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const curve = (v) => Math.pow(Math.max(0, Math.min(100, v)) / 100, 1.6); // perception plus naturelle

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  get enabled() {
    return !this.muted && settings.get('volume.master') > 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    this.reverb.connect(wet).connect(this.master);

    // bus effets / musique (+ leurs envois réverbe, eux aussi soumis au volume)
    this.sfxBus = ctx.createGain();
    this.sfxRev = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.musicRev = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.sfxRev.connect(this.reverb);
    this.musicRev.connect(this.reverb);
    this.applyVolumes(true);

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.startAmbient();
  }

  impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  applyVolumes(instant = false) {
    if (!this.ctx) return;
    const v = settings.get('volume');
    const now = this.ctx.currentTime;
    const set = (node, value) => (instant ? (node.gain.value = value) : node.gain.setTargetAtTime(value, now, 0.08));
    set(this.master, this.muted ? 0 : curve(v.master) * 0.9);
    set(this.sfxBus, curve(v.sfx));
    set(this.sfxRev, curve(v.sfx));
    set(this.musicBus, curve(v.music));
    set(this.musicRev, curve(v.music));
  }

  toggleMute() {
    this.muted = !this.muted;
    this.applyVolumes();
    return !this.muted;
  }

  tone({ freq, type = 'sine', dur = 0.4, vol = 0.15, when = 0, glide = 0, send = 0.5, attack = 0.006 }) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * glide), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.sfxBus);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s).connect(this.sfxRev);
    }
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  noise({ dur = 0.08, vol = 0.05, freq = 1800, q = 1.2, when = 0, send = 0.1 }) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t0 = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    if (send) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s).connect(this.sfxRev);
    }
    src.start(t0, Math.random() * 0.3);
    src.stop(t0 + dur + 0.02);
  }

  startAmbient() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.linearRampToValueAtTime(0.07, ctx.currentTime + 4);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    filter.Q.value = 2;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 380;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
    // Accord suspendu, légèrement désaccordé
    [45, 52, 57, 64, 71].forEach((n, i) => {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = i < 2 ? 'sine' : 'triangle';
        o.frequency.value = midi(n);
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.value = i < 2 ? 0.5 : 0.18;
        o.connect(g).connect(filter);
        o.start();
      }
    });
    filter.connect(out);
    out.connect(this.musicBus);
    const s = ctx.createGain();
    s.gain.value = 0.8;
    out.connect(s).connect(this.musicRev);
  }

  /* ───────────── Effets ───────────── */

  step() {
    this.noise({ dur: 0.05, vol: 0.035, freq: 2400 + Math.random() * 800, q: 2, send: 0.05 });
    this.tone({ freq: 300 + Math.random() * 40, type: 'sine', dur: 0.06, vol: 0.03, send: 0 });
  }

  hover() {
    this.tone({ freq: 1760, type: 'sine', dur: 0.05, vol: 0.012, send: 0.3 });
  }

  click() {
    this.tone({ freq: 1320, type: 'sine', dur: 0.09, vol: 0.05, send: 0.4 });
    this.tone({ freq: 1980, type: 'sine', dur: 0.12, vol: 0.025, when: 0.03, send: 0.5 });
  }

  deny() {
    this.tone({ freq: 220, type: 'triangle', dur: 0.12, vol: 0.05, glide: 0.7, send: 0.1 });
  }

  bump() {
    this.tone({ freq: 140, type: 'sine', dur: 0.12, vol: 0.08, glide: 0.6, send: 0 });
  }

  gem(index = 0) {
    const base = 81 + index * 2;
    [0, 4, 7, 12, 16].forEach((st, i) => this.tone({ freq: midi(base + st), type: 'sine', dur: 0.7, vol: 0.07, when: i * 0.055, send: 0.7 }));
    this.tone({ freq: midi(base + 24), type: 'triangle', dur: 1.2, vol: 0.02, when: 0.28, send: 0.9 });
  }

  button() {
    this.tone({ freq: 180, type: 'sine', dur: 0.25, vol: 0.18, glide: 0.4, send: 0.2 });
    this.noise({ dur: 0.5, vol: 0.05, freq: 600, q: 0.6, send: 0.6 });
  }

  bridge(i) {
    const n = 69 + PENTA[Math.min(i, PENTA.length - 1)];
    this.tone({ freq: midi(n), type: 'triangle', dur: 0.6, vol: 0.06, send: 0.8 });
  }

  star() {
    const chord = [60, 64, 67, 71, 74, 79, 83, 88];
    chord.forEach((n, i) => this.tone({ freq: midi(n), type: i % 2 ? 'triangle' : 'sine', dur: 2.6, vol: 0.06, when: i * 0.09, send: 0.9, attack: 0.02 }));
    this.noise({ dur: 1.6, vol: 0.03, freq: 5000, q: 0.5, when: 0.1, send: 1 });
  }

  start() {
    [64, 71, 76].forEach((n, i) => this.tone({ freq: midi(n), type: 'sine', dur: 1.6, vol: 0.06, when: i * 0.12, send: 0.9, attack: 0.03 }));
  }
}

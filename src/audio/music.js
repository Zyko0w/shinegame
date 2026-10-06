// Musique d'ambiance générative (WebAudio), une « couleur » par émotion.
// Couches : nappe d'accords (oscillateurs désaccordés + filtre), basse,
// motif de cloches en écho, texture. Une progression de 4 accords tourne en
// boucle ; les notes de la mélodie sont tirées dans l'accord courant, donc
// tout reste consonant. Fondu enchaîné quand l'humeur change.
// Le planificateur programme les notes un peu en avance sur l'horloge audio.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};

// root : note MIDI de la tonique ; prog : degrés (0 = I) ; bar : durée d'un accord (s)
export const MOODS = {
  title: { root: 50, scale: 'lydian', prog: [0, 4, 5, 3], bar: 6.5, wave: 'triangle', cutoff: 900, density: 0.35, bell: 1, bass: 0.5, texture: 'shimmer' },
  wonder: { root: 52, scale: 'major', prog: [0, 3, 4, 5], bar: 6, wave: 'triangle', cutoff: 1100, density: 0.45, bell: 1, bass: 0.55, texture: 'shimmer' },
  sad: { root: 45, scale: 'minor', prog: [0, 5, 2, 6], bar: 8, wave: 'sine', cutoff: 650, density: 0.25, bell: 0.8, bass: 0.6, texture: 'rain' },
  lonely: { root: 47, scale: 'dorian', prog: [0, 3, 0, 4], bar: 7.5, wave: 'triangle', cutoff: 800, density: 0.2, bell: 0.9, bass: 0.4, texture: 'wind' },
  fear: { root: 44, scale: 'phrygian', prog: [0, 1, 0, 6], bar: 7, wave: 'sawtooth', cutoff: 420, density: 0.3, bell: 0.6, bass: 0.7, texture: 'tremolo' },
  bitter: { root: 46, scale: 'dorian', prog: [0, 6, 3, 4], bar: 6, wave: 'square', cutoff: 520, density: 0.35, bell: 0.7, bass: 0.65, texture: 'wind' },
  envy: { root: 48, scale: 'dorian', prog: [0, 2, 5, 4], bar: 6.5, wave: 'triangle', cutoff: 950, density: 0.4, bell: 1.1, bass: 0.5, texture: 'shimmer' },
  shame: { root: 46, scale: 'minor', prog: [0, 3, 5, 4], bar: 8, wave: 'sine', cutoff: 560, density: 0.22, bell: 0.7, bass: 0.55, texture: 'wind' },
  dawn: { root: 50, scale: 'major', prog: [0, 4, 5, 3], bar: 7, wave: 'triangle', cutoff: 1300, density: 0.5, bell: 1.3, bass: 0.5, texture: 'shimmer' },
  anger: { root: 43, scale: 'phrygian', prog: [0, 1, 5, 1], bar: 4.5, wave: 'sawtooth', cutoff: 700, density: 0.6, bell: 0.5, bass: 0.9, texture: 'pulse' },
};

export class Music {
  constructor(sfx) {
    this.sfx = sfx;
    this.layer = null; // couche de l'humeur courante
    this.moodName = null;
    this.timer = null;
  }

  get ctx() {
    return this.sfx.ctx;
  }

  // Change d'humeur (fondu enchaîné de ~3 s)
  setMood(name) {
    if (!this.ctx || name === this.moodName || !MOODS[name]) {
      this.pendingMood = name;
      return;
    }
    this.moodName = name;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (this.layer) {
      const old = this.layer;
      old.out.gain.cancelScheduledValues(now);
      old.out.gain.setValueAtTime(old.out.gain.value, now);
      old.out.gain.linearRampToValueAtTime(0, now + 3);
      old.dead = true;
      setTimeout(() => old.nodes.forEach((n) => n.disconnect?.()), 3500);
    }
    this.layer = this.createLayer(MOODS[name]);
    this.layer.out.gain.setValueAtTime(0, now);
    this.layer.out.gain.linearRampToValueAtTime(1, now + 3.5);
    if (!this.timer) this.timer = setInterval(() => this.schedule(), 120);
  }

  // à appeler une fois le contexte audio créé (geste utilisateur)
  start() {
    if (this.pendingMood) {
      const m = this.pendingMood;
      this.pendingMood = null;
      this.setMood(m);
    }
  }

  createLayer(mood) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.connect(this.sfx.musicBus);
    const send = ctx.createGain();
    send.gain.value = 0.9;
    out.connect(send).connect(this.sfx.musicRev);

    // nappe : filtre commun, respiration lente du filtre
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = mood.cutoff;
    padFilter.Q.value = 1.2;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = mood.cutoff * 0.35;
    lfo.connect(lfoGain).connect(padFilter.frequency);
    lfo.start();
    const padGain = ctx.createGain();
    padGain.gain.value = mood.wave === 'sawtooth' || mood.wave === 'square' ? 0.028 : 0.05;
    padFilter.connect(padGain).connect(out);

    // écho pour les cloches
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = (mood.bar / 8) * 1.5;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = 'lowpass';
    echoTone.frequency.value = 2400;
    delay.connect(echoTone).connect(fb).connect(delay);
    const bellBus = ctx.createGain();
    bellBus.gain.value = 0.7;
    bellBus.connect(out);
    bellBus.connect(delay);
    echoTone.connect(out);

    const nodes = [out, send, padFilter, lfo, lfoGain, padGain, delay, fb, echoTone, bellBus];
    const layer = { mood, out, padFilter, bellBus, nodes, nextBar: ctx.currentTime + 0.1, barIndex: 0, nextNote: ctx.currentTime + 0.5, dead: false };
    if (mood.texture) this.startTexture(layer);
    return layer;
  }

  chordNotes(mood, degree, octave = 0) {
    const sc = SCALES[mood.scale];
    const note = (d) => mood.root + octave * 12 + sc[((d % 7) + 7) % 7] + Math.floor(d / 7) * 12;
    return [note(degree), note(degree + 2), note(degree + 4), note(degree + 6)];
  }

  schedule() {
    const L = this.layer;
    if (!L || !this.ctx) return;
    const ctx = this.ctx;
    const ahead = ctx.currentTime + 0.4;
    const m = L.mood;
    // accords
    while (L.nextBar < ahead) {
      const degree = m.prog[L.barIndex % m.prog.length];
      this.playChord(L, degree, L.nextBar, m.bar);
      L.barIndex++;
      L.nextBar += m.bar;
    }
    // mélodie de cloches : croches avec une probabilité « density »
    const stepDur = m.bar / 8;
    while (L.nextNote < ahead) {
      if (Math.random() < m.density) {
        const degree = m.prog[(L.barIndex - 1 + m.prog.length) % m.prog.length];
        const notes = this.chordNotes(m, degree, 2);
        const n = notes[(Math.random() * notes.length) | 0] + (Math.random() < 0.2 ? 12 : 0);
        this.bell(L, midi(n), L.nextNote, m.bell);
      }
      L.nextNote += stepDur;
    }
  }

  playChord(L, degree, t0, dur) {
    const ctx = this.ctx;
    const m = L.mood;
    const notes = this.chordNotes(m, degree, 1);
    const att = Math.min(2.2, dur * 0.35);
    for (const n of notes.slice(0, 3)) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = m.wave;
        o.frequency.value = midi(n);
        o.detune.value = det + (Math.random() - 0.5) * 4;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.5, t0 + att);
        g.gain.setValueAtTime(0.5, t0 + dur - 0.2);
        g.gain.linearRampToValueAtTime(0, t0 + dur + 1.6);
        o.connect(g).connect(L.padFilter);
        o.start(t0);
        o.stop(t0 + dur + 1.7);
      }
    }
    // basse
    const b = ctx.createOscillator();
    b.type = 'sine';
    b.frequency.value = midi(notes[0] - 12);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0, t0);
    bg.gain.linearRampToValueAtTime(0.09 * m.bass, t0 + 0.6);
    bg.gain.linearRampToValueAtTime(0.0001, t0 + dur + 0.5);
    b.connect(bg).connect(L.out);
    b.start(t0);
    b.stop(t0 + dur + 0.6);
  }

  bell(L, freq, t0, amount) {
    const ctx = this.ctx;
    for (const [mul, vol] of [
      [1, 0.05],
      [2.01, 0.018],
      [3.02, 0.008],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * mul;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol * amount, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.2 / mul);
      o.connect(g).connect(L.bellBus);
      o.start(t0);
      o.stop(t0 + 2.3);
    }
  }

  // Texture de fond selon l'émotion (bruit filtré modulé)
  startTexture(L) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.sfx.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    const t = L.mood.texture;
    f.type = t === 'rain' ? 'highpass' : 'bandpass';
    f.frequency.value = { shimmer: 6000, rain: 3500, wind: 500, tremolo: 900, pulse: 160 }[t];
    f.Q.value = t === 'wind' ? 0.7 : 1.5;
    g.gain.value = { shimmer: 0.006, rain: 0.012, wind: 0.02, tremolo: 0.012, pulse: 0.03 }[t];
    mod.frequency.value = { shimmer: 0.2, rain: 0.13, wind: 0.09, tremolo: 6, pulse: 1.5 }[t];
    modGain.gain.value = g.gain.value * 0.8;
    mod.connect(modGain).connect(g.gain);
    src.connect(f).connect(g).connect(L.out);
    src.start();
    mod.start();
    L.nodes.push(src, f, g, mod, modGain);
    const stop = () => {
      try {
        src.stop();
        mod.stop();
      } catch {
        /* déjà arrêté */
      }
    };
    L.stopTexture = stop;
    const iv = setInterval(() => {
      if (L.dead) {
        setTimeout(stop, 3200);
        clearInterval(iv);
      }
    }, 500);
  }
}

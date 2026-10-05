import { settings } from '../core/settings.js';

// Voix des personnages, par ordre de préférence :
// 1. répliques enregistrées (MP3 générés par `npm run voices`, voix neuronales
//    Edge), jouées dans le moteur audio du jeu (volume « Voix », réverbe) ;
// 2. synthèse vocale du navigateur (Web Speech API), voix française ;
// 3. « babillage » synthétisé, calé sur le texte qui s'écrit.
// L'option « Voix humaines » désactivée force le babillage.

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
const BASE = import.meta.env.BASE_URL;

function pickVoices() {
  if (!synth) return [];
  const fr = synth.getVoices().filter((v) => v.lang?.toLowerCase().startsWith('fr'));
  fr.sort((a, b) => score(b) - score(a));
  return fr;
}
function score(v) {
  const n = v.name.toLowerCase();
  return (n.includes('natural') || n.includes('neural') ? 4 : 0) + (n.includes('online') ? 2 : 0) + (v.lang === 'fr-FR' ? 1 : 0) + (v.localService ? 0 : 1);
}

export class Voice {
  constructor(sfx) {
    this.sfx = sfx;
    this.voices = pickVoices();
    synth?.addEventListener?.('voiceschanged', () => (this.voices = pickVoices()));
    this.manifest = {};
    this.raw = new Map(); // clé → ArrayBuffer téléchargé
    this.buffers = new Map(); // clé → AudioBuffer décodé
    this.source = null;
    this.token = 0;
    this.ready = fetch(`${BASE}voices/manifest.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((m) => (this.manifest = m))
      .catch(() => (this.manifest = {}));
  }

  get enabled() {
    return settings.get('voice.human');
  }

  volume() {
    const v = settings.get('volume');
    return Math.max(0, Math.min(1, (v.master / 100) * (v.voice / 100)));
  }

  hasClip(key) {
    return !!key && !!this.manifest[key];
  }

  // Télécharge (et décode si possible) les répliques d'un niveau à l'avance
  async preload(prefix) {
    await this.ready;
    const keys = Object.keys(this.manifest).filter((k) => k.startsWith(prefix));
    await Promise.all(keys.map((k) => this.decode(k).catch(() => {})));
  }

  async decode(key) {
    if (this.buffers.has(key)) return this.buffers.get(key);
    if (!this.raw.has(key)) {
      const res = await fetch(BASE + this.manifest[key].file);
      if (!res.ok) throw new Error(`voix introuvable : ${key}`);
      this.raw.set(key, await res.arrayBuffer());
    }
    const ctx = this.sfx.ctx;
    if (!ctx) return null; // décodé plus tard, quand l'audio aura démarré
    const buf = await ctx.decodeAudioData(this.raw.get(key).slice(0));
    this.buffers.set(key, buf);
    return buf;
  }

  // Durée de l'enregistrement (s) si déjà décodé — sert à caler le texte
  clipDuration(key) {
    return this.buffers.get(key)?.duration ?? null;
  }

  // Dit une réplique ; `onEnd` est appelé à la fin (ou tout de suite si muet)
  say(text, speaker = {}, onEnd, key) {
    this.stop();
    const token = ++this.token;
    const done = () => token === this.token && onEnd?.();
    if (this.volume() <= 0.001 || this.sfx.muted) return done();
    if (!this.enabled) return this.babble(text, speaker, done);
    if (this.hasClip(key) && this.sfx.ctx) {
      this.playClip(key, token, done).catch(() => token === this.token && this.speak(text, speaker, done));
      return;
    }
    if (synth && this.voices.length) return this.speak(text, speaker, done);
    this.babble(text, speaker, done);
  }

  async playClip(key, token, done) {
    const buf = await this.decode(key);
    if (token !== this.token) return; // une autre réplique a pris la place
    if (!buf) throw new Error('audio non initialisé');
    const ctx = this.sfx.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const v = settings.get('volume').voice / 100;
    const gain = ctx.createGain();
    gain.gain.value = Math.pow(v, 1.3) * 1.1;
    src.connect(gain).connect(this.sfx.master);
    // une touche de réverbe pour fondre la voix dans l'espace
    const send = ctx.createGain();
    send.gain.value = 0.12;
    gain.connect(send).connect(this.sfx.reverb);
    src.onended = () => {
      if (this.source === src) this.source = null;
      done();
    };
    this.source = src;
    src.start();
  }

  speak(text, speaker, done) {
    const u = new SpeechSynthesisUtterance(text.replace(/[«»]/g, ''));
    u.voice = this.voices[(speaker.voiceIndex ?? 0) % this.voices.length];
    u.lang = u.voice?.lang ?? 'fr-FR';
    u.pitch = speaker.pitch ?? 1;
    u.rate = speaker.rate ?? 1;
    u.volume = this.volume();
    u.onend = u.onerror = done;
    synth.speak(u);
  }

  // Repli : syllabes synthétisées (style « animalese »), une par 2 lettres
  babble(text, speaker, done) {
    const letters = text.replace(/[^a-zàâçéèêëîïôûùüÿœ]/gi, '');
    const n = Math.min(60, Math.ceil(letters.length / 2));
    const base = 220 * (speaker.pitch ?? 1);
    const step = 0.075 / (speaker.rate ?? 1);
    for (let i = 0; i < n; i++) {
      const c = letters.charCodeAt(i * 2) || 97;
      this.sfx.tone({ freq: base * (1 + (c % 7) * 0.06), type: 'triangle', dur: 0.06, vol: 0.075 * this.volume(), when: i * step, send: 0.15 });
    }
    clearTimeout(this.babbleTimer);
    this.babbleTimer = setTimeout(done, n * step * 1000 + 120);
  }

  stop() {
    this.token++;
    clearTimeout(this.babbleTimer);
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
      } catch {
        /* déjà terminé */
      }
      this.source = null;
    }
    if (synth && (synth.speaking || synth.pending)) synth.cancel();
  }
}

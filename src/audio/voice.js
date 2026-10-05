import { settings } from '../core/settings.js';

// Voix des personnages :
// - synthèse vocale du navigateur (Web Speech API), voix française, avec un
//   timbre propre à chaque personnage (hauteur, débit) ;
// - à défaut (navigateur sans voix, ou option désactivée) : « babillage »
//   synthétisé, de petites syllabes musicales calées sur le texte qui s'écrit.

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

function pickVoices() {
  if (!synth) return [];
  const all = synth.getVoices();
  const fr = all.filter((v) => v.lang?.toLowerCase().startsWith('fr'));
  // les voix « naturelles » / en ligne sonnent beaucoup mieux quand elles existent
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
    this.current = null;
  }

  get human() {
    return !!synth && this.voices.length > 0 && settings.get('voice.human');
  }

  volume() {
    const v = settings.get('volume');
    return Math.max(0, Math.min(1, (v.master / 100) * (v.voice / 100)));
  }

  // Dit une réplique ; `onEnd` appelé à la fin (ou tout de suite si muet)
  say(text, speaker = {}, onEnd) {
    this.stop();
    const vol = this.volume();
    if (vol <= 0.001 || this.sfx.muted) {
      onEnd?.();
      return;
    }
    if (this.human) {
      const u = new SpeechSynthesisUtterance(text.replace(/[«»]/g, ''));
      // une voix par personnage parmi les voix françaises disponibles
      const idx = (speaker.voiceIndex ?? 0) % this.voices.length;
      u.voice = this.voices[idx];
      u.lang = u.voice?.lang ?? 'fr-FR';
      u.pitch = speaker.pitch ?? 1;
      u.rate = speaker.rate ?? 1;
      u.volume = vol;
      u.onend = u.onerror = () => {
        if (this.current === u) this.current = null;
        onEnd?.();
      };
      this.current = u;
      synth.speak(u);
    } else {
      this.babble(text, speaker, onEnd);
    }
  }

  // Repli : syllabes synthétisées (style « animalese »), une par 2 lettres
  babble(text, speaker, onEnd) {
    const sfx = this.sfx;
    const letters = text.replace(/[^a-zàâçéèêëîïôûùüÿœ]/gi, '');
    const n = Math.min(60, Math.ceil(letters.length / 2));
    const base = 220 * (speaker.pitch ?? 1);
    const step = 0.075 / (speaker.rate ?? 1);
    for (let i = 0; i < n; i++) {
      const c = letters.charCodeAt(i * 2) || 97;
      sfx.tone({ freq: base * (1 + (c % 7) * 0.06), type: 'triangle', dur: 0.06, vol: 0.05 * this.volume() * 1.5, when: i * step, send: 0.15 });
    }
    clearTimeout(this.babbleTimer);
    this.babbleTimer = setTimeout(() => onEnd?.(), n * step * 1000 + 120);
  }

  stop() {
    clearTimeout(this.babbleTimer);
    if (synth && (synth.speaking || synth.pending)) synth.cancel();
    this.current = null;
  }
}

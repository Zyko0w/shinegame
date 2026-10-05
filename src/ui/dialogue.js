// Dialogues : bandes cinéma, boîte de texte qui s'écrit, voix.
// Une réplique = { who, text } ; `speakers[who]` donne nom, couleur et voix.
// Avancer : clic / Espace / Entrée / A. Passer : Échap / B.

const $ = (id) => document.getElementById(id);
const CHARS_PER_SEC = 42;

export class Dialogue {
  constructor({ voice, sfx }) {
    this.voice = voice;
    this.sfx = sfx;
    this.el = $('dialogue');
    this.cine = $('cine');
    this.nameEl = $('dlg-name');
    this.textEl = $('dlg-text');
    this.portrait = $('dlg-portrait');
    this.open = false;
    this.el.addEventListener('click', () => this.advance());
  }

  get isOpen() {
    return this.open;
  }

  setCinema(on) {
    this.cine.classList.toggle('is-on', on);
  }

  /**
   * @param {{who: string, text: string}[]} lines
   * @param {Record<string, {name, color, pitch, rate, voiceIndex}>} speakers
   * @param {(who: string, speaking: boolean) => void} onSpeak
   * @returns {Promise<void>} résolue à la fin du dialogue
   */
  play(lines, speakers, onSpeak) {
    this.lines = lines;
    this.speakers = speakers;
    this.onSpeak = onSpeak;
    this.index = -1;
    this.open = true;
    this.el.classList.add('is-visible');
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.next();
    });
  }

  next() {
    this.stopLine();
    this.index++;
    if (this.index >= this.lines.length) return this.close();
    const line = this.lines[this.index];
    const sp = this.speakers[line.who] ?? { name: line.who };
    this.nameEl.textContent = sp.name;
    this.el.style.setProperty('--speaker', sp.color ?? '#79f2ff');
    this.portrait.dataset.who = line.who;
    this.el.classList.toggle('is-lumi', line.who === 'lumi');
    this.textEl.textContent = '';
    this.full = line.text;
    this.shown = 0;
    this.typing = true;
    this.el.classList.remove('can-advance');
    this.sfx.tone({ freq: 880, type: 'sine', dur: 0.08, vol: 0.025, send: 0.4 });

    // texte qui s'écrit, au rythme approximatif de la voix
    const rate = sp.rate ?? 1;
    const start = performance.now();
    const tick = () => {
      if (!this.typing) return;
      // avec un enregistrement : le texte s'écrit au rythme exact de la voix
      const dur = this.voice.clipDuration(line.key);
      const cps = dur ? this.full.length / Math.max(0.6, dur * 0.88) : CHARS_PER_SEC * rate;
      const n = Math.min(this.full.length, Math.floor(((performance.now() - start) / 1000) * cps));
      if (n !== this.shown) {
        this.shown = n;
        this.textEl.textContent = this.full.slice(0, n);
      }
      if (n >= this.full.length) this.endTyping();
      else this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);

    this.onSpeak?.(line.who, true);
    this.voice.say(line.text, sp, () => this.onSpeak?.(line.who, false), line.key);
  }

  endTyping() {
    this.typing = false;
    cancelAnimationFrame(this.raf);
    this.textEl.textContent = this.full;
    this.el.classList.add('can-advance');
  }

  stopLine() {
    cancelAnimationFrame(this.raf);
    this.typing = false;
    this.voice.stop();
    const prev = this.lines?.[this.index];
    if (prev) this.onSpeak?.(prev.who, false);
  }

  // Clic / Espace / A : termine l'écriture, sinon réplique suivante
  advance() {
    if (!this.open) return;
    if (this.typing) this.endTyping();
    else this.next();
  }

  skip() {
    if (this.open) this.close();
  }

  close() {
    this.stopLine();
    this.open = false;
    this.el.classList.remove('is-visible', 'can-advance');
    const r = this.resolve;
    this.resolve = null;
    r?.();
  }
}

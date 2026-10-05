import { settings, ACTIONS, RESOLUTIONS, FPS_LIMITS, keyLabel } from '../core/settings.js';
import { TIERS, MAX_TIER } from '../core/quality.js';

// Écran Paramètres : onglets Graphismes / Audio / Commandes.
// Chaque contrôle écrit directement dans `settings` ; main.js écoute
// settings.onChange pour appliquer (qualité, volumes, touches…).

const $ = (id) => document.getElementById(id);
const RESERVED = new Set(['Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'MetaLeft', 'MetaRight']);

export class SettingsPanel {
  constructor({ onTestSound, onHoverSound, getLiveInfo }) {
    this.root = $('settings');
    this.onTestSound = onTestSound;
    this.getLiveInfo = getLiveInfo;
    this.listening = null;
    this.tab = 'gfx';

    this.fillSelect('set-quality', [{ id: 'auto', label: 'Auto (adaptatif)' }, ...TIERS.map((t, i) => ({ id: String(i), label: t.name[0].toUpperCase() + t.name.slice(1) }))]);
    this.fillSelect('set-resolution', RESOLUTIONS);
    this.fillSelect('set-fps', FPS_LIMITS.map((f) => ({ id: String(f.id), label: f.label })));

    // Onglets (clic + flèches gauche/droite, motif ARIA tabs)
    this.tabs = [...this.root.querySelectorAll('.tab')];
    this.tabs.forEach((t) => {
      t.addEventListener('click', () => this.showTab(t.dataset.tab));
      t.addEventListener('keydown', (e) => {
        const i = this.tabs.indexOf(t);
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const n = this.tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + this.tabs.length) % this.tabs.length];
          this.showTab(n.dataset.tab);
          n.focus();
        }
      });
    });

    // Graphismes
    $('set-quality').addEventListener('change', (e) => settings.set('quality', e.target.value === 'auto' ? 'auto' : +e.target.value));
    $('set-resolution').addEventListener('change', (e) => settings.set('resolution', e.target.value));
    $('set-fps').addEventListener('change', (e) => settings.set('fpsLimit', +e.target.value));
    $('set-showfps').addEventListener('change', (e) => settings.set('showFps', e.target.checked));
    const fx = { 'set-ao': 'ao', 'set-godrays': 'godRays', 'set-tilt': 'tilt', 'set-ca': 'aberration' };
    for (const [id, key] of Object.entries(fx)) $(id).addEventListener('change', (e) => settings.set(`effects.${key}`, e.target.checked));

    // Audio
    for (const k of ['master', 'music', 'sfx', 'voice']) {
      const input = $(`set-vol-${k}`);
      input.addEventListener('input', () => {
        this.paintSlider(input);
        settings.set(`volume.${k}`, +input.value);
      });
    }
    $('btn-test-sound').addEventListener('click', () => this.onTestSound?.());
    $('set-voice-human').addEventListener('change', (e) => settings.set('voice.human', e.target.checked));

    // Manette
    $('set-pad-vibration').addEventListener('change', (e) => settings.set('gamepad.vibration', e.target.checked));
    const sens = $('set-pad-sens');
    sens.addEventListener('input', () => {
      this.paintSlider(sens);
      settings.set('gamepad.sensitivity', +sens.value);
    });

    // Commandes
    this.bindingsEl = $('bindings');
    this.buildBindings();

    $('btn-settings-reset').addEventListener('click', () => {
      if (this.tab === 'keys') settings.reset('gamepad');
      const section = { gfx: null, audio: 'volume', keys: 'bindings' }[this.tab];
      if (section) settings.reset(section);
      else {
        settings.set('quality', 'auto');
        settings.set('resolution', 'auto');
        settings.set('fpsLimit', 0);
        settings.set('showFps', false);
        settings.reset('effects');
      }
      this.sync();
    });

    this.root.querySelectorAll('button, select, input').forEach((el) => el.addEventListener('pointerenter', () => onHoverSound?.()));

    // Capture d'une nouvelle touche (phase de capture : passe avant le jeu)
    window.addEventListener('keydown', (e) => this.captureKey(e), true);
    this.sync();
  }

  fillSelect(id, options) {
    $(id).innerHTML = options.map((o) => `<option value="${o.id}">${o.label}</option>`).join('');
  }

  paintSlider(input) {
    input.style.setProperty('--p', `${input.value}%`);
    $(`${input.id}-out`).textContent = input.value;
  }

  showTab(name) {
    this.tab = name;
    this.cancelListening();
    this.tabs.forEach((t, i) => {
      const on = t.dataset.tab === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on) this.root.querySelector('.tab-ink').style.transform = `translateX(${i * 100}%)`;
    });
    this.root.querySelectorAll('.panel').forEach((p) => {
      const on = p.id === `panel-${name}`;
      p.classList.toggle('is-active', on);
      p.hidden = !on;
    });
  }

  buildBindings() {
    this.bindingsEl.innerHTML = '';
    this.keyButtons = {};
    for (const a of ACTIONS) {
      const row = document.createElement('div');
      row.className = 'bind-row';
      row.innerHTML = `<span class="bind-label">${a.label}</span><button class="bind-key" type="button" aria-label="${a.label} : changer la touche"></button>`;
      const btn = row.querySelector('.bind-key');
      btn.addEventListener('click', () => this.startListening(a.id, btn));
      this.bindingsEl.appendChild(row);
      this.keyButtons[a.id] = btn;
    }
  }

  startListening(action, btn) {
    this.cancelListening();
    this.listening = { action, btn };
    btn.classList.add('is-listening');
    btn.textContent = 'Appuie…';
  }

  cancelListening() {
    if (!this.listening) return;
    const { action, btn } = this.listening;
    btn.classList.remove('is-listening');
    btn.textContent = keyLabel(settings.get(`bindings.${action}`));
    this.listening = null;
  }

  captureKey(e) {
    if (!this.listening) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.code === 'Escape') return this.cancelListening();
    const { action, btn } = this.listening;
    if (RESERVED.has(e.code)) {
      btn.classList.remove('is-conflict');
      void btn.offsetWidth;
      btn.classList.add('is-conflict');
      return;
    }
    // Si la touche est déjà prise, on échange les deux assignations
    const other = settings.actionForCode(e.code);
    const previous = settings.get(`bindings.${action}`);
    if (other && other !== action) {
      settings.set(`bindings.${other}`, previous);
      const row = this.keyButtons[other].parentElement;
      row.classList.add('flash');
      setTimeout(() => row.classList.remove('flash'), 900);
    }
    settings.set(`bindings.${action}`, e.code);
    this.listening = null;
    btn.classList.remove('is-listening');
    this.sync();
    btn.focus();
  }

  sync() {
    const q = settings.get('quality');
    $('set-quality').value = q === 'auto' ? 'auto' : String(Math.min(q, MAX_TIER));
    $('set-resolution').value = settings.get('resolution');
    $('set-fps').value = String(settings.get('fpsLimit'));
    $('set-showfps').checked = settings.get('showFps');
    const fx = settings.get('effects');
    $('set-ao').checked = fx.ao;
    $('set-godrays').checked = fx.godRays;
    $('set-tilt').checked = fx.tilt;
    $('set-ca').checked = fx.aberration;
    for (const k of ['master', 'music', 'sfx', 'voice']) {
      const input = $(`set-vol-${k}`);
      input.value = settings.get(`volume.${k}`);
      this.paintSlider(input);
    }
    for (const a of ACTIONS) this.keyButtons[a.id].textContent = keyLabel(settings.get(`bindings.${a.id}`));
    $('set-pad-vibration').checked = settings.get('gamepad.vibration');
    $('set-voice-human').checked = settings.get('voice.human');
    $('set-pad-sens').value = settings.get('gamepad.sensitivity');
    this.paintSlider($('set-pad-sens'));
  }

  setPadStatus(name) {
    const el = $('pad-status');
    el.textContent = name ? `connectée : ${name.replace(/\s*\(.*\)\s*/g, ' ').trim().slice(0, 48)}` : 'aucune manette détectée — appuie sur un bouton';
    el.classList.toggle('on', !!name);
  }

  // Onglet précédent / suivant (LB / RB)
  cycleTab(delta) {
    const i = this.tabs.findIndex((t) => t.dataset.tab === this.tab);
    const n = this.tabs[(i + delta + this.tabs.length) % this.tabs.length];
    this.showTab(n.dataset.tab);
    n.focus();
  }

  // Ligne d'infos en direct (rafraîchie 2×/s, seulement panneau ouvert)
  updateLive(dt = 1) {
    if (!this.isOpen) return;
    this.liveClock = (this.liveClock ?? 0) + dt;
    if (this.liveClock < 0.5) return;
    this.liveClock = 0;
    $('set-live').textContent = this.getLiveInfo?.() ?? '';
  }

  get isOpen() {
    return this.root.classList.contains('is-visible');
  }

  open() {
    this.sync();
    this.showTab(this.tab);
    this.root.classList.add('is-visible');
    this.root.setAttribute('aria-hidden', 'false');
    this.updateLive();
    setTimeout(() => this.tabs.find((t) => t.dataset.tab === this.tab)?.focus({ preventScroll: true }), 50);
  }

  close() {
    this.cancelListening();
    this.root.classList.remove('is-visible');
    this.root.setAttribute('aria-hidden', 'true');
  }
}

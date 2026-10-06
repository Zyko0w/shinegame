// Paramètres du joueur, persistés dans localStorage.
// Les touches sont stockées par code physique (e.code) : indépendant du
// clavier AZERTY/QWERTY, seul l'affichage s'adapte.

const KEY = 'shine:settings';
const isFrench = (navigator.language || '').toLowerCase().startsWith('fr');

export const ACTIONS = [
  { id: 'up', label: 'Avancer' },
  { id: 'down', label: 'Reculer' },
  { id: 'left', label: 'Aller à gauche' },
  { id: 'right', label: 'Aller à droite' },
  { id: 'camLeft', label: 'Tourner la caméra ⟲' },
  { id: 'camRight', label: 'Tourner la caméra ⟳' },
  { id: 'recenter', label: 'Recentrer la caméra' },
  { id: 'restart', label: 'Recommencer le niveau' },
  { id: 'interact', label: 'Parler / interagir' },
  { id: 'mute', label: 'Couper le son' },
  { id: 'perf', label: 'Afficher les performances' },
];

export const RESOLUTIONS = [
  { id: 'auto', label: 'Auto (adaptative)' },
  { id: 'native', label: "Native (densité de l'écran)" },
  { id: '2160', label: '2160p — 4K' },
  { id: '1440', label: '1440p — QHD' },
  { id: '1080', label: '1080p — Full HD' },
  { id: '900', label: '900p' },
  { id: '720', label: '720p — HD' },
];

export const FPS_LIMITS = [
  { id: 0, label: 'Synchro écran' },
  { id: 30, label: '30 i/s' },
  { id: 60, label: '60 i/s' },
  { id: 120, label: '120 i/s' },
  { id: 144, label: '144 i/s' },
  { id: 240, label: '240 i/s' },
  { id: -1, label: 'Illimité' },
];

export const DEFAULTS = {
  quality: 'auto', // 'auto' | index de palier
  resolution: 'auto',
  effects: { ao: true, godRays: true, tilt: true, aberration: true },
  showFps: false,
  fpsLimit: 0, // 0 = synchro écran, -1 = illimité
  volume: { master: 80, music: 60, sfx: 80, voice: 90 },
  voice: { human: true },
  gamepad: { vibration: true, sensitivity: 55 },
  bindings: {
    up: 'KeyW',
    down: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    camLeft: 'KeyQ',
    camRight: 'KeyE',
    recenter: 'KeyC',
    restart: 'KeyR',
    interact: 'Space',
    mute: isFrench ? 'Semicolon' : 'KeyM', // la touche « M » d'un clavier AZERTY
    perf: 'KeyF',
  },
};

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

function merge(base, extra) {
  const out = clone(base);
  if (!extra || typeof extra !== 'object') return out;
  for (const k of Object.keys(out)) {
    if (!(k in extra)) continue;
    if (out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = merge(out[k], extra[k]);
    // valeur sauvegardée d'un autre type (stockage modifié ou corrompu) : défaut
    // (`quality` vaut 'auto' ou un numéro de palier)
    else if (typeof extra[k] === typeof out[k] || k === 'quality') out[k] = extra[k];
  }
  return out;
}

class Settings {
  constructor() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(KEY));
    } catch {
      /* stockage indisponible ou corrompu */
    }
    // migration de l'ancien réglage du son
    try {
      if (!saved && localStorage.getItem('shine:sound') === 'off') saved = { volume: { master: 0 } };
    } catch {
      /* ignore */
    }
    this.data = merge(DEFAULTS, saved);
    this.listeners = new Set();
  }

  get(path) {
    return path.split('.').reduce((o, k) => o?.[k], this.data);
  }

  set(path, value) {
    const keys = path.split('.');
    let o = this.data;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys[keys.length - 1]] = value;
    this.save();
    for (const fn of this.listeners) fn(path, value);
  }

  reset(section) {
    this.data[section] = clone(DEFAULTS[section]);
    this.save();
    for (const fn of this.listeners) fn(section, this.data[section]);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
  }

  actionForCode(code) {
    const b = this.data.bindings;
    for (const id in b) if (b[id] === code) return id;
    return null;
  }
}

export const settings = new Settings();

/* ───────────── Libellés de touches ───────────── */

// Libellé affiché pour un code physique. Utilise la Keyboard API quand elle
// existe (Chrome/Edge), sinon devine AZERTY pour les navigateurs en français.
const AZERTY = { KeyQ: 'A', KeyW: 'Z', KeyA: 'Q', KeyZ: 'W', Semicolon: 'M', KeyM: ',' };
const NAMED = {
  Space: 'Espace', Enter: 'Entrée', Tab: 'Tab', Backspace: '⌫', ShiftLeft: 'Maj', ShiftRight: 'Maj D',
  ControlLeft: 'Ctrl', ControlRight: 'Ctrl D', AltLeft: 'Alt', AltRight: 'Alt Gr',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Échap',
};
let layoutMap = null;

export async function initKeyLabels() {
  try {
    if (navigator.keyboard?.getLayoutMap) layoutMap = await navigator.keyboard.getLayoutMap();
  } catch {
    layoutMap = null;
  }
}

export function keyLabel(code) {
  if (!code) return '—';
  if (NAMED[code]) return NAMED[code];
  const fromMap = layoutMap?.get(code);
  if (fromMap) return fromMap.toUpperCase();
  if (isFrench && AZERTY[code]) return AZERTY[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Pavé ' + code.slice(6);
  return code;
}

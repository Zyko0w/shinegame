import { settings } from './settings.js';

// Qualité : un palier règle les effets (AO, god rays, bloom, ombres) et,
// en résolution « auto », la densité de pixels.
//
// Régulateur automatique, conçu pour ne PAS osciller :
// - on ne descend qu'après deux fenêtres lentes consécutives (pas sur un
//   simple à-coup isolé) ;
// - on ne monte que si le temps GPU mesuré laisse une vraie marge (< 55 %
//   du budget) pendant plusieurs fenêtres. Sans mesure GPU (Firefox), on ne
//   monte jamais seul : la synchro écran masque la marge disponible ;
// - un palier qui a échoué est banni de plus en plus longtemps ;
// - les mesures sont ignorées juste après un changement (recompilations).

export const DEVICE_PR = Math.min(window.devicePixelRatio || 1, 2);

export const TIERS = [
  { name: 'éco', pixelRatio: 0.7, ao: false, aoMode: 'Performance', godRays: 24, bloomLevels: 4, shadow: 1024, tilt: false, aa: 'fxaa' },
  { name: 'basse', pixelRatio: 0.85, ao: false, aoMode: 'Performance', godRays: 36, bloomLevels: 5, shadow: 1024, tilt: true, aa: 'fxaa' },
  { name: 'moyenne', pixelRatio: 1, ao: false, aoMode: 'Performance', godRays: 48, bloomLevels: 6, shadow: 2048, tilt: true, aa: 'fxaa' },
  { name: 'haute', pixelRatio: Math.min(DEVICE_PR, 1.5), ao: true, aoMode: 'Low', godRays: 60, bloomLevels: 6, shadow: 2048, tilt: true, aa: 'fxaa' },
  { name: 'ultra', pixelRatio: DEVICE_PR, ao: true, aoMode: 'Medium', godRays: 60, bloomLevels: 7, shadow: 2048, tilt: true, aa: 'smaa' },
];

export const MAX_TIER = TIERS.length - 1;
const WINDOW = 1.5; // s

function loadSavedTier() {
  try {
    const v = parseInt(localStorage.getItem('shine:tier'), 10);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

// Densité de pixels pour une résolution cible (hauteur de rendu en pixels)
export function pixelRatioFor(resolution, tier) {
  if (resolution === 'auto') return tier.pixelRatio;
  if (resolution === 'native') return DEVICE_PR;
  const h = parseInt(resolution, 10);
  return Math.max(0.4, Math.min(2, h / window.innerHeight));
}

export class Quality {
  constructor(stats, apply) {
    this.stats = stats;
    this.apply = apply;
    const q = settings.get('quality');
    this.auto = q === 'auto';
    this.tier = this.auto ? Math.min(loadSavedTier() ?? 2, MAX_TIER) : q;
    this.clock = 0;
    this.window = 0;
    this.frames = 0;
    this.slowWindows = 0;
    this.goodWindows = 0;
    this.settleUntil = 0;
    this.failures = new Array(TIERS.length).fill(0);
    this.bannedUntil = new Array(TIERS.length).fill(0);
    this.paused = false; // transitions de niveau, onglet masqué…
    // Une montée de palier peut recompiler des shaders (AO, AA) : on ne
    // l'applique qu'à un moment sûr (pause, fondu), jamais en plein jeu.
    this.canUpgradeNow = () => true;
    this.pendingTier = null;
    this.refresh();
  }

  get fps() {
    return this.stats.fps;
  }

  // Applique palier + résolution + effets activés dans les paramètres
  refresh() {
    const base = TIERS[this.tier];
    const fx = settings.get('effects');
    this.apply({
      ...base,
      pixelRatio: pixelRatioFor(settings.get('resolution'), base),
      ao: base.ao && fx.ao,
      godRaysOn: fx.godRays,
      tilt: base.tilt && fx.tilt,
      aberration: fx.aberration,
    });
    this.settleUntil = this.clock + 2.5;
    this.slowWindows = this.goodWindows = 0;
    this.onChange?.();
  }

  setMode(mode) {
    this.auto = mode === 'auto';
    if (!this.auto) this.tier = mode;
    this.refresh();
  }

  set(tier) {
    tier = Math.max(0, Math.min(MAX_TIER, tier));
    this.pendingTier = null;
    if (tier === this.tier) return;
    this.tier = tier;
    this.refresh();
    try {
      localStorage.setItem('shine:tier', String(tier));
    } catch {
      /* stockage indisponible */
    }
  }

  // Applique une montée de palier en attente (appelé aux moments sûrs)
  flush() {
    if (this.auto && this.pendingTier !== null) this.set(this.pendingTier);
  }

  // Appelé à chaque image avec le dt réel
  sample(dt) {
    this.clock += dt;
    this.window += dt;
    this.frames++;
    if (this.window < WINDOW) return;
    this.stats.summarize(this.frames);
    this.window = 0;
    this.frames = 0;
    if (!this.auto || this.paused || document.hidden || this.clock < this.settleUntil) return;

    const s = this.stats;
    const budget = s.refreshMs;
    const gpuKnown = Number.isFinite(s.gpuMs);
    const slow = s.avgMs > budget * 1.22 && (!gpuKnown || s.gpuMs > budget * 0.75);

    if (slow) {
      this.goodWindows = 0;
      if (++this.slowWindows >= 2 && this.tier > 0) {
        this.failures[this.tier]++;
        this.bannedUntil[this.tier] = this.clock + 60 * this.failures[this.tier] ** 2;
        this.set(this.tier - 1);
      }
      return;
    }
    this.slowWindows = 0;

    const headroom = gpuKnown && s.gpuMs < budget * 0.55 && s.avgMs < budget * 1.08;
    if (headroom) {
      const next = this.tier + 1;
      if (++this.goodWindows >= 4 && next <= MAX_TIER && this.clock > this.bannedUntil[next]) {
        if (this.canUpgradeNow()) this.set(next);
        else this.pendingTier = next;
      }
    } else this.goodWindows = 0;
  }
}

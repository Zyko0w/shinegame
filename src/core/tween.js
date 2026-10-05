// Mini moteur de tweens piloté par la boucle de jeu (pas de rAF séparé,
// donc tout se met en pause avec le jeu).

export const ease = {
  linear: (t) => t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  inCubic: (t) => t * t * t,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outElastic: (t) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
};

export class Tweens {
  constructor() {
    this.list = [];
  }

  add({ duration = 1, delay = 0, ease: e = ease.linear, onStart, onUpdate, onComplete }) {
    const tw = { t: -delay, duration, ease: e, onStart, onUpdate, onComplete, started: false, dead: false };
    this.list.push(tw);
    return tw;
  }

  wait(delay, fn) {
    return this.add({ duration: 0.0001, delay, onComplete: fn });
  }

  kill(tw) {
    if (tw) tw.dead = true;
  }

  clear() {
    this.list.length = 0;
  }

  update(dt) {
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const tw = list[i];
      if (tw.dead) {
        list.splice(i, 1);
        continue;
      }
      tw.t += dt;
      if (tw.t < 0) continue;
      if (!tw.started) {
        tw.started = true;
        tw.onStart?.();
      }
      const k = Math.min(1, tw.t / tw.duration);
      tw.onUpdate?.(tw.ease(k), k);
      if (k >= 1) {
        tw.dead = true;
        list.splice(i, 1);
        tw.onComplete?.();
      }
    }
  }
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

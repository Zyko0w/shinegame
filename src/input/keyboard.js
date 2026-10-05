import { settings } from '../core/settings.js';

// Clavier — touches configurables (Paramètres > Commandes), lues par code
// physique. Les flèches déplacent toujours Lumi, en plus des touches choisies.

const ARROWS = { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
const MOVE_ACTIONS = { up: [1, 0], down: [-1, 0], left: [0, -1], right: [0, 1] };

export function moveVector(code) {
  if (ARROWS[code]) return ARROWS[code];
  return MOVE_ACTIONS[settings.actionForCode(code)] ?? null;
}

export class KeyboardInput {
  /**
   * @param {object} h
   * @param {(e: KeyboardEvent) => boolean} h.intercept  renvoie true si la touche est consommée (menus, fenêtres)
   * @param {() => boolean} h.canMove
   * @param {(action: string) => void} h.onAction        action configurable (hors déplacement)
   * @param {() => void} h.onMoveKey
   */
  constructor(h) {
    this.h = h;
    this.held = [];
    window.addEventListener('keydown', (e) => this.down(e));
    window.addEventListener('keyup', (e) => {
      const i = this.held.indexOf(e.code);
      if (i >= 0) this.held.splice(i, 1);
    });
    window.addEventListener('blur', () => (this.held.length = 0));
  }

  down(e) {
    if (this.h.intercept(e)) return;
    const action = settings.actionForCode(e.code);
    if (this.h.canMove() && moveVector(e.code)) {
      e.preventDefault();
      if (!this.held.includes(e.code)) this.held.push(e.code);
      this.h.onMoveKey?.();
      return;
    }
    if (action && !e.repeat) this.h.onAction(action);
  }

  // Direction maintenue la plus récente : [avant, côté] ou null
  direction() {
    return this.held.length ? moveVector(this.held[this.held.length - 1]) : null;
  }
}

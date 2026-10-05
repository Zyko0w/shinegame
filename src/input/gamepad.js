// Manette (Gamepad API, mapping « standard » Xbox / PlayStation).
// Interroge l'état à chaque frame, produit des événements de bouton
// (front montant) et des directions de navigation avec répétition auto.

export const BTN = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, LS: 10, RS: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
};

const DEADZONE = 0.22;
const NAV_THRESHOLD = 0.55;
const REPEAT_DELAY = 0.38;
const REPEAT_RATE = 0.11;

function dz(v) {
  const a = Math.abs(v);
  if (a < DEADZONE) return 0;
  return Math.sign(v) * ((a - DEADZONE) / (1 - DEADZONE));
}

export class GamepadInput {
  constructor() {
    this.index = null;
    this.prev = new Array(17).fill(false);
    this.pressed = new Array(17).fill(false);
    this.left = { x: 0, y: 0 };
    this.right = { x: 0, y: 0 };
    this.nav = { dir: null, timer: 0 };
    this.onButton = null; // (btn) => void, au front montant
    this.onNav = null; // ('up'|'down'|'left'|'right') => void, avec répétition
    this.onConnect = null;
    this.onDisconnect = null;
    this.active = false; // dernière entrée venue de la manette

    window.addEventListener('gamepadconnected', (e) => {
      if (this.index === null) this.index = e.gamepad.index;
      this.onConnect?.(e.gamepad);
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index === this.index) {
        this.index = null;
        this.active = false;
        this.onDisconnect?.(e.gamepad);
      }
    });
  }

  get connected() {
    return this.index !== null;
  }

  pad() {
    if (this.index === null || !navigator.getGamepads) return null;
    return navigator.getGamepads()[this.index] ?? null;
  }

  update(dt) {
    const pad = this.pad();
    if (!pad) return;

    for (let i = 0; i < this.pressed.length; i++) {
      const b = pad.buttons[i];
      this.pressed[i] = !!b && (b.pressed || b.value > 0.5);
    }
    this.left.x = dz(pad.axes[0] ?? 0);
    this.left.y = dz(pad.axes[1] ?? 0);
    this.right.x = dz(pad.axes[2] ?? 0);
    this.right.y = dz(pad.axes[3] ?? 0);

    let any = false;
    for (let i = 0; i < this.pressed.length; i++) {
      if (this.pressed[i] && !this.prev[i]) {
        any = true;
        this.onButton?.(i);
      }
      this.prev[i] = this.pressed[i];
    }
    if (any || Math.hypot(this.left.x, this.left.y) > 0.3 || Math.hypot(this.right.x, this.right.y) > 0.3) this.active = true;

    // Navigation : croix directionnelle ou stick gauche, avec répétition
    let dir = null;
    if (this.pressed[BTN.UP] || this.left.y < -NAV_THRESHOLD) dir = 'up';
    else if (this.pressed[BTN.DOWN] || this.left.y > NAV_THRESHOLD) dir = 'down';
    else if (this.pressed[BTN.LEFT] || this.left.x < -NAV_THRESHOLD) dir = 'left';
    else if (this.pressed[BTN.RIGHT] || this.left.x > NAV_THRESHOLD) dir = 'right';
    if (dir !== this.nav.dir) {
      this.nav.dir = dir;
      this.nav.timer = REPEAT_DELAY;
      if (dir) this.onNav?.(dir);
    } else if (dir) {
      this.nav.timer -= dt;
      if (this.nav.timer <= 0) {
        this.nav.timer = REPEAT_RATE;
        this.onNav?.(dir);
      }
    }
  }

  // Direction de déplacement continue (croix prioritaire sur le stick)
  moveAxis() {
    let x = this.left.x;
    let y = this.left.y;
    if (this.pressed[BTN.LEFT]) x = -1;
    if (this.pressed[BTN.RIGHT]) x = 1;
    if (this.pressed[BTN.UP]) y = -1;
    if (this.pressed[BTN.DOWN]) y = 1;
    return { x, y };
  }

  rumble(strong = 0.4, weak = 0.6, duration = 120) {
    const act = this.pad()?.vibrationActuator;
    if (!act) return;
    try {
      act.playEffect?.('dual-rumble', { duration, strongMagnitude: strong, weakMagnitude: weak });
    } catch {
      /* non supporté */
    }
  }
}

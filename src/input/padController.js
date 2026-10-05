import { GamepadInput, BTN } from './gamepad.js';
import { moveFocus, moveFocusSpatial, adjustFocused, activateFocused } from '../ui/focusNav.js';
import { settings } from '../core/settings.js';

// Branche la manette sur le jeu : navigation dans les menus (focus),
// déplacement, caméra, raccourcis, vibrations.

export class PadController {
  /**
   * @param {object} c contexte fourni par main.js
   * @param {() => HTMLElement|null} c.container  fenêtre/menu actif (null = en jeu)
   * @param {() => boolean} c.playing
   * @param {object} c.ui, c.settingsPanel, c.sfx, c.rig, c.cursor
   * @param {object} c.actions { pause, resume, closeSettings, rotate, recenter, restart }
   */
  constructor(c) {
    this.c = c;
    this.pad = new GamepadInput();
    this.restartHold = 0;
    this.pad.onConnect = (g) => {
      c.settingsPanel.setPadStatus(g.id);
      c.ui.toast('Manette connectée', { color: 'var(--cyan)', duration: 2400 });
    };
    this.pad.onDisconnect = () => {
      c.settingsPanel.setPadStatus(null);
      c.ui.toast('Manette déconnectée', { color: 'var(--rose)', duration: 2400 });
    };
    this.pad.onNav = (dir) => this.nav(dir);
    this.pad.onButton = (b) => this.button(b);
    window.addEventListener('pointermove', () => this.setNavMode(false), { passive: true });
  }

  get connected() {
    return this.pad.connected;
  }

  // Focus visible + curseur 3D masqué quand on joue à la manette
  setNavMode(on) {
    if (document.body.classList.contains('pad-nav') === on) return;
    document.body.classList.toggle('pad-nav', on);
    if (on) this.c.cursor.hide();
  }

  rumble(strong, weak, ms) {
    if (settings.get('gamepad.vibration')) this.pad.rumble(strong, weak, ms);
  }

  nav(dir) {
    const box = this.c.container();
    if (!box) return; // en jeu : déplacement continu (voir moveDirection)
    const { ui, settingsPanel, sfx } = this.c;
    this.setNavMode(true);
    sfx.hover();
    if (box.id === 'title') {
      ui.menuKey({ code: dir === 'up' ? 'ArrowUp' : dir === 'down' ? 'ArrowDown' : '' });
      return;
    }
    if (box.id === 'levels') return moveFocusSpatial(box, dir);
    if (dir === 'left' || dir === 'right') {
      const delta = dir === 'left' ? -1 : 1;
      if (document.activeElement?.classList.contains('tab')) return settingsPanel.cycleTab(delta);
      if (!adjustFocused(delta)) moveFocus(box, delta);
      return;
    }
    moveFocus(box, dir === 'up' ? -1 : 1);
  }

  button(b) {
    const { ui, settingsPanel, sfx, actions } = this.c;
    sfx.init();
    const box = this.c.container();
    this.setNavMode(true);
    if (this.c.dialogue?.isOpen) {
      if (b === BTN.A) this.c.dialogue.advance();
      else if (b === BTN.B || b === BTN.START) this.c.dialogue.skip();
      return;
    }
    if (box) {
      if (b === BTN.A) {
        if (box.id === 'title' && !box.contains(document.activeElement)) ui.selectMenu(ui.menuIndex);
        else if (!box.contains(document.activeElement)) moveFocus(box, 1);
        activateFocused();
      } else if (b === BTN.B) {
        if (settingsPanel.isOpen) actions.closeSettings();
        else if (box.id === 'levels' || box.id === 'credits') ui.closeTopModal();
        else if (box.id === 'pause') actions.resume();
      } else if ((b === BTN.LB || b === BTN.RB) && settingsPanel.isOpen) {
        settingsPanel.cycleTab(b === BTN.LB ? -1 : 1);
      } else if (b === BTN.START && box.id === 'pause') {
        actions.resume();
      }
      return;
    }
    if (!this.c.playing()) return;
    if (b === BTN.A) actions.interact?.();
    else if (b === BTN.START) actions.pause();
    else if (b === BTN.LB) actions.rotate(-1);
    else if (b === BTN.RB) actions.rotate(1);
    else if (b === BTN.Y) actions.recenter();
    else if (b === BTN.X) ui.toast('Maintiens X pour recommencer le niveau', { duration: 1600 });
  }

  // Direction de déplacement [avant, côté] depuis le stick gauche / la croix
  moveDirection() {
    if (!this.pad.connected || this.c.container()) return null;
    const a = this.pad.moveAxis();
    return Math.hypot(a.x, a.y) > 0.5 ? [-a.y, a.x] : null;
  }

  update(dt) {
    this.pad.update(dt);
    if (!this.pad.connected || !this.c.playing() || this.c.container()) {
      this.restartHold = 0;
      return;
    }
    // Caméra : stick droit (orbite + inclinaison), gâchettes (zoom)
    const sens = settings.get('gamepad.sensitivity') / 55;
    const { x, y } = this.pad.right;
    const zoom = (this.pad.pressed[BTN.LT] ? 1 : 0) - (this.pad.pressed[BTN.RT] ? 1 : 0);
    if (x || y || zoom) this.c.rig.orbitBy(-x * dt * 1.8 * sens, y * dt * 1.3 * sens, zoom * dt * 0.9);
    // X maintenu : recommencer
    if (this.pad.pressed[BTN.X]) {
      this.restartHold += dt;
      if (this.restartHold > 0.8) {
        this.restartHold = 0;
        this.c.actions.restart();
      }
    } else this.restartHold = 0;
  }
}

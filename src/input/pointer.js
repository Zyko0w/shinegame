import * as THREE from 'three';

// Souris / tactile : survol d'une case (cadre + chemin prévisualisé),
// clic ou tap pour s'y rendre, glisser pour tourner (laissé à OrbitControls).
// Le raycast ne vise qu'un InstancedMesh invisible d'une colonne par case.

export class PointerInput {
  /**
   * @param {object} o
   * @param {HTMLCanvasElement} o.canvas
   * @param {THREE.Camera} o.camera
   * @param {() => boolean} o.enabled      interaction autorisée (état « play »)
   * @param {() => any} o.level            niveau courant
   * @param {(tile) => any[]|null} o.pathTo chemin depuis la position de Lumi
   * @param {(tile, path) => void} o.onHover
   * @param {() => void} o.onHoverEnd
   * @param {(tile, path) => void} o.onSelect
   * @param {(tile) => any} [o.remap]       case réellement visée (monde-miroir) ; null = impossible
   */
  constructor(o) {
    this.o = o;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.state = { downX: 0, downY: 0, dragging: false, active: 0, x: 0, y: 0, inside: false };
    this.hoverTile = null;
    const c = o.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    c.addEventListener('pointerleave', () => {
      this.state.inside = false;
      this.endHover();
    });
  }

  pick(x, y) {
    const level = this.o.level();
    if (!level) return null;
    this.ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.o.camera);
    const hit = this.raycaster.intersectObject(level.pickMesh, false)[0];
    return hit ? level.tileFromInstance(hit.instanceId) : null;
  }

  endHover() {
    this.hoverTile = null;
    this.o.canvas.style.cursor = '';
    this.o.onHoverEnd();
  }

  // Recalcule le survol (après un déplacement de Lumi, un pont qui apparaît…)
  refresh(force = true) {
    const s = this.state;
    if (!this.o.enabled() || s.dragging || !s.inside) return this.endHover();
    const raw = this.pick(s.x, s.y);
    if (raw === this.hoverTile && !force) return;
    const changed = raw !== this.hoverTile;
    this.hoverTile = raw;
    const tile = this.target(raw);
    if (tile === null) {
      // reflet : la case opposée n'existe pas
      this.o.canvas.style.cursor = 'not-allowed';
      this.o.onHover(raw, null, changed);
      return;
    }
    if (!tile || !tile.active) {
      this.o.canvas.style.cursor = '';
      this.o.onHoverEnd();
      return;
    }
    const path = this.o.pathTo(tile);
    this.o.canvas.style.cursor = path ? 'pointer' : 'not-allowed';
    this.o.onHover(tile, path, changed);
  }

  // Case visée après inversion éventuelle (monde-miroir) ; null = aucune
  target(raw) {
    if (!raw || !this.o.remap) return raw;
    return this.o.remap(raw);
  }

  down(e) {
    const s = this.state;
    s.active++;
    s.downX = e.clientX;
    s.downY = e.clientY;
    s.dragging = false;
  }

  move(e) {
    const s = this.state;
    s.x = e.clientX;
    s.y = e.clientY;
    s.inside = true;
    if (s.active > 0 && Math.hypot(e.clientX - s.downX, e.clientY - s.downY) > 6) {
      if (!s.dragging) {
        s.dragging = true;
        this.endHover();
      }
      this.o.canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.pointerType === 'mouse') this.refresh(false);
  }

  up(e) {
    const s = this.state;
    const wasDrag = s.dragging;
    const multi = s.active > 1;
    s.active = Math.max(0, s.active - 1);
    if (s.active === 0) s.dragging = false;
    if (e.target !== this.o.canvas || wasDrag || multi || !this.o.enabled()) {
      if (wasDrag) this.refresh();
      return;
    }
    s.x = e.clientX;
    s.y = e.clientY;
    s.inside = true;
    const raw = this.pick(e.clientX, e.clientY);
    const tile = this.target(raw);
    if (tile === null) this.o.onSelect(raw, null);
    else if (tile?.active) this.o.onSelect(tile, this.o.pathTo(tile));
    if (e.pointerType !== 'mouse') {
      s.inside = false;
      this.endHover();
    } else this.refresh();
  }
}

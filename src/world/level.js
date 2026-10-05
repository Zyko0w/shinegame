import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as P from './props.js';
import { mulberry32, hashString } from '../core/random.js';
import { ease } from '../core/tween.js';
import { patchTopBlock, patchSideBlock, patchUnderside, patchIridescent } from './materials.js';

export const STEP = 0.5; // hauteur d'un demi-bloc
const BLOCK = 0.96;

const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();
const tmpVec = new THREE.Vector3();

let shared = null;
function getShared() {
  if (shared) return shared;
  const coneGeo = new THREE.ConeGeometry(0.68, 1, 4, 1);
  coneGeo.rotateY(Math.PI / 4);
  coneGeo.rotateX(Math.PI);
  coneGeo.translate(0, -0.5, 0);

  const pickGeo = new THREE.BoxGeometry(1, 1, 1);
  pickGeo.translate(0, 0.5, 0);

  const shardGeo = new THREE.OctahedronGeometry(0.09, 0);
  shardGeo.scale(1, 2.2, 1);

  shared = {
    blockGeo: new RoundedBoxGeometry(BLOCK, STEP - 0.02, BLOCK, 3, 0.06),
    coneGeo,
    pickGeo,
    shardGeo,
    rockGeo: new THREE.DodecahedronGeometry(1, 0),
    rockMat: patchSideBlock(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, metalness: 0.02 })),
    topMat: patchTopBlock(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.04 })),
    underMat: patchUnderside(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true })),
    bridgeMat: patchIridescent(new THREE.MeshStandardMaterial({
      color: 0x9a8fe0,
      emissive: P.COLORS.button,
      emissiveIntensity: 0.1,
      roughness: 0.3,
      metalness: 0.2,
    }), 0.55),
    shardMat: patchIridescent(new THREE.MeshStandardMaterial({
      color: 0xc9b0ff,
      emissive: P.COLORS.crystal,
      emissiveIntensity: 2,
      roughness: 0.2,
      flatShading: true,
    }), 0.9),
    floatRockMat: new THREE.MeshStandardMaterial({ color: 0x24223c, roughness: 0.9, flatShading: true }),
    pickMat: new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
  };
  return shared;
}

export class Level {
  constructor(def, tweens) {
    this.def = def;
    this.tweens = tweens;
    this.root = new THREE.Group();
    this.content = new THREE.Group();
    this.root.add(this.content);
    this.rnd = mulberry32(hashString(def.id));
    this.disposables = [];
    this.animated = { gems: [], decor: [], rocks: [], ghosts: [] };

    this.parse();
    this.build();
  }

  /* ───────────── Grille ───────────── */

  parse() {
    const rows = this.def.heights;
    this.H = rows.length;
    this.W = Math.max(...rows.map((r) => r.length));
    this.tiles = new Array(this.W * this.H).fill(null);
    this.list = [];
    this.gemTotal = 0;

    for (let z = 0; z < this.H; z++) {
      for (let x = 0; x < this.W; x++) {
        const ch = rows[z][x];
        if (!ch || ch === '.') continue;
        const obj = this.def.objects[z]?.[x] ?? '.';
        const tile = {
          x,
          z,
          h: parseInt(ch, 10),
          obj,
          bridge: obj === '=',
          active: obj !== '=',
          index: this.list.length,
          prop: null,
          collected: false,
        };
        this.tiles[z * this.W + x] = tile;
        this.list.push(tile);
        if (obj === 'P') this.start = tile;
        if (obj === 'S') this.starTile = tile;
        if (obj === 'B') this.buttonTile = tile;
        if (obj === 'G') this.gemTotal++;
      }
    }

    this.offsetX = (this.W - 1) / 2;
    this.offsetZ = (this.H - 1) / 2;
    this.maxTop = Math.max(...this.list.map((t) => this.top(t)));
    this.focus = new THREE.Vector3(0, this.maxTop * 0.42, 0);
    this.radius = Math.hypot(this.W, this.H) * 0.5;
  }

  tileAt(x, z) {
    if (x < 0 || z < 0 || x >= this.W || z >= this.H) return null;
    return this.tiles[z * this.W + x];
  }

  top(tile) {
    return (tile.h + 1) * STEP;
  }

  worldOf(tile, out = new THREE.Vector3()) {
    return out.set(tile.x - this.offsetX, this.top(tile), tile.z - this.offsetZ);
  }

  isWalkable(tile) {
    return !!tile && tile.active;
  }

  canStep(a, b) {
    return this.isWalkable(a) && this.isWalkable(b) && Math.abs(a.h - b.h) <= 1;
  }

  /* ───────────── Construction ───────────── */

  build() {
    const S = getShared();
    const rnd = this.rnd;
    const ground = this.list.filter((t) => !t.bridge);

    // Blocs empilés (instanciés) : un matériau « roche » pour les flancs,
    // un matériau plus clair pour le bloc sommital (surface praticable).
    const sideCount = ground.reduce((n, t) => n + t.h, 0);
    // Occlusion « voxel » précalculée (quasi gratuite au rendu) : chaque
    // instance sait quels voisins la surplombent (bords du dessus assombris)
    // et où un sol voisin touche ses flancs (ligne de contact assombrie).
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const occTopSide = new Float32Array(Math.max(1, sideCount) * 4);
    const occSideSide = new Float32Array(Math.max(1, sideCount) * 4);
    const occTopTop = new Float32Array(ground.length * 4);
    const occSideTop = new Float32Array(ground.length * 4);
    const neighborH = (t, d) => {
      const n = this.tileAt(t.x + DIRS[d][0], t.z + DIRS[d][1]);
      return n && !n.bridge ? n.h : null;
    };
    const sideGeo = S.blockGeo.clone();
    const topGeo = S.blockGeo.clone();
    this.disposables.push(sideGeo, topGeo);
    const sideMesh = new THREE.InstancedMesh(sideGeo, S.rockMat, Math.max(1, sideCount));
    const topMesh = new THREE.InstancedMesh(topGeo, S.topMat, ground.length);
    sideMesh.count = sideCount;
    let si = 0;
    ground.forEach((t, ti) => {
      const wx = t.x - this.offsetX;
      const wz = t.z - this.offsetZ;
      for (let i = 0; i <= t.h; i++) {
        dummy.position.set(wx, i * STEP + STEP / 2, wz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        for (let d = 0; d < 4; d++) {
          const nh = neighborH(t, d);
          // sol voisin qui affleure le bas de ce bloc
          const contact = nh !== null && nh + 1 === i ? 1 : 0;
          if (i < t.h) occSideSide[si * 4 + d] = contact;
          else {
            occSideTop[ti * 4 + d] = contact;
            occTopTop[ti * 4 + d] = nh !== null && nh > t.h ? Math.min(1, (nh - t.h) * 0.6) : 0;
          }
        }
        if (i < t.h) {
          sideMesh.setMatrixAt(si, dummy.matrix);
          const l = 0.1 + (i / 12) * 0.08 + rnd() * 0.025;
          tmpColor.setHSL(0.69 + rnd() * 0.03, 0.26, l);
          sideMesh.setColorAt(si, tmpColor);
          si++;
        } else {
          topMesh.setMatrixAt(ti, dummy.matrix);
          const checker = (t.x + t.z) % 2 === 0 ? 0.03 : 0;
          tmpColor.setHSL(0.68 + rnd() * 0.035, 0.28, 0.33 + checker + rnd() * 0.03 + t.h * 0.006);
          topMesh.setColorAt(ti, tmpColor);
        }
      }
    });
    sideGeo.setAttribute('aOccTop', new THREE.InstancedBufferAttribute(occTopSide, 4));
    sideGeo.setAttribute('aOccSide', new THREE.InstancedBufferAttribute(occSideSide, 4));
    topGeo.setAttribute('aOccTop', new THREE.InstancedBufferAttribute(occTopTop, 4));
    topGeo.setAttribute('aOccSide', new THREE.InstancedBufferAttribute(occSideTop, 4));
    for (const m of [sideMesh, topMesh]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      this.content.add(m);
      this.disposables.push(m);
    }

    // Dessous rocheux en pointes + éclats de cristal suspendus
    let cx = 0;
    let cz = 0;
    ground.forEach((t) => {
      cx += t.x;
      cz += t.z;
    });
    cx /= ground.length;
    cz /= ground.length;
    const maxD = Math.max(...ground.map((t) => Math.hypot(t.x - cx, t.z - cz))) || 1;

    const underMesh = new THREE.InstancedMesh(S.coneGeo, S.underMat, ground.length);
    const shardSpots = [];
    ground.forEach((t, i) => {
      const center = 1 - Math.hypot(t.x - cx, t.z - cz) / maxD;
      const depth = 0.35 + center * 2.6 * (0.55 + rnd() * 0.45) + rnd() * 0.4;
      dummy.position.set(t.x - this.offsetX, 0.001, t.z - this.offsetZ);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(0.98 + rnd() * 0.06, depth, 0.98 + rnd() * 0.06);
      dummy.updateMatrix();
      underMesh.setMatrixAt(i, dummy.matrix);
      tmpColor.setHSL(0.7 + rnd() * 0.03, 0.3, 0.07 + rnd() * 0.03);
      underMesh.setColorAt(i, tmpColor);
      if (depth > 1.2 && rnd() < 0.35) shardSpots.push({ x: dummy.position.x, z: dummy.position.z, y: -depth * 0.82 });
    });
    underMesh.castShadow = true;
    this.content.add(underMesh);
    this.disposables.push(underMesh);

    if (shardSpots.length) {
      const shardMesh = new THREE.InstancedMesh(S.shardGeo, S.shardMat, shardSpots.length);
      shardSpots.forEach((s, i) => {
        dummy.position.set(s.x + (rnd() - 0.5) * 0.2, s.y, s.z + (rnd() - 0.5) * 0.2);
        dummy.rotation.set((rnd() - 0.5) * 0.4, rnd() * 3, (rnd() - 0.5) * 0.4);
        dummy.scale.setScalar(0.7 + rnd() * 0.8);
        dummy.updateMatrix();
        shardMesh.setMatrixAt(i, dummy.matrix);
      });
      this.content.add(shardMesh);
      this.disposables.push(shardMesh);
    }

    // Maillage invisible de sélection (une colonne par case)
    this.pickMesh = new THREE.InstancedMesh(S.pickGeo, S.pickMat, this.list.length);
    this.pickMesh.frustumCulled = false;
    this.list.forEach((t) => this.updatePick(t));
    this.content.add(this.pickMesh);
    this.disposables.push(this.pickMesh);

    // Objets
    for (const t of this.list) this.buildProp(t);

    // Rochers flottants autour de l'île
    const rockCount = 9;
    for (let i = 0; i < rockCount; i++) {
      const a = (i / rockCount) * Math.PI * 2 + rnd() * 0.5;
      const r = this.radius + 1.2 + rnd() * 2.5;
      const m = new THREE.Mesh(S.rockGeo, S.floatRockMat);
      const s = 0.12 + rnd() * 0.32;
      m.scale.set(s, s * (0.7 + rnd() * 0.6), s);
      m.position.set(Math.cos(a) * r, -1.5 + rnd() * (this.maxTop + 2.5), Math.sin(a) * r);
      m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      m.userData = { baseY: m.position.y, phase: rnd() * 10, spin: (rnd() - 0.5) * 0.4 };
      this.content.add(m);
      this.animated.rocks.push(m);
    }
  }

  buildProp(t) {
    const pos = this.worldOf(t, new THREE.Vector3());
    const rnd = this.rnd;
    const corner = () => {
      const ox = (rnd() < 0.5 ? -1 : 1) * (0.27 + rnd() * 0.06);
      const oz = (rnd() < 0.5 ? -1 : 1) * (0.27 + rnd() * 0.06);
      return [ox, oz];
    };

    let prop = null;
    switch (t.obj) {
      case 'G': {
        prop = P.createGem();
        prop.position.copy(pos);
        prop.position.y += 0.45;
        prop.userData.baseY = prop.position.y;
        this.animated.gems.push(prop);
        break;
      }
      case 'S': {
        prop = P.createStar();
        prop.position.copy(pos);
        this.star = prop;
        break;
      }
      case 'B': {
        prop = P.createButton();
        prop.position.copy(pos);
        this.button = prop;
        break;
      }
      case 'M':
      case 'L':
      case 'C': {
        prop = t.obj === 'M' ? P.createMushrooms(rnd) : t.obj === 'L' ? P.createLamp() : P.createCrystals(rnd);
        const [ox, oz] = corner();
        prop.position.set(pos.x + ox, pos.y, pos.z + oz);
        prop.rotation.y = rnd() * Math.PI * 2;
        this.animated.decor.push(prop);
        break;
      }
      case '=': {
        const S = getShared();
        const slab = new THREE.Group();
        const block = new THREE.Mesh(S.blockGeo, S.bridgeMat);
        block.castShadow = true;
        block.receiveShadow = true;
        const shard = new THREE.Mesh(S.shardGeo, S.shardMat);
        shard.position.y = -0.42;
        shard.scale.setScalar(0.8);
        slab.add(block, shard);
        slab.position.set(pos.x, pos.y - STEP / 2, pos.z);
        slab.visible = false;
        t.slab = slab;
        t.slabY = slab.position.y;
        this.content.add(slab);

        const ghost = P.createGhostBlock(BLOCK, STEP - 0.02);
        ghost.position.copy(slab.position);
        ghost.userData.lineMat.opacity = 0.5;
        ghost.userData.fillMat.uniforms.uOpacity.value = 1;
        t.ghost = ghost;
        this.content.add(ghost);
        this.animated.ghosts.push(ghost);
        break;
      }
    }
    if (prop) {
      t.prop = prop;
      this.content.add(prop);
    }
  }

  updatePick(t) {
    const wx = t.x - this.offsetX;
    const wz = t.z - this.offsetZ;
    if (t.bridge) {
      dummy.position.set(wx, t.active ? this.top(t) - STEP : -1000, wz);
      dummy.scale.set(1, STEP, 1);
    } else {
      dummy.position.set(wx, 0, wz);
      dummy.scale.set(1, this.top(t), 1);
    }
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    this.pickMesh.setMatrixAt(t.index, dummy.matrix);
    this.pickMesh.instanceMatrix.needsUpdate = true;
  }

  tileFromInstance(id) {
    return this.list[id] ?? null;
  }

  /* ───────────── Événements de gameplay ───────────── */

  intro() {
    this.content.position.y = -2.5;
    this.content.scale.setScalar(0.92);
    this.tweens.add({
      duration: 1.4,
      ease: ease.outCubic,
      onUpdate: (k) => {
        this.content.position.y = -2.5 * (1 - k);
        this.content.scale.setScalar(0.92 + 0.08 * k);
      },
    });
  }

  pressButton() {
    if (!this.button || this.buttonPressed) return false;
    this.buttonPressed = true;
    const { cap, capMat, ringMat } = this.button.userData;
    this.tweens.add({
      duration: 0.35,
      ease: ease.outBack,
      onUpdate: (k) => {
        cap.position.y = 0.11 - 0.06 * k;
        capMat.emissiveIntensity = 1.2 + 1.8 * k;
        ringMat.opacity = 0.6 + 0.4 * k;
      },
    });
    return true;
  }

  activateBridges(onEach) {
    const origin = this.buttonTile ?? this.start;
    const bridges = this.list
      .filter((t) => t.bridge && !t.active)
      .sort((a, b) => Math.hypot(a.x - origin.x, a.z - origin.z) - Math.hypot(b.x - origin.x, b.z - origin.z));

    bridges.forEach((t, i) => {
      const slab = t.slab;
      const ghost = t.ghost;
      this.tweens.add({
        delay: 0.35 + i * 0.16,
        duration: 0.8,
        ease: ease.outBack,
        onStart: () => {
          slab.visible = true;
          slab.position.y = t.slabY - 3;
          slab.scale.setScalar(0.01);
          slab.rotation.y = Math.PI * 0.5;
        },
        onUpdate: (k, raw) => {
          slab.position.y = t.slabY - 3 * (1 - k);
          slab.scale.setScalar(Math.max(0.01, k));
          slab.rotation.y = Math.PI * 0.5 * (1 - k);
          ghost.scale.setScalar(1 + raw * 0.3);
          ghost.visible = raw < 0.6;
        },
        onComplete: () => {
          t.active = true;
          ghost.visible = false;
          this.updatePick(t);
          onEach?.(t, i, bridges.length);
        },
      });
    });
    return bridges.length;
  }

  collectGem(t) {
    if (t.collected || !t.prop) return null;
    t.collected = true;
    const prop = t.prop;
    prop.userData.collected = true;
    const startY = prop.position.y;
    const world = prop.getWorldPosition(new THREE.Vector3());
    this.tweens.add({
      duration: 0.45,
      ease: ease.outCubic,
      onUpdate: (k) => {
        prop.position.y = startY + k * 0.5;
        prop.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.5 - k * 0.9);
      },
      onComplete: () => {
        prop.visible = false;
      },
    });
    return world;
  }

  collectStar() {
    const star = this.star;
    if (!star) return;
    const { spin, halo, beamMat, light } = star.userData;
    const y0 = spin.position.y;
    this.tweens.add({
      duration: 1.8,
      ease: ease.inOutCubic,
      onUpdate: (k) => {
        spin.position.y = y0 + k * 1.1;
        spin.scale.setScalar(1 + k * 0.9);
        halo.position.y = spin.position.y;
        halo.scale.setScalar(2.2 + k * 3);
        beamMat.uniforms.uStrength.value = 1 + k * 2.5;
        light.intensity = 5 + k * 12;
      },
    });
  }

  /* ───────────── Boucle ───────────── */

  update(t, dt) {
    for (const g of this.animated.gems) {
      if (!g.visible) continue;
      const u = g.userData;
      if (!u.collected) g.position.y = u.baseY + Math.sin(t * 2 + u.phase) * 0.06;
      u.spin.rotation.y += dt * (u.collected ? 12 : 1.4);
      u.halo.material.opacity = 0.42 + Math.sin(t * 3 + u.phase) * 0.12;
    }

    if (this.star) {
      const u = this.star.userData;
      u.spin.rotation.y += dt * 1.6;
      u.beamMat.uniforms.uTime.value = t;
      u.ring.rotation.y = t * 0.6;
      u.ring2.rotation.y = -t * 0.9;
      u.ring.scale.setScalar(1 + Math.sin(t * 2) * 0.05);
    }

    if (this.button && !this.buttonPressed) {
      const u = this.button.userData;
      const p = (t * 0.8) % 1;
      u.ring.scale.setScalar(1 + p * 0.5);
      u.ringMat.opacity = 0.65 * (1 - p);
    }

    for (const d of this.animated.decor) {
      const u = d.userData;
      if (u.halo) u.halo.material.opacity = u.halo.material.opacity * 0.9 + (0.28 + Math.sin(t * 1.7 + u.phase) * 0.1) * 0.1;
    }

    for (const r of this.animated.rocks) {
      const u = r.userData;
      r.position.y = u.baseY + Math.sin(t * 0.6 + u.phase) * 0.25;
      r.rotation.y += dt * u.spin;
      r.rotation.x += dt * u.spin * 0.5;
    }

    if (this.animated.ghosts.length) {
      const pulse = 0.35 + Math.sin(t * 3) * 0.15;
      const u = this.animated.ghosts[0].userData;
      u.lineMat.opacity = this.buttonPressed ? Math.max(0, u.lineMat.opacity - dt) : pulse;
    }
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.isSprite) o.material.dispose();
    });
    for (const d of this.disposables) d.dispose?.();
    if (this.star) {
      this.star.userData.beamMat.dispose();
      this.star.userData.mat.dispose();
    }
    for (const g of this.animated.gems) g.userData.mat.dispose();
    if (this.button) {
      this.button.userData.capMat.dispose();
      this.button.userData.ringMat.dispose();
    }
    this.root.removeFromParent();
  }

  // Utilitaire : position monde d'une case (réutilise un vecteur interne)
  worldOfTmp(tile) {
    return this.worldOf(tile, tmpVec);
  }
}

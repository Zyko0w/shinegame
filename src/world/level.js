import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as P from './props.js';
import { buildIslandDecor, createTree, createWaterfall, createPortal, createPlatform, createTrampoline } from './decor.js';
import { Npc } from './npc.js';
import { buildBiome, createAtmosphere } from './biome.js';
import * as C from './curios.js';
import { paletteOf } from '../game/moods.js';
import { mulberry32, hashString } from '../core/random.js';
import { ease } from '../core/tween.js';
import { patchTopBlock, patchSideBlock, patchUnderside, patchIridescent } from './materials.js';
import * as SA from './sanctum.js';
import { BLOCKING } from '../game/tiles.js';

// Un niveau = une île flottante à une ou deux faces jouables.
// - Face 0 : le dessus. Face 1 (optionnelle, `def.under`) : la face cachée,
//   construite retournée sous l'île ; un portail fait pivoter l'île de 180°
//   et c'est alors elle qui devient le terrain de jeu.
// - Les plateformes mobiles relient deux « stations » (cases vides de la
//   grille) et transportent Lumi quand il s'arrête dessus.
// - Monde-miroir : traverser un portique-miroir (R) fait passer Lumi « dans
//   le reflet » (commandes inversées, gérées par main.js) ; les dalles-reflet
//   (+) n'existent que dans le reflet, les dalles réelles (-) que hors de lui.
// - Curiosités (H Y Q F N U) : décors interactifs facultatifs ; U = longue-vue.
// - Grotte (`def.inside`, face 2) : l'intérieur de l'île. S'arrêter sur une
//   bouche de grotte (E) fait plonger Lumi dedans ; l'E de l'intérieur (puits
//   de lumière) le ramène à la surface. Une seule de ces faces est affichée.
// - Sanctuaire : autels (Z, un par émotion, `def.altars`) où poser les gemmes,
//   forge centrale (*) où naît la Clé du Réveil.
// Toute la logique (grille, chemins) porte sur la face active.

export const STEP = 0.5; // hauteur d'un demi-bloc
const BLOCK = 0.96;
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const MERGEABLE = new Set(['K', 'R', 'H', 'Y', 'Q', 'F', 'N', 'U', 'X', 'A']);
// Cases sans colonne de roche : dalles posées dans le vide
const SLABS = new Set(['=', '+', '-', 'K']);

const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();
const tmpV = new THREE.Vector3();

let shared = null;
function getShared() {
  if (shared) return shared;
  const pickGeo = new THREE.BoxGeometry(1, 1, 1);
  pickGeo.translate(0, 0.5, 0);
  const shardGeo = new THREE.OctahedronGeometry(0.09, 0);
  shardGeo.scale(1, 2.2, 1);

  shared = {
    blockGeo: new RoundedBoxGeometry(BLOCK, STEP - 0.02, BLOCK, 3, 0.06),
    pickGeo,
    shardGeo,
    rockGeo: new THREE.DodecahedronGeometry(1, 0),
    rockMat: patchSideBlock(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, metalness: 0.02 })),
    topMat: patchTopBlock(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.04 })),
    underMat: patchUnderside(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true })),
    bridgeMat: patchIridescent(
      new THREE.MeshStandardMaterial({ color: 0x9a8fe0, emissive: P.COLORS.button, emissiveIntensity: 0.1, roughness: 0.3, metalness: 0.2 }),
      0.55,
    ),
    shardMat: patchIridescent(
      new THREE.MeshStandardMaterial({ color: 0xc9b0ff, emissive: P.COLORS.crystal, emissiveIntensity: 2, roughness: 0.2, flatShading: true }),
      0.9,
    ),
    floatRockMat: new THREE.MeshStandardMaterial({ color: 0x24223c, roughness: 0.9, flatShading: true }),
    pickMat: new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
    dotGeo: new THREE.SphereGeometry(0.035, 8, 6),
    dotMat: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.0, 0.45), transparent: true, opacity: 0.7 }),
  };
  return shared;
}

/* ═════════════ Face d'île ═════════════ */

// side : 0 = dessus, 1 = face cachée (retournement), 2 = intérieur (grotte)
class Face {
  constructor(level, heights, objects, side) {
    this.level = level;
    this.side = side;
    this.index = side;
    this.group = new THREE.Group();
    // la face cachée est montée retournée sous l'île
    if (side === 1) this.group.rotation.x = Math.PI;
    // l'intérieur n'est affiché que lorsqu'on y descend
    if (side === 2) this.group.visible = false;
    this.H = heights.length;
    this.W = Math.max(...heights.map((r) => r.length));
    this.tiles = new Array(this.W * this.H).fill(null);
    this.list = [];
    this.offsetX = (this.W - 1) / 2;
    this.offsetZ = (this.H - 1) / 2;

    for (let z = 0; z < this.H; z++) {
      for (let x = 0; x < this.W; x++) {
        const ch = heights[z][x];
        if (!ch || ch === '.') continue;
        const obj = objects[z]?.[x] ?? '.';
        this.addTile({
          x,
          z,
          h: parseInt(ch, 10),
          obj,
          bridge: SLABS.has(obj),
          plank: obj === 'K',
          reflect: obj === '+',
          real: obj === '-',
          active: obj !== '=' && obj !== '+',
          blocked: BLOCKING.has(obj),
        });
      }
    }
  }

  addTile(t) {
    const tile = { prop: null, collected: false, ...t, layer: this, index: this.list.length };
    this.tiles[tile.z * this.W + tile.x] = tile;
    this.list.push(tile);
    if (tile.obj === 'P') this.start = tile;
    if (tile.obj === 'S') this.starTile = tile;
    if (tile.obj === 'B') this.buttonTile = tile;
    if (tile.obj === 'O') this.portal = tile;
    if (tile.obj === 'E') this.cave = tile;
    return tile;
  }

  finalize() {
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

  local(tile, out) {
    return out.set(tile.x - this.offsetX, this.top(tile), tile.z - this.offsetZ);
  }
}

/* ═════════════ Niveau ═════════════ */

export class Level {
  constructor(def, tweens) {
    this.def = def;
    this.tweens = tweens;
    this.shared = getShared();
    this.root = new THREE.Group();
    this.content = new THREE.Group(); // animation d'entrée
    this.flipper = new THREE.Group(); // rotation de retournement
    this.root.add(this.content);
    this.content.add(this.flipper);
    this.rnd = mulberry32(hashString(def.id));
    this.palette = paletteOf(def.mood); // couleurs du sol, de la végétation… selon l'émotion
    this.disposables = [];
    this.animated = { gems: [], decor: [], rocks: [], ghosts: [], trees: [], portals: [], platforms: [], trampolines: [], mirrors: [], fires: [], caves: [], altars: [] };
    this.altars = [];
    this.forge = null;
    this.key = null;
    this.kit = C.createKit(this.palette); // matériaux des curiosités et du monde-miroir
    this.curios = [];
    this.mirrorSlabs = [];
    this.mirrored = false;
    this.npcs = [];
    this.animating = 0; // animations qui modifient les ombres (shadow map à recalculer)
    this.carry = new THREE.Vector3(); // déplacement de plateforme à appliquer à Lumi
    this.side = 0;

    this.faces = [new Face(this, def.heights, def.objects, 0)];
    if (def.under) this.faces.push(new Face(this, def.under.heights, def.under.objects, 1));
    if (def.inside) this.faces.push(new Face(this, def.inside.heights, def.inside.objects, 2));
    this.platforms = (def.platforms ?? []).map((p) => this.createPlatformTiles(p));
    // tremplins : case de départ → case d'arrivée (souvent sur une autre île)
    this.jumps = (def.jumps ?? []).map((j) => {
      const face = this.faceOf(j.side);
      const from = face.tileAt(j.from[0], j.from[1]);
      const to = face.tileAt(j.to[0], j.to[1]);
      from.obj = 'J';
      from.jumpTo = to;
      return { face, from, to };
    });
    // personnages : leur case est occupée (on leur parle depuis une case voisine)
    for (const n of def.npcs ?? []) {
      const face = this.faceOf(n.side);
      const tile = face.tileAt(n.at[0], n.at[1]);
      tile.blocked = true;
      tile.npcDef = n;
    }
    for (const f of this.faces) f.finalize();
    this.start = this.faces[0].start;
    this.gemTotal = this.faces.reduce((n, f) => n + f.list.filter((t) => t.obj === 'G').length, 0);
    this.radius = Math.max(...this.faces.map((f) => f.radius));
    this.fitMaxTop = Math.max(...this.faces.map((f) => f.maxTop));
    this.button = null;
    this.star = null;

    for (const f of this.faces) this.buildFace(f);
    this.buildRays();
    this.buildFloatingRocks();
    this.curioTotal = this.curios.length;
    this.hasMirror = this.animated.mirrors.length > 0;

    // particules d'ambiance de l'émotion (pluie, braises, neige…)
    const atmo = createAtmosphere(this.palette, { radius: this.radius, maxTop: this.fitMaxTop }, this.rnd);
    if (atmo) {
      this.content.add(atmo);
      this.disposables.push(atmo.geometry, atmo.material);
    }
  }

  /* ───────────── Face active ───────────── */

  get face() {
    return this.faces[this.side];
  }
  // Face d'après son numéro dans les définitions (0 dessus, 1 dessous, 2 intérieur)
  faceOf(side = 0) {
    return this.faces.find((f) => f.side === side) ?? this.faces[0];
  }
  get canFlip() {
    return this.faces.some((f) => f.side === 1);
  }
  get inCave() {
    return this.face.side === 2;
  }
  get W() {
    return this.face.W;
  }
  get H() {
    return this.face.H;
  }
  get maxTop() {
    return this.fitMaxTop;
  }
  get focus() {
    return this.face.focus;
  }
  get pickMesh() {
    return this.face.pickMesh;
  }
  get starTile() {
    return this.faces.find((f) => f.starTile)?.starTile;
  }
  get buttonTile() {
    return this.faces.find((f) => f.buttonTile)?.buttonTile;
  }

  tileAt(x, z) {
    return this.face.tileAt(x, z);
  }

  tileFromInstance(id) {
    return this.face.list[id] ?? null;
  }

  top(tile) {
    return (tile.h + 1) * STEP;
  }

  // Position monde d'une case de la face active (la face active est
  // toujours ramenée en orientation « normale » par le retournement)
  worldOf(tile, out = new THREE.Vector3()) {
    return tile.layer.local(tile, out);
  }

  isWalkable(tile) {
    return !!tile && tile.active && !tile.blocked;
  }

  canStep(a, b) {
    return a.layer === b.layer && this.isWalkable(a) && this.isWalkable(b) && Math.abs(a.h - b.h) <= 1;
  }

  /* ───────────── Construction ───────────── */

  createPlatformTiles(def) {
    const face = this.faceOf(def.side);
    const p = { def, face, moving: false };
    p.a = face.addTile({ x: def.from[0], z: def.from[1], h: def.h, obj: '.', platform: p, active: true });
    p.b = face.addTile({ x: def.to[0], z: def.to[1], h: def.h, obj: '.', platform: p, active: false });
    p.at = p.a;
    return p;
  }

  buildFace(face) {
    const S = this.shared;
    const rnd = this.rnd;
    const ground = face.list.filter((t) => !t.bridge && !t.platform);
    const flipLevel = this.canFlip;
    this.flipper.add(face.group);

    // Blocs empilés (instanciés) : roche pour les flancs, surface pour le dessus.
    // Occlusion « voxel » précalculée : bords du dessus assombris au pied des
    // murs, ligne de contact assombrie sur les flancs.
    const sideCount = ground.reduce((n, t) => n + t.h, 0);
    const occTopSide = new Float32Array(Math.max(1, sideCount) * 4);
    const occSideSide = new Float32Array(Math.max(1, sideCount) * 4);
    const occTopTop = new Float32Array(Math.max(1, ground.length) * 4);
    const occSideTop = new Float32Array(Math.max(1, ground.length) * 4);
    const neighborH = (t, d) => {
      const n = face.tileAt(t.x + DIRS[d][0], t.z + DIRS[d][1]);
      return n && !n.bridge && !n.platform ? n.h : null;
    };
    const sideGeo = S.blockGeo.clone();
    const topGeo = S.blockGeo.clone();
    this.disposables.push(sideGeo, topGeo);
    const sideMesh = new THREE.InstancedMesh(sideGeo, S.rockMat, Math.max(1, sideCount));
    const topMesh = new THREE.InstancedMesh(topGeo, S.topMat, Math.max(1, ground.length));
    sideMesh.count = sideCount;
    let si = 0;
    ground.forEach((t, ti) => {
      const wx = t.x - face.offsetX;
      const wz = t.z - face.offsetZ;
      for (let i = 0; i <= t.h; i++) {
        // flancs légèrement irréguliers : la roche n'est pas parfaitement empilée
        const jitter = i < t.h ? 0.025 : 0;
        dummy.position.set(wx + (rnd() - 0.5) * jitter, i * STEP + STEP / 2, wz + (rnd() - 0.5) * jitter);
        dummy.rotation.set(0, i < t.h ? (rnd() - 0.5) * 0.06 : 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        for (let d = 0; d < 4; d++) {
          const nh = neighborH(t, d);
          const contact = nh !== null && nh + 1 === i ? 1 : 0;
          if (i < t.h) occSideSide[si * 4 + d] = contact;
          else {
            occSideTop[ti * 4 + d] = contact;
            occTopTop[ti * 4 + d] = nh !== null && nh > t.h ? Math.min(1, (nh - t.h) * 0.6) : 0;
          }
        }
        if (i < t.h) {
          sideMesh.setMatrixAt(si, dummy.matrix);
          const [sh, ss, sl] = this.palette.side;
          tmpColor.setHSL(sh + rnd() * 0.03, ss, sl - 0.02 + (i / 12) * 0.08 + rnd() * 0.025);
          sideMesh.setColorAt(si, tmpColor);
          si++;
        } else {
          topMesh.setMatrixAt(ti, dummy.matrix);
          // dessus aux couleurs de l'émotion, avec quelques plaques contrastées
          const [th, ts, tl] = rnd() < 0.18 ? this.palette.patch : this.palette.top;
          const checker = (t.x + t.z) % 2 === 0 ? 0.025 : 0;
          tmpColor.setHSL(th + rnd() * 0.03, ts, tl + checker + rnd() * 0.035 + t.h * 0.005);
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
      face.group.add(m);
      this.disposables.push(m);
    }

    // Habillage : herbe, fleurs, mousse, rochers, dessous rocheux
    const decor = buildIslandDecor(face, rnd, { underside: !flipLevel, palette: this.palette });
    face.group.add(decor.group);
    this.disposables.push(...decor.disposables);
    // habillage propre à l'émotion : bassins, lave, flaques, ronces…
    const biome = buildBiome(face, rnd, this.palette);
    face.group.add(biome.group);
    this.disposables.push(...biome.disposables);

    // Maillage invisible de sélection (une colonne par case)
    face.pickMesh = new THREE.InstancedMesh(S.pickGeo, S.pickMat, face.list.length);
    face.pickMesh.frustumCulled = false;
    face.list.forEach((t) => this.updatePick(t));
    face.group.add(face.pickMesh);
    this.disposables.push(face.pickMesh);

    for (const t of face.list) this.buildProp(t);
    // parties fixes des curiosités, passerelles et miroirs : fusionnées par matériau
    const statics = face.list.filter((t) => t.prop && MERGEABLE.has(t.obj)).flatMap((t) => [t.prop, ...(t.extraProps ?? [])]);
    const merged = C.mergeStatic(face.group, statics);
    this.disposables.push(...merged.map((m) => m.geometry));
    for (const p of this.platforms) if (p.face === face) this.buildPlatform(p);
    for (const j of this.jumps) if (j.face === face) this.buildJumpArc(j);
    if (face.side === 2) {
      const shell = SA.buildCaveShell(face, rnd, this.palette);
      face.group.add(shell.group);
      this.disposables.push(...shell.disposables);
    }
  }

  // Pointillés en arc qui montrent où mène un tremplin
  buildJumpArc(j) {
    const S = this.shared;
    const a = j.face.local(j.from, new THREE.Vector3());
    const b = j.face.local(j.to, new THREE.Vector3());
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const hop = 1.1 + dist * 0.28 + Math.max(0, b.y - a.y) * 0.6;
    const n = Math.max(6, Math.round(dist * 3.5));
    const dots = new THREE.InstancedMesh(S.dotGeo, this.jumpDotMat ??= new THREE.MeshBasicMaterial({ color: new THREE.Color(2.0, 0.9, 1.5), transparent: true, opacity: 0.55 }), n);
    for (let i = 0; i < n; i++) {
      const k = (i + 1) / (n + 1);
      tmpV.lerpVectors(a, b, k);
      tmpV.y += Math.sin(k * Math.PI) * hop + 0.35;
      dummy.position.copy(tmpV);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(0.8);
      dummy.updateMatrix();
      dots.setMatrixAt(i, dummy.matrix);
    }
    j.face.group.add(dots);
    this.disposables.push(dots);
  }

  buildFloatingRocks() {
    const S = this.shared;
    const rnd = this.rnd;
    const count = 10;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rnd() * 0.5;
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
    const face = t.layer;
    const pos = face.local(t, new THREE.Vector3());
    const rnd = this.rnd;
    const corner = () => [(rnd() < 0.5 ? -1 : 1) * (0.27 + rnd() * 0.06), (rnd() < 0.5 ? -1 : 1) * (0.27 + rnd() * 0.06)];

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
        prop = P.createStar(this.palette.accent);
        prop.position.copy(pos);
        this.star = prop;
        if (this.def.door) {
          const arch = SA.createDoorArch(this.kit.stone ?? this.shared.rockMat);
          arch.position.copy(pos);
          const [dx, dz] = this.facing(t);
          arch.rotation.y = Math.atan2(dx, dz);
          face.group.add(arch);
          this.door = arch;
          this.disposables.push(arch.userData.veilMat);
        }
        break;
      }
      case 'B': {
        prop = P.createButton();
        prop.position.copy(pos);
        this.button = prop;
        break;
      }
      case 'J': {
        prop = createTrampoline();
        prop.position.copy(pos);
        t.trampoline = prop;
        this.animated.trampolines.push(prop);
        break;
      }
      case 'O': {
        prop = createPortal();
        prop.position.copy(pos);
        prop.rotation.y = Math.PI / 4;
        this.animated.portals.push(prop);
        break;
      }
      case 'T': {
        prop = createTree(rnd, this.palette);
        prop.position.copy(pos);
        prop.rotation.y = rnd() * Math.PI * 2;
        this.animated.trees.push(prop);
        break;
      }
      case 'W': {
        // cascade sur le premier bord libre de la case
        const dir = DIRS.find(([dx, dz]) => !face.tileAt(t.x + dx, t.z + dz)) ?? DIRS[0];
        prop = createWaterfall(6 + pos.y, this.palette.biome?.fall);
        prop.position.set(pos.x + dir[0] * 0.53, pos.y - 0.02, pos.z + dir[1] * 0.53);
        prop.rotation.y = Math.atan2(dir[0], dir[1]);
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
      case 'X': {
        prop = C.createCampfire(this.kit, rnd);
        prop.position.copy(pos);
        this.animated.fires.push(prop);
        break;
      }
      case 'A': {
        prop = C.createTent(this.kit);
        prop.position.copy(pos);
        const [dx, dz] = this.facing(t);
        prop.rotation.y = Math.atan2(dx, dz);
        break;
      }
      case 'K': {
        prop = C.createPlank(this.kit, rnd, this.alongX(t));
        prop.position.copy(pos);
        break;
      }
      case '+':
      case '-': {
        const slab = C.createMirrorSlab(this.kit, this.shared.blockGeo, t.reflect ? 'reflect' : 'real');
        slab.position.set(pos.x, pos.y - STEP / 2, pos.z);
        slab.userData.block.visible = t.active;
        t.slab = slab;
        this.mirrorSlabs.push(t);
        face.group.add(slab);
        break;
      }
      case 'R': {
        prop = C.createMirror(this.kit, this.alongX(t));
        prop.position.copy(pos);
        this.animated.mirrors.push(prop);
        this.disposables.push(prop.userData.gem.material);
        break;
      }
      case 'H':
      case 'Y':
      case 'Q':
      case 'F':
      case 'N':
      case 'U': {
        const k = this.kit;
        prop =
          t.obj === 'H'
            ? C.createHouse(k, rnd)
            : t.obj === 'Y'
              ? C.createWindmill(k, rnd)
              : t.obj === 'Q'
                ? C.createBell(k)
                : t.obj === 'F'
                  ? C.createFountain(k)
                  : t.obj === 'N'
                    ? C.createSign(k)
                    : C.createTelescope(k);
        prop.position.copy(pos);
        const [dx, dz] = this.facing(t);
        prop.rotation.y = Math.atan2(dx, dz);
        if (t.obj === 'U') this.buildObservatory(t, prop, pos, [dx, dz]);
        const u = prop.userData;
        if (u.glowMat) this.disposables.push(u.glowMat);
        const def = (this.def.curios ?? []).find((c) => c.at[0] === t.x && c.at[1] === t.z && (c.side ?? 0) === face.side);
        const curio = { type: t.obj, tile: t, prop, def, found: false, id: `${face.index}:${t.x},${t.z}` };
        curio.name = def?.name ?? C.CURIO_INFO[t.obj].name;
        t.curio = curio;
        this.curios.push(curio);
        break;
      }
      case 'E': {
        // surface : bouche de grotte ; intérieur : puits de lumière vers la surface
        prop = face.side === 2 ? SA.createLightShaft(this.palette.accent) : SA.createCaveMouth(this.shared.rockMat, this.palette.accent);
        prop.position.copy(pos);
        this.animated.caves.push(prop);
        this.disposables.push(prop.userData.holeMat ?? prop.userData.beamMat, prop.userData.ringMat ?? prop.userData.holeMat);
        break;
      }
      case 'Z': {
        const def = (this.def.altars ?? []).find((a) => a.at[0] === t.x && a.at[1] === t.z);
        const accent = paletteOf(def?.mood).accent;
        prop = SA.createAltar(this.kit.stone ?? this.shared.rockMat, accent);
        prop.position.copy(pos);
        const altar = { tile: t, prop, def, placed: false };
        t.altar = altar;
        this.altars.push(altar);
        this.animated.altars.push(prop);
        const u = prop.userData;
        this.disposables.push(u.ringMat, u.ghostMat, u.gemMat);
        break;
      }
      case '*': {
        prop = SA.createForge(this.kit.stone ?? this.shared.rockMat);
        prop.position.copy(pos);
        this.forge = prop;
        this.disposables.push(prop.userData.glowMat);
        break;
      }
      case '=': {
        const S = this.shared;
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
        face.group.add(slab);

        const ghost = P.createGhostBlock(BLOCK, STEP - 0.02);
        ghost.position.copy(slab.position);
        ghost.userData.lineMat.opacity = 0.5;
        ghost.userData.fillMat.uniforms.uOpacity.value = 1;
        t.ghost = ghost;
        face.group.add(ghost);
        this.animated.ghosts.push(ghost);
        break;
      }
    }
    if (prop) {
      t.prop = prop;
      face.group.add(prop);
    }
    if (t.npcDef) {
      const npc = new Npc(t.npcDef);
      npc.root.position.copy(pos);
      npc.tile = t;
      t.npc = npc;
      face.group.add(npc.root);
      this.npcs.push(npc);
    }
  }

  buildPlatform(p) {
    const S = this.shared;
    const face = p.face;
    const a = face.local(p.a, new THREE.Vector3());
    const b = face.local(p.b, new THREE.Vector3());
    p.mesh = createPlatform(S.blockGeo);
    p.mesh.position.set(a.x, a.y - STEP / 2, a.z);
    face.group.add(p.mesh);
    this.animated.platforms.push(p);
    // pointillés indiquant le trajet
    const n = Math.max(2, Math.round(a.distanceTo(b) * 3));
    const dots = new THREE.InstancedMesh(S.dotGeo, S.dotMat, n);
    for (let i = 0; i < n; i++) {
      tmpV.lerpVectors(a, b, (i + 0.5) / n);
      dummy.position.set(tmpV.x, tmpV.y - 0.04, tmpV.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      dots.setMatrixAt(i, dummy.matrix);
    }
    face.group.add(dots);
    this.disposables.push(dots);
  }

  updatePick(t) {
    const face = t.layer;
    const wx = t.x - face.offsetX;
    const wz = t.z - face.offsetZ;
    if (t.bridge || t.platform) {
      dummy.position.set(wx, t.active ? face.top(t) - STEP : -1000, wz);
      dummy.scale.set(1, STEP, 1);
    } else {
      dummy.position.set(wx, 0, wz);
      dummy.scale.set(1, face.top(t), 1);
    }
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    face.pickMesh.setMatrixAt(t.index, dummy.matrix);
    face.pickMesh.instanceMatrix.needsUpdate = true;
  }

  // Longue-vue : tournée vers le vide (le bord le plus « extérieur » de
  // l'île), posée sur un petit lieu d'observation
  buildObservatory(t, prop, pos, seatDir) {
    const face = t.layer;
    const voids = DIRS.filter(([dx, dz]) => !face.tileAt(t.x + dx, t.z + dz));
    const out = new THREE.Vector2(pos.x, pos.z);
    const best = voids.length ? voids.reduce((a, b) => (out.dot(new THREE.Vector2(...b)) > out.dot(new THREE.Vector2(...a)) ? b : a)) : null;
    if (best) prop.rotation.y = Math.atan2(best[0], best[1]);
    else if (out.lengthSq() > 0.25) prop.rotation.y = Math.atan2(out.x, out.y);
    const obs = C.createObservatory(this.kit, voids, null);
    obs.position.copy(pos);
    face.group.add(obs);
    t.extraProps = [obs];
  }

  // Une passerelle / un miroir se traverse sur l'axe où il a le plus de voisins
  alongX(t) {
    const n = (dx, dz) => {
      const o = t.layer.tileAt(t.x + dx, t.z + dz);
      return o && !o.blocked ? 1 : 0;
    };
    return n(1, 0) + n(-1, 0) > n(0, 1) + n(0, -1);
  }

  // Direction d'une case voisine praticable (la façade d'une curiosité la regarde)
  facing(t) {
    const at = ([dx, dz]) => t.layer.tileAt(t.x + dx, t.z + dz);
    return DIRS.find((d) => at(d) && !at(d).blocked && !at(d).bridge) ?? DIRS.find((d) => at(d) && !at(d).blocked) ?? DIRS[2];
  }

  /* ───────────── Événements de gameplay ───────────── */

  // Tween suivi : tant qu'il tourne, la shadow map est recalculée
  track(opts) {
    this.animating++;
    const done = opts.onComplete;
    opts.onComplete = () => {
      this.animating--;
      done?.();
    };
    return this.tweens.add(opts);
  }

  // Objets cachés au départ, à inclure dans le préchauffage des shaders
  warmupTargets() {
    return [
      ...this.faces.flatMap((f) => f.list.filter((t) => t.slab).map((t) => t.slab)),
      ...this.mirrorSlabs.map((t) => t.slab.userData.block),
    ];
  }

  intro() {
    this.content.position.y = -2.5;
    this.content.scale.setScalar(0.92);
    this.track({
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
    this.track({
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
    const bridges = this.faces
      .flatMap((f) => f.list)
      .filter((t) => t.obj === '=' && !t.active)
      .sort((a, b) => Math.hypot(a.x - origin.x, a.z - origin.z) - Math.hypot(b.x - origin.x, b.z - origin.z));

    bridges.forEach((t, i) => {
      const slab = t.slab;
      const ghost = t.ghost;
      this.track({
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

  // Plateforme : transporte Lumi de la station `tile` à l'autre
  ride(tile, onDone) {
    const p = tile.platform;
    if (!p || p.moving || p.at !== tile) return false;
    const dest = tile === p.a ? p.b : p.a;
    const from = p.face.local(tile, new THREE.Vector3());
    const to = p.face.local(dest, new THREE.Vector3());
    const start = p.mesh.position.clone();
    const delta = to.clone().sub(from);
    p.moving = true;
    tile.active = false;
    this.updatePick(tile);
    let last = 0;
    this.track({
      duration: 0.7 + from.distanceTo(to) * 0.32,
      ease: ease.inOutSine,
      onUpdate: (k) => {
        p.mesh.position.copy(start).addScaledVector(delta, k);
        this.carry.addScaledVector(delta, k - last);
        last = k;
      },
      onComplete: () => {
        p.at = dest;
        p.moving = false;
        dest.active = true;
        this.updatePick(dest);
        onDone?.(dest);
      },
    });
    return true;
  }

  // Le tremplin se comprime puis se détend (appelé au lancement)
  bounce(tile) {
    const u = tile.trampoline?.userData;
    if (!u) return;
    this.track({
      duration: 0.7,
      onUpdate: (k, raw) => {
        // compression rapide puis oscillation amortie
        const s = raw < 0.18 ? -raw / 0.18 : Math.sin((raw - 0.18) * 18) * Math.exp(-(raw - 0.18) * 6) * 0.7;
        u.pad.position.y = 0.19 + s * 0.08;
        u.springs.scale.y = 1 + s * 0.5;
        u.membraneMat.uniforms.uPulse.value = Math.max(0, 1 - raw * 1.5);
      },
    });
  }

  // Personnage adjacent à une case (pour lui parler)
  npcNear(tile) {
    if (!tile) return null;
    for (const [dx, dz] of DIRS) {
      const n = tile.layer.tileAt(tile.x + dx, tile.z + dz);
      if (n?.npc) return n.npc;
    }
    return null;
  }

  // Déplacement accumulé par les plateformes depuis le dernier appel
  takeCarry(out) {
    out.copy(this.carry);
    this.carry.set(0, 0, 0);
    return out;
  }

  // Retournement de l'île : rotation de 180° autour de l'axe X
  flip(onDone) {
    if (this.faces.length < 2 || this.flipping) return false;
    this.flipping = true;
    const from = this.side * Math.PI;
    this.track({
      duration: 2.0,
      ease: ease.inOutCubic,
      onUpdate: (k) => {
        this.flipper.rotation.x = from + Math.PI * k;
        this.flipper.position.y = Math.sin(k * Math.PI) * 1.4;
      },
      onComplete: () => {
        this.side = 1 - this.side;
        this.flipper.rotation.x = this.side * Math.PI;
        this.flipper.position.y = 0;
        this.flipping = false;
        onDone?.(this.face.portal);
      },
    });
    return true;
  }

  /* ───────────── Grotte ───────────── */

  // Bouche de grotte ↔ puits de lumière : bascule sur l'autre face (surface
  // ou intérieur). L'enchaînement visuel (fondu, chute de Lumi) est géré par
  // main.js ; ici, on échange seulement la face affichée et active.
  caveExit(tile) {
    const to = this.faces.find((f) => f !== tile.layer && f.cave && (f.side === 2 || tile.layer.side === 2));
    return to?.cave ?? null;
  }

  enterFace(face) {
    for (const f of this.faces) f.group.visible = f === face;
    this.side = this.faces.indexOf(face);
  }

  // Bouche de grotte qui « aspire » (bref sursaut du tourbillon)
  pulseCave(tile) {
    const u = tile.prop?.userData;
    const mat = u?.holeMat ?? u?.beamMat;
    if (!mat) return;
    this.track({ duration: 1.2, onUpdate: (k, raw) => (mat.uniforms.uBoost.value = Math.sin(raw * Math.PI)) });
  }

  /* ───────────── Sanctuaire ───────────── */

  // Rayons autel → forge (cachés tant que la gemme n'est pas posée)
  buildRays() {
    if (!this.forge || !this.altars.length) return;
    const face = this.altars[0].tile.layer;
    const center = this.forge.position.clone();
    center.y += 0.7;
    for (const a of this.altars) {
      const from = a.prop.position.clone();
      from.y += 0.75;
      a.ray = SA.createRay(from, center, a.prop.userData.tint);
      a.ray.visible = false;
      face.group.add(a.ray);
      this.disposables.push(a.ray.userData.mat);
    }
  }

  // Pose la gemme sur son autel : elle descend du ciel, l'autel s'allume
  placeAltar(altar, onDone) {
    if (altar.placed) return false;
    altar.placed = true;
    const u = altar.prop.userData;
    u.gem.visible = true;
    u.gem.position.y = 2.2;
    u.gem.scale.setScalar(0.01);
    this.track({
      duration: 1.1,
      ease: ease.outCubic,
      onUpdate: (k) => {
        u.gem.position.y = 2.2 - 1.45 * k;
        u.gem.scale.setScalar(Math.max(0.01, k));
        u.ghostMat.opacity = 0.35 * (1 - k);
        u.ringMat.opacity = 0.35 + 0.55 * k;
        u.halo.material.opacity = 0.5 * k;
      },
      onComplete: () => {
        u.ghost.visible = false;
        if (altar.ray) {
          altar.ray.visible = true;
          this.track({ duration: 0.6, onUpdate: (k) => (altar.ray.userData.mat.opacity = 0.55 * k) });
        }
        onDone?.();
      },
    });
    return true;
  }

  get altarsDone() {
    return this.altars.length > 0 && this.altars.every((a) => a.placed);
  }

  // Les huit gemmes se fondent dans la forge : la Clé du Réveil apparaît,
  // s'élève puis file vers la Porte. Renvoie la position de la porte.
  forgeKey({ onForged, onArrived } = {}) {
    if (!this.forge || this.key) return;
    const face = this.altars[0].tile.layer;
    const center = this.forge.position.clone();
    center.y += 0.75;
    const key = SA.createKey();
    key.position.copy(center);
    key.scale.setScalar(0.01);
    face.group.add(key);
    this.key = key;
    const ku = key.userData;
    const fu = this.forge.userData;
    // 1. les gemmes quittent leurs autels et convergent vers la forge
    for (const a of this.altars) {
      const g = a.prop.userData.gem;
      const start = g.position.clone();
      const target = center.clone().sub(a.prop.position);
      this.track({
        delay: 0.2,
        duration: 1.6,
        ease: ease.inCubic,
        onUpdate: (k) => {
          g.position.lerpVectors(start, target, k);
          g.position.y += Math.sin(k * Math.PI) * 0.8;
          g.scale.setScalar(1 - k * 0.8);
          a.ray.userData.mat.opacity = 0.55 + k * 0.45;
        },
        onComplete: () => {
          g.visible = false;
          a.ray.visible = false;
          a.prop.userData.halo.material.opacity = 0.25;
        },
      });
    }
    // 2. la clé se forme dans un éclat de lumière
    this.track({
      delay: 1.8,
      duration: 1.4,
      ease: ease.outBack,
      onStart: () => onForged?.(center.clone().applyMatrix4(face.group.matrixWorld)),
      onUpdate: (k) => {
        key.scale.setScalar(Math.max(0.01, k * 1.4));
        key.position.y = center.y + k * 0.9;
        fu.glowMat.opacity = 0.25 + Math.sin(k * Math.PI) * 0.75;
        fu.halo.material.opacity = 0.15 + Math.sin(k * Math.PI) * 0.6;
      },
    });
    // 3. elle file vers la porte et s'y fond
    const door = this.starTile ? face.local(this.starTile, new THREE.Vector3()) : center.clone();
    door.y += 0.9;
    const from = center.clone();
    from.y += 0.9;
    this.track({
      delay: 3.6,
      duration: 1.6,
      ease: ease.inOutCubic,
      onUpdate: (k) => {
        key.position.lerpVectors(from, door, k);
        key.position.y += Math.sin(k * Math.PI) * 1.2;
        key.scale.setScalar(1.4 - k * 0.6);
      },
      onComplete: () => {
        key.visible = false;
        if (this.door) {
          const vm = this.door.userData.veilMat;
          this.track({ duration: 1.2, onUpdate: (k) => (vm.opacity = 0.12 + 0.5 * Math.sin(k * Math.PI) + 0.2 * k) });
        }
        onArrived?.(door.clone().applyMatrix4(face.group.matrixWorld));
      },
    });
  }

  /* ───────────── Monde-miroir ───────────── */

  // Passe dans le reflet (ou en ressort) : les dalles-reflet apparaissent, les
  // dalles réelles s'effacent (et inversement), en vague depuis `origin`.
  setMirrored(on, origin, onEach) {
    this.mirrored = on;
    const u = this.kit.mirror.uniforms;
    u.uRipple.value = 1;
    u.uMirrored.value = on ? 1 : 0;
    const tiles = this.mirrorSlabs
      .filter((t) => t.layer === this.face)
      .sort((a, b) => Math.hypot(a.x - origin.x, a.z - origin.z) - Math.hypot(b.x - origin.x, b.z - origin.z));
    let n = 0;
    for (const t of tiles) {
      const show = t.reflect ? on : !on;
      if (t.active === show) continue;
      const i = n++;
      t.active = show;
      this.updatePick(t);
      const { block } = t.slab.userData;
      this.track({
        delay: 0.15 + i * 0.07,
        duration: show ? 0.55 : 0.35,
        ease: show ? ease.outBack : ease.inCubic,
        onStart: () => {
          block.visible = true;
          onEach?.(t, i, show);
        },
        onUpdate: (k) => {
          const v = show ? k : 1 - k;
          block.scale.setScalar(Math.max(0.01, v));
          block.rotation.y = (1 - v) * Math.PI * 0.5;
        },
        onComplete: () => {
          block.visible = show;
          block.scale.setScalar(1);
          block.rotation.y = 0;
        },
      });
    }
  }

  /* ───────────── Curiosités ───────────── */

  // Personnage ou curiosité adjacents à une case
  interactableNear(tile) {
    const npc = this.npcNear(tile);
    if (npc) return { npc };
    if (!tile) return null;
    for (const [dx, dz] of DIRS) {
      const n = tile.layer.tileAt(tile.x + dx, tile.z + dz);
      if (n?.curio) return { curio: n.curio };
    }
    return null;
  }

  // Porte de maison : s'ouvre (intérieur illuminé) ou se referme
  setHouseOpen(curio, open) {
    const u = curio.prop.userData;
    const from = u.open;
    this.track({
      duration: open ? 0.7 : 0.5,
      ease: open ? ease.outBack : ease.inOutSine,
      onUpdate: (k) => {
        u.open = from + ((open ? 1 : 0) - from) * k;
        u.hinge.rotation.y = -u.open * 1.9;
        u.glow = u.open;
      },
    });
  }

  // Animation de la curiosité utilisée (moulin, cloche, fontaine, panneau)
  playCurio(curio) {
    const u = curio.prop.userData;
    if (curio.type === 'Y' || curio.type === 'F') u.boost = 1;
    else if (curio.type === 'Q') {
      u.swing = 1;
      u.t = 0;
    }
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
    this.track({
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

    for (const tr of this.animated.trees) {
      const u = tr.userData;
      const s = Math.sin(t * 1.2 + u.phase) * 0.04;
      for (const leaf of u.sway) leaf.rotation.z = s;
    }

    for (const pt of this.animated.portals) {
      const u = pt.userData;
      u.frame.rotation.z = Math.sin(t * 0.8) * 0.05;
      u.runes.rotation.z = t * 0.6;
      u.frame.position.y = 0.45 + Math.sin(t * 1.6) * 0.02;
    }

    for (const p of this.animated.platforms) {
      const u = p.mesh.userData;
      const f = 0.5 + Math.sin(t * 18) * 0.08 + (p.moving ? 0.25 : 0);
      for (const th of u.thrusters) th.scale.set(1, f * 1.6, 1);
      u.mat.emissiveIntensity = 0.12 + (p.moving ? 0.25 : Math.sin(t * 3) * 0.05 + 0.05);
    }

    for (const npc of this.npcs) npc.update(t, dt);

    for (const f of this.animated.fires) {
      const u = f.userData;
      for (const fl of u.flames) {
        const p = fl.userData;
        const k = 1 + Math.sin(t * 11 + p.phase) * 0.12 + Math.sin(t * 23 + p.phase * 2) * 0.08;
        fl.scale.set(p.r * (1.05 - (k - 1) * 0.5), p.h * k, p.r * (1.05 - (k - 1) * 0.5));
        fl.rotation.y = t * 0.8 + p.phase;
      }
      u.halo.material.opacity = 0.38 + Math.sin(t * 9) * 0.06 + Math.sin(t * 17) * 0.04;
    }

    for (const c of this.curios) {
      const u = c.prop.userData;
      switch (c.type) {
        case 'H': {
          const g = 1 + u.glow * 1.5 + Math.sin(t * 2.3 + c.tile.x) * 0.06;
          u.glowMat.color.setRGB(1.6 * g, 1.0 * g, 0.45 * g);
          u.halo.material.opacity = 0.14 + u.glow * 0.35;
          break;
        }
        case 'Y':
          u.boost = Math.max(0, u.boost - dt * 0.22);
          u.hub.rotation.z -= dt * (u.speed + u.boost * u.boost * 11);
          break;
        case 'Q':
          if (u.swing > 0) {
            u.t += dt;
            const decay = Math.exp(-u.t * 0.8);
            u.pivot.rotation.x = Math.sin(u.t * 7) * 0.55 * decay;
            u.halo.material.opacity = 0.5 * decay;
            if (decay < 0.01) u.swing = 0;
          }
          break;
        case 'F':
          u.boost = Math.max(0, u.boost - dt * 0.35);
          u.jet.scale.y = 0.18 + Math.sin(t * 7) * 0.02 + u.boost * 0.95;
          u.jet.scale.x = u.jet.scale.z = 1 + u.boost * 0.6;
          u.halo.material.opacity = 0.22 + u.boost * 0.5;
          break;
        case 'U':
          u.halo.material.opacity = 0.22 + Math.sin(t * 2 + c.tile.x) * 0.1;
          break;
      }
    }

    if (this.animated.mirrors.length) {
      const mu = this.kit.mirror.uniforms;
      mu.uRipple.value = Math.max(0, mu.uRipple.value - dt * 0.7);
      for (const m of this.animated.mirrors) {
        m.userData.gem.rotation.y = t * 1.5;
        m.userData.gem.position.y = 1.0 + Math.sin(t * 2) * 0.03;
      }
    }
    if (this.mirrorSlabs.length) {
      // contours lumineux des dalles absentes
      const pulse = 0.35 + Math.sin(t * 3) * 0.15;
      this.kit.reflectLine.opacity = this.mirrored ? 0.1 : pulse;
      this.kit.realLine.opacity = this.mirrored ? pulse : 0.1;
    }

    for (const c of this.animated.caves) {
      const u = c.userData;
      if (u.halo) u.halo.material.opacity = 0.28 + Math.sin(t * 2.2) * 0.08;
      if (u.ring) u.ring.scale.setScalar(1 + Math.sin(t * 2) * 0.05);
    }

    for (const a of this.animated.altars) {
      const u = a.userData;
      u.ghost.rotation.y = t * 0.8;
      u.ghost.position.y = 0.75 + Math.sin(t * 1.6 + a.position.x) * 0.05;
      if (u.gem.visible) u.gem.rotation.y += dt * 1.4;
    }
    if (this.key?.visible) this.key.rotation.y += dt * 2.2;

    for (const tr of this.animated.trampolines) {
      const u = tr.userData;
      if (!this.animating) u.pad.position.y = 0.19 + Math.sin(t * 3) * 0.006;
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
    // Toutes les géométries sont libérées : celles partagées entre niveaux
    // (caches des fabriques) sont simplement renvoyées au GPU au prochain usage.
    // Les matériaux partagés, eux, restent (sinon recompilation = gel).
    this.root.traverse((o) => {
      o.geometry?.dispose();
      if (o.isSprite) o.material.dispose();
    });
    for (const d of this.disposables) d.dispose?.();
    for (const npc of this.npcs) npc.dispose();
    this.jumpDotMat?.dispose();
    if (this.key) {
      this.key.userData.mat.dispose();
      this.key.userData.gemMat.dispose();
    }
    this.kit.dispose();
    if (this.star) {
      this.star.userData.beamMat.dispose();
      this.star.userData.mat.dispose();
      this.star.userData.ringMat.dispose();
      this.star.userData.coreMat.dispose();
    }
    for (const g of this.animated.gems) g.userData.mat.dispose();
    if (this.button) {
      this.button.userData.capMat.dispose();
      this.button.userData.ringMat.dispose();
    }
    this.root.removeFromParent();
  }
}

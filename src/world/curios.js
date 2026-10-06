import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { globalUniforms, patchIridescent } from './materials.js';
import { makeHalo } from './props.js';
import { liquidMaterial } from './biome.js';

// Petits décors interactifs (« curiosités ») et nouvelles pièces de terrain :
//   H maison visitable   Y moulin   Q cloche   F fontaine   N panneau
//   U longue-vue (point panoramique : constellation, planète…)
//   X feu de camp   A tente (campement des plateformes d'observation)
//   K passerelle en bois   R portique-miroir   + dalle-reflet   - dalle réelle
// Les curiosités sont facultatives : on interagit avec elles depuis une case
// voisine (comme avec les esprits), pour le plaisir et les statistiques.
// Convention : la façade de chaque objet regarde vers +z local.
// Échelle : Lumi mesure ~1,3 unité ; maisons et moulins le dépassent nettement.
// Performances : les parties fixes de tous les objets d'une face sont
// fusionnées par matériau (mergeStatic) → une poignée de draw calls en tout ;
// seules les pièces animées (porte, ailes, cloche, jet…) restent séparées.

const cache = {};
const once = (key, fn) => cache[key] ?? (cache[key] = fn());

// Textes des curiosités : voir game/curioTexts.js (partagés avec le générateur de voix)
export { CURIO_INFO, curioText } from '../game/curioTexts.js';

/* ───────────── Kit de matériaux (un par niveau) ───────────── */

export function createKit(palette) {
  const hsl = ([h, s, l], ds = 0, dl = 0) => new THREE.Color().setHSL(h, Math.max(0, s + ds), Math.max(0, l + dl));
  const wall = hsl(palette.top, -0.12, 0.42);
  const roof = new THREE.Color(palette.leaves[0]).multiplyScalar(0.55);
  const kit = {
    wall: new THREE.MeshStandardMaterial({ color: wall, roughness: 0.85 }),
    roof: new THREE.MeshStandardMaterial({ color: roof, roughness: 0.6, flatShading: true }),
    wood: new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.85 }),
    woodLight: new THREE.MeshStandardMaterial({ color: 0x9c7450, roughness: 0.8 }),
    stone: new THREE.MeshStandardMaterial({ color: hsl(palette.side, -0.05, 0.22), roughness: 0.9, flatShading: true }),
    metal: new THREE.MeshStandardMaterial({ color: 0xffcf7a, roughness: 0.25, metalness: 0.9, emissive: 0x6a4410, emissiveIntensity: 0.25 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2a2440, roughness: 0.6, metalness: 0.4 }),
    sail: new THREE.MeshStandardMaterial({ color: 0xf2e6d0, roughness: 0.9, side: THREE.DoubleSide }),
    rope: new THREE.MeshStandardMaterial({ color: 0xc8a878, roughness: 1 }),
    liquid: liquidMaterial(palette),
    jet: new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.biome.liquid[1]).multiplyScalar(1.2 + palette.biome.glow * 0.4),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    // dalles du monde-miroir
    reflect: patchIridescent(
      new THREE.MeshStandardMaterial({ color: 0xdaf6ff, roughness: 0.1, metalness: 0.85, emissive: 0x3ab8ff, emissiveIntensity: 0.18, transparent: true, opacity: 0.9 }),
      1.3,
    ),
    real: new THREE.MeshStandardMaterial({ color: 0xf0d29a, roughness: 0.55, metalness: 0.2, emissive: 0xff9a3c, emissiveIntensity: 0.12 }),
    reflectLine: new THREE.LineBasicMaterial({ color: new THREE.Color(0.6, 1.6, 2.2), transparent: true, opacity: 0.5, depthWrite: false }),
    realLine: new THREE.LineBasicMaterial({ color: new THREE.Color(2.2, 1.4, 0.5), transparent: true, opacity: 0.5, depthWrite: false }),
    mirror: mirrorMaterial(),
    frame: new THREE.MeshStandardMaterial({ color: 0xd9e4f0, roughness: 0.3, metalness: 0.85, emissive: 0x2f6f8a, emissiveIntensity: 0.25 }),
    runes: new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.accent).multiplyScalar(1.6) }),
    brass: new THREE.MeshStandardMaterial({ color: 0xd9a85a, roughness: 0.3, metalness: 0.9, emissive: 0x5a3a10, emissiveIntensity: 0.2 }),
    lens: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 1.6, 2.2) }),
    // campement
    canvas: new THREE.MeshStandardMaterial({ color: new THREE.Color(palette.leaves[1]).lerp(new THREE.Color(0xf2e6d0), 0.55), roughness: 0.9, side: THREE.DoubleSide }),
    canvasDark: new THREE.MeshStandardMaterial({ color: new THREE.Color(palette.leaves[1]).lerp(new THREE.Color(0x3a2a20), 0.5), roughness: 0.9, side: THREE.DoubleSide }),
    ember: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.7, 0.15) }),
    flameOuter: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.9, 0.25), transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }),
    flameInner: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.0, 0.9), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }),
  };
  kit.dispose = () => {
    for (const v of Object.values(kit)) v?.dispose?.();
  };
  return kit;
}

/* ───────────── Maison visitable ───────────── */

export function createHouse(kit, rnd) {
  const g = new THREE.Group();
  const W = 0.58;
  const D = 0.5;
  const H = 0.62;
  const walls = new THREE.Mesh(once('hWalls', () => new THREE.BoxGeometry(W, H, D).translate(0, H / 2, 0)), kit.wall);
  walls.castShadow = walls.receiveShadow = true;

  // toit à deux pans (pignon en façade)
  const roofGeo = once('hRoof', () => {
    const s = new THREE.Shape();
    s.moveTo(-W / 2 - 0.07, 0);
    s.lineTo(W / 2 + 0.07, 0);
    s.lineTo(0, 0.3);
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: D + 0.12, bevelEnabled: false });
    geo.translate(0, H - 0.01, -(D + 0.12) / 2);
    return geo;
  });
  const roof = new THREE.Mesh(roofGeo, kit.roof);
  roof.castShadow = true;
  const chimney = new THREE.Mesh(once('hChim', () => new THREE.BoxGeometry(0.07, 0.18, 0.07)), kit.stone);
  chimney.position.set(W * 0.26, H + 0.2, -0.08);
  // auvent au-dessus de la porte
  const awning = new THREE.Mesh(once('hAwn', () => new THREE.BoxGeometry(0.28, 0.025, 0.1)), kit.roof);
  awning.position.set(0, 0.46, D / 2 + 0.05);
  awning.rotation.x = 0.25;
  chimney.castShadow = true;

  // intérieur éclairé (visible quand la porte s'ouvre) + fenêtres
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.0, 0.45) });
  const inside = new THREE.Mesh(once('hIn', () => new THREE.PlaneGeometry(0.17, 0.4)), glowMat);
  inside.position.set(0, 0.2, D / 2 + 0.002);
  const winGeo = once('hWin', () => new THREE.PlaneGeometry(0.1, 0.1));
  const windows = [-1, 1].map((s) => {
    const w = new THREE.Mesh(winGeo, glowMat);
    w.position.set(s * (W / 2 + 0.002), 0.4, 0.02);
    w.rotation.y = (s * Math.PI) / 2;
    return w;
  });
  const round = new THREE.Mesh(once('hRound', () => new THREE.CircleGeometry(0.045, 16)), glowMat);
  round.position.set(0, H + 0.1, D / 2 + 0.065);

  // porte sur charnière
  const hinge = new THREE.Group();
  hinge.position.set(-0.09, 0, D / 2 + 0.008);
  const door = new THREE.Mesh(once('hDoor', () => new THREE.BoxGeometry(0.18, 0.41, 0.02).translate(0.09, 0.205, 0)), kit.wood);
  const knob = new THREE.Mesh(once('hKnob', () => new THREE.SphereGeometry(0.012, 8, 6)), kit.metal);
  knob.position.set(0.15, 0.2, 0.014);
  hinge.add(door, knob);
  const step = new THREE.Mesh(once('hStep', () => new THREE.BoxGeometry(0.22, 0.03, 0.1)), kit.stone);
  step.position.set(0, 0.015, D / 2 + 0.05);
  step.receiveShadow = true;

  const halo = makeHalo(0xffb35c, 0.9, 0.18);
  halo.position.set(0, 0.3, D / 2 + 0.1);
  g.add(walls, roof, chimney, awning, inside, ...windows, round, hinge, step, halo);
  g.scale.setScalar(1.6 + rnd() * 0.12); // ~1,7 de haut : Lumi passe tout juste la porte
  g.userData = { hinge, glowMat, halo, open: 0, glow: 0, dynamic: [hinge] };
  return g;
}

/* ───────────── Moulin ───────────── */

export function createWindmill(kit, rnd) {
  const g = new THREE.Group();
  const tower = new THREE.Mesh(once('mTower', () => new THREE.CylinderGeometry(0.12, 0.2, 0.72, 8).translate(0, 0.36, 0)), kit.wall);
  tower.castShadow = tower.receiveShadow = true;
  const cap = new THREE.Mesh(once('mCap', () => new THREE.ConeGeometry(0.17, 0.22, 8).translate(0, 0.83, 0)), kit.roof);
  cap.castShadow = true;
  const door = new THREE.Mesh(once('mDoor', () => new THREE.BoxGeometry(0.09, 0.15, 0.02).translate(0, 0.075, 0)), kit.wood);
  door.position.z = 0.19;
  door.rotation.x = -0.12;

  const hub = new THREE.Group();
  hub.position.set(0, 0.66, 0.15);
  const axle = new THREE.Mesh(once('mAxle', () => new THREE.CylinderGeometry(0.02, 0.02, 0.1, 8).rotateX(Math.PI / 2)), kit.dark);
  hub.add(axle);
  const armGeo = once('mArm', () => new THREE.BoxGeometry(0.025, 0.42, 0.015).translate(0, 0.21, 0));
  const sailGeo = once('mSail', () => new THREE.PlaneGeometry(0.1, 0.3).translate(0.065, 0.26, 0.01));
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Group();
    blade.rotation.z = (i * Math.PI) / 2;
    const arm = new THREE.Mesh(armGeo, kit.woodLight);
    const sail = new THREE.Mesh(sailGeo, kit.sail);
    blade.add(arm, sail); // pas d'ombre portée : elle ne suivrait pas la rotation
    hub.add(blade);
  }
  hub.position.z += 0.02;
  g.add(tower, cap, door, hub);
  g.scale.setScalar(2.2 + rnd() * 0.2); // ~2 de haut, ailes comprises
  g.userData = { hub, speed: 0.5 + rnd() * 0.3, base: 0.5, boost: 0, dynamic: [hub] };
  return g;
}

/* ───────────── Cloche ───────────── */

export function createBell(kit) {
  const g = new THREE.Group();
  const postGeo = once('bPost', () => new THREE.CylinderGeometry(0.022, 0.028, 0.66, 6).translate(0, 0.33, 0));
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(postGeo, kit.wood);
    p.position.x = s * 0.2;
    p.castShadow = true;
    g.add(p);
  }
  const bar = new THREE.Mesh(once('bBar', () => new THREE.BoxGeometry(0.48, 0.04, 0.05)), kit.wood);
  bar.position.y = 0.65;
  bar.castShadow = true;
  const roof = new THREE.Mesh(
    once('bRoof', () => {
      const s = new THREE.Shape();
      s.moveTo(-0.3, 0);
      s.lineTo(0.3, 0);
      s.lineTo(0, 0.14);
      s.closePath();
      return new THREE.ExtrudeGeometry(s, { depth: 0.18, bevelEnabled: false }).translate(0, 0, -0.09);
    }),
    kit.roof,
  );
  roof.position.y = 0.67;
  roof.castShadow = true;

  const pivot = new THREE.Group();
  pivot.position.y = 0.62;
  const bellGeo = once('bBell', () => {
    const pts = [
      [0.0, 0.0],
      [0.03, 0.0],
      [0.055, -0.03],
      [0.065, -0.09],
      [0.085, -0.17],
      [0.11, -0.2],
      [0.108, -0.215],
      [0.0, -0.2],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    return new THREE.LatheGeometry(pts, 20);
  });
  const bell = new THREE.Mesh(bellGeo, kit.metal);
  const clapper = new THREE.Mesh(once('bClap', () => new THREE.SphereGeometry(0.022, 8, 6)), kit.dark);
  clapper.position.y = -0.19;
  pivot.add(bell, clapper);
  const halo = makeHalo(0xffcf7a, 0.7, 0);
  halo.position.y = 0.5;
  g.add(bar, roof, pivot, halo);
  g.scale.setScalar(1.7);
  g.userData = { pivot, halo, swing: 0, t: 0, dynamic: [pivot] };
  return g;
}

/* ───────────── Fontaine ───────────── */

export function createFountain(kit) {
  const g = new THREE.Group();
  const basin = new THREE.Mesh(once('fBasin', () => new THREE.CylinderGeometry(0.34, 0.37, 0.14, 20).translate(0, 0.07, 0)), kit.stone);
  basin.castShadow = basin.receiveShadow = true;
  const water = new THREE.Mesh(once('fWater', () => new THREE.CircleGeometry(0.29, 24).rotateX(-Math.PI / 2)), kit.liquid);
  water.position.y = 0.125;
  const column = new THREE.Mesh(once('fCol', () => new THREE.CylinderGeometry(0.035, 0.06, 0.32, 10).translate(0, 0.16, 0)), kit.stone);
  column.castShadow = true;
  const bowl = new THREE.Mesh(once('fBowl', () => new THREE.CylinderGeometry(0.11, 0.05, 0.05, 14)), kit.stone);
  bowl.position.y = 0.34;
  const jet = new THREE.Mesh(once('fJet', () => new THREE.ConeGeometry(0.05, 1, 10, 1, true).translate(0, 0.5, 0)), kit.jet);
  jet.position.y = 0.36;
  jet.scale.set(1, 0.18, 1);
  jet.renderOrder = 4;
  const halo = makeHalo(kit.jet.color, 1.1, 0.25);
  halo.position.y = 0.3;
  g.add(basin, water, column, bowl, jet, halo);
  g.scale.setScalar(1.3);
  g.userData = { jet, halo, boost: 0, dynamic: [jet] };
  return g;
}

/* ───────────── Panneau ───────────── */

export function createSign(kit) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(once('sPost', () => new THREE.CylinderGeometry(0.022, 0.026, 0.5, 6).translate(0, 0.25, 0)), kit.wood);
  post.castShadow = true;
  const board = new THREE.Mesh(once('sBoard', () => new THREE.BoxGeometry(0.36, 0.18, 0.03)), kit.woodLight);
  board.position.set(0, 0.42, 0.02);
  board.rotation.z = 0.05;
  board.castShadow = true;
  const runes = new THREE.Mesh(once('sRunes', () => new THREE.PlaneGeometry(0.24, 0.06)), kit.runes);
  runes.position.set(0, 0.42, 0.037);
  runes.rotation.z = 0.05;
  g.add(post, board, runes);
  g.scale.setScalar(1.45);
  g.userData = {};
  return g;
}

/* ───────────── Passerelle en bois ───────────── */

// `alongX` : la passerelle relie des cases voisines sur l'axe X
export function createPlank(kit, rnd, alongX) {
  const g = new THREE.Group();
  // planches en travers du chemin (qui suit l'axe Z local)
  const plankGeo = once('pPlank', () => new THREE.BoxGeometry(0.86, 0.05, 0.17));
  for (let i = 0; i < 5; i++) {
    const p = new THREE.Mesh(plankGeo, i % 2 ? kit.wood : kit.woodLight);
    p.position.set((rnd() - 0.5) * 0.03, -0.03 + (rnd() - 0.5) * 0.01, -0.39 + i * 0.195);
    p.rotation.set(0, (rnd() - 0.5) * 0.04, (rnd() - 0.5) * 0.04);
    p.castShadow = p.receiveShadow = true;
    g.add(p);
  }
  const beamGeo = once('pBeam', () => new THREE.BoxGeometry(0.05, 0.06, 1.0));
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(beamGeo, kit.wood);
    b.position.set(s * 0.3, -0.09, 0);
    b.castShadow = true;
    g.add(b);
  }
  // rambardes de corde
  const postGeo = once('pPost', () => new THREE.CylinderGeometry(0.018, 0.022, 0.26, 6).translate(0, 0.1, 0));
  const ropeGeo = once('pRope', () => new THREE.CylinderGeometry(0.008, 0.008, 1.0, 4).rotateX(Math.PI / 2));
  for (const s of [-1, 1]) {
    for (const e of [-1, 1]) {
      const p = new THREE.Mesh(postGeo, kit.wood);
      p.position.set(s * 0.44, 0, e * 0.46);
      p.castShadow = true;
      g.add(p);
    }
    const rope = new THREE.Mesh(ropeGeo, kit.rope);
    rope.position.set(s * 0.44, 0.17, 0);
    rope.scale.set(1, 1, 0.94);
    g.add(rope);
  }
  if (alongX) g.rotation.y = Math.PI / 2;
  return g;
}

/* ───────────── Portique-miroir ───────────── */

function mirrorMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uTime: globalUniforms.uTime, uRipple: { value: 0 }, uMirrored: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uRipple;
      uniform float uMirrored;
      varying vec2 vP;
      vec3 hue(float t) { return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }
      void main() {
        vec2 c = vP - vec2(0.0, 0.45);
        float r = length(c);
        float ripple = sin(r * 40.0 - uTime * 12.0) * uRipple * exp(-r * 2.0);
        float sweep = pow(0.5 + 0.5 * sin((vP.x + vP.y) * 6.0 - uTime * 1.4 + ripple * 3.0), 6.0);
        vec3 silver = mix(vec3(0.55, 0.7, 0.8), vec3(0.85, 0.95, 1.0), 0.5 + 0.5 * sin(vP.y * 3.0 + uTime * 0.5));
        vec3 col = silver * 0.55 + hue(vP.y * 0.6 + uTime * 0.1 + ripple) * (0.25 + uMirrored * 0.2) + vec3(1.0) * sweep * 0.9;
        col += vec3(0.6, 1.0, 0.9) * abs(ripple) * 2.0;
        float a = 0.42 + sweep * 0.35 + abs(ripple) * 0.5;
        gl_FragColor = vec4(col * 1.2, a);
      }
    `,
  });
}

// `alongX` : on traverse le miroir en se déplaçant sur l'axe X
export function createMirror(kit, alongX) {
  const g = new THREE.Group();
  const paneGeo = once('rPane', () => {
    const s = new THREE.Shape();
    s.moveTo(-0.3, 0);
    s.lineTo(0.3, 0);
    s.lineTo(0.3, 0.62);
    s.absarc(0, 0.62, 0.3, 0, Math.PI, false);
    s.lineTo(-0.3, 0);
    return new THREE.ShapeGeometry(s, 24);
  });
  const pane = new THREE.Mesh(paneGeo, kit.mirror);
  pane.position.y = 0.02;
  pane.renderOrder = 4;
  const pillarGeo = once('rPillar', () => new THREE.BoxGeometry(0.07, 0.66, 0.1).translate(0, 0.33, 0));
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(pillarGeo, kit.frame);
    p.position.x = s * 0.34;
    p.castShadow = true;
    g.add(p);
  }
  const arch = new THREE.Mesh(once('rArch', () => new THREE.TorusGeometry(0.34, 0.035, 8, 28, Math.PI)), kit.frame);
  arch.position.y = 0.64;
  arch.castShadow = true;
  const gem = new THREE.Mesh(once('rGem', () => new THREE.OctahedronGeometry(0.045, 0)), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 2.2, 2.0) }));
  gem.position.y = 1.0;
  const halo = makeHalo(0xaefcff, 1.3, 0.25);
  halo.position.y = 0.5;
  g.add(pane, arch, gem, halo);
  if (alongX) g.rotation.y = Math.PI / 2;
  g.scale.setScalar(1.45); // arche plus haute que Lumi : il passe dessous
  // la vitre (shader en coordonnées locales) et la gemme restent séparées
  g.userData = { gem, halo, dynamic: [pane, gem] };
  return g;
}

/* ───────────── Dalles du monde-miroir ───────────── */

// Dalle-reflet (`+`, n'existe que dans le reflet) ou dalle réelle (`-`,
// s'efface dans le reflet). Contour lumineux quand elle est absente.
export function createMirrorSlab(kit, blockGeo, kind) {
  const g = new THREE.Group();
  const block = new THREE.Mesh(blockGeo, kind === 'reflect' ? kit.reflect : kit.real);
  block.castShadow = block.receiveShadow = true;
  const edges = new THREE.LineSegments(
    once('slabEdges', () => new THREE.EdgesGeometry(new THREE.BoxGeometry(0.96, 0.48, 0.96))),
    kind === 'reflect' ? kit.reflectLine : kit.realLine,
  );
  g.add(block, edges);
  g.userData = { block, edges, k: 1 };
  return g;
}

/* ───────────── Longue-vue (point panoramique) ───────────── */

const UP = new THREE.Vector3(0, 1, 0);

// Barre cylindrique tendue entre deux points (pieds de trépied, montants)
function rod(a, b, radius, mat, segs = 6) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = new THREE.Mesh(once(`rod${segs}`, () => new THREE.CylinderGeometry(1, 1, 1, segs)), mat);
  m.scale.set(radius, len, radius);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  m.castShadow = true;
  return m;
}

// Lunette astronomique sur trépied. Les pieds partent tous de la tête de
// monture (aucun ne dépasse) ; la fourche tient le tube par son axe.
// Tube incliné vers le ciel, dirigé vers +z ; oculaire à l'arrière.
export const TELESCOPE = { scale: 1.8, pivotY: 0.7, tilt: -0.45, eyeZ: -0.38 };

export function createTelescope(kit) {
  const g = new THREE.Group();
  const { pivotY, tilt, eyeZ } = TELESCOPE;
  const apex = new THREE.Vector3(0, pivotY - 0.13, 0);
  const footR = 0.21;

  // trépied : 3 pieds de la tête jusqu'au sol, embouts et tablette
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const foot = new THREE.Vector3(Math.cos(a) * footR, 0.02, Math.sin(a) * footR);
    g.add(rod(apex, foot, 0.014, kit.wood));
    const cap = new THREE.Mesh(once('tFoot', () => new THREE.SphereGeometry(0.022, 8, 6)), kit.dark);
    cap.position.copy(foot);
    g.add(cap);
  }
  // tablette triangulaire entre les pieds (sommets sur les pieds)
  const trayY = 0.26;
  const trayR = footR * (1 - (trayY - 0.02) / (apex.y - 0.02));
  const tray = new THREE.Mesh(once('tTray', () => new THREE.CylinderGeometry(1, 1, 0.012, 3)), kit.woodLight);
  tray.scale.set(trayR, 1, trayR);
  tray.position.y = trayY;
  tray.rotation.y = Math.PI / 2 - Math.PI / 6;
  g.add(tray);

  // tête de monture + fourche
  const head = new THREE.Mesh(once('tHead', () => new THREE.CylinderGeometry(0.05, 0.06, 0.07, 14)), kit.dark);
  head.position.y = apex.y + 0.02;
  const base = new THREE.Mesh(once('tForkBase', () => new THREE.BoxGeometry(0.18, 0.02, 0.07)), kit.brass);
  base.position.y = apex.y + 0.065;
  g.add(head, base);
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(once('tForkArm', () => new THREE.BoxGeometry(0.018, 0.12, 0.06)), kit.brass);
    arm.position.set(sx * 0.081, apex.y + 0.125, 0);
    arm.castShadow = true;
    g.add(arm);
  }

  // tube (groupe incliné autour de l'axe de la fourche)
  const tube = new THREE.Group();
  tube.position.y = pivotY;
  tube.rotation.x = tilt;
  const zCyl = (key, rTop, rBot, len, z, mat, segs = 18) => {
    const m = new THREE.Mesh(once(key, () => new THREE.CylinderGeometry(rTop, rBot, len, segs).rotateX(Math.PI / 2)), mat);
    m.position.z = z;
    m.castShadow = true;
    tube.add(m);
    return m;
  };
  zCyl('tBody', 0.056, 0.056, 0.62, 0.04, kit.brass);
  zCyl('tDew', 0.066, 0.064, 0.13, 0.4, kit.dark);
  zCyl('tBack', 0.05, 0.056, 0.05, -0.29, kit.dark);
  zCyl('tFocus', 0.022, 0.022, 0.07, -0.34, kit.brass, 10);
  zCyl('tEye', 0.026, 0.02, 0.05, eyeZ, kit.dark, 10);
  for (const z of [-0.12, 0.2]) {
    const band = new THREE.Mesh(once('tBand', () => new THREE.TorusGeometry(0.058, 0.007, 6, 20)), kit.dark);
    band.position.z = z;
    tube.add(band);
  }
  const axle = new THREE.Mesh(once('tAxle', () => new THREE.CylinderGeometry(0.012, 0.012, 0.18, 8).rotateZ(Math.PI / 2)), kit.dark);
  tube.add(axle);
  // chercheur : petite lunette sur le dessus
  const finder = new THREE.Mesh(once('tFinder', () => new THREE.CylinderGeometry(0.014, 0.014, 0.17, 8).rotateX(Math.PI / 2)), kit.dark);
  finder.position.set(0, 0.078, 0.06);
  for (const z of [0, 0.12]) {
    const foot = new THREE.Mesh(once('tFinderFoot', () => new THREE.BoxGeometry(0.01, 0.024, 0.012)), kit.brass);
    foot.position.set(0, 0.064, z);
    tube.add(foot);
  }
  const lens = new THREE.Mesh(once('tLens', () => new THREE.CircleGeometry(0.058, 20)), kit.lens);
  lens.position.z = 0.4 + 0.066;
  tube.add(finder, lens);

  const halo = makeHalo(0x9fd8ff, 0.7, 0.3);
  halo.position.set(0, pivotY + 0.25, 0.3);
  g.add(tube, halo);
  g.scale.setScalar(TELESCOPE.scale);
  g.userData = { halo };
  return g;
}

// Oculaire en coordonnées locales de la longue-vue (avant l'échelle)
export function telescopeEyepiece(out = new THREE.Vector3()) {
  const { pivotY, tilt, eyeZ } = TELESCOPE;
  return out.set(0, pivotY - eyeZ * Math.sin(tilt), eyeZ * Math.cos(tilt));
}

// Lieu d'observation autour d'une longue-vue : dalle ronde gravée d'une rose
// des vents, garde-corps et lanternes côté vide, banc sur la case d'où l'on
// observe. `voids` : directions [dx, dz] sans case ; `seat` : { dx, dz, dy }.
export function createObservatory(kit, voids, seat) {
  const g = new THREE.Group();
  const dais = new THREE.Mesh(once('oDais', () => new THREE.CylinderGeometry(0.47, 0.5, 0.06, 28)), kit.stone);
  dais.position.y = 0.03;
  dais.receiveShadow = true;
  g.add(dais);
  const ring = new THREE.Mesh(once('oRing', () => new THREE.TorusGeometry(0.4, 0.008, 4, 40).rotateX(Math.PI / 2)), kit.runes);
  ring.position.y = 0.062;
  g.add(ring);
  // rose des vents : 8 branches gravées
  for (let i = 0; i < 8; i++) {
    const ray = new THREE.Mesh(once('oRay', () => new THREE.BoxGeometry(0.006, 0.004, 1).translate(0, 0, 0.5)), kit.runes);
    ray.scale.z = i % 2 ? 0.2 : 0.34;
    ray.rotation.y = (i / 8) * Math.PI * 2;
    ray.position.y = 0.062;
    g.add(ray);
  }

  // garde-corps sur chaque bord donnant sur le vide, lanternes aux extrémités
  const E = 0.47;
  for (const [dx, dz] of voids) {
    const px = -dz; // le long du bord
    const pz = dx;
    const posts = [-0.42, 0, 0.42].map((t) => new THREE.Vector3(dx * E + px * t, 0, dz * E + pz * t));
    for (const p of posts) g.add(rod(p, p.clone().setY(0.42), 0.014, kit.wood));
    for (const y of [0.24, 0.4]) g.add(rod(posts[0].clone().setY(y), posts[2].clone().setY(y), 0.01, kit.woodLight));
    for (const p of [posts[0], posts[2]]) {
      const lamp = new THREE.Mesh(once('oLamp', () => new THREE.SphereGeometry(0.03, 10, 8)), kit.lens);
      lamp.position.set(p.x, 0.46, p.z);
      g.add(lamp);
    }
  }

  // banc sur la case voisine, dans un coin (ne gêne pas le passage)
  if (seat) {
    const side = [-seat.dz, seat.dx];
    const bench = new THREE.Group();
    const top = new THREE.Mesh(once('oSeat', () => new THREE.BoxGeometry(0.34, 0.035, 0.12)), kit.woodLight);
    top.position.y = 0.17;
    top.castShadow = true;
    bench.add(top);
    for (const sx of [-0.12, 0.12]) {
      const leg = new THREE.Mesh(once('oLeg', () => new THREE.BoxGeometry(0.04, 0.16, 0.1)), kit.stone);
      leg.position.set(sx, 0.08, 0);
      bench.add(leg);
    }
    bench.position.set(seat.dx * 0.72 + side[0] * 0.32, seat.dy, seat.dz * 0.72 + side[1] * 0.32);
    bench.rotation.y = Math.atan2(seat.dx, seat.dz) + Math.PI / 2;
    g.add(bench);
  }
  return g;
}

/* ───────────── Campement (plateformes d'observation) ───────────── */

// Feu de camp : cercle de pierres, bûches croisées, flammes qui dansent
// (les flammes restent animées, le reste est fusionné avec le décor).
export function createCampfire(kit, rnd) {
  const g = new THREE.Group();
  const stoneGeo = once('cStone', () => new THREE.DodecahedronGeometry(1, 0));
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rnd() * 0.2;
    const s = new THREE.Mesh(stoneGeo, kit.stone);
    const r = 0.045 + rnd() * 0.02;
    s.scale.set(r, r * 0.75, r);
    s.position.set(Math.cos(a) * 0.2, r * 0.5, Math.sin(a) * 0.2);
    s.rotation.set(rnd() * 3, rnd() * 3, 0);
    s.castShadow = true;
    g.add(s);
  }
  const logGeo = once('cLog', () => new THREE.CylinderGeometry(0.028, 0.032, 0.3, 7).rotateZ(Math.PI / 2));
  for (let i = 0; i < 3; i++) {
    const log = new THREE.Mesh(logGeo, kit.wood);
    log.position.y = 0.04 + i * 0.012;
    log.rotation.y = (i / 3) * Math.PI;
    log.rotation.z = 0.12;
    log.castShadow = true;
    g.add(log);
  }
  const ember = new THREE.Mesh(once('cEmber', () => new THREE.CircleGeometry(0.11, 12).rotateX(-Math.PI / 2)), kit.ember);
  ember.position.y = 0.03;
  g.add(ember);

  // flammes : cônes additifs qui vacillent (voir Level.update)
  const flames = new THREE.Group();
  flames.position.y = 0.06;
  const flameGeo = once('cFlame', () => new THREE.ConeGeometry(1, 1, 8, 1, true).translate(0, 0.5, 0));
  const parts = [
    [0, 0, 0.07, 0.3, kit.flameOuter],
    [0.035, 0.02, 0.045, 0.2, kit.flameOuter],
    [-0.03, -0.025, 0.05, 0.22, kit.flameOuter],
    [0, 0, 0.035, 0.18, kit.flameInner],
  ].map(([x, z, r, h, mat], i) => {
    const f = new THREE.Mesh(flameGeo, mat);
    f.position.set(x, 0, z);
    f.scale.set(r, h, r);
    f.renderOrder = 4;
    f.userData = { r, h, phase: i * 1.7 + rnd() * 3 };
    flames.add(f);
    return f;
  });
  const halo = makeHalo(0xff9a3c, 1.4, 0.45);
  halo.position.y = 0.2;
  flames.add(halo);
  g.add(flames);
  g.userData = { flames: parts, halo, dynamic: [flames] };
  return g;
}

// Petite tente canadienne : toile en prisme, ouverture sombre, mâts,
// haubans et piquets. Façade (ouverture) vers +z.
export function createTent(kit) {
  const g = new THREE.Group();
  const W = 0.62;
  const H = 0.42;
  const D = 0.7;
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, 0);
  shape.lineTo(W / 2, 0);
  shape.lineTo(0, H);
  shape.closePath();
  const canvas = new THREE.Mesh(
    once('tentBody', () => new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: false }).translate(0, 0, -D / 2)),
    kit.canvas,
  );
  canvas.castShadow = canvas.receiveShadow = true;
  // ouverture triangulaire sombre, rabats entrouverts
  const door = new THREE.Shape();
  door.moveTo(-0.13, 0);
  door.lineTo(0.13, 0);
  door.lineTo(0, 0.3);
  door.closePath();
  const opening = new THREE.Mesh(once('tentDoor', () => new THREE.ShapeGeometry(door)), kit.dark);
  opening.position.z = D / 2 + 0.003;
  const flapShape = new THREE.Shape();
  flapShape.moveTo(0, 0);
  flapShape.lineTo(0.15, 0);
  flapShape.lineTo(0, 0.3);
  flapShape.closePath();
  const flapGeo = once('tentFlap', () => new THREE.ShapeGeometry(flapShape));
  for (const sx of [-1, 1]) {
    const flap = new THREE.Mesh(flapGeo, kit.canvasDark);
    flap.scale.x = sx;
    flap.position.set(sx * 0.13, 0, D / 2 + 0.006);
    flap.rotation.y = sx * 0.6;
    g.add(flap);
  }
  // faîtière, mâts, haubans et piquets
  const ridge = new THREE.Mesh(once('tentRidge', () => new THREE.CylinderGeometry(0.01, 0.01, D + 0.08, 6).rotateX(Math.PI / 2)), kit.wood);
  ridge.position.y = H + 0.005;
  g.add(canvas, opening, ridge);
  for (const sz of [-1, 1]) {
    const pole = new THREE.Mesh(once('tentPole', () => new THREE.CylinderGeometry(0.01, 0.012, H + 0.06, 6).translate(0, (H + 0.06) / 2, 0)), kit.wood);
    pole.position.z = sz * (D / 2 + 0.04);
    g.add(pole);
    const top = new THREE.Vector3(0, H + 0.04, sz * (D / 2 + 0.04));
    const peg = new THREE.Vector3(0, 0.01, sz * (D / 2 + 0.2));
    const dir = new THREE.Vector3().subVectors(peg, top);
    const rope = new THREE.Mesh(once('tentRope', () => new THREE.CylinderGeometry(0.004, 0.004, 1, 4)), kit.rope);
    rope.scale.y = dir.length();
    rope.position.copy(top).addScaledVector(dir, 0.5);
    rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const stake = new THREE.Mesh(once('tentStake', () => new THREE.ConeGeometry(0.012, 0.05, 5).rotateX(Math.PI)), kit.dark);
    stake.position.copy(peg).setY(0.02);
    g.add(rope, stake);
  }
  g.scale.setScalar(1.25);
  return g;
}

/* ───────────── Fusion des parties fixes ───────────── */

// Les maillages non animés de `props` sont regroupés par matériau et fusionnés
// en un seul maillage par matériau, attaché à `parent`. Renvoie les nouveaux
// maillages (à libérer avec le niveau).
export function mergeStatic(parent, props) {
  parent.updateMatrixWorld(true);
  const inv = parent.matrixWorld.clone().invert();
  const buckets = new Map();
  const removed = [];
  const m = new THREE.Matrix4();
  for (const prop of props) {
    const dyn = prop.userData.dynamic ?? [];
    prop.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh) return;
      for (let p = o; p && p !== prop; p = p.parent) if (dyn.includes(p)) return;
      let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      geo.applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld));
      let b = buckets.get(o.material);
      if (!b) buckets.set(o.material, (b = { geos: [], cast: false }));
      b.geos.push(geo);
      b.cast ||= o.castShadow;
      removed.push(o);
    });
  }
  const out = [];
  for (const [mat, b] of buckets) {
    const merged = mergeGeometries(b.geos, false);
    for (const g of b.geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = !mat.transparent && !mat.isShaderMaterial;
    mesh.matrixAutoUpdate = false;
    parent.add(mesh);
    out.push(mesh);
  }
  for (const o of removed) o.removeFromParent();
  return out;
}

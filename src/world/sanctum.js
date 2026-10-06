import * as THREE from 'three';
import { globalUniforms, patchIridescent } from './materials.js';
import { makeHalo } from './props.js';

// Objets des deux derniers mondes :
// - Grotte : bouche de grotte (E, à la surface), puits de lumière (E, à
//   l'intérieur), et « coquille » de caverne (stalactites, stalagmites,
//   cristaux luisants) autour de la face intérieure ;
// - Sanctuaire : autels des gemmes (Z), forge centrale (*), Clé du Réveil,
//   arche de la Porte du Réveil.

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const dummy = new THREE.Object3D();
const color = new THREE.Color();

const cache = {};
const once = (key, fn) => cache[key] ?? (cache[key] = fn());

/* ───────────── Grotte ───────────── */

// Tourbillon d'ombre au sol (bouche de grotte) ou colonne de lumière (puits)
function vortexMaterial(inner, outer, strength = 1) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: globalUniforms.uTime, uInner: { value: new THREE.Color(inner) }, uOuter: { value: new THREE.Color(outer) }, uBoost: { value: 0 }, uStrength: { value: strength } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uInner;
      uniform vec3 uOuter;
      uniform float uBoost;
      uniform float uStrength;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float a = atan(p.y, p.x);
        float swirl = sin(a * 4.0 - r * 10.0 + uTime * 2.2) * 0.5 + 0.5;
        float edge = smoothstep(1.0, 0.75, r);
        // centre très sombre : un trou qui s'enfonce dans l'île
        vec3 c = mix(uInner, uOuter, smoothstep(0.15, 0.95, r) * (0.6 + swirl * 0.4));
        float glow = smoothstep(0.55, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r)) * (0.6 + swirl) * (1.0 + uBoost * 2.0);
        gl_FragColor = vec4(c + uOuter * glow * uStrength, edge);
      }
    `,
  });
}

// Bouche de grotte : arche de roches autour d'un trou d'ombre tourbillonnant
export function createCaveMouth(rockMat, accent) {
  const g = new THREE.Group();
  const holeMat = vortexMaterial(0x020106, accent, 0.9);
  const hole = new THREE.Mesh(once('caveHole', () => new THREE.CircleGeometry(0.4, 40).rotateX(-Math.PI / 2)), holeMat);
  hole.position.y = 0.012;
  hole.renderOrder = 2;
  g.add(hole);
  // arche : rochers empilés en demi-cercle derrière le trou
  const rock = once('caveRock', () => new THREE.DodecahedronGeometry(1, 0));
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (i / (n - 1));
    const m = new THREE.Mesh(rock, rockMat);
    const s = 0.11 + Math.sin(a) * 0.05;
    m.scale.set(s, s * 1.15, s);
    m.position.set(Math.cos(a) * 0.38, 0.04 + Math.sin(a) * 0.5, -0.3);
    m.rotation.set(i * 1.3, i * 0.7, i * 0.4);
    m.castShadow = true;
    g.add(m);
  }
  const halo = makeHalo(accent, 1.2, 0.3);
  halo.position.y = 0.15;
  g.add(halo);
  g.userData = { holeMat, halo };
  return g;
}

// Puits de lumière : colonne qui tombe d'en haut sur la case de sortie
export function createLightShaft(accent) {
  const g = new THREE.Group();
  const tint = new THREE.Color(accent).lerp(new THREE.Color(1, 1, 1), 0.5);
  const beamMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: globalUniforms.uTime, uColor: { value: tint }, uBoost: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uBoost;
      varying vec2 vUv;
      void main() {
        float fade = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
        float dust = 0.7 + 0.3 * sin(vUv.x * 40.0 + uTime) * sin(vUv.y * 24.0 - uTime * 0.8);
        float a = fade * dust * (0.16 + uBoost * 0.3);
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  });
  const beam = new THREE.Mesh(once('shaftGeo', () => new THREE.CylinderGeometry(0.42, 0.3, 6, 28, 1, true).translate(0, 3, 0)), beamMat);
  beam.renderOrder = 4;
  const ringMat = new THREE.MeshBasicMaterial({ color: tint.clone().multiplyScalar(1.8), transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(once('shaftRing', () => new THREE.RingGeometry(0.3, 0.4, 40).rotateX(-Math.PI / 2)), ringMat);
  ring.position.y = 0.015;
  const halo = makeHalo(tint, 1.5, 0.35);
  halo.position.y = 0.3;
  g.add(beam, ring, halo);
  g.userData = { beamMat, ringMat, halo, ring };
  return g;
}

// Caverne : stalactites suspendues au-dessus de la face, stalagmites et
// grappes de cristaux sur son pourtour (cases vides voisines de l'île).
export function buildCaveShell(face, rnd, palette) {
  const group = new THREE.Group();
  const disposables = [];
  const wx = (x) => x - face.offsetX;
  const wz = (z) => z - face.offsetZ;
  const ceiling = face.maxTop + 3.2;

  const rim = [];
  for (const t of face.list) {
    for (const [dx, dz] of DIRS) {
      const x = t.x + dx;
      const z = t.z + dz;
      if (!face.tileAt(x, z)) rim.push([x, z, t]);
    }
  }

  const cone = new THREE.ConeGeometry(1, 1, 6, 1);
  disposables.push(cone);
  const [sh, ss, sl] = palette.side;
  const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
  disposables.push(rockMat);

  // stalactites : pointes vers le bas, sous un « plafond » invisible
  const drips = face.list.filter(() => rnd() < 0.45);
  const stalactites = new THREE.InstancedMesh(cone, rockMat, Math.max(1, drips.length));
  drips.forEach((t, i) => {
    const h = 0.6 + rnd() * 1.6;
    dummy.position.set(wx(t.x) + (rnd() - 0.5) * 0.6, ceiling - h / 2 + rnd() * 0.6, wz(t.z) + (rnd() - 0.5) * 0.6);
    dummy.rotation.set(Math.PI, rnd() * 3, 0);
    dummy.scale.set(0.12 + rnd() * 0.12, h, 0.12 + rnd() * 0.12);
    dummy.updateMatrix();
    stalactites.setMatrixAt(i, dummy.matrix);
    stalactites.setColorAt(i, color.setHSL(sh, ss, sl + 0.04 + rnd() * 0.05));
  });
  stalactites.count = drips.length;

  // stalagmites : sur le pourtour, ancrées au niveau de la case voisine
  const mites = rim.filter(() => rnd() < 0.55);
  const stalagmites = new THREE.InstancedMesh(cone, rockMat, Math.max(1, mites.length));
  mites.forEach(([x, z, t], i) => {
    const h = 0.8 + rnd() * 2.2;
    const base = face.top(t) - 1.2;
    dummy.position.set(wx(x) + (rnd() - 0.5) * 0.4, base + h / 2, wz(z) + (rnd() - 0.5) * 0.4);
    dummy.rotation.set((rnd() - 0.5) * 0.2, rnd() * 3, (rnd() - 0.5) * 0.2);
    dummy.scale.set(0.2 + rnd() * 0.2, h, 0.2 + rnd() * 0.2);
    dummy.updateMatrix();
    stalagmites.setMatrixAt(i, dummy.matrix);
    stalagmites.setColorAt(i, color.setHSL(sh, ss, sl + rnd() * 0.05));
  });
  stalagmites.count = mites.length;

  // cristaux luisants : seule vraie lumière de la caverne
  const glowMat = patchIridescent(
    new THREE.MeshStandardMaterial({ color: new THREE.Color(palette.accent), emissive: new THREE.Color(palette.accent), emissiveIntensity: 1.6, roughness: 0.2, flatShading: true }),
    1.0,
  );
  disposables.push(glowMat);
  const oct = new THREE.OctahedronGeometry(1, 0);
  disposables.push(oct);
  const spots = rim.filter(() => rnd() < 0.3);
  const shards = [];
  for (const [x, z, t] of spots) {
    const k = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < k; i++) shards.push([wx(x) + (rnd() - 0.5) * 0.5, face.top(t) - 0.2 + rnd() * 0.2, wz(z) + (rnd() - 0.5) * 0.5]);
  }
  const crystals = new THREE.InstancedMesh(oct, glowMat, Math.max(1, shards.length));
  shards.forEach(([x, y, z], i) => {
    const s = 0.08 + rnd() * 0.12;
    dummy.position.set(x, y + s, z);
    dummy.rotation.set((rnd() - 0.5) * 0.8, rnd() * 3, (rnd() - 0.5) * 0.8);
    dummy.scale.set(s * 0.6, s * 2.4, s * 0.6);
    dummy.updateMatrix();
    crystals.setMatrixAt(i, dummy.matrix);
  });
  crystals.count = shards.length;

  for (const m of [stalactites, stalagmites, crystals]) {
    m.castShadow = m !== crystals;
    m.receiveShadow = true;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    group.add(m);
    disposables.push(m);
  }
  return { group, disposables };
}

/* ───────────── Sanctuaire ───────────── */

const gemGeo = () => once('altarGem', () => new THREE.OctahedronGeometry(0.16, 0).scale(1, 1.6, 1));

// Autel : socle de pierre, anneau à la couleur de l'émotion, gemme-fantôme
// en pointillés (en attente) remplacée par la vraie gemme une fois posée.
export function createAltar(stoneMat, accent) {
  const g = new THREE.Group();
  const tint = new THREE.Color(accent);
  const base = new THREE.Mesh(
    once('altarBase', () => new THREE.CylinderGeometry(0.3, 0.38, 0.12, 8)),
    stoneMat,
  );
  base.position.y = 0.06;
  base.receiveShadow = true;
  const ringMat = new THREE.MeshBasicMaterial({ color: tint.clone().multiplyScalar(1.6), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(once('altarRing', () => new THREE.RingGeometry(0.33, 0.4, 8).rotateX(-Math.PI / 2)), ringMat);
  ring.position.y = 0.125;

  const ghostMat = new THREE.MeshBasicMaterial({ color: tint, wireframe: true, transparent: true, opacity: 0.35, depthWrite: false });
  const ghost = new THREE.Mesh(gemGeo(), ghostMat);
  ghost.position.y = 0.75;

  const gemMat = patchIridescent(
    new THREE.MeshStandardMaterial({ color: tint.clone().lerp(new THREE.Color(1, 1, 1), 0.3), emissive: tint, emissiveIntensity: 1.6, roughness: 0.1, flatShading: true }),
    1.0,
  );
  const gem = new THREE.Mesh(gemGeo(), gemMat);
  gem.position.y = 0.75;
  gem.visible = false;
  gem.castShadow = true;
  const halo = makeHalo(tint, 1.3, 0);
  halo.position.y = 0.75;

  g.add(base, ring, ghost, gem, halo);
  g.userData = { ring, ringMat, ghost, ghostMat, gem, gemMat, halo, tint };
  return g;
}

// Clé du Réveil : anneau, tige et dents, dorée et lumineuse
export function createKey() {
  const g = new THREE.Group();
  const mat = patchIridescent(
    new THREE.MeshStandardMaterial({ color: 0xffe2a0, emissive: 0xffb84a, emissiveIntensity: 1.4, metalness: 0.8, roughness: 0.25 }),
    0.8,
  );
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.045, 10, 28), mat);
  bow.position.y = 0.3;
  const gemMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.2, 2.6) });
  const heart = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), gemMat);
  heart.position.y = 0.3;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 10), mat);
  shaft.position.y = -0.15;
  const teeth = new THREE.Group();
  for (const [y, w] of [
    [-0.36, 0.14],
    [-0.24, 0.1],
  ]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.04), mat);
    t.position.set(w / 2, y, 0);
    teeth.add(t);
  }
  const halo = makeHalo(0xffd47a, 1.8, 0.6);
  halo.position.y = 0.1;
  g.add(bow, heart, shaft, teeth, halo);
  g.userData = { mat, gemMat, halo, parts: [bow, heart, shaft, ...teeth.children] };
  return g;
}

// Forge centrale : cercle de pierres levées et vasque de lumière
export function createForge(stoneMat) {
  const g = new THREE.Group();
  const stone = once('forgeStone', () => new THREE.BoxGeometry(0.1, 0.5, 0.14));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const m = new THREE.Mesh(stone, stoneMat);
    m.position.set(Math.cos(a) * 0.38, 0.25, Math.sin(a) * 0.38);
    m.rotation.y = -a;
    m.castShadow = true;
    g.add(m);
  }
  const bowl = new THREE.Mesh(once('forgeBowl', () => new THREE.CylinderGeometry(0.24, 0.14, 0.18, 16)), stoneMat);
  bowl.position.y = 0.09;
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.2, 1.6), transparent: true, opacity: 0.25 });
  const glow = new THREE.Mesh(once('forgeGlow', () => new THREE.CircleGeometry(0.22, 24).rotateX(-Math.PI / 2)), glowMat);
  glow.position.y = 0.185;
  const halo = makeHalo(0xffffff, 1.6, 0.15);
  halo.position.y = 0.6;
  g.add(bowl, glow, halo);
  g.userData = { glowMat, halo };
  return g;
}

// Rayon entre un autel et la forge (apparaît quand la gemme est posée)
export function createRay(from, to, accent) {
  const len = from.distanceTo(to);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(1.8), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const m = new THREE.Mesh(once('rayGeo', () => new THREE.CylinderGeometry(0.018, 0.018, 1, 6, 1, true).rotateX(Math.PI / 2)), mat);
  m.position.copy(from).lerp(to, 0.5);
  m.scale.set(1, 1, len);
  m.lookAt(to);
  m.renderOrder = 4;
  m.userData = { mat };
  return m;
}

// Arche de la Porte du Réveil (encadre la gemme de fin du sanctuaire)
export function createDoorArch(stoneMat) {
  const g = new THREE.Group();
  const pillar = once('archPillar', () => new THREE.BoxGeometry(0.14, 1.5, 0.18));
  for (const x of [-0.5, 0.5]) {
    const p = new THREE.Mesh(pillar, stoneMat);
    p.position.set(x, 0.75, -0.1);
    p.castShadow = true;
    g.add(p);
  }
  const arc = new THREE.Mesh(once('archArc', () => new THREE.TorusGeometry(0.5, 0.08, 8, 24, Math.PI)), stoneMat);
  arc.position.set(0, 1.5, -0.1);
  arc.castShadow = true;
  const veilMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.2, 1.5), transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const veil = new THREE.Mesh(once('archVeil', () => {
    const s = new THREE.Shape();
    s.moveTo(-0.44, 0);
    s.lineTo(-0.44, 1.5);
    s.absarc(0, 1.5, 0.44, Math.PI, 0, true);
    s.lineTo(0.44, 0);
    return new THREE.ShapeGeometry(s, 16);
  }), veilMat);
  veil.position.z = -0.1;
  veil.renderOrder = 4;
  g.add(arc, veil);
  g.userData = { veilMat };
  return g;
}

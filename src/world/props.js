import * as THREE from 'three';
import { patchIridescent, patchStar, createHologramMaterial } from './materials.js';

// Fabriques d'objets de décor / gameplay. Géométries et matériaux
// partagés au niveau module pour limiter les allocations GPU.

export const COLORS = {
  gem: 0x5fe8ff,
  star: 0xffc45e,
  button: 0xff4fa0,
  lantern: 0xffb35c,
  mushroomA: 0x52f0d0,
  mushroomB: 0xb08cff,
  crystal: 0x9b6bff,
};

let haloTexture = null;
export function getHaloTexture() {
  if (haloTexture) return haloTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  haloTexture = new THREE.CanvasTexture(c);
  haloTexture.colorSpace = THREE.SRGBColorSpace;
  return haloTexture;
}

export function makeHalo(color, size, opacity = 0.6) {
  const mat = new THREE.SpriteMaterial({
    map: getHaloTexture(),
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(size);
  s.renderOrder = 5;
  return s;
}

const cache = {};
function once(key, fn) {
  return cache[key] ?? (cache[key] = fn());
}

/* ───────────── Cristal (collectible) ───────────── */

export function createGem() {
  const geo = once('gemGeo', () => {
    const g = new THREE.OctahedronGeometry(0.17, 0);
    g.scale(1, 1.5, 1);
    return g;
  });
  const coreGeo = once('gemCoreGeo', () => new THREE.OctahedronGeometry(0.07, 0));
  const mat = patchIridescent(new THREE.MeshStandardMaterial({
    color: 0x9ff6ff,
    emissive: COLORS.gem,
    emissiveIntensity: 1.5,
    roughness: 0.12,
    metalness: 0.2,
    flatShading: true,
    transparent: true,
    opacity: 0.92,
  }), 1.4);
  const coreMat = once('gemCoreMat', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3.2, 3.4) }));

  const group = new THREE.Group();
  const spin = new THREE.Group();
  const mesh = new THREE.Mesh(geo, mat);
  const core = new THREE.Mesh(coreGeo, coreMat);
  spin.add(mesh, core);
  const halo = makeHalo(COLORS.gem, 1.1, 0.5);
  group.add(spin, halo);
  group.userData = { spin, mat, halo, phase: Math.random() * Math.PI * 2 };
  return group;
}

/* ───────────── Étoile (objectif) ───────────── */

function starShape(outer, inner, points = 5) {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

export function createStar() {
  const group = new THREE.Group();

  const geo = new THREE.ExtrudeGeometry(starShape(0.34, 0.15), {
    depth: 0.08,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.04,
    bevelSegments: 3,
  });
  geo.center();
  const mat = patchStar(new THREE.MeshStandardMaterial({
    color: 0xffe2a0,
    emissive: COLORS.star,
    emissiveIntensity: 1.6,
    metalness: 0.55,
    roughness: 0.28,
  }));
  const star = new THREE.Mesh(geo, mat);
  star.castShadow = true;
  const spin = new THREE.Group();
  spin.add(star);
  spin.position.y = 0.62;

  const halo = makeHalo(COLORS.star, 2.2, 0.55);
  halo.position.y = 0.62;

  // Faisceau de lumière vertical
  const beamGeo = new THREE.CylinderGeometry(0.28, 0.42, 7, 32, 1, true);
  beamGeo.translate(0, 3.5, 0);
  const beamMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(COLORS.star) }, uStrength: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec2 vUv;
      void main() {
        float fadeY = pow(1.0 - vUv.y, 2.2);
        float streak = 0.6 + 0.4 * sin(vUv.x * 6.2831 * 6.0 + uTime * 1.5) * sin(vUv.y * 30.0 - uTime * 3.0);
        float a = fadeY * streak * 0.32 * uStrength;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.renderOrder = 4;

  // Anneau au sol
  const ringGeo = once('starRingGeo', () => {
    const g = new THREE.TorusGeometry(0.36, 0.018, 8, 64);
    g.rotateX(Math.PI / 2);
    return g;
  });
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.star).multiplyScalar(2.2) });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 0.06;
  const ring2 = ring.clone();
  ring2.scale.setScalar(0.7);
  ring2.position.y = 0.1;

  const light = new THREE.PointLight(COLORS.star, 5, 5, 1.6);
  light.position.y = 0.9;

  group.add(spin, halo, beam, ring, ring2, light);
  group.userData = { spin, halo, beamMat, ring, ring2, light, mat };
  return group;
}

/* ───────────── Interrupteur ───────────── */

export function createButton() {
  const group = new THREE.Group();
  const baseGeo = once('btnBase', () => new THREE.CylinderGeometry(0.34, 0.38, 0.07, 32));
  const capGeo = once('btnCap', () => new THREE.CylinderGeometry(0.24, 0.27, 0.1, 32));
  const baseMat = once('btnBaseMat', () => new THREE.MeshStandardMaterial({ color: 0x1a1830, roughness: 0.5, metalness: 0.6 }));
  const capMat = new THREE.MeshStandardMaterial({ color: 0xff9ccc, emissive: COLORS.button, emissiveIntensity: 1.2, roughness: 0.3 });

  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = 0.035;
  base.receiveShadow = true;
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.position.y = 0.11;
  cap.castShadow = true;

  const ringGeo = once('btnRing', () => {
    const g = new THREE.RingGeometry(0.4, 0.44, 48);
    g.rotateX(-Math.PI / 2);
    return g;
  });
  const ringMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(COLORS.button).multiplyScalar(1.6),
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 0.012;

  const halo = makeHalo(COLORS.button, 0.9, 0.35);
  halo.position.y = 0.2;

  group.add(base, cap, ring, halo);
  group.userData = { cap, capMat, ring, ringMat, halo };
  return group;
}

/* ───────────── Décor ───────────── */

export function createMushrooms(rnd) {
  const group = new THREE.Group();
  const stemGeo = once('mStem', () => new THREE.CylinderGeometry(0.022, 0.034, 1, 8).translate(0, 0.5, 0));
  const capGeo = once('mCap', () => new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2));
  const stemMat = once('mStemMat', () => new THREE.MeshStandardMaterial({ color: 0xcfc6e8, roughness: 0.8 }));
  const capMats = once('mCapMats', () => [
    new THREE.MeshStandardMaterial({ color: 0x7ff5df, emissive: COLORS.mushroomA, emissiveIntensity: 1.1, roughness: 0.4 }),
    new THREE.MeshStandardMaterial({ color: 0xc9b2ff, emissive: COLORS.mushroomB, emissiveIntensity: 1.1, roughness: 0.4 }),
  ]);
  const variant = rnd() < 0.5 ? 0 : 1;
  const n = 2 + ((rnd() * 2) | 0);
  for (let i = 0; i < n; i++) {
    const h = 0.12 + rnd() * 0.16;
    const r = 0.05 + rnd() * 0.05;
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.scale.set(1, h, 1);
    const cap = new THREE.Mesh(capGeo, capMats[variant]);
    cap.scale.set(r, r * 0.7, r);
    cap.position.y = h;
    const m = new THREE.Group();
    m.add(stem, cap);
    m.position.set((rnd() - 0.5) * 0.16, 0, (rnd() - 0.5) * 0.16);
    m.rotation.z = (rnd() - 0.5) * 0.3;
    m.rotation.x = (rnd() - 0.5) * 0.3;
    stem.castShadow = true;
    group.add(m);
  }
  const halo = makeHalo(variant ? COLORS.mushroomB : COLORS.mushroomA, 0.7, 0.28);
  halo.position.y = 0.2;
  group.add(halo);
  group.userData = { halo, phase: rnd() * 10 };
  return group;
}

export function createLamp() {
  const group = new THREE.Group();
  const postGeo = once('lPost', () => new THREE.CylinderGeometry(0.018, 0.026, 0.62, 8).translate(0, 0.31, 0));
  const armGeo = once('lArm', () => new THREE.TorusGeometry(0.08, 0.012, 6, 16, Math.PI));
  const orbGeo = once('lOrb', () => new THREE.SphereGeometry(0.05, 16, 12));
  const postMat = once('lPostMat', () => new THREE.MeshStandardMaterial({ color: 0x2b2945, roughness: 0.5, metalness: 0.5 }));
  const orbMat = once('lOrbMat', () => new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.lantern).multiplyScalar(3) }));

  const post = new THREE.Mesh(postGeo, postMat);
  post.castShadow = true;
  const arm = new THREE.Mesh(armGeo, postMat);
  arm.position.set(0.08, 0.62, 0);
  const orb = new THREE.Mesh(orbGeo, orbMat);
  orb.position.set(0.16, 0.56, 0);
  const halo = makeHalo(COLORS.lantern, 0.75, 0.5);
  halo.position.copy(orb.position);
  group.add(post, arm, orb, halo);
  group.userData = { halo, phase: Math.random() * 10 };
  return group;
}

export function createCrystals(rnd) {
  const group = new THREE.Group();
  const geo = once('cGeo', () => {
    const g = new THREE.OctahedronGeometry(1, 0);
    g.scale(0.35, 1, 0.35);
    g.translate(0, 0.6, 0);
    return g;
  });
  const mat = once('cMat', () =>
    patchIridescent(new THREE.MeshStandardMaterial({
      color: 0xc5a8ff,
      emissive: COLORS.crystal,
      emissiveIntensity: 1.3,
      roughness: 0.15,
      metalness: 0.1,
      flatShading: true,
    }), 0.6),
  );
  const n = 3 + ((rnd() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo, mat);
    const s = 0.12 + rnd() * 0.2;
    m.scale.setScalar(s);
    m.position.set((rnd() - 0.5) * 0.18, -0.02, (rnd() - 0.5) * 0.18);
    m.rotation.set((rnd() - 0.5) * 0.9, rnd() * Math.PI, (rnd() - 0.5) * 0.9);
    m.castShadow = true;
    group.add(m);
  }
  const halo = makeHalo(COLORS.crystal, 0.8, 0.3);
  halo.position.y = 0.15;
  group.add(halo);
  group.userData = { halo, phase: rnd() * 10 };
  return group;
}

/* ───────────── Fantôme de pont ───────────── */

export function createGhostBlock(w, h) {
  const edges = once(`ghostEdges${w}${h}`, () => new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, w)));
  const box = once(`ghostBox${w}${h}`, () => new THREE.BoxGeometry(w, h, w));
  const lineMat = once('ghostLine', () =>
    new THREE.LineBasicMaterial({ color: new THREE.Color(COLORS.button).multiplyScalar(1.4), transparent: true, opacity: 0.5, depthWrite: false }),
  );
  const fillMat = once('ghostFill', () =>
createHologramMaterial(COLORS.button),
  );
  const g = new THREE.Group();
  g.add(new THREE.LineSegments(edges, lineMat), new THREE.Mesh(box, fillMat));
  g.userData = { lineMat, fillMat };
  return g;
}

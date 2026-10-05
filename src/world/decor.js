import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { globalUniforms } from './materials.js';
import { makeHalo } from './props.js';

// Habillage « île flottante » d'une face de niveau : herbe qui ondule, fleurs
// lumineuses, rebords de mousse, rochers irréguliers sur les flancs, dessous
// en stalactites avec lianes, arbres, cascades de poussière d'étoiles, portail
// et plateformes. Tout ce qui est répété est instancié (1 draw call par type).

const dummy = new THREE.Object3D();
const color = new THREE.Color();
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/* ───────────── Ressources partagées ───────────── */

let R = null;
function res() {
  if (R) return R;

  // Touffe d'herbe : 4 brins effilés, un peu inclinés
  const blades = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.ConeGeometry(0.018, 0.2 + (i % 2) * 0.06, 3, 1);
    g.translate(0, 0.1 + (i % 2) * 0.03, 0);
    g.rotateZ((i - 1.5) * 0.22);
    g.rotateY(i * 1.7);
    g.translate(Math.cos(i * 2.1) * 0.03, 0, Math.sin(i * 2.1) * 0.03);
    blades.push(g);
  }
  const grassGeo = mergeGeometries(blades);
  const grassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, emissive: 0x0d3a3a, emissiveIntensity: 0.6 });
  // ondulation au vent (dans le vertex shader, par instance)
  grassMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
          float k = max(position.y, 0.0) / 0.26;
          transformed.x += sin(uTime * 1.8 + ip.x * 1.3 + ip.z * 0.7) * 0.05 * k * k;
          transformed.z += cos(uTime * 1.5 + ip.z * 1.1) * 0.03 * k * k;
        }`,
      );
  };
  grassMat.customProgramCacheKey = () => 'shine-grass';

  const lipMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
  const vineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.1, 0.95) });
  const flowerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.2) });

  R = {
    grassGeo,
    grassMat,
    lipGeo: new THREE.BoxGeometry(1, 1, 1),
    lipMat,
    dripGeo: new THREE.ConeGeometry(1, 1, 5).rotateX(Math.PI).translate(0, -0.5, 0),
    rockGeo: new THREE.DodecahedronGeometry(1, 0),
    rockMat,
    coneGeo: new THREE.ConeGeometry(0.68, 1, 5, 1).rotateX(Math.PI).translate(0, -0.5, 0),
    vineGeo: new THREE.CylinderGeometry(0.012, 0.006, 1, 4).translate(0, -0.5, 0),
    bulbGeo: new THREE.SphereGeometry(0.035, 8, 6),
    vineMat,
    flowerGeo: new THREE.SphereGeometry(0.028, 8, 6),
    flowerMat,
  };
  return R;
}

function instanced(geo, mat, n) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
  m.count = n;
  return m;
}

/* ───────────── Habillage d'une face ───────────── */

/**
 * @param {object} layer  face de niveau (tiles, list, offsets, top())
 * @param {() => number} rnd  PRNG déterministe
 * @param {object} opts  { underside: bool } dessous rocheux (îles non retournables)
 * @returns {{ group: THREE.Group, disposables: any[] }}
 */
export function buildIslandDecor(layer, rnd, { underside, palette }) {
  const r = res();
  const group = new THREE.Group();
  const disposables = [];
  const ground = layer.list.filter((t) => !t.bridge && !t.platform);
  const edgeDirs = (t) => DIRS.filter(([dx, dz]) => {
    const n = layer.tileAt(t.x + dx, t.z + dz);
    return !n || n.bridge || n.platform;
  });

  // Herbe & fleurs (on évite le centre des cases occupées par un objet)
  const grass = [];
  const flowers = [];
  for (const t of ground) {
    if (t.obj === 'T') continue;
    const busy = t.obj !== '.' && t.obj !== 'P';
    const n = busy ? 2 : 3 + ((rnd() * 4) | 0);
    for (let i = 0; i < n; i++) {
      let ox = (rnd() - 0.5) * 0.86;
      let oz = (rnd() - 0.5) * 0.86;
      if (busy && Math.hypot(ox, oz) < 0.32) {
        ox = Math.sign(ox || 1) * 0.36;
        oz = Math.sign(oz || 1) * 0.36;
      }
      grass.push([t.x - layer.offsetX + ox, layer.top(t), t.z - layer.offsetZ + oz, 0.7 + rnd() * 0.7, rnd()]);
    }
    if (rnd() < 0.35) {
      const k = 1 + ((rnd() * 3) | 0);
      for (let i = 0; i < k; i++) {
        flowers.push([t.x - layer.offsetX + (rnd() - 0.5) * 0.8, layer.top(t) + 0.03 + rnd() * 0.05, t.z - layer.offsetZ + (rnd() - 0.5) * 0.8, rnd()]);
      }
    }
  }
  const grassMesh = instanced(r.grassGeo, r.grassMat, grass.length);
  grass.forEach(([x, y, z, s, hue], i) => {
    dummy.position.set(x, y - 0.01, z);
    dummy.rotation.set(0, hue * 6.28, 0);
    dummy.scale.set(s, s * (0.8 + hue * 0.5), s);
    dummy.updateMatrix();
    grassMesh.setMatrixAt(i, dummy.matrix);
    const [gh, gs, gl] = hue < 0.75 ? palette.grass : palette.grassAlt;
    color.setHSL(gh + (hue % 0.25) * 0.2, gs, gl);
    grassMesh.setColorAt(i, color);
  });
  const flowerMesh = instanced(r.flowerGeo, r.flowerMat, flowers.length);
  flowers.forEach(([x, y, z, hue], i) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(0.7 + hue * 0.8);
    dummy.updateMatrix();
    flowerMesh.setMatrixAt(i, dummy.matrix);
    const f = palette.flowers;
    color.setHSL(hue < 0.5 ? f[0] : hue < 0.8 ? f[1] : f[2], 0.9, 0.62);
    flowerMesh.setColorAt(i, color);
  });

  // Rebords de mousse qui débordent + gouttes de mousse
  const lips = [];
  const drips = [];
  for (const t of ground) {
    for (const [dx, dz] of edgeDirs(t)) {
      const y = layer.top(t);
      const cx = t.x - layer.offsetX + dx * 0.5;
      const cz = t.z - layer.offsetZ + dz * 0.5;
      lips.push([cx, y - 0.035, cz, dx, dz, 0.9 + rnd() * 0.18]);
      if (rnd() < 0.55) drips.push([cx + (dz ? (rnd() - 0.5) * 0.7 : dx * 0.04), y - 0.07, cz + (dx ? (rnd() - 0.5) * 0.7 : dz * 0.04), 0.04 + rnd() * 0.05, 0.1 + rnd() * 0.22]);
    }
  }
  const lipMesh = instanced(r.lipGeo, r.lipMat, lips.length);
  lips.forEach(([x, y, z, dx, dz, w], i) => {
    dummy.position.set(x + dx * 0.035, y, z + dz * 0.035);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(dx ? 0.11 : w, 0.06, dz ? 0.11 : w);
    dummy.updateMatrix();
    lipMesh.setMatrixAt(i, dummy.matrix);
    color.setHSL(palette.lip[0] + rnd() * 0.04, palette.lip[1], palette.lip[2] + rnd() * 0.04);
    lipMesh.setColorAt(i, color);
  });
  const dripMesh = instanced(r.dripGeo, r.lipMat, drips.length);
  drips.forEach(([x, y, z, rad, len], i) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, rnd() * 3, 0);
    dummy.scale.set(rad, len, rad);
    dummy.updateMatrix();
    dripMesh.setMatrixAt(i, dummy.matrix);
    color.setHSL(...palette.lip);
    dripMesh.setColorAt(i, color);
  });

  // Rochers saillants sur les flancs extérieurs (silhouette irrégulière)
  const rocks = [];
  for (const t of ground) {
    const top = layer.top(t);
    for (const [dx, dz] of edgeDirs(t)) {
      const k = top > 1.2 ? 2 : 1;
      for (let i = 0; i < k; i++) {
        if (rnd() < 0.35) continue;
        const along = (rnd() - 0.5) * 0.8;
        rocks.push([
          t.x - layer.offsetX + dx * (0.46 + rnd() * 0.06) + (dz ? along : 0),
          0.15 + rnd() * Math.max(0.1, top - 0.45),
          t.z - layer.offsetZ + dz * (0.46 + rnd() * 0.06) + (dx ? along : 0),
          0.13 + rnd() * 0.17,
        ]);
      }
    }
  }
  const rockMesh = instanced(r.rockGeo, r.rockMat, rocks.length);
  rocks.forEach(([x, y, z, s], i) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    dummy.scale.set(s, s * (0.7 + rnd() * 0.5), s);
    dummy.updateMatrix();
    rockMesh.setMatrixAt(i, dummy.matrix);
    color.setHSL(palette.side[0] + rnd() * 0.03, palette.side[1] * 0.85, palette.side[2] + 0.02 + rnd() * 0.05);
    rockMesh.setColorAt(i, color);
  });

  const meshes = [grassMesh, flowerMesh, lipMesh, dripMesh, rockMesh];

  // Dessous rocheux : grappes de stalactites, lianes lumineuses
  if (underside) {
    let cx = 0;
    let cz = 0;
    ground.forEach((t) => {
      cx += t.x;
      cz += t.z;
    });
    cx /= ground.length || 1;
    cz /= ground.length || 1;
    const maxD = Math.max(1, ...ground.map((t) => Math.hypot(t.x - cx, t.z - cz)));
    const cones = [];
    const vines = [];
    for (const t of ground) {
      const center = 1 - Math.hypot(t.x - cx, t.z - cz) / maxD;
      const x = t.x - layer.offsetX;
      const z = t.z - layer.offsetZ;
      const main = 0.4 + center * 2.8 * (0.55 + rnd() * 0.45) + rnd() * 0.35;
      cones.push([x, z, 1, main, 0]);
      const extra = 1 + ((rnd() * 2) | 0);
      for (let i = 0; i < extra; i++) cones.push([x + (rnd() - 0.5) * 0.55, z + (rnd() - 0.5) * 0.55, 0.35 + rnd() * 0.3, main * (0.4 + rnd() * 0.6), (rnd() - 0.5) * 0.3]);
      if (edgeDirs(t).length && rnd() < 0.4) {
        const [dx, dz] = edgeDirs(t)[0];
        vines.push([x + dx * 0.4 + (rnd() - 0.5) * 0.3, z + dz * 0.4 + (rnd() - 0.5) * 0.3, 0.6 + rnd() * 1.8]);
      }
    }
    const coneMesh = instanced(r.coneGeo, layer.level.shared.underMat, cones.length);
    cones.forEach(([x, z, w, d, tilt], i) => {
      dummy.position.set(x, 0.001, z);
      dummy.rotation.set(tilt, rnd() * 6.28, tilt * 0.7);
      dummy.scale.set(w * (0.95 + rnd() * 0.1), d, w * (0.95 + rnd() * 0.1));
      dummy.updateMatrix();
      coneMesh.setMatrixAt(i, dummy.matrix);
      color.setHSL(palette.side[0] + rnd() * 0.03, palette.side[1] + 0.05, 0.07 + rnd() * 0.03);
      coneMesh.setColorAt(i, color);
    });
    coneMesh.castShadow = true;
    const vineMesh = instanced(r.vineGeo, r.vineMat, vines.length);
    const bulbMesh = instanced(r.bulbGeo, r.vineMat, vines.length);
    vines.forEach(([x, z, len], i) => {
      dummy.position.set(x, 0.02, z);
      dummy.rotation.set((rnd() - 0.5) * 0.15, 0, (rnd() - 0.5) * 0.15);
      dummy.scale.set(1, len, 1);
      dummy.updateMatrix();
      vineMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, -len, z);
      dummy.scale.setScalar(0.8 + rnd() * 0.6);
      dummy.updateMatrix();
      bulbMesh.setMatrixAt(i, dummy.matrix);
    });
    meshes.push(coneMesh, vineMesh, bulbMesh);
  }

  for (const m of meshes) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.receiveShadow = m !== flowerMesh;
    group.add(m);
    disposables.push(m);
  }
  rockMesh.castShadow = true;
  lipMesh.castShadow = true;
  return { group, disposables };
}

/* ───────────── Objets de décor ───────────── */

// Arbre cosmique (occupe sa case : Lumi ne peut pas la traverser)
export function createTree(rnd, palette) {
  const g = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2a52, roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({
    color: palette.leaves[rnd() < 0.5 ? 0 : 1],
    roughness: 0.6,
    flatShading: true,
    emissive: palette.leafGlow,
    emissiveIntensity: 0.6,
  });
  const h = 0.55 + rnd() * 0.25;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.09, h, 7).translate(0, h / 2, 0), trunkMat);
  trunk.rotation.z = (rnd() - 0.5) * 0.25;
  trunk.castShadow = true;
  g.add(trunk);
  const fruitMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.6, 0.9) });
  for (let i = 0; i < 3; i++) {
    const s = 0.2 + rnd() * 0.12;
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), leafMat);
    leaf.position.set((rnd() - 0.5) * 0.28, h + (i === 0 ? 0.12 : -0.02) + rnd() * 0.1, (rnd() - 0.5) * 0.28);
    leaf.rotation.set(rnd() * 3, rnd() * 3, 0);
    leaf.castShadow = true;
    g.add(leaf);
  }
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), fruitMat);
    const a = rnd() * 6.28;
    f.position.set(Math.cos(a) * 0.2, h - 0.08 + rnd() * 0.15, Math.sin(a) * 0.2);
    g.add(f);
  }
  g.userData = { phase: rnd() * 10, sway: g.children.slice(1, 4) };
  return g;
}

// Cascade de poussière d'étoiles qui tombe du bord dans le vide
export function createWaterfall(height = 7) {
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(0.62, height, 1, 1).translate(0, -height / 2, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: globalUniforms.uTime },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      float h(float x) { return fract(sin(x * 91.7) * 43758.5); }
      void main() {
        float x = vUv.x;
        float y = 1.0 - vUv.y;                       // 0 en haut
        float edge = smoothstep(0.0, 0.25, x) * smoothstep(1.0, 0.75, x);
        float col = floor(x * 14.0);
        float speed = 0.35 + h(col) * 0.4;
        float streak = smoothstep(0.55, 1.0, sin((y * 9.0 - uTime * speed * 6.0) + h(col) * 20.0));
        float fall = (1.0 - smoothstep(0.15, 1.0, y)) ;
        float a = edge * fall * (0.18 + streak * 0.55);
        vec3 c = mix(vec3(0.5, 1.0, 0.95), vec3(0.65, 0.5, 1.0), y);
        gl_FragColor = vec4(c * a * 1.4, a);
      }
    `,
  });
  const sheet = new THREE.Mesh(geo, mat);
  sheet.renderOrder = 3;
  const foam = makeHalo(0x9ffff0, 0.8, 0.5);
  foam.position.y = 0.02;
  g.add(sheet, foam);
  g.userData = { mat };
  return g;
}

// Portail de retournement : anneau dressé + vortex
export function createPortal() {
  const g = new THREE.Group();
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xc7c1e6, roughness: 0.35, metalness: 0.8, emissive: 0x6b3cff, emissiveIntensity: 0.5 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.045, 12, 40), ringMat);
  ring.castShadow = true;
  const runes = new THREE.Mesh(
    new THREE.TorusGeometry(0.33, 0.012, 6, 40),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.9, 2.6) }),
  );
  runes.scale.setScalar(1.12);
  const discMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: globalUniforms.uTime, uBoost: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uBoost;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float a = atan(p.y, p.x);
        float swirl = sin(a * 3.0 + r * 9.0 - uTime * 4.0) * 0.5 + 0.5;
        float m = smoothstep(1.0, 0.6, r);
        vec3 c = mix(vec3(0.35, 0.2, 1.0), vec3(0.4, 1.0, 0.95), swirl) * (0.5 + swirl * 0.8) + vec3(1.0) * smoothstep(0.35, 0.0, r) * 0.6;
        float alpha = m * (0.45 + swirl * 0.35) * (1.0 + uBoost);
        gl_FragColor = vec4(c * alpha, alpha);
      }
    `,
  });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.31, 40), discMat);
  disc.renderOrder = 4;
  const frame = new THREE.Group();
  frame.add(ring, runes, disc);
  frame.position.y = 0.45;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.08, 20), new THREE.MeshStandardMaterial({ color: 0x2b2547, metalness: 0.6, roughness: 0.4 }));
  base.position.y = 0.04;
  const halo = makeHalo(0x8f6bff, 1.4, 0.35);
  halo.position.y = 0.45;
  g.add(base, frame, halo);
  g.userData = { frame, runes, discMat, ringMat };
  return g;
}

// Plateforme mobile : dalle lumineuse avec propulseurs
export function createPlatform(blockGeo) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffd9a0, roughness: 0.35, metalness: 0.45, emissive: 0xff9d3c, emissiveIntensity: 0.14 });
  const slab = new THREE.Mesh(blockGeo, mat);
  slab.castShadow = true;
  slab.receiveShadow = true;
  const trimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.5, 0.6) });
  const trim = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.012, 6, 4), trimMat);
  trim.rotation.set(Math.PI / 2, 0, Math.PI / 4);
  trim.position.y = 0.245;
  const thrusterGeo = new THREE.ConeGeometry(0.12, 0.5, 12, 1, true).rotateX(Math.PI).translate(0, -0.25, 0);
  const thrusterMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.2, 0.7, 0.3),
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const thrusters = [];
  for (const [x, z] of [
    [-0.25, -0.25],
    [0.25, -0.25],
    [-0.25, 0.25],
    [0.25, 0.25],
  ]) {
    const t = new THREE.Mesh(thrusterGeo, thrusterMat);
    t.position.set(x, -0.25, z);
    thrusters.push(t);
    g.add(t);
  }
  g.add(slab, trim);
  g.userData = { mat, thrusters, trimMat };
  return g;
}


// Tremplin : socle, ressorts et membrane lumineuse qui se comprime au saut
export function createTrampoline() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x9c96c4, roughness: 0.4, metalness: 0.75 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.4, 0.06, 24), metal);
  base.position.y = 0.03;
  base.receiveShadow = true;
  const springGeo = new THREE.TorusGeometry(0.035, 0.01, 6, 12);
  const springs = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    for (let k = 0; k < 3; k++) {
      const s = new THREE.Mesh(springGeo, metal);
      s.rotation.x = Math.PI / 2;
      s.position.set(Math.cos(a) * 0.27, 0.08 + k * 0.035, Math.sin(a) * 0.27);
      springs.add(s);
    }
  }
  const pad = new THREE.Group();
  pad.position.y = 0.19;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.03, 10, 32), metal);
  rim.rotation.x = Math.PI / 2;
  rim.castShadow = true;
  const membraneMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: globalUniforms.uTime, uPulse: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uPulse;
      varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float rings = 0.5 + 0.5 * sin(r * 18.0 - uTime * 5.0);
        float a = (1.0 - smoothstep(0.85, 1.0, r)) * (0.25 + rings * 0.35 + uPulse * 0.8);
        vec3 c = mix(vec3(1.0, 0.55, 0.85), vec3(1.0, 0.85, 0.5), rings);
        gl_FragColor = vec4(c * a * 1.4, a);
      }
    `,
  });
  const membrane = new THREE.Mesh(new THREE.CircleGeometry(0.3, 32).rotateX(-Math.PI / 2), membraneMat);
  membrane.renderOrder = 4;
  pad.add(rim, membrane);
  const halo = makeHalo(0xff9ad0, 0.9, 0.3);
  halo.position.y = 0.25;
  g.add(base, springs, pad, halo);
  g.userData = { pad, membraneMat, springs, squash: 0 };
  return g;
}
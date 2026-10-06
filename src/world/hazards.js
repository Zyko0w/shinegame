import * as THREE from 'three';
import { globalUniforms, patchIridescent } from './materials.js';
import { makeHalo } from './props.js';

// Obstacles qui rendent les îles plus exigeantes :
// - D : bloc de pierre à pousser (il comble une fosse ou refroidit la lave) ;
// - _ : fosse (vide au milieu du sol) : on y tombe, un bloc la comble ;
// - ~ : coulée de lave : franchissable quand la croûte est froide, brûlante
//       quand la lave monte (cycle commun à toute l'île) ;
// - < > ^ v : éolienne soufflant dans la direction indiquée : sa bourrasque
//       pousse Lumi jusqu'au premier obstacle… ou dans le vide.
// La logique (cycles, poussées) est dans world/level.js, l'orchestration dans main.js.

const once = (() => {
  const cache = {};
  return (key, fn) => cache[key] ?? (cache[key] = fn());
})();

// Cycles (secondes de jeu)
export const LAVA_CYCLE = { period: 4.6, warn: 2.6, hot: 3.3 }; // froide → frémit → brûle
export const WIND_CYCLE = { period: 5.2, on: 2.6 }; // souffle pendant `on` secondes

/* ───────────── Bloc à pousser ───────────── */

export function createBlock(stoneMat) {
  const g = new THREE.Group();
  const geo = once('blockGeo', () => {
    const b = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    b.translate(0, 0.4, 0);
    return b;
  });
  const body = new THREE.Mesh(geo, stoneMat);
  body.castShadow = true;
  body.receiveShadow = true;
  // rune lumineuse sur chaque face : « poussez-moi »
  const runeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.2, 0.6), transparent: true, opacity: 0.55, depthWrite: false });
  const rune = once('blockRune', () => new THREE.RingGeometry(0.12, 0.16, 4, 1));
  for (let i = 0; i < 4; i++) {
    const r = new THREE.Mesh(rune, runeMat);
    const a = (i * Math.PI) / 2;
    r.position.set(Math.sin(a) * 0.405, 0.42, Math.cos(a) * 0.405);
    r.rotation.y = a;
    g.add(r);
  }
  g.add(body);
  g.userData = { body, runeMat };
  return g;
}

/* ───────────── Fosse ───────────── */

// Contour lumineux en pointillés au-dessus du trou (un bloc y tiendrait)
export function createPitMarker() {
  const mat = new THREE.LineDashedMaterial({ color: new THREE.Color(1.4, 0.9, 0.5), dashSize: 0.08, gapSize: 0.06, transparent: true, opacity: 0.5, depthWrite: false });
  const geo = once('pitEdges', () => new THREE.EdgesGeometry(new THREE.BoxGeometry(0.8, 0.02, 0.8)));
  const lines = new THREE.LineSegments(geo, mat);
  lines.computeLineDistances();
  const g = new THREE.Group();
  g.add(lines);
  g.userData = { mat };
  return g;
}

/* ───────────── Coulée de lave ───────────── */

// Nappes de lave instanciées (une par case ~), animées par uHot (0 froide → 1 brûlante)
export function createLavaField(tiles, face, accent) {
  const n = tiles.length;
  const geo = new THREE.PlaneGeometry(0.98, 0.98, 1, 1).rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { uTime: globalUniforms.uTime, uHot: { value: 0 }, uWarn: { value: 0 }, uColor: { value: new THREE.Color(accent) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vW;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uHot;
      uniform float uWarn;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying vec3 vW;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        vec2 p = vW.xz * 2.2;
        float flow = n2(p + vec2(uTime * 0.35, uTime * 0.2)) * 0.6 + n2(p * 2.3 - uTime * 0.5) * 0.4;
        // croûte froide : plaques sombres veinées de rouge ; chaude : lave vive
        float veins = smoothstep(0.62, 0.78, flow);
        vec3 crust = mix(vec3(0.06, 0.03, 0.04), uColor * 0.9, veins * (0.35 + uWarn * 0.8));
        vec3 hot = mix(uColor * 1.6, vec3(2.6, 1.8, 0.6), flow);
        vec3 c = mix(crust, hot, uHot);
        float edge = smoothstep(0.0, 0.06, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
        gl_FragColor = vec4(c, mix(0.6, 1.0, edge));
      }
    `,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
  const m = new THREE.Matrix4();
  tiles.forEach((t, i) => {
    m.makeTranslation(t.x - face.offsetX, face.top(t) + 0.012, t.z - face.offsetZ);
    mesh.setMatrixAt(i, m);
  });
  mesh.count = n;
  mesh.renderOrder = 2;
  return { mesh, mat, geo };
}

/* ───────────── Éolienne ───────────── */

export function createFan(stoneMat, dir) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(once('fanBase', () => new THREE.CylinderGeometry(0.22, 0.3, 0.5, 8).translate(0, 0.25, 0)), stoneMat);
  base.castShadow = true;
  const metal = once('fanMetal', () => patchIridescent(new THREE.MeshStandardMaterial({ color: 0xd8e4ff, metalness: 0.7, roughness: 0.3 }), 0.5));
  const hub = new THREE.Group();
  hub.position.y = 0.72;
  const blade = once('fanBlade', () => new THREE.BoxGeometry(0.07, 0.36, 0.02).translate(0, 0.2, 0));
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(blade, metal);
    b.rotation.z = (i * Math.PI) / 2;
    b.rotation.y = 0.35; // pales inclinées
    b.castShadow = true;
    hub.add(b);
  }
  const cap = new THREE.Mesh(once('fanCap', () => new THREE.SphereGeometry(0.06, 10, 8)), metal);
  hub.add(cap);
  const ring = new THREE.Mesh(once('fanRing', () => new THREE.TorusGeometry(0.44, 0.03, 8, 32)), metal);
  ring.position.y = 0.72;
  g.add(base, hub, ring);
  // le ventilateur regarde dans la direction du souffle
  g.rotation.y = Math.atan2(dir[0], dir[1]);
  g.userData = { hub, ring, spin: 0 };
  return g;
}

// Traînées de vent le long du couloir de la bourrasque (visibles quand elle souffle)
export function createWindStreaks(from, dir, length, color) {
  const n = Math.max(6, Math.round(length * 7));
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 0.7; // écart latéral
    pos[i * 3 + 1] = 0.15 + Math.random() * 0.7;
    pos[i * 3 + 2] = Math.random();
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: globalUniforms.uTime,
      uPixelRatio: globalUniforms.uPixelRatio,
      uOn: { value: 0 },
      uLen: { value: length },
      uFrom: { value: from.clone() },
      uDir: { value: new THREE.Vector3(dir[0], 0, dir[1]) },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uOn;
      uniform float uLen;
      uniform vec3 uFrom;
      uniform vec3 uDir;
      varying float vA;
      void main() {
        float k = fract(position.z + uTime * (0.9 + aSeed * 0.6));
        vec3 side = vec3(-uDir.z, 0.0, uDir.x);
        vec3 p = uFrom + uDir * (0.4 + k * uLen) + side * position.x + vec3(0.0, position.y + sin(uTime * 3.0 + aSeed * 9.0) * 0.05, 0.0);
        vA = uOn * smoothstep(0.0, 0.15, k) * (1.0 - smoothstep(0.75, 1.0, k));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = 14.0 * uPixelRatio * (16.0 / max(-mv.z, 0.5)) * 0.35;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        c.y *= 4.0; // traits horizontaux
        float a = smoothstep(0.5, 0.0, length(c)) * vA;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  return { points: pts, mat };
}

// Halo de point de reprise (lanterne allumée)
export function createCheckpointGlow() {
  const h = makeHalo(0xffc06a, 1.6, 0);
  h.position.y = 0.6;
  return h;
}

/* ───────────── Dalle fragile ───────────── */

// Dalle de pierre fissurée posée dans le vide ; les fissures rougeoient quand
// Lumi est dessus (opacité de crackMat)
export function createFragileSlab(blockGeo, stoneMat) {
  const g = new THREE.Group();
  const slab = new THREE.Mesh(blockGeo, stoneMat);
  slab.castShadow = true;
  slab.receiveShadow = true;
  const crackMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 0.9, 0.4), transparent: true, opacity: 0.25, depthWrite: false });
  const crackGeo = once('crackGeo', () => {
    // trois fissures en zigzag sur le dessus
    const pts = [];
    const zig = (x0, z0, x1, z1) => {
      let px = x0;
      let pz = z0;
      for (let i = 1; i <= 4; i++) {
        const k = i / 4;
        const nx = x0 + (x1 - x0) * k + (i % 2 ? 0.05 : -0.05);
        const nz = z0 + (z1 - z0) * k + (i % 2 ? -0.04 : 0.04);
        pts.push(px, 0, pz, nx, 0, nz);
        px = nx;
        pz = nz;
      }
    };
    zig(-0.4, -0.1, 0.35, 0.2);
    zig(-0.05, -0.42, 0.1, 0.4);
    zig(0.1, -0.05, 0.42, -0.35);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return geo;
  });
  const lines = new THREE.LineSegments(crackGeo, crackMat);
  lines.position.y = 0.25;
  g.add(slab, lines);
  g.userData = { slab, crackMat };
  return g;
}

/* ───────────── Plaque de pression ───────────── */

export function createPlate() {
  const g = new THREE.Group();
  const baseMat = once('plateBase', () => new THREE.MeshStandardMaterial({ color: 0x2a2440, metalness: 0.5, roughness: 0.5 }));
  const base = new THREE.Mesh(once('plateBaseGeo', () => new THREE.BoxGeometry(0.72, 0.05, 0.72)), baseMat);
  base.position.y = 0.025;
  base.receiveShadow = true;
  const capMat = new THREE.MeshStandardMaterial({ color: 0xa8f0ff, emissive: 0x3fd8ff, emissiveIntensity: 0.4, roughness: 0.4 });
  const cap = new THREE.Mesh(once('plateCapGeo', () => new THREE.BoxGeometry(0.56, 0.06, 0.56)), capMat);
  cap.position.y = 0.08;
  g.add(base, cap);
  g.userData = { cap, capMat, pressed: 0 };
  return g;
}

/* ───────────── Rayons ───────────── */

const crystalMat = () =>
  once('beamCrystal', () =>
    patchIridescent(new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffd47a, emissiveIntensity: 1.4, roughness: 0.15, flatShading: true }), 1.0),
  );

// Émetteur : socle et cristal d'où part le rayon (orienté dans sa direction)
export function createEmitter(stoneMat, dir) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(once('emitBase', () => new THREE.CylinderGeometry(0.26, 0.32, 0.5, 6).translate(0, 0.25, 0)), stoneMat);
  base.castShadow = true;
  const gem = new THREE.Mesh(once('emitGem', () => new THREE.OctahedronGeometry(0.16, 0).scale(1, 1, 1.6)), crystalMat());
  gem.position.set(0, 0.62, 0.1);
  const halo = makeHalo(0xffd47a, 1.2, 0.5);
  halo.position.set(0, 0.62, 0.2);
  g.add(base, gem, halo);
  g.rotation.y = Math.atan2(dir[0], dir[1]);
  g.userData = { gem };
  return g;
}

// Miroir orientable : plaque argentée sur pivot, tournée à 45° (« / » ou « \ »)
export function createRotor(stoneMat) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(once('rotorBase', () => new THREE.CylinderGeometry(0.3, 0.34, 0.12, 12).translate(0, 0.06, 0)), stoneMat);
  base.receiveShadow = true;
  const pivot = new THREE.Group();
  pivot.position.y = 0.12;
  const glass = patchIridescent(new THREE.MeshStandardMaterial({ color: 0xe8fff8, metalness: 1, roughness: 0.05, emissive: 0x2a5a6a, emissiveIntensity: 0.3 }), 1.2);
  const plate = new THREE.Mesh(once('rotorPlate', () => new THREE.BoxGeometry(0.62, 0.62, 0.04).translate(0, 0.38, 0)), glass);
  plate.castShadow = true;
  const frame = new THREE.Mesh(once('rotorFrame', () => new THREE.BoxGeometry(0.06, 0.7, 0.06).translate(0, 0.35, 0)), stoneMat);
  pivot.add(plate, frame);
  const halo = makeHalo(0xaefcff, 1, 0);
  halo.position.y = 0.5;
  g.add(base, pivot, halo);
  g.userData = { pivot, glass, halo };
  return g;
}

// Angle du pivot pour une orientation (vu de dessus, la plaque suit la diagonale)
export const rotorAngle = (m) => (m === '/' ? Math.PI / 4 : -Math.PI / 4);

// Récepteur : cristal éteint qui s'illumine quand le rayon le touche
export function createReceptor(stoneMat) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(once('recBase', () => new THREE.CylinderGeometry(0.22, 0.3, 0.4, 8).translate(0, 0.2, 0)), stoneMat);
  base.castShadow = true;
  const mat = new THREE.MeshStandardMaterial({ color: 0x6a6480, emissive: 0xffd47a, emissiveIntensity: 0, roughness: 0.2, flatShading: true });
  const gem = new THREE.Mesh(once('recGem', () => new THREE.IcosahedronGeometry(0.2, 0)), mat);
  gem.position.y = 0.62;
  const halo = makeHalo(0xffd47a, 1.6, 0);
  halo.position.y = 0.62;
  g.add(base, gem, halo);
  g.userData = { gem, mat, halo, lit: 0 };
  return g;
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const tmpDir = new THREE.Vector3();

// Tracé du rayon : un cylindre fin par segment (géométrie partagée, mise à l'échelle)
export class BeamLine {
  constructor(parent) {
    this.group = new THREE.Group();
    parent.add(this.group);
    this.mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.9, 1.0), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
    this.geo = once('beamGeo', () => new THREE.CylinderGeometry(0.035, 0.035, 1, 8, 1, true).rotateX(Math.PI / 2));
    this.segments = [];
  }

  // points : liste de Vector3 (repère de la face)
  set(points) {
    for (const s of this.segments) s.removeFromParent();
    this.segments.length = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const m = new THREE.Mesh(this.geo, this.mat);
      m.position.copy(a).lerp(b, 0.5);
      m.scale.set(1, 1, Math.max(0.01, a.distanceTo(b)));
      m.quaternion.setFromUnitVectors(Z_AXIS, tmpDir.subVectors(b, a).normalize());
      m.renderOrder = 4;
      this.group.add(m);
      this.segments.push(m);
    }
  }
}

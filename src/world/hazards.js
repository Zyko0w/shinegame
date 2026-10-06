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

// Turbine dans une tuyère de métal irisé posée sur un socle de pierre.
// Repère local : +Z = sens du souffle. L'anneau (coreMat) et le halo
// s'illuminent quand elle souffle ; level.update() fait tourner `hub`.
export function createFan(stoneMat, dir) {
  const g = new THREE.Group();
  const metal = once('fanMetal', () => patchIridescent(new THREE.MeshStandardMaterial({ color: 0xd8e4ff, metalness: 0.75, roughness: 0.28, side: THREE.DoubleSide }), 0.6));
  const dark = once('fanDark', () => new THREE.MeshStandardMaterial({ color: 0x2a2848, metalness: 0.6, roughness: 0.4 }));

  // socle : dalle octogonale + fût
  const plinth = new THREE.Mesh(once('fanPlinth', () => new THREE.CylinderGeometry(0.32, 0.38, 0.16, 8).translate(0, 0.08, 0)), stoneMat);
  const post = new THREE.Mesh(once('fanPost', () => new THREE.CylinderGeometry(0.09, 0.14, 0.42, 8).translate(0, 0.37, 0)), stoneMat);
  plinth.castShadow = post.castShadow = true;
  plinth.receiveShadow = true;

  // tuyère : cylindre ouvert dans l'axe du souffle, lèvres en tore
  const Y = 0.82;
  const duct = new THREE.Mesh(once('fanDuct', () => new THREE.CylinderGeometry(0.4, 0.34, 0.36, 28, 1, true).rotateX(Math.PI / 2)), metal);
  duct.position.y = Y;
  duct.castShadow = true;
  const lipFront = new THREE.Mesh(once('fanLip', () => new THREE.TorusGeometry(0.4, 0.035, 8, 32)), metal);
  lipFront.position.set(0, Y, 0.18);
  const lipBack = new THREE.Mesh(once('fanLipBack', () => new THREE.TorusGeometry(0.34, 0.03, 8, 32)), metal);
  lipBack.position.set(0, Y, -0.18);
  // grille arrière (trois barreaux) qui tient le moyeu
  const struts = new THREE.Group();
  const strutGeo = once('fanStrut', () => new THREE.BoxGeometry(0.66, 0.025, 0.025));
  for (let i = 0; i < 3; i++) {
    const st = new THREE.Mesh(strutGeo, dark);
    st.rotation.z = (i * Math.PI) / 3;
    struts.add(st);
  }
  struts.position.set(0, Y, -0.16);

  // anneau lumineux au bord de la tuyère : sombre au repos, vif quand ça souffle
  const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.7, 0.9), toneMapped: false });
  const core = new THREE.Mesh(once('fanCore', () => new THREE.TorusGeometry(0.37, 0.016, 6, 40)), coreMat);
  core.position.set(0, Y, 0.2);

  // rotor : cône + cinq pales vrillées
  const hub = new THREE.Group();
  hub.position.set(0, Y, 0.02);
  const nose = new THREE.Mesh(once('fanNose', () => new THREE.ConeGeometry(0.075, 0.2, 14).rotateX(Math.PI / 2).translate(0, 0, 0.08)), metal);
  const bladeGeo = once('fanBlade2', () => {
    const b = new THREE.BoxGeometry(0.11, 0.3, 0.012, 1, 4, 1).translate(0, 0.19, 0);
    // vrille : la pale tourne sur elle-même vers son extrémité
    const pos = b.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const a = 0.25 + y * 1.4;
      pos.setXYZ(i, x * Math.cos(a) - z * Math.sin(a), y, x * Math.sin(a) + z * Math.cos(a));
    }
    b.computeVertexNormals();
    return b;
  });
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(bladeGeo, metal);
    b.rotation.z = (i * Math.PI * 2) / 5;
    b.castShadow = true;
    hub.add(b);
  }
  hub.add(nose);

  // ailerons arrière : le sens du souffle se lit même à l'arrêt
  const finGeo = once('fanFin', () => new THREE.BoxGeometry(0.02, 0.22, 0.26).translate(0, 0, -0.13));
  const fins = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const f = new THREE.Mesh(finGeo, dark);
    f.rotation.z = (i * Math.PI) / 2;
    fins.add(f);
  }
  fins.position.set(0, Y, -0.2);

  const halo = makeHalo(0xcff4ff, 1.5, 0);
  halo.position.set(0, Y, 0.35);

  g.add(plinth, post, duct, lipFront, lipBack, struts, core, hub, fins, halo);
  // le ventilateur regarde dans la direction du souffle
  g.rotation.y = Math.atan2(dir[0], dir[1]);
  g.userData = { hub, coreMat, halo, spin: 0, glow: 0 };
  return g;
}

// Rubans de vent : traits lumineux (deux plans croisés, lisibles sous tous les
// angles) qui filent le long du couloir de la bourrasque en ondulant.
export function createWindStreaks(from, dir, length, color) {
  const n = Math.max(12, Math.round(length * 10));
  const geo = new THREE.InstancedBufferGeometry();
  // deux quads : x = le long du trait (0 tête → 1 queue), y = en travers, z = plan (0 à plat, 1 debout)
  const corner = new Float32Array([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0, 0, -1, 1, 0, 1, 1, 1, -1, 1, 1, 1, 1]);
  geo.setAttribute('position', new THREE.BufferAttribute(corner, 3));
  geo.setIndex([0, 2, 1, 2, 3, 1, 4, 6, 5, 6, 7, 5]);
  const seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    seed[i * 4] = (Math.random() - 0.5) * 0.85; // écart latéral
    seed[i * 4 + 1] = 0.12 + Math.random() * 0.85; // hauteur
    seed[i * 4 + 2] = Math.random(); // phase
    seed[i * 4 + 3] = Math.random(); // vitesse et longueur
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: globalUniforms.uTime,
      uOn: { value: 0 },
      uLen: { value: length },
      uFrom: { value: from.clone() },
      uDir: { value: new THREE.Vector3(dir[0], 0, dir[1]) },
      uColor: { value: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.45) },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime;
      uniform float uOn;
      uniform float uLen;
      uniform vec3 uFrom;
      uniform vec3 uDir;
      varying float vA;
      varying vec2 vC;
      void main() {
        float travel = uLen + 1.2; // le souffle continue un peu au-delà du bord
        float k = fract(aSeed.z + uTime * (2.6 + aSeed.w * 2.0) / travel);
        float L = 0.35 + aSeed.w * 0.55;
        float along = 0.3 + k * travel - position.x * L;
        vec3 side = vec3(-uDir.z, 0.0, uDir.x);
        float wob = sin(along * 3.2 + aSeed.z * 21.0 + uTime * 2.5) * 0.09;
        float lift = cos(along * 2.6 + aSeed.z * 13.0) * 0.07;
        float w = (0.016 + aSeed.w * 0.014) * (1.0 - position.x * 0.6);
        vec3 p = uFrom + uDir * along + side * (aSeed.x + wob) + vec3(0.0, aSeed.y + lift, 0.0);
        if (position.z < 0.5) p += side * position.y * w; else p.y += position.y * w;
        vA = uOn * smoothstep(0.0, 0.1, k) * (1.0 - smoothstep(0.82, 1.0, k));
        vC = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vA;
      varying vec2 vC;
      void main() {
        float a = vA * pow(1.0 - vC.x, 1.6) * (1.0 - vC.y * vC.y);
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor * a * 1.8, a);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return { points: mesh, mat };
}

// Chevrons au sol le long du couloir : discrets au repos, ils clignotent juste
// avant la bourrasque (uWarn) puis défilent dans le sens du souffle (uOn).
const chevronGeo = () =>
  once('windChevron', () => {
    const s = new THREE.Shape();
    s.moveTo(-0.24, -0.1);
    s.lineTo(0, 0.12);
    s.lineTo(0.24, -0.1);
    s.lineTo(0.24, -0.2);
    s.lineTo(0, 0.02);
    s.lineTo(-0.24, -0.2);
    s.closePath();
    // à plat, pointe vers +Z
    return new THREE.ShapeGeometry(s).rotateX(Math.PI / 2);
  });

export function createWindLane(tiles, face, dir, color) {
  const geo = chevronGeo().clone(); // attribut d'instance propre à chaque couloir
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: globalUniforms.uTime, uOn: { value: 0 }, uWarn: { value: 0 }, uColor: { value: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35) } },
    vertexShader: /* glsl */ `
      attribute float aK;
      varying float vK;
      void main() {
        vK = aK;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOn;
      uniform float uWarn;
      uniform vec3 uColor;
      varying float vK;
      void main() {
        float wave = smoothstep(0.5, 1.0, fract(vK * 0.25 - uTime * 2.4));
        float idle = 0.12 + uWarn * (0.3 + 0.3 * sin(uTime * 20.0));
        float g = mix(idle, 0.4 + wave * 1.5, uOn);
        gl_FragColor = vec4(uColor * g, min(1.0, g));
      }
    `,
  });
  const n = Math.max(1, tiles.length * 2);
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const k = new Float32Array(n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dir[0], dir[1]));
  const one = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  tiles.forEach((t, i) => {
    for (let j = 0; j < 2; j++) {
      const off = j ? 0.22 : -0.22;
      p.set(t.x - face.offsetX + dir[0] * off, face.top(t) + 0.014, t.z - face.offsetZ + dir[1] * off);
      m.compose(p, q, one);
      mesh.setMatrixAt(i * 2 + j, m);
      k[i * 2 + j] = i * 2 + j;
    }
  });
  mesh.count = tiles.length * 2;
  geo.setAttribute('aK', new THREE.InstancedBufferAttribute(k, 1));
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  return { mesh, mat };
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

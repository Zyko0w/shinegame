import * as THREE from 'three';
import { globalUniforms, patchIridescent } from './materials.js';

// Habillage propre à chaque émotion (config : `palette.biome`, game/moods.js) :
// - bassins `V` remplis du « liquide » de l'émotion (lave pour la colère,
//   larmes pour la tristesse, vif-argent pour la jalousie…) ;
// - éléments de décor posés sur l'île (fissures de lave, flaques, cairns,
//   ronces et yeux dans l'ombre, souches mortes, éclats de miroir…) ;
// - atmosphère : particules animées entièrement dans le shader (pluie,
//   neige, braises, lucioles, feuilles mortes, spores, reflets).
// Tout est instancié ; aucune mise à jour CPU par image.

const dummy = new THREE.Object3D();
const color = new THREE.Color();
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/* ───────────── Liquide (bassins, fontaines, cascades) ───────────── */

export function liquidMaterial(palette) {
  const b = palette.biome;
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: globalUniforms.uTime,
      uDeep: { value: new THREE.Color(b.liquid[0]) },
      uBright: { value: new THREE.Color(b.liquid[1]).multiplyScalar(b.glow) },
      uFlow: { value: b.flow },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 p = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
        vec4 w = modelMatrix * p;
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uBright;
      uniform float uFlow;
      varying vec3 vW;
      varying vec2 vUv;
      void main() {
        vec2 p = vW.xz * 2.6;
        float t = uTime * uFlow * 6.0;
        // cellules qui dérivent (croûte de lave, reflets d'eau)
        float n = sin(p.x * 1.7 + t) * sin(p.y * 1.9 - t * 0.8)
                + 0.5 * sin(p.x * 3.9 - p.y * 2.7 + t * 1.6)
                + 0.25 * sin(p.x * 7.3 + p.y * 6.1 - t * 2.3);
        float k = smoothstep(-0.2, 1.3, n);
        vec3 c = mix(uDeep, uBright, pow(k, 2.2));
        // bord du bassin plus sombre
        float d = max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)) * 2.0;
        c *= mix(1.0, 0.45, smoothstep(0.72, 1.0, d));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
}

/* ───────────── Ressources partagées ───────────── */

let R = null;
function res() {
  if (R) return R;
  R = {
    plane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    disc: new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2),
    hexDisc: new THREE.CircleGeometry(1, 6).rotateX(-Math.PI / 2),
    stem: new THREE.CylinderGeometry(0.012, 0.018, 1, 5).translate(0, 0.5, 0),
    bulb: new THREE.SphereGeometry(1, 10, 8),
    cone: new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0),
    stone: new THREE.DodecahedronGeometry(1, 0),
    box: new THREE.BoxGeometry(1, 1, 1),
    hex: new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0),
    stump: new THREE.CylinderGeometry(0.8, 1, 1, 7).translate(0, 0.5, 0),
  };
  return R;
}

function instanced(geo, mat, items, place) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  m.count = items.length;
  items.forEach((it, i) => {
    dummy.position.set(0, 0, 0);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    const c = place(it, dummy);
    dummy.updateMatrix();
    m.setMatrixAt(i, dummy.matrix);
    if (c) m.setColorAt(i, c);
  });
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  return m;
}

/* ───────────── Décor d'une face ───────────── */

/**
 * @param {object} layer  face de niveau
 * @param {() => number} rnd
 * @param {object} palette  palette de l'émotion (avec `biome`)
 * @returns {{ group: THREE.Group, disposables: any[] }}
 */
export function buildBiome(layer, rnd, palette) {
  const r = res();
  const biome = palette.biome;
  const group = new THREE.Group();
  const disposables = [];
  const meshes = [];
  const add = (m, { cast = false, receive = true } = {}) => {
    m.castShadow = cast;
    m.receiveShadow = receive;
    meshes.push(m);
  };
  const ground = layer.list.filter((t) => !t.bridge && !t.platform);
  const wx = (t) => t.x - layer.offsetX;
  const wz = (t) => t.z - layer.offsetZ;
  // cases libres : on décore les coins pour laisser le centre à Lumi
  const free = ground.filter((t) => t.obj === '.' && !t.blocked);
  const corner = () => [(rnd() < 0.5 ? -1 : 1) * (0.25 + rnd() * 0.15), (rnd() < 0.5 ? -1 : 1) * (0.25 + rnd() * 0.15)];
  const isEdge = (t) => DIRS.some(([dx, dz]) => !layer.tileAt(t.x + dx, t.z + dz));

  // Bassins (V) : liquide de l'émotion, légèrement en retrait du bord
  const pools = ground.filter((t) => t.obj === 'V');
  if (pools.length) {
    const mat = liquidMaterial(palette);
    disposables.push(mat);
    const m = instanced(r.plane, mat, pools, (t, d) => {
      d.position.set(wx(t), layer.top(t) + 0.008, wz(t));
      d.scale.set(0.84, 1, 0.84);
    });
    add(m, { receive: false });
    // pierres de bordure
    const stones = [];
    for (const t of pools) {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + rnd() * 0.4;
        stones.push([wx(t) + Math.cos(a) * 0.42, layer.top(t), wz(t) + Math.sin(a) * 0.42, 0.05 + rnd() * 0.05]);
      }
    }
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    disposables.push(stoneMat);
    add(
      instanced(r.stone, stoneMat, stones, ([x, y, z, s], d) => {
        d.position.set(x, y + s * 0.3, z);
        d.rotation.set(rnd() * 3, rnd() * 3, 0);
        d.scale.set(s, s * 0.7, s);
        return color.setHSL(palette.side[0], palette.side[1], palette.side[2] + 0.06 + rnd() * 0.05);
      }),
      { cast: true },
    );
  }

  for (const f of biome.features ?? []) {
    const pick = (p) => free.filter(() => rnd() < p);
    switch (f) {
      case 'blooms': {
        // grosses fleurs-lanternes sur tige
        const items = pick(0.3).map((t) => {
          const [ox, oz] = corner();
          return [wx(t) + ox, layer.top(t), wz(t) + oz, 0.2 + rnd() * 0.22, rnd()];
        });
        const stemMat = new THREE.MeshStandardMaterial({ color: 0x3e8f86, roughness: 0.7 });
        const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        disposables.push(stemMat, bulbMat);
        add(instanced(r.stem, stemMat, items, ([x, y, z, h], d) => (d.position.set(x, y, z), d.scale.set(1, h, 1), null)));
        add(
          instanced(r.bulb, bulbMat, items, ([x, y, z, h, k], d) => {
            d.position.set(x, y + h, z);
            d.scale.setScalar(0.045 + k * 0.025);
            return color.setHSL(palette.flowers[(k * 3) | 0], 0.9, 0.62).multiplyScalar(2.2);
          }),
          { receive: false },
        );
        break;
      }
      case 'puddles': {
        const items = pick(0.4).map((t) => [wx(t) + (rnd() - 0.5) * 0.4, layer.top(t) + 0.006, wz(t) + (rnd() - 0.5) * 0.4, 0.14 + rnd() * 0.2]);
        const mat = new THREE.MeshStandardMaterial({ color: 0x1d3a7a, roughness: 0.04, metalness: 0.7, emissive: 0x2a5cc0, emissiveIntensity: 0.25 });
        disposables.push(mat);
        add(instanced(r.disc, mat, items, ([x, y, z, s], d) => (d.position.set(x, y, z), d.scale.set(s, 1, s * (0.7 + rnd() * 0.4)), null)));
        break;
      }
      case 'willows': {
        // roseaux bleutés au bord de l'eau
        const items = [];
        for (const t of pick(0.35)) {
          const [ox, oz] = corner();
          for (let i = 0; i < 4; i++) items.push([wx(t) + ox + (rnd() - 0.5) * 0.12, layer.top(t), wz(t) + oz + (rnd() - 0.5) * 0.12, 0.2 + rnd() * 0.25]);
        }
        const mat = new THREE.MeshStandardMaterial({ color: 0x7fa6d8, roughness: 0.8 });
        disposables.push(mat);
        add(
          instanced(r.cone, mat, items, ([x, y, z, h], d) => {
            d.position.set(x, y, z);
            d.rotation.set((rnd() - 0.5) * 0.4, 0, (rnd() - 0.5) * 0.4);
            d.scale.set(0.018, h, 0.018);
            return null;
          }),
          { cast: true },
        );
        break;
      }
      case 'cairns': {
        const items = [];
        for (const t of pick(0.22)) {
          const [ox, oz] = corner();
          let y = layer.top(t);
          for (let i = 0; i < 3; i++) {
            const s = 0.07 - i * 0.015;
            items.push([wx(t) + ox, y + s * 0.55, wz(t) + oz, s]);
            y += s * 1.05;
          }
        }
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
        disposables.push(mat);
        add(
          instanced(r.stone, mat, items, ([x, y, z, s], d) => {
            d.position.set(x, y, z);
            d.rotation.set(0, rnd() * 3, 0);
            d.scale.set(s, s * 0.55, s);
            return color.setHSL(palette.top[0], 0.08, 0.5 + rnd() * 0.15);
          }),
          { cast: true },
        );
        break;
      }
      case 'frost': {
        // plaques de givre
        const items = pick(0.4).map((t) => [wx(t) + (rnd() - 0.5) * 0.5, layer.top(t) + 0.005, wz(t) + (rnd() - 0.5) * 0.5, 0.1 + rnd() * 0.18]);
        const mat = new THREE.MeshStandardMaterial({ color: 0xe6fbff, roughness: 0.35, emissive: 0x7fd8ff, emissiveIntensity: 0.15 });
        disposables.push(mat);
        add(instanced(r.hexDisc, mat, items, ([x, y, z, s], d) => (d.position.set(x, y, z), d.rotation.set(0, rnd() * 3, 0), d.scale.set(s, 1, s), null)));
        break;
      }
      case 'thorns': {
        const items = [];
        for (const t of pick(0.32)) {
          const [ox, oz] = corner();
          for (let i = 0; i < 5; i++) items.push([wx(t) + ox, layer.top(t), wz(t) + oz, 0.12 + rnd() * 0.2]);
        }
        const mat = new THREE.MeshStandardMaterial({ color: 0x1a0f2e, roughness: 0.6, emissive: 0x3a1066, emissiveIntensity: 0.3 });
        disposables.push(mat);
        add(
          instanced(r.cone, mat, items, ([x, y, z, h], d) => {
            d.position.set(x, y, z);
            d.rotation.set((rnd() - 0.5) * 1.2, rnd() * 3, (rnd() - 0.5) * 1.2);
            d.scale.set(0.02, h, 0.02);
            return null;
          }),
          { cast: true },
        );
        break;
      }
      case 'eyes': {
        // paires d'yeux qui clignent dans l'ombre, au ras des flancs
        const items = ground
          .filter((t) => isEdge(t) && rnd() < 0.35)
          .map((t) => {
            const [dx, dz] = DIRS.find(([a, b]) => !layer.tileAt(t.x + a, t.z + b));
            return [wx(t) + dx * 0.56, layer.top(t) - 0.2 - rnd() * Math.max(0, layer.top(t) - 0.6), wz(t) + dz * 0.56];
          });
        if (items.length) {
          const m = eyePoints(items, 0xc89bff);
          disposables.push(m.geometry, m.material);
          meshes.push(m);
        }
        break;
      }
      case 'stumps': {
        const items = pick(0.22).map((t) => {
          const [ox, oz] = corner();
          return [wx(t) + ox, layer.top(t), wz(t) + oz, 0.05 + rnd() * 0.04, 0.08 + rnd() * 0.14];
        });
        const mat = new THREE.MeshStandardMaterial({ color: 0x4a3a22, roughness: 0.95, flatShading: true });
        disposables.push(mat);
        add(
          instanced(r.stump, mat, items, ([x, y, z, w, h], d) => (d.position.set(x, y, z), d.rotation.set(0, rnd() * 3, (rnd() - 0.5) * 0.2), d.scale.set(w, h, w), null)),
          { cast: true },
        );
        break;
      }
      case 'spikes': {
        const items = [];
        for (const t of pick(0.25)) {
          const [ox, oz] = corner();
          for (let i = 0; i < 3; i++) items.push([wx(t) + ox + (rnd() - 0.5) * 0.1, layer.top(t), wz(t) + oz + (rnd() - 0.5) * 0.1, 0.1 + rnd() * 0.16]);
        }
        const mat = new THREE.MeshStandardMaterial({ color: 0x8a5a2a, roughness: 0.5, metalness: 0.6 });
        disposables.push(mat);
        add(
          instanced(r.cone, mat, items, ([x, y, z, h], d) => (d.position.set(x, y, z), d.rotation.set((rnd() - 0.5) * 0.5, 0, (rnd() - 0.5) * 0.5), d.scale.set(0.03, h, 0.03), null)),
          { cast: true },
        );
        break;
      }
      case 'cracks': {
        // fissures de lave incandescentes sur le sol
        const items = [];
        for (const t of free.filter(() => rnd() < 0.45)) {
          const n = 2 + ((rnd() * 2) | 0);
          for (let i = 0; i < n; i++) items.push([wx(t) + (rnd() - 0.5) * 0.6, layer.top(t) + 0.004, wz(t) + (rnd() - 0.5) * 0.6, 0.18 + rnd() * 0.3, rnd() * Math.PI]);
        }
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.9, 0.2) });
        disposables.push(mat);
        add(
          instanced(r.box, mat, items, ([x, y, z, l, a], d) => (d.position.set(x, y, z), d.rotation.set(0, a, 0), d.scale.set(l, 0.012, 0.022), null)),
          { receive: false },
        );
        break;
      }
      case 'basalt': {
        // orgues basaltiques sur les flancs
        const items = [];
        for (const t of ground.filter(isEdge)) {
          if (rnd() < 0.45) continue;
          const [dx, dz] = DIRS.find(([a, b]) => !layer.tileAt(t.x + a, t.z + b));
          const along = (rnd() - 0.5) * 0.7;
          items.push([wx(t) + dx * 0.5 + (dz ? along : 0), wz(t) + dz * 0.5 + (dx ? along : 0), layer.top(t) * (0.5 + rnd() * 0.55), 0.06 + rnd() * 0.06]);
        }
        const mat = new THREE.MeshStandardMaterial({ color: 0x241a1c, roughness: 0.8, flatShading: true });
        disposables.push(mat);
        add(
          instanced(r.hex, mat, items, ([x, z, h, w], d) => (d.position.set(x, 0, z), d.scale.set(w, h, w), null)),
          { cast: true },
        );
        break;
      }
      case 'shards': {
        // éclats de miroir plantés dans le sol
        const items = pick(0.35).map((t) => {
          const [ox, oz] = corner();
          return [wx(t) + ox, layer.top(t), wz(t) + oz, 0.14 + rnd() * 0.22];
        });
        const mat = patchIridescent(new THREE.MeshStandardMaterial({ color: 0xdff8f0, roughness: 0.08, metalness: 0.95, emissive: 0x2a6a5a, emissiveIntensity: 0.2 }), 1.1);
        disposables.push(mat);
        add(
          instanced(r.box, mat, items, ([x, y, z, h], d) => {
            d.position.set(x, y + h * 0.4, z);
            d.rotation.set((rnd() - 0.5) * 0.5, rnd() * 3, (rnd() - 0.5) * 0.5);
            d.scale.set(0.09, h, 0.012);
            return null;
          }),
          { cast: true },
        );
        break;
      }
    }
  }

  for (const m of meshes) {
    group.add(m);
    disposables.push(m);
  }
  return { group, disposables };
}

/* ───────────── Yeux dans l'ombre ───────────── */

function eyePoints(items, hex) {
  const pos = new Float32Array(items.length * 3);
  const seed = new Float32Array(items.length);
  items.forEach(([x, y, z], i) => {
    pos.set([x, y, z], i * 3);
    seed[i] = Math.random();
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: globalUniforms.uTime, uPixelRatio: globalUniforms.uPixelRatio, uColor: { value: new THREE.Color(hex).multiplyScalar(2.2) } },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vOpen;
      void main() {
        // ouverts un moment, puis disparaissent ; clignement rapide
        float cycle = fract(uTime * 0.07 + aSeed * 7.0);
        float shown = smoothstep(0.0, 0.05, cycle) * (1.0 - smoothstep(0.55, 0.6, cycle));
        float blink = step(0.06, abs(fract(uTime * 0.31 + aSeed * 3.0) - 0.5));
        vOpen = shown * blink;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = 22.0 * uPixelRatio * (16.0 / max(-mv.z, 0.5)) * 0.35;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vOpen;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        vec2 q = vec2(abs(p.x) - 0.2, p.y * 2.2);
        float a = smoothstep(0.12, 0.04, length(q)) * vOpen;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  return pts;
}

/* ───────────── Atmosphère ───────────── */

/**
 * Particules d'ambiance autour de l'île (dans un volume qui boucle sur lui-même).
 * @param {{radius: number, maxTop: number}} bounds
 */
export function createAtmosphere(palette, bounds, rnd) {
  const a = palette.biome?.atmo;
  if (!a) return null;
  const n = a.count;
  const half = bounds.radius + 1.5;
  const boxMin = new THREE.Vector3(-half, -1.5, -half);
  const boxSize = new THREE.Vector3(half * 2, bounds.maxTop + 5, half * 2);
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = boxMin.x + rnd() * boxSize.x;
    pos[i * 3 + 1] = boxMin.y + rnd() * boxSize.y;
    pos[i * 3 + 2] = boxMin.z + rnd() * boxSize.z;
    for (let k = 0; k < 4; k++) seed[i * 4 + k] = rnd();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const streak = a.kind === 'rain' ? 1 : 0;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: globalUniforms.uTime,
      uPixelRatio: globalUniforms.uPixelRatio,
      uColor: { value: new THREE.Color(a.color).multiplyScalar(a.kind === 'embers' || a.kind === 'fireflies' ? 2 : 1.2) },
      uVel: { value: new THREE.Vector3(...a.vel) },
      uBoxMin: { value: boxMin },
      uBoxSize: { value: boxSize },
      uSize: { value: a.size },
      uSway: { value: a.sway },
      uTwinkle: { value: a.twinkle },
      uStreak: { value: streak },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime;
      uniform float uPixelRatio;
      uniform vec3 uVel;
      uniform vec3 uBoxMin;
      uniform vec3 uBoxSize;
      uniform float uSize;
      uniform float uSway;
      uniform float uTwinkle;
      varying float vA;
      void main() {
        vec3 p = position + uVel * uTime * (0.7 + aSeed.y * 0.6);
        p = uBoxMin + mod(p - uBoxMin, uBoxSize);
        float ph = aSeed.x * 6.2831;
        p.x += sin(uTime * (0.4 + aSeed.y) + ph) * uSway;
        p.z += cos(uTime * (0.35 + aSeed.z) + ph * 1.3) * uSway;
        float fy = (p.y - uBoxMin.y) / uBoxSize.y;
        float edge = smoothstep(0.0, 0.12, fy) * (1.0 - smoothstep(0.82, 1.0, fy));
        float tw = uTwinkle > 0.0 ? 0.25 + 0.75 * pow(0.5 + 0.5 * sin(uTime * uTwinkle * (0.5 + aSeed.w) + ph), 2.0) : 1.0;
        vA = edge * tw;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(uSize * (0.6 + aSeed.w * 0.8) * uPixelRatio * (16.0 / max(-mv.z, 0.5)), 48.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStreak;
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        c.x *= 1.0 + uStreak * 4.0; // gouttes de pluie : traits verticaux
        float a = smoothstep(0.5, 0.0, length(c));
        a *= a * vA;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor * a, 1.0);
      }
    `,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 3;
  return pts;
}

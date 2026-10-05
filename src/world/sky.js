import * as THREE from 'three';
import { globalUniforms } from './materials.js';

// Ciel cosmique : nébuleuse procédurale + champ d'étoiles scintillantes
// + géante gazeuse annelée + étoiles filantes. Le groupe suit la caméra,
// donc tout paraît infiniment lointain (parallaxe nulle, rotation seule).

const NOISE = /* glsl */ `
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      a *= 0.5;
    }
    return v;
  }
`;

function createNebula() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uA: { value: new THREE.Color(0.3, 0.11, 0.55) },
      uB: { value: new THREE.Color(0.04, 0.3, 0.4) },
      uC: { value: new THREE.Color(0.62, 0.14, 0.36) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uA;
      uniform vec3 uB;
      uniform vec3 uC;
      varying vec3 vDir;
      ${NOISE}
      void main() {
        vec3 d = normalize(vDir);
        vec3 bandN = normalize(vec3(0.35, 0.85, -0.4));
        float bd = dot(d, bandN) * 2.6;
        float band = exp(-bd * bd);

        float n1 = fbm(d * 2.1 + vec3(0.0, uTime * 0.006, 0.0));
        float n2 = fbm(d * 4.3 + n1 * 1.9 + vec3(5.2, 1.3, 2.8));
        float lanes = fbm(d * 9.0 + n2);

        vec3 col = mix(vec3(0.010, 0.007, 0.026), vec3(0.028, 0.016, 0.060), d.y * 0.5 + 0.5);
        vec3 violet = uA;
        vec3 teal = uB;
        vec3 rose = uC;

        float neb = smoothstep(0.42, 0.85, n2) * (0.25 + band * 0.9);
        col += violet * neb * 0.6;
        col += teal * smoothstep(0.5, 0.9, n1) * band * 0.45;
        col += rose * pow(n2, 4.0) * band * 0.7;
        col += vec3(0.5, 0.42, 0.8) * band * 0.035;
        col *= 0.65 + 0.35 * smoothstep(0.25, 0.65, lanes);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(300, 64, 32), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

function createStars(count) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const seed = new Float32Array(count);
  const palette = [new THREE.Color(0xbfd4ff), new THREE.Color(0xffffff), new THREE.Color(0xffe2b8), new THREE.Color(0xd6c4ff), new THREE.Color(0x9ff0ff)];
  const v = new THREE.Vector3();
  const bandN = new THREE.Vector3(0.35, 0.85, -0.4).normalize();
  for (let i = 0; i < count; i++) {
    // Densité plus forte le long de la « voie lactée »
    do {
      v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
    } while (v.lengthSq() > 1 || v.lengthSq() < 0.01);
    v.normalize();
    if (Math.random() < 0.45) {
      v.addScaledVector(bandN, -v.dot(bandN) * (0.65 + Math.random() * 0.3)).normalize();
    }
    v.multiplyScalar(280);
    pos.set([v.x, v.y, v.z], i * 3);
    const c = palette[(Math.random() * palette.length) | 0];
    col.set([c.r, c.g, c.b], i * 3);
    const r = Math.random();
    size[i] = 0.6 + Math.pow(r, 7) * 4.5;
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: { uTime: { value: 0 }, uPixelRatio: globalUniforms.uPixelRatio },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aSeed;
      uniform float uTime;
      uniform float uPixelRatio;
      varying vec3 vColor;
      varying float vBright;
      void main() {
        vColor = color;
        float tw = 0.65 + 0.35 * sin(uTime * (0.6 + aSeed * 2.4) + aSeed * 60.0);
        vBright = tw * (0.55 + aSize * 0.35);
        gl_PointSize = aSize * uPixelRatio * (0.8 + tw * 0.4);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vBright;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float core = smoothstep(0.5, 0.0, d);
        core *= core;
        if (core < 0.01) discard;
        gl_FragColor = vec4(vColor * core * vBright, 1.0);
      }
    `,
  });
  const pts = new THREE.Points(geo, mat);
  pts.renderOrder = -9;
  pts.frustumCulled = false;
  return pts;
}

function createPlanet() {
  const group = new THREE.Group();
  const lightDir = new THREE.Vector3(0.8, 0.35, 0.5).normalize();

  const planetMat = new THREE.ShaderMaterial({
    uniforms: { uLight: { value: lightDir }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vPos;
      varying vec3 vView;
      void main() {
        vNormal = normalize(mat3(modelMatrix) * normal);
        vPos = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uLight;
      uniform float uTime;
      varying vec3 vNormal;
      varying vec3 vPos;
      varying vec3 vView;
      ${NOISE}
      void main() {
        vec3 p = normalize(vPos);
        float warp = fbm(p * 3.0 + vec3(uTime * 0.01, 0.0, 0.0));
        float bands = sin(p.y * 14.0 + warp * 4.0) * 0.5 + 0.5;
        vec3 a = vec3(0.30, 0.16, 0.42);
        vec3 b = vec3(0.85, 0.52, 0.55);
        vec3 c = vec3(0.16, 0.10, 0.30);
        vec3 col = mix(mix(c, a, bands), b, smoothstep(0.7, 1.0, bands) * 0.55);
        float diff = max(dot(vNormal, uLight), 0.0);
        float term = smoothstep(0.0, 0.35, diff);
        float rim = pow(1.0 - max(dot(vNormal, vView), 0.0), 3.0);
        vec3 lit = col * (0.04 + term * 0.9) + vec3(0.55, 0.4, 1.0) * rim * (0.25 + term * 0.6);
        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(22, 64, 32), planetMat);
  group.add(planet);

  const ringGeo = new THREE.RingGeometry(29, 46, 160, 1);
  const ringMat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    uniforms: {},
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vPos;
      float h(float x) { return fract(sin(x * 91.17) * 43758.5); }
      void main() {
        float r = (length(vPos.xy) - 29.0) / 17.0;
        float stripes = 0.55 + 0.45 * sin(r * 70.0) * sin(r * 23.0 + 1.3);
        float gap = smoothstep(0.42, 0.46, r) * (1.0 - smoothstep(0.5, 0.54, r));
        float edge = smoothstep(0.0, 0.08, r) * (1.0 - smoothstep(0.86, 1.0, r));
        float a = edge * stripes * (1.0 - gap * 0.85) * 0.55;
        vec3 col = mix(vec3(0.75, 0.55, 0.85), vec3(1.0, 0.8, 0.65), r);
        gl_FragColor = vec4(col * 0.75, a);
      }
    `,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI * 0.42;
  ring.rotation.y = -0.25;
  group.add(ring);

  // Petite lune
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(3.2, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0x8f86b8 }),
  );
  moon.position.set(48, 14, 10);
  group.add(moon);

  group.position.set(-120, 46, -190);
  group.renderOrder = -8;
  return { group, planetMat };
}

function createShootingStars() {
  const max = 3;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 2 * 3);
  const col = new Float32Array(max * 2 * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = -7;

  const items = Array.from({ length: max }, () => ({ life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3() }));
  let timer = 3;
  const tmp = new THREE.Vector3();

  function spawn(it) {
    it.p.set(Math.random() * 2 - 1, 0.2 + Math.random() * 0.7, Math.random() * 2 - 1).normalize().multiplyScalar(220);
    tmp.set(Math.random() * 2 - 1, -0.3 - Math.random() * 0.4, Math.random() * 2 - 1);
    it.v.copy(tmp).addScaledVector(it.p, -tmp.dot(it.p) / it.p.lengthSq()).normalize().multiplyScalar(160 + Math.random() * 80);
    it.max = 0.6 + Math.random() * 0.5;
    it.life = it.max;
  }

  function update(dt) {
    timer -= dt;
    if (timer <= 0) {
      timer = 4 + Math.random() * 7;
      const free = items.find((i) => i.life <= 0);
      if (free) spawn(free);
    }
    for (let i = 0; i < max; i++) {
      const it = items[i];
      const o = i * 6;
      if (it.life <= 0) {
        col.fill(0, o, o + 6);
        continue;
      }
      it.life -= dt;
      it.p.addScaledVector(it.v, dt);
      const k = Math.max(0, it.life / it.max);
      const fade = Math.sin(k * Math.PI);
      pos[o] = it.p.x; pos[o + 1] = it.p.y; pos[o + 2] = it.p.z;
      pos[o + 3] = it.p.x - it.v.x * 0.12; pos[o + 4] = it.p.y - it.v.y * 0.12; pos[o + 5] = it.p.z - it.v.z * 0.12;
      col[o] = 1.6 * fade; col[o + 1] = 1.5 * fade; col[o + 2] = 1.9 * fade;
      col[o + 3] = 0; col[o + 4] = 0; col[o + 5] = 0;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  return { lines, update };
}

// Couleurs de nébuleuse par émotion (teinte dominante, nuages, éclats)
export const SKY_MOODS = {
  wonder: [[0.3, 0.11, 0.55], [0.04, 0.3, 0.4], [0.62, 0.14, 0.36]],
  sad: [[0.08, 0.16, 0.5], [0.03, 0.22, 0.42], [0.25, 0.32, 0.7]],
  lonely: [[0.12, 0.18, 0.45], [0.02, 0.36, 0.4], [0.35, 0.22, 0.6]],
  fear: [[0.24, 0.05, 0.42], [0.06, 0.04, 0.22], [0.48, 0.06, 0.42]],
  bitter: [[0.2, 0.26, 0.08], [0.04, 0.2, 0.14], [0.46, 0.36, 0.08]],
  anger: [[0.5, 0.07, 0.07], [0.42, 0.16, 0.02], [0.62, 0.05, 0.24]],
};

// La nébuleuse (fbm 5 octaves × 3, plein écran) coûtait cher à chaque frame :
// on la précalcule dans une cubemap utilisée comme fond de scène, et on la
// recalcule seulement quand l émotion du niveau change (écran masqué).
function createNebulaBaker(renderer, scene) {
  const nebula = createNebula();
  const target = new THREE.WebGLCubeRenderTarget(1024, { type: THREE.HalfFloatType });
  const cubeCamera = new THREE.CubeCamera(1, 1000, target);
  const bakeScene = new THREE.Scene();
  bakeScene.add(nebula);
  scene.background = target.texture;
  let current = null;
  return (mood) => {
    const cols = SKY_MOODS[mood] ?? SKY_MOODS.wonder;
    if (current === mood) return;
    current = mood;
    const u = nebula.material.uniforms;
    u.uA.value.setRGB(...cols[0]);
    u.uB.value.setRGB(...cols[1]);
    u.uC.value.setRGB(...cols[2]);
    cubeCamera.update(renderer, bakeScene);
  };
}

export function createSky(renderer, scene) {
  const group = new THREE.Group();
  const bake = createNebulaBaker(renderer, scene);
  bake("wonder");
  const stars = createStars(3200);
  const planet = createPlanet();
  const shooting = createShootingStars();
  group.add(stars, planet.group, shooting.lines);

  return {
    group,
    setMood: bake,
    update(t, dt, camera) {
      group.position.copy(camera.position);
      stars.material.uniforms.uTime.value = t;
      planet.planetMat.uniforms.uTime.value = t;
      planet.group.rotation.y = t * 0.003;
      shooting.update(dt);
    },
  };
}

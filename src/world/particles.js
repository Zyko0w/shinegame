import * as THREE from 'three';
import { globalUniforms } from './materials.js';

// Poussière d'étoiles ambiante (100 % GPU) + pool d'éclats pour les
// effets ponctuels (cristal, interrupteur, pas, étoile). Aucune
// allocation dans la boucle : tout est préalloué.

const POINT_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    a *= a;
    if (a * vAlpha < 0.005) discard;
    gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
  }
`;

function createDust(count) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const palette = [new THREE.Color(0x8ff3ff), new THREE.Color(0xb79bff), new THREE.Color(0xffd9a0), new THREE.Color(0xffffff)];
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 1 + Math.sqrt(Math.random()) * 11;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = Math.random() * 12 - 4;
    pos[i * 3 + 2] = Math.sin(a) * r;
    const c = palette[(Math.random() * palette.length) | 0];
    col.set([c.r, c.g, c.b], i * 3);
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: { uTime: { value: 0 }, uPixelRatio: globalUniforms.uPixelRatio },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      uniform float uPixelRatio;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        float life = fract(uTime * (0.012 + aSeed * 0.02) + aSeed * 7.0);
        p.y += life * 6.0;
        p.x += sin(uTime * 0.4 + aSeed * 40.0) * 0.4;
        p.z += cos(uTime * 0.35 + aSeed * 30.0) * 0.4;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = 0.5 + 0.5 * sin(uTime * (2.0 + aSeed * 3.0) + aSeed * 90.0);
        vAlpha = sin(life * 3.14159) * (0.35 + tw * 0.65);
        vColor = color * 1.4;
        gl_PointSize = min((2.0 + aSeed * 3.5) * uPixelRatio * (14.0 / max(-mv.z, 0.5)), 64.0);
      }
    `,
    fragmentShader: POINT_FRAG,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

export class Particles {
  constructor(capacity = 600) {
    this.group = new THREE.Group();
    this.dust = createDust(340);
    this.group.add(this.dust);

    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.alpha = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.cursor = 0;
    this.alive = 0;
    this.clean = true;
    this.fresh = false; // couleurs / tailles à renvoyer au GPU (seulement après une émission)

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      uniforms: { uPixelRatio: globalUniforms.uPixelRatio },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        attribute float aSize;
        uniform float uPixelRatio;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min(aSize * uPixelRatio * (16.0 / max(-mv.z, 0.5)), 64.0);
        }
      `,
      fragmentShader: POINT_FRAG,
    });
    this.burst = new THREE.Points(geo, mat);
    this.burst.frustumCulled = false;
    this.group.add(this.burst);
    this.tmpColor = new THREE.Color();
  }

  emit(origin, color, count, { speed = 2, up = 1.5, life = 0.9, size = 6, gravity = -2.5, drag = 2.2, spread = 0.1, intensity = 2 } = {}) {
    const c = this.tmpColor.set(color).multiplyScalar(intensity);
    this.clean = false;
    this.fresh = true;
    this.alive = Math.max(this.alive, 1);
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.cap;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random();
      const sp = speed * (0.4 + Math.random() * 0.6);
      this.pos[i * 3] = origin.x + Math.cos(a) * spread * r;
      this.pos[i * 3 + 1] = origin.y;
      this.pos[i * 3 + 2] = origin.z + Math.sin(a) * spread * r;
      this.vel[i * 3] = Math.cos(a) * sp;
      this.vel[i * 3 + 1] = up * (0.5 + Math.random() * 0.8);
      this.vel[i * 3 + 2] = Math.sin(a) * sp;
      this.col[i * 3] = c.r;
      this.col[i * 3 + 1] = c.g;
      this.col[i * 3 + 2] = c.b;
      this.size[i] = size * (0.5 + Math.random() * 0.8);
      this.maxLife[i] = this.life[i] = life * (0.6 + Math.random() * 0.6);
      this.grav[i] = gravity;
      this.drag[i] = drag;
    }
  }

  // Anneau horizontal (onde de choc)
  ring(origin, color, count, radiusSpeed = 3, opts = {}) {
    const c = this.tmpColor.set(color).multiplyScalar(opts.intensity ?? 2);
    this.clean = false;
    this.fresh = true;
    this.alive = Math.max(this.alive, 1);
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.cap;
      const a = (n / count) * Math.PI * 2;
      this.pos[i * 3] = origin.x;
      this.pos[i * 3 + 1] = origin.y;
      this.pos[i * 3 + 2] = origin.z;
      this.vel[i * 3] = Math.cos(a) * radiusSpeed;
      this.vel[i * 3 + 1] = opts.up ?? 0.2;
      this.vel[i * 3 + 2] = Math.sin(a) * radiusSpeed;
      this.col[i * 3] = c.r;
      this.col[i * 3 + 1] = c.g;
      this.col[i * 3 + 2] = c.b;
      this.size[i] = opts.size ?? 5;
      this.maxLife[i] = this.life[i] = opts.life ?? 0.7;
      this.grav[i] = 0;
      this.drag[i] = opts.drag ?? 3;
    }
  }

  update(dt, t) {
    this.dust.material.uniforms.uTime.value = t;
    if (dt <= 0) return;
    // rien de vivant et rien à effacer : pas d'upload GPU
    if (this.alive === 0 && this.clean) return;
    let alive = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) this.alpha[i] = 0;
        continue;
      }
      alive++;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const d = Math.exp(-this.drag[i] * dt);
      const j = i * 3;
      this.vel[j] *= d;
      this.vel[j + 1] = this.vel[j + 1] * d + this.grav[i] * dt;
      this.vel[j + 2] *= d;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      this.alpha[i] = k < 0.8 ? k / 0.8 : (1 - k) / 0.2;
    }
    this.clean = alive === 0 && this.alive === 0;
    this.alive = alive;
    this.burst.visible = alive > 0;
    const a = this.geo.attributes;
    a.position.needsUpdate = true;
    a.aAlpha.needsUpdate = true;
    if (this.fresh) {
      a.color.needsUpdate = true;
      a.aSize.needsUpdate = true;
      this.fresh = false;
    }
  }
}

import * as THREE from 'three';
import { globalUniforms } from './materials.js';

// Disque d'accrétion qui tourbillonne loin sous l'île : il donne une
// profondeur et un « sol » cosmique au vide. Trou noir au centre,
// anneau de photons, bras spiraux de poussière.

export function createVortex() {
  const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: globalUniforms.uTime, uIntensity: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uIntensity;
      varying vec2 vUv;

      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * n2(p); p = p * 2.02 + 7.3; a *= 0.5; } return v * 1.07; }

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        if (r > 1.0) discard;
        float a = atan(p.y, p.x);

        // coordonnées spiralées : la rotation est plus rapide près du centre
        float swirl = a + 2.6 * log(r + 0.02) - uTime * 0.06 / (r + 0.25);
        vec2 q = vec2(cos(swirl), sin(swirl)) * (1.5 + r * 3.0);
        float dust = fbm(q * 1.4 + vec2(0.0, uTime * 0.02));
        float arms = pow(0.5 + 0.5 * sin(swirl * 2.0 + dust * 3.0), 2.0);

        float disk = smoothstep(1.0, 0.35, r) * smoothstep(0.07, 0.2, r);
        vec3 inner = vec3(1.0, 0.72, 0.5);
        vec3 mid = vec3(0.62, 0.25, 0.95);
        vec3 outer = vec3(0.1, 0.32, 0.55);
        vec3 col = mix(inner, mid, smoothstep(0.12, 0.4, r));
        col = mix(col, outer, smoothstep(0.45, 0.95, r));

        float body = disk * (0.25 + dust * 0.9) * (0.45 + arms * 0.8);
        float pr = (r - 0.11) * 38.0;
        float photon = exp(-pr * pr) * 1.6;
        float hole = smoothstep(0.06, 0.1, r);

        vec3 c = col * body * 0.26 + vec3(1.0, 0.85, 0.7) * photon;
        c *= hole;
        c *= uIntensity;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(80);
  mesh.position.y = -18;
  mesh.renderOrder = -5;
  mesh.frustumCulled = false;
  return mesh;
}

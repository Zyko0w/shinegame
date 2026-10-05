import * as THREE from 'three';
import { globalUniforms } from './materials.js';

// Disque d'accrétion qui tourbillonne loin sous l'île : il donne une
// profondeur et un « sol » cosmique au vide. Trou noir au centre,
// anneau de photons, bras spiraux de poussière.
//
// Optimisation : le motif (fbm 4 octaves) est précalculé une fois dans une
// texture polaire (angle spiralé × rayon). À l'exécution, la rotation
// différentielle n'est qu'un décalage de coordonnée : une seule lecture.

const NOISE = /* glsl */ `
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * n2(p); p = p * 2.02 + 7.3; a *= 0.5; } return v * 1.07; }
`;

function bakePattern(renderer) {
  const target = new THREE.WebGLRenderTarget(1024, 256, { type: THREE.UnsignedByteType });
  target.texture.wrapS = THREE.RepeatWrapping;
  const mat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      ${NOISE}
      void main() {
        float swirl = vUv.x * 6.28318530718;  // angle spiralé
        float r = vUv.y;
        vec2 q = vec2(cos(swirl), sin(swirl)) * (1.5 + r * 3.0);
        float dust = fbm(q * 1.4);
        float arms = pow(0.5 + 0.5 * sin(swirl * 2.0 + dust * 3.0), 2.0);
        gl_FragColor = vec4(dust, arms, 0.0, 1.0);
      }
    `,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  quad.geometry.dispose();
  mat.dispose();
  return target.texture;
}

export function createVortex(renderer) {
  const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: globalUniforms.uTime,
      uIntensity: { value: 1 },
      uPattern: { value: bakePattern(renderer) },
      uInner: { value: new THREE.Color(1.0, 0.72, 0.5) },
      uMid: { value: new THREE.Color(0.62, 0.25, 0.95) },
      uOuter: { value: new THREE.Color(0.1, 0.32, 0.55) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uIntensity;
      uniform sampler2D uPattern;
      uniform vec3 uInner;
      uniform vec3 uMid;
      uniform vec3 uOuter;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        if (r > 1.0) discard;
        float a = atan(p.y, p.x);
        // rotation plus rapide près du centre
        float swirl = a + 2.6 * log(r + 0.02) - uTime * 0.06 / (r + 0.25);
        vec2 pat = texture2D(uPattern, vec2(swirl * 0.15915494, r)).rg;

        float disk = smoothstep(1.0, 0.35, r) * smoothstep(0.07, 0.2, r);
        vec3 col = mix(uInner, uMid, smoothstep(0.12, 0.4, r));
        col = mix(col, uOuter, smoothstep(0.45, 0.95, r));

        float body = disk * (0.25 + pat.r * 0.9) * (0.45 + pat.g * 0.8);
        float pr = (r - 0.11) * 38.0;
        float photon = exp(-pr * pr) * 1.6;
        vec3 c = (col * body * 0.26 + vec3(1.0, 0.85, 0.7) * photon) * smoothstep(0.06, 0.1, r) * uIntensity;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(80);
  mesh.position.y = -18;
  mesh.renderOrder = -5;
  mesh.frustumCulled = false;
  // teinte du tourbillon selon l'émotion : [[intérieur], [milieu], [extérieur]]
  mesh.setMood = (cols) => {
    mat.uniforms.uInner.value.setRGB(...cols[0]);
    mat.uniforms.uMid.value.setRGB(...cols[1]);
    mat.uniforms.uOuter.value.setRGB(...cols[2]);
  };
  return mesh;
}

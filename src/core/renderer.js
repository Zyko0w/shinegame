import * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  ShaderPass,
  BloomEffect,
  GodRaysEffect,
  SMAAEffect,
  SMAAPreset,
  FXAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  Effect,
  EffectAttribute,
  KernelSize,
  BlendFunction,
} from 'postprocessing';

// Pipeline (pmndrs/postprocessing, effets fusionnés en un minimum de passes) :
//   RenderPass → N8AO (occlusion ambiante) → assainissement HDR
//   → [SMAA + god rays + bloom + tone mapping] → [tilt-shift + aberration + grain]

/* ───────────── Passe d'assainissement ───────────── */

// Un seul pixel NaN/Inf dans le buffer HDR suffit à noircir tout l'écran
// une fois étalé par le bloom. Test sur les bits de l'exposant, car
// isnan() est éliminé par certains compilateurs (ANGLE/D3D).
function createSanitizeMaterial() {
  return new THREE.ShaderMaterial({
    name: 'SanitizeMaterial',
    uniforms: { inputBuffer: { value: null } },
    depthWrite: false,
    depthTest: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = position.xy * 0.5 + 0.5;
        gl_Position = vec4(position.xy, 1.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D inputBuffer;
      varying vec2 vUv;
      bool bad(float x) { return (floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u; }
      void main() {
        vec4 c = texture2D(inputBuffer, vUv);
        if (bad(c.r) || bad(c.g) || bad(c.b)) c = vec4(0.0, 0.0, 0.0, 1.0);
        gl_FragColor = vec4(min(c.rgb, vec3(48.0)), c.a);
      }
    `,
  });
}

/* ───────────── Étalonnage final (effet custom) ───────────── */

// Tilt-shift « miniature », aberration chromatique sur les bords, vignette,
// teinte violette dans les noirs, grain. Travaille en espace linéaire.
const GRADE_FRAG = /* glsl */ `
  uniform float uTilt;
  uniform float uFocus;
  uniform float uCA;

  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 cc = uv - 0.5;
    vec2 ca = cc * dot(cc, cc) * 0.016 * uCA;
    vec3 col = vec3(texture2D(inputBuffer, uv + ca).r, inputColor.g, texture2D(inputBuffer, uv - ca).b);

    float band = abs(uv.y - uFocus) * 2.0;
    float radius = smoothstep(0.32, 1.0, band) * uTilt;
    if (radius > 0.35) {
      vec3 acc = col;
      for (int i = 0; i < 10; i++) {
        float fi = float(i);
        float r = sqrt((fi + 0.5) / 10.0) * radius;
        float a = fi * 2.39996323;
        acc += textureLod(inputBuffer, uv + vec2(cos(a), sin(a)) * r * texelSize, 0.0).rgb;
      }
      col = acc / 11.0;
    }

    vec2 vc = cc;
    vc.x *= aspect * 0.72;
    float vig = smoothstep(0.92, 0.22, length(vc));
    col *= mix(1.0, vig, 0.62);
    col += vec3(0.0035, 0.0012, 0.0085) * (1.0 - col);
    col += (hash12(uv * resolution + fract(time * 7.0) * 113.0) - 0.5) * 0.012;
    outputColor = vec4(max(col, 0.0), inputColor.a);
  }
`;

class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', GRADE_FRAG, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([
        ['uTilt', new THREE.Uniform(5)],
        ['uFocus', new THREE.Uniform(0.5)],
        ['uCA', new THREE.Uniform(1)],
      ]),
    });
  }
}

/* ───────────── Création ───────────── */

export function createRenderer(canvas, scene, camera) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // l'AA est fait par SMAA en post
    stencil: false,
    depth: false, // le composer gère son propre depth buffer
    powerPreference: 'high-performance',
  });
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.NoToneMapping; // tone mapping fait en post
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false; // mis à jour seulement quand quelque chose bouge
  renderer.shadowMap.needsUpdate = true;

  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
  composer.addPass(new RenderPass(scene, camera));

  // Occlusion ambiante écran (N8AO) : chargée à la demande, seulement si un
  // palier l'active — les machines modestes ne téléchargent jamais ce module.
  let ao = null;
  let aoLoading = null;
  function ensureAO() {
    if (ao || aoLoading) return aoLoading;
    aoLoading = import('n8ao').then(({ N8AOPostPass }) => {
      ao = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight);
      Object.assign(ao.configuration, {
        aoRadius: 0.9,
        distanceFalloff: 0.8,
        intensity: 3.2,
        color: new THREE.Color(0x0b0620),
        halfRes: true,
        gammaCorrection: false,
      });
      ao.setQualityMode(state.aoMode);
      composer.addPass(ao, 1);
      ao.enabled = state.aoOn;
      lastSize = '';
      applySize();
      return ao;
    });
    return aoLoading;
  }

  // Passe d'assainissement HDR (anti NaN/Inf) : désactivée par défaut, la cause
  // (division par la profondeur dans les shaders de points) est corrigée à la source.
  // ?safe dans l'URL la réactive en cas de doute.
  const sanitize = new ShaderPass(createSanitizeMaterial(), 'inputBuffer');
  sanitize.enabled = new URLSearchParams(location.search).has('safe');
  composer.addPass(sanitize);

  // Source des god rays : petit soleil placé dans l'étoile du niveau
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 24, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.82, 0.5), transparent: true, depthWrite: false }),
  );
  sun.frustumCulled = false;
  scene.add(sun);

  // Anticrénelage : FXAA (1 passe) sur les paliers modestes, SMAA (3 passes,
  // plus net) sur les paliers hauts. Changer d'AA reconstruit la passe principale.
  const smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
  const fxaa = new FXAAEffect();
  const godRays = new GodRaysEffect(camera, sun, {
    height: 360,
    kernelSize: KernelSize.SMALL,
    density: 0.94,
    decay: 0.93,
    weight: 0.42,
    exposure: 0.62,
    samples: 48,
    clampMax: 1.0,
    blur: true,
  });
  const bloom = new BloomEffect({
    mipmapBlur: true,
    luminanceThreshold: 0.72,
    luminanceSmoothing: 0.25,
    intensity: 1.35,
    radius: 0.72,
    levels: 6,
    resolutionScale: 0.5, // le flou de bloom n'a pas besoin de la pleine résolution
  });
  const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  // SMAA vit dans la passe principale ; FXAA a sa propre passe (après tone
  // mapping, en LDR) : fusionné avec les god rays, il produisait une tache sombre.
  let mainPass = new EffectPass(camera, godRays, bloom, toneMapping);
  let aaMode = 'fxaa';
  composer.addPass(mainPass);
  const fxaaPass = new EffectPass(camera, fxaa);
  composer.addPass(fxaaPass);

  function setAA(mode) {
    fxaaPass.enabled = mode === 'fxaa';
    const wantSmaa = mode === 'smaa';
    if (wantSmaa === (aaMode === 'smaa')) {
      aaMode = mode;
      return;
    }
    aaMode = mode;
    const index = composer.passes.indexOf(mainPass);
    composer.removePass(mainPass);
    mainPass.fullscreenMaterial?.dispose();
    mainPass = wantSmaa ? new EffectPass(camera, smaa, godRays, bloom, toneMapping) : new EffectPass(camera, godRays, bloom, toneMapping);
    composer.addPass(mainPass, index);
  }

  const grade = new GradeEffect();
  composer.addPass(new EffectPass(camera, grade));

  const state = { pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5), tilt: true, aoMode: 'Performance', aoOn: false, godRaysOn: true, samples: 48, bloomLevels: 6 };
  let lastSize = '';

  // Ne réalloue les buffers que si la taille ou la densité change vraiment
  function applySize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    grade.uniforms.get('uTilt').value = state.tilt ? (w < 720 ? 3 : 5) * state.pixelRatio : 0;
    const key = `x@`;
    if (key === lastSize) return;
    lastSize = key;
    renderer.setPixelRatio(state.pixelRatio);
    renderer.setSize(w, h, false);
    composer.setSize(w, h, false);
  }
  applySize();

  return {
    renderer,
    composer,
    sun,
    effects: { smaa, fxaa, godRays, bloom, grade, get ao() { return ao; } },
    resize: applySize,
    // Chaque réglage n'est appliqué que s'il change : certains recompilent des
    // shaders (AO, nombre d'échantillons des god rays) ou réallouent des buffers.
    setQuality({ pixelRatio, tilt, aberration, ao: aoOn, aoMode, godRays: samples, godRaysOn, bloomLevels, aa }) {
      setAA(aa);
      state.pixelRatio = pixelRatio;
      state.tilt = tilt;
      applySize();
      grade.uniforms.get('uCA').value = aberration ? 1 : 0;
      state.aoOn = aoOn;
      if (aoOn) ensureAO();
      if (ao) {
        ao.enabled = aoOn;
        if (aoOn && state.aoMode !== aoMode) ao.setQualityMode(aoMode);
      }
      state.aoMode = aoMode;
      if (state.samples !== samples) godRays.godRaysMaterial.samples = state.samples = samples;
      const fn = godRaysOn ? BlendFunction.SCREEN : BlendFunction.SKIP;
      if (godRays.blendMode.blendFunction !== fn) godRays.blendMode.blendFunction = fn;
      state.godRaysOn = godRaysOn;
      if (state.bloomLevels !== bloomLevels) bloom.mipmapBlurPass.levels = state.bloomLevels = bloomLevels;
    },
    // Préchauffe les shaders en DESSINANT une image avec les objets encore
    // cachés (dalles de pont, particules…) et la shadow map : sous ANGLE/D3D,
    // une simple compilation ne suffit pas, la finalisation se fait au premier
    // dessin (≈ 200 ms de gel en plein jeu). À appeler écran masqué (fondu).
    warmup(extra = []) {
      const prev = extra.map((o) => o.visible);
      extra.forEach((o) => (o.visible = true));
      // sans culling : tout doit être dessiné, quel que soit le cadrage courant
      const culled = [];
      scene.traverse((o) => {
        if (o.frustumCulled) {
          o.frustumCulled = false;
          culled.push(o);
        }
      });
      renderer.shadowMap.needsUpdate = true;
      composer.render(0);
      culled.forEach((o) => (o.frustumCulled = true));
      extra.forEach((o, i) => (o.visible = prev[i]));
      renderer.shadowMap.needsUpdate = true;
    },
    get godRaysOn() {
      return state.godRaysOn !== false;
    },
    get pixelRatio() {
      return state.pixelRatio;
    },
  };
}

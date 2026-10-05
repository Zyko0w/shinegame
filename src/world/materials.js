import * as THREE from 'three';
import { getNoiseTexture } from './noiseTexture.js';

// Patchs de shaders sur MeshStandardMaterial (onBeforeCompile) : on garde
// l'éclairage PBR et les ombres de three, et on y greffe nos effets.

export const globalUniforms = {
  uTime: { value: 0 },
  uPixelRatio: { value: 1 },
  uBakedAO: { value: 1 }, // atténuée quand l'AO écran (N8AO) est active
  uUnderGlow: { value: new THREE.Color(0.38, 0.16, 0.85) }, // lueur sous l'île (selon l'émotion)
};

const COMMON_GLSL = /* glsl */ `
  uniform float uTime;
  uniform vec3 uUnderGlow;
  varying vec3 vWPos;
  varying vec3 vOPos;
  varying vec3 vWNorm;

  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  vec3 hue(float t) { return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }

  // bruit précalculé (voir noiseTexture.js) + projection planaire selon la face
  uniform sampler2D uNoise;
  vec4 noiseAt(vec2 uv) { return texture2D(uNoise, uv); }
  vec2 faceUV() {
    vec3 n = abs(vWNorm);
    if (n.y > 0.6) return vWPos.xz;
    return n.x > n.z ? vec2(vWPos.z, vWPos.y) : vec2(vWPos.x, vWPos.y);
  }
`;

const VERTEX_DECL = /* glsl */ `
  #include <common>
  varying vec3 vWPos;
  varying vec3 vOPos;
  varying vec3 vWNorm;
`;

const VERTEX_BODY = /* glsl */ `
  #include <project_vertex>
  {
    vec4 wp = vec4(transformed, 1.0);
    vec3 wn = objectNormal;
    #ifdef USE_INSTANCING
      wp = instanceMatrix * wp;
      wn = mat3(instanceMatrix) * wn;
    #endif
    wp = modelMatrix * wp;
    vWPos = wp.xyz;
    vOPos = transformed;
    vWNorm = normalize(mat3(modelMatrix) * wn);
  }
`;

// Brouillard de profondeur : tout ce qui plonge sous l'île se fond dans le vide.
const VOID_FOG = /* glsl */ `
  {
    float vf = smoothstep(0.2, -4.5, vWPos.y);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.025, 0.014, 0.06), vf * 0.85);
  }
  #include <dithering_fragment>
`;

// Occlusion voxel précalculée (attributs aOccTop / aOccSide posés par Level)
const AO_VERTEX_DECL = /* glsl */ `
  attribute vec4 aOccTop;
  attribute vec4 aOccSide;
  varying vec4 vOccTop;
  varying vec4 vOccSide;
`;
const AO_VERTEX_BODY = /* glsl */ `
  vOccTop = aOccTop;
  vOccSide = aOccSide;
`;
const AO_FRAGMENT = /* glsl */ `
  {
    // dessus : bords assombris côté voisins plus hauts (coins cumulés)
    float isTopF = step(0.6, vWNorm.y);
    vec4 edge = vec4(0.48 - vOPos.x, vOPos.x + 0.48, 0.48 - vOPos.z, vOPos.z + 0.48);
    vec4 near = 1.0 - smoothstep(0.0, 0.34, edge);
    float topOcc = clamp(dot(vOccTop, near * near), 0.0, 1.0);
    // flancs : ligne de contact avec le sol voisin
    vec4 faceMask = vec4(step(0.6, vWNorm.x), step(0.6, -vWNorm.x), step(0.6, vWNorm.z), step(0.6, -vWNorm.z));
    float contact = dot(vOccSide, faceMask) * (1.0 - smoothstep(0.0, 0.22, vOPos.y + 0.24));
    float occ = isTopF * topOcc * 0.5 + (1.0 - isTopF) * contact * 0.55;
    diffuseColor.rgb *= 1.0 - occ * uBakedAO;
  }
`;

const noiseUniform = { value: null };

function patch(material, { color = '', emissive = '', key, bakedAO = false }) {
  noiseUniform.value ??= getNoiseTexture();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.uniforms.uBakedAO = globalUniforms.uBakedAO;
    shader.uniforms.uUnderGlow = globalUniforms.uUnderGlow;
    shader.uniforms.uNoise = noiseUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', VERTEX_DECL + (bakedAO ? AO_VERTEX_DECL : ''))
      .replace('#include <project_vertex>', VERTEX_BODY + (bakedAO ? AO_VERTEX_BODY : ''));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON_GLSL}${bakedAO ? 'uniform float uBakedAO;\nvarying vec4 vOccTop;\nvarying vec4 vOccSide;' : ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${color}\n${bakedAO ? AO_FRAGMENT : ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${emissive}`)
      .replace('#include <dithering_fragment>', VOID_FOG);
  };
  material.customProgramCacheKey = () => key;
  return material;
}

/* ───────────── Blocs ───────────── */

// Bloc sommital : surface praticable — texture de pierre lunaire, arêtes
// adoucies plus claires, poussière d'étoiles incrustée qui scintille.
export function patchTopBlock(material) {
  return patch(material, {
    key: 'shine-top',
    bakedAO: true,
    color: /* glsl */ `
      {
        float isTop = step(0.6, vWNorm.y);
        float stone = noiseAt(faceUV() * 0.4).r;
        diffuseColor.rgb *= 0.82 + stone * 0.36;
        float edgeD = max(abs(vOPos.x), abs(vOPos.z));
        diffuseColor.rgb += isTop * smoothstep(0.36, 0.47, edgeD) * 0.05;
        // flancs du bloc sommital : plus sombres vers le bas
        diffuseColor.rgb *= mix(0.62 + 0.38 * smoothstep(-0.24, 0.24, vOPos.y), 1.0, isTop);
      }
    `,
    emissive: /* glsl */ `
      {
        float isTop = step(0.6, vWNorm.y);
        vec2 g = vWPos.xz * 11.0;
        vec2 cell = floor(g);
        float r = h21(cell);
        vec2 f = fract(g) - 0.5 - (vec2(h21(cell + 7.1), h21(cell + 3.7)) - 0.5) * 0.6;
        float speck = smoothstep(0.09, 0.0, length(f)) * step(0.93, r);
        float tw = 0.4 + 0.6 * sin(uTime * (1.5 + r * 3.0) + r * 40.0);
        vec3 sc = mix(vec3(0.45, 0.95, 1.0), vec3(0.75, 0.6, 1.0), h21(cell + 1.3));
        totalEmissiveRadiance += isTop * speck * tw * sc * 1.6;
        // rim violet (contre-jour)
        vec3 V = normalize(vViewPosition);
        float fres = pow(1.0 - abs(dot(normal, V)), 3.0);
        totalEmissiveRadiance += vec3(0.32, 0.18, 0.7) * fres * 0.18;
      }
    `,
  });
}

// Blocs de flanc : roche sombre veinée de filons lumineux qui pulsent
// lentement vers le haut.
export function patchSideBlock(material) {
  return patch(material, {
    key: 'shine-side',
    bakedAO: true,
    color: /* glsl */ `
      {
        vec2 fu = faceUV();
        float strata = noiseAt(vec2(fu.x * 0.25, fu.y * 0.875)).g;
        diffuseColor.rgb *= 0.78 + strata * 0.4;
        diffuseColor.rgb *= 0.72 + 0.28 * smoothstep(-0.2, 3.5, vWPos.y);
      }
    `,
    emissive: /* glsl */ `
      {
        float side = 1.0 - step(0.6, abs(vWNorm.y));
        vec2 fu = faceUV();
        vec4 vn = noiseAt(fu * 0.2 + vec2(0.0, 0.5));
        float n = vn.a;
        float vein = vn.b * smoothstep(0.5, 0.68, noiseAt(fu * 0.0875 + 0.37).r);
        float pulse = pow(0.5 + 0.5 * sin(vWPos.y * 2.2 - uTime * 1.1 + n * 9.0), 3.0);
        vec3 vc = mix(vec3(0.35, 0.85, 1.0), vec3(0.6, 0.35, 1.0), smoothstep(0.3, 0.7, noiseAt(fu * 0.05).r));
        totalEmissiveRadiance += side * vein * (0.05 + pulse * 0.55) * vc;
        vec3 V = normalize(vViewPosition);
        float fres = pow(1.0 - abs(dot(normal, V)), 3.0);
        totalEmissiveRadiance += vec3(0.3, 0.15, 0.65) * fres * 0.12;
      }
    `,
  });
}

// Dessous de l'île : roche qui s'illumine vers la pointe (énergie du vide).
export function patchUnderside(material) {
  return patch(material, {
    key: 'shine-under',
    color: /* glsl */ `
      diffuseColor.rgb *= 0.7 + noiseAt(vec2((vWPos.x + vWPos.z) * 0.375, vWPos.y * 0.15)).g * 0.6;
    `,
    emissive: /* glsl */ `
      {
        float tip = smoothstep(-0.25, -1.0, vOPos.y);
        float streak = noiseAt(vec2((vWPos.x + vWPos.z) * 0.75, vWPos.y * 0.19 - uTime * 0.04)).r;
        totalEmissiveRadiance += uUnderGlow * tip * (0.15 + streak * 0.45);
      }
    `,
  });
}

/* ───────────── Cristaux & étoile ───────────── */

// Irisation en fonction de l'angle de vue (façon film mince).
export function patchIridescent(material, strength = 1.2) {
  return patch(material, {
    key: 'shine-irid',
    emissive: /* glsl */ `
      {
        vec3 V = normalize(vViewPosition);
        float fres = pow(1.0 - abs(dot(normal, V)), 2.0);
        vec3 irid = hue(fres * 0.9 + vWPos.y * 0.6 + uTime * 0.15);
        totalEmissiveRadiance += irid * fres * ${strength.toFixed(2)};
      }
    `,
  });
}

// Étoile : reflets dorés qui balayent la surface.
export function patchStar(material) {
  return patch(material, {
    key: 'shine-star',
    emissive: /* glsl */ `
      {
        float sweep = pow(0.5 + 0.5 * sin((vOPos.x + vOPos.y) * 9.0 - uTime * 4.0), 8.0);
        vec3 V = normalize(vViewPosition);
        float fres = pow(1.0 - abs(dot(normal, V)), 2.0);
        totalEmissiveRadiance += vec3(1.0, 0.85, 0.55) * (sweep * 1.6 + fres * 1.2);
      }
    `,
  });
}

/* ───────────── Hologramme (pont fantôme) ───────────── */

export function createHologramMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: globalUniforms.uTime, uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vWPos;
      varying vec3 vOPos;
      varying vec3 vN;
      void main() {
        vOPos = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vWPos;
      varying vec3 vOPos;
      varying vec3 vN;
      void main() {
        float scan = smoothstep(0.35, 0.5, abs(fract(vWPos.y * 22.0 - uTime * 1.5) - 0.5));
        float sweep = smoothstep(0.92, 1.0, sin(vWPos.y * 2.0 - uTime * 2.5 + vWPos.x));
        vec3 a = abs(vOPos) / vec3(0.48, 0.24, 0.48);
        float edgeMask = max(max(min(a.x, a.y), min(a.y, a.z)), min(a.x, a.z));
        float edge = smoothstep(0.86, 0.98, edgeMask);
        float fres = pow(1.0 - abs(vN.z), 2.0);
        float flicker = 0.85 + 0.15 * sin(uTime * 23.0 + vWPos.x * 3.0);
        float alpha = (0.05 + scan * 0.08 + fres * 0.15 + sweep * 0.3 + edge * 0.9) * flicker * uOpacity;
        gl_FragColor = vec4(uColor * 1.6 * alpha, alpha);
      }
    `,
  });
}

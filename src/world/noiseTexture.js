import * as THREE from 'three';

// Texture de bruit précalculée (une fois, au démarrage) qui remplace les fbm
// 3D évalués à chaque pixel dans les shaders des blocs : une lecture de
// texture coûte bien moins que 3 octaves × 8 hachages.
//   R : pierre (fbm fin)       G : strates (fbm)
//   B : filons (masque de ligne fine, déjà lissé)   A : champ des filons (phase)
// La texture est périodique (tuilable) : PERIOD cellules de bruit par côté.

export const NOISE_PERIOD = 8;

function hash(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x, y, period, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let fx = x - xi;
  let fy = y - yi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % period) + period) % period;
  const y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(u, v, octaves, seed) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(u * NOISE_PERIOD * freq, v * NOISE_PERIOD * freq, NOISE_PERIOD * freq, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

let texture = null;

export function getNoiseTexture(size = 256) {
  if (texture) return texture;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = (y * size + x) * 4;
      const stone = fbm(u, v, 4, 11);
      const strata = fbm(u, v, 3, 29);
      const field = fbm(u, v, 3, 47);
      const line = 1 - Math.min(1, Math.abs(field - 0.5) / 0.022); // ligne fine autour de l'isovaleur 0.5
      data[i] = stone * 255;
      data[i + 1] = strata * 255;
      data[i + 2] = Math.max(0, line) ** 1.5 * 255;
      data[i + 3] = field * 255;
    }
  }
  texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

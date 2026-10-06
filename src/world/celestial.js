import * as THREE from 'three';
import { getHaloTexture } from './props.js';

// Vues des longues-vues (points panoramiques) : une constellation qui se
// dessine étoile par étoile, une planète qui tourne, une galaxie spirale.
// L'objet est construit à la demande, placé loin dans le ciel face à la
// caméra, puis détruit après l'observation (aucun coût le reste du temps).
// Le plan local XY fait face à l'observateur.

// Constellations : étoiles [x, y, éclat 0-1, couleur, nom?] et tracés [i, j]
const CONSTELLATIONS = {
  orion: {
    stars: [
      [-0.62, 0.78, 1, 0xff9a5a, 'Bételgeuse'],
      [0.52, 0.7, 0.7, 0xcfe0ff, 'Bellatrix'],
      [-0.05, 1.08, 0.4, 0xdfe8ff],
      [-0.17, 0.02, 0.7, 0xcfe0ff, 'Alnitak'],
      [0.0, 0.08, 0.75, 0xcfe0ff, 'Alnilam'],
      [0.16, 0.15, 0.65, 0xcfe0ff, 'Mintaka'],
      [-0.45, -0.82, 0.6, 0xcfe0ff, 'Saïph'],
      [0.6, -0.72, 1, 0x9fc4ff, 'Rigel'],
    ],
    lines: [[0, 2], [2, 1], [0, 3], [1, 5], [3, 4], [4, 5], [3, 6], [5, 7]],
  },
  lyre: {
    stars: [
      [0.0, 0.85, 1, 0xdfeaff, 'Véga'],
      [-0.32, 0.98, 0.35, 0xe8eeff],
      [0.18, 0.45, 0.4, 0xe8eeff],
      [-0.18, 0.3, 0.45, 0xe8eeff],
      [0.32, -0.45, 0.55, 0xd8e4ff, 'Sulafat'],
      [-0.05, -0.6, 0.55, 0xd8e4ff, 'Shéliak'],
    ],
    lines: [[0, 1], [0, 2], [2, 3], [0, 3], [2, 4], [3, 5], [4, 5]],
  },
  ourse: {
    stars: [
      [0.95, 0.42, 0.9, 0xffd9a0, 'Dubhe'],
      [0.88, -0.12, 0.75, 0xe8eeff, 'Merak'],
      [0.3, -0.28, 0.6, 0xe8eeff],
      [0.22, 0.18, 0.45, 0xe8eeff],
      [-0.25, 0.3, 0.8, 0xe8eeff],
      [-0.62, 0.36, 0.75, 0xe8eeff, 'Mizar'],
      [-0.56, 0.5, 0.3, 0xe8eeff, 'Alcor'],
      [-1.0, 0.1, 0.8, 0xcfe0ff],
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 7]],
  },
  scorpion: {
    stars: [
      [0.75, 0.85, 0.5, 0xcfe0ff],
      [0.62, 0.55, 0.6, 0xcfe0ff],
      [0.68, 0.22, 0.45, 0xcfe0ff],
      [0.25, 0.42, 0.45, 0xffd0b0],
      [0.0, 0.25, 1, 0xff5a3a, 'Antarès'],
      [-0.2, 0.02, 0.45, 0xffd0b0],
      [-0.3, -0.35, 0.5, 0xcfe0ff],
      [-0.2, -0.7, 0.5, 0xcfe0ff],
      [-0.5, -0.88, 0.45, 0xcfe0ff],
      [-0.82, -0.72, 0.6, 0xcfe0ff, 'Shaula'],
    ],
    lines: [[0, 1], [1, 2], [1, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9]],
  },
};

const SPAN = 4.6; // demi-largeur d'une constellation (unités monde)

function label(text, color = '#ffe7bd') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = 'italic 34px Fraunces, Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.8)';
  g.shadowBlur = 8;
  g.fillStyle = color;
  g.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
  s.scale.set(2.4, 0.6, 1);
  return s;
}

function constellation(data) {
  const g = new THREE.Group();
  const halo = getHaloTexture();
  const stars = data.stars.map(([x, y, m, color, name]) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, color: new THREE.Color(color).multiplyScalar(1.6 + m * 1.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    s.position.set(x * SPAN, y * SPAN, 0);
    s.userData.size = 0.5 + m * 1.1;
    s.scale.setScalar(0.01);
    g.add(s);
    let tag = null;
    if (name) {
      tag = label(name);
      tag.position.set(x * SPAN, y * SPAN - 0.65, 0);
      g.add(tag);
    }
    return { s, tag };
  });
  // tracé : un segment par paire, révélé progressivement
  const pos = new Float32Array(data.lines.length * 6);
  data.lines.forEach(([a, b], i) => {
    pos.set([data.stars[a][0] * SPAN, data.stars[a][1] * SPAN, 0, data.stars[b][0] * SPAN, data.stars[b][1] * SPAN, 0], i * 6);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setDrawRange(0, 0);
  const lineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(1.4, 1.2, 0.8), transparent: true, opacity: 0.7, depthWrite: false });
  const lines = new THREE.LineSegments(geo, lineMat);
  g.add(lines);
  const n = data.lines.length;
  return {
    group: g,
    reveal(k, t) {
      stars.forEach(({ s, tag }, i) => {
        const a = THREE.MathUtils.clamp(k * 2.2 - i * 0.12, 0, 1);
        s.material.opacity = a;
        s.scale.setScalar(Math.max(0.01, s.userData.size * a * (1 + Math.sin(t * 3 + i * 1.7) * 0.06)));
        if (tag) tag.material.opacity = THREE.MathUtils.clamp(k * 2 - 1.1, 0, 1);
      });
      geo.setDrawRange(0, Math.floor(THREE.MathUtils.clamp(k * 1.6 - 0.4, 0, 1) * n + 0.0001) * 2);
    },
    dispose() {
      geo.dispose();
      lineMat.dispose();
      g.traverse((o) => {
        if (o.isSprite) {
          o.material.map !== halo && o.material.map?.dispose();
          o.material.dispose();
        }
      });
    },
  };
}

// Planète à bandes (Jupiter / Saturne), éclairée en dur par le shader
function planet({ colors, ring = false, spot = false, radius = 2.2 }) {
  const g = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uT: { value: 0 },
      uA: { value: new THREE.Color(colors[0]) },
      uB: { value: new THREE.Color(colors[1]) },
      uC: { value: new THREE.Color(colors[2]) },
      uSpot: { value: spot ? 1 : 0 },
      uFade: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vP;
      void main() { vN = normalize(normalMatrix * normal); vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uT;
      uniform vec3 uA;
      uniform vec3 uB;
      uniform vec3 uC;
      uniform float uSpot;
      uniform float uFade;
      varying vec3 vN;
      varying vec3 vP;
      void main() {
        vec3 p = normalize(vP);
        float lon = atan(p.z, p.x) + uT * 0.25;
        float lat = p.y;
        float bands = sin(lat * 18.0 + sin(lon * 3.0 + lat * 6.0) * 0.35) * 0.5 + 0.5;
        float fine = sin(lat * 47.0 + sin(lon * 5.0) * 0.6) * 0.5 + 0.5;
        vec3 col = mix(uA, uB, bands);
        col = mix(col, uC, fine * 0.25);
        // grande tache
        vec2 sp = vec2(mod(lon, 6.2831) - 2.2, lat + 0.32);
        col = mix(col, vec3(0.75, 0.32, 0.2), uSpot * smoothstep(0.16, 0.08, length(sp * vec2(0.55, 1.4))));
        float light = max(dot(vN, normalize(vec3(-0.6, 0.35, 0.75))), 0.0);
        float rim = pow(1.0 - max(dot(vN, vec3(0.0, 0.0, 1.0)), 0.0), 3.0);
        col = col * (0.08 + light * 1.1) + vec3(0.4, 0.55, 1.0) * rim * 0.25;
        gl_FragColor = vec4(col * uFade, 1.0);
      }
    `,
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), mat);
  sphere.rotation.z = 0.15;
  g.add(sphere);
  let ringMat = null;
  let ringMesh = null;
  if (ring) {
    ringMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uFade: { value: 0 }, uIn: { value: radius * 1.25 }, uOut: { value: radius * 2.3 } },
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float uFade;
        uniform float uIn;
        uniform float uOut;
        varying vec2 vP;
        void main() {
          float r = (length(vP) - uIn) / (uOut - uIn);
          float bands = 0.55 + 0.45 * sin(r * 60.0) * sin(r * 23.0 + 1.0);
          float gap = smoothstep(0.55, 0.57, r) * (1.0 - smoothstep(0.6, 0.62, r));
          float a = smoothstep(0.0, 0.04, r) * (1.0 - smoothstep(0.94, 1.0, r)) * bands * (1.0 - gap * 0.9) * 0.85;
          gl_FragColor = vec4(vec3(0.95, 0.85, 0.65) * a * uFade, a * uFade);
        }
      `,
    });
    ringMesh = new THREE.Mesh(new THREE.RingGeometry(radius * 1.25, radius * 2.3, 96, 1), ringMat);
    ringMesh.rotation.set(-1.25, 0.25, 0);
    g.add(ringMesh);
  }
  return {
    group: g,
    reveal(k, t) {
      mat.uniforms.uT.value = t;
      mat.uniforms.uFade.value = k;
      if (ringMat) ringMat.uniforms.uFade.value = k;
      g.scale.setScalar(0.6 + 0.4 * k);
    },
    dispose() {
      sphere.geometry.dispose();
      mat.dispose();
      ringMesh?.geometry.dispose();
      ringMat?.dispose();
    },
  };
}

// Galaxie spirale (Andromède) : nuage de points en bras, qui tourne lentement
function galaxy() {
  const n = 2600;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const arm = i % 2;
    const r = Math.pow(Math.random(), 0.6) * 4.2;
    const a = r * 1.25 + arm * Math.PI + (Math.random() - 0.5) * (0.9 - r * 0.1);
    pos[i * 3] = Math.cos(a) * r + (Math.random() - 0.5) * 0.3;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 0.25 * (1.2 - r / 4.2);
    pos[i * 3 + 2] = Math.sin(a) * r + (Math.random() - 0.5) * 0.3;
    c.setHSL(r < 1 ? 0.1 : 0.6 + Math.random() * 0.1, 0.6, r < 1 ? 0.75 : 0.55 + Math.random() * 0.2);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 0.09, vertexColors: true, map: getHaloTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const pts = new THREE.Points(geo, mat);
  const tilt = new THREE.Group();
  tilt.rotation.set(1.1, 0, 0.5);
  tilt.add(pts);
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: getHaloTexture(), color: new THREE.Color(2.2, 1.7, 1.1), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  core.scale.setScalar(2.4);
  const g = new THREE.Group();
  g.add(tilt, core);
  return {
    group: g,
    reveal(k, t) {
      mat.opacity = k;
      core.material.opacity = k * 0.9;
      pts.rotation.y = t * 0.05;
      g.scale.setScalar(0.5 + 0.5 * k);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      core.material.dispose();
    },
  };
}

// Étoile géante (Bételgeuse) : disque bouillonnant rouge-orangé
function giant() {
  const v = planet({ colors: [0xff5a1a, 0xffa040, 0xffd080], radius: 2.0 });
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: getHaloTexture(), color: new THREE.Color(2.4, 0.9, 0.3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  glow.scale.setScalar(9);
  v.group.add(glow);
  const reveal = v.reveal;
  const dispose = v.dispose;
  v.reveal = (k, t) => {
    reveal(k, t * 0.4);
    glow.material.opacity = k * (0.55 + Math.sin(t * 1.3) * 0.08);
  };
  v.dispose = () => {
    dispose();
    glow.material.dispose();
  };
  return v;
}

export function createSkyView(kind) {
  if (CONSTELLATIONS[kind]) return constellation(CONSTELLATIONS[kind]);
  switch (kind) {
    case 'saturne':
      return planet({ colors: [0xd8b878, 0xf0dcae, 0xa88850], ring: true, radius: 1.7 });
    case 'jupiter':
      return planet({ colors: [0xc89a6a, 0xf2e2c8, 0x8a5a3a], spot: true });
    case 'andromede':
      return galaxy();
    case 'betelgeuse':
      return giant();
    default:
      return constellation(CONSTELLATIONS.orion);
  }
}

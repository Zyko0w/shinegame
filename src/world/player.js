import * as THREE from 'three';
import { makeHalo } from './props.js';
import { globalUniforms } from './materials.js';
import { damp } from '../core/tween.js';

// Lumi, feu follet cosmonaute.
// - Corps : grande flamme qui s'effile vers le bas et se prolonge en traînée
//   (chaîne de Verlet). Deux petites mains de flamme montées sur ressorts.
// - Tête : boule lumineuse avec une mèche de flamme et deux yeux, seule
//   partie enfermée dans la bulle du casque (col métallique au cou, antenne).
// - Physique : le corps suit une « carotte » (position logique sur le chemin)
//   via un ressort amorti → inertie, léger dépassement, rebonds ; casque,
//   antenne et mains oscillent sous l'effet de l'accélération.
// L'API (walk, place, onArrive…) est celle attendue par main.js.

const SEG_TIME = 0.27;
const SCALE = 1.4; // taille globale du personnage
const BOB = 0.16; // hauteur de lévitation (pointe du corps au-dessus du sol)
const BODY_Y = 0.47; // centre du corps
const HEAD_Y = 0.8; // centre de la tête
const WISP = new THREE.Color(0.12, 1.0, 0.72); // aqua
const WISP_DEEP = new THREE.Color(0.52, 0.36, 1.0); // violet (bout de flamme)

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/* ───────────── Matériaux ───────────── */

// Flamme : sphère déformée. uTipDir = 1 → pointe vers le haut (mèche),
// -1 → pointe vers le bas (corps qui s'effile en queue).
export function flameMaterial({ tipDir = 1, stretch = 0.6, intensity = 1, core, edge, tipColor }) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: globalUniforms.uTime,
      uLean: { value: new THREE.Vector3() },
      uStretch: { value: stretch },
      uTipDir: { value: tipDir },
      uIntensity: { value: intensity },
      uCore: { value: core.clone() },
      uEdge: { value: edge.clone() },
      uTipColor: { value: tipColor.clone() },
      uSeed: { value: Math.random() * 10 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uLean;
      uniform float uStretch;
      uniform float uTipDir;
      uniform float uSeed;
      varying vec3 vN;
      varying vec3 vView;
      varying float vT;
      void main() {
        vec3 p = position;
        float along = max(p.y * uTipDir, 0.0);
        p.y += uTipDir * along * along * uStretch;   // pointe de flamme
        p.xz += uLean.xz * along * along * 1.6;      // se couche selon le mouvement
        float t = uTime + uSeed;
        float n = sin(p.y * 6.0 - uTime * 9.0 * uTipDir + p.x * 4.0 + uSeed) * 0.5
                + sin(p.y * 10.0 - t * 13.0 * uTipDir + p.z * 5.0) * 0.5;
        p += normal * n * 0.08 * (0.2 + along);       // vacillement
        vT = along / (1.0 + uStretch);                // 0 = base, ~1 = pointe
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uCore;
      uniform vec3 uEdge;
      uniform vec3 uTipColor;
      uniform float uIntensity;
      varying vec3 vN;
      varying vec3 vView;
      varying float vT;
      void main() {
        float f = abs(dot(normalize(vN), normalize(vView)));
        vec3 edge = mix(uEdge, uTipColor, smoothstep(0.15, 0.85, vT) + (1.0 - f) * 0.35);
        vec3 col = mix(edge, uCore, pow(f, 4.0) * (1.0 - vT * 0.8));
        float a = smoothstep(0.0, 0.7, f) * (1.0 - smoothstep(0.55, 1.05, vT));
        gl_FragColor = vec4(col * uIntensity * a, a);
      }
    `,
  });
}

function glassMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTint: { value: new THREE.Color(0.62, 0.86, 1.0) } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vec3 n = normalize(vN);
        float fres = pow(1.0 - abs(dot(n, normalize(vView))), 3.0);
        float spot = smoothstep(0.93, 0.985, dot(n, normalize(vec3(-0.45, 0.62, 0.65))));
        float band = smoothstep(0.035, 0.0, abs(dot(n, normalize(vec3(0.7, 0.35, 0.6))) - 0.42)) * step(0.0, n.y + 0.2);
        vec3 col = uTint * (0.12 + fres * 0.9) + vec3(1.0) * (spot * 1.4 + band * 0.5);
        float a = 0.04 + fres * 0.5 + spot * 0.85 + band * 0.35;
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
      }
    `,
  });
}

function pointsMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: { uPixelRatio: globalUniforms.uPixelRatio },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aAlpha;
      uniform float uPixelRatio;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = color;
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(aSize * uPixelRatio * (16.0 / max(-mv.z, 0.5)), 110.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        a *= a * vAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vColor * a, 1.0);
      }
    `,
  });
}

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.75)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.3)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/* ───────────── Systèmes de points (traînée, braises) ───────────── */

class PointPool {
  constructor(count) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = geo;
    this.points = new THREE.Points(geo, pointsMaterial());
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  upload() {
    const a = this.geo.attributes;
    a.position.needsUpdate = a.color.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = true;
  }
}

/* ───────────── Joueur ───────────── */

export class Player {
  constructor() {
    this.root = new THREE.Group(); // position physique (niveau du sol + arc de saut)
    this.float = new THREE.Group(); // lévitation, inclinaisons, squash & stretch
    this.root.add(this.float);
    this.fx = new THREE.Group(); // effets en espace monde (ajouté à la scène par main.js)

    const white = new THREE.Color(0.55, 1.0, 0.86);

    // Corps : flamme pointe en bas
    this.bodyMat = flameMaterial({ tipDir: -1, stretch: 1.35, intensity: 0.62, core: white, edge: WISP, tipColor: WISP_DEEP });
    this.body = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), this.bodyMat);
    this.body.scale.set(0.135, 0.125, 0.125);
    this.body.position.y = BODY_Y;
    this.body.renderOrder = 4;
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.026, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 1.4, 1.2) }));
    this.core.position.y = BODY_Y + 0.02;
    this.halo = makeHalo(WISP, 1.9, 0.26);
    this.halo.position.y = BODY_Y;

    // Mains de flamme (ressorts)
    this.hands = [-1, 1].map((side) => {
      const mat = flameMaterial({ tipDir: -1, stretch: 1.2, intensity: 0.55, core: white, edge: WISP, tipColor: WISP_DEEP });
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mat);
      m.scale.setScalar(0.036);
      m.renderOrder = 4;
      const rest = new THREE.Vector3(side * 0.19, BODY_Y + 0.03, 0.03);
      m.position.copy(rest);
      return { mesh: m, mat, rest, side, off: new THREE.Vector3(), vel: new THREE.Vector3() };
    });

    // Tête
    this.head = new THREE.Group();
    this.head.position.y = HEAD_Y;
    this.headMat = flameMaterial({ tipDir: 1, stretch: 0.75, intensity: 1.0, core: white, edge: WISP, tipColor: new THREE.Color(0.7, 1.0, 0.95) });
    const headFlame = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 24), this.headMat);
    headFlame.scale.setScalar(0.12);
    headFlame.renderOrder = 4;
    const headCore = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 1.1, 1.0) }));
    headCore.position.z = -0.01;
    this.headCore = headCore;

    // Yeux (rendus après les flammes additives, pour rester sombres)
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x06121a, transparent: true });
    const eyeGeo = new THREE.SphereGeometry(0.02, 14, 10);
    this.eyes = [-1, 1].map((side) => {
      const e = new THREE.Mesh(eyeGeo, eyeMat);
      e.scale.set(0.8, 1.3, 0.5);
      e.position.set(side * 0.042, 0.005, 0.105);
      e.renderOrder = 7;
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
      // coordonnées dans le repère de l'œil (sphère de rayon 0.02) : reflet
      // posé sur la surface, en haut à droite de la pupille
      s.position.set(0.006, 0.008, 0.017);
      s.renderOrder = 8;
      e.add(s);
      return e;
    });
    this.face = new THREE.Group();
    this.face.add(...this.eyes);

    // Casque autour de la tête uniquement
    this.helmet = new THREE.Group();
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.185, 40, 28), glassMaterial());
    glass.renderOrder = 9;
    const metal = new THREE.MeshStandardMaterial({ color: 0xb4afcd, roughness: 0.4, metalness: 0.8 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x7d74c0, roughness: 0.4, metalness: 0.6 });
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.028, 14, 40), metal);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = -0.15;
    const collar2 = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.013, 10, 36), accent);
    collar2.rotation.x = Math.PI / 2;
    collar2.position.y = -0.178;
    const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.9, 0.4) });
    this.leds = [];
    for (let i = 0; i < 3; i++) {
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), ledMat.clone());
      const a = -0.55 + i * 0.55;
      led.position.set(Math.sin(a) * 0.148, -0.15, Math.cos(a) * 0.148);
      this.leds.push(led);
      this.helmet.add(led);
    }
    this.antenna = new THREE.Group();
    this.antenna.position.set(0.08, 0.15, -0.05);
    this.antenna.rotation.z = -0.35;
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.008, 0.15, 6).translate(0, 0.075, 0), metal);
    this.antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.019, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.8, 1.4) }));
    this.antennaTip.position.y = 0.16;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.024, 0.018, 12), accent);
    this.antenna.add(stalk, this.antennaTip, base);
    this.helmet.add(glass, collar, collar2, this.antenna);

    this.head.add(headFlame, headCore, this.face, this.helmet);

    this.light = new THREE.PointLight(WISP, 2.2, 4.5, 1.8);
    this.light.position.y = BODY_Y + 0.1;

    this.float.add(this.body, this.core, this.halo, this.head, this.light, ...this.hands.map((h) => h.mesh));
    this.float.scale.setScalar(SCALE);

    // Ombre portée douce (le corps est une source de lumière : pas d'ombre réelle)
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 1.0).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.8 }),
    );
    this.shadow.renderOrder = 2;
    this.fx.add(this.shadow);

    // Traînée : chaîne de Verlet qui prolonge la pointe du corps
    this.tailN = 14;
    this.tail = new PointPool(this.tailN);
    this.tailPos = Array.from({ length: this.tailN }, () => new THREE.Vector3());
    this.tailPrev = Array.from({ length: this.tailN }, () => new THREE.Vector3());
    for (let i = 0; i < this.tailN; i++) {
      const k = i / (this.tailN - 1);
      const c = WISP.clone().lerp(WISP_DEEP, Math.min(1, k * 1.3)).multiplyScalar(1.3 - k * 0.6);
      this.tail.col.set([c.r, c.g, c.b], i * 3);
      this.tail.size[i] = 10 * (1 - k * 0.85);
      this.tail.alpha[i] = 0.5 * (1 - k * 0.92);
    }
    this.fx.add(this.tail.points);

    // Braises qui s'élèvent
    this.emberN = 56;
    this.embers = new PointPool(this.emberN);
    this.emberVel = new Float32Array(this.emberN * 3);
    this.emberLife = new Float32Array(this.emberN);
    this.emberMax = new Float32Array(this.emberN).fill(1);
    this.emberCursor = 0;
    this.emberAcc = 0;
    this.fx.add(this.embers.points);

    // État logique (déplacement case à case)
    this.tile = null;
    this.queue = [];
    this.moving = false;
    this.from = new THREE.Vector3();
    this.to = new THREE.Vector3();
    this.segT = 0;
    this.segDur = SEG_TIME;
    this.hop = 0.08;
    this.goal = new THREE.Vector3();
    this.groundY = 0;

    // État physique
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.prevVel = new THREE.Vector3();
    this.acc = new THREE.Vector3();
    this.wobble = new THREE.Vector2();
    this.wobbleVel = new THREE.Vector2();
    this.yaw = 0;
    this.targetYaw = 0;
    this.land = 0;
    this.bumpT = 0;
    this.celebrateT = -1;
    this.blinkT = 2;
    this.lookT = 3;
    this.look = 0;
    this.lookTarget = 0;
    this.waveT = 4;
    this.locked = false; // trajet en plateforme, retournement… : pas de contrôle
    this.presence = 1; // 0 = dissous (portail), 1 = visible
    this.presenceTarget = 1;
    this.onArrive = null;
    this.onStep = null;
    // posture de cinématique : Lumi se penche vers un point (longue-vue,
    // cloche, fontaine) — décalage du corps + inclinaison vers l'avant
    this.leanOff = new THREE.Vector3();
    this.leanTarget = new THREE.Vector3();
    this.tilt = 0;
    this.tiltTarget = 0;
    this.springGoal = new THREE.Vector3();
  }

  // Penche Lumi vers `point` (monde) : `reach` = fraction de la distance,
  // `lift` = hauteur ajoutée, `tilt` = inclinaison avant (rad)
  lean(point, { reach = 0.4, lift = 0, tilt = 0.3, max = 0.55 } = {}) {
    this.leanTarget.set(point.x - this.goal.x, 0, point.z - this.goal.z).multiplyScalar(reach);
    if (this.leanTarget.length() > max) this.leanTarget.setLength(max);
    this.leanTarget.y = lift;
    this.tiltTarget = tilt;
    this.targetYaw = Math.atan2(point.x - this.goal.x, point.z - this.goal.z);
  }

  unlean() {
    this.leanTarget.set(0, 0, 0);
    this.tiltTarget = 0;
  }

  place(level, tile) {
    this.level = level;
    this.tile = tile;
    this.queue.length = 0;
    this.moving = false;
    this.celebrateT = -1;
    this.locked = false;
    this.leanOff.set(0, 0, 0);
    this.leanTarget.set(0, 0, 0);
    this.tilt = this.tiltTarget = 0;
    this.presence = this.presenceTarget = 1;
    level.worldOf(tile, this.goal);
    this.groundY = this.goal.y;
    this.pos.copy(this.goal);
    this.vel.set(0, 0, 0);
    this.prevVel.set(0, 0, 0);
    this.wobble.set(0, 0);
    this.wobbleVel.set(0, 0);
    for (const h of this.hands) {
      h.off.set(0, 0, 0);
      h.vel.set(0, 0, 0);
    }
    this.root.position.copy(this.pos);
    this.yaw = this.targetYaw = Math.PI * 0.25;
    this.root.rotation.y = this.yaw;
    this.float.rotation.set(0, 0, 0);
    this.float.scale.setScalar(SCALE);
    this.root.updateMatrixWorld(true);
    this.resetTail();
    this.emberLife.fill(0);
  }

  resetTail() {
    this.anchor(tmpV);
    for (let i = 0; i < this.tailN; i++) {
      this.tailPos[i].copy(tmpV).y -= i * 0.02;
      this.tailPrev[i].copy(this.tailPos[i]);
    }
  }

  // Point d'attache de la traînée : pointe basse du corps, en espace monde
  anchor(out) {
    return out.set(0, BODY_Y - 0.24, -0.02).applyMatrix4(this.float.matrixWorld);
  }

  get nextTile() {
    return this.moving ? this.target : this.tile;
  }

  walk(path) {
    if (this.celebrateT >= 0 || this.locked) return;
    this.queue = path.slice();
    if (!this.moving) this.nextSegment();
  }

  stop() {
    this.queue.length = 0;
  }

  nextSegment() {
    const next = this.queue.shift();
    // case disparue depuis le calcul du chemin (dalle effondrée, porte refermée…) :
    // Lumi s'arrête au bord au lieu de marcher dans le vide (le vent, lui, verrouille Lumi)
    const gone = next && !this.locked && this.level && !this.level.isWalkable(next);
    if (!next || gone) {
      this.queue.length = 0;
      this.moving = false;
      return;
    }
    this.level.worldOf(this.tile, this.from);
    this.level.worldOf(next, this.to);
    const dh = next.h - this.tile.h;
    this.segDur = SEG_TIME + Math.abs(dh) * 0.08;
    this.hop = dh > 0 ? 0.36 : dh < 0 ? 0.2 : 0.06;
    this.segT = 0;
    this.target = next;
    this.moving = true;
    this.jumping = false;
    this.targetYaw = Math.atan2(this.to.x - this.from.x, this.to.z - this.from.z);
    this.onSegment?.(dh);
  }

  // Saut de tremplin : trajectoire balistique jusqu'à une case lointaine
  jump(dest) {
    this.queue.length = 0;
    this.level.worldOf(this.tile, this.from);
    this.level.worldOf(dest, this.to);
    const dist = Math.hypot(this.to.x - this.from.x, this.to.z - this.from.z);
    this.segDur = 0.75 + dist * 0.09;
    this.hop = 1.1 + dist * 0.28 + Math.max(0, this.to.y - this.from.y) * 0.6;
    this.segT = 0;
    this.target = dest;
    this.moving = true;
    this.jumping = true;
    this.targetYaw = Math.atan2(this.to.x - this.from.x, this.to.z - this.from.z);
  }

  bump(dx, dz) {
    this.targetYaw = Math.atan2(dx, dz);
    this.bumpT = 0.3;
    // élan vers le mur : le ressort ramène, casque et mains encaissent le choc
    this.vel.x += dx * 2.6;
    this.vel.z += dz * 2.6;
    this.wobbleVel.x -= 9;
    for (const h of this.hands) h.vel.z -= 2.5;
  }

  celebrate() {
    this.queue.length = 0;
    this.celebrateT = 0;
  }

  // Entraîné par une plateforme : on décale corps, carotte et sol d'un bloc
  carry(delta) {
    this.pos.add(delta);
    this.goal.add(delta);
    this.from.add(delta);
    this.to.add(delta);
    this.groundY += delta.y;
    for (const p of this.tailPos) p.add(delta);
    for (const p of this.tailPrev) p.add(delta);
  }

  // Change la case logique sans bouger (arrivée d'une plateforme)
  setTile(tile) {
    this.tile = tile;
    this.level.worldOf(tile, this.goal);
    this.groundY = this.goal.y;
  }

  // Chute depuis le haut (arrivée dans la grotte) : le ressort ramène au sol
  drop(height) {
    this.pos.y += height;
    this.root.position.copy(this.pos);
    this.root.updateMatrixWorld(true);
    this.resetTail();
  }

  // Dissolution / réapparition (portail de retournement)
  vanish() {
    this.presenceTarget = 0;
  }

  appear(instant = false) {
    this.presenceTarget = 1;
    if (instant) this.presence = 1;
    else this.presence = 0;
  }

  /* ───────────── Mise à jour ───────────── */

  update(dt, t) {
    if (dt <= 0) {
      this.root.updateMatrixWorld();
      return;
    }

    // 1) Carotte logique le long du chemin (détermine les arrivées sur les cases)
    if (this.moving) {
      this.segT += dt / this.segDur;
      const k = Math.min(1, this.segT);
      // pas : départ/arrivée adoucis ; saut : vitesse horizontale constante
      const e = this.jumping ? k : k * k * (3 - 2 * k);
      this.goal.lerpVectors(this.from, this.to, e);
      this.groundY = this.goal.y;
      this.goal.y += Math.sin(k * Math.PI) * this.hop;
      this.jumpK = this.jumping ? k : 0;
      if (k >= 1) {
        this.tile = this.target;
        this.landedFromJump = this.jumping;
        this.land = this.jumping ? 1.4 : this.hop > 0.1 ? 1 : 0.35;
        // une erreur dans un rappel ne doit pas bloquer Lumi sur cette case
        // (sinon onStep/onArrive se rejouent à chaque frame)
        try {
          this.onStep?.(this.tile);
          this.onArrive?.(this.tile);
        } catch (err) {
          console.error(err);
        }
        this.nextSegment();
      }
    }

    // 2) Ressort amorti (sous-pas pour la stabilité)
    const steps = 2;
    const h = dt / steps;
    const k = 150;
    const c = 2 * Math.sqrt(k) * 0.72;
    this.leanOff.lerp(this.leanTarget, 1 - Math.exp(-5 * dt));
    this.tilt = damp(this.tilt, this.tiltTarget, 5, dt);
    const goal = this.springGoal.copy(this.goal).add(this.leanOff);
    for (let i = 0; i < steps; i++) {
      tmpV.subVectors(goal, this.pos).multiplyScalar(k).addScaledVector(this.vel, -c);
      this.vel.addScaledVector(tmpV, h);
      this.pos.addScaledVector(this.vel, h);
    }
    this.acc.subVectors(this.vel, this.prevVel).divideScalar(dt);
    this.prevVel.copy(this.vel);
    this.root.position.copy(this.pos);

    // 3) Orientation
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 0.6 && this.celebrateT < 0 && !this.tiltTarget) this.targetYaw = Math.atan2(this.vel.x, this.vel.z);
    this.yaw += angleDelta(this.yaw, this.targetYaw) * (1 - Math.exp(-10 * dt));
    this.root.rotation.y = this.yaw;
    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    const vFwd = this.vel.x * sin + this.vel.z * cos;
    const vSide = this.vel.x * cos - this.vel.z * sin;
    const aFwd = this.acc.x * sin + this.acc.z * cos;
    const aSide = this.acc.x * cos - this.acc.z * sin;

    // 4) Lévitation, inclinaison, squash & stretch
    this.land = damp(this.land, 0, 8, dt);
    let floatY = BOB + Math.sin(t * 2.3) * 0.04 + Math.sin(t * 3.7) * 0.01;
    let spin = 0;
    if (this.celebrateT >= 0) {
      this.celebrateT += dt;
      const ct = this.celebrateT;
      floatY += ct < 1.1 ? Math.sin((ct / 1.1) * Math.PI) * 0.7 : 0;
      spin = ct < 1.1 ? (ct / 1.1) * Math.PI * 4 : 0;
      if (ct > 1.1 && ct < 1.2) this.land = 1;
    }
    if (this.talking) floatY += Math.abs(Math.sin(t * 9)) * 0.035;
    this.float.position.y = floatY - this.land * 0.05;
    this.float.rotation.x = THREE.MathUtils.clamp(vFwd * 0.08, -0.35, 0.35) + this.tilt;
    this.float.rotation.z = THREE.MathUtils.clamp(-vSide * 0.08, -0.35, 0.35);
    if (this.jumpK) spin += Math.sin(this.jumpK * Math.PI) * 0.4 + this.jumpK * Math.PI * 2; // vrille en vol
    this.float.rotation.y = spin;
    const stretch = THREE.MathUtils.clamp(this.vel.y * 0.06, -0.15, 0.2) - this.land * 0.14;
    this.presence = damp(this.presence, this.presenceTarget, this.presenceTarget ? 7 : 10, dt);
    const pres = this.presenceTarget ? 1 - Math.pow(1 - this.presence, 2) * (1 + Math.sin(this.presence * 9) * 0.2) : this.presence;
    const S = SCALE * Math.max(0.001, pres);
    this.float.scale.set(S * (1 - stretch * 0.5), S * (1 + stretch), S * (1 - stretch * 0.5));
    this.fx.visible = this.presence > 0.05;

    // 5) Flammes : le corps s'étire et se couche derrière le mouvement
    const flicker = 0.9 + Math.sin(t * 14) * 0.04 + Math.sin(t * 23.7) * 0.03 + Math.sin(t * 5.1) * 0.05;
    const party = this.celebrateT >= 0 ? 0.5 : 0;
    const bu = this.bodyMat.uniforms;
    bu.uLean.value.set(
      THREE.MathUtils.clamp(-vSide * 0.06, -0.35, 0.35) + Math.sin(t * 1.7) * 0.04,
      0,
      THREE.MathUtils.clamp(-vFwd * 0.06, -0.35, 0.35) + Math.cos(t * 1.3) * 0.04,
    );
    bu.uStretch.value = damp(bu.uStretch.value, 1.35 + Math.min(speed, 4) * 0.25 + Math.max(0, this.vel.y) * 0.2, 7, dt);
    bu.uIntensity.value = 0.62 * flicker + party * 0.6;
    const hu = this.headMat.uniforms;
    hu.uLean.value.set(THREE.MathUtils.clamp(-vSide * 0.05, -0.25, 0.25), 0, THREE.MathUtils.clamp(-vFwd * 0.05, -0.25, 0.25));
    hu.uStretch.value = damp(hu.uStretch.value, 0.75 + Math.min(speed, 4) * 0.08 + party, 8, dt);
    hu.uIntensity.value = 0.8 * flicker + party * 0.6;
    this.light.intensity = 2.2 * flicker;
    this.halo.material.opacity = 0.26 * flicker;
    this.core.scale.setScalar(0.95 + Math.sin(t * 6) * 0.08);

    // 6) Casque & antenne : ressorts angulaires excités par l'accélération
    this.wobbleVel.x += (-70 * this.wobble.x - 6 * this.wobbleVel.x - aFwd * 0.05) * dt;
    this.wobbleVel.y += (-70 * this.wobble.y - 6 * this.wobbleVel.y + aSide * 0.05) * dt;
    this.wobble.x = THREE.MathUtils.clamp(this.wobble.x + this.wobbleVel.x * dt, -0.5, 0.5);
    this.wobble.y = THREE.MathUtils.clamp(this.wobble.y + this.wobbleVel.y * dt, -0.5, 0.5);
    this.head.rotation.x = this.wobble.x * 0.5;
    this.head.rotation.z = this.wobble.y * 0.5;
    this.head.position.y = HEAD_Y + Math.sin(t * 2.3 - 0.6) * 0.012; // légère respiration décalée
    this.antenna.rotation.x = this.wobble.x * 2.2 + Math.sin(t * 2.1) * 0.05;
    this.antenna.rotation.z = -0.35 + this.wobble.y * 2.2 + Math.sin(t * 1.7) * 0.05;
    const blink = Math.sin(t * 3.2) > 0.85 ? 1 : 0.25;
    this.antennaTip.material.color.setRGB(2.6 * blink, 0.8 * blink, 1.4 * blink);
    this.leds.forEach((l, i) => l.material.color.setRGB(2.2 * (Math.sin(t * 4 + i * 2.1) > 0 ? 1 : 0.4), 0.9, 0.4));

    // 7) Mains : ressorts 3D (traînent derrière, rebondissent, saluent au repos)
    this.waveT -= dt;
    const waving = speed < 0.3 && this.celebrateT < 0 && this.waveT < 0.9 && this.waveT > 0;
    if (this.waveT < 0) this.waveT = 5 + Math.random() * 5;
    for (const hd of this.hands) {
      // force : rappel + inertie (accélération locale opposée) + petite houle
      tmpV.set(-aSide * 0.004, -this.acc.y * 0.003, -aFwd * 0.006);
      hd.vel.addScaledVector(hd.off, -90 * dt).addScaledVector(hd.vel, -7 * dt).addScaledVector(tmpV, 60 * dt);
      hd.off.addScaledVector(hd.vel, dt);
      hd.off.clampLength(0, 0.16);
      let wx = 0;
      let wy = Math.sin(t * 2.6 + hd.side) * 0.02;
      if (waving && hd.side > 0) {
        wy += 0.16;
        wx += Math.sin(t * 14) * 0.05;
      }
      if (this.celebrateT >= 0 && this.celebrateT < 1.4) wy += 0.2;
      hd.mesh.position.set(hd.rest.x + hd.off.x + wx, hd.rest.y + hd.off.y + wy, hd.rest.z + hd.off.z);
      const hu2 = hd.mat.uniforms;
      hu2.uLean.value.set(-hd.off.x * 2, 0, -hd.off.z * 2 + vFwd * 0.05);
      hu2.uIntensity.value = 0.55 * flicker + party * 0.6;
    }

    // 8) Visage : clignements, regard qui suit le mouvement ou balaye l'horizon
    this.blinkT -= dt;
    if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 3.5;
    const eyeY = this.blinkT < 0.12 ? 0.15 : 1;
    this.lookT -= dt;
    if (this.lookT < 0) {
      this.lookT = 1.5 + Math.random() * 3;
      this.lookTarget = speed > 0.5 ? 0 : (Math.random() - 0.5) * 0.05;
    }
    this.look = damp(this.look, this.lookTarget + THREE.MathUtils.clamp(vSide * 0.008, -0.025, 0.025), 6, dt);
    this.face.position.x = this.look;
    this.face.position.y = THREE.MathUtils.clamp(-this.vel.y * 0.005, -0.015, 0.015);
    for (const e of this.eyes) e.scale.y = 1.3 * eyeY * (this.celebrateT >= 0 ? 0.45 : 1);

    this.root.updateMatrixWorld();

    // 9) Traînée : Verlet + pose de repos (part vers l'arrière, remonte en volute)
    this.anchor(this.tailPos[0]);
    const seg = 0.045;
    const damping = Math.exp(-4 * dt);
    const back = tmpV2.set(-sin, 0, -cos);
    const pull = 1 - Math.exp(-3 * dt);
    for (let i = 1; i < this.tailN; i++) {
      const p = this.tailPos[i];
      const q = this.tailPrev[i];
      tmpV.subVectors(p, q).multiplyScalar(damping);
      q.copy(p);
      p.add(tmpV);
      const s = i * seg;
      const rx = this.tailPos[0].x + back.x * s * 0.9;
      const ry = this.tailPos[0].y - s * 0.7 + s * s * 1.5 + Math.sin(t * 3 - i * 0.5) * 0.01 * i;
      const rz = this.tailPos[0].z + back.z * s * 0.9;
      p.x += (rx - p.x) * pull;
      p.y += (ry - p.y) * pull;
      p.z += (rz - p.z) * pull;
    }
    for (let iter = 0; iter < 2; iter++) {
      for (let i = 1; i < this.tailN; i++) {
        const a = this.tailPos[i - 1];
        const b = this.tailPos[i];
        tmpV.subVectors(b, a);
        const d = tmpV.length() || 1e-4;
        b.copy(a).addScaledVector(tmpV, seg / d);
      }
    }
    const tp = this.tail.pos;
    for (let i = 0; i < this.tailN; i++) {
      tp[i * 3] = this.tailPos[i].x;
      tp[i * 3 + 1] = this.tailPos[i].y;
      tp[i * 3 + 2] = this.tailPos[i].z;
    }
    this.tail.upload();

    // 10) Braises
    this.emberAcc += dt * (6 + Math.min(speed, 4) * 6 + (this.celebrateT >= 0 && this.celebrateT < 1.4 ? 45 : 0));
    const bodyPos = this.body.getWorldPosition(tmpV);
    while (this.emberAcc >= 1) {
      this.emberAcc -= 1;
      const i = this.emberCursor;
      this.emberCursor = (this.emberCursor + 1) % this.emberN;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.15;
      this.embers.pos[i * 3] = bodyPos.x + Math.cos(a) * r;
      this.embers.pos[i * 3 + 1] = bodyPos.y + (Math.random() - 0.5) * 0.3;
      this.embers.pos[i * 3 + 2] = bodyPos.z + Math.sin(a) * r;
      this.emberVel[i * 3] = Math.cos(a) * 0.15 - this.vel.x * 0.18;
      this.emberVel[i * 3 + 1] = 0.35 + Math.random() * 0.5;
      this.emberVel[i * 3 + 2] = Math.sin(a) * 0.15 - this.vel.z * 0.18;
      this.emberMax[i] = this.emberLife[i] = 0.7 + Math.random() * 0.9;
      const col = Math.random() < 0.3 ? WISP_DEEP : WISP;
      const w = Math.random() < 0.25 ? 1.8 : 1.3;
      this.embers.col[i * 3] = col.r * w;
      this.embers.col[i * 3 + 1] = col.g * w;
      this.embers.col[i * 3 + 2] = col.b * w;
      this.embers.size[i] = 1.8 + Math.random() * 2.4;
    }
    for (let i = 0; i < this.emberN; i++) {
      if (this.emberLife[i] <= 0) {
        this.embers.alpha[i] = 0;
        continue;
      }
      this.emberLife[i] -= dt;
      const j = i * 3;
      this.emberVel[j] += Math.sin(t * 3 + i) * 0.4 * dt;
      this.embers.pos[j] += this.emberVel[j] * dt;
      this.embers.pos[j + 1] += this.emberVel[j + 1] * dt;
      this.embers.pos[j + 2] += this.emberVel[j + 2] * dt;
      const lk = Math.max(0, this.emberLife[i] / this.emberMax[i]);
      this.embers.alpha[i] = lk < 0.85 ? lk / 0.85 : (1 - lk) / 0.15;
    }
    this.embers.upload();

    // 11) Ombre au sol, plus pâle et plus large quand Lumi s'élève
    const height = this.pos.y + floatY - this.groundY;
    this.shadow.position.set(this.pos.x, this.groundY + 0.012, this.pos.z);
    const sh = THREE.MathUtils.clamp(1.15 - (height - BOB) * 0.8, 0.25, 1.1);
    this.shadow.material.opacity = 0.7 * sh;
    this.shadow.scale.setScalar(1.3 - sh * 0.35);

    if (this.bumpT > 0) this.bumpT -= dt;
  }
}

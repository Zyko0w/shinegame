import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ease, lerp } from './tween.js';

// Caméra du diorama : orbite (OrbitControls), transitions animées,
// décalage de cadrage (écran titre), secousses et orbite manuelle (manette).

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const tmpV = new THREE.Vector3();
const sph = new THREE.Spherical();

export class CameraRig {
  constructor(camera, canvas, tweens) {
    this.camera = camera;
    this.tweens = tweens;
    this.controls = new OrbitControls(camera, canvas);
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.08,
      enablePan: false,
      rotateSpeed: 0.55,
      zoomSpeed: 0.7,
      minPolarAngle: 0.3,
      maxPolarAngle: 1.28,
      enabled: false,
    });
    this.view = { radius: 20, phi: 0.98, theta: Math.PI * 0.25, shift: 0 };
    this.tween = null;
    this.shakeAmount = 0;
    this.shakeOffset = new THREE.Vector3();
    this.interactive = false; // contrôles utilisateur autorisés (état « play »)
  }

  get target() {
    return this.controls.target;
  }

  get busy() {
    return this.tween !== null;
  }

  setInteractive(on) {
    this.interactive = on;
    this.controls.enabled = on && !this.tween;
  }

  // Cadre un niveau : rayon adapté à sa taille et au format d'écran
  fit(level) {
    const aspect = window.innerWidth / window.innerHeight;
    let r = Math.max(Math.hypot(level.W, level.H) * 1.35 + level.maxTop * 0.8 + 2, level.maxTop * 4.2 + 4);
    if (aspect < 1) r /= Math.pow(aspect, 0.75);
    this.view.radius = r;
    this.controls.minDistance = r * 0.45;
    this.controls.maxDistance = r * 1.5;
    return r;
  }

  set(r, phi, theta) {
    tmpV.setFromSphericalCoords(r, phi, theta);
    this.camera.position.copy(this.target).add(tmpV);
    this.camera.lookAt(this.target);
  }

  read() {
    sph.setFromVector3(tmpV.copy(this.camera.position).sub(this.target));
    return { r: sph.radius, phi: sph.phi, theta: sph.theta };
  }

  animateTo({ r, phi, theta, target, duration = 1.2, easing = ease.inOutCubic, onComplete }) {
    if (this.tween) this.tweens.kill(this.tween);
    const from = this.read();
    const fromT = this.target.clone();
    const toT = target ? target.clone() : fromT.clone();
    let dTheta = (theta - from.theta) % (Math.PI * 2);
    if (dTheta > Math.PI) dTheta -= Math.PI * 2;
    if (dTheta < -Math.PI) dTheta += Math.PI * 2;
    this.controls.enabled = false;
    this.tween = this.tweens.add({
      duration,
      ease: easing,
      onUpdate: (k) => {
        this.target.lerpVectors(fromT, toT, k);
        this.set(lerp(from.r, r, k), lerp(from.phi, phi, k), from.theta + dTheta * k);
      },
      onComplete: () => {
        this.tween = null;
        this.controls.enabled = this.interactive;
        onComplete?.();
      },
    });
  }

  // Revient au cadrage par défaut du niveau
  home(level, duration = 0.8, onComplete) {
    const v = this.view;
    this.animateTo({ r: v.radius, phi: v.phi, theta: v.theta, target: level?.focus, duration, onComplete });
  }

  rotateQuarter(dir) {
    if (this.tween) return false;
    const s = this.read();
    this.animateTo({ r: s.r, phi: s.phi, theta: s.theta + (dir * Math.PI) / 2, duration: 0.6, easing: ease.outCubic });
    return true;
  }

  // Orbite continue (stick droit) : dTheta, dPhi en radians, zoom en facteur relatif
  orbitBy(dTheta, dPhi, zoom) {
    if (this.tween) return;
    const c = this.controls;
    const s = this.read();
    const phi = Math.min(c.maxPolarAngle, Math.max(c.minPolarAngle, s.phi + dPhi));
    const r = Math.min(c.maxDistance, Math.max(c.minDistance, s.r * (1 + zoom)));
    this.set(r, phi, s.theta + dTheta);
  }

  /* ───── Décalage de cadrage (le diorama se place à droite du menu) ───── */

  applyShift() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (Math.abs(this.view.shift) < 1e-4) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, -w * this.view.shift, 0, w, h);
  }

  setShift(v) {
    this.view.shift = v;
    this.applyShift();
  }

  animateShift(to, duration = 1.6) {
    const from = this.view.shift;
    this.tweens.add({ duration, ease: ease.inOutCubic, onUpdate: (k) => this.setShift(lerp(from, to, k)) });
  }

  /* ───── Secousse (appliquée autour du rendu, sans perturber les contrôles) ───── */

  shake(amount) {
    if (!reduceMotion) this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  beginShake(dt) {
    this.shakeAmount *= Math.exp(-7 * dt);
    if (this.shakeAmount < 1e-4) {
      this.shakeOffset.set(0, 0, 0);
      return;
    }
    const a = this.shakeAmount;
    this.shakeOffset.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
    this.camera.position.add(this.shakeOffset);
  }

  endShake() {
    this.camera.position.sub(this.shakeOffset);
  }

  update(dt) {
    if (this.controls.enabled && !this.tween) this.controls.update(dt);
  }

  resize(level, rescale = true) {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.applyShift();
    if (!level) return;
    const prev = this.view.radius;
    this.fit(level);
    if (rescale && !this.tween) {
      const s = this.read();
      this.set((s.r * this.view.radius) / prev, s.phi, s.theta);
    }
  }
}

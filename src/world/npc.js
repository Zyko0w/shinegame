import * as THREE from 'three';
import { flameMaterial } from './player.js';
import { makeHalo } from './props.js';
import { damp } from '../core/tween.js';

// Esprits-émotions : petits feux follets colorés que Lumi rencontre.
// Chaque émotion a sa couleur, son expression (sourcils, yeux, bouche)
// et son « langage corporel » (tremblement, affaissement, flamme vive…).
// Quand l'esprit parle : rebond, bouche animée, flamme plus intense.

export const EMOTIONS = {
  wonder: { color: 0xffd98a, deep: 0xff9ec7, brow: 0.0, droop: 0, shake: 0, flicker: 1, scale: 1.25 },
  sad: { color: 0x6aa8ff, deep: 0x3b4cff, brow: -0.35, droop: 0.06, shake: 0, flicker: 0.6, scale: 1.0 },
  lonely: { color: 0x7ff0e0, deep: 0x6d6bff, brow: -0.15, droop: 0.02, shake: 0, flicker: 0.8, scale: 1.05 },
  fear: { color: 0xc59bff, deep: 0x5a2ad0, brow: -0.45, droop: 0, shake: 1, flicker: 1.4, scale: 0.9 },
  bitter: { color: 0xb9d36a, deep: 0x4f7a3a, brow: 0.35, droop: 0.02, shake: 0, flicker: 0.9, scale: 1.05 },
  anger: { color: 0xff6a3d, deep: 0xff1f4a, brow: 0.55, droop: 0, shake: 0.35, flicker: 2.2, scale: 1.15 },
};

function bangTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath();
  g.arc(32, 32, 26, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1a1433';
  g.font = 'bold 40px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('!', 32, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let bangTex = null;

export class Npc {
  constructor(def) {
    this.def = def;
    const emo = EMOTIONS[def.emotion] ?? EMOTIONS.wonder;
    this.emo = emo;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);

    const color = new THREE.Color(emo.color);
    const deep = new THREE.Color(emo.deep);
    const core = color.clone().lerp(new THREE.Color(1, 1, 1), 0.3);

    this.flameMat = flameMaterial({ tipDir: 1, stretch: 0.9, intensity: 0.75, core, edge: color, tipColor: deep });
    const flame = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 22), this.flameMat);
    flame.scale.setScalar(0.17);
    flame.position.y = 0.42;
    flame.renderOrder = 4;
    this.tailMat = flameMaterial({ tipDir: -1, stretch: 1.6, intensity: 0.55, core, edge: color, tipColor: deep });
    const tail = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.tailMat);
    tail.scale.set(0.11, 0.1, 0.11);
    tail.position.y = 0.3;
    tail.renderOrder = 4;
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ color: core.clone().multiplyScalar(1.1) }));
    glow.position.y = 0.42;
    this.halo = makeHalo(color, 1.2, 0.3);
    this.halo.position.y = 0.42;

    // Visage : yeux, sourcils (expression), bouche (parole)
    const dark = new THREE.MeshBasicMaterial({ color: 0x0a0718, transparent: true });
    this.face = new THREE.Group();
    this.face.position.set(0, 0.43, 0.15);
    const eyeGeo = new THREE.SphereGeometry(0.022, 12, 8);
    this.eyes = [-1, 1].map((s) => {
      const e = new THREE.Mesh(eyeGeo, dark);
      e.scale.set(0.8, 1.2, 0.5);
      e.position.set(s * 0.05, 0.01, 0);
      e.renderOrder = 7;
      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
      shine.position.set(0.006, 0.008, 0.017);
      shine.renderOrder = 8;
      e.add(shine);
      return e;
    });
    const browGeo = new THREE.BoxGeometry(0.045, 0.009, 0.01);
    this.brows = [-1, 1].map((s) => {
      const b = new THREE.Mesh(browGeo, dark);
      b.position.set(s * 0.05, 0.045, 0);
      b.rotation.z = s * emo.brow;
      b.renderOrder = 7;
      return b;
    });
    this.mouth = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 6), dark);
    this.mouth.scale.set(1.2, 0.25, 0.4);
    this.mouth.position.set(0, -0.045, 0);
    this.mouth.renderOrder = 7;
    this.face.add(...this.eyes, ...this.brows, this.mouth);

    // Indicateur « ! » (quelque chose à dire)
    bangTex ??= bangTexture();
    this.bang = new THREE.Sprite(new THREE.SpriteMaterial({ map: bangTex, transparent: true, depthWrite: false }));
    this.bang.scale.setScalar(0.22);
    this.bang.position.y = 0.9;
    this.bang.renderOrder = 9;

    this.body.add(tail, flame, glow, this.halo, this.face);
    this.root.add(this.bang);
    this.body.scale.setScalar(emo.scale);

    this.talking = 0; // 0..1 (lissé)
    this.speaking = false;
    this.mouthPhase = 0;
    this.yaw = 0;
    this.targetYaw = 0;
    this.seen = false;
    this.blinkT = 1 + Math.random() * 3;
    this.phase = Math.random() * 10;
  }

  lookAt(x, z) {
    this.targetYaw = Math.atan2(x - this.root.position.x, z - this.root.position.z);
  }

  update(t, dt) {
    const e = this.emo;
    this.talking = damp(this.talking, this.speaking ? 1 : 0, 8, dt);
    // lévitation + langage corporel
    const bob = Math.sin(t * 2 + this.phase) * 0.04 - e.droop;
    const shake = e.shake ? (Math.sin(t * 47) + Math.sin(t * 31)) * 0.006 * e.shake : 0;
    const talkBounce = this.talking * Math.abs(Math.sin(t * 9)) * 0.035;
    this.body.position.set(shake, 0.1 + bob + talkBounce, 0);
    this.body.rotation.x = e.droop * 2 + Math.sin(t * 1.3 + this.phase) * 0.04;

    let d = (this.targetYaw - this.yaw) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * (1 - Math.exp(-6 * dt));
    this.root.rotation.y = this.yaw;

    // flamme : vacillement propre à l'émotion, plus vive quand il parle
    const fl = 0.85 + Math.sin(t * 9 * e.flicker + this.phase) * 0.08 * e.flicker + Math.sin(t * 23) * 0.04;
    this.flameMat.uniforms.uIntensity.value = 0.55 * fl + this.talking * 0.25;
    this.flameMat.uniforms.uStretch.value = 0.9 + this.talking * 0.3 + (e.flicker > 1.5 ? Math.abs(Math.sin(t * 13)) * 0.4 : 0);
    this.tailMat.uniforms.uIntensity.value = 0.42 * fl;
    this.halo.material.opacity = 0.25 + this.talking * 0.2;

    // bouche qui parle, yeux qui clignent
    this.mouthPhase += dt * 14;
    const open = this.talking * (0.4 + 0.6 * Math.abs(Math.sin(this.mouthPhase) * Math.sin(this.mouthPhase * 0.37 + 1)));
    this.mouth.scale.set(1.2 - open * 0.3, 0.25 + open * 1.4, 0.4);
    this.blinkT -= dt;
    if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 3;
    const blink = this.blinkT < 0.12 ? 0.15 : 1;
    for (const eye of this.eyes) eye.scale.y = 1.2 * blink;

    // indicateur « ! »
    this.bang.visible = !this.seen && !this.inTalk;
    if (this.bang.visible) {
      this.bang.position.y = 0.92 + Math.sin(t * 3) * 0.05;
      this.bang.material.opacity = 0.75 + Math.sin(t * 6) * 0.25;
    }
  }

  dispose() {
    this.flameMat.dispose();
    this.tailMat.dispose();
    this.bang.material.dispose();
    this.halo.material.dispose();
  }
}

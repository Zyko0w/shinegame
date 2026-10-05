import * as THREE from 'three';

// Retour visuel de sélection : cadre lumineux sur la case survolée,
// pointillés animés pour prévisualiser le chemin, onde au clic.

const OK = new THREE.Color(0x79f2ff);
const NO = new THREE.Color(0xff5f8f);

function frameMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: OK.clone() }, uTime: { value: 0 }, uOpacity: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uOpacity;
      varying vec2 vUv;
      float sdRoundBox(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - b + r;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }
      void main() {
        vec2 p = vUv - 0.5;
        float d = sdRoundBox(p, vec2(0.43), 0.12);
        float line = smoothstep(0.02, 0.0, abs(d));
        float glow = exp(-abs(d) * 28.0) * 0.55;
        // coins accentués
        vec2 ap = abs(p);
        float corner = step(0.28, ap.x) * step(0.28, ap.y);
        float fill = step(d, 0.0) * (0.07 + 0.04 * sin(uTime * 4.0));
        float a = (line * (0.55 + corner * 0.9) + glow + fill) * uOpacity;
        gl_FragColor = vec4(uColor * 1.6, a);
      }
    `,
  });
}

export class Cursor {
  constructor() {
    this.group = new THREE.Group();
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);

    this.frame = new THREE.Mesh(plane, frameMaterial());
    this.frame.renderOrder = 10;
    this.frame.visible = false;

    this.pulse = new THREE.Mesh(plane, frameMaterial());
    this.pulse.renderOrder = 10;
    this.pulse.visible = false;
    this.pulseT = 1;

    const dotGeo = new THREE.SphereGeometry(0.045, 10, 8);
    const dotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x79f2ff).multiplyScalar(2.2), transparent: true, opacity: 0.9 });
    this.maxDots = 64;
    this.dots = new THREE.InstancedMesh(dotGeo, dotMat, this.maxDots);
    this.dots.count = 0;
    this.dots.frustumCulled = false;
    this.dotPositions = Array.from({ length: this.maxDots }, () => new THREE.Vector3());

    this.group.add(this.frame, this.pulse, this.dots);
    this.opacity = 0;
    this.targetOpacity = 0;
    this.framePos = new THREE.Vector3();
    this.dummy = new THREE.Object3D();
  }

  show(level, tile, reachable) {
    level.worldOf(tile, this.framePos);
    this.framePos.y += 0.012;
    if (!this.frame.visible) this.frame.position.copy(this.framePos);
    this.frame.visible = true;
    this.frame.material.uniforms.uColor.value.copy(reachable ? OK : NO);
    this.targetOpacity = reachable ? 1 : 0.7;
  }

  hide() {
    this.targetOpacity = 0;
    this.dots.count = 0;
  }

  showPath(level, from, path) {
    if (!path || path.length === 0) {
      this.dots.count = 0;
      return;
    }
    // 2 points intermédiaires par segment, pour un pointillé régulier
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    let n = 0;
    let prev = from;
    for (const tile of path) {
      level.worldOf(prev, a);
      level.worldOf(tile, b);
      for (let s = 1; s <= 2 && n < this.maxDots; s++) {
        const k = s / 2;
        this.dotPositions[n].lerpVectors(a, b, k);
        this.dotPositions[n].y += 0.08 + Math.sin(k * Math.PI) * (b.y !== a.y ? 0.18 : 0.02);
        n++;
      }
      prev = tile;
    }
    this.dots.count = n;
  }

  click(level, tile, ok = true) {
    level.worldOf(tile, this.pulse.position);
    this.pulse.position.y += 0.014;
    this.pulse.material.uniforms.uColor.value.copy(ok ? OK : NO);
    this.pulse.visible = true;
    this.pulseT = 0;
  }

  update(t, dt) {
    this.opacity += (this.targetOpacity - this.opacity) * (1 - Math.exp(-16 * dt));
    this.frame.position.lerp(this.framePos, 1 - Math.exp(-28 * dt));
    const u = this.frame.material.uniforms;
    u.uOpacity.value = this.opacity;
    u.uTime.value = t;
    if (this.opacity < 0.01) this.frame.visible = false;
    const s = 1 + Math.sin(t * 5) * 0.025;
    this.frame.scale.set(s, 1, s);

    if (this.pulseT < 1) {
      this.pulseT = Math.min(1, this.pulseT + dt * 2.2);
      const k = this.pulseT;
      this.pulse.scale.set(1 + k * 0.6, 1, 1 + k * 0.6);
      this.pulse.material.uniforms.uOpacity.value = (1 - k) * 1.4;
      if (k >= 1) this.pulse.visible = false;
    }

    for (let i = 0; i < this.dots.count; i++) {
      const p = this.dotPositions[i];
      const wave = 0.6 + 0.4 * Math.sin(t * 8 - i * 0.7);
      this.dummy.position.set(p.x, p.y + wave * 0.03, p.z);
      this.dummy.scale.setScalar(wave);
      this.dummy.updateMatrix();
      this.dots.setMatrixAt(i, this.dummy.matrix);
    }
    if (this.dots.count) this.dots.instanceMatrix.needsUpdate = true;
  }
}

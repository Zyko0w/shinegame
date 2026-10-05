import * as THREE from 'three';

// Éclairage : lune froide (seule source d'ombres) + contre-jour magenta
// + ciel violet. La shadow map n'est recalculée qu'à la demande.

export function createLights(scene, renderer) {
  const hemi = new THREE.HemisphereLight(0x8a7dff, 0x120a24, 0.7);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(0x2a2050, 0.5));

  const key = new THREE.DirectionalLight(0xc8d2ff, 1.9);
  key.position.set(-7, 14, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.025;
  key.shadow.radius = 3;
  scene.add(key, key.target);

  const rim = new THREE.DirectionalLight(0xff7ad9, 0.9);
  rim.position.set(8, 3, -10);
  scene.add(rim);

  return {
    key,
    setMood(palette) {
      hemi.color.setHex(palette.hemi[0]);
      hemi.groundColor.setHex(palette.hemi[1]);
      rim.color.setHex(palette.rim);
    },
    // Cadre la caméra d'ombre sur le niveau (meilleure résolution utile)
    fitShadow(level) {
      const s = level.radius + 3;
      const cam = key.shadow.camera;
      cam.left = cam.bottom = -s;
      cam.right = cam.top = s;
      cam.near = 1;
      cam.far = 40;
      cam.updateProjectionMatrix();
      renderer.shadowMap.needsUpdate = true;
    },
    setShadowSize(size) {
      if (key.shadow.mapSize.x === size) return;
      key.shadow.mapSize.set(size, size);
      key.shadow.map?.dispose();
      key.shadow.map = null;
      renderer.shadowMap.needsUpdate = true;
    },
  };
}

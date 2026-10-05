import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRenderer } from './core/renderer.js';
import { Quality, TIERS } from './core/quality.js';
import { Tweens, ease, lerp } from './core/tween.js';
import { createSky } from './world/sky.js';
import { Level } from './world/level.js';
import { Player } from './world/player.js';
import { Particles } from './world/particles.js';
import { Cursor } from './world/cursor.js';
import { COLORS } from './world/props.js';
import { globalUniforms } from './world/materials.js';
import { createVortex } from './world/vortex.js';
import { LEVELS } from './game/levels.js';
import { findPath } from './game/pathfinding.js';
import { UI } from './ui/ui.js';
import { Sfx } from './audio/sfx.js';
import { SettingsPanel } from './ui/settingsPanel.js';
import { settings, initKeyLabels } from './core/settings.js';
import { progress } from './core/progress.js';
import { GamepadInput, BTN } from './core/gamepad.js';
import { moveFocus, moveFocusSpatial, adjustFocused, activateFocused } from './ui/focusNav.js';

/* ═════════════ Scène ═════════════ */

const canvas = document.getElementById('scene');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 1000);
const gfx = createRenderer(canvas, scene, camera);
const { renderer, composer, sun, effects } = gfx;

const tweens = new Tweens();
const sky = createSky(renderer, scene);
scene.add(sky.group);
scene.add(createVortex());

// Éclairage : lune froide (ombres) + contre-jour magenta + ciel violet
scene.add(new THREE.HemisphereLight(0x8a7dff, 0x120a24, 0.7));
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

const particles = new Particles();

// Qualité (palier adaptatif ou fixe, résolution de rendu, effets)
const perfEl = document.getElementById('perf');
const quality = new Quality((tier) => {
  gfx.setQuality(tier);
  globalUniforms.uPixelRatio.value = tier.pixelRatio;
  // l'occlusion précalculée prend le relais quand l'AO écran est coupée
  globalUniforms.uBakedAO.value = tier.ao ? 0.45 : 1;
  if (key.shadow.mapSize.x !== tier.shadow) {
    key.shadow.mapSize.set(tier.shadow, tier.shadow);
    key.shadow.map?.dispose();
    key.shadow.map = null;
  }
  renderer.shadowMap.needsUpdate = true;
});
renderer.info.autoReset = false;
scene.add(particles.group);
const cursor = new Cursor();
scene.add(cursor.group);
const player = new Player();
scene.add(player.root, player.fx);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.rotateSpeed = 0.55;
controls.zoomSpeed = 0.7;
controls.minPolarAngle = 0.3;
controls.maxPolarAngle = 1.28;
controls.enabled = false;

const sfx = new Sfx();

/* ═════════════ État du jeu ═════════════ */

const game = {
  state: 'boot', // title | intro | play | paused | complete | transition
  index: 0,
  level: null,
  gems: 0,
  steps: 0,
  hintShown: false,
};

const view = { radius: 20, phi: 0.98, theta: Math.PI * 0.25, shift: 0 };
const isWide = () => window.innerWidth > 720;

function toggleSound() {
  sfx.init();
  ui.setSound(sfx.toggleMute());
}

const ui = new UI(
  {
    continueGame() {
      sfx.init();
      playLevel(Math.min(progress.data.last, LEVELS.length - 1));
    },
    newGame() {
      progress.reset();
      sfx.init();
      startGame();
    },
    playLevel: (i) => playLevel(i),
    toggleSound,
    pause: () => setPaused(true),
    resume: () => setPaused(false),
    restart: () => goToLevel(game.index),
    quit: backToTitle,
    next() {
      if (game.index + 1 < LEVELS.length) goToLevel(game.index + 1);
      else backToTitle();
    },
    rotate: rotateCamera,
    recenter: recenterCamera,
    openSettings,
    closeSettings,
    hoverSound: () => sfx.hover(),
    clickSound: () => {
      sfx.init();
      sfx.click();
    },
  },
  LEVELS,
);
ui.setSound(true);

/* ═════════════ Paramètres ═════════════ */

const settingsPanel = new SettingsPanel({
  onTestSound: () => {
    sfx.init();
    sfx.gem(0);
  },
  onHoverSound: () => sfx.hover(),
  getLiveInfo: () =>
    `Actuellement : ${quality.fps.toFixed(0)} i/s · qualité ${TIERS[quality.tier].name}${quality.auto ? ' (auto)' : ''} · rendu ${Math.round(window.innerWidth * gfx.pixelRatio)}×${Math.round(window.innerHeight * gfx.pixelRatio)}`,
});
let settingsWasPaused = false;

function openSettings() {
  if (game.state === 'play') {
    setPaused(true);
    settingsWasPaused = false;
  } else settingsWasPaused = game.state === 'paused';
  ui.showPause(false);
  settingsPanel.open();
}

function closeSettings() {
  settingsPanel.close();
  if (game.state === 'paused') {
    // retour à la pause si on venait d'elle, sinon on reprend directement
    if (settingsWasPaused) ui.showPause(true);
    else setPaused(false);
  } else if (game.state === 'title') ui.selectMenu(ui.menuIndex);
}

settings.onChange((path) => {
  if (path === 'quality') quality.setMode(settings.get('quality'));
  else if (path === 'resolution' || path.startsWith('effects')) quality.refresh();
  else if (path.startsWith('volume')) sfx.applyVolumes();
  else if (path === 'showFps') setPerfVisible(settings.get('showFps'));
  else if (path === 'fpsLimit') frameLimiter.interval = settings.get('fpsLimit') ? 1 / settings.get('fpsLimit') : 0;
});
initKeyLabels().then(() => settingsPanel.sync());

/* ═════════════ Caméra ═════════════ */

const tmpV = new THREE.Vector3();
const sph = new THREE.Spherical();
let camTween = null;

function computeRadius(level) {
  const aspect = window.innerWidth / window.innerHeight;
  let r = Math.max(Math.hypot(level.W, level.H) * 1.35 + level.maxTop * 0.8 + 2, level.maxTop * 4.2 + 4);
  if (aspect < 1) r /= Math.pow(aspect, 0.75);
  return r;
}

function setSpherical(r, phi, theta) {
  tmpV.setFromSphericalCoords(r, phi, theta);
  camera.position.copy(controls.target).add(tmpV);
  camera.lookAt(controls.target);
}

function readSpherical() {
  sph.setFromVector3(tmpV.copy(camera.position).sub(controls.target));
  return { r: sph.radius, phi: sph.phi, theta: sph.theta };
}

function tweenCamera({ r, phi, theta, target, duration = 1.2, easing = ease.inOutCubic, onComplete }) {
  if (camTween) tweens.kill(camTween);
  const from = readSpherical();
  const fromT = controls.target.clone();
  const toT = target ? target.clone() : fromT.clone();
  let dTheta = (theta - from.theta) % (Math.PI * 2);
  if (dTheta > Math.PI) dTheta -= Math.PI * 2;
  if (dTheta < -Math.PI) dTheta += Math.PI * 2;
  controls.enabled = false;
  camTween = tweens.add({
    duration,
    ease: easing,
    onUpdate: (k) => {
      controls.target.lerpVectors(fromT, toT, k);
      setSpherical(lerp(from.r, r, k), lerp(from.phi, phi, k), from.theta + dTheta * k);
    },
    onComplete: () => {
      camTween = null;
      controls.enabled = game.state === 'play';
      onComplete?.();
    },
  });
}

function applyViewShift() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (Math.abs(view.shift) < 1e-4) camera.clearViewOffset();
  else camera.setViewOffset(w, h, -w * view.shift, 0, w, h);
}

function tweenShift(to, duration = 1.6) {
  const from = view.shift;
  tweens.add({
    duration,
    ease: ease.inOutCubic,
    onUpdate: (k) => {
      view.shift = lerp(from, to, k);
      applyViewShift();
    },
  });
}

function rotateCamera(dir) {
  if (game.state !== 'play' || camTween) return;
  const s = readSpherical();
  sfx.click();
  tweenCamera({ r: s.r, phi: s.phi, theta: s.theta + (dir * Math.PI) / 2, duration: 0.6, easing: ease.outCubic });
}

function recenterCamera() {
  if (game.state !== 'play') return;
  sfx.click();
  tweenCamera({ r: view.radius, phi: view.phi, theta: view.theta, target: game.level.focus, duration: 0.8 });
}

// Petite secousse (appliquée juste autour du rendu, sans perturber OrbitControls)
const shake = { amount: 0, offset: new THREE.Vector3() };
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function addShake(a) {
  if (!reduceMotion) shake.amount = Math.max(shake.amount, a);
}

/* ═════════════ Niveaux ═════════════ */

function loadLevel(index) {
  game.level?.dispose();
  tweens.clear();
  camTween = null;
  game.index = index;
  game.gems = 0;
  game.steps = 0;
  const level = new Level(LEVELS[index], tweens);
  game.level = level;
  scene.add(level.root);
  player.place(level, level.start);
  cursor.hide();
  hover.tile = null;

  // Ombres cadrées sur le niveau
  const s = level.radius + 3;
  const cam = key.shadow.camera;
  cam.left = cam.bottom = -s;
  cam.right = cam.top = s;
  cam.near = 1;
  cam.far = 40;
  cam.updateProjectionMatrix();

  controls.target.copy(level.focus);
  view.radius = computeRadius(level);
  controls.minDistance = view.radius * 0.45;
  controls.maxDistance = view.radius * 1.5;
  ui.setLevel(index, level.def, level.gemTotal);
  level.intro();
  renderer.shadowMap.needsUpdate = true;
}

function goToLevel(index) {
  if (game.state === 'transition') return;
  const wasTitle = game.state === 'title';
  game.state = 'transition';
  controls.enabled = false;
  ui.showPause(false);
  ui.showComplete(false);
  ui.hideToast();
  ui.fade(true);
  setTimeout(() => {
    if (wasTitle) {
      ui.showTitle(false);
      view.shift = 0;
      applyViewShift();
    }
    loadLevel(index);
    setSpherical(view.radius * 1.12, view.phi - 0.08, view.theta - 0.5);
    ui.fade(false);
    tweenCamera({
      r: view.radius,
      phi: view.phi,
      theta: view.theta,
      duration: 1.6,
      onComplete: () => enterPlay(),
    });
    if (wasTitle) ui.showHUD(true);
  }, 480);
}

// Depuis le menu : le niveau 1 est déjà affiché derrière le titre, on y
// plonge directement ; sinon fondu vers le niveau demandé.
function playLevel(index) {
  if (game.state !== 'title') return;
  if (index === game.index) startGame();
  else {
    sfx.init();
    sfx.start();
    goToLevel(index);
  }
}

function enterPlay() {
  game.state = 'play';
  progress.setLast(game.index);
  controls.enabled = true;
  ui.showHUD(true);
  ui.banner(game.index, game.level.def);
  const hint = game.level.def.hints?.start;
  const level = game.level;
  if (hint) setTimeout(() => game.state === 'play' && game.level === level && ui.toast(hint, { duration: 5200 }), 3300);
}

function startGame() {
  if (game.state !== 'title') return;
  sfx.init();
  sfx.start();
  game.state = 'intro';
  ui.showTitle(false);
  tweenShift(0, 1.8);
  tweenCamera({
    r: view.radius,
    phi: view.phi,
    theta: view.theta,
    target: game.level.focus,
    duration: 2.2,
    onComplete: enterPlay,
  });
}

function backToTitle() {
  game.state = 'transition';
  ui.showPause(false);
  ui.showComplete(false);
  ui.showHUD(false);
  ui.hideToast();
  ui.fade(true);
  setTimeout(() => {
    loadLevel(0);
    enterTitle();
    ui.fade(false);
  }, 480);
}

function enterTitle() {
  game.state = 'title';
  controls.enabled = false;
  view.shift = isWide() ? 0.21 : 0;
  applyViewShift();
  titleTheta = view.theta - 0.9;
  setSpherical(view.radius * 1.2, 1.08, titleTheta);
  ui.showTitle(true);
}

function setPaused(p) {
  if (p && game.state === 'play') {
    game.state = 'paused';
    controls.enabled = false;
    ui.showPause(true);
    cursor.hide();
  } else if (!p && game.state === 'paused') {
    game.state = 'play';
    controls.enabled = true;
    ui.showPause(false);
  }
}

/* ═════════════ Gameplay ═════════════ */

player.onStep = (tile) => {
  game.steps++;
  ui.setSteps(game.steps);
  sfx.step();
  tmpV.copy(player.root.position);
  tmpV.y += 0.03;
  particles.ring(tmpV, 0x5effd8, 10, 0.9, { size: 2.6, life: 0.45, up: 0.05, intensity: 1.1 });
};

player.onArrive = (tile) => {
  const level = game.level;
  if (tile.obj === 'G' && !tile.collected) collectGem(tile);
  if (tile.obj === 'B' && level.pressButton()) pressButton();
  if (tile.obj === 'S' && game.state === 'play') completeLevel(tile);
  refreshHover();
};

const screenV = new THREE.Vector3();
function collectGem(tile) {
  const pos = game.level.collectGem(tile);
  if (!pos) return;
  const idx = game.gems++;
  sfx.gem(idx);
  rumble(0.15, 0.5, 90);
  particles.emit(pos, COLORS.gem, 26, { speed: 2.6, up: 2.2, life: 1, size: 6, gravity: -3 });
  particles.ring(pos, COLORS.gem, 20, 2.4, { size: 4, life: 0.6 });
  screenV.copy(pos).project(camera);
  const x = (screenV.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-screenV.y * 0.5 + 0.5) * window.innerHeight;
  ui.flyGem(x, y, idx, game.level.gemTotal);
  if (game.gems === game.level.gemTotal) {
    setTimeout(() => ui.toast('Tous les cristaux ! Il ne reste que l’étoile.', { color: 'var(--cyan)' }), 900);
  }
}

function pressButton() {
  const level = game.level;
  sfx.button();
  rumble(0.6, 0.35, 180);
  addShake(0.08);
  const p = level.button.getWorldPosition(new THREE.Vector3());
  p.y += 0.1;
  particles.ring(p, COLORS.button, 28, 3.2, { size: 5, life: 0.8 });
  particles.emit(p, COLORS.button, 14, { speed: 1.2, up: 2.2, life: 1, size: 5, gravity: -1 });
  if (level.def.hints?.button) ui.toast(level.def.hints.button, { color: 'var(--rose)' });
  level.activateBridges((tile, i) => {
    sfx.bridge(i);
    rumble(0.05, 0.3, 60);
    addShake(0.04);
    const w = level.worldOf(tile, new THREE.Vector3());
    particles.emit(w, COLORS.button, 12, { speed: 1.8, up: 1.2, life: 0.7, size: 4, gravity: -2 });
    refreshHover();
  });
}

function completeLevel(tile) {
  const level = game.level;
  game.state = 'complete';
  progress.complete(game.index, level.def.id, game.gems, game.steps, LEVELS.length);
  controls.enabled = false;
  cursor.hide();
  player.celebrate();
  level.collectStar();
  sfx.star();
  rumble(0.8, 0.8, 420);
  addShake(0.1);
  const p = level.worldOf(tile, new THREE.Vector3());
  p.y += 0.6;
  particles.emit(p, COLORS.star, 60, { speed: 3.5, up: 3.2, life: 1.6, size: 7, gravity: -2.2 });
  particles.ring(p, COLORS.star, 36, 3.6, { size: 6, life: 1 });
  setTimeout(() => particles.emit(p.setY(p.y + 1), 0xffffff, 40, { speed: 2.5, up: 1.5, life: 1.8, size: 5, gravity: -0.5 }), 900);
  ui.hideToast();

  const s = readSpherical();
  const focus = level.worldOf(tile, new THREE.Vector3());
  focus.y += 0.6;
  tweenCamera({ r: view.radius * 0.55, phi: Math.min(s.phi, 1.05), theta: s.theta + 0.5, target: focus, duration: 2.4 });
  setTimeout(() => {
    if (game.state !== 'complete') return;
    ui.showComplete(true, {
      def: level.def,
      gems: game.gems,
      total: level.gemTotal,
      steps: game.steps,
      hasNext: game.index + 1 < LEVELS.length,
    });
  }, 2300);
}

/* ═════════════ Entrées ═════════════ */

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const pointer = { downX: 0, downY: 0, dragging: false, active: 0, x: 0, y: 0, inside: false };
const hover = { tile: null, path: null };

function pickTile(x, y) {
  if (!game.level) return null;
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(game.level.pickMesh, false)[0];
  return hit ? game.level.tileFromInstance(hit.instanceId) : null;
}

function refreshHover(force = true) {
  if (game.state !== 'play' || pointer.dragging || !pointer.inside) {
    cursor.hide();
    hover.tile = null;
    canvas.style.cursor = '';
    return;
  }
  const tile = pickTile(pointer.x, pointer.y);
  if (tile === hover.tile && !force) return;
  const changed = tile !== hover.tile;
  hover.tile = tile;
  if (!tile || !tile.active) {
    cursor.hide();
    hover.path = null;
    canvas.style.cursor = '';
    return;
  }
  const from = player.nextTile;
  const path = findPath(game.level, from, tile);
  hover.path = path;
  cursor.show(game.level, tile, !!path);
  cursor.showPath(game.level, from, path);
  canvas.style.cursor = path ? 'pointer' : 'not-allowed';
  if (changed && path && path.length) sfx.hover();
}

canvas.addEventListener('pointerdown', (e) => {
  pointer.active++;
  pointer.downX = e.clientX;
  pointer.downY = e.clientY;
  pointer.dragging = false;
});

canvas.addEventListener('pointermove', (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.inside = true;
  if (pointer.active > 0 && Math.hypot(e.clientX - pointer.downX, e.clientY - pointer.downY) > 6) {
    if (!pointer.dragging) {
      pointer.dragging = true;
      cursor.hide();
      hover.tile = null;
    }
    canvas.style.cursor = 'grabbing';
    return;
  }
  if (e.pointerType === 'mouse') refreshHover(false);
});

window.addEventListener('pointerup', (e) => {
  const wasDrag = pointer.dragging;
  const multi = pointer.active > 1;
  pointer.active = Math.max(0, pointer.active - 1);
  if (pointer.active === 0) pointer.dragging = false;
  if (e.target !== canvas || wasDrag || multi || game.state !== 'play') {
    if (wasDrag) refreshHover();
    return;
  }
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.inside = true;
  const tile = pickTile(e.clientX, e.clientY);
  if (!tile || !tile.active) return;
  const from = player.nextTile;
  const path = findPath(game.level, from, tile);
  if (path && path.length) {
    cursor.click(game.level, tile, true);
    sfx.click();
    player.walk(path);
  } else if (!path) {
    cursor.click(game.level, tile, false);
    sfx.deny();
  }
  if (e.pointerType !== 'mouse') {
    cursor.hide();
    pointer.inside = false;
  } else refreshHover();
});

canvas.addEventListener('pointerleave', () => {
  pointer.inside = false;
  cursor.hide();
  hover.tile = null;
});

// Clavier — touches configurables (Paramètres > Commandes), lues par code
// physique. Les flèches déplacent toujours Lumi, en plus des touches choisies.
const ARROWS = { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
const MOVE_ACTIONS = { up: [1, 0], down: [-1, 0], left: [0, -1], right: [0, 1] };
function moveVector(code) {
  if (ARROWS[code]) return ARROWS[code];
  return MOVE_ACTIONS[settings.actionForCode(code)] ?? null;
}
const held = [];
let bumpCooldown = 0;

window.addEventListener('keydown', (e) => {
  // Paramètres ouverts : Échap ferme, le reste est géré par le panneau
  if (settingsPanel.isOpen) {
    if (e.code === 'Escape') closeSettings();
    return;
  }
  if (e.code === 'Escape') {
    if (game.state === 'title') ui.closeTopModal();
    else if (game.state === 'play') setPaused(true);
    else if (game.state === 'paused') setPaused(false);
    return;
  }
  if (game.state === 'title') {
    if (ui.menuKey(e)) e.preventDefault();
    return;
  }
  const action = settings.actionForCode(e.code);
  if (!e.repeat && action === 'mute') return toggleSound();
  if (!e.repeat && action === 'perf') return settings.set('showFps', !settings.get('showFps'));
  if (game.state !== 'play') return;
  if (moveVector(e.code)) {
    e.preventDefault();
    if (!held.includes(e.code)) held.push(e.code);
    cursor.hide();
    return;
  }
  if (e.repeat) return;
  if (action === 'camLeft') rotateCamera(-1);
  else if (action === 'camRight') rotateCamera(1);
  else if (action === 'recenter') recenterCamera();
  else if (action === 'restart') goToLevel(game.index);
});

window.addEventListener('keyup', (e) => {
  const i = held.indexOf(e.code);
  if (i >= 0) held.splice(i, 1);
});
window.addEventListener('blur', () => (held.length = 0));

const fwd = new THREE.Vector3();
// Direction voulue : touche maintenue, sinon stick gauche / croix de la manette
function currentMove() {
  if (held.length) return moveVector(held[held.length - 1]);
  if (pad.connected && !activeContainer()) {
    const a = pad.moveAxis();
    if (Math.hypot(a.x, a.y) > 0.5) return [-a.y, a.x];
  }
  return null;
}

function keyboardStep() {
  if (game.state !== 'play' || player.moving) return;
  const mv = currentMove();
  if (!mv) return;
  const [f, s] = mv;
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  fwd.normalize();
  // droite caméra = (-fwd.z, 0, fwd.x)
  const mx = fwd.x * f - fwd.z * s;
  const mz = fwd.z * f + fwd.x * s;
  let dx = 0;
  let dz = 0;
  if (Math.abs(mx) > Math.abs(mz)) dx = Math.sign(mx);
  else dz = Math.sign(mz);
  const cur = player.tile;
  const next = game.level.tileAt(cur.x + dx, cur.z + dz);
  if (next && game.level.canStep(cur, next)) {
    player.walk([next]);
  } else if (bumpCooldown <= 0) {
    player.bump(dx, dz);
    sfx.bump();
    rumble(0.3, 0.05, 70);
    bumpCooldown = 0.35;
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  if (game.state === 'title') view.shift = isWide() ? 0.21 : 0;
  applyViewShift();
  gfx.resize();
  if (game.level) {
    const prev = view.radius;
    view.radius = computeRadius(game.level);
    if (!camTween && game.state !== 'title') {
      const s = readSpherical();
      setSpherical((s.r * view.radius) / prev, s.phi, s.theta);
    }
    controls.minDistance = view.radius * 0.45;
    controls.maxDistance = view.radius * 1.5;
  }
});

/* ═════════════ Manette ═════════════ */

const pad = new GamepadInput();
let padRestartHold = 0;

function setPadNav(on) {
  if (document.body.classList.contains('pad-nav') === on) return;
  document.body.classList.toggle('pad-nav', on);
  if (on) cursor.hide();
}
window.addEventListener('pointermove', () => setPadNav(false), { passive: true });

function rumble(strong, weak, ms) {
  if (settings.get('gamepad.vibration')) pad.rumble(strong, weak, ms);
}

pad.onConnect = (g) => {
  settingsPanel.setPadStatus(g.id);
  ui.toast('Manette connectée', { color: 'var(--cyan)', duration: 2400 });
};
pad.onDisconnect = () => {
  settingsPanel.setPadStatus(null);
  ui.toast('Manette déconnectée', { color: 'var(--rose)', duration: 2400 });
};

// Contexte d'interface actif (fenêtre ouverte ou menu), null = en jeu
function activeContainer() {
  if (settingsPanel.isOpen) return document.getElementById('settings');
  for (const id of ['levels', 'credits', 'complete', 'pause']) {
    const el = document.getElementById(id);
    if (el.classList.contains('is-visible')) return el;
  }
  if (game.state === 'title') return document.getElementById('title');
  return null;
}

pad.onNav = (dir) => {
  const box = activeContainer();
  if (!box) return; // en jeu : le déplacement est continu (voir currentMove)
  setPadNav(true);
  sfx.hover();
  if (box.id === 'title') {
    ui.menuKey({ code: dir === 'up' ? 'ArrowUp' : dir === 'down' ? 'ArrowDown' : '' });
    return;
  }
  if (box.id === 'levels') return moveFocusSpatial(box, dir);
  if (dir === 'left' || dir === 'right') {
    const delta = dir === 'left' ? -1 : 1;
    if (document.activeElement?.classList.contains('tab')) return settingsPanel.cycleTab(delta);
    if (!adjustFocused(delta)) moveFocus(box, delta);
    return;
  }
  moveFocus(box, dir === 'up' ? -1 : 1);
};

pad.onButton = (b) => {
  sfx.init();
  const box = activeContainer();
  if (box) {
    setPadNav(true);
    if (b === BTN.A) {
      if (box.id === 'title' && !box.contains(document.activeElement)) ui.selectMenu(ui.menuIndex);
      else if (!box.contains(document.activeElement)) moveFocus(box, 1);
      activateFocused();
    } else if (b === BTN.B) {
      if (settingsPanel.isOpen) closeSettings();
      else if (box.id === 'levels' || box.id === 'credits') ui.closeTopModal();
      else if (box.id === 'pause') setPaused(false);
    } else if ((b === BTN.LB || b === BTN.RB) && settingsPanel.isOpen) {
      settingsPanel.cycleTab(b === BTN.LB ? -1 : 1);
    } else if (b === BTN.START && box.id === 'pause') {
      setPaused(false);
    }
    return;
  }
  if (game.state !== 'play') return;
  setPadNav(true);
  if (b === BTN.START) setPaused(true);
  else if (b === BTN.LB) rotateCamera(-1);
  else if (b === BTN.RB) rotateCamera(1);
  else if (b === BTN.Y) recenterCamera();
  else if (b === BTN.X) ui.toast('Maintiens X pour recommencer le niveau', { duration: 1600 });
};

// Caméra au stick droit (orbite + inclinaison), zoom aux gâchettes, X maintenu = recommencer
function updatePadCamera(dt) {
  if (!pad.connected || game.state !== 'play' || camTween || activeContainer()) {
    padRestartHold = 0;
    return;
  }
  const sens = settings.get('gamepad.sensitivity') / 55;
  const { x, y } = pad.right;
  const zoom = (pad.pressed[BTN.LT] ? 1 : 0) - (pad.pressed[BTN.RT] ? 1 : 0);
  if (x || y || zoom) {
    const s = readSpherical();
    const phi = Math.min(controls.maxPolarAngle, Math.max(controls.minPolarAngle, s.phi + y * dt * 1.3 * sens));
    const r = Math.min(controls.maxDistance, Math.max(controls.minDistance, s.r * (1 + zoom * dt * 0.9)));
    setSpherical(r, phi, s.theta - x * dt * 1.8 * sens);
  }
  if (pad.pressed[BTN.X]) {
    padRestartHold += dt;
    if (padRestartHold > 0.8) {
      padRestartHold = 0;
      goToLevel(game.index);
    }
  } else padRestartHold = 0;
}

/* ═════════════ Boucle ═════════════ */

const timer = new THREE.Timer();
let titleTheta = 0;
let gameTime = 0;
let shadowTrail = 0;
let perfVisible = false;
let perfClock = 0;
const sunPos = new THREE.Vector3();

// Limiteur d'images/s (Paramètres) : on saute des frames d'affichage
const frameLimiter = { interval: settings.get('fpsLimit') ? 1 / settings.get('fpsLimit') : 0, acc: 0 };

function frame(timestamp) {
  timer.update(timestamp);
  let rawDt = timer.getDelta();
  if (frameLimiter.interval) {
    frameLimiter.acc += rawDt;
    // petite tolérance pour ne pas rater une frame à cause de la gigue de rAF
    if (frameLimiter.acc < frameLimiter.interval * 0.92) return;
    rawDt = frameLimiter.acc;
    frameLimiter.acc = 0;
  }
  const dt = Math.min(rawDt, 1 / 20);
  quality.sample(rawDt);
  renderer.info.reset();
  const t = timer.getElapsed();
  const paused = game.state === 'paused';
  const gdt = paused ? 0 : dt;
  gameTime += gdt;

  tweens.update(gdt);

  if (game.state === 'title' && !camTween) {
    titleTheta += dt * 0.07;
    setSpherical(view.radius * 1.2, 1.08 + Math.sin(t * 0.2) * 0.04, titleTheta);
  } else if (controls.enabled && !camTween) {
    controls.update(dt);
  }

  pad.update(rawDt);
  updatePadCamera(dt);
  bumpCooldown -= gdt;
  keyboardStep();

  sky.update(t, dt, camera);
  game.level?.update(gameTime, gdt);
  player.update(gdt, gameTime);
  particles.update(gdt, t);
  cursor.update(t, dt);

  // Secousse
  shake.amount *= Math.exp(-7 * dt);
  shake.offset.set((Math.random() - 0.5) * shake.amount, (Math.random() - 0.5) * shake.amount, (Math.random() - 0.5) * shake.amount);
  camera.position.add(shake.offset);

  // Ombres : la shadow map n'est recalculée que si quelque chose bouge
  if (player.moving || player.celebrateT >= 0 || player.bumpT > 0 || tweens.list.length > 0) shadowTrail = 3;
  if (shadowTrail > 0) {
    shadowTrail--;
    renderer.shadowMap.needsUpdate = true;
  }

  // Les god rays partent du cœur de l'étoile du niveau
  const star = game.level?.star;
  if (star && gfx.godRaysOn) {
    star.userData.spin.getWorldPosition(sunPos);
    sun.position.copy(sunPos);
    sun.visible = true;
  } else sun.visible = false;

  globalUniforms.uTime.value = t;
  composer.render(dt);
  camera.position.sub(shake.offset);

  if ((perfClock += rawDt) > 0.5) {
    perfClock = 0;
    settingsPanel.updateLive();
    if (perfVisible) {
      const i = renderer.info.render;
      const w = Math.round(window.innerWidth * gfx.pixelRatio);
      const h = Math.round(window.innerHeight * gfx.pixelRatio);
      perfEl.textContent = `${quality.fps.toFixed(0)} i/s · ${quality.avgMs.toFixed(1)} ms · ${TIERS[quality.tier].name}${quality.auto ? ' (auto)' : ''} · ${w}×${h} · ${i.calls} draws · ${(i.triangles / 1000).toFixed(0)}k tris`;
    }
  }
}

function setPerfVisible(v) {
  perfVisible = v;
  perfEl.classList.toggle('is-visible', v);
  perfClock = 1;
}
setPerfVisible(settings.get('showFps') || new URLSearchParams(location.search).has('debug'));

/* ═════════════ Démarrage ═════════════ */

loadLevel(0);
enterTitle();
renderer.setAnimationLoop(frame);

// Raccourci de debug (dev uniquement) : __shine.walkTo(x, z)
if (import.meta.env.DEV) {
  window.__shine = {
    game,
    goto: (i) => goToLevel(i),
    // gros plan sur Lumi (captures de test)
    closeup(r = 2.2, phi = 1.15) {
      controls.minDistance = 0.5;
      controls.target.copy(player.root.position).y += 0.65;
      setSpherical(r, phi, readSpherical().theta);
    },
    player,
    scene,
    composer,
    quality,
    gfx,
    settings,
    info: () => ({ fps: quality.fps, tier: TIERS[quality.tier].name, pr: gfx.pixelRatio, calls: renderer.info.render.calls }),
    cam: () => ({ pos: camera.position.toArray(), target: controls.target.toArray(), radius: view.radius }),
    walkTo(x, z) {
      const path = findPath(game.level, player.nextTile, game.level.tileAt(x, z));
      if (path) player.walk(path);
      return !!path;
    },
  };
}

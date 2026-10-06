import './style.css';
import * as THREE from 'three';
import { createRenderer } from './core/renderer.js';
import { CameraRig } from './core/cameraRig.js';
import { FrameStats } from './core/frameStats.js';
import { Quality, TIERS } from './core/quality.js';
import { Tweens, ease } from './core/tween.js';
import { settings, initKeyLabels, keyLabel } from './core/settings.js';
import { progress } from './core/progress.js';
import { createSky } from './world/sky.js';
import { createVortex } from './world/vortex.js';
import { createLights } from './world/lights.js';
import { Level } from './world/level.js';
import { Player } from './world/player.js';
import { Particles } from './world/particles.js';
import { Cursor } from './world/cursor.js';
import { COLORS, makeHalo } from './world/props.js';
import { globalUniforms } from './world/materials.js';
import { LEVELS } from './game/levels.js';
import { findPath } from './game/pathfinding.js';
import { PointerInput } from './input/pointer.js';
import { KeyboardInput } from './input/keyboard.js';
import { PadController } from './input/padController.js';
import { UI } from './ui/ui.js';
import { SettingsPanel } from './ui/settingsPanel.js';
import { PerfHud } from './ui/perfHud.js';
import { Sfx } from './audio/sfx.js';
import { Music } from './audio/music.js';
import { Voice } from './audio/voice.js';
import { Dialogue } from './ui/dialogue.js';
import { Tutorials } from './ui/tutorial.js';
import { EMOTIONS } from './world/npc.js';
import { LUMI_VOICE } from './game/levels.js';
import { CURIO_INFO, curioText, telescopeEyepiece } from './world/curios.js';
import { createSkyView } from './world/celestial.js';

/* ═════════════ Scène & rendu ═════════════ */

const canvas = document.getElementById('scene');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 1000);
const gfx = createRenderer(canvas, scene, camera);
const { renderer, composer, sun } = gfx;
renderer.info.autoReset = false;

const tweens = new Tweens();
const rig = new CameraRig(camera, canvas, tweens);
const sky = createSky(renderer, scene);
const lights = createLights(scene, renderer);
const particles = new Particles();
const cursor = new Cursor();
const player = new Player();
const vortex = createVortex(renderer);
scene.add(sky.group, vortex, particles.group, cursor.group, player.root, player.fx);

const stats = new FrameStats(renderer);
const quality = new Quality(stats, (tier) => {
  gfx.setQuality(tier);
  globalUniforms.uPixelRatio.value = tier.pixelRatio;
  // l'occlusion précalculée prend le relais quand l'AO écran est coupée
  globalUniforms.uBakedAO.value = tier.ao ? 0.45 : 1;
  lights.setShadowSize(tier.shadow);
});

quality.canUpgradeNow = () => game.state === 'paused' || game.state === 'transition';

const sfx = new Sfx();
const music = new Music(sfx);
const voice = new Voice(sfx);
sfx.onInit = () => {
  // le contexte audio naît au premier geste du joueur
  music.start();
  if (game.level) voice.preload(`${game.level.def.id}/`);
};

/* ═════════════ État du jeu ═════════════ */

const game = {
  state: 'boot', // title | intro | play | paused | complete | transition
  index: 0,
  level: null,
  gems: 0,
  steps: 0,
  time: 0, // secondes de jeu effectif (hors pauses, dialogues, fiches)
  found: new Set(), // curiosités découvertes pendant cette partie
};
const isWide = () => window.innerWidth > 720;
const playing = () => game.state === 'play';

/* ═════════════ Interface ═════════════ */

function toggleSound() {
  sfx.init();
  ui.setSound(sfx.toggleMute());
}

function rotateCamera(dir) {
  if (playing() && rig.rotateQuarter(dir)) sfx.click();
}

function recenterCamera() {
  if (!playing()) return;
  sfx.click();
  rig.home(game.level);
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

const settingsPanel = new SettingsPanel({
  onTestSound: () => {
    sfx.init();
    sfx.gem(0);
  },
  onHoverSound: () => sfx.hover(),
  getLiveInfo: () => {
    const pr = gfx.pixelRatio;
    return `Actuellement : ${stats.fps.toFixed(0)} i/s · qualité ${TIERS[quality.tier].name}${quality.auto ? ' (auto)' : ''} · rendu ${Math.round(innerWidth * pr)}×${Math.round(innerHeight * pr)}`;
  },
});

const perfHud = new PerfHud(document.getElementById('perf'), {
  stats,
  renderer,
  quality,
  tiers: TIERS,
  getPixelRatio: () => gfx.pixelRatio,
});
perfHud.setVisible(settings.get('showFps') || new URLSearchParams(location.search).has('debug'));

let settingsWasPaused = false;

function openSettings() {
  if (playing()) {
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

const frameLimiter = { interval: 0, acc: 0 };
// Mode illimité : rAF est calé sur la fréquence de l'écran, on enchaîne donc
// les images via MessageChannel (pas de clamp à 4 ms comme setTimeout).
// Onglet masqué → retour sur rAF, qui se met en pause tout seul.
// Attention : enchaîner les messages sans fin affame le navigateur, qui
// n'affiche plus rien (le jeu continuait de tourner — pas qui défilent —
// derrière une image figée). On rend donc la main dès qu'aucun rAF n'est passé
// depuis MAX_GAP ms, et on repart au rAF suivant (image affichée entre-temps).
const MAX_GAP = 4;
const gl = renderer.getContext();
const uncapped = { on: false, started: false, waiting: false, lastRaf: 0, ch: new MessageChannel() };
function rafPump(id) {
  if (!uncapped.on || id !== uncapped.pump) return; // une seule chaîne de rAF active
  uncapped.lastRaf = performance.now();
  if (uncapped.waiting) {
    uncapped.waiting = false;
    tickUncapped();
  }
  requestAnimationFrame(() => rafPump(id));
}
function tickUncapped() {
  if (!uncapped.on) return;
  frame(performance.now());
  // attend la fin du travail GPU : sinon les images s'empilent dans la file
  // du GPU et l'affichage prend des centaines de ms de retard
  gl.finish();
  if (document.hidden || performance.now() - uncapped.lastRaf > MAX_GAP) uncapped.waiting = true;
  else uncapped.ch.port2.postMessage(0);
}
uncapped.ch.port1.onmessage = tickUncapped;

function startLoop() {
  const unlimited = settings.get('fpsLimit') < 0;
  if (uncapped.started && unlimited === uncapped.on) return;
  uncapped.started = true;
  uncapped.on = unlimited;
  renderer.setAnimationLoop(unlimited ? null : frame);
  if (unlimited) {
    uncapped.lastRaf = performance.now();
    uncapped.waiting = false;
    const id = (uncapped.pump = (uncapped.pump ?? 0) + 1);
    requestAnimationFrame(() => rafPump(id));
    tickUncapped();
  }
}

function applyFpsLimit() {
  const l = settings.get('fpsLimit');
  frameLimiter.interval = l > 0 ? 1 / l : 0;
  frameLimiter.acc = 0;
  if (uncapped.started) startLoop();
}
applyFpsLimit();

settings.onChange((path) => {
  if (path === 'quality') quality.setMode(settings.get('quality'));
  else if (path === 'resolution' || path.startsWith('effects')) quality.refresh();
  else if (path.startsWith('volume')) sfx.applyVolumes();
  else if (path === 'showFps') perfHud.setVisible(settings.get('showFps'));
  else if (path === 'fpsLimit') applyFpsLimit();
});
initKeyLabels().then(() => settingsPanel.sync());

/* ═════════════ Niveaux & déroulement ═════════════ */

// Construit le niveau et préchauffe ses shaders (y compris les objets encore
// cachés, comme les dalles de pont) pendant que l'écran est masqué.
function loadLevel(index) {
  game.level?.dispose();
  tweens.clear();
  dialogue.setCinema(false); // une cinématique interrompue ne doit pas laisser ses bandes noires
  closeSkyView();
  disposeSkyViews();
  player.root.visible = true;
  rig.tween = null;
  game.index = index;
  game.gems = 0;
  game.steps = 0;
  game.time = 0;
  game.found = new Set();
  mirrorHold = false;
  const level = new Level(LEVELS[index], tweens);
  game.level = level;
  scene.add(level.root);
  player.place(level, level.start);
  cursor.hide();
  pointer.hoverTile = null;
  lights.fitShadow(level);
  rig.target.copy(level.focus);
  rig.fit(level);
  ui.setLevel(index, level.def, level.gemTotal, level.curioTotal);
  level.intro();
  sky.setMood(level.def.mood);
  vortex.setMood(level.palette.vortex);
  lights.setMood(level.palette);
  globalUniforms.uUnderGlow.value.setHex(level.palette.underGlow).multiplyScalar(0.75);
  voice.preload(`${level.def.id}/`); // répliques enregistrées du niveau
  if (game.state !== 'title' && game.state !== 'boot') music.setMood(level.def.mood);
  const views = prepareSkyViews(level);
  gfx.warmup([...level.warmupTargets(), ...views, particles.burst, cursor.pulse, cursor.frame]);
}

function goToLevel(index) {
  if (game.state === 'transition') return;
  const wasTitle = game.state === 'title';
  dialogue.skip();
  game.state = 'transition';
  quality.paused = true;
  rig.setInteractive(false);
  ui.showPause(false);
  ui.showComplete(false);
  ui.hideToast();
  ui.fade(true);
  setTimeout(() => {
    quality.flush(); // écran masqué : bon moment pour monter en qualité
    if (wasTitle) {
      ui.showTitle(false);
      rig.setShift(0);
    }
    loadLevel(index);
    const v = rig.view;
    rig.set(v.radius * 1.12, v.phi - 0.08, v.theta - 0.5);
    ui.fade(false);
    rig.home(null, 1.6, enterPlay);
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
  music.setMood(game.level.def.mood);
  game.state = 'play';
  quality.paused = false;
  progress.setLast(game.index);
  rig.setInteractive(true);
  ui.showHUD(true);
  const level = game.level;
  ui.banner(game.index, level.def, level.palette).then(async () => {
    if (game.level !== level || !playing()) return;
    await tutorials.teach('move');
    if (game.level !== level || !playing()) return;
    // esprit juste à côté du départ : il engage la conversation
    const npc = !player.moving ? level.npcNear(player.tile) : null;
    if (npc && !npc.seen) startDialogue(npc);
    else hintOnce('start');
  });
}

function startGame() {
  if (game.state !== 'title') return;
  sfx.init();
  sfx.start();
  game.state = 'intro';
  ui.showTitle(false);
  rig.animateShift(0, 1.8);
  const v = rig.view;
  rig.animateTo({ r: v.radius, phi: v.phi, theta: v.theta, target: game.level.focus, duration: 2.2, onComplete: enterPlay });
}

function backToTitle() {
  dialogue.skip();
  game.state = 'transition';
  quality.paused = true;
  ui.showPause(false);
  ui.showComplete(false);
  ui.showHUD(false);
  ui.hideToast();
  ui.fade(true);
  setTimeout(() => {
    quality.flush();
    loadLevel(0);
    enterTitle();
    ui.fade(false);
  }, 480);
}

let titleTheta = 0;
function enterTitle() {
  game.state = 'title';
  quality.paused = false;
  rig.setInteractive(false);
  rig.setShift(isWide() ? 0.21 : 0);
  titleTheta = rig.view.theta - 0.9;
  rig.set(rig.view.radius * 1.2, 1.08, titleTheta);
  ui.showTitle(true);
  music.setMood('title');
}

function setPaused(p) {
  if (p && playing()) {
    game.state = 'paused';
    quality.flush();
    rig.setInteractive(false);
    ui.showPause(true);
    cursor.hide();
  } else if (!p && game.state === 'paused') {
    game.state = 'play';
    rig.setInteractive(true);
    ui.showPause(false);
  }
}

/* ═════════════ Gameplay ═════════════ */

const tmpV = new THREE.Vector3();
const screenV = new THREE.Vector3();

player.onSegment = (dh) => sfx.whoosh(dh);

player.onStep = () => {
  game.steps++;
  ui.setSteps(game.steps);
  tmpV.copy(player.root.position);
  tmpV.y += 0.03;
  if (player.landedFromJump) {
    // atterrissage de tremplin : impact, onde, secousse
    sfx.land(2);
    rig.shake(0.07);
    pad.rumble(0.5, 0.4, 160);
    particles.ring(tmpV, 0x5effd8, 28, 2.6, { size: 4, life: 0.7, up: 0.1 });
    particles.emit(tmpV, 0xff9ad0, 18, { speed: 1.8, up: 1.4, life: 0.8, size: 4, gravity: -2 });
  } else {
    sfx.step();
    if (player.hop > 0.1) sfx.land(0.5);
    particles.ring(tmpV, 0x5effd8, 10, 0.9, { size: 2.6, life: 0.45, up: 0.05, intensity: 1.1 });
  }
};

player.onArrive = (tile) => {
  if (tile.obj === 'R' && playing()) passMirror(tile);
  if (tile.obj === 'G' && !tile.collected) collectGem(tile);
  if (tile.obj === 'B' && game.level.pressButton()) pressButton();
  if (tile.obj === 'S' && playing()) completeLevel(tile);
  // mécaniques déclenchées seulement quand Lumi s'arrête sur la case
  const stopped = player.queue.length === 0 && playing();
  if (stopped && tile.platform) ridePlatform(tile);
  if (stopped && tile.obj === 'O') flipIsland(tile);
  if (stopped && tile.jumpTo) launchJump(tile);
  if (player.landedFromJump) player.locked = false;
  // personnage voisin : on lui parle si on venait pour ça, ou à la première rencontre
  if (stopped && !tile.platform && !tile.jumpTo && tile.obj !== 'O') {
    const npc = game.level.npcNear(tile);
    if (npc && (npc === pendingTalk || !npc.seen)) startDialogue(npc);
    else if (pendingTalk?.tile && adjacent(tile, pendingTalk.tile)) useCurio(pendingTalk);
  }
  if (player.queue.length === 0) pendingTalk = null;
  pointer.refresh();
};

// Tremplin : la membrane se comprime, puis Lumi est projeté vers l'arrivée
async function launchJump(tile) {
  const level = game.level;
  player.locked = true;
  cursor.hide();
  await tutorials.teach('trampoline');
  setTimeout(() => {
    if (game.level !== level || !playing()) return (player.locked = false);
    level.bounce(tile);
    sfx.jump();
    pad.rumble(0.45, 0.6, 220);
    const p = level.worldOf(tile, new THREE.Vector3());
    p.y += 0.25;
    particles.ring(p, 0xff9ad0, 22, 2.2, { size: 4, life: 0.6 });
    player.jump(tile.jumpTo);
  }, 300);
}

/* ═════════════ Dialogues ═════════════ */

const dialogue = new Dialogue({ voice, sfx });

// Fiches « Nouvelle mécanique » : le jeu se met en pause le temps de lire
let stateBeforeTuto = 'play';
const tutorials = new Tutorials({
  sfx,
  onOpen() {
    stateBeforeTuto = game.state;
    game.state = 'tutorial';
    rig.setInteractive(false);
    cursor.hide();
  },
  onClose() {
    game.state = stateBeforeTuto;
    rig.setInteractive(game.state === 'play');
  },
});
document.getElementById('btn-tuto-reset').addEventListener('click', () => {
  tutorials.reset();
  ui.toast('Les fiches des mécaniques réapparaîtront.', { duration: 2400 });
});
let pendingTalk = null; // personnage vers lequel Lumi marche pour lui parler

function speakerOf(npcDef) {
  const color = '#' + new THREE.Color(EMOTIONS[npcDef.emotion]?.color ?? 0xffffff).getHexString();
  return { name: npcDef.name, color, ...npcDef.voice };
}

// Mini-cinématique : bandes noires, caméra de profil sur les deux personnages,
// regards croisés, répliques doublées ; puis retour au cadrage de jeu.
async function startDialogue(npc) {
  if (!playing() || dialogue.isOpen) return;
  const level = game.level;
  beginCinematic();

  const lp = player.root.position.clone();
  const np = npc.root.getWorldPosition(new THREE.Vector3());
  player.targetYaw = Math.atan2(np.x - lp.x, np.z - lp.z);
  npc.lookAt(lp.x, lp.z);
  npc.inTalk = true;

  const saved = rig.read();
  const savedTarget = rig.target.clone();
  const mid = lp.clone().add(np).multiplyScalar(0.5);
  mid.y += 0.75;
  // caméra de profil (côté le plus proche de la vue actuelle)
  let theta = Math.atan2(np.x - lp.x, np.z - lp.z) + Math.PI / 2;
  const diff = (a) => Math.abs(Math.atan2(Math.sin(a - saved.theta), Math.cos(a - saved.theta)));
  if (diff(theta + Math.PI) < diff(theta)) theta += Math.PI;
  rig.setInteractive(false);
  await new Promise((r) => rig.animateTo({ r: 4.4, phi: 1.2, theta, target: mid, duration: 1.1, onComplete: r }));

  const def = npc.def;
  const set = npc.seen && def.repeat ? 'r' : 'l';
  const lines = (set === 'r' ? def.repeat : def.lines).map((l, i) => ({ ...l, key: `${level.def.id}/${def.id}/${set}${i}` }));
  await dialogue.play(lines, { lumi: LUMI_VOICE, [def.id]: speakerOf(def) }, (who, on) => {
    if (who === def.id) npc.speaking = on;
    else if (who === 'lumi') player.talking = on;
  });
  npc.seen = true;
  npc.inTalk = false;
  npc.speaking = false;
  await endCinematic(level, saved, savedTarget);
  if (game.level !== level) return;
  await tutorials.teach('talk');
  if (game.level === level && playing()) hintOnce('start');
}

// Début de mini-cinématique (bandes noires, HUD masqué, Lumi immobile)
function beginCinematic() {
  game.state = 'dialogue';
  player.locked = true;
  player.stop();
  pendingTalk = null;
  cursor.hide();
  setTalkPrompt(null);
  ui.hideToast();
  ui.showHUD(false);
  dialogue.setCinema(true);
  sfx.duckMusic(true);
  rig.setInteractive(false);
}

// Fin de mini-cinématique : retour au cadrage de jeu, puis on rend la main
function endCinematic(level, saved, savedTarget) {
  player.talking = false;
  dialogue.setCinema(false);
  sfx.duckMusic(false);
  if (game.level !== level) return Promise.resolve();
  return new Promise((resolve) =>
    rig.animateTo({
      r: saved.r,
      phi: saved.phi,
      theta: saved.theta,
      target: savedTarget,
      duration: 1.0,
      onComplete: () => {
        game.state = 'play';
        player.locked = false;
        rig.setInteractive(true);
        ui.showHUD(true);
        pointer.refresh();
        resolve();
      },
    }),
  );
}

/* ═════════════ Curiosités ═════════════ */

const adjacent = (a, b) => a.layer === b.layer && Math.abs(a.x - b.x) + Math.abs(a.z - b.z) === 1;

// Interaction bonus avec une curiosité voisine (maison, moulin, cloche…)
async function useCurio(curio) {
  if (!playing() || dialogue.isOpen || player.locked) return;
  pendingTalk = null;
  player.stop();
  const cp = curio.prop.getWorldPosition(new THREE.Vector3());
  const lp = player.root.position;
  player.targetYaw = Math.atan2(cp.x - lp.x, cp.z - lp.z);
  if (!curio.found) {
    curio.found = true;
    game.found.add(curio.id);
    ui.setCurios(game.found.size, true);
    sfx.discover();
  }
  const text = curioText(curio.type, curio.def);
  switch (curio.type) {
    case 'U':
      return observe(curio);
    case 'Q':
      return ringBell(curio, text);
    case 'F':
      return makeWish(curio, text);
    case 'Y': {
      game.level.playCurio(curio);
      sfx.windmill();
      pad.rumble(0.15, 0.2, 300);
      const fx = cp.clone();
      fx.y += 1.5;
      for (let i = 0; i < 3; i++) setTimeout(() => particles.emit(fx, 0xf2f6ff, 10, { speed: 2.4, up: 0.4, life: 1.1, size: 3, gravity: 0 }), i * 220);
      break;
    }
    case 'N':
      sfx.click();
      break;
  }
  if (curio.type === 'H' || Array.isArray(text)) return visitCurio(curio, Array.isArray(text) ? text : [{ who: 'lumi', text }]);
  ui.toast(text, { color: 'var(--gold)', duration: Math.max(3800, text.length * 55) });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Plan de profil sur Lumi et un objet (côté le plus proche de la vue actuelle)
function twoShot(point, { r = 3.8, phi = 1.15, duration = 1.0, up = 0.7 } = {}) {
  const lp = player.root.position.clone();
  const mid = lp.clone().lerp(point, 0.5);
  mid.y += up;
  let theta = Math.atan2(point.x - lp.x, point.z - lp.z) + Math.PI / 2;
  const cur = rig.read().theta;
  const diff = (a) => Math.abs(Math.atan2(Math.sin(a - cur), Math.cos(a - cur)));
  if (diff(theta + Math.PI) < diff(theta)) theta += Math.PI;
  return new Promise((res) => rig.animateTo({ r, phi, theta, target: mid, duration, onComplete: res }));
}

// Coupe instantanée de caméra, cachée par un fondu au noir
async function cutTo(setup) {
  ui.fade(true);
  await wait(480);
  setup();
  ui.fade(false);
}

function curioSpeakers(curio, level, color = '#ffd47a') {
  const speakers = { lumi: LUMI_VOICE, souvenir: { name: curio.def?.voice ?? curio.name.replace(/^./, (c) => c.toUpperCase()), color, pitch: 0.95, rate: 0.95, voiceIndex: 0 } };
  for (const n of level.def.npcs ?? []) speakers[n.id] = speakerOf(n);
  return speakers;
}

function playLines(curio, level, lines, color) {
  return dialogue.play(
    lines.map((l, i) => ({ ...l, key: `${level.def.id}/curio/${curio.id}/${i}` })),
    curioSpeakers(curio, level, color),
    (who, on) => who === 'lumi' && (player.talking = on),
  );
}

// Visite d'une maison (ou lecture longue) : la caméra s'approche de la
// façade, la porte s'ouvre sur un intérieur chaleureux, Lumi commente.
async function visitCurio(curio, lines) {
  const level = game.level;
  beginCinematic();
  const saved = rig.read();
  const savedTarget = rig.target.clone();
  const cp = curio.prop.getWorldPosition(new THREE.Vector3());
  const front = curio.prop.getWorldDirection(new THREE.Vector3());
  const target = cp.clone();
  target.y += 0.6;
  const theta = Math.atan2(front.x, front.z) + 0.4;
  await new Promise((r) => rig.animateTo({ r: 4.6, phi: 1.12, theta, target, duration: 1.1, onComplete: r }));
  if (game.level !== level) return;
  const house = curio.type === 'H';
  if (house) {
    level.setHouseOpen(curio, true);
    sfx.door(true);
    const door = cp.clone().addScaledVector(front, 0.48);
    door.y += 0.35;
    particles.emit(door, 0xffc06a, 16, { speed: 0.6, up: 0.8, life: 1.2, size: 4, gravity: 0.2 });
    await wait(450);
  }
  await playLines(curio, level, lines);
  if (house && game.level === level) {
    level.setHouseOpen(curio, false);
    sfx.door(false);
  }
  await endCinematic(level, saved, savedTarget);
}

/* ═════════════ Cloche ═════════════ */

// Plan de profil ; Lumi s'élance, frappe la cloche (deux coups), les ondes
// sonores s'étendent sur l'île, puis le texte de la cloche s'affiche.
async function ringBell(curio, text) {
  const level = game.level;
  beginCinematic();
  const saved = rig.read();
  const savedTarget = rig.target.clone();
  const bell = curio.prop.localToWorld(new THREE.Vector3(0, 0.45, 0));
  await twoShot(bell, { r: 3.6, up: 0.55 });
  if (game.level !== level) return;
  for (let k = 0; k < 2; k++) {
    player.lean(bell, { reach: 0.55, lift: 0.12, tilt: 0.35 });
    await wait(380);
    if (game.level !== level) return;
    player.unlean();
    level.playCurio(curio);
    sfx.bell();
    pad.rumble(0.35, 0.25, 220);
    rig.shake(0.04);
    for (let i = 0; i < 3; i++) setTimeout(() => particles.ring(bell, 0xffcf7a, 28, 2.4 + i * 1.2, { size: 4, life: 1.3, up: 0.05, drag: 1.2 }), i * 260);
    await wait(k ? 1300 : 900);
  }
  await playLines(curio, level, Array.isArray(text) ? text : [{ who: 'souvenir', text }]);
  await endCinematic(level, saved, savedTarget);
}

/* ═════════════ Vœu ═════════════ */

const wishEl = document.getElementById('wish');
const wishForm = document.getElementById('wish-form');
const wishInput = document.getElementById('wish-input');
let wishResolve = null;

// Fenêtre de choix : renvoie le texte du vœu, ou null si annulé
function askWish(curio) {
  document.getElementById('wish-title').textContent = curio.name.replace(/^./, (c) => c.toUpperCase());
  const box = document.getElementById('wish-options');
  box.innerHTML = '';
  for (const w of curio.def?.wishes ?? ['Qu’elle ouvre enfin les yeux', 'Que mes amis soient heureux', 'Voyager encore plus loin']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wish-opt';
    b.textContent = w;
    b.addEventListener('click', () => closeWish(w));
    b.addEventListener('pointerenter', () => sfx.hover());
    box.appendChild(b);
  }
  wishInput.value = '';
  wishEl.classList.add('is-visible');
  wishEl.setAttribute('aria-hidden', 'false');
  setTimeout(() => box.firstChild?.focus({ preventScroll: true }), 80);
  return new Promise((r) => (wishResolve = r));
}

function closeWish(value) {
  if (!wishResolve) return;
  wishEl.classList.remove('is-visible');
  wishEl.setAttribute('aria-hidden', 'true');
  document.activeElement?.blur();
  const r = wishResolve;
  wishResolve = null;
  sfx.click();
  r(value);
}

wishForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = wishInput.value.trim();
  if (v) closeWish(v);
  else wishInput.focus();
});
document.getElementById('wish-cancel').addEventListener('click', () => closeWish(null));

// Fontaine : Lumi se penche, choisit un vœu, une étincelle file dans l'eau,
// la fontaine jaillit et le vœu monte vers le ciel en traînée de lumière.
async function makeWish(curio, text) {
  const level = game.level;
  beginCinematic();
  const saved = rig.read();
  const savedTarget = rig.target.clone();
  const basin = curio.prop.localToWorld(new THREE.Vector3(0, 0.2, 0));
  await twoShot(basin, { r: 3.6, up: 0.5 });
  if (game.level !== level) return;
  player.lean(basin, { reach: 0.35, lift: 0.05, tilt: 0.25 });
  dialogue.setCinema(false);
  const wish = await askWish(curio);
  dialogue.setCinema(true);
  if (game.level !== level) return;
  if (!wish) {
    player.unlean();
    return endCinematic(level, saved, savedTarget);
  }
  progress.setWish(level.def.id, wish);

  // étincelle : de Lumi à la fontaine, en arc
  const color = level.palette.biome.liquid[1];
  const spark = makeHalo(new THREE.Color(color).multiplyScalar(2), 0.6, 0.95);
  const from = player.root.position.clone();
  from.y += 0.9;
  scene.add(spark);
  sfx.tone({ freq: 880, type: 'sine', dur: 0.6, vol: 0.05, glide: 1.5, send: 0.8 });
  await new Promise((res) =>
    tweens.add({
      duration: 0.9,
      ease: (x) => x,
      onUpdate: (k) => {
        spark.position.lerpVectors(from, basin, k);
        spark.position.y += Math.sin(k * Math.PI) * 0.8;
        if (Math.random() < 0.5) particles.emit(spark.position, color, 1, { speed: 0.2, up: 0.2, life: 0.5, size: 3, gravity: 0 });
      },
      onComplete: res,
    }),
  );
  if (game.level !== level) return spark.removeFromParent();
  player.unlean();
  level.playCurio(curio);
  sfx.fountain();
  pad.rumble(0.2, 0.4, 300);
  particles.emit(basin, color, 40, { speed: 1.4, up: 3.4, life: 1.4, size: 4, gravity: -4 });
  particles.ring(basin, color, 26, 2, { size: 4, life: 0.8 });

  // le vœu s'élève vers le ciel ; la caméra le suit du regard
  const top = basin.clone();
  top.y += 7;
  rig.animateTo({ r: 4.4, phi: 1.32, theta: rig.read().theta, target: basin.clone().setY(basin.y + 2.2), duration: 2.4 });
  await new Promise((res) =>
    tweens.add({
      duration: 2.6,
      ease: ease.inCubic,
      onUpdate: (k) => {
        spark.position.lerpVectors(basin, top, k);
        spark.position.x += Math.sin(k * 9) * 0.12 * (1 - k);
        spark.scale.setScalar(0.6 + k * 0.6);
        if (Math.random() < 0.6) particles.emit(spark.position, color, 1, { speed: 0.3, up: -0.3, life: 0.8, size: 3, gravity: 0 });
      },
      onComplete: res,
    }),
  );
  particles.emit(top, 0xffffff, 30, { speed: 2.2, up: 0.5, life: 1.2, size: 4, gravity: 0 });
  sfx.discover();
  spark.removeFromParent();
  spark.material.dispose();
  if (game.level !== level) return;
  await playLines(curio, level, [
    { who: 'lumi', text: `« ${wish} »` },
    { who: 'souvenir', text },
  ]);
  await endCinematic(level, saved, savedTarget);
}

/* ═════════════ Points panoramiques ═════════════ */

const scope = document.getElementById('scope');
let skyView = null; // vue céleste en cours d'observation
const skyViews = new Map(); // id de curiosité → vue préparée (cachée)

// Construit les vues des longues-vues du niveau dès le chargement : leurs
// shaders sont ainsi préchauffés écran masqué (sinon gel au 1er affichage).
function prepareSkyViews(level) {
  const groups = [];
  for (const c of level.curios) {
    if (c.type !== 'U') continue;
    const v = createSkyView(c.def?.view ?? 'orion');
    v.reveal(1, 0); // tout visible pour le préchauffage
    v.group.position.set(0, -500, 0);
    v.group.visible = false;
    scene.add(v.group);
    skyViews.set(c.id, v);
    groups.push(v.group);
  }
  return groups;
}

function disposeSkyViews() {
  for (const v of skyViews.values()) {
    v.group.removeFromParent();
    v.dispose();
  }
  skyViews.clear();
}

function closeSkyView() {
  if (!skyView) return;
  skyView.group.visible = false;
  skyView = null;
  scope.classList.remove('is-on');
}

// Longue-vue, en trois plans :
// 1. profil : Lumi s'approche de l'oculaire et s'y colle ;
// 2. la caméra plonge dans l'oculaire (fondu au noir) ;
// 3. vue à travers la longue-vue : l'objet céleste apparaît, commenté.
// Retour : fondu, Lumi se redresse, puis cadrage de jeu.
async function observe(curio) {
  const level = game.level;
  beginCinematic();
  const saved = rig.read();
  const savedTarget = rig.target.clone();
  // oculaire : bout arrière du tube incliné (coordonnées locales de la longue-vue)
  const eyepiece = curio.prop.localToWorld(telescopeEyepiece());
  const base = curio.prop.getWorldPosition(new THREE.Vector3());
  const dir = curio.prop.getWorldDirection(new THREE.Vector3()).setY(0).normalize();

  // 1. Lumi s'approche de l'oculaire
  await twoShot(eyepiece, { r: 3.4, phi: 1.2, up: 0.35 });
  if (game.level !== level) return;
  player.lean(eyepiece, { reach: 0.5, lift: 0.18, tilt: 0.38 });
  sfx.tone({ freq: 1200, type: 'sine', dur: 0.12, vol: 0.03, send: 0.3 });
  await wait(900);
  if (game.level !== level) return;

  // 2. plongée dans l'oculaire
  const lp = player.root.position;
  const toEye = Math.atan2(eyepiece.x - lp.x, eyepiece.z - lp.z);
  // de profil, pour ne pas traverser Lumi collé à l'oculaire
  const side = Math.abs(Math.atan2(Math.sin(toEye + Math.PI / 2 - rig.read().theta), Math.cos(toEye + Math.PI / 2 - rig.read().theta))) < Math.PI / 2 ? 1 : -1;
  rig.animateTo({ r: 0.75, phi: 1.32, theta: toEye + (side * Math.PI) / 2, target: eyepiece, duration: 0.9 });
  await wait(500);
  if (game.level !== level) return;

  // 3. vue à travers la longue-vue
  // point de vue devant l'objectif (Lumi, collé à l'oculaire, reste hors champ)
  const eye = base.clone().addScaledVector(dir, 1.2);
  eye.y += 1.5;
  const target = base.clone().addScaledVector(dir, 26);
  target.y += 11;
  closeSkyView();
  skyView = skyViews.get(curio.id) ?? createSkyView(curio.def?.view ?? 'orion');
  const sv = skyView;
  if (!sv.group.parent) scene.add(sv.group);
  await cutTo(() => {
    player.root.visible = player.fx.visible = false;
    sv.group.visible = true;
    sv.group.position.copy(target);
    sv.group.lookAt(eye);
    sv.k = 0;
    sv.reveal(0, 0);
    const v = eye.clone().sub(target);
    const r = v.length();
    rig.target.copy(target);
    rig.set(r * 1.08, Math.acos(v.y / r), Math.atan2(v.x, v.z));
    dialogue.setCinema(false);
    scope.querySelector('.scope-title').textContent = curio.def?.title ?? curio.name;
    scope.classList.add('is-on');
  });
  if (game.level !== level) return;
  // léger zoom de mise au point + apparition progressive
  const v = eye.clone().sub(target);
  rig.animateTo({ r: v.length(), phi: Math.acos(v.y / v.length()), theta: Math.atan2(v.x, v.z), target, duration: 2.4, easing: ease.outCubic });
  sfx.discover();
  tweens.add({ duration: 3.2, ease: (x) => x, onUpdate: (k) => (sv.k = k) });
  await wait(900);
  await playLines(curio, level, curio.def?.lines ?? [{ who: 'lumi', text: 'Le ciel est immense, vu d’ici.' }], '#9fd8ff');
  if (game.level !== level) return;

  // retour : fondu, profil, Lumi se redresse
  await cutTo(() => {
    scope.classList.remove('is-on');
    closeSkyView();
    player.root.visible = player.fx.visible = true;
    dialogue.setCinema(true);
    const p = player.root.position.clone().lerp(eyepiece, 0.5);
    p.y += 0.35;
    rig.target.copy(p);
    let theta = toEye + Math.PI / 2;
    const diff = (a) => Math.abs(Math.atan2(Math.sin(a - saved.theta), Math.cos(a - saved.theta)));
    if (diff(theta + Math.PI) < diff(theta)) theta += Math.PI;
    rig.set(3.4, 1.2, theta);
  });
  player.unlean();
  await wait(500);
  await endCinematic(level, saved, savedTarget);
}

/* ═════════════ Monde-miroir ═════════════ */

let mirrorHold = false; // touches/stick à relâcher après un passage de miroir

// Traversée d'un portique-miroir : on passe dans le reflet (ou on en sort)
async function passMirror(tile) {
  const level = game.level;
  player.stop();
  const on = !level.mirrored;
  const p = level.worldOf(tile, new THREE.Vector3());
  p.y += 0.5;
  level.setMirrored(on, tile, (t, i, show) => {
    sfx.shimmer(i);
    const w = level.worldOf(t, new THREE.Vector3());
    particles.emit(w, show ? 0xaefcff : 0xffd47a, 10, { speed: 1.4, up: 1.2, life: 0.7, size: 4, gravity: -1.5 });
    pointer.refresh();
  });
  sfx.mirror(on);
  pad.rumble(0.3, 0.4, 220);
  rig.shake(0.05);
  particles.ring(p, 0xaefcff, 30, 2.6, { size: 4, life: 0.8 });
  particles.emit(p, 0xffffff, 28, { speed: 2, up: 1.2, life: 0.9, size: 4, gravity: -1 });
  ui.setMirror(on, true);
  keyboard.held.length = 0;
  mirrorHold = true;
  pointer.refresh();
  if (on) await tutorials.teach('mirror');
  if (game.level === level && playing()) hintOnce(on ? 'mirror' : 'unmirror', on ? '#9effe6' : 'var(--gold)');
}

// Reflet : un clic vise la case symétrique par rapport à Lumi
function mirrorTarget(tile) {
  const level = game.level;
  if (!level?.mirrored) return tile;
  const c = player.nextTile;
  return level.tileAt(2 * c.x - tile.x, 2 * c.z - tile.z);
}

// Parler au personnage voisin ou utiliser une curiosité (touche « interagir » / A)
function interact() {
  if (!playing() || player.moving || player.locked) return;
  const near = game.level.interactableNear(player.tile);
  if (near?.npc) startDialogue(near.npc);
  else if (near?.curio) useCurio(near.curio);
}

// Invite « Espace — Parler à … / Visiter la maison » quand Lumi est à côté
// d'un personnage ou d'une curiosité
const talkPrompt = document.getElementById('talk-prompt');
let promptTarget = null;
function setTalkPrompt(target) {
  if (target === promptTarget) return;
  promptTarget = target;
  talkPrompt.classList.toggle('is-visible', !!target);
  if (target) {
    const curio = target.type ? target : null;
    document.getElementById('talk-verb').textContent = curio ? CURIO_INFO[curio.type].verb : 'Parler à';
    document.getElementById('talk-name').textContent = curio ? curio.name : target.def.name.split(',')[0];
    document.getElementById('talk-key').textContent = pad.connected && document.body.classList.contains('pad-nav') ? 'A' : keyLabel(settings.get('bindings.interact'));
    if (curio && !tutorials.has('curio')) tutorials.teach('curio');
  }
}
talkPrompt.addEventListener('click', interact);

const shown = new Set(); // bulles d'aide déjà affichées pour ce niveau
function hintOnce(key, color) {
  const text = game.level.def.hints?.[key];
  if (!text || shown.has(game.level.def.id + key)) return;
  shown.add(game.level.def.id + key);
  ui.toast(text, { color });
}

// Plateforme mobile : courte pause, puis traversée (Lumi est entraîné)
async function ridePlatform(tile) {
  const level = game.level;
  player.locked = true;
  cursor.hide();
  await tutorials.teach('platform');
  setTimeout(() => {
    if (game.level !== level) return;
    const started = level.ride(tile, (dest) => {
      player.setTile(dest);
      player.locked = false;
      pad.rumble(0.25, 0.1, 80);
      pointer.refresh();
    });
    if (!started) {
      player.locked = false;
      return;
    }
    sfx.platform();
    pad.rumble(0.1, 0.25, 160);
    hintOnce('platform', 'var(--gold)');
  }, 260);
}

// Portail : Lumi se dissout, l'île pivote de 180°, il réapparaît sur l'autre face
async function flipIsland(tile) {
  const level = game.level;
  if (level.faces.length < 2) return;
  player.locked = true;
  player.stop();
  cursor.hide();
  await tutorials.teach('portal');
  if (game.level !== level) return;
  const p = level.worldOf(tile, new THREE.Vector3());
  p.y += 0.55;
  particles.emit(p, 0x9d7bff, 40, { speed: 2.2, up: 1.6, life: 1.1, size: 5, gravity: -0.8 });
  particles.ring(p, 0x5effd8, 26, 2.6, { size: 4, life: 0.7 });
  player.vanish();
  sfx.flip();
  pad.rumble(0.35, 0.6, 400);
  setTimeout(() => {
    if (game.level !== level) return;
    rig.shake(0.06);
    level.flip((portal) => {
      player.place(level, portal);
      player.locked = true;
      player.appear();
      const w = level.worldOf(portal, new THREE.Vector3());
      w.y += 0.55;
      particles.emit(w, 0x5effd8, 36, { speed: 2, up: 1.8, life: 1, size: 5, gravity: -1 });
      particles.ring(w, 0x9d7bff, 26, 2.4, { size: 4, life: 0.7 });
      rig.home(level, 1.0, () => {
        player.locked = false;
        pointer.refresh();
      });
      hintOnce('flip', 'var(--violet)');
    });
  }, 420);
}

function collectGem(tile) {
  const pos = game.level.collectGem(tile);
  if (!pos) return;
  const idx = game.gems++;
  sfx.gem(idx);
  pad.rumble(0.15, 0.5, 90);
  particles.emit(pos, COLORS.gem, 26, { speed: 2.6, up: 2.2, life: 1, size: 6, gravity: -3 });
  particles.ring(pos, COLORS.gem, 20, 2.4, { size: 4, life: 0.6 });
  screenV.copy(pos).project(camera);
  ui.flyGem((screenV.x * 0.5 + 0.5) * innerWidth, (-screenV.y * 0.5 + 0.5) * innerHeight, idx, game.level.gemTotal);
  setTimeout(() => playing() && tutorials.teach('gem'), 900);
  if (game.gems === game.level.gemTotal) {
    setTimeout(() => ui.toast('Tous les cristaux ! Il ne reste que la gemme.', { color: 'var(--cyan)' }), 900);
  }
}

function pressButton() {
  const level = game.level;
  tutorials.teach('button');
  sfx.button();
  pad.rumble(0.6, 0.35, 180);
  rig.shake(0.08);
  const p = level.button.getWorldPosition(new THREE.Vector3());
  p.y += 0.1;
  particles.ring(p, COLORS.button, 28, 3.2, { size: 5, life: 0.8 });
  particles.emit(p, COLORS.button, 14, { speed: 1.2, up: 2.2, life: 1, size: 5, gravity: -1 });
  if (level.def.hints?.button) ui.toast(level.def.hints.button, { color: 'var(--rose)' });
  level.activateBridges((tile, i) => {
    sfx.bridge(i);
    pad.rumble(0.05, 0.3, 60);
    rig.shake(0.04);
    particles.emit(level.worldOf(tile, new THREE.Vector3()), COLORS.button, 12, { speed: 1.8, up: 1.2, life: 0.7, size: 4, gravity: -2 });
    pointer.refresh();
  });
}

function completeLevel(tile) {
  const level = game.level;
  game.state = 'complete';
  const run = { gems: game.gems, steps: game.steps, time: game.time, curios: [...game.found] };
  const record = progress.complete(game.index, level.def.id, run, LEVELS.length);
  const best = progress.level(level.def.id);
  rig.setInteractive(false);
  cursor.hide();
  player.celebrate();
  level.collectStar();
  sfx.star();
  pad.rumble(0.8, 0.8, 420);
  rig.shake(0.1);
  const p = level.worldOf(tile, new THREE.Vector3());
  p.y += 0.6;
  const gemColor = level.palette.accent;
  particles.emit(p, gemColor, 60, { speed: 3.5, up: 3.2, life: 1.6, size: 7, gravity: -2.2 });
  particles.ring(p, gemColor, 36, 3.6, { size: 6, life: 1 });
  setTimeout(() => particles.emit(p.setY(p.y + 1), 0xffffff, 40, { speed: 2.5, up: 1.5, life: 1.8, size: 5, gravity: -0.5 }), 900);
  ui.hideToast();

  const s = rig.read();
  const focus = level.worldOf(tile, new THREE.Vector3());
  focus.y += 0.6;
  rig.animateTo({ r: rig.view.radius * 0.55, phi: Math.min(s.phi, 1.05), theta: s.theta + 0.5, target: focus, duration: 2.4 });
  setTimeout(() => {
    if (game.state !== 'complete') return;
    ui.showComplete(true, {
      def: level.def,
      gems: game.gems,
      total: level.gemTotal,
      steps: game.steps,
      time: game.time,
      curios: game.found.size,
      curioTotal: level.curioTotal,
      record,
      best,
      hasNext: game.index + 1 < LEVELS.length,
    });
    const outro = level.def.outro;
    const npcDef = level.def.npcs?.find((n) => n.id === outro?.who);
    if (outro && npcDef) voice.say(outro.text, speakerOf(npcDef), null, `${level.def.id}/outro`);
  }, 2300);
}

/* ═════════════ Entrées ═════════════ */

// Chemin vers une case ; pour un personnage ou une curiosité, vers la case
// voisine la plus proche
function pathTo(tile) {
  if (!tile.npc && !tile.curio) return findPath(game.level, player.nextTile, tile);
  let best = null;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = tile.layer.tileAt(tile.x + dx, tile.z + dz);
    if (!game.level.isWalkable(n)) continue;
    const p = findPath(game.level, player.nextTile, n);
    if (p && (!best || p.length < best.length)) best = p;
  }
  return best;
}

const pointer = new PointerInput({
  canvas,
  camera,
  enabled: () => playing() && !player.locked,
  level: () => game.level,
  pathTo,
  remap: mirrorTarget,
  onHover(tile, path, changed) {
    cursor.show(game.level, tile, !!path);
    cursor.showPath(game.level, player.nextTile, path);
    if (changed && path?.length) sfx.hover();
  },
  onHoverEnd: () => cursor.hide(),
  onSelect(tile, path) {
    const target = tile.npc ?? tile.curio;
    if (target && path) {
      cursor.click(game.level, tile, true);
      sfx.click();
      if (path.length) {
        pendingTalk = target;
        player.walk(path);
      } else if (tile.npc) startDialogue(tile.npc);
      else useCurio(tile.curio);
      return;
    }
    if (path?.length) {
      cursor.click(game.level, tile, true);
      sfx.click();
      player.walk(path);
    } else if (!path) {
      cursor.click(game.level, tile, false);
      sfx.deny();
    }
  },
});

// Fenêtre ou menu actif (pour la manette) ; null = en jeu
function activeContainer() {
  if (settingsPanel.isOpen) return document.getElementById('settings');
  for (const id of ['wish', 'levels', 'credits', 'complete', 'pause']) {
    const el = document.getElementById(id);
    if (el.classList.contains('is-visible')) return el;
  }
  return game.state === 'title' ? document.getElementById('title') : null;
}

const keyboard = new KeyboardInput({
  // Fenêtres et menus consomment les touches avant le jeu
  intercept(e) {
    if (tutorials.isOpen) {
      if (['Enter', 'Space', 'Escape'].includes(e.code) || settings.actionForCode(e.code) === 'interact') {
        e.preventDefault();
        tutorials.dismiss();
      }
      return true;
    }
    if (wishResolve) {
      // fenêtre de vœu : on laisse taper dans le champ ; Échap annule
      if (e.code === 'Escape') closeWish(null);
      return true;
    }
    if (game.state === 'dialogue') {
      if (dialogue.isOpen && (e.code === 'Space' || e.code === 'Enter' || settings.actionForCode(e.code) === 'interact')) {
        e.preventDefault();
        if (!e.repeat) dialogue.advance();
      } else if (e.code === 'Escape') dialogue.skip();
      return true;
    }
    if (settingsPanel.isOpen) {
      if (e.code === 'Escape') closeSettings();
      return true;
    }
    if (e.code === 'Escape') {
      if (game.state === 'title') ui.closeTopModal();
      else if (playing()) setPaused(true);
      else if (game.state === 'paused') setPaused(false);
      return true;
    }
    if (game.state === 'title') {
      if (ui.menuKey(e)) e.preventDefault();
      return true;
    }
    return false;
  },
  canMove: playing,
  onMoveKey: () => cursor.hide(),
  onAction(action) {
    if (action === 'mute') return toggleSound();
    if (action === 'perf') return settings.set('showFps', !settings.get('showFps'));
    if (!playing()) return;
    if (action === 'camLeft') rotateCamera(-1);
    else if (action === 'camRight') rotateCamera(1);
    else if (action === 'recenter') recenterCamera();
    else if (action === 'restart') goToLevel(game.index);
    else if (action === 'interact') interact();
  },
});

const pad = new PadController({
  container: activeContainer,
  playing,
  ui,
  settingsPanel,
  sfx,
  rig,
  cursor,
  actions: {
    pause: () => setPaused(true),
    resume: () => setPaused(false),
    closeSettings,
    rotate: rotateCamera,
    recenter: recenterCamera,
    restart: () => goToLevel(game.index),
    interact,
  },
  dialogue: { get isOpen() { return dialogue.isOpen; }, advance: () => dialogue.advance(), skip: () => dialogue.skip() },
  tutorial: { get isOpen() { return tutorials.isOpen; }, dismiss: () => tutorials.dismiss() },
});

// Pas au clavier / à la manette, relatif à l'orientation de la caméra
const fwd = new THREE.Vector3();
let bumpCooldown = 0;
function stepFromInput() {
  if (!playing() || player.moving || player.locked) return;
  const mv = keyboard.direction() ?? pad.moveDirection();
  // après un miroir, on attend que le joueur relâche avant de lire l'entrée inversée
  if (mirrorHold) {
    if (!mv) mirrorHold = false;
    return;
  }
  if (!mv) return;
  // reflet : commandes inversées (avant ↔ arrière, gauche ↔ droite)
  const k = game.level.mirrored ? -1 : 1;
  const f = mv[0] * k;
  const s = mv[1] * k;
  // L'orientation de la caméra est arrondie au quart de tour le plus proche :
  // « avant » et « droite » donnent toujours deux axes de grille perpendiculaires,
  // même quand la caméra est pile en diagonale (sinon les touches se confondaient).
  camera.getWorldDirection(fwd);
  const q = Math.round(Math.atan2(fwd.x, fwd.z) / (Math.PI / 2)) * (Math.PI / 2);
  const fx = Math.round(Math.sin(q));
  const fz = Math.round(Math.cos(q));
  // droite caméra = (-fz, fx)
  const mx = fx * f - fz * s;
  const mz = fz * f + fx * s;
  const dx = Math.abs(mx) >= Math.abs(mz) ? Math.sign(mx) : 0;
  const dz = dx ? 0 : Math.sign(mz);
  const cur = player.tile;
  const next = game.level.tileAt(cur.x + dx, cur.z + dz);
  if (next && game.level.canStep(cur, next)) {
    player.walk([next]);
  } else if (bumpCooldown <= 0) {
    player.bump(dx, dz);
    sfx.bump();
    pad.rumble(0.3, 0.05, 70);
    bumpCooldown = 0.35;
  }
}

window.addEventListener('resize', () => {
  if (game.state === 'title') rig.view.shift = isWide() ? 0.21 : 0;
  rig.resize(game.level, game.state !== 'title');
  gfx.resize();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && playing()) setPaused(true);
});

/* ═════════════ Boucle ═════════════ */

const timer = new THREE.Timer();
let gameTime = 0;
let shadowTrail = 0;
const carryV = new THREE.Vector3();
const sunPos = new THREE.Vector3();

function frame(timestamp) {
  const t0 = performance.now();
  timer.update(timestamp);
  let rawDt = timer.getDelta();
  if (frameLimiter.interval) {
    frameLimiter.acc += rawDt;
    // petite tolérance pour ne pas rater une image à cause de la gigue de rAF
    if (frameLimiter.acc < frameLimiter.interval * 0.92) return;
    rawDt = frameLimiter.acc;
    frameLimiter.acc = 0;
  }
  const dt = Math.min(rawDt, 1 / 20);
  const t = timer.getElapsed();
  const gdt = game.state === 'paused' || game.state === 'tutorial' ? 0 : dt;
  gameTime += gdt;
  stats.poll();
  quality.sample(rawDt);
  renderer.info.reset();

  tweens.update(gdt);
  if (playing()) {
    game.time += dt;
    ui.setTimer(game.time);
  }
  if (game.level && game.level.takeCarry(carryV).lengthSq() > 0) player.carry(carryV);
  if (game.state === 'title' && !rig.busy) {
    titleTheta += dt * 0.07;
    rig.set(rig.view.radius * 1.2, 1.08 + Math.sin(t * 0.2) * 0.04, titleTheta);
  } else rig.update(dt);

  pad.update(rawDt);
  bumpCooldown -= gdt;
  stepFromInput();

  sky.update(t, dt, camera);
  game.level?.update(gameTime, gdt);
  if (skyView) skyView.reveal(skyView.k ?? 0, t);
  player.update(gdt, gameTime);
  particles.update(gdt, t);
  cursor.update(t, dt);

  // Ombres : recalculées uniquement pendant les animations du niveau
  if (game.level?.animating > 0) shadowTrail = 2;
  if (shadowTrail > 0) {
    shadowTrail--;
    renderer.shadowMap.needsUpdate = true;
  }

  // Les god rays partent du cœur de la gemme du niveau
  const star = game.level?.star;
  sun.visible = !!star && gfx.godRaysOn;
  if (sun.visible) sun.position.copy(star.userData.spin.getWorldPosition(sunPos));

  globalUniforms.uTime.value = t;
  rig.beginShake(dt);
  stats.beginGPU();
  composer.render(dt);
  stats.endGPU();
  rig.endShake();

  stats.addFrame(rawDt * 1000, performance.now() - t0);
  perfHud.update(rawDt);
  const near = playing() && !player.moving && !player.locked && game.level ? game.level.interactableNear(player.tile) : null;
  setTalkPrompt(near?.npc ?? near?.curio ?? null);
  sfx.setCrackle?.(0.004 + Math.min(1, Math.hypot(player.vel.x, player.vel.z) / 4) * 0.01);
  settingsPanel.updateLive(rawDt);
}

/* ═════════════ Démarrage ═════════════ */

loadLevel(0);
enterTitle();
startLoop();

if (import.meta.env.DEV) {
  import('./dev/devtools.js').then(({ installDevtools }) =>
    installDevtools({ game, scene, composer, gfx, quality, settings, player, rig, tweens, goToLevel, pathTo, voice }),
  );
}

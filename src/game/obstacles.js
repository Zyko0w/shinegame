import * as THREE from 'three';
import { findPath } from './pathfinding.js';
import { ease } from '../core/tween.js';

// Déroulement des obstacles (blocs, vent, lave, dalles fragiles, plaques,
// rayons et miroirs, chutes) et des points de reprise.
// Le moteur (world/level.js) dit ce qui est possible ; ce module enchaîne les
// animations, les sons et le retour de Lumi à la dernière lanterne allumée.

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * @param {object} ctx  game, player, particles, sfx, ui, rig, pad, tweens,
 *                      playing(), refreshPointer(), hint(key, color), teach(id)
 */
export function createObstacles(ctx) {
  const { game, player, particles, sfx, ui, rig, pad, tweens } = ctx;
  const tmp = new THREE.Vector3();
  let pendingPush = null; // { block, dx, dz } : bloc vers lequel Lumi marche
  let pushedByWind = null; // { fall, from, dir } pendant une bourrasque
  let pendingRotate = null; // miroir vers lequel Lumi marche pour le tourner
  let lastTile = null; // case précédente (une dalle fragile cède quand on la quitte)
  let arrivedAt = 0; // instant d'arrivée sur la case courante (dalle fragile)
  let dying = false;
  const STAND_LIMIT = 1.6; // secondes avant qu'une dalle fragile cède sous Lumi

  const level = () => game.level;

  function reset() {
    pendingPush = null;
    pushedByWind = null;
    pendingRotate = null;
    lastTile = level().start;
    dying = false;
    game.checkpoint = level().start;
    game.falls = 0;
  }

  /* ───────────── Points de reprise ───────────── */

  // Lanterne : Lumi la rallume en passant, elle devient son point de reprise
  function reachLantern(tile) {
    if (tile.obj !== 'L' || game.checkpoint === tile) return;
    game.checkpoint = tile;
    level().lightLantern(tile);
    sfx.discover();
    tmp.copy(level().worldOf(tile, tmp));
    tmp.y += 0.5;
    particles.emit(tmp, 0xffc06a, 16, { speed: 1.2, up: 1.6, life: 0.9, size: 4, gravity: -1 });
    ctx.teach('lantern');
  }

  // Entrée sur une autre face (grotte, retournement) : nouveau point de reprise
  function setCheckpoint(tile) {
    game.checkpoint = tile;
  }

  /* ───────────── Blocs ───────────── */

  // Lumi (sur `from`) pousse le bloc de `tile` dans la direction (dx, dz)
  function push(from, tile, dx, dz) {
    const lv = level();
    const to = lv.pushBlock(tile, dx, dz, (dest, filled) => {
      if (game.level !== lv) return;
      if (filled) {
        sfx.land(2);
        rig.shake(0.05);
        pad.rumble(0.4, 0.3, 160);
        lv.worldOf(dest, tmp);
        particles.ring(tmp, 0xffc06a, 22, 2, { size: 4, life: 0.6 });
        particles.emit(tmp, 0xb8a890, 18, { speed: 1.4, up: 1.4, life: 0.8, size: 4, gravity: -3 });
        ctx.hint('filled', 'var(--gold)');
      }
      gates(player.tile);
      beams(lv.traceBeams());
      ctx.refreshPointer();
    });
    if (!to) return false;
    ctx.teach('block');
    sfx.bump();
    pad.rumble(0.35, 0.15, 120);
    player.walk([tile]); // Lumi suit le bloc
    return true;
  }

  // Essai de pas au clavier vers une case : renvoie true si un bloc a été poussé
  function tryStep(cur, next, dx, dz) {
    if (!next?.block) return false;
    return push(cur, next, dx, dz);
  }

  // Chemin vers un bloc cliqué : la case d'où on peut le pousser, la plus proche
  function pathToBlock(tile) {
    const lv = level();
    let best = null;
    for (const [dx, dz] of DIRS) {
      const stand = tile.layer.tileAt(tile.x - dx, tile.z - dz);
      if (!lv.isWalkable(stand) || !lv.pushTarget(tile, dx, dz)) continue;
      const p = findPath(lv, player.nextTile, stand);
      if (p && (!best || p.length < best.path.length)) best = { path: p, dx, dz };
    }
    return best;
  }

  // Chemin vers la case libre voisine la plus proche (miroir orientable)
  function pathBeside(tile) {
    const lv = level();
    let best = null;
    for (const [dx, dz] of DIRS) {
      const n = tile.layer.tileAt(tile.x + dx, tile.z + dz);
      if (!lv.isWalkable(n)) continue;
      const p = findPath(lv, player.nextTile, n);
      if (p && (!best || p.length < best.length)) best = p;
    }
    return best;
  }

  // Clic sur un bloc (on le pousse tout de suite, ou on va se placer derrière)
  // ou sur un miroir orientable (on le tourne, ou on va à côté)
  function select(tile) {
    if (tile.rotor) {
      const path = pathBeside(tile);
      if (!path) return false;
      if (!path.length) rotate(tile);
      else {
        pendingRotate = tile;
        player.walk(path);
      }
      return true;
    }
    const best = pathToBlock(tile);
    if (!best) return false;
    if (!best.path.length) push(player.tile, tile, best.dx, best.dz);
    else {
      pendingPush = { block: tile, dx: best.dx, dz: best.dz };
      player.walk(best.path);
    }
    return true;
  }

  /* ───────────── Miroirs et rayons ───────────── */

  function rotate(tile) {
    const lv = level();
    player.targetYaw = Math.atan2(tile.x - player.tile.x, tile.z - player.tile.z);
    sfx.mirror(true);
    pad.rumble(0.15, 0.2, 100);
    ctx.teach('beam');
    beams(lv.rotateMirror(tile));
  }

  // Récepteurs que le rayon vient d'atteindre : les ponts de lumière apparaissent
  function beams(lit) {
    if (!lit.length) return;
    const lv = level();
    sfx.button();
    rig.shake(0.06);
    pad.rumble(0.5, 0.3, 160);
    for (const r of lit) {
      lv.worldOf(r, tmp);
      tmp.y += 0.6;
      particles.ring(tmp, 0xffd47a, 30, 2.6, { size: 5, life: 0.8 });
    }
    ctx.hint('beam', 'var(--gold)');
    lv.activateBridges((t, i) => {
      sfx.bridge(i);
      particles.emit(lv.worldOf(t, new THREE.Vector3()), 0xffd47a, 12, { speed: 1.8, up: 1.2, life: 0.7, size: 4, gravity: -2 });
      ctx.refreshPointer();
    });
  }

  /* ───────────── Plaques ───────────── */

  // Met à jour les dalles-portes ; si elles se dérobent sous Lumi, il tombe
  function gates(playerTile) {
    const lv = level();
    const res = lv.updateGates(playerTile);
    if (!res) return;
    if (res === 'open') {
      ctx.teach('plate');
      sfx.bridge(0);
      ctx.hint('plate', '#9ff4ff');
    } else {
      sfx.whoosh(-2);
      if (player.tile.gate) fallOff([0, 0]);
    }
    ctx.refreshPointer();
  }

  /* ───────────── Dalles fragiles ───────────── */

  // Quitter une dalle fragile la fait céder ; arriver dessus la fait craquer
  function stepFragile(tile) {
    const lv = level();
    if (lastTile && lastTile !== tile && lastTile.fragile && !lastTile.crumbled && !lastTile.doomed) {
      const left = lastTile;
      // la dalle est condamnée tout de suite : plus aucun chemin ne peut y revenir
      // pendant qu'elle s'effondre (sinon Lumi tombait dans le trou)
      lv.doomFragile(left);
      setTimeout(() => {
        if (game.level !== lv || !left.doomed || !lv.crumble(left)) return;
        sfx.whoosh(-4);
        particles.emit(lv.worldOf(left, tmp), 0xb8a890, 14, { speed: 1.2, up: 0.6, life: 0.8, size: 4, gravity: -4 });
      }, 180);
    }
    if (tile.fragile) {
      ctx.teach('fragile');
      lv.crackFragile(tile, true);
      arrivedAt = lv.clock;
    }
    lastTile = tile;
  }

  /* ───────────── Vent ───────────── */

  function windPush(fan) {
    const lv = level();
    const { path, fall, from } = lv.windPath(player.tile, fan.dir);
    if (!path.length && !fall) return false;
    sfx.whoosh(0);
    pad.rumble(0.2, 0.3, 300);
    ctx.teach('wind');
    pendingPush = null;
    pushedByWind = { fall, from: from ?? path[path.length - 1] ?? player.tile, dir: fan.dir };
    if (path.length) {
      player.walk(path);
      player.locked = true;
    } else finishWind();
    return true;
  }

  function finishWind() {
    const w = pushedByWind;
    pushedByWind = null;
    player.locked = false;
    if (w.fall) fallOff(w.dir);
  }

  /* ───────────── Pertes ───────────── */

  // Lumi est emporté dans le vide : il bascule par-dessus le bord et chute
  function fallOff(dir) {
    if (dying) return;
    dying = true;
    player.stop();
    player.locked = true;
    sfx.whoosh(-3);
    const g = player.goal;
    const start = g.clone();
    tweens.add({
      duration: 1.1,
      ease: ease.inCubic,
      onUpdate: (k) => {
        g.x = start.x + dir[0] * Math.min(1, k * 3) * 0.9;
        g.z = start.z + dir[1] * Math.min(1, k * 3) * 0.9;
        g.y = start.y + Math.sin(Math.min(1, k * 3) * Math.PI) * 0.3 - k * k * 7;
      },
      onComplete: () => respawn('Lumi est tombé dans le vide…'),
    });
    setTimeout(() => player.vanish(), 600);
  }

  // Lumi touche la lave : il s'embrase et se dissout
  function burn() {
    if (dying) return;
    dying = true;
    player.stop();
    player.locked = true;
    sfx.deny();
    pad.rumble(0.7, 0.5, 260);
    rig.shake(0.06);
    tmp.copy(player.root.position);
    tmp.y += 0.4;
    particles.emit(tmp, 0xff6a2a, 40, { speed: 2.2, up: 2.6, life: 0.9, size: 5, gravity: -2 });
    particles.ring(tmp, 0xffb347, 24, 2.2, { size: 4, life: 0.6 });
    player.vanish();
    setTimeout(() => respawn('Aïe ! La lave a brûlé Lumi…'), 900);
  }

  // Retour à la dernière lanterne allumée (sur la face active)
  function respawn(message) {
    const lv = level();
    if (game.level !== lv) return;
    let at = game.checkpoint;
    if (!at || at.layer !== lv.face || !lv.isWalkable(at)) at = lv.face.cave ?? lv.face.portal ?? lv.start;
    lv.restoreFragile();
    player.place(lv, at);
    lastTile = at;
    pendingRotate = null;
    gates(at);
    player.appear();
    player.drop(1.4);
    game.falls++;
    dying = false;
    pushedByWind = null;
    pendingPush = null;
    lv.worldOf(at, tmp);
    particles.ring(tmp, 0xffc06a, 26, 2.2, { size: 4, life: 0.7 });
    sfx.land(1);
    const where = at.obj === 'L' ? 'à la lanterne' : at === lv.start ? 'au départ' : 'au point de reprise';
    ui.toast(`${message} Retour ${where}.`, { kind: 'warn', title: 'Oups !', duration: 3200 });
    ctx.refreshPointer();
  }

  /* ───────────── Branchements ───────────── */

  // Arrivée de Lumi sur une case (avant la logique habituelle de main.js).
  // Renvoie true si un obstacle a pris la main.
  function onArrive(tile, stopped) {
    if (dying) return true;
    const lv = level();
    reachLantern(tile);
    stepFragile(tile);
    gates(tile);
    if (dying) return true;
    if (tile.lava) ctx.teach('lava');
    if (lv.isScorching(tile)) {
      burn();
      return true;
    }
    if (pushedByWind) {
      if (player.queue.length === 0) finishWind();
      return true;
    }
    const fan = lv.windAt(tile);
    if (fan && windPush(fan)) return true;
    if (stopped && pendingRotate) {
      const m = pendingRotate;
      pendingRotate = null;
      if (Math.abs(m.x - tile.x) + Math.abs(m.z - tile.z) === 1) rotate(m);
      return true;
    }
    if (stopped && pendingPush) {
      const { block, dx, dz } = pendingPush;
      pendingPush = null;
      if (block.block && block.x - dx === tile.x && block.z - dz === tile.z) push(tile, block, dx, dz);
      return true;
    }
    return false;
  }

  // Chaque image : lave qui monte sous Lumi, bourrasque qui se lève sur lui
  function tick() {
    if (dying || !ctx.playing() || player.locked) return;
    const lv = level();
    const under = player.moving && player.segT > 0.5 ? player.target : player.tile;
    if (lv.isScorching(under)) return burn();
    // trop longtemps sur une dalle fragile : elle cède sous Lumi
    if (!player.moving && player.tile.fragile && !player.tile.crumbled && lv.clock - arrivedAt > STAND_LIMIT) {
      lv.crumble(player.tile);
      return fallOff([0, 0]);
    }
    if (!player.moving) {
      const fan = lv.windAt(player.tile);
      if (fan) windPush(fan);
    }
  }

  // Entrée sur une autre face : point de reprise et case courante
  function enterFace(tile) {
    setCheckpoint(tile);
    lastTile = tile;
  }

  return { reset, setCheckpoint: enterFace, tryStep, select, rotate, onArrive, tick, isBusy: () => dying || !!pushedByWind, pathToBlock, pathBeside };
}

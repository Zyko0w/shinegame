// Vérifie que chaque niveau est faisable, en simulant ses mécaniques :
// interrupteur → ponts, plateformes (deux stations), portails (deux faces).
// L'étoile ne doit pas être accessible sans l'interrupteur s'il y en a un.
import { LEVELS } from '../src/game/levels.js';

function parseFace(heights, objects, side) {
  const tiles = new Map();
  heights.forEach((row, z) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      const obj = objects[z]?.[x] ?? '.';
      tiles.set(`${side}:${x},${z}`, { side, x, z, h: +ch, obj, bridge: obj === '=', blocked: obj === 'T' });
    }),
  );
  return tiles;
}

function build(def) {
  const tiles = parseFace(def.heights, def.objects, 0);
  if (def.under) for (const [k, v] of parseFace(def.under.heights, def.under.objects, 1)) tiles.set(k, v);
  const platforms = (def.platforms ?? []).map((p) => {
    const s = p.side ?? 0;
    const a = { side: s, x: p.from[0], z: p.from[1], h: p.h, obj: '.', station: true };
    const b = { side: s, x: p.to[0], z: p.to[1], h: p.h, obj: '.', station: true };
    for (const t of [a, b]) {
      const k = `${s}:${t.x},${t.z}`;
      if (tiles.has(k)) throw new Error(`${def.id} : station de plateforme sur une case pleine (${k})`);
      tiles.set(k, t);
    }
    a.other = b;
    b.other = a;
    return [a, b];
  });
  for (const j of def.jumps ?? []) {
    const s0 = j.side ?? 0;
    const a = tiles.get(`${s0}:${j.from[0]},${j.from[1]}`);
    const b = tiles.get(`${s0}:${j.to[0]},${j.to[1]}`);
    if (!a || !b) throw new Error(`${def.id} : tremplin sur une case vide`);
    a.jumpTo = b;
  }
  for (const n of def.npcs ?? []) {
    const t = tiles.get(`${n.side ?? 0}:${n.at[0]},${n.at[1]}`);
    if (!t) throw new Error(`${def.id} : personnage ${n.id} sur une case vide`);
    t.blocked = true;
    t.npc = n.id;
  }
  return { tiles, platforms };
}

// Exploration : on considère les plateformes comme des liaisons a↔b
// (Lumi peut toujours faire venir la plateforme à lui en marchant dessus)
function reachable({ tiles }, start, bridgesOn) {
  const seen = new Set([start]);
  const q = [start];
  const ok = (t) => t && !t.blocked && (!t.bridge || bridgesOn);
  while (q.length) {
    const c = q.shift();
    const next = [];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = tiles.get(`${c.side}:${c.x + dx},${c.z + dz}`);
      if (ok(n) && Math.abs(n.h - c.h) <= 1) next.push(n);
    }
    if (c.station) next.push(c.other);
    if (c.jumpTo) next.push(c.jumpTo);
    if (c.obj === 'O') {
      const portal = [...tiles.values()].find((t) => t.obj === 'O' && t.side !== c.side);
      if (portal) next.push(portal);
    }
    for (const n of next) {
      if (!seen.has(n)) {
        seen.add(n);
        q.push(n);
      }
    }
  }
  return seen;
}

let ok = true;
for (const def of LEVELS) {
  const issues = [];
  try {
    const world = build(def);
    const all = [...world.tiles.values()];
    const start = all.find((t) => t.obj === 'P');
    const star = all.find((t) => t.obj === 'S');
    const button = all.find((t) => t.obj === 'B');
    if (def.under && all.filter((t) => t.obj === 'O').length !== 2) issues.push('il faut un portail O sur chaque face');
    const before = reachable(world, start, false);
    if (button && !before.has(button)) issues.push('interrupteur inaccessible');
    if (button && before.has(star)) issues.push("étoile accessible sans l'interrupteur");
    const after = reachable(world, start, true);
    if (!after.has(star)) issues.push('étoile inaccessible');
    all.filter((t) => t.obj === 'G' && !after.has(t)).forEach((g) => issues.push(`cristal (${g.side}:${g.x},${g.z}) inaccessible`));
    all.filter((t) => t.station && !after.has(t)).forEach((s) => issues.push(`station (${s.x},${s.z}) inaccessible`));
    // chaque personnage doit avoir au moins une case voisine accessible pour lui parler
    all.filter((t) => t.npc).forEach((n) => {
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => after.has(world.tiles.get(`${n.side}:${n.x + dx},${n.z + dz}`)));
      if (!near) issues.push(`personnage ${n.npc} injoignable`);
    });
  } catch (e) {
    issues.push(e.message);
  }
  console.log(`${issues.length ? '✗' : '✓'} ${def.name}${issues.length ? ' — ' + issues.join(', ') : ''}`);
  if (issues.length) ok = false;
}
process.exit(ok ? 0 : 1);

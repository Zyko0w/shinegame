// Vérifie que chaque niveau est faisable, en simulant ses mécaniques :
// interrupteur → ponts, plateformes (deux stations), portails (deux faces),
// monde-miroir (R bascule l'état ; + n'existe que dans le reflet, - hors du reflet),
// grottes (E relie la surface à l'intérieur, face 2), autels du sanctuaire
// (tous accessibles avant que la clé n'ouvre les ponts).
// L'étoile ne doit pas être accessible sans l'interrupteur / sans miroir
// s'il y en a un. Chaque curiosité doit avoir une case voisine accessible.
import { LEVELS } from '../src/game/levels.js';
import { BLOCKING, CURIOS } from '../src/game/tiles.js';

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function parseFace(def, heights, objects, side, issues) {
  const tiles = new Map();
  heights.forEach((row, z) => {
    if (objects[z] != null && objects[z].length > row.length && objects[z].slice(row.length).trim().replace(/\./g, '')) issues.push(`objet hors de l'île, rangée ${z}`);
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      const obj = objects[z]?.[x] ?? '.';
      tiles.set(`${side}:${x},${z}`, { side, x, z, h: +ch, obj, bridge: obj === '=', blocked: BLOCKING.has(obj) });
    });
    objects[z] &&
      [...objects[z]].forEach((o, x) => {
        if (o !== '.' && (row[x] ?? '.') === '.') issues.push(`objet « ${o} » sur une case vide (${side}:${x},${z})`);
      });
  });
  return tiles;
}

function build(def, issues) {
  const tiles = parseFace(def, def.heights, def.objects, 0, issues);
  if (def.under) for (const [k, v] of parseFace(def, def.under.heights, def.under.objects, 1, issues)) tiles.set(k, v);
  if (def.inside) for (const [k, v] of parseFace(def, def.inside.heights, def.inside.objects, 2, issues)) tiles.set(k, v);
  const platforms = (def.platforms ?? []).map((p) => {
    const s = p.side ?? 0;
    const a = { side: s, x: p.from[0], z: p.from[1], h: p.h, obj: '.', station: true };
    const b = { side: s, x: p.to[0], z: p.to[1], h: p.h, obj: '.', station: true };
    for (const t of [a, b]) {
      const k = `${s}:${t.x},${t.z}`;
      if (tiles.has(k)) throw new Error(`station de plateforme sur une case pleine (${k})`);
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
    if (!a || !b) throw new Error(`tremplin sur une case vide`);
    a.jumpTo = b;
  }
  for (const n of def.npcs ?? []) {
    const t = tiles.get(`${n.side ?? 0}:${n.at[0]},${n.at[1]}`);
    if (!t) throw new Error(`personnage ${n.id} sur une case vide`);
    t.blocked = true;
    t.npc = n.id;
  }
  for (const c of def.curios ?? []) {
    const t = tiles.get(`${c.side ?? 0}:${c.at[0]},${c.at[1]}`);
    if (!t || !CURIOS.has(t.obj)) issues.push(`texte de curiosité sans curiosité en (${c.at})`);
  }
  return { tiles, platforms };
}

// Exploration des états (case, dans le reflet ?). Les plateformes sont des
// liaisons a↔b (Lumi peut toujours faire venir la plateforme à lui).
function reachable({ tiles }, start, { bridgesOn, mirrors = true }) {
  const key = (t, m) => `${t.side}:${t.x},${t.z}:${m ? 1 : 0}`;
  const ok = (t, m) => t && !t.blocked && (!t.bridge || bridgesOn) && !(t.obj === '+' && !m) && !(t.obj === '-' && m);
  const seenStates = new Set([key(start, false)]);
  const seen = new Set([start]);
  const q = [[start, false]];
  while (q.length) {
    const [c, m] = q.shift();
    const next = [];
    for (const [dx, dz] of DIRS) {
      const n = tiles.get(`${c.side}:${c.x + dx},${c.z + dz}`);
      if (ok(n, m) && Math.abs(n.h - c.h) <= 1) next.push(n);
    }
    if (c.station) next.push(c.other);
    if (c.jumpTo) next.push(c.jumpTo);
    if (c.obj === 'E') {
      const exit = [...tiles.values()].find((t) => t.obj === 'E' && t.side !== c.side);
      if (exit) next.push(exit);
    }
    if (c.obj === 'O') {
      const portal = [...tiles.values()].find((t) => t.obj === 'O' && t.side !== c.side);
      if (portal) next.push(portal);
    }
    for (const n of next) {
      const nm = mirrors && n.obj === 'R' ? !m : m;
      const k = key(n, nm);
      if (seenStates.has(k)) continue;
      seenStates.add(k);
      seen.add(n);
      q.push([n, nm]);
    }
  }
  return seen;
}

let ok = true;
for (const def of LEVELS) {
  const issues = [];
  try {
    const world = build(def, issues);
    const all = [...world.tiles.values()];
    const start = all.find((t) => t.obj === 'P');
    const star = all.find((t) => t.obj === 'S');
    const button = all.find((t) => t.obj === 'B');
    const mirror = all.some((t) => t.obj === 'R');
    if (def.under && all.filter((t) => t.obj === 'O').length !== 2) issues.push('il faut un portail O sur chaque face');
    if (def.inside && (all.filter((t) => t.obj === 'E').length !== 2 || !all.some((t) => t.obj === 'E' && t.side === 2))) issues.push('il faut une entrée E à la surface et une dans la grotte');
    const altars = all.filter((t) => t.obj === 'Z');
    if (altars.length !== (def.altars ?? []).length) issues.push('autels Z et liste altars ne correspondent pas');
    for (const a of def.altars ?? []) if (!altars.some((t) => t.x === a.at[0] && t.z === a.at[1])) issues.push(`autel ${a.level} sans case Z`);
    for (const a of def.altars ?? []) if (!LEVELS.some((l) => l.id === a.level)) issues.push(`autel vers une île inconnue (${a.level})`);
    const before = reachable(world, start, { bridgesOn: false });
    altars.filter((t) => !before.has(t)).forEach((t) => issues.push(`autel (${t.x},${t.z}) inaccessible`));
    if (altars.length && before.has(star)) issues.push('porte accessible sans la clé');
    if (button && !before.has(button)) issues.push('interrupteur inaccessible');
    if (button && before.has(star)) issues.push("étoile accessible sans l'interrupteur");
    const after = reachable(world, start, { bridgesOn: true });
    if (!after.has(star)) issues.push('étoile inaccessible');
    if (mirror && reachable(world, start, { bridgesOn: true, mirrors: false }).has(star)) issues.push('étoile accessible sans passer de miroir');
    all.filter((t) => t.obj === 'G' && !after.has(t)).forEach((g) => issues.push(`cristal (${g.side}:${g.x},${g.z}) inaccessible`));
    all.filter((t) => t.station && !after.has(t)).forEach((s) => issues.push(`station (${s.x},${s.z}) inaccessible`));
    // personnages et curiosités : au moins une case voisine accessible
    const near = (n) => DIRS.some(([dx, dz]) => after.has(world.tiles.get(`${n.side}:${n.x + dx},${n.z + dz}`)));
    all.filter((t) => t.npc && !near(t)).forEach((n) => issues.push(`personnage ${n.npc} injoignable`));
    all.filter((t) => CURIOS.has(t.obj) && !near(t)).forEach((c) => issues.push(`curiosité ${c.obj} (${c.x},${c.z}) injoignable`));
    const curios = all.filter((t) => CURIOS.has(t.obj)).length;
    if (!issues.length) console.log(`✓ ${def.name} — ${all.length} cases, ${all.filter((t) => t.obj === 'G').length} cristaux, ${curios} curiosités`);
  } catch (e) {
    issues.push(e.message);
  }
  if (issues.length) {
    console.log(`✗ ${def.name} — ${issues.join(', ')}`);
    ok = false;
  }
}
process.exit(ok ? 0 : 1);

// Vérifie que chaque niveau est faisable, en simulant ses mécaniques :
// interrupteur → ponts, plateformes (deux stations), portails (deux faces),
// monde-miroir (R bascule l'état ; + n'existe que dans le reflet, - hors du reflet),
// grottes (E relie la surface à l'intérieur, face 2), autels du sanctuaire
// (tous accessibles avant que la clé n'ouvre les ponts), blocs à pousser
// (exploration façon Sokoban : un bloc comble fosse _ ou lave ~).
// Dalles fragiles (:) : une seule traversée. Dalles-portes (#) : ouvertes si
// chaque plaque (o) porte un bloc. Rayons : il doit exister une orientation des
// miroirs, atteignables, qui guide le rayon jusqu'au récepteur ($).
// Lave et vent sont des obstacles de timing : supposés franchissables.
// L'étoile ne doit pas être accessible sans l'interrupteur / sans miroir
// s'il y en a un. Chaque curiosité doit avoir une case voisine accessible.
import { LEVELS } from '../src/game/levels.js';
import { BLOCKING, CURIOS, PUSH_BLOCK, PIT, FRAGILE, PLATE, GATE, EMITTER, MIRRORS, RECEPTOR, FAN_DIRS, reflect, beamHeight, tileTop } from '../src/game/tiles.js';

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

// Exploration des états (case, reflet, blocs, fosses comblées). Les plateformes
// sont des liaisons a↔b (Lumi peut toujours faire venir la plateforme à lui).
const MAX_STATES = 400000;
function reachable({ tiles }, start, { bridgesOn, mirrors = true }) {
  const tk = (t) => `${t.side}:${t.x},${t.z}`;
  const at = (t, dx, dz) => tiles.get(`${t.side}:${t.x + dx},${t.z + dz}`);
  // D et _ changent pendant la partie : seuls les autres objets bloquent pour de bon
  const fixedBlock = (t) => t.blocked && t.obj !== PUSH_BLOCK && t.obj !== PIT;
  const isPit = (t, st) => t.obj === PIT && !st.filled.has(tk(t));
  const plates = [...tiles.values()].filter((t) => t.obj === PLATE).map(tk);
  const gatesOpen = (st) => plates.length > 0 && plates.every((k) => st.blocks.has(k));
  const ok = (t, m, st) =>
    t &&
    !fixedBlock(t) &&
    !st.blocks.has(tk(t)) &&
    !isPit(t, st) &&
    !st.broken.has(tk(t)) &&
    !(t.obj === GATE && !gatesOpen(st)) &&
    (!t.bridge || bridgesOn) &&
    !(t.obj === '+' && !m) &&
    !(t.obj === '-' && m);
  // mêmes règles que Level.pushTarget
  const pushTo = (b, dx, dz, st) => {
    const n = at(b, dx, dz);
    if (!n || n.npc || CURIOS.has(n.obj) || n.obj === 'Z' || n.station || n.jumpTo) return null;
    if (isPit(n, st)) return n.h <= b.h ? n : null;
    if (fixedBlock(n) || st.blocks.has(tk(n)) || n.bridge) return null;
    const obj = n.obj === PUSH_BLOCK || n.obj === PIT ? '.' : n.obj;
    if (!['.', 'M', 'C', '~', PLATE].includes(obj)) return null;
    return n.h <= b.h && b.h - n.h <= 1 ? n : null;
  };
  const blocks0 = new Set([...tiles.values()].filter((t) => t.obj === PUSH_BLOCK).map(tk));
  const stateKey = (t, m, st) => `${tk(t)}|${m ? 1 : 0}|${[...st.blocks].sort()}|${[...st.filled].sort()}|${[...st.broken].sort()}`;
  const first = { t: start, m: false, blocks: blocks0, filled: new Set(), broken: new Set() };
  const seenStates = new Set([stateKey(start, false, first)]);
  const seen = new Set([start]);
  const q = [first];
  for (let head = 0; head < q.length; head++) {
    if (q.length > MAX_STATES) throw new Error('trop d’états à explorer (blocs ?)');
    const st = q[head];
    const c = st.t;
    const next = [];
    for (const [dx, dz] of DIRS) {
      const n = at(c, dx, dz);
      if (!n || Math.abs(n.h - c.h) > 1) continue;
      if (st.blocks.has(tk(n))) {
        // pousser le bloc : il glisse ou comble une fosse / de la lave
        const to = pushTo(n, dx, dz, st);
        if (!to) continue;
        const blocks = new Set(st.blocks);
        blocks.delete(tk(n));
        const filled = new Set(st.filled);
        if (isPit(to, st) || to.obj === '~') filled.add(tk(to));
        else blocks.add(tk(to));
        next.push({ t: n, blocks, filled });
      } else if (ok(n, st.m, st)) next.push({ t: n, blocks: st.blocks, filled: st.filled });
    }
    const jump = (t) => next.push({ t, blocks: st.blocks, filled: st.filled });
    if (c.station) jump(c.other);
    if (c.jumpTo) jump(c.jumpTo);
    if (c.obj === 'E') {
      const exit = [...tiles.values()].find((t) => t.obj === 'E' && t.side !== c.side);
      if (exit) jump(exit);
    }
    if (c.obj === 'O') {
      const portal = [...tiles.values()].find((t) => t.obj === 'O' && t.side !== c.side);
      if (portal) jump(portal);
    }
    const broken = c.obj === FRAGILE ? new Set([...st.broken, tk(c)]) : st.broken;
    for (const n of next) {
      n.broken = n.t === c ? st.broken : broken;
      const nm = mirrors && n.t.obj === 'R' ? !st.m : st.m;
      const k = stateKey(n.t, nm, n);
      if (seenStates.has(k)) continue;
      seenStates.add(k);
      seen.add(n.t);
      q.push({ ...n, m: nm });
    }
  }
  return seen;
}

// Le rayon peut-il atteindre un récepteur ? On essaie toutes les orientations
// des miroirs ; ceux qu'il faut tourner doivent avoir une case voisine accessible.
function beamSolvable(def, { tiles }, reach) {
  const all = [...tiles.values()];
  const mirrorsList = all.filter((t) => MIRRORS.has(t.obj));
  const emitters = all.filter((t) => t.obj === EMITTER);
  if (mirrorsList.length > 12) throw new Error('trop de miroirs');
  const reachable = (t) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => reach.has(tiles.get(`${t.side}:${t.x + dx},${t.z + dz}`)));
  for (let mask = 0; mask < 1 << mirrorsList.length; mask++) {
    const orient = new Map(mirrorsList.map((m, i) => [m, mask & (1 << i) ? (m.obj === '/' ? '\\' : '/') : m.obj]));
    if (mirrorsList.some((m, i) => mask & (1 << i) && !reachable(m))) continue;
    for (const e of emitters) {
      const b = (def.beams ?? []).find((b) => b.at[0] === e.x && b.at[1] === e.z && (b.side ?? 0) === e.side);
      let [dx, dz] = FAN_DIRS[b?.dir] ?? [1, 0];
      const y = beamHeight(e.h);
      let x = e.x;
      let z = e.z;
      for (let i = 0; i < 40; i++) {
        x += dx;
        z += dz;
        const t = tiles.get(`${e.side}:${x},${z}`);
        if (!t || t.bridge || t.obj === GATE || t.obj === '+') continue;
        if (tileTop(t.h) > y) break;
        if (orient.has(t)) {
          [dx, dz] = reflect(orient.get(t), [dx, dz]);
          continue;
        }
        if (t.obj === RECEPTOR) return true;
        if (t.blocked) break;
      }
    }
  }
  return false;
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
    if (all.some((t) => t.obj === RECEPTOR) && !beamSolvable(def, world, before)) issues.push('rayon impossible à guider jusqu’au récepteur');
    if (all.some((t) => t.obj === EMITTER) && !(def.beams ?? []).length) issues.push('émetteur sans direction (beams)');
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

// Vérifie que chaque niveau est faisable : étoile accessible seulement
// après l'interrupteur (s'il y en a un), et tous les cristaux atteignables.
import { LEVELS } from '../src/game/levels.js';

function parse(def) {
  const tiles = new Map();
  def.heights.forEach((row, z) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      const obj = def.objects[z]?.[x] ?? '.';
      tiles.set(`${x},${z}`, { x, z, h: +ch, obj, active: obj !== '=' });
    }),
  );
  return tiles;
}

function reachable(tiles, start) {
  const seen = new Set([start]);
  const q = [start];
  while (q.length) {
    const c = q.shift();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = tiles.get(`${c.x + dx},${c.z + dz}`);
      if (n && n.active && !seen.has(n) && Math.abs(n.h - c.h) <= 1) {
        seen.add(n);
        q.push(n);
      }
    }
  }
  return seen;
}

let ok = true;
for (const def of LEVELS) {
  const tiles = parse(def);
  const all = [...tiles.values()];
  const start = all.find((t) => t.obj === 'P');
  const star = all.find((t) => t.obj === 'S');
  const button = all.find((t) => t.obj === 'B');
  const before = reachable(tiles, start);
  const issues = [];
  if (button && !before.has(button)) issues.push('interrupteur inaccessible');
  if (button && before.has(star)) issues.push("étoile accessible sans l'interrupteur");
  all.forEach((t) => (t.active = true));
  const after = reachable(tiles, start);
  if (!after.has(star)) issues.push('étoile inaccessible');
  all.filter((t) => t.obj === 'G' && !after.has(t)).forEach((g) => issues.push(`cristal (${g.x},${g.z}) inaccessible`));
  console.log(`${issues.length ? '✗' : '✓'} ${def.name}${issues.length ? ' — ' + issues.join(', ') : ''}`);
  if (issues.length) ok = false;
}
process.exit(ok ? 0 : 1);

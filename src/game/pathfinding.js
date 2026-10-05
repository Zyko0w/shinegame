// BFS sur la grille (coût uniforme) — les niveaux sont petits,
// on peut recalculer à chaque survol sans souci.

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function findPath(level, start, goal) {
  if (!start || !goal || !level.isWalkable(goal)) return null;
  if (start === goal) return [];

  const prev = new Map();
  prev.set(start, null);
  const queue = [start];
  let head = 0;

  while (head < queue.length) {
    const cur = queue[head++];
    if (cur === goal) break;
    for (const [dx, dz] of DIRS) {
      const next = level.tileAt(cur.x + dx, cur.z + dz);
      if (!next || prev.has(next) || !level.canStep(cur, next)) continue;
      prev.set(next, cur);
      queue.push(next);
    }
  }

  if (!prev.has(goal)) return null;
  const path = [];
  for (let t = goal; t !== start; t = prev.get(t)) path.push(t);
  return path.reverse();
}

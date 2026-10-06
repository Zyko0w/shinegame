// Miniature isométrique d'une île, dessinée en SVG à partir de sa grille
// de hauteurs et de la palette de son émotion (léger, net, sans WebGL).

const hsl = ([h, s, l], dl = 0) => `hsl(${(h * 360).toFixed(0)} ${(s * 100).toFixed(0)}% ${Math.max(2, (l + dl) * 100).toFixed(0)}%)`;

export function islandSVG(def, palette) {
  const W = 10; // demi-largeur d'une case à l'écran
  const D = 5; // demi-profondeur
  const H = 3.2; // hauteur d'un demi-bloc
  const tiles = [];
  def.heights.forEach((row, z) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      tiles.push({ x, z, h: +ch, obj: def.objects[z]?.[x] ?? '.' });
    }),
  );
  for (const p of def.platforms ?? []) tiles.push({ x: p.from[0], z: p.from[1], h: p.h, obj: 'platform' });
  // ordre du peintre : de l'arrière vers l'avant
  tiles.sort((a, b) => a.x + a.z - (b.x + b.z) || a.h - b.h);

  const top = palette.top;
  const side = palette.side;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const parts = [];
  const pt = (x, y) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };

  for (const t of tiles) {
    const cx = (t.x - t.z) * W;
    const cy = (t.x + t.z) * D;
    const ty = cy - (t.h + 1) * H; // altitude du dessus
    const by = cy; // base de l'île
    const bridge = t.obj === '=' || t.obj === '+' || t.obj === '-';
    const plank = t.obj === 'K';
    const plat = t.obj === 'platform';
    if (!bridge && !plat && !plank) {
      // stalactite sous la colonne
      parts.push(`<polygon points="${pt(cx - W, by)} ${pt(cx, by + D)} ${pt(cx, by + D + 6 + ((t.x * 7 + t.z * 3) % 5) * 2.4)}" fill="${hsl(side, -0.04)}"/>`);
      parts.push(`<polygon points="${pt(cx, by + D)} ${pt(cx + W, by)} ${pt(cx, by + D + 4 + ((t.x * 3 + t.z * 5) % 4) * 2.4)}" fill="${hsl(side, -0.07)}"/>`);
      // flancs gauche / droit
      parts.push(`<polygon points="${pt(cx - W, ty)} ${pt(cx, ty + D)} ${pt(cx, by + D)} ${pt(cx - W, by)}" fill="${hsl(side, 0.06)}"/>`);
      parts.push(`<polygon points="${pt(cx, ty + D)} ${pt(cx + W, ty)} ${pt(cx + W, by)} ${pt(cx, by + D)}" fill="${hsl(side, 0.01)}"/>`);
    }
    // dessus
    const liquid = t.obj === 'V' ? '#' + palette.biome.liquid[1].toString(16).padStart(6, '0') : null;
    const fill = plat ? '#e9b45e' : plank ? '#8a6242' : bridge ? 'none' : liquid ?? hsl(top, (t.x + t.z) % 2 ? 0.03 : 0.07);
    const dash = { '=': '#ff7ab8', '+': '#9ef4ff', '-': '#ffd47a' }[t.obj];
    const stroke = bridge ? ` stroke="${dash}" stroke-width="0.8" stroke-dasharray="1.6 1.6"` : '';
    parts.push(`<polygon points="${pt(cx, ty - D)} ${pt(cx + W, ty)} ${pt(cx, ty + D)} ${pt(cx - W, ty)}" fill="${fill}"${stroke}/>`);
    if (t.obj === 'T') parts.push(`<circle cx="${cx}" cy="${ty - 6}" r="4.2" fill="${'#' + palette.leaves[0].toString(16).padStart(6, '0')}"/>`);
    if (t.obj === 'S') parts.push(`<path class="pv-star" d="M${cx} ${ty - 15}l2.2 5 5.4.6-4 3.6 1.2 5.3L${cx} ${ty - 4.8}l-4.8 2.7 1.2-5.3-4-3.6 5.4-.6z" fill="#ffd47a"/>`);
    if (t.obj === 'G') parts.push(`<path d="M${cx} ${ty - 9}l3 4-3 5-3-5z" fill="#8ff6ff"/>`);
    if (t.obj === 'H') parts.push(`<path d="M${cx - 4} ${ty - 1}v-5l4-3.5 4 3.5v5z" fill="#efe2c8"/><path d="M${cx - 5} ${ty - 6}l5-4.5 5 4.5" fill="none" stroke="${'#' + palette.leaves[0].toString(16).padStart(6, '0')}" stroke-width="1.6"/>`);
    if (t.obj === 'Y') parts.push(`<path d="M${cx - 2} ${ty}l.8-9h2.4l.8 9z" fill="#efe2c8"/><path d="M${cx - 5} ${ty - 13}l10 8M${cx + 5} ${ty - 13}l-10 8" stroke="#c9a878" stroke-width="1.1"/>`);
    if (t.obj === 'R') parts.push(`<path d="M${cx - 3.5} ${ty}v-7a3.5 3.5 0 0 1 7 0v7" fill="rgba(200,250,255,.35)" stroke="#d9f6ff" stroke-width="1.1"/>`);
    if (t.obj === 'O') parts.push(`<ellipse cx="${cx}" cy="${ty - 5}" rx="3" ry="4.5" fill="none" stroke="#b49bff" stroke-width="1.4"/>`);
  }
  const pad = 6;
  const vb = `${(minX - pad).toFixed(0)} ${(minY - pad - 10).toFixed(0)} ${(maxX - minX + pad * 2).toFixed(0)} ${(maxY - minY + pad * 2 + 10).toFixed(0)}`;
  return `<svg class="island-pv" viewBox="${vb}" aria-hidden="true">${parts.join('')}</svg>`;
}

import './docs.css';
import { progress } from '../core/progress.js';
import { paletteOf } from '../game/moods.js';
import { EMOTIONS } from '../world/npc.js';

// Documentation (menu d'accueil) : l'histoire, les pièges avec un aperçu animé
// en boucle, et les esprits de l'Archipel (cachés tant que leur île est
// verrouillée). Les aperçus sont de petites scènes SVG isométriques animées en
// CSS (voir style.css, « Documentation ») : aucun coût pour la scène 3D.

const $ = (id) => document.getElementById(id);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

/* ───────────── Mini-scènes isométriques ───────────── */

// Case (i, j) de la grille → centre du losange à l'écran
const iso = (i, j, h = 0) => [80 + (i - j) * 22, 52 + (i + j) * 11 - h * 10];

function tile(i, j, { top = '#3d3566', side = '#221d3d', h = 0, cls = '', depth = 12 } = {}) {
  const [x, y] = iso(i, j, h);
  return `<g class="${cls}">
    <path d="M${x - 22} ${y}l22 11v${depth}l-22 -11z" fill="${side}"/>
    <path d="M${x + 22} ${y}l-22 11v${depth}l22 -11z" fill="${side}" opacity=".75"/>
    <path d="M${x} ${y - 11}l22 11-22 11-22 -11z" fill="${top}"/>
  </g>`;
}

// Lumi : petite flamme turquoise (position = case)
function lumi(i, j, cls = 'd-lumi', h = 0) {
  const [x, y] = iso(i, j, h);
  return `<g class="${cls}"><g transform="translate(${x} ${y - 4})">
    <ellipse cx="0" cy="3" rx="6" ry="2" fill="#000" opacity=".3"/>
    <path d="M0 -14c5 4 7 8 6 11a6 6 0 0 1-12 0c-1-3 1-7 6-11z" fill="#5effd8"/>
    <circle cx="-2" cy="-4" r="1" fill="#0b0918"/><circle cx="2" cy="-4" r="1" fill="#0b0918"/>
  </g></g>`;
}

const svg = (body) => `<svg viewBox="0 0 160 110" aria-hidden="true">${body}</svg>`;

const TRAPS = [
  {
    id: 'lava',
    name: 'Coulées de lave',
    where: 'Forge d’Antarès',
    text: 'La croûte se traverse quand elle est sombre. Quand elle rougeoie, la lave monte et brûle : il faut passer au bon moment.',
    art: () => svg(`${tile(0, 1)}${tile(1, 1, { cls: 'd-lava', top: '#2a0e10' })}${tile(2, 1, { cls: 'd-lava d-lava2', top: '#2a0e10' })}${tile(3, 1)}${lumi(0, 1, 'd-lumi d-cross')}`),
  },
  {
    id: 'wind',
    name: 'Éoliennes',
    where: 'Véga · Lyra · Alcor · Mérope',
    text: 'Elles soufflent par intervalles. Dans leur couloir, Lumi est poussé jusqu’au premier obstacle… ou dans le vide.',
    art: () => {
      const [fx, fy] = iso(0, 1);
      return svg(`${tile(0, 1)}${tile(1, 1)}${tile(2, 1)}
        <g transform="translate(${fx} ${fy - 14})"><rect x="-3" y="2" width="6" height="12" fill="#2a2440"/><g class="d-blades"><path d="M0 0l2-9h-4zM0 0l9 2v-4zM0 0l-2 9h4zM0 0l-9-2v4z" fill="#d8e4ff"/></g></g>
        <g class="d-gust" stroke="#dff4ff" stroke-width="1.5" stroke-linecap="round" opacity=".8"><path d="M44 46h14M52 56h18M40 62h12"/></g>
        ${lumi(1, 1, 'd-lumi d-blown')}`);
    },
  },
  {
    id: 'pit',
    name: 'Fosses et blocs',
    where: 'Orion · Andromède · Bételgeuse · Mérope',
    text: 'Un trou dans le sol barre la route. Pousse le bloc runique dedans : il le comble et devient un passage.',
    art: () => {
      const [px, py] = iso(2, 1);
      return svg(`${tile(0, 1)}${tile(1, 1)}${tile(3, 1)}
        <path d="M${px} ${py - 11}l22 11-22 11-22 -11z" fill="#07060f" stroke="#ffc06a" stroke-dasharray="3 2" stroke-width=".8"/>
        <g class="d-block">${tile(1, 1, { top: '#8c86a8', side: '#4a4566', h: 1.6, depth: 16 })}</g>
        ${lumi(0, 1, 'd-lumi d-pusher')}`);
    },
  },
  {
    id: 'fragile',
    name: 'Dalles fragiles',
    where: 'Véga · Andromède',
    text: 'Elles s’effondrent dès que Lumi les quitte : on ne les traverse qu’une fois. Et pas question de s’y attarder.',
    art: () =>
      svg(`${tile(0, 1)}${[1, 2, 3].map((i) => `<g class="d-fragile d-f${i}">${tile(i, 1, { top: '#6a6080', side: '#3a3352', depth: 5 })}</g>`).join('')}${tile(4, 1)}${lumi(0, 1, 'd-lumi d-hurry')}`),
  },
  {
    id: 'plate',
    name: 'Plaques de pression',
    where: 'Archipel de Lyra',
    text: 'Les dalles bleues n’existent que tant que la plaque est enfoncée. Lumi ne peut pas rester dessus et traverser : il faut y laisser un bloc.',
    art: () => {
      const [px, py] = iso(1, 0);
      return svg(`${tile(0, 1)}${tile(1, 1)}${tile(1, 0)}${tile(4, 1)}
        <path class="d-plate" d="M${px} ${py - 6}l12 6-12 6-12 -6z" fill="#3fd8ff"/>
        ${[2, 3].map((i) => `<g class="d-gate">${tile(i, 1, { top: '#8fe8ff', side: '#2b7d96', depth: 5 })}</g>`).join('')}
        <g class="d-block2">${tile(1, 0, { top: '#8c86a8', side: '#4a4566', h: 1.6, depth: 16 })}</g>
        ${lumi(1, 1, 'd-lumi d-gatewalk')}`);
    },
  },
  {
    id: 'beam',
    name: 'Rayons et miroirs',
    where: 'Galerie d’Alcor',
    text: 'Tourne les miroirs pour guider le rayon jusqu’au récepteur : un pont de lumière apparaît. Un bloc sur son trajet l’arrête.',
    art: () => {
      const [ex, ey] = iso(0, 2);
      const [mx, my] = iso(3, 2);
      const [rx, ry] = iso(3, 0);
      return svg(`${[0, 1, 2, 3].map((i) => tile(i, 2)).join('')}${tile(3, 1)}${tile(3, 0)}
        <circle cx="${ex}" cy="${ey - 10}" r="4" fill="#ffd47a"/>
        <path class="d-beam1" d="M${ex} ${ey - 10}L${mx} ${my - 10}" stroke="#ffe7a8" stroke-width="2"/>
        <path class="d-beam2" d="M${mx} ${my - 10}L${rx} ${ry - 10}" stroke="#ffe7a8" stroke-width="2"/>
        <g transform="translate(${mx} ${my - 10})"><rect class="d-mirror" x="-1.5" y="-9" width="3" height="18" fill="#e8fff8"/></g>
        <circle class="d-receptor" cx="${rx}" cy="${ry - 10}" r="5" fill="#6a6480"/>`);
    },
  },
];

/* ───────────── Esprits ───────────── */

function flame(color, deep, cls) {
  return `<svg viewBox="0 0 60 70" aria-hidden="true" class="${cls}" style="--c:${color};--d:${deep}">
    <defs><radialGradient id="g-${cls}-${color.slice(1)}" cx=".5" cy=".65" r=".6"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="${color}"/><stop offset="1" stop-color="${deep}"/></radialGradient></defs>
    <ellipse cx="30" cy="64" rx="12" ry="3" fill="#000" opacity=".35"/>
    <g class="d-body"><path d="M30 6c10 10 16 20 14 31a14 14 0 0 1-28 0c-2-11 4-21 14-31z" fill="url(#g-${cls}-${color.slice(1)})"/>
    <circle cx="25" cy="38" r="2.2" fill="#0b0918"/><circle cx="35" cy="38" r="2.2" fill="#0b0918"/>
    <path d="M26 45q4 3 8 0" stroke="#0b0918" stroke-width="1.6" fill="none" stroke-linecap="round"/></g>
  </svg>`;
}

// Comportement de la flamme selon l'émotion (classe d'animation CSS)
const MOTION = { fear: 'shake', anger: 'flare', sad: 'droop', shame: 'hide', lonely: 'drift', envy: 'glance', bitter: 'sulk', hope: 'glow', wonder: 'bounce' };

function spirits(levels) {
  const cards = [
    { name: 'Lumi', emotion: 'Sa dernière petite flamme', color: '#5effd8', deep: '#2a8f9f', motion: 'bounce', place: 'Partout', quote: 'Alors je vais les chercher. Toutes. Et on la réveillera.', open: true },
  ];
  levels.forEach((l, i) => {
    for (const n of l.npcs ?? []) {
      const emo = EMOTIONS[n.emotion] ?? EMOTIONS.wonder;
      cards.push({
        name: n.name,
        emotion: paletteOf(l.mood).label,
        color: hex(emo.color),
        deep: hex(emo.deep),
        motion: MOTION[n.emotion] ?? 'bounce',
        place: l.name,
        quote: n.lines[0]?.text ?? '',
        open: progress.isUnlocked(i),
        index: i,
      });
    }
  });
  return cards
    .map((c) =>
      c.open
        ? `<article class="doc-card doc-spirit"><div class="doc-art">${flame(c.color, c.deep, `m-${c.motion}`)}</div>
            <div><p class="doc-kicker" style="color:${c.color}">${c.emotion}</p><h3>${c.name}</h3><p class="doc-where">${c.place}</p><p class="doc-quote">« ${c.quote.replace(/[«»]/g, '').trim()} »</p></div></article>`
        : `<article class="doc-card doc-spirit is-locked"><div class="doc-art">${flame('#3a3550', '#1a1730', 'm-locked')}</div>
            <div><p class="doc-kicker">esprit inconnu</p><h3>???</h3><p class="doc-where">Rejoins l’île n° ${c.index + 1} pour le rencontrer.</p></div></article>`,
    )
    .join('');
}

/* ───────────── Histoire ───────────── */

function lore(levels) {
  const list = levels
    .map((l, i) => {
      const p = paletteOf(l.mood);
      return `<li style="--mood:${p.accent}"><span class="doc-num">${String(i + 1).padStart(2, '0')}</span><span><strong>${l.name}</strong><em>${p.label}</em></span></li>`;
    })
    .join('');
  return `
    <p class="doc-lead">Quelqu’un dort et ne se réveille plus. Enfermée dans sa propre tête, elle s’est perdue entre ses sentiments.</p>
    <p>Chacun de ses sentiments est devenu une <strong>île flottante</strong> de l’Archipel des émotions, gardée par un <strong>esprit</strong> : l’Émerveillement, la Tristesse, la Solitude, la Peur, la Rancœur, la Colère, la Jalousie, la Honte… Au bout de chaque île brille la <strong>gemme</strong> de cette émotion, que son esprit garde jalousement.</p>
    <p><strong>Lumi</strong> est sa dernière petite flamme : la part d’elle qui veut encore ouvrir les yeux. Île après île, Lumi écoute les esprits, comprend ce qu’ils protègent, et rapporte leur gemme.</p>
    <p>Au bout de l’Archipel se trouve <strong>la Passerelle</strong>, un sanctuaire gardé par Polaris, l’Espoir. Sur ses huit autels, les gemmes réunies forgent la <strong>Clé du Réveil</strong>, qui ouvre la porte vers le matin. Aucun sentiment n’est de trop : il les faut tous, même ceux qu’on préférerait cacher.</p>
    <h3 class="doc-sub">Les îles</h3>
    <ol class="doc-islands">${list}</ol>
    <h3 class="doc-sub">À ramasser</h3>
    <p><strong>Cristaux</strong> : facultatifs, pour finir une île à 100 %. <strong>Curiosités</strong> (maisons, longues-vues, cloches, fontaines…) : des souvenirs à découvrir. <strong>Lanternes</strong> : en passant, Lumi les rallume ; il y revient s’il tombe.</p>`;
}

/* ───────────── Fenêtre ───────────── */

export class Docs {
  constructor(levels, { onClose, hoverSound } = {}) {
    this.levels = levels;
    this.onClose = onClose;
    this.root = $('docs');
    this.tabs = [...this.root.querySelectorAll('.tab')];
    this.tabs.forEach((t) => {
      t.addEventListener('click', () => this.showTab(t.dataset.tab));
      t.addEventListener('pointerenter', () => hoverSound?.());
    });
    this.root.querySelector('.tabs').addEventListener('keydown', (e) => {
      if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
      const i = this.tabs.findIndex((t) => t.dataset.tab === this.tab);
      const next = this.tabs[(i + (e.code === 'ArrowRight' ? 1 : -1) + this.tabs.length) % this.tabs.length];
      this.showTab(next.dataset.tab);
      next.focus();
      e.preventDefault();
    });
    $('btn-docs-close').addEventListener('click', () => this.close());
    $('doc-traps').innerHTML = TRAPS.map(
      (t) => `<article class="doc-card doc-trap doc-${t.id}"><div class="doc-art">${t.art()}</div>
        <div><h3>${t.name}</h3><p class="doc-where">${t.where}</p><p>${t.text}</p></div></article>`,
    ).join('');
    this.showTab('lore');
  }

  get isOpen() {
    return this.root.classList.contains('is-visible');
  }

  open() {
    // histoire et esprits suivent la progression (îles débloquées)
    $('doc-lore').innerHTML = lore(this.levels);
    $('doc-spirits').innerHTML = spirits(this.levels);
    this.root.classList.add('is-visible');
    this.root.setAttribute('aria-hidden', 'false');
    setTimeout(() => this.tabs.find((t) => t.dataset.tab === this.tab)?.focus({ preventScroll: true }), 60);
  }

  close() {
    if (!this.isOpen) return;
    this.root.classList.remove('is-visible');
    this.root.setAttribute('aria-hidden', 'true');
    this.onClose?.();
  }

  showTab(name) {
    this.tab = name;
    this.tabs.forEach((t, i) => {
      const on = t.dataset.tab === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on) this.root.querySelector('.tab-ink').style.transform = `translateX(${i * 100}%)`;
    });
    this.root.querySelectorAll('.panel').forEach((p) => (p.hidden = p.id !== `docpanel-${name}`));
    this.root.querySelector('.panels').scrollTop = 0;
  }
}

import { keyLabel, settings } from '../core/settings.js';

// Fiches « Nouvelle mécanique » : affichées la première fois qu'une
// mécanique est utilisée (jeu en pause), puis plus jamais — sauf si le joueur
// demande à les revoir (Paramètres > Commandes).

const KEY = 'shine:learned';
const $ = (id) => document.getElementById(id);
const k = (action) => `<kbd>${keyLabel(settings.get(`bindings.${action}`))}</kbd>`;

const ICONS = {
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  talk: '<path d="M4 5h16v10H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  gem: '<path d="M12 3l7 7-7 11-7-11z"/><path d="M5 10h14M9 10l3-7 3 7-3 11"/>',
  button: '<circle cx="12" cy="14" r="6"/><path d="M12 8V3M8 5l4-2 4 2"/>',
  platform: '<rect x="4" y="10" width="16" height="5" rx="1.5"/><path d="M7 18v2M17 18v2M2 7h4M18 7h4M6 7l-2-2M18 7l2-2"/>',
  portal: '<ellipse cx="12" cy="12" rx="6" ry="9"/><path d="M12 7a5 5 0 0 1 0 10"/><path d="M3 12h3M18 12h3"/>',
  trampoline: '<path d="M4 18h16M6 18l2-5h8l2 5"/><path d="M12 13V4M9 7l3-3 3 3"/>',
};

// Contenu des fiches (les touches affichées suivent les réglages du joueur)
function card(id) {
  switch (id) {
    case 'move':
      return {
        title: 'Se déplacer',
        html: `Clique ou touche une case : Lumi s'y rend tout seul. Au clavier : ${k('up')} ${k('left')} ${k('down')} ${k('right')} ou les flèches ; à la manette : le stick gauche.<br>Lumi ne grimpe qu'<strong>une marche à la fois</strong>. Glisse pour tourner autour de l'île, molette pour zoomer, ${k('camLeft')} ${k('camRight')} pour pivoter.`,
      };
    case 'talk':
      return {
        title: 'Parler aux esprits',
        html: `Approche-toi d'un esprit et appuie sur ${k('interact')}, clique dessus ou utilise <kbd>A</kbd> à la manette. Les esprits racontent l'histoire de leur île… et glissent souvent un indice.`,
      };
    case 'gem':
      return {
        title: 'Cristaux d’étoile',
        html: `Les cristaux sont <strong>facultatifs</strong> : l'étoile suffit pour finir le niveau. Ramasse-les tous pour le terminer à 100 %.`,
      };
    case 'button':
      return {
        title: 'Interrupteurs',
        html: `Marcher sur un interrupteur fait apparaître des <strong>dalles de lumière</strong> : un nouveau chemin s'ouvre. Repère les contours roses qui annoncent où elles vont surgir.`,
      };
    case 'platform':
      return {
        title: 'Plateforme mobile',
        html: `Arrête-toi sur la <strong>dalle dorée</strong> : elle t'emporte de l'autre côté du vide en suivant les pointillés. Elle fonctionne dans les deux sens.`,
      };
    case 'portal':
      return {
        title: 'Portail de retournement',
        html: `Le portail fait <strong>pivoter l'île de 180°</strong> : tu continues sur sa face cachée, avec ses propres chemins. Un autre portail te ramène de l'autre côté.`,
      };
    case 'trampoline':
      return {
        title: 'Tremplin',
        html: `Arrête-toi sur un tremplin pour être <strong>projeté vers l'île</strong> indiquée par l'arc de pointillés. Attention : on ne revient pas toujours en arrière, ramasse ce que tu veux avant de sauter !`,
      };
    default:
      return null;
  }
}

function load() {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY)) ?? []);
  } catch {
    return new Set();
  }
}

export class Tutorials {
  constructor({ sfx, onOpen, onClose }) {
    this.sfx = sfx;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.learned = load();
    this.el = $('tutorial');
    this.queue = Promise.resolve();
    this.resolve = null;
    $('tuto-ok').addEventListener('click', () => this.dismiss());
  }

  get isOpen() {
    return !!this.resolve;
  }

  has(id) {
    return this.learned.has(id);
  }

  // Affiche la fiche si la mécanique est nouvelle ; résolu à la fermeture
  teach(id) {
    if (this.learned.has(id) || !card(id)) return Promise.resolve();
    this.learned.add(id);
    this.save();
    this.queue = this.queue.then(() => this.open(id));
    return this.queue;
  }

  open(id) {
    const c = card(id);
    $('tuto-icon').innerHTML = ICONS[id] ?? '';
    $('tuto-title').textContent = c.title;
    $('tuto-text').innerHTML = c.html;
    this.el.classList.add('is-visible');
    this.el.setAttribute('aria-hidden', 'false');
    this.sfx.init();
    [72, 76, 79].forEach((n, i) => this.sfx.tone({ freq: 440 * 2 ** ((n - 69) / 12), type: 'sine', dur: 0.5, vol: 0.04, when: i * 0.07, send: 0.6 }));
    this.onOpen?.();
    setTimeout(() => $('tuto-ok').focus({ preventScroll: true }), 80);
    return new Promise((resolve) => (this.resolve = resolve));
  }

  dismiss() {
    if (!this.resolve) return;
    this.el.classList.remove('is-visible');
    this.el.setAttribute('aria-hidden', 'true');
    const r = this.resolve;
    this.resolve = null;
    this.sfx.click?.();
    this.onClose?.();
    r();
  }

  reset() {
    this.learned.clear();
    this.save();
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify([...this.learned]));
    } catch {
      /* stockage indisponible */
    }
  }
}

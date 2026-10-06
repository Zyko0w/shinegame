import { keyLabel, settings } from '../core/settings.js';

// Fiches « Nouvelle mécanique » : affichées la première fois qu'une
// mécanique est utilisée (jeu en pause), puis plus jamais — sauf si le joueur
// demande à les revoir (Paramètres > Commandes).

const KEY = 'shine:learned';
const $ = (id) => document.getElementById(id);
// (libellé échappé : une touche comme « < » casserait le HTML de la fiche)
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const k = (action) => `<kbd>${escapeHtml(keyLabel(settings.get(`bindings.${action}`)))}</kbd>`;

const ICONS = {
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  talk: '<path d="M4 5h16v10H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  gem: '<path d="M12 3l7 7-7 11-7-11z"/><path d="M5 10h14M9 10l3-7 3 7-3 11"/>',
  button: '<circle cx="12" cy="14" r="6"/><path d="M12 8V3M8 5l4-2 4 2"/>',
  platform: '<rect x="4" y="10" width="16" height="5" rx="1.5"/><path d="M7 18v2M17 18v2M2 7h4M18 7h4M6 7l-2-2M18 7l2-2"/>',
  portal: '<ellipse cx="12" cy="12" rx="6" ry="9"/><path d="M12 7a5 5 0 0 1 0 10"/><path d="M3 12h3M18 12h3"/>',
  trampoline: '<path d="M4 18h16M6 18l2-5h8l2 5"/><path d="M12 13V4M9 7l3-3 3 3"/>',
  mirror: '<path d="M12 3v18"/><path d="M8 8l-4 4 4 4M16 8l4 4-4 4"/>',
  curio: '<path d="M4 11l8-6 8 6v9H4z"/><path d="M10 20v-5h4v5"/>',
  cave: '<path d="M3 20c0-8 4-14 9-14s9 6 9 14"/><path d="M8 20c0-4 2-7 4-7s4 3 4 7"/><path d="M12 3v3"/>',
  block: '<path d="M4 9h11v11H4z"/><path d="M15 14h6M18 11l3 3-3 3"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
  lava: '<path d="M3 18c3-2 4 2 7 0s4 2 7 0 3 0 4 0"/><path d="M8 13c0-3 2-4 2-7 2 2 4 4 4 7a3 3 0 0 1-6 0z"/>',
  lantern: '<path d="M9 4h6M10 4v2M14 4v2"/><path d="M8 6h8l-1 12H9z"/><path d="M12 10v4"/>',
  fragile: '<path d="M4 10h16v5H4z"/><path d="M9 10l2 3-2 2M15 10l-1 3 2 2"/><path d="M7 18l-1 3M17 18l1 3"/>',
  plate: '<rect x="5" y="14" width="14" height="4" rx="1"/><path d="M8 14v-2h8v2"/><path d="M12 9V3M9 6l3 3 3-3"/>',
  beam: '<path d="M3 6h9l6 6v9"/><path d="M14 4l6 6"/><circle cx="18" cy="21" r="1.5"/>',
  altar: '<path d="M12 3l4 5-4 6-4-6z"/><path d="M6 17h12M8 17v4h8v-4"/>',
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
        title: 'Cristaux et gemmes',
        html: `Les cristaux sont <strong>facultatifs</strong> : seule la <strong>gemme de l'émotion</strong>, au bout de l'île, est nécessaire pour finir le niveau. Ramasse les cristaux pour le terminer à 100 %.`,
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
    case 'mirror':
      return {
        title: 'Portique-miroir',
        html: `Traverser un miroir te fait passer <strong>dans le reflet</strong> : tes <strong>commandes sont inversées</strong> (gauche ↔ droite, avant ↔ arrière, et un clic t'envoie à l'opposé de la case visée).<br>Dans le reflet, les <strong>dalles argentées</strong> apparaissent et les <strong>dalles dorées</strong> s'effacent. Retraverse un miroir pour revenir.`,
      };
    case 'curio':
      return {
        title: 'Curiosités',
        html: `Maisons, moulins, cloches, fontaines, panneaux… Approche-toi et appuie sur ${k('interact')} (ou clique dessus). Elles sont <strong>facultatives</strong>, mais chaque découverte compte dans tes statistiques du niveau.`,
      };
    case 'cave':
      return {
        title: 'Grotte',
        html: `Arrête-toi sur l'<strong>entrée de la grotte</strong> : Lumi plonge et atterrit <strong>à l'intérieur de l'île</strong>, une caverne avec ses propres chemins.<br>Pour remonter, arrête-toi dans le <strong>puits de lumière</strong> qui tombe du plafond.`,
      };
    case 'altar':
      return {
        title: 'Autels des sentiments',
        html: `Chaque autel attend la <strong>gemme d'une île</strong>. Marche dessus pour l'y déposer.<br>Quand les <strong>huit gemmes</strong> sont réunies, elles forgent la <strong>Clé du Réveil</strong>.`,
      };
    case 'block':
      return {
        title: 'Blocs à pousser',
        html: `Marche contre un <strong>bloc runique</strong> (ou clique dessus) pour le pousser d'une case. Il glisse sur le plat et descend d'une marche.<br>Pousse-le dans une <strong>fosse</strong> ou sur de la <strong>lave</strong> : il la comble et devient un passage. Bloqué ? ${k('restart')} recommence le niveau.`,
      };
    case 'wind':
      return {
        title: 'Bourrasques',
        html: `Les <strong>éoliennes</strong> soufflent par intervalles. Dans leur couloir, Lumi est <strong>poussé</strong> jusqu'au premier obstacle… ou <strong>dans le vide</strong>.<br>Observe leur rythme et traverse quand elles se calment.`,
      };
    case 'lava':
      return {
        title: 'Coulées de lave',
        html: `La croûte de lave se traverse quand elle est <strong>sombre</strong>. Quand elle <strong>rougeoie</strong>, la lave monte et <strong>brûle</strong> : file avant qu'elle ne s'embrase !`,
      };
    case 'lantern':
      return {
        title: 'Lanternes',
        html: `En passant près d'une <strong>lanterne</strong>, Lumi la rallume : c'est son <strong>point de reprise</strong>. S'il tombe ou se brûle, il y revient.`,
      };
    case 'fragile':
      return {
        title: 'Dalles fragiles',
        html: `Ces dalles fissurées <strong>s'effondrent dès que Lumi les quitte</strong> : on ne les traverse qu'une fois.<br>Et ne t'y attarde pas : au bout d'un instant, elles cèdent <strong>sous ses pieds</strong>. Elles se reforment si Lumi retourne à une lanterne.`,
      };
    case 'plate':
      return {
        title: 'Plaques de pression',
        html: `Les <strong>dalles bleues</strong> n'existent que tant que <strong>toutes les plaques</strong> sont enfoncées. Lumi seul ne suffit pas : dès qu'il quitte la plaque, elles disparaissent.<br>Pousse un <strong>bloc</strong> sur la plaque pour la garder enfoncée.`,
      };
    case 'beam':
      return {
        title: 'Rayons et miroirs',
        html: `Un cristal projette un <strong>rayon de lumière</strong>. Approche-toi d'un miroir et appuie sur ${k('interact')} (ou clique dessus) pour le <strong>faire pivoter</strong>.<br>Guide le rayon jusqu'au <strong>récepteur</strong> : il fera naître un pont. Un bloc sur son trajet l'arrête.`,
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

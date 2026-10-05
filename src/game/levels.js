// Format des niveaux
// heights : une chaîne par rangée (axe Z), un caractère par colonne (axe X).
//   '.'      = vide
//   '0'..'9' = hauteur de la colonne (en demi-blocs). Lumi ne saute pas :
//              il ne franchit qu'un écart de hauteur de 1 (une marche).
// objects : même grille.
//   P = départ de Lumi        S = étoile (fin du niveau)
//   G = cristal (optionnel)   B = interrupteur
//   = = dalle de pont (apparaît quand l'interrupteur est pressé)
//   M = champignons lumineux  L = lanterne  C = cristaux de décor
//
// hints : bulles d'aide contextuelles.

export const LEVELS = [
  {
    id: 'orion',
    name: "Jardin d'Orion",
    subtitle: 'Premiers pas dans le vide',
    heights: [
      '2222...666.',
      '2222...666.',
      '2223...566.',
      '2224...4...',
      '12222223...',
      '1122...2222',
      '0012...2222',
      '00.....2222',
    ],
    objects: [
      'B.M....L.S.',
      '...........',
      '.........C.',
      '...G.......',
      '..P.===....',
      '.M.....M...',
      '.........L.',
      'G......C..G',
    ],
    hints: {
      start: 'Clique sur une case pour guider Lumi. Glisse pour tourner autour du monde.',
      button: 'Un pont de lumière se forme…',
    },
  },
  {
    id: 'vega',
    name: 'Tour de Véga',
    subtitle: "L'escalier qui flotte",
    heights: [
      '4567...',
      '3..8...',
      '2..9..2',
      '1..9..1',
      '0000000',
    ],
    objects: [
      '.G.....',
      'M..=...',
      '...=..G',
      '...S..L',
      'G..P..B',
    ],
    hints: {
      start: 'Les marches manquent tout là-haut. Il doit bien y avoir un interrupteur…',
      button: "L'escalier se complète dans le ciel.",
    },
  },
];

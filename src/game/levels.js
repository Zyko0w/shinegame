// ─────────────────────────────────────────────────────────────────────────────
// L'ARCHIPEL DES ÉMOTIONS
// Les étoiles de l'Archipel se sont éteintes une à une, chacune noyée dans
// une émotion que personne n'a su apaiser. Lumi, petit feu follet cosmonaute,
// part les rallumer. Sur chaque île l'attend l'esprit de cette émotion.
// ─────────────────────────────────────────────────────────────────────────────
//
// Format des niveaux
// heights : une chaîne par rangée (axe Z), un caractère par colonne (axe X).
//   '.' = vide · '0'..'9' = hauteur de la colonne (demi-blocs). Lumi ne saute
//   pas tout seul : il ne franchit qu'une marche (écart de 1).
// objects : même grille.
//   P = départ   S = étoile (fin)   G = cristal   B = interrupteur
//   = = dalle de pont (apparaît avec l'interrupteur)
//   O = portail de retournement   T = arbre (bloque la case)
//   M = champignons  L = lanterne  C = cristaux  W = cascade (décor)
// under     : face cachée { heights, objects } (vue une fois l'île retournée).
// platforms : [{ side, from: [x, z], to: [x, z], h }] plateforme mobile.
// jumps     : [{ side, from: [x, z], to: [x, z] }] tremplin (case de départ → arrivée).
// npcs      : [{ id, at: [x, z], side, name, emotion, voice, lines, repeat }]
//   lines : [{ who, text }] — `who` = id du personnage ou 'lumi'.
// mood      : émotion du chapitre (couleur du ciel, musique, esprit).
// outro     : citation affichée et dite à la fin du niveau.

// Voix de Lumi (les personnages ont la leur)
export const LUMI_VOICE = { name: 'Lumi', color: '#5effd8', pitch: 1.6, rate: 1.08, voiceIndex: 1 };

export const LEVELS = [
  {
    id: 'orion',
    name: "Jardin d'Orion",
    chapter: 'Prologue · L’Émerveillement',
    subtitle: 'Premiers pas dans le vide',
    mood: 'wonder',
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
      'B.MT...L.S.',
      '...........',
      '.........C.',
      '...G.......',
      '..P.===....',
      'WM.....M..T',
      '.........LW',
      'G......C..G',
    ],
    npcs: [
      {
        id: 'orion',
        name: 'Orion, le vieux gardien',
        emotion: 'wonder',
        at: [1, 4],
        voice: { pitch: 0.65, rate: 0.88, voiceIndex: 0 },
        lines: [
          { who: 'orion', text: 'Oh ! Une petite flamme… avec un casque ? Bienvenue dans l’Archipel, voyageur.' },
          { who: 'orion', text: 'Je suis Orion. Autrefois, chaque île brillait sous sa propre étoile.' },
          { who: 'orion', text: 'Mais elles se sont éteintes, une à une. Chacune s’est noyée dans une émotion que personne n’a su apaiser.' },
          { who: 'lumi', text: 'Et si je les rallumais ?' },
          { who: 'orion', text: 'Ta flamme est jeune, mais elle tient bon. Commence ici : l’interrupteur, là-haut, fera naître un pont de lumière.' },
        ],
        repeat: [{ who: 'orion', text: 'Le pont attend ton pas, petite flamme. L’étoile est de l’autre côté.' }],
      },
    ],
    outro: { who: 'orion', text: 'Une étoile rallumée… Va. D’autres îles t’attendent, et leurs gardiens aussi.' },
    hints: {
      start: 'Clique sur une case pour guider Lumi. Approche-toi d’Orion pour lui parler.',
      button: 'Un pont de lumière se forme…',
    },
  },
  {
    id: 'vega',
    name: 'Tour de Véga',
    chapter: 'Chapitre I · La Tristesse',
    subtitle: "L'escalier qui flotte",
    mood: 'sad',
    heights: [
      '4567...',
      '3..8...',
      '2..9..2',
      '1..90.1',
      '0000000',
    ],
    objects: [
      '.G.....',
      'M..=...',
      'W..=..G',
      '...S..L',
      'G..P..B',
    ],
    npcs: [
      {
        id: 'mira',
        name: 'Mira',
        emotion: 'sad',
        at: [4, 3],
        voice: { pitch: 1.25, rate: 0.86, voiceIndex: 1 },
        lines: [
          { who: 'mira', text: 'Ne fais pas attention à moi… Je pleure tout le temps, maintenant.' },
          { who: 'mira', text: 'Mon étoile a glissé du haut de la tour. Je n’ai pas su la retenir.' },
          { who: 'mira', text: 'Chaque larme a éteint une marche de l’escalier. Il n’en reste presque plus.' },
          { who: 'lumi', text: 'On peut peut-être les faire revenir ?' },
          { who: 'mira', text: 'On raconte qu’un interrupteur, en bas, se souvient de toutes les marches… Moi, je n’ai plus la force d’y aller.' },
        ],
        repeat: [{ who: 'mira', text: 'Les marches reviendront… si quelqu’un y croit à ma place.' }],
      },
    ],
    outro: { who: 'mira', text: 'Elle brille encore… La tristesse ne s’efface pas, mais elle peut laisser passer la lumière.' },
    hints: {
      start: 'Les marches manquent tout là-haut. Il doit bien y avoir un interrupteur…',
      button: "L'escalier se complète dans le ciel.",
    },
  },
  {
    id: 'lyra',
    name: 'Archipel de Lyra',
    chapter: 'Chapitre II · La Solitude',
    subtitle: 'Le bac des étoiles',
    mood: 'lonely',
    heights: [
      '333....333',
      '343....323',
      '333....333',
      '2.......3.',
      '1.......4.',
      '00......56',
    ],
    objects: [
      'T......C.T',
      '.G......GW',
      '..M......L',
      '..........',
      '..........',
      'PG.......S',
    ],
    platforms: [{ side: 0, from: [3, 1], to: [6, 1], h: 3 }],
    npcs: [
      {
        id: 'lyre',
        name: 'Lyre, le passeur',
        emotion: 'lonely',
        at: [2, 0],
        voice: { pitch: 0.9, rate: 0.92, voiceIndex: 2 },
        lines: [
          { who: 'lyre', text: 'Ah… un visiteur. Ça faisait si longtemps que je ne parlais qu’aux étoiles.' },
          { who: 'lyre', text: 'Je fais traverser le bac d’une île à l’autre. Mais plus personne ne vient.' },
          { who: 'lyre', text: 'Les îles se sont éloignées, tu sais. Comme les gens, quand on cesse de se rendre visite.' },
          { who: 'lumi', text: 'Alors je traverse… et je reviendrai te voir.' },
          { who: 'lyre', text: 'Arrête-toi sur la dalle dorée. Elle connaît le chemin.' },
        ],
        repeat: [{ who: 'lyre', text: 'La dalle dorée t’attend. Elle n’aime pas rester seule, elle non plus.' }],
      },
    ],
    outro: { who: 'lyre', text: 'Tu es allé jusqu’au bout… La solitude se dissout dès qu’un pont existe, même tout petit.' },
    hints: {
      start: 'Arrête-toi sur la plateforme dorée : elle te portera de l’autre côté.',
      platform: 'En route vers l’autre île…',
    },
  },
  {
    id: 'andromede',
    name: "Miroir d'Andromède",
    chapter: 'Chapitre III · La Peur',
    subtitle: "L'île à deux visages",
    mood: 'fear',
    heights: [
      '..333.',
      '..2.3.',
      '012.33',
      '00...3',
      '0000.3',
    ],
    objects: [
      '....M.',
      '....G.',
      'C.....',
      '......',
      'P..G.O',
    ],
    under: {
      heights: [
        '456..0',
        '3....0',
        '2...11',
        '1...1.',
        '00000.',
      ],
      objects: [
        '..S..O',
        'L.....',
        '....C.',
        '....G.',
        '..G...',
      ],
    },
    npcs: [
      {
        id: 'andra',
        name: 'Andra',
        emotion: 'fear',
        at: [1, 3],
        voice: { pitch: 1.45, rate: 1.12, voiceIndex: 1 },
        lines: [
          { who: 'andra', text: 'Ch… chut ! Pas si fort… Elle pourrait nous entendre.' },
          { who: 'andra', text: 'Qui ça ? L’autre côté de l’île. Celui qu’on ne regarde jamais.' },
          { who: 'andra', text: 'Mon étoile est tombée là-dessous. Je n’ose pas passer le portail.' },
          { who: 'lumi', text: 'J’y vais pour toi. Ce n’est peut-être pas si terrible, de l’autre côté.' },
          { who: 'andra', text: 'Tu… tu ferais ça ? Le portail retourne l’île tout entière. Tiens bien ton casque.' },
        ],
        repeat: [{ who: 'andra', text: 'Le portail, c’est là-bas… Moi je reste ici, d’accord ?' }],
      },
    ],
    outro: { who: 'andra', text: 'Alors le dessous n’était qu’un autre jardin ? J’avais surtout peur de ce que je ne connaissais pas.' },
    hints: {
      start: 'Ce portail fait basculer l’île… et si l’étoile se cachait dessous ?',
      flip: 'Tu marches sous l’île ! Le portail te ramène de l’autre côté.',
    },
  },
  {
    id: 'betelgeuse',
    name: 'Récifs de Bételgeuse',
    chapter: 'Chapitre IV · La Rancœur',
    subtitle: 'Les tremplins oubliés',
    mood: 'bitter',
    heights: [
      '.....33.....',
      '.....33.....',
      '111..33..444',
      '011......454',
      '001......456',
    ],
    objects: [
      '.....T......',
      '......G.....',
      '...........G',
      '.P..........',
      'G..........S',
    ],
    jumps: [
      { side: 0, from: [2, 2], to: [5, 2] },
      { side: 0, from: [6, 0], to: [9, 2] },
    ],
    npcs: [
      {
        id: 'betel',
        name: 'Bétel',
        emotion: 'bitter',
        at: [2, 4],
        voice: { pitch: 0.75, rate: 0.95, voiceIndex: 0 },
        lines: [
          { who: 'betel', text: 'Encore un qui vient rallumer des étoiles… Pfff. Personne n’est venu pour la mienne.' },
          { who: 'betel', text: 'Les autres îles sont parties sans un mot. Alors moi aussi, je les ignore.' },
          { who: 'betel', text: 'Ces vieux tremplins ? Je les avais construits pour les rejoindre. Je ne m’en sers plus.' },
          { who: 'lumi', text: 'Ils marchent encore ? Je pourrais te rapporter des nouvelles des autres îles.' },
          { who: 'betel', text: '… Fais comme tu veux. Arrête-toi sur un tremplin et accroche-toi. Mais ne compte pas sur moi pour te dire merci.' },
        ],
        repeat: [{ who: 'betel', text: 'Les tremplins t’envoient d’île en île. Moi, je reste là, à ruminer.' }],
      },
    ],
    outro: { who: 'betel', text: 'Tu as sauté jusqu’au bout… Peut-être que ma rancune m’a éloigné bien plus que les îles elles-mêmes.' },
    hints: {
      start: 'Arrête-toi sur un tremplin pour être projeté vers l’île voisine.',
    },
  },
  {
    id: 'antares',
    name: "Forge d'Antarès",
    chapter: 'Chapitre V · La Colère',
    subtitle: 'Le cœur qui brûle',
    mood: 'anger',
    heights: [
      '2222......66',
      '2332...33.66',
      '233222233...',
      '2222...33...',
      '1...........',
      '0...........',
    ],
    objects: [
      '...B......GS',
      '..G.........',
      '....===.....',
      '........G...',
      '............',
      'P...........',
    ],
    jumps: [{ side: 0, from: [8, 1], to: [10, 1] }],
    npcs: [
      {
        id: 'antar',
        name: 'Antar',
        emotion: 'anger',
        at: [0, 0],
        voice: { pitch: 0.6, rate: 1.18, voiceIndex: 2 },
        lines: [
          { who: 'antar', text: 'QUOI ?! Encore quelqu’un sur MON île ?!' },
          { who: 'antar', text: 'Mon étoile a explosé de colère, et je n’arrive plus à me calmer ! Tout brûle, ici !' },
          { who: 'antar', text: 'Le pont ? Je l’ai cassé ! L’interrupteur ? Je ne veux plus le voir !' },
          { who: 'lumi', text: 'Tu veux bien que j’essaie ? Respire un peu, pendant ce temps.' },
          { who: 'antar', text: '… Respirer. Bon. D’accord. Le tremplin, sur l’îlot, mène à l’étoile. Dépêche-toi avant que je change d’avis !' },
        ],
        repeat: [{ who: 'antar', text: 'Je respire… je respire… Vas-y, avant que ça recommence !' }],
      },
    ],
    outro: { who: 'antar', text: 'C’est fou… Quand la flamme se calme, elle éclaire au lieu de brûler. Merci, petite flamme.' },
    hints: {
      start: 'Le pont est brisé. Trouve l’interrupteur, puis le tremplin.',
      button: 'Le pont se reforge…',
    },
  },
];

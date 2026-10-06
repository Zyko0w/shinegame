// ─────────────────────────────────────────────────────────────────────────────
// L'ARCHIPEL DES ÉMOTIONS
// Quelqu'un dort et ne se réveille plus : enfermé·e dans sa propre tête,
// perdu·e entre ses sentiments. Lumi est sa dernière petite flamme, la part
// d'elle qui veut encore ouvrir les yeux. Chaque île est une émotion, gardée
// par son esprit ; au bout de chaque île brille la Gemme de cette émotion.
// Une fois toutes les gemmes réunies, on les pose sur les autels de la
// Passerelle (dernier niveau) : elles forgent la Clé du Réveil, qui ouvre la
// Porte du Réveil — et la personne se réveille.
// ─────────────────────────────────────────────────────────────────────────────
//
// Format des niveaux
// heights : une chaîne par rangée (axe Z), un caractère par colonne (axe X).
//   '.' = vide · '0'..'9' = hauteur de la colonne (demi-blocs). Lumi ne saute
//   pas tout seul : il ne franchit qu'une marche (écart de 1).
// objects : même grille.
//   P = départ   S = gemme de l'émotion (fin)   G = cristal (facultatif)   B = interrupteur
//   = = dalle de pont (apparaît avec l'interrupteur)
//   O = portail de retournement   T = arbre (bloque la case)
//   M = champignons  L = lanterne  C = cristaux  W = cascade (décor)
//   V = bassin du « liquide » de l'émotion (lave, larmes…), infranchissable
//   K = passerelle en bois (case praticable sans colonne de roche)
//   R = portique-miroir : le traverser fait entrer dans le reflet (ou en sortir)
//   + = dalle-reflet (n'existe que dans le reflet)  - = dalle réelle (s'efface dans le reflet)
//   Curiosités (facultatives, on interagit depuis une case voisine) :
//   H = maison visitable  Y = moulin  Q = cloche  F = fontaine  N = panneau
//   X = feu de camp  A = tente (décor des plateformes d'observation, bloquent la case)
//   U = longue-vue (point panoramique : `view` = constellation / planète observée)
//   E = entrée de grotte (surface) / puits de lumière (intérieur) : s'y arrêter
//       fait passer de l'une à l'autre
//   Z = autel d'une gemme (sanctuaire, voir `altars`)   * = forge de la clé
//   Obstacles : D = bloc à pousser   _ = fosse (un bloc la comble)
//   ~ = coulée de lave (brûle quand elle monte)   < > ^ v = éolienne (sens du souffle)
//   L = lanterne : en passant, Lumi en fait son point de reprise
//   : = dalle fragile (cède quand on la quitte)   o = plaque de pression
//   # = dalle-porte (présente tant que toutes les plaques sont enfoncées)
//   @ = émetteur de rayon (`beams: [{ at, dir }]`)   / \ = miroir orientable
//   $ = récepteur (le rayon fait naître les ponts =)
// under     : face cachée { heights, objects } (vue une fois l'île retournée).
// inside    : intérieur de l'île { heights, objects } (grotte), side = 2.
// altars    : [{ at, level, mood, name }] autel → île dont il attend la gemme.
// door      : la gemme de fin est la Porte du Réveil (arche) ; final : fin du jeu.
// beams     : [{ at: [x, z], side, dir: '>' | '<' | '^' | 'v' }] direction des émetteurs.
// platforms : [{ side, from: [x, z], to: [x, z], h }] plateforme mobile.
// jumps     : [{ side, from: [x, z], to: [x, z] }] tremplin (case de départ → arrivée).
// npcs      : [{ id, at: [x, z], side, name, emotion, voice, lines, repeat }]
//   lines : [{ who, text }] — `who` = id du personnage ou 'lumi'.
// curios    : [{ at: [x, z], side, name, text | lines, voice, view, title }] textes des curiosités
//   (`lines` = mini-dialogue comme pour les esprits, `who: 'souvenir'` = voix off).
// mood      : émotion du chapitre (couleur du ciel, musique, esprit).
// outro     : citation affichée et dite à la fin du niveau.

// Voix de Lumi (les personnages ont la leur)
export const LUMI_VOICE = { name: 'Lumi', color: '#5effd8', pitch: 1.6, rate: 1.08, voiceIndex: 1 };

// Cinématique d'ouverture (nouvelle partie) : quelqu'un dort, on plonge dans
// son sommeil, Lumi s'allume. `beat` : effet visuel du plan (main.js).
// Clés de voix : prologue/<n> (narrateur) et prologue/wake<n> (Lumi).
export const PROLOGUE = {
  lines: [
    { who: 'souvenir', text: 'Quelque part, quelqu’un dort.' },
    { who: 'souvenir', text: 'Depuis des jours. Des semaines, peut-être. Plus personne n’arrive à la réveiller.' },
    { who: 'souvenir', text: 'Parfois, ses paupières frémissent… mais elles ne s’ouvrent pas.', beat: 'flutter' },
    { who: 'souvenir', text: 'Elle s’est perdue tout au fond d’elle-même, entre ses propres sentiments.' },
    { who: 'souvenir', text: 'Pourtant, là-dedans, une toute petite flamme refuse de s’éteindre.', beat: 'dive' },
  ],
  wake: [{ who: 'lumi', text: 'Hein… ? Où suis-je ? Il fait si sombre… Mais moi, je brille encore.' }],
};

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
      '0012...2222.22',
      '00.....2222222',
      '.0......2...22',
      '0001...2222.11',
      '0000...222..11',
      '..0.........00',
      '000.........00',
      '000.........0.',
    ],
    objects: [
      'B.MT...L.S.',
      '...........',
      '.........C.',
      '...G.......',
      '..P.===....',
      'WM.....M..T',
      '.........LW.LT',
      'G......C.D._G.',
      '.K......K....M',
      '...N..........',
      'YH.G.....L..G.',
      '..K..........C',
      'X.............',
      'U.A...........',
    ],
    curios: [
      {
        at: [0, 13],
        name: 'la longue-vue',
        view: 'orion',
        title: 'Constellation d’Orion',
        voice: 'Carnet d’enfance',
        lines: [
          { who: 'souvenir', text: 'La constellation d’Orion, le chasseur. Les trois étoiles alignées au centre forment sa ceinture : Alnitak, Alnilam et Mintaka.' },
          { who: 'souvenir', text: 'En haut à gauche brille Bételgeuse, une géante rouge en fin de vie. En bas à droite, Rigel : jeune, bleue et brûlante.' },
          { who: 'lumi', text: 'Une étoile qui s’achève et une qui commence… dans la même constellation.' },
        ],
      },
      {
        at: [1, 10],
        name: 'la maison d’Orion',
        lines: [
          { who: 'lumi', text: 'Des cartes du ciel partout… même au plafond !' },
          { who: 'orion', text: 'Ne touche pas à la théière, petite flamme ! Elle a vu naître trois comètes.' },
          { who: 'lumi', text: 'Promis. Je regarde juste les étoiles dessinées.' },
        ],
      },
      { at: [0, 10], name: 'le vieux moulin', text: 'Les ailes brassent la poussière d’étoiles. Le moulin moud la lumière pour en faire des lucioles.' },
      { at: [3, 9], name: 'le panneau', text: '« Jardin d’Orion — ici, on apprend à regarder en l’air. »' },
    ],
    npcs: [
      {
        id: 'orion',
        name: 'Orion, le vieux gardien',
        emotion: 'wonder',
        at: [1, 4],
        voice: { pitch: 0.65, rate: 0.88, voiceIndex: 0 },
        lines: [
          { who: 'orion', text: "Oh ! Une petite flamme… Tu es réveillée, toi ? Enfin quelqu’un." },
          { who: 'orion', text: "Je suis Orion, l’Émerveillement. Ici, tu es dans une tête : la sienne… la nôtre." },
          { who: 'orion', text: "Elle dort depuis si longtemps. Elle s’est perdue entre ses propres sentiments, et chacun garde jalousement sa gemme." },
          { who: 'lumi', text: "Alors je vais les chercher. Toutes. Et on la réveillera." },
          { who: 'orion', text: "Rapporte-les à la Porte du Réveil, au bout de l’Archipel. Commence par la mienne : l’interrupteur, là-haut, fera naître un pont." },
        ],
        repeat: [{ who: 'orion', text: "Le pont attend ton pas, petite flamme. Ma gemme brille de l’autre côté." }],
      },
    ],
    outro: { who: 'orion', text: "Une première gemme… Je la sens remuer, quelque part. Continue : chaque sentiment garde la sienne." },
    hints: {
      start: 'Clique sur une case pour guider Lumi. Approche-toi d’Orion pour lui parler.',
      button: 'Un pont de lumière se forme…',
      filled: 'Le bloc comble la fosse : un nouveau passage s’ouvre !',
    },
  },
  {
    id: 'vega',
    name: 'Tour de Véga',
    chapter: 'Chapitre I · La Tristesse',
    subtitle: "L'escalier qui flotte",
    mood: 'sad',
    heights: [
      '4567......',
      '3..8......',
      '2..9..2.22',
      '1..90.1111',
      '0000000.00',
      '.000000.0.',
      '....00000.',
    ],
    objects: [
      '.G........',
      'M..=......',
      'W..=..G.HV',
      '...S..LK..',
      'G..P..B.GQ',
      '.>........',
      '....G::...',
    ],
    curios: [
      {
        at: [8, 2],
        name: 'la maison de Mira',
        lines: [
          { who: 'lumi', text: 'Tout est rangé… sauf une pile de mouchoirs brodés d’étoiles.' },
          { who: 'lumi', text: 'Sur le mur, un dessin d’enfant : deux silhouettes main dans la main. L’une est presque effacée.' },
          { who: 'lumi', text: 'On ne pleure que ce qu’on a aimé. Je comprends mieux, maintenant.' },
        ],
      },
      { at: [9, 4], name: 'la cloche des larmes', text: 'La cloche sonne sous la pluie. Chaque goutte lui répond par un petit écho.' },
    ],
    npcs: [
      {
        id: 'mira',
        name: 'Mira',
        emotion: 'sad',
        at: [4, 3],
        voice: { pitch: 1.25, rate: 0.86, voiceIndex: 1 },
        lines: [
          { who: 'mira', text: "Ne fais pas attention à moi… Je pleure tout le temps, maintenant." },
          { who: 'mira', text: "Je suis sa Tristesse. Tout ce qu’elle n’a jamais dit, c’est ici que ça coule." },
          { who: 'mira', text: "Ma gemme est tout en haut de la tour. Chaque larme a effacé une marche de l’escalier." },
          { who: 'lumi', text: "On peut peut-être les faire revenir ?" },
          { who: 'mira', text: "On raconte qu’un interrupteur, en bas, se souvient de toutes les marches… Moi, je n’ai plus la force d’y aller." },
        ],
        repeat: [{ who: 'mira', text: "Les marches reviendront… si quelqu’un y croit à ma place." }],
      },
    ],
    outro: { who: 'mira', text: "Tu l’as prise… La tristesse ne s’efface pas, tu sais. Mais elle peut laisser passer la lumière." },
    hints: {
      start: 'Les marches manquent tout là-haut. Il doit bien y avoir un interrupteur…',
      button: "L'escalier se complète dans le ciel.",
      wind: 'Attention aux soupirs de l’éolienne : ils poussent vers le vide.',
    },
  },
  {
    id: 'lyra',
    name: 'Archipel de Lyra',
    chapter: 'Chapitre II · La Solitude',
    subtitle: 'Le bac des étoiles',
    mood: 'lonely',
    heights: [
      '333....333.',
      '343....323.',
      '333....333.',
      '2.......333',
      '1.......444',
      '00......56.',
      '0..........',
      '0000.......',
      '000........',
      '000000000..',
      '.00........',
    ],
    objects: [
      'T......C.T.',
      '.G......GW.',
      '..M......F.',
      '..........L',
      '..........<',
      'PG.......S.',
      'K..........',
      '...H.......',
      '.NG........',
      '..D.###.G..',
      '.Lo........',
    ],
    curios: [
      {
        at: [3, 7],
        name: 'la cabane du passeur',
        lines: [
          { who: 'lumi', text: 'Deux tasses sur la table. Une seule a servi.' },
          { who: 'lyre', text: 'L’autre, c’est pour le prochain voyageur. Je la lave tous les matins, au cas où.' },
          { who: 'lumi', text: 'Alors je reviendrai boire dedans. C’est promis.' },
        ],
      },
      { at: [1, 8], name: 'le panneau', text: '« Embarcadère. Prochain départ : quand quelqu’un viendra. »' },
      {
        at: [9, 2],
        name: 'le puits aux vœux',
        wishes: ['Que Lyre ne soit plus jamais seul', 'Que les îles se rapprochent', 'Revoir un ami perdu de vue'],
        text: 'Le vœu tombe au fond du puits… et remonte en lumière, droit vers l’autre île.',
      },
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
          { who: 'lyre', text: "Ah… un visiteur. Ici, plus personne ne vient." },
          { who: 'lyre', text: "Je suis sa Solitude. Je la tiens à l’écart des autres, pour qu’on ne lui fasse plus de mal." },
          { who: 'lyre', text: "Les îles se sont éloignées, tu vois. Comme les gens, quand on cesse de leur rendre visite." },
          { who: 'lumi', text: "Alors je traverse… et je reviendrai te voir." },
          { who: 'lyre', text: "Arrête-toi sur la dalle dorée. Ma gemme t’attend sur l’autre île." },
        ],
        repeat: [{ who: 'lyre', text: "La dalle dorée t’attend. Elle n’aime pas rester seule, elle non plus." }],
      },
    ],
    outro: { who: 'lyre', text: "Tu es allé jusqu’au bout… Peut-être qu’elle peut encore laisser quelqu’un s’approcher." },
    hints: {
      start: 'Arrête-toi sur la plateforme dorée : elle te portera de l’autre côté. Là-bas, gare au vent glacé.',
      platform: 'En route vers l’autre île…',
      call: 'La plateforme revient vers toi : attends-la au bord.',
      plate: 'Les dalles bleues tiennent… tant que la plaque reste enfoncée.',
    },
  },
  {
    id: 'andromede',
    name: "Miroir d'Andromède",
    chapter: 'Chapitre III · La Peur',
    subtitle: "L'île à deux visages",
    mood: 'fear',
    heights: [
      '..333.......',
      '..2.3..33.33',
      '012.33333333',
      '00...3.33.33',
      '0000.3...',
      '000000',
      '000.00',
    ],
    objects: [
      '....M.......',
      '....G...G.X.',
      'C.....K..K.U',
      '.......QV..A',
      'P..G.O...',
      '..D_.G',
      'L.....',
    ],
    curios: [
{
        at: [11, 2],
        name: 'la longue-vue',
        view: 'andromede',
        title: 'Galaxie d’Andromède',
        voice: 'Carnet d’enfance',
        lines: [
          { who: 'souvenir', text: 'La galaxie d’Andromède : mille milliards d’étoiles. C’est l’objet le plus lointain visible à l’œil nu, à 2,5 millions d’années-lumière.' },
          { who: 'souvenir', text: 'La lumière que tu vois est partie bien avant les premiers humains. Dans quatre milliards d’années, elle rencontrera notre Voie lactée.' },
          { who: 'lumi', text: 'Même ce qui est très loin finit par se rapprocher. Pas de quoi avoir peur.' },
        ],
      },
      { at: [7, 3], name: 'la cloche d’alarme', text: 'La cloche résonne… et rien de terrible n’arrive. Le silence d’après est presque doux.' },
    ],
    under: {
      heights: [
        '456..0',
        '3....0',
        '222111',
        '1...1.',
        '00000.',
      ],
      objects: [
        '..S..O',
        'L.....',
        '.:::C.',
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
          { who: 'andra', text: "Ch… chut ! Pas si fort… Tout ce qu’elle a enfoui pourrait remonter." },
          { who: 'andra', text: "Je suis sa Peur. Je garde le dessous de l’île, là où elle range ce qu’elle ne veut pas regarder." },
          { who: 'andra', text: "Ma gemme est tombée là-dessous. Je n’ose pas passer le portail." },
          { who: 'lumi', text: "J’y vais pour toi. Ce n’est peut-être pas si terrible, de l’autre côté." },
          { who: 'andra', text: "Tu… tu ferais ça ? Le portail retourne l’île tout entière. Tiens bien ton casque." },
        ],
        repeat: [{ who: 'andra', text: "Le portail, c’est là-bas… Moi je reste ici, d’accord ?" }],
      },
    ],
    outro: { who: 'andra', text: "Alors le dessous n’était qu’un autre jardin ? Elle avait surtout peur de ce qu’elle ne connaissait pas." },
    hints: {
      start: 'Ce portail fait basculer l’île… et si la gemme se cachait dessous ?',
      flip: 'Tu marches sous l’île ! Le portail te ramène de l’autre côté.',
      filled: 'La fosse est comblée.',
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
      '111..33..44444',
      '011..3...444456',
      '001..33..44445',
      '.....33.....',
    ],
    objects: [
      '.....T......',
      '......G.....',
      '...........G_.',
      '.P...K....D._.S',
      'G.....H..L.._.',
      '.....GY.....',
    ],
    curios: [
      {
        at: [6, 4],
        name: 'l’atelier de Bétel',
        lines: [
          { who: 'lumi', text: 'Des plans de tremplins partout… et des lettres jamais envoyées.' },
          { who: 'souvenir', text: '« Chère Antarès, tu me manques. » Rayé. Recommencé. Rayé encore.' },
          { who: 'lumi', text: 'Bétel n’est pas fâché. Il a juste peur que personne ne réponde.' },
        ],
        voice: 'Brouillon de lettre',
      },
      { at: [6, 5], name: 'le moulin grinçant', text: 'Le moulin grince, hésite… puis repart. Il avait juste besoin qu’on le pousse un peu.' },
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
          { who: 'betel', text: "Encore un qui veut réveiller tout le monde… Pfff. Personne n’est venu, quand elle en avait besoin." },
          { who: 'betel', text: "Je suis sa Rancœur. Je tiens les comptes : chaque oubli, chaque promesse pas tenue." },
          { who: 'betel', text: "Ces vieux tremplins ? Je les avais construits pour rejoindre les autres. Je ne m’en sers plus." },
          { who: 'lumi', text: "Ils marchent encore ? Ta gemme est au bout, non ?" },
          { who: 'betel', text: "… Fais comme tu veux. Arrête-toi sur un tremplin et accroche-toi. Mais ne compte pas sur moi pour te dire merci." },
        ],
        repeat: [{ who: 'betel', text: "Les tremplins t’envoient d’île en île. Moi, je reste là, à ruminer." }],
      },
    ],
    outro: { who: 'betel', text: "Tu as sauté jusqu’au bout… Peut-être que c’est moi qui l’ai éloignée des autres, bien plus qu’eux." },
    hints: {
      start: 'Arrête-toi sur un tremplin pour être projeté vers l’île voisine. La gemme est derrière une tranchée : pousse le bloc runique pour la combler.',
      filled: 'Le bloc comble la tranchée. La gemme est à portée !',
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
      '1000........',
      '00000.......',
      '.0000.......',
      '000000',
      '00.000',
    ],
    objects: [
      '..........GS',
      '.VG.........',
      '....===.....',
      '........G...',
      '..VH........',
      'P.K.........',
      '.GV.F.......',
      '.L~~~.',
      'G..~.B',
    ],
    curios: [
      {
        at: [3, 4],
        name: 'la forge d’Antar',
        lines: [
          { who: 'lumi', text: 'Des marteaux, des enclumes… et un petit cœur de métal, tout cabossé.' },
          { who: 'antar', text: 'Je l’ai frappé trop fort ! C’était censé être un cadeau…' },
          { who: 'lumi', text: 'Il bat encore, tu sais. Un peu de travers, mais il bat.' },
        ],
      },
      {
        at: [4, 6],
        name: 'la fontaine de lave',
        wishes: ['Que la colère d’Antar s’apaise', 'Avoir le courage de pardonner', 'Une forge qui crée au lieu de détruire'],
        text: 'La lave avale ton vœu, bouillonne… puis se calme, comme une longue respiration.',
      },
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
          { who: 'antar', text: "QUOI ?! Encore quelqu’un dans MA tête… enfin, dans SA tête !" },
          { who: 'antar', text: "Je suis sa Colère ! Tout ce qu’elle a avalé sans rien dire, ça brûle ici !" },
          { who: 'antar', text: "Le pont ? Je l’ai cassé ! L’interrupteur ? Je ne veux plus le voir !" },
          { who: 'lumi', text: "Tu veux bien que j’essaie ? Respire un peu, pendant ce temps." },
          { who: 'antar', text: "… Respirer. Bon. D’accord. Le tremplin, sur l’îlot, mène à ma gemme. Dépêche-toi avant que je change d’avis !" },
        ],
        repeat: [{ who: 'antar', text: "Je respire… je respire… Vas-y, avant que ça recommence !" }],
      },
    ],
    outro: { who: 'antar', text: "C’est fou… Quand la flamme se calme, elle éclaire au lieu de brûler. Garde ma gemme, petite flamme." },
    hints: {
      start: 'Le pont est brisé. L’interrupteur est au-delà de la coulée de lave : traverse quand la croûte est sombre.',
      button: 'Le pont se reforge…',
    },
  },
  {
    id: 'alcor',
    name: "Galerie d'Alcor",
    chapter: 'Chapitre VI · La Jalousie',
    subtitle: 'Le reflet trompeur',
    mood: 'envy',
    beams: [{ at: [2, 13], dir: '>' }],
    heights: [
      '........6..',
      '........5..',
      '........4..',
      '........3..',
      '0111....2...22',
      '01111112222222',
      '001....222..22',
      '.0......2..',
      '000.....222',
      '........22.',
      '.......2222',
      '......22222',
      '.......222.',
      '..2222222..',
      '...2....2..',
      '..2222222..',
    ],
    objects: [
      '........S..',
      '........-..',
      '........-..',
      '........-..',
      'N..T....R...X.',
      'P..R+++G...K.U',
      '..G....C.M..A.',
      '.-......+..',
      'Q.C.......H',
      '........GV.',
      '.......L...',
      '......>...G',
      '........M..',
      '..@...../..',
      '...........',
      '..L.==.G$..',
    ],
    npcs: [
      {
        id: 'alcor',
        name: 'Alcor',
        emotion: 'envy',
        at: [0, 6],
        voice: { pitch: 1.1, rate: 1.0, voiceIndex: 2 },
        lines: [
          { who: 'alcor', text: "Tu as vu Mizar ? Ma jumelle. Tout le monde la regarde, elle. Moi, je suis « l’autre »." },
          { who: 'alcor', text: "Je suis sa Jalousie. Je lui montre la vie des autres dans des miroirs. Toujours plus belle que la sienne." },
          { who: 'alcor', text: "De l’autre côté du miroir, tout s’inverse : la gauche devient la droite, et des chemins d’argent apparaissent." },
          { who: 'lumi', text: "Et le chemin qui mène à ta gemme ?" },
          { who: 'alcor', text: "Lui n’existe que du bon côté du miroir. Il faudra passer de l’un à l’autre… sans te perdre en route." },
        ],
        repeat: [{ who: 'alcor', text: "Dans le reflet, tout s’inverse. Même tes pas." }],
      },
    ],
    curios: [
{
        at: [13, 5],
        name: 'la longue-vue',
        view: 'ourse',
        title: 'Grande Ourse',
        voice: 'Carnet d’enfance',
        lines: [
          { who: 'souvenir', text: 'La Grande Ourse, qu’on appelle aussi la Grande Casserole. Dans son manche brillent Mizar et sa petite voisine, Alcor.' },
          { who: 'souvenir', text: 'Autrefois, distinguer Alcor à côté de Mizar servait de test de vue. Les deux étoiles voyagent ensemble dans l’espace.' },
          { who: 'lumi', text: 'On ne voit vraiment l’une que si l’on regarde aussi l’autre.' },
        ],
      },
      { at: [0, 4], name: 'le panneau', text: '« Galerie d’Alcor. Prière de ne pas comparer les reflets. »' },
      { at: [0, 8], name: 'le carillon jumeau', text: 'Deux cloches sonnent ensemble. Pour une fois, aucune n’essaie de couvrir l’autre.' },
      {
        at: [10, 8],
        name: 'la maison de Mizar',
        voice: 'Mot de Mizar',
        lines: [
          { who: 'lumi', text: 'Une maison pleine de miroirs… tous recouverts de draps.' },
          { who: 'souvenir', text: '« Alcor, je n’ai jamais voulu briller plus fort que toi. Je voulais juste briller à côté de toi. »' },
          { who: 'lumi', text: 'Je crois qu’Alcor devrait lire ça.' },
        ],
      },
    ],
    outro: { who: 'alcor', text: "Elle n’avait pas besoin de briller comme les autres. Juste de briller comme elle." },
    hints: {
      start: 'Traverse le portique-miroir : dans le reflet, des dalles d’argent apparaissent… mais tes commandes s’inversent.',
      mirror: 'Dans le reflet ! Gauche et droite, avant et arrière sont inversés.',
      unmirror: 'Retour du bon côté du miroir : les dalles dorées sont revenues.',
      beam: 'Le rayon touche le récepteur : un pont de lumière apparaît !',
    },
  },
  {
    id: 'merope',
    name: 'Grottes de Mérope',
    chapter: 'Chapitre VII · La Honte',
    subtitle: 'Ce qu’on cache au fond de soi',
    mood: 'shame',
    heights: [
      '..1122....',
      '.0112233..',
      '0001123443',
      '00..1.3344',
      '000...33..',
      '000.......',
      '000000....',
      '000000....',
    ],
    objects: [
      '..M..T....',
      '.N.....L..',
      'P.....G..E',
      '.G....C...',
      '..F...M...',
      '..........',
      '.H.L......',
      'G....<....',
    ],
    inside: {
      heights: [
        '3332.......',
        '3.32.....55',
        '3332.....5.',
        '..21.....4.',
        '..10000..3.',
        '.000000..2.',
        '.000011221.',
        '..0000000..',
        '.......00..',
      ],
      objects: [
        'E..L.......',
        '..........S',
        'C.G........',
        '...........',
        '..M...G....',
        '.G....V..G.',
        '.B..Q.==...',
        '..G.D._....',
        '.......LG..',
      ],
    },
    curios: [
      {
        at: [1, 6],
        name: 'la maison de Mérope',
        lines: [
          { who: 'lumi', text: 'Les volets sont fermés en plein jour. Et tous les portraits sont tournés contre le mur.' },
          { who: 'lumi', text: 'Sur l’un d’eux, une petite fille qui rit, la bouche pleine de gâteau.' },
          { who: 'lumi', text: 'Pourquoi cacher un sourire pareil ?' },
        ],
      },
      { at: [1, 1], name: 'le panneau', text: '« Grottes de Mérope. Descente libre. Remontée par le puits de lumière. »' },
      {
        at: [2, 4],
        name: 'la source voilée',
        wishes: ['Oser se montrer telle qu’elle est', 'Se pardonner ses erreurs', 'Qu’on la regarde sans la juger'],
        text: 'L’eau trouble s’éclaircit d’un coup. Au fond, ton reflet te sourit.',
      },
      {
        at: [4, 6],
        side: 2,
        name: 'la cloche des profondeurs',
        text: 'La cloche résonne dans toute la grotte. L’écho revient plus doux, comme une voix qui pardonne.',
      },
    ],
    npcs: [
      {
        id: 'merope',
        name: 'Mérope',
        emotion: 'shame',
        at: [8, 3],
        voice: { pitch: 1.15, rate: 0.9, voiceIndex: 1 },
        lines: [
          { who: 'merope', text: 'Ne me regarde pas… S’il te plaît. Je préfère qu’on ne me voie pas.' },
          { who: 'merope', text: 'Je suis sa Honte. Tout ce qu’elle n’ose pas montrer, elle l’enfouit au fond d’elle.' },
          { who: 'merope', text: 'Ma gemme est tombée tout en bas, dans la grotte. Là où personne ne descend.' },
          { who: 'lumi', text: 'Alors j’y descends. Ce qui est caché mérite aussi un peu de lumière.' },
          { who: 'merope', text: 'Arrête-toi sur l’entrée de la grotte… Et pour remonter, cherche le puits de lumière.' },
        ],
        repeat: [{ who: 'merope', text: 'La grotte t’attend… Moi, je reste là, derrière mes mains.' }],
      },
    ],
    outro: { who: 'merope', text: 'Tu l’as remontée à la lumière… Elle n’est pas si laide, finalement. Elle brille, même.' },
    hints: {
      start: 'L’entrée de la grotte est en haut de la colline. Arrête-toi dessus pour y descendre.',
      cave: 'Te voilà au cœur de l’île. Le puits de lumière te ramène à la surface.',
      surface: 'De retour à la surface.',
      button: 'Des dalles de lumière enjambent le gouffre…',
      filled: 'Le bloc comble la fosse.',
    },
  },
  {
    id: 'passerelle',
    name: 'La Passerelle',
    chapter: 'Épilogue · Le Réveil',
    subtitle: 'Le sanctuaire des sentiments',
    mood: 'dawn',
    door: true,
    final: true,
    heights: [
      '....444....',
      '....444....',
      '.....3.....',
      '.....2.....',
      '..1111111..',
      '11111111111',
      '11111111111',
      '11111111111',
      '11111111111',
      '..1111111..',
      '..0000000..',
      '...00000...',
    ],
    objects: [
      '....LSL....',
      '...........',
      '.....=.....',
      '.....=.....',
      '...Z...Z...',
      '.T.......T.',
      '.Z...*...Z.',
      '..M.....C..',
      '.Z.......Z.',
      '...Z...Z...',
      '..L..PN.L..',
      '.....X.....',
    ],
    altars: [
      { at: [3, 4], level: 'orion', mood: 'wonder', name: 'l’Émerveillement' },
      { at: [7, 4], level: 'vega', mood: 'sad', name: 'la Tristesse' },
      { at: [9, 6], level: 'lyra', mood: 'lonely', name: 'la Solitude' },
      { at: [9, 8], level: 'andromede', mood: 'fear', name: 'la Peur' },
      { at: [7, 9], level: 'betelgeuse', mood: 'bitter', name: 'la Rancœur' },
      { at: [3, 9], level: 'antares', mood: 'anger', name: 'la Colère' },
      { at: [1, 8], level: 'alcor', mood: 'envy', name: 'la Jalousie' },
      { at: [1, 6], level: 'merope', mood: 'shame', name: 'la Honte' },
    ],
    curios: [{ at: [6, 10], name: 'le panneau', text: '« La Passerelle. Ici, chaque sentiment a sa place. »' }],
    npcs: [
      {
        id: 'polaris',
        name: 'Polaris, l’Espoir',
        emotion: 'hope',
        at: [4, 10],
        voice: { pitch: 1.05, rate: 0.95, voiceIndex: 0 },
        lines: [
          { who: 'polaris', text: 'Te voilà enfin, petite flamme. Je suis Polaris, son Espoir. Celle qui n’a jamais cessé d’attendre.' },
          { who: 'polaris', text: 'Voici la Passerelle : le seuil entre son sommeil et son réveil.' },
          { who: 'polaris', text: 'Pose chaque gemme sur son autel. Il les faut toutes : même la peur, même la colère.' },
          { who: 'lumi', text: 'Même la honte ? Même la jalousie ?' },
          { who: 'polaris', text: 'Surtout elles. Ensemble, elles forgeront la clé de la Porte du Réveil.' },
        ],
        repeat: [{ who: 'polaris', text: 'Chaque autel attend sa gemme. Aucun sentiment n’est de trop.' }],
      },
    ],
    outro: { who: 'polaris', text: 'Elle ouvre les yeux… Merci, petite flamme. Tu étais la part d’elle qui voulait se réveiller.' },
    hints: {
      start: 'Marche sur chaque autel pour y déposer la gemme de son île.',
      key: 'La Clé du Réveil ouvre la Porte. Un escalier de lumière se forme…',
    },
  },
];

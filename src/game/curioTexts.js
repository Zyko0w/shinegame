// Textes des curiosités, partagés par le jeu (main.js) et le générateur de
// voix (scripts/generate-voices.mjs) : les deux doivent produire exactement
// les mêmes répliques et les mêmes clés d'enregistrement.
// Module sans dépendance : importable depuis Node.

export const CURIO_INFO = {
  H: { verb: 'Visiter', name: 'la maison' },
  Y: { verb: 'Faire tourner', name: 'le moulin' },
  Q: { verb: 'Sonner', name: 'la cloche' },
  F: { verb: 'Faire un vœu à', name: 'la fontaine' },
  N: { verb: 'Lire', name: 'le panneau' },
  U: { verb: 'Observer avec', name: 'la longue-vue' },
  rotor: { verb: 'Tourner', name: 'le miroir' }, // miroir orientable (rayons)
};

const DEFAULT_TEXT = {
  H: [
    { who: 'lumi', text: 'Toc toc… Il n’y a personne. Juste une bougie qui attend quelqu’un.' },
    { who: 'lumi', text: 'C’est petit, mais ça sent le pain chaud et les souvenirs.' },
  ],
  Y: 'Les ailes du moulin s’emballent. Le vent de l’Archipel souffle encore.',
  Q: 'La cloche résonne longtemps entre les îles.',
  F: 'Tu fais un vœu. L’eau scintille, comme si elle l’avait entendu.',
  N: '« Ici, quelqu’un a attendu les étoiles. »',
};

export const DEFAULT_WISHES = ['Qu’elle ouvre enfin les yeux', 'Que mes amis soient heureux', 'Voyager encore plus loin'];
export const SKY_FALLBACK = [{ who: 'lumi', text: 'Le ciel est immense, vu d’ici.' }];

export function curioText(type, def) {
  return def?.lines ?? def?.text ?? DEFAULT_TEXT[type];
}

// Répliques dites à voix haute par une curiosité, avec leur rang (`slot`) dans
// la scène jouée par main.js. Les autres textes s'affichent en simple bulle.
// Fontaine : le vœu de Lumi (rang 0, voir wishKey) puis la réponse (rang 1).
export function curioSpeech(type, def) {
  const text = curioText(type, def);
  const lines = (list) => list.map((l, slot) => ({ ...l, slot }));
  if (type === 'U') return lines(def?.lines ?? SKY_FALLBACK);
  if (Array.isArray(text)) return lines(text);
  if (type === 'H') return lines([{ who: 'lumi', text }]);
  if (type === 'Q') return lines([{ who: 'souvenir', text }]);
  if (type === 'F') return [{ who: 'souvenir', text, slot: 1 }];
  return [];
}

export const curioKey = (levelId, side, x, z, slot) => `${levelId}/curio/${side}:${x},${z}/${slot}`;

// Vœux proposés : enregistrés une fois pour toutes (clé tirée du texte).
// Un vœu écrit par le joueur n'a pas d'enregistrement : il s'affiche sans voix.
export const wishKey = (wish) =>
  'wish/' +
  wish
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

// Codes des cases partagés par le moteur (world/level.js), l'interface
// (menu des îles) et le vérificateur de niveaux (scripts/verify-levels.mjs).
// Module sans dépendance : importable depuis Node.

// Obstacles : bloc à pousser, fosse, coulée de lave, éoliennes (direction du souffle)
export const PUSH_BLOCK = 'D';
export const PIT = '_';
export const LAVA = '~';
export const FAN_DIRS = { '>': [1, 0], '<': [-1, 0], v: [0, 1], '^': [0, -1] };
// Dalle fragile (s'effondre après le passage), plaque de pression et dalle-porte
// (ouverte tant que toutes les plaques sont enfoncées)
export const FRAGILE = ':';
export const PLATE = 'o';
export const GATE = '#';
// Rayons : émetteur, miroirs orientables (/ et \), récepteur (ouvre les ponts =)
export const EMITTER = '@';
export const MIRRORS = new Set(['/', '\\']);
export const RECEPTOR = '$';

// Objets qui occupent leur case (on ne peut pas la traverser)
export const BLOCKING = new Set(['T', 'V', 'H', 'Y', 'Q', 'F', 'N', 'U', 'X', 'A', '*', PUSH_BLOCK, PIT, ...Object.keys(FAN_DIRS), EMITTER, ...MIRRORS, RECEPTOR]);

// Curiosités interactives (maison, moulin, cloche, fontaine, panneau, longue-vue)
export const CURIOS = new Set(['H', 'Y', 'Q', 'F', 'N', 'U']);

// Cristaux facultatifs
export const GEMS = new Set(['G']);

// Toutes les rangées d'objets d'un niveau, faces cachée et intérieure comprises
export const allObjects = (def) => [...def.objects, ...(def.under?.objects ?? []), ...(def.inside?.objects ?? [])];

// Nombre de cases portant l'un des codes donnés
export const countObjects = (def, codes) => [...allObjects(def).join('')].filter((c) => codes.has(c)).length;

// Réflexion d'un rayon (dx, dz) sur un miroir « / » ou « \ » (z vers le bas de la grille)
export const reflect = (mirror, [dx, dz]) => (mirror === '/' ? [-dz, -dx] : [dz, dx]);

// Hauteur du rayon au-dessus d'une case de hauteur h (un mur plus haut l'arrête)
export const beamHeight = (h) => (h + 1) * 0.5 + 0.45;
export const tileTop = (h) => (h + 1) * 0.5;

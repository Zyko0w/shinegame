// Codes des cases partagés par le moteur (world/level.js), l'interface
// (menu des îles) et le vérificateur de niveaux (scripts/verify-levels.mjs).
// Module sans dépendance : importable depuis Node.

// Objets qui occupent leur case (on ne peut pas la traverser)
export const BLOCKING = new Set(['T', 'V', 'H', 'Y', 'Q', 'F', 'N', 'U', 'X', 'A', '*']);

// Curiosités interactives (maison, moulin, cloche, fontaine, panneau, longue-vue)
export const CURIOS = new Set(['H', 'Y', 'Q', 'F', 'N', 'U']);

// Cristaux facultatifs
export const GEMS = new Set(['G']);

// Toutes les rangées d'objets d'un niveau, faces cachée et intérieure comprises
export const allObjects = (def) => [...def.objects, ...(def.under?.objects ?? []), ...(def.inside?.objects ?? [])];

// Nombre de cases portant l'un des codes donnés
export const countObjects = (def, codes) => [...allObjects(def).join('')].filter((c) => codes.has(c)).length;

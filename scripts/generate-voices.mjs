// Génère les voix des personnages en MP3 :
// - ElevenLabs pour les personnages listés dans ELEVEN (clé dans .env) ;
// - sinon les voix neuronales de Microsoft Edge (msedge-tts : gratuit, sans clé).
//
//   npm run voices          → génère ce qui manque ou a changé
//   npm run voices -- --all → régénère tout
//   npm run voices -- --edge → ignore ElevenLabs (voix Edge pour tous)
//   npm run voices -- --prune → retire seulement du manifeste les répliques
//                               dont le texte a changé (hors ligne) : le jeu
//                               utilise alors la voix du navigateur pour elles
//
// Sortie : public/voices/<niveau>/<personnage>-<l|r><n>.mp3 et outro.mp3
//          public/voices/manifest.json  (clé de réplique → fichier + empreinte)
// Une réplique n'est régénérée que si son texte ou sa voix a changé.

import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { LEVELS } from '../src/game/levels.js';
import { ELEVEN_MODEL, elevenKey, elevenSpeak, isFatal } from './eleven.mjs';

// Casting : une voix Edge + un réglage de hauteur / débit par personnage
export const CAST = {
  // Voix « Multilingual » (nouvelle génération, les plus naturelles), langue forcée
  // en français. Pas de décalage de hauteur : c'est ce qui rendait les voix robotiques.
  // Écoute les alternatives avec « npm run voices:audition ».
  lumi: { voice: 'en-US-EmmaMultilingualNeural', rate: '+6%' }, // petite flamme vive
  orion: { voice: 'fr-FR-RemyMultilingualNeural', rate: '-10%' }, // vieux gardien
  mira: { voice: 'fr-FR-VivienneMultilingualNeural', rate: '-12%', pitch: '-4Hz' }, // tristesse (inchangée)
  lyre: { voice: 'en-US-AndrewMultilingualNeural', rate: '-8%' }, // solitude
  andra: { voice: 'en-US-AvaMultilingualNeural', rate: '+8%' }, // peur
  betel: { voice: 'de-DE-FlorianMultilingualNeural', rate: '-4%' }, // rancœur
  antar: { voice: 'en-US-BrianMultilingualNeural', rate: '+10%', volume: '+10%' }, // colère
  alcor: { voice: 'de-DE-SeraphinaMultilingualNeural', rate: '-2%' }, // jalousie
  merope: { voice: 'fr-FR-VivienneMultilingualNeural', rate: '-8%' }, // honte
  polaris: { voice: 'fr-FR-VivienneMultilingualNeural', rate: '-4%' }, // espoir
};

// Casting ElevenLabs (prioritaire sur CAST) : identifiant de voix par personnage.
// Choisis à l'oreille avec « npm run voices:audition -- --eleven ».
// Réglages facultatifs : stability (eleven_v3 : 0 = créatif, 0.5 = naturel,
// 1 = stable), similarity (0–1). Un personnage absent garde sa voix Edge.
export const ELEVEN = {
  // (offre gratuite : voix prédéfinies uniquement, elles parlent français via eleven_v3)
  lumi: { voice: 'cgSgspJ2msm6clMCkdW9' }, // Jessica : vive, lumineuse
  orion: { voice: 'pqHfZKP75CvOlQylNhV4' }, // Bill : sage, âgé
  mira: { voice: 'pFZP5JQG7iQjIQuC4Bku', stability: 0 }, // Lily : veloutée, tristesse
  lyre: { voice: 'nPczCjzI2devNBz1zQrb' }, // Brian : grave, posé, solitude
  andra: { voice: 'FGY2WhTYpPnrIDTdsKH5', stability: 0 }, // Laura : nerveuse, peur
  betel: { voice: 'N2lVS1w4EtoT3dr4eOWO' }, // Callum : voix éraillée, rancœur
  antar: { voice: 'SOYHLrjzK2X1ezoPC6cr', stability: 0 }, // Harry : féroce, colère
  alcor: { voice: 'hpp4J3VqNfWAUOO0d1Us' }, // Bella : vive, jalousie
  merope: { voice: 'XrExE9yKIg1WjnnlVkGX', stability: 0 }, // Matilda : douce, timide, honte
  polaris: { voice: 'EXAVITQu4vr4xnSDxMaL' }, // Sarah : chaleureuse, rassurante, espoir
};

const useEdgeOnly = process.argv.includes('--edge');
const hasKey = !!elevenKey();

// Voix effective d'un personnage (l'empreinte en dépend : changer de moteur régénère)
function castFor(who, offline = false) {
  const el = ELEVEN[who];
  if (el && !useEdgeOnly && (hasKey || offline)) return { engine: 'eleven', model: ELEVEN_MODEL, ...el };
  return CAST[who];
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'voices');
const manifestPath = join(outDir, 'manifest.json');
const all = process.argv.includes('--all');
const prune = process.argv.includes('--prune');

// Toutes les répliques à dire, avec une clé stable (utilisée par le jeu)
function collectLines() {
  const out = [];
  for (const level of LEVELS) {
    for (const npc of level.npcs ?? []) {
      npc.lines.forEach((l, i) => out.push({ key: `${level.id}/${npc.id}/l${i}`, who: l.who, text: l.text, file: `${level.id}/${npc.id}-l${i}.mp3` }));
      (npc.repeat ?? []).forEach((l, i) => out.push({ key: `${level.id}/${npc.id}/r${i}`, who: l.who, text: l.text, file: `${level.id}/${npc.id}-r${i}.mp3` }));
    }
    if (level.outro) out.push({ key: `${level.id}/outro`, who: level.outro.who, text: level.outro.text, file: `${level.id}/outro.mp3` });
  }
  return out;
}

// Texte « à dire » : sans guillemets décoratifs, majuscules criées adoucies
function speakable(text) {
  return text.replace(/[«»]/g, '').replace(/\b([A-ZÀ-Ý]{3,})\b/g, (m) => m[0] + m.slice(1).toLowerCase());
}

const hash = (o) => createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 12);

const lines = collectLines();
const manifest = existsSync(manifestPath) && !all ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
if (prune) {
  let n = 0;
  const current = new Map(lines.map((l) => [l.key, l]));
  for (const [k, v] of Object.entries(manifest)) {
    const l = current.get(k);
    const cast = l && castFor(l.who, true);
    if (!l || !cast || v.hash !== hash({ text: speakable(l.text), cast })) {
      delete manifest[k];
      n++;
    }
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`${n} réplique(s) périmée(s) retirée(s) du manifeste.`);
  process.exit(0);
}

let tts = new MsEdgeTTS();
const tmp = join(tmpdir(), 'shine-voices');
let made = 0;
let skipped = 0;
let failed = 0;
let currentVoice = null;
let elevenChars = 0;

if (!hasKey && !useEdgeOnly && Object.keys(ELEVEN).length) console.warn('! pas de clé ElevenLabs (.env) : voix Edge pour tout le monde\n');

for (const line of lines) {
  const cast = castFor(line.who);
  if (!cast) {
    console.warn(`! pas de voix pour « ${line.who} » (${line.key})`);
    failed++;
    continue;
  }
  const text = speakable(line.text);
  const h = hash({ text, cast });
  const dest = join(outDir, line.file);
  if (manifest[line.key]?.hash === h && existsSync(dest)) {
    skipped++;
    continue;
  }
  if (cast.engine === 'eleven') {
    try {
      const mp3 = await elevenSpeak(text, cast);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, mp3);
      manifest[line.key] = { file: `voices/${line.file}`, hash: h };
      made++;
      elevenChars += text.length;
      console.log(`✓ ${line.key.padEnd(26)} ElevenLabs ${cast.voice}`);
    } catch (e) {
      failed++;
      console.error(`✗ ${line.key} : ${e.message}`);
      // quota épuisé ou clé refusée : inutile d'insister
      if (isFatal(e)) break;
    }
    continue;
  }
  try {
    if (currentVoice !== cast.voice) {
      // changer de voix sur une connexion déjà utilisée échoue parfois : connexion neuve
      if (currentVoice) {
        tts.close();
        tts = new MsEdgeTTS();
      }
      // langue forcée en français (indispensable pour les voix non françaises)
      await tts.setMetadata(cast.voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, { voiceLocale: 'fr-FR' });
      currentVoice = cast.voice;
    }
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    // uniquement les réglages définis (un « undefined » rend le SSML invalide)
    const prosody = Object.fromEntries(Object.entries({ rate: cast.rate, pitch: cast.pitch, volume: cast.volume }).filter(([, v]) => v));
    const { audioFilePath } = await tts.toFile(tmp, text, prosody);
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(audioFilePath, dest);
    manifest[line.key] = { file: `voices/${line.file}`, hash: h };
    made++;
    console.log(`✓ ${line.key.padEnd(26)} ${cast.voice}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${line.key} : ${e.message}`);
    // client dans un état incertain : on repart d'une connexion neuve
    try {
      tts.close();
    } catch {
      /* déjà fermé */
    }
    tts = new MsEdgeTTS();
    currentVoice = null;
  }
}

tts.close();
rmSync(tmp, { recursive: true, force: true });
// on retire du manifeste les répliques qui n'existent plus
const keys = new Set(lines.map((l) => l.key));
for (const k of Object.keys(manifest)) if (!keys.has(k)) delete manifest[k];
mkdirSync(outDir, { recursive: true });
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
if (elevenChars) console.log(`\n~${elevenChars} caractères ElevenLabs consommés.`);
console.log(`\n${made} générée(s), ${skipped} inchangée(s), ${failed} en échec — ${lines.length} répliques au total.`);
process.exit(failed ? 1 : 0);

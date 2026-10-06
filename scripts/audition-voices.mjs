// Audition des voix Edge : génère la même réplique avec chaque voix candidate,
// pour choisir le casting à l'oreille.
//   npm run voices:audition   puis ouvrir http://localhost:5173/audition.html
// (fichiers dans audition/ : servis par le serveur de dev, jamais publiés)

//   npm run voices:audition -- --eleven
//     même chose avec les voix ElevenLabs du compte (prédéfinies + celles
//     ajoutées depuis la Voice Library). Une voix déjà écoutée n'est pas
//     régénérée (quota de caractères). --voices id1,id2 pour en limiter la liste.

import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { ELEVEN_MODEL, elevenSpeak, elevenVoices, isFatal } from './eleven.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

export const CANDIDATES = [
  // voix de nouvelle génération (les plus naturelles)
  'fr-FR-VivienneMultilingualNeural',
  'fr-FR-RemyMultilingualNeural',
  'en-US-AvaMultilingualNeural',
  'en-US-EmmaMultilingualNeural',
  'en-US-AndrewMultilingualNeural',
  'en-US-BrianMultilingualNeural',
  'en-AU-WilliamMultilingualNeural',
  'de-DE-SeraphinaMultilingualNeural',
  'de-DE-FlorianMultilingualNeural',
  'it-IT-GiuseppeMultilingualNeural',
  'pt-BR-ThalitaMultilingualNeural',
  // voix françaises classiques (référence)
  'fr-FR-DeniseNeural',
  'fr-FR-EloiseNeural',
  'fr-FR-HenriNeural',
];

const SAMPLE = 'Bonjour, petite flamme. Les étoiles de l’Archipel se sont éteintes une à une… mais toi, tu peux encore les rallumer. Tu veux bien essayer ?';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'audition');
const tmp = join(tmpdir(), 'shine-audition');
mkdirSync(outDir, { recursive: true });

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const page = (title, intro, rows) =>
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
body{margin:0;padding:32px 16px;background:#0b0918;color:#efeaff;font:15px/1.5 system-ui,sans-serif}
main{max-width:760px;margin:auto}h1{margin:0 0 6px}p{color:#b9b0dd}
ul{list-style:none;padding:0;display:grid;gap:10px}
li{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 16px;border:1px solid #2c2650;border-radius:12px;background:#141029}
small{color:#8f86c4;margin-left:6px}code{display:block;font-size:12px;color:#79f2ff;margin-top:2px}audio{flex:none;width:300px;max-width:50vw}
</style></head><body><main><h1>${title}</h1>
<p>${intro}</p>
<ul>${rows}</ul></main></body></html>`;

if (process.argv.includes('--eleven')) {
  const only = process.argv[process.argv.indexOf('--voices') + 1];
  let voices = await elevenVoices();
  if (process.argv.includes('--voices') && only) {
    const ids = new Set(only.split(','));
    voices = voices.filter((v) => ids.has(v.id));
  }
  const dir = join(outDir, 'eleven');
  mkdirSync(dir, { recursive: true });
  const todo = voices.filter((v) => !existsSync(join(dir, `${v.id}.mp3`)));
  console.log(`${voices.length} voix, ${todo.length} à générer (~${todo.length * SAMPLE.length} caractères, modèle ${ELEVEN_MODEL})\n`);
  for (const v of todo) {
    try {
      writeFileSync(join(dir, `${v.id}.mp3`), await elevenSpeak(SAMPLE, { voice: v.id }));
      console.log(`✓ ${v.name.padEnd(28)} ${v.id}`);
    } catch (e) {
      console.error(`✗ ${v.name} : ${e.message}`);
      if (isFatal(e)) break;
    }
  }
  const rows = voices
    .filter((v) => existsSync(join(dir, `${v.id}.mp3`)))
    .map((v) => {
      const tags = [v.category, v.labels.gender, v.labels.age, v.labels.accent, v.labels.description ?? v.labels.descriptive].filter(Boolean).join(' · ');
      const id = encodeURIComponent(v.id);
      return `<li><div><strong>${esc(v.name)}</strong> <small>${esc(tags)}</small><code>${esc(v.id)}</code></div><audio controls preload="none" src="/audition/eleven/${id}.mp3"></audio></li>`;
    })
    .join('\n');
  writeFileSync(
    join(root, 'audition.html'),
    page(
      'Audition ElevenLabs',
      `Même réplique en français (modèle ${ELEVEN_MODEL}). Choisis une voix par personnage, copie son identifiant dans <code>ELEVEN</code> (scripts/generate-voices.mjs) puis lance <code>npm run voices</code>. Pour un vrai accent français, ajoute des voix françaises depuis la Voice Library d'ElevenLabs et relance l'audition.`,
      rows,
    ),
  );
  console.log('\n→ ouvre http://localhost:5173/audition.html');
  process.exit(0);
}

const results = [];
for (const voice of CANDIDATES) {
  // connexion neuve par voix (plus fiable), langue forcée en français
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, { voiceLocale: 'fr-FR' });
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    // (la balise <lang> est refusée par le service gratuit : la langue est fixée via voiceLocale)
    const { audioFilePath } = await tts.toFile(tmp, SAMPLE);
    renameSync(audioFilePath, join(outDir, `${voice}.mp3`));
    results.push(voice);
    console.log(`✓ ${voice}`);
  } catch (e) {
    console.error(`✗ ${voice} : ${e.message}`);
  } finally {
    tts.close();
  }
}
rmSync(tmp, { recursive: true, force: true });

const rows = results
  .map((v) => {
    const [, region, name] = v.match(/^(\w+-\w+)-(\w+?)(Multilingual)?Neural$/) ?? [];
    const next = /Multilingual/.test(v);
    return `<li><div><strong>${name}</strong> <small>${region}${next ? ' · nouvelle génération' : ' · classique'}</small><code>${v}</code></div><audio controls preload="none" src="/audition/${v}.mp3"></audio></li>`;
  })
  .join('\n');
writeFileSync(
  join(root, 'audition.html'),
  page(
    'Audition des voix',
    'Même réplique, sans aucun réglage de hauteur. Choisis une voix par personnage, puis indique-la dans <code>CAST</code> (scripts/generate-voices.mjs) et lance <code>npm run voices</code>.',
    rows,
  ),
);
console.log(`\n${results.length}/${CANDIDATES.length} voix générées → ouvre http://localhost:5173/audition.html`);

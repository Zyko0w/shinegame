// Accès minimal à l'API ElevenLabs (fetch natif, sans dépendance).
// Clé lue dans ELEVENLABS_API_KEY, ou dans le fichier .env à la racine
// (ignoré par git) :  ELEVENLABS_API_KEY=sk_...

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.elevenlabs.io/v1';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Modèle le plus expressif ; langue forcée en français
export const ELEVEN_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_v3';

export function elevenKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  const env = join(root, '.env');
  if (!existsSync(env)) return null;
  const m = readFileSync(env, 'utf8').match(/^\s*ELEVENLABS_API_KEY\s*=\s*["']?([^"'\r\n]+)/m);
  return m ? m[1].trim() : null;
}

async function call(path, init = {}) {
  const key = elevenKey();
  if (!key) throw new Error('clé ElevenLabs absente (ELEVENLABS_API_KEY dans .env)');
  const res = await fetch(API + path, { ...init, headers: { 'xi-api-key': key, ...init.headers } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status} : ${body.slice(0, 300)}`);
  }
  return res;
}

// Voix disponibles sur le compte (prédéfinies + ajoutées depuis la Voice Library)
export async function elevenVoices() {
  const res = await call('/voices');
  const { voices } = await res.json();
  return voices.map((v) => ({ id: v.voice_id, name: v.name, category: v.category, labels: v.labels ?? {} }));
}

// Synthèse d'une réplique → Buffer MP3
export async function elevenSpeak(text, { voice, stability = 0.5, similarity = 0.75, style, speed } = {}) {
  const voice_settings = { stability, similarity_boost: similarity };
  if (style != null) voice_settings.style = style;
  if (speed != null) voice_settings.speed = speed;
  const res = await call(`/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: ELEVEN_MODEL, language_code: 'fr', voice_settings }),
  });
  return Buffer.from(await res.arrayBuffer());
}

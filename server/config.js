import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

// server/.env wins, root .env is a fallback. Neither is ever read by Vite,
// so nothing in here can reach the browser bundle.
for (const p of [path.join(here, '.env'), path.join(ROOT, '.env')]) {
  dotenv.config({ path: p });
}

const num = (v, d) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

const list = (v, d) => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : d);

export const config = {
  port: num(process.env.PORT, 8787),
  env: process.env.NODE_ENV || 'development',

  provider: (process.env.AI_PROVIDER || 'openrouter').toLowerCase(),
  model: process.env.AI_MODEL || 'qwen/qwen-2.5-vl-72b-instruct',

  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    // Optional attribution headers OpenRouter asks for; safe to leave blank.
    referer: process.env.OPENROUTER_REFERER || '',
    title: process.env.OPENROUTER_TITLE || 'Cicada Whiteboard',
  },

  limits: {
    /** Raw base64 payload ceiling (~4.5 MB of PNG). */
    maxImageBase64: num(process.env.AI_MAX_IMAGE_B64, 6_000_000),
    /** express.json body ceiling. */
    maxBodyBytes: process.env.AI_MAX_BODY || '7mb',
    maxHintChars: num(process.env.AI_MAX_HINT, 500),
    maxTokens: num(process.env.AI_MAX_TOKENS, 4000),
    timeoutMs: num(process.env.AI_TIMEOUT_MS, 60_000),
    rateWindowMs: num(process.env.AI_RATE_WINDOW_MS, 60_000),
    rateMax: num(process.env.AI_RATE_MAX, 12),
    concurrent: num(process.env.AI_MAX_CONCURRENT, 3),
  },

  corsOrigins: list(process.env.CORS_ORIGINS, ['http://localhost:5173', 'http://localhost:4173', 'http://127.0.0.1:5173']),
};

/** True when the configured provider can actually serve requests. */
export function providerReady() {
  if (config.provider === 'mock') return true;
  return Boolean(config.openrouter.apiKey);
}

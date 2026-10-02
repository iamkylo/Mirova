import { validateDiagram, extractJson } from '../../shared/diagramSchema.js';

/**
 * Non-secret only: this is the API's base URL. The OpenRouter key lives in
 * server/.env and is read by Node alone — see the guard in vite.config.js.
 */
const BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

export class AIError extends Error {
  constructor(message, kind = 'server') {
    super(message);
    this.name = 'AIError';
    this.kind = kind;
  }
}

async function readError(res) {
  const text = await res.text().catch(() => '');
  const parsed = text ? extractJson(text) : null;
  const kind = parsed?.error?.kind;
  const message = parsed?.error?.message;
  return { kind, message };
}

/** Probe whether the backend can convert at all. Never throws. */
export async function getHealth(signal) {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal });
    // /api/health answers 200 even when AI is off, so anything else means the
    // server itself (or the dev proxy in front of it) is not there.
    if (!res.ok) return { available: false, reason: 'unreachable' };
    const j = await res.json();
    return {
      available: Boolean(j.available),
      provider: j.provider,
      model: j.model,
      hasKey: Boolean(j.hasKey),
      reason: j.available ? null : 'no_key',
    };
  } catch {
    return { available: false, reason: 'unreachable' };
  }
}

/**
 * @param {{base64:string, hint?:string, signal?:AbortSignal}} req
 * @returns {Promise<{diagram:object, warnings:string[], meta:object}>}
 */
export async function convertSketch({ base64, hint = '', signal }) {
  let res;
  try {
    res = await fetch(`${BASE}/api/ai/sketch-to-diagram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64, hint }),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new AIError('AI conversion is currently unavailable.', 'unavailable');
  }

  if (!res.ok) {
    const { kind, message } = await readError(res);
    if (res.status === 503 || kind === 'unavailable') {
      throw new AIError(message || 'AI conversion is currently unavailable.', 'unavailable');
    }
    if (res.status === 429 || kind === 'rate_limited') {
      throw new AIError(message || 'Too many conversions. Please wait a moment.', 'rate_limited');
    }
    if (res.status === 413 || kind === 'too_large') {
      throw new AIError('That sketch is too large to convert. Try selecting a smaller area.', 'too_large');
    }
    if (res.status === 504 || kind === 'timeout') {
      throw new AIError('The model timed out. Try again.', 'timeout');
    }
    throw new AIError(message || `Conversion failed (${res.status}).`, kind || 'server');
  }

  const payload = await res.json().catch(() => null);
  if (!payload?.diagram) throw new AIError('The server sent an unreadable response.', 'invalid');

  // Defense in depth: the server already validated this, but the browser is
  // the thing that draws it, so it checks again before anything hits canvas.
  const checked = validateDiagram(payload.diagram);
  if (!checked.ok) throw new AIError('The model returned an invalid diagram.', 'invalid');

  return {
    diagram: checked.diagram,
    warnings: [...(payload.warnings || []), ...checked.warnings],
    meta: payload.meta || {},
  };
}

import { config } from '../config.js';

/**
 * Fixed-window per-IP limiter plus a global in-flight cap. In-memory is enough
 * for a single-node dev/personal deployment; swap for Redis if this ever runs
 * behind more than one process.
 */
const { rateWindowMs, rateMax, concurrent } = config.limits;
const hits = new Map();
let inFlight = 0;

function sweep(now) {
  for (const [key, entry] of hits) {
    if (now - entry.start >= rateWindowMs) hits.delete(key);
  }
}

export function rateLimit(req, res, next) {
  const now = Date.now();
  if (hits.size > 5000) hits.clear(); // crude guard against unbounded growth
  sweep(now);

  const key = (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || 'unknown').trim();
  let entry = hits.get(key);
  if (!entry || now - entry.start >= rateWindowMs) {
    entry = { start: now, count: 0 };
    hits.set(key, entry);
  }

  entry.count++;
  res.setHeader('X-RateLimit-Limit', String(rateMax));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, rateMax - entry.count)));

  if (entry.count > rateMax) {
    const retry = Math.ceil((entry.start + rateWindowMs - now) / 1000);
    res.setHeader('Retry-After', String(retry));
    return res.status(429).json({
      error: { kind: 'rate_limited', message: `Too many conversions. Try again in ${retry}s.` },
    });
  }

  if (inFlight >= concurrent) {
    return res.status(503).json({
      error: { kind: 'busy', message: 'The converter is busy with other requests. Try again in a moment.' },
    });
  }

  inFlight++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    inFlight = Math.max(0, inFlight - 1);
  };
  res.once('finish', release);
  res.once('close', release);
  next();
}

import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { config, ROOT, providerReady } from '../server/config.js';
import { aiRouter } from '../server/routes/ai.js';
import { describeProvider } from '../server/services/llmService.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

// Allow all origins for Vercel deployment
const allowAll = config.corsOrigins.includes('*') || process.env.VERCEL;
app.use(cors({
  origin: allowAll ? true : config.corsOrigins,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  maxAge: 600,
}));

app.use(express.json({ limit: config.limits.maxBodyBytes }));

app.get('/api/health', (_req, res) => res.json({ ok: true, ...describeProvider() }));
app.use('/api/ai', aiRouter);

// Anything else under /api is a client bug, not a missing page.
app.use((_req, res) => res.status(404).json({ error: { kind: 'not_found', message: 'Unknown API route.' } }));

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    return res.status(413).json({ error: { kind: 'bad_request', message: 'Request body is too large.' } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { kind: 'bad_request', message: 'Request body is not valid JSON.' } });
  }
  console.error('[server]', err);
  res.status(500).json({ error: { kind: 'server', message: 'Internal server error.' } });
});

// Export for Vercel serverless function
export default app;

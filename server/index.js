import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { config, ROOT, providerReady } from './config.js';
import { aiRouter } from './routes/ai.js';
import { describeProvider } from './services/llmService.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

const allowAll = config.corsOrigins.includes('*');
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
app.use('/api', (_req, res) => res.status(404).json({ error: { kind: 'not_found', message: 'Unknown API route.' } }));

// Serve the production bundle when it exists, so `npm start` alone works.
const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: 'index.html' }));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

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

const info = describeProvider();
app.listen(config.port, () => {
  console.log(`\n  Mirova API  →  http://localhost:${config.port}`);
  console.log(`  provider    →  ${info.provider}${info.provider === 'mock' && config.provider !== 'mock' ? '  (fallback: no API key found)' : ''}`);
  console.log(`  model       →  ${info.model}`);
  if (!providerReady() && config.provider !== 'mock') {
    console.log('  ⚠ AI conversion is disabled. Copy server/.env.example to server/.env and set OPENROUTER_API_KEY.');
  }
  console.log();
});

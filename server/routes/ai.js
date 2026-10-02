import { Router } from 'express';
import { AIError, describeProvider, generateDiagram } from '../services/llmService.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validateSketchRequest } from '../middleware/validateSketch.js';

export const aiRouter = Router();

aiRouter.post('/sketch-to-diagram', rateLimit, validateSketchRequest, async (req, res) => {
  const started = Date.now();
  const info = describeProvider();

  if (!info.available) {
    return res.status(503).json({
      error: {
        kind: 'unavailable',
        message: 'AI conversion is currently unavailable: no OPENROUTER_API_KEY is set on the server.',
      },
    });
  }

  // Express 4 has no req.signal, so tie the upstream call to the socket
  // ourselves: if the browser goes away we stop paying for the completion.
  const ac = new AbortController();
  res.once('close', () => { if (!res.writableEnded) ac.abort(); });

  try {
    const out = await generateDiagram({ ...req.sketch, signal: ac.signal });
    res.json({
      diagram: out.diagram,
      warnings: out.warnings,
      meta: {
        provider: out.provider,
        model: out.model,
        ms: Date.now() - started,
        imageKB: Math.round(req.sketch.imageBytes / 1024),
        nodes: out.diagram.nodes.length,
        edges: out.diagram.edges.length,
      },
    });
  } catch (err) {
    if (res.writableEnded || res.destroyed) return; // client already went away
    if (err instanceof AIError) {
      return res.status(err.status).json({ error: { kind: err.kind, message: err.message } });
    }
    console.error('[ai] unexpected', err);
    res.status(500).json({ error: { kind: 'server', message: 'Conversion failed unexpectedly.' } });
  }
});

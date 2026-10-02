import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';

process.env.AI_PROVIDER = 'mock';
process.env.OPENROUTER_API_KEY = '';
globalThis.window = { devicePixelRatio: 1, innerWidth: 1280, innerHeight: 800 };
const measureContext = { font: '', measureText: text => ({ width: String(text).length * 10 }) };
globalThis.document = { createElement: () => ({ getContext: () => measureContext }) };

const [{ config }, { generateDiagram, describeProvider, AIError }, { aiRouter }, schema, layoutModule, adapter, capture, engine] = await Promise.all([
  import('../server/config.js'),
  import('../server/services/llmService.js'),
  import('../server/routes/ai.js'),
  import('../shared/diagramSchema.js'),
  import('../src/ai/layout.js'),
  import('../src/ai/toCicada.js'),
  import('../src/services/capture.js'),
  import('../src/engine/cicadaEngine.js'),
]);

const { validateDiagram, isEmptyDiagram } = schema;
const { layoutDiagram } = layoutModule;
const { diagramToStrokes } = adapter;
const { captureBoard } = capture;

const diagrams = [
  {
    name: 'User -> Server -> Database',
    input: {
      nodes: [
        { id: 'user', label: 'User', shape: 'rect' },
        { id: 'server', label: 'Server', shape: 'rect' },
        { id: 'database', label: 'Database', shape: 'cylinder' },
      ],
      edges: [
        { from: 'user', to: 'server', directed: true },
        { from: 'server', to: 'database', directed: true },
      ],
    },
  },
  {
    name: 'Client -> API -> Database + Redis',
    input: {
      nodes: [
        { id: 'client', label: 'Client', shape: 'rect' },
        { id: 'api', label: 'API', shape: 'rect' },
        { id: 'database', label: 'Database', shape: 'cylinder' },
        { id: 'redis', label: 'Redis', shape: 'cylinder' },
      ],
      edges: [
        { from: 'client', to: 'api', directed: true },
        { from: 'api', to: 'database', directed: true },
        { from: 'api', to: 'redis', directed: true },
      ],
    },
  },
  {
    name: 'Login flowchart with yes/no branches',
    input: {
      nodes: [
        { id: 'start', label: 'Start', shape: 'circle' },
        { id: 'credentials', label: 'Valid credentials?', shape: 'diamond' },
        { id: 'home', label: 'Home', shape: 'rect' },
        { id: 'retry', label: 'Try again', shape: 'rect' },
      ],
      edges: [
        { from: 'start', to: 'credentials', directed: true },
        { from: 'credentials', to: 'home', label: 'yes', directed: true },
        { from: 'credentials', to: 'retry', label: 'no', directed: true },
      ],
    },
  },
  {
    name: 'Messy hand-drawn architecture',
    input: {
      nodes: [
        { id: 'web', label: 'Web', shape: 'rect', group: 'frontend' },
        { id: 'worker', label: 'Worker', shape: 'rect', group: 'backend' },
        { id: 'queue', label: 'Queue', shape: 'cylinder', group: 'backend' },
        { id: 'db', label: 'Primary DB', shape: 'cylinder', group: 'data' },
      ],
      edges: [
        { from: 'web', to: 'worker', directed: true },
        { from: 'worker', to: 'queue', directed: true },
        { from: 'worker', to: 'db', directed: true },
      ],
    },
  },
];

async function withApiServer(run) {
  const app = express();
  app.use(express.json({ limit: '7mb' }));
  app.use('/api/ai', aiRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function pngPayload() {
  const png = Buffer.alloc(128);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  return png.toString('base64');
}

test('mock mode works without a key through server, validation, layout, and native strokes', async () => {
  config.provider = 'mock';
  config.openrouter.apiKey = '';
  assert.equal(describeProvider().available, true);
  assert.equal(describeProvider().hasKey, false);

  await withApiServer(async base => {
    const response = await fetch(`${base}/api/ai/sketch-to-diagram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: pngPayload(), hint: 'architecture' }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.meta.provider, 'mock');

    const checked = validateDiagram(payload.diagram);
    assert.equal(checked.ok, true);
    const layout = layoutDiagram(checked.diagram);
    const strokes = diagramToStrokes(layout);
    assert.ok(layout.nodes.length > 0);
    assert.ok(layout.edges.length > 0);
    assert.ok(strokes.length > 0);
    assert.ok(strokes.every(stroke => ['pen', 'circle', 'text'].includes(stroke.type)));
  });
});

test('four requested diagram structures validate, lay out, and adapt into editable strokes', () => {
  for (const scenario of diagrams) {
    const checked = validateDiagram(scenario.input);
    assert.equal(checked.ok, true, scenario.name);
    const layout = layoutDiagram(checked.diagram);
    const strokes = diagramToStrokes(layout);
    assert.equal(layout.nodes.length, scenario.input.nodes.length, scenario.name);
    assert.equal(layout.edges.length, scenario.input.edges.length, scenario.name);
    assert.ok(strokes.some(stroke => stroke.type === 'text'), scenario.name);
    assert.ok(strokes.some(stroke => stroke.type === 'pen' || stroke.type === 'circle'), scenario.name);
  }
});

test('empty canvas capture is a no-op and unclear diagrams validate as empty', () => {
  assert.equal(captureBoard([]), null);
  const checked = validateDiagram({ nodes: [], edges: [], summary: 'No diagram structure detected.' });
  assert.equal(checked.ok, true);
  assert.equal(isEmptyDiagram(checked.diagram), true);
  assert.equal(layoutDiagram(checked.diagram).empty, true);
});

test('server rejects requests when OpenRouter is selected without a key', async () => {
  config.provider = 'openrouter';
  config.openrouter.apiKey = '';
  assert.equal(describeProvider().available, false);
  await withApiServer(async base => {
    const response = await fetch(`${base}/api/ai/sketch-to-diagram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: pngPayload() }),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.kind, 'unavailable');
  });
});

test('invalid model output is rejected before layout or rendering', async () => {
  config.provider = 'openrouter';
  config.openrouter.apiKey = 'unit-test-key';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith(config.openrouter.baseUrl)) {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'not JSON' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(input, init);
  };

  try {
    await withApiServer(async base => {
      const response = await fetch(`${base}/api/ai/sketch-to-diagram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: pngPayload() }),
      });
      assert.equal(response.status, 502);
      assert.equal((await response.json()).error.kind, 'invalid_response');
    });
  } finally {
    globalThis.fetch = originalFetch;
    config.provider = 'mock';
    config.openrouter.apiKey = '';
  }
});

test('OpenRouter rate limits become a clean retryable 429 response', async () => {
  config.provider = 'openrouter';
  config.openrouter.apiKey = 'unit-test-key';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith(config.openrouter.baseUrl)) {
      return new Response(JSON.stringify({
        error: {
          code: 429,
          message: 'Provider returned error',
          metadata: { raw: 'google/gemma route is temporarily rate-limited' },
        },
      }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    }
    return originalFetch(input, init);
  };

  try {
    await withApiServer(async base => {
      const response = await fetch(`${base}/api/ai/sketch-to-diagram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: pngPayload() }),
      });
      const payload = await response.json();
      assert.equal(response.status, 429);
      assert.equal(payload.error.kind, 'rate_limited');
      assert.match(payload.error.message, /temporarily rate-limited/i);
      assert.doesNotMatch(payload.error.message, /metadata|google\/gemma/i);
    });
  } finally {
    globalThis.fetch = originalFetch;
    config.provider = 'mock';
    config.openrouter.apiKey = '';
  }
});

test('agentic-only model errors explain that Cicada needs a chat-completions model', async () => {
  config.provider = 'openrouter';
  config.openrouter.apiKey = 'unit-test-key';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith(config.openrouter.baseUrl)) {
      return new Response(JSON.stringify({
        error: {
          code: 403,
          message: 'Provider returned error',
          metadata: { raw: 'thinkingmachines/inkling:free is only available on agentic harnesses.' },
        },
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    return originalFetch(input, init);
  };

  try {
    await withApiServer(async base => {
      const response = await fetch(`${base}/api/ai/sketch-to-diagram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: pngPayload() }),
      });
      const payload = await response.json();
      assert.equal(response.status, 503);
      assert.equal(payload.error.kind, 'unavailable');
      assert.match(payload.error.message, /requires an agentic harness/i);
      assert.match(payload.error.message, /chat-completions/i);
      assert.doesNotMatch(payload.error.message, /metadata|thinkingmachines/i);
    });
  } finally {
    globalThis.fetch = originalFetch;
    config.provider = 'mock';
    config.openrouter.apiKey = '';
  }
});

test('malformed semantic output is sanitized and unknown links are dropped', () => {
  const checked = validateDiagram({
    nodes: [{ id: 'ok', label: 'OK' }, { id: 'ok', label: 'Duplicate' }],
    edges: [{ from: 'ok', to: 'missing' }],
  });
  assert.equal(checked.ok, true);
  assert.equal(checked.diagram.nodes.length, 1);
  assert.equal(checked.diagram.edges.length, 0);
  assert.ok(checked.warnings.length > 0);
});

test('light palette contrast and requested dark palette preserve legacy color slots', () => {
  const luminance = hex => {
    const channels = hex.match(/[a-f\d]{2}/gi).map(value => parseInt(value, 16) / 255);
    const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const contrast = (ink, background) => {
    const a = luminance(ink), b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };

  for (const color of engine.COLORS) assert.ok(contrast(color, '#ffffff') >= 4.5, `${color} must contrast the white canvas`);
  assert.deepEqual(engine.DARK_COLORS, ['#75A7FF', '#F2C94C', '#FF9F43', '#FF7777', '#9FD86B', '#56D6C9', '#F4F1E8']);
  for (const color of engine.DARK_COLORS) assert.ok(contrast(color, '#2a2a2e') >= 4.5, `${color} must contrast the dark canvas`);

  const legacyColors = ['#363028', '#C9A89A', '#8FA89A', '#8A9BAE', '#C4B49A', '#A898AE'];
  for (let index = 0; index < legacyColors.length; index++) {
    const body = engine.encodeBody([{ type: 'pen', color: legacyColors[index], w: 2, pts: [{ x: 1, y: 1 }, { x: 20, y: 20 }] }]);
    assert.equal(engine.decodeBody(body, false).strokes[0].color, engine.COLORS[index]);
  }

  const legacyDarkColors = ['#e8d44d', '#7ec878', '#5ec4b6', '#7ab4d4', '#e8a84d', '#c78ec8', '#ffffff'];
  for (let index = 0; index < legacyDarkColors.length; index++) {
    const body = engine.encodeBody([{ type: 'pen', color: legacyDarkColors[index], w: 2, pts: [{ x: 1, y: 1 }, { x: 20, y: 20 }] }]);
    assert.equal(engine.decodeBody(body, false).strokes[0].color, engine.COLORS[index]);
  }

  engine.setDarkModeFlag(true);
  const offWhite = engine.getColors()[6];
  const offWhiteBody = engine.encodeBody([{ type: 'pen', color: offWhite, w: 2, pts: [{ x: 1, y: 1 }, { x: 20, y: 20 }] }]);
  assert.equal(offWhite, '#F4F1E8');
  assert.equal(engine.decodeBody(offWhiteBody, false).strokes[0].color, engine.COLORS[6]);
  engine.setDarkModeFlag(false);
});

test('pasted image strokes retain image data and geometry in share links', async () => {
  const image = {
    type: 'image',
    src: 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEALmk0mk0iIiIiIgBoSygABc6zbAAA',
    x: 12,
    y: 34,
    width: 320,
    height: 180,
  };
  const body = engine.encodeBody([image]);
  const decoded = engine.decodeBody(body, false).strokes[0];
  assert.equal(decoded.type, 'image');
  assert.equal(decoded.src, image.src);
  assert.deepEqual({ x: decoded.x, y: decoded.y, width: decoded.width, height: decoded.height }, {
    x: image.x, y: image.y, width: image.width, height: image.height,
  });
  assert.deepEqual(engine.contentBounds([decoded]), { x0: 12, y0: 34, x1: 332, y1: 214, width: 320, height: 180 });

  const originalImage = globalThis.Image;
  globalThis.Image = class { async decode() {} };
  try {
    const hash = await engine.strokesToHash([image], { scale: 1, cx: 0, cy: 0 });
    const shared = await engine.hashToStrokes(hash);
    assert.equal(shared.strokes[0].type, 'image');
    assert.equal(shared.strokes[0].src, image.src);
    assert.deepEqual({ x: shared.strokes[0].x, y: shared.strokes[0].y, width: shared.strokes[0].width, height: shared.strokes[0].height }, {
      x: image.x, y: image.y, width: image.width, height: image.height,
    });
  } finally {
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
  }
});

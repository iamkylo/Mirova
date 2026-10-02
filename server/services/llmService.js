import { config, providerReady } from '../config.js';
import { openrouterComplete } from '../providers/openrouter.js';
import { mockComplete } from '../providers/mock.js';
import { buildUserPrompt, SYSTEM } from './prompt.js';
import { extractJson, validateDiagram } from '../../shared/diagramSchema.js';

/** Provider registry: add an entry here to support a new backend. */
const PROVIDERS = {
  openrouter: openrouterComplete,
  qwen: openrouterComplete, // Qwen is reached through OpenRouter
  mock: mockComplete,
};

export class AIError extends Error {
  constructor(message, { status = 500, kind = 'server' } = {}) {
    super(message);
    this.name = 'AIError';
    this.status = status;
    this.kind = kind;
  }
}

/** Which provider will actually serve a request, after fallbacks. */
export function resolveProvider() {
  const requested = config.provider;
  if (PROVIDERS[requested] && providerReady()) return requested;
  if (requested !== 'mock') return 'mock';
  return 'mock';
}

export function describeProvider() {
  const active = resolveProvider();
  return {
    provider: active,
    model: active === 'mock' ? 'mock-provider' : config.model,
    configured: config.provider,
    ready: providerReady(),
    /** True when a real conversion can happen (explicit mock mode counts). */
    available: active !== 'mock' || config.provider === 'mock',
    // Never the key itself — just whether one exists.
    hasKey: Boolean(config.openrouter.apiKey),
  };
}

/**
 * Turn a base64 PNG of the board into a validated semantic diagram.
 * @param {{imageBase64:string, hint?:string, signal?:AbortSignal}} req
 */
export async function generateDiagram({ imageBase64, hint, signal }) {
  const active = resolveProvider();
  const complete = PROVIDERS[active];
  if (!complete) throw new AIError('No AI provider is available.', { status: 503, kind: 'unavailable' });

  const messages = active === 'mock'
    ? [{ role: 'user', content: buildUserPrompt(hint) }]
    : [{
      role: 'system',
      content: SYSTEM,
    }, {
      role: 'user',
      content: [
        { type: 'text', text: buildUserPrompt(hint) },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
      ],
    }];

  let out;
  try {
    out = await complete({ messages, maxTokens: config.limits.maxTokens, signal, timeoutMs: config.limits.timeoutMs });
  } catch (err) {
    if (err?.kind) throw new AIError(err.message, { status: err.status || 502, kind: err.kind });
    throw new AIError('The AI provider could not be reached.', { status: 502, kind: 'upstream' });
  }

  // Never trust raw LLM output: parse defensively, then validate hard.
  const parsed = extractJson(out.text);
  if (!parsed) {
    throw new AIError('The model did not return usable JSON.', { status: 502, kind: 'invalid_response' });
  }

  const result = validateDiagram(parsed);
  if (!result.ok) {
    throw new AIError(`The model returned an invalid diagram: ${result.errors.join(' ')}`, { status: 502, kind: 'invalid_response' });
  }

  return { diagram: result.diagram, warnings: result.warnings, provider: active, model: out.model };
}

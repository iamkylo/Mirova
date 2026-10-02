import { config } from '../config.js';

/**
 * OpenRouter chat-completions adapter. Works with any vision model OpenRouter
 * serves (Qwen-VL by default); swap it via AI_MODEL without touching code.
 *
 * The API key is read from the environment on every call and is never
 * returned, logged, or included in an error message.
 */
export async function openrouterComplete({ messages, maxTokens, signal, timeoutMs }) {
  const { apiKey, baseUrl } = config.openrouter;
  if (!apiKey) throw Object.assign(new Error('OPENROUTER_API_KEY is not configured on the server.'), { status: 503, kind: 'unavailable' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  // Honour an upstream abort (client navigated away) too.
  const onOuterAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onOuterAbort, { once: true });

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(config.openrouter.referer ? { 'HTTP-Referer': config.openrouter.referer } : {}),
        ...(config.openrouter.title ? { 'X-Title': config.openrouter.title } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.2,
        max_tokens: maxTokens,
      }),
    });

    if (!res.ok) {
      const responseText = await res.text().catch(() => '');
      let responseBody = null;
      try { responseBody = JSON.parse(responseText); } catch { /* Provider errors may not be JSON. */ }
      const detail = typeof responseBody?.error?.metadata?.raw === 'string'
        ? responseBody.error.metadata.raw
        : responseBody?.error?.message || responseText.slice(0, 300);
      const kind = res.status === 401 || res.status === 403 ? 'unavailable'
        : res.status === 429 ? 'rate_limited'
        : res.status === 402 ? 'unavailable'
        : 'upstream';
      const status = kind === 'unavailable' ? 503 : kind === 'rate_limited' ? 429 : 502;
      const message = kind === 'rate_limited'
        ? 'The selected model is temporarily rate-limited. Wait a moment and retry, or choose another model.'
        : res.status === 403 && /only available on agentic harnesses/i.test(detail)
          ? 'This model requires an agentic harness and cannot be used with Mirova. Choose a standard chat-completions vision model.'
          : kind === 'unavailable'
            ? 'OpenRouter cannot serve this model request. Check model access and endpoint requirements, or choose another model.'
            : `Provider responded ${res.status}${detail ? `: ${detail}` : ''}`;
      throw Object.assign(
        new Error(message),
        { status, kind }
      );
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) {
      throw Object.assign(new Error('Provider returned an empty completion.'), { status: 502, kind: 'upstream' });
    }
    return { text, model: data?.model || config.model };
  } catch (err) {
    if (err?.name === 'AbortError' || err?.message === 'timeout') {
      throw Object.assign(new Error('The model took too long to respond.'), { status: 504, kind: 'timeout' });
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

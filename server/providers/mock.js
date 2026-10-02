/**
 * Offline provider used when AI_PROVIDER=mock, or as an automatic fallback
 * when no API key is present. Lets the whole capture → validate → layout →
 * render pipeline be exercised without spending a token.
 *
 * Returns prose + a fenced block on purpose, so extractJson() gets tested too.
 */
const FIXTURE = {
  title: 'Request Pipeline',
  diagramType: 'architecture',
  summary: 'Mock provider: a four-node request pipeline with a cache branch.',
  nodes: [
    { id: 'client', label: 'Client', shape: 'rect', group: 'edge' },
    { id: 'api', label: 'API Gateway', shape: 'rect', group: 'edge' },
    { id: 'cache', label: 'Cache', shape: 'cylinder', group: 'data' },
    { id: 'auth', label: 'Authorised?', shape: 'diamond', group: null },
    { id: 'db', label: 'Database', shape: 'cylinder', group: 'data' },
  ],
  edges: [
    { from: 'client', to: 'api', label: 'HTTPS', style: 'solid', directed: true },
    { from: 'api', to: 'auth', label: null, style: 'solid', directed: true },
    { from: 'auth', to: 'cache', label: 'yes', style: 'solid', directed: true },
    { from: 'auth', to: 'db', label: 'no', style: 'dashed', directed: true },
    { from: 'cache', to: 'db', label: 'miss', style: 'solid', directed: true },
  ],
};

export async function mockComplete() {
  await new Promise(r => setTimeout(r, 350));
  return {
    text: `Here is the structure I found.\n\n\`\`\`json\n${JSON.stringify(FIXTURE, null, 2)}\n\`\`\``,
    model: 'mock-provider',
  };
}

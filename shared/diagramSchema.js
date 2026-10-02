/**
 * Canonical schema for the semantic diagram the AI returns.
 *
 * Shared by the Express backend (authoritative gate) and the browser
 * (defense in depth, so a compromised or buggy backend still cannot push
 * garbage into the canvas). Nothing here trusts its input: every field is
 * type-checked, length-capped and control-character scrubbed, and anything
 * that does not fit is dropped rather than passed through.
 *
 * Deliberately contains NO geometry. The model returns semantics only;
 * layout is computed on the client by src/ai/layout.js.
 */

export const DIAGRAM_VERSION = 1;

export const SHAPES = ['rect', 'circle', 'diamond', 'cylinder'];
export const EDGE_STYLES = ['solid', 'dashed'];
export const DIAGRAM_TYPES = ['flowchart', 'architecture', 'sequence', 'mindmap', 'er', 'org', 'generic'];

export const LIMITS = {
  nodes: 40,
  edges: 80,
  idLen: 32,
  labelLen: 120,
  groupLen: 40,
  titleLen: 80,
  summaryLen: 400,
  typeLen: 32,
  labelLines: 4,
};

/** Strip control characters (keep \n for real multi-line labels) and collapse runs of spaces. */
function cleanText(v, max, { newlines = false } = {}) {
  if (typeof v !== 'string') return null;
  let s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  s = newlines
    ? s.split('\n').map(ln => ln.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, LIMITS.labelLines).join('\n')
    : s.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function asBool(v, fallback) {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
}

function oneOf(v, allowed, fallback) {
  return typeof v === 'string' && allowed.includes(v) ? v : fallback;
}

/**
 * @param {unknown} input raw parsed JSON from the model
 * @returns {{ok:true, diagram:object, warnings:string[]} | {ok:false, errors:string[], warnings:string[]}}
 */
export function validateDiagram(input) {
  const errors = [];
  const warnings = [];

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['Response is not a JSON object.'], warnings };
  }

  const rawNodes = input.nodes;
  const rawEdges = input.edges;

  if (rawNodes !== undefined && !Array.isArray(rawNodes)) errors.push('"nodes" must be an array.');
  if (rawEdges !== undefined && !Array.isArray(rawEdges)) errors.push('"edges" must be an array.');
  if (errors.length) return { ok: false, errors, warnings };

  /* ── nodes ── */
  const nodes = [];
  const ids = new Set();
  const list = Array.isArray(rawNodes) ? rawNodes : [];
  if (list.length > LIMITS.nodes) warnings.push(`Kept the first ${LIMITS.nodes} of ${list.length} nodes.`);

  for (const raw of list.slice(0, LIMITS.nodes)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { warnings.push('Dropped a malformed node.'); continue; }

    let id = cleanText(raw.id ?? raw.nodeId ?? raw.key, LIMITS.idLen);
    if (id) id = id.replace(/\s+/g, '_');
    if (!id) { warnings.push('Dropped a node with no usable id.'); continue; }
    if (ids.has(id)) { warnings.push(`Dropped duplicate node id "${id}".`); continue; }

    const label = cleanText(raw.label ?? raw.text ?? raw.name, LIMITS.labelLen, { newlines: true }) || id;
    ids.add(id);
    nodes.push({
      id,
      label,
      shape: oneOf(raw.shape ?? raw.type, SHAPES, 'rect'),
      group: cleanText(raw.group ?? raw.cluster ?? raw.layer, LIMITS.groupLen),
    });
  }

  /* ── edges ── */
  const edges = [];
  const seen = new Set();
  const elist = Array.isArray(rawEdges) ? rawEdges : [];
  if (elist.length > LIMITS.edges) warnings.push(`Kept the first ${LIMITS.edges} of ${elist.length} edges.`);

  for (const raw of elist.slice(0, LIMITS.edges)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { warnings.push('Dropped a malformed edge.'); continue; }

    const from = cleanText(raw.from ?? raw.source ?? raw.start, LIMITS.idLen)?.replace(/\s+/g, '_');
    const to = cleanText(raw.to ?? raw.target ?? raw.end, LIMITS.idLen)?.replace(/\s+/g, '_');
    if (!from || !to) { warnings.push('Dropped an edge missing an endpoint.'); continue; }
    if (!ids.has(from) || !ids.has(to)) { warnings.push(`Dropped edge ${from} → ${to}: unknown node.`); continue; }
    if (from === to) { warnings.push(`Dropped self-loop on "${from}".`); continue; }

    const label = cleanText(raw.label ?? raw.text, LIMITS.labelLen);
    const key = `${from}\u0000${to}\u0000${label ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    edges.push({
      from,
      to,
      label,
      style: oneOf(raw.style, EDGE_STYLES, 'solid'),
      directed: asBool(raw.directed ?? raw.arrow, true),
    });
  }

  if (nodes.length === 0 && list.length > 0) warnings.push('No node survived validation.');

  return {
    ok: true,
    warnings,
    diagram: {
      version: DIAGRAM_VERSION,
      title: cleanText(input.title, LIMITS.titleLen),
      diagramType: oneOf(input.diagramType, DIAGRAM_TYPES, null),
      summary: cleanText(input.summary ?? input.description, LIMITS.summaryLen),
      nodes,
      edges,
    },
  };
}

/** True when the model looked at the sketch and found no diagram in it. */
export function isEmptyDiagram(d) {
  return !d || (d.nodes.length === 0 && d.edges.length === 0);
}

/**
 * Pull a JSON object out of a model response that may be wrapped in prose or
 * ```json fences. Returns null when nothing parseable is found.
 */
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  const direct = tryParse(text);
  if (direct) return direct;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const v = tryParse(fenced[1]);
    if (v) return v;
  }

  // Last resort: outermost balanced braces.
  const start = text.indexOf('{');
  if (start !== -1) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { const v = tryParse(text.slice(start, i + 1)); if (v) return v; } }
    }
  }
  return null;
}

function tryParse(s) {
  try {
    const v = JSON.parse(String(s).trim());
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

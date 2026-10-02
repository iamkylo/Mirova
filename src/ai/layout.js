/**
 * Semantic diagram → geometry.
 *
 * The model never sends coordinates (it is bad at them, and untrusted input
 * with pixel values is a liability). It sends a graph; this module turns that
 * graph into a layered layout — ranks, ordering, node sizes, edge routes —
 * using Mirova's own text metrics so labels always fit their shapes.
 */
import { FONT_SZ, measureTextBlock } from '../engine/mirovaEngine.js';

export const NODE_FS = FONT_SZ[0];
export const TITLE_FS = FONT_SZ[1];

const PAD_X = 26;
const PAD_Y = 18;
const MIN_W = 96;
const MIN_H = 56;
const RANK_GAP = 110;
const NODE_GAP = 40;
const MARGIN = 40;
const ELBOW = 26;

/* ── sizing ────────────────────────────────────────────────────── */

function sizeNode(n) {
  const m = measureTextBlock(n.label, NODE_FS);
  const baseW = Math.max(MIN_W, m.width + PAD_X * 2);
  const baseH = Math.max(MIN_H, m.height + PAD_Y * 2);
  n.fs = NODE_FS;

  switch (n.shape) {
    case 'circle': {
      // Big enough that the label fits the inscribed square, not just the box.
      const d = Math.max(baseW, baseH) * 1.45;
      n.w = d; n.h = d;
      break;
    }
    case 'diamond':
      n.w = Math.max(baseW * 1.5, MIN_W * 1.4);
      n.h = Math.max(baseH * 1.75, MIN_H * 1.4);
      break;
    case 'cylinder': {
      n.ry = Math.min(14, Math.max(8, baseW * 0.09));
      n.w = baseW;
      n.h = baseH + n.ry * 2;
      break;
    }
    default:
      n.w = baseW; n.h = baseH;
  }
}

/* ── layering ──────────────────────────────────────────────────── */

/**
 * Longest-path layering. Back edges (cycles) are dropped first via DFS so the
 * ranking always terminates; they still get drawn, just not ranked by.
 */
function assignLevels(count, adj) {
  const state = new Array(count).fill(0); // 0 new, 1 on stack, 2 done
  const dag = Array.from({ length: count }, () => []);

  const dfs = u => {
    state[u] = 1;
    for (const v of adj[u]) {
      if (state[v] === 1) continue;
      if (state[v] === 0) dfs(v);
      dag[u].push(v);
    }
    state[u] = 2;
  };
  for (let i = 0; i < count; i++) if (state[i] === 0) dfs(i);

  const remaining = new Array(count).fill(0);
  for (let u = 0; u < count; u++) for (const v of dag[u]) remaining[v]++;

  const level = new Array(count).fill(0);
  const queue = [];
  for (let i = 0; i < count; i++) if (remaining[i] === 0) queue.push(i);

  while (queue.length) {
    const u = queue.shift();
    for (const v of dag[u]) {
      if (level[v] < level[u] + 1) level[v] = level[u] + 1;
      if (--remaining[v] === 0) queue.push(v);
    }
  }
  return level;
}

/** Order nodes inside each rank by neighbour barycentre, groups kept adjacent. */
function orderLayers(nodes, edges, levels) {
  const count = nodes.length;
  const maxLevel = levels.reduce((m, v) => Math.max(m, v), 0);
  const layers = Array.from({ length: maxLevel + 1 }, () => []);
  nodes.forEach((_, i) => layers[levels[i]].push(i));

  const groupOf = i => nodes[i].group || '';
  for (const layer of layers) layer.sort((a, b) => groupOf(a).localeCompare(groupOf(b)) || a - b);

  const up = Array.from({ length: count }, () => []);
  const down = Array.from({ length: count }, () => []);
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  for (const e of edges) {
    const a = idx.get(e.from), b = idx.get(e.to);
    if (levels[a] === levels[b]) continue;
    if (levels[a] < levels[b]) { down[a].push(b); up[b].push(a); }
    else { down[b].push(a); up[a].push(b); }
  }

  const pos = new Map();
  const reindex = layer => layer.forEach((ni, k) => pos.set(ni, k));
  layers.forEach(reindex);

  for (let sweep = 0; sweep < 4; sweep++) {
    const downward = sweep % 2 === 0;
    const order = layers.map((_, i) => i);
    if (!downward) order.reverse();
    for (const li of order) {
      const neighbours = downward ? up : down;
      const keyed = layers[li].map(ni => {
        const ns = neighbours[ni];
        const b = ns.length
          ? ns.reduce((sum, o) => sum + (pos.get(o) ?? 0), 0) / ns.length
          : pos.get(ni) ?? 0;
        return { ni, b };
      });
      keyed.sort((a, b) => a.b - b.b || a.ni - b.ni);
      layers[li] = keyed.map(k => k.ni);
      reindex(layers[li]);
    }
  }
  return layers;
}

/* ── placement ─────────────────────────────────────────────────── */

/**
 * Assigns x/y/w/h to every node for one flow direction and returns the
 * resulting canvas size. Called for both directions; the better aspect wins.
 */
function place(nodes, layers, horizontal) {
  let rankOffset = MARGIN;
  const crossSizes = [];

  for (const layer of layers) {
    const rankSize = Math.max(...layer.map(i => (horizontal ? nodes[i].w : nodes[i].h)));
    const sizes = layer.map(i => (horizontal ? nodes[i].h : nodes[i].w));
    const cross = sizes.reduce((s, v) => s + v, 0) + NODE_GAP * Math.max(0, layer.length - 1);
    crossSizes.push(cross);

    let cursor = MARGIN;
    layer.forEach((i, k) => {
      if (horizontal) { nodes[i].x = rankOffset; nodes[i].y = cursor; }
      else { nodes[i].y = rankOffset; nodes[i].x = cursor; }
      cursor += sizes[k] + NODE_GAP;
    });
    rankOffset += rankSize + RANK_GAP;
  }

  const maxCross = Math.max(...crossSizes);
  layers.forEach((layer, li) => {
    const shift = (maxCross - crossSizes[li]) / 2;
    for (const i of layer) {
      if (horizontal) nodes[i].y += shift; else nodes[i].x += shift;
    }
  });

  const rankEnd = rankOffset - RANK_GAP + MARGIN;
  return horizontal
    ? { width: rankEnd, height: maxCross + MARGIN * 2 }
    : { width: maxCross + MARGIN * 2, height: rankEnd };
}

/* ── edge routing ──────────────────────────────────────────────── */

function routeTB(S, T, box) {
  if (T.level > S.level) {
    const a = { x: S.cx, y: S.y + S.h };
    const b = { x: T.cx, y: T.y };
    if (Math.abs(a.x - b.x) < 1) return [a, b];
    const my = (a.y + b.y) / 2;
    return [a, { x: a.x, y: my }, { x: b.x, y: my }, b];
  }
  if (T.level < S.level) {
    const a = { x: S.cx, y: S.y };
    const b = { x: T.cx, y: T.y + T.h };
    const sideX = b.x >= a.x ? box.x1 + 46 : box.x0 - 46;
    return [
      a,
      { x: a.x, y: a.y - ELBOW },
      { x: sideX, y: a.y - ELBOW },
      { x: sideX, y: b.y + ELBOW },
      { x: b.x, y: b.y + ELBOW },
      b,
    ];
  }
  const a = { x: S.cx, y: S.y };
  const b = { x: T.cx, y: T.y };
  const top = Math.min(S.y, T.y) - ELBOW;
  return [a, { x: a.x, y: top }, { x: b.x, y: top }, b];
}

function routeLR(S, T, box) {
  if (T.level > S.level) {
    const a = { x: S.x + S.w, y: S.cy };
    const b = { x: T.x, y: T.cy };
    if (Math.abs(a.y - b.y) < 1) return [a, b];
    const mx = (a.x + b.x) / 2;
    return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
  }
  if (T.level < S.level) {
    const a = { x: S.x, y: S.cy };
    const b = { x: T.x + T.w, y: T.cy };
    const sideY = b.y >= a.y ? box.y1 + 46 : box.y0 - 46;
    return [
      a,
      { x: a.x - ELBOW, y: a.y },
      { x: a.x - ELBOW, y: sideY },
      { x: b.x + ELBOW, y: sideY },
      { x: b.x + ELBOW, y: b.y },
      b,
    ];
  }
  const a = { x: S.x, y: S.cy };
  const b = { x: T.x + T.w, y: T.cy };
  const left = Math.min(S.x, T.x) - ELBOW;
  return [a, { x: left, y: a.y }, { x: left, y: b.y }, b];
}

/** Midpoint of the longest run, nudged perpendicular so it clears the line. */
function labelAnchor(pts) {
  let best = -1, bi = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    if (d > best) { best = d; bi = i; }
  }
  const a = pts[bi], b = pts[bi + 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let px = -dy / len, py = dx / len;
  if (py > 0) { px = -px; py = -py; }
  return { x: (a.x + b.x) / 2 + px * 15, y: (a.y + b.y) / 2 + py * 15 };
}

/* ── entry point ───────────────────────────────────────────────── */

/**
 * @param {{title?:string|null, summary?:string|null, nodes:any[], edges:any[]}} diagram validated semantic diagram
 * @returns {{empty:boolean, nodes:any[], edges:any[], width:number, height:number,
 *            direction:'TB'|'LR', title:string|null, summary:string|null}}
 */
export function layoutDiagram(diagram) {
  const title = diagram.title ?? null;
  const summary = diagram.summary ?? null;

  const nodes = diagram.nodes.map(n => ({ ...n, level: 0 }));
  if (!nodes.length) return { empty: true, nodes: [], edges: [], width: 0, height: 0, direction: 'TB', title, summary };

  nodes.forEach(sizeNode);

  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const edges = diagram.edges.filter(e => idx.has(e.from) && idx.has(e.to));

  const adj = Array.from({ length: nodes.length }, () => []);
  for (const e of edges) adj[idx.get(e.from)].push(idx.get(e.to));

  const levels = assignLevels(nodes.length, adj);
  nodes.forEach((n, i) => { n.level = levels[i]; });
  const layers = orderLayers(nodes, edges, levels);

  const aspect = (typeof window !== 'undefined' && window.innerHeight)
    ? window.innerWidth / window.innerHeight
    : 1.6;

  const vertical = place(nodes, layers, false);
  const horizontal = place(nodes, layers, true);
  const score = d => Math.abs(Math.log((d.width / d.height) / aspect));
  const isHorizontal = score(horizontal) < score(vertical) - 0.05;

  // place() writes x/y onto the shared nodes, so the winning orientation has
  // to be the last call — otherwise routing reads the losing layout's geometry.
  const dims = isHorizontal ? horizontal : place(nodes, layers, false);

  for (const n of nodes) { n.cx = n.x + n.w / 2; n.cy = n.y + n.h / 2; }

  const box = nodes.reduce((b, n) => ({
    x0: Math.min(b.x0, n.x), y0: Math.min(b.y0, n.y),
    x1: Math.max(b.x1, n.x + n.w), y1: Math.max(b.y1, n.y + n.h),
  }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });

  const byId = new Map(nodes.map(n => [n.id, n]));
  const routed = edges.map(e => {
    const S = byId.get(e.from), T = byId.get(e.to);
    const points = isHorizontal ? routeLR(S, T, box) : routeTB(S, T, box);
    const anchor = e.label ? labelAnchor(points) : null;
    return { ...e, points, anchor };
  });

  return {
    empty: false,
    nodes,
    edges: routed,
    width: dims.width,
    height: dims.height,
    direction: isHorizontal ? 'LR' : 'TB',
    title,
    summary,
  };
}

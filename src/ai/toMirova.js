/**
 * THE ADAPTER.
 *
 * Semantic diagram → Mirova's native stroke objects, and nothing else. Every
 * value it emits is one of the four shapes renderStroke() understands, with
 * colours, widths and font sizes snapped to the palette the binary codec can
 * actually serialise. The existing canvas renderer, undo history, eraser and
 * share-link codec all keep working on AI output for free, and the result
 * stays fully hand-editable.
 */
import { COLORS, PEN_W, FONT_SZ, measureTextBlock, contentBounds } from '../engine/mirovaEngine.js';
import { TITLE_FS } from './layout.js';

const NODE_W = PEN_W[1]; // 6
const EDGE_W = PEN_W[0]; // 2

/**
 * renderStroke() smooths with quadraticCurveTo through segment midpoints, so a
 * bare 5-point rectangle would come out as a blob — every corner gets cut by
 * roughly half the point spacing. Densifying makes straight runs exact and
 * limits corner rounding to STEP/4 pixels.
 */
const STEP = 6;
const ARROW_STEP = 4;

function densify(pts, step = STEP) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let k = 0; k < n; k++) {
      out.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n });
    }
  }
  out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });
  return out;
}

/**
 * Closed polygon whose path starts mid-edge rather than on a vertex, so the
 * one corner the renderer cannot smooth (the moveTo/lineTo seam) lands on a
 * straight run instead of being visibly sharp next to three soft ones.
 */
function closedPoly(vertices) {
  const start = {
    x: (vertices[0].x + vertices[1].x) / 2,
    y: (vertices[0].y + vertices[1].y) / 2,
  };
  return densify([start, ...vertices.slice(1), vertices[0], start]);
}

const pen = (pts, color, w = NODE_W) => ({ type: 'pen', color, w, pts });

function arc(cx, cy, rx, ry, a0, a1, steps = 28) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = a0 + (a1 - a0) * i / steps;
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
  });
}

/**
 * Mirova stores text as (x, y) = left edge of line 1 at its BASELINE. Convert
 * a desired optical centre into that.
 */
function centeredText(text, cx, cy, fs, color) {
  const m = measureTextBlock(text, fs);
  const lines = m.lines;
  const visualHeight = (lines - 1) * fs * 1.35 + fs * 1.1;
  return {
    type: 'text',
    text,
    color,
    x: cx - m.width / 2,
    y: cy + fs * 0.8 - visualHeight / 2,
    fs,
  };
}

function dashedSegments(pts, dash = 13, gap = 10) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = cum[cum.length - 1];
  if (Math.ceil(total / (dash + gap)) > 60) return null; // too many; draw solid

  const at = d => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const span = cum[i] - cum[i - 1] || 1;
    const t = (d - cum[i - 1]) / span;
    return {
      x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
      y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
    };
  };

  const segs = [];
  for (let d = 0; d < total; d += dash + gap) {
    segs.push([at(d), at(Math.min(total, d + dash))]);
  }
  return segs;
}

function arrowHead(tip, prev, size = 15, spread = 0.44) {
  const a = Math.atan2(tip.y - prev.y, tip.x - prev.x);
  return densify([
    { x: tip.x - size * Math.cos(a - spread), y: tip.y - size * Math.sin(a - spread) },
    { x: tip.x, y: tip.y },
    { x: tip.x - size * Math.cos(a + spread), y: tip.y - size * Math.sin(a + spread) },
  ], ARROW_STEP);
}

/** Snap an arbitrary colour request onto the six the codec can store. */
function palette(i) {
  return COLORS[((i % COLORS.length) + COLORS.length) % COLORS.length];
}

/**
 * @param {ReturnType<import('./layout.js').layoutDiagram>} layout
 * @param {{origin?:{x:number,y:number}}} [opts] translate the whole diagram (used by "Add beside sketch")
 * @returns {Array} Mirova strokes, ready for engine.applyStrokes / appendStrokes
 */
export function diagramToStrokes(layout, opts = {}) {
  if (!layout || layout.empty) return [];

  /* Group → colour. One group means a monochrome diagram with tinted edges,
   * which is the calmest look; several groups get the muted tints. */
  const groups = [...new Set(layout.nodes.map(n => n.group).filter(Boolean))];
  const multi = groups.length > 1;
  const byId = new Map(layout.nodes.map(n => [n.id, n]));
  const nodeColor = n => (multi && n?.group ? palette(groups.indexOf(n.group) + 1) : COLORS[0]);
  const edgeColor = e => (multi ? nodeColor(byId.get(e.from)) : palette(3));

  const raw = [];

  for (const n of layout.nodes) {
    const color = nodeColor(n);
    const { x, y, w, h, cx, cy } = n;

    switch (n.shape) {
      case 'circle':
        raw.push({ type: 'circle', cx, cy, r: Math.max(w, h) / 2, color, w: NODE_W });
        break;
      case 'diamond':
        raw.push(pen(closedPoly([
          { x: cx, y }, { x: x + w, y: cy }, { x: cx, y: y + h }, { x, y: cy },
        ]), color));
        break;
      case 'cylinder': {
        const rx = w / 2, ry = n.ry || 12;
        const topCy = y + ry, botCy = y + h - ry;
        raw.push(pen(densify([
          ...arc(cx, topCy, rx, ry, Math.PI, Math.PI * 2),
          ...arc(cx, botCy, rx, ry, 0, Math.PI),
          { x, y: topCy },
        ]), color));
        // Front rim of the top ellipse, so it reads as a cylinder not a rect.
        raw.push(pen(densify(arc(cx, topCy, rx, ry, 0, Math.PI)), color));
        break;
      }
      default:
        raw.push(pen(closedPoly([
          { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
        ]), color));
    }

    raw.push(centeredText(n.label, cx, cy, n.fs || FONT_SZ[0], color));
  }

  for (const e of layout.edges) {
    const color = edgeColor(e);
    const pts = e.points;

    if (e.style === 'dashed') {
      const segs = dashedSegments(pts);
      if (segs) {
        for (const [a, b] of segs) raw.push(pen([a, b], color, EDGE_W));
      } else {
        raw.push(pen(densify(pts), color, EDGE_W));
      }
    } else {
      raw.push(pen(densify(pts), color, EDGE_W));
    }

    if (e.directed && pts.length >= 2) {
      raw.push(pen(arrowHead(pts[pts.length - 1], pts[pts.length - 2]), color, EDGE_W));
    }
    if (e.label && e.anchor) {
      raw.push(centeredText(e.label, e.anchor.x, e.anchor.y, FONT_SZ[0], color));
    }
  }

  if (layout.title) {
    raw.push(centeredText(layout.title, layout.width / 2, -58, TITLE_FS, COLORS[0]));
  }

  /* Normalise to a non-negative origin, then apply the caller's offset. Keeps
   * every coordinate well inside the ±32767 the share-link codec can store. */
  const b = contentBounds(raw);
  const dx = (opts.origin?.x ?? 0) - (b?.x0 ?? 0);
  const dy = (opts.origin?.y ?? 0) - (b?.y0 ?? 0);
  if (!dx && !dy) return raw;

  return raw.map(s => {
    if (s.type === 'text') return { ...s, x: s.x + dx, y: s.y + dy };
    if (s.type === 'circle') return { ...s, cx: s.cx + dx, cy: s.cy + dy };
    return { ...s, pts: s.pts.map(p => ({ x: p.x + dx, y: p.y + dy })) };
  });
}

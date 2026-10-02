/**
 * Cicada canvas engine.
 *
 * Migrated from the original single-file scripts.js. The drawing, rendering,
 * simplification, shape-recognition, viewport and binary-codec behaviour is
 * unchanged; what changed is the shape of the module:
 *
 *   - pure helpers live at module scope so other code (AI capture / mapping)
 *     can reuse the exact same renderer and codec the whiteboard uses
 *   - everything that touches DOM or mutable board state lives inside
 *     createCicadaEngine(), which returns an imperative handle + destroy()
 *
 * High-frequency work (pointer moves, wheel, rAF redraws) stays in here.
 * React never sees it.
 */

export const COLORS = ['#363028', '#8D5142', '#4B725E', '#4F6785', '#79613F', '#705779', '#667085'];
export const DARK_COLORS = ['#75A7FF', '#F2C94C', '#FF9F43', '#FF7777', '#9FD86B', '#56D6C9', '#F4F1E8'];
const LEGACY_COLORS = ['#363028', '#C9A89A', '#8FA89A', '#8A9BAE', '#C4B49A', '#A898AE'];
const LEGACY_DARK_COLORS = ['#e8d44d', '#7ec878', '#5ec4b6', '#7ab4d4', '#e8a84d', '#c78ec8', '#ffffff'];
export const PEN_W = [2, 6, 16];
export const ERASER_W = [28, 60, 110];
export const FONT_SZ = [22, 36, 60];
export const RDP_EPS = [1.5, 3, 6];
export const MIN_SCALE = 0.05, MAX_SCALE = 20, MIN_D2 = 4;
export const TOOLS = ['pen', 'text', 'eraser'];

export const dpr = Math.min(window.devicePixelRatio || 1, 2);

const MAX_BOARD_IMAGE_DATA_URL = 750_000;
const BOARD_IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const BOARD_IMAGE_CACHE = new Map();

const isBoardImageDataUrl = src => typeof src === 'string'
  && src.length <= MAX_BOARD_IMAGE_DATA_URL
  && BOARD_IMAGE_DATA_URL.test(src);

async function cacheBoardImage(src) {
  if (!isBoardImageDataUrl(src)) throw new Error('Unsupported or oversized board image.');
  if (BOARD_IMAGE_CACHE.has(src)) return BOARD_IMAGE_CACHE.get(src);
  const image = new Image();
  image.decoding = 'async';
  image.src = src;
  await image.decode();
  BOARD_IMAGE_CACHE.set(src, image);
  return image;
}

/** Mutable dark-mode flag so the renderer and engine can adapt */
let _darkMode = false;
export const isDarkMode = () => _darkMode;
export const setDarkModeFlag = (v) => { _darkMode = v; };

const TEXT_FONT_FAMILY = "'Absans',Georgia,serif";
export const TEXT_FONT = fs => `${fs}px ${TEXT_FONT_FAMILY}`;

/** Get active color palette based on current theme */
export const getColors = () => _darkMode ? DARK_COLORS : COLORS;

const colorIndex = color => {
  const lightIndex = COLORS.indexOf(color);
  if (lightIndex >= 0) return lightIndex;
  const legacyIndex = LEGACY_COLORS.indexOf(color);
  if (legacyIndex >= 0) return legacyIndex;
  const darkIndex = DARK_COLORS.indexOf(color);
  if (darkIndex >= 0) return darkIndex;
  return LEGACY_DARK_COLORS.indexOf(color);
};

const themedColor = color => {
  const index = colorIndex(color);
  if (index < 0) return color;
  return (_darkMode ? DARK_COLORS : COLORS)[index];
};

/* ── pure geometry / measurement ─────────────────────────────── */

let _mctx = null;
const measureCtx = () => (_mctx ||= document.createElement('canvas').getContext('2d'));

/** Width/height of a text stroke as renderStroke will paint it. */
export function measureTextBlock(text, fs) {
  const ctx = measureCtx();
  ctx.font = TEXT_FONT(fs);
  const lines = String(text ?? '').split('\n');
  let width = 0;
  for (const ln of lines) width = Math.max(width, ctx.measureText(ln).width);
  return { width, lines: lines.length, height: (lines.length - 1) * fs * 1.35 + fs };
}

/** World-space bounding box of a stroke list, or null when empty. */
export function contentBounds(strokes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes || []) {
    if (s.type === 'text') {
      const m = measureTextBlock(s.text, s.fs);
      x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y - s.fs * 0.8);
      x1 = Math.max(x1, s.x + m.width); y1 = Math.max(y1, s.y + (m.lines - 1) * s.fs * 1.35 + s.fs * 0.3);
    } else if (s.type === 'circle') {
      x0 = Math.min(x0, s.cx - s.r); y0 = Math.min(y0, s.cy - s.r);
      x1 = Math.max(x1, s.cx + s.r); y1 = Math.max(y1, s.cy + s.r);
    } else if (s.type === 'image') {
      x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y);
      x1 = Math.max(x1, s.x + s.width); y1 = Math.max(y1, s.y + s.height);
    } else if (s.pts?.length) {
      const pad = (s.w || 0) / 2;
      for (const p of s.pts) {
        x0 = Math.min(x0, p.x - pad); y0 = Math.min(y0, p.y - pad);
        x1 = Math.max(x1, p.x + pad); y1 = Math.max(y1, p.y + pad);
      }
    }
  }
  if (x0 === Infinity) return null;
  return { x0, y0, x1, y1, width: x1 - x0, height: y1 - y0 };
}

export function rdp(pts, eps) {
  if (pts.length <= 2) return pts;
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  let mx = 0, mi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = len2 === 0 ? Math.hypot(pts[i].x - a.x, pts[i].y - a.y)
      : Math.abs(dy * pts[i].x - dx * pts[i].y + b.x * a.y - b.y * a.x) / Math.sqrt(len2);
    if (d > mx) { mx = d; mi = i; }
  }
  return mx > eps
    ? [...rdp(pts.slice(0, mi + 1), eps).slice(0, -1), ...rdp(pts.slice(mi), eps)]
    : [a, b];
}

export function simplify(s) {
  if (s.type === 'text' || !s.pts || s.pts.length <= 2) return s;
  return { ...s, pts: rdp(s.pts, s.type === 'eraser' ? 10 : (RDP_EPS[PEN_W.indexOf(s.w)] ?? 2)) };
}

export function detectCircle(pts) {
  const n = pts.length;
  if (n < 12) return null;
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;
  let sumD = 0, sumD2 = 0, arcLen = 0;
  const d = new Array(n);
  for (let i = 0; i < n; i++) {
    d[i] = Math.hypot(pts[i].x - cx, pts[i].y - cy); sumD += d[i];
    if (i) arcLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  const r = sumD / n;
  if (r < 10) return null;
  for (let i = 0; i < n; i++) sumD2 += (d[i] - r) ** 2;
  if (Math.sqrt(sumD2 / n) / r > 0.26 || arcLen < Math.PI * r * 1.5) return null;
  if (Math.hypot(pts[0].x - pts[n - 1].x, pts[0].y - pts[n - 1].y) > r * 0.55) return null;
  return { cx, cy, r };
}

const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function cleanCorners(points, minLength) {
  const clean = [];
  for (const point of points) {
    if (!clean.length || pointDistance(clean[clean.length - 1], point) >= minLength) clean.push(point);
  }
  let changed = true;
  while (changed && clean.length > 3) {
    changed = false;
    for (let i = 0; i < clean.length; i++) {
      const prev = clean[(i + clean.length - 1) % clean.length];
      const curr = clean[i];
      const next = clean[(i + 1) % clean.length];
      const ax = curr.x - prev.x, ay = curr.y - prev.y;
      const bx = next.x - curr.x, by = next.y - curr.y;
      const lengths = Math.hypot(ax, ay) * Math.hypot(bx, by);
      if (lengths && ax * bx + ay * by > 0 && Math.abs(ax * by - ay * bx) / lengths < 0.2) {
        clean.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return clean;
}

function detectArrow(points, diagonal) {
  const tolerance = Math.max(2, diagonal * 0.015);
  const simplified = rdp(points, tolerance);
  const compact = [];
  for (const point of simplified) {
    if (!compact.length || pointDistance(compact[compact.length - 1], point) >= tolerance) compact.push(point);
  }

  for (const path of [compact, [...compact].reverse()]) {
    for (let i = 1; i + 3 < path.length; i++) {
      const tail = path[0], tip = path[i], firstWing = path[i + 1];
      const returnTip = path[i + 2], secondWing = path[i + 3];
      const shaft = pointDistance(tail, tip);
      const headSize = (pointDistance(tip, firstWing) + pointDistance(tip, secondWing)) / 2;
      if (shaft < 24 || headSize < shaft * 0.08 || headSize > shaft * 0.42) continue;
      if (pointDistance(tip, returnTip) > Math.max(8, shaft * 0.14)) continue;
      if (i + 4 < path.length && pointDistance(path[i + 3], path[path.length - 1]) > tolerance * 2) continue;

      const dx = (tip.x - tail.x) / shaft, dy = (tip.y - tail.y) / shaft;
      const firstLength = pointDistance(tip, firstWing), secondLength = pointDistance(tip, secondWing);
      const firstDot = ((firstWing.x - tip.x) * -dx + (firstWing.y - tip.y) * -dy) / firstLength;
      const secondDot = ((secondWing.x - tip.x) * -dx + (secondWing.y - tip.y) * -dy) / secondLength;
      const firstSide = dx * (firstWing.y - tip.y) - dy * (firstWing.x - tip.x);
      const secondSide = dx * (secondWing.y - tip.y) - dy * (secondWing.x - tip.x);
      if (firstDot < 0.2 || firstDot > 0.98 || secondDot < 0.2 || secondDot > 0.98 || firstSide * secondSide >= 0) continue;

      return [tail, tip, firstWing, tip, secondWing];
    }
  }
  return null;
}

/** Recognize closed triangles, rectangles, and squares, plus a continuous arrow stroke. */
export function detectFigure(pts) {
  if (pts.length < 5) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of pts) {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  }
  const width = maxX - minX, height = maxY - minY;
  const diagonal = Math.hypot(width, height);
  if (diagonal < 24) return null;

  const closureTolerance = Math.max(12, diagonal * 0.2);
  if (pointDistance(pts[0], pts[pts.length - 1]) <= closureTolerance) {
    const start = {
      x: (pts[0].x + pts[pts.length - 1].x) / 2,
      y: (pts[0].y + pts[pts.length - 1].y) / 2,
    };
    const loop = [...pts.slice(0, -1), start];
      const simplified = rdp(loop, Math.max(2.5, diagonal * 0.05));
      const corners = cleanCorners(simplified.slice(0, -1), Math.max(3, diagonal * 0.05));

    if (corners.length === 3) {
      return [...corners, corners[0]];
    }

    if (corners.length === 4) {
      const edges = corners.map((point, i) => ({
        x: corners[(i + 1) % 4].x - point.x,
        y: corners[(i + 1) % 4].y - point.y,
      }));
      const rightAngles = edges.every((edge, i) => {
        const next = edges[(i + 1) % 4];
        return Math.abs(edge.x * next.x + edge.y * next.y) / (Math.hypot(edge.x, edge.y) * Math.hypot(next.x, next.y)) < 0.42;
      });
      const oppositeSides = [
        Math.abs(Math.hypot(edges[0].x, edges[0].y) - Math.hypot(edges[2].x, edges[2].y)),
        Math.abs(Math.hypot(edges[1].x, edges[1].y) - Math.hypot(edges[3].x, edges[3].y)),
      ].every((diff, i) => diff / Math.max(1, Math.hypot(edges[i].x, edges[i].y), Math.hypot(edges[i + 2].x, edges[i + 2].y)) < 0.45);

      if (rightAngles && oppositeSides) {
        const squareSide = Math.max(width, height);
        const side = Math.abs(width - height) / squareSide < 0.25 ? (width + height) / 2 : null;
        const shapeWidth = side ?? width, shapeHeight = side ?? height;
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        const left = cx - shapeWidth / 2, right = cx + shapeWidth / 2;
        const top = cy - shapeHeight / 2, bottom = cy + shapeHeight / 2;
        return [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }, { x: left, y: top }];
      }
    }
  }

  return detectArrow(pts, diagonal);
}

/**
 * The one and only renderer. Anything the AI produces must be expressible as
 * one of these stroke shapes, because this function and the binary codec
 * below are the only two things that understand Cicada's data model.
 */
export function renderStroke(ctx, s) {
  ctx.save();
  if (s.type === 'text') {
    const ink = themedColor(s.color);
    ctx.fillStyle = ink;
    ctx.font = `${s.bold ? 'bold ' : ''}${s.italic ? 'italic ' : ''}${TEXT_FONT(s.fs)}`;
    s.text.split('\n').forEach((ln, i) => {
      const y = s.y + i * s.fs * 1.35;
      ctx.fillText(ln, s.x, y);
      if (s.underline) {
        ctx.strokeStyle = ink;
        ctx.lineWidth = Math.max(1, s.fs / 18);
        ctx.beginPath();
        ctx.moveTo(s.x, y + s.fs * 0.12);
        ctx.lineTo(s.x + ctx.measureText(ln).width, y + s.fs * 0.12);
        ctx.stroke();
      }
    });
  } else if (s.type === 'image') {
    const image = BOARD_IMAGE_CACHE.get(s.src);
    if (image) ctx.drawImage(image, s.x, s.y, s.width, s.height);
  } else if (s.type === 'circle') {
    ctx.strokeStyle = themedColor(s.color); ctx.lineWidth = s.w; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2); ctx.stroke();
  } else {
    ctx.strokeStyle = ctx.fillStyle = s.type === 'eraser' ? (_darkMode ? '#2a2a2e' : '#fff') : themedColor(s.color);
    ctx.lineWidth = s.w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const p = s.pts;
    if (!p?.length) { ctx.restore(); return; }
    if (p.length === 1) { ctx.beginPath(); ctx.arc(p[0].x, p[0].y, s.w / 2, 0, Math.PI * 2); ctx.fill(); }
    else {
      ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y);
      for (let i = 1; i < p.length - 1; i++)
        ctx.quadraticCurveTo(p[i].x, p[i].y, (p[i].x + p[i + 1].x) / 2, (p[i].y + p[i + 1].y) / 2);
      ctx.lineTo(p[p.length - 1].x, p[p.length - 1].y); ctx.stroke();
    }
  }
  ctx.restore();
}

export function renderStrokes(ctx, strokes) {
  for (const s of strokes) renderStroke(ctx, s);
}

/* ── Binary codec v2/v3=no-vp  v4/v5=with-vp ─────────────────── */

function _vw(o, v) { v = v >>> 0; do { let b = v & 127; v >>>= 7; o.push(v ? b | 128 : b) } while (v) }
function _zw(o, v) { _vw(o, v >= 0 ? v * 2 : (-v - 1) * 2 + 1) }
function _vr(b, p) { let v = 0, s = 0; do { const x = b[p.i++]; v |= (x & 127) << s; s += 7; if (!(x & 128)) break } while (1); return v >>> 0 }
function _zr(b, p) { const v = _vr(b, p); return (v & 1) ? -((v + 1) >> 1) : v >> 1 }

export function encodeBody(ss, viewport) {
  const out = [];
  if (viewport) {
    const su = Math.round(viewport.scale * 1000) & 0xFFFF;
    out.push(su & 255, su >> 8); _zw(out, Math.round(viewport.cx)); _zw(out, Math.round(viewport.cy));
  }
  out.push(ss.length & 255, ss.length >> 8);
  for (const s of ss) {
    const tc = s.type === 'eraser' ? 1 : (s.type === 'text' || s.type === 'image') ? 2 : s.type === 'circle' ? 3 : 0;
    const col = Math.max(0, colorIndex(s.color));
    const wId = s.type === 'image' ? 3 : s.type === 'text' ? Math.max(0, FONT_SZ.indexOf(s.fs)) : s.type === 'eraser' ? Math.max(0, ERASER_W.indexOf(s.w)) : Math.max(0, PEN_W.indexOf(s.w));
    out.push((tc << 6) | (col << 3) | (wId & 3));
    if (s.type === 'circle') { _zw(out, Math.round(s.cx)); _zw(out, Math.round(s.cy)); _vw(out, Math.max(0, Math.round(s.r))); }
    else if (s.type === 'image') {
      if (!isBoardImageDataUrl(s.src)) throw new Error('Unsupported or oversized board image.');
      const x = Math.max(0, Math.min(65535, Math.round(s.x) + 32768));
      const y = Math.max(0, Math.min(65535, Math.round(s.y) + 32768));
      out.push(x & 255, x >> 8, y & 255, y >> 8);
      _vw(out, Math.max(1, Math.round(s.width)));
      _vw(out, Math.max(1, Math.round(s.height)));
      const imageBytes = new TextEncoder().encode(s.src);
      _vw(out, imageBytes.length); for (const b of imageBytes) out.push(b);
    }
    else if (s.type === 'text') {
      const x = Math.max(0, Math.min(65535, Math.round(s.x) + 32768));
      const y = Math.max(0, Math.min(65535, Math.round(s.y) + 32768));
      out.push(x & 255, x >> 8, y & 255, y >> 8);
      const tb = new TextEncoder().encode((s.text || '').slice(0, 500));
      _vw(out, tb.length); for (const b of tb) out.push(b);
      out.push((s.bold ? 1 : 0) | (s.italic ? 2 : 0) | (s.underline ? 4 : 0));
    } else {
      const pts = s.pts || [];
      out.push(pts.length & 255, pts.length >> 8);
      if (!pts.length) continue;
      const x0 = Math.max(0, Math.min(65535, Math.round(pts[0].x) + 32768));
      const y0 = Math.max(0, Math.min(65535, Math.round(pts[0].y) + 32768));
      out.push(x0 & 255, x0 >> 8, y0 & 255, y0 >> 8);
      let px = Math.round(pts[0].x), py = Math.round(pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        const x = Math.round(pts[i].x), y = Math.round(pts[i].y);
        _zw(out, x - px); _zw(out, y - py); px = x; py = y;
      }
    }
  }
  return new Uint8Array(out);
}

export function decodeBody(bytes, hasVP, hasTextStyles = false) {
  const p = { i: 0 };
  let rvp = null;
  if (hasVP) {
    const su = bytes[p.i] | (bytes[p.i + 1] << 8); p.i += 2;
    rvp = { scale: su / 1000, cx: _zr(bytes, p), cy: _zr(bytes, p) };
  }
  const count = bytes[p.i] | (bytes[p.i + 1] << 8); p.i += 2;
  const ss = [];
  for (let si = 0; si < count; si++) {
    const flags = bytes[p.i++], tc = (flags >> 6) & 3, col = (flags >> 3) & 7, wId = flags & 3;
    const color = COLORS[Math.min(col, COLORS.length - 1)];
    const type = tc === 1 ? 'eraser' : tc === 2 ? (wId === 3 ? 'image' : 'text') : tc === 3 ? 'circle' : 'pen';
    if (type === 'image') {
      const x = (bytes[p.i] | (bytes[p.i + 1] << 8)) - 32768; p.i += 2;
      const y = (bytes[p.i] | (bytes[p.i + 1] << 8)) - 32768; p.i += 2;
      const width = _vr(bytes, p), height = _vr(bytes, p), srcLength = _vr(bytes, p);
      const src = new TextDecoder().decode(bytes.slice(p.i, p.i + srcLength)); p.i += srcLength;
      if (isBoardImageDataUrl(src)) ss.push({ type, src, x, y, width, height });
    } else if (type === 'circle') {
      const cx = _zr(bytes, p), cy = _zr(bytes, p), r = _vr(bytes, p);
      ss.push({ type: 'circle', cx, cy, r, color, w: PEN_W[wId] || PEN_W[0] });
    } else if (type === 'text') {
      const x = (bytes[p.i] | (bytes[p.i + 1] << 8)) - 32768; p.i += 2;
      const y = (bytes[p.i] | (bytes[p.i + 1] << 8)) - 32768; p.i += 2;
      const tl = _vr(bytes, p);
      const text = new TextDecoder().decode(bytes.slice(p.i, p.i + tl)); p.i += tl;
      const styles = hasTextStyles ? bytes[p.i++] : 0;
      ss.push({
        type: 'text', text, color, x, y, fs: FONT_SZ[wId] || FONT_SZ[0],
        bold: !!(styles & 1), italic: !!(styles & 2), underline: !!(styles & 4),
      });
    } else {
      const ptc = bytes[p.i] | (bytes[p.i + 1] << 8); p.i += 2;
      const pts = [];
      if (ptc > 0) {
        let x = (bytes[p.i] | (bytes[p.i + 1] << 8)) - 32768; p.i += 2;
        let y = (bytes[p.i] | (bytes[p.i + 1] << 8)) - 32768; p.i += 2;
        pts.push({ x, y });
        for (let i = 1; i < ptc; i++) { x += _zr(bytes, p); y += _zr(bytes, p); pts.push({ x, y }); }
      }
      ss.push({ type, color, w: type === 'eraser' ? (ERASER_W[wId] || ERASER_W[0]) : (PEN_W[wId] || PEN_W[0]), pts });
    }
  }
  return { strokes: ss, vp: rvp };
}

const toB64u = b => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '') };
const fromB64u = s => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/')); const r = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) r[i] = b.charCodeAt(i); return r };

async function tryDeflate(b) {
  if (!('CompressionStream' in window)) return { b, v: false };
  try { const cs = new CompressionStream('deflate-raw'); const w = cs.writable.getWriter(); w.write(b); w.close(); const c = new Uint8Array(await new Response(cs.readable).arrayBuffer()); return c.length < b.length ? { b: c, v: true } : { b, v: false }; } catch { return { b, v: false }; }
}
async function tryInflate(b) {
  if (!('DecompressionStream' in window)) return b;
  try { const ds = new DecompressionStream('deflate-raw'); const w = ds.writable.getWriter(); w.write(b); w.close(); return new Uint8Array(await new Response(ds.readable).arrayBuffer()); } catch { return b; }
}

export async function strokesToHash(ss, viewport) {
  const body = encodeBody(ss, viewport);
  const { b: payload, v: deflated } = await tryDeflate(body);
  const full = new Uint8Array(2 + payload.length);
  full[0] = 0xAB; full[1] = deflated ? 9 : 8; full.set(payload, 2);
  return toB64u(full);
}

export async function hashToStrokes(hash) {
  try {
    const bytes = fromB64u(hash);
    if (bytes[0] === 0xAB) {
      const v = bytes[1], hasVP = v >= 4;
      let body = bytes.slice(2);
      if (v === 3 || v === 5 || v === 7 || v === 9) body = await tryInflate(body);
      const decoded = decodeBody(body, hasVP, v >= 6);
      await Promise.all(decoded.strokes.filter(s => s.type === 'image').map(s => cacheBoardImage(s.src).catch(() => null)));
      decoded.strokes = decoded.strokes.filter(s => s.type !== 'image' || BOARD_IMAGE_CACHE.has(s.src));
      return decoded;
    }
  } catch (e) { console.warn('bin:', e); }
  try {
    if (typeof LZString !== 'undefined') {
      const json = LZString.decompressFromEncodedURIComponent(hash);
      if (json) {
        const CV = { 'var(--c0)': '#363028', 'var(--c1)': '#C9A89A', 'var(--c2)': '#8FA89A', 'var(--c3)': '#8A9BAE', 'var(--c4)': '#C4B49A', 'var(--c5)': '#A898AE' };
        return { strokes: JSON.parse(json).map(s => ({ ...s, color: CV[s.color] || s.color || COLORS[0] })), vp: null };
      }
    }
  } catch (e) { console.warn('lz:', e); }
  return null;
}

/* ── engine ──────────────────────────────────────────────────── */

const clone = v => JSON.parse(JSON.stringify(v));

export function createCicadaEngine(root, opts = {}) {
  const $ = id => root.querySelector('#' + id);
  const base = $('base'), live = $('live'), cur = $('cur'), ti = $('ti');
  const bctx = base.getContext('2d'), lctx = live.getContext('2d'), cctx = cur.getContext('2d');

  let vp = { x: 0, y: 0, scale: 1 };
  let tool = 'pen', ci = 0, wi = 0;
  let strokes = [], undoStack = [[]], histIdx = 0;
  let isDrawing = false, drawPts = [];
  let spaceDown = false, mousePanning = false, midPanning = false;
  let panStart = null, vpAtPanStart = null, rafId = null;
  let curSX = -999, curSY = -999;
  let destroyed = false;

  const cleanups = [];
  const on = (target, type, fn, o) => {
    target.addEventListener(type, fn, o);
    cleanups.push(() => target.removeEventListener(type, fn, o));
  };

  const emitZoom = () => { if (!destroyed) opts.onZoom?.(vp.scale); };
  const emitHistory = () => { if (!destroyed) opts.onHistory?.({ canUndo: histIdx > 0, canRedo: histIdx < undoStack.length - 1 }); };
  const toast = msg => { if (!destroyed) opts.onToast?.(msg); };

  function resize() {
    const W = innerWidth, H = innerHeight;
    for (const c of [base, live, cur]) {
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
      c.style.width = W + 'px'; c.style.height = H + 'px';
    }
    scheduleRedraw(); drawCursorAt(curSX, curSY);
  }

  const s2w = (sx, sy) => ({ x: (sx - vp.x) / vp.scale, y: (sy - vp.y) / vp.scale });
  const applyVP = ctx => ctx.setTransform(vp.scale * dpr, 0, 0, vp.scale * dpr, vp.x * dpr, vp.y * dpr);

  function setZoom(ns, cx, cy) {
    const rf = ns / vp.scale;
    vp.x = cx - (cx - vp.x) * rf; vp.y = cy - (cy - vp.y) * rf; vp.scale = ns;
    emitZoom();
  }
  function zoomAt(factor, cx, cy) { setZoom(Math.max(MIN_SCALE, Math.min(MAX_SCALE, vp.scale * factor)), cx, cy); }

  function drawGrid() {
    const W = base.width / dpr, H = base.height / dpr;
    let sp = 32;
    while (sp * vp.scale < 16) sp *= 4;
    while (sp * vp.scale > 64) sp /= 2;
    const ox = -vp.x / vp.scale, oy = -vp.y / vp.scale;
    const x1 = (W - vp.x) / vp.scale, y1 = (H - vp.y) / vp.scale;
    const sx = Math.floor(ox / sp) * sp, sy = Math.floor(oy / sp) * sp;
    const r = 1 / vp.scale;
    bctx.fillStyle = _darkMode ? 'rgba(190,160,255,.16)' : 'rgba(0,0,0,.08)';
    bctx.beginPath();
    for (let gx = sx; gx <= x1 + sp; gx += sp)
      for (let gy = sy; gy <= y1 + sp; gy += sp)
        bctx.rect(gx - r, gy - r, r * 2, r * 2);
    bctx.fill();
  }

  function scheduleRedraw() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => { rafId = null; redrawBase(); });
  }
  function redrawBase() {
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.fillStyle = _darkMode ? '#2a2a2e' : '#fff'; bctx.fillRect(0, 0, base.width, base.height);
    applyVP(bctx); drawGrid();
    renderStrokes(bctx, strokes);
  }

  function drawCursorAt(sx, sy) {
    cctx.setTransform(1, 0, 0, 1, 0, 0); cctx.clearRect(0, 0, cur.width, cur.height);
    if (sx < 0 || sy < 0) return;
    if (tool === 'pen') {
      cctx.fillStyle = getColors()[ci];
      cctx.beginPath(); cctx.arc(sx * dpr, sy * dpr, 5 * dpr, 0, Math.PI * 2); cctx.fill();
    } else if (tool === 'eraser') {
      const r = Math.max(8, ERASER_W[wi] * vp.scale / 2);
      cctx.strokeStyle = _darkMode ? 'rgba(200,200,200,.5)' : 'rgba(80,80,80,.7)'; cctx.lineWidth = 1.5 * dpr;
      cctx.setLineDash([4 * dpr, 3 * dpr]);
      cctx.beginPath(); cctx.arc(sx * dpr, sy * dpr, r * dpr, 0, Math.PI * 2); cctx.stroke();
    }
  }
  const setCursorStyle = t => { live.style.cursor = t === 'text' ? 'text' : 'none'; };

  function animateCircleSnap(s, onDone) {
    const dur = 340, start = performance.now();
    function frame(now) {
      if (destroyed) return;
      const t = Math.min((now - start) / dur, 1);
      const sp = t < 0.65 ? (t / 0.65) * 1.06 : 1.06 - ((t - 0.65) / 0.35) * 0.06;
      lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, live.width, live.height);
      lctx.save(); applyVP(lctx);
      lctx.translate(s.cx, s.cy); lctx.scale(0.82 + 0.18 * sp, 0.82 + 0.18 * sp); lctx.translate(-s.cx, -s.cy);
      lctx.globalAlpha = Math.min(t * 4, 1); lctx.strokeStyle = s.color; lctx.lineWidth = s.w; lctx.lineCap = 'round';
      lctx.beginPath(); lctx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2); lctx.stroke();
      lctx.restore();
      t < 1 ? requestAnimationFrame(frame) : onDone();
    }
    requestAnimationFrame(frame);
  }

  function pushHistory() {
    undoStack = undoStack.slice(0, histIdx + 1);
    undoStack.push(clone(strokes));
    histIdx++; emitHistory();
  }

  const clearLive = () => { lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, live.width, live.height); };

  function appendLiveSeg(ctx, pts, color, width) {
    const n = pts.length;
    if (n < 2) return;
    ctx.strokeStyle = ctx.fillStyle = color;
    ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    if (n === 2) { ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y); }
    else {
      const i = n - 2, p0 = pts[i - 1] ?? pts[i];
      ctx.moveTo((p0.x + pts[i].x) / 2, (p0.y + pts[i].y) / 2);
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
    }
    ctx.stroke();
  }

  function commitStroke() {
    if (!drawPts.length) return;
    const isE = tool === 'eraser', ew = isE ? ERASER_W[wi] : PEN_W[wi];
    if (!isE) {
      const figure = detectFigure(drawPts);
      if (figure) {
        drawPts = [];
        clearLive();
        const s = { type: 'pen', color: getColors()[ci], w: ew, pts: figure };
        strokes = [...strokes, s];
        pushHistory();
        renderStroke(bctx, s);
        return;
      }
    }
    if (!isE) {
      const c = detectCircle(drawPts);
      if (c) {
        drawPts = []; clearLive();
        const s = { type: 'circle', cx: c.cx, cy: c.cy, r: c.r, color: getColors()[ci], w: ew };
        animateCircleSnap(s, () => {
          if (destroyed) return;
          strokes = [...strokes, s]; pushHistory(); renderStroke(bctx, s); clearLive();
        });
        return;
      }
    }
    const s = simplify({ type: isE ? 'eraser' : 'pen', color: getColors()[ci], w: ew, pts: drawPts });
    strokes = [...strokes, s]; pushHistory();
    if (!isE) { renderStroke(bctx, s); clearLive(); }
    drawPts = [];
  }

  function cancelStroke() {
    drawPts = []; clearLive();
    if (tool === 'eraser') scheduleRedraw();
  }

  function startDraw(sx, sy) {
    isDrawing = true;
    const p = s2w(sx, sy); drawPts = [p];
    const isE = tool === 'eraser', ew = isE ? ERASER_W[wi] : PEN_W[wi];
    const ctx = isE ? bctx : lctx;
    applyVP(ctx);
    ctx.fillStyle = isE ? (_darkMode ? '#2a2a2e' : '#fff') : getColors()[ci];
    ctx.beginPath(); ctx.arc(p.x, p.y, ew / 2, 0, Math.PI * 2); ctx.fill();
  }

  function continueDraw(sx, sy) {
    if (!isDrawing) return;
    const p = s2w(sx, sy), last = drawPts[drawPts.length - 1];
    const dsx = (p.x - last.x) * vp.scale, dsy = (p.y - last.y) * vp.scale;
    if (dsx * dsx + dsy * dsy < MIN_D2) return;
    drawPts.push(p);
    const isE = tool === 'eraser';
    appendLiveSeg(isE ? bctx : lctx, drawPts, isE ? (_darkMode ? '#2a2a2e' : '#fff') : getColors()[ci], isE ? ERASER_W[wi] : PEN_W[wi]);
  }

  const endDraw = () => { if (isDrawing) { isDrawing = false; commitStroke(); } };

  const activePointers = new Map();
  let drawingPid = -1, pinchGest = null;

  function _pairGest() {
    const it = activePointers.values();
    const a = it.next().value, b = it.next().value;
    if (!b) return null;
    return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(b.x - a.x, b.y - a.y) };
  }

  let _txC = false;
  function openTextInput(sx, sy) {
    const p = s2w(sx, sy), fs = FONT_SZ[wi], sfs = fs * vp.scale;
    const fontFam = TEXT_FONT_FAMILY;
    ti.style.cssText = `display:block;left:${sx}px;top:${sy - sfs * .82}px;font-size:${sfs}px;color:${getColors()[ci]};height:auto;min-height:${sfs * 1.35}px;font-family:${fontFam}`;
    ti.value = ''; ti.dataset.wx = p.x; ti.dataset.wy = p.y; ti.dataset.fs = fs; ti.dataset.ci = ci;
    ti.focus();
  }
  function commitText() {
    if (_txC || ti.style.display !== 'block') return;
    _txC = true; ti.style.display = 'none';
    const txt = ti.value.trim();
    if (txt) {
      const s = {
        type: 'text', text: txt, color: getColors()[+ti.dataset.ci],
        x: +ti.dataset.wx, y: +ti.dataset.wy, fs: +ti.dataset.fs,
        bold: ti.style.fontWeight === '700',
        italic: ti.style.fontStyle === 'italic',
        underline: ti.style.textDecoration === 'underline',
      };
      strokes = [...strokes, s]; pushHistory(); renderStroke(bctx, s);
    }
    _txC = false;
  }

  function pasteText(text) {
    const value = String(text || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, 500);
    if (!value) return false;
    const fs = FONT_SZ[wi], metrics = measureTextBlock(value, fs);
    const center = s2w(innerWidth / 2, innerHeight / 2);
    const stroke = {
      type: 'text', text: value, color: getColors()[ci], fs,
      x: center.x - metrics.width / 2,
      y: center.y - metrics.height / 2 + fs * 0.8,
    };
    strokes = [...strokes, stroke];
    pushHistory();
    redrawBase();
    toast('Text pasted · undo to remove');
    return true;
  }

  async function pasteImage(file) {
    if (!file || file.size > 30_000_000 || typeof createImageBitmap !== 'function') {
      toast('Could not paste this image · try a smaller PNG, JPEG, or WebP');
      return;
    }

    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      let scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      let src = '';
      for (let attempt = 0; attempt < 8; attempt++) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        src = canvas.toDataURL('image/webp', 0.82);
        if (isBoardImageDataUrl(src) && src.length <= MAX_BOARD_IMAGE_DATA_URL) break;
        scale *= 0.75;
        src = '';
      }
      if (!src || !isBoardImageDataUrl(src)) throw new Error('Image could not be compressed for the board.');

      await cacheBoardImage(src);
      if (destroyed) return;
      const boardScale = Math.min(1, 560 / bitmap.width, 420 / bitmap.height);
      const width = bitmap.width * boardScale, height = bitmap.height * boardScale;
      const center = s2w(innerWidth / 2, innerHeight / 2);
      strokes = [...strokes, {
        type: 'image', src, x: center.x - width / 2, y: center.y - height / 2, width, height,
      }];
      pushHistory();
      redrawBase();
      toast('Image pasted · undo to remove');
    } catch {
      toast('Could not paste this image · try a smaller PNG, JPEG, or WebP');
    } finally {
      bitmap?.close();
    }
  }

  function fitContent() {
    const b = contentBounds(strokes);
    if (!b) return;
    const W = innerWidth, H = innerHeight, pad = 80;
    vp.scale = Math.min(W / (b.width + pad * 2), H / (b.height + pad * 2), 1);
    vp.x = (W - (b.width + pad * 2) * vp.scale) / 2 - b.x0 * vp.scale + pad * vp.scale;
    vp.y = (H - (b.height + pad * 2) * vp.scale) / 2 - b.y0 * vp.scale + pad * vp.scale;
    emitZoom();
    scheduleRedraw();
  }

  function resetView() {
    vp.x = 0; vp.y = 0; vp.scale = 1;
    emitZoom(); scheduleRedraw(); drawCursorAt(curSX, curSY);
  }

  /* ── public imperative API ── */

  const api = {
    get root() { return root; },
    get strokes() { return strokes; },
    get viewport() { return { ...vp }; },
    getTool: () => tool,
    getColorIndex: () => ci,
    getWidthIndex: () => wi,

    setTool(t) {
      if (!TOOLS.includes(t) || t === tool) return;
      tool = t;
      if (ti.style.display === 'block') commitText();
      setCursorStyle(tool);
      drawCursorAt(curSX, curSY);
      opts.onToolChange?.(tool);
    },
    setColorIndex(i) {
      if (i < 0 || i >= COLORS.length || i === ci) return;
      ci = i;
      if (ti.style.display === 'block') ti.style.color = getColors()[i];
      drawCursorAt(curSX, curSY);
      opts.onColorChange?.(ci);
    },
    setWidthIndex(i) {
      if (i < 0 || i >= PEN_W.length || i === wi) return;
      wi = i;
      drawCursorAt(curSX, curSY);
      opts.onWidthChange?.(i);
    },

    undo() { if (histIdx > 0) { histIdx--; strokes = clone(undoStack[histIdx]); redrawBase(); emitHistory(); } },
    redo() { if (histIdx < undoStack.length - 1) { histIdx++; strokes = clone(undoStack[histIdx]); redrawBase(); emitHistory(); } },

    /** Replace the board without touching history (used for loading a hash). */
    loadStrokes(next, snapshotVp) {
      strokes = clone(next);
      undoStack = [[], clone(strokes)]; histIdx = 1;
      if (snapshotVp) {
        const W = innerWidth, H = innerHeight;
        vp.scale = snapshotVp.scale;
        vp.x = W / 2 - snapshotVp.cx * vp.scale; vp.y = H / 2 - snapshotVp.cy * vp.scale;
        emitZoom();
      } else fitContent();
      redrawBase(); emitHistory();
    },

    /**
     * Replace the board as a single undoable step. This is how the AI
     * conversion commits, so Ctrl+Z puts the original sketch back.
     */
    applyStrokes(next, { history = true } = {}) {
      strokes = clone(next);
      if (history) pushHistory();
      redrawBase();
      if (!history) emitHistory();
    },

    /** Append strokes as a single undoable step, leaving what's there alone. */
    appendStrokes(extra) {
      strokes = [...strokes, ...clone(extra)];
      pushHistory();
      redrawBase();
    },

    redraw: redrawBase,
    fitContent,
    resetView,
    bounds: () => contentBounds(strokes),

    async saveLink() {
      const hash = await strokesToHash(strokes, {
        scale: vp.scale,
        cx: Math.round((-vp.x + innerWidth / 2) / vp.scale),
        cy: Math.round((-vp.y + innerHeight / 2) / vp.scale),
      });
      const url = location.origin + location.pathname + '#' + hash;
      history.replaceState(null, '', '#' + hash);
      await navigator.clipboard.writeText(url).catch(() => { });
      toast(`Link copied · ${(hash.length * .75 / 1024).toFixed(1)} KB`);
      return { url, hash };
    },

    destroy() {
      destroyed = true;
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      while (cleanups.length) cleanups.pop()();
      activePointers.clear();
      isDrawing = mousePanning = midPanning = false;
      drawingPid = -1; pinchGest = null;
    },

    /** Switch between dark/light mode. Redraws the canvas with new colors. */
    setDarkMode(dark) {
      setDarkModeFlag(dark);
      redrawBase();
      drawCursorAt(curSX, curSY);
    },
  };

  /* ── input wiring ── */

  on(live, 'pointerdown', e => {
    e.preventDefault();
    live.setPointerCapture(e.pointerId);
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const isMouse = e.pointerType === 'mouse';
    if (isMouse && e.button === 1) {
      if (isDrawing) { cancelStroke(); drawingPid = -1; }
      midPanning = true; panStart = { x: e.clientX, y: e.clientY }; vpAtPanStart = { ...vp };
      live.style.cursor = 'grabbing'; return;
    }
    if (spaceDown && isMouse && e.button === 0) {
      if (isDrawing) { cancelStroke(); drawingPid = -1; }
      mousePanning = true; panStart = { x: e.clientX, y: e.clientY }; vpAtPanStart = { ...vp };
      live.style.cursor = 'grabbing'; return;
    }
    if (activePointers.size >= 2) {
      if (isDrawing) { cancelStroke(); drawingPid = -1; }
      pinchGest = _pairGest(); return;
    }
    if (pinchGest || (isMouse && e.button !== 0)) return;
    if (tool === 'text') { openTextInput(e.clientX, e.clientY); return; }
    drawingPid = e.pointerId;
    startDraw(e.clientX, e.clientY);
  });

  on(live, 'pointermove', e => {
    e.preventDefault();
    if (e.pointerType !== 'touch') { curSX = e.clientX; curSY = e.clientY; drawCursorAt(curSX, curSY); }
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mousePanning || midPanning) {
      vp.x = vpAtPanStart.x + (e.clientX - panStart.x);
      vp.y = vpAtPanStart.y + (e.clientY - panStart.y);
      scheduleRedraw(); return;
    }
    if (pinchGest && activePointers.size >= 2) {
      const g = _pairGest(); if (!g) return;
      const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, vp.scale * g.dist / pinchGest.dist));
      const rf = ns / vp.scale;
      vp.x = pinchGest.mid.x - (pinchGest.mid.x - vp.x) * rf + (g.mid.x - pinchGest.mid.x);
      vp.y = pinchGest.mid.y - (pinchGest.mid.y - vp.y) * rf + (g.mid.y - pinchGest.mid.y);
      vp.scale = ns; pinchGest = g;
      emitZoom();
      scheduleRedraw();
      if (tool === 'eraser') drawCursorAt(curSX, curSY);
      return;
    }
    if (isDrawing && e.pointerId === drawingPid) continueDraw(e.clientX, e.clientY);
  });

  function _pointerEnd(e) {
    e.preventDefault();
    activePointers.delete(e.pointerId);
    if (mousePanning || midPanning) {
      if (!e.buttons || e.button === 1) {
        mousePanning = midPanning = false;
        live.style.cursor = tool === 'text' ? 'text' : 'none';
        if (spaceDown) live.style.cursor = 'grab';
      }
      return;
    }
    if (e.pointerId === drawingPid) { drawingPid = -1; endDraw(); return; }
    if (activePointers.size < 2) pinchGest = null;
  }
  on(live, 'pointerup', _pointerEnd);
  on(live, 'pointercancel', e => {
    e.preventDefault();
    activePointers.delete(e.pointerId);
    if (e.pointerId === drawingPid) { cancelStroke(); drawingPid = -1; }
    if (activePointers.size < 2) pinchGest = null;
    mousePanning = midPanning = false;
    live.style.cursor = tool === 'text' ? 'text' : 'none';
  });
  on(live, 'pointerleave', e => {
    if (!activePointers.has(e.pointerId)) { curSX = -999; curSY = -999; drawCursorAt(-1, -1); }
  });

  on(live, 'wheel', e => {
    e.preventDefault();
    if (isDrawing) return;
    if (e.ctrlKey || e.metaKey) zoomAt(Math.pow(0.998, e.deltaY), e.clientX, e.clientY);
    else { vp.x -= e.deltaX * 1.2; vp.y -= e.deltaY * 1.2; emitZoom(); }
    scheduleRedraw();
    if (tool === 'eraser' && curSX > 0) drawCursorAt(curSX, curSY);
  }, { passive: false });

  on(document, 'keydown', e => {
    if (destroyed) return;
    if (ti.style.display === 'block') return;
    // Any other field on the page (the AI panel's hint box) owns its own keys:
    // 'p' would switch tools and ⌘Z would undo the drawing mid-sentence.
    const tgt = e.target;
    if (tgt instanceof HTMLInputElement || tgt instanceof HTMLTextAreaElement || tgt?.isContentEditable) return;
    if (e.code === 'Space' && !spaceDown && !isDrawing && !e.repeat) { spaceDown = true; e.preventDefault(); live.style.cursor = 'grab'; }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'z') { e.preventDefault(); api.undo(); }
    if (mod && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); api.redo(); }
    if (!mod && !e.shiftKey) {
      if (e.key === 'p') api.setTool('pen');
      if (e.key === 't') api.setTool('text');
      if (e.key === 'e') api.setTool('eraser');
      if (e.key === '0') resetView();
    }
  });
  on(document, 'keyup', e => {
    if (destroyed) return;
    if (e.code === 'Space') { spaceDown = false; mousePanning = false; live.style.cursor = tool === 'text' ? 'text' : 'none'; }
  });

  on(document, 'paste', e => {
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;

    const items = Array.from(e.clipboardData?.items || []);
    const imageItem = items.find(item => item.type.startsWith('image/'));
    const imageFile = imageItem?.getAsFile();
    if (imageFile) {
      e.preventDefault();
      void pasteImage(imageFile);
      return;
    }

    const text = e.clipboardData?.getData('text/plain');
    if (text?.trim()) {
      e.preventDefault();
      pasteText(text);
    }
  });

  on(ti, 'keydown', e => {
    if (e.key === 'Escape') { ti.style.display = 'none'; return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); return; }
    setTimeout(() => { ti.style.height = 'auto'; ti.style.height = ti.scrollHeight + 'px'; }, 0);
  });
  on(ti, 'blur', () => { if (!_txC) commitText(); });

  on(window, 'resize', resize);

  /* ── boot ── */

  resize(); redrawBase(); emitHistory(); emitZoom(); setCursorStyle('pen');

  (async () => {
    const h = location.hash.slice(1);
    if (!h) return;
    try {
      const result = await hashToStrokes(h);
      if (destroyed) return;
      if (result?.strokes?.length) api.loadStrokes(result.strokes, result.vp);
    } catch (e) { console.warn('load:', e); }
  })();

  return api;
}

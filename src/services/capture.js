import { contentBounds, renderStrokes, isDarkMode } from '../engine/mirovaEngine.js';

/**
 * Rasterise the board for the vision model.
 *
 * Reuses the engine's own contentBounds() and renderStrokes(), so the PNG is
 * exactly what the user sees — same ink, same cropping, same eraser behaviour
 * — with no second rendering path to drift out of sync.
 */
const MAX_DIM = 1024;
const MIN_DIM = 640;
const PAD = 28;

export function captureBoard(strokes, { maxDim = MAX_DIM, minDim = MIN_DIM, pad = PAD } = {}) {
  const b = contentBounds(strokes);
  if (!b || b.width < 8 || b.height < 8) return null;

  const worldW = b.width + pad * 2;
  const worldH = b.height + pad * 2;

  // Shrink big boards to the model's budget, but upscale tiny sketches so the
  // handwriting is legible. Rendering is vector, so upscaling stays crisp.
  const longest = Math.max(worldW, worldH);
  let scale = longest > maxDim ? maxDim / longest : 1;
  if (longest * scale < minDim) scale = Math.min(3, minDim / longest);

  const cw = Math.max(1, Math.round(worldW * scale));
  const ch = Math.max(1, Math.round(worldH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = isDarkMode() ? '#2a2a2e' : '#fff';
  ctx.fillRect(0, 0, cw, ch);
  ctx.setTransform(scale, 0, 0, scale, -(b.x0 - pad) * scale, -(b.y0 - pad) * scale);
  renderStrokes(ctx, strokes);

  const dataUrl = canvas.toDataURL('image/png');
  const comma = dataUrl.indexOf(',');

  return {
    base64: dataUrl.slice(comma + 1),
    dataUrl,
    width: cw,
    height: ch,
    bytes: Math.round((dataUrl.length - comma - 1) * 0.75),
  };
}

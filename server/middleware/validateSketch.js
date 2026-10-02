import { config } from '../config.js';

const DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Validates and normalises the conversion request. Rejects anything that is
 * not a PNG-shaped base64 payload inside the size budget, so the provider
 * never sees unbounded or arbitrary data.
 */
export function validateSketchRequest(req, res, next) {
  const { maxImageBase64, maxHintChars } = config.limits;
  const fail = (message, status = 400) => res.status(status).json({ error: { kind: 'bad_request', message } });

  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('Request body must be a JSON object.');

  let image = body.image;
  if (typeof image !== 'string' || !image.trim()) return fail('An "image" field (base64 PNG) is required.');

  image = image.trim();
  const wrapped = image.match(DATA_URL);
  if (wrapped) image = wrapped[1];

  if (image.length > maxImageBase64) {
    return fail(`Image is too large (${(image.length / 1e6).toFixed(1)} MB of base64; limit ${(maxImageBase64 / 1e6).toFixed(1)} MB).`, 413);
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image.replace(/\s/g, ''))) return fail('Image is not valid base64.');

  const buf = Buffer.from(image, 'base64');
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_MAGIC)) return fail('Image must be a base64-encoded PNG.');
  if (buf.length < 64) return fail('Image decoded to almost nothing; is the board empty?');

  let hint = body.hint;
  if (hint === undefined || hint === null || hint === '') hint = '';
  else if (typeof hint !== 'string') return fail('"hint" must be a string.');
  else {
    hint = hint.slice(0, maxHintChars);
    // Control characters have no business in a prompt.
    hint = hint.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  }

  req.sketch = { imageBase64: image, imageBytes: buf.length, hint };
  next();
}

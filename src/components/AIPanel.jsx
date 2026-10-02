import { useCallback, useEffect, useRef, useState } from 'react';
import { contentBounds } from '../engine/cicadaEngine.js';
import { layoutDiagram } from '../ai/layout.js';
import { diagramToStrokes } from '../ai/toMirova.js';
import { captureBoard } from '../services/capture.js';
import { AIError, convertSketch, getHealth } from '../services/diagramClient.js';
import { isEmptyDiagram } from '../../shared/diagramSchema.js';

/**
 * Sketch → Diagram.
 *
 * Nothing leaves the browser until the user presses Convert: the board is
 * rasterised on click, sent to our own Express server, and only the structured
 * JSON comes back. The model never sees pointer events and never returns
 * pixels or coordinates — layout is computed locally and mapped onto Cicada's
 * existing stroke objects, so the result is ordinary editable ink.
 */

const HINT_MAX = 400;

function Spark() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
    </svg>
  );
}

export function AIPanel({ canvas, open, onClose }) {
  const [health, setHealth] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');
  const [note, setNote] = useState(null);
  const [review, setReview] = useState(null);
  const abortRef = useRef(null);

  // Re-probe on every open: the server may have been started (or given a key)
  // after the page loaded.
  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    getHealth(ac.signal).then(h => { if (!ac.signal.aborted) setHealth(h); });
    return () => ac.abort();
  }, [open]);

  // Drop an in-flight request rather than let it land on a closed panel.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const convert = useCallback(async () => {
    const engine = canvas.engineRef.current;
    if (!engine || busy) return;

    const shot = captureBoard(engine.strokes);
    if (!shot) {
      setReview(null);
      setNote({ kind: 'info', text: 'Nothing to convert yet — draw a sketch on the board first.' });
      return;
    }

    setBusy(true);
    setNote(null);
    setReview(null);
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const { diagram, warnings, meta } = await convertSketch({ base64: shot.base64, hint, signal: ac.signal });

      if (isEmptyDiagram(diagram)) {
        setNote({
          kind: 'info',
          text: diagram.summary || 'No diagram structure detected. Draw boxes and arrows, then try again.',
        });
        return;
      }

      // Local layout + the adapter turn semantics into Cicada strokes. The
      // preview is rendered by the same captureBoard() the upload used, so
      // what the user approves is literally what gets drawn.
      const layout = layoutDiagram(diagram);
      const strokes = diagramToStrokes(layout);
      const preview = captureBoard(strokes);

      setReview({
        layout,
        strokes,
        preview: preview?.dataUrl || null,
        warnings,
        meta,
        nodes: layout.nodes.length,
        edges: layout.edges.length,
      });
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setNote({
        kind: 'error',
        text: err instanceof AIError ? err.message : 'Conversion failed. Please try again.',
      });
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setBusy(false);
    }
  }, [canvas, busy, hint]);

  // Both paths go through the engine's history, so ⌘Z restores the sketch.
  const replace = useCallback(() => {
    const engine = canvas.engineRef.current;
    if (!engine || !review) return;
    engine.applyStrokes(review.strokes);
    engine.fitContent();
    setReview(null);
    setNote({ kind: 'ok', text: 'Board replaced with the clean diagram — ⌘Z brings your sketch back.' });
  }, [canvas, review]);

  const addBeside = useCallback(() => {
    const engine = canvas.engineRef.current;
    if (!engine || !review) return;
    const b = contentBounds(engine.strokes);
    const origin = b ? { x: b.x1 + 140, y: b.y0 } : { x: 0, y: 0 };
    engine.appendStrokes(diagramToStrokes(review.layout, { origin }));
    engine.fitContent();
    setReview(null);
    setNote({ kind: 'ok', text: 'Diagram added beside your sketch — ⌘Z undoes it.' });
  }, [canvas, review]);

  if (!open) return null;

  const unavailable = health && !health.available;

  return (
    <div id="ai-panel" role="dialog" aria-label="Sketch to Diagram">
      <div className="ai-head">
        <span className="ai-title">Sketch → Diagram</span>
        {health && (
          <span className="ai-badge" title={health.model || ''}>
            {health.available ? health.provider : 'offline'}
          </span>
        )}
        <button className="ai-close" onClick={onClose} title="Close (Esc)" aria-label="Close">✕</button>
      </div>

      {unavailable && (
        <div className="ai-note error">
          AI conversion is currently unavailable.
          <div style={{ marginTop: 4, opacity: .8 }}>
            {health.reason === 'no_key'
              ? 'No OPENROUTER_API_KEY is set in server/.env. The whiteboard still works normally.'
              : 'The AI server is not reachable — start it with npm run dev.'}
          </div>
        </div>
      )}

      {!unavailable && (
        <>
          <input
            className="ai-hint"
            type="text"
            value={hint}
            maxLength={HINT_MAX}
            placeholder="Optional hint: “this is a flowchart”"
            disabled={busy}
            onChange={e => setHint(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); convert(); } }}
          />

          <div className="ai-actions">
            <button className="ai-btn" onClick={convert} disabled={busy || !health}>
              <Spark />
              {busy ? 'Reading your sketch…' : 'Convert to diagram'}
            </button>

            {review && (
              <>
                <div className="ai-row">
                  <button className="ai-btn secondary" onClick={replace}>Replace sketch</button>
                  <button className="ai-btn secondary" onClick={addBeside}>Add beside</button>
                </div>
                <button className="ai-btn ghost" onClick={() => setReview(null)}>Discard result</button>
              </>
            )}
          </div>
        </>
      )}

      {busy && (
        <div className="ai-status">
          <span className="ai-spin" />
          Asking the model what you drew…
        </div>
      )}

      {note && <div className={`ai-note ${note.kind}`}>{note.text}</div>}

      {review && (
        <>
          {review.preview && (
            <figure className="ai-preview" style={{ margin: '10px 0 0' }}>
              <img src={review.preview} alt="Preview of the generated diagram" />
              <figcaption>
                {review.nodes} nodes · {review.edges} links · {review.layout.direction === 'LR' ? 'left-to-right' : 'top-to-bottom'}
              </figcaption>
            </figure>
          )}

          <div className="ai-meta">
            {review.meta?.model && <>Model <b>{review.meta.model}</b><br /></>}
            {typeof review.meta?.ms === 'number' && <>{(review.meta.ms / 1000).toFixed(1)}s · </>}
            {typeof review.meta?.imageKB === 'number' && <>{review.meta.imageKB} KB sent</>}
          </div>

          {review.warnings?.length > 0 && (
            <div className="ai-note info">
              {review.warnings.slice(0, 3).map((w, i) => <div key={i}>· {w}</div>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

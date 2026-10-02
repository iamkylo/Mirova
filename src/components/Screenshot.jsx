import { useCallback, useEffect, useRef, useState } from 'react';
import { captureBoard } from '../services/capture.js';

/**
 * Screenshot button + popup preview.
 *
 * Takes a snapshot of the current board, shows it in a liquid-glass popup
 * at the bottom of the screen for a few seconds, and allows downloading
 * or copying to clipboard.
 */

const POPUP_DURATION = 5000; // auto-dismiss after 5s

export function ScreenshotButton({ canvas }) {
  const [screenshot, setScreenshot] = useState(null);
  const [hiding, setHiding] = useState(false);
  const timerRef = useRef(0);

  const takeScreenshot = useCallback(() => {
    const engine = canvas.engineRef.current;
    if (!engine) return;

    const shot = captureBoard(engine.strokes);
    if (!shot) {
      // Nothing on board
      return;
    }

    setScreenshot(shot);
    setHiding(false);

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setHiding(true);
      setTimeout(() => {
        setScreenshot(null);
        setHiding(false);
      }, 300);
    }, POPUP_DURATION);
  }, [canvas]);

  const dismiss = useCallback(() => {
    clearTimeout(timerRef.current);
    setHiding(true);
    setTimeout(() => {
      setScreenshot(null);
      setHiding(false);
    }, 300);
  }, []);

  const download = useCallback(() => {
    if (!screenshot) return;
    const a = document.createElement('a');
    a.href = screenshot.dataUrl;
    a.download = `mirova-${Date.now()}.png`;
    a.click();
  }, [screenshot]);

  const copyToClipboard = useCallback(async () => {
    if (!screenshot) return;
    try {
      const res = await fetch(screenshot.dataUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
    } catch {
      // Fallback: can't copy image on some browsers
    }
  }, [screenshot]);

  // Cleanup on unmount
  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <>
      {/* The screenshot toolbar button is rendered in Toolbar.jsx;
          we export the handler for it to call */}
      {screenshot && (
        <div className={`screenshot-popup${hiding ? ' hiding' : ''}`}>
          <div className="ss-label">📸 Screenshot captured</div>
          <img src={screenshot.dataUrl} alt="Board screenshot" />
          <div className="ss-actions">
            <button className="ss-btn" onClick={download}>
              Download
            </button>
            <button className="ss-btn ghost" onClick={copyToClipboard}>
              Copy
            </button>
            <button className="ss-btn ghost" onClick={dismiss}>
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** Hook to get the screenshot action for the toolbar button */
export function useScreenshot(canvas) {
  const [screenshot, setScreenshot] = useState(null);
  const [hiding, setHiding] = useState(false);
  const timerRef = useRef(0);

  const takeScreenshot = useCallback(() => {
    const engine = canvas.engineRef.current;
    if (!engine) return;

    const shot = captureBoard(engine.strokes);
    if (!shot) return;

    setScreenshot(shot);
    setHiding(false);

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setHiding(true);
      setTimeout(() => {
        setScreenshot(null);
        setHiding(false);
      }, 300);
    }, POPUP_DURATION);
  }, [canvas]);

  const dismiss = useCallback(() => {
    clearTimeout(timerRef.current);
    setHiding(true);
    setTimeout(() => {
      setScreenshot(null);
      setHiding(false);
    }, 300);
  }, []);

  const download = useCallback(() => {
    if (!screenshot) return;
    const a = document.createElement('a');
    a.href = screenshot.dataUrl;
    a.download = `mirova-${Date.now()}.png`;
    a.click();
  }, [screenshot]);

  const copyToClipboard = useCallback(async () => {
    if (!screenshot) return;
    try {
      const res = await fetch(screenshot.dataUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
    } catch {
      // Silently fail
    }
  }, [screenshot]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return { screenshot, hiding, takeScreenshot, dismiss, download, copyToClipboard };
}

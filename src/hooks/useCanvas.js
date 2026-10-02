import { useCallback, useEffect, useRef, useState } from 'react';
import { createCicadaEngine, COLORS, PEN_W, TOOLS, getColors } from '../engine/cicadaEngine.js';

/**
 * Owns the engine lifecycle and mirrors only low-frequency board state into
 * React. Pointer moves, wheel zoom and rAF redraws never reach React — the
 * zoom readout is written straight to a DOM node via zoomRef.
 */
export function useCanvas() {
  const rootRef = useRef(null);
  const engineRef = useRef(null);
  const zoomRef = useRef(null);
  const toastTimer = useRef(0);

  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState('pen');
  const [colorIndex, setColorIndex] = useState(0);
  const [widthIndex, setWidthIndex] = useState(0);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!rootRef.current) return;

    const engine = createCicadaEngine(rootRef.current, {
      onToolChange: setTool,
      onColorChange: setColorIndex,
      onWidthChange: setWidthIndex,
      onHistory: setHistory,
      onZoom(scale) {
        if (zoomRef.current) zoomRef.current.textContent = Math.round(scale * 100) + '%';
      },
      onToast(msg) {
        setToast(msg);
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 3000);
      },
    });

    engineRef.current = engine;
    setReady(true);

    return () => {
      clearTimeout(toastTimer.current);
      engine.destroy();
      engineRef.current = null;
      setReady(false);
    };
  }, []);

  // Dev-only escape hatch for inspecting board state; stripped from prod builds.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__cicada = { get engine() { return engineRef.current; } };
    return () => { delete window.__cicada; };
  }, [ready]);

  const selectTool = useCallback(t => engineRef.current?.setTool(t), []);
  const selectColor = useCallback(i => engineRef.current?.setColorIndex(i), []);
  const selectWidth = useCallback(i => engineRef.current?.setWidthIndex(i), []);
  const undo = useCallback(() => engineRef.current?.undo(), []);
  const redo = useCallback(() => engineRef.current?.redo(), []);
  const resetView = useCallback(() => engineRef.current?.resetView(), []);

  const [saving, setSaving] = useState(false);
  const saveLink = useCallback(async () => {
    if (!engineRef.current || saving) return;
    setSaving(true);
    try {
      await engineRef.current.saveLink();
    } catch (e) {
      console.error(e);
      setToast('Save failed');
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 3000);
    } finally {
      setSaving(false);
    }
  }, [saving]);

  return {
    rootRef, zoomRef, engineRef, ready,
    tool, colorIndex, widthIndex, history, toast, saving,
    tools: TOOLS, colors: COLORS, widths: PEN_W,
    selectTool, selectColor, selectWidth, undo, redo, resetView, saveLink,
  };
}

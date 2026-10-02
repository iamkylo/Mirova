import { useCallback, useEffect, useState } from 'react';
import { AIPanel } from './components/AIPanel.jsx';
import { CanvasBoard } from './components/CanvasBoard.jsx';
import { Toolbar } from './components/Toolbar.jsx';
import { ThemeToggle } from './components/ThemeToggle.jsx';
import { FormatPopup, useFormatPopup } from './components/FormatPopup.jsx';
import { useScreenshot } from './components/Screenshot.jsx';
import { useCanvas } from './hooks/useCanvas.js';

export default function App() {
  const canvas = useCanvas();
  const [aiOpen, setAiOpen] = useState(false);

  // ── Dark mode state ──
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('cicada-theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem('cicada-theme', isDark ? 'dark' : 'light');
    // Notify the engine about theme change so it can update canvas colors
    if (canvas.engineRef.current) {
      canvas.engineRef.current.setDarkMode?.(isDark);
    }
  }, [isDark, canvas.engineRef]);

  const toggleTheme = useCallback(() => setIsDark(v => !v), []);

  // ── Screenshot ──
  const ss = useScreenshot(canvas);

  // ── Format popup ──
  const fmt = useFormatPopup();

  // Watch for text input becoming visible to show format popup
  useEffect(() => {
    const ti = document.getElementById('ti');
    if (!ti) return;

    const observer = new MutationObserver(() => {
      if (ti.style.display === 'block') {
        const rect = ti.getBoundingClientRect();
        fmt.show(rect.left, rect.top);
      } else {
        fmt.hide();
      }
    });
    observer.observe(ti, { attributes: true, attributeFilter: ['style'] });
    return () => observer.disconnect();
  }, [fmt.show, fmt.hide]);

  // Apply formatting to the text input
  const handleFormat = useCallback((format) => {
    const ti = document.getElementById('ti');
    if (!ti || ti.style.display !== 'block') return;

    fmt.toggleFormat(format);

    // Apply styling to the textarea
    const current = ti.style;
    switch (format) {
      case 'bold':
        current.fontWeight = current.fontWeight === '700' ? 'normal' : '700';
        break;
      case 'italic':
        current.fontStyle = current.fontStyle === 'italic' ? 'normal' : 'italic';
        break;
      case 'underline':
        current.textDecoration = current.textDecoration === 'underline' ? 'none' : 'underline';
        break;
    }
  }, [fmt]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = e => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setAiOpen(v => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <CanvasBoard canvas={canvas} />
      <Toolbar
        canvas={canvas}
        aiOpen={aiOpen}
        onToggleAi={() => setAiOpen(v => !v)}
        onScreenshot={ss.takeScreenshot}
      />
      <AIPanel canvas={canvas} open={aiOpen} onClose={() => setAiOpen(false)} />
      <ThemeToggle isDark={isDark} onToggle={toggleTheme} />
      <FormatPopup
        visible={fmt.visible}
        position={fmt.position}
        onFormat={handleFormat}
        activeFormats={fmt.formats}
      />

      {/* Screenshot popup */}
      {ss.screenshot && (
        <div className={`screenshot-popup${ss.hiding ? ' hiding' : ''}`}>
          <div className="ss-label">📸 Screenshot captured</div>
          <img src={ss.screenshot.dataUrl} alt="Board screenshot" />
          <div className="ss-actions">
            <button className="ss-btn" onClick={ss.download}>Download</button>
            <button className="ss-btn ghost" onClick={ss.copyToClipboard}>Copy</button>
            <button className="ss-btn ghost" onClick={ss.dismiss}>Dismiss</button>
          </div>
        </div>
      )}
    </>
  );
}

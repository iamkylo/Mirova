import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Secondary popup for text formatting: Bold, Italic, Underline.
 * 
 * Appears near the text input when the text tool is active and the user
 * is typing. Uses liquid-glass aesthetic.
 */

export function FormatPopup({ visible, position, onFormat, activeFormats }) {
  if (!visible) return null;

  return (
    <div
      className="format-popup"
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      <button
        className={`fmt-btn${activeFormats.bold ? ' active' : ''}`}
        title="Bold"
        onMouseDown={e => { e.preventDefault(); onFormat('bold'); }}
      >
        <strong>B</strong>
      </button>
      <div className="fmt-sep" />
      <button
        className={`fmt-btn${activeFormats.italic ? ' active' : ''}`}
        title="Italic"
        onMouseDown={e => { e.preventDefault(); onFormat('italic'); }}
      >
        <em>I</em>
      </button>
      <div className="fmt-sep" />
      <button
        className={`fmt-btn${activeFormats.underline ? ' active' : ''}`}
        title="Underline"
        onMouseDown={e => { e.preventDefault(); onFormat('underline'); }}
      >
        <span style={{ textDecoration: 'underline' }}>U</span>
      </button>
    </div>
  );
}

/**
 * Hook to manage text formatting state and popup visibility.
 */
export function useFormatPopup() {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [formats, setFormats] = useState({ bold: false, italic: false, underline: false });

  const show = useCallback((x, y) => {
    setPosition({ x, y: y - 44 });
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    setVisible(false);
    setFormats({ bold: false, italic: false, underline: false });
  }, []);

  const toggleFormat = useCallback((format) => {
    setFormats(prev => ({ ...prev, [format]: !prev[format] }));
  }, []);

  return { visible, position, formats, show, hide, toggleFormat };
}

const WIDTH_DOTS = [3, 8, 14];

const ICONS = {
  pen: <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />,
  text: (
    <>
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="9" y1="20" x2="15" y2="20" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </>
  ),
  eraser: (
    <>
      <path d="M20 20H7L3 16l13-13 6 6-2 11z" />
      <line x1="6" y1="14" x2="14" y2="6" />
    </>
  ),
  undo: (
    <>
      <polyline points="9 14 4 9 9 4" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </>
  ),
  redo: (
    <>
      <polyline points="15 14 20 9 15 4" />
      <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
    </>
  ),
  save: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
      <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" />
    </>
  ),
  camera: (
    <>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </>
  ),
};

const Icon = ({ name, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    {ICONS[name]}
  </svg>
);

const TOOL_TITLES = { pen: 'Pen (P)', text: 'Text (T)', eraser: 'Eraser (E)' };

export function Toolbar({ canvas, aiOpen, onToggleAi, onScreenshot }) {
  const { tool, colorIndex, widthIndex, history, saving, colors,
    selectTool, selectColor, selectWidth, undo, redo, saveLink } = canvas;

  return (
    <nav id="bar">
      {['pen', 'text', 'eraser'].map(t => (
        <button key={t} id={'btn-' + t} className={'tb' + (tool === t ? ' on' : '')}
          title={TOOL_TITLES[t]} onClick={() => selectTool(t)}>
          <Icon name={t} />
        </button>
      ))}

      <div className="sep" />

      <button className="tb" id="btn-undo" title="Undo ⌘Z" disabled={!history.canUndo} onClick={undo}>
        <Icon name="undo" size={15} />
      </button>
      <button className="tb" id="btn-redo" title="Redo ⌘⇧Z" disabled={!history.canRedo} onClick={redo}>
        <Icon name="redo" size={15} />
      </button>

      <div className="sep" />

      {colors.map((_, i) => (
        <button key={i} className={'cb' + (colorIndex === i ? ' on' : '')}
          style={{ background: `var(--c${i})` }} title={i === 6 ? 'White ink in dark mode' : `Color ${i + 1}`}
          onClick={() => selectColor(i)} />
      ))}

      <div className="sep" />

      {WIDTH_DOTS.map((d, i) => (
        <button key={i} className={'wb' + (widthIndex === i ? ' on' : '')} data-wi={i}
          title={['Thin', 'Medium', 'Thick'][i]} onClick={() => selectWidth(i)}>
          <span className="dot" style={{ width: d, height: d }} />
        </button>
      ))}

      <div className="sep" />

      <button className="tb" id="btn-screenshot" title="Screenshot"
        onClick={onScreenshot}>
        <Icon name="camera" />
      </button>

      <button className={'tb' + (aiOpen ? ' on' : '')} id="btn-ai"
        title="AI Assistant ⌘⇧A" onClick={onToggleAi}>
        <Icon name="spark" />
      </button>

      <button className="tb" id="btn-save" title="Save current view as link"
        disabled={saving} style={saving ? { opacity: '.25' } : undefined} onClick={saveLink}>
        <Icon name="save" />
      </button>
    </nav>
  );
}

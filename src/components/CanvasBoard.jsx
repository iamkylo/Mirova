export function CanvasBoard({ canvas }) {
  const { rootRef, zoomRef, toast, resetView } = canvas;

  return (
    <>
      {/* The engine grabs these four nodes by id and owns them imperatively.
          The textarea must stay uncontrolled (defaultValue) so the engine can
          drive .value / .style during text placement. */}
      <div id="cicada-root" ref={rootRef}>
        <canvas id="base" />
        <canvas id="live" />
        <canvas id="cur" />
        <textarea id="ti" rows="1" spellCheck="false" defaultValue="" />
      </div>

      <button id="zoom-hud" ref={zoomRef} title="Reset view (0)" onClick={resetView}>100%</button>
      <div id="toast" className={toast ? 'show' : ''}>{toast}</div>
    </>
  );
}

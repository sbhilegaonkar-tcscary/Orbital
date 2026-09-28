/**
 * The two overlays that belong to the *stage* rather than to the explorer:
 * the breadcrumb (top-left) and the legend (bottom-left). Plain HTML over the
 * renderer's SVG, so labels stay selectable, focusable and styled by the same
 * tokens as the rest of the shell.
 *
 * M8.5 moved everything else out. The filter and the hidden toggle went into
 * `MapExplorer.tsx`'s header, the detail card and the create row became the
 * explorer's fact block and action row, and the Chart | Orbit dial left the UI
 * entirely (the store still keeps `mode` for the chart fallback; `O` and
 * `map.toggleMode` still act on it).
 */
import { useMapStore, type BodyStatus } from './store';

export type LegendKind = 'notebook' | 'directory' | 'file' | 'open' | 'error' | 'busy';

/**
 * The glyphs in the legend are the body shapes themselves, at legend scale.
 * Exported because the explorer's rows use exactly the same marks — one shape
 * per kind, defined once, so a row and a body never disagree.
 */
export function LegendGlyph({ kind }: { kind: LegendKind }) {
  return (
    <svg className={`legend-glyph kind-${kind}`} viewBox="-11 -11 22 22" aria-hidden="true">
      {kind === 'file' ? (
        <path className="shape" d="M 5 0 L 2.2 3.6 L -2.4 3.4 L -4.6 0 L -2.2 -3.8 L 2.6 -3.4 Z" />
      ) : (
        <circle className="shape" r={kind === 'directory' ? 5 : 4.5} />
      )}
      {kind === 'directory' && <ellipse className="belt" rx={10} ry={3.5} transform="rotate(-20)" />}
      {kind === 'open' && <circle className="halo" r={7.5} />}
      {kind === 'error' && <path className="err-arc" d="M 4.8 -5.8 A 7.5 7.5 0 0 1 4.8 5.8" />}
      {kind === 'busy' && <circle className="sat" cx={7} cy={-7} r={2} />}
    </svg>
  );
}

/** The LED colour for a body's kernel, shared by the explorer's rows and facts. */
export function ledClassFor(status: BodyStatus): string {
  switch (status.kernel) {
    case 'idle':
      return 'led-ok';
    case 'dead':
      return 'led-err';
    default:
      return 'led-warn';
  }
}

export function MapHud() {
  const dir = useMapStore((s) => s.dir);
  const crumbs = dir === '' ? [] : dir.split('/');

  function crumbPath(index: number): string {
    return crumbs.slice(0, index + 1).join('/');
  }

  return (
    <>
      <nav className="map-panel map-breadcrumb" aria-label="Map location">
        {dir !== '' && (
          <button type="button" className="crumb-up" title="Go up a level" onClick={() => useMapStore.getState().up()}>
            ↑
          </button>
        )}
        <button type="button" className="crumb" onClick={() => useMapStore.getState().dive('')}>
          workspace
        </button>
        {crumbs.map((name, i) =>
          i === crumbs.length - 1 ? (
            <span key={crumbPath(i)} className="crumb crumb-current" aria-current="page">
              <span className="crumb-sep">›</span>
              {name}
            </span>
          ) : (
            <button
              key={crumbPath(i)}
              type="button"
              className="crumb"
              onClick={() => useMapStore.getState().dive(crumbPath(i))}
            >
              <span className="crumb-sep">›</span>
              {name}
            </button>
          ),
        )}
        {/* The camera lives inside the renderer, so the button asks the store
            and `map/useViewport` answers. Same route as `F`. */}
        <button
          type="button"
          className="crumb-fit"
          title="Fit the whole map in view (F)"
          onClick={() => useMapStore.getState().requestFit()}
        >
          ⤢ fit
        </button>
      </nav>

      <aside className="map-panel map-legend" aria-label="Legend">
        <span className="legend-item">
          <LegendGlyph kind="notebook" /> notebook
        </span>
        <span className="legend-item">
          <LegendGlyph kind="directory" /> folder
        </span>
        <span className="legend-item">
          <LegendGlyph kind="file" /> file
        </span>
        <span className="legend-item">
          <LegendGlyph kind="open" /> open
        </span>
        <span className="legend-item">
          <LegendGlyph kind="error" /> error
        </span>
        <span className="legend-item">
          <LegendGlyph kind="busy" /> busy
        </span>
        {/* The stage is bigger than the window it is shown in, so say how to
            move around it. Faint, on its own line, below the glyphs. */}
        <span className="legend-hint">drag to pan · scroll to zoom · double-click to fit</span>
      </aside>
    </>
  );
}

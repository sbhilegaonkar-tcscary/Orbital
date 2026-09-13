/**
 * One tab per open notebook (`openPaths`), above the toolbar. Click
 * activates, the close button (or a middle-click anywhere on the tab)
 * closes it, confirming first when the notebook is dirty.
 */
import { useNotebookStore } from './store';

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

export function TabsBar() {
  const openPaths = useNotebookStore((s) => s.openPaths);
  const activePath = useNotebookStore((s) => s.activePath);
  const dirty = useNotebookStore((s) => s.dirty);

  if (openPaths.length === 0) return null;

  function requestClose(path: string) {
    if (dirty[path] && !window.confirm(`Close "${basename(path)}"? Unsaved changes will be lost.`)) {
      return;
    }
    void useNotebookStore.getState().close(path);
  }

  return (
    <div className="tabs-bar" role="tablist" aria-label="Open notebooks">
      {openPaths.map((path) => {
        const isActive = path === activePath;
        return (
          <div
            key={path}
            role="tab"
            aria-selected={isActive}
            className={`tab${isActive ? ' tab-active' : ''}`}
            title={path}
            onClick={() => useNotebookStore.getState().activate(path)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                requestClose(path);
              }
            }}
          >
            <span className="tab-name">{basename(path)}</span>
            {dirty[path] && <i className="dirty-dot" aria-label="unsaved changes" />}
            <button
              type="button"
              className="tab-close"
              title="Close notebook"
              aria-label={`Close ${basename(path)}`}
              onClick={(e) => {
                e.stopPropagation();
                requestClose(path);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * One tab per open document — notebook or text file — rendered from
 * `shell/tabs.ts`'s `useTabsStore` (docs/ARCHITECTURE.md "Files (M6)"), which
 * is the single source of truth for tab order and which tab is active.
 * Click activates via `activateTab` (which itself calls into `notebook/store`
 * for notebook tabs); the close button (or a middle-click anywhere on the
 * tab) closes via `closeTab`, confirming first when the document is dirty.
 */
import { useTabsStore, type TabRef } from '../shell/tabs';
import { useNotebookStore } from './store';
import { useFilesStore } from '../files/store';

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

function isDirty(tab: TabRef): boolean {
  return tab.kind === 'notebook' ? useNotebookStore.getState().dirty[tab.path] === true : useFilesStore.getState().files[tab.path]?.dirty === true;
}

/** Small badge distinguishing a file tab from a notebook tab. */
function FileGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path d="M4 2h5l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 2v3h3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TabsBar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTab = useTabsStore((s) => s.activeTab);
  // Re-render on dirty-flag changes from either store so the dot stays live.
  useNotebookStore((s) => s.dirty);
  useFilesStore((s) => s.files);

  if (tabs.length === 0) return null;

  function requestClose(tab: TabRef) {
    if (isDirty(tab) && !window.confirm(`Close "${basename(tab.path)}"? Unsaved changes will be lost.`)) {
      return;
    }
    useTabsStore.getState().closeTab(tab);
  }

  return (
    <div className="tabs-bar" role="tablist" aria-label="Open documents">
      {tabs.map((tab) => {
        const isActive = activeTab?.kind === tab.kind && activeTab.path === tab.path;
        const key = `${tab.kind}:${tab.path}`;
        return (
          <div
            key={key}
            role="tab"
            aria-selected={isActive}
            className={`tab${isActive ? ' tab-active' : ''}`}
            title={tab.path}
            onClick={() => useTabsStore.getState().activateTab(tab)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                requestClose(tab);
              }
            }}
          >
            {tab.kind === 'file' && <FileGlyph />}
            <span className="tab-name">{basename(tab.path)}</span>
            {isDirty(tab) && <i className="dirty-dot" aria-label="unsaved changes" />}
            <button
              type="button"
              className="tab-close"
              title={`Close ${tab.kind === 'notebook' ? 'notebook' : 'file'}`}
              aria-label={`Close ${basename(tab.path)}`}
              onClick={(e) => {
                e.stopPropagation();
                requestClose(tab);
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

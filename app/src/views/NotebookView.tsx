import { useEffect, useState } from 'react';
import { useSessionStore } from '../session/store';
import { useNotebookStore } from '../notebook/store';
import type { ContentsEntry } from '../session/types';
import { Notebook } from '../notebook/Notebook';
import { useUiStore } from '../App';

export function NotebookView() {
  const connection = useSessionStore((s) => s.connection);
  const provider = useSessionStore((s) => s.provider);
  const notebook = useNotebookStore((s) => s.notebook);
  const dirty = useNotebookStore((s) => s.dirty);

  const [entries, setEntries] = useState<ContentsEntry[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  // Dev aid: `?fixture=1` loads a canned notebook without a server so the
  // notebook can be screenshotted in every mode. Not reachable from the UI.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('fixture') !== '1') return;
    if (useNotebookStore.getState().notebook) return;
    void import('../notebook/fixture').then(({ fixtureNotebook }) => {
      useNotebookStore.setState({
        notebook: fixtureNotebook,
        selectedCellId: fixtureNotebook.cells[0]?.id ?? null,
        loading: false,
        error: null,
        dirty: false,
      });
    });
  }, []);

  useEffect(() => {
    if (connection !== 'connected' || !provider) return;
    let cancelled = false;
    provider.contents
      .list('')
      .then((list) => {
        if (!cancelled) setEntries(list.filter((e) => e.type === 'notebook'));
      })
      .catch((err: unknown) => {
        if (!cancelled) setListError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [connection, provider]);

  // An open notebook stays visible even if the connection drops; actions
  // report "Not connected" instead of the view vanishing.
  if (!notebook && connection !== 'connected') {
    return (
      <div className="view-placeholder">
        <div className="card">
          <h2>Not connected</h2>
          <p className="muted">Connect to a Jupyter server to browse and open notebooks.</p>
          <div className="card-actions">
            <button type="button" onClick={() => void useSessionStore.getState().connect()}>
              Connect
            </button>
            <button type="button" className="link-button" onClick={() => useUiStore.getState().setView('settings')}>
              Go to Settings
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (notebook) {
    return (
      <div className="notebook-view">
        <div className="notebook-toolbar">
          <button type="button" onClick={() => void useNotebookStore.getState().runAll()}>
            Run all
          </button>
          <button type="button" onClick={() => void useNotebookStore.getState().interrupt()}>
            Interrupt
          </button>
          <button type="button" onClick={() => void useNotebookStore.getState().restartKernel()}>
            Restart
          </button>
          <button type="button" onClick={() => void useNotebookStore.getState().save()}>
            Save
            {dirty && <i className="dirty-dot" aria-label="unsaved changes" />}
          </button>
        </div>
        <Notebook />
      </div>
    );
  }

  return (
    <div className="notebook-picker">
      <h2>Notebooks</h2>
      {listError && <p className="error-text">{listError}</p>}
      {entries.length === 0 && !listError && <p className="muted">No notebooks found.</p>}
      <ul className="notebook-list">
        {entries.map((entry) => (
          <li key={entry.path}>
            <button type="button" onClick={() => void useNotebookStore.getState().open(entry.path)}>
              {entry.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

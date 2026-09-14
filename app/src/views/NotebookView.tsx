import { useEffect, useState } from 'react';
import { useSessionStore } from '../session/store';
import { useNotebookStore } from '../notebook/store';
import type { ContentsEntry } from '../session/types';
import { Notebook } from '../notebook/Notebook';
import { TabsBar } from '../notebook/TabsBar';
import { NotebookToolbar } from '../notebook/NotebookToolbar';
import { useUiStore } from '../shell/uiStore';
import { useTabsStore } from '../shell/tabs';
import { FileEditor } from '../files/FileEditor';

export function NotebookView() {
  const connection = useSessionStore((s) => s.connection);
  const provider = useSessionStore((s) => s.provider);
  const openPaths = useNotebookStore((s) => s.openPaths);
  const tabs = useTabsStore((s) => s.tabs);
  const activeTab = useTabsStore((s) => s.activeTab);

  const [entries, setEntries] = useState<ContentsEntry[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Dev aid: `?fixture=1` loads a canned notebook without a server so the
  // notebook can be screenshotted in every mode. Not reachable from the UI.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('fixture') !== '1') return;
    if (useNotebookStore.getState().activePath) return;
    void import('../notebook/fixture').then(({ fixtureNotebook }) => {
      const path = fixtureNotebook.path;
      useNotebookStore.setState({
        docs: { [path]: fixtureNotebook },
        dirty: { [path]: false },
        openPaths: [path],
        activePath: path,
        selectedCellId: fixtureNotebook.cells[0]?.id ?? null,
        loading: false,
        error: null,
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

  async function createAndOpen() {
    if (!provider) return;
    setCreating(true);
    setListError(null);
    try {
      const path = await provider.contents.createNotebook('');
      await useNotebookStore.getState().open(path);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  // An open document (notebook or file) stays visible even if the connection
  // drops; actions report "Not connected" instead of the view vanishing.
  if (tabs.length === 0 && connection !== 'connected') {
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

  if (activeTab?.kind === 'file') {
    return (
      <div className="notebook-view">
        <TabsBar />
        <FileEditor key={activeTab.path} path={activeTab.path} />
      </div>
    );
  }

  if (openPaths.length > 0) {
    return (
      <div className="notebook-view">
        <TabsBar />
        <NotebookToolbar />
        <Notebook />
      </div>
    );
  }

  return (
    <div className="notebook-picker">
      <h2>Notebooks</h2>
      {listError && <p className="error-text">{listError}</p>}
      <div className="notebook-picker-actions">
        <button type="button" className="new-notebook-button" disabled={creating} onClick={() => void createAndOpen()}>
          ＋ New notebook
        </button>
      </div>
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

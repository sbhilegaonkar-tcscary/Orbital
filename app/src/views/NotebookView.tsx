import { useEffect } from 'react';
import { useNotebookStore } from '../notebook/store';
import { Notebook } from '../notebook/Notebook';
import { TabsBar } from '../notebook/TabsBar';
import { NotebookToolbar } from '../notebook/NotebookToolbar';
import { useTabsStore } from '../shell/tabs';
import { FileEditor } from '../files/FileEditor';
import { HomeView } from './HomeView';

export function NotebookView() {
  const openPaths = useNotebookStore((s) => s.openPaths);
  const tabs = useTabsStore((s) => s.tabs);
  const activeTab = useTabsStore((s) => s.activeTab);

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

  // No open document at all: the calm start page, not a bare picker. An
  // already-open document (notebook or file) stays visible even if the
  // connection later drops; actions report "Not connected" instead of the
  // view vanishing.
  if (tabs.length === 0) {
    return <HomeView />;
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

  // tabs.length > 0 but neither branch matched yet (activeTab hasn't caught
  // up with a just-added tab within the same tick); the tab bar alone is a
  // safe, non-flashing placeholder until the next render resolves it.
  return (
    <div className="notebook-view">
      <TabsBar />
    </div>
  );
}

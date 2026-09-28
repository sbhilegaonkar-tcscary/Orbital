/**
 * The calm start page (docs/DESIGN.md). Reached either directly (the `home`
 * view, via the ORBITAL logo or the "Go to: Home" command) or as
 * `NotebookView`'s fallback whenever no tab is open — so the owner always
 * has somewhere to land instead of an empty picker.
 */
import { connectionMessage, useSessionStore } from '../session/store';
import { useNotebookStore } from '../notebook/store';
import { useLayoutStore } from '../shell/layout';
import { runCommand } from '../shell/commands';
import { useRecent, relativeTime, splitPath } from '../shell/recent';
import { NotConnectedCard } from '../shell/NotConnectedCard';

export function HomeView() {
  const connection = useSessionStore((s) => s.connection);
  const recent = useRecent();

  return (
    <div className="home-view">
      <h1 className="home-heading">workspace</h1>

      {connection === 'connected' ? (
        <section className="home-recent">
          <h2 className="home-section-title">Recent</h2>
          {recent.length === 0 ? (
            <p className="muted">Nothing opened yet.</p>
          ) : (
            <ul className="home-recent-list">
              {recent.map((entry) => {
                const { name, dir } = splitPath(entry.path);
                return (
                  <li key={entry.path}>
                    <button
                      type="button"
                      className="home-recent-item"
                      onClick={() => void useNotebookStore.getState().open(entry.path)}
                    >
                      <span className="home-recent-name">{name}</span>
                      <span className="home-recent-dir">{dir || '/'}</span>
                      <span className="home-recent-time">{relativeTime(entry.openedAt)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : (
        <NotConnectedCard />
      )}

      <div className="home-actions">
        <button
          type="button"
          disabled={connection !== 'connected'}
          title={connection === 'connected' ? undefined : connectionMessage()}
          onClick={() => runCommand('notebook.newNotebook')}
        >
          ＋ New notebook
        </button>
        <button type="button" onClick={() => useLayoutStore.getState().setVisible('files', true)}>
          Open file browser
        </button>
        <button type="button" onClick={() => runCommand('terminal.new')}>
          Open terminal
        </button>
      </div>
    </div>
  );
}

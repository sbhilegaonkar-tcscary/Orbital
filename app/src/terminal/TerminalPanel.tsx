/**
 * Slim tab strip + active `TerminalView`, rendered inside the terminal
 * panel's `PanelFrame` body (`shell/Dock.tsx`). This tab strip is separate
 * from `PanelFrame`'s own header, which just titles/hides the whole panel.
 */
import { useEffect, useRef } from 'react';
import { useTerminalStore } from './store';
import { useSessionStore } from '../session/store';
import { TerminalView } from './TerminalView';
import './terminal.css';

export function TerminalPanel() {
  const terminals = useTerminalStore((s) => s.terminals);
  const active = useTerminalStore((s) => s.active);
  const status = useTerminalStore((s) => s.status);
  const create = useTerminalStore((s) => s.create);
  const close = useTerminalStore((s) => s.close);
  const activate = useTerminalStore((s) => s.activate);
  const refresh = useTerminalStore((s) => s.refresh);

  // First time the panel is shown with nothing open, start one automatically.
  // The panel can mount before the session connects (e.g. `?panels=terminal`
  // on a fresh load), so this also waits for `connected` rather than firing
  // once and giving up.
  const autoCreatedRef = useRef(false);
  useEffect(() => {
    const tryAutoCreate = () => {
      if (autoCreatedRef.current) return;
      if (useTerminalStore.getState().terminals.length > 0) {
        autoCreatedRef.current = true;
        return;
      }
      if (useSessionStore.getState().connection !== 'connected') return;
      autoCreatedRef.current = true;
      create().catch(() => {
        /* e.g. the server dropped between connecting and starting the shell */
      });
    };
    tryAutoCreate();
    return useSessionStore.subscribe(tryAutoCreate);
    // Mount-only: closing the last terminal afterwards should not re-trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="terminal-panel">
      <div className="terminal-tabstrip">
        {terminals.map((t) => (
          <button
            type="button"
            key={t.name}
            className={`terminal-tab${t.name === active ? ' terminal-tab-active' : ''}`}
            onClick={() => activate(t.name)}
            title={t.title}
          >
            <span className={`terminal-tab-dot terminal-tab-dot-${status[t.name] ?? 'closed'}`} aria-hidden="true" />
            <span className="terminal-tab-title">{t.title}</span>
            <span
              className="terminal-tab-close"
              role="button"
              tabIndex={0}
              aria-label={`Close ${t.title}`}
              onClick={(event) => {
                event.stopPropagation();
                void close(t.name);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.stopPropagation();
                  event.preventDefault();
                  void close(t.name);
                }
              }}
            >
              ×
            </span>
          </button>
        ))}
        <button type="button" className="terminal-tab-action" aria-label="New terminal" title="New terminal" onClick={() => void create()}>
          +
        </button>
        <button type="button" className="terminal-tab-action" aria-label="Refresh terminals" title="Refresh" onClick={() => void refresh()}>
          ⟳
        </button>
      </div>
      <div className="terminal-body">
        {terminals.length === 0 ? (
          <div className="terminal-empty">
            <p className="muted">No terminal · press + or Ctrl+`</p>
            <button type="button" onClick={() => void create()}>
              New terminal
            </button>
          </div>
        ) : (
          terminals.map((t) => <TerminalView key={t.name} name={t.name} visible={t.name === active} />)
        )}
      </div>
    </div>
  );
}

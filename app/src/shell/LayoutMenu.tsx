/**
 * Top-bar "Layout" menu (docs/DESIGN.md), styled like `ModeMenu`: a small
 * trigger opening a popover with one row per dock panel (visibility
 * checkbox, and a left/right side control for the panels that can move),
 * plus "Reset layout" and "Keyboard shortcuts" at the bottom.
 */
import { useEffect, useRef, useState } from 'react';
import { useLayoutStore, PANEL_IDS, type PanelId } from './layout';
import { openShortcutsHelp } from './shortcuts';

/** Mirrors `Dock.tsx`'s own `PANEL_TITLES`; kept local since that map isn't exported. */
const PANEL_LABELS: Record<PanelId, string> = {
  files: 'Files',
  inspector: 'Inspector',
  terminal: 'Terminal',
  agent: 'Agent',
};

/** Terminal is bottom-only; only side docks can move between left and right. */
const SIDE_MOVABLE = new Set<PanelId>(['files', 'inspector', 'agent']);

function LayoutIcon() {
  return (
    <svg className="layout-menu-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
      <path d="M5.5 2.5v11" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10 3 6 8l4 5" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 3l4 5-4 5" />
    </svg>
  );
}

export function LayoutMenu() {
  const panels = useLayoutStore((s) => s.panels);
  const setVisible = useLayoutStore((s) => s.setVisible);
  const setSide = useLayoutStore((s) => s.setSide);
  const reset = useLayoutStore((s) => s.reset);

  // Dev aid: `?menu=layout` opens this menu on load, for headless screenshots.
  const [open, setOpen] = useState(
    () => new URLSearchParams(window.location.search).get('menu') === 'layout',
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="layout-menu" ref={rootRef}>
      <button
        type="button"
        className="layout-menu-trigger"
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        title="Layout"
      >
        <LayoutIcon />
        <span>Layout</span>
      </button>
      {open && (
        <div className="layout-menu-popover" role="menu">
          {PANEL_IDS.map((id) => {
            const panel = panels[id];
            return (
              <div className="layout-menu-row" key={id}>
                <label className="layout-menu-checkbox">
                  <input type="checkbox" checked={panel.visible} onChange={() => setVisible(id, !panel.visible)} />
                  {PANEL_LABELS[id]}
                </label>
                {SIDE_MOVABLE.has(id) && (
                  <div className="layout-menu-side-control" role="group" aria-label={`${PANEL_LABELS[id]} side`}>
                    <button
                      type="button"
                      className={`layout-menu-side-btn${panel.side === 'left' ? ' active' : ''}`}
                      aria-pressed={panel.side === 'left'}
                      title="Move to left"
                      onClick={() => setSide(id, 'left')}
                    >
                      <ChevronLeftIcon />
                    </button>
                    <button
                      type="button"
                      className={`layout-menu-side-btn${panel.side === 'right' ? ' active' : ''}`}
                      aria-pressed={panel.side === 'right'}
                      title="Move to right"
                      onClick={() => setSide(id, 'right')}
                    >
                      <ChevronRightIcon />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          <div className="layout-menu-footer">
            <button type="button" onClick={() => reset()}>
              Reset layout
            </button>
            <button
              type="button"
              onClick={() => {
                openShortcutsHelp();
                setOpen(false);
              }}
            >
              Keyboard shortcuts
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

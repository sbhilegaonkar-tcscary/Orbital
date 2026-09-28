/**
 * Keyboard shortcut overlay, generated from `shortcuts.ts` (which must match
 * docs/KEYBOARD.md). Opened by `?`/`H` in command mode or the "Keyboard
 * shortcuts" command; Esc or an outside click closes it, mirroring
 * `CommandPalette`'s overlay pattern.
 */
import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { SHORTCUTS, type ShortcutContext } from './shortcuts';
import './shortcuts.css';

const SECTIONS: { context: ShortcutContext; title: string }[] = [
  { context: 'command', title: 'Command mode' },
  { context: 'edit', title: 'Edit mode' },
  { context: 'map', title: 'Map view' },
  { context: 'global', title: 'Global' },
];

export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open, onClose]);

  // The dialog takes focus so Esc closes it wherever it was opened from (the
  // notebook, the map, the palette), and hands focus back on the way out.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    returnTo.current = previous instanceof HTMLElement ? previous : null;
    rootRef.current?.focus();
    return () => {
      returnTo.current?.focus();
      returnTo.current = null;
    };
  }, [open]);

  if (!open) return null;

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }

  return (
    <div className="shortcuts-help-overlay">
      <div
        className="shortcuts-help"
        ref={rootRef}
        role="dialog"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="shortcuts-help-header">
          <span>Keyboard shortcuts</span>
          <button type="button" className="shortcuts-help-close" aria-label="Close" onClick={onClose}>
            Esc
          </button>
        </div>
        <div className="shortcuts-help-sections">
          {SECTIONS.map(({ context, title }) => (
            <div className="shortcuts-help-section" key={context}>
              <h3>{title}</h3>
              {SHORTCUTS.filter((s) => s.context === context).map((s) => (
                <div className="shortcuts-help-row" key={`${context}-${s.keys}`}>
                  <span className="shortcuts-help-keys">
                    {s.keys.split(' / ').map((chord, i) => (
                      <span key={chord}>
                        {i > 0 && <span className="shortcuts-help-sep">/</span>}
                        {/* "D D" repeats a key, so the index has to be part of it. */}
                        {chord.split(' ').map((k, ki) => (
                          <kbd key={`${k}-${ki}`}>{k}</kbd>
                        ))}
                      </span>
                    ))}
                  </span>
                  <span className="shortcuts-help-action">{s.action}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

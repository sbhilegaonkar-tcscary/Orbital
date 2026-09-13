import { useEffect, useRef, useState } from 'react';
import { MODES } from '../theme/tokens';
import { useThemeStore, getSkinsForMode } from '../theme/ThemeProvider';

export function ModeDial() {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const skinByMode = useThemeStore((s) => s.skinByMode);
  const setSkin = useThemeStore((s) => s.setSkin);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const skins = getSkinsForMode(mode);
  const activeSkinId = skinByMode[mode];

  return (
    <div className="mode-dial-group">
      <nav className="mode-dial" aria-label="Mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`mode-dial-segment${m.id === mode ? ' active' : ''}`}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </nav>
      <div className="skin-picker" ref={popoverRef}>
        <button
          type="button"
          className="skin-button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="true"
          aria-expanded={open}
        >
          Skin
        </button>
        {open && (
          <div className="skin-popover">
            {skins.map((skin) => (
              <button
                key={skin.id}
                type="button"
                className={`skin-option${skin.id === activeSkinId ? ' active' : ''}`}
                onClick={() => {
                  setSkin(mode, skin.id);
                  setOpen(false);
                }}
              >
                <span className="skin-option-name">{skin.name}</span>
                <span className="skin-option-desc">{skin.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

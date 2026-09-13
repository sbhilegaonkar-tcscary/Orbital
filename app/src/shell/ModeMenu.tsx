import { useEffect, useRef, useState } from 'react';
import { MODES } from '../theme/tokens';
import { useThemeStore, getSkinsForMode } from '../theme/ThemeProvider';

type Motion = 'system' | 'reduced' | 'full';

const MOTION_OPTIONS: { id: Motion; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'reduced', label: 'Reduced' },
  { id: 'full', label: 'Full' },
];

function ChevronIcon() {
  return (
    <svg className="mode-menu-chevron" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="mode-menu-check" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  );
}

export function ModeMenu() {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const skinByMode = useThemeStore((s) => s.skinByMode);
  const setSkin = useThemeStore((s) => s.setSkin);
  const motion = useThemeStore((s) => s.motion);
  const setMotion = useThemeStore((s) => s.setMotion);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<HTMLButtonElement[]>([]);

  // Dev aid: `?menu=mode` opens this menu on load, for headless screenshots.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('menu') === 'mode') setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = itemRefs.current.filter(Boolean);
        if (items.length === 0) return;
        const currentIndex = items.findIndex((el) => el === document.activeElement);
        const nextIndex =
          currentIndex === -1
            ? e.key === 'ArrowDown'
              ? 0
              : items.length - 1
            : e.key === 'ArrowDown'
              ? (currentIndex + 1) % items.length
              : (currentIndex - 1 + items.length) % items.length;
        items[nextIndex]?.focus();
      }
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => itemRefs.current[0]?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const activeMode = MODES.find((m) => m.id === mode);

  let rowIndex = 0;

  return (
    <div className="mode-menu" ref={rootRef}>
      <button
        type="button"
        className="mode-menu-trigger"
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span>{activeMode?.label ?? mode}</span>
        <ChevronIcon />
      </button>
      {open && (
        <div className="mode-menu-popover" role="menu">
          {MODES.map((m) => {
            const skins = getSkinsForMode(m.id);
            const activeSkinId = skinByMode[m.id];
            return (
              <div className="mode-menu-section" key={m.id}>
                <div className="mode-menu-section-title">{m.label}</div>
                {skins.map((skin) => {
                  const isActive = m.id === mode && skin.id === activeSkinId;
                  const i = rowIndex;
                  rowIndex += 1;
                  return (
                    <button
                      key={skin.id}
                      type="button"
                      ref={(el) => {
                        if (el) itemRefs.current[i] = el;
                      }}
                      role="menuitemradio"
                      aria-checked={isActive}
                      className={`mode-menu-row${isActive ? ' active' : ''}`}
                      onClick={() => {
                        setMode(m.id);
                        setSkin(m.id, skin.id);
                        setOpen(false);
                        triggerRef.current?.focus();
                      }}
                    >
                      <span className="mode-menu-row-name">
                        {skin.name}
                        {isActive && <CheckIcon />}
                      </span>
                      <span className="mode-menu-row-desc">{skin.description}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
          <div className="mode-menu-section mode-menu-motion">
            <div className="mode-menu-section-title">Motion</div>
            <div className="mode-menu-motion-row">
              {MOTION_OPTIONS.map((opt) => {
                const i = rowIndex;
                rowIndex += 1;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    ref={(el) => {
                      if (el) itemRefs.current[i] = el;
                    }}
                    role="menuitemradio"
                    aria-checked={motion === opt.id}
                    className={`mode-menu-motion-option${motion === opt.id ? ' active' : ''}`}
                    onClick={() => setMotion(opt.id)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

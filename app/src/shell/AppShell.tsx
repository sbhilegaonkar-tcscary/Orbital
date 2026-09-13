import { useEffect, useState, type ReactNode } from 'react';
import { useThemeStore } from '../theme/ThemeProvider';
import { Sky } from '../effects/Sky';
import { TopBar } from './TopBar';
import { Rail } from './Rail';
import { Inspector } from './Inspector';
import { StatusBar } from './StatusBar';
import { CommandPalette } from './CommandPalette';
import { wireInspector } from '../inspector/store';
import { getActiveSession, onExecutionSettled } from '../notebook/store';
// Side-effect only: runs the notebook command registrations once.
import '../notebook/commands';

export function AppShell({ children }: { children: ReactNode }) {
  const mode = useThemeStore((s) => s.mode);

  useEffect(() => wireInspector(getActiveSession, onExecutionSettled), []);

  // Dev aid: `?menu=palette` opens the palette on load, for headless screenshots.
  const [paletteOpen, setPaletteOpen] = useState(
    () => new URLSearchParams(window.location.search).get('menu') === 'palette',
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      const isPaletteShortcut = (e.ctrlKey || e.metaKey) && (key === 'k' || (e.shiftKey && key === 'p'));
      if (!isPaletteShortcut) return;
      e.preventDefault();
      setPaletteOpen((o) => !o);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="app-shell">
      {mode === 'bridge' && <Sky />}
      <TopBar />
      <Rail />
      <div className="view-container">{children}</div>
      <Inspector />
      <StatusBar />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

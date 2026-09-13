import type { ReactNode } from 'react';
import { useThemeStore } from '../theme/ThemeProvider';
import { Sky } from '../effects/Sky';
import { TopBar } from './TopBar';
import { Rail } from './Rail';
import { Inspector } from './Inspector';
import { StatusBar } from './StatusBar';

export function AppShell({ children }: { children: ReactNode }) {
  const mode = useThemeStore((s) => s.mode);

  return (
    <div className="app-shell">
      {mode === 'bridge' && <Sky />}
      <TopBar />
      <Rail />
      <div className="view-container">{children}</div>
      <Inspector />
      <StatusBar />
    </div>
  );
}

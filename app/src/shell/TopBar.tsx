import { useActiveNotebook } from '../notebook/store';
import { useSessionStore } from '../session/store';
import type { KernelStatus } from '../session/types';
import { ModeMenu } from './ModeMenu';

const STATUS_TONE: Record<KernelStatus, 'success' | 'warning' | 'danger' | 'muted'> = {
  disconnected: 'muted',
  connecting: 'muted',
  starting: 'warning',
  idle: 'success',
  busy: 'warning',
  restarting: 'warning',
  dead: 'danger',
};

export function TopBar() {
  const notebookPath = useActiveNotebook()?.path;
  const kernelStatus = useSessionStore((s) => s.kernelStatus);
  const kernelName = useSessionStore((s) => s.kernelName);

  const tone = STATUS_TONE[kernelStatus];

  return (
    <header className="topbar">
      <span className="topbar-logo">ORBITAL</span>
      <span className="topbar-project">{notebookPath ?? 'no notebook'}</span>
      <ModeMenu />
      <span className="kernel-status">
        <i className={`kernel-dot kernel-dot-${tone}`} aria-hidden="true" />
        {kernelName ? `${kernelName} · ${kernelStatus}` : kernelStatus}
      </span>
    </header>
  );
}

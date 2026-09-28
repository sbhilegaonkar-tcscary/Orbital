/**
 * Replaces the old single kernel-status readout in `TopBar` with three
 * compact service indicators: the kernel behind the active notebook, the
 * Jupyter server connection, and the agent sidecar connection.
 */
import { useSessionStore } from '../session/store';
import type { ConnectionState } from '../session/store';
import type { KernelStatus } from '../session/types';
import { useAgentStore } from '../agent/store';
import { useConnectingSeconds } from './NotConnectedCard';
import { useLayoutStore } from './layout';
import { useUiStore } from './uiStore';

type Tone = 'success' | 'warning' | 'danger' | 'muted';

const KERNEL_TONE: Record<KernelStatus, Tone> = {
  disconnected: 'muted',
  connecting: 'muted',
  starting: 'warning',
  idle: 'success',
  busy: 'warning',
  restarting: 'warning',
  dead: 'danger',
};

function connectionTone(connection: ConnectionState): Tone {
  switch (connection) {
    case 'connected':
      return 'success';
    case 'connecting':
      return 'warning';
    case 'error':
      return 'danger';
    default:
      return 'muted';
  }
}

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connected: 'connected',
  connecting: 'connecting…',
  error: 'connection error',
  disconnected: 'not connected',
};

export function ServiceDots() {
  const kernelStatus = useSessionStore((s) => s.kernelStatus);
  const kernelName = useSessionStore((s) => s.kernelName);
  const jupyterConnection = useSessionStore((s) => s.connection);
  const agentConnection = useAgentStore((s) => s.connection);
  const agentAuth = useAgentStore((s) => s.auth);
  const setView = useUiStore((s) => s.setView);
  const setVisible = useLayoutStore((s) => s.setVisible);
  const connectingSeconds = useConnectingSeconds();

  const kernelTone = KERNEL_TONE[kernelStatus];
  const kernelTitle = kernelName ? `Kernel: ${kernelName} · ${kernelStatus}` : `Kernel: ${kernelStatus}`;

  const connecting = jupyterConnection === 'connecting';
  const jupyterTone = connectionTone(jupyterConnection);
  const jupyterTitle = connecting
    ? `Connecting… (${connectingSeconds}s)`
    : `Jupyter server: ${CONNECTION_LABEL[jupyterConnection]}`;

  const agentTone: Tone =
    agentConnection === 'connected' ? (agentAuth?.loggedIn ? 'success' : 'warning') : connectionTone(agentConnection);
  const agentTitle =
    agentConnection === 'connected'
      ? agentAuth?.loggedIn
        ? 'Agent sidecar: connected and logged in'
        : 'Agent sidecar: connected, not logged in'
      : `Agent sidecar: ${CONNECTION_LABEL[agentConnection]}`;

  return (
    <div className="service-dots">
      <span className="service-dot-item" title={kernelTitle}>
        <i className={`kernel-dot kernel-dot-${kernelTone}`} aria-hidden="true" />
        kernel · {kernelStatus}
      </span>
      <button
        type="button"
        className="service-dot-item service-dot-button"
        title={jupyterTitle}
        onClick={() => setView('settings')}
      >
        <i
          className={`kernel-dot kernel-dot-${jupyterTone}${connecting ? ' kernel-dot-pulse' : ''}`}
          aria-hidden="true"
        />
        jupyter
      </button>
      <button
        type="button"
        className="service-dot-item service-dot-button"
        title={agentTitle}
        onClick={() => setVisible('agent', true)}
      >
        <i className={`kernel-dot kernel-dot-${agentTone}`} aria-hidden="true" />
        agent
      </button>
    </div>
  );
}

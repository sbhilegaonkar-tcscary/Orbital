/**
 * The connection card, shared by the Home view and the Map view. Three
 * states, one card:
 *
 * - disconnected: Connect / Go to Settings.
 * - connecting:   an indeterminate progress bar, the elapsed time, which
 *                 attempt is in flight, and Cancel. Jupyter takes a while to
 *                 boot, so this is the state the owner sees most often.
 * - error:        what went wrong, Retry / Go to Settings.
 *
 * The file name and the `NotConnectedCard` export are kept so `HomeView` and
 * `MapView` need no change; `ConnectionCard` is the honest alias.
 */
import { useEffect, useState } from 'react';
import { useSessionStore } from '../session/store';
import { useUiStore } from './uiStore';

/**
 * Transport-level failures the owner can do nothing about, rephrased as what
 * is actually happening. "Failed to fetch" / ECONNREFUSED during a boot is
 * not an error, it is a server that has not opened its port yet.
 */
const WAITING = 'waiting for the server to answer';

const TRANSPORT_NOISE =
  /failed to fetch|econnrefused|econnreset|network ?error|network request failed|fetch failed|could not reach/i;

function describeAttemptError(raw: string | null): string {
  if (!raw) return WAITING;
  return TRANSPORT_NOISE.test(raw) ? WAITING : raw;
}

/**
 * Seconds since the current connect attempt started, ticking once a second
 * while mounted and 0 when nothing is connecting.
 *
 * Lives here rather than in `session/` because it is React, and `session/`
 * stays React-free (docs/ARCHITECTURE.md). `ServiceDots` and `StatusBar`
 * import it from here so the three readouts never drift apart.
 */
export function useConnectingSeconds(): number {
  const startedAt = useSessionStore((s) => s.attempt?.startedAt ?? null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  if (startedAt === null) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

/** The 2 px indeterminate bar, reused by the shell's top-edge version. */
export function ConnectBar({ className = '' }: { className?: string }) {
  return (
    <div
      className={className ? `connect-bar ${className}` : 'connect-bar'}
      role="progressbar"
      aria-label="Connecting to Jupyter"
    >
      <i className="connect-bar-sweep" aria-hidden="true" />
    </div>
  );
}

export function ConnectionCard() {
  const connection = useSessionStore((s) => s.connection);
  const error = useSessionStore((s) => s.error);
  const attempt = useSessionStore((s) => s.attempt);
  const baseUrl = useSessionStore((s) => s.config.baseUrl);
  const seconds = useConnectingSeconds();

  if (connection === 'connecting') {
    return (
      <div className="card">
        <h2>Connecting to Jupyter</h2>
        <ConnectBar />
        <p className="connect-detail">
          {seconds} s · attempt {attempt?.tries ?? 1} · {baseUrl}
        </p>
        <p className="muted connect-note">{describeAttemptError(attempt?.lastError ?? null)}</p>
        <div className="card-actions">
          <button
            type="button"
            className="link-button"
            onClick={() => useSessionStore.getState().cancelConnect()}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (connection === 'error') {
    return (
      <div className="card">
        <h2>Could not connect</h2>
        <p className="error-text">{error ?? `No answer from ${baseUrl}.`}</p>
        <div className="card-actions">
          <button type="button" onClick={() => void useSessionStore.getState().connect()}>
            Retry
          </button>
          <button
            type="button"
            className="link-button"
            onClick={() => useUiStore.getState().setView('settings')}
          >
            Go to Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Not connected</h2>
      <p className="muted">Connect to a Jupyter server to browse and open notebooks.</p>
      <div className="card-actions">
        <button type="button" onClick={() => void useSessionStore.getState().connect()}>
          Connect
        </button>
        <button
          type="button"
          className="link-button"
          onClick={() => useUiStore.getState().setView('settings')}
        >
          Go to Settings
        </button>
      </div>
    </div>
  );
}

/** Historical name; `HomeView` and `MapView` still import this. */
export const NotConnectedCard = ConnectionCard;

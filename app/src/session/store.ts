/**
 * Session store. The exported API below is a contract used by the shell
 * (kernel status, connect button) and the notebook (provider access).
 *
 * Store actions never throw; failures land in `connection: 'error'` + `error`.
 *
 * `connect()` is a patient retry loop rather than a single attempt: with
 * `scripts/dev.ps1` the browser is up long before Jupyter answers, so the
 * honest state for the first ~10 seconds is "connecting", not "error". The
 * loop keeps `connection: 'connecting'` and publishes its progress through
 * `attempt` until the server answers, the user cancels, the server answers
 * with a refusal (a hard error, where retrying is pointless), or
 * `RETRY_WINDOW_MS` runs out.
 */
import { create } from 'zustand';
import type { KernelStatus, ServerConfig, SessionProvider } from './types';
import { JupyterSessionProvider } from './jupyter';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ConnectAttempt {
  /** epoch ms when this connect() call started, for the elapsed readout. */
  startedAt: number;
  /** The attempt currently in flight, counting from 1. */
  tries: number;
  /** Why the previous attempt failed, or null before the first failure. */
  lastError: string | null;
}

export interface SessionState {
  config: ServerConfig;
  connection: ConnectionState;
  error: string | null;
  /** Status of the kernel behind the currently open notebook, if any. */
  kernelStatus: KernelStatus;
  kernelName: string | null;
  provider: SessionProvider | null;
  /** Present only while `connection === 'connecting'`. */
  attempt: ConnectAttempt | null;

  setConfig(cfg: ServerConfig): void;
  connect(): Promise<void>;
  cancelConnect(): void;
  disconnect(): Promise<void>;
  /** Called by the notebook store when it opens/closes a kernel session. */
  setKernelStatus(status: KernelStatus, kernelName?: string | null): void;
}

const DEFAULT_CONFIG: ServerConfig = {
  baseUrl: 'http://localhost:8888',
  token: 'orbital-dev',
};

/** How long `connect()` keeps retrying a server that never answers. */
export const RETRY_WINDOW_MS = 120_000;

const RETRY_BASE_MS = 750;
const RETRY_FACTOR = 1.6;
const RETRY_MAX_MS = 4000;

/** Set after a successful connect so the next load reconnects by itself. */
const AUTOCONNECT_KEY = 'orbital.autoconnect';

/** `min(750 · 1.6^(tries−1), 4000)` ms after the `tries`-th failure. */
function backoffMs(tries: number): number {
  return Math.min(RETRY_BASE_MS * RETRY_FACTOR ** (tries - 1), RETRY_MAX_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Null outside a browser (the vitest node environment). */
function storage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    // Safari in private mode throws on access rather than returning null.
    return null;
  }
}

/** True when a previous session connected successfully and never disconnected. */
export function autoconnectEnabled(): boolean {
  try {
    return storage()?.getItem(AUTOCONNECT_KEY) === '1';
  } catch {
    return false;
  }
}

function setAutoconnect(on: boolean): void {
  try {
    const s = storage();
    if (!s) return;
    if (on) s.setItem(AUTOCONNECT_KEY, '1');
    else s.removeItem(AUTOCONNECT_KEY);
  } catch {
    // Quota or private mode: auto-connect is a convenience, not state we own.
  }
}

/** The HTTP status an error carries, from a structured field or its message. */
function statusOf(err: unknown): number | null {
  const candidate = err as { status?: unknown; response?: { status?: unknown } } | null;
  const direct = candidate?.status ?? candidate?.response?.status;
  if (typeof direct === 'number') return direct;
  const message = err instanceof Error ? err.message : String(err ?? '');
  const match = /\bHTTP (\d{3})\b/.exec(message);
  return match ? Number(match[1]) : null;
}

/**
 * True when the server answered and refused, so retrying cannot help.
 *
 * `session/jupyter.ts` funnels every failure through its `describeError()`
 * and throws a plain `Error`, so the status is recovered from the "(HTTP nnn)"
 * that message embeds (a `ServerConnection.ResponseError` that reaches here
 * unwrapped is read off `.response.status` instead). 401/403 is a bad token;
 * 404 on the kernelspec API means whatever answered is not a Jupyter Server.
 * Everything else — refused connections, DNS failures, 5xx from a proxy in
 * front of a server that is still booting — is worth another try.
 */
export function isHardConnectError(err: unknown): boolean {
  const status = statusOf(err);
  return status === 401 || status === 403 || status === 404;
}

/** Overridable so tests (and, later, a Tauri host) can inject a provider. */
let createProvider: () => SessionProvider = () => new JupyterSessionProvider();

/** Test seam. Pass nothing to restore the real Jupyter provider. */
export function setProviderFactory(factory?: () => SessionProvider): void {
  createProvider = factory ?? (() => new JupyterSessionProvider());
}

/**
 * Bumped by every `connect()` and every `cancelConnect()`. A retry loop writes
 * state only while its own generation is still current, so a cancelled loop
 * can never resurrect itself when a parked `provider.connect()` finally
 * settles.
 */
let generation = 0;

export const useSessionStore = create<SessionState>((set, get) => ({
  config: DEFAULT_CONFIG,
  connection: 'disconnected',
  error: null,
  kernelStatus: 'disconnected',
  kernelName: null,
  provider: null,
  attempt: null,

  setConfig: (cfg) => set({ config: cfg }),

  connect: async () => {
    // Supersede any loop already running; it will see the bump and stop.
    const gen = ++generation;
    const { config, provider: existing } = get();
    if (existing) {
      try {
        await existing.disconnect();
      } catch {
        /* replacing it anyway */
      }
      if (gen !== generation) return;
    }

    const startedAt = Date.now();
    set({
      connection: 'connecting',
      error: null,
      provider: null,
      kernelStatus: 'disconnected',
      kernelName: null,
      attempt: { startedAt, tries: 1, lastError: null },
    });

    const provider = createProvider();
    let tries = 1;

    for (;;) {
      try {
        await provider.connect(config);
        if (gen !== generation) {
          // Cancelled (or superseded) while this attempt was in flight.
          void provider.disconnect().catch(() => undefined);
          return;
        }
        set({ connection: 'connected', error: null, provider, attempt: null });
        setAutoconnect(true);
        return;
      } catch (err) {
        if (gen !== generation) return;

        const message = err instanceof Error ? err.message : String(err);
        if (isHardConnectError(err)) {
          set({ connection: 'error', error: message, provider: null, attempt: null });
          return;
        }

        const wait = backoffMs(tries);
        if (Date.now() - startedAt + wait >= RETRY_WINDOW_MS) {
          set({
            connection: 'error',
            error: `Jupyter did not answer at ${config.baseUrl} for ${Math.round(
              RETRY_WINDOW_MS / 1000,
            )} s`,
            provider: null,
            attempt: null,
          });
          return;
        }

        tries += 1;
        set({ attempt: { startedAt, tries, lastError: message } });
        await sleep(wait);
        if (gen !== generation) return;
      }
    }
  },

  cancelConnect: () => {
    if (get().connection !== 'connecting') return;
    generation += 1;
    set({
      connection: 'disconnected',
      error: null,
      provider: null,
      kernelStatus: 'disconnected',
      kernelName: null,
      attempt: null,
    });
  },

  disconnect: async () => {
    generation += 1;
    const provider = get().provider;
    let message: string | null = null;
    if (provider) {
      try {
        await provider.disconnect();
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
    }
    setAutoconnect(false);
    set({
      connection: 'disconnected',
      error: message,
      provider: null,
      kernelStatus: 'disconnected',
      kernelName: null,
      attempt: null,
    });
  },

  setKernelStatus: (status, kernelName) =>
    set((s) => ({
      kernelStatus: status,
      kernelName: kernelName === undefined ? s.kernelName : kernelName,
    })),
}));

/**
 * What to tell the user when an action needs a server that is not there yet.
 * Every store that used to hardcode 'Not connected' reports this instead, so
 * a slow boot reads as "still connecting" rather than a flat refusal.
 */
export function connectionMessage(): string {
  const { connection, error } = useSessionStore.getState();
  if (connection === 'connecting') return 'Connecting to Jupyter…';
  if (connection === 'error') return error ?? 'Not connected';
  return 'Not connected';
}

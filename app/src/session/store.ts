/**
 * Session store. The exported API below is a contract used by the shell
 * (kernel status, connect button) and the notebook (provider access).
 *
 * Store actions never throw; failures land in `connection: 'error'` + `error`.
 */
import { create } from 'zustand';
import type { KernelStatus, ServerConfig, SessionProvider } from './types';
import { JupyterSessionProvider } from './jupyter';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface SessionState {
  config: ServerConfig;
  connection: ConnectionState;
  error: string | null;
  /** Status of the kernel behind the currently open notebook, if any. */
  kernelStatus: KernelStatus;
  kernelName: string | null;
  provider: SessionProvider | null;

  setConfig(cfg: ServerConfig): void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Called by the notebook store when it opens/closes a kernel session. */
  setKernelStatus(status: KernelStatus, kernelName?: string | null): void;
}

const DEFAULT_CONFIG: ServerConfig = {
  baseUrl: 'http://localhost:8888',
  token: 'orbital-dev',
};

/** Overridable so tests (and, later, a Tauri host) can inject a provider. */
let createProvider: () => SessionProvider = () => new JupyterSessionProvider();

/** Test seam. Pass nothing to restore the real Jupyter provider. */
export function setProviderFactory(factory?: () => SessionProvider): void {
  createProvider = factory ?? (() => new JupyterSessionProvider());
}

export const useSessionStore = create<SessionState>((set, get) => ({
  config: DEFAULT_CONFIG,
  connection: 'disconnected',
  error: null,
  kernelStatus: 'disconnected',
  kernelName: null,
  provider: null,

  setConfig: (cfg) => set({ config: cfg }),

  connect: async () => {
    const { config, provider: existing } = get();
    if (existing) {
      try {
        await existing.disconnect();
      } catch {
        /* replacing it anyway */
      }
    }
    set({
      connection: 'connecting',
      error: null,
      provider: null,
      kernelStatus: 'disconnected',
      kernelName: null,
    });
    const provider = createProvider();
    try {
      await provider.connect(config);
      set({ connection: 'connected', error: null, provider });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ connection: 'error', error: message, provider: null });
    }
  },

  disconnect: async () => {
    const provider = get().provider;
    let message: string | null = null;
    if (provider) {
      try {
        await provider.disconnect();
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
    }
    set({
      connection: 'disconnected',
      error: message,
      provider: null,
      kernelStatus: 'disconnected',
      kernelName: null,
    });
  },

  setKernelStatus: (status, kernelName) =>
    set((s) => ({
      kernelStatus: status,
      kernelName: kernelName === undefined ? s.kernelName : kernelName,
    })),
}));

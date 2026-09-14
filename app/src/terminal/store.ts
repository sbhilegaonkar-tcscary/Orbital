/**
 * Terminal store. `TerminalEntry[]` (name/title only) and per-name status
 * live in zustand; the live `TerminalConnection`, xterm `Terminal`, and
 * `FitAddon` are not serializable and live in a module-level Map instead —
 * same pattern as `notebook/store.ts`'s kernel session map.
 *
 * `TerminalView` owns creating the xterm instance for a name (it reads the
 * `conn` this store already opened via `getRuntime`, then calls
 * `attachXterm` once its `Terminal`/`FitAddon` exist) and disposing it; this
 * store never touches xterm directly.
 *
 * The shell's first prompt can start streaming before any `TerminalView` has
 * mounted to receive it (Jupyter's terminal connection starts producing
 * output as soon as it opens, but `create()`/`attach()` resolving, the store
 * update, and React committing a new `TerminalView` all happen after that).
 * So the raw `conn.onData` subscription lives here, wired the moment the
 * connection is made, and every chunk is kept in a small replay buffer.
 * `attachXterm` replays it into whichever xterm instance attaches — this
 * also makes React StrictMode's mount/cleanup/mount dance safe, since the
 * second, real instance replays the same buffer the discarded first one saw.
 */
import { create } from 'zustand';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { TerminalConnection } from '../session/types';
import { useSessionStore } from '../session/store';

export type TerminalStatus = 'connecting' | 'open' | 'closed';

export interface TerminalEntry {
  name: string;
  title: string;
}

export interface TerminalRuntime {
  conn: TerminalConnection;
  term: Terminal | null;
  fit: FitAddon | null;
  /** The currently-attached xterm write sink, or null between mount/unmount. */
  write: ((data: string) => void) | null;
  /** Every chunk received so far, replayed into a newly-attached xterm instance. */
  buffer: string[];
  bufferedChars: number;
}

/** Not serializable; kept out of the zustand state (see file header). */
const runtimes = new Map<string, TerminalRuntime>();

export function getRuntime(name: string): TerminalRuntime | undefined {
  return runtimes.get(name);
}

/** Caps the replay buffer so a long-lived, chatty shell can't grow it forever. */
const MAX_BUFFERED_CHARS = 200_000;

function pushBuffer(runtime: TerminalRuntime, chunk: string): void {
  runtime.buffer.push(chunk);
  runtime.bufferedChars += chunk.length;
  while (runtime.bufferedChars > MAX_BUFFERED_CHARS && runtime.buffer.length > 1) {
    runtime.bufferedChars -= runtime.buffer.shift()!.length;
  }
}

/**
 * Called by `TerminalView` once its xterm instance and fit addon exist.
 * Replays everything buffered so far into `onData`, then routes further live
 * chunks to it until `detachXterm` runs.
 */
export function attachXterm(name: string, term: Terminal, fit: FitAddon, onData: (data: string) => void): void {
  const runtime = runtimes.get(name);
  if (!runtime) return;
  runtime.term = term;
  runtime.fit = fit;
  runtime.write = onData;
  for (const chunk of runtime.buffer) onData(chunk);
}

/** Called from `TerminalView`'s cleanup; a no-op if a newer view has since attached. */
export function detachXterm(name: string, onData: (data: string) => void): void {
  const runtime = runtimes.get(name);
  if (runtime && runtime.write === onData) runtime.write = null;
}

interface TerminalState {
  terminals: TerminalEntry[];
  active: string | null;
  status: Record<string, TerminalStatus>;

  create(): Promise<void>;
  attach(name: string): Promise<void>;
  /** Shuts the server-side shell down and removes the tab locally. */
  close(name: string): Promise<void>;
  activate(name: string): void;
  rename(name: string, title: string): void;
  /** Lists running terminals and adds any not already known as detached tabs. */
  refresh(): Promise<void>;
  /** TerminalView calls this once, on the first data byte from the shell. */
  markOpen(name: string): void;
  /** Drops a name from local state without touching the server. */
  removeLocal(name: string): void;
}

function requireTerminalsApi() {
  const provider = useSessionStore.getState().provider;
  if (!provider) throw new Error('Not connected to a session.');
  return provider.terminals;
}

let anonCounter = 0;

/**
 * `onClose` fires both when the server closes the terminal and when we call
 * `disconnect()` locally, so tearing down here covers both cases: dispose
 * the xterm instance, drop the runtime entry, and drop the tab. `DELETE`
 * returns before the name disappears from `list()`, so this local removal
 * is the only thing the UI trusts — `refresh()` never removes entries.
 */
function onConnectionClosed(name: string): void {
  // The xterm instance itself (if one was ever created) is disposed by
  // TerminalView's own cleanup effect when this removal un-mounts it —
  // disposing it here too would double-dispose the same instance, since
  // that cleanup always runs right after this local state change.
  runtimes.delete(name);
  useTerminalStore.getState().removeLocal(name);
}

function wireConnection(name: string, conn: TerminalConnection): void {
  conn.onData((data) => {
    const runtime = runtimes.get(name);
    if (!runtime) return;
    pushBuffer(runtime, data);
    runtime.write?.(data);
  });
  conn.onClose(() => onConnectionClosed(name));
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  terminals: [],
  active: null,
  status: {},

  create: async () => {
    const api = requireTerminalsApi();
    const conn = await api.start();
    const name = conn.name;
    runtimes.set(name, { conn, term: null, fit: null, write: null, buffer: [], bufferedChars: 0 });
    wireConnection(name, conn);
    anonCounter += 1;
    const title = `Terminal ${anonCounter}`;
    set((s) => ({
      terminals: [...s.terminals, { name, title }],
      active: name,
      status: { ...s.status, [name]: 'connecting' },
    }));
  },

  attach: async (name: string) => {
    if (runtimes.has(name)) {
      set({ active: name });
      return;
    }
    const api = requireTerminalsApi();
    const conn = await api.connect(name);
    runtimes.set(name, { conn, term: null, fit: null, write: null, buffer: [], bufferedChars: 0 });
    wireConnection(name, conn);
    set((s) => ({
      terminals: s.terminals.some((t) => t.name === name) ? s.terminals : [...s.terminals, { name, title: name }],
      active: name,
      status: { ...s.status, [name]: 'connecting' },
    }));
  },

  close: async (name: string) => {
    const runtime = runtimes.get(name);
    if (runtime) {
      // Triggers onClose synchronously, which disposes the term and removes
      // the tab; `conn` stays usable afterwards to actually kill the shell.
      runtime.conn.disconnect();
      try {
        await runtime.conn.shutdown();
      } catch {
        /* best-effort: the shell may already be gone server-side */
      }
    } else {
      get().removeLocal(name);
      try {
        const api = requireTerminalsApi();
        const conn = await api.connect(name);
        await conn.shutdown();
      } catch {
        /* best-effort: closing a detached entry that never connected */
      }
    }
  },

  activate: (name: string) => set({ active: name }),

  rename: (name: string, title: string) =>
    set((s) => ({
      terminals: s.terminals.map((t) => (t.name === name ? { ...t, title } : t)),
    })),

  refresh: async () => {
    const api = requireTerminalsApi();
    const names = await api.list();
    const known = new Set(get().terminals.map((t) => t.name));
    const discovered = names.filter((name) => !known.has(name));
    if (discovered.length === 0) return;
    set((s) => ({
      terminals: [...s.terminals, ...discovered.map((name) => ({ name, title: name }))],
    }));
  },

  markOpen: (name: string) =>
    set((s) => (s.status[name] === 'open' ? s : { status: { ...s.status, [name]: 'open' } })),

  removeLocal: (name: string) =>
    set((s) => {
      if (!s.terminals.some((t) => t.name === name) && !(name in s.status) && s.active !== name) return s;
      const terminals = s.terminals.filter((t) => t.name !== name);
      const status = { ...s.status };
      delete status[name];
      const active = s.active === name ? (terminals.length > 0 ? terminals[terminals.length - 1].name : null) : s.active;
      return { terminals, status, active };
    }),
}));

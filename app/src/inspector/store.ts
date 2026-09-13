/**
 * Variable inspector store. `refresh` runs `INSPECT_SNIPPET` silently on a
 * kernel session and parses the result into `variables`. Overlapping
 * refreshes coalesce: a refresh requested while one is already running does
 * not start a second one in parallel, it schedules exactly one follow-up
 * (using the most recently requested session) that runs after the current
 * one finishes.
 */
import { create } from 'zustand';
import type { KernelSession } from '../session/types';
import { INSPECT_SNIPPET } from './snippet';
import { parseInspectOutput, type Variable } from './parse';

export interface InspectorState {
  variables: Variable[];
  refreshing: boolean;
  error: string | null;
  filter: string;
  setFilter(filter: string): void;
  refresh(session: KernelSession): Promise<void>;
}

/** Coalescing state for `refresh`, kept outside zustand: it is call-scoped, not UI state. */
let inFlight: Promise<void> | null = null;
let queuedSession: KernelSession | null = null;

/**
 * The most recent `getSession` passed to `wireInspector`. Lives outside
 * zustand for the same reason `notebook/store.ts` keeps its KernelSession out
 * of state: it is not serializable, subscribable store state. Lets the panel
 * trigger a manual refresh without importing `notebook/store` directly.
 */
let wiredGetSession: (() => KernelSession | null) | null = null;

export const useInspectorStore = create<InspectorState>((set) => ({
  variables: [],
  refreshing: false,
  error: null,
  filter: '',

  setFilter: (filter) => set({ filter }),

  refresh: (session) => {
    if (inFlight) {
      queuedSession = session;
      return inFlight;
    }

    const runOnce = async (activeSession: KernelSession): Promise<void> => {
      set({ refreshing: true, error: null });
      try {
        const result = await activeSession.executeSilent(INSPECT_SNIPPET);
        set({ variables: parseInspectOutput(result.outputs), refreshing: false });
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err), refreshing: false });
      }

      if (queuedSession) {
        const next = queuedSession;
        queuedSession = null;
        await runOnce(next);
      }
    };

    const run = runOnce(session).finally(() => {
      inFlight = null;
    });
    inFlight = run;
    return run;
  },
}));

/**
 * Wires the inspector to the notebook's execution lifecycle: whenever an
 * execution on the active notebook settles, re-runs the inspector against
 * that notebook's session. Called once by the app, passing the notebook
 * store's `getActiveSession` / `onExecutionSettled`. Returns an unsubscribe
 * function.
 */
export function wireInspector(
  getSession: () => KernelSession | null,
  onSettled: (cb: (path: string) => void) => () => void,
): () => void {
  wiredGetSession = getSession;
  return onSettled((path) => {
    const session = getSession();
    if (session && session.path === path) {
      void useInspectorStore.getState().refresh(session);
    }
  });
}

/**
 * The session `wireInspector` last wired up, if any. Used by the panel's
 * manual refresh button so it does not need its own import of
 * `notebook/store` (which is a live seam contract, not a dependency of this
 * store).
 */
export function getWiredSession(): KernelSession | null {
  return wiredGetSession ? wiredGetSession() : null;
}

/**
 * Notebook store. The shell reads `notebook` for the statusbar counts and
 * `notebook.path` for the topbar. Everything else is internal to M3.
 */
import { create } from 'zustand';
import type { NotebookModel, Cell } from './model';
import { fromNbformat, toNbformat, newCell } from './model';
import { useSessionStore } from '../session/store';
import type { KernelSession, CellOutput } from '../session/types';

export interface NotebookState {
  notebook: NotebookModel | null;
  selectedCellId: string | null;
  dirty: boolean;
  loading: boolean;
  error: string | null;

  open(path: string): Promise<void>;
  close(): Promise<void>;
  save(): Promise<void>;
  runCell(id: string): Promise<void>;
  runAll(): Promise<void>;
  interrupt(): Promise<void>;
  restartKernel(): Promise<void>;

  /** Edits a cell's source in place and marks the notebook dirty. */
  setSource(id: string, source: string): void;
  /** Inserts a new cell after `afterId` (or at the start when null). Returns the new cell's id. */
  insertCell(afterId: string | null, type: Cell['type']): string;
  deleteCell(id: string): void;
  /** Swaps a cell with its neighbor: -1 moves it up, 1 moves it down. */
  moveCell(id: string, direction: -1 | 1): void;
  setCellType(id: string, type: Cell['type']): void;
  select(id: string | null): void;
  /** Runs a cell and selects the next one, inserting a new code cell if it was last. */
  runAndAdvance(id: string): Promise<void>;
}

/**
 * The live kernel session for the currently open notebook. Lives outside
 * React/zustand state on purpose: `session/` knows nothing about React, and
 * a KernelSession is not serializable, subscribable-store state.
 */
let kernelSession: KernelSession | null = null;
let unsubscribeStatus: (() => void) | null = null;

/** Serializes executions so `runAll` runs cells in order and a later `runCell` waits its turn. */
let executionQueue: Promise<void> = Promise.resolve();

function enqueueExecution(task: () => Promise<void>): Promise<void> {
  const run = executionQueue.then(task, task);
  executionQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function kernelSpecName(nb: NotebookModel): string | undefined {
  const kernelspec = nb.metadata.kernelspec as { name?: string } | undefined;
  return kernelspec?.name;
}

export const useNotebookStore = create<NotebookState>((set, get) => {
  function updateCell(id: string, patch: Partial<Cell>) {
    set((s) => {
      if (!s.notebook) return s;
      return {
        notebook: {
          ...s.notebook,
          cells: s.notebook.cells.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        },
      };
    });
  }

  function appendOutput(id: string, out: CellOutput) {
    set((s) => {
      if (!s.notebook) return s;
      return {
        notebook: {
          ...s.notebook,
          cells: s.notebook.cells.map((c) => {
            if (c.id !== id) return c;
            const outputs = c.outputs.slice();
            const last = outputs[outputs.length - 1];
            if (out.type === 'stream' && last && last.type === 'stream' && last.name === out.name) {
              outputs[outputs.length - 1] = { ...last, text: last.text + out.text };
            } else {
              outputs.push(out);
            }
            return { ...c, outputs };
          }),
        },
      };
    });
  }

  async function runOneCell(id: string): Promise<void> {
    const notebook = get().notebook;
    const cell = notebook?.cells.find((c) => c.id === id);
    if (!notebook || !cell || cell.type !== 'code') return;
    if (!kernelSession) {
      updateCell(id, { state: 'idle' });
      set({ error: 'Not connected' });
      return;
    }
    updateCell(id, { state: 'running', outputs: [] });
    const session = kernelSession;
    await new Promise<void>((resolve) => {
      session.execute(cell.source, {
        onOutput: (out) => appendOutput(id, out),
        onExecutionCount: (n) => updateCell(id, { executionCount: n }),
        onDone: (status) => {
          const state = status === 'ok' ? 'ok' : status === 'error' ? 'error' : 'idle';
          updateCell(id, { state });
          set({ dirty: true });
          resolve();
        },
      });
    });
  }

  return {
    notebook: null,
    selectedCellId: null,
    dirty: false,
    loading: false,
    error: null,

    open: async (path) => {
      const session = useSessionStore.getState();
      if (!session.provider) {
        set({ error: 'Not connected' });
        return;
      }
      set({ loading: true, error: null });
      try {
        const raw = await session.provider.contents.getNotebook(path);
        const nb = fromNbformat(raw, path);
        const newSession = await session.provider.openNotebookSession(path, kernelSpecName(nb));

        unsubscribeStatus?.();
        kernelSession = newSession;
        unsubscribeStatus = newSession.onStatus((status) => {
          useSessionStore.getState().setKernelStatus(status, newSession.kernelName);
        });
        // Push the current status immediately; the subscription only fires on change.
        useSessionStore.getState().setKernelStatus(newSession.status, newSession.kernelName);

        set({
          notebook: nb,
          selectedCellId: nb.cells[0]?.id ?? null,
          loading: false,
          dirty: false,
          error: null,
        });
      } catch (e) {
        set({ loading: false, error: e instanceof Error ? e.message : String(e) });
      }
    },

    close: async () => {
      unsubscribeStatus?.();
      unsubscribeStatus = null;
      const session = kernelSession;
      kernelSession = null;
      if (session) {
        try {
          await session.shutdown();
        } catch {
          // best-effort
        }
      }
      useSessionStore.getState().setKernelStatus('disconnected', null);
      set({ notebook: null, selectedCellId: null, dirty: false, loading: false, error: null });
    },

    save: async () => {
      const { notebook } = get();
      const session = useSessionStore.getState();
      if (!session.provider) {
        set({ error: 'Not connected' });
        return;
      }
      if (!notebook) return;
      await session.provider.contents.saveNotebook(notebook.path, toNbformat(notebook));
      set({ dirty: false });
    },

    runCell: (id) => {
      updateCell(id, { state: 'queued' });
      return enqueueExecution(() => runOneCell(id));
    },

    runAll: async () => {
      const ids = (get().notebook?.cells ?? []).filter((c) => c.type === 'code').map((c) => c.id);
      for (const id of ids) {
        await get().runCell(id);
      }
    },

    interrupt: async () => {
      if (!kernelSession) return;
      await kernelSession.interrupt();
    },

    restartKernel: async () => {
      if (!kernelSession) return;
      await kernelSession.restart();
      set((s) => {
        if (!s.notebook) return s;
        return {
          notebook: {
            ...s.notebook,
            cells: s.notebook.cells.map((c) => ({ ...c, state: 'idle' as const })),
          },
        };
      });
    },

    setSource: (id, source) => {
      updateCell(id, { source });
      set({ dirty: true });
    },

    insertCell: (afterId, type) => {
      const cell = newCell(type);
      set((s) => {
        if (!s.notebook) return s;
        const cells = s.notebook.cells.slice();
        const idx = afterId ? cells.findIndex((c) => c.id === afterId) : -1;
        cells.splice(idx + 1, 0, cell);
        return { notebook: { ...s.notebook, cells }, dirty: true };
      });
      return cell.id;
    },

    deleteCell: (id) => {
      set((s) => {
        if (!s.notebook) return s;
        const idx = s.notebook.cells.findIndex((c) => c.id === id);
        if (idx === -1) return s;
        const cells = s.notebook.cells.slice();
        cells.splice(idx, 1);
        const nextSelected =
          s.selectedCellId === id ? (cells[Math.min(idx, cells.length - 1)]?.id ?? null) : s.selectedCellId;
        return { notebook: { ...s.notebook, cells }, selectedCellId: nextSelected, dirty: true };
      });
    },

    moveCell: (id, direction) => {
      set((s) => {
        if (!s.notebook) return s;
        const cells = s.notebook.cells.slice();
        const idx = cells.findIndex((c) => c.id === id);
        const target = idx + direction;
        if (idx === -1 || target < 0 || target >= cells.length) return s;
        [cells[idx], cells[target]] = [cells[target], cells[idx]];
        return { notebook: { ...s.notebook, cells }, dirty: true };
      });
    },

    setCellType: (id, type) => {
      if (type === 'markdown') {
        updateCell(id, { type, outputs: [], executionCount: null, state: 'idle' });
      } else {
        updateCell(id, { type });
      }
      set({ dirty: true });
    },

    select: (id) => set({ selectedCellId: id }),

    runAndAdvance: async (id) => {
      const notebook = get().notebook;
      if (!notebook) return;
      const idx = notebook.cells.findIndex((c) => c.id === id);
      const run = get().runCell(id);
      if (idx === notebook.cells.length - 1) {
        const newId = get().insertCell(id, 'code');
        set({ selectedCellId: newId });
      } else {
        const nextId = notebook.cells[idx + 1]?.id;
        if (nextId) set({ selectedCellId: nextId });
      }
      await run;
    },
  };
});

/**
 * Notebook store. Holds every open notebook keyed by path; the shell reads the
 * active one through `useActiveNotebook()` and never touches `docs` by hand.
 *
 * Kernel sessions live in a module-level Map beside the store, not in state:
 * they are not serializable and `session/` knows nothing about React. The
 * session store's `kernelStatus` mirrors the *active* document's session.
 */
import { create } from 'zustand';
import type { NotebookModel, Cell } from './model';
import { fromNbformat, toNbformat, newCell, cryptoId } from './model';
import { useSessionStore } from '../session/store';
import type { KernelSession, KernelSpecInfo, CellOutput } from '../session/types';

export interface NotebookState {
  docs: Record<string, NotebookModel>;
  dirty: Record<string, boolean>;
  /** Tab order. */
  openPaths: string[];
  activePath: string | null;
  /** Within the active doc. */
  selectedCellId: string | null;
  loading: boolean;
  error: string | null;
  clipboard: Cell[] | null;
  lastDeleted: { path: string; index: number; cell: Cell } | null;
  kernelSpecs: KernelSpecInfo[];

  // documents
  /** Opens the notebook, or just activates it when it is already open. */
  open(path: string): Promise<void>;
  activate(path: string): void;
  /** Default: the active doc. Shuts its kernel down and closes the tab. */
  close(path?: string): Promise<void>;
  save(path?: string): Promise<void>;
  saveAll(): Promise<void>;

  // execution (active doc)
  runCell(id: string): Promise<void>;
  runAndAdvance(id: string): Promise<void>;
  runAll(): Promise<void>;
  /** Cells before `id`, exclusive. */
  runAbove(id: string): Promise<void>;
  /** `id` and everything after it. */
  runBelow(id: string): Promise<void>;
  interrupt(): Promise<void>;
  restartKernel(): Promise<void>;
  restartAndRunAll(): Promise<void>;
  changeKernel(kernelName: string): Promise<void>;
  refreshKernelSpecs(): Promise<void>;

  // editing (active doc)
  setSource(id: string, source: string): void;
  insertCell(afterId: string | null, type: Cell['type'], source?: string): string;
  /** Records `lastDeleted` so `undoDelete()` can put it back. */
  deleteCell(id: string): void;
  undoDelete(): void;
  /** -1 moves the cell up, 1 moves it down. */
  moveCell(id: string, direction: -1 | 1): void;
  setCellType(id: string, type: Cell['type']): void;
  select(id: string | null): void;
  cutCells(ids: string[]): void;
  copyCells(ids: string[]): void;
  pasteCells(afterId: string | null): void;
  mergeWithBelow(id: string): void;
  splitCell(id: string, offset: number): void;
  /** Default: every cell in the active doc. */
  clearOutputs(id?: string): void;
  /** Flips `metadata.collapsed` (nbformat convention). */
  toggleCollapse(id: string): void;
}

/** path -> live kernel session. Never in zustand state. */
const sessions = new Map<string, KernelSession>();
/** path -> teardown for that session's status subscription. */
const statusUnsubs = new Map<string, () => void>();
/** path -> tail of that document's execution chain, so tabs run concurrently. */
const queues = new Map<string, Promise<void>>();
/** path -> last selected cell, so switching tabs restores the selection. */
const lastSelection = new Map<string, string | null>();

const settledListeners = new Set<(path: string) => void>();

/**
 * Fires after every cell execution settles (ok, error or aborted), with the
 * path of the notebook it ran in. The inspector uses this to refresh variables.
 */
export function onExecutionSettled(cb: (path: string) => void): () => void {
  settledListeners.add(cb);
  return () => {
    settledListeners.delete(cb);
  };
}

function notifySettled(path: string): void {
  for (const cb of settledListeners) {
    try {
      cb(path);
    } catch (err) {
      console.error('[orbital/notebook] onExecutionSettled listener threw', err);
    }
  }
}

/** Serializes executions per path: one notebook stays ordered, two do not block. */
function enqueue(path: string, task: () => Promise<void>): Promise<void> {
  const tail = queues.get(path) ?? Promise.resolve();
  const run = tail.then(task, task);
  queues.set(
    path,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

function kernelSpecName(nb: NotebookModel): string | undefined {
  const kernelspec = nb.metadata.kernelspec as { name?: string } | undefined;
  return kernelspec?.name;
}

function cloneCell(cell: Cell, freshId = false): Cell {
  return {
    ...cell,
    id: freshId ? cryptoId() : cell.id,
    outputs: JSON.parse(JSON.stringify(cell.outputs)) as CellOutput[],
    metadata: JSON.parse(JSON.stringify(cell.metadata)) as Record<string, unknown>,
  };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Pushes `path`'s session status into the session store, or clears it. */
function pushStatus(path: string | null): void {
  const session = path ? sessions.get(path) : undefined;
  if (session) useSessionStore.getState().setKernelStatus(session.status, session.kernelName);
  else useSessionStore.getState().setKernelStatus('disconnected', null);
}

export const useNotebookStore = create<NotebookState>((set, get) => {
  /** Replaces the cells of one doc and marks it dirty. */
  function editDoc(path: string | null, fn: (cells: Cell[]) => Cell[] | null): void {
    if (!path) return;
    set((s) => {
      const doc = s.docs[path];
      if (!doc) return s;
      const cells = fn(doc.cells);
      if (!cells) return s;
      return {
        docs: { ...s.docs, [path]: { ...doc, cells } },
        dirty: { ...s.dirty, [path]: true },
      };
    });
  }

  /** Cell patch that does NOT mark the doc dirty (execution state, outputs). */
  function patchCell(path: string, id: string, patch: Partial<Cell>): void {
    set((s) => {
      const doc = s.docs[path];
      if (!doc) return s;
      return {
        docs: {
          ...s.docs,
          [path]: { ...doc, cells: doc.cells.map((c) => (c.id === id ? { ...c, ...patch } : c)) },
        },
      };
    });
  }

  function appendOutput(path: string, id: string, out: CellOutput): void {
    set((s) => {
      const doc = s.docs[path];
      if (!doc) return s;
      return {
        docs: {
          ...s.docs,
          [path]: {
            ...doc,
            cells: doc.cells.map((c) => {
              if (c.id !== id) return c;
              const outputs = c.outputs.slice();
              const last = outputs[outputs.length - 1];
              // Consecutive same-stream chunks are merged here, not in the provider.
              if (
                out.type === 'stream' &&
                last &&
                last.type === 'stream' &&
                last.name === out.name
              ) {
                outputs[outputs.length - 1] = { ...last, text: last.text + out.text };
              } else {
                outputs.push(out);
              }
              return { ...c, outputs };
            }),
          },
        },
      };
    });
  }

  function markDirty(path: string): void {
    set((s) => (s.dirty[path] ? s : { dirty: { ...s.dirty, [path]: true } }));
  }

  async function runOneCell(path: string, id: string): Promise<void> {
    const cell = get().docs[path]?.cells.find((c) => c.id === id);
    if (!cell || cell.type !== 'code') return;

    const session = sessions.get(path);
    if (!session) {
      patchCell(path, id, { state: 'idle' });
      set({ error: 'Not connected' });
      return;
    }

    patchCell(path, id, { state: 'running', outputs: [] });
    await new Promise<void>((resolve) => {
      session.execute(cell.source, {
        onOutput: (out) => appendOutput(path, id, out),
        onExecutionCount: (n) => patchCell(path, id, { executionCount: n }),
        onDone: (status) => {
          patchCell(path, id, {
            state: status === 'ok' ? 'ok' : status === 'error' ? 'error' : 'idle',
          });
          markDirty(path);
          notifySettled(path);
          resolve();
        },
      });
    });
  }

  /** Runs a list of ids in the active doc, in order, honouring the queue. */
  async function runIds(ids: string[]): Promise<void> {
    for (const id of ids) await get().runCell(id);
  }

  function codeIds(filter?: (cells: Cell[]) => Cell[]): string[] {
    const path = get().activePath;
    const doc = path ? get().docs[path] : null;
    if (!doc) return [];
    const cells = filter ? filter(doc.cells) : doc.cells;
    return cells.filter((c) => c.type === 'code').map((c) => c.id);
  }

  return {
    docs: {},
    dirty: {},
    openPaths: [],
    activePath: null,
    selectedCellId: null,
    loading: false,
    error: null,
    clipboard: null,
    lastDeleted: null,
    kernelSpecs: [],

    open: async (path) => {
      if (get().docs[path]) {
        get().activate(path);
        return;
      }
      const provider = useSessionStore.getState().provider;
      if (!provider) {
        set({ error: 'Not connected' });
        return;
      }
      set({ loading: true, error: null });
      try {
        const raw = await provider.contents.getNotebook(path);
        const nb = fromNbformat(raw, path);
        const session = await provider.openNotebookSession(path, kernelSpecName(nb));

        statusUnsubs.get(path)?.();
        sessions.set(path, session);
        statusUnsubs.set(
          path,
          session.onStatus((status) => {
            // Only the active tab's kernel drives the shell's status readout.
            if (useNotebookStore.getState().activePath !== path) return;
            useSessionStore.getState().setKernelStatus(status, session.kernelName);
          }),
        );

        set((s) => ({
          docs: { ...s.docs, [path]: nb },
          dirty: { ...s.dirty, [path]: false },
          openPaths: s.openPaths.includes(path) ? s.openPaths : [...s.openPaths, path],
          loading: false,
          error: null,
        }));
        get().activate(path);
      } catch (e) {
        set({ loading: false, error: errorMessage(e) });
      }
    },

    activate: (path) => {
      const doc = get().docs[path];
      if (!doc) return;
      const previous = get().activePath;
      if (previous) lastSelection.set(previous, get().selectedCellId);

      const remembered = lastSelection.get(path);
      const selected =
        remembered && doc.cells.some((c) => c.id === remembered)
          ? remembered
          : (doc.cells[0]?.id ?? null);

      set({ activePath: path, selectedCellId: selected });
      // The subscription only fires on change, so re-push what it has now.
      pushStatus(path);
    },

    close: async (path) => {
      const target = path ?? get().activePath;
      if (!target) return;

      statusUnsubs.get(target)?.();
      statusUnsubs.delete(target);
      const session = sessions.get(target);
      sessions.delete(target);
      queues.delete(target);
      lastSelection.delete(target);

      const openPaths = get().openPaths;
      const idx = openPaths.indexOf(target);
      const remaining = openPaths.filter((p) => p !== target);
      const wasActive = get().activePath === target;
      const next = wasActive
        ? (remaining[Math.min(Math.max(idx, 0), remaining.length - 1)] ?? null)
        : get().activePath;

      set((s) => {
        const docs = { ...s.docs };
        const dirty = { ...s.dirty };
        delete docs[target];
        delete dirty[target];
        return {
          docs,
          dirty,
          openPaths: remaining,
          activePath: wasActive ? null : s.activePath,
          selectedCellId: wasActive ? null : s.selectedCellId,
          lastDeleted: s.lastDeleted?.path === target ? null : s.lastDeleted,
        };
      });

      if (next) get().activate(next);
      else if (wasActive) pushStatus(null);

      if (session) {
        try {
          await session.shutdown();
        } catch {
          // Best-effort: the tab is already gone either way.
        }
      }
    },

    save: async (path) => {
      const target = path ?? get().activePath;
      if (!target) return;
      const doc = get().docs[target];
      if (!doc) return;
      const provider = useSessionStore.getState().provider;
      if (!provider) {
        set({ error: 'Not connected' });
        return;
      }
      await provider.contents.saveNotebook(target, toNbformat(doc));
      set((s) => ({ dirty: { ...s.dirty, [target]: false } }));
    },

    saveAll: async () => {
      for (const path of get().openPaths) {
        if (get().dirty[path]) await get().save(path);
      }
    },

    runCell: (id) => {
      const path = get().activePath;
      if (!path) return Promise.resolve();
      const cell = get().docs[path]?.cells.find((c) => c.id === id);
      if (!cell || cell.type !== 'code') return Promise.resolve();
      patchCell(path, id, { state: 'queued' });
      return enqueue(path, () => runOneCell(path, id));
    },

    runAndAdvance: async (id) => {
      const path = get().activePath;
      const doc = path ? get().docs[path] : null;
      if (!doc) return;
      const idx = doc.cells.findIndex((c) => c.id === id);
      const run = get().runCell(id);
      if (idx === doc.cells.length - 1) {
        set({ selectedCellId: get().insertCell(id, 'code') });
      } else {
        const nextId = doc.cells[idx + 1]?.id;
        if (nextId) set({ selectedCellId: nextId });
      }
      await run;
    },

    runAll: () => runIds(codeIds()),

    runAbove: (id) =>
      runIds(
        codeIds((cells) => {
          const idx = cells.findIndex((c) => c.id === id);
          return idx <= 0 ? [] : cells.slice(0, idx);
        }),
      ),

    runBelow: (id) =>
      runIds(
        codeIds((cells) => {
          const idx = cells.findIndex((c) => c.id === id);
          return idx === -1 ? [] : cells.slice(idx);
        }),
      ),

    interrupt: async () => {
      await getActiveSession()?.interrupt();
    },

    restartKernel: async () => {
      const path = get().activePath;
      const session = path ? sessions.get(path) : null;
      if (!path || !session) return;
      await session.restart();
      set((s) => {
        const doc = s.docs[path];
        if (!doc) return s;
        return {
          docs: {
            ...s.docs,
            [path]: { ...doc, cells: doc.cells.map((c) => ({ ...c, state: 'idle' as const })) },
          },
        };
      });
    },

    restartAndRunAll: async () => {
      await get().restartKernel();
      await get().runAll();
    },

    changeKernel: async (kernelName) => {
      const path = get().activePath;
      const session = path ? sessions.get(path) : null;
      if (!path || !session) return;
      await session.changeKernel(kernelName);
      // Keep the doc's nbformat kernelspec metadata in sync when the picker
      // has the spec's display name/language; falls back to leaving it
      // untouched if `kernelSpecs` has not been refreshed yet.
      const spec = get().kernelSpecs.find((k) => k.name === kernelName);
      if (spec) {
        set((s) => {
          const doc = s.docs[path];
          if (!doc) return s;
          return {
            docs: {
              ...s.docs,
              [path]: {
                ...doc,
                metadata: {
                  ...doc.metadata,
                  kernelspec: { name: spec.name, display_name: spec.displayName, language: spec.language },
                },
              },
            },
            dirty: { ...s.dirty, [path]: true },
          };
        });
      }
      pushStatus(path);
    },

    refreshKernelSpecs: async () => {
      const provider = useSessionStore.getState().provider;
      if (!provider) return;
      try {
        set({ kernelSpecs: await provider.listKernelSpecs() });
      } catch (e) {
        set({ error: errorMessage(e) });
      }
    },

    setSource: (id, source) => {
      editDoc(get().activePath, (cells) =>
        cells.map((c) => (c.id === id ? { ...c, source } : c)),
      );
    },

    insertCell: (afterId, type, source) => {
      const cell = newCell(type, source ?? '');
      editDoc(get().activePath, (cells) => {
        const next = cells.slice();
        const idx = afterId ? next.findIndex((c) => c.id === afterId) : -1;
        next.splice(idx + 1, 0, cell);
        return next;
      });
      return cell.id;
    },

    deleteCell: (id) => {
      const path = get().activePath;
      if (!path) return;
      const cells = get().docs[path]?.cells;
      const idx = cells?.findIndex((c) => c.id === id) ?? -1;
      if (!cells || idx === -1) return;

      const removed = cloneCell(cells[idx]);
      editDoc(path, (current) => {
        const next = current.slice();
        next.splice(idx, 1);
        return next;
      });
      set((s) => ({
        lastDeleted: { path, index: idx, cell: removed },
        selectedCellId:
          s.selectedCellId === id
            ? (s.docs[path]?.cells[Math.min(idx, (s.docs[path]?.cells.length ?? 1) - 1)]?.id ?? null)
            : s.selectedCellId,
      }));
    },

    undoDelete: () => {
      const record = get().lastDeleted;
      if (!record) return;
      const doc = get().docs[record.path];
      if (!doc) {
        set({ lastDeleted: null });
        return;
      }
      const at = Math.min(record.index, doc.cells.length);
      editDoc(record.path, (cells) => {
        const next = cells.slice();
        next.splice(at, 0, record.cell);
        return next;
      });
      set((s) => ({
        lastDeleted: null,
        selectedCellId: s.activePath === record.path ? record.cell.id : s.selectedCellId,
      }));
    },

    moveCell: (id, direction) => {
      editDoc(get().activePath, (cells) => {
        const next = cells.slice();
        const idx = next.findIndex((c) => c.id === id);
        const target = idx + direction;
        if (idx === -1 || target < 0 || target >= next.length) return null;
        [next[idx], next[target]] = [next[target], next[idx]];
        return next;
      });
    },

    setCellType: (id, type) => {
      editDoc(get().activePath, (cells) =>
        cells.map((c) => {
          if (c.id !== id) return c;
          return type === 'markdown'
            ? { ...c, type, outputs: [], executionCount: null, state: 'idle' as const }
            : { ...c, type };
        }),
      );
    },

    select: (id) => set({ selectedCellId: id }),

    copyCells: (ids) => {
      const path = get().activePath;
      const cells = path ? get().docs[path]?.cells : undefined;
      if (!cells) return;
      const picked = cells.filter((c) => ids.includes(c.id)).map((c) => cloneCell(c));
      if (picked.length) set({ clipboard: picked });
    },

    cutCells: (ids) => {
      const path = get().activePath;
      const cells = path ? get().docs[path]?.cells : undefined;
      if (!path || !cells) return;
      const picked = cells.filter((c) => ids.includes(c.id));
      if (!picked.length) return;

      const firstIndex = cells.findIndex((c) => c.id === picked[0].id);
      const firstClone = cloneCell(picked[0]);
      const removed = new Set(picked.map((c) => c.id));

      set({ clipboard: picked.map((c) => cloneCell(c)) });
      editDoc(path, (current) => current.filter((c) => !removed.has(c.id)));
      set((s) => ({
        // Only the first cut cell is undoable; the clipboard holds the rest.
        lastDeleted: { path, index: firstIndex, cell: firstClone },
        selectedCellId:
          s.selectedCellId && removed.has(s.selectedCellId)
            ? (s.docs[path]?.cells[
                Math.min(firstIndex, (s.docs[path]?.cells.length ?? 1) - 1)
              ]?.id ?? null)
            : s.selectedCellId,
      }));
    },

    pasteCells: (afterId) => {
      const clipboard = get().clipboard;
      const path = get().activePath;
      if (!path || !clipboard?.length) return;
      const copies = clipboard.map((c) => cloneCell(c, true));
      editDoc(path, (cells) => {
        const next = cells.slice();
        const idx = afterId ? next.findIndex((c) => c.id === afterId) : -1;
        next.splice(idx + 1, 0, ...copies);
        return next;
      });
      set({ selectedCellId: copies[copies.length - 1].id });
    },

    mergeWithBelow: (id) => {
      editDoc(get().activePath, (cells) => {
        const idx = cells.findIndex((c) => c.id === id);
        if (idx === -1 || idx === cells.length - 1) return null;
        const upper = cells[idx];
        const lower = cells[idx + 1];
        const next = cells.slice();
        next.splice(idx, 2, {
          ...upper,
          source: `${upper.source}\n${lower.source}`,
          outputs: [],
          executionCount: null,
          state: 'idle',
        });
        return next;
      });
    },

    splitCell: (id, offset) => {
      const path = get().activePath;
      const cells = path ? get().docs[path]?.cells : undefined;
      if (!path || !cells) return;
      const idx = cells.findIndex((c) => c.id === id);
      if (idx === -1) return;

      const cell = cells[idx];
      const cut = Math.max(0, Math.min(offset, cell.source.length));
      const tail = newCell(cell.type, cell.source.slice(cut));

      editDoc(path, (current) => {
        const next = current.slice();
        // Outputs stay with the first half, which keeps its execution count.
        next.splice(idx, 1, { ...cell, source: cell.source.slice(0, cut) }, tail);
        return next;
      });
      set({ selectedCellId: tail.id });
    },

    clearOutputs: (id) => {
      editDoc(get().activePath, (cells) =>
        cells.map((c) =>
          id !== undefined && c.id !== id
            ? c
            : { ...c, outputs: [], executionCount: null, state: 'idle' as const },
        ),
      );
    },

    toggleCollapse: (id) => {
      editDoc(get().activePath, (cells) =>
        cells.map((c) =>
          c.id === id
            ? { ...c, metadata: { ...c.metadata, collapsed: !c.metadata.collapsed } }
            : c,
        ),
      );
    },
  };
});

/** The active document, or null. Consumers never index `docs` themselves. */
export function useActiveNotebook(): NotebookModel | null {
  return useNotebookStore((s) => (s.activePath ? (s.docs[s.activePath] ?? null) : null));
}

/** The active document's kernel session, for the editor's completion/hover. */
export function getActiveSession(): KernelSession | null {
  const path = useNotebookStore.getState().activePath;
  return path ? (sessions.get(path) ?? null) : null;
}

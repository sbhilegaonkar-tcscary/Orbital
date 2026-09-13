/**
 * Notebook store tests. No live server: a fake SessionProvider is injected
 * through `setProviderFactory`, and its fake KernelSession echoes the code
 * back as a stdout stream while bumping its own execution counter.
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import { setProviderFactory, useSessionStore } from '../session/store';
import type {
  CompletionResult,
  ContentsApi,
  ContentsEntry,
  ExecuteHandle,
  ExecuteHandlers,
  InspectResult,
  KernelSession,
  KernelSpecInfo,
  KernelStatus,
  SessionProvider,
  SilentResult,
} from '../session/types';
import { useNotebookStore, getActiveSession, onExecutionSettled } from './store';
import type { NotebookModel } from './model';

const A = 'alpha.ipynb';
const B = 'beta.ipynb';

/** Raw nbformat for a notebook with `n` code cells, sources "a0", "a1", ... */
function rawNotebook(prefix: string, n: number): unknown {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { kernelspec: { name: 'python3', display_name: 'Python 3', language: 'python' } },
    cells: Array.from({ length: n }, (_, i) => ({
      id: `${prefix}${i}`,
      cell_type: 'code',
      source: [`${prefix}${i}`],
      metadata: {},
      execution_count: null,
      outputs: [],
    })),
  };
}

/** Records everything the store asked the session layer to do. */
interface Fake {
  provider: SessionProvider;
  sessions: Map<string, FakeSession>;
  saved: Map<string, unknown>;
  /** While true, `execute()` parks instead of completing. */
  hold: boolean;
  /** Executions currently parked. */
  readonly pendingCount: number;
  /** Completes every parked execution. */
  release(): void;
}

/** Lets the event loop (not just the microtask queue) drain. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

class FakeSession implements KernelSession {
  status: KernelStatus = 'idle';
  kernelName: string;
  shutdownCalls = 0;
  restartCalls = 0;
  interruptCalls = 0;
  changedTo: string[] = [];
  /** Order in which this session actually started executing code. */
  executed: string[] = [];
  private count = 0;
  private listeners = new Set<(s: KernelStatus) => void>();

  constructor(
    readonly path: string,
    kernelName: string,
    private readonly fake: { hold: boolean; pending: (() => void)[] },
  ) {
    this.kernelName = kernelName;
  }

  emit(status: KernelStatus): void {
    this.status = status;
    for (const cb of this.listeners) cb(status);
  }

  onStatus(cb: (s: KernelStatus) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  execute(code: string, handlers: ExecuteHandlers): ExecuteHandle {
    const finish = () => {
      this.executed.push(code);
      this.count += 1;
      handlers.onOutput({ type: 'stream', name: 'stdout', text: code });
      handlers.onExecutionCount(this.count);
      handlers.onDone('ok');
    };
    if (this.fake.hold) this.fake.pending.push(finish);
    else finish();
    return { done: Promise.resolve(), cancel: () => undefined };
  }

  complete(_code: string, cursor: number): Promise<CompletionResult> {
    return Promise.resolve({ cursorStart: cursor, cursorEnd: cursor, items: [] });
  }

  inspect(): Promise<InspectResult> {
    return Promise.resolve({ found: false, data: {} });
  }

  executeSilent(): Promise<SilentResult> {
    return Promise.resolve({ status: 'ok', outputs: [] });
  }

  async interrupt(): Promise<void> {
    this.interruptCalls += 1;
  }

  async restart(): Promise<void> {
    this.restartCalls += 1;
  }

  async changeKernel(kernelName: string): Promise<void> {
    this.changedTo.push(kernelName);
    this.kernelName = kernelName;
  }

  async shutdown(): Promise<void> {
    this.shutdownCalls += 1;
  }
}

function makeFake(): Fake {
  const sessions = new Map<string, FakeSession>();
  const saved = new Map<string, unknown>();
  const gate = { hold: false, pending: [] as (() => void)[] };

  const contents: ContentsApi = {
    list: async (): Promise<ContentsEntry[]> => [],
    getNotebook: async (path: string) => rawNotebook(path === A ? 'a' : 'b', 3),
    saveNotebook: async (path: string, nb: unknown) => {
      saved.set(path, nb);
    },
    createNotebook: async () => A,
  };

  const provider: SessionProvider = {
    connect: async () => undefined,
    disconnect: async () => undefined,
    listKernelSpecs: async (): Promise<KernelSpecInfo[]> => [
      { name: 'python3', displayName: 'Python 3', language: 'python' },
      { name: 'ir', displayName: 'R', language: 'R' },
    ],
    openNotebookSession: async (path: string, kernelName?: string) => {
      const session = new FakeSession(path, kernelName ?? 'python3', gate);
      sessions.set(path, session);
      return session;
    },
    contents,
  };

  return {
    provider,
    sessions,
    saved,
    get hold() {
      return gate.hold;
    },
    set hold(v: boolean) {
      gate.hold = v;
    },
    get pendingCount() {
      return gate.pending.length;
    },
    release: () => {
      const pending = gate.pending.splice(0);
      for (const run of pending) run();
    },
  };
}

let fake: Fake;

function doc(path: string): NotebookModel {
  const found = useNotebookStore.getState().docs[path];
  if (!found) throw new Error(`${path} is not open`);
  return found;
}

function sources(path: string): string[] {
  return doc(path).cells.map((c) => c.source);
}

beforeEach(async () => {
  fake = makeFake();
  setProviderFactory(() => fake.provider);
  await useSessionStore.getState().connect();
  useNotebookStore.setState({
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
  });
});

afterEach(async () => {
  const store = useNotebookStore.getState();
  for (const path of [...store.openPaths]) await store.close(path);
  setProviderFactory();
});

describe('documents', () => {
  it('opens two notebooks and activates between them', async () => {
    await useNotebookStore.getState().open(A);
    await useNotebookStore.getState().open(B);

    const s = useNotebookStore.getState();
    expect(s.openPaths).toEqual([A, B]);
    expect(s.activePath).toBe(B);
    expect(Object.keys(s.docs).sort()).toEqual([A, B]);
    expect(sources(A)).toEqual(['a0', 'a1', 'a2']);
    expect(getActiveSession()).toBe(fake.sessions.get(B));

    useNotebookStore.getState().activate(A);
    expect(useNotebookStore.getState().activePath).toBe(A);
    expect(useNotebookStore.getState().selectedCellId).toBe('a0');
    expect(getActiveSession()).toBe(fake.sessions.get(A));
  });

  it('re-opening an open path only activates it', async () => {
    await useNotebookStore.getState().open(A);
    await useNotebookStore.getState().open(B);
    const sessionA = fake.sessions.get(A);

    await useNotebookStore.getState().open(A);
    expect(useNotebookStore.getState().activePath).toBe(A);
    expect(useNotebookStore.getState().openPaths).toEqual([A, B]);
    expect(fake.sessions.get(A)).toBe(sessionA);
  });

  it('restores each tab’s selection and re-pushes its kernel status', async () => {
    await useNotebookStore.getState().open(A);
    useNotebookStore.getState().select('a2');
    await useNotebookStore.getState().open(B);

    fake.sessions.get(A)!.status = 'busy';
    fake.sessions.get(B)!.status = 'idle';

    useNotebookStore.getState().activate(A);
    expect(useNotebookStore.getState().selectedCellId).toBe('a2');
    expect(useSessionStore.getState().kernelStatus).toBe('busy');

    useNotebookStore.getState().activate(B);
    expect(useSessionStore.getState().kernelStatus).toBe('idle');
  });

  it('only the active session drives the shell status', async () => {
    await useNotebookStore.getState().open(A);
    await useNotebookStore.getState().open(B);

    fake.sessions.get(A)!.emit('dead');
    expect(useSessionStore.getState().kernelStatus).toBe('idle');

    fake.sessions.get(B)!.emit('busy');
    expect(useSessionStore.getState().kernelStatus).toBe('busy');
  });

  it('close shuts the kernel down and activates the neighbour', async () => {
    await useNotebookStore.getState().open(A);
    await useNotebookStore.getState().open(B);
    const sessionB = fake.sessions.get(B)!;

    await useNotebookStore.getState().close();

    const s = useNotebookStore.getState();
    expect(sessionB.shutdownCalls).toBe(1);
    expect(s.openPaths).toEqual([A]);
    expect(s.activePath).toBe(A);
    expect(s.docs[B]).toBeUndefined();
    expect(getActiveSession()).toBe(fake.sessions.get(A));

    await useNotebookStore.getState().close();
    expect(useNotebookStore.getState().activePath).toBeNull();
    expect(useNotebookStore.getState().openPaths).toEqual([]);
    expect(useSessionStore.getState().kernelStatus).toBe('disconnected');
  });

  it('saves the active doc and clears only its dirty flag', async () => {
    await useNotebookStore.getState().open(A);
    await useNotebookStore.getState().open(B);
    useNotebookStore.getState().setSource('b0', 'changed');
    useNotebookStore.getState().activate(A);
    useNotebookStore.getState().setSource('a0', 'also changed');

    await useNotebookStore.getState().save();
    expect(useNotebookStore.getState().dirty[A]).toBe(false);
    expect(useNotebookStore.getState().dirty[B]).toBe(true);
    expect(fake.saved.has(A)).toBe(true);

    await useNotebookStore.getState().saveAll();
    expect(useNotebookStore.getState().dirty[B]).toBe(false);
    expect(fake.saved.has(B)).toBe(true);
  });

  it('refreshKernelSpecs fills kernelSpecs from the provider', async () => {
    await useNotebookStore.getState().refreshKernelSpecs();
    expect(useNotebookStore.getState().kernelSpecs.map((k) => k.name)).toEqual(['python3', 'ir']);
  });

  it('changeKernel swaps the kernel and re-pushes status', async () => {
    await useNotebookStore.getState().open(A);
    await useNotebookStore.getState().changeKernel('ir');
    expect(fake.sessions.get(A)!.changedTo).toEqual(['ir']);
    expect(useSessionStore.getState().kernelName).toBe('ir');
  });
});

describe('execution', () => {
  it('keeps one notebook ordered while two run concurrently', async () => {
    await useNotebookStore.getState().open(A);
    await useNotebookStore.getState().open(B);

    fake.hold = true;
    useNotebookStore.getState().activate(A);
    const a = [
      useNotebookStore.getState().runCell('a0'),
      useNotebookStore.getState().runCell('a1'),
      useNotebookStore.getState().runCell('a2'),
    ];
    useNotebookStore.getState().activate(B);
    const b = [useNotebookStore.getState().runCell('b0')];

    expect(useNotebookStore.getState().docs[A].cells[1].state).toBe('queued');
    await tick();
    // Two executions in flight at once: the head of each path's queue. B is
    // not stuck behind A's three cells.
    expect(fake.pendingCount).toBe(2);

    fake.hold = false;
    fake.release();
    await Promise.all([...a, ...b]);

    expect(fake.sessions.get(A)!.executed).toEqual(['a0', 'a1', 'a2']);
    expect(fake.sessions.get(B)!.executed).toEqual(['b0']);
  });

  it('records outputs, counts and settle events', async () => {
    await useNotebookStore.getState().open(A);
    const settled: string[] = [];
    const off = onExecutionSettled((p) => settled.push(p));

    await useNotebookStore.getState().runAll();
    off();

    const cells = doc(A).cells;
    expect(cells.map((c) => c.executionCount)).toEqual([1, 2, 3]);
    expect(cells[0].outputs).toEqual([{ type: 'stream', name: 'stdout', text: 'a0' }]);
    expect(cells.every((c) => c.state === 'ok')).toBe(true);
    expect(settled).toEqual([A, A, A]);
  });

  it('runAbove is exclusive and runBelow is inclusive', async () => {
    await useNotebookStore.getState().open(A);
    await useNotebookStore.getState().runAbove('a2');
    expect(fake.sessions.get(A)!.executed).toEqual(['a0', 'a1']);

    await useNotebookStore.getState().runBelow('a1');
    expect(fake.sessions.get(A)!.executed).toEqual(['a0', 'a1', 'a1', 'a2']);
  });

  it('restartAndRunAll restarts once then runs every code cell', async () => {
    await useNotebookStore.getState().open(A);
    await useNotebookStore.getState().restartAndRunAll();
    expect(fake.sessions.get(A)!.restartCalls).toBe(1);
    expect(fake.sessions.get(A)!.executed).toEqual(['a0', 'a1', 'a2']);
  });

  it('clearOutputs resets outputs, count and state', async () => {
    await useNotebookStore.getState().open(A);
    await useNotebookStore.getState().runAll();

    useNotebookStore.getState().clearOutputs('a1');
    expect(doc(A).cells[1].outputs).toEqual([]);
    expect(doc(A).cells[1].executionCount).toBeNull();
    expect(doc(A).cells[1].state).toBe('idle');
    expect(doc(A).cells[0].outputs.length).toBe(1);

    useNotebookStore.getState().clearOutputs();
    expect(doc(A).cells.every((c) => c.outputs.length === 0)).toBe(true);
    expect(doc(A).cells.every((c) => c.executionCount === null)).toBe(true);
  });
});

describe('editing', () => {
  it('cut and paste move cells as deep clones with fresh ids', async () => {
    await useNotebookStore.getState().open(A);
    useNotebookStore.getState().cutCells(['a0', 'a1']);

    expect(sources(A)).toEqual(['a2']);
    expect(useNotebookStore.getState().clipboard?.map((c) => c.source)).toEqual(['a0', 'a1']);

    useNotebookStore.getState().pasteCells('a2');
    const cells = doc(A).cells;
    expect(cells.map((c) => c.source)).toEqual(['a2', 'a0', 'a1']);
    expect(cells[1].id).not.toBe('a0');
    expect(useNotebookStore.getState().selectedCellId).toBe(cells[2].id);

    // Clipboard survives the paste and clones again, not the same objects.
    useNotebookStore.getState().pasteCells(null);
    expect(sources(A)).toEqual(['a0', 'a1', 'a2', 'a0', 'a1']);
    expect(doc(A).cells[0].id).not.toBe(doc(A).cells[3].id);
  });

  it('copy leaves the document alone', async () => {
    await useNotebookStore.getState().open(A);
    useNotebookStore.getState().copyCells(['a1']);
    expect(sources(A)).toEqual(['a0', 'a1', 'a2']);
    expect(useNotebookStore.getState().clipboard?.length).toBe(1);
  });

  it('delete records lastDeleted and undo puts it back at its index', async () => {
    await useNotebookStore.getState().open(A);
    useNotebookStore.getState().deleteCell('a1');
    expect(sources(A)).toEqual(['a0', 'a2']);
    expect(useNotebookStore.getState().lastDeleted?.index).toBe(1);

    useNotebookStore.getState().undoDelete();
    expect(sources(A)).toEqual(['a0', 'a1', 'a2']);
    expect(useNotebookStore.getState().lastDeleted).toBeNull();
    expect(useNotebookStore.getState().selectedCellId).toBe('a1');
  });

  it('undo clamps to the end when the document shrank', async () => {
    await useNotebookStore.getState().open(A);
    useNotebookStore.getState().deleteCell('a2');
    useNotebookStore.getState().deleteCell('a0');
    // lastDeleted is now a0 at index 0; a2's record was replaced.
    useNotebookStore.getState().undoDelete();
    expect(sources(A)).toEqual(['a0', 'a1']);
  });

  it('cut records only the first cell for undo', async () => {
    await useNotebookStore.getState().open(A);
    useNotebookStore.getState().cutCells(['a0', 'a1']);
    expect(useNotebookStore.getState().lastDeleted?.cell.source).toBe('a0');
    useNotebookStore.getState().undoDelete();
    expect(sources(A)).toEqual(['a0', 'a2']);
  });

  it('merge joins with a newline and drops outputs', async () => {
    await useNotebookStore.getState().open(A);
    await useNotebookStore.getState().runAll();
    expect(doc(A).cells[0].outputs.length).toBe(1);

    useNotebookStore.getState().mergeWithBelow('a0');
    const cells = doc(A).cells;
    expect(cells.map((c) => c.source)).toEqual(['a0\na1', 'a2']);
    expect(cells[0].id).toBe('a0');
    expect(cells[0].outputs).toEqual([]);
    expect(cells[0].executionCount).toBeNull();
  });

  it('merge on the last cell is a no-op', async () => {
    await useNotebookStore.getState().open(A);
    useNotebookStore.getState().mergeWithBelow('a2');
    expect(sources(A)).toEqual(['a0', 'a1', 'a2']);
  });

  it('split keeps outputs with the first half and selects the second', async () => {
    await useNotebookStore.getState().open(A);
    useNotebookStore.getState().setSource('a0', 'one\ntwo');
    await useNotebookStore.getState().runCell('a0');

    useNotebookStore.getState().splitCell('a0', 4);
    const cells = doc(A).cells;
    expect(cells.map((c) => c.source)).toEqual(['one\n', 'two', 'a1', 'a2']);
    expect(cells[0].outputs.length).toBe(1);
    expect(cells[1].outputs).toEqual([]);
    expect(cells[1].type).toBe('code');
    expect(useNotebookStore.getState().selectedCellId).toBe(cells[1].id);
  });

  it('insert, move and toggleCollapse edit the active doc only', async () => {
    await useNotebookStore.getState().open(A);
    await useNotebookStore.getState().open(B);

    const id = useNotebookStore.getState().insertCell('b0', 'markdown', '# hi');
    expect(sources(B)).toEqual(['b0', '# hi', 'b1', 'b2']);
    expect(sources(A)).toEqual(['a0', 'a1', 'a2']);

    useNotebookStore.getState().moveCell(id, -1);
    expect(sources(B)).toEqual(['# hi', 'b0', 'b1', 'b2']);

    useNotebookStore.getState().toggleCollapse(id);
    expect(doc(B).cells[0].metadata.collapsed).toBe(true);
    useNotebookStore.getState().toggleCollapse(id);
    expect(doc(B).cells[0].metadata.collapsed).toBe(false);

    expect(useNotebookStore.getState().dirty[B]).toBe(true);
    expect(useNotebookStore.getState().dirty[A]).toBe(false);
  });
});

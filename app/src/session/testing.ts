/**
 * Shared in-memory fakes for the session seam. Test-only, but it lives in
 * `src/` so the fakes are type-checked against `types.ts`: when the seam grows,
 * this file breaks first and every test that uses it keeps compiling.
 *
 * Nothing here talks to a server. Live coverage is in `jupyter.test.ts`.
 */
import type {
  CellOutput,
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
  TerminalConnection,
  TerminalsApi,
} from './types';

/**
 * Parks executions so a test can observe the queue. Shared by every session a
 * fake provider hands out, which is how "two notebooks run concurrently" is
 * measured.
 */
export interface FakeGate {
  /** While true, `execute()` parks instead of completing. */
  hold: boolean;
  /** Executions currently parked, oldest first. */
  pending: (() => void)[];
  /** Completes every parked execution. */
  release(): void;
}

export function makeGate(): FakeGate {
  const gate: FakeGate = {
    hold: false,
    pending: [],
    release: () => {
      for (const run of gate.pending.splice(0)) run();
    },
  };
  return gate;
}

/**
 * Replaces the default echo behaviour of `FakeSession.execute`. Drive the
 * handlers however the test needs; you own calling `onDone`.
 */
export type ExecuteScript = (
  code: string,
  handlers: ExecuteHandlers,
  executionCount: number,
) => void;

/** A KernelSession that records what the store asked it to do. */
export class FakeSession implements KernelSession {
  status: KernelStatus = 'idle';
  kernelName: string;
  shutdownCalls = 0;
  restartCalls = 0;
  interruptCalls = 0;
  changedTo: string[] = [];
  /** Order in which this session actually started executing code. */
  executed: string[] = [];
  /** Set to take over `execute`; otherwise the code is echoed to stdout. */
  script: ExecuteScript | null = null;

  private count = 0;
  private listeners = new Set<(s: KernelStatus) => void>();

  constructor(
    readonly path: string,
    kernelName = 'python3',
    private readonly gate: FakeGate = makeGate(),
  ) {
    this.kernelName = kernelName;
  }

  emit(status: KernelStatus): void {
    this.status = status;
    for (const cb of this.listeners) cb(status);
  }

  onStatus(cb: (s: KernelStatus) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  execute(code: string, handlers: ExecuteHandlers): ExecuteHandle {
    const finish = () => {
      this.executed.push(code);
      this.count += 1;
      if (this.script) {
        this.script(code, handlers, this.count);
        return;
      }
      handlers.onOutput({ type: 'stream', name: 'stdout', text: code });
      handlers.onExecutionCount(this.count);
      handlers.onDone('ok');
    };
    if (this.gate.hold) this.gate.pending.push(finish);
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
    return Promise.resolve({ status: 'ok', outputs: [] as CellOutput[] });
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

export function makeFakeSession(
  path: string,
  kernelName = 'python3',
  gate: FakeGate = makeGate(),
): FakeSession {
  return new FakeSession(path, kernelName, gate);
}

/** A ContentsApi that answers everything with empty/no-op defaults. */
export function makeFakeContents(overrides: Partial<ContentsApi> = {}): ContentsApi {
  return {
    list: async (): Promise<ContentsEntry[]> => [],
    getNotebook: async () => ({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [] }),
    saveNotebook: async () => undefined,
    createNotebook: async (dir: string, name = 'Untitled.ipynb') =>
      dir ? `${dir}/${name}` : name,
    getFile: async () => '',
    saveFile: async () => undefined,
    createFile: async (dir: string, name = 'untitled.txt') => (dir ? `${dir}/${name}` : name),
    createDirectory: async (dir: string, name = 'Untitled Folder') =>
      dir ? `${dir}/${name}` : name,
    rename: async () => undefined,
    delete: async () => undefined,
    upload: async (dir: string, file: File) => (dir ? `${dir}/${file.name}` : file.name),
    ...overrides,
  };
}

/** A TerminalConnection that loops everything sent back as data. */
export function makeFakeTerminal(name = 'fake-1'): TerminalConnection {
  const dataCbs = new Set<(d: string) => void>();
  const closeCbs = new Set<() => void>();
  return {
    name,
    send: (data) => {
      for (const cb of [...dataCbs]) cb(data);
    },
    onData: (cb) => {
      dataCbs.add(cb);
      return () => {
        dataCbs.delete(cb);
      };
    },
    onClose: (cb) => {
      closeCbs.add(cb);
      return () => {
        closeCbs.delete(cb);
      };
    },
    resize: () => undefined,
    disconnect: () => {
      for (const cb of [...closeCbs]) cb();
    },
    shutdown: async () => {
      for (const cb of [...closeCbs]) cb();
    },
  };
}

export function makeFakeTerminals(overrides: Partial<TerminalsApi> = {}): TerminalsApi {
  return {
    list: async () => [],
    start: async () => makeFakeTerminal(),
    connect: async (name: string) => makeFakeTerminal(name),
    ...overrides,
  };
}

/**
 * A SessionProvider with inert defaults. Pass only the pieces a test cares
 * about; `contents` and `terminals` are whole objects, so build them with
 * `makeFakeContents`/`makeFakeTerminals` rather than by hand.
 */
export function makeFakeProvider(overrides: Partial<SessionProvider> = {}): SessionProvider {
  return {
    connect: async () => undefined,
    disconnect: async () => undefined,
    listKernelSpecs: async (): Promise<KernelSpecInfo[]> => [
      { name: 'python3', displayName: 'Python 3', language: 'python' },
    ],
    openNotebookSession: async (path: string, kernelName?: string) =>
      makeFakeSession(path, kernelName),
    contents: makeFakeContents(),
    terminals: makeFakeTerminals(),
    ...overrides,
  };
}

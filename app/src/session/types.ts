/**
 * The session seam. Everything Jupyter-specific lives behind these types.
 * Owned by the orchestrator; do not change shapes without updating
 * docs/ARCHITECTURE.md.
 */

export type KernelStatus =
  | 'disconnected'
  | 'connecting'
  | 'starting'
  | 'idle'
  | 'busy'
  | 'restarting'
  | 'dead';

export interface ServerConfig {
  /** e.g. http://localhost:8888 (no trailing slash) */
  baseUrl: string;
  token: string;
}

export interface KernelSpecInfo {
  name: string;
  displayName: string;
  language: string;
}

export type CellOutput =
  | { type: 'stream'; name: 'stdout' | 'stderr'; text: string }
  | {
      type: 'display_data' | 'execute_result';
      /** mime type -> content. Text mimes are strings; image/png is base64. */
      data: Record<string, string>;
      metadata?: Record<string, unknown>;
      executionCount?: number;
    }
  | { type: 'error'; ename: string; evalue: string; traceback: string[] };

export type ExecutionResult = 'ok' | 'error' | 'aborted';

export interface ExecuteHandlers {
  onOutput(out: CellOutput): void;
  onExecutionCount(n: number): void;
  onDone(status: ExecutionResult): void;
}

export interface ExecuteHandle {
  readonly done: Promise<void>;
  /** Best-effort: interrupts the kernel if this execution is running. */
  cancel(): void;
}

export interface KernelSession {
  readonly path: string;
  readonly status: KernelStatus;
  readonly kernelName: string;
  onStatus(cb: (s: KernelStatus) => void): () => void;
  execute(code: string, handlers: ExecuteHandlers): ExecuteHandle;
  interrupt(): Promise<void>;
  restart(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface ContentsEntry {
  name: string;
  path: string;
  type: 'notebook' | 'directory' | 'file';
  lastModified: string;
}

export interface ContentsApi {
  list(dir: string): Promise<ContentsEntry[]>;
  /** Raw nbformat JSON, untouched. */
  getNotebook(path: string): Promise<unknown>;
  saveNotebook(path: string, nb: unknown): Promise<void>;
  /** Creates an empty notebook; returns its path. */
  createNotebook(dir: string, name?: string): Promise<string>;
}

export interface SessionProvider {
  connect(cfg: ServerConfig): Promise<void>;
  disconnect(): Promise<void>;
  listKernelSpecs(): Promise<KernelSpecInfo[]>;
  openNotebookSession(path: string, kernelName?: string): Promise<KernelSession>;
  readonly contents: ContentsApi;
}

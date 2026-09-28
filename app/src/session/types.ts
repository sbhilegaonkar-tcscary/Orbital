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
      /** From transient.display_id; lets update_display_data replace this output in place. */
      displayId?: string;
    }
  | { type: 'error'; ename: string; evalue: string; traceback: string[] };

export type ExecutionResult = 'ok' | 'error' | 'aborted';

export interface ExecuteHandlers {
  onOutput(out: CellOutput): void;
  onExecutionCount(n: number): void;
  onDone(status: ExecutionResult): void;
  /**
   * clear_output. With wait=false the store clears immediately; with wait=true
   * it clears just before the next output arrives (Jupyter semantics, used by
   * tqdm and friends).
   */
  onClearOutput?(wait: boolean): void;
  /** update_display_data: replace every output with this displayId, in place. */
  onUpdateDisplay?(displayId: string, data: Record<string, string>, metadata?: Record<string, unknown>): void;
}

export interface ExecuteHandle {
  readonly done: Promise<void>;
  /** Best-effort: interrupts the kernel if this execution is running. */
  cancel(): void;
}

export interface CompletionItem {
  label: string;
  /** Jupyter's experimental type hint when present: 'function', 'module', 'keyword', ... */
  type?: string;
}

export interface CompletionResult {
  /** Character offsets into the code that the items replace. */
  cursorStart: number;
  cursorEnd: number;
  items: CompletionItem[];
}

export interface InspectResult {
  found: boolean;
  /** mime -> content; text/plain may contain ANSI escapes. */
  data: Record<string, string>;
}

export interface SilentResult {
  status: ExecutionResult;
  outputs: CellOutput[];
}

export interface KernelSession {
  readonly path: string;
  readonly status: KernelStatus;
  readonly kernelName: string;
  onStatus(cb: (s: KernelStatus) => void): () => void;
  execute(code: string, handlers: ExecuteHandlers): ExecuteHandle;
  /** complete_request at a character offset into `code`. */
  complete(code: string, cursor: number): Promise<CompletionResult>;
  /** inspect_request; detailLevel 0 is the short docstring, 1 includes source. */
  inspect(code: string, cursor: number, detailLevel?: 0 | 1): Promise<InspectResult>;
  /**
   * Runs code with silent=true, store_history=false. Does not bump the
   * execution counter or appear in In/Out. Streams still arrive as outputs.
   */
  executeSilent(code: string): Promise<SilentResult>;
  interrupt(): Promise<void>;
  restart(): Promise<void>;
  /** Swap the kernel behind this session; status events continue on this object. */
  changeKernel(kernelName: string): Promise<void>;
  shutdown(): Promise<void>;
}

export interface ContentsEntry {
  name: string;
  path: string;
  type: 'notebook' | 'directory' | 'file';
  lastModified: string;
  /** Bytes on disk. Undefined for directories, and whenever the server omits it. */
  size?: number;
}

export interface ContentsApi {
  list(dir: string): Promise<ContentsEntry[]>;
  /** Raw nbformat JSON, untouched. */
  getNotebook(path: string): Promise<unknown>;
  saveNotebook(path: string, nb: unknown): Promise<void>;
  /** Creates an empty notebook; returns its path. */
  createNotebook(dir: string, name?: string): Promise<string>;

  // M6 additions
  /** Text of a non-notebook file. Throws for binary files. */
  getFile(path: string): Promise<string>;
  saveFile(path: string, text: string): Promise<void>;
  /** Creates an empty text file; returns its path. */
  createFile(dir: string, name?: string): Promise<string>;
  createDirectory(dir: string, name?: string): Promise<string>;
  rename(path: string, newPath: string): Promise<void>;
  /** Deletes a file or an empty directory. */
  delete(path: string): Promise<void>;
  /** Uploads a browser File into dir; returns the created path. Base64 for binary. */
  upload(dir: string, file: File): Promise<string>;
}

export interface TerminalConnection {
  readonly name: string;
  send(data: string): void;
  onData(cb: (data: string) => void): () => void;
  onClose(cb: () => void): () => void;
  resize(cols: number, rows: number): void;
  /** Closes the websocket; the server-side shell keeps running. */
  disconnect(): void;
  /** Kills the server-side shell. */
  shutdown(): Promise<void>;
}

export interface TerminalsApi {
  list(): Promise<string[]>;
  start(): Promise<TerminalConnection>;
  connect(name: string): Promise<TerminalConnection>;
}

export interface SessionProvider {
  connect(cfg: ServerConfig): Promise<void>;
  disconnect(): Promise<void>;
  listKernelSpecs(): Promise<KernelSpecInfo[]>;
  openNotebookSession(path: string, kernelName?: string): Promise<KernelSession>;
  readonly contents: ContentsApi;
  readonly terminals: TerminalsApi;
}

/**
 * JupyterSessionProvider: the only file in the app that knows about
 * @jupyterlab/services. Everything above it talks to `session/types.ts`.
 *
 * Owned by M2. If you need something else out of Jupyter, add it to the seam
 * in types.ts first (via the orchestrator), then implement it here.
 */
import {
  ContentsManager,
  KernelManager,
  KernelSpecManager,
  ServerConnection,
  SessionManager,
  TerminalManager,
} from '@jupyterlab/services';
import type { Contents, KernelMessage, Session, Terminal } from '@jupyterlab/services';

import type {
  CellOutput,
  CompletionItem,
  CompletionResult,
  ContentsApi,
  ContentsEntry,
  ExecuteHandle,
  ExecuteHandlers,
  ExecutionResult,
  InspectResult,
  KernelSession,
  KernelSpecInfo,
  KernelStatus,
  ServerConfig,
  SessionProvider,
  SilentResult,
  TerminalConnection,
  TerminalsApi,
} from './types';

/**
 * Host overrides. In the browser these are all supplied by the platform; the
 * node test suite passes `ws` and node's global `fetch` through here so the
 * provider itself never has to know which host it runs on.
 */
export interface JupyterProviderOptions {
  WebSocket?: typeof WebSocket;
  fetch?: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
}

interface Live {
  settings: ServerConnection.ISettings;
  kernels: KernelManager;
  sessions: SessionManager;
  specs: KernelSpecManager;
  contents: ContentsManager;
  terminals: TerminalManager;
}

/** http://host/ -> ws://host, https://host/ -> wss://host */
export function deriveWsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.startsWith('https://')) return 'wss://' + trimmed.slice('https://'.length);
  if (trimmed.startsWith('http://')) return 'ws://' + trimmed.slice('http://'.length);
  if (trimmed.startsWith('wss://') || trimmed.startsWith('ws://')) return trimmed;
  // Protocol-relative or bare host: assume plain ws.
  return 'ws://' + trimmed.replace(/^\/\//, '');
}

function mapStatus(status: KernelMessage.Status): KernelStatus {
  switch (status) {
    case 'unknown':
      return 'connecting';
    case 'starting':
      return 'starting';
    case 'idle':
      return 'idle';
    case 'busy':
      return 'busy';
    case 'restarting':
    case 'autorestarting':
      return 'restarting';
    case 'dead':
    case 'terminating':
      return 'dead';
    default:
      return 'connecting';
  }
}

/** Jupyter allows a mime value to be a string or an array of lines. */
function mimeToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((line) => String(line)).join('');
  if (value === null || value === undefined) return '';
  return JSON.stringify(value);
}

function mapMimeBundle(bundle: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(bundle)) out[key] = mimeToString(bundle[key]);
  return out;
}

/**
 * `transient.display_id` off a display_data/update_display_data payload.
 * Undefined when the kernel did not attach one (the common case).
 */
function transientDisplayId(content: unknown): string | undefined {
  const transient = (content as { transient?: { display_id?: unknown } } | null)?.transient;
  const id = transient?.display_id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/**
 * Translate one iopub message into a CellOutput, or null for the message
 * types the notebook does not render (status, execute_input) and for the two
 * that are dispatched to dedicated handlers instead (clear_output,
 * update_display_data). Shared by execute() and executeSilent() so both
 * produce identical shapes.
 */
function iopubToOutput(msg: KernelMessage.IIOPubMessage): CellOutput | null {
  switch (msg.header.msg_type) {
    case 'stream': {
      const content = (msg as KernelMessage.IStreamMsg).content;
      return {
        type: 'stream',
        name: content.name === 'stderr' ? 'stderr' : 'stdout',
        text: mimeToString(content.text),
      };
    }
    case 'display_data': {
      const content = (msg as KernelMessage.IDisplayDataMsg).content;
      const displayId = transientDisplayId(content);
      return {
        type: 'display_data',
        data: mapMimeBundle(content.data as Record<string, unknown>),
        metadata: (content.metadata ?? {}) as Record<string, unknown>,
        ...(displayId ? { displayId } : {}),
      };
    }
    case 'execute_result': {
      const content = (msg as KernelMessage.IExecuteResultMsg).content;
      return {
        type: 'execute_result',
        data: mapMimeBundle(content.data as Record<string, unknown>),
        metadata: (content.metadata ?? {}) as Record<string, unknown>,
        executionCount: content.execution_count ?? undefined,
      };
    }
    case 'error': {
      const content = (msg as KernelMessage.IErrorMsg).content;
      return {
        type: 'error',
        ename: content.ename,
        evalue: content.evalue,
        traceback: content.traceback ?? [],
      };
    }
    default:
      return null;
  }
}

function replyStatus(status: 'ok' | 'error' | 'abort' | string): ExecutionResult {
  if (status === 'ok') return 'ok';
  if (status === 'error') return 'error';
  return 'aborted';
}

/** Handlers come from UI code; a throw there must not break the kernel stream. */
function guard(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error(`[orbital/session] handler "${label}" threw`, err);
  }
}

function basename(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function joinPath(dir: string, name: string): string {
  const d = dir.replace(/^\/+|\/+$/g, '');
  return d ? `${d}/${name}` : name;
}

/** Extensions we upload as text even when the browser reports no MIME type. */
const TEXT_EXTENSIONS = [
  '.py',
  '.md',
  '.txt',
  '.json',
  '.csv',
  '.toml',
  '.yaml',
  '.yml',
  '.ipynb',
  '.js',
  '.ts',
  '.html',
  '.css',
];

function isTextUpload(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  const name = file.name.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/** Browser- and node-safe base64 of an ArrayBuffer (no Buffer, no spread blowup). */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Terminal REST client.
 *
 * JupyterLab's stock client gates every call on `PageConfig`'s
 * `terminalsAvailable` flag, which is injected by JupyterLab's own page
 * template. ORBITAL serves its own HTML, so that flag is always absent and the
 * stock client refuses to start anything. We talk to `/api/terminals`
 * ourselves; a server without terminals answers 404 and the error surfaces
 * normally instead of being pre-empted by a page-config guess.
 */
class OrbitalTerminalAPIClient implements Terminal.ITerminalAPIClient {
  readonly isAvailable = true;

  constructor(readonly serverSettings: ServerConnection.ISettings) {}

  async startNew(options: Terminal.ITerminal.IOptions = {}): Promise<Terminal.IModel> {
    const res = await this.request('', {
      method: 'POST',
      body: JSON.stringify({ name: options.name, cwd: options.cwd }),
    });
    return (await res.json()) as Terminal.IModel;
  }

  async listRunning(): Promise<Terminal.IModel[]> {
    const res = await this.request('', { method: 'GET' });
    const models = (await res.json()) as unknown;
    if (!Array.isArray(models)) {
      throw new Error('Invalid response from the terminals API: expected a list.');
    }
    return models as Terminal.IModel[];
  }

  async shutdown(name: string): Promise<void> {
    await this.request(`/${encodeURIComponent(name)}`, { method: 'DELETE' });
  }

  private async request(suffix: string, init: RequestInit): Promise<Response> {
    const base = this.serverSettings.baseUrl.replace(/\/+$/, '');
    const res = await ServerConnection.makeRequest(
      `${base}/api/terminals${suffix}`,
      init,
      this.serverSettings,
    );
    if (!res.ok) throw await ServerConnection.ResponseError.create(res);
    return res;
  }
}

/**
 * Adapts a JupyterLab terminal connection to the seam's TerminalConnection.
 * `shutdown()` goes through the manager so its running list stays accurate.
 */
function wrapTerminal(
  connection: Terminal.ITerminalConnection,
  manager: TerminalManager,
): TerminalConnection {
  const dataCbs = new Set<(data: string) => void>();
  const closeCbs = new Set<() => void>();
  let closed = false;

  const fireClose = () => {
    if (closed) return;
    closed = true;
    for (const cb of [...closeCbs]) guard('onClose', () => cb());
  };

  const onMessage = (_sender: unknown, msg: Terminal.IMessage) => {
    if (msg.type === 'stdout') {
      const text = (msg.content ?? []).map((part) => String(part)).join('');
      for (const cb of [...dataCbs]) guard('onData', () => cb(text));
    } else if (msg.type === 'disconnect') {
      fireClose();
    }
  };
  const onDisposed = () => fireClose();

  connection.messageReceived.connect(onMessage);
  connection.disposed.connect(onDisposed);

  return {
    name: connection.name,
    send: (data: string) => {
      connection.send({ type: 'stdin', content: [data] });
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
    // The server takes rows first, then cols; the two trailing zeros are the
    // pixel dimensions, which the protocol requires but nothing reads.
    resize: (cols: number, rows: number) => {
      connection.send({ type: 'set_size', content: [rows, cols, 0, 0] });
    },
    disconnect: () => {
      connection.dispose();
    },
    shutdown: async () => {
      await manager.shutdown(connection.name);
    },
  };
}

function describeError(err: unknown, cfg: ServerConfig): string {
  if (err instanceof ServerConnection.ResponseError) {
    const code = err.response.status;
    if (code === 401 || code === 403) {
      return `Jupyter Server at ${cfg.baseUrl} rejected the token (HTTP ${code}). Check the token in Settings.`;
    }
    if (code === 404) {
      return `Jupyter Server at ${cfg.baseUrl} has no kernelspec API (HTTP 404). Is that really a Jupyter Server URL?`;
    }
    return `Jupyter Server at ${cfg.baseUrl} returned HTTP ${code}: ${err.message}`;
  }
  if (err instanceof ServerConnection.NetworkError || err instanceof TypeError) {
    return `Could not reach a Jupyter Server at ${cfg.baseUrl}. Is it running, and is the URL right?`;
  }
  const message = err instanceof Error ? err.message : String(err);
  return `Could not connect to ${cfg.baseUrl}: ${message}`;
}

class JupyterKernelSession implements KernelSession {
  constructor(private readonly session: Session.ISessionConnection) {}

  get path(): string {
    return this.session.path;
  }

  get kernelName(): string {
    return this.session.kernel?.name ?? '';
  }

  get status(): KernelStatus {
    const kernel = this.session.kernel;
    if (!kernel) return 'disconnected';
    return mapStatus(kernel.status);
  }

  onStatus(cb: (s: KernelStatus) => void): () => void {
    // The session proxies the current kernel's statusChanged, so this keeps
    // working across restart()/changeKernel().
    const slot = (_sender: unknown, status: KernelMessage.Status) => {
      guard('onStatus', () => cb(mapStatus(status)));
    };
    this.session.statusChanged.connect(slot);
    return () => {
      this.session.statusChanged.disconnect(slot);
    };
  }

  execute(code: string, handlers: ExecuteHandlers): ExecuteHandle {
    const kernel = this.session.kernel;
    if (!kernel) {
      guard('onDone', () => handlers.onDone('aborted'));
      return { done: Promise.resolve(), cancel: () => {} };
    }

    const future = kernel.requestExecute({
      code,
      stop_on_error: true,
      store_history: true,
    });

    let settled = false;
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    const finish = (status: ExecutionResult) => {
      if (settled) return;
      settled = true;
      guard('onDone', () => handlers.onDone(status));
      resolveDone();
    };

    const emit = (out: CellOutput) => guard('onOutput', () => handlers.onOutput(out));

    future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
      switch (msg.header.msg_type) {
        case 'clear_output': {
          const wait = (msg as KernelMessage.IClearOutputMsg).content.wait === true;
          guard('onClearOutput', () => handlers.onClearOutput?.(wait));
          return;
        }
        case 'update_display_data': {
          const content = (msg as KernelMessage.IUpdateDisplayDataMsg).content;
          const displayId = transientDisplayId(content);
          // No display_id means nothing to update in place; Jupyter drops it too.
          if (!displayId) return;
          const data = mapMimeBundle(content.data as Record<string, unknown>);
          const metadata = (content.metadata ?? {}) as Record<string, unknown>;
          guard('onUpdateDisplay', () => handlers.onUpdateDisplay?.(displayId, data, metadata));
          return;
        }
        default: {
          const out = iopubToOutput(msg);
          if (out) emit(out);
        }
      }
    };

    future.done
      .then((reply: KernelMessage.IExecuteReplyMsg) => {
        const count = reply.content.execution_count;
        if (typeof count === 'number' && count >= 0) {
          guard('onExecutionCount', () => handlers.onExecutionCount(count));
        }
        finish(replyStatus(reply.content.status));
      })
      .catch(() => {
        // Disposed before the reply landed, or the connection dropped.
        finish('aborted');
      });

    return {
      done,
      cancel: () => {
        if (settled || future.isDisposed) return;
        void kernel.interrupt().catch((err) => {
          console.error('[orbital/session] interrupt failed', err);
        });
      },
    };
  }

  async complete(code: string, cursor: number): Promise<CompletionResult> {
    const empty: CompletionResult = { cursorStart: cursor, cursorEnd: cursor, items: [] };
    const kernel = this.session.kernel;
    if (!kernel) return empty;

    const reply = await kernel.requestComplete({ code, cursor_pos: cursor });
    const content = reply.content;
    // 'error'/'abort' replies carry no matches; an empty result is the honest
    // answer for a completion popup, so this does not throw.
    if (content.status !== 'ok') return empty;

    const hints = (content.metadata as Record<string, unknown> | undefined)?.[
      '_jupyter_types_experimental'
    ];
    const typed = Array.isArray(hints) ? (hints as { type?: unknown }[]) : [];

    const items: CompletionItem[] = content.matches.map((label, i) => {
      const type = typed[i]?.type;
      return typeof type === 'string' && type ? { label, type } : { label };
    });

    return { cursorStart: content.cursor_start, cursorEnd: content.cursor_end, items };
  }

  async inspect(code: string, cursor: number, detailLevel: 0 | 1 = 0): Promise<InspectResult> {
    const kernel = this.session.kernel;
    if (!kernel) return { found: false, data: {} };

    const reply = await kernel.requestInspect({
      code,
      cursor_pos: cursor,
      detail_level: detailLevel,
    });
    const content = reply.content;
    if (content.status !== 'ok' || !content.found) return { found: false, data: {} };

    return { found: true, data: mapMimeBundle((content.data ?? {}) as Record<string, unknown>) };
  }

  async executeSilent(code: string): Promise<SilentResult> {
    const kernel = this.session.kernel;
    if (!kernel) return { status: 'aborted', outputs: [] };

    const outputs: CellOutput[] = [];
    const future = kernel.requestExecute({
      code,
      silent: true,
      store_history: false,
      stop_on_error: false,
    });
    // Silent runs have no cell to clear and no rendered display to update, so
    // clear_output/update_display_data are dropped; display_data still carries
    // its displayId for callers that want it.
    future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
      const out = iopubToOutput(msg);
      if (out) outputs.push(out);
    };

    try {
      const reply = await future.done;
      return { status: replyStatus(reply.content.status), outputs };
    } catch {
      // Disposed before the reply landed, or the connection dropped.
      return { status: 'aborted', outputs };
    }
  }

  async interrupt(): Promise<void> {
    await this.session.kernel?.interrupt();
  }

  async restart(): Promise<void> {
    await this.session.kernel?.restart();
  }

  async changeKernel(kernelName: string): Promise<void> {
    // Status subscriptions hang off `session.statusChanged`, which the session
    // re-wires to the new kernel, so onStatus() listeners survive this.
    await this.session.changeKernel({ name: kernelName });
    await this.session.kernel?.info;
  }

  async shutdown(): Promise<void> {
    try {
      await this.session.shutdown();
    } finally {
      this.session.dispose();
    }
  }
}

export class JupyterSessionProvider implements SessionProvider {
  private live: Live | null = null;
  private config: ServerConfig | null = null;

  constructor(private readonly options: JupyterProviderOptions = {}) {}

  readonly contents: ContentsApi = {
    list: async (dir: string): Promise<ContentsEntry[]> => {
      const model = await this.requireLive().contents.get(dir, { content: true });
      const children: Contents.IModel[] = Array.isArray(model.content) ? model.content : [];
      return children.map((entry) => ({
        name: entry.name,
        path: entry.path,
        type:
          entry.type === 'notebook' || entry.type === 'directory'
            ? (entry.type as 'notebook' | 'directory')
            : 'file',
        lastModified: entry.last_modified,
        size: entry.size ?? undefined,
      }));
    },

    getNotebook: async (path: string): Promise<unknown> => {
      const model = await this.requireLive().contents.get(path, {
        type: 'notebook',
        content: true,
      });
      return model.content;
    },

    saveNotebook: async (path: string, nb: unknown): Promise<void> => {
      await this.requireLive().contents.save(path, {
        type: 'notebook',
        format: 'json',
        content: nb,
      });
    },

    createNotebook: async (dir: string, name?: string): Promise<string> => {
      const contents = this.requireLive().contents;
      const created = await contents.newUntitled({ path: dir, type: 'notebook' });
      if (!name) return created.path;
      const fileName = name.endsWith('.ipynb') ? name : `${name}.ipynb`;
      const renamed = await contents.rename(created.path, joinPath(dir, fileName));
      return renamed.path;
    },

    getFile: async (path: string): Promise<string> => {
      const model = await this.requireLive().contents.get(path, {
        type: 'file',
        format: 'text',
        content: true,
      });
      if (model.format !== 'text') {
        throw new Error(`${path} is not a text file (server returned format "${model.format}").`);
      }
      return typeof model.content === 'string' ? model.content : String(model.content ?? '');
    },

    saveFile: async (path: string, text: string): Promise<void> => {
      await this.requireLive().contents.save(path, {
        type: 'file',
        format: 'text',
        content: text,
      });
    },

    createFile: async (dir: string, name?: string): Promise<string> => {
      const contents = this.requireLive().contents;
      const created = await contents.newUntitled({ path: dir, type: 'file', ext: '.txt' });
      if (!name) return created.path;
      const renamed = await contents.rename(created.path, joinPath(dir, name));
      return renamed.path;
    },

    createDirectory: async (dir: string, name?: string): Promise<string> => {
      const contents = this.requireLive().contents;
      const created = await contents.newUntitled({ path: dir, type: 'directory' });
      if (!name) return created.path;
      const renamed = await contents.rename(created.path, joinPath(dir, name));
      return renamed.path;
    },

    rename: async (path: string, newPath: string): Promise<void> => {
      await this.requireLive().contents.rename(path, newPath);
    },

    delete: async (path: string): Promise<void> => {
      await this.requireLive().contents.delete(path);
    },

    upload: async (dir: string, file: File): Promise<string> => {
      const contents = this.requireLive().contents;
      const path = joinPath(dir, file.name);
      if (isTextUpload(file)) {
        await contents.save(path, { type: 'file', format: 'text', content: await file.text() });
      } else {
        await contents.save(path, {
          type: 'file',
          format: 'base64',
          content: toBase64(await file.arrayBuffer()),
        });
      }
      return path;
    },
  };

  readonly terminals: TerminalsApi = {
    list: async (): Promise<string[]> => {
      const manager = this.requireLive().terminals;
      await manager.refreshRunning();
      return Array.from(manager.running()).map((model) => model.name);
    },

    start: async (): Promise<TerminalConnection> => {
      const manager = this.requireLive().terminals;
      return wrapTerminal(await manager.startNew(), manager);
    },

    connect: async (name: string): Promise<TerminalConnection> => {
      const manager = this.requireLive().terminals;
      return wrapTerminal(manager.connectTo({ model: { name } }), manager);
    },
  };

  async connect(cfg: ServerConfig): Promise<void> {
    await this.disconnect();

    const baseUrl = cfg.baseUrl.replace(/\/+$/, '');
    const settings = ServerConnection.makeSettings({
      baseUrl,
      wsUrl: deriveWsUrl(baseUrl),
      token: cfg.token,
      appendToken: true,
      ...(this.options.WebSocket ? { WebSocket: this.options.WebSocket } : {}),
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    });

    const kernels = new KernelManager({ serverSettings: settings });
    const sessions = new SessionManager({ kernelManager: kernels, serverSettings: settings });
    const specs = new KernelSpecManager({ serverSettings: settings });
    const contents = new ContentsManager({ serverSettings: settings });
    const terminals = new TerminalManager({
      serverSettings: settings,
      terminalAPIClient: new OrbitalTerminalAPIClient(settings),
    });

    // The managers poll in the background; if the server is unreachable their
    // `ready` promises reject. We report failures ourselves (below), so keep
    // those rejections from surfacing as unhandled.
    for (const ready of [kernels.ready, sessions.ready, specs.ready, terminals.ready]) {
      void ready.catch(() => undefined);
    }

    try {
      // refreshSpecs() is poll-backed and resolves even when the request was
      // refused, leaving `specs` null. A null here means "something is wrong";
      // diagnose() makes one direct request to find out what.
      await specs.refreshSpecs();
      if (!specs.specs) {
        await this.diagnose(settings, { ...cfg, baseUrl });
      }
    } catch (err) {
      sessions.dispose();
      kernels.dispose();
      specs.dispose();
      contents.dispose();
      terminals.dispose();
      throw err instanceof Error && err.name === 'OrbitalConnectError'
        ? err
        : new Error(describeError(err, { ...cfg, baseUrl }));
    }

    this.live = { settings, kernels, sessions, specs, contents, terminals };
    this.config = { ...cfg, baseUrl };
  }

  async disconnect(): Promise<void> {
    const live = this.live;
    this.live = null;
    this.config = null;
    if (!live) return;
    live.sessions.dispose();
    live.kernels.dispose();
    live.specs.dispose();
    live.contents.dispose();
    live.terminals.dispose();
  }

  async listKernelSpecs(): Promise<KernelSpecInfo[]> {
    const live = this.requireLive();
    if (!live.specs.specs) await live.specs.refreshSpecs();
    const specs = live.specs.specs;
    if (!specs) return [];
    return Object.keys(specs.kernelspecs)
      .map((name) => {
        const spec = specs.kernelspecs[name];
        if (!spec) return null;
        return {
          name: spec.name ?? name,
          displayName: spec.display_name ?? name,
          language: spec.language ?? '',
        } satisfies KernelSpecInfo;
      })
      .filter((s): s is KernelSpecInfo => s !== null);
  }

  async openNotebookSession(path: string, kernelName?: string): Promise<KernelSession> {
    const live = this.requireLive();

    await live.sessions.refreshRunning();
    const existing = await live.sessions.findByPath(path);
    if (existing) {
      const connection = live.sessions.connectTo({ model: existing });
      await connection.kernel?.info;
      return new JupyterKernelSession(connection);
    }

    let name = kernelName;
    if (!name) {
      if (!live.specs.specs) await live.specs.refreshSpecs();
      name = live.specs.specs?.default;
    }

    const connection = await live.sessions.startNew({
      path,
      type: 'notebook',
      name: basename(path),
      ...(name ? { kernel: { name } } : {}),
    });
    await connection.kernel?.info;
    return new JupyterKernelSession(connection);
  }

  /** Exposed for diagnostics; null until connect() succeeds. */
  get serverConfig(): ServerConfig | null {
    return this.config;
  }

  /**
   * Makes one direct kernelspecs request so a failed connect can say *why*
   * (bad token vs. unreachable vs. not a Jupyter Server). Always throws.
   */
  private async diagnose(
    settings: ServerConnection.ISettings,
    cfg: ServerConfig,
  ): Promise<never> {
    let cause: unknown = new Error('the server returned no kernelspecs');
    try {
      const url = `${settings.baseUrl.replace(/\/+$/, '')}/api/kernelspecs`;
      const res = await ServerConnection.makeRequest(url, { method: 'GET' }, settings);
      if (!res.ok) cause = await ServerConnection.ResponseError.create(res);
    } catch (err) {
      cause = err;
    }
    const error = new Error(describeError(cause, cfg));
    error.name = 'OrbitalConnectError';
    throw error;
  }

  private requireLive(): Live {
    if (!this.live) throw new Error('Not connected to a Jupyter Server. Call connect() first.');
    return this.live;
  }
}

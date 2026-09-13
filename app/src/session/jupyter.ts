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
} from '@jupyterlab/services';
import type { Contents, KernelMessage, Session } from '@jupyterlab/services';

import type {
  CellOutput,
  ContentsApi,
  ContentsEntry,
  ExecuteHandle,
  ExecuteHandlers,
  ExecutionResult,
  KernelSession,
  KernelSpecInfo,
  KernelStatus,
  ServerConfig,
  SessionProvider,
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
      const type = msg.header.msg_type;
      switch (type) {
        case 'stream': {
          const content = (msg as KernelMessage.IStreamMsg).content;
          emit({
            type: 'stream',
            name: content.name === 'stderr' ? 'stderr' : 'stdout',
            text: mimeToString(content.text),
          });
          break;
        }
        case 'display_data': {
          const content = (msg as KernelMessage.IDisplayDataMsg).content;
          emit({
            type: 'display_data',
            data: mapMimeBundle(content.data as Record<string, unknown>),
            metadata: (content.metadata ?? {}) as Record<string, unknown>,
          });
          break;
        }
        case 'execute_result': {
          const content = (msg as KernelMessage.IExecuteResultMsg).content;
          emit({
            type: 'execute_result',
            data: mapMimeBundle(content.data as Record<string, unknown>),
            metadata: (content.metadata ?? {}) as Record<string, unknown>,
            executionCount: content.execution_count ?? undefined,
          });
          break;
        }
        case 'error': {
          const content = (msg as KernelMessage.IErrorMsg).content;
          emit({
            type: 'error',
            ename: content.ename,
            evalue: content.evalue,
            traceback: content.traceback ?? [],
          });
          break;
        }
        case 'clear_output':
          // TODO(M3): honour clear_output (wait flag) once the notebook store
          // owns per-cell output buffers.
          break;
        case 'status':
        case 'execute_input':
          break;
        default:
          break;
      }
    };

    future.done
      .then((reply: KernelMessage.IExecuteReplyMsg) => {
        const count = reply.content.execution_count;
        if (typeof count === 'number' && count >= 0) {
          guard('onExecutionCount', () => handlers.onExecutionCount(count));
        }
        const status = reply.content.status;
        if (status === 'ok') finish('ok');
        else if (status === 'error') finish('error');
        else finish('aborted');
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

  async interrupt(): Promise<void> {
    await this.session.kernel?.interrupt();
  }

  async restart(): Promise<void> {
    await this.session.kernel?.restart();
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

    // The managers poll in the background; if the server is unreachable their
    // `ready` promises reject. We report failures ourselves (below), so keep
    // those rejections from surfacing as unhandled.
    for (const ready of [kernels.ready, sessions.ready, specs.ready]) {
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
      throw err instanceof Error && err.name === 'OrbitalConnectError'
        ? err
        : new Error(describeError(err, { ...cfg, baseUrl }));
    }

    this.live = { settings, kernels, sessions, specs, contents };
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

/**
 * Agent store: the browser end of the sidecar protocol in `protocol.ts`.
 *
 * It owns one WebSocket to `agent/server.mjs`, the transcript the panel
 * renders, the permission handshake, and the `orbital_*` tool round-trip
 * (sidecar asks, `executor.ts` performs it against the notebook, we answer).
 *
 * Nothing here reaches into the notebook except through the notebook store's
 * public actions, and the notebook knows nothing about the agent: closing the
 * panel never disturbs a running cell.
 *
 * Two seams keep this testable without a server or a DOM: `setWebSocketFactory`
 * swaps the socket constructor, `setToolExecutor` swaps the executor.
 */
import { create } from 'zustand';

import { cryptoId } from '../notebook/model';
import { useNotebookStore } from '../notebook/store';
import { useSessionStore } from '../session/store';
import { executeOrbitalTool } from './executor';
import {
  AGENT_DEFAULT_URL,
  type AgentBlock,
  type AgentContext,
  type AgentRunStatus,
  type AuthStatus,
  type ClientMessage,
  type ServerMessage,
} from './protocol';

// ---- seams ----------------------------------------------------------------

/** The slice of `WebSocket` this store uses. Keeps the fake in tests small. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

const WS_CONNECTING = 0;
const WS_OPEN = 1;

const realWebSocketFactory: WebSocketFactory = (url) =>
  new WebSocket(url) as unknown as WebSocketLike;

let createSocket: WebSocketFactory = realWebSocketFactory;

/** Test seam. Pass nothing to restore the browser's `WebSocket`. */
export function setWebSocketFactory(factory?: WebSocketFactory): void {
  createSocket = factory ?? realWebSocketFactory;
}

export type ToolExecutor = (name: string, input: unknown) => Promise<unknown>;

let runTool: ToolExecutor = executeOrbitalTool;

/** Test seam. Pass nothing to restore the real notebook executor. */
export function setToolExecutor(executor?: ToolExecutor): void {
  runTool = executor ?? executeOrbitalTool;
}

// ---- persistence ----------------------------------------------------------

const STORAGE_KEY = 'orbital.agent';

interface Persisted {
  url: string;
  alwaysAllow: string[];
  includeNotebook: boolean;
  includeSelectedCell: boolean;
}

/** Null outside a browser (the vitest node environment, a Tauri worker). */
function storage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    // Safari in private mode throws on access rather than returning null.
    return null;
  }
}

function loadPersisted(): Partial<Persisted> {
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const p = parsed as Record<string, unknown>;
    return {
      url: typeof p.url === 'string' ? p.url : undefined,
      alwaysAllow: Array.isArray(p.alwaysAllow)
        ? p.alwaysAllow.filter((t): t is string => typeof t === 'string')
        : undefined,
      includeNotebook: typeof p.includeNotebook === 'boolean' ? p.includeNotebook : undefined,
      includeSelectedCell:
        typeof p.includeSelectedCell === 'boolean' ? p.includeSelectedCell : undefined,
    };
  } catch {
    return {};
  }
}

function persist(state: AgentState): void {
  const payload: Persisted = {
    url: state.url,
    alwaysAllow: state.alwaysAllow,
    includeNotebook: state.includeNotebook,
    includeSelectedCell: state.includeSelectedCell,
  };
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota or private mode: these settings are a convenience, not state we own.
  }
}

// ---- public shape ---------------------------------------------------------

export interface TranscriptItem {
  id: string;
  role: 'user' | 'assistant' | 'system';
  blocks: AgentBlock[];
  /** Present only while the turn is still streaming; cleared by `blocks`. */
  streamingText?: string;
  ts: number;
}

export interface PendingPermission {
  requestId: string;
  runId: string;
  tool: string;
  input: unknown;
  description: string;
}

export interface AgentState {
  url: string;
  connection: 'disconnected' | 'connecting' | 'connected' | 'error';
  error: string | null;

  auth: AuthStatus | null;
  cwd: string | null;
  model: string | null;

  transcript: TranscriptItem[];
  runStatus: AgentRunStatus;
  currentRunId: string | null;
  sessionId: string | null;

  lastResult: { costUsd: number | null; durationMs: number; numTurns: number } | null;
  totalCostUsd: number;

  pendingPermission: PendingPermission | null;
  alwaysAllow: string[];

  includeNotebook: boolean;
  includeSelectedCell: boolean;

  setUrl(url: string): void;
  connect(): void;
  /** Resets backoff and dials immediately. For the panel's Retry button. */
  retryNow(): void;
  disconnect(): void;
  checkAuth(): void;
  /** Builds an `AgentContext` from the notebook/session stores per the include flags. */
  send(prompt: string): void;
  interrupt(): void;
  answerPermission(allow: boolean, remember?: boolean): void;
  setInclude(flag: 'notebook' | 'cell', value: boolean): void;
  /** Drops the transcript and the SDK session id, so the next run starts fresh. */
  clearConversation(): void;
}

// ---- connection state (not zustand: not serializable, not rendered) --------

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 10_000;
/** Failed redials tolerated after losing a good connection before we stop
 *  calling it "reconnecting" and admit the sidecar looks down. */
const LOST_CONNECTION_GIVE_UP_ATTEMPTS = 5;

const LOST_CONNECTION_MESSAGE = 'Lost connection to the agent sidecar. Reconnecting…';

function notRunningMessage(url: string): string {
  return `Agent sidecar is not running at ${url}. Start it with scripts/agent.ps1 (or scripts/dev.ps1), then Retry.`;
}

let socket: WebSocketLike | null = null;
/** True while the panel wants a connection; drives the reconnect loop. */
let wantConnection = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = RECONNECT_MIN_MS;
/** Consecutive failed redials since a good connection was lost; meaningful only while `lostConnection`. */
let reconnectAttempts = 0;
/** True from the moment a once-open connection drops until we either
 *  reconnect or give up after `LOST_CONNECTION_GIVE_UP_ATTEMPTS`. Distinguishes
 *  "reconnecting" (honest spinner) from "never reached it" (plain error). */
let lostConnection = false;
const clientId = cryptoId();

function clearReconnect(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

/** Closes the socket without tripping the reconnect loop. */
function teardownSocket(): void {
  const dying = socket;
  socket = null;
  if (!dying) return;
  dying.onopen = null;
  dying.onclose = null;
  dying.onerror = null;
  dying.onmessage = null;
  try {
    dying.close();
  } catch {
    // Already closing; nothing to do.
  }
}

export const useAgentStore = create<AgentState>((set, get) => {
  const persisted = loadPersisted();

  function sendJson(message: ClientMessage): boolean {
    if (!socket || socket.readyState !== WS_OPEN) {
      set({ error: 'Not connected to the agent sidecar.' });
      return false;
    }
    socket.send(JSON.stringify(message));
    return true;
  }

  /** Appends streamed text to the open assistant turn, starting one if needed. */
  function appendDelta(text: string): void {
    set((s) => {
      const transcript = s.transcript.slice();
      const last = transcript[transcript.length - 1];
      if (last && last.role === 'assistant' && last.streamingText !== undefined) {
        transcript[transcript.length - 1] = { ...last, streamingText: last.streamingText + text };
      } else {
        transcript.push({
          id: cryptoId(),
          role: 'assistant',
          blocks: [],
          streamingText: text,
          ts: Date.now(),
        });
      }
      return { transcript };
    });
  }

  /**
   * Finalizes a turn. An assistant `blocks` message replaces the streaming
   * item it completes, so the panel never shows the same text twice.
   */
  function finalizeBlocks(role: 'assistant' | 'user', blocks: AgentBlock[]): void {
    set((s) => {
      const transcript = s.transcript.slice();
      const last = transcript[transcript.length - 1];
      if (
        role === 'assistant' &&
        last &&
        last.role === 'assistant' &&
        last.streamingText !== undefined
      ) {
        transcript[transcript.length - 1] = { ...last, blocks, streamingText: undefined };
      } else {
        transcript.push({ id: cryptoId(), role, blocks, ts: Date.now() });
      }
      return { transcript };
    });
  }

  async function handleToolRequest(requestId: string, name: string, input: unknown): Promise<void> {
    set({ runStatus: 'waiting_tool' });
    try {
      const result = await runTool(name, input);
      sendJson({ type: 'tool_result', requestId, ok: true, result });
    } catch (err) {
      sendJson({
        type: 'tool_result',
        requestId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // Only step back to `running` if nothing else moved us on meanwhile.
    if (get().runStatus === 'waiting_tool') set({ runStatus: 'running' });
  }

  function handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'auth':
        set({ auth: message.status, cwd: message.cwd, model: message.model });
        return;

      case 'run_status':
        set((s) => ({
          runStatus: message.status,
          currentRunId: message.status === 'idle' ? null : message.runId,
          sessionId: message.sessionId ?? s.sessionId,
        }));
        return;

      case 'delta':
        appendDelta(message.text);
        return;

      case 'blocks':
        finalizeBlocks(message.role, message.blocks);
        return;

      case 'tool_request':
        void handleToolRequest(message.requestId, message.name, message.input);
        return;

      case 'permission_request':
        if (get().alwaysAllow.includes(message.tool)) {
          sendJson({ type: 'permission', requestId: message.requestId, allow: true });
          return;
        }
        set({
          runStatus: 'waiting_permission',
          pendingPermission: {
            requestId: message.requestId,
            runId: message.runId,
            tool: message.tool,
            input: message.input,
            description: message.description,
          },
        });
        return;

      case 'result':
        set((s) => ({
          lastResult: {
            costUsd: message.costUsd,
            durationMs: message.durationMs,
            numTurns: message.numTurns,
          },
          totalCostUsd: s.totalCostUsd + (message.costUsd ?? 0),
          sessionId: message.sessionId ?? s.sessionId,
          runStatus: message.ok ? 'idle' : 'error',
          currentRunId: null,
          pendingPermission: null,
          error: message.ok ? s.error : (message.error ?? 'The agent run failed.'),
        }));
        return;

      case 'error':
        set((s) => ({
          error: message.message,
          runStatus: message.runId && message.runId === s.currentRunId ? 'error' : s.runStatus,
        }));
        return;
    }
  }

  function handleRaw(data: unknown): void {
    if (typeof data !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      set({ error: 'The agent sidecar sent a malformed message.' });
      return;
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { type?: unknown }).type !== 'string'
    ) {
      set({ error: 'The agent sidecar sent a message with no type.' });
      return;
    }
    handleMessage(parsed as ServerMessage);
  }

  function scheduleReconnect(): void {
    clearReconnect();
    const delay = backoffMs;
    backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      // Background retry: silent. It must not flip a settled 'error' (or the
      // in-progress 'connecting' + lost-connection message) back to a bare
      // "connecting" with no explanation while the attempt is in flight.
      if (wantConnection) openSocket(false);
    }, delay);
  }

  /** A dial failed before ever opening. Distinguishes "never reached it" from
   *  "lost a good connection", and owns the give-up-after-N-reattempts rule.
   *  Also resets the run bookkeeping a dead socket can no longer service. */
  function handleDialFailure(url: string): void {
    const runReset = { runStatus: 'idle' as const, currentRunId: null, pendingPermission: null };
    if (lostConnection) {
      reconnectAttempts += 1;
      if (reconnectAttempts >= LOST_CONNECTION_GIVE_UP_ATTEMPTS) {
        lostConnection = false;
        set({ connection: 'error', error: notRunningMessage(url), ...runReset });
        return;
      }
      set({ connection: 'connecting', error: LOST_CONNECTION_MESSAGE, ...runReset });
      return;
    }
    set({ connection: 'error', error: notRunningMessage(url), ...runReset });
  }

  /**
   * @param showConnecting Only true for the very first dial and an explicit
   * `connect()`/`retryNow()`. Background retries pass `false` so the honest
   * error (or "reconnecting…") stays on screen instead of flickering to a
   * bare spinner while the silent redial is in flight.
   */
  function openSocket(showConnecting: boolean): void {
    clearReconnect();
    teardownSocket();

    const url = get().url;
    if (showConnecting) set({ connection: 'connecting', error: null });

    let opened = false;
    let next: WebSocketLike;
    try {
      next = createSocket(url);
    } catch {
      handleDialFailure(url);
      if (wantConnection) scheduleReconnect();
      return;
    }
    socket = next;

    next.onopen = () => {
      if (socket !== next) return;
      opened = true;
      backoffMs = RECONNECT_MIN_MS;
      reconnectAttempts = 0;
      lostConnection = false;
      set({ connection: 'connected', error: null });
      sendJson({ type: 'hello', clientId });
    };

    next.onmessage = (event) => {
      if (socket !== next) return;
      handleRaw(event.data);
    };

    next.onerror = () => {
      // `onclose` always follows and owns the state transition.
      if (socket !== next) return;
    };

    next.onclose = () => {
      if (socket !== next) return;
      socket = null;
      if (!wantConnection) {
        set({
          connection: 'disconnected',
          runStatus: 'idle',
          currentRunId: null,
          pendingPermission: null,
        });
        return;
      }
      if (opened) {
        // It was good a moment ago: an honest spinner, not a flat error.
        lostConnection = true;
        reconnectAttempts = 0;
        set({
          connection: 'connecting',
          error: LOST_CONNECTION_MESSAGE,
          runStatus: 'idle',
          currentRunId: null,
          pendingPermission: null,
        });
      } else {
        handleDialFailure(url);
      }
      scheduleReconnect();
    };
  }

  return {
    url: persisted.url ?? AGENT_DEFAULT_URL,
    connection: 'disconnected',
    error: null,

    auth: null,
    cwd: null,
    model: null,

    transcript: [],
    runStatus: 'idle',
    currentRunId: null,
    sessionId: null,

    lastResult: null,
    totalCostUsd: 0,

    pendingPermission: null,
    alwaysAllow: persisted.alwaysAllow ?? [],

    includeNotebook: persisted.includeNotebook ?? true,
    includeSelectedCell: persisted.includeSelectedCell ?? false,

    setUrl: (url) => {
      if (url === get().url) return;
      set({ url });
      persist(get());
      // A live socket points at the old address; drop it and let the
      // reconnect loop (or the next `connect()`) dial the new one. A new
      // address is a fresh start: it hasn't lost anything yet.
      teardownSocket();
      backoffMs = RECONNECT_MIN_MS;
      reconnectAttempts = 0;
      lostConnection = false;
      if (wantConnection) openSocket(true);
      else set({ connection: 'disconnected' });
    },

    connect: () => {
      wantConnection = true;
      backoffMs = RECONNECT_MIN_MS;
      reconnectAttempts = 0;
      if (socket && (socket.readyState === WS_OPEN || socket.readyState === WS_CONNECTING)) return;
      openSocket(true);
    },

    retryNow: () => {
      wantConnection = true;
      backoffMs = RECONNECT_MIN_MS;
      reconnectAttempts = 0;
      openSocket(true);
    },

    disconnect: () => {
      wantConnection = false;
      clearReconnect();
      backoffMs = RECONNECT_MIN_MS;
      reconnectAttempts = 0;
      lostConnection = false;
      teardownSocket();
      set({
        connection: 'disconnected',
        runStatus: 'idle',
        currentRunId: null,
        pendingPermission: null,
      });
    },

    checkAuth: () => {
      sendJson({ type: 'auth_check' });
    },

    send: (prompt) => {
      if (!prompt.trim()) return;
      const s = get();
      if (s.connection !== 'connected') {
        set({ error: 'Not connected to the agent sidecar.' });
        return;
      }
      if (s.runStatus !== 'idle' && s.runStatus !== 'error') {
        set({ error: 'The agent is still working. Interrupt it before sending another prompt.' });
        return;
      }

      const nb = useNotebookStore.getState();
      const path = nb.activePath;
      const cells = path ? (nb.docs[path]?.cells ?? []) : [];
      const selected = nb.selectedCellId ? cells.findIndex((c) => c.id === nb.selectedCellId) : -1;

      const context: AgentContext = {
        notebookPath: s.includeNotebook ? path : null,
        selectedCellIndex: s.includeSelectedCell && selected >= 0 ? selected : null,
        kernelStatus: s.includeNotebook ? useSessionStore.getState().kernelStatus : null,
      };
      if (s.includeSelectedCell && selected >= 0) {
        const cell = cells[selected];
        context.attachment = `Selected cell (index ${selected}, ${cell.type}):\n${cell.source}`;
      }

      const runId = cryptoId();
      set((prev) => ({
        transcript: [
          ...prev.transcript,
          {
            id: cryptoId(),
            role: 'user' as const,
            blocks: [{ kind: 'text' as const, text: prompt }],
            ts: Date.now(),
          },
        ],
        runStatus: 'running' as AgentRunStatus,
        currentRunId: runId,
        error: null,
      }));

      const sessionId = s.sessionId;
      sendJson(
        sessionId
          ? { type: 'start', runId, prompt, context, sessionId }
          : { type: 'start', runId, prompt, context },
      );
    },

    interrupt: () => {
      const runId = get().currentRunId;
      if (!runId) return;
      sendJson({ type: 'interrupt', runId });
    },

    answerPermission: (allow, remember) => {
      const pending = get().pendingPermission;
      if (!pending) return;
      sendJson({ type: 'permission', requestId: pending.requestId, allow, remember });
      set((s) => ({
        pendingPermission: null,
        runStatus: s.runStatus === 'waiting_permission' ? 'running' : s.runStatus,
        alwaysAllow:
          remember && allow && !s.alwaysAllow.includes(pending.tool)
            ? [...s.alwaysAllow, pending.tool]
            : s.alwaysAllow,
      }));
      persist(get());
    },

    setInclude: (flag, value) => {
      set(flag === 'notebook' ? { includeNotebook: value } : { includeSelectedCell: value });
      persist(get());
    },

    clearConversation: () => {
      set({ transcript: [], sessionId: null, lastResult: null, error: null });
    },
  };
});

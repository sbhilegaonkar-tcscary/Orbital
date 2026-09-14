/**
 * Agent store tests. No sidecar, no DOM: a fake WebSocket is injected through
 * `setWebSocketFactory` and a stub executor through `setToolExecutor`, so the
 * whole protocol can be driven message by message.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setProviderFactory, useSessionStore } from '../session/store';
import { makeFakeContents, makeFakeProvider } from '../session/testing';
import { useNotebookStore } from '../notebook/store';
import type { ClientMessage, ServerMessage } from './protocol';
import {
  setToolExecutor,
  setWebSocketFactory,
  useAgentStore,
  type WebSocketLike,
} from './store';

const URL = 'ws://localhost:8787/ws';

/** Lets the event loop (not just the microtask queue) drain. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

class FakeSocket implements WebSocketLike {
  static last: FakeSocket | null = null;
  static created = 0;

  readyState = 0;
  closed = false;
  readonly sent: string[] = [];

  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.last = this;
    FakeSocket.created += 1;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }

  /** Completes the handshake. */
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  /** Delivers one sidecar message. */
  emit(message: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  messages(): ClientMessage[] {
    return this.sent.map((raw) => JSON.parse(raw) as ClientMessage);
  }

  lastOfType<T extends ClientMessage['type']>(type: T): Extract<ClientMessage, { type: T }> {
    const found = [...this.messages()].reverse().find((m) => m.type === type);
    if (!found) throw new Error(`no ${type} message was sent`);
    return found as Extract<ClientMessage, { type: T }>;
  }
}

function socket(): FakeSocket {
  if (!FakeSocket.last) throw new Error('no socket was created');
  return FakeSocket.last;
}

/** Connects and completes the handshake. */
function connect(): FakeSocket {
  useAgentStore.getState().connect();
  const s = socket();
  s.open();
  return s;
}

beforeEach(() => {
  FakeSocket.last = null;
  FakeSocket.created = 0;
  setWebSocketFactory((url) => new FakeSocket(url));
  setToolExecutor(async () => ({ ok: true }));
  useAgentStore.setState({
    url: URL,
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
    alwaysAllow: [],
    includeNotebook: true,
    includeSelectedCell: false,
  });
});

afterEach(() => {
  useAgentStore.getState().disconnect();
  setWebSocketFactory();
  setToolExecutor();
  setProviderFactory();
  vi.useRealTimers();
});

describe('connection', () => {
  it('dials the configured url and says hello once open', () => {
    useAgentStore.getState().connect();
    expect(useAgentStore.getState().connection).toBe('connecting');
    expect(socket().url).toBe(URL);

    socket().open();
    expect(useAgentStore.getState().connection).toBe('connected');
    expect(socket().lastOfType('hello').clientId).toBeTruthy();
  });

  it('reconnects with a growing backoff while the panel wants a connection', () => {
    vi.useFakeTimers();
    connect();
    expect(FakeSocket.created).toBe(1);

    socket().close();
    expect(useAgentStore.getState().connection).toBe('connecting');

    vi.advanceTimersByTime(999);
    expect(FakeSocket.created).toBe(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.created).toBe(2);

    // Second failure waits twice as long.
    socket().close();
    vi.advanceTimersByTime(1999);
    expect(FakeSocket.created).toBe(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.created).toBe(3);
  });

  it('stops reconnecting after disconnect()', () => {
    vi.useFakeTimers();
    connect();
    useAgentStore.getState().disconnect();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.created).toBe(1);
    expect(useAgentStore.getState().connection).toBe('disconnected');
  });

  it('explains an unreachable sidecar', () => {
    vi.useFakeTimers();
    useAgentStore.getState().connect();
    socket().close();
    expect(useAgentStore.getState().error).toMatch(/Could not reach the agent sidecar/);
  });
});

describe('auth', () => {
  it('records the sidecar auth status, cwd and model', () => {
    const s = connect();
    s.emit({
      type: 'auth',
      status: {
        loggedIn: false,
        reason: 'No Claude login was found on this machine.',
        loginCommand: 'npx -y @anthropic-ai/claude-code@latest auth login',
      },
      cwd: '/repo/workspace',
      model: null,
    });

    const state = useAgentStore.getState();
    expect(state.auth).toEqual({
      loggedIn: false,
      reason: 'No Claude login was found on this machine.',
      loginCommand: 'npx -y @anthropic-ai/claude-code@latest auth login',
    });
    expect(state.cwd).toBe('/repo/workspace');
    expect(state.model).toBeNull();
  });

  it('asks the sidecar to re-probe on checkAuth()', () => {
    const s = connect();
    useAgentStore.getState().checkAuth();
    expect(s.lastOfType('auth_check')).toEqual({ type: 'auth_check' });
  });
});

describe('transcript', () => {
  it('streams deltas into one assistant turn and finalizes it with blocks', () => {
    const s = connect();
    s.emit({ type: 'run_status', runId: 'r1', status: 'running' });
    s.emit({ type: 'delta', runId: 'r1', text: 'Hello' });
    s.emit({ type: 'delta', runId: 'r1', text: ', world' });

    let transcript = useAgentStore.getState().transcript;
    expect(transcript).toHaveLength(1);
    expect(transcript[0]).toMatchObject({ role: 'assistant', streamingText: 'Hello, world' });
    expect(transcript[0].blocks).toEqual([]);

    s.emit({
      type: 'blocks',
      runId: 'r1',
      role: 'assistant',
      blocks: [{ kind: 'text', text: 'Hello, world' }],
    });

    transcript = useAgentStore.getState().transcript;
    expect(transcript).toHaveLength(1);
    expect(transcript[0].streamingText).toBeUndefined();
    expect(transcript[0].blocks).toEqual([{ kind: 'text', text: 'Hello, world' }]);
  });

  it('appends tool results as their own user turn', () => {
    const s = connect();
    s.emit({
      type: 'blocks',
      runId: 'r1',
      role: 'assistant',
      blocks: [{ kind: 'tool_use', id: 't1', name: 'orbital_read_notebook', input: {} }],
    });
    s.emit({
      type: 'blocks',
      runId: 'r1',
      role: 'user',
      blocks: [{ kind: 'tool_result', toolUseId: 't1', content: '{}', isError: false }],
    });

    const transcript = useAgentStore.getState().transcript;
    expect(transcript.map((i) => i.role)).toEqual(['assistant', 'user']);
  });

  it('clearConversation drops the transcript and the session id', () => {
    const s = connect();
    s.emit({ type: 'delta', runId: 'r1', text: 'hi' });
    s.emit({
      type: 'result',
      runId: 'r1',
      ok: true,
      costUsd: 0.02,
      durationMs: 10,
      numTurns: 1,
      sessionId: 'sess-1',
    });
    expect(useAgentStore.getState().sessionId).toBe('sess-1');

    useAgentStore.getState().clearConversation();
    expect(useAgentStore.getState().transcript).toEqual([]);
    expect(useAgentStore.getState().sessionId).toBeNull();
  });
});

describe('tool round-trip', () => {
  it('runs the executor and answers with the result', async () => {
    const calls: { name: string; input: unknown }[] = [];
    setToolExecutor(async (name, input) => {
      calls.push({ name, input });
      return { path: 'a.ipynb', cells: [] };
    });

    const s = connect();
    s.emit({
      type: 'tool_request',
      requestId: 'q1',
      runId: 'r1',
      name: 'orbital_read_notebook',
      input: {},
    });
    expect(useAgentStore.getState().runStatus).toBe('waiting_tool');

    await tick();
    expect(calls).toEqual([{ name: 'orbital_read_notebook', input: {} }]);
    expect(s.lastOfType('tool_result')).toEqual({
      type: 'tool_result',
      requestId: 'q1',
      ok: true,
      result: { path: 'a.ipynb', cells: [] },
    });
    expect(useAgentStore.getState().runStatus).toBe('running');
  });

  it('reports an executor failure as ok:false with its message', async () => {
    setToolExecutor(async () => {
      throw new Error('No notebook is open in ORBITAL.');
    });

    const s = connect();
    s.emit({
      type: 'tool_request',
      requestId: 'q2',
      runId: 'r1',
      name: 'orbital_run_cell',
      input: { index: 0 },
    });
    await tick();

    expect(s.lastOfType('tool_result')).toEqual({
      type: 'tool_result',
      requestId: 'q2',
      ok: false,
      error: 'No notebook is open in ORBITAL.',
    });
  });
});

describe('permissions', () => {
  function askFor(s: FakeSocket, tool: string, requestId = 'p1'): void {
    s.emit({
      type: 'permission_request',
      requestId,
      runId: 'r1',
      tool,
      input: { index: 0 },
      description: `Run cell 0 on the kernel`,
    });
  }

  it('surfaces a prompt and forwards the answer', () => {
    const s = connect();
    askFor(s, 'orbital_run_cell');

    expect(useAgentStore.getState().runStatus).toBe('waiting_permission');
    expect(useAgentStore.getState().pendingPermission).toMatchObject({
      requestId: 'p1',
      tool: 'orbital_run_cell',
      description: 'Run cell 0 on the kernel',
    });

    useAgentStore.getState().answerPermission(false);
    expect(s.lastOfType('permission')).toMatchObject({ requestId: 'p1', allow: false });
    expect(useAgentStore.getState().pendingPermission).toBeNull();
    expect(useAgentStore.getState().runStatus).toBe('running');
  });

  it('remembers a tool and auto-allows it afterwards', () => {
    const s = connect();
    askFor(s, 'orbital_run_cell');
    useAgentStore.getState().answerPermission(true, true);
    expect(useAgentStore.getState().alwaysAllow).toEqual(['orbital_run_cell']);

    askFor(s, 'orbital_run_cell', 'p2');
    expect(useAgentStore.getState().pendingPermission).toBeNull();
    expect(s.lastOfType('permission')).toEqual({
      type: 'permission',
      requestId: 'p2',
      allow: true,
    });
  });

  it('does not remember a denial', () => {
    const s = connect();
    askFor(s, 'orbital_delete_cell');
    useAgentStore.getState().answerPermission(false, true);
    expect(useAgentStore.getState().alwaysAllow).toEqual([]);
  });
});

describe('send', () => {
  const PATH = 'analysis.ipynb';

  async function openNotebook(): Promise<void> {
    setProviderFactory(() =>
      makeFakeProvider({
        contents: makeFakeContents({
          getNotebook: async () => ({
            nbformat: 4,
            nbformat_minor: 5,
            metadata: {},
            cells: [
              { id: 'c0', cell_type: 'code', source: ['a = 1'], metadata: {}, execution_count: null, outputs: [] },
              { id: 'c1', cell_type: 'code', source: ['b = 2'], metadata: {}, execution_count: null, outputs: [] },
            ],
          }),
        }),
      }),
    );
    await useSessionStore.getState().connect();
    useNotebookStore.setState({ docs: {}, openPaths: [], activePath: null, selectedCellId: null });
    await useNotebookStore.getState().open(PATH);
  }

  afterEach(async () => {
    const store = useNotebookStore.getState();
    for (const path of [...store.openPaths]) await store.close(path);
  });

  it('sends the prompt with the notebook context and records the user turn', async () => {
    await openNotebook();
    const s = connect();

    useAgentStore.getState().send('summarise this notebook');
    const start = s.lastOfType('start');
    expect(start.prompt).toBe('summarise this notebook');
    expect(start.context.notebookPath).toBe(PATH);
    expect(start.context.selectedCellIndex).toBeNull();
    expect(start.sessionId).toBeUndefined();

    expect(useAgentStore.getState().runStatus).toBe('running');
    expect(useAgentStore.getState().transcript[0]).toMatchObject({
      role: 'user',
      blocks: [{ kind: 'text', text: 'summarise this notebook' }],
    });
  });

  it('attaches the selected cell only when that flag is on', async () => {
    await openNotebook();
    useNotebookStore.getState().select('c1');
    const s = connect();

    useAgentStore.getState().setInclude('cell', true);
    useAgentStore.getState().send('explain this');

    const start = s.lastOfType('start');
    expect(start.context.selectedCellIndex).toBe(1);
    expect(start.context.attachment).toContain('b = 2');
  });

  it('omits the notebook entirely when the flag is off', async () => {
    await openNotebook();
    const s = connect();

    useAgentStore.getState().setInclude('notebook', false);
    useAgentStore.getState().send('hello');

    const start = s.lastOfType('start');
    expect(start.context.notebookPath).toBeNull();
    expect(start.context.kernelStatus).toBeNull();
  });

  it('resumes the SDK session on the next prompt', () => {
    const s = connect();
    s.emit({
      type: 'result',
      runId: 'r1',
      ok: true,
      costUsd: 0.01,
      durationMs: 5,
      numTurns: 1,
      sessionId: 'sess-42',
    });
    useAgentStore.getState().send('and now?');
    expect(s.lastOfType('start').sessionId).toBe('sess-42');
  });

  it('refuses a second prompt while a run is in flight', () => {
    const s = connect();
    useAgentStore.getState().send('first');
    const before = s.messages().filter((m) => m.type === 'start').length;
    useAgentStore.getState().send('second');
    expect(s.messages().filter((m) => m.type === 'start')).toHaveLength(before);
    expect(useAgentStore.getState().error).toMatch(/still working/);
  });

  it('interrupts the current run', () => {
    const s = connect();
    useAgentStore.getState().send('long job');
    const runId = useAgentStore.getState().currentRunId;
    useAgentStore.getState().interrupt();
    expect(s.lastOfType('interrupt')).toEqual({ type: 'interrupt', runId });
  });
});

describe('results', () => {
  it('accumulates cost and goes idle on success', () => {
    const s = connect();
    s.emit({ type: 'result', runId: 'r1', ok: true, costUsd: 0.03, durationMs: 120, numTurns: 2 });
    s.emit({ type: 'result', runId: 'r2', ok: true, costUsd: 0.02, durationMs: 60, numTurns: 1 });

    const state = useAgentStore.getState();
    expect(state.lastResult).toEqual({ costUsd: 0.02, durationMs: 60, numTurns: 1 });
    expect(state.totalCostUsd).toBeCloseTo(0.05, 10);
    expect(state.runStatus).toBe('idle');
    expect(state.currentRunId).toBeNull();
  });

  it('surfaces a failed run', () => {
    const s = connect();
    s.emit({
      type: 'result',
      runId: 'r1',
      ok: false,
      costUsd: null,
      durationMs: 0,
      numTurns: 0,
      error: 'Interrupted by the user.',
    });
    expect(useAgentStore.getState().runStatus).toBe('error');
    expect(useAgentStore.getState().error).toBe('Interrupted by the user.');
  });

  it('records a sidecar error against the current run', () => {
    const s = connect();
    useAgentStore.getState().send('go');
    const runId = useAgentStore.getState().currentRunId!;
    s.emit({ type: 'error', runId, message: 'A run is already in progress on this connection.' });
    expect(useAgentStore.getState().runStatus).toBe('error');
    expect(useAgentStore.getState().error).toMatch(/already in progress/);
  });
});

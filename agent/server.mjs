/**
 * ORBITAL agent sidecar.
 *
 * One WebSocket per browser tab (ws://localhost:8787/ws), speaking the
 * protocol in `app/src/agent/protocol.ts`. Each connection may have at most
 * one SDK `query()` in flight; the browser executes every notebook-touching
 * tool and answers over the same socket.
 *
 * Auth is the user's Claude login. This process never reads, stores or asks
 * for a credential: `auth.mjs` only reports whether one works and what to run
 * if it does not.
 *
 * Env:
 *   ORBITAL_AGENT_PORT   default 8787
 *   ORBITAL_WORKSPACE    default <repo>/workspace
 *   ORBITAL_AGENT_FAKE=1 stub the SDK with an in-file scripted run (tests)
 *   ORBITAL_CLAUDE_BIN   override the Claude Code runtime used by the probe
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { claudeBinaryPath, probeAuth, resetAuthCache } from './auth.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

export const PORT = Number(process.env.ORBITAL_AGENT_PORT ?? 8787);
export const WORKSPACE = path.resolve(
  process.env.ORBITAL_WORKSPACE ?? path.join(REPO_ROOT, 'workspace'),
);
const FAKE = process.env.ORBITAL_AGENT_FAKE === '1';

/** Built-in tools the agent may use without asking: all read-only. */
const BUILTIN_READ_TOOLS = ['Read', 'Glob', 'Grep'];

const ORBITAL_SYSTEM_NOTE = [
  'You are working inside ORBITAL, a Jupyter-style notebook application the user is looking at right now.',
  'Prefer the orbital_* tools over the file tools for anything to do with the open notebook: they read, edit and run the cells the user can see, and every change shows up live in their UI.',
  'Call orbital_read_notebook before addressing any cell, because those tools take zero-based cell indices, and read it again after inserting or deleting a cell.',
  'Cells run on a real Jupyter kernel whose state persists between calls, so you can write a cell, run it, read the error and fix it.',
  'Files under the working directory are the user\'s workspace; read them with the normal file tools.',
].join(' ');

/** One line per event. Prompts are never logged, only their size. */
function log(event, detail = {}) {
  const parts = Object.entries(detail)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
  process.stdout.write(`[orbital/agent] ${event}${parts.length ? ' ' + parts.join(' ') : ''}\n`);
}

function errorText(err) {
  return err instanceof Error ? err.message : String(err);
}

// ---- content block mapping ------------------------------------------------

/** Anthropic tool_result content is a string or a list of blocks. */
function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (block?.type === 'text' ? block.text : `[${block?.type ?? 'unknown'}]`))
    .join('\n');
}

/** Maps Anthropic content blocks to the panel's `AgentBlock` subset. */
function mapBlocks(content) {
  if (typeof content === 'string') return [{ kind: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  const blocks = [];
  for (const block of content) {
    switch (block?.type) {
      case 'text':
        blocks.push({ kind: 'text', text: block.text ?? '' });
        break;
      case 'thinking':
        blocks.push({ kind: 'thinking', text: block.thinking ?? '' });
        break;
      case 'redacted_thinking':
        blocks.push({ kind: 'thinking', text: '[redacted thinking]' });
        break;
      case 'tool_use':
        blocks.push({ kind: 'tool_use', id: block.id, name: block.name, input: block.input ?? {} });
        break;
      case 'tool_result':
        blocks.push({
          kind: 'tool_result',
          toolUseId: block.tool_use_id,
          content: toolResultText(block.content),
          isError: Boolean(block.is_error),
        });
        break;
      default:
        break; // images and future block types have no panel rendering yet
    }
  }
  return blocks;
}

/** A one-line, human-readable summary of a tool call for the permission bar. */
function describeTool(tool, input) {
  const bare = tool.startsWith('mcp__orbital__') ? tool.slice('mcp__orbital__'.length) : tool;
  const i = input ?? {};
  switch (bare) {
    case 'orbital_insert_cell':
      return `Insert a new ${i.type ?? 'code'} cell ${i.afterIndex === null || i.afterIndex === undefined ? 'at the top of the notebook' : `after cell ${i.afterIndex}`}`;
    case 'orbital_edit_cell':
      return `Replace the source of cell ${i.index}`;
    case 'orbital_delete_cell':
      return `Delete cell ${i.index}`;
    case 'orbital_run_cell':
      return `Run cell ${i.index} on the kernel`;
    case 'orbital_run_all':
      return 'Run every code cell in the notebook';
    case 'Bash':
      return `Run a shell command: ${String(i.command ?? '').slice(0, 200)}`;
    case 'Write':
      return `Write the file ${i.file_path ?? i.path ?? '(unknown)'}`;
    case 'Edit':
    case 'MultiEdit':
      return `Edit the file ${i.file_path ?? i.path ?? '(unknown)'}`;
    default:
      return `Use the ${bare} tool`;
  }
}

function composePrompt(prompt, context) {
  const lines = [];
  if (context?.notebookPath) lines.push(`Open notebook: ${context.notebookPath}`);
  if (context?.kernelStatus) lines.push(`Kernel status: ${context.kernelStatus}`);
  if (typeof context?.selectedCellIndex === 'number') {
    lines.push(`Cell the user has selected: index ${context.selectedCellIndex}`);
  }
  if (context?.attachment) lines.push('', context.attachment);
  if (!lines.length) return prompt;
  return `<orbital-context>\n${lines.join('\n')}\n</orbital-context>\n\n${prompt}`;
}

// ---- fake SDK (tests) -----------------------------------------------------

/**
 * Scripted stand-in for `query()` under ORBITAL_AGENT_FAKE=1: one streamed
 * delta, one completed assistant turn carrying a tool_use, a real round-trip
 * through the browser for `orbital_read_notebook`, then a result. Exercises
 * every branch of the relay without a model or a login.
 */
async function* fakeQuery({ options, bridge }) {
  const sessionId = 'fake-session-0001';
  yield {
    type: 'system',
    subtype: 'init',
    model: 'fake-model',
    cwd: options.cwd,
    session_id: sessionId,
    tools: [],
  };
  yield {
    type: 'stream_event',
    session_id: sessionId,
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Reading the notebook.' },
    },
  };
  const toolUseId = 'fake-tool-use-1';
  yield {
    type: 'assistant',
    session_id: sessionId,
    message: {
      content: [
        { type: 'text', text: 'Reading the notebook.' },
        { type: 'tool_use', id: toolUseId, name: 'mcp__orbital__orbital_read_notebook', input: {} },
      ],
    },
  };

  let text;
  let isError = false;
  try {
    text = JSON.stringify(await bridge('orbital_read_notebook', {}, 15_000));
  } catch (err) {
    text = errorText(err);
    isError = true;
  }
  yield {
    type: 'user',
    session_id: sessionId,
    message: {
      content: [
        { type: 'tool_result', tool_use_id: toolUseId, content: text, is_error: isError },
      ],
    },
  };
  yield {
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 1,
    num_turns: 1,
    total_cost_usd: 0,
    session_id: sessionId,
    result: 'done',
  };
}

// ---- per-connection state -------------------------------------------------

class Client {
  constructor(socket) {
    this.socket = socket;
    this.id = randomUUID();
    /** The single in-flight run, or null. */
    this.run = null;
    /** requestId -> { resolve, reject, timer } for orbital_* round-trips. */
    this.pendingTools = new Map();
    /** requestId -> { resolve, timer } for permission prompts. */
    this.pendingPermissions = new Map();
    /** Bare tool names the user chose to always allow, for this connection. */
    this.remembered = new Set();
    this.model = null;
  }

  send(message) {
    if (this.socket.readyState !== this.socket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  /** Fails every outstanding round-trip; used when a run ends or dies. */
  settleOutstanding(reason) {
    for (const [, pending] of this.pendingTools) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pendingTools.clear();
    for (const [, pending] of this.pendingPermissions) {
      clearTimeout(pending.timer);
      pending.resolve(false);
    }
    this.pendingPermissions.clear();
  }
}

// ---- run ------------------------------------------------------------------

async function startRun(client, message) {
  const { runId, prompt, context, sessionId } = message;

  if (client.run) {
    client.send({
      type: 'error',
      runId,
      message: 'A run is already in progress on this connection. Interrupt it first.',
    });
    log('start.rejected', { runId, reason: 'busy' });
    return;
  }

  const abortController = new AbortController();
  client.run = { runId, abortController };
  client.send({ type: 'run_status', runId, status: 'running' });
  log('start', {
    runId,
    promptChars: typeof prompt === 'string' ? prompt.length : 0,
    resume: sessionId ? 'yes' : 'no',
    notebook: context?.notebookPath ?? undefined,
  });

  /** Relays one orbital_* call to the browser and waits for its answer. */
  const bridge = (name, input, timeoutMs) =>
    new Promise((resolve, reject) => {
      if (client.run?.runId !== runId) {
        reject(new Error('This run was cancelled.'));
        return;
      }
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        client.pendingTools.delete(requestId);
        reject(new Error(`ORBITAL did not answer ${name} within ${Math.round(timeoutMs / 1000)}s.`));
      }, timeoutMs);
      client.pendingTools.set(requestId, { resolve, reject, timer });
      client.send({ type: 'tool_request', requestId, runId, name, input });
      log('tool.request', { runId, name });
    });

  /** Forwards a permission decision to the browser and waits for the answer. */
  const canUseTool = async (toolName, input, { signal }) => {
    const bare = toolName.startsWith('mcp__orbital__')
      ? toolName.slice('mcp__orbital__'.length)
      : toolName;

    if (client.remembered.has(bare)) {
      log('permission.remembered', { runId, tool: bare });
      return { behavior: 'allow', updatedInput: input };
    }

    const requestId = randomUUID();
    const allowed = await new Promise((resolve) => {
      const timer = setTimeout(
        () => {
          client.pendingPermissions.delete(requestId);
          resolve(false);
        },
        10 * 60 * 1000,
      );
      client.pendingPermissions.set(requestId, { resolve, timer, tool: bare });
      const onAbort = () => {
        const pending = client.pendingPermissions.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        client.pendingPermissions.delete(requestId);
        resolve(false);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      client.send({
        type: 'permission_request',
        requestId,
        runId,
        tool: bare,
        input,
        description: describeTool(toolName, input),
      });
      log('permission.request', { runId, tool: bare });
    });

    log('permission.answer', { runId, tool: bare, allowed });
    return allowed
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: 'The ORBITAL user denied this tool call.' };
  };

  const options = {
    cwd: WORKSPACE,
    permissionMode: 'default',
    includePartialMessages: true,
    abortController,
    canUseTool,
    allowedTools: [
      ...BUILTIN_READ_TOOLS,
      'mcp__orbital__orbital_read_notebook',
      'mcp__orbital__orbital_list_variables',
    ],
    systemPrompt: { type: 'preset', preset: 'claude_code', append: ORBITAL_SYSTEM_NOTE },
    mcpServers: {},
  };
  if (sessionId) options.resume = sessionId;

  let iterator;
  if (FAKE) {
    iterator = fakeQuery({ options, bridge });
  } else {
    const [{ query }, { createOrbitalMcpServer }] = await Promise.all([
      import('@anthropic-ai/claude-agent-sdk'),
      import('./tools.mjs'),
    ]);
    options.mcpServers = { orbital: createOrbitalMcpServer(bridge) };
    iterator = query({ prompt: composePrompt(prompt, context), options });
  }

  let result = null;
  let failure = null;
  try {
    for await (const sdkMessage of iterator) {
      if (client.run?.runId !== runId) break;

      switch (sdkMessage.type) {
        case 'system':
          if (sdkMessage.subtype === 'init') {
            client.model = sdkMessage.model ?? null;
            log('session.init', { runId, model: client.model, session: sdkMessage.session_id });
          }
          break;

        case 'stream_event': {
          const event = sdkMessage.event;
          if (
            event?.type === 'content_block_delta' &&
            event.delta?.type === 'text_delta' &&
            event.delta.text
          ) {
            client.send({ type: 'delta', runId, text: event.delta.text });
          }
          break;
        }

        case 'assistant':
        case 'user': {
          const blocks = mapBlocks(sdkMessage.message?.content);
          if (blocks.length) {
            client.send({ type: 'blocks', runId, role: sdkMessage.type, blocks });
            log('blocks', { runId, role: sdkMessage.type, count: blocks.length });
          }
          break;
        }

        case 'result':
          result = sdkMessage;
          break;

        default:
          break;
      }
    }
  } catch (err) {
    failure = abortController.signal.aborted ? 'Interrupted by the user.' : errorText(err);
    log('run.error', { runId, error: failure });
  }

  client.settleOutstanding('The run ended.');

  const ok = Boolean(result) && !result.is_error && result.subtype === 'success' && !failure;
  const payload = {
    type: 'result',
    runId,
    ok,
    costUsd: result?.total_cost_usd ?? null,
    durationMs: result?.duration_ms ?? 0,
    numTurns: result?.num_turns ?? 0,
  };
  if (result?.session_id) payload.sessionId = result.session_id;
  if (!ok) {
    payload.error =
      failure ??
      (result ? (result.result ?? `The run ended with ${result.subtype}.`) : 'The run produced no result.');
  }

  client.run = null;
  client.send(payload);
  client.send({ type: 'run_status', runId, status: 'idle' });
  log('result', {
    runId,
    ok,
    costUsd: payload.costUsd,
    durationMs: payload.durationMs,
    turns: payload.numTurns,
  });
}

// ---- message handling -----------------------------------------------------

async function sendAuth(client, force) {
  if (force) resetAuthCache();
  const status = await probeAuth({ cwd: WORKSPACE, force });
  client.send({ type: 'auth', status, cwd: WORKSPACE, model: client.model });
  log('auth', { loggedIn: status.loggedIn, reason: status.reason });
}

function handleClientMessage(client, message) {
  switch (message.type) {
    case 'hello':
      log('hello', { client: client.id });
      return;

    case 'auth_check':
      void sendAuth(client, true);
      return;

    case 'start':
      void startRun(client, message).catch((err) => {
        client.run = null;
        client.settleOutstanding('The run failed to start.');
        client.send({ type: 'error', runId: message.runId, message: errorText(err) });
        client.send({ type: 'run_status', runId: message.runId, status: 'error' });
        log('start.failed', { runId: message.runId, error: errorText(err) });
      });
      return;

    case 'interrupt':
      if (client.run && client.run.runId === message.runId) {
        log('interrupt', { runId: message.runId });
        client.run.abortController.abort();
      }
      return;

    case 'tool_result': {
      const pending = client.pendingTools.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      client.pendingTools.delete(message.requestId);
      log('tool.result', { ok: message.ok });
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error ?? 'ORBITAL reported an unknown tool failure.'));
      return;
    }

    case 'permission': {
      const pending = client.pendingPermissions.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      client.pendingPermissions.delete(message.requestId);
      if (message.remember && message.allow) client.remembered.add(pending.tool);
      pending.resolve(Boolean(message.allow));
      return;
    }

    default:
      client.send({ type: 'error', message: `Unknown message type: ${String(message.type)}` });
  }
}

// ---- server ---------------------------------------------------------------

export function createServer({ port = PORT } = {}) {
  const wss = new WebSocketServer({ port, path: '/ws' });

  wss.on('connection', (socket) => {
    const client = new Client(socket);
    log('connect', { client: client.id });
    void sendAuth(client, false);

    socket.on('message', (raw) => {
      let parsed;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        client.send({ type: 'error', message: 'Malformed JSON.' });
        return;
      }
      if (typeof parsed?.type !== 'string') {
        client.send({ type: 'error', message: 'Message has no type.' });
        return;
      }
      try {
        handleClientMessage(client, parsed);
      } catch (err) {
        client.send({ type: 'error', message: errorText(err) });
        log('handler.error', { type: parsed.type, error: errorText(err) });
      }
    });

    socket.on('close', () => {
      client.run?.abortController.abort();
      client.run = null;
      client.settleOutstanding('The ORBITAL tab disconnected.');
      log('disconnect', { client: client.id });
    });

    socket.on('error', (err) => {
      log('socket.error', { client: client.id, error: errorText(err) });
    });
  });

  return wss;
}

/** Only start listening when run directly, so tests can import this file. */
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const wss = createServer();
  wss.on('listening', () => {
    log('listening', {
      url: `ws://localhost:${PORT}/ws`,
      workspace: WORKSPACE,
      runtime: FAKE ? 'fake' : claudeBinaryPath(),
    });
  });
  const shutdown = () => {
    log('shutdown');
    wss.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

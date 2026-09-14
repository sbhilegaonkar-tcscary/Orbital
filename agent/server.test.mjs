/**
 * Sidecar protocol tests: `node --test` from `agent/`.
 *
 * ORBITAL_AGENT_FAKE=1 swaps the SDK for the scripted run inside server.mjs,
 * so this exercises the real WebSocket server, the real message handling and
 * the real browser round-trip without a model or a login. The env var is set
 * before the dynamic import because server.mjs reads it at module load.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';

process.env.ORBITAL_AGENT_FAKE = '1';
const { createServer } = await import('./server.mjs');

const PORT = 8799;
const TIMEOUT = 15_000;

/** A ws client with a `next()` that yields one parsed message at a time. */
function connect(port) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const queue = [];
  const waiters = [];

  ws.on('message', (raw) => {
    const message = JSON.parse(String(raw));
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else queue.push(message);
  });

  return {
    ready: new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    }),
    next: () =>
      queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve) => waiters.push(resolve)),
    send: (message) => ws.send(JSON.stringify(message)),
    close: () => ws.close(),
  };
}

/** Reads messages until one of `type` arrives, returning it. */
async function until(client, type) {
  for (let i = 0; i < 50; i += 1) {
    const message = await client.next();
    if (message.type === type) return message;
  }
  throw new Error(`never saw a ${type} message`);
}

function withServer(port, body) {
  return async () => {
    const wss = createServer({ port });
    await new Promise((resolve) => wss.once('listening', resolve));
    try {
      await body();
    } finally {
      await new Promise((resolve) => wss.close(resolve));
    }
  };
}

test(
  'a run streams delta, blocks, a tool round-trip and a result',
  { timeout: TIMEOUT },
  withServer(PORT, async () => {
    const client = connect(PORT);
    await client.ready;

    const auth = await until(client, 'auth');
    assert.equal(auth.type, 'auth');
    assert.equal(typeof auth.status.loggedIn, 'boolean');
    assert.ok(auth.status.loginCommand.length > 0);
    assert.ok(auth.cwd.length > 0);

    client.send({ type: 'hello', clientId: 'test-client' });
    client.send({
      type: 'start',
      runId: 'run-1',
      prompt: 'what is in this notebook?',
      context: { notebookPath: 'demo.ipynb', selectedCellIndex: null, kernelStatus: 'idle' },
    });

    const running = await client.next();
    assert.deepEqual(running, { type: 'run_status', runId: 'run-1', status: 'running' });

    const delta = await client.next();
    assert.equal(delta.type, 'delta');
    assert.equal(delta.runId, 'run-1');
    assert.equal(delta.text, 'Reading the notebook.');

    const assistant = await client.next();
    assert.equal(assistant.type, 'blocks');
    assert.equal(assistant.role, 'assistant');
    assert.deepEqual(assistant.blocks[0], { kind: 'text', text: 'Reading the notebook.' });
    assert.equal(assistant.blocks[1].kind, 'tool_use');
    assert.equal(assistant.blocks[1].name, 'mcp__orbital__orbital_read_notebook');

    const request = await client.next();
    assert.equal(request.type, 'tool_request');
    assert.equal(request.runId, 'run-1');
    assert.equal(request.name, 'orbital_read_notebook');
    assert.ok(request.requestId);

    client.send({
      type: 'tool_result',
      requestId: request.requestId,
      ok: true,
      result: { path: 'demo.ipynb', cells: [{ index: 0, type: 'code', source: 'x=1', outputsText: '' }] },
    });

    const toolTurn = await client.next();
    assert.equal(toolTurn.type, 'blocks');
    assert.equal(toolTurn.role, 'user');
    assert.equal(toolTurn.blocks[0].kind, 'tool_result');
    assert.equal(toolTurn.blocks[0].isError, false);
    assert.match(toolTurn.blocks[0].content, /demo\.ipynb/);

    const result = await client.next();
    assert.equal(result.type, 'result');
    assert.equal(result.ok, true);
    assert.equal(result.numTurns, 1);
    assert.equal(result.sessionId, 'fake-session-0001');

    const idle = await client.next();
    assert.deepEqual(idle, { type: 'run_status', runId: 'run-1', status: 'idle' });

    client.close();
  }),
);

test(
  'a tool failure is relayed back to the model as an error result',
  { timeout: TIMEOUT },
  withServer(PORT + 1, async () => {
    const client = connect(PORT + 1);
    await client.ready;
    await until(client, 'auth');

    client.send({
      type: 'start',
      runId: 'run-2',
      prompt: 'read it',
      context: { notebookPath: null, selectedCellIndex: null },
    });

    const request = await until(client, 'tool_request');
    client.send({
      type: 'tool_result',
      requestId: request.requestId,
      ok: false,
      error: 'No notebook is open in ORBITAL.',
    });

    const toolTurn = await until(client, 'blocks');
    assert.equal(toolTurn.role, 'user');
    assert.equal(toolTurn.blocks[0].isError, true);
    assert.match(toolTurn.blocks[0].content, /No notebook is open/);

    const result = await until(client, 'result');
    assert.equal(result.ok, true); // the run itself completed; only the tool failed

    client.close();
  }),
);

test(
  'a second start on the same connection is rejected while one is running',
  { timeout: TIMEOUT },
  withServer(PORT + 2, async () => {
    const client = connect(PORT + 2);
    await client.ready;
    await until(client, 'auth');

    client.send({
      type: 'start',
      runId: 'run-3',
      prompt: 'first',
      context: { notebookPath: null, selectedCellIndex: null },
    });
    const request = await until(client, 'tool_request');

    // The first run is parked waiting for this tool result.
    client.send({
      type: 'start',
      runId: 'run-4',
      prompt: 'second',
      context: { notebookPath: null, selectedCellIndex: null },
    });

    const error = await until(client, 'error');
    assert.equal(error.runId, 'run-4');
    assert.match(error.message, /already in progress/);

    client.send({ type: 'tool_result', requestId: request.requestId, ok: true, result: {} });
    const result = await until(client, 'result');
    assert.equal(result.runId, 'run-3');

    client.close();
  }),
);

test(
  'auth_check re-probes and answers with a status',
  { timeout: TIMEOUT },
  withServer(PORT + 3, async () => {
    const client = connect(PORT + 3);
    await client.ready;
    await until(client, 'auth');

    client.send({ type: 'auth_check' });
    const again = await until(client, 'auth');
    assert.equal(typeof again.status.loggedIn, 'boolean');
    assert.ok(again.status.loginCommand.length > 0);

    client.close();
  }),
);

test(
  'a malformed message is answered, not fatal',
  { timeout: TIMEOUT },
  withServer(PORT + 4, async () => {
    const client = connect(PORT + 4);
    await client.ready;
    await until(client, 'auth');

    client.send({ what: 'no type here' });
    const error = await until(client, 'error');
    assert.match(error.message, /no type/i);

    client.close();
  }),
);

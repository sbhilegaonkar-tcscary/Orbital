/**
 * Live integration test for the session layer. It talks to a real Jupyter
 * Server (scripts/jupyter.sh) and skips cleanly when none is reachable, so CI
 * without a server stays green.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocketImpl from 'ws';

import { JupyterSessionProvider } from './jupyter';
import type { CellOutput, ExecutionResult, KernelSession } from './types';

const BASE_URL = process.env.ORBITAL_TEST_URL ?? 'http://127.0.0.1:8888';
const TOKEN = process.env.ORBITAL_TEST_TOKEN ?? 'orbital-dev';
const NOTEBOOK = 'hull-stress-analysis.ipynb';

async function serverIsUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/status?token=${encodeURIComponent(TOKEN)}`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function newProvider(): JupyterSessionProvider {
  return new JupyterSessionProvider({
    WebSocket: WebSocketImpl as unknown as typeof WebSocket,
    fetch: globalThis.fetch as unknown as (
      input: RequestInfo,
      init?: RequestInit,
    ) => Promise<Response>,
  });
}

interface RunResult {
  outputs: CellOutput[];
  counts: number[];
  status: ExecutionResult | null;
}

async function run(session: KernelSession, code: string): Promise<RunResult> {
  const result: RunResult = { outputs: [], counts: [], status: null };
  const handle = session.execute(code, {
    onOutput: (out) => result.outputs.push(out),
    onExecutionCount: (n) => result.counts.push(n),
    onDone: (s) => {
      result.status = s;
    },
  });
  await handle.done;
  return result;
}

const SERVER_UP = await serverIsUp();

if (!SERVER_UP) {
  describe('JupyterSessionProvider (live server)', () => {
    it.skip(`skipped: no Jupyter Server reachable at ${BASE_URL} (start scripts/jupyter.sh)`, () => {
      /* intentionally empty */
    });
  });
}

const describeLive = SERVER_UP ? describe : describe.skip;

describeLive('JupyterSessionProvider (live server)', () => {
  let provider: JupyterSessionProvider;
  let session: KernelSession | null = null;

  beforeAll(async () => {
    provider = newProvider();
    await provider.connect({ baseUrl: BASE_URL, token: TOKEN });
  });

  afterAll(async () => {
    if (session) {
      await session.shutdown().catch(() => undefined);
      session = null;
    }
    await provider.disconnect().catch(() => undefined);
  });

  it('connects and lists kernelspecs including python3', async () => {
    const specs = await provider.listKernelSpecs();
    expect(specs.length).toBeGreaterThan(0);
    const python = specs.find((s) => s.name === 'python3');
    expect(python).toBeDefined();
    expect(python?.language).toBe('python');
    expect(python?.displayName.length).toBeGreaterThan(0);
  });

  it('rejects a bad token with a message that mentions the token', async () => {
    const bad = newProvider();
    await expect(bad.connect({ baseUrl: BASE_URL, token: 'not-the-token' })).rejects.toThrow(
      /token/i,
    );
  });

  it('rejects an unreachable URL with a message that mentions the URL', async () => {
    const bad = newProvider();
    const url = 'http://127.0.0.1:8/';
    await expect(bad.connect({ baseUrl: url, token: TOKEN })).rejects.toThrow(/127\.0\.0\.1:8/);
  });

  it('lists workspace contents including the notebook', async () => {
    const entries = await provider.contents.list('');
    const nb = entries.find((e) => e.name === NOTEBOOK);
    expect(nb).toBeDefined();
    expect(nb?.type).toBe('notebook');
    expect(nb?.path).toBe(NOTEBOOK);
    expect(typeof nb?.lastModified).toBe('string');
  });

  it('reads the notebook as raw nbformat', async () => {
    const nb = (await provider.contents.getNotebook(NOTEBOOK)) as {
      nbformat: number;
      cells: unknown[];
    };
    expect(nb.nbformat).toBe(4);
    expect(Array.isArray(nb.cells)).toBe(true);
  });

  it('opens a kernel session on the notebook', async () => {
    session = await provider.openNotebookSession(NOTEBOOK);
    expect(session.path).toBe(NOTEBOOK);
    expect(session.kernelName.length).toBeGreaterThan(0);
    expect(['idle', 'busy', 'starting', 'connecting']).toContain(session.status);
  });

  it('executes code and reports stream, execute_result, count and ok', async () => {
    expect(session).not.toBeNull();
    const seen: ExecutionResult[] = [];
    const off = session!.onStatus(() => undefined);

    const result = await run(session!, 'print("hi"); 1+1');
    off();
    seen.push(result.status!);

    const stream = result.outputs.find((o) => o.type === 'stream');
    expect(stream).toBeDefined();
    expect(stream && stream.type === 'stream' && stream.name).toBe('stdout');
    expect(stream && stream.type === 'stream' ? stream.text : '').toContain('hi');

    const value = result.outputs.find((o) => o.type === 'execute_result');
    expect(value).toBeDefined();
    if (value && value.type === 'execute_result') {
      expect(value.data['text/plain']).toBe('2');
    }

    expect(result.counts.length).toBeGreaterThan(0);
    expect(result.counts[0]).toBeGreaterThanOrEqual(1);
    expect(seen).toEqual(['ok']);
  });

  it('reports errors as an error output and onDone("error")', async () => {
    expect(session).not.toBeNull();
    const result = await run(session!, 'raise ValueError("x")');

    const err = result.outputs.find((o) => o.type === 'error');
    expect(err).toBeDefined();
    if (err && err.type === 'error') {
      expect(err.ename).toBe('ValueError');
      expect(err.evalue).toBe('x');
      expect(err.traceback.length).toBeGreaterThan(0);
    }
    expect(result.status).toBe('error');
  });

  it('completes a partial import with numpy', async () => {
    expect(session).not.toBeNull();
    const code = 'import nump';
    const result = await session!.complete(code, code.length);

    expect(result.items.map((i) => i.label)).toContain('numpy');
    expect(result.cursorStart).toBeLessThanOrEqual(result.cursorEnd);
    expect(result.cursorEnd).toBe(code.length);
  });

  it('returns an empty completion rather than throwing on a hopeless prefix', async () => {
    expect(session).not.toBeNull();
    const code = 'zzzz_not_a_name_';
    const result = await session!.complete(code, code.length);
    expect(Array.isArray(result.items)).toBe(true);
  });

  it('inspects a builtin and returns text/plain documentation', async () => {
    expect(session).not.toBeNull();
    const result = await session!.inspect('len', 3);

    expect(result.found).toBe(true);
    expect(typeof result.data['text/plain']).toBe('string');
    expect(result.data['text/plain']).toContain('len');
  });

  it('executeSilent streams output without advancing the execution counter', async () => {
    expect(session).not.toBeNull();
    const before = await run(session!, '1');
    const silent = await session!.executeSilent('print(7)');
    const after = await run(session!, '1');

    expect(silent.status).toBe('ok');
    const stream = silent.outputs.find((o) => o.type === 'stream');
    expect(stream).toBeDefined();
    expect(stream && stream.type === 'stream' ? stream.text : '').toContain('7');

    // store_history=false, so the counter moves by exactly one visible run.
    expect(after.counts[0]).toBe(before.counts[0] + 1);
  });

  it('keeps onStatus firing across changeKernel', async () => {
    expect(session).not.toBeNull();
    const seen: string[] = [];
    const off = session!.onStatus((s) => seen.push(s));

    await session!.changeKernel('python3');
    const result = await run(session!, '1+1');
    off();

    expect(result.status).toBe('ok');
    expect(session!.kernelName).toBe('python3');
    expect(seen).toContain('busy');
    expect(seen).toContain('idle');
  });

  it('reuses the existing session for the same path', async () => {
    expect(session).not.toBeNull();
    const again = await provider.openNotebookSession(NOTEBOOK);
    expect(again.path).toBe(NOTEBOOK);
    // Same kernel: the execution counter keeps climbing rather than resetting.
    const result = await run(again, '2+2');
    expect(result.counts[0]).toBeGreaterThan(1);
    expect(result.status).toBe('ok');
  });

  it('shuts the session down and leaves no kernels running', async () => {
    expect(session).not.toBeNull();
    await session!.shutdown();
    session = null;

    const res = await fetch(`${BASE_URL}/api/sessions?token=${encodeURIComponent(TOKEN)}`);
    const running = (await res.json()) as { path: string }[];
    expect(running.some((s) => s.path === NOTEBOOK)).toBe(false);
  });
});

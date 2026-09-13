/**
 * Live integration test for the inspector snippet. Talks to a real Jupyter
 * Server and skips cleanly when none is reachable, mirroring
 * `session/jupyter.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocketImpl from 'ws';

import { JupyterSessionProvider } from '../session/jupyter';
import type { ExecutionResult, KernelSession } from '../session/types';
import { INSPECT_SNIPPET } from './snippet';
import { parseInspectOutput } from './parse';

const BASE_URL = process.env.ORBITAL_TEST_URL ?? 'http://127.0.0.1:8888';
const TOKEN = process.env.ORBITAL_TEST_TOKEN ?? 'orbital-dev';
const NOTEBOOK = 'orbital-inspector-live-test.ipynb';

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

async function run(session: KernelSession, code: string): Promise<ExecutionResult> {
  let status: ExecutionResult | null = null;
  const handle = session.execute(code, {
    onOutput: () => undefined,
    onExecutionCount: () => undefined,
    onDone: (s) => {
      status = s;
    },
  });
  await handle.done;
  return status!;
}

const SERVER_UP = await serverIsUp();

if (!SERVER_UP) {
  describe('INSPECT_SNIPPET (live server)', () => {
    it.skip(`skipped: no Jupyter Server reachable at ${BASE_URL} (start scripts/jupyter.sh)`, () => {
      /* intentionally empty */
    });
  });
}

const describeLive = SERVER_UP ? describe : describe.skip;

describeLive('INSPECT_SNIPPET (live server)', () => {
  let provider: JupyterSessionProvider;
  let session: KernelSession | null = null;

  beforeAll(async () => {
    provider = newProvider();
    await provider.connect({ baseUrl: BASE_URL, token: TOKEN });
    session = await provider.openNotebookSession(NOTEBOOK);
  });

  afterAll(async () => {
    if (session) {
      await session.shutdown().catch(() => undefined);
      session = null;
    }
    await provider.disconnect().catch(() => undefined);
  });

  it('reports numpy arrays, strings, ints and modules from the live kernel', async () => {
    expect(session).not.toBeNull();

    const setupStatus = await run(session!, "import numpy as np; x = np.zeros((3,4)); s = 'hi'; n = 42");
    expect(setupStatus).toBe('ok');

    const result = await session!.executeSilent(INSPECT_SNIPPET);
    expect(result.status).toBe('ok');

    const variables = parseInspectOutput(result.outputs);
    const byName = Object.fromEntries(variables.map((v) => [v.name, v]));

    expect(byName.x).toBeDefined();
    expect(byName.x.shape).toEqual([3, 4]);

    expect(byName.s).toBeDefined();
    expect(byName.s.type).toBe('str');
    expect(byName.s.length).toBeNull();

    expect(byName.n).toBeDefined();
    expect(byName.n.repr).toBe('42');

    expect(byName.np).toBeDefined();
    expect(byName.np.type).toBe('module');
  });
});

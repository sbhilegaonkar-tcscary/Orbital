/**
 * Live integration test for the session layer. It talks to a real Jupyter
 * Server (scripts/jupyter.sh) and skips cleanly when none is reachable, so CI
 * without a server stays green.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { File as NodeFile } from 'node:buffer';
import WebSocketImpl from 'ws';

import { JupyterSessionProvider } from './jupyter';
import type { CellOutput, ExecutionResult, KernelSession, TerminalsApi } from './types';

// Node 18 keeps File in node:buffer instead of on globalThis, and
// @jupyterlab/services' contents save path does `content instanceof File`.
// Node 20+ and every browser already have the global; this only fills the gap.
if (typeof globalThis.File === 'undefined') {
  (globalThis as { File?: unknown }).File = NodeFile;
}

const BASE_URL = process.env.ORBITAL_TEST_URL ?? 'http://127.0.0.1:8888';
const TOKEN = process.env.ORBITAL_TEST_TOKEN ?? 'orbital-dev';
/** Read-only fixture: contents assertions only, never a kernel session. */
const NOTEBOOK = 'hull-stress-analysis.ipynb';
/**
 * Scratch notebook for the kernel-session tests. Jupyter keys sessions by
 * path, so sharing NOTEBOOK with completion.test.ts meant one file's teardown
 * shut down the other file's kernel; vitest runs the two in parallel.
 */
const SESSION_NOTEBOOK = 'orbital-session-test.ipynb';
const EMPTY_NOTEBOOK = { nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [] };

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

interface DisplayUpdate {
  displayId: string;
  data: Record<string, string>;
  metadata?: Record<string, unknown>;
}

interface RunResult {
  outputs: CellOutput[];
  counts: number[];
  status: ExecutionResult | null;
  /** Every clear_output, in arrival order. */
  clears: boolean[];
  updates: DisplayUpdate[];
  /**
   * Interleaved log of the three iopub kinds the notebook reacts to:
   * `out:<type>`, `clear:<wait>`, `update:<displayId>`. Ordering assertions
   * need this; the split arrays above cannot express "between the two streams".
   */
  events: string[];
}

async function run(session: KernelSession, code: string): Promise<RunResult> {
  const result: RunResult = {
    outputs: [],
    counts: [],
    status: null,
    clears: [],
    updates: [],
    events: [],
  };
  const handle = session.execute(code, {
    onOutput: (out) => {
      result.outputs.push(out);
      result.events.push(`out:${out.type}`);
    },
    onClearOutput: (wait) => {
      result.clears.push(wait);
      result.events.push(`clear:${wait}`);
    },
    onUpdateDisplay: (displayId, data, metadata) => {
      result.updates.push({ displayId, data, metadata });
      result.events.push(`update:${displayId}`);
    },
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
    // saveNotebook, not createNotebook: idempotent if a previous run crashed
    // before its teardown.
    await provider.contents.saveNotebook(SESSION_NOTEBOOK, EMPTY_NOTEBOOK);
  });

  afterAll(async () => {
    if (session) {
      await session.shutdown().catch(() => undefined);
      session = null;
    }
    await provider.contents.delete(SESSION_NOTEBOOK).catch(() => undefined);
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
    session = await provider.openNotebookSession(SESSION_NOTEBOOK);
    expect(session.path).toBe(SESSION_NOTEBOOK);
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

  it('reports clear_output(wait=True) between the two streams', async () => {
    expect(session).not.toBeNull();
    const result = await run(
      session!,
      'from IPython.display import clear_output\nprint("a")\nclear_output(wait=True)\nprint("b")',
    );

    expect(result.status).toBe('ok');
    expect(result.clears).toEqual([true]);

    const clearAt = result.events.indexOf('clear:true');
    expect(clearAt).toBeGreaterThan(-1);
    // A stream before the clear, and another after it: the store needs that
    // ordering to know which outputs the deferred clear throws away.
    expect(result.events.slice(0, clearAt)).toContain('out:stream');
    expect(result.events.slice(clearAt + 1)).toContain('out:stream');

    const streams = result.outputs.filter((o) => o.type === 'stream');
    expect(streams.length).toBeGreaterThanOrEqual(2);
    const text = streams.map((o) => (o.type === 'stream' ? o.text : '')).join('');
    expect(text).toContain('a');
    expect(text).toContain('b');
  });

  it('tags display_data with its display_id and reports update_display_data', async () => {
    expect(session).not.toBeNull();
    const result = await run(
      session!,
      'from IPython.display import display, update_display\n' +
        'h = display("x", display_id=True)\n' +
        'update_display("y", display_id=h.display_id)',
    );

    expect(result.status).toBe('ok');

    const shown = result.outputs.find((o) => o.type === 'display_data');
    expect(shown).toBeDefined();
    if (!shown || shown.type !== 'display_data') throw new Error('no display_data');
    expect(typeof shown.displayId).toBe('string');
    expect(shown.displayId!.length).toBeGreaterThan(0);
    expect(shown.data['text/plain']).toContain('x');

    expect(result.updates.length).toBe(1);
    expect(result.updates[0].displayId).toBe(shown.displayId);
    expect(result.updates[0].data['text/plain']).toContain('y');
    // The update is not an output: it replaces one that is already on screen.
    expect(result.events.indexOf('out:display_data')).toBeLessThan(
      result.events.indexOf(`update:${shown.displayId}`),
    );
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
    const again = await provider.openNotebookSession(SESSION_NOTEBOOK);
    expect(again.path).toBe(SESSION_NOTEBOOK);
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
    expect(running.some((s) => s.path === SESSION_NOTEBOOK)).toBe(false);
  });
});

function fakeFile(name: string, type: string, body: BlobPart): File {
  return new File([body], name, { type });
}

describeLive('contents (live server)', () => {
  let provider: JupyterSessionProvider;
  let dir = '';

  beforeAll(async () => {
    provider = newProvider();
    await provider.connect({ baseUrl: BASE_URL, token: TOKEN });
    dir = await provider.contents.createDirectory('', `orbital-m6-${Date.now()}`);
  });

  afterAll(async () => {
    // Best-effort teardown: the directory must be empty, so sweep it first.
    try {
      for (const entry of await provider.contents.list(dir)) {
        await provider.contents.delete(entry.path).catch(() => undefined);
      }
      await provider.contents.delete(dir);
    } catch {
      /* leave it; the next run makes a fresh directory anyway */
    }
    await provider.disconnect().catch(() => undefined);
  });

  it('creates a directory at the requested name', async () => {
    expect(dir).toMatch(/^orbital-m6-\d+$/);
    const entries = await provider.contents.list('');
    const found = entries.find((e) => e.path === dir);
    expect(found?.type).toBe('directory');
  });

  it('creates a text file and round-trips its content', async () => {
    const path = await provider.contents.createFile(dir, 'notes.txt');
    expect(path).toBe(`${dir}/notes.txt`);
    expect(await provider.contents.getFile(path)).toBe('');

    await provider.contents.saveFile(path, 'line one\nline two\n');
    expect(await provider.contents.getFile(path)).toBe('line one\nline two\n');
  });

  it('renames and deletes', async () => {
    const path = await provider.contents.createFile(dir, 'before.txt');
    await provider.contents.saveFile(path, 'kept');

    const after = `${dir}/after.txt`;
    await provider.contents.rename(path, after);
    expect(await provider.contents.getFile(after)).toBe('kept');
    expect((await provider.contents.list(dir)).some((e) => e.path === path)).toBe(false);

    await provider.contents.delete(after);
    expect((await provider.contents.list(dir)).some((e) => e.path === after)).toBe(false);
  });

  it('uploads text as text and other types as base64', async () => {
    const text = await provider.contents.upload(dir, fakeFile('up.md', 'text/markdown', '# hi\n'));
    expect(text).toBe(`${dir}/up.md`);
    expect(await provider.contents.getFile(text)).toBe('# hi\n');

    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const binary = await provider.contents.upload(
      dir,
      fakeFile('blob.bin', 'application/octet-stream', bytes),
    );
    expect(binary).toBe(`${dir}/blob.bin`);
    // The seam has no binary getter, so getFile must refuse. Jupyter Server
    // rejects the text read itself ("not UTF-8 encoded"); the provider's own
    // format guard is the fallback for servers that answer with base64 anyway.
    await expect(provider.contents.getFile(binary)).rejects.toThrow(
      /not UTF-8 encoded|not a text file/i,
    );

    const res = await fetch(
      `${BASE_URL}/api/contents/${binary}?token=${encodeURIComponent(TOKEN)}`,
    );
    const model = (await res.json()) as { format: string; content: string };
    expect(model.format).toBe('base64');
    expect(Buffer.from(model.content, 'base64')).toEqual(Buffer.from(bytes));
  });
});

/**
 * Jupyter Server answers DELETE /api/terminals/<name> with 204 while pywinpty
 * is still tearing the shell down, so on Windows the name lingers in the
 * running list for a second or two. Poll rather than assert once.
 */
async function namesUntil(
  terminals: TerminalsApi,
  predicate: (names: string[]) => boolean,
  label: string,
  timeoutMs = 8000,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  let names = await terminals.list();
  while (!predicate(names) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    names = await terminals.list();
  }
  if (!predicate(names)) throw new Error(`${label}; running terminals: ${JSON.stringify(names)}`);
  return names;
}

describeLive('terminals (live server)', () => {
  let provider: JupyterSessionProvider;

  beforeAll(async () => {
    provider = newProvider();
    await provider.connect({ baseUrl: BASE_URL, token: TOKEN });
  });

  afterAll(async () => {
    await provider.disconnect().catch(() => undefined);
  });

  it('starts a shell, echoes input back, then shuts down', async () => {
    const term = await provider.terminals.start();
    expect(term.name.length).toBeGreaterThan(0);
    expect(await provider.terminals.list()).toContain(term.name);

    let buffer = '';
    const seen = new Promise<void>((resolve) => {
      const off = term.onData((chunk) => {
        buffer += chunk;
        if (buffer.includes('hi')) {
          off();
          resolve();
        }
      });
    });

    term.resize(80, 24);
    term.send('echo hi\r');

    await Promise.race([
      seen,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`no "hi" in 5s; saw: ${JSON.stringify(buffer)}`)), 5000),
      ),
    ]);
    expect(buffer).toContain('hi');

    await term.shutdown();
    await namesUntil(
      provider.terminals,
      (names) => !names.includes(term.name),
      `terminal ${term.name} outlived shutdown()`,
    );
  });

  it('connect() attaches to an existing terminal and disconnect() leaves it running', async () => {
    const started = await provider.terminals.start();
    const again = await provider.terminals.connect(started.name);
    expect(again.name).toBe(started.name);

    const closed = new Promise<void>((resolve) => again.onClose(() => resolve()));
    again.disconnect();
    await closed;

    // The server-side shell survives a client disconnect.
    expect(await provider.terminals.list()).toContain(started.name);

    await started.shutdown();
    await namesUntil(
      provider.terminals,
      (names) => !names.includes(started.name),
      `terminal ${started.name} outlived shutdown()`,
    );
  });
});

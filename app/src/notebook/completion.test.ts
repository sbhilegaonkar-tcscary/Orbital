import { describe, expect, it } from 'vitest';
import { afterAll, beforeAll } from 'vitest';
import WebSocketImpl from 'ws';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';

import { mapCompletionResult, completeFromKernel } from './completion';
import type { CompletionResult } from '../session/types';
import { JupyterSessionProvider } from '../session/jupyter';
import { setProviderFactory, useSessionStore } from '../session/store';
import { useNotebookStore } from './store';

describe('mapCompletionResult', () => {
  it('maps items and clamps from/to to the current doc length', () => {
    const result: CompletionResult = {
      cursorStart: 3,
      cursorEnd: 100,
      items: [
        { label: 'array', type: 'function' },
        { label: 'numpy', type: 'module' },
        { label: 'MyClass', type: 'class' },
        { label: 'x', type: 'instance' },
        { label: 'pass', type: 'statement' },
        { label: 'import', type: 'keyword' },
        { label: 'n', type: 'param' },
        { label: 'weird', type: 'something-unmapped' },
        { label: 'bare' },
      ],
    };

    const mapped = mapCompletionResult(result, 10);
    expect(mapped).not.toBeNull();
    expect(mapped!.from).toBe(3);
    expect(mapped!.to).toBe(10); // clamped from 100 down to doc length

    const types = Object.fromEntries(mapped!.options.map((o) => [o.label, o.type]));
    expect(types.array).toBe('function');
    expect(types.numpy).toBe('namespace');
    expect(types.MyClass).toBe('class');
    expect(types.x).toBe('variable');
    expect(types.pass).toBe('variable');
    expect(types.import).toBe('keyword');
    expect(types.n).toBe('property');
    expect(types.weird).toBeUndefined();
    expect(types.bare).toBeUndefined();
  });

  it('clamps a cursorStart/cursorEnd pair that both exceed doc length', () => {
    const result: CompletionResult = { cursorStart: 50, cursorEnd: 60, items: [{ label: 'x' }] };
    const mapped = mapCompletionResult(result, 5);
    expect(mapped).not.toBeNull();
    expect(mapped!.from).toBe(5);
    expect(mapped!.to).toBe(5);
  });

  it('keeps to >= from even if the raw range is inverted by clamping', () => {
    const result: CompletionResult = { cursorStart: 4, cursorEnd: 4, items: [{ label: 'x' }] };
    const mapped = mapCompletionResult(result, 2);
    expect(mapped).not.toBeNull();
    expect(mapped!.from).toBe(2);
    expect(mapped!.to).toBe(2);
  });

  it('returns null for an empty result', () => {
    const result: CompletionResult = { cursorStart: 0, cursorEnd: 0, items: [] };
    expect(mapCompletionResult(result, 0)).toBeNull();
  });
});

// --- Live test: drives completeFromKernel through a real kernel session. ---

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

const SERVER_UP = await serverIsUp();

if (!SERVER_UP) {
  describe('completeFromKernel (live server)', () => {
    it.skip(`skipped: no Jupyter Server reachable at ${BASE_URL} (start scripts/jupyter.sh)`, () => {
      /* intentionally empty */
    });
  });
}

const describeLive = SERVER_UP ? describe : describe.skip;

describeLive('completeFromKernel (live server)', () => {
  beforeAll(async () => {
    // Wires the real provider through the real stores, exactly like the app
    // does, so getActiveSession() (which completion.ts calls) resolves to a
    // genuine kernel session for the active notebook.
    const provider = new JupyterSessionProvider({
      WebSocket: WebSocketImpl as unknown as typeof WebSocket,
      fetch: globalThis.fetch as unknown as (
        input: RequestInfo,
        init?: RequestInit,
      ) => Promise<Response>,
    });
    setProviderFactory(() => provider);
    useSessionStore.getState().setConfig({ baseUrl: BASE_URL, token: TOKEN });
    await useSessionStore.getState().connect();
    await useNotebookStore.getState().open(NOTEBOOK);
  });

  afterAll(async () => {
    await useNotebookStore.getState().close(NOTEBOOK).catch(() => undefined);
    await useSessionStore.getState().disconnect().catch(() => undefined);
    setProviderFactory();
  });

  it('returns a numpy array completion for "np.arr"', async () => {
    const doc = 'import numpy as np\nnp.arr';
    const state = EditorState.create({ doc, selection: { anchor: doc.length } });
    const context = new CompletionContext(state, doc.length, false);

    const result = await completeFromKernel(context);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels.some((l) => l === 'array' || l.startsWith('arr'))).toBe(true);
  });
});

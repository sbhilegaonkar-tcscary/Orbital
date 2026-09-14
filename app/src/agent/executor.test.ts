/**
 * Executor tests. No sidecar and no server: a fake SessionProvider from
 * `session/testing.ts` backs the notebook store, and the tools are driven
 * exactly as the agent store drives them — by name, with a JSON input object.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setProviderFactory, useSessionStore } from '../session/store';
import {
  FakeSession,
  makeFakeContents,
  makeFakeProvider,
  makeFakeSession,
} from '../session/testing';
import type { SessionProvider } from '../session/types';
import { useNotebookStore } from '../notebook/store';
import { useInspectorStore } from '../inspector/store';
import { executeOrbitalTool, MAX_OUTPUT_CHARS, outputsToText } from './executor';

const PATH = 'notes.ipynb';

function rawNotebook(): unknown {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { kernelspec: { name: 'python3', display_name: 'Python 3', language: 'python' } },
    cells: [
      { id: 'c0', cell_type: 'code', source: ['x = 1'], metadata: {}, execution_count: null, outputs: [] },
      { id: 'c1', cell_type: 'markdown', source: ['# Notes'], metadata: {} },
      { id: 'c2', cell_type: 'code', source: ['y = 2'], metadata: {}, execution_count: null, outputs: [] },
    ],
  };
}

let sessions: Map<string, FakeSession>;

function makeProvider(): SessionProvider {
  sessions = new Map();
  return makeFakeProvider({
    openNotebookSession: async (path: string, kernelName?: string) => {
      const session = makeFakeSession(path, kernelName ?? 'python3');
      sessions.set(path, session);
      return session;
    },
    contents: makeFakeContents({ getNotebook: async () => rawNotebook() }),
  });
}

interface ReadResult {
  path: string;
  cells: { index: number; type: string; source: string; outputsText: string }[];
}

interface RunResult {
  status: string;
  outputsText: string;
  executionCount: number | null;
}

beforeEach(async () => {
  setProviderFactory(makeProvider);
  await useSessionStore.getState().connect();
  useNotebookStore.setState({
    docs: {},
    dirty: {},
    openPaths: [],
    activePath: null,
    selectedCellId: null,
    loading: false,
    error: null,
    clipboard: null,
    lastDeleted: null,
    kernelSpecs: [],
  });
  useInspectorStore.setState({ variables: [], refreshing: false, error: null, filter: '' });
});

afterEach(async () => {
  const store = useNotebookStore.getState();
  for (const path of [...store.openPaths]) await store.close(path);
  setProviderFactory();
});

describe('without a notebook', () => {
  it('refuses every tool with a message the model can act on', async () => {
    await expect(executeOrbitalTool('orbital_read_notebook', {})).rejects.toThrow(
      /No notebook is open/,
    );
    await expect(executeOrbitalTool('orbital_run_cell', { index: 0 })).rejects.toThrow(
      /No notebook is open/,
    );
  });

  it('rejects an unknown tool name', async () => {
    await expect(executeOrbitalTool('orbital_launch_rocket', {})).rejects.toThrow(
      /Unknown ORBITAL tool/,
    );
  });
});

describe('orbital_read_notebook', () => {
  beforeEach(async () => {
    await useNotebookStore.getState().open(PATH);
  });

  it('returns every cell with its index, type and source', async () => {
    const result = (await executeOrbitalTool('orbital_read_notebook', {})) as ReadResult;
    expect(result.path).toBe(PATH);
    expect(result.cells).toEqual([
      { index: 0, type: 'code', source: 'x = 1', outputsText: '' },
      { index: 1, type: 'markdown', source: '# Notes', outputsText: '' },
      { index: 2, type: 'code', source: 'y = 2', outputsText: '' },
    ]);
  });

  it('flattens outputs to text after a run', async () => {
    await executeOrbitalTool('orbital_run_cell', { index: 0 });
    const result = (await executeOrbitalTool('orbital_read_notebook', {})) as ReadResult;
    // The fake session echoes the source back on stdout.
    expect(result.cells[0].outputsText).toBe('x = 1');
  });
});

describe('editing', () => {
  beforeEach(async () => {
    await useNotebookStore.getState().open(PATH);
  });

  it('inserts after an index and reports the new index', async () => {
    const result = (await executeOrbitalTool('orbital_insert_cell', {
      afterIndex: 0,
      type: 'code',
      source: 'z = 3',
    })) as { index: number };
    expect(result.index).toBe(1);

    const read = (await executeOrbitalTool('orbital_read_notebook', {})) as ReadResult;
    expect(read.cells.map((c) => c.source)).toEqual(['x = 1', 'z = 3', '# Notes', 'y = 2']);
  });

  it('inserts at the top when afterIndex is null', async () => {
    const result = (await executeOrbitalTool('orbital_insert_cell', {
      afterIndex: null,
      type: 'markdown',
      source: '# Top',
    })) as { index: number };
    expect(result.index).toBe(0);

    const read = (await executeOrbitalTool('orbital_read_notebook', {})) as ReadResult;
    expect(read.cells[0]).toMatchObject({ type: 'markdown', source: '# Top' });
  });

  it('replaces a cell source', async () => {
    await executeOrbitalTool('orbital_edit_cell', { index: 2, source: 'y = 99' });
    const read = (await executeOrbitalTool('orbital_read_notebook', {})) as ReadResult;
    expect(read.cells[2].source).toBe('y = 99');
  });

  it('deletes a cell', async () => {
    await executeOrbitalTool('orbital_delete_cell', { index: 1 });
    const read = (await executeOrbitalTool('orbital_read_notebook', {})) as ReadResult;
    expect(read.cells.map((c) => c.source)).toEqual(['x = 1', 'y = 2']);
  });

  it('rejects an out-of-range index with the valid range', async () => {
    await expect(executeOrbitalTool('orbital_edit_cell', { index: 9, source: '' })).rejects.toThrow(
      /valid indices 0\.\.2/,
    );
  });

  it('rejects a malformed input rather than guessing', async () => {
    await expect(
      executeOrbitalTool('orbital_insert_cell', { afterIndex: 0, type: 'raw', source: '' }),
    ).rejects.toThrow(/"type" must be "code" or "markdown"/);
    await expect(executeOrbitalTool('orbital_edit_cell', { index: 0 })).rejects.toThrow(
      /"source" must be a string/,
    );
  });
});

describe('execution', () => {
  beforeEach(async () => {
    await useNotebookStore.getState().open(PATH);
  });

  it('runs one cell and returns its settled state and outputs', async () => {
    const result = (await executeOrbitalTool('orbital_run_cell', { index: 2 })) as RunResult;
    expect(result).toEqual({ status: 'ok', outputsText: 'y = 2', executionCount: 1 });
  });

  it('reports an error status and the error text', async () => {
    sessions.get(PATH)!.script = (_code, handlers) => {
      handlers.onOutput({
        type: 'error',
        ename: 'NameError',
        evalue: "name 'z' is not defined",
        traceback: [],
      });
      handlers.onDone('error');
    };
    const result = (await executeOrbitalTool('orbital_run_cell', { index: 0 })) as RunResult;
    expect(result.status).toBe('error');
    expect(result.outputsText).toBe("NameError: name 'z' is not defined");
  });

  it('refuses to run a markdown cell', async () => {
    await expect(executeOrbitalTool('orbital_run_cell', { index: 1 })).rejects.toThrow(
      /markdown cell/,
    );
  });

  it('runs every code cell and reports each one', async () => {
    const result = (await executeOrbitalTool('orbital_run_all', {})) as {
      results: { index: number; status: string; outputsText: string }[];
    };
    expect(result.results).toEqual([
      { index: 0, status: 'ok', outputsText: 'x = 1', executionCount: 1 },
      { index: 2, status: 'ok', outputsText: 'y = 2', executionCount: 2 },
    ]);
  });

  it('refuses to run when the notebook has no kernel', async () => {
    // Closing the tab drops the session but we keep the doc in state, which is
    // the shape a disconnected notebook has.
    const doc = useNotebookStore.getState().docs[PATH];
    await useNotebookStore.getState().close(PATH);
    useNotebookStore.setState({ docs: { [PATH]: doc }, openPaths: [PATH], activePath: PATH });

    await expect(executeOrbitalTool('orbital_run_cell', { index: 0 })).rejects.toThrow(
      /No kernel is connected/,
    );
    await expect(executeOrbitalTool('orbital_list_variables', {})).rejects.toThrow(
      /No kernel is connected/,
    );
  });
});

describe('orbital_list_variables', () => {
  it('refreshes the inspector against the active session and returns the variables', async () => {
    await useNotebookStore.getState().open(PATH);
    sessions.get(PATH)!.executeSilent = async () => ({
      status: 'ok',
      outputs: [
        {
          type: 'stream',
          name: 'stdout',
          text:
            '__ORBITAL_VARS__' +
            JSON.stringify([
              {
                name: 'df',
                type: 'DataFrame',
                module: 'pandas',
                shape: [3, 2],
                length: 3,
                repr: '<df>',
                size: null,
              },
            ]),
        },
      ],
    });

    const result = (await executeOrbitalTool('orbital_list_variables', {})) as {
      variables: { name: string; type: string; shape: number[] | null; repr: string }[];
    };
    expect(result.variables).toEqual([
      { name: 'df', type: 'DataFrame', shape: [3, 2], repr: '<df>' },
    ]);
  });
});

describe('outputsToText', () => {
  it('caps a runaway output and says so', () => {
    const text = outputsToText([{ type: 'stream', name: 'stdout', text: 'a'.repeat(9000) }]);
    expect(text.length).toBeLessThan(9000);
    expect(text.startsWith('a'.repeat(MAX_OUTPUT_CHARS))).toBe(true);
    expect(text).toContain('truncated, 9000 chars total');
  });

  it('prefers text/plain and names non-text mimes', () => {
    expect(
      outputsToText([
        { type: 'execute_result', data: { 'text/plain': '42', 'text/html': '<b>42</b>' } },
        { type: 'display_data', data: { 'image/png': 'AAAA' } },
      ]),
    ).toBe('42\n[image/png output]');
  });
});

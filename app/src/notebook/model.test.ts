import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fromNbformat, toNbformat } from './model';

const workspaceNotebookPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../workspace/hull-stress-analysis.ipynb',
);

/** Deep-clones a parsed notebook with every cell's `id` field removed. */
function withoutCellIds(nb: unknown): unknown {
  const clone = JSON.parse(JSON.stringify(nb)) as { cells: Array<Record<string, unknown>> };
  for (const cell of clone.cells) delete cell.id;
  return clone;
}

describe('fromNbformat / toNbformat round-trip', () => {
  it('round-trips workspace/hull-stress-analysis.ipynb losslessly aside from added cell ids', () => {
    const raw = JSON.parse(readFileSync(workspaceNotebookPath, 'utf-8'));

    const model = fromNbformat(raw, 'hull-stress-analysis.ipynb');
    const roundTripped = toNbformat(model);

    expect(withoutCellIds(roundTripped)).toEqual(withoutCellIds(raw));

    const cells = (roundTripped as { cells: Array<{ id: unknown }> }).cells;
    expect(cells).toHaveLength(4);
    for (const cell of cells) {
      expect(typeof cell.id).toBe('string');
      expect((cell.id as string).length).toBeGreaterThan(0);
    }
  });

  it('preserves the notebook path and metadata separately from nbformat fields', () => {
    const raw = JSON.parse(readFileSync(workspaceNotebookPath, 'utf-8'));
    const model = fromNbformat(raw, 'hull-stress-analysis.ipynb');

    expect(model.path).toBe('hull-stress-analysis.ipynb');
    expect(model.nbformat).toBe(4);
    expect(model.nbformatMinor).toBe(5);
    expect(model.metadata).toEqual(raw.metadata);
    expect(model.cells[0].type).toBe('markdown');
    expect(model.cells[1].type).toBe('code');
  });
});

describe('output joining', () => {
  it('joins a multi-line stream output array into one string', () => {
    const raw = {
      cells: [
        {
          cell_type: 'code',
          execution_count: 1,
          metadata: {},
          source: ['print("a")\n', 'print("b")'],
          outputs: [
            {
              output_type: 'stream',
              name: 'stdout',
              text: ['line one\n', 'line two\n', 'line three'],
            },
          ],
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    };

    const model = fromNbformat(raw, 'test.ipynb');
    const output = model.cells[0].outputs[0];

    expect(output.type).toBe('stream');
    if (output.type === 'stream') {
      expect(output.text).toBe('line one\nline two\nline three');
    }
    expect(model.cells[0].source).toBe('print("a")\nprint("b")');
  });

  it('joins a multi-line text/plain execute_result array into one string', () => {
    const raw = {
      cells: [
        {
          cell_type: 'code',
          execution_count: 2,
          metadata: {},
          source: ['df.describe()'],
          outputs: [
            {
              output_type: 'execute_result',
              execution_count: 2,
              data: {
                'text/plain': ['       strain\n', 'mean  0.00142\n', 'std   0.00031'],
              },
              metadata: {},
            },
          ],
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    };

    const model = fromNbformat(raw, 'test.ipynb');
    const output = model.cells[0].outputs[0];

    expect(output.type).toBe('execute_result');
    if (output.type === 'execute_result' || output.type === 'display_data') {
      expect(output.data['text/plain']).toBe('       strain\nmean  0.00142\nstd   0.00031');
      expect(output.executionCount).toBe(2);
    }
  });
});

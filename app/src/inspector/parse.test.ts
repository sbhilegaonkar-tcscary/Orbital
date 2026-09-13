import { describe, expect, it } from 'vitest';
import { parseInspectOutput, type Variable } from './parse';
import type { CellOutput } from '../session/types';

function stdout(text: string): CellOutput {
  return { type: 'stream', name: 'stdout', text };
}

const PAYLOAD: Variable[] = [
  { name: 'n', type: 'int', module: 'builtins', shape: null, length: null, repr: '42', size: 28 },
  {
    name: 's',
    type: 'str',
    module: 'builtins',
    shape: null,
    length: null,
    repr: "'hi'",
    size: 51,
  },
  {
    name: 'x',
    type: 'ndarray',
    module: 'numpy',
    shape: [3, 4],
    length: 3,
    repr: 'array([[0., 0., 0., 0.],\n       [0., 0., 0., 0.],\n       [0., 0., 0., 0.]])',
    size: 224,
  },
];

describe('parseInspectOutput', () => {
  it('parses a valid payload on its own stream output', () => {
    const outputs = [stdout(`__ORBITAL_VARS__ ${JSON.stringify(PAYLOAD)}\n`)];
    expect(parseInspectOutput(outputs)).toEqual(PAYLOAD);
  });

  it('finds the marker after unrelated stdout noise, including across separate stream chunks', () => {
    const outputs = [
      stdout('warming up the kernel...\n'),
      stdout(`still going\n__ORBITAL_VARS__ ${JSON.stringify(PAYLOAD)}`),
    ];
    expect(parseInspectOutput(outputs)).toEqual(PAYLOAD);
  });

  it('returns [] when the JSON after the marker is malformed', () => {
    const outputs = [stdout('__ORBITAL_VARS__ {not: valid json,,,')];
    expect(parseInspectOutput(outputs)).toEqual([]);
  });

  it('returns [] when there is no marker at all', () => {
    const outputs = [stdout('hello from a plain print()\n')];
    expect(parseInspectOutput(outputs)).toEqual([]);
  });

  it('returns [] for an empty outputs array', () => {
    expect(parseInspectOutput([])).toEqual([]);
  });

  it('ignores stderr text and non-stream outputs when looking for the marker', () => {
    const outputs: CellOutput[] = [
      { type: 'stream', name: 'stderr', text: '__ORBITAL_VARS__ [should not be used]' },
      { type: 'error', ename: 'X', evalue: 'y', traceback: [] },
      stdout(`__ORBITAL_VARS__ ${JSON.stringify(PAYLOAD)}`),
    ];
    expect(parseInspectOutput(outputs)).toEqual(PAYLOAD);
  });

  it('drops malformed items but keeps well-formed ones from the array', () => {
    const outputs = [
      stdout(
        `__ORBITAL_VARS__ ${JSON.stringify([
          PAYLOAD[0],
          { name: 'bad', type: 123 },
          PAYLOAD[1],
        ])}`,
      ),
    ];
    expect(parseInspectOutput(outputs)).toEqual([PAYLOAD[0], PAYLOAD[1]]);
  });
});

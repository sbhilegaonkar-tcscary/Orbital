/**
 * A hand-built NotebookModel mirroring workspace/hull-stress-analysis.ipynb,
 * with fake outputs attached (a describe() html table, a stdout stream, and
 * a realistic ANSI-colored traceback) so the notebook chrome can be eyeballed
 * without a running kernel. Loaded by Notebook.tsx behind `?fixture=1`.
 */
import type { NotebookModel } from './model';

export const fixtureNotebook: NotebookModel = {
  path: 'hull-stress-analysis.ipynb',
  nbformat: 4,
  nbformatMinor: 5,
  metadata: {
    kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
    language_info: { name: 'python' },
  },
  cells: [
    {
      id: 'fixture-0',
      type: 'markdown',
      source:
        '# Hull stress analysis\nLoad the strain-gauge telemetry, fit a simple model, and flag panels above the yield threshold. Data comes from `sensors/deck-4/` sampled at 200 Hz.',
      outputs: [],
      executionCount: null,
      state: 'idle',
      metadata: {},
    },
    {
      id: 'fixture-1',
      type: 'code',
      source:
        'import numpy as np\n' +
        'import pandas as pd\n' +
        '\n' +
        'rng = np.random.default_rng(4)\n' +
        'df = pd.DataFrame({\n' +
        '    "strain": rng.normal(0.00142, 0.00031, 48_000),\n' +
        '    "temp_c": rng.normal(21.4, 1.8, 48_000),\n' +
        '})\n' +
        'df["stress_mpa"] = df["strain"] * 210_000  # steel, E in MPa\n' +
        'df.describe()',
      outputs: [
        {
          type: 'execute_result',
          executionCount: 1,
          data: {
            'text/html':
              '<table><thead><tr><th></th><th>strain</th><th>stress_mpa</th><th>temp_c</th></tr></thead>' +
              '<tbody>' +
              '<tr><td>mean</td><td>0.001420</td><td>298.20</td><td>21.4</td></tr>' +
              '<tr><td>std</td><td>0.000310</td><td>65.10</td><td>1.8</td></tr>' +
              '<tr><td>min</td><td>0.000580</td><td>121.80</td><td>18.1</td></tr>' +
              '<tr><td>max</td><td>0.002510</td><td>527.10</td><td>24.9</td></tr>' +
              '</tbody></table>',
            'text/plain':
              '       strain  stress_mpa  temp_c\nmean 0.001420      298.20    21.4\nstd  0.000310       65.10     1.8',
          },
        },
      ],
      executionCount: 1,
      state: 'ok',
      metadata: {},
    },
    {
      id: 'fixture-2',
      type: 'code',
      source: 'threshold = config["yield_mpa"]\nflagged = df[df.stress_mpa > threshold]',
      outputs: [
        {
          type: 'error',
          ename: 'NameError',
          evalue: "name 'config' is not defined",
          traceback: [
            '[0;31m---------------------------------------------------------------------------[0m',
            '[0;31mNameError[0m                                 Traceback (most recent call last)',
            'Cell [0;32mIn[2], line 1[0m',
            '----> 1 threshold = config["yield_mpa"]',
            '',
            "[0;31mNameError[0m: name 'config' is not defined",
          ],
        },
      ],
      executionCount: 2,
      state: 'error',
      metadata: {},
    },
    {
      id: 'fixture-3',
      type: 'code',
      source: 'import time\nfor i in range(3):\n    print(f"fitting pass {i + 1}")\n    time.sleep(0.7)\nprint("done")',
      outputs: [
        {
          type: 'stream',
          name: 'stdout',
          text: 'fitting pass 1\nfitting pass 2\nfitting pass 3\ndone\n',
        },
      ],
      executionCount: 3,
      state: 'ok',
      metadata: {},
    },
  ],
};

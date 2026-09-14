/**
 * Canned transcript for `?agentdemo=1` and the auth-gate variant for
 * `?agentdemo=auth` (see `AgentPanel.tsx`), used for headless screenshots
 * and manual review without a running sidecar. Not imported by the real
 * runtime path.
 */
import type { AuthStatus } from './protocol';
import type { PendingPermission, TranscriptItem } from './store';

const NOW = Date.now();

export const DEMO_TRANSCRIPT: TranscriptItem[] = [
  {
    id: 'demo-u1',
    role: 'user',
    ts: NOW - 60_000,
    blocks: [{ kind: 'text', text: 'Explain the error in the selected cell and fix it.' }],
  },
  {
    id: 'demo-a1',
    role: 'assistant',
    ts: NOW - 55_000,
    blocks: [
      {
        kind: 'thinking',
        text:
          'The traceback shows a KeyError on "stress_mpa". The dataframe column is ' +
          'actually named "stress_MPa" — case mismatch. I will confirm by rerunning the ' +
          'cell, then fix the plotting call.',
      },
      {
        kind: 'text',
        text:
          'The traceback is a `KeyError: \'stress_mpa\'` — the dataframe column is ' +
          'actually named `stress_MPa`. Fixing the plotting call:\n\n' +
          '```python\ndf.plot(x="time_s", y="stress_MPa")\n```\n\n' +
          'I reran the cell to confirm it now succeeds.',
      },
      { kind: 'tool_use', id: 'tu-1', name: 'orbital_run_cell', input: { index: 3 } },
      {
        kind: 'tool_result',
        toolUseId: 'tu-1',
        content: '{"status":"ok","executionCount":7,"outputsText":"<Axes: xlabel=\'time_s\', ylabel=\'stress_MPa\'>"}',
        isError: false,
      },
      {
        kind: 'tool_use',
        id: 'tu-2',
        name: 'Edit',
        input: {
          file_path: 'workspace/hull-stress-analysis.ipynb',
          old_string: 'df.plot(x="time_s", y="stress_mpa")',
          new_string: 'df.plot(x="time_s", y="stress_MPa")',
        },
      },
      { kind: 'tool_result', toolUseId: 'tu-2', content: 'ok', isError: false },
    ],
  },
  {
    id: 'demo-a2',
    role: 'assistant',
    ts: NOW - 1_000,
    blocks: [],
    streamingText: 'Now I will add a rolling-average trend line to the same plot',
  },
];

export const DEMO_PENDING_PERMISSION: PendingPermission = {
  requestId: 'demo-perm-1',
  runId: 'demo-run-1',
  tool: 'orbital_run_all',
  input: {},
  description: 'Run all cells in hull-stress-analysis.ipynb',
};

export const DEMO_AUTH_LOGGED_OUT: AuthStatus = {
  loggedIn: false,
  reason: 'No active Claude login found on this machine.',
  loginCommand: 'claude login',
};

export const DEMO_AUTH_LOGGED_IN: AuthStatus = {
  loggedIn: true,
  loginCommand: 'claude login',
};

export const EXAMPLE_PROMPTS: string[] = [
  'Explain the error in the selected cell',
  'Add a cell that plots stress_mpa',
  'Refactor the loop cell into a function',
];

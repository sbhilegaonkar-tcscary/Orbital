/**
 * A canned star system for `?fixture=1`: enough bodies, in enough bands, with
 * enough live state that every part of the map has something to draw without
 * a Jupyter server behind it. This is what design review and the screenshot
 * runs look at, so it is deliberately a *good* system, not a minimal one —
 * every kind, every band, moons, derelicts, a busy kernel, an error and an
 * unsaved buffer.
 *
 * Ages are relative to `Date.now()` at import, so the map always looks
 * freshly used no matter when it is opened. Directory `childCount`s match the
 * listings below them, so diving in is consistent with what the folder said.
 *
 * Lazy-imported by `views/MapView.tsx`; it never reaches the production
 * bundle's critical path.
 */
import { DAY, HOUR, type BodyInput } from './model';
import type { BodyStatus } from './store';

const NOW = Date.now();

const KB = 1024;
const MB = 1024 * KB;

function ago(ms: number): number {
  return NOW - ms;
}

function nb(path: string, ms: number, bytes: number): BodyInput {
  return { path, name: base(path), kind: 'notebook', modifiedAt: ago(ms), bytes };
}

function file(path: string, ms: number, bytes: number): BodyInput {
  return { path, name: base(path), kind: 'file', modifiedAt: ago(ms), bytes };
}

function dir(path: string, ms: number, childCount: number, moons?: string[]): BodyInput {
  return { path, name: base(path), kind: 'directory', modifiedAt: ago(ms), childCount, moons };
}

function base(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The workspace root: 22 visible bodies plus one hidden checkpoints folder. */
const ROOT: BodyInput[] = [
  // today — the working set, hugging the star
  nb('hull-stress-analysis.ipynb', 2 * HOUR, 1.4 * MB),
  nb('trajectory-solver.ipynb', 5 * HOUR, 310 * KB),
  nb('telemetry-scrub.ipynb', 19 * HOUR, 88 * KB),
  file('mission.md', 1 * HOUR, 4.1 * KB),
  file('constants.py', 6 * HOUR, 2.3 * KB),
  file('readings.csv', 9 * HOUR, 880 * KB),
  dir('experiments', 4 * HOUR, 7, ['hull-mesh-v4.ipynb', 'hull-mesh-v3.ipynb', 'lift-curve.ipynb']),
  dir('.ipynb_checkpoints', 20 * HOUR, 3),

  // this week
  nb('atmos-entry-model.ipynb', 3 * DAY, 64 * KB),
  file('README.md', 4 * DAY, 1.2 * KB),
  dir('data', 2 * DAY, 11, ['ingest-report.ipynb']),

  // this month
  nb('power-budget.ipynb', 11 * DAY, 41 * KB),
  nb('comms-link-margin.ipynb', 26 * DAY, 22 * KB),
  file('requirements.txt', 9 * DAY, 412),
  file('orbit_utils.py', 17 * DAY, 18 * KB),

  // six months
  nb('ion-drive-tuning.ipynb', 95 * DAY, 156 * KB),
  file('calibration.csv', 60 * DAY, 2.4 * MB),
  file('notes.md', 120 * DAY, 7.7 * KB),
  dir('rigs', 40 * DAY, 4, ['vibration-rig.ipynb', 'thermal-rig.ipynb']),

  // older — derelicts, drifting dark at the rim
  nb('first-contact-draft.ipynb', 420 * DAY, 12 * KB),
  file('legacy_sim.py', 300 * DAY, 33 * KB),
  file('dump.log', 700 * DAY, 5.2 * MB),
  dir('archive', 500 * DAY, 6, [
    'apollo-notes.ipynb',
    'gemini-notes.ipynb',
    'mercury-notes.ipynb',
  ]),
];

/**
 * A deliberately crowded system: a parameter sweep leaves dozens of runs
 * behind. This is the case the label budget and the label de-collision are
 * for, so review has somewhere to look at them.
 */
const SWEEPS: BodyInput[] = (() => {
  const out: BodyInput[] = [
    nb('experiments/sweeps/alpha.ipynb', 90 * 60_000, 76 * KB),
    nb('experiments/sweeps/beta.ipynb', 8 * HOUR, 71 * KB),
    file('experiments/sweeps/grid.csv', 30 * 60_000, 1.1 * MB),
    dir('experiments/sweeps/plots', 5 * HOUR, 9),
    dir('experiments/sweeps/logs', 6 * DAY, 14),
  ];
  // 12 run notebooks marching out from "an hour ago" to "last month".
  for (let i = 1; i <= 12; i += 1) {
    out.push(
      nb(
        `experiments/sweeps/run-${String(i).padStart(3, '0')}.ipynb`,
        HOUR + i * i * 5 * HOUR,
        (40 + i * 11) * KB,
      ),
    );
  }
  // 27 result files spread over the whole two-year range.
  for (let i = 1; i <= 27; i += 1) {
    const ext = i % 3 === 0 ? 'csv' : i % 3 === 1 ? 'json' : 'txt';
    out.push(
      file(
        `experiments/sweeps/result-${String(i).padStart(3, '0')}.${ext}`,
        2 * HOUR + i * i * i * 45 * 60_000,
        (3 + i * 7) * KB,
      ),
    );
  }
  return out;
})();

const EXPERIMENTS: BodyInput[] = [
  dir('experiments/sweeps', 3 * HOUR, SWEEPS.length, [
    'alpha.ipynb',
    'beta.ipynb',
    'run-001.ipynb',
    'run-002.ipynb',
    'run-003.ipynb',
    'run-004.ipynb',
  ]),
  nb('experiments/hull-mesh-v4.ipynb', 3 * HOUR, 420 * KB),
  nb('experiments/hull-mesh-v3.ipynb', 6 * DAY, 390 * KB),
  nb('experiments/lift-curve.ipynb', 22 * DAY, 51 * KB),
  file('experiments/sweep_runner.py', 5 * HOUR, 9.4 * KB),
  file('experiments/params.csv', 2 * DAY, 640),
  file('experiments/notes.md', 210 * DAY, 3.3 * KB),
];

const PLOTS: BodyInput[] = Array.from({ length: 9 }, (_, i) =>
  file(`experiments/sweeps/plots/fig-${String(i + 1).padStart(2, '0')}.svg`, (2 + i) * HOUR, (18 + i * 6) * KB),
);

const LOGS: BodyInput[] = Array.from({ length: 14 }, (_, i) =>
  file(`experiments/sweeps/logs/run-${String(i + 1).padStart(3, '0')}.log`, (6 + i) * DAY, (90 + i * 40) * KB),
);

const DATA: BodyInput[] = [
  dir('data/raw', 2 * DAY, 5),
  nb('data/ingest-report.ipynb', 2 * DAY, 130 * KB),
  file('data/manifest.json', 2 * DAY, 2.8 * KB),
  file('data/pressures.csv', 3 * DAY, 4.6 * MB),
  file('data/temps.csv', 3 * DAY, 3.9 * MB),
  file('data/strain.csv', 12 * DAY, 2.2 * MB),
  file('data/schema.md', 35 * DAY, 5.1 * KB),
  file('data/loader.py', 44 * DAY, 12 * KB),
  file('data/legacy-1998.csv', 260 * DAY, 780 * KB),
  file('data/legacy-1999.csv', 260 * DAY, 810 * KB),
  file('data/.gitkeep', 400 * DAY, 0),
];

const RAW: BodyInput[] = [
  file('data/raw/run-041.bin', 2 * DAY, 18 * MB),
  file('data/raw/run-042.bin', 2 * DAY, 19 * MB),
  file('data/raw/run-043.bin', 2 * DAY, 17 * MB),
  file('data/raw/index.csv', 2 * DAY, 3.2 * KB),
  file('data/raw/README.md', 150 * DAY, 900),
];

const RIGS: BodyInput[] = [
  nb('rigs/vibration-rig.ipynb', 40 * DAY, 96 * KB),
  nb('rigs/thermal-rig.ipynb', 77 * DAY, 84 * KB),
  file('rigs/rig_control.py', 40 * DAY, 26 * KB),
  file('rigs/wiring.md', 190 * DAY, 6.5 * KB),
];

const ARCHIVE: BodyInput[] = [
  nb('archive/apollo-notes.ipynb', 500 * DAY, 44 * KB),
  nb('archive/gemini-notes.ipynb', 560 * DAY, 38 * KB),
  nb('archive/mercury-notes.ipynb', 620 * DAY, 31 * KB),
  file('archive/index.md', 500 * DAY, 2.1 * KB),
  file('archive/old_sim.py', 640 * DAY, 71 * KB),
  file('archive/logbook.txt', 900 * DAY, 220 * KB),
];

const CHECKPOINTS: BodyInput[] = [
  nb('.ipynb_checkpoints/hull-stress-analysis-checkpoint.ipynb', 20 * HOUR, 1.4 * MB),
  nb('.ipynb_checkpoints/trajectory-solver-checkpoint.ipynb', 26 * HOUR, 300 * KB),
  nb('.ipynb_checkpoints/power-budget-checkpoint.ipynb', 12 * DAY, 40 * KB),
];

export const tree: Record<string, BodyInput[]> = {
  '': ROOT,
  experiments: EXPERIMENTS,
  'experiments/sweeps': SWEEPS,
  'experiments/sweeps/plots': PLOTS,
  'experiments/sweeps/logs': LOGS,
  data: DATA,
  'data/raw': RAW,
  rigs: RIGS,
  archive: ARCHIVE,
  '.ipynb_checkpoints': CHECKPOINTS,
};

/** One active idle notebook, one open busy one with an error, one with unsaved edits. */
export const statuses: Record<string, Partial<BodyStatus>> = {
  'hull-stress-analysis.ipynb': { open: true, active: true, kernel: 'idle' },
  'trajectory-solver.ipynb': { open: true, kernel: 'busy', errors: 1, running: 2 },
  'telemetry-scrub.ipynb': { open: true, dirty: true, kernel: 'idle' },
  'experiments/hull-mesh-v4.ipynb': { open: true, kernel: 'idle' },
};

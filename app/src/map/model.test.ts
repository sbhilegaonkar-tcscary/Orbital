/**
 * Map model tests. Node environment, no DOM: everything here is pure.
 * These pin the numbers the M8 contract quotes, so a later tweak to the
 * age→orbit curve fails loudly instead of quietly re-scaling the map.
 */
import { describe, expect, it } from 'vitest';

import type { ContentsEntry } from '../session/types';
import {
  BANDS,
  DAY,
  HOUR,
  LABEL_CLEARANCE,
  LABEL_SECTOR,
  ORBIT_MIN,
  angleAt,
  asteroidPath,
  bandFor,
  displayName,
  entriesToBodyInputs,
  formatBytes,
  hashString,
  isInLabelSector,
  layoutSystem,
  makeBody,
  orbitFor,
  periodFor,
  placeLabels,
  positionAt,
  ringOrbit,
  scaleFor,
  seededRng,
  shortestDelta,
  type BodyInput,
  type LabelItem,
  type LabelObstacle,
  type Placement,
} from './model';

const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);
const YEAR = 365 * DAY;
const TAU = Math.PI * 2;

function input(partial: Partial<BodyInput> & { path: string }): BodyInput {
  return {
    name: partial.path.slice(partial.path.lastIndexOf('/') + 1),
    kind: 'notebook',
    modifiedAt: NOW - HOUR,
    ...partial,
  };
}

function entry(
  path: string,
  type: ContentsEntry['type'],
  extra: Partial<ContentsEntry> = {},
): ContentsEntry {
  return {
    name: path.slice(path.lastIndexOf('/') + 1),
    path,
    type,
    lastModified: new Date(NOW - DAY).toISOString(),
    ...extra,
  };
}

describe('hashString', () => {
  it('is FNV-1a 32-bit and unsigned', () => {
    // Reference vectors for FNV-1a/32.
    expect(hashString('')).toBe(0x811c9dc5);
    expect(hashString('a')).toBe(0xe40c292c);
    expect(hashString('foobar')).toBe(0xbf9cf968);
  });

  it('is stable and fits in 32 unsigned bits for real paths', () => {
    const h = hashString('experiments/hull-stress-analysis.ipynb');
    expect(h).toBe(hashString('experiments/hull-stress-analysis.ipynb'));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });
});

describe('seededRng', () => {
  it('reproduces the Park-Miller sequence effects/Sky.tsx uses', () => {
    const rng = seededRng(7);
    // s = (7 * 16807) % 2147483647 = 117649
    expect(rng()).toBeCloseTo(117649 / 2147483647, 12);
    expect(rng()).toBeCloseTo(((117649 * 16807) % 2147483647) / 2147483647, 12);
  });

  it('stays inside (0, 1) even for a zero or hash-sized seed', () => {
    for (const seed of [0, 1, hashString('a/b/c.py'), 2147483647]) {
      const rng = seededRng(seed);
      for (let i = 0; i < 20; i += 1) {
        const v = rng();
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThan(1);
      }
    }
  });
});

describe('orbitFor', () => {
  it('matches the contract values at every band boundary', () => {
    expect(orbitFor(DAY)).toBeCloseTo(0.474, 3);
    expect(orbitFor(7 * DAY)).toBeCloseTo(0.629, 3);
    expect(orbitFor(30 * DAY)).toBeCloseTo(0.745, 3);
    expect(orbitFor(182 * DAY)).toBeCloseTo(0.889, 3);
    expect(orbitFor(2 * YEAR)).toBeCloseTo(1, 10);
  });

  it('clamps to [1h, 2y]', () => {
    expect(orbitFor(0)).toBe(ORBIT_MIN);
    expect(orbitFor(HOUR)).toBeCloseTo(ORBIT_MIN, 12);
    expect(orbitFor(HOUR / 2)).toBe(ORBIT_MIN);
    expect(orbitFor(10 * YEAR)).toBe(1);
  });

  it('is monotonic across the whole range', () => {
    let previous = -Infinity;
    for (let age = 0; age <= 4 * YEAR; age += DAY / 4) {
      const orbit = orbitFor(age);
      expect(orbit).toBeGreaterThanOrEqual(previous);
      previous = orbit;
    }
  });
});

describe('bandFor and ringOrbit', () => {
  it('assigns each age to its band', () => {
    expect(bandFor(0)).toBe('today');
    expect(bandFor(3 * HOUR)).toBe('today');
    expect(bandFor(DAY)).toBe('today');
    expect(bandFor(DAY + 1)).toBe('week');
    expect(bandFor(20 * DAY)).toBe('month');
    expect(bandFor(100 * DAY)).toBe('halfyear');
    expect(bandFor(3 * YEAR)).toBe('older');
  });

  it('puts every ring on its band boundary, strictly increasing', () => {
    const rings = (['today', 'week', 'month', 'halfyear'] as const).map(ringOrbit);
    expect(rings).toEqual([
      orbitFor(BANDS[0].maxAgeMs),
      orbitFor(BANDS[1].maxAgeMs),
      orbitFor(BANDS[2].maxAgeMs),
      orbitFor(BANDS[3].maxAgeMs),
    ]);
    for (let i = 1; i < rings.length; i += 1) expect(rings[i]).toBeGreaterThan(rings[i - 1]);
    expect(rings[rings.length - 1]).toBeLessThan(1);
  });
});

describe('periodFor', () => {
  it("follows Kepler's third law off the base period", () => {
    expect(periodFor(ORBIT_MIN)).toBe(90_000);
    // The contract quotes ~873 s at the rim; the formula gives 872.2 s.
    expect(periodFor(1) / 1000).toBeCloseTo(872.2, 1);
    // Doubling the radius multiplies the period by 2^1.5.
    expect(periodFor(0.8) / periodFor(0.4)).toBeCloseTo(2 ** 1.5, 10);
  });

  it('makes inner bodies strictly faster than outer ones', () => {
    for (let orbit = ORBIT_MIN; orbit < 1; orbit += 0.05) {
      expect(periodFor(orbit)).toBeLessThan(periodFor(orbit + 0.05));
    }
  });
});

describe('scaleFor', () => {
  it('scales notebooks and files by size, directories by child count', () => {
    expect(scaleFor(input({ path: 'a.ipynb', bytes: 1_400_000 }))).toBeCloseTo(1.5, 6);
    expect(scaleFor(input({ path: 'b.ipynb', bytes: 49_152 }))).toBeCloseTo(1.2547, 3);
    expect(scaleFor(input({ path: 'c.py', kind: 'file', bytes: 0 }))).toBeCloseTo(0.75, 6);
    expect(scaleFor(input({ path: 'd', kind: 'directory', childCount: 0 }))).toBeCloseTo(0.8, 6);
    expect(scaleFor(input({ path: 'e', kind: 'directory', childCount: 12 }))).toBeCloseTo(1.15, 6);
    expect(scaleFor(input({ path: 'f', kind: 'directory', childCount: 99 }))).toBeCloseTo(1.5, 6);
  });

  it('falls back to 1 when the size or child count is unknown', () => {
    expect(scaleFor(input({ path: 'g.ipynb' }))).toBe(1);
    expect(scaleFor(input({ path: 'h', kind: 'directory' }))).toBe(1);
  });
});

describe('layoutSystem', () => {
  const inputs: BodyInput[] = [
    input({ path: 'alpha.ipynb', modifiedAt: NOW - 2 * HOUR }),
    input({ path: 'beta.ipynb', modifiedAt: NOW - 2 * HOUR }),
    input({ path: 'gamma.ipynb', modifiedAt: NOW - 2 * HOUR }),
    input({ path: 'delta.py', kind: 'file', modifiedAt: NOW - 2 * HOUR, bytes: 10 }),
    input({ path: 'old.ipynb', modifiedAt: NOW - 3 * YEAR }),
  ];

  it('is independent of input order', () => {
    const forwards = layoutSystem(inputs, NOW);
    const backwards = layoutSystem([...inputs].reverse(), NOW);
    expect(backwards).toEqual(forwards);
    expect(forwards.map((b) => b.path)).toEqual([
      'alpha.ipynb',
      'beta.ipynb',
      'delta.py',
      'gamma.ipynb',
      'old.ipynb',
    ]);
  });

  it('separates bodies that share a ring', () => {
    const bodies = layoutSystem(inputs, NOW);
    for (let i = 0; i < bodies.length; i += 1) {
      for (let j = i + 1; j < bodies.length; j += 1) {
        if (Math.abs(bodies[i].orbit - bodies[j].orbit) >= 0.06) continue;
        expect(Math.abs(shortestDelta(bodies[i].phase, bodies[j].phase))).toBeGreaterThanOrEqual(0.2);
      }
    }
  });

  it('keeps phases in [0, 2π) and derives band, period and scale', () => {
    const bodies = layoutSystem(inputs, NOW);
    for (const body of bodies) {
      expect(body.phase).toBeGreaterThanOrEqual(0);
      expect(body.phase).toBeLessThan(TAU);
      expect(body.periodMs).toBeCloseTo(periodFor(body.orbit), 6);
      expect(body.band).toBe(bandFor(NOW - body.modifiedAt));
    }
    expect(bodies.find((b) => b.path === 'old.ipynb')?.orbit).toBe(1);
  });
});

describe('the ring-caption sector', () => {
  it('spans the arc just clockwise of 12 o\'clock', () => {
    expect(LABEL_SECTOR.start).toBeCloseTo((-100 * Math.PI) / 180, 12);
    expect(LABEL_SECTOR.end).toBeCloseTo((-48 * Math.PI) / 180, 12);
    expect(isInLabelSector(-Math.PI / 2)).toBe(true); // straight up
    expect(isInLabelSector(0)).toBe(false); // 3 o'clock
    expect(isInLabelSector(Math.PI / 2)).toBe(false); // straight down
    // The edges themselves: start is inside, end is the first angle outside.
    expect(isInLabelSector(LABEL_SECTOR.start + 1e-9)).toBe(true);
    expect(isInLabelSector(LABEL_SECTOR.end + 1e-9)).toBe(false);
  });

  it('keeps 300 bodies across every band out of it, deterministically', () => {
    const inputs: BodyInput[] = [];
    for (let i = 0; i < 300; i += 1) {
      inputs.push(
        input({
          path: `dir${i % 7}/body-${i}.ipynb`,
          // Spread across the whole 1h..3y range so every band is populated.
          modifiedAt: NOW - HOUR * (1 + i * 90),
        }),
      );
    }
    const bodies = layoutSystem(inputs, NOW);
    expect(bodies).toHaveLength(300);
    expect(new Set(bodies.map((b) => b.band)).size).toBe(BANDS.length);
    for (const body of bodies) {
      expect(isInLabelSector(body.phase)).toBe(false);
    }
    // Determinism is unchanged by the exclusion.
    expect(layoutSystem([...inputs].reverse(), NOW)).toEqual(bodies);
  });
});

describe('placeLabels', () => {
  function item(partial: Partial<LabelItem> & { id: string; x: number; y: number }): LabelItem {
    return { w: 80, h: 12, outward: 'right', ...partial };
  }

  it('gives two same-ring neighbours different placements', () => {
    const items = [
      item({ id: 'a', x: 100, y: 0 }),
      item({ id: 'b', x: 100, y: 8 }),
    ];
    const obstacles: LabelObstacle[] = [
      { x: 100, y: 0, r: 6 },
      { x: 100, y: 8, r: 6 },
    ];
    const placed = placeLabels(items, obstacles, new Map());
    expect(placed.size).toBe(2);
    expect(placed.get('a')).not.toEqual(placed.get('b'));
  });

  it('keeps a placement that still works, and replaces one that does not', () => {
    const items = [item({ id: 'a', x: 100, y: 0, outward: 'right' })];
    const obstacles: LabelObstacle[] = [{ x: 100, y: 0, r: 6 }];

    const pinned: Placement = { side: 'left', dy: 1 };
    const kept = placeLabels(items, obstacles, new Map([['a', pinned]]));
    expect(kept.get('a')).toEqual(pinned);

    // Block that exact spot: the remembered placement must be abandoned.
    const blocked = placeLabels(
      items,
      [...obstacles, { x: 40, y: 12.6, r: 6 }],
      new Map([['a', pinned]]),
    );
    expect(blocked.get('a')).not.toEqual(pinned);
  });

  it('never leaves a label covering another body', () => {
    const items: LabelItem[] = [];
    const obstacles: LabelObstacle[] = [];
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      const x = Math.round(Math.cos(angle) * 60);
      const y = Math.round(Math.sin(angle) * 60);
      items.push(item({ id: `b${i}`, x, y, outward: x < 0 ? 'left' : 'right' }));
      obstacles.push({ x, y, r: 6 });
    }
    const placed = placeLabels(items, obstacles, new Map());

    for (const one of items) {
      const p = placed.get(one.id)!;
      const cy = one.y + p.dy * one.h * 1.05;
      const box = {
        x0: p.side === 'left' ? one.x - one.w : one.x,
        x1: p.side === 'left' ? one.x : one.x + one.w,
        y0: cy - one.h / 2,
        y1: cy + one.h / 2,
      };
      for (const disc of obstacles) {
        if (Math.abs(disc.x - one.x) < 0.5 && Math.abs(disc.y - one.y) < 0.5) continue;
        const nx = Math.min(Math.max(disc.x, box.x0), box.x1);
        const ny = Math.min(Math.max(disc.y, box.y0), box.y1);
        expect(Math.hypot(disc.x - nx, disc.y - ny)).toBeGreaterThanOrEqual(disc.r + LABEL_CLEARANCE);
      }
    }
  });
});

describe('angleAt and positionAt', () => {
  const body = makeBody(input({ path: 'x.ipynb', modifiedAt: NOW - DAY }), NOW);

  it('freezes at the phase in Chart mode', () => {
    expect(angleAt(body, 99_999, 0, 'frozen')).toBe(body.phase);
    const p = positionAt(body, 99_999, 0, 'frozen');
    expect(p.x).toBeCloseTo(Math.cos(body.phase) * body.orbit, 12);
    expect(p.y).toBeCloseTo(Math.sin(body.phase) * body.orbit, 12);
  });

  it('starts Orbit exactly on the Chart layout, then advances prograde', () => {
    const tStart = 1_000;
    expect(angleAt(body, tStart, tStart, 'orbit')).toBeCloseTo(body.phase, 12);
    expect(angleAt(body, tStart + body.periodMs / 4, tStart, 'orbit')).toBeCloseTo(
      body.phase + Math.PI / 2,
      10,
    );
    // A full period is a full turn.
    expect(angleAt(body, tStart + body.periodMs, tStart, 'orbit')).toBeCloseTo(body.phase + TAU, 10);
  });

  it('keeps every position on the unit circle scaled by orbit', () => {
    const p = positionAt(body, 12_345, 0, 'orbit');
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(body.orbit, 12);
  });
});

describe('entriesToBodyInputs', () => {
  const listing: ContentsEntry[] = [
    entry('notes.md', 'file', { size: 1229 }),
    entry('.ipynb_checkpoints', 'directory'),
    entry('experiments', 'directory'),
    entry('alpha.ipynb', 'notebook', { size: 49_152 }),
  ];
  const byDir: Record<string, ContentsEntry[]> = {
    experiments: [
      entry('experiments/one.ipynb', 'notebook', { size: 10 }),
      entry('experiments/.hidden.py', 'file', { size: 10 }),
      entry('experiments/two.ipynb', 'notebook', { size: 10 }),
      entry('experiments/data.csv', 'file', { size: 10 }),
    ],
  };

  it('hides dotfiles unless asked, and sorts by path', () => {
    const visible = entriesToBodyInputs(listing, byDir, false);
    expect(visible.map((b) => b.path)).toEqual(['alpha.ipynb', 'experiments', 'notes.md']);
    const all = entriesToBodyInputs(listing, byDir, true);
    expect(all.map((b) => b.path)).toEqual([
      '.ipynb_checkpoints',
      'alpha.ipynb',
      'experiments',
      'notes.md',
    ]);
  });

  it('fills childCount and moons from the cached listing only', () => {
    const [, dir] = entriesToBodyInputs(listing, byDir, false);
    expect(dir.path).toBe('experiments');
    expect(dir.childCount).toBe(3); // the hidden .py is not counted
    expect(dir.moons).toEqual(['experiments/one.ipynb', 'experiments/two.ipynb'].map((p) => p.slice(12)));
    expect(dir.bytes).toBeUndefined();

    const uncached = entriesToBodyInputs(listing, {}, false).find((b) => b.path === 'experiments');
    expect(uncached?.childCount).toBeUndefined();
    expect(uncached?.moons).toBeUndefined();
  });

  it('carries size through for files and notebooks and parses the timestamp', () => {
    const inputs = entriesToBodyInputs(listing, byDir, false);
    expect(inputs.find((b) => b.path === 'alpha.ipynb')?.bytes).toBe(49_152);
    expect(inputs.find((b) => b.path === 'notes.md')?.bytes).toBe(1229);
    expect(inputs[0].modifiedAt).toBe(NOW - DAY);
  });

  it('parks an unparseable timestamp on the rim rather than in "today"', () => {
    const [only] = entriesToBodyInputs([entry('weird.py', 'file', { lastModified: 'nope' })], {}, false);
    expect(only.modifiedAt).toBe(0);
    expect(makeBody(only, NOW).band).toBe('older');
  });
});

describe('labels and shapes', () => {
  it('strips .ipynb from notebook names only', () => {
    expect(displayName({ name: 'hull-stress-analysis.ipynb', kind: 'notebook' })).toBe(
      'hull-stress-analysis',
    );
    expect(displayName({ name: 'notes.md', kind: 'file' })).toBe('notes.md');
    expect(displayName({ name: 'experiments', kind: 'directory' })).toBe('experiments');
  });

  it('formats byte counts the way the detail card quotes them', () => {
    expect(formatBytes(72)).toBe('72 B');
    expect(formatBytes(49_152)).toBe('48 KB');
    expect(formatBytes(1229)).toBe('1.2 KB');
    expect(formatBytes(1_258_291)).toBe('1.2 MB');
    expect(formatBytes(0)).toBe('0 B');
  });

  it('draws a closed, deterministic, jittered hexagon for a file', () => {
    const d = asteroidPath('data/readings.csv', 4);
    expect(d).toBe(asteroidPath('data/readings.csv', 4));
    expect(d).not.toBe(asteroidPath('data/other.csv', 4));
    expect(d.startsWith('M ')).toBe(true);
    expect(d.endsWith(' Z')).toBe(true);
    const radii = d
      .slice(2, -2)
      .split(' L ')
      .map((pair) => {
        const [x, y] = pair.split(' ').map(Number);
        return Math.hypot(x, y);
      });
    expect(radii).toHaveLength(6);
    for (const r of radii) {
      expect(r).toBeGreaterThanOrEqual(4 * 0.7 - 1e-9);
      expect(r).toBeLessThanOrEqual(4 * 1.3 + 1e-9);
    }
  });
});

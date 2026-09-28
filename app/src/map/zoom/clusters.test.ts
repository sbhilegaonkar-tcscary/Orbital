import { describe, expect, it } from 'vitest';

import type { Band } from '../model';
import {
  CLUSTER_POINT_CAP,
  CLUSTER_POINT_FLOOR,
  DEFAULT_SPREAD,
  clusterFor,
  clusterPointCount,
  clusterRadius,
  cosmicWeb,
  looseField,
  spreadGalaxies,
  type Placed,
  type PlacedAt,
  type WebNode,
} from './clusters';

const SEEDS = ['experiments', 'data', 'rigs', 'archive', '.ipynb_checkpoints', 'a', ''];

describe('clusterPointCount', () => {
  it('never draws fewer than the floor or more than the cap', () => {
    expect(clusterPointCount(0)).toBe(CLUSTER_POINT_FLOOR);
    expect(clusterPointCount(-5)).toBe(CLUSTER_POINT_FLOOR);
    expect(clusterPointCount(10_000)).toBe(CLUSTER_POINT_CAP);
    expect(clusterPointCount(Number.NaN)).toBe(CLUSTER_POINT_FLOOR);
  });

  it('is monotonic in descendants', () => {
    let previous = 0;
    for (let n = 0; n <= 400; n += 1) {
      const count = clusterPointCount(n);
      expect(count).toBeGreaterThanOrEqual(previous);
      expect(count).toBeLessThanOrEqual(CLUSTER_POINT_CAP);
      previous = count;
    }
  });

  it('reaches the cap where the spec says it does', () => {
    expect(clusterPointCount(70)).toBeLessThan(CLUSTER_POINT_CAP);
    expect(clusterPointCount(79)).toBe(CLUSTER_POINT_CAP);
    expect(clusterPointCount(100)).toBe(CLUSTER_POINT_CAP);
  });
});

describe('clusterRadius', () => {
  it('never exceeds the room it is given', () => {
    for (const n of [0, 1, 9, 60, 200, 5000]) {
      const r = clusterRadius(n, 90);
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThanOrEqual(90);
    }
  });

  it('grows with descendants, sub-linearly', () => {
    expect(clusterRadius(4, 200)).toBeGreaterThan(clusterRadius(1, 200));
    expect(clusterRadius(100, 200) / clusterRadius(10, 200)).toBeLessThan(3);
  });
});

describe('clusterFor', () => {
  it('is deterministic for a seed', () => {
    for (const seed of SEEDS) {
      expect(clusterFor(seed, 24, 70)).toEqual(clusterFor(seed, 24, 70));
    }
  });

  it('keeps every star inside the disc', () => {
    for (const seed of SEEDS) {
      for (const desc of [0, 7, 55, 300]) {
        const cluster = clusterFor(seed, desc, 64);
        expect(cluster.stars).toHaveLength(clusterPointCount(desc));
        for (const star of cluster.stars) {
          expect(Math.hypot(star.x, star.y)).toBeLessThanOrEqual(64 + 1e-9);
          expect(star.r).toBeGreaterThanOrEqual(0.35);
          expect(star.r).toBeLessThanOrEqual(1.8);
          expect([0, 1, 2]).toContain(star.tier);
        }
      }
    }
  });

  it('produces both shapes, and only two of them', () => {
    const shapes = new Set(
      Array.from({ length: 60 }, (_, i) => clusterFor(`folder-${i}`, 12, 60).shape),
    );
    expect(shapes).toEqual(new Set(['spiral', 'elliptical']));
  });

  it('gives spirals arms and ellipticals none', () => {
    for (let i = 0; i < 60; i += 1) {
      const cluster = clusterFor(`folder-${i}`, 12, 60);
      if (cluster.shape === 'spiral') expect([2, 3]).toContain(cluster.arms);
      else expect(cluster.arms).toBe(0);
    }
  });

  it('keeps the disc squashed but not collapsed', () => {
    for (const seed of SEEDS) {
      const cluster = clusterFor(seed, 30, 60);
      expect(cluster.squash).toBeGreaterThan(0.4);
      expect(cluster.squash).toBeLessThanOrEqual(1);
      expect(Math.abs(cluster.tilt)).toBeLessThanOrEqual(35);
      expect(cluster.coreRx).toBeGreaterThan(cluster.coreRy);
    }
  });

  it('gives different folders different skies', () => {
    const a = clusterFor('experiments', 30, 60);
    const b = clusterFor('data', 30, 60);
    expect(a.stars).not.toEqual(b.stars);
  });

  it('scales with the radius it is handed', () => {
    const small = clusterFor('data', 30, 30);
    const large = clusterFor('data', 30, 60);
    expect(large.stars[5].x).toBeCloseTo(small.stars[5].x * 2, 6);
  });
});

describe('looseField', () => {
  it('keeps every point inside the ellipse', () => {
    const points = looseField('loose', 40, 90, 55);
    expect(points).toHaveLength(40);
    for (const p of points) {
      expect((p.x / 90) ** 2 + (p.y / 55) ** 2).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('is deterministic and handles a degenerate count', () => {
    expect(looseField('loose', 12, 80, 50)).toEqual(looseField('loose', 12, 80, 50));
    expect(looseField('loose', 0, 80, 50)).toEqual([]);
    expect(looseField('loose', -3, 80, 50)).toEqual([]);
  });
});

describe('cosmicWeb', () => {
  function node(id: string, x: number, y: number, band: Band): WebNode {
    return { id, x, y, band };
  }

  it('links only folders in the same band', () => {
    const links = cosmicWeb([
      node('a', 0, -100, 'today'),
      node('b', 100, 0, 'today'),
      node('c', 0, 100, 'week'),
      node('d', -100, 0, 'older'),
    ]);
    expect(links).toHaveLength(1);
    expect(new Set([links[0].from, links[0].to])).toEqual(new Set(['a', 'b']));
  });

  it('draws a chord for a pair and a loop for three or more', () => {
    const three: WebNode[] = [
      node('a', 0, -100, 'today'),
      node('b', 100, 60, 'today'),
      node('c', -100, 60, 'today'),
    ];
    expect(cosmicWeb(three)).toHaveLength(3);
    expect(cosmicWeb(three.slice(0, 2))).toHaveLength(1);
    expect(cosmicWeb(three.slice(0, 1))).toHaveLength(0);
    expect(cosmicWeb([])).toHaveLength(0);
  });

  it('never links a node to itself', () => {
    const links = cosmicWeb([
      node('a', 0, -100, 'month'),
      node('b', 100, 60, 'month'),
      node('c', -100, 60, 'month'),
      node('d', 10, 10, 'month'),
    ]);
    for (const link of links) expect(link.from).not.toBe(link.to);
  });

  it('bows the control point off the chord', () => {
    const [link] = cosmicWeb([node('a', -100, 0, 'today'), node('b', 100, 0, 'today')], 30);
    const mx = (link.x1 + link.x2) / 2;
    const my = (link.y1 + link.y2) / 2;
    expect(Math.hypot(link.cx - mx, link.cy - my)).toBeCloseTo(30, 6);
  });

  it('does not depend on the order it is given', () => {
    const nodes = [
      node('a', 0, -100, 'today'),
      node('b', 100, 60, 'today'),
      node('c', -100, 60, 'today'),
    ];
    const forwards = cosmicWeb(nodes);
    const backwards = cosmicWeb([...nodes].reverse());
    const key = (l: (typeof forwards)[number]) => [l.from, l.to].sort().join('-');
    expect(forwards.map(key).sort()).toEqual(backwards.map(key).sort());
  });
});

describe('spreadGalaxies', () => {
  const crowded: Placed[] = [
    { id: 'a', radius: 40, r: 180, angle: 0.2 },
    { id: 'b', radius: 46, r: 190, angle: 0.3 },
    { id: 'c', radius: 30, r: 175, angle: 0.34 },
    { id: 'd', radius: 52, r: 210, angle: 2.4 },
    { id: 'e', radius: 28, r: 120, angle: 2.5 },
  ];

  it('separates every pair it can', () => {
    const placed = spreadGalaxies(crowded);
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i];
        const b = placed[j];
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.radius + b.radius);
      }
    }
  });

  it('moves in angle only, so distance from the centre still means age', () => {
    for (const spread of [1, DEFAULT_SPREAD, 2.4]) {
      const placed = spreadGalaxies(crowded, undefined, spread);
      for (const item of placed) {
        const original = crowded.find((c) => c.id === item.id)!;
        expect(Math.hypot(item.x, item.y)).toBeCloseTo(original.r * spread, 6);
        expect(item.radius).toBe(original.radius);
      }
    }
  });

  it('is deterministic and order-independent', () => {
    const forwards = spreadGalaxies(crowded);
    const backwards = spreadGalaxies([...crowded].reverse());
    expect(forwards).toEqual(backwards);
    expect(spreadGalaxies(crowded)).toEqual(forwards);
  });

  it('is deterministic at every spread, and defaults to DEFAULT_SPREAD', () => {
    expect(DEFAULT_SPREAD).toBe(1.5);
    expect(spreadGalaxies(crowded)).toEqual(spreadGalaxies(crowded, undefined, DEFAULT_SPREAD));
    for (const spread of [1, 1.25, DEFAULT_SPREAD]) {
      const once = spreadGalaxies(crowded, undefined, spread);
      expect(spreadGalaxies([...crowded].reverse(), undefined, spread)).toEqual(once);
      expect(spreadGalaxies(crowded, undefined, spread)).toEqual(once);
    }
  });

  // Already apart, so the angular relaxation has nothing to do and `spread` is
  // the only thing acting on the layout.
  const roomy: Placed[] = [
    { id: 'a', radius: 12, r: 120, angle: 0 },
    { id: 'b', radius: 12, r: 150, angle: 2.1 },
    { id: 'c', radius: 14, r: 180, angle: 4.2 },
  ];

  function closestPair(placed: PlacedAt[]): number {
    let min = Infinity;
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        min = Math.min(min, Math.hypot(placed[i].x - placed[j].x, placed[i].y - placed[j].y));
      }
    }
    return min;
  }

  it('pushes the closest pair of centres further apart as spread grows', () => {
    const steps = [1, 1.25, DEFAULT_SPREAD, 2, 3];
    const base = closestPair(spreadGalaxies(roomy, undefined, 1));
    for (let i = 1; i < steps.length; i += 1) {
      const wider = closestPair(spreadGalaxies(roomy, undefined, steps[i]));
      expect(wider).toBeGreaterThan(closestPair(spreadGalaxies(roomy, undefined, steps[i - 1])));
      // Nothing to relax, so the whole layout is exactly `spread` times as wide.
      expect(wider).toBeCloseTo(base * steps[i], 6);
    }
  });

  it('never lets a crowded set close up, whatever the spread', () => {
    for (const spread of [1, 1.25, DEFAULT_SPREAD, 3]) {
      const placed = spreadGalaxies(crowded, undefined, spread);
      for (let i = 0; i < placed.length; i += 1) {
        for (let j = i + 1; j < placed.length; j += 1) {
          const a = placed[i];
          const b = placed[j];
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.radius + b.radius);
        }
      }
      // The radial extent, which the relaxation never touches, always grows.
      expect(Math.max(...placed.map((p) => Math.hypot(p.x, p.y)))).toBeCloseTo(
        Math.max(...crowded.map((c) => c.r)) * spread,
        6,
      );
    }
  });

  it('leaves the discs their own size, so only the layout grows', () => {
    const tight = spreadGalaxies(crowded, undefined, 1);
    const wide = spreadGalaxies(crowded, undefined, 3);
    expect(wide.map((p) => p.radius)).toEqual(tight.map((p) => p.radius));
    expect(wide.map((p) => p.id)).toEqual(tight.map((p) => p.id));
  });

  it('separates two clusters that start at the identical angle', () => {
    const placed = spreadGalaxies([
      { id: 'a', radius: 30, r: 160, angle: 1 },
      { id: 'b', radius: 30, r: 160, angle: 1 },
    ]);
    expect(Math.hypot(placed[0].x - placed[1].x, placed[0].y - placed[1].y)).toBeGreaterThan(60);
  });

  it('handles trivial inputs', () => {
    expect(spreadGalaxies([])).toEqual([]);
    expect(spreadGalaxies([], undefined, 2)).toEqual([]);
    const one = spreadGalaxies([{ id: 'a', radius: 20, r: 100, angle: 0 }], undefined, 1);
    expect(one[0].x).toBeCloseTo(100, 6);
    expect(one[0].y).toBeCloseTo(0, 6);
    const spread = spreadGalaxies([{ id: 'a', radius: 20, r: 100, angle: 0 }]);
    expect(spread[0].x).toBeCloseTo(100 * DEFAULT_SPREAD, 6);
    expect(spread[0].y).toBeCloseTo(0, 6);
  });
});

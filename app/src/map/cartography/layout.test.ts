/**
 * The layout contract: whatever the system, the plate is legible.
 *
 * These are the four properties the composition is allowed to be judged on -
 * nothing overlaps, nothing escapes the stage, age still reads as distance,
 * and the same input draws the same plate. Everything else about the picture
 * is taste and lives in the component.
 */
import { describe, expect, it } from 'vitest';

import { DAY, HOUR, layoutSystem, type Body, type BodyInput } from '../model';
import {
  SPREAD_DEFAULT,
  ageOf,
  layoutCartography,
  moonFan,
  quadAngle,
  quadAt,
  sizeT,
} from './layout';
import { RING_REACH, characterIndex } from './sigils';

const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);
const STAGES: [number, number][] = [
  [900, 600],
  [1400, 900],
];
/** The two stages the view actually hands a renderer (view minus explorer). */
const HOSTS: [number, number][] = [
  [900, 640],
  [560, 500],
];

const MIN_AGE = HOUR;
const MAX_AGE = 730 * DAY;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** `n` folders with ages spread log-evenly over the whole two-year range. */
function worldsOf(n: number, extra: BodyInput[] = []): Body[] {
  const inputs: BodyInput[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = n === 1 ? 0 : i / (n - 1);
    const age = MIN_AGE * (MAX_AGE / MIN_AGE) ** t;
    inputs.push({
      path: `folder-${pad(i)}`,
      name: `folder-${pad(i)}`,
      kind: 'directory',
      modifiedAt: NOW - age,
      childCount: 2 + ((i * 7) % 40),
    });
  }
  return layoutSystem([...inputs, ...extra], NOW);
}

function mixedSystem(): Body[] {
  const extra: BodyInput[] = [];
  for (let i = 0; i < 9; i += 1) {
    extra.push({
      path: `notebook-${pad(i)}.ipynb`,
      name: `notebook-${pad(i)}.ipynb`,
      kind: 'notebook',
      modifiedAt: NOW - MIN_AGE * (MAX_AGE / MIN_AGE) ** (i / 8),
      bytes: 4096 * (i + 1),
    });
  }
  for (let i = 0; i < 14; i += 1) {
    extra.push({
      path: `loose-${pad(i)}.csv`,
      name: `loose-${pad(i)}.csv`,
      kind: 'file',
      modifiedAt: NOW - MIN_AGE * (MAX_AGE / MIN_AGE) ** (i / 13),
      bytes: 900 * (i + 1) ** 3,
    });
  }
  return worldsOf(6, extra);
}

/** Spearman rank correlation, which is what "monotonic on average" means. */
function spearman(pairs: [number, number][]): number {
  const rank = (values: number[]): number[] => {
    const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    const out = new Array<number>(values.length);
    order.forEach(([, i], r) => {
      out[i] = r;
    });
    return out;
  };
  const rx = rank(pairs.map((p) => p[0]));
  const ry = rank(pairs.map((p) => p[1]));
  const n = pairs.length;
  let d2 = 0;
  for (let i = 0; i < n; i += 1) d2 += (rx[i] - ry[i]) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

describe('layoutCartography', () => {
  for (const [w, h] of [...STAGES, ...HOSTS]) {
    describe(`${w}x${h}`, () => {
      it('never overlaps two worlds, for 1 to 30 of them', () => {
        for (let n = 1; n <= 30; n += 1) {
          const plate = layoutCartography({ width: w, height: h, bodies: worldsOf(n) });
          expect(plate.worlds).toHaveLength(n);
          for (let i = 0; i < plate.worlds.length; i += 1) {
            for (let j = i + 1; j < plate.worlds.length; j += 1) {
              const a = plate.worlds[i];
              const b = plate.worlds[j];
              const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
              expect(
                gap,
                `n=${n} ${a.path} vs ${b.path} overlap by ${(-gap).toFixed(1)}px`,
              ).toBeGreaterThan(-0.5);
            }
          }
        }
      });

      it('keeps a ringed world clear of its neighbours, rings and all', () => {
        // Bridge draws the ringed character's rings out to RING_REACH x its
        // radius, so the solver has to give that world the room, or two
        // worlds that do not overlap still look like they collided.
        for (let n = 2; n <= 20; n += 1) {
          const plate = layoutCartography({ width: w, height: h, bodies: worldsOf(n) });
          for (const a of plate.worlds) {
            if (characterIndex(a.label) !== 3) continue;
            for (const b of plate.worlds) {
              if (b.path === a.path) continue;
              const reach = a.r * RING_REACH + b.r;
              expect(
                Math.hypot(a.x - b.x, a.y - b.y),
                `n=${n} ${b.path} inside ${a.path}'s rings`,
              ).toBeGreaterThan(reach - 1);
            }
          }
        }
      });

      it('never puts a world over the inner court', () => {
        for (let n = 1; n <= 30; n += 1) {
          const plate = layoutCartography({ width: w, height: h, bodies: worldsOf(n) });
          for (const world of plate.worlds) {
            const reach = Math.hypot(world.x - plate.star.x, world.y - plate.star.y);
            expect(reach - world.r, `n=${n} ${world.path} sits on the court`).toBeGreaterThan(
              plate.star.courtR - 0.5,
            );
          }
        }
      });

      // The stage stopped being a wall when the camera arrived: the plate is
      // composed on `stage x spread` and the host is a window onto it. What
      // still has to hold is that the box the camera fits and clamps against
      // covers everything drawn — anything outside it is unreachable.
      it('covers every world, mote and court body with the exported bounds', () => {
        for (const n of [1, 5, 12, 21, 30]) {
          const plate = layoutCartography({ width: w, height: h, bodies: worldsOf(n) });
          const mixed = layoutCartography({ width: w, height: h, bodies: mixedSystem() });
          for (const plated of [plate, mixed]) {
            const { x, y, w: bw, h: bh } = plated.bounds;
            expect(bw, 'bounds have width').toBeGreaterThan(0);
            expect(bh, 'bounds have height').toBeGreaterThan(0);
            const discs = [...plated.worlds, ...plated.court, ...plated.motes];
            for (const disc of discs) {
              expect(disc.x - disc.r, `${disc.path} left of the bounds`).toBeGreaterThanOrEqual(x);
              expect(disc.x + disc.r, `${disc.path} right of the bounds`).toBeLessThanOrEqual(x + bw);
              expect(disc.y - disc.r, `${disc.path} above the bounds`).toBeGreaterThanOrEqual(y);
              expect(disc.y + disc.r, `${disc.path} below the bounds`).toBeLessThanOrEqual(y + bh);
            }
            // The star and its ring are drawn too, and the camera has to be
            // able to reach them.
            const { star } = plated;
            expect(star.x - star.orreryR).toBeGreaterThanOrEqual(x);
            expect(star.x + star.orreryR).toBeLessThanOrEqual(x + bw);
          }
        }
      });

      it('never overlaps two worlds at the default spread, for 1 to 30', () => {
        for (let n = 1; n <= 30; n += 1) {
          const plate = layoutCartography({
            width: w,
            height: h,
            bodies: worldsOf(n),
            spread: SPREAD_DEFAULT,
          });
          for (let i = 0; i < plate.worlds.length; i += 1) {
            for (let j = i + 1; j < plate.worlds.length; j += 1) {
              const a = plate.worlds[i];
              const b = plate.worlds[j];
              const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
              expect(gap, `n=${n} ${a.path} vs ${b.path}`).toBeGreaterThan(-0.5);
            }
          }
        }
      });

      it('grows distance from the star with age', () => {
        for (const n of [6, 12, 20, 30]) {
          const plate = layoutCartography({ width: w, height: h, bodies: worldsOf(n) });
          const pairs = plate.worlds.map(
            (world) =>
              [world.age, Math.hypot(world.x - plate.star.x, world.y - plate.star.y)] as [
                number,
                number,
              ],
          );
          expect(spearman(pairs), `n=${n} age/distance correlation`).toBeGreaterThan(0.6);
        }
      });
    });
  }

  it('spreads the worlds further apart as spread grows', () => {
    // The whole point of the option: more spread, more room between bodies.
    // Measured on the closest pair, because that is the one that decides
    // whether the plate reads as a composition or as a pile.
    const nearest = (spread: number, n: number, w: number, h: number): number => {
      const plate = layoutCartography({ width: w, height: h, bodies: worldsOf(n), spread });
      let min = Infinity;
      for (let i = 0; i < plate.worlds.length; i += 1) {
        for (let j = i + 1; j < plate.worlds.length; j += 1) {
          const a = plate.worlds[i];
          const b = plate.worlds[j];
          min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y));
        }
      }
      return min;
    };

    for (const [w, h] of [...STAGES, ...HOSTS]) {
      for (const n of [4, 8, 16, 30]) {
        const tight = nearest(1, n, w, h);
        const spread = nearest(SPREAD_DEFAULT, n, w, h);
        const wide = nearest(2.4, n, w, h);
        expect(spread, `${w}x${h} n=${n}: 1.7 vs 1`).toBeGreaterThan(tight);
        expect(wide, `${w}x${h} n=${n}: 2.4 vs 1.7`).toBeGreaterThan(spread);
      }
    }
  });

  it('stops shrinking the worlds to fit the host', () => {
    // On the narrow host the old fit pass squeezed the plate below 1:1 and a
    // 90 px world came out at 60. Composing on the spread extent instead is
    // what buys the size back.
    const [w, h] = HOSTS[1];
    const before = layoutCartography({ width: w, height: h, bodies: worldsOf(6), spread: 1 });
    const after = layoutCartography({ width: w, height: h, bodies: worldsOf(6) });
    expect(before.scale).toBeLessThan(1);
    expect(after.scale).toBeGreaterThan(before.scale);
    for (const world of after.worlds) {
      const was = before.worlds.find((v) => v.path === world.path);
      expect(world.r, `${world.path} is no smaller than it was`).toBeGreaterThan(was?.r ?? 0);
    }
  });

  it('opens the inner court by the spread s linear share', () => {
    const bodies = mixedSystem();
    const tight = layoutCartography({ width: 1400, height: 900, bodies, spread: 1 });
    const spread = layoutCartography({ width: 1400, height: 900, bodies });
    // sqrt(1.7) = 1.304, and both plates fit at scale 1 on this stage.
    expect(tight.scale).toBe(1);
    expect(spread.scale).toBe(1);
    expect(spread.star.courtR / tight.star.courtR).toBeCloseTo(Math.sqrt(SPREAD_DEFAULT), 2);
  });

  it('draws the same plate twice', () => {
    const bodies = mixedSystem();
    const once = layoutCartography({ width: 900, height: 640, bodies, flightPath: ['folder-01'] });
    const twice = layoutCartography({
      width: 900,
      height: 640,
      bodies: [...bodies].reverse(),
      flightPath: ['folder-01'],
    });
    expect(JSON.stringify(twice.worlds)).toBe(JSON.stringify(once.worlds));
    expect(JSON.stringify(twice.court)).toBe(JSON.stringify(once.court));
    expect(JSON.stringify(twice.motes)).toBe(JSON.stringify(once.motes));
    expect(twice.belt.d).toBe(once.belt.d);
    expect(twice.belt.capD).toBe(once.belt.capD);
    expect(twice.connectors.map((c) => c.id)).toEqual(once.connectors.map((c) => c.id));
  });

  it('sizes a world by descendants when they are known, by childCount when not', () => {
    const bodies = worldsOf(3);
    const bare = layoutCartography({ width: 1400, height: 900, bodies });
    const known = layoutCartography({
      width: 1400,
      height: 900,
      bodies,
      descendants: { 'folder-00': 400 },
    });
    const before = bare.worlds.find((v) => v.path === 'folder-00');
    const after = known.worlds.find((v) => v.path === 'folder-00');
    expect(after?.count).toBe(400);
    expect(after?.r ?? 0).toBeGreaterThan(before?.r ?? 0);
  });

  it('chains a band rather than cliqueing it, and caps the string', () => {
    // Twelve worlds over two years land several to a band. A chain is n-1
    // edges where a clique would be n(n-1)/2, and the whole plate is capped.
    const plate = layoutCartography({ width: 1400, height: 900, bodies: worldsOf(12) });
    const counts = new Map<string, number>();
    for (const world of plate.worlds) counts.set(world.band, (counts.get(world.band) ?? 0) + 1);
    let chained = 0;
    let clique = 0;
    for (const count of counts.values()) {
      chained += Math.max(0, count - 1);
      clique += (count * (count - 1)) / 2;
    }
    expect(clique).toBeGreaterThan(chained);
    const bands = plate.connectors.filter((c) => c.kind === 'band');
    expect(bands.length).toBe(Math.min(chained, 8));
  });

  it('never strings two threads down the same pair of bodies', () => {
    const bodies = mixedSystem();
    const plate = layoutCartography({
      width: 1400,
      height: 900,
      bodies,
      flightPath: bodies.filter((b) => b.kind === 'notebook').map((b) => b.path),
    });
    const seen = new Set<string>();
    for (const c of plate.connectors) {
      const key = c.from < c.to ? `${c.from}|${c.to}` : `${c.to}|${c.from}`;
      expect(seen.has(key), `${key} strung twice`).toBe(false);
      seen.add(key);
    }
  });

  it('draws a wake only between different bodies, capped at four', () => {
    const bodies = mixedSystem();
    const flightPath = [
      'folder-00/a.ipynb',
      'folder-01/b.ipynb',
      'folder-01/c.ipynb', // same parent as the one before: no thread
      'folder-02/d.ipynb',
      'folder-03/e.ipynb',
      'folder-04/f.ipynb',
      'folder-05/g.ipynb',
      'folder-00/h.ipynb',
    ];
    const plate = layoutCartography({ width: 1400, height: 900, bodies, flightPath });
    const wakes = plate.connectors.filter((c) => c.kind === 'wake');
    expect(wakes).toHaveLength(4);
    for (const wake of wakes) expect(wake.from).not.toBe(wake.to);
  });

  it('places a label for every world', () => {
    const plate = layoutCartography({ width: 900, height: 640, bodies: mixedSystem() });
    for (const world of plate.worlds) expect(plate.labels.has(world.path)).toBe(true);
  });

  it('survives an empty system', () => {
    const plate = layoutCartography({ width: 900, height: 640, bodies: [] });
    expect(plate.worlds).toHaveLength(0);
    expect(plate.court).toHaveLength(0);
    expect(plate.motes).toHaveLength(0);
    expect(plate.star.r).toBeGreaterThan(0);
    expect(plate.belt.d.startsWith('M')).toBe(true);
    // The caption rides the belt backwards, and a little outside it, so it
    // reads upright and does not sit among the motes.
    const points = (d: string): [number, number][] =>
      d
        .slice(1)
        .split(/[ML]/)
        .map((p) => p.trim().split(' ').map(Number) as [number, number]);
    const belt = points(plate.belt.d);
    const cap = points(plate.belt.capD);
    const near = (a: [number, number], b: [number, number]): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
    expect(cap).toHaveLength(belt.length);
    // It starts where the belt ends...
    expect(near(cap[0], belt[belt.length - 1])).toBeLessThan(near(cap[0], belt[0]));
    // ...and runs outside it the whole way.
    for (let i = 0; i < cap.length; i += 1) {
      expect(near(cap[i], belt[belt.length - 1 - i])).toBeGreaterThan(4);
    }
  });

  it('survives a zero-sized stage without producing NaN', () => {
    const plate = layoutCartography({ width: 0, height: 0, bodies: worldsOf(4) });
    for (const world of plate.worlds) {
      expect(Number.isFinite(world.x)).toBe(true);
      expect(Number.isFinite(world.y)).toBe(true);
      expect(Number.isFinite(world.r)).toBe(true);
    }
  });
});

describe('helpers', () => {
  it('maps orbit onto 0..1 age', () => {
    const [young, old] = worldsOf(2);
    expect(ageOf(young)).toBeLessThan(0.05);
    expect(ageOf(old)).toBeGreaterThan(0.95);
  });

  it('log-scales the size term', () => {
    expect(sizeT(0)).toBe(0);
    expect(sizeT(200)).toBeCloseTo(1, 5);
    expect(sizeT(1000)).toBe(1);
    // Halfway in log space, not in linear space.
    expect(sizeT(13)).toBeGreaterThan(0.45);
    expect(sizeT(13)).toBeLessThan(0.55);
  });

  it('samples a quadratic and its tangent', () => {
    const p0 = [0, 0] as const;
    const c = [50, 100] as const;
    const p1 = [100, 0] as const;
    expect(quadAt(p0, c, p1, 0)).toEqual({ x: 0, y: 0 });
    expect(quadAt(p0, c, p1, 1)).toEqual({ x: 100, y: 0 });
    expect(quadAt(p0, c, p1, 0.5)).toEqual({ x: 50, y: 50 });
    // The apex is flat.
    expect(quadAngle(p0, c, p1, 0.5)).toBeCloseTo(0, 6);
  });
});

describe('moonFan', () => {
  const children: BodyInput[] = Array.from({ length: 17 }, (_, i) => {
    const kind = i % 5 === 0 ? 'directory' : i % 3 === 0 ? 'file' : 'notebook';
    const name = kind === 'notebook' ? `child-${pad(i)}.ipynb` : `child-${pad(i)}`;
    return { path: `folder/${name}`, name, kind, modifiedAt: NOW - HOUR * (i + 1) };
  });

  it('caps at ten and counts the rest', () => {
    const fan = moonFan(children, 60);
    expect(fan.moons).toHaveLength(10);
    expect(fan.extra).toBe(7);
    expect(fan.orbitR).toBeGreaterThan(60);
  });

  it('puts every moon on the ring and strips the .ipynb', () => {
    const fan = moonFan(children.slice(0, 4), 40);
    expect(fan.extra).toBe(0);
    for (const moon of fan.moons) {
      expect(Math.hypot(moon.x, moon.y)).toBeCloseTo(fan.orbitR, 0);
      expect(moon.label.endsWith('.ipynb')).toBe(false);
    }
  });

  it('anchors a moon caption away from the world', () => {
    const fan = moonFan(children.slice(0, 8), 50);
    for (const moon of fan.moons) {
      expect(moon.anchor).toBe(moon.x >= -1 ? 'start' : 'end');
      expect(Math.hypot(moon.lx, moon.ly)).toBeGreaterThan(Math.hypot(moon.x, moon.y));
    }
  });
});

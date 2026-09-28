import { describe, expect, it } from 'vitest';

import {
  FADE_MS,
  FLY_MS,
  IDENTITY,
  K_BASE,
  MAX_LEVEL_JUMP,
  REBASE_MS,
  apply,
  camMatrix,
  depthOf,
  flyPlan,
  flyScale,
  levelFor,
  levelForDir,
  multiply,
  nestMatrix,
  restingMatrix,
  toCss,
  toSvg,
  type Matrix,
} from './camera';

const FOCI = [
  { x: 0, y: 0 },
  { x: 450, y: 320 },
  { x: -120.5, y: 640 },
  { x: 1280, y: 800 },
  { x: 1, y: -1 },
];
const SCALES = [1.0001, 1.5, 5.5, 30.25, 166.375];
const PROBES = [
  { x: 0, y: 0 },
  { x: 7, y: -19 },
  { x: 900, y: 640 },
  { x: -300, y: 120.25 },
];

function expectClose(m: Matrix, n: Matrix, eps = 1e-9): void {
  for (const key of ['a', 'b', 'c', 'd', 'e', 'f'] as const) {
    expect(Math.abs(m[key] - n[key])).toBeLessThan(eps);
  }
}

describe('depth rule', () => {
  it('counts the workspace root as depth 1', () => {
    expect(depthOf('')).toBe(1);
  });

  it('counts one segment per level below the root', () => {
    expect(depthOf('data')).toBe(2);
    expect(depthOf('experiments/sweeps')).toBe(3);
    expect(depthOf('experiments/sweeps/plots')).toBe(4);
    expect(depthOf('a/b/c/d/e')).toBe(6);
  });

  it('ignores stray separators', () => {
    expect(depthOf('/')).toBe(1);
    expect(depthOf('data/')).toBe(2);
    expect(depthOf('/data')).toBe(2);
  });

  it('maps depth to the four levels', () => {
    expect(levelFor(1)).toBe('galaxy');
    expect(levelFor(2)).toBe('system');
    expect(levelFor(3)).toBe('moons');
    expect(levelFor(4)).toBe('chart');
    expect(levelFor(9)).toBe('chart');
    // Defensive: a depth below 1 cannot happen, but must not fall through.
    expect(levelFor(0)).toBe('galaxy');
  });

  it('maps directories straight to levels', () => {
    expect(levelForDir('')).toBe('galaxy');
    expect(levelForDir('data')).toBe('system');
    expect(levelForDir('data/raw')).toBe('moons');
    expect(levelForDir('experiments/sweeps/plots')).toBe('chart');
  });
});

describe('flyScale', () => {
  it('is one magnification per level', () => {
    expect(flyScale(1, 2)).toBeCloseTo(K_BASE, 10);
    expect(flyScale(2, 1)).toBeCloseTo(K_BASE, 10);
    expect(flyScale(1, 3)).toBeCloseTo(K_BASE ** 2, 10);
  });

  it('clamps breadcrumb jumps of more than one level', () => {
    const capped = K_BASE ** MAX_LEVEL_JUMP;
    expect(flyScale(1, 4)).toBeCloseTo(capped, 10);
    expect(flyScale(1, 9)).toBeCloseTo(capped, 10);
    expect(flyScale(6, 1)).toBeCloseTo(capped, 10);
  });

  it('is 1 for no movement', () => {
    expect(flyScale(3, 3)).toBe(1);
  });
});

describe('the nesting matrix', () => {
  it('is the exact inverse of the camera, so the rebase cannot jump', () => {
    for (const k of SCALES) {
      for (const f of FOCI) {
        expectClose(multiply(camMatrix(k, f.x, f.y), nestMatrix(k, f.x, f.y)), IDENTITY, 1e-9);
        expectClose(multiply(nestMatrix(k, f.x, f.y), camMatrix(k, f.x, f.y)), IDENTITY, 1e-9);
      }
    }
  });

  it('round-trips every probe point through camera ∘ nest', () => {
    for (const k of SCALES) {
      for (const f of FOCI) {
        const cam = camMatrix(k, f.x, f.y);
        const nest = nestMatrix(k, f.x, f.y);
        for (const p of PROBES) {
          const back = apply(cam, apply(nest, p));
          expect(back.x).toBeCloseTo(p.x, 6);
          expect(back.y).toBeCloseTo(p.y, 6);
        }
      }
    }
  });

  it('holds the focus point still', () => {
    for (const k of SCALES) {
      for (const f of FOCI) {
        const moved = apply(camMatrix(k, f.x, f.y), f);
        expect(moved.x).toBeCloseTo(f.x, 6);
        expect(moved.y).toBeCloseTo(f.y, 6);
      }
    }
  });

  it('magnifies distances from the focus by k', () => {
    const k = 5.5;
    const f = { x: 300, y: 200 };
    const p = { x: 340, y: 200 };
    const moved = apply(camMatrix(k, f.x, f.y), p);
    expect(moved.x - f.x).toBeCloseTo((p.x - f.x) * k, 6);
  });

  it('starts the child level inside the clicked body', () => {
    // The whole stage, nested for a dive into (300, 200), must end up inside a
    // disc of 1/k the stage's own radius around that point.
    const k = 5.5;
    const f = { x: 300, y: 200 };
    const nest = nestMatrix(k, f.x, f.y);
    const corners = [
      { x: 0, y: 0 },
      { x: 900, y: 0 },
      { x: 0, y: 640 },
      { x: 900, y: 640 },
    ];
    for (const corner of corners) {
      const inside = apply(nest, corner);
      const before = Math.hypot(corner.x - f.x, corner.y - f.y);
      const after = Math.hypot(inside.x - f.x, inside.y - f.y);
      expect(after).toBeCloseTo(before / k, 6);
    }
  });
});

describe('transform strings', () => {
  it('writes the camera as CSS pixels and the nest as SVG user units', () => {
    expect(toCss(camMatrix(2, 100, 50))).toBe('translate(-100px, -50px) scale(2)');
    expect(toSvg(nestMatrix(2, 100, 50))).toBe('translate(50 25) scale(0.5)');
  });

  it('rounds rather than emitting float noise', () => {
    expect(toCss(camMatrix(1 / 3, 10, 10))).toBe('translate(6.667px, 6.667px) scale(0.333)');
  });
});

describe('flyPlan', () => {
  it('nests the arriving level and zooms the camera in', () => {
    const plan = flyPlan(1, 2, { x: 240, y: 230 });
    expect(plan).not.toBeNull();
    expect(plan!.direction).toBe('in');
    expect(plan!.k).toBeCloseTo(K_BASE, 10);
    expect(plan!.leavingTransform).toBe('');
    expect(plan!.arrivingTransform).toBe(toSvg(nestMatrix(K_BASE, 240, 230)));
    expect(plan!.cameraFrom).toBe('none');
    expect(plan!.cameraTo).toBe(toCss(camMatrix(K_BASE, 240, 230)));
  });

  it('is the exact inverse flying out', () => {
    const focus = { x: 240, y: 230 };
    const into = flyPlan(1, 2, focus)!;
    const back = flyPlan(2, 1, focus)!;
    expect(back.direction).toBe('out');
    expect(back.k).toBeCloseTo(into.k, 10);
    expect(back.leavingTransform).toBe(into.arrivingTransform);
    expect(back.arrivingTransform).toBe(into.leavingTransform);
    expect(back.cameraFrom).toBe(into.cameraTo);
    expect(back.cameraTo).toBe(into.cameraFrom);
  });

  it('has nothing to fly when the depth does not change', () => {
    expect(flyPlan(2, 2, { x: 0, y: 0 })).toBeNull();
  });

  it('leaves the arriving level exactly at identity, both directions', () => {
    for (const f of FOCI) {
      for (const [from, to] of [
        [1, 2],
        [2, 3],
        [3, 4],
        [1, 4],
        [4, 1],
        [3, 2],
        [2, 1],
      ]) {
        const plan = flyPlan(from, to, f)!;
        expectClose(restingMatrix(plan), IDENTITY, 1e-9);
      }
    }
  });
});

describe('timings', () => {
  it('fades the departing level 200 ms before the camera lands', () => {
    expect(FLY_MS - FADE_MS).toBe(200);
  });

  it('rebases only after the camera transition can have finished', () => {
    expect(REBASE_MS).toBeGreaterThan(FLY_MS);
  });
});

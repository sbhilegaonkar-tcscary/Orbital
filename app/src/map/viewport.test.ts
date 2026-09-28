/**
 * The camera contract. Node environment: `viewport.ts` is pure arithmetic and
 * the properties below are the ones every renderer is allowed to rely on.
 */
import { describe, expect, it } from 'vitest';

import {
  K_MAX,
  K_MIN,
  cameraTransform,
  centerOn,
  clampToBounds,
  fitBox,
  panBy,
  screenToWorld,
  zoomAt,
  type Box,
  type Camera,
} from './viewport';

const VIEW = { w: 960, h: 720 };
const PLATE: Box = { x: -200, y: -120, w: 1600, h: 1100 };

/** The contract itself, applied forwards, so tests can assert against it. */
function project(c: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: wx * c.k + c.x, y: wy * c.k + c.y };
}

describe('cameraTransform', () => {
  it('writes a CSS transform with units on the translate', () => {
    expect(cameraTransform({ x: 12, y: -4, k: 1.5 })).toBe('translate(12px, -4px) scale(1.5)');
  });
});

describe('panBy', () => {
  it('moves the window and leaves the zoom alone', () => {
    expect(panBy({ x: 10, y: 20, k: 2 }, 5, -7)).toEqual({ x: 15, y: 13, k: 2 });
  });

  it('moves the projection of a world point by exactly the delta', () => {
    const before = { x: 30, y: 40, k: 1.8 };
    const after = panBy(before, 120, -60);
    const a = project(before, 55, 90);
    const b = project(after, 55, 90);
    expect(b.x - a.x).toBeCloseTo(120, 9);
    expect(b.y - a.y).toBeCloseTo(-60, 9);
  });
});

describe('zoomAt', () => {
  it('keeps the world point under the cursor pinned', () => {
    const before: Camera = { x: -140, y: 60, k: 0.9 };
    const world = screenToWorld(before, 300, 210);
    const after = zoomAt(before, 1.12, 300, 210);
    const back = project(after, world.x, world.y);
    expect(back.x).toBeCloseTo(300, 9);
    expect(back.y).toBeCloseTo(210, 9);
  });

  it('stays pinned even when the clamp swallows part of the factor', () => {
    const before: Camera = { x: 20, y: 20, k: K_MAX * 0.98 };
    const world = screenToWorld(before, 480, 360);
    const after = zoomAt(before, 4, 480, 360);
    expect(after.k).toBe(K_MAX);
    const back = project(after, world.x, world.y);
    expect(back.x).toBeCloseTo(480, 9);
    expect(back.y).toBeCloseTo(360, 9);
  });

  it('clamps at both ends', () => {
    expect(zoomAt({ x: 0, y: 0, k: 1 }, 0.001, 0, 0).k).toBe(K_MIN);
    expect(zoomAt({ x: 0, y: 0, k: 1 }, 1000, 0, 0).k).toBe(K_MAX);
  });

  it('is reversible at the same anchor', () => {
    const before: Camera = { x: 17, y: -33, k: 1.2 };
    const once = zoomAt(before, 1.12, 400, 250);
    const back = zoomAt(once, 1 / 1.12, 400, 250);
    expect(back.x).toBeCloseTo(before.x, 9);
    expect(back.y).toBeCloseTo(before.y, 9);
    expect(back.k).toBeCloseTo(before.k, 9);
  });
});

describe('centerOn', () => {
  it('puts the world point in the middle of the view', () => {
    const c = centerOn(430, 770, VIEW, 1);
    const p = project(c, 430, 770);
    expect(p.x).toBeCloseTo(VIEW.w / 2, 9);
    expect(p.y).toBeCloseTo(VIEW.h / 2, 9);
    expect(c.k).toBe(1);
  });

  it('clamps the zoom it is handed', () => {
    expect(centerOn(0, 0, VIEW, 99).k).toBe(K_MAX);
    expect(centerOn(0, 0, VIEW, 0).k).toBe(K_MIN);
    expect(centerOn(0, 0, VIEW, Number.NaN).k).toBe(1);
  });
});

describe('fitBox', () => {
  it('shows the whole box, centred, inside the padding', () => {
    const c = fitBox(PLATE, VIEW, 24);
    const tl = project(c, PLATE.x, PLATE.y);
    const br = project(c, PLATE.x + PLATE.w, PLATE.y + PLATE.h);
    expect(tl.x).toBeGreaterThanOrEqual(24 - 0.001);
    expect(tl.y).toBeGreaterThanOrEqual(24 - 0.001);
    expect(br.x).toBeLessThanOrEqual(VIEW.w - 24 + 0.001);
    expect(br.y).toBeLessThanOrEqual(VIEW.h - 24 + 0.001);
    // Centred: equal air either side, on both axes.
    expect(tl.x).toBeCloseTo(VIEW.w - br.x, 9);
    expect(tl.y).toBeCloseTo(VIEW.h - br.y, 9);
  });

  it('centres the box even when it is far too big to fit at K_MIN', () => {
    const huge: Box = { x: 0, y: 0, w: 40_000, h: 30_000 };
    const c = fitBox(huge, VIEW, 20);
    expect(c.k).toBe(K_MIN);
    const mid = project(c, 20_000, 15_000);
    expect(mid.x).toBeCloseTo(VIEW.w / 2, 9);
    expect(mid.y).toBeCloseTo(VIEW.h / 2, 9);
  });

  it('never zooms past K_MAX for a tiny box', () => {
    expect(fitBox({ x: 0, y: 0, w: 4, h: 3 }, VIEW, 10).k).toBe(K_MAX);
  });

  it('survives a degenerate box without producing NaN', () => {
    const c = fitBox({ x: 5, y: 5, w: 0, h: 0 }, VIEW, 10);
    expect(Number.isFinite(c.x)).toBe(true);
    expect(Number.isFinite(c.y)).toBe(true);
    expect(Number.isFinite(c.k)).toBe(true);
  });
});

describe('clampToBounds', () => {
  const OVER = 0.6;

  it('leaves a camera that is already looking at the content alone', () => {
    const c = fitBox(PLATE, VIEW, 24);
    expect(clampToBounds(c, PLATE, VIEW, OVER)).toEqual(c);
  });

  it('never lets the content be pushed entirely off screen', () => {
    for (const drag of [-9000, -1200, 1200, 9000]) {
      const c = clampToBounds(panBy(fitBox(PLATE, VIEW, 24), drag, drag), PLATE, VIEW, OVER);
      const tl = project(c, PLATE.x, PLATE.y);
      const br = project(c, PLATE.x + PLATE.w, PLATE.y + PLATE.h);
      const overlapX = Math.min(br.x, VIEW.w) - Math.max(tl.x, 0);
      const overlapY = Math.min(br.y, VIEW.h) - Math.max(tl.y, 0);
      expect(overlapX, `x overlap after ${drag}px`).toBeGreaterThan(0);
      expect(overlapY, `y overlap after ${drag}px`).toBeGreaterThan(0);
    }
  });

  it('keeps at least (1 - overscroll) of what could be shown', () => {
    const fitted = fitBox(PLATE, VIEW, 24);
    for (const over of [0, 0.3, 0.6, 0.9]) {
      const c = clampToBounds(panBy(fitted, 5000, -5000), PLATE, VIEW, over);
      const tl = project(c, PLATE.x, PLATE.y);
      const br = project(c, PLATE.x + PLATE.w, PLATE.y + PLATE.h);
      const overlapX = Math.min(br.x, VIEW.w) - Math.max(tl.x, 0);
      const wantX = (1 - over) * Math.min(VIEW.w, PLATE.w * c.k);
      expect(overlapX, `overscroll ${over}`).toBeGreaterThan(wantX - 0.001);
    }
  });

  it('allows more travel as overscroll grows', () => {
    const pushed = panBy(fitBox(PLATE, VIEW, 24), 4000, 0);
    const tight = clampToBounds(pushed, PLATE, VIEW, 0.1);
    const loose = clampToBounds(pushed, PLATE, VIEW, 0.8);
    expect(loose.x).toBeGreaterThan(tight.x);
  });

  it('does not touch the zoom', () => {
    const c: Camera = { x: 99_999, y: -99_999, k: 2.4 };
    expect(clampToBounds(c, PLATE, VIEW, OVER).k).toBe(2.4);
  });

  it('holds a plate smaller than the view without demanding it fill the view', () => {
    const small: Box = { x: 0, y: 0, w: 120, h: 90 };
    const c = clampToBounds({ x: 0, y: 0, k: 1 }, small, VIEW, 0);
    // At overscroll 0 the whole plate has to be on screen, not the whole view
    // covered - the plate is only 120x90.
    const tl = project(c, small.x, small.y);
    const br = project(c, small.x + small.w, small.y + small.h);
    expect(tl.x).toBeGreaterThanOrEqual(-0.001);
    expect(br.x).toBeLessThanOrEqual(VIEW.w + 0.001);
  });
});

describe('screenToWorld', () => {
  it('inverts the projection', () => {
    const c: Camera = { x: -320, y: 44, k: 1.7 };
    const w = screenToWorld(c, 613, 208);
    const back = project(c, w.x, w.y);
    expect(back.x).toBeCloseTo(613, 9);
    expect(back.y).toBeCloseTo(208, 9);
  });

  it('does not divide by a zero zoom', () => {
    expect(screenToWorld({ x: 0, y: 0, k: 0 }, 10, 20)).toEqual({ x: 10, y: 20 });
  });
});

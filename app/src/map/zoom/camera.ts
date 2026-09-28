/**
 * The zoom method's camera: the arithmetic behind the fly-in, and the depth
 * rule that decides which level is drawn.
 *
 * Pure — no React, no DOM — so it runs in the vitest node environment and the
 * one piece of the renderer that is easy to get subtly wrong (a level that
 * jumps a pixel when the transition ends) is provable rather than eyeballed.
 *
 * ## The nesting method (from `styleguide/map/zoom-a-galaxy.html`)
 *
 * There is one `<g class="zoom-camera">` whose CSS `transform` is the only
 * thing that animates, and two sibling level layers inside it. Flying into a
 * body at `f` means:
 *
 *   1. the arriving layer is drawn *pre-shrunk into the clicked body* with the
 *      nesting matrix `N = nest(k, f)` — a scale of `1/k` about `f`;
 *   2. the camera animates from identity to `C = cam(k, f)` — a scale of `k`
 *      about `f`.
 *
 * Because `C · N = I`, the arriving layer's on-screen position at the *end* of
 * the transition is exactly where it will sit once the camera is reset to
 * identity and the layer's own transform is dropped. That reset ("rebase") is
 * therefore pixel-identical, which is what lets the next fly-in start from a
 * clean frame instead of accumulating scale. Flying out is the same pair with
 * the roles of the two layers swapped.
 *
 * `cam()` is emitted as a CSS transform (the camera is animated by a CSS
 * transition, and CSS `transform` on an SVG element with
 * `transform-box: view-box; transform-origin: 0 0` uses the same user units as
 * the viewBox). `nest()` is emitted as an SVG `transform` attribute, which is
 * never transitioned.
 */

export interface Point {
  x: number;
  y: number;
}

/** An SVG matrix: `(x, y) → (a·x + c·y + e, b·x + d·y + f)`. */
export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** One level of descent is this much magnification. */
export const K_BASE = 5.5;
/**
 * A breadcrumb jump of more than one level would otherwise ask for
 * 5.5³ = 166× and read as a white-out; the exponent clamps here, so three
 * levels fly at the same rate two do.
 */
export const MAX_LEVEL_JUMP = 2;

/** Camera transition. */
export const FLY_MS = 800;
/** The departing level's fade; the 200 ms tail is the motion trail. */
export const FADE_MS = 600;
/** When the rebase runs: after the camera transition has certainly landed. */
export const REBASE_MS = FLY_MS + 40;

export type ZoomLevel = 'galaxy' | 'system' | 'moons' | 'chart';

/**
 * Depth of a directory path, workspace root = 1.
 *
 * The spec writes this as `dir.split('/').length`, which is off by one for the
 * root (`''.split('/')` is `['']`, and the root must count as 1 while its
 * children count as 2). This is the mockup's rule, which the spec's own
 * depth-to-level table assumes: root → galaxy, one level down → system.
 */
export function depthOf(dir: string): number {
  if (dir === '') return 1;
  return dir.split('/').filter((segment) => segment.length > 0).length + 1;
}

export function levelFor(depth: number): ZoomLevel {
  if (depth <= 1) return 'galaxy';
  if (depth === 2) return 'system';
  if (depth === 3) return 'moons';
  return 'chart';
}

export function levelForDir(dir: string): ZoomLevel {
  return levelFor(depthOf(dir));
}

/** How far the camera travels between two depths. 1 when they are the same. */
export function flyScale(fromDepth: number, toDepth: number): number {
  const levels = Math.min(Math.abs(toDepth - fromDepth), MAX_LEVEL_JUMP);
  return K_BASE ** levels;
}

// ---- matrices ---------------------------------------------------------------

/** The camera at scale `k` about `f`: `p → k·p + f·(1 − k)`. */
export function camMatrix(k: number, fx: number, fy: number): Matrix {
  return { a: k, b: 0, c: 0, d: k, e: fx * (1 - k), f: fy * (1 - k) };
}

/** The nesting matrix `N` with `cam(k, f) · N = I`: the same scale inverted. */
export function nestMatrix(k: number, fx: number, fy: number): Matrix {
  return camMatrix(1 / k, fx, fy);
}

/** `m · n`: apply `n` first, then `m`. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

export function apply(m: Matrix, p: Point): Point {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

function f3(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}

/**
 * `m` as a CSS transform. Only correct for the scale-and-translate matrices
 * this module produces, which is all the camera ever needs.
 */
export function toCss(m: Matrix): string {
  return `translate(${f3(m.e)}px, ${f3(m.f)}px) scale(${f3(m.a)})`;
}

/** `m` as an SVG `transform` attribute, same restriction as `toCss`. */
export function toSvg(m: Matrix): string {
  return `translate(${f3(m.e)} ${f3(m.f)}) scale(${f3(m.a)})`;
}

// ---- the plan the renderer executes -----------------------------------------

export interface FlyPlan {
  direction: 'in' | 'out';
  k: number;
  focus: Point;
  /** SVG `transform` for the layer that is leaving. */
  leavingTransform: string;
  /** SVG `transform` for the layer that is arriving. */
  arrivingTransform: string;
  /** Camera CSS `transform` the transition starts from (applied without it). */
  cameraFrom: string;
  /** Camera CSS `transform` the transition runs to. */
  cameraTo: string;
}

/** The identity CSS transform, written the way the renderer clears it. */
export const NO_TRANSFORM = 'none';

/**
 * Flying in, the arriving level is nested inside the clicked body and the
 * camera zooms into it; flying out, the *departing* level is the one that gets
 * nested (it shrinks back into the body you came from) while the camera
 * unzooms. Same depth → `null`, there is nothing to fly.
 */
export function flyPlan(fromDepth: number, toDepth: number, focus: Point): FlyPlan | null {
  if (toDepth === fromDepth) return null;
  const direction: 'in' | 'out' = toDepth > fromDepth ? 'in' : 'out';
  const k = flyScale(fromDepth, toDepth);
  const nest = toSvg(nestMatrix(k, focus.x, focus.y));
  const cam = toCss(camMatrix(k, focus.x, focus.y));

  if (direction === 'in') {
    return {
      direction,
      k,
      focus,
      leavingTransform: '',
      arrivingTransform: nest,
      cameraFrom: NO_TRANSFORM,
      cameraTo: cam,
    };
  }
  return {
    direction,
    k,
    focus,
    leavingTransform: nest,
    arrivingTransform: '',
    cameraFrom: cam,
    cameraTo: NO_TRANSFORM,
  };
}

/**
 * Where the arriving layer actually sits at the end of the transition, as a
 * matrix. The rebase is pixel-identical exactly when this is the identity —
 * which is what `camera.test.ts` asserts, for every plan it can build.
 */
export function restingMatrix(plan: FlyPlan): Matrix {
  const { k, focus, direction } = plan;
  // The arriving layer carries `nest` only when flying in; the camera lands on
  // `cam` only when flying in. Flying out, both are identity at rest.
  if (direction === 'in') {
    return multiply(camMatrix(k, focus.x, focus.y), nestMatrix(k, focus.x, focus.y));
  }
  return IDENTITY;
}

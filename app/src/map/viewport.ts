/**
 * The shared map camera.
 *
 * Every renderer draws its plate in *world* units and then lets one camera
 * decide where the window onto that world sits. The contract is one line:
 *
 *     screen = world * k + (x, y)
 *
 * so `k` is pixels-per-world-unit and `(x, y)` is where world (0, 0) lands on
 * screen. A renderer applies it as a single CSS transform on one wrapper
 * group; nothing downstream of that group knows the camera exists, which is
 * what keeps hit testing, label solving and the frame loops untouched.
 *
 * Everything here is pure - no React, no DOM, no clock - so `viewport.test.ts`
 * can assert the invariants in the node environment. `useViewport.ts` is the
 * React half: gestures, keys and the tween.
 */

export interface Camera {
  /** Screen x of world 0. */
  x: number;
  /** Screen y of world 0. */
  y: number;
  /** Pixels per world unit. */
  k: number;
}

/** An axis-aligned rectangle in world units. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The zoom floor: below this the plate is a smudge and the labels collide. */
export const K_MIN = 0.35;
/** The zoom ceiling: above this one world fills the stage and nothing reads. */
export const K_MAX = 3;

interface View {
  w: number;
  h: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** k, clamped and never NaN - a zero-sized stage must not poison the camera. */
function safeK(k: number): number {
  return Number.isFinite(k) ? clamp(k, K_MIN, K_MAX) : 1;
}

/**
 * The camera as a CSS transform for the wrapper group.
 *
 * CSS `translate()` needs units even inside SVG, so the offsets carry `px`;
 * with `transform-origin: 0 0` on the group, one px is one world unit before
 * the scale, which is exactly what `screen = world * k + (x, y)` says.
 */
export function cameraTransform(c: Camera): string {
  return `translate(${c.x}px, ${c.y}px) scale(${c.k})`;
}

/** Slide the window by a screen-space delta. Zoom is untouched. */
export function panBy(c: Camera, dx: number, dy: number): Camera {
  return { x: c.x + dx, y: c.y + dy, k: c.k };
}

/**
 * Zoom about a point on screen: whatever world point sat under `(sx, sy)`
 * still sits under it afterwards. That is the whole reason wheel zoom feels
 * like a map and not like a slider.
 */
export function zoomAt(c: Camera, factor: number, sx: number, sy: number): Camera {
  const next = safeK(c.k * factor);
  // The clamp can swallow part of the requested factor; the anchor has to be
  // solved against the factor actually applied, or the point drifts at the
  // limits.
  const applied = next / c.k;
  return {
    x: sx - (sx - c.x) * applied,
    y: sy - (sy - c.y) * applied,
    k: next,
  };
}

/** Put a world point in the middle of the view at the given zoom. */
export function centerOn(wx: number, wy: number, view: View, k: number): Camera {
  const kk = safeK(k);
  return { x: view.w / 2 - wx * kk, y: view.h / 2 - wy * kk, k: kk };
}

/**
 * The camera that shows the whole box with `padding` px of air around it,
 * centred. `k` is still clamped, so a box far bigger than K_MIN can show is
 * centred rather than fitted - the drag is then how you reach the rest.
 */
export function fitBox(bounds: Box, view: View, padding: number): Camera {
  const availW = Math.max(1, view.w - padding * 2);
  const availH = Math.max(1, view.h - padding * 2);
  const w = Math.max(1e-6, bounds.w);
  const h = Math.max(1e-6, bounds.h);
  const k = safeK(Math.min(availW / w, availH / h));
  return centerOn(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2, view, k);
}

/**
 * Keep the content from being thrown away.
 *
 * `overscroll` is how much of the *overlap* you are allowed to give up: at
 * 0.6, 60% of what could be on screen may be pushed off, so at least 40% of
 * it stays. Measured against `min(view, content)` on each axis, so a plate
 * smaller than the view is held by its own size rather than being required to
 * cover a view it can never fill.
 */
export function clampToBounds(c: Camera, bounds: Box, view: View, overscroll: number): Camera {
  const keep = 1 - clamp(overscroll, 0, 1);
  const axis = (offset: number, origin: number, extent: number, span: number): number => {
    const size = Math.max(1e-6, extent) * c.k;
    const need = keep * Math.min(span, size);
    // `origin * k + offset` is the near edge on screen; the far edge is that
    // plus `size`. Requiring `need` px of overlap pins the offset between two
    // walls, and they cannot cross because `need <= (span + size) / 2`.
    const lo = need - size - origin * c.k;
    const hi = span - need - origin * c.k;
    return clamp(offset, Math.min(lo, hi), Math.max(lo, hi));
  };
  return {
    x: axis(c.x, bounds.x, bounds.w, view.w),
    y: axis(c.y, bounds.y, bounds.h, view.h),
    k: c.k,
  };
}

/** Where a screen point lands in world units. The inverse of the contract. */
export function screenToWorld(c: Camera, sx: number, sy: number): { x: number; y: number } {
  const k = c.k || 1;
  return { x: (sx - c.x) / k, y: (sy - c.y) / k };
}

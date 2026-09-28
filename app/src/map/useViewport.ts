/**
 * The React half of the map camera: gestures, keys and the glide.
 *
 * `viewport.ts` owns the arithmetic; this owns the wiring. A renderer measures
 * its host, hands over the world bounds it drew and the camera it wants to
 * open on, spreads `bind` onto its `<svg>`, and puts `transform` on one
 * wrapper group. Everything else - drag to pan, wheel to zoom about the
 * cursor, double-click to fit, the `F` / `+` / `-` / `0` / arrow requests the
 * Map view routes through the store - arrives for free and identically in
 * every renderer.
 *
 * Two rules here are load-bearing:
 *
 * - The wheel listener is attached natively with `{ passive: false }`. React's
 *   `onWheel` is registered passive at the root, so `preventDefault` there is
 *   ignored and the page scrolls out from under the map.
 * - A drag that crossed the threshold swallows its own trailing click in the
 *   capture phase. Without that, letting go over a world selects it, and the
 *   map becomes unusable with a mouse.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import {
  cameraTransform,
  centerOn,
  clampToBounds,
  fitBox,
  panBy as panCamera,
  zoomAt,
  type Box,
  type Camera,
} from './viewport';
import { useMapStore } from './store';

/** Pixels of pointer travel before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD = 4;
/** Zoom per wheel notch. */
const WHEEL_STEP = 1.12;
/** Zoom per `+` / `-` press or HUD button: a key should be worth more than a notch. */
const KEY_STEP = 1.25;
/** How far a drag may throw the plate: 60% of what could be shown may go off. */
const OVERSCROLL = 0.6;
/** Air left around the plate by `fit`. */
const FIT_PADDING = 28;
/** The fit/reset glide. Long enough to read as travel, short enough to obey. */
const GLIDE_MS = 280;

export interface ViewportOptions {
  /** The host size the renderer already measures. */
  view: { w: number; h: number };
  /** World bounds of the drawn content, for fit and for the drag clamp. */
  bounds: Box;
  /** The camera to open on: applied when the renderer mounts and on `resetKey`. */
  initial: Camera;
  /** Changing this restores `initial`. The system on screen, in practice. */
  resetKey: unknown;
  /** No glide when true. */
  reduced: boolean;
}

export interface ViewportBind {
  onPointerDown(event: ReactPointerEvent): void;
  onPointerMove(event: ReactPointerEvent): void;
  onPointerUp(event: ReactPointerEvent): void;
  onPointerCancel(event: ReactPointerEvent): void;
  onDoubleClick(event: ReactMouseEvent): void;
  onClickCapture(event: ReactMouseEvent): void;
  ref(el: SVGSVGElement | null): void;
}

export interface Viewport {
  camera: Camera;
  /** For the `<g className="viewport">` wrapper. */
  transform: string;
  dragging: boolean;
  /** Spread onto the `<svg>`. */
  bind: ViewportBind;
  fit(): void;
  reset(): void;
  zoomIn(): void;
  zoomOut(): void;
  panBy(dx: number, dy: number): void;
  /**
   * Travel so a world point sits in the middle of the view, keeping the
   * current zoom. Same glide as `fit`, and the same snap under reduced
   * motion. For a renderer that moves a body on selection and needs the
   * camera to follow it off the edge of the stage.
   */
  glideTo(wx: number, wy: number): void;
}

interface Drag {
  id: number;
  /** Where the pointer was at the last applied frame. */
  x: number;
  y: number;
  /** Where the press started, for the threshold. */
  ox: number;
  oy: number;
  moved: boolean;
}

/** Ease-out cubic: leaves fast, arrives gently. */
function ease(t: number): number {
  return 1 - (1 - t) ** 3;
}

function sameCamera(a: Camera, b: Camera): boolean {
  return a.x === b.x && a.y === b.y && a.k === b.k;
}

export function useViewport(opts: ViewportOptions): Viewport {
  const [camera, setCamera] = useState<Camera>(opts.initial);
  const [dragging, setDragging] = useState(false);

  // Everything below reads the live options through a ref, so every handler
  // and every exported action is stable for the lifetime of the renderer -
  // which is what lets `bind` be spread without re-attaching listeners and
  // lets the glide keep running across re-renders.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const cameraRef = useRef(camera);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef(0);
  const glideRef = useRef(0);
  const swallowRef = useRef(false);
  /** The `resetKey` whose `initial` has been applied at a real (non-zero) size. */
  const appliedRef = useRef<{ key: unknown; ok: boolean }>({ key: undefined, ok: false });

  const commit = useCallback((next: Camera): void => {
    if (sameCamera(cameraRef.current, next)) return;
    cameraRef.current = next;
    setCamera(next);
  }, []);

  const stopGlide = useCallback((): void => {
    if (glideRef.current) cancelAnimationFrame(glideRef.current);
    glideRef.current = 0;
  }, []);

  /** Travel to a camera over `GLIDE_MS`, or snap when motion is reduced. */
  const glide = useCallback(
    (to: Camera): void => {
      stopGlide();
      if (optsRef.current.reduced || typeof requestAnimationFrame !== 'function') {
        commit(to);
        return;
      }
      const from = cameraRef.current;
      if (sameCamera(from, to)) return;
      const t0 = performance.now();
      const step = (now: number): void => {
        const t = Math.min(1, (now - t0) / GLIDE_MS);
        const e = ease(t);
        commit({
          x: from.x + (to.x - from.x) * e,
          y: from.y + (to.y - from.y) * e,
          k: from.k + (to.k - from.k) * e,
        });
        glideRef.current = t < 1 ? requestAnimationFrame(step) : 0;
      };
      glideRef.current = requestAnimationFrame(step);
    },
    [commit, stopGlide],
  );

  const held = useCallback((next: Camera): Camera => {
    const { bounds, view } = optsRef.current;
    return clampToBounds(next, bounds, view, OVERSCROLL);
  }, []);

  // ---- actions --------------------------------------------------------------

  const fit = useCallback((): void => {
    const { bounds, view } = optsRef.current;
    if (view.w <= 0 || view.h <= 0) return;
    glide(held(fitBox(bounds, view, FIT_PADDING)));
  }, [glide, held]);

  const reset = useCallback((): void => {
    const { view } = optsRef.current;
    if (view.w <= 0 || view.h <= 0) return;
    glide(optsRef.current.initial);
  }, [glide]);

  const zoomStep = useCallback(
    (direction: 1 | -1): void => {
      const { view } = optsRef.current;
      if (view.w <= 0 || view.h <= 0) return;
      stopGlide();
      const factor = direction > 0 ? KEY_STEP : 1 / KEY_STEP;
      commit(held(zoomAt(cameraRef.current, factor, view.w / 2, view.h / 2)));
    },
    [commit, held, stopGlide],
  );

  const zoomIn = useCallback((): void => zoomStep(1), [zoomStep]);
  const zoomOut = useCallback((): void => zoomStep(-1), [zoomStep]);

  const glideTo = useCallback(
    (wx: number, wy: number): void => {
      const { view } = optsRef.current;
      if (view.w <= 0 || view.h <= 0) return;
      glide(held(centerOn(wx, wy, view, cameraRef.current.k)));
    },
    [glide, held],
  );

  const pan = useCallback(
    (dx: number, dy: number): void => {
      stopGlide();
      commit(held(panCamera(cameraRef.current, dx, dy)));
    },
    [commit, held, stopGlide],
  );

  // ---- the wheel, attached natively so preventDefault is honoured -----------

  const onWheel = useCallback(
    (event: WheelEvent): void => {
      const el = svgRef.current;
      if (!el) return;
      event.preventDefault();
      stopGlide();
      const rect = el.getBoundingClientRect();
      const factor = event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      commit(
        held(zoomAt(cameraRef.current, factor, event.clientX - rect.left, event.clientY - rect.top)),
      );
    },
    [commit, held, stopGlide],
  );

  const ref = useCallback(
    (el: SVGSVGElement | null): void => {
      const prev = svgRef.current;
      if (prev === el) return;
      if (prev) prev.removeEventListener('wheel', onWheel);
      svgRef.current = el;
      if (!el) return;
      // A touch drag has to pan the map, not scroll the page; setting it here
      // rather than in CSS means every renderer that adopts the hook gets it.
      el.style.touchAction = 'none';
      el.addEventListener('wheel', onWheel, { passive: false });
    },
    [onWheel],
  );

  // ---- the drag -------------------------------------------------------------

  const applyPending = useCallback((): void => {
    frameRef.current = 0;
    const drag = dragRef.current;
    const at = pendingRef.current;
    if (!drag || !at) return;
    const dx = at.x - drag.x;
    const dy = at.y - drag.y;
    drag.x = at.x;
    drag.y = at.y;
    if (dx !== 0 || dy !== 0) commit(held(panCamera(cameraRef.current, dx, dy)));
  }, [commit, held]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent): void => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      stopGlide();
      swallowRef.current = false;
      dragRef.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        ox: event.clientX,
        oy: event.clientY,
        moved: false,
      };
      pendingRef.current = null;
    },
    [stopGlide],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent): void => {
      const drag = dragRef.current;
      if (!drag || drag.id !== event.pointerId) return;
      if (!drag.moved) {
        if (Math.hypot(event.clientX - drag.ox, event.clientY - drag.oy) < DRAG_THRESHOLD) return;
        drag.moved = true;
        const el = svgRef.current;
        if (el) {
          try {
            el.setPointerCapture(event.pointerId);
          } catch {
            // The pointer can be gone already (a very fast flick); panning
            // still works, it just stops at the edge of the stage.
          }
          el.classList.add('is-dragging');
        }
        setDragging(true);
      }
      pendingRef.current = { x: event.clientX, y: event.clientY };
      if (!frameRef.current) frameRef.current = requestAnimationFrame(applyPending);
    },
    [applyPending],
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent): void => {
      const drag = dragRef.current;
      if (!drag || drag.id !== event.pointerId) return;
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
      applyPending();
      dragRef.current = null;
      pendingRef.current = null;
      if (!drag.moved) return;
      swallowRef.current = true;
      const el = svgRef.current;
      if (el) {
        if (el.hasPointerCapture?.(event.pointerId)) el.releasePointerCapture(event.pointerId);
        el.classList.remove('is-dragging');
      }
      setDragging(false);
    },
    [applyPending],
  );

  const onClickCapture = useCallback((event: ReactMouseEvent): void => {
    if (!swallowRef.current) return;
    swallowRef.current = false;
    event.stopPropagation();
    event.preventDefault();
  }, []);

  const onDoubleClick = useCallback(
    (event: ReactMouseEvent): void => {
      // A body handles its own double-click and stops it; anything that
      // reaches the stage is empty space.
      if (event.defaultPrevented) return;
      fit();
    },
    [fit],
  );

  // ---- lifecycle ------------------------------------------------------------

  // `initial` lands once the host has a real size: the first measurement is
  // 0x0 (the ResizeObserver has not fired yet), and a camera solved against
  // that is meaningless. A later resize must NOT re-open the plate, so the
  // application is keyed on `resetKey`, not on `initial` itself.
  useEffect(() => {
    const { view, initial, resetKey } = optsRef.current;
    if (view.w <= 0 || view.h <= 0) return;
    const applied = appliedRef.current;
    if (applied.ok && applied.key === resetKey) return;
    appliedRef.current = { key: resetKey, ok: true };
    stopGlide();
    commit(initial);
  }, [commit, stopGlide, opts.resetKey, opts.view.w, opts.view.h, opts.initial]);

  useEffect(
    () => () => {
      if (glideRef.current) cancelAnimationFrame(glideRef.current);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      const el = svgRef.current;
      if (el) el.removeEventListener('wheel', onWheel);
    },
    [onWheel],
  );

  // ---- requests routed through the store ------------------------------------
  // The Map view owns the keyboard and the HUD owns the buttons; neither can
  // reach a hook that lives inside the renderer, so both bump a nonce.

  useRequest(useMapStore((s) => s.viewportNonce), fit);
  useRequest(useMapStore((s) => s.resetNonce), reset);
  const zoomDirection = useMapStore((s) => s.zoomDirection);
  useRequest(useMapStore((s) => s.zoomNonce), () => zoomStep(zoomDirection));
  const panRequest = useMapStore((s) => s.panRequest);
  useRequest(panRequest.nonce, () => pan(panRequest.dx, panRequest.dy));

  return {
    camera,
    transform: cameraTransform(camera),
    dragging,
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onDoubleClick,
      onClickCapture,
      ref,
    },
    fit,
    reset,
    zoomIn,
    zoomOut,
    panBy: pan,
    glideTo,
  };
}

/**
 * Run `act` when `nonce` changes, never on mount. The callback is read
 * through a ref so a fresh closure every render does not re-fire it.
 */
function useRequest(nonce: number, act: () => void): void {
  const actRef = useRef(act);
  actRef.current = act;
  const seen = useRef(nonce);
  useEffect(() => {
    if (seen.current === nonce) return;
    seen.current = nonce;
    actRef.current();
  }, [nonce]);
}

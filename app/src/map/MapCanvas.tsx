/**
 * The orbital chart: one SVG holding the whole star system.
 *
 * Since M8.5 this is a *renderer* behind `map/renderer.ts`'s seam
 * (`ChartMap`), drawn inside `.map-stage` with the explorer column beside it.
 * It owns no state: selection, hover, filter and the system on screen all
 * arrive as props, and everything it decides leaves through the callbacks.
 *
 * React owns *structure* — which bodies exist, what marks they carry, what
 * the rings say. A `requestAnimationFrame` loop owns *motion*, and it never
 * touches React state: it writes `transform`, `d`, `points` and `class`
 * straight onto elements held in a ref map. That split is what lets Orbit run
 * continuously without re-rendering, and what makes Chart mode cost exactly
 * nothing (the loop does not run at all).
 *
 * The loop runs only while `mode === 'orbit' && !reduced &&
 * document.visibilityState === 'visible'` and the component is mounted. It
 * keeps a running `elapsed`, so pausing for a hidden tab and resuming does
 * not jump; entering Orbit from Chart resets `elapsed` to 0, so Orbit starts
 * exactly on the Chart layout. Leaving Orbit eases every body back along the
 * shortest arc over 300 ms and then stops.
 *
 * Colour, weight and opacity all come from classes in `map.css` so the theme
 * tokens (and `color-mix`) apply; SVG attributes here carry geometry only.
 * The two `fill="url(#…)"` gradient references are the exception the format
 * forces — the gradient's own stops are still coloured from CSS.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';

import { relativeTime } from '../shell/recent';
import type { MapRendererProps } from './renderer';
import { useViewport } from './useViewport';
import { centerOn, type Box } from './viewport';
import {
  BANDS,
  LABEL_SECTOR,
  ORBIT_MIN,
  asteroidPath,
  bodyLabelCount,
  displayName,
  hashString,
  placeLabels,
  positionAt,
  ringOrbit,
  seededRng,
  shortestDelta,
  type Band,
  type Body,
  type LabelItem,
  type LabelObstacle,
  type LabelSide,
  type Placement,
} from './model';
import { useEffectiveMapMode, type BodyStatus } from './store';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** Room outside the rim for ring labels and outward body labels. */
const RIM_PADDING = 64;
/** The sides need less: names run outward horizontally, ring captions do not. */
const SIDE_PADDING = 40;
const MIN_RADIUS = 120;

const STAR_COUNT = 140;
const STAR_SEED = 11;

/** Label budget: every body up to this, then progressively fewer (see `labelWanted`). */
const LABEL_ALL_BELOW = 24;
const LABEL_STRUCTURE_BELOW = 40;

const DIVE_MS = 240;
const EASE_BACK_MS = 300;
const SWEEP_MS = 1400;
const SWEEP_ARC = 24 * DEG;
const PING_MS = 600;
const SAT_PERIOD_MS = 1600;

/** Rough advance width of the 11.5px UI label font, and its line box. */
const LABEL_CHAR_PX = 5.9;
const LABEL_LINE_PX = 13;
/** Mono 10px at .14em tracking; a mono advance, so length × this is exact enough. */
const RING_CHAR_PX = 7.4;

const RING_BANDS: Exclude<Band, 'older'>[] = ['today', 'week', 'month', 'halfyear'];

/**
 * Where a ring's caption starts, as a fraction of its circumference from the
 * start of `ringLabelPath`, so that the caption's whole extent lands inside
 * `LABEL_SECTOR` at that ring's radius. Derived, not guessed: a short caption
 * on a big ring ends up at a very different percentage from a long one on a
 * small ring.
 *
 * The path deliberately begins at the sector's leading edge — text on a
 * `textPath` is dropped where it runs past the path's end, so an offset that
 * had to wrap round 100 % would silently erase the caption.
 */
function ringCaptionOffset(radius: number, text: string): string {
  const arc = (text.length * RING_CHAR_PX) / Math.max(radius, 1);
  const middle = (LABEL_SECTOR.start + LABEL_SECTOR.end) / 2;
  const latest = Math.max(LABEL_SECTOR.start, LABEL_SECTOR.end - arc);
  const start = Math.min(Math.max(middle - arc / 2, LABEL_SECTOR.start), latest);
  return `${(((start - LABEL_SECTOR.start) / TAU) * 100).toFixed(3)}%`;
}

/**
 * A system squeezed into a small rim is as crowded as a big one with more
 * bodies in it, so the budget counts bodies against the room there is to put
 * names. At the reference radius the count is taken at face value.
 */
const LABEL_DENSITY_RADIUS = 200;

function labelPressure(total: number, R: number): number {
  return total * (LABEL_DENSITY_RADIUS / Math.max(R, MIN_RADIUS));
}

/**
 * Label budget. Everything is labelled while the system is small; past that,
 * structure (notebooks and folders) keeps its names, and in a really busy
 * system only the last week does. Live and pointed-at bodies always win.
 */
function labelWanted(body: Body, pressure: number, forced: boolean): boolean {
  if (forced) return true;
  if (pressure <= LABEL_ALL_BELOW) return true;
  if (pressure <= LABEL_STRUCTURE_BELOW) return body.kind !== 'file';
  return body.band === 'today' || body.band === 'week';
}

function bodyRadius(body: Body): number {
  const base = body.kind === 'notebook' ? 5.5 : body.kind === 'directory' ? 6.5 : 3.5;
  return base * body.scale;
}

function depthOf(dir: string): number {
  return dir === '' ? 0 : dir.split('/').length;
}

function round(n: number): string {
  return n.toFixed(2);
}

/** Arc of `radius` from `a0` to `a1`, centred on the origin. */
function arcPath(radius: number, a0: number, a1: number): string {
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  return (
    `M ${round(Math.cos(a0) * radius)} ${round(Math.sin(a0) * radius)} ` +
    `A ${round(radius)} ${round(radius)} 0 ${large} 1 ` +
    `${round(Math.cos(a1) * radius)} ${round(Math.sin(a1) * radius)}`
  );
}

/**
 * A trail arc ending at the body, expressed in the body's own local frame.
 * The angular span is capped so the trail is a constant *pixel* length
 * everywhere: 8° of the rim is a 40 px streak, which reads as a stray line
 * rather than as motion.
 */
function trailPath(orbitRadius: number, angle: number, spanDeg: number, maxPx: number): string {
  const span = Math.min(spanDeg * DEG, maxPx / Math.max(orbitRadius, 1));
  const bx = Math.cos(angle) * orbitRadius;
  const by = Math.sin(angle) * orbitRadius;
  const x0 = Math.cos(angle - span) * orbitRadius - bx;
  const y0 = Math.sin(angle - span) * orbitRadius - by;
  return `M ${round(x0)} ${round(y0)} A ${round(orbitRadius)} ${round(orbitRadius)} 0 0 1 0 0`;
}

/** Four corner brackets of a square of half-size `d`, with `arm`-long legs. */
function reticlePath(d: number, arm: number): string {
  return [
    `M ${round(-d)} ${round(-d + arm)} L ${round(-d)} ${round(-d)} L ${round(-d + arm)} ${round(-d)}`,
    `M ${round(d - arm)} ${round(-d)} L ${round(d)} ${round(-d)} L ${round(d)} ${round(-d + arm)}`,
    `M ${round(d)} ${round(d - arm)} L ${round(d)} ${round(d)} L ${round(d - arm)} ${round(d)}`,
    `M ${round(-d + arm)} ${round(d)} L ${round(-d)} ${round(d)} L ${round(-d)} ${round(d - arm)}`,
  ].join(' ');
}

const TRAIL_FAR = { deg: 8, px: 26 };
const TRAIL_NEAR = { deg: 4, px: 13 };

/**
 * The side a label would rather be on: away from the star, so it never runs
 * across the centre — unless that side would put it off the edge. `placeLabels`
 * takes this as its first choice and moves it only to resolve a collision.
 */
function outwardSide(x: number, extent: number, cx: number, w: number): LabelSide {
  if (x < 0) return cx + x - extent < 6 ? 'right' : 'left';
  return cx + x + extent > w - 6 ? 'left' : 'right';
}

/**
 * A circle for captions to ride along, drawn clockwise from the caption
 * sector's leading edge so every caption sits at a small positive offset.
 */
function ringLabelPath(radius: number): string {
  const r = round(radius);
  const x = Math.cos(LABEL_SECTOR.start) * radius;
  const y = Math.sin(LABEL_SECTOR.start) * radius;
  return (
    `M ${round(x)} ${round(y)} A ${r} ${r} 0 1 1 ${round(-x)} ${round(-y)} ` +
    `A ${r} ${r} 0 1 1 ${round(x)} ${round(y)}`
  );
}

function wedgePath(radius: number, arc: number): string {
  return (
    `M 0 0 L ${round(radius)} 0 ` +
    `A ${round(radius)} ${round(radius)} 0 0 1 ` +
    `${round(Math.cos(arc) * radius)} ${round(Math.sin(arc) * radius)} Z`
  );
}

function ledClass(status: BodyStatus): string | null {
  switch (status.kernel) {
    case null:
    case 'disconnected':
      return null;
    case 'idle':
      return 'led-ok';
    case 'dead':
      return 'led-err';
    default:
      return 'led-warn';
  }
}

/** Live references into one body's rendered group, so the loop can skip the DOM query. */
interface BodyRef {
  body: Body;
  group: SVGGElement;
  label: SVGTextElement | null;
  labelWidth: number;
  trailFar: SVGPathElement | null;
  trailNear: SVGPathElement | null;
  satellite: SVGCircleElement | null;
}

/**
 * The orbital chart: the zoom method's fallback renderer, and the stand-in for
 * both methods until `cartography/` and `zoom/` land (see `renderers.ts`).
 */
export function ChartMap(props: MapRendererProps) {
  const { dir, bodies, statuses, flightPath, reduced, connected, anyBusy, systemLabel } = props;
  const { selected, hovered, query, themeMode } = props;
  const { onSelect, onHover, onOpen, onDive } = props;

  // Chart vs Orbit is this renderer's own instrument setting rather than part
  // of the seam — no other renderer has the concept — so it is the one thing
  // read from the store here.
  const mode = useEffectiveMapMode();

  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/:/g, ''), [rawId]);

  const hostRef = useRef<HTMLDivElement>(null);
  const systemRef = useRef<SVGGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setSize({ w: Math.round(box.width), h: Math.round(box.height) });
    });
    observer.observe(host);
    setSize({ w: Math.round(host.clientWidth), h: Math.round(host.clientHeight) });
    return () => observer.disconnect();
  }, []);

  const { w, h } = size;
  // The explorer is a real column beside the stage now, so nothing overlaps
  // the chart but the breadcrumb and the legend: it simply centres in its
  // host, with room at the rim for the ring captions and outward labels.
  const { cx, cy, R } = useMemo(
    () => ({
      cx: w / 2,
      cy: h / 2,
      R: Math.max(MIN_RADIUS, Math.min((w - SIDE_PADDING * 2) / 2, (h - RIM_PADDING * 2) / 2)),
    }),
    [w, h],
  );

  // ---- the viewport (drag to pan, wheel to zoom) ---------------------------
  // The chart's own layout already fits its host, so there is nothing to
  // spread here: the camera opens at 1:1 on the star and is purely a way to
  // get closer to a crowded ring. One transform, on a group outside the dive
  // transition, so neither knows about the other.
  // `view` is already this file's name for the bodies on screen, so the host
  // box the camera works against is `viewSize`.
  const viewSize = useMemo(() => ({ w, h }), [w, h]);
  const bounds = useMemo<Box>(() => {
    const reach = R + RIM_PADDING;
    return { x: cx - reach, y: cy - reach, w: reach * 2, h: reach * 2 };
  }, [cx, cy, R]);
  const initial = useMemo(() => centerOn(cx, cy, viewSize, 1), [cx, cy, viewSize]);
  const viewport = useViewport({ view: viewSize, bounds, initial, resetKey: dir, reduced });
  const { bind, transform } = viewport;

  // ---- dive transition: hold the old system on screen while it flies past --
  const [shown, setShown] = useState<{ bodies: Body[]; dir: string }>({ bodies, dir });
  const [dive, setDive] = useState<'out-in' | 'out-up' | 'in-in' | 'in-up' | null>(null);
  const depthRef = useRef(depthOf(dir));
  const pendingRef = useRef<string | null>(null);
  const latest = useRef({ bodies, dir });
  latest.current = { bodies, dir };
  const animateDive = mode === 'orbit' && !reduced;
  const diveTimer = useRef(0);

  // The timer outlives this effect's own runs on purpose: swapping the system
  // changes `shown`, which re-runs the effect, so an effect-scoped cleanup
  // would cancel the second half of the transition and strand the map at
  // scale(.6), opacity 0. Only unmounting cancels it.
  useEffect(
    () => () => {
      if (diveTimer.current) clearTimeout(diveTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (dir === shown.dir) {
      pendingRef.current = null;
      if (bodies !== shown.bodies) setShown({ bodies, dir });
      return;
    }
    if (pendingRef.current === dir) return; // a transition for this dir is already running
    pendingRef.current = dir;

    const goingIn = depthOf(dir) > depthRef.current;
    depthRef.current = depthOf(dir);
    if (diveTimer.current) clearTimeout(diveTimer.current);

    if (!animateDive) {
      setShown({ bodies, dir });
      setDive(null);
      return;
    }

    // Out: the system you are leaving flies past the camera. Then the new one
    // is snapped to its entry pose and released a frame later, so the entry
    // transition runs from it instead of from wherever the old one ended.
    setDive(goingIn ? 'out-in' : 'out-up');
    diveTimer.current = window.setTimeout(() => {
      diveTimer.current = 0;
      setShown({ ...latest.current });
      setDive(goingIn ? 'in-in' : 'in-up');
      requestAnimationFrame(() => {
        // Force a style recalculation while the (transition-less) entry pose
        // is applied, so dropping the class transitions *from* it rather than
        // from wherever the exit left the group.
        systemRef.current?.getBoundingClientRect();
        setDive(null);
      });
    }, DIVE_MS);
  }, [dir, bodies, shown, animateDive]);

  const view = shown.bodies;

  // ---- filter and sector scan ---------------------------------------------
  const needle = query.trim().toLowerCase();
  const matches = useMemo(() => {
    const set = new Set<string>();
    if (!needle) return set;
    for (const body of view) {
      if (body.name.toLowerCase().includes(needle)) set.add(body.path);
    }
    return set;
  }, [view, needle]);

  const [sweeping, setSweeping] = useState(false);
  const hadQuery = useRef(needle.length > 0);

  useEffect(() => {
    const has = needle.length > 0;
    const became = has && !hadQuery.current;
    hadQuery.current = has;
    if (!became || mode !== 'orbit' || reduced) {
      if (!has) setSweeping(false);
      return;
    }
    setSweeping(true);
    const done = window.setTimeout(() => setSweeping(false), SWEEP_MS);
    return () => clearTimeout(done);
  }, [needle, mode, reduced]);

  // While the wedge is still travelling, matches light up one at a time as it
  // passes them; dimming the rest only makes sense once it has been all the
  // way round.
  const filtering = needle.length > 0 && !sweeping;

  // ---- static star field ---------------------------------------------------
  const showStars = themeMode !== 'bridge' && themeMode !== 'paper';
  const stars = useMemo(() => {
    if (!showStars || w === 0 || h === 0) return [];
    const rng = seededRng(STAR_SEED);
    const out: { x: number; y: number; r: number; tier: number }[] = [];
    for (let i = 0; i < STAR_COUNT; i += 1) {
      out.push({
        x: Math.round(rng() * w),
        y: Math.round(rng() * h),
        r: Number((0.4 + rng() * 0.7).toFixed(2)),
        tier: Math.floor(rng() * 3),
      });
    }
    return out;
  }, [showStars, w, h]);

  // ---- element registry the frame loop writes to ---------------------------
  const groups = useRef(new Map<string, SVGGElement>());
  const flightLineRef = useRef<SVGPolylineElement>(null);
  const shipRef = useRef<SVGGElement>(null);
  const sweepRef = useRef<SVGGElement>(null);

  const byPath = useMemo(() => new Map(view.map((b) => [b.path, b])), [view]);
  const course = useMemo(
    () => flightPath.filter((p) => byPath.has(p)).reverse(),
    [flightPath, byPath],
  );

  const elapsedRef = useRef(0);
  const wasOrbitRef = useRef(false);
  const orbitOn = mode === 'orbit' && !reduced;

  /**
   * Geometry and derived collections the drawing functions read *live*. The
   * loop must never close over a render's values: a status change re-renders
   * the groups without restarting the loop, and a stale closure would keep
   * writing to elements that no longer exist.
   */
  const drawRef = useRef({ R, cx, w, course, byPath, starLabelY: 0 });

  /**
   * Rebuilt after every render, before paint: a body whose kernel turns busy
   * mid-orbit grows a `.sat`, and a label appears on hover, so the element
   * registry cannot be captured once per loop start.
   */
  const refsRef = useRef(new Map<string, BodyRef>());
  const redrawRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const next = new Map<string, BodyRef>();
    for (const body of view) {
      const group = groups.current.get(body.path);
      if (!group) continue;
      const label = group.querySelector<SVGTextElement>('.map-label');
      next.set(body.path, {
        body,
        group,
        label,
        labelWidth: (label?.textContent ?? '').length * LABEL_CHAR_PX,
        trailFar: group.querySelector<SVGPathElement>('.trail-far'),
        trailNear: group.querySelector<SVGPathElement>('.trail-near'),
        satellite: group.querySelector<SVGCircleElement>('.sat'),
      });
    }
    refsRef.current = next;
    // Chart mode has no loop to pick the new elements up on the next frame.
    if (!orbitOn) redrawRef.current?.();
  });

  const placementRef = useRef(new Map<string, Placement>());

  useLayoutEffect(() => {
    if (w === 0 || h === 0) return;

    const pinged = new Set<string>();
    const pingTimers: number[] = [];

    /** Inner rings first, so the crowded middle claims its label sides first. */
    function orderedRefs(): BodyRef[] {
      return [...refsRef.current.values()].sort((a, b) => a.body.orbit - b.body.orbit);
    }

    function placeBody(ref: BodyRef, angle: number, t: number): void {
      const orbitRadius = ref.body.orbit * drawRef.current.R;
      const x = Math.cos(angle) * orbitRadius;
      const y = Math.sin(angle) * orbitRadius;
      ref.group.setAttribute('transform', `translate(${round(x)},${round(y)})`);

      if (ref.trailFar) {
        ref.trailFar.setAttribute('d', trailPath(orbitRadius, angle, TRAIL_FAR.deg, TRAIL_FAR.px));
      }
      if (ref.trailNear) {
        ref.trailNear.setAttribute('d', trailPath(orbitRadius, angle, TRAIL_NEAR.deg, TRAIL_NEAR.px));
      }
      if (ref.satellite) {
        const sr = bodyRadius(ref.body) + 9;
        const sa = t === 0 ? 45 * DEG : ref.body.phase + (TAU * t) / SAT_PERIOD_MS;
        ref.satellite.setAttribute('cx', round(Math.cos(sa) * sr));
        ref.satellite.setAttribute('cy', round(Math.sin(sa) * sr));
      }
    }

    /** De-collides every visible label against the other labels and the bodies. */
    function layoutLabels(angleOf: (body: Body) => number): void {
      const { R: radius, cx: centre, w: width, starLabelY } = drawRef.current;
      const refs = orderedRefs();
      // The star and its caption are obstacles too: a name must never be
      // strewn across the middle of the system.
      const obstacles: LabelObstacle[] = [
        { x: 0, y: starLabelY / 2, r: starLabelY / 2 + 14 },
      ];
      const at = new Map<string, { x: number; y: number }>();

      for (const ref of refs) {
        const angle = angleOf(ref.body);
        const orbitRadius = ref.body.orbit * radius;
        const point = { x: Math.cos(angle) * orbitRadius, y: Math.sin(angle) * orbitRadius };
        at.set(ref.body.path, point);
        obstacles.push({ x: point.x, y: point.y, r: bodyRadius(ref.body) });
      }

      const items: LabelItem[] = [];
      for (const ref of refs) {
        const point = at.get(ref.body.path);
        if (!ref.label || !point) continue;
        const extent = bodyRadius(ref.body) + 7 + ref.labelWidth;
        items.push({
          id: ref.body.path,
          x: point.x,
          y: point.y,
          w: extent,
          h: LABEL_LINE_PX,
          outward: outwardSide(point.x, extent, centre, width),
        });
      }

      const placed = placeLabels(items, obstacles, placementRef.current);
      placementRef.current = placed;

      for (const ref of refs) {
        const placement = placed.get(ref.body.path);
        const point = at.get(ref.body.path);
        if (!ref.label || !placement || !point) continue;
        const gap = bodyRadius(ref.body) + 7;
        // `placeLabels` resolves collisions but knows nothing about the
        // viewport, so its inward fallback can hang a name off the edge.
        // On screen beats uncollided.
        const extent = gap + ref.labelWidth;
        const fitsLeft = centre + point.x - extent >= 6;
        const fitsRight = centre + point.x + extent <= width - 6;
        const wanted = placement.side === 'left';
        const left = wanted ? fitsLeft || !fitsRight : !(fitsRight || !fitsLeft);
        ref.label.setAttribute('x', round(left ? -gap : gap));
        ref.label.classList.toggle('flip', left);
        ref.label.setAttribute('dy', `${(0.35 + placement.dy * 1.05).toFixed(2)}em`);
      }
    }

    function placeCourse(angleOf: (body: Body) => number): void {
      const { R: radius, course: legs, byPath: index } = drawRef.current;
      if (legs.length === 0) return;
      const points: [number, number][] = [];
      for (const path of legs) {
        const body = index.get(path);
        if (!body) continue;
        const angle = angleOf(body);
        points.push([Math.cos(angle) * body.orbit * radius, Math.sin(angle) * body.orbit * radius]);
      }
      flightLineRef.current?.setAttribute(
        'points',
        points.map(([x, y]) => `${round(x)},${round(y)}`).join(' '),
      );
      const tip = points[points.length - 1];
      if (!tip || !shipRef.current) return;
      const from = points[points.length - 2] ?? [0, 0];
      const heading = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
      shipRef.current.setAttribute(
        'transform',
        `translate(${round(tip[0])},${round(tip[1])}) rotate(${round(heading / DEG + 90)})`,
      );
    }

    function writeFrozen(): void {
      for (const ref of refsRef.current.values()) placeBody(ref, ref.body.phase, 0);
      placeCourse((body) => body.phase);
      layoutLabels((body) => body.phase);
    }
    redrawRef.current = writeFrozen;

    /** Turns an absolute angle into "how far round from 12 o'clock", in [0, 2π). */
    function fromTop(angle: number): number {
      const a = (angle + Math.PI / 2) % TAU;
      return a < 0 ? a + TAU : a;
    }

    function runSweep(t: number, orbitTime: number): void {
      const wedge = sweepRef.current;
      if (!wedge) return;
      const travelled = Math.min(1, t / SWEEP_MS) * TAU;
      wedge.setAttribute('transform', `rotate(${round((travelled - Math.PI / 2) / DEG)})`);
      for (const ref of refsRef.current.values()) {
        if (pinged.has(ref.body.path) || !matches.has(ref.body.path)) continue;
        const bodyAngle = ref.body.phase + (TAU * orbitTime) / ref.body.periodMs;
        if (fromTop(bodyAngle) > travelled) continue; // the wedge has not reached it yet
        pinged.add(ref.body.path);
        ref.group.classList.add('ping');
        pingTimers.push(window.setTimeout(() => ref.group.classList.remove('ping'), PING_MS));
      }
    }

    let raf = 0;
    let frames = 0;
    let anchor = 0;
    let sweepStart = 0;
    let easeStart = 0;
    const easeFrom = new Map<string, number>();

    const easingBack = !orbitOn && wasOrbitRef.current;
    if (orbitOn && !wasOrbitRef.current) elapsedRef.current = 0;
    wasOrbitRef.current = orbitOn;

    function orbitFrame(now: number): void {
      elapsedRef.current = now - anchor;
      const t = elapsedRef.current;
      const angleOf = (body: Body) => body.phase + (TAU * t) / body.periodMs;
      for (const ref of refsRef.current.values()) placeBody(ref, angleOf(ref.body), t);
      placeCourse(angleOf);
      // Re-solving the label layout every frame is wasted work — bodies move a
      // fraction of a pixel per frame — and the hysteresis in `placeLabels`
      // keeps the quarter-rate updates from reading as flicker.
      frames += 1;
      if (frames % 4 === 1) layoutLabels(angleOf);
      if (sweeping) runSweep(t - sweepStart, t);
      countFrame();
      raf = requestAnimationFrame(orbitFrame);
    }

    function easedAngle(body: Body, eased: number): number {
      const from = easeFrom.get(body.path);
      if (from === undefined) return body.phase;
      return from + shortestDelta(from, body.phase) * eased;
    }

    function easeFrame(now: number): void {
      const k = Math.min(1, (now - easeStart) / EASE_BACK_MS);
      const eased = 1 - (1 - k) ** 3;
      const angleOf = (body: Body) => easedAngle(body, eased);
      for (const ref of refsRef.current.values()) placeBody(ref, angleOf(ref.body), 0);
      placeCourse(angleOf);
      frames += 1;
      if (frames % 4 === 1) layoutLabels(angleOf);
      countFrame();
      if (k < 1) {
        raf = requestAnimationFrame(easeFrame);
        return;
      }
      raf = 0;
      writeFrozen();
    }

    function start(): void {
      if (document.visibilityState !== 'visible') return;
      anchor = performance.now() - elapsedRef.current;
      sweepStart = elapsedRef.current;
      raf = requestAnimationFrame(orbitFrame);
    }

    function stop(): void {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      for (const timer of pingTimers) clearTimeout(timer);
    }

    if (easingBack) {
      const stoppedAt = elapsedRef.current;
      for (const ref of refsRef.current.values()) {
        easeFrom.set(ref.body.path, ref.body.phase + (TAU * stoppedAt) / ref.body.periodMs);
      }
      easeStart = performance.now();
      raf = requestAnimationFrame(easeFrame);
      return stop;
    }

    if (!orbitOn) {
      writeFrozen();
      return;
    }

    const onVisibility = () => {
      stop();
      if (document.visibilityState === 'visible') start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    start();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
    // Geometry and the flight path are read live through `drawRef`, so they are
    // deliberately not dependencies: changing them must not restart the loop.
  }, [orbitOn, matches, sweeping, w, h]);

  // Keyboard selection moves DOM focus onto the body, so Enter/Space and the
  // focus ring follow the selection.
  useEffect(() => {
    if (!selected) return;
    const group = groups.current.get(selected);
    // Focus follows the selection only when the map already had it — a
    // selection made from the palette must not steal focus from elsewhere.
    // (`.map-view` is MapView's container, one level above this canvas.)
    const view = hostRef.current?.closest('.map-view');
    if (!group || !view || !view.contains(document.activeElement)) return;
    if (document.activeElement === group) return;
    group.focus();
  }, [selected]);

  function onBackgroundClick(event: MouseEvent): void {
    if ((event.target as Element).closest('.map-body')) return;
    onSelect(null);
  }

  /**
   * The seam's rule: a folder is entered, everything else is opened. The
   * event is marked handled so the viewport's own double-click — which fits
   * the camera — stands down (`useViewport` checks `defaultPrevented`).
   */
  function activate(event: MouseEvent, body: Body): void {
    event.preventDefault();
    if (body.kind === 'directory') onDive(body.path);
    else onOpen(body.path, body.kind);
  }

  const pressure = labelPressure(view.length, R);
  // Sits in the gap between the corona (r 36) / chart glyph (r 14) and the
  // innermost orbit (ORBIT_MIN·R). On a small rim that gap closes, so the
  // caption tucks in and `layoutLabels` treats the whole star as an obstacle
  // body labels route around.
  const starLabelY = Math.max(
    mode === 'orbit' ? 30 : 24,
    Math.min(mode === 'orbit' ? 47 : 32, ORBIT_MIN * R - 10),
  );
  drawRef.current = { R, cx, w, course, byPath, starLabelY };

  return (
    <div className="map-canvas" ref={hostRef}>
      {w > 0 && h > 0 && (
        <svg
          {...bind}
          className="map-svg"
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          role="img"
          aria-label="Workspace map"
          data-map-mode={mode}
          data-map-motion={orbitOn ? 'orbit' : 'frozen'}
          data-busy={anyBusy ? 'true' : 'false'}
          /* Names are captions, not drawing: `map.css` scales them back by
             this so they read at one size at every zoom. */
          style={{ '--inv-k': (1 / viewport.camera.k).toFixed(4) } as CSSProperties}
          onClick={onBackgroundClick}
          onMouseLeave={() => onHover(null)}
        >
          <defs>
            <radialGradient id={`${uid}-core`}>
              <stop className="star-stop-core" offset="0%" />
              <stop className="star-stop-mid" offset="55%" />
              <stop className="star-stop-edge" offset="100%" />
            </radialGradient>
            <radialGradient id={`${uid}-corona`}>
              <stop className="corona-stop-in" offset="0%" />
              <stop className="corona-stop-mid" offset="45%" />
              <stop className="corona-stop-out" offset="100%" />
            </radialGradient>
            <radialGradient id={`${uid}-scan`}>
              <stop className="sweep-stop-in" offset="0%" />
              <stop className="sweep-stop-out" offset="100%" />
            </radialGradient>
            {RING_BANDS.map((band) => (
              <path key={band} id={`${uid}-ring-${band}`} d={ringLabelPath(R * ringOrbit(band))} />
            ))}
            <path id={`${uid}-ring-older`} d={ringLabelPath(R)} />
          </defs>

          {showStars && (
            <g className="map-stars" aria-hidden="true">
              {stars.map((star, i) => (
                <circle key={i} className={`star-mote tier-${star.tier}`} cx={star.x} cy={star.y} r={star.r} />
              ))}
            </g>
          )}

          {/* The user's window onto the chart. Outside it: the star field,
              which is a backdrop rather than part of the system. Inside it:
              everything the orbit loop and the sweep write to, which carry on
              in world units without knowing the camera exists. */}
          <g className="viewport" style={{ transform }}>
            <g className="map-camera" transform={`translate(${round(cx)},${round(cy)})`}>
              <g ref={systemRef} className={dive ? `map-system dive-${dive}` : 'map-system'}>
                <g className="map-rings" aria-hidden="true">
                  {RING_BANDS.map((band, i) => (
                    <circle
                      key={band}
                      className={i % 2 === 1 ? 'map-ring map-ring-alt' : 'map-ring'}
                      r={round(R * ringOrbit(band))}
                    />
                  ))}
                  <circle className="map-ring map-ring-rim" r={round(R)} />
                  {[...RING_BANDS, 'older' as const].map((band) => {
                    const caption = BANDS.find((b) => b.id === band)?.label ?? band;
                    const radius = band === 'older' ? R : R * ringOrbit(band);
                    return (
                      <text key={band} className="ring-label" dy="-4">
                        <textPath
                          href={`#${uid}-ring-${band}`}
                          startOffset={ringCaptionOffset(radius, caption)}
                        >
                          {caption}
                        </textPath>
                      </text>
                    );
                  })}
                </g>

                {course.length > 0 && (
                  <g className="map-flight" aria-hidden="true">
                    <polyline
                      ref={flightLineRef}
                      className="flight-line"
                      points={course
                        .map((path) => {
                          const body = byPath.get(path);
                          if (!body) return '';
                          const p = positionAt(body, 0, 0, 'frozen');
                          return `${round(p.x * R)},${round(p.y * R)}`;
                        })
                        .filter(Boolean)
                        .join(' ')}
                    />
                    <g ref={shipRef} className="flight-ship">
                      <path className="ship-hull" d="M 0 -5 L 3.5 4 L -3.5 4 Z" />
                    </g>
                  </g>
                )}

                <g className={anyBusy ? 'map-star is-busy' : 'map-star'}>
                  {!connected ? (
                    <circle className="star-offline" r={14} />
                  ) : mode === 'orbit' ? (
                    <>
                      <circle className="star-corona" r={36} fill={`url(#${uid}-corona)`} />
                      <circle className="star-disc" r={12} fill={`url(#${uid}-core)`} />
                    </>
                  ) : (
                    <>
                      <circle className="star-ring" r={14} />
                      <circle className="star-dot" r={4} />
                    </>
                  )}
                  <text className="star-label" y={starLabelY}>
                    {systemLabel}
                  </text>
                </g>

                <g className="map-bodies">
                  {view.map((body) => {
                    const status = statuses[body.path];
                    const r = bodyRadius(body);
                    const p = positionAt(body, 0, 0, 'frozen');
                    const isSelected = selected === body.path;
                    const isHovered = hovered === body.path;
                    const label = displayName(body);
                    const busy = status?.kernel === 'busy' || status?.kernel === 'restarting';
                    const led = status ? ledClass(status) : null;
                    const count = bodyLabelCount(body);
                    const forced =
                      isSelected || isHovered || status?.open === true || status?.active === true;
                    const showLabel = labelWanted(body, pressure, forced);
                    // First guess only: `layoutLabels` re-solves both sides and
                    // the vertical offset before this ever paints.
                    const extent = r + 7 + (label.length + (count?.length ?? 0)) * LABEL_CHAR_PX;
                    const flip = outwardSide(p.x * R, extent, cx, w) === 'left';

                    const classes = [
                      'map-body',
                      `kind-${body.kind}`,
                      `band-${body.band}`,
                      status?.open ? 'is-open' : '',
                      status?.active ? 'is-active' : '',
                      status?.dirty ? 'is-dirty' : '',
                      isSelected ? 'is-selected' : '',
                      isHovered ? 'is-hovered' : '',
                      filtering ? (matches.has(body.path) ? 'match' : 'dim') : '',
                    ]
                      .filter(Boolean)
                      .join(' ');

                    return (
                      <g
                        key={body.path}
                        ref={(el) => {
                          if (el) groups.current.set(body.path, el);
                          else groups.current.delete(body.path);
                        }}
                        className={classes}
                        transform={`translate(${round(p.x * R)},${round(p.y * R)})`}
                        role="button"
                        tabIndex={0}
                        aria-label={`${label}, ${body.kind}, modified ${relativeTime(body.modifiedAt)}`}
                        aria-pressed={isSelected}
                        onClick={() => onSelect(body.path)}
                        onDoubleClick={(event) => activate(event, body)}
                        onPointerEnter={() => onHover(body.path)}
                        onPointerLeave={() => onHover(null)}
                        onFocus={() => onHover(body.path)}
                        onBlur={() => onHover(null)}
                      >
                        <circle className="hit" r={Math.max(r + 6, 11)} />
                        <path
                          className="trail trail-far"
                          d={trailPath(body.orbit * R, body.phase, TRAIL_FAR.deg, TRAIL_FAR.px)}
                        />
                        <path
                          className="trail trail-near"
                          d={trailPath(body.orbit * R, body.phase, TRAIL_NEAR.deg, TRAIL_NEAR.px)}
                        />

                        <circle className="halo" r={round(r + 3)} />
                        <circle className="halo-2" r={round(r + 6)} />

                        {body.kind === 'file' ? (
                          <path className="shape" d={asteroidPath(body.path, r)} />
                        ) : (
                          <circle className="shape" r={round(r)} />
                        )}

                        {body.kind === 'directory' && (
                          <>
                            <ellipse
                              className="belt"
                              rx={round(r + 5)}
                              ry={round((r + 5) * 0.35)}
                              transform="rotate(-20)"
                            />
                            {(body.moons ?? []).slice(0, 6).map((moon, i) => {
                              const a = (hashString(moon) / 0x1_0000_0000) * TAU;
                              const mr = r + 8 + i * 2.2;
                              return (
                                <circle
                                  key={moon}
                                  className="moon"
                                  cx={round(Math.cos(a) * mr)}
                                  cy={round(Math.sin(a) * mr * 0.35)}
                                  r={1.4}
                                />
                              );
                            })}
                          </>
                        )}

                        {(status?.errors ?? 0) > 0 && (
                          <path className="err-arc" d={arcPath(r + 3, -50 * DEG, 50 * DEG)} />
                        )}
                        {status?.dirty && (
                          <path
                            className="dirty-tick"
                            d={`M ${round(Math.SQRT1_2 * (r + 2))} ${round(Math.SQRT1_2 * (r + 2))} L ${round(
                              Math.SQRT1_2 * (r + 5),
                            )} ${round(Math.SQRT1_2 * (r + 5))}`}
                          />
                        )}
                        {led && (
                          <circle
                            className={`led-dot ${led}`}
                            cx={round(Math.SQRT1_2 * (r + 3))}
                            cy={round(-Math.SQRT1_2 * (r + 3))}
                            r={2.5}
                          />
                        )}
                        {busy && (
                          <circle
                            className="sat"
                            r={2}
                            cx={round(Math.SQRT1_2 * (r + 9))}
                            cy={round(Math.SQRT1_2 * (r + 9))}
                          />
                        )}

                        <path className="reticle" d={reticlePath(r + 9, 6)} />
                        <circle className="sel-ring" r={round(r + 9)} />

                        {showLabel && (
                          <text
                            className={flip ? 'map-label flip' : 'map-label'}
                            x={round(flip ? -(r + 7) : r + 7)}
                            dy="0.35em"
                          >
                            {label}
                            {count && <tspan className="label-count">{count}</tspan>}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>

                {sweeping && (
                  <g ref={sweepRef} className="map-sweep" aria-hidden="true">
                    <path className="sweep-wedge" d={wedgePath(R, SWEEP_ARC)} fill={`url(#${uid}-scan)`} />
                  </g>
                )}
              </g>
            </g>
          </g>
        </svg>
      )}
    </div>
  );
}

/**
 * Dev-only frame counter, so the "the loop really does stop" claim can be
 * checked from the console (`window.__orbitalMapFrames`) instead of taken on
 * trust. Stripped from production builds.
 */
function countFrame(): void {
  if (!import.meta.env.DEV) return;
  const w = window as Window & { __orbitalMapFrames?: number };
  w.__orbitalMapFrames = (w.__orbitalMapFrames ?? 0) + 1;
}

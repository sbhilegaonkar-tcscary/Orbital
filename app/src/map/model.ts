/**
 * Map geometry and classification. Pure: no React, no stores, no DOM — so it
 * runs in the vitest node environment and `map/store.ts` can call it from a
 * memo without side effects.
 *
 * The whole model is one idea: **orbit radius encodes recency**. A body's age
 * is mapped logarithmically onto [ORBIT_MIN, 1] between one hour and two
 * years, so "edited an hour ago" hugs the star and "untouched for two years"
 * sits on the rim. Everything else (band, reference ring, orbital period,
 * visual scale) is derived from that one number, which is why Chart and Orbit
 * are the same geometry drawn two ways.
 */
import type { ContentsEntry } from '../session/types';

export type BodyKind = 'notebook' | 'directory' | 'file';
export type Band = 'today' | 'week' | 'month' | 'halfyear' | 'older';

/** What the store feeds the layout. */
export interface BodyInput {
  path: string;
  name: string;
  kind: BodyKind;
  /** epoch ms */
  modifiedAt: number;
  /** notebooks and files */
  bytes?: number;
  /** directories, when their listing is cached */
  childCount?: number;
  /** directories: names of notebooks inside (first 6), when cached */
  moons?: string[];
}

export interface Body extends BodyInput {
  band: Band;
  /** ORBIT_MIN..1, fraction of the system radius. */
  orbit: number;
  /** radians; the body's angle in Chart mode. From hashString(path), then relaxed. */
  phase: number;
  /** Kepler's third law from `orbit`. */
  periodMs: number;
  /** 0.75..1.5 visual multiplier. */
  scale: number;
}

export const ORBIT_MIN = 0.22;
/** Period at ORBIT_MIN. Everything outside it is slower, by T ∝ r^1.5. */
export const BASE_PERIOD_MS = 90_000;
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export const BANDS: { id: Band; label: string; maxAgeMs: number }[] = [
  { id: 'today', label: 'today', maxAgeMs: DAY },
  { id: 'week', label: 'this week', maxAgeMs: 7 * DAY },
  { id: 'month', label: 'this month', maxAgeMs: 30 * DAY },
  { id: 'halfyear', label: '6 months', maxAgeMs: 182 * DAY },
  { id: 'older', label: 'older', maxAgeMs: Number.POSITIVE_INFINITY },
];

/** Ages below this all sit on the innermost orbit; above it, on the rim. */
const MIN_AGE_MS = HOUR;
const MAX_AGE_MS = 730 * DAY; // two years
const LOG_SPAN = Math.log(MAX_AGE_MS / MIN_AGE_MS);

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/**
 * The wedge the ring captions (TODAY … OLDER) ride in, measured from +x with
 * y growing downward — the arc just clockwise of 12 o'clock. No body is ever
 * laid out inside it, so a caption can never end up under a planet.
 */
export const LABEL_SECTOR = { start: -100 * DEG, end: -48 * DEG };

/** Two bodies closer than this in orbit are considered on the same ring. */
const CROWD_ORBIT = 0.06;
/** ...and must then sit at least this far apart in angle. */
const CROWD_PHASE = 0.22;
const RELAX_STEP = 0.02;
const RELAX_ITERATIONS = 40;

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** FNV-1a, 32-bit, unsigned. Stable across runs, unlike a string hash built on Math.random. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Park–Miller, the same generator `effects/Sky.tsx` uses, so a seed produces
 * the same sequence in both places. The seed is folded into the generator's
 * valid range first (0 and multiples of the modulus are fixed points that
 * would otherwise return 0 forever); seeds already in range are untouched.
 */
export function seededRng(seed: number): () => number {
  let s = Math.floor(seed) % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

export function bandFor(ageMs: number): Band {
  for (const band of BANDS) {
    if (ageMs <= band.maxAgeMs) return band.id;
  }
  return 'older';
}

/** log-scaled age → orbit. Age clamps to [1h, 2y]. Monotonic. */
export function orbitFor(ageMs: number): number {
  const clamped = Math.min(Math.max(ageMs, MIN_AGE_MS), MAX_AGE_MS);
  return ORBIT_MIN + (1 - ORBIT_MIN) * (Math.log(clamped / MIN_AGE_MS) / LOG_SPAN);
}

/** The orbit radius a band boundary sits on, for the reference rings. */
export function ringOrbit(band: Exclude<Band, 'older'>): number {
  const entry = BANDS.find((b) => b.id === band);
  return orbitFor(entry ? entry.maxAgeMs : MAX_AGE_MS);
}

export function periodFor(orbit: number): number {
  return BASE_PERIOD_MS * (orbit / ORBIT_MIN) ** 1.5;
}

export function scaleFor(input: BodyInput): number {
  if (input.kind === 'directory') {
    if (input.childCount === undefined) return 1;
    return 0.8 + clamp01(input.childCount / 24) * 0.7;
  }
  if (input.bytes === undefined) return 1;
  // log10 2..6 is ~100 B to ~1 MB, which is the whole useful range for a
  // notebook; anything bigger is already the largest dot on the map.
  return 0.75 + clamp01((Math.log10(input.bytes + 1) - 2) / 4) * 0.75;
}

/** Wraps an angle into [0, 2π). */
function normalize(angle: number): number {
  const a = angle % TAU;
  return a < 0 ? a + TAU : a;
}

const SECTOR_START = normalize(LABEL_SECTOR.start);
const SECTOR_WIDTH = normalize(LABEL_SECTOR.end - LABEL_SECTOR.start);
/** Everything a body may use, i.e. the circle minus the caption wedge. */
const FREE_ARC = TAU - SECTOR_WIDTH;

/** True when `angle` falls inside the ring-caption wedge. */
export function isInLabelSector(angle: number): boolean {
  return normalize(angle - SECTOR_START) < SECTOR_WIDTH;
}

/**
 * Nudges an angle out of the caption wedge, leaving by whichever edge it was
 * travelling towards, so a relaxation step never loses the separation it just
 * bought by bouncing the body back the way it came.
 */
function leaveSector(angle: number, direction: number): number {
  const offset = normalize(angle - SECTOR_START);
  if (offset >= SECTOR_WIDTH) return normalize(angle);
  // The trailing edge is *inside* the sector (it is the half-open interval
  // [start, end)), so leaving backwards has to clear it by a hair.
  return normalize(direction >= 0 ? SECTOR_START + SECTOR_WIDTH : SECTOR_START - 1e-6);
}

/** The hash spread evenly over the arc the captions do not use. */
function phaseFromPath(path: string): number {
  const u = hashString(path) / 0x1_0000_0000;
  return normalize(SECTOR_START + SECTOR_WIDTH + u * FREE_ARC);
}

export function makeBody(input: BodyInput, now: number): Body {
  const age = Math.max(0, now - input.modifiedAt);
  const orbit = orbitFor(age);
  return {
    ...input,
    band: bandFor(age),
    orbit,
    phase: phaseFromPath(input.path),
    periodMs: periodFor(orbit),
    scale: scaleFor(input),
  };
}

/** Shortest signed arc from `from` to `to`, in (-π, π]. */
export function shortestDelta(from: number, to: number): number {
  return normalize(to - from + Math.PI) - Math.PI;
}

/**
 * Lays out one system. Deterministic for a given input set regardless of
 * input order (sorted by path first). After `makeBody`, phases are relaxed so
 * no two bodies with |Δorbit| < 0.06 sit within 0.22 rad of each other: the
 * offending pair is pushed apart symmetrically in 0.02 rad steps, for at most
 * 40 passes. This is what stops same-day siblings from stacking into one dot.
 */
export function layoutSystem(inputs: BodyInput[], now: number): Body[] {
  const sorted = [...inputs].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const bodies = sorted.map((input) => makeBody(input, now));

  for (let pass = 0; pass < RELAX_ITERATIONS; pass += 1) {
    let moved = false;
    for (let i = 0; i < bodies.length; i += 1) {
      for (let j = i + 1; j < bodies.length; j += 1) {
        const a = bodies[i];
        const b = bodies[j];
        if (Math.abs(a.orbit - b.orbit) >= CROWD_ORBIT) continue;
        const delta = shortestDelta(a.phase, b.phase);
        if (Math.abs(delta) >= CROWD_PHASE) continue;
        // delta === 0 (identical phases) has no "apart" direction; pick one.
        const dir = delta === 0 ? 1 : Math.sign(delta);
        b.phase = leaveSector(b.phase + dir * RELAX_STEP, dir);
        a.phase = leaveSector(a.phase - dir * RELAX_STEP, -dir);
        moved = true;
      }
    }
    if (!moved) break;
  }

  return bodies;
}

/** Chart / frozen: `phase`. Orbit: phase + 2π·(t − tStart)/periodMs, prograde. */
export function angleAt(body: Body, t: number, tStart: number, motion: 'frozen' | 'orbit'): number {
  if (motion === 'frozen') return body.phase;
  return body.phase + (TAU * (t - tStart)) / body.periodMs;
}

/** Unit-circle position (multiply by the system radius; y grows downward in SVG). */
export function positionAt(
  body: Body,
  t: number,
  tStart: number,
  motion: 'frozen' | 'orbit',
): { x: number; y: number } {
  const angle = angleAt(body, t, tStart, motion);
  return { x: Math.cos(angle) * body.orbit, y: Math.sin(angle) * body.orbit };
}

function isHidden(name: string): boolean {
  return name.startsWith('.');
}

/** Dotfiles hidden unless showHidden. Directories get childCount/moons from `entriesByDir` when present. */
export function entriesToBodyInputs(
  entries: ContentsEntry[],
  entriesByDir: Record<string, ContentsEntry[]>,
  showHidden: boolean,
): BodyInput[] {
  const inputs: BodyInput[] = [];

  for (const entry of entries) {
    if (!showHidden && isHidden(entry.name)) continue;

    const parsed = Date.parse(entry.lastModified);
    const input: BodyInput = {
      path: entry.path,
      name: entry.name,
      kind: entry.type,
      // An unparseable timestamp lands on the rim rather than in "today":
      // unknown recency is not recency.
      modifiedAt: Number.isNaN(parsed) ? 0 : parsed,
    };

    if (entry.type === 'directory') {
      const children = entriesByDir[entry.path];
      if (children) {
        const visible = showHidden ? children : children.filter((c) => !isHidden(c.name));
        input.childCount = visible.length;
        const moons = visible.filter((c) => c.type === 'notebook').slice(0, 6).map((c) => c.name);
        if (moons.length > 0) input.moons = moons;
      }
    } else if (typeof entry.size === 'number') {
      input.bytes = entry.size;
    }

    inputs.push(input);
  }

  return inputs.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// ---- label placement -------------------------------------------------------

export type LabelSide = 'left' | 'right';

export interface Placement {
  side: LabelSide;
  /** Vertical offset in label-height units. */
  dy: -1 | 0 | 1;
}

export interface LabelItem {
  id: string;
  /** The body's centre, in system coordinates. */
  x: number;
  y: number;
  /**
   * Horizontal extent from the body's centre to the far edge of the label,
   * gap included — so the box on the right is [x, x + w] and on the left
   * [x − w, x].
   */
  w: number;
  /** Label line height; `dy` steps by 1.05 of it. */
  h: number;
  /** The side pointing away from the star (and inside the viewport). */
  outward: LabelSide;
}

export interface LabelObstacle {
  x: number;
  y: number;
  /** The body's own radius; the clearance below is added on top. */
  r: number;
}

/** How far a label must stay clear of a body it does not belong to. */
export const LABEL_CLEARANCE = 4;
const DY_STEP = 1.05;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function boxFor(item: LabelItem, placement: Placement): Box {
  const cy = item.y + placement.dy * item.h * DY_STEP;
  return {
    x0: placement.side === 'left' ? item.x - item.w : item.x,
    x1: placement.side === 'left' ? item.x : item.x + item.w,
    y0: cy - item.h / 2,
    y1: cy + item.h / 2,
  };
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

function boxHitsDisc(box: Box, disc: LabelObstacle): boolean {
  const nearestX = Math.min(Math.max(disc.x, box.x0), box.x1);
  const nearestY = Math.min(Math.max(disc.y, box.y0), box.y1);
  const reach = disc.r + LABEL_CLEARANCE;
  return Math.hypot(disc.x - nearestX, disc.y - nearestY) < reach;
}

function samePlacement(a: Placement, b: Placement): boolean {
  return a.side === b.side && a.dy === b.dy;
}

/**
 * Greedy label de-collision. Walk the items in the order given (the caller
 * passes orbit order, inner ring first, so the busy middle wins ties) and give
 * each the first placement that clears every label already placed and every
 * body's disc.
 *
 * `previous` is tried before anything else: a placement that still works is
 * kept, which is what stops labels flickering between sides as the system
 * turns. An item's own disc is ignored — its label starts at its centre.
 */
export function placeLabels(
  items: LabelItem[],
  obstacles: LabelObstacle[],
  previous: Map<string, Placement>,
): Map<string, Placement> {
  const placements = new Map<string, Placement>();
  const taken: Box[] = [];

  for (const item of items) {
    const inward: LabelSide = item.outward === 'left' ? 'right' : 'left';
    const candidates: Placement[] = [
      { side: item.outward, dy: 0 },
      { side: inward, dy: 0 },
      { side: item.outward, dy: -1 },
      { side: item.outward, dy: 1 },
      { side: inward, dy: -1 },
      { side: inward, dy: 1 },
    ];
    const remembered = previous.get(item.id);
    if (remembered) {
      candidates.unshift(remembered);
      // ...and drop the duplicate further down the list.
      for (let i = candidates.length - 1; i > 0; i -= 1) {
        if (samePlacement(candidates[i], remembered)) candidates.splice(i, 1);
      }
    }

    // Its own body sits at the box's inner edge; only other discs matter.
    const others = obstacles.filter(
      (o) => Math.abs(o.x - item.x) > 0.5 || Math.abs(o.y - item.y) > 0.5,
    );

    // Nothing clears: keep the natural outward placement rather than an
    // arbitrary displaced one.
    let chosen: Placement = { side: item.outward, dy: 0 };
    for (const candidate of candidates) {
      const box = boxFor(item, candidate);
      if (taken.some((t) => boxesOverlap(box, t))) continue;
      if (others.some((o) => boxHitsDisc(box, o))) continue;
      chosen = candidate;
      break;
    }

    placements.set(item.id, chosen);
    taken.push(boxFor(item, chosen));
  }

  return placements;
}

/** The muted ` · n` a folder's label carries once its listing is cached. */
export function bodyLabelCount(body: Pick<Body, 'kind' | 'childCount'>): string | null {
  if (body.kind !== 'directory' || body.childCount === undefined) return null;
  return ` · ${body.childCount}`;
}

export function displayName(body: Pick<Body, 'name' | 'kind'>): string {
  return body.kind === 'notebook' && body.name.endsWith('.ipynb') ? body.name.slice(0, -6) : body.name;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${BYTE_UNITS[unit]}`;
}

/**
 * Irregular asteroid outline for files: 6 vertices, radius jittered ±30% by
 * `seededRng(hashString(path))`, so every file is a distinct little rock and
 * the same file is the same rock on every load.
 */
export function asteroidPath(path: string, r: number): string {
  const rng = seededRng(hashString(path));
  const points: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * TAU;
    const radius = r * (0.7 + rng() * 0.6);
    points.push(`${(Math.cos(angle) * radius).toFixed(2)} ${(Math.sin(angle) * radius).toFixed(2)}`);
  }
  return `M ${points.join(' L ')} Z`;
}

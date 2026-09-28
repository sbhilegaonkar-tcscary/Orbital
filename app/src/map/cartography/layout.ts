/**
 * The cartography composition solver.
 *
 * The two cartography mockups place every world by hand. This does not: it is
 * given a stage and a system and *solves* the plate, so the same picture holds
 * for one world or thirty, at 1400x900 or 560x500.
 *
 * The idea is one sentence long: **distance from the star still encodes age**
 * (the whole map's premise, `model.orbitFor`), but the ring is opened out into
 * a slanted ellipse that only occupies the arc from up-right round to
 * down-right, so the plate reads as a composition rather than a dartboard.
 * Newer worlds sit nearer, larger and lower; the derelicts drift up and out.
 *
 * Everything here is pure: no React, no DOM, no `Date.now()`. That is what
 * lets `layout.test.ts` assert non-overlap and monotonicity in the node
 * environment, and what makes the plate identical on every load.
 */
import {
  ORBIT_MIN,
  displayName,
  hashString,
  placeLabels,
  seededRng,
  type Band,
  type Body,
  type BodyInput,
  type BodyKind,
  type LabelItem,
  type LabelObstacle,
  type LabelSide,
  type Placement,
} from '../model';
import type { Box } from '../viewport';
import { RING_REACH, characterIndex } from './sigils';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
/** 1/phi. The golden walk: n points spread as evenly as n points can be. */
const GOLDEN = 0.618033988749895;

// ---- the composition -------------------------------------------------------

/** Stage margins. The bottom owes the legend, the top the breadcrumb. */
const PAD_X = 26;
const PAD_TOP = 34;
const PAD_BOTTOM = 52;

/**
 * How much bigger than the stage the plate is drawn.
 *
 * Until the camera existed the stage was a wall: the fit pass shrank the whole
 * composition until it fitted, so a 90 px world became a 60 px world on a
 * small window and the plate read as a crowded badge. Now the stage is a
 * window instead, and the plate is composed on a *virtual* stage this many
 * times bigger, which the camera pans and zooms over. Worlds keep their real
 * size, the ring has room to breathe, and the fit pass only ever has to fit
 * the plate into this extent - never into the host.
 *
 * `1` reproduces the old fit-to-stage plate exactly.
 */
export const SPREAD_DEFAULT = 1.7;

/**
 * Where the star sits, and how flat the world family is, before the fit pass.
 * Both are a function of the stage's aspect: the renderer's real host is the
 * view minus a 320 px explorer column, which on a narrow window is *portrait*,
 * and a composition tuned for landscape collapses there. `shapeOf` slides
 * between the two - star low and left over a flat family on a wide stage, star
 * lower and more central under a tall family on a narrow one.
 */
const LANDSCAPE = { fx: 0.245, fy: 0.66, ellipseY: 0.82 };
const PORTRAIT = { fx: 0.365, fy: 0.72, ellipseY: 1.16 };

/** Outer ray radius of the star sigil. */
const STAR_R = 46;
/** The inner court holds the root notebooks; it grows with how many there are. */
const COURT_MIN_R = 104;
const COURT_MAX_R = 150;
/** The rune ring sits this far outside the court. */
const ORRERY_GAP = 44;

const WORLD_MIN_D = 90;
const WORLD_MAX_D = 170;
/** The child count that reads as "as big as a world gets". */
const WORLD_FULL_COUNT = 200;
/** Past this many worlds diameters come down so the total ink stays constant. */
const SHRINK_ABOVE = 12;

/**
 * The arc worlds may occupy, measured from +x with y growing downward: from
 * up-and-slightly-left, clockwise round the right side, to down-right. The
 * quarter behind the star is left empty on purpose - that is where the belt
 * sweeps and where the star writes its name.
 */
const ARC_FROM = -112 * DEG;
const ARC_TO = 44 * DEG;
/** How much of a world's angle is its age rather than its place in the walk. */
const AGE_BIAS = 0.34;
/** The plate's slant. */
const TILT = -9 * DEG;

/** Clear space demanded between two world discs. */
const GAP = 15;
const ITERATIONS = 60;
/** Gauss-Seidel damping: a full correction per pair oscillates. */
const PUSH = 0.55;
/** How much emptier than solid the world ring is seeded, by area. */
const PACKING = 1.6;
/** `sigils.CHARACTERS[3]` is the one that wears a ring system. */
const RINGED_CHARACTER = 3;
/** A plate can only carry so much string before it reads as a cobweb. */
const BAND_THREAD_CAP = 8;
const WAKE_CAP = 4;

/** Court notebooks: body radius range. */
const NB_MIN_R = 6.5;
const NB_MAX_R = 12;
/**
 * The wedge straight below the star, where the system writes its name. No
 * court body is ever laid out inside it - the same trick `model.LABEL_SECTOR`
 * plays for the chart's ring captions.
 */
const COURT_FROM = 150 * DEG;
const COURT_SPAN = 228 * DEG;
/**
 * How many court captions a plate carries before it starts choosing. The rest
 * are drawn but held at zero opacity until hovered or selected (cartography.css),
 * which costs no layout and keeps the court from becoming a word pile.
 */
const COURT_LABEL_BUDGET = 6;

/** Belt motes. */
const MOTE_MIN_R = 2.4;
const MOTE_MAX_R = 6.6;
/** The belt sweeps the quarter the worlds do not use. */
const BELT_FROM = 58 * DEG;
const BELT_TO = 212 * DEG;

/** Label metrics, in px per character, for the display name and mono caption. */
const NAME_PX = 9.3;
const CAP_PX = 6.9;
const LABEL_H = 34;
const LABEL_GAP = 9;
/** Type shrinks with the plate, but only this far: past it, it is unreadable. */
const TEXT_MIN = 0.74;
/** How many times the fit pass re-solves itself. It converges in three. */
const FIT_PASSES = 6;

/** Moons of a focused world. */
const MOON_CAP = 10;
const MOON_GAP = 54;

// ---- types -----------------------------------------------------------------

export interface WorldNode {
  path: string;
  label: string;
  x: number;
  y: number;
  r: number;
  band: Band;
  /** 0 = changed in the last hour, 1 = two years untouched. */
  age: number;
  /** The count the diameter was solved from. */
  count: number;
  body: Body;
  /** Translation that carries this world to the focus centre. */
  focus: { dx: number; dy: number };
}

export interface CourtNode {
  path: string;
  label: string;
  x: number;
  y: number;
  r: number;
  /** The caption goes above rather than below (the body sits above the star). */
  up: boolean;
  /** Whether this body claimed one of the plate's court captions. */
  labelled: boolean;
  body: Body;
}

export interface MoteNode {
  path: string;
  label: string;
  x: number;
  y: number;
  r: number;
  body: Body;
}

export type ConnectorKind = 'band' | 'wake';

export interface Bead {
  x: number;
  y: number;
  /** degrees, along the curve */
  angle: number;
}

export interface Connector {
  id: string;
  kind: ConnectorKind;
  from: string;
  to: string;
  d: string;
  /** The quadratic itself, so a frame loop can walk a bead along it. */
  p0: [number, number];
  c: [number, number];
  p1: [number, number];
  beads: Bead[];
  tick: Bead;
}

export interface Guide {
  id: string;
  r: number;
  d: string;
  label: string | null;
  meridian: boolean;
  /** Scale ticks along the arc; the meridian's carry the direction arrows. */
  ticks: { x1: number; y1: number; x2: number; y2: number }[];
  arrows: Bead[];
}

export interface Moon {
  path: string;
  label: string;
  kind: BodyKind;
  x: number;
  y: number;
  r: number;
  /** Leader terminal, where the caption starts. */
  lx: number;
  ly: number;
  anchor: 'start' | 'end';
}

export interface MoonFan {
  orbitR: number;
  moons: Moon[];
  extra: number;
}

export interface CartographyLayout {
  width: number;
  height: number;
  star: { x: number; y: number; r: number; courtR: number; orreryR: number };
  worlds: WorldNode[];
  court: CourtNode[];
  motes: MoteNode[];
  /**
   * `d` is the belt as drawn; `capD` is the same curve traversed the other
   * way. The belt sweeps the *bottom* of the plate, and a `textPath` on a
   * right-to-left run there hangs upside down under the line, so the caption
   * rides the reversed copy and sits upright above it.
   */
  belt: { d: string; capD: string; span: number };
  connectors: Connector[];
  guides: Guide[];
  labels: Map<string, Placement>;
  /**
   * Everything the plate draws, as one box in plate coordinates: discs,
   * label boxes, the orrery ring, the belt and its caption. The camera fits
   * to this and clamps a drag against it, so whatever is missing here is
   * whatever you cannot reach.
   */
  bounds: Box;
  /** Uniform scale the fit pass applied to the whole plate. */
  scale: number;
  /** What the type is multiplied by, which the component publishes as a var. */
  textScale: number;
  focus: { x: number; y: number };
}

export interface LayoutInput {
  width: number;
  height: number;
  bodies: Body[];
  /** Known descendant counts; a world sizes by these when they are there. */
  descendants?: Record<string, number>;
  /** Recent notebooks, newest first; consecutive pairs draw the wake. */
  flightPath?: string[];
  /** Last frame's label sides, so labels do not flip as data arrives. */
  previousLabels?: Map<string, Placement>;
  /** Plate extent as a multiple of the stage. See `SPREAD_DEFAULT`. */
  spread?: number;
}

// ---- small helpers ---------------------------------------------------------

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** `body.orbit` is `orbitFor(age)`; this is it normalised onto 0..1. */
export function ageOf(body: Body): number {
  return clamp01((body.orbit - ORBIT_MIN) / (1 - ORBIT_MIN));
}

/** log-scaled child count into 0..1. 0 children reads smallest, 200+ largest. */
export function sizeT(count: number): number {
  return clamp01(Math.log10(Math.max(0, count) + 1) / Math.log10(WORLD_FULL_COUNT + 1));
}

/** Point on a quadratic Bezier. */
export function quadAt(
  p0: readonly [number, number],
  c: readonly [number, number],
  p1: readonly [number, number],
  t: number,
): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0],
    y: u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1],
  };
}

/** Tangent direction of a quadratic Bezier, in degrees. */
export function quadAngle(
  p0: readonly [number, number],
  c: readonly [number, number],
  p1: readonly [number, number],
  t: number,
): number {
  const u = 1 - t;
  const dx = 2 * u * (c[0] - p0[0]) + 2 * t * (p1[0] - c[0]);
  const dy = 2 * u * (c[1] - p0[1]) + 2 * t * (p1[1] - c[1]);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** How wide a world's label box is, leader gap included. */
export function labelExtent(name: string, caption: string): number {
  return LABEL_GAP + Math.max(name.length * NAME_PX, caption.length * CAP_PX);
}

/** The caption a world carries under its name. */
export function worldCaption(count: number): string {
  return `${count} item${count === 1 ? '' : 's'}`;
}

/** The widest caption a world of this size could grow, for the fit reserve. */
function captionReserve(count: number): string {
  return `${worldCaption(count)} . changed 00h ago`;
}

// ---- the solve -------------------------------------------------------------

interface Seed {
  body: Body;
  r: number;
  /**
   * Extra clearance this world claims beyond its disc. Only the ringed
   * character has any, and only in Bridge - but the plate is solved once for
   * both modes, so Paper pays a little air for a ring it does not draw.
   */
  pad: number;
  count: number;
  age: number;
  x: number;
  y: number;
}

/**
 * Golden-angle seeding. The walk supplies most of the angle so worlds of the
 * same age do not stack; the rest is the age itself, which is what tilts the
 * young worlds down and the derelicts up.
 */
function seedAngle(index: number, age: number): number {
  const walk = (index * GOLDEN) % 1;
  const u = clamp01(walk * (1 - AGE_BIAS) + (1 - age) * AGE_BIAS);
  return ARC_FROM + u * (ARC_TO - ARC_FROM);
}

interface Shape {
  star: { x: number; y: number };
  ellipseY: number;
  courtR: number;
  orreryR: number;
}

/**
 * How the plate is pitched for this stage. Aspect 1.45 and wider is the
 * landscape composition; 0.75 and narrower is the portrait one; between them
 * it slides. The court grows with the number of root notebooks it has to hold,
 * and with `air` - the spread's linear share, so a plate given 1.7x the room
 * opens its court by sqrt(1.7) rather than by all of it, which is what keeps
 * the inner ring reading as a court and not as a second orbit.
 */
function shapeOf(w: number, h: number, notebooks: number, air: number): Shape {
  const t = clamp01((1.45 - w / Math.max(1, h)) / 0.7);
  const lerp = (a: number, b: number): number => a + (b - a) * t;
  const courtR = clamp(COURT_MIN_R + notebooks * 4, COURT_MIN_R, COURT_MAX_R) * air;
  return {
    star: { x: w * lerp(LANDSCAPE.fx, PORTRAIT.fx), y: h * lerp(LANDSCAPE.fy, PORTRAIT.fy) },
    ellipseY: lerp(LANDSCAPE.ellipseY, PORTRAIT.ellipseY),
    courtR,
    orreryR: courtR + ORRERY_GAP,
  };
}

/** The tilted ellipse every radial placement on this plate is measured on. */
function ellipse(angle: number, rho: number, ellipseY: number): { x: number; y: number } {
  const ex = Math.cos(angle) * rho;
  const ey = Math.sin(angle) * rho * ellipseY;
  // The whole family leans; rotating the offset is cheaper than a transform
  // the solver would then have to invert.
  return {
    x: ex * Math.cos(TILT) - ey * Math.sin(TILT),
    y: ex * Math.sin(TILT) + ey * Math.cos(TILT),
  };
}

interface Belt {
  r0: number;
  r1: number;
  from: number;
  to: number;
}

/** The belt: a shallow spiral through the quarter the worlds leave empty. */
function beltGeometry(shape: Shape, height: number, count: number): Belt {
  const room = (height - PAD_BOTTOM - shape.star.y) / shape.ellipseY;
  const left = (shape.star.x - PAD_X) * 0.96;
  const r0 = clamp(shape.courtR + 22, 54, Math.max(54, Math.min(room * 0.94, left)));
  const r1 = r0 + clamp(count * 1.1, 10, 46);
  // A short belt for a few files, the full sweep once there are many.
  const span = (BELT_TO - BELT_FROM) * clamp01(0.42 + count / 26);
  return { r0, r1, from: BELT_FROM, to: BELT_FROM + span };
}

function beltPoint(shape: Shape, belt: Belt, t: number, dr = 0): { x: number; y: number } {
  const angle = belt.from + (belt.to - belt.from) * t;
  const rho = belt.r0 + (belt.r1 - belt.r0) * t + dr;
  const p = ellipse(angle, rho, shape.ellipseY);
  return { x: shape.star.x + p.x, y: shape.star.y + p.y };
}

/** How far outside the belt its caption rides, so it is not among the motes. */
const BELT_CAP_OFFSET = 26;

/**
 * Lays out one system as a cartographic plate.
 *
 * 1. size every folder body from its descendants (log-scaled, 90-170 px,
 *    shrunk by sqrt(12/n) past twelve worlds);
 * 2. seed each on a tilted ellipse at a golden-angle position, radius from
 *    `orbitFor(age)` mapped into the room the stage actually has;
 * 3. relax 60 passes against each other, the inner court and the belt, in an
 *    unbounded plane - the stage is not a wall the solver can be trapped
 *    against, which is what would let a bounds clamp undo a court push;
 * 4. scale the finished plate uniformly to fit *the spread extent*, which
 *    cannot introduce an overlap it did not already have;
 * 5. fill the court and the belt, solve label sides with `placeLabels`, and
 *    measure what was drawn so the camera has something to fit and clamp to.
 *
 * Everything from step 2 on is composed on a stage `spread` times the real
 * one. The host is a window onto the result, not a box the result is squeezed
 * into; `map/useViewport` is what moves the window.
 */
export function layoutCartography(input: LayoutInput): CartographyLayout {
  const descendants = input.descendants ?? {};
  const w = Math.max(1, input.width);
  const h = Math.max(1, input.height);
  const spread = Math.max(1, input.spread ?? SPREAD_DEFAULT);
  /** The virtual stage the composition is solved on. */
  const pw = w * spread;
  const ph = h * spread;
  /**
   * The spread's linear share. Clearances and the court open by this rather
   * than by the full spread: distances between *bodies* should grow with the
   * plate, but the air between them is the same air, only more of it.
   */
  const air = Math.sqrt(spread);
  const gap = GAP * air;

  const sorted = [...input.bodies].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const folders = sorted.filter((b) => b.kind === 'directory');
  const notebooks = sorted.filter((b) => b.kind === 'notebook');
  const files = sorted.filter((b) => b.kind === 'file');

  const shape = shapeOf(pw, ph, notebooks.length, air);
  const { star, ellipseY } = shape;

  // ---- 1. sizes ------------------------------------------------------------
  const shrink = folders.length > SHRINK_ABOVE ? Math.sqrt(SHRINK_ABOVE / folders.length) : 1;
  const seeds: Seed[] = folders.map((body) => {
    const count = descendants[body.path] ?? body.childCount ?? 0;
    const d = (WORLD_MIN_D + sizeT(count) * (WORLD_MAX_D - WORLD_MIN_D)) * shrink;
    const r = d / 2;
    const ringed = characterIndex(displayName(body)) === RINGED_CHARACTER;
    return { body, r, pad: ringed ? r * (RING_REACH - 1) : 0, count, age: ageOf(body), x: 0, y: 0 };
  });
  const maxR = seeds.reduce((m, s) => Math.max(m, s.r + s.pad), 0);

  // ---- 2. seeding ----------------------------------------------------------
  // Worlds walk oldest-first so the index a world gets does not move when a
  // newer sibling appears; the age term then does the composing. `inner`
  // clears the court, `outer` is as far as the stage can actually reach.
  const byAge = [...seeds].sort((a, b) => b.age - a.age || (a.body.path < b.body.path ? -1 : 1));
  const inner = shape.courtR + maxR * 0.62 + gap;
  const reachX = pw - PAD_X - star.x - maxR;
  const reachY = (star.y - PAD_TOP - maxR) / ellipseY;
  // Two claims on the outer radius. The stage would like the plate to end
  // where it ends; the worlds need somewhere to *be*, and a ring too tight to
  // hold them is a ring the relaxation will shuffle until age stops reading
  // as distance. The worlds win, and the fit pass below buys the difference
  // back by scaling the whole plate down.
  const ink = seeds.reduce((sum, s) => sum + Math.PI * (s.r + s.pad + gap / 2) ** 2, 0);
  const sector = (ARC_TO - ARC_FROM) * ellipseY;
  const needed = Math.sqrt(inner * inner + (2 * PACKING * ink) / sector);
  const outer = Math.max(inner + 1, Math.min(reachX, reachY), needed);

  byAge.forEach((seed, i) => {
    const rho = inner + (outer - inner) * seed.age;
    const p = ellipse(seedAngle(i, seed.age), rho, ellipseY);
    seed.x = star.x + p.x;
    seed.y = star.y + p.y;
  });

  // ---- 3. relaxation -------------------------------------------------------
  const belt = beltGeometry(shape, ph, files.length);
  const beltSamples: { x: number; y: number }[] = [];
  for (let i = 0; i <= 28; i += 1) beltSamples.push(beltPoint(shape, belt, i / 28));

  for (let pass = 0; pass < ITERATIONS; pass += 1) {
    let moved = false;

    for (let i = 0; i < seeds.length; i += 1) {
      for (let j = i + 1; j < seeds.length; j += 1) {
        const a = seeds[i];
        const b = seeds[j];
        const want = a.r + a.pad + b.r + b.pad + gap;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= want) continue;
        if (dist < 1e-6) {
          // Coincident: no "apart" direction exists, so invent a stable one.
          const seedAngleRad = (hashString(b.body.path) / 0x1_0000_0000) * TAU;
          dx = Math.cos(seedAngleRad);
          dy = Math.sin(seedAngleRad);
          dist = 1;
        }
        const push = ((want - dist) / dist) * PUSH * 0.5;
        a.x -= dx * push;
        a.y -= dy * push;
        b.x += dx * push;
        b.y += dy * push;
        moved = true;
      }
    }

    for (const seed of seeds) {
      // ...off the inner court, radially.
      const dx = seed.x - star.x;
      const dy = seed.y - star.y;
      const dist = Math.hypot(dx, dy) || 1;
      const want = shape.courtR + seed.r + seed.pad + gap * 0.5;
      if (dist < want) {
        seed.x = star.x + (dx / dist) * want;
        seed.y = star.y + (dy / dist) * want;
        moved = true;
      }

      // ...off the belt, which is ornament and has to stay readable.
      for (const sample of beltSamples) {
        const bx = seed.x - sample.x;
        const by = seed.y - sample.y;
        const bd = Math.hypot(bx, by) || 1;
        const bwant = seed.r + seed.pad + MOTE_MAX_R + gap * 0.5;
        if (bd >= bwant) continue;
        seed.x += (bx / bd) * (bwant - bd) * PUSH;
        seed.y += (by / bd) * (bwant - bd) * PUSH;
        moved = true;
      }
    }

    if (!moved) break;
  }

  // ---- 4. fit --------------------------------------------------------------
  // A uniform scale about a point moves every centre and every radius by the
  // same factor, so a plate that did not overlap before does not overlap now.
  //
  // What it fits *into* is the spread extent, not the host. On any ordinary
  // system that leaves `scale` at 1 and every world at its full 90-170 px;
  // only a plate that outgrows even the spread comes down, and the camera is
  // what carries the rest.
  //
  // Type is the catch: a 16 px name is 16 px whatever the plate does, so the
  // room a label needs *in plate units* depends on the very scale the fit is
  // solving for. So the fit solves itself: guess, measure, shrink, repeat.
  // Each pass can only shrink (a smaller plate needs proportionally more room
  // for the same text), so it converges downward - in three passes, in
  // practice, and `FIT_PASSES` is six.
  const availW = Math.max(1, pw - PAD_X * 2);
  const availH = Math.max(1, ph - PAD_TOP - PAD_BOTTOM);

  const measure = (labelUnits: number) => {
    let x0 = star.x - STAR_R;
    let y0 = star.y - STAR_R;
    let x1 = star.x + STAR_R;
    let y1 = star.y + STAR_R + 26 * labelUnits;
    const grow = (px: number, py: number, pad: number): void => {
      x0 = Math.min(x0, px - pad);
      y0 = Math.min(y0, py - pad);
      x1 = Math.max(x1, px + pad);
      y1 = Math.max(y1, py + pad);
    };
    grow(star.x, star.y, shape.orreryR + 12);
    // The belt's own reserve has to carry the caption riding outside it.
    for (const sample of beltSamples) grow(sample.x, sample.y, BELT_CAP_OFFSET + 16);
    for (const seed of seeds) {
      const text = labelExtent(displayName(seed.body), captionReserve(seed.count)) * labelUnits;
      grow(seed.x, seed.y, seed.r + seed.pad);
      // The label goes outward; reserve both sides rather than guess which one
      // `placeLabels` will choose.
      x0 = Math.min(x0, seed.x - seed.r - text);
      x1 = Math.max(x1, seed.x + seed.r + text);
      y0 = Math.min(y0, seed.y - seed.r - LABEL_H * labelUnits);
      y1 = Math.max(y1, seed.y + seed.r + LABEL_H * labelUnits);
    }
    return { x0, y0, x1, y1 };
  };

  let scale = 1;
  let box = measure(1);
  for (let pass = 0; pass < FIT_PASSES; pass += 1) {
    const next = Math.min(
      1,
      availW / Math.max(1, box.x1 - box.x0),
      availH / Math.max(1, box.y1 - box.y0),
    );
    const settled = Math.abs(next - scale) < 0.002;
    scale = Math.min(scale, next);
    if (settled) break;
    // Text shrinks with the plate, but only down to `TEXT_MIN`; below that it
    // stops and starts demanding proportionally more of the plate instead.
    box = measure(Math.max(scale, TEXT_MIN) / scale);
  }
  const textScale = Math.max(scale, TEXT_MIN);

  // Centre what is left of the plate in the room the stage has.
  const offX = PAD_X + (availW - (box.x1 - box.x0) * scale) / 2 - box.x0 * scale;
  const offY = PAD_TOP + (availH - (box.y1 - box.y0) * scale) / 2 - box.y0 * scale;
  const fx = (n: number): number => n * scale + offX;
  const fy = (n: number): number => n * scale + offY;

  const starOut = {
    x: round(fx(star.x)),
    y: round(fy(star.y)),
    r: round(STAR_R * scale),
    courtR: round(shape.courtR * scale),
    orreryR: round(shape.orreryR * scale),
  };
  const focus = { x: round(pw * 0.46), y: round(ph * 0.48) };

  const worlds: WorldNode[] = seeds.map((seed) => {
    const x = round(fx(seed.x));
    const y = round(fy(seed.y));
    return {
      path: seed.body.path,
      label: displayName(seed.body),
      x,
      y,
      r: round(seed.r * scale),
      band: seed.body.band,
      age: seed.age,
      count: seed.count,
      body: seed.body,
      focus: { dx: round(focus.x - x), dy: round(focus.y - y) },
    };
  });

  // ---- 5. court, belt, connectors, labels ----------------------------------
  const court = layoutCourt(notebooks, shape, starOut, scale, textScale);
  const motes = layoutMotes(files, shape, belt, fx, fy, scale);
  const connectors = layoutConnectors(worlds, court, starOut, input.flightPath ?? []);
  const guides = layoutGuides(starOut, worlds);
  const labels = layoutLabels(
    worlds,
    court,
    starOut,
    pw,
    textScale,
    input.previousLabels ?? new Map(),
  );
  const bounds = plateBounds(
    starOut,
    worlds,
    court,
    motes,
    beltSamples.map((sample) => ({ x: fx(sample.x), y: fy(sample.y) })),
    textScale,
    labels,
  );

  return {
    width: w,
    height: h,
    star: starOut,
    worlds,
    court,
    motes,
    belt: {
      d: beltPath(shape, belt, fx, fy, false),
      capD: beltPath(shape, belt, fx, fy, true, BELT_CAP_OFFSET),
      span: belt.to - belt.from,
    },
    connectors,
    guides,
    labels,
    bounds,
    scale,
    textScale,
    focus,
  };
}

/**
 * Everything the plate draws, as one box.
 *
 * The camera fits to this and clamps a drag against it, so it has to be
 * generous rather than tight: a body's disc *and* the label box that radiates
 * from it, the star with its orrery ring and its name beneath, the belt with
 * the caption riding outside it.
 *
 * It reads the *solved* label sides rather than reserving both, which is the
 * one place this differs from the fit pass's `measure`. `measure` runs before
 * `placeLabels` and has to guess; by here the sides are known, and reserving
 * the side a label did not take would zoom `fit` out by a couple of hundred
 * pixels of nothing. The caption *width* is still the widest the caption
 * could grow, so the box does not twitch as "changed 3h ago" becomes
 * "changed 14h ago".
 *
 * A moon fan is deliberately absent: it only exists while a world is focused,
 * and a focused world has travelled to the plate's centre by then.
 */
function plateBounds(
  star: { x: number; y: number; r: number; orreryR: number },
  worlds: WorldNode[],
  court: CourtNode[],
  motes: MoteNode[],
  belt: { x: number; y: number }[],
  textScale: number,
  labels: Map<string, Placement>,
): Box {
  let x0 = star.x - star.orreryR - 12;
  let y0 = star.y - star.orreryR - 12;
  let x1 = star.x + star.orreryR + 12;
  let y1 = star.y + star.r + 48 * textScale;

  const grow = (x: number, y: number, px: number, py: number): void => {
    x0 = Math.min(x0, x - px);
    y0 = Math.min(y0, y - py);
    x1 = Math.max(x1, x + px);
    y1 = Math.max(y1, y + py);
  };
  /** The disc, plus its caption on whichever side the label solver chose. */
  const growLabelled = (
    x: number,
    y: number,
    r: number,
    text: number,
    height: number,
    right: boolean,
  ): void => {
    grow(x, y, r, r + height);
    if (right) x1 = Math.max(x1, x + r + text);
    else x0 = Math.min(x0, x - r - text);
  };

  for (const sample of belt) grow(sample.x, sample.y, BELT_CAP_OFFSET + 16, BELT_CAP_OFFSET + 16);
  for (const mote of motes) grow(mote.x, mote.y, mote.r + 6, mote.r + 12);
  for (const node of court) {
    growLabelled(
      node.x,
      node.y,
      node.r,
      (LABEL_GAP + node.label.length * CAP_PX) * textScale,
      10 * textScale,
      (labels.get(node.path)?.side ?? (node.x >= star.x ? 'right' : 'left')) === 'right',
    );
  }
  for (const world of worlds) {
    growLabelled(
      world.x,
      world.y,
      world.r,
      labelExtent(world.label, captionReserve(world.count)) * textScale,
      LABEL_H * textScale,
      (labels.get(world.path)?.side ?? 'right') === 'right',
    );
  }

  return { x: round(x0), y: round(y0), w: round(x1 - x0), h: round(y1 - y0) };
}

/**
 * Root notebooks: the star's inner court. They walk the annulus between the
 * sigil and the court edge, newest nearest, on the golden angle so no two land
 * on top of each other, through the arc that leaves the star's name room.
 *
 * Only the first `COURT_LABEL_BUDGET` of them (newest first) claim a caption:
 * eight names around a 120 px court is a word pile, not a chart. The rest keep
 * their caption in the DOM at zero opacity, for hover and selection.
 */
function layoutCourt(
  notebooks: Body[],
  shape: Shape,
  star: { x: number; y: number; r: number; courtR: number },
  scale: number,
  textScale: number,
): CourtNode[] {
  // The star's long rays reach past `star.r`; the court starts outside them.
  const inner = star.r * 1.32 + 12 * scale;
  const outer = Math.max(inner + 6, star.courtR - 12 * scale);
  const byAge = [...notebooks].sort((a, b) => a.orbit - b.orbit || (a.path < b.path ? -1 : 1));
  const labelled = new Set(byAge.slice(0, COURT_LABEL_BUDGET).map((body) => body.path));

  return notebooks.map((body, i) => {
    const age = ageOf(body);
    const rho = inner + (outer - inner) * (0.14 + age * 0.86);
    const walk = (i * GOLDEN) % 1;
    const angle = COURT_FROM + walk * COURT_SPAN;
    const x = star.x + Math.cos(angle) * rho;
    const y = star.y + Math.sin(angle) * rho * shape.ellipseY;
    const r = (NB_MIN_R + (1 - age) * (NB_MAX_R - NB_MIN_R)) * Math.max(scale, 0.62) * textScale;
    return {
      path: body.path,
      label: displayName(body),
      x: round(x),
      y: round(y),
      r: round(r),
      up: y < star.y,
      labelled: labelled.has(body.path),
      body,
    };
  });
}

/** Loose files, strung along the belt newest-first, jittered off the line. */
function layoutMotes(
  files: Body[],
  shape: Shape,
  belt: Belt,
  fx: (n: number) => number,
  fy: (n: number) => number,
  scale: number,
): MoteNode[] {
  const byAge = [...files].sort((a, b) => a.orbit - b.orbit || (a.path < b.path ? -1 : 1));
  const last = Math.max(1, byAge.length - 1);
  return byAge.map((body, i) => {
    const t = byAge.length === 1 ? 0.5 : 0.04 + (i / last) * 0.92;
    const p = beltPoint(shape, belt, t);
    const rng = seededRng(hashString(body.path));
    const off = (rng() - 0.5) * 15;
    const bytes = body.bytes ?? 0;
    const r = MOTE_MIN_R + clamp01(Math.log10(bytes + 1) / 7) * (MOTE_MAX_R - MOTE_MIN_R);
    return {
      path: body.path,
      label: displayName(body),
      x: round(fx(p.x)),
      y: round(fy(p.y + off)),
      r: round(r * Math.max(scale, 0.62)),
      body,
    };
  });
}

function beltPath(
  shape: Shape,
  belt: Belt,
  fx: (n: number) => number,
  fy: (n: number) => number,
  reversed: boolean,
  dr = 0,
): string {
  const steps = 24;
  const parts: string[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const p = beltPoint(shape, belt, reversed ? 1 - i / steps : i / steps, dr);
    parts.push(`${i === 0 ? 'M' : 'L'}${round(fx(p.x))} ${round(fy(p.y))}`);
  }
  return parts.join('');
}


/** Two recency arcs and one ornamental meridian, sized off the real plate. */
function layoutGuides(
  star: { x: number; y: number; orreryR: number },
  worlds: WorldNode[],
): Guide[] {
  const far = worlds.reduce(
    (m, world) => Math.max(m, Math.hypot(world.x - star.x, world.y - star.y)),
    0,
  );
  const reach = Math.max(star.orreryR + 40, far);
  const arcs = [
    { id: 'today', r: star.orreryR + (reach - star.orreryR) * 0.3, from: -66, to: 24, label: 'today', meridian: false },
    { id: 'week', r: star.orreryR + (reach - star.orreryR) * 0.68, from: -54, to: 14, label: 'this week', meridian: false },
    { id: 'meridian', r: star.orreryR + 58, from: 206, to: 286, label: null, meridian: true },
  ];
  return arcs.map((arc) => {
    const a0 = arc.from * DEG;
    const a1 = arc.to * DEG;
    const r = round(arc.r);
    const p0x = round(star.x + Math.cos(a0) * arc.r);
    const p0y = round(star.y + Math.sin(a0) * arc.r);
    const p1x = round(star.x + Math.cos(a1) * arc.r);
    const p1y = round(star.y + Math.sin(a1) * arc.r);
    // Only the meridian carries a scale; a plain band arc is a hairline.
    const steps = arc.meridian ? 8 : 0;
    const tickMarks: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const arrows: Bead[] = [];
    for (let t = 0; steps > 0 && t <= steps; t += 1) {
      const a = a0 + (a1 - a0) * (t / steps);
      const inward = t % 2 ? 9 : 16;
      tickMarks.push({
        x1: round(star.x + Math.cos(a) * arc.r),
        y1: round(star.y + Math.sin(a) * arc.r),
        x2: round(star.x + Math.cos(a) * (arc.r - inward)),
        y2: round(star.y + Math.sin(a) * (arc.r - inward)),
      });
      if (t === 2 || t === 6) {
        arrows.push({
          x: round(star.x + Math.cos(a) * (arc.r - 27)),
          y: round(star.y + Math.sin(a) * (arc.r - 27)),
          angle: round((a * 180) / Math.PI + 90),
        });
      }
    }
    return {
      id: arc.id,
      r,
      d: `M${p0x} ${p0y}A${r} ${r} 0 0 1 ${p1x} ${p1y}`,
      label: arc.label,
      meridian: arc.meridian,
      ticks: tickMarks,
      arrows,
    };
  });
}

/** Band order, newest first, for ranking which threads survive the cap. */
const BAND_ORDER: Band[] = ['today', 'week', 'month', 'halfyear', 'older'];

/**
 * Connectors. Band threads join the bodies whose last change lands in the
 * same recency band, *chained* around the star, so a band of six is five
 * threads and not fifteen; wake threads follow the user's own course, one per
 * consecutive pair of `flightPath` entries that resolve to different bodies
 * on this plate.
 *
 * Two readings of the contract are widened here, both because the narrow one
 * draws nothing on a real system. A band chains court notebooks as well as
 * worlds (in the fixture's root every world lands in its own band, so a
 * worlds-only rule is an empty plate); and "different parent folders" is
 * judged on the plate rather than the filesystem, so two loose notebooks at
 * the root — two separate bodies — still earn a thread between them.
 */
function layoutConnectors(
  worlds: WorldNode[],
  court: CourtNode[],
  star: { x: number; y: number },
  flightPath: string[],
): Connector[] {
  const anchors = new Map<string, { x: number; y: number; r: number }>();
  for (const world of worlds) anchors.set(world.path, { x: world.x, y: world.y, r: world.r + 9 });
  for (const node of court) anchors.set(node.path, { x: node.x, y: node.y, r: node.r + 7 });

  const pairs: { from: string; to: string; kind: ConnectorKind }[] = [];
  /** Unordered pair keys already strung, so no two threads share a path. */
  const strung = new Set<string>();
  const key = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

  // The wake goes on first: it is the user's own course, and it outranks an
  // ornamental band thread that would run down the same two bodies.
  /** A flight-path entry draws from whichever body on this plate holds it. */
  const anchorFor = (path: string): string | null => {
    if (anchors.has(path)) return path;
    const slash = path.lastIndexOf('/');
    const parent = slash === -1 ? '' : path.slice(0, slash);
    return parent !== '' && anchors.has(parent) ? parent : null;
  };

  let wakes = 0;
  for (let i = 0; i + 1 < flightPath.length && wakes < WAKE_CAP; i += 1) {
    const a = anchorFor(flightPath[i]);
    const b = anchorFor(flightPath[i + 1]);
    if (!a || !b || a === b || strung.has(key(a, b))) continue;
    strung.add(key(a, b));
    pairs.push({ from: a, to: b, kind: 'wake' });
    wakes += 1;
  }

  interface Member {
    path: string;
    angle: number;
    world: boolean;
  }
  const byBand = new Map<Band, Member[]>();
  const add = (path: string, x: number, y: number, band: Band, world: boolean): void => {
    const list = byBand.get(band) ?? [];
    list.push({ path, angle: Math.atan2(y - star.y, x - star.x), world });
    byBand.set(band, list);
  };
  for (const world of worlds) add(world.path, world.x, world.y, world.band, true);
  for (const node of court) add(node.path, node.x, node.y, node.body.band, false);

  const candidates: { from: string; to: string; rank: number; worlds: number }[] = [];
  for (const [band, list] of byBand) {
    if (list.length < 2) continue;
    // Chain around the star rather than across it: a thread that follows the
    // band reads as a band, one that cuts the plate in half reads as a scar.
    const chain = [...list].sort((a, b) => a.angle - b.angle || (a.path < b.path ? -1 : 1));
    const bandRank = Math.max(0, BAND_ORDER.indexOf(band));
    for (let i = 0; i + 1 < chain.length; i += 1) {
      candidates.push({
        from: chain[i].path,
        to: chain[i + 1].path,
        rank: bandRank,
        worlds: (chain[i].world ? 1 : 0) + (chain[i + 1].world ? 1 : 0),
      });
    }
  }
  // A plate can only carry so much string. Worlds first, then the recent
  // bands, then alphabetical so the survivors never depend on Map order.
  candidates.sort(
    (a, b) =>
      b.worlds - a.worlds ||
      a.rank - b.rank ||
      (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : 1),
  );
  const bandBudget = Math.max(2, BAND_THREAD_CAP - wakes);
  let bands = 0;
  for (const candidate of candidates) {
    if (bands >= bandBudget) break;
    if (strung.has(key(candidate.from, candidate.to))) continue;
    strung.add(key(candidate.from, candidate.to));
    pairs.push({ from: candidate.from, to: candidate.to, kind: 'band' });
    bands += 1;
  }

  const out: Connector[] = [];
  for (const pair of pairs) {
    const id = `${pair.kind}:${pair.from}>${pair.to}`;
    const a = anchors.get(pair.from);
    const b = anchors.get(pair.to);
    if (!a || !b) continue;

    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // Which way a thread bows is a property of the pair, not of the frame.
    const side = hashString(id) % 2 === 0 ? 1 : -1;
    const bow = Math.min(78, len * 0.22) * side;
    const c: [number, number] = [mx + (-dy / len) * bow, my + (dx / len) * bow];

    // Start and end on the rims, aimed at the control point.
    const a1 = Math.atan2(c[1] - a.y, c[0] - a.x);
    const a2 = Math.atan2(c[1] - b.y, c[0] - b.x);
    const p0: [number, number] = [a.x + Math.cos(a1) * a.r, a.y + Math.sin(a1) * a.r];
    const p1: [number, number] = [b.x + Math.cos(a2) * b.r, b.y + Math.sin(a2) * b.r];

    const beadAt = (t: number): Bead => {
      const p = quadAt(p0, c, p1, t);
      return { x: round(p.x), y: round(p.y), angle: round(quadAngle(p0, c, p1, t)) };
    };

    out.push({
      id,
      kind: pair.kind,
      from: pair.from,
      to: pair.to,
      d: `M${round(p0[0])} ${round(p0[1])}Q${round(c[0])} ${round(c[1])} ${round(p1[0])} ${round(p1[1])}`,
      p0,
      c,
      p1,
      beads: [beadAt(0.18), beadAt(0.82)],
      tick: beadAt(0.5),
    });
  }
  return out;
}

/**
 * Label sides, via `model.placeLabels` so cartography and the chart agree
 * about what a de-collided label looks like. Worlds are solved newest first,
 * because the busy middle of the plate should win the ties.
 */
function layoutLabels(
  worlds: WorldNode[],
  court: CourtNode[],
  star: { x: number; y: number; r: number },
  width: number,
  textScale: number,
  previous: Map<string, Placement>,
): Map<string, Placement> {
  const obstacles: LabelObstacle[] = [
    { x: star.x, y: star.y, r: star.r * 1.3 },
    ...worlds.map((world) => ({ x: world.x, y: world.y, r: world.r })),
    ...court.map((node) => ({ x: node.x, y: node.y, r: node.r })),
  ];

  /**
   * `placeLabels` measures the box from the body's centre, so the extent has
   * to carry the disc as well as the text; "outward" is away from the stage's
   * midline, unless that would run the label off the edge.
   */
  const item = (id: string, x: number, y: number, r: number, w: number, h: number): LabelItem => {
    const extent = r + w;
    const right = x >= width / 2;
    const fits = right ? x + extent < width - 8 : x - extent > 8;
    let outward: LabelSide;
    if (right) outward = fits ? 'right' : 'left';
    else outward = fits ? 'left' : 'right';
    return { id, x, y, w: extent, h, outward };
  };

  // Worlds first, newest first: they are the big claims on the plate and the
  // busy middle should win the ties. Then the court captions that survived
  // the budget, which is what keeps eight notebook names from stacking into
  // one illegible block under the star.
  const items: LabelItem[] = [
    ...[...worlds]
      .sort((a, b) => a.age - b.age || (a.path < b.path ? -1 : 1))
      .map((world) =>
        item(
          world.path,
          world.x,
          world.y,
          world.r,
          labelExtent(world.label, captionReserve(world.count)) * textScale,
          LABEL_H * textScale,
        ),
      ),
    ...court
      .filter((node) => node.labelled)
      .map((node) =>
        item(
          node.path,
          node.x,
          node.y,
          node.r,
          (LABEL_GAP + node.label.length * CAP_PX) * textScale,
          16 * textScale,
        ),
      ),
  ];
  return placeLabels(items, obstacles, previous);
}

/**
 * A focused world's children, fanned out as labelled moons on a dashed orbit.
 * Capped at ten; the rest become a `+n more` caption under the ring.
 */
export function moonFan(children: BodyInput[], worldR: number, cap: number = MOON_CAP): MoonFan {
  const shown = children.slice(0, cap);
  const orbitR = worldR + MOON_GAP;
  const span = Math.max(shown.length, 5);
  const moons: Moon[] = shown.map((child, i) => {
    const angle = (-104 + (330 / span) * i) * DEG;
    const r = child.kind === 'directory' ? 6.5 : child.kind === 'notebook' ? 5.2 : 3.6;
    const right = Math.cos(angle) >= -0.05;
    return {
      path: child.path,
      label: displayName(child),
      kind: child.kind,
      x: round(Math.cos(angle) * orbitR),
      y: round(Math.sin(angle) * orbitR),
      r,
      lx: round(Math.cos(angle) * (orbitR + 12)),
      ly: round(Math.sin(angle) * (orbitR + 12)),
      anchor: right ? 'start' : 'end',
    };
  });
  return { orbitR: round(orbitR), moons, extra: Math.max(0, children.length - shown.length) };
}

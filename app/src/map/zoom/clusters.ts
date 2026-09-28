/**
 * Galaxy-level geometry for the zoom renderer: the seeded star clusters a
 * folder is drawn as, the loose field of root files, the cosmic web between
 * folders that changed in the same band, and the angular relaxation that keeps
 * two clusters from sitting on top of each other.
 *
 * Pure and deterministic — every random number comes from `seededRng` over
 * `hashString(seed)`, so a folder is the same galaxy on every load, in every
 * mode, and the whole module is testable in node.
 *
 * Nothing here decides colour or opacity. Stars carry a brightness *tier*,
 * which `zoom.css` turns into an opacity per mode; clusters carry no paint at
 * all, only geometry.
 */
import { hashString, seededRng } from '../model';
import type { Band } from '../model';

const TAU = Math.PI * 2;

/** The spec's ceiling: no cluster ever draws more points than this. */
export const CLUSTER_POINT_CAP = 160;
/** ...and none draws fewer, or an empty folder would be invisible. */
export const CLUSTER_POINT_FLOOR = 34;

export type ClusterShape = 'spiral' | 'elliptical';

export interface ClusterStar {
  x: number;
  y: number;
  r: number;
  /** 0 brightest … 2 faintest. `zoom.css` owns what each one means. */
  tier: 0 | 1 | 2;
}

export interface Cluster {
  shape: ClusterShape;
  /** Outer radius, in the same user units the caller passed in. */
  radius: number;
  /** Degrees; the disc's own tilt on the sky. */
  tilt: number;
  /** Minor/major axis of the disc, applied by the caller as `scale(1, squash)`. */
  squash: number;
  /** 2 or 3 for a spiral, 0 for an elliptical. */
  arms: number;
  /** In the disc's own frame, before `tilt` and `squash`. */
  stars: ClusterStar[];
  coreRx: number;
  coreRy: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/**
 * Point count from the number of descendants: a folder with more below it is
 * a denser galaxy, up to the cap. Monotonic, so two folders never read as the
 * wrong way round.
 */
export function clusterPointCount(descendants: number): number {
  const known = Number.isFinite(descendants) && descendants > 0 ? descendants : 0;
  return Math.round(clamp(CLUSTER_POINT_FLOOR + known * 1.6, CLUSTER_POINT_FLOOR, CLUSTER_POINT_CAP));
}

/**
 * Disc radius from the same count, square-rooted so a 200-file folder is
 * bigger than a 20-file one without being ten times bigger. `max` is what the
 * stage can afford.
 */
export function clusterRadius(descendants: number, max: number): number {
  const known = Number.isFinite(descendants) && descendants > 0 ? descendants : 0;
  return clamp(max * (0.38 + Math.sqrt(known) * 0.075), max * 0.38, max);
}

function tierOf(brightness: number): 0 | 1 | 2 {
  return brightness > 0.72 ? 0 : brightness > 0.5 ? 1 : 2;
}

/**
 * A folder's galaxy. Spirals get two or three arms swept through ~1.2 turns;
 * ellipticals are a centre-weighted haze. Which one a folder gets is its hash,
 * so it never changes under it.
 */
export function clusterFor(seed: string, descendants: number, radius: number): Cluster {
  const rng = seededRng(hashString(seed));
  const count = clusterPointCount(descendants);
  const shape: ClusterShape = rng() < 0.62 ? 'spiral' : 'elliptical';
  const tilt = (rng() - 0.5) * 70;
  const squash = shape === 'spiral' ? 0.44 + rng() * 0.3 : 0.62 + rng() * 0.3;
  const arms = shape === 'spiral' ? (rng() < 0.5 ? 2 : 3) : 0;
  const stars: ClusterStar[] = [];

  for (let i = 0; i < count; i += 1) {
    // `t` is the normalised distance out from the core; the exponents pull
    // points inward so the core reads as a core and not as a flat disc.
    const t =
      shape === 'spiral'
        ? ((i + 0.6) / count) ** 0.55
        : Math.min(1, ((i + 0.6) / count) ** 0.62 * (0.82 + rng() * 0.36));
    const angle =
      shape === 'spiral'
        ? (i % arms) * (TAU / arms) + t * 2.35 * Math.PI + (rng() - 0.5) * (0.5 + (1 - t))
        : rng() * TAU;
    const spread = shape === 'spiral' ? 0.2 : 0.12;
    const rr = clamp(radius * (0.08 + 0.92 * t) * (1 + (rng() - 0.5) * spread), 0, radius);
    const brightness = clamp((0.62 + rng() * 0.38) * (1 - t * 0.22), 0.3, 1);
    stars.push({
      x: Math.cos(angle) * rr,
      y: Math.sin(angle) * rr,
      r: clamp((0.5 + rng() * 1.2) * (1 - t * 0.3), 0.35, 1.8),
      tier: tierOf(brightness),
    });
  }

  return {
    shape,
    radius,
    tilt,
    squash,
    arms,
    stars,
    coreRx: radius * (shape === 'spiral' ? 0.19 : 0.26),
    coreRy: radius * (shape === 'spiral' ? 0.13 : 0.2),
  };
}

export interface FieldPoint {
  x: number;
  y: number;
}

/**
 * The root's loose notebooks and files, scattered in an ellipse at the middle
 * of the galaxy view. `sqrt` on the radius keeps the density even instead of
 * piling everything into the centre.
 */
export function looseField(seed: string, count: number, rx: number, ry: number): FieldPoint[] {
  const rng = seededRng(hashString(seed));
  const out: FieldPoint[] = [];
  for (let i = 0; i < Math.max(0, Math.floor(count)); i += 1) {
    const angle = rng() * TAU;
    const t = Math.sqrt(rng());
    out.push({ x: Math.cos(angle) * rx * t, y: Math.sin(angle) * ry * t });
  }
  return out;
}

export interface WebNode {
  id: string;
  x: number;
  y: number;
  band: Band;
}

export interface WebLink {
  from: string;
  to: string;
  x1: number;
  y1: number;
  /** Quadratic control point, bowed off the chord so the web is not a polygon. */
  cx: number;
  cy: number;
  x2: number;
  y2: number;
}

/**
 * Hairlines between folders that changed in the same band: the same week's
 * work is one filament. Nodes of a band are walked in angular order about the
 * centroid and joined consecutively, closed into a loop once there are three,
 * so the web never crosses itself.
 */
export function cosmicWeb(nodes: WebNode[], bow = 26): WebLink[] {
  const byBand = new Map<Band, WebNode[]>();
  for (const node of nodes) {
    const list = byBand.get(node.band);
    if (list) list.push(node);
    else byBand.set(node.band, [node]);
  }

  const links: WebLink[] = [];
  // Sorted band keys, so the output order does not depend on input order.
  const bands = [...byBand.keys()].sort();
  for (const band of bands) {
    const list = byBand.get(band)!;
    if (list.length < 2) continue;
    const cx = list.reduce((sum, n) => sum + n.x, 0) / list.length;
    const cy = list.reduce((sum, n) => sum + n.y, 0) / list.length;
    const ring = [...list].sort((p, q) => {
      const d = Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx);
      return d !== 0 ? d : p.id < q.id ? -1 : 1;
    });
    const edges = ring.length === 2 ? 1 : ring.length;
    for (let i = 0; i < edges; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const nx = -(b.y - a.y);
      const ny = b.x - a.x;
      const len = Math.hypot(nx, ny) || 1;
      links.push({
        from: a.id,
        to: b.id,
        x1: a.x,
        y1: a.y,
        cx: mx + (nx / len) * bow,
        cy: my + (ny / len) * bow,
        x2: b.x,
        y2: b.y,
      });
    }
  }
  return links;
}

export interface Placed {
  id: string;
  /** Disc radius. */
  radius: number;
  /** Distance from the centre of the view. */
  r: number;
  /** Radians. */
  angle: number;
}

export interface PlacedAt extends Placed {
  x: number;
  y: number;
}

const SPREAD_GAP = 14;
const SPREAD_STEP = 0.035;
const SPREAD_PASSES = 60;

/**
 * How much wider than the room it was given the galaxy is laid out. The map is
 * something you drag around now, so depth 1 deliberately overflows the stage:
 * the clusters keep their own size and only move further apart, which is what
 * makes panning worth doing and stops a busy workspace reading as one clot in
 * the middle. `ZoomMap` passes a smaller figure at the deeper levels and 1 at
 * the plain chart, whose layout is already fit.
 */
export const DEFAULT_SPREAD = 1.5;

/**
 * Pushes overlapping clusters apart *in angle only*, so the radial axis keeps
 * meaning what it means everywhere else on the map: distance from the centre
 * is age. Symmetric, deterministic (input is sorted by id first), and it gives
 * up after 60 passes rather than looping on an infeasible set.
 *
 * `spread` scales every distance-from-centre before the relaxation runs, and
 * nothing else: a disc's own `radius` is untouched, so the layout grows while
 * the galaxies in it stay exactly as big as they were. Where the relaxation
 * has nothing left to do the whole layout is simply `spread` times as wide;
 * where it does, it still only ever separates, so no pair is closer than
 * `a.radius + b.radius + gap` at any spread.
 */
export function spreadGalaxies(
  items: Placed[],
  gap = SPREAD_GAP,
  spread = DEFAULT_SPREAD,
): PlacedAt[] {
  const work = [...items]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((item) => ({ ...item, r: Math.max(item.r, 1) * spread }));

  for (let pass = 0; pass < SPREAD_PASSES; pass += 1) {
    let moved = false;
    for (let i = 0; i < work.length; i += 1) {
      for (let j = i + 1; j < work.length; j += 1) {
        const a = work[i];
        const b = work[j];
        const dx = Math.cos(b.angle) * b.r - Math.cos(a.angle) * a.r;
        const dy = Math.sin(b.angle) * b.r - Math.sin(a.angle) * a.r;
        const need = a.radius + b.radius + gap;
        if (Math.hypot(dx, dy) >= need) continue;
        // Identical angles have no "apart" direction; pick one deterministically.
        let delta = b.angle - a.angle;
        delta = ((delta % TAU) + TAU + Math.PI) % TAU - Math.PI;
        const dir = delta === 0 ? 1 : Math.sign(delta);
        a.angle -= dir * SPREAD_STEP;
        b.angle += dir * SPREAD_STEP;
        moved = true;
      }
    }
    if (!moved) break;
  }

  return work.map((item) => ({
    ...item,
    x: Math.cos(item.angle) * item.r,
    y: Math.sin(item.angle) * item.r,
  }));
}

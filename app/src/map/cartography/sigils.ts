/**
 * What a world is *made of*, in both cartography modes.
 *
 * Bridge paints five characters (banded, storm-crowned, ice-capped, ringed,
 * cratered) lit from within, straight out of the Relic mockup. Paper draws
 * something the owner asked for instead: "more abstract ... like old navigator
 * starcharts/alien stuff ... no realistic sprites". So a Paper world is a
 * **sigil** — a circular cartouche of rings, tick scales, spokes, star
 * polygons, rune bands and hatched sectors, in one of five families:
 * astrolabe, rosette, lattice, volvelle, constellation-disc. No sphere, no
 * shading, no terminator. It should look like a plate from an atlas drawn by
 * someone who has never seen a planet.
 *
 * Every generator returns *marks*: geometry plus the CSS class that paints it.
 * Nothing here knows a colour. The one attribute that is not pure geometry is
 * `fill`, which names a `<pattern>` the component defines — the same exception
 * `MapCanvas` already takes for its gradients, and the only way SVG has of
 * saying "hatched".
 *
 * Pure, deterministic, `seededRng(hashString(name))`: a folder keeps its face
 * for as long as it keeps its name.
 */
import { hashString, seededRng } from '../model';

const TAU = Math.PI * 2;

/**
 * How far the ringed character's ring system reaches, as a multiple of the
 * world's radius. `layout.ts` reads it so the solver can keep a ringed world's
 * neighbours outside its rings.
 */
export const RING_REACH = 1.46;

/** The hatch and stipple plates the component puts in `<defs>`. */
export type PatternKey = 'hatch-a' | 'hatch-b' | 'hatch-c' | 'cross' | 'stipple' | 'stipple-dense';

export const PATTERN_KEYS: PatternKey[] = [
  'hatch-a',
  'hatch-b',
  'hatch-c',
  'cross',
  'stipple',
  'stipple-dense',
];

export type Mark =
  | { k: 'circle'; cls: string; fill?: PatternKey; cx: number; cy: number; r: number }
  | {
      k: 'ellipse';
      cls: string;
      fill?: PatternKey;
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      /** degrees, about the ellipse's own centre */
      a?: number;
    }
  | { k: 'path'; cls: string; fill?: PatternKey; d: string }
  | { k: 'line'; cls: string; x1: number; y1: number; x2: number; y2: number };

/** Bridge. The mockup's five, in the mockup's order. */
export const CHARACTERS = ['banded', 'storm-crowned', 'ice-capped', 'ringed', 'cratered'] as const;
export type Character = (typeof CHARACTERS)[number];

/** Paper. Five ways of drawing a circle that is not a planet. */
export const SIGIL_FAMILIES = [
  'astrolabe',
  'rosette',
  'lattice',
  'volvelle',
  'constellation',
] as const;
export type SigilFamily = (typeof SIGIL_FAMILIES)[number];

export interface Painted {
  character: Character;
  /** 0..4, the class suffix (`ct-c0`..`ct-c4`) that carries the palette. */
  index: number;
  /** degrees; the whole paint leans. */
  tilt: number;
  marks: Mark[];
  /** The ringed character wears a ring system drawn outside the clip. */
  ringed: boolean;
  ringRx: number;
  ringRy: number;
}

export interface PaperSigil {
  family: SigilFamily;
  index: number;
  tilt: number;
  marks: Mark[];
}

export interface Rune {
  d: string;
  x: number;
  y: number;
  /** degrees */
  angle: number;
}

export interface StarSigil {
  rings: { r: number; dashed: boolean }[];
  rays: { x1: number; y1: number; x2: number; y2: number; long: boolean }[];
  glyph: string;
  coreR: number;
}

function f(n: number): number {
  return Math.round(n * 100) / 100;
}

function pt(x: number, y: number): string {
  return `${f(x)} ${f(y)}`;
}

/** An annular sector, absolute commands only. */
function sectorPath(r0: number, r1: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const o0 = pt(Math.cos(a0) * r1, Math.sin(a0) * r1);
  const o1 = pt(Math.cos(a1) * r1, Math.sin(a1) * r1);
  const i1 = pt(Math.cos(a1) * r0, Math.sin(a1) * r0);
  const i0 = pt(Math.cos(a0) * r0, Math.sin(a0) * r0);
  return `M${o0}A${f(r1)} ${f(r1)} 0 ${large} 1 ${o1}L${i1}A${f(r0)} ${f(r0)} 0 ${large} 0 ${i0}Z`;
}

/** A four-pointed ink star, the way a chart draws one. */
function starMark(cx: number, cy: number, r: number): string {
  const w = r * 0.26;
  return (
    `M${pt(cx, cy - r)}Q${pt(cx + w, cy - w)} ${pt(cx + r, cy)}` +
    `Q${pt(cx + w, cy + w)} ${pt(cx, cy + r)}` +
    `Q${pt(cx - w, cy + w)} ${pt(cx - r, cy)}` +
    `Q${pt(cx - w, cy - w)} ${pt(cx, cy - r)}Z`
  );
}

function ticks(
  cls: string,
  count: number,
  r0: number,
  r1: number,
  phase: number,
  majorEvery: number,
  majorR1: number,
): Mark[] {
  const out: Mark[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = phase + (i / count) * TAU;
    const major = majorEvery > 0 && i % majorEvery === 0;
    const end = major ? majorR1 : r1;
    out.push({
      k: 'line',
      cls: major ? `${cls} ct-sg-tick-major` : cls,
      x1: f(Math.cos(a) * r0),
      y1: f(Math.sin(a) * r0),
      x2: f(Math.cos(a) * end),
      y2: f(Math.sin(a) * end),
    });
  }
  return out;
}

// ---- which face ------------------------------------------------------------

/**
 * An avalanche finalizer over the FNV hash before the modulo.
 *
 * FNV-1a's low bits are its weakest: the last multiply leaves them depending
 * on only the last character or two, so `hashString(name) % 5` over a handful
 * of short sibling folder names clumps badly - the workspace fixture's four
 * folders came out three-of-a-kind. Mixing the high bits down first (the
 * standard xorshift-multiply finalizer) spreads them: 5000 synthetic names
 * land 959/998/991/1070/982 across the five.
 */
function mix(h: number): number {
  let x = h;
  x ^= x >>> 15;
  x = Math.imul(x, 0x2545f491);
  x ^= x >>> 13;
  return x >>> 0;
}

export function characterIndex(name: string): number {
  return mix(hashString(name)) % CHARACTERS.length;
}

export function characterOf(name: string): Character {
  return CHARACTERS[characterIndex(name)];
}

/**
 * Paper's family is hashed off a salted name, so a folder's sigil is not
 * locked to its Bridge character: switching modes should feel like a
 * different map, not the same map repainted.
 */
export function familyIndex(name: string): number {
  return mix(hashString(`sigil:${name}`)) % SIGIL_FAMILIES.length;
}

export function familyOf(name: string): SigilFamily {
  return SIGIL_FAMILIES[familyIndex(name)];
}

// ---- bridge: painted characters --------------------------------------------

/** Latitude bands, the base coat under every character but the cratered one. */
function bands(R: number, rng: () => number): Mark[] {
  const out: Mark[] = [];
  let y = -R * 0.98;
  let i = 0;
  while (y < R * 0.98 && i < 14) {
    const height = R * (0.05 + rng() * 0.13);
    out.push({
      k: 'ellipse',
      cls: `ct-band ct-b${i % 4}`,
      cx: 0,
      cy: f(y + height),
      rx: f(R * 1.04),
      ry: f(height),
    });
    y += height * 2 + R * 0.015;
    i += 1;
  }
  return out;
}

export function paintedWorld(name: string, R: number): Painted {
  const index = characterIndex(name);
  const rng = seededRng(hashString(name));
  const tilt = f(-22 + rng() * 16);
  const marks: Mark[] = [];

  if (index === 0) {
    marks.push(...bands(R, rng));
  } else if (index === 1) {
    marks.push(...bands(R, rng));
    const sx = -R * 0.28;
    const sy = R * 0.2;
    marks.push({ k: 'ellipse', cls: 'ct-storm', cx: f(sx), cy: f(sy), rx: f(R * 0.4), ry: f(R * 0.24), a: -8 });
    marks.push({ k: 'ellipse', cls: 'ct-storm-eye', cx: f(sx), cy: f(sy), rx: f(R * 0.19), ry: f(R * 0.11), a: -8 });
    marks.push({
      k: 'path',
      cls: 'ct-storm-swirl',
      d: `M${pt(sx - R * 0.34, sy)}A${f(R * 0.34)} ${f(R * 0.2)} 0 1 1 ${pt(sx + R * 0.16, sy + R * 0.1)}`,
    });
  } else if (index === 2) {
    marks.push(...bands(R, rng));
    marks.push({ k: 'ellipse', cls: 'ct-cap-ice', cx: 0, cy: f(-R * 0.92), rx: f(R * 0.82), ry: f(R * 0.34) });
    marks.push({ k: 'ellipse', cls: 'ct-cap-ice', cx: 0, cy: f(R * 0.95), rx: f(R * 0.7), ry: f(R * 0.28) });
    marks.push({ k: 'ellipse', cls: 'ct-maria', cx: f(R * 0.1), cy: 0, rx: f(R * 1.04), ry: f(R * 0.1) });
  } else if (index === 3) {
    marks.push(...bands(R, rng));
    marks.push({
      k: 'ellipse',
      cls: 'ct-maria',
      cx: f(-R * 0.2),
      cy: f(-R * 0.3),
      rx: f(R * 0.42),
      ry: f(R * 0.16),
    });
  } else {
    marks.push({ k: 'ellipse', cls: 'ct-maria', cx: f(-R * 0.22), cy: f(R * 0.3), rx: f(R * 0.62), ry: f(R * 0.44) });
    marks.push({ k: 'ellipse', cls: 'ct-maria', cx: f(R * 0.42), cy: f(-R * 0.34), rx: f(R * 0.36), ry: f(R * 0.26) });
    for (let i = 0; i < 9; i += 1) {
      const angle = rng() * TAU;
      const radius = Math.sqrt(rng()) * R * 0.82;
      const cr = R * (0.07 + rng() * 0.12);
      const cx = Math.cos(angle) * radius;
      const cy = Math.sin(angle) * radius;
      marks.push({ k: 'circle', cls: 'ct-crater-o', cx: f(cx), cy: f(cy), r: f(cr) });
      marks.push({
        k: 'circle',
        cls: 'ct-crater-i',
        cx: f(cx - cr * 0.22),
        cy: f(cy - cr * 0.22),
        r: f(cr * 0.66),
      });
    }
  }

  return {
    character: CHARACTERS[index],
    index,
    tilt,
    marks,
    ringed: index === 3,
    // Narrower than the mockup's 1.78: there the five worlds were placed by
    // hand around their rings, here the solver has to keep a ringed world
    // clear of its neighbours, and every extra radius costs the whole plate.
    ringRx: f(R * RING_REACH),
    ringRy: f(R * 0.4),
  };
}

/**
 * The shadow crescent. The light comes from the upper left on every world, so
 * the terminator bulges the same way across the whole plate — which is what
 * makes a dozen separate discs read as one lit scene.
 */
export function terminatorPath(R: number): string {
  const s = Math.PI / 4;
  const k = 0.42;
  const p1 = [Math.cos(s - Math.PI / 2) * R, Math.sin(s - Math.PI / 2) * R];
  const p2 = [Math.cos(s + Math.PI / 2) * R, Math.sin(s + Math.PI / 2) * R];
  const c = [Math.cos(s) * R * k * 2, Math.sin(s) * R * k * 2];
  return (
    `M${pt(p1[0], p1[1])}A${f(R)} ${f(R)} 0 0 1 ${pt(p2[0], p2[1])}` +
    `Q${pt(c[0], c[1])} ${pt(p1[0], p1[1])}Z`
  );
}

// ---- paper: the five sigil families ----------------------------------------

/** A rete of pointer tips over a degree scale: the instrument itself. */
function astrolabe(R: number, rng: () => number): Mark[] {
  const m: Mark[] = [];
  m.push({ k: 'circle', cls: 'ct-sg-plate', fill: 'stipple', cx: 0, cy: 0, r: f(R * 0.87) });
  m.push({ k: 'path', cls: 'ct-sg-sector', fill: 'hatch-a', d: sectorPath(R * 0.3, R * 0.87, -1.9, -1.1) });
  m.push(...ticks('ct-sg-tick', 72, R * 0.87, R * 0.93, 0, 6, R * 0.99));
  m.push({ k: 'circle', cls: 'ct-sg-ring', cx: 0, cy: 0, r: f(R) });
  m.push({ k: 'circle', cls: 'ct-sg-ring', cx: 0, cy: 0, r: f(R * 0.87) });

  // The rete: an eccentric ecliptic with barbed pointers, the part that turns.
  const ex = R * 0.17;
  const ey = -R * 0.09;
  const er = R * 0.52;
  m.push({ k: 'circle', cls: 'ct-sg-rete', cx: f(ex), cy: f(ey), r: f(er) });
  m.push({ k: 'circle', cls: 'ct-sg-rete', cx: f(ex), cy: f(ey), r: f(er * 0.42) });
  const barbs = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < barbs; i += 1) {
    const a = rng() * TAU;
    const bx = ex + Math.cos(a) * er;
    const by = ey + Math.sin(a) * er;
    const reach = R * (0.16 + rng() * 0.12);
    const tx = bx + Math.cos(a) * reach;
    const ty = by + Math.sin(a) * reach;
    const wx = -Math.sin(a) * R * 0.07;
    const wy = Math.cos(a) * R * 0.07;
    m.push({
      k: 'path',
      cls: 'ct-sg-barb',
      d: `M${pt(bx + wx, by + wy)}L${pt(tx, ty)}L${pt(bx - wx, by - wy)}`,
    });
  }

  m.push({ k: 'line', cls: 'ct-sg-bar', x1: f(-R * 0.87), y1: 0, x2: f(R * 0.87), y2: 0 });
  m.push({ k: 'line', cls: 'ct-sg-bar', x1: 0, y1: f(-R * 0.87), x2: 0, y2: f(R * 0.87) });
  m.push({ k: 'circle', cls: 'ct-sg-hub', cx: 0, cy: 0, r: f(R * 0.05) });
  return m;
}

/** Petal arcs turning about a hub, every other one laid in. */
function rosette(R: number, rng: () => number): Mark[] {
  const m: Mark[] = [];
  const petals = 6 + Math.floor(rng() * 5);
  const phase = rng() * (TAU / petals);
  m.push({ k: 'circle', cls: 'ct-sg-ring', cx: 0, cy: 0, r: f(R) });
  m.push(...ticks('ct-sg-tick', petals * 4, R * 0.94, R, phase, 4, R));

  const spread = (Math.PI / petals) * 0.92;
  const fills: (PatternKey | undefined)[] = ['hatch-b', undefined, 'stipple'];
  for (let i = 0; i < petals; i += 1) {
    const a = phase + (i / petals) * TAU;
    const tip = [Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9];
    const c1 = [Math.cos(a - spread) * R * 0.58, Math.sin(a - spread) * R * 0.58];
    const c2 = [Math.cos(a + spread) * R * 0.58, Math.sin(a + spread) * R * 0.58];
    m.push({
      k: 'path',
      cls: 'ct-sg-petal',
      fill: fills[i % fills.length],
      d: `M0 0Q${pt(c1[0], c1[1])} ${pt(tip[0], tip[1])}Q${pt(c2[0], c2[1])} 0 0Z`,
    });
  }

  m.push({ k: 'circle', cls: 'ct-sg-ring-2', cx: 0, cy: 0, r: f(R * 0.3) });
  m.push({ k: 'circle', cls: 'ct-sg-plate', fill: 'stipple-dense', cx: 0, cy: 0, r: f(R * 0.3) });
  m.push({ k: 'circle', cls: 'ct-sg-hub', cx: 0, cy: 0, r: f(R * 0.06) });
  return m;
}

/**
 * A hex mesh inside a bezel. Whole cells only — SVG cannot clip without a
 * `clipPath` the solver would have to name, and a ring of short fringe ticks
 * closes the gap more honestly than a clipped edge anyway.
 */
function lattice(R: number, rng: () => number): Mark[] {
  const m: Mark[] = [];
  const s = R / 3.3;
  const reach = R * 0.9;
  m.push({ k: 'circle', cls: 'ct-sg-ring', cx: 0, cy: 0, r: f(R) });
  m.push({ k: 'circle', cls: 'ct-sg-ring-2', cx: 0, cy: 0, r: f(R * 0.9) });
  m.push(...ticks('ct-sg-fringe', 48, R * 0.9, R, 0, 8, R));

  const span = Math.ceil(R / s) + 1;
  for (let col = -span; col <= span; col += 1) {
    for (let row = -span; row <= span; row += 1) {
      const cx = col * s * 1.5;
      const cy = row * s * Math.sqrt(3) + (col % 2 === 0 ? 0 : (s * Math.sqrt(3)) / 2);
      const verts: [number, number][] = [];
      let inside = true;
      for (let k = 0; k < 6; k += 1) {
        const a = (k / 6) * TAU;
        const vx = cx + Math.cos(a) * s;
        const vy = cy + Math.sin(a) * s;
        if (Math.hypot(vx, vy) > reach) inside = false;
        verts.push([vx, vy]);
      }
      if (!inside) continue;
      const d = `M${verts.map(([vx, vy]) => pt(vx, vy)).join('L')}Z`;
      const roll = rng();
      m.push({
        k: 'path',
        cls: roll < 0.22 ? 'ct-sg-cell' : 'ct-sg-mesh',
        fill: roll < 0.1 ? 'cross' : roll < 0.22 ? 'stipple' : undefined,
        d,
      });
    }
  }
  m.push({ k: 'circle', cls: 'ct-sg-hub', cx: 0, cy: 0, r: f(R * 0.05) });
  return m;
}

/** Nested dials turned against each other, one of them lettered. */
function volvelle(R: number, rng: () => number): Mark[] {
  const m: Mark[] = [];
  const radii = [R, R * 0.72, R * 0.46];
  const counts = [36, 24, 12];
  m.push({ k: 'circle', cls: 'ct-sg-plate', fill: 'stipple', cx: 0, cy: 0, r: f(R * 0.46) });

  radii.forEach((r, i) => {
    const phase = rng() * TAU;
    m.push({ k: 'circle', cls: i === 1 ? 'ct-sg-ring-2' : 'ct-sg-ring', cx: 0, cy: 0, r: f(r) });
    m.push(...ticks('ct-sg-tick', counts[i], r * 0.9, r, phase, 3, r));
  });

  // The lettered band: alien script between the outer two dials.
  const runes = 12;
  const runePhase = rng() * TAU;
  const runeR = (radii[0] + radii[1]) / 2;
  for (let i = 0; i < runes; i += 1) {
    const a = runePhase + (i / runes) * TAU;
    const scale = R / 62;
    m.push({
      k: 'path',
      cls: 'ct-sg-rune',
      d: transformed(runeGlyph(rng), Math.cos(a) * runeR, Math.sin(a) * runeR, (a * 180) / Math.PI + 90, scale),
    });
  }

  // The window, and the arm that reads through it.
  const windowA = rng() * TAU;
  m.push({
    k: 'path',
    cls: 'ct-sg-sector',
    fill: 'hatch-c',
    d: sectorPath(radii[1], radii[0], windowA, windowA + 0.62),
  });
  const armA = rng() * TAU;
  m.push({
    k: 'line',
    cls: 'ct-sg-arm',
    x1: 0,
    y1: 0,
    x2: f(Math.cos(armA) * R * 0.97),
    y2: f(Math.sin(armA) * R * 0.97),
  });
  const tipX = Math.cos(armA) * R * 0.97;
  const tipY = Math.sin(armA) * R * 0.97;
  const back = R * 0.12;
  const wide = R * 0.06;
  m.push({
    k: 'path',
    cls: 'ct-sg-arm',
    d:
      `M${pt(tipX - Math.cos(armA) * back - Math.sin(armA) * wide, tipY - Math.sin(armA) * back + Math.cos(armA) * wide)}` +
      `L${pt(tipX, tipY)}` +
      `L${pt(tipX - Math.cos(armA) * back + Math.sin(armA) * wide, tipY - Math.sin(armA) * back - Math.cos(armA) * wide)}`,
  });
  m.push({ k: 'circle', cls: 'ct-sg-hub', cx: 0, cy: 0, r: f(R * 0.07) });
  return m;
}

/** A stick figure of stars under glass: the disc as a piece of sky. */
function constellation(R: number, rng: () => number): Mark[] {
  const m: Mark[] = [];
  m.push({ k: 'circle', cls: 'ct-sg-ring', cx: 0, cy: 0, r: f(R) });
  m.push({ k: 'circle', cls: 'ct-sg-ring-2', cx: 0, cy: 0, r: f(R * 0.9) });
  m.push(...ticks('ct-sg-tick', 24, R * 0.9, R, 0, 6, R));

  const count = 6 + Math.floor(rng() * 4);
  const stars: [number, number, number][] = [];
  let guard = 0;
  while (stars.length < count && guard < 400) {
    guard += 1;
    const a = rng() * TAU;
    const rho = Math.sqrt(rng()) * R * 0.74;
    const x = Math.cos(a) * rho;
    const y = Math.sin(a) * rho;
    if (stars.some(([sx, sy]) => Math.hypot(sx - x, sy - y) < R * 0.26)) continue;
    stars.push([x, y, R * (0.05 + rng() * 0.06)]);
  }

  // Link them nearest-first from the leftmost star: a figure, not a polygon.
  const order: number[] = [];
  const used = new Set<number>();
  let at = stars.reduce((best, [x], i) => (x < stars[best][0] ? i : best), 0);
  while (order.length < stars.length) {
    order.push(at);
    used.add(at);
    let next = -1;
    let nearest = Infinity;
    for (let i = 0; i < stars.length; i += 1) {
      if (used.has(i)) continue;
      const dist = Math.hypot(stars[i][0] - stars[at][0], stars[i][1] - stars[at][1]);
      if (dist < nearest) {
        nearest = dist;
        next = i;
      }
    }
    if (next === -1) break;
    at = next;
  }
  if (order.length > 1) {
    m.push({
      k: 'path',
      cls: 'ct-sg-link',
      d: `M${order.map((i) => pt(stars[i][0], stars[i][1])).join('L')}`,
    });
  }
  for (const [x, y, r] of stars) {
    m.push({ k: 'path', cls: 'ct-sg-star', d: starMark(x, y, r) });
  }
  return m;
}

/** Moves a glyph path built about the origin onto the ring. */
function transformed(d: string, x: number, y: number, deg: number, scale: number): string {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad) * scale;
  const sin = Math.sin(rad) * scale;
  // Only ever fed absolute M/L/V/H-free paths built by `runeGlyph`, which
  // emits `M x y` and `L x y` pairs; rewriting the points keeps the mark a
  // plain `d` with no transform attribute for CSS to fight over.
  return d.replace(/([ML])\s*(-?[\d.]+)\s+(-?[\d.]+)/g, (_all, cmd: string, sx: string, sy: string) => {
    const px = parseFloat(sx);
    const py = parseFloat(sy);
    return `${cmd}${f(x + px * cos - py * sin)} ${f(y + px * sin + py * cos)}`;
  });
}

export function paperSigil(name: string, R: number): PaperSigil {
  const index = familyIndex(name);
  const rng = seededRng(hashString(`sigil:${name}`));
  const tilt = f(-14 + rng() * 28);
  const family = SIGIL_FAMILIES[index];
  const marks =
    family === 'astrolabe'
      ? astrolabe(R, rng)
      : family === 'rosette'
        ? rosette(R, rng)
        : family === 'lattice'
          ? lattice(R, rng)
          : family === 'volvelle'
            ? volvelle(R, rng)
            : constellation(R, rng);
  return { family, index, tilt, marks };
}

// ---- shared ornament: runes and the star -----------------------------------

/**
 * One glyph of the alien script. Absolute `M`/`L` only, so `transformed` can
 * move it without a transform attribute.
 */
export function runeGlyph(rng: () => number): string {
  const strokes: string[] = [];
  const top = -5 - rng() * 2;
  const bottom = 4 + rng() * 2;
  strokes.push(`M0 ${f(top)}L0 ${f(bottom)}`);
  const count = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i += 1) {
    const y = top + (bottom - top) * (0.14 + rng() * 0.72);
    const width = 2 + rng() * 3;
    const sign = rng() < 0.5 ? -1 : 1;
    const kind = rng();
    if (kind < 0.44) strokes.push(`M0 ${f(y)}L${f(width * sign)} ${f(y)}`);
    else if (kind < 0.74) strokes.push(`M0 ${f(y)}L${f(width * sign)} ${f(y - width * 0.8)}`);
    else strokes.push(`M${f(width * sign)} ${f(y)}L${f(width * sign)} ${f(y + 2 + rng() * 2)}`);
  }
  if (rng() < 0.34) strokes.push(`M-2.4 ${f(top)}L2.4 ${f(top)}`);
  return strokes.join('');
}

/**
 * The orrery ring: `count` runes on a circle, seeded by the system's path so
 * a folder's ring is its own. Positions are local to the star.
 */
export function orreryRunes(seed: string, radius: number, count: number): Rune[] {
  const rng = seededRng(hashString(`orrery:${seed}`));
  const out: Rune[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * TAU;
    out.push({
      d: runeGlyph(rng),
      x: f(Math.cos(a) * radius),
      y: f(Math.sin(a) * radius),
      angle: f((a * 180) / Math.PI + 90),
    });
  }
  return out;
}

/** The ticks outside the rune ring; one every `every` runes. */
export function orreryTicks(
  radius: number,
  count: number,
  every: number,
): { x1: number; y1: number; x2: number; y2: number }[] {
  const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let i = 0; i < count; i += every) {
    const a = (i / count) * TAU;
    out.push({
      x1: f(Math.cos(a) * radius),
      y1: f(Math.sin(a) * radius),
      x2: f(Math.cos(a) * (radius + 9)),
      y2: f(Math.sin(a) * (radius + 9)),
    });
  }
  return out;
}

/**
 * The star at the centre of the system: rings, a fan of rays that opens
 * downward so the system's name has somewhere to sit, and a glyph. The one
 * place Paper is allowed to spend gold leaf.
 */
export function starSigil(R: number): StarSigil {
  const rings = [
    { r: f(R * 0.38), dashed: false },
    { r: f(R * 0.64), dashed: true },
    { r: f(R * 0.9), dashed: false },
  ];
  const rays: StarSigil['rays'] = [];
  for (let i = 0; i < 24; i += 1) {
    const a = (i / 24) * TAU;
    // The fan opens downward: no ray where the name goes.
    if (Math.sin(a) > 0.5) continue;
    const long = i % 6 === 1 && Math.sin(a) < 0.1;
    const r1 = R * 0.96;
    const r2 = R * (long ? 1.24 : 1.06);
    rays.push({
      x1: f(Math.cos(a) * r1),
      y1: f(Math.sin(a) * r1),
      x2: f(Math.cos(a) * r2),
      y2: f(Math.sin(a) * r2),
      long,
    });
  }
  const k = R / 46;
  const glyph =
    `M${pt(0, -12 * k)}L${pt(10 * k, -6 * k)}L${pt(10 * k, 6 * k)}L${pt(0, 12 * k)}` +
    `L${pt(-10 * k, 6 * k)}L${pt(-10 * k, -6 * k)}Z` +
    `M${pt(0, -6 * k)}L${pt(0, 3 * k)}` +
    `M${pt(-5 * k, -1.5 * k)}L${pt(0, 3 * k)}L${pt(5 * k, -1.5 * k)}`;
  return { rings, rays, glyph, coreR: f(3.4 * k) };
}

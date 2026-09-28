/**
 * The zoom renderer: Night Ops and Cockpit fly through the workspace instead
 * of reading it off a chart.
 *
 * Four levels, chosen by `camera.depthOf(dir)`:
 *
 *   1  galaxy  every folder is a seeded star cluster, the root's loose files a
 *              local field at the centre, and folders that changed in the same
 *              band are strung together by a cosmic web
 *   2  system  the folder is a local star; its subfolders are painted planets,
 *              its notebooks bright bodies, its files asteroids, all on the
 *              recency orbits the rest of the map uses
 *   3  moons   one large disc at the centre, this folder's entries orbiting it
 *              as labelled moons, subfolders as outposts on the rim
 *  4+  chart   the plain instrument: hairline rings with `textPath` captions,
 *              dots and labels, nothing else
 *
 * Between levels the camera flies: one `<g class="zoom-camera">` scales about
 * the body you clicked while the arriving level, pre-shrunk *inside* that body
 * by the nesting matrix, grows out of it. `camera.ts` owns that arithmetic and
 * proves the rebase afterwards is pixel-identical.
 *
 * Paint is entirely in `zoom.css`, keyed on `[data-mode]`: Night Ops is calm
 * and unlit, Cockpit is a tactical scope. Nothing here sets a colour; SVG
 * attributes carry geometry, and the only `fill` written in markup is a
 * `url(#…)` gradient reference.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';

import { relativeTime } from '../../shell/recent';
import type { Mode } from '../../theme/tokens';
import {
  BANDS,
  ORBIT_MIN,
  asteroidPath,
  bandFor,
  displayName,
  hashString,
  placeLabels,
  ringOrbit,
  type Band,
  type Body,
  type BodyInput,
  type BodyKind,
  type LabelItem,
  type LabelObstacle,
  type LabelSide,
  type Placement,
} from '../model';
import type { MapRendererProps } from '../renderer';
import type { BodyStatus } from '../store';
import { useViewport } from '../useViewport';
import { centerOn, type Box } from '../viewport';
import {
  NO_TRANSFORM,
  REBASE_MS,
  depthOf,
  flyPlan,
  levelFor,
  type FlyPlan,
  type Point,
  type ZoomLevel,
} from './camera';
import {
  DEFAULT_SPREAD,
  clusterFor,
  clusterRadius,
  cosmicWeb,
  looseField,
  spreadGalaxies,
  type Cluster,
  type Placed,
  type WebNode,
} from './clusters';
import './zoom.css';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** The breadcrumb overlays the top-left, the legend the bottom-left. */
const TOP_RESERVE = 46;
const BOTTOM_RESERVE = 58;
/** Room outside the rim ring for labels. */
const RIM_PADDING = 44;
const MIN_RADIUS = 84;

const LABEL_CHAR_PX = 5.9;
const LABEL_LINE_PX = 13;
const CAPTION_CHAR_PX = 5.2;

/** Ring captions ride the four band boundaries; the rim is the fifth. */
const RING_BANDS: Exclude<Band, 'older'>[] = ['today', 'week', 'month', 'halfyear'];
const ALL_BANDS: Band[] = [...RING_BANDS, 'older'];

/** At or below this many bodies every file gets a label too. */
const FILE_LABEL_BUDGET = 22;
/** How many children a selected folder previews beside itself. */
const PREVIEW_CAP = 10;
/** Room a galaxy leaves for the loose field's hull and its two caption lines. */
const LOOSE_CAPTION_CLEAR = 46;

/**
 * How far past the stage each level lays itself out, now that the map is
 * something you drag around. The bodies keep the size they always had; only
 * the distances between them grow, which is what turns a clot in the middle of
 * the window into a place worth travelling across. The galaxy gets the most
 * room, the two middle levels a little, and the plain chart none — its layout
 * is already the one that fits.
 */
const SPREAD_BY_LEVEL: Record<ZoomLevel, number> = {
  galaxy: DEFAULT_SPREAD,
  system: 1.25,
  moons: 1.25,
  chart: 1,
};

/** Seconds per turn for the ambient motion loop (Cockpit only). */
const GALAXY_PERIOD_S = 360;
const MOON_PERIOD_S: Record<Band, number> = {
  today: 150,
  week: 186,
  month: 228,
  halfyear: 282,
  older: 336,
};
const OUTPOST_PERIOD_S = 420;

// ---- small helpers ----------------------------------------------------------

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

function r1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/** 0…1 across the model's visual scale range. */
function sizeFactor(body: Body): number {
  return clamp((body.scale - 0.75) / 0.75, 0, 1);
}

/** 0…1 across the orbit range, so a level can remap recency onto its own rings. */
function orbitNorm(orbit: number): number {
  return clamp((orbit - ORBIT_MIN) / (1 - ORBIT_MIN), 0, 1);
}

/**
 * Recency remapped onto the annulus a level actually has room for. The system
 * and moon levels both put something large at the centre, so the raw orbit
 * range (which starts at 0.22·R) would bury the innermost bodies under the
 * star and its caption. Rings and bodies go through the same function, so a
 * body still sits exactly on the ring its band names.
 */
function annulus(R: number, lo: number, hi: number): (orbit: number) => number {
  return (orbit) => R * (lo + (hi - lo) * orbitNorm(orbit));
}

function plural(n: number): string {
  return `${n} ${n === 1 ? 'item' : 'items'}`;
}

/** Bearing in whole degrees clockwise from 12 o'clock, for Cockpit's readouts. */
function bearingOf(x: number, y: number): string {
  const deg = (Math.round(Math.atan2(x, -y) / DEG) + 360) % 360;
  return String(deg).padStart(3, '0');
}

function statusClasses(status: BodyStatus | undefined): string {
  if (!status) return '';
  return [
    status.open ? 'is-open' : '',
    status.active ? 'is-active' : '',
    status.dirty ? 'is-dirty' : '',
    status.errors > 0 ? 'has-error' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function ledClass(status: BodyStatus | undefined): string | null {
  if (!status || !status.kernel) return null;
  if (status.errors > 0) return 'led-err';
  if (status.kernel === 'busy' || status.running > 0) return 'led-warn';
  if (status.kernel === 'idle') return 'led-ok';
  return null;
}

/**
 * The two-arc circle a ring caption rides, starting just clockwise of 12
 * o'clock — the wedge `model.LABEL_SECTOR` keeps bodies out of.
 */
function ringCaptionPath(r: number): string {
  const a0 = -100 * DEG;
  const sx = Math.cos(a0) * r;
  const sy = Math.sin(a0) * r;
  return `M${r1(sx)},${r1(sy)}A${r1(r)},${r1(r)} 0 0 1 ${r1(-sx)},${r1(-sy)}A${r1(r)},${r1(r)} 0 0 1 ${r1(sx)},${r1(sy)}`;
}

function arcPath(r: number, a0: number, a1: number): string {
  return `M${r1(Math.cos(a0) * r)},${r1(Math.sin(a0) * r)}A${r1(r)},${r1(r)} 0 0 1 ${r1(Math.cos(a1) * r)},${r1(Math.sin(a1) * r)}`;
}

/** A regular polygon centred on the origin, for outposts. */
function polygonPoints(sides: number, radius: number): string {
  const out: string[] = [];
  for (let i = 0; i < sides; i += 1) {
    const a = (i / sides) * TAU;
    out.push(`${r1(Math.cos(a) * radius)},${r1(Math.sin(a) * radius)}`);
  }
  return out.join(' ');
}

/** Corner brackets: four L-shaped ticks around a square of half-width `h`. */
function bracketPath(h: number, arm: number): string {
  return [
    `M${r1(-h)},${r1(-h + arm)}L${r1(-h)},${r1(-h)}L${r1(-h + arm)},${r1(-h)}`,
    `M${r1(h - arm)},${r1(-h)}L${r1(h)},${r1(-h)}L${r1(h)},${r1(-h + arm)}`,
    `M${r1(h)},${r1(h - arm)}L${r1(h)},${r1(h)}L${r1(h - arm)},${r1(h)}`,
    `M${r1(-h + arm)},${r1(h)}L${r1(-h)},${r1(h)}L${r1(-h)},${r1(h - arm)}`,
  ].join('');
}

/** Tick marks around a range ring, every `step` degrees. */
function tickPath(radius: number, step: number, len: number): string {
  const out: string[] = [];
  for (let deg = 0; deg < 360; deg += step) {
    const a = deg * DEG;
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.push(`M${r1(c * radius)},${r1(s * radius)}L${r1(c * (radius + len))},${r1(s * (radius + len))}`);
  }
  return out.join('');
}

// ---- geometry ---------------------------------------------------------------

export interface Stage {
  cx: number;
  cy: number;
  R: number;
}

/**
 * The system centres in what is left of the host after the breadcrumb and the
 * legend, with room outside the rim for labels. Nothing else in the renderer
 * knows the host size.
 */
export function stageFor(w: number, h: number): Stage {
  const usable = Math.max(0, h - TOP_RESERVE - BOTTOM_RESERVE);
  return {
    cx: w / 2,
    cy: TOP_RESERVE + usable / 2,
    R: Math.max(MIN_RADIUS, Math.min(w / 2 - RIM_PADDING, usable / 2 - RIM_PADDING)),
  };
}

// ---- label solving ----------------------------------------------------------

interface LabelRequest {
  id: string;
  x: number;
  y: number;
  text: string;
  caption?: string;
  /** Distance from the body's centre to where the label starts. */
  gap: number;
}

type Solved = Map<string, { side: LabelSide; dy: number }>;

const NO_PREVIOUS = new Map<string, Placement>();

/**
 * Labels radiate outward, flip to the near side rather than run off the edge,
 * and de-collide against each other and against every body's disc — the same
 * `model.placeLabels` the orbital chart uses, so the two methods agree about
 * what a crowded system looks like. Nothing on these levels moves under its
 * own label, so the hysteresis argument is left empty.
 */
function solveLabels(requests: LabelRequest[], obstacles: LabelObstacle[]): Solved {
  const items: LabelItem[] = requests.map((request) => ({
    id: request.id,
    x: request.x,
    y: request.y,
    w:
      request.gap +
      Math.max(
        request.text.length * LABEL_CHAR_PX,
        (request.caption?.length ?? 0) * CAPTION_CHAR_PX,
      ),
    h: LABEL_LINE_PX,
    outward: request.x >= 0 ? 'right' : 'left',
  }));
  const placements = placeLabels(items, obstacles, NO_PREVIOUS);
  const solved: Solved = new Map();
  for (const [id, placement] of placements) {
    solved.set(id, { side: placement.side, dy: placement.dy * LABEL_LINE_PX * 1.05 });
  }
  return solved;
}

interface LabelProps {
  solved: Solved;
  id: string;
  gap: number;
  text: string;
  caption?: string;
  /** `zoom-name` for structure you can navigate into, `zoom-leaf` otherwise. */
  kindClass: string;
}

function BodyLabel({ solved, id, gap, text, caption, kindClass }: LabelProps): ReactNode {
  const placement = solved.get(id);
  if (!placement) return null;
  const flip = placement.side === 'left';
  const x = flip ? -gap : gap;
  return (
    <g className="zoom-counter">
      <text className={`zoom-label ${kindClass}${flip ? ' flip' : ''}`} x={r1(x)} y={r1(placement.dy + 4)}>
        {text}
      </text>
      {caption ? (
        <text className={`zoom-label zoom-cap${flip ? ' flip' : ''}`} x={r1(x)} y={r1(placement.dy + 16)}>
          {caption}
        </text>
      ) : null}
    </g>
  );
}

// ---- the interactive body ---------------------------------------------------

interface Handlers {
  select(path: string | null): void;
  hover(path: string | null): void;
  open(path: string, kind: BodyKind): void;
  dive(path: string, focus: Point): void;
}

interface BodyGroupProps {
  path: string;
  kind: BodyKind;
  x: number;
  y: number;
  hitR: number;
  classes: string;
  label: string;
  modifiedAt: number;
  selected: boolean;
  live: boolean;
  on: Handlers;
  children: ReactNode;
}

/**
 * Every clickable thing on the map, at every level: a focusable `<g>` whose
 * handlers implement `RENDERER_INTERACTION_RULE` — click selects, double click
 * or Enter dives (folders) or opens (notebooks and files), hover only hovers.
 * Labels live inside it, so a name is as clickable as its dot.
 */
function BodyGroup(props: BodyGroupProps): ReactNode {
  const { path, kind, x, y, hitR, classes, label, modifiedAt, selected, live, on, children } = props;
  const enterable = kind === 'directory';

  function enter(): void {
    if (enterable) on.dive(path, { x, y });
    else on.open(path, kind);
  }

  /**
   * A body's double-click is a dive or an open. The viewport's own
   * double-click fits the camera and stands down for anything already handled
   * (`useViewport`'s `onDoubleClick` checks `defaultPrevented`), so this is
   * what stops a dive from also refitting the stage under it.
   */
  function onDoubleClick(event: ReactMouseEvent<SVGGElement>): void {
    event.preventDefault();
    enter();
  }

  function onKeyDown(event: ReactKeyboardEvent<SVGGElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      enter();
      return;
    }
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      event.stopPropagation();
      on.select(path);
    }
  }

  return (
    <g
      className={`zoom-body ${classes}`}
      data-path={path}
      transform={`translate(${r1(x)},${r1(y)})`}
      role="button"
      tabIndex={live ? 0 : -1}
      aria-label={`${label}, ${kind}, modified ${relativeTime(modifiedAt)}`}
      aria-pressed={selected}
      onClick={() => on.select(path)}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onPointerEnter={() => on.hover(path)}
      onPointerLeave={() => on.hover(null)}
      onFocus={() => on.hover(path)}
      onBlur={() => on.hover(null)}
    >
      <circle className="zoom-hit" r={r1(hitR)} />
      {children}
    </g>
  );
}

/**
 * The selection/hover ring, plus the arc Cockpit sweeps around it. Both live
 * in one group so the rotation the sweep needs is about the body's own centre.
 */
function SelRing({ r }: { r: number }): ReactNode {
  return (
    <g className="zoom-sel">
      <circle className="zoom-ring-sel" r={r1(r)} />
      <path className="zoom-sweep" d={arcPath(r, -20 * DEG, 20 * DEG)} />
    </g>
  );
}

// ---- shared body art --------------------------------------------------------

interface PlanetProps {
  r: number;
  band: Band;
  seed: string;
  /** Shared gradient ids. */
  uid: string;
  /** Layer-local ids, so the two levels on screen during a flight never clash. */
  lid: string;
}

function Planet({ r, band, seed, uid, lid }: PlanetProps): ReactNode {
  const hash = hashString(seed);
  const clip = `${lid}-clip-${hash.toString(36)}`;
  const tilt = (hash / 0x1_0000_0000 - 0.5) * 40;
  return (
    <g className="zoom-planet">
      <defs>
        <clipPath id={clip}>
          <circle r={r1(r)} />
        </clipPath>
      </defs>
      <circle r={r1(r)} fill={`url(#${uid}-pl-${band})`} />
      <g clipPath={`url(#${clip})`} transform={`rotate(${r1(tilt)})`}>
        <ellipse className="zoom-pl-band edge" cy={r1(-r * 0.42)} rx={r1(r * 1.25)} ry={r1(r * 0.13)} />
        <ellipse className="zoom-pl-band mid" cy={r1(r * 0.04)} rx={r1(r * 1.25)} ry={r1(r * 0.1)} />
        <ellipse className="zoom-pl-band edge" cy={r1(r * 0.46)} rx={r1(r * 1.25)} ry={r1(r * 0.12)} />
      </g>
      <circle className="zoom-pl-shade" r={r1(r)} fill={`url(#${uid}-terminator)`} />
      <circle className="zoom-pl-rim" r={r1(r)} />
      <ellipse
        className="zoom-pl-ring"
        rx={r1(r * 1.72)}
        ry={r1(r * 0.42)}
        transform={`rotate(${r1(-16 + tilt * 0.4)})`}
      />
    </g>
  );
}

function BrightBody({ r, band, uid }: { r: number; band: Band; uid: string }): ReactNode {
  return (
    <>
      <circle className="zoom-nb-glow" r={r1(r * 2.6)} fill={`url(#${uid}-halo-${band})`} />
      <circle className="zoom-nb" r={r1(r)} />
    </>
  );
}

function Asteroid({ r, path }: { r: number; path: string }): ReactNode {
  return <path className="zoom-ast" d={asteroidPath(path, r)} />;
}

/**
 * Cockpit's contact furniture: corner brackets, a contact LED and a
 * `BRG`/`RNG` readout. Rendered only in Cockpit (it is structure, not paint);
 * `zoom.css` decides when the readout is legible enough to show.
 */
function Contact({
  h,
  arm,
  bearing,
  range,
}: {
  h: number;
  arm: number;
  bearing: string;
  range: string;
}): ReactNode {
  return (
    <g className="zoom-contact" aria-hidden="true">
      <path className="zoom-bracket" d={bracketPath(h, arm)} />
      <circle className="zoom-contact-led" cx={r1(h - 2)} cy={r1(-h + 2)} r="1.8" />
      {/* A big contact has room for its readout inside the bracket, where it
          can never land on a neighbour's caption; a small one has to hang it
          above itself. */}
      <text className="zoom-readout" x={r1(-h + (h >= 26 ? 5 : 0))} y={r1(h >= 26 ? -h + 12 : -h - 5)}>
        {`BRG ${bearing} · RNG ${range}`}
      </text>
    </g>
  );
}

/** The faint constellation a selected folder shows its children as. */
function Preview({
  entries,
  radius,
  side,
  now,
}: {
  entries: BodyInput[];
  radius: number;
  side: 1 | -1;
  now: number;
}): ReactNode {
  const shown = entries.slice(0, PREVIEW_CAP);
  if (shown.length === 0) return null;
  const spread = Math.min(1.5, 0.34 * shown.length);
  const gap = radius + 18;
  return (
    <g className="zoom-preview" aria-hidden="true">
      <path
        className="zoom-preview-arc"
        d={`M${r1(side * gap)},${r1(-spread * 26)}Q${r1(side * (gap + 16))},0 ${r1(side * gap)},${r1(spread * 26)}`}
      />
      {shown.map((entry, i) => {
        const t = shown.length === 1 ? 0.5 : i / (shown.length - 1);
        const a = (t - 0.5) * spread;
        const band = bandFor(Math.max(0, now - entry.modifiedAt));
        return (
          <circle
            key={entry.path}
            className={`zoom-preview-dot band-${band}${entry.kind === 'directory' ? ' is-dir' : ''}`}
            cx={r1(side * (gap + 8) * Math.cos(a))}
            cy={r1((gap + 8) * Math.sin(a))}
            r={entry.kind === 'notebook' ? '2.6' : '1.9'}
          />
        );
      })}
      {entries.length > PREVIEW_CAP ? (
        <text
          className={`zoom-label zoom-cap${side < 0 ? ' flip' : ''}`}
          x={r1(side * gap)}
          y={r1(spread * 26 + 16)}
        >
          {`+${entries.length - PREVIEW_CAP} more`}
        </text>
      ) : null}
    </g>
  );
}

// ---- the level snapshot -----------------------------------------------------

interface Snapshot {
  dir: string;
  bodies: Body[];
  childrenOf: Record<string, BodyInput[]>;
  descendants: Record<string, number>;
  statuses: Record<string, BodyStatus>;
  systemLabel: string;
  selected: string | null;
  hovered: string | null;
  query: string;
  connected: boolean;
  anyBusy: boolean;
}

interface LevelCtx {
  snap: Snapshot;
  stage: Stage;
  /** `SPREAD_BY_LEVEL`: how far past the stage this level lays itself out. */
  spread: number;
  /** Shared across both layers: the gradients in `<Defs>`. */
  uid: string;
  /** This layer's own prefix, for ids two levels on screen at once would clash on. */
  lid: string;
  mode: Mode;
  live: boolean;
  now: number;
  on: Handlers;
}

function bodyStateClasses(ctx: LevelCtx, body: Body, needle: string): string {
  const { snap } = ctx;
  return [
    `kind-${body.kind}`,
    `band-${body.band}`,
    statusClasses(snap.statuses[body.path]),
    snap.selected === body.path ? 'is-selected' : '',
    snap.hovered === body.path ? 'is-hovered' : '',
    needle ? (body.name.toLowerCase().includes(needle) ? 'match' : 'dim') : '',
  ]
    .filter(Boolean)
    .join(' ');
}

// ---- rings shared by the system and chart levels ----------------------------

/** The five band radii, in band order, for whichever annulus a level uses. */
function bandRadii(place: (orbit: number) => number): number[] {
  return [...RING_BANDS.map((band) => place(ringOrbit(band))), place(1)];
}

function RingPaths({ radii, lid }: { radii: number[]; lid: string }): ReactNode {
  return (
    <defs>
      {ALL_BANDS.map((band, i) => (
        <path key={band} id={`${lid}-cap-${band}`} d={ringCaptionPath(radii[i])} />
      ))}
    </defs>
  );
}

interface RingsProps {
  radii: number[];
  lid: string;
  ticks: boolean;
  /** The chart and the system name their rings; the moon level does not. */
  captions: boolean;
}

function Rings({ radii, lid, ticks, captions }: RingsProps): ReactNode {
  const last = radii.length - 1;
  return (
    <>
      {captions ? <RingPaths radii={radii} lid={lid} /> : null}
      <g className="zoom-rings" aria-hidden="true">
        {radii.map((radius, i) => (
          <circle
            key={ALL_BANDS[i]}
            className={i === last ? 'zoom-ring is-rim' : i % 2 === 1 ? 'zoom-ring is-alt' : 'zoom-ring'}
            r={r1(radius)}
          />
        ))}
        {ticks
          ? radii.map((radius, i) => (
              <path key={`t-${ALL_BANDS[i]}`} className="zoom-tick" d={tickPath(radius, 15, 4)} />
            ))
          : null}
        {captions
          ? ALL_BANDS.map((band) => (
              <text key={`c-${band}`} className="zoom-ring-cap" dy="-4">
                <textPath href={`#${lid}-cap-${band}`} startOffset="6">
                  {BANDS.find((b) => b.id === band)?.label ?? band}
                </textPath>
              </text>
            ))
          : null}
      </g>
    </>
  );
}

// ---- depth 1: the galaxy ----------------------------------------------------

interface GalaxyItem {
  body: Body;
  cluster: Cluster;
  x: number;
  y: number;
}

/**
 * Folders ring the loose field, distance from the centre growing with age the
 * way it does everywhere else on the map, then relaxed *in angle only* until
 * no two discs touch — and finally thrown `spread` times as wide, which is the
 * one thing that makes the galaxy bigger than the window.
 */
function galaxyLayout(
  bodies: Body[],
  descendants: Record<string, number>,
  R: number,
  spread: number,
): GalaxyItem[] {
  const folders = bodies.filter((b) => b.kind === 'directory');
  const looseRx = R * 0.22;
  const maxCluster = clamp(R * 0.22, 14, 84);

  const placed: Placed[] = folders.map((body) => {
    const known = descendants[body.path] ?? body.childCount ?? 0;
    const radius = clusterRadius(known, maxCluster);
    // The gap clears the loose field's own two caption lines as well as its
    // hull, so a big galaxy can never sit on "loose files".
    const rMin = looseRx + radius + LOOSE_CAPTION_CLEAR;
    const rMax = R - radius * 0.86 - 8;
    const r = rMax > rMin ? rMin + (rMax - rMin) * orbitNorm(body.orbit) : (rMin + rMax) / 2;
    return { id: body.path, radius, r, angle: body.phase };
  });

  const byPath = new Map(folders.map((b) => [b.path, b]));
  // The gap is wide enough for the two caption lines that hang under each
  // disc, not just for the discs themselves.
  return spreadGalaxies(placed, 34, spread).map((spot) => {
    const body = byPath.get(spot.id)!;
    const known = descendants[body.path] ?? body.childCount ?? 0;
    return { body, cluster: clusterFor(body.path, known, spot.radius), x: spot.x, y: spot.y };
  });
}

function GalaxyLevel(ctx: LevelCtx): ReactNode {
  const { snap, stage, spread, uid, mode, live, now, on } = ctx;
  const R = stage.R;
  const needle = snap.query.trim().toLowerCase();
  const items = galaxyLayout(snap.bodies, snap.descendants, R, spread);
  const loose = snap.bodies.filter((b) => b.kind !== 'directory');

  const looseRx = R * 0.2;
  const looseRy = R * 0.13;
  const field = looseField(`${snap.dir}|loose`, loose.length, looseRx, looseRy);

  const web = cosmicWeb(
    items.map<WebNode>((item) => ({ id: item.body.path, x: item.x, y: item.y, band: item.body.band })),
    Math.max(14, R * 0.09),
  );

  return (
    <>
      <g className="zoom-web" aria-hidden="true">
        {web.map((link) => (
          <path
            key={`${link.from}->${link.to}`}
            className="zoom-web-line"
            d={`M${r1(link.x1)},${r1(link.y1)}Q${r1(link.cx)},${r1(link.cy)} ${r1(link.x2)},${r1(link.y2)}`}
          />
        ))}
      </g>

      <g className="zoom-loose">
        <ellipse className="zoom-loose-hull" rx={r1(looseRx + 12)} ry={r1(looseRy + 12)} />
        {loose.map((body, i) => {
          const spot = field[i] ?? { x: 0, y: 0 };
          const showName = snap.selected === body.path || snap.hovered === body.path;
          return (
            <BodyGroup
              key={body.path}
              path={body.path}
              kind={body.kind}
              x={spot.x}
              y={spot.y}
              hitR={7}
              classes={`is-mote ${bodyStateClasses(ctx, body, needle)}`}
              label={displayName(body)}
              modifiedAt={body.modifiedAt}
              selected={snap.selected === body.path}
              live={live}
              on={on}
            >
              <circle className="zoom-mote" r={body.kind === 'notebook' ? '3.2' : '2.2'} />
              <SelRing r={8} />
              {showName ? (
                <text className="zoom-label zoom-leaf" x="11" y="4">
                  {displayName(body)}
                </text>
              ) : null}
            </BodyGroup>
          );
        })}
        <text className="zoom-label zoom-name zoom-mid" y={r1(looseRy + 28)}>
          loose files
        </text>
        <text className="zoom-label zoom-cap zoom-mid" y={r1(looseRy + 42)}>
          {plural(loose.length)}
        </text>
      </g>

      {items.map((item) => {
        const { body, cluster, x, y } = item;
        const known = snap.descendants[body.path] ?? body.childCount ?? 0;
        const name = displayName(body);
        // The disc is squashed *and* tilted, so its vertical reach is neither
        // the radius nor radius·squash; the caption clears the real thing.
        const theta = cluster.tilt * DEG;
        const reachY =
          cluster.radius *
          Math.hypot(Math.sin(theta), cluster.squash * Math.cos(theta));
        const capY = reachY + 20;
        return (
          <BodyGroup
            key={body.path}
            path={body.path}
            kind={body.kind}
            x={x}
            y={y}
            hitR={cluster.radius + 8}
            classes={`is-galaxy ${bodyStateClasses(ctx, body, needle)}`}
            label={name}
            modifiedAt={body.modifiedAt}
            selected={snap.selected === body.path}
            live={live}
            on={on}
          >
            <g transform={`rotate(${r1(cluster.tilt)}) scale(1 ${r1(cluster.squash)})`}>
              <circle
                className="zoom-gx-halo"
                r={r1(cluster.radius * 0.98)}
                fill={`url(#${uid}-halo-${body.band})`}
              />
              <g className="zoom-spin" data-period={GALAXY_PERIOD_S}>
                {cluster.stars.map((star, i) => (
                  <circle
                    key={i}
                    className={`zoom-star tier-${star.tier}`}
                    cx={r1(star.x)}
                    cy={r1(star.y)}
                    r={r1(star.r)}
                  />
                ))}
                <ellipse className="zoom-gx-core" rx={r1(cluster.coreRx)} ry={r1(cluster.coreRy)} />
              </g>
            </g>
            {mode === 'cockpit' ? (
              <Contact
                h={cluster.radius + 6}
                arm={Math.max(6, cluster.radius * 0.28)}
                bearing={bearingOf(x, y)}
                range={String(Math.round(Math.hypot(x, y)))}
              />
            ) : null}
            <SelRing r={cluster.radius + 12} />
            {snap.selected === body.path ? (
              <Preview
                entries={snap.childrenOf[body.path] ?? []}
                radius={cluster.radius}
                side={x >= 0 ? 1 : -1}
                now={now}
              />
            ) : null}
            <text className="zoom-label zoom-name zoom-mid" y={r1(capY)}>
              {name}
            </text>
            <text className="zoom-label zoom-cap zoom-mid" y={r1(capY + 14)}>
              {`${plural(known)} · changed ${relativeTime(body.modifiedAt, now)}`}
            </text>
          </BodyGroup>
        );
      })}
    </>
  );
}

// ---- depth 2: the system ----------------------------------------------------

function SystemLevel(ctx: LevelCtx): ReactNode {
  const { snap, stage, spread, uid, lid, mode, live, now, on } = ctx;
  const R = stage.R;
  const needle = snap.query.trim().toLowerCase();
  const starR = Math.max(12, R * 0.07);
  const captionY = starR * 2.1 + 18;
  // The star and its two caption lines own the inner court, so the orbits
  // start outside them rather than at the model's own ORBIT_MIN. Only the
  // annulus is spread: the star and the bodies on it keep their own size.
  const place = annulus(R * spread, 0.4, 0.96);

  const spots = snap.bodies.map((body) => {
    const radius =
      body.kind === 'directory'
        ? clamp(R * 0.045 + Math.sqrt(body.childCount ?? 1) * R * 0.012, R * 0.05, R * 0.105)
        : body.kind === 'notebook'
          ? R * 0.018 + sizeFactor(body) * R * 0.019
          : R * 0.011 + sizeFactor(body) * R * 0.012;
    const distance = place(body.orbit);
    return {
      body,
      r: radius,
      reach: body.kind === 'directory' ? radius * 1.8 : radius,
      x: Math.cos(body.phase) * distance,
      y: Math.sin(body.phase) * distance,
    };
  });

  const obstacles: LabelObstacle[] = [
    { x: 0, y: 0, r: starR * 2.6 },
    // The system's own name and count are not a body, so they have to be
    // handed to the solver as one, or labels walk straight over them.
    { x: 0, y: captionY + 8, r: 30 },
    ...spots.map((s) => ({ x: s.x, y: s.y, r: s.reach + 3 })),
  ];
  const quiet = snap.bodies.length <= FILE_LABEL_BUDGET;
  const solved = solveLabels(
    spots
      .filter(
        (s) =>
          s.body.kind !== 'file' ||
          quiet ||
          snap.selected === s.body.path ||
          snap.hovered === s.body.path,
      )
      .map((s) => ({ id: s.body.path, x: s.x, y: s.y, text: displayName(s.body), gap: s.reach + 10 })),
    obstacles,
  );

  return (
    <>
      <Rings radii={bandRadii(place)} lid={lid} ticks={mode === 'cockpit'} captions />
      <g className={snap.anyBusy ? 'zoom-local-star is-busy' : 'zoom-local-star'} aria-hidden="true">
        <circle className="zoom-star-glow" r={r1(starR * 3)} fill={`url(#${uid}-starglow)`} />
        {snap.connected ? (
          <circle className="zoom-star-core" r={r1(starR)} />
        ) : (
          <circle className="zoom-star-offline" r={r1(starR)} />
        )}
        <circle className="zoom-pl-rim" r={r1(starR * 1.42)} />
      </g>
      <text className="zoom-label zoom-title zoom-mid" y={r1(captionY)}>
        {snap.systemLabel}
      </text>
      <text className="zoom-label zoom-cap zoom-mid" y={r1(captionY + 15)}>
        {plural(snap.bodies.length)}
      </text>

      {spots.map((spot) => {
        const { body, r, reach, x, y } = spot;
        const name = displayName(body);
        const led = ledClass(snap.statuses[body.path]);
        return (
          <BodyGroup
            key={body.path}
            path={body.path}
            kind={body.kind}
            x={x}
            y={y}
            hitR={Math.max(r + 9, 12)}
            classes={bodyStateClasses(ctx, body, needle)}
            label={name}
            modifiedAt={body.modifiedAt}
            selected={snap.selected === body.path}
            live={live}
            on={on}
          >
            {body.kind === 'directory' ? (
              <Planet r={r} band={body.band} seed={body.path} uid={uid} lid={lid} />
            ) : body.kind === 'notebook' ? (
              <BrightBody r={r} band={body.band} uid={uid} />
            ) : (
              <Asteroid r={r} path={body.path} />
            )}
            {mode === 'cockpit' ? (
              <Contact
                h={reach + 5}
                arm={Math.max(4, r * 0.5)}
                bearing={bearingOf(x, y)}
                range={String(Math.round(Math.hypot(x, y)))}
              />
            ) : null}
            {led ? <circle className={`zoom-led ${led}`} cx={r1(r + 3)} cy={r1(-r - 3)} r="1.9" /> : null}
            <SelRing r={reach + 9} />
            {snap.selected === body.path && body.kind === 'directory' ? (
              <Preview
                entries={snap.childrenOf[body.path] ?? []}
                radius={reach}
                side={x >= 0 ? 1 : -1}
                now={now}
              />
            ) : null}
            <BodyLabel
              solved={solved}
              id={body.path}
              gap={reach + 10}
              text={name}
              kindClass={body.kind === 'directory' ? 'zoom-name' : 'zoom-leaf'}
            />
          </BodyGroup>
        );
      })}
    </>
  );
}

// ---- depth 3: moons ---------------------------------------------------------

function MoonsLevel(ctx: LevelCtx): ReactNode {
  const { snap, stage, spread, uid, lid, mode, live, now, on } = ctx;
  const R = stage.R;
  const needle = snap.query.trim().toLowerCase();
  const hostR = R * 0.26;
  const outpostR = R * 0.99 * spread;
  // Moons ride the band rings of their own annulus, clear of the host disc and
  // inside the outpost rim. The host keeps its size; only the rings travel.
  const place = annulus(R * spread, 0.45, 0.88);
  const radii = bandRadii(place);

  const moons = snap.bodies.filter((b) => b.kind !== 'directory');
  const subs = snap.bodies.filter((b) => b.kind === 'directory');
  // The host disc has no body of its own at this depth; it wears the band of
  // the freshest thing inside it, which is what the folder's own row says.
  const freshest = snap.bodies.reduce((best, b) => Math.max(best, b.modifiedAt), 0);
  const hostBand = bandFor(Math.max(0, now - freshest));

  const moonSpots = moons.map((body) => {
    const distance = place(body.orbit);
    const r =
      body.kind === 'notebook'
        ? R * 0.016 + sizeFactor(body) * R * 0.014
        : R * 0.01 + sizeFactor(body) * R * 0.011;
    return { body, r, x: Math.cos(body.phase) * distance, y: Math.sin(body.phase) * distance };
  });
  const subSpots = subs.map((body) => ({
    body,
    x: Math.cos(body.phase) * outpostR,
    y: Math.sin(body.phase) * outpostR,
  }));

  const obstacles: LabelObstacle[] = [
    { x: 0, y: 0, r: hostR + 6 },
    ...moonSpots.map((s) => ({ x: s.x, y: s.y, r: s.r + 4 })),
    ...subSpots.map((s) => ({ x: s.x, y: s.y, r: 14 })),
  ];
  // Outposts are the navigable things at this depth, so they claim labels
  // first; notebooks keep theirs; plain files only get one when it is quiet.
  const quiet = snap.bodies.length <= FILE_LABEL_BUDGET;
  const solved = solveLabels(
    [
      ...subSpots.map((s) => ({ id: s.body.path, x: s.x, y: s.y, text: `${displayName(s.body)} ›`, gap: 19 })),
      ...moonSpots
        .filter(
          (s) =>
            s.body.kind === 'notebook' ||
            quiet ||
            snap.selected === s.body.path ||
            snap.hovered === s.body.path,
        )
        .map((s) => ({ id: s.body.path, x: s.x, y: s.y, text: displayName(s.body), gap: s.r + 10 })),
    ],
    obstacles,
  );

  const byBand = new Map<Band, typeof moonSpots>();
  for (const spot of moonSpots) {
    const list = byBand.get(spot.body.band);
    if (list) list.push(spot);
    else byBand.set(spot.body.band, [spot]);
  }

  return (
    <>
      <Rings radii={radii} lid={lid} ticks={mode === 'cockpit'} captions={false} />
      <g className="zoom-rings" aria-hidden="true">
        <circle className="zoom-ring is-rim" r={r1(outpostR)} />
        {mode === 'cockpit' ? <path className="zoom-tick" d={tickPath(outpostR, 10, 5)} /> : null}
      </g>

      <g className="zoom-host" aria-hidden="true">
        <Planet r={hostR} band={hostBand} seed={`${snap.dir}#host`} uid={uid} lid={lid} />
      </g>
      <text className="zoom-label zoom-title zoom-mid" y="4">
        {snap.systemLabel}
      </text>
      <text className="zoom-label zoom-cap zoom-mid" y="20">
        {plural(snap.bodies.length)}
      </text>

      {ALL_BANDS.filter((band) => byBand.has(band)).map((band) => (
        <g key={band} className="zoom-orbit" data-period={MOON_PERIOD_S[band]}>
          {byBand.get(band)!.map((spot) => {
            const { body, r, x, y } = spot;
            const name = displayName(body);
            const led = ledClass(snap.statuses[body.path]);
            return (
              <BodyGroup
                key={body.path}
                path={body.path}
                kind={body.kind}
                x={x}
                y={y}
                hitR={Math.max(r + 9, 11)}
                classes={bodyStateClasses(ctx, body, needle)}
                label={name}
                modifiedAt={body.modifiedAt}
                selected={snap.selected === body.path}
                live={live}
                on={on}
              >
                {body.kind === 'notebook' ? (
                  <BrightBody r={r} band={body.band} uid={uid} />
                ) : (
                  <Asteroid r={r} path={body.path} />
                )}
                {led ? <circle className={`zoom-led ${led}`} cx={r1(r + 3)} cy={r1(-r - 3)} r="1.7" /> : null}
                <SelRing r={r + 9} />
                <BodyLabel solved={solved} id={body.path} gap={r + 10} text={name} kindClass="zoom-leaf" />
              </BodyGroup>
            );
          })}
        </g>
      ))}

      {subSpots.length > 0 ? (
        <g className="zoom-orbit" data-period={OUTPOST_PERIOD_S}>
          {subSpots.map((spot) => {
            const { body, x, y } = spot;
            const name = displayName(body);
            return (
              <BodyGroup
                key={body.path}
                path={body.path}
                kind={body.kind}
                x={x}
                y={y}
                hitR={18}
                classes={`is-outpost ${bodyStateClasses(ctx, body, needle)}`}
                label={name}
                modifiedAt={body.modifiedAt}
                selected={snap.selected === body.path}
                live={live}
                on={on}
              >
                <circle className="zoom-outpost-halo" r="15" />
                <polygon className="zoom-outpost" points={polygonPoints(6, 9)} />
                {mode === 'cockpit' ? (
                  <Contact h={14} arm={5} bearing={bearingOf(x, y)} range={String(Math.round(Math.hypot(x, y)))} />
                ) : null}
                <SelRing r={20} />
                {snap.selected === body.path ? (
                  <Preview entries={snap.childrenOf[body.path] ?? []} radius={16} side={x >= 0 ? 1 : -1} now={now} />
                ) : null}
                <BodyLabel solved={solved} id={body.path} gap={19} text={`${name} ›`} kindClass="zoom-name" />
              </BodyGroup>
            );
          })}
        </g>
      ) : null}
    </>
  );
}

// ---- depth 4+: the plain chart ----------------------------------------------

function ChartLevel(ctx: LevelCtx): ReactNode {
  const { snap, stage, spread, lid, live, on } = ctx;
  const R = stage.R;
  const needle = snap.query.trim().toLowerCase();

  // The plain chart is the orbital instrument: raw model orbits, no remapping
  // — and `SPREAD_BY_LEVEL` gives it 1, so the plate is exactly the stage.
  const place = annulus(R * spread, ORBIT_MIN, 1);
  const spots = snap.bodies.map((body) => {
    const distance = place(body.orbit);
    return { body, x: Math.cos(body.phase) * distance, y: Math.sin(body.phase) * distance };
  });
  const quiet = snap.bodies.length <= FILE_LABEL_BUDGET;
  const solved = solveLabels(
    spots
      .filter(
        (s) =>
          s.body.kind !== 'file' ||
          quiet ||
          snap.selected === s.body.path ||
          snap.hovered === s.body.path,
      )
      .map((s) => ({ id: s.body.path, x: s.x, y: s.y, text: displayName(s.body), gap: 11 })),
    [{ x: 0, y: 0, r: 26 }, ...spots.map((s) => ({ x: s.x, y: s.y, r: 7 }))],
  );

  return (
    <g className="zoom-plain">
      <Rings radii={bandRadii(place)} lid={lid} ticks={false} captions />
      <circle className="zoom-fb-core" r="7" />
      <text className="zoom-label zoom-name zoom-mid" y="26">
        {snap.systemLabel}
      </text>
      <text className="zoom-label zoom-note zoom-mid" y="42">
        {`${plural(snap.bodies.length)} · beyond depth 3 · chart view`}
      </text>
      {spots.map(({ body, x, y }) => {
        const name = displayName(body);
        return (
          <BodyGroup
            key={body.path}
            path={body.path}
            kind={body.kind}
            x={x}
            y={y}
            hitR={11}
            classes={bodyStateClasses(ctx, body, needle)}
            label={name}
            modifiedAt={body.modifiedAt}
            selected={snap.selected === body.path}
            live={live}
            on={on}
          >
            {body.kind === 'directory' ? (
              <circle className="zoom-fb-dir" r="5" />
            ) : body.kind === 'notebook' ? (
              <circle className="zoom-fb-dot" r="4.2" />
            ) : (
              <circle className="zoom-fb-file" r="2.8" />
            )}
            <SelRing r={10} />
            <BodyLabel
              solved={solved}
              id={body.path}
              gap={11}
              text={name}
              kindClass={body.kind === 'directory' ? 'zoom-name' : 'zoom-leaf'}
            />
          </BodyGroup>
        );
      })}
    </g>
  );
}

// ---- gradients --------------------------------------------------------------

/**
 * Gradients are the one place markup names a paint (`fill="url(#…)"`), so the
 * colours still come from CSS: every `<stop>` is a class, and the band class on
 * the gradient itself sets the `--zoom-band` those stops read.
 */
function Defs({ uid }: { uid: string }): ReactNode {
  return (
    <defs>
      {ALL_BANDS.map((band) => (
        <radialGradient key={`h-${band}`} id={`${uid}-halo-${band}`} className={`zoom-grad band-${band}`}>
          <stop className="zoom-halo-0" offset="0%" />
          <stop className="zoom-halo-1" offset="45%" />
          <stop className="zoom-halo-2" offset="100%" />
        </radialGradient>
      ))}
      {ALL_BANDS.map((band) => (
        <radialGradient
          key={`p-${band}`}
          id={`${uid}-pl-${band}`}
          className={`zoom-grad band-${band}`}
          cx="0.34"
          cy="0.3"
          r="0.82"
        >
          <stop className="zoom-pl-0" offset="0%" />
          <stop className="zoom-pl-1" offset="55%" />
          <stop className="zoom-pl-2" offset="100%" />
        </radialGradient>
      ))}
      <radialGradient id={`${uid}-terminator`} className="zoom-grad" cx="0.3" cy="0.26" r="0.84">
        <stop className="zoom-shade-0" offset="40%" />
        <stop className="zoom-shade-1" offset="78%" />
        <stop className="zoom-shade-2" offset="100%" />
      </radialGradient>
      <radialGradient id={`${uid}-starglow`} className="zoom-grad">
        <stop className="zoom-glow-0" offset="0%" />
        <stop className="zoom-glow-1" offset="28%" />
        <stop className="zoom-glow-2" offset="100%" />
      </radialGradient>
    </defs>
  );
}

// ---- the renderer -----------------------------------------------------------

function renderLevel(level: ZoomLevel, ctx: LevelCtx): ReactNode {
  if (level === 'galaxy') return GalaxyLevel(ctx);
  if (level === 'system') return SystemLevel(ctx);
  if (level === 'moons') return MoonsLevel(ctx);
  return ChartLevel(ctx);
}

interface Departing {
  snapshot: Snapshot;
  plan: FlyPlan;
}

function reflow(el: Element): void {
  void el.getBoundingClientRect();
}

export function ZoomMap(props: MapRendererProps): ReactNode {
  const { dir, bodies, childrenOf, descendants, statuses, selected, hovered, query } = props;
  const { themeMode, reduced, connected, anyBusy, systemLabel, onSelect, onHover, onOpen, onDive } = props;

  const rawId = useId();
  const uid = useMemo(() => `zm${rawId.replace(/:/g, '')}`, [rawId]);

  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const cameraRef = useRef<SVGGElement>(null);
  const layerRefs = useRef<(SVGGElement | null)[]>([null, null]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  /**
   * The host's size, kept true for the whole life of the component.
   *
   * The desktop app can mount this view inside a collapsed pane and expand it
   * later, so three things have to hold:
   *
   *   - every notification is acted on, including 0 → non-zero and the reverse.
   *     The observer is never disconnected outside unmount and a zero
   *     measurement is recorded like any other, never bailed out of;
   *   - the size is read from the host itself rather than from the entry, so a
   *     missing or stale `entries[0]` cannot decide what gets drawn;
   *   - while there is still no box to draw in, the host is re-read on the next
   *     frame. Chrome drops the remainder of a frame's resize notifications
   *     when it detects a ResizeObserver loop, which a pane-expand animation
   *     can provoke, and nothing else would ever notice the size arriving. The
   *     retry sets no state until it has a real measurement, and stops on it.
   */
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let raf = 0;

    function apply(w: number, h: number): void {
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    }

    function measure(): void {
      const box = host!.getBoundingClientRect();
      const w = Math.round(box.width);
      const h = Math.round(box.height);
      apply(w, h);
      if (w > 0 && h > 0) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        return;
      }
      if (raf) return;
      const retry = (): void => {
        const again = host!.getBoundingClientRect();
        if (again.width > 0 && again.height > 0) {
          raf = 0;
          apply(Math.round(again.width), Math.round(again.height));
          return;
        }
        raf = requestAnimationFrame(retry);
      };
      raf = requestAnimationFrame(retry);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(host);
    measure();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  const { w, h } = size;
  const stage = useMemo(() => stageFor(w, h), [w, h]);
  const level = levelFor(depthOf(dir));
  const spread = SPREAD_BY_LEVEL[level];

  const snapshot = useMemo<Snapshot>(
    () => ({
      dir,
      bodies,
      childrenOf,
      descendants,
      statuses,
      systemLabel,
      selected,
      hovered,
      query,
      connected,
      anyBusy,
    }),
    [
      dir,
      bodies,
      childrenOf,
      descendants,
      statuses,
      systemLabel,
      selected,
      hovered,
      query,
      connected,
      anyBusy,
    ],
  );

  // ---- the viewport ------------------------------------------------------
  // The user's window onto the plate, *outside* the fly camera: the two
  // transforms compose, and the fly-in arithmetic below never learns that
  // anything is panned or zoomed.
  const view = useMemo(() => ({ w, h }), [w, h]);
  const bounds = useMemo<Box>(() => {
    // The drawn level's extent: the spread annulus plus the room its labels
    // hang in, which is the same allowance `stageFor` leaves at the rim.
    const reach = stage.R * spread + RIM_PADDING;
    return { x: stage.cx - reach, y: stage.cy - reach, w: reach * 2, h: reach * 2 };
  }, [stage, spread]);
  const initial = useMemo(() => centerOn(stage.cx, stage.cy, view, 1), [stage, view]);
  const viewport = useViewport({ view, bounds, initial, resetKey: dir, reduced });
  const { bind, transform } = viewport;

  // ---- the camera --------------------------------------------------------
  // `cur` says which of the two layers is live. The other holds the level
  // being left behind, and only while a flight is running.
  const [cur, setCur] = useState(0);
  const [leaving, setLeaving] = useState<Departing | null>(null);
  const shownRef = useRef<Snapshot>(snapshot);
  /** Where we descended through, per depth, so a fly-out lands back on it. */
  const focusByDepth = useRef<Record<number, Point>>({});
  const nextFocus = useRef<Point | null>(null);

  const dive = useCallback(
    (path: string, focus: Point) => {
      nextFocus.current = { x: stage.cx + focus.x, y: stage.cy + focus.y };
      onDive(path);
    },
    [onDive, stage.cx, stage.cy],
  );

  const on: Handlers = useMemo(
    () => ({ select: onSelect, hover: onHover, open: onOpen, dive }),
    [onSelect, onHover, onOpen, dive],
  );

  // Start a flight whenever the directory under us changes. No dependency
  // array: `shownRef` must track the level actually on screen after every
  // commit, and the comparison below is what makes this cheap.
  useLayoutEffect(() => {
    const previous = shownRef.current;
    shownRef.current = snapshot;
    if (previous.dir === dir) return;

    const fromDepth = depthOf(previous.dir);
    const toDepth = depthOf(dir);
    const centre = { x: stage.cx, y: stage.cy };
    const focus =
      nextFocus.current ?? (toDepth < fromDepth ? focusByDepth.current[toDepth] : undefined) ?? centre;
    nextFocus.current = null;
    if (toDepth > fromDepth) focusByDepth.current[fromDepth] = focus;

    if (reduced) {
      setLeaving(null);
      return;
    }
    const plan = flyPlan(fromDepth, toDepth, focus);
    if (!plan) return;
    setLeaving({ snapshot: previous, plan });
    setCur((n) => 1 - n);
  });

  // Drive one flight: nest, zoom, cross-fade, then rebase. Both layers and the
  // camera are written imperatively — React owns neither the camera's style
  // nor a layer's `transform`, so nothing fights the transition.
  useLayoutEffect(() => {
    if (!leaving) return;
    const camera = cameraRef.current;
    const arriving = layerRefs.current[cur];
    const departing = layerRefs.current[1 - cur];
    if (!camera || !arriving || !departing) return;
    const { plan } = leaving;

    departing.setAttribute('transform', plan.leavingTransform);
    arriving.setAttribute('transform', plan.arrivingTransform);
    camera.style.transition = 'none';
    camera.style.transform = plan.cameraFrom;
    reflow(camera);
    camera.style.transition = '';
    camera.style.transform = plan.cameraTo;
    departing.classList.remove('is-live');
    arriving.classList.add('is-live');

    const timer = window.setTimeout(() => {
      // The rebase. `camera · nest` is the identity (camera.test.ts), so
      // dropping both at once cannot move a pixel.
      camera.style.transition = 'none';
      camera.style.transform = NO_TRANSFORM;
      departing.setAttribute('transform', '');
      arriving.setAttribute('transform', '');
      reflow(camera);
      camera.style.transition = '';
      setLeaving(null);
    }, REBASE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving, cur]);

  // At rest exactly one layer is live and nothing carries a transform. The
  // flight effect owns all of that while it runs, so this only asserts it on
  // mount, after a rebase, and on the reduced-motion path.
  useLayoutEffect(() => {
    if (leaving) return;
    const camera = cameraRef.current;
    if (camera) camera.style.transform = NO_TRANSFORM;
    layerRefs.current.forEach((layer, i) => {
      if (!layer) return;
      layer.classList.toggle('is-live', i === cur);
      layer.setAttribute('transform', '');
    });
  });

  // ---- ambient motion ----------------------------------------------------
  // Cockpit only: Night Ops kills CSS animations wholesale (theme/modes.css)
  // and the spec wants it calm anyway. One loop, transforms written straight
  // onto the elements, no React state per frame, stopped when the tab hides.
  // It runs inside the viewport group, so panning and zooming never disturb
  // it: the camera is not a dependency, and the plate below it is memoised.
  useEffect(() => {
    if (themeMode !== 'cockpit' || reduced) return;
    const svg = svgRef.current;
    if (!svg) return;
    const spins = Array.from(svg.querySelectorAll<SVGGElement>('.zoom-spin'));
    const orbits = Array.from(svg.querySelectorAll<SVGGElement>('.zoom-orbit')).map((ring) => ({
      ring,
      counters: Array.from(ring.querySelectorAll<SVGGElement>('.zoom-counter')),
    }));
    if (spins.length === 0 && orbits.length === 0) return;

    let raf = 0;
    let anchor = 0;

    function frame(nowMs: number): void {
      const t = (nowMs - anchor) / 1000;
      for (const spin of spins) {
        const period = Number(spin.dataset.period) || GALAXY_PERIOD_S;
        spin.setAttribute('transform', `rotate(${(((t / period) * 360) % 360).toFixed(3)})`);
      }
      for (const { ring, counters } of orbits) {
        const period = Number(ring.dataset.period) || OUTPOST_PERIOD_S;
        const angle = ((t / period) * 360) % 360;
        ring.setAttribute('transform', `rotate(${angle.toFixed(3)})`);
        for (const counter of counters) counter.setAttribute('transform', `rotate(${(-angle).toFixed(3)})`);
      }
      raf = requestAnimationFrame(frame);
    }

    function start(): void {
      if (document.visibilityState !== 'visible' || raf) return;
      anchor = performance.now();
      raf = requestAnimationFrame(frame);
    }
    function stop(): void {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }
    function onVisibility(): void {
      stop();
      start();
    }

    document.addEventListener('visibilitychange', onVisibility);
    start();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
      for (const spin of spins) spin.removeAttribute('transform');
      for (const { ring, counters } of orbits) {
        ring.removeAttribute('transform');
        for (const counter of counters) counter.removeAttribute('transform');
      }
    };
  }, [themeMode, reduced, level, dir, w, h, leaving]);

  // Keyboard selection moves DOM focus onto the body so Enter and the focus
  // ring follow it — but only when the map already had focus.
  useEffect(() => {
    if (!selected || leaving) return;
    const layer = layerRefs.current[cur];
    const host = hostRef.current;
    if (!layer || !host || !host.contains(document.activeElement)) return;
    const group = layer.querySelector<SVGGElement>(`[data-path="${CSS.escape(selected)}"]`);
    if (group && document.activeElement !== group) group.focus();
  }, [selected, cur, leaving]);

  function onBackgroundClick(event: ReactMouseEvent<SVGSVGElement>): void {
    if ((event.target as Element).closest('.zoom-body')) return;
    onSelect(null);
  }

  // The hook owns the `<svg>` (a native, non-passive wheel listener hangs off
  // it), and so does the ambient motion loop. One callback feeds both.
  const bindRef = bind.ref;
  const setSvg = useCallback(
    (el: SVGSVGElement | null) => {
      svgRef.current = el;
      bindRef(el);
    },
    [bindRef],
  );

  /**
   * Both level layers, memoised on everything except the camera.
   *
   * A drag re-renders this component on every frame, and a galaxy is an
   * O(n²) angular relaxation and a few thousand `<circle>`s. The camera only
   * ever writes one `transform` on the group above this, so the plate under it
   * must not be rebuilt underneath — which also keeps the cockpit loop's
   * element references, and the DOM focus the keyboard moved, alive across a
   * pan.
   */
  const slots = useMemo<(ReactNode | null)[]>(() => {
    const now = Date.now();
    const out: (ReactNode | null)[] = [null, null];
    const at = `translate(${r1(stage.cx)},${r1(stage.cy)})`;
    out[cur] = (
      <g className="zoom-system" transform={at}>
        {renderLevel(level, {
          snap: snapshot,
          stage,
          spread,
          uid,
          lid: `${uid}l${cur}`,
          mode: themeMode,
          live: true,
          now,
          on,
        })}
      </g>
    );
    if (leaving) {
      const from = levelFor(depthOf(leaving.snapshot.dir));
      out[1 - cur] = (
        <g className="zoom-system" transform={at}>
          {renderLevel(from, {
            snap: leaving.snapshot,
            stage,
            spread: SPREAD_BY_LEVEL[from],
            uid,
            lid: `${uid}l${1 - cur}`,
            mode: themeMode,
            live: false,
            now,
            on,
          })}
        </g>
      );
    }
    return out;
  }, [cur, leaving, level, on, snapshot, spread, stage, themeMode, uid]);

  return (
    <div className="zoom-map" ref={hostRef} data-level={level}>
      {/* The moment both axes are positive there is something to draw, so the
          SVG goes in on that commit — no second pass, no settling delay. */}
      {w > 0 && h > 0 ? (
        <svg
          {...bind}
          ref={setSvg}
          className="zoom-svg"
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          role="img"
          aria-label={`Workspace map, ${level} view of ${systemLabel}`}
          data-level={level}
          data-busy={anyBusy ? 'true' : 'false'}
          /* Labels are drawn in world units but must read at one size at every
             zoom, so `zoom.css` scales them back by this. */
          style={{ '--inv-k': (1 / viewport.camera.k).toFixed(4) } as CSSProperties}
          onClick={onBackgroundClick}
          onMouseLeave={() => onHover(null)}
        >
          <Defs uid={uid} />
          <g className="viewport" style={{ transform }}>
            <g className="zoom-camera" ref={cameraRef}>
              <g
                className="zoom-layer"
                ref={(el) => {
                  layerRefs.current[0] = el;
                }}
                aria-hidden={cur !== 0}
              >
                {slots[0]}
              </g>
              <g
                className="zoom-layer"
                ref={(el) => {
                  layerRefs.current[1] = el;
                }}
                aria-hidden={cur !== 1}
              >
                {slots[1]}
              </g>
            </g>
          </g>
        </svg>
      ) : null}
    </div>
  );
}

export default ZoomMap;

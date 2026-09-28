/**
 * The cartography renderer: Paper and Bridge.
 *
 * One SVG plate per system. `layout.ts` decides where everything goes and
 * `sigils.ts` decides what a world is made of; this file is composition,
 * interaction and the one frame loop. It never sets React state per frame and
 * it draws no colour: every fill, stroke and opacity is a class in
 * `cartography.css` keyed by `[data-mode]`, which is what lets the same
 * geometry read as a lit orrery in Bridge and an engraved plate in Paper. The
 * `url(#...)` gradient and pattern references are the one exception SVG
 * forces, exactly as `MapCanvas` takes it for its gradients.
 *
 * Selection is focus, per the contract in `renderer.ts`: a selected world
 * travels to the middle of the plate at 1.4x, everything else falls back to
 * 15%, and the world's children fan out as labelled moons. Selecting a child
 * keeps its parent focused and lights the moon.
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
} from 'react';

import { relativeTime } from '../../shell/recent';
import {
  displayName,
  formatBytes,
  hashString,
  type BodyInput,
  type BodyKind,
  type Placement,
} from '../model';
import type { MapRendererProps } from '../renderer';
import { useViewport } from '../useViewport';
import { centerOn } from '../viewport';
import {
  layoutCartography,
  moonFan,
  quadAngle,
  quadAt,
  worldCaption,
  type CourtNode,
  type MoteNode,
} from './layout';
import {
  orreryRunes,
  orreryTicks,
  paintedWorld,
  paperSigil,
  starSigil,
  terminatorPath,
  type Mark,
} from './sigils';
import './cartography.css';

/** How many runes ride the orrery ring. */
const RUNE_COUNT = 58;
/** One lap of a thread, for the travelling bead. */
const BEAD_MS = 11_000;
/** Moons a focused world fans out before it starts counting instead. */
const MOON_CAP = 10;
/**
 * How close to the edge a focused world's destination may land before the
 * camera goes after it. Wide enough that a body half off the stage counts as
 * off it, since its moons and captions reach further than the disc does.
 */
const FOCUS_MARGIN = 40;

type Vars = CSSProperties & Record<string, string | number>;

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** Folders first, then by name: the same order the explorer column lists. */
function moonOrder(a: BodyInput, b: BodyInput): number {
  const rank = (kind: BodyKind): number => (kind === 'directory' ? 0 : kind === 'notebook' ? 1 : 2);
  return rank(a.kind) - rank(b.kind) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

function renderMark(mark: Mark, key: number, uid: string) {
  const fill = mark.k !== 'line' && mark.fill ? `url(#${uid}-${mark.fill})` : undefined;
  if (mark.k === 'circle') {
    return <circle key={key} className={mark.cls} cx={mark.cx} cy={mark.cy} r={mark.r} fill={fill} />;
  }
  if (mark.k === 'ellipse') {
    return (
      <ellipse
        key={key}
        className={mark.cls}
        cx={mark.cx}
        cy={mark.cy}
        rx={mark.rx}
        ry={mark.ry}
        fill={fill}
        transform={mark.a ? `rotate(${mark.a} ${mark.cx} ${mark.cy})` : undefined}
      />
    );
  }
  if (mark.k === 'path') {
    return <path key={key} className={mark.cls} d={mark.d} fill={fill} />;
  }
  return <line key={key} className={mark.cls} x1={mark.x1} y1={mark.y1} x2={mark.x2} y2={mark.y2} />;
}

/** The hatch and stipple plates. Their strokes are classed, so tokens paint them. */
function Patterns({ uid }: { uid: string }) {
  return (
    <>
      <pattern id={`${uid}-hatch-a`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line className="ct-hatch" x1="0" y1="0" x2="0" y2="7" />
      </pattern>
      <pattern id={`${uid}-hatch-b`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line className="ct-hatch" x1="0" y1="0" x2="0" y2="4" />
      </pattern>
      <pattern id={`${uid}-hatch-c`} width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
        <line className="ct-hatch" x1="0" y1="0" x2="0" y2="3" />
      </pattern>
      <pattern id={`${uid}-cross`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
        <line className="ct-hatch" x1="0" y1="0" x2="0" y2="5" />
        <line className="ct-hatch" x1="0" y1="0" x2="5" y2="0" />
      </pattern>
      <pattern id={`${uid}-stipple`} width="5" height="5" patternUnits="userSpaceOnUse">
        <circle className="ct-dot" cx="1.4" cy="1.4" r="0.55" />
        <circle className="ct-dot" cx="3.9" cy="3.6" r="0.4" />
      </pattern>
      <pattern id={`${uid}-stipple-dense`} width="3.2" height="3.2" patternUnits="userSpaceOnUse">
        <circle className="ct-dot" cx="1" cy="1" r="0.6" />
        <circle className="ct-dot" cx="2.5" cy="2.4" r="0.5" />
      </pattern>
    </>
  );
}

/** Subsurface gradients for the five painted characters, plus the terminator. */
function Gradients({ uid }: { uid: string }) {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <radialGradient key={i} id={`${uid}-gs${i}`} cx="0.32" cy="0.26" r="0.92">
          <stop className={`ct-s${i}a`} offset="0" />
          <stop className={`ct-s${i}b`} offset="0.55" />
          <stop className={`ct-s${i}c`} offset="1" />
        </radialGradient>
      ))}
      <radialGradient id={`${uid}-term`} cx="0.3" cy="0.25" r="1.05">
        <stop className="ct-term-a" offset="0.3" />
        <stop className="ct-term-b" offset="1" />
      </radialGradient>
    </>
  );
}

export function CartographyMap(props: MapRendererProps) {
  const {
    dir,
    bodies,
    childrenOf,
    descendants,
    statuses,
    flightPath,
    selected,
    hovered,
    query,
    themeMode,
    reduced,
    connected,
    anyBusy,
    systemLabel,
    onSelect,
    onHover,
    onOpen,
    onDive,
  } = props;

  const paper = themeMode === 'paper';
  const rawId = useId();
  const uid = useMemo(() => `ct${rawId.replace(/:/g, '')}`, [rawId]);

  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  /**
   * The host's size, measured not assumed.
   *
   * Two rules here are load-bearing and easy to "tidy" into a bug. The
   * callback must write *every* measurement through, including 0x0: the
   * renderer can be mounted into a collapsed pane (the desktop app's browser
   * pane shut, a hidden tab) and the only signal that it is real again is the
   * 0 -> non-zero callback. And the observer must stay attached to a host
   * that renders unconditionally - only the `<svg>` is gated on `ready`, not
   * this div - so a zero measurement can never tear down the very thing that
   * would report the recovery. Verified: mounted with `.map-stage` display
   * none, the plate appears one frame after the style is removed.
   */
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

  // Last frame's label sides. `placeLabels` tries a remembered placement
  // first, which is what stops a label flipping sides the moment a folder
  // listing lands and changes its caption. Read during render, written after.
  const placementRef = useRef<Map<string, Placement>>(new Map());

  const plate = useMemo(
    () =>
      layoutCartography({
        width: size.w,
        height: size.h,
        bodies,
        descendants,
        flightPath,
        previousLabels: placementRef.current,
      }),
    [size.w, size.h, bodies, descendants, flightPath],
  );

  useLayoutEffect(() => {
    placementRef.current = plate.labels;
  }, [plate]);

  /**
   * The camera.
   *
   * The plate is now drawn `SPREAD_DEFAULT` times bigger than the host, so
   * the host is a window onto it rather than a frame around it. It opens with
   * the star centred at 1:1 and the rest of the plate running off the edges,
   * which is the whole point: you drag to find the outer worlds instead of
   * squinting at them. Diving changes `dir`, which re-opens the new system.
   */
  const initialCamera = useMemo(
    () => centerOn(plate.star.x, plate.star.y, size, 1),
    [plate.star.x, plate.star.y, size],
  );
  const viewport = useViewport({
    view: size,
    bounds: plate.bounds,
    initial: initialCamera,
    resetKey: dir,
    reduced,
  });
  /**
   * What a label is scaled by so it does not inflate with the zoom.
   *
   * Applied as an SVG `transform` attribute on a group anchored at the
   * label's own leader root, so the whole assembly - leader, terminal
   * square, both lines of type - keeps its shape and stays welded to the
   * body's rim at every zoom. Type that rides a `textPath` cannot be wrapped
   * like that, so the belt and guide captions take the same factor through
   * `--ct-inv-k`.
   *
   * Capped at 1 on purpose: zooming *in* holds a label at its pixel size (the
   * point - a 16 px name must not become a 48 px billboard over one world),
   * while zooming *out* lets it recede with the plate like every other mark.
   * Letting it grow past 1 would make a label claim more of the plate the
   * further out you went, which both crowds the picture and breaks `fit` -
   * `layout.bounds` reserves label room in plate units, and that reservation
   * is only honest while a label is no bigger than it was designed to be.
   * This is the same judgement `layout.ts`'s `TEXT_MIN` already makes.
   */
  const inv = Math.min(1, 1 / viewport.camera.k);

  // The frame loop reads the plate live rather than restarting on every
  // resize or selection.
  const plateRef = useRef(plate);
  plateRef.current = plate;

  const needle = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!needle) return null;
    const hit = new Set<string>();
    for (const body of bodies) {
      if (displayName(body).toLowerCase().includes(needle)) hit.add(body.path);
    }
    return hit;
  }, [bodies, needle]);

  // ---- selection is focus ---------------------------------------------------
  const focusWorld = useMemo(() => {
    if (!selected) return null;
    const direct = plate.worlds.find((world) => world.path === selected);
    if (direct) return direct;
    const parent = parentOf(selected);
    return plate.worlds.find((world) => world.path === parent) ?? null;
  }, [plate.worlds, selected]);

  const focusedMoon = focusWorld && selected !== focusWorld.path ? selected : null;

  /**
   * The camera follows the focus, but only when it has to.
   *
   * A selected world does not stay where it is: `.ct-slot.is-focused` carries
   * it to `plate.focus` at 1.4x and fans its moons there. On a plate that is
   * bigger than the stage, that destination is often somewhere you are not
   * looking, so selecting a world would move it out of sight - the one way
   * the camera made the map worse.
   *
   * So: if the destination is already on the stage, nothing moves (selecting
   * what you are looking at must not lurch the view). If it is not, the
   * camera glides to centre it at the *current* zoom - travelling, not
   * re-framing. Keyed on which world is focused, so hover never triggers it,
   * deselecting never triggers it, and a resize while something is selected
   * never triggers it; `dragging` is checked because a drag must never move
   * the camera by any route but the drag itself.
   */
  const focusPath = focusWorld?.path ?? null;
  const followRef = useRef({ camera: viewport.camera, dragging: viewport.dragging, size, focus: plate.focus });
  followRef.current = { camera: viewport.camera, dragging: viewport.dragging, size, focus: plate.focus };
  const followedRef = useRef<string | null>(null);
  const glideTo = viewport.glideTo;

  useEffect(() => {
    if (followedRef.current === focusPath) return;
    followedRef.current = focusPath;
    if (!focusPath) return;
    const { camera, dragging, size: view, focus } = followRef.current;
    if (dragging || view.w <= 0 || view.h <= 0) return;
    const sx = focus.x * camera.k + camera.x;
    const sy = focus.y * camera.k + camera.y;
    const onStage =
      sx >= FOCUS_MARGIN &&
      sx <= view.w - FOCUS_MARGIN &&
      sy >= FOCUS_MARGIN &&
      sy <= view.h - FOCUS_MARGIN;
    if (onStage) return;
    glideTo(focus.x, focus.y);
  }, [focusPath, glideTo]);

  const moons = useMemo(() => {
    if (!focusWorld) return null;
    const children = [...(childrenOf[focusWorld.path] ?? [])].sort(moonOrder);
    return moonFan(children, focusWorld.r, MOON_CAP);
  }, [childrenOf, focusWorld]);

  // ---- ambient motion: beads crawling the threads ---------------------------
  // The orrery's ten-minute turn, the dash flow and the core pulse are CSS
  // animations (and Paper kills animations wholesale in modes.css). A bead
  // walking a quadratic is the one thing CSS cannot express, so it gets the
  // frame loop - which writes transforms straight onto registered elements
  // and never touches React state.
  const beadRefs = useRef(new Map<string, SVGGElement>());
  const elapsedRef = useRef(0);

  useEffect(() => {
    if (themeMode !== 'bridge' || reduced) return;
    let raf = 0;
    let anchor = 0;

    const frame = (now: number): void => {
      elapsedRef.current = now - anchor;
      for (const connector of plateRef.current.connectors) {
        const el = beadRefs.current.get(connector.id);
        if (!el) continue;
        const phase = (hashString(connector.id) % 997) / 997;
        const t = (elapsedRef.current / BEAD_MS + phase) % 1;
        const point = quadAt(connector.p0, connector.c, connector.p1, t);
        const angle = quadAngle(connector.p0, connector.c, connector.p1, t);
        el.setAttribute(
          'transform',
          `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) rotate(${angle.toFixed(1)})`,
        );
      }
      raf = requestAnimationFrame(frame);
    };

    const start = (): void => {
      if (document.visibilityState !== 'visible') return;
      anchor = performance.now() - elapsedRef.current;
      raf = requestAnimationFrame(frame);
    };
    const stop = (): void => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = (): void => {
      stop();
      start();
    };

    document.addEventListener('visibilitychange', onVisibility);
    start();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [themeMode, reduced]);

  // ---- interaction ----------------------------------------------------------
  const activate = useCallback(
    (path: string, kind: BodyKind): void => {
      if (kind === 'directory') onDive(path);
      else onOpen(path, kind);
    },
    [onDive, onOpen],
  );

  const bodyKeys = useCallback(
    (path: string, kind: BodyKind) =>
      (event: ReactKeyboardEvent): void => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          activate(path, kind);
        } else if (event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          onSelect(path);
        }
      },
    [activate, onSelect],
  );

  const onBackgroundClick = useCallback(
    (event: ReactMouseEvent): void => {
      if ((event.target as Element).closest('.ct-hit')) return;
      onSelect(null);
    },
    [onSelect],
  );

  const stateClass = useCallback(
    (path: string): string => {
      const status = statuses[path];
      return [
        status?.open ? 'is-open' : '',
        status?.active ? 'is-active' : '',
        status?.dirty ? 'is-dirty' : '',
        status?.kernel === 'busy' || status?.kernel === 'restarting' ? 'is-busy' : '',
        status && status.errors > 0 ? 'is-error' : '',
        selected === path ? 'is-selected' : '',
        hovered === path ? 'is-hovered' : '',
        matches ? (matches.has(path) ? 'match' : 'dim') : '',
      ]
        .filter(Boolean)
        .join(' ');
    },
    [hovered, matches, selected, statuses],
  );

  const { star, worlds, court, motes, belt, connectors, guides, labels } = plate;
  const runes = useMemo(() => orreryRunes(dir, star.orreryR, RUNE_COUNT), [dir, star.orreryR]);
  const ticks = useMemo(() => orreryTicks(star.orreryR + 12, RUNE_COUNT, 4), [star.orreryR]);
  const sigil = useMemo(() => starSigil(star.r), [star.r]);
  const ready = size.w > 0 && size.h > 0;

  const plateClass = [
    'ct-plate',
    focusWorld ? 'has-focus' : '',
    matches ? 'is-filtering' : '',
    anyBusy ? 'is-busy' : '',
    connected ? '' : 'is-offline',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="ct-host" ref={hostRef}>
      {ready && (
        <svg
          className={plateClass}
          style={{ '--ct-k': plate.textScale, '--ct-inv-k': inv } as Vars}
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${size.w} ${size.h}`}
          role="group"
          aria-label={`${systemLabel}, ${bodies.length} bodies`}
          onClick={onBackgroundClick}
          {...viewport.bind}
        >
          <defs>
            <Patterns uid={uid} />
            {!paper && <Gradients uid={uid} />}
            {worlds.map((world) => (
              <clipPath key={world.path} id={`${uid}-clip-${hashString(world.path)}`}>
                <circle r={world.r} />
              </clipPath>
            ))}
            <path id={`${uid}-belt`} d={belt.d} />
            <path id={`${uid}-belt-cap`} d={belt.capD} />
            {guides.map((guide) => (
              <path key={guide.id} id={`${uid}-guide-${guide.id}`} d={guide.d} />
            ))}
          </defs>

          {/* Everything drawn rides the camera. `transform-origin: 0 0` in
              the stylesheet is what makes one plate unit one CSS pixel
              before the scale, so `viewport.ts`'s contract holds verbatim. */}
          <g className="viewport" style={{ transform: viewport.transform }}>
          {/* ---- guides: recency arcs and the ornamental meridian ---- */}
          <g className="ct-bg ct-guides">
            {guides.map((guide) => (
              <g key={guide.id}>
                <use
                  className={guide.meridian ? 'ct-guide-arc ct-meridian' : 'ct-guide-arc'}
                  href={`#${uid}-guide-${guide.id}`}
                />
                {guide.ticks.map((tick, i) => (
                  <line key={i} className="ct-guide-tick" x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} />
                ))}
                {guide.arrows.map((arrow, i) => (
                  <path
                    key={i}
                    className="ct-dir-tick"
                    transform={`translate(${arrow.x} ${arrow.y}) rotate(${arrow.angle})`}
                    d="M-4 2.6L0 -2.6L4 2.6"
                  />
                ))}
                {guide.label && (
                  <text className="ct-guide-cap">
                    <textPath href={`#${uid}-guide-${guide.id}`} startOffset="4%">
                      {guide.label}
                    </textPath>
                  </text>
                )}
              </g>
            ))}
          </g>

          {/* ---- the orrery: a ring of runes, one turn per ten minutes ---- */}
          <g
            className="ct-bg ct-orrery"
            style={{ transformOrigin: `${star.x}px ${star.y}px` } as CSSProperties}
          >
            <circle className="ct-orrery-ring" cx={star.x} cy={star.y} r={star.orreryR - 12} />
            <circle className="ct-orrery-ring" cx={star.x} cy={star.y} r={star.orreryR + 12} />
            <g transform={`translate(${star.x} ${star.y})`}>
              {runes.map((rune, i) => (
                <path
                  key={i}
                  className="ct-rune"
                  transform={`translate(${rune.x} ${rune.y}) rotate(${rune.angle})`}
                  d={rune.d}
                />
              ))}
              {ticks.map((tick, i) => (
                <line key={i} className="ct-orrery-tick" x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} />
              ))}
            </g>
          </g>

          {/* ---- threads of light, with beads and a direction tick ---- */}
          <g className="ct-bg ct-threads">
            {connectors.map((connector) => (
              <g key={connector.id} className={`ct-thread t-${connector.kind}`}>
                <path className="ct-thread-core" d={connector.d} />
                <path className="ct-thread-flow" d={connector.d} />
                {connector.beads.map((bead, i) => (
                  <g key={i} className="ct-bead-g" transform={`translate(${bead.x} ${bead.y}) rotate(${bead.angle})`}>
                    <path className="ct-bead" d="M0 -4.4L3.4 0L0 4.4L-3.4 0Z" />
                    <path className="ct-bead" d="M-6 -2.6V2.6M6 -2.6V2.6" />
                    <circle className="ct-bead-dot" r={1.25} />
                  </g>
                ))}
                <g
                  className="ct-bead-g ct-bead-run"
                  ref={(el) => {
                    if (el) beadRefs.current.set(connector.id, el);
                    else beadRefs.current.delete(connector.id);
                  }}
                  transform={`translate(${connector.beads[0].x} ${connector.beads[0].y})`}
                >
                  <circle className="ct-bead-dot" r={1.9} />
                </g>
                <g
                  className="ct-tick-g"
                  transform={`translate(${connector.tick.x} ${connector.tick.y}) rotate(${connector.tick.angle})`}
                >
                  <path className="ct-dir-tick" d="M-3.6 -4.6L3 0L-3.6 4.6" />
                </g>
              </g>
            ))}
          </g>

          {/* ---- the drift belt and its motes ---- */}
          <g className="ct-bg ct-belt">
            <use className="ct-belt-path" href={`#${uid}-belt`} />
            {motes.length > 0 && (
              <text className="ct-belt-cap">
                <textPath href={`#${uid}-belt-cap`} startOffset="46%">
                  {`drift belt · ${motes.length} loose file${motes.length === 1 ? '' : 's'}`}
                </textPath>
              </text>
            )}
            {motes.map((mote) => (
              <Mote key={mote.path} mote={mote} cls={stateClass(mote.path)} onSelect={onSelect} onHover={onHover} onOpen={onOpen} />
            ))}
          </g>

          {/* ---- the star sigil ---- */}
          <g className="ct-bg ct-star" transform={`translate(${star.x} ${star.y})`}>
            {sigil.rings.map((ring, i) => (
              <circle key={i} className={ring.dashed ? 'ct-star-ring is-dashed' : 'ct-star-ring'} r={ring.r} />
            ))}
            {sigil.rays.map((ray, i) => (
              <line
                key={i}
                className={ray.long ? 'ct-star-ray is-long' : 'ct-star-ray'}
                x1={ray.x1}
                y1={ray.y1}
                x2={ray.x2}
                y2={ray.y2}
              />
            ))}
            <path className="ct-star-glyph" d={sigil.glyph} />
            <circle className="ct-star-core" r={sigil.coreR} />
            <g transform={`translate(0 ${star.r}) scale(${inv})`}>
              <text className="ct-star-name" y={26}>
                {systemLabel}
              </text>
              <text className="ct-star-sub" y={42}>
                {`${dir === '' ? 'root' : 'system'} · ${bodies.length} bodies`}
              </text>
            </g>
          </g>

          {/* ---- the inner court: root notebooks ---- */}
          <g className="ct-bg ct-court">
            {court.map((node) => (
              <CourtBody
                key={node.path}
                node={node}
                cls={stateClass(node.path)}
                placement={labels.get(node.path)}
                starX={star.x}
                inv={inv}
                onSelect={onSelect}
                onHover={onHover}
                onKeyDown={bodyKeys(node.path, node.body.kind)}
                onOpen={onOpen}
              />
            ))}
          </g>

          {/* ---- the worlds ---- */}
          <g className="ct-worlds">
            {worlds.map((world) => {
              const isFocused = focusWorld?.path === world.path;
              const placement = labels.get(world.path);
              const side = placement?.side ?? 'right';
              const dy = (placement?.dy ?? 0) * 35.7 * plate.textScale;
              const sx = side === 'right' ? 1 : -1;
              const caption = `${worldCaption(world.count)} · changed ${relativeTime(world.body.modifiedAt)}`;
              /** Where the leader leaves the rim, and where it ends. */
              const root = sx * world.r * 0.92;
              const tip = sx * (world.r + 11);
              const painted = paper ? null : paintedWorld(world.label, world.r);
              const drawn = paper ? paperSigil(world.label, world.r - 3) : null;
              const clip = `url(#${uid}-clip-${hashString(world.path)})`;

              return (
                <g
                  key={world.path}
                  // The character class lives on the slot, not the world: the
                  // moon ring is a sibling of the world group and its paint
                  // is mixed from the same `--wr` rim colour.
                  className={`ct-slot ct-c${painted?.index ?? drawn?.index ?? 0}${isFocused ? ' is-focused' : ''}`}
                  style={
                    {
                      '--ox': `${world.x}px`,
                      '--oy': `${world.y}px`,
                      '--fx': `${world.focus.dx}px`,
                      '--fy': `${world.focus.dy}px`,
                    } as Vars
                  }
                >
                  <g
                    className={`ct-world ct-hit ${stateClass(world.path)}`}
                    transform={`translate(${world.x} ${world.y})`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${world.label}, folder, ${caption}`}
                    aria-pressed={selected === world.path}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(world.path);
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      onDive(world.path);
                    }}
                    onKeyDown={bodyKeys(world.path, 'directory')}
                    onPointerEnter={() => onHover(world.path)}
                    onPointerLeave={() => onHover(null)}
                    onFocus={() => onHover(world.path)}
                    onBlur={() => onHover(null)}
                  >
                    <circle className="ct-hit-disc" r={world.r + 6} />

                    {painted?.ringed && (
                      <g className="ct-w-rings" transform="rotate(-19)">
                        <ellipse className="ct-w-ring" rx={painted.ringRx} ry={painted.ringRy} />
                        <ellipse className="ct-w-ring" rx={painted.ringRx * 0.83} ry={painted.ringRy * 0.83} />
                      </g>
                    )}
                    {painted && <circle className="ct-w-atmo" r={world.r * 1.3} />}

                    <g clipPath={clip}>
                      <circle
                        className="ct-w-base"
                        r={world.r}
                        fill={painted ? `url(#${uid}-gs${painted.index})` : undefined}
                      />
                      {painted ? (
                        <>
                          <g transform={`rotate(${painted.tilt})`}>
                            {painted.marks.map((mark, i) => renderMark(mark, i, uid))}
                          </g>
                          <circle className="ct-w-term" r={world.r} fill={`url(#${uid}-term)`} />
                          <path className="ct-w-term-c" d={terminatorPath(world.r)} />
                        </>
                      ) : (
                        drawn && (
                          <g transform={`rotate(${drawn.tilt})`}>
                            {drawn.marks.map((mark, i) => renderMark(mark, i, uid))}
                          </g>
                        )
                      )}
                    </g>

                    <circle className="ct-w-rim" r={world.r} />
                    {painted?.ringed && (
                      <g className="ct-w-rings" transform="rotate(-19)">
                        <path
                          className="ct-w-ringfront"
                          d={`M${-painted.ringRx} 0A${painted.ringRx} ${painted.ringRy} 0 0 0 ${painted.ringRx} 0`}
                        />
                      </g>
                    )}

                    {/* The label hangs off the rim and is drawn at a
                        constant size on screen: the outer group carries it
                        to the leader root in plate units, the inner one
                        undoes the camera's zoom about that same point. */}
                    <g className="ct-w-label" transform={`translate(${root} 0)`}>
                      <g transform={`scale(${inv})`}>
                        <path className="ct-w-lead" d={`M0 ${dy * 0.35}L${tip - root} ${dy}`} />
                        <rect
                          className="ct-w-sq"
                          x={tip - root - 2.6}
                          y={dy - 2.6}
                          width={5.2}
                          height={5.2}
                        />
                        <text
                          className="ct-w-name"
                          x={sx * (world.r + 17) - root}
                          y={dy - 2}
                          textAnchor={side === 'right' ? 'start' : 'end'}
                        >
                          {world.label}
                        </text>
                        <text
                          className="ct-w-cap"
                          x={sx * (world.r + 17) - root}
                          y={dy + 14}
                          textAnchor={side === 'right' ? 'start' : 'end'}
                        >
                          {caption}
                        </text>
                      </g>
                    </g>
                  </g>

                  {isFocused && moons && (
                    <g className="ct-moons" transform={`translate(${world.x} ${world.y})`}>
                      <circle className="ct-moon-orbit" r={moons.orbitR} />
                      {moons.moons.map((moon) => (
                        <g
                          key={moon.path}
                          className={`ct-moon ct-hit m-${moon.kind}${focusedMoon === moon.path ? ' is-selected' : ''}`}
                          role="button"
                          tabIndex={0}
                          aria-label={`${moon.label}, ${moon.kind}`}
                          aria-pressed={focusedMoon === moon.path}
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelect(moon.path);
                          }}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            activate(moon.path, moon.kind);
                          }}
                          onKeyDown={bodyKeys(moon.path, moon.kind)}
                          onPointerEnter={() => onHover(moon.path)}
                          onPointerLeave={() => onHover(null)}
                        >
                          <line className="ct-moon-lead" x1={moon.x} y1={moon.y} x2={moon.lx} y2={moon.ly} />
                          <circle className="ct-moon-dot" cx={moon.x} cy={moon.y} r={moon.r} />
                          {/* The lead stays in plate units so it keeps
                              touching its dot; only the caption is pinned
                              to a constant size, about the lead's end. */}
                          <g transform={`translate(${moon.lx} ${moon.ly}) scale(${inv})`}>
                            <text
                              className="ct-moon-label"
                              x={moon.anchor === 'start' ? 4 : -4}
                              textAnchor={moon.anchor}
                              dominantBaseline="middle"
                            >
                              {moon.label}
                            </text>
                          </g>
                        </g>
                      ))}
                      {moons.extra > 0 && (
                        <g transform={`translate(0 ${moons.orbitR}) scale(${inv})`}>
                          <text className="ct-moon-label ct-moon-more" y={28} textAnchor="middle">
                            {`+${moons.extra} more`}
                          </text>
                        </g>
                      )}
                    </g>
                  )}
                </g>
              );
            })}
          </g>
          </g>
        </svg>
      )}
    </div>
  );
}

/**
 * A root notebook in the star's court. Its caption is side-placed by
 * `placeLabels` when the plate gave it one of the court's label slots, and
 * otherwise drawn at zero opacity on its natural side - so hovering or
 * selecting reveals a name without the plate having to re-solve anything.
 */
function CourtBody({
  node,
  cls,
  placement,
  starX,
  inv,
  onSelect,
  onHover,
  onOpen,
  onKeyDown,
}: {
  node: CourtNode;
  cls: string;
  placement: Placement | undefined;
  starX: number;
  /** 1 / camera zoom: what keeps the caption the same size on screen. */
  inv: number;
  onSelect(path: string | null): void;
  onHover(path: string | null): void;
  onOpen(path: string, kind: BodyKind): void;
  onKeyDown(event: ReactKeyboardEvent): void;
}) {
  const side = placement?.side ?? (node.x >= starX ? 'right' : 'left');
  const dy = (placement?.dy ?? 0) * 17;
  const sx = side === 'right' ? 1 : -1;
  const tip = node.r + 9;
  const root = sx * (node.r + 1.5);
  return (
    <g
      className={`ct-nb ct-hit band-${node.body.band}${node.labelled ? ' is-labelled' : ''} ${cls}`}
      role="button"
      tabIndex={0}
      aria-label={`${node.label}, notebook, modified ${relativeTime(node.body.modifiedAt)}`}
      aria-pressed={cls.includes('is-selected')}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(node.path);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onOpen(node.path, node.body.kind);
      }}
      onKeyDown={onKeyDown}
      onPointerEnter={() => onHover(node.path)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(node.path)}
      onBlur={() => onHover(null)}
    >
      <circle className="ct-hit-disc" cx={node.x} cy={node.y} r={Math.max(node.r + 7, 13)} />
      <circle className="ct-nb-halo" cx={node.x} cy={node.y} r={node.r + 5} />
      <circle className="ct-nb-halo is-second" cx={node.x} cy={node.y} r={node.r + 9.5} />
      <circle className="ct-nb-body" cx={node.x} cy={node.y} r={node.r} />
      {/* Same trick as a world's label: anchored at the leader root on the
          body's rim, then un-zoomed about that point. */}
      <g className="ct-nb-cap" transform={`translate(${node.x + root} ${node.y})`}>
        <g transform={`scale(${inv})`}>
          <path className="ct-nb-lead" d={`M0 ${dy * 0.3}L${sx * tip - root} ${dy}`} />
          <rect
            className="ct-nb-term"
            x={sx * tip - root - 2.1}
            y={dy - 2.1}
            width={4.2}
            height={4.2}
          />
          <text
            className="ct-nb-label"
            x={sx * (tip + 5) - root}
            y={dy + 3.5}
            textAnchor={side === 'right' ? 'start' : 'end'}
          >
            {node.label}
          </text>
        </g>
      </g>
    </g>
  );
}

function Mote({
  mote,
  cls,
  onSelect,
  onHover,
  onOpen,
}: {
  mote: MoteNode;
  cls: string;
  onSelect(path: string | null): void;
  onHover(path: string | null): void;
  onOpen(path: string, kind: BodyKind): void;
}) {
  return (
    <g
      className={`ct-mote-g ct-hit ${cls}`}
      role="button"
      tabIndex={0}
      aria-label={`${mote.label}, file, ${formatBytes(mote.body.bytes ?? 0)}`}
      aria-pressed={cls.includes('is-selected')}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(mote.path);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onOpen(mote.path, mote.body.kind);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        onOpen(mote.path, mote.body.kind);
      }}
      onPointerEnter={() => onHover(mote.path)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(mote.path)}
      onBlur={() => onHover(null)}
    >
      <circle className="ct-hit-disc" cx={mote.x} cy={mote.y} r={Math.max(mote.r + 6, 11)} />
      <line className="ct-belt-tick" x1={mote.x} y1={mote.y - 6} x2={mote.x} y2={mote.y - 11} />
      <circle
        className={`ct-mote${mote.body.band === 'older' ? ' is-derelict' : ''}`}
        cx={mote.x}
        cy={mote.y}
        r={mote.r}
      />
      <title>{mote.label}</title>
    </g>
  );
}

export default CartographyMap;

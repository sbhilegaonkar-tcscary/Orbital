/**
 * The renderer seam for the Map view (M8.5, "one map per mode").
 *
 * `views/MapView.tsx` owns data, selection and the explorer column; a
 * renderer owns only what is drawn in the stage. Which renderer draws is a
 * function of the theme mode (`rendererForMode`): by default Paper and Bridge
 * get the cartography method (worlds, connectors, an orrery ring; painted
 * planets in Bridge, abstract sigils in Paper), Night Ops and Cockpit get the
 * zoom method (galaxy → system → moons, then the plain chart beyond depth 3).
 * The owner can override any mode's style from Settings
 * (`map/store.ts`'s `methodByMode`); the third style, chart, is the original
 * orbital chart (`MapCanvas`'s `ChartMap`) — rings by recency, with its own
 * Chart/Orbit setting.
 *
 * Renderers never touch the stores. Everything they need arrives as props;
 * everything they decide goes back through the callbacks. This is what lets
 * every renderer be built and tested in isolation against one fixture.
 */
import type { Mode } from '../theme/tokens';
import type { Body, BodyInput, BodyKind } from './model';
import type { BodyStatus } from './store';

export type MapMethod = 'cartography' | 'zoom' | 'chart';

/** Paper and Bridge draw charts; Night Ops and Cockpit fly — unless `override` pins this mode to something else. */
export function rendererForMode(mode: Mode, override?: Partial<Record<Mode, MapMethod>>): MapMethod {
  const fallback: MapMethod = mode === 'paper' || mode === 'bridge' ? 'cartography' : 'zoom';
  return override?.[mode] ?? fallback;
}

/** The three map styles, for Settings' per-mode pickers. */
export const MAP_METHODS: { id: MapMethod; label: string; blurb: string }[] = [
  { id: 'cartography', label: 'Cartography', blurb: 'worlds, threads and an orrery ring' },
  { id: 'zoom', label: 'Zoom', blurb: 'galaxy, system, moons; fly in and out' },
  { id: 'chart', label: 'Chart', blurb: 'the orbital chart: rings by recency, Chart or Orbit' },
];

export interface MapRendererProps {
  /** The system on screen; '' is the workspace root. */
  dir: string;
  /** Bodies of `dir`, laid out by `model.layoutSystem` (a renderer may ignore `orbit`/`phase`). */
  bodies: Body[];
  /**
   * Cached listings for the folder bodies in this system, keyed by folder
   * path, already filtered for hidden entries. Missing key = not loaded yet.
   * Cartography fans these out as moons when a world is selected; zoom draws
   * them as the cluster's stars and as the next depth's bodies.
   */
  childrenOf: Record<string, BodyInput[]>;
  /**
   * Known descendant counts per folder path (every cached level below it).
   * Partial by nature: it grows as listings arrive. Absent = unknown.
   */
  descendants: Record<string, number>;
  statuses: Record<string, BodyStatus>;
  /** Recent notebooks in this system, newest first. */
  flightPath: string[];
  selected: string | null;
  hovered: string | null;
  /** Filter text; non-matching bodies dim, matching ones light up. */
  query: string;
  themeMode: Mode;
  reduced: boolean;
  connected: boolean;
  anyBusy: boolean;
  /** Basename of `dir`, or "workspace" at the root. */
  systemLabel: string;

  /** Single click, or keyboard focus + Space: select (the explorer follows). `null` clears. */
  onSelect(path: string | null): void;
  onHover(path: string | null): void;
  /** Double click or Enter on a notebook/file. */
  onOpen(path: string, kind: BodyKind): void;
  /** Double click or Enter on a folder: it becomes the system on screen. */
  onDive(dir: string): void;
}

/**
 * The rule every renderer follows so the map and the explorer never
 * disagree:
 *
 * - click a body → `onSelect(path)`; click empty stage → `onSelect(null)`
 * - double-click / Enter on a notebook or file → `onOpen`
 * - double-click / Enter on a folder → `onDive`
 * - a selected folder is the renderer's "focused" body (cartography fans its
 *   children out as moons; zoom brightens the cluster) — selection IS focus
 * - Esc is handled by the view, not the renderer
 */
export const RENDERER_INTERACTION_RULE = 'select-then-open-or-dive' as const;

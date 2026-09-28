/**
 * Map state and the derived hooks the view renders from.
 *
 * The store itself is small and serializable (which system you are looking
 * at, which presentation you pinned, what is selected). Everything expensive
 * — turning a directory listing into a laid-out system, collecting live
 * kernel/dirty/open state, deriving the flight path — is a hook that memoizes
 * off the stores that already own that data. The map never copies state it
 * does not own.
 *
 * `setMapFixture` is the one seam that lets `?fixture=1` render a full system
 * with no server behind it, for design review and screenshots.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { KernelStatus } from '../session/types';
import type { Mode } from '../theme/tokens';
import { useThemeStore } from '../theme/ThemeProvider';
import { useSessionStore } from '../session/store';
import { useNotebookStore } from '../notebook/store';
import { useFilesStore } from '../files/store';
import { useTabsStore } from '../shell/tabs';
import { useRecent } from '../shell/recent';
import { entriesToBodyInputs, layoutSystem, type Body, type BodyInput, type BodyKind } from './model';
import { rendererForMode, type MapMethod } from './renderer';

export type MapMode = 'chart' | 'orbit';

export interface MapState {
  /** The system on screen; '' is the workspace root. */
  dir: string;
  /** null follows the theme mode (see `effectiveMapMode`). */
  mode: MapMode | null;
  /** Per-mode map style override; a mode absent here follows `rendererForMode`'s default. */
  methodByMode: Partial<Record<Mode, MapMethod>>;
  showHidden: boolean;
  /** Body path, or null. Survives hover; cleared by Esc or an empty click. */
  selected: string | null;
  hovered: string | null;
  /** Filter text; drives `.match` / `.dim` and the sector scan. */
  query: string;

  /**
   * Camera requests.
   *
   * The camera lives inside whichever renderer is mounted (`map/useViewport`),
   * so the Map view's keyboard and the HUD's buttons cannot call it directly.
   * They bump a nonce instead and the hook, which subscribes to these, acts.
   * None of it is persisted: a camera is a thing you are doing, not a setting.
   */
  viewportNonce: number;
  resetNonce: number;
  zoomNonce: number;
  /** Which way the last `requestZoom` asked to go. */
  zoomDirection: 1 | -1;
  /** A pan in screen pixels, applied to the camera offset. */
  panRequest: { nonce: number; dx: number; dy: number };

  /** Fit the whole plate in the stage. */
  requestFit(): void;
  /** Back to the camera the renderer opens on. */
  requestReset(): void;
  requestZoom(direction: 1 | -1): void;
  requestPan(dx: number, dy: number): void;

  dive(dir: string): void;
  up(): void;
  setMode(mode: MapMode | null): void;
  /** Flips relative to the EFFECTIVE mode and pins the result. */
  toggleMode(): void;
  /** null clears the override, so the mode falls back to `rendererForMode`'s default. */
  setMethodForMode(mode: Mode, method: MapMethod | null): void;
  setShowHidden(v: boolean): void;
  select(path: string | null): void;
  hover(path: string | null): void;
  setQuery(q: string): void;
  open(path: string, kind: BodyKind): void;
}

interface PersistedMapState {
  mode: MapMode | null;
  methodByMode: Partial<Record<Mode, MapMethod>>;
  showHidden: boolean;
  dir: string;
}

/** How many uncached child directories one level is allowed to prefetch. */
const PREFETCH_LIMIT = 24;
/** How often the current system re-lists itself while the map is mounted. */
const REFRESH_MS = 30_000;
/** Stable identity for "no bodies", so consumers' memos do not churn. */
const NO_BODIES: Body[] = [];
/** Same, for a folder that has nothing cached yet. */
const NO_ENTRIES: BodyInput[] = [];

/** `''` for a root-level path, else everything before the last `/`. */
function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/**
 * One folder of a fixture tree, dotfile-filtered — the pure half of every
 * hook's `?fixture=1` path (a fixture arrives as `BodyInput`s already, so
 * there is no `entriesToBodyInputs` step). An unlisted folder is an empty one:
 * callers that must tell "empty" from "not cached" test the tree for the key
 * themselves, because a fixture is never partially loaded.
 */
export function fixtureListing(
  tree: Record<string, BodyInput[]>,
  path: string,
  showHidden: boolean,
): BodyInput[] {
  const inputs = tree[path];
  if (!inputs) return NO_ENTRIES;
  return showHidden ? inputs : inputs.filter((i) => !i.name.startsWith('.'));
}

// ---- fixture seam ----------------------------------------------------------

const NO_STATUSES: Record<string, Partial<BodyStatus>> = {};

let fixtureTree: Record<string, BodyInput[]> | null = null;
let fixtureStatuses: Record<string, Partial<BodyStatus>> = NO_STATUSES;
const fixtureListeners = new Set<() => void>();

/** Fixture seam: when set, `useSystemBodies` reads from this tree instead of the files store. */
export function setMapFixture(
  tree: Record<string, BodyInput[]> | null,
  statuses?: Record<string, Partial<BodyStatus>>,
): void {
  fixtureTree = tree;
  fixtureStatuses = tree ? (statuses ?? NO_STATUSES) : NO_STATUSES;
  for (const listener of fixtureListeners) listener();
}

/** The active fixture tree, or null. Non-reactive; hooks use `useFixtureTree`. */
export function getMapFixture(): Record<string, BodyInput[]> | null {
  return fixtureTree;
}

function subscribeFixture(onChange: () => void): () => void {
  fixtureListeners.add(onChange);
  return () => {
    fixtureListeners.delete(onChange);
  };
}

function readFixtureTree(): Record<string, BodyInput[]> | null {
  return fixtureTree;
}

function readFixtureStatuses(): Record<string, Partial<BodyStatus>> {
  return fixtureStatuses;
}

function useFixtureTree(): Record<string, BodyInput[]> | null {
  return useSyncExternalStore(subscribeFixture, readFixtureTree, readFixtureTree);
}

function useFixtureStatuses(): Record<string, Partial<BodyStatus>> {
  return useSyncExternalStore(subscribeFixture, readFixtureStatuses, readFixtureStatuses);
}

// ---- the store -------------------------------------------------------------

/**
 * `localStorage` is absent in the vitest node environment and throws in
 * private mode, so persistence falls back to a per-process map rather than
 * letting zustand warn on every import.
 */
const memoryStore = new Map<string, string>();

const mapStorage = createJSONStorage<PersistedMapState>(() => {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // Safari private mode throws on access rather than returning undefined.
  }
  return {
    getItem: (name: string) => memoryStore.get(name) ?? null,
    setItem: (name: string, value: string) => {
      memoryStore.set(name, value);
    },
    removeItem: (name: string) => {
      memoryStore.delete(name);
    },
  };
});

export const useMapStore = create<MapState>()(
  persist(
    (set, get) => ({
      dir: '',
      mode: null,
      methodByMode: {},
      showHidden: false,
      selected: null,
      hovered: null,
      query: '',

      viewportNonce: 0,
      resetNonce: 0,
      zoomNonce: 0,
      zoomDirection: 1,
      panRequest: { nonce: 0, dx: 0, dy: 0 },

      requestFit: () => set((s) => ({ viewportNonce: s.viewportNonce + 1 })),
      requestReset: () => set((s) => ({ resetNonce: s.resetNonce + 1 })),
      requestZoom: (direction) =>
        set((s) => ({ zoomNonce: s.zoomNonce + 1, zoomDirection: direction })),
      requestPan: (dx, dy) =>
        set((s) => ({ panRequest: { nonce: s.panRequest.nonce + 1, dx, dy } })),

      dive: (dir) => {
        set({ dir, selected: null, hovered: null, query: '' });
        if (fixtureTree) return;
        if (useFilesStore.getState().entries[dir] === undefined) {
          void useFilesStore.getState().loadDir(dir);
        }
      },

      up: () => {
        const dir = get().dir;
        if (dir === '') return;
        get().dive(parentOf(dir));
      },

      setMode: (mode) => set({ mode }),

      toggleMode: () => {
        const current = effectiveMapMode(get().mode, useThemeStore.getState().mode);
        set({ mode: current === 'orbit' ? 'chart' : 'orbit' });
      },

      setMethodForMode: (mode, method) =>
        set((state) => {
          const methodByMode = { ...state.methodByMode };
          if (method === null) delete methodByMode[mode];
          else methodByMode[mode] = method;
          return { methodByMode };
        }),

      setShowHidden: (v) => set({ showHidden: v }),
      select: (path) => set({ selected: path }),
      hover: (path) => set({ hovered: path }),
      setQuery: (q) => set({ query: q }),

      open: (path, kind) => {
        if (kind === 'directory') {
          get().dive(path);
          return;
        }
        if (kind === 'notebook') {
          void useNotebookStore.getState().open(path);
          return;
        }
        void useFilesStore.getState().openFile(path);
      },
    }),
    {
      name: 'orbital.map',
      storage: mapStorage,
      partialize: (s) => ({
        mode: s.mode,
        methodByMode: s.methodByMode,
        showHidden: s.showHidden,
        dir: s.dir,
      }),
    },
  ),
);

/** The kind of `path` inside one cached listing, or null when it is not there. */
function kindWithin(folder: string, path: string): BodyKind | null {
  if (fixtureTree) return fixtureTree[folder]?.find((b) => b.path === path)?.kind ?? null;
  return useFilesStore.getState().entries[folder]?.find((e) => e.path === path)?.type ?? null;
}

/**
 * The kind of `path` within the system currently on screen, or null when it
 * is not reachable there. Lets `map/commands.ts` act on the selection without
 * the palette having to know about laid-out bodies.
 *
 * M8.5 widened this by exactly one level: the explorer can select a child of a
 * folder in this system (the renderer draws it as the focused body's moon), so
 * such a path has to resolve too — but no deeper, because nothing below that
 * is ever selectable from the map or the explorer.
 */
export function kindInCurrentSystem(path: string): BodyKind | null {
  const dir = useMapStore.getState().dir;
  const here = kindWithin(dir, path);
  if (here) return here;
  const parent = parentOf(path);
  if (parent === path || kindWithin(dir, parent) !== 'directory') return null;
  return kindWithin(parent, path);
}

/**
 * Which folder the explorer column lists: the selected folder, else the folder
 * holding the selected notebook/file, else the system on screen. Pure so the
 * rule is testable — `kindOf` is `kindInCurrentSystem` in the view.
 */
export function explorerFolder(
  state: { dir: string; selected: string | null },
  kindOf: (path: string) => BodyKind | null,
): string {
  const { dir, selected } = state;
  if (selected === null) return dir;
  const kind = kindOf(selected);
  if (kind === 'directory') return selected;
  // A selection the current system cannot place (a stale path, or one from
  // another system) must not drag the listing somewhere unrelated.
  if (kind === null) return dir;
  return parentOf(selected);
}

// ---- create-in-folder actions ----------------------------------------------

/** `window.prompt` when it exists; the vitest node environment has no `window`, so tests inject their own `ask`. */
function defaultAsk(message: string, initial: string): string | null {
  return typeof window !== 'undefined' && typeof window.prompt === 'function'
    ? window.prompt(message, initial)
    : null;
}

/**
 * The three "create in the folder I'm looking at" actions. `folder` defaults
 * to the system currently on screen (`dir`), which is what the `map.new*Here`
 * commands want; the explorer passes the folder it is *listing* instead, so
 * the buttons under a listing act where the listing is. Shared so there is
 * exactly one code path; both callers are responsible for not invoking these
 * while a fixture is installed or the session is not connected
 * (`createNotebookIn`/`createFolderIn`/`createFileIn` already no-op with an
 * error in that case, but the UI disables the controls so that error is never
 * actually hit).
 */
export function createNotebookHere(folder: string = useMapStore.getState().dir): void {
  void useFilesStore.getState().createNotebookIn(folder);
}

export function createFolderHere(
  folder: string = useMapStore.getState().dir,
  ask: (message: string, initial: string) => string | null = defaultAsk,
): void {
  const name = ask('New folder name', 'New Folder');
  if (!name) return;
  void useFilesStore.getState().createFolderIn(folder, name);
}

export function createFileHere(
  folder: string = useMapStore.getState().dir,
  ask: (message: string, initial: string) => string | null = defaultAsk,
): void {
  const name = ask('New file name', 'untitled.txt');
  if (!name) return;
  void useFilesStore.getState().createFileIn(folder, name);
}

/** null → cockpit and bridge fly; paper and night-ops read the chart. */
export function effectiveMapMode(mode: MapMode | null, themeMode: Mode): MapMode {
  if (mode) return mode;
  return themeMode === 'cockpit' || themeMode === 'bridge' ? 'orbit' : 'chart';
}

export function useEffectiveMapMode(): MapMode {
  const mode = useMapStore((s) => s.mode);
  const themeMode = useThemeStore((s) => s.mode);
  return effectiveMapMode(mode, themeMode);
}

/** Which of the three map styles draws the current theme mode, override applied. */
export function useMapMethod(): MapMethod {
  const methodByMode = useMapStore((s) => s.methodByMode);
  const themeMode = useThemeStore((s) => s.mode);
  return rendererForMode(themeMode, methodByMode);
}

// ---- derived: the system on screen ----------------------------------------

/**
 * Bodies for the current system. Also keeps the underlying listing fresh:
 * loads the current directory when it is missing, prefetches up to
 * PREFETCH_LIMIT uncached child directories (so folders can show their moons
 * and item counts), and re-lists the current directory every 30 s.
 */
export function useSystemBodies(): { bodies: Body[]; loading: boolean; error: string | null } {
  const dir = useMapStore((s) => s.dir);
  const showHidden = useMapStore((s) => s.showHidden);
  const fixture = useFixtureTree();
  const entries = useFilesStore((s) => s.entries);
  const loadingByDir = useFilesStore((s) => s.loading);
  const error = useFilesStore((s) => s.error);
  const connected = useSessionStore((s) => s.connection) === 'connected';

  const listing = entries[dir];
  const live = !fixture && connected;

  useEffect(() => {
    if (!live) return;
    if (useFilesStore.getState().entries[dir] === undefined) void useFilesStore.getState().loadDir(dir);
  }, [live, dir]);

  useEffect(() => {
    if (!live || !listing) return;
    let started = 0;
    for (const child of listing) {
      if (child.type !== 'directory') continue;
      if (useFilesStore.getState().entries[child.path] !== undefined) continue;
      if (started >= PREFETCH_LIMIT) break;
      started += 1;
      void useFilesStore.getState().loadDir(child.path);
    }
  }, [live, listing]);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void useFilesStore.getState().loadDir(dir), REFRESH_MS);
    return () => clearInterval(timer);
  }, [live, dir]);

  const bodies = useMemo(() => {
    const now = Date.now();
    if (fixture) return layoutSystem(fixtureListing(fixture, dir, showHidden), now);
    if (!listing) return NO_BODIES;
    return layoutSystem(entriesToBodyInputs(listing, entries, showHidden), now);
  }, [fixture, dir, showHidden, listing, entries]);

  return {
    bodies,
    loading: live && (listing === undefined || loadingByDir[dir] === true),
    error: fixture ? null : error,
  };
}

// ---- derived: the levels below the system ----------------------------------

/**
 * Cached listings for the folder bodies of this system, keyed by folder path
 * and already dotfile-filtered. A missing key means "not loaded yet", which is
 * what lets a renderer draw a folder as an unopened world rather than as an
 * empty one. The listings themselves are fetched by `useSystemBodies`'s
 * prefetch; this hook only shapes what has arrived.
 */
export function useChildrenOf(bodies: Body[]): Record<string, BodyInput[]> {
  const showHidden = useMapStore((s) => s.showHidden);
  const fixture = useFixtureTree();
  const entries = useFilesStore((s) => s.entries);

  return useMemo(() => {
    const out: Record<string, BodyInput[]> = {};
    for (const body of bodies) {
      if (body.kind !== 'directory') continue;
      if (fixture) {
        if (fixture[body.path]) out[body.path] = fixtureListing(fixture, body.path, showHidden);
        continue;
      }
      const listing = entries[body.path];
      if (listing) out[body.path] = entriesToBodyInputs(listing, entries, showHidden);
    }
    return out;
  }, [bodies, fixture, entries, showHidden]);
}

/**
 * Total entries below `path` across every level that is cached in
 * `entriesByDir`. Pure and partial by nature: an uncached folder contributes
 * only itself (as one entry of its parent), so the number can only grow as
 * listings arrive. `seen` makes a malformed map terminate rather than recurse
 * forever.
 */
export function sumDescendants(entriesByDir: Record<string, BodyInput[]>, path: string): number {
  return sumBelow(entriesByDir, path, new Set());
}

function sumBelow(
  entriesByDir: Record<string, BodyInput[]>,
  path: string,
  seen: Set<string>,
): number {
  if (seen.has(path)) return 0;
  seen.add(path);
  const listing = entriesByDir[path];
  if (!listing) return 0;
  let total = listing.length;
  for (const entry of listing) {
    if (entry.kind === 'directory') total += sumBelow(entriesByDir, entry.path, seen);
  }
  return total;
}

/**
 * Known descendant counts per folder body: how big each world is, summed over
 * every level below it that has been listed. Absent = nothing cached yet.
 *
 * It also prefetches one level deeper than `useSystemBodies` does (the
 * grandchildren of the system, i.e. depth 2 below `dir`), capped at
 * PREFETCH_LIMIT directories for that level, so a folder's size is more than
 * just its immediate child count by the time the map settles.
 */
export function useDescendantCounts(bodies: Body[]): Record<string, number> {
  const showHidden = useMapStore((s) => s.showHidden);
  const fixture = useFixtureTree();
  const entries = useFilesStore((s) => s.entries);
  const connected = useSessionStore((s) => s.connection) === 'connected';
  const live = !fixture && connected;

  useEffect(() => {
    if (!live) return;
    let started = 0;
    for (const body of bodies) {
      if (body.kind !== 'directory') continue;
      const listing = useFilesStore.getState().entries[body.path];
      if (!listing) continue;
      for (const child of listing) {
        if (child.type !== 'directory') continue;
        if (useFilesStore.getState().entries[child.path] !== undefined) continue;
        if (started >= PREFETCH_LIMIT) return;
        started += 1;
        void useFilesStore.getState().loadDir(child.path);
      }
    }
  }, [live, bodies, entries]);

  return useMemo(() => {
    const cache: Record<string, BodyInput[]> = {};
    const queue = bodies.filter((b) => b.kind === 'directory').map((b) => b.path);
    // Breadth-first over what is cached, so the map only ever holds the
    // subtree actually below this system.
    while (queue.length > 0) {
      const path = queue.shift() as string;
      if (cache[path] !== undefined) continue;
      const listing = fixture
        ? fixture[path] && fixtureListing(fixture, path, showHidden)
        : entries[path] && entriesToBodyInputs(entries[path], entries, showHidden);
      if (!listing) continue;
      cache[path] = listing;
      for (const child of listing) if (child.kind === 'directory') queue.push(child.path);
    }

    const out: Record<string, number> = {};
    for (const body of bodies) {
      if (body.kind !== 'directory' || cache[body.path] === undefined) continue;
      out[body.path] = sumDescendants(cache, body.path);
    }
    return out;
  }, [bodies, fixture, entries, showHidden]);
}

/**
 * One folder's listing for the explorer column: whatever folder the rule in
 * `explorerFolder` picked, which is often *not* the system on screen. Lists it
 * on demand when nothing is cached, and is fixture-aware so `?fixture=1`
 * browses the canned tree like a real one.
 */
export function useFolderListing(path: string): { entries: BodyInput[]; loading: boolean } {
  const showHidden = useMapStore((s) => s.showHidden);
  const fixture = useFixtureTree();
  const entries = useFilesStore((s) => s.entries);
  const loadingByDir = useFilesStore((s) => s.loading);
  const connected = useSessionStore((s) => s.connection) === 'connected';

  const live = !fixture && connected;
  const raw = entries[path];

  useEffect(() => {
    if (!live) return;
    if (useFilesStore.getState().entries[path] === undefined) {
      void useFilesStore.getState().loadDir(path);
    }
  }, [live, path]);

  const listing = useMemo(() => {
    if (fixture) return fixtureListing(fixture, path, showHidden);
    if (!raw) return NO_ENTRIES;
    return entriesToBodyInputs(raw, entries, showHidden);
  }, [fixture, path, showHidden, raw, entries]);

  return { entries: listing, loading: live && (raw === undefined || loadingByDir[path] === true) };
}

// ---- derived: live state drawn on the bodies -------------------------------

export interface BodyStatus {
  open: boolean;
  active: boolean;
  dirty: boolean;
  kernel: KernelStatus | null;
  /** Cells in state 'error'. */
  errors: number;
  /** Cells 'running' or 'queued'. */
  running: number;
}

/**
 * Statuses keyed by path for the bodies given; reactive to the notebook, tabs
 * and files stores. Takes anything with a `path` so the explorer can status
 * the folder it is listing, which is not always the system on screen.
 */
export function useBodyStatuses(
  bodies: readonly Pick<Body, 'path'>[],
): Record<string, BodyStatus> {
  const docs = useNotebookStore((s) => s.docs);
  const notebookDirty = useNotebookStore((s) => s.dirty);
  const openPaths = useNotebookStore((s) => s.openPaths);
  const kernelByPath = useNotebookStore((s) => s.kernelByPath);
  const files = useFilesStore((s) => s.files);
  const activeTab = useTabsStore((s) => s.activeTab);
  const overrides = useFixtureStatuses();

  return useMemo(() => {
    const statuses: Record<string, BodyStatus> = {};
    for (const body of bodies) {
      const doc = docs[body.path];
      const file = files[body.path];
      let errors = 0;
      let running = 0;
      if (doc) {
        for (const cell of doc.cells) {
          if (cell.state === 'error') errors += 1;
          else if (cell.state === 'running' || cell.state === 'queued') running += 1;
        }
      }
      const status: BodyStatus = {
        open: openPaths.includes(body.path) || file !== undefined,
        active: activeTab?.path === body.path,
        dirty: notebookDirty[body.path] === true || file?.dirty === true,
        kernel: kernelByPath[body.path] ?? null,
        errors,
        running,
      };
      const override = overrides[body.path];
      statuses[body.path] = override ? { ...status, ...override } : status;
    }
    return statuses;
  }, [bodies, docs, notebookDirty, openPaths, kernelByPath, files, activeTab, overrides]);
}

/** Ordered recent notebooks that are bodies in this system, newest first, ≤ 6. */
export function useFlightPath(bodies: Body[]): string[] {
  const recent = useRecent();
  const fixture = useFixtureTree();

  return useMemo(() => {
    const notebooks = bodies.filter((b) => b.kind === 'notebook');
    if (fixture) {
      // A fixture review has no history worth plotting (and whatever real
      // history exists points at other paths), so the course threads the
      // newest notebooks instead — `?fixture=1` must show a complete map.
      return [...notebooks]
        .sort((a, b) => b.modifiedAt - a.modifiedAt)
        .slice(0, 6)
        .map((b) => b.path);
    }
    const here = new Set(notebooks.map((b) => b.path));
    return recent
      .filter((e) => here.has(e.path))
      .map((e) => e.path)
      .slice(0, 6);
  }, [bodies, recent, fixture]);
}

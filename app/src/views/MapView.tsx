/**
 * The Map view: the workspace drawn as a star system, with a folder explorer
 * beside it.
 *
 * This file is only composition and keyboard. The geometry lives in
 * `map/model.ts`, the state in `map/store.ts`, the explorer column in
 * `map/MapExplorer.tsx` and the stage overlays in `map/MapHud.tsx`. What is
 * actually *drawn* in the stage is a renderer chosen by the theme mode
 * (`map/renderer.ts` → `map/renderers.ts`): Paper and Bridge chart, Night Ops
 * and Cockpit fly. This is the only module that reads the map store, so every
 * renderer can be built and tested against props alone.
 *
 * `?fixture=1` swaps the files store out for a canned system
 * (`map/fixture.ts`), so the map can be reviewed and screenshotted in all
 * four modes with no server running; the child listings and descendant counts
 * the renderers want come off the same fixture tree.
 */
import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent } from 'react';

import { useSessionStore } from '../session/store';
import { useFilesStore } from '../files/store';
import { runCommand } from '../shell/commands';
import { NotConnectedCard } from '../shell/NotConnectedCard';
import { openShortcutsHelp } from '../shell/shortcuts';
import { useReducedMotion, useThemeStore } from '../theme/ThemeProvider';
import { MapExplorer } from '../map/MapExplorer';
import { MapHud } from '../map/MapHud';
import { RENDERERS } from '../map/renderers';
import type { MapRendererProps } from '../map/renderer';
import {
  explorerFolder,
  kindInCurrentSystem,
  setMapFixture,
  useBodyStatuses,
  useChildrenOf,
  useDescendantCounts,
  useFlightPath,
  useMapMethod,
  useMapStore,
  useSystemBodies,
} from '../map/store';
import type { Body } from '../map/model';
import '../map/map.css';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

/** What an arrow key is worth, as a camera offset in screen pixels. */
const PAN_STEP = 48;
const PAN_KEYS: Record<string, [number, number] | undefined> = {
  // Pressing right means "look further right", which slides the plate left.
  ArrowLeft: [PAN_STEP, 0],
  ArrowRight: [-PAN_STEP, 0],
  ArrowUp: [0, PAN_STEP],
  ArrowDown: [0, -PAN_STEP],
};

/** Tab order: inner ring to outer, then around each ring by angle. */
function orbitOrder(bodies: Body[]): Body[] {
  return [...bodies].sort((a, b) => a.orbit - b.orbit || a.phase - b.phase);
}

export function MapView() {
  const usingFixture = useMemo(
    () => new URLSearchParams(window.location.search).get('fixture') === '1',
    [],
  );

  useEffect(() => {
    if (!usingFixture) return;
    let cancelled = false;
    void import('../map/fixture').then((fixture) => {
      if (cancelled) return;
      useMapStore.getState().dive('');
      setMapFixture(fixture.tree, fixture.statuses);
    });
    return () => {
      cancelled = true;
      setMapFixture(null);
    };
  }, [usingFixture]);

  const connection = useSessionStore((s) => s.connection);
  const connected = connection === 'connected' || usingFixture;
  const dir = useMapStore((s) => s.dir);
  const selected = useMapStore((s) => s.selected);
  const hovered = useMapStore((s) => s.hovered);
  const query = useMapStore((s) => s.query);
  const showHidden = useMapStore((s) => s.showHidden);
  const themeMode = useThemeStore((s) => s.mode);
  const reduced = useReducedMotion();

  const { bodies, loading, error } = useSystemBodies();
  const statuses = useBodyStatuses(bodies);
  const flightPath = useFlightPath(bodies);
  const childrenOf = useChildrenOf(bodies);
  const descendants = useDescendantCounts(bodies);

  const anyBusy = useMemo(
    () => bodies.some((b) => statuses[b.path]?.kernel === 'busy'),
    [bodies, statuses],
  );

  const hostRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const returnFocus = useCallback(() => hostRef.current?.focus(), []);

  const systemLabel = dir === '' ? 'workspace' : dir.slice(dir.lastIndexOf('/') + 1);

  // The selection can name a body of this system OR a child of a folder in it
  // (the explorer's rows reach one level deeper), so which folder the column
  // lists is a rule of its own — pure, and tested in `map/store.test.ts`.
  const folder = explorerFolder({ dir, selected }, kindInCurrentSystem);

  /** The seam's verb for Enter and double-click: enter folders, open the rest. */
  const activate = useCallback((path: string) => {
    const kind = kindInCurrentSystem(path);
    if (!kind) return;
    if (kind === 'directory') useMapStore.getState().dive(path);
    else useMapStore.getState().open(path, kind);
  }, []);

  const rendererProps: MapRendererProps = {
    dir,
    bodies: connected ? bodies : [],
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
    onSelect: (path) => useMapStore.getState().select(path),
    onHover: (path) => useMapStore.getState().hover(path),
    onOpen: (path, kind) => useMapStore.getState().open(path, kind),
    onDive: (next) => useMapStore.getState().dive(next),
  };

  const Renderer = RENDERERS[useMapMethod()];

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    // The overlays and the explorer live inside `.map-view`, so their keydowns
    // bubble here. Their controls need Tab to move between them and
    // Enter/Space to activate them; the map's own shortcuts must not intercept
    // either.
    if (event.target instanceof Element && event.target.closest('.map-panel')) return;
    if (isTypingTarget(event.target)) return;
    const store = useMapStore.getState();

    if (event.key === 'Tab') {
      if (bodies.length === 0) return;
      event.preventDefault();
      const ordered = orbitOrder(bodies);
      const at = store.selected ? ordered.findIndex((b) => b.path === store.selected) : -1;
      const step = event.shiftKey ? -1 : 1;
      const next = ordered[(at + step + ordered.length) % ordered.length];
      store.select(next.path);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      if (!store.selected) return;
      event.preventDefault();
      activate(store.selected);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      if (store.selected) store.select(null);
      else store.up();
      return;
    }

    if (event.key === 'Backspace') {
      event.preventDefault();
      store.up();
      return;
    }

    if (event.key === '/') {
      event.preventDefault();
      filterRef.current?.focus();
      filterRef.current?.select();
      return;
    }

    // ---- the camera ----
    // The stage is bigger than the window onto it, so it needs driving. The
    // camera itself lives inside the mounted renderer (`map/useViewport`),
    // which this file deliberately knows nothing about; every key below asks
    // the store and the hook answers. Arrows are the map's own — the
    // explorer's rows are behind the `.map-panel` guard at the top.
    const pan = PAN_KEYS[event.key];
    if (pan) {
      event.preventDefault();
      store.requestPan(pan[0], pan[1]);
      return;
    }

    if (event.key === '+' || event.key === '=' || event.key === '-') {
      event.preventDefault();
      store.requestZoom(event.key === '-' ? -1 : 1);
      return;
    }

    if (event.key === '0') {
      event.preventDefault();
      store.requestReset();
      return;
    }

    // Shift+/ arrives as "?"; the overlay is mounted once by AppShell.
    if (event.key === '?') {
      event.preventDefault();
      openShortcutsHelp();
      return;
    }

    const key = event.key.toLowerCase();
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (key === 'o') {
      event.preventDefault();
      store.toggleMode();
    } else if (key === 'h') {
      event.preventDefault();
      store.setShowHidden(!store.showHidden);
    } else if (key === 'f') {
      event.preventDefault();
      store.requestFit();
    }
  }

  const empty = connected && !loading && bodies.length === 0;

  return (
    <div className="map-view" ref={hostRef} tabIndex={0} onKeyDown={onKeyDown}>
      <div className="map-stage">
        <Renderer {...rendererProps} />

        {connected ? (
          <MapHud />
        ) : (
          <div className="map-overlay">
            <NotConnectedCard />
          </div>
        )}

        {empty && (
          <div className="map-overlay map-empty">
            <p className="map-empty-label">nothing here yet</p>
            <button
              type="button"
              onClick={() =>
                dir === ''
                  ? runCommand('notebook.newNotebook')
                  : void useFilesStore.getState().createNotebookIn(dir)
              }
            >
              New notebook
            </button>
          </div>
        )}
      </div>

      {connected && (
        <MapExplorer
          dir={dir}
          folder={folder}
          selected={selected}
          query={query}
          showHidden={showHidden}
          error={error}
          filterRef={filterRef}
          onReturnFocus={returnFocus}
          onSelect={(path) => useMapStore.getState().select(path)}
          onOpen={(path, kind) => useMapStore.getState().open(path, kind)}
          onDive={(next) => useMapStore.getState().dive(next)}
          onQuery={(q) => useMapStore.getState().setQuery(q)}
          onShowHidden={(v) => useMapStore.getState().setShowHidden(v)}
        />
      )}
    </div>
  );
}

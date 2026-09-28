/**
 * Map actions in the command palette. Imported once, for its side effects, by
 * `shell/AppShell.tsx` — the same arrangement as `notebook/commands.ts`, and
 * for the same reason: registration must happen whether or not the Map view
 * has ever been mounted.
 *
 * Imports are deliberately limited to `map/store.ts`, `map/renderer.ts`,
 * `shell/commands.ts`, `shell/uiStore.ts`, `session/store.ts` (the last one
 * only to gate the create-here commands on connection state; CLAUDE.md's
 * init-cycle rule) and `theme/ThemeProvider.ts` (only to read the current
 * theme mode for `map.cycleStyle`); every store is reached through
 * `.getState()` inside a `run`/`when`, never at module top level.
 */
import { registerCommand } from '../shell/commands';
import { useUiStore } from '../shell/uiStore';
import { useSessionStore } from '../session/store';
import { useThemeStore } from '../theme/ThemeProvider';
import { rendererForMode, type MapMethod } from './renderer';
import { createFileHere, createFolderHere, createNotebookHere, getMapFixture, kindInCurrentSystem, useMapStore } from './store';

const CATEGORY = 'Map';

function onMap(): boolean {
  return useUiStore.getState().view === 'map';
}

function inSubsystem(): boolean {
  return useMapStore.getState().dir !== '';
}

// Since M8.5 the map is drawn by one renderer per theme mode, and only the
// chart style (`MapCanvas`'s `ChartMap`) has a Chart/Orbit setting — which is
// why this lost its dial in the HUD but kept its command and its `O`.
registerCommand({
  id: 'map.toggleMode',
  title: 'Map: toggle Chart / Orbit (chart style only)',
  category: CATEGORY,
  run: () => useMapStore.getState().toggleMode(),
});

const STYLE_CYCLE: MapMethod[] = ['cartography', 'zoom', 'chart'];

registerCommand({
  id: 'map.cycleStyle',
  title: 'Map: cycle style for this mode',
  category: CATEGORY,
  run: () => {
    const themeMode = useThemeStore.getState().mode;
    const { methodByMode, setMethodForMode } = useMapStore.getState();
    const current = rendererForMode(themeMode, methodByMode);
    const next = STYLE_CYCLE[(STYLE_CYCLE.indexOf(current) + 1) % STYLE_CYCLE.length];
    setMethodForMode(themeMode, next);
  },
});

// The camera belongs to whichever renderer is mounted, so the palette bumps
// a nonce in the store and `map/useViewport` does the work. Same route as the
// HUD's fit button and the view's `F`.
registerCommand({
  id: 'map.fitView',
  title: 'Map: fit to view',
  category: CATEGORY,
  when: onMap,
  run: () => useMapStore.getState().requestFit(),
});

registerCommand({
  id: 'map.up',
  title: 'Map: go up a level',
  category: CATEGORY,
  when: () => onMap() && inSubsystem(),
  run: () => useMapStore.getState().up(),
});

registerCommand({
  id: 'map.toggleHidden',
  title: 'Map: toggle hidden files',
  category: CATEGORY,
  run: () => {
    const { showHidden, setShowHidden } = useMapStore.getState();
    setShowHidden(!showHidden);
  },
});

registerCommand({
  id: 'map.openSelected',
  title: 'Map: open selected',
  category: CATEGORY,
  when: () => useMapStore.getState().selected !== null,
  run: () => {
    const { selected, open } = useMapStore.getState();
    if (!selected) return;
    // `open` dives when the kind is a directory, which is the same verb the
    // stage and the explorer use for Enter.
    const kind = kindInCurrentSystem(selected);
    if (kind) open(selected, kind);
  },
});

registerCommand({
  id: 'map.root',
  title: 'Map: back to workspace root',
  category: CATEGORY,
  when: inSubsystem,
  run: () => useMapStore.getState().dive(''),
});

/** The create-here actions need a live, non-fixture session, same as the HUD's buttons. */
function readyToCreateHere(): boolean {
  return onMap() && useSessionStore.getState().connection === 'connected' && getMapFixture() === null;
}

registerCommand({
  id: 'map.newNotebookHere',
  title: 'Map: new notebook in this folder',
  category: CATEGORY,
  when: readyToCreateHere,
  run: () => createNotebookHere(),
});

registerCommand({
  id: 'map.newFolderHere',
  title: 'Map: new folder in this folder',
  category: CATEGORY,
  when: readyToCreateHere,
  run: () => createFolderHere(),
});

registerCommand({
  id: 'map.newFileHere',
  title: 'Map: new file in this folder',
  category: CATEGORY,
  when: readyToCreateHere,
  run: () => createFileHere(),
});

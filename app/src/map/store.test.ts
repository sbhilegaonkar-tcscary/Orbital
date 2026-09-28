/**
 * Map store tests. Node environment, no DOM: only the store actions and the
 * pure mode resolution are exercised here — the hooks are covered by the
 * visual acceptance pass, because they are React, not logic.
 *
 * A fake `SessionProvider` (`session/testing.ts`) stands in for the server so
 * `dive` can be watched asking the files store to list a directory.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setProviderFactory, useSessionStore } from '../session/store';
import { makeFakeContents, makeFakeProvider } from '../session/testing';
import type { ContentsEntry } from '../session/types';
import { useFilesStore } from '../files/store';
import { useNotebookStore } from '../notebook/store';
import { useThemeStore } from '../theme/ThemeProvider';
import {
  createFileHere,
  createFolderHere,
  createNotebookHere,
  effectiveMapMode,
  explorerFolder,
  fixtureListing,
  getMapFixture,
  kindInCurrentSystem,
  setMapFixture,
  sumDescendants,
  useMapStore,
} from './store';
import { rendererForMode } from './renderer';
import type { BodyInput, BodyKind } from './model';

const NB = 'alpha.ipynb';

function entry(path: string, type: ContentsEntry['type']): ContentsEntry {
  return {
    name: path.slice(path.lastIndexOf('/') + 1),
    path,
    type,
    lastModified: '2026-09-01T00:00:00Z',
  };
}

const TREE: Record<string, ContentsEntry[]> = {
  '': [entry('experiments', 'directory'), entry(NB, 'notebook')],
  experiments: [entry('experiments/hull.ipynb', 'notebook')],
  'experiments/deep': [],
};

let listed: string[] = [];

function resetStores(): void {
  listed = [];
  setMapFixture(null);
  useMapStore.setState({
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
  });
  useFilesStore.setState({ entries: {}, expanded: [], selected: null, loading: {}, files: {}, error: null });
  useNotebookStore.setState({ docs: {}, dirty: {}, openPaths: [], activePath: null, kernelByPath: {} });
  useThemeStore.setState({ mode: 'night-ops' });
}

beforeEach(async () => {
  resetStores();
  setProviderFactory(() =>
    makeFakeProvider({
      contents: makeFakeContents({
        list: async (dir: string) => {
          listed.push(dir);
          return TREE[dir] ?? [];
        },
      }),
    }),
  );
  await useSessionStore.getState().connect();
});

describe('effectiveMapMode', () => {
  it('follows the theme when nothing is pinned', () => {
    expect(effectiveMapMode(null, 'paper')).toBe('chart');
    expect(effectiveMapMode(null, 'night-ops')).toBe('chart');
    expect(effectiveMapMode(null, 'cockpit')).toBe('orbit');
    expect(effectiveMapMode(null, 'bridge')).toBe('orbit');
  });

  it('lets a pinned mode win over the theme', () => {
    expect(effectiveMapMode('orbit', 'paper')).toBe('orbit');
    expect(effectiveMapMode('chart', 'bridge')).toBe('chart');
  });
});

describe('toggleMode', () => {
  it('flips relative to the effective mode and pins the result', () => {
    useThemeStore.setState({ mode: 'bridge' }); // effective: orbit
    useMapStore.getState().toggleMode();
    expect(useMapStore.getState().mode).toBe('chart');

    resetStores();
    useThemeStore.setState({ mode: 'paper' }); // effective: chart
    useMapStore.getState().toggleMode();
    expect(useMapStore.getState().mode).toBe('orbit');
  });

  it('keeps flipping once pinned', () => {
    useMapStore.getState().setMode('orbit');
    useMapStore.getState().toggleMode();
    expect(useMapStore.getState().mode).toBe('chart');
    useMapStore.getState().toggleMode();
    expect(useMapStore.getState().mode).toBe('orbit');
  });
});

describe('rendererForMode', () => {
  it('falls back to the default mapping with no override', () => {
    expect(rendererForMode('paper')).toBe('cartography');
    expect(rendererForMode('bridge')).toBe('cartography');
    expect(rendererForMode('night-ops')).toBe('zoom');
    expect(rendererForMode('cockpit')).toBe('zoom');
  });

  it('lets an override win over the default', () => {
    expect(rendererForMode('paper', { paper: 'chart' })).toBe('chart');
    expect(rendererForMode('night-ops', { 'night-ops': 'cartography' })).toBe('cartography');
  });

  it('ignores an override for a different mode', () => {
    expect(rendererForMode('cockpit', { paper: 'chart' })).toBe('zoom');
  });
});

describe('setMethodForMode', () => {
  it('sets an override for one mode without disturbing the others', () => {
    useMapStore.getState().setMethodForMode('paper', 'chart');
    useMapStore.getState().setMethodForMode('cockpit', 'cartography');
    expect(useMapStore.getState().methodByMode).toEqual({ paper: 'chart', cockpit: 'cartography' });
  });

  it('clears the override with null', () => {
    useMapStore.getState().setMethodForMode('paper', 'chart');
    useMapStore.getState().setMethodForMode('cockpit', 'cartography');
    useMapStore.getState().setMethodForMode('paper', null);
    expect(useMapStore.getState().methodByMode).toEqual({ cockpit: 'cartography' });
  });
});

describe('persisting methodByMode', () => {
  it('includes methodByMode alongside mode, showHidden and dir', () => {
    useMapStore.getState().setMethodForMode('bridge', 'zoom');
    useMapStore.setState({ showHidden: true, dir: 'experiments' });

    const partialize = useMapStore.persist.getOptions().partialize;
    expect(partialize).toBeTypeOf('function');
    expect(partialize?.(useMapStore.getState())).toEqual({
      mode: null,
      methodByMode: { bridge: 'zoom' },
      showHidden: true,
      dir: 'experiments',
    });
  });
});

describe('dive and up', () => {
  it('sets the system and clears selection, hover and filter', () => {
    useMapStore.setState({ selected: NB, hovered: NB, query: 'hull' });
    useMapStore.getState().dive('experiments');
    const state = useMapStore.getState();
    expect(state.dir).toBe('experiments');
    expect(state.selected).toBeNull();
    expect(state.hovered).toBeNull();
    expect(state.query).toBe('');
  });

  it('lists a directory it has not cached, and only once', async () => {
    useMapStore.getState().dive('experiments');
    await Promise.resolve();
    await Promise.resolve();
    expect(listed).toEqual(['experiments']);
    expect(useFilesStore.getState().entries.experiments).toHaveLength(1);

    useMapStore.getState().dive('');
    useMapStore.getState().dive('experiments');
    await Promise.resolve();
    expect(listed).toEqual(['experiments', '']);
  });

  it('never touches the files store while a fixture is installed', async () => {
    setMapFixture({ '': [], deep: [] });
    useMapStore.getState().dive('deep');
    await Promise.resolve();
    expect(listed).toEqual([]);
    expect(useMapStore.getState().dir).toBe('deep');
  });

  it('walks to the parent and stops at the root', () => {
    useMapStore.setState({ dir: 'experiments/deep' });
    useMapStore.getState().up();
    expect(useMapStore.getState().dir).toBe('experiments');
    useMapStore.getState().up();
    expect(useMapStore.getState().dir).toBe('');
    useMapStore.getState().up();
    expect(useMapStore.getState().dir).toBe('');
  });
});

describe('open', () => {
  it('dives into a directory', () => {
    useMapStore.getState().open('experiments', 'directory');
    expect(useMapStore.getState().dir).toBe('experiments');
  });

  it('hands a notebook to the notebook store', async () => {
    useMapStore.getState().open(NB, 'notebook');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useNotebookStore.getState().openPaths).toEqual([NB]);
    expect(useNotebookStore.getState().activePath).toBe(NB);
    // The map draws every kernel, not just the active tab's, so opening one
    // must record its status per path (notebook/store.ts's `kernelByPath`).
    expect(useNotebookStore.getState().kernelByPath).toEqual({ [NB]: 'idle' });

    await useNotebookStore.getState().close(NB);
    expect(useNotebookStore.getState().kernelByPath).toEqual({});
  });

  it('hands a text file to the files store', async () => {
    useMapStore.getState().open('notes.md', 'file');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(Object.keys(useFilesStore.getState().files)).toEqual(['notes.md']);
  });
});

describe('the fixture seam', () => {
  it('installs and clears a tree', () => {
    const tree: Record<string, BodyInput[]> = {
      '': [{ path: NB, name: NB, kind: 'notebook', modifiedAt: 0 }],
    };
    expect(getMapFixture()).toBeNull();
    setMapFixture(tree, { [NB]: { open: true } });
    expect(getMapFixture()).toBe(tree);
    setMapFixture(null);
    expect(getMapFixture()).toBeNull();
  });
});

describe('createNotebookHere / createFolderHere / createFileHere', () => {
  // vitest's node environment has no `window`, so `defaultAsk` inside
  // store.ts can never be exercised here — every call below injects `ask`.
  const real = useFilesStore.getState();

  afterEach(() => {
    useFilesStore.setState({
      createNotebookIn: real.createNotebookIn,
      createFolderIn: real.createFolderIn,
      createFileIn: real.createFileIn,
    });
  });

  it('creates a notebook in the system currently on screen', () => {
    const createNotebookIn = vi.fn();
    useFilesStore.setState({ createNotebookIn });
    useMapStore.setState({ dir: 'experiments' });

    createNotebookHere();

    expect(createNotebookIn).toHaveBeenCalledWith('experiments');
  });

  it('asks for a folder name and creates it in the current dir', () => {
    const createFolderIn = vi.fn();
    useFilesStore.setState({ createFolderIn });
    useMapStore.setState({ dir: 'experiments' });
    const ask = vi.fn().mockReturnValue('moons');

    createFolderHere(undefined, ask);

    expect(ask).toHaveBeenCalledWith('New folder name', 'New Folder');
    expect(createFolderIn).toHaveBeenCalledWith('experiments', 'moons');
  });

  it('does nothing when the folder prompt is cancelled', () => {
    const createFolderIn = vi.fn();
    useFilesStore.setState({ createFolderIn });

    createFolderHere(undefined, () => null);

    expect(createFolderIn).not.toHaveBeenCalled();
  });

  it('does nothing when the folder name is empty', () => {
    const createFolderIn = vi.fn();
    useFilesStore.setState({ createFolderIn });

    createFolderHere(undefined, () => '');

    expect(createFolderIn).not.toHaveBeenCalled();
  });

  it('asks for a file name and creates it in the current dir', () => {
    const createFileIn = vi.fn();
    useFilesStore.setState({ createFileIn });
    useMapStore.setState({ dir: 'experiments' });
    const ask = vi.fn().mockReturnValue('notes.md');

    createFileHere(undefined, ask);

    expect(ask).toHaveBeenCalledWith('New file name', 'untitled.txt');
    expect(createFileIn).toHaveBeenCalledWith('experiments', 'notes.md');
  });

  it('does nothing when the file prompt is cancelled', () => {
    const createFileIn = vi.fn();
    useFilesStore.setState({ createFileIn });

    createFileHere(undefined, () => null);

    expect(createFileIn).not.toHaveBeenCalled();
  });

  it('does nothing when the file name is empty', () => {
    const createFileIn = vi.fn();
    useFilesStore.setState({ createFileIn });

    createFileHere(undefined, () => '');

    expect(createFileIn).not.toHaveBeenCalled();
  });

  // The explorer's create row acts in the folder it is LISTING, which is often
  // a level below the system on screen.
  it('creates in an explicit folder when the explorer names one', () => {
    const createNotebookIn = vi.fn();
    const createFolderIn = vi.fn();
    const createFileIn = vi.fn();
    useFilesStore.setState({ createNotebookIn, createFolderIn, createFileIn });
    useMapStore.setState({ dir: '' });

    createNotebookHere('experiments/sweeps');
    createFolderHere('experiments/sweeps', () => 'plots');
    createFileHere('experiments/sweeps', () => 'grid.csv');

    expect(createNotebookIn).toHaveBeenCalledWith('experiments/sweeps');
    expect(createFolderIn).toHaveBeenCalledWith('experiments/sweeps', 'plots');
    expect(createFileIn).toHaveBeenCalledWith('experiments/sweeps', 'grid.csv');
  });
});

describe('explorerFolder', () => {
  const kinds: Record<string, BodyKind> = {
    experiments: 'directory',
    [NB]: 'notebook',
    'notes.md': 'file',
    'experiments/hull.ipynb': 'notebook',
    'experiments/deep': 'directory',
  };
  const kindOf = (path: string): BodyKind | null => kinds[path] ?? null;

  it('lists the system on screen when nothing is selected', () => {
    expect(explorerFolder({ dir: '', selected: null }, kindOf)).toBe('');
    expect(explorerFolder({ dir: 'experiments', selected: null }, kindOf)).toBe('experiments');
  });

  it('lists a selected folder itself', () => {
    expect(explorerFolder({ dir: '', selected: 'experiments' }, kindOf)).toBe('experiments');
    expect(explorerFolder({ dir: 'experiments', selected: 'experiments/deep' }, kindOf)).toBe(
      'experiments/deep',
    );
  });

  it('lists the folder holding a selected notebook or file', () => {
    expect(explorerFolder({ dir: '', selected: NB }, kindOf)).toBe('');
    expect(explorerFolder({ dir: '', selected: 'notes.md' }, kindOf)).toBe('');
    // The explorer reaches one level below the system: a child of a selected
    // folder keeps that folder listed, with its own row highlighted.
    expect(explorerFolder({ dir: '', selected: 'experiments/hull.ipynb' }, kindOf)).toBe(
      'experiments',
    );
  });

  it('falls back to the system for a selection it cannot place', () => {
    expect(explorerFolder({ dir: 'experiments', selected: 'gone/stale.ipynb' }, kindOf)).toBe(
      'experiments',
    );
  });
});

describe('kindInCurrentSystem', () => {
  it('resolves a body of the system, and one level below it', async () => {
    useMapStore.getState().dive('');
    await Promise.resolve();
    await Promise.resolve();
    await useFilesStore.getState().loadDir('experiments');

    expect(kindInCurrentSystem('experiments')).toBe('directory');
    expect(kindInCurrentSystem(NB)).toBe('notebook');
    expect(kindInCurrentSystem('experiments/hull.ipynb')).toBe('notebook');
    expect(kindInCurrentSystem('nope.ipynb')).toBeNull();
    // Two levels down is never selectable, so it never resolves.
    expect(kindInCurrentSystem('experiments/deep/x.ipynb')).toBeNull();
  });

  it('reads the fixture tree the same way', () => {
    setMapFixture({
      '': [{ path: 'experiments', name: 'experiments', kind: 'directory', modifiedAt: 0 }],
      experiments: [{ path: 'experiments/hull.ipynb', name: 'hull.ipynb', kind: 'notebook', modifiedAt: 0 }],
    });
    useMapStore.setState({ dir: '' });

    expect(kindInCurrentSystem('experiments')).toBe('directory');
    expect(kindInCurrentSystem('experiments/hull.ipynb')).toBe('notebook');
    expect(kindInCurrentSystem('missing')).toBeNull();
  });
});

describe('sumDescendants', () => {
  function d(path: string): BodyInput {
    return { path, name: path.slice(path.lastIndexOf('/') + 1), kind: 'directory', modifiedAt: 0 };
  }
  function f(path: string): BodyInput {
    return { path, name: path.slice(path.lastIndexOf('/') + 1), kind: 'file', modifiedAt: 0 };
  }

  it('sums every cached level below a folder', () => {
    const tree: Record<string, BodyInput[]> = {
      a: [d('a/b'), f('a/one.txt')],
      'a/b': [f('a/b/two.txt'), f('a/b/three.txt'), d('a/b/c')],
      'a/b/c': [f('a/b/c/four.txt')],
    };
    // 2 in a, 3 in a/b, 1 in a/b/c.
    expect(sumDescendants(tree, 'a')).toBe(6);
    expect(sumDescendants(tree, 'a/b')).toBe(4);
    expect(sumDescendants(tree, 'a/b/c')).toBe(1);
  });

  it('counts an uncached level as only the folder entry that named it', () => {
    const tree: Record<string, BodyInput[]> = { a: [d('a/b'), f('a/one.txt')] };
    expect(sumDescendants(tree, 'a')).toBe(2);
  });

  it('is 0 for a folder with nothing cached', () => {
    expect(sumDescendants({}, 'a')).toBe(0);
  });

  it('terminates on a self-referencing map instead of recursing forever', () => {
    const tree: Record<string, BodyInput[]> = { a: [d('a')] };
    expect(sumDescendants(tree, 'a')).toBe(1);
  });
});

describe("useFolderListing's fixture path", () => {
  const tree: Record<string, BodyInput[]> = {
    '': [
      { path: 'experiments', name: 'experiments', kind: 'directory', modifiedAt: 0 },
      { path: NB, name: NB, kind: 'notebook', modifiedAt: 0 },
      { path: '.ipynb_checkpoints', name: '.ipynb_checkpoints', kind: 'directory', modifiedAt: 0 },
    ],
    experiments: [
      { path: 'experiments/hull.ipynb', name: 'hull.ipynb', kind: 'notebook', modifiedAt: 0 },
    ],
  };

  it('returns one folder of the tree, dotfiles filtered', () => {
    expect(fixtureListing(tree, '', false).map((e) => e.path)).toEqual(['experiments', NB]);
    expect(fixtureListing(tree, '', true)).toHaveLength(3);
    expect(fixtureListing(tree, 'experiments', false).map((e) => e.path)).toEqual([
      'experiments/hull.ipynb',
    ]);
  });

  it('reads an unlisted folder as empty', () => {
    expect(fixtureListing(tree, 'experiments/deep', false)).toEqual([]);
  });
});

describe('camera requests', () => {
  // The camera lives inside the mounted renderer, so the view, the HUD and
  // the palette all reach it by bumping a nonce that `map/useViewport`
  // subscribes to. What the store owes them is a value that always changes.
  it('bumps a fresh nonce for every fit, reset and zoom', () => {
    const store = useMapStore.getState();
    expect(store.viewportNonce).toBe(0);

    store.requestFit();
    store.requestFit();
    expect(useMapStore.getState().viewportNonce).toBe(2);

    store.requestReset();
    expect(useMapStore.getState().resetNonce).toBe(1);

    store.requestZoom(1);
    expect(useMapStore.getState()).toMatchObject({ zoomNonce: 1, zoomDirection: 1 });
    store.requestZoom(-1);
    expect(useMapStore.getState()).toMatchObject({ zoomNonce: 2, zoomDirection: -1 });
    // Twice the same way still has to read as two requests.
    store.requestZoom(-1);
    expect(useMapStore.getState().zoomNonce).toBe(3);
  });

  it('carries the pan delta alongside its nonce', () => {
    useMapStore.getState().requestPan(-48, 0);
    expect(useMapStore.getState().panRequest).toEqual({ nonce: 1, dx: -48, dy: 0 });
    useMapStore.getState().requestPan(-48, 0);
    expect(useMapStore.getState().panRequest).toEqual({ nonce: 2, dx: -48, dy: 0 });
  });

  it('keeps every camera request out of the persisted state', () => {
    const store = useMapStore.getState();
    store.requestFit();
    store.requestReset();
    store.requestZoom(1);
    store.requestPan(0, 48);

    const partialize = useMapStore.persist.getOptions().partialize;
    expect(Object.keys(partialize?.(useMapStore.getState()) ?? {}).sort()).toEqual([
      'dir',
      'methodByMode',
      'mode',
      'showHidden',
    ]);
  });
});

describe('the rest of the store', () => {
  it('records selection, hover, filter and hidden separately', () => {
    const store = useMapStore.getState();
    store.select(NB);
    store.hover('experiments');
    store.setQuery('hull');
    store.setShowHidden(true);
    const state = useMapStore.getState();
    expect(state.selected).toBe(NB);
    expect(state.hovered).toBe('experiments');
    expect(state.query).toBe('hull');
    expect(state.showHidden).toBe(true);
    // Hover must not disturb selection: the detail card prefers hover, the
    // map keeps the selection until Esc.
    store.hover(null);
    expect(useMapStore.getState().selected).toBe(NB);
  });
});

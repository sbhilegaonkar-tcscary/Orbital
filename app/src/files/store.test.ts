/**
 * Files store tests. No live server: a fake SessionProvider from
 * `session/testing.ts` is injected through `setProviderFactory`, with a
 * `ContentsApi` that serves a tiny in-memory tree and records every call.
 *
 * Tab assertions go through `shell/tabs.ts`, which is the other half of the
 * contract: opening a file must produce a tab, closing must remove it.
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import { setProviderFactory, useSessionStore } from '../session/store';
import { makeFakeContents, makeFakeProvider } from '../session/testing';
import type { ContentsEntry, SessionProvider } from '../session/types';
import { useNotebookStore } from '../notebook/store';
import { useTabsStore } from '../shell/tabs';
import { useFilesStore, languageForPath, saveActiveFile } from './store';

const NB = 'nb.ipynb';
const PY = 'a.py';
const MD = 'work/notes.md';

function entry(path: string, type: ContentsEntry['type']): ContentsEntry {
  return {
    name: path.slice(path.lastIndexOf('/') + 1),
    path,
    type,
    lastModified: '2026-01-01T00:00:00Z',
  };
}

/** Records everything the store asked the contents layer to do. */
interface Fake {
  provider: SessionProvider;
  /** path -> text, for getFile/saveFile. */
  texts: Map<string, string>;
  listed: string[];
  saved: [string, string][];
  createdNotebooks: string[];
  createdFiles: [string, string | undefined][];
  createdDirs: [string, string | undefined][];
  renamed: [string, string][];
  deleted: string[];
  uploaded: [string, string][];
  getFileCalls: string[];
  /** Set to make the named method reject with this message. */
  fail: Partial<Record<'list' | 'getFile' | 'saveFile' | 'delete', string>>;
}

const TREE: Record<string, ContentsEntry[]> = {
  '': [entry('work', 'directory'), entry(PY, 'file'), entry(NB, 'notebook')],
  work: [entry(MD, 'file')],
};

function makeFake(): Fake {
  const fake: Fake = {
    provider: null as unknown as SessionProvider,
    texts: new Map([
      [PY, 'print(1)'],
      [MD, '# notes'],
    ]),
    listed: [],
    saved: [],
    createdNotebooks: [],
    createdFiles: [],
    createdDirs: [],
    renamed: [],
    deleted: [],
    uploaded: [],
    getFileCalls: [],
    fail: {},
  };

  fake.provider = makeFakeProvider({
    contents: makeFakeContents({
      list: async (dir: string) => {
        if (fake.fail.list) throw new Error(fake.fail.list);
        fake.listed.push(dir);
        return TREE[dir] ?? [];
      },
      getFile: async (path: string) => {
        fake.getFileCalls.push(path);
        if (fake.fail.getFile) throw new Error(fake.fail.getFile);
        return fake.texts.get(path) ?? '';
      },
      saveFile: async (path: string, text: string) => {
        if (fake.fail.saveFile) throw new Error(fake.fail.saveFile);
        fake.saved.push([path, text]);
        fake.texts.set(path, text);
      },
      createNotebook: async (dir: string, name = 'Untitled.ipynb') => {
        const path = dir ? `${dir}/${name}` : name;
        fake.createdNotebooks.push(path);
        return path;
      },
      createFile: async (dir: string, name?: string) => {
        fake.createdFiles.push([dir, name]);
        const leaf = name ?? 'untitled.txt';
        const path = dir ? `${dir}/${leaf}` : leaf;
        fake.texts.set(path, '');
        return path;
      },
      createDirectory: async (dir: string, name?: string) => {
        fake.createdDirs.push([dir, name]);
        const leaf = name ?? 'Untitled Folder';
        return dir ? `${dir}/${leaf}` : leaf;
      },
      rename: async (path: string, newPath: string) => {
        fake.renamed.push([path, newPath]);
      },
      delete: async (path: string) => {
        if (fake.fail.delete) throw new Error(fake.fail.delete);
        fake.deleted.push(path);
      },
      upload: async (dir: string, file: File) => {
        fake.uploaded.push([dir, file.name]);
        return dir ? `${dir}/${file.name}` : file.name;
      },
    }),
  });

  return fake;
}

/** Array-like stand-in for a browser FileList; node 18 has no global `File`. */
function fakeFileList(names: string[]): FileList {
  const files = names.map((name) => ({ name }) as unknown as File);
  return {
    ...files,
    length: files.length,
    item: (i: number) => files[i] ?? null,
  } as unknown as FileList;
}

/** Lets the event loop (not just the microtask queue) drain. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let fake: Fake;

function files() {
  return useFilesStore.getState();
}

beforeEach(async () => {
  fake = makeFake();
  setProviderFactory(() => fake.provider);
  await useSessionStore.getState().connect();

  // Reset the notebook store first: `shell/tabs.ts` mirrors its `openPaths`
  // into the tab list, so this has to settle before tabs are cleared.
  useNotebookStore.setState({
    docs: {},
    dirty: {},
    openPaths: [],
    activePath: null,
    selectedCellId: null,
    loading: false,
    error: null,
    clipboard: null,
    lastDeleted: null,
    kernelSpecs: [],
  });
  useTabsStore.setState({ tabs: [], activeTab: null });
  useFilesStore.setState({
    entries: {},
    expanded: [],
    selected: null,
    loading: {},
    files: {},
    error: null,
  });
});

afterEach(async () => {
  const store = useNotebookStore.getState();
  for (const path of [...store.openPaths]) await store.close(path);
  setProviderFactory();
});

describe('languageForPath', () => {
  it('maps .py to python and everything else to plain', () => {
    expect(languageForPath('a.py')).toBe('python');
    expect(languageForPath('work/DEEP.PY')).toBe('python');
    expect(languageForPath('a.md')).toBe('plain');
    expect(languageForPath('a.json')).toBe('plain');
    expect(languageForPath('a.pyc')).toBe('plain');
    expect(languageForPath('README')).toBe('plain');
  });
});

describe('directory tree', () => {
  it('loadDir populates entries and clears the loading flag', async () => {
    await files().loadDir('');
    expect(files().entries['']).toEqual(TREE['']);
    expect(files().loading['']).toBe(false);
    expect(files().error).toBeNull();
    expect(fake.listed).toEqual(['']);
  });

  it('toggleDir expands, lazy-loads once, and collapses', async () => {
    files().toggleDir('work');
    expect(files().expanded).toEqual(['work']);
    await tick();
    expect(files().entries.work).toEqual(TREE.work);
    expect(fake.listed).toEqual(['work']);

    files().toggleDir('work');
    expect(files().expanded).toEqual([]);
    files().toggleDir('work');
    await tick();
    // Already cached: no second list() call.
    expect(fake.listed).toEqual(['work']);
  });

  it('refresh with no argument reloads root plus every known dir', async () => {
    await files().loadDir('work');
    fake.listed.length = 0;

    await files().refresh();
    expect(fake.listed.sort()).toEqual(['', 'work']);
  });

  it('select records the highlighted path', () => {
    files().select(PY);
    expect(files().selected).toBe(PY);
    files().select(null);
    expect(files().selected).toBeNull();
  });
});

describe('open documents', () => {
  it('openFile loads the text and opens a tab', async () => {
    await files().openFile(PY);

    expect(files().files[PY]).toEqual({
      text: 'print(1)',
      savedText: 'print(1)',
      dirty: false,
      language: 'python',
    });
    expect(useTabsStore.getState().tabs).toEqual([{ kind: 'file', path: PY }]);
    expect(useTabsStore.getState().activeTab).toEqual({ kind: 'file', path: PY });
  });

  it('re-opening an open file only activates its tab', async () => {
    await files().openFile(PY);
    await files().openFile(MD);
    files().setText(PY, 'edited');

    await files().openFile(PY);
    expect(fake.getFileCalls).toEqual([PY, MD]);
    expect(files().files[PY].text).toBe('edited');
    expect(useTabsStore.getState().tabs).toHaveLength(2);
    expect(useTabsStore.getState().activeTab).toEqual({ kind: 'file', path: PY });
  });

  it('setText flips dirty and flips it back when the text matches again', async () => {
    await files().openFile(PY);

    files().setText(PY, 'print(2)');
    expect(files().files[PY].dirty).toBe(true);

    files().setText(PY, 'print(1)');
    expect(files().files[PY].dirty).toBe(false);

    // Unknown path is a no-op, not a crash.
    files().setText('nope.txt', 'x');
    expect(files().files['nope.txt']).toBeUndefined();
  });

  it('saveFile writes the buffer through and clears dirty', async () => {
    await files().openFile(PY);
    files().setText(PY, 'print(2)');

    await files().saveFile(PY);
    expect(fake.saved).toEqual([[PY, 'print(2)']]);
    expect(files().files[PY].dirty).toBe(false);
    expect(files().files[PY].savedText).toBe('print(2)');

    // Saving a path that is not open does nothing.
    await files().saveFile('nope.txt');
    expect(fake.saved).toHaveLength(1);
  });

  it('closeFile drops the buffer and its tab', async () => {
    await files().openFile(PY);
    await files().openFile(MD);

    files().closeFile(PY);
    expect(files().files[PY]).toBeUndefined();
    expect(useTabsStore.getState().tabs).toEqual([{ kind: 'file', path: MD }]);
    expect(useTabsStore.getState().activeTab).toEqual({ kind: 'file', path: MD });
  });

  it('saveActiveFile saves the active file tab and ignores other tabs', async () => {
    await files().openFile(PY);
    files().setText(PY, 'print(3)');

    saveActiveFile();
    await tick();
    expect(fake.saved).toEqual([[PY, 'print(3)']]);

    useTabsStore.setState({ activeTab: { kind: 'notebook', path: NB } });
    saveActiveFile();
    await tick();
    expect(fake.saved).toHaveLength(1);
  });
});

describe('creating things', () => {
  it('createFileIn creates, refreshes and opens the new file', async () => {
    await files().createFileIn('work', 'new.txt');

    expect(fake.createdFiles).toEqual([['work', 'new.txt']]);
    expect(fake.listed).toEqual(['work']);
    expect(files().files['work/new.txt']).toBeDefined();
    expect(useTabsStore.getState().tabs).toEqual([{ kind: 'file', path: 'work/new.txt' }]);
  });

  it('createNotebookIn creates, refreshes and opens the notebook', async () => {
    await files().createNotebookIn('');

    expect(fake.createdNotebooks).toEqual(['Untitled.ipynb']);
    expect(fake.listed).toEqual(['']);
    expect(useNotebookStore.getState().openPaths).toEqual(['Untitled.ipynb']);
    expect(useTabsStore.getState().tabs).toEqual([
      { kind: 'notebook', path: 'Untitled.ipynb' },
    ]);
  });

  it('createFolderIn creates and refreshes without opening anything', async () => {
    await files().createFolderIn('work', 'sub');

    expect(fake.createdDirs).toEqual([['work', 'sub']]);
    expect(fake.listed).toEqual(['work']);
    expect(useTabsStore.getState().tabs).toEqual([]);
  });

  it('upload sends each file in order then refreshes once', async () => {
    await files().upload('work', fakeFileList(['one.csv', 'two.csv']));

    expect(fake.uploaded).toEqual([
      ['work', 'one.csv'],
      ['work', 'two.csv'],
    ]);
    expect(fake.listed).toEqual(['work']);
  });
});

describe('rename and remove', () => {
  it('rename repoints an open file document and its tab', async () => {
    await files().openFile(MD);
    files().setText(MD, '# edited');

    await files().rename(MD, 'renamed.md');

    expect(fake.renamed).toEqual([[MD, 'work/renamed.md']]);
    expect(files().files[MD]).toBeUndefined();
    expect(files().files['work/renamed.md'].text).toBe('# edited');
    expect(useTabsStore.getState().tabs).toEqual([{ kind: 'file', path: 'work/renamed.md' }]);
    expect(useTabsStore.getState().activeTab).toEqual({ kind: 'file', path: 'work/renamed.md' });
    // The parent dir is the one refreshed.
    expect(fake.listed).toEqual(['work']);
  });

  it('rename of a root-level path has no parent segment', async () => {
    await files().rename(PY, 'b.py');
    expect(fake.renamed).toEqual([[PY, 'b.py']]);
    expect(fake.listed).toEqual(['']);
  });

  it('remove closes an open file and refreshes its parent', async () => {
    await files().openFile(MD);

    await files().remove(MD);
    expect(fake.deleted).toEqual([MD]);
    expect(files().files[MD]).toBeUndefined();
    expect(useTabsStore.getState().tabs).toEqual([]);
    expect(fake.listed).toEqual(['work']);
  });

  it('removing a folder closes every open file under it', async () => {
    await files().openFile(MD);
    await files().openFile(PY);

    await files().remove('work');
    expect(files().files[MD]).toBeUndefined();
    expect(files().files[PY]).toBeDefined();
    expect(useTabsStore.getState().tabs).toEqual([{ kind: 'file', path: PY }]);
  });

  it('remove closes a notebook open at that exact path', async () => {
    await useNotebookStore.getState().open(NB);
    expect(useNotebookStore.getState().openPaths).toEqual([NB]);

    await files().remove(NB);
    await tick();

    expect(fake.deleted).toEqual([NB]);
    expect(useNotebookStore.getState().openPaths).toEqual([]);
    expect(useTabsStore.getState().tabs).toEqual([]);
  });
});

describe('failure handling', () => {
  it('records a provider rejection in error instead of throwing', async () => {
    fake.fail.list = 'boom';
    await expect(files().loadDir('')).resolves.toBeUndefined();

    expect(files().error).toBe('boom');
    expect(files().entries['']).toBeUndefined();
    expect(files().loading['']).toBe(false);
  });

  it('a failed getFile leaves no half-open document or tab', async () => {
    fake.fail.getFile = 'unreadable';
    await files().openFile(PY);

    expect(files().error).toBe('unreadable');
    expect(files().files[PY]).toBeUndefined();
    expect(useTabsStore.getState().tabs).toEqual([]);
  });

  it('a failed delete leaves the open document alone', async () => {
    await files().openFile(MD);
    fake.fail.delete = 'permission denied';

    await files().remove(MD);
    expect(files().error).toBe('permission denied');
    expect(files().files[MD]).toBeDefined();
  });

  it('reports "Not connected" when there is no provider', async () => {
    useSessionStore.setState({ provider: null, connection: 'disconnected' });

    await files().loadDir('');
    expect(files().error).toBe('Not connected');

    await files().openFile(PY);
    expect(files().error).toBe('Not connected');
    expect(files().files[PY]).toBeUndefined();

    await files().createFolderIn('', 'x');
    expect(files().error).toBe('Not connected');
    expect(fake.createdDirs).toEqual([]);
  });

  it('clears a stale error on the next successful action', async () => {
    fake.fail.list = 'boom';
    await files().loadDir('');
    expect(files().error).toBe('boom');

    fake.fail.list = undefined;
    await files().loadDir('');
    expect(files().error).toBeNull();
    expect(files().entries['']).toEqual(TREE['']);
  });
});

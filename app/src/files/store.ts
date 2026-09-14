/**
 * Files store (docs/ARCHITECTURE.md "Files (M6)"). Owns two things:
 *
 * - the directory tree the browser renders (`entries`/`expanded`/`loading`),
 *   lazily filled one directory at a time through `ContentsApi.list`;
 * - every open *text* file document (`files`), the non-notebook half of the
 *   tab list. Notebooks stay in `notebook/store.ts`; this store only asks it
 *   to open/close one when a filesystem operation demands it.
 *
 * Tab bookkeeping lives in `shell/tabs.ts`: `openFile`/`closeFile`/`rename`
 * call `openTab`/`removeTab`/`renameTab` there, and `closeTab` calls back into
 * `closeFile`. That module is imported at top level but only ever touched
 * through `.getState()` inside a function body, so the cycle is safe.
 *
 * Store actions never throw: a missing provider or a rejected provider call
 * lands in `error`, the same convention as `session/store.ts` and
 * `notebook/store.ts`.
 */
import { create } from 'zustand';
import { useSessionStore } from '../session/store';
import type { ContentsEntry, SessionProvider } from '../session/types';
import { useNotebookStore } from '../notebook/store';
import { useTabsStore } from '../shell/tabs';

export interface OpenFileDoc {
  text: string;
  dirty: boolean;
  language: 'python' | 'plain'; // extension-based; only python has real CodeMirror support for now
  savedText: string;
}

export interface FilesState {
  entries: Record<string, ContentsEntry[]>; // dir path -> children ('' = root)
  expanded: string[]; // Set<dir>, represented as an array
  selected: string | null; // path currently selected in the tree (keyboard nav)
  loading: Record<string, boolean>; // dir -> a list() call is in flight
  files: Record<string, OpenFileDoc>; // path -> open text-file document
  error: string | null;

  loadDir(dir: string): Promise<void>;
  toggleDir(dir: string): void;
  refresh(dir?: string): Promise<void>;
  openFile(path: string): Promise<void>;
  setText(path: string, text: string): void;
  saveFile(path: string): Promise<void>;
  closeFile(path: string): void;
  createNotebookIn(dir: string): Promise<void>;
  createFileIn(dir: string, name: string): Promise<void>;
  createFolderIn(dir: string, name: string): Promise<void>;
  rename(path: string, newName: string): Promise<void>;
  remove(path: string): Promise<void>;
  upload(dir: string, fileList: FileList): Promise<void>;
  select(path: string | null): void;
}

/** Language for a path, by extension. Exported so FileEditor/FileBrowser can reuse it without re-deriving. */
export function languageForPath(path: string): 'python' | 'plain' {
  const dot = path.lastIndexOf('.');
  const ext = dot === -1 ? '' : path.slice(dot + 1).toLowerCase();
  return ext === 'py' ? 'python' : 'plain';
}

/** `''` for a root-level path, else everything before the last `/`. */
function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const useFilesStore = create<FilesState>((set, get) => {
  /**
   * The connected provider, or null after recording 'Not connected'. Every
   * action funnels through this so a disconnected store reports instead of
   * throwing.
   */
  function requireProvider(): SessionProvider | null {
    const provider = useSessionStore.getState().provider;
    if (!provider) {
      set({ error: 'Not connected' });
      return null;
    }
    set({ error: null });
    return provider;
  }

  return {
    entries: {},
    expanded: [],
    selected: null,
    loading: {},
    files: {},
    error: null,

    loadDir: async (dir) => {
      const provider = requireProvider();
      if (!provider) return;
      set((s) => ({ loading: { ...s.loading, [dir]: true } }));
      try {
        const listed = await provider.contents.list(dir);
        set((s) => ({ entries: { ...s.entries, [dir]: listed } }));
      } catch (e) {
        set({ error: errorMessage(e) });
      } finally {
        set((s) => ({ loading: { ...s.loading, [dir]: false } }));
      }
    },

    toggleDir: (dir) => {
      const wasExpanded = get().expanded.includes(dir);
      set((s) => ({
        expanded: wasExpanded ? s.expanded.filter((d) => d !== dir) : [...s.expanded, dir],
      }));
      // Lazily fill a directory the first time it opens; the tree renders the
      // `loading` flag meanwhile, so this does not need awaiting.
      if (!wasExpanded && get().entries[dir] === undefined) void get().loadDir(dir);
    },

    refresh: async (dir) => {
      if (dir !== undefined) {
        await get().loadDir(dir);
        return;
      }
      const dirs = new Set<string>(['', ...Object.keys(get().entries)]);
      await Promise.all([...dirs].map((d) => get().loadDir(d)));
    },

    openFile: async (path) => {
      if (get().files[path]) {
        // Already buffered: just surface its tab, never re-read from disk and
        // clobber unsaved edits.
        set({ error: null });
        useTabsStore.getState().openTab({ kind: 'file', path });
        return;
      }
      const provider = requireProvider();
      if (!provider) return;
      try {
        const text = await provider.contents.getFile(path);
        set((s) => ({
          files: {
            ...s.files,
            [path]: { text, dirty: false, language: languageForPath(path), savedText: text },
          },
        }));
      } catch (e) {
        set({ error: errorMessage(e) });
        return;
      }
      useTabsStore.getState().openTab({ kind: 'file', path });
    },

    setText: (path, text) => {
      set((s) => {
        const doc = s.files[path];
        if (!doc) return s;
        return { files: { ...s.files, [path]: { ...doc, text, dirty: text !== doc.savedText } } };
      });
    },

    saveFile: async (path) => {
      const doc = get().files[path];
      if (!doc) return;
      const provider = requireProvider();
      if (!provider) return;
      const text = doc.text;
      try {
        await provider.contents.saveFile(path, text);
      } catch (e) {
        set({ error: errorMessage(e) });
        return;
      }
      set((s) => {
        const current = s.files[path];
        if (!current) return s;
        // `dirty` compares against the text that actually reached the server,
        // so edits made while the save was in flight stay dirty.
        return {
          files: { ...s.files, [path]: { ...current, savedText: text, dirty: current.text !== text } },
        };
      });
    },

    closeFile: (path) => {
      // No confirmation here: prompting about unsaved edits is the UI's job,
      // done by whoever calls `tabs.closeTab` (see notebook/TabsBar.tsx).
      set((s) => {
        if (!s.files[path]) return s;
        const files = { ...s.files };
        delete files[path];
        return { files };
      });
      useTabsStore.getState().removeTab({ kind: 'file', path });
    },

    createNotebookIn: async (dir) => {
      const provider = requireProvider();
      if (!provider) return;
      let path: string;
      try {
        path = await provider.contents.createNotebook(dir);
      } catch (e) {
        set({ error: errorMessage(e) });
        return;
      }
      await get().refresh(dir);
      await useNotebookStore.getState().open(path);
    },

    createFileIn: async (dir, name) => {
      const provider = requireProvider();
      if (!provider) return;
      let path: string;
      try {
        path = await provider.contents.createFile(dir, name);
      } catch (e) {
        set({ error: errorMessage(e) });
        return;
      }
      await get().refresh(dir);
      await get().openFile(path);
    },

    createFolderIn: async (dir, name) => {
      const provider = requireProvider();
      if (!provider) return;
      try {
        await provider.contents.createDirectory(dir, name);
      } catch (e) {
        set({ error: errorMessage(e) });
        return;
      }
      await get().refresh(dir);
    },

    rename: async (path, newName) => {
      const provider = requireProvider();
      if (!provider) return;
      const parent = parentOf(path);
      const newPath = parent ? `${parent}/${newName}` : newName;
      try {
        await provider.contents.rename(path, newPath);
      } catch (e) {
        set({ error: errorMessage(e) });
        return;
      }
      await get().refresh(parent);

      if (get().files[path] && newPath !== path) {
        set((s) => {
          const doc = s.files[path];
          if (!doc) return s;
          const files = { ...s.files };
          delete files[path];
          files[newPath] = doc;
          return { files };
        });
        useTabsStore.getState().renameTab('file', path, newPath);
      }
      // An open NOTEBOOK keeps pointing at its old path: the notebook store has
      // no rename primitive (its kernel session is keyed by path), so rekeying
      // it here would desync `docs`/`sessions`. Known M6 gap.
    },

    remove: async (path) => {
      const provider = requireProvider();
      if (!provider) return;
      try {
        await provider.contents.delete(path);
      } catch (e) {
        set({ error: errorMessage(e) });
        return;
      }
      await get().refresh(parentOf(path));

      const prefix = `${path}/`;
      for (const open of Object.keys(get().files)) {
        if (open === path || open.startsWith(prefix)) get().closeFile(open);
      }
      if (useNotebookStore.getState().docs[path]) {
        // Best-effort: the file is already gone, so a failed shutdown must not
        // fail the removal.
        void useNotebookStore
          .getState()
          .close(path)
          .catch(() => undefined);
      }
    },

    upload: async (dir, fileList) => {
      const provider = requireProvider();
      if (!provider) return;
      try {
        // Sequential on purpose: uploads are rare and ordering keeps the
        // server-side name collision handling predictable.
        for (const file of Array.from(fileList)) {
          await provider.contents.upload(dir, file);
        }
      } catch (e) {
        set({ error: errorMessage(e) });
        return;
      }
      await get().refresh(dir);
    },

    select: (path) => set({ selected: path }),
  };
});

/** Saves the currently-active file tab, if there is one. Called by files.saveActive and by notebook.save's wrapper (other agents wire those commands). */
export function saveActiveFile(): void {
  const active = useTabsStore.getState().activeTab;
  if (active?.kind !== 'file') return;
  void useFilesStore.getState().saveFile(active.path);
}

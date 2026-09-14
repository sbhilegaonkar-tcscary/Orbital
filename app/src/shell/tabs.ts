/**
 * The tab seam (docs/ARCHITECTURE.md "Files (M6)"). `useTabsStore` is the
 * single source of truth for tab ORDER and which tab is ACTIVE, across both
 * notebook and file tabs. `TabsBar` renders from it exclusively.
 *
 * It does not own document lifecycle:
 * - Notebook tabs are driven entirely by `notebook/store.ts`'s own
 *   `openPaths`/`activePath`. This file subscribes to that store and mirrors
 *   additions/removals/activation into `tabs`/`activeTab` — it never mutates
 *   `openPaths` itself. This keeps the pre-existing notebook store untouched.
 * - File tabs are driven by `files/store.ts`: `openFile`/`closeFile` call
 *   `openTab`/`removeTab` here directly, since that store was designed
 *   alongside this seam.
 *
 * `closeTab` is the one "smart", kind-aware entry point (used by the tab's ×
 * button): it delegates to the store that owns the document so the doc
 * actually closes (kernel shutdown for notebooks, discarding the buffer for
 * files), which in turn updates the tab list — via the mirror for notebooks,
 * via a direct `removeTab` call for files. `removeTab` itself is a plain
 * bookkeeping primitive with no further delegation, so that path terminates
 * instead of recursing back into `closeTab`.
 *
 * `files/store.ts` is imported here only for `closeTab`'s file branch; it
 * imports this module back for `openTab`/`removeTab`. Both sides only touch
 * the other through `.getState()` inside function bodies (never at module
 * top level), so the circular import is safe under ESM/Vite.
 */
import { create } from 'zustand';
import { useNotebookStore } from '../notebook/store';
import { useFilesStore } from '../files/store';

export interface TabRef {
  kind: 'notebook' | 'file';
  path: string;
}

interface TabsState {
  tabs: TabRef[];
  activeTab: TabRef | null;

  /** Bookkeeping: add (or just activate, if already present) a tab. No cross-store delegation. */
  openTab(tab: TabRef): void;
  /** Smart: delegates to the owning store, which closes the document and reports back here. */
  closeTab(tab: TabRef): void;
  /** Bookkeeping: remove a tab if present, reassigning `activeTab` if it was active. */
  removeTab(tab: TabRef): void;
  activateTab(tab: TabRef): void;
  nextTab(): void;
  prevTab(): void;
  /** Bookkeeping: repoints a tab (and `activeTab`, if it matches) at a new path after a rename. */
  renameTab(kind: TabRef['kind'], oldPath: string, newPath: string): void;
}

function sameTab(a: TabRef, b: TabRef): boolean {
  return a.kind === b.kind && a.path === b.path;
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeTab: null,

  openTab: (tab) => {
    set((s) => {
      const exists = s.tabs.some((t) => sameTab(t, tab));
      return { tabs: exists ? s.tabs : [...s.tabs, tab], activeTab: tab };
    });
  },

  closeTab: (tab) => {
    if (tab.kind === 'notebook') {
      void useNotebookStore.getState().close(tab.path);
    } else {
      useFilesStore.getState().closeFile(tab.path);
    }
  },

  removeTab: (tab) => {
    set((s) => {
      const tabs = s.tabs.filter((t) => !sameTab(t, tab));
      if (!s.activeTab || !sameTab(s.activeTab, tab)) {
        return { tabs };
      }
      // Fall back to the tab that was to the left, else the new last tab.
      const idx = s.tabs.findIndex((t) => sameTab(t, tab));
      const fallback = tabs[Math.min(idx, tabs.length - 1)] ?? null;
      return { tabs, activeTab: fallback };
    });
  },

  activateTab: (tab) => {
    set({ activeTab: tab });
    if (tab.kind === 'notebook') useNotebookStore.getState().activate(tab.path);
  },

  nextTab: () => {
    const { tabs, activeTab } = get();
    if (tabs.length === 0) return;
    const idx = activeTab ? tabs.findIndex((t) => sameTab(t, activeTab)) : -1;
    const next = tabs[(idx + 1) % tabs.length];
    get().activateTab(next);
  },

  prevTab: () => {
    const { tabs, activeTab } = get();
    if (tabs.length === 0) return;
    const idx = activeTab ? tabs.findIndex((t) => sameTab(t, activeTab)) : 0;
    const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
    get().activateTab(prev);
  },

  renameTab: (kind, oldPath, newPath) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.kind === kind && t.path === oldPath ? { kind, path: newPath } : t)),
      activeTab:
        s.activeTab && s.activeTab.kind === kind && s.activeTab.path === oldPath
          ? { kind, path: newPath }
          : s.activeTab,
    }));
  },
}));

// ---- mirror notebook/store.ts's openPaths/activePath into this store ------

let prevOpenPaths: string[] = [];
let prevActivePath: string | null = null;

useNotebookStore.subscribe((state) => {
  const paths = state.openPaths;

  if (paths !== prevOpenPaths) {
    for (const path of paths) {
      if (!prevOpenPaths.includes(path)) {
        useTabsStore.setState((s) => ({ tabs: [...s.tabs, { kind: 'notebook', path }] }));
      }
    }
    for (const path of prevOpenPaths) {
      if (!paths.includes(path)) {
        useTabsStore.getState().removeTab({ kind: 'notebook', path });
      }
    }
    prevOpenPaths = paths;
  }

  if (state.activePath !== prevActivePath) {
    prevActivePath = state.activePath;
    if (state.activePath) {
      useTabsStore.setState({ activeTab: { kind: 'notebook', path: state.activePath } });
    } else {
      // The notebook side has nothing active; leave a currently-active file
      // tab alone, only clearing/falling back when a notebook tab was active.
      const current = useTabsStore.getState().activeTab;
      if (current?.kind === 'notebook') {
        const tabs = useTabsStore.getState().tabs;
        useTabsStore.setState({ activeTab: tabs[tabs.length - 1] ?? null });
      }
    }
  }
});

/**
 * Cross-component registry from cell id to its live CodeMirror editor.
 * `CodeEditor` registers itself on mount and removes itself on unmount
 * (code cells always; markdown cells only while their source editor is
 * mounted, i.e. while `MarkdownCell` is in edit state).
 *
 * `Cell.tsx`/`Notebook.tsx` never touch a `EditorView` directly — they call
 * `editorRegistry.focus(id)` to enter edit mode, and `getCursor`/`setCursor`
 * for the exact-cursor split (Ctrl+Shift+-).
 *
 * Two extra concerns live here because they are keyed the same way
 * (per-cell, outside the notebook store, see docs/KEYBOARD.md's "L" row):
 *  - a focus *request* channel, so `editorRegistry.focus(id)` can reach a
 *    markdown cell that is not currently editing (nothing is registered for
 *    it yet) and ask it to start editing, instead of doing nothing;
 *  - a module-level set of cell ids with line numbers toggled on, since the
 *    store owns nothing about per-cell UI chrome.
 */
import { useSyncExternalStore } from 'react';
import type { EditorView } from '@codemirror/view';

export interface EditorHandle {
  focus(): void;
  getCursor(): number;
  setCursor(pos: number): void;
  view: EditorView;
}

const registry = new Map<string, EditorHandle>();
/** ids whose editor was asked to focus before it existed (e.g. a brand new cell). */
const pendingFocus = new Set<string>();
/** ids that want to know when something asks them to enter edit mode (markdown, not currently editing). */
const focusRequestHandlers = new Map<string, () => void>();

const lineNumberCells = new Set<string>();
const lineNumberListeners = new Set<() => void>();

function notifyLineNumbers(): void {
  for (const cb of lineNumberListeners) cb();
}

export const editorRegistry = {
  /** Called by `CodeEditor` once its view exists. */
  register(id: string, handle: EditorHandle): void {
    registry.set(id, handle);
    // A cell created this tick registers during mount, and its parent Cell's
    // own mount effect focuses the cell element right after. Defer one frame
    // so the editor focus lands last and the new cell opens in edit mode.
    // Focus whichever handle is registered when the frame fires: React's dev
    // StrictMode mounts, unmounts and remounts, so `handle` may be stale.
    if (pendingFocus.delete(id)) {
      requestAnimationFrame(() => registry.get(id)?.focus());
    }
  },

  /** Called by `CodeEditor`'s cleanup. */
  unregister(id: string): void {
    registry.delete(id);
  },

  has(id: string): boolean {
    return registry.has(id);
  },

  /**
   * Enters edit mode on `id`: focuses its editor if one is mounted, asks a
   * not-yet-editing markdown cell to start editing (see `onFocusRequest`),
   * or — if neither exists yet, e.g. a code cell inserted this tick — waits
   * until `register()` is called for it.
   */
  focus(id: string): void {
    const handle = registry.get(id);
    if (handle) {
      handle.focus();
      return;
    }
    const onRequest = focusRequestHandlers.get(id);
    if (onRequest) {
      onRequest();
      return;
    }
    pendingFocus.add(id);
  },

  /** Character offset of the caret, or null if `id` has no mounted editor. */
  getCursor(id: string): number | null {
    return registry.get(id)?.getCursor() ?? null;
  },

  setCursor(id: string, pos: number): void {
    registry.get(id)?.setCursor(pos);
  },

  /**
   * A cell (markdown, while rendered/not-editing) registers a callback here
   * so `focus(id)` can ask it to start editing. Returns an unsubscribe.
   */
  onFocusRequest(id: string, cb: () => void): () => void {
    focusRequestHandlers.set(id, cb);
    return () => {
      if (focusRequestHandlers.get(id) === cb) focusRequestHandlers.delete(id);
    };
  },

  /** Drops every trace of `id` — call when a cell is actually deleted. */
  forgetCell(id: string): void {
    registry.delete(id);
    pendingFocus.delete(id);
    focusRequestHandlers.delete(id);
    if (lineNumberCells.delete(id)) notifyLineNumbers();
  },
};

/** L: toggle line numbers for one cell (command mode, see docs/KEYBOARD.md). */
export function toggleLineNumbers(id: string): void {
  if (!lineNumberCells.delete(id)) lineNumberCells.add(id);
  notifyLineNumbers();
}

export function hasLineNumbers(id: string): boolean {
  return lineNumberCells.has(id);
}

/** Reactive read of `hasLineNumbers(id)`, for `CodeEditor`'s `lineNumbers` prop. */
export function useLineNumbers(id: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      lineNumberListeners.add(onChange);
      return () => lineNumberListeners.delete(onChange);
    },
    () => lineNumberCells.has(id),
  );
}

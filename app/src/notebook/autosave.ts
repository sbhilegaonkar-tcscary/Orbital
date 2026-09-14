/**
 * Autosave: 2s after any open document becomes dirty, save it. Also saves
 * every dirty document immediately when the tab is hidden or unloaded.
 * Installed once from `notebook/commands.ts`'s module init (see
 * `installAutosave` there being called at import time).
 *
 * Status for the toolbar area (not owned by this file — `Notebook.tsx`
 * renders a `.autosave-status` line using `useAutosaveStatus()`) lives here
 * too, keyed by path, since it is naturally produced by the same saves.
 */
import { useSyncExternalStore } from 'react';
import { useNotebookStore } from './store';

const DEBOUNCE_MS = 2000;

interface AutosaveInfo {
  status: 'saving' | 'saved';
  savedAt: number | null;
}

const info = new Map<string, AutosaveInfo>();
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlight = new Set<string>();
let installed = false;

function notify(): void {
  for (const cb of listeners) cb();
}

function setInfo(path: string, next: AutosaveInfo): void {
  info.set(path, next);
  notify();
}

async function saveNow(path: string): Promise<void> {
  // Skip while a save is already in flight for this path.
  if (inFlight.has(path)) return;
  inFlight.add(path);
  setInfo(path, { status: 'saving', savedAt: info.get(path)?.savedAt ?? null });
  try {
    await useNotebookStore.getState().save(path);
    setInfo(path, { status: 'saved', savedAt: Date.now() });
  } finally {
    inFlight.delete(path);
  }
}

function scheduleSave(path: string): void {
  const existing = timers.get(path);
  if (existing) clearTimeout(existing);
  timers.set(
    path,
    setTimeout(() => {
      timers.delete(path);
      void saveNow(path);
    }, DEBOUNCE_MS),
  );
}

/** Saves every currently-dirty document right away (no debounce). */
function saveAllDirtyNow(): void {
  const { dirty } = useNotebookStore.getState();
  for (const path of Object.keys(dirty)) {
    if (dirty[path]) void saveNow(path);
  }
}

/** Idempotent: safe to call from multiple modules, only wires up once. */
export function installAutosave(): void {
  if (installed) return;
  installed = true;

  let prevDirty = useNotebookStore.getState().dirty;
  useNotebookStore.subscribe((state) => {
    const dirty = state.dirty;
    if (dirty === prevDirty) return;
    for (const path of Object.keys(dirty)) {
      if (dirty[path] && !prevDirty[path]) scheduleSave(path);
    }
    prevDirty = dirty;
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveAllDirtyNow();
  });
  // Best-effort: browsers do not reliably await async work here, but the
  // underlying fetch/save calls are still issued.
  window.addEventListener('beforeunload', () => {
    saveAllDirtyNow();
  });
}

/** "Saving…" / "Saved · HH:MM" / null for the active document, live. */
export function useAutosaveStatus(): string | null {
  const path = useNotebookStore((s) => s.activePath);
  const snapshot = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => (path ? (info.get(path) ?? null) : null),
  );

  if (!snapshot) return null;
  if (snapshot.status === 'saving') return 'Saving…';
  if (snapshot.savedAt == null) return null;
  const d = new Date(snapshot.savedAt);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `Saved · ${hh}:${mm}`;
}

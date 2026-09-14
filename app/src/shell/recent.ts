/**
 * Recently opened notebooks, for the Home view's "Recent" list
 * (docs/DESIGN.md's calm start page). This module wires itself into
 * `notebook/store.ts` at import time: whenever `activePath` changes to a
 * new, non-null path, that path is pushed to the front of a capped,
 * deduplicated list persisted under `orbital.recent`. `HomeView` reads it
 * through `useRecent()`.
 */
import { useSyncExternalStore } from 'react';
import { useNotebookStore } from '../notebook/store';

export interface RecentEntry {
  path: string;
  /** epoch ms, when this path was last opened. */
  openedAt: number;
}

const STORAGE_KEY = 'orbital.recent';
const MAX_ENTRIES = 10;

/** Null outside a browser (the vitest node environment). */
function storage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    // Safari in private mode throws on access rather than returning null.
    return null;
  }
}

function isRecentEntry(v: unknown): v is RecentEntry {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as RecentEntry).path === 'string' &&
    typeof (v as RecentEntry).openedAt === 'number'
  );
}

function load(): RecentEntry[] {
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecentEntry) : [];
  } catch {
    return [];
  }
}

function save(): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota or private mode: recents are a convenience, not state we own.
  }
}

let entries: RecentEntry[] = load();
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

export function getRecent(): RecentEntry[] {
  return entries;
}

/** Moves `path` to the front with a fresh timestamp, capped at MAX_ENTRIES. */
export function recordOpened(path: string): void {
  entries = [{ path, openedAt: Date.now() }, ...entries.filter((e) => e.path !== path)].slice(0, MAX_ENTRIES);
  save();
  notify();
}

export function useRecent(): RecentEntry[] {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getRecent,
  );
}

/** Basename and containing directory of a contents-API path ('/'-joined, no leading slash). */
export function splitPath(path: string): { name: string; dir: string } {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? { name: path, dir: '' } : { name: path.slice(idx + 1), dir: path.slice(0, idx) };
}

/** Coarse relative-time label ("just now", "5m ago", "3d ago", ...). */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const sec = Math.max(0, Math.round((now - ts) / 1000));
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

/** Test seam: clears the in-memory list and storage without reloading the module. */
export function resetRecentForTests(): void {
  entries = [];
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Quota or private mode: nothing to clean up.
  }
  notify();
}

// ---- wire into notebook/store.ts's activePath -----------------------------

let prevActivePath: string | null = null;
useNotebookStore.subscribe((state) => {
  if (state.activePath && state.activePath !== prevActivePath) {
    recordOpened(state.activePath);
  }
  prevActivePath = state.activePath;
});

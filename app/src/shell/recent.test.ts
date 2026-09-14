/**
 * `recent.ts` tests: the capped/deduplicated list itself, the formatting
 * helpers `HomeView` renders with, and the wiring to `notebook/store.ts`'s
 * `activePath` (no live server needed — `activePath` is set directly).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useNotebookStore } from '../notebook/store';
import { getRecent, recordOpened, relativeTime, resetRecentForTests, splitPath } from './recent';

describe('recent', () => {
  beforeEach(() => {
    resetRecentForTests();
    useNotebookStore.setState({ activePath: null });
  });

  it('records a path with a timestamp, most-recent first', () => {
    recordOpened('a.ipynb');
    recordOpened('b.ipynb');
    expect(getRecent().map((e) => e.path)).toEqual(['b.ipynb', 'a.ipynb']);
  });

  it('moves a re-opened path to the front instead of duplicating it', () => {
    recordOpened('a.ipynb');
    recordOpened('b.ipynb');
    recordOpened('a.ipynb');
    expect(getRecent().map((e) => e.path)).toEqual(['a.ipynb', 'b.ipynb']);
  });

  it('caps the list at 10 entries', () => {
    for (let i = 0; i < 12; i += 1) recordOpened(`nb${i}.ipynb`);
    expect(getRecent()).toHaveLength(10);
    expect(getRecent()[0].path).toBe('nb11.ipynb');
  });

  it('is wired to activePath changes on the notebook store', () => {
    useNotebookStore.setState({ activePath: 'live.ipynb' });
    expect(getRecent()[0].path).toBe('live.ipynb');
  });

  it('does not record when activePath is cleared to null', () => {
    useNotebookStore.setState({ activePath: 'x.ipynb' });
    useNotebookStore.setState({ activePath: null });
    expect(getRecent()).toHaveLength(1);
    expect(getRecent()[0].path).toBe('x.ipynb');
  });

  it('splitPath separates the basename from the directory', () => {
    expect(splitPath('work/notes/a.ipynb')).toEqual({ name: 'a.ipynb', dir: 'work/notes' });
    expect(splitPath('a.ipynb')).toEqual({ name: 'a.ipynb', dir: '' });
  });

  describe('relativeTime', () => {
    it('formats coarse buckets relative to a fixed "now"', () => {
      const now = 1_000_000_000;
      expect(relativeTime(now - 2 * 1000, now)).toBe('just now');
      expect(relativeTime(now - 30 * 1000, now)).toBe('30s ago');
      expect(relativeTime(now - 5 * 60 * 1000, now)).toBe('5m ago');
      expect(relativeTime(now - 3 * 3600 * 1000, now)).toBe('3h ago');
      expect(relativeTime(now - 2 * 86400 * 1000, now)).toBe('2d ago');
    });
  });
});

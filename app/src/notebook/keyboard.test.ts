import { describe, expect, it } from 'vitest';
import { resolveKey, type KeyLike } from './Notebook';

/** A fake DOM target: only `classList.contains` is ever consulted. */
function target(classes: string[]): KeyLike['target'] {
  return { classList: { contains: (c: string) => classes.includes(c) } } as unknown as KeyLike['target'];
}

const CELL = target(['cell']);
const NOT_CELL = target(['cell-body']);

const BASE: KeyLike = {
  key: '',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  target: CELL,
};

const chord = (lastDeleteAt = 0) => ({ now: 1_000, lastDeleteAt });

describe('resolveKey — Shift+Enter (docs/KEYBOARD.md "Running")', () => {
  it('runs and advances in edit mode, regardless of target', () => {
    const result = resolveKey({ ...BASE, key: 'Enter', shiftKey: true, target: NOT_CELL }, 'edit', chord());
    expect(result.action).toEqual({ type: 'runAndAdvance' });
  });

  it('runs and advances in command mode too — "Same" in both columns', () => {
    const result = resolveKey({ ...BASE, key: 'Enter', shiftKey: true }, 'command', chord());
    expect(result.action).toEqual({ type: 'runAndAdvance' });
  });
});

describe('resolveKey — single-letter command shortcuts only fire on a .cell target', () => {
  it('fires when the target is the cell section itself', () => {
    const result = resolveKey({ ...BASE, key: 'a', target: CELL }, 'command', chord());
    expect(result.action).toEqual({ type: 'insertAbove' });
  });

  it('is ignored when the target is not a .cell (e.g. body, or a non-cell descendant)', () => {
    const result = resolveKey({ ...BASE, key: 'a', target: NOT_CELL }, 'command', chord());
    expect(result.action).toBeNull();
  });

  it('is ignored when target is null (focus nowhere in particular)', () => {
    const result = resolveKey({ ...BASE, key: 'a', target: null }, 'command', chord());
    expect(result.action).toBeNull();
  });

  it('is ignored in edit mode even if (hypothetically) the target were a .cell', () => {
    const result = resolveKey({ ...BASE, key: 'a', target: CELL }, 'edit', chord());
    expect(result.action).toBeNull();
  });

  it('ignores a held Ctrl/Alt so browser/editor shortcuts sharing the letter are not hijacked', () => {
    const ctrlA = resolveKey({ ...BASE, key: 'a', ctrlKey: true, target: CELL }, 'command', chord());
    expect(ctrlA.action).toBeNull();
    const altA = resolveKey({ ...BASE, key: 'a', altKey: true, target: CELL }, 'command', chord());
    expect(altA.action).toBeNull();
  });

  it('still allows Shift+letter rows (Shift+M, Shift+O) distinct from their bare-letter counterparts', () => {
    const shiftM = resolveKey({ ...BASE, key: 'M', shiftKey: true, target: CELL }, 'command', chord());
    expect(shiftM.action).toEqual({ type: 'mergeBelow' });
    const bareM = resolveKey({ ...BASE, key: 'm', target: CELL }, 'command', chord());
    expect(bareM.action).toEqual({ type: 'setMarkdown' });
  });
});

describe('resolveKey — D D delete chord (500ms window)', () => {
  it('does nothing on the first D and records the timestamp', () => {
    const result = resolveKey({ ...BASE, key: 'd', target: CELL }, 'command', chord(0));
    expect(result.action).toBeNull();
    expect(result.lastDeleteAt).toBe(1_000);
  });

  it('deletes on a second D within 500ms and resets the timer', () => {
    const result = resolveKey({ ...BASE, key: 'd', target: CELL }, 'command', chord(600));
    expect(result.action).toEqual({ type: 'deleteSelected' });
    expect(result.lastDeleteAt).toBe(0);
  });

  it('does not delete, and restarts the timer, when the second D arrives too late', () => {
    const result = resolveKey({ ...BASE, key: 'd', target: CELL }, 'command', chord(400));
    expect(result.action).toBeNull();
    expect(result.lastDeleteAt).toBe(1_000);
  });

  it('treats exactly 500ms as too late (the window is exclusive)', () => {
    const result = resolveKey({ ...BASE, key: 'd', target: CELL }, 'command', chord(500));
    expect(result.action).toBeNull();
  });
});

describe('resolveKey — Esc in edit mode', () => {
  it('leaves edit mode when nothing else consumed the key', () => {
    const result = resolveKey({ ...BASE, key: 'Escape' }, 'edit', chord());
    expect(result.action).toEqual({ type: 'leaveEditMode' });
  });

  it('does nothing when CodeMirror already handled it (closing a popup)', () => {
    const result = resolveKey({ ...BASE, key: 'Escape', defaultPrevented: true }, 'edit', chord());
    expect(result.action).toBeNull();
  });

  it('is a no-op in command mode (Esc is edit-mode-only)', () => {
    const result = resolveKey({ ...BASE, key: 'Escape', target: CELL }, 'command', chord());
    expect(result.action).toBeNull();
  });
});

describe('resolveKey — other Running-table rows (both modes, docs/KEYBOARD.md)', () => {
  it('Ctrl+Enter runs and stays put', () => {
    const result = resolveKey({ ...BASE, key: 'Enter', ctrlKey: true }, 'edit', chord());
    expect(result.action).toEqual({ type: 'runStay' });
  });

  it('Alt+Enter runs, inserts below, and edits it', () => {
    const result = resolveKey({ ...BASE, key: 'Enter', altKey: true }, 'command', chord());
    expect(result.action).toEqual({ type: 'runInsertBelow' });
  });

  it('Ctrl+Shift+A runs above', () => {
    const result = resolveKey({ ...BASE, key: 'a', ctrlKey: true, shiftKey: true }, 'command', chord());
    expect(result.action).toEqual({ type: 'runAbove' });
  });

  it('Ctrl+Shift+B runs below', () => {
    const result = resolveKey({ ...BASE, key: 'b', ctrlKey: true, shiftKey: true }, 'edit', chord());
    expect(result.action).toEqual({ type: 'runBelow' });
  });
});

describe('resolveKey — split at cursor (edit mode only)', () => {
  it('splits on Ctrl+Shift+- while editing', () => {
    const result = resolveKey({ ...BASE, key: '-', ctrlKey: true, shiftKey: true }, 'edit', chord());
    expect(result.action).toEqual({ type: 'splitAtCursor' });
  });

  it('does nothing in command mode', () => {
    const result = resolveKey({ ...BASE, key: '-', ctrlKey: true, shiftKey: true, target: CELL }, 'command', chord());
    expect(result.action).toBeNull();
  });
});

describe('resolveKey — command-mode rows', () => {
  it('K / J select previous / next, same as the arrow keys', () => {
    expect(resolveKey({ ...BASE, key: 'k', target: CELL }, 'command', chord()).action).toEqual({
      type: 'selectPrev',
    });
    expect(resolveKey({ ...BASE, key: 'ArrowUp', target: CELL }, 'command', chord()).action).toEqual({
      type: 'selectPrev',
    });
    expect(resolveKey({ ...BASE, key: 'j', target: CELL }, 'command', chord()).action).toEqual({
      type: 'selectNext',
    });
    expect(resolveKey({ ...BASE, key: 'ArrowDown', target: CELL }, 'command', chord()).action).toEqual({
      type: 'selectNext',
    });
  });

  it('Shift+O toggles output collapse for all cells, distinct from bare O', () => {
    expect(resolveKey({ ...BASE, key: 'O', shiftKey: true, target: CELL }, 'command', chord()).action).toEqual({
      type: 'toggleOutputCollapseAll',
    });
    expect(resolveKey({ ...BASE, key: 'o', target: CELL }, 'command', chord()).action).toEqual({
      type: 'toggleOutputCollapse',
    });
  });

  it('L toggles line numbers', () => {
    expect(resolveKey({ ...BASE, key: 'l', target: CELL }, 'command', chord()).action).toEqual({
      type: 'toggleLineNumbers',
    });
  });

  it('? and H both open the help overlay', () => {
    expect(resolveKey({ ...BASE, key: '?', target: CELL }, 'command', chord()).action).toEqual({
      type: 'openHelp',
    });
    expect(resolveKey({ ...BASE, key: 'h', target: CELL }, 'command', chord()).action).toEqual({
      type: 'openHelp',
    });
  });

  it('plain Enter enters edit mode', () => {
    expect(resolveKey({ ...BASE, key: 'Enter', target: CELL }, 'command', chord()).action).toEqual({
      type: 'enterEditMode',
    });
  });

  it('an unmapped key resolves to no action', () => {
    expect(resolveKey({ ...BASE, key: 'q', target: CELL }, 'command', chord()).action).toBeNull();
  });
});

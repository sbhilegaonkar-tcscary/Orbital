/**
 * Renders the currently open notebook from useNotebookStore. Keyboard
 * handling is split in two: `resolveKey` (pure, exported for
 * keyboard.test.ts) decides *which* docs/KEYBOARD.md action a keydown maps
 * to, given the mode ('edit' when focus is inside a `.cm-editor`, 'command'
 * otherwise) and the raw event; `handleKeyDown` below is the impure
 * interpreter that turns that action into store calls / editorRegistry
 * calls. Single-letter command-mode shortcuts only ever fire when the
 * actual DOM target is the cell's own `.cell` section (never body, an
 * input, or inside an editor) — see docs/KEYBOARD.md "The two modes".
 */
import { useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNotebookStore, useActiveNotebook } from './store';
import { Cell } from './Cell';
import { editorRegistry, toggleLineNumbers } from './editorRegistry';
import { useAutosaveStatus } from './autosave';
import { ShortcutsHelp } from '../shell/ShortcutsHelp';
import { openShortcutsHelp, closeShortcutsHelp, useShortcutsHelpOpen } from '../shell/shortcuts';
import './notebook.css';

const DELETE_CHORD_MS = 500;

export type CellMode = 'edit' | 'command';

export type NotebookAction =
  | { type: 'runAndAdvance' }
  | { type: 'runStay' }
  | { type: 'runInsertBelow' }
  | { type: 'runAbove' }
  | { type: 'runBelow' }
  | { type: 'splitAtCursor' }
  | { type: 'leaveEditMode' }
  | { type: 'enterEditMode' }
  | { type: 'insertAbove' }
  | { type: 'insertBelow' }
  | { type: 'deleteSelected' }
  | { type: 'setMarkdown' }
  | { type: 'setCode' }
  | { type: 'cut' }
  | { type: 'copy' }
  | { type: 'paste' }
  | { type: 'undoDelete' }
  | { type: 'mergeBelow' }
  | { type: 'toggleOutputCollapse' }
  | { type: 'toggleOutputCollapseAll' }
  | { type: 'toggleLineNumbers' }
  | { type: 'openHelp' }
  | { type: 'selectPrev' }
  | { type: 'selectNext' };

/** Minimal shape `resolveKey` needs — a plain object is enough for tests. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
  /** Mirrors `e.nativeEvent.defaultPrevented`: true once CodeMirror has
   * already consumed this Escape (closing a popup), per docs/KEYBOARD.md. */
  defaultPrevented?: boolean;
}

export interface ChordState {
  now: number;
  lastDeleteAt: number;
}

export interface ResolvedKey {
  action: NotebookAction | null;
  lastDeleteAt: number;
}

/**
 * Duck-typed rather than `instanceof HTMLElement` so `resolveKey` stays
 * callable with a plain event-like object in keyboard.test.ts (that test
 * runs under vitest's node environment, with no DOM globals at all).
 */
function isCellTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const classList = (target as { classList?: { contains(cls: string): boolean } }).classList;
  return !!classList?.contains('cell');
}

/**
 * Pure: given a keydown-like event, the current mode, and the D-D chord
 * timer, returns the docs/KEYBOARD.md action it maps to (or null) plus the
 * chord timer's next value. No store access, no DOM writes — safe to unit
 * test directly (see keyboard.test.ts).
 */
export function resolveKey(e: KeyLike, mode: CellMode, chord: ChordState): ResolvedKey {
  const mod = e.ctrlKey || e.metaKey;
  const none: ResolvedKey = { action: null, lastDeleteAt: chord.lastDeleteAt };
  const act = (type: NotebookAction['type']): ResolvedKey => ({
    action: { type } as NotebookAction,
    lastDeleteAt: chord.lastDeleteAt,
  });

  // Running: both modes, per docs/KEYBOARD.md "Running".
  if (e.key === 'Enter' && e.shiftKey) return act('runAndAdvance');
  if (e.key === 'Enter' && e.altKey) return act('runInsertBelow');
  if (e.key === 'Enter' && mod) return act('runStay');
  if (mod && e.shiftKey && e.key.toLowerCase() === 'a') return act('runAbove');
  if (mod && e.shiftKey && e.key.toLowerCase() === 'b') return act('runBelow');

  // Split at cursor: edit mode only.
  if (mod && e.shiftKey && (e.key === '_' || e.key === '-') && mode === 'edit') {
    return act('splitAtCursor');
  }

  // Esc, edit mode only: CodeMirror gets first refusal (closing a popup);
  // only when it did *not* handle the key do we leave edit mode.
  if (e.key === 'Escape' && mode === 'edit') {
    if (e.defaultPrevented) return none;
    return act('leaveEditMode');
  }

  // Everything below is command-mode-only AND requires the DOM target to be
  // the cell's own section — this is the fix for "letters fire on body or
  // while typing" (docs/KEYBOARD.md "The two modes").
  if (mode !== 'command' || !isCellTarget(e.target) || mod || e.altKey) return none;

  switch (e.key) {
    case 'a':
      return act('insertAbove');
    case 'b':
      return act('insertBelow');
    case 'd': {
      if (chord.now - chord.lastDeleteAt < DELETE_CHORD_MS) {
        return { action: { type: 'deleteSelected' }, lastDeleteAt: 0 };
      }
      return { action: null, lastDeleteAt: chord.now };
    }
    case 'm':
      return act('setMarkdown');
    case 'y':
      return act('setCode');
    case 'x':
      return act('cut');
    case 'c':
      return act('copy');
    case 'v':
      return act('paste');
    case 'z':
      return act('undoDelete');
    case 'M':
      return act('mergeBelow');
    case 'o':
      return act('toggleOutputCollapse');
    case 'O':
      return act('toggleOutputCollapseAll');
    case 'l':
      return act('toggleLineNumbers');
    case '?':
    case 'h':
      return act('openHelp');
    case 'Enter':
      return act('enterEditMode');
    case 'k':
    case 'ArrowUp':
      return act('selectPrev');
    case 'j':
    case 'ArrowDown':
      return act('selectNext');
    default:
      return none;
  }
}

export function Notebook() {
  const notebook = useActiveNotebook();
  const selectedCellId = useNotebookStore((s) => s.selectedCellId);
  const loading = useNotebookStore((s) => s.loading);
  const error = useNotebookStore((s) => s.error);
  const select = useNotebookStore((s) => s.select);
  const runCell = useNotebookStore((s) => s.runCell);
  const insertCell = useNotebookStore((s) => s.insertCell);
  const deleteCell = useNotebookStore((s) => s.deleteCell);
  const setCellType = useNotebookStore((s) => s.setCellType);
  const cutCells = useNotebookStore((s) => s.cutCells);
  const copyCells = useNotebookStore((s) => s.copyCells);
  const pasteCells = useNotebookStore((s) => s.pasteCells);
  const undoDelete = useNotebookStore((s) => s.undoDelete);
  const mergeWithBelow = useNotebookStore((s) => s.mergeWithBelow);
  const toggleCollapse = useNotebookStore((s) => s.toggleCollapse);
  const splitCell = useNotebookStore((s) => s.splitCell);
  const runAbove = useNotebookStore((s) => s.runAbove);
  const runBelow = useNotebookStore((s) => s.runBelow);

  const autosaveStatus = useAutosaveStatus();
  const helpOpen = useShortcutsHelpOpen();

  const lastDeleteRef = useRef(0);

  // `?fixture=1` is handled once, in NotebookView: it owns the decision of
  // what is open, and <Notebook/> only renders once something is.

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (!notebook) return;
    const mode: CellMode = e.target instanceof HTMLElement && e.target.closest('.cm-editor') ? 'edit' : 'command';
    const { action, lastDeleteAt } = resolveKey(
      {
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        target: e.target,
        defaultPrevented: e.nativeEvent.defaultPrevented,
      },
      mode,
      { now: Date.now(), lastDeleteAt: lastDeleteRef.current },
    );
    lastDeleteRef.current = lastDeleteAt;
    if (!action) return;
    e.preventDefault();

    const idx = notebook.cells.findIndex((c) => c.id === selectedCellId);

    switch (action.type) {
      case 'runAndAdvance': {
        // Advance immediately (like Jupyter) rather than after the run
        // settles: queue the run, then select and focus the next cell so
        // typing continues in the next box even while this one executes.
        if (!selectedCellId) break;
        const cells = notebook.cells;
        const idx = cells.findIndex((c) => c.id === selectedCellId);
        void runCell(selectedCellId);
        const nextId = idx >= 0 && idx < cells.length - 1 ? cells[idx + 1].id : insertCell(selectedCellId, 'code');
        select(nextId);
        editorRegistry.focus(nextId);
        break;
      }
      case 'runInsertBelow': {
        if (!selectedCellId) break;
        void runCell(selectedCellId);
        const newId = insertCell(selectedCellId, 'code');
        select(newId);
        editorRegistry.focus(newId);
        break;
      }
      case 'runStay':
        if (selectedCellId) void runCell(selectedCellId);
        break;
      case 'runAbove':
        if (selectedCellId) void runAbove(selectedCellId);
        break;
      case 'runBelow':
        if (selectedCellId) void runBelow(selectedCellId);
        break;
      case 'splitAtCursor': {
        if (!selectedCellId) break;
        const offset = editorRegistry.getCursor(selectedCellId);
        if (offset !== null) splitCell(selectedCellId, offset);
        break;
      }
      case 'leaveEditMode': {
        const cellEl = (e.target as HTMLElement).closest('.cell');
        (document.activeElement as HTMLElement | null)?.blur();
        if (cellEl instanceof HTMLElement) cellEl.focus();
        break;
      }
      case 'enterEditMode':
        if (selectedCellId) editorRegistry.focus(selectedCellId);
        break;
      case 'insertAbove': {
        const afterId = idx > 0 ? notebook.cells[idx - 1].id : null;
        select(insertCell(afterId, 'code'));
        break;
      }
      case 'insertBelow':
        select(insertCell(selectedCellId, 'code'));
        break;
      case 'deleteSelected':
        if (selectedCellId) {
          deleteCell(selectedCellId);
          editorRegistry.forgetCell(selectedCellId);
        }
        break;
      case 'setMarkdown':
        if (selectedCellId) setCellType(selectedCellId, 'markdown');
        break;
      case 'setCode':
        if (selectedCellId) setCellType(selectedCellId, 'code');
        break;
      case 'cut':
        if (selectedCellId) {
          cutCells([selectedCellId]);
          editorRegistry.forgetCell(selectedCellId);
        }
        break;
      case 'copy':
        if (selectedCellId) copyCells([selectedCellId]);
        break;
      case 'paste':
        pasteCells(selectedCellId);
        break;
      case 'undoDelete':
        undoDelete();
        break;
      case 'mergeBelow': {
        if (!selectedCellId) break;
        // The cell below loses its own id once merged into this one.
        const belowId = idx >= 0 ? notebook.cells[idx + 1]?.id : undefined;
        mergeWithBelow(selectedCellId);
        if (belowId) editorRegistry.forgetCell(belowId);
        break;
      }
      case 'toggleOutputCollapse':
        if (selectedCellId) toggleCollapse(selectedCellId);
        break;
      case 'toggleOutputCollapseAll':
        for (const cell of notebook.cells) {
          if (cell.outputs.length > 0) toggleCollapse(cell.id);
        }
        break;
      case 'toggleLineNumbers':
        if (selectedCellId) toggleLineNumbers(selectedCellId);
        break;
      case 'openHelp':
        openShortcutsHelp();
        break;
      case 'selectPrev':
        if (idx > 0) select(notebook.cells[idx - 1].id);
        break;
      case 'selectNext':
        if (idx >= 0 && idx < notebook.cells.length - 1) select(notebook.cells[idx + 1].id);
        break;
      default:
        break;
    }
  }

  if (loading) return <div className="notebook-empty">Loading…</div>;
  if (error) return <div className="notebook-empty notebook-error">{error}</div>;
  if (!notebook) return <div className="notebook-empty">No notebook open.</div>;

  return (
    <>
      <div className="notebook" onKeyDown={handleKeyDown}>
        {autosaveStatus && <div className="autosave-status">{autosaveStatus}</div>}
        {notebook.cells.map((cell) => (
          <Cell key={cell.id} cell={cell} selected={cell.id === selectedCellId} onSelect={() => select(cell.id)} />
        ))}
      </div>
      <ShortcutsHelp open={helpOpen} onClose={closeShortcutsHelp} />
    </>
  );
}

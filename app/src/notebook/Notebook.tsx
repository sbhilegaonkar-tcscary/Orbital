/**
 * Renders the currently open notebook from useNotebookStore and owns all
 * keyboard handling: run shortcuts always work; single-letter command-mode
 * shortcuts (a/b/dd/m/y/arrows) only fire when focus is not inside an editor.
 */
import { useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Cell as CellModel } from './model';
import { useNotebookStore, useActiveNotebook } from './store';
import { Cell } from './Cell';
import './notebook.css';

const DELETE_CHORD_MS = 500;

function isEditingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('.cm-editor');
}

/**
 * Focuses the CodeMirror content element of the given cell, if it has one
 * (code cells only — markdown cells render no editor until double-clicked;
 * `MarkdownCell.tsx` is not owned by this change, so command-mode Enter is a
 * no-op there, a known deviation).
 */
function focusCellEditor(id: string | null): void {
  if (!id) return;
  const cellEl = document.querySelector(`.cell[data-cell-id="${CSS.escape(id)}"]`);
  const content = cellEl?.querySelector('.cm-content');
  if (content instanceof HTMLElement) content.focus();
}

/**
 * `CodeEditor.tsx` exposes no cursor-offset hook yet (owned by a concurrent
 * change), so the split point is derived from the DOM selection instead: the
 * end of the CodeMirror line (`.cm-line`) that currently holds the caret,
 * counted against `cell.source.split('\n')`. This is coarser than a true
 * character offset (it ignores where in the line the caret sits) but matches
 * the documented fallback behaviour.
 */
function splitOffsetFromSelection(cell: CellModel, target: EventTarget | null): number | null {
  if (!(target instanceof HTMLElement)) return null;
  const editorRoot = target.closest('.cm-editor');
  if (!editorRoot) return null;

  const selection = window.getSelection();
  const anchor = selection?.anchorNode ?? null;
  const anchorEl = anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
  const lineEl = anchorEl?.closest('.cm-line');
  const content = editorRoot.querySelector('.cm-content');
  if (!lineEl || !content) return null;

  const lines = Array.from(content.querySelectorAll('.cm-line'));
  const lineIndex = lines.indexOf(lineEl);
  if (lineIndex === -1) return null;

  const sourceLines = cell.source.split('\n');
  let offset = 0;
  for (let i = 0; i <= lineIndex && i < sourceLines.length; i += 1) {
    offset += sourceLines[i].length;
    if (i < lineIndex) offset += 1; // the '\n' the split rejoins on
  }
  return offset;
}

export function Notebook() {
  const notebook = useActiveNotebook();
  const selectedCellId = useNotebookStore((s) => s.selectedCellId);
  const loading = useNotebookStore((s) => s.loading);
  const error = useNotebookStore((s) => s.error);
  const select = useNotebookStore((s) => s.select);
  const runCell = useNotebookStore((s) => s.runCell);
  const runAndAdvance = useNotebookStore((s) => s.runAndAdvance);
  const insertCell = useNotebookStore((s) => s.insertCell);
  const deleteCell = useNotebookStore((s) => s.deleteCell);
  const setCellType = useNotebookStore((s) => s.setCellType);
  const save = useNotebookStore((s) => s.save);
  const cutCells = useNotebookStore((s) => s.cutCells);
  const copyCells = useNotebookStore((s) => s.copyCells);
  const pasteCells = useNotebookStore((s) => s.pasteCells);
  const undoDelete = useNotebookStore((s) => s.undoDelete);
  const mergeWithBelow = useNotebookStore((s) => s.mergeWithBelow);
  const toggleCollapse = useNotebookStore((s) => s.toggleCollapse);
  const splitCell = useNotebookStore((s) => s.splitCell);
  const runAbove = useNotebookStore((s) => s.runAbove);
  const runBelow = useNotebookStore((s) => s.runBelow);

  const lastDeleteRef = useRef(0);

  // `?fixture=1` is handled once, in NotebookView: it owns the decision of
  // what is open, and <Notebook/> only renders once something is.

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const mod = e.ctrlKey || e.metaKey;

    if (mod && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      void save();
      return;
    }
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      if (selectedCellId) void runAndAdvance(selectedCellId);
      return;
    }
    if (e.key === 'Enter' && e.altKey) {
      e.preventDefault();
      if (selectedCellId) {
        void runCell(selectedCellId);
        const newId = insertCell(selectedCellId, 'code');
        select(newId);
      }
      return;
    }
    if (e.key === 'Enter' && mod) {
      e.preventDefault();
      if (selectedCellId) void runCell(selectedCellId);
      return;
    }

    // Run above / run below work in both edit and command mode.
    if (mod && e.shiftKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      if (selectedCellId) void runAbove(selectedCellId);
      return;
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      if (selectedCellId) void runBelow(selectedCellId);
      return;
    }

    // Split at cursor, edit mode only: see splitOffsetFromSelection's note
    // on why this is DOM-derived rather than a CodeMirror cursor offset.
    if (mod && e.shiftKey && (e.key === '_' || e.key === '-') && isEditingTarget(e.target) && notebook) {
      const cell = notebook.cells.find((c) => c.id === selectedCellId);
      if (cell) {
        const offset = splitOffsetFromSelection(cell, e.target);
        if (offset !== null) {
          e.preventDefault();
          splitCell(cell.id, offset);
          return;
        }
      }
    }

    // Escape while editing drops back into command mode on the cell itself
    // (Cell.tsx's own effect won't re-fire just from this blur, so focus the
    // cell's section explicitly rather than leaving focus nowhere).
    // If CodeMirror already consumed this Escape (closing a completion popup or
    // an inspect tooltip) it called preventDefault on the native event; leave
    // the editor focused in that case, as Jupyter does.
    if (e.key === 'Escape' && isEditingTarget(e.target)) {
      if (e.nativeEvent.defaultPrevented) return;
      e.preventDefault();
      const cellEl = (e.target as HTMLElement).closest('.cell');
      (document.activeElement as HTMLElement | null)?.blur();
      if (cellEl instanceof HTMLElement) cellEl.focus();
      return;
    }

    if (isEditingTarget(e.target) || !notebook) return;

    const idx = notebook.cells.findIndex((c) => c.id === selectedCellId);

    switch (e.key) {
      case 'a': {
        e.preventDefault();
        const afterId = idx > 0 ? notebook.cells[idx - 1].id : null;
        select(insertCell(afterId, 'code'));
        break;
      }
      case 'b': {
        e.preventDefault();
        select(insertCell(selectedCellId, 'code'));
        break;
      }
      case 'd': {
        const now = Date.now();
        if (now - lastDeleteRef.current < DELETE_CHORD_MS) {
          e.preventDefault();
          if (selectedCellId) deleteCell(selectedCellId);
          lastDeleteRef.current = 0;
        } else {
          lastDeleteRef.current = now;
        }
        break;
      }
      case 'm': {
        e.preventDefault();
        if (selectedCellId) setCellType(selectedCellId, 'markdown');
        break;
      }
      case 'y': {
        e.preventDefault();
        if (selectedCellId) setCellType(selectedCellId, 'code');
        break;
      }
      case 'x': {
        e.preventDefault();
        if (selectedCellId) cutCells([selectedCellId]);
        break;
      }
      case 'c': {
        e.preventDefault();
        if (selectedCellId) copyCells([selectedCellId]);
        break;
      }
      case 'v': {
        e.preventDefault();
        pasteCells(selectedCellId);
        break;
      }
      case 'z': {
        e.preventDefault();
        undoDelete();
        break;
      }
      case 'M': {
        // Shift+M: merge the selected cell with the one below it.
        e.preventDefault();
        if (selectedCellId) mergeWithBelow(selectedCellId);
        break;
      }
      case 'o': {
        e.preventDefault();
        if (selectedCellId) toggleCollapse(selectedCellId);
        break;
      }
      case 'Enter': {
        // Plain Enter in command mode (Shift/Alt/Ctrl+Enter are handled
        // above and never reach here): focus the selected cell's editor.
        e.preventDefault();
        focusCellEditor(selectedCellId);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        if (idx > 0) select(notebook.cells[idx - 1].id);
        break;
      }
      case 'ArrowDown': {
        e.preventDefault();
        if (idx >= 0 && idx < notebook.cells.length - 1) select(notebook.cells[idx + 1].id);
        break;
      }
      default:
        break;
    }
  }

  if (loading) return <div className="notebook-empty">Loading…</div>;
  if (error) return <div className="notebook-empty notebook-error">{error}</div>;
  if (!notebook) return <div className="notebook-empty">No notebook open.</div>;

  return (
    <div className="notebook" onKeyDown={handleKeyDown}>
      {notebook.cells.map((cell) => (
        <Cell key={cell.id} cell={cell} selected={cell.id === selectedCellId} onSelect={() => select(cell.id)} />
      ))}
    </div>
  );
}

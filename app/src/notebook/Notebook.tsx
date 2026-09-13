/**
 * Renders the currently open notebook from useNotebookStore and owns all
 * keyboard handling: run shortcuts always work; single-letter command-mode
 * shortcuts (a/b/dd/m/y/arrows) only fire when focus is not inside an editor.
 */
import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNotebookStore } from './store';
import { fixtureNotebook } from './fixture';
import { Cell } from './Cell';
import './notebook.css';

const DELETE_CHORD_MS = 500;

function isEditingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('.cm-editor');
}

export function Notebook() {
  const notebook = useNotebookStore((s) => s.notebook);
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

  const lastDeleteRef = useRef(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('fixture') !== '1') return;
    if (useNotebookStore.getState().notebook) return;
    useNotebookStore.setState({
      notebook: fixtureNotebook,
      selectedCellId: fixtureNotebook.cells[0]?.id ?? null,
      loading: false,
      error: null,
      dirty: false,
    });
  }, []);

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

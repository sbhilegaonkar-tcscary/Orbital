/**
 * Per-cell hover toolbar, top-right of the cell body. Shown on hover or
 * selection (CSS-driven, see notebook.css); `forceVisible` is the
 * `?hovercell=1` dev aid that pins it open on the selected cell for
 * screenshots. Absolutely positioned so it never shifts cell layout.
 */
import type { Cell as CellModel } from './model';
import { useNotebookStore } from './store';
import { IconMoveDown, IconMoveUp, IconRun } from './NotebookToolbar';

function IconInsertBelow() {
  return (
    <svg viewBox="0 0 16 16">
      <path d="M3 5.5h10M3 8h6" />
      <path d="M11 10v4M9 12h4" />
    </svg>
  );
}

function IconToggleType() {
  return (
    <svg viewBox="0 0 16 16">
      <path d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4" />
    </svg>
  );
}

function IconCollapse() {
  return (
    <svg viewBox="0 0 16 16">
      <path d="M3 6.5h10M4.5 10h7" />
    </svg>
  );
}

function IconDelete() {
  return (
    <svg viewBox="0 0 16 16">
      <path d="M3.5 4.5h9M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M4.5 4.5 5 13a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l.5-8.5" />
      <path d="M6.7 7v4M9.3 7v4" />
    </svg>
  );
}

export function CellToolbar({ cell, forceVisible }: { cell: CellModel; forceVisible?: boolean }) {
  const hasOutputs = cell.outputs.length > 0;
  const collapsed = cell.metadata.collapsed === true;

  return (
    <div className={`cell-toolbar${forceVisible ? ' cell-toolbar-forced' : ''}`}>
      <button
        type="button"
        className="cell-toolbar-btn"
        title="Run this cell"
        aria-label="Run this cell"
        disabled={cell.type !== 'code'}
        onClick={() => void useNotebookStore.getState().runCell(cell.id)}
      >
        <IconRun />
      </button>
      <button
        type="button"
        className="cell-toolbar-btn"
        title="Move cell up"
        aria-label="Move cell up"
        onClick={() => useNotebookStore.getState().moveCell(cell.id, -1)}
      >
        <IconMoveUp />
      </button>
      <button
        type="button"
        className="cell-toolbar-btn"
        title="Move cell down"
        aria-label="Move cell down"
        onClick={() => useNotebookStore.getState().moveCell(cell.id, 1)}
      >
        <IconMoveDown />
      </button>
      <button
        type="button"
        className="cell-toolbar-btn"
        title="Insert cell below"
        aria-label="Insert cell below"
        onClick={() => {
          const id = useNotebookStore.getState().insertCell(cell.id, cell.type);
          useNotebookStore.getState().select(id);
        }}
      >
        <IconInsertBelow />
      </button>
      <button
        type="button"
        className="cell-toolbar-btn"
        title={cell.type === 'code' ? 'Convert to markdown' : 'Convert to code'}
        aria-label="Toggle cell type"
        onClick={() => useNotebookStore.getState().setCellType(cell.id, cell.type === 'code' ? 'markdown' : 'code')}
      >
        <IconToggleType />
      </button>
      {hasOutputs && (
        <button
          type="button"
          className="cell-toolbar-btn"
          title={collapsed ? 'Expand output' : 'Collapse output'}
          aria-label={collapsed ? 'Expand output' : 'Collapse output'}
          onClick={() => useNotebookStore.getState().toggleCollapse(cell.id)}
        >
          <IconCollapse />
        </button>
      )}
      <button
        type="button"
        className="cell-toolbar-btn cell-toolbar-btn-danger"
        title="Delete cell"
        aria-label="Delete cell"
        onClick={() => useNotebookStore.getState().deleteCell(cell.id)}
      >
        <IconDelete />
      </button>
    </div>
  );
}

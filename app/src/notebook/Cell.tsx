/**
 * Gutter + body chrome for one cell; delegates the body to CodeEditor/Output
 * for code cells or MarkdownCell for markdown. Focuses itself when selected
 * (unless a descendant editor already holds focus) so keyboard shortcuts in
 * Notebook.tsx reach the DOM even when nothing was clicked directly.
 */
import { useEffect, useRef } from 'react';
import type { Cell as CellModel } from './model';
import { CodeEditor } from './CodeEditor';
import { Output } from './Output';
import { MarkdownCell } from './MarkdownCell';
import { useNotebookStore } from './store';

function countLabel(cell: CellModel): string {
  if (cell.state === 'running' || cell.state === 'queued') return '[*]';
  if (cell.executionCount != null) return `[${cell.executionCount}]`;
  return '[ ]';
}

export interface CellProps {
  cell: CellModel;
  selected: boolean;
  onSelect: () => void;
}

export function Cell({ cell, selected, onSelect }: CellProps) {
  const setSource = useNotebookStore((s) => s.setSource);
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (selected && root && !root.contains(document.activeElement)) {
      root.focus();
    }
  }, [selected]);

  const hasOutputs = cell.outputs.length > 0;
  const hasError = cell.outputs.some((o) => o.type === 'error');

  return (
    <section
      ref={rootRef}
      className="cell"
      data-type={cell.type}
      data-state={cell.state}
      data-selected={selected ? 'true' : undefined}
      tabIndex={-1}
      onMouseDown={onSelect}
    >
      <div className="cell-gutter">
        {cell.type === 'code' && <span className="cell-count">{countLabel(cell)}</span>}
        {cell.type === 'code' && hasOutputs && <span className="cell-io-label">{hasError ? 'err' : 'out'}</span>}
      </div>
      <div className="cell-body">
        {cell.type === 'code' ? (
          <>
            <CodeEditor value={cell.source} onChange={(src) => setSource(cell.id, src)} />
            {hasOutputs && <Output outputs={cell.outputs} />}
          </>
        ) : (
          <MarkdownCell cell={cell} />
        )}
      </div>
    </section>
  );
}

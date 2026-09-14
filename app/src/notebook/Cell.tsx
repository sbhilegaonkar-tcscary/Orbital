/**
 * Gutter + body chrome for one cell; delegates the body to CodeEditor/Output
 * for code cells or MarkdownCell for markdown. Owns focus and the
 * edit/command mode distinction (docs/KEYBOARD.md): the section itself is
 * the command-mode focus target (`tabIndex={0}`), `data-mode` reflects
 * whether the descendant editor currently holds focus, and entering edit
 * mode always goes through `editorRegistry.focus(cell.id)` rather than
 * reaching into the DOM.
 *
 * `?hovercell=1` (dev aid, for screenshots) forces the hover toolbar visible
 * on the selected cell instead of requiring an actual mouse hover.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent as ReactFocusEvent } from 'react';
import type { Cell as CellModel } from './model';
import { CodeEditor } from './CodeEditor';
import { Output } from './Output';
import { MarkdownCell } from './MarkdownCell';
import { CellToolbar } from './CellToolbar';
import { useNotebookStore } from './store';
import { editorRegistry, useLineNumbers } from './editorRegistry';

function countLabel(cell: CellModel): string {
  if (cell.state === 'running' || cell.state === 'queued') return '[*]';
  if (cell.executionCount != null) return `[${cell.executionCount}]`;
  return '[ ]';
}

function isInsideEditor(el: HTMLElement | null): boolean {
  return !!el?.closest('.cm-editor');
}

export interface CellProps {
  cell: CellModel;
  selected: boolean;
  onSelect: () => void;
}

export function Cell({ cell, selected, onSelect }: CellProps) {
  const setSource = useNotebookStore((s) => s.setSource);
  const toggleCollapse = useNotebookStore((s) => s.toggleCollapse);
  const rootRef = useRef<HTMLElement | null>(null);
  const lineNumbers = useLineNumbers(cell.id);

  // Markdown cells only: whether the raw-source editor is mounted. Lifted
  // here (rather than local MarkdownCell state) so Cell can register an
  // `editorRegistry` focus request for it while it is *not* editing —
  // `editorRegistry.focus(cell.id)` is the one path every cell type uses to
  // enter edit mode (see Notebook.tsx / notebook/commands.ts).
  const [markdownEditing, setMarkdownEditing] = useState(
    () => cell.type === 'markdown' && cell.source.trim() === '',
  );
  const [mode, setMode] = useState<'edit' | 'command'>('command');

  const forceHoverToolbar = useMemo(
    () => new URLSearchParams(window.location.search).get('hovercell') === '1',
    [],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (selected && root && !root.contains(document.activeElement)) {
      root.focus();
    }
  }, [selected]);

  // While a markdown cell is rendered (not editing), let editorRegistry.focus
  // reach it: it has no mounted editor to register, so it registers a
  // request instead. CodeEditor's own registration (once editing starts)
  // takes over from there.
  useEffect(() => {
    if (cell.type !== 'markdown') return undefined;
    return editorRegistry.onFocusRequest(cell.id, () => setMarkdownEditing(true));
  }, [cell.type, cell.id]);

  function handleFocus(e: ReactFocusEvent<HTMLElement>) {
    onSelect();
    const target = e.target instanceof HTMLElement ? e.target : null;
    setMode(isInsideEditor(target) ? 'edit' : 'command');
  }

  function handleBlur(e: ReactFocusEvent<HTMLElement>) {
    const next = e.relatedTarget as HTMLElement | null;
    if (next && rootRef.current?.contains(next)) {
      setMode(isInsideEditor(next) ? 'edit' : 'command');
    } else {
      setMode('command');
    }
  }

  const hasOutputs = cell.outputs.length > 0;
  const hasError = cell.outputs.some((o) => o.type === 'error');
  const collapsed = cell.metadata.collapsed === true;

  return (
    <section
      ref={rootRef}
      className="cell"
      data-type={cell.type}
      data-state={cell.state}
      data-cell-id={cell.id}
      data-selected={selected ? 'true' : undefined}
      data-mode={mode}
      tabIndex={0}
      onMouseDown={onSelect}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <div className="cell-gutter">
        {cell.type === 'code' && <span className="cell-count">{countLabel(cell)}</span>}
        {cell.type === 'code' && hasOutputs && <span className="cell-io-label">{hasError ? 'err' : 'out'}</span>}
      </div>
      <div className="cell-body">
        <CellToolbar cell={cell} forceVisible={forceHoverToolbar && selected} />
        {cell.type === 'code' ? (
          <>
            <CodeEditor
              cellId={cell.id}
              value={cell.source}
              onChange={(src) => setSource(cell.id, src)}
              lineNumbers={lineNumbers}
            />
            {hasOutputs && (
              <Output outputs={cell.outputs} collapsed={collapsed} onToggleCollapse={() => toggleCollapse(cell.id)} />
            )}
          </>
        ) : (
          <MarkdownCell
            cell={cell}
            editing={markdownEditing}
            lineNumbers={lineNumbers}
            onEnterEdit={() => setMarkdownEditing(true)}
            onExitEdit={() => setMarkdownEditing(false)}
          />
        )}
      </div>
    </section>
  );
}

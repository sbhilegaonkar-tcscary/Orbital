/**
 * Renders a markdown cell with `marked` + DOMPurify. Double-click, or Enter
 * on the (parent) cell in command mode via `editorRegistry.focus`, switches
 * to a plain CodeMirror editor; Shift+Enter or Esc commits the source and
 * renders again. `editing` is owned by `Cell.tsx`, not local state here: that
 * is what lets `editorRegistry.focus(cell.id)` reach a markdown cell that
 * isn't currently editing (see Cell.tsx's `onFocusRequest` registration).
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Cell } from './model';
import { CodeEditor } from './CodeEditor';
import { useNotebookStore } from './store';

export interface MarkdownCellProps {
  cell: Cell;
  editing: boolean;
  lineNumbers: boolean;
  onEnterEdit: () => void;
  onExitEdit: () => void;
}

export function MarkdownCell({ cell, editing, lineNumbers, onEnterEdit, onExitEdit }: MarkdownCellProps) {
  const setSource = useNotebookStore((s) => s.setSource);

  if (editing) {
    return (
      <CodeEditor
        cellId={cell.id}
        value={cell.source}
        onChange={(src) => setSource(cell.id, src)}
        language="plain"
        lineNumbers={lineNumbers}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.shiftKey) {
            // Render; Notebook.tsx's own Shift+Enter handling (this keydown
            // keeps bubbling, preventDefault only blocks the browser default)
            // advances the selection into the next cell's editor.
            e.preventDefault();
            onExitEdit();
          } else if (e.key === 'Escape' && !e.nativeEvent.defaultPrevented) {
            // Notebook.tsx's own Escape handling (also still bubbling) moves
            // focus back to the cell section; this just renders.
            onExitEdit();
          }
        }}
      />
    );
  }

  const rawHtml = marked.parse(cell.source || '*Empty markdown cell — double-click to edit.*', {
    async: false,
  }) as string;
  const safeHtml = DOMPurify.sanitize(rawHtml);

  return (
    <div
      className="cell-markdown-rendered"
      onDoubleClick={onEnterEdit}
      // Sanitized just above; content is authored notebook markdown, not raw HTML.
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}

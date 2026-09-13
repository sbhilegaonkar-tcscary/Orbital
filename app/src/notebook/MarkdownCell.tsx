/**
 * Renders a markdown cell with `marked` + DOMPurify. Double-click or Enter
 * (in command mode) switches to a plain CodeMirror editor; Shift+Enter (or
 * blur) commits the source and renders again.
 */
import { useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Cell } from './model';
import { CodeEditor } from './CodeEditor';
import { useNotebookStore } from './store';

export function MarkdownCell({ cell }: { cell: Cell }) {
  const setSource = useNotebookStore((s) => s.setSource);
  const [editing, setEditing] = useState(cell.source.trim() === '');

  if (editing) {
    return (
      <CodeEditor
        value={cell.source}
        onChange={(src) => setSource(cell.id, src)}
        language="plain"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            setEditing(false);
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
      tabIndex={0}
      onDoubleClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          setEditing(true);
        }
      }}
      // Sanitized just above; content is authored notebook markdown, not raw HTML.
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}

/**
 * CodeMirror editor for one open text-file tab (docs/ARCHITECTURE.md "Files
 * (M6)"). Rendered by `views/NotebookView.tsx` in place of the notebook when
 * the active tab is a file, keyed by `path` so switching files remounts a
 * fresh editor instead of trying to reuse one CodeMirror instance for two
 * different documents.
 *
 * The theme/highlight setup below is copied from `notebook/CodeEditor.tsx`
 * (nothing there is exported to import instead) so cell code and file code
 * look identical.
 *
 * Ctrl+S is deliberately NOT bound here: `shell/commands.ts`'s
 * `files.saveActive` command and `notebook/commands.ts`'s global Ctrl+S
 * dispatcher (which now calls `saveActiveFile()` when a file tab is active)
 * already cover it — see `files/store.ts`'s `saveActiveFile` export.
 */
import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting, indentOnInput } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { search, searchKeymap } from '@codemirror/search';
import { python } from '@codemirror/lang-python';
import { tags } from '@lezer/highlight';
import { useFilesStore } from './store';
import './files.css';

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--accent)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--accent-2)' },
  { tag: tags.comment, color: 'var(--text-muted)' },
  { tag: tags.number, color: 'var(--warning)' },
]);

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--text)',
    backgroundColor: 'transparent',
    fontSize: 'var(--code-size, 13.5px)',
  },
  '.cm-content': {
    fontFamily: 'var(--font-mono)',
    padding: '14px 18px',
    caretColor: 'var(--accent)',
  },
  '.cm-scroller': { overflow: 'auto' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 25%, transparent) !important',
  },
});

export function FileEditor({ path }: { path: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Read once at mount: this component is keyed by `path`, so a language or
  // initial-text change always arrives as a fresh mount, never a re-render
  // of the same instance.
  const doc = useFilesStore.getState().files[path];
  const dirty = useFilesStore((s) => s.files[path]?.dirty ?? false);

  useEffect(() => {
    if (!hostRef.current || !doc) return;
    const extensions = [
      history(),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      closeBrackets(),
      search(),
      syntaxHighlighting(highlightStyle),
      editorTheme,
      indentOnInput(),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) useFilesStore.getState().setText(path, update.state.doc.toString());
      }),
      ...(doc.language === 'python' ? [python()] : []),
    ];

    const state = EditorState.create({ doc: doc.text, extensions });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Intentionally mount-once per `path` (see the component doc comment):
    // later text changes flow back out through the update listener above,
    // not back in through this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  if (!doc) {
    return (
      <div className="file-editor">
        <div className="file-editor-header">
          <span className="file-editor-path">{path}</span>
        </div>
        <p className="muted file-editor-loading">Loading…</p>
      </div>
    );
  }

  return (
    <div className="file-editor">
      <div className="file-editor-header">
        <span className="file-editor-path">{path}</span>
        {dirty && <i className="dirty-dot" aria-label="unsaved changes" />}
      </div>
      <div className="file-editor-body" ref={hostRef} />
    </div>
  );
}

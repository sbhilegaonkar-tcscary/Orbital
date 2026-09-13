/**
 * CodeMirror 6 wrapper bound to a cell's source. The view instance is kept
 * stable across renders (created once per `language`) and external `value`
 * changes are pushed into the doc without resetting the cursor.
 */
import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap, tooltips } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting, indentOnInput } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap, startCompletion } from '@codemirror/autocomplete';
import { search, searchKeymap } from '@codemirror/search';
import { python } from '@codemirror/lang-python';
import { tags } from '@lezer/highlight';
import { kernelCompletion } from './completion';
import { inspectKeymap, inspectTooltipField, kernelHoverTooltip } from './hover';
import './editor.css';

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** 'plain' is used for markdown source editing: no Python grammar. */
  language?: 'python' | 'plain';
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  autoFocus?: boolean;
}

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--accent)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--accent-2)' },
  { tag: tags.comment, color: 'var(--text-muted)' },
  { tag: tags.number, color: 'var(--warning)' },
]);

const editorTheme = EditorView.theme({
  '&': {
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
  '.cm-gutters': { display: 'none' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 25%, transparent) !important',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
});

/**
 * Tab completes the token before the cursor (Jupyter habit) when there is
 * one; otherwise it falls through (returns false) so `indentWithTab` in the
 * default keymap runs instead — at line start or right after whitespace,
 * that means indent.
 */
function tabCompleteOrIndent(view: EditorView): boolean {
  const { state } = view;
  const { from, head } = state.selection.main;
  if (from !== head) return false;
  const line = state.doc.lineAt(head);
  const before = line.text.slice(0, head - line.from);
  if (!/[A-Za-z0-9_]$/.test(before)) return false;
  return startCompletion(view);
}

export function CodeEditor({ value, onChange, language = 'python', onKeyDown, autoFocus }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!hostRef.current) return;
    const extensions = [
      history(),
      Prec.highest(keymap.of([{ key: 'Tab', run: tabCompleteOrIndent }, ...inspectKeymap])),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      closeBrackets(),
      search(),
      tooltips({ parent: document.body }),
      kernelCompletion,
      kernelHoverTooltip,
      inspectTooltipField,
      syntaxHighlighting(highlightStyle),
      editorTheme,
      indentOnInput(),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
      ...(language === 'python' ? [python()] : []),
    ];

    const state = EditorState.create({ doc: value, extensions });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    if (autoFocus) view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is intentionally rebuilt only when `language` changes; the
    // initial `value` seeds it and later changes flow through the effect
    // below so the cursor is not reset on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return <div className="cell-editor" ref={hostRef} onKeyDown={onKeyDown} />;
}

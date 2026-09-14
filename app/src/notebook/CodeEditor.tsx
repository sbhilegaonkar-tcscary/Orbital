/**
 * CodeMirror 6 wrapper bound to a cell's source. The view instance is kept
 * stable across renders (created once per `language`) and external `value`
 * changes are pushed into the doc without resetting the cursor.
 */
import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap, lineNumbers as cmLineNumbers, tooltips } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting, indentOnInput } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap, startCompletion } from '@codemirror/autocomplete';
import { search, searchKeymap } from '@codemirror/search';
import { python } from '@codemirror/lang-python';
import { tags } from '@lezer/highlight';
import { kernelCompletion } from './completion';
import { inspectKeymap, inspectTooltipField, kernelHoverTooltip } from './hover';
import { editorRegistry } from './editorRegistry';
import './editor.css';

export interface CodeEditorProps {
  /** Registry key: `editorRegistry` and the keyboard layer address this editor by it. */
  cellId: string;
  value: string;
  onChange: (value: string) => void;
  /** 'plain' is used for markdown source editing: no Python grammar. */
  language?: 'python' | 'plain';
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  autoFocus?: boolean;
  /** L in command mode (docs/KEYBOARD.md): show the line-number gutter. */
  lineNumbers?: boolean;
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
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 25%, transparent) !important',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
});

/** Default: no gutter at all (matches the pre-M6 look). Swapped for a real
 * line-number gutter per cell by the `lineNumbers` prop via a Compartment,
 * so toggling it does not rebuild the view or disturb the cursor. */
const noGutterTheme = EditorView.theme({ '.cm-gutters': { display: 'none' } });

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

export function CodeEditor({
  cellId,
  value,
  onChange,
  language = 'python',
  onKeyDown,
  autoFocus,
  lineNumbers = false,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const gutterCompartment = useRef(new Compartment()).current;
  // Read at mount time only: the effect below only reruns on `language`
  // changes, and a mounted editor's registry key never changes mid-life.
  const lineNumbersRef = useRef(lineNumbers);
  lineNumbersRef.current = lineNumbers;

  useEffect(() => {
    if (!hostRef.current) return;
    const extensions = [
      history(),
      // Every run chord is shadowed here so CodeMirror never inserts a
      // newline for it (defaultKeymap binds Enter, and Shift/Alt+Enter fall
      // through to it). Returning true stops CodeMirror; the native event
      // still bubbles to Notebook.tsx, which runs the cell per docs/KEYBOARD.md.
      Prec.highest(
        keymap.of([
          { key: 'Tab', run: tabCompleteOrIndent },
          { key: 'Mod-Enter', run: () => true },
          { key: 'Shift-Enter', run: () => true },
          { key: 'Alt-Enter', run: () => true },
          ...inspectKeymap,
        ]),
      ),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      closeBrackets(),
      search(),
      tooltips({ parent: document.body }),
      kernelCompletion,
      kernelHoverTooltip,
      inspectTooltipField,
      syntaxHighlighting(highlightStyle),
      editorTheme,
      gutterCompartment.of(lineNumbersRef.current ? [cmLineNumbers()] : [noGutterTheme]),
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

    editorRegistry.register(cellId, {
      focus: () => view.focus(),
      getCursor: () => view.state.selection.main.head,
      setCursor: (pos) => {
        const clamped = Math.max(0, Math.min(pos, view.state.doc.length));
        view.dispatch({ selection: { anchor: clamped } });
      },
      view,
    });

    if (autoFocus) {
      // "Entering edit mode ... places the cursor at its last position (or
      // the end)": a freshly-mounted editor has no last position, so end.
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();
    }

    return () => {
      editorRegistry.unregister(cellId);
      view.destroy();
      viewRef.current = null;
    };
    // The editor is intentionally rebuilt only when `language` or `cellId`
    // changes; the initial `value` seeds it and later changes flow through
    // the effect below so the cursor is not reset on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, cellId]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: gutterCompartment.reconfigure(lineNumbers ? [cmLineNumbers()] : [noGutterTheme]),
    });
  }, [lineNumbers, gutterCompartment]);

  return <div className="cell-editor" ref={hostRef} onKeyDown={onKeyDown} />;
}

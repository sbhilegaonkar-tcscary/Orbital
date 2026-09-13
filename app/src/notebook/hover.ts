/**
 * Kernel-backed hover documentation for code cells, plus a Jupyter-style
 * Shift+Tab "inspect at cursor" command. Both surface `inspect()` results
 * (see ../session/types.ts) as a `text/plain` tooltip with ANSI stripped.
 */
import type { EditorView, KeyBinding, Tooltip } from '@codemirror/view';
import { hoverTooltip, showTooltip } from '@codemirror/view';
import { MapMode, StateEffect, StateField } from '@codemirror/state';
import type { InspectResult } from '../session/types';
import { stripAnsi } from './ansi';
import { getActiveSession } from './store';

const MAX_LINES = 14;

/** `text/plain` from an inspect result, ANSI-stripped, or null when there is nothing to show. */
function inspectText(result: InspectResult): string | null {
  const raw = result.data['text/plain'];
  if (!result.found || typeof raw !== 'string' || !raw.trim()) return null;
  return stripAnsi(raw);
}

function tooltipDom(text: string): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'cm-kernel-tooltip-text';
  dom.style.maxHeight = `${MAX_LINES}em`;
  dom.style.overflowY = 'auto';
  dom.style.whiteSpace = 'pre-wrap';
  dom.textContent = text;
  return dom;
}

/** Hover: shows inspect() docs for the word under the pointer after a short delay. */
export const kernelHoverTooltip = hoverTooltip(
  async (view, pos) => {
    const word = view.state.wordAt(pos);
    if (!word) return null;
    const session = getActiveSession();
    if (!session) return null;

    let result: InspectResult;
    try {
      result = await session.inspect(view.state.doc.toString(), word.to, 0);
    } catch {
      return null;
    }
    const text = inspectText(result);
    if (!text) return null;

    return {
      pos: word.from,
      end: word.to,
      above: true,
      create: () => ({ dom: tooltipDom(text) }),
    };
  },
  { hoverTime: 300 },
);

/** Effect used by Shift+Tab / Escape to show or clear the manual inspect tooltip. */
const setInspectTooltip = StateEffect.define<Tooltip | null>();

/** Holds the Shift+Tab-triggered tooltip; `null` when nothing is shown. */
export const inspectTooltipField = StateField.define<Tooltip | null>({
  create: () => null,
  update(tooltip, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setInspectTooltip)) return effect.value;
    }
    if (tooltip && tr.docChanged) {
      const pos = tr.changes.mapPos(tooltip.pos, -1, MapMode.TrackDel);
      if (pos == null) return null;
      return pos === tooltip.pos ? tooltip : { ...tooltip, pos, end: tooltip.end };
    }
    return tooltip;
  },
  provide: (field) => showTooltip.from(field),
});

/** Shift+Tab: inspect the identifier at the cursor, Jupyter-style. */
function inspectAtCursor(view: EditorView): boolean {
  const session = getActiveSession();
  if (!session) return false;

  const pos = view.state.selection.main.head;
  const doc = view.state.doc.toString();
  void session
    .inspect(doc, pos, 0)
    .then((result) => {
      const text = inspectText(result);
      if (!text) return;
      view.dispatch({
        effects: setInspectTooltip.of({
          pos,
          above: true,
          create: () => ({ dom: tooltipDom(text) }),
        }),
      });
    })
    .catch(() => undefined);
  return true;
}

/** Escape clears a manually-opened inspect tooltip; otherwise it is a no-op (returns false). */
function clearInspectTooltip(view: EditorView): boolean {
  const current = view.state.field(inspectTooltipField, false);
  if (!current) return false;
  view.dispatch({ effects: setInspectTooltip.of(null) });
  return true;
}

export const inspectKeymap: readonly KeyBinding[] = [
  { key: 'Shift-Tab', run: inspectAtCursor },
  { key: 'Escape', run: clearInspectTooltip },
];

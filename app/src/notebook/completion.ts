/**
 * Kernel-backed completion source for code cells. Talks to the active
 * session's `complete()` (see ../session/types.ts) and maps the result into
 * CodeMirror's `CompletionResult` shape.
 */
import type { CompletionContext, CompletionResult as CMCompletionResult } from '@codemirror/autocomplete';
import { autocompletion } from '@codemirror/autocomplete';
import type { CompletionResult as KernelCompletionResult } from '../session/types';
import { getActiveSession } from './store';

/** Jupyter's experimental type hints, mapped to CodeMirror's completion kinds. */
const TYPE_MAP: Record<string, string | undefined> = {
  function: 'function',
  module: 'namespace',
  class: 'class',
  instance: 'variable',
  statement: 'variable',
  keyword: 'keyword',
  param: 'property',
};

function mapType(type: string | undefined): string | undefined {
  if (!type) return undefined;
  return TYPE_MAP[type];
}

/**
 * Pure mapping from a kernel `CompletionResult` to CodeMirror's shape.
 * `docLength` clamps `from`/`to` so a stale reply against a doc that has
 * since shrunk cannot produce an out-of-range range.
 */
export function mapCompletionResult(
  result: KernelCompletionResult,
  docLength: number,
): CMCompletionResult | null {
  if (!result.items.length) return null;

  const from = Math.max(0, Math.min(result.cursorStart, docLength));
  const to = Math.max(from, Math.min(result.cursorEnd, docLength));

  return {
    from,
    to,
    options: result.items.map((item) => ({
      label: item.label,
      type: mapType(item.type),
    })),
  };
}

/** True while a completion request from this source is in flight. */
let pending: Promise<unknown> | null = null;
/** The token (word text at the request point) the in-flight request was for. */
let pendingToken: string | null = null;

const IDENTIFIER_CHAR = /[A-Za-z0-9_]/;

function tokenBefore(doc: string, pos: number): string {
  let start = pos;
  while (start > 0 && IDENTIFIER_CHAR.test(doc[start - 1])) start--;
  return doc.slice(start, pos);
}

/**
 * The CompletionSource itself. Triggers after `.`, after two identifier
 * characters have been typed, or explicitly (Tab / Ctrl+Space via
 * `context.explicit`). Returns `null` while a previous request for the same
 * token is still in flight, so keystrokes do not pile up parallel requests.
 */
export async function completeFromKernel(
  context: CompletionContext,
): Promise<CMCompletionResult | null> {
  const doc = context.state.doc.toString();
  const pos = context.pos;
  const charBefore = pos > 0 ? doc[pos - 1] : '';
  const token = tokenBefore(doc, pos);

  const triggeredByDot = charBefore === '.';
  const triggeredByTyping = token.length >= 2;

  if (!context.explicit && !triggeredByDot && !triggeredByTyping) return null;

  if (pending && pendingToken === token) return null;

  const session = getActiveSession();
  if (!session) return null;

  pendingToken = token;
  const request = session.complete(doc, pos);
  pending = request;
  try {
    const result = await request;
    if (context.aborted) return null;
    return mapCompletionResult(result, context.state.doc.length);
  } catch {
    return null;
  } finally {
    if (pending === request) {
      pending = null;
      pendingToken = null;
    }
  }
}

export const kernelCompletion = autocompletion({
  override: [completeFromKernel],
  activateOnTyping: true,
  icons: false,
});

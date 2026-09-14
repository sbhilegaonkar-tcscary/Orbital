/**
 * One `tool_use` block plus its matching `tool_result` (once it arrives):
 * name, a one-line input summary, the raw input JSON behind a disclosure,
 * a `DiffView` for Edit/MultiEdit/Write, and the result inline once known.
 */
import { useState } from 'react';
import type { AgentBlock } from './protocol';
import { DiffView } from './DiffView';

type ToolUseBlock = Extract<AgentBlock, { kind: 'tool_use' }>;
type ToolResultBlock = Extract<AgentBlock, { kind: 'tool_result' }>;

const RESULT_PREVIEW_CHARS = 800;
const DIFF_TOOLS = new Set(['Edit', 'MultiEdit', 'Write']);

function record(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

/** A short, human-readable line describing what a tool call will do. */
export function summarizeToolInput(name: string, input: unknown): string {
  const rec = record(input);
  switch (name) {
    case 'Read':
      return `Read ${String(rec.file_path ?? '')}`;
    case 'Write':
      return `Write ${String(rec.file_path ?? '')}`;
    case 'Edit':
      return `Edit ${String(rec.file_path ?? '')}`;
    case 'MultiEdit':
      return `Edit ${String(rec.file_path ?? '')} (${Array.isArray(rec.edits) ? rec.edits.length : 0} edits)`;
    case 'Bash':
      return String(rec.command ?? '');
    case 'Glob':
      return `Glob ${String(rec.pattern ?? '')}`;
    case 'Grep':
      return `Grep ${String(rec.pattern ?? '')}`;
    case 'orbital_read_notebook':
      return 'Read notebook';
    case 'orbital_insert_cell': {
      const after = rec.afterIndex;
      const afterText = after === null || after === undefined ? '' : ` after #${String(after)}`;
      return `Insert ${String(rec.type ?? 'code')} cell${afterText}`;
    }
    case 'orbital_edit_cell':
      return `Edit cell #${String(rec.index ?? '')}`;
    case 'orbital_delete_cell':
      return `Delete cell #${String(rec.index ?? '')}`;
    case 'orbital_run_cell':
      return `orbital_run_cell #${String(rec.index ?? '')}`;
    case 'orbital_run_all':
      return 'Run all cells';
    case 'orbital_list_variables':
      return 'List variables';
    default:
      return name;
  }
}

function ResultBody({ result }: { result: ToolResultBlock }) {
  const [expanded, setExpanded] = useState(false);
  const text = result.content;
  const long = text.length > RESULT_PREVIEW_CHARS;
  const shown = expanded || !long ? text : `${text.slice(0, RESULT_PREVIEW_CHARS)}…`;
  return (
    <div className={`tool-card-result${result.isError ? ' tool-card-result-error' : ''}`}>
      <pre className="tool-card-result-text">{shown}</pre>
      {long && (
        <button type="button" className="tool-card-expand" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function DiffFromInput({ name, input }: { name: string; input: unknown }) {
  const rec = record(input);
  if (name === 'Write') {
    return <DiffView oldText="" newText={String(rec.content ?? '')} />;
  }
  if (name === 'Edit') {
    return <DiffView oldText={String(rec.old_string ?? '')} newText={String(rec.new_string ?? '')} />;
  }
  if (name === 'MultiEdit' && Array.isArray(rec.edits)) {
    return (
      <>
        {rec.edits.map((edit, i) => {
          const e = record(edit);
          return (
            <div key={i} className="tool-card-multiedit">
              <DiffView oldText={String(e.old_string ?? '')} newText={String(e.new_string ?? '')} />
            </div>
          );
        })}
      </>
    );
  }
  return null;
}

export function ToolCard({ block, result }: { block: ToolUseBlock; result?: ToolResultBlock }) {
  return (
    <div className="tool-card">
      <div className="tool-card-head">
        <span className="tool-card-name">{block.name}</span>
        <span className="tool-card-summary">{summarizeToolInput(block.name, block.input)}</span>
      </div>
      {DIFF_TOOLS.has(block.name) && <DiffFromInput name={block.name} input={block.input} />}
      <details className="tool-card-raw">
        <summary>raw input</summary>
        <pre className="tool-card-raw-json">{JSON.stringify(block.input, null, 2)}</pre>
      </details>
      {result && <ResultBody result={result} />}
    </div>
  );
}

/**
 * Runs `orbital_*` tool calls against the live notebook. The agent sidecar
 * never touches the notebook itself: it relays each call here as a
 * `tool_request`, this module performs it through the notebook/inspector
 * stores, and the user watches cells appear and run in the real UI.
 *
 * Every failure is a thrown `Error` whose message is written for the model to
 * read and act on ("no notebook open", "no kernel"), not for a log file. The
 * agent store catches them and answers `tool_result { ok: false, error }`.
 */
import { getActiveSession, useNotebookStore } from '../notebook/store';
import type { Cell, NotebookModel } from '../notebook/model';
import { useInspectorStore } from '../inspector/store';
import type { CellOutput } from '../session/types';
import type { OrbitalToolName } from './protocol';

/** Per-cell budget for flattened output text handed to the model. */
export const MAX_OUTPUT_CHARS = 4000;

// ---- output flattening ----------------------------------------------------

/** Text-bearing mimes, best first, for display_data / execute_result. */
const TEXT_MIMES = ['text/plain', 'text/markdown', 'text/html'];

function outputToText(out: CellOutput): string {
  switch (out.type) {
    case 'stream':
      return out.text;
    case 'error':
      return `${out.ename}: ${out.evalue}`;
    case 'display_data':
    case 'execute_result': {
      for (const mime of TEXT_MIMES) {
        const value = out.data[mime];
        if (typeof value === 'string') return value;
      }
      const mimes = Object.keys(out.data);
      return mimes.length ? `[${mimes.join(', ')} output]` : '';
    }
  }
}

/**
 * Flattens a cell's outputs to plain text, capped at `MAX_OUTPUT_CHARS`. The
 * cap keeps one runaway loop from eating the agent's whole context; the
 * suffix tells the model text was dropped so it does not reason as if it saw
 * everything.
 */
export function outputsToText(outputs: CellOutput[]): string {
  const text = outputs
    .map(outputToText)
    .filter((part) => part !== '')
    .join('\n');
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n… [truncated, ${text.length} chars total]`;
}

// ---- store access ---------------------------------------------------------

interface ActiveDoc {
  path: string;
  doc: NotebookModel;
}

function activeDoc(): ActiveDoc {
  const state = useNotebookStore.getState();
  const path = state.activePath;
  const doc = path ? state.docs[path] : null;
  if (!path || !doc) {
    throw new Error(
      'No notebook is open in ORBITAL. Ask the user to open one before using the orbital_* tools.',
    );
  }
  return { path, doc };
}

function currentDoc(path: string): NotebookModel {
  const doc = useNotebookStore.getState().docs[path];
  if (!doc) throw new Error(`The notebook ${path} was closed while the tool was running.`);
  return doc;
}

function cellAt(doc: NotebookModel, index: number): Cell {
  const cell = doc.cells[index];
  if (!cell) {
    const n = doc.cells.length;
    throw new Error(
      n === 0
        ? `Cell index ${index} is out of range: the notebook has no cells.`
        : `Cell index ${index} is out of range: the notebook has ${n} cells (valid indices 0..${n - 1}).`,
    );
  }
  return cell;
}

function requireKernel(): void {
  if (!getActiveSession()) {
    throw new Error(
      'No kernel is connected for the active notebook, so cells cannot be run. Ask the user to connect to the Jupyter server.',
    );
  }
}

function cellStatus(cell: Cell): 'ok' | 'error' | 'aborted' {
  if (cell.state === 'ok') return 'ok';
  if (cell.state === 'error') return 'error';
  return 'aborted';
}

// ---- input readers --------------------------------------------------------

function fields(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Tool input must be an object.');
  }
  return input as Record<string, unknown>;
}

function readIndex(input: unknown, key = 'index'): number {
  const value = fields(input)[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`"${key}" must be a non-negative integer cell index; got ${JSON.stringify(value)}.`);
  }
  return value;
}

function readSource(input: unknown): string {
  const value = fields(input).source;
  if (typeof value !== 'string') {
    throw new Error(`"source" must be a string; got ${JSON.stringify(value)}.`);
  }
  return value;
}

function readCellType(input: unknown): Cell['type'] {
  const value = fields(input).type;
  if (value !== 'code' && value !== 'markdown') {
    throw new Error(`"type" must be "code" or "markdown"; got ${JSON.stringify(value)}.`);
  }
  return value;
}

// ---- tool implementations -------------------------------------------------

function readNotebook(): unknown {
  const { path, doc } = activeDoc();
  return {
    path,
    cells: doc.cells.map((cell, index) => ({
      index,
      type: cell.type,
      source: cell.source,
      outputsText: outputsToText(cell.outputs),
    })),
  };
}

function insertCell(input: unknown): unknown {
  const { path, doc } = activeDoc();
  const raw = fields(input).afterIndex;
  const type = readCellType(input);
  const source = typeof fields(input).source === 'string' ? readSource(input) : '';

  let afterId: string | null = null;
  if (raw !== null && raw !== undefined) {
    afterId = cellAt(doc, readIndex(input, 'afterIndex')).id;
  }

  const id = useNotebookStore.getState().insertCell(afterId, type, source);
  const index = currentDoc(path).cells.findIndex((c) => c.id === id);
  return { index };
}

function editCell(input: unknown): unknown {
  const { doc } = activeDoc();
  const cell = cellAt(doc, readIndex(input));
  useNotebookStore.getState().setSource(cell.id, readSource(input));
  return { ok: true };
}

function deleteCell(input: unknown): unknown {
  const { doc } = activeDoc();
  const cell = cellAt(doc, readIndex(input));
  useNotebookStore.getState().deleteCell(cell.id);
  return { ok: true };
}

async function runCell(input: unknown): Promise<unknown> {
  const { path, doc } = activeDoc();
  const index = readIndex(input);
  const cell = cellAt(doc, index);
  if (cell.type !== 'code') {
    throw new Error(`Cell ${index} is a markdown cell; only code cells can be run.`);
  }
  requireKernel();

  await useNotebookStore.getState().runCell(cell.id);

  const settled = currentDoc(path).cells.find((c) => c.id === cell.id);
  if (!settled) throw new Error(`Cell ${index} was deleted while it was running.`);
  return {
    status: cellStatus(settled),
    outputsText: outputsToText(settled.outputs),
    executionCount: settled.executionCount,
  };
}

async function runAll(): Promise<unknown> {
  const { path, doc } = activeDoc();
  requireKernel();
  const ids = doc.cells.filter((c) => c.type === 'code').map((c) => c.id);

  await useNotebookStore.getState().runAll();

  const cells = currentDoc(path).cells;
  const results = [];
  for (const id of ids) {
    const index = cells.findIndex((c) => c.id === id);
    if (index === -1) continue; // deleted mid-run; nothing to report
    const cell = cells[index];
    results.push({
      index,
      status: cellStatus(cell),
      outputsText: outputsToText(cell.outputs),
      executionCount: cell.executionCount,
    });
  }
  return { results };
}

async function listVariables(): Promise<unknown> {
  const session = getActiveSession();
  if (!session) {
    throw new Error(
      'No kernel is connected for the active notebook, so there are no variables to list.',
    );
  }
  await useInspectorStore.getState().refresh(session);

  const { variables, error } = useInspectorStore.getState();
  if (error) throw new Error(`The variable inspector failed: ${error}`);
  return {
    variables: variables.map((v) => ({
      name: v.name,
      type: v.type,
      shape: v.shape,
      repr: v.repr,
    })),
  };
}

// ---- entry point ----------------------------------------------------------

/**
 * Performs one `orbital_*` tool call. Rejects with a message the model can
 * act on; the caller turns that into `tool_result { ok: false }`.
 */
export async function executeOrbitalTool(name: OrbitalToolName | string, input: unknown): Promise<unknown> {
  switch (name) {
    case 'orbital_read_notebook':
      return readNotebook();
    case 'orbital_insert_cell':
      return insertCell(input);
    case 'orbital_edit_cell':
      return editCell(input);
    case 'orbital_delete_cell':
      return deleteCell(input);
    case 'orbital_run_cell':
      return runCell(input);
    case 'orbital_run_all':
      return runAll();
    case 'orbital_list_variables':
      return listVariables();
    default:
      throw new Error(`Unknown ORBITAL tool: ${name}`);
  }
}

/**
 * Notebook model types. Owned by the orchestrator as a contract.
 * M3 implements fromNbformat/toNbformat in this file (keep the signatures).
 */
import type { CellOutput } from '../session/types';

export type CellState = 'idle' | 'queued' | 'running' | 'ok' | 'error';

export interface Cell {
  id: string;
  type: 'code' | 'markdown';
  source: string;
  /** code cells only; empty for markdown */
  outputs: CellOutput[];
  /** code cells only */
  executionCount: number | null;
  state: CellState;
  metadata: Record<string, unknown>;
}

export interface NotebookModel {
  path: string;
  cells: Cell[];
  /** nbformat metadata, kernelspec and language_info preserved verbatim */
  metadata: Record<string, unknown>;
  nbformat: 4;
  nbformatMinor: number;
}

interface RawNbCell {
  id?: string;
  cell_type: string;
  source?: string | string[];
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
  outputs?: RawNbOutput[];
}

type RawNbOutput =
  | { output_type: 'stream'; name: 'stdout' | 'stderr'; text: string | string[] }
  | {
      output_type: 'display_data' | 'execute_result';
      data: Record<string, string | string[]>;
      metadata?: Record<string, unknown>;
      execution_count?: number | null;
    }
  | { output_type: 'error'; ename: string; evalue: string; traceback: string[] };

interface RawNotebook {
  cells: RawNbCell[];
  metadata?: Record<string, unknown>;
  nbformat?: number;
  nbformat_minor?: number;
}

/** Join nbformat's string-or-array-of-lines convention into one string. */
function joinText(value: string | string[] | undefined): string {
  if (value === undefined) return '';
  return Array.isArray(value) ? value.join('') : value;
}

/**
 * Split a string back into nbformat's line-array convention: every line but
 * the last keeps its trailing "\n".
 */
function splitText(value: string): string[] {
  if (value === '') return [];
  const lines = value.split('\n');
  return lines.map((line, i) => (i < lines.length - 1 ? line + '\n' : line));
}

function outputFromRaw(raw: RawNbOutput): CellOutput {
  if (raw.output_type === 'stream') {
    return { type: 'stream', name: raw.name, text: joinText(raw.text) };
  }
  if (raw.output_type === 'error') {
    return { type: 'error', ename: raw.ename, evalue: raw.evalue, traceback: raw.traceback };
  }
  const data: Record<string, string> = {};
  for (const [mime, value] of Object.entries(raw.data)) {
    data[mime] = joinText(value);
  }
  return {
    type: raw.output_type,
    data,
    ...(raw.metadata ? { metadata: raw.metadata } : {}),
    ...(typeof raw.execution_count === 'number' ? { executionCount: raw.execution_count } : {}),
  };
}

/** nbformat keeps JSON mime types as objects/strings and splits everything else into lines. */
function isJsonMime(mime: string): boolean {
  return mime === 'application/json' || mime.endsWith('+json');
}

function outputToRaw(out: CellOutput): RawNbOutput {
  if (out.type === 'stream') {
    return { output_type: 'stream', name: out.name, text: splitText(out.text) };
  }
  if (out.type === 'error') {
    return { output_type: 'error', ename: out.ename, evalue: out.evalue, traceback: out.traceback };
  }
  const data: Record<string, string | string[]> = {};
  for (const [mime, value] of Object.entries(out.data)) {
    data[mime] = isJsonMime(mime) ? value : splitText(value);
  }
  return {
    output_type: out.type,
    data,
    ...(out.metadata ? { metadata: out.metadata } : {}),
    ...(out.type === 'execute_result' ? { execution_count: out.executionCount ?? null } : {}),
  };
}

/** Parse raw nbformat 4 JSON. Must preserve unknown fields in metadata and outputs. */
export function fromNbformat(raw: unknown, path: string): NotebookModel {
  const nb = raw as RawNotebook;
  const cells: Cell[] = (nb.cells ?? []).map((rc) => {
    const type: Cell['type'] = rc.cell_type === 'markdown' ? 'markdown' : 'code';
    const isCode = type === 'code';
    return {
      id: rc.id ?? cryptoId(),
      type,
      source: joinText(rc.source),
      outputs: isCode ? (rc.outputs ?? []).map(outputFromRaw) : [],
      executionCount: isCode ? (rc.execution_count ?? null) : null,
      state: 'idle',
      metadata: rc.metadata ?? {},
    };
  });
  return {
    path,
    cells,
    metadata: nb.metadata ?? {},
    nbformat: 4,
    nbformatMinor: nb.nbformat_minor ?? 5,
  };
}

/** Serialize back to nbformat 4 JSON. Round-trip of an untouched notebook must be lossless. */
export function toNbformat(nb: NotebookModel): unknown {
  return {
    cells: nb.cells.map((cell) => {
      const base: RawNbCell = {
        id: cell.id,
        cell_type: cell.type,
        metadata: cell.metadata,
        source: splitText(cell.source),
      };
      if (cell.type === 'code') {
        base.execution_count = cell.executionCount;
        base.outputs = cell.outputs.map(outputToRaw);
      }
      return base;
    }),
    metadata: nb.metadata,
    nbformat: nb.nbformat,
    nbformat_minor: nb.nbformatMinor,
  };
}

export function newCell(type: Cell['type'], source = ''): Cell {
  return {
    id: cryptoId(),
    type,
    source,
    outputs: [],
    executionCount: null,
    state: 'idle',
    metadata: {},
  };
}

export function cryptoId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

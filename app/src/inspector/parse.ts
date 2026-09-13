/**
 * Parses the output of `INSPECT_SNIPPET` (see `snippet.ts`) into `Variable[]`.
 * Never throws: any failure to find or parse the payload yields `[]`.
 */
import type { CellOutput } from '../session/types';

export interface Variable {
  name: string;
  type: string;
  module: string | null;
  shape: number[] | null;
  length: number | null;
  repr: string;
  size: number | null;
}

const MARKER = '__ORBITAL_VARS__';

function isVariable(value: unknown): value is Variable {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === 'string' &&
    typeof v.type === 'string' &&
    (v.module === null || typeof v.module === 'string') &&
    (v.shape === null || (Array.isArray(v.shape) && v.shape.every((n) => typeof n === 'number'))) &&
    (v.length === null || typeof v.length === 'number') &&
    typeof v.repr === 'string' &&
    (v.size === null || typeof v.size === 'number')
  );
}

/**
 * Finds the stdout stream text containing the marker and parses the JSON
 * array that follows it on the same logical stream. Stdout chunks are
 * concatenated in order first, since a single print() can arrive split
 * across multiple `stream` outputs.
 */
export function parseInspectOutput(outputs: CellOutput[]): Variable[] {
  try {
    const text = outputs
      .filter((out): out is Extract<CellOutput, { type: 'stream' }> => out.type === 'stream' && out.name === 'stdout')
      .map((out) => out.text)
      .join('');

    const idx = text.indexOf(MARKER);
    if (idx === -1) return [];

    const jsonText = text.slice(idx + MARKER.length).trim();
    const parsed: unknown = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isVariable);
  } catch {
    return [];
  }
}

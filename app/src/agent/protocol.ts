/**
 * Wire protocol between the ORBITAL frontend and the agent sidecar
 * (`agent/server.mjs`, a Node process running the Claude Agent SDK).
 * This file is the source of truth; the sidecar mirrors it in JSDoc.
 *
 * Transport: one WebSocket per browser tab, JSON messages, newline-free.
 * The sidecar is a relay and a loop runner; the browser executes every
 * notebook-touching tool so the user sees it happen live.
 */

export type AgentRunStatus = 'idle' | 'running' | 'waiting_permission' | 'waiting_tool' | 'error';

export interface AgentContext {
  /** Path of the active notebook, if any. */
  notebookPath: string | null;
  /** Index of the selected cell in that notebook, if any. */
  selectedCellIndex: number | null;
  /** Free text the user chose to attach (e.g. the selected cell's source). */
  attachment?: string;
  /**
   * Kernel status of the active notebook at send time, so the agent knows
   * whether the run tools can work before it tries them. Mirrors
   * `session/types.ts` `KernelStatus`; a plain string here to keep the wire
   * contract free of session-layer imports.
   */
  kernelStatus?: string | null;
}

// ---- client -> sidecar ----------------------------------------------------

export type ClientMessage =
  | { type: 'hello'; clientId: string }
  | { type: 'start'; runId: string; prompt: string; context: AgentContext; sessionId?: string }
  | { type: 'interrupt'; runId: string }
  | { type: 'tool_result'; requestId: string; ok: true; result: unknown }
  | { type: 'tool_result'; requestId: string; ok: false; error: string }
  | { type: 'permission'; requestId: string; allow: boolean; remember?: boolean }
  | { type: 'auth_check' };

// ---- sidecar -> client ----------------------------------------------------

export interface AuthStatus {
  loggedIn: boolean;
  /** Human-readable reason when not logged in, e.g. "OAuth session expired". */
  reason?: string;
  /** Exact command the user can run in the ORBITAL terminal to log in. */
  loginCommand: string;
}

/** A content block as rendered by the panel. Subset of the SDK's shapes. */
export type AgentBlock =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_use'; id: string; name: string; input: unknown }
  | { kind: 'tool_result'; toolUseId: string; content: string; isError: boolean };

export type ServerMessage =
  | { type: 'auth'; status: AuthStatus; cwd: string; model: string | null }
  | { type: 'run_status'; runId: string; status: AgentRunStatus; sessionId?: string }
  | { type: 'blocks'; runId: string; role: 'assistant' | 'user'; blocks: AgentBlock[] }
  /** Streamed partial text for the current assistant turn (append-only). */
  | { type: 'delta'; runId: string; text: string }
  | { type: 'tool_request'; requestId: string; runId: string; name: OrbitalToolName; input: Record<string, unknown> }
  | { type: 'permission_request'; requestId: string; runId: string; tool: string; input: unknown; description: string }
  | { type: 'result'; runId: string; ok: boolean; costUsd: number | null; durationMs: number; numTurns: number; sessionId?: string; error?: string }
  | { type: 'error'; runId?: string; message: string };

// ---- tools the browser executes on the sidecar's behalf --------------------

export type OrbitalToolName =
  | 'orbital_read_notebook'     // {} -> { path, cells: [{ index, type, source, outputsText }] }
  | 'orbital_insert_cell'       // { afterIndex: number | null, type: 'code'|'markdown', source } -> { index }
  | 'orbital_edit_cell'         // { index, source } -> { ok: true }
  | 'orbital_delete_cell'       // { index } -> { ok: true }
  | 'orbital_run_cell'          // { index } -> { status: 'ok'|'error'|'aborted', outputsText, executionCount }
  | 'orbital_run_all'           // {} -> { results: [...] }
  | 'orbital_list_variables';   // {} -> { variables: [{ name, type, shape, repr }] }

export const ORBITAL_TOOL_NAMES: OrbitalToolName[] = [
  'orbital_read_notebook',
  'orbital_insert_cell',
  'orbital_edit_cell',
  'orbital_delete_cell',
  'orbital_run_cell',
  'orbital_run_all',
  'orbital_list_variables',
];

/** Tools that mutate state; the panel asks before running them unless "always allow" is on. */
export const MUTATING_TOOLS = new Set<string>([
  'orbital_insert_cell',
  'orbital_edit_cell',
  'orbital_delete_cell',
  'orbital_run_cell',
  'orbital_run_all',
  'Write',
  'Edit',
  'MultiEdit',
  'Bash',
  'NotebookEdit',
]);

export const AGENT_DEFAULT_URL = 'ws://localhost:8787/ws';

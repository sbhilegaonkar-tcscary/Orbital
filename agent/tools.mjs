/**
 * The `orbital_*` tools, exposed to the model as an in-process MCP server.
 *
 * None of them touch a file or a kernel here. Each one relays its arguments to
 * the ORBITAL tab that owns the run (`tool_request`) and waits for that tab to
 * perform it through the notebook store and answer (`tool_result`). That is
 * what makes the agent's edits appear in the real UI, cell by cell, instead of
 * behind the user's back.
 *
 * The descriptions below are the model's entire documentation for this
 * environment; they are written for it to read, not for us.
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

/** Server name; tools reach the model as `mcp__orbital__orbital_*`. */
export const ORBITAL_SERVER_NAME = 'orbital';
export const ORBITAL_TOOL_PREFIX = `mcp__${ORBITAL_SERVER_NAME}__`;

/** Running a cell can take a long time; everything else is a store update. */
export const RUN_TOOL_TIMEOUT_MS = 120_000;
export const FAST_TOOL_TIMEOUT_MS = 15_000;

/** Tools ORBITAL runs without asking: they only read. */
export const READ_ONLY_ORBITAL_TOOLS = ['orbital_read_notebook', 'orbital_list_variables'];

const CELL_INDEX = z
  .number()
  .int()
  .min(0)
  .describe('Zero-based index of the cell, as reported by orbital_read_notebook.');

/**
 * Wraps a bridge call so the model always gets something readable back: JSON
 * on success, the failure text with `isError` on a rejection.
 */
function relay(call, name, input, timeoutMs) {
  return call(name, input, timeoutMs).then(
    (result) => ({ content: [{ type: 'text', text: JSON.stringify(result) }] }),
    (err) => ({
      content: [{ type: 'text', text: err?.message ? String(err.message) : String(err) }],
      isError: true,
    }),
  );
}

/**
 * @param {(name: string, input: unknown, timeoutMs: number) => Promise<unknown>} call
 *   Sends one `tool_request` to the owning browser tab and resolves with its
 *   `tool_result`, or rejects with the error the tab reported.
 */
export function createOrbitalTools(call) {
  return [
    tool(
      'orbital_read_notebook',
      'Read the notebook the user currently has open in ORBITAL: its path and every cell with a zero-based index, cell type, full source, and the text of its current outputs (truncated per cell). Call this first, before any other orbital tool, because every other tool addresses cells by the indices this returns. Re-read after you insert or delete cells, since those shift every later index.',
      {},
      () => relay(call, 'orbital_read_notebook', {}, FAST_TOOL_TIMEOUT_MS),
    ),

    tool(
      'orbital_insert_cell',
      'Insert a new cell into the open notebook and return its index. The cell appears immediately in the user\'s notebook but is NOT executed; call orbital_run_cell afterwards if it should run. Prefer inserting a new cell over rewriting an existing one when you are adding work rather than fixing it.',
      {
        afterIndex: z
          .number()
          .int()
          .min(0)
          .nullable()
          .describe(
            'Insert directly after this cell index. Use null to insert at the very top of the notebook.',
          ),
        type: z
          .enum(['code', 'markdown'])
          .describe('"code" for a runnable cell, "markdown" for prose, headings or explanation.'),
        source: z
          .string()
          .describe('Full text of the new cell. Do not wrap code in markdown fences.'),
      },
      (args) => relay(call, 'orbital_insert_cell', args, FAST_TOOL_TIMEOUT_MS),
    ),

    tool(
      'orbital_edit_cell',
      'Replace the entire source of one existing cell. There is no partial edit: pass the complete new text, which means reading the cell first so you do not drop anything the user wrote. Outputs from the previous run stay on screen until the cell is run again.',
      {
        index: CELL_INDEX,
        source: z.string().describe('The complete new source for this cell; it replaces the old text entirely.'),
      },
      (args) => relay(call, 'orbital_edit_cell', args, FAST_TOOL_TIMEOUT_MS),
    ),

    tool(
      'orbital_delete_cell',
      'Delete one cell from the open notebook. This destroys the user\'s work, so only do it when they asked for it. Every cell after the deleted one shifts down by one index, so re-read the notebook before addressing cells again.',
      { index: CELL_INDEX },
      (args) => relay(call, 'orbital_delete_cell', args, FAST_TOOL_TIMEOUT_MS),
    ),

    tool(
      'orbital_run_cell',
      'Execute one code cell on the notebook\'s live Jupyter kernel and wait for it to finish, then return its status ("ok", "error" or "aborted"), its output text and its execution count. State persists in the kernel between calls, exactly as if the user had run the cell. Use this to check your own work: write a cell, run it, read the error, fix it.',
      { index: CELL_INDEX },
      (args) => relay(call, 'orbital_run_cell', args, RUN_TOOL_TIMEOUT_MS),
    ),

    tool(
      'orbital_run_all',
      'Execute every code cell in the open notebook from top to bottom and return each one\'s index, status and output text. This can take a long time and can overwrite kernel state the user cares about; prefer orbital_run_cell on the specific cells you changed unless the user asked for a full re-run.',
      {},
      () => relay(call, 'orbital_run_all', {}, RUN_TOOL_TIMEOUT_MS),
    ),

    tool(
      'orbital_list_variables',
      'List the variables currently defined in the notebook\'s kernel, with each one\'s name, Python type, shape (for arrays and dataframes) and a short repr. Use this instead of inserting a scratch cell full of print() calls when you want to know what the user\'s session already holds.',
      {},
      () => relay(call, 'orbital_list_variables', {}, FAST_TOOL_TIMEOUT_MS),
    ),
  ];
}

/**
 * @param {(name: string, input: unknown, timeoutMs: number) => Promise<unknown>} call
 */
export function createOrbitalMcpServer(call) {
  return createSdkMcpServer({
    name: ORBITAL_SERVER_NAME,
    version: '0.1.0',
    tools: createOrbitalTools(call),
  });
}

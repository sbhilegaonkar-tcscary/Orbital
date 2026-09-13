/**
 * Strips ANSI escape sequences (color codes, cursor moves, etc.) that
 * kernels embed in stream/traceback text. Output.tsx uses this before
 * rendering tracebacks so `<pre>` shows plain text plus our own highlight.
 */
const ANSI_PATTERN =
  /[][[\]()#;?]*(?:(?:(?:[a-zA-Z0-9]*(?:;[a-zA-Z0-9]*)*)?)|(?:(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-ntqry=><~]))/g;

export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, '');
}

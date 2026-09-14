/**
 * ANSI escape-sequence handling for kernel stream/traceback text.
 *
 * `stripAnsi` removes every escape sequence (color codes, cursor moves,
 * etc.) for callers that just want plain text (e.g. the `---->` traceback
 * highlight check in Output.tsx).
 *
 * `ansiToSpans` interprets only SGR ("Select Graphic Rendition", the
 * `ESC [ ... m` sequences) codes and turns text into a list of
 * `{ text, classes }` spans that Output.tsx renders as `<span>`s styled from
 * output.css. Every other escape sequence (cursor movement, screen clears,
 * etc.) is dropped silently — it has no text-styling meaning. Colors are
 * always one of the 16 ANSI slots (never inline colors) so the palette stays
 * token-driven; codes we don't recognize are ignored, leaving surrounding
 * text and active styles unchanged.
 */
const ANSI_PATTERN =
  /[][[\]()#;?]*(?:(?:(?:[a-zA-Z0-9]*(?:;[a-zA-Z0-9]*)*)?)|(?:(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-ntqry=><~]))/g;

export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, '');
}

export interface AnsiSpan {
  text: string;
  classes: string[];
}

interface AnsiState {
  fg: number | null;
  bg: number | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
}

function freshState(): AnsiState {
  return { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false };
}

/**
 * Maps a 256-color palette index (0-255) to the nearest of the 16 base ANSI
 * indices, so the renderer never needs an inline color. 0-15 map to
 * themselves; 16-231 are the 6x6x6 color cube (each channel bucketed to
 * on/off, with a brightness bump into the 8-15 "bright" range); 232-255 are
 * the grayscale ramp (dark half -> black, light half -> white).
 */
function build256To16(): number[] {
  const table: number[] = [];
  for (let i = 0; i < 256; i++) {
    if (i < 16) {
      table.push(i);
      continue;
    }
    if (i >= 232) {
      table.push(i - 232 < 12 ? 0 : 15);
      continue;
    }
    const idx = i - 16;
    const r = Math.floor(idx / 36);
    const g = Math.floor((idx % 36) / 6);
    const b = idx % 6;
    const base = (r >= 3 ? 1 : 0) + (g >= 3 ? 2 : 0) + (b >= 3 ? 4 : 0);
    const bright = r + g + b >= 9 ? 8 : 0;
    table.push(base + bright);
  }
  return table;
}

const BASE16_FROM_256 = build256To16();

function currentClasses(state: AnsiState): string[] {
  const classes: string[] = [];
  if (state.fg !== null) classes.push(`ansi-fg-${state.fg}`);
  if (state.bg !== null) classes.push(`ansi-bg-${state.bg}`);
  if (state.bold) classes.push('ansi-bold');
  if (state.dim) classes.push('ansi-dim');
  if (state.italic) classes.push('ansi-italic');
  if (state.underline) classes.push('ansi-underline');
  if (state.inverse) classes.push('ansi-inverse');
  return classes;
}

function applySgr(paramStr: string, state: AnsiState): void {
  const params = paramStr === '' ? [0] : paramStr.split(';').map((p) => (p === '' ? 0 : parseInt(p, 10)));
  for (let i = 0; i < params.length; i++) {
    const code = params[i];
    if (code === 0) {
      Object.assign(state, freshState());
    } else if (code === 1) {
      state.bold = true;
    } else if (code === 2) {
      state.dim = true;
    } else if (code === 3) {
      state.italic = true;
    } else if (code === 4) {
      state.underline = true;
    } else if (code === 7) {
      state.inverse = true;
    } else if (code === 22) {
      state.bold = false;
      state.dim = false;
    } else if (code === 23) {
      state.italic = false;
    } else if (code === 24) {
      state.underline = false;
    } else if (code === 27) {
      state.inverse = false;
    } else if (code >= 30 && code <= 37) {
      state.fg = code - 30;
    } else if (code === 38) {
      if (params[i + 1] === 5) {
        const n = params[i + 2];
        if (n !== undefined) state.fg = BASE16_FROM_256[n] ?? state.fg;
        i += 2;
      } else if (params[i + 1] === 2) {
        // truecolor r;g;b — no 16-slot equivalent; leave fg unchanged.
        i += 4;
      }
    } else if (code === 39) {
      state.fg = null;
    } else if (code >= 40 && code <= 47) {
      state.bg = code - 40;
    } else if (code === 48) {
      if (params[i + 1] === 5) {
        const n = params[i + 2];
        if (n !== undefined) state.bg = BASE16_FROM_256[n] ?? state.bg;
        i += 2;
      } else if (params[i + 1] === 2) {
        i += 4;
      }
    } else if (code === 49) {
      state.bg = null;
    } else if (code >= 90 && code <= 97) {
      state.fg = code - 90 + 8;
    } else if (code >= 100 && code <= 107) {
      state.bg = code - 100 + 8;
    }
    // Unknown codes (blink, conceal, strike, etc.) are ignored: the text
    // they wrap passes through unchanged, with whatever styles were already
    // active.
  }
}

const CSI_PATTERN = /\x1b\[([0-9;]*)([A-Za-z])/g;

export function ansiToSpans(input: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  const state = freshState();

  let lastIndex = 0;
  CSI_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CSI_PATTERN.exec(input)) !== null) {
    const [full, paramStr, letter] = match;
    const start = match.index;
    if (start > lastIndex) {
      spans.push({ text: input.slice(lastIndex, start), classes: currentClasses(state) });
    }
    lastIndex = start + full.length;
    if (letter === 'm') {
      applySgr(paramStr, state);
    }
    // Non-SGR CSI sequences (cursor moves, line/screen clears, ...) carry no
    // styling information and are simply consumed.
  }
  if (lastIndex < input.length) {
    spans.push({ text: input.slice(lastIndex), classes: currentClasses(state) });
  }
  return spans;
}

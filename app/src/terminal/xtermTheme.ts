/**
 * Builds an xterm `ITheme` from the current design tokens instead of
 * hardcoding colors. Every value is read live via `getComputedStyle` so a
 * skin/mode change just means calling this again and re-assigning
 * `term.options.theme` (see `TerminalView.tsx`, which subscribes to
 * `useThemeStore` for that).
 *
 * xterm needs concrete color strings, not `color-mix()`, so the "cyan" ANSI
 * slot and the "bright" variants are produced by blending two resolved
 * token colors ourselves in `blend()`.
 */
import type { ITheme } from '@xterm/xterm';

function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
}

/** Parses a token color already resolved by the browser into 0-255 channels. */
function parseChannels(input: string): [number, number, number] {
  const value = input.trim();
  if (value.startsWith('#')) {
    let hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .split('')
        .map((ch) => ch + ch)
        .join('');
    }
    return [parseInt(hex.slice(0, 2), 16) || 0, parseInt(hex.slice(2, 4), 16) || 0, parseInt(hex.slice(4, 6), 16) || 0];
  }
  if (value.startsWith('rgb')) {
    const open = value.indexOf('(');
    const close = value.indexOf(')');
    const inner = open === -1 ? value : value.slice(open + 1, close === -1 ? undefined : close);
    const parts = inner.split(',').map((part) => parseFloat(part.trim()) || 0);
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  }
  return [0, 0, 0];
}

function toChannelHex(n: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(n)));
  return clamped.toString(16).padStart(2, '0');
}

/** Blends two already-resolved token colors (hex or the browser's rgb form); t=0 is `a`, t=1 is `b`. */
export function blend(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseChannels(a);
  const [br, bg, bb] = parseChannels(b);
  const r = ar + (br - ar) * t;
  const g = ag + (bg - ag) * t;
  const bl = ab + (bb - ab) * t;
  return '#' + toChannelHex(r) + toChannelHex(g) + toChannelHex(bl);
}

/** Reads the 16 theme tokens off `:root` and maps them onto xterm's ITheme. */
export function buildXtermTheme(): ITheme {
  const mode = document.documentElement.dataset.mode;
  const background = readToken(mode === 'cockpit' ? 'surface' : 'bg');
  const foreground = readToken('text');
  const textMuted = readToken('text-muted');
  const accent = readToken('accent');
  const accent2 = readToken('accent-2');
  const success = readToken('success');
  const warning = readToken('warning');
  const danger = readToken('danger');

  const black = textMuted;
  const red = danger;
  const green = success;
  const yellow = warning;
  const blue = accent;
  const magenta = accent2;
  // 60% accent / 40% success, since xterm has no direct "cyan" token.
  const cyan = blend(accent, success, 0.4);
  const white = foreground;

  const brighten = (color: string) => blend(color, foreground, 0.2);

  return {
    background,
    foreground,
    cursor: accent,
    cursorAccent: background,
    selectionBackground: accent,
    selectionForeground: background,
    black,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white,
    brightBlack: brighten(black),
    brightRed: brighten(red),
    brightGreen: brighten(green),
    brightYellow: brighten(yellow),
    brightBlue: brighten(blue),
    brightMagenta: brighten(magenta),
    brightCyan: brighten(cyan),
    brightWhite: brighten(white),
  };
}

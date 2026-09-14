import { describe, expect, it } from 'vitest';
import { ansiToSpans, stripAnsi } from './ansi';

describe('ansiToSpans', () => {
  it('colors a tqdm-style progress line', () => {
    const line = '\x1b[32m100%|█████\x1b[0m| 48000/48000 [00:03<00:00, 14231.05it/s]';
    const spans = ansiToSpans(line);

    expect(spans).toEqual([
      { text: '100%|█████', classes: ['ansi-fg-2'] },
      { text: '| 48000/48000 [00:03<00:00, 14231.05it/s]', classes: [] },
    ]);
  });

  it('nests bold and color', () => {
    const line = '\x1b[1m\x1b[31mERROR\x1b[0m: something broke';
    const spans = ansiToSpans(line);

    expect(spans).toEqual([
      { text: 'ERROR', classes: ['ansi-fg-1', 'ansi-bold'] },
      { text: ': something broke', classes: [] },
    ]);
  });

  it('resets styling mid-string', () => {
    const line = '\x1b[31mred\x1b[0mplain';
    const spans = ansiToSpans(line);

    expect(spans).toEqual([
      { text: 'red', classes: ['ansi-fg-1'] },
      { text: 'plain', classes: [] },
    ]);
  });

  it('passes an unknown SGR code through unchanged', () => {
    // 5 = blink, which we don't model as a class; the text and any other
    // active styling should be unaffected.
    const line = '\x1b[5mstill here\x1b[0m';
    const spans = ansiToSpans(line);

    expect(spans).toEqual([{ text: 'still here', classes: [] }]);
  });

  it('maps 256-color base indices (38;5;n) to the 16-slot classes', () => {
    const line = '\x1b[38;5;9mbright red\x1b[0m';
    const spans = ansiToSpans(line);

    expect(spans).toEqual([{ text: 'bright red', classes: ['ansi-fg-9'] }]);
  });

  it('handles bright fg/bg (90-97, 100-107) and background colors', () => {
    const line = '\x1b[96;100mcyan on bright black\x1b[0m';
    const spans = ansiToSpans(line);

    expect(spans).toEqual([{ text: 'cyan on bright black', classes: ['ansi-fg-14', 'ansi-bg-8'] }]);
  });

  it('drops non-SGR escape sequences without affecting styling', () => {
    // The cursor-move code between the two text chunks carries no style
    // information: both chunks keep the fg-1 class the leading SGR set.
    const line = '\x1b[31mred\x1b[2Ktext\x1b[0m';
    const spans = ansiToSpans(line);

    expect(spans).toEqual([
      { text: 'red', classes: ['ansi-fg-1'] },
      { text: 'text', classes: ['ansi-fg-1'] },
    ]);
  });
});

describe('stripAnsi', () => {
  it('removes SGR sequences, leaving plain text', () => {
    expect(stripAnsi('\x1b[0;31mNameError\x1b[0m: boom')).toBe('NameError: boom');
  });

  it('leaves plain text untouched', () => {
    expect(stripAnsi('no escapes here')).toBe('no escapes here');
  });
});

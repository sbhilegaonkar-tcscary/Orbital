/**
 * Renders a cell's CellOutput[]: stream text and text/plain through the ANSI
 * converter (colored tracebacks and tqdm-style bars render correctly),
 * execute_result/display_data by mime preference (html > svg > png > jpeg >
 * markdown > json > plain), and errors as a traceback with the failing frame
 * highlighted.
 *
 * `text/html` that carries executable content (Plotly/Bokeh/Altair/folium
 * all emit a `<script>`) renders inside OutputFrame's sandboxed iframe;
 * everything else keeps the plain DOMPurify path. Streams and text/plain
 * outputs over 10,000 lines or ~1MB are truncated to their first 200 and
 * last 50 lines behind a "Show all" toggle so a runaway print doesn't wreck
 * the page.
 *
 * When `collapsed` (nbformat's `cell.metadata.collapsed`), renders a single
 * muted summary bar instead; clicking it expands via `onToggleCollapse`.
 */
import { useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { CellOutput } from '../session/types';
import { ansiToSpans, stripAnsi } from './ansi';
import { OutputFrame, needsSandbox } from './OutputFrame';
import './output.css';

type DataOutput = Extract<CellOutput, { type: 'display_data' | 'execute_result' }>;
type StreamOutput = Extract<CellOutput, { type: 'stream' }>;

const MIME_PREFERENCE = [
  'text/html',
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'text/markdown',
  'application/json',
  'text/plain',
  'text/latex',
] as const;

// A stream/plain-text output past either threshold is truncated to its head
// and tail rather than rendered in full.
const LARGE_LINE_THRESHOLD = 10_000;
const LARGE_BYTE_THRESHOLD = 1_000_000; // ~1MB; text.length is a fine proxy here.
const LARGE_OUTPUT_HEAD = 200;
const LARGE_OUTPUT_TAIL = 50;

// A trailing newline (the common case: every print() ends with one) does not
// count as a further, empty line — otherwise the tail slice below would end
// up showing a blank line instead of the last real one.
function countLines(text: string): number {
  let n = text.endsWith('\n') ? 0 : 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function isLargeOutput(text: string): boolean {
  return text.length > LARGE_BYTE_THRESHOLD || countLines(text) > LARGE_LINE_THRESHOLD;
}

function AnsiText({ text }: { text: string }) {
  return (
    <>
      {ansiToSpans(text).map((span, i) => (
        <span key={i} className={span.classes.join(' ') || undefined}>
          {span.text}
        </span>
      ))}
    </>
  );
}

/** Renders `text` through AnsiText, truncating head/tail when it's large. */
function AnsiBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  if (expanded || !isLargeOutput(text)) {
    return <AnsiText text={text} />;
  }

  const endsWithNewline = text.endsWith('\n');
  const lines = (endsWithNewline ? text.slice(0, -1) : text).split('\n');
  const head = lines.slice(0, LARGE_OUTPUT_HEAD).join('\n');
  const tail = lines.slice(-LARGE_OUTPUT_TAIL).join('\n') + (endsWithNewline ? '\n' : '');
  const hidden = lines.length - LARGE_OUTPUT_HEAD - LARGE_OUTPUT_TAIL;

  return (
    <>
      <AnsiText text={head} />
      <span className="cell-output-truncated">
        {'\n'}… {hidden} lines hidden ·{' '}
        <button type="button" className="cell-output-show-all" onClick={() => setExpanded(true)}>
          Show all
        </button>
        {'\n'}
      </span>
      <AnsiText text={tail} />
    </>
  );
}

function renderStream(out: StreamOutput, key: string) {
  return (
    <pre key={key} className="cell-output-stream" data-name={out.name}>
      <AnsiBlock text={out.text} />
    </pre>
  );
}

function renderMarkdown(value: string, key: string) {
  const rawHtml = marked.parse(value, { async: false }) as string;
  const safeHtml = DOMPurify.sanitize(rawHtml);
  return (
    <div
      key={key}
      className="cell-output-markdown"
      // Sanitized just above; markdown source, not raw HTML.
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}

function renderJson(value: string, key: string) {
  let pretty = value;
  try {
    pretty = JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    // Not valid JSON (or already formatted) — show it verbatim.
  }
  return (
    <pre key={key} className="cell-output-text">
      {pretty}
    </pre>
  );
}

function renderDataOutput(out: DataOutput, key: string) {
  for (const mime of MIME_PREFERENCE) {
    const value = out.data[mime];
    if (value === undefined) continue;

    switch (mime) {
      case 'text/html':
        return needsSandbox(value) ? (
          <OutputFrame key={key} html={value} />
        ) : (
          <div
            key={key}
            className="cell-output-html"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(value) }}
          />
        );
      case 'image/svg+xml':
        return (
          <div key={key} className="cell-output-svg" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(value) }} />
        );
      case 'image/png':
        return <img key={key} className="cell-output-image" src={`data:image/png;base64,${value}`} alt="" />;
      case 'image/jpeg':
        return <img key={key} className="cell-output-image" src={`data:image/jpeg;base64,${value}`} alt="" />;
      case 'text/markdown':
        return renderMarkdown(value, key);
      case 'application/json':
        return renderJson(value, key);
      case 'text/plain':
      case 'text/latex':
        return (
          <pre key={key} className="cell-output-text">
            <AnsiBlock text={value} />
          </pre>
        );
    }
  }
  return null;
}

function renderTraceback(traceback: string[], key: string) {
  return (
    <pre key={key} className="cell-traceback">
      {traceback.map((line, i) => {
        const clean = stripAnsi(line);
        const suffix = i < traceback.length - 1 ? '\n' : '';
        const text = line + suffix;
        if (clean.startsWith('---->')) {
          return (
            <span key={i} className="hl">
              <AnsiText text={text} />
            </span>
          );
        }
        return <AnsiText key={i} text={text} />;
      })}
    </pre>
  );
}

export interface OutputProps {
  outputs: CellOutput[];
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Output({ outputs, collapsed, onToggleCollapse }: OutputProps) {
  if (outputs.length === 0) return null;

  if (collapsed) {
    const n = outputs.length;
    return (
      <div
        className="cell-output cell-output-collapsed"
        role="button"
        tabIndex={0}
        onClick={onToggleCollapse}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleCollapse?.();
          }
        }}
      >
        <span className="cell-output-collapsed-label">
          ⋯ {n} output{n === 1 ? '' : 's'} hidden
        </span>
      </div>
    );
  }

  return (
    <div className="cell-output">
      {outputs.map((out, i) => {
        const key = String(i);
        if (out.type === 'stream') {
          return renderStream(out, key);
        }
        if (out.type === 'error') {
          return renderTraceback(out.traceback, key);
        }
        return renderDataOutput(out, key);
      })}
    </div>
  );
}

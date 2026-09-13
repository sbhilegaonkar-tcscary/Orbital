/**
 * Renders a cell's CellOutput[]: stream text, execute_result/display_data by
 * mime preference (html > png > svg > plain text), and errors as a
 * traceback with ANSI stripped and the failing frame highlighted.
 */
import DOMPurify from 'dompurify';
import type { CellOutput } from '../session/types';
import { stripAnsi } from './ansi';

type DataOutput = Extract<CellOutput, { type: 'display_data' | 'execute_result' }>;

const MIME_PREFERENCE = ['text/html', 'image/png', 'image/svg+xml', 'text/plain'] as const;

function renderDataOutput(out: DataOutput, key: string) {
  for (const mime of MIME_PREFERENCE) {
    const value = out.data[mime];
    if (value === undefined) continue;
    if (mime === 'text/html') {
      return (
        <div
          key={key}
          className="cell-output-html"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(value) }}
        />
      );
    }
    if (mime === 'image/png') {
      return <img key={key} className="cell-output-image" src={`data:image/png;base64,${value}`} alt="" />;
    }
    if (mime === 'image/svg+xml') {
      return (
        <div key={key} className="cell-output-svg" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(value) }} />
      );
    }
    return (
      <pre key={key} className="cell-output-text">
        {value}
      </pre>
    );
  }
  return null;
}

function renderTraceback(traceback: string[], key: string) {
  return (
    <pre key={key} className="cell-traceback">
      {traceback.map((line, i) => {
        const clean = stripAnsi(line);
        const suffix = i < traceback.length - 1 ? '\n' : '';
        if (clean.startsWith('---->')) {
          return (
            <span key={i} className="hl">
              {clean}
              {suffix}
            </span>
          );
        }
        return clean + suffix;
      })}
    </pre>
  );
}

export function Output({ outputs }: { outputs: CellOutput[] }) {
  if (outputs.length === 0) return null;
  return (
    <div className="cell-output">
      {outputs.map((out, i) => {
        const key = String(i);
        if (out.type === 'stream') {
          return (
            <pre key={key} className="cell-output-stream" data-name={out.name}>
              {out.text}
            </pre>
          );
        }
        if (out.type === 'error') {
          return renderTraceback(out.traceback, key);
        }
        return renderDataOutput(out, key);
      })}
    </div>
  );
}

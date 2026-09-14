/**
 * Two-color unified diff of an `old_string`/`new_string` pair (Edit,
 * MultiEdit's per-edit entries, Write's implicit empty-old). Line-level LCS
 * diff — the inputs here are small tool-call snippets, not whole files, so
 * an O(n*m) table is cheap. Tokens only (docs/DESIGN.md): additions tint
 * `--success`, deletions tint `--danger`, unchanged lines stay `--text-muted`.
 */
import { useMemo } from 'react';

export interface DiffViewProps {
  oldText: string;
  newText: string;
}

type DiffLineType = 'add' | 'del' | 'ctx';
interface DiffLine {
  type: DiffLineType;
  text: string;
}

const MARK: Record<DiffLineType, string> = { add: '+', del: '-', ctx: ' ' };

function splitLines(text: string): string[] {
  return text.length ? text.split('\n') : [];
}

function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length;
  const m = b.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ type: 'ctx', text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ type: 'del', text: a[i] });
      i += 1;
    } else {
      lines.push({ type: 'add', text: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    lines.push({ type: 'del', text: a[i] });
    i += 1;
  }
  while (j < m) {
    lines.push({ type: 'add', text: b[j] });
    j += 1;
  }
  return lines;
}

export function DiffView({ oldText, newText }: DiffViewProps) {
  const lines = useMemo(() => diffLines(oldText, newText), [oldText, newText]);
  return (
    <div className="diff-view">
      {lines.map((line, i) => (
        <div key={i} className={`diff-line diff-line-${line.type}`}>
          <span className="diff-mark">{MARK[line.type]}</span>
          <span className="diff-text">{line.text}</span>
        </div>
      ))}
    </div>
  );
}

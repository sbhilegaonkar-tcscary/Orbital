import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useCommandStore, runCommand, type Command } from './commands';

interface ScoredCommand {
  command: Command;
  score: number;
}

/** Subsequence fuzzy match. Returns null when `query`'s characters do not all
 * appear in order in `text`; otherwise a score where higher is a better match
 * (contiguous runs and early matches score higher). */
function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  let qi = 0;
  let lastIndex = -1;
  let score = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti += 1) {
    if (t[ti] === q[qi]) {
      score += lastIndex === ti - 1 ? 3 : 1;
      lastIndex = ti;
      qi += 1;
    }
  }
  if (qi < q.length) return null;
  const firstMatch = t.indexOf(q[0]);
  score += Math.max(0, 10 - firstMatch);
  return score;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const commandsById = useCommandStore((s) => s.commands);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<HTMLDivElement[]>([]);

  const results = useMemo<ScoredCommand[]>(() => {
    const applicable = Object.values(commandsById).filter((c) => !c.when || c.when());
    const scored: ScoredCommand[] = [];
    for (const command of applicable) {
      const score = fuzzyScore(query, `${command.title} ${command.category}`);
      if (score !== null) scored.push({ command, score });
    }
    scored.sort((a, b) => b.score - a.score || a.command.title.localeCompare(b.command.title));
    return scored;
  }, [commandsById, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open, onClose]);

  if (!open) return null;

  function runActive() {
    const entry = results[activeIndex];
    if (!entry) return;
    runCommand(entry.command.id);
    onClose();
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runActive();
    }
  }

  return (
    <div className="command-palette-overlay">
      <div className="command-palette" ref={rootRef} role="dialog" aria-label="Command palette">
        <input
          ref={inputRef}
          type="text"
          className="command-palette-input"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="command-palette-list" role="listbox">
          {results.length === 0 && <div className="command-palette-empty">No matching commands</div>}
          {results.map(({ command }, index) => (
            <div
              key={command.id}
              ref={(el) => {
                if (el) itemRefs.current[index] = el;
              }}
              role="option"
              aria-selected={index === activeIndex}
              className={`command-palette-row${index === activeIndex ? ' active' : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => {
                runCommand(command.id);
                onClose();
              }}
            >
              <span className="command-palette-row-title">{command.title}</span>
              {command.shortcut && <span className="command-palette-row-shortcut">{command.shortcut}</span>}
              <span className="command-palette-row-category muted">{command.category}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

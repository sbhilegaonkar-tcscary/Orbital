import { useEffect, useState } from 'react';
import { useActiveNotebook } from '../notebook/store';

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86_400_000);
}

function formatStarDate(d: Date): string {
  const year = d.getFullYear();
  const doy = String(dayOfYear(d)).padStart(3, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `Star date ${year}.${doy} · ${hh}:${mm}`;
}

export function StatusBar() {
  const notebook = useActiveNotebook();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const cells = notebook?.cells.length ?? 0;
  const executed = notebook?.cells.filter((c) => c.executionCount !== null).length ?? 0;
  const errors = notebook?.cells.filter((c) => c.state === 'error').length ?? 0;

  return (
    <footer className="statusbar">
      <span className="statusbar-left">
        {cells} cells · {executed} executed · {errors} error(s)
      </span>
      <span className="statusbar-right">{formatStarDate(now)}</span>
    </footer>
  );
}

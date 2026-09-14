/**
 * A 6px drag handle between two layout regions. `orientation="vertical"`
 * drags left/right (cursor: col-resize) for side docks; `"horizontal"` drags
 * up/down (cursor: row-resize) for the bottom dock and stacked side panels.
 * Reports raw pointer-move delta in `onResize`; the caller applies the sign
 * (a resizer can sit on either edge of the region it resizes). Double-click
 * resets to the default via `onReset`.
 */
import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

interface ResizerProps {
  orientation: 'vertical' | 'horizontal';
  ariaLabel: string;
  onResize(deltaPx: number): void;
  onReset(): void;
}

export function Resizer({ orientation, ariaLabel, onResize, onReset }: ResizerProps) {
  const lastPos = useRef<number | null>(null);

  function posOf(e: ReactPointerEvent<HTMLDivElement>): number {
    return orientation === 'vertical' ? e.clientX : e.clientY;
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    lastPos.current = posOf(e);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (lastPos.current === null) return;
    const pos = posOf(e);
    const delta = pos - lastPos.current;
    lastPos.current = pos;
    if (delta !== 0) onResize(delta);
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    lastPos.current = null;
  }

  return (
    <div
      className={`resizer resizer-${orientation}`}
      role="separator"
      aria-orientation={orientation === 'vertical' ? 'vertical' : 'horizontal'}
      aria-label={ariaLabel}
      tabIndex={-1}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={onReset}
    />
  );
}

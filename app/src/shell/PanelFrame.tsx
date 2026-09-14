/**
 * Chrome shared by every dockable panel: a slim header with a title, an
 * optional "move to other side" button (side panels only), and a hide (x)
 * button, above a body that scrolls independently of the header.
 *
 * Phase-B panel agents (files, terminal): render your panel's real content
 * as `children` wherever `<PanelFrame>` is used for your panel in `Dock.tsx`
 * — the `.panel-frame-body` wrapper already handles `overflow: auto` and
 * `min-height: 0`, so your component just needs to fill it (height: 100%).
 */
import type { ReactNode } from 'react';

interface PanelFrameProps {
  title: string;
  onMoveSide?: () => void;
  onHide: () => void;
  children: ReactNode;
}

function MoveIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d="M1.5 5h9.5M11 5 8.7 2.7M11 5 8.7 7.3M14.5 11H5M5 11l2.3-2.3M5 11l2.3 2.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PanelFrame({ title, onMoveSide, onHide, children }: PanelFrameProps) {
  return (
    <div className="panel-frame">
      <div className="panel-frame-header">
        <span className="panel-frame-title">{title}</span>
        <div className="panel-frame-actions">
          {onMoveSide && (
            <button
              type="button"
              className="panel-frame-btn"
              onClick={onMoveSide}
              aria-label={`Move ${title} to other side`}
              title="Move to other side"
            >
              <MoveIcon />
            </button>
          )}
          <button
            type="button"
            className="panel-frame-btn panel-frame-btn-close"
            onClick={onHide}
            aria-label={`Hide ${title}`}
            title="Hide"
          >
            ×
          </button>
        </div>
      </div>
      <div className="panel-frame-body">{children}</div>
    </div>
  );
}

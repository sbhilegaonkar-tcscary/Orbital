/**
 * Renders the panels assigned to one side of the shell. `files` and
 * `inspector` can land on `left` or `right`; when both share a side they
 * stack vertically with a resizer between them. `terminal` is `bottom`-only
 * and is always alone in its dock.
 *
 * `Dock` only owns the resizer *between* co-located panels. The outer edge
 * resizer — between the dock and the center column, which changes the
 * dock's width/height in `LayoutState` — is rendered by `AppShell`, since
 * `Dock` has no reason to know its own on-screen position.
 *
 * Phase-B panel agents (files, terminal): your panel's body is picked in
 * `renderPanelBody` below — swap the muted placeholder for your component.
 * It renders inside a `.panel-frame-body` (see `PanelFrame.tsx`) that
 * already scrolls and has `min-height: 0`; fill it with `height: 100%`.
 */
import { useState } from 'react';
import { Inspector } from './Inspector';
import { PanelFrame } from './PanelFrame';
import { Resizer } from './Resizer';
import { idsOnSide, useLayoutStore, type DockSide, type PanelId } from './layout';
import { TerminalPanel } from '../terminal/TerminalPanel';
import { FileBrowser } from '../files/FileBrowser';
import { AgentPanel } from '../agent/AgentPanel';

const PANEL_TITLES: Record<PanelId, string> = {
  files: 'Files',
  inspector: 'Inspector',
  terminal: 'Terminal',
  agent: 'Agent',
};

/** Only side panels (left|right) can move to the other side. */
const MOVABLE = new Set<PanelId>(['files', 'inspector', 'agent']);

function renderPanelBody(id: PanelId) {
  switch (id) {
    case 'inspector':
      return <Inspector />;
    case 'files':
      return <FileBrowser />;
    case 'terminal':
      return <TerminalPanel />;
    case 'agent':
      return <AgentPanel />;
  }
}

function otherSide(side: DockSide): DockSide {
  return side === 'left' ? 'right' : 'left';
}

export function Dock({ side }: { side: DockSide }) {
  const panels = useLayoutStore((s) => s.panels);
  const setVisible = useLayoutStore((s) => s.setVisible);
  const setSide = useLayoutStore((s) => s.setSide);

  const ids = idsOnSide(panels, side);

  // Local, unpersisted split between two panels stacked on the same side.
  // LayoutState has no room for a second dimension per panel — see the
  // phase A2 report for why this is intentionally not part of the store.
  const [splitRatio, setSplitRatio] = useState(0.5);

  if (ids.length === 0) return null;

  const stacked = ids.length > 1;

  return (
    <div className={`dock dock-${side}`}>
      {ids.map((id, index) => (
        <div
          className="dock-slot"
          key={id}
          style={{ flex: `${stacked ? (index === 0 ? splitRatio : 1 - splitRatio) : 1} 1 0%` }}
        >
          <PanelFrame
            title={PANEL_TITLES[id]}
            onMoveSide={MOVABLE.has(id) ? () => setSide(id, otherSide(panels[id].side)) : undefined}
            onHide={() => setVisible(id, false)}
          >
            {renderPanelBody(id)}
          </PanelFrame>
          {stacked && index < ids.length - 1 && (
            <Resizer
              orientation="horizontal"
              ariaLabel={`Resize ${PANEL_TITLES[id]} / ${PANEL_TITLES[ids[index + 1]]}`}
              onResize={(deltaPx) => {
                const dockEl = document.querySelector(`.dock-${side}`);
                const total = dockEl instanceof HTMLElement ? dockEl.clientHeight : 1;
                if (total <= 0) return;
                setSplitRatio((r) => Math.min(0.8, Math.max(0.2, r + deltaPx / total)));
              }}
              onReset={() => setSplitRatio(0.5)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

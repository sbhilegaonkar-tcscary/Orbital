/**
 * Layout contract (docs/ARCHITECTURE.md "Layout (M6): docks and panels").
 * This file is authoritative for `PanelId`, `DockSide`, `PanelState`, and
 * `LayoutState` — other shell files read it, they do not redefine it.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PanelId = 'files' | 'inspector' | 'terminal' | 'agent';
export type DockSide = 'left' | 'right' | 'bottom';

export interface PanelState {
  visible: boolean;
  side: DockSide; // files/inspector/agent: left|right; terminal: bottom only
  size: number; // px; width for side docks, height for bottom
}

export interface LayoutState {
  panels: Record<PanelId, PanelState>;
  setVisible(id: PanelId, visible: boolean): void;
  toggle(id: PanelId): void;
  setSize(id: PanelId, px: number): void; // clamped to [min, 50% of viewport]
  setSide(id: PanelId, side: DockSide): void; // "move to other side"
  reset(): void;
}

export const PANEL_IDS: PanelId[] = ['files', 'inspector', 'terminal', 'agent'];

export const MIN_SIZE: Record<PanelId, number> = {
  files: 180,
  inspector: 220,
  terminal: 120,
  agent: 300,
};

const DEFAULT_PANELS: Record<PanelId, PanelState> = {
  files: { visible: false, side: 'left', size: 260 },
  inspector: { visible: true, side: 'right', size: 280 },
  terminal: { visible: false, side: 'bottom', size: 240 },
  agent: { visible: false, side: 'right', size: 380 },
};

/** Default size per panel, e.g. what a resizer's double-click reset returns to. */
export const DEFAULT_SIZE: Record<PanelId, number> = {
  files: DEFAULT_PANELS.files.size,
  inspector: DEFAULT_PANELS.inspector.size,
  terminal: DEFAULT_PANELS.terminal.size,
  agent: DEFAULT_PANELS.agent.size,
};

/** Visible panel ids currently assigned to `side`, in a stable order. */
export function idsOnSide(panels: Record<PanelId, PanelState>, side: DockSide): PanelId[] {
  return PANEL_IDS.filter((id) => panels[id].side === side && panels[id].visible);
}

/** Side docks clamp against viewport width, the bottom dock against height. */
function viewportDimension(id: PanelId): number {
  if (typeof window === 'undefined') return Number.POSITIVE_INFINITY;
  return id === 'terminal' ? window.innerHeight : window.innerWidth;
}

function clampSize(id: PanelId, px: number): number {
  const min = MIN_SIZE[id];
  const max = Math.max(min, Math.round(viewportDimension(id) * 0.5));
  return Math.min(Math.max(Math.round(px), min), max);
}

/**
 * The size to render right now. `size` in the store is the user's preferred
 * size and is never rewritten by viewport changes; a small window only
 * shrinks what is drawn. Persisting a clamped value would make a briefly
 * narrow window permanently shrink every panel.
 */
export function effectiveSize(id: PanelId, size: number): number {
  return clampSize(id, size);
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set, get) => ({
      panels: { ...DEFAULT_PANELS },
      setVisible: (id, visible) =>
        set((s) => ({ panels: { ...s.panels, [id]: { ...s.panels[id], visible } } })),
      toggle: (id) => {
        const visible = !get().panels[id].visible;
        set((s) => ({ panels: { ...s.panels, [id]: { ...s.panels[id], visible } } }));
      },
      setSize: (id, px) =>
        set((s) => ({ panels: { ...s.panels, [id]: { ...s.panels[id], size: clampSize(id, px) } } })),
      setSide: (id, side) =>
        set((s) => ({ panels: { ...s.panels, [id]: { ...s.panels[id], side } } })),
      reset: () => set({ panels: { ...DEFAULT_PANELS } }),
    }),
    {
      name: 'orbital.layout',
      merge: (persisted, current) => {
        const incoming = (persisted as Partial<LayoutState> | undefined)?.panels;
        const panels = { ...current.panels };
        for (const id of PANEL_IDS) {
          const p = incoming?.[id];
          if (p) panels[id] = { ...panels[id], ...p, size: Math.max(MIN_SIZE[id], Math.round(p.size)) };
        }
        return { ...current, panels };
      },
    },
  ),
);

/** Re-render on viewport changes so `effectiveSize` is recomputed; state is untouched. */
export function useViewportTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onResize = () => setTick((t) => t + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return tick;
}

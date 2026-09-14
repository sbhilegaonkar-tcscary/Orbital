/**
 * Which rail item is active. Moved out of `App.tsx` (previously
 * `useUiStore`/`ViewId` lived there and `Rail.tsx`/`shell/commands.ts`
 * imported it back) to break a module-init circular import: App.tsx ->
 * AppShell.tsx -> Rail.tsx -> App.tsx, and separately App.tsx -> AppShell.tsx
 * -> notebook/commands.ts -> shell/commands.ts -> App.tsx. Both cycles left
 * `useUiStore`/`useCommandStore` accessed before their `create(...)` had run
 * in some load orders ("Cannot access '...' before initialization").
 * `shell/` has no reason to reach back into `App.tsx` for this, so it lives
 * here instead; `App.tsx` re-exports nothing — every importer points here.
 */
import { create } from 'zustand';

export type ViewId = 'map' | 'notebook' | 'crew' | 'comms' | 'settings';

interface UiState {
  view: ViewId;
  setView(view: ViewId): void;
}

export const useUiStore = create<UiState>((set) => ({
  view: 'notebook',
  setView: (view) => set({ view }),
}));

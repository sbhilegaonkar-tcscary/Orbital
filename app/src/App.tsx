import type { ComponentType } from 'react';
import { create } from 'zustand';
import { AppShell } from './shell/AppShell';
import { NotebookView } from './views/NotebookView';
import { MapView } from './views/MapView';
import { CrewView } from './views/CrewView';
import { CommsView } from './views/CommsView';
import { SettingsView } from './views/SettingsView';

export type ViewId = 'map' | 'notebook' | 'crew' | 'comms' | 'settings';

interface UiState {
  view: ViewId;
  setView(view: ViewId): void;
}

/** Which rail item is active. Owned here; the shell and views both read it. */
export const useUiStore = create<UiState>((set) => ({
  view: 'notebook',
  setView: (view) => set({ view }),
}));

const VIEWS: Record<ViewId, ComponentType> = {
  map: MapView,
  notebook: NotebookView,
  crew: CrewView,
  comms: CommsView,
  settings: SettingsView,
};

export default function App() {
  const view = useUiStore((s) => s.view);
  const ActiveView = VIEWS[view];

  return (
    <AppShell>
      <ActiveView />
    </AppShell>
  );
}

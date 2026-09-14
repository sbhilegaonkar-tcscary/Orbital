import type { ComponentType } from 'react';
import { AppShell } from './shell/AppShell';
import { NotebookView } from './views/NotebookView';
import { MapView } from './views/MapView';
import { CrewView } from './views/CrewView';
import { CommsView } from './views/CommsView';
import { SettingsView } from './views/SettingsView';
import { useUiStore, type ViewId } from './shell/uiStore';

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

import { useEffect, type ComponentType } from 'react';
import { AppShell } from './shell/AppShell';
import { HomeView } from './views/HomeView';
import { NotebookView } from './views/NotebookView';
import { MapView } from './views/MapView';
import { CrewView } from './views/CrewView';
import { CommsView } from './views/CommsView';
import { SettingsView } from './views/SettingsView';
import { useUiStore, type ViewId } from './shell/uiStore';
import { useTabsStore } from './shell/tabs';

const VIEWS: Record<ViewId, ComponentType> = {
  home: HomeView,
  map: MapView,
  notebook: NotebookView,
  crew: CrewView,
  comms: CommsView,
  settings: SettingsView,
};

export default function App() {
  const view = useUiStore((s) => s.view);
  const ActiveView = VIEWS[view];

  // Decides the landing view once, for a fresh load: straight to the
  // notebook if a tab is already open, otherwise the Home start page.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const hasTabs = useTabsStore.getState().tabs.length > 0;
    useUiStore.getState().setView(hasTabs ? 'notebook' : 'home');
  }, []);

  return (
    <AppShell>
      <ActiveView />
    </AppShell>
  );
}

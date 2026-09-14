import { useActiveNotebook } from '../notebook/store';
import { useUiStore } from './uiStore';
import { useLayoutStore } from './layout';
import { ModeMenu } from './ModeMenu';
import { LayoutMenu } from './LayoutMenu';
import { ServiceDots } from './ServiceDots';

export function TopBar() {
  const notebookPath = useActiveNotebook()?.path;
  const setView = useUiStore((s) => s.setView);
  const setVisible = useLayoutStore((s) => s.setVisible);

  return (
    <header className="topbar">
      <button
        type="button"
        className="topbar-logo"
        title="Home"
        onClick={() => {
          setView('home');
          setVisible('files', true);
        }}
      >
        ORBITAL
      </button>
      <span className="topbar-project">{notebookPath ?? 'no notebook'}</span>
      <ModeMenu />
      <LayoutMenu />
      <ServiceDots />
    </header>
  );
}

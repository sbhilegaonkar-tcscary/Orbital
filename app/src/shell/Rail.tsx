import type { ComponentType } from 'react';
import { useUiStore, type ViewId } from '../App';

function MapIcon() {
  return (
    <svg viewBox="0 0 16 16">
      <path d="M1.5 3.5 6 2l4 1.5L14.5 2v10.5L10 14l-4-1.5L1.5 14z" />
      <path d="M6 2v10.5M10 3.5V14" />
    </svg>
  );
}

function NotebookIcon() {
  return (
    <svg viewBox="0 0 16 16">
      <rect x="3" y="1.5" width="10" height="13" rx="1" />
      <path d="M5.5 5h5M5.5 8h5M5.5 11h3" />
    </svg>
  );
}

function CrewIcon() {
  return (
    <svg viewBox="0 0 16 16">
      <circle cx="6" cy="5.5" r="2.5" />
      <circle cx="11.5" cy="6.5" r="2" />
      <path d="M1.5 14c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M10.5 10.5c2 0 4 1 4 3.5" />
    </svg>
  );
}

function CommsIcon() {
  return (
    <svg viewBox="0 0 16 16">
      <path d="M2 3h12v8H7l-3.5 3v-3H2z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </svg>
  );
}

const RAIL_ITEMS: { id: ViewId; label: string; Icon: ComponentType }[] = [
  { id: 'map', label: 'Map', Icon: MapIcon },
  { id: 'notebook', label: 'Notebook', Icon: NotebookIcon },
  { id: 'crew', label: 'Crew', Icon: CrewIcon },
  { id: 'comms', label: 'Comms', Icon: CommsIcon },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
];

export function Rail() {
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);

  return (
    <nav className="rail">
      {RAIL_ITEMS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className={`rail-item${view === id ? ' active' : ''}`}
          onClick={() => setView(id)}
        >
          <Icon />
          <span className="rail-item-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}

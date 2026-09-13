import { create } from 'zustand';
import { MODES } from '../theme/tokens';
import { useThemeStore } from '../theme/ThemeProvider';
import { useUiStore } from '../App';
import type { ViewId } from '../App';

type Motion = 'system' | 'reduced' | 'full';

export interface Command {
  id: string;
  title: string;
  category: string;
  shortcut?: string;
  run(): void;
  when?(): boolean;
}

interface CommandStoreState {
  commands: Record<string, Command>;
  register(command: Command): void;
  unregister(id: string): void;
}

/** Registry backing store. Subscribe to `commands` so the palette re-renders. */
export const useCommandStore = create<CommandStoreState>((set) => ({
  commands: {},
  register: (command) => set((s) => ({ commands: { ...s.commands, [command.id]: command } })),
  unregister: (id) =>
    set((s) => {
      if (!(id in s.commands)) return s;
      const next = { ...s.commands };
      delete next[id];
      return { commands: next };
    }),
}));

export function registerCommand(command: Command): void {
  useCommandStore.getState().register(command);
}

export function unregisterCommand(id: string): void {
  useCommandStore.getState().unregister(id);
}

/** Commands currently applicable, i.e. `when()` absent or true. */
export function listCommands(): Command[] {
  return Object.values(useCommandStore.getState().commands).filter((c) => !c.when || c.when());
}

export function runCommand(id: string): void {
  useCommandStore.getState().commands[id]?.run();
}

// ---- built-in theme and navigation commands --------------------------------

for (const { id, label } of MODES) {
  registerCommand({
    id: `mode.switch.${id}`,
    title: `Switch mode: ${label}`,
    category: 'Theme',
    run: () => useThemeStore.getState().setMode(id),
  });
}

const MOTION_OPTIONS: { id: Motion; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'reduced', label: 'Reduced' },
  { id: 'full', label: 'Full' },
];

for (const { id, label } of MOTION_OPTIONS) {
  registerCommand({
    id: `motion.${id}`,
    title: `Motion: ${label}`,
    category: 'Theme',
    run: () => useThemeStore.getState().setMotion(id),
  });
}

const VIEW_OPTIONS: { id: ViewId; label: string }[] = [
  { id: 'map', label: 'Map' },
  { id: 'notebook', label: 'Notebook' },
  { id: 'crew', label: 'Crew' },
  { id: 'comms', label: 'Comms' },
  { id: 'settings', label: 'Settings' },
];

for (const { id, label } of VIEW_OPTIONS) {
  registerCommand({
    id: `goto.${id}`,
    title: `Go to: ${label}`,
    category: 'Navigation',
    run: () => useUiStore.getState().setView(id),
  });
}

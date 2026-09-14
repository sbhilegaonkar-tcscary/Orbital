import { create } from 'zustand';
import { MODES } from '../theme/tokens';
import { useThemeStore } from '../theme/ThemeProvider';
import { useUiStore, type ViewId } from './uiStore';
import { useLayoutStore, type DockSide } from './layout';
import { getRuntime, useTerminalStore } from '../terminal/store';
import { useTabsStore } from './tabs';
import { useFilesStore, saveActiveFile } from '../files/store';
import { useAgentStore } from '../agent/store';

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
  { id: 'home', label: 'Home' },
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

// ---- built-in layout commands (docs/KEYBOARD.md "Global") ------------------

function otherSide(side: DockSide): DockSide {
  return side === 'left' ? 'right' : 'left';
}

registerCommand({
  id: 'layout.toggle.files',
  title: 'Toggle file browser',
  category: 'Layout',
  shortcut: 'Ctrl+B',
  run: () => useLayoutStore.getState().toggle('files'),
});

registerCommand({
  id: 'layout.toggle.terminal',
  title: 'Toggle terminal',
  category: 'Layout',
  shortcut: 'Ctrl+`',
  run: () => useLayoutStore.getState().toggle('terminal'),
});

registerCommand({
  id: 'layout.toggle.inspector',
  title: 'Toggle inspector',
  category: 'Layout',
  shortcut: 'Ctrl+Shift+I',
  run: () => useLayoutStore.getState().toggle('inspector'),
});

registerCommand({
  id: 'layout.move.inspector',
  title: 'Move inspector to other side',
  category: 'Layout',
  run: () => {
    const { panels, setSide } = useLayoutStore.getState();
    setSide('inspector', otherSide(panels.inspector.side));
  },
});

registerCommand({
  id: 'layout.move.files',
  title: 'Move file browser to other side',
  category: 'Layout',
  run: () => {
    const { panels, setSide } = useLayoutStore.getState();
    setSide('files', otherSide(panels.files.side));
  },
});

registerCommand({
  id: 'layout.reset',
  title: 'Reset layout',
  category: 'Layout',
  run: () => useLayoutStore.getState().reset(),
});

registerCommand({
  id: 'layout.toggle.agent',
  title: 'Toggle agent panel',
  category: 'Layout',
  shortcut: 'Ctrl+Shift+L',
  run: () => useLayoutStore.getState().toggle('agent'),
});

// ---- built-in agent commands (M7-B) -----------------------------------

registerCommand({
  id: 'agent.askAboutSelectedCell',
  title: 'Ask agent about selected cell',
  category: 'Agent',
  run: () => {
    useLayoutStore.getState().setVisible('agent', true);
    useAgentStore.getState().setInclude('cell', true);
  },
});

registerCommand({
  id: 'agent.clearConversation',
  title: 'Clear agent conversation',
  category: 'Agent',
  run: () => useAgentStore.getState().clearConversation(),
});

// ---- built-in terminal commands --------------------------------------------

async function runSelectionInTerminal(): Promise<void> {
  const selection = document.getSelection()?.toString() ?? '';
  if (!selection) return;

  useLayoutStore.getState().setVisible('terminal', true);
  const { terminals, active, create } = useTerminalStore.getState();
  let name = active;
  if (!name || !terminals.some((t) => t.name === name)) {
    await create();
    name = useTerminalStore.getState().active;
  }
  getRuntime(name ?? '')?.conn.send(`${selection}\r`);
}

registerCommand({
  id: 'terminal.new',
  title: 'New terminal',
  category: 'Terminal',
  run: () => {
    useLayoutStore.getState().setVisible('terminal', true);
    void useTerminalStore.getState().create();
  },
});

registerCommand({
  id: 'terminal.close',
  title: 'Close terminal',
  category: 'Terminal',
  when: () => useTerminalStore.getState().active !== null,
  run: () => {
    const { active, close } = useTerminalStore.getState();
    if (active) void close(active);
  },
});

registerCommand({
  id: 'terminal.next',
  title: 'Next terminal',
  category: 'Terminal',
  when: () => useTerminalStore.getState().terminals.length > 1,
  run: () => {
    const { terminals, active, activate } = useTerminalStore.getState();
    if (terminals.length === 0) return;
    const index = terminals.findIndex((t) => t.name === active);
    const next = terminals[(index + 1) % terminals.length];
    activate(next.name);
  },
});

registerCommand({
  id: 'terminal.clear',
  title: 'Clear terminal',
  category: 'Terminal',
  when: () => useTerminalStore.getState().active !== null,
  run: () => {
    const { active } = useTerminalStore.getState();
    if (!active) return;
    getRuntime(active)?.term?.clear();
  },
});

registerCommand({
  id: 'terminal.runSelection',
  title: 'Run selection in terminal',
  category: 'Terminal',
  run: () => void runSelectionInTerminal(),
});

// ---- built-in file-browser commands (M6 phase B1) --------------------------
//
// The palette has no notion of "the folder selected in the tree", so unlike
// `FileBrowser.tsx`'s own header buttons (which target a selection-derived
// directory) these always act at the workspace root or on `files/store.ts`'s
// `selected` path — the same simplification `notebook.newNotebook` already
// makes for notebooks.

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

registerCommand({
  id: 'files.newFile',
  title: 'New file',
  category: 'Files',
  run: () => {
    const name = window.prompt('New file name', 'untitled.txt');
    if (!name) return;
    useLayoutStore.getState().setVisible('files', true);
    void useFilesStore.getState().createFileIn('', name);
  },
});

registerCommand({
  id: 'files.newFolder',
  title: 'New folder',
  category: 'Files',
  run: () => {
    const name = window.prompt('New folder name', 'New Folder');
    if (!name) return;
    useLayoutStore.getState().setVisible('files', true);
    void useFilesStore.getState().createFolderIn('', name);
  },
});

registerCommand({
  id: 'files.upload',
  title: 'Upload files',
  category: 'Files',
  run: () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.addEventListener('change', () => {
      if (input.files && input.files.length > 0) void useFilesStore.getState().upload('', input.files);
    });
    input.click();
  },
});

registerCommand({
  id: 'files.refresh',
  title: 'Refresh files',
  category: 'Files',
  run: () => void useFilesStore.getState().refresh(),
});

registerCommand({
  id: 'files.renameSelected',
  title: 'Rename selected',
  category: 'Files',
  when: () => useFilesStore.getState().selected !== null,
  run: () => {
    const path = useFilesStore.getState().selected;
    if (!path) return;
    const name = window.prompt('Rename to', basename(path));
    if (!name || name === basename(path)) return;
    void useFilesStore.getState().rename(path, name);
  },
});

registerCommand({
  id: 'files.deleteSelected',
  title: 'Delete selected',
  category: 'Files',
  when: () => useFilesStore.getState().selected !== null,
  run: () => {
    const path = useFilesStore.getState().selected;
    if (!path) return;
    if (!window.confirm(`Delete "${path}"? This cannot be undone.`)) return;
    void useFilesStore.getState().remove(path);
  },
});

registerCommand({
  id: 'files.revealActive',
  title: 'Reveal active file in browser',
  category: 'Files',
  when: () => useTabsStore.getState().activeTab !== null,
  run: () => {
    const active = useTabsStore.getState().activeTab;
    if (!active) return;
    useLayoutStore.getState().setVisible('files', true);
    const parts = active.path.split('/');
    let dir = '';
    for (let i = 0; i < parts.length - 1; i += 1) {
      dir = dir ? `${dir}/${parts[i]}` : parts[i];
      if (!useFilesStore.getState().expanded.includes(dir)) useFilesStore.getState().toggleDir(dir);
    }
    useFilesStore.getState().select(active.path);
  },
});

registerCommand({
  id: 'files.saveActive',
  title: 'Save active file',
  category: 'Files',
  when: () => useTabsStore.getState().activeTab?.kind === 'file',
  run: () => saveActiveFile(),
});

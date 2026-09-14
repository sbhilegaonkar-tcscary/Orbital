/**
 * The typed shortcut table for `ShortcutsHelp`'s overlay. Must match
 * docs/KEYBOARD.md exactly — that file is the contract; this is its
 * in-app rendering.
 *
 * Also owns the overlay's open/closed state: `?`/`H` in command mode
 * (Notebook.tsx) and the "Keyboard shortcuts" command (notebook/commands.ts)
 * both call `openShortcutsHelp()`; `ShortcutsHelp` itself calls
 * `closeShortcutsHelp()` on Esc / outside click.
 */
import { useSyncExternalStore } from 'react';

export type ShortcutContext = 'edit' | 'command' | 'global';

export interface ShortcutEntry {
  keys: string;
  action: string;
  context: ShortcutContext;
}

export const SHORTCUTS: ShortcutEntry[] = [
  // Running — both modes (docs/KEYBOARD.md "Running")
  { keys: 'Shift+Enter', action: 'Run cell, move to the next cell in edit mode (creates one if last)', context: 'command' },
  { keys: 'Ctrl+Enter', action: 'Run cell, stay in place and in the same mode', context: 'command' },
  { keys: 'Alt+Enter', action: 'Run cell, insert a new code cell below, edit it', context: 'command' },
  { keys: 'Ctrl+Shift+A', action: 'Run all cells above', context: 'command' },
  { keys: 'Ctrl+Shift+B', action: 'Run this cell and all below', context: 'command' },

  // Edit mode only
  { keys: 'Esc', action: 'Leave edit mode (or close a completion/inspect popup first)', context: 'edit' },
  { keys: 'Tab', action: 'Indent, or open completions', context: 'edit' },
  { keys: 'Shift+Tab', action: 'Inspect the symbol at the cursor', context: 'edit' },
  { keys: 'Ctrl+Space', action: 'Open completions explicitly', context: 'edit' },
  { keys: 'Ctrl+F', action: 'Find in this cell', context: 'edit' },
  { keys: 'Ctrl+Z / Ctrl+Y', action: 'Undo / redo text', context: 'edit' },
  { keys: 'Ctrl+Shift+-', action: 'Split the cell at the cursor', context: 'edit' },
  { keys: 'Ctrl+/', action: 'Toggle comment on the selected lines', context: 'edit' },

  // Command mode only
  { keys: 'Enter', action: 'Edit mode on the selected cell', context: 'command' },
  { keys: '↑ / ↓ or K / J', action: 'Select previous / next cell', context: 'command' },
  { keys: 'A / B', action: 'Insert code cell above / below', context: 'command' },
  { keys: 'D D', action: 'Delete the selected cell (two presses within 500ms)', context: 'command' },
  { keys: 'Z', action: 'Undo the last delete', context: 'command' },
  { keys: 'X / C / V', action: 'Cut / copy / paste below', context: 'command' },
  { keys: 'M / Y', action: 'Change to markdown / code', context: 'command' },
  { keys: 'Shift+M', action: 'Merge with the cell below', context: 'command' },
  { keys: 'O', action: 'Toggle output collapse', context: 'command' },
  { keys: 'Shift+O', action: 'Toggle output collapse for all cells', context: 'command' },
  { keys: 'L', action: 'Toggle line numbers in this cell', context: 'command' },
  { keys: '? or H', action: 'Keyboard help overlay', context: 'command' },

  // Global — notebook-related subset (Ctrl+B / Ctrl+` / Ctrl+Shift+I belong
  // to the layout, owned elsewhere)
  { keys: 'Ctrl+S', action: 'Save the active notebook', context: 'global' },
  { keys: 'Ctrl+K or Ctrl+Shift+P', action: 'Command palette', context: 'global' },
  { keys: 'Ctrl+W', action: 'Close the active tab (confirms if dirty)', context: 'global' },
  { keys: 'Ctrl+Tab / Ctrl+Shift+Tab', action: 'Next / previous tab', context: 'global' },
  { keys: 'Ctrl+Shift+L', action: 'Toggle the agent panel', context: 'global' },
];

let helpOpen = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

export function openShortcutsHelp(): void {
  if (helpOpen) return;
  helpOpen = true;
  notify();
}

export function closeShortcutsHelp(): void {
  if (!helpOpen) return;
  helpOpen = false;
  notify();
}

export function useShortcutsHelpOpen(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => helpOpen,
  );
}

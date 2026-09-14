/**
 * Registers notebook actions in the command palette (`shell/commands.ts`).
 * Imported once, for its side effects, by `shell/AppShell.tsx`.
 *
 * "Change kernel to …" is one command per `kernelSpecs` entry, kept in sync
 * as the store's spec list changes (populated by `NotebookToolbar`'s mount
 * effect, or by `refreshKernelSpecs()` from anywhere else).
 *
 * This module also installs, once, the two module-init side effects that
 * must exist independent of any single component being mounted:
 *  - the "Global" table of docs/KEYBOARD.md that is notebook-related
 *    (Ctrl+S / Ctrl+W / Ctrl+Tab / Ctrl+Shift+Tab), as a single `document`
 *    keydown listener so these work no matter where focus is in the app;
 *  - autosave (`./autosave`).
 */
import { registerCommand, unregisterCommand, useCommandStore } from '../shell/commands';
import { useNotebookStore } from './store';
import { useSessionStore } from '../session/store';
import type { KernelSpecInfo } from '../session/types';
import { installAutosave } from './autosave';
import { openShortcutsHelp } from '../shell/shortcuts';
import { useTabsStore } from '../shell/tabs';
import { saveActiveFile, useFilesStore } from '../files/store';

const CATEGORY = 'Notebook';

function hasActiveDoc(): boolean {
  return useNotebookStore.getState().activePath !== null;
}

function selectedCellId(): string | null {
  return useNotebookStore.getState().selectedCellId;
}

registerCommand({
  id: 'notebook.runSelected',
  title: 'Run selected cell',
  category: CATEGORY,
  when: hasActiveDoc,
  run: () => {
    const id = selectedCellId();
    if (id) void useNotebookStore.getState().runCell(id);
  },
});

registerCommand({
  id: 'notebook.runAll',
  title: 'Run all',
  category: CATEGORY,
  when: hasActiveDoc,
  run: () => void useNotebookStore.getState().runAll(),
});

registerCommand({
  id: 'notebook.runAbove',
  title: 'Run above',
  category: CATEGORY,
  when: hasActiveDoc,
  run: () => {
    const id = selectedCellId();
    if (id) void useNotebookStore.getState().runAbove(id);
  },
});

registerCommand({
  id: 'notebook.runBelow',
  title: 'Run below',
  category: CATEGORY,
  when: hasActiveDoc,
  run: () => {
    const id = selectedCellId();
    if (id) void useNotebookStore.getState().runBelow(id);
  },
});

registerCommand({
  id: 'notebook.interrupt',
  title: 'Interrupt',
  category: CATEGORY,
  when: hasActiveDoc,
  run: () => void useNotebookStore.getState().interrupt(),
});

registerCommand({
  id: 'notebook.restartKernel',
  title: 'Restart kernel',
  category: CATEGORY,
  when: hasActiveDoc,
  run: () => void useNotebookStore.getState().restartKernel(),
});

registerCommand({
  id: 'notebook.restartAndRunAll',
  title: 'Restart and run all',
  category: CATEGORY,
  when: hasActiveDoc,
  run: () => void useNotebookStore.getState().restartAndRunAll(),
});

registerCommand({
  id: 'notebook.clearAllOutputs',
  title: 'Clear all outputs',
  category: CATEGORY,
  when: hasActiveDoc,
  run: () => useNotebookStore.getState().clearOutputs(),
});

/**
 * Files agent (M6 phase B1): the global Ctrl+S dispatcher above resolves to
 * this one command id regardless of tab kind, so `run` (and, since the
 * dispatcher gates on `when`, `when` too) has to branch on the active tab —
 * `files/store.ts`'s `saveActiveFile()` when it's a file, the notebook save
 * otherwise. `files.saveActive` (shell/commands.ts) covers the palette entry
 * for the file case on its own.
 */
registerCommand({
  id: 'notebook.save',
  title: 'Save',
  category: CATEGORY,
  shortcut: 'Ctrl+S',
  when: () => hasActiveDoc() || useTabsStore.getState().activeTab?.kind === 'file',
  run: () => {
    if (useTabsStore.getState().activeTab?.kind === 'file') {
      saveActiveFile();
      return;
    }
    void useNotebookStore.getState().save();
  },
});

registerCommand({
  id: 'notebook.saveAll',
  title: 'Save all',
  category: CATEGORY,
  when: hasActiveDoc,
  run: () => void useNotebookStore.getState().saveAll(),
});

/**
 * Ctrl+W's "confirms if dirty" (docs/KEYBOARD.md "Global") lives on the
 * command itself, not just the keyboard listener below, so the palette and
 * any future caller get the same safety.
 */
/**
 * Closes whichever tab is active, notebook or text file, through the unified
 * tabs store; the dirty check covers both kinds.
 */
function closeActiveWithConfirm(): void {
  const tab = useTabsStore.getState().activeTab;
  if (!tab) return;
  const isDirty =
    tab.kind === 'notebook'
      ? Boolean(useNotebookStore.getState().dirty[tab.path])
      : Boolean(useFilesStore.getState().files[tab.path]?.dirty);
  if (isDirty) {
    const proceed = window.confirm(`Close "${tab.path}"? Unsaved changes will be lost.`);
    if (!proceed) return;
  }
  useTabsStore.getState().closeTab(tab);
}

const hasActiveTab = (): boolean => useTabsStore.getState().activeTab !== null;
const hasSeveralTabs = (): boolean => useTabsStore.getState().tabs.length > 1;

registerCommand({
  id: 'notebook.closeNotebook',
  title: 'Close tab',
  category: CATEGORY,
  shortcut: 'Ctrl+W',
  when: hasActiveTab,
  run: closeActiveWithConfirm,
});

registerCommand({
  id: 'notebook.nextTab',
  title: 'Next tab',
  category: CATEGORY,
  shortcut: 'Ctrl+Tab',
  when: hasSeveralTabs,
  run: () => useTabsStore.getState().nextTab(),
});

registerCommand({
  id: 'notebook.prevTab',
  title: 'Previous tab',
  category: CATEGORY,
  shortcut: 'Ctrl+Shift+Tab',
  when: hasSeveralTabs,
  run: () => useTabsStore.getState().prevTab(),
});

registerCommand({
  id: 'notebook.shortcutsHelp',
  title: 'Keyboard shortcuts',
  category: CATEGORY,
  run: () => openShortcutsHelp(),
});

registerCommand({
  id: 'notebook.newNotebook',
  title: 'New notebook',
  category: CATEGORY,
  // Deliberately not gated on `hasActiveDoc`: this is how you get a first
  // document open. Only needs a connected provider.
  when: () => useSessionStore.getState().connection === 'connected',
  run: () => {
    const provider = useSessionStore.getState().provider;
    if (!provider) return;
    void provider.contents.createNotebook('').then((path) => useNotebookStore.getState().open(path));
  },
});

registerCommand({
  id: 'notebook.insertCodeBelow',
  title: 'Insert code cell below',
  category: CATEGORY,
  when: hasActiveDoc,
  run: () => {
    const id = useNotebookStore.getState().insertCell(selectedCellId(), 'code');
    useNotebookStore.getState().select(id);
  },
});

registerCommand({
  id: 'notebook.insertMarkdownBelow',
  title: 'Insert markdown cell below',
  category: CATEGORY,
  when: hasActiveDoc,
  run: () => {
    const id = useNotebookStore.getState().insertCell(selectedCellId(), 'markdown');
    useNotebookStore.getState().select(id);
  },
});

registerCommand({
  id: 'notebook.deleteCell',
  title: 'Delete cell',
  category: CATEGORY,
  when: hasActiveDoc,
  run: () => {
    const id = selectedCellId();
    if (id) useNotebookStore.getState().deleteCell(id);
  },
});

registerCommand({
  id: 'notebook.undoDelete',
  title: 'Undo delete',
  category: CATEGORY,
  when: hasActiveDoc,
  run: () => useNotebookStore.getState().undoDelete(),
});

registerCommand({
  id: 'notebook.cut',
  title: 'Cut',
  category: CATEGORY,
  when: hasActiveDoc,
  run: () => {
    const id = selectedCellId();
    if (id) useNotebookStore.getState().cutCells([id]);
  },
});

registerCommand({
  id: 'notebook.copy',
  title: 'Copy',
  category: CATEGORY,
  when: hasActiveDoc,
  run: () => {
    const id = selectedCellId();
    if (id) useNotebookStore.getState().copyCells([id]);
  },
});

registerCommand({
  id: 'notebook.paste',
  title: 'Paste',
  category: CATEGORY,
  when: hasActiveDoc,
  run: () => useNotebookStore.getState().pasteCells(selectedCellId()),
});

registerCommand({
  id: 'notebook.mergeWithBelow',
  title: 'Merge with below',
  category: CATEGORY,
  when: hasActiveDoc,
  run: () => {
    const id = selectedCellId();
    if (id) useNotebookStore.getState().mergeWithBelow(id);
  },
});

registerCommand({
  id: 'notebook.toggleOutputCollapse',
  title: 'Toggle output collapse',
  category: CATEGORY,
  when: hasActiveDoc,
  run: () => {
    const id = selectedCellId();
    if (id) useNotebookStore.getState().toggleCollapse(id);
  },
});

// ---- dynamic "Change kernel to …" commands, one per kernel spec ----------

let kernelCommandIds: string[] = [];

function syncKernelCommands(specs: KernelSpecInfo[]): void {
  for (const id of kernelCommandIds) unregisterCommand(id);
  kernelCommandIds = specs.map((spec) => {
    const id = `notebook.changeKernel.${spec.name}`;
    registerCommand({
      id,
      title: `Change kernel to ${spec.displayName}`,
      category: CATEGORY,
      when: hasActiveDoc,
      run: () => void useNotebookStore.getState().changeKernel(spec.name),
    });
    return id;
  });
}

syncKernelCommands(useNotebookStore.getState().kernelSpecs);
useNotebookStore.subscribe((state, prev) => {
  if (state.kernelSpecs !== prev.kernelSpecs) syncKernelCommands(state.kernelSpecs);
});

// ---- global shortcuts (docs/KEYBOARD.md "Global", notebook-related subset) ----
//
// These must fire no matter where focus is in the app, so — unlike every
// other shortcut in this codebase — they are not scoped to one component's
// onKeyDown. Ctrl+B / Ctrl+` / Ctrl+Shift+I are layout toggles owned by
// another agent and are deliberately not bound here.

const GLOBAL_SHORTCUTS: Record<string, string> = {
  'Ctrl+S': 'notebook.save',
  'Ctrl+W': 'notebook.closeNotebook',
  'Ctrl+Tab': 'notebook.nextTab',
  'Ctrl+Shift+Tab': 'notebook.prevTab',
};

/** These are allowed to fire even while a CodeMirror editor has focus. */
const ALLOWED_IN_CM_EDITOR = new Set(Object.keys(GLOBAL_SHORTCUTS));

function shortcutStringFor(e: KeyboardEvent): string | null {
  // Tab/Enter etc. arrive as their own `key`; a bare modifier keydown (e.g.
  // just pressing Ctrl) has no useful shortcut of its own.
  if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  parts.push(key);
  return parts.join('+');
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  return target.isContentEditable;
}

function shouldSkipGlobalShortcut(target: EventTarget | null, shortcut: string): boolean {
  const inCmEditor = target instanceof HTMLElement && !!target.closest('.cm-editor');
  if (inCmEditor) return !ALLOWED_IN_CM_EDITOR.has(shortcut);
  return isTypingTarget(target);
}

function installGlobalShortcuts(): void {
  document.addEventListener('keydown', (e) => {
    const shortcut = shortcutStringFor(e);
    if (!shortcut) return;
    const commandId = GLOBAL_SHORTCUTS[shortcut];
    if (!commandId) return;
    if (shouldSkipGlobalShortcut(e.target, shortcut)) return;

    const command = useCommandStore.getState().commands[commandId];
    if (!command || (command.when && !command.when())) return;
    e.preventDefault();
    command.run();
  });
}

installGlobalShortcuts();
installAutosave();

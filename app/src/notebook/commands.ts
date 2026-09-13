/**
 * Registers notebook actions in the command palette (`shell/commands.ts`).
 * Imported once, for its side effects, by `shell/AppShell.tsx`.
 *
 * "Change kernel to …" is one command per `kernelSpecs` entry, kept in sync
 * as the store's spec list changes (populated by `NotebookToolbar`'s mount
 * effect, or by `refreshKernelSpecs()` from anywhere else).
 */
import { registerCommand, unregisterCommand } from '../shell/commands';
import { useNotebookStore } from './store';
import { useSessionStore } from '../session/store';
import type { KernelSpecInfo } from '../session/types';

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

registerCommand({
  id: 'notebook.save',
  title: 'Save',
  category: CATEGORY,
  when: hasActiveDoc,
  run: () => void useNotebookStore.getState().save(),
});

registerCommand({
  id: 'notebook.saveAll',
  title: 'Save all',
  category: CATEGORY,
  when: hasActiveDoc,
  run: () => void useNotebookStore.getState().saveAll(),
});

registerCommand({
  id: 'notebook.closeNotebook',
  title: 'Close notebook',
  category: CATEGORY,
  when: hasActiveDoc,
  run: () => void useNotebookStore.getState().close(),
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

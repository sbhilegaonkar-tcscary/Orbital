/**
 * Notebook-level action bar: cell editing (insert/cut/copy/paste/move),
 * execution (run/run all/interrupt/restart/restart+run all/clear outputs),
 * save, and a kernel picker on the right. Icon-only buttons with `title`
 * tooltips; disabled when there is no active document or no kernel.
 */
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useNotebookStore, useActiveNotebook } from './store';
import { useSessionStore } from '../session/store';

function IconButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="nb-icon-btn"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function IconPlus() {
  return (
    <svg viewBox="0 0 16 16">
      <path d="M8 2v12M2 8h12" />
    </svg>
  );
}

export function IconCut() {
  return (
    <svg viewBox="0 0 16 16">
      <circle cx="4" cy="4" r="1.8" />
      <circle cx="4" cy="12" r="1.8" />
      <path d="M5.4 5.2 13 12M13 4 5.4 10.8" />
    </svg>
  );
}

export function IconCopy() {
  return (
    <svg viewBox="0 0 16 16">
      <rect x="5.5" y="5.5" width="8" height="8.5" rx="1" />
      <path d="M3 10.5V2.5A1 1 0 0 1 4 1.5h6" />
    </svg>
  );
}

export function IconPaste() {
  return (
    <svg viewBox="0 0 16 16">
      <rect x="3" y="2.5" width="10" height="12" rx="1" />
      <path d="M6 2v-.5A1 1 0 0 1 7 .5h2a1 1 0 0 1 1 1V2M5.5 8h5M5.5 11h5" />
    </svg>
  );
}

export function IconMoveUp() {
  return (
    <svg viewBox="0 0 16 16">
      <path d="M8 12.5v-9M4 7l4-4 4 4" />
    </svg>
  );
}

export function IconMoveDown() {
  return (
    <svg viewBox="0 0 16 16">
      <path d="M8 3.5v9M4 9l4 4 4-4" />
    </svg>
  );
}

export function IconRun() {
  return (
    <svg viewBox="0 0 16 16">
      <path d="M4 2.5v11l9-5.5z" />
    </svg>
  );
}

export function IconRunAll() {
  return (
    <svg viewBox="0 0 16 16">
      <path d="M2.5 2.5v11l7-5.5z" />
      <path d="M11.5 2.5v11" />
    </svg>
  );
}

export function IconStop() {
  return (
    <svg viewBox="0 0 16 16">
      <rect x="3.5" y="3.5" width="9" height="9" rx="1" />
    </svg>
  );
}

export function IconRestart() {
  return (
    <svg viewBox="0 0 16 16">
      <path d="M12.5 6.5A4.8 4.8 0 1 0 13 9" />
      <path d="M12.5 2.5v4h-4" />
    </svg>
  );
}

export function IconRestartRunAll() {
  return (
    <svg viewBox="0 0 16 16">
      <path d="M11.7 5.6A4.8 4.8 0 1 0 12.2 9" />
      <path d="M11.7 2v3.6h-3.6" />
      <path d="M6 7.3v3.4l3-1.7z" />
    </svg>
  );
}

export function IconClear() {
  return (
    <svg viewBox="0 0 16 16">
      <rect x="3" y="4.5" width="10" height="8" rx="1" />
      <path d="M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M6.5 7.5v3M9.5 7.5v3" />
    </svg>
  );
}

export function IconSave() {
  return (
    <svg viewBox="0 0 16 16">
      <path d="M3 2.5h8L13 5v8.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z" />
      <path d="M5.5 2.5V6h5V2.5M5 10h6" />
    </svg>
  );
}

const KERNEL_ALIVE: ReadonlySet<string> = new Set(['connecting', 'starting', 'idle', 'busy', 'restarting']);

export function NotebookToolbar() {
  const notebook = useActiveNotebook();
  const activePath = notebook?.path ?? null;
  const dirty = useNotebookStore((s) => (activePath ? (s.dirty[activePath] ?? false) : false));
  const selectedCellId = useNotebookStore((s) => s.selectedCellId);
  const clipboard = useNotebookStore((s) => s.clipboard);
  const kernelSpecs = useNotebookStore((s) => s.kernelSpecs);
  const connection = useSessionStore((s) => s.connection);
  const kernelName = useSessionStore((s) => s.kernelName);
  const kernelStatus = useSessionStore((s) => s.kernelStatus);

  useEffect(() => {
    if (connection === 'connected') void useNotebookStore.getState().refreshKernelSpecs();
  }, [connection]);

  const hasDoc = !!notebook;
  const hasCell = hasDoc && !!selectedCellId;
  const hasKernel = hasDoc && KERNEL_ALIVE.has(kernelStatus);

  function withSelected(action: (id: string) => void) {
    return () => {
      if (selectedCellId) action(selectedCellId);
    };
  }

  return (
    <div className="nb-toolbar" role="toolbar" aria-label="Notebook actions">
      <div className="nb-toolbar-group">
        <IconButton
          title="Insert code cell below"
          disabled={!hasDoc}
          onClick={() => {
            const id = useNotebookStore.getState().insertCell(selectedCellId, 'code');
            useNotebookStore.getState().select(id);
          }}
        >
          <IconPlus />
        </IconButton>
        <IconButton
          title="Cut selected cell"
          disabled={!hasCell}
          onClick={withSelected((id) => useNotebookStore.getState().cutCells([id]))}
        >
          <IconCut />
        </IconButton>
        <IconButton
          title="Copy selected cell"
          disabled={!hasCell}
          onClick={withSelected((id) => useNotebookStore.getState().copyCells([id]))}
        >
          <IconCopy />
        </IconButton>
        <IconButton
          title="Paste below"
          disabled={!hasDoc || !clipboard}
          onClick={() => useNotebookStore.getState().pasteCells(selectedCellId)}
        >
          <IconPaste />
        </IconButton>
        <IconButton
          title="Move cell up"
          disabled={!hasCell}
          onClick={withSelected((id) => useNotebookStore.getState().moveCell(id, -1))}
        >
          <IconMoveUp />
        </IconButton>
        <IconButton
          title="Move cell down"
          disabled={!hasCell}
          onClick={withSelected((id) => useNotebookStore.getState().moveCell(id, 1))}
        >
          <IconMoveDown />
        </IconButton>
      </div>

      <div className="nb-toolbar-group">
        <IconButton
          title="Run selected cell"
          disabled={!hasCell}
          onClick={withSelected((id) => void useNotebookStore.getState().runCell(id))}
        >
          <IconRun />
        </IconButton>
        <IconButton title="Run all cells" disabled={!hasDoc} onClick={() => void useNotebookStore.getState().runAll()}>
          <IconRunAll />
        </IconButton>
        <IconButton
          title="Interrupt kernel"
          disabled={!hasKernel}
          onClick={() => void useNotebookStore.getState().interrupt()}
        >
          <IconStop />
        </IconButton>
        <IconButton
          title="Restart kernel"
          disabled={!hasKernel}
          onClick={() => void useNotebookStore.getState().restartKernel()}
        >
          <IconRestart />
        </IconButton>
        <IconButton
          title="Restart kernel and run all"
          disabled={!hasKernel}
          onClick={() => void useNotebookStore.getState().restartAndRunAll()}
        >
          <IconRestartRunAll />
        </IconButton>
        <IconButton
          title="Clear all outputs"
          disabled={!hasDoc}
          onClick={() => useNotebookStore.getState().clearOutputs()}
        >
          <IconClear />
        </IconButton>
      </div>

      <div className="nb-toolbar-group">
        <IconButton title="Save notebook" disabled={!hasDoc} onClick={() => void useNotebookStore.getState().save()}>
          <IconSave />
          {dirty && <i className="dirty-dot" aria-label="unsaved changes" />}
        </IconButton>
      </div>

      <div className="nb-toolbar-spacer" />

      <label className="nb-kernel-picker">
        <span className="nb-kernel-picker-label">Kernel</span>
        <select
          disabled={!hasDoc || kernelSpecs.length === 0}
          value={kernelName ?? ''}
          onChange={(e) => void useNotebookStore.getState().changeKernel(e.target.value)}
        >
          {kernelName && !kernelSpecs.some((k) => k.name === kernelName) && (
            <option value={kernelName}>{kernelName}</option>
          )}
          {kernelSpecs.map((spec) => (
            <option key={spec.name} value={spec.name}>
              {spec.displayName}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

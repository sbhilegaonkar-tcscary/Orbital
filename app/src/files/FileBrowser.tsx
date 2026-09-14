/**
 * File tree panel (docs/ARCHITECTURE.md "Files (M6)"). Renders `files/store.ts`'s
 * `entries`/`expanded` as a flattened, indented list rooted at `''` (labelled
 * "workspace"). Notebooks open through `notebook/store.ts`; everything else
 * text-shaped opens through `files/store.ts`'s `openFile`.
 *
 * Fills the `.panel-frame-body` it's rendered into (see `shell/Dock.tsx`).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useFilesStore } from './store';
import { useNotebookStore } from '../notebook/store';
import { useSessionStore } from '../session/store';
import type { ContentsEntry } from '../session/types';
import './files.css';

interface Row {
  path: string;
  name: string;
  type: ContentsEntry['type'];
  depth: number;
}

interface ContextMenuState {
  path: string;
  type: ContentsEntry['type'];
  x: number;
  y: number;
}

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

function parentOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

/** Directories first, then alphabetical (case-insensitive) within each group. */
function sortEntries(entries: ContentsEntry[]): ContentsEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

function flattenRows(entries: Record<string, ContentsEntry[]>, expanded: string[], dir: string, depth: number, out: Row[]): void {
  const children = entries[dir];
  if (!children) return;
  for (const entry of sortEntries(children)) {
    out.push({ path: entry.path, name: entry.name, type: entry.type, depth });
    if (entry.type === 'directory' && expanded.includes(entry.path)) {
      flattenRows(entries, expanded, entry.path, depth + 1, out);
    }
  }
}

/** Two-letter mono badge for a file's extension; notebooks get a fixed "NB". */
function badgeFor(row: Row): string {
  if (row.type === 'notebook') return 'NB';
  const dot = row.name.lastIndexOf('.');
  const ext = dot === -1 ? row.name : row.name.slice(dot + 1);
  return (ext.slice(0, 2) || '·').toUpperCase();
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={`file-row-chevron-icon${expanded ? ' file-row-chevron-icon-open' : ''}`} aria-hidden="true">
      <path d="M6 3.2 10.5 8 6 12.8" />
    </svg>
  );
}

function IconNewNotebook() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="2" width="10" height="12" rx="1" />
      <path d="M6 5.5h4M6 8h4M6 10.5h2" />
    </svg>
  );
}

function IconNewFile() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2h5l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" />
      <path d="M9 2v3h3" />
      <path d="M8 7.7v4.1M5.9 9.75h4.1" />
    </svg>
  );
}

function IconNewFolder() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.5 2H12.5A1.5 1.5 0 0 1 14 6.5v6A1.5 1.5 0 0 1 12.5 14h-9A1.5 1.5 0 0 1 2 12.5v-8Z" />
      <path d="M8 8v3.5M6.25 9.75h3.5" />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 11V3M4.5 6.5 8 3l3.5 3.5" />
      <path d="M3 13h10" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13 4.5A5.5 5.5 0 1 0 14 8" />
      <path d="M13 2v3h-3" />
    </svg>
  );
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="file-icon-btn" title={title} aria-label={title} onClick={onClick}>
      {children}
    </button>
  );
}

export function FileBrowser() {
  const entries = useFilesStore((s) => s.entries);
  const expanded = useFilesStore((s) => s.expanded);
  const selected = useFilesStore((s) => s.selected);
  const loading = useFilesStore((s) => s.loading);
  const files = useFilesStore((s) => s.files);
  const error = useFilesStore((s) => s.error);
  const connection = useSessionStore((s) => s.connection);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [panelDragOver, setPanelDragOver] = useState(false);
  const [dragOverDir, setDragOverDir] = useState<string | null>(null);

  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Load the root once we have a provider, and again on every reconnect —
  // the panel can be forced visible (`?panels=files`) before the user ever
  // clicks Connect, so a mount-only fetch would leave it stuck on
  // "Not connected" after the fact.
  useEffect(() => {
    if (connection === 'connected') void useFilesStore.getState().loadDir('');
  }, [connection]);

  // Close the context menu on any click outside it.
  useEffect(() => {
    if (!contextMenu) return;
    function onDocMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setContextMenu(null);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [contextMenu]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    flattenRows(entries, expanded, '', 1, out);
    return out;
  }, [entries, expanded]);

  /** Where a header "new …" action should land: the selected directory, or its parent. */
  function targetDir(): string {
    if (!selected) return '';
    const siblings = entries[parentOf(selected)] ?? [];
    const entry = siblings.find((e) => e.path === selected);
    return entry?.type === 'directory' ? selected : parentOf(selected);
  }

  function ensureExpanded(dir: string): void {
    if (dir && !useFilesStore.getState().expanded.includes(dir)) useFilesStore.getState().toggleDir(dir);
  }

  function activateRow(row: Row): void {
    if (row.type === 'directory') useFilesStore.getState().toggleDir(row.path);
    else if (row.type === 'notebook') void useNotebookStore.getState().open(row.path);
    else void useFilesStore.getState().openFile(row.path);
  }

  function handleRowClick(row: Row): void {
    useFilesStore.getState().select(row.path);
    if (row.type !== 'directory') activateRow(row);
  }

  function handleDelete(path: string): void {
    if (!window.confirm(`Delete "${path}"? This cannot be undone.`)) return;
    void useFilesStore.getState().remove(path);
  }

  function commitRename(path: string, value: string): void {
    setRenaming(null);
    const name = value.trim();
    if (!name || name === basename(path)) return;
    void useFilesStore.getState().rename(path, name);
  }

  function handleNewNotebook(): void {
    const dir = targetDir();
    ensureExpanded(dir);
    void useFilesStore.getState().createNotebookIn(dir);
  }

  function handleNewFile(): void {
    const name = window.prompt('New file name', 'untitled.txt');
    if (!name) return;
    const dir = targetDir();
    ensureExpanded(dir);
    void useFilesStore.getState().createFileIn(dir, name);
  }

  function handleNewFolder(): void {
    const name = window.prompt('New folder name', 'New Folder');
    if (!name) return;
    const dir = targetDir();
    ensureExpanded(dir);
    void useFilesStore.getState().createFolderIn(dir, name);
  }

  function handleUploadChange(e: ChangeEvent<HTMLInputElement>): void {
    const list = e.target.files;
    if (list && list.length > 0) void useFilesStore.getState().upload(targetDir(), list);
    e.target.value = '';
  }

  function dropOnto(e: DragEvent, dir: string): void {
    e.preventDefault();
    e.stopPropagation();
    setDragOverDir(null);
    setPanelDragOver(false);
    const list = e.dataTransfer.files;
    if (list && list.length > 0) void useFilesStore.getState().upload(dir, list);
  }

  function handleTreeKeyDown(e: ReactKeyboardEvent<HTMLDivElement>): void {
    if (renaming) return;
    const idx = rows.findIndex((r) => r.path === selected);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = rows[Math.min(idx + 1, rows.length - 1)] ?? rows[0];
      if (next) useFilesStore.getState().select(next.path);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = rows[Math.max(idx - 1, 0)];
      if (prev) useFilesStore.getState().select(prev.path);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[idx];
      if (row) activateRow(row);
    } else if (e.key === 'F2') {
      e.preventDefault();
      const row = rows[idx];
      if (row) setRenaming(row.path);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      const row = rows[idx];
      if (row) handleDelete(row.path);
    }
  }

  const rootLoading = loading[''] && entries[''] === undefined;

  return (
    <div
      className={`file-browser${panelDragOver ? ' file-browser-dragover' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setPanelDragOver(true);
      }}
      onDragLeave={() => setPanelDragOver(false)}
      onDrop={(e) => dropOnto(e, '')}
    >
      <div className="file-browser-header">
        <IconButton title="New notebook" onClick={handleNewNotebook}>
          <IconNewNotebook />
        </IconButton>
        <IconButton title="New file" onClick={handleNewFile}>
          <IconNewFile />
        </IconButton>
        <IconButton title="New folder" onClick={handleNewFolder}>
          <IconNewFolder />
        </IconButton>
        <IconButton title="Upload files" onClick={() => uploadInputRef.current?.click()}>
          <IconUpload />
        </IconButton>
        <span className="file-browser-spacer" />
        <IconButton title="Refresh" onClick={() => void useFilesStore.getState().refresh()}>
          <IconRefresh />
        </IconButton>
        <input ref={uploadInputRef} type="file" multiple hidden onChange={handleUploadChange} />
      </div>

      {error && <p className="error-text file-browser-error">{error}</p>}

      <div className="file-browser-tree" role="tree" aria-label="Workspace files" tabIndex={0} onKeyDown={handleTreeKeyDown}>
        <div className="file-row file-row-root" role="treeitem" aria-expanded="true">
          <span className="file-row-badge file-row-badge-root" aria-hidden="true">
            /
          </span>
          <span className="file-row-name">workspace</span>
        </div>

        {rootLoading && <p className="muted file-browser-loading">Loading…</p>}
        {!rootLoading && entries[''] && entries[''].length === 0 && <p className="muted file-browser-loading">No files</p>}

        {rows.map((row) => {
          const isDir = row.type === 'directory';
          const isOpenDirty = files[row.path]?.dirty;
          return (
            <div
              key={row.path}
              className={`file-row${row.path === selected ? ' file-row-selected' : ''}${
                row.type === 'notebook' ? ' file-row-notebook' : ''
              }`}
              style={{ paddingLeft: 8 + row.depth * 14 }}
              role="treeitem"
              aria-selected={row.path === selected}
              aria-expanded={isDir ? expanded.includes(row.path) : undefined}
              data-dragover={dragOverDir === row.path || undefined}
              onClick={() => handleRowClick(row)}
              onDoubleClick={() => activateRow(row)}
              onContextMenu={(e) => {
                e.preventDefault();
                useFilesStore.getState().select(row.path);
                setContextMenu({ path: row.path, type: row.type, x: e.clientX, y: e.clientY });
              }}
              onDragOver={
                isDir
                  ? (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragOverDir(row.path);
                    }
                  : undefined
              }
              onDragLeave={isDir ? () => setDragOverDir((d) => (d === row.path ? null : d)) : undefined}
              onDrop={isDir ? (e) => dropOnto(e, row.path) : undefined}
            >
              {isDir ? (
                <button
                  type="button"
                  className="file-row-chevron"
                  aria-label={expanded.includes(row.path) ? 'Collapse folder' : 'Expand folder'}
                  onClick={(e) => {
                    e.stopPropagation();
                    useFilesStore.getState().toggleDir(row.path);
                  }}
                >
                  <ChevronIcon expanded={expanded.includes(row.path)} />
                </button>
              ) : (
                <span className="file-row-badge" aria-hidden="true">
                  {badgeFor(row)}
                </span>
              )}

              {renaming === row.path ? (
                <input
                  autoFocus
                  className="file-row-rename-input"
                  defaultValue={row.name}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(row.path, e.currentTarget.value);
                    else if (e.key === 'Escape') setRenaming(null);
                  }}
                  onBlur={(e) => commitRename(row.path, e.currentTarget.value)}
                />
              ) : (
                <span className="file-row-name">{row.name}</span>
              )}

              {isOpenDirty && <i className="dirty-dot" aria-label="unsaved changes" />}
              {isDir && loading[row.path] && entries[row.path] === undefined && <span className="muted file-row-loading-inline">…</span>}
            </div>
          );
        })}
      </div>

      {contextMenu && (
        <div ref={menuRef} className="file-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button
            type="button"
            onClick={() => {
              activateRow({ path: contextMenu.path, name: basename(contextMenu.path), type: contextMenu.type, depth: 0 });
              setContextMenu(null);
            }}
          >
            Open
          </button>
          <button
            type="button"
            onClick={() => {
              setRenaming(contextMenu.path);
              setContextMenu(null);
            }}
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => {
              handleDelete(contextMenu.path);
              setContextMenu(null);
            }}
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(contextMenu.path);
              setContextMenu(null);
            }}
          >
            Copy path
          </button>
        </div>
      )}
    </div>
  );
}

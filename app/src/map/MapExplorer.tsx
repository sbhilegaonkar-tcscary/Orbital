/**
 * The explorer column: the map's second half, and the answer to "when I click
 * a planet I want the folder to open on the right as well".
 *
 * It always lists exactly one folder — the one `explorerFolder` picks from the
 * selection and the system on screen — so the map and the column can never
 * disagree about what you are looking at. Clicking a row selects (the map's
 * focus follows), double-clicking or Enter opens a notebook/file or dives into
 * a folder. Everything that used to be the HUD's toolbar and detail card lives
 * here now: the filter, the hidden toggle, the facts and the create row.
 *
 * The column owns no map state. Selection, the system on screen and the
 * open/dive verbs all arrive as props from `views/MapView.tsx`, which is the
 * one place that talks to the store — the same arrangement the renderers have.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

import { relativeTime } from '../shell/recent';
import { useNotebookStore } from '../notebook/store';
import { useSessionStore } from '../session/store';
import { useTabsStore } from '../shell/tabs';
import { bandFor, displayName, formatBytes, type BodyInput, type BodyKind } from './model';
import { LegendGlyph, ledClassFor } from './MapHud';
import {
  createFileHere,
  createFolderHere,
  createNotebookHere,
  getMapFixture,
  useBodyStatuses,
  useFolderListing,
  type BodyStatus,
} from './store';

export interface MapExplorerProps {
  /** The system on screen; '' is the workspace root. */
  dir: string;
  /** The folder this column lists (`explorerFolder`), which may be below `dir`. */
  folder: string;
  selected: string | null;
  query: string;
  showHidden: boolean;
  /** The files store's last failure, so the column can say what went wrong. */
  error: string | null;
  /** So `/` from the stage can put the caret in the filter. */
  filterRef: RefObject<HTMLInputElement>;
  /** Esc inside the column hands focus back to the stage. */
  onReturnFocus(): void;
  onSelect(path: string | null): void;
  onOpen(path: string, kind: BodyKind): void;
  onDive(dir: string): void;
  onQuery(query: string): void;
  onShowHidden(show: boolean): void;
}

const KIND_NOUN: Record<BodyKind, string> = {
  notebook: 'notebook',
  directory: 'folder',
  file: 'file',
};

/** `''` for a root-level path, else everything before the last `/`. */
function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

function basename(path: string): string {
  return path === '' ? 'workspace' : path.slice(path.lastIndexOf('/') + 1);
}

export function MapExplorer(props: MapExplorerProps) {
  const { dir, folder, selected, query, showHidden, error, filterRef, onReturnFocus } = props;
  const { onSelect, onOpen, onDive, onQuery, onShowHidden } = props;

  const { entries, loading } = useFolderListing(folder);
  const statuses = useBodyStatuses(entries);

  const docs = useNotebookStore((s) => s.docs);
  const activeTab = useTabsStore((s) => s.activeTab);
  const kernelName = useSessionStore((s) => s.kernelName);
  const connection = useSessionStore((s) => s.connection);

  const listRef = useRef<HTMLUListElement>(null);
  const [focusIndex, setFocusIndex] = useState(0);

  const needle = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const filtered = needle
      ? entries.filter((e) => e.name.toLowerCase().includes(needle))
      : entries;
    // Folders first, then by name: the shape of the tree before its contents.
    return [...filtered].sort((a, b) => {
      const aDir = a.kind === 'directory' ? 0 : 1;
      const bDir = b.kind === 'directory' ? 0 : 1;
      if (aDir !== bDir) return aDir - bDir;
      return a.name.localeCompare(b.name);
    });
  }, [entries, needle]);

  const selectedIndex = selected ? rows.findIndex((r) => r.path === selected) : -1;
  // A selected notebook/file is a row of this listing; a selected FOLDER is
  // the listing itself, so its facts are the folder's counts and its primary
  // action is `Enter`.
  const body = selected ? entries.find((e) => e.path === selected) : undefined;
  const selectionIsFolder = selected !== null && selected === folder;

  // The roving tabindex follows the selection when there is one, so arrowing
  // and clicking cannot end up pointing at different rows.
  useEffect(() => {
    if (selectedIndex >= 0) setFocusIndex(selectedIndex);
  }, [selectedIndex]);

  useEffect(() => {
    setFocusIndex((i) => (rows.length === 0 ? 0 : Math.min(i, rows.length - 1)));
  }, [rows.length]);

  /**
   * Show `path`'s listing, whichever level it is on: the system on screen
   * clears the selection, a folder inside it becomes the selection (the
   * renderer focuses it), anything above it is a dive.
   */
  const showFolder = useCallback(
    (path: string) => {
      if (path === folder) return;
      if (path === dir) onSelect(null);
      else if (parentOf(path) === dir) onSelect(path);
      else onDive(path);
    },
    [dir, folder, onDive, onSelect],
  );

  const activate = useCallback(
    (entry: BodyInput) => {
      if (entry.kind === 'directory') onDive(entry.path);
      else onOpen(entry.path, entry.kind);
    },
    [onDive, onOpen],
  );

  /**
   * Single click. The map can only hold a selection one level below its
   * system, so a folder row inside a listing that is already a level down
   * would be two: the map follows the column down first, and the folder being
   * left becomes the system. Notebooks and files never need this — they are
   * the focused moon of the folder they sit in.
   */
  const selectRow = useCallback(
    (entry: BodyInput) => {
      if (entry.kind === 'directory' && folder !== dir) onDive(folder);
      onSelect(entry.path);
    },
    [dir, folder, onDive, onSelect],
  );

  /**
   * Clicking a folder row re-lists the column, so by the time the second
   * click of a double-click lands, that row is gone and `dblclick` is
   * dispatched on the list instead of on any row. Remembering what the first
   * click hit is what keeps "double-click a folder to dive" working.
   */
  const lastClicked = useRef<BodyInput | null>(null);

  function focusRow(index: number): void {
    setFocusIndex(index);
    const row = listRef.current?.querySelectorAll<HTMLElement>('.explorer-row')[index];
    row?.focus();
  }

  function onListKeyDown(event: KeyboardEvent<HTMLUListElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onReturnFocus();
      return;
    }
    if (event.key === '/') {
      event.preventDefault();
      filterRef.current?.focus();
      filterRef.current?.select();
      return;
    }
    if (rows.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // Movement only: selecting a folder re-lists the column, so arrowing
      // past one must not yank the listing out from under the cursor. Enter
      // is the commit.
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      focusRow((focusIndex + step + rows.length) % rows.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      activate(rows[focusIndex]);
    }
  }

  const crumbs = folder === '' ? [] : folder.split('/');
  const fixtureActive = getMapFixture() !== null;
  const cannotCreate = fixtureActive || connection !== 'connected';
  const createTitle = fixtureActive
    ? 'Fixture mode'
    : connection === 'connecting'
      ? 'Connecting to Jupyter…'
      : connection !== 'connected'
        ? 'Not connected'
        : undefined;

  return (
    <section className="map-panel map-explorer" aria-label="Folder explorer">
      <header className="explorer-head">
        <nav className="explorer-crumbs" aria-label="Listed folder">
          {folder !== '' && (
            <button
              type="button"
              className="crumb-up"
              title="List the folder above"
              onClick={() => showFolder(parentOf(folder))}
            >
              ↑
            </button>
          )}
          <button type="button" className="crumb" onClick={() => showFolder('')}>
            workspace
          </button>
          {crumbs.map((name, i) => {
            const path = crumbs.slice(0, i + 1).join('/');
            return i === crumbs.length - 1 ? (
              <span key={path} className="crumb crumb-current" aria-current="page">
                <span className="crumb-sep">›</span>
                {name}
              </span>
            ) : (
              <button key={path} type="button" className="crumb" onClick={() => showFolder(path)}>
                <span className="crumb-sep">›</span>
                {name}
              </button>
            );
          })}
        </nav>

        <div className="explorer-controls">
          <div className="filter-wrap">
            <input
              ref={filterRef}
              className="map-filter"
              type="text"
              placeholder="filter"
              aria-label="Filter entries"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return;
                e.preventDefault();
                e.stopPropagation();
                onQuery('');
                onReturnFocus();
              }}
            />
            <span className="filter-hint" aria-hidden="true">
              /
            </span>
          </div>
          <button
            type="button"
            className="hidden-toggle"
            aria-pressed={showHidden}
            title="Show dotfiles"
            onClick={() => onShowHidden(!showHidden)}
          >
            hidden
          </button>
        </div>
      </header>

      <div className="explorer-facts">
        {body ? (
          <EntryFacts
            entry={body}
            status={statuses[body.path]}
            cells={docs[body.path]?.cells.length}
            executed={docs[body.path]?.cells.filter((c) => c.executionCount !== null).length}
            kernelName={activeTab?.path === body.path ? kernelName : null}
          />
        ) : (
          <FolderFacts folder={folder} entries={entries} statuses={statuses} loading={loading} />
        )}
        {error && <p className="error-text">{error}</p>}
      </div>

      <ul
        className="explorer-list"
        ref={listRef}
        role="listbox"
        aria-label={`Contents of ${basename(folder)}`}
        onKeyDown={onListKeyDown}
        onDoubleClick={() => {
          const entry = lastClicked.current;
          if (entry) activate(entry);
        }}
      >
        {rows.length === 0 ? (
          <li className="explorer-empty">{loading ? 'scanning…' : 'nothing here yet'}</li>
        ) : (
          rows.map((entry, i) => {
            const status = statuses[entry.path];
            const isSelected = selected === entry.path;
            return (
              <li
                key={entry.path}
                className={`explorer-row kind-${entry.kind}${isSelected ? ' is-selected' : ''}`}
                role="option"
                aria-selected={isSelected}
                tabIndex={i === focusIndex ? 0 : -1}
                onClick={(event) => {
                  // The second click of a double-click lands on whatever row
                  // the first one's re-list put here; the list's `dblclick`
                  // acts on what was actually aimed at.
                  if (event.detail > 1) return;
                  lastClicked.current = entry;
                  setFocusIndex(i);
                  selectRow(entry);
                }}
                onFocus={() => setFocusIndex(i)}
              >
                <LegendGlyph kind={entry.kind} />
                <span className="row-name">{displayName(entry)}</span>
                {status?.open && <span className="row-open" aria-label="open in a tab" />}
                {status?.kernel && status.kernel !== 'disconnected' && (
                  <span className={`led ${ledClassFor(status)}`} aria-label={`kernel ${status.kernel}`} />
                )}
                <span className="row-time">{relativeTime(entry.modifiedAt)}</span>
              </li>
            );
          })
        )}
      </ul>

      <footer className="explorer-actions">
        {body ? (
          <button type="button" className="detail-primary" onClick={() => activate(body)}>
            {body.kind === 'directory' ? 'Enter' : 'Open'}
          </button>
        ) : (
          selectionIsFolder && (
            <button type="button" className="detail-primary" onClick={() => onDive(folder)}>
              Enter
            </button>
          )
        )}
        <span className="explorer-context">in {basename(folder)}/</span>
        <button
          type="button"
          className="link-button"
          disabled={cannotCreate}
          title={createTitle}
          onClick={() => createNotebookHere(folder)}
        >
          ＋ Notebook
        </button>
        <button
          type="button"
          className="link-button"
          disabled={cannotCreate}
          title={createTitle}
          onClick={() => createFolderHere(folder)}
        >
          ＋ Folder
        </button>
        <button
          type="button"
          className="link-button"
          disabled={cannotCreate}
          title={createTitle}
          onClick={() => createFileHere(folder)}
        >
          ＋ File
        </button>
      </footer>
    </section>
  );
}

/** The facts the detail card used to show, for whatever body is selected. */
function EntryFacts({
  entry,
  status,
  cells,
  executed,
  kernelName,
}: {
  entry: BodyInput;
  status: BodyStatus | undefined;
  cells: number | undefined;
  executed: number | undefined;
  kernelName: string | null;
}) {
  const facts = [KIND_NOUN[entry.kind]];
  if (entry.kind === 'directory') {
    if (entry.childCount !== undefined) facts.push(`${entry.childCount} items`);
  } else if (entry.bytes !== undefined) {
    facts.push(formatBytes(entry.bytes));
  }
  facts.push(`modified ${relativeTime(entry.modifiedAt)}`);

  const errors = status?.errors ?? 0;

  return (
    <>
      <h2 className="detail-title">{displayName(entry)}</h2>
      <p className="detail-sub">{facts.join(' · ')}</p>

      {status?.kernel && status.kernel !== 'disconnected' && (
        <p className="detail-row">
          <span className={`led ${ledClassFor(status)}`} aria-hidden="true" />
          kernel {status.kernel}
          {kernelName ? ` · ${kernelName}` : ''}
        </p>
      )}
      {cells !== undefined && (
        <p className="detail-row detail-counts">
          cells {cells} · executed {executed ?? 0}
          {errors > 0 ? ` · errors ${errors}` : ''}
        </p>
      )}
      {status?.dirty && <p className="detail-row">unsaved changes</p>}
      {status?.open && <p className="detail-row">open in a tab</p>}
    </>
  );
}

/** What the listed folder holds, when nothing in it is selected. */
function FolderFacts({
  folder,
  entries,
  statuses,
  loading,
}: {
  folder: string;
  entries: BodyInput[];
  statuses: Record<string, BodyStatus>;
  loading: boolean;
}) {
  const now = Date.now();
  const notebooks = entries.filter((e) => e.kind === 'notebook').length;
  const folders = entries.filter((e) => e.kind === 'directory').length;
  const files = entries.filter((e) => e.kind === 'file').length;
  const today = entries.filter((e) => bandFor(now - e.modifiedAt) === 'today').length;

  let busy = 0;
  let idle = 0;
  let unsaved = 0;
  for (const entry of entries) {
    const status = statuses[entry.path];
    if (!status) continue;
    if (status.dirty) unsaved += 1;
    if (status.kernel === 'idle') idle += 1;
    else if (status.kernel === 'busy' || status.kernel === 'starting' || status.kernel === 'restarting') {
      busy += 1;
    }
  }

  const counts = [
    notebooks === 1 ? '1 notebook' : `${notebooks} notebooks`,
    folders === 1 ? '1 folder' : `${folders} folders`,
    files === 1 ? '1 file' : `${files} files`,
  ].join(' · ');

  const kernels = [busy > 0 ? `${busy} kernel busy` : '', idle > 0 ? `${idle} idle` : '']
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <h2 className="detail-title">{basename(folder)}</h2>
      <p className="detail-sub">{loading && entries.length === 0 ? 'scanning…' : counts}</p>
      {today > 0 && <p className="detail-row">{today} changed today</p>}
      {kernels && <p className="detail-row">{kernels}</p>}
      {unsaved > 0 && <p className="detail-row">{unsaved} unsaved</p>}
    </>
  );
}

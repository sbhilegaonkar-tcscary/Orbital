/**
 * Variable inspector panel. Reads `useSessionStore.kernelStatus` (read-only
 * contract, `session/store.ts`) to know whether there is a kernel at all, and
 * `useInspectorStore` (owned here, `inspector/store.ts`) for the variables
 * themselves. The manual refresh button goes through `getWiredSession`
 * rather than importing `notebook/store` directly, since that store's
 * `getActiveSession` export is still landing from a concurrent refactor.
 */
import { useMemo } from 'react';
import { useSessionStore } from '../session/store';
import { useInspectorStore, getWiredSession } from '../inspector/store';
import type { Variable } from '../inspector/parse';
import '../inspector/inspector.css';

const TINTED_TYPES = new Set(['DataFrame', 'ndarray']);

function formatValue(v: Variable): string {
  if (v.shape && v.shape.length > 0) {
    return v.shape.map((n) => n.toLocaleString()).join(' × ');
  }
  if (v.length !== null) {
    return v.length.toLocaleString();
  }
  return v.repr;
}

export function Inspector() {
  const kernelStatus = useSessionStore((s) => s.kernelStatus);
  const variables = useInspectorStore((s) => s.variables);
  const refreshing = useInspectorStore((s) => s.refreshing);
  const error = useInspectorStore((s) => s.error);
  const filter = useInspectorStore((s) => s.filter);
  const setFilter = useInspectorStore((s) => s.setFilter);
  const refresh = useInspectorStore((s) => s.refresh);

  const noKernel = kernelStatus === 'disconnected';

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return variables;
    return variables.filter((v) => v.name.toLowerCase().includes(needle));
  }, [variables, filter]);

  const handleRefresh = () => {
    const session = getWiredSession();
    if (session) void refresh(session);
  };

  return (
    <aside className="inspector">
      <div className="inspector-header">
        <h2 className="inspector-title">
          Variables <span className="inspector-count">{variables.length}</span>
        </h2>
        <button
          type="button"
          className="inspector-refresh"
          onClick={handleRefresh}
          disabled={noKernel || refreshing}
          aria-label="Refresh variables"
          title="Refresh variables"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path
              d="M13.3 8a5.3 5.3 0 1 1-1.55-3.75M13.3 2v3.75h-3.75"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {noKernel ? (
        <p className="inspector-empty">No kernel</p>
      ) : (
        <>
          <input
            type="text"
            className="inspector-filter"
            placeholder="Filter variables"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter variables"
          />
          {error && <p className="inspector-error">{error}</p>}
          {filtered.length === 0 ? (
            <p className="inspector-empty">No variables yet</p>
          ) : (
            <div className="inspector-list">
              {filtered.map((v) => (
                <div className="inspector-row" key={v.name}>
                  <span className="inspector-name">{v.name}</span>
                  <span className="inspector-type" data-tinted={TINTED_TYPES.has(v.type) ? '' : undefined}>
                    {v.type}
                    {v.module && <span className="inspector-module">{v.module}</span>}
                  </span>
                  <span className="inspector-value">{formatValue(v)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </aside>
  );
}

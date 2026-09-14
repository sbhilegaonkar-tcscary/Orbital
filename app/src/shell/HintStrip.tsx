/**
 * First-run hint strip: a one-line dismissible banner under the top bar,
 * shown only until the owner dismisses it once (docs/DESIGN.md). Mounted
 * once, in `AppShell.tsx`.
 */
import { useState } from 'react';

const STORAGE_KEY = 'orbital.hints.v1';

/** Null outside a browser (the vitest node environment). */
function storage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    // Safari in private mode throws on access rather than returning null.
    return null;
  }
}

function alreadyDismissed(): boolean {
  try {
    return storage()?.getItem(STORAGE_KEY) === 'dismissed';
  } catch {
    return false;
  }
}

export function HintStrip() {
  const [dismissed, setDismissed] = useState(alreadyDismissed);

  if (dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try {
      storage()?.setItem(STORAGE_KEY, 'dismissed');
    } catch {
      // Quota or private mode: the hint just reappears next launch.
    }
  }

  return (
    <div className="hint-strip">
      <span>Press ? for shortcuts · Ctrl+K for commands · the rail toggles panels</span>
      <button type="button" className="hint-strip-dismiss" aria-label="Dismiss hint" onClick={dismiss}>
        ×
      </button>
    </div>
  );
}

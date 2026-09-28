/**
 * Auto-connect on load.
 *
 * `session/store.ts` sets `orbital.autoconnect` after every successful
 * connect and clears it on an explicit `disconnect()`, so the flag means
 * "this machine was talking to a Jupyter Server last time, and nobody hung
 * up". When it is set, the app starts its patient connect loop on load
 * instead of waiting for the owner to press Connect — which is the whole
 * point, since the server is usually still booting at that moment.
 *
 * Imported for side effects from `shell/AppShell.tsx`, beside the command
 * registrations. Runs once per page load.
 */
import { autoconnectEnabled, useSessionStore } from './store';

export function startAutoconnect(): void {
  if (!autoconnectEnabled()) return;
  if (useSessionStore.getState().connection !== 'disconnected') return;
  void useSessionStore.getState().connect();
}

startAutoconnect();

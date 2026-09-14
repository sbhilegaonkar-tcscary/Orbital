/**
 * Shown in place of the transcript when `auth && !auth.loggedIn`: why, the
 * exact command to run, and a shortcut into the ORBITAL terminal with that
 * command typed in. The sidecar never handles credentials — this is the
 * whole auth UI (docs/ARCHITECTURE.md "Agent harness (M7)").
 */
import { useState } from 'react';
import type { AuthStatus } from './protocol';
import { useLayoutStore } from '../shell/layout';
import { getRuntime, useTerminalStore } from '../terminal/store';

export interface AuthGateProps {
  auth: AuthStatus;
}

/**
 * Mirrors `runSelectionInTerminal` in shell/commands.ts: show the terminal
 * dock, reuse the active terminal if there is one or create one, then type
 * the given command in. `terminal/store.ts` is read-only for this task.
 */
async function openCommandInTerminal(command: string): Promise<void> {
  useLayoutStore.getState().setVisible('terminal', true);
  const { terminals, active, create } = useTerminalStore.getState();
  let name = active;
  if (!name || !terminals.some((t) => t.name === name)) {
    await create();
    name = useTerminalStore.getState().active;
  }
  getRuntime(name ?? '')?.conn.send(`${command}\r`);
}

export interface CommandBoxProps {
  command: string;
}

/** A mono command with a Copy button and an "Open in terminal" shortcut. Shared by `AuthGate` and the not-connected view. */
export function CommandBox({ command }: CommandBoxProps) {
  const [copied, setCopied] = useState(false);

  async function copyCommand() {
    try {
      await navigator.clipboard?.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (permissions, insecure context) — the mono
      // box below still shows the command to copy by hand.
    }
  }

  return (
    <>
      <div className="agent-authgate-cmd-row">
        <code className="agent-authgate-cmd">{command}</code>
        <button type="button" className="agent-authgate-copy" onClick={() => void copyCommand()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <button
        type="button"
        className="agent-authgate-open"
        onClick={() => void openCommandInTerminal(command)}
      >
        Open in terminal
      </button>
    </>
  );
}

export function AuthGate({ auth }: AuthGateProps) {
  return (
    <div className="agent-authgate">
      <p className="agent-authgate-reason">{auth.reason ?? 'Not logged in to Claude.'}</p>
      <CommandBox command={auth.loginCommand} />
    </div>
  );
}

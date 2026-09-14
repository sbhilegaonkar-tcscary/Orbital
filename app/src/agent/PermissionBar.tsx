/**
 * Pinned above the prompt box whenever `AgentState.pendingPermission` is
 * set: which tool wants to run, a one-line summary of its input, and
 * Allow / Always allow / Deny.
 */
import type { PendingPermission } from './store';
import { summarizeToolInput } from './ToolCard';

export interface PermissionBarProps {
  pending: PendingPermission;
  onAllow(): void;
  onAlwaysAllow(): void;
  onDeny(): void;
}

export function PermissionBar({ pending, onAllow, onAlwaysAllow, onDeny }: PermissionBarProps) {
  return (
    <div className="permission-bar" role="alert">
      <div className="permission-bar-info">
        <span className="permission-bar-tool">{pending.tool}</span>
        <span className="permission-bar-desc">{pending.description || summarizeToolInput(pending.tool, pending.input)}</span>
      </div>
      <div className="permission-bar-actions">
        <button type="button" className="permission-btn permission-btn-deny" onClick={onDeny}>
          Deny
        </button>
        <button type="button" className="permission-btn permission-btn-always" onClick={onAlwaysAllow}>
          Always allow
        </button>
        <button type="button" className="permission-btn permission-btn-allow" onClick={onAllow}>
          Allow
        </button>
      </div>
    </div>
  );
}

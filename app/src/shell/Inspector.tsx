import { useSessionStore } from '../session/store';

export function Inspector() {
  const kernelStatus = useSessionStore((s) => s.kernelStatus);

  return (
    <aside className="inspector">
      <h2 className="inspector-title">Variables</h2>
      {kernelStatus === 'disconnected' ? (
        <p className="inspector-empty">Connect a kernel to inspect variables</p>
      ) : (
        <div className="inspector-list" />
      )}
    </aside>
  );
}

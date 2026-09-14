/**
 * One xterm instance bound to one named terminal connection. `TerminalPanel`
 * mounts every open terminal's `TerminalView` at once and toggles `visible`
 * instead of unmounting on tab switch, since xterm loses its buffer when its
 * container is removed from the DOM.
 *
 * This component creates and disposes its own xterm instance (so React
 * StrictMode's mount/cleanup/mount in dev tears down cleanly); the store only
 * disposes one itself when a terminal closes while nothing is attached to
 * replay into. The raw connection and its replay buffer live in
 * `terminal/store.ts` independent of this component's lifecycle, since the
 * shell can start streaming before any view has mounted to receive it.
 */
import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { attachXterm, detachXterm, getRuntime, useTerminalStore } from './store';
import { buildXtermTheme } from './xtermTheme';
import { useThemeStore } from '../theme/ThemeProvider';
import { useLayoutStore } from '../shell/layout';

interface TerminalViewProps {
  name: string;
  visible: boolean;
}

/** xterm needs a concrete font-family string; CSS vars are not resolved for it. */
function readMonoFont(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
  return value || 'monospace';
}

export function TerminalView({ name, visible }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [connected, setConnected] = useState(false);
  const markOpen = useTerminalStore((s) => s.markOpen);

  const safeFit = () => {
    const el = containerRef.current;
    const fit = fitRef.current;
    if (!el || !fit) return;
    if (el.clientWidth === 0 && el.clientHeight === 0) return;
    try {
      fit.fit();
    } catch {
      /* container mid-measurement; the next observer tick retries */
    }
  };

  // Mount: create the xterm instance for this name and wire it to the
  // already-open connection this store holds (see `terminal/store.ts`).
  useEffect(() => {
    const runtime = getRuntime(name);
    const container = containerRef.current;
    if (!runtime || !container) return;

    const term = new Terminal({
      fontFamily: readMonoFont(),
      fontSize: 13,
      lineHeight: 1.2,
      cursorStyle: 'bar',
      scrollback: 5000,
      theme: buildXtermTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(container);

    termRef.current = term;
    fitRef.current = fit;

    // Data may already be sitting in the runtime's replay buffer (the shell
    // starts streaming before this view exists to receive it) — attaching
    // replays it synchronously, which is also what flips `connected` below.
    let receivedData = false;
    const handleData = (data: string) => {
      term.write(data);
      if (!receivedData) {
        receivedData = true;
        setConnected(true);
        markOpen(name);
      }
    };
    attachXterm(name, term, fit, handleData);
    safeFit();

    const onDataDisposable = term.onData((data) => runtime.conn.send(data));
    const onResizeDisposable = term.onResize(({ cols, rows }) => runtime.conn.resize(cols, rows));

    const resizeObserver = new ResizeObserver(() => safeFit());
    resizeObserver.observe(container);

    const onWindowResize = () => safeFit();
    window.addEventListener('resize', onWindowResize);

    return () => {
      detachXterm(name, handleData);
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      resizeObserver.disconnect();
      window.removeEventListener('resize', onWindowResize);
      term.dispose();
    };
    // Re-runs only if this view is ever reused for a different name.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  // Fit again whenever this tab becomes the visible one.
  useEffect(() => {
    if (visible) safeFit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Fit whenever the terminal dock is resized.
  useEffect(
    () =>
      useLayoutStore.subscribe((state, prev) => {
        if (state.panels.terminal.size !== prev.panels.terminal.size) safeFit();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Re-apply the xterm theme on every skin/mode change.
  useEffect(
    () =>
      useThemeStore.subscribe(() => {
        const term = termRef.current;
        if (term) term.options.theme = buildXtermTheme();
      }),
    [],
  );

  return (
    <div className="terminal-view" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="terminal-container" ref={containerRef} />
      {!connected && (
        <div className="terminal-connecting muted" aria-live="polite">
          connecting…
        </div>
      )}
    </div>
  );
}

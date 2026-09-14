import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useThemeStore } from '../theme/ThemeProvider';
import { Sky } from '../effects/Sky';
import { TopBar } from './TopBar';
import { Rail } from './Rail';
import { StatusBar } from './StatusBar';
import { CommandPalette } from './CommandPalette';
import { Dock } from './Dock';
import { Resizer } from './Resizer';
import { idsOnSide, useLayoutStore, DEFAULT_SIZE, PANEL_IDS, effectiveSize, useViewportTick, type PanelId } from './layout';
import { runCommand } from './commands';
import { wireInspector } from '../inspector/store';
import { getActiveSession, onExecutionSettled } from '../notebook/store';
// Side-effect only: runs the notebook command registrations once.
import '../notebook/commands';

/** Overlay breakpoint for side docks (docs/ARCHITECTURE.md "Layout (M6)"). */
const NARROW_BREAKPOINT = 900;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  return target.closest('.cm-editor') !== null;
}

export function AppShell({ children }: { children: ReactNode }) {
  const mode = useThemeStore((s) => s.mode);
  const panels = useLayoutStore((s) => s.panels);
  const setSize = useLayoutStore((s) => s.setSize);
  const setVisible = useLayoutStore((s) => s.setVisible);

  useEffect(() => wireInspector(getActiveSession, onExecutionSettled), []);

  // Dev aid: `?menu=palette` opens the palette on load, for headless screenshots.
  const [paletteOpen, setPaletteOpen] = useState(
    () => new URLSearchParams(window.location.search).get('menu') === 'palette',
  );

  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth < NARROW_BREAKPOINT);
  useEffect(() => {
    function onResize() {
      setIsNarrow(window.innerWidth < NARROW_BREAKPOINT);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Dev aids for headless verification: `?panels=files,terminal` forces panels
  // visible for screenshots; `?layoutcheck=1` logs scroll-vs-client size on
  // load so the fit guarantee (nothing spills out of the viewport) can be
  // checked without a screenshot.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const forced = params.get('panels');
    if (forced) {
      for (const raw of forced.split(',')) {
        const id = raw.trim() as PanelId;
        if (PANEL_IDS.includes(id)) useLayoutStore.getState().setVisible(id, true);
      }
    }
    if (params.get('layoutcheck') === '1') {
      const el = document.documentElement;
      // Flattened to a single string (not an object) so it is readable from
      // `--enable-logging=stderr --v=0` in a headless run, which renders
      // logged objects as "[object Object]".
      // eslint-disable-next-line no-console
      console.log(
        `layoutcheck scrollWidth=${el.scrollWidth} clientWidth=${el.clientWidth} ` +
          `scrollHeight=${el.scrollHeight} clientHeight=${el.clientHeight}`,
      );
    }
    // Runs once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;

      const isPaletteShortcut = mod && (key === 'k' || (e.shiftKey && key === 'p'));
      if (isPaletteShortcut) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }

      if (isTypingTarget(e.target)) return;

      if (mod && !e.shiftKey && key === 'b') {
        e.preventDefault();
        runCommand('layout.toggle.files');
      } else if (mod && !e.shiftKey && key === '`') {
        e.preventDefault();
        runCommand('layout.toggle.terminal');
      } else if (mod && e.shiftKey && key === 'i') {
        e.preventDefault();
        runCommand('layout.toggle.inspector');
      } else if (mod && e.shiftKey && key === 'l') {
        e.preventDefault();
        runCommand('layout.toggle.agent');
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const leftIds = idsOnSide(panels, 'left');
  const rightIds = idsOnSide(panels, 'right');
  const bottomVisible = panels.terminal.visible;

  // Below the breakpoint, side docks render as overlays instead of grid
  // columns so the center view never shrinks to make room for them.
  const showLeftColumn = leftIds.length > 0 && !isNarrow;
  const showRightColumn = rightIds.length > 0 && !isNarrow;
  const showOverlays = isNarrow && (leftIds.length > 0 || rightIds.length > 0);

  // Sizes are clamped for rendering only; the store keeps the user's preference.
  useViewportTick();
  const leftWidth = leftIds.length ? Math.max(...leftIds.map((id) => effectiveSize(id, panels[id].size))) : 0;
  const rightWidth = rightIds.length ? Math.max(...rightIds.map((id) => effectiveSize(id, panels[id].size))) : 0;
  const bottomHeight = effectiveSize('terminal', panels.terminal.size);

  const gridStyle = {
    '--left-dock-w': `${showLeftColumn ? leftWidth : 0}px`,
    '--left-resizer-w': showLeftColumn ? '6px' : '0px',
    '--right-dock-w': `${showRightColumn ? rightWidth : 0}px`,
    '--right-resizer-w': showRightColumn ? '6px' : '0px',
  } as CSSProperties;

  function resizeLeft(deltaPx: number) {
    for (const id of leftIds) setSize(id, panels[id].size + deltaPx);
  }
  function resetLeft() {
    for (const id of leftIds) setSize(id, DEFAULT_SIZE[id]);
  }
  function resizeRight(deltaPx: number) {
    for (const id of rightIds) setSize(id, panels[id].size - deltaPx);
  }
  function resetRight() {
    for (const id of rightIds) setSize(id, DEFAULT_SIZE[id]);
  }
  function resizeBottom(deltaPx: number) {
    setSize('terminal', panels.terminal.size - deltaPx);
  }
  function dismissOverlays() {
    for (const id of [...leftIds, ...rightIds]) setVisible(id, false);
  }

  return (
    <div className="app-shell" style={gridStyle}>
      {mode === 'bridge' && <Sky />}
      <TopBar />
      <Rail />

      {showLeftColumn && (
        <div className="dock-area dock-area-left">
          <Dock side="left" />
        </div>
      )}
      {showLeftColumn && (
        <div className="dock-resizer-slot dock-resizer-slot-left">
          <Resizer orientation="vertical" ariaLabel="Resize left dock" onResize={resizeLeft} onReset={resetLeft} />
        </div>
      )}

      <div className="center-column">
        <div className="view-container">{children}</div>
        {bottomVisible && (
          <Resizer
            orientation="horizontal"
            ariaLabel="Resize terminal"
            onResize={resizeBottom}
            onReset={() => setSize('terminal', DEFAULT_SIZE.terminal)}
          />
        )}
        {bottomVisible && (
          <div className="dock-area dock-area-bottom" style={{ height: bottomHeight }}>
            <Dock side="bottom" />
          </div>
        )}
      </div>

      {showRightColumn && (
        <div className="dock-resizer-slot dock-resizer-slot-right">
          <Resizer orientation="vertical" ariaLabel="Resize right dock" onResize={resizeRight} onReset={resetRight} />
        </div>
      )}
      {showRightColumn && (
        <div className="dock-area dock-area-right">
          <Dock side="right" />
        </div>
      )}

      <StatusBar />

      {showOverlays && (
        <div className="dock-overlay-layer">
          <div className="dock-scrim" onClick={dismissOverlays} />
          {leftIds.length > 0 && (
            <div className="dock-overlay dock-overlay-left" style={{ width: leftWidth }}>
              <Dock side="left" />
            </div>
          )}
          {rightIds.length > 0 && (
            <div className="dock-overlay dock-overlay-right" style={{ width: rightWidth }}>
              <Dock side="right" />
            </div>
          )}
        </div>
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

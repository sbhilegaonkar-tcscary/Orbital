import { useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { MODES, TOKEN_NAMES, type Mode, type ThemeSelection } from './tokens';
import { DEFAULT_SKIN_BY_MODE, getSkinById, getSkinsForMode } from './skins';

export { getSkinsForMode, getSkinById, DEFAULT_SKIN_BY_MODE } from './skins';

interface ThemeStore extends ThemeSelection {
  setMode(mode: Mode): void;
  setSkin(mode: Mode, skinId: string): void;
  setMotion(motion: ThemeSelection['motion']): void;
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      mode: 'night-ops',
      skinByMode: { ...DEFAULT_SKIN_BY_MODE },
      motion: 'system',
      setMode: (mode) => set({ mode }),
      setSkin: (mode, skinId) => set((s) => ({ skinByMode: { ...s.skinByMode, [mode]: skinId } })),
      setMotion: (motion) => set({ motion }),
    }),
    { name: 'orbital.theme' },
  ),
);

const injectedFontHrefs = new Set<string>();

function injectFontLink(href: string) {
  if (injectedFontHrefs.has(href)) return;
  if (document.querySelector(`link[data-orbital-font="${href}"]`)) {
    injectedFontHrefs.add(href);
    return;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.orbitalFont = href;
  document.head.appendChild(link);
  injectedFontHrefs.add(href);
}

function isMode(value: string | null): value is Mode {
  return value !== null && MODES.some((m) => m.id === value);
}

/**
 * Applies the current theme selection to `document.documentElement` and
 * injects the active skin's font stylesheet. Honors `?mode=` and `?skin=`
 * query params on first load, for manual and screenshot-driven testing.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const mode = useThemeStore((s) => s.mode);
  const skinByMode = useThemeStore((s) => s.skinByMode);
  const motion = useThemeStore((s) => s.motion);
  const setMode = useThemeStore((s) => s.setMode);
  const setSkin = useThemeStore((s) => s.setSkin);

  const appliedQuery = useRef(false);
  useEffect(() => {
    if (appliedQuery.current) return;
    appliedQuery.current = true;
    const params = new URLSearchParams(window.location.search);
    const qMode = params.get('mode');
    const qSkin = params.get('skin');
    const targetMode = isMode(qMode) ? qMode : null;
    if (targetMode) setMode(targetMode);
    if (qSkin) setSkin(targetMode ?? mode, qSkin);
    // Runs once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setPrefersReducedMotion(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const skinId = skinByMode[mode];
    const skin = getSkinById(skinId) ?? getSkinsForMode(mode)[0];
    if (!skin) return;

    root.dataset.mode = mode;
    root.dataset.skin = skin.id;

    for (const name of TOKEN_NAMES) {
      root.style.setProperty(`--${name}`, skin.tokens[name]);
    }

    if (skin.fontsUrl) injectFontLink(skin.fontsUrl);

    const reduced = motion === 'reduced' || (motion === 'system' && prefersReducedMotion);
    root.dataset.motion = reduced ? 'reduced' : 'full';
  }, [mode, skinByMode, motion, prefersReducedMotion]);

  return <>{children}</>;
}

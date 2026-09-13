/**
 * Theme contract. Owned by the orchestrator. M1 adds skins under ./skins and
 * implements ThemeProvider; it does not change these types.
 */

export type Mode = 'paper' | 'night-ops' | 'cockpit' | 'bridge';

export const MODES: { id: Mode; label: string }[] = [
  { id: 'paper', label: 'Paper' },
  { id: 'night-ops', label: 'Night Ops' },
  { id: 'cockpit', label: 'Cockpit' },
  { id: 'bridge', label: 'Bridge' },
];

export const TOKEN_NAMES = [
  'bg',
  'surface',
  'surface-2',
  'border',
  'text',
  'text-muted',
  'accent',
  'accent-2',
  'success',
  'warning',
  'danger',
  'font-ui',
  'font-mono',
  'font-display',
  'radius',
  'glow',
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];

export type ThemeTokens = Record<TokenName, string>;

export interface Skin {
  /** kebab-case, unique across all modes, e.g. 'deep-space' */
  id: string;
  mode: Mode;
  name: string;
  description: string;
  tokens: ThemeTokens;
  /** Google Fonts stylesheet URL; injected once and never removed */
  fontsUrl?: string;
}

export interface ThemeSelection {
  mode: Mode;
  skinByMode: Record<Mode, string>;
  /** user override; 'system' follows prefers-reduced-motion */
  motion: 'system' | 'reduced' | 'full';
}

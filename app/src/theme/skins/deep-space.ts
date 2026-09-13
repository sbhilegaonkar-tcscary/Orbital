import type { Skin } from '../tokens';

export const deepSpace: Skin = {
  id: 'deep-space',
  mode: 'night-ops',
  name: 'Deep Space',
  description: 'Navy, not black, with one muted cyan accent and a faint vignette — the reference dark theme.',
  tokens: {
    bg: '#0a0e16',
    surface: '#0f1420',
    'surface-2': '#161d2c',
    border: '#232c3f',
    text: '#e3e8f0',
    'text-muted': '#8592a8',
    accent: '#5fb3c4',
    'accent-2': '#6c86b8',
    success: '#5fa87c',
    warning: '#c9a35f',
    danger: '#c4685f',
    'font-ui': "'Inter', system-ui, -apple-system, sans-serif",
    'font-mono': "'JetBrains Mono', Consolas, monospace",
    'font-display': "'Inter', system-ui, sans-serif",
    radius: '6px',
    glow: '0 0 0 3px rgba(95, 179, 196, 0.30)',
  },
  fontsUrl:
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap',
};

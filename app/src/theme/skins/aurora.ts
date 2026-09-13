import type { Skin } from '../tokens';

export const aurora: Skin = {
  id: 'aurora',
  mode: 'night-ops',
  name: 'Aurora',
  description: "Deep Space's navy with violet let in at the edges; cyan for interaction, violet for data types.",
  tokens: {
    bg: '#0b0d18',
    surface: '#12152a',
    'surface-2': '#1a1e36',
    border: '#272c48',
    text: '#dde2f1',
    'text-muted': '#8890ac',
    accent: '#6cc4d6',
    'accent-2': '#a892f0',
    success: '#6dbf97',
    warning: '#d3b46f',
    danger: '#d5787e',
    'font-ui': "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    'font-mono': "'JetBrains Mono', Consolas, 'Courier New', monospace",
    'font-display': "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    radius: '8px',
    glow: '0 0 0 3px color-mix(in srgb, var(--accent-2) 28%, transparent)',
  },
  fontsUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap',
};

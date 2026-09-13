import type { Skin } from '../tokens';

export const graphite: Skin = {
  id: 'graphite',
  mode: 'night-ops',
  name: 'Graphite',
  description: 'Zero color tint in the greys, a single warm amber accent — the most conservative option.',
  tokens: {
    bg: '#1c1c1e',
    surface: '#232325',
    'surface-2': '#2b2b2e',
    border: '#38383b',
    text: '#ece7df',
    'text-muted': '#96928c',
    accent: '#cf9a44',
    'accent-2': '#9a958c',
    success: '#7f9a70',
    warning: '#c98a3d',
    danger: '#b6564c',
    'font-ui': "'IBM Plex Sans', system-ui, sans-serif",
    'font-mono': "'IBM Plex Mono', Consolas, monospace",
    'font-display': "'IBM Plex Sans', system-ui, sans-serif",
    radius: '3px',
    glow: '0 0 0 2px rgba(207, 154, 68, 0.25)',
  },
  fontsUrl:
    'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap',
};

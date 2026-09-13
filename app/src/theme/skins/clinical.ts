import type { Skin } from '../tokens';

export const clinical: Skin = {
  id: 'clinical',
  mode: 'paper',
  name: 'Clinical',
  description: 'Hairline borders, no shadows, one electric blue — reads like an instrument.',
  tokens: {
    bg: '#ffffff',
    surface: '#ffffff',
    'surface-2': '#f4f6f7',
    border: '#dde2e5',
    text: '#111417',
    'text-muted': '#66707a',
    accent: '#0057ff',
    'accent-2': '#0a8f7a',
    success: '#12875a',
    warning: '#a3690a',
    danger: '#c21f2c',
    'font-ui': "'Inter', 'Segoe UI', sans-serif",
    'font-mono': "'IBM Plex Mono', Consolas, monospace",
    'font-display': "'Inter', 'Segoe UI', sans-serif",
    radius: '2px',
    glow: 'none',
  },
  fontsUrl:
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap',
};

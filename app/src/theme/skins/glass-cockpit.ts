import type { Skin } from '../tokens';

export const glassCockpit: Skin = {
  id: 'glass-cockpit',
  mode: 'cockpit',
  name: 'Glass Cockpit',
  description: 'Translucent panels with backdrop blur, hairlines, and rounded rectangles in cool blue-white.',
  tokens: {
    bg: '#050810',
    surface: 'rgba(32,48,74,0.38)',
    'surface-2': 'rgba(48,68,100,0.4)',
    border: 'rgba(153,191,230,0.18)',
    text: '#eaf3ff',
    'text-muted': '#8ea6c4',
    accent: '#5ec8ff',
    'accent-2': '#8fe3d0',
    success: '#6fe3a5',
    warning: '#ffd27a',
    danger: '#ff8f8f',
    'font-ui': "'Inter', 'Segoe UI', sans-serif",
    'font-mono': "'JetBrains Mono', 'Consolas', monospace",
    'font-display': "'Inter', 'Segoe UI', sans-serif",
    radius: '12px',
    glow: '0 0 16px rgba(94,200,255,0.35)',
  },
  fontsUrl:
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
};

import type { Skin } from '../tokens';

export const glassDeck: Skin = {
  id: 'glass-deck',
  mode: 'cockpit',
  name: 'Glass Deck',
  description: 'Frosted glass panels with tab headers, status LEDs, and a single hazard edge on the error cell.',
  tokens: {
    bg: '#060a14',
    surface: '#172439',
    'surface-2': '#22334f',
    border: '#3f5a80',
    text: '#e6f0ff',
    'text-muted': '#8ba3c4',
    accent: '#5ec8ff',
    'accent-2': '#8fe3d0',
    success: '#6fe3a5',
    warning: '#ffd27a',
    danger: '#ff7b7b',
    'font-ui': "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    'font-mono': "'JetBrains Mono', Consolas, 'Courier New', monospace",
    'font-display': "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    radius: '8px',
    glow: '0 0 14px color-mix(in srgb, var(--accent) 35%, transparent)',
  },
  fontsUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap',
};

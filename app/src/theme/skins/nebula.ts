import type { Skin } from '../tokens';

export const nebula: Skin = {
  id: 'nebula',
  mode: 'bridge',
  name: 'Nebula',
  description: 'Drifting layered radial gradients with a twinkling starfield and cyan-violet edge glow on panels.',
  tokens: {
    bg: '#0a0b16',
    surface: '#12142a',
    'surface-2': '#191c38',
    border: '#33366a',
    text: '#e8e9fb',
    'text-muted': '#9497c4',
    accent: '#4fd8e8',
    'accent-2': '#b98af0',
    success: '#4fe8a6',
    warning: '#f0c85a',
    danger: '#f2607e',
    'font-ui': "'Inter', system-ui, -apple-system, sans-serif",
    'font-mono': "'JetBrains Mono', Consolas, 'Courier New', monospace",
    'font-display': "'Orbitron', 'Inter', sans-serif",
    radius: '10px',
    glow: '0 0 0 1px rgba(79, 216, 232, 0.35), 0 0 28px rgba(185, 138, 240, 0.22)',
  },
  fontsUrl:
    'https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap',
};

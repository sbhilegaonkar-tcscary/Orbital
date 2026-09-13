import type { Skin } from '../tokens';

export const synthwave: Skin = {
  id: 'synthwave',
  mode: 'bridge',
  name: 'Synthwave',
  description: 'A gradient sun with cut lines over a scrolling perspective grid, in neon magenta and cyan.',
  tokens: {
    bg: '#180a2b',
    surface: '#251340',
    'surface-2': '#301a54',
    border: '#5c3a8c',
    text: '#f5ecff',
    'text-muted': '#b79ddb',
    accent: '#ff2fb0',
    'accent-2': '#35e8ff',
    success: '#4dffb0',
    warning: '#ffd23f',
    danger: '#ff3366',
    'font-ui': "'Rajdhani', system-ui, sans-serif",
    'font-mono': "'JetBrains Mono', Consolas, 'Courier New', monospace",
    'font-display': "'Orbitron', 'Rajdhani', sans-serif",
    radius: '6px',
    glow: '0 0 0 1px rgba(255, 47, 176, 0.4), 0 0 26px rgba(53, 232, 255, 0.22)',
  },
  fontsUrl:
    'https://fonts.googleapis.com/css2?family=Orbitron:wght@600;700&family=Rajdhani:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap',
};

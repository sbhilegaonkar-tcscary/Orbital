import type { Skin } from '../tokens';

export const nebulaDrift: Skin = {
  id: 'nebula-drift',
  mode: 'bridge',
  name: 'Nebula Drift',
  description: "Nebula's palette with deliberate motion: drifting clouds, parallax stars, and a shooting star every sixteen seconds.",
  tokens: {
    bg: '#090a17',
    surface: '#12142a',
    'surface-2': '#1a1d3a',
    border: '#33366a',
    text: '#e8e9fb',
    'text-muted': '#9497c4',
    accent: '#4fd8e8',
    'accent-2': '#b98af0',
    success: '#4fe8a6',
    warning: '#f0c85a',
    danger: '#f2607e',
    'font-ui': "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    'font-mono': "'JetBrains Mono', Consolas, 'Courier New', monospace",
    'font-display': "'Orbitron', 'Inter', sans-serif",
    radius: '10px',
    glow:
      '0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent), 0 0 28px color-mix(in srgb, var(--accent-2) 22%, transparent)',
  },
  fontsUrl:
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Orbitron:wght@600&display=swap',
};

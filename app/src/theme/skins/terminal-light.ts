import type { Skin } from '../tokens';

export const terminalLight: Skin = {
  id: 'terminal-light',
  mode: 'paper',
  name: 'Terminal Light',
  description: "A single monospace face everywhere, with // panel titles, > prompts, and an amber accent.",
  tokens: {
    bg: '#f4f2ee',
    surface: '#faf9f6',
    'surface-2': '#ece9e2',
    border: '#cfcabf',
    text: '#232019',
    'text-muted': '#7a7568',
    accent: '#a05a00',
    'accent-2': '#4f6b52',
    success: '#3f7d4a',
    warning: '#a05a00',
    danger: '#a13a2c',
    'font-ui': "'JetBrains Mono', Consolas, monospace",
    'font-mono': "'JetBrains Mono', Consolas, monospace",
    'font-display': "'JetBrains Mono', Consolas, monospace",
    radius: '2px',
    glow: 'none',
  },
  fontsUrl: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap',
};

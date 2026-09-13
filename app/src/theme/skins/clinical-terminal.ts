import type { Skin } from '../tokens';

export const clinicalTerminal: Skin = {
  id: 'clinical-terminal',
  mode: 'paper',
  name: 'Clinical Terminal',
  description: "Terminal Light's monospace voice on Clinical's white, with a dashed rule between code and output.",
  tokens: {
    bg: '#fafaf9',
    surface: '#ffffff',
    'surface-2': '#f1f1ef',
    border: '#e1e1dd',
    text: '#17181a',
    'text-muted': '#70757b',
    accent: '#0a5cff',
    'accent-2': '#b3620d',
    success: '#1b8a5a',
    warning: '#b3620d',
    danger: '#c4202f',
    'font-ui': "'JetBrains Mono', Consolas, 'Courier New', monospace",
    'font-mono': "'JetBrains Mono', Consolas, 'Courier New', monospace",
    'font-display': "'JetBrains Mono', Consolas, 'Courier New', monospace",
    radius: '2px',
    glow: 'none',
  },
  fontsUrl: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap',
};

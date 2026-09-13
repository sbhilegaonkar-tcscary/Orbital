import type { Skin } from '../tokens';

export const retroCrt: Skin = {
  id: 'retro-crt',
  mode: 'bridge',
  name: 'Retro CRT',
  description: 'Amber phosphor with a scanline overlay and a vignette — flicker reserved for the logo.',
  tokens: {
    bg: '#050301',
    surface: '#0c0803',
    'surface-2': '#150f06',
    border: '#4a3312',
    text: '#ffb000',
    'text-muted': '#a97d3c',
    accent: '#ffcf5c',
    'accent-2': '#7dffa0',
    success: '#7dffa0',
    warning: '#ffcf5c',
    danger: '#ff6a5c',
    'font-ui': "'Share Tech Mono', Consolas, 'Courier New', monospace",
    'font-mono': "'Share Tech Mono', Consolas, 'Courier New', monospace",
    'font-display': "'VT323', 'Share Tech Mono', monospace",
    radius: '2px',
    glow: '0 0 0 1px rgba(255, 176, 0, 0.3), 0 0 14px rgba(255, 176, 0, 0.18)',
  },
  fontsUrl: 'https://fonts.googleapis.com/css2?family=VT323&family=Share+Tech+Mono&display=swap',
};

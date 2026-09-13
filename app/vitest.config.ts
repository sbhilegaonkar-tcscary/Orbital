import { defineConfig } from 'vitest/config';

// Session-layer tests talk to a real Jupyter Server over HTTP + WebSocket,
// so they run in node (with `ws` injected), not jsdom.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});

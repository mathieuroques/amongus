import { defineConfig } from 'vitest/config';
// Tests d'intégration : lancent un vrai serveur local (wrangler dev) et des clients WebSocket.
export default defineConfig({
  test: { include: ['test/integration/*.test.ts'], testTimeout: 30_000, hookTimeout: 120_000, fileParallelism: false },
});

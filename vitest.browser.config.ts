import { defineConfig } from 'vitest/config';
// Tests de bout en bout dans Chromium (écrans de téléphone) contre le serveur local.
export default defineConfig({
  test: { include: ['test/browser/*.test.ts'], testTimeout: 60_000, hookTimeout: 120_000, fileParallelism: false },
});

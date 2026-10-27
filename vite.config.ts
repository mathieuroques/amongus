import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [preact()],
  build: { outDir: 'dist', target: 'es2020', sourcemap: false },
  server: { proxy: { '/api': { target: 'http://localhost:8787', ws: true } } },
});

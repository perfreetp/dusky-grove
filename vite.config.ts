import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: {
    exclude: ['manifold-3d'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1800,
  },
  server: {
    host: '127.0.0.1',
  },
});

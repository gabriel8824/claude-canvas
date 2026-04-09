import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const CM_PKGS = [
  'codemirror',
  '@codemirror/state',
  '@codemirror/view',
  '@codemirror/commands',
  '@codemirror/language',
  '@codemirror/lint',
  '@codemirror/autocomplete',
  '@codemirror/search',
  '@codemirror/lang-javascript',
  '@codemirror/lang-json',
  '@codemirror/lang-css',
  '@codemirror/lang-html',
  '@codemirror/lang-markdown',
  '@codemirror/lang-python',
  '@codemirror/theme-one-dark',
  '@lezer/common',
  '@lezer/highlight',
  '@lezer/lr',
];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
  resolve: {
    // Force every import of these packages to resolve to the same file,
    // preventing "multiple instances of @codemirror/state" errors.
    dedupe: CM_PKGS,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  optimizeDeps: {
    include: [
      ...CM_PKGS,
      '@xterm/xterm',
      '@xterm/addon-fit',
      '@xterm/addon-web-links',
    ],
  },
});

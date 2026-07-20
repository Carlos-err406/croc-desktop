import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path, { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron/simple';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Native / runtime deps that must not be bundled into the main or preload
// output — they are resolved from node_modules at runtime (and rebuilt for
// Electron's ABI via `electron-builder install-app-deps`).
const externals = ['node-pty', 'qrcode', /\.node$/];

const aliases = {
  '@': resolve(__dirname, './src'),
  '@electron': resolve(__dirname, './electron'),
  '@utils': resolve(__dirname, './utils'),
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: { external: externals },
          },
          resolve: { alias: aliases },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          build: {
            rollupOptions: { external: externals },
          },
          resolve: { alias: aliases },
        },
      },
      renderer: process.env.NODE_ENV === 'test' ? undefined : {},
    }),
  ],
  resolve: { alias: aliases },
});

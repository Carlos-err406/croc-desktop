import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import path, { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron/simple';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// App version (from package.json) + a build timestamp, injected at build /
// dev-server-start time. The timestamp changes on every `npm run dev`, so a
// stale window is immediately obvious in the UI.
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

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
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
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

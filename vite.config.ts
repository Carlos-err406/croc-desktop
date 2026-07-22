import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import path, { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// App version (from package.json) + a build timestamp, injected at build /
// dev-server-start time. The timestamp changes on every dev start, so a stale
// window is immediately obvious in the UI.
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

const aliases = {
  '@': resolve(__dirname, './src'),
};

// Frontend-only Vite config for Tauri. The backend is Rust (src-tauri/), so the
// vite-plugin-electron main/preload builds are gone; this just produces the web
// UI in dist/, which Tauri bundles. Tauri-recommended dev-server settings below.
// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [tailwindcss(), react()],
  resolve: { alias: aliases },
  // Tauri expects a fixed dev-server port and its own clear-screen handling.
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
});

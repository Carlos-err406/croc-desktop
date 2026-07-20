import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the compiled preload script (emitted next to main.js). */
export function getPreloadPath(): string {
  return path.join(__dirname, 'preload.mjs');
}

/** Absolute path to the built renderer output (`dist/`). */
export function getRendererDist(): string {
  const appRoot = process.env.APP_ROOT || path.join(__dirname, '..');
  return path.join(appRoot, 'dist');
}

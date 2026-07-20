// node-pty ships a per-platform `spawn-helper` executable that it exec()s to set
// up the pty. Some install/extract paths drop its execute bit, which makes every
// pty spawn fail with "posix_spawnp failed". Re-assert +x wherever it lives.
import { chmodSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ptyDir = join(root, 'node_modules', 'node-pty');
const candidates = [];

const prebuilds = join(ptyDir, 'prebuilds');
if (existsSync(prebuilds)) {
  for (const dir of readdirSync(prebuilds)) {
    candidates.push(join(prebuilds, dir, 'spawn-helper'));
  }
}
candidates.push(join(ptyDir, 'build', 'Release', 'spawn-helper'));

let fixed = 0;
for (const helper of candidates) {
  try {
    if (existsSync(helper)) {
      chmodSync(helper, 0o755);
      fixed += 1;
    }
  } catch (err) {
    console.warn(`[fix-node-pty-perms] could not chmod ${helper}: ${err.message}`);
  }
}
console.log(`[fix-node-pty-perms] ensured +x on ${fixed} spawn-helper binary(ies)`);

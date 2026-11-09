/** Builds the desktop app once before the UI tests (skip with CX_E2E_NO_BUILD=1 when dist/ is fresh). */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export default function setup(): void {
  if (process.env.CX_E2E_NO_BUILD === '1') return;
  const desktop = join(dirname(fileURLToPath(import.meta.url)), '../..');
  execFileSync(process.execPath, [join(desktop, 'scripts/build.mjs')], { cwd: desktop, stdio: 'inherit' });
}

// Bundles main + preload with esbuild (workspace packages are inlined, so the packaged app
// needs no node_modules) and the renderer with Vite. Copies the print fonts.
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', sourcemap: true, external: ['electron'], logLevel: 'warning', logOverride: { 'empty-import-meta': 'silent' } };
await esbuild({ ...common, entryPoints: [join(root, 'src/main/main.ts')], outfile: join(dist, 'main/main.cjs') });
await esbuild({ ...common, entryPoints: [join(root, 'src/preload/preload.ts')], outfile: join(dist, 'preload/preload.cjs') });

await vite({
  root: join(root, 'src/renderer'),
  base: './',
  plugins: [react()],
  logLevel: 'warn',
  build: { outDir: join(dist, 'renderer'), emptyOutDir: true },
});

const require = createRequire(import.meta.url);
const fontDir = join(dirname(require.resolve('@fontsource/inter/package.json', { paths: [join(root, '../../packages/render')] })), 'files');
mkdirSync(join(dist, 'fonts'), { recursive: true });
for (const w of [400, 600, 700]) cpSync(join(fontDir, `inter-latin-${w}-normal.woff2`), join(dist, 'fonts', `inter-latin-${w}-normal.woff2`));
console.log('built desktop app → dist/');

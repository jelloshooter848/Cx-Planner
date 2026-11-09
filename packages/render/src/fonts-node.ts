/** Node-only helper: embeds the bundled Inter font as data URIs so prints never depend on system fonts. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** Directory holding the bundled Inter .woff2 files. */
export function defaultFontDir(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve('@fontsource/inter/package.json')), 'files');
}

/** @param dir pass explicitly from bundled code (e.g. the Electron main process). */
export function interFontCss(dir: string = defaultFontDir()): string {
  return [400, 600, 700]
    .map((w) => {
      const b64 = readFileSync(join(dir, `inter-latin-${w}-normal.woff2`)).toString('base64');
      return `@font-face{font-family:'Inter';font-style:normal;font-weight:${w};src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
    })
    .join('\n');
}

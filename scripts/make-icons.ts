/** Rasterise the PWA's SVG icon to the PNG sizes phones need. Usage: pnpm icons */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const svg = readFileSync('apps/field/public/icon.svg', 'utf8');
const browser = await chromium.launch();
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]] as const) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0}</style>${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}`);
  await page.screenshot({ path: `apps/field/public/${name}`, omitBackground: false });
  await page.close();
}
await browser.close();

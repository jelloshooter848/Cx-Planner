/**
 * End-to-end check of the field PWA in an emulated phone: works offline after first load,
 * imports a packet, records answers, signs, exports a results file the desktop can read.
 * Usage: pnpm --filter @cx/field build && pnpm field:e2e
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium, devices } from 'playwright';
import { latestItemValues, readResults } from '@cx/packet';

const PORT = 4179;
const server = spawn('pnpm', ['--filter', '@cx/field', 'exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
const url = `http://localhost:${PORT}/`;
const visible = (l: import('playwright').Locator) => l.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
const check = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(`FAIL: ${msg}`);
  console.log(`ok   ${msg}`);
};

try {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  const browser = await chromium.launch();
  // Phone, and iPad in both orientations (iPad is the main field device).
  for (const device of ['Pixel 7', 'iPad (gen 7)', 'iPad Pro 11 landscape']) {
    console.log(`-- ${device}`);
    const ctx = await browser.newContext({ ...devices[device], acceptDownloads: true });
    const page = await ctx.newPage();
    await page.goto(url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // now controlled by the service worker
    check(await page.evaluate(() => !!navigator.serviceWorker.controller), 'service worker controls the page');

    await page.getByRole('button', { name: 'Load sample packet' }).click();
    await page.getByRole('button', { name: /Insulation resistance/ }).click();
    const answers = ['Pass', 'Pass', 'Pass', 'Fail', 'Pass', 'N/A'];
    const answer = async (item: number, a: string) => {
      const btn = page.getByRole('group', { name: `Item ${item}` }).getByRole('button', { name: new RegExp(a) });
      await btn.click();
      await page.waitForFunction((el) => el?.getAttribute('aria-pressed') === 'true', await btn.elementHandle());
    };
    for (const [i, a] of answers.entries()) await answer(i + 1, a);
    // Change an answer: the earlier record is kept, the later one wins.
    await answer(4, 'Pass');
    await answer(4, 'Fail');

    await ctx.setOffline(true);
    await page.reload();
    check(await visible(page.getByText('P-0216').first()), 'app and stored packet load while offline');
    await page.getByRole('button', { name: /Insulation resistance/ }).click();
    await page.getByRole('button', { name: 'Review and sign' }).click();
    check(await visible(page.locator('.tile.fail b', { hasText: '1' })), 'review screen counts the failed item');
    await page.getByLabel('Initials').fill('TO');
    const pad = page.locator('.sig svg');
    const box = (await pad.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 60);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 30, { steps: 5 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Mark sheet complete' }).click();
    check(await visible(page.getByText('Signed off.')), 'sheet signed off offline');
    check(await visible(page.getByText(/not sent yet/)), 'warns about results not yet exported');

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export results/ }).click();
    const file = await (await download).path();
    const results = readResults(new Uint8Array(readFileSync(file)));
    check(results.packetId === 'P-0216', 'exported results file parses on the desktop side');
    const latest = latestItemValues(results.records);
    check(latest.size === 6 && latest.get('XFMR-1A-IR/4')?.value === 'fail', 'latest answers are correct');
    check(results.records.filter((r) => r.kind === 'item').length === 8, 'all 8 answer records kept (append-only)');
    check(results.records.some((r) => r.kind === 'signoff' && r.initials === 'TO' && r.signature), 'sign-off with signature exported');
    check(await page.getByText(/not sent yet/).waitFor({ state: 'hidden', timeout: 5000 }).then(() => true, () => false), 'unsent warning clears after export');
    await page.screenshot({ path: `spike-output/field-${device.replace(/\W+/g, '-').toLowerCase()}.png` });
    await ctx.close();
  }
  await browser.close();
  console.log('field PWA e2e: all checks passed');
} finally {
  server.kill();
}

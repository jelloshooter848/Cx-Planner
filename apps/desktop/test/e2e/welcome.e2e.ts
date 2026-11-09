import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { launchApp, type AppHarness } from './harness.js';

let h: AppHarness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const SAMPLE = 'Riverside Data Center – Bldg A (sample).cxp';

describe('welcome screen', () => {
  it('opens the sample project, then lists it as recent next to a missing file it can remove', async () => {
    h = await launchApp({ recent: [{ path: 'Moved away.cxp', openedAt: '2026-10-30T15:00:00.000Z' }] });
    const { page } = h;
    const welcome = page.getByRole('main', { name: 'Welcome' });
    await welcome.waitFor();
    const recent = welcome.getByRole('list', { name: 'Recent projects' });
    const missing = recent.getByRole('listitem').filter({ hasText: 'Moved away.cxp' });
    await missing.getByText('Not found').waitFor();
    // A missing file cannot be opened from the list, only removed.
    expect(await missing.getByRole('button', { name: /^Moved away/ }).count()).toBe(0);
    await h.screenshot('welcome-missing-recent');

    await welcome.getByRole('button', { name: 'Open sample project' }).click();
    const s = await h.waitState((x) => x.fileName === SAMPLE, 'the sample project to open');
    const file = join(h.documents, 'Cx Planner Samples', SAMPLE);
    expect(s.filePath).toBe(file);
    expect(existsSync(file)).toBe(true);
    expect(s.project!.assets.map((a) => a.tag)).toEqual(['SWGR-1A', 'SWGR-1B', 'XFMR-1A', 'XFMR-1B', 'UPS-1A', 'UPS-1B', 'GEN-1', 'GEN-2', 'ATS-1']);
    expect(s.scheduleError).toBeNull();
    await page.getByTestId('titlebar').getByText(`— ${SAMPLE}`).waitFor();
    await page.getByRole('main', { name: 'Welcome' }).waitFor({ state: 'detached' });
    // The template snapshots came with it: tasks print test sheets.
    const setup = await page.evaluate(() => window.cx.print.setup());
    expect(setup.ok && setup.value.checklistTasks.length).toBeGreaterThan(20);
    await h.screenshot('sample-open');

    await page.evaluate(() => window.cx.closeProject());
    await welcome.waitFor();
    const sampleRow = recent.getByRole('listitem').filter({ hasText: SAMPLE });
    await sampleRow.getByText(/^Today /).waitFor();
    expect(await recent.getByRole('listitem').first().textContent()).toContain(SAMPLE);
    await h.screenshot('welcome-recent');

    await missing.getByRole('button', { name: 'Remove Moved away.cxp from list' }).click();
    await missing.waitFor({ state: 'detached' });
    expect((await h.state()).recent.map((r) => r.name)).toEqual([SAMPLE]);

    // Opening the sample again asks; "Open It" keeps the copy as it is.
    await h.answerMessage(2);
    await welcome.getByRole('button', { name: 'Open sample project' }).click();
    await h.waitState((x) => x.fileName === SAMPLE, 'the existing sample to open');
  });
});

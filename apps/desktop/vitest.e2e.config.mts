import { defineConfig } from 'vitest/config';

/**
 * Desktop UI tests: drive the built Electron app with Playwright. Kept out of the root
 * `pnpm test` run (they need a display and take longer). Run with `pnpm --filter @cx/desktop e2e`.
 */
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.ts'],
    globalSetup: ['test/e2e/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // One Electron at a time keeps runs predictable on small CI machines.
    fileParallelism: false,
  },
});

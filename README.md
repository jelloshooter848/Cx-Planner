# Cx Planner

An open-source desktop app for planning and tracking electrical QA/QC, commissioning, start-up and quality management on construction projects, with a small offline field app for iPads and phones.

**Status:** M0 (foundations and risk spikes) is complete. See [docs/ROADMAP.md](docs/ROADMAP.md) for what comes next, [docs/DECISIONS.md](docs/DECISIONS.md) for the decisions made so far, and [docs/M0-REPORT.md](docs/M0-REPORT.md) for the spike results.

## Layout

```
apps/desktop    Electron app (main process owns files and printing; React renderer)
apps/field      Field PWA for iPad and phone (offline; packet files in, results files out)
packages/core   Domain model, working-day calendar, CPM scheduling engine
packages/render SVG schedule prints: one drawing for screen and PDF, any sheet size
packages/storage Project files: SQLite (node:sqlite), single-writer lock, backups, change log
packages/packet Packet (.cxpk) and results (.cxpr) file formats shared by desktop and field
packages/fixtures Made-up sample projects for tests and demos
```

## Develop

Requires Node 22+ and pnpm 10.

```bash
pnpm install
```

```bash
pnpm test
```

```bash
pnpm lint && pnpm typecheck
```

```bash
pnpm dev:desktop
```

```bash
pnpm dev:field
```

Render the sample prints to `spike-output/` (needs Playwright's Chromium):

```bash
pnpm print:samples
```

Run the desktop spike checks (SQLite, the project session and PDF output through Electron):

```bash
pnpm --filter @cx/desktop smoke
```

Desktop UI tests (`apps/desktop/test/e2e/*.e2e.ts`) build the app once, then drive Electron with Playwright: welcome screen, new project, menus, undo/redo, views. Each test gets a throwaway profile and workspace, and opens a temp project made from the sample fixtures when it needs one (see `test/e2e/harness.ts`). Screenshots go to `spike-output/desktop-e2e/` (or `$CX_E2E_SHOTS`). They are not part of `pnpm test`. The script runs them under `xvfb-run -a` (Linux without a display):

```bash
pnpm desktop:e2e
```

On a machine with a display, run them directly with `pnpm --filter @cx/desktop exec vitest run -c vitest.e2e.config.mts`. Set `CX_E2E_NO_BUILD=1` to skip the build when `dist/` is fresh.

Desktop renderer layout (`apps/desktop/src/renderer`): `store.ts` holds the state pushed by the main process plus UI state, read through `useProject()`, `useSchedule()`, `useCommand()` and friends; every menu item, shortcut and button goes through `store.dispatch(action)`. Views live in `views/<ViewName>/`, shared pieces in `components/`, dialogs in `dialogs/`. Colours, type and sizes are tokens in `tokens.css`.

The desktop app opens `.cxp` files given on the command line. Set `CX_USER_DATA` to run it with a throwaway profile (settings and recent list).

## Licence

Apache-2.0. All names, tags, dates and people in the sample data and mockups are made up.

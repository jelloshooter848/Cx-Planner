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

Run the desktop spike checks (SQLite and PDF output through Electron):

```bash
pnpm --filter @cx/desktop smoke
```

## Licence

Apache-2.0. All names, tags, dates and people in the sample data and mockups are made up.

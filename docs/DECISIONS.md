# Decisions

Each entry: the decision, why, and what would make us revisit it.

## D1 · Project file is SQLite, through Node's built-in `node:sqlite` (2026-11-09)
- One `.cxp` file per project. A workspace folder holds shared data (roster, certifications, instruments, templates).
- **Changed during M0:** the roadmap said `better-sqlite3`. Electron 45 ships Node 24 with SQLite 3.53 built in, so the app needs **no native module**. That removes the riskiest part of Windows packaging (rebuilding native code for Electron's ABI) and lets tests run on plain Node 22.
- `node:sqlite` is still labelled experimental by Node. All access goes through `packages/storage`, so swapping to `better-sqlite3` later is contained to one package.
- Rollback journal (`journal_mode=DELETE`), not WAL, because WAL needs shared memory that network shares don't provide.
- `PRAGMA application_id = 'CXP1'` marks project files; `user_version` drives migrations; `quick_check` runs on open.
- Revisit if: `node:sqlite` changes API incompatibly or Electron drops it.

## D2 · Single writer per project, enforced by a lock file (2026-11-09)
- `<file>.cxp.lock` records host, user, PID and time. A second session is refused with "open by X on Y since Z".
- A lock left by a crashed process on the same machine clears itself. A lock from another machine needs the user to confirm "open anyway".
- A copy goes to `.cx-backups/` beside the project on every open (newest 10 kept). Revisit if project files grow large enough (photos) that this is slow; then back up at most daily.

## D3 · Append-only change log from day one (2026-11-09)
- Every edit writes a `change_event` row (old value, new value, source). Triggers block UPDATE and DELETE on that table.
- It powers undo, issue history, "changed since last print", import diffs and field-record merges.

## D4 · Templates: library in the workspace, snapshot copied into the project (2026-11-09)
- Keeps each project file portable; "re-apply to existing assets" is an explicit action.

## D5 · Prints are SVG laid out in CSS inches, rendered by Chromium (2026-11-09)
- `packages/render` produces SVG sheets at the physical sheet size; the desktop app prints them with Electron's `printToPDF` using the CSS `@page` size. The same SVG is shown on screen.
- Fonts (Inter, OFL) are embedded in every PDF, so output never depends on the fonts installed on a machine.
- Large schedules split across sheets in both directions (rows and time), with title, revision block, column headers and legend repeated on every sheet.

## D6 · Field app targets iPad first (2026-11-09)
- iPad is the most likely field device. The PWA uses a two-pane layout from 744 px wide (all iPads, both orientations) and a single pane on phones.
- Packets and results move as files (share sheet, email, AirDrop, USB, shared drive). No server in v1.
- Results are append-only records with strictly increasing timestamps; the latest answer wins and earlier answers are kept.

## D7 · Licence Apache-2.0 (2026-11-09)

## D8 · TypeScript 6.x (2026-11-09)
- TypeScript 7 is out, but typescript-eslint doesn't support it yet. Revisit when it does.

## D9 · Manpower vs. plan uses hand-entered actuals (2026-11-09)
- Actual hours are typed in per person, week and cost code. No timesheet import in v1.

## D10 · GC schedule: manual milestones, optional file import (2026-11-09)
- Each project can hold hand-entered GC milestones that tasks link to. Importing MS Project XML, P6 XER or CSV is optional, for GCs that provide a native file.

## D11 · Build process: one milestone per run, agent build/review/fix loop (2026-11-09)
- Each milestone is split into small tasks. Every task is built by one agent, reviewed independently by another, and fixed until the review passes and the checks are green. No more than about 10 agents run at once.
- The run stops after each milestone so the owner can try it before the next one starts.

## D12 · Look-ahead window trims edge holidays (2026-11-09)
- A look-ahead runs from the Monday of the data-date week to the Friday of the last week, but a holiday on either edge is trimmed so the window starts and ends on working days (Labor Day gives a Tuesday start; Thanksgiving Friday gives a Wednesday end when Thursday is also off).
- The sheet title shows those first and last working days, so it always matches the dates on the grid.

## D13 · Save As makes a new project (2026-11-09)
- A Save As copy gets a new project id, saved as a logged change in the copy. The original file keeps its id. Two files never share one project identity, so later field sync and packet matching can key on the project id.
- The copy keeps the original's change log, so its history still shows where it came from.

# M0 report: foundations and risk spikes

M0's job was to prove the three riskiest pieces before building screens on them. Everything below runs in CI (`.github/workflows/ci.yml`) on Linux, and the desktop checks also run on Windows.

## Spike 1 · Paginated schedule prints → PDF: **passed**

| Print | Sheets | Notes |
|---|---|---|
| 3-week look-ahead, Tabloid | 1 | Matches mockup board 3: TIMES columns, holds, witness, milestones, data-date line, legend, revisions, field notes |
| 3-week look-ahead, Letter | 2 | Drops the Responsible column, legend wraps; continued asset groups marked "(cont.)" |
| Full schedule (215 tasks), ANSI D | 10 | 5 row bands × 2 time bands; headers and table repeat on each sheet |
| Full schedule, ARCH D | 10 | Same, 24×36 in |

- Electron `printToPDF` and headless Chromium produce the exact physical page sizes (e.g. ANSI D = 2448 × 1584 pt).
- Inter is embedded in every PDF (`pdffonts` shows all faces embedded).
- Bug found and fixed: printing through a `data:` URL fails for large-format documents; prints now go through a temp file.
- **Still to confirm by you:** print one look-ahead on your office printer and one ANSI D sheet on the plotter. Download the PDFs from the CI run's `prints-windows` artifact.

## Spike 2 · SQLite in Electron on Windows: **passed (pending the first Windows CI run)**

- `node:sqlite` works inside Electron 45 (Node 24.22, SQLite 3.53.4). No native module to package; see decision D1.
- Create, save, reopen, lock, backup, integrity check, migrations and the append-only change log are all tested (`packages/storage/test`).
- The second-writer refusal works within one machine and across machines (lock file).
- **Still to confirm by you:** open a project from your shared drive on two PCs at once and check the second one is refused with a clear message (that needs the M1 open-file UI).

## Spike 3 · Field PWA offline on iPad: **passed in emulation; needs a real iPad**

Automated (Chromium emulating Pixel 7, iPad gen 7 portrait and iPad Pro 11 landscape):
- Installs its service worker and reloads with no network.
- Imports a packet, records answers, changes an answer (both records kept, latest wins), signs with a drawn signature, all offline.
- Warns while results haven't been exported; exports a `.cxpr` file the desktop code reads back correctly.

Emulation can't prove Safari-specific behaviour. Run the checklist in [IPAD-TEST.md](IPAD-TEST.md) on a real iPad.

## Also delivered
- pnpm monorepo, TypeScript, ESLint, Prettier, Vitest (33 tests), CI on Linux and Windows, Apache-2.0 licence.
- CPM scheduling engine: working-day calendar with holidays, FS/SS/FF/SF links with lag, start-no-earlier-than, progress-aware scheduling from the data date, total float and critical path.
- Sample data: the mockups' Riverside project and a 215-task generator.

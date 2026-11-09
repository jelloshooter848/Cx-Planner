# Cx Planner: build plan and roadmap

This plan is built from `docs/design/HANDOFF.md` and the 39 mockups in `docs/design/mockups/`. Numbers in square brackets, such as [19], are mockup board numbers.

---

## 1. Decisions to settle before writing code

| Question | Recommendation | Why |
|---|---|---|
| SQLite or JSON project file | **SQLite**, one `.cxp` file per project, through Node's built-in `node:sqlite` (changed from `better-sqlite3` in M0, see `docs/DECISIONS.md` D1). Add a JSON export for backup and diffing. | It's one portable file and writes are transactional, so a crash can't half-save the file. It handles thousands of material lines and append-only field records easily, and it can query the rollups. A JSON file would have to be rewritten on every save and is easy to corrupt. |
| Photos and binary files | Store photos **inside** the `.cxp` as resized JPEGs plus thumbnails. Keep documents as **links** (as the handoff says). | This keeps the project to one file. Resizing to about 2,000 px keeps a job with thousands of photos to a few GB. |
| Workspace | A folder holding `workspace.cxw` (SQLite) for the roster, certifications, instruments and template library. Projects refer to people and instruments by stable UUIDs. | The dashboard [38] and staffing across projects need one shared source. |
| Templates: workspace or project? | The library lives in the workspace. **Applying a template copies a snapshot of it into the project.** | Board [2] says the library is "stored with the project file", while the handoff puts it in the workspace. A snapshot keeps a project file portable and makes "re-apply to existing assets" an explicit action. |
| Licence | **Apache-2.0** (MIT works just as well). Decide before the first public push. | Apache-2.0 includes an explicit patent grant and costs nothing extra. |
| Name | Keep "Cx Planner" and the `.cxp` extension as the working name. Choose the final name before the first public release. | Renaming later only touches strings, the installer ID and the file extension. |
| Samples needed from you | Submittal log export, timesheet CSV, the Excel order form's columns, a GC schedule (MSP XML, P6 XER or CSV), and 2 or 3 real test or checklist forms. | Each of the import formats in milestones M3, M6 and M8 needs a real file to build against. |

> **Status (2026-11-09):** decisions above are confirmed. M0 is done: see `docs/M0-REPORT.md`. The field app now targets **iPad first** (decision D6).

> **Note:** the HTML mockups load `./support.js`, which isn't in the handoff zip, so they may not render fully. The PNGs are the reference.

---

## 2. Architecture

A pnpm monorepo in TypeScript:

```
apps/
  desktop/        Electron: main process (owns the DB and file I/O) + React renderer
  field/          Field PWA (Vite + React, offline, IndexedDB)
packages/
  core/           Domain model, scheduling engine (CPM), rollups, validation. Pure TS, no I/O.
  storage/        SQLite schema, migrations, repositories, change log
  render/         SVG Gantt + print page layouts (shared by screen and PDF)
  packet/         Packet / result file format (zod schemas, versioned), shared by desktop + PWA
  ui/             Shared components: TIMES symbols, status chips, gate dots, tables
  importers/      CSV mapping profiles, MSP XML, P6 XER, timesheet, submittal log
```

Principles that run through the whole build:

- **Keep the domain logic in `core`, pure and fully unit-tested**: scheduling, float, rollups, gate logic and certification checks. The UI only displays what `core` calculates. This is how "every rollup is computed, nothing is entered twice" is enforced.
- **Add a change log from day one.** Write every change as an append-only event (entity, field, old value, new value, time, source) next to the current-state tables. The event log is what makes these features work:
  - undo and redo (the toolbar on [1])
  - issue history [26]
  - "changed since last print" [29]
  - re-import diffs [31]
  - field results arriving as append-only records.
- **Use one print pipeline.** Each print page is a React component sized for a physical sheet. Electron's `printToPDF` turns it into a PDF with custom page sizes: Letter, Tabloid, ANSI D (22×34) and ARCH D (24×36). Every page uses the same title block, revision block and repeating headers.
- **Never rely on colour alone.** Every status has a symbol in `packages/ui`, and print tests run in grayscale.
- **Use a print scope for shared output.** Every print declares which data it may show. Private fields, such as leave reasons and other projects' names, are left out by the query layer itself, not merely hidden by the page.
- **Harden Electron:** `contextIsolation` on, no Node in the renderer, and a typed IPC API between the renderer and main process.
- **Testing:**
  - Vitest for `core`, `storage` and `importers`
  - Playwright for Electron end-to-end tests
  - **PDF snapshot tests** for every printed form. Printed output is the product, so it gets regression tests.
- **Use a sample project.** The made-up mockup data becomes a seed fixture used in tests, demos and screenshots.

### Core data model (first cut)

- **Workspace:**
  - Person (named or open seat)
  - Certification
  - Instrument and calibration
  - Template (tasks, stages, test/form types, checklist items, notice lead times, required certifications, required turnover documents)
  - CostCode
- **Project:**
  - Project, Calendar (workdays and holidays), System/Area, Asset (with stage and equipment fields), Task (type: task, hold, witness or milestone), Dependency (FS/SS/FF/SF with lag)
  - ReadinessItem (task × T/I/M/E/S, with state and detail lines)
  - TestForm and TestResult (with instrument)
  - Photo (with links), DocumentLink
  - Issue, Inspection
  - Submittal, Order and OrderLine, Lot, SubLot, MaterialLine with gate events
  - Packet
  - Assignment (person × task/day × hours × cost code), TimesheetActual
  - Baseline, GCMilestone, PrintRecord, ChangeEvent

---

## 3. Roadmap

Milestone sizes are rough guesses in focused developer-weeks. Each milestone ends with something you can use on a live job.

### M0 · Foundations and risk spikes (~2 wks)
Prove the three riskiest pieces before building screens on top of them:
1. **Paginated SVG Gantt to PDF.**
   - Render a 3-week look-ahead on Tabloid, and a 200-task schedule on ANSI D that splits across pages in both directions with headers repeated.
   - Confirm the output is identical on two Windows machines.
2. **SQLite in Electron.**
   - Package `better-sqlite3` for Windows with electron-builder.
   - Test opening a project from a shared drive with a lock file and a backup copy made on open. SQLite over SMB is only safe for a single user, so the app must refuse a second writer.
3. **PWA on iOS and Android.**
   - Install the app, import a packet file through the file picker, work offline, and export a results file through the share sheet.
   - Test whether storage survives. Safari can clear storage for sites that aren't installed, so the PWA must be installed to the home screen and request persistent storage.

Also in M0: repo scaffold, CI (lint, typecheck, tests, Windows build), licence, and the sample-data fixture.

### M1 · Core: schedule, templates, look-ahead print (~6–8 wks) [1, 2, 3, 4, 5, 13]
- Project and workspace files, migrations, autosave, undo/redo, backups.
- Template editor [2] covering tasks, durations, predecessors, types and checklist items. Ship the 8 starter templates.
- Add assets from a template [5].
- Scheduling engine:
  - workday calendar
  - CPM forward and backward pass
  - float and critical path
  - holds, witness points and milestones.
- Gantt view [1]:
  - assets grouped
  - day, week and month zoom
  - edit panel, linking and indenting
  - asset filter.
- Simple progress entry (actual dates and % complete). The full weekly-update screen comes in M7, but progress has to be recorded from the first week.
- Printing: 3-week look-ahead [3] on Letter or Tabloid, full schedule [13] on ANSI D or ARCH D, and test sheets [4] built from template checklists. Each print saves a PrintRecord with its revision.

**Done when:** you can set up a real job, keep its schedule, and hand the field a revisioned look-ahead and blank test sheets every week.

### M2 · Assets and readiness (~4–5 wks) [11, 12, 14, 23, 24, 25]
- TIMES readiness [11]: five states with symbols and detail lines. Add the TIMES columns to the Gantt and the print, plus the hover preview [14].
- Asset register [23] and asset detail [24]:
  - stage tracker
  - mini Gantt
  - document links
  - equipment and nameplate data
  - progress photos with the EXIF date (`exifr`).

  The detail page is built with empty sections that later milestones fill: tests, issues and lots.
- Printed asset status sheet [25].
- Procurement export [12]: order rows in the order form's columns (Part #, Description, Quantity, UOM, Commodity Code / PO), copied to the clipboard or saved as CSV for pasting.
  - **Parts catalog:** read (never written) from the company workbook's *Item Master* sheet, about 11,600 parts with part number, description, category, UOM and UPC. CSV import also works.
  - **Commodity code** defaults from the part number (`AS-MA-01606` → MA). Custom items without a part number pick a code by hand.
  - The real workbook holds names and contact details, so it is never committed; tests use a made-up workbook in the same layout.
- Baselines (snapshot and slip in workdays). They're cheap to add here, and capturing a baseline early on a job is worth a lot later.

**Done when:** the look-ahead shows what is blocking each task, and you can raise orders straight from it.

### M3 · Materials and submittals (~5–6 wks) [18, 19, 20, 21, 22]
- Submittal log CSV import with a saved column mapping per project. Re-imports match on submittal number plus revision.
- Order review [18]: compare each line against its submittal and mark it Matches or Differs. Reference photos can be uploaded or cropped from the submittal PDF (render it with `pdf.js` and crop).
- Material register [19]: lots, user-named sub-lots and the 6 gates. Mismatches block release. Status filters.
- **Pre-inspection [20, 21], desktop entry first.** Print a pre-inspection form from the expected list, then enter the results on the desktop with sign-off. The phone version follows in M5, so this milestone doesn't wait on the PWA.
- Inspector check sheet [22], grouped by sub-lot with a submittal quick reference and no photo. Release tags. Receiving log.
- Test performance with about 3,000 lines across several projects.

**Done when:** every material line on a job can be traced from submittal to release, with printed check sheets for the inspector.

### M4 · Issues and inspections (~3–4 wks) [26, 27, 28]
- Issues log: NCRs, deficiencies, punch items and open items, each with an asset, photos, history and an assignee.
- **An issue can hold a task**, and the scheduling engine takes that hold into account.
- Closing an issue requires a re-test and a QC verification.
- Inspection requests for AHJ, third-party, owner and CxA:
  - notice lead time comes from the template
  - each request links to its hold or witness task
  - a failed or partial result creates a re-inspection.
- Printed punch list [28].
- The asset detail page now shows real issues, and the status sheet now shows real open items.

### M5 · Field PWA and packets (~5–6 wks) [6, 7, 8, 9, 10, 20, 21]
- Versioned packet format in `packages/packet`:
  - `.cxpk` going out: a zip holding the checklists, reference photos and a manifest
  - `.cxpr` coming back: append-only records with stable IDs, so importing the same file twice does no harm.
- Desktop: create a packet [7], packet register [6], and import results with a review and accept step.
- PWA:
  - packet list [8], checklist [9], review and sign [10] (initials, drawn signature, timestamp)
  - photos
  - pre-inspection on the phone [20, 21]: match against the submittal first, then the count.
- Failed checklist items become draft issues. Test results record the instrument used, which feeds M6.
- Host the PWA as static files (GitHub Pages works). No server is needed.

### M6 · Resources (~4–5 wks) [15, 16, 17, 32, 33, 36]
- Workspace roster with named people and open seats. Assignments are hours per day with a cost code.
- Team view [15], demand view [16], and a printable manpower look-ahead [17] that uses the print scope, so leave reasons never appear.
- Certifications [33] with expiry dates. Warn when an assigned person lacks a certification the template requires, or when it expires before the task ends.
- Instruments [32]: calibration, certificates and check-out. Flag any test recorded with an instrument whose calibration had expired.
- Timesheet CSV import (mapping profile) and manpower vs. plan [36].

### M7 · Schedule control (~3–4 wks) [29, 30, 31]
- Weekly update screen [30].
- Baseline comparison view [29].
- "Changed since last print" log, read from the change log against the last PrintRecord. It can be printed on the next look-ahead.
- GC schedule import [31] from MSP XML, P6 XER or CSV:
  - read-only milestones linked to your tasks as constraints
  - re-importing shows what moved.

### M8 · Reports, dashboard and turnover (~4–5 wks) [34, 35, 37, 38, 39]
- Weekly QA/QC report [34], test matrix by system [35], and daily log with photos [37].
- Workspace dashboard [38]: reads every project in the workspace and shows needs-you-now items, holds and witness points, staffing gaps, and expiring certifications and calibrations.
- Turnover builder [39]:
  - grid of assets against required documents
  - one bookmarked PDF with placeholder pages for missing items and an open-items list
  - a zip of the source files.

  Use `pdf-lib` for merging. Its outline/bookmark support is low-level, so spike it early in M8.

**Total: about 40–50 focused weeks** for one developer. M1 alone is a useful v0.1 release.

---

## 4. Changes from the handoff's suggested order

1. **Add M0 for spikes.** Gantt pagination, native SQLite packaging and iOS PWA storage are the three things most likely to force a redesign.
2. **Move progress entry and baselines earlier** (M1 and M2). You'll update progress from the first week on a real job, and a baseline can't be captured after the fact.
3. **Do desktop pre-inspection in M3.** In the original order, M3 depends on the phone app from M5. Starting with a printed form and desktop entry removes that dependency.
4. **Split milestone 7** into schedule control (M7) and reports and turnover (M8), so each part ships separately.
5. **Build the change log and print records in M1.** Undo, history, "changed since last print", re-import diffs and field records all depend on them, and adding them later would mean a data migration.

## 5. Risks to watch

| Risk | Mitigation |
|---|---|
| Large-format Gantt pagination looks poor or varies between machines | Spike it in M0, run PDF snapshot tests, and bundle the fonts instead of using system fonts |
| SQLite file on a network share gets corrupted | Lock file to allow one writer, back up on open, and suggest working from a local copy |
| iOS clears PWA data before results are exported | Require home-screen install, request persistent storage, and show a warning for results not yet exported |
| P6 XER and MSP XML vary widely | Need real sample files; import milestones only (not full logic) in v1 |
| 39 screens is a lot of surface | Keep each milestone shippable and resist building any screen before its data exists |
| Windows SmartScreen warns on unsigned installers | Budget for a code-signing certificate before sharing the app beyond yourself |

## 6. Immediate next steps

1. Confirm the decisions in section 1, especially SQLite and the template snapshot model.
2. Send the sample files: submittal log, timesheet, order form, GC schedule, a test form.
3. Start M0: scaffold the monorepo and run the three spikes.

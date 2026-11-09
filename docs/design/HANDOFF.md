# Cx Planner: handoff from the design phase

Working name: **Cx Planner**. An open-source desktop app for planning and tracking electrical QA/QC, commissioning, start-up and quality management on construction projects.

This file records the decisions made while mocking up 39 screens. The mockups are in `mockups/`: start with `mockups/INDEX.md` and the PNGs in `mockups/screenshots/`. All names, tags, dates, vendors, submittal numbers and people in the mockups are made-up sample data.

## Who uses it and how

- **Primary user:** the owner of this repo, a QA/QC and construction manager on electrical projects. They run a quality team of fewer than 20 people, shared across projects.
- **Desktop only.** It runs on a PC in the office and is not used in the field. Its output is paper prints or PDFs shared with the field.
- **The field companion** is a separate small PWA for filling in checklists and forms on a phone or tablet (see Packets).
- **Only the owner sees the desktop app.** Anything shared goes out as a print or PDF, and shared prints must not expose private data such as leave reasons or other projects' details.

## Tech decisions

- **App:** Electron, React and TypeScript, chosen for consistent PDF and print output across machines.
- **Storage:** each project is one portable file, either SQLite or JSON (still to decide). A **workspace** folder holds things shared across projects: the roster, certifications, instruments, and templates.
- **Gantt:** a custom SVG renderer, so the same drawing goes to the screen and to the PDF.
- **Licence:** Apache-2.0 or MIT (still to decide).
- **Field PWA:** works offline, transfers **packet files** (by email, USB or shared drive), and stores results as append-only records. An optional sync server could come later, but not in v1.

## Feature areas (mockup board numbers in brackets)

### Schedule and printing [1, 3, 13, 14]
- **Gantt view:** assets are grouped, with tasks, holds, witness points, milestones and the critical path. The 3-week look-ahead is the main working view.
- **Printing:** the look-ahead prints on Letter or Tabloid; the full schedule prints large format (ANSI D/ARCH). Headers repeat on every page and each sheet has title and revision blocks.
- **Grayscale-safe symbols:** status never depends on colour alone.
- **Hover preview** on a task row shows its readiness at a glance.

### Templates [2, 5]
- Editable starter templates: LV switchgear, MV switchgear, transformer, panelboard, generator, ATS, UPS, generic ITP.
- A template generates the tasks for each asset. Users can edit templates, "save as template", and re-apply a template to existing assets.
- Each template also defines:
  - the asset's install stages
  - required test and form types
  - inspection notice lead times
  - certifications required per task
  - the turnover documents required.

### Readiness: TIMES [11, 14]
- Every task tracks five items: **T**ools, **I**nformation, **M**aterials, **E**xpectations, **S**afety.
- Each item has one of five states, each with its own symbol: Ready (filled circle), In progress or on order (half circle), Needed (open circle), N/A (dash), Blocked ("!" square).
- Each item can hold detail: material and tool lists; drawings, submittals and specs; safety documents (PTP, JHA, permits); and the expected scope of work.

### Procurement export [12]
- Builds an order from a task's materials and tools.
- Exports rows in the same columns as the owner's Excel order form, so they can be pasted in: Part #, Description, Quantity, UOM (EA, LF, MO, LS), Commodity Code-PO.
- Commodity codes: MA, CO, TO, EQ, PF, RL, SA, PH.
- **It does not write into the owner's .xlsm.** The parts catalog is supplied by the user, not bundled with the app.

### Field packets and the PWA [6–10]
- The register records what was exported, to whom, when, the target completion date, and its status.
- Phone screens: the packet list, the checklist, then review and sign.

### Manpower [15–17, 33, 36]
- The roster belongs to the workspace and holds named people plus **open seats** (placeholders).
- Assignments are in hours per day, with a **cost code** (sample codes: QA-110 Inspection, QA-120 Testing, QA-130 Commissioning, QA-140 Documentation, QA-150 Management).
- Views: a team view (people by week), a demand view (people needed vs. available), and a printable, shareable 3-week manpower look-ahead.
- Certifications are stored per person with expiry dates. Templates can require a certification for a task, and the app warns when someone assigned lacks it or it expires before the task ends.
- Manpower vs. plan compares planned hours with actual hours imported from a timesheet CSV.

### Material ID [18–22]
Every material must be reviewed against its submittal, pre-inspected by QC, and then inspected by the onsite inspector before it can be installed. The gates are:

1. Submittal approved
2. Order reviewed
3. Delivered
4. Pre-inspected (QC sign-off)
5. Inspected: accept, accept with comments, reject, or hold
6. Released for install

Details:
- **Order review:** each order line is checked against its submittal, comparing what the order says with what the submittal says. A line marked "Differs" is held off the expected list until it's resolved. You can attach a **reference photo** to a line (upload one, or crop it from the submittal PDF).
- **Submittal log:** imported from CSV, with a saved column-mapping profile per project. Re-imports match on submittal number plus revision.
- **Delivery lots:** each lot can hold optional **user-named sub-lots** (by type, floor, crew, and so on). Each line belongs to one sub-lot.
- **Pre-inspection (phone):** **matching to the submittal comes first.** The QC person answers Yes or No for manufacturer, catalog number and listing mark, compares against the reference photo, then enters a count. Sign-off records who did it and when.
- **Mismatches block release** until they're resolved.
- **Inspector check sheet:** generated from the expected list plus the pre-inspection results, grouped by sub-lot, with a submittal quick reference on each line. It has **no photo.**
- **Volume:** hundreds to low thousands of lines across projects.

### Assets [23–25]
- **Asset register:** rollup columns for install stage, next task, finish date, float, in-look-ahead, materials, submittal, tests and open issues.
- **Asset detail page:**
  - stage tracker
  - mini Gantt with the look-ahead shaded
  - look-ahead tasks with their TIMES status
  - tests and forms
  - **progress photos:** tagged to a stage, linkable to a test, issue, lot or task, with the date read from the photo
  - issues
  - documents: **links to files, not copies**
  - equipment and nameplate data, with the delivery lot it came in
- **Printed one-page asset status sheet:** black and white, with signatures. It doubles as the turnover cover page.
- Every rollup is computed from the underlying records; nothing is entered twice.

### Quality [26–28]
- **Issues log:** NCRs, deficiencies, punch items and open items. Each has an asset link, photos, history and an assignee. An issue can **hold a task**. Closing it needs a re-test and a QC verification.
- **Inspection requests:** AHJ, third-party, owner and CxA. Notice lead times come from the template. Requests tie to hold and witness tasks, and failed or partial results create a re-inspection.
- **Printed punch list.**

### Schedule control [29–31]
- Baselines, with slip measured in workdays.
- **Import the GC schedule** (MS Project XML, P6 XER or CSV) as read-only milestone constraints, linked to your tasks. Re-importing shows what moved.
- **Weekly update screen:** actual dates and % complete for look-ahead tasks.
- **"Changed since last print" log**, which can be printed on the next look-ahead.

### Instruments [32]
- The workspace-wide instrument list tracks calibration dates and certificates, plus check-out.
- Each test result records the instrument used. The app flags any test recorded with an instrument whose calibration had expired.

### Reports [34–37]
Weekly QA/QC report (Letter), test status matrix by system, manpower vs. plan, and daily log (Letter, with photos).

### Workspace and turnover [38, 39]
- **Workspace dashboard** across all projects: a "needs you now" list, hold and witness points, staffing gaps, and expiring certifications and calibrations.
- **Turnover package builder:** a grid of assets against required documents shows what's missing. It builds one bookmarked PDF with placeholder pages for missing items and an open-items list, plus a zip of the source files.

## Suggested build order

1. **Core:** data model, project and workspace files, templates, Gantt, look-ahead printing.
2. **Assets and readiness** (TIMES), plus the procurement export.
3. **Materials and submittals** (material ID).
4. **Issues and inspections.**
5. **Field PWA and packets.**
6. **Resources:** roster, assignments, certifications, instruments.
7. **Schedule control, reports and turnover.**

Each milestone should leave something usable on a real job.

## Open questions

- SQLite or JSON for the project file.
- Apache-2.0 or MIT.
- Final product name.
- Exact formats of the owner's submittal logs and timesheet exports (ask for samples).

/** "CXP1" — marks the SQLite file as a Cx Planner project (PRAGMA application_id). */
export const APPLICATION_ID = 0x43585031;

/** Each entry migrates user_version i -> i + 1. Never edit a shipped migration; add a new one. */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE calendar_holiday (date TEXT PRIMARY KEY);
  CREATE TABLE asset (
    id TEXT PRIMARY KEY,
    tag TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    location TEXT,
    system TEXT,
    template_id TEXT,
    sort INTEGER NOT NULL
  );
  CREATE TABLE task (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('task','hold','witness','milestone')),
    duration_days INTEGER NOT NULL CHECK (duration_days >= 0),
    percent_complete REAL NOT NULL DEFAULT 0 CHECK (percent_complete BETWEEN 0 AND 100),
    responsible TEXT,
    start_no_earlier_than TEXT,
    actual_start TEXT,
    actual_finish TEXT,
    readiness TEXT,
    sort INTEGER NOT NULL
  );
  CREATE INDEX task_asset ON task(asset_id);
  CREATE TABLE dependency (
    predecessor_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
    successor_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('FS','SS','FF','SF')),
    lag_days INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (predecessor_id, successor_id)
  );
  -- Append-only history: undo, issue history, "changed since last print", import diffs.
  CREATE TABLE change_event (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    source TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    field TEXT,
    old_value TEXT,
    new_value TEXT
  );
  CREATE INDEX change_event_entity ON change_event(entity, entity_id);
  CREATE TRIGGER change_event_no_update BEFORE UPDATE ON change_event
    BEGIN SELECT RAISE(ABORT, 'change_event is append-only'); END;
  CREATE TRIGGER change_event_no_delete BEFORE DELETE ON change_event
    BEGIN SELECT RAISE(ABORT, 'change_event is append-only'); END;
  CREATE TABLE print_record (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    rev TEXT NOT NULL,
    issued TEXT NOT NULL,
    printed_at TEXT NOT NULL,
    paper TEXT NOT NULL,
    sheets INTEGER NOT NULL,
    data_date TEXT NOT NULL,
    last_change_seq INTEGER NOT NULL
  );
  `,
  // 1 -> 2: remember which template snapshot and template task each asset and task came from.
  `
  ALTER TABLE asset ADD COLUMN template_version INTEGER;
  ALTER TABLE task ADD COLUMN template_key TEXT;
  `,
  // 2 -> 3: task notes, and the template snapshots copied into the project (decision D4).
  // Revision state lives in meta under the keys in REVISION_META_KEYS; no table needed.
  // Links and holidays keep the order they were saved in (rows from older files share
  // sort 0 and fall back to insertion order).
  `
  ALTER TABLE task ADD COLUMN notes TEXT;
  ALTER TABLE dependency ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE calendar_holiday ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;
  -- Events written by one save share its revision number and summary (undo, history).
  ALTER TABLE change_event ADD COLUMN revision INTEGER;
  ALTER TABLE change_event ADD COLUMN summary TEXT;
  CREATE TABLE project_template (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    json TEXT NOT NULL
  );
  `,
];

/** Meta keys that hold the project's own fields (written by replaceProject/saveProject). */
export const PROJECT_META_KEYS = ['id', 'name', 'subtitle', 'start_date', 'data_date', 'work_weekdays'] as const;

/** Meta keys that track saved revisions of the file (never part of the Project value). */
export const REVISION_META_KEYS = {
  /** Integer bumped by every write that changes the project. */
  revision: 'revision',
  /** ISO timestamp of the last write that changed the project. */
  savedAt: 'saved_at',
} as const;

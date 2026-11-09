/** "CXW1": marks the SQLite file as a Cx Planner workspace (PRAGMA application_id). */
export const WORKSPACE_APPLICATION_ID = 0x43585731;

/** File name of the workspace database inside a workspace folder. */
export const WORKSPACE_FILE_NAME = 'workspace.cxw';

/**
 * Each entry migrates user_version i -> i + 1. Never edit a shipped migration; add a new one.
 * One table per workspace entity (template now; person, certification, instrument later),
 * all sharing the meta table and the append-only change_event log.
 */
export const WORKSPACE_MIGRATIONS: string[] = [
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  -- Template library. Name, kind and version are columns for listing; the rest of the
  -- template (description, stages, tasks, documents) is JSON in body. A deleted template
  -- keeps its row (deleted_at set) so its id and version are never reused.
  CREATE TABLE template (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('starter','custom')),
    version INTEGER NOT NULL CHECK (version >= 1),
    body TEXT NOT NULL,
    sort INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  -- Append-only history, as in project files.
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
  `,
];

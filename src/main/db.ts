import { DatabaseSync } from 'node:sqlite'
import type { DatabaseStatus } from '../shared/api'

const SCHEMA = `
  CREATE TABLE app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE libraries (
    id           INTEGER PRIMARY KEY,
    name         TEXT    NOT NULL,
    root_path    TEXT    NOT NULL,
    created_at   INTEGER NOT NULL,
    last_scan_at INTEGER,
    -- Set when the user removes the library but keeps its keywords;
    -- adding the same folder again clears it.
    removed_at   INTEGER
  );

  CREATE TABLE folders (
    id                  INTEGER PRIMARY KEY,
    library_id          INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    parent_id           INTEGER REFERENCES folders(id) ON DELETE CASCADE,
    rel_path            TEXT    NOT NULL,
    name                TEXT    NOT NULL,
    -- Gone from disk, kept by a rescan for its keywords or for the keywords
    -- of missing files inside it (LIB-5, FKW-6). Hidden from the tree.
    missing             INTEGER NOT NULL DEFAULT 0,
    -- For a missing folder: where most of its files moved, offered for its keywords.
    suggested_folder_id INTEGER,
    UNIQUE (library_id, rel_path)
  );
  CREATE INDEX folders_parent ON folders(parent_id);

  CREATE TABLE files (
    id          INTEGER PRIMARY KEY,
    folder_id   INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    ext         TEXT    NOT NULL,
    size        INTEGER NOT NULL,
    mtime       INTEGER NOT NULL,
    duration    REAL,
    sample_rate INTEGER,
    channels    INTEGER,
    bit_depth   INTEGER,
    bitrate     INTEGER,
    status      TEXT    NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'missing', 'broken')),
    favorite    INTEGER NOT NULL DEFAULT 0,
    UNIQUE (folder_id, name)
  );
  CREATE INDEX files_favorite ON files(id) WHERE favorite = 1;

  CREATE TABLE keywords (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE file_keywords (
    file_id    INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
    PRIMARY KEY (file_id, keyword_id)
  );
  CREATE INDEX file_keywords_keyword ON file_keywords(keyword_id);

  CREATE TABLE folder_keywords (
    folder_id  INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
    PRIMARY KEY (folder_id, keyword_id)
  );
  CREATE INDEX folder_keywords_keyword ON folder_keywords(keyword_id);

  -- Waveform outlines of long files, packed (see peaks-blob.ts). Stamped with the
  -- file's size and modification time: an outline of an older version is ignored.
  CREATE TABLE file_peaks (
    file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    size    INTEGER NOT NULL,
    mtime   INTEGER NOT NULL,
    data    BLOB    NOT NULL
  );
`

// A file's keywords as a JSON array, in the order they were added; needs `f` for files.
export const FILE_KEYWORDS_JSON = `(SELECT json_group_array(k.name ORDER BY fk.rowid)
    FROM file_keywords fk JOIN keywords k ON k.id = fk.keyword_id
   WHERE fk.file_id = f.id)`

export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  if (user_version === 0) {
    transaction(db, () => {
      db.exec(SCHEMA)
      db.exec('PRAGMA user_version = 1')
    })
  }
  return db
}

export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function deleteUnusedKeywords(db: DatabaseSync): void {
  db.exec(
    `DELETE FROM keywords
      WHERE id NOT IN (SELECT keyword_id FROM file_keywords)
        AND id NOT IN (SELECT keyword_id FROM folder_keywords)`
  )
}

export function checkDatabase(db: DatabaseSync, now = Date.now()): DatabaseStatus {
  const { version } = db.prepare('SELECT sqlite_version() AS version').get() as { version: string }
  db.prepare(
    `INSERT INTO app_meta (key, value) VALUES ('last_start', ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`
  ).run(String(now))
  const stored = db.prepare(`SELECT value FROM app_meta WHERE key = 'last_start'`).get() as
    | { value: string }
    | undefined
  if (stored?.value !== String(now)) throw new Error('Database write did not read back')
  return { ok: true, engine: 'node:sqlite', sqliteVersion: version, error: null }
}

export function failedDatabaseStatus(error: unknown): DatabaseStatus {
  return {
    ok: false,
    engine: 'node:sqlite',
    sqliteVersion: null,
    error: error instanceof Error ? error.message : String(error)
  }
}

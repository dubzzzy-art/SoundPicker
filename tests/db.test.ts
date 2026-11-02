import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkDatabase, failedDatabaseStatus, openDatabase } from '../src/main/db'

function tempDbFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'soundpicker-test-')), 'test.db')
}

describe('database', () => {
  it('creates the schema on first open', () => {
    const db = openDatabase(':memory:')
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name)
    expect(tables).toEqual([
      'app_meta',
      'file_keywords',
      'file_peaks',
      'files',
      'folder_keywords',
      'folders',
      'keywords',
      'libraries'
    ])
    const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(user_version).toBe(1)
    db.close()
  })

  it('reopens an existing database without creating the schema again', () => {
    const file = tempDbFile()
    const first = openDatabase(file)
    first.prepare("INSERT INTO keywords (name) VALUES ('wood')").run()
    first.close()

    const second = openDatabase(file)
    const row = second.prepare('SELECT count(*) AS n FROM keywords').get() as { n: number }
    expect(row.n).toBe(1)
    second.close()
  })

  it('reports a healthy database', () => {
    const db = openDatabase(':memory:')
    const status = checkDatabase(db, 1_700_000_000_000)
    expect(status.ok).toBe(true)
    expect(status.sqliteVersion).toMatch(/^3\.\d+\.\d+$/)
    db.close()
  })

  it('removes folders, files and their keywords together with a library', () => {
    const db = openDatabase(':memory:')
    db.prepare("INSERT INTO libraries (id, name, root_path, created_at) VALUES (1, 'BF1', '/sfx/BF1', 0)").run()
    db.prepare("INSERT INTO folders (id, library_id, parent_id, rel_path, name) VALUES (1, 1, NULL, '', 'BF1')").run()
    db.prepare("INSERT INTO folders (id, library_id, parent_id, rel_path, name) VALUES (2, 1, 1, 'Grab', 'Grab')").run()
    db.prepare("INSERT INTO files (id, folder_id, name, ext, size, mtime) VALUES (1, 2, 'Grab 0 0 0.mp3', 'mp3', 7725, 0)").run()
    db.prepare("INSERT INTO keywords (id, name) VALUES (1, 'melee')").run()
    db.prepare('INSERT INTO file_keywords (file_id, keyword_id) VALUES (1, 1)').run()
    db.prepare('INSERT INTO folder_keywords (folder_id, keyword_id) VALUES (2, 1)').run()

    db.prepare('DELETE FROM libraries WHERE id = 1').run()

    for (const table of ['folders', 'files', 'file_keywords', 'folder_keywords']) {
      const row = db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }
      expect(row.n, table).toBe(0)
    }
    const kept = db.prepare('SELECT count(*) AS n FROM keywords').get() as { n: number }
    expect(kept.n).toBe(1)
    db.close()
  })

  it('describes a failure without throwing', () => {
    expect(failedDatabaseStatus(new Error('disk full'))).toMatchObject({ ok: false, error: 'disk full' })
  })
})

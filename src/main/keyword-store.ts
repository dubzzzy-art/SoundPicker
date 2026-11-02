import type { DatabaseSync } from 'node:sqlite'
import type { KeywordChange, RenameKeywordResult } from '../shared/api'
import { normalizeKeyword, type KeywordSummary } from '../shared/keywords'
import { FILE_KEYWORDS_JSON, deleteUnusedKeywords, transaction } from './db'

export class KeywordStore {
  constructor(private readonly db: DatabaseSync) {}

  list(): KeywordSummary[] {
    const rows = this.db
      .prepare(
        `SELECT k.id, k.name,
                (SELECT count(*) FROM file_keywords fk
                   JOIN files f ON f.id = fk.file_id
                   JOIN folders d ON d.id = f.folder_id
                   JOIN libraries l ON l.id = d.library_id
                  WHERE fk.keyword_id = k.id AND l.removed_at IS NULL AND f.status != 'missing') AS files,
                (SELECT count(*) FROM folder_keywords dk
                   JOIN folders d ON d.id = dk.folder_id
                   JOIN libraries l ON l.id = d.library_id
                  WHERE dk.keyword_id = k.id AND l.removed_at IS NULL AND d.missing = 0) AS folders
           FROM keywords k`
      )
      .all() as unknown as KeywordSummary[]
    return rows.filter((row) => row.files + row.folders > 0)
  }

  add(fileIds: number[], name: string): KeywordChange {
    const keyword = normalizeKeyword(name)
    if (!keyword) return { files: [] }
    return transaction(this.db, () => {
      const { id } = this.db
        .prepare(
          `INSERT INTO keywords (name) VALUES (?)
           ON CONFLICT (name) DO UPDATE SET name = excluded.name
           RETURNING id`
        )
        .get(keyword) as { id: number }
      this.db
        .prepare(
          `INSERT OR IGNORE INTO file_keywords (file_id, keyword_id)
           SELECT f.id, ? FROM files f WHERE f.id IN (SELECT value FROM json_each(?))`
        )
        .run(id, JSON.stringify(fileIds))
      return { files: this.keywordsOf(fileIds) }
    })
  }

  remove(fileIds: number[], name: string): KeywordChange {
    return transaction(this.db, () => {
      const row = this.db.prepare('SELECT id FROM keywords WHERE name = ?').get(normalizeKeyword(name)) as
        | { id: number }
        | undefined
      if (row) {
        this.db
          .prepare('DELETE FROM file_keywords WHERE keyword_id = ? AND file_id IN (SELECT value FROM json_each(?))')
          .run(row.id, JSON.stringify(fileIds))
        deleteUnusedKeywords(this.db)
      }
      return { files: this.keywordsOf(fileIds) }
    })
  }

  addToFolder(folderId: number, name: string): string[] {
    const keyword = normalizeKeyword(name)
    if (!keyword) return this.keywordsOfFolder(folderId)
    return transaction(this.db, () => {
      const { id } = this.db
        .prepare(
          `INSERT INTO keywords (name) VALUES (?)
           ON CONFLICT (name) DO UPDATE SET name = excluded.name
           RETURNING id`
        )
        .get(keyword) as { id: number }
      this.db.prepare('INSERT OR IGNORE INTO folder_keywords (folder_id, keyword_id) SELECT id, ? FROM folders WHERE id = ?').run(id, folderId)
      return this.keywordsOfFolder(folderId)
    })
  }

  removeFromFolder(folderId: number, name: string): string[] {
    return transaction(this.db, () => {
      const row = this.db.prepare('SELECT id FROM keywords WHERE name = ?').get(normalizeKeyword(name)) as { id: number } | undefined
      if (row) {
        this.db.prepare('DELETE FROM folder_keywords WHERE folder_id = ? AND keyword_id = ?').run(folderId, row.id)
        deleteUnusedKeywords(this.db)
      }
      return this.keywordsOfFolder(folderId)
    })
  }

  private keywordsOfFolder(folderId: number): string[] {
    const rows = this.db
      .prepare(
        'SELECT k.name FROM folder_keywords dk JOIN keywords k ON k.id = dk.keyword_id WHERE dk.folder_id = ? ORDER BY dk.rowid'
      )
      .all(folderId) as { name: string }[]
    return rows.map((row) => row.name)
  }

  rename(id: number, name: string): RenameKeywordResult {
    const keyword = normalizeKeyword(name)
    if (!keyword) return { ok: false, reason: 'empty' }
    const existing = this.db.prepare('SELECT id FROM keywords WHERE name = ?').get(keyword) as { id: number } | undefined
    if (existing && existing.id !== id) {
      const summary = this.list().find((candidate) => candidate.id === existing.id)
      return { ok: false, reason: 'exists', existing: summary ?? { id: existing.id, name: keyword, files: 0, folders: 0 } }
    }
    this.db.prepare('UPDATE keywords SET name = ? WHERE id = ?').run(keyword, id)
    return { ok: true }
  }

  merge(sourceId: number, targetId: number): void {
    if (sourceId === targetId) return
    transaction(this.db, () => {
      this.db
        .prepare('INSERT OR IGNORE INTO file_keywords (file_id, keyword_id) SELECT file_id, ? FROM file_keywords WHERE keyword_id = ?')
        .run(targetId, sourceId)
      this.db
        .prepare(
          'INSERT OR IGNORE INTO folder_keywords (folder_id, keyword_id) SELECT folder_id, ? FROM folder_keywords WHERE keyword_id = ?'
        )
        .run(targetId, sourceId)
      this.db.prepare('DELETE FROM keywords WHERE id = ?').run(sourceId)
    })
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM keywords WHERE id = ?').run(id)
  }

  fileIds(id: number): number[] {
    const rows = this.db
      .prepare(
        `SELECT fk.file_id AS id FROM file_keywords fk
           JOIN files f ON f.id = fk.file_id
           JOIN folders d ON d.id = f.folder_id
           JOIN libraries l ON l.id = d.library_id
          WHERE fk.keyword_id = ? AND l.removed_at IS NULL AND f.status != 'missing'`
      )
      .all(id) as { id: number }[]
    return rows.map((row) => row.id)
  }

  private keywordsOf(fileIds: number[]): KeywordChange['files'] {
    const rows = this.db
      .prepare(
        `SELECT f.id, ${FILE_KEYWORDS_JSON} AS keywords FROM files f WHERE f.id IN (SELECT value FROM json_each(?))`
      )
      .all(JSON.stringify(fileIds)) as { id: number; keywords: string }[]
    return rows.map((row) => ({ id: row.id, keywords: JSON.parse(row.keywords) as string[] }))
  }
}

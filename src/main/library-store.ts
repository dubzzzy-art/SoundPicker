import type { DatabaseSync } from 'node:sqlite'
import { join, resolve } from 'node:path'
import { WAVEFORM_CACHE_MIN_SECONDS, type FileRow, type FileStatus, type FolderRow, type LibrarySummary } from '../shared/api'
import { compareNames } from '../shared/names'
import { FILE_KEYWORDS_JSON, deleteUnusedKeywords, transaction } from './db'
import { packPeaks, unpackPeaks } from './peaks-blob'
import type { SearchData } from './search/engine'
import type { AudioDetails } from './scan/metadata'
import type { MetadataRequest } from './scan/protocol'
import type { WalkFile } from './scan/walk'

type StoredFileRow = Omit<FileRow, 'path' | 'keywords' | 'favorite'> & { favorite: number; keywords: string }

const FILE_COLUMNS = `f.id, f.folder_id AS folderId, f.name, f.ext, d.rel_path AS relDir, f.size,
  f.duration, f.sample_rate AS sampleRate, f.channels, f.bit_depth AS bitDepth,
  f.bitrate, f.status, f.favorite, ${FILE_KEYWORDS_JSON} AS keywords`

interface LibraryRecord {
  id: number
  name: string
  rootPath: string
  removedAt: number | null
}

// Paths are relative to the library root with '/' separators, so a library can move.
export class LibraryStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  transaction<T>(work: () => T): T {
    return transaction(this.db, work)
  }

  listLibraries(): LibrarySummary[] {
    const rows = this.db
      .prepare(
        `SELECT l.id, l.name, l.root_path AS rootPath, l.last_scan_at AS lastScanAt,
                root.id AS rootFolderId,
                (SELECT count(*) FROM files f JOIN folders d ON d.id = f.folder_id
                  WHERE d.library_id = l.id AND f.status != 'missing') AS fileCount
           FROM libraries l
           JOIN folders root ON root.library_id = l.id AND root.rel_path = ''
          WHERE l.removed_at IS NULL`
      )
      .all() as unknown as LibrarySummary[]
    return rows.sort((a, b) => compareNames(a.name, b.name))
  }

  getLibrary(id: number): LibraryRecord | null {
    const row = this.db
      .prepare('SELECT id, name, root_path AS rootPath, removed_at AS removedAt FROM libraries WHERE id = ?')
      .get(id) as LibraryRecord | undefined
    return row ?? null
  }

  findLibraryByRoot(rootPath: string): LibraryRecord | null {
    const wanted = this.normalizeRoot(rootPath)
    const rows = this.db
      .prepare('SELECT id, name, root_path AS rootPath, removed_at AS removedAt FROM libraries')
      .all() as unknown as LibraryRecord[]
    return rows.find((row) => this.normalizeRoot(row.rootPath) === wanted) ?? null
  }

  createLibrary(name: string, rootPath: string, now = Date.now()): number {
    return this.transaction(() => {
      const { id } = this.db
        .prepare('INSERT INTO libraries (name, root_path, created_at) VALUES (?, ?, ?) RETURNING id')
        .get(name, rootPath, now) as { id: number }
      this.db
        .prepare(`INSERT INTO folders (library_id, parent_id, rel_path, name) VALUES (?, NULL, '', ?)`)
        .run(id, name)
      return id
    })
  }

  setRoot(id: number, rootPath: string): void {
    this.db.prepare('UPDATE libraries SET root_path = ? WHERE id = ?').run(rootPath, id)
  }

  restoreLibrary(id: number, rootPath: string): void {
    this.db.prepare('UPDATE libraries SET removed_at = NULL, root_path = ? WHERE id = ?').run(rootPath, id)
  }

  renameLibrary(id: number, name: string): void {
    this.db.prepare('UPDATE libraries SET name = ? WHERE id = ?').run(name, id)
  }

  markScanned(id: number, now = Date.now()): void {
    this.db.prepare('UPDATE libraries SET last_scan_at = ? WHERE id = ?').run(now, id)
  }

  keywordUseCount(libraryId: number): number {
    const row = this.db
      .prepare(
        `SELECT (SELECT count(*) FROM file_keywords fk
                   JOIN files f ON f.id = fk.file_id
                   JOIN folders d ON d.id = f.folder_id
                  WHERE d.library_id = :id)
              + (SELECT count(*) FROM folder_keywords dk
                   JOIN folders d ON d.id = dk.folder_id
                  WHERE d.library_id = :id) AS n`
      )
      .get({ id: libraryId }) as { n: number }
    return row.n
  }

  removeLibrary(id: number, keepKeywords: boolean, now = Date.now()): void {
    if (keepKeywords) {
      this.db.prepare('UPDATE libraries SET removed_at = ? WHERE id = ?').run(now, id)
      return
    }
    this.transaction(() => {
      this.db.prepare('DELETE FROM libraries WHERE id = ?').run(id)
      deleteUnusedKeywords(this.db)
    })
  }

  deleteLibrary(id: number): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM libraries WHERE id = ?').run(id)
      deleteUnusedKeywords(this.db)
    })
  }

  upsertFolder(libraryId: number, parentId: number | null, relPath: string, name: string): number {
    const row = this.db
      .prepare(
        `INSERT INTO folders (library_id, parent_id, rel_path, name) VALUES (?, ?, ?, ?)
         ON CONFLICT (library_id, rel_path) DO UPDATE SET parent_id = excluded.parent_id, name = excluded.name, missing = 0
         RETURNING id`
      )
      .get(libraryId, parentId, relPath, name) as { id: number }
    return row.id
  }

  upsertFile(folderId: number, file: Pick<WalkFile, 'name' | 'ext' | 'size' | 'mtimeMs'>): number {
    const row = this.db
      .prepare(
        `INSERT INTO files (folder_id, name, ext, size, mtime) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (folder_id, name) DO UPDATE SET
           ext = excluded.ext,
           status = 'ok',
           duration    = CASE WHEN files.size = excluded.size AND files.mtime = excluded.mtime THEN files.duration END,
           sample_rate = CASE WHEN files.size = excluded.size AND files.mtime = excluded.mtime THEN files.sample_rate END,
           channels    = CASE WHEN files.size = excluded.size AND files.mtime = excluded.mtime THEN files.channels END,
           bit_depth   = CASE WHEN files.size = excluded.size AND files.mtime = excluded.mtime THEN files.bit_depth END,
           bitrate     = CASE WHEN files.size = excluded.size AND files.mtime = excluded.mtime THEN files.bitrate END,
           size = excluded.size,
           mtime = excluded.mtime
         RETURNING id`
      )
      .get(folderId, file.name, file.ext, file.size, file.mtimeMs) as { id: number }
    return row.id
  }

  getFolders(libraryId: number): FolderRow[] {
    const keywords = groupKeywords(
      this.db
        .prepare(
          `SELECT dk.folder_id AS id, k.name FROM folder_keywords dk
             JOIN keywords k ON k.id = dk.keyword_id
             JOIN folders d ON d.id = dk.folder_id
            WHERE d.library_id = ? ORDER BY dk.rowid`
        )
        .all(libraryId) as { id: number; name: string }[]
    )
    const rows = this.db
      .prepare(
        `SELECT d.id, d.library_id AS libraryId, d.parent_id AS parentId, d.name, d.rel_path AS relPath,
                count(f.id) AS fileCount, coalesce(sum(f.favorite), 0) AS favoriteCount
           FROM folders d
           LEFT JOIN files f ON f.folder_id = d.id AND f.status != 'missing'
          WHERE d.library_id = ? AND d.missing = 0
          GROUP BY d.id
          ORDER BY d.rel_path`
      )
      .all(libraryId) as unknown as Omit<FolderRow, 'keywords'>[]
    return rows.map((row) => ({ ...row, keywords: keywords.get(row.id) ?? [] }))
  }

  folderOnDisk(folderId: number): string | null {
    const row = this.db
      .prepare(
        `SELECT l.root_path AS rootPath, d.rel_path AS relPath FROM folders d
           JOIN libraries l ON l.id = d.library_id
          WHERE d.id = ? AND l.removed_at IS NULL`
      )
      .get(folderId) as { rootPath: string; relPath: string } | undefined
    if (!row) return null
    return row.relPath === '' ? row.rootPath : join(row.rootPath, ...row.relPath.split('/'))
  }

  listFiles(folderId: number, includeSubfolders: boolean): FileRow[] {
    const folder = this.db
      .prepare(
        `SELECT d.library_id AS libraryId, d.rel_path AS relPath, l.root_path AS rootPath
           FROM folders d JOIN libraries l ON l.id = d.library_id WHERE d.id = ?`
      )
      .get(folderId) as { libraryId: number; relPath: string; rootPath: string } | undefined
    if (!folder) return []

    // node:sqlite rejects named parameters the query does not use.
    const [scope, params] = !includeSubfolders
      ? ['d.id = :folderId', { folderId }]
      : folder.relPath === ''
        ? ['d.library_id = :libraryId', { libraryId: folder.libraryId }]
        : [
            `d.library_id = :libraryId AND (d.rel_path = :relPath OR substr(d.rel_path, 1, length(:relPath) + 1) = :relPath || '/')`,
            { libraryId: folder.libraryId, relPath: folder.relPath }
          ]

    const rows = this.db
      .prepare(`SELECT ${FILE_COLUMNS} FROM files f JOIN folders d ON d.id = f.folder_id WHERE ${scope} AND f.status != 'missing'`)
      .all(params) as unknown as StoredFileRow[]
    return rows.map((row) => this.fileRow(row, folder.rootPath))
  }

  searchData(): SearchData {
    const keywordsBy = (sql: string) => groupKeywords(this.db.prepare(sql).all() as { id: number; name: string }[])
    const fileKeywords = keywordsBy('SELECT fk.file_id AS id, k.name FROM file_keywords fk JOIN keywords k ON k.id = fk.keyword_id')
    const folderKeywords = keywordsBy('SELECT dk.folder_id AS id, k.name FROM folder_keywords dk JOIN keywords k ON k.id = dk.keyword_id')
    const libraries = this.db
      .prepare('SELECT id, name FROM libraries WHERE removed_at IS NULL')
      .all() as SearchData['libraries']
    const folders = (
      this.db
        .prepare(
          `SELECT d.id, d.library_id AS libraryId, d.parent_id AS parentId, d.rel_path AS relPath
             FROM folders d JOIN libraries l ON l.id = d.library_id
            WHERE l.removed_at IS NULL AND d.missing = 0`
        )
        .all() as Omit<SearchData['folders'][number], 'keywords'>[]
    ).map((folder) => ({ ...folder, keywords: folderKeywords.get(folder.id) ?? [] }))
    const files = (
      this.db
        .prepare(
          `SELECT f.id, f.folder_id AS folderId, f.name, f.duration, f.channels, f.favorite
             FROM files f JOIN folders d ON d.id = f.folder_id JOIN libraries l ON l.id = d.library_id
            WHERE l.removed_at IS NULL AND f.status != 'missing'`
        )
        .all() as (Omit<SearchData['files'][number], 'keywords' | 'favorite'> & { favorite: number })[]
    ).map((file) => ({ ...file, favorite: file.favorite === 1, keywords: fileKeywords.get(file.id) ?? [] }))
    return { libraries, folders, files }
  }

  filesByIds(ids: number[]): FileRow[] {
    if (ids.length === 0) return []
    const rows = this.db
      .prepare(
        `SELECT ${FILE_COLUMNS}, l.root_path AS rootPath
           FROM files f JOIN folders d ON d.id = f.folder_id JOIN libraries l ON l.id = d.library_id
          WHERE f.id IN (SELECT value FROM json_each(?))`
      )
      .all(JSON.stringify(ids)) as unknown as (StoredFileRow & { rootPath: string })[]
    const byId = new Map(rows.map(({ rootPath, ...row }) => [row.id, this.fileRow(row, rootPath)]))
    return ids.map((id) => byId.get(id)).filter((row): row is FileRow => row !== undefined)
  }

  fileOnDisk(fileId: number): { path: string; size: number; mtime: number; bitrate: number | null } | null {
    const row = this.db
      .prepare(
        `SELECT l.root_path AS rootPath, d.rel_path AS relDir, f.name, f.size, f.mtime, f.bitrate
           FROM files f
           JOIN folders d ON d.id = f.folder_id
           JOIN libraries l ON l.id = d.library_id
          WHERE f.id = ? AND l.removed_at IS NULL`
      )
      .get(fileId) as
      | { rootPath: string; relDir: string; name: string; size: number; mtime: number; bitrate: number | null }
      | undefined
    if (!row) return null
    return { path: this.filePath(row.rootPath, row.relDir, row.name), size: row.size, mtime: row.mtime, bitrate: row.bitrate }
  }

  // Returns the files whose star changed.
  setFavorite(fileIds: number[], favorite: boolean): number[] {
    const value = favorite ? 1 : 0
    const rows = this.db
      .prepare('UPDATE files SET favorite = ? WHERE favorite != ? AND id IN (SELECT value FROM json_each(?)) RETURNING id')
      .all(value, value, JSON.stringify(fileIds)) as { id: number }[]
    return rows.map((row) => row.id)
  }

  favoriteCount(): number {
    const row = this.db
      .prepare(
        `SELECT count(*) AS n FROM files f
           JOIN folders d ON d.id = f.folder_id
           JOIN libraries l ON l.id = d.library_id
          WHERE f.favorite = 1 AND l.removed_at IS NULL AND f.status != 'missing'`
      )
      .get() as { n: number }
    return row.n
  }

  readPeaks(fileId: number): Uint8Array | null {
    const row = this.db
      .prepare(
        `SELECT p.data FROM file_peaks p
           JOIN files f ON f.id = p.file_id AND f.size = p.size AND f.mtime = p.mtime
          WHERE p.file_id = ?`
      )
      .get(fileId) as { data: Uint8Array } | undefined
    return row ? unpackPeaks(row.data) : null
  }

  writePeaks(fileId: number, data: Uint8Array): void {
    this.db
      .prepare(
        `INSERT INTO file_peaks (file_id, size, mtime, data)
         SELECT id, size, mtime, ? FROM files WHERE id = ? AND duration >= ?
         ON CONFLICT (file_id) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, data = excluded.data`
      )
      .run(packPeaks(data), fileId, WAVEFORM_CACHE_MIN_SECONDS)
  }

  countFilesNeedingDetails(libraryId: number): number {
    const row = this.db
      .prepare(
        `SELECT count(*) AS n FROM files f JOIN folders d ON d.id = f.folder_id
          WHERE d.library_id = ? AND f.status = 'ok' AND f.duration IS NULL`
      )
      .get(libraryId) as { n: number }
    return row.n
  }

  filesNeedingDetails(libraryId: number, afterId: number, limit: number): MetadataRequest[] {
    const library = this.getLibrary(libraryId)
    if (!library) return []
    const rows = this.db
      .prepare(
        `SELECT f.id, d.rel_path AS relDir, f.name FROM files f JOIN folders d ON d.id = f.folder_id
          WHERE d.library_id = ? AND f.status = 'ok' AND f.duration IS NULL AND f.id > ?
          ORDER BY f.id LIMIT ?`
      )
      .all(libraryId, afterId, limit) as { id: number; relDir: string; name: string }[]
    return rows.map((row) => ({ id: row.id, path: this.filePath(library.rootPath, row.relDir, row.name) }))
  }

  saveDetails(fileId: number, details: AudioDetails): void {
    this.db
      .prepare(
        'UPDATE files SET duration = ?, sample_rate = ?, channels = ?, bit_depth = ?, bitrate = ? WHERE id = ?'
      )
      .run(details.duration, details.sampleRate, details.channels, details.bitDepth, details.bitrate, fileId)
  }

  markBroken(fileId: number): void {
    this.db.prepare(`UPDATE files SET status = 'broken' WHERE id = ?`).run(fileId)
  }

  librariesNeedingDetails(): number[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT d.library_id AS id FROM files f
           JOIN folders d ON d.id = f.folder_id
           JOIN libraries l ON l.id = d.library_id
          WHERE l.removed_at IS NULL AND f.status = 'ok' AND f.duration IS NULL`
      )
      .all() as { id: number }[]
    return rows.map((row) => row.id)
  }

  totals(): { libraries: number; files: number } {
    return this.db
      .prepare(
        `SELECT (SELECT count(*) FROM libraries WHERE removed_at IS NULL) AS libraries,
                (SELECT count(*) FROM files f
                   JOIN folders d ON d.id = f.folder_id
                   JOIN libraries l ON l.id = d.library_id
                  WHERE l.removed_at IS NULL AND f.status != 'missing') AS files`
      )
      .get() as { libraries: number; files: number }
  }

  lastScan(): { libraryName: string; at: number } | null {
    const row = this.db
      .prepare(
        `SELECT name AS libraryName, last_scan_at AS at FROM libraries
          WHERE removed_at IS NULL AND last_scan_at IS NOT NULL
          ORDER BY last_scan_at DESC LIMIT 1`
      )
      .get() as { libraryName: string; at: number } | undefined
    return row ?? null
  }

  private fileRow(row: StoredFileRow, rootPath: string): FileRow {
    return {
      ...row,
      status: row.status as FileStatus,
      keywords: JSON.parse(row.keywords) as string[],
      favorite: row.favorite === 1,
      path: this.filePath(rootPath, row.relDir, row.name)
    }
  }

  private filePath(rootPath: string, relDir: string, name: string): string {
    return relDir === '' ? join(rootPath, name) : join(rootPath, ...relDir.split('/'), name)
  }

  normalizeRoot(rootPath: string): string {
    let normalized = resolve(rootPath)
    while (normalized.length > 1 && /[\\/]$/.test(normalized) && !/^[A-Za-z]:[\\/]$/.test(normalized)) {
      normalized = normalized.slice(0, -1)
    }
    return this.platform === 'win32' || this.platform === 'darwin' ? normalized.toLowerCase() : normalized
  }
}

function groupKeywords(rows: { id: number; name: string }[]): Map<number, string[]> {
  const map = new Map<number, string[]>()
  for (const row of rows) {
    const list = map.get(row.id)
    if (list) list.push(row.name)
    else map.set(row.id, [row.name])
  }
  return map
}

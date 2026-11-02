import type { DatabaseSync } from 'node:sqlite'
import type { MissingFile, MissingFolder, RescanLeftovers, RescanSummary } from '../shared/api'
import { FILE_KEYWORDS_JSON, deleteUnusedKeywords, transaction } from './db'

export interface LibraryIds {
  files: Set<number>
  folders: Set<number>
}

interface FileFacts {
  id: number
  folderId: number
  name: string
  size: number
  mtime: number
  relDir: string
  status: string
  kept: number
}

// Moved = same name, size and mtime in another folder. Gone files with keywords or a
// star, and gone folders with keywords, are kept hidden; the rest is deleted.
export class RescanStore {
  constructor(private readonly db: DatabaseSync) {}

  snapshot(libraryId: number): LibraryIds {
    const files = this.db
      .prepare('SELECT f.id FROM files f JOIN folders d ON d.id = f.folder_id WHERE d.library_id = ?')
      .all(libraryId) as { id: number }[]
    const folders = this.db.prepare('SELECT id FROM folders WHERE library_id = ?').all(libraryId) as { id: number }[]
    return { files: new Set(files.map((row) => row.id)), folders: new Set(folders.map((row) => row.id)) }
  }

  presentCount(ids: LibraryIds): number {
    return this.facts([...ids.files]).filter((file) => file.status !== 'missing').length
  }

  reconcile(libraryId: number, before: LibraryIds, seen: LibraryIds): RescanSummary {
    return transaction(this.db, () => {
      const added = this.facts([...seen.files].filter((id) => !before.files.has(id)))
      const gone = this.facts([...before.files].filter((id) => !seen.files.has(id)))

      const goneByKey = new Map<string, FileFacts[]>()
      for (const file of gone) {
        const list = goneByKey.get(fileKey(file))
        if (list) list.push(file)
        else goneByKey.set(fileKey(file), [file])
      }

      const moved: RescanSummary['moved'] = []
      const movedOut = new Set<number>()
      const flows = new Map<number, Map<number, number>>()
      for (const file of added) {
        const old = goneByKey.get(fileKey(file))?.shift()
        if (!old) continue
        this.carryOver(old.id, file.id)
        movedOut.add(old.id)
        moved.push({ name: file.name, from: old.relDir, to: file.relDir })
        const flow = flows.get(old.folderId) ?? new Map<number, number>()
        flow.set(file.folderId, (flow.get(file.folderId) ?? 0) + 1)
        flows.set(old.folderId, flow)
      }

      let missing = 0
      for (const file of gone) {
        if (movedOut.has(file.id)) continue
        if (file.status !== 'missing') missing++
        if (file.kept > 0) this.db.prepare(`UPDATE files SET status = 'missing' WHERE id = ?`).run(file.id)
        else this.db.prepare('DELETE FROM files WHERE id = ?').run(file.id)
      }

      this.pruneFolders([...before.folders].filter((id) => !seen.folders.has(id)))
      this.suggestTargets(flows)
      return {
        ...this.leftovers(libraryId),
        added: added.length - moved.length,
        moved,
        missing
      }
    })
  }

  leftovers(libraryId: number): RescanLeftovers {
    const files = this.db
      .prepare(
        `SELECT f.id, f.name, d.rel_path AS relDir, f.favorite, ${FILE_KEYWORDS_JSON} AS keywords
           FROM files f JOIN folders d ON d.id = f.folder_id
          WHERE d.library_id = ? AND f.status = 'missing'
          ORDER BY d.rel_path, f.name`
      )
      .all(libraryId) as (Omit<MissingFile, 'keywords' | 'favorite'> & { keywords: string; favorite: number })[]
    const folders = this.db
      .prepare(
        `SELECT d.id, d.rel_path AS relPath, d.suggested_folder_id AS suggestedFolderId,
                (SELECT json_group_array(k.name ORDER BY dk.rowid) FROM folder_keywords dk
                   JOIN keywords k ON k.id = dk.keyword_id WHERE dk.folder_id = d.id) AS keywords
           FROM folders d
          WHERE d.library_id = ? AND d.missing = 1
            AND EXISTS (SELECT 1 FROM folder_keywords dk WHERE dk.folder_id = d.id)
          ORDER BY d.rel_path`
      )
      .all(libraryId) as (Omit<MissingFolder, 'keywords'> & { keywords: string })[]
    return {
      libraryId,
      missingFiles: files.map((file) => ({ ...file, favorite: file.favorite === 1, keywords: JSON.parse(file.keywords) as string[] })),
      missingFolders: folders.map((folder) => ({
        ...folder,
        suggestedFolderId: this.isPresentFolder(folder.suggestedFolderId) ? folder.suggestedFolderId : null,
        keywords: JSON.parse(folder.keywords) as string[]
      }))
    }
  }

  clearMissingFiles(libraryId: number, fileIds: number[] | null): RescanLeftovers {
    return transaction(this.db, () => {
      const ids = (
        this.db
          .prepare(
            `SELECT f.id FROM files f JOIN folders d ON d.id = f.folder_id
              WHERE d.library_id = ? AND f.status = 'missing'`
          )
          .all(libraryId) as { id: number }[]
      )
        .map((row) => row.id)
        .filter((id) => fileIds === null || fileIds.includes(id))
      for (const id of ids) this.db.prepare('DELETE FROM files WHERE id = ?').run(id)
      this.afterClearing(libraryId)
      return this.leftovers(libraryId)
    })
  }

  moveFolderKeywords(fromId: number, toId: number | null): RescanLeftovers {
    return transaction(this.db, () => {
      const folder = this.db.prepare('SELECT library_id AS libraryId FROM folders WHERE id = ?').get(fromId) as
        | { libraryId: number }
        | undefined
      if (!folder) throw new Error('Folder not found')
      if (toId !== null) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO folder_keywords (folder_id, keyword_id)
             SELECT ?, keyword_id FROM folder_keywords WHERE folder_id = ? ORDER BY rowid`
          )
          .run(toId, fromId)
      }
      this.db.prepare('DELETE FROM folder_keywords WHERE folder_id = ?').run(fromId)
      this.afterClearing(folder.libraryId)
      return this.leftovers(folder.libraryId)
    })
  }

  private afterClearing(libraryId: number): void {
    const missing = this.db.prepare('SELECT id FROM folders WHERE library_id = ? AND missing = 1').all(libraryId) as { id: number }[]
    this.pruneFolders(missing.map((row) => row.id))
    deleteUnusedKeywords(this.db)
  }

  private carryOver(oldId: number, newId: number): void {
    this.db.prepare('INSERT OR IGNORE INTO file_keywords (file_id, keyword_id) SELECT ?, keyword_id FROM file_keywords WHERE file_id = ? ORDER BY rowid').run(newId, oldId)
    this.db
      .prepare(
        `UPDATE files SET (duration, sample_rate, channels, bit_depth, bitrate) =
           (SELECT duration, sample_rate, channels, bit_depth, bitrate FROM files WHERE id = :old)
         WHERE id = :new AND duration IS NULL`
      )
      .run({ old: oldId, new: newId })
    this.db.prepare('UPDATE files SET favorite = max(favorite, (SELECT favorite FROM files WHERE id = ?)) WHERE id = ?').run(oldId, newId)
    this.db.prepare('UPDATE file_peaks SET file_id = ? WHERE file_id = ? AND NOT EXISTS (SELECT 1 FROM file_peaks WHERE file_id = ?)').run(newId, oldId, newId)
    this.db.prepare('DELETE FROM files WHERE id = ?').run(oldId)
  }

  private pruneFolders(ids: number[]): void {
    const folders = ids
      .map((id) => this.db.prepare('SELECT id, rel_path AS relPath FROM folders WHERE id = ?').get(id) as { id: number; relPath: string } | undefined)
      .filter((folder): folder is { id: number; relPath: string } => folder !== undefined && folder.relPath !== '')
      .sort((a, b) => depth(b.relPath) - depth(a.relPath))
    for (const { id } of folders) {
      const needed = this.db
        .prepare(
          `SELECT EXISTS (SELECT 1 FROM folder_keywords WHERE folder_id = :id)
               OR EXISTS (SELECT 1 FROM files WHERE folder_id = :id)
               OR EXISTS (SELECT 1 FROM folders WHERE parent_id = :id) AS needed`
        )
        .get({ id }) as { needed: number }
      if (needed.needed) this.db.prepare('UPDATE folders SET missing = 1 WHERE id = ?').run(id)
      else this.db.prepare('DELETE FROM folders WHERE id = ?').run(id)
    }
  }

  private suggestTargets(flows: Map<number, Map<number, number>>): void {
    for (const [from, targets] of flows) {
      const [best] = [...targets].sort((a, b) => b[1] - a[1])
      this.db.prepare('UPDATE folders SET suggested_folder_id = ? WHERE id = ? AND missing = 1').run(best[0], from)
    }
  }

  private isPresentFolder(id: number | null): id is number {
    if (id === null) return false
    const row = this.db.prepare('SELECT missing FROM folders WHERE id = ?').get(id) as { missing: number } | undefined
    return row?.missing === 0
  }

  private facts(ids: number[]): FileFacts[] {
    if (ids.length === 0) return []
    return this.db
      .prepare(
        `SELECT f.id, f.folder_id AS folderId, f.name, f.size, f.mtime, d.rel_path AS relDir, f.status,
                (f.favorite = 1 OR EXISTS (SELECT 1 FROM file_keywords fk WHERE fk.file_id = f.id)) AS kept
           FROM files f JOIN folders d ON d.id = f.folder_id
          WHERE f.id IN (SELECT value FROM json_each(?))
          ORDER BY d.rel_path, f.name`
      )
      .all(JSON.stringify(ids)) as unknown as FileFacts[]
  }
}

function fileKey(file: { name: string; size: number; mtime: number }): string {
  return `${file.name}\u0000${file.size}\u0000${file.mtime}`
}

function depth(relPath: string): number {
  return relPath.split('/').length
}

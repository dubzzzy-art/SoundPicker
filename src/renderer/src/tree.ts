import type { FileRow, FolderRow, LibrarySummary } from '../../shared/api'
import { compareNames } from '../../shared/names'

export function folderTotals(folders: FolderRow[], favorites = false): Map<number, number> {
  const totals = new Map<number, number>()
  for (const folder of folders) totals.set(folder.id, favorites ? folder.favoriteCount : folder.fileCount)
  const byDepth = [...folders].sort((a, b) => depthOf(b.relPath) - depthOf(a.relPath))
  for (const folder of byDepth) {
    if (folder.parentId === null) continue
    totals.set(folder.parentId, (totals.get(folder.parentId) ?? 0) + (totals.get(folder.id) ?? 0))
  }
  return totals
}

function depthOf(relPath: string): number {
  return relPath === '' ? 0 : relPath.split('/').length
}

export interface TreeRow {
  folderId: number
  libraryId: number
  isLibrary: boolean
  label: string
  depth: number
  total: number
  hasChildren: boolean
  expanded: boolean
  keywords: string[]
}

export function visibleTreeRows(
  libraries: LibrarySummary[],
  foldersByLibrary: Map<number, FolderRow[]>,
  expanded: Set<number>,
  favorites = false
): TreeRow[] {
  const rows: TreeRow[] = []
  for (const library of libraries) {
    const folders = foldersByLibrary.get(library.id) ?? []
    const totals = folderTotals(folders, favorites)
    if (favorites && !totals.get(library.rootFolderId)) continue
    const children = new Map<number, FolderRow[]>()
    for (const folder of folders) {
      if (folder.parentId === null) continue
      if (favorites && !totals.get(folder.id)) continue
      const list = children.get(folder.parentId) ?? []
      list.push(folder)
      children.set(folder.parentId, list)
    }
    for (const list of children.values()) list.sort((a, b) => compareNames(a.name, b.name))

    const byId = new Map(folders.map((folder) => [folder.id, folder]))
    const visit = (folderId: number, label: string, depth: number) => {
      const kids = children.get(folderId) ?? []
      const isOpen = expanded.has(folderId)
      rows.push({
        folderId,
        libraryId: library.id,
        isLibrary: depth === 0,
        label,
        depth,
        total: totals.get(folderId) ?? (depth === 0 ? library.fileCount : 0),
        hasChildren: kids.length > 0,
        expanded: isOpen,
        keywords: byId.get(folderId)?.keywords ?? []
      })
      if (isOpen) for (const kid of kids) visit(kid.id, kid.name, depth + 1)
    }
    visit(library.rootFolderId, library.name, 0)
  }
  return rows
}

export interface InheritedKeyword {
  name: string
  folderId: number
  folderPath: string
}

export function inheritedKeywords(
  folderId: number,
  byId: Map<number, FolderRow>,
  libraryNames: Map<number, string>
): InheritedKeyword[] {
  const result: InheritedKeyword[] = []
  const seen = new Set<string>()
  for (let folder = byId.get(folderId); folder; folder = folder.parentId === null ? undefined : byId.get(folder.parentId)) {
    const libraryName = libraryNames.get(folder.libraryId) ?? folder.name
    const folderPath = folder.relPath === '' ? libraryName : `${libraryName}/${folder.relPath}`
    for (const name of folder.keywords) {
      if (seen.has(name)) continue
      seen.add(name)
      result.push({ name, folderId: folder.id, folderPath })
    }
  }
  return result
}

export function subfolders(folderId: number, folders: FolderRow[]): FolderRow[] {
  const folder = folders.find((candidate) => candidate.id === folderId)
  if (!folder) return []
  const prefix = folder.relPath === '' ? '' : folder.relPath + '/'
  return folders
    .filter((candidate) => candidate.id !== folderId && candidate.libraryId === folder.libraryId && candidate.relPath.startsWith(prefix))
    .sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0))
}

export function folderAncestors(folderId: number, byId: Map<number, FolderRow>): number[] {
  const ancestors: number[] = []
  for (let folder = byId.get(folderId); folder?.parentId != null; folder = byId.get(folder.parentId)) ancestors.push(folder.parentId)
  return ancestors
}

export function breadcrumb(library: LibrarySummary, folders: FolderRow[], folderId: number): string[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const names: string[] = []
  let current = byId.get(folderId)
  while (current && current.parentId !== null) {
    names.unshift(current.name)
    current = byId.get(current.parentId)
  }
  return [library.name, ...names]
}

export type SortKey = 'name' | 'duration' | 'type' | 'channels' | 'relevance'

export interface SortOrder {
  key: SortKey
  direction: 1 | -1
}

export function sortFiles(files: FileRow[], order: SortOrder): FileRow[] {
  const { key, direction } = order
  if (key === 'relevance') return direction === 1 ? files : [...files].reverse()
  const value = (file: FileRow): number | string => {
    switch (key) {
      case 'duration':
        return file.duration ?? -1
      case 'type':
        return file.ext
      case 'channels':
        return file.channels ?? -1
      default:
        return file.name
    }
  }
  return [...files].sort((a, b) => {
    const va = value(a)
    const vb = value(b)
    const primary =
      typeof va === 'number' && typeof vb === 'number' ? va - vb : compareNames(String(va), String(vb))
    return (primary || compareNames(a.name, b.name)) * direction
  })
}

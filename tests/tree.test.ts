import { describe, expect, it } from 'vitest'
import type { FileRow, FolderRow, LibrarySummary } from '../src/shared/api'
import { formatChannels, formatCompactCount, formatCount, formatDuration, formatLength, formatRate, formatSize } from '../src/renderer/src/format'
import { breadcrumb, folderAncestors, folderTotals, inheritedKeywords, sortFiles, subfolders, visibleTreeRows } from '../src/renderer/src/tree'

const library: LibrarySummary = { id: 1, name: 'BF1', rootPath: '/sfx/BF1', rootFolderId: 10, fileCount: 6, lastScanAt: null }
const folders: FolderRow[] = [
  { id: 10, libraryId: 1, parentId: null, name: 'BF1', relPath: '', fileCount: 1, favoriteCount: 0, keywords: ['war'] },
  { id: 11, libraryId: 1, parentId: 10, name: 'Soldier', relPath: 'Soldier', fileCount: 0, favoriteCount: 0, keywords: ['foley', 'war'] },
  { id: 12, libraryId: 1, parentId: 11, name: 'Walk', relPath: 'Soldier/Walk', fileCount: 3, favoriteCount: 2, keywords: ['steps'] },
  { id: 13, libraryId: 1, parentId: 11, name: 'Sprint', relPath: 'Soldier/Sprint', fileCount: 2, favoriteCount: 0, keywords: [] },
  { id: 14, libraryId: 1, parentId: 10, name: 'Grab', relPath: 'Grab', fileCount: 0, favoriteCount: 0, keywords: [] }
]

describe('folder keywords', () => {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const names = new Map([[1, 'BF1 renamed']])

  it('inherits keywords from every folder up to the library, nearest first, each once', () => {
    expect(inheritedKeywords(12, byId, names)).toEqual([
      { name: 'steps', folderId: 12, folderPath: 'BF1 renamed/Soldier/Walk' },
      { name: 'foley', folderId: 11, folderPath: 'BF1 renamed/Soldier' },
      { name: 'war', folderId: 11, folderPath: 'BF1 renamed/Soldier' }
    ])
    expect(inheritedKeywords(14, byId, names)).toEqual([{ name: 'war', folderId: 10, folderPath: 'BF1 renamed' }])
  })

  it('lists subfolders in path order', () => {
    expect(subfolders(10, folders).map((folder) => folder.id)).toEqual([14, 11, 13, 12])
    expect(subfolders(11, folders).map((folder) => folder.id)).toEqual([13, 12])
  })
})

describe('folder tree', () => {
  it('sums files of all subfolders', () => {
    const totals = folderTotals(folders)
    expect(totals.get(10)).toBe(6)
    expect(totals.get(11)).toBe(5)
    expect(totals.get(12)).toBe(3)
  })

  it('shows only expanded branches, children sorted by name', () => {
    const rows = visibleTreeRows([library], new Map([[1, folders]]), new Set([10, 11]))
    expect(rows.map((row) => `${'  '.repeat(row.depth)}${row.label} ${row.total}`)).toEqual([
      'BF1 6',
      '  Grab 0',
      '  Soldier 5',
      '    Sprint 2',
      '    Walk 3'
    ])
    expect(rows[0].isLibrary).toBe(true)
    expect(rows[1].hasChildren).toBe(false)
  })

  it('shows only folders with favorites, counting them, when asked', () => {
    const rows = visibleTreeRows([library], new Map([[1, folders]]), new Set([10, 11]), true)
    expect(rows.map((row) => `${'  '.repeat(row.depth)}${row.label} ${row.total}`)).toEqual(['BF1 2', '  Soldier 2', '    Walk 2'])
    const empty = { ...library, id: 2, rootFolderId: 20 }
    const other: FolderRow[] = [{ id: 20, libraryId: 2, parentId: null, name: 'Other', relPath: '', fileCount: 4, favoriteCount: 0, keywords: [] }]
    expect(visibleTreeRows([empty], new Map([[2, other]]), new Set(), true)).toEqual([])
  })

  it('finds the folders to open to show a folder', () => {
    const byId = new Map(folders.map((folder) => [folder.id, folder]))
    expect(folderAncestors(12, byId)).toEqual([11, 10])
    expect(folderAncestors(10, byId)).toEqual([])
    const rows = visibleTreeRows([library], new Map([[1, folders]]), new Set(folderAncestors(12, byId)))
    expect(rows.some((row) => row.folderId === 12)).toBe(true)
  })

  it('builds a breadcrumb from the library down', () => {
    expect(breadcrumb(library, folders, 12)).toEqual(['BF1', 'Soldier', 'Walk'])
    expect(breadcrumb(library, folders, 10)).toEqual(['BF1'])
  })
})

describe('sortFiles', () => {
  const file = (id: number, name: string, duration: number | null): FileRow => ({
    id, folderId: 1, name, ext: 'mp3', path: name, relDir: '', size: 1, duration,
    sampleRate: null, channels: 1, bitDepth: null, bitrate: null, status: 'ok', keywords: [], favorite: false
  })
  const files = [file(1, 'Wave 10.mp3', 2), file(2, 'Wave 2.mp3', null), file(3, 'wave 1.mp3', 3)]

  it('sorts names naturally', () => {
    expect(sortFiles(files, { key: 'name', direction: 1 }).map((f) => f.id)).toEqual([3, 2, 1])
  })

  it('sorts by length with unknown lengths first, descending on request', () => {
    expect(sortFiles(files, { key: 'duration', direction: 1 }).map((f) => f.id)).toEqual([2, 1, 3])
    expect(sortFiles(files, { key: 'duration', direction: -1 }).map((f) => f.id)).toEqual([3, 1, 2])
  })
})

describe('formatting', () => {
  it('formats numbers the way the mockups show them', () => {
    expect(formatCount(112412)).toBe('112 412')
    expect(formatDuration(1.42)).toBe('0:01.42')
    expect(formatDuration(3725)).toBe('1:02:05')
    expect(formatDuration(null)).toBe('—')
    expect([0.22, 0.004, 0.996, 8, 8.4, 59.6, 193, 4726].map(formatLength)).toEqual(['0.22s', '0.00s', '1s', '8s', '8s', '1m 0s', '3m 13s', '1h 18m 46s'])
    expect(formatLength(null)).toBe('—')
    expect(formatRate(44100)).toBe('44.1k')
    expect(formatRate(48000)).toBe('48k')
    expect(formatSize(645120)).toBe('630 KB')
    expect(formatSize(1887437)).toBe('1.8 MB')
    expect(formatSize(1610612736)).toBe('1.50 GB')
    expect(formatChannels(2)).toBe('Stereo')
    expect([0, 999, 1000, 1234, 15000, 15551, 999999, 1000000, 2500000].map(formatCompactCount)).toEqual(['0', '999', '1K', '1K+', '15K', '15K+', '999K+', '1M', '2M+'])
  })
})

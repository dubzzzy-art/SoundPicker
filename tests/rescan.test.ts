import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'
import { KeywordStore } from '../src/main/keyword-store'
import { LibraryStore } from '../src/main/library-store'
import { RescanStore, type LibraryIds } from '../src/main/rescan-store'

let store: LibraryStore
let keywords: KeywordStore
let rescans: RescanStore
let libraryId: number

const DETAILS = { duration: 2, sampleRate: 48000, channels: 1, bitDepth: null, bitrate: 64000 }

function walk(paths: Record<string, number>): LibraryIds {
  const seen: LibraryIds = { files: new Set(), folders: new Set() }
  const folderIds = new Map<string, number>()
  const folder = (relPath: string): number => {
    const known = folderIds.get(relPath)
    if (known !== undefined) return known
    const parent = relPath === '' ? null : folder(relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '')
    const id = store.upsertFolder(libraryId, parent, relPath, relPath === '' ? 'BF1' : relPath.split('/').pop()!)
    folderIds.set(relPath, id)
    seen.folders.add(id)
    return id
  }
  folder('')
  for (const [path, size] of Object.entries(paths)) {
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const id = store.upsertFile(folder(dir), { name: path.split('/').pop()!, ext: 'mp3', size, mtimeMs: 1 })
    seen.files.add(id)
  }
  return seen
}

function rescan(paths: Record<string, number>) {
  const before = rescans.snapshot(libraryId)
  return rescans.reconcile(libraryId, before, walk(paths))
}

const fileId = (path: string) => {
  const dir = path.slice(0, path.lastIndexOf('/'))
  const folder = store.getFolders(libraryId).find((candidate) => candidate.relPath === dir)!
  return store.listFiles(folder.id, false).find((file) => file.name === path.split('/').pop())!.id
}
const folderId = (relPath: string) => store.getFolders(libraryId).find((folder) => folder.relPath === relPath)!.id
const counts = () => Object.fromEntries(keywords.list().map((k) => [k.name, [k.files, k.folders]]))

const FIRST = {
  'Grab/a.mp3': 10,
  'Grab/b.mp3': 11,
  'Sentry/Walk/w1.mp3': 20,
  'Sentry/Walk/w2.mp3': 21,
  'Sentry/Land/l1.mp3': 30
}
const SECOND = {
  'Grab/a.mp3': 10,
  'Grab/c.mp3': 12,
  'Sentry/Walking/w1.mp3': 20,
  'Sentry/Walking/w2.mp3': 21
}

beforeEach(() => {
  const db = openDatabase(':memory:')
  store = new LibraryStore(db, 'linux')
  keywords = new KeywordStore(db)
  rescans = new RescanStore(db)
  libraryId = store.createLibrary('BF1', '/sfx/BF1', 0)
  walk(FIRST)
  keywords.add([fileId('Grab/a.mp3')], 'grab')
  keywords.add([fileId('Sentry/Walk/w1.mp3')], 'steps')
  keywords.add([fileId('Sentry/Land/l1.mp3')], 'land')
  keywords.addToFolder(folderId('Sentry/Walk'), 'walking')
  store.saveDetails(fileId('Sentry/Walk/w1.mp3'), DETAILS)
})

describe('rescan', () => {
  it('reports nothing when the disk did not change', () => {
    const summary = rescan(FIRST)
    expect(summary).toMatchObject({ added: 0, moved: [], missing: 0, missingFiles: [], missingFolders: [] })
  })

  it('finds new, moved and missing files; keywords move with the files (stage 7)', () => {
    const summary = rescan(SECOND)
    expect(summary.added).toBe(1)
    expect(summary.moved).toEqual([
      { name: 'w1.mp3', from: 'Sentry/Walk', to: 'Sentry/Walking' },
      { name: 'w2.mp3', from: 'Sentry/Walk', to: 'Sentry/Walking' }
    ])
    expect(summary.missing).toBe(2)
    expect(summary.missingFiles).toEqual([{ id: expect.any(Number), name: 'l1.mp3', relDir: 'Sentry/Land', keywords: ['land'], favorite: false }])
    expect(summary.missingFolders).toEqual([
      { id: expect.any(Number), relPath: 'Sentry/Walk', keywords: ['walking'], suggestedFolderId: folderId('Sentry/Walking') }
    ])

    const w1 = store.filesByIds([fileId('Sentry/Walking/w1.mp3')])[0]
    expect(w1.keywords).toEqual(['steps'])
    expect(w1.duration).toBe(2)
    expect(store.getFolders(libraryId).map((folder) => folder.relPath)).toEqual(['', 'Grab', 'Sentry', 'Sentry/Walking'])
    expect(counts()).toEqual({ grab: [1, 0], steps: [1, 0] })
  })

  it('keeps the star of a moved file', () => {
    const starred = [fileId('Sentry/Walk/w2.mp3'), fileId('Grab/a.mp3')]
    expect(store.setFavorite(starred, true).sort()).toEqual([...starred].sort())
    // Already starred: nothing changes.
    expect(store.setFavorite(starred, true)).toEqual([])
    expect(store.favoriteCount()).toBe(2)
    rescan(SECOND)
    expect(store.filesByIds([fileId('Sentry/Walking/w2.mp3')])[0].favorite).toBe(true)
    expect(store.filesByIds([fileId('Sentry/Walking/w1.mp3')])[0].favorite).toBe(false)
    expect(store.favoriteCount()).toBe(2)
    expect(store.searchData().files.filter((file) => file.favorite).length).toBe(2)
  })

  it('keeps a missing starred file without keywords, and its star when it comes back', () => {
    store.setFavorite([fileId('Grab/b.mp3')], true)
    const summary = rescan(SECOND)
    expect(summary.missingFiles.map((file) => [file.name, file.favorite])).toEqual([
      ['b.mp3', true],
      ['l1.mp3', false]
    ])
    expect(store.favoriteCount()).toBe(0)
    rescan({ ...SECOND, 'Grab/b.mp3': 11 })
    expect(store.filesByIds([fileId('Grab/b.mp3')])[0].favorite).toBe(true)
    expect(store.favoriteCount()).toBe(1)
  })

  it('moves a missing folder’s keywords to the renamed folder', () => {
    const summary = rescan(SECOND)
    const [walkFolder] = summary.missingFolders
    const left = rescans.moveFolderKeywords(walkFolder.id, walkFolder.suggestedFolderId)
    expect(left.missingFolders).toEqual([])
    expect(store.getFolders(libraryId).find((folder) => folder.relPath === 'Sentry/Walking')?.keywords).toEqual(['walking'])
    expect(counts().walking).toEqual([0, 1])
  })

  it('keeps missing keywords until they are cleared, and gives them back if the file returns', () => {
    rescan(SECOND)
    const back = rescan({ ...SECOND, 'Sentry/Land/l1.mp3': 30 })
    expect(back).toMatchObject({ added: 0, missing: 0, missingFiles: [] })
    expect(store.filesByIds([fileId('Sentry/Land/l1.mp3')])[0].keywords).toEqual(['land'])

    rescan(SECOND)
    const cleared = rescans.clearMissingFiles(libraryId, null)
    expect(cleared.missingFiles).toEqual([])
    expect(counts().land).toBeUndefined()
    expect(rescans.snapshot(libraryId).folders.size).toBe(store.getFolders(libraryId).length + 1)
  })

  it('drops a missing folder’s keywords when asked', () => {
    const summary = rescan(SECOND)
    expect(rescans.moveFolderKeywords(summary.missingFolders[0].id, null).missingFolders).toEqual([])
    expect(counts().walking).toBeUndefined()
  })
})

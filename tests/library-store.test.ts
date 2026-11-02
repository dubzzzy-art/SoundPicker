import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'
import { LibraryStore } from '../src/main/library-store'

const DETAILS = { duration: 1.5, sampleRate: 48000, channels: 1, bitDepth: null, bitrate: 64000 }

let store: LibraryStore
let db: ReturnType<typeof openDatabase>

function seed() {
  const libraryId = store.createLibrary('BF1', '/sfx/BF1', 0)
  const root = store.upsertFolder(libraryId, null, '', 'BF1')
  const grab = store.upsertFolder(libraryId, root, 'Grab', 'Grab')
  const sentry = store.upsertFolder(libraryId, root, 'Sentry', 'Sentry')
  const walk = store.upsertFolder(libraryId, sentry, 'Sentry/Walk', 'Walk')
  const file = { ext: 'mp3', size: 100, mtimeMs: 1 }
  const grabA = store.upsertFile(grab, { ...file, name: 'Grab 0.mp3' })
  store.upsertFile(grab, { ...file, name: 'Grab 1.mp3' })
  const walkA = store.upsertFile(walk, { ...file, name: 'Walk 0.mp3' })
  return { libraryId, root, grab, sentry, walk, grabA, walkA }
}

beforeEach(() => {
  db = openDatabase(':memory:')
  store = new LibraryStore(db, 'linux')
})

describe('LibraryStore', () => {
  it('creates a library with its root folder', () => {
    const { libraryId, root } = seed()
    const [library] = store.listLibraries()
    expect(library).toMatchObject({ id: libraryId, name: 'BF1', rootFolderId: root, fileCount: 3 })
  })

  it('keeps a file id when it is found again and clears details only if it changed', () => {
    const { grab, grabA } = seed()
    store.saveDetails(grabA, DETAILS)

    expect(store.upsertFile(grab, { name: 'Grab 0.mp3', ext: 'mp3', size: 100, mtimeMs: 1 })).toBe(grabA)
    expect(store.listFiles(grab, false).find((f) => f.id === grabA)?.duration).toBe(1.5)

    expect(store.upsertFile(grab, { name: 'Grab 0.mp3', ext: 'mp3', size: 200, mtimeMs: 2 })).toBe(grabA)
    expect(store.listFiles(grab, false).find((f) => f.id === grabA)?.duration).toBeNull()
  })

  it('lists a folder alone or with its subfolders', () => {
    const { root, sentry, walk } = seed()
    expect(store.listFiles(root, false)).toHaveLength(0)
    expect(store.listFiles(root, true)).toHaveLength(3)
    expect(store.listFiles(sentry, true).map((f) => f.name)).toEqual(['Walk 0.mp3'])
    // Paths on disk use the system separator.
    expect(store.listFiles(walk, false)[0].path).toBe(join('/sfx/BF1', 'Sentry', 'Walk', 'Walk 0.mp3'))
  })

  it('does not treat a folder with a longer name as a subfolder', () => {
    const { libraryId, root, grab } = seed()
    const grabber = store.upsertFolder(libraryId, root, 'Grabber', 'Grabber')
    store.upsertFile(grabber, { name: 'Other.mp3', ext: 'mp3', size: 1, mtimeMs: 1 })
    expect(store.listFiles(grab, true)).toHaveLength(2)
  })

  it('counts direct files per folder', () => {
    const { libraryId, root, grab, walk } = seed()
    const counts = new Map(store.getFolders(libraryId).map((f) => [f.id, f.fileCount]))
    expect(counts.get(root)).toBe(0)
    expect(counts.get(grab)).toBe(2)
    expect(counts.get(walk)).toBe(1)
  })

  it('pages through files that still need details and skips broken ones', () => {
    const { libraryId, grabA, walkA } = seed()
    store.markBroken(walkA)
    const first = store.filesNeedingDetails(libraryId, 0, 1)
    expect(first).toEqual([{ id: grabA, path: join('/sfx/BF1', 'Grab', 'Grab 0.mp3') }])
    const rest = store.filesNeedingDetails(libraryId, first[0].id, 10)
    expect(rest).toHaveLength(1)
    expect(store.countFilesNeedingDetails(libraryId)).toBe(2)
    expect(store.librariesNeedingDetails()).toEqual([libraryId])
  })

  it('keeps keywords when a library is removed with them kept, and restores it', () => {
    const { libraryId, grabA } = seed()
    db.prepare("INSERT INTO keywords (id, name) VALUES (1, 'melee')").run()
    db.prepare('INSERT INTO file_keywords (file_id, keyword_id) VALUES (?, 1)').run(grabA)
    expect(store.keywordUseCount(libraryId)).toBe(1)

    store.removeLibrary(libraryId, true)
    expect(store.listLibraries()).toHaveLength(0)
    expect(store.totals()).toEqual({ libraries: 0, files: 0 })
    expect(store.findLibraryByRoot('/sfx/BF1/')?.removedAt).not.toBeNull()

    store.restoreLibrary(libraryId, '/sfx/BF1')
    expect(store.listLibraries()).toHaveLength(1)
    expect(store.keywordUseCount(libraryId)).toBe(1)
  })

  it('deletes the library and unused keywords when asked', () => {
    const { libraryId, grabA } = seed()
    db.prepare("INSERT INTO keywords (id, name) VALUES (1, 'melee')").run()
    db.prepare('INSERT INTO file_keywords (file_id, keyword_id) VALUES (?, 1)').run(grabA)

    store.removeLibrary(libraryId, false)
    expect(store.findLibraryByRoot('/sfx/BF1')).toBeNull()
    const { n } = db.prepare('SELECT count(*) AS n FROM keywords').get() as { n: number }
    expect(n).toBe(0)
  })

  it('matches library roots case-insensitively on Windows and macOS', () => {
    const windows = new LibraryStore(db, 'win32')
    windows.createLibrary('SFX', 'D:\\SFX\\Foleys', 0)
    expect(windows.findLibraryByRoot('d:\\sfx\\FOLEYS\\')).not.toBeNull()
    expect(store.findLibraryByRoot('/SFX/BF1')).toBeNull()
  })

  it('reports totals and the last scan', () => {
    const { libraryId } = seed()
    expect(store.lastScan()).toBeNull()
    store.markScanned(libraryId, 1234)
    expect(store.lastScan()).toEqual({ libraryName: 'BF1', at: 1234 })
    expect(store.totals()).toEqual({ libraries: 1, files: 3 })
  })

  it('keeps waveforms of long files only and ignores one of an older file version', () => {
    const { libraryId, grab, grabA, walkA } = seed()
    const waveforms = () => (db.prepare('SELECT count(*) AS n FROM file_peaks').get() as { n: number }).n
    const outline = new Uint8Array([1, 1, 0, 4, 0, 64, 128, 255])
    store.saveDetails(grabA, { ...DETAILS, duration: 45 })
    store.saveDetails(walkA, { ...DETAILS, duration: 3 })
    expect(store.readPeaks(grabA)).toBeNull()

    store.writePeaks(grabA, outline)
    store.writePeaks(walkA, outline)
    expect(waveforms()).toBe(1)
    // 64 levels: within 3 of the original.
    expect(Array.from(store.readPeaks(grabA) ?? [])).toEqual([1, 1, 0, 4, 0, 65, 130, 255])

    store.upsertFile(grab, { name: 'Grab 0.mp3', ext: 'mp3', size: 200, mtimeMs: 2 })
    expect(store.readPeaks(grabA)).toBeNull()

    store.removeLibrary(libraryId, false)
    expect(waveforms()).toBe(0)
  })
})

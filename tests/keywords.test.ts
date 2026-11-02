import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'
import { KeywordStore } from '../src/main/keyword-store'
import { LibraryStore } from '../src/main/library-store'
import { SearchEngine } from '../src/main/search/engine'
import { MatchedIn } from '../src/shared/api'
import { normalizeKeyword, suggestKeywords, type KeywordSummary } from '../src/shared/keywords'

let store: LibraryStore
let keywords: KeywordStore

function seed() {
  const libraryId = store.createLibrary('BF1', '/sfx/BF1', 0)
  const root = store.upsertFolder(libraryId, null, '', 'BF1')
  const grab = store.upsertFolder(libraryId, root, 'Grab', 'Grab')
  const walk = store.upsertFolder(libraryId, root, 'Walk', 'Walk')
  const file = { ext: 'mp3', size: 100, mtimeMs: 1 }
  const a = store.upsertFile(grab, { ...file, name: 'Grab 0.mp3' })
  const b = store.upsertFile(grab, { ...file, name: 'Grab 1.mp3' })
  const c = store.upsertFile(walk, { ...file, name: 'Walk 0.mp3' })
  return { libraryId, root, grab, walk, a, b, c }
}

const byName = () => Object.fromEntries(keywords.list().map((k) => [k.name, k.files]))

beforeEach(() => {
  const db = openDatabase(':memory:')
  store = new LibraryStore(db, 'linux')
  keywords = new KeywordStore(db)
})

describe('normalizeKeyword', () => {
  it('lower-cases, trims and keeps single spaces', () => {
    expect(normalizeKeyword('  Cracking   ICE ')).toBe('cracking ice')
    expect(normalizeKeyword('a,b')).toBe('a b')
    expect(normalizeKeyword('   ')).toBe('')
  })
})

describe('KeywordStore', () => {
  it('adds a keyword to several files once and lists it with a count', () => {
    const { a, b, grab } = seed()
    keywords.add([a, b], 'Wood')
    const change = keywords.add([a], ' wood ')
    expect(change.files).toEqual([{ id: a, keywords: ['wood'] }])
    expect(byName()).toEqual({ wood: 2 })
    expect(store.listFiles(grab, false).map((file) => file.keywords)).toEqual([['wood'], ['wood']])
  })

  it('keeps keywords in the order they were added', () => {
    const { a } = seed()
    keywords.add([a], 'zebra')
    keywords.add([a], 'apple')
    expect(store.filesByIds([a])[0].keywords).toEqual(['zebra', 'apple'])
  })

  it('removes a keyword from files and deletes it with its last use', () => {
    const { a, b } = seed()
    keywords.add([a, b], 'wood')
    keywords.remove([a], 'wood')
    expect(byName()).toEqual({ wood: 1 })
    expect(keywords.remove([b], 'wood').files).toEqual([{ id: b, keywords: [] }])
    expect(keywords.list()).toEqual([])
  })

  it('renames, or reports the keyword that already has the name', () => {
    const { a, b } = seed()
    keywords.add([a], 'wod')
    keywords.add([b], 'wood')
    const [wod] = keywords.list().filter((k) => k.name === 'wod')
    const result = keywords.rename(wod.id, 'Wood')
    expect(result).toMatchObject({ ok: false, reason: 'exists', existing: { name: 'wood', files: 1 } })
    expect(keywords.rename(wod.id, 'planks')).toEqual({ ok: true })
    expect(byName()).toEqual({ planks: 1, wood: 1 })
  })

  it('merges one keyword into another', () => {
    const { a, b } = seed()
    keywords.add([a, b], 'wod')
    keywords.add([a], 'wood')
    const ids = Object.fromEntries(keywords.list().map((k) => [k.name, k.id]))
    keywords.merge(ids.wod, ids.wood)
    expect(byName()).toEqual({ wood: 2 })
    expect(store.filesByIds([a, b]).map((file) => file.keywords)).toEqual([['wood'], ['wood']])
  })

  it('deletes a keyword from every file and lists its files', () => {
    const { a, c } = seed()
    keywords.add([a, c], 'foley')
    const [foley] = keywords.list()
    expect(keywords.fileIds(foley.id).sort()).toEqual([a, c].sort())
    keywords.delete(foley.id)
    expect(keywords.list()).toEqual([])
    expect(store.filesByIds([a])[0].keywords).toEqual([])
  })

  it('does not count files of a removed library', () => {
    const { libraryId, a } = seed()
    keywords.add([a], 'wood')
    store.removeLibrary(libraryId, true)
    expect(keywords.list()).toEqual([])
  })

  it('feeds keywords to the search index', () => {
    const { a } = seed()
    keywords.add([a], 'cracking ice')
    expect(store.searchData().files.find((file) => file.id === a)?.keywords).toEqual(['cracking ice'])
  })
})

describe('folder keywords', () => {
  it('adds and removes keywords of a folder and counts the folders', () => {
    const { walk } = seed()
    expect(keywords.addToFolder(walk, ' Steps ')).toEqual(['steps'])
    expect(keywords.addToFolder(walk, 'steps')).toEqual(['steps'])
    expect(keywords.list()).toMatchObject([{ name: 'steps', files: 0, folders: 1 }])
    expect(store.getFolders(store.listLibraries()[0].id).find((folder) => folder.id === walk)?.keywords).toEqual(['steps'])
    expect(keywords.removeFromFolder(walk, 'steps')).toEqual([])
    expect(keywords.list()).toEqual([])
  })

  it('finds every file below the folder without giving them the keyword (stage 6)', () => {
    const libraryId = store.createLibrary('BF1', '/sfx/BF1', 0)
    const root = store.upsertFolder(libraryId, null, '', 'BF1')
    const sentry = store.upsertFolder(libraryId, root, 'Sentry', 'Sentry')
    const file = { ext: 'mp3', size: 1, mtimeMs: 1 }
    const below = ['Walk', 'Sprint', 'Land'].map((name) => {
      const folder = store.upsertFolder(libraryId, sentry, `Sentry/${name}`, name)
      return store.upsertFile(folder, { ...file, name: `Sentry ${name} 0.mp3` })
    })
    const grab = store.upsertFolder(libraryId, root, 'Grab', 'Grab')
    store.upsertFile(grab, { ...file, name: 'Grab 0.mp3' })
    keywords.addToFolder(sentry, 'heavy armor')

    const result = new SearchEngine(store.searchData()).search({ query: 'heavy armor', scope: 'keywords', libraryId: null, exact: false, sort: { key: 'relevance', direction: 1 }, favoritesOnly: false }, 100)
    expect([...result.ids].sort()).toEqual([...below].sort())
    expect(result.matchedIn.every((bits) => bits === MatchedIn.folderKeywords)).toBe(true)
    expect(store.filesByIds(below).map((row) => row.keywords)).toEqual([[], [], []])
  })
})

describe('suggestKeywords', () => {
  const catalog: KeywordSummary[] = [
    ['foley', 3410],
    ['creature', 1018],
    ['creak', 233],
    ['crescendo', 41],
    ['cracking ice', 37],
    ['ice', 5],
    ['scream', 300]
  ].map(([name, files], id) => ({ id, name: name as string, files: files as number, folders: 0 }))
  const names = (typed: string, exclude: string[] = []) =>
    suggestKeywords(catalog, typed, new Set(exclude)).map((s) => s.keyword.name)

  it('puts word starts first, then words containing it, most used first', () => {
    expect(names('cre')).toEqual(['creature', 'creak', 'crescendo', 'scream'])
    expect(names('ice')).toEqual(['ice', 'cracking ice'])
    expect(names('rea')).toEqual(['creature', 'scream', 'creak'])
  })

  it('suggests keywords with a typo last', () => {
    expect(names('crature')).toEqual(['creature'])
    expect(names('foel')).toEqual(['foley'])
  })

  it('leaves out keywords the file already has', () => {
    expect(names('cre', ['creature'])).toEqual(['creak', 'crescendo', 'scream'])
  })

  it('marks the typed text in the name', () => {
    expect(suggestKeywords(catalog, 'ack', new Set())[0].match).toEqual([2, 5])
  })
})

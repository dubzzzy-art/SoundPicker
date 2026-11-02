import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { MatchedIn, type SearchRequest } from '../src/shared/api'
import { allowedTypos, missesOneLetter, typoDistance } from '../src/shared/distance'
import { SearchEngine, type SearchData } from '../src/main/search/engine'

// Optional real library: SOUNDPICKER_BF1=/path/to/BF1 npm test
const BF1 = process.env.SOUNDPICKER_BF1 ?? ''

const ask = (query: string, options: Partial<SearchRequest> = {}): SearchRequest => ({
  query,
  scope: 'all',
  libraryId: null,
  exact: false,
  sort: { key: 'relevance', direction: 1 },
  favoritesOnly: false,
  ...options
})

function sample(): SearchData {
  return {
    libraries: [
      { id: 1, name: 'Foleys' },
      { id: 2, name: 'Other' }
    ],
    folders: [
      { id: 10, libraryId: 1, parentId: null, relPath: '', keywords: [] },
      { id: 11, libraryId: 1, parentId: 10, relPath: 'Footsteps', keywords: [] },
      { id: 12, libraryId: 1, parentId: 11, relPath: 'Footsteps/Wood', keywords: ['creak'] },
      { id: 13, libraryId: 1, parentId: 12, relPath: 'Footsteps/Wood/Ship', keywords: [] },
      { id: 14, libraryId: 1, parentId: 10, relPath: 'Doors', keywords: [] },
      { id: 20, libraryId: 2, parentId: null, relPath: '', keywords: [] }
    ],
    files: [
      { id: 1, folderId: 12, name: 'Footstep_Wood_Creaky_Floor_03.wav', duration: 3, channels: 2, keywords: ['floorboard'] },
      { id: 2, folderId: 12, name: 'Floorboard_Slow_02.wav', duration: 1, channels: 1, keywords: [] },
      { id: 3, folderId: 13, name: 'Ship_Deck_Walk_Heavy.wav', duration: null, keywords: [] },
      { id: 4, folderId: 14, name: 'Door_Wood_Creak_Open_07.wav', duration: 2, favorite: true, keywords: ['door'] },
      { id: 5, folderId: 14, name: 'DoorWoodCreak.wav', duration: 5, channels: 2, keywords: [] },
      { id: 6, folderId: 20, name: 'Footsteps_Gravel.wav', duration: 4, keywords: [] }
    ]
  }
}

describe('typo distance', () => {
  it('counts a swap of neighbouring letters as one typo', () => {
    expect(typoDistance('wod', 'wood', 1)).toBe(1)
    expect(typoDistance('foostep', 'footstep', 1)).toBe(1)
    expect(typoDistance('meele', 'melee', 1)).toBe(1)
    expect(typoDistance('sentri', 'sentry', 1)).toBe(1)
    expect(typoDistance('abcdef', 'ghijkl', 2)).toBe(3)
  })

  it('allows more typos in longer words', () => {
    expect([allowedTypos('wod'), allowedTypos('wood'), allowedTypos('footstep')]).toEqual([0, 1, 2])
    expect([missesOneLetter('wod', 'wood'), missesOneLetter('wod', 'god'), missesOneLetter('wod', 'wodka')]).toEqual([true, false, false])
  })
})

describe('search engine', () => {
  const engine = new SearchEngine(sample())
  const ids = (request: SearchRequest) => engine.search(request, 100).ids

  it('sorts every match before picking the shown ones', () => {
    const sorted = (key: SearchRequest['sort']['key'], direction: 1 | -1, limit: number) =>
      engine.search(ask('wood ', { sort: { key, direction } }), limit)
    const all = sorted('relevance', 1, 100).ids
    expect(all).toHaveLength(5)
    expect(all.slice(0, 2)).not.toEqual([4, 5])
    expect(sorted('relevance', -1, 100).ids).toEqual([...all].reverse())
    expect(sorted('name', 1, 2)).toMatchObject({ ids: [4, 5], total: 5 })
    expect(sorted('name', -1, 2).ids).toEqual([3, 1])
    expect(sorted('duration', 1, 3).ids).toEqual([3, 2, 4])
    expect(sorted('duration', -1, 1).ids).toEqual([5])
  })

  it('needs every word, in any order', () => {
    expect(ids(ask('wood door'))).toEqual([5, 4])
    expect(ids(ask('door wood'))).toEqual([5, 4])
    expect(ids(ask('door gravel'))).toEqual([])
  })

  it('treats the last word as the start of a word while typing', () => {
    expect(ids(ask('grav'))).toEqual([6])
    expect(ids(ask('grav '))).toEqual([])
  })

  it('forgives typos and says what it read', () => {
    const result = engine.search(ask('foostep wod '), 100)
    expect(result.ids).toEqual([1])
    expect(result.corrections).toEqual([
      { from: 'foostep', to: 'footstep' },
      { from: 'wod', to: 'wood' }
    ])
    expect(engine.search(ask('foostep wod ', { exact: true }), 100).ids).toEqual([])
  })

  it('weighs names, own keywords and folder keywords the same, paths lower, shorter names first', () => {
    const result = engine.search(ask('creak '), 100)
    expect(result.ids).toEqual([5, 2, 3, 4, 1])
    expect(result.relevance).toEqual([100, 100, 100, 100, 100])
    expect(result.matchedIn[0]).toBe(MatchedIn.name)
    expect(result.matchedIn[1]).toBe(MatchedIn.folderKeywords)
    expect(engine.search(ask('floorboard '), 100).matchedIn).toEqual([MatchedIn.name, MatchedIn.keywords])
    const wood = engine.search(ask('wood '), 100)
    expect(wood.ids).toEqual([5, 4, 1, 2, 3])
    expect(wood.relevance).toEqual([100, 100, 100, 55, 55])
  })

  it('shows relevance against the best match, which is always 100', () => {
    expect(engine.search(ask('floor'), 100).relevance).toEqual([100, 85])
    expect(engine.search(ask('wlak '), 100).relevance).toEqual([100])
    // First by name (Z to A) is a path match; the top file is not in the sent part and still counts.
    const byName = engine.search(ask('wood ', { sort: { key: 'name', direction: -1 } }), 1)
    expect(byName.ids).toEqual([3])
    expect(byName.relevance).toEqual([55])
  })

  it('limits the search to a scope or a library', () => {
    expect(ids(ask('ship ', { scope: 'name' }))).toEqual([3])
    expect(ids(ask('wood ', { scope: 'path' }))).toEqual([2, 3, 1])
    expect(ids(ask('creak ', { scope: 'keywords' }))).toEqual([2, 3, 1])
    expect(ids(ask('footstep', { libraryId: 2 }))).toEqual([6])
  })

  it('finds files by "mono" and "stereo"', () => {
    const engine = new SearchEngine(sample())
    const found = (request: SearchRequest) => [...engine.search(request, 100).ids].sort()
    expect(found(ask('stereo '))).toEqual([1, 5])
    expect(found(ask('mono '))).toEqual([2])
    expect(found(ask('wood stereo '))).toEqual([1, 5])
    expect(found(ask('stereo ', { scope: 'name' }))).toEqual([])
    expect(engine.search(ask('mono '), 100).matchedIn).toEqual([MatchedIn.channels])
  })

  it('keeps only starred files when asked, and follows new stars', () => {
    const engine = new SearchEngine(sample())
    const found = (request: SearchRequest) => [...engine.search(request, 100).ids].sort()
    expect(found(ask('wood ', { favoritesOnly: true }))).toEqual([4])
    engine.setFavorite([5], true)
    engine.setFavorite([4], false)
    expect(found(ask('wood ', { favoritesOnly: true }))).toEqual([5])
    expect(found(ask('wood ')).length).toBeGreaterThan(1)
  })

  it('marks what to highlight', () => {
    const { highlights } = engine.search(ask('wod flo'), 100)
    expect(highlights.wood).toBe(0)
    expect(highlights.floor).toBe(3)
  })
})

describe.skipIf(!BF1 || !existsSync(BF1))('search in BF1', () => {
  function loadBF1(): { data: SearchData; names: Map<number, string> } {
    const data: SearchData = { libraries: [{ id: 1, name: 'BF1' }], folders: [], files: [] }
    const names = new Map<number, string>()
    const folderIds = new Map<string, number>()
    const walk = (dir: string, parentId: number | null) => {
      const relPath = relative(BF1, dir).split(sep).join('/')
      const id = data.folders.length + 1
      folderIds.set(relPath, id)
      data.folders.push({ id, libraryId: 1, parentId, relPath, keywords: [] })
      for (const entry of readdirSync(dir).sort()) {
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) walk(path, id)
        else if (entry.endsWith('.mp3')) {
          const fileId = data.files.length + 1
          data.files.push({ id: fileId, folderId: id, name: entry, keywords: [] })
          names.set(fileId, `${relPath}/${entry}`)
        }
      }
    }
    walk(BF1, null)
    return { data, names }
  }

  // Loaded when the tests run: a skipped suite is still collected.
  let engine: SearchEngine
  let names: Map<number, string>
  beforeAll(() => {
    const loaded = loadBF1()
    engine = new SearchEngine(loaded.data)
    names = loaded.names
  })
  const top5 = (query: string) => engine.search(ask(query), 5).ids.map((id) => names.get(id)!)

  it('finds grabs for "meele grab"', () => {
    const found = top5('meele grab')
    expect(found.length).toBe(5)
    expect(found.every((name) => /melee/i.test(name) && /grab/i.test(name))).toBe(true)
  })

  it('finds Sentry prone sounds for "prone sentri"', () => {
    const found = top5('prone sentri')
    expect(found.length).toBeGreaterThan(0)
    expect(found.every((name) => /prone/i.test(name) && /sentry/i.test(name))).toBe(true)
  })
})

describe('search speed', () => {
  it('answers in under 100 ms on 150 000 files', () => {
    let seed = 7
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const letters = 'abcdefghijklmnopqrstuvwxyz'
    const vocabulary = Array.from({ length: 20000 }, () =>
      Array.from({ length: 4 + Math.floor(random() * 7) }, () => letters[Math.floor(random() * 26)]).join('')
    )
    const pick = () => vocabulary[Math.floor(random() * vocabulary.length)]
    const data: SearchData = { libraries: [{ id: 1, name: 'Big' }], folders: [], files: [] }
    for (let f = 0; f < 3000; f++) {
      data.folders.push({ id: f + 1, libraryId: 1, parentId: null, relPath: `${pick()}/${pick()}`, keywords: [] })
    }
    for (let i = 0; i < 150000; i++) {
      data.files.push({ id: i + 1, folderId: 1 + (i % 3000), name: `${pick()}_${pick()}_${pick()}_${i % 40}.wav`, keywords: [] })
    }
    const built = performance.now()
    const engine = new SearchEngine(data)
    const buildMs = performance.now() - built

    const queries = [vocabulary[5].slice(0, 3), `${vocabulary[10]} ${vocabulary[20].slice(0, 4)}`, `${vocabulary[30]}x ${vocabulary[40]}`, '1']
    const times = queries.map((query) => {
      const started = performance.now()
      engine.search(ask(query), 5000)
      return performance.now() - started
    })
    console.log(`index of 150 000 files built in ${buildMs.toFixed(0)} ms; queries ${times.map((t) => t.toFixed(1)).join(', ')} ms`)
    expect(Math.max(...times)).toBeLessThan(100)
  })
})

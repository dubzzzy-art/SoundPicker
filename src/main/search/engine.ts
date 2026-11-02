import { MatchedIn, type SearchRequest, type SearchScope } from '../../shared/api'
import { splitWords, stem } from '../../shared/words'
import { allowedTypos, missesOneLetter, typoDistance } from '../../shared/distance'
import { compareNames } from '../../shared/names'

export interface SearchData {
  libraries: { id: number; name: string }[]
  folders: { id: number; libraryId: number; parentId: number | null; relPath: string; keywords: string[] }[]
  files: { id: number; folderId: number; name: string; duration?: number | null; channels?: number | null; favorite?: boolean; keywords: string[] }[]
}

export interface EngineResult {
  ids: number[]
  relevance: number[]
  matchedIn: number[]
  total: number
  corrections: { from: string; to: string }[]
  highlights: Record<string, number>
}

const EXACT = 1
const PREFIX = 0.85
const TYPO = [1, 0.65, 0.5]
const TYPO_PREFIX = [1, 0.55, 0.45]

type Source = 'name' | 'keywords' | 'folderKeywords' | 'path' | 'channels'
const SOURCE_WEIGHT: Record<Source, number> = { name: 1, keywords: 1, folderKeywords: 1, path: 0.55, channels: 1 }
const SCOPE_SOURCES: Record<SearchScope, Source[]> = {
  all: ['name', 'keywords', 'folderKeywords', 'path', 'channels'],
  name: ['name'],
  path: ['path'],
  keywords: ['keywords', 'folderKeywords']
}
const FOLDER_SOURCES = new Set<Source>(['folderKeywords', 'path'])
const HIGHLIGHT_LIMIT = 2000

interface Candidate {
  token: number
  weight: number
  highlight: number
  typos: number
}

class Postings {
  readonly offsets: Int32Array
  readonly items: Int32Array

  constructor(lists: number[][]) {
    this.offsets = new Int32Array(lists.length + 1)
    let total = 0
    lists.forEach((list, i) => {
      this.offsets[i] = total
      total += list.length
    })
    this.offsets[lists.length] = total
    this.items = new Int32Array(total)
    lists.forEach((list, i) => this.items.set(list, this.offsets[i]))
  }

  forEach(token: number, visit: (item: number) => void): void {
    if (token >= this.offsets.length - 1) return
    for (let i = this.offsets[token]; i < this.offsets[token + 1]; i++) visit(this.items[i])
  }
}

export class SearchEngine {
  private readonly words: string[] = []
  private readonly wordIds = new Map<string, number>()
  private readonly fileIds: Int32Array
  private readonly fileFolder: Int32Array
  private readonly nameLength: Uint16Array
  private readonly names: string[]
  // -1: not read yet.
  private readonly durations: Float64Array
  private nameRanks: Int32Array | null = null
  private readonly favorites: Uint8Array
  private fileIndex: Map<number, number> | null = null
  private readonly folderLibrary: Int32Array
  private readonly folderFiles: Postings
  private readonly postings: Record<Source, Postings>
  private readonly documentCount: Int32Array

  private readonly wordScore: Float32Array
  private readonly wordSource: Uint8Array
  private readonly folderScore: Float32Array
  private readonly folderSource: Uint8Array
  private readonly totalScore: Float32Array
  private readonly matchedWords: Uint8Array
  private readonly matchedIn: Uint8Array

  constructor(data: SearchData) {
    const folderIndex = new Map(data.folders.map((folder, i) => [folder.id, i]))
    const libraryNames = new Map(data.libraries.map((library) => [library.id, library.name]))
    const lists: Record<Source, number[][]> = { name: [], keywords: [], folderKeywords: [], path: [], channels: [] }
    const add = (source: Source, text: string, doc: number, seen: Set<number>) => {
      for (const { word } of splitWords(text)) {
        const id = this.wordId(word)
        if (seen.has(id)) continue
        seen.add(id)
        ;(lists[source][id] ??= []).push(doc)
      }
    }

    this.folderLibrary = new Int32Array(data.folders.length)
    const folderFileLists: number[][] = data.folders.map(() => [])
    const inherited = new Map<number, string[]>()
    const keywordsOf = (i: number): string[] => {
      const known = inherited.get(i)
      if (known) return known
      const folder = data.folders[i]
      const parent = folder.parentId === null ? undefined : folderIndex.get(folder.parentId)
      const all = parent === undefined ? folder.keywords : [...keywordsOf(parent), ...folder.keywords]
      inherited.set(i, all)
      return all
    }
    data.folders.forEach((folder, i) => {
      this.folderLibrary[i] = folder.libraryId
      add('path', `${libraryNames.get(folder.libraryId) ?? ''} ${folder.relPath}`, i, new Set())
      const seen = new Set<number>()
      for (const keyword of keywordsOf(i)) add('folderKeywords', keyword, i, seen)
    })

    this.fileIds = new Int32Array(data.files.length)
    this.fileFolder = new Int32Array(data.files.length)
    this.nameLength = new Uint16Array(data.files.length)
    this.names = data.files.map((file) => file.name)
    this.durations = Float64Array.from(data.files, (file) => file.duration ?? -1)
    this.favorites = Uint8Array.from(data.files, (file) => (file.favorite ? 1 : 0))
    data.files.forEach((file, i) => {
      const folder = folderIndex.get(file.folderId) ?? 0
      this.fileIds[i] = file.id
      this.fileFolder[i] = folder
      this.nameLength[i] = Math.min(65535, file.name.length)
      folderFileLists[folder]?.push(i)
      add('name', stem(file.name), i, new Set())
      const seen = new Set<number>()
      for (const keyword of file.keywords) add('keywords', keyword, i, seen)
      const channels = file.channels === 1 ? 'mono' : file.channels === 2 ? 'stereo' : null
      if (channels) add('channels', channels, i, new Set())
    })

    const pack = (source: Source) => new Postings(Array.from({ length: this.words.length }, (_, id) => lists[source][id] ?? []))
    this.postings = {
      name: pack('name'),
      keywords: pack('keywords'),
      folderKeywords: pack('folderKeywords'),
      path: pack('path'),
      channels: pack('channels')
    }
    this.folderFiles = new Postings(folderFileLists)
    this.documentCount = Int32Array.from(this.words, (_, id) =>
      (Object.keys(lists) as Source[]).reduce((sum, source) => sum + (lists[source][id]?.length ?? 0), 0)
    )

    const files = data.files.length
    const folders = data.folders.length
    this.wordScore = new Float32Array(files)
    this.wordSource = new Uint8Array(files)
    this.folderScore = new Float32Array(folders)
    this.folderSource = new Uint8Array(folders)
    this.totalScore = new Float32Array(files)
    this.matchedWords = new Uint8Array(files)
    this.matchedIn = new Uint8Array(files)
  }

  get size(): number {
    return this.fileIds.length
  }

  setFavorite(ids: number[], favorite: boolean): void {
    this.fileIndex ??= new Map(Array.from(this.fileIds, (id, i) => [id, i]))
    for (const id of ids) {
      const i = this.fileIndex.get(id)
      if (i !== undefined) this.favorites[i] = favorite ? 1 : 0
    }
  }

  search(request: SearchRequest, limit: number): EngineResult {
    const query = request.query
    const parsed = splitWords(query)
    const empty: EngineResult = { ids: [], relevance: [], matchedIn: [], total: 0, corrections: [], highlights: {} }
    if (parsed.length === 0) return empty

    const typing = parsed[parsed.length - 1].end === query.length
    const words: { word: string; last: boolean }[] = []
    parsed.forEach((item, i) => {
      const last = typing && i === parsed.length - 1
      const existing = words.find((w) => w.word === item.word)
      if (existing) existing.last ||= last
      else words.push({ word: item.word, last })
    })

    const sources = SCOPE_SOURCES[request.scope]
    const corrections: EngineResult['corrections'] = []
    const highlights: Record<string, number> = {}
    let highlightCount = 0
    const touchedFiles: number[] = []

    for (const { word, last } of words) {
      const candidates = this.candidates(word, last, request.exact)
      if (candidates.length === 0) {
        this.reset(touchedFiles)
        return { ...empty, corrections }
      }
      const correction = this.correction(candidates)
      if (correction) corrections.push({ from: word, to: correction })
      for (const candidate of candidates) {
        if (highlightCount >= HIGHLIGHT_LIMIT) break
        const token = this.words[candidate.token]
        const current = highlights[token]
        if (current === undefined) highlightCount++
        if (current === undefined || current !== 0) highlights[token] = candidate.highlight === 0 || current === 0 ? 0 : Math.max(current ?? 0, candidate.highlight)
      }
      this.scoreWord(candidates, sources, touchedFiles)
    }

    const matches: number[] = []
    for (const file of touchedFiles) {
      if (this.matchedWords[file] !== words.length) continue
      if (request.libraryId !== null && this.folderLibrary[this.fileFolder[file]] !== request.libraryId) continue
      if (request.favoritesOnly && !this.favorites[file]) continue
      matches.push(file)
    }
    this.sortMatches(matches, request.sort)
    // Relevance is shown against the best match of the whole result, so the top file is always 100.
    let top = 0
    for (const file of matches) top = Math.max(top, this.totalScore[file])
    const best = matches.slice(0, limit)
    const result: EngineResult = {
      ids: best.map((file) => this.fileIds[file]),
      relevance: best.map((file) => Math.round((this.totalScore[file] / top) * 100)),
      matchedIn: best.map((file) => this.matchedIn[file]),
      total: matches.length,
      corrections,
      highlights
    }
    this.reset(touchedFiles)
    return result
  }

  private sortMatches(matches: number[], { key, direction }: SearchRequest['sort']): void {
    if (key === 'relevance') {
      matches.sort(
        (a, b) =>
          this.totalScore[b] - this.totalScore[a] || this.nameLength[a] - this.nameLength[b] || this.fileIds[a] - this.fileIds[b]
      )
      if (direction === -1) matches.reverse()
      return
    }
    const rank = this.nameRank()
    const durations = this.durations
    if (key === 'duration') matches.sort((a, b) => (durations[a] - durations[b] || rank[a] - rank[b]) * direction)
    else matches.sort((a, b) => (rank[a] - rank[b]) * direction)
  }

  private nameRank(): Int32Array {
    if (!this.nameRanks) {
      const names = this.names
      const order = Int32Array.from(names, (_, i) => i).sort((a, b) => compareNames(names[a], names[b]) || a - b)
      this.nameRanks = new Int32Array(names.length)
      order.forEach((file, place) => (this.nameRanks![file] = place))
    }
    return this.nameRanks
  }

  private reset(touchedFiles: number[]): void {
    for (const file of touchedFiles) {
      this.totalScore[file] = 0
      this.matchedWords[file] = 0
      this.matchedIn[file] = 0
    }
  }

  private wordId(word: string): number {
    let id = this.wordIds.get(word)
    if (id === undefined) {
      id = this.words.length
      this.words.push(word)
      this.wordIds.set(word, id)
    }
    return id
  }

  private candidates(word: string, last: boolean, exact: boolean): Candidate[] {
    const found: Candidate[] = []
    const exactId = this.wordIds.get(word)
    if (exactId !== undefined) found.push({ token: exactId, weight: EXACT, highlight: 0, typos: 0 })
    const typos = exact ? 0 : allowedTypos(word)
    const shortWord = !exact && word.length === 3
    if (!last && typos === 0 && !shortWord) return found

    for (let id = 0; id < this.words.length; id++) {
      if (id === exactId) continue
      const token = this.words[id]
      if (last && token.length > word.length && token.startsWith(word)) {
        found.push({ token: id, weight: PREFIX, highlight: word.length, typos: 0 })
        continue
      }
      if (shortWord && missesOneLetter(word, token)) {
        found.push({ token: id, weight: TYPO[1], highlight: 0, typos: 1 })
        continue
      }
      if (typos === 0) continue
      const whole = typoDistance(word, token, typos)
      if (whole <= typos) {
        found.push({ token: id, weight: TYPO[whole], highlight: 0, typos: whole })
        continue
      }
      if (last && token.length > word.length) {
        const start = typoDistance(word, token.slice(0, word.length), typos)
        if (start <= typos) found.push({ token: id, weight: TYPO_PREFIX[start], highlight: word.length, typos: start })
      }
    }
    return found
  }

  private correction(candidates: Candidate[]): string | null {
    if (candidates.some((candidate) => candidate.typos === 0)) return null
    let best: Candidate | null = null
    for (const candidate of candidates) {
      if (
        !best ||
        candidate.typos < best.typos ||
        (candidate.typos === best.typos && this.documentCount[candidate.token] > this.documentCount[best.token])
      ) {
        best = candidate
      }
    }
    return best ? this.words[best.token] : null
  }

  private scoreWord(candidates: Candidate[], sources: Source[], touchedFiles: number[]): void {
    const wordFiles: number[] = []
    const wordFolders: number[] = []
    const markFile = (file: number, score: number, source: number) => {
      if (this.wordScore[file] === 0) wordFiles.push(file)
      if (score > this.wordScore[file]) {
        this.wordScore[file] = score
        this.wordSource[file] = source
      }
    }
    for (const candidate of candidates) {
      for (const source of sources) {
        const score = candidate.weight * SOURCE_WEIGHT[source]
        const bit = MatchedIn[source]
        if (FOLDER_SOURCES.has(source)) {
          this.postings[source].forEach(candidate.token, (folder) => {
            if (this.folderScore[folder] === 0) wordFolders.push(folder)
            if (score > this.folderScore[folder]) {
              this.folderScore[folder] = score
              this.folderSource[folder] = bit
            }
          })
        } else {
          this.postings[source].forEach(candidate.token, (file) => markFile(file, score, bit))
        }
      }
    }
    for (const folder of wordFolders) {
      const score = this.folderScore[folder]
      const bit = this.folderSource[folder]
      this.folderFiles.forEach(folder, (file) => markFile(file, score, bit))
      this.folderScore[folder] = 0
      this.folderSource[folder] = 0
    }
    for (const file of wordFiles) {
      if (this.matchedWords[file] === 0) touchedFiles.push(file)
      this.totalScore[file] += this.wordScore[file]
      this.matchedWords[file]++
      this.matchedIn[file] |= this.wordSource[file]
      this.wordScore[file] = 0
      this.wordSource[file] = 0
    }
  }
}

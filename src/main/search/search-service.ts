import { Worker } from 'node:worker_threads'
import type { SearchRequest, SearchResponse } from '../../shared/api'
import type { LibraryStore } from '../library-store'
import { log } from '../log'
import type { EngineResult } from './engine'
import type { FromSearchWorker, ToSearchWorker } from './worker'

const RESULT_LIMIT = 500
const REBUILD_DELAY_MS = 1000
export const KEYWORD_REBUILD_DELAY_MS = 150
export const INDEXING_REBUILD_GAP_MS = 10000

interface Pending {
  request: SearchRequest
  resolve(response: SearchResponse | null): void
}

export class SearchService {
  // null: the thread died; the next search starts a new one, however often it died before.
  private worker: Worker | null = null
  private stopped = false
  // Deaths in a row with no search answered between them; only logged.
  private crashes = 0
  // Announced builds the current thread has not answered yet.
  private announcing = 0
  // Changed data the window has not been told about: the restart's build is then announced.
  // Otherwise a restart rebuilds unchanged data quietly, so the window does not rerun the
  // query that may have killed the thread.
  private announceOwed = false
  private nextId = 1
  private running: { id: number; pending: Pending; started: number } | null = null
  private waiting: Pending | null = null
  private rebuildTimer: NodeJS.Timeout | null = null
  private rebuildDue = 0
  private lastBuildAt = 0

  constructor(
    private readonly workerPath: string,
    private readonly databasePath: string,
    private readonly store: LibraryStore,
    private readonly onIndexChanged: () => void
  ) {
    this.start(true)
  }

  // Not sooner than `minGapMs` after the last build; a rebuild already due sooner is kept.
  invalidate(delayMs = REBUILD_DELAY_MS, minGapMs = 0): void {
    if (this.stopped) return
    const due = Math.max(Date.now() + delayMs, this.lastBuildAt + minGapMs)
    if (this.rebuildTimer) {
      if (this.rebuildDue <= due) return
      clearTimeout(this.rebuildTimer)
    }
    this.rebuildDue = due
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null
      this.lastBuildAt = Date.now()
      if (this.worker) this.build(true)
      else this.announceOwed = true
    }, due - Date.now())
  }

  search(request: SearchRequest): Promise<SearchResponse | null> {
    return new Promise((resolve) => {
      this.waiting?.resolve(null)
      this.waiting = { request, resolve }
      this.next()
    })
  }

  // A dead thread drops this; its restart reads the stars from the database.
  setFavorite(ids: number[], favorite: boolean): void {
    this.post({ type: 'favorite', ids, favorite })
  }

  stop(): void {
    this.stopped = true
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer)
    this.rebuildTimer = null
    const worker = this.worker
    this.worker = null
    void worker?.terminate()
    this.running?.pending.resolve(null)
    this.waiting?.resolve(null)
    this.running = null
    this.waiting = null
  }

  private start(announce: boolean): Worker {
    const worker = new Worker(this.workerPath)
    this.worker = worker
    this.announcing = 0
    worker.on('message', (message: FromSearchWorker) => {
      if (this.worker === worker) this.receive(message)
    })
    worker.on('error', (error) => log('error', 'Search thread failed', error))
    worker.on('exit', (code) => {
      if (this.worker !== worker) return
      this.worker = null
      // A build it took and never answered is redone by the restart, which must announce it.
      if (this.announcing > 0) this.announceOwed = true
      this.crashes++
      log('error', `Search thread stopped with code ${code} (${this.crashes} in a row)`)
      const running = this.running
      this.running = null
      running?.pending.resolve(this.failed(running.pending.request, 'Search stopped unexpectedly. Try again.'))
      this.next()
    })
    this.build(announce)
    return worker
  }

  private build(announce: boolean): void {
    if (announce) this.announcing++
    this.post({ type: 'build', databasePath: this.databasePath, announce })
  }

  // null once stopped.
  private restart(): Worker | null {
    if (this.stopped) return null
    const announce = this.announceOwed
    this.announceOwed = false
    return this.start(announce)
  }

  private next(): void {
    if (this.running || !this.waiting) return
    const pending = this.waiting
    this.waiting = null
    const worker = this.worker ?? this.restart()
    if (!worker) {
      pending.resolve(null)
      return
    }
    const id = this.nextId++
    this.running = { id, pending, started: performance.now() }
    this.post({ type: 'search', id, request: pending.request, limit: RESULT_LIMIT })
  }

  private receive(message: FromSearchWorker): void {
    if (message.type === 'built') {
      log('info', `Search index ready: ${message.files} files in ${message.ms} ms`)
      if (message.announce) {
        this.announcing--
        this.announceOwed = false
        this.onIndexChanged()
      }
      return
    }
    if (message.type === 'buildFailed') {
      log('error', 'Search index could not be built', message.message)
      // The change is still untold: the next build, here or after a restart, announces it.
      if (message.announce) {
        this.announcing--
        this.announceOwed = true
      }
      return
    }
    const running = this.running
    if (!running || running.id !== message.id) return
    this.running = null
    if (message.type === 'failed') {
      log('warn', 'Search failed', message.message)
      running.pending.resolve(this.failed(running.pending.request, message.message))
    } else {
      this.crashes = 0
      running.pending.resolve(this.waiting ? null : this.respond(running.pending.request, message.result, running.started))
    }
    this.next()
  }

  private failed(request: SearchRequest, error: string): SearchResponse {
    return { request, hits: [], total: 0, corrections: [], highlights: {}, elapsedMs: 0, error }
  }

  private respond(request: SearchRequest, result: EngineResult, started: number): SearchResponse {
    const files = this.store.filesByIds(result.ids)
    const position = new Map(result.ids.map((id, i) => [id, i]))
    const hits = files.map((file) => {
      const i = position.get(file.id)!
      return { file, relevance: result.relevance[i], matchedIn: result.matchedIn[i] }
    })
    return {
      request,
      hits,
      total: result.total,
      corrections: result.corrections,
      highlights: result.highlights,
      elapsedMs: Math.round(performance.now() - started),
      error: null
    }
  }

  private post(message: ToSearchWorker): void {
    this.worker?.postMessage(message)
  }
}

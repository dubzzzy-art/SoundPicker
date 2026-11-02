import { stat } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'
import type { RescanSummary, ScanProgress } from '../shared/api'
import type { LibraryStore } from './library-store'
import { log } from './log'
import type { LibraryIds, RescanStore } from './rescan-store'
import type { FromWorker, MetadataResult, ToWorker } from './scan/protocol'

type Job = { kind: 'scan'; libraryId: number; isNew: boolean } | { kind: 'details'; libraryId: number }

export interface IndexerEvents {
  progress(progress: ScanProgress): void
  librariesChanged(partial?: boolean): void
  finished(progress: ScanProgress): void
}

const DETAILS_BATCH = 200
const PROGRESS_INTERVAL_MS = 250
// Throttled: every update makes the window reload the tree.
const FILES_REFRESH_INTERVAL_MS = 3000
const DETAILS_REFRESH_INTERVAL_MS = 10000

export class Indexer {
  private readonly queue: Job[] = []
  private running = false
  private worker: Worker | null = null
  private cancelled = false
  private current: ScanProgress | null = null
  private lastProgressAt = 0
  private lastRefreshAt = 0

  constructor(
    private readonly store: LibraryStore,
    private readonly rescans: RescanStore,
    private readonly workerPath: string,
    private readonly events: IndexerEvents
  ) {}

  get progress(): ScanProgress | null {
    return this.current
  }

  get activeLibraryId(): number | null {
    return this.current?.libraryId ?? null
  }

  scan(libraryId: number, isNew: boolean): void {
    this.enqueue({ kind: 'scan', libraryId, isNew })
  }

  readDetails(libraryId: number): void {
    this.enqueue({ kind: 'details', libraryId })
  }

  cancel(): void {
    if (!this.worker) return
    this.cancelled = true
    this.post({ type: 'cancel' })
  }

  forget(libraryId: number): void {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].libraryId === libraryId) this.queue.splice(i, 1)
    }
    if (this.current?.libraryId === libraryId) this.cancel()
  }

  private enqueue(job: Job): void {
    const duplicate = this.queue.some((queued) => queued.libraryId === job.libraryId && queued.kind === job.kind)
    if (!duplicate) this.queue.push(job)
    void this.pump()
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift()!
        await this.run(job)
      }
    } finally {
      this.running = false
    }
  }

  private async run(job: Job): Promise<void> {
    const library = this.store.getLibrary(job.libraryId)
    if (!library || library.removedAt !== null) return

    this.cancelled = false
    this.current = {
      libraryId: library.id,
      libraryName: library.name,
      phase: job.kind === 'scan' ? 'files' : 'metadata',
      found: 0,
      processed: 0,
      total: 0,
      currentPath: library.rootPath
    }
    this.emitProgress(true)
    this.worker = new Worker(this.workerPath)
    this.worker.on('error', (error) => log('error', 'Scan worker failed', error))

    try {
      let summary: RescanSummary | undefined
      if (job.kind === 'scan') {
        // An unplugged drive must not look like a library whose files are all gone.
        if (!job.isNew && !(await isFolder(library.rootPath))) {
          return this.finish('error', `${library.rootPath} is not available. Nothing was changed — connect the drive or use Change root folder.`)
        }
        const before = job.isNew ? null : this.rescans.snapshot(library.id)
        const seen: LibraryIds = { files: new Set(), folders: new Set() }
        const finished = await this.walk(library.id, library.rootPath, seen)
        if (!finished) {
          if (job.isNew) this.store.deleteLibrary(library.id)
          return this.finish('cancelled')
        }
        if (before) {
          if (seen.files.size === 0 && this.rescans.presentCount(before) > 0) {
            return this.finish('error', `No sounds found in ${library.rootPath}. Nothing was changed.`)
          }
          summary = this.rescans.reconcile(library.id, before, seen)
          log('info', `Rescan of ${library.name}`, {
            added: summary.added,
            moved: summary.moved.length,
            missing: summary.missing,
            keptFiles: summary.missingFiles.length,
            keptFolders: summary.missingFolders.length
          })
        }
        this.store.markScanned(library.id)
        this.events.librariesChanged()
      }
      const finished = await this.readAllDetails(library.id)
      this.finish(finished ? 'done' : 'cancelled', undefined, summary)
    } catch (error) {
      log('error', `Indexing ${library.rootPath} failed`, error)
      this.finish('error', error instanceof Error ? error.message : String(error))
    } finally {
      await this.worker?.terminate()
      this.worker = null
    }
  }

  // false: cancelled.
  private walk(libraryId: number, rootPath: string, seen: LibraryIds): Promise<boolean> {
    const folderIds = new Map<string, number>()
    return new Promise((resolve, reject) => {
      const onMessage = (message: FromWorker) => {
        try {
          if (message.type === 'entries') {
            let files = 0
            this.store.transaction(() => {
              for (const entry of message.entries) {
                if (entry.kind === 'folder') {
                  const parentRel = entry.relPath.includes('/') ? entry.relPath.slice(0, entry.relPath.lastIndexOf('/')) : ''
                  const parentId = entry.relPath === '' ? null : (folderIds.get(parentRel) ?? null)
                  const folderId = this.store.upsertFolder(libraryId, parentId, entry.relPath, entry.name)
                  folderIds.set(entry.relPath, folderId)
                  seen.folders.add(folderId)
                } else {
                  const folderId = folderIds.get(entry.relDir)
                  if (folderId === undefined) continue
                  seen.files.add(this.store.upsertFile(folderId, entry))
                  files++
                }
              }
            })
            this.current!.found += files
            this.current!.currentPath = message.currentPath
            this.emitProgress()
            this.refreshWindow()
          } else if (message.type === 'problem') {
            log('warn', `Skipped ${message.path}: ${message.message}`)
          } else if (message.type === 'walk-finished') {
            this.worker?.off('message', onMessage)
            resolve(!message.cancelled && !this.cancelled)
          }
        } catch (error) {
          this.worker?.off('message', onMessage)
          reject(error)
        }
      }
      this.worker!.on('message', onMessage)
      this.post({ type: 'walk', root: rootPath })
    })
  }

  // false: cancelled.
  private async readAllDetails(libraryId: number): Promise<boolean> {
    const progress = this.current!
    progress.phase = 'metadata'
    progress.total = this.store.countFilesNeedingDetails(libraryId)
    progress.processed = 0
    this.emitProgress(true)

    let afterId = 0
    for (;;) {
      if (this.cancelled) return false
      const batch = this.store.filesNeedingDetails(libraryId, afterId, DETAILS_BATCH)
      if (batch.length === 0) return true
      afterId = batch[batch.length - 1].id
      progress.currentPath = batch[0].path

      const results = await this.request(batch)
      this.store.transaction(() => {
        for (const result of results) {
          if ('details' in result) this.store.saveDetails(result.id, result.details)
          else {
            this.store.markBroken(result.id)
            log('warn', `Could not read file ${result.id}: ${result.error}`)
          }
        }
      })
      progress.processed += results.length
      this.emitProgress()
      this.refreshWindow()
      if (results.length < batch.length) return false
    }
  }

  private request(items: { id: number; path: string }[]): Promise<MetadataResult[]> {
    return new Promise((resolve) => {
      const onMessage = (message: FromWorker) => {
        if (message.type !== 'metadata-results') return
        this.worker?.off('message', onMessage)
        resolve(message.results)
      }
      this.worker!.on('message', onMessage)
      this.post({ type: 'metadata', items })
    })
  }

  private finish(phase: 'done' | 'cancelled' | 'error', message?: string, summary?: RescanSummary): void {
    const progress = { ...this.current!, phase, message, summary }
    this.current = null
    this.events.librariesChanged()
    this.events.finished(progress)
  }

  private post(message: ToWorker): void {
    this.worker?.postMessage(message)
  }

  private emitProgress(force = false): void {
    const now = Date.now()
    if (!this.current || (!force && now - this.lastProgressAt < PROGRESS_INTERVAL_MS)) return
    this.lastProgressAt = now
    this.events.progress({ ...this.current })
  }

  private refreshWindow(): void {
    const now = Date.now()
    const interval = this.current?.phase === 'metadata' ? DETAILS_REFRESH_INTERVAL_MS : FILES_REFRESH_INTERVAL_MS
    if (now - this.lastRefreshAt < interval) return
    this.lastRefreshAt = now
    this.events.librariesChanged(true)
  }
}

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

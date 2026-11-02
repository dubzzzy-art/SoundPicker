import { DatabaseSync } from 'node:sqlite'
import { parentPort } from 'node:worker_threads'
import type { SearchRequest } from '../../shared/api'
import { LibraryStore } from '../library-store'
import { SearchEngine, type EngineResult } from './engine'

export type ToSearchWorker =
  // `announce` comes back in the answer: the window is told only about builds of changed data.
  | { type: 'build'; databasePath: string; announce: boolean }
  | { type: 'search'; id: number; request: SearchRequest; limit: number }
  | { type: 'favorite'; ids: number[]; favorite: boolean }

export type FromSearchWorker =
  | { type: 'built'; files: number; ms: number; announce: boolean }
  | { type: 'buildFailed'; message: string; announce: boolean }
  | { type: 'result'; id: number; result: EngineResult; ms: number }
  | { type: 'failed'; id: number; message: string }

const port = parentPort!
let engine: SearchEngine | null = null

function send(message: FromSearchWorker): void {
  port.postMessage(message)
}

port.on('message', (message: ToSearchWorker) => {
  if (message.type === 'build') {
    const started = performance.now()
    let db: DatabaseSync | null = null
    try {
      db = new DatabaseSync(message.databasePath, { readOnly: true })
      engine = new SearchEngine(new LibraryStore(db).searchData())
      send({ type: 'built', files: engine.size, ms: Math.round(performance.now() - started), announce: message.announce })
    } catch (error) {
      send({ type: 'buildFailed', message: error instanceof Error ? error.message : String(error), announce: message.announce })
    } finally {
      db?.close()
    }
    return
  }
  if (message.type === 'favorite') {
    engine?.setFavorite(message.ids, message.favorite)
    return
  }
  const started = performance.now()
  try {
    if (!engine) throw new Error('The search index is not ready')
    const result = engine.search(message.request, message.limit)
    send({ type: 'result', id: message.id, result, ms: performance.now() - started })
  } catch (error) {
    send({ type: 'failed', id: message.id, message: error instanceof Error ? error.message : String(error) })
  }
})

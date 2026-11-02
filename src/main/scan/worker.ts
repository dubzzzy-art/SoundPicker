import { parentPort } from 'node:worker_threads'
import { readAudioDetails } from './metadata'
import type { FromWorker, MetadataRequest, MetadataResult, ToWorker } from './protocol'
import { absolutePath, walkLibrary, type WalkEntry } from './walk'

// Low on purpose: synced drives (Google Drive) compete with syncing.
const METADATA_CONCURRENCY = 3
const BATCH_SIZE = 400
const BATCH_INTERVAL_MS = 200

const port = parentPort!
let cancelled = false

function send(message: FromWorker): void {
  port.postMessage(message)
}

port.on('message', (message: ToWorker) => {
  switch (message.type) {
    case 'cancel':
      cancelled = true
      break
    case 'walk':
      void walk(message.root)
      break
    case 'metadata':
      void readMetadata(message.items)
      break
  }
})

async function walk(root: string): Promise<void> {
  let batch: WalkEntry[] = []
  let currentPath = root
  let lastFlush = Date.now()

  const flush = () => {
    if (batch.length > 0) send({ type: 'entries', entries: batch, currentPath })
    batch = []
    lastFlush = Date.now()
  }

  const entries = walkLibrary(
    root,
    (problem) => send({ type: 'problem', ...problem }),
    () => cancelled
  )
  for await (const entry of entries) {
    batch.push(entry)
    if (entry.kind === 'folder') currentPath = absolutePath(root, entry.relPath)
    if (batch.length >= BATCH_SIZE || Date.now() - lastFlush >= BATCH_INTERVAL_MS) flush()
  }
  flush()
  send({ type: 'walk-finished', cancelled })
}

async function readMetadata(items: MetadataRequest[]): Promise<void> {
  const results: MetadataResult[] = []
  let next = 0
  const lane = async () => {
    while (next < items.length && !cancelled) {
      const item = items[next++]
      try {
        results.push({ id: item.id, details: await readAudioDetails(item.path) })
      } catch (error) {
        results.push({ id: item.id, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  await Promise.all(Array.from({ length: METADATA_CONCURRENCY }, lane))
  send({ type: 'metadata-results', results })
}

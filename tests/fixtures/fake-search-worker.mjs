// Stands in for search/worker.ts. The query "crash" kills the thread, after holding it busy
// for a moment so that messages sent meanwhile are lost with it. With FAKE_SEARCH_FAIL_FIRST_BUILD
// set when the thread starts, its first build fails.
import { parentPort } from 'node:worker_threads'

let builds = 0

parentPort.on('message', (message) => {
  if (message.type === 'build') {
    if (process.env.FAKE_SEARCH_FAIL_FIRST_BUILD && builds++ === 0) {
      parentPort.postMessage({ type: 'buildFailed', message: 'database is locked', announce: message.announce })
    } else {
      parentPort.postMessage({ type: 'built', files: 0, ms: 0, announce: message.announce })
    }
  }
  if (message.type !== 'search') return
  if (message.request.query === 'crash') {
    const until = Date.now() + 100
    while (Date.now() < until);
    process.exit(1)
  }
  parentPort.postMessage({
    type: 'result',
    id: message.id,
    result: { ids: [], relevance: [], matchedIn: [], total: 0, corrections: [], highlights: {} },
    ms: 0
  })
})

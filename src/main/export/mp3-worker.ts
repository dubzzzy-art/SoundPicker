import { parentPort } from 'node:worker_threads'
import lameSource from 'lamejs/lame.all.js?raw'
import { encodeMp3, fadeEdges, loadLame, type Pcm } from './mp3'

export interface Mp3Job {
  id: number
  pcm: Pcm
  kbps: number
  fades: boolean
}

export type Mp3JobResult = { id: number; ok: true; bytes: Uint8Array } | { id: number; ok: false; message: string }

const lame = loadLame(lameSource)
const port = parentPort!

port.on('message', (job: Mp3Job) => {
  try {
    if (job.fades) fadeEdges(job.pcm)
    const bytes = encodeMp3(lame, job.pcm, job.kbps)
    port.postMessage({ id: job.id, ok: true, bytes } satisfies Mp3JobResult, [bytes.buffer as ArrayBuffer])
  } catch (error) {
    port.postMessage({ id: job.id, ok: false, message: error instanceof Error ? error.message : String(error) } satisfies Mp3JobResult)
  }
})

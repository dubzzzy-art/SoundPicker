import { Worker } from 'node:worker_threads'
import type { Pcm } from './mp3'
import type { Mp3Job, Mp3JobResult } from './mp3-worker'

export class Mp3Encoder {
  private worker: Worker | null = null
  private nextId = 1
  private readonly pending = new Map<number, { resolve(bytes: Uint8Array): void; reject(error: Error): void }>()

  constructor(private readonly workerPath: string) {}

  encode(pcm: Pcm, kbps: number, fades: boolean): Promise<Uint8Array> {
    const worker = this.start()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage({ id, pcm, kbps, fades } satisfies Mp3Job)
    })
  }

  stop(): void {
    void this.worker?.terminate()
    this.worker = null
  }

  private start(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(this.workerPath)
    worker.on('message', (result: Mp3JobResult) => {
      const job = this.pending.get(result.id)
      this.pending.delete(result.id)
      if (!job) return
      if (result.ok) job.resolve(result.bytes)
      else job.reject(new Error(result.message))
    })
    worker.on('error', (error) => this.failAll(error))
    worker.on('exit', () => {
      if (this.worker === worker) this.worker = null
      this.failAll(new Error('The MP3 encoder stopped'))
    })
    this.worker = worker
    return worker
  }

  private failAll(error: Error): void {
    for (const job of this.pending.values()) job.reject(error)
    this.pending.clear()
  }
}

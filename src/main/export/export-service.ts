import { basename, extname } from 'node:path'
import type { ExportRequest, ExportResult } from '../../shared/api'
import type { LibraryStore } from '../library-store'
import { log } from '../log'
import { exportFileName, writeExport } from './files'
import { standardBitrate } from './mp3'
import type { Mp3Encoder } from './mp3-encoder'
import { readWavFragment } from './wav'

// The export folder is never cleaned: editors keep pointing at its files.
export class ExportService {
  private readonly handedOut = new Set<string>()
  private readonly prepared = new Map<string, Promise<Uint8Array>>()

  constructor(
    private readonly store: LibraryStore,
    private readonly mp3: Mp3Encoder,
    private readonly folder: () => string
  ) {}

  async export(request: ExportRequest): Promise<ExportResult> {
    const file = this.store.fileOnDisk(request.fileId)
    if (!file) return { ok: false, message: 'This file is no longer in the library.' }
    try {
      const path = await this.write(file.path, file.bitrate, request)
      this.handedOut.add(path)
      return { ok: true, path }
    } catch (error) {
      log('warn', `Export failed for ${file.path}`, error)
      return { ok: false, message: `Could not export: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  prepare(request: ExportRequest): void {
    const file = this.store.fileOnDisk(request.fileId)
    if (!file || !request.pcm) return
    const key = requestKey(request)
    if (this.prepared.has(key)) return
    const bytes = this.encode(request, file.bitrate)
    bytes.catch(() => this.prepared.delete(key))
    this.prepared.set(key, bytes)
    while (this.prepared.size > PREPARED_LIMIT) this.prepared.delete(this.prepared.keys().next().value!)
  }

  canDrag(path: string): boolean {
    return this.handedOut.has(path)
  }

  private async write(source: string, bitrate: number | null, request: ExportRequest): Promise<string> {
    const range = request.start !== null && request.end !== null ? { start: request.start, end: request.end } : null
    if (!range && request.channel === null) return source

    const name = exportFileName(basename(source), { channel: request.channel, start: range?.start ?? null, end: range?.end ?? null })
    const ext = extname(source).toLowerCase()
    if (ext === '.wav') {
      const bytes = await readWavFragment(source, {
        start: range?.start ?? 0,
        end: range?.end ?? null,
        channels: request.channel === null ? [0, 1] : [request.channel],
        fades: request.fades && range !== null
      })
      return writeExport(this.folder(), name, bytes)
    }
    if (ext === '.mp3') {
      const bytes = await (this.prepared.get(requestKey(request)) ?? this.encode(request, bitrate))
      return writeExport(this.folder(), name, bytes)
    }
    throw new Error(`${ext} files cannot be exported`)
  }

  private encode(request: ExportRequest, bitrate: number | null): Promise<Uint8Array> {
    if (!request.pcm) return Promise.reject(new Error('the MP3 sound was not decoded'))
    const kbps = standardBitrate(request.pcm.sampleRate, bitrate)
    const fades = request.fades && request.start !== null && request.end !== null
    return this.mp3.encode(request.pcm, kbps, fades)
  }
}

const PREPARED_LIMIT = 3

export function requestKey(request: ExportRequest): string {
  return [request.fileId, request.start, request.end, request.channel, request.fades].join('|')
}

import { audioUrl, type ExportRequest } from '../../../shared/api'
import { repairMp3 } from './mp3-repair'

export interface TimeRange {
  start: number
  end: number
}

export function samplesOf(buffer: AudioBuffer, range: TimeRange | null, channel: 0 | 1 | null): NonNullable<ExportRequest['pcm']> {
  const rate = buffer.sampleRate
  const start = range ? Math.min(buffer.length, Math.max(0, Math.round(range.start * rate))) : 0
  const end = range ? Math.min(buffer.length, Math.max(start, Math.round(range.end * rate))) : buffer.length
  const channels = channel !== null ? [channel] : [0, 1].slice(0, Math.min(2, buffer.numberOfChannels))
  return { sampleRate: rate, channels: channels.map((index) => buffer.getChannelData(index).slice(start, end)) }
}

async function fetchFile(fileId: number): Promise<ArrayBuffer> {
  const response = await fetch(audioUrl(fileId))
  if (!response.ok) throw new Error(`Could not open file (${response.status})`)
  return response.arrayBuffer()
}

// Decoding detaches the bytes, so a failed file is read again for the repair.
async function decodeFile(ctx: BaseAudioContext, fileId: number): Promise<AudioBuffer> {
  try {
    return await ctx.decodeAudioData(await fetchFile(fileId))
  } catch (error) {
    const repaired = repairMp3(new Uint8Array(await fetchFile(fileId)))
    if (!repaired) throw error
    return ctx.decodeAudioData(repaired.buffer as ArrayBuffer)
  }
}

export type ChannelMode = 'both' | 'left' | 'right'

const CACHE_SIZE = 12
const NATIVE_CACHE_SIZE = 2
const END_MARGIN_SECONDS = 0.005

export class AudioEngine {
  private context: AudioContext | null = null
  private source: AudioBufferSourceNode | null = null
  private splitter: ChannelSplitterNode | null = null
  private merger: ChannelMergerNode | null = null
  private channelMode: ChannelMode = 'both'
  private readonly cache = new Map<number, AudioBuffer>()
  private readonly nativeCache = new Map<number, AudioBuffer>()
  private startedAt = 0
  private startOffset = 0
  private endAt = 0
  private loop: TimeRange | null = null
  private stoppedAt = 0

  onEnded: () => void = () => {}

  private get ctx(): AudioContext {
    this.context ??= new AudioContext({ latencyHint: 'interactive' })
    return this.context
  }

  async load(fileId: number): Promise<AudioBuffer> {
    const cached = this.cache.get(fileId)
    if (cached) {
      this.cache.delete(fileId)
      this.cache.set(fileId, cached)
      return cached
    }
    const buffer = await decodeFile(this.ctx, fileId)
    this.cache.set(fileId, buffer)
    while (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!)
    return buffer
  }

  // Playback buffers are resampled to the device rate; exports need the file's own rate.
  async loadNative(fileId: number, sampleRate: number): Promise<AudioBuffer> {
    const playback = this.cache.get(fileId)
    if (playback?.sampleRate === sampleRate) return playback
    const cached = this.nativeCache.get(fileId)
    if (cached) return cached
    const buffer = await decodeFile(new OfflineAudioContext(1, 1, sampleRate), fileId)
    this.nativeCache.set(fileId, buffer)
    while (this.nativeCache.size > NATIVE_CACHE_SIZE) this.nativeCache.delete(this.nativeCache.keys().next().value!)
    return buffer
  }

  play(buffer: AudioBuffer, from: number, end: number, loop: TimeRange | null): void {
    this.stopSource()
    const ctx = this.ctx
    if (ctx.state === 'suspended') void ctx.resume()

    const source = ctx.createBufferSource()
    source.buffer = buffer
    if (buffer.numberOfChannels > 1) {
      const splitter = ctx.createChannelSplitter(buffer.numberOfChannels)
      const merger = ctx.createChannelMerger(2)
      source.connect(splitter)
      merger.connect(ctx.destination)
      this.splitter = splitter
      this.merger = merger
      this.route()
    } else {
      source.connect(ctx.destination)
    }
    if (loop) {
      source.loop = true
      // Default loop points: 0 and the buffer length played silence on Windows.
      const whole = loop.start <= 0 && loop.end >= buffer.duration
      if (!whole) {
        source.loopStart = loop.start
        source.loopEnd = loop.end
      }
      // Started at the very end of the loop, Chromium plays nothing.
      if (from < loop.start || from >= loop.end - END_MARGIN_SECONDS) from = loop.start
      source.start(0, from)
    } else {
      source.start(0, from, Math.max(0, end - from))
    }
    source.onended = () => {
      if (this.source !== source) return
      this.source = null
      this.stoppedAt = end
      this.onEnded()
    }

    this.source = source
    this.startedAt = ctx.currentTime
    this.startOffset = from
    this.endAt = end
    this.loop = loop
  }

  setChannelMode(mode: ChannelMode): void {
    this.channelMode = mode
    this.route()
  }

  private route(): void {
    const { splitter, merger } = this
    if (!splitter || !merger) return
    splitter.disconnect()
    const [left, right] = this.channelMode === 'left' ? [0, 0] : this.channelMode === 'right' ? [1, 1] : [0, 1]
    splitter.connect(merger, left, 0)
    splitter.connect(merger, right, 1)
  }

  pause(): void {
    const position = this.position()
    this.stopSource()
    this.stoppedAt = position
  }

  stop(): void {
    this.stopSource()
    this.stoppedAt = 0
  }

  get playing(): boolean {
    return this.source !== null
  }

  position(): number {
    if (!this.source || !this.context) return this.stoppedAt
    const elapsed = this.startOffset + (this.context.currentTime - this.startedAt)
    if (this.loop) {
      const { start, end } = this.loop
      if (elapsed < end) return elapsed
      return start + ((elapsed - start) % (end - start))
    }
    return Math.min(elapsed, this.endAt)
  }

  private stopSource(): void {
    const source = this.source
    this.source = null
    if (!source) return
    source.onended = null
    try {
      source.stop()
    } catch {
      // Already stopped.
    }
    source.disconnect()
    this.splitter?.disconnect()
    this.merger?.disconnect()
    this.splitter = null
    this.merger = null
  }
}

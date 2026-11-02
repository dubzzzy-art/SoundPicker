import { FADE_SECONDS } from './wav'

// lamejs's npm entry breaks when bundled (MPEGMode), so lame.all.js is loaded as source.

interface Mp3EncoderInstance {
  encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array
  flush(): Int8Array
}

export interface LameJs {
  Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => Mp3EncoderInstance
}

export function loadLame(source: string): LameJs {
  return new Function(`${source}\nreturn lamejs`)() as LameJs
}

export interface Pcm {
  sampleRate: number
  channels: Float32Array[]
}

const MPEG1_KBPS = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
const MPEG2_KBPS = [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]

export function standardBitrate(sampleRate: number, bitsPerSecond: number | null): number {
  const allowed = sampleRate >= 32000 ? MPEG1_KBPS : MPEG2_KBPS
  if (!bitsPerSecond) return sampleRate >= 32000 ? 192 : 64
  const kbps = bitsPerSecond / 1000
  return allowed.find((rate) => rate >= kbps - 0.5) ?? allowed[allowed.length - 1]
}

const FRAME_SAMPLES = 1152

export function encodeMp3(lame: LameJs, pcm: Pcm, kbps: number): Uint8Array {
  const channels = pcm.channels.slice(0, 2)
  const encoder = new lame.Mp3Encoder(channels.length, pcm.sampleRate, kbps)
  const ints = channels.map(toInt16)
  const chunks: Int8Array[] = []
  const length = ints[0]?.length ?? 0
  for (let start = 0; start < length; start += FRAME_SAMPLES) {
    const end = start + FRAME_SAMPLES
    const chunk = encoder.encodeBuffer(ints[0].subarray(start, end), ints[1]?.subarray(start, end))
    if (chunk.length > 0) chunks.push(chunk)
  }
  chunks.push(encoder.flush())
  const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    out.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length), offset)
    offset += chunk.length
  }
  return out
}

function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]))
    out[i] = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767)
  }
  return out
}

export function fadeEdges(pcm: Pcm): void {
  const frames = pcm.channels[0]?.length ?? 0
  const fadeFrames = Math.min(Math.round(pcm.sampleRate * FADE_SECONDS), Math.floor(frames / 2))
  for (const channel of pcm.channels) {
    for (let i = 0; i < fadeFrames; i++) {
      const gain = i / fadeFrames
      channel[i] *= gain
      channel[frames - 1 - i] *= gain
    }
  }
}

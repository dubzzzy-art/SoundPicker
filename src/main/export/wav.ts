import { open, type FileHandle } from 'node:fs/promises'

export type SampleFormat = 'int' | 'float'

export interface WavFormat {
  format: SampleFormat
  bitsPerSample: number
  channels: number
  sampleRate: number
}

export interface WavLayout extends WavFormat {
  dataOffset: number
  dataBytes: number
}

export interface WavFragmentOptions {
  start: number
  end: number | null
  channels: number[]
  fades: boolean
}

const FORMAT_PCM = 1
const FORMAT_FLOAT = 3
const FORMAT_EXTENSIBLE = 0xfffe
export const FADE_SECONDS = 0.005
const HEADER_BYTES = 44

export function parseFormatChunk(bytes: Buffer): WavFormat {
  if (bytes.length < 16) throw new Error('WAV format chunk is too short')
  let tag = bytes.readUInt16LE(0)
  if (tag === FORMAT_EXTENSIBLE && bytes.length >= 26) tag = bytes.readUInt16LE(24)
  const channels = bytes.readUInt16LE(2)
  const sampleRate = bytes.readUInt32LE(4)
  const bitsPerSample = bytes.readUInt16LE(14)
  const format: SampleFormat | null = tag === FORMAT_PCM ? 'int' : tag === FORMAT_FLOAT ? 'float' : null
  if (!format) throw new Error(`This WAV encoding (${tag}) is not supported`)
  const supported = format === 'int' ? [8, 16, 24, 32] : [32, 64]
  if (!supported.includes(bitsPerSample)) throw new Error(`${bitsPerSample}-bit WAV is not supported`)
  if (channels === 0 || sampleRate === 0) throw new Error('WAV format chunk is damaged')
  return { format, bitsPerSample, channels, sampleRate }
}

export async function readWavLayout(file: FileHandle): Promise<WavLayout> {
  const { size } = await file.stat()
  const head = Buffer.alloc(12)
  await file.read(head, 0, 12, 0)
  if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a WAV file')
  }
  let format: WavFormat | null = null
  const chunk = Buffer.alloc(8)
  let offset = 12
  while (offset + 8 <= size) {
    await file.read(chunk, 0, 8, offset)
    const id = chunk.toString('ascii', 0, 4)
    const length = chunk.readUInt32LE(4)
    const body = offset + 8
    if (id === 'fmt ') {
      const bytes = Buffer.alloc(Math.min(length, 40))
      await file.read(bytes, 0, bytes.length, body)
      format = parseFormatChunk(bytes)
    } else if (id === 'data') {
      if (!format) throw new Error('WAV audio data comes before its format')
      // Cut-off recordings leave the size at 0 or past the end of the file.
      const available = size - body
      const dataBytes = length === 0 || length > available ? available : length
      return { ...format, dataOffset: body, dataBytes }
    }
    offset = body + length + (length % 2)
  }
  throw new Error('WAV file has no audio data')
}

export async function readWavFragment(path: string, options: WavFragmentOptions): Promise<Buffer> {
  const file = await open(path, 'r')
  try {
    const layout = await readWavLayout(file)
    const bytesPerSample = layout.bitsPerSample / 8
    const blockAlign = bytesPerSample * layout.channels
    const totalFrames = Math.floor(layout.dataBytes / blockAlign)
    const toFrame = (seconds: number) => Math.min(totalFrames, Math.max(0, Math.round(seconds * layout.sampleRate)))
    const startFrame = toFrame(options.start)
    const endFrame = options.end === null ? totalFrames : Math.max(startFrame, toFrame(options.end))
    const frames = endFrame - startFrame

    const source = Buffer.alloc(frames * blockAlign)
    await file.read(source, 0, source.length, layout.dataOffset + startFrame * blockAlign)

    const channels = options.channels.filter((channel) => channel < layout.channels)
    if (channels.length === 0) throw new Error('The file has no such channel')
    const audio = pickChannels(source, frames, layout.channels, bytesPerSample, channels)
    const output: WavFormat = { ...layout, channels: channels.length }
    if (options.fades) applyFades(audio, output, frames)
    // RIFF chunks are padded to an even length.
    const pad = Buffer.alloc(audio.length % 2)
    return Buffer.concat([wavHeader(output, audio.length), audio, pad])
  } finally {
    await file.close()
  }
}

export function pickChannels(source: Buffer, frames: number, sourceChannels: number, bytesPerSample: number, channels: number[]): Buffer {
  if (channels.length === sourceChannels && channels.every((channel, i) => channel === i)) return source
  const inBlock = bytesPerSample * sourceChannels
  const outBlock = bytesPerSample * channels.length
  const out = Buffer.alloc(frames * outBlock)
  for (let frame = 0; frame < frames; frame++) {
    channels.forEach((channel, i) => {
      const from = frame * inBlock + channel * bytesPerSample
      source.copy(out, frame * outBlock + i * bytesPerSample, from, from + bytesPerSample)
    })
  }
  return out
}

export function applyFades(audio: Buffer, format: WavFormat, frames: number): void {
  const fadeFrames = Math.min(Math.round(format.sampleRate * FADE_SECONDS), Math.floor(frames / 2))
  if (fadeFrames < 1) return
  const codec = sampleCodec(format)
  const bytesPerSample = format.bitsPerSample / 8
  const blockAlign = bytesPerSample * format.channels
  const scale = (frame: number, gain: number) => {
    for (let channel = 0; channel < format.channels; channel++) {
      const offset = frame * blockAlign + channel * bytesPerSample
      codec.write(audio, offset, codec.read(audio, offset) * gain)
    }
  }
  for (let i = 0; i < fadeFrames; i++) {
    const gain = i / fadeFrames
    scale(i, gain)
    scale(frames - 1 - i, gain)
  }
}

interface SampleCodec {
  read(buffer: Buffer, offset: number): number
  write(buffer: Buffer, offset: number, value: number): void
}

export function sampleCodec({ format, bitsPerSample }: Pick<WavFormat, 'format' | 'bitsPerSample'>): SampleCodec {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)))
  if (format === 'float') {
    return bitsPerSample === 64
      ? { read: (b, o) => b.readDoubleLE(o), write: (b, o, v) => void b.writeDoubleLE(v, o) }
      : { read: (b, o) => b.readFloatLE(o), write: (b, o, v) => void b.writeFloatLE(v, o) }
  }
  switch (bitsPerSample) {
    case 8:
      // 8-bit WAV is unsigned, centred on 128.
      return { read: (b, o) => (b[o] - 128) / 128, write: (b, o, v) => void (b[o] = clamp(v * 128 + 128, 0, 255)) }
    case 16:
      return { read: (b, o) => b.readInt16LE(o) / 32768, write: (b, o, v) => void b.writeInt16LE(clamp(v * 32768, -32768, 32767), o) }
    case 24:
      return {
        read: (b, o) => b.readIntLE(o, 3) / 8388608,
        write: (b, o, v) => void b.writeIntLE(clamp(v * 8388608, -8388608, 8388607), o, 3)
      }
    default:
      return {
        read: (b, o) => b.readInt32LE(o) / 2147483648,
        write: (b, o, v) => void b.writeInt32LE(clamp(v * 2147483648, -2147483648, 2147483647), o)
      }
  }
}

export function wavHeader(format: WavFormat, dataBytes: number): Buffer {
  const bytesPerSample = format.bitsPerSample / 8
  const header = Buffer.alloc(HEADER_BYTES)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(HEADER_BYTES - 8 + dataBytes + (dataBytes % 2), 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(format.format === 'float' ? FORMAT_FLOAT : FORMAT_PCM, 20)
  header.writeUInt16LE(format.channels, 22)
  header.writeUInt32LE(format.sampleRate, 24)
  header.writeUInt32LE(format.sampleRate * bytesPerSample * format.channels, 28)
  header.writeUInt16LE(bytesPerSample * format.channels, 32)
  header.writeUInt16LE(format.bitsPerSample, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataBytes, 40)
  return header
}

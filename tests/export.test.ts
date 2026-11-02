import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { exportFileName, writeExport } from '../src/main/export/files'
import { readWavFragment, sampleCodec, type WavFormat } from '../src/main/export/wav'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'soundpicker-export-'))
}

interface TestWav extends WavFormat {
  frames: number
  sample(frame: number, channel: number): number
  extensible?: boolean
  extraChunk?: boolean
  streamingSize?: boolean
}

function buildWav(wav: TestWav): Buffer {
  const bytesPerSample = wav.bitsPerSample / 8
  const codec = sampleCodec(wav)
  const data = Buffer.alloc(wav.frames * wav.channels * bytesPerSample)
  for (let frame = 0; frame < wav.frames; frame++) {
    for (let channel = 0; channel < wav.channels; channel++) {
      codec.write(data, (frame * wav.channels + channel) * bytesPerSample, wav.sample(frame, channel))
    }
  }
  const fmt = Buffer.alloc(wav.extensible ? 40 : 16)
  fmt.writeUInt16LE(wav.extensible ? 0xfffe : wav.format === 'float' ? 3 : 1, 0)
  fmt.writeUInt16LE(wav.channels, 2)
  fmt.writeUInt32LE(wav.sampleRate, 4)
  fmt.writeUInt32LE(wav.sampleRate * wav.channels * bytesPerSample, 8)
  fmt.writeUInt16LE(wav.channels * bytesPerSample, 12)
  fmt.writeUInt16LE(wav.bitsPerSample, 14)
  if (wav.extensible) {
    fmt.writeUInt16LE(22, 16)
    fmt.writeUInt16LE(wav.bitsPerSample, 18)
    fmt.writeUInt16LE(wav.format === 'float' ? 3 : 1, 24)
  }
  const chunk = (id: string, body: Buffer, size = body.length) => {
    const head = Buffer.alloc(8)
    head.write(id, 0, 'ascii')
    head.writeUInt32LE(size, 4)
    return Buffer.concat([head, body, Buffer.alloc(body.length % 2)])
  }
  const parts = [chunk('fmt ', fmt)]
  if (wav.extraChunk) parts.push(chunk('LIST', Buffer.from('INFOISFT\u0005\u0000\u0000\u0000test\u0000')))
  parts.push(chunk('data', data, wav.streamingSize ? 0 : data.length))
  const body = Buffer.concat([Buffer.from('WAVE'), ...parts])
  return Buffer.concat([chunk('RIFF', body).subarray(0, 8), body])
}

function readBack(bytes: Buffer) {
  const format = {
    tag: bytes.readUInt16LE(20),
    channels: bytes.readUInt16LE(22),
    sampleRate: bytes.readUInt32LE(24),
    bitsPerSample: bytes.readUInt16LE(34),
    dataBytes: bytes.readUInt32LE(40)
  }
  const codec = sampleCodec({ format: format.tag === 3 ? 'float' : 'int', bitsPerSample: format.bitsPerSample })
  const bytesPerSample = format.bitsPerSample / 8
  const frames = format.dataBytes / (bytesPerSample * format.channels)
  const sample = (frame: number, channel: number) => codec.read(bytes, 44 + (frame * format.channels + channel) * bytesPerSample)
  return { ...format, frames, sample }
}

const ramp = (frames: number) => (frame: number, channel: number) => (channel === 0 ? frame / frames : -frame / frames) * 0.5

describe('WAV fragments', () => {
  it('cuts a stereo 16-bit range exactly, keeping rate and depth', async () => {
    const path = join(tempDir(), 'a.wav')
    writeFileSync(path, buildWav({ format: 'int', bitsPerSample: 16, channels: 2, sampleRate: 1000, frames: 1000, sample: ramp(1000) }))
    const out = readBack(await readWavFragment(path, { start: 0.25, end: 0.5, channels: [0, 1], fades: false }))
    expect(out).toMatchObject({ tag: 1, channels: 2, sampleRate: 1000, bitsPerSample: 16, frames: 250 })
    expect(out.sample(0, 0)).toBeCloseTo(ramp(1000)(250, 0), 4)
    expect(out.sample(249, 1)).toBeCloseTo(ramp(1000)(499, 1), 4)
  })

  it('exports one channel of a 24-bit extensible file as mono, past a metadata chunk', async () => {
    const path = join(tempDir(), 'b.wav')
    writeFileSync(
      path,
      buildWav({ format: 'int', bitsPerSample: 24, channels: 2, sampleRate: 1000, frames: 400, sample: ramp(400), extensible: true, extraChunk: true })
    )
    const out = readBack(await readWavFragment(path, { start: 0.1, end: 0.2, channels: [1], fades: false }))
    expect(out).toMatchObject({ channels: 1, bitsPerSample: 24, frames: 100 })
    expect(out.sample(10, 0)).toBeCloseTo(ramp(400)(110, 1), 6)
  })

  it('ramps the edges in and out over 5 ms', async () => {
    const path = join(tempDir(), 'c.wav')
    writeFileSync(path, buildWav({ format: 'float', bitsPerSample: 32, channels: 1, sampleRate: 1000, frames: 100, sample: () => 0.5 }))
    const out = readBack(await readWavFragment(path, { start: 0, end: 0.1, channels: [0], fades: true }))
    expect(out.tag).toBe(3)
    const edge = [0, 1, 2, 3, 4, 5].map((frame) => out.sample(frame, 0))
    ;[0, 0.1, 0.2, 0.3, 0.4, 0.5].forEach((value, frame) => expect(edge[frame]).toBeCloseTo(value, 6))
    expect(out.sample(99, 0)).toBe(0)
    expect(out.sample(50, 0)).toBe(0.5)
  })

  it('reads a file whose recorder never filled in the data size', async () => {
    const path = join(tempDir(), 'd.wav')
    writeFileSync(path, buildWav({ format: 'int', bitsPerSample: 16, channels: 1, sampleRate: 1000, frames: 300, sample: () => 0.25, streamingSize: true }))
    const out = readBack(await readWavFragment(path, { start: 0, end: null, channels: [0, 1], fades: false }))
    expect(out).toMatchObject({ channels: 1, frames: 300 })
  })

  it('keeps 8-bit audio unsigned and pads an odd data chunk', async () => {
    const path = join(tempDir(), 'e.wav')
    writeFileSync(path, buildWav({ format: 'int', bitsPerSample: 8, channels: 1, sampleRate: 1000, frames: 101, sample: () => 0 }))
    const bytes = await readWavFragment(path, { start: 0, end: null, channels: [0], fades: false })
    expect(bytes.length).toBe(44 + 102)
    expect(bytes[44]).toBe(128)
  })
})

describe('export files', () => {
  it('names fragments and isolated channels', () => {
    expect(exportFileName('Door 01.wav', { channel: null, start: 0.84, end: 1.956 })).toBe('Door 01_0.84-1.96.wav')
    expect(exportFileName('Door 01.wav', { channel: 1, start: 0.84, end: 1.96 })).toBe('Door 01_R_0.84-1.96.wav')
    expect(exportFileName('Door.v2.mp3', { channel: 0, start: null, end: null })).toBe('Door.v2_L.mp3')
  })

  it('reuses an identical file and numbers a different one', async () => {
    const dir = tempDir()
    const first = await writeExport(dir, 'a.wav', new Uint8Array([1, 2, 3]))
    expect(await writeExport(dir, 'a.wav', new Uint8Array([1, 2, 3]))).toBe(first)
    const second = await writeExport(dir, 'a.wav', new Uint8Array([4, 5, 6]))
    expect(second).toBe(join(dir, 'a (2).wav'))
    expect(Array.from(await readFile(second))).toEqual([4, 5, 6])
    expect(readdirSync(dir).sort()).toEqual(['a (2).wav', 'a.wav'])
  })
})

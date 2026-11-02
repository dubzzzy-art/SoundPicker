import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readAudioDetails } from '../src/main/scan/metadata'
import { extensionOf, walkLibrary, type WalkEntry, type WalkFile } from '../src/main/scan/walk'

// Optional real library: SOUNDPICKER_BF1=/path/to/BF1 npm test
const BF1 = process.env.SOUNDPICKER_BF1 ?? ''

async function collect(root: string): Promise<WalkEntry[]> {
  const entries: WalkEntry[] = []
  for await (const entry of walkLibrary(root)) entries.push(entry)
  return entries
}

function makeTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'soundpicker-walk-'))
  const write = (rel: string) => {
    const full = join(root, ...rel.split('/'))
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, 'x')
  }
  write('Doors/Wood/Door 10.WAV')
  write('Doors/Wood/Door 2.wav')
  write('Doors/notes.txt')
  write('Footsteps/Step 1.mp3')
  write('.hidden/secret.mp3')
  write('$RECYCLE.BIN/old.wav')
  write('root.mp3')
  mkdirSync(join(root, 'Empty'))
  return root
}

describe('walkLibrary', () => {
  it('lists folders before their contents and keeps only mp3 and wav', async () => {
    const root = makeTree()
    const entries = await collect(root)
    const summary = entries.map((entry) => (entry.kind === 'folder' ? `dir:${entry.relPath}` : `${entry.relDir}|${entry.name}`))
    expect(summary).toEqual([
      'dir:',
      '|root.mp3',
      'dir:Doors',
      'dir:Doors/Wood',
      'Doors/Wood|Door 2.wav',
      'Doors/Wood|Door 10.WAV',
      'dir:Empty',
      'dir:Footsteps',
      'Footsteps|Step 1.mp3'
    ])
    const door = entries.find((entry) => entry.kind === 'file' && entry.name === 'Door 10.WAV') as WalkFile
    expect(door.ext).toBe('wav')
    expect(door.size).toBe(1)
  })

  it('stops when cancelled', async () => {
    const root = makeTree()
    const entries: WalkEntry[] = []
    for await (const entry of walkLibrary(root, () => {}, () => entries.length >= 2)) entries.push(entry)
    expect(entries.length).toBe(2)
  })

  it('reports an unreadable root instead of throwing', async () => {
    const problems: string[] = []
    const entries: WalkEntry[] = []
    for await (const entry of walkLibrary(join(tmpdir(), 'soundpicker-does-not-exist'), (p) => problems.push(p.path))) {
      entries.push(entry)
    }
    expect(entries).toHaveLength(1)
    expect(problems).toHaveLength(1)
  })

  it('reads extensions case-insensitively', () => {
    expect(extensionOf('A.MP3')).toBe('mp3')
    expect(extensionOf('.mp3')).toBe('')
    expect(extensionOf('noext')).toBe('')
  })
})

describe.skipIf(!BF1 || !existsSync(BF1))('BF1 sample library', () => {
  it('finds 299 sounds in 22 subfolders', async () => {
    const entries = await collect(BF1)
    expect(entries.filter((entry) => entry.kind === 'folder')).toHaveLength(23)
    expect(entries.filter((entry) => entry.kind === 'file')).toHaveLength(299)
  })

  it('reads mp3 details', async () => {
    const details = await readAudioDetails(join(BF1, 'Grab', 'MeleeMelee_Grab_Wave 0 0 0.mp3'))
    expect(details.sampleRate).toBe(48000)
    expect(details.channels).toBe(1)
    expect(details.bitrate).toBe(64000)
    expect(details.bitDepth).toBeNull()
    expect(details.duration).toBeGreaterThan(0.5)
  })
})

describe('readAudioDetails', () => {
  it('reads a PCM wav header', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'soundpicker-wav-')), 'tone.wav')
    writeFileSync(file, makeWav({ sampleRate: 48000, channels: 2, bits: 24, seconds: 0.5 }))
    const details = await readAudioDetails(file)
    expect(details).toMatchObject({ sampleRate: 48000, channels: 2, bitDepth: 24, bitrate: null })
    expect(details.duration).toBeCloseTo(0.5, 3)
  })

  it('rejects a file that is not audio', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'soundpicker-bad-')), 'bad.mp3')
    writeFileSync(file, 'not audio at all')
    await expect(readAudioDetails(file)).rejects.toThrow()
  })
})

function makeWav({ sampleRate, channels, bits, seconds }: { sampleRate: number; channels: number; bits: number; seconds: number }): Buffer {
  const blockAlign = channels * (bits / 8)
  const dataSize = Math.round(sampleRate * seconds) * blockAlign
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * blockAlign, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(bits, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  return buffer
}

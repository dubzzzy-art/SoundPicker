import { readFileSync } from 'node:fs'
import { parseBuffer } from 'music-metadata'
import { describe, expect, it } from 'vitest'
import { encodeMp3, fadeEdges, loadLame, standardBitrate } from '../src/main/export/mp3'

const lame = loadLame(readFileSync('node_modules/lamejs/lame.all.js', 'utf8'))

function sine(seconds: number, sampleRate: number, frequency: number): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * sampleRate) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * frequency * i) / sampleRate))
}

describe('MP3 export', () => {
  it('picks the source bitrate, rounding VBR up to a constant one', () => {
    expect(standardBitrate(44100, 192000)).toBe(192)
    expect(standardBitrate(48000, 171500)).toBe(192)
    expect(standardBitrate(44100, 128400)).toBe(128)
    expect(standardBitrate(22050, 64000)).toBe(64)
    expect(standardBitrate(22050, 200000)).toBe(160)
    expect(standardBitrate(44100, null)).toBe(192)
  })

  it('encodes stereo and mono at the source rate and bitrate', async () => {
    const stereo = encodeMp3(lame, { sampleRate: 44100, channels: [sine(1, 44100, 440), sine(1, 44100, 660)] }, 192)
    const info = await parseBuffer(stereo, { mimeType: 'audio/mpeg' }, { duration: true })
    expect(info.format).toMatchObject({ sampleRate: 44100, numberOfChannels: 2, bitrate: 192000 })
    // The encoder adds about 50 ms of padding.
    expect(info.format.duration).toBeGreaterThan(0.99)
    expect(info.format.duration).toBeLessThan(1.1)

    const mono = encodeMp3(lame, { sampleRate: 48000, channels: [sine(0.5, 48000, 440)] }, 128)
    const monoInfo = await parseBuffer(mono, { mimeType: 'audio/mpeg' }, { duration: true })
    expect(monoInfo.format).toMatchObject({ sampleRate: 48000, numberOfChannels: 1, bitrate: 128000 })
  })

  it('encodes 30 s of stereo quickly enough to drag', () => {
    const started = performance.now()
    encodeMp3(lame, { sampleRate: 48000, channels: [sine(30, 48000, 440), sine(30, 48000, 550)] }, 192)
    const elapsed = performance.now() - started
    console.log(`30 s stereo MP3 encoded in ${elapsed.toFixed(0)} ms`)
    expect(elapsed).toBeLessThan(5000)
  })

  it('fades the edges of float samples', () => {
    const pcm = { sampleRate: 1000, channels: [new Float32Array(100).fill(1)] }
    fadeEdges(pcm)
    expect(Array.from(pcm.channels[0].slice(0, 3))).toEqual([0, 0.20000000298023224, 0.4000000059604645])
    expect(pcm.channels[0][99]).toBe(0)
    expect(pcm.channels[0][50]).toBe(1)
  })
})

import { describe, expect, it } from 'vitest'
import { computePeaks, decodePeaks, encodePeaks, envelope, type SampleSource } from '../src/renderer/src/audio/peaks'

function source(...channels: number[][]): SampleSource {
  return {
    numberOfChannels: channels.length,
    length: channels[0].length,
    getChannelData: (channel) => Float32Array.from(channels[channel])
  }
}

describe('waveform peaks', () => {
  it('keeps the loudest sample of each slice, per channel', () => {
    const peaks = computePeaks(source([0, 0.5, -1, 0.25], [0.1, 0, 0, -0.2]), 2)
    expect(peaks).toMatchObject({ channels: 2, buckets: 2 })
    expect([...peaks.data]).toEqual([128, 255, 26, 51])
  })

  it('round-trips through the cache format', () => {
    const peaks = computePeaks(source([0.1, 0.9, 0.3, 0.2, 0.5, 0]), 3)
    expect(decodePeaks(encodePeaks(peaks))).toEqual(peaks)
  })

  it('refuses a damaged cache entry', () => {
    expect(decodePeaks(new Uint8Array([1, 2, 4, 0, 9]))).toBeNull()
    expect(decodePeaks(new Uint8Array([7, 1, 1, 0, 9]))).toBeNull()
  })

  it('takes the louder channel and smooths the outline', () => {
    const peaks = computePeaks(source([0, 0, 1, 0, 0], [0, 0, 0, 0, 0]), 5)
    const outline = envelope(peaks, 5)
    expect(outline[2]).toBeCloseTo(0.6)
    expect(outline[1]).toBeCloseTo(0.2)
    expect(outline[0]).toBe(0)
    expect(envelope(peaks, 5, 1)[2]).toBe(0)
  })

  it('handles more points than buckets', () => {
    const peaks = computePeaks(source([1, 0]), 2)
    expect(envelope(peaks, 8)).toHaveLength(8)
  })
})

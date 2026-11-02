import { describe, expect, it } from 'vitest'
import { repairMp3 } from '../src/renderer/src/audio/mp3-repair'

// MPEG-1 Layer III, 80 kbps, 44.1 kHz: 261 bytes per frame.
function frame(mono: boolean, fill: number, size = 261): number[] {
  const header = [0xff, 0xfb, 0x60, mono ? 0xc0 : 0x00]
  return [...header, ...Array<number>(size - 4).fill(fill)]
}

function bytes(...parts: number[][]): Uint8Array {
  return Uint8Array.from(parts.flat())
}

describe('MP3 repair', () => {
  it('drops a cut-off stereo frame at the end of a mono file', () => {
    const file = bytes(frame(true, 1), frame(true, 2), frame(false, 0).slice(0, 19))
    expect(repairMp3(file)).toEqual(bytes(frame(true, 1), frame(true, 2)))
  })

  it('drops whole frames whose channel count differs from the first', () => {
    const file = bytes(frame(true, 1), frame(false, 2), frame(true, 3))
    expect(repairMp3(file)).toEqual(bytes(frame(true, 1), frame(true, 3)))
  })

  it('skips an ID3 tag and stops at data that is not a frame', () => {
    const tag = [0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 5, 9, 9, 9, 9, 9]
    const file = bytes(tag, frame(true, 1), [0x54, 0x41, 0x47, 0, 0])
    expect(repairMp3(file)).toEqual(bytes(frame(true, 1)))
  })

  it('leaves clean files and other formats alone', () => {
    expect(repairMp3(bytes(frame(true, 1), frame(true, 2)))).toBeNull()
    expect(repairMp3(bytes([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]))).toBeNull()
  })
})

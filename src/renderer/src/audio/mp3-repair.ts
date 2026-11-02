// Chromium rejects an MP3 whose channel count changes between frames;
// such files are decoded from the frames matching the first one.

const BITRATES = {
  v1l1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  v1l2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  v1l3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2l1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  v2l23: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
}
const SAMPLE_RATES = [44100, 48000, 32000]

interface Frame {
  size: number
  format: number
}

function readFrame(bytes: Uint8Array, at: number): Frame | null {
  if (at + 4 > bytes.length || bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0) return null
  const version = (bytes[at + 1] >> 3) & 3 // 0: 2.5, 2: 2, 3: 1
  const layer = (bytes[at + 1] >> 1) & 3 // 1: III, 2: II, 3: I
  const bitrateIndex = bytes[at + 2] >> 4
  const rateIndex = (bytes[at + 2] >> 2) & 3
  if (version === 1 || layer === 0 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null
  const v1 = version === 3
  const table = layer === 3 ? (v1 ? BITRATES.v1l1 : BITRATES.v2l1) : v1 ? (layer === 2 ? BITRATES.v1l2 : BITRATES.v1l3) : BITRATES.v2l23
  const bitrate = table[bitrateIndex] * 1000
  const sampleRate = SAMPLE_RATES[rateIndex] / (v1 ? 1 : version === 2 ? 2 : 4)
  const padding = (bytes[at + 2] >> 1) & 1
  const size =
    layer === 3
      ? (Math.floor((12 * bitrate) / sampleRate) + padding) * 4
      : Math.floor(((layer === 1 && !v1 ? 72 : 144) * bitrate) / sampleRate) + padding
  const mono = bytes[at + 3] >> 6 === 3 ? 1 : 0
  return { size, format: (version << 5) | (layer << 3) | (rateIndex << 1) | mono }
}

export function repairMp3(bytes: Uint8Array): Uint8Array | null {
  let at = 0
  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    at = 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]) + (bytes[5] & 0x10 ? 10 : 0)
  }
  const first = readFrame(bytes, at)
  if (!first) return null
  const kept: Array<[number, number]> = []
  let length = 0
  for (let frame: Frame | null = first; frame && at + frame.size <= bytes.length; frame = readFrame(bytes, at)) {
    if (frame.format === first.format) {
      kept.push([at, at + frame.size])
      length += frame.size
    }
    at += frame.size
  }
  if (kept.length === 0 || length === bytes.length) return null
  const out = new Uint8Array(length)
  let offset = 0
  for (const [start, end] of kept) {
    out.set(bytes.subarray(start, end), offset)
    offset += end - start
  }
  return out
}

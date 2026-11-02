export const PEAK_BUCKETS = 1024
const FORMAT_VERSION = 1
const HEADER_BYTES = 4

export interface Peaks {
  channels: number
  buckets: number
  // data[channel * buckets + bucket]
  data: Uint8Array
}

export interface SampleSource {
  numberOfChannels: number
  length: number
  getChannelData(channel: number): Float32Array
}

export function computePeaks(source: SampleSource, buckets = PEAK_BUCKETS): Peaks {
  const channels = Math.max(1, Math.min(source.numberOfChannels, 8))
  const data = new Uint8Array(channels * buckets)
  const length = source.length
  for (let channel = 0; channel < channels; channel++) {
    const samples = source.getChannelData(channel)
    for (let bucket = 0; bucket < buckets; bucket++) {
      const start = Math.floor((bucket * length) / buckets)
      const end = Math.max(start + 1, Math.floor(((bucket + 1) * length) / buckets))
      let max = 0
      for (let i = start; i < end && i < length; i++) {
        const value = Math.abs(samples[i])
        if (value > max) max = value
      }
      data[channel * buckets + bucket] = Math.round(Math.min(1, max) * 255)
    }
  }
  return { channels, buckets, data }
}

export function encodePeaks(peaks: Peaks): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES + peaks.data.length)
  bytes[0] = FORMAT_VERSION
  bytes[1] = peaks.channels
  bytes[2] = peaks.buckets & 0xff
  bytes[3] = peaks.buckets >> 8
  bytes.set(peaks.data, HEADER_BYTES)
  return bytes
}

export function decodePeaks(bytes: Uint8Array): Peaks | null {
  if (bytes.length < HEADER_BYTES || bytes[0] !== FORMAT_VERSION) return null
  const channels = bytes[1]
  const buckets = bytes[2] | (bytes[3] << 8)
  if (channels === 0 || buckets === 0 || bytes.length !== HEADER_BYTES + channels * buckets) return null
  return { channels, buckets, data: bytes.slice(HEADER_BYTES) }
}

export function envelope(peaks: Peaks, points: number, channel: number | null = null): Float32Array {
  const raw = new Float32Array(points)
  const { buckets, channels, data } = peaks
  for (let point = 0; point < points; point++) {
    const start = Math.floor((point * buckets) / points)
    const end = Math.max(start + 1, Math.floor(((point + 1) * buckets) / points))
    let max = 0
    for (let ch = 0; ch < channels; ch++) {
      if (channel !== null && ch !== channel) continue
      for (let bucket = start; bucket < end && bucket < buckets; bucket++) {
        const value = data[ch * buckets + bucket]
        if (value > max) max = value
      }
    }
    raw[point] = max / 255
  }
  const smooth = new Float32Array(points)
  for (let point = 0; point < points; point++) {
    const prev = raw[Math.max(0, point - 1)]
    const next = raw[Math.min(points - 1, point + 1)]
    smooth[point] = Math.max(raw[point] * 0.6 + (prev + next) * 0.2, 0)
  }
  return smooth
}

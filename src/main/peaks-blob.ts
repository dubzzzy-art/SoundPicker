import { deflateRawSync, inflateRawSync } from 'node:zlib'

const HEADER_BYTES = 4

export function packPeaks(bytes: Uint8Array): Uint8Array {
  const levels = Uint8Array.from(bytes, (value, i) => (i < HEADER_BYTES ? value : value >> 2))
  return new Uint8Array(deflateRawSync(levels, { level: 9 }))
}

export function unpackPeaks(blob: Uint8Array): Uint8Array | null {
  try {
    const levels = inflateRawSync(blob)
    return Uint8Array.from(levels, (value, i) => (i < HEADER_BYTES ? value : (value << 2) | (value >> 4)))
  } catch {
    return null
  }
}

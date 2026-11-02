import { parseFile } from 'music-metadata'

export interface AudioDetails {
  duration: number
  sampleRate: number | null
  channels: number | null
  bitDepth: number | null
  bitrate: number | null
}

export async function readAudioDetails(path: string): Promise<AudioDetails> {
  const { format } = await parseFile(path, { duration: true, skipCovers: true })
  if (format.duration === undefined || !Number.isFinite(format.duration)) {
    throw new Error('No audio length in file')
  }
  const lossless = format.lossless === true
  return {
    duration: format.duration,
    sampleRate: format.sampleRate ?? null,
    channels: format.numberOfChannels ?? null,
    bitDepth: lossless ? (format.bitsPerSample ?? null) : null,
    bitrate: lossless ? null : format.bitrate ? Math.round(format.bitrate) : null
  }
}

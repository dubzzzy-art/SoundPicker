import type { AudioDetails } from './metadata'
import type { WalkEntry } from './walk'

export interface MetadataRequest {
  id: number
  path: string
}

export type MetadataResult = { id: number; details: AudioDetails } | { id: number; error: string }

export type ToWorker =
  | { type: 'walk'; root: string }
  | { type: 'metadata'; items: MetadataRequest[] }
  | { type: 'cancel' }

export type FromWorker =
  | { type: 'entries'; entries: WalkEntry[]; currentPath: string }
  | { type: 'problem'; path: string; message: string }
  | { type: 'walk-finished'; cancelled: boolean }
  | { type: 'metadata-results'; results: MetadataResult[] }

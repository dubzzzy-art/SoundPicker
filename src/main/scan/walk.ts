import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

export const AUDIO_EXTENSIONS = new Set(['mp3', 'wav'])

const SKIPPED_FOLDERS = new Set([
  '$recycle.bin',
  'system volume information',
  '.trash',
  '.trashes',
  '.spotlight-v100',
  '.fseventsd'
])

const STAT_CONCURRENCY = 32

export interface WalkFolder {
  kind: 'folder'
  relPath: string
  name: string
}

export interface WalkFile {
  kind: 'file'
  relDir: string
  name: string
  ext: string
  size: number
  mtimeMs: number
}

export type WalkEntry = WalkFolder | WalkFile

export interface WalkProblem {
  path: string
  message: string
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

export function joinRel(parent: string, name: string): string {
  return parent === '' ? name : `${parent}/${name}`
}

export function absolutePath(root: string, relPath: string): string {
  return relPath === '' ? root : join(root, ...relPath.split('/'))
}

// Yields each folder before its contents.
export async function* walkLibrary(
  root: string,
  onProblem: (problem: WalkProblem) => void = () => {},
  isCancelled: () => boolean = () => false
): AsyncGenerator<WalkEntry> {
  const pending: string[] = ['']

  while (pending.length > 0) {
    if (isCancelled()) return
    const relPath = pending.pop()!
    const dirPath = absolutePath(root, relPath)
    yield { kind: 'folder', relPath, name: relPath === '' ? basename(root) : basename(relPath) }

    let entries: Dirent[]
    try {
      entries = await readdir(dirPath, { withFileTypes: true })
    } catch (error) {
      onProblem({ path: dirPath, message: describe(error) })
      continue
    }
    entries.sort((a, b) => compareNames(a.name, b.name))

    const subfolders: string[] = []
    const audioNames: string[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const kind = await entryKind(entry, dirPath)
      if (kind === 'folder') {
        if (!SKIPPED_FOLDERS.has(entry.name.toLowerCase())) subfolders.push(joinRel(relPath, entry.name))
      } else if (kind === 'file' && AUDIO_EXTENSIONS.has(extensionOf(entry.name))) {
        audioNames.push(entry.name)
      }
    }

    for (let start = 0; start < audioNames.length; start += STAT_CONCURRENCY) {
      if (isCancelled()) return
      const chunk = audioNames.slice(start, start + STAT_CONCURRENCY)
      const stats = await Promise.all(
        chunk.map((name) =>
          stat(join(dirPath, name)).catch((error: unknown) => {
            onProblem({ path: join(dirPath, name), message: describe(error) })
            return null
          })
        )
      )
      for (let i = 0; i < chunk.length; i++) {
        const info = stats[i]
        if (!info) continue
        const name = chunk[i]
        yield { kind: 'file', relDir: relPath, name, ext: extensionOf(name), size: info.size, mtimeMs: Math.round(info.mtimeMs) }
      }
    }

    // Reversed so folders pop in alphabetical order.
    for (let i = subfolders.length - 1; i >= 0; i--) pending.push(subfolders[i])
  }
}

// Symlinks are skipped to avoid loops; unknown types are stat-ed.
async function entryKind(entry: Dirent, dirPath: string): Promise<'folder' | 'file' | 'other'> {
  if (entry.isSymbolicLink()) return 'other'
  if (entry.isDirectory()) return 'folder'
  if (entry.isFile()) return 'file'
  try {
    const info = await stat(join(dirPath, entry.name))
    if (info.isDirectory()) return 'folder'
    if (info.isFile()) return 'file'
  } catch {
  }
  return 'other'
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export function compareNames(a: string, b: string): number {
  return collator.compare(a, b)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

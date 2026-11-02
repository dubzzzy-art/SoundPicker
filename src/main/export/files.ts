import { mkdir, open, readFile, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'

export interface ExportNameParts {
  channel: number | null
  start: number | null
  end: number | null
}

export function exportFileName(sourceName: string, parts: ExportNameParts): string {
  const ext = extname(sourceName)
  const pieces = [sourceName.slice(0, sourceName.length - ext.length)]
  if (parts.channel !== null) pieces.push(parts.channel === 0 ? 'L' : 'R')
  if (parts.start !== null && parts.end !== null) pieces.push(`${parts.start.toFixed(2)}-${parts.end.toFixed(2)}`)
  return pieces.join('_') + ext
}

export async function writeExport(dir: string, name: string, bytes: Uint8Array): Promise<string> {
  await mkdir(dir, { recursive: true })
  const ext = extname(name)
  const base = name.slice(0, name.length - ext.length)
  for (let attempt = 1; attempt < 1000; attempt++) {
    const path = join(dir, attempt === 1 ? name : `${base} (${attempt})${ext}`)
    try {
      const file = await open(path, 'wx')
      try {
        await file.writeFile(bytes)
      } finally {
        await file.close()
      }
      return path
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (await holds(path, bytes)) return path
    }
  }
  throw new Error(`Too many files named ${name} in the export folder`)
}

async function holds(path: string, bytes: Uint8Array): Promise<boolean> {
  try {
    if ((await stat(path)).size !== bytes.length) return false
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).equals(await readFile(path))
  } catch {
    return false
  }
}

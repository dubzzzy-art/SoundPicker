import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

const CHROMIUM_ENTRIES = [
  'Cache',
  'Code Cache',
  'Cookies',
  'Cookies-journal',
  'DIPS',
  'DIPS-journal',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GPUCache',
  'GPUPersistentCache',
  'GraphiteDawnCache',
  'Local State',
  'Local Storage',
  'Network Persistent State',
  'Preferences',
  'Session Storage',
  'Shared Dictionary',
  'SharedStorage',
  'Trust Tokens',
  'Trust Tokens-journal',
  'blob_storage',
  'declarative_performance_observer.db',
  'declarative_performance_observer.db-journal'
]

// Builds before 0.6.1 left Chromium data next to the database; moved once.
export function moveChromiumData(userData: string, target: string): string[] {
  const moved: string[] = []
  for (const name of CHROMIUM_ENTRIES) {
    const from = join(userData, name)
    const to = join(target, name)
    if (!existsSync(from) || existsSync(to)) continue
    try {
      mkdirSync(target, { recursive: true })
      renameSync(from, to)
      moved.push(name)
    } catch {
    }
  }
  return moved
}

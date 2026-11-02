import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ThemeSetting } from '../shared/api'
import { log } from './log'

export interface StoredSettings {
  // null: the default folder.
  exportFolder: string | null
  theme: ThemeSetting
}

const DEFAULTS: StoredSettings = { exportFolder: null, theme: 'system' }
const THEMES: ThemeSetting[] = ['system', 'light', 'dark']

export class SettingsStore {
  private current: StoredSettings

  constructor(private readonly file: string) {
    this.current = this.read()
  }

  get(): StoredSettings {
    return { ...this.current }
  }

  update(patch: Partial<StoredSettings>): StoredSettings {
    this.current = { ...this.current, ...patch }
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(this.current, null, 2))
    } catch (error) {
      log('error', `Could not save settings to ${this.file}`, error)
    }
    return this.get()
  }

  private read(): StoredSettings {
    try {
      const stored = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<StoredSettings>
      return {
        exportFolder: typeof stored.exportFolder === 'string' && stored.exportFolder ? stored.exportFolder : null,
        theme: THEMES.includes(stored.theme as ThemeSetting) ? (stored.theme as ThemeSetting) : DEFAULTS.theme
      }
    } catch {
      return { ...DEFAULTS }
    }
  }
}

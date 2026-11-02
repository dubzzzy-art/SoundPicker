import { useEffect, useState, type KeyboardEvent } from 'react'
import type { AppSettings, ThemeSetting } from '@shared/api'
import { CloseIcon, FolderIcon } from '../icons'

const api = window.soundpicker

const THEMES: { value: ThemeSetting; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

export function SettingsDialog({ onClose }: { onClose(): void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const show = (next: AppSettings) => {
    setSettings(next)
    setDraft(next.exportFolder)
    setError(null)
  }

  useEffect(() => {
    void api.getSettings().then(show)
  }, [])

  const commit = async () => {
    if (!settings || draft === settings.exportFolder) return
    const result = await api.setExportFolder(draft)
    if (result.ok) show(result.settings)
    else setError(result.message)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  const onPathKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void commit()
    } else if (event.key === 'Escape' && settings && draft !== settings.exportFolder) {
      event.preventDefault()
      event.stopPropagation()
      show(settings)
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onKeyDown={onKeyDown}>
        <div className="dialog-head">
          <div className="dialog-title-row">
            <h2 id="settings-title" className="dialog-title">
              Settings
            </h2>
            <span className="statusbar-spacer" />
            <button className="icon-button" aria-label="Close" title="Close" autoFocus onClick={onClose}>
              <CloseIcon size={12} />
            </button>
          </div>
        </div>
        {settings && (
          <div className="settings-body">
            <section className="settings-section">
              <h3 className="section-title" id="settings-theme">
                Theme
              </h3>
              <div className="segmented settings-theme" role="group" aria-labelledby="settings-theme">
                {THEMES.map((theme) => (
                  <button
                    key={theme.value}
                    aria-pressed={settings.theme === theme.value}
                    onClick={() => void api.setTheme(theme.value).then((next) => setSettings({ ...settings, theme: next.theme }))}
                  >
                    {theme.label}
                  </button>
                ))}
              </div>
            </section>
            <section className="settings-section">
              <h3 className="section-title">Export folder</h3>
              <div className="settings-path-row">
                <input
                  className="settings-path mono"
                  aria-label="Export folder"
                  spellCheck={false}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={() => void commit()}
                  onKeyDown={onPathKey}
                />
                <button className="secondary-button" onClick={() => void api.chooseExportFolder().then(show)}>
                  Change
                </button>
                <button className="secondary-button" onClick={() => void commit().then(() => api.openExportFolder())}>
                  <FolderIcon size={14} />
                  Open
                </button>
              </div>
              {error && <p className="settings-error">{error}</p>}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

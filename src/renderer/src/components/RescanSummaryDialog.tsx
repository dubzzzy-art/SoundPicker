import { useMemo, useState, type KeyboardEvent } from 'react'
import type { FolderRow, MissingFolder, RescanLeftovers, RescanSummary } from '@shared/api'
import { formatCount } from '../format'
import { CloseIcon, RefreshIcon, StarIcon } from '../icons'

const api = window.soundpicker

const GROUPS_SHOWN = 30

interface RescanSummaryDialogProps {
  summary: RescanSummary
  libraryName: string
  folders: FolderRow[]
  onClose(): void
}

export function RescanSummaryDialog({ summary, libraryName, folders, onClose }: RescanSummaryDialogProps) {
  const [left, setLeft] = useState<RescanLeftovers>(summary)
  const unchanged = summary.added === 0 && summary.moved.length === 0 && summary.missing === 0
  const movedGroups = useMemo(() => {
    const groups = new Map<string, { key: string; from: string; to: string; names: string[] }>()
    for (const file of summary.moved) {
      const key = `${file.from}\u0000${file.to}`
      const group = groups.get(key) ?? { key, from: file.from, to: file.to, names: [] }
      group.names.push(file.name)
      groups.set(key, group)
    }
    return [...groups.values()].sort((a, b) => b.names.length - a.names.length)
  }, [summary.moved])

  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog rescan-dialog" role="dialog" aria-modal="true" aria-labelledby="rescan-title" onKeyDown={onKeyDown}>
        <div className="folder-dialog-head">
          <span className="folder-dialog-icon">
            <RefreshIcon size={20} />
          </span>
          <div className="folder-dialog-heading">
            <h2 id="rescan-title" className="dialog-title">
              {libraryName} rescanned
            </h2>
            <span className="mono muted folder-dialog-path">
              {unchanged
                ? 'No files were added, moved or removed'
                : `${formatCount(summary.added)} new · ${formatCount(summary.moved.length)} moved · ${formatCount(summary.missing)} missing`}
            </span>
          </div>
          <button className="icon-button" aria-label="Close" title="Close" autoFocus onClick={onClose}>
            <CloseIcon size={12} />
          </button>
        </div>

        <div className="rescan-body">
          <div className="rescan-stats">
            <Stat value={summary.added} label="new files" note="Indexed and searchable." />
            <Stat value={summary.moved.length} label="moved" note="Found in another folder; keywords went with them." />
            <Stat value={summary.missing} label="missing" note="No longer on disk. Files without keywords or a star are dropped from the index." />
          </div>

          {left.missingFolders.length > 0 && (
            <section className="rescan-section">
              <h3 className="section-title">Missing folders with keywords</h3>
              <p className="keyword-empty">Give their keywords to the folder they became, or delete them.</p>
              <div className="rescan-list">
                {left.missingFolders.map((folder) => (
                  <MissingFolderRow key={folder.id} folder={folder} folders={folders} onDone={setLeft} />
                ))}
              </div>
            </section>
          )}

          {left.missingFiles.length > 0 && (
            <section className="rescan-section">
              <div className="inspector-section-head">
                <h3 className="section-title">Missing files with keywords or stars · {formatCount(left.missingFiles.length)}</h3>
                <button className="link-button section-link" onClick={() => void api.clearMissingFiles(left.libraryId, null).then(setLeft)}>
                  Clear all
                </button>
              </div>
              <p className="keyword-empty">Their keywords and stars are kept in case the files come back. Clear them once the files are gone for good.</p>
              <div className="rescan-list">
                {left.missingFiles.map((file) => (
                  <div key={file.id} className="rescan-row">
                    <span className="rescan-name" title={file.relDir ? `${file.relDir}/${file.name}` : file.name}>
                      {file.name}
                      <span className="rescan-path mono">{file.relDir || '/'}</span>
                    </span>
                    <span className="subfolder-keywords">
                      {file.favorite && (
                        <span className="rescan-star" title="Starred" aria-label="Starred">
                          <StarIcon size={12} filled />
                        </span>
                      )}
                      {file.keywords.map((keyword) => (
                        <span key={keyword} className="file-keyword">
                          {keyword}
                        </span>
                      ))}
                    </span>
                    <button className="secondary-button rescan-button" onClick={() => void api.clearMissingFiles(left.libraryId, [file.id]).then(setLeft)}>
                      Clear
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
          {movedGroups.length > 0 && (
            <section className="rescan-section">
              <h3 className="section-title">Moved</h3>
              <div className="rescan-list">
                {movedGroups.slice(0, GROUPS_SHOWN).map((group) => (
                  <div key={group.key} className="rescan-row" title={group.names.slice(0, 20).join('\n')}>
                    <span className="rescan-path mono">
                      {group.from || '(library root)'} → {group.to || '(library root)'}
                    </span>
                    <span className="mono muted">
                      {formatCount(group.names.length)} {group.names.length === 1 ? 'file' : 'files'}
                    </span>
                  </div>
                ))}
                {movedGroups.length > GROUPS_SHOWN && (
                  <p className="keyword-empty">and {formatCount(movedGroups.length - GROUPS_SHOWN)} more folders</p>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ value, label, note }: { value: number; label: string; note: string }) {
  return (
    <div className="rescan-stat" title={note}>
      <span className="rescan-stat-value mono">{formatCount(value)}</span>
      <span className="rescan-stat-label">{label}</span>
    </div>
  )
}

function MissingFolderRow({ folder, folders, onDone }: { folder: MissingFolder; folders: FolderRow[]; onDone(left: RescanLeftovers): void }) {
  const [target, setTarget] = useState<number | null>(folder.suggestedFolderId)
  return (
    <div className="rescan-row rescan-folder">
      <span className="rescan-name">
        <span className="mono">{folder.relPath}</span>
        <span className="rescan-folder-keywords">
          {folder.keywords.map((keyword) => (
            <span key={keyword} className="inherited-chip">
              {keyword}
            </span>
          ))}
        </span>
      </span>
      <select
        className="library-filter rescan-target"
        aria-label={`Folder to give the keywords of ${folder.relPath}`}
        value={target ?? ''}
        onChange={(event) => setTarget(event.target.value === '' ? null : Number(event.target.value))}
      >
        <option value="">Choose a folder</option>
        {folders.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.relPath || '(library root)'}
            {candidate.id === folder.suggestedFolderId ? ' (files moved here)' : ''}
          </option>
        ))}
      </select>
      <button
        className="secondary-button rescan-button"
        disabled={target === null}
        onClick={() => void api.moveFolderKeywords(folder.id, target).then(onDone)}
      >
        Move keywords
      </button>
      <button className="secondary-button rescan-button is-danger" onClick={() => void api.moveFolderKeywords(folder.id, null).then(onDone)}>
        Delete
      </button>
    </div>
  )
}

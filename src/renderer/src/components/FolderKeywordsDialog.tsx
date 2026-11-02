import { useMemo, type KeyboardEvent } from 'react'
import type { FolderRow } from '@shared/api'
import type { KeywordSummary } from '@shared/keywords'
import { formatCount } from '../format'
import { CloseIcon, FolderIcon, LibraryIcon } from '../icons'
import { subfolders, type InheritedKeyword } from '../tree'
import { KeywordInput } from './KeywordInput'

const SUBFOLDERS_SHOWN = 8

interface FolderKeywordsDialogProps {
  folder: FolderRow
  folders: FolderRow[]
  libraryName: string
  rootPath: string
  platform: string
  catalog: KeywordSummary[]
  fromParents: InheritedKeyword[]
  onAdd(name: string): void
  onRemove(name: string): void
  onOpenFolder(folderId: number): void
  onClose(): void
}

export function FolderKeywordsDialog(props: FolderKeywordsDialogProps) {
  const { folder, folders, catalog, fromParents } = props
  const isLibrary = folder.parentId === null
  const name = isLibrary ? props.libraryName : folder.name
  const separator = props.platform === 'win32' ? '\\' : '/'
  const path = folder.relPath === '' ? props.rootPath : [props.rootPath, ...folder.relPath.split('/')].join(separator)
  const below = useMemo(() => subfolders(folder.id, folders), [folders, folder.id])
  const tagged = below.filter((subfolder) => subfolder.keywords.length > 0)
  const own = useMemo(() => new Set(folder.keywords), [folder.keywords])

  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      props.onClose()
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <div className="dialog folder-dialog" role="dialog" aria-modal="true" aria-labelledby="folder-dialog-title" onKeyDown={onKeyDown}>
        <div className="folder-dialog-head">
          <span className="folder-dialog-icon">{isLibrary ? <LibraryIcon size={22} /> : <FolderIcon size={22} />}</span>
          <div className="folder-dialog-heading">
            <h2 id="folder-dialog-title" className="dialog-title">
              {name}
            </h2>
            <span className="mono muted folder-dialog-path" title={path}>
              {path}
            </span>
          </div>
          <button className="icon-button" aria-label="Close" title="Close" onClick={props.onClose}>
            <CloseIcon size={12} />
          </button>
        </div>

        <div className="folder-dialog-body">
          <section className="folder-dialog-section">
            <h3 className="section-title">{isLibrary ? 'Library keywords' : 'Folder keywords'}</h3>
            <KeywordInput
              key={folder.id}
              catalog={catalog}
              exclude={own}
              allowCreate
              autoFocus
              hideLabel
              label={`Add keyword to this ${isLibrary ? 'library' : 'folder'}`}
              placeholder="Start typing…"
              onPick={props.onAdd}
            />
            {folder.keywords.length > 0 && (
              <div className="keyword-chips">
                {folder.keywords.map((keyword) => (
                  <span key={keyword} className="keyword-chip">
                    <span className="keyword-chip-name">{keyword}</span>
                    <button
                      className="keyword-chip-remove"
                      aria-label={`Remove folder keyword ${keyword}`}
                      title="Remove keyword"
                      onClick={() => props.onRemove(keyword)}
                    >
                      <CloseIcon />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>

          {fromParents.length > 0 && (
            <section className="folder-dialog-section">
              <h3 className="section-title">Parents</h3>
              <FolderKeywordList folders={byFolder(fromParents)} onOpenFolder={props.onOpenFolder} />
            </section>
          )}

          {tagged.length > 0 && (
            <section className="folder-dialog-section">
              <h3 className="section-title">Subfolders</h3>
              <FolderKeywordList
                folders={tagged.slice(0, SUBFOLDERS_SHOWN).map((subfolder) => ({
                  folderId: subfolder.id,
                  path: subfolder.relPath.slice(folder.relPath === '' ? 0 : folder.relPath.length + 1),
                  keywords: subfolder.keywords
                }))}
                onOpenFolder={props.onOpenFolder}
              />
              {tagged.length > SUBFOLDERS_SHOWN && (
                <p className="keyword-empty">and {formatCount(tagged.length - SUBFOLDERS_SHOWN)} more</p>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

export interface FolderKeywords {
  folderId: number
  path: string
  keywords: string[]
}

// Library first, down to the nearest folder.
export function byFolder(keywords: InheritedKeyword[]): FolderKeywords[] {
  const groups: FolderKeywords[] = []
  for (const keyword of keywords) {
    const group = groups.find((candidate) => candidate.folderId === keyword.folderId)
    if (group) group.keywords.push(keyword.name)
    else groups.unshift({ folderId: keyword.folderId, path: keyword.folderPath, keywords: [keyword.name] })
  }
  return groups
}

export function FolderKeywordList({ folders, onOpenFolder }: { folders: FolderKeywords[]; onOpenFolder(folderId: number): void }) {
  return (
    <div className="folder-keyword-list">
      {folders.map((folder) => (
        <div key={folder.folderId} className="folder-keyword-row">
          <button className="folder-keyword-path" title={`Edit the keywords of ${folder.path}`} onClick={() => onOpenFolder(folder.folderId)}>
            <FolderIcon size={13} />
            <span className="folder-keyword-path-text">{folder.path}</span>
          </button>
          {folder.keywords.map((keyword) => (
            <span key={keyword} className="file-keyword">
              {keyword}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

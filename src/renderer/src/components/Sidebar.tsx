import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ScanProgress } from '@shared/api'
import { formatCompactCount, formatCount } from '../format'
import { ChevronIcon, CloseIcon, FolderIcon, LibraryIcon, PlusIcon, RefreshIcon, TagIcon } from '../icons'
import type { TreeRow } from '../tree'
import { PanelResizer, usePanelWidth, type PanelWidth } from './PanelResizer'

interface SidebarProps {
  rows: TreeRow[]
  selectedFolderId: number | null
  locatedFolderId: number | null
  renamingLibraryId: number | null
  progress: ScanProgress | null
  onSelect(row: TreeRow): void
  onToggle(row: TreeRow): void
  onLibraryMenu(libraryId: number): void
  onFolderMenu(folderId: number): void
  onFolderKeywords(folderId: number): void
  onRename(libraryId: number, name: string | null): void
  onAddLibrary(): void
  onCancelIndexing(): void
  favoriteCount: number
  favoritesOnly: boolean
  onFavoritesOnly(on: boolean): void
  keywordCount: number
  onAllKeywords(): void
}

const WIDTH: PanelWidth = { key: 'sidebarWidth', initial: 264, min: 200, max: 640 }

export function Sidebar(props: SidebarProps) {
  const { rows, progress } = props
  const hasLibraries = rows.length > 0
  const [width, setWidth] = usePanelWidth(WIDTH)

  return (
    <aside className="sidebar" aria-label="Libraries" style={{ width }}>
      <div className="section-head">
        <h2 className="section-title">Libraries</h2>
        <button className="icon-button" aria-label="Add library" title="Add library" onClick={props.onAddLibrary}>
          <PlusIcon />
        </button>
      </div>

      {hasLibraries ? (
        <div className="tree" role="tree" aria-label="Libraries">
          <div className="tree-content">
            {rows.map((row) =>
              row.isLibrary && row.libraryId === props.renamingLibraryId ? (
                <RenameRow key={row.folderId} row={row} onDone={(name) => props.onRename(row.libraryId, name)} />
              ) : (
                <TreeItem
                  key={row.folderId}
                  row={row}
                  selected={row.folderId === props.selectedFolderId}
                  located={row.folderId === props.locatedFolderId}
                  onSelect={props.onSelect}
                  onToggle={props.onToggle}
                  onLibraryMenu={props.onLibraryMenu}
                  onFolderMenu={props.onFolderMenu}
                  onFolderKeywords={props.onFolderKeywords}
                />
              )
            )}
          </div>
        </div>
      ) : (
        <div className="sidebar-empty">
          <span className="empty-icon">
            <LibraryIcon size={20} />
          </span>
          <p className="empty-title">No libraries yet</p>
          <p className="empty-text">Add a folder with your sounds. It is indexed, not copied.</p>
        </div>
      )}

      {props.favoriteCount > 0 && (
        <div className="sidebar-favorites">
          <label className="switch sidebar-favorites-switch">
            <input type="checkbox" checked={props.favoritesOnly} onChange={(event) => props.onFavoritesOnly(event.target.checked)} />
            <span className="switch-track" aria-hidden="true" />
            Favorites only
            <span className="tree-count mono">{formatCount(props.favoriteCount)}</span>
          </label>
        </div>
      )}

      {props.keywordCount > 0 && (
        <div className="sidebar-keywords">
          <button className="sidebar-keywords-button" onClick={props.onAllKeywords}>
            <TagIcon size={14} />
            All keywords
            <span className="tree-count mono">{formatCount(props.keywordCount)}</span>
          </button>
        </div>
      )}

      {progress && <IndexingCard progress={progress} onCancel={props.onCancelIndexing} />}

      <div className="sidebar-footer">
        <button className="add-library" onClick={props.onAddLibrary}>
          <PlusIcon />
          Add library
        </button>
      </div>

      <PanelResizer edge="right" label="Resize libraries" width={width} limits={WIDTH} onResize={setWidth} />
    </aside>
  )
}

interface TreeItemProps {
  row: TreeRow
  selected: boolean
  located: boolean
  onSelect(row: TreeRow): void
  onToggle(row: TreeRow): void
  onLibraryMenu(libraryId: number): void
  onFolderMenu(folderId: number): void
  onFolderKeywords(folderId: number): void
}

function TreeItem({ row, selected, located, onSelect, onToggle, onLibraryMenu, onFolderMenu, onFolderKeywords }: TreeItemProps) {
  const item = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (located) item.current?.scrollIntoView({ block: 'nearest' })
  }, [located])

  return (
    <div
      ref={item}
      role="treeitem"
      aria-selected={selected}
      aria-current={located ? 'location' : undefined}
      title={located ? 'Folder of the picked file — click to open it' : undefined}
      aria-expanded={row.hasChildren ? row.expanded : undefined}
      aria-level={row.depth + 1}
      tabIndex={selected ? 0 : -1}
      className={`tree-row${selected ? ' is-selected' : ''}${located ? ' is-located' : ''}${row.isLibrary ? ' is-library' : ''}`}
      style={{ paddingLeft: 6 + row.depth * 16 }}
      onClick={() => onSelect(row)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelect(row)
        if (event.key === 'ArrowRight' && row.hasChildren && !row.expanded) onToggle(row)
        if (event.key === 'ArrowLeft' && row.expanded) onToggle(row)
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        if (row.isLibrary) onLibraryMenu(row.libraryId)
        else onFolderMenu(row.folderId)
      }}
    >
      <button
        className={`tree-chevron${row.expanded ? ' is-open' : ''}`}
        aria-label={row.expanded ? 'Collapse' : 'Expand'}
        tabIndex={-1}
        style={{ visibility: row.hasChildren ? 'visible' : 'hidden' }}
        onClick={(event) => {
          event.stopPropagation()
          onToggle(row)
        }}
      >
        <ChevronIcon />
      </button>
      {row.isLibrary ? <LibraryIcon size={15} /> : <FolderIcon size={15} />}
      <span className="tree-label">{row.label}</span>
      {row.keywords.length > 0 && (
        <button
          className="tree-tag"
          tabIndex={-1}
          aria-label={`${row.isLibrary ? 'Library' : 'Folder'} keywords: ${row.keywords.join(', ')}`}
          title={`Keywords: ${row.keywords.join(', ')}`}
          onClick={(event) => {
            event.stopPropagation()
            onFolderKeywords(row.folderId)
          }}
        >
          <TagIcon size={12} />
        </button>
      )}
      <span className="tree-count mono" title={formatCount(row.total)}>
        {formatCompactCount(row.total)}
      </span>
    </div>
  )
}

function RenameRow({ row, onDone }: { row: TreeRow; onDone(name: string | null): void }) {
  const [value, setValue] = useState(row.label)
  const input = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  const finish = (name: string | null) => {
    if (done.current) return
    done.current = true
    onDone(name)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') finish(value)
    if (event.key === 'Escape') finish(null)
  }

  return (
    <div className="tree-row is-library is-renaming" style={{ paddingLeft: 26 }}>
      <LibraryIcon size={15} />
      <label className="visually-hidden" htmlFor={`rename-${row.libraryId}`}>
        Library name
      </label>
      <input
        id={`rename-${row.libraryId}`}
        ref={input}
        className="tree-rename"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => finish(value)}
      />
    </div>
  )
}

function IndexingCard({ progress, onCancel }: { progress: ScanProgress; onCancel(): void }) {
  const readingDetails = progress.phase === 'metadata'
  const percent = readingDetails && progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : null

  return (
    <section className="indexing-card" aria-live="polite" aria-label={`Indexing ${progress.libraryName}`}>
      <div className="indexing-head">
        <span className="indexing-icon">
          <RefreshIcon size={15} />
        </span>
        <span className="indexing-name">{progress.libraryName}</span>
        <button className="icon-button icon-button--small" aria-label="Cancel indexing" title="Cancel" onClick={onCancel}>
          <CloseIcon />
        </button>
      </div>
      <div
        className={`progress${percent === null ? ' is-indeterminate' : ''}`}
        role="progressbar"
        aria-valuenow={percent ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: percent === null ? undefined : `${percent}%` }} />
      </div>
      <div className="indexing-stats mono">
        {readingDetails ? (
          <>
            <span>
              Reading details… {formatCount(progress.processed)} / {formatCount(progress.total)}
            </span>
            <span>{percent}%</span>
          </>
        ) : (
          <span>Finding files… {formatCount(progress.found)}</span>
        )}
      </div>
      <p className="indexing-path mono" title={progress.currentPath}>
        {progress.currentPath}
      </p>
    </section>
  )
}

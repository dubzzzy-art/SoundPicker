import { useEffect, useRef, type KeyboardEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { FileRow } from '@shared/api'
import { formatChannels, formatLength } from '../format'
import { highlight, matchedInLabel, splitSegments, type Segment } from '../highlight'
import { StarIcon, TagIcon } from '../icons'
import type { SortKey, SortOrder } from '../tree'

const ROW_HEIGHT = 30
const SEARCH_ROW_HEIGHT = 42
const KEPT_TAIL = 16

function MiddleTruncated({ text, marks }: { text: string; marks?: Record<string, number> }) {
  const segments = marks ? highlight(text, marks) : [{ text, marked: false }]
  if (text.length <= KEPT_TAIL * 2) return <span className="file-name">{renderSegments(segments)}</span>
  const [head, tail] = splitSegments(segments, text.length - KEPT_TAIL)
  return (
    <span className="file-name file-name--split">
      <span className="file-name-head">{renderSegments(head)}</span>
      <span className="file-name-tail">{renderSegments(tail)}</span>
    </span>
  )
}

function renderSegments(segments: Segment[]) {
  return segments.map((segment, i) => (segment.marked ? <mark key={i}>{segment.text}</mark> : segment.text))
}

export interface SearchView {
  relevance: Map<number, number>
  matchedIn: Map<number, number>
  highlights: Record<string, number>
  queryKey: string
  location(file: FileRow): string
}

export interface SelectModifiers {
  toggle: boolean
  range: boolean
}

interface FileListProps {
  files: FileRow[]
  sort: SortOrder
  selectedIds: Set<number>
  focusedId: number | null
  onSort(key: SortKey): void
  onSelect(file: FileRow, modifiers: SelectModifiers): void
  onDragOut(file: FileRow): void
  onContextMenu(file: FileRow): void
  onToggleFavorite(file: FileRow): void
  folderKeywords(folderId: number): string[]
  search?: SearchView
}

const COLUMNS: { key: SortKey | null; label: string; className?: string }[] = [
  { key: null, label: '' },
  { key: 'name', label: 'Name' },
  { key: null, label: 'Keywords' },
  { key: 'duration', label: 'Length', className: 'is-numeric' },
  { key: 'type', label: 'Type' },
  { key: 'channels', label: 'Ch' }
]

const SEARCH_COLUMNS: typeof COLUMNS = [
  { key: null, label: '' },
  { key: 'name', label: 'Name · location' },
  { key: null, label: 'Keywords' },
  { key: null, label: 'Matched in' },
  { key: 'relevance', label: 'Relevance' },
  { key: 'duration', label: 'Length', className: 'is-numeric' }
]

export function FileList(props: FileListProps) {
  const { files, sort, selectedIds, focusedId, onSort, onSelect, onDragOut, onContextMenu, onToggleFavorite, folderKeywords, search } = props
  const scroller = useRef<HTMLDivElement>(null)
  const rowHeight = search ? SEARCH_ROW_HEIGHT : ROW_HEIGHT
  const columns = search ? SEARCH_COLUMNS : COLUMNS
  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    overscan: 12
  })

  useEffect(() => virtualizer.measure(), [rowHeight, virtualizer])

  useEffect(() => {
    if (search) scroller.current?.scrollTo({ top: 0 })
  }, [search?.queryKey])

  const selectedIndex = focusedId === null ? -1 : files.findIndex((file) => file.id === focusedId)

  useEffect(() => {
    if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: 'auto' })
  }, [selectedIndex, virtualizer])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (files.length === 0) return
    const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 15, PageUp: -15 }[event.key]
    if (step === undefined) return
    event.preventDefault()
    const from = selectedIndex < 0 ? (step > 0 ? -1 : files.length) : selectedIndex
    onSelect(files[Math.min(files.length - 1, Math.max(0, from + step))], { toggle: false, range: event.shiftKey })
  }

  return (
    <div className="file-list" ref={scroller} tabIndex={0} role="grid" aria-rowcount={files.length + 1} onKeyDown={onKeyDown}>
      <div className={`file-grid file-head${search ? ' is-search' : ''}`} role="row">
        {columns.map((column, index) => {
          const active = column.key !== null && sort.key === column.key
          // Relevance goes best first, which is high to low.
          const descending = column.key === 'relevance' ? sort.direction === 1 : sort.direction === -1
          return (
            <span
              key={index}
              role="columnheader"
              className={column.className}
              aria-sort={active ? (descending ? 'descending' : 'ascending') : undefined}
            >
              {column.key ? (
                <button className={`sort-button${active ? ' is-active' : ''}`} onClick={() => onSort(column.key!)}>
                  {column.label}
                  {active && <span aria-hidden="true">{descending ? ' ↓' : ' ↑'}</span>}
                </button>
              ) : (
                column.label
              )}
            </span>
          )
        })}
      </div>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => {
          const file = files[item.index]
          const selected = selectedIds.has(file.id)
          return (
            <div
              key={file.id}
              role="row"
              aria-selected={selected}
              aria-rowindex={item.index + 2}
              className={`file-grid file-row${search ? ' is-search' : ''}${selected ? ' is-selected' : ''}${file.id === focusedId ? ' is-focused' : ''}${file.status === 'broken' ? ' is-broken' : ''}`}
              style={{ transform: `translateY(${item.start}px)`, height: rowHeight }}
              title={file.status === 'broken' ? 'This file could not be read' : file.relDir ? `${file.relDir}/${file.name}` : file.name}
              onClick={(event) => onSelect(file, { toggle: event.metaKey || event.ctrlKey, range: event.shiftKey })}
              onContextMenu={(event) => {
                event.preventDefault()
                onContextMenu(file)
              }}
              draggable
              onDragStart={(event) => {
                event.preventDefault()
                onDragOut(file)
              }}
            >
              <button
                className={`file-star${file.favorite ? ' is-on' : ''}`}
                aria-label={file.favorite ? 'Remove from favorites' : 'Add to favorites'}
                aria-pressed={file.favorite}
                title={file.favorite ? 'Remove from favorites' : 'Add to favorites'}
                tabIndex={-1}
                onClick={(event) => {
                  event.stopPropagation()
                  onToggleFavorite(file)
                }}
              >
                <StarIcon size={14} filled={file.favorite} />
              </button>
              {search ? (
                <SearchCells file={file} search={search} fromFolders={folderKeywords(file.folderId)} />
              ) : (
                <>
                  <MiddleTruncated text={file.name} />
                  <KeywordCell keywords={file.keywords} fromFolders={folderKeywords(file.folderId)} />
                  <span className="mono is-numeric">{formatLength(file.duration)}</span>
                  <span className="mono muted-cell">{file.ext.toUpperCase()}</span>
                  <span className="mono muted-cell">{file.status === 'broken' ? 'Unreadable' : formatChannels(file.channels)}</span>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function KeywordCell({ keywords, fromFolders, marks }: { keywords: string[]; fromFolders: string[]; marks?: Record<string, number> }) {
  const title = [keywords.join(', '), fromFolders.length > 0 ? `From folders: ${fromFolders.join(', ')}` : '']
    .filter(Boolean)
    .join('\n')
  // Counts, not names: a long list would not fit the column. The names are in the tooltip.
  const matched = marks !== undefined && keywords.some((name) => highlight(name, marks).some((segment) => segment.marked))
  return (
    <span className="file-keywords" title={title || undefined}>
      {keywords.length > 0 && (
        <span className={`file-keyword is-count${matched ? ' is-match' : ''}`} aria-label={`${keywords.length} file keywords`}>
          <TagIcon size={10} />
          {keywords.length}
        </span>
      )}
      {fromFolders.length > 0 && (
        <span className="file-keyword is-folder" aria-label={`${fromFolders.length} folder keywords`}>
          <TagIcon size={10} />
          {fromFolders.length}
        </span>
      )}
    </span>
  )
}

function SearchCells({ file, search, fromFolders }: { file: FileRow; search: SearchView; fromFolders: string[] }) {
  const relevance = search.relevance.get(file.id) ?? 0
  return (
    <>
      <span className="file-name-cell">
        <MiddleTruncated text={file.name} marks={search.highlights} />
        <span className="file-location mono">{renderSegments(highlight(search.location(file), search.highlights))}</span>
      </span>
      <KeywordCell keywords={file.keywords} fromFolders={fromFolders} marks={search.highlights} />
      <span className="muted-cell">{matchedInLabel(search.matchedIn.get(file.id) ?? 0)}</span>
      <span className="relevance">
        <span className="relevance-bar">
          <span className={relevance >= 75 ? 'is-strong' : undefined} style={{ width: `${relevance}%` }} />
        </span>
      </span>
      <span className="mono is-numeric">{formatLength(file.duration)}</span>
    </>
  )
}

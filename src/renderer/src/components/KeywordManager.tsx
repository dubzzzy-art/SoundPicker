import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { keywordUses, normalizeKeyword, type KeywordSummary } from '@shared/keywords'
import { formatCount } from '../format'
import { CloseIcon, MergeIcon, PencilIcon, SearchIcon, TrashIcon } from '../icons'
import { KeywordInput, usesLabel } from './KeywordInput'

const api = window.soundpicker

type Sort = 'used' | 'az'

type Edit =
  | { kind: 'rename' }
  | { kind: 'merge'; target: KeywordSummary | null }
  | { kind: 'taken'; target: KeywordSummary }
  | { kind: 'delete' }

interface KeywordManagerProps {
  catalog: KeywordSummary[]
  onClose(): void
  onShowFiles(keyword: KeywordSummary): void
  onChanged(): void
}

export function KeywordManager({ catalog, onClose, onShowFiles, onChanged }: KeywordManagerProps) {
  const [sort, setSort] = useState<Sort>('used')
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<{ id: number; edit: Edit } | null>(null)

  const most = useMemo(() => Math.max(1, ...catalog.map(keywordUses)), [catalog])
  const shown = useMemo(() => {
    const text = normalizeKeyword(filter)
    const list = text ? catalog.filter((keyword) => keyword.name.includes(text)) : [...catalog]
    return list.sort((a, b) =>
      sort === 'used' ? keywordUses(b) - keywordUses(a) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name)
    )
  }, [catalog, filter, sort])

  const run = async (work: Promise<unknown>) => {
    await work
    setEditing(null)
    onChanged()
  }

  const rename = async (keyword: KeywordSummary, name: string) => {
    if (normalizeKeyword(name) === keyword.name || !normalizeKeyword(name)) {
      setEditing(null)
      return
    }
    const result = await api.renameKeyword(keyword.id, name)
    if (result.ok) {
      setEditing(null)
      onChanged()
    } else if (result.reason === 'exists') {
      setEditing({ id: keyword.id, edit: { kind: 'taken', target: result.existing } })
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation()
    if (event.key !== 'Escape') return
    event.preventDefault()
    if (editing) setEditing(null)
    else onClose()
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog keyword-manager" role="dialog" aria-modal="true" aria-labelledby="keyword-manager-title" onKeyDown={onKeyDown}>
        <div className="dialog-head">
          <div className="dialog-title-row">
            <h2 id="keyword-manager-title" className="dialog-title">
              All keywords
            </h2>
            <span className="mono muted">{formatCount(catalog.length)}</span>
            <span className="statusbar-spacer" />
            <div className="segmented" role="group" aria-label="Sort">
              <button aria-pressed={sort === 'used'} onClick={() => setSort('used')}>
                Most used
              </button>
              <button aria-pressed={sort === 'az'} onClick={() => setSort('az')}>
                A–Z
              </button>
            </div>
            <button className="icon-button" aria-label="Close" title="Close" onClick={onClose}>
              <CloseIcon size={12} />
            </button>
          </div>
          <label className="dialog-filter">
            <SearchIcon size={14} />
            <span className="visually-hidden">Filter keywords</span>
            <input
              type="search"
              placeholder="Filter keywords"
              value={filter}
              autoFocus
              spellCheck={false}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
        </div>

        <div className="keyword-table" role="list">
          <div className="keyword-table-head" aria-hidden="true">
            <span>Keyword</span>
            <span className="is-numeric">Files</span>
            <span className="is-numeric">Folders</span>
            <span />
          </div>
          {shown.map((keyword) => {
            const edit = editing?.id === keyword.id ? editing.edit : null
            return (
              <div key={keyword.id} role="listitem" className={`keyword-item${edit ? ' is-editing' : ''}`}>
                <div className="keyword-table-row">
                  {edit?.kind === 'rename' ? (
                    <RenameField keyword={keyword} onDone={(name) => (name === null ? setEditing(null) : void rename(keyword, name))} />
                  ) : (
                    <button className="keyword-row-main" title="Show its files" onClick={() => onShowFiles(keyword)}>
                      <span className="keyword-row-name">{keyword.name}</span>
                      <span className="keyword-row-bar">
                        <span style={{ width: `${Math.round((keywordUses(keyword) / most) * 100)}%` }} />
                      </span>
                    </button>
                  )}
                  <span className="mono is-numeric">{formatCount(keyword.files)}</span>
                  <span className="mono is-numeric muted">{keyword.folders > 0 ? formatCount(keyword.folders) : '—'}</span>
                  <span className="keyword-row-actions">
                    <button className="icon-button" aria-label={`Rename ${keyword.name}`} title="Rename" onClick={() => setEditing({ id: keyword.id, edit: { kind: 'rename' } })}>
                      <PencilIcon size={14} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Merge ${keyword.name} into another keyword`}
                      title="Merge into"
                      disabled={catalog.length < 2}
                      onClick={() => setEditing({ id: keyword.id, edit: { kind: 'merge', target: null } })}
                    >
                      <MergeIcon size={14} />
                    </button>
                    <button className="icon-button is-danger" aria-label={`Delete ${keyword.name}`} title="Delete" onClick={() => setEditing({ id: keyword.id, edit: { kind: 'delete' } })}>
                      <TrashIcon size={14} />
                    </button>
                  </span>
                </div>

                {edit?.kind === 'merge' && !edit.target && (
                  <div className="keyword-row-panel">
                    <KeywordInput
                      catalog={catalog}
                      exclude={new Set([keyword.name])}
                      allowCreate={false}
                      label={`Merge “${keyword.name}” into`}
                      placeholder="Type a keyword"
                      autoFocus
                      onPick={(name) => {
                        const target = catalog.find((candidate) => candidate.name === name)
                        if (target) setEditing({ id: keyword.id, edit: { kind: 'merge', target } })
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  </div>
                )}
                {(edit?.kind === 'merge' || edit?.kind === 'taken') && edit.target && (
                  <Confirm
                    text={
                      <>
                        {edit.kind === 'taken' && <>“{edit.target.name}” already exists. </>}
                        Merge “{keyword.name}” ({usesLabel(keyword)}) into “{edit.target.name}”? Everything tagged “{keyword.name}” gets “
                        {edit.target.name}” instead.
                      </>
                    }
                    action="Merge"
                    onConfirm={() => void run(api.mergeKeyword(keyword.id, edit.target!.id))}
                    onCancel={() => setEditing(null)}
                  />
                )}
                {edit?.kind === 'delete' && (
                  <Confirm
                    text={
                      <>
                        Delete “{keyword.name}” from {formatCount(keyword.files)} {keyword.files === 1 ? 'file' : 'files'}
                        {keyword.folders > 0 && ` and ${formatCount(keyword.folders)} ${keyword.folders === 1 ? 'folder' : 'folders'}`}? This
                        cannot be undone.
                      </>
                    }
                    action="Delete"
                    danger
                    onConfirm={() => void run(api.deleteKeyword(keyword.id))}
                    onCancel={() => setEditing(null)}
                  />
                )}
              </div>
            )
          })}
          {shown.length === 0 && <p className="keyword-table-empty">{catalog.length === 0 ? 'No keywords yet.' : `No keyword contains “${filter.trim()}”.`}</p>}
        </div>

      </div>
    </div>
  )
}

function RenameField({ keyword, onDone }: { keyword: KeywordSummary; onDone(name: string | null): void }) {
  const [value, setValue] = useState(keyword.name)
  // Enter and the blur after it finish once.
  const done = useRef(false)
  const finish = (name: string | null) => {
    if (done.current) return
    done.current = true
    onDone(name)
  }
  return (
    <input
      className="keyword-rename"
      aria-label={`New name for ${keyword.name}`}
      value={value}
      autoFocus
      spellCheck={false}
      onFocus={(event) => event.target.select()}
      onChange={(event) => setValue(event.target.value.replace(/,/g, ''))}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(value)
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          finish(null)
        }
      }}
      onBlur={() => finish(value)}
    />
  )
}

interface ConfirmProps {
  text: React.ReactNode
  action: string
  danger?: boolean
  onConfirm(): void
  onCancel(): void
}

function Confirm({ text, action, danger, onConfirm, onCancel }: ConfirmProps) {
  return (
    <div className="keyword-row-panel keyword-confirm" role="alertdialog" aria-label={`${action} keyword`}>
      <p>{text}</p>
      <div className="keyword-confirm-actions">
        <button className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
        <button className={danger ? 'danger-button' : 'primary-button'} autoFocus onClick={onConfirm}>
          {action}
        </button>
      </div>
    </div>
  )
}

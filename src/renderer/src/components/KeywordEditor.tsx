import { useMemo } from 'react'
import type { FileRow } from '@shared/api'
import type { KeywordSummary } from '@shared/keywords'
import { CloseIcon } from '../icons'
import { KeywordInput } from './KeywordInput'

interface KeywordEditorProps {
  files: FileRow[]
  catalog: KeywordSummary[]
  onAdd(fileIds: number[], name: string): void
  onRemove(fileIds: number[], name: string): void
}

export function KeywordEditor({ files, catalog, onAdd, onRemove }: KeywordEditorProps) {
  const ids = useMemo(() => files.map((file) => file.id), [files])
  const chips = useMemo(() => {
    const counts = new Map<string, number>()
    for (const file of files) for (const name of file.keywords) counts.set(name, (counts.get(name) ?? 0) + 1)
    return [...counts].map(([name, count]) => ({ name, count }))
  }, [files])
  const onAll = useMemo(() => new Set(chips.filter((chip) => chip.count === files.length).map((chip) => chip.name)), [chips, files.length])
  const many = files.length > 1

  return (
    <div className="keyword-editor">
      <KeywordInput
        key={ids.join(',')}
        catalog={catalog}
        exclude={onAll}
        allowCreate
        hideLabel
        label={many ? `Add to ${files.length} files` : 'Add keyword'}
        placeholder="Start typing…"
        onPick={(name) => onAdd(ids, name)}
      />
      {chips.length > 0 && (
        <div className="keyword-chips">
          {chips.map(({ name, count }) => {
            const partial = count < files.length
            return (
              <span key={name} className={`keyword-chip${partial ? ' is-partial' : ''}`}>
                {partial ? (
                  <button
                    className="keyword-chip-name"
                    title={`On ${count} of ${files.length} files — click to add to all`}
                    onClick={() => onAdd(ids, name)}
                  >
                    {name}
                    <span className="keyword-chip-note mono">
                      {count}/{files.length}
                    </span>
                  </button>
                ) : (
                  <span className="keyword-chip-name">{name}</span>
                )}
                <button
                  className="keyword-chip-remove"
                  aria-label={`Remove keyword ${name}`}
                  title={many ? `Remove from ${count} files` : 'Remove keyword'}
                  onClick={() => onRemove(ids, name)}
                >
                  <CloseIcon />
                </button>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

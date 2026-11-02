import { useMemo, useState, type KeyboardEvent } from 'react'
import { normalizeKeyword, suggestKeywords, type KeywordSummary } from '@shared/keywords'
import { formatCount } from '../format'
import { PlusIcon, TagIcon } from '../icons'

interface KeywordInputProps {
  catalog: KeywordSummary[]
  exclude: ReadonlySet<string>
  allowCreate: boolean
  label: string
  hideLabel?: boolean
  placeholder: string
  autoFocus?: boolean
  onPick(name: string): void
  onCancel?(): void
}

export function KeywordInput({ catalog, exclude, allowCreate, label, hideLabel, placeholder, autoFocus, onPick, onCancel }: KeywordInputProps) {
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [focused, setFocused] = useState(false)

  const typed = normalizeKeyword(text)
  const suggestions = useMemo(() => suggestKeywords(catalog, typed, exclude), [catalog, typed, exclude])
  const known = typed !== '' && catalog.some((keyword) => keyword.name === typed)
  const already = exclude.has(typed)
  const options: string[] = [
    ...suggestions.map((suggestion) => suggestion.keyword.name),
    ...(allowCreate && typed && !known && !already ? [typed] : [])
  ]
  const open = focused && !dismissed && typed !== '' && (options.length > 0 || already)
  const current = Math.min(active, options.length - 1)

  const reset = () => {
    setText('')
    setActive(0)
    setDismissed(false)
  }

  const pick = (name: string) => {
    onPick(name)
    reset()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (options.length === 0) return
      setDismissed(false)
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((current + step + options.length) % options.length)
    } else if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      if (current >= 0 && typed) pick(options[current])
    } else if (event.key === 'Escape') {
      if (!open && !text && !onCancel) return
      event.preventDefault()
      event.stopPropagation()
      if (open) setDismissed(true)
      else if (text) reset()
      else onCancel?.()
    }
  }

  const onChange = (value: string) => {
    const parts = value.split(',')
    const last = parts.pop() ?? ''
    if (allowCreate) {
      for (const part of parts) if (normalizeKeyword(part)) onPick(normalizeKeyword(part))
    }
    setText(parts.length > 0 && allowCreate ? last.trimStart() : value.replace(/,/g, ''))
    setActive(0)
    setDismissed(false)
  }

  return (
    <div className="keyword-input">
      <label className="keyword-input-field">
        <span className={hideLabel ? 'visually-hidden' : 'keyword-input-label'}>{label}</span>
        <input
          type="text"
          value={text}
          placeholder={placeholder}
          autoFocus={autoFocus}
          spellCheck={false}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </label>
      {open && (
        <div className="keyword-suggestions" role="listbox" aria-label="Keyword suggestions">
          {suggestions.map(({ keyword, match }, index) => (
            <button
              key={keyword.id}
              role="option"
              aria-selected={index === current}
              className={`keyword-option${index === current ? ' is-active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(keyword.name)}
            >
              <TagIcon size={14} />
              <span className="keyword-option-name">
                {match ? (
                  <>
                    {keyword.name.slice(0, match[0])}
                    <mark>{keyword.name.slice(match[0], match[1])}</mark>
                    {keyword.name.slice(match[1])}
                  </>
                ) : (
                  keyword.name
                )}
              </span>
              <span className="keyword-option-count mono">{usesLabel(keyword)}</span>
            </button>
          ))}
          {options.length > suggestions.length && (
            <>
              {suggestions.length > 0 && <div className="keyword-suggestions-sep" />}
              <button
                role="option"
                aria-selected={current === suggestions.length}
                className={`keyword-option keyword-create${current === suggestions.length ? ' is-active' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(suggestions.length)}
                onClick={() => pick(typed)}
              >
                <PlusIcon size={14} />
                <span className="keyword-option-name">Create “{typed}”</span>
              </button>
            </>
          )}
          {options.length === 0 && already && <p className="keyword-suggestions-note">“{typed}” is already added</p>}
        </div>
      )}
    </div>
  )
}

export function usesLabel(keyword: KeywordSummary): string {
  if (keyword.files === 0) return `${formatCount(keyword.folders)} ${keyword.folders === 1 ? 'folder' : 'folders'}`
  return `${formatCount(keyword.files)} ${keyword.files === 1 ? 'file' : 'files'}`
}

import { allowedTypos, typoDistance } from './distance'

export interface KeywordSummary {
  id: number
  name: string
  files: number
  folders: number
}

export function normalizeKeyword(text: string): string {
  return text.toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ').trim()
}

export function keywordUses(keyword: KeywordSummary): number {
  return keyword.files + keyword.folders
}

export interface KeywordSuggestion {
  keyword: KeywordSummary
  // null: a match with a typo.
  match: [number, number] | null
}

export function suggestKeywords(
  catalog: KeywordSummary[],
  typed: string,
  exclude: ReadonlySet<string>,
  limit = 6
): KeywordSuggestion[] {
  const text = normalizeKeyword(typed)
  if (!text) return []
  const typos = allowedTypos(text)
  const ranked: { group: number; suggestion: KeywordSuggestion }[] = []
  for (const keyword of catalog) {
    if (exclude.has(keyword.name)) continue
    const at = keyword.name.indexOf(text)
    if (at === 0) {
      ranked.push({ group: keyword.name === text ? 0 : 1, suggestion: { keyword, match: [0, text.length] } })
    } else if (at > 0) {
      ranked.push({ group: 2, suggestion: { keyword, match: [at, at + text.length] } })
    } else if (typos > 0 && closeTo(text, keyword.name, typos)) {
      ranked.push({ group: 3, suggestion: { keyword, match: null } })
    }
  }
  ranked.sort(
    (a, b) =>
      a.group - b.group ||
      keywordUses(b.suggestion.keyword) - keywordUses(a.suggestion.keyword) ||
      a.suggestion.keyword.name.localeCompare(b.suggestion.keyword.name)
  )
  return ranked.slice(0, limit).map((entry) => entry.suggestion)
}

function closeTo(text: string, name: string, typos: number): boolean {
  if (typoDistance(text, name, typos) <= typos) return true
  for (let length = text.length - 1; length <= text.length + 1; length++) {
    if (length < name.length && typoDistance(text, name.slice(0, length), typos) <= typos) return true
  }
  return false
}

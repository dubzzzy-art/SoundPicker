import { MatchedIn } from '../../shared/api'
import { normalizeWord, splitWords, type Word } from '../../shared/words'

export interface Segment {
  text: string
  marked: boolean
}

export function highlight(text: string, marks: Record<string, number>): Segment[] {
  const segments: Segment[] = []
  let at = 0
  for (const word of splitWords(text)) {
    const mark = marks[word.word]
    if (mark === undefined) continue
    const [start, end] = mark === 0 ? [word.start, word.end] : markedPrefix(text, word, mark)
    if (start > at) segments.push({ text: text.slice(at, start), marked: false })
    segments.push({ text: text.slice(start, end), marked: true })
    at = end
  }
  if (at < text.length) segments.push({ text: text.slice(at), marked: false })
  return segments
}

// `mark` counts normalized characters: "012" is "12", and İ grows when lowercased.
function markedPrefix(text: string, word: Word, mark: number): [number, number] {
  const raw = text.slice(word.start, word.end)
  const start = word.start + (/^\p{Nd}+$/u.test(raw) ? raw.length - word.word.length : 0)
  for (let end = start + 1; end < word.end; end++) {
    if (normalizeWord(text.slice(start, end)).length >= mark) return [start, end]
  }
  return [start, word.end]
}

export function splitSegments(segments: Segment[], position: number): [Segment[], Segment[]] {
  const head: Segment[] = []
  const tail: Segment[] = []
  let at = 0
  for (const segment of segments) {
    const end = at + segment.text.length
    if (end <= position) head.push(segment)
    else if (at >= position) tail.push(segment)
    else {
      head.push({ text: segment.text.slice(0, position - at), marked: segment.marked })
      tail.push({ text: segment.text.slice(position - at), marked: segment.marked })
    }
    at = end
  }
  return [head, tail]
}

const MATCH_LABELS: [number, string][] = [
  [MatchedIn.name, 'name'],
  [MatchedIn.keywords, 'keywords'],
  [MatchedIn.folderKeywords, 'folder keywords'],
  [MatchedIn.path, 'path'],
  [MatchedIn.channels, 'channels']
]

export function matchedInLabel(bits: number): string {
  const label = MATCH_LABELS.filter(([bit]) => bits & bit)
    .map(([, name]) => name)
    .join(' + ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

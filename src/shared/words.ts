export interface Word {
  // Numbers lose leading zeros, so "1" finds "01".
  word: string
  start: number
  end: number
}

// A caps run before a capitalised word (VAR in VARName), a word, an all-caps word, or a number.
const WORD = /\p{Lu}+(?=\p{Lu}[\p{Ll}\p{M}])|\p{Lu}?[\p{Ll}\p{Lo}\p{Lm}\p{M}]+|\p{Lu}[\p{Lu}\p{M}]*|\p{Nd}+/gu

export function splitWords(text: string): Word[] {
  const words: Word[] = []
  for (const match of text.matchAll(WORD)) {
    words.push({ word: normalizeWord(match[0]), start: match.index, end: match.index + match[0].length })
  }
  return words
}

export function normalizeWord(word: string): string {
  if (/^\p{Nd}+$/u.test(word)) return word.replace(/^0+(?=\d)/, '')
  return word.toLocaleLowerCase()
}

export function stem(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

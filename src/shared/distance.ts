// Damerau–Levenshtein (optimal string alignment); returns max + 1 once past `max`.
export function typoDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  if (a === b) return 0
  const width = b.length + 1
  let before = new Array<number>(width).fill(0)
  let previous = Array.from({ length: width }, (_, j) => j)
  let current = new Array<number>(width).fill(0)
  for (let i = 1; i <= a.length; i++) {
    current[0] = i
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
      if (i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) {
        value = Math.min(value, before[j - 2] + 1)
      }
      current[j] = value
      if (value < rowMin) rowMin = value
    }
    if (rowMin > max) return max + 1
    ;[before, previous, current] = [previous, current, before]
  }
  return Math.min(previous[b.length], max + 1)
}

export function allowedTypos(word: string): number {
  if (word.length <= 3) return 0
  return word.length <= 7 ? 1 : 2
}

export function missesOneLetter(word: string, token: string): boolean {
  return word.length === 3 && token.length === 4 && typoDistance(word, token, 1) === 1
}

import { describe, expect, it } from 'vitest'
import { highlight } from '../src/renderer/src/highlight'

const marked = (text: string, marks: Record<string, number>) =>
  highlight(text, marks)
    .filter((segment) => segment.marked)
    .map((segment) => segment.text)

describe('highlight', () => {
  it('marks whole words and typed starts', () => {
    expect(marked('Wood_Floor_01', { wood: 0, floor: 3 })).toEqual(['Wood', 'Flo'])
  })

  it('skips the leading zeros of a number', () => {
    expect(marked('Hit_012.wav', { '12': 1 })).toEqual(['1'])
    expect(marked('Hit_012.wav', { '12': 0 })).toEqual(['012'])
  })

  it('counts letters that grow when lowercased once', () => {
    expect(marked('İstanbul_Rain', { [`${'İstanbul'.toLocaleLowerCase()}`]: 3 })).toEqual(['İs'])
  })
})

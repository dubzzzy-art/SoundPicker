import { describe, expect, it } from 'vitest'
import { splitWords, stem } from '../src/shared/words'

const words = (text: string) => splitWords(text).map((w) => w.word)

describe('splitWords', () => {
  it('splits on separators, CamelCase and digit boundaries', () => {
    expect(words(stem('MeleeSoldier_Melee_Generic_Grab_VAR_01_Wave.mp3'))).toEqual([
      'melee', 'soldier', 'melee', 'generic', 'grab', 'var', '1', 'wave'
    ])
    expect(words('Footstep-Wood.Creaky floor03')).toEqual(['footstep', 'wood', 'creaky', 'floor', '3'])
    expect(words('VARName iPhone OK')).toEqual(['var', 'name', 'i', 'phone', 'ok'])
    expect(words('Wave 0 2 0')).toEqual(['wave', '0', '2', '0'])
  })

  it('handles Cyrillic and keeps positions', () => {
    expect(words('Шаги_ПоСнегу')).toEqual(['шаги', 'по', 'снегу'])
    const [first, second] = splitWords('Door_Wood')
    expect([first.start, first.end, second.start, second.end]).toEqual([0, 4, 5, 9])
  })
})

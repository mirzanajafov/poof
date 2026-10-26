import { describe, expect, it } from 'vitest'
import { kneeOf } from '../src/knee.ts'

describe('kneeOf', () => {
  it('stops at the last worker count that still gained five percent', () => {
    const rows = [
      { k: 1, effectiveCores: 0.95 },
      { k: 2, effectiveCores: 1.4 },
      { k: 3, effectiveCores: 1.42 },
      { k: 4, effectiveCores: 1.43 },
    ]
    expect(kneeOf(rows)).toBe(2)
  })

  it('takes the last measured worker count when every step still gains', () => {
    const rows = [
      { k: 8, effectiveCores: 2 },
      { k: 12, effectiveCores: 2.6 },
      { k: 20, effectiveCores: 3.1 },
      { k: 35, effectiveCores: 3.5 },
    ]
    expect(kneeOf(rows)).toBe(35)
  })
})

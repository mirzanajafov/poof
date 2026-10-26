import { describe, expect, it } from 'vitest'
import { valueAt, valueFor } from '../src/lookup.ts'

describe('valueAt', () => {
  it('refuses an index past the end', () => {
    expect(valueAt([1, 2], 1)).toBe(2)
    expect(() => valueAt([1, 2], 2)).toThrow(RangeError)
  })
})

describe('valueFor', () => {
  it('refuses a key the map does not hold', () => {
    const values = new Map([['a', 1]])
    expect(valueFor(values, 'a')).toBe(1)
    expect(() => valueFor(values, 'b')).toThrow(RangeError)
  })
})

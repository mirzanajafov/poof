import { describe, expect, it } from 'vitest'
import { valueAt } from '../src/arrays.ts'

describe('valueAt', () => {
  it('refuses an index past the end', () => {
    expect(valueAt([1, 2], 1)).toBe(2)
    expect(() => valueAt([1, 2], 2)).toThrow(RangeError)
  })
})

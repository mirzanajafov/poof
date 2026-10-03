import { describe, expect, it } from 'vitest'
import { itemTimeoutMs } from '../src/timeout.ts'

const none = () => 0

describe('itemTimeoutMs', () => {
  it('never goes below the floor', () => {
    expect(itemTimeoutMs([100, 200], 0, 2, 1, none)).toBe(5000)
  })

  it('covers the heaviest predicted image left in the range', () => {
    expect(itemTimeoutMs([600, 900, 700], 0, 3, 1, none)).toBe(9000)
    expect(itemTimeoutMs([600, 900, 700], 2, 3, 1, none)).toBe(7000)
    expect(itemTimeoutMs([600, 900, 700], 2, 3, 1.5, none)).toBe(10_500)
  })

  it('doubles the limit for every attempt an image already used up', () => {
    const attempts = new Map([[1, 2]])
    expect(itemTimeoutMs([600, 600, 600], 0, 3, 1, (i) => attempts.get(i) ?? 0)).toBe(24_000)
    expect(itemTimeoutMs([600, 600, 600], 0, 3, 1, (i) => attempts.get(i) ?? 0, { floorMs: 5000, multiple: 10, growth: 1 })).toBe(6000)
  })
})

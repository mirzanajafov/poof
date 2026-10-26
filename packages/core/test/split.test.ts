import { describe, expect, it } from 'vitest'
import { chooseK, finishMs, planSplit } from '../src/split.ts'

describe('finishMs', () => {
  it('is the serial time when nobody helps', () => {
    expect(finishMs(100, 50, 200, 0)).toBe(5000)
  })

  it('charges the spawn latency to the children only', () => {
    expect(finishMs(100, 50, 200, 1)).toBe((5000 + 200) / 2)
  })
})

describe('chooseK', () => {
  it('picks the smallest k that fits the time left with margin', () => {
    expect(chooseK(100, 50, 200, 3000, 4, 0.1)).toBe(1)
    expect(chooseK(100, 50, 200, 2000, 4, 0.1)).toBe(2)
  })

  it('falls back to the full fan-out when nothing fits', () => {
    expect(chooseK(100, 50, 200, 100, 4, 0.1)).toBe(4)
    expect(chooseK(100, 50, 200, -500, 4, 0.1)).toBe(4)
  })
})

describe('planSplit', () => {
  it('gives the parent extra items to cover the spawn latency', () => {
    expect(planSplit(0, 100, 1, 50, 1000)).toEqual({ cut: 60, children: [{ lo: 60, hi: 100 }] })
  })

  it('covers the remaining range exactly, without overlap', () => {
    const plan = planSplit(17, 1000, 3, 40, 300)
    if (!plan) throw new Error('planSplit planned no split')
    const ranges = [{ lo: 17, hi: plan.cut }, ...plan.children]
    expect(ranges.slice(1).map((r) => r.lo)).toEqual(ranges.slice(0, -1).map((r) => r.hi))
    expect(ranges.at(-1)?.hi).toBe(1000)
    for (const range of ranges) expect(range.hi).toBeGreaterThan(range.lo)
  })

  it('never hands out more children than items', () => {
    const plan = planSplit(10, 13, 4, 50, 0)
    expect(plan?.children.length).toBe(2)
    expect(plan?.cut).toBe(11)
  })

  it('refuses a range with a single item left', () => {
    expect(planSplit(5, 6, 4, 50, 0)).toBeNull()
  })
})

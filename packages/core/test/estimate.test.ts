import { describe, expect, it } from 'vitest'
import { emptyEstimate, emptyWorkRatio, priorWorkRatio, updateEstimate, updateWorkRatio, workRatio } from '../src/estimate.ts'
import { Rng } from '../src/rng.ts'

describe('workRatio', () => {
  it('falls back until it has seen a few items', () => {
    let ratio = emptyWorkRatio
    for (let i = 0; i < 4; i++) ratio = updateWorkRatio(ratio, 300, 200)
    expect(workRatio(ratio)).toBe(1)
    ratio = updateWorkRatio(ratio, 300, 200)
    expect(workRatio(ratio)).toBeCloseTo(1.5)
  })

  it('starts from a prior that one odd image cannot swing and that fades as images come in', () => {
    let ratio = priorWorkRatio(1.2, 6000)
    expect(workRatio(ratio)).toBeCloseTo(1.2)
    ratio = updateWorkRatio(ratio, 1200, 400)
    expect(workRatio(ratio)).toBeLessThan(1.5)
    for (let i = 0; i < 1000; i++) ratio = updateWorkRatio(ratio, 300, 300)
    expect(workRatio(ratio)).toBeCloseTo(1, 2)
  })

  it('weighs images by their predicted work, not one vote each', () => {
    let ratio = emptyWorkRatio
    for (let i = 0; i < 9; i++) ratio = updateWorkRatio(ratio, 100, 100)
    ratio = updateWorkRatio(ratio, 2000, 1000)
    expect(workRatio(ratio)).toBeCloseTo(2900 / 1900, 1)
    expect(workRatio(ratio)).toBeGreaterThan(1.4)
  })

  it('wanders far less than a per-image moving average on noisy images', () => {
    const rng = new Rng(3)
    let work = emptyWorkRatio
    let moving = emptyEstimate
    const workSeen: number[] = []
    const movingSeen: number[] = []
    for (let i = 0; i < 5000; i++) {
      const predicted = rng.logUniform(80, 600)
      const actual = predicted * 1.2 * Math.exp(0.4 * rng.normal() - 0.08)
      work = updateWorkRatio(work, actual, predicted)
      moving = updateEstimate(moving, actual / predicted, 0.05)
      if (i >= 500) {
        workSeen.push(workRatio(work))
        movingSeen.push(moving.mean)
      }
    }
    const spread = (xs: number[]) => {
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length
      return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length) / mean
    }
    expect(spread(workSeen)).toBeLessThan(spread(movingSeen) / 2)
  })
})

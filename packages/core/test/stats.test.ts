import { describe, expect, it } from 'vitest'
import { bootstrap, linearFit, powerFit, quantile } from '../src/stats.ts'

describe('quantile', () => {
  it('interpolates between the two nearest values', () => {
    expect(quantile([40, 10, 30, 20], 0.5)).toBe(25)
    expect(quantile([10, 20, 30, 40], 0.25)).toBeCloseTo(17.5)
  })

  it('has no quantile for no values', () => {
    expect(quantile([], 0.5)).toBeNaN()
  })
})

describe('linearFit', () => {
  it('recovers a straight line', () => {
    const fit = linearFit([1, 2, 3, 4], [5, 7, 9, 11])
    expect(fit.slope).toBeCloseTo(2)
    expect(fit.intercept).toBeCloseTo(3)
    expect(fit.r2).toBeCloseTo(1)
  })

  it('leaves a point with no log residual out of the residual spread', () => {
    expect(linearFit([1, 2, 3, 4], [0, 2, 3, 4]).logResidualSd).toBe(0.13940253459755558)
  })

  it('refuses points whose coordinates do not pair up', () => {
    expect(() => linearFit([1, 2, 3], [1, 2])).toThrow(RangeError)
  })
})

describe('powerFit', () => {
  it('recovers the coefficient and exponent of a power law', () => {
    const xs = [1, 2, 4, 8]
    const fit = powerFit(
      xs,
      xs.map((x) => 3 * x ** 1.5),
    )
    expect(fit.coef).toBeCloseTo(3)
    expect(fit.exponent).toBeCloseTo(1.5)
  })
})

describe('bootstrap', () => {
  const values = [12, 15, 9, 20, 14, 11, 18, 16]

  it('draws the interval the simulator results were reported with', () => {
    expect(bootstrap(values)).toEqual({ mean: 14.375, lo: 12, hi: 16.75 })
  })

  it('draws the same interval from the same seed', () => {
    expect(bootstrap(values, 7)).toEqual(bootstrap(values, 7))
    expect(bootstrap(values, 7)).not.toEqual(bootstrap(values, 8))
  })
})

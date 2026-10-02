import { describe, expect, it } from 'vitest'
import { Breaker } from '../src/breaker.ts'
import { emptyEstimate, updateEstimate, upperMean } from '../src/estimate.ts'

describe('Breaker', () => {
  it('stays closed through isolated failures', () => {
    const breaker = new Breaker()
    for (let i = 0; i < 100; i++) breaker.record(i % 10 !== 0, i)
    expect(breaker.state(100)).toBe('closed')
  })

  it('opens when most recent outcomes fail, after enough samples', () => {
    const breaker = new Breaker()
    for (let i = 0; i < 9; i++) breaker.record(false, i)
    expect(breaker.state(9)).toBe('closed')
    breaker.record(false, 10)
    expect(breaker.state(10)).toBe('open')
    expect(breaker.allows(11)).toBe(false)
  })

  it('lets exactly one probe through when half-open', () => {
    const breaker = new Breaker()
    for (let i = 0; i < 10; i++) breaker.record(false, 0)
    expect(breaker.state(30_000)).toBe('half-open')
    expect(breaker.allows(30_000)).toBe(true)
    expect(breaker.allows(30_001)).toBe(false)
  })

  it('closes on a good probe and reopens on a bad one', () => {
    const good = new Breaker()
    for (let i = 0; i < 10; i++) good.record(false, 0)
    good.allows(30_000)
    good.record(true, 30_100)
    expect(good.state(30_100)).toBe('closed')

    const bad = new Breaker()
    for (let i = 0; i < 10; i++) bad.record(false, 0)
    bad.allows(30_000)
    bad.record(false, 30_100)
    expect(bad.state(30_200)).toBe('open')
    expect(bad.state(60_100)).toBe('half-open')
    expect(bad.opened).toBe(2)
  })
})

describe('estimate', () => {
  it('starts at the first sample and moves toward new ones', () => {
    let e = updateEstimate(emptyEstimate, 100)
    expect(e.mean).toBe(100)
    e = updateEstimate(e, 200)
    expect(e.mean).toBeCloseTo(120)
    expect(e.variance).toBeGreaterThan(0)
  })

  it('upper mean adds z standard errors', () => {
    let e = emptyEstimate
    for (const sample of [80, 120, 80, 120, 80, 120, 80, 120, 80, 120]) e = updateEstimate(e, sample)
    expect(upperMean(e, 0)).toBe(e.mean)
    expect(upperMean(e, 2)).toBeGreaterThan(e.mean)
  })
})

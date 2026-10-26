import { describe, expect, it } from 'vitest'
import { Breaker, Breakers } from '../src/breaker.ts'

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

describe('Breakers', () => {
  it('keeps one breaker per type and reports the state of each', () => {
    const breakers = new Breakers<string>()
    for (let i = 0; i < 10; i++) breakers.record('thumb-320', false, 0)
    breakers.record('webp-1600', true, 0)
    expect(breakers.allows('thumb-320', 1)).toBe(false)
    expect(breakers.allows('webp-1600', 1)).toBe(true)
    expect(breakers.opened('thumb-320')).toBe(1)
    expect(breakers.states(1)).toEqual(
      new Map([
        ['thumb-320', 'open'],
        ['webp-1600', 'closed'],
      ]),
    )
  })

  it('stays closed and keeps nothing for a policy without breakers', () => {
    const breakers = new Breakers<string>(false)
    for (let i = 0; i < 10; i++) breakers.record('thumb-320', false, 0)
    expect(breakers.state('thumb-320', 1)).toBe('closed')
    expect(breakers.allows('thumb-320', 1)).toBe(true)
    expect(breakers.states(1)).toEqual(new Map())
  })
})

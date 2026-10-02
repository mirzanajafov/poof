import { describe, expect, it } from 'vitest'
import { decide, pain } from '../src/decide.ts'
import { policies, variant } from '../src/policies.ts'
import type { LeaseInfo, TaskInfo, View } from '../src/types.ts'

const task: TaskInfo = { id: 't1', type: 'webp-1600', items: 1000, submittedAt: 0, deadline: 60_000 }

function lease(overrides: Partial<LeaseInfo> = {}): LeaseInfo {
  return {
    id: 'l1',
    taskId: 't1',
    parentId: null,
    depth: 0,
    lo: 0,
    hi: 1000,
    next: 100,
    state: 'running',
    startedAt: 0,
    lastSplitAt: null,
    itemsDone: 100,
    itemMs: { mean: 100, variance: 0, count: 100 },
    ...overrides,
  }
}

function view(leases: LeaseInfo[], now: number, overrides: Partial<View> = {}): View {
  return {
    now,
    tasks: new Map([[task.id, task]]),
    leases,
    breakers: new Map(),
    spawnMs: 200,
    killSwitch: false,
    ...overrides,
  }
}

describe('pain', () => {
  it('forecast projects the finish from the measured rate', () => {
    const result = pain(policies.forecast, task, lease(), 10_000)
    expect(result.remainingMs).toBe(90_000)
    expect(result.pain).toBeCloseTo(100_000 / 60_000)
  })

  it('timer only sees elapsed time', () => {
    expect(pain(policies.box, task, lease(), 10_000).pain).toBeCloseTo(10_000 / 60_000)
  })

  it('oracle uses the true remaining time when it has one', () => {
    const result = pain(policies.perfect, task, lease({ trueRemainingMs: 30_000 }), 10_000)
    expect(result.pain).toBeCloseTo(40_000 / 60_000)
  })
})

describe('decide', () => {
  it('forecast splits a lease that will miss long before the timer notices', () => {
    const now = 10_000
    expect(decide(view([lease()], now), policies.forecast)).toHaveLength(1)
    expect(decide(view([lease()], now), policies.box)).toHaveLength(0)
  })

  it('timer fires once the threshold is crossed', () => {
    const late = variant(policies.box, { threshold: 0.5 })
    expect(decide(view([lease()], 31_000), late)).toHaveLength(1)
  })

  it('sizes the split to fit the time left', () => {
    const [request] = decide(view([lease()], 10_000), policies.forecast)
    expect(request!.k).toBe(2)
    expect(request!.remaining).toBe(900)
  })

  it('respects warm-up, cooldown, depth, breakers and the kill switch', () => {
    const now = 10_000
    const config = policies.forecastManaged
    expect(decide(view([lease({ itemsDone: 3 })], now), config)).toHaveLength(0)
    expect(decide(view([lease({ startedAt: 9_000 })], now), config)).toHaveLength(0)
    expect(decide(view([lease({ lastSplitAt: 8_000 })], now), config)).toHaveLength(0)
    expect(decide(view([lease({ depth: 3 })], now), config)).toHaveLength(0)
    expect(decide(view([lease()], now, { breakers: new Map([['webp-1600', 'open']]) }), config)).toHaveLength(0)
    expect(decide(view([lease()], now, { killSwitch: true }), config)).toHaveLength(0)
    expect(decide(view([lease({ state: 'starting' })], now), config)).toHaveLength(0)
  })

  it('does not split when the spawn costs more than it saves', () => {
    const short = lease({ next: 997, itemMs: { mean: 50, variance: 0, count: 100 } })
    expect(decide(view([short], 59_900, { spawnMs: 5_000 }), policies.forecast)).toHaveLength(0)
  })

  it('the never policy does not split at all', () => {
    expect(decide(view([lease()], 50_000), policies.never)).toHaveLength(0)
  })
})

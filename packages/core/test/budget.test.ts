import { describe, expect, it } from 'vitest'
import { allocate } from '../src/budget.ts'
import type { SplitRequest } from '../src/types.ts'

function split(leaseId: string, deadline: number, k: number, timeLeftMs = 10_000): SplitRequest {
  return { leaseId, taskId: leaseId, deadline, k, remaining: 100, pain: 1.2, projectedMs: 0, timeLeftMs, itemMs: 50, opportunistic: false }
}

describe('allocate', () => {
  it('hands out tokens earliest deadline first', () => {
    const grants = allocate(3, [{ leaseId: 'root', deadline: 9_000 }], [split('a', 5_000, 2), split('b', 20_000, 2)], 0, 200, 4)
    expect(grants.splits.get('a')).toBe(2)
    expect(grants.starts).toEqual(['root'])
    expect(grants.splits.has('b')).toBe(false)
  })

  it('gives a split fewer children when tokens run short', () => {
    const grants = allocate(1, [], [split('a', 5_000, 3)], 0, 200, 4)
    expect(grants.splits.get('a')).toBe(1)
  })

  it('puts lost causes behind work that can still make it', () => {
    const lost = split('lost', 1_000, 2, -500)
    const grants = allocate(2, [{ leaseId: 'root', deadline: 30_000 }], [lost, split('ok', 20_000, 1)], 0, 200, 4)
    expect(grants.starts).toEqual(['root'])
    expect(grants.splits.get('ok')).toBe(1)
    expect(grants.splits.has('lost')).toBe(false)
  })

  it('treats a start whose deadline has passed as lost', () => {
    const grants = allocate(1, [{ leaseId: 'late', deadline: 100 }, { leaseId: 'fresh', deadline: 50_000 }], [], 1_000, 200, 4)
    expect(grants.starts).toEqual(['fresh'])
  })

  it('grants nothing without free tokens', () => {
    const grants = allocate(0, [{ leaseId: 'root', deadline: 1 }], [split('a', 1, 1)], 0, 200, 4)
    expect(grants.starts).toEqual([])
    expect(grants.splits.size).toBe(0)
  })
})

describe('preemption', () => {
  const running = [
    { leaseId: 'late-deadline', deadline: 90_000, remaining: 50 },
    { leaseId: 'mid-deadline', deadline: 40_000, remaining: 50 },
    { leaseId: 'tiny', deadline: 99_000, remaining: 1 },
  ]

  it('yields the running lease with the latest deadline for urgent work that found no token', () => {
    const grants = allocate(0, [{ leaseId: 'root', deadline: 20_000 }], [], 0, 200, 4, { running, yielding: 0, minRemaining: 2 })
    expect(grants.preempt).toEqual(['late-deadline'])
  })

  it('never preempts work that is due sooner than the waiting request', () => {
    const grants = allocate(0, [{ leaseId: 'root', deadline: 95_000 }], [], 0, 200, 4, { running, yielding: 0, minRemaining: 2 })
    expect(grants.preempt).toEqual([])
  })

  it('counts workers that are already yielding before preempting more', () => {
    const starts = [
      { leaseId: 'a', deadline: 10_000 },
      { leaseId: 'b', deadline: 11_000 },
    ]
    const grants = allocate(0, starts, [], 0, 200, 4, { running, yielding: 1, minRemaining: 2 })
    expect(grants.preempt).toEqual(['late-deadline'])
  })

  it('does not preempt for spare-capacity splits', () => {
    const spare = { ...split('s', 10_000, 2), opportunistic: true }
    const grants = allocate(0, [], [spare], 0, 200, 4, { running, yielding: 0, minRemaining: 2 })
    expect(grants.preempt).toEqual([])
  })
})

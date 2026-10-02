import { describe, expect, it } from 'vitest'
import { admits } from '../src/admission.ts'

describe('admits', () => {
  it('admits work that fits before its deadline', () => {
    expect(admits({ id: 'a', deadline: 10_000, workMs: 8_000 }, [], 0, 1, 1)).toBe(true)
  })

  it('rejects work that cannot fit even on an empty box', () => {
    expect(admits({ id: 'a', deadline: 10_000, workMs: 30_000 }, [], 0, 2, 1)).toBe(false)
  })

  it('counts earlier deadlines ahead of the candidate', () => {
    const queued = [{ id: 'q', deadline: 5_000, workMs: 9_000 }]
    expect(admits({ id: 'a', deadline: 10_000, workMs: 5_000 }, queued, 0, 1, 1)).toBe(false)
    expect(admits({ id: 'a', deadline: 10_000, workMs: 5_000 }, queued, 0, 2, 1)).toBe(true)
  })

  it('rejects a candidate that would push a feasible later task over', () => {
    const queued = [{ id: 'q', deadline: 20_000, workMs: 15_000 }]
    expect(admits({ id: 'a', deadline: 10_000, workMs: 8_000 }, queued, 0, 1, 1)).toBe(false)
  })

  it('does not blame the candidate for a later task that was already infeasible', () => {
    const queued = [{ id: 'q', deadline: 20_000, workMs: 50_000 }]
    expect(admits({ id: 'a', deadline: 10_000, workMs: 5_000 }, queued, 0, 1, 1)).toBe(true)
  })

  it('keeps slack in reserve', () => {
    expect(admits({ id: 'a', deadline: 10_000, workMs: 9_500 }, [], 0, 1, 0.9)).toBe(false)
  })
})

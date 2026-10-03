import { describe, expect, it } from 'vitest'
import { exhibitSchedule } from '../src/schedule.ts'

const params = { durationMs: 600_000, utilization: 1, capacityCores: 2, minItems: 20, maxItems: 120, slackMin: 0.5, slackMax: 3, seed: 7 }
const itemMs = Array.from({ length: 100 }, (_, i) => 200 + i)

describe('exhibitSchedule', () => {
  it('is the same for the same seed and different for another', () => {
    expect(exhibitSchedule(params, itemMs)).toEqual(exhibitSchedule(params, itemMs))
    expect(exhibitSchedule({ ...params, seed: 8 }, itemMs)).not.toEqual(exhibitSchedule(params, itemMs))
  })

  it('starts at zero, stays inside the run and the parameter ranges', () => {
    const arrivals = exhibitSchedule(params, itemMs)
    expect(arrivals[0]!.at).toBe(0)
    for (const a of arrivals) {
      expect(a.at).toBeLessThan(params.durationMs)
      expect(a.count).toBeGreaterThanOrEqual(20)
      expect(a.count).toBeLessThanOrEqual(120)
      expect(a.offset).toBeGreaterThanOrEqual(0)
      expect(a.offset).toBeLessThan(100)
      expect(a.slack).toBeGreaterThanOrEqual(0.5)
      expect(a.slack).toBeLessThanOrEqual(3)
    }
  })

  it('offers about the requested load', () => {
    const arrivals = exhibitSchedule({ ...params, durationMs: 3_600_000 }, itemMs)
    const offered = arrivals.reduce((sum, a) => sum + a.count * 249.5, 0) / 3_600_000
    expect(offered).toBeGreaterThan(1.7)
    expect(offered).toBeLessThan(2.3)
  })
})

import { policies } from '@poof/core'
import { describe, expect, it } from 'vitest'
import { Simulation, workerMemoryMb } from '../src/engine.ts'
import { mainPolicies } from '../src/scenarios.ts'
import { burstScenario, calibration, machine, poisonScenario, shortScenario } from './fixture.ts'

function run(options: Partial<ConstructorParameters<typeof Simulation>[0]> = {}) {
  return new Simulation({
    scenario: shortScenario,
    machine,
    policy: policies.forecastManaged,
    calibration,
    seed: 7,
    ...options,
  }).run()
}

describe('Simulation', () => {
  it('is deterministic for a seed', () => {
    const a = run()
    const b = run()
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(JSON.stringify(run({ seed: 8 }).tasks)).not.toBe(JSON.stringify(a.tasks))
  })

  it('gives every policy the same tasks for a seed', () => {
    const shape = (policy: (typeof mainPolicies)[number]) =>
      run({ policy }).tasks.map((t) => [t.id, t.items, t.submittedAt, t.deadline].join())
    const reference = shape(policies.never)
    for (const policy of mainPolicies) expect(shape(policy)).toEqual(reference)
  })

  for (const policy of mainPolicies) {
    it(`${policy.name} keeps every item owned by exactly one lease`, () => {
      const result = run({ policy, scenario: burstScenario, checkInvariants: true })
      for (const task of result.tasks) {
        if (task.finishedAt !== null) expect(task.finishedAt).toBeGreaterThanOrEqual(task.submittedAt)
      }
      if (policy.budget) {
        expect(result.tasks.filter((t) => !t.rejected && !t.failed).every((t) => t.finishedAt !== null)).toBe(true)
      }
    })
  }

  it('the budgeted policies never run more processes than the budget', () => {
    for (const policy of [policies.forecastManaged, policies.timerManaged, policies.static, policies.never]) {
      const result = run({ policy, scenario: burstScenario })
      expect(result.peaks.processes).toBeLessThanOrEqual(result.budget)
    }
  })

  it('the box storms under a burst', () => {
    const box = run({ policy: policies.box, scenario: burstScenario })
    const managed = run({ policy: policies.forecastManaged, scenario: burstScenario })
    expect(box.peaks.processes).toBeGreaterThan(3 * managed.budget)
    expect(box.counts.oomKills + box.counts.spawnFailures).toBeGreaterThan(0)
  })

  it('forecast splits a late task before the timer does', () => {
    const forecast = run({ policy: policies.forecastManaged })
    const timer = run({ policy: policies.timerManaged })
    expect(forecast.counts.splits).toBeGreaterThan(0)
    const met = (r: ReturnType<typeof run>) => r.tasks.filter((t) => t.met).length
    expect(met(forecast)).toBeGreaterThanOrEqual(met(timer))
  })

  it('dead-letters poisoned items and opens the breaker during an outage', () => {
    const managed = run({ policy: policies.forecastManaged, scenario: poisonScenario })
    expect(managed.counts.deadLettered).toBeGreaterThan(0)
    expect(managed.counts.breakerOpened).toBeGreaterThan(0)
    const box = run({ policy: policies.box, scenario: poisonScenario })
    expect(box.counts.deadLettered).toBe(0)
    expect(box.counts.crashes).toBeGreaterThan(managed.counts.crashes)
  })
})

describe('workerMemoryMb', () => {
  it('grows from the spawn memory to the plateau over the first hundred items, like B5', () => {
    expect(workerMemoryMb(calibration, 0)).toBe(69)
    expect(workerMemoryMb(calibration, 100)).toBeCloseTo(150)
    expect(workerMemoryMb(calibration, 5000)).toBeCloseTo(150)
    expect(workerMemoryMb(calibration, 3)).toBeGreaterThan(80)
    expect(workerMemoryMb(calibration, 3)).toBeLessThan(100)
    expect(workerMemoryMb(calibration, 25)).toBeGreaterThan(workerMemoryMb(calibration, 3))
  })
})

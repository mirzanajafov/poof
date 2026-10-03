import { exhibitSchedule } from '@poof/core'
import { describe, expect, it } from 'vitest'
import { capacityCores, replay, replayItems, type ExhibitRun } from '../src/replay.ts'
import { calibration } from './fixture.ts'

const manifest = Array.from({ length: 30 }, (_, i) => ({ file: `${i}.jpg`, width: 2000 + i * 100, height: 1500 }))
const measured = new Map(manifest.map((m, i) => [m.file, 200 + i * 10]))
const items = replayItems(manifest, measured, 'webp-1600')

const run = (policy: string): ExhibitRun => ({
  id: 'x',
  policy,
  params: { durationSeconds: 60, utilization: 1.2, minItems: 20, maxItems: 60, slackMin: 0.5, slackMax: 3, seed: 3, dataset: 'synthetic', preset: 'webp-1600' },
  stats: { submitted: 0, rejected: 0, done: 0, met: 0, cancelled: 0, items: 0, spawns: 0, splits: 0, peakProcesses: 0, exits: {} },
})

describe('replay', () => {
  it('submits exactly the tasks the exhibit schedule would', () => {
    const schedule = exhibitSchedule(
      { durationMs: 60_000, utilization: 1.2, capacityCores, minItems: 20, maxItems: 60, slackMin: 0.5, slackMax: 3, seed: 3 },
      items.map((i) => i.predictedMs),
    )
    const result = replay(run('forecast+preempt'), items, calibration)
    expect(result.tasks).toHaveLength(schedule.length)
    expect(result.tasks.map((t) => t.items)).toEqual(schedule.map((a) => a.count))
  })

  it('uses the measured cost of each image and is deterministic', () => {
    expect(items[3]!.costMs).toBe(230)
    expect(JSON.stringify(replay(run('box'), items, calibration))).toBe(JSON.stringify(replay(run('box'), items, calibration)))
  })

  it('starts the pool warm, with no spawns', () => {
    expect(replay(run('pool'), items, calibration).counts.spawns).toBe(0)
  })
})

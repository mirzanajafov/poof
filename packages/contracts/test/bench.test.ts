import { describe, expect, it } from 'vitest'
import {
  itemCostMedians,
  parseConcurrencyRun,
  parseExhibitRuns,
  parseItemCosts,
  parseSpawnRun,
  type ConcurrencyRow,
  type ItemCostSample,
} from '../src/bench.ts'
import { emptyExhibitStats, exhibitDefaults } from '../src/exhibits.ts'

const sample: ItemCostSample = {
  source: 'synthetic',
  file: 'syn-000.jpg',
  mp: 12.4,
  bytes: 4_200_000,
  preset: 'webp-1600',
  pass: 1,
  readMs: 3.1,
  wallMs: 412.5,
  cpuMs: 405,
  peakRssMb: 188.2,
  outBytes: 310_000,
}

const row: ConcurrencyRow = {
  k: 2,
  items: 61,
  effectiveCores: 1.41,
  efficiency: 0.94,
  wallInflation: 1.06,
  peakRssMb: 240.1,
  medianPeakRssMb: 231.7,
  cgroupAnonMeanMb: null,
  cgroupAnonPeakMb: null,
}

const summary = { n: 20, mean: 171, p50: 168, p95: 190, p99: 194, max: 195 }

describe('parseItemCosts', () => {
  it('reads the samples of an item cost file, whatever the fields it does not use hold', () => {
    const unmeasured = { ...sample, file: 'syn-001.jpg', cpuMs: null }
    const text = JSON.stringify({ env: {}, fits: {}, samples: [sample, unmeasured] })
    expect(parseItemCosts(text, 'b1.json')).toEqual([sample, unmeasured])
  })

  it('names the file when the text is not JSON or lists no samples', () => {
    expect(() => parseItemCosts('{', 'results/b1.json')).toThrow('results/b1.json is not valid JSON')
    expect(() => parseItemCosts('{}', 'b1.json')).toThrow('b1.json lists no samples')
    expect(() => parseItemCosts(JSON.stringify({ samples: [] }), 'b1.json')).toThrow('b1.json lists no samples')
  })

  it('names the sample and the field it uses that is missing or of the wrong type', () => {
    const withoutWall = { ...sample, wallMs: undefined }
    expect(() => parseItemCosts(JSON.stringify({ samples: [sample, withoutWall] }), 'b1.json')).toThrow(
      'b1.json: samples 1 has no valid wallMs',
    )
    expect(() => parseItemCosts(JSON.stringify({ samples: [{ ...sample, mp: '12.4' }] }), 'b1.json')).toThrow(
      'b1.json: samples 0 has no valid mp',
    )
  })
})

describe('itemCostMedians', () => {
  it('takes the median wall time of each image for one preset and source', () => {
    const costs = [
      { ...sample, wallMs: 400 },
      { ...sample, wallMs: 430 },
      { ...sample, wallMs: 410 },
      { ...sample, file: 'syn-001.jpg', wallMs: 90 },
      { ...sample, source: 'nasa', wallMs: 999 },
      { ...sample, preset: 'thumb-320', wallMs: 50 },
    ]
    expect(itemCostMedians(costs, 'webp-1600', 'synthetic')).toEqual(
      new Map([
        ['syn-000.jpg', 410],
        ['syn-001.jpg', 90],
      ]),
    )
  })
})

describe('parseConcurrencyRun', () => {
  it('reads the cpus, the knee and the rows, with or without cgroup memory', () => {
    const measured = { ...row, wallInflation: null, cgroupAnonMeanMb: 210, cgroupAnonPeakMb: 233 }
    const text = JSON.stringify({ cpus: 1.5, knee: 2, preset: 'webp-1600', rows: [row, measured] })
    expect(parseConcurrencyRun(text, 'b2.json')).toEqual({ cpus: 1.5, knee: 2, rows: [row, measured] })
  })

  it('refuses a row without the cgroup memory field and a run without a knee', () => {
    const withoutPeak = { ...row, cgroupAnonPeakMb: undefined }
    expect(() => parseConcurrencyRun(JSON.stringify({ cpus: 2, knee: 2, rows: [withoutPeak] }), 'b2.json')).toThrow(
      'b2.json: rows 0 has no valid cgroupAnonPeakMb',
    )
    expect(() => parseConcurrencyRun(JSON.stringify({ cpus: 2, rows: [row] }), 'b2.json')).toThrow(
      'b2.json needs a number of cpus and a knee',
    )
  })
})

describe('parseSpawnRun', () => {
  it('reads the warm medians and has no anonymous memory when the run did not measure it', () => {
    const warm = { wallMs: summary, cpuMs: summary, rssMb: summary, exitMs: summary }
    expect(parseSpawnRun(JSON.stringify({ first: {}, warm }), 'b3.json')).toEqual({
      warm: { wallMs: summary, cpuMs: summary, rssMb: summary, anonMb: null },
    })
  })

  it('refuses a run whose medians are missing', () => {
    expect(() => parseSpawnRun(JSON.stringify({ warm: { wallMs: summary } }), 'b3.json')).toThrow(
      'b3.json needs the median wall time, CPU time and memory of the warm spawns',
    )
    const warm = { wallMs: summary, cpuMs: summary, rssMb: summary, anonMb: { mean: 80 } }
    expect(() => parseSpawnRun(JSON.stringify({ warm }), 'b3.json')).toThrow(
      'b3.json has an anonymous memory summary without a median',
    )
  })
})

describe('parseExhibitRuns', () => {
  const run = {
    id: 'e1',
    policy: 'pool',
    params: { ...exhibitDefaults, policy: 'pool' },
    stats: { ...emptyExhibitStats(), submitted: 40, met: 31, exits: { timeout: 2 } },
    tasks: [],
  }

  it('reads the id, params and stats of every recorded run', () => {
    expect(parseExhibitRuns(JSON.stringify([run]), 'runs.json')).toEqual([
      { id: run.id, params: run.params, stats: run.stats },
    ])
  })

  it('names the run and the field when a policy, preset or count is not usable', () => {
    const unknownPolicy = { ...run, params: { ...run.params, policy: 'storm' } }
    expect(() => parseExhibitRuns(JSON.stringify([run, unknownPolicy]), 'runs.json')).toThrow(
      'runs.json: run e1 params has no valid policy',
    )
    const unknownPreset = { ...run, params: { ...run.params, preset: 'gif-64' } }
    expect(() => parseExhibitRuns(JSON.stringify([unknownPreset]), 'runs.json')).toThrow(
      'runs.json: run e1 params has no valid preset',
    )
    const withoutSpawns = { ...run, stats: { ...run.stats, spawns: undefined } }
    expect(() => parseExhibitRuns(JSON.stringify([withoutSpawns]), 'runs.json')).toThrow(
      'runs.json: run e1 stats has no valid spawns',
    )
  })
})

import { describe, expect, it } from 'vitest'
import {
  parseConcurrencyRun,
  parseItemCosts,
  parseSpawnRun,
  type ConcurrencyRow,
  type ItemCostSample,
  type Summary,
} from '../src/bench.ts'

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

const summary: Summary = { n: 20, mean: 171, p50: 168, p95: 190, p99: 194, max: 195 }

describe('parseItemCosts', () => {
  it('reads the samples of an item cost file', () => {
    const text = JSON.stringify({ env: {}, fits: {}, samples: [sample] })
    expect(parseItemCosts(text, 'b1.json')).toEqual([sample])
  })

  it('names the file when the text is not JSON or lists no samples', () => {
    expect(() => parseItemCosts('{', 'results/b1.json')).toThrow('results/b1.json is not valid JSON')
    expect(() => parseItemCosts('{}', 'b1.json')).toThrow('b1.json lists no samples')
    expect(() => parseItemCosts(JSON.stringify({ samples: [] }), 'b1.json')).toThrow('b1.json lists no samples')
  })

  it('names the sample that misses a field or has one of the wrong type', () => {
    const withoutWall = { ...sample, wallMs: undefined }
    expect(() => parseItemCosts(JSON.stringify({ samples: [sample, withoutWall] }), 'b1.json')).toThrow(
      'b1.json: samples entry 1 misses a field or has a wrong type',
    )
    expect(() => parseItemCosts(JSON.stringify({ samples: [{ ...sample, mp: '12.4' }] }), 'b1.json')).toThrow(
      'b1.json: samples entry 0 misses a field or has a wrong type',
    )
  })
})

describe('parseConcurrencyRun', () => {
  it('reads the cpus, the knee and the rows, with or without cgroup memory', () => {
    const measured = { ...row, cgroupAnonMeanMb: 210, cgroupAnonPeakMb: 233 }
    const text = JSON.stringify({ cpus: 1.5, knee: 2, preset: 'webp-1600', rows: [row, measured] })
    expect(parseConcurrencyRun(text, 'b2.json')).toEqual({ cpus: 1.5, knee: 2, rows: [row, measured] })
  })

  it('refuses a row without the cgroup memory field and a run without a knee', () => {
    const withoutPeak = { ...row, cgroupAnonPeakMb: undefined }
    expect(() => parseConcurrencyRun(JSON.stringify({ cpus: 2, knee: 2, rows: [withoutPeak] }), 'b2.json')).toThrow(
      'b2.json: rows entry 0 misses a field or has a wrong type',
    )
    expect(() => parseConcurrencyRun(JSON.stringify({ cpus: 2, rows: [row] }), 'b2.json')).toThrow(
      'b2.json needs a number of cpus and a knee',
    )
  })
})

describe('parseSpawnRun', () => {
  it('reads the warm summaries and has no anonymous memory when the run did not measure it', () => {
    const warm = { wallMs: summary, cpuMs: summary, rssMb: summary, exitMs: summary }
    expect(parseSpawnRun(JSON.stringify({ first: {}, warm }), 'b3.json')).toEqual({
      warm: { wallMs: summary, cpuMs: summary, rssMb: summary, anonMb: null },
    })
  })

  it('refuses a run whose summaries are missing or broken', () => {
    expect(() => parseSpawnRun(JSON.stringify({ warm: { wallMs: summary } }), 'b3.json')).toThrow(
      "b3.json needs summaries of the warm spawns' wall time, CPU time and memory",
    )
    const warm = { wallMs: summary, cpuMs: summary, rssMb: summary, anonMb: { p50: 80 } }
    expect(() => parseSpawnRun(JSON.stringify({ warm }), 'b3.json')).toThrow(
      'b3.json has an anonymous memory summary that is not one',
    )
  })
})

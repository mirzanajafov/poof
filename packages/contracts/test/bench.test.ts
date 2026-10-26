import { describe, expect, it } from 'vitest'
import { parseItemCosts, type ItemCostSample } from '../src/bench.ts'

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

describe('parseItemCosts', () => {
  it('reads the samples of an item cost file', () => {
    const text = JSON.stringify({ env: {}, fits: {}, samples: [sample] })
    expect(parseItemCosts(text, 'b1.json')).toEqual([sample])
  })

  it('names the file when the text is not JSON or lists no samples', () => {
    expect(() => parseItemCosts('{', 'results/b1.json')).toThrow('results/b1.json is not valid JSON')
    expect(() => parseItemCosts('{}', 'b1.json')).toThrow('b1.json lists no samples')
  })

  it('names the sample that misses a field or has one of the wrong type', () => {
    const withoutWall = { ...sample, wallMs: undefined }
    expect(() => parseItemCosts(JSON.stringify({ samples: [sample, withoutWall] }), 'b1.json')).toThrow(
      'b1.json: sample 1 is not an item cost sample',
    )
    expect(() => parseItemCosts(JSON.stringify({ samples: [{ ...sample, mp: '12.4' }] }), 'b1.json')).toThrow(
      'b1.json: sample 0 is not an item cost sample',
    )
  })
})

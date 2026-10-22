import { describe, expect, it } from 'vitest'
import { parseDatasetSource } from './dataset-source.js'

describe('parseDatasetSource', () => {
  it('splits the name from the directory at the first equals sign', () => {
    expect(parseDatasetSource('nasa=data/nasa')).toEqual({ name: 'nasa', dir: 'data/nasa' })
    expect(parseDatasetSource('odd=data/a=b')).toEqual({ name: 'odd', dir: 'data/a=b' })
  })

  it('rejects a source without a directory', () => {
    expect(parseDatasetSource('nasa')).toBeUndefined()
    expect(parseDatasetSource('nasa=')).toBeUndefined()
  })

  it('rejects a name the supervisor would never serve', () => {
    expect(parseDatasetSource('=data/nasa')).toBeUndefined()
    expect(parseDatasetSource('NASA=data/nasa')).toBeUndefined()
    expect(parseDatasetSource('../nasa=data/nasa')).toBeUndefined()
  })
})

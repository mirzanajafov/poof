import { describe, expect, it } from 'vitest'
import { validateEnv } from './env.js'

const base = { DATABASE_URL: 'postgresql://localhost/db', REDIS_URL: 'redis://localhost', DATA_DIR: '/data' }

describe('validateEnv', () => {
  it('applies defaults and converts numbers', () => {
    expect(validateEnv(base)).toMatchObject({ PORT: 3110, BUDGET: 2, CAPACITY_CORES: 1.32, CHUNK_ITEMS: 10 })
    expect(validateEnv({ ...base, BUDGET: '4', CAPACITY_CORES: '3.7' })).toMatchObject({ BUDGET: 4, CAPACITY_CORES: 3.7 })
  })

  it('rejects missing or out-of-range values', () => {
    expect(() => validateEnv({ DATABASE_URL: 'x' })).toThrow(/REDIS_URL/)
    expect(() => validateEnv({ ...base, BUDGET: '0' })).toThrow(/BUDGET/)
    expect(() => validateEnv({ ...base, DEAD_LETTER_SHARE: '2' })).toThrow(/DEAD_LETTER_SHARE/)
  })
})

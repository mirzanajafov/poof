import { describe, expect, it } from 'vitest'
import { parseEnv } from '@poof/nest'
import { Env } from './env.js'

const base = { DATABASE_URL: 'postgresql://localhost/db', REDIS_URL: 'redis://localhost', DATA_DIR: '/data' }

describe('Env', () => {
  it('applies defaults and converts numbers', () => {
    expect(parseEnv(Env, base)).toMatchObject({
      PORT: 3110,
      BUDGET: 2,
      CAPACITY_CORES: 1.32,
      WORKER_CPU_CORES: 1.45,
      ADMISSION_PRIOR_RATIO: 1.2,
      CHUNK_ITEMS: 10,
    })
    expect(parseEnv(Env, { ...base, BUDGET: '4', CAPACITY_CORES: '3.7' })).toMatchObject({
      BUDGET: 4,
      CAPACITY_CORES: 3.7,
    })
  })

  it('rejects missing or out-of-range values', () => {
    expect(() => parseEnv(Env, { DATABASE_URL: 'x' })).toThrow(/REDIS_URL/)
    expect(() => parseEnv(Env, { ...base, BUDGET: '0' })).toThrow(/BUDGET/)
    expect(() => parseEnv(Env, { ...base, DEAD_LETTER_SHARE: '2' })).toThrow(/DEAD_LETTER_SHARE/)
  })
})

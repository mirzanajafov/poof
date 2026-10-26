import { describe, expect, it } from 'vitest'
import { parseEnv } from '@poof/nest'
import { Env } from './env.js'

const base = {
  DATABASE_URL: 'postgresql://localhost/db',
  REDIS_URL: 'redis://localhost',
  SUPERVISOR_URL: 'http://supervisor:3110',
  DATA_DIR: '/data',
  ADMIN_TOKEN: 'a-long-enough-admin-token-value',
}

describe('Env', () => {
  it('applies defaults', () => {
    expect(parseEnv(Env, base)).toMatchObject({ PORT: 3111, TASKS_PER_MINUTE: 10, PUBLIC_EXHIBIT_SECONDS: 60 })
  })

  it('refuses a short admin token and missing settings', () => {
    expect(() => parseEnv(Env, { ...base, ADMIN_TOKEN: 'short' })).toThrow(/ADMIN_TOKEN/)
    expect(() => parseEnv(Env, { ...base, SUPERVISOR_URL: undefined })).toThrow(/SUPERVISOR_URL/)
  })
})

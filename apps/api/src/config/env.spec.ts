import { describe, expect, it } from 'vitest'
import { validateEnv } from './env.js'

const base = {
  DATABASE_URL: 'postgresql://localhost/db',
  REDIS_URL: 'redis://localhost',
  SUPERVISOR_URL: 'http://supervisor:3110',
  DATA_DIR: '/data',
  ADMIN_TOKEN: 'a-long-enough-admin-token-value',
}

describe('validateEnv', () => {
  it('applies defaults', () => {
    expect(validateEnv(base)).toMatchObject({ PORT: 3111, TASKS_PER_MINUTE: 10, PUBLIC_EXHIBIT_SECONDS: 60 })
  })

  it('refuses a short admin token and missing settings', () => {
    expect(() => validateEnv({ ...base, ADMIN_TOKEN: 'short' })).toThrow(/ADMIN_TOKEN/)
    expect(() => validateEnv({ ...base, SUPERVISOR_URL: undefined })).toThrow(/SUPERVISOR_URL/)
  })
})

import { describe, expect, it } from 'vitest'
import { parseEnv } from '@poof/nest'
import { Env } from './env.js'

const required = {
  DATABASE_URL: 'postgresql://localhost/db',
  REDIS_URL: 'redis://localhost',
  SUPERVISOR_URL: 'http://supervisor:3110',
  DATA_DIR: '/data',
  ADMIN_TOKEN: 'a-long-enough-admin-token-value',
}

describe('Env', () => {
  it('applies defaults', () => {
    expect(parseEnv(Env, required)).toMatchObject({
      PORT: 3111,
      TRUST_PROXY: 'loopback',
      TASKS_PER_MINUTE: 10,
      PUBLIC_EXHIBIT_SECONDS: 60,
    })
  })

  it('reads TRUST_PROXY as a switch, a hop count or a list of addresses', () => {
    const trust = (TRUST_PROXY: string) => parseEnv(Env, { ...required, TRUST_PROXY }).TRUST_PROXY
    expect(trust('false')).toBe(false)
    expect(trust('true')).toBe(true)
    expect(trust('2')).toBe(2)
    expect(trust('loopback, uniquelocal')).toBe('loopback, uniquelocal')
  })

  it('refuses a short admin token, missing settings and a public limit shorter than the public exhibit', () => {
    expect(() => parseEnv(Env, { ...required, ADMIN_TOKEN: 'short' })).toThrow(/ADMIN_TOKEN/)
    expect(() => parseEnv(Env, { ...required, SUPERVISOR_URL: undefined })).toThrow(/SUPERVISOR_URL/)
    expect(() => parseEnv(Env, { ...required, PUBLIC_EXHIBIT_SECONDS: '30' })).toThrow(/PUBLIC_EXHIBIT_SECONDS/)
  })
})

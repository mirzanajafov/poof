import { describe, expect, it } from 'vitest'
import { exhibitPolicies, exhibitPolicyNames } from '../src/policies.ts'

describe('exhibitPolicies', () => {
  it('runs every exhibit under the simulator policy of the same name, and the pool on the pool engine', () => {
    for (const name of exhibitPolicyNames.filter((n) => n !== 'pool')) {
      expect(exhibitPolicies[name]).toMatchObject({ name, engine: 'lease' })
    }
    expect(exhibitPolicies.pool.engine).toBe('pool')
  })
})

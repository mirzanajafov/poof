import type { ExhibitDetail, TaskDetail, TaskStatus } from '@poof/contracts'
import type { ExhibitStatus, LeaseState, TaskStatus as TaskStatusColumn } from '@poof/db'
import { describe, expectTypeOf, it } from 'vitest'

describe('the wire types', () => {
  it('list the same states as the columns the API reads them from', () => {
    expectTypeOf<TaskStatus>().toEqualTypeOf<TaskStatusColumn>()
    expectTypeOf<TaskDetail['leases'][number]['state']>().toEqualTypeOf<LeaseState>()
    expectTypeOf<ExhibitDetail['status']>().toEqualTypeOf<ExhibitStatus>()
  })
})

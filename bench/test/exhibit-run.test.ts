import { emptyExhibitStats, exhibitDefaults, type ExhibitDetail } from '@poof/contracts'
import { describe, expect, it } from 'vitest'
import { finishedRun } from '../src/exhibit-run.ts'

const detail: ExhibitDetail = {
  id: 'e1',
  policy: 'pool',
  status: 'DONE',
  startedAt: '2026-10-26T10:00:00.000Z',
  endedAt: '2026-10-26T10:01:00.000Z',
  params: { ...exhibitDefaults, policy: 'pool' },
  stats: { ...emptyExhibitStats(), submitted: 40, met: 31 },
  tasks: [],
}

describe('finishedRun', () => {
  it('records an exhibit that ran to the end', () => {
    expect(finishedRun(detail)).toEqual({
      id: 'e1',
      policy: 'pool',
      params: detail.params,
      stats: detail.stats,
      tasks: [],
    })
  })

  it('leaves out an aborted exhibit, whose stats cover only part of the run', () => {
    expect(finishedRun({ ...detail, status: 'ABORTED' })).toBeNull()
  })

  it('leaves out an exhibit that ended without stats', () => {
    expect(finishedRun({ ...detail, stats: null })).toBeNull()
  })
})

import { Logger } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { FailureStreak } from '../src/failure-streak.ts'

describe('FailureStreak', () => {
  it('logs the first failure of a streak and the recovery, and nothing in between', () => {
    const logger = new Logger('test')
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const log = vi.spyOn(logger, 'log').mockImplementation(() => undefined)
    const streak = new FailureStreak(logger, 'reading the snapshot')
    streak.succeeded()
    streak.failed(new Error('first'))
    streak.failed(new Error('second'))
    streak.succeeded()
    streak.succeeded()
    streak.failed(new Error('third'))
    expect(warn.mock.calls).toEqual([
      ['reading the snapshot failed', new Error('first')],
      ['reading the snapshot failed', new Error('third')],
    ])
    expect(log.mock.calls).toEqual([['reading the snapshot works again']])
  })
})

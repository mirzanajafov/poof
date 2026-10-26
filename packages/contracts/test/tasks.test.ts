import { describe, expect, it } from 'vitest'
import { parseSubmitResult } from '../src/tasks.ts'

describe('parseSubmitResult', () => {
  it('reads an accepted and a refused submission', () => {
    const accepted = { accepted: true, id: 't', items: 40, predictedSeconds: 12 }
    expect(parseSubmitResult(accepted)).toEqual(accepted)
    const refused = {
      accepted: false,
      id: null,
      refusal: 'paused',
      reason: 'an exhibit is running',
      retryAfterSeconds: 9,
    }
    expect(parseSubmitResult(refused)).toEqual(refused)
  })

  it('drops a body that is neither', () => {
    expect(parseSubmitResult({ accepted: true, id: 't', items: '40', predictedSeconds: 12 })).toBeNull()
    expect(
      parseSubmitResult({ accepted: false, id: null, refusal: 'tired', reason: 'r', retryAfterSeconds: 1 }),
    ).toBeNull()
    expect(parseSubmitResult({ message: 'Internal server error' })).toBeNull()
    expect(parseSubmitResult(null)).toBeNull()
  })
})

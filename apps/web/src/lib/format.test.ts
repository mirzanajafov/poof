import { describe, expect, it } from 'vitest'
import { deadlineText, eventSentence, seconds } from './format'

describe('format', () => {
  it('writes durations the way people read them', () => {
    expect(seconds(4200)).toBe('4.2 s')
    expect(seconds(45_000)).toBe('45 s')
    expect(seconds(600_000)).toBe('10 min')
    expect(deadlineText(10_000, 4_000)).toBe('due in 6.0 s')
    expect(deadlineText(4_000, 10_000)).toBe('6.0 s late')
  })

  it('turns supervisor events into sentences and drops the noise', () => {
    expect(eventSentence({ kind: 'task.done', at: 0, task: 'abcdef123', met: true, dead: 0 })).toBe(
      'Task abcdef done, on time',
    )
    expect(
      eventSentence({ kind: 'item.dead', at: 0, task: 'abcdef123', item: 4, attempts: 3, error: 'bad header' }),
    ).toBe('Image 4 of task abcdef dead-lettered after 3 tries')
    expect(eventSentence({ kind: 'worker.exit', at: 0, worker: 'w', reason: 'timeout' })).toBe(
      'A worker exited: killed because an item took too long',
    )
    expect(eventSentence({ kind: 'worker.exit', at: 0, worker: 'w', reason: 'normal' })).toBeNull()
    expect(eventSentence({ kind: 'item', at: 0, task: 't', lease: 'l', item: 1, ok: true })).toBeNull()
    expect(
      eventSentence({ kind: 'lease.created', at: 0, task: 'abcdef1', lease: 'l', parent: 'p', depth: 1, lo: 7, hi: 8 }),
    ).toBe('Task abcdef split: a helper got image 7')
    expect(
      eventSentence({ kind: 'lease.claimed', at: 0, task: 'abcdef1', lease: 'l', worker: 'w', lo: 10, hi: 20 }),
    ).toBe('A worker took images 10-19 of task abcdef')
  })
})

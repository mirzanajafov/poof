import { describe, expect, it } from 'vitest'
import { parseLiveEvent } from '../src/live.ts'

describe('parseLiveEvent', () => {
  it('reads an event the supervisor published', () => {
    const event = { kind: 'item', at: 5, task: 't', lease: 'l', item: 3, ok: true }
    expect(parseLiveEvent(JSON.stringify(event))).toEqual(event)
  })

  it('drops text that is not JSON, an unknown kind and an event without a time', () => {
    expect(parseLiveEvent('{"kind":')).toBeNull()
    expect(parseLiveEvent(JSON.stringify({ kind: 'toString', at: 5 }))).toBeNull()
    expect(parseLiveEvent(JSON.stringify({ kind: 'item' }))).toBeNull()
    expect(parseLiveEvent('null')).toBeNull()
  })
})

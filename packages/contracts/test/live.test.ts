import { describe, expect, it } from 'vitest'
import { parseLiveEvent } from '../src/live.ts'

describe('parseLiveEvent', () => {
  it('reads an event the supervisor published', () => {
    const event = { kind: 'item', at: 5, task: 't', lease: 'l', item: 3, ok: true }
    expect(parseLiveEvent(JSON.stringify(event))).toEqual(event)
    const rejected = { kind: 'task.rejected', at: 5, task: 't', exhibit: null }
    expect(parseLiveEvent(JSON.stringify(rejected))).toEqual(rejected)
  })

  it('drops text that is not JSON, an unknown kind and an event with missing or mistyped fields', () => {
    expect(parseLiveEvent('{"kind":')).toBeNull()
    expect(parseLiveEvent(JSON.stringify({ kind: 'toString', at: 5 }))).toBeNull()
    expect(parseLiveEvent(JSON.stringify({ kind: 'item' }))).toBeNull()
    expect(parseLiveEvent(JSON.stringify({ kind: 'task.accepted', at: 1 }))).toBeNull()
    expect(parseLiveEvent(JSON.stringify({ kind: 'task.rejected', at: 1, task: 't', exhibit: 3 }))).toBeNull()
    expect(parseLiveEvent('null')).toBeNull()
  })
})

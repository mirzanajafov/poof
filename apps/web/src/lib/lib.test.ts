import { describe as group, expect, it } from 'vitest'
import { describe, seconds, until } from './format'
import { layoutLeases } from './tree'
import type { ExhibitLease } from './types'

group('format', () => {
  it('writes durations the way people read them', () => {
    expect(seconds(4200)).toBe('4.2 s')
    expect(seconds(45_000)).toBe('45 s')
    expect(seconds(600_000)).toBe('10 min')
    expect(until(10_000, 4_000)).toBe('due in 6.0 s')
    expect(until(4_000, 10_000)).toBe('6.0 s late')
  })

  it('turns supervisor events into sentences and drops the noise', () => {
    expect(describe({ kind: 'task.done', at: 0, task: 'abcdef123', met: true, dead: 0 })).toBe('Task abcdef done, on time')
    expect(describe({ kind: 'item.dead', at: 0, task: 'abcdef123', item: 4, attempts: 3 })).toBe(
      'Image 4 of task abcdef dead-lettered after 3 tries',
    )
    expect(describe({ kind: 'worker.exit', at: 0, reason: 'timeout' })).toBe('A worker was killed: an item took too long')
    expect(describe({ kind: 'worker.exit', at: 0, reason: 'normal' })).toBeNull()
    expect(describe({ kind: 'item', at: 0 })).toBeNull()
    expect(describe({ kind: 'lease.created', at: 0, task: 'abcdef1', depth: 1, lo: 7, hi: 8 })).toBe('Task abcdef split: a helper got image 7')
    expect(describe({ kind: 'lease.claimed', at: 0, task: 'abcdef1', lo: 10, hi: 20 })).toBe('A worker took images 10-19 of task abcdef')
  })
})

group('layoutLeases', () => {
  const lease = (id: string, parent: string | null, depth: number, lo: number): ExhibitLease => ({
    id,
    parent,
    depth,
    lo,
    hi: lo + 1,
    cursor: lo,
    state: 'running',
    pid: null,
  })

  it('puts children under their parent and centres the parent over them', () => {
    const layout = layoutLeases([lease('r', null, 0, 0), lease('a', 'r', 1, 10), lease('b', 'r', 1, 20)], 100, 50)
    const at = (id: string) => layout.nodes.find((n) => n.lease.id === id)!
    expect(at('a')).toMatchObject({ x: 0, y: 50 })
    expect(at('b')).toMatchObject({ x: 100, y: 50 })
    expect(at('r')).toMatchObject({ x: 50, y: 0 })
    expect(layout.edges).toEqual([
      { from: 'r', to: 'a' },
      { from: 'r', to: 'b' },
    ])
    expect(layout.height).toBe(100)
  })

  it('treats a lease whose parent is missing as a root', () => {
    const layout = layoutLeases([lease('x', 'gone', 2, 0)])
    expect(layout.nodes[0]!.y).toBe(0)
  })
})

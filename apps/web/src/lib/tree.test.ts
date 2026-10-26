import type { ExhibitLeaseView } from '@poof/contracts'
import { describe, expect, it } from 'vitest'
import { layoutLeases } from './tree'

const lease = (id: string, parent: string | null, depth: number, lo: number): ExhibitLeaseView => ({
  id,
  parent,
  depth,
  lo,
  hi: lo + 1,
  cursor: lo,
  state: 'running',
  pid: null,
})

describe('layoutLeases', () => {
  it('puts children under their parent and centres the parent over them', () => {
    const layout = layoutLeases([lease('r', null, 0, 0), lease('a', 'r', 1, 10), lease('b', 'r', 1, 20)], 100, 50)
    const at = new Map(layout.nodes.map((node) => [node.lease.id, node]))
    expect(at.get('a')).toMatchObject({ x: 0, y: 50 })
    expect(at.get('b')).toMatchObject({ x: 100, y: 50 })
    expect(at.get('r')).toMatchObject({ x: 50, y: 0 })
    expect(layout.edges.map((edge) => [edge.from.lease.id, edge.to.lease.id])).toEqual([
      ['r', 'a'],
      ['r', 'b'],
    ])
    expect(layout.height).toBe(100)
  })

  it('treats a lease whose parent is missing as a root', () => {
    const layout = layoutLeases([lease('x', 'gone', 2, 0)])
    expect(layout.nodes.map((node) => node.y)).toEqual([0])
  })
})

import type { ExhibitLease } from './types'

export interface Placed {
  lease: ExhibitLease
  x: number
  y: number
}

export interface Layout {
  nodes: Placed[]
  edges: Array<{ from: string; to: string }>
  width: number
  height: number
}

export function layoutLeases(leases: readonly ExhibitLease[], columnWidth = 64, rowHeight = 56): Layout {
  const byId = new Map(leases.map((l) => [l.id, l]))
  const children = new Map<string, ExhibitLease[]>()
  const roots: ExhibitLease[] = []
  for (const lease of leases) {
    if (lease.parent && byId.has(lease.parent)) {
      children.set(lease.parent, [...(children.get(lease.parent) ?? []), lease])
    } else {
      roots.push(lease)
    }
  }
  for (const list of children.values()) list.sort((a, b) => a.lo - b.lo)
  roots.sort((a, b) => a.lo - b.lo)

  const nodes: Placed[] = []
  const edges: Array<{ from: string; to: string }> = []
  let column = 0
  let deepest = 0
  const visit = (lease: ExhibitLease, depth: number): number => {
    deepest = Math.max(deepest, depth)
    const kids = children.get(lease.id) ?? []
    let x: number
    if (kids.length === 0) {
      x = column * columnWidth
      column++
    } else {
      const xs = kids.map((kid) => {
        edges.push({ from: lease.id, to: kid.id })
        return visit(kid, depth + 1)
      })
      x = (Math.min(...xs) + Math.max(...xs)) / 2
    }
    nodes.push({ lease, x, y: depth * rowHeight })
    return x
  }
  for (const root of roots) visit(root, 0)
  return { nodes, edges, width: Math.max(1, column) * columnWidth, height: (deepest + 1) * rowHeight }
}

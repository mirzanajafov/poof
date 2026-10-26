import type { ExhibitLeaseView } from '@poof/contracts'

export interface Placed {
  lease: ExhibitLeaseView
  x: number
  y: number
}

export interface Layout {
  nodes: Placed[]
  edges: Array<{ from: Placed; to: Placed }>
  width: number
  height: number
}

export function layoutLeases(leases: readonly ExhibitLeaseView[], columnWidth = 64, rowHeight = 56): Layout {
  const byId = new Map(leases.map((l) => [l.id, l]))
  const children = new Map<string, ExhibitLeaseView[]>()
  const roots: ExhibitLeaseView[] = []
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
  const edges: Array<{ from: Placed; to: Placed }> = []
  let column = 0
  let deepest = 0
  const visit = (lease: ExhibitLeaseView, depth: number): Placed => {
    deepest = Math.max(deepest, depth)
    const kids = (children.get(lease.id) ?? []).map((kid) => visit(kid, depth + 1))
    const x =
      kids.length === 0
        ? column++ * columnWidth
        : (Math.min(...kids.map((k) => k.x)) + Math.max(...kids.map((k) => k.x))) / 2
    const placed = { lease, x, y: depth * rowHeight }
    nodes.push(placed)
    for (const kid of kids) edges.push({ from: placed, to: kid })
    return placed
  }
  for (const root of roots) visit(root, 0)
  return { nodes, edges, width: Math.max(1, column) * columnWidth, height: (deepest + 1) * rowHeight }
}

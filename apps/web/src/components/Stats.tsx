import type { ReactNode } from 'react'

export function Stats({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-xl border border-line bg-surface px-3 py-3">
          <dt className="text-xs text-muted">{label}</dt>
          <dd className="tabular mt-1 text-lg font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

import type { ReactNode } from 'react'

const tones = {
  page: { grid: 'gap-3', card: 'rounded-xl bg-surface py-3' },
  panel: { grid: 'gap-2', card: 'rounded-lg bg-raised py-2' },
}

export function Stats({ items, tone = 'page' }: { items: Array<[string, ReactNode]>; tone?: keyof typeof tones }) {
  return (
    <dl className={`grid grid-cols-2 sm:grid-cols-4 ${tones[tone].grid}`}>
      {items.map(([label, value]) => (
        <div key={label} className={`border border-line px-3 ${tones[tone].card}`}>
          <dt className="text-xs text-muted">{label}</dt>
          <dd className="tabular mt-1 text-lg font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

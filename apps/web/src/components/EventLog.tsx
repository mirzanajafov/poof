'use client'

import { describe } from '@/lib/format'
import type { LiveEvent } from '@/lib/types'

export function EventLog({ events }: { events: LiveEvent[] }) {
  const lines = events.map((event) => ({ event, text: describe(event) })).filter((l) => l.text)
  return (
    <section>
      <h2 className="text-sm font-semibold">What the box is doing</h2>
      <ol className="mt-2 max-h-80 space-y-1 overflow-y-auto rounded-lg border border-line bg-surface p-3 text-sm" aria-live="polite">
        {lines.length === 0 && <li className="text-muted">Waiting for something to happen.</li>}
        {lines.map(({ event, text }, i) => (
          <li key={`${event.at}-${i}`} className="flex gap-3">
            <span className="tabular shrink-0 text-xs leading-5 text-faint">
              {new Date(event.at).toLocaleTimeString([], { hour12: false })}
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

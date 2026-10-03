'use client'

import Link from 'next/link'
import { short, until } from '@/lib/format'
import type { LiveSnapshot } from '@/lib/types'

export function Tiles({ live, throughput, connected }: { live: LiveSnapshot | null; throughput: number; connected: boolean }) {
  const busy = live?.workers.filter((w) => w.lease).length ?? 0
  const tiles = [
    { label: 'Workers busy', value: live ? `${busy} / ${live.budget}` : '–' },
    { label: 'Tasks in the queue', value: live ? String(live.tasks.length) : '–' },
    { label: 'Images per second', value: throughput.toFixed(1) },
  ]
  return (
    <div className="grid grid-cols-3 gap-3">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-xl border border-line bg-surface px-3 py-3">
          <div className="text-xs text-muted">{tile.label}</div>
          <div className="tabular mt-1 text-2xl font-semibold">{tile.value}</div>
        </div>
      ))}
      <p className="col-span-3 flex items-center gap-2 text-xs text-muted">
        <span className={`inline-block size-2 rounded-full ${connected ? 'bg-good' : 'bg-bad'}`} aria-hidden />
        {connected ? 'Live' : 'Reconnecting to the box…'}
      </p>
    </div>
  )
}

export function Workers({ live }: { live: LiveSnapshot | null }) {
  if (!live) return null
  const slots = Array.from({ length: Math.max(live.budget, live.workers.length) }, (_, i) => live.workers[i] ?? null)
  return (
    <section>
      <h2 className="text-sm font-semibold">Workers</h2>
      <p className="text-xs text-muted">The budget is {live.budget}. Each worker takes ten images at a time, most urgent task first.</p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {slots.map((worker, i) => {
          const lease = worker?.lease
          const progress = lease ? (lease.cursor - lease.lo) / Math.max(1, lease.hi - lease.lo) : 0
          return (
            <div key={worker?.id ?? i} className="rounded-lg border border-line bg-surface p-3">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">{worker ? `Worker ${worker.pid}` : 'Starting…'}</span>
                <span className="tabular text-xs text-muted">{worker ? `${worker.items} done` : ''}</span>
              </div>
              <div className="mt-1 text-xs text-muted">
                {lease && worker?.task ? (
                  <>
                    Task{' '}
                    <Link className="underline" href={`/tasks/${worker.task}`}>
                      {short(worker.task)}
                    </Link>
                    , images {lease.lo}-{lease.hi - 1}
                  </>
                ) : (
                  'Idle'
                )}
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${progress * 100}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function Queue({ live }: { live: LiveSnapshot | null }) {
  if (!live) return null
  const now = Date.now()
  const tasks = [...live.tasks].sort((a, b) => a.deadline - b.deadline)
  return (
    <section>
      <h2 className="text-sm font-semibold">Queue, by deadline</h2>
      {tasks.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nothing waiting. Press the button.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {tasks.map((task) => {
            const late = task.deadline < now
            return (
              <li key={task.id} className="rounded-lg border border-line bg-surface p-3">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <Link href={`/tasks/${task.id}`} className="font-medium underline-offset-2 hover:underline">
                    Task {short(task.id)}
                  </Link>
                  <span className={`tabular text-xs ${late ? 'text-bad' : 'text-muted'}`}>{until(task.deadline, now)}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(task.done / task.items) * 100}%` }} />
                </div>
                <div className="tabular mt-1 text-xs text-muted">
                  {task.done} of {task.items} · {task.preset}
                  {task.dead > 0 ? ` · ${task.dead} dead-lettered` : ''}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

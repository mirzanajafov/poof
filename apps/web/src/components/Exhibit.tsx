'use client'

import Link from 'next/link'
import { useState } from 'react'
import { seconds, short } from '@/lib/format'
import { layoutLeases } from '@/lib/tree'
import type { ExhibitLease, ExhibitSnapshot } from '@/lib/types'

const choices = [
  {
    policy: 'box',
    title: 'The box',
    text: 'Splits once a task is past its deadline. No budget, no depth limit. This is the one that falls over.',
  },
  {
    policy: 'forecast',
    title: 'Forecast, no budget',
    text: 'Splits when the projected finish is past the deadline. Depth and fan-out limits, nothing global.',
  },
  {
    policy: 'forecast+budget',
    title: 'Forecast, with a budget',
    text: 'The same forecast inside a budget of two workers, with admission control and a breaker.',
  },
  {
    policy: 'forecast+preempt',
    title: 'Forecast, with preemption',
    text: 'Also splits into idle workers and makes the latest deadline yield. The closest a splitting policy gets to the pool.',
  },
]

export function ExhibitPanel({ exhibit, processes }: { exhibit: ExhibitSnapshot | null; processes: number[] }) {
  const [policy, setPolicy] = useState('box')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function start() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/exhibits', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ policy, durationSeconds: 60, dataset: 'synthetic', utilization: 1.2 }),
      })
      if (res.status !== 201) {
        const body = (await res.json().catch(() => ({}))) as { message?: string }
        const retry = res.headers.get('retry-after')
        setMessage(`${body.message ?? `Refused (${res.status})`}${retry ? `. Try again in ${retry} s.` : '.'}`)
      }
    } catch {
      setMessage('The box did not answer.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <h2 className="text-base font-semibold">Let a splitting policy run the box</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        For a minute the pool steps aside and a policy that gives each task its own workers takes over, with tasks arriving at
        1.2 times what the box can do. Workers that fall behind call helpers. Everything runs inside the box&apos;s limits: 1.5
        CPUs, 1.5 GB, 35 processes.
      </p>
      {exhibit ? (
        <ExhibitLive exhibit={exhibit} processes={processes} />
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {choices.map((choice) => (
              <label
                key={choice.policy}
                className={`cursor-pointer rounded-lg border p-3 text-sm transition ${policy === choice.policy ? 'border-accent bg-accent-soft' : 'border-line bg-raised hover:border-faint'}`}
              >
                <input
                  type="radio"
                  name="policy"
                  value={choice.policy}
                  checked={policy === choice.policy}
                  onChange={() => setPolicy(choice.policy)}
                  className="sr-only"
                />
                <span className="font-medium">{choice.title}</span>
                <span className="mt-1 block text-muted">{choice.text}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={start}
            disabled={busy}
            className="mt-4 rounded-lg bg-storm px-4 py-2 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Starting…' : 'Run it for a minute'}
          </button>
          {message && <p className="mt-3 rounded-md bg-warn-soft px-3 py-2 text-sm">{message}</p>}
        </>
      )}
    </section>
  )
}

function ExhibitLive({ exhibit, processes }: { exhibit: ExhibitSnapshot; processes: number[] }) {
  const left = Math.max(0, exhibit.endsAt - Date.now())
  const s = exhibit.stats
  const kills = Object.entries(s.exits)
    .filter(([reason]) => reason !== 'normal')
    .reduce((sum, [, n]) => sum + n, 0)
  const stats = [
    ['Processes now', String(exhibit.processes)],
    ['Peak', String(s.peakProcesses)],
    ['Tasks in / on time', `${s.submitted - s.rejected} / ${s.met}`],
    ['Turned away', String(s.rejected)],
    ['Spawns', String(s.spawns)],
    ['Splits', String(s.splits)],
    ['Workers killed', String(kills)],
    ['Deepest split', String(s.maxDepth)],
  ]
  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm">
          Running <span className="font-semibold">{exhibit.policy}</span> ·{' '}
          <span className="tabular text-muted">{seconds(left)} left</span>
        </p>
        <Link href={`/exhibits/${exhibit.id}`} className="text-xs text-accent-ink underline">
          Details
        </Link>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-line bg-raised px-3 py-2">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="tabular text-lg font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <Sparkline points={processes} budget={exhibit.budget} />
      <div>
        <h3 className="text-sm font-semibold">Who called whom</h3>
        <p className="text-xs text-muted">One tree per task. A child is a helper the parent called. Hover a node for its range.</p>
        <div className="mt-2 flex gap-4 overflow-x-auto pb-2">
          {exhibit.tasks.length === 0 && <p className="text-sm text-muted">No tasks yet.</p>}
          {exhibit.tasks.map((task) => (
            <figure key={task.id} className="shrink-0 rounded-lg border border-line bg-raised p-2">
              <figcaption className="tabular text-xs text-muted">
                {short(task.id)} · {task.done}/{task.items}
              </figcaption>
              <LeaseTree leases={task.leases} />
            </figure>
          ))}
        </div>
        <Legend />
      </div>
    </div>
  )
}

const stateClass: Record<ExhibitLease['state'], string> = {
  running: 'fill-accent',
  starting: 'fill-faint',
  pending: 'fill-raised stroke-faint',
  done: 'fill-good',
}

function LeaseTree({ leases }: { leases: ExhibitLease[] }) {
  const layout = layoutLeases(leases, 22, 30)
  const pad = 10
  const at = new Map(layout.nodes.map((n) => [n.lease.id, n]))
  return (
    <svg width={layout.width + pad * 2} height={layout.height + pad} role="img" aria-label={`${leases.length} leases`}>
      <g transform={`translate(${pad + 11},${pad})`}>
        {layout.edges.map((edge) => {
          const a = at.get(edge.from)!
          const b = at.get(edge.to)!
          return <line key={`${edge.from}-${edge.to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke-line" strokeWidth={1.5} />
        })}
        {layout.nodes.map(({ lease, x, y }) => (
          <circle key={lease.id} cx={x} cy={y} r={6} strokeWidth={1.5} className={stateClass[lease.state]}>
            <title>
              {`images ${lease.lo}-${lease.hi - 1}, ${lease.state}${lease.pid ? `, pid ${lease.pid}` : ''}`}
            </title>
          </circle>
        ))}
      </g>
    </svg>
  )
}

function Legend() {
  const items: Array<[string, string]> = [
    ['fill-accent', 'working'],
    ['fill-faint', 'starting'],
    ['fill-raised stroke-faint', 'waiting for a process'],
    ['fill-good', 'done'],
  ]
  return (
    <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted">
      {items.map(([cls, label]) => (
        <span key={label} className="flex items-center gap-1">
          <svg width={12} height={12} aria-hidden>
            <circle cx={6} cy={6} r={5} strokeWidth={1.5} className={cls} />
          </svg>
          {label}
        </span>
      ))}
    </div>
  )
}

function Sparkline({ points, budget }: { points: number[]; budget: number | null }) {
  const width = 600
  const height = 90
  const max = Math.max(4, budget ?? 0, ...points) * 1.15
  const x = (i: number) => (points.length <= 1 ? 0 : (i / (points.length - 1)) * width)
  const y = (v: number) => height - (v / max) * height
  const d = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return (
    <figure>
      <figcaption className="text-sm font-semibold">Live worker processes</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-1 h-24 w-full" preserveAspectRatio="none" role="img" aria-label="Processes over the run">
        <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} className="stroke-line" />
        <line x1={0} x2={width} y1={y(Math.round(max))} y2={y(Math.round(max))} className="stroke-line" vectorEffect="non-scaling-stroke" />
        {budget !== null && (
          <line x1={0} x2={width} y1={y(budget)} y2={y(budget)} className="stroke-muted" strokeDasharray="5 4" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        )}
        {points.length > 1 && <path d={d} className="fill-none stroke-storm" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
      </svg>
      <p className="text-xs text-muted">
        Top line: {Math.round(max)} processes. One point a second over the last two minutes{budget !== null ? `. Dashed: the budget of ${budget}.` : '. This policy has no budget.'}
      </p>
    </figure>
  )
}

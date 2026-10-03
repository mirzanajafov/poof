import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Refresh } from '@/components/Refresh'
import { api } from '@/lib/api'
import { seconds, short } from '@/lib/format'
import type { ExhibitStats } from '@/lib/types'

interface ExhibitDetail {
  id: string
  policy: string
  status: string
  startedAt: string
  endedAt: string | null
  params: { durationSeconds: number; utilization: number; dataset: string; seed: number }
  stats: ExhibitStats | null
  tasks: Array<{ id: string; status: string; items: number; done: number; submittedAt: string; deadline: string; finishedAt: string | null }>
}

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: `Exhibit ${short((await params).id)}` }
}

export default async function ExhibitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const exhibit = await api<ExhibitDetail>(`/exhibits/${id}`)
  if (!exhibit) notFound()
  const s = exhibit.stats
  const kills = s ? Object.entries(s.exits).filter(([r]) => r !== 'normal') : []
  const killWords: Record<string, string> = {
    killed: 'stopped when the run ended',
    timeout: 'by the item timeout',
    memory: 'by the memory limit',
    heartbeat: 'for going silent',
    crash: 'crashed',
  }
  return (
    <div className="space-y-6">
      {exhibit.status === 'RUNNING' && <Refresh every={3000} />}
      <header>
        <p className="text-sm text-muted">
          {exhibit.params.durationSeconds} s · arrivals at {exhibit.params.utilization}× capacity · {exhibit.params.dataset} · seed{' '}
          {exhibit.params.seed}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Exhibit: {exhibit.policy} <span className="text-base font-normal text-muted">({exhibit.status.toLowerCase()})</span>
        </h1>
      </header>
      {s ? (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Tasks submitted', s.submitted],
            ['Turned away', s.rejected],
            ['On time', s.met],
            ['Cancelled at the end', s.cancelled],
            ['Peak processes', s.peakProcesses],
            ['Spawns', s.spawns],
            ['Splits', s.splits],
            ['Images done', s.items],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-line bg-surface px-3 py-3">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="tabular mt-1 text-lg font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted">Still running. The numbers land here when it ends.</p>
      )}
      {kills.length > 0 && (
        <p className="text-sm">
          Workers killed:{' '}
          {kills.map(([reason, n]) => (
            <span key={reason} className="mr-3">
              {n} {killWords[reason] ?? reason}
            </span>
          ))}
        </p>
      )}
      <section>
        <h2 className="text-sm font-semibold">Tasks</h2>
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface text-sm">
          {exhibit.tasks.map((task) => {
            const allowed = new Date(task.deadline).getTime() - new Date(task.submittedAt).getTime()
            const took = task.finishedAt ? new Date(task.finishedAt).getTime() - new Date(task.submittedAt).getTime() : null
            return (
              <li key={task.id} className="tabular flex flex-wrap justify-between gap-2 px-3 py-2">
                <Link href={`/tasks/${task.id}`} className="underline">
                  {short(task.id)}
                </Link>
                <span className="text-muted">
                  {task.status === 'FAILED' ? 'stopped' : task.status.toLowerCase()} · {task.done}/{task.items} · allowed {seconds(allowed)}
                  {took !== null ? ` · ${task.status === 'FAILED' ? 'stopped after' : 'took'} ${seconds(took)}` : ''}
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

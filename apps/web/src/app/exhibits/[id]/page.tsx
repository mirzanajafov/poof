import type { ExhibitDetail } from '@poof/contracts'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Refresh } from '@/components/Refresh'
import { Stats } from '@/components/Stats'
import { getJson } from '@/lib/api'
import { exitCounts, exitWords, seconds, shortId } from '@/lib/format'
import { isUuid } from '@/lib/ids'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: `Exhibit ${shortId((await params).id)}` }
}

export default async function ExhibitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const exhibit = await getJson<ExhibitDetail>(`/exhibits/${id}`)
  if (!exhibit) notFound()
  const s = exhibit.stats
  const exits = s ? exitCounts(s.exits) : []
  return (
    <div className="space-y-6">
      {exhibit.status === 'RUNNING' && <Refresh every={3000} />}
      <header>
        <p className="text-sm text-muted">
          {exhibit.params.durationSeconds} s · arrivals at {exhibit.params.utilization}× capacity ·{' '}
          {exhibit.params.dataset} · seed {exhibit.params.seed}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Exhibit: {exhibit.policy}{' '}
          <span className="text-base font-normal text-muted">({exhibit.status.toLowerCase()})</span>
        </h1>
      </header>
      {s ? (
        <Stats
          items={[
            ['Tasks submitted', s.submitted],
            ['Turned away', s.rejected],
            ['On time', s.met],
            ['Cancelled at the end', s.cancelled],
            ['Peak processes', s.peakProcesses],
            ['Spawns', s.spawns],
            ['Splits', s.splits],
            ['Images done', s.items],
          ]}
        />
      ) : (
        <p className="text-sm text-muted">Still running. The numbers land here when it ends.</p>
      )}
      {exits.length > 0 && (
        <p className="text-sm">
          How workers ended:{' '}
          {exits.map(({ reason, count }) => (
            <span key={reason} className="mr-3">
              {count} {exitWords[reason]}
            </span>
          ))}
        </p>
      )}
      <section>
        <h2 className="text-sm font-semibold">Tasks</h2>
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface text-sm">
          {exhibit.tasks.map((task) => {
            const allowed = new Date(task.deadline).getTime() - new Date(task.submittedAt).getTime()
            const took = task.finishedAt
              ? new Date(task.finishedAt).getTime() - new Date(task.submittedAt).getTime()
              : null
            return (
              <li key={task.id} className="tabular flex flex-wrap justify-between gap-2 px-3 py-2">
                <Link href={`/tasks/${task.id}`} className="underline">
                  {shortId(task.id)}
                </Link>
                <span className="text-muted">
                  {task.status === 'FAILED' ? 'stopped' : task.status.toLowerCase()} · {task.done}/{task.items} ·
                  allowed {seconds(allowed)}
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

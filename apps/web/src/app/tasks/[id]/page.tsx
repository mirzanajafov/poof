import type { TaskDetail, TaskStatus } from '@poof/contracts'
import type { Metadata } from 'next'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { Elapsed } from '@/components/Elapsed'
import { Refresh } from '@/components/Refresh'
import { Stats } from '@/components/Stats'
import { api } from '@/lib/api'
import { seconds, short } from '@/lib/format'
import { isUuid } from '@/lib/ids'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: `Task ${short((await params).id)}` }
}

const statusTone: Record<TaskStatus, string> = {
  DONE: 'bg-good-soft',
  RUNNING: 'bg-accent-soft',
  QUEUED: 'bg-accent-soft',
  FAILED: 'bg-bad-soft',
  REJECTED: 'bg-warn-soft',
}

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const task = await api<TaskDetail>(`/tasks/${id}`)
  if (!task) notFound()
  const submitted = new Date(task.submittedAt).getTime()
  const deadline = new Date(task.deadline).getTime()
  const finished = task.finishedAt ? new Date(task.finishedAt).getTime() : null
  const running = task.status === 'RUNNING' || task.status === 'QUEUED'
  const dead = new Set(task.deadLetters.map((d) => d.item))
  const shown = Math.min(task.items, 60)
  return (
    <div className="space-y-6">
      {running && <Refresh every={2000} />}
      <header>
        <p className="text-sm text-muted">
          {task.dataset} · {task.preset} · {task.policy}
        </p>
        <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
          Task {short(task.id)}
          <span className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${statusTone[task.status]}`}>
            {task.status.toLowerCase()}
          </span>
        </h1>
      </header>
      <Stats
        items={[
          ['Images', `${task.done} / ${task.items}`],
          ['Predicted work', seconds(task.predictedMs)],
          ['Allowed', seconds(deadline - submitted)],
          finished
            ? ['Took', `${seconds(finished - submitted)}${finished <= deadline ? ', on time' : ', late'}`]
            : ['Running for', <Elapsed key="elapsed" since={submitted} />],
        ]}
      />
      {task.status !== 'REJECTED' && (
        <section>
          <h2 className="text-sm font-semibold">Results</h2>
          <p className="text-xs text-muted">
            The first {shown} images. Each one is resized and re-encoded by whichever worker had that chunk. Results are
            kept for 24 hours.
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-10">
            {Array.from({ length: shown }, (_, i) => {
              const ready = task.leases.some((l) => i >= l.lo && i < l.cursor) && !dead.has(i)
              return ready ? (
                <a key={i} href={`/api/tasks/${task.id}/items/${i}`} target="_blank" rel="noreferrer" className="block">
                  <Image
                    src={`/api/tasks/${task.id}/items/${i}`}
                    alt={`Result ${i}`}
                    width={160}
                    height={160}
                    unoptimized
                    className="aspect-square w-full rounded-md border border-line object-cover"
                  />
                </a>
              ) : (
                <div
                  key={i}
                  className={`flex aspect-square items-center justify-center rounded-md border text-xs ${dead.has(i) ? 'border-bad bg-bad-soft text-bad' : 'border-line bg-surface text-faint'}`}
                >
                  {dead.has(i) ? 'dead' : i}
                </div>
              )
            })}
          </div>
        </section>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section>
          <h2 className="text-sm font-semibold">Leases</h2>
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface text-sm">
            {task.leases.length === 0 && <li className="p-3 text-muted">None: the task never ran.</li>}
            {task.leases.map((lease) => (
              <li
                key={lease.id}
                className="tabular flex justify-between gap-2 px-3 py-2"
                style={{ paddingLeft: `${12 + lease.depth * 16}px` }}
              >
                <span>
                  images {lease.lo}-{lease.hi - 1}
                </span>
                <span className="text-muted">
                  {lease.state.toLowerCase()} · {lease.cursor - lease.lo}/{lease.hi - lease.lo}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="text-sm font-semibold">Dead letters and decisions</h2>
          <ul className="mt-2 space-y-1 rounded-lg border border-line bg-surface p-3 text-sm">
            {task.deadLetters.length === 0 && task.decisions.length === 0 && (
              <li className="text-muted">Nothing went wrong.</li>
            )}
            {task.deadLetters.map((d) => (
              <li key={`dead-${d.item}`}>
                Image {d.item} dead-lettered after {d.attempts} tries: <span className="text-muted">{d.error}</span>
              </li>
            ))}
            {task.decisions.map((d) => (
              <li key={d.id} className="text-muted">
                <span className="tabular text-faint">{new Date(d.at).toLocaleTimeString([], { hour12: false })}</span>{' '}
                {d.kind} {JSON.stringify(d.detail)}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

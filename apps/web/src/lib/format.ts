import { exitReasons, type ExhibitStats, type ExitReason, type LiveEvent } from '@poof/contracts'

export function short(id: string): string {
  return id.slice(0, 6)
}

export function seconds(ms: number): string {
  const s = Math.abs(ms) / 1000
  if (s < 10) return `${s.toFixed(1)} s`
  if (s < 120) return `${Math.round(s)} s`
  return `${Math.round(s / 60)} min`
}

export function until(deadline: number, now: number): string {
  const left = deadline - now
  return left >= 0 ? `due in ${seconds(left)}` : `${seconds(left)} late`
}

export const exitWords: Record<ExitReason, string> = {
  crash: 'crashed',
  memory: 'killed for using too much memory',
  timeout: 'killed because an item took too long',
  heartbeat: 'killed for going silent',
  killed: 'stopped',
  normal: 'retired',
}

export function exitCounts(exits: ExhibitStats['exits']): Array<{ reason: ExitReason; count: number }> {
  return exitReasons.flatMap((reason) => {
    const count = exits[reason] ?? 0
    return count > 0 ? [{ reason, count }] : []
  })
}

export function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function range(lo: number, hi: number): string {
  const last = hi - 1
  return lo === last ? `image ${lo}` : `images ${lo}-${last}`
}

export function describe(event: LiveEvent): string | null {
  switch (event.kind) {
    case 'task.accepted':
      return `Task ${short(event.task)} accepted: ${event.items} images, ${until(event.deadline, event.at)}`
    case 'task.rejected':
      return event.exhibit
        ? `Task ${short(event.task)} turned away at the door`
        : `Task ${short(event.task)} turned away: it cannot make its deadline behind the current queue`
    case 'task.done':
      return `Task ${short(event.task)} done${event.met ? ', on time' : ', late'}${event.dead > 0 ? `, ${event.dead} images dead-lettered` : ''}`
    case 'task.failed':
      return `Task ${short(event.task)} failed: ${event.reason}`
    case 'lease.claimed':
      return `A worker took ${range(event.lo, event.hi)} of task ${short(event.task)}`
    case 'lease.created':
      return event.depth > 0 ? `Task ${short(event.task)} split: a helper got ${range(event.lo, event.hi)}` : null
    case 'item.dead':
      return `Image ${event.item} of task ${short(event.task)} dead-lettered after ${event.attempts} tries`
    case 'worker.spawned':
      return `Worker ${event.pid} started`
    case 'worker.exit':
      return event.reason === 'normal' ? null : `A worker exited: ${exitWords[event.reason]}`
    case 'breaker':
      return `Breaker for ${event.preset} is now ${event.state}`
    case 'exhibit.started':
      return `Exhibit started: ${event.policy}`
    case 'exhibit.ended':
      return `Exhibit ${event.status === 'ABORTED' ? 'aborted' : 'over'}`
    case 'item':
      return null
  }
}

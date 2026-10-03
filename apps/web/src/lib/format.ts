import type { LiveEvent } from './types'

export function short(id: unknown): string {
  return typeof id === 'string' ? id.slice(0, 6) : '?'
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

const exitWords: Record<string, string> = {
  crash: 'crashed',
  memory: 'was killed for using too much memory',
  timeout: 'was killed: an item took too long',
  heartbeat: 'went silent and was killed',
  killed: 'was stopped',
  normal: 'retired',
}

function range(lo: unknown, hi: unknown): string {
  const first = Number(lo)
  const last = Number(hi) - 1
  return first === last ? `image ${first}` : `images ${first}-${last}`
}

export function describe(event: LiveEvent): string | null {
  const task = short(event.task)
  switch (event.kind) {
    case 'task.accepted':
      return `Task ${task} accepted: ${event.items} images, ${until(Number(event.deadline), event.at)}`
    case 'task.rejected':
      return event.exhibit
        ? `Task ${task} turned away at the door`
        : `Task ${task} turned away: it cannot make its deadline behind the current queue`
    case 'task.done':
      return `Task ${task} done${event.met ? ', on time' : ', late'}${Number(event.dead) > 0 ? `, ${event.dead} images dead-lettered` : ''}`
    case 'task.failed':
      return `Task ${task} failed: ${event.reason}`
    case 'lease.claimed':
      return `A worker took ${range(event.lo, event.hi)} of task ${task}`
    case 'lease.created':
      return Number(event.depth) > 0 ? `Task ${task} split: a helper got ${range(event.lo, event.hi)}` : null
    case 'item.dead':
      return `Image ${event.item} of task ${task} dead-lettered after ${event.attempts} tries`
    case 'worker.spawned':
      return `Worker ${event.pid} started`
    case 'worker.exit':
      return event.reason === 'normal' ? null : `A worker ${exitWords[String(event.reason)] ?? String(event.reason)}`
    case 'breaker':
      return `Breaker for ${event.preset} is now ${event.state}`
    case 'exhibit.started':
      return `Exhibit started: ${event.policy}`
    case 'exhibit.ended':
      return `Exhibit ${event.status === 'ABORTED' ? 'aborted' : 'over'}`
    default:
      return null
  }
}

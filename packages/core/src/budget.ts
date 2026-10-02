import { finishMs } from './split.ts'
import type { SplitRequest } from './types.ts'

export interface StartRequest {
  leaseId: string
  deadline: number
}

export interface RunningLease {
  leaseId: string
  deadline: number
  remaining: number
}

export interface Grants {
  starts: string[]
  splits: Map<string, number>
  preempt: string[]
}

export interface Preemption {
  running: readonly RunningLease[]
  yielding: number
  minRemaining: number
}

interface Candidate {
  deadline: number
  rank: number
  start?: StartRequest
  split?: SplitRequest
}

const URGENT = 0
const SPARE = 1
const LOST = 2

export function lostCause(split: SplitRequest, spawnMs: number, fanout: number): boolean {
  return split.timeLeftMs <= 0 || finishMs(split.remaining, split.itemMs, spawnMs, fanout) > split.timeLeftMs
}

export function allocate(
  free: number,
  starts: readonly StartRequest[],
  splits: readonly SplitRequest[],
  now: number,
  spawnMs: number,
  fanout: number,
  preemption?: Preemption,
): Grants {
  const splitRank = (split: SplitRequest) =>
    split.opportunistic ? SPARE : lostCause(split, spawnMs, fanout) ? LOST : URGENT
  const candidates: Candidate[] = [
    ...starts.map((start) => ({ deadline: start.deadline, rank: start.deadline <= now ? LOST : URGENT, start })),
    ...splits.map((split) => ({ deadline: split.deadline, rank: splitRank(split), split })),
  ]
  candidates.sort((a, b) => a.rank - b.rank || a.deadline - b.deadline || Number(!a.start) - Number(!b.start))
  const grants: Grants = { starts: [], splits: new Map(), preempt: [] }
  const waiting: Candidate[] = []
  for (const candidate of candidates) {
    if (free <= 0) {
      waiting.push(candidate)
      continue
    }
    if (candidate.start) {
      grants.starts.push(candidate.start.leaseId)
      free--
    } else if (candidate.split) {
      const k = Math.min(candidate.split.k, free)
      grants.splits.set(candidate.split.leaseId, k)
      free -= k
    }
  }
  if (preemption) grants.preempt = preempt(waiting, preemption)
  return grants
}

function preempt(waiting: readonly Candidate[], preemption: Preemption): string[] {
  const victims = preemption.running
    .filter((lease) => lease.remaining >= preemption.minRemaining)
    .sort((a, b) => b.deadline - a.deadline)
  let yielding = preemption.yielding
  const chosen: string[] = []
  for (const candidate of waiting) {
    if (candidate.rank !== URGENT) break
    if (yielding > 0) {
      yielding--
      continue
    }
    const victim = victims[chosen.length]
    if (!victim || victim.deadline <= candidate.deadline) break
    chosen.push(victim.leaseId)
  }
  return chosen
}

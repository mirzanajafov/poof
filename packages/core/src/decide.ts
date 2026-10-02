import { upperMean } from './estimate.ts'
import { chooseK, finishMs } from './split.ts'
import type { LeaseInfo, PolicyConfig, SplitRequest, TaskInfo, View } from './types.ts'

export interface Pain {
  pain: number
  remainingMs: number
  itemMs: number
}

export function pain(config: PolicyConfig, task: TaskInfo, lease: LeaseInfo, now: number): Pain {
  const remaining = lease.hi - lease.next
  const estimated = upperMean(lease.itemMs, config.z)
  const remainingMs =
    config.trigger === 'oracle' && lease.trueRemainingMs !== undefined ? lease.trueRemainingMs : remaining * estimated
  const allowed = task.deadline - task.submittedAt
  const elapsed = now - task.submittedAt
  const value = config.trigger === 'timer' ? elapsed / allowed : (elapsed + remainingMs) / allowed
  return { pain: value, remainingMs, itemMs: remaining > 0 ? remainingMs / remaining : estimated }
}

function eligible(config: PolicyConfig, view: View, task: TaskInfo, lease: LeaseInfo): boolean {
  if (lease.state !== 'running' || lease.depth >= config.maxDepth) return false
  if (config.breaker && (view.breakers.get(task.type) ?? 'closed') !== 'closed') return false
  if (lease.lastSplitAt !== null && view.now - lease.lastSplitAt < config.cooldownMs) return false
  if (lease.startedAt === null || view.now - lease.startedAt < config.warmupMs) return false
  return lease.itemsDone >= config.warmupItems && lease.hi - lease.next >= 2
}

export function decide(view: View, config: PolicyConfig): SplitRequest[] {
  if (config.trigger === 'none' || view.killSwitch) return []
  const requests: SplitRequest[] = []
  for (const lease of view.leases) {
    const task = view.tasks.get(lease.taskId)
    if (!task || !eligible(config, view, task, lease)) continue
    const current = pain(config, task, lease, view.now)
    const fires = config.trigger === 'timer' ? current.pain >= config.threshold : current.pain > config.threshold
    if (!fires && !config.greedy) continue
    const remaining = lease.hi - lease.next
    const timeLeftMs = task.deadline - view.now
    const k = fires
      ? chooseK(remaining, current.itemMs, view.spawnMs, timeLeftMs, config.fanout, config.margin)
      : config.fanout
    if (finishMs(remaining, current.itemMs, view.spawnMs, k) >= current.remainingMs - view.spawnMs) continue
    if (!fires && remaining < 2 * config.warmupItems) continue
    requests.push({
      leaseId: lease.id,
      taskId: task.id,
      deadline: task.deadline,
      k,
      remaining,
      pain: current.pain,
      projectedMs: view.now - task.submittedAt + current.remainingMs,
      timeLeftMs,
      itemMs: current.itemMs,
      opportunistic: !fires,
    })
  }
  return requests
}

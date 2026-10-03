import { readdirSync, readFileSync } from 'node:fs'

interface Seen {
  cmd: string
  base: number
  last: number
  states: Record<string, number>
}

const seconds = Number(process.argv[2] ?? 60)
const everyMs = Number(process.argv[3] ?? 200)

function cgroup(): Record<string, number> {
  return Object.fromEntries(
    readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8')
      .trim()
      .split('\n')
      .map((line) => line.split(' '))
      .map(([k, v]) => [k!, Number(v)]),
  )
}

function afterName(stat: string): string[] {
  return stat.slice(stat.lastIndexOf(')') + 2).split(' ')
}

function activity(pid: string): string {
  let result = 'idle'
  for (const tid of readdirSync(`/proc/${pid}/task`)) {
    const state = afterName(readFileSync(`/proc/${pid}/task/${tid}/stat`, 'utf8'))[0]
    if (state === 'R') return 'runnable'
    if (state === 'D') result = 'disk'
  }
  return result
}

const seen = new Map<string, Seen>()
let first = true

function sample(): void {
  for (const pid of readdirSync('/proc')) {
    if (!/^\d+$/.test(pid) || Number(pid) === process.pid) continue
    try {
      const fields = afterName(readFileSync(`/proc/${pid}/stat`, 'utf8'))
      const cpuMs = (Number(fields[11]) + Number(fields[12])) * 10
      let entry = seen.get(pid)
      if (!entry) {
        const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim()
        entry = { cmd, base: first ? cpuMs : 0, last: cpuMs, states: {} }
        seen.set(pid, entry)
      }
      entry.last = cpuMs
      const state = activity(pid)
      entry.states[state] = (entry.states[state] ?? 0) + 1
    } catch {
      continue
    }
  }
  first = false
}

const start = cgroup()
const startedAt = Date.now()
sample()
const timer = setInterval(sample, everyMs)
setTimeout(() => {
  clearInterval(timer)
  sample()
  const end = cgroup()
  const groups: Record<string, { processes: number; cpuMs: number; states: Record<string, number> }> = {}
  for (const entry of seen.values()) {
    const kind = entry.cmd.includes('dist/main.js') ? 'supervisor' : entry.cmd.includes('worker') ? 'workers' : 'other'
    const group = (groups[kind] ??= { processes: 0, cpuMs: 0, states: {} })
    group.processes++
    group.cpuMs += entry.last - entry.base
    for (const [state, n] of Object.entries(entry.states)) group.states[state] = (group.states[state] ?? 0) + n
  }
  const self = process.cpuUsage()
  console.log(
    JSON.stringify({
      wallMs: Date.now() - startedAt,
      everyMs,
      groups,
      samplerCpuMs: Math.round((self.user + self.system) / 1000),
      cgroup: {
        usageMs: Math.round((end.usage_usec! - start.usage_usec!) / 1000),
        throttledMs: Math.round((end.throttled_usec! - start.throttled_usec!) / 1000),
        periods: end.nr_periods! - start.nr_periods!,
        throttledPeriods: end.nr_throttled! - start.nr_throttled!,
      },
    }),
  )
}, seconds * 1000)

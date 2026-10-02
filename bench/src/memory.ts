import { readFileSync, writeFileSync } from 'node:fs'

const linux = process.platform === 'linux'

export function resetPeakRss(): void {
  if (linux) writeFileSync('/proc/self/clear_refs', '5')
}

export function peakRssMb(): number {
  if (linux) {
    const match = /VmHWM:\s+(\d+) kB/.exec(readFileSync('/proc/self/status', 'utf8'))
    if (match) return Number(match[1]) / 1024
  }
  return process.resourceUsage().maxRSS / 1024
}

export function rssMb(): number {
  return process.memoryUsage.rss() / 1024 / 1024
}

export function cpuMsSince(start: NodeJS.CpuUsage): number {
  const used = process.cpuUsage(start)
  return (used.user + used.system) / 1000
}

export function cgroupAnonMb(): number | null {
  if (!linux) return null
  try {
    const match = /^anon (\d+)$/m.exec(readFileSync('/sys/fs/cgroup/memory.stat', 'utf8'))
    return match ? Number(match[1]) / 1024 / 1024 : null
  } catch {
    return null
  }
}

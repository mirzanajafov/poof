import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import type { Sample } from './engine.ts'
import type { Cell } from './report.ts'
import { scenarios } from './scenarios.ts'

const style = `
  .surface { fill: #fcfcfb }
  .ink { fill: #0b0b0b }
  .ink-2 { fill: #52514e }
  .muted { fill: #898781 }
  .grid { stroke: #e1e0d9; stroke-width: 1 }
  .axis { stroke: #c3c2b7; stroke-width: 1 }
  .band { fill: #f0efec }
  .other { fill: #898781; stroke: #898781 }
  .s1 { fill: #2a78d6; stroke: #2a78d6 }
  .s2 { fill: #eb6834; stroke: #eb6834 }
  .s3 { fill: #1baf7a; stroke: #1baf7a }
  .s4 { fill: #eda100; stroke: #eda100 }
  .line { fill: none; stroke-width: 2; stroke-linejoin: round }
  .ref { fill: none; stroke: #52514e; stroke-width: 1.5; stroke-dasharray: 5 4 }
  text { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 12px }
  .title { font-size: 14px; font-weight: 600 }
  .small { font-size: 11px }
  @media (prefers-color-scheme: dark) {
    .surface { fill: #1a1a19 }
    .ink { fill: #ffffff }
    .ink-2 { fill: #c3c2b7 }
    .grid { stroke: #2c2c2a }
    .axis { stroke: #383835 }
    .band { fill: #262624 }
    .s1 { fill: #3987e5; stroke: #3987e5 }
    .s2 { fill: #d95926; stroke: #d95926 }
    .s3 { fill: #199e70; stroke: #199e70 }
    .s4 { fill: #c98500; stroke: #c98500 }
    .ref { stroke: #c3c2b7 }
  }
`

function svg(width: number, height: number, body: string[]): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<style>${style}</style>`,
    `<rect class="surface" width="${width}" height="${height}" rx="8"/>`,
    ...body,
    '</svg>',
  ].join('\n')
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const highlight = 'forecast+budget'

export function hitRateChart(cells: readonly Cell[], machine: string, policies: readonly string[], title: string): string {
  const names = Object.keys(scenarios).filter((s) => cells.some((c) => c.machine === machine && c.scenario === s))
  const labelWidth = 130
  const panel = 118
  const gap = 34
  const top = 64
  const row = 26
  const width = labelWidth + names.length * (panel + gap) + 8
  const height = top + policies.length * row + 40
  const body: string[] = [
    `<text class="ink title" x="16" y="24">${escape(title)}</text>`,
    `<text class="ink-2 small" x="16" y="42">Share of submitted tasks finished by their deadline, mean and 95% interval over seeds. Rejected tasks count as misses.</text>`,
  ]
  policies.forEach((policy, i) => {
    const y = top + i * row + row / 2
    const cls = policy === highlight ? 'ink' : 'ink-2'
    body.push(`<text class="${cls}" x="${labelWidth - 10}" y="${y + 4}" text-anchor="end">${escape(policy)}</text>`)
  })
  names.forEach((scenario, p) => {
    const x0 = labelWidth + p * (panel + gap)
    const x = (value: number) => x0 + value * panel
    body.push(`<text class="ink" x="${x0 + panel / 2}" y="${top - 8}" text-anchor="middle">${scenario}</text>`)
    for (const tick of [0, 0.5, 1]) {
      body.push(`<line class="grid" x1="${x(tick)}" x2="${x(tick)}" y1="${top}" y2="${top + policies.length * row}"/>`)
      body.push(`<text class="muted small" x="${x(tick)}" y="${top + policies.length * row + 16}" text-anchor="middle">${tick * 100}%</text>`)
    }
    policies.forEach((policy, i) => {
      const cell = cells.find((c) => c.machine === machine && c.scenario === scenario && c.policy === policy)
      if (!cell) return
      const y = top + i * row + row / 2
      const cls = policy === highlight ? 's1' : 'other'
      body.push(`<line class="${cls}" x1="${x(cell.hitRate.lo)}" x2="${x(cell.hitRate.hi)}" y1="${y}" y2="${y}" stroke-width="2" stroke-linecap="round"/>`)
      body.push(`<circle class="${cls}" cx="${x(cell.hitRate.mean)}" cy="${y}" r="4.5" stroke="none"/>`)
    })
  })
  return svg(width, height, body)
}

interface Line {
  policy: string
  cls: string
  samples: Sample[]
}

export function timelineChart(
  lines: readonly Line[],
  value: (s: Sample) => number,
  options: { title: string; subtitle: string; from: number; to: number; event: { from: number; to: number; label: string }; reference?: { value: number; label: string }; format: (v: number) => string },
): string {
  const width = 760
  const height = 330
  const left = 56
  const right = 150
  const top = 64
  const bottom = 40
  const plotW = width - left - right
  const plotH = height - top - bottom
  const visible = lines.map((l) => ({ ...l, samples: l.samples.filter((s) => s.t >= options.from && s.t <= options.to) }))
  const max = Math.max(options.reference?.value ?? 0, ...visible.flatMap((l) => l.samples.map(value)))
  const yMax = niceMax(max)
  const x = (t: number) => left + ((t - options.from) / (options.to - options.from)) * plotW
  const y = (v: number) => top + plotH - (v / yMax) * plotH
  const body: string[] = [
    `<text class="ink title" x="16" y="24">${escape(options.title)}</text>`,
    `<text class="ink-2 small" x="16" y="42">${escape(options.subtitle)}</text>`,
    `<rect class="band" x="${x(options.event.from)}" y="${top}" width="${x(options.event.to) - x(options.event.from)}" height="${plotH}"/>`,
    `<text class="ink-2 small" x="${(x(options.event.from) + x(options.event.to)) / 2}" y="${top - 8}" text-anchor="middle">${escape(options.event.label)}</text>`,
  ]
  for (let i = 0; i <= 4; i++) {
    const v = (yMax * i) / 4
    body.push(`<line class="grid" x1="${left}" x2="${left + plotW}" y1="${y(v)}" y2="${y(v)}"/>`)
    body.push(`<text class="muted small" x="${left - 8}" y="${y(v) + 4}" text-anchor="end">${options.format(v)}</text>`)
  }
  const minute = 60_000
  for (let t = Math.ceil(options.from / (5 * minute)) * 5 * minute; t <= options.to; t += 5 * minute) {
    body.push(`<text class="muted small" x="${x(t)}" y="${top + plotH + 18}" text-anchor="middle">${t / minute} min</text>`)
  }
  body.push(`<line class="axis" x1="${left}" x2="${left + plotW}" y1="${top + plotH}" y2="${top + plotH}"/>`)
  const labels: Array<{ y: number; text: string; cls: string | null }> = []
  if (options.reference) {
    const ry = y(options.reference.value)
    body.push(`<line class="ref" x1="${left}" x2="${left + plotW}" y1="${ry}" y2="${ry}"/>`)
    labels.push({ y: ry, text: options.reference.label, cls: null })
  }
  for (const line of visible) {
    if (line.samples.length === 0) continue
    const d = line.samples.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(s.t).toFixed(1)},${y(value(s)).toFixed(1)}`).join(' ')
    body.push(`<path class="line ${line.cls}" style="fill:none" d="${d}"/>`)
    labels.push({ y: y(value(line.samples[line.samples.length - 1]!)), text: line.policy, cls: line.cls })
  }
  labels.sort((a, b) => a.y - b.y)
  for (let i = 1; i < labels.length; i++) labels[i]!.y = Math.max(labels[i]!.y, labels[i - 1]!.y + 15)
  const floor = top + plotH + 6
  for (let i = labels.length - 1; i >= 0; i--) {
    const limit = i === labels.length - 1 ? floor : labels[i + 1]!.y - 15
    labels[i]!.y = Math.min(labels[i]!.y, limit)
  }
  for (const label of labels) {
    const ly = label.y
    if (label.cls) {
      body.push(`<circle class="${label.cls}" cx="${left + plotW + 10}" cy="${ly}" r="4" stroke="none"/>`)
      body.push(`<text class="ink small" x="${left + plotW + 20}" y="${ly + 4}">${escape(label.text)}</text>`)
    } else {
      body.push(`<text class="ink-2 small" x="${left + plotW + 20}" y="${ly + 4}">${escape(label.text)}</text>`)
    }
  }
  return svg(width, height, body)
}

function smoothed(lines: readonly Line[], window: number): Line[] {
  return lines.map((line) => ({
    ...line,
    samples: line.samples.map((sample, i) => {
      const from = Math.max(0, i - window + 1)
      const slice = line.samples.slice(from, i + 1)
      return { ...sample, goodput: slice.reduce((sum, s) => sum + s.goodput, 0) / slice.length }
    }),
  }))
}

function niceMax(value: number): number {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (step * magnitude >= value) return step * magnitude
  return 10 * magnitude
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  const { values } = parseArgs({
    options: {
      label: { type: 'string', default: 'dev-linux' },
      machine: { type: 'string', default: 'cage' },
      dir: { type: 'string' },
    },
  })
  const dir = values.dir ?? fileURLToPath(new URL(`../results/${values.label}/`, import.meta.url))
  const summary = JSON.parse(await readFile(join(dir, 'summary.json'), 'utf8')) as { cells: Cell[] }
  const series = JSON.parse(await readFile(join(dir, 'raw', 'series.json'), 'utf8')) as Array<{
    machine: string
    scenario: string
    policy: string
    samples: Sample[]
  }>
  const machine = values.machine!
  const policies = ['never', 'static-4', 'pool-10', 'box', 'timer+budget', 'forecast', 'forecast+budget', 'perfect', 'forecast+idle', 'forecast+preempt']
  await writeFile(join(dir, `hit-rate-${machine}.svg`), hitRateChart(summary.cells, machine, policies, `Deadline hit rate by policy (${machine})`))
  const burst = scenarios.burst!.burst!
  const picks: Array<[string, string]> = [
    ['forecast+budget', 's1'],
    ['box', 's2'],
    ['pool-10', 's3'],
    ['forecast+preempt', 's4'],
  ]
  const lines = picks
    .map(([policy, cls]) => ({ policy, cls, samples: series.find((s) => s.machine === machine && s.scenario === 'burst' && s.policy === policy)?.samples ?? [] }))
    .filter((l) => l.samples.length > 0)
  const budget = summary.cells.find((c) => c.machine === machine && c.policy === highlight)?.budget ?? 0
  const window = { from: burst.from - 5 * 60_000, to: burst.to + 15 * 60_000, event: { ...burst, label: 'burst: arrivals at 1.5× capacity' } }
  await writeFile(
    join(dir, `burst-processes-${machine}.svg`),
    timelineChart(lines, (s) => s.processes, {
      ...window,
      title: `Live worker processes during a burst (${machine}, seed 1)`,
      subtitle: 'Processes alive each second, including ones still starting.',
      reference: { value: budget, label: `budget ${budget}` },
      format: (v) => v.toFixed(0),
    }),
  )
  await writeFile(
    join(dir, `burst-goodput-${machine}.svg`),
    timelineChart(smoothed(lines, 15), (s) => s.goodput, {
      ...window,
      title: `Goodput during a burst (${machine}, seed 1)`,
      subtitle: 'Useful image work finished, as a share of the cores, 15 s rolling mean. Spawns, killed work and retries do not count.',
      format: (v) => `${Math.round(v * 100)}%`,
    }),
  )
  console.log(`wrote charts to ${dir}`)
}

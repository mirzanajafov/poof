import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Results' }
export const dynamic = 'force-static'

interface Cell {
  machine: string
  scenario: string
  policy: string
  budget: number
  hitRate: { mean: number; lo: number; hi: number }
  spawnsPerTask: number
}

const results = join(process.cwd(), '..', '..', 'packages', 'sim', 'results', 'server')
const policies = ['never', 'static-4', 'pool-10', 'timer+budget', 'forecast+budget', 'forecast+preempt', 'box', 'forecast']
const scenarios = ['calm', 'skew', 'neighbour', 'burst', 'poison']

async function svg(name: string): Promise<string> {
  return readFile(join(results, name), 'utf8')
}

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`
}

export default async function Results() {
  const summary = JSON.parse(await readFile(join(results, 'summary.json'), 'utf8')) as { cells: Cell[] }
  const charts = await Promise.all(['hit-rate-cage.svg', 'burst-processes-cage.svg', 'burst-goodput-cage.svg'].map(svg))
  const cell = (machine: string, scenario: string, policy: string) =>
    summary.cells.find((c) => c.machine === machine && c.scenario === scenario && c.policy === policy)
  return (
    <article className="space-y-6">
      <header className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">What the simulator said</h1>
        <p className="mt-2 text-muted">
          Before writing the service, I simulated this box 5,100 times, an hour of arrivals each (5 scenarios, 3 machine sizes,
          17 policies, 20 seeds), calibrated on benchmarks from the server it runs on. The plan was to show that splitting late work with a good
          forecast and a budget beats splitting on a timer. It does. But a plain pool that hands out ten images at a time,
          earliest deadline first, beats every splitting policy, and the reason is preemption: the pool reconsiders who gets a
          core every few seconds, while a worker that owns a task keeps its core until the task is done. That is why the box you
          press runs a pool, and why the splitting policies are exhibits.
        </p>
      </header>
      <section>
        <h2 className="text-sm font-semibold">Deadline hit rate on the cage (1.5 CPU, budget 2)</h2>
        <div className="mt-2 overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="tabular w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-3 py-2 font-medium">Policy</th>
                {scenarios.map((s) => (
                  <th key={s} className="px-3 py-2 text-right font-medium">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {policies.map((policy) => (
                <tr key={policy} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 font-medium">{policy}</td>
                  {scenarios.map((scenario) => {
                    const c = cell('cage', scenario, policy)
                    return (
                      <td key={scenario} className="px-3 py-2 text-right" title={c ? `95% interval ${pct(c.hitRate.lo)}-${pct(c.hitRate.hi)}` : ''}>
                        {c ? pct(c.hitRate.mean) : '–'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-xs text-muted">
          Share of submitted tasks finished by their deadline, mean of 20 seeds; rejected tasks count as misses. Hover a cell for its
          95% interval.
        </p>
      </section>
      {charts.map((chart, i) => (
        <figure key={i} className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: chart }} />
      ))}
    </article>
  )
}

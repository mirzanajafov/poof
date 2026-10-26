import { writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { exhibitDefaults, isRecord, type ExhibitDetail } from '@poof/contracts'
import type { ExhibitRun } from '@poof/contracts/bench'
import { isExhibitPolicyName, type ExhibitPolicyName } from '@poof/core'
import { recordedRun } from './recorded-run.ts'

const { values } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://poof-api:3111' },
    policies: { type: 'string', default: 'pool,forecast+preempt,forecast+budget,forecast,box' },
    seeds: { type: 'string', default: '1,2,3' },
    duration: { type: 'string', default: String(exhibitDefaults.durationSeconds) },
    utilization: { type: 'string', default: String(exhibitDefaults.utilization) },
    dataset: { type: 'string', default: exhibitDefaults.dataset },
    gap: { type: 'string', default: '15' },
    out: { type: 'string', default: 'exhibit-runs.json' },
  },
})

const policies: ExhibitPolicyName[] = []
const unknown: string[] = []
for (const name of values.policies.split(',')) {
  if (isExhibitPolicyName(name)) policies.push(name)
  else unknown.push(name)
}
if (unknown.length > 0) throw new Error(`no exhibit policy ${unknown.join(', ')}`)
const token = process.env.ADMIN_TOKEN
if (!token) throw new Error('ADMIN_TOKEN is not set')
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }

async function call(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${values.api}${path}`, init)
  const body: unknown = await res.json().catch(() => null)
  return { status: res.status, body }
}

async function answer(path: string): Promise<{ status: number; body: unknown } | null> {
  return call(path).catch(() => {
    console.log(`GET ${path} got no answer`)
    return null
  })
}

async function idle(): Promise<void> {
  while ((await answer('/api/exhibits/current'))?.status !== 404) await sleep(5000)
}

async function start(policy: ExhibitPolicyName, seed: number): Promise<string | null> {
  while (true) {
    await idle()
    const started = await call('/api/exhibits', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        policy,
        seed,
        durationSeconds: Number(values.duration),
        utilization: Number(values.utilization),
        dataset: values.dataset,
      }),
    })
    if (started.status === 409) continue
    const id = isRecord(started.body) && typeof started.body.id === 'string' ? started.body.id : null
    if (started.status === 201 && id !== null) return id
    console.log(`${policy} seed ${seed}: could not start (${started.status} ${JSON.stringify(started.body)})`)
    return null
  }
}

async function ended(id: string, deadline: number): Promise<ExhibitDetail | null> {
  while (Date.now() < deadline) {
    await sleep(3000)
    const polled = await answer(`/api/exhibits/${id}`)
    if (!polled) continue
    if (polled.status >= 400 && polled.status < 500 && polled.status !== 429) {
      console.log(`the API answered ${polled.status} for exhibit ${id}`)
      return null
    }
    const detail = polled.status === 200 ? (polled.body as ExhibitDetail | null) : null
    if (detail && detail.status !== 'RUNNING') return detail
  }
  return null
}

const patienceMs = (2 * Number(values.duration) + 60) * 1000

const runs: ExhibitRun[] = []
for (const seed of values.seeds.split(',').map(Number)) {
  for (const policy of policies) {
    const id = await start(policy, seed)
    if (id === null) continue
    const detail = await ended(id, Date.now() + patienceMs)
    const run = detail && recordedRun(detail)
    if (run) {
      runs.push(run)
      await writeFile(
        values.out,
        `${JSON.stringify(runs, null, 2)}
`,
      )
      console.log(`${policy} seed ${seed}: ${JSON.stringify(run.stats)}`)
    } else {
      console.log(`${policy} seed ${seed}: ${detail ? `ended ${detail.status}` : 'gave no result'}, not recorded`)
    }
    await sleep(Number(values.gap) * 1000)
  }
}

import { writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { exhibitDefaults, exhibitEnds, hasFields, isRecord, type ExhibitDetail } from '@poof/contracts'
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
const patienceMs = (2 * Number(values.duration) + 60) * 1000

async function call(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${values.api}${path}`, init)
  const body: unknown = await res.json().catch(() => null)
  return { status: res.status, body }
}

async function idle(): Promise<void> {
  while (true) {
    const { status } = await call('/api/exhibits/current')
    if (status === 404) return
    if (status !== 200) throw new Error(`the API answered ${status} for the current exhibit`)
    await sleep(5000)
  }
}

async function start(policy: ExhibitPolicyName, seed: number): Promise<string> {
  while (true) {
    await idle()
    const { status, body } = await call('/api/exhibits', {
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
    if (status === 201 && isRecord(body) && typeof body.id === 'string') return body.id
    if (status !== 409) throw new Error(`could not start ${policy} seed ${seed}: ${status} ${JSON.stringify(body)}`)
    console.log(`${policy} seed ${seed}: the box is busy, waiting`)
    await sleep(5000)
  }
}

async function ended(id: string): Promise<ExhibitDetail> {
  const deadline = Date.now() + patienceMs
  while (true) {
    await sleep(3000)
    const { status, body } = await call(`/api/exhibits/${id}`)
    if (status !== 200 || !hasFields<Pick<ExhibitDetail, 'status'>>(body, { status: ['RUNNING', ...exhibitEnds] })) {
      throw new Error(`the API answered ${status} ${JSON.stringify(body)} for exhibit ${id}`)
    }
    if (body.status !== 'RUNNING') return body as ExhibitDetail
    if (Date.now() > deadline) throw new Error(`exhibit ${id} is still running ${patienceMs / 1000} s after it started`)
  }
}

const runs: ExhibitRun[] = []
for (const seed of values.seeds.split(',').map(Number)) {
  for (const policy of policies) {
    const detail = await ended(await start(policy, seed))
    const run = recordedRun(detail)
    if (run) {
      runs.push(run)
      await writeFile(values.out, `${JSON.stringify(runs, null, 2)}\n`)
      console.log(`${policy} seed ${seed}: ${JSON.stringify(run.stats)}`)
    } else {
      console.log(`${policy} seed ${seed}: ended ${detail.status}, not recorded`)
    }
    await sleep(Number(values.gap) * 1000)
  }
}

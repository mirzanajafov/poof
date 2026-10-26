import { writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { exhibitDefaults, isRecord, type ExhibitDetail, type ExhibitRun } from '@poof/contracts'
import { isExhibitPolicyName } from '@poof/core'

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

const names = values.policies.split(',')
const unknown = names.filter((name) => !isExhibitPolicyName(name))
if (unknown.length > 0) throw new Error(`no exhibit policy ${unknown.join(', ')}`)
const policies = names.filter(isExhibitPolicyName)
const token = process.env.ADMIN_TOKEN
if (!token) throw new Error('ADMIN_TOKEN is not set')
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }

async function call(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${values.api}${path}`, init)
  const body: unknown = await res.json().catch(() => null)
  return { status: res.status, body }
}

async function ended(id: string): Promise<ExhibitDetail> {
  while (true) {
    await sleep(3000)
    const { status, body } = await call(`/api/exhibits/${id}`)
    if (status >= 400 && status < 500) throw new Error(`the API answered ${status} for exhibit ${id}`)
    if (status !== 200) continue
    const detail = body as ExhibitDetail
    if (detail.status !== 'RUNNING') return detail
  }
}

const runs: ExhibitRun[] = []
for (const seed of values.seeds.split(',').map(Number)) {
  for (const policy of policies) {
    while ((await call('/api/exhibits/current')).status === 200) await sleep(5000)
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
    const id = isRecord(started.body) && typeof started.body.id === 'string' ? started.body.id : null
    if (started.status !== 201 || id === null) {
      console.log(`${policy} seed ${seed}: could not start (${started.status} ${JSON.stringify(started.body)})`)
      continue
    }
    const { status, params, stats, tasks } = await ended(id)
    if (status === 'DONE' && stats) {
      runs.push({ id, policy, params, stats, tasks })
      await writeFile(values.out, `${JSON.stringify(runs, null, 2)}\n`)
      console.log(`${policy} seed ${seed}: ${JSON.stringify(stats)}`)
    } else {
      console.log(`${policy} seed ${seed}: ended ${status}, not recorded`)
    }
    await sleep(Number(values.gap) * 1000)
  }
}

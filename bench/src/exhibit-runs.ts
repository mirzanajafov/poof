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
const policies = names.filter(isExhibitPolicyName)
if (policies.length !== names.length) {
  throw new Error(`no exhibit policy ${names.filter((name) => !isExhibitPolicyName(name)).join(', ')}`)
}
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
    const detail = (await call(`/api/exhibits/${id}`)).body as ExhibitDetail | null
    if (detail && detail.status !== 'RUNNING') return detail
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
    const { params, stats, tasks } = await ended(id)
    if (!stats) {
      console.log(`${policy} seed ${seed}: ended without stats`)
      continue
    }
    runs.push({ id, policy, params, stats, tasks })
    await writeFile(values.out, `${JSON.stringify(runs, null, 2)}\n`)
    console.log(`${policy} seed ${seed}: ${JSON.stringify(stats)}`)
    await sleep(Number(values.gap) * 1000)
  }
}

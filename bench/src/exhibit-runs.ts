import { writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://poof-api:3111' },
    policies: { type: 'string', default: 'pool,forecast+preempt,forecast+budget,forecast,box' },
    seeds: { type: 'string', default: '1,2,3' },
    duration: { type: 'string', default: '60' },
    utilization: { type: 'string', default: '1.2' },
    dataset: { type: 'string', default: 'synthetic' },
    gap: { type: 'string', default: '15' },
    out: { type: 'string', default: 'exhibit-runs.json' },
  },
})

const token = process.env.ADMIN_TOKEN
if (!token) throw new Error('ADMIN_TOKEN is not set')
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }

async function call(path: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${values.api}${path}`, init)
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null }
}

const runs: unknown[] = []
for (const seed of values.seeds!.split(',').map(Number)) {
  for (const policy of values.policies!.split(',')) {
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
    if (started.status !== 201) {
      console.log(`${policy} seed ${seed}: could not start (${started.status} ${JSON.stringify(started.body)})`)
      continue
    }
    const id = String(started.body!.id)
    let detail: Record<string, unknown> | null = null
    do {
      await sleep(3000)
      detail = (await call(`/api/exhibits/${id}`)).body
    } while (!detail || detail.status === 'RUNNING')
    runs.push({ id, policy, params: detail.params, stats: detail.stats, tasks: detail.tasks })
    await writeFile(values.out!, `${JSON.stringify(runs, null, 2)}\n`)
    console.log(`${policy} seed ${seed}: ${JSON.stringify(detail.stats)}`)
    await sleep(Number(values.gap) * 1000)
  }
}

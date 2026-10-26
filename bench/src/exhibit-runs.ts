import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { exhibitDefaults, exhibitEnds, hasFields, isRecord, type ExhibitDetail } from '@poof/contracts'
import { exhibitRunSummary, type ExhibitRun } from '@poof/contracts/bench'
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
  if (isExhibitPolicyName(name) && !policies.includes(name)) policies.push(name)
  else unknown.push(name)
}
if (unknown.length > 0) throw new Error(`unknown or repeated exhibit policy ${unknown.join(', ')}`)
const durationSeconds = Number(values.duration)
const utilization = Number(values.utilization)
const gapMs = Number(values.gap) * 1000
const seeds = values.seeds.split(',').map(Number)
if (!(durationSeconds > 0) || !(utilization > 0) || !(gapMs >= 0)) {
  throw new Error('--duration and --utilization need numbers above zero and --gap a number of seconds')
}
if (!seeds.every((seed, i) => Number.isInteger(seed) && seeds.indexOf(seed) === i)) {
  throw new Error('--seeds needs distinct whole numbers')
}
const token = process.env.ADMIN_TOKEN
if (!token) throw new Error('ADMIN_TOKEN is not set')
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
const patienceMs = (2 * durationSeconds + 60) * 1000
if (existsSync(values.out)) throw new Error(`${values.out} already holds runs, so pick another --out`)

async function request(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${values.api}${path}`, { ...init, signal: AbortSignal.timeout(30_000) }).catch(
    (error: unknown) => {
      console.log(`no answer from ${values.api}${path}: ${error instanceof Error ? error.message : 'unknown error'}`)
      return null
    },
  )
  if (!res) return { status: 0, body: null }
  const body: unknown = await res.json().catch(() => null)
  return { status: res.status, body }
}

function transient(status: number): boolean {
  return status === 0 || status >= 500
}

function giveUpAfter(deadline: number, what: string): void {
  if (Date.now() > deadline) throw new Error(`${what} for ${patienceMs / 1000} s, giving up`)
}

async function idle(): Promise<void> {
  const deadline = Date.now() + patienceMs
  while (true) {
    const { status } = await request('/api/exhibits/current')
    if (status === 404) return
    if (status !== 200 && !transient(status)) throw new Error(`the API answered ${status} for the current exhibit`)
    giveUpAfter(deadline, 'the box has not been free')
    await sleep(5000)
  }
}

async function start(policy: ExhibitPolicyName, seed: number): Promise<string> {
  const deadline = Date.now() + patienceMs
  while (true) {
    await idle()
    const { status, body } = await request('/api/exhibits', {
      method: 'POST',
      headers,
      body: JSON.stringify({ policy, seed, durationSeconds, utilization, dataset: values.dataset }),
    })
    if (status === 201 && isRecord(body) && typeof body.id === 'string') return body.id
    if (status !== 409 && !transient(status)) {
      throw new Error(`could not start ${policy} seed ${seed}: ${status} ${JSON.stringify(body)}`)
    }
    giveUpAfter(deadline, `${policy} seed ${seed} could not start`)
    console.log(`${policy} seed ${seed}: not started (${status}), trying again once the box is free`)
    await sleep(5000)
  }
}

async function ended(id: string): Promise<ExhibitDetail> {
  const deadline = Date.now() + patienceMs
  while (true) {
    await sleep(3000)
    giveUpAfter(deadline, `exhibit ${id} has not ended`)
    const { status, body } = await request(`/api/exhibits/${id}`)
    if (transient(status)) continue
    if (status !== 200 || !hasFields<Pick<ExhibitDetail, 'status'>>(body, { status: ['RUNNING', ...exhibitEnds] })) {
      throw new Error(`the API answered ${status} ${JSON.stringify(body)} for exhibit ${id}`)
    }
    if (body.status !== 'RUNNING') return body as ExhibitDetail
  }
}

const runs: ExhibitRun[] = []
for (const seed of seeds) {
  for (const policy of policies) {
    const detail = await ended(await start(policy, seed))
    const run = recordedRun(detail)
    if (run) {
      exhibitRunSummary(run, `${values.api}/api/exhibits/${run.id}`)
      runs.push(run)
      await writeFile(values.out, `${JSON.stringify(runs, null, 2)}\n`)
      console.log(`${policy} seed ${seed}: ${JSON.stringify(run.stats)}`)
    } else {
      console.log(`${policy} seed ${seed}: ended ${detail.status}, not recorded`)
    }
    await sleep(gapMs)
  }
}

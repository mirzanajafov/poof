import { fork } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { Redis } from 'ioredis'
import { environment, writeResult } from './results.ts'
import { round, summary } from './stats.ts'

const { values } = parseArgs({
  options: {
    reps: { type: 'string', default: '5000' },
    redis: { type: 'string', default: process.env.REDIS_URL },
    label: { type: 'string', default: 'local' },
  },
})

const reps = Number(values.reps)

function micros(samples: number[]) {
  return Object.fromEntries(Object.entries(summary(samples)).map(([k, v]) => [k, k === 'n' ? v : round(v * 1000, 1)]))
}

async function timed(fn: () => Promise<unknown>, before?: () => Promise<unknown>): Promise<number[]> {
  const samples: number[] = []
  for (let i = 0; i < reps; i++) {
    if (before) await before()
    const started = performance.now()
    await fn()
    samples.push(performance.now() - started)
  }
  return samples
}

const child = fork(fileURLToPath(new URL('./b4-child.js', import.meta.url)))
await once(child, 'message')
let seq = 0
const ipc = await timed(async () => {
  const reply = once(child, 'message')
  child.send({ type: 'progress', seq: seq++, cursor: 1234, itemMs: 87.5 })
  await reply
})
child.kill()

const claimScript = `
local popped = redis.call('ZPOPMIN', KEYS[1])
if #popped == 0 then return false end
redis.call('HINCRBY', KEYS[2], 'claims', 1)
return popped[1]
`

const shrinkScript = `
local cursor = tonumber(redis.call('HGET', KEYS[1], 'cursor'))
local hi = tonumber(redis.call('HGET', KEYS[1], 'hi'))
local cut = tonumber(ARGV[1])
local k = tonumber(ARGV[2])
if cursor >= cut or cut >= hi then return 0 end
redis.call('HSET', KEYS[1], 'hi', cut)
local size = math.floor((hi - cut) / k)
for i = 1, k do
  local lo = cut + (i - 1) * size
  local top = hi
  if i < k then top = lo + size end
  redis.call('HSET', KEYS[2] .. ':' .. i, 'lo', lo, 'hi', top, 'cursor', lo, 'state', 'pending')
end
return k
`

let redis: Record<string, unknown> | null = null
if (values.redis) {
  const client = new Redis(values.redis)
  const claimSha = (await client.script('LOAD', claimScript)) as string
  const shrinkSha = (await client.script('LOAD', shrinkScript)) as string
  await client.del('bench:chunks', 'bench:task')
  const fill = client.pipeline()
  for (let i = 0; i < reps; i++) fill.zadd('bench:chunks', i, `chunk:${i}`)
  await fill.exec()
  const claim = await timed(() => client.evalsha(claimSha, 2, 'bench:chunks', 'bench:task'))
  const shrink = await timed(
    () => client.evalsha(shrinkSha, 2, 'bench:lease', 'bench:child', 5000, 3),
    () => client.hset('bench:lease', 'lo', 0, 'hi', 10000, 'cursor', 1200),
  )
  let cursor = 0
  const checkpoint = await timed(() => client.hset('bench:lease', 'cursor', cursor++))
  redis = { claimUs: micros(claim), shrinkUs: micros(shrink), checkpointUs: micros(checkpoint) }
  await client.quit()
}

const result = { env: environment(values.label!), reps, ipcRoundTripUs: micros(ipc), redis }
console.log(JSON.stringify(result, null, 2))
console.log(`wrote ${await writeResult(values.label!, 'b4-coordination', result)}`)

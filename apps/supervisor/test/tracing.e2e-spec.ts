import { rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { exhibitId, http, makeData, start, taskId, waitForExhibitEnd, waitForTask, type Running } from './harness.js'

interface Collected {
  traceId: string
  spanId: string
  parentSpanId: string
  name: string
  attributes: Record<string, string | number | boolean>
}

let dataDir: string
let running: Running | null = null
let server: Server
let endpoint: string
let spans: Collected[] = []

interface OtlpSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  attributes?: Array<{ key: string; value: Record<string, unknown> }>
}

function value(v: Record<string, unknown>): string | number | boolean {
  if ('stringValue' in v) return v.stringValue as string
  if ('intValue' in v) return Number(v.intValue)
  if ('doubleValue' in v) return Number(v.doubleValue)
  return Boolean(v.boolValue)
}

beforeAll(async () => {
  dataDir = await makeData()
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => (body += chunk.toString()))
    req.on('end', () => {
      const payload = JSON.parse(body) as {
        resourceSpans?: Array<{ scopeSpans?: Array<{ spans?: OtlpSpan[] }> }>
      }
      for (const resource of payload.resourceSpans ?? []) {
        for (const scope of resource.scopeSpans ?? []) {
          for (const span of scope.spans ?? []) {
            const attributes = Object.fromEntries((span.attributes ?? []).map((a) => [a.key, value(a.value)]))
            spans.push({
              traceId: span.traceId,
              spanId: span.spanId,
              parentSpanId: span.parentSpanId ?? '',
              name: span.name,
              attributes,
            })
          }
        }
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  endpoint = `http://127.0.0.1:${address.port}`
})

beforeEach(() => {
  spans = []
})

afterEach(async () => {
  await running?.close()
  running = null
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  await rm(dataDir, { recursive: true, force: true })
})

describe('tracing', () => {
  it('puts a task, its chunks and every image in the trace the request came with', async () => {
    running = await start(dataDir, { OTEL_EXPORTER_OTLP_ENDPOINT: endpoint })
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
    const res = await http(running)
      .post('/tasks')
      .set('traceparent', `00-${traceId}-00f067aa0ba902b7-01`)
      .send({ dataset: 'small', preset: 'webp-1600', deadlineSeconds: 120, count: 12 })
    expect(res.status).toBe(201)
    const task = await waitForTask(running, taskId(res.body), (row) => row.status === 'DONE')
    expect(task.traceId).toBe(traceId)
    await running.close()
    running = null
    const root = spans.filter((s) => s.name === 'task' && s.attributes['poof.task'] === task.id)
    expect(root).toMatchObject([{ traceId, parentSpanId: '00f067aa0ba902b7', attributes: { 'poof.outcome': 'met' } }])
    const chunks = spans.filter((s) => s.name === 'chunk' && s.parentSpanId === root[0]?.spanId)
    expect(chunks).toHaveLength(2)
    const chunkIds = new Set(chunks.map((c) => c.spanId))
    const images = spans.filter((s) => s.name === 'image' && chunkIds.has(s.parentSpanId))
    expect(images.map((i) => i.attributes['poof.item']).sort((a, b) => Number(a) - Number(b))).toEqual([
      ...Array(12).keys(),
    ])
  })

  it('draws the same tree of helpers as the lease table during an exhibit of the box', async () => {
    running = await start(dataDir, { OTEL_EXPORTER_OTLP_ENDPOINT: endpoint, BUDGET: '2', EXHIBIT_MAX_PROCESSES: '8' })
    const res = await http(running).post('/exhibits').send({
      policy: 'box',
      durationSeconds: 15,
      dataset: 'noisy',
      utilization: 0.4,
      minItems: 150,
      maxItems: 200,
      slackMin: 0.1,
      slackMax: 0.15,
    })
    expect(res.status).toBe(201)
    const id = exhibitId(res.body)
    await waitForExhibitEnd(running, id)
    const leases = await running.db.lease.findMany({ where: { task: { exhibitId: id } } })
    const tasks = await running.db.task.findMany({ where: { exhibitId: id, status: { not: 'REJECTED' } } })
    await running.close()
    running = null
    const exhibit = spans.find((s) => s.name === 'exhibit' && s.attributes['poof.exhibit'] === id)
    expect(exhibit).toBeDefined()
    expect(new Set(tasks.map((t) => t.traceId))).toEqual(new Set([exhibit?.traceId]))
    const taskSpans = new Map(spans.filter((s) => s.name === 'task').map((s) => [s.attributes['poof.task'], s]))
    const leaseSpans = new Map(spans.filter((s) => s.name === 'lease').map((s) => [s.attributes['poof.lease'], s]))
    expect(leases.some((l) => l.parentId !== null)).toBe(true)
    for (const lease of leases) {
      const parent = lease.parentId ? leaseSpans.get(lease.parentId) : taskSpans.get(lease.taskId)
      expect(parent).toBeDefined()
      expect(leaseSpans.get(lease.id)).toMatchObject({
        parentSpanId: parent?.spanId,
        attributes: { 'poof.depth': lease.depth },
      })
    }
    for (const task of tasks) expect(taskSpans.get(task.id)?.parentSpanId).toBe(exhibit?.spanId)
  })
})

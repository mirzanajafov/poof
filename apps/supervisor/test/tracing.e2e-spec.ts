import { rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { makeData, start, until, type Running } from './harness.js'

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
      const payload = JSON.parse(body) as { resourceSpans?: Array<{ scopeSpans?: Array<{ spans?: Array<Record<string, unknown>> }> }> }
      for (const resource of payload.resourceSpans ?? []) {
        for (const scope of resource.scopeSpans ?? []) {
          for (const span of scope.spans ?? []) {
            const attributes = Object.fromEntries(
              ((span.attributes as Array<{ key: string; value: Record<string, unknown> }>) ?? []).map((a) => [a.key, value(a.value)]),
            )
            spans.push({
              traceId: span.traceId as string,
              spanId: span.spanId as string,
              parentSpanId: (span.parentSpanId as string | undefined) ?? '',
              name: span.name as string,
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
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  await rm(dataDir, { recursive: true, force: true })
})

describe('tracing', () => {
  it('puts a task, its chunks and every image in the trace the request came with', async () => {
    running = await start(dataDir, { OTEL_EXPORTER_OTLP_ENDPOINT: endpoint })
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
    const res = await request(running.app.getHttpServer())
      .post('/tasks')
      .set('traceparent', `00-${traceId}-00f067aa0ba902b7-01`)
      .send({ dataset: 'small', preset: 'webp-1600', deadlineSeconds: 120, count: 12 })
    expect(res.status).toBe(201)
    const task = await until(async () => {
      const row = await running!.db.task.findUnique({ where: { id: res.body.id } })
      return row?.status === 'DONE' ? row : null
    })
    expect(task.traceId).toBe(traceId)
    await running.close()
    running = null
    const root = spans.filter((s) => s.name === 'task' && s.attributes['poof.task'] === task.id)
    expect(root).toHaveLength(1)
    expect(root[0]!.traceId).toBe(traceId)
    expect(root[0]!.parentSpanId).toBe('00f067aa0ba902b7')
    expect(root[0]!.attributes['poof.outcome']).toBe('met')
    const chunks = spans.filter((s) => s.name === 'chunk' && s.parentSpanId === root[0]!.spanId)
    expect(chunks).toHaveLength(2)
    const chunkIds = new Set(chunks.map((c) => c.spanId))
    const images = spans.filter((s) => s.name === 'image' && chunkIds.has(s.parentSpanId))
    expect(images.map((i) => i.attributes['poof.item']).sort((a, b) => Number(a) - Number(b))).toEqual([...Array(12).keys()])
  })

  it('draws the same tree of helpers as the lease table during an exhibit of the box', async () => {
    running = await start(dataDir, { OTEL_EXPORTER_OTLP_ENDPOINT: endpoint, BUDGET: '2', EXHIBIT_MAX_PROCESSES: '8' })
    const res = await request(running.app.getHttpServer())
      .post('/exhibits')
      .send({ policy: 'box', durationSeconds: 15, dataset: 'noisy', utilization: 0.4, minItems: 150, maxItems: 200, slackMin: 0.1, slackMax: 0.15 })
    expect(res.status).toBe(201)
    await until(async () => {
      const exhibit = await running!.db.exhibit.findUnique({ where: { id: res.body.id } })
      return exhibit && exhibit.status !== 'RUNNING'
    })
    const leases = await running.db.lease.findMany({ where: { task: { exhibitId: res.body.id } } })
    const tasks = await running.db.task.findMany({ where: { exhibitId: res.body.id, status: { not: 'REJECTED' } } })
    await running.close()
    running = null
    const exhibit = spans.find((s) => s.name === 'exhibit' && s.attributes['poof.exhibit'] === res.body.id)!
    expect(exhibit).toBeDefined()
    expect(new Set(tasks.map((t) => t.traceId))).toEqual(new Set([exhibit.traceId]))
    const taskSpans = new Map(spans.filter((s) => s.name === 'task').map((s) => [s.attributes['poof.task'], s]))
    const leaseSpans = new Map(spans.filter((s) => s.name === 'lease').map((s) => [s.attributes['poof.lease'], s]))
    expect(leases.some((l) => l.parentId !== null)).toBe(true)
    for (const lease of leases) {
      const span = leaseSpans.get(lease.id)
      expect(span).toBeDefined()
      const parent = lease.parentId ? leaseSpans.get(lease.parentId)! : taskSpans.get(lease.taskId)!
      expect(span!.parentSpanId).toBe(parent.spanId)
      expect(span!.attributes['poof.depth']).toBe(lease.depth)
    }
    for (const task of tasks) expect(taskSpans.get(task.id)!.parentSpanId).toBe(exhibit.spanId)
  })
})

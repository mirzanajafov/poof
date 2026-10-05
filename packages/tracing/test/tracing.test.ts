import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'
import { describe, expect, it } from 'vitest'
import { extract, inject, resume, startTracing, traceIdOf, within } from '../src/index.ts'

describe('tracing', () => {
  it('records nothing and costs nothing without an endpoint', () => {
    const tracing = startTracing('test')
    const span = tracing.tracer.startSpan('task')
    expect(tracing.enabled).toBe(false)
    expect(span.isRecording()).toBe(false)
    expect(traceIdOf(span)).toBeNull()
    span.end()
  })

  it('keeps helpers in the trace of the lease that split', async () => {
    const exporter = new InMemorySpanExporter()
    const tracing = startTracing('test', { exporter })
    const task = tracing.tracer.startSpan('task')
    const lease = tracing.tracer.startSpan('lease', {}, within(task))
    const helper = tracing.tracer.startSpan('lease', {}, within(lease))
    tracing.tracer.startSpan('image', { startTime: Date.now() - 300 }, within(helper)).end()
    for (const span of [helper, lease, task]) span.end()
    await tracing.flush()
    const spans = exporter.getFinishedSpans()
    expect(new Set(spans.map((s) => s.spanContext().traceId)).size).toBe(1)
    const byId = new Map(spans.map((s) => [s.spanContext().spanId, s]))
    const image = spans.find((s) => s.name === 'image')!
    const parent = byId.get(image.parentSpanContext!.spanId)!
    expect(parent.spanContext().spanId).toBe(helper.spanContext().spanId)
    expect(byId.get(parent.parentSpanContext!.spanId)!.spanContext().spanId).toBe(lease.spanContext().spanId)
  })

  it('carries a trace over HTTP headers and resumes one from a stored id', async () => {
    const exporter = new InMemorySpanExporter()
    const tracing = startTracing('test', { exporter })
    const request = tracing.tracer.startSpan('POST /tasks')
    const headers = inject(within(request))
    expect(headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
    const task = tracing.tracer.startSpan('task', {}, extract(headers))
    const resumed = tracing.tracer.startSpan('task', {}, resume(traceIdOf(task)!))
    for (const span of [resumed, task, request]) span.end()
    await tracing.flush()
    const ids = exporter.getFinishedSpans().map((s) => s.spanContext().traceId)
    expect(new Set(ids).size).toBe(1)
  })
})

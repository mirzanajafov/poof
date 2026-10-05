import { randomBytes } from 'node:crypto'
import {
  defaultTextMapGetter,
  defaultTextMapSetter,
  ROOT_CONTEXT,
  trace,
  TraceFlags,
  type Context,
  type Span,
  type Tracer,
} from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchSpanProcessor, type SpanExporter } from '@opentelemetry/sdk-trace-base'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'

export { SpanKind, SpanStatusCode } from '@opentelemetry/api'
export type { Context, Span, Tracer } from '@opentelemetry/api'

export interface Tracing {
  readonly enabled: boolean
  readonly tracer: Tracer
  flush(): Promise<void>
  shutdown(): Promise<void>
}

export interface TracingOptions {
  endpoint?: string
  exporter?: SpanExporter
}

const propagator = new W3CTraceContextPropagator()

export function startTracing(service: string, options: TracingOptions = {}): Tracing {
  const endpoint = options.endpoint?.replace(/\/$/, '')
  const exporter = options.exporter ?? (endpoint ? new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }) : null)
  if (!exporter) return { enabled: false, tracer: trace.getTracer(service), flush: async () => undefined, shutdown: async () => undefined }
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: service }),
    spanProcessors: [new BatchSpanProcessor(exporter, { maxQueueSize: 8192, maxExportBatchSize: 512 })],
  })
  return {
    enabled: true,
    tracer: provider.getTracer(service),
    flush: () => provider.forceFlush(),
    shutdown: () => provider.shutdown(),
  }
}

export function extract(headers: Record<string, unknown>): Context {
  return propagator.extract(ROOT_CONTEXT, headers, defaultTextMapGetter)
}

export function inject(context: Context): Record<string, string> {
  const carrier: Record<string, string> = {}
  propagator.inject(context, carrier, defaultTextMapSetter)
  return carrier
}

export function within(span: Span | null | undefined, parent: Context = ROOT_CONTEXT): Context {
  return span ? trace.setSpan(parent, span) : parent
}

export function resume(traceId: string): Context {
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId,
    spanId: randomBytes(8).toString('hex'),
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true,
  })
}

export function traceIdOf(span: Span): string | null {
  return span.isRecording() ? span.spanContext().traceId : null
}

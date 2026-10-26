import { BadGatewayException, Injectable } from '@nestjs/common'
import { Traces } from '@poof/nest'
import { extract, inject, SpanKind, SpanStatusCode, within } from '@poof/tracing'
import { Env } from '../config/env.js'

export interface SupervisorReply {
  status: number
  retryAfter: string | null
  body: unknown
}

@Injectable()
export class Supervisor {
  private readonly base: string

  constructor(
    env: Env,
    private readonly traces: Traces,
  ) {
    this.base = env.SUPERVISOR_URL.replace(/\/$/, '')
  }

  async forward(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body: unknown,
    incoming: Record<string, unknown> = {},
  ): Promise<SupervisorReply> {
    const span = this.traces.tracer.startSpan(
      `${method} /api${path}`,
      { kind: SpanKind.SERVER, attributes: { 'http.request.method': method, 'url.path': `/api${path}` } },
      extract(incoming),
    )
    let reply: SupervisorReply
    try {
      const upstream = await fetch(`${this.base}${path}`, {
        method,
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...inject(within(span)) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      })
      const text = await upstream.text()
      reply = {
        status: upstream.status,
        retryAfter: upstream.headers.get('retry-after'),
        body: text ? JSON.parse(text) : undefined,
      }
    } catch {
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'the supervisor did not answer' })
      span.end()
      throw new BadGatewayException('the supervisor did not answer')
    }
    span.setAttribute('http.response.status_code', reply.status)
    span.end()
    return reply
  }
}

import { BadGatewayException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { extract, inject, SpanKind, SpanStatusCode, within } from '@poof/tracing'
import type { Response } from 'express'
import type { Env } from '../config/env.js'
import { Traces } from '../infra/infra.module.js'

@Injectable()
export class Supervisor {
  private readonly base: string

  constructor(
    config: ConfigService<Env, true>,
    private readonly traces: Traces,
  ) {
    this.base = config.get('SUPERVISOR_URL', { infer: true }).replace(/\/$/, '')
  }

  async relay(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body: unknown,
    res: Response,
    incoming: Record<string, unknown> = {},
  ): Promise<unknown> {
    const span = this.traces.tracer.startSpan(
      `${method} /api${path}`,
      { kind: SpanKind.SERVER, attributes: { 'http.request.method': method, 'url.path': `/api${path}` } },
      extract(incoming),
    )
    let upstream: globalThis.Response
    try {
      upstream = await fetch(`${this.base}${path}`, {
        method,
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...inject(within(span)) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'the supervisor did not answer' })
      span.end()
      throw new BadGatewayException('the supervisor did not answer')
    }
    span.setAttribute('http.response.status_code', upstream.status)
    span.end()
    res.status(upstream.status)
    const retryAfter = upstream.headers.get('retry-after')
    if (retryAfter) res.setHeader('Retry-After', retryAfter)
    const text = await upstream.text()
    return text ? JSON.parse(text) : undefined
  }
}

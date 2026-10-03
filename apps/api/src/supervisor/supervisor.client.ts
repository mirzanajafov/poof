import { BadGatewayException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Response } from 'express'
import type { Env } from '../config/env.js'

@Injectable()
export class Supervisor {
  private readonly base: string

  constructor(config: ConfigService<Env, true>) {
    this.base = config.get('SUPERVISOR_URL', { infer: true }).replace(/\/$/, '')
  }

  async relay(method: 'GET' | 'POST' | 'DELETE', path: string, body: unknown, res: Response): Promise<unknown> {
    let upstream: globalThis.Response
    try {
      upstream = await fetch(`${this.base}${path}`, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new BadGatewayException('the supervisor did not answer')
    }
    res.status(upstream.status)
    const retryAfter = upstream.headers.get('retry-after')
    if (retryAfter) res.setHeader('Retry-After', retryAfter)
    const text = await upstream.text()
    return text ? JSON.parse(text) : undefined
  }
}

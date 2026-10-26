import { HttpException, HttpStatus, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request, Response } from 'express'
import { Env } from '../config/env.js'
import { Cache } from '../infra/cache.js'
import { Admin } from './admin.js'
import { LIMIT, type Limit } from './rate-limit.decorator.js'

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cache: Cache,
    private readonly admin: Admin,
    private readonly env: Env,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const limit = this.reflector.get<Limit | undefined>(LIMIT, ctx.getHandler())
    if (!limit) return true
    const request = ctx.switchToHttp().getRequest<Request>()
    if (this.admin.is(request)) return true
    const now = Date.now()
    const windowMs = limit.windowSeconds * 1000
    const windowStart = Math.floor(now / windowMs) * windowMs
    const key = `poof:limit:${limit.name}:${request.ip}:${windowStart}`
    const count = await this.cache.count(key, windowMs)
    if (count <= this.env[limit.setting]) return true
    const retryAfter = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000))
    ctx.switchToHttp().getResponse<Response>().setHeader('Retry-After', String(retryAfter))
    throw new HttpException(`too many requests, try again in ${retryAfter} s`, HttpStatus.TOO_MANY_REQUESTS)
  }
}

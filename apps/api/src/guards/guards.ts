import { timingSafeEqual } from 'node:crypto'
import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import type { Request, Response } from 'express'
import type { Env } from '../config/env.js'
import { Cache } from '../infra/infra.module.js'

export const LIMIT = 'poof:limit'

export interface Limit {
  name: string
  setting: 'TASKS_PER_MINUTE' | 'EXHIBITS_PER_HOUR'
  windowSeconds: number
}

export const RateLimit = (limit: Limit) => SetMetadata(LIMIT, limit)

@Injectable()
export class Admin {
  private readonly token: Buffer

  constructor(config: ConfigService<Env, true>) {
    this.token = Buffer.from(config.get('ADMIN_TOKEN', { infer: true }))
  }

  is(request: Request): boolean {
    const header = request.headers.authorization ?? ''
    if (!header.startsWith('Bearer ')) return false
    const given = Buffer.from(header.slice(7))
    return given.length === this.token.length && timingSafeEqual(given, this.token)
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly admin: Admin) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (!this.admin.is(ctx.switchToHttp().getRequest<Request>())) throw new UnauthorizedException()
    return true
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cache: Cache,
    private readonly admin: Admin,
    private readonly config: ConfigService<Env, true>,
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
    const count = await this.cache.redis
      .multi()
      .incr(key)
      .pexpire(key, windowMs)
      .exec()
      .then((results) => Number(results?.[0]?.[1] ?? 0))
    const max = this.config.get(limit.setting, { infer: true })
    if (count <= max) return true
    const retryAfter = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000))
    ctx.switchToHttp().getResponse<Response>().setHeader('Retry-After', String(retryAfter))
    throw new HttpException(`too many requests, try again in ${retryAfter} s`, HttpStatus.TOO_MANY_REQUESTS)
  }
}

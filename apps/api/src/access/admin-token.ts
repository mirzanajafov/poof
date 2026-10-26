import { timingSafeEqual } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import type { Request } from 'express'
import { Env } from '../config/env.js'

@Injectable()
export class AdminToken {
  private readonly token: Buffer

  constructor(env: Env) {
    this.token = Buffer.from(env.ADMIN_TOKEN)
  }

  matches(request: Request): boolean {
    const header = request.headers.authorization ?? ''
    if (!header.startsWith('Bearer ')) return false
    const given = Buffer.from(header.slice(7))
    return given.length === this.token.length && timingSafeEqual(given, this.token)
  }
}

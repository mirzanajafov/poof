import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'
import { AdminToken } from './admin-token.js'

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly adminToken: AdminToken) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (!this.adminToken.matches(ctx.switchToHttp().getRequest<Request>())) throw new UnauthorizedException()
    return true
  }
}

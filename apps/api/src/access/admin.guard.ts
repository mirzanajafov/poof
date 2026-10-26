import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'
import { Admin } from './admin.js'

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly admin: Admin) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (!this.admin.is(ctx.switchToHttp().getRequest<Request>())) throw new UnauthorizedException()
    return true
  }
}

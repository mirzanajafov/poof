import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { Admin } from '../access/admin.js'
import { AdminGuard } from '../access/admin.guard.js'
import { RateLimit } from '../access/rate-limit.decorator.js'
import { RateLimitGuard } from '../access/rate-limit.guard.js'
import { Cache } from '../infra/cache.js'
import { respondWith } from '../supervisor/respond.js'
import { Supervisor } from '../supervisor/supervisor.client.js'
import { ExhibitGate } from './exhibit-gate.js'
import { ExhibitQueries } from './exhibit-queries.js'
import { StartExhibit } from './start-exhibit.dto.js'

@Controller('exhibits')
export class ExhibitsController {
  constructor(
    private readonly exhibits: ExhibitQueries,
    private readonly gate: ExhibitGate,
    private readonly cache: Cache,
    private readonly supervisor: Supervisor,
    private readonly admin: Admin,
  ) {}

  @Get()
  list() {
    return this.exhibits.list()
  }

  @Get('current')
  async current() {
    const state = await this.cache.exhibitSnapshot()
    if (!state) throw new NotFoundException('no exhibit is running')
    return state
  }

  @Get(':id')
  async detail(@Param('id', new ParseUUIDPipe()) id: string) {
    const exhibit = await this.exhibits.detail(id)
    if (!exhibit) throw new NotFoundException()
    return exhibit
  }

  @Post()
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'exhibits', setting: 'EXHIBITS_PER_HOUR', windowSeconds: 3600 })
  async start(@Body() body: StartExhibit, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const admission = this.admin.is(req) ? null : await this.gate.enter(body.durationSeconds)
    if (admission?.kind === 'too-long') {
      throw new BadRequestException(`exhibits are limited to ${admission.limitSeconds} s`)
    }
    if (admission?.kind === 'cooling-down') {
      res.setHeader('Retry-After', String(admission.retryAfterSeconds))
      throw new HttpException('the box is cooling down after the last exhibit', HttpStatus.TOO_MANY_REQUESTS)
    }
    const reply = await this.supervisor.forward('POST', '/exhibits', body, req.headers)
    if (reply.status >= 400) await admission?.giveBack()
    return respondWith(res, reply)
  }

  @Delete('current')
  @UseGuards(AdminGuard)
  async stop(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return respondWith(res, await this.supervisor.forward('DELETE', '/exhibits/current', undefined, req.headers))
  }
}

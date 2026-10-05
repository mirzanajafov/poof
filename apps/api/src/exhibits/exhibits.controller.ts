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
import { ConfigService } from '@nestjs/config'
import { IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator'
import type { Request, Response } from 'express'
import type { Env } from '../config/env.js'
import { Admin, AdminGuard, RateLimit, RateLimitGuard } from '../guards/guards.js'
import { Cache, Database } from '../infra/infra.module.js'
import { Supervisor } from '../supervisor/supervisor.client.js'

export class StartExhibit {
  @IsString()
  policy: string

  @IsInt()
  @Min(10)
  @Max(900)
  durationSeconds: number

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(3)
  utilization?: number

  @IsOptional()
  @IsString()
  dataset?: string

  @IsOptional()
  @IsInt()
  seed?: number
}

@Controller('exhibits')
export class ExhibitsController {
  private readonly cooldownSeconds: number
  private readonly publicSeconds: number

  constructor(
    private readonly db: Database,
    private readonly cache: Cache,
    private readonly supervisor: Supervisor,
    private readonly admin: Admin,
    config: ConfigService<Env, true>,
  ) {
    this.cooldownSeconds = config.get('EXHIBIT_COOLDOWN_SECONDS', { infer: true })
    this.publicSeconds = config.get('PUBLIC_EXHIBIT_SECONDS', { infer: true })
  }

  @Get()
  async list() {
    return this.db.client.exhibit.findMany({ orderBy: { startedAt: 'desc' }, take: 20 })
  }

  @Get('current')
  async current() {
    const state = await this.cache.json('poof:exhibit')
    if (!state) throw new NotFoundException('no exhibit is running')
    return state
  }

  @Get(':id')
  async detail(@Param('id', new ParseUUIDPipe()) id: string) {
    const exhibit = await this.db.client.exhibit.findUnique({
      where: { id },
      include: {
        tasks: {
          orderBy: { submittedAt: 'asc' },
          select: { id: true, status: true, items: true, done: true, submittedAt: true, deadline: true, finishedAt: true },
        },
      },
    })
    if (!exhibit) throw new NotFoundException()
    return exhibit
  }

  @Post()
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'exhibits', setting: 'EXHIBITS_PER_HOUR', windowSeconds: 3600 })
  async start(@Body() body: StartExhibit, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (!this.admin.is(req)) {
      if (body.durationSeconds > this.publicSeconds) {
        throw new BadRequestException(`exhibits are limited to ${this.publicSeconds} s`)
      }
      if (this.cooldownSeconds > 0) {
        const started = await this.cache.redis.set('poof:exhibit-cooldown', '1', 'EX', this.cooldownSeconds + body.durationSeconds, 'NX')
        if (!started) {
          const ttl = await this.cache.redis.ttl('poof:exhibit-cooldown')
          res.setHeader('Retry-After', String(Math.max(1, ttl)))
          throw new HttpException('the box is cooling down after the last exhibit', HttpStatus.TOO_MANY_REQUESTS)
        }
      }
    }
    const result = await this.supervisor.relay('POST', '/exhibits', body, res, req.headers)
    if (res.statusCode >= 400) await this.cache.redis.del('poof:exhibit-cooldown')
    return result
  }

  @Delete('current')
  @UseGuards(AdminGuard)
  stop(@Res({ passthrough: true }) res: Response) {
    return this.supervisor.relay('DELETE', '/exhibits/current', undefined, res)
  }
}

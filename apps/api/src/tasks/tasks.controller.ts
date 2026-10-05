import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator'
import type { Request, Response } from 'express'
import type { Env } from '../config/env.js'
import { RateLimit, RateLimitGuard } from '../guards/guards.js'
import { Database } from '../infra/infra.module.js'
import { Supervisor } from '../supervisor/supervisor.client.js'

export class SubmitTask {
  @IsString()
  dataset: string

  @IsString()
  preset: string

  @IsNumber()
  @Min(1)
  @Max(3600)
  deadlineSeconds: number

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  count?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number
}

export class ListTasks {
  @IsOptional()
  @IsIn(['QUEUED', 'RUNNING', 'DONE', 'FAILED', 'REJECTED'])
  status?: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'REJECTED'

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number
}

const contentTypes: Array<[string, string]> = [
  ['webp', 'image/webp'],
  ['jpg', 'image/jpeg'],
  ['avif', 'image/avif'],
]

@Controller('tasks')
export class TasksController {
  private readonly dataDir: string

  constructor(
    private readonly db: Database,
    private readonly supervisor: Supervisor,
    config: ConfigService<Env, true>,
  ) {
    this.dataDir = config.get('DATA_DIR', { infer: true })
  }

  @Get()
  list(@Query() query: ListTasks) {
    return this.db.client.task.findMany({
      where: query.status ? { status: query.status } : {},
      orderBy: { submittedAt: 'desc' },
      take: query.limit ?? 50,
    })
  }

  @Get(':id')
  async detail(@Param('id', new ParseUUIDPipe()) id: string) {
    const task = await this.db.client.task.findUnique({
      where: { id },
      include: {
        leases: { orderBy: [{ depth: 'asc' }, { lo: 'asc' }] },
        deadLetters: { orderBy: { item: 'asc' } },
        decisions: { orderBy: { at: 'asc' }, take: 200 },
      },
    })
    if (!task) throw new NotFoundException()
    return { ...task, decisions: task.decisions.map((d) => ({ ...d, id: d.id.toString() })) }
  }

  @Post()
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'tasks', setting: 'TASKS_PER_MINUTE', windowSeconds: 60 })
  submit(@Body() body: SubmitTask, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.supervisor.relay('POST', '/tasks', body, res, req.headers)
  }

  @Get(':id/items/:item')
  async item(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('item', new ParseIntPipe()) item: number,
    @Res() res: Response,
  ) {
    for (const [ext, type] of contentTypes) {
      const path = join(this.dataDir, 'tasks', id, 'out', `${item}.${ext}`)
      const found = await stat(path).catch(() => null)
      if (!found?.isFile()) continue
      res.setHeader('Content-Type', type)
      res.setHeader('Content-Length', String(found.size))
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable')
      createReadStream(path).pipe(res)
      return
    }
    throw new NotFoundException()
  }
}

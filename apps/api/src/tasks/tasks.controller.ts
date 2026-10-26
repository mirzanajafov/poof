import { STATUS_CODES } from 'node:http'
import {
  Body,
  Controller,
  Get,
  HttpException,
  Logger,
  Next,
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
import { outputDir, outputExtensions, taskDir } from '@poof/contracts'
import type { NextFunction, Request, Response } from 'express'
import { RateLimit } from '../access/rate-limit.decorator.js'
import { RateLimitGuard } from '../access/rate-limit.guard.js'
import { Env } from '../config/env.js'
import { respondWith } from '../supervisor/respond.js'
import { Supervisor } from '../supervisor/supervisor.client.js'
import { ListTasks } from './list-tasks.dto.js'
import { SubmitTask } from './submit-task.dto.js'
import { TaskQueries } from './task-queries.js'

const extensions = [...new Set(Object.values(outputExtensions))]

@Controller('tasks')
export class TasksController {
  private readonly logger = new Logger(TasksController.name)

  constructor(
    private readonly tasks: TaskQueries,
    private readonly supervisor: Supervisor,
    private readonly env: Env,
  ) {}

  @Get()
  list(@Query() query: ListTasks) {
    return this.tasks.list(query.status, query.limit)
  }

  @Get(':id')
  async detail(@Param('id', new ParseUUIDPipe()) id: string) {
    const task = await this.tasks.detail(id)
    if (!task) throw new NotFoundException()
    return { ...task, decisions: task.decisions.map((d) => ({ ...d, id: d.id.toString() })) }
  }

  @Post()
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: 'tasks', setting: 'TASKS_PER_MINUTE', windowSeconds: 60 })
  async submit(@Body() body: SubmitTask, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return respondWith(res, await this.supervisor.forward('POST', '/tasks', body, req.headers))
  }

  @Get(':id/items/:item')
  item(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('item', new ParseIntPipe()) item: number,
    @Res() res: Response,
    @Next() next: NextFunction,
  ): void {
    const options = { root: outputDir(taskDir(this.env.DATA_DIR, id)), extensions, maxAge: '1d', immutable: true }
    res.sendFile(String(item), options, (error) => {
      if (error) this.sendFailed(error, res, next)
    })
  }

  private sendFailed(error: Error, res: Response, next: NextFunction): void {
    if (('code' in error && error.code === 'ECONNABORTED') || ('syscall' in error && error.syscall === 'write')) return
    if (res.headersSent) {
      res.destroy(error)
      return
    }
    for (const name of res.getHeaderNames()) res.removeHeader(name)
    const status = 'status' in error && typeof error.status === 'number' ? error.status : 500
    if (status >= 500) this.logger.error(error)
    next(new HttpException(STATUS_CODES[status] ?? 'Error', status))
  }
}

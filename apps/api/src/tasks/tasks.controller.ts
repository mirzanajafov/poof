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
import type { NextFunction, Request, Response } from 'express'
import { RateLimit } from '../access/rate-limit.decorator.js'
import { RateLimitGuard } from '../access/rate-limit.guard.js'
import { respondWith } from '../supervisor/respond.js'
import { Supervisor } from '../supervisor/supervisor.client.js'
import { ListTasks } from './list-tasks.dto.js'
import { OutputFiles } from './output-files.js'
import { SubmitTask } from './submit-task.dto.js'
import { TaskQueries } from './task-queries.js'

@Controller('tasks')
export class TasksController {
  private readonly logger = new Logger(TasksController.name)

  constructor(
    private readonly tasks: TaskQueries,
    private readonly outputs: OutputFiles,
    private readonly supervisor: Supervisor,
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
  async item(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('item', new ParseIntPipe()) item: number,
    @Res() res: Response,
    @Next() next: NextFunction,
  ) {
    const file = await this.outputs.find(id, item)
    if (!file) throw new NotFoundException()
    res.sendFile(file.name, { root: file.dir, maxAge: '1d', immutable: true }, (error) => {
      if (!error || clientWentAway(error)) return
      const status = 'status' in error && typeof error.status === 'number' ? error.status : 500
      if (status >= 500) this.logger.error(error)
      next(new HttpException(STATUS_CODES[status] ?? 'Error', status))
    })
  }
}

function clientWentAway(error: Error): boolean {
  return ('code' in error && error.code === 'ECONNABORTED') || ('syscall' in error && error.syscall === 'write')
}

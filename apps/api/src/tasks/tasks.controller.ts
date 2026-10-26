import {
  Body,
  Controller,
  Get,
  InternalServerErrorException,
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
    return task
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
    const path = await this.outputs.path(id, item)
    if (!path) throw new NotFoundException()
    res.sendFile(
      path,
      { maxAge: '1d', immutable: true, lastModified: false, acceptRanges: false, dotfiles: 'allow' },
      (error) => {
        if (!error || ('code' in error && error.code === 'ECONNABORTED')) return
        if ('status' in error && error.status === 404) {
          next(new NotFoundException())
          return
        }
        this.logger.error(error)
        next(new InternalServerErrorException())
      },
    )
  }
}
